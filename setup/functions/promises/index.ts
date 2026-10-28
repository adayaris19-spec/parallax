// PARALLAX promises — Supabase Edge Function named `promises`. The promise keeper.
//
// Science is full of IOUs: "we expect this by 2015", "within the next decade".
// Nobody checks them when the date arrives. This function does, one goal per call:
//
//   1. HARVEST (once a month per goal): search research published at least five
//      years ago on every problem in the goal's tree for forward-looking language,
//      and have Claude pull out each dated promise. The code keeps a promise only
//      if its quote appears word for word in the paper's abstract.
//   2. CHECK (every call): for up to 4 promises whose deadline has passed, search
//      what was published since, and have Claude judge it kept, partly kept, broken
//      or unclear. "Kept" needs two independent sources (the parallax rule). A
//      kept, partly kept or broken promise becomes a post in the feed.
//
// Request: POST {} with header x-parallax-admin: <ADMIN_TOKEN>; optionally {"slug": "mars"}.
// Schedule: hourly (see setup/README-feed.md). Secrets: the same as map-goal.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";
const MAIL = Deno.env.get("CONTACT_EMAIL") ?? "";
const OA_KEY = Deno.env.get("OPENALEX_API_KEY") ?? "";
const HARVEST_EVERY_DAYS = 30;
const MIN_AGE_YEARS = 5; // only look for promises in research at least this old
const CHECKS_PER_CALL = 4;

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

// ---------------------------------------------------------------- archive

type Rec = {
  id: string;
  title: string;
  year: number | null;
  venue: string;
  url: string;
  first_author: string;
  abstract: string;
};

function abstractFrom(inv: Record<string, number[]> | null | undefined, max = 2000): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, idx] of Object.entries(inv)) for (const i of idx) words[i] = w;
  return words.filter(Boolean).join(" ").slice(0, max);
}

