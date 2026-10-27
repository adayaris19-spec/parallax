// PARALLAX map-goal — Supabase Edge Function named `map-goal`.
//
// Turns any goal a person types ("humans living on Mars") into a goal account:
// a tree of what has to be true for the goal to happen, each piece marked
// solved / in progress / blocked / open with the evidence behind it, the one
// bottleneck that holds back the most, a time estimate, and the first posts.
//
// It runs in stages so no single invocation hits the platform's time limit:
//   tree        (inside the request) understand the goal, refuse or dedupe it, draft the tree
//   evidence    search OpenAlex for every piece of the tree
//   assess      judge every piece against its evidence, one model call per branch
//   synthesize  pick the bottleneck, estimate the horizon, write the first posts
// Each stage saves its work on the goal row and then calls this function again
// for the next stage. A stage that dies leaves the goal at that stage; calling
// with {"continue": "<slug>"} and the admin token picks it up again (`pulse`
// does this automatically for goals stuck for more than 10 minutes).
//
// The parallax rule: a piece is only marked solved when at least two
// independent sources (different first authors) support it, and every post
// must cite at least one real record that came back from the archive.
//
// Request:  POST {"query": "humans living on Mars"}
// Response: {"slug": "...", "status": "mapping" | "ready", "duplicate"?: true}
//           or {"rejected": "<reason>"} or {"error": "..."}
//
// Secrets (Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY   required
//   ADMIN_TOKEN         required; any long random string. Lets `pulse`, the seed
//                       script and the stage chain skip the rate limit.
//   PARALLAX_MODEL      optional, default claude-opus-5-5
//   NEW_GOALS_PER_HOUR  optional, default 10. Caps how many new goals the public
//                       search can create per hour (each costs a full mapping).
//   SEARCHES_PER_HOUR   optional, default 60. Caps how many public searches per hour
//                       reach the model at all (rejections and duplicates cost a call too).
//   CONTACT_EMAIL       optional; OpenAlex answers faster with one.
//   OPENALEX_API_KEY    strongly recommended; free at openalex.org. Without it OpenAlex
//                       limits searches per day across everyone sharing the server's IP.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";
const PER_HOUR = Number(Deno.env.get("NEW_GOALS_PER_HOUR") ?? "10");
const SEARCHES_PER_HOUR = Number(Deno.env.get("SEARCHES_PER_HOUR") ?? "60");
const MAIL = Deno.env.get("CONTACT_EMAIL") ?? "";
const OA_KEY = Deno.env.get("OPENALEX_API_KEY") ?? "";
let oaLastError = "";

const claude = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-parallax-admin",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------------------------------------------------------------- database

// Cost log: every AI call's tokens and an estimated price go to ai_usage (see schema-usage.sql).
// List prices per million tokens; batches are half price on tokens; web search is $10 per 1,000.
const PRICE: Record<string, [number, number]> = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5], "claude-opus-5": [5, 25], "claude-opus-4-8": [5, 25], "claude-fable-5-1": [10, 50] };
// deno-lint-ignore no-explicit-any
function track<T>(job: string, batch = false): (m: T) => T {
  return (m: T) => {
    // deno-lint-ignore no-explicit-any
    const msg = m as any, u = msg?.usage ?? {};
    const [pi, po] = PRICE[String(msg?.model ?? "").replace(/-\d{8}$/, "")] ?? PRICE["claude-opus-5-5"];
    const inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0, cr = u.cache_read_input_tokens ?? 0, cw = u.cache_creation_input_tokens ?? 0;
    const searches = u.server_tool_use?.web_search_requests ?? 0;
    const tokens = (inp * pi + out * po + cr * pi * 0.1 + cw * pi * 1.25) / 1e6;
    const cost = tokens * (batch ? 0.5 : 1) + searches * 0.01;
    db("ai_usage", { method: "POST", prefer: "return=minimal", body: { job, model: msg?.model ?? null, input_tokens: inp, output_tokens: out, cache_read: cr, cache_write: cw, searches, batch, cost_usd: Number(cost.toFixed(5)) } }).catch(() => {});
    return m;
  };
}

