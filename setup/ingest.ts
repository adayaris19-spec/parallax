// PARALLAX ingest worker v6 — paste into the Supabase Edge Function named `ingest`.
//
// v6 fixes the reason every question came back looking the same:
//   * the live search sorted arXiv by SUBMITTED DATE. A query that matched little
//     therefore returned "the newest papers in that category" instead of nothing,
//     so every cosmology question returned the same recent astro-ph.CO papers.
//     The live search now sorts by RELEVANCE. Date sorting stays on the cron sweep,
//     where new arrivals are the point.
//   * the model was asked to write the arXiv query string itself and kept adding a
//     narrowing AND group and a cat: filter, which is what emptied the result set.
//     It now returns only a list of terms; the query is assembled in code.
//   * the user's own words are ALWAYS searched as a separate rung and merged in, so
//     no interpretation can steer the corpus away from what was asked.
//   * Crossref is polled alongside arXiv and ADS, so coverage is not just physics.
//
// Two modes:
//   1. Cron sweep  (no body, or {})           -> polls the stored watches, stores + scores records
//   2. Live search ({"q":"...","name":"..."}) -> researches ONE question on demand and
//                                                returns scored results straight to the browser
//
// Secrets required (Edge Functions -> Secrets):
//   ADS_TOKEN          — ui.adsabs.harvard.edu (optional)
//   ANTHROPIC_API_KEY  — console.anthropic.com
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADS = Deno.env.get("ADS_TOKEN") ?? "";
const ANT = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

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

function pick(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

async function pollArxiv(query: string, rows = 25, by: "relevance" | "submittedDate" = "submittedDate") {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}` +
    `&sortBy=${by}&sortOrder=descending&max_results=${rows}`;
  const xml = await (await fetch(url)).text();
  const out: any[] = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const id = pick(entry, "id").split("/abs/")[1] ?? pick(entry, "id");
    if (!id) continue;
    out.push({
      source: "arxiv",
      source_id: `arxiv:${id}`,
      title: pick(entry, "title"),
      abstract: pick(entry, "summary").slice(0, 4000),
      authors: [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).slice(0, 8).join(", "),
      url: `https://arxiv.org/abs/${id}`,
      published_at: pick(entry, "published") || null,
    });
  }
  return out;
}

async function pollAds(query: string, rows = 25, by: "score desc" | "date desc" = "date desc") {
  if (!ADS) return [];
  const url = `https://api.adsabs.harvard.edu/v1/search/query?q=${encodeURIComponent(query)}` +
    `&fl=bibcode,title,abstract,author,date&rows=${rows}&sort=${encodeURIComponent(by)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${ADS}` } });
  if (!r.ok) { console.log("ads", r.status); return []; }
  const j = await r.json();
  return (j.response?.docs ?? []).map((d: any) => ({
    source: "ads",
    source_id: `ads:${d.bibcode}`,
    title: (d.title ?? [""])[0],
    abstract: (d.abstract ?? "").slice(0, 4000),
    authors: (d.author ?? []).slice(0, 8).join(", "),
    url: `https://ui.adsabs.harvard.edu/abs/${d.bibcode}`,
    published_at: d.date ?? null,
  }));
}

// Crossref indexes essentially every discipline, needs no key, and is what makes
// this a science tool rather than a physics tool.
async function pollCrossref(query: string, rows = 20) {
  try {
    const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}` +
      `&rows=${rows}&sort=relevance&select=DOI,title,abstract,author,issued,container-title,type` +
      `&filter=type:journal-article&mailto=parallax@example.org`;
    const r = await fetch(url, { headers: { "User-Agent": "PARALLAX/1.0 (research monitor)" } });
    if (!r.ok) { console.log("crossref", r.status); return []; }
    const j = await r.json();
    return (j.message?.items ?? []).map((d: any) => {
      const dp = d.issued?.["date-parts"]?.[0] ?? [];
      const iso = dp.length
        ? `${dp[0]}-${String(dp[1] ?? 1).padStart(2, "0")}-${String(dp[2] ?? 1).padStart(2, "0")}`
        : null;
      return {
        source: "crossref",
        source_id: `doi:${d.DOI}`,
        title: (d.title ?? [""])[0] ?? "",
        abstract: String(d.abstract ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 4000),
        authors: (d.author ?? []).slice(0, 8).map((a: any) => `${a.given ?? ""} ${a.family ?? ""}`.trim()).join(", "),
        url: `https://doi.org/${d.DOI}`,
        published_at: iso,
      };
    }).filter((x: any) => x.title);
  } catch (e) { console.log("crossref fail", String(e)); return []; }
}

