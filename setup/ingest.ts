// PARALLAX ingest worker v2 — paste into the Supabase Edge Function named `ingest`.
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

async function pollArxiv(query: string, rows = 25) {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}` +
    `&sortBy=submittedDate&sortOrder=descending&max_results=${rows}`;
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

async function pollAds(query: string, rows = 25) {
  if (!ADS) return [];
  const url = `https://api.adsabs.harvard.edu/v1/search/query?q=${encodeURIComponent(query)}` +
    `&fl=bibcode,title,abstract,author,date&rows=${rows}&sort=date%20desc`;
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

async function scoreRecord(rec: any, watch: { name: string; tracked: string[] }) {
  if (!ANT) return null;
  const prompt =
    `You are the relevance gate of a research-monitoring system.\n` +
    `Research question: ${watch.name}\nTracked quantities:\n- ${watch.tracked.join("\n- ")}\n\n` +
    `New record:\nTITLE: ${rec.title}\nABSTRACT: ${rec.abstract}\n\n` +
    `Return ONLY JSON: {"relevance":0..1,"relevant":bool,"touches":[strings],` +
    `"measurement":{"parameter":str,"value":str,"sigma":str}|null,"material":bool,"why":"one sentence"}. ` +
    `"material"=true only if it reports a new measurement, constraint or contradiction of a tracked quantity.`;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let body: any = {};
  try { body = await req.json(); } catch { /* cron sends nothing */ }

  // ---------- mode 2: live on-demand research for one typed question ----------
  if (body && body.q) {
    const watch = {
      name: String(body.name || body.q).slice(0, 300),
      tracked: Array.isArray(body.tracked) && body.tracked.length
        ? body.tracked.slice(0, 8).map((t: any) => String(t).slice(0, 200))
        : ["primary measured quantity", "competing explanations", "systematic uncertainties"],
    };
    const limit = Math.min(Number(body.limit) || 12, 25);
    const found = [...(await pollArxiv(String(body.q), limit)), ...(await pollAds(String(body.q), limit))];

    const scored: any[] = [];
    for (const rec of found.slice(0, limit)) {
      const v = await scoreRecord(rec, watch);
      scored.push({
        source: rec.source, source_id: rec.source_id, title: rec.title,
        url: rec.url, published_at: rec.published_at,
        relevance: v?.relevance ?? null, relevant: v?.relevant ?? null,
        material: !!v?.material, why: v?.why ?? "", measurement: v?.measurement ?? null,
      });
    }
    if (body.store) {
      await sb("records?on_conflict=source_id", "POST", found,
        "resolution=ignore-duplicates,return=minimal");
    }
    scored.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
    return new Response(JSON.stringify({
      mode: "search", question: watch.name, query: body.q,
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
    const found = [...(await pollArxiv(w.q)), ...(await pollAds(w.q))];
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
});
