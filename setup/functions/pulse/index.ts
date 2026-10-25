// PARALLAX pulse — Supabase Edge Function named `pulse`.
//
// Keeps every goal alive. Each call takes the one goal that has gone longest
// without a check, searches OpenAlex for research published since its last
// check on every leaf of its tree, and asks Claude which of the new papers
// actually move a leaf forward, set it back, or turn it solved. Those become
// posts in the feed, and the tree and the goal's progress update with them.
//
// Each call also restarts any goal whose mapping has been stuck for more than
// ten minutes (see `map-goal`).
//
// Schedule it every 10 minutes (see setup/README-feed.md). One goal per call
// means 144 goal checks a day; each goal gets checked about once a day while
// there are fewer than ~140 goals.
//
// Request: POST {} with header x-parallax-admin: <ADMIN_TOKEN>
//          optionally {"slug": "mars"} to pulse one goal now.
//
// Secrets: the same as map-goal (ANTHROPIC_API_KEY, ADMIN_TOKEN, PARALLAX_MODEL, CONTACT_EMAIL, OPENALEX_API_KEY).

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";
const MAIL = Deno.env.get("CONTACT_EMAIL") ?? "";
const OA_KEY = Deno.env.get("OPENALEX_API_KEY") ?? "";
const PULSE_EVERY_HOURS = 20;

const claude = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

