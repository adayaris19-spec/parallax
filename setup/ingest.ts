// PARALLAX ingest worker v10 — paste into the Supabase Edge Function named `ingest`.
//
// v10 is v9's perimeter, made deliverable. v9 tried to run all ~124 passes in a
// single invocation and the platform killed the isolate: an Edge Function has a
// CPU and a wall-clock budget, and when it is exceeded the error the platform
// returns carries no CORS header, so the browser reports the whole thing as
// "Failed to fetch" with nothing to debug.
//
// So the perimeter is SHARDED. The client calls this function `slices` times in
// parallel with the same question:
//   * slice 0 runs the 17 core passes and does all the expensive work —
//     interpreting the question, the relevance gate, the synthesis, the store.
//     That is the same shape as v8, which fitted comfortably.
//   * slices 1..n run a share of the historical ladder, dealt round-robin so no
//     slice inherits a whole archive. They make NO model calls at all: they hand
//     back their share of the corpus and their share of the ledger, and the
//     client merges them into the corpus slice 0 already returned. The page
//     fills in as they land instead of waiting for all of them.
// Both paths are backwards compatible: call it with no `slices` and it runs the
// whole perimeter in one invocation exactly as v9 did.
//
// What changed in v9
//   * Eighteen archives across ~124 passes. Five new archives — OSTI (US
//     national laboratories), NTRS (NASA technical reports), the CERN Document
//     Server, DBLP (computer science) and PLOS — joined the thirteen from v8.
//   * The HISTORICAL LADDER. A relevance sort stops wherever the index decides
//     it stops, and what it drops is always the old work. So every archive that
//     can filter by date gets one reservation per era: one window for everything
//     before 1930 - which reaches the 1600s - then every decade to the 2020s. OpenAlex, Crossref, ADS, Semantic Scholar, Europe
//     PMC, PubMed, INSPIRE and arXiv all run the ladder. That is what puts a
//     1934 paper and a preprint from this month in the same corpus.
//   * Each archive has its own politeness budget, so the sweep runs one queue
//     per host rather than one flat fan-out, and a deadline means a slow index
//     gets recorded as skipped instead of holding the sweep hostage.
//
// What changed in v8
//   * Thirteen archives across nineteen passes, each pulling far more rows.
//     PubMed, OpenAIRE and Zenodo joined the ten from v7.
//   * The expensive part was never the fetching, it was the relevance gate: one
//     Claude call per record. So the sweep now separates the two. EVERY record
//     retrieved comes back in `corpus` with its year, citations, venue,
//     institutions and open-access status - that is what the field analysis,
//     the era structure, the canon, the concentration and the deep read run on,
//     and none of it needs a model. Only the top slice is sent through the gate
//     and comes back in `results`. Coverage went up roughly fivefold at the same
//     cost per sweep.
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
const WORKER_VERSION = 12;

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
  return words.join(" ").replace(/\s+/g, " ").trim().slice(0, 1800);
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
  /* Which OTHER archives independently returned this same record. Deduping
     without recording this throws away the most useful thing a wide perimeter
     knows: a paper five archives found on their own is a different object from
     one only Zenodo has, and which archive holds records nobody else does is
     the only honest answer to "what is this archive here for". */
  also?: string[];
};
const rec = (o: Partial<Rec>): Rec => ({
  source: "", source_id: "", title: "", abstract: "", authors: "", url: "",
  published_at: null, year: null, citations: null, venue: "",
  institutions: [], oa: null, concepts: [], ...o,
});

/* Every window is a closed year range, inclusive. Passing one turns a pass into
   a historical slice, which is how a 1930s paper and this month's preprint end
   up on the same figure instead of the recent wave crowding the origins out. */
type Win = [number, number] | undefined;

async function fromArxiv(q: string, rows: number, by: "relevance" | "submittedDate" = "relevance", win?: Win): Promise<Rec[]> {
  const w = win ? ` AND submittedDate:[${win[0]}01010000 TO ${win[1]}12312359]` : "";
  const xml = await getText(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q + w)}` +
    `&sortBy=${by}&sortOrder=descending&max_results=${rows}`);
  const out: Rec[] = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const id = (pick(entry, "id").split("/abs/")[1] ?? "").trim();
    if (!id) continue;
    const pub = pick(entry, "published") || null;
    out.push(rec({
      source: "arxiv", source_id: `arxiv:${id}`, title: pick(entry, "title"),
      abstract: pick(entry, "summary").slice(0, 1800),
      authors: [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).slice(0, 8).join(", "),
      url: `https://arxiv.org/abs/${id}`, published_at: pub, year: yearOf(pub),
      venue: "arXiv preprint", oa: true,
    }));
  }
  return out;
}

