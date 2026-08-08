// PARALLAX ingest worker v7 — paste into the Supabase Edge Function named `ingest`.
//
// What changed in v7
//   * The perimeter went from 3 archives to 10, and it reaches back to the
//     nineteenth century instead of to 1991. OpenAlex alone indexes ~250M works
//     across every discipline with citation counts, venues, institutions and
//     open-access status; INSPIRE covers particle physics back to the 1900s;
//     Europe PMC covers the life sciences from 1781; ADS covers astronomy from
//     the 1820s. Every archive runs in parallel and any one of them can fail
//     without taking the sweep down.
//   * Three OpenAlex passes, not one: RELEVANCE (what matches), CITED (the canon
//     of the field, sorted by citation count) and EARLIEST (where the question
//     came from). That is what puts 1930s papers on the same figure as this
//     month's preprints.
//   * Records now carry year, citation count, venue, institutions, open-access
//     status and concepts, so the client can do field analysis a person cannot
//     do by hand: era structure, dormancy and revival, whether the current wave
//     still cites its own canon, and how concentrated the field is.
//   * The response includes an archive ledger — which archive answered, with how
//     many records, in how many ms, and the error if it did not.
//
// Secrets (Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY  — console.anthropic.com   (required)
//   ADS_TOKEN          — ui.adsabs.harvard.edu   (optional, adds astronomy back to the 1820s)
//   CONTACT_EMAIL      — optional; OpenAlex and Crossref give faster service with one
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADS = Deno.env.get("ADS_TOKEN") ?? "";
const ANT = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MAIL = Deno.env.get("CONTACT_EMAIL") ?? "parallax-research@example.org";
const WORKER_VERSION = 7;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const DEFAULT_WATCH = {
  name: "Sgr A* polarisation drift",
  q: '("Sgr A*" OR "Sagittarius A*") AND (polarization OR "rotation measure" OR GRMHD)',
  tracked: [
    "EVPA polarisation drift at 230 GHz",
    "Faraday screen stability on the sightline",
    "electron heating prescription R_high",
    "fractional linear polarisation m_L",
  ],
};

async function sb(path: string, method = "GET", body?: unknown, prefer?: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SRK,
      Authorization: `Bearer ${SRK}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok && r.status !== 409) console.log("supabase", path, r.status, await r.text());
  try { return await r.json(); } catch { return null; }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const UA = { "User-Agent": `PARALLAX/1.0 (research monitor; ${MAIL})` };
const clean = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const yearOf = (iso: unknown) => {
  const m = String(iso ?? "").match(/(1[6-9]\d{2}|20\d{2})/);
  return m ? Number(m[1]) : null;
};
function pick(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? clean(m[1]) : "";
}
async function getJSON(url: string, headers: Record<string, string> = {}, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function getText(url: string, headers: Record<string, string> = {}, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

// OpenAlex ships abstracts as an inverted index; rebuild the text.
function deInvert(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const w of Object.keys(inv)) for (const p of inv[w]) words[p] = w;
  return words.join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);
}

// ---------------------------------------------------------------------------
// the archives. Every one returns the same record shape, and every one is
// allowed to fail on its own without taking the sweep with it.
// ---------------------------------------------------------------------------
type Rec = {
  source: string; source_id: string; title: string; abstract: string;
  authors: string; url: string; published_at: string | null;
  year: number | null; citations: number | null; venue: string;
  institutions: string[]; oa: boolean | null; concepts: string[];
};
const rec = (o: Partial<Rec>): Rec => ({
  source: "", source_id: "", title: "", abstract: "", authors: "", url: "",
  published_at: null, year: null, citations: null, venue: "",
  institutions: [], oa: null, concepts: [], ...o,
});

async function fromArxiv(q: string, rows: number, by: "relevance" | "submittedDate" = "relevance"): Promise<Rec[]> {
  const xml = await getText(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}` +
    `&sortBy=${by}&sortOrder=descending&max_results=${rows}`);
  const out: Rec[] = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const id = (pick(entry, "id").split("/abs/")[1] ?? "").trim();
    if (!id) continue;
    const pub = pick(entry, "published") || null;
    out.push(rec({
      source: "arxiv", source_id: `arxiv:${id}`, title: pick(entry, "title"),
      abstract: pick(entry, "summary").slice(0, 4000),
      authors: [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).slice(0, 8).join(", "),
      url: `https://arxiv.org/abs/${id}`, published_at: pub, year: yearOf(pub),
      venue: "arXiv preprint", oa: true,
    }));
  }
  return out;
}