async function openAlex(q: string, opts: { per: number; from?: string; to?: string }): Promise<Rec[]> {
  const filters = ["has_abstract:true"];
  if (opts.from) filters.push(`from_publication_date:${opts.from}`);
  if (opts.to) filters.push(`to_publication_date:${opts.to}`);
  const params = new URLSearchParams({
    search: q,
    "per-page": String(opts.per),
    filter: filters.join(","),
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

// Forward-looking language with a timeframe. Only abstracts that contain some are
// shown to the model, which keeps the call small and the promises real.
const FUTURE = new RegExp(
  [
    String.raw`\b(by|before|until|in|around|circa) (the year |the end of |the early |the mid-?|the late )?(19|20)\d\d(s)?\b`,
    String.raw`\bwithin (the next |the coming |a |about |roughly )?(\w+[- ])?(years?|decades?)\b`,
    String.raw`\b(next|coming) (few |several |\w+ )?(years|decades?)\b`,
    String.raw`\bin the (near |foreseeable )future\b`,
  ].join("|"),
  "i",
);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
const pub = (r: Rec) => ({ id: r.id, title: r.title, url: r.url, year: r.year, venue: r.venue, first_author: r.first_author });

class Refused extends Error {}
async function ask<T extends z.ZodType>(schema: T, system: string, user: string, effort: "low" | "medium" | "high"): Promise<z.infer<T>> {
  const msg = await claude.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  }).finalMessage().then(track("promises"));
  if (msg.stop_reason === "refusal") throw new Refused(msg.stop_details?.explanation ?? "declined");
  if (msg.stop_reason === "max_tokens") throw new Error("model output was cut off");
  if (msg.parsed_output == null) throw new Error("model returned no structured output");
  return msg.parsed_output as z.infer<T>;
}

const SYSTEM = `You work for Parallax, a public feed of human progress. People follow goals the way they
follow accounts. Write plainly for a curious non-expert. Never invent facts, numbers, papers or people.
Be fair to the researchers: a forecast that was reasonable at the time is not a scandal when it slips.`;

// ---------------------------------------------------------------- harvest

const HarvestSchema = z.object({
  promises: z.array(z.object({
    record_id: z.string(),
    node_key: z.string(),
    quote: z.string(),
    claim: z.string(),
    due_year: z.number(),
  })),
});

// deno-lint-ignore no-explicit-any
type Node = any;
type Goal = { id: number; slug: string; name: string; handle: string };

async function harvest(goal: Goal, leaves: Node[]) {
  const thisYear = new Date().getUTCFullYear();
  const to = `${thisYear - MIN_AGE_YEARS}-12-31`;
  const found = await pool(leaves, 5, (l) => openAlex(l.query || l.title, { per: 10, to }));
  const recs: Record<string, Rec> = {};
  const leafOf: Record<string, string> = {};
  leaves.forEach((l, i) => {
    for (const r of found[i]) {
      if (!FUTURE.test(r.abstract)) continue;
      if (!recs[r.id]) leafOf[r.id] = l.key;
      recs[r.id] = r;
    }
  });
  const pool60 = Object.values(recs).slice(0, 60);
  if (pool60.length === 0) return 0;

  const tree = leaves.map((l) => `${l.key}: ${l.title}`).join("\n");
  const out = await ask(
    HarvestSchema,
    SYSTEM,
    `Goal: ${goal.name} (@${goal.handle})
Problems in this goal's tree:
${tree}

Below are abstracts of older research papers. Find PROMISES: explicit statements that something
will happen, be achieved, become possible or be available within a stated timeframe ("by 2015",
"within ten years", "in the next decade"). Skip vague hopes with no timeframe, statements about
the past, and plans for the paper's own next experiment.

For each promise return:
- record_id: the paper's id in brackets.
- node_key: the problem in the tree it is about (the closest one).
- quote: the sentence containing the promise, copied EXACTLY, character for character, from the
  abstract. Do not fix typos, shorten or paraphrase it. If you cannot copy it exactly, skip it.
- claim: the promise in one plain sentence a teenager would understand, e.g. "Crewed missions
  to Mars would be launched by 2030."
- due_year: the year it was due. For "within N years" add N to the paper's year; for "the next
  decade" add 10; for "by the 2020s" use the end of that decade.
Return at most 8, the clearest and most important ones. Return none if there are none.

${pool60.map((r) => `[${r.id}] (${r.year}) ${r.title}\n${r.abstract}`).join("\n\n")}`,
    "medium",
  );

  const leafKeys = new Set(leaves.map((l) => l.key));
  const rows = [];
  for (const p of out.promises) {
    const r = recs[p.record_id];
    if (!r || !r.year) continue;
    // The quote must appear word for word in the paper: no invented promises.
    if (p.quote.length < 20 || !norm(r.abstract).includes(norm(p.quote))) continue;
    const due = Math.round(p.due_year);
    if (due <= r.year || due > 2100) continue;
    rows.push({
      goal_id: goal.id,
      node_key: leafKeys.has(p.node_key) ? p.node_key : leafOf[r.id] ?? null,
      claim: p.claim,
      quote: p.quote,
      made_year: r.year,
      due_year: due,
      source: pub(r),
    });
  }
  if (rows.length) {
    await db("promises?on_conflict=goal_id,quote", { method: "POST", body: rows, prefer: "resolution=ignore-duplicates,return=minimal" });
  }
  return rows.length;
}

// ---------------------------------------------------------------- fact check
// Before a verdict reaches the feed, a second reader checks what it says happened against the live
// web (a few searches). The verdict partly rests on the model's own knowledge of events after the
// cited papers, so this is the step most likely to catch a wrong date or outcome.
// ok: publish as written · fixed: publish the corrected text · unsure/wrong: hold (status unclear).
const CHECK_MODEL = Deno.env.get("FACTCHECK_MODEL") ?? "claude-sonnet-5-5";
type Check = { result: "ok" | "fixed" | "wrong" | "unsure"; headline?: string; verdict?: string; note?: string };
async function factCheck(headline: string, verdict: string, ctx: string): Promise<Check> {
  const m = await claude.messages.stream({
    model: CHECK_MODEL, max_tokens: 4000,
    tools: [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 4 }],
    system: `You fact-check one short post for Parallax, a public feed about scientific progress. Search the web to confirm what actually happened (dates, outcomes, numbers). Check the main claim first. Do not "fix" wording that is fair; only fix factual errors. Be strict: a wrong year, a wrong outcome, or a claim you cannot confirm is not ok. Mild wording is fine. Today is ${new Date().toISOString().slice(0, 10)}.
Reply with only a JSON object: {"result": "ok" | "fixed" | "wrong" | "unsure", "headline": "...", "verdict": "...", "note": "..."}.
ok: every factual claim is confirmed. fixed: a small factual error you can correct with confidence; give the corrected headline and verdict (same length and style). wrong: the main claim is false. unsure: you could not confirm the main claim. note: one sentence on what you checked.`,
    messages: [{ role: "user", content: `${ctx}\n\nHEADLINE: ${headline}\nPOST: ${verdict}` }],
  // deno-lint-ignore no-explicit-any
  } as any).finalMessage().then(track("promises"));
  // deno-lint-ignore no-explicit-any
  const text = (m.content as any[]).filter((c) => c.type === "text").map((c) => c.text).join("");
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (["ok", "fixed", "wrong", "unsure"].includes(j.result)) return j;
  } catch { /* unreadable */ }
  return { result: "unsure", note: "check unreadable" };
}

// ---------------------------------------------------------------- check

