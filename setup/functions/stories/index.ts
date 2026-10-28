// PARALLAX stories — Supabase Edge Function named `stories` (Verify JWT on, admin header).
//
// The story circles at the top of the feed: a fresh 3-4 slide story per goal every day, different
// from the goal's Watch videos. Each day picks a rotating handful of real material for the goal (this
// week's posts, a grant or trial, a problem's why, an idea to test, a challenge, a promise coming due)
// and Sonnet writes short, surprising slides from it. Only facts given; nothing invented. The site
// puts the goal's own clips behind the slides, rotating them by day.
//
// Hourly: up to 6 goals that don't have today's story yet. POST {"slug": "fusion"} for one goal now.
// Secrets: ANTHROPIC_API_KEY, ADMIN_TOKEN. Optional: STORIES_MODEL (default Sonnet).

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("STORIES_MODEL") ?? "claude-sonnet-5-5";
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
  const cost = ((u.input_tokens ?? 0) * pi + (u.output_tokens ?? 0) * po) / 1e6;
  db("ai_usage", { method: "POST", prefer: "return=minimal", body: { job: "stories", model: m?.model ?? null, input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cache_read: 0, cache_write: 0, searches: 0, batch: false, cost_usd: Number(cost.toFixed(5)) } }).catch(() => {});
  return m;
}

const Slide = z.object({
  kicker: z.enum(["Did you know", "This week", "The number", "Who's on it", "Try this", "What's next", "Myth vs fact", "The catch"]),
  caption: z.string().describe("At most 10 words. Big text. One surprising, concrete point."),
  sub: z.string().describe("At most 22 words that make the caption land. Empty if not needed."),
  stat_value: z.string().describe("A striking number from the facts, like 47% or $6.3M, at most 6 characters. Never a year. Empty if none."),
  stat_label: z.string().describe("What the number means, at most 6 words. Empty if no number."),
});
const Story = z.object({ title: z.string().describe("At most 7 words"), slides: z.array(Slide).describe("3 or 4 slides") });

