// PARALLAX challenges — Supabase Edge Function named `challenges` (Verify JWT on, admin header).
//
// Writes challenges: concrete, bounded pieces of a goal's open problems that a skilled person could
// solve from home (public data, code, models, analysis), each with a measurable "done when".
// The point is useful work, not homework: every challenge must say who would use the result and what
// it unblocks, and a second reader throws out anything vague, already done, needing a lab, or fluff.
// Every resource link is opened to check it is real; a challenge with no working resource is dropped.
//
// Hourly: one goal per call (the oldest without challenges). POST {"slug": "fusion"} for one goal now.
// Virus and pathogen problems (nodes.ideas_declined) get no challenges.
// Secrets: ANTHROPIC_API_KEY, ADMIN_TOKEN. Optional: CHALLENGES_MODEL (default Sonnet).

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("CHALLENGES_MODEL") ?? "claude-sonnet-5-5";
const claude = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`database ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const PRICE: Record<string, [number, number]> = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };
// deno-lint-ignore no-explicit-any
function track(m: any) {
  const u = m?.usage ?? {}, [pi, po] = PRICE[String(m?.model ?? "").replace(/-\d{8}$/, "")] ?? PRICE["claude-sonnet-5-5"];
  const cost = ((u.input_tokens ?? 0) * pi + (u.output_tokens ?? 0) * po + (u.cache_read_input_tokens ?? 0) * pi * 0.1 + (u.cache_creation_input_tokens ?? 0) * pi * 1.25) / 1e6;
  db("ai_usage", { method: "POST", prefer: "return=minimal", body: { job: "challenges", model: m?.model ?? null, input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cache_read: 0, cache_write: 0, searches: 0, batch: false, cost_usd: Number(cost.toFixed(5)) } }).catch(() => {});
  return m;
}

const Draft = z.object({
  node_key: z.string().describe("The problem's key, exactly as given"),
  title: z.string().describe("The challenge in at most 12 words, starting with a verb"),
  useful: z.string().describe("1-2 sentences: the open question it answers or the bottleneck it removes, and who would use the result and how. Concrete."),
  task: z.string().describe("2-4 sentences: exactly what to build, measure or find, and from which public inputs"),
  done_when: z.string().describe("The measurable bar, with numbers where possible (accuracy, error, coverage, size), and what must be shared (code, data, write-up)"),
  resources: z.array(z.object({ title: z.string(), url: z.string() })).describe("1-4 real public starting points you are confident exist: datasets, codebases, benchmarks, papers. Exact URLs."),
  skills: z.array(z.string()).describe("1-3 skills, short lowercase words like coding, statistics, machine learning, chemistry, cad, writing"),
  size: z.string().describe("a weekend | 1-2 weeks | a month"),
});
const Drafts = z.object({ challenges: z.array(Draft) });
const Keep = z.object({ keep: z.array(z.object({ i: z.number(), keep: z.boolean(), why: z.string() })) });

const WRITE = `You design challenges for Parallax, which tracks humanity's big goals. A challenge is a piece of a real
problem that one skilled person could finish from home in a weekend to a month, with public data, code, models,
simulation or analysis, and whose result would be genuinely useful to the people working on the goal.

Rules:
- Useful, not homework. The result must answer an open question, fill a real gap (a missing open dataset,
  benchmark, tool, model, replication or comparison) or remove part of a bottleneck. Never "read X", "summarise
  Y", "learn about Z", "write a blog post".
- Doable from home: no lab, no special equipment, no restricted data, no clinical work, nothing involving human
  subjects or dangerous materials. Public datasets, open code and published results only.
