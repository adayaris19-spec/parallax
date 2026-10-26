// PARALLAX intel — Supabase Edge Function named `intel`. Feeds the Parallax Terminal.
//
// Two jobs, both called on a schedule with header x-parallax-admin: <ADMIN_TOKEN>:
//
//   POST {}                    Field intelligence for the one goal checked longest ago:
//   POST {"slug": "mars"}      how much research the whole field publishes each year, and which
//                              institutions and countries publish the most in the last 3 years
//                              (OpenAlex, 3 searches per goal). Refreshed weekly.
//
//   POST {"action": "brief"}   The weekly analyst brief: Claude reads the week's signals across
//                              every goal and writes what moved, what to watch, and where money
//                              would matter most. Stored in `briefs`.
//
// Secrets: the same as pulse (ANTHROPIC_API_KEY, ADMIN_TOKEN, PARALLAX_MODEL, CONTACT_EMAIL, OPENALEX_API_KEY).

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
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`database ${r.status} on ${path.split("?")[0]}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

type Group = { key: string; name: string; count: number };
let oaError = "";

// One OpenAlex group_by: counts of works matching the search, grouped by a field.
async function groupBy(search: string, field: string, from: string, to: string): Promise<Group[] | null> {
  // Articles and reviews only: repositories sometimes bulk-upload datasets that swamp the counts.
  const params = new URLSearchParams({ search, filter: `from_publication_date:${from},to_publication_date:${to},type:article|review`, group_by: field, per_page: "200" });
  if (MAIL) params.set("mailto", MAIL);
  if (OA_KEY) params.set("api_key", OA_KEY);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(`https://api.openalex.org/works?${params}`, { signal: ctl.signal });
    if (!r.ok) { oaError = `OpenAlex ${r.status}: ${(await r.text()).slice(0, 160)}`; return null; }
    const d = await r.json();
    // deno-lint-ignore no-explicit-any
    return (d.group_by ?? []).map((g: any) => ({ key: String(g.key ?? "").split("/").pop() ?? "", name: String(g.key_display_name ?? ""), count: g.count ?? 0 }))
      .filter((g: Group) => g.name && g.name !== "unknown");
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// A focused OpenAlex search for the goal's whole field. The goal's own words ("Humans living on
// Mars") also match unrelated medical papers, so Claude writes a boolean query from the goal's tree.
async function fieldQuery(goal: { id: number; name: string; requested_as: string | null }): Promise<string> {
  const leaves = await db(`nodes?goal_id=eq.${goal.id}&query=not.is.null&select=title,query&limit=40`);
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) try {
    const msg = await new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" }).beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(z.object({ query: z.string() })) },
      messages: [{ role: "user", content: `Write one OpenAlex full-text search query that finds research papers about this goal's field and excludes
unrelated fields. Use OpenAlex boolean syntax: uppercase AND, OR, NOT, double-quoted phrases, parentheses. Use AT MOST 4 boolean
operators in total (OpenAlex rejects more), for example: (Mars OR Martian) AND ("human mission" OR habitat). Prefer quoted phrases.
Aim for a few thousand papers a year: specific enough that, for example, a Mars goal does not match general human medicine.

Goal: ${goal.name}
Problems in its tree: ${leaves.map((l: { title: string }) => l.title).join("; ").slice(0, 2500)}${feedback}` }],
    }).finalMessage().then(track("intel"));
    const q = msg.parsed_output?.query?.trim();
    const ops = (q?.match(/\b(AND|OR|NOT)\b/g) ?? []).length;
    if (q && q.length <= 300 && ops <= 4) return q;
    feedback = `\n\nYour last query, ${q}, used ${ops} operators. Use 4 or fewer.`;
  } catch { break; /* fall back to the goal's own words */ }
  return String(goal.requested_as || goal.name);
}