async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SRK,
      Authorization: `Bearer ${SRK}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`database ${r.status} on ${path.split("?")[0]}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function getGoal(slug: string) {
  const rows = await db(`goals?slug=eq.${encodeURIComponent(slug)}&select=*`);
  return rows?.[0] ?? null;
}

async function saveGoal(slug: string, patch: Record<string, unknown>) {
  await db(`goals?slug=eq.${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: { ...patch, updated_at: new Date().toISOString() },
  });
}

// ---------------------------------------------------------------- archive

type Rec = {
  id: string; // short OpenAlex id, e.g. W2741809807
  title: string;
  year: number | null;
  cites: number;
  venue: string;
  url: string;
  first_author: string;
  abstract: string;
};

function abstractFrom(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, idx] of Object.entries(inv)) for (const i of idx) words[i] = w;
  return words.filter(Boolean).join(" ").slice(0, 700);
}

async function openAlex(q: string, opts: { per: number; from?: string; to?: string; cited?: boolean }): Promise<Rec[]> {
  const filters = ["has_abstract:true"];
  if (opts.from) filters.push(`from_publication_date:${opts.from}`);
  if (opts.to) filters.push(`to_publication_date:${opts.to}`);
  const params = new URLSearchParams({
    search: q,
    "per-page": String(opts.per),
    filter: filters.join(","),
    select: "id,doi,title,publication_year,cited_by_count,primary_location,authorships,abstract_inverted_index",
  });
  if (opts.cited) params.set("sort", "cited_by_count:desc");
  if (MAIL) params.set("mailto", MAIL);
  if (OA_KEY) params.set("api_key", OA_KEY);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`https://api.openalex.org/works?${params}`, { signal: ctl.signal });
    if (!r.ok) {
      oaLastError = `OpenAlex answered ${r.status}${r.status === 429 ? " (daily search budget used up; set OPENALEX_API_KEY)" : ""}`;
      return [];
    }
    const data = await r.json();
    // deno-lint-ignore no-explicit-any
    return (data.results ?? []).map((w: any): Rec => ({
      id: String(w.id ?? "").split("/").pop() ?? "",
      title: String(w.title ?? "").slice(0, 300),
      year: w.publication_year ?? null,
      cites: w.cited_by_count ?? 0,
      venue: w.primary_location?.source?.display_name ?? "",
      url: w.doi ?? w.primary_location?.landing_page_url ?? String(w.id ?? ""),
      first_author: w.authorships?.[0]?.author?.display_name ?? "",
      abstract: abstractFrom(w.abstract_inverted_index),
    })).filter((x: Rec) => x.id && x.title);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Run async jobs with a fixed number in flight, so OpenAlex is not flooded.
async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const yearsAgo = (n: number) => `${new Date().getUTCFullYear() - n}-01-01`;

// ---------------------------------------------------------------- model

class Refused extends Error {}

// One structured call to Claude. Fallbacks are on: if the model declines, the
// API re-runs the request on Anthropic's recommended fallback model. It streams
// so the generous output cap (thinking counts toward it) never times out.
async function ask<T extends z.ZodType>(
  schema: T,
  system: string,
  user: string,
  effort: "low" | "medium" | "high",
  tries = 2,
): Promise<z.infer<T>> {
  let msg;
  try {
    msg = await claude.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: user }],
    }).finalMessage().then(track("map-goal"));
  } catch (e) {
    // A garbled reply or a dropped connection happens now and then: one more try before the goal
    // is marked failed (which would leave it waiting hours for the next retry).
    if (tries > 1 && !(e instanceof Anthropic.APIError && e.status && e.status < 500 && e.status !== 429)) return ask(schema, system, user, effort, tries - 1);
    throw e;
  }
  if (msg.stop_reason === "refusal") throw new Refused(msg.stop_details?.explanation ?? "declined");
  if (msg.stop_reason === "max_tokens") throw new Error("model output was cut off");
  if (msg.parsed_output == null) {
    if (tries > 1) return ask(schema, system, user, effort, tries - 1);
    throw new Error("model returned no structured output");
  }
  return msg.parsed_output as z.infer<T>;
}

