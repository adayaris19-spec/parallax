// PARALLAX crossovers — Supabase Edge Function named `crossovers`. Finds problems shared by two goals,
// where progress on one moves the other (crossovers table).
//   1. Papers: problem pairs in different goals that cite at least 5 of the same papers (SQL, free).
//      Each problem keeps its 3 strongest partners per other goal.
//   2. Claude (two short calls per goal, titles only, a few cents): checks this goal's paper pairs,
//      writes one sentence on how progress on one helps the other, marks pairs that only share
//      background papers as rejected (kept so the paper scan doesn't re-add them; readers skip them),
//      proposes overlaps papers missed, and a strict second call keeps only real ones (no analogies).
//      POST {"action":"audit"} re-checks every title-found link with that strict call. and adds overlaps papers miss (same technology, component or bottleneck).
// One goal's AI pass per call; goals are re-checked monthly and new goals go first.
// Request: POST {} (header x-parallax-admin: <ADMIN_TOKEN>), or {"slug": "..."} for one goal now.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = "claude-sonnet-5-5";
const DAY = 86_400_000;
const PARTNERS = 3;
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
// deno-lint-ignore no-explicit-any
function track(m: any) {
  const u = m?.usage ?? {}, inp = u.input_tokens ?? 0, out = u.output_tokens ?? 0;
  db("ai_usage", { method: "POST", prefer: "return=minimal", body: { job: "crossovers", model: m?.model ?? MODEL, input_tokens: inp, output_tokens: out, cache_read: 0, cache_write: 0, searches: 0, batch: false, cost_usd: Number(((inp * 2 + out * 10) / 1e6).toFixed(5)) } }).catch(() => {});
  return m;
}
type Pair = { goal_a: number; key_a: string; goal_b: number; key_b: string; shared: number };

