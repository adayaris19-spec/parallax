// PARALLAX ideas — Supabase Edge Function named `ideas`. Feeds the Ideas lab.
//
// For a problem, Claude reads its research library (the most relevant papers), the problems it shares
// research with, the cost of its next step, and problems from other goals (ideas often come from
// another field). It proposes concrete ideas, then searches the web for prior art so nothing is sold
// as new that was tried before. A second call structures the ideas. Papers cited are only from the
// library list given; prior-art links are only pages the search returned. People then react on the site.
//
// The research step is slow (deep thinking plus web searches), so it runs as an Anthropic message
// batch: one call submits it, a later call collects the results and structures them. No time limit,
// half price. Runs hourly: collect finished batches, then submit the next goal's problems (up to 4).
//   POST {}  · POST {"slug": "mars"}  that goal · POST {"slug": "mars", "key": "b3.1"}  one problem
// Header x-parallax-admin: <ADMIN_TOKEN>. Secrets: ANTHROPIC_API_KEY, ADMIN_TOKEN, PARALLAX_MODEL.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";
const DAY = 86_400_000;
const PER_BATCH = 4;

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
type Paper = { id: string; title: string; year: number | null; url: string | null };

const Idea = z.object({
  title: z.string().describe("The idea in at most 12 words. Concrete, not a slogan."),
  pitch: z.string().describe("2-3 plain sentences: what to do and what it would change."),
  mechanism: z.string().describe("Why it might work, at most 50 words. Keep correct technical terms, explain uncommon ones."),
  first_test: z.string().describe("The cheapest experiment that would show whether it works, at most 30 words."),
  test_low_usd: z.number().describe("Low end of that test's cost in US dollars."),
  test_high_usd: z.number().describe("High end in US dollars."),
  borrowed_from: z.string().describe("The field, technology or other goal this idea borrows from, at most 10 words. Empty if none."),
  builds_on: z.array(z.number()).describe("Numbers of the library papers (from the PAPERS list) the idea builds on. 1 to 3."),
  novelty: z.enum(["new", "partly", "tried"]).describe("new: no one seems to have tried it. partly: related work exists but not this. tried: it has been done."),
  novelty_note: z.string().describe("What the prior-art search found, at most 35 words."),
  prior_art: z.array(z.number()).describe("Numbers of the SOURCES (search results) that are the closest existing work. Up to 3."),
  risk: z.string().describe("The main reason it could fail, at most 25 words."),
});
const Ideas = z.object({ ideas: z.array(Idea) });

const SYSTEM = "You are an inventive, rigorous research scientist. You propose ideas that experts would find worth testing, you are honest about prior work, and you never invent papers, results or figures.";
function prompt(goal: string, n: Node, papers: Paper[], related: string[], cost: string, elsewhere: string) {
  return `GOAL: ${goal}
PROBLEM: ${n.plain_title || n.title} (status: ${n.status})
Why it matters: ${n.why ?? ""}
What stands in the way: ${n.blocker ?? ""}
${cost ? `Known next step and its cost: ${cost}` : ""}
Problems it shares research with: ${related.join("; ") || "none"}
Problems from other goals (ideas can come from here): ${elsewhere}

PAPERS in this problem's library:
${papers.map((p, i) => `${i}. ${p.title}${p.year ? ` (${p.year})` : ""}`).join("\n")}

Propose 3 ideas that could move this problem forward. Good ideas are specific and testable: a new combination of known things, a method borrowed from another field or goal, an old idea worth reviving with today's tools, or a cheaper way to test something. Avoid ideas that are only "more funding" or "more research".
Before you settle on them, search the web for each idea to see whether it has been tried. Replace any idea that has clearly been done, unless you can name what is still new about yours.
For each final idea write: what to do, why it might work, the cheapest first test and roughly what it costs, what it borrows from, which library papers it builds on (by number), what the search found, and the main risk.`;
}

// Text and the pages the searches returned, from a finished research message.
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

