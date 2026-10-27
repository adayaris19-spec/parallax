// PARALLAX evidence — Supabase Edge Function named `evidence`. Real, checkable signals per problem,
// from free public sources (no AI):
//   - USAspending.gov: federal grants in the last 3 years matching the problem (all agencies: NIH,
//     NSF, Energy, NASA...): count, dollars obligated, by agency, the largest awards
//   - ClinicalTrials.gov: active or recruiting trials (count, by phase, the most advanced trials)
// Searches start from each problem's search words (nodes.query): the first 3 words, then the first 2,
// keeping the first that finds enough. A source shows on the site only when it finds something.
// One goal per call (resumable), refreshed monthly; new goals first.
//   POST {}  next goal due · POST {"slug": "mars"}  one goal now · POST {"probe": "query"}  test
// Header x-parallax-admin: <ADMIN_TOKEN>.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const DAY = 86_400_000;
const UA = { "User-Agent": "Parallax/1.0 (public research feed)", Accept: "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
async function getJson(url: string, init: RequestInit = {}, ms = 20000) {
  const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return await r.json();
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: unknown, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Of|And|The|For|In|At|On)\b/g, (m) => m.toLowerCase());

type Item = { title: string; who: string; amount?: number; url: string; phase?: string; status?: string; agency?: string };
type Found = { source: string; count: number; amount_cents: number | null; since_year: number; top: Item[]; extra: Record<string, unknown> };
// One active trial for the Pro pipeline (trial_pipeline table).
type Trial = { nct: string; title: string; phase: string; status: string; sponsor: string; sponsor_class: string; completion: string | null; enrollment: number | null };
const phaseName = (ph: string[] | undefined) => (ph ?? []).filter((x) => x !== "NA").map((x) => x.replace("EARLY_PHASE1", "Early phase 1").replace("PHASE", "Phase ")).join("/") || "Not phased";

const Y = new Date().getUTCFullYear();
const SINCE = `${Y - 3}-01-01`;

// Phrases to try (USAspending matches phrases). Phrases that carry the goal's own key words come
// right after the first three words ("drug delivery Alzheimer" before "blood-brain barrier").
const GENERIC = new Set("disease diseases people humans human world better cheap cheaper enough making first build every power scale useful solve solves problems problem living permanent early slowing cure removing billions tons systems system design control model models trial trials clinical safety testing large".split(" "));
const words = (q: string) => q.replace(/['’]s\b/g, "").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
// The goal's subject: words from its name, plus words that recur across its problems' searches
// (battery and storage for grid storage, Mars and crew for Mars).
function anchorsOf(goalName: string, queries: string[] = []): string[] {
  const out = new Set(words(goalName).map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !GENERIC.has(w)));
  const freq = new Map<string, number>();
  for (const q of queries) for (const w of new Set(words(q).map((x) => x.toLowerCase()))) freq.set(w, (freq.get(w) ?? 0) + 1);
  for (const [w, n] of freq) if (n >= 3 && w.length >= 5 && !GENERIC.has(w)) out.add(w);
  return [...out];
}
function tries(q: string, anchors: string[] = []): string[] {
  const w = words(q), out: string[] = [];
  const has = (p: string[]) => p.some((x) => anchors.includes(x.toLowerCase()));
  out.push(w.slice(0, 3).join(" "));
  for (const n of [3, 2]) for (let i = 0; i + n <= w.length; i++) { const p = w.slice(i, i + n); if (has(p)) out.push(p.join(" ")); }
  out.push(w.slice(0, 2).join(" "));
  return [...new Set(out)].filter((x) => x.split(" ").length >= 2 || w.length === 1).slice(0, 6);
}

const USA = "https://api.usaspending.gov/api/v2/search";
// Grant descriptions arrive in capitals, often with the abstract appended: keep a readable title.
const ACRONYMS = ["DNA", "RNA", "cfDNA", "ctDNA", "MHD", "DIII-D", "NSTX-U", "MAST-U", "NASA", "MRI", "PET", "CT", "AI", "HIV", "AD", "ADRD", "US", "USA", "II", "III", "IV", "SPORE", "CO2", "LNG", "ITER", "NIH", "NSF", "DOE", "UV", "3D", "2D", "MCI", "APOE", "HCC", "CRISPR", "PFAS"];
function grantTitle(d: unknown): string {
  let t = clean(d, 600).split(/\s+-\s+Project Summary|\s+Project Summary|\s+PROJECT SUMMARY|\s+Abstract[:\s]|\s+This (application|project|proposal|award)\b/i)[0];
  if (t === t.toUpperCase()) {
    t = t.toLowerCase().replace(/^./, (m) => m.toUpperCase());
    for (const a of ACRONYMS) t = t.replace(new RegExp(`\\b${a.replace(/[-]/g, "\\-")}\\b`, "gi"), a);
  }
  t = t.replace(/(\w)\?s\b/g, "$1’s").replace(/\b(alzheimer|parkinson|huntington|mars|earth)\b/gi, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());
  if (t.length > 130) t = t.slice(0, 130).replace(/\s+\S*$/, "") + "…";
  return t;
}
const GRANTS = ["02", "03", "04", "05"];
const post = (url: string, body: unknown) => getJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, 30000);