// 1. Paper overlaps, strongest partners only.
async function fromPapers() {
  const rows: Pair[] = await db("rpc/parallax_crossover_candidates", { method: "POST", body: { min_shared: 5 } });
  const keep = new Set<string>(), id = (p: Pair) => `${p.goal_a}|${p.key_a}|${p.goal_b}|${p.key_b}`;
  const top = (side: "a" | "b") => {
    const groups = new Map<string, Pair[]>();
    for (const p of rows) { const k = side === "a" ? `${p.goal_a}|${p.key_a}|${p.goal_b}` : `${p.goal_b}|${p.key_b}|${p.goal_a}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
    for (const g of groups.values()) for (const p of g.sort((x, y) => y.shared - x.shared).slice(0, PARTNERS)) keep.add(id(p));
  };
  top("a"); top("b");
  const pairs = rows.filter((p) => keep.has(id(p)));
  const existing: { goal_a: number; key_a: string; goal_b: number; key_b: string; source: string; why: string | null }[] = await db("crossovers?select=goal_a,key_a,goal_b,key_b,source,why&limit=20000");
  const have = new Map(existing.map((e) => [`${e.goal_a}|${e.key_a}|${e.goal_b}|${e.key_b}`, e]));
  const body = pairs.map((p) => { const e = have.get(id(p)); return { goal_a: p.goal_a, key_a: p.key_a, goal_b: p.goal_b, key_b: p.key_b, shared_papers: p.shared, source: e?.source === "ai" ? "both" : e?.source ?? "papers", why: e?.why ?? null, updated_at: new Date().toISOString() }; });
  for (let i = 0; i < body.length; i += 500) await db("crossovers?on_conflict=goal_a,key_a,goal_b,key_b", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: body.slice(i, i + 500) });
  return pairs.length;
}

const Out = z.object({
  checked: z.array(z.object({ id: z.number(), keep: z.boolean(), why: z.string() })),
  added: z.array(z.object({ mine: z.string(), other_goal: z.string(), other_key: z.string(), why: z.string() })),
});

// A strict second look at links found by reading titles (not papers): keeps only real overlaps,
// not analogies ("both avoid pressure" across different physics doesn't count).
const Verdicts = z.object({ verdicts: z.array(z.object({ id: z.number(), keep: z.boolean(), why: z.string() })) });
async function verify(items: { id: number; a: string; b: string; why: string }[]) {
  if (!items.length) return [];
  const msg = await claude.beta.messages.stream({
    model: MODEL, max_tokens: 6000,
    output_config: { effort: "high", format: betaZodOutputFormat(Verdicts) },
    system: "You audit claimed overlaps between problems from different goals for Parallax. Keep a link only if the two problems involve the same physical thing, material, device, measurement, dataset, method, supply chain, institution or rule, so that real progress on one transfers to the other. Reject analogies and shared vocabulary (for example 'pressure' in a superconductor crystal vs. mechanical stack pressure in a battery). When unsure, reject.",
    messages: [{ role: "user", content: items.map((x) => `${x.id}. ${x.a}  <->  ${x.b}\n   claimed: ${x.why}`).join("\n") + "\n\nFor each id: keep true/false; why: if kept, one plain sentence (at most 22 words) on how progress on one helps the other; if rejected, the reason." }],
  }).finalMessage().then(track);
  return (msg.parsed_output as z.infer<typeof Verdicts> | null)?.verdicts ?? [];
}
async function audit() {
  const rows: { goal_a: number; key_a: string; goal_b: number; key_b: string; why: string }[] = await db("crossovers?source=eq.ai&select=goal_a,key_a,goal_b,key_b,why");
  const [goals, nodes] = await Promise.all([db("goals?select=id,handle"), db("nodes?parent_key=not.is.null&select=goal_id,key,title,plain_title&limit=20000")]);
  const label = (gid: number, key: string) => { const n = nodes.find((x: { goal_id: number; key: string }) => x.goal_id === gid && x.key === key); return `@${goals.find((g: { id: number }) => g.id === gid)?.handle}: ${n?.plain_title || n?.title}`; };
  const v = await verify(rows.map((r, i) => ({ id: i, a: label(r.goal_a, r.key_a), b: label(r.goal_b, r.key_b), why: r.why })));
  let rejected = 0;
  for (const x of v) {
    const r = rows[x.id]; if (!r) continue;
    const where = `goal_a=eq.${r.goal_a}&key_a=eq.${encodeURIComponent(r.key_a)}&goal_b=eq.${r.goal_b}&key_b=eq.${encodeURIComponent(r.key_b)}`;
    if (x.keep) await db(`crossovers?${where}`, { method: "PATCH", prefer: "return=minimal", body: { why: x.why.slice(0, 240) } });
    else { rejected++; await db(`crossovers?${where}`, { method: "PATCH", prefer: "return=minimal", body: { source: "rejected", why: x.why.slice(0, 240) } }); }
  }
  return { checked: rows.length, rejected };
}

// 2. One goal's AI pass.
async function withAI(slug?: string) {
  const goals: { id: number; slug: string; handle: string; name: string; crossed_at: string | null }[] = await db("goals?status=eq.ready&select=id,slug,handle,name,crossed_at&order=crossed_at.asc.nullsfirst");
  const g = slug ? goals.find((x) => x.slug === slug) : goals.find((x) => !x.crossed_at || Date.now() - new Date(x.crossed_at).getTime() > 30 * DAY);
  if (!g) return { note: "every goal's crossovers are fresh" };
  const nodes: { goal_id: number; key: string; title: string; plain_title: string | null; status: string }[] = await db("nodes?parent_key=not.is.null&select=goal_id,key,title,plain_title,status&limit=20000");
  const byGoal = new Map(goals.map((x) => [x.id, x]));
  const name = (n: { title: string; plain_title: string | null }) => n.plain_title || n.title;
  const nodeOf = (gid: number, key: string) => nodes.find((n) => n.goal_id === gid && n.key === key);
  const pairs: { goal_a: number; key_a: string; goal_b: number; key_b: string; shared_papers: number; source: string }[] =
    await db(`crossovers?or=(goal_a.eq.${g.id},goal_b.eq.${g.id})&source=neq.rejected&select=goal_a,key_a,goal_b,key_b,shared_papers,source&limit=2000`);
  const mine = nodes.filter((n) => n.goal_id === g.id);
  const others = goals.filter((x) => x.id !== g.id);
  const list = pairs.map((p, i) => {
    const [mg, mk, og, ok] = p.goal_a === g.id ? [p.goal_a, p.key_a, p.goal_b, p.key_b] : [p.goal_b, p.key_b, p.goal_a, p.key_a];
    const a = nodeOf(mg, mk), b = nodeOf(og, ok);
    return a && b ? `${i}. [${mk}] ${name(a)}  <->  @${byGoal.get(og)?.handle} [${ok}] ${name(b)}  (${p.shared_papers} shared papers)` : null;
  }).filter(Boolean);
  const prompt = `Goal: @${g.handle} (${g.name}). Its problems:
${mine.map((n) => `[${n.key}] ${name(n)}`).join("\n")}

Other goals and their problems:
${others.map((o) => `@${o.handle} (${o.name})\n${nodes.filter((n) => n.goal_id === o.id).map((n) => `  [${n.key}] ${name(n)}`).join("\n")}`).join("\n")}

Pairs found because they cite the same research papers:
${list.join("\n") || "(none)"}

Task:
1. checked: for every numbered pair, keep = true only if progress on one would directly move the other (same technology, same component, same measurement or the same practical bottleneck), not just a shared background topic. why: one plain sentence, at most 22 words, saying how progress on one helps the other (for a curious non-expert).
2. added: up to 8 more pairs between @${g.handle}'s problems and other goals' problems that papers missed but that clearly meet the same bar. mine: the @${g.handle} problem key; other_goal: the other goal's handle without @; other_key: its problem key. Prefer non-obvious links. Don't repeat checked pairs. Return none if there are no strong ones.`;
  const msg = await claude.beta.messages.stream({
    model: MODEL, max_tokens: 8000,
    output_config: { effort: "medium", format: betaZodOutputFormat(Out) },
    system: "You map how humanity's big goals overlap for Parallax, a public feed of progress. Be strict: a weak or vague link is worse than none. Never invent problems; use only the keys given.",
    messages: [{ role: "user", content: prompt }],
  }).finalMessage().then(track);
  const out = msg.parsed_output as z.infer<typeof Out> | null;
  if (!out) throw new Error("no structured output");
  let kept = 0, dropped = 0, added = 0;
  for (const c of out.checked) {
    const p = pairs[c.id]; if (!p) continue;
    const where = `goal_a=eq.${p.goal_a}&key_a=eq.${encodeURIComponent(p.key_a)}&goal_b=eq.${p.goal_b}&key_b=eq.${encodeURIComponent(p.key_b)}`;
    if (c.keep) { kept++; await db(`crossovers?${where}`, { method: "PATCH", prefer: "return=minimal", body: { why: c.why.slice(0, 240), updated_at: new Date().toISOString() } }); }
    else { dropped++; await db(`crossovers?${where}`, { method: "PATCH", prefer: "return=minimal", body: { source: "rejected", why: c.why.slice(0, 240) } }); } // kept, so the paper scan doesn't bring it back
  }
  const handleTo = new Map(goals.map((x) => [x.handle.toLowerCase(), x.id]));
  const real = out.added.filter((a) => { const og = handleTo.get(a.other_goal.replace(/^@/, "").toLowerCase()); return og && og !== g.id && nodeOf(g.id, a.mine) && nodeOf(og, a.other_key); }); // only real keys
  const label = (gid: number, key: string) => `@${byGoal.get(gid)?.handle}: ${name(nodeOf(gid, key)!)}`;
  const verdicts = await verify(real.map((a, i) => ({ id: i, a: label(g.id, a.mine), b: label(handleTo.get(a.other_goal.replace(/^@/, "").toLowerCase())!, a.other_key), why: a.why })));
  for (const [i, a] of real.entries()) {
    const v = verdicts.find((x) => x.id === i); if (!v?.keep) continue;
    a.why = v.why;
    const og = handleTo.get(a.other_goal.replace(/^@/, "").toLowerCase())!;
    const [ga, ka, gb, kb] = g.id < og ? [g.id, a.mine, og, a.other_key] : [og, a.other_key, g.id, a.mine];
    await db("crossovers?on_conflict=goal_a,key_a,goal_b,key_b", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { goal_a: ga, key_a: ka, goal_b: gb, key_b: kb, shared_papers: 0, source: "ai", why: a.why.slice(0, 240) } });
    added++;
  }
  await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { crossed_at: new Date().toISOString() } });
  return { slug: g.slug, checked: out.checked.length, kept, dropped, added };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "audit") return json(await audit());
    const papers = await fromPapers();
    return json({ paper_pairs: papers, ai: await withAI(typeof body.slug === "string" ? body.slug : undefined) });
  } catch (e) {
    console.error("crossovers failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 300) : "failed" }, 500);
  }
});
