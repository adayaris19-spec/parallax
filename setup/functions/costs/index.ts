// PARALLAX costs — Supabase Edge Function named `costs`. "What it would take" for every problem.
//
// For each problem, Claude researches with live web search: the next concrete step that would move
// it forward and what that costs, what solving it for this goal would cost, who funds this work
// today, and what the numbers are based on (comparable programs, budgets, contracts). Then a second
// call turns the notes into structured estimates. Sources are only pages the search really returned.
// Estimates are ranges with a confidence level, and the site labels them as Parallax estimates.
//
// Runs hourly: one goal, up to 2 chapters per call (chapters run in parallel). Re-estimated monthly.
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
const PER_CALL = 2; // chapters run in parallel; 2 keeps a call well under the time limit

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
const Estimates = z.object({ items: z.array(Estimate) });

// Step 1: research with live web search. Returns the notes and the pages the searches returned.
async function research(goal: string, chapter: string, probs: Node[]) {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{
    role: "user",
    content: `Goal: ${goal}
Chapter: ${chapter}
Problems:
${probs.map((p) => `- [${p.key}] ${p.plain_title || p.title} (status: ${p.status}). ${p.blocker ? `In the way: ${p.blocker}` : ""}`).join("\n")}

For each problem, find out what it would cost. Search for real figures: budgets of comparable programs and missions, contract values, grant sizes, company raises, published cost studies. Then write short notes per problem:
1. The next concrete step that would move it forward, and what that step would cost (a range) and take.
2. What solving it for this goal would cost in total (a range).
3. Who funds this work today.
4. The figures your estimate rests on, each with where it came from.
Be honest about uncertainty: wide ranges are fine, invented precision is not.`,
  }];
  let text = "";
  const pages = new Map<string, string>();
  for (let turn = 0; turn < 4; turn++) {
    const msg = await claude.beta.messages.stream({
      model: MODEL, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "medium" },
      system: "You are a research analyst estimating what scientific and engineering problems would cost to solve. You search for real budgets and costs and you never invent figures.",
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }],
      messages,
    }).finalMessage();
    for (const b of msg.content) {
      if (b.type === "text") text += b.text;
      // deno-lint-ignore no-explicit-any
      if (b.type === "web_search_tool_result" && Array.isArray((b as any).content)) for (const r of (b as any).content) if (r.url) pages.set(r.url, r.title ?? r.url);
    }
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
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
  }).finalMessage();
  return msg.parsed_output?.items ?? [];
}

const usd = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : null);

async function doChapter(g: { id: number; name: string }, chapter: Node, probs: Node[]) {
  const { text, pages } = await research(g.name, chapter.title, probs);
  if (!text.trim()) throw new Error(`no research notes for ${chapter.key}`);
  const items = await structure(probs, text, pages);
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

async function run(slug?: string, fresh = false) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,name${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=id.asc`);
  for (const g of goals) {
    const [nodes, have] = await Promise.all([
      db(`nodes?goal_id=eq.${g.id}&select=key,parent_key,title,plain_title,why,blocker,status&order=position.asc`),
      db(`node_costs?goal_id=eq.${g.id}&select=node_key,estimated_at`),
    ]);
    const fresh_ = new Set(have.filter((h: { estimated_at: string }) => !fresh && Date.now() - new Date(h.estimated_at).getTime() < 30 * DAY).map((h: { node_key: string }) => h.node_key));
    if (fresh && slug) await db(`node_costs?goal_id=eq.${g.id}`, { method: "DELETE", prefer: "return=minimal" });
    const chapters = (nodes as Node[]).filter((n) => !n.parent_key).map((c) => ({ c, probs: (nodes as Node[]).filter((n) => n.parent_key === c.key && !fresh_.has(n.key)) })).filter((x) => x.probs.length);
    if (!chapters.length) continue;
    const todo = chapters.slice(0, PER_CALL);
    const results = await Promise.allSettled(todo.map((x) => doChapter(g, x.c, x.probs)));
    return {
      slug: g.slug, chapters: todo.map((x) => x.c.key), estimated: results.reduce((a, r) => a + (r.status === "fulfilled" ? r.value : 0), 0),
      left: chapters.length - todo.length, errors: results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason).slice(0, 160)),
    };
  }
  return { note: "every problem has a recent estimate" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    return json(await run(body.slug, !!body.fresh));
  } catch (e) {
    console.error("costs failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
