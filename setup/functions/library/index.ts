// PARALLAX library — Supabase Edge Function named `library`.
//
// Grows each goal's library of research. For every problem in the goal's tree it searches:
//   - OpenAlex (250M+ papers): the 200 most relevant, and the 100 most relevant from the last 5 years
//   - NASA's Technical Reports Server (NTRS): engineering reports, tests and mission studies
//   - PubMed: medicine and biology
// and links what it finds to the problem. The AI still reads only the most relevant handful;
// the library is what the counts, charts and (later) the Ideas lab draw on.
//
// One goal per call, with header x-parallax-admin: <ADMIN_TOKEN>:
//   POST {}                 the goal whose library is oldest (refreshed monthly)
//   POST {"slug": "mars"}   one goal now
//   POST {"probe": "lunar night power"}   test each source with one query
//
// Secrets: ADMIN_TOKEN, CONTACT_EMAIL, OPENALEX_API_KEY. OpenAlex charges per search, not per
// result, so asking for 200 results costs the same as asking for 5.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MAIL = Deno.env.get("CONTACT_EMAIL") ?? "";
const OA_KEY = Deno.env.get("OPENALEX_API_KEY") ?? "";
const DAY = 86_400_000;

type Paper = { id: string; title: string; year: number | null; venue: string; url: string; first_author: string; cites: number | null; source: string };

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

async function getJson(url: string, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": `Parallax/1.0 (${MAIL || "research map"})`, Accept: "application/json" } });
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const clean = (s: unknown, n = 300) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, n);

async function openAlex(q: string, per: number, from?: string): Promise<Paper[]> {
  const p = new URLSearchParams({ search: q, "per-page": String(per), filter: `type:article|review|preprint${from ? `,from_publication_date:${from}` : ""}`, select: "id,doi,title,publication_year,cited_by_count,primary_location,authorships" });
  if (MAIL) p.set("mailto", MAIL);
  if (OA_KEY) p.set("api_key", OA_KEY);
  const d = await getJson(`https://api.openalex.org/works?${p}`);
  // deno-lint-ignore no-explicit-any
  return (d.results ?? []).map((w: any) => ({
    id: String(w.id ?? "").split("/").pop() ?? "", title: clean(w.title), year: w.publication_year ?? null,
    venue: clean(w.primary_location?.source?.display_name, 200), url: w.doi ?? w.primary_location?.landing_page_url ?? String(w.id ?? ""),
    first_author: clean(w.authorships?.[0]?.author?.display_name, 120), cites: w.cited_by_count ?? null, source: "openalex",
  })).filter((x: Paper) => x.id && x.title);
}

// True research volume: papers per year across all of OpenAlex for a problem's search, in one
// request (group_by), without downloading them. The goal page's bars and momentum use these.
async function yearCounts(q: string, how: "search" | "abstract" = "abstract"): Promise<Record<number, number>> {
  const y1 = new Date().getUTCFullYear();
  const f = `type:article|review|preprint,publication_year:2000-${y1}`;
  const p = new URLSearchParams(how === "search" ? { search: q, filter: f } : { filter: `${f},title_and_abstract.search:${q.replace(/[,:|]/g, " ")}` });
  p.set("group_by", "publication_year");
  if (MAIL) p.set("mailto", MAIL);
  if (OA_KEY) p.set("api_key", OA_KEY);
  const d = await getJson(`https://api.openalex.org/works?${p}`);
  const out: Record<number, number> = {};
  for (const x of d.group_by ?? []) { const y = Number(x.key); if (y >= 2000 && y <= y1) out[y] = Number(x.count) || 0; }
  return out;
}

async function ntrs(q: string, per: number): Promise<Paper[]> {
  const d = await getJson(`https://ntrs.nasa.gov/api/citations/search?q=${encodeURIComponent(q)}&page.size=${per}`);
  // deno-lint-ignore no-explicit-any
  return (d.results ?? []).map((r: any) => {
    const date = r.publications?.[0]?.publicationDate ?? r.distributionDate ?? r.created ?? "";
    return {
      id: `ntrs:${r.id}`, title: clean(r.title), year: Number(String(date).slice(0, 4)) || null,
      venue: clean(r.center?.name ? `NASA ${r.center.name}` : "NASA Technical Reports", 200), url: `https://ntrs.nasa.gov/citations/${r.id}`,
      first_author: clean(r.authorAffiliations?.[0]?.meta?.author?.name, 120), cites: null, source: "ntrs",
    };
  }).filter((x: Paper) => x.title && x.id !== "ntrs:undefined");
}