// A search can match grants that only mention the words in passing ("public acceptance" finds a
// cannabis centre). Keep it only if enough of its largest grants carry the words in their title.
const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
function relevant(texts: string[], used: string): boolean {
  if (!texts.length) return false;
  const need = used.split(/[\s-]+/).map(stem).filter((x) => x.length >= 2);
  const hit = texts.filter((t) => { const ws = new Set(grantTitle(t).split(/[^A-Za-z0-9]+/).map(stem)); return need.every((n) => ws.has(n)); }).length;
  return hit / texts.length >= 0.3;
}

async function funding(q: string, anchors: string[] = [], names: string[] = anchors): Promise<Found | null> {
  for (const k of tries(q, anchors)) {
    const filters = { keywords: [k], award_type_codes: GRANTS, time_period: [{ start_date: SINCE, end_date: `${Y}-12-31` }] };
    const c = await post(`${USA}/spending_by_award_count/`, { filters });
    const count = Number(c.results?.grants ?? 0);
    if (count < 3) { await sleep(250); continue; }
    const top = await post(`${USA}/spending_by_award/`, { filters, fields: ["Recipient Name", "Award Amount", "Awarding Agency", "Description", "generated_internal_id"], sort: "Award Amount", order: "desc", limit: 10, page: 1 });
    // deno-lint-ignore no-explicit-any
    if (!relevant((top.results ?? []).map((x: any) => String(x["Description"] ?? "")), k)) { await sleep(250); continue; }
    const all = top.results ?? [];
    top.results = all.slice(0, 3);
    const byAgency = await post(`${USA}/spending_by_category/awarding_agency/`, { filters, limit: 10, page: 1 });
    // deno-lint-ignore no-explicit-any
    const agencies = (byAgency.results ?? []).map((x: any) => ({ name: String(x.name ?? ""), amount: Math.round(Number(x.amount) || 0) })).filter((x: { amount: number }) => x.amount > 0);
    const total = agencies.reduce((a: number, x: { amount: number }) => a + x.amount, 0);
    // Broad phrases cross fields ("blood-brain barrier" spans ALS and stroke; "closed loop" finds
    // battery recycling for a Mars goal). A phrase without a word from the goal's name must find
    // grants that name the goal's subject.
    // Test against the goal's subject words that are not in the phrase itself ("prevention" can't
    // vouch for "prevention treatment").
    const others = anchors.filter((a) => !k.toLowerCase().includes(a.slice(0, 6)));
    const named = (t: string) => others.some((a) => grantTitle(t).toLowerCase().includes(a.slice(0, 6)));
    // deno-lint-ignore no-explicit-any
    const descs = (all as any[]).map((x) => String(x["Description"] ?? ""));
    if (names.length && !names.some((a) => k.toLowerCase().includes(a.slice(0, 6))) && descs.filter(named).length < descs.length * 0.3) { await sleep(250); continue; }
    return {
      source: "grants", count, amount_cents: total * 100, since_year: Y - 3, extra: { terms: k, agencies: agencies.slice(0, 4) },
        // deno-lint-ignore no-explicit-any
      top: (top.results ?? []).map((x: any) => ({ title: grantTitle(x["Description"]), who: titleCase(clean(x["Recipient Name"], 90)), amount: Math.round(Number(x["Award Amount"]) || 0), url: `https://www.usaspending.gov/award/${encodeURIComponent(x.generated_internal_id)}`, agency: clean(x["Awarding Agency"], 60) })),
    };
  }
  return null;
}

