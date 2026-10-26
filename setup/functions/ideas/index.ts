// PARALLAX ideas — Supabase Edge Function named `ideas`. Feeds the Ideas lab.
//
// For a problem, Claude reads its research library (the most relevant papers), the problems it shares
// research with, the cost of its next step, and problems from other goals (ideas often come from
// another field), and proposes 3 concrete, testable ideas, each with a precise literature search.
// The code then runs those searches in OpenAlex (250M+ scholarly works, free), and a short second
// call judges each idea's novelty against the papers found. Papers cited are only from the library
// or from those search results. People then react on the site.
//
// Cost: proposing runs as an Anthropic message batch (half price, no time limit); prior-art checks
// read short abstracts instead of whole web pages. One call submits, a later call collects.
// Ideas come automatically for each goal's 6 most important problems (refreshed every 120 days);
// any other problem gets ideas when someone asks for them on the site (idea_requests), first in line.
//   POST {}  · POST {"slug": "mars"}  that goal · POST {"slug": "mars", "key": "b3.1"}  one problem
// Header x-parallax-admin: <ADMIN_TOKEN>. Secrets: ANTHROPIC_API_KEY, ADMIN_TOKEN, PARALLAX_MODEL,
// CONTACT_EMAIL, OPENALEX_API_KEY.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";
const MAIL = Deno.env.get("CONTACT_EMAIL") ?? "";
const OA_KEY = Deno.env.get("OPENALEX_API_KEY") ?? "";
const DAY = 86_400_000;
const PER_BATCH = 4;
const AUTO_PER_GOAL = 6; // problems per goal that get ideas automatically; others when someone asks

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
type Paper = { id: string; title: string; year: number | null; url: string | null };

const Draft = z.object({
  title: z.string().describe("The idea in at most 12 words. Concrete, not a slogan."),
  pitch: z.string().describe("2-3 plain sentences: what to do and what it would change."),
  mechanism: z.string().describe("Why it might work, at most 50 words. Keep correct technical terms, explain uncommon ones."),
  first_test: z.string().describe("The cheapest experiment that would show whether it works, at most 30 words."),
  test_low_usd: z.number().describe("Low end of that test's cost in US dollars."),
  test_high_usd: z.number().describe("High end in US dollars."),
  borrowed_from: z.string().describe("The field, technology or other goal this idea borrows from, at most 10 words. Empty if none."),
  builds_on: z.array(z.number()).describe("Numbers of the library papers (from the PAPERS list) the idea builds on. 1 to 3."),
  risk: z.string().describe("The main reason it could fail, at most 25 words."),
  search_query: z.string().describe("3 to 8 keywords to search the scientific literature for anyone who already tried this exact idea."),
});
const Drafts = z.object({ ideas: z.array(Draft) });
const DRAFT_FMT = betaZodOutputFormat(Drafts);
const Verdicts = z.object({ items: z.array(z.object({
  idea: z.number().describe("The idea's number."),
  novelty: z.enum(["new", "partly", "tried"]).describe("new: none of the papers does this. partly: related work, but not this. tried: a paper already did it."),
  novelty_note: z.string().describe("What the closest papers did, in plain words, at most 35 words. Name them in words, never by number."),
  prior_art: z.array(z.number()).describe("Numbers of the closest papers from this idea's list. Up to 3."),
})) });

