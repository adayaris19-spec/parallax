// PARALLAX digest — Supabase Edge Function named `digest`. The weekly email for Plus and Pro.
//
// Every Monday (cron parallax-digest, after the weekly brief), each paying subscriber with the weekly
// email on gets one email: the week in three lines, the ripples (Pro), new big grants (Pro), their
// calls that were settled, and what's coming up. Goals they watch (Pro watchlist) or get alerts for
// come first. No AI here: it reuses the terminal function's data.
//
// Sending uses Resend (secret RESEND_API_KEY; sender DIGEST_FROM, default Resend's test sender, which
// can only send to the Resend account's own address until a domain is verified).
//
//   POST {"action":"send"}                      admin: send this week's emails (skips anyone already sent)
//   POST {"action":"test","email":"..."}        admin: send one now to that subscriber (ignores the weekly check)
//   GET  ?action=preview&email=...              admin header: the email as a web page
//   GET/POST ?action=unsub&t=<token>             the one-click unsubscribe link in every email
// Deploy with verify_jwt false (the unsubscribe link is opened from an email); admin actions check
// the x-parallax-admin header.
const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("DIGEST_FROM") ?? "Parallax <onboarding@resend.dev>";
const SITE = (Deno.env.get("SITE_URL") ?? "https://adayaris19-spec.github.io/parallax/").replace(/\/?$/, "/");
const FN = `${SB}/functions/v1/digest`;
const PAID = ["active", "trialing", "comp"];
const DAY = 86_400_000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const page = (title: string, text: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#FAFAF9;color:#111214;display:grid;place-items:center;min-height:90vh;margin:0"><div style="max-width:420px;padding:24px;text-align:center"><h1 style="font-size:22px">${title}</h1><p style="color:#3C3F45;line-height:1.5">${text}</p><p><a href="${SITE}" style="color:#3D4BF2">Back to Parallax</a></p></div>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });

async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`database ${r.status} on ${path.split("?")[0]}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const usd = (x: number) => (x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(x >= 1e8 ? 0 : 1)}M` : `$${Math.round(x / 1e3)}K`);
// Grant titles come in capitals from USAspending: say them in sentence case.
const calm = (s: string) => { const t = String(s ?? ""); const up = t.replace(/[^A-Z]/g, "").length, low = t.replace(/[^a-z]/g, "").length; return up > low * 2 ? t.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (m) => m.toUpperCase()) : t; };
const month = (d: string) => (/^\d{4}-\d{2}$/.test(d) ? new Date(`${d}-15`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : d);

// Every paying subscriber with an email address.
async function subscribers() {
  const subs: { user_id: string; plan: string | null }[] = await db(`subscriptions?status=in.(${PAID.join(",")})&select=user_id,plan`);
  const emails = new Map<string, string>();
  for (let page = 1; page < 50; page++) {
    const r = await fetch(`${SB}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
    const d = await r.json(); const users = d.users ?? [];
    for (const u of users) if (u.email) emails.set(u.id, u.email);
    if (users.length < 1000) break;
  }
  return subs.filter((s) => emails.has(s.user_id)).map((s) => ({ ...s, email: emails.get(s.user_id)!, pro: s.plan !== "plus" }));
}

// What everyone shares this week (the terminal's full data), loaded once per run.
async function shared() {
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const r = await fetch(`${SB}/functions/v1/terminal`, { method: "POST", headers: { Authorization: `Bearer ${anon}`, apikey: anon, "Content-Type": "application/json", "x-admin-token": ADMIN }, body: "{}" });
  const t = await r.json();
  if (t.error || t.access !== "full") throw new Error(`terminal: ${t.error ?? "no full access"}`);
  const results = await db(`prediction_results?resolved_at=gte.${new Date(Date.now() - 7 * DAY).toISOString()}&select=key,outcome,note`);
  const questions = results.length ? await db(`prediction_questions?key=in.(${results.map((r: { key: string }) => `"${r.key}"`).join(",")})&select=key,title,question,goal_id`) : [];
  return { t, results, questions };
}

type Sub = { user_id: string; email: string; pro: boolean };
async function build(sub: Sub, S: Awaited<ReturnType<typeof shared>>, token: string) {
  const { t } = S, since = Date.now() - 7 * DAY;
  // Goals this person cares about: Pro watchlist, then goals they get alerts for.
  const [wl, pushes, calls, all] = await Promise.all([
    db(`watchlists?user_id=eq.${sub.user_id}&select=goals`).catch(() => []),
    db(`push_subscriptions?user_id=eq.${sub.user_id}&select=goals`).catch(() => []),
    db(`predictions?user_id=eq.${sub.user_id}&select=key,choice`).catch(() => []),
    db("prediction_results?select=key,outcome").catch(() => []),
  ]);
  const mine = new Set<string>([...(wl[0]?.goals ?? []), ...pushes.flatMap((p: { goals: string[] }) => p.goals ?? [])]);
  // deno-lint-ignore no-explicit-any
  const first = (arr: any[]): any[] => [...arr].sort((a, b) => Number(mine.has(b.from?.slug ?? b.slug)) - Number(mine.has(a.from?.slug ?? a.slug)));
  const b = t.brief;
  const ripples = sub.pro ? first((t.crossovers?.ripples ?? []).filter((r: { at: string }) => new Date(r.at).getTime() >= since)).slice(0, 3) : [];
  const grants = sub.pro ? first((t.money?.awards ?? []).filter((a: { first_seen: string }) => new Date(a.first_seen).getTime() >= since)) : [];
  const nextUp = first(t.catalysts ?? []).slice(0, 3);
  // Calls settled this week, and the overall record.
  const settled = calls.map((c: { key: string; choice: string }) => ({ ...c, r: S.results.find((x: { key: string }) => x.key === c.key), q: S.questions.find((x: { key: string }) => x.key === c.key) })).filter((c: { r: unknown; q: unknown }) => c.r && c.q);
  const judged = calls.filter((c: { key: string }) => all.some((r: { key: string; outcome: string }) => r.key === c.key && r.outcome !== "void"));
  const right = judged.filter((c: { key: string; choice: string }) => all.find((r: { key: string }) => r.key === c.key)?.outcome === c.choice).length;
  const home = sub.pro ? `${SITE}#/terminal` : `${SITE}#/plus`;

  const h2 = (s: string) => `<tr><td style="padding:26px 0 8px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#73767E">${s}</td></tr>`;
  const row = (inner: string) => `<tr><td style="padding:10px 0;border-top:1px solid #ECECE9;font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111214">${inner}</td></tr>`;
  const small = (s: string) => `<div style="font-size:13px;line-height:1.45;color:#73767E;margin-top:3px">${s}</div>`;
  const link = (href: string, text: string) => `<a href="${href}" style="color:#111214;text-decoration:none;font-weight:600">${text}</a>`;
  const sections: string[] = [];
  if (b) sections.push(`${h2("The week in 30 seconds")}<tr><td style="font:700 22px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111214;padding-bottom:6px">${esc(b.headline)}</td></tr>
    ${(b.tldr ?? []).slice(0, 3).map((x: string) => row(`• ${esc(x)}`)).join("")}`);
  if (ripples.length) sections.push(`${h2(`Ripples · ${ripples.length} this week`)}${ripples.map((r: { headline: string; post?: number; from: { goal: string }; affects: { goal: string; title: string; why: string }[] }) =>
    row(`${r.post ? link(`${SITE}#/p/${r.post}`, esc(r.headline)) : `<b>${esc(r.headline)}</b>`}${small(`@${esc(r.from.goal)} → also moves ${[...new Map(r.affects.map((a) => [a.goal, a])).values()].slice(0, 2).map((a) => { const n = r.affects.filter((x) => x.goal === a.goal).length; return `@${esc(a.goal)} (${n > 1 ? `${n} shared problems` : esc(a.title)})`; }).join(", ")}`)}`)).join("")}`);
  if (grants.length) sections.push(`${h2(`New grants of $1M+ · ${grants.length} this week, ${usd(grants.reduce((s: number, a: { amount: number }) => s + a.amount, 0))}`)}${grants.slice(0, 3).map((a: { amount: number; recipient: string; goal: string; title: string; url: string }) =>
    row(`<b>${usd(a.amount)}</b> to ${esc(a.recipient)}${small(`@${esc(a.goal)} · ${esc(calm(a.title))}`)}`)).join("")}`);
  if (settled.length || calls.length) sections.push(`${h2("Your calls")}${settled.map((c: { choice: string; r: { outcome: string; note: string }; q: { title: string; question: string } }) =>
    row(`${c.r.outcome === "void" ? "–" : c.r.outcome === c.choice ? "✓ You called it" : "✗ Not this time"}: <b>${esc(c.q.question)}</b>${small(`${esc(c.q.title)} · result: ${c.r.outcome === "void" ? "no result" : c.r.outcome}. ${esc(c.r.note ?? "")}`)}`)).join("")}
    ${row(`${calls.length} call${calls.length === 1 ? "" : "s"} made${judged.length ? ` · ${right} of ${judged.length} right` : ""} · ${link(`${SITE}#/plus`, "make this week’s call →")}`)}`);
  else sections.push(`${h2("Your calls")}${row(`You haven’t made a call yet. ${link(`${SITE}#/plus`, "Call this week’s trial readouts and promises →")}`)}`);
  if (nextUp.length) sections.push(`${h2("Coming up")}${nextUp.map((c: { date: string; title: string; goal: string; kind: string }) => row(`<b>${esc(month(c.date))}</b> · ${esc(c.title)}${small(`@${esc(c.goal)} · ${c.kind === "trial" ? "trial readout" : "promise due"}`)}`)).join("")}`);
  const unsub = `${FN}?action=unsub&t=${token}`;
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const subject = b?.headline ? `Your week: ${b.headline}` : `Your week in progress · ${date}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#FAFAF9"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF9"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#FFFFFF;border:1px solid #ECECE9;border-radius:18px"><tr><td style="padding:26px 28px 30px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font:600 14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111214">Parallax ${sub.pro ? "Pro" : "Plus"} <span style="color:#73767E;font-weight:400">· your week in progress · ${esc(date)}</span></td></tr>
${sections.join("")}
<tr><td style="padding:28px 0 0"><a href="${home}" style="display:inline-block;background:#111214;color:#FFFFFF;text-decoration:none;font:600 15px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:13px 20px;border-radius:999px">Open ${sub.pro ? "Parallax Pro" : "your week"} →</a></td></tr>
</table></td></tr></table>
<p style="max-width:580px;font:12px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#A3A6AD;margin:16px auto 0">You get this because you subscribe to Parallax ${sub.pro ? "Pro" : "Plus"}. One email a week, on Mondays. <a href="${unsub}" style="color:#73767E">Unsubscribe</a> · <a href="${SITE}#/${sub.pro ? "terminal/calendar" : "plus"}" style="color:#73767E">email settings</a></p>
</td></tr></table></body></html>`;
  return { subject, html, unsub };
}

async function prefsFor(userId: string) {
  let [p] = await db(`email_prefs?user_id=eq.${userId}&select=weekly,unsub_token,last_sent_at`);
  if (!p) [p] = await db("email_prefs?on_conflict=user_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=representation", body: { user_id: userId } }) ?? [];
  if (!p) [p] = await db(`email_prefs?user_id=eq.${userId}&select=weekly,unsub_token,last_sent_at`);
  return p as { weekly: boolean; unsub_token: string; last_sent_at: string | null };
}

async function mail(to: string, m: { subject: string; html: string; unsub: string }) {
  if (!RESEND) throw new Error("RESEND_API_KEY is not set");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: m.subject, html: m.html, headers: { "List-Unsubscribe": `<${m.unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function send(only?: string) {
  const subs = (await subscribers()).filter((s) => !only || s.email.toLowerCase() === only.toLowerCase());
  if (!subs.length) return { note: only ? "no paying subscriber with that email" : "no subscribers" };
  const S = await shared();
  const out: Record<string, string> = {};
  for (const sub of subs) {
    try {
      const p = await prefsFor(sub.user_id);
      if (!only && (!p.weekly || (p.last_sent_at && Date.now() - new Date(p.last_sent_at).getTime() < 6 * DAY))) { out[sub.email] = p.weekly ? "already sent this week" : "unsubscribed"; continue; }
      await mail(sub.email, await build(sub, S, p.unsub_token));
      await db(`email_prefs?user_id=eq.${sub.user_id}`, { method: "PATCH", prefer: "return=minimal", body: { last_sent_at: new Date().toISOString() } });
      out[sub.email] = "sent";
    } catch (e) { out[sub.email] = `failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`; }
  }
  return { subscribers: subs.length, results: out };
}

Deno.serve(async (req) => {
  const url = new URL(req.url), q = url.searchParams;
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const action = q.get("action") ?? body.action;
  try {
    if (action === "unsub") {
      const tok = q.get("t") ?? body.t ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(tok)) return page("That link doesn’t look right", "Open the unsubscribe link from your latest Parallax email.");
      const done = await db(`email_prefs?unsub_token=eq.${tok}`, { method: "PATCH", prefer: "return=representation", body: { weekly: false, updated_at: new Date().toISOString() } });
      return done?.length ? page("You’re unsubscribed", "You won’t get the weekly Parallax email any more. Your subscription itself is unchanged, and you can turn the email back on in the app.") : page("Link not found", "This unsubscribe link has expired. You can turn the email off in the app.");
    }
    if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
    if (action === "preview") {
      const email = q.get("email") ?? body.email ?? "";
      const sub = (await subscribers()).find((s) => s.email.toLowerCase() === String(email).toLowerCase());
      if (!sub) return json({ error: "no paying subscriber with that email" }, 404);
      const p = await prefsFor(sub.user_id);
      const m = await build(sub, await shared(), p.unsub_token);
      return new Response(m.html, { headers: { "Content-Type": "text/html; charset=utf-8", "x-subject": encodeURIComponent(m.subject) } });
    }
    if (action === "test") return json(await send(String(body.email ?? "")));
    if (action === "send") return json(await send());
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("digest failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 300) : "failed" }, 500);
  }
});