const ACTIVE = ["RECRUITING", "NOT_YET_RECRUITING", "ACTIVE_NOT_RECRUITING", "ENROLLING_BY_INVITATION"];
// Trials are searched for health problems (grants mostly health funding, or none found), with the
// full search words, and listed in ClinicalTrials.gov's relevance order.
async function trials(q: string, anchors: string[] = []): Promise<(Found & { pipeline: Trial[] }) | null> {
  for (const k of [q]) {
    const p = new URLSearchParams({ "query.term": k, "filter.overallStatus": ACTIVE.join(","), countTotal: "true", pageSize: "500", fields: "NCTId,BriefTitle,Phase,OverallStatus,LeadSponsorName,LeadSponsorClass,EnrollmentCount,PrimaryCompletionDate" });
    const d = await getJson(`https://clinicaltrials.gov/api/v2/studies?${p}`);
    // deno-lint-ignore no-explicit-any
    const st: any[] = d.studies ?? [];
    const count = Number(d.totalCount ?? st.length);
    if (count < 3) { await sleep(250); continue; }
    const phases: Record<string, number> = {};
    for (const s of st) for (const ph of s.protocolSection?.designModule?.phases ?? ["NA"]) phases[ph] = (phases[ph] ?? 0) + 1;
    // Studies that name the goal's subject first; if none of the first 20 do, the match is too loose.
    const named = (s: any) => anchors.some((a) => String(s.protocolSection?.identificationModule?.briefTitle ?? "").toLowerCase().includes(a.slice(0, 6))); // deno-lint-ignore no-explicit-any
    if (anchors.length && !st.slice(0, 20).some(named)) return null;
    const top = [...st.filter(named), ...st.filter((x) => !named(x))].slice(0, 3).map((s) => {
      const ps = s.protocolSection ?? {};
      return { title: clean(ps.identificationModule?.briefTitle), who: clean(ps.sponsorCollaboratorsModule?.leadSponsor?.name, 90), url: `https://clinicaltrials.gov/study/${ps.identificationModule?.nctId}`, phase: (ps.designModule?.phases ?? []).map((x: string) => x.replace("EARLY_PHASE", "Early phase ").replace("PHASE", "Phase ")).join("/"), status: String(ps.statusModule?.overallStatus ?? "").replace(/_/g, " ").toLowerCase() };
    });
    // Upcoming readouts: studies whose main results are due in the next 18 months (for the Terminal's
    // catalysts calendar), the furthest-along first within each month.
    const now = new Date().toISOString().slice(0, 7), until = new Date(Date.now() + 548 * 86_400_000).toISOString().slice(0, 7);
    const upcoming = st.filter(named).map((x) => {
      const ps = x.protocolSection ?? {};
      const date = String(ps.statusModule?.primaryCompletionDateStruct?.date ?? "").slice(0, 7);
      return { nct: ps.identificationModule?.nctId, title: clean(ps.identificationModule?.briefTitle, 160), sponsor: clean(ps.sponsorCollaboratorsModule?.leadSponsor?.name, 80), phase: (ps.designModule?.phases ?? []).map((p: string) => p.replace("EARLY_PHASE", "Early phase ").replace("PHASE", "Phase ")).join("/"), date };
    }).filter((x) => x.nct && x.date >= now && x.date <= until && /Phase [23]/.test(x.phase)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
    // Every active trial that names the subject, for the Pro pipeline view.
    // deno-lint-ignore no-explicit-any
    const pipeline: Trial[] = st.filter(named).map((x: any) => {
      const ps = x.protocolSection ?? {};
      return { nct: String(ps.identificationModule?.nctId ?? ""), title: clean(ps.identificationModule?.briefTitle, 200), phase: phaseName(ps.designModule?.phases), status: String(ps.statusModule?.overallStatus ?? "").replace(/_/g, " ").toLowerCase(),
        sponsor: clean(ps.sponsorCollaboratorsModule?.leadSponsor?.name, 120), sponsor_class: String(ps.sponsorCollaboratorsModule?.leadSponsor?.class ?? "OTHER"),
        completion: String(ps.statusModule?.primaryCompletionDateStruct?.date ?? "").slice(0, 10) || null, enrollment: Number(ps.designModule?.enrollmentInfo?.count) || null };
    }).filter((t) => t.nct);
    return { pipeline, source: "trials", count, amount_cents: null, since_year: Y, top, extra: { terms: k, phases, upcoming, recruiting: st.filter((s) => s.protocolSection?.statusModule?.overallStatus === "RECRUITING").length } };
  }
  return null;
}

async function probe(q: string) {
  const t = async (f: () => Promise<Found | null>) => { try { const r = await f(); return r ? { terms: r.extra.terms, count: r.count, usd: r.amount_cents ? Math.round(r.amount_cents / 100) : null, agencies: r.extra.agencies, phases: r.extra.phases, top: r.top.map((x) => `${x.title} — ${x.who}${x.amount ? ` $${x.amount.toLocaleString()}` : ""}${x.phase ? ` (${x.phase})` : ""}`) } : null; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; } };
  return { grants: await t(() => funding(q)), trials: await t(() => trials(q)) };
}

async function savePipeline(goalId: number, key: string, rows: Trial[]) {
  await db(`trial_pipeline?goal_id=eq.${goalId}&node_key=eq.${encodeURIComponent(key)}`, { method: "DELETE", prefer: "return=minimal" });
  const seen = new Set<string>(), body = rows.filter((t) => !seen.has(t.nct) && seen.add(t.nct)).map((t) => ({ goal_id: goalId, node_key: key, ...t, checked_at: new Date().toISOString() }));
  if (body.length) await db("trial_pipeline?on_conflict=goal_id,nct", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body });
}

