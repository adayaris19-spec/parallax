// PARALLAX digest — Supabase Edge Function named `digest`. The weekly email for Parallax Plus subscribers.
//
// Every Monday (cron parallax-digest, after the weekly brief), each paying subscriber with the weekly
// email on gets one email: the week in 30 seconds, what moved, what to watch, ripples between goals
// and what's coming up. Goals they watch or get alerts for come first. No AI here: it reuses the terminal function's data.
//
// Sending uses Resend (secret RESEND_API_KEY; sender DIGEST_FROM, default Resend's test sender, which
// can only send to the Resend account's own address until a domain is verified).
//
//   POST {"action":"send"}                      admin: send this week's emails (skips anyone already sent)
//   POST {"action":"test","email":"...","as"?:"plus"|"pro"}  admin: send one now (ignores the weekly check; `as` shows the other plan's email)
//   GET  ?action=preview&email=...              admin header: the email as a web page
//   GET/POST ?action=unsub&t=<token>             the one-click unsubscribe link in every email
// Deploy with verify_jwt false (the unsubscribe link is opened from an email); admin actions check
// the x-parallax-admin header.
const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("DIGEST_FROM") ?? "Parallax <onboarding@resend.dev>";
// Postal address in every email's footer (US anti-spam law requires one in marketing email).
const ADDRESS = Deno.env.get("DIGEST_ADDRESS") ?? "";
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
  const [pics, counts] = await Promise.all([
    db("goal_pictures?select=goal_id,pics").catch(() => []),
    db("prediction_counts?select=key,yes,no").catch(() => []),
  ]);
  const picOf = new Map<string, string>();
  for (const g of t.goals ?? []) { const p = pics.find((x: { goal_id: number }) => x.goal_id === g.id)?.pics?.[0]; if (p) picOf.set(g.slug, p); }
  return { t, results, questions, picOf, counts };
}

