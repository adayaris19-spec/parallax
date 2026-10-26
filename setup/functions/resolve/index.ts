// PARALLAX resolve — Supabase Edge Function named `resolve`. Settles Parallax Plus predictions.
//
// Questions come from what Plus shows (prediction_questions, written by the plus function):
//   - "Will this promise be kept by <year>?"  The promises function already judges promises once
//     their year has passed: kept -> yes; partly kept or broken -> no; unclear stays open.
//   - "Will this trial meet its main goal?"   From ClinicalTrials.gov, once the trial's primary
//     completion month has passed:
//       withdrawn before it started            -> void (calls on it don't count)
//       stopped early (terminated)             -> no, unless it stopped because it worked
//       results posted with p-values for the main (primary) outcome:
//         any below 0.05 -> yes; all at or above -> no
//       otherwise, if results text or papers reporting the trial (Europe PMC, by trial number)
//       exist, Claude reads them and answers yes / no / unclear. Unclear stays open.
//   Trials are re-checked weekly until they resolve.
//
// Request: POST {} (header x-parallax-admin: <ADMIN_TOKEN>). Optional {"key": "trial:NCT..."} to
// check one question now, {"dry": true} to report without saving. Schedule: daily (cron parallax-resolve).
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = "claude-sonnet-5-5"; // a short reading task; cheaper than the default model
const DAY = 86_400_000;
const TRIALS_PER_RUN = 20;
const claude = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" });
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
const clean = (s: unknown, n = 400) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// Cost log (see schema-usage.sql), list prices per million tokens.
// deno-lint-ignore no-explicit-any
function track(m: any) {
  const u = m?.usage ?? {}, inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0;
  const cost = (inp * 2 + out * 10) / 1e6;
  db("ai_usage", { method: "POST", prefer: "return=minimal", body: { job: "resolve", model: m?.model ?? MODEL, input_tokens: inp, output_tokens: out, cache_read: 0, cache_write: 0, searches: 0, batch: false, cost_usd: Number(cost.toFixed(5)) } }).catch(() => {});
  return m;
}

type Verdict = { outcome: "yes" | "no" | "void"; note: string; how: string; source_url: string | null } | { open: string };

// p-values come as text: "0.03", "<0.001", "< .05", "=0.21", "NS".
function pOf(s: unknown): number | null {
  const m = String(s ?? "").replace(/\s/g, "").match(/^([<>≤≥=]*)(0?\.\d+|1(\.0+)?|\d\.\d+e-\d+)$/i);
  if (!m) return null;
  const v = Number(m[2]);
  if (!Number.isFinite(v)) return null;
  return m[1].startsWith(">") || m[1].startsWith("≥") ? Math.max(v, 0.0501) : v;
}

// Papers that report a trial name its registry number (Europe PMC: free, no daily budget, indexes
// trial numbers). Abstracts that name it, earliest first: the trial's own results report usually
// comes first, before reviews and follow-ups.
async function papersFor(nct: string, since: string) {
  const p = new URLSearchParams({ query: `ABSTRACT:"${nct}" AND FIRST_PDATE:[${since} TO 3000-01-01]`, format: "json", resultType: "core", pageSize: "8", sort: "FIRST_PDATE_D asc" });
  const r = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${p}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`europepmc ${r.status}`);
  const d = await r.json();
  // deno-lint-ignore no-explicit-any
  return (d.resultList?.result ?? []).map((w: any) => ({
    title: clean(w.title, 300), date: w.firstPublicationDate, abstract: clean(String(w.abstractText ?? "").replace(/<[^>]+>/g, " "), 2500),
    url: w.doi ? `https://doi.org/${w.doi}` : `https://europepmc.org/article/${w.source}/${w.id}`,
  })).filter((w: { abstract: string }) => w.abstract.length > 200);
}

