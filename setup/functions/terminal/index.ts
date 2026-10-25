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
const DAY = 86_400_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
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

// How fresh the research behind a problem is: its newest paper, and how many came out in the last 3 years.
// deno-lint-ignore no-explicit-any
function paperAges(evidence: any[] | null) {
  const years = (evidence ?? []).map((e) => e?.year).filter((y) => Number.isInteger(y)) as number[];
  const now = new Date().getUTCFullYear();
  return { papers: years.length, newest: years.length ? Math.max(...years) : null, recent: years.filter((y) => y >= now - 2).length };
}
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const uid = await userId(req);
    const sub = uid ? (await db(`subscriptions?user_id=eq.${uid}&select=status,current_period_end`))[0] : null;
    const status: string = sub?.status ?? "none";
    const admin = Deno.env.get("ADMIN_TOKEN");
    const full = PAID.includes(status) || (!!admin && req.headers.get("x-admin-token") === admin); // admin: for testing the full view

    const since90 = new Date(Date.now() - 90 * DAY).toISOString();
    const [goals, nodes, posts, promises, followers, contributions, history, intel, briefs] = await Promise.all([
      db("goals?status=eq.ready&select=id,slug,handle,name,papers_count,progress,horizon_low,horizon_high,bottleneck_key,mapped_at,pulsed_at&order=name.asc&limit=2000"),
      db("nodes?select=goal_id,key,parent_key,title,plain_title,status,blocker_kind,blocker,plain_blocker,independent_sources,updated_at,evidence&limit=50000"),
      db(`posts?created_at=gte.${since90}&select=goal_id,node_key,kind,headline,plain_headline,independent_sources,created_at&order=created_at.desc&limit=50000`),
      db("promises?select=goal_id,status&limit=50000"),
      db("goal_followers?select=goal_id,followers"),
      db("contributions?select=goal_id,user_id&limit=50000"),
      db(`goal_snapshots?day=gte.${since90.slice(0, 10)}&select=goal_id,day,progress,solved,blocked,leaves&order=day.asc&limit=50000`).catch(() => []),
      db("goal_intel?select=goal_id,years,growth,papers_3y,institutions,countries,updated_at").catch(() => []),
      db("briefs?select=week,content,signals,created_at&order=id.desc&limit=1").catch(() => []),
    ]);

    const byGoal = new Map<number, ReturnType<typeof blank>>();
    function blank() {
      return { leaves: 0, solved: 0, in_progress: 0, blocked: 0, open: 0, advances30: 0, setbacks30: 0, posts30: 0, posts90: 0,
        kept: 0, partly: 0, broken: 0, pending: 0, followers: 0, contributors: new Set<string>() };
    }
    for (const g of goals) byGoal.set(g.id, blank());
    const titles = new Map<string, string>();
    const blockers: Record<string, number> = {};
    // deno-lint-ignore no-explicit-any
    const problems: any[] = [];
    const slugOf = new Map(goals.map((g) => [g.id, g]));

    const papers = new Map<string, number>(); // paper id -> year, counted once across all goals
    const goalPapers = new Map<number, Set<string>>();
    const matrix: Record<string, Record<string, number>> = {};
    for (const n of nodes) {
      // Plain-language versions first (see the simplify function).
      n.title = n.plain_title || n.title;
      n.blocker = n.plain_blocker || n.blocker;
      const s = byGoal.get(n.goal_id);
      if (!s) continue;
      for (const e of n.evidence ?? []) {
        const id = String(e.id ?? e.url ?? e.title ?? "");
        if (!id) continue;
        if (Number.isInteger(e.year)) papers.set(id, e.year);
        if (!goalPapers.has(n.goal_id)) goalPapers.set(n.goal_id, new Set());
        goalPapers.get(n.goal_id)!.add(id);
      }
      titles.set(`${n.goal_id}/${n.key}`, n.title);
      if (!n.parent_key) continue; // branches group leaves; the leaves are the problems
      s.leaves++;
      const st = ["solved", "in_progress", "blocked"].includes(n.status) ? n.status : "open";
      s[st as "solved"]++;
      if (st !== "solved") {
        const kind = n.blocker_kind && n.blocker_kind !== "none" ? n.blocker_kind : "unknown";
        blockers[kind] = (blockers[kind] ?? 0) + 1;
        const g = slugOf.get(n.goal_id)!;
        (matrix[g.slug] ??= {})[kind] = (matrix[g.slug]?.[kind] ?? 0) + 1;
        problems.push({
          goal: g.handle, slug: g.slug, key: n.key, title: n.title, status: st,
          blocker_kind: kind, blocker: n.blocker ?? "", sources: n.independent_sources ?? 0,
          bottleneck: g.bottleneck_key === n.key || (g.bottleneck_key && n.key.startsWith(`${g.bottleneck_key}.`)) ? true : false,
          updated_at: n.updated_at,
          ...paperAges(n.evidence),
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
        followers: s.followers, contributors: s.contributors.size, papers: g.papers_count ?? goalPapers.get(g.id)?.size ?? 0,
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

    // Research activity: distinct papers behind the map, by year published.
    const thisYear = new Date().getUTCFullYear();
    const years: { year: number; papers: number }[] = [];
    for (let y = thisYear - 24; y <= thisYear; y++) years.push({ year: y, papers: 0 });
    // The whole library (see the library function); falls back to the papers the map cites.
    const lib: { year: number; papers: number }[] = await db("library_years?select=year,papers").catch(() => []);
    if (lib.length) for (const r of lib) { const row = years.find((x) => x.year === r.year); if (row) row.papers = r.papers; }
    else for (const y of papers.values()) { const row = years.find((r) => r.year === y); if (row) row.papers++; }
    const libTotal = lib.reduce((t, r) => t + r.papers, 0);
    const sum = (a: number, b: number) => years.filter((r) => r.year >= a && r.year <= b).reduce((t, r) => t + r.papers, 0);
    const recent = sum(thisYear - 5, thisYear - 1), before = sum(thisYear - 10, thisYear - 6); // full years only
    const research = { years, papers: libTotal || papers.size, recent5: recent, prior5: before, growth: before ? round(recent / before - 1, 2) : null };

    // The Parallax Index: average progress across every goal, 0-100.
    const index = rows.length ? round(rows.reduce((a, r) => a + (r.progress ?? 0), 0) / rows.length * 100, 1) : 0;
    const snapDays = [...new Set(history.map((h: { day: string }) => h.day))].sort();
    const indexHistory = snapDays.map((day) => {
      const pts = history.filter((h: { day: string }) => h.day === day);
      return { day, value: round(pts.reduce((a: number, p: { progress: number }) => a + (p.progress ?? 0), 0) / Math.max(1, pts.length) * 100, 1) };
    });

    const goalBy = new Map(goals.map((g) => [g.id, g]));
    const tape = posts.filter((p) => p.kind !== "mapped").slice(0, 60).map((p) => ({
      kind: p.kind, headline: p.plain_headline || p.headline, sources: p.independent_sources ?? 0, at: p.created_at,
      goal: goalBy.get(p.goal_id)?.handle ?? "", slug: goalBy.get(p.goal_id)?.slug ?? "", key: p.node_key,
    })).filter((p) => p.slug);

    const bottlenecks = rows.filter((r) => r.bottleneck).map((r) => {
      const pr = problems.find((p) => p.slug === r.slug && p.bottleneck);
      return { goal: r.handle, slug: r.slug, title: r.bottleneck, kind: pr?.blocker_kind ?? "unknown", why: pr?.blocker ?? "", sources: pr?.sources ?? 0,
        status: pr?.status ?? "open", horizon_low: r.horizon_low, horizon_high: r.horizon_high, key: pr?.key ?? null };
    });

    // Opportunities, from the problems' own research.
    const thisYr = new Date().getUTCFullYear();
    const funding = problems.filter((p) => p.blocker_kind === "funding").slice(0, 12);
    const quiet = problems.filter((p) => p.newest != null && p.newest <= thisYr - 5 && p.papers >= 1)
      .sort((a, b) => a.newest - b.newest).slice(0, 12);
    const hot = problems.filter((p) => p.recent >= 2).sort((a, b) => b.recent - a.recent || b.sources - a.sources).slice(0, 12);

    // Who leads each field (whole-field OpenAlex counts, refreshed weekly).
    // deno-lint-ignore no-explicit-any
    const fields: any[] = intel.map((i: { goal_id: number; years: { year: number; papers: number }[]; growth: number | null; papers_3y: number; institutions: unknown[]; countries: unknown[]; updated_at: string }) => {
      const g = goalBy.get(i.goal_id);
      return g ? { goal: g.handle, slug: g.slug, growth: i.growth, papers_3y: i.papers_3y, years: i.years, institutions: i.institutions.slice(0, 6), countries: i.countries.slice(0, 6), updated_at: i.updated_at } : null;
    }).filter(Boolean).sort((a, b) => b!.papers_3y - a!.papers_3y);
    for (const r of rows) {
      const f = fields.find((x) => x.slug === r.slug);
      Object.assign(r, { field_growth: f?.growth ?? null, field_papers_3y: f?.papers_3y ?? null });
    }
    const brief = briefs[0] ? { week: briefs[0].week, signals: briefs[0].signals, ...briefs[0].content } : null;

    return json({
      access: full ? "full" : "preview",
      signed_in: !!uid,
      status,
      price: `$${(CENTS / 100).toFixed(CENTS % 100 ? 2 : 0)}/month`,
      generated_at: new Date().toISOString(),
      kpis,
      blockers: Object.entries(blockers).map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
      goals: full ? rows : [], // the tables are for subscribers only
      goals_total: rows.length,
      problems: full ? problems : [],
      problems_total: problems.length,
      history: full ? history : [],
      index, index_history: full ? indexHistory : [],
      research,
      tape: full ? tape : tape.slice(0, 4),
      tape_total: tape.length,
      matrix: full ? matrix : {},
      bottlenecks: full ? bottlenecks : [],
      bottlenecks_total: full ? bottlenecks.length : null,
      brief: brief ? (full ? brief : { week: brief.week }) : null, // locked sections reveal nothing
      opportunities: full ? { funding, quiet, hot } : null,
      opportunity_counts: full ? { funding: funding.length, quiet: quiet.length, hot: hot.length } : null,
      fields: full ? fields : [],
      fields_total: fields.length,
    });
  } catch (e) {
    console.error("terminal failed:", e instanceof Error ? e.message : e);
    return json({ error: "The Terminal could not load right now. Please try again in a minute." }, 500);
  }
});