type Rec = {
  id: string;
  title: string;
  year: number | null;
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

async function openAlexSince(q: string, from: string): Promise<Rec[]> {
  const params = new URLSearchParams({
    search: q,
    "per-page": "5",
    filter: `has_abstract:true,from_publication_date:${from}`,
    select: "id,doi,title,publication_year,primary_location,authorships,abstract_inverted_index",
  });
  if (MAIL) params.set("mailto", MAIL);
  if (OA_KEY) params.set("api_key", OA_KEY);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`https://api.openalex.org/works?${params}`, { signal: ctl.signal });
    if (!r.ok) return [];
    const data = await r.json();
    // deno-lint-ignore no-explicit-any
    return (data.results ?? []).map((w: any): Rec => ({
      id: String(w.id ?? "").split("/").pop() ?? "",
      title: String(w.title ?? "").slice(0, 300),
      year: w.publication_year ?? null,
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

const ChangeSchema = z.object({
  changes: z.array(z.object({
    node_key: z.string(),
    kind: z.enum(["advance", "setback", "solved", "forgotten"]),
    new_status: z.enum(["solved", "in_progress", "blocked", "open", "unchanged"]),
    headline: z.string(),
    body: z.string(),
    source_ids: z.array(z.string()),
  })),
});

// deno-lint-ignore no-explicit-any
type Node = any;

type Goal = { id: number; slug: string; name: string; handle: string; pulsed_at: string | null; mapped_at: string | null; bottleneck_key: string | null };

// The research check runs through the Message Batches API (half price, same model and prompt):
// one call gathers new research and submits it; a later call (10 minutes on) applies the answer.
// {"slug": "...", "live": true} runs it at once instead, for testing.
async function pulseGoal(goal: Goal, live = false) {
  const nodes: Node[] = await db(`nodes?goal_id=eq.${goal.id}&select=*&order=position.asc`);
  const leaves = nodes.filter((n) => n.parent_key);
  const since = (goal.pulsed_at ?? goal.mapped_at ?? new Date(Date.now() - 14 * 864e5).toISOString()).slice(0, 10);
  const known = new Set(leaves.flatMap((l) => (l.evidence ?? []).map((e: { id?: string }) => e.id)).filter(Boolean));
  const found = await pool(leaves, 5, (l) => openAlexSince(l.query || l.title, since));
  const recs: Record<string, Rec> = {};
  const byLeaf: Record<string, string[]> = {};
  leaves.forEach((l, i) => {
    for (const r of found[i]) {
      if (known.has(r.id)) continue;
      recs[r.id] = r;
      (byLeaf[l.key] ??= []).push(r.id);
    }
  });
  const now = new Date().toISOString();
  if (Object.keys(recs).length === 0) {
    await db(`goals?id=eq.${goal.id}`, { method: "PATCH", body: { pulsed_at: now, updated_at: now } });
    return { slug: goal.slug, new_records: 0, posts: 0 };
  }
  const blocks = leaves.filter((l) => byLeaf[l.key]?.length).map((l) =>
    `LEAF ${l.key} [${l.status}; ${l.blocker_kind}] ${l.title}\nWhat blocks it: ${l.blocker}\nNew records:\n` +
    byLeaf[l.key].map((id) => {
      const r = recs[id];
      return `[${r.id}] ${r.title} (${r.year ?? "n.d."}; ${r.first_author || "unknown author"}; ${r.venue || "unknown venue"}) ${r.abstract}`;
    }).join("\n")
  ).join("\n\n");
  const system = `You work for Parallax, a public feed of human progress. People follow goals the way they
follow accounts. Write plainly for a curious non-expert. Never invent facts, numbers, papers or people.
Most new papers change nothing: posting nothing is the right answer most days.`;
  const content = `Goal: ${goal.name} (@${goal.handle})
Research published since ${since} on the problems in this goal's tree:

${blocks}

Return a change only when a record really moves a leaf: a demonstrated result ("advance"), a failure
or new obstacle ("setback"), a leaf now done ("solved"), or an older idea resurfacing that looks
overlooked ("forgotten"). Ignore reviews that only restate known work, and off-topic records.
For each change: node_key, kind, new_status for the leaf ("unchanged" if its status stays),
a headline of at most 12 words that states the fact in a way that makes someone stop scrolling (never
clickbait or exaggeration), a body of at most 2 short sentences (under 45 words), the second saying
why it matters for the goal, and source_ids from the records listed under that leaf.
Write about the research and the world, never about "records" or this search.
"solved" needs at least two records from different research groups. At most 3 changes.`;
  const fmt = betaZodOutputFormat(ChangeSchema);
  if (!live) {
    try {
      const batch = await claude.messages.batches.create({ requests: [{ custom_id: `g${goal.id}`, params: {
        model: MODEL, max_tokens: 64000, output_config: { effort: "medium", format: { type: "json_schema", schema: fmt.schema } },
        system, messages: [{ role: "user", content }],
      } }] });
      await db("pulse_jobs", { method: "POST", prefer: "return=minimal", body: { batch_id: batch.id, goal_id: goal.id, recs, by_leaf: byLeaf } });
    } catch (e) {
      // If the model is unavailable (no credit, outage), skip this goal until tomorrow instead of
      // retrying it every ten minutes and spending the day's archive searches on it.
      await db(`goals?id=eq.${goal.id}`, { method: "PATCH", body: { pulsed_at: now, updated_at: now } });
      return { slug: goal.slug, new_records: Object.keys(recs).length, posts: 0, note: `model unavailable: ${e instanceof Error ? e.message.slice(0, 120) : e}` };
    }
    await db(`goals?id=eq.${goal.id}`, { method: "PATCH", body: { pulsed_at: now, updated_at: now } });
    return { slug: goal.slug, new_records: Object.keys(recs).length, submitted: true };
  }
  let msg;
  try {
    msg = await claude.beta.messages.stream({
      model: MODEL, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "medium", format: fmt }, system, messages: [{ role: "user", content }],
    }).finalMessage().then(track("pulse"));
  } catch (e) {
    await db(`goals?id=eq.${goal.id}`, { method: "PATCH", body: { pulsed_at: now, updated_at: now } });
    return { slug: goal.slug, new_records: Object.keys(recs).length, posts: 0, note: `model unavailable: ${e instanceof Error ? e.message.slice(0, 120) : e}` };
  }
  if (msg.stop_reason === "refusal" || msg.parsed_output == null) {
    await db(`goals?id=eq.${goal.id}`, { method: "PATCH", body: { pulsed_at: now, updated_at: now } });
    return { slug: goal.slug, new_records: Object.keys(recs).length, posts: 0, note: msg.stop_reason };
  }
  return applyChanges(goal, leaves, recs, byLeaf, msg.parsed_output.changes);
}

// Collect finished research checks and apply them.
async function collect() {
  const jobs = await db(`pulse_jobs?status=eq.pending&select=batch_id,goal_id,recs,by_leaf,created_at&order=created_at.asc&limit=20`);
  const out = [];
  const fmt = betaZodOutputFormat(ChangeSchema);
  for (const j of jobs) {
    const b = await claude.messages.batches.retrieve(j.batch_id);
    if (b.processing_status !== "ended") {
      if (Date.now() - new Date(j.created_at).getTime() > 26 * 3600_000) await db(`pulse_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed" } });
      continue;
    }
    let result: unknown = { note: "no result" };
    for await (const r of await claude.messages.batches.results(j.batch_id)) {
      if (r.result.type !== "succeeded") { result = { note: r.result.type }; continue; }
      const m = r.result.message;
      track("pulse", true)(m);
      const text = m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      try {
        const parsed = fmt.parse(text);
        const goal = (await db(`goals?id=eq.${j.goal_id}&select=id,slug,name,handle,pulsed_at,mapped_at,bottleneck_key`))[0];
        const nodes: Node[] = await db(`nodes?goal_id=eq.${j.goal_id}&select=*&order=position.asc`);
        if (goal) result = await applyChanges(goal, nodes.filter((n) => n.parent_key), j.recs, j.by_leaf, parsed.changes);
      } catch (e) { result = { note: `could not read the answer: ${String(e).slice(0, 100)}` }; }
    }
    await db(`pulse_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "done" } });
    out.push(result);
  }
  return out;
}

async function applyChanges(goal: Goal, leaves: Node[], recs: Record<string, Rec>, byLeaf: Record<string, string[]>, changes: z.infer<typeof ChangeSchema>["changes"]) {
  const now = new Date().toISOString();
  const leafByKey = new Map(leaves.map((l) => [l.key, l]));
  const pub = (r: Rec) => ({ id: r.id, title: r.title, url: r.url, year: r.year, venue: r.venue, first_author: r.first_author });
  const authors = (ids: string[]) => new Set(ids.map((id) => recs[id]?.first_author?.toLowerCase().trim()).filter(Boolean)).size;

  const posts = [];
  for (const c of changes.slice(0, 3)) {
    const leaf = leafByKey.get(c.node_key);
    if (!leaf) continue;
    const ids = c.source_ids.filter((id) => (byLeaf[c.node_key] ?? []).includes(id));
    if (ids.length === 0) continue; // every post must cite a real record
    let kind: string = c.kind;
    let status = c.new_status === "unchanged" ? leaf.status : c.new_status;
    // Parallax rule: "solved" needs two independent sources, counting the leaf's existing evidence.
    if (status === "solved") {
      const prior = (leaf.evidence ?? []).map((e: { first_author?: string }) => e.first_author?.toLowerCase().trim()).filter(Boolean);
      const all = new Set([...prior, ...ids.map((id) => recs[id].first_author.toLowerCase().trim()).filter(Boolean)]);
      if (all.size < 2) {
        status = leaf.status === "solved" ? "solved" : "in_progress";
        if (kind === "solved") kind = "advance";
      }
    }
    const evidence = [...ids.map((id) => pub(recs[id])), ...(leaf.evidence ?? [])].slice(0, 12);
    await db(`nodes?id=eq.${leaf.id}`, {
      method: "PATCH",
      body: { status, evidence, independent_sources: new Set(evidence.map((e) => e.first_author?.toLowerCase().trim()).filter(Boolean)).size, updated_at: now },
    });
    leaf.status = status;
    posts.push({
      goal_id: goal.id, node_key: leaf.key, kind, headline: c.headline, body: c.body,
      sources: ids.map((id) => pub(recs[id])), independent_sources: authors(ids),
    });
  }
  if (posts.length) await db("posts", { method: "POST", body: posts, prefer: "return=minimal" });

  const score = (s?: string) => (s === "solved" ? 1 : s === "in_progress" ? 0.5 : 0);
  const progress = leaves.reduce((a, l) => a + score(l.status), 0) / Math.max(1, leaves.length);
  let bottleneck = goal.bottleneck_key;
  if (bottleneck && leafByKey.get(bottleneck)?.status === "solved") {
    bottleneck = (leaves.find((l) => l.status === "blocked") ?? leaves.find((l) => l.status !== "solved"))?.key ?? null;
  }
  await db(`goals?id=eq.${goal.id}`, {
    method: "PATCH",
    body: { pulsed_at: now, updated_at: now, progress, bottleneck_key: bottleneck },
  });
  return { slug: goal.slug, new_records: Object.keys(recs).length, posts: posts.length };
}

async function restartStuck() {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const stuck: { slug: string }[] = await db(`goals?status=eq.mapping&updated_at=lt.${cutoff}&select=slug&limit=3`);
  for (const g of stuck) {
    await db(`goals?slug=eq.${encodeURIComponent(g.slug)}`, { method: "PATCH", body: { updated_at: new Date().toISOString() } });
    const call = fetch(`${SB}/functions/v1/map-goal`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", "x-parallax-admin": ADMIN },
      body: JSON.stringify({ continue: g.slug }),
    }).catch(() => {});
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(call);
  }
  return stuck.map((g) => g.slug);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  try {
    // deno-lint-ignore no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const restarted = await restartStuck();
    const collected = await collect().catch((e) => [{ error: String(e).slice(0, 120) }]);
    const cols = "id,slug,name,handle,pulsed_at,mapped_at,bottleneck_key";
    let goal;
    if (typeof body.slug === "string") {
      goal = (await db(`goals?slug=eq.${encodeURIComponent(body.slug)}&status=eq.ready&select=${cols}`))?.[0];
    } else {
      const due = new Date(Date.now() - PULSE_EVERY_HOURS * 3600_000).toISOString();
      goal = (await db(`goals?status=eq.ready&or=(pulsed_at.is.null,pulsed_at.lt.${due})&select=${cols}&order=pulsed_at.asc.nullsfirst&limit=1`))?.[0];
    }
    if (!goal) return json({ pulsed: null, collected, restarted });
    const result = await pulseGoal(goal, body.live === true);
    return json({ pulsed: result, collected, restarted });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
