// PARALLAX costs — Supabase Edge Function named `costs`. "What it would take" for every problem.
//
// For each problem, Claude researches with live web search: the next concrete step that would move
// it forward and what that costs, what solving it for this goal would cost, who funds this work
// today, and what the numbers are based on (comparable programs, budgets, contracts). Then a second
// call turns the notes into structured estimates. Sources are only pages the search really returned.
// Estimates are ranges with a confidence level, and the site labels them as Parallax estimates.
//
// Runs hourly: collects finished research batches, then submits the next goal's stale chapters.
// An estimate is redone after 6 months, or sooner when its problem changes.
//   POST {}  next goal or chapter due · POST {"slug": "mars"}  that goal now · {"fresh": true} redo it
// Header x-parallax-admin: <ADMIN_TOKEN>. Secrets: ANTHROPIC_API_KEY, ADMIN_TOKEN, PARALLAX_MODEL.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";
const DAY = 86_400_000;

const claude = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`database ${r.status} on ${path.split("?")[0]}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

type Node = { key: string; parent_key: string | null; title: string; plain_title: string | null; why: string | null; blocker: string | null; status: string };

const Estimate = z.object({
  key: z.string().describe("The problem's key, exactly as given."),
  next_step: z.string().describe("The next concrete step that would move this problem forward, at most 14 words. A real milestone: a prototype, a test, a mission, a trial."),
  next_low_usd: z.number().describe("Low end of what that next step would cost, in US dollars."),
  next_high_usd: z.number().describe("High end, in US dollars."),
  next_time: z.string().describe("How long that step would take, at most 4 words, e.g. '2-3 years'."),
  solve_low_usd: z.number().describe("Low end of what solving this problem for the goal would cost in total, in US dollars. 0 if already solved."),
  solve_high_usd: z.number().describe("High end, in US dollars. 0 if already solved."),
  funders: z.string().describe("Who pays for this work today, at most 16 words, e.g. 'Mostly NASA and ESA; almost no private money'."),
  basis: z.string().describe("What the numbers rest on, at most 45 words: comparable programs, budgets or contracts, with their figures. Plain words."),
  confidence: z.enum(["low", "medium", "high"]).describe("high: close comparables with public budgets. medium: rough comparables. low: little to go on."),
  sources: z.array(z.number()).describe("Numbers of the sources (from the list) that support the figures. Up to 3."),
});
const Fact = z.object({
  fact: z.string().describe("One concrete cost figure as a standalone sentence: who paid or will pay how much, for what, and when. E.g. 'NASA awarded SpaceX $2.89B for the Starship lunar lander (2021).'"),
  amount_usd: z.number().describe("The amount in US dollars (convert if needed)."),
  year: z.number().describe("The year of the figure; 0 if unknown."),
  source: z.number().describe("Number of the source it comes from; -1 if none."),
});
const Estimates = z.object({
  items: z.array(Estimate),
  facts: z.array(Fact).describe("Every concrete, sourced cost figure in the notes (budgets, contracts, grants, raises, cost studies), for reuse by other estimates. Only figures with a source."),
});
type Known = { fact: string; source_title: string | null; source_url: string | null };

// Step 1: research with live web search. Runs as an Anthropic message batch (half price, no time
// limit): one call submits every stale chapter of a goal, a later call collects and structures them.
const SYSTEM = "You are a research analyst estimating what scientific and engineering problems would cost to solve. You search for real budgets and costs and you never invent figures.";
function researchPrompt(goal: string, chapter: string, probs: Node[], known: Known[] = []) {
  return `${known.length ? `FIGURES ALREADY KNOWN (from earlier research, with sources; use them and only search for what they do not cover):\n${known.map((k) => `- ${k.fact}`).join("\n")}\n\n` : ""}Goal: ${goal}
Chapter: ${chapter}
Problems:
${probs.map((p) => `- [${p.key}] ${p.plain_title || p.title} (status: ${p.status}). ${p.blocker ? `In the way: ${p.blocker}` : ""}`).join("\n")}

