// PARALLAX orgs — Supabase Edge Function named `orgs`. Who you can donate to for each goal.
//
// For a goal, Claude proposes US nonprofits that work on it (research institutes, science
// nonprofits, university foundations), with one line on what each does for the goal. Every candidate
// must then pass two checks: it is a registered 501(c)(3) charity in IRS data (ProPublica Nonprofit
// Explorer), and it has a working donation page on Every.org (which takes the gift, pays the
// nonprofit and sends the receipt, so Parallax never holds money). Organisations whose whole mission
// is this kind of work come first; universities are marked, because a gift goes to the university.
//
// Hourly: one goal people watch that has no list yet (refreshed every 90 days).
//   POST {} · POST {"slug": "mars"} · POST {"action": "probe"} (checks the two services are reachable)
// Header x-parallax-admin: <ADMIN_TOKEN>. Secrets: ANTHROPIC_API_KEY, ADMIN_TOKEN, PARALLAX_MODEL.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";
const DAY = 86_400_000;
const UA = { "User-Agent": "Parallax/1.0 (public research feed)" };

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

const Candidates = z.object({ orgs: z.array(z.object({
  name: z.string().describe("The organisation's legal or common name, as registered in the US."),
  ein: z.string().describe("Its US EIN (9 digits) if you know it; empty if not."),
  why: z.string().describe("What it does for this goal, at most 18 words, concrete (programs, research, grants). Plain words."),
  focused: z.boolean().describe("True if its whole mission is this kind of work; false for universities and broad charities."),
  problems: z.array(z.string()).describe("Keys of the problems (from the list) it works on most directly."),
  website: z.string().describe("Its website, or empty."),
})) });

// Polite fetch: retry once or twice when a service asks us to slow down (429).
async function get(url: string): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
    if (r.status !== 429 || i >= 2) return r;
    await r.body?.cancel();
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
}

type Org = { ein: string; name: string; city: string | null; state: string | null };
const digits = (s: string) => String(s ?? "").replace(/\D/g, "");
const norm = (s: string) => String(s).toLowerCase().replace(/\b(inc|incorporated|the|of|foundation|corp|corporation)\b/g, "").replace(/[^a-z0-9]/g, "");

// IRS data via ProPublica: a registered 501(c)(3) (subsection 3).
async function irs(name: string, ein: string): Promise<Org | null> {
  try {
    if (digits(ein).length === 9) {
      const r = await get(`https://projects.propublica.org/nonprofits/api/v2/organizations/${digits(ein)}.json`);
      if (r.ok) {
        const o = (await r.json()).organization;
        const close = norm(o?.name ?? "").includes(norm(name).slice(0, 8)) || norm(name).includes(norm(o?.name ?? "").slice(0, 8));
        if (o && Number(o.subsection_code) === 3 && close) return { ein: digits(o.ein).padStart(9, "0"), name: o.name, city: o.city ?? null, state: o.state ?? null };
      }
    }
    const plain = name.replace(/^the\s+/i, "");
    const r = await get(`https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(plain)}`);
    if (!r.ok) return null;
    // deno-lint-ignore no-explicit-any
    const hits = ((await r.json()).organizations ?? []).filter((o: any) => Number(o.subseccd) === 3);
    const want = norm(name);
    // deno-lint-ignore no-explicit-any
    const h = hits.find((o: any) => norm(o.name) === want) ?? hits.find((o: any) => norm(o.name).startsWith(want) || want.startsWith(norm(o.name))) ?? hits.find((o: any) => norm(o.name).includes(want));
    return h ? { ein: digits(h.ein).padStart(9, "0"), name: h.name, city: h.city ?? null, state: h.state ?? null } : null;
  } catch { return null; }
}

// Every.org's public nonprofit API: the donation page, logo, and whether the nonprofit has claimed its
// page (claimed ones are paid weekly; others through a partner, more slowly).
type Every = { url: string; logo: string | null; website: string | null; claimed: boolean };
async function everyOrg(ein: string): Promise<Every | null> {
  try {
    const r = await get(`https://partners.every.org/v0.2/nonprofit/${ein}`);
    if (!r.ok) return null;
    const n = (await r.json()).data?.nonprofit;
    if (!n || n.donationsEnabled === false || !n.primarySlug) return null;
    return { url: `https://www.every.org/${n.primarySlug}`, logo: n.logoUrl ?? null, website: n.websiteUrl ?? null, claimed: !!n.hasAdmin };
  } catch { return null; }
}