async function fromOpenAlex(q: string, rows: number, sort: "relevance" | "cited" | "earliest" | "recent", win?: Win, extra?: string): Promise<Rec[]> {
  const s = sort === "cited" ? "&sort=cited_by_count:desc"
    : sort === "earliest" ? "&sort=publication_date:asc"
    : sort === "recent" ? "&sort=publication_date:desc" : "";
  const f: string[] = [];
  if (win) f.push(`from_publication_date:${win[0]}-01-01`, `to_publication_date:${win[1]}-12-31`);
  if (extra) f.push(extra);
  const j = await getJSON(`https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
    `&per-page=${rows}${s}${f.length ? `&filter=${f.join(",")}` : ""}&mailto=${encodeURIComponent(MAIL)}`);
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

async function fromCrossref(q: string, rows: number, sort: "relevance" | "cited" | "oldest" = "relevance", win?: Win, type = "journal-article"): Promise<Rec[]> {
  const s = sort === "cited" ? "is-referenced-by-count&order=desc"
    : sort === "oldest" ? "published&order=asc" : "relevance";
  const f = [`type:${type}`];
  if (win) f.push(`from-pub-date:${win[0]}-01-01`, `until-pub-date:${win[1]}-12-31`);
  const j = await getJSON(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}` +
    `&rows=${rows}&sort=${s}&filter=${f.join(",")}&mailto=${encodeURIComponent(MAIL)}`);
  return (j?.message?.items ?? []).map((d: any) => {
    const dp = d.issued?.["date-parts"]?.[0] ?? [];
    const iso = dp.length ? `${dp[0]}-${String(dp[1] ?? 1).padStart(2, "0")}-${String(dp[2] ?? 1).padStart(2, "0")}` : null;
    return rec({
      source: "crossref", source_id: `doi:${d.DOI}`, title: clean((d.title ?? [""])[0]),
      abstract: clean(d.abstract).slice(0, 1800),
      authors: (d.author ?? []).slice(0, 8).map((a: any) => `${a.given ?? ""} ${a.family ?? ""}`.trim()).join(", "),
      url: `https://doi.org/${d.DOI}`, published_at: iso, year: dp[0] ?? null,
      citations: typeof d["is-referenced-by-count"] === "number" ? d["is-referenced-by-count"] : null,
      venue: clean((d["container-title"] ?? [""])[0]),
    });
  }).filter((x: Rec) => x.title);
}

async function fromSemanticScholar(q: string, rows: number, win?: Win, oaOnly = false): Promise<Rec[]> {
  const j = await getJSON(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}` +
    `&limit=${rows}${win ? `&year=${win[0]}-${win[1]}` : ""}${oaOnly ? "&openAccessPdf=" : ""}` +
    `&fields=title,abstract,year,citationCount,venue,externalIds,authors,publicationDate,openAccessPdf`);
  return (j?.data ?? []).map((d: any) => rec({
    source: "semanticscholar", source_id: `s2:${d.paperId ?? d.externalIds?.DOI ?? d.title}`,
    title: clean(d.title), abstract: clean(d.abstract).slice(0, 1800),
    authors: (d.authors ?? []).slice(0, 8).map((a: any) => clean(a.name)).join(", "),
    url: d.externalIds?.DOI ? `https://doi.org/${d.externalIds.DOI}` : `https://www.semanticscholar.org/paper/${d.paperId}`,
    published_at: d.publicationDate ?? (d.year ? `${d.year}-01-01` : null), year: d.year ?? null,
    citations: typeof d.citationCount === "number" ? d.citationCount : null,
    venue: clean(d.venue), oa: !!d.openAccessPdf,
  })).filter((x: Rec) => x.title);
}

async function fromInspire(q: string, rows: number, sort = "mostcited", win?: Win): Promise<Rec[]> {
  const w = win ? ` and de ${win[0]}->${win[1]}` : "";
  const j = await getJSON(`https://inspirehep.net/api/literature?q=${encodeURIComponent(q + w)}` +
    `&size=${rows}&sort=${sort}&fields=titles,abstracts,earliest_date,citation_count,authors,publication_info,dois`);
  return (j?.hits?.hits ?? []).map((h: any) => {
    const m = h.metadata ?? {};
    return rec({
      source: "inspire", source_id: `inspire:${h.id}`,
      title: clean(m.titles?.[0]?.title), abstract: clean(m.abstracts?.[0]?.value).slice(0, 1800),
      authors: (m.authors ?? []).slice(0, 8).map((a: any) => clean(a.full_name)).join(", "),
      url: m.dois?.[0]?.value ? `https://doi.org/${m.dois[0].value}` : `https://inspirehep.net/literature/${h.id}`,
      published_at: m.earliest_date ?? null, year: yearOf(m.earliest_date),
      citations: typeof m.citation_count === "number" ? m.citation_count : null,
      venue: clean(m.publication_info?.[0]?.journal_title) || "INSPIRE-HEP",
    });
  }).filter((x: Rec) => x.title);
}

async function fromEuropePMC(q: string, rows: number, sort = "CITED desc", win?: Win, src = ""): Promise<Rec[]> {
  const w = (win ? ` AND (PUB_YEAR:[${win[0]} TO ${win[1]}])` : "") + (src ? ` AND (SRC:"${src}")` : "");
  const j = await getJSON(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q + w)}` +
    `&format=json&pageSize=${rows}&resultType=core&sort=${encodeURIComponent(sort)}`);
  return (j?.resultList?.result ?? []).map((d: any) => rec({
    source: "europepmc", source_id: `epmc:${d.id ?? d.doi ?? d.title}`,
    title: clean(d.title), abstract: clean(d.abstractText).slice(0, 1800),
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
      abstract: clean(bib.abstract).slice(0, 1800),
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
      abstract: clean((a.descriptions ?? [{}])[0]?.description).slice(0, 1800),
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
    abstract: clean((d.abstract_s ?? [""])[0]).slice(0, 1800),
    authors: (d.authFullName_s ?? []).slice(0, 8).join(", "), url: d.uri_s ?? "",
    published_at: d.producedDateY_i ? `${d.producedDateY_i}-01-01` : null,
    year: d.producedDateY_i ?? null, venue: clean(d.journalTitle_s) || "HAL", oa: true,
  })).filter((x: Rec) => x.title);
}

async function fromADS(q: string, rows: number, by = "score desc", win?: Win): Promise<Rec[]> {
  if (!ADS) return [];
  const w = win ? ` year:${win[0]}-${win[1]}` : "";
  const j = await getJSON(`https://api.adsabs.harvard.edu/v1/search/query?q=${encodeURIComponent(q + w)}` +
    `&fl=bibcode,title,abstract,author,date,citation_count,pub,year&rows=${rows}&sort=${encodeURIComponent(by)}`,
    { Authorization: `Bearer ${ADS}` });
  return (j?.response?.docs ?? []).map((d: any) => rec({
    source: "ads", source_id: `ads:${d.bibcode}`, title: clean((d.title ?? [""])[0]),
    abstract: clean(d.abstract).slice(0, 1800), authors: (d.author ?? []).slice(0, 8).join(", "),
    url: `https://ui.adsabs.harvard.edu/abs/${d.bibcode}`, published_at: d.date ?? null,
    year: d.year ? Number(d.year) : yearOf(d.date),
    citations: typeof d.citation_count === "number" ? d.citation_count : null,
    venue: clean(d.pub),
  })).filter((x: Rec) => x.title);
}