async function fromOpenAlex(q: string, rows: number, sort: "relevance" | "cited" | "earliest"): Promise<Rec[]> {
  const s = sort === "cited" ? "&sort=cited_by_count:desc"
    : sort === "earliest" ? "&sort=publication_date:asc" : "";
  const j = await getJSON(`https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
    `&per-page=${rows}${s}&mailto=${encodeURIComponent(MAIL)}`);
  return (j?.results ?? []).map((d: any) => rec({
    source: sort === "cited" ? "openalex-canon" : sort === "earliest" ? "openalex-origins" : "openalex",
    source_id: `oa:${String(d.id ?? "").split("/").pop()}`,
    title: clean(d.display_name), abstract: deInvert(d.abstract_inverted_index),
    authors: (d.authorships ?? []).slice(0, 8).map((a: any) => clean(a.author?.display_name)).filter(Boolean).join(", "),
    url: d.doi ? String(d.doi) : (d.id ?? ""),
    published_at: d.publication_date ?? null, year: d.publication_year ?? yearOf(d.publication_date),
    citations: typeof d.cited_by_count === "number" ? d.cited_by_count : null,
    venue: clean(d.primary_location?.source?.display_name),
    institutions: [...new Set((d.authorships ?? []).flatMap((a: any) =>
      (a.institutions ?? []).map((i: any) => clean(i.display_name))).filter(Boolean))].slice(0, 6) as string[],
    oa: d.open_access?.is_oa ?? null,
    concepts: (d.concepts ?? []).slice(0, 5).map((c: any) => clean(c.display_name)).filter(Boolean),
  })).filter((x: Rec) => x.title);
}

async function fromCrossref(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}` +
    `&rows=${rows}&sort=relevance&filter=type:journal-article&mailto=${encodeURIComponent(MAIL)}`);
  return (j?.message?.items ?? []).map((d: any) => {
    const dp = d.issued?.["date-parts"]?.[0] ?? [];
    const iso = dp.length ? `${dp[0]}-${String(dp[1] ?? 1).padStart(2, "0")}-${String(dp[2] ?? 1).padStart(2, "0")}` : null;
    return rec({
      source: "crossref", source_id: `doi:${d.DOI}`, title: clean((d.title ?? [""])[0]),
      abstract: clean(d.abstract).slice(0, 4000),
      authors: (d.author ?? []).slice(0, 8).map((a: any) => `${a.given ?? ""} ${a.family ?? ""}`.trim()).join(", "),
      url: `https://doi.org/${d.DOI}`, published_at: iso, year: dp[0] ?? null,
      citations: typeof d["is-referenced-by-count"] === "number" ? d["is-referenced-by-count"] : null,
      venue: clean((d["container-title"] ?? [""])[0]),
    });
  }).filter((x: Rec) => x.title);
}

async function fromSemanticScholar(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}` +
    `&limit=${rows}&fields=title,abstract,year,citationCount,venue,externalIds,authors,publicationDate,openAccessPdf`);
  return (j?.data ?? []).map((d: any) => rec({
    source: "semanticscholar", source_id: `s2:${d.paperId ?? d.externalIds?.DOI ?? d.title}`,
    title: clean(d.title), abstract: clean(d.abstract).slice(0, 4000),
    authors: (d.authors ?? []).slice(0, 8).map((a: any) => clean(a.name)).join(", "),
    url: d.externalIds?.DOI ? `https://doi.org/${d.externalIds.DOI}` : `https://www.semanticscholar.org/paper/${d.paperId}`,
    published_at: d.publicationDate ?? (d.year ? `${d.year}-01-01` : null), year: d.year ?? null,
    citations: typeof d.citationCount === "number" ? d.citationCount : null,
    venue: clean(d.venue), oa: !!d.openAccessPdf,
  })).filter((x: Rec) => x.title);
}

