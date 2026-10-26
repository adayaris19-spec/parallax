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

// Opportunity radar: unsolved problems by public funding (x) and research growth (y). Heating up
// with little funding is where money would go furthest.
// deno-lint-ignore no-explicit-any
function radarPoints(problems: any[]) {
  const pts = problems.filter((p) => p.growth != null && (p.papers_last ?? 0) >= 5);
  // Opportunity: research growth in the top third and funding in the bottom third (most fields
  // grow, so "growing" alone means little).
  const q = (arr: number[], f: number) => { const v = [...arr].sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) * f)] : 0; };
  // "No matching grants" is not evidence of little funding (the search may just miss it), so only
  // problems with some matched funding can be opportunities.
  const growthTop = q(pts.map((p) => p.growth), 0.67), fundLow = q(pts.filter((p) => p.funding > 0).map((p) => p.funding), 0.33);
  return pts.map((p) => ({
    goal: p.goal, slug: p.slug, key: p.key, title: p.title, status: p.status,
    x: p.funding, y: p.growth, size: p.papers_last, terms: p.funding_terms,
    opportunity: p.funding > 0 && p.growth >= growthTop && p.funding <= fundLow,
  })).sort((a, b) => Number(b.opportunity) - Number(a.opportunity) || b.y - a.y);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const uid = await userId(req);
    const sub = uid ? (await db(`subscriptions?user_id=eq.${uid}&select=status,plan,current_period_end`))[0] : null;
    const status: string = sub?.status ?? "none";
    const admin = Deno.env.get("ADMIN_TOKEN");
    // The Terminal is Pro: a Plus subscription alone doesn't open it.
    const full = (PAID.includes(status) && sub?.plan !== "plus") || (!!admin && req.headers.get("x-admin-token") === admin); // admin: for testing the full view

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
    // Research volume, public funding, trials and promises: for the goal index, radar and calendar.
    const Y1 = new Date().getUTCFullYear() - 1;
    const [fieldYears, evidence, duePromises] = await Promise.all([
      db(`node_field_years?year=gte.${Y1 - 5}&year=lte.${Y1}&select=goal_id,node_key,year,n&limit=50000`).catch(() => []),
      db("node_evidence?select=goal_id,node_key,source,count,amount_cents,extra&limit=20000").catch(() => []),
      db(`promises?status=eq.pending&due_year=gte.${Y1 + 1}&due_year=lte.${Y1 + 3}&select=goal_id,node_key,claim,made_year,due_year&order=due_year.asc&limit=500`).catch(() => []),
    ]);
    // Pro-only data the free site never shows (market and evidence functions).
    const [money, awardRows, pipeRows] = await Promise.all([
      db("goal_money?select=goal_id,quarters,recipients,updated_at").catch(() => []),
      db("grant_awards?select=goal_id,award_id,node_key,recipient,agency,amount,start_date,description,url,first_seen&order=amount.desc&limit=3000").catch(() => []),
      db("trial_pipeline?select=goal_id,nct,node_key,title,phase,status,sponsor,sponsor_class,completion,enrollment&limit=30000").catch(() => []),
    ]);
    const fy = new Map<string, { recent: number; prior: number; last: number }>();
    for (const r of fieldYears) {
      const k = `${r.goal_id}/${r.node_key}`, v = fy.get(k) ?? { recent: 0, prior: 0, last: 0 };
      if (r.year > Y1 - 3) v.recent += r.n; else v.prior += r.n;
      if (r.year === Y1) v.last = r.n;
      fy.set(k, v);
    }
    const ev = new Map<string, { grants?: any; trials?: any }>(); // deno-lint-ignore no-explicit-any
    for (const e of evidence) { const k = `${e.goal_id}/${e.node_key}`; ev.set(k, { ...(ev.get(k) ?? {}), [e.source]: e }); }
    // Catalysts: Phase 2/3 trial readouts due in the next 18 months, and promises coming due.
    const goalOf = new Map(goals.map((g) => [g.id, g]));
    // deno-lint-ignore no-explicit-any
    const catalysts: any[] = [];
    const seenTrial = new Set<string>();
    for (const e of evidence) {
      if (e.source !== "trials") continue;
      for (const t of e.extra?.upcoming ?? []) {
        if (seenTrial.has(t.nct)) continue; seenTrial.add(t.nct);
        const g = goalOf.get(e.goal_id); if (!g) continue;
        catalysts.push({ kind: "trial", date: t.date, goal_id: g.id, goal: g.handle, slug: g.slug, key: e.node_key, title: t.title, detail: [t.phase, t.sponsor].filter(Boolean).join(" · "), url: `https://clinicaltrials.gov/study/${t.nct}` });
      }
    }
    for (const p of duePromises) {
      const g = goalOf.get(p.goal_id); if (!g) continue;
      catalysts.push({ kind: "promise", date: String(p.due_year), goal_id: g.id, goal: g.handle, slug: g.slug, key: p.node_key, title: p.claim, detail: `Promised in ${p.made_year}`, url: null });
    }
    catalysts.sort((a, b) => a.date.localeCompare(b.date));

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
          ...problemMetrics(n.goal_id, n.key),
        });
      }
    }
    const cut30 = Date.now() - 30 * DAY;
    // Goal-level figures that don't double-count: papers and growth from the goal-wide research search
    // (goal_intel), and how many of the goal's problems have federal funding or trials.
    function goalMetrics(goalId: number) {
      const it = intel.find((i: { goal_id: number }) => i.goal_id === goalId);
      const last = it?.years?.find((y: { year: number }) => y.year === Y1)?.papers ?? null;
      let funded = 0, withTrials = 0;
      for (const [k, v] of ev) if (k.startsWith(`${goalId}/`)) { if (v.grants) funded++; if (v.trials) withTrials++; }
      return {
        papers_last: last, field_growth3: it?.growth ?? null, funded_problems: funded, trial_problems: withTrials,
        catalysts: catalysts.filter((c) => c.goal_id === goalId).length,
      };
    }
    function problemMetrics(goalId: number, key: string) {
      const f = fy.get(`${goalId}/${key}`), e = ev.get(`${goalId}/${key}`);
      return {
        papers_last: f?.last ?? null, growth: f && f.prior >= 10 ? round(f.recent / f.prior - 1, 2) : null,
        funding: e?.grants ? Math.round(e.grants.amount_cents / 100) : 0, grants: e?.grants?.count ?? 0, funding_terms: e?.grants?.extra?.terms ?? null,
        trials: e?.trials?.count ?? 0,
      };
    }
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
        ...goalMetrics(g.id),
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
      solved,
      moving: rows.reduce((a, r) => a + r.in_progress, 0),
      open: rows.reduce((a, r) => a + r.open, 0),
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

    // The answer first: a few plain facts per section, for scanning. Goal-level facts only (they are
    // safe to show visitors too); named problems are added for subscribers.
    const by = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((a: T | null, x) => (a == null || f(x) > f(a) ? x : a), null);
    const fastest = by(rows.filter((r) => r.field_growth3 != null), (r) => r.field_growth3 ?? 0);
    const mostCat = by(rows, (r) => r.catalysts ?? 0);
    const bestMom = by(rows, (r) => r.momentum);
    const mostBlocked = by(rows, (r) => r.blocked);
    const kindCount: Record<string, number> = {};
    for (const b of bottlenecks) kindCount[b.kind] = (kindCount[b.kind] ?? 0) + 1;
    const topKind = Object.entries(kindCount).sort((a, b) => b[1] - a[1])[0];
    const leadCount: Record<string, number> = {};
    for (const f of fields) { const c = (f.countries as { code: string; name?: string }[])[0]; if (c) leadCount[c.name ?? c.code] = (leadCount[c.name ?? c.code] ?? 0) + 1; }
    const topCountry = Object.entries(leadCount).sort((a, b) => b[1] - a[1])[0];
    const fastestField = by(fields.filter((f) => f.growth != null), (f) => f.growth ?? 0);
    const radarAll = radarPoints(problems), oppAll = radarAll.filter((r) => r.opportunity);
    const in90 = new Date(Date.now() + 90 * DAY).toISOString().slice(0, 7);
    const answers = {
      index: [
        fastest ? `Fastest-growing field: @${fastest.handle}, ${Math.round((fastest.field_growth3 ?? 0) * 100)}% more papers than 3 years before.` : null,
        mostCat?.catalysts ? `Most catalysts ahead: @${mostCat.handle} (${mostCat.catalysts}).` : null,
        bestMom && bestMom.momentum > 0 ? `Best month: @${bestMom.handle}, ${bestMom.advances30} advance${bestMom.advances30 === 1 ? "" : "s"} vs ${bestMom.setbacks30} setback${bestMom.setbacks30 === 1 ? "" : "s"}.` : null,
        mostBlocked?.blocked ? `Most stuck: @${mostBlocked.handle}, ${mostBlocked.blocked} blocked problem${mostBlocked.blocked === 1 ? "" : "s"}.` : null,
      ].filter(Boolean),
      radar: [
        `${oppAll.length} problem${oppAll.length === 1 ? " is" : "s are"} heating up while public money stays thin.`,
        full && oppAll[0] ? `Biggest: ${oppAll[0].title} (@${oppAll[0].goal}), research +${Math.round(oppAll[0].y * 100)}% on ${oppAll[0].x ? "about " + (oppAll[0].x >= 1e6 ? `$${(oppAll[0].x / 1e6).toFixed(1)}M` : `$${Math.round(oppAll[0].x / 1e3)}K`) : "no matched"} federal grants.` : null,
      ].filter(Boolean),
      calendar: [
        catalysts[0] ? `Next up: ${full ? catalysts[0].title.slice(0, 90) : "a " + (catalysts[0].kind === "trial" ? "trial readout" : "promise")} (@${catalysts[0].goal}), due ${/^\d{4}-\d{2}$/.test(catalysts[0].date) ? new Date(`${catalysts[0].date}-15`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : catalysts[0].date}.` : null,
        `${catalysts.filter((c) => c.date <= in90).length} catalysts in the next 90 days, ${catalysts.length} in total.`,
      ].filter(Boolean),
      leaders: [
        topCountry ? `${topCountry[0]} publishes the most on ${topCountry[1]} of ${fields.length} goals.` : null,
        fastestField ? `Fastest-growing field: @${fastestField.goal} (+${Math.round((fastestField.growth ?? 0) * 100)}% in 3 years).` : null,
      ].filter(Boolean),
      bottlenecks: [
        topKind ? `Most bottlenecks wait on ${topKind[0] === "knowledge" ? "knowledge (we don't yet know how)" : topKind[0]}: ${topKind[1]} of ${bottlenecks.length} goals.` : null,
        mostBlocked?.blocked ? `@${mostBlocked.handle} has the most blocked problems (${mostBlocked.blocked}).` : null,
      ].filter(Boolean),
      opportunities: [`${funding.length} problems are held back mainly by money, ${quiet.length} have gone quiet, ${hot.length} are heating up.`],
    };

    // ---- Money flows: federal grant money per goal by quarter, and new $1M+ grants (last 90 days).
    const now = new Date(), m = now.getUTCMonth() + 1;
    const curFY = m >= 10 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(), curQ = Math.floor(((m - 10 + 12) % 12) / 3) + 1;
    const qIndex = (fy: number, q: number) => fy * 4 + q;
    const short = (d: string) => String(d ?? "").split(/ -|PROJECT SUMMARY|ABSTRACT|PURPOSE:/i)[0].replace(/\s+/g, " ").trim().slice(0, 140);
    // deno-lint-ignore no-explicit-any
    const moneyGoals: any[] = money.map((mg: { goal_id: number; quarters: { fy: number; q: number; amount: number }[]; recipients: unknown[] }) => {
      const g = goalOf.get(mg.goal_id); if (!g) return null;
      // Full quarters only (the current one is still filling up).
      const qs = [...mg.quarters].filter((x) => qIndex(x.fy, x.q) < qIndex(curFY, curQ)).sort((a, b) => qIndex(a.fy, a.q) - qIndex(b.fy, b.q));
      const last4 = qs.slice(-4).reduce((t, x) => t + x.amount, 0), prior4 = qs.slice(-8, -4).reduce((t, x) => t + x.amount, 0);
      const mine = awardRows.filter((a: { goal_id: number }) => a.goal_id === mg.goal_id);
      return { goal: g.handle, slug: g.slug, quarters: qs.slice(-12).map((x) => ({ label: `FY${String(x.fy).slice(2)} Q${x.q}`, amount: x.amount })),
        last4, prior4, change: prior4 > 0 && last4 > 0 ? round(last4 / prior4 - 1, 2) : null, new_awards: mine.length, new_sum: mine.reduce((t: number, a: { amount: number }) => t + Number(a.amount), 0) };
    }).filter(Boolean).sort((a, b) => b!.last4 - a!.last4);
    // deno-lint-ignore no-explicit-any
    const awards: any[] = awardRows.map((a: { goal_id: number; node_key: string | null; recipient: string; agency: string; amount: number; start_date: string; description: string; url: string; first_seen: string }) => {
      const g = goalOf.get(a.goal_id); if (!g) return null;
      return { goal: g.handle, slug: g.slug, key: a.node_key, problem: a.node_key ? titles.get(`${a.goal_id}/${a.node_key}`) ?? null : null,
        recipient: String(a.recipient ?? "").replace(/^the /i, "").replace(/,? the$/i, "").split(" - ")[0], agency: a.agency, amount: Number(a.amount), title: short(a.description), url: a.url, first_seen: a.first_seen };
    }).filter(Boolean);

    // ---- The race: who is putting the most into each goal. Grant money (last 12 months, with rank a
    // year earlier), active trials they sponsor and papers (last 3 years), one row per organization.
    const norm = (n: string) => String(n ?? "").toLowerCase().replace(/^(the )?(regents|trustees|board of regents|president and fellows) of (the )?/, "").replace(/,? (the|inc\.?|llc|incorporated)$/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    // deno-lint-ignore no-explicit-any
    const display = (n: string) => String(n ?? "").replace(/^the /i, "").replace(/,? the$/i, "").split(" - ")[0].replace(/\s+/g, " ").trim();
    const race: any[] = goals.map((g) => {
      type Org = { name: string; grants: number; rank: number | null; prior_rank: number | null; trials: number; papers: number };
      const orgs = new Map<string, Org>();
      const get = (name: string) => { const k = norm(name); if (!orgs.has(k)) orgs.set(k, { name: display(name), grants: 0, rank: null, prior_rank: null, trials: 0, papers: 0 }); return orgs.get(k)!; };
      const mg = money.find((x: { goal_id: number }) => x.goal_id === g.id);
      for (const r of (mg?.recipients ?? []) as { name: string; amount: number; rank: number; prior_rank: number | null }[]) Object.assign(get(r.name), { grants: r.amount, rank: r.rank, prior_rank: r.prior_rank });
      for (const t of pipeRows) if (t.goal_id === g.id && t.sponsor) get(t.sponsor).trials++;
      const it = intel.find((i: { goal_id: number }) => i.goal_id === g.id);
      for (const i of (it?.institutions ?? []) as { name: string; papers: number }[]) get(i.name).papers = i.papers;
      const list = [...orgs.values()];
      const tot = { g: list.reduce((t, o) => t + o.grants, 0) || 1, t: list.reduce((t, o) => t + o.trials, 0) || 1, p: list.reduce((t, o) => t + o.papers, 0) || 1 };
      const scored = list.map((o) => ({ ...o, score: o.grants / tot.g + o.trials / tot.t + o.papers / tot.p, move: o.rank && o.prior_rank ? o.prior_rank - o.rank : null, new_entry: !!o.rank && !o.prior_rank }))
        .sort((a, b) => b.score - a.score).slice(0, 12).map((o, i) => ({ ...o, place: i + 1, score: round(o.score, 3) }));
      return scored.length ? { goal: g.handle, slug: g.slug, orgs: scored } : null;
    }).filter(Boolean);
    // deno-lint-ignore no-explicit-any
    const climbers: any[] = race.flatMap((r) => r.orgs.filter((o: any) => o.rank && o.rank <= 10 && (o.new_entry || (o.move ?? 0) >= 5)).map((o: any) => ({ goal: r.goal, slug: r.slug, name: o.name, rank: o.rank, prior_rank: o.prior_rank, grants: o.grants })))
      .sort((a, b) => ((b.prior_rank ?? 60) - (b.rank ?? 0)) - ((a.prior_rank ?? 60) - (a.rank ?? 0)));

    // ---- The pipeline: every active trial on the health goals, by phase and by who runs it.
    const PHASES = ["Early phase 1", "Phase 1", "Phase 1/Phase 2", "Phase 2", "Phase 2/Phase 3", "Phase 3", "Phase 4", "Not phased"];
    const WHO: Record<string, string> = { INDUSTRY: "Companies", OTHER: "Universities and hospitals", NIH: "Government", FED: "Government", OTHER_GOV: "Government", NETWORK: "Research networks" };
    const phaseRank = (p: string) => { const i = PHASES.indexOf(p); return i < 0 ? -1 : i === PHASES.length - 1 ? -1 : i; };
    // deno-lint-ignore no-explicit-any
    const pipeline: any[] = goals.map((g) => {
      const ts = pipeRows.filter((t: { goal_id: number }) => t.goal_id === g.id);
      if (!ts.length) return null;
      const by_phase = PHASES.map((p) => ({ phase: p, n: ts.filter((t: { phase: string }) => t.phase === p).length })).filter((x) => x.n);
      const who: Record<string, number> = {}, spons: Record<string, number> = {};
      for (const t of ts) { const w = WHO[t.sponsor_class] ?? "Other"; who[w] = (who[w] ?? 0) + 1; if (t.sponsor) spons[t.sponsor] = (spons[t.sponsor] ?? 0) + 1; }
      const trials = [...ts].sort((a, b) => phaseRank(b.phase) - phaseRank(a.phase) || String(a.completion ?? "9").localeCompare(String(b.completion ?? "9"))).slice(0, 200)
        .map((t) => ({ nct: t.nct, title: t.title, phase: t.phase, status: t.status, sponsor: t.sponsor, who: WHO[t.sponsor_class] ?? "Other", completion: t.completion, enrollment: t.enrollment, key: t.node_key,
          problem: t.node_key ? titles.get(`${g.id}/${t.node_key}`) ?? null : null, url: `https://clinicaltrials.gov/study/${t.nct}` }));
      return { goal: g.handle, slug: g.slug, total: ts.length, phased: ts.filter((t: { phase: string }) => t.phase !== "Not phased").length, late: ts.filter((t: { phase: string }) => /Phase [34]|Phase 2\/Phase 3/.test(t.phase)).length,
        by_phase, who: Object.entries(who).map(([who, n]) => ({ who, n })).sort((a, b) => b.n - a.n),
        sponsors: Object.entries(spons).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 8), trials };
    }).filter(Boolean);
    const pipeTotal = pipeline.reduce((t, p) => t + p!.total, 0), pipeLate = pipeline.reduce((t, p) => t + p!.late, 0);
    const pipeCo = pipeline.reduce((t, p) => t + (p.who.find((w: { who: string; n: number }) => w.who === "Companies")?.n ?? 0), 0);

    const usd = (x: number) => x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(x >= 1e8 ? 0 : 1)}M` : `$${Math.round(x / 1e3)}K`;
    const newSum: number = awards.reduce((t: number, a) => t + a.amount, 0);
    const upMost = by(moneyGoals.filter((x) => x.change != null && x.prior4 >= 5e6), (x) => x.change);
    const downMost = by(moneyGoals.filter((x) => x.change != null && x.prior4 >= 5e6), (x) => -x.change);
    Object.assign(answers, {
      money: [
        awards.length ? `${awards.length} new federal grants of $1M+ in the last 90 days, ${usd(newSum)} in total.` : null,
        full && awards[0] ? `Biggest: ${usd(awards[0].amount)} to ${awards[0].recipient} (@${awards[0].goal}).` : null,
        upMost && upMost.change > 0 ? `Funding up most: @${upMost.goal}, ${Math.round(upMost.change * 100)}% more in the last 4 quarters than the 4 before.` : null,
        downMost && downMost.change < 0 ? `Funding down most: @${downMost.goal}, ${Math.round(downMost.change * 100)}%.` : null,
      ].filter(Boolean),
      race: [
        climbers.length ? `${climbers.length} organizations broke into a top 10 or climbed 5+ places in a year.` : null,
        full && climbers[0] ? `Biggest climber: ${climbers[0].name}, ${climbers[0].prior_rank ? `#${climbers[0].prior_rank} to #${climbers[0].rank}` : `new at #${climbers[0].rank}`} on @${climbers[0].goal}.` : null,
      ].filter(Boolean),
      pipeline: pipeTotal ? [
        `${pipeTotal} active trials across ${pipeline.length} health goals; ${pipeLate} in Phase 3 or later.`,
        `Companies run ${Math.round(pipeCo / pipeTotal * 100)}% of them; universities and hospitals run most of the rest.`,
      ] : [],
    });

    // Remember which problems are in the opportunity corner (for watchlist alerts about new ones).
    const opps = radarPoints(problems).filter((r) => r.opportunity);
    if (opps.length) {
      const idOf = new Map(goals.map((g) => [g.slug, g.id]));
      await fetch(`${SB}/rest/v1/radar_opportunities?on_conflict=goal_id,node_key`, {
        method: "POST", headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(opps.map((r) => ({ goal_id: idOf.get(r.slug), node_key: r.key, last_seen: new Date().toISOString() }))),
      }).catch(() => {});
    }
    return json({
      access: full ? "full" : "preview",
      signed_in: !!uid,
      status,
      price: `$${(CENTS / 100).toFixed(CENTS % 100 ? 2 : 0)}/month`,
      year_price: `$${(Number(Deno.env.get("TERMINAL_YEAR_PRICE_CENTS") ?? String(CENTS * 10)) / 100).toFixed(0)}/year`,
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
      radar: full ? radarPoints(problems) : [],
      catalysts: full ? catalysts : [],
      catalysts_total: catalysts.length,
      answers,
      money: full ? { goals: moneyGoals, awards } : null,
      race: full ? { goals: race, climbers } : null,
      pipeline: full ? pipeline : null,
      market_totals: { awards: awards.length, awards_sum: newSum, climbers: climbers.length, trials: pipeTotal, health_goals: pipeline.length },
      // What visitors see of each locked section: a small, deliberate sample (about one item in ten),
      // cut here on the server so nothing more ever leaves it. Tables and CSV stay subscriber-only.
      preview: full ? null : {
        brief: brief ? { week: brief.week, headline: brief.headline, tldr: (brief.tldr ?? []).slice(0, 1), moved: (brief.moved ?? []).slice(0, 1), moved_total: brief.moved?.length ?? 0, watch_total: brief.watch?.length ?? 0, money_total: brief.money?.length ?? 0 } : null,
        opportunities: { funding: funding.slice(0, 1), quiet: quiet.slice(0, 1), hot: hot.slice(0, 1) },
        opportunity_counts: { funding: funding.length, quiet: quiet.length, hot: hot.length },
        fields: fields.slice(0, 1),
        bottlenecks: bottlenecks.slice(0, 2),
        bottlenecks_total: bottlenecks.length,
        // Goal index: 3 rows. Radar: the dots without names, plus two named examples. Calendar: the next 2.
        index: [...rows].sort((a, b) => (b.papers_last ?? 0) - (a.papers_last ?? 0)).slice(0, 3),
        radar: radarPoints(problems).map((r, i) => (i < 2 && r.opportunity ? r : { x: r.x, y: r.y, size: r.size, opportunity: r.opportunity })),
        catalysts: catalysts.slice(0, 2),
        // Money: the single largest new grant. Race: one goal's top 3 names, no figures. Pipeline: counts only.
        money: { award: awards[0] ?? null, goals: moneyGoals.length },
        race: race[0] ? { goal: race[0]!.goal, slug: race[0]!.slug, orgs: race[0].orgs.slice(0, 3).map((o: { name: string; place: number }) => ({ name: o.name, place: o.place })) } : null,
        pipeline: pipeline.map((p) => ({ goal: p!.goal, slug: p!.slug, total: p!.total, late: p!.late, by_phase: p!.by_phase })),
      },
    });
  } catch (e) {
    console.error("terminal failed:", e instanceof Error ? e.message : e);
    return json({ error: "The Terminal could not load right now. Please try again in a minute." }, 500);
  }
});