// Fill the pipeline for one goal without redoing its grants: re-runs the trial search for the
// problems that already have trials evidence.
async function pipelineOnly(slug: string) {
  const [g] = await db(`goals?slug=eq.${encodeURIComponent(slug)}&select=id,name`);
  if (!g) return { error: "no such goal" };
  const [leaves, ev] = await Promise.all([
    db(`nodes?goal_id=eq.${g.id}&parent_key=not.is.null&query=not.is.null&select=key,query`),
    db(`node_evidence?goal_id=eq.${g.id}&source=eq.trials&select=node_key`),
  ]);
  const want = new Set(ev.map((e: { node_key: string }) => e.node_key));
  const anchors = anchorsOf(g.name, (leaves as { query: string }[]).map((x) => x.query));
  let trials_saved = 0; const errors: string[] = [];
  for (const l of (leaves as { key: string; query: string }[]).filter((x) => want.has(x.key))) {
    try { const tr = await trials(l.query, anchors); await savePipeline(g.id, l.key, tr?.pipeline ?? []); trials_saved += tr?.pipeline.length ?? 0; }
    catch (e) { errors.push(`${l.key}: ${e instanceof Error ? e.message : e}`); }
  }
  return { slug, problems: want.size, trials_saved, errors: errors.slice(0, 5) };
}

