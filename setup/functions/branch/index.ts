// PARALLAX branch — Supabase Edge Function named `branch`. "Your branch".
//
// Matches a signed-in person to the problems on Parallax where someone with their
// skills can actually help, and suggests a first step for each. It may only point
// at problems, papers and researchers already on Parallax: no invented programs,
// organizations or websites.
//
// Request: POST {"refresh"?: true} with the person's own access token as the bearer.
// Answer:  {"items": [...], "generated_at": "...", "cached": true|false}
//          or {"needs": "skills"} when the profile has no skills yet.
//
// Results are saved per person and reused until their skills, bio or follows change,
// or they ask for a refresh (at most RUNS_PER_DAY a day each). BRANCHES_PER_DAY caps
// new matches across everyone, to cap spend.
//
// Secrets: ANTHROPIC_API_KEY, PARALLAX_MODEL (optional). Optional: BRANCHES_PER_DAY (default 300).

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";
const PER_DAY_ALL = Number(Deno.env.get("BRANCHES_PER_DAY") ?? "300");
const RUNS_PER_DAY = 4;
const MAX_CANDIDATES = 220;

const claude = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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

// Who is asking: the token must belong to a real, signed-in account.
async function userFrom(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return typeof u?.id === "string" ? u.id : null;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []);
const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "are", "can", "not", "yet", "has", "have", "into", "about", "more", "than", "how", "what", "who", "out", "but", "its", "our", "your", "you", "all", "any", "one", "use", "new"]);