async function pubmed(q: string, per: number): Promise<Paper[]> {
  const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  const tool = `&tool=parallax${MAIL ? `&email=${encodeURIComponent(MAIL)}` : ""}`;
  const s = await getJson(`${base}/esearch.fcgi?db=pubmed&retmode=json&retmax=${per}&sort=relevance&term=${encodeURIComponent(q)}${tool}`);
  const ids: string[] = s.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  await new Promise((r) => setTimeout(r, 400)); // PubMed asks for at most 3 requests a second
  const d = await getJson(`${base}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}${tool}`);
  return ids.map((id): Paper | null => {
    const r = d.result?.[id];
    return r ? {
      id: `pmid:${id}`, title: clean(r.title), year: Number(String(r.pubdate ?? "").slice(0, 4)) || null, venue: clean(r.fulljournalname || r.source, 200),
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, first_author: clean(r.authors?.[0]?.name, 120), cites: null, source: "pubmed",
    } : null;
  }).filter((x): x is Paper => !!x && !!x.title);
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// OpenAlex gives each key $1 a day (a search costs $0.001), resetting at midnight UTC. New goals
// come first: refreshing an existing goal only runs while more than 40% of the day is left.
async function oaRemaining(): Promise<number> {
  try {
    const r = await fetch(`https://api.openalex.org/rate-limit${OA_KEY ? `?api_key=${OA_KEY}` : ""}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    return Number(d.rate_limit?.daily_remaining_usd ?? 1) + Number(d.rate_limit?.prepaid_remaining_usd ?? 0);
  } catch { return 1; }
}
const REFRESH_FLOOR = 0.4;

// True research volume per problem (see yearCounts). One goal per call; monthly per goal.
async function countGoal(slug?: string) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,counts_at${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=counts_at.asc.nullsfirst`);
  const g = slug ? goals[0] : goals.find((x: { counts_at: string | null }) => !x.counts_at || Date.now() - new Date(x.counts_at).getTime() > 30 * DAY);
  if (!g) return { note: "every goal's counts are fresh" };
  if (!slug && g.counts_at && (await oaRemaining()) < REFRESH_FLOOR) return { note: "saving today's OpenAlex allowance for new goals" };
  const leaves = await db(`nodes?goal_id=eq.${g.id}&parent_key=not.is.null&query=not.is.null&select=key,query`);
  const errors: string[] = [];
  try { await yearCounts(leaves[0]?.query ?? "research", "search"); } catch (e) {
    if (String(e).includes("429")) return { slug: g.slug, note: "OpenAlex daily limit reached; will retry on a later run" };
  }
  const counts = await pool(leaves, 4, async (l: { key: string; query: string }) => {
    try { return await yearCounts(l.query, "search"); } catch (e) { errors.push(`${l.key}: ${e instanceof Error ? e.message : e}`); return null; }
  });
  const rows = leaves.flatMap((l: { key: string }, i: number) => counts[i] ? Object.entries(counts[i]!).map(([y, n]) => ({ goal_id: g.id, node_key: l.key, year: Number(y), n })) : []);
  if (rows.length) await db("node_field_years?on_conflict=goal_id,node_key,year", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows });
  if (!errors.length) await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { counts_at: new Date().toISOString() } });
  return { slug: g.slug, problems: leaves.length, counted: counts.filter(Boolean).length, errors: errors.slice(0, 4) };
}