async function structure(notes: string, papers: Paper[], pages: { url: string; title: string }[]) {
  const msg = await claude.beta.messages.stream({
    model: MODEL, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Ideas) },
    messages: [{
      role: "user",
      content: `Turn these notes into the final ideas (up to 3). Keep only what the notes support. Write in plain words anyone can follow, keeping correct technical terms. Never write 'I' or 'author'. In the text, never refer to papers or sources by their numbers; name them in words. If some searches failed, say the check is incomplete.

NOTES:
${notes}

PAPERS (cite by number):
${papers.map((p, i) => `${i}. ${p.title}`).join("\n")}

SOURCES found by the search (cite by number):
${pages.map((p, i) => `${i}. ${p.title} — ${p.url}`).join("\n")}`,
    }],
  }).finalMessage();
  return msg.parsed_output?.ideas ?? [];
}

const usd = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : null);

// Everything the research prompt needs for one problem; the papers are kept for the structuring step.
async function contextFor(g: { id: number; name: string }, n: Node, nodes: Node[], other: string) {
  const [np, links, cost] = await Promise.all([
    db(`node_papers?goal_id=eq.${g.id}&node_key=eq.${encodeURIComponent(n.key)}&select=rank,papers(id,title,year,url)&order=rank.asc&limit=30`),
    db(`node_links?goal_id=eq.${g.id}&or=(a.eq."${n.key}",b.eq."${n.key}")&select=a,b,n&order=n.desc&limit=3`).catch(() => []),
    db(`node_costs?goal_id=eq.${g.id}&node_key=eq.${encodeURIComponent(n.key)}&select=next_step,next_low,next_high`).catch(() => []),
  ]);
  const papers: Paper[] = np.map((x: { papers: Paper }) => x.papers).filter(Boolean);
  const related = links.map((l: { a: string; b: string }) => nodes.find((x) => x.key === (l.a === n.key ? l.b : l.a))).filter(Boolean).map((x: Node) => x.plain_title || x.title);
  const c = cost[0];
  const costTxt = c ? `${c.next_step} ($${Math.round((c.next_low ?? 0) / 1e6)}M-$${Math.round((c.next_high ?? 0) / 1e6)}M)` : "";
  return { papers, text: prompt(g.name, n, papers, related, costTxt, other) };
}

async function save(goalId: number, key: string, notes: string, papers: Paper[], pages: { url: string; title: string }[]) {
  const ideas = await structure(notes, papers, pages);
  const rows = ideas.slice(0, 3).map((i) => {
    let [lo, hi] = [usd(i.test_low_usd), usd(i.test_high_usd)];
    if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
    return {
      goal_id: goalId, node_key: key, title: i.title.trim().slice(0, 140), pitch: i.pitch.trim().slice(0, 600), mechanism: i.mechanism.trim().slice(0, 500) || null,
      first_test: i.first_test.trim().slice(0, 300) || null, test_low: lo, test_high: hi, borrowed_from: i.borrowed_from.trim().slice(0, 120) || null,
      builds_on: [...new Set(i.builds_on)].map((k) => papers[k]).filter(Boolean).slice(0, 3).map((p) => ({ id: p.id, title: p.title, year: p.year, url: p.url })),
      prior_art: [...new Set(i.prior_art)].map((k) => pages[k]).filter(Boolean).slice(0, 3),
      novelty: i.novelty, novelty_note: i.novelty_note.trim().slice(0, 300) || null, risk: i.risk.trim().slice(0, 240) || null,
    };
  });
  if (rows.length) await db("ideas", { method: "POST", prefer: "return=minimal", body: rows });
  return rows.length;
}