type Work = { id: string; title: string; year: number | null; url: string; abstract: string };
function abstractFrom(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, idx] of Object.entries(inv)) for (const i of idx) words[i] = w;
  return words.filter(Boolean).join(" ").slice(0, 450);
}
// Prior-art search in OpenAlex: the most relevant works with abstracts.
async function openAlex(q: string): Promise<Work[]> {
  const params = new URLSearchParams({ search: q, "per-page": "8", filter: "has_abstract:true,type:article|review|preprint", select: "id,doi,title,publication_year,primary_location,abstract_inverted_index" });
  if (MAIL) params.set("mailto", MAIL);
  if (OA_KEY) params.set("api_key", OA_KEY);
  try {
    const r = await fetch(`https://api.openalex.org/works?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    // deno-lint-ignore no-explicit-any
    return ((await r.json()).results ?? []).map((w: any) => ({
      id: String(w.id ?? "").split("/").pop() ?? "", title: String(w.title ?? "").slice(0, 250), year: w.publication_year ?? null,
      url: w.doi ?? w.primary_location?.landing_page_url ?? String(w.id ?? ""), abstract: abstractFrom(w.abstract_inverted_index),
    })).filter((x: Work) => x.id && x.title);
  } catch { return []; }
}

const SYSTEM = "You are an inventive, rigorous research scientist. You propose ideas that experts would find worth testing, and you never invent papers, results or figures.";
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
Prefer ideas you do not recognise from the literature; each will be checked against published work afterwards, so give a precise search for it.
Write in plain words anyone can follow, keeping correct technical terms. In the text, never refer to papers by their numbers. Never write "I" or "author".`;
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

// Check each drafted idea against the literature, then save the ideas.
async function save(goalId: number, key: string, drafts: z.infer<typeof Draft>[], papers: Paper[]) {
  const found = await Promise.all(drafts.map((d) => openAlex(d.search_query)));
  let verdicts: z.infer<typeof Verdicts>["items"] = [];
  try {
    const msg = await claude.beta.messages.stream({
      model: MODEL, max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(Verdicts) },
      messages: [{ role: "user", content: `For each idea, judge whether the papers found already did it. Be strict: "tried" only if a paper really did this idea; "new" only if none comes close.\n\n${drafts.map((d, i) => `IDEA ${i}: ${d.title}. ${d.pitch}\nPapers found:\n${found[i].map((w, k) => `  ${k}. ${w.title} (${w.year ?? "n.d."}): ${w.abstract}`).join("\n") || "  none"}`).join("\n\n")}` }],
    }).finalMessage().then(track("ideas"));
    verdicts = msg.parsed_output?.items ?? [];
  } catch { /* save without a novelty verdict rather than lose the ideas */ }
  const rows = drafts.slice(0, 3).map((d, i) => {
    let [lo, hi] = [usd(d.test_low_usd), usd(d.test_high_usd)];
    if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
    const v = verdicts.find((x) => x.idea === i);
    return {
      goal_id: goalId, node_key: key, title: d.title.trim().slice(0, 140), pitch: d.pitch.trim().slice(0, 600), mechanism: d.mechanism.trim().slice(0, 500) || null,
      first_test: d.first_test.trim().slice(0, 300) || null, test_low: lo, test_high: hi, borrowed_from: d.borrowed_from.trim().slice(0, 120) || null,
      builds_on: [...new Set(d.builds_on)].map((k) => papers[k]).filter(Boolean).slice(0, 3).map((p) => ({ id: p.id, title: p.title, year: p.year, url: p.url })),
      prior_art: [...new Set(v?.prior_art ?? [])].map((k) => found[i][k]).filter(Boolean).slice(0, 3).map((w) => ({ title: `${w.title}${w.year ? ` (${w.year})` : ""}`, url: w.url })),
      novelty: v?.novelty ?? null, novelty_note: v?.novelty_note.trim().slice(0, 300) || (v ? null : "Not checked yet."), risk: d.risk.trim().slice(0, 240) || null,
    };
  });
  if (rows.length) {
    await db("ideas", { method: "POST", prefer: "return=minimal", body: rows });
    await db(`idea_requests?goal_id=eq.${goalId}&node_key=eq.${encodeURIComponent(key)}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
  }
  return rows.length;
}

// Collect finished batches: structure each problem's research into ideas.
// OpenAlex's free daily allowance ($1, resets midnight UTC). Judging ideas without the prior-art
// search would make them look newer than they are, so collecting waits until there is allowance.
async function oaRemaining(): Promise<number> {
  try {
    const r = await fetch(`https://api.openalex.org/rate-limit${OA_KEY ? `?api_key=${OA_KEY}` : ""}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    return Number(d.rate_limit?.daily_remaining_usd ?? 1) + Number(d.rate_limit?.prepaid_remaining_usd ?? 0);
  } catch { return 1; }
}

async function collect() {
  const jobs = await db(`idea_jobs?status=eq.pending&select=batch_id,goal_id,keys,context,created_at`);
  if (jobs.length && (await oaRemaining()) < 0.05) return [{ batch: "-", ideas: 0, errors: ["waiting for OpenAlex's daily allowance to reset"] }];
  const out: { batch: string; ideas: number; errors: string[] }[] = [];
  for (const j of jobs) {
    const b = await claude.messages.batches.retrieve(j.batch_id);
    if (b.processing_status !== "ended") {
      // Stuck: nothing finished after 4 hours (Anthropic sometimes leaves a batch queued), or never
      // ended. Cancel it (unfinished requests aren't billed) so the next run submits it again.
      const age = Date.now() - new Date(j.created_at).getTime();
      if ((age > 4 * 3600_000 && (b.request_counts?.succeeded ?? 0) === 0) || age > 26 * 3600_000) {
        if (b.processing_status === "in_progress") await claude.messages.batches.cancel(j.batch_id).catch(() => {});
        await db(`idea_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed" } });
      }
      continue;
    }
    const work: Promise<number>[] = [], errors: string[] = [];
    for await (const r of await claude.messages.batches.results(j.batch_id)) {
      const key = j.keys[Number(r.custom_id.slice(1))] ?? r.custom_id;
      if (r.result.type !== "succeeded") { errors.push(`${key}: ${r.result.type}`); continue; }
      track("ideas", true)(r.result.message);
      let drafts: z.infer<typeof Draft>[] = [];
      try { drafts = DRAFT_FMT.parse(r.result.message.content.map((c) => (c.type === "text" ? c.text : "")).join("")).ideas; } catch { /* unreadable */ }
      if (!drafts.length) { errors.push(`${key}: no ideas`); continue; }
      work.push(save(j.goal_id, key, drafts, j.context[key] ?? []).catch((e) => { errors.push(`${key}: ${String(e).slice(0, 120)}`); return 0; }));
    }
    const n = (await Promise.all(work)).reduce((a, x) => a + x, 0);
    await db(`idea_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "done", note: errors.join(" | ").slice(0, 500) || null } });
    out.push({ batch: j.batch_id, ideas: n, errors });
  }
  return out;
}

// Problems that most need ideas come first: the bottleneck, then blocked, barely started, moving.
const ORDER: Record<string, number> = { blocked: 1, open: 2, in_progress: 3, solved: 9 };

// Attention: followers and recent visits (goal_attention). Goals nobody follows or visited in the
// last 30 days get no expensive extras until someone does; the most-watched go first.
async function attention(): Promise<Map<number, number>> {
  const rows = await db(`goal_attention?select=goal_id,score`).catch(() => []);
  return new Map(rows.map((r: { goal_id: number; score: number }) => [r.goal_id, r.score]));
}

async function submit(slug?: string, key?: string) {
  const pending = await db(`idea_jobs?status=eq.pending&select=keys,goal_id`);
  // A slow batch must not hold up every other goal: up to 3 run at once, one per goal.
  if (!slug && pending.length >= 3) return { note: "3 batches are still running" };
  const busy = new Set(pending.flatMap((p: { goal_id: number; keys: string[] }) => p.keys.map((k) => `${p.goal_id}:${k}`)));
  const requests = await db(`idea_requests?select=goal_id,node_key`).catch(() => []);
  const goals = await db(`goals?status=eq.ready&select=id,slug,name,bottleneck_key,ideas_at${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=ideas_at.asc.nullsfirst`);
  const all = await db(`nodes?parent_key=not.is.null&select=goal_id,title,plain_title`);
  const wanted = new Set(requests.map((r: { goal_id: number }) => r.goal_id));
  const att = await attention();
  // Asked-for problems first, then goals people follow or visit. Every goal gets its first ideas;
  // only watched goals get refreshed.
  const withIdeas = new Map<number, Set<string>>();
  for (const r of await db(`ideas?select=goal_id,node_key`)) (withIdeas.get(r.goal_id) ?? withIdeas.set(r.goal_id, new Set()).get(r.goal_id)!).add(r.node_key);
  const watched = (g: { id: number }) => !!slug || (att.get(g.id) ?? 0) > 0;
  const goalsInScope = slug ? goals : goals.filter((g: { id: number }) => wanted.has(g.id) || watched(g) || (withIdeas.get(g.id)?.size ?? 0) < AUTO_PER_GOAL);
  goalsInScope.sort((a: { id: number }, b: { id: number }) => Number(wanted.has(b.id)) - Number(wanted.has(a.id)) || (att.get(b.id) ?? 0) - (att.get(a.id) ?? 0));
  for (const g of goalsInScope) {
    const [nodes, have] = await Promise.all([
      db(`nodes?goal_id=eq.${g.id}&select=key,parent_key,title,plain_title,why,blocker,status&order=position.asc`),
      db(`ideas?goal_id=eq.${g.id}&select=node_key,created_at`),
    ]);
    const recent = new Set(have.filter((h: { created_at: string }) => Date.now() - new Date(h.created_at).getTime() < 120 * DAY).map((h: { node_key: string }) => h.node_key));
    const covered = new Set(have.map((h: { node_key: string }) => h.node_key));
    const asked = new Set(requests.filter((r: { goal_id: number }) => r.goal_id === g.id).map((r: { node_key: string }) => r.node_key));
    const leaves = (nodes as Node[]).filter((n) => n.parent_key && n.status !== "solved" && !busy.has(`${g.id}:${n.key}`));
    const ranked = leaves.sort((a, b) => (a.key === g.bottleneck_key ? -1 : b.key === g.bottleneck_key ? 1 : (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5)));
    // Someone asked first; then the goal's most important problems, up to AUTO_PER_GOAL of them.
    const room = Math.max(0, AUTO_PER_GOAL - covered.size);
    const todo = key ? leaves.filter((n) => n.key === key) : [
      ...ranked.filter((n) => asked.has(n.key) && !recent.has(n.key)),
      ...ranked.filter((n) => !asked.has(n.key) && !covered.has(n.key)).slice(0, room),
      ...(watched(g) ? ranked.filter((n) => covered.has(n.key) && !recent.has(n.key) && !asked.has(n.key)) : []), // refresh after 120 days
    ].slice(0, PER_BATCH);
    if (todo.length < PER_BATCH && !key) await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { ideas_at: new Date().toISOString() } });
    if (!todo.length) continue;
    const other = all.filter((x: { goal_id: number }) => x.goal_id !== g.id).sort(() => Math.random() - 0.5).slice(0, 40).map((x: Node) => x.plain_title || x.title).join("; ");
    const ctx = await Promise.all(todo.map((n) => contextFor(g, n, nodes, other)));
    const batch = await claude.messages.batches.create({
      requests: todo.map((n, i) => ({
        custom_id: `p${i}`, // ids allow only letters, digits, _ and -; maps back to keys[i]
        params: {
          model: MODEL, max_tokens: 64000, system: SYSTEM,
          output_config: { effort: "high", format: { type: "json_schema", schema: DRAFT_FMT.schema } },
          messages: [{ role: "user", content: ctx[i].text }],
        },
      })),
    });
    await db("idea_jobs", { method: "POST", prefer: "return=minimal", body: { batch_id: batch.id, goal_id: g.id, keys: todo.map((n) => n.key), context: Object.fromEntries(todo.map((n, i) => [n.key, ctx[i].papers])) } });
    return { submitted: batch.id, slug: g.slug, problems: todo.map((n) => n.key) };
  }
  return { note: "every problem has recent ideas" };
}

async function run(slug?: string, key?: string, collectOnly = false) {
  const collected = await collect();
  const submitted = collectOnly ? null : await submit(slug, key);
  return { collected, submitted };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "batch_status") {
      const jobs = await db(`idea_jobs?status=eq.pending&select=batch_id,goal_id,created_at`);
      return json(await Promise.all(jobs.map(async (j: { batch_id: string; goal_id: number; created_at: string }) => { const b = await claude.messages.batches.retrieve(j.batch_id); return { goal_id: j.goal_id, created_at: j.created_at, status: b.processing_status, counts: b.request_counts }; })));
    }
    return json(await run(body.slug, body.key, body.collect_only === true));
  } catch (e) {
    console.error("ideas failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
