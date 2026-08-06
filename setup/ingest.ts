// PARALLAX ingest worker — paste this whole file into a Supabase Edge Function named `ingest`.
// Every run: polls arXiv (+ NASA ADS if ADS_TOKEN is set) for new Sgr A* polarisation
// literature, stores new records, then scores up to 8 unscored records for relevance
// and materiality with Claude, and files material changes as findings.
//
// Secrets required (Edge Functions -> Secrets):
//   ADS_TOKEN          — from ui.adsabs.harvard.edu (optional but recommended)
//   ANTHROPIC_API_KEY  — from console.anthropic.com
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

const RESEARCH = {
  object: "Sgr A* (Galactic Center black hole)",
  tracked: [
    "EVPA polarisation drift / rotation measure at 230 GHz (ALMA band 6)",
    "Faraday screen stability on the Sgr A* sightline (incl. magnetar PSR J1745-2900)",
    "electron heating prescription R_high in GRMHD (MAD) models",
    "fractional linear polarisation m_L of Sgr A*",
    "X-ray flares of Sgr A* and their timing vs polarisation",
    "EHT ring morphology, spin and inclination constraints",
  ],
};

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADS = Deno.env.get("ADS_TOKEN") ?? "";
const ANT = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

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

async function pollArxiv() {
  const q = encodeURIComponent(
    '(all:"Sgr A*" OR all:"Sagittarius A*") AND (all:polarization OR all:polarisation OR all:GRMHD OR all:"rotation measure")',
  );
  const url = `https://export.arxiv.org/api/query?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=25`;
  const xml = await (await fetch(url)).text();
  const out = [];
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

async function pollAds() {
  if (!ADS) return [];
  const q = encodeURIComponent('("Sgr A*" OR "Sagittarius A*") AND (polarization OR "rotation measure" OR GRMHD)');
  const url = `https://api.adsabs.harvard.edu/v1/search/query?q=${q}&fl=bibcode,title,abstract,author,date&rows=25&sort=date%20desc`;
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

async function scoreRecord(rec: any) {
  if (!ANT) return null;
  const prompt =
    `You are the relevance gate of a research-monitoring system.\n` +
    `Research profile — object: ${RESEARCH.object}\nTracked quantities:\n- ${RESEARCH.tracked.join("\n- ")}\n\n` +
    `New record:\nTITLE: ${rec.title}\nABSTRACT: ${rec.abstract}\n\n` +
    `Return ONLY JSON: {"relevance":0..1,"relevant":bool,"touches":[strings from tracked list],` +
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
  const txt = j.content?.[0]?.text ?? "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

Deno.serve(async () => {
  const found = [...(await pollArxiv()), ...(await pollAds())];
  if (found.length) {
    await sb("records?on_conflict=source_id", "POST", found, "resolution=ignore-duplicates,return=minimal");
  }
  const fresh: any[] = (await sb("records?status=eq.new&order=fetched_at.desc&limit=8")) ?? [];
  let scored = 0, material = 0;
  for (const rec of fresh) {
    const v = await scoreRecord(rec);
    if (!v) { await sb(`records?id=eq.${rec.id}`, "PATCH", { status: "scored" }); continue; }
    await sb(`records?id=eq.${rec.id}`, "PATCH", {
      status: "scored",
      relevance: v.relevance ?? 0,
      relevant: !!v.relevant,
      material: !!v.material,
      extraction: v,
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
  return new Response(JSON.stringify({ pulled: found.length, scored, material }), {
    headers: { "Content-Type": "application/json" },
  });
});
