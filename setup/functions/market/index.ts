// PARALLAX market — Supabase Edge Function named `market`. Pro-only information the free site never
// shows, from USAspending.gov (no AI):
//   - money flows: each goal's federal grant funding by quarter, and new grants of $1M+ (last 90 days)
//   - the race: who receives the most federal grant money on each goal, recent year vs the one before
// A goal's searches are the phrases already validated for its problems (node_evidence grants terms),
// searched together, so each award counts once. One goal per run, refreshed weekly.
//   POST {} next goal due · POST {"slug": "..."} one goal now · POST {"probe": "slug"} test without saving
// Header x-parallax-admin: <ADMIN_TOKEN>.
const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const DAY = 86_400_000;
const USA = "https://api.usaspending.gov/api/v2";
const GRANTS = ["02", "03", "04", "05"];
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
async function post(path: string, body: unknown) {
  const r = await fetch(`${USA}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Parallax/1.0" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`usaspending ${r.status} on ${path}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const clean = (s: unknown, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Of|And|The|For|In|At|On)\b/g, (m) => m.toLowerCase()).replace(/\b(Llc|Inc|Usa|Us|Nasa|Mit)\b/g, (m) => m.toUpperCase());

// The goal's subject words: from its name, plus words that recur across its problems' searches,
// minus everyday words that also name unrelated work ("high temperature", "grid integration").
const WEAK = new Set(("disease diseases people humans human world better cheap cheaper enough making first build every power scale useful solve solves problems problem living permanent early slowing cure " +
  "removing billions tons systems system design control model models trial trials clinical safety testing large that from work room safe grid test base energy renewable temperature high " +
  "surface water direct prevention therapy treatment critical error materials plant reactor detection screening").split(" "));
const words = (q: string) => q.replace(/['’]s\b/g, "").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
function subject(name: string, queries: string[]) {
  const out = new Set(words(name).filter((w) => w.length >= 4 && !WEAK.has(w)));
  const freq = new Map<string, number>();
  for (const q of queries) for (const w of new Set(words(q))) freq.set(w, (freq.get(w) ?? 0) + 1);
  for (const [w, n] of freq) if (n >= 3 && w.length >= 5 && !WEAK.has(w)) out.add(w);
  return [...out].map((w) => w.slice(0, 6));
}

async function gather(goalId: number, goalName: string) {
  const [ev, nodes] = await Promise.all([
    db(`node_evidence?goal_id=eq.${goalId}&source=eq.grants&select=node_key,extra`),
    db(`nodes?goal_id=eq.${goalId}&parent_key=not.is.null&query=not.is.null&select=query`),
  ]);
  const subj = subject(goalName, nodes.map((n: { query: string }) => n.query));
  const all = [...new Set(ev.map((e: { extra: { terms?: string } }) => e.extra?.terms).filter(Boolean))] as string[];
  // Only phrases that carry the subject, so every search is about this goal.
  const phrases = all.filter((p) => words(p).some((w) => subj.some((a) => w.startsWith(a))));
  if (!phrases.length) return null;
  const now = Date.now(), Y = new Date().getUTCFullYear();
  const base = { keywords: phrases, award_type_codes: GRANTS };
  const [quarters, fresh, recent, prior] = await Promise.all([
    post("/search/spending_over_time/", { group: "quarter", filters: { ...base, time_period: [{ start_date: `${Y - 3}-01-01`, end_date: iso(now) }] } }),
    post("/search/spending_by_award/", { filters: { ...base, time_period: [{ start_date: iso(now - 90 * DAY), end_date: iso(now) }], award_amounts: [{ lower_bound: 1_000_000 }] },
      fields: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Description", "Start Date", "generated_internal_id"], sort: "Award Amount", order: "desc", limit: 60, page: 1 }),
    post("/search/spending_by_category/recipient/", { filters: { ...base, time_period: [{ start_date: iso(now - 365 * DAY), end_date: iso(now) }] }, limit: 25, page: 1 }),
    post("/search/spending_by_category/recipient/", { filters: { ...base, time_period: [{ start_date: iso(now - 730 * DAY), end_date: iso(now - 365 * DAY) }] }, limit: 50, page: 1 }),
  ]);
  // Which problem each new grant belongs to: the phrase its description contains.
  const nodeOf = (desc: string) => ev.find((e: { extra: { terms?: string } }) => e.extra?.terms && phrases.includes(e.extra.terms) && desc.toLowerCase().includes(e.extra.terms.toLowerCase()))?.node_key ?? null;
  // On topic: a phrase anywhere, and the subject in the opening words (the award's title).
  const onTopic = (desc: string) => phrases.some((p) => desc.toLowerCase().includes(p.toLowerCase())) && words(desc.slice(0, 250)).some((w) => subj.some((a) => w.startsWith(a)));
  // deno-lint-ignore no-explicit-any
  const awards = (fresh.results ?? []).map((x: any) => ({
    award_id: String(x["generated_internal_id"] ?? x["Award ID"]), recipient: titleCase(clean(x["Recipient Name"], 120)), agency: clean(x["Awarding Agency"], 80),
    amount: Math.round(Number(x["Award Amount"]) || 0), start_date: x["Start Date"] ?? null, description: clean(x["Description"], 300),
    node_key: nodeOf(String(x["Description"] ?? "")), url: `https://www.usaspending.gov/award/${encodeURIComponent(x.generated_internal_id)}`,
    on_topic: onTopic(String(x["Description"] ?? "")),
  })).filter((a: { amount: number; on_topic: boolean }) => a.amount >= 1_000_000 && a.on_topic).map(({ on_topic: _, ...a }: { on_topic: boolean }) => a);
  // deno-lint-ignore no-explicit-any
  const priorRank = new Map((prior.results ?? []).map((r: any, i: number) => [String(r.name ?? "").toLowerCase(), { rank: i + 1, amount: Math.round(Number(r.amount) || 0) }]));
  // deno-lint-ignore no-explicit-any
  const recipients = (recent.results ?? []).filter((r: any) => r.name).map((r: any, i: number) => {
    const p = priorRank.get(String(r.name).toLowerCase()) as { rank: number; amount: number } | undefined;
    return { name: titleCase(clean(r.name, 120)), amount: Math.round(Number(r.amount) || 0), prior: p?.amount ?? 0, rank: i + 1, prior_rank: p?.rank ?? null };
  });
  // deno-lint-ignore no-explicit-any
  const q = (quarters.results ?? []).map((r: any) => ({ fy: Number(r.time_period?.fiscal_year), q: Number(r.time_period?.quarter), amount: Math.round(Number(r.aggregated_amount) || 0) })).filter((r: { fy: number }) => r.fy);
  return { phrases, quarters: q, awards, recipients };
}

async function run(slug?: string, probe = false) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,name,market_at${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=market_at.asc.nullsfirst`);
  const g = slug ? goals[0] : goals.find((x: { market_at: string | null }) => !x.market_at || Date.now() - new Date(x.market_at).getTime() > 7 * DAY);
  if (!g) return { note: "every goal's money data is fresh" };
  const m = await gather(g.id, g.name);
  if (probe) return { slug: g.slug, ...m, awards: m?.awards.slice(0, 8).map((a: { recipient: string; amount: number; description: string }) => `${a.amount} ${a.recipient} | ${a.description.slice(0, 90)}`), recipients: m?.recipients.slice(0, 8) };
  if (m) {
    await db("goal_money?on_conflict=goal_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { goal_id: g.id, phrases: m.phrases, quarters: m.quarters, recipients: m.recipients, updated_at: new Date().toISOString() } });
    if (m.awards.length) await db("grant_awards?on_conflict=goal_id,award_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: m.awards.map((a: Record<string, unknown>) => ({ goal_id: g.id, ...a })) });
  }
  // Keep the last four months of new grants; older ones are no longer "new".
  if (m) await db(`grant_awards?goal_id=eq.${g.id}&first_seen=lt.${iso(Date.now() - 120 * DAY)}`, { method: "DELETE", prefer: "return=minimal" });
  await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { market_at: new Date().toISOString() } });
  return { slug: g.slug, phrases: m?.phrases.length ?? 0, quarters: m?.quarters.length ?? 0, awards: m?.awards.length ?? 0, recipients: m?.recipients.length ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    if (typeof body.probe === "string") return json(await run(body.probe, true));
    return json(await run(body.slug));
  } catch (e) {
    console.error("market failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 300) : "failed" }, 500);
  }
});