async function fromInspire(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://inspirehep.net/api/literature?q=${encodeURIComponent(q)}` +
    `&size=${rows}&sort=mostcited&fields=titles,abstracts,earliest_date,citation_count,authors,publication_info,dois`);
  return (j?.hits?.hits ?? []).map((h: any) => {
    const m = h.metadata ?? {};
    return rec({
      source: "inspire", source_id: `inspire:${h.id}`,
      title: clean(m.titles?.[0]?.title), abstract: clean(m.abstracts?.[0]?.value).slice(0, 4000),
      authors: (m.authors ?? []).slice(0, 8).map((a: any) => clean(a.full_name)).join(", "),
      url: m.dois?.[0]?.value ? `https://doi.org/${m.dois[0].value}` : `https://inspirehep.net/literature/${h.id}`,
      published_at: m.earliest_date ?? null, year: yearOf(m.earliest_date),
      citations: typeof m.citation_count === "number" ? m.citation_count : null,
      venue: clean(m.publication_info?.[0]?.journal_title) || "INSPIRE-HEP",
    });
  }).filter((x: Rec) => x.title);
}

async function fromEuropePMC(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}` +
    `&format=json&pageSize=${rows}&resultType=core&sort=CITED%20desc`);
  return (j?.resultList?.result ?? []).map((d: any) => rec({
    source: "europepmc", source_id: `epmc:${d.id ?? d.doi ?? d.title}`,
    title: clean(d.title), abstract: clean(d.abstractText).slice(0, 4000),
    authors: clean(d.authorString), url: d.doi ? `https://doi.org/${d.doi}`
      : `https://europepmc.org/article/${d.source}/${d.id}`,
    published_at: d.firstPublicationDate ?? (d.pubYear ? `${d.pubYear}-01-01` : null),
    year: d.pubYear ? Number(d.pubYear) : null,
    citations: typeof d.citedByCount === "number" ? d.citedByCount : null,
    venue: clean(d.journalTitle), oa: d.isOpenAccess === "Y",
  })).filter((x: Rec) => x.title);
}

async function fromDOAJ(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://doaj.org/api/search/articles/${encodeURIComponent(q)}?pageSize=${rows}`);
  return (j?.results ?? []).map((d: any) => {
    const bib = d.bibjson ?? {};
    return rec({
      source: "doaj", source_id: `doaj:${d.id}`, title: clean(bib.title),
      abstract: clean(bib.abstract).slice(0, 4000),
      authors: (bib.author ?? []).slice(0, 8).map((a: any) => clean(a.name)).join(", "),
      url: (bib.link ?? [])[0]?.url ?? `https://doaj.org/article/${d.id}`,
      published_at: bib.year ? `${bib.year}-01-01` : null, year: bib.year ? Number(bib.year) : null,
      venue: clean(bib.journal?.title), oa: true,
    });
  }).filter((x: Rec) => x.title);
}

async function fromDatacite(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://api.datacite.org/dois?query=${encodeURIComponent(q)}&page[size]=${rows}`);
  return (j?.data ?? []).map((d: any) => {
    const a = d.attributes ?? {};
    return rec({
      source: "datacite", source_id: `dc:${a.doi}`, title: clean((a.titles ?? [{}])[0]?.title),
      abstract: clean((a.descriptions ?? [{}])[0]?.description).slice(0, 4000),
      authors: (a.creators ?? []).slice(0, 8).map((c: any) => clean(c.name)).join(", "),
      url: `https://doi.org/${a.doi}`,
      published_at: a.publicationYear ? `${a.publicationYear}-01-01` : null,
      year: a.publicationYear ?? null, venue: clean(a.publisher) || "dataset / software",
      oa: true,
    });
  }).filter((x: Rec) => x.title);
}

async function fromHAL(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://api.archives-ouvertes.fr/search/?q=${encodeURIComponent(q)}` +
    `&rows=${rows}&fl=title_s,abstract_s,producedDateY_i,uri_s,authFullName_s,journalTitle_s&wt=json`);
  return (j?.response?.docs ?? []).map((d: any) => rec({
    source: "hal", source_id: `hal:${d.uri_s}`, title: clean((d.title_s ?? [""])[0]),
    abstract: clean((d.abstract_s ?? [""])[0]).slice(0, 4000),
    authors: (d.authFullName_s ?? []).slice(0, 8).join(", "), url: d.uri_s ?? "",
    published_at: d.producedDateY_i ? `${d.producedDateY_i}-01-01` : null,
    year: d.producedDateY_i ?? null, venue: clean(d.journalTitle_s) || "HAL", oa: true,
  })).filter((x: Rec) => x.title);
}