async function fromPubMed(q: string, rows: number, win?: Win): Promise<Rec[]> {
  const w = win ? `&datetype=pdat&mindate=${win[0]}&maxdate=${win[1]}` : "";
  const se = await getJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed` +
    `&term=${encodeURIComponent(q)}&retmax=${rows}&retmode=json&sort=relevance${w}`);
  const ids: string[] = se?.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const su = await getJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed` +
    `&id=${ids.join(",")}&retmode=json`);
  const r = su?.result ?? {};
  return ids.map((id) => {
    const d = r[id]; if (!d) return null;
    return rec({
      source: "pubmed", source_id: `pmid:${id}`, title: clean(d.title),
      authors: (d.authors ?? []).slice(0, 8).map((a: any) => clean(a.name)).join(", "),
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      published_at: d.pubdate ? String(d.pubdate).slice(0, 10) : null, year: yearOf(d.pubdate),
      venue: clean(d.fulljournalname || d.source),
    });
  }).filter(Boolean) as Rec[];
}

async function fromOpenAIRE(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://api.openaire.eu/search/publications?keywords=${encodeURIComponent(q)}` +
    `&size=${rows}&format=json`);
  const res = j?.response?.results?.result ?? [];
  return (Array.isArray(res) ? res : [res]).map((it: any) => {
    const m = it?.metadata?.["oaf:entity"]?.["oaf:result"];
    if (!m) return null;
    const t = m.title; const title = clean(Array.isArray(t) ? (t[0]?.content ?? t[0]) : (t?.content ?? t));
    const d = String(m.dateofacceptance?.content ?? m.dateofacceptance ?? "");
    const pid = m.pid; const doi = Array.isArray(pid) ? pid.find((x: any) => x?.["@classid"] === "doi")?.content
      : (pid?.["@classid"] === "doi" ? pid.content : null);
    return rec({
      source: "openaire", source_id: `oaire:${doi ?? title.slice(0, 40)}`, title,
      url: doi ? `https://doi.org/${doi}` : "https://explore.openaire.eu/",
      published_at: d || null, year: yearOf(d), oa: true,
      venue: clean(m.journal?.content ?? m.journal ?? "OpenAIRE"),
    });
  }).filter((x: any) => x && x.title) as Rec[];
}

async function fromZenodo(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://zenodo.org/api/records?q=${encodeURIComponent(q)}&size=${rows}&sort=mostrecent`);
  return (j?.hits?.hits ?? []).map((d: any) => rec({
    source: "zenodo", source_id: `zen:${d.id}`, title: clean(d.metadata?.title),
    abstract: clean(d.metadata?.description).slice(0, 2000),
    authors: (d.metadata?.creators ?? []).slice(0, 8).map((c: any) => clean(c.name)).join(", "),
    url: d.links?.self_html ?? d.doi_url ?? "", published_at: d.metadata?.publication_date ?? null,
    year: yearOf(d.metadata?.publication_date), venue: clean(d.metadata?.resource_type?.title) || "Zenodo", oa: true,
  })).filter((x: Rec) => x.title);
}

/* Five archives that hold work the commercial indexes are thin on: national
   laboratory reports, NASA's own technical literature, CERN's document server,
   the computer-science bibliography, and PLOS's full-text corpus. All five are
   coded defensively - an unexpected response shape yields zero records and a
   line in the ledger, never a thrown sweep. */
async function fromOSTI(q: string, rows: number, win?: Win): Promise<Rec[]> {
  const w = win ? `&publication_date_start=01/01/${win[0]}&publication_date_end=12/31/${win[1]}` : "";
  const j = await getJSON(`https://www.osti.gov/api/v1/records?q=${encodeURIComponent(q)}&rows=${rows}${w}`);
  const arr = Array.isArray(j) ? j : (j?.records ?? []);
  return arr.map((d: any) => rec({
    source: "osti", source_id: `osti:${d.osti_id ?? d.id ?? d.doi}`, title: clean(d.title),
    abstract: clean(d.description ?? d.abstract).slice(0, 1800),
    authors: (Array.isArray(d.authors) ? d.authors : []).slice(0, 8).map((a: any) => clean(typeof a === "string" ? a : a?.name)).join(", "),
    url: d.doi ? `https://doi.org/${d.doi}` : (d.links?.[0]?.href ?? `https://www.osti.gov/biblio/${d.osti_id}`),
    published_at: d.publication_date ? String(d.publication_date).slice(0, 10) : null,
    year: yearOf(d.publication_date), venue: clean(d.journal_name || d.research_org) || "US DOE report", oa: true,
  })).filter((x: Rec) => x.title);
}

async function fromNTRS(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://ntrs.nasa.gov/api/citations/search?q=${encodeURIComponent(q)}&size=${rows}`);
  return (j?.results ?? []).map((d: any) => {
    const dt = d.publications?.[0]?.publicationDate ?? d.created ?? null;
    return rec({
      source: "ntrs", source_id: `ntrs:${d.id}`, title: clean(d.title),
      abstract: clean(d.abstract).slice(0, 1800),
      authors: (d.authorAffiliations ?? []).slice(0, 8).map((a: any) => clean(a?.meta?.author?.name)).filter(Boolean).join(", "),
      url: `https://ntrs.nasa.gov/citations/${d.id}`,
      published_at: dt ? String(dt).slice(0, 10) : null, year: yearOf(dt),
      venue: "NASA technical report", oa: true,
    });
  }).filter((x: Rec) => x.title);
}