// The query is built here, not by the model. A model asked for a query string kept
// bolting on a second AND group and a cat: filter, which emptied the result set -
// and an empty result set plus a date sort is exactly how every question ends up
// returning the same recent papers.
const STOP = new Set(("a an the of in on for to and or with that this is are was were be been being do does did " +
  "what why how which when where can could should would there their it its we i my about any new from at by vs " +
  "versus have has had not no than then so such as into over under between").split(" "));
function qTerms(text: string): string[] {
  // acronyms carry the whole question in some fields (NP, DNA, CMB, QCD), so a
  // blanket length filter would throw the topic away
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

// Ask Claude to turn a natural-language question into search TERMS - never a query string.
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
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) { console.log("interpret", r.status, await r.text()); return null; }
  const j = await r.json();
  const m = (j.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function scoreRecord(rec: any, watch: { name: string; tracked: string[] }) {
  if (!ANT) return null;
  const prompt =
    `You are the relevance gate of a research-monitoring system. Be useful, not pedantic.\n` +
    `Research question: ${watch.name}\nTracked quantities:\n- ${watch.tracked.join("\n- ")}\n\n` +
    `New record:\nTITLE: ${rec.title}\nABSTRACT: ${rec.abstract}\n\n` +
    `Score relevance on this calibration:\n` +
    `0.85-1.0 directly addresses the question or measures a tracked quantity\n` +
    `0.60-0.84 same subfield, bears on the question's premises, methods or competing explanations\n` +
    `0.40-0.59 adjacent: shares the physical system or observable but a different target\n` +
    `0.15-0.39 same broad field only\n` +
    `0.0-0.14 unrelated\n` +
    `Set "relevant" true whenever relevance >= 0.40 — a researcher watching this question would want to see it.\n` +
    `Set "material" true only if it reports a NEW measurement, constraint, bound or explicit contradiction.\n\n` +
    `Return ONLY JSON: {"relevance":0..1,"relevant":bool,"touches":[strings],` +
    `"stance":"supports"|"contests"|"neutral","position":"the explanation or claim this paper backs, <=12 words",` +
    `"measurement":{"parameter":str,"value":str,"sigma":str}|null,"material":bool,"why":"one sentence"}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANT, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) { console.log("anthropic", r.status, await r.text()); return null; }
  const j = await r.json();
  const m = (j.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Turn the returned corpus into the structures the other modes operate on.
async function synthesize(question: string, recs: any[]) {
  if (!ANT || !recs.length) return null;
  const digest = recs.slice(0, 12).map((r, i) =>
    `[${i + 1}] ${r.published_at ? String(r.published_at).slice(0, 7) : "n/a"} | ${r.title} | ${String(r.abstract || "").slice(0, 400)}`
  ).join("\n");
  const prompt =
    `You are summarising the live literature on a research question for a physicist.\n\n` +
    `QUESTION: ${question}\n\nRECORDS:\n${digest}\n\n` +
    `Return ONLY JSON:\n` +
    `{"state":"3-4 sentences on where this question actually stands, naming the real constraints",\n` +
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
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
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
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
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
    const limit = Math.min(Number(body.limit) || 12, 25);

    // Claude turns the question into a real query + watch profile
    const prof = await interpret(asked);
    const watch = {
      name: asked,
      tracked: (prof?.tracked && prof.tracked.length ? prof.tracked : (body.tracked || []))
        .slice(0, 6).map((t: any) => String(t).slice(0, 200)),
    };
    if (!watch.tracked.length) {
      watch.tracked = ["primary measured quantity", "competing explanations", "systematic uncertainties"];
    }

    // Queries are assembled here. The interpretation is one rung; the user's own
    // words are ALWAYS another, and both are merged, so no interpretation can
    // steer the corpus away from what was actually asked.
    const iTerms: string[] = Array.isArray(prof?.terms) ? prof.terms.map(String).slice(0, 7) : [];
    const iCore: string[] = Array.isArray(prof?.core) && prof.core.length
      ? prof.core.map(String).slice(0, 3) : iTerms.slice(0, 3);
    const own = qTerms(asked);
    const rungs = [
      { why: "interpreted terms", q: grp(iTerms) },
      { why: "your own words", q: grp(own) },
      { why: "core terms only", q: grp(iCore) },
      { why: "whole phrase", q: own.length ? `all:"${own.join(" ")}"` : "" },
    ].filter((r) => r.q);

    const found: any[] = [];
    const seen = new Set<string>();
    const usedRungs: string[] = [];
    const push = (rows: any[]) => {
      for (const rec of rows) {
        if (!rec?.source_id || seen.has(rec.source_id)) continue;
        seen.add(rec.source_id); found.push(rec);
      }
    };
    // Everything the first pass needs goes out at once. Run one after another this
    // was six round trips before a single abstract could be scored, and a browser
    // that gave up mid-sweep left the question with nothing at all.
    const head = rungs.slice(0, 2);
    const [r0, r1, adsRows, crRows] = await Promise.all([
      head[0] ? pollArxiv(head[0].q, limit, "relevance") : Promise.resolve([] as any[]),
      head[1] ? pollArxiv(head[1].q, limit, "relevance") : Promise.resolve([] as any[]),
      prof?.ads ? pollAds(String(prof.ads), Math.ceil(limit / 2), "score desc") : Promise.resolve([] as any[]),
      pollCrossref(iTerms.length ? iTerms.slice(0, 4).join(" ") : asked, Math.ceil(limit / 2)),
    ]);
    if (r0.length && head[0]) usedRungs.push(head[0].why + ": " + head[0].q);
    if (r1.length && head[1]) usedRungs.push(head[1].why + ": " + head[1].q);
    push(r0); push(r1); push(adsRows); push(crRows);
    // widen only when the first pass came back thin
    if (found.length < Math.min(6, limit)) {
      const tail = rungs.slice(2);
      const more = await Promise.all(tail.map((rg) => pollArxiv(rg.q, limit, "relevance")));
      more.forEach((rows, i) => { if (rows.length) usedRungs.push(tail[i].why + ": " + tail[i].q); push(rows); });
    }
    const usedQuery = usedRungs[0] ?? (rungs[0]?.q ?? asked);

    // score in parallel — sequential scoring of a dozen abstracts blows the wall clock
    const scored: any[] = await Promise.all(
      found.slice(0, Math.max(limit, 16)).map(async (rec) => {
        let v: any = null;
        try { v = await scoreRecord(rec, watch); } catch (_) { v = null; }
        return {
          source: rec.source, source_id: rec.source_id, title: rec.title,
          url: rec.url, published_at: rec.published_at,
          relevance: v?.relevance ?? null, relevant: v?.relevant ?? null,
          material: !!v?.material, why: v?.why ?? "", measurement: v?.measurement ?? null,
        };
      }),
    );
    if (body.store && found.length) {
      await sb("records?on_conflict=source_id", "POST", found,
        "resolution=ignore-duplicates,return=minimal");
    }
    scored.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));

    // synthesise from the records that actually cleared the gate (fall back to the best few)
    const forSynth = found.filter((f) => {
      const sc = scored.find((x) => x.source_id === f.source_id);
      return sc && (sc.relevance ?? 0) >= 0.4;
    });
    const synthInput = (forSynth.length ? forSynth : found.slice(0, 6));
    let synthesis: any = null;
    try { synthesis = await synthesize(asked, synthInput); } catch (_) { synthesis = null; }

    return new Response(JSON.stringify({
      mode: "search", question: asked, synthesis,
      profile: prof ? {
        field: prof.field ?? "", quantity: prof.quantity ?? null,
        tracked: watch.tracked, terms: iTerms, ads: prof.ads ?? "",
      } : null,
      query: usedQuery, rungs: usedRungs, worker: 6,
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
    const found = [...(await pollArxiv(w.q, 25, "submittedDate")), ...(await pollAds(w.q, 25, "date desc"))];
    pulled += found.length;
    if (found.length) {
      await sb("records?on_conflict=source_id", "POST", found,
        "resolution=ignore-duplicates,return=minimal");
    }
  }

  const fresh: any[] = (await sb("records?status=eq.new&order=fetched_at.desc&limit=8")) ?? [];
  let scored = 0, material = 0;
  for (const rec of fresh) {
    const v = await scoreRecord(rec, watches[0]);
    if (!v) { await sb(`records?id=eq.${rec.id}`, "PATCH", { status: "scored" }); continue; }
    await sb(`records?id=eq.${rec.id}`, "PATCH", {
      status: "scored", relevance: v.relevance ?? 0,
      relevant: !!v.relevant, material: !!v.material, extraction: v,
    });
    scored++;
    if (v.material) {
      material++;
      await sb("findings", "POST", {
        record_id: rec.id, kind: "material-change",
        title: rec.title?.slice(0, 200), why: v.why ?? "", severity: 2,
      }, "return=minimal");
    }
  }
  return new Response(JSON.stringify({ mode: "sweep", watches: watches.length, pulled, scored, material }),
    { headers: { ...CORS, "Content-Type": "application/json" } });
}
