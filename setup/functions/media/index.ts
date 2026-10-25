// PARALLAX media — Supabase Edge Function named `media`.
//
// Finds a few good visuals: a video or a picture for a goal and for the posts that deserve one.
// Fewer and better: Claude first decides which posts have something concrete worth showing, then
// LOOKS at up to three candidates for each and keeps one only if it clearly shows the subject and
// looks good (score 7/10 or more). No visual beats a bad one.
//
// Sources, all safe to use:
//   - NASA's Image and Video Library (videos and pictures): NASA media is generally not under
//     copyright. Credited "NASA" (plus center or photographer); never presented as NASA endorsing Parallax.
//   - Wikimedia Commons: only CC0, public domain, CC BY and CC BY-SA, at least 1200 px wide,
//     always shown with the creator and license.
//
// Hourly, one goal per call, header x-parallax-admin: <ADMIN_TOKEN>. POST {} or {"slug": "mars"}.
// Stored as goals.media / posts.media: {kind: "video"|"image", url, poster, credit, license,
// source_url, source, score}, or {none: true, at} when nothing good was found (retried after 14 days).
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
const ITEMS_PER_RUN = 6;
const DAY = 86_400_000;

type Cand = { kind: "video" | "image"; url: string; poster: string; credit: string; license: string; source_url: string; source: string };

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

async function getJson(url: string, ms = 15000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { "User-Agent": `Parallax/1.0 (${MAIL || "public research feed"})` } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

// The file really loads and is the right type.
async function alive(u: string, type: RegExp) {
  try {
    const r = await fetch(u.replace(/ /g, "%20"), { headers: { Range: "bytes=0-1023", "User-Agent": `Parallax/1.0 (${MAIL})` }, signal: AbortSignal.timeout(10000) });
    await r.body?.cancel();
    return r.ok && type.test(r.headers.get("content-type") ?? "");
  } catch { return false; }
}

const nasaCredit = (m: { photographer?: string; secondary_creator?: string; center?: string }) => {
  const who = [m.photographer, m.secondary_creator].find((x) => x && !/nasa/i.test(x));
  return who ? `NASA / ${String(who).slice(0, 60)}` : `NASA${m.center ? ` / ${m.center}` : ""}`;
};
const fix = (u: string) => u.replace(/^http:/, "https:").replace(/ /g, "%20");

async function nasaVideos(q: string): Promise<Cand[]> {
  const d = await getJson(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=video&page_size=6`);
  const out: Cand[] = [];
  // deno-lint-ignore no-explicit-any
  for (const it of (d.collection?.items ?? []).slice(0, 4) as any[]) {
    const m = it.data?.[0] ?? {};
    const poster = it.links?.find((l: { render?: string }) => l.render === "image")?.href ?? it.links?.[0]?.href;
    if (!m.nasa_id || !poster || !it.href) continue;
    try {
      const files: string[] = await getJson(it.href);
      const mp4 = ["~mobile.mp4", "~small.mp4", "~preview.mp4", "~medium.mp4"].map((s) => files.find((f) => f.endsWith(s))).find(Boolean);
      if (!mp4) continue;
      out.push({ kind: "video", url: fix(mp4), poster: fix(poster), credit: nasaCredit(m), license: "NASA media (not copyrighted)", source_url: `https://images.nasa.gov/details/${encodeURIComponent(m.nasa_id)}`, source: "nasa" });
    } catch { /* skip this one */ }
    if (out.length >= 2) break;
  }
  return out;
}

async function nasaImages(q: string): Promise<Cand[]> {
  const d = await getJson(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image&page_size=8`);
  // deno-lint-ignore no-explicit-any
  return (d.collection?.items ?? []).slice(0, 4).map((it: any) => {
    const m = it.data?.[0] ?? {}, thumb = it.links?.[0]?.href ?? "";
    if (!thumb || !m.nasa_id) return null;
    return { kind: "image", url: fix(thumb.replace(/~(thumb|small|medium)\./, "~large.")), poster: fix(thumb), credit: nasaCredit(m), license: "NASA media (not copyrighted)", source_url: `https://images.nasa.gov/details/${encodeURIComponent(m.nasa_id)}`, source: "nasa" };
  }).filter(Boolean);
}