const VOICE = `You work for Parallax, a public feed of human progress. People follow goals
(like @Mars or @Fusion) the way they follow accounts. Write plainly for a curious
non-expert: short sentences, concrete nouns, no hype, no jargon without a gloss.
Never invent facts, numbers, papers, people or dates. When the evidence is thin, say so.`;

// ---- stage: tree

const TreeSchema = z.object({
  verdict: z.enum(["accept", "duplicate", "reject"]),
  duplicate_slug: z.string().nullable(),
  reject_reason: z.string().nullable(),
  name: z.string(),
  handle: z.string(),
  slug: z.string(),
  summary: z.string(),
  branches: z.array(z.object({
    title: z.string(),
    why: z.string(),
    leaves: z.array(z.object({
      title: z.string(),
      why: z.string(),
      query: z.string(),
    })),
  })),
});
type Tree = z.infer<typeof TreeSchema>;

async function draftTree(query: string, existing: { slug: string; name: string }[]): Promise<Tree> {
  const list = existing.map((g) => `${g.slug}: ${g.name}`).join("\n") || "(none yet)";
  return await ask(
    TreeSchema,
    VOICE,
    `Someone searched Parallax for: "${query}"

Existing goal accounts (slug: name):
${list}

1. Decide the verdict.
   - "duplicate" if an existing goal already means the same thing; put its slug in duplicate_slug.
   - "reject" if this is not a goal humanity could work toward through science, technology,
     medicine or engineering (for example a person, a product question, a joke, or anything
     whose aim is to harm people). Give a one-sentence reject_reason. Broad, ambitious and
     speculative goals are welcome; do not reject them for being hard.
   - otherwise "accept".
2. For accept, name the goal account:
   - name: the goal as a short outcome, e.g. "Humans living on Mars", "A cure for Alzheimer's"
   - handle: CamelCase, no @, at most 20 characters, e.g. "Mars", "EndAlzheimers"
   - slug: lowercase-with-dashes, e.g. "mars", "end-alzheimers"
   - summary: one sentence on what reaching it would mean.
3. For accept, break the goal into the tree of what has to be true for it to happen:
   4 to 6 branches, each with 3 to 5 leaves. A leaf is one concrete problem that can be
   judged solved or not (e.g. "Shield crews from deep-space radiation on a 9-month transit"),
   never a vague theme. Cover the whole goal: science, engineering, medicine, cost, and
   human factors where they matter. For each leaf give "why" (one sentence on why the goal
   needs it) and "query": 3 to 8 plain English search words that would find research
   papers about exactly that problem in a scholarly index.
For duplicate or reject, fill the other fields with empty strings and an empty branches list.`,
    "medium",
  );
}

// ---- stage: assess

const AssessSchema = z.object({
  leaves: z.array(z.object({
    key: z.string(),
    status: z.enum(["solved", "in_progress", "blocked", "open"]),
    blocker_kind: z.enum(["knowledge", "materials", "instruments", "funding", "attention", "none"]),
    blocker: z.string(),
    evidence_ids: z.array(z.string()),
  })),
});

function recLine(r: Rec) {
  return `[${r.id}] ${r.title} (${r.year ?? "n.d."}; ${r.first_author || "unknown author"}; ${r.venue || "unknown venue"}; cited ${r.cites}) ${r.abstract}`;
}

// ---- stage: synthesize

