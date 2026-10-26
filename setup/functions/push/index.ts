// PARALLAX push — Supabase Edge Function named `push`. Web push alerts for followed goals (free).
//   POST {"action":"key"}                         the public key browsers subscribe with
//   POST {"action":"subscribe","sub":{...},"goals":["fusion"]}   save or update this device
//   POST {"action":"unsubscribe","endpoint":"..."}
//   POST {"action":"send"} + x-parallax-admin     every 15 minutes (cron): alert each device about new
//        advances, setbacks, solved problems, bottlenecks and promise checks on goals it follows,
//        at most 3 a day per device.
// The signing keys (VAPID) are made on first use and kept in app_config (private), so nothing needs
// setting up. No accounts: a device subscribes with the goals it follows.
import webpush from "npm:web-push@3.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const SITE = Deno.env.get("SITE_URL") ?? "https://adayaris19-spec.github.io/parallax/";
const DAILY = 3, DAILY_PAID = 6;
const PAID = ["active", "trialing", "comp"];
const KINDS = ["advance", "setback", "solved", "bottleneck", "promise"];
const LABEL: Record<string, string> = { advance: "Advance", setback: "Setback", solved: "Solved", bottleneck: "New bottleneck", promise: "Promise check" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-parallax-admin, x-user-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

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
const cfg = async (key: string) => (await db(`app_config?key=eq.${key}&select=value`))[0]?.value as string | undefined;
const setCfg = (key: string, value: string) => db("app_config?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key, value } });

async function userId(req: Request): Promise<string | null> {
  const token = (req.headers.get("x-user-token") ?? "").trim();
  if (!token) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!r || !r.ok) return null;
  return (await r.json())?.id ?? null;
}

async function keys() {
  let pub = await cfg("vapid_public"), priv = await cfg("vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    await setCfg("vapid_public", pub); await setCfg("vapid_private", priv);
  }
  return { pub, priv };
}

async function send() {
  const { pub, priv } = await keys();
  webpush.setVapidDetails(SITE, pub, priv);
  const since = (await cfg("push_last")) ?? new Date(Date.now() - 15 * 60_000).toISOString();
  const now = new Date().toISOString(), today = now.slice(0, 10);
  const [posts, goals, subs, paidRows, watch] = await Promise.all([
    db(`posts?created_at=gt.${encodeURIComponent(since)}&kind=in.(${KINDS.join(",")})&select=id,goal_id,kind,headline,created_at&order=created_at.asc&limit=200`),
    db(`goals?select=id,slug,handle`),
    db(`push_subscriptions?select=endpoint,p256dh,auth,goals,user_id,sent_day,sent_count&limit=50000`),
    db(`subscriptions?status=in.(${PAID.join(",")})&or=(plan.is.null,plan.neq.plus)&select=user_id`), // watchlists are Pro
    db(`watchlists?select=user_id,goals,rules`),
  ]);
  await setCfg("push_last", now);
  const bySlug = new Map(goals.map((g: { id: number; slug: string; handle: string }) => [g.slug, g]));
  const byId = new Map(goals.map((g: { id: number; slug: string; handle: string }) => [g.id, g]));
  const paid = new Set(paidRows.map((r: { user_id: string }) => r.user_id));
  // deno-lint-ignore no-explicit-any
  const watchOf = new Map<string, any>(watch.filter((w: { user_id: string }) => paid.has(w.user_id)).map((w: { user_id: string }) => [w.user_id, w]));

  // Watchlist extras (catalysts within 30 days, new opportunities), each sent once per person.
  type Extra = { key: string; goal: string; title: string; body: string; url: string };
  const extrasFor = new Map<string, Extra[]>();
  if (watchOf.size) {
    const soon = new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 7), thisYear = today.slice(0, 4);
    const [ev, proms, opps, sent] = await Promise.all([
      db(`node_evidence?source=eq.trials&select=goal_id,node_key,extra`),
      db(`promises?status=eq.pending&due_year=eq.${thisYear}&select=id,goal_id,node_key,claim`),
      db(`radar_opportunities?first_seen=gte.${new Date(Date.now() - 3 * 86_400_000).toISOString()}&select=goal_id,node_key`),
      db(`watch_alerts?user_id=in.(${[...watchOf.keys()].join(",")})&select=user_id,key`),
    ]);
    const done = new Set(sent.map((x: { user_id: string; key: string }) => `${x.user_id}|${x.key}`));
    // Ripples: a move (or a $5M+ grant) in the last 3 days on a problem shared with another goal.
    const since3 = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const [cross, rposts, rgrants] = await Promise.all([
      db("crossovers?source=neq.rejected&select=goal_a,key_a,goal_b,key_b,why&limit=5000").catch(() => []),
      db(`posts?created_at=gte.${since3}&kind=in.(advance,setback,solved,bottleneck)&select=id,goal_id,node_key,kind,headline,plain_headline&limit=200`).catch(() => []),
      db(`grant_awards?first_seen=gte.${since3}&amount=gte.5000000&node_key=not.is.null&select=goal_id,award_id,node_key,recipient,amount,url&limit=200`).catch(() => []),
    ]);
    type Rip = { key: string; to: number; from: number; title: string; body: string; url: string };
    const rips: Rip[] = [];
    const reach = (gid: number, key: string) => cross.flatMap((c: { goal_a: number; key_a: string; goal_b: number; key_b: string; why: string }) =>
      c.goal_a === gid && c.key_a === key ? [{ to: c.goal_b, why: c.why }] : c.goal_b === gid && c.key_b === key ? [{ to: c.goal_a, why: c.why }] : []);
    const usd = (x: number) => (x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : `$${(x / 1e6).toFixed(x >= 1e8 ? 0 : 1)}M`);
    for (const p of rposts) for (const r of reach(p.goal_id, p.node_key)) rips.push({ key: `rip:${p.id}:${r.to}`, to: r.to, from: p.goal_id, title: `Ripple from @${byId.get(p.goal_id)?.handle}`, body: `${p.plain_headline || p.headline} · ${r.why}`, url: `${SITE}#/p/${p.id}` });
    for (const a of rgrants) for (const r of reach(a.goal_id, a.node_key)) rips.push({ key: `ripg:${a.award_id}:${r.to}`, to: r.to, from: a.goal_id, title: `Ripple from @${byId.get(a.goal_id)?.handle}`, body: `${usd(Number(a.amount))} grant to ${String(a.recipient ?? "").split(" - ")[0]} · ${r.why}`, url: `${SITE}#/terminal/crossovers` });
    const nodes = opps.length ? await db(`nodes?or=(${opps.map((o: { goal_id: number; node_key: string }) => `and(goal_id.eq.${o.goal_id},key.eq.${o.node_key})`).join(",")})&select=goal_id,key,title,plain_title`) : [];
    for (const [uid, w] of watchOf) {
      const mine = new Set<number>((w.goals ?? []).map((sl: string) => bySlug.get(sl)?.id).filter(Boolean));
      const out: Extra[] = [];
      if (w.rules?.catalysts !== false) {
        for (const e of ev) if (mine.has(e.goal_id)) for (const t of e.extra?.upcoming ?? []) if (t.date <= soon) {
          out.push({ key: `trial:${t.nct}`, goal: byId.get(e.goal_id)!.handle, title: "Trial readout due", body: `${t.title} (${t.phase}) · due ${t.date}`, url: `https://clinicaltrials.gov/study/${t.nct}` });
        }
        for (const p of proms) if (mine.has(p.goal_id)) out.push({ key: `promise:${p.id}`, goal: byId.get(p.goal_id)!.handle, title: "Promise due this year", body: p.claim, url: `${SITE}#/g/${byId.get(p.goal_id)!.slug}/promises` });
      }
      if (w.rules?.ripples !== false) {
        // Moves on other goals that reach a watched goal (a move on a watched goal itself already alerts).
        for (const r of rips) if (mine.has(r.to) && !mine.has(r.from)) out.push({ key: r.key, goal: byId.get(r.to)!.handle, title: r.title, body: r.body.slice(0, 220), url: r.url });
      }
      if (w.rules?.opportunities !== false) {
        for (const o of opps) if (mine.has(o.goal_id)) {
          const n = nodes.find((x: { goal_id: number; key: string }) => x.goal_id === o.goal_id && x.key === o.node_key);
          out.push({ key: `opp:${o.goal_id}:${o.node_key}`, goal: byId.get(o.goal_id)!.handle, title: "New on the opportunity radar", body: n ? (n.plain_title || n.title) : "A problem entered the opportunity corner", url: `${SITE}#/terminal/radar` });
        }
      }
      extrasFor.set(uid, [...new Map(out.filter((x) => !done.has(`${uid}|${x.key}`)).map((x) => [x.key, x])).values()]);
    }
  }

  // Plus: "your call was settled", once per person per question (resolve function).
  const settled = await db(`prediction_results?resolved_at=gte.${new Date(Date.now() - 3 * 86_400_000).toISOString()}&select=key,outcome,note`).catch(() => []);
  if (settled.length) {
    const inList = settled.map((r: { key: string }) => `"${r.key}"`).join(",");
    const [calls, qs] = await Promise.all([
      db(`predictions?key=in.(${inList})&select=user_id,key,choice`),
      db(`prediction_questions?key=in.(${inList})&select=key,title,goal_id`),
    ]);
    const already = calls.length ? await db(`watch_alerts?user_id=in.(${[...new Set(calls.map((c: { user_id: string }) => c.user_id))].join(",")})&key=like.res:*&select=user_id,key`) : [];
    const done = new Set(already.map((x: { user_id: string; key: string }) => `${x.user_id}|${x.key}`));
    for (const c of calls) {
      const r = settled.find((x: { key: string }) => x.key === c.key), q = qs.find((x: { key: string }) => x.key === c.key);
      const g = q ? byId.get(q.goal_id) : null;
      if (!r || !g || done.has(`${c.user_id}|res:${c.key}`)) continue;
      const verdict = r.outcome === "void" ? "No result, your call doesn't count" : r.outcome === c.choice ? "You called it ✓" : "Not this time";
      const list = extrasFor.get(c.user_id) ?? [];
      list.unshift({ key: `res:${c.key}`, goal: g.handle, title: verdict, body: `${String(q.title).slice(0, 90)}: ${r.note ?? ""}`.slice(0, 220), url: `${SITE}#/plus` });
      extrasFor.set(c.user_id, list);
    }
  }

  let sent = 0, gone = 0;
  const marked = new Set<string>();
  for (const s of subs) {
    const w = s.user_id ? watchOf.get(s.user_id) : null;
    const goalSet = new Set<string>([...(s.goals ?? []), ...(w && w.rules?.signals !== false ? w.goals ?? [] : [])]);
    const cap = w ? DAILY_PAID : DAILY;
    let count = s.sent_day === today ? s.sent_count : 0;
    const start = count;
    // deno-lint-ignore no-explicit-any
    const queue: any[] = [];
    const seenGoal = new Set<number>();
    const order = (k: string) => ["solved", "advance", "setback", "bottleneck", "promise"].indexOf(k);
    for (const p of [...posts].sort((a: { kind: string }, b: { kind: string }) => order(a.kind) - order(b.kind))) {
      const g = byId.get(p.goal_id); if (!g || !goalSet.has(g.slug) || seenGoal.has(p.goal_id)) continue;
      seenGoal.add(p.goal_id);
      queue.push({ title: `@${g.handle} · ${LABEL[p.kind] ?? p.kind}`, body: p.headline, url: `${SITE}#/p/${p.id}`, tag: `p${p.id}` });
    }
    for (const x of (s.user_id && extrasFor.get(s.user_id)) || []) queue.push({ title: `@${x.goal} · ${x.title}`, body: x.body, url: x.url, tag: x.key, mark: x.key });
    for (const m of queue) {
      if (count >= cap) break;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag }), { TTL: 24 * 3600 });
        count++; sent++;
        if (m.mark && !marked.has(`${s.user_id}|${m.mark}`)) { marked.add(`${s.user_id}|${m.mark}`); await db("watch_alerts?on_conflict=user_id,key", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { user_id: s.user_id, key: m.mark } }); }
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", prefer: "return=minimal" }); gone++; break; }
        console.error("push failed:", code, String(e).slice(0, 200));
      }
    }
    if (count !== start) await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "PATCH", prefer: "return=minimal", body: { sent_day: today, sent_count: count, last_sent_at: now } });
  }
  return { posts: posts.length, devices: subs.length, watchers: watchOf.size, sent, removed: gone };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "key") return json({ key: (await keys()).pub });
    if (body.action === "subscribe") {
      const s = body.sub ?? {}, k = s.keys ?? {};
      if (typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000 || typeof k.p256dh !== "string" || typeof k.auth !== "string") return json({ error: "bad subscription" }, 400);
      const goals = (Array.isArray(body.goals) ? body.goals : []).filter((x: unknown) => typeof x === "string" && /^[a-z0-9-]{1,80}$/.test(x)).slice(0, 100);
      if (!goals.length && !(await userId(req))) { await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", prefer: "return=minimal" }); return json({ ok: true, goals: 0 }); }
      // Signed in: link the device to the person, so their Terminal watchlist reaches it too.
      const uid = await userId(req);
      await db("push_subscriptions?on_conflict=endpoint", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { endpoint: s.endpoint, p256dh: k.p256dh.slice(0, 200), auth: k.auth.slice(0, 100), goals, ...(uid ? { user_id: uid } : {}) } });
      return json({ ok: true, goals: goals.length });
    }
    if (body.action === "unsubscribe" && typeof body.endpoint === "string") {
      await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(body.endpoint)}`, { method: "DELETE", prefer: "return=minimal" });
      return json({ ok: true });
    }
    if (body.action === "send") {
      if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
      return json(await send());
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("push failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