async function grow(slug?: string) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,name,library_at${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=library_at.asc.nullsfirst`);
  const g = slug ? goals[0] : goals.find((x: { library_at: string | null }) => !x.library_at || Date.now() - new Date(x.library_at).getTime() > 30 * DAY);
  if (!g) return { note: "every library is fresh" };
  if (!slug && g.library_at && (await oaRemaining()) < REFRESH_FLOOR) return { note: "saving today's OpenAlex allowance for new goals" };
  const leaves = await db(`nodes?goal_id=eq.${g.id}&parent_key=not.is.null&query=not.is.null&select=key,query`);
  const from5 = `${new Date().getUTCFullYear() - 5}-01-01`;
  const errors: string[] = [];
  const safe = async (label: string, f: () => Promise<Paper[]>) => { try { return await f(); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : e}`); return []; } };

  // OpenAlex refuses everything once its daily allowance is used up: check once before 40+ requests.
  try { await openAlex(leaves[0]?.query ?? g.name, 1); } catch (e) {
    if (String(e).includes("429")) return { slug: g.slug, note: "OpenAlex daily limit reached; will retry on a later run" };
  }
  // OpenAlex first (the bulk), then the specialist sources one at a time, gently.
  const oa = await pool(leaves, 4, async (l: { key: string; query: string }) => [
    ...(await safe("openalex", () => openAlex(l.query, 200))),
    ...(await safe("openalex recent", () => openAlex(l.query, 100, from5))),
  ]);
  // One problem at a time, with a pause: PubMed allows about 3 requests a second without a key.
  const spec = await pool(leaves, 1, async (l: { key: string; query: string }) => {
    const n = await safe("ntrs", () => ntrs(l.query, 25));
    const p = await safe("pubmed", () => pubmed(l.query, 30));
    await new Promise((r) => setTimeout(r, 400));
    return [...n, ...p];
  });

  const papers = new Map<string, Paper>();
  const links: { goal_id: number; node_key: string; paper_id: string; rank: number }[] = [];
  leaves.forEach((l: { key: string }, i: number) => {
    const seen = new Set<string>();
    [...oa[i], ...spec[i]].forEach((p, rank) => {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      papers.set(p.id, p);
      links.push({ goal_id: g.id, node_key: l.key, paper_id: p.id, rank });
    });
  });
  const all = [...papers.values()];
  for (let i = 0; i < all.length; i += 500) {
    await db("papers?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: all.slice(i, i + 500) });
  }
  for (let i = 0; i < links.length; i += 1000) {
    await db("node_papers?on_conflict=goal_id,node_key,paper_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: links.slice(i, i + 1000) });
  }
  const count = (await db(`rpc/parallax_goal_paper_count`, { method: "POST", body: { gid: g.id } })) ?? papers.size;
  // If OpenAlex (the bulk of the library) refused or failed, keep the goal due so the next run retries
  // it, instead of marking it done for a month with only the smaller sources.
  const oaFailed = errors.filter((e) => e.startsWith("openalex")).length > leaves.length / 2;
  await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: oaFailed ? { papers_count: count } : { library_at: new Date().toISOString(), papers_count: count } });
  // The goal page's field (research per year, shared papers) reads stored counts; refresh them now.
  await db("rpc/parallax_refresh_field", { method: "POST", body: {} }).catch((e) => errors.push(`field refresh: ${e instanceof Error ? e.message : e}`));
  const bySource: Record<string, number> = {};
  for (const p of all) bySource[p.source] = (bySource[p.source] ?? 0) + 1;
  return { slug: g.slug, problems: leaves.length, papers: count, by_source: bySource, errors: [...new Set(errors)].slice(0, 6) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    if (typeof body.probe_counts === "string") {
      return json(await yearCounts(body.probe_counts, "search"));
    }
    if (body.probe) {
      const q = String(body.probe);
      const tryIt = async (f: () => Promise<Paper[]>) => { try { const r = await f(); return { n: r.length, first: r[0] ?? null }; } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; } };
      return json({ openalex: await tryIt(() => openAlex(q, 200)), ntrs: await tryIt(() => ntrs(q, 25)), pubmed: await tryIt(() => pubmed(q, 30)) });
    }
    if (body.counts === true) return json(await countGoal(body.slug));
    if (body.action === "oa_status") {
      const k = OA_KEY ? `?api_key=${OA_KEY}` : "";
      const r = await fetch(`https://api.openalex.org/rate-limit${k}`, { headers: { Accept: "application/json" } });
      const t = await r.text();
      const hdr: Record<string, string> = {};
      r.headers.forEach((v, k2) => { if (/limit|budget|reset|cost|remaining/i.test(k2)) hdr[k2] = v; });
      return json({ status: r.status, headers: hdr, body: t.replace(OA_KEY || "\u0000", "<key>").slice(0, 1500) });
    }
    const lib = await grow(body.slug);
    // Then the true research counts: for the goal just grown, else the goal whose counts are oldest.
    const counts = await countGoal("slug" in lib ? lib.slug : undefined).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    return json({ ...lib, counts });
  } catch (e) {
    console.error("library failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