// Problems the AI won't write ideas for (vaccine and pathogen biology) show the trials already
// testing approaches instead, so they always get a trial search, widening the words until one hits.
const TRIAL_WORDS = new Set(["trial", "trials", "study", "model", "models", "field", "long-term", "durable", "efficacy", "safety", "phase", "development", "testing", "protection", "prevent", "human", "humans", "infection", "controlled", "randomized", "adults", "adolescents", "children", "wild"]);
async function declinedTrials(limit = 6) {
  const rows = await db(`nodes?ideas_declined=is.true&query=not.is.null&or=(tested_at.is.null,tested_at.lt.${new Date(Date.now() - 30 * DAY).toISOString()})&select=goal_id,key,query&limit=${limit}`);
  const out: { goal_id: number; key: string; terms: string | null; count: number; top: string[] }[] = [];
  for (const l of rows as { goal_id: number; key: string; query: string }[]) {
    const [g] = await db(`goals?id=eq.${l.goal_id}&select=name`);
    const qs = await db(`nodes?goal_id=eq.${l.goal_id}&parent_key=not.is.null&query=not.is.null&select=query`);
    const acr = words(g?.name ?? "").filter((w) => /^[A-Z0-9]{2,5}$/.test(w)).map((w) => w.toLowerCase());
    const anchors = [...anchorsOf(g?.name ?? "", qs.map((x: { query: string }) => x.query)), ...acr];
    // Keep trials that name the goal's subject, ranked by how many of the problem's words they share;
    // widen the search words until some survive.
    // The goal's subject words, plus short acronyms in its name (HIV, TB) that anchorsOf skips.
    const subject = [...anchorsOf(g?.name ?? ""), ...acr];
    const qw = words(l.query).map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !subject.includes(w) && !TRIAL_WORDS.has(w));
    // The problem's lead word (vaccine, gene drive, correlates…) must appear, so a nearby trial
    // (bed nets under gene drives) doesn't stand in for the problem.
    // Words match at their start, short ones whole ("gene" isn't in "next-generation").
    const has = (x: string, w: string) => new RegExp(`(^|[^\\p{L}])${w.slice(0, 6).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${w.length <= 5 ? "s?(?![\\p{L}])" : ""}`, "u").test(x);
    const lead = qw[0] ?? "";
    const fit = (t: Trial) => { const x = t.title.toLowerCase(); return subject.some((a) => has(x, a)) && (!lead || has(x, lead)) ? 1 + qw.filter((w) => has(x, w)).length : 0; };
    let tr: Awaited<ReturnType<typeof trials>> = null, kept: Trial[] = [];
    for (const k of [l.query, ...tries(l.query, anchors)]) {
      tr = await trials(k, anchors).catch(() => null);
      kept = (tr?.pipeline ?? []).filter((t) => fit(t) >= 2).sort((a, b) => fit(b) - fit(a) || (b.phase || "").localeCompare(a.phase || ""));
      if (kept.length) break;
      await sleep(250);
    }
    await db(`node_evidence?goal_id=eq.${l.goal_id}&node_key=eq.${encodeURIComponent(l.key)}&source=eq.trials`, { method: "DELETE", prefer: "return=minimal" });
    if (tr && kept.length) {
      const { pipeline: _p, ...base } = tr;
      const f = { ...base, count: kept.length,
        top: kept.slice(0, 3).map((t) => ({ title: t.title, who: t.sponsor, url: `https://clinicaltrials.gov/study/${t.nct}`, phase: t.phase, status: t.status })),
        extra: { terms: base.extra.terms, recruiting: kept.filter((t) => t.status === "recruiting").length } };
      await db("node_evidence", { method: "POST", prefer: "return=minimal", body: { goal_id: l.goal_id, node_key: l.key, ...f, checked_at: new Date().toISOString() } });
    }
    await savePipeline(l.goal_id, l.key, kept);
    await db(`nodes?goal_id=eq.${l.goal_id}&key=eq.${encodeURIComponent(l.key)}`, { method: "PATCH", prefer: "return=minimal", body: { tested_at: new Date().toISOString() } });
    out.push({ goal_id: l.goal_id, key: l.key, terms: tr ? String(tr.extra.terms) : null, count: kept.length, top: kept.slice(0, 3).map((t) => t.title.slice(0, 70)) });
  }
  return out;
}