const Judge = z.object({
  outcome: z.enum(["yes", "no", "unclear"]),
  note: z.string(),
  source: z.number(),
});
async function judge(question: string, title: string, facts: string, sources: { title: string; url: string; text: string }[]) {
  const msg = await claude.beta.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: betaZodOutputFormat(Judge) },
    system: `You settle predictions for Parallax. Answer only from the sources given. A trial "met its main goal" when its primary outcome (endpoint) showed the effect the trial was designed to show (for example a statistically significant benefit, or non-inferiority when that was the aim). Secondary outcomes, safety alone, or "trends" do not count. Use only a source that reports this trial's own primary outcome result; approvals, reviews or other trials don't settle it. If no source states it clearly, answer unclear.`,
    messages: [{ role: "user", content: `Question: ${question}\nTrial: ${title}\n\nRegistry facts:\n${facts}\n\n${sources.map((s, i) => `Source ${i + 1}: ${s.title}\n${s.text}`).join("\n\n")}\n\nAnswer yes, no or unclear. note: one plain sentence, at most 25 words, stating the main result itself (for a curious non-expert; don't mention sources). source: the number of the source that settles it (0 if none).` }],
  }).finalMessage().then(track);
  if (msg.parsed_output == null) return null;
  const v = msg.parsed_output as z.infer<typeof Judge>;
  return { ...v, url: v.source > 0 ? sources[v.source - 1]?.url ?? null : null };
}