async function fromADS(q: string, rows: number, by = "score desc"): Promise<Rec[]> {
  if (!ADS) return [];
  const j = await getJSON(`https://api.adsabs.harvard.edu/v1/search/query?q=${encodeURIComponent(q)}` +
    `&fl=bibcode,title,abstract,author,date,citation_count,pub,year&rows=${rows}&sort=${encodeURIComponent(by)}`,
    { Authorization: `Bearer ${ADS}` });
  return (j?.response?.docs ?? []).map((d: any) => rec({
    source: "ads", source_id: `ads:${d.bibcode}`, title: clean((d.title ?? [""])[0]),
    abstract: clean(d.abstract).slice(0, 4000), authors: (d.author ?? []).slice(0, 8).join(", "),
    url: `https://ui.adsabs.harvard.edu/abs/${d.bibcode}`, published_at: d.date ?? null,
    year: d.year ? Number(d.year) : yearOf(d.date),
    citations: typeof d.citation_count === "number" ? d.citation_count : null,
    venue: clean(d.pub),
  })).filter((x: Rec) => x.title);
}

// ---------------------------------------------------------------------------
// query construction. The model returns TERMS; the query is assembled here, so
// it cannot be over-narrowed into an empty result set.
// ---------------------------------------------------------------------------
const STOP = new Set(("a an the of in on for to and or with that this is are was were be been being do does did " +
  "what why how which when where can could should would there their it its we i my about any new from at by vs " +
  "versus have has had not no than then so such as into over under between").split(" "));
