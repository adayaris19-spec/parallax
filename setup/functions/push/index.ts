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
const DAILY = 3;
const KINDS = ["advance", "setback", "solved", "bottleneck", "promise"];
const LABEL: Record<string, string> = { advance: "Advance", setback: "Setback", solved: "Solved", bottleneck: "New bottleneck", promise: "Promise check" };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-parallax-admin", "Access-Control-Allow-Methods": "POST, OPTIONS" };
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
  const now = new Date().toISOString();
  const posts = await db(`posts?created_at=gt.${encodeURIComponent(since)}&kind=in.(${KINDS.join(",")})&select=id,goal_id,kind,headline,created_at&order=created_at.asc&limit=200`);
  await setCfg("push_last", now);
  if (!posts.length) return { posts: 0, sent: 0 };
  const goals = await db(`goals?select=id,slug,handle`);
  const slugOf = new Map(goals.map((g: { id: number; slug: string }) => [g.id, g.slug]));
  const handleOf = new Map(goals.map((g: { id: number; handle: string }) => [g.id, g.handle]));
  const slugs = [...new Set(posts.map((p: { goal_id: number }) => slugOf.get(p.goal_id)).filter(Boolean))];
  const subs = await db(`push_subscriptions?goals=ov.{${slugs.map((s) => `"${s}"`).join(",")}}&select=endpoint,p256dh,auth,goals,sent_day,sent_count`);
  const today = now.slice(0, 10);
  let sent = 0, gone = 0;
  for (const s of subs) {
    let count = s.sent_day === today ? s.sent_count : 0;
    // The most important first, one per goal per run.
    const mine = posts.filter((p: { goal_id: number }) => s.goals.includes(slugOf.get(p.goal_id)))
      .sort((a: { kind: string }, b: { kind: string }) => KINDS.indexOf(b.kind === "solved" ? "zz" : b.kind) - KINDS.indexOf(a.kind === "solved" ? "zz" : a.kind));
    const seen = new Set<number>();
    for (const p of mine) {
      if (count >= DAILY || seen.has(p.goal_id)) continue;
      seen.add(p.goal_id);
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({
          title: `@${handleOf.get(p.goal_id)} · ${LABEL[p.kind] ?? p.kind}`, body: p.headline, url: `${SITE}#/p/${p.id}`, tag: `p${p.id}`,
        }), { TTL: 24 * 3600 });
        count++; sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", prefer: "return=minimal" }); gone++; break; }
        console.error("push failed:", code, String(e).slice(0, 200));
      }
    }
    if (count !== (s.sent_day === today ? s.sent_count : 0)) await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "PATCH", prefer: "return=minimal", body: { sent_day: today, sent_count: count, last_sent_at: now } });
  }
  return { posts: posts.length, devices: subs.length, sent, removed: gone };
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
      if (!goals.length) { await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", prefer: "return=minimal" }); return json({ ok: true, goals: 0 }); }
      await db("push_subscriptions?on_conflict=endpoint", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { endpoint: s.endpoint, p256dh: k.p256dh.slice(0, 200), auth: k.auth.slice(0, 100), goals } });
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
