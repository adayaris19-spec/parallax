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
  const [wl, pushes, calls, all] = await Promise.all([
    db(`watchlists?user_id=eq.${sub.user_id}&select=goals`).catch(() => []),
    db(`push_subscriptions?user_id=eq.${sub.user_id}&select=goals`).catch(() => []),
    db(`predictions?user_id=eq.${sub.user_id}&select=key,choice`).catch(() => []),
    db("prediction_results?select=key,outcome").catch(() => []),
  ]);
  // Goals this person cares about (Pro watchlist, alert goals) come first everywhere.
  const mine = new Set<string>([...(wl[0]?.goals ?? []), ...pushes.flatMap((p: { goals: string[] }) => p.goals ?? [])]);
  // deno-lint-ignore no-explicit-any
  const first = (arr: any[]): any[] => [...arr].sort((a, b) => Number(mine.has(b.from?.slug ?? b.slug)) - Number(mine.has(a.from?.slug ?? a.slug)));
  const slugOfHandle = (h: string) => (t.goals ?? []).find((g: { handle: string }) => g.handle === String(h ?? "").replace(/^@/, ""))?.slug;
  const b = t.brief;
  const allRipples = first((t.crossovers?.ripples ?? []).filter((r: { at: string }) => new Date(r.at).getTime() >= since));
  const ripples = sub.pro ? allRipples.slice(0, 3) : allRipples.slice(0, 1); // Plus: the ripple of the week
  const grants = sub.pro ? first((t.money?.awards ?? []).filter((a: { first_seen: string }) => new Date(a.first_seen).getTime() >= since)) : [];
  const nextUp = first(t.catalysts ?? []).slice(0, 3);
  const settled = calls.map((c: { key: string; choice: string }) => ({ ...c, r: S.results.find((x: { key: string }) => x.key === c.key), q: S.questions.find((x: { key: string }) => x.key === c.key) })).filter((c: { r: unknown; q: unknown }) => c.r && c.q);
  const judged = calls.filter((c: { key: string }) => all.some((r: { key: string; outcome: string }) => r.key === c.key && r.outcome !== "void"));
  const right = judged.filter((c: { key: string; choice: string }) => all.find((r: { key: string }) => r.key === c.key)?.outcome === c.choice).length;
  // Call of the week: a trial readout due in the next ~4 months most people have called, else the next one.
  const myKeys = new Set(calls.map((c: { key: string }) => c.key));
  const keyOf = (c: { kind: string; url: string | null; title: string }) => (c.kind === "trial" ? `trial:${String(c.url ?? "").split("/").pop()}` : null);
  const soon = (t.catalysts ?? []).filter((c: { kind: string; date: string }) => c.kind === "trial" && /^\d{4}-\d{2}$/.test(c.date) && new Date(`${c.date}-28`).getTime() - Date.now() < 125 * DAY && new Date(`${c.date}-28`).getTime() > Date.now());
  const crowd = (k: string | null) => S.counts.find((x: { key: string }) => x.key === k) ?? { yes: 0, no: 0 };
  const cotw = [...soon].sort((a, c) => (crowd(keyOf(c)).yes + crowd(keyOf(c)).no) - (crowd(keyOf(a)).yes + crowd(keyOf(a)).no))[0];
  const home = sub.pro ? `${SITE}#/terminal` : `${SITE}#/plus`;

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
  const stats = [
    sub.pro ? [String(allRipples.length), "ripples"] : null,
    sub.pro ? [String(grants.length), "new $1M+ grants"] : null,
    sub.pro && grants.length ? [usd(grants.reduce((s2: number, a: { amount: number }) => s2 + a.amount, 0)), "in new grants"] : null,
    [String(calls.length), calls.length === 1 ? "call made" : "calls made"],
    judged.length ? [`${right}/${judged.length}`, "called right"] : null,
    [String((t.catalysts ?? []).length), "coming up"],
  ].filter(Boolean).slice(0, 4) as string[][];
  inner.push(section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SUNK};border-radius:14px"><tr>${stats.map(([n, l], i) => `<td align="center" style="padding:14px 6px;${i ? `border-left:1px solid ${LINE};` : ""}"><div style="font:800 24px/1.1 ${F};color:${INK}">${esc(n)}</div><div style="font:12px/1.3 ${F};color:${MUTED};margin-top:4px">${esc(l)}</div></td>`).join("")}</tr></table>`));

  // 3. Call of the week.
  if (cotw) {
    const k = keyOf(cotw), n = crowd(k), tot = n.yes + n.no, yes = tot ? Math.round(n.yes / tot * 100) : 0, phase = (String(cotw.detail ?? "").match(/Phase [0-9/ Phase]+/) ?? ["Phase 2"])[0].trim();
    const done = k && myKeys.has(k);
    inner.push(section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #C8CCFA;border-radius:16px;background:#F4F5FF"><tr><td style="padding:18px 20px">
      ${label(`Call of the week · results due ${esc(month(cotw.date))}`, ACC)}
      <div style="font:700 19px/1.3 ${F};color:${INK}">Will this ${esc(phase)} trial meet its main goal?</div>
      <div style="font:13.5px/1.45 ${F};color:${MUTED};margin:6px 0 14px">${esc(cotw.title)} · @${esc(cotw.goal)}</div>
      ${tot ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden"><tr><td width="${Math.max(yes, 1)}%" style="background:${GREEN};height:8px;font-size:0;line-height:0">&nbsp;</td><td width="${Math.max(100 - yes, 1)}%" style="background:${RED};height:8px;font-size:0;line-height:0">&nbsp;</td></tr></table><div style="font:12.5px/1.4 ${F};color:${MUTED};margin:6px 0 14px">${yes}% say yes · ${tot} call${tot === 1 ? "" : "s"}</div>` : `<div style="font:12.5px/1.4 ${F};color:${MUTED};margin:0 0 14px">Nobody has called it yet. Be the first.</div>`}
      ${done ? `<div style="font:600 14px/1.4 ${F};color:${INK2}">You’ve made your call. <a href="${SITE}#/plus" style="color:${ACC}">See it →</a></div>` : `${button(`${SITE}#/plus`, "Yes", GREEN)}&nbsp;&nbsp;${button(`${SITE}#/plus`, "No", RED)}`}
      </td></tr></table>`));
  }

  // 4. Ripples, with goal pictures.
  if (ripples.length) inner.push(section(`${label(sub.pro ? `Ripples · moves that reached another goal` : "Ripple of the week")}${ripples.map((r: { headline: string; post?: number; kind: string; from: { goal: string; slug: string }; affects: { goal: string; slug: string; title: string }[] }) => {
    const to = [...new Map(r.affects.map((a) => [a.goal, a])).values()].slice(0, 2);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE}"><tr>
      <td width="52" valign="top" style="padding:14px 0">${avatar(r.from.slug)}</td>
      <td valign="top" style="padding:14px 0">${chip(r.kind === "grant" ? "Big grant" : r.kind === "setback" ? "Setback" : r.kind === "bottleneck" ? "Bottleneck" : "Advance", r.kind === "setback" ? "#FDECEC" : r.kind === "grant" ? "#EEF0FF" : "#E8F5EE", r.kind === "setback" ? RED : r.kind === "grant" ? ACC : GREEN)}
        <div style="font:600 16px/1.35 ${F};color:${INK};margin:8px 0 6px">${r.post ? `<a href="${SITE}#/p/${r.post}" style="color:${INK};text-decoration:none">${esc(r.headline)}</a>` : esc(r.headline)}</div>
        <div style="font:13.5px/1.45 ${F};color:${MUTED}">@${esc(r.from.goal)} <span style="color:${ACC}">→</span> also moves ${to.map((a) => `<b style="color:${INK2}">@${esc(a.goal)}</b>`).join(" and ")}</div></td>
      <td width="${to.length * 30 + 6}" valign="top" align="right" style="padding:14px 0 0 8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${to.map((a) => `<td style="padding-left:4px">${avatar(a.slug, 26)}</td>`).join("")}</tr></table></td></tr></table>`;
  }).join("")}`));

  // 5. Money (Pro): a small bar chart of funding by goal, then the biggest new grants.
  if (sub.pro && t.money?.goals?.length) {
    const top = (t.money.goals as { goal: string; slug: string; last4: number; change: number | null }[]).filter((g) => g.last4 > 0).slice(0, 5), max = Math.max(1, ...top.map((g) => g.last4));
    inner.push(section(`${label("Federal grant money, last 12 months")}${top.map((g) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px"><tr>
      <td width="34" valign="middle">${avatar(g.slug, 26)}</td><td width="128" valign="middle" style="font:600 13px/1.2 ${F};color:${INK}">@${esc(g.goal)}</td>
      <td valign="middle"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="${Math.max(2, Math.round(g.last4 / max * 100))}%" style="background:${mine.has(g.slug) ? ACC : INK};height:12px;border-radius:4px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0">&nbsp;</td></tr></table></td>
      <td width="64" align="right" valign="middle" style="font:600 13px/1 ${F};color:${INK}">${usd(g.last4)}</td>
      <td width="52" align="right" valign="middle" style="font:600 12px/1 ${F};color:${g.change == null ? MUTED : g.change > 0 ? GREEN : RED}">${g.change == null ? "—" : `${g.change > 0 ? "▲" : "▼"}${Math.round(Math.abs(g.change) * 100)}%`}</td></tr></table>`).join("")}
      ${grants.length ? `<div style="margin-top:16px">${grants.slice(0, 3).map((a: { amount: number; recipient: string; goal: string; slug: string; title: string }) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE}"><tr>
        <td width="86" valign="top" style="padding:12px 0;font:800 18px/1.2 ${F};color:${INK}">${usd(a.amount)}</td>
        <td valign="top" style="padding:12px 0"><div style="font:600 14px/1.35 ${F};color:${INK}">${esc(a.recipient)}</div><div style="font:13px/1.45 ${F};color:${MUTED}">@${esc(a.goal)} · ${esc((() => { const x = calm(a.title); return x.length > 90 ? `${x.slice(0, 88).replace(/\s+\S*$/, "")}…` : x; })())}</div></td></tr></table>`).join("")}</div>` : ""}`));
  }

  // 6. Your calls, settled this week.
  if (settled.length) inner.push(section(`${label("Your calls, settled")}${settled.map((c: { choice: string; r: { outcome: string; note: string }; q: { title: string; question: string } }) => {
    const ok = c.r.outcome === c.choice, none = c.r.outcome === "void";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE}"><tr>
      <td width="44" valign="top" style="padding:14px 0"><div style="width:32px;height:32px;border-radius:50%;background:${none ? SUNK : ok ? "#E8F5EE" : "#FDECEC"};color:${none ? MUTED : ok ? GREEN : RED};font:700 16px/32px ${F};text-align:center">${none ? "–" : ok ? "✓" : "✗"}</div></td>
      <td valign="top" style="padding:14px 0"><div style="font:600 15px/1.35 ${F};color:${INK}">${none ? "No result" : ok ? "You called it" : "Not this time"}: ${esc(c.q.question)}</div><div style="font:13px/1.45 ${F};color:${MUTED};margin-top:3px">${esc(c.q.title)}. ${esc(c.r.note ?? "")}</div></td></tr></table>`;
  }).join("")}`));

  // 7. Coming up, as date tiles.
  if (nextUp.length) inner.push(section(`${label("Coming up")}${nextUp.map((c: { date: string; title: string; goal: string; kind: string }) => {
    const d = /^\d{4}-\d{2}$/.test(c.date) ? new Date(`${c.date}-15`) : null;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>
      <td width="64" valign="top"><table role="presentation" width="52" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:10px;overflow:hidden"><tr><td align="center" style="background:${ACC};color:#FFFFFF;font:700 10px/1 ${F};letter-spacing:.08em;padding:5px 0">${d ? d.toLocaleDateString("en-US", { month: "short" }).toUpperCase() : "DUE"}</td></tr><tr><td align="center" style="font:800 17px/1 ${F};color:${INK};padding:8px 0">’${d ? String(d.getFullYear()).slice(2) : esc(c.date).slice(2)}</td></tr></table></td>
      <td valign="top" style="padding-top:2px"><div style="font:600 14.5px/1.35 ${F};color:${INK}">${esc(c.title)}</div><div style="font:13px/1.4 ${F};color:${MUTED};margin-top:3px">@${esc(c.goal)} · ${c.kind === "trial" ? "trial readout" : "promise due"}</div></td></tr></table>`;
  }).join("")}`));

  inner.push(section(`<div style="text-align:center;padding:6px 0 4px">${button(home, sub.pro ? "Open Parallax Pro →" : "Open your week →", ACC)}</div>`));
  const unsub = `${FN}?action=unsub&t=${token}`;
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const subject = b?.headline ? `Your week: ${b.headline}` : `Your week in progress · ${date}`;
  const pre = `${sub.pro ? `${allRipples.length} ripples, ${grants.length} new big grants` : "Your call of the week"}, and what's coming up.`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#FAFAF9"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px"><tr><td style="padding:0 4px 12px;font:700 15px/1 ${F};color:${INK}">Parallax <span style="color:${MUTED};font-weight:400">${sub.pro ? "Pro" : "Plus"}</span></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#FFFFFF;border:1px solid ${LINE};border-radius:18px">
${blocks.join("")}
<tr><td style="padding:0 28px 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner.join("")}</table></td></tr>
</table>
<p style="max-width:560px;font:12px/1.55 ${F};color:#A3A6AD;margin:16px auto 0;text-align:center">You get this because you subscribe to Parallax ${sub.pro ? "Pro" : "Plus"}. One email a week, on Mondays.<br><a href="${unsub}" style="color:${MUTED}">Unsubscribe</a> · <a href="${SITE}#/${sub.pro ? "terminal/calendar" : "plus"}" style="color:${MUTED}">Email settings</a></p>
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