// Wikimedia Commons, directly: open licenses only, at least 1200 px wide.
async function commons(q: string): Promise<Cand[]> {
  const p = new URLSearchParams({ action: "query", format: "json", origin: "*", generator: "search", gsrsearch: `${q} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "12", prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "1600" });
  const d = await getJson(`https://commons.wikimedia.org/w/api.php?${p}`, 20000);
  const strip = (h: unknown) => String(h ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  // deno-lint-ignore no-explicit-any
  return Object.values(d.query?.pages ?? {}).map((pg: any) => {
    const ii = pg.imageinfo?.[0], md = ii?.extmetadata ?? {};
    const lic = strip(md.LicenseShortName?.value);
    const ok = /^(cc0|public domain|pd|cc by(-sa)? \d)/i.test(lic) && !/nc|nd/i.test(lic);
    if (!ii || !ok || (ii.width ?? 0) < 1200 || !/^image\/(jpeg|png|webp)/.test(ii.mime ?? "")) return null;
    return { kind: "image", url: ii.thumburl ?? ii.url, poster: ii.thumburl ?? ii.url, credit: `${strip(md.Artist?.value).slice(0, 60) || "Unknown author"} via Wikimedia Commons`, license: lic, source_url: ii.descriptionurl ?? ii.url, source: "commons" };
  }).filter(Boolean).slice(0, 3) as Cand[];
}

// Pictures go to Claude as data (some sites do not let others fetch them).
async function asBlock(u: string) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": `Parallax/1.0 (${MAIL})` }, signal: AbortSignal.timeout(12000) });
    const type = (r.headers.get("content-type") ?? "").split(";")[0];
    if (!r.ok || !/^image\/(jpeg|png|gif|webp)$/.test(type)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 3_500_000) return null;
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { type: "image", source: { type: "base64", media_type: type, data: btoa(bin) } };
  } catch { return null; }
}

const Plan = z.object({
  space: z.boolean().describe("True if the goal is about space, so NASA's library (with videos) is the best source."),
  goal_query: z.string().describe("2-4 concrete words for a striking visual of the goal itself."),
  posts: z.array(z.object({
    id: z.number(),
    visual: z.boolean().describe("True only if the post is about a concrete thing worth seeing (a machine, place, test, mission). False for abstract posts (policy, cost, forecasts)."),
    query: z.string().describe("2-4 concrete words naming the thing to show."),
  })),
});
const Verdict = z.object({ items: z.array(z.object({ id: z.string(), pick: z.number().describe("Candidate number, or -1 for none"), score: z.number().describe("1-10: how clearly and beautifully it shows the subject") })) });

async function run(slug?: string) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,name,media${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}`);
  const stale = (m: { none?: boolean; at?: string; url?: string } | null) => !m || (!m.url && (!m.none || Date.now() - new Date(m.at ?? 0).getTime() > 14 * DAY));
  // deno-lint-ignore no-explicit-any
  let g: any = null, posts: { id: number; kind: string; headline: string; plain_headline: string | null; media: any }[] = [];
  for (const cand of goals) {
    // deno-lint-ignore no-explicit-any
    const ps = (await db(`posts?goal_id=eq.${cand.id}&kind=neq.mapped&select=id,kind,headline,plain_headline,media&order=created_at.desc&limit=40`)).filter((p: any) => stale(p.media));
    if (slug || ps.length || stale(cand.media)) { g = cand; posts = ps; break; }
  }
  if (!g) return { note: "every goal is done" };

  const plan = (await claude.beta.messages.stream({
    model: MODEL, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Plan) },
    messages: [{ role: "user", content: `Plan visuals for a research feed. Be selective: most posts need no visual.\nGoal: ${g.name}\nPosts:\n${posts.map((p) => `[${p.id}] (${p.kind}) ${p.plain_headline || p.headline}`).join("\n") || "(none)"}` }],
  }).finalMessage()).parsed_output;
  if (!plan) return { slug: g.slug, note: "no plan" };

  // This run: the goal first (when it needs one), then up to ITEMS_PER_RUN visual posts.
  const items: { id: string; label: string; query: string }[] = [];
  if (stale(g.media)) items.push({ id: "goal", label: g.name, query: plan.goal_query });
  const none = { none: true, at: new Date().toISOString() };
  for (const p of plan.posts) {
    const post = posts.find((x) => x.id === p.id);
    if (!post) continue;
    if (!p.visual) { await db(`posts?id=eq.${p.id}`, { method: "PATCH", prefer: "return=minimal", body: { media: none, image_query: null } }); continue; }
    if (items.length < ITEMS_PER_RUN) items.push({ id: String(p.id), label: post.plain_headline || post.headline, query: p.query });
  }

  const errors: string[] = [];
  const cands = await Promise.all(items.map(async (it) => {
    const list: Cand[] = [];
    const add = async (f: () => Promise<Cand[]>) => { try { list.push(...await f()); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); } };
    if (plan.space) { await add(() => nasaVideos(it.query)); await add(() => nasaImages(it.query)); }
    if (!plan.space || list.length < 2) await add(() => commons(it.query));
    return list.slice(0, 3);
  }));

  // Claude looks at the candidates and keeps only the good ones.
  // deno-lint-ignore no-explicit-any
  const content: any[] = [{ type: "text", text: "For each item, pick the candidate that most clearly and beautifully shows its subject, as a full-screen background. Reject (pick -1) anything blurry, low quality, off-topic, a chart, diagram or document scan, a logo, or anything misleading about the subject. Videos are shown by a still frame; prefer a video when it is as good. Score 1-10." }];
  const blocks = await Promise.all(cands.map((list) => Promise.all(list.map((c) => asBlock(c.poster)))));
  items.forEach((it, i) => {
    content.push({ type: "text", text: `\nItem ${i}: "${it.label}" (looking for: ${it.query})` });
    cands[i].forEach((c, k) => { if (blocks[i][k]) { content.push({ type: "text", text: `Item ${i}, candidate ${k} (${c.kind})` }); content.push(blocks[i][k]); } });
    if (!blocks[i].some(Boolean)) content.push({ type: "text", text: "(no candidates)" });
  });
  content.push({ type: "text", text: "Answer with one entry per item; id = the item number." });
  let verdict: z.infer<typeof Verdict> | null = null;
  if (blocks.some((b) => b.some(Boolean))) {
    try {
      verdict = (await claude.beta.messages.stream({
        model: MODEL, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(Verdict) },
        messages: [{ role: "user", content }],
      }).finalMessage()).parsed_output;
    } catch (e) { errors.push(`judge: ${e instanceof Error ? e.message.slice(0, 160) : e}`); }
  }

  let kept = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i], v = verdict?.items.find((x) => String(x.id).replace(/\D/g, "") === String(i));
    let media: Record<string, unknown> = none;
    const c = v && v.pick >= 0 && v.score >= 7 && blocks[i][v.pick] ? cands[i][v.pick] : null;
    if (c) {
      let url = c.url;
      if (c.kind === "image" && !(await alive(url, /^image\//))) url = (await alive(c.poster, /^image\//)) ? c.poster : "";
      if (c.kind === "video" && !(await alive(url, /^video\//))) url = "";
      if (url) { media = { ...c, url, score: v!.score }; kept++; }
    }
    if (!verdict && blocks[i].some(Boolean)) continue; // judge failed: try again next run
    if (it.id === "goal") await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { media } });
    else await db(`posts?id=eq.${it.id}`, { method: "PATCH", prefer: "return=minimal", body: { media, image_query: it.query.slice(0, 80) } });
  }
  return { slug: g.slug, looked_at: items.length, kept, videos_seen: cands.flat().filter((c) => c.kind === "video").length, scores: verdict?.items.map((x) => `${x.id}:${x.pick}/${x.score}`), errors: [...new Set(errors)].slice(0, 4) };
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
