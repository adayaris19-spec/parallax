// PARALLAX terminal — Supabase Edge Function named `terminal`.
//
// The data behind the Parallax Terminal: every goal side by side, with progress,
// countdowns, bottlenecks, momentum and how well past promises held up, plus every
// open problem across every goal. Subscribers (status active, trialing or comp) get
// all of it; everyone else gets a preview with the rest counted but locked.
//
// Request: POST {} with the person's access token (or none, for the preview).
// Answer:  {access: "full" | "preview", kpis, blockers, goals, problems, history, ...}

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CENTS = Number(Deno.env.get("TERMINAL_PRICE_CENTS") ?? "4900");
const PREVIEW_GOALS = 3;
const PREVIEW_PROBLEMS = 6;
const DAY = 86_400_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function db(path: string): Promise<any[]> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
  if (!r.ok) throw new Error(`database ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function userId(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return typeof u?.id === "string" ? u.id : null;
}

const PAID = ["active", "trialing", "comp"];
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const uid = await userId(req);
    const sub = uid ? (await db(`subscriptions?user_id=eq.${uid}&select=status,current_period_end`))[0] : null;
    const status: string = sub?.status ?? "none";
    const full = PAID.includes(status);

    const since90 = new Date(Date.now() - 90 * DAY).toISOString();
    const [goals, nodes, posts, promises, followers, contributions, history] = await Promise.all([
      db("goals?status=eq.ready&select=id,slug,handle,name,progress,horizon_low,horizon_high,bottleneck_key,mapped_at,pulsed_at&order=name.asc&limit=2000"),
      db("nodes?select=goal_id,key,parent_key,title,status,blocker_kind,blocker,independent_sources,updated_at&limit=50000"),
      db(`posts?created_at=gte.${since90}&select=goal_id,kind,created_at&limit=50000`),
      db("promises?select=goal_id,status&limit=50000"),
      db("goal_followers?select=goal_id,followers"),
      db("contributions?select=goal_id,user_id&limit=50000"),
      db(`goal_snapshots?day=gte.${since90.slice(0, 10)}&select=goal_id,day,progress,solved,blocked,leaves&order=day.asc&limit=50000`).catch(() => []),
    ]);

    const byGoal = new Map<number, ReturnType<typeof blank>>();
    function blank() {
      return { leaves: 0, solved: 0, in_progress: 0, blocked: 0, open: 0, advances30: 0, setbacks30: 0, posts30: 0, posts90: 0,
        kept: 0, partly: 0, broken: 0, pending: 0, followers: 0, contributors: new Set<string>() };
    }
    for (const g of goals) byGoal.set(g.id, blank());
    const titles = new Map<string, string>();
    const blockers: Record<string, number> = {};
    const problems = [];
    const slugOf = new Map(goals.map((g) => [g.id, g]));

    for (const n of nodes) {
      const s = byGoal.get(n.goal_id);
      if (!s) continue;
      titles.set(`${n.goal_id}/${n.key}`, n.title);
      if (!n.parent_key) continue; // branches group leaves; the leaves are the problems
      s.leaves++;
      const st = ["solved", "in_progress", "blocked"].includes(n.status) ? n.status : "open";
      s[st as "solved"]++;
      if (st !== "solved") {
        const kind = n.blocker_kind && n.blocker_kind !== "none" ? n.blocker_kind : "unknown";
        blockers[kind] = (blockers[kind] ?? 0) + 1;
        const g = slugOf.get(n.goal_id)!;
        problems.push({
          goal: g.handle, slug: g.slug, key: n.key, title: n.title, status: st,
          blocker_kind: kind, blocker: n.blocker ?? "", sources: n.independent_sources ?? 0,
          bottleneck: g.bottleneck_key === n.key || (g.bottleneck_key && n.key.startsWith(`${g.bottleneck_key}.`)) ? true : false,
          updated_at: n.updated_at,
        });
      }
    }
    const cut30 = Date.now() - 30 * DAY;
    for (const p of posts) {
      const s = byGoal.get(p.goal_id);
      if (!s) continue;
      s.posts90++;
      if (new Date(p.created_at).getTime() < cut30) continue;
      s.posts30++;
      if (p.kind === "advance" || p.kind === "solved") s.advances30++;
      if (p.kind === "setback") s.setbacks30++;
    }
    for (const p of promises) {
      const s = byGoal.get(p.goal_id);
      if (s && ["kept", "partly", "broken", "pending"].includes(p.status)) s[p.status as "kept"]++;
    }
    for (const f of followers) { const s = byGoal.get(f.goal_id); if (s) s.followers = f.followers; }
    for (const c of contributions) byGoal.get(c.goal_id)?.contributors.add(c.user_id);

    const rows = goals.map((g) => {
      const s = byGoal.get(g.id)!;
      const judged = s.kept + s.partly + s.broken;
      return {
        id: g.id, handle: g.handle, slug: g.slug, name: g.name,
        progress: round(g.progress ?? (s.leaves ? s.solved / s.leaves : 0)),
        horizon_low: g.horizon_low, horizon_high: g.horizon_high,
        problems: s.leaves, solved: s.solved, in_progress: s.in_progress, blocked: s.blocked, open: s.open,
        bottleneck: g.bottleneck_key ? titles.get(`${g.id}/${g.bottleneck_key}`) ?? null : null,
        momentum: s.advances30 - s.setbacks30, advances30: s.advances30, setbacks30: s.setbacks30, posts30: s.posts30,
        promises_kept: s.kept, promises_partly: s.partly, promises_broken: s.broken, promises_pending: s.pending,
        promise_score: judged ? round((s.kept + 0.5 * s.partly) / judged, 2) : null,
        followers: s.followers, contributors: s.contributors.size,
        mapped_at: g.mapped_at, checked_at: g.pulsed_at ?? g.mapped_at,
      };
    });

    // Bottlenecks first, then blocked, then what is stuck longest.
    const rank = { blocked: 0, open: 1, in_progress: 2 } as Record<string, number>;
    problems.sort((a, b) => Number(b.bottleneck) - Number(a.bottleneck) || rank[a.status] - rank[b.status] || a.updated_at.localeCompare(b.updated_at));

    const leaves = rows.reduce((a, r) => a + r.problems, 0);
    const solved = rows.reduce((a, r) => a + r.solved, 0);
    const kept = rows.reduce((a, r) => a + r.promises_kept, 0), partly = rows.reduce((a, r) => a + r.promises_partly, 0), broken = rows.reduce((a, r) => a + r.promises_broken, 0);
    const kpis = {
      goals: rows.length,
      problems: leaves,
      solved_share: leaves ? round(solved / leaves) : 0,
      blocked: rows.reduce((a, r) => a + r.blocked, 0),
      advances30: rows.reduce((a, r) => a + r.advances30, 0),
      setbacks30: rows.reduce((a, r) => a + r.setbacks30, 0),
      promise_score: kept + partly + broken ? round((kept + 0.5 * partly) / (kept + partly + broken), 2) : null,
      promises_judged: kept + partly + broken,
    };

    const byMomentum = [...rows].sort((a, b) => b.momentum - a.momentum || b.posts30 - a.posts30);
    return json({
      access: full ? "full" : "preview",
      signed_in: !!uid,
      status,
      price: `$${(CENTS / 100).toFixed(CENTS % 100 ? 2 : 0)}/month`,
      generated_at: new Date().toISOString(),
      kpis,
      blockers: Object.entries(blockers).map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
      goals: full ? rows : byMomentum.slice(0, PREVIEW_GOALS),
      goals_total: rows.length,
      problems: full ? problems : problems.slice(0, PREVIEW_PROBLEMS),
      problems_total: problems.length,
      history: full ? history : [],
    });
  } catch (e) {
    console.error("terminal failed:", e instanceof Error ? e.message : e);
    return json({ error: "The Terminal could not load right now. Please try again in a minute." }, 500);
  }
});