async function goalIntel(slug?: string) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,name,requested_as${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}`);
  if (!goals.length) return { note: "no goals" };
  const known = new Map<number, string>((await db("goal_intel?select=goal_id,updated_at")).map((r: { goal_id: number; updated_at: string }) => [r.goal_id, r.updated_at]));
  const pick = slug ? goals[0] : goals
    .filter((g: { id: number }) => !known.has(g.id) || Date.now() - new Date(known.get(g.id)!).getTime() > 7 * DAY)
    .sort((a: { id: number }, b: { id: number }) => (known.get(a.id) ?? "").localeCompare(known.get(b.id) ?? ""))[0];
  if (!pick) return { note: "all goals fresh" };

  const prev = (await db(`goal_intel?goal_id=eq.${pick.id}&select=query`))[0]?.query;
  const search = prev && prev !== pick.requested_as && prev !== pick.name ? prev : await fieldQuery(pick);
  const now = new Date();
  const y = now.getUTCFullYear();
  // Who leads: the last 3 full years. Volume: 15 full years plus the year so far.
  const today = now.toISOString().slice(0, 10);
  const [years, institutions, countries] = await Promise.all([
    groupBy(search, "publication_year", `${y - 15}-01-01`, today),
    groupBy(search, "authorships.institutions.lineage", `${y - 3}-01-01`, `${y - 1}-12-31`),
    groupBy(search, "authorships.countries", `${y - 3}-01-01`, `${y - 1}-12-31`),
  ]);
  if (!years || !institutions || !countries) return { slug: pick.slug, note: "OpenAlex unavailable; will retry next run", query: search, error: oaError };

  const perYear = Array.from({ length: 16 }, (_, i) => y - 15 + i).map((yr) => ({ year: yr, papers: years.find((g) => Number(g.key) === yr)?.count ?? 0 }));
  // Compare the last 3 full years with the 3 before them; the current year is still filling up.
  const s = (a: number, b: number) => perYear.filter((r) => r.year >= a && r.year <= b).reduce((t, r) => t + r.papers, 0);
  const recent = s(y - 3, y - 1), prior = s(y - 6, y - 4);
  const total3 = countries.reduce((t, g) => t + g.count, 0) || 1;
  const row = {
    goal_id: pick.id,
    query: search,
    years: perYear,
    growth: prior ? Math.round((recent / prior - 1) * 100) / 100 : null,
    papers_3y: recent,
    institutions: institutions.slice(0, 10).map((g) => ({ name: g.name, papers: g.count })),
    countries: countries.slice(0, 10).map((g) => ({ code: g.key.toUpperCase(), name: g.name, papers: g.count, share: Math.round(g.count / total3 * 1000) / 1000 })),
    updated_at: new Date().toISOString(),
  };
  await db("goal_intel?on_conflict=goal_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: row });
  return { slug: pick.slug, growth: row.growth, institutions: row.institutions.length, countries: row.countries.length };
}

const BriefSchema = z.object({
  headline: z.string().describe("One line, at most 14 words: the single most important thing this week."),
  summary: z.string().describe("2-3 sentences, under 70 words, for an investor or funder."),
  moved: z.array(z.object({ goal: z.string(), text: z.string().describe("One sentence, under 30 words.") })).describe("2-5 things that actually moved."),
  watch: z.array(z.object({ goal: z.string(), text: z.string().describe("One sentence, under 30 words.") })).describe("2-4 things to watch next."),
  money: z.array(z.object({ goal: z.string(), problem: z.string(), text: z.string().describe("One sentence, under 30 words: why money would unblock it.") })).describe("1-3 problems where funding would matter most."),
});

async function weeklyBrief() {
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const [goals, posts, nodes] = await Promise.all([
    db("goals?status=eq.ready&select=id,handle,name,progress,horizon_low,horizon_high,bottleneck_key"),
    db(`posts?created_at=gte.${since}&kind=neq.mapped&select=goal_id,kind,headline,body,independent_sources&order=created_at.desc&limit=80`),
    db("nodes?parent_key=not.is.null&status=neq.solved&select=goal_id,key,title,status,blocker_kind,blocker,independent_sources&limit=5000"),
  ]);
  if (!goals.length) return { note: "no goals" };
  // deno-lint-ignore no-explicit-any
  const byId = new Map(goals.map((g: any) => [g.id, g]));
  // deno-lint-ignore no-explicit-any
  const name = (id: number) => `@${(byId.get(id) as any)?.handle ?? "?"}`;
  // deno-lint-ignore no-explicit-any
  const goalLines = goals.map((g: any) => {
    const bn = nodes.find((n: { goal_id: number; key: string }) => n.goal_id === g.id && n.key === g.bottleneck_key);
    return `@${g.handle} (${g.name}): ${nodes.filter((n: { goal_id: number }) => n.goal_id === g.id).length} problems still open, estimate ${g.horizon_low ?? "?"}-${g.horizon_high ?? "?"} years${bn ? `, bottleneck: ${bn.title}` : ""}`;
  }).join("\n");
  // deno-lint-ignore no-explicit-any
  const signalLines = posts.map((p: any) => `${name(p.goal_id)} [${p.kind}] ${p.headline}. ${p.body ?? ""} (${p.independent_sources} sources)`).join("\n") || "(no new signals this week)";
  const funding = nodes.filter((n: { blocker_kind: string }) => n.blocker_kind === "funding").slice(0, 40)
    // deno-lint-ignore no-explicit-any
    .map((n: any) => `${name(n.goal_id)} ${n.title} (${n.status}): ${String(n.blocker ?? "").slice(0, 220)}`).join("\n");

  const msg = await new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" }).beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(BriefSchema) },
    system: `You are the analyst behind the Parallax Terminal, read by investors, funders and journalists who follow
humanity's big goals. Use only the facts given; never invent numbers, papers, people or events.
Refer to goals by their @handle. If little happened, say so; do not inflate.
Write so anyone can follow: keep correct technical terms, but explain uncommon ones in a few plain words; short
sentences, one idea each; everyday words; concrete beats vague; no filler words like "significantly" or "robust".`,
    messages: [{ role: "user", content: `The goals:\n${goalLines}\n\nSignals from the last 7 days:\n${signalLines}\n\nUnsolved problems held back by funding:\n${funding || "(none)"}\n\nWrite this week's brief.` }],
  }).finalMessage().then(track("intel"));
  if (msg.stop_reason === "refusal" || msg.parsed_output == null) return { note: `no brief: ${msg.stop_reason}` };
  const week = new Date().toISOString().slice(0, 10);
  await db("briefs", { method: "POST", prefer: "return=minimal", body: { week, content: msg.parsed_output, signals: posts.length } });
  return { week, headline: msg.parsed_output.headline };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    return json(body.action === "brief" ? await weeklyBrief() : await goalIntel(body.slug));
  } catch (e) {
    console.error("intel failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