const SynthSchema = z.object({
  bottleneck_key: z.string(),
  bottleneck_why: z.string(),
  horizon_low: z.number(),
  horizon_high: z.number(),
  horizon_note: z.string(),
  posts: z.array(z.object({
    kind: z.enum(["bottleneck", "advance", "setback", "forgotten"]),
    node_key: z.string(),
    headline: z.string(),
    body: z.string(),
    source_ids: z.array(z.string()),
  })),
});

// ---------------------------------------------------------------- stages

type Leaf = {
  key: string;
  parent: string;
  title: string;
  why: string;
  query: string;
  status?: string;
  blocker_kind?: string;
  blocker?: string;
  evidence_ids?: string[];
};
type Work = {
  branches: { key: string; title: string; why: string }[];
  leaves: Leaf[];
  records?: Record<string, Rec>; // by id
  byLeaf?: Record<string, string[]>; // leaf key -> record ids
};

// Distinct first authors among a set of records: the code half of the parallax test.
function independentCount(ids: string[], recs: Record<string, Rec>) {
  const authors = new Set(ids.map((id) => recs[id]?.first_author?.toLowerCase().trim()).filter(Boolean));
  return authors.size;
}

async function stageEvidence(slug: string, work: Work) {
  const records: Record<string, Rec> = {};
  const byLeaf: Record<string, string[]> = {};
  const jobs = work.leaves.flatMap((l) => [
    { leaf: l.key, q: l.query, opts: { per: 6 } },
    { leaf: l.key, q: l.query, opts: { per: 4, from: yearsAgo(3) } },
    { leaf: l.key, q: l.query, opts: { per: 3, to: yearsAgo(20), cited: true } },
  ]);
  const results = await pool(jobs, 6, (j) => openAlex(j.q, j.opts));
  jobs.forEach((j, i) => {
    for (const r of results[i]) {
      records[r.id] = r;
      (byLeaf[j.leaf] ??= []);
      if (!byLeaf[j.leaf].includes(r.id)) byLeaf[j.leaf].push(r.id);
    }
  });
  if (Object.keys(records).length === 0) throw new Error(oaLastError || "OpenAlex returned nothing for any part of the tree");
  await saveGoal(slug, { stage: "assess", work: { ...work, records, byLeaf } });
}

async function stageAssess(slug: string, name: string, work: Work) {
  const recs = work.records ?? {};
  const byLeaf = work.byLeaf ?? {};
  const assessed = await Promise.all(work.branches.map(async (b) => {
    const leaves = work.leaves.filter((l) => l.parent === b.key);
    const blocks = leaves.map((l) => {
      const ids = byLeaf[l.key] ?? [];
      return `LEAF ${l.key}: ${l.title}\nWhy it matters: ${l.why}\nRecords found for it:\n${
        ids.map((id) => recs[id]).filter(Boolean).map(recLine).join("\n") || "(none found)"
      }`;
    }).join("\n\n");
    const out = await ask(
      AssessSchema,
      VOICE,
      `Goal: ${name}
Branch ${b.key}: ${b.title}

Judge where each leaf below stands today, using the records listed under it and your own
knowledge of the field. Records are search results: some will be off-topic; ignore those.

For each leaf return:
- status: "solved" (done and demonstrated, not just proposed), "in_progress" (being actively
  worked on with real results), "blocked" (cannot move until something specific changes),
  or "open" (little real work yet).
- blocker_kind: what holds it back - "knowledge" (we do not know how), "materials" (we cannot
  make what it needs), "instruments" (we cannot measure or build the tool), "funding",
  "attention" (it could be done but few are working on it), or "none" if solved.
- blocker: one or two plain sentences on exactly what stands in the way, or what was done if solved.
  Describe the state of the world, not this search: never mention "records", "search results",
  or what was or was not found in the list.
- evidence_ids: the ids of the records (from the list under that leaf) that support your
  judgement, most relevant first. Only ids that appear in the list. Can be empty.

A leaf may only be "solved" if at least two records from different research groups support it.

${blocks}`,
      "medium",
    );
    return out.leaves;
  }));
  const verdicts = new Map(assessed.flat().map((x) => [x.key, x]));
  const leaves = work.leaves.map((l) => {
    const v = verdicts.get(l.key);
    if (!v) return { ...l, status: "open", blocker_kind: "knowledge", blocker: "Not yet assessed.", evidence_ids: [] };
    const allowed = new Set(byLeaf[l.key] ?? []);
    const ids = v.evidence_ids.filter((id) => allowed.has(id));
    let status: string = v.status;
    // Parallax rule: "solved" needs two independent sources.
    if (status === "solved" && independentCount(ids, recs) < 2) status = "in_progress";
    return { ...l, status, blocker_kind: v.blocker_kind, blocker: v.blocker, evidence_ids: ids };
  });
  await saveGoal(slug, { stage: "synthesize", work: { ...work, leaves } });
}