For each problem, find out what it would cost. Search for real figures: budgets of comparable programs and missions, contract values, grant sizes, company raises, published cost studies. Then write short notes per problem:
1. The next concrete step that would move it forward, and what that step would cost (a range) and take.
2. What solving it for this goal would cost in total (a range).
3. Who funds this work today.
4. The figures your estimate rests on, each with where it came from.
Be honest about uncertainty: wide ranges are fine, invented precision is not.`;
}
// deno-lint-ignore no-explicit-any
function readResearch(content: any[]) {
  let text = "";
  const pages = new Map<string, string>();
  for (const b of content) {
    if (b.type === "text") text += b.text;
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) pages.set(r.url, r.title ?? r.url);
  }
  return { text, pages: [...pages].map(([url, title]) => ({ url, title })) };
}

// Step 2: turn the notes into structured estimates.
async function structure(probs: Node[], notes: string, pages: { url: string; title: string }[]) {
  const msg = await claude.beta.messages.stream({
    model: MODEL, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Estimates) },
    messages: [{
      role: "user",
      content: `Turn these research notes into one estimate per problem. Use only figures the notes support. Write in plain words that anyone can follow, keeping correct technical terms. Never say 'author' or 'I'; where a figure is a judgement, say 'our estimate'.

PROBLEMS: ${probs.map((p) => `[${p.key}] ${p.plain_title || p.title}`).join(" | ")}

NOTES:
${notes}