const VerdictSchema = z.object({
  status: z.enum(["kept", "partly", "broken", "unclear"]),
  verdict: z.string(),
  headline: z.string(),
  source_ids: z.array(z.string()),
});

async function check(goal: Goal, leaves: Node[]) {
  const thisYear = new Date().getUTCFullYear();
  const due: Node[] = await db(
    `promises?goal_id=eq.${goal.id}&status=eq.pending&due_year=lte.${thisYear}&select=*&order=due_year.asc&limit=${CHECKS_PER_CALL}`,
  );
  const leafByKey = new Map(leaves.map((l) => [l.key, l]));
  const results = await Promise.all(due.map(async (p): Promise<number> => {
    const since = `${Math.max(p.made_year, p.due_year - 3)}-01-01`;
    const recs = await openAlex(p.claim, { per: 8, from: since });
    const byId = Object.fromEntries(recs.map((r) => [r.id, r]));
    const leaf = leafByKey.get(p.node_key);
    let v;
    try {
      v = await ask(
        VerdictSchema,
        SYSTEM,
        `Goal: ${goal.name} (@${goal.handle})
In ${p.made_year}, a paper ("${p.source.title}") said:
"${p.quote}"
In plain words: ${p.claim} It was due by ${p.due_year}. Today is ${new Date().toISOString().slice(0, 10)}.
${leaf ? `\nWhere this problem stands today, from Parallax's map of the goal: [${leaf.status}] ${leaf.title}. ${leaf.blocker}\n` : ""}
Research published since ${since}:
${recs.map((r) => `[${r.id}] (${r.year}; ${r.first_author || "unknown author"}) ${r.title}\n${r.abstract.slice(0, 900)}`).join("\n\n") || "(none found)"}

Judge whether the promise was kept by its deadline:
- "kept": it happened, roughly as promised, by about the deadline.
- "partly": real progress, but less than promised or clearly later.
- "broken": it has not happened.
- "unclear": the evidence here is not enough to say.
verdict: at most 2 short plain sentences (under 45 words) on what actually happened, fair to the original authors. Write about
the world only: never mention "the papers above", "the list", "these sources" or Parallax's map.
headline: at most 14 words, in the form "In ${p.made_year}, researchers expected ... by ${p.due_year}. ..." ending
with what happened, e.g. "It hasn't happened yet." No clickbait.
source_ids: the ids of the papers above your verdict rests on.`,
        "medium",
      );
    } catch (e) {
      if (e instanceof Refused) {
        await db(`promises?id=eq.${p.id}`, { method: "PATCH", body: { status: "unclear", checked_at: new Date().toISOString() } });
        return 0;
      }
      throw e;
    }
    const ids = v.source_ids.filter((id) => byId[id]);
    const authors = new Set(ids.map((id) => byId[id].first_author.toLowerCase().trim()).filter(Boolean)).size;
    let status: string = v.status;
    // Parallax rule: "kept" needs two independent sources; any verdict needs at least one source
    // unless it rests on the goal's own map of the problem.
    if (status === "kept" && authors < 2) status = ids.length ? "partly" : "unclear";
    if ((status === "partly" || status === "broken") && ids.length === 0 && !leaf) status = "unclear";
    const sources = ids.map((id) => pub(byId[id]));
    await db(`promises?id=eq.${p.id}`, {
      method: "PATCH",
      body: { status, verdict: v.verdict, verdict_sources: sources, independent_sources: authors, checked_at: new Date().toISOString() },
    });
    if (status === "unclear") return 0;
    // Second reader, against the live web.
    let fc: Check;
    try { fc = await factCheck(v.headline, v.verdict, `In ${p.made_year}, a paper ("${p.source.title}") promised: ${p.claim} Due by ${p.due_year}.`); }
    catch { fc = { result: "unsure", note: "check failed" }; }
    if (fc.result === "fixed" && fc.headline && fc.verdict) { v.headline = fc.headline.slice(0, 160); v.verdict = fc.verdict.slice(0, 400); }
    else if (fc.result !== "ok") {
      await db(`promises?id=eq.${p.id}`, { method: "PATCH", body: { status: "unclear", verdict: `Held back by fact check (${fc.result}): ${fc.note ?? ""}`.slice(0, 400) } });
      return 0;
    }
    await db(`promises?id=eq.${p.id}`, { method: "PATCH", body: { verdict: v.verdict } });
    await db("posts", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        goal_id: goal.id,
        node_key: p.node_key,
        kind: "promise",
        headline: v.headline,
        body: v.verdict,
        sources: [p.source, ...sources],
        independent_sources: authors,
        meta: { promise_id: p.id, quote: p.quote, made_year: p.made_year, due_year: p.due_year, status, paper: p.source, fact_check: { result: fc.result, note: fc.note ?? null, at: new Date().toISOString() } },
      },
    });
    return 1;
  }));
  return { checked: due.length, posted: results.reduce((a, b) => a + b, 0) };
}

// ---------------------------------------------------------------- handler

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  try {
    // deno-lint-ignore no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    // One-off: fact-check promise posts already in the feed (up to 6 per call, unchecked first).
    // ok: kept · fixed: text corrected · wrong/unsure: removed from the feed (the promise goes back to unclear).
    if (body.action === "recheck_posts") {
      const posts = (await db(`posts?kind=eq.promise&select=id,headline,body,meta&order=id.asc`)).filter((x: { meta: { fact_check?: unknown } }) => !x.meta?.fact_check).slice(0, 6);
      const out = await Promise.all(posts.map(async (x: { id: number; headline: string; body: string; meta: Record<string, unknown> & { made_year?: number; due_year?: number; quote?: string; promise_id?: number } }) => {
        let fc: Check;
        try { fc = await factCheck(x.headline, x.body, `In ${x.meta.made_year}, a paper promised: "${x.meta.quote ?? ""}" Due by ${x.meta.due_year}.`); } catch { return { id: x.id, result: "error" }; }
        const meta = { ...x.meta, fact_check: { result: fc.result, note: fc.note ?? null, at: new Date().toISOString() } };
        if (fc.result === "ok") await db(`posts?id=eq.${x.id}`, { method: "PATCH", body: { meta } });
        else if (fc.result === "fixed" && fc.headline && fc.verdict) await db(`posts?id=eq.${x.id}`, { method: "PATCH", body: { meta, headline: fc.headline.slice(0, 160), body: fc.verdict.slice(0, 400), plain_headline: null, plain_body: null } });
        else if (!body.dry) {
          await db(`posts?id=eq.${x.id}`, { method: "DELETE" });
          if (x.meta.promise_id) await db(`promises?id=eq.${x.meta.promise_id}`, { method: "PATCH", body: { status: "unclear", verdict: `Removed by fact check (${fc.result}): ${fc.note ?? ""}`.slice(0, 400) } });
        }
        return { id: x.id, result: fc.result, note: fc.note, was: x.headline, now: fc.result === "fixed" ? fc.headline : undefined };
      }));
      return json({ checked: out, left: posts.length < 6 ? 0 : "more" });
    }
    const cols = "id,slug,name,handle,promises_checked_at";
    let goal;
    if (typeof body.slug === "string") {
      goal = (await db(`goals?slug=eq.${encodeURIComponent(body.slug)}&status=eq.ready&select=${cols}`))?.[0];
    } else {
      // Prefer goals with promises now due (so verdicts reach the feed soon), then goals never
      // searched for promises, then the stalest search.
      const stale = new Date(Date.now() - HARVEST_EVERY_DAYS * 864e5).toISOString();
      const thisYear = new Date().getUTCFullYear();
      const duePromise = (await db(`promises?status=eq.pending&due_year=lte.${thisYear}&select=goal_id&order=id.asc&limit=1`))?.[0];
      if (duePromise) goal = (await db(`goals?id=eq.${duePromise.goal_id}&select=${cols}`))?.[0];
      if (!goal) goal = (await db(`goals?status=eq.ready&promises_checked_at=is.null&select=${cols}&order=id.asc&limit=1`))?.[0];
      if (!goal) goal = (await db(`goals?status=eq.ready&promises_checked_at=lt.${stale}&select=${cols}&order=promises_checked_at.asc&limit=1`))?.[0];
    }
    if (!goal) return json({ goal: null });

    const leaves: Node[] = await db(`nodes?goal_id=eq.${goal.id}&parent_key=not.is.null&select=key,title,query,status,blocker&order=position.asc`);
    let harvested = null;
    const due = !goal.promises_checked_at || new Date(goal.promises_checked_at).getTime() < Date.now() - HARVEST_EVERY_DAYS * 864e5;
    if (due || body.harvest) {
      try {
        harvested = await harvest(goal, leaves);
        await db(`goals?id=eq.${goal.id}`, { method: "PATCH", body: { promises_checked_at: new Date().toISOString() } });
      } catch (e) {
        // Try this goal again tomorrow rather than every hour (each try spends archive searches).
        const tomorrow = new Date(Date.now() - (HARVEST_EVERY_DAYS - 1) * 864e5).toISOString();
        await db(`goals?id=eq.${goal.id}`, { method: "PATCH", body: { promises_checked_at: tomorrow } });
        throw e;
      }
    }
    // A call that harvested stops there to stay inside the platform's time limit; the next
    // call checks whatever came due.
    if (harvested !== null) return json({ goal: goal.slug, harvested });
    const checked = await check(goal, leaves);
    return json({ goal: goal.slug, ...checked });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