async function fromCDS(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://cds.cern.ch/api/records?q=${encodeURIComponent(q)}&size=${rows}`);
  const hits = j?.hits?.hits ?? [];
  return hits.map((h: any) => {
    const m = h.metadata ?? h;
    const t = typeof m.title === "string" ? m.title : (m.title?.title ?? m.titles?.[0]?.title ?? "");
    const dt = m.publication_date ?? m.imprint?.date ?? null;
    return rec({
      source: "cds", source_id: `cds:${h.id ?? m.recid}`, title: clean(t),
      abstract: clean(m.description ?? m.abstract?.summary ?? m.abstracts?.[0]?.value).slice(0, 1800),
      authors: (m.creators ?? m.authors ?? []).slice(0, 8).map((a: any) => clean(a?.person_or_org?.name ?? a?.name ?? a?.full_name)).filter(Boolean).join(", "),
      url: `https://cds.cern.ch/record/${h.id ?? m.recid}`,
      published_at: dt ? String(dt).slice(0, 10) : null, year: yearOf(dt),
      venue: "CERN Document Server", oa: true,
    });
  }).filter((x: Rec) => x.title);
}

async function fromDBLP(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://dblp.org/search/publ/api?q=${encodeURIComponent(q)}&format=json&h=${rows}`);
  const hits = j?.result?.hits?.hit ?? [];
  return (Array.isArray(hits) ? hits : [hits]).map((h: any) => {
    const i = h?.info ?? {};
    const au = i.authors?.author;
    return rec({
      source: "dblp", source_id: `dblp:${h.id ?? i.key ?? i.doi}`, title: clean(i.title),
      authors: (Array.isArray(au) ? au : au ? [au] : []).slice(0, 8).map((a: any) => clean(a?.text ?? a)).join(", "),
      url: i.doi ? `https://doi.org/${i.doi}` : (i.ee ?? i.url ?? ""),
      published_at: i.year ? `${i.year}-01-01` : null, year: i.year ? Number(i.year) : null,
      venue: clean(i.venue) || "computer science", oa: i.access === "open",
    });
  }).filter((x: Rec) => x.title);
}