async function stageSynthesize(slug: string, goal: { id: number; name: string; handle: string }, work: Work) {
  const recs = work.records ?? {};
  const treeText = work.branches.map((b) =>
    `${b.key} ${b.title}\n` + work.leaves.filter((l) => l.parent === b.key).map((l) =>
      `  ${l.key} [${l.status}; ${l.blocker_kind}] ${l.title} - ${l.blocker} evidence: ${(l.evidence_ids ?? []).join(", ") || "none"}`
    ).join("\n")
  ).join("\n");
  const cited = [...new Set(work.leaves.flatMap((l) => l.evidence_ids ?? []))].map((id) => recs[id]).filter(Boolean);

  const out = await ask(
    SynthSchema,
    VOICE,
    `Goal: ${goal.name} (@${goal.handle})
Today: ${new Date().toISOString().slice(0, 10)}

The goal's tree, each leaf with its status, what blocks it, and its evidence ids:
${treeText}

The evidence records:
${cited.map(recLine).join("\n")}

1. bottleneck_key: the leaf key whose being unsolved holds back the most of this goal. Prefer a
   blocked leaf that other leaves depend on. bottleneck_why: two plain sentences on why.
2. horizon_low / horizon_high: an honest range, in whole years from today, for when this goal
   could plausibly be reached at the current pace of work. Wide ranges are fine.
   horizon_note: one sentence on what the range assumes.
3. posts: 3 or 4 opening posts for the goal's feed, each about one leaf (node_key):
   - exactly one "bottleneck" post about the bottleneck leaf,
   - "advance" posts for real recent progress (records from the last few years),
   - a "setback" post if the evidence shows something that failed or got harder,
   - a "forgotten" post if an older record holds an idea that looks overlooked today.
   headline: at most 12 words, a striking fact that makes someone stop scrolling, never clickbait or
   exaggeration. body: at most 2 short sentences (under 45 words) a teenager could follow, the second
   saying why it matters for the goal. source_ids: the ids of the records
   the post rests on (at least one, from the list above). Do not state anything the records
   and the tree do not support.`,
    "high",
  );

  const leafKeys = new Set(work.leaves.map((l) => l.key));
  const bottleneck = leafKeys.has(out.bottleneck_key)
    ? out.bottleneck_key
    : (work.leaves.find((l) => l.status === "blocked") ?? work.leaves[0]).key;
  const score = (s?: string) => (s === "solved" ? 1 : s === "in_progress" ? 0.5 : 0);
  const progress = work.leaves.reduce((a, l) => a + score(l.status), 0) / Math.max(1, work.leaves.length);
  const pub = (id: string) => {
    const r = recs[id];
    return r ? { title: r.title, url: r.url, year: r.year, venue: r.venue, first_author: r.first_author, id: r.id } : null;
  };

  // Nodes: branches carry no status of their own; the site derives it from their leaves.
  await db(`nodes?goal_id=eq.${goal.id}`, { method: "DELETE" });
  const nodeRows = [
    // Every row in one insert must carry the same keys, so branches spell out the leaf fields too.
    ...work.branches.map((b, i) => ({
      goal_id: goal.id, key: b.key, parent_key: null, position: i, title: b.title, why: b.why,
      status: null, blocker_kind: null, blocker: null, query: null, evidence: [], independent_sources: 0,
    })),
    ...work.leaves.map((l, i) => {
      const ev = (l.evidence_ids ?? []).map(pub).filter(Boolean);
      return {
        goal_id: goal.id, key: l.key, parent_key: l.parent, position: i, title: l.title, why: l.why,
        status: l.status, blocker_kind: l.blocker_kind, blocker: l.blocker, query: l.query,
        evidence: ev, independent_sources: independentCount(l.evidence_ids ?? [], recs),
      };
    }),
  ];
  await db("nodes", { method: "POST", body: nodeRows, prefer: "return=minimal" });

  const bn = work.leaves.find((l) => l.key === bottleneck)!;
  const solved = work.leaves.filter((l) => l.status === "solved").length;
  const posts = [
    {
      goal_id: goal.id, node_key: null, kind: "mapped",
      headline: `@${goal.handle} is now on Parallax`,
      body: `Parallax mapped ${work.leaves.length} problems across ${work.branches.length} branches that stand between us and this goal. ` +
        `${solved} ${solved === 1 ? "is" : "are"} solved. The biggest bottleneck: ${bn.title.charAt(0).toLowerCase() + bn.title.slice(1)}.`,
      sources: [], independent_sources: 0,
    },
    ...out.posts.map((p) => {
      const ids = p.source_ids.filter((id) => recs[id]);
      return {
        goal_id: goal.id,
        node_key: leafKeys.has(p.node_key) ? p.node_key : null,
        kind: p.kind,
        headline: p.headline,
        body: p.body,
        sources: ids.map(pub).filter(Boolean),
        independent_sources: independentCount(ids, recs),
      };
    }).filter((p) => p.sources.length > 0), // every post must cite a real record
  ];
  await db("posts", { method: "POST", body: posts, prefer: "return=minimal" });

  const now = new Date().toISOString();
  await saveGoal(slug, {
    status: "ready", stage: "done", work: null, error: null,
    progress, bottleneck_key: bottleneck,
    horizon_low: Math.max(0, Math.round(Math.min(out.horizon_low, out.horizon_high))),
    horizon_high: Math.max(0, Math.round(Math.max(out.horizon_low, out.horizon_high))),
    horizon_note: out.horizon_note,
    mapped_at: now, pulsed_at: now,
  });
  // Cost estimates and the first videos don't need the paper library: start them now rather than
  // at the next hourly run.
  const kick = Promise.all(["costs", "reels"].map((fn) => fetch(`${SB}/functions/v1/${fn}`, {
    method: "POST", headers: { Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", "x-parallax-admin": ADMIN },
    body: JSON.stringify({ slug }),
  }).catch(() => {})));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(kick);
}

async function runStage(slug: string) {
  const g = await getGoal(slug);
  if (!g || g.status !== "mapping") return;
  try {
    const work = g.work as Work;
    if (g.stage === "evidence") await stageEvidence(slug, work);
    else if (g.stage === "assess") await stageAssess(slug, g.name, work);
    else if (g.stage === "synthesize") await stageSynthesize(slug, g, work);
    else return;
  } catch (e) {
    await saveGoal(slug, { status: "failed", error: `${g.stage}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500) });
    return;
  }
  chain(slug);
}

// Start the next stage in a fresh invocation, after this one has answered.
function chain(slug: string) {
  const call = fetch(`${SB}/functions/v1/map-goal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", "x-parallax-admin": ADMIN },
    body: JSON.stringify({ continue: slug }),
  }).catch(() => {});
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(call);
}

// ---------------------------------------------------------------- handler

const cleanSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const cleanHandle = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 20);

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = ADMIN !== "" && req.headers.get("x-parallax-admin") === ADMIN;
  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }

  // Continue a goal that is already mapping (stage chain, pulse, or a manual retry).
  if (typeof body.continue === "string") {
    if (!admin) return json({ error: "not allowed" }, 403);
    const g = await getGoal(body.continue);
    if (!g) return json({ error: "no such goal" }, 404);
    if (g.status === "failed" && body.retry) {
      await saveGoal(g.slug, { status: "mapping", error: null });
    }
    const p = runStage(g.slug);
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
    else await p;
    return json({ slug: g.slug, stage: g.stage });
  }

  const query = String(body.query ?? "").trim().replace(/\s+/g, " ");
  if (query.length < 3 || query.length > 160) return json({ error: "Type a goal between 3 and 160 characters." }, 400);

  if (!admin) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const [recent, searches] = await Promise.all([
      db(`goals?created_at=gte.${since}&select=id`),
      db(`map_requests?created_at=gte.${since}&select=id`),
    ]);
    if ((recent?.length ?? 0) >= PER_HOUR || (searches?.length ?? 0) >= SEARCHES_PER_HOUR) {
      return json({ error: "Parallax is mapping a lot of new goals right now. Try again within the hour." }, 429);
    }
    await db("map_requests", { method: "POST", body: { query }, prefer: "return=minimal" });
  }

  const existing: { slug: string; name: string }[] = await db("goals?status=neq.failed&select=slug,name&order=id.asc&limit=2000");
  let tree: Tree;
  try {
    tree = await draftTree(query, existing);
  } catch (e) {
    if (e instanceof Refused) return json({ rejected: "Parallax can't map that one." });
    console.error("draftTree failed:", e instanceof Error ? e.message : e);
    return json({ error: "Parallax can't map new goals right now. Please try again later.", ...(admin ? { detail: String(e instanceof Error ? e.message : e).slice(0, 300) } : {}) }, 503);
  }

  if (tree.verdict === "reject") return json({ rejected: tree.reject_reason || "That isn't a goal Parallax can map." });
  if (tree.verdict === "duplicate" && tree.duplicate_slug && existing.some((g) => g.slug === tree.duplicate_slug)) {
    return json({ slug: tree.duplicate_slug, duplicate: true });
  }

  let slug = cleanSlug(tree.slug || tree.name);
  let handleName = cleanHandle(tree.handle || tree.name);
  if (!slug || !handleName || tree.branches.length === 0) return json({ error: "The goal could not be broken down. Try wording it as an outcome." }, 422);
  const taken = await getGoal(slug);
  if (taken) return json({ slug, duplicate: true });
  const handleTaken = await db(`goals?handle=eq.${encodeURIComponent(handleName)}&select=id`);
  if (handleTaken?.length) {
    const n = Math.floor(Math.random() * 90 + 10);
    handleName = `${handleName.slice(0, 18)}${n}`;
    slug = `${slug}-${n}`;
  }

  const work: Work = { branches: [], leaves: [] };
  tree.branches.forEach((b, i) => {
    const bk = `b${i + 1}`;
    work.branches.push({ key: bk, title: b.title, why: b.why });
    b.leaves.forEach((l, j) => work.leaves.push({ key: `${bk}.${j + 1}`, parent: bk, title: l.title, why: l.why, query: l.query }));
  });

  try {
    await db("goals", {
      method: "POST",
      prefer: "return=minimal",
      body: { slug, handle: handleName, name: tree.name, summary: tree.summary, requested_as: query, status: "mapping", stage: "evidence", work },
    });
  } catch {
    // Two people searched for the same goal at the same moment.
    return json({ slug, duplicate: true });
  }
  chain(slug);
  return json({ slug, status: "mapping" });
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