type Sub = { user_id: string; email: string; pro: boolean };
async function build(sub: Sub, S: Awaited<ReturnType<typeof shared>>, token: string) {
  const { t, picOf } = S, since = Date.now() - 7 * DAY;
  const [wl, pushes] = await Promise.all([
    db(`watchlists?user_id=eq.${sub.user_id}&select=goals`).catch(() => []),
    db(`push_subscriptions?user_id=eq.${sub.user_id}&select=goals`).catch(() => []),
  ]);
  // Goals this person watches or gets alerts for come first everywhere.
  const mine = new Set<string>([...(wl[0]?.goals ?? []), ...pushes.flatMap((p: { goals: string[] }) => p.goals ?? [])]);
  // deno-lint-ignore no-explicit-any
  const first = (arr: any[]): any[] => [...arr].sort((a, b) => Number(mine.has(b.from?.slug ?? b.slug)) - Number(mine.has(a.from?.slug ?? a.slug)));
  const slugOfHandle = (h: string) => (t.goals ?? []).find((g: { handle: string }) => g.handle === String(h ?? "").replace(/^@/, ""))?.slug;
  const b = t.brief;
  const allRipples = first((t.crossovers?.ripples ?? []).filter((r: { at: string }) => new Date(r.at).getTime() >= since));
  const ripples = allRipples.slice(0, 3);
  const nextUp = first(t.catalysts ?? []).slice(0, 3);
  const firstGoal = (arr: { goal: string }[]) => [...arr].sort((x, y) => Number(mine.has(slugOfHandle(y.goal) ?? "")) - Number(mine.has(slugOfHandle(x.goal) ?? "")));
  const moved = firstGoal(b?.moved ?? []).slice(0, 4), watch = firstGoal(b?.watch ?? []).slice(0, 2);
  const home = `${SITE}#/plus`;

  // Building blocks (tables and inline styles only: they render the same in Gmail, Apple Mail and Outlook).
  const F = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif", INK = "#111214", INK2 = "#3C3F45", MUTED = "#73767E", LINE = "#ECECE9", SUNK = "#F2F2F0", ACC = "#3D4BF2", GREEN = "#14955F", RED = "#E0484E";
  const label = (s: string, color = MUTED) => `<div style="font:600 11px/1.4 ${F};letter-spacing:.09em;text-transform:uppercase;color:${color};margin:0 0 10px">${s}</div>`;
  const section = (inner: string) => `<tr><td style="padding:28px 0 0">${inner}</td></tr>`;
  const avatar = (slug: string | undefined, size = 40) => { const u = slug && picOf.get(slug); return u ? `<img src="${esc(u)}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;border:0">` : `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${SUNK}"></div>`; };
  const chip = (s: string, bg = SUNK, color = INK2) => `<span style="display:inline-block;font:600 12px/1 ${F};padding:4px 8px;border-radius:999px;background:${bg};color:${color}">${s}</span>`;
  const button = (href: string, text: string, bg = INK) => `<a href="${href}" style="display:inline-block;background:${bg};color:#FFFFFF;text-decoration:none;font:600 15px/1 ${F};padding:14px 22px;border-radius:999px">${text}</a>`;
  const blocks: string[] = [];

  // 1. Hero: the week's lead story, with its goal's picture.
  const leadSlug = slugOfHandle(b?.moved?.[0]?.goal) ?? ripples[0]?.from?.slug ?? [...picOf.keys()][0];
  const hero = leadSlug && picOf.get(leadSlug);
  if (b) blocks.push(`<tr><td style="padding:0">${hero ? `<a href="${home}"><img src="${esc(hero)}" width="580" alt="" style="display:block;width:100%;max-width:580px;height:220px;object-fit:cover;border-radius:18px 18px 0 0;border:0"></a>` : ''}</td></tr>
    <tr><td style="padding:22px 28px 0">${label(`The week in 30 seconds · ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}`, ACC)}
      <div style="font:800 26px/1.2 ${F};color:${INK};letter-spacing:-.02em">${esc(b.headline)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">${(b.tldr ?? []).slice(0, 3).map((x: string, i: number) => `<tr><td width="28" valign="top" style="font:700 14px/1.5 ${F};color:${ACC};padding:6px 0">${i + 1}</td><td style="font:15px/1.5 ${F};color:${INK2};padding:6px 0;border-top:${i ? `1px solid ${LINE}` : "0"}">${esc(x)}</td></tr>`).join("")}</table></td></tr>`);

  const inner: string[] = [];
  // 2. The week in numbers.
  const stats = [[String(b?.moved?.length ?? 0), "big moves"], [String(allRipples.length), allRipples.length === 1 ? "ripple" : "ripples"], [String(b?.watch?.length ?? 0), "to watch"], [String((t.catalysts ?? []).length), "coming up"]];
  inner.push(section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SUNK};border-radius:14px"><tr>${stats.map(([n, l], i) => `<td align="center" style="padding:14px 6px;${i ? `border-left:1px solid ${LINE};` : ""}"><div style="font:800 24px/1.1 ${F};color:${INK}">${esc(n)}</div><div style="font:12px/1.3 ${F};color:${MUTED};margin-top:4px">${esc(l)}</div></td>`).join("")}</tr></table>`));

  // 3. What moved, and what to watch (the weekly brief), each with its goal's picture.
  const items = (arr: { goal: string; short?: string; text: string }[], tag: string, bg: string, color: string) => arr.map((m) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE}"><tr>
      <td width="52" valign="top" style="padding:14px 0">${avatar(slugOfHandle(m.goal))}</td>
      <td valign="top" style="padding:14px 0">${chip(tag, bg, color)} <span style="font:600 12px/1 ${F};color:${MUTED}">${esc(m.goal)}</span>
        <div style="font:600 16px/1.35 ${F};color:${INK};margin:8px 0 4px">${esc(m.short ?? "")}</div><div style="font:13.5px/1.5 ${F};color:${INK2}">${esc(m.text)}</div></td></tr></table>`).join("");
  if (moved.length) inner.push(section(`${label("What moved")}${items(moved, "Moved", "#E8F5EE", GREEN)}`));
  if (watch.length) inner.push(section(`${label("Worth watching")}${items(watch, "Watch", "#FFF4E0", "#B26A00")}`));

  // 4. Ripples, with goal pictures.
  if (ripples.length) inner.push(section(`${label("Ripples · moves that reached another goal")}${ripples.map((r: { headline: string; kind: string; from: { goal: string; slug: string }; affects: { goal: string; slug: string; title: string }[] }) => {
    const to = [...new Map(r.affects.map((a) => [a.goal, a])).values()].slice(0, 2);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE}"><tr>
      <td width="52" valign="top" style="padding:14px 0">${avatar(r.from.slug)}</td>
      <td valign="top" style="padding:14px 0">${chip(r.kind === "grant" ? "Big grant" : r.kind === "setback" ? "Setback" : r.kind === "bottleneck" ? "Bottleneck" : "Advance", r.kind === "setback" ? "#FDECEC" : r.kind === "grant" ? "#EEF0FF" : "#E8F5EE", r.kind === "setback" ? RED : r.kind === "grant" ? ACC : GREEN)}
        <div style="font:600 16px/1.35 ${F};color:${INK};margin:8px 0 6px"><a href="${SITE}#/plus/crossovers" style="color:${INK};text-decoration:none">${esc(r.headline)}</a></div>
        <div style="font:13.5px/1.45 ${F};color:${MUTED}">@${esc(r.from.goal)} <span style="color:${ACC}">→</span> also moves ${to.map((a) => `<b style="color:${INK2}">@${esc(a.goal)}</b>`).join(" and ")}</div></td>
      <td width="${to.length * 30 + 6}" valign="top" align="right" style="padding:14px 0 0 8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${to.map((a) => `<td style="padding-left:4px">${avatar(a.slug, 26)}</td>`).join("")}</tr></table></td></tr></table>`;
  }).join("")}`));

  // 5. Coming up, as date tiles.
  if (nextUp.length) inner.push(section(`${label("Coming up")}${nextUp.map((c: { date: string; title: string; goal: string; kind: string }) => {
    const d = /^\d{4}-\d{2}$/.test(c.date) ? new Date(`${c.date}-15`) : null;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>
      <td width="64" valign="top"><table role="presentation" width="52" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px;overflow:hidden"><tr><td align="center" style="background:${ACC};color:#FFFFFF;font:700 10px/1 ${F};letter-spacing:.08em;padding:5px 0">${d ? d.toLocaleDateString("en-US", { month: "short" }).toUpperCase() : "SOON"}</td></tr><tr><td align="center" style="font:800 16px/1 ${F};color:${INK};padding:7px 0">${d ? d.getFullYear() : ""}</td></tr></table></td>
      <td valign="top" style="padding-top:2px"><div style="font:600 14.5px/1.35 ${F};color:${INK}">${esc(c.title)}</div><div style="font:13px/1.4 ${F};color:${MUTED};margin-top:3px">@${esc(c.goal)} · ${c.kind === "trial" ? "trial readout" : "promise due"}</div></td></tr></table>`;
  }).join("")}<div style="font:13px/1.4 ${F};margin-top:4px"><a href="${SITE}#/plus/calendar" style="color:${ACC}">The full calendar →</a></div>`));

  inner.push(section(`<div style="text-align:center;padding:6px 0 4px">${button(home, "Open Parallax Plus →", ACC)}</div>`));
  const unsub = `${FN}?action=unsub&t=${token}`;
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const subject = b?.headline ? `Your week: ${b.headline}` : `Your week in progress · ${date}`;
  const pre = `${b?.moved?.length ?? 0} big moves, ${allRipples.length} ripples between goals, and what's coming up.`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#FAFAF9"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px"><tr><td style="padding:0 4px 12px;font:700 15px/1 ${F};color:${INK}">Parallax <span style="color:${MUTED};font-weight:400">Plus</span></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#FFFFFF;border:1px solid ${LINE};border-radius:18px">
${blocks.join("")}
<tr><td style="padding:0 28px 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner.join("")}</table></td></tr>
</table>
<p style="max-width:560px;font:12px/1.55 ${F};color:#A3A6AD;margin:16px auto 0;text-align:center">You get this because you subscribe to Parallax Plus. One email a week, on Mondays.<br><a href="${unsub}" style="color:${MUTED}">Unsubscribe</a> · <a href="${SITE}#/settings" style="color:${MUTED}">Email settings</a> · <a href="${SITE}#/privacy" style="color:${MUTED}">Privacy</a>${ADDRESS ? `<br>Parallax · ${esc(ADDRESS)}` : ""}</p>
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

async function send(only?: string, as?: string) {
  // `as` (tests only): "plus" or "pro", to see the other plan's email.
  const subs = (await subscribers()).filter((s) => !only || s.email.toLowerCase() === only.toLowerCase()).map((s) => (as ? { ...s, pro: as !== "plus" } : s));
  if (!subs.length) return { note: only ? "no paying subscriber with that email" : "no subscribers" };
  const S = await shared();
  const out: Record<string, string> = {};
  for (const sub of subs) {
    try {
      const p = await prefsFor(sub.user_id);
      if (!only && (!p.weekly || (p.last_sent_at && Date.now() - new Date(p.last_sent_at).getTime() < 6 * DAY))) { out[sub.email] = p.weekly ? "already sent this week" : "unsubscribed"; continue; }
      const m = await build(sub, S, p.unsub_token);
      if (as) m.subject = `[${as === "plus" ? "Plus" : "Pro"} version] ${m.subject}`;
      await mail(sub.email, m);
      if (!as) await db(`email_prefs?user_id=eq.${sub.user_id}`, { method: "PATCH", prefer: "return=minimal", body: { last_sent_at: new Date().toISOString() } });
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
      const found = (await subscribers()).find((s) => s.email.toLowerCase() === String(email).toLowerCase());
      const as = q.get("as") ?? body.as, sub = found && (as === "plus" || as === "pro") ? { ...found, pro: as !== "plus" } : found;
      if (!sub) return json({ error: "no paying subscriber with that email" }, 404);
      const p = await prefsFor(sub.user_id);
      const m = await build(sub, await shared(), p.unsub_token);
      return new Response(m.html, { headers: { "Content-Type": "text/html; charset=utf-8", "x-subject": encodeURIComponent(m.subject) } });
    }
    if (action === "test") return json(await send(String(body.email ?? ""), body.as === "plus" || body.as === "pro" ? body.as : undefined));
    if (action === "send") return json(await send());
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("digest failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 300) : "failed" }, 500);
  }
});
