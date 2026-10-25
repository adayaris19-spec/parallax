// PARALLAX simplify — Supabase Edge Function named `simplify`.
//
// Writes plain-language versions of a goal's text: a one-line tagline (where things stand), the
// summary, every problem's title, why it matters and what stands in the way, and every post.
// Correct technical terms stay; everything around them gets short and clear. The originals are
// kept; the site shows the plain version when there is one.
//
// Called hourly (one goal per call) with header x-parallax-admin: <ADMIN_TOKEN>.
//   POST {}               the goal that most needs it (never simplified, or new problems or posts)
//   POST {"slug": "mars", "all": true}   redo one goal completely
//
// Secrets: ANTHROPIC_API_KEY, ADMIN_TOKEN, PARALLAX_MODEL.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";

export const PLAIN_STYLE = `How to write:
- Write for a smart, curious 14-year-old who is not an expert.
- Keep the correct technical terms when they matter (for example tokamak, regolith, lithium-6, thermal runaway).
  If a term is not common, add a few plain words that explain it the first time.
- Everything else in everyday words. Short sentences, one idea each.
- Concrete beats vague: numbers, places, things. Cut filler words like "roughly", "precisely", "significantly",
  "various", "robust", "leverage", "facilitate".
- Never add facts, numbers or claims that are not in the original. Keep the meaning exactly.
Example: "Supply power through the roughly two-week lunar night" -> "Keep power on through the 2-week lunar night".`;

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

const Out = z.object({
  tagline: z.string().describe("One or two short sentences, at most 25 words, that tell the story of where this goal stands: what already works and the main thing in the way. No percentages or counts (the page shows those)."),
  summary: z.string().describe("What achieving the goal would mean, at most 25 words."),
  problems: z.array(z.object({
    key: z.string(),
    title: z.string().describe("At most 9 words."),
    why: z.string().describe("Why it matters: one sentence, at most 20 words. Empty if the original is empty."),
    blocker: z.string().describe("What stands in the way (or what was done, if solved): at most 2 sentences, 35 words. Empty if the original is empty."),
  })),
  posts: z.array(z.object({
    id: z.number(),
    headline: z.string().describe("At most 12 words. Keep it a statement of fact."),
    body: z.string().describe("At most 2 sentences, 40 words. Empty if the original is empty."),
  })),
});

// deno-lint-ignore no-explicit-any
async function pickGoal(slug?: string): Promise<any> {
  if (slug) return (await db(`goals?slug=eq.${encodeURIComponent(slug)}&status=eq.ready&select=id,slug,name,summary,progress,horizon_low,horizon_high,bottleneck_key,simplified_at`))[0];
  const goals = await db("goals?status=eq.ready&select=id,slug,name,summary,progress,horizon_low,horizon_high,bottleneck_key,simplified_at&order=simplified_at.asc.nullsfirst");
  const never = goals.find((g: { simplified_at: string | null }) => !g.simplified_at);
  if (never) return never;
  const pending = await db("posts?plain_headline=is.null&kind=neq.mapped&select=goal_id&limit=200");
  const nodesNew = await db("nodes?plain_title=is.null&parent_key=not.is.null&select=goal_id&limit=200");
  const want = new Set([...pending, ...nodesNew].map((r: { goal_id: number }) => r.goal_id));
  return goals.find((g: { id: number }) => want.has(g.id)) ?? null;
}

async function simplify(slug?: string, all = false) {
  const g = await pickGoal(slug);
  if (!g) return { note: "nothing to simplify" };
  const since = all || !g.simplified_at ? null : g.simplified_at;
  const [nodes, posts] = await Promise.all([
    db(`nodes?goal_id=eq.${g.id}&select=key,parent_key,title,why,blocker,status,plain_title,updated_at&order=position.asc`),
    db(`posts?goal_id=eq.${g.id}&kind=neq.mapped&select=id,kind,headline,body,plain_headline&order=created_at.desc&limit=60`),
  ]);
  // deno-lint-ignore no-explicit-any
  const todoNodes = nodes.filter((n: any) => all || !n.plain_title || (since && n.updated_at > since));
  // deno-lint-ignore no-explicit-any
  const todoPosts = posts.filter((p: any) => all || !p.plain_headline);
  const bn = nodes.find((n: { key: string }) => n.key === g.bottleneck_key);
  const solved = nodes.filter((n: { parent_key: string | null; status: string }) => n.parent_key && n.status === "solved").length;
  const leaves = nodes.filter((n: { parent_key: string | null }) => n.parent_key).length;

  const msg = await new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" }).beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Out) },
    system: `You rewrite text for Parallax, a public feed of human progress, so anyone can understand it.\n${PLAIN_STYLE}`,
    messages: [{
      role: "user",
      content: `Goal: ${g.name}
Summary: ${g.summary ?? ""}
Facts for the tagline: ${solved} of ${leaves} problems solved; progress ${Math.round((g.progress ?? 0) * 100)}%; estimate ${g.horizon_low ?? "?"}-${g.horizon_high ?? "?"} years; biggest bottleneck: ${bn ? `${bn.title}. ${bn.blocker ?? ""}` : "none"}

Rewrite these problems (return every key listed, in "problems"):
${todoNodes.map((n: { key: string; title: string; why: string | null; blocker: string | null; status: string | null }) => `[${n.key}] (${n.status ?? "branch"}) TITLE: ${n.title} | WHY: ${n.why ?? ""} | IN THE WAY: ${n.blocker ?? ""}`).join("\n") || "(none)"}

Rewrite these posts (return every id listed, in "posts"):
${todoPosts.map((p: { id: number; kind: string; headline: string; body: string | null }) => `[${p.id}] (${p.kind}) HEADLINE: ${p.headline} | BODY: ${p.body ?? ""}`).join("\n") || "(none)"}`,
    }],
  }).finalMessage().then(track("simplify"));
  if (msg.stop_reason === "refusal" || msg.parsed_output == null) return { slug: g.slug, note: `no rewrite: ${msg.stop_reason}` };
  const out = msg.parsed_output;

  const nodeKeys = new Set(todoNodes.map((n: { key: string }) => n.key));
  const postIds = new Set(todoPosts.map((p: { id: number }) => p.id));
  const cut = (s: string, n: number) => s.trim().slice(0, n) || null;
  let nn = 0, pp = 0;
  for (const p of out.problems) {
    if (!nodeKeys.has(p.key)) continue;
    await db(`nodes?goal_id=eq.${g.id}&key=eq.${encodeURIComponent(p.key)}`, { method: "PATCH", prefer: "return=minimal", body: { plain_title: cut(p.title, 140), plain_why: cut(p.why, 300), plain_blocker: cut(p.blocker, 500) } });
    nn++;
  }
  for (const p of out.posts) {
    if (!postIds.has(p.id)) continue;
    await db(`posts?id=eq.${p.id}`, { method: "PATCH", prefer: "return=minimal", body: { plain_headline: cut(p.headline, 200), plain_body: cut(p.body, 500) } });
    pp++;
  }
  await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { tagline: cut(out.tagline, 300), plain_summary: cut(out.summary, 300), simplified_at: new Date().toISOString() } });
  return { slug: g.slug, problems: nn, posts: pp, tagline: out.tagline };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    return json(await simplify(body.slug, !!body.all));
  } catch (e) {
    console.error("simplify failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