- Not already done: the library titles below show existing work; build on them, do not repeat them.
- Measurable: "done when" names a number or a checkable output, and what must be shared.
- Real starting points only: datasets and code you are confident exist, with exact URLs.
- Only where a good challenge exists. Zero for a problem is fine; at most 2 per problem.`;

const CHECK = `You are the last check before these challenges go public on Parallax. Be strict: drop any challenge
that is vague, is busywork or study rather than useful work, needs a lab, equipment, restricted data or human
subjects, has no measurable bar, seems already done, or whose result researchers on this problem would not
actually use. Keep only ones an expert in the field would call worth doing.`;

// A link counts only if it opens (some sites refuse HEAD, so a small GET).
async function alive(url: string) {
  try {
    if (!/^https?:\/\//.test(url)) return false;
    const r = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": "Parallax link check", Range: "bytes=0-2048" }, signal: AbortSignal.timeout(10000) });
    await r.body?.cancel();
    return r.ok || r.status === 206;
  } catch { return false; }
}

type Node = { key: string; parent_key: string | null; title: string; plain_title: string | null; why: string | null; blocker: string | null; plain_blocker: string | null; status: string; ideas_declined: boolean };

async function chapter(g: { id: number; name: string }, ch: Node, probs: Node[]) {
  const libs = await Promise.all(probs.map((p) => db(`node_papers?goal_id=eq.${g.id}&node_key=eq.${encodeURIComponent(p.key)}&select=rank,papers(title,year)&order=rank.asc&limit=12`).catch(() => [])));
  const text = probs.map((p, i) => `[${p.key}] ${p.plain_title || p.title} (status: ${p.status})\n  In the way: ${p.plain_blocker || p.blocker || "?"}\n  Library: ${(libs[i] as { papers: { title: string; year: number } }[]).map((x) => `${x.papers?.title} (${x.papers?.year ?? "?"})`).join("; ") || "none"}`).join("\n\n");
  const msg = await claude.beta.messages.stream({
    model: MODEL, max_tokens: 12000, output_config: { effort: "medium", format: betaZodOutputFormat(Drafts) }, system: WRITE,
    messages: [{ role: "user", content: `GOAL: ${g.name}\nCHAPTER: ${ch.plain_title || ch.title}\n\nPROBLEMS:\n${text}` }],
  }).finalMessage().then(track);
  const drafts: z.infer<typeof Draft>[] = (msg.stop_reason === "refusal" ? null : (msg.parsed_output as z.infer<typeof Drafts> | null)?.challenges) ?? [];
  const keys = new Set(probs.map((p) => p.key));
  const cands = drafts.filter((d) => keys.has(d.node_key) && d.title.trim() && d.done_when.trim());
  if (!cands.length) return [];
  const chk = await claude.beta.messages.stream({
    model: MODEL, max_tokens: 4000, output_config: { effort: "medium", format: betaZodOutputFormat(Keep) }, system: CHECK,
    messages: [{ role: "user", content: `GOAL: ${g.name}\n\n${cands.map((d, i) => `#${i} for [${d.node_key}] ${probs.find((p) => p.key === d.node_key)?.plain_title}\nTitle: ${d.title}\nUseful because: ${d.useful}\nTask: ${d.task}\nDone when: ${d.done_when}\nResources: ${d.resources.map((r) => r.url).join(", ")}`).join("\n\n")}` }],
  }).finalMessage().then(track);
  const keep = new Set(((chk.parsed_output as z.infer<typeof Keep> | null)?.keep ?? []).filter((k) => k.keep).map((k) => k.i));
  const out = [];
  for (const [i, d] of cands.entries()) {
    if (!keep.has(i)) continue;
    const live = [];
    for (const r of d.resources.slice(0, 4)) if (await alive(r.url)) live.push({ title: r.title.slice(0, 200), url: r.url.slice(0, 500) });
    if (!live.length) continue; // no real starting point: not a challenge we can stand behind
    out.push({ goal_id: g.id, node_key: d.node_key, title: d.title.trim().slice(0, 160), useful: d.useful.trim().slice(0, 600), task: d.task.trim().slice(0, 1200), done_when: d.done_when.trim().slice(0, 600), resources: live, skills: d.skills.map((s) => s.toLowerCase().trim()).filter(Boolean).slice(0, 3), size: d.size.slice(0, 40) });
  }
  return out;
}

async function run(slug?: string) {
  const [g] = await db(`goals?status=eq.ready&select=id,slug,name${slug ? `&slug=eq.${encodeURIComponent(slug)}` : "&challenges_at=is.null"}&order=id.asc&limit=1`);
  if (!g) return { note: "every goal has challenges" };
  const nodes: Node[] = await db(`nodes?goal_id=eq.${g.id}&select=key,parent_key,title,plain_title,why,blocker,plain_blocker,status,ideas_declined&order=position.asc`);
  const chapters = nodes.filter((n) => !n.parent_key).map((c) => ({ c, probs: nodes.filter((n) => n.parent_key === c.key && n.status !== "solved" && !n.ideas_declined) })).filter((x) => x.probs.length);
  const errors: string[] = [];
  const made = (await Promise.all(chapters.map((x) => chapter(g, x.c, x.probs).catch((e) => { errors.push(String(e).slice(0, 120)); return []; })))).flat();
  if (slug) await db(`challenges?goal_id=eq.${g.id}&status=eq.open`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
  if (made.length) await db("challenges", { method: "POST", prefer: "return=minimal", body: made });
  // Mark done unless every chapter failed (then the next run tries again).
  // (A goal with nothing eligible, like an all-virus goal, is done too, so it never blocks the queue.)
  if (made.length || !chapters.length || errors.length < chapters.length) await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { challenges_at: new Date().toISOString() } });
  return { slug: g.slug, chapters: chapters.length, challenges: made.length, titles: made.map((m) => `${m.node_key}: ${m.title}`), errors };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try { return json(await run(typeof body.slug === "string" ? body.slug : undefined)); }
  catch (e) { console.error("challenges failed:", e instanceof Error ? e.message : e); return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500); }
});