// Collect finished batches: structure each problem's research into ideas.
async function collect() {
  const jobs = await db(`idea_jobs?status=eq.pending&select=batch_id,goal_id,keys,context,created_at`);
  const out: { batch: string; ideas: number; errors: string[] }[] = [];
  for (const j of jobs) {
    const b = await claude.messages.batches.retrieve(j.batch_id);
    if (b.processing_status !== "ended") {
      if (Date.now() - new Date(j.created_at).getTime() > 26 * 3600_000) await db(`idea_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed", note: "batch never ended" } });
      continue;
    }
    const work: Promise<number>[] = [], errors: string[] = [];
    for await (const r of await claude.messages.batches.results(j.batch_id)) {
      const key = j.keys[Number(r.custom_id.slice(1))] ?? r.custom_id;
      if (r.result.type !== "succeeded") { errors.push(`${key}: ${r.result.type}`); continue; }
      const { text, pages } = readResearch(r.result.message.content);
      if (!text.trim()) { errors.push(`${key}: no notes`); continue; }
      work.push(save(j.goal_id, key, text, j.context[key] ?? [], pages).catch((e) => { errors.push(`${key}: ${String(e).slice(0, 120)}`); return 0; }));
    }
    const n = (await Promise.all(work)).reduce((a, x) => a + x, 0);
    await db(`idea_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "done", note: errors.join(" | ").slice(0, 500) || null } });
    out.push({ batch: j.batch_id, ideas: n, errors });
  }
  return out;
}

// Problems that most need ideas come first: the bottleneck, then blocked, barely started, moving.
const ORDER: Record<string, number> = { blocked: 1, open: 2, in_progress: 3, solved: 9 };

async function submit(slug?: string, key?: string) {
  const pending = await db(`idea_jobs?status=eq.pending&select=keys,goal_id`);
  if (!slug && pending.length) return { note: "a batch is still running" };
  const busy = new Set(pending.flatMap((p: { goal_id: number; keys: string[] }) => p.keys.map((k) => `${p.goal_id}:${k}`)));
  const goals = await db(`goals?status=eq.ready&select=id,slug,name,bottleneck_key,ideas_at${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=ideas_at.asc.nullsfirst`);
  const all = await db(`nodes?parent_key=not.is.null&select=goal_id,title,plain_title`);
  for (const g of goals) {
    const [nodes, have] = await Promise.all([
      db(`nodes?goal_id=eq.${g.id}&select=key,parent_key,title,plain_title,why,blocker,status&order=position.asc`),
      db(`ideas?goal_id=eq.${g.id}&select=node_key,created_at`),
    ]);
    const recent = new Set(have.filter((h: { created_at: string }) => Date.now() - new Date(h.created_at).getTime() < 60 * DAY).map((h: { node_key: string }) => h.node_key));
    const leaves = (nodes as Node[]).filter((n) => n.parent_key && n.status !== "solved" && !busy.has(`${g.id}:${n.key}`));
    const todo = (key ? leaves.filter((n) => n.key === key) : leaves.filter((n) => !recent.has(n.key)))
      .sort((a, b) => (a.key === g.bottleneck_key ? -1 : b.key === g.bottleneck_key ? 1 : (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5)))
      .slice(0, PER_BATCH);
    if (todo.length < PER_BATCH && !key) await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { ideas_at: new Date().toISOString() } });
    if (!todo.length) continue;
    const other = all.filter((x: { goal_id: number }) => x.goal_id !== g.id).sort(() => Math.random() - 0.5).slice(0, 40).map((x: Node) => x.plain_title || x.title).join("; ");
    const ctx = await Promise.all(todo.map((n) => contextFor(g, n, nodes, other)));
    const batch = await claude.messages.batches.create({
      requests: todo.map((n, i) => ({
        custom_id: `p${i}`, // ids allow only letters, digits, _ and -; maps back to keys[i]
        params: {
          model: MODEL, max_tokens: 64000, output_config: { effort: "high" }, system: SYSTEM,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
          messages: [{ role: "user", content: ctx[i].text }],
        },
      })),
    });
    await db("idea_jobs", { method: "POST", prefer: "return=minimal", body: { batch_id: batch.id, goal_id: g.id, keys: todo.map((n) => n.key), context: Object.fromEntries(todo.map((n, i) => [n.key, ctx[i].papers])) } });
    return { submitted: batch.id, slug: g.slug, problems: todo.map((n) => n.key) };
  }
  return { note: "every problem has recent ideas" };
}

async function run(slug?: string, key?: string) {
  const collected = await collect();
  const submitted = await submit(slug, key);
  return { collected, submitted };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    return json(await run(body.slug, body.key));
  } catch (e) {
    console.error("ideas failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