async function fingerprint(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MatchSchema = z.object({
  matches: z.array(z.object({
    ref: z.string(),
    skill_used: z.string(),
    why_you: z.string(),
    first_step: z.string(),
  })),
});

// deno-lint-ignore no-explicit-any
type Any = any;

async function build(userId: string, profile: Any, followed: Set<number>) {
  const goals: Any[] = await db("goals?status=eq.ready&select=id,slug,handle,name,bottleneck_key");
  const byId = new Map(goals.map((g) => [g.id, g]));
  const leaves: Any[] = await db("nodes?parent_key=not.is.null&status=neq.solved&select=goal_id,key,title,why,status,blocker_kind,blocker,evidence&limit=5000");
  const open = leaves.filter((l) => l.status !== "solved" && byId.has(l.goal_id));

  // Narrow hundreds of problems to a shortlist: everything in followed goals, then the
  // problems whose words overlap the person's skills and bio, then bottlenecks.
  const mine = words(`${(profile.skills ?? []).join(" ")} ${profile.bio ?? ""}`);
  for (const w of STOP) mine.delete(w);
  const score = (l: Any) => {
    const text = words(`${l.title} ${l.why ?? ""} ${l.blocker ?? ""}`);
    let s = 0;
    for (const w of mine) if (text.has(w)) s += 3;
    if (followed.has(l.goal_id)) s += 4;
    if (l.blocker_kind === "attention") s += 2;
    if (l.status === "blocked") s += 1;
    if (byId.get(l.goal_id)?.bottleneck_key === l.key) s += 2;
    return s;
  };
  const ranked = open.map((l) => ({ l, s: score(l) })).sort((a, b) => b.s - a.s).slice(0, MAX_CANDIDATES).map((x) => x.l);
  if (ranked.length === 0) return [];

  const refOf = (l: Any) => `${byId.get(l.goal_id).slug}/${l.key}`;
  const lines = ranked.map((l) => {
    const g = byId.get(l.goal_id);
    const ev = (l.evidence ?? []).slice(0, 2).map((e: Any) => `"${String(e.title).slice(0, 90)}" (${e.first_author || "unknown"}, ${e.year ?? "n.d."})`).join("; ");
    return `[${refOf(l)}] @${g.handle} | ${l.title} | ${l.status}/${l.blocker_kind} | ${String(l.blocker ?? "").slice(0, 220)}${ev ? ` | papers: ${ev}` : ""}`;
  }).join("\n");

  const msg = await claude.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(MatchSchema) },
    system: `You work for Parallax, a public feed of humanity's goals. You help one person find where
their skills can move a real problem forward. Be concrete, warm and honest: a nurse cannot run a
fusion lab, but may be exactly who a space-medicine study needs. Never invent organizations,
programs, websites, events, job openings or people. You may only name the papers and authors listed.`,
    messages: [{
      role: "user",
      content: `The person:
Skills: ${(profile.skills ?? []).join(", ") || "(none given)"}
About them: ${profile.bio || "(nothing yet)"}
Goals they follow: ${[...followed].map((id) => byId.get(id) ? `@${byId.get(id).handle}` : "").filter(Boolean).join(", ") || "(none)"}

Open problems on Parallax, one per line:
[ref] @goal | problem | status/what blocks it | where it stands | papers on it
${lines}

Pick the 5 problems where THIS person's skills fit best and could genuinely help. Spread them
across goals when the fit is close. Prefer problems few people work on ("attention") or that are
blocked, but fit comes first. For each return:
- ref: copied exactly from the list.
- skill_used: which of their skills applies, in their words.
- why_you: one or two sentences, speaking to them as "you", on why someone with this skill matters here.
- first_step: one thing they can do on their own this week, specific to this problem: read a named
  paper from the list, contact the named authors, learn a named method, offer their skill to
  researchers working on it, or share the problem with someone who can help. No invented links,
  programs or organizations.
If fewer than 5 fit honestly, return fewer.`,
    }],
  }).finalMessage();
  if (msg.stop_reason === "refusal" || msg.parsed_output == null) throw new Error("Could not find matches right now.");

  const byRef = new Map(ranked.map((l) => [refOf(l), l]));
  const seen = new Set<string>();
  return msg.parsed_output.matches.filter((m) => byRef.has(m.ref) && !seen.has(m.ref) && seen.add(m.ref)).slice(0, 5).map((m) => {
    const l = byRef.get(m.ref);
    const g = byId.get(l.goal_id);
    return {
      goal: { id: g.id, slug: g.slug, handle: g.handle, name: g.name },
      node: { key: l.key, title: l.title, status: l.status, blocker_kind: l.blocker_kind },
      skill_used: m.skill_used,
      why_you: m.why_you,
      first_step: m.first_step,
      papers: (l.evidence ?? []).slice(0, 2).map((e: Any) => ({ title: e.title, url: e.url, year: e.year, first_author: e.first_author })),
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const userId = await userFrom(req);
    if (!userId) return json({ error: "Sign in to see your branch." }, 401);
    const body = await req.json().catch(() => ({}));

    const profile = (await db(`profiles?id=eq.${userId}&select=handle,bio,skills`))?.[0];
    if (!profile) return json({ error: "No profile found for this account." }, 404);
    if (!(profile.skills ?? []).length) return json({ needs: "skills" });

    const followed = new Set<number>((await db(`follows?user_id=eq.${userId}&select=goal_id`)).map((r: Any) => r.goal_id));
    const goalCount = (await db("goals?status=eq.ready&select=id")).length;
    const basis = await fingerprint(JSON.stringify([profile.skills, profile.bio, [...followed].sort(), goalCount]));
    const row = (await db(`branches?user_id=eq.${userId}&select=*`))?.[0];
    const today = new Date().toISOString().slice(0, 10);
    const runsToday = row && row.runs_day === today ? row.runs_today : 0;

    const fresh = row && row.basis === basis && (row.items ?? []).length;
    if (fresh && !body.refresh) return json({ items: row.items, generated_at: row.generated_at, cached: true });
    if (runsToday >= RUNS_PER_DAY) {
      if (row && (row.items ?? []).length) return json({ items: row.items, generated_at: row.generated_at, cached: true, note: "You can look for new matches again tomorrow." });
      return json({ error: "You can look for new matches again tomorrow." }, 429);
    }
    const since = new Date(Date.now() - 864e5).toISOString();
    if ((await db(`branches?generated_at=gte.${since}&select=user_id`)).length >= PER_DAY_ALL) {
      if (row && (row.items ?? []).length) return json({ items: row.items, generated_at: row.generated_at, cached: true, note: "Parallax is busy. Showing your last matches." });
      return json({ error: "Parallax is matching a lot of people today. Try again tomorrow." }, 429);
    }

    const items = await build(userId, profile, followed);
    const now = new Date().toISOString();
    await db("branches?on_conflict=user_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: userId, items, basis, generated_at: now, runs_today: runsToday + 1, runs_day: today },
    });
    return json({ items, generated_at: now, cached: false });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