SOURCES (cite by number):
${pages.map((p, i) => `${i}. ${p.title} — ${p.url}`).join("\n")}`,
    }],
  }).finalMessage().then(track("costs"));
  return { items: msg.parsed_output?.items ?? [], facts: msg.parsed_output?.facts ?? [] };
}

const usd = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : null);

async function saveChapter(g: { id: number }, probs: Node[], text: string, found: { url: string; title: string }[], known: Known[] = []) {
  // Figures already in the budget library count as sources too, with their original links.
  const pages = [...found, ...known.filter((k) => k.source_url).map((k) => ({ url: k.source_url as string, title: k.source_title ?? k.source_url as string }))];
  const notes = known.length ? `${text}\n\nFIGURES ALREADY KNOWN FROM EARLIER RESEARCH:\n${known.map((k) => `- ${k.fact}${k.source_url ? ` (source: ${k.source_title ?? k.source_url})` : ""}`).join("\n")}` : text;
  const { items, facts } = await structure(probs, notes, pages);
  // Every new sourced figure joins the shared budget library.
  const newFacts = facts.filter((f) => f.source >= 0 && pages[f.source] && f.fact.trim().length > 15).map((f) => ({
    fact: f.fact.trim().slice(0, 400), amount_usd: Number.isFinite(f.amount_usd) && f.amount_usd > 0 ? Math.round(f.amount_usd) : null, year: f.year > 1900 ? Math.round(f.year) : null,
    source_title: pages[f.source].title.slice(0, 300), source_url: pages[f.source].url, goal_id: g.id,
  }));
  if (newFacts.length) await db("budget_facts?on_conflict=fact", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: newFacts }).catch(() => {});
  const rows = items.filter((e) => probs.some((p) => p.key === e.key)).map((e) => {
    let [nl, nh, sl, sh] = [usd(e.next_low_usd), usd(e.next_high_usd), usd(e.solve_low_usd), usd(e.solve_high_usd)];
    if (nl && nh && nl > nh) [nl, nh] = [nh, nl];
    if (sl && sh && sl > sh) [sl, sh] = [sh, sl];
    return {
      goal_id: g.id, node_key: e.key, next_step: e.next_step.trim().slice(0, 160), next_low: nl, next_high: nh, next_time: e.next_time.trim().slice(0, 40) || null,
      solve_low: sl, solve_high: sh, funders: e.funders.trim().slice(0, 160) || null, basis: e.basis.trim().slice(0, 400) || null, confidence: e.confidence,
      sources: [...new Set(e.sources)].map((i) => pages[i]).filter(Boolean).slice(0, 3),
      estimated_at: new Date().toISOString(),
    };
  });
  if (rows.length) await db("node_costs?on_conflict=goal_id,node_key", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows });
  return rows.length;
}

// A problem's estimate is redone after 6 months, or sooner when the problem itself changed.
const STALE_DAYS = 180;

// Attention: followers and recent visits (goal_attention). Goals nobody follows or visited in the
// last 30 days get no expensive extras until someone does; the most-watched go first.
async function attention(): Promise<Map<number, number>> {
  const rows = await db(`goal_attention?select=goal_id,score`).catch(() => []);
  return new Map(rows.map((r: { goal_id: number; score: number }) => [r.goal_id, r.score]));
}

async function collect() {
  const jobs = await db(`cost_jobs?status=eq.pending&select=batch_id,goal_id,chapters,known,created_at`);
  const out = [];
  for (const j of jobs) {
    const b = await claude.messages.batches.retrieve(j.batch_id);
    if (b.processing_status !== "ended") {
      if (Date.now() - new Date(j.created_at).getTime() > 26 * 3600_000) await db(`cost_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed" } });
      continue;
    }
    const nodes: Node[] = await db(`nodes?goal_id=eq.${j.goal_id}&select=key,parent_key,title,plain_title,why,blocker,status`);
    const work: Promise<number>[] = [], errors: string[] = [];
    for await (const r of await claude.messages.batches.results(j.batch_id)) {
      if (r.result.type !== "succeeded") { errors.push(`${r.custom_id}: ${r.result.type}`); continue; }
      track("costs", true)(r.result.message);
      const { text, pages } = readResearch(r.result.message.content);
      const probs = (j.chapters[r.custom_id] ?? []).map((k: string) => nodes.find((n) => n.key === k)).filter(Boolean);
      if (!text.trim() || !probs.length) { errors.push(`${r.custom_id}: no notes`); continue; }
      work.push(saveChapter({ id: j.goal_id }, probs, text, pages, j.known?.[r.custom_id] ?? []).catch((e) => { errors.push(String(e).slice(0, 120)); return 0; }));
    }
    const n = (await Promise.all(work)).reduce((a, x) => a + x, 0);
    await db(`cost_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "done" } });
    out.push({ batch: j.batch_id, estimated: n, errors });
  }
  return out;
}

async function submit(slug?: string, fresh = false) {
  const pending = await db(`cost_jobs?status=eq.pending&select=goal_id`);
  if (!slug && pending.length) return { note: "a batch is still running" };
  const all = await db(`goals?status=eq.ready&select=id,slug,name${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=id.asc`);
  const att = await attention();
  const goals = slug ? all : all.filter((g: { id: number }) => (att.get(g.id) ?? 0) > 0).sort((a: { id: number }, b: { id: number }) => (att.get(b.id) ?? 0) - (att.get(a.id) ?? 0));
  for (const g of goals) {
    if (pending.some((p: { goal_id: number }) => p.goal_id === g.id)) continue;
    const [nodes, have] = await Promise.all([
      db(`nodes?goal_id=eq.${g.id}&select=key,parent_key,title,plain_title,why,blocker,status,updated_at&order=position.asc`),
      db(`node_costs?goal_id=eq.${g.id}&select=node_key,estimated_at`),
    ]);
    const est = new Map(have.map((h: { node_key: string; estimated_at: string }) => [h.node_key, new Date(h.estimated_at).getTime()]));
    const ok = (n: Node & { updated_at?: string }) => {
      const t = est.get(n.key) as number | undefined;
      return !fresh && t !== undefined && Date.now() - t < STALE_DAYS * DAY && (!n.updated_at || new Date(n.updated_at).getTime() <= t);
    };
    const chapters = (nodes as Node[]).filter((n) => !n.parent_key).map((c) => ({ c, probs: (nodes as Node[]).filter((n) => n.parent_key === c.key && !ok(n)) })).filter((x) => x.probs.length);
    if (!chapters.length) continue;
    // Start from the budget library: figures other estimates already found.
    const known: Known[][] = await Promise.all(chapters.map((x) => db("rpc/parallax_match_facts", { method: "POST", body: { q: [x.c.title, ...x.probs.map((p) => p.plain_title || p.title)].join(" "), n: 25 } }).then((r: Known[]) => r.map((k) => ({ fact: k.fact, source_title: k.source_title, source_url: k.source_url }))).catch(() => [])));
    const batch = await claude.messages.batches.create({
      requests: chapters.map((x, i) => ({
        custom_id: `c${i}`,
        params: {
          model: MODEL, max_tokens: 64000, output_config: { effort: "medium" }, system: SYSTEM,
          // Cache what the model has read: each search step re-reads earlier results at 10% of the price.
          cache_control: { type: "ephemeral" },
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: known[i].length >= 15 ? 4 : known[i].length >= 6 ? 7 : 10 }],
          messages: [{ role: "user", content: researchPrompt(g.name, x.c.title, x.probs, known[i]) }],
        },
      })),
    });
    await db("cost_jobs", { method: "POST", prefer: "return=minimal", body: { batch_id: batch.id, goal_id: g.id, chapters: Object.fromEntries(chapters.map((x, i) => [`c${i}`, x.probs.map((p) => p.key)])), known: Object.fromEntries(chapters.map((_, i) => [`c${i}`, known[i]])) } });
    return { submitted: batch.id, slug: g.slug, chapters: chapters.length };
  }
  return { note: "every problem has a recent estimate" };
}

// One-off: pull the figures out of estimates made before the budget library existed.
async function backfill() {
  const rows = await db(`node_costs?select=goal_id,node_key,basis,sources&basis=not.is.null`);
  const byGoal = new Map<number, typeof rows>();
  for (const r of rows) byGoal.set(r.goal_id, [...(byGoal.get(r.goal_id) ?? []), r]);
  const FactsOnly = z.object({ facts: z.array(Fact) });
  let added = 0;
  for (const [goalId, list] of byGoal) {
    const pages: { url: string; title: string }[] = [];
    const notes = list.map((r: { basis: string; sources: { url: string; title: string }[] }) => {
      const idx = (r.sources ?? []).map((src) => { pages.push(src); return pages.length - 1; });
      return `- ${r.basis} [sources: ${idx.join(", ") || "none"}]`;
    }).join("\n");
    const msg = await claude.beta.messages.stream({
      model: MODEL, max_tokens: 32000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(FactsOnly) },
      messages: [{ role: "user", content: `List every concrete cost figure in these notes as a standalone fact, with the number of its source. Skip estimates and judgements; keep only real budgets, contracts, grants, raises and published costs.\n\nNOTES:\n${notes}\n\nSOURCES:\n${pages.map((p, i) => `${i}. ${p.title} — ${p.url}`).join("\n")}` }],
    }).finalMessage().then(track("costs"));
    const facts = (msg.parsed_output?.facts ?? []).filter((f) => f.source >= 0 && pages[f.source] && f.fact.trim().length > 15).map((f) => ({
      fact: f.fact.trim().slice(0, 400), amount_usd: Number.isFinite(f.amount_usd) && f.amount_usd > 0 ? Math.round(f.amount_usd) : null, year: f.year > 1900 ? Math.round(f.year) : null,
      source_title: pages[f.source].title.slice(0, 300), source_url: pages[f.source].url, goal_id: goalId,
    }));
    if (facts.length) await db("budget_facts?on_conflict=fact", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: facts });
    added += facts.length;
  }
  return { added };
}

async function run(slug?: string, fresh = false) {
  return { collected: await collect(), submitted: await submit(slug, fresh) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "backfill") return json(await backfill());
    return json(await run(body.slug, !!body.fresh));
  } catch (e) {
    console.error("costs failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