async function fromPLOS(q: string, rows: number): Promise<Rec[]> {
  const j = await getJSON(`https://api.plos.org/search?q=${encodeURIComponent(`everything:"${q}"`)}` +
    `&rows=${rows}&wt=json&fl=id,title,abstract,author_display,publication_date,journal`);
  return (j?.response?.docs ?? []).map((d: any) => rec({
    source: "plos", source_id: `plos:${d.id}`, title: clean(Array.isArray(d.title) ? d.title[0] : d.title),
    abstract: clean(Array.isArray(d.abstract) ? d.abstract[0] : d.abstract).slice(0, 1800),
    authors: (d.author_display ?? []).slice(0, 8).map(clean).join(", "),
    url: `https://doi.org/${d.id}`,
    published_at: d.publication_date ? String(d.publication_date).slice(0, 10) : null,
    year: yearOf(d.publication_date), venue: clean(Array.isArray(d.journal) ? d.journal[0] : d.journal) || "PLOS", oa: true,
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

/* A small perimeter, for the jobs that run two or more of them in one request.
   Eight passes over the archives that answer for every field, deduped, with its
   own ledger. Cheap enough that an adjudication can afford one per side. */
async function corePerimeter(free: string, adsQ: string, per: number, tag: string) {
  const half = Math.ceil(per / 2), third = Math.ceil(per / 3);
  const jobs: { name: string; run: () => Promise<Rec[]> }[] = [
    { name: `${tag}/openalex`, run: () => fromOpenAlex(free, per, "relevance") },
    { name: `${tag}/openalex-canon`, run: () => fromOpenAlex(free, half, "cited") },
    { name: `${tag}/openalex-origins`, run: () => fromOpenAlex(free, third, "earliest") },
    { name: `${tag}/arxiv`, run: () => fromArxiv(grp(qTerms(free)), half) },
    { name: `${tag}/crossref`, run: () => fromCrossref(free, half, "cited") },
    { name: `${tag}/ads`, run: () => fromADS(adsQ || free, half, "citation_count desc") },
    { name: `${tag}/s2`, run: () => fromSemanticScholar(free, half) },
    { name: `${tag}/inspire`, run: () => fromInspire(free, third) },
  ];
  const ledger: any[] = [];
  const rows: Rec[] = [];
  const seen = new Set<string>();
  await Promise.all(jobs.map(async (jb) => {
    const s = Date.now();
    try {
      const got = await jb.run();
      ledger.push({ name: jb.name, note: tag, got: got.length, ms: Date.now() - s });
      for (const r of got) {
        const k = r.source_id || r.title;
        if (!k || seen.has(k)) continue;
        seen.add(k); rows.push(r);
      }
    } catch (e) {
      ledger.push({ name: jb.name, note: tag, got: 0, ms: Date.now() - s, error: String((e as Error)?.message ?? e).slice(0, 110) });
    }
  }));
  rows.sort((a, b) => (b.citations ?? -1) - (a.citations ?? -1));
  return { rows, ledger };
}

const strip = (r: Rec) => ({
  source: r.source, source_id: r.source_id, title: r.title, url: r.url,
  published_at: r.published_at, year: r.year, citations: r.citations,
  venue: r.venue, institutions: r.institutions, oa: r.oa, concepts: r.concepts, authors: r.authors,
  also: r.also || [],
});
const digestOf = (rows: Rec[], n: number) =>
  rows.slice(0, n).map((r, i) =>
    `[${i + 1}] ${r.year ?? "n/a"} | ${r.citations != null ? r.citations + " cites" : "cites n/a"} | ${r.title} | ${String(r.abstract || "").slice(0, 260)}`
  ).join("\n");

async function ask(prompt: string, maxTokens: number) {
  if (!ANT) return null;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANT, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) { console.log("ask", r.status, await r.text()); return null; }
  const j = await r.json();
  const m = (j.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function handle(req: Request): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch { /* cron sends nothing */ }

  // ---------- mode 3: adjudicate two competing explanations ----------
  /* Not "search A, then search B". The point of putting two theories side by
     side is to find the observation that separates them, and that is exactly
     the thing a reader cannot do by scanning two reading lists: it needs both
     corpora in view at once. So both perimeters run, both digests go into one
     call, and what comes back is what each explains, what each cannot, what
     they are both on the hook for, and the measurements that would settle it. */
  if (body && body.mode === "adjudicate" && body.a && body.b) {
    const A = String(body.a).slice(0, 200), B = String(body.b).slice(0, 200);
    const ctx = String(body.question || "").slice(0, 300);
    const per = Math.min(Math.max(Number(body.limit) || 18, 10), 30);
    const t0 = Date.now();

    const [pa, pb] = await Promise.all([
      corePerimeter(A, A, per, "A"),
      corePerimeter(B, B, per, "B"),
    ]);

    const adjudication = await ask(
      `You are adjudicating between two competing explanations for a working scientist. ` +
      `Be concrete and be willing to say one is in trouble. Never invent a measurement.\n\n` +
      (ctx ? `CONTEXT QUESTION: ${ctx}\n` : "") +
      `EXPLANATION A: ${A}\nLITERATURE ON A:\n${digestOf(pa.rows, 14)}\n\n` +
      `EXPLANATION B: ${B}\nLITERATURE ON B:\n${digestOf(pb.rows, 14)}\n\n` +
      `Return ONLY JSON:\n` +
      `{"a":{"name":"short name","claim":"what it asserts, one sentence",` +
      `"explains":["what it accounts for that the other does not"],` +
      `"fails":["what it cannot account for, or what contradicts it"],` +
      `"rests_on":["the assumptions it needs to be true"],` +
      `"status":"established|contested|fringe|dormant","era":"when it was strongest"},\n` +
      ` "b":{same shape},\n` +
      ` "shared":["what BOTH must explain, and how each does"],\n` +
      ` "discriminators":[{"test":"the observation or experiment that separates them",` +
      `"predicts_a":"what A predicts for it","predicts_b":"what B predicts",` +
      `"status":"done|underway|proposed|infeasible","note":"why it is or is not decisive"}],\n` +
      ` "verdict":{"leaning":"a|b|neither","why":"2-3 sentences citing the records",` +
      `"confidence":"high|moderate|low"},\n` +
      ` "misframings":["ways this comparison is commonly posed that smuggle in a wrong assumption"]}\n\n` +
      `Give 2-4 items in each list and 2-4 discriminators. "neither" is a legitimate verdict ` +
      `and is the right one when the two are not actually rivals, or when nothing yet separates them.`,
      2400,
    );

    return new Response(JSON.stringify({
      mode: "adjudicate", worker: WORKER_VERSION, a: A, b: B, question: ctx,
      adjudication, sweepMs: Date.now() - t0,
      archives: pa.ledger.concat(pb.ledger),
      corpusA: pa.rows.map(strip), corpusB: pb.rows.map(strip),
      retrievedA: pa.rows.length, retrievedB: pb.rows.length,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  // ---------- mode 4: read the researcher's own work against the literature ----------
  /* The claims come out of their text first, then the perimeter is built from
     the terms those claims actually use - not from the whole manuscript, which
     retrieves the field rather than the argument. Then every claim is put back
     against what came back, and each one gets a standing: is this still true,
     is it contested, has someone already done it, is nothing behind it. */
  if (body && body.mode === "manuscript" && body.text) {
    const text = String(body.text).slice(0, 24000);
    const t0 = Date.now();

    const read = await ask(
      `Read this scientific text and extract the claims it makes. It may be an abstract, ` +
      `a draft, a grant section, a set of notes, or a bare list of statements.\n\n` +
      `TEXT:\n${text}\n\n` +
      `Return ONLY JSON:\n` +
      `{"title":"the working title or subject, <=14 words",` +
      `"field":"short field name",` +
      `"terms":["5-8 search terms the literature on this uses - TERMS, not a query, no AND/OR/parentheses"],` +
      `"claims":[{"text":"the claim as asserted, one sentence","kind":"empirical|theoretical|methodological|interpretive",` +
      `"load":"load-bearing|supporting|aside","quantity":"the measurable it rests on, or empty"}]}\n\n` +
      `Extract 3-10 claims. "load-bearing" means the argument collapses without it.`,
      1800,
    );
    if (!read || !Array.isArray(read.claims) || !read.claims.length) {
      return new Response(JSON.stringify({
        mode: "manuscript", worker: WORKER_VERSION,
        error: "no claims could be read out of that text - it may be too short, or not making assertions",
      }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const free = (Array.isArray(read.terms) && read.terms.length ? read.terms : qTerms(read.title || text))
      .map(String).slice(0, 7).join(" ");
    const per = Math.min(Math.max(Number(body.limit) || 22, 12), 34);
    const p = await corePerimeter(free, free, per, "ms");

    const audit = await ask(
      `You are checking a researcher's own claims against what the literature actually holds. ` +
      `Be useful and be blunt: it is more valuable to tell them a claim is already known, or ` +
      `already contradicted, than to be polite. Never invent a record.\n\n` +
      `THEIR SUBJECT: ${read.title ?? ""}\n` +
      `THEIR CLAIMS:\n${(read.claims as any[]).map((c: any, i: number) => `(${i + 1}) ${c.text}`).join("\n")}\n\n` +
      `THE LITERATURE:\n${digestOf(p.rows, 18)}\n\n` +
      `Return ONLY JSON:\n` +
      `{"claims":[{"i":1,"status":"supported|contested|unsupported|already-established|superseded",` +
      `"why":"one sentence, citing record numbers","records":[1,4],` +
      `"risk":"what breaks if this claim is wrong","action":"what to do about it - cite, soften, test, drop, or nothing"}],\n` +
      ` "novelty":"2-3 sentences on what in this is actually new against the retrieved record, and what is not",\n` +
      ` "missing":["work they should have cited and appear not to have"],\n` +
      ` "strongest":"which claim stands best, and on what",\n` +
      ` "weakest":"which claim is most exposed, and why",\n` +
      ` "nextTest":"the single most decisive thing they could do next"}\n\n` +
      `One entry per claim, in order. "already-established" means the literature already ` +
      `contains it, which is a finding about their novelty, not about their correctness.`,
      2600,
    );

    return new Response(JSON.stringify({
      mode: "manuscript", worker: WORKER_VERSION,
      title: read.title ?? "", field: read.field ?? "", terms: read.terms ?? [],
      claims: read.claims, audit, sweepMs: Date.now() - t0,
      archives: p.ledger, corpus: p.rows.map(strip), retrieved: p.rows.length,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  // ---------- mode 2: live on-demand research for one typed question ----------
  if (body && (body.q || body.question)) {
    const asked = String(body.question || body.name || body.q).slice(0, 400);
    const limit = Math.min(Number(body.limit) || 12, 40);

    /* SHARDING. One invocation cannot run a 124-pass perimeter: an Edge Function
       has a CPU and a wall-clock budget, and when the platform kills the isolate
       the error it returns carries no CORS header, so the browser reports the
       whole thing as "Failed to fetch" with nothing to debug. So the perimeter
       is split. The client calls this function `slices` times in parallel:
       slice 0 runs the core passes and does the expensive work - interpreting
       the question, the relevance gate, the synthesis - and every other slice
       runs a share of the historical ladder with retrieval only, no model calls
       at all, and merges into the same corpus on the client. */
    const slices = Math.max(1, Math.min(Number(body.slices) || 1, 12));
    const slice = Math.max(0, Math.min(Number(body.slice) || 0, slices - 1));
    const gate = body.gate !== false && slice === 0;

    // A slice that is only fetching does not need the model to read the
    // question again - the client hands it the profile slice 0 already got.
    const given = body.profile && typeof body.profile === "object" ? body.profile : null;
    const prof = given ?? (gate ? await interpret(asked) : null);
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
    const per = Math.max(20, Math.min(limit, 40));
    const half = Math.ceil(per / 2), third = Math.ceil(per / 3);
    const freeQ = free || freeOwn;
    const adsQ = String(prof?.ads || freeQ);
    const coreSrc = (Array.isArray(prof?.core) && prof.core.length ? prof.core
      : iTerms.length ? iTerms : own) as any[];
    const core = coreSrc.map((t) => String(t).replace(/["\\]/g, " ").trim())
      .filter(Boolean).slice(0, 3);

    /* The historical ladder. A relevance sort stops wherever the index decides
       it stops, and what it drops is always the old work. So every era gets its
       own reservation on every archive that can filter by date - that is what
       puts a 1934 paper and a preprint from this month in the same corpus. */
    const ERAS: Win[] = [[1665, 1929], [1930, 1939], [1940, 1949], [1950, 1959], [1960, 1969],
      [1970, 1979], [1980, 1989], [1990, 1999], [2000, 2009], [2010, 2019], [2020, 2035]];
    const eraName = (w: Win) => !w ? "" : w[0] === 1665 ? "pre-1930" : w[0] === 2020 ? "2020s" : `${w[0]}s`;

    /* `core` marks the passes that must run on the first slice, because they are
       what the gate and the synthesis read. Everything else is the ladder, and
       the ladder is dealt round-robin across the remaining slices. */
    type Pass = { name: string; note: string; host: string; core?: boolean; run: () => Promise<Rec[]> };
    const all: Pass[] = [];
    const P = (name: string, note: string, host: string, run: () => Promise<Rec[]>, core = false) =>
      all.push({ name, note, host, core, run });

    // arXiv — preprints from 1991, four windows plus the sorts
    P("arxiv/relevance", "preprints, best match", "arxiv", () => fromArxiv(arxA, per), true);
    P("arxiv/your-words", "your exact words", "arxiv", () => fromArxiv(arxB, half), true);
    P("arxiv/newest", "this month's preprints", "arxiv", () => fromArxiv(arxA, half, "submittedDate"), true);
    for (const w of ERAS.filter((w) => w![1] >= 1991)) {
      P(`arxiv/${eraName(w)}`, `preprints of the ${eraName(w)}`, "arxiv", () => fromArxiv(arxA, third, "relevance", w));
    }
    core.forEach((t) => P(`arxiv/term:${t}`, `the term "${t}" on its own`, "arxiv", () => fromArxiv(grp([t]), third)));

    // OpenAlex — 250M works across every discipline, the full ladder
    P("openalex/relevance", "all disciplines, best match", "openalex", () => fromOpenAlex(free, per, "relevance"), true);
    P("openalex/canon", "most-cited of all time", "openalex", () => fromOpenAlex(free, per, "cited"), true);
    P("openalex/origins", "earliest on record", "openalex", () => fromOpenAlex(free, half, "earliest"), true);
    P("openalex/recent", "the live edge", "openalex", () => fromOpenAlex(free, half, "recent"), true);
    P("openalex/open-access", "free to read in full", "openalex", () => fromOpenAlex(free, half, "relevance", undefined, "is_oa:true"));
    P("openalex/reviews", "review articles only", "openalex", () => fromOpenAlex(free, third, "cited", undefined, "type:review"));
    for (const w of ERAS) P(`openalex/${eraName(w)}`, `the ${eraName(w)}, by citation`, "openalex", () => fromOpenAlex(free, third, "cited", w));
    core.forEach((t) => P(`openalex/term:${t}`, `the term "${t}" on its own`, "openalex", () => fromOpenAlex(t, third, "cited")));

    // Crossref — the journals of record, DOI by DOI
    P("crossref/relevance", "journals of record", "crossref", () => fromCrossref(freeQ, per), true);
    P("crossref/canon", "most-referenced articles", "crossref", () => fromCrossref(freeQ, half, "cited"), true);
    P("crossref/origins", "oldest on file", "crossref", () => fromCrossref(freeQ, half, "oldest"), true);
    P("crossref/your-words", "your exact words", "crossref", () => fromCrossref(freeOwn, third));
    P("crossref/books", "monographs and chapters", "crossref", () => fromCrossref(freeQ, third, "cited", undefined, "book-chapter"));
    P("crossref/proceedings", "conference proceedings", "crossref", () => fromCrossref(freeQ, third, "cited", undefined, "proceedings-article"));
    for (const w of ERAS) P(`crossref/${eraName(w)}`, `journals of the ${eraName(w)}`, "crossref", () => fromCrossref(freeQ, third, "cited", w));

    // NASA ADS — astronomy and physics back to the 1820s
    P("ads/relevance", "astronomy, best match", "ads", () => fromADS(adsQ, per), true);
    P("ads/canon", "most-cited in astronomy", "ads", () => fromADS(adsQ, half, "citation_count desc"), true);
    P("ads/origins", "earliest in the archive", "ads", () => fromADS(adsQ, half, "date asc"), true);
    P("ads/refereed", "refereed only", "ads", () => fromADS(`${adsQ} property:refereed`, third, "citation_count desc"));
    for (const w of ERAS) P(`ads/${eraName(w)}`, `astronomy of the ${eraName(w)}`, "ads", () => fromADS(adsQ, third, "citation_count desc", w));

    // Semantic Scholar — the citation graph
    P("s2/relevance", "citation graph", "s2", () => fromSemanticScholar(freeQ, per), true);
    P("s2/open-access", "with a free full text", "s2", () => fromSemanticScholar(freeQ, third, undefined, true));
    P("s2/your-words", "your exact words", "s2", () => fromSemanticScholar(freeOwn, third));
    for (const w of ERAS) P(`s2/${eraName(w)}`, `the ${eraName(w)} in the graph`, "s2", () => fromSemanticScholar(freeQ, third, w));

    // Europe PMC — life sciences from 1781, preprints included
    P("europepmc/cited", "life sciences, most cited", "epmc", () => fromEuropePMC(freeQ, half), true);
    P("europepmc/relevance", "life sciences, best match", "epmc", () => fromEuropePMC(freeQ, third, "P_PDATE_D desc"));
    P("europepmc/preprints", "biology preprints", "epmc", () => fromEuropePMC(freeQ, third, "CITED desc", undefined, "PPR"));
    for (const w of ERAS) P(`europepmc/${eraName(w)}`, `life sciences of the ${eraName(w)}`, "epmc", () => fromEuropePMC(freeQ, third, "CITED desc", w));

    // PubMed — biomedicine from 1781. NCBI throttles hard, so this host runs
    // one pass at a time and takes the eras in coarser steps.
    P("pubmed/relevance", "biomedicine, best match", "pubmed", () => fromPubMed(freeQ, half), true);
    for (const w of [[1781, 1949], [1950, 1969], [1970, 1989], [1990, 1999], [2000, 2009], [2010, 2019], [2020, 2035]] as Win[]) {
      P(`pubmed/${w![0]}-${w![1] > 2030 ? "now" : w![1]}`, `biomedicine ${w![0]}-${w![1] > 2030 ? "now" : w![1]}`, "pubmed", () => fromPubMed(freeQ, third, w));
    }

    // INSPIRE-HEP — particle physics from the 1900s
    P("inspire/mostcited", "particle physics canon", "inspire", () => fromInspire(freeQ, half), true);
    P("inspire/recent", "particle physics, newest", "inspire", () => fromInspire(freeQ, third, "mostrecent"));
    for (const w of [[1900, 1969], [1970, 1989], [1990, 2009], [2010, 2035]] as Win[]) {
      P(`inspire/${w![0]}-${w![1] > 2030 ? "now" : w![1]}`, `HEP ${w![0]}-${w![1] > 2030 ? "now" : w![1]}`, "inspire", () => fromInspire(freeQ, third, "mostcited", w));
    }

    // the specialist and repository archives
    P("doaj/relevance", "open-access journals", "doaj", () => fromDOAJ(freeQ, half));
    P("doaj/your-words", "your exact words", "doaj", () => fromDOAJ(freeOwn, third));
    P("datacite/relevance", "datasets & software", "datacite", () => fromDatacite(freeQ, half));
    P("datacite/your-words", "your exact words", "datacite", () => fromDatacite(freeOwn, third));
    P("hal/relevance", "French national repository", "hal", () => fromHAL(freeQ, half));
    P("hal/your-words", "your exact words", "hal", () => fromHAL(freeOwn, third));
    P("openaire/relevance", "European open science", "openaire", () => fromOpenAIRE(freeQ, half));
    P("openaire/your-words", "your exact words", "openaire", () => fromOpenAIRE(freeOwn, third));
    P("zenodo/recent", "data, code, theses", "zenodo", () => fromZenodo(freeQ, third));
    P("zenodo/your-words", "your exact words", "zenodo", () => fromZenodo(freeOwn, third));
    P("osti/relevance", "US national laboratories", "osti", () => fromOSTI(freeQ, half));
    P("osti/origins", "DOE reports, pre-1970", "osti", () => fromOSTI(freeQ, third, [1940, 1969]));
    P("ntrs/relevance", "NASA technical reports", "ntrs", () => fromNTRS(freeQ, half));
    P("ntrs/your-words", "your exact words", "ntrs", () => fromNTRS(freeOwn, third));
    P("cds/relevance", "CERN document server", "cds", () => fromCDS(freeQ, half));
    P("cds/your-words", "your exact words", "cds", () => fromCDS(freeOwn, third));
    P("dblp/relevance", "computer science bibliography", "dblp", () => fromDBLP(freeQ, half));
    P("dblp/your-words", "your exact words", "dblp", () => fromDBLP(freeOwn, third));
    P("plos/relevance", "PLOS full text", "plos", () => fromPLOS(freeQ, half));
    P("plos/your-words", "your exact words", "plos", () => fromPLOS(freeOwn, third));

    /* Every pass is a separate reservation and every archive has its own
       politeness budget, so the sweep runs one queue per host rather than one
       flat fan-out. A pass that has not started by the deadline is recorded as
       skipped - the sweep always returns, it is never held hostage by one slow
       index. */
    const HOSTCAP: Record<string, number> = {
      pubmed: 1, s2: 1, inspire: 2, arxiv: 2, epmc: 3, crossref: 4, ads: 4, openalex: 6,
    };

    /* Deal the passes to this slice. Slice 0 takes the core; the ladder is dealt
       round-robin across the rest, so every slice gets a spread of archives and
       eras rather than one slice inheriting all of PubMed. */
    const ladder = all.filter((p) => !p.core);
    const jobs: Pass[] = slices === 1 ? all
      : slice === 0 ? all.filter((p) => p.core)
      : ladder.filter((_, i) => i % (slices - 1) === slice - 1);

    const t0 = Date.now();
    const deadline = t0 + (slices === 1 ? 55000 : 40000);
    const archives: any[] = [];
    const bag: Rec[] = [];
    const byHost: Record<string, Pass[]> = {};
    for (const jb of jobs) (byHost[jb.host] ??= []).push(jb);

    await Promise.all(Object.keys(byHost).map(async (h) => {
      const q = byHost[h];
      const lanes = Math.min(HOSTCAP[h] ?? 2, q.length);
      let i = 0;
      await Promise.all(Array.from({ length: lanes }, async () => {
        while (i < q.length) {
          const jb = q[i++];
          if (Date.now() > deadline) { archives.push({ name: jb.name, note: jb.note, got: 0, ms: 0, error: "skipped at the sweep deadline" }); continue; }
          const s = Date.now();
          try {
            const rows = await jb.run();
            archives.push({ name: jb.name, note: jb.note, got: rows.length, ms: Date.now() - s });
            for (const r of rows) bag.push(r);
          } catch (e) {
            archives.push({ name: jb.name, note: jb.note, got: 0, ms: Date.now() - s, error: String((e as Error)?.message ?? e).slice(0, 120) });
          }
        }
      }));
    }));

    const found: Rec[] = [];
    const at = new Map<string, number>();
    for (const rc of bag) {
      const key = rc.source_id;
      if (!key) continue;
      const tkey = rc.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 70);
      const hit = at.has(key) ? at.get(key)! : (tkey && at.has("t:" + tkey) ? at.get("t:" + tkey)! : -1);
      if (hit >= 0) {
        // a second archive found the same work - record the corroboration
        const keep = found[hit];
        if (rc.source !== keep.source && (keep.also ??= []).indexOf(rc.source) < 0) keep.also.push(rc.source);
        if (keep.citations == null && rc.citations != null) keep.citations = rc.citations;
        if (!keep.abstract && rc.abstract) keep.abstract = rc.abstract;
        continue;
      }
      at.set(key, found.length); if (tkey) at.set("t:" + tkey, found.length);
      found.push(rc);
    }
    const sweepMs = Date.now() - t0;
    const usedRungs = [
      `arXiv: ${arxA}`,
      arxB && arxB !== arxA ? `arXiv, your words: ${arxB}` : "",
      `free text across every archive: ${freeQ}`,
      adsQ && adsQ !== freeQ ? `ADS: ${adsQ}` : "",
      `${all.length} passes over ${new Set(all.map((p) => p.host)).size} archives, ${ERAS.length} historical windows deep`,
    ].filter(Boolean);

    /* A ladder slice is retrieval only: no gate, no synthesis, nothing stored.
       It hands back its share of the perimeter and its share of the ledger, and
       the client merges them into the corpus slice 0 already returned. Cheap
       enough that it can never be the thing that kills the isolate. */
    if (!gate) {
      return new Response(JSON.stringify({
        mode: "slice", question: asked, worker: WORKER_VERSION,
        slice, slices, passes: all.length,
        archives, sweepMs, retrieved: found.length,
        corpus: found.map((r) => ({
          source: r.source, source_id: r.source_id, title: r.title, url: r.url,
          published_at: r.published_at, year: r.year, citations: r.citations,
          venue: r.venue, institutions: r.institutions, oa: r.oa, concepts: r.concepts,
          authors: r.authors, also: r.also || [],
        })),
      }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Keep the historical spread when trimming: never let the recent wave crowd
    // out the origins and the canon.
    const byYear = [...found].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
    const byCites = [...found].sort((a, b) => (b.citations ?? -1) - (a.citations ?? -1));
    const cap = Math.min(Math.max(limit, 28), 48);
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

    /* Everything retrieved travels back, stripped of abstracts. The gate is the
       only expensive step, so it runs on `keep`; the era structure, the canon,
       the venues, the institutions and the citation arithmetic run on all of it. */
    const corpus = found.map((r) => ({
      source: r.source, source_id: r.source_id, title: r.title, url: r.url,
      published_at: r.published_at, year: r.year, citations: r.citations,
      venue: r.venue, institutions: r.institutions, oa: r.oa, concepts: r.concepts,
      authors: r.authors, also: r.also || [],
    }));

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
      archives, sweepMs, corpus, retrieved: found.length,
      passes: all.length, ranHere: jobs.length, slice, slices,
      hosts: new Set(all.map((p) => p.host)).size, eras: ERAS.length,
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