async function trialVerdict(q: { key: string; question: string; title: string }): Promise<Verdict> {
  const nct = q.key.slice(6);
  const r = await fetch(`https://clinicaltrials.gov/api/v2/studies/${nct}`, { signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return { outcome: "void", note: "The trial was removed from the registry.", how: "rule", source_url: null };
  if (!r.ok) return { open: `registry ${r.status}` };
  const s = await r.json(), ps = s.protocolSection ?? {}, st = ps.statusModule ?? {};
  const status = String(st.overallStatus ?? ""), why = clean(st.whyStopped, 200);
  const url = `https://clinicaltrials.gov/study/${nct}`;
  if (status === "WITHDRAWN") return { outcome: "void", note: `Withdrawn before anyone enrolled${why ? `: ${why}` : ""}.`, how: "rule", source_url: url };
  // deno-lint-ignore no-explicit-any
  const primary = (s.resultsSection?.outcomeMeasuresModule?.outcomeMeasures ?? []).filter((o: any) => o.type === "PRIMARY");
  // deno-lint-ignore no-explicit-any
  const ps_ = primary.flatMap((o: any) => (o.analyses ?? []).map((a: any) => pOf(a.pValue))).filter((x: number | null) => x != null) as number[];
  const stoppedForGood = /efficac|benefit|positive|met (its|the) primary|success/i.test(why) && !/lack|no |futil|not /i.test(why);
  if (status === "TERMINATED" && !stoppedForGood && !ps_.length) {
    return { outcome: "no", note: `Stopped early${why ? `: ${why}` : ""}.`, how: "rule", source_url: url };
  }
  if (ps_.length) {
    const best = Math.min(...ps_);
    return best < 0.05
      ? { outcome: "yes", note: `Posted results: the main outcome reached statistical significance (p ${best < 0.001 ? "< 0.001" : `= ${best}`}).`, how: "rule", source_url: url }
      : { outcome: "no", note: `Posted results: the main outcome did not reach statistical significance (lowest p = ${best}).`, how: "rule", source_url: url };
  }
  if (!["COMPLETED", "TERMINATED", "ACTIVE_NOT_RECRUITING"].includes(status)) return { open: `still ${status.toLowerCase().replace(/_/g, " ")}` };
  // No clean numbers: read what there is (posted results text, papers naming the trial).
  const done = String(st.primaryCompletionDateStruct?.date ?? st.completionDateStruct?.date ?? "").slice(0, 7);
  const since = /^\d{4}/.test(done) ? `${Number(done.slice(0, 4)) - 1}-01-01` : "2015-01-01";
  const papers = await papersFor(nct, since); // a failed search throws: retried next run, not marked checked
  // deno-lint-ignore no-explicit-any
  const posted = primary.map((o: any) => `${clean(o.title, 200)}: ${clean(o.description, 400)}`).join("\n");
  const sources = [
    ...(posted ? [{ title: "Results posted on ClinicalTrials.gov (primary outcomes)", url, text: posted }] : []),
    ...papers.slice(0, 4).map((p: { title: string; url: string; abstract: string; date: string }) => ({ title: `${p.title} (${p.date})`, url: p.url, text: p.abstract })),
  ];
  if (!sources.length) return { open: `${status.toLowerCase().replace(/_/g, " ")}, no results posted or published yet` };
  const facts = `Status: ${status.toLowerCase().replace(/_/g, " ")}${why ? ` (why stopped: ${why})` : ""}. Primary completion: ${done || "unknown"}. Primary outcome(s): ${clean((ps.outcomesModule?.primaryOutcomes ?? []).map((o: { measure: string }) => o.measure).join("; "), 500)}`;
  const v = await judge(q.question, q.title, facts, sources);
  if (!v || v.outcome === "unclear") return { open: "results found but they don't settle it yet" };
  return { outcome: v.outcome, note: clean(v.note, 240), how: "ai", source_url: v.url ?? url };
}

async function run(only?: string, dry = false) {
  const [qs, done] = await Promise.all([
    db(`prediction_questions?select=key,kind,title,question,due,checked_at${only ? `&key=eq.${encodeURIComponent(only)}` : ""}&limit=5000`),
    db("prediction_results?select=key&limit=10000"),
  ]);
  const settled = new Set(done.map((d: { key: string }) => d.key));
  const open = qs.filter((q: { key: string }) => !settled.has(q.key));
  const month = new Date().toISOString().slice(0, 7), year = new Date().getUTCFullYear();
  const out: Record<string, unknown>[] = [];
  const save = async (key: string, v: Verdict) => {
    out.push({ key, ...v });
    if (dry) return;
    if ("open" in v) await db(`prediction_questions?key=eq.${encodeURIComponent(key)}`, { method: "PATCH", prefer: "return=minimal", body: { checked_at: new Date().toISOString(), status_note: v.open } });
    else await db("prediction_results?on_conflict=key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key, outcome: v.outcome, note: v.note, how: v.how, source_url: v.source_url, resolved_at: new Date().toISOString() } });
  };

  // Promises: one query for all of them.
  const proms = open.filter((q: { kind: string; due: string }) => q.kind === "promise" && Number(q.due) < year + 1);
  if (proms.length) {
    const rows = await db(`promises?id=in.(${proms.map((q: { key: string }) => Number(q.key.slice(8))).filter(Number.isFinite).join(",")})&select=id,status,verdict,goal_id`);
    for (const q of proms) {
      const p = rows.find((r: { id: number }) => r.id === Number(q.key.slice(8)));
      if (!p) { await save(q.key, { outcome: "void", note: "The promise was removed.", how: "promise", source_url: null }); continue; }
      const v = clean(p.verdict, 240);
      if (p.status === "kept") await save(q.key, { outcome: "yes", note: v || "Kept, confirmed by two independent sources.", how: "promise", source_url: null });
      else if (p.status === "partly") await save(q.key, { outcome: "no", note: v ? `Only partly kept. ${v}` : "Only partly kept.", how: "promise", source_url: null });
      else if (p.status === "broken") await save(q.key, { outcome: "no", note: v || "Not kept.", how: "promise", source_url: null });
      else if (only) await save(q.key, { open: p.status === "unclear" ? "the evidence is unclear so far" : "not checked yet" });
    }
  }

  // Trials: once the results month has passed, weekly.
  const trials = open.filter((q: { kind: string; due: string; checked_at: string | null }) => q.kind === "trial" && (only || (q.due && q.due < month && (!q.checked_at || Date.now() - new Date(q.checked_at).getTime() > 6.5 * DAY))))
    .sort((a: { checked_at: string | null }, b: { checked_at: string | null }) => String(a.checked_at ?? "").localeCompare(String(b.checked_at ?? "")))
    .slice(0, TRIALS_PER_RUN);
  const t0 = Date.now();
  for (const q of trials) {
    if (Date.now() - t0 > 110_000) break;
    try { await save(q.key, await trialVerdict(q)); } catch (e) { out.push({ key: q.key, error: e instanceof Error ? e.message.slice(0, 160) : String(e) }); }
  }
  return { questions: qs.length, open: open.length, promises_checked: proms.length, trials_checked: trials.length, results: out };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  if (typeof body.papers === "string") return json(await papersFor(body.papers, body.since ?? "2015-01-01").then((x) => x.map((w: { title: string; date: string; abstract: string }) => ({ ...w, abstract: w.abstract.slice(0, 160), names: w.abstract.includes(body.papers) }))));
  try { return json(await run(typeof body.key === "string" ? body.key : undefined, body.dry === true)); }
  catch (e) {
    console.error("resolve failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 300) : "failed" }, 500);
  }
});