function qTerms(text: string): string[] {
  const raw = String(text).replace(/[^A-Za-z0-9\-\s]/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of raw) {
    const low = w.toLowerCase();
    if (STOP.has(low)) continue;
    const keep = low.length > 2 || /[0-9]/.test(w) || (w.length >= 2 && w === w.toUpperCase());
    if (keep && out.indexOf(low) < 0) out.push(low);
  }
  return out.slice(0, 8);
}
function grp(terms: string[]): string {
  const parts = terms.map((t) => String(t).replace(/["\\]/g, " ").trim()).filter(Boolean)
    .map((v) => (v.includes(" ") ? `all:"${v}"` : `all:${v}`));
  return parts.length ? "(" + parts.join(" OR ") + ")" : "";
}
const plain = (terms: string[]) => terms.map((t) => String(t).replace(/["\\]/g, " ").trim()).filter(Boolean).join(" ");

async function interpret(question: string) {
  if (!ANT) return null;
  const prompt =
    `Translate this scientific question into a literature-search profile.\n\n` +
    `QUESTION: ${question}\n\n` +
    `Return ONLY JSON:\n` +
    `{"field":"short field name",` +
    `"terms":["4-7 search terms or short phrases the literature on this actually uses"],` +
    `"core":["the 2-3 most central of those terms"],` +
    `"ads":"an ADS query for the same topic",` +
    `"quantity":{"sym":"symbol","name":"the measurable quantity a claim here would rest on","unit":"unit or empty"},` +
    `"tracked":["3-5 specific quantities/claims to watch"]}\n\n` +
    `Rules:\n` +
    `- The input may be a bare topic ("parallel universes", "photosynthesis", "dark matter", ` +
    `"CRISPR off-target effects") or a full question. Both must work, in ANY field of science - ` +
    `physics, astronomy, chemistry, biology, earth science, computer science, mathematics.\n` +
    `- Map colloquial phrasing to the terms researchers publish under (parallel universes -> multiverse, ` +
    `eternal inflation, many-worlds; time travel -> closed timelike curves, wormholes).\n` +
    `- "terms" are TERMS, not a query. Do not write AND, OR, parentheses, cat: or any prefix. ` +
    `Do not include qualifier words like testable, observational, constraints, signatures - ` +
    `they narrow the search to nothing and the search then returns whatever is merely recent.\n` +
    `- Never return stopwords, and never return an empty list.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANT, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 700, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) { console.log("interpret", r.status, await r.text()); return null; }
  const j = await r.json();
  const m = (j.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function scoreRecord(rc: any, watch: { name: string; tracked: string[] }) {
  if (!ANT) return null;
  const prompt =
    `You are the relevance gate of a research-monitoring system. Be useful, not pedantic.\n` +
    `Research question: ${watch.name}\nTracked quantities:\n- ${watch.tracked.join("\n- ")}\n\n` +
    `New record:\nTITLE: ${rc.title}\n${rc.year ? `YEAR: ${rc.year}\n` : ""}ABSTRACT: ${String(rc.abstract || "").slice(0, 1800)}\n\n` +
    `Score relevance on this calibration:\n` +
    `0.85-1.0 directly addresses the question or measures a tracked quantity\n` +
    `0.60-0.84 same subfield, bears on the question's premises, methods or competing explanations\n` +
    `0.40-0.59 adjacent: shares the physical system or observable but a different target\n` +
    `0.15-0.39 same broad field only\n` +
    `0.0-0.14 unrelated\n` +
    `An older paper is not less relevant for being old - a 1935 paper that founded the question ` +
    `scores high. Judge the content, not the date.\n` +
    `Set "relevant" true whenever relevance >= 0.40.\n` +
    `Set "material" true only if it reports a NEW measurement, constraint, bound or explicit contradiction.\n` +
    `Set "role" to how the record functions for this question: "founding" | "canonical" | "current" | "method" | "review" | "peripheral".\n\n` +
    `Return ONLY JSON: {"relevance":0..1,"relevant":bool,"touches":[strings],` +
    `"stance":"supports"|"contests"|"neutral","position":"the explanation or claim this paper backs, <=12 words",` +
    `"role":"founding|canonical|current|method|review|peripheral",` +
    `"measurement":{"parameter":str,"value":str,"sigma":str}|null,"material":bool,"why":"one sentence"}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANT, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) { console.log("score", r.status); return null; }
  const j = await r.json();
  const m = (j.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function synthesize(question: string, recs: any[]) {
  if (!ANT || !recs.length) return null;
  const digest = recs.slice(0, 16).map((r, i) =>
    `[${i + 1}] ${r.year ?? "n/a"} | ${r.citations != null ? r.citations + " cites" : "cites n/a"} | ${r.title} | ${String(r.abstract || "").slice(0, 320)}`
  ).join("\n");
  const prompt =
    `You are summarising the live literature on a research question for a researcher. The records span ` +
    `the whole history of the question, not just recent work.\n\n` +
    `QUESTION: ${question}\n\nRECORDS:\n${digest}\n\n` +
    `Return ONLY JSON:\n` +
    `{"state":"3-4 sentences on where this question actually stands, naming the real constraints",\n` +
    ` "arc":"2-3 sentences on how the question got here: what founded it, what changed it, what is driving it now",\n` +
    ` "findings":[{"t":"the finding, one sentence","why":"why it matters","ev":"which records support it","conf":"high|moderate|low"}],\n` +
    ` "positions":[{"n":"short name of the competing explanation","d":"one sentence","support":0-100,` +
    `"ex":"what it explains","fx":"what conflicts with it","test":"the observation that would settle it"}],\n` +
    ` "contested":[{"point":"the disagreement","a":"one side","b":"the other side"}],\n` +
    ` "quantities":[{"sym":"symbol","name":"quantity","value":"best current value or bound","src":"source"}],\n` +
    ` "nextTest":"the single most decisive observation or analysis",\n` +
    ` "gaps":["what is missing to answer this question"]}\n\n` +
    `Give 2-4 findings, 2-3 positions with support summing near 100, 1-3 contested points, ` +
    `and up to 4 quantities. Be concrete and cite record numbers in "ev". Never invent measurements ` +
    `that are not in the records.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANT, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2200, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) { console.log("synth", r.status, await r.text()); return null; }
  const j = await r.json();
  const m = (j.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    return await handle(req);
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e), worker: WORKER_VERSION }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

async function handle(req: Request): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch { /* cron sends nothing */ }

  // ---------- mode 2: live on-demand research for one typed question ----------
  if (body && (body.q || body.question)) {
    const asked = String(body.question || body.name || body.q).slice(0, 400);
    const limit = Math.min(Number(body.limit) || 12, 40);

    const prof = await interpret(asked);
    const watch = {
      name: asked,
      tracked: ((prof?.tracked && prof.tracked.length ? prof.tracked : (body.tracked || [])) as any[])
        .slice(0, 6).map((t: any) => String(t).slice(0, 200)),
    };
    if (!watch.tracked.length) {
      watch.tracked = ["primary measured quantity", "competing explanations", "systematic uncertainties"];
    }

    const iTerms: string[] = Array.isArray(prof?.terms) ? prof.terms.map(String).slice(0, 7) : [];
    const own = qTerms(asked);
    const arxA = grp(iTerms.length ? iTerms : own);
    const arxB = grp(own);
    const free = plain(iTerms.length ? iTerms.slice(0, 5) : own);
    const freeOwn = own.join(" ");
    const per = Math.max(6, Math.ceil(limit / 2));

    // Ten archives, three of them historical passes, all at once. Any single
    // failure is recorded in the ledger and the rest of the sweep continues.
    const jobs: { name: string; note: string; run: () => Promise<Rec[]> }[] = [
      { name: "arxiv", note: "preprints 1991-", run: () => fromArxiv(arxA, per) },
      { name: "arxiv/your-words", note: "your exact words", run: () => fromArxiv(arxB, Math.ceil(per / 2)) },
      { name: "openalex", note: "all disciplines, 1600s-", run: () => fromOpenAlex(free, per, "relevance") },
      { name: "openalex/canon", note: "most-cited of all time", run: () => fromOpenAlex(free, Math.ceil(per / 2), "cited") },
      { name: "openalex/origins", note: "earliest on record", run: () => fromOpenAlex(free, Math.ceil(per / 2), "earliest") },
      { name: "crossref", note: "journals of record", run: () => fromCrossref(free || freeOwn, per) },
      { name: "semanticscholar", note: "citation graph", run: () => fromSemanticScholar(free || freeOwn, per) },
      { name: "inspire", note: "particle physics 1900s-", run: () => fromInspire(free || freeOwn, Math.ceil(per / 2)) },
      { name: "europepmc", note: "life sciences 1781-", run: () => fromEuropePMC(free || freeOwn, Math.ceil(per / 2)) },
      { name: "ads", note: "astronomy 1820s-", run: () => fromADS(String(prof?.ads || free || freeOwn), Math.ceil(per / 2)) },
      { name: "doaj", note: "open-access journals", run: () => fromDOAJ(free || freeOwn, Math.ceil(per / 3)) },
      { name: "datacite", note: "datasets & software", run: () => fromDatacite(free || freeOwn, Math.ceil(per / 3)) },
      { name: "hal", note: "European repositories", run: () => fromHAL(free || freeOwn, Math.ceil(per / 3)) },
    ];

    const t0 = Date.now();
    const settled = await Promise.allSettled(jobs.map(async (jb) => {
      const s = Date.now();
      const rows = await jb.run();
      return { name: jb.name, note: jb.note, got: rows.length, ms: Date.now() - s, rows };
    }));

    const archives: any[] = [];
    const found: Rec[] = [];
    const seen = new Set<string>();
    const seenTitle = new Set<string>();
    settled.forEach((r, i) => {
      if (r.status !== "fulfilled") {
        archives.push({ name: jobs[i].name, note: jobs[i].note, got: 0, ms: 0, error: String((r as any).reason?.message ?? (r as any).reason).slice(0, 120) });
        return;
      }
      archives.push({ name: r.value.name, note: r.value.note, got: r.value.got, ms: r.value.ms });
      for (const rc of r.value.rows) {
        const key = rc.source_id;
        const tkey = rc.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 70);
        if (!key || seen.has(key) || (tkey && seenTitle.has(tkey))) continue;
        seen.add(key); if (tkey) seenTitle.add(tkey);
        found.push(rc);
      }
    });
    const sweepMs = Date.now() - t0;
    const usedRungs = [
      `arXiv: ${arxA}`,
      arxB && arxB !== arxA ? `arXiv, your words: ${arxB}` : "",
      `free text across 8 archives: ${free || freeOwn}`,
    ].filter(Boolean);

    // Keep the historical spread when trimming: never let the recent wave crowd
    // out the origins and the canon.
    const byYear = [...found].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    const byCites = [...found].sort((a, b) => (b.citations ?? -1) - (a.citations ?? -1));
    const cap = Math.min(Math.max(limit, 18), 30);
    const keep: Rec[] = [];
    const inKeep = new Set<string>();
    const take = (arr: Rec[], n: number) => {
      let added = 0;
      for (const r of arr) {
        if (keep.length >= cap || added >= n) break;
        if (inKeep.has(r.source_id)) continue;
        inKeep.add(r.source_id); keep.push(r); added++;
      }
    };
    take(byCites, Math.ceil(cap * 0.35));   // the canon
    take(byYear, Math.ceil(cap * 0.2));     // the origins
    take(found, cap);                        // everything else, in archive order

    const scored: any[] = await Promise.all(keep.map(async (rc) => {
      let v: any = null;
      try { v = await scoreRecord(rc, watch); } catch (_) { v = null; }
      return {
        source: rc.source, source_id: rc.source_id, title: rc.title, url: rc.url,
        published_at: rc.published_at, year: rc.year, citations: rc.citations,
        venue: rc.venue, institutions: rc.institutions, oa: rc.oa, concepts: rc.concepts,
        relevance: v?.relevance ?? null, relevant: v?.relevant ?? null,
        material: !!v?.material, why: v?.why ?? "", measurement: v?.measurement ?? null,
        stance: v?.stance ?? null, position: v?.position ?? null, role: v?.role ?? null,
      };
    }));
    scored.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));

    if (body.store && keep.length) {
      // the records table only has the original columns
      await sb("records?on_conflict=source_id", "POST", keep.map((r) => ({
        source: r.source, source_id: r.source_id, title: r.title, abstract: r.abstract,
        authors: r.authors, url: r.url, published_at: r.published_at,
      })), "resolution=ignore-duplicates,return=minimal");
    }

    const forSynth = keep.filter((f) => {
      const sc = scored.find((x) => x.source_id === f.source_id);
      return sc && (sc.relevance ?? 0) >= 0.4;
    });
    let synthesis: any = null;
    try { synthesis = await synthesize(asked, (forSynth.length ? forSynth : keep.slice(0, 8))); } catch (_) { synthesis = null; }

    return new Response(JSON.stringify({
      mode: "search", question: asked, synthesis, worker: WORKER_VERSION,
      profile: prof ? {
        field: prof.field ?? "", quantity: prof.quantity ?? null,
        tracked: watch.tracked, terms: iTerms, ads: prof.ads ?? "",
      } : null,
      query: usedRungs[0] ?? asked, rungs: usedRungs,
      archives, sweepMs,
      pulled: found.length, scored: scored.length,
      relevant: scored.filter((r) => r.relevant).length,
      material: scored.filter((r) => r.material).length,
      results: scored,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  // ---------- mode 1: scheduled sweep over stored watches ----------
  let watches: any[] = [];
  try {
    const rows = await sb("watches?select=name,query,tracked&active=is.true");
    if (Array.isArray(rows) && rows.length) {
      watches = rows.map((w: any) => ({
        name: w.name, q: w.query,
        tracked: Array.isArray(w.tracked) ? w.tracked : DEFAULT_WATCH.tracked,
      }));
    }
  } catch { /* watches table may not exist yet */ }
  if (!watches.length) watches = [DEFAULT_WATCH];

  let pulled = 0;
  for (const w of watches) {
    const parts = await Promise.allSettled([
      fromArxiv(w.q, 25, "submittedDate"),
      fromADS(w.q, 25, "date desc"),
    ]);
    const found = parts.flatMap((p) => (p.status === "fulfilled" ? p.value : []));
    pulled += found.length;
    if (found.length) {
      await sb("records?on_conflict=source_id", "POST", found.map((r) => ({
        source: r.source, source_id: r.source_id, title: r.title, abstract: r.abstract,
        authors: r.authors, url: r.url, published_at: r.published_at,
      })), "resolution=ignore-duplicates,return=minimal");
    }
  }

  const fresh: any[] = (await sb("records?status=eq.new&order=fetched_at.desc&limit=8")) ?? [];
  let scored = 0, material = 0;
  for (const rc of fresh) {
    const v = await scoreRecord(rc, watches[0]);
    if (!v) { await sb(`records?id=eq.${rc.id}`, "PATCH", { status: "scored" }); continue; }
    await sb(`records?id=eq.${rc.id}`, "PATCH", {
      status: "scored", relevance: v.relevance ?? 0,
      relevant: !!v.relevant, material: !!v.material, extraction: v,
    });
    scored++;
    if (v.material) {
      material++;
      await sb("findings", "POST", {
        record_id: rc.id, kind: "material-change",
        title: rc.title?.slice(0, 200), why: v.why ?? "", severity: 2,
      }, "return=minimal");
    }
  }
  return new Response(JSON.stringify({ mode: "sweep", worker: WORKER_VERSION, watches: watches.length, pulled, scored, material }),
    { headers: { ...CORS, "Content-Type": "application/json" } });
}
