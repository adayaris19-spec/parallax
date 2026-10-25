// PARALLAX media — Supabase Edge Function named `media`.
//
// Finds a free picture for each goal and post, for the swipe feed. Only sources that are safe to use:
//   - NASA's Image and Video Library: NASA media is generally not under copyright. Credited "NASA"
//     (plus the photographer or center), never presented as NASA endorsing Parallax.
//   - Openverse (Wikimedia Commons, Flickr and more): only CC0, public domain, CC BY and CC BY-SA,
//     always shown with the creator and license, as those licenses require.
// Claude turns each post into a short, concrete visual search first ("lunar south pole crater").
//
// Hourly, one goal per call, header x-parallax-admin: <ADMIN_TOKEN>. POST {} or {"slug": "mars"}.
// Secrets: ANTHROPIC_API_KEY, ADMIN_TOKEN, PARALLAX_MODEL, CONTACT_EMAIL.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";
const MAIL = Deno.env.get("CONTACT_EMAIL") ?? "";
const OK_LICENSES = new Set(["cc0", "pdm", "by", "by-sa"]);

type Media = { url: string; thumb: string; credit: string; license: string; source_url: string; source: string };

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

async function getJson(url: string, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": `Parallax/1.0 (${MAIL || "public research feed"})` } });
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function nasa(q: string): Promise<Media[]> {
  const d = await getJson(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image&page_size=12`);
  // deno-lint-ignore no-explicit-any
  return (d.collection?.items ?? []).map((it: any) => {
    const m = it.data?.[0] ?? {}, thumb = it.links?.[0]?.href ?? "";
    if (!thumb || !m.nasa_id) return null;
    const who = [m.photographer, m.secondary_creator].find((x: string) => x && !/nasa/i.test(x));
    return {
      url: thumb.replace("~thumb", "~medium"), thumb, credit: who ? `NASA / ${String(who).slice(0, 60)}` : `NASA${m.center ? ` / ${m.center}` : ""}`,
      license: "NASA media (not copyrighted)", source_url: `https://images.nasa.gov/details/${encodeURIComponent(m.nasa_id)}`, source: "nasa",
    };
  }).filter(Boolean);
}

async function openverse(q: string): Promise<Media[]> {
  const d = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0,pdm,by,by-sa&page_size=12&mature=false`, 40000); // Openverse can be slow
  // deno-lint-ignore no-explicit-any
  return (d.results ?? []).filter((r: any) => OK_LICENSES.has(String(r.license)) && (r.width ?? 0) >= 700).map((r: any) => ({
    url: r.url, thumb: r.thumbnail ?? r.url,
    credit: `${r.creator ? String(r.creator).slice(0, 60) : "Unknown author"}${r.provider ? ` via ${r.provider}` : ""}`,
    license: r.license === "pdm" ? "Public domain" : r.license === "cc0" ? "CC0" : `CC ${String(r.license).toUpperCase()} ${r.license_version ?? ""}`.trim(),
    source_url: r.foreign_landing_url ?? r.url, source: "openverse",
  }));
}

const Plan = z.object({
  space: z.boolean().describe("True if the goal is about space, so NASA's image library is the best source."),
  goal_query: z.string().describe("2-4 concrete words for a striking photo that represents the goal."),
  posts: z.array(z.object({ id: z.number(), query: z.string().describe("2-4 concrete words naming a thing that could be photographed: an object, place or machine. No abstract words.") })),
});

async function run(slug?: string) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,name,media${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}`);
  let g = goals[0];
  let posts: { id: number; kind: string; headline: string; plain_headline: string | null }[] = [];
  for (const cand of goals) {
    posts = await db(`posts?goal_id=eq.${cand.id}&media=is.null&select=id,kind,headline,plain_headline&order=created_at.desc&limit=30`);
    if (slug || posts.length || !cand.media) { g = cand; break; }
    g = null;
  }
  if (!g) return { note: "every goal has pictures" };

  const msg = await new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "" }).beta.messages.stream({
    model: MODEL, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Plan) },
    messages: [{ role: "user", content: `Pick image searches for a picture feed about this goal. Searches must name something concrete that a photographer or space agency would have pictured.
Goal: ${g.name}
Posts:
${posts.map((p) => `[${p.id}] (${p.kind}) ${p.plain_headline || p.headline}`).join("\n") || "(none)"}` }],
  }).finalMessage();
  const plan = msg.parsed_output;
  if (!plan) return { slug: g.slug, note: `no plan: ${msg.stop_reason}` };

  // Only keep a picture whose file really loads (NASA's "medium" size is missing for some items).
  const alive = async (u: string) => {
    try {
      const r = await fetch(u, { method: "GET", headers: { Range: "bytes=0-1023", "User-Agent": `Parallax/1.0 (${MAIL})` }, signal: AbortSignal.timeout(10000) });
      await r.body?.cancel();
      return r.ok && /^image\//.test(r.headers.get("content-type") ?? "image/");
    } catch { return false; }
  };
  const used = new Set<string>();
  const errors: string[] = [];
  const find = async (q: string): Promise<Media | null> => {
    const order = plan.space ? [nasa, openverse] : [openverse, nasa];
    for (const src of order) {
      try {
        for (const m of (await src(q)).filter((x) => !used.has(x.url)).slice(0, 4)) {
          if (await alive(m.url)) { used.add(m.url); return m; }
          if (m.thumb && m.thumb !== m.url && await alive(m.thumb)) { used.add(m.url); return { ...m, url: m.thumb }; }
        }
      } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    }
    return null;
  };

  let found = 0;
  if (!g.media || slug) {
    const m = await find(plan.goal_query);
    if (m) { await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { media: m } }); found++; }
  }
  for (const p of plan.posts) {
    if (!posts.some((x) => x.id === p.id)) continue;
    const m = await find(p.query);
    // An empty object marks "searched, nothing safe found", so the post is not searched every hour.
    await db(`posts?id=eq.${p.id}`, { method: "PATCH", prefer: "return=minimal", body: { media: m ?? {}, image_query: p.query.slice(0, 80) } });
    if (m) found++;
  }
  return { slug: g.slug, space: plan.space, pictures: found, posts: posts.length, errors: [...new Set(errors)].slice(0, 4) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    return json(await run(body.slug));
  } catch (e) {
    console.error("media failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