// A simple seeded shuffle, so each day (and each goal) gets a different handful of material.
function pick<T>(arr: T[], n: number, seed: number): T[] {
  const a = [...arr]; let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
const money = (n: number) => n >= 1e9 ? `$${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

async function write(g: { id: number; slug: string; name: string; handle: string; tagline: string | null }, day: string) {
  const seed = [...`${g.slug}${day}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [posts, nodes, evid, ideas, chals, proms, yesterday] = await Promise.all([
    db(`posts?goal_id=eq.${g.id}&kind=neq.mapped&created_at=gte.${weekAgo}&select=kind,headline,plain_headline,body,plain_body&order=created_at.desc&limit=8`).catch(() => []),
    db(`nodes?goal_id=eq.${g.id}&parent_key=not.is.null&select=title,plain_title,status,plain_why,why,plain_blocker,blocker`).catch(() => []),
    db(`node_evidence?goal_id=eq.${g.id}&select=source,top&limit=12`).catch(() => []),
    db(`ideas?goal_id=eq.${g.id}&status=eq.open&select=title,pitch,test_low,test_high,borrowed_from&limit=30`).catch(() => []),
    db(`challenges?goal_id=eq.${g.id}&status=eq.open&select=title,useful&limit=20`).catch(() => []),
    db(`promises?goal_id=eq.${g.id}&select=claim,status,made_year,due_year,verdict&limit=30`).catch(() => []),
    db(`daily_stories?goal_id=eq.${g.id}&order=day.desc&limit=3&select=slides`).catch(() => []),
  ]);
  // deno-lint-ignore no-explicit-any
  const t = (x: any, a: string, b: string) => x[`plain_${a}`] || x[b] || x[a] || "";
  // deno-lint-ignore no-explicit-any
  const grants = (evid as any[]).flatMap((e) => (e.top || []).map((x: any) => ({ ...x, source: e.source })));
  const lines: string[] = [];
  // deno-lint-ignore no-explicit-any
  for (const p of pick(posts as any[], 2, seed)) lines.push(`- News this week (${p.kind}): ${t(p, "headline", "headline")}. ${String(t(p, "body", "body")).split(/(?<=\.)\s/).slice(0, 2).join(" ")}`);
  // deno-lint-ignore no-explicit-any
  for (const n of pick(nodes as any[], 3, seed + 1)) lines.push(`- A problem in the way: ${t(n, "title", "title")} (${n.status}). Why it matters: ${t(n, "why", "why")} What blocks it: ${t(n, "blocker", "blocker")}`);
  // deno-lint-ignore no-explicit-any
  for (const x of pick(grants as any[], 2, seed + 2)) lines.push(x.source === "grants" ? `- Funded: ${x.who} works on "${x.title}"${x.amount ? ` (${money(x.amount)})` : ""}` : `- Being tested: ${x.who} runs "${x.title}"${x.phase ? ` (${x.phase})` : ""}`);
  // deno-lint-ignore no-explicit-any
  for (const i of pick(ideas as any[], 1, seed + 3)) lines.push(`- An idea anyone could test: ${i.title}. ${String(i.pitch).split(/(?<=\.)\s/)[0]}${i.test_high ? ` First test about ${money(i.test_low ?? 0)}-${money(i.test_high)}.` : ""}${i.borrowed_from ? ` Borrowed from ${i.borrowed_from}.` : ""}`);
  // deno-lint-ignore no-explicit-any
  for (const c of pick(chals as any[], 1, seed + 4)) lines.push(`- A challenge someone could solve from home: ${c.title}. ${String(c.useful).split(/(?<=\.)\s/)[0]}`);
  // deno-lint-ignore no-explicit-any
  for (const p of pick((proms as any[]).filter((x) => x.made_year), 1, seed + 5)) lines.push(`- A promise from ${p.made_year}, due ${p.due_year}: "${p.claim}" Status: ${p.status}.${p.verdict ? ` ${p.verdict}` : ""}`);
  if (lines.length < 3) return null;
  // deno-lint-ignore no-explicit-any
  const recent = (yesterday as any[]).flatMap((s) => (s.slides || []).map((x: { caption: string }) => x.caption)).slice(0, 12);
  const m = await claude.beta.messages.stream({
    model: MODEL, max_tokens: 4000, output_config: { effort: "low", format: betaZodOutputFormat(Story) },
    system: `You write today's story for one goal on Parallax, a feed that follows humanity's biggest goals. It shows as 3-4 tap-through slides over video, like Instagram stories. It should make a curious person stop and learn something they didn't know.
Use ONLY the material given; never invent numbers, names, dates or events. Plain words; explain any technical term in a few words.
- Slide 1 is the most surprising single fact in the material, said in a way that makes people tap on.
- Each slide is one idea. Mix kinds: a number, a person or team, a catch, something to try.
- Short, spoken, concrete. No hype words (revolutionary, game-changer, unlock, journey, imagine).
- Don't repeat these recent captions or their facts: ${recent.join(" | ") || "none"}.`,
    messages: [{ role: "user", content: `GOAL: ${g.name} (@${g.handle}). ${g.tagline ?? ""}\nTODAY'S MATERIAL:\n${lines.join("\n")}` }],
  }).finalMessage().then(track);
  const story = m.parsed_output as z.infer<typeof Story> | null;
  if (!story?.slides?.length) return null;
  const slides = story.slides.slice(0, 4).map((s) => ({ kicker: s.kicker, caption: s.caption.trim().slice(0, 110), sub: s.sub.trim().slice(0, 200) || null, stat: s.stat_value.trim() ? { value: s.stat_value.trim().slice(0, 16), label: s.stat_label.trim().slice(0, 60) } : null }));
  await db("daily_stories?on_conflict=goal_id,day", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { goal_id: g.id, day, title: story.title.slice(0, 80), slides } });
  return { slug: g.slug, title: story.title, slides: slides.map((s: { caption: string }) => s.caption) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    const day = new Date().toISOString().slice(0, 10);
    const goals = await db(`goals?status=eq.ready&select=id,slug,name,handle,tagline${typeof body.slug === "string" ? `&slug=eq.${encodeURIComponent(body.slug)}` : ""}`);
    const done = new Set(((await db(`daily_stories?day=eq.${day}&select=goal_id`)) as { goal_id: number }[]).map((x) => x.goal_id));
    const todo = (goals as { id: number }[]).filter((g) => typeof body.slug === "string" || !done.has(g.id)).slice(0, 6);
    const out = [];
    for (const g of todo) { try { out.push(await write(g as never, day)); } catch (e) { out.push({ id: g.id, error: e instanceof Error ? e.message.slice(0, 120) : String(e) }); } }
    return json({ day, made: out, left: goals.length - done.size - todo.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