async function attention(): Promise<Map<number, number>> {
  const rows = await db(`goal_attention?select=goal_id,score`).catch(() => []);
  return new Map(rows.map((r: { goal_id: number; score: number }) => [r.goal_id, r.score]));
}

async function run(slug?: string) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,name,tagline,orgs_at${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=orgs_at.asc.nullsfirst`);
  const att = slug ? new Map() : await attention();
  const g = slug ? goals[0] : goals.find((x: { id: number; orgs_at: string | null }) => (att.get(x.id) ?? 0) > 0 && (!x.orgs_at || Date.now() - new Date(x.orgs_at).getTime() > 90 * DAY));
  if (!g) return { note: "every watched goal has a recent list" };
  const nodes = await db(`nodes?goal_id=eq.${g.id}&parent_key=not.is.null&select=key,title,plain_title`);
  const msg = await claude.beta.messages.stream({
    model: MODEL, max_tokens: 32000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Candidates) },
    messages: [{ role: "user", content: `List up to 10 US-registered nonprofits (501(c)(3)) that people could donate to in order to help this goal happen. Prefer organisations whose mission is this work: research institutes, science nonprofits, field-building or advocacy groups with real programs. Include a university only if it is a leading research centre for the goal, and mark it not focused. Only organisations you are confident exist and are active. Never invent EINs; leave the EIN empty if unsure.

GOAL: ${g.name}. ${g.tagline ?? ""}
PROBLEMS (key: title):
${nodes.map((n: { key: string; plain_title: string | null; title: string }) => `${n.key}: ${n.plain_title || n.title}`).join("\n")}` }],
  }).finalMessage().then(track("orgs"));
  const cands = msg.parsed_output?.orgs ?? [];
  // One at a time, so neither service rate-limits us.
  const checked = [];
  for (const c of cands) checked.push(await (async () => {
    const o = await irs(c.name, c.ein);
    if (!o) return { c, why: "not a registered 501(c)(3)" };
    const ev = await everyOrg(o.ein);
    if (!ev) return { c, why: "no Every.org donation page" };
    return { c, o, ev };
  })());
  const ok = checked.filter((x) => "ev" in x && x.ev) as { c: z.infer<typeof Candidates>["orgs"][number]; o: Org; ev: Every }[];
  const rows = [...new Map(ok.map((x) => [x.o.ein, x])).values()]
    .sort((a, b) => Number(b.c.focused) - Number(a.c.focused) || Number(b.ev.claimed) - Number(a.ev.claimed)).slice(0, 6)
    .map((x, i) => ({
      goal_id: g.id, ein: x.o.ein, name: x.c.name.length < 60 ? x.c.name : x.o.name, city: x.o.city, state: x.o.state,
      website: (x.ev.website || (/^https?:\/\//.test(x.c.website) ? x.c.website : "")).slice(0, 200) || null, logo_url: x.ev.logo, claimed: x.ev.claimed, why: x.c.why.trim().slice(0, 200), focused: x.c.focused,
      problems: x.c.problems.filter((k) => nodes.some((n: { key: string }) => n.key === k)).slice(0, 6), donate_url: x.ev.url, position: i, checked_at: new Date().toISOString(),
    }));
  if (rows.length) {
    await db(`goal_orgs?goal_id=eq.${g.id}`, { method: "DELETE", prefer: "return=minimal" });
    await db("goal_orgs", { method: "POST", prefer: "return=minimal", body: rows });
  }
  await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { orgs_at: new Date().toISOString() } });
  return { slug: g.slug, proposed: cands.length, saved: rows.length, rejected: checked.filter((x) => !("ev" in x && x.ev)).map((x) => `${x.c.name}: ${"why" in x ? x.why : "?"}`) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "probe") { const o = await irs("The Planetary Society", ""); return json({ irs: o, every: o ? await everyOrg(o.ein) : null }); }
    return json(await run(body.slug));
  } catch (e) {
    console.error("orgs failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