async function run(slug?: string) {
  const tested = await declinedTrials().catch((e) => [{ error: String(e).slice(0, 120) }]);
  return { ...(await runGoal(slug)), tested };
}

async function runGoal(slug?: string) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,name,evidence_at${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=evidence_at.asc.nullsfirst`);
  const g = slug ? goals[0] : goals.find((x: { evidence_at: string | null }) => !x.evidence_at || Date.now() - new Date(x.evidence_at).getTime() > 30 * DAY);
  if (!g) return { note: "every goal's evidence is fresh" };
  const [leaves, have] = await Promise.all([
    db(`nodes?goal_id=eq.${g.id}&parent_key=not.is.null&query=not.is.null&select=key,query,title`),
    db(`node_evidence_checks?goal_id=eq.${g.id}&select=node_key,checked_at`),
  ]);
  // Resume: skip problems checked in the last 30 days (a goal can take more than one call).
  const fresh = new Set(have.filter((h: { checked_at: string }) => Date.now() - new Date(h.checked_at).getTime() < 30 * DAY).map((h: { node_key: string }) => h.node_key));
  const t0 = Date.now(), errors: string[] = [];
  let done = 0;
  for (const l of (leaves as { key: string; query: string; title: string }[]).filter((x) => !fresh.has(x.key))) {
    if (Date.now() - t0 > 100_000) break;
    const now = new Date().toISOString(), found: Found[] = [];
    let failed = false, pipe: Trial[] = [];
    try {
      const anchors = anchorsOf(g.name, (leaves as { query: string }[]).map((x) => x.query));
      const gr = await funding(l.query, anchors, anchorsOf(g.name));
      if (gr) found.push(gr);
      // deno-lint-ignore no-explicit-any
      const hhs = ((gr?.extra.agencies ?? []) as any[]).find((a) => /health and human services/i.test(a.name))?.amount ?? 0;
      if (!gr || hhs * 100 >= (gr.amount_cents ?? 0) * 0.5) { const tr = await trials(l.query, anchors); if (tr) { const { pipeline, ...f } = tr; found.push(f); pipe = pipeline; } }
    } catch (e) { failed = true; errors.push(`${l.key}: ${e instanceof Error ? e.message : e}`); }
    if (failed) continue;
    await db(`node_evidence?goal_id=eq.${g.id}&node_key=eq.${encodeURIComponent(l.key)}`, { method: "DELETE", prefer: "return=minimal" });
    if (found.length) await db("node_evidence", { method: "POST", prefer: "return=minimal", body: found.map((r) => ({ goal_id: g.id, node_key: l.key, ...r, checked_at: now })) });
    await savePipeline(g.id, l.key, pipe);
    await db("node_evidence_checks?on_conflict=goal_id,node_key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { goal_id: g.id, node_key: l.key, checked_at: now } });
    fresh.add(l.key); done++;
  }
  const complete = leaves.every((l: { key: string }) => fresh.has(l.key));
  if (complete) await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { evidence_at: new Date().toISOString() } });
  return { slug: g.slug, problems: leaves.length, checked_now: done, complete, errors: errors.slice(0, 5) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    if (typeof body.probe === "string") return json(await probe(body.probe));
    if (typeof body.pipeline === "string") return json(await pipelineOnly(body.pipeline));
    if (body.redo === true) { await db("node_evidence_checks?goal_id=gt.0", { method: "DELETE", prefer: "return=minimal" }); await db("goals?evidence_at=not.is.null", { method: "PATCH", prefer: "return=minimal", body: { evidence_at: null } }); return json({ cleared: true }); }
    return json(await run(body.slug));
  } catch (e) {
    console.error("evidence failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
