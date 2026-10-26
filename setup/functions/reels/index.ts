// PARALLAX reels — Supabase Edge Function named `reels`. Feeds the Watch tab.
//
// Writes short vertical "videos" for a goal: 4-6 scenes, each with a big caption, maybe one
// striking number, and real footage or a photo behind it. The site plays them like a video, with
// captions and music (no voice). Claude decides which reels each goal deserves: an intro, a
// breakthrough, a setback, promise vs reality, or the people working on it. Every fact comes from
// Parallax's own data; every visual is NASA media (not copyrighted) or an openly licensed
// Wikimedia Commons image, checked by Claude for relevance and quality, and always credited.
//
// Every 2 hours, one goal per call, header x-parallax-admin: <ADMIN_TOKEN>.
//   POST {}  the goal whose reels are oldest (or missing) · POST {"slug": "mars"}  one goal now
// Secrets: ANTHROPIC_API_KEY, ADMIN_TOKEN, PARALLAX_MODEL, CONTACT_EMAIL. Optional: PIXABAY_API_KEY, UNSPLASH_ACCESS_KEY.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.7";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const MODEL = Deno.env.get("PARALLAX_MODEL") ?? "claude-opus-5-5";
const MAIL = Deno.env.get("CONTACT_EMAIL") ?? "";
const DAY = 86_400_000;

type Cand = { kind: "video" | "image"; url: string; poster: string; credit: string; license: string; source_url: string; source: string; landscape?: boolean; rehost?: boolean; id?: string; ping?: string; preview?: string };

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
      const mp4 = ["~medium.mp4", "~small.mp4", "~mobile.mp4", "~preview.mp4"].map((s) => files.find((f) => f.endsWith(s))).find(Boolean);
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
  const p = new URLSearchParams({ action: "query", format: "json", origin: "*", generator: "search", gsrsearch: `${q} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "12", prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "2400" });
  const d = await getJson(`https://commons.wikimedia.org/w/api.php?${p}`, 20000);
  const strip = (h: unknown) => String(h ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  // deno-lint-ignore no-explicit-any
  return Object.values(d.query?.pages ?? {}).map((pg: any) => {
    const ii = pg.imageinfo?.[0], md = ii?.extmetadata ?? {};
    const lic = strip(md.LicenseShortName?.value);
    const ok = /^(cc0|public domain|pd|cc by(-sa)? \d)/i.test(lic) && !/nc|nd/i.test(lic);
    if (!ii || !ok || (ii.width ?? 0) < 1200 || !/^image\/(jpeg|png|webp)/.test(ii.mime ?? "")) return null;
    return { kind: "image", url: ii.thumburl ?? ii.url, poster: String(ii.thumburl ?? ii.url).replace(/\/1600px-/, "/330px-"), credit: `${strip(md.Artist?.value).slice(0, 60) || "Unknown author"} via Wikimedia Commons`, license: lic, source_url: ii.descriptionurl ?? ii.url, source: "commons" };
  }).filter(Boolean).slice(0, 3) as Cand[];
}

// Pictures go to Claude as data (some sites do not let others fetch them). Each source is asked for a
// small preview (about 320 px wide): enough to judge beauty and fit, at a fraction of the tokens.
async function asBlock(u: string) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": `Parallax/1.0 (${MAIL})` }, signal: AbortSignal.timeout(12000) });
    const type = (r.headers.get("content-type") ?? "").split(";")[0];
    if (!r.ok || !/^image\/(jpeg|png|gif|webp)$/.test(type)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 1_500_000) return null; // keep each picture small
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { type: "image", source: { type: "base64", media_type: type, data: btoa(bin) } };
  } catch { return null; }
}


// Pixabay: free videos and photos (Pixabay Content License: free to use, no attribution needed, but
// we credit anyway). Their API rules forbid permanent hotlinking, so chosen files are copied into
// Supabase Storage (public bucket "reels-media"). Used only when PIXABAY_API_KEY is set.
const PIXABAY = Deno.env.get("PIXABAY_API_KEY") ?? "";
// The sharpest file up to 1080p (4K is too heavy for phones). On a phone held upright a landscape
// clip is cropped and enlarged, so 1080p looks clearly sharper than 720p.
// deno-lint-ignore no-explicit-any
function bestPixabayFile(vs: any): { url: string; width: number; height: number; thumbnail?: string } | undefined {
  // deno-lint-ignore no-explicit-any
  return [vs.large, vs.medium, vs.small].filter((x: any) => x?.url && (x.size ?? 0) < 45_000_000)
    // deno-lint-ignore no-explicit-any
    .map((x: any) => ({ ...x, short: Math.min(x.width ?? 0, x.height ?? 0) }))
    // deno-lint-ignore no-explicit-any
    .filter((x: any) => x.short >= 540 && x.short <= 1080)
    // deno-lint-ignore no-explicit-any
    .sort((a: any, b: any) => b.short - a.short)[0];
}
async function pixabayVideos(q: string): Promise<Cand[]> {
  if (!PIXABAY) return [];
  const d = await getJson(`https://pixabay.com/api/videos/?key=${PIXABAY}&q=${encodeURIComponent(q.slice(0, 90))}&safesearch=true&per_page=8`);
  // deno-lint-ignore no-explicit-any
  return (d.hits ?? []).map((v: any) => {
    const vs = v.videos ?? {};
    const f = bestPixabayFile(vs);
    const thumb = vs.medium?.thumbnail || f?.thumbnail || vs.small?.thumbnail || (v.picture_id ? `https://i.vimeocdn.com/video/${v.picture_id}_960x540.jpg` : "");
    if (!f || !thumb || (v.duration ?? 0) < 6) return null;
    return { kind: "video", url: f.url, poster: thumb, credit: `${String(v.user ?? "Pixabay creator").slice(0, 50)} via Pixabay`, license: "Pixabay Content License", source_url: v.pageURL, source: "pixabay", landscape: (f.width ?? 0) > (f.height ?? 0), rehost: true, id: `pv${v.id}`, preview: vs.small?.thumbnail || thumb };
  }).filter(Boolean).slice(0, 3);
}
async function pixabayPhotos(q: string): Promise<Cand[]> {
  if (!PIXABAY) return [];
  const d = await getJson(`https://pixabay.com/api/?key=${PIXABAY}&q=${encodeURIComponent(q.slice(0, 90))}&image_type=photo&orientation=vertical&min_height=1200&safesearch=true&per_page=6`);
  // deno-lint-ignore no-explicit-any
  return (d.hits ?? []).slice(0, 2).map((p: any) => ({ kind: "image", url: p.largeImageURL, poster: String(p.webformatURL).replace(/_640\./, "_340."), credit: `${String(p.user ?? "Pixabay photographer").slice(0, 50)} via Pixabay`, license: "Pixabay Content License", source_url: p.pageURL, source: "pixabay", rehost: true, id: `pp${p.id}` }));
}

// Unsplash: beautiful photos (Unsplash License). Their rules: show the photo from their servers,
// credit the photographer and Unsplash with links, and tell Unsplash when a photo is used.
// Used only when UNSPLASH_ACCESS_KEY is set. The free tier allows 50 searches an hour.
const UNSPLASH = Deno.env.get("UNSPLASH_ACCESS_KEY") ?? "";
const UTM = "utm_source=parallax&utm_medium=referral";
async function unsplashPhotos(q: string): Promise<Cand[]> {
  if (!UNSPLASH) return [];
  const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&orientation=portrait&content_filter=high&per_page=6`, { headers: { Authorization: `Client-ID ${UNSPLASH}`, "Accept-Version": "v1" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`unsplash answered ${r.status}`);
  const d = await r.json();
  // deno-lint-ignore no-explicit-any
  return (d.results ?? []).filter((p: any) => p.urls?.raw && !p.premium).slice(0, 3).map((p: any) => ({
    kind: "image", url: `${p.urls.raw}&w=1440&h=2560&fit=crop&crop=entropy&q=80&fm=jpg`, poster: `${p.urls.raw}&w=320&q=70&fm=jpg`,
    credit: `${String(p.user?.name ?? "Unsplash photographer").slice(0, 50)} on Unsplash`, license: "Unsplash License",
    source_url: `${p.links?.html ?? "https://unsplash.com"}?${UTM}`, source: "unsplash", ping: p.links?.download_location,
  }));
}

// Media storage: Cloudflare R2 when its secrets are set (free storage up to 10 GB, free downloads),
// otherwise Supabase Storage. Same files either way, so quality is unchanged.
const R2_ACCOUNT = Deno.env.get("R2_ACCOUNT_ID") ?? "";
const R2_PUBLIC = (Deno.env.get("R2_PUBLIC_URL") ?? "").replace(/\/+$/, "");
const R2_BUCKET = Deno.env.get("R2_BUCKET") ?? "parallax-media";
// The public address must be the bucket's public URL (pub-….r2.dev or a custom domain), not the API endpoint.
const r2 = R2_ACCOUNT && R2_PUBLIC && !R2_PUBLIC.includes("r2.cloudflarestorage.com") && Deno.env.get("R2_ACCESS_KEY_ID")
  ? new AwsClient({ accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!, secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "", service: "s3", region: "auto" })
  : null;
const OLD_PREFIX = `${SB}/storage/v1/object/public/reels-media/`;

async function r2Put(path: string, data: ArrayBuffer, type: string) {
  const up = await r2!.fetch(`https://${R2_ACCOUNT}.r2.cloudflarestorage.com/${R2_BUCKET}/${path}`, {
    method: "PUT", body: data, headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
  });
  if (!up.ok) throw new Error(`r2 ${up.status}: ${(await up.text()).slice(0, 120)}`);
  return `${R2_PUBLIC}/${path}`;
}

// Copy a file into storage and return its public address.
async function rehost(c: Cand, folder: string) {
  const r = await fetch(c.url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok || !r.body) throw new Error(`copy failed ${r.status}`);
  const type = (r.headers.get("content-type") ?? (c.kind === "video" ? "video/mp4" : "image/jpeg")).split(";")[0];
  const path = `${folder}/${c.id}.${c.kind === "video" ? "mp4" : "jpg"}`;
  const data = await r.arrayBuffer();
  if (r2) {
    try { return await r2Put(path, data, type); } catch (e) { console.error("R2 upload failed, using Supabase:", e instanceof Error ? e.message : e); }
  }
  const up = await fetch(`${SB}/storage/v1/object/reels-media/${path}`, { method: "POST", headers: { Authorization: `Bearer ${SRK}`, apikey: SRK, "Content-Type": type, "x-upsert": "true", "cache-control": "max-age=31536000" }, body: data, signal: AbortSignal.timeout(90000) });
  if (!up.ok) throw new Error(`storage ${up.status}: ${(await up.text()).slice(0, 120)}`);
  return `${SB}/storage/v1/object/public/reels-media/${path}`;
}

const Scene = z.object({
  caption: z.string().describe("At most 10 words. Big text on screen. Plain, punchy, true."),
  sub: z.string().describe("Optional second line, at most 18 words. Empty if not needed."),
  stat_value: z.string().describe("Optional striking number from the facts, like 354 or 48% or 15-35. Empty if none."),
  stat_label: z.string().describe("What the number means, at most 6 words. Empty if no number."),
  visual: z.string().describe("3-6 words for cinematic footage or a photo to show behind this scene: a dramatic, wide or moody shot (a launch at night, Earth from orbit, the lunar horizon, a reactor glow, a vast landscape). Give one for every scene, including number scenes (shown dimmed behind the number)."),
  layout: z.enum(["bottom", "center", "top", "number", "quote"]).describe("bottom: text low over the visual (default). center: one short bold statement in the middle. top: a headline at the top, visual below. number: a huge number fills the screen (at most once per reel; other layouts can show a number too). quote: words someone wrote, in quote style. Vary layouts across the reel."),
});
const Plan = z.object({
  space: z.boolean().describe("True if the goal is about space, so NASA footage is the best source."),
  reels: z.array(z.object({
    kind: z.enum(["intro", "breakthrough", "setback", "promise", "people"]),
    mood: z.enum(["epic", "uplifting", "tense", "bittersweet", "mysterious", "calm"]).describe("The feeling of this reel, for its music."),
    post_id: z.number().describe("The post this reel is about, or 0 for intro and people."),
    title: z.string().describe("At most 8 words."),
    strength: z.number().describe("1-10: how likely this reel is to make a stranger stop scrolling."),
    scenes: z.array(Scene).describe("4 to 6 scenes. The first must hook with a concrete, surprising fact. The last says what happens next or why it matters."),
  })).describe("1 to 4 reels. Always one intro. Then only the strongest other stories this goal really has."),
});
const Verdict = z.object({ items: z.array(z.object({ id: z.string(), pick: z.number(), score: z.number() })) });

// Attention: followers and recent visits (goal_attention). Goals nobody follows or visited in the
// last 30 days get no expensive extras until someone does; the most-watched go first.
async function attention(): Promise<Map<number, number>> {
  const rows = await db(`goal_attention?select=goal_id,score`).catch(() => []);
  return new Map(rows.map((r: { goal_id: number; score: number }) => [r.goal_id, r.score]));
}

// Visual library: photos and videos the photo editor already approved (8/10+), shared by all goals.
// A scene that asks for the same kind of shot reuses one: no search, no judging.
const STOP = new Set("a an the of and or in on at to for with from by over under into through near far its it this that very".split(" "));
const words = (t: string) => new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|es|s)$/, "")));
type LibVisual = { id: number; url: string; poster: string | null; kind: "video" | "image"; credit: string; license: string; source_url: string; source: string; query: string; caption: string | null; uses: number };
async function fromLibrary(q: string, avoid: Set<string>): Promise<LibVisual | null> {
  const hits: LibVisual[] = await db("rpc/parallax_match_visuals", { method: "POST", body: { q, n: 8 } }).catch(() => []);
  const want = words(q);
  if (want.size < 2) return null;
  hits.sort((a, b) => Number(b.kind === "video") - Number(a.kind === "video"));
  for (const h of hits) {
    if (avoid.has(h.url) || h.uses >= 4) continue; // keep the feed varied
    const have = words(`${h.query} ${h.caption ?? ""}`);
    const shared = [...want].filter((w) => have.has(w)).length;
    if (shared >= 2 && shared / want.size >= 0.6) return h;
  }
  return null;
}

async function run(slug?: string, fresh = false, live = false) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,handle,name,tagline,summary,progress,horizon_low,horizon_high,bottleneck_key,papers_count,reels_at${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=reels_at.asc.nullsfirst`);
  // Remake a goal's videos only when there is something new (at most weekly), or monthly otherwise.
  // A big moment (a problem solved, a new bottleneck) gets its video right away: it becomes the
  // goal's story for the next 48 hours.
  const latest = slug ? [] : await db(`posts?kind=neq.mapped&select=goal_id,kind,created_at&order=created_at.desc&limit=500`);
  const newest = (id: number, kinds?: string[]) => latest.find((p: { goal_id: number; kind: string }) => p.goal_id === id && (!kinds || kinds.includes(p.kind)))?.created_at;
  const due = (x: { id: number; reels_at: string | null }) => {
    if (!x.reels_at) return true;
    const age = Date.now() - new Date(x.reels_at).getTime(), n = newest(x.id), big = newest(x.id, ["solved", "bottleneck"]);
    return age > 30 * DAY || (age > 7 * DAY && !!n && n > x.reels_at) || (!!big && big > x.reels_at && Date.now() - new Date(big).getTime() < 2 * DAY);
  };
  const att = slug ? new Map() : await attention();
  // Every goal gets its first videos; only watched goals get remade.
  const g = slug ? goals[0] : goals.find((x: { reels_at: string | null }) => !x.reels_at)
    ?? goals.filter((x: { id: number }) => (att.get(x.id) ?? 0) > 0).sort((a: { id: number }, b: { id: number }) => (att.get(b.id) ?? 0) - (att.get(a.id) ?? 0)).find(due);
  if (!g) return { note: "every goal has fresh reels" };
  const [nodes, posts, proms, intel, teams, have] = await Promise.all([
    db(`nodes?goal_id=eq.${g.id}&parent_key=not.is.null&select=key,title,plain_title,status,plain_blocker,blocker,plain_why,why`),
    db(`posts?goal_id=eq.${g.id}&kind=neq.mapped&select=id,kind,headline,plain_headline,body,plain_body,meta,independent_sources,created_at&order=created_at.desc&limit=25`),
    db(`promises?goal_id=eq.${g.id}&select=claim,status,made_year,due_year,verdict`),
    db(`goal_intel?goal_id=eq.${g.id}&select=growth,papers_3y,institutions,countries`).catch(() => []),
    db(`team_problems?goal_id=eq.${g.id}&status=eq.active&select=node_title,plan,target_cents,teams(name,kind)`).catch(() => []),
    db(`reels?goal_id=eq.${g.id}&select=kind,post_id`),
  ]);
  const bn = nodes.find((n: { key: string }) => n.key === g.bottleneck_key);
  const t = (n: { plain_title?: string; title: string }) => n.plain_title || n.title;
  const solved = nodes.filter((n: { status: string }) => n.status === "solved").length;
  const blocked = nodes.filter((n: { status: string }) => n.status === "blocked").length;
  const pc = (s: string) => proms.filter((p: { status: string }) => p.status === s).length;
  const iv = intel[0];
  const done = new Set(have.map((r: { kind: string; post_id: number | null }) => `${r.kind}:${r.post_id ?? 0}`));
  const facts = `GOAL: ${g.name} (@${g.handle})
Where it stands: ${g.tagline ?? g.summary ?? ""}
${nodes.length} problems: ${solved} solved, ${blocked} blocked, the rest moving or barely started (never describe this as a percentage of the way). Estimate: ${g.horizon_low ?? "?"}-${g.horizon_high ?? "?"} years at today's pace.
Research library: ${g.papers_count ?? "?"} papers.${iv ? ` Field: ${iv.papers_3y} papers in the last 3 full years, growth ${Math.round((iv.growth ?? 0) * 100)}% vs the 3 before. Leading countries: ${(iv.countries ?? []).slice(0, 3).map((c: { name: string; share: number }) => `${c.name} ${Math.round(c.share * 100)}%`).join(", ")}. Leading institutions: ${(iv.institutions ?? []).slice(0, 3).map((i: { name: string }) => i.name).join(", ")}.` : ""}
Biggest bottleneck: ${bn ? `${t(bn)}. ${bn.plain_blocker || bn.blocker || ""} Why it matters: ${bn.plain_why || bn.why || ""}` : "none"}
Promises from older research: ${pc("kept")} kept, ${pc("partly")} partly kept, ${pc("broken")} broken, ${pc("pending")} not due yet.
Teams raising money: ${teams.filter((x: { teams: unknown }) => x.teams).map((x: { teams: { name: string }; node_title: string; plan: string }) => `${x.teams.name} on "${x.node_title}": ${x.plan}`).join(" | ") || "none yet"}
POSTS (id, kind, text):
${posts.map((p: { id: number; kind: string; plain_headline: string | null; headline: string; plain_body: string | null; body: string | null; meta: { made_year?: number; due_year?: number; status?: string } | null }) => `[${p.id}] ${p.kind}${p.meta?.made_year ? ` (${p.meta.made_year} -> ${p.meta.due_year}, ${p.meta.status})` : ""}: ${p.plain_headline || p.headline}. ${p.plain_body || p.body || ""}`).join("\n")}
Already made (skip these): ${fresh ? "none" : [...done].join(", ") || "none"}`;

  const plan = (await claude.beta.messages.stream({
    model: MODEL, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Plan) },
    system: `You write short vertical videos for Parallax, a feed of humanity's big goals. Captions only, no voice.
Write like the best science channels: concrete, surprising, honest. Keep correct technical terms; explain uncommon ones in a few words.
Use ONLY the facts given. Never invent numbers, names, dates or events. Numbers on screen must appear in the facts.
Craft:
- Scene 1 must stop a scroll in under 2 seconds: the most surprising concrete fact, a stark contrast, or a question the reel answers. Never open with the goal's name or a definition.
- One idea per scene. Each scene should make the viewer want the next: hook, then stakes, then the turn (what changed or what's in the way), then why it matters or what happens next.
- Short, spoken words. No hype or filler: never "revolutionary", "game-changer", "unlock", "the future of", "imagine a world".
- Visual: describe a real, filmable shot that stock libraries have, using concrete nouns and action ("scientist pipetting into test tubes, close-up", "wind turbines in fog at dawn", "rocket engine test fire, night"). Never abstract ideas like "hope" or "the future of medicine". Vary scale across a reel: wide, close-up, people, places.`,
    messages: [{ role: "user", content: facts }],
  }).finalMessage().then(track("reels"))).parsed_output;
  if (!plan) return { slug: g.slug, note: "no plan" };
  const reels = plan.reels.filter((r) => fresh || !done.has(`${r.kind}:${r.post_id || 0}`) || r.kind === "intro").slice(0, 4);

  // Visuals: find candidates for each scene that wants one, then let Claude keep only good ones.
  const wants: { r: number; s: number; q: string }[] = [];
  reels.forEach((r, ri) => r.scenes.forEach((s, si) => { if (s.visual.trim()) wants.push({ r: ri, s: si, q: s.visual }); }));
  const errors: string[] = [];
  // Library first: scenes whose shot is already in the visual library skip search and judging.
  const used = new Set<string>((await db(`reels?goal_id=eq.${g.id}&select=scenes`)).flatMap((r: { scenes: { visual?: { url: string } }[] }) => r.scenes.map((x) => x.visual?.url).filter(Boolean)) as string[]);
  const pre: Record<string, Cand & { lib?: number }> = {};
  for (const w of [...wants]) {
    const h = await fromLibrary(w.q, used);
    if (!h) continue;
    used.add(h.url);
    pre[`${w.r}:${w.s}`] = { kind: h.kind, url: h.url, poster: h.poster ?? h.url, credit: h.credit, license: h.license, source_url: h.source_url, source: h.source, lib: h.id };
    wants.splice(wants.indexOf(w), 1);
  }
  const cands: Cand[][] = await Promise.all(wants.map(async (w) => {
    const list: Cand[] = [];
    const add = async (f: () => Promise<Cand[]>) => { try { list.push(...await f()); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); } };
    await add(() => pixabayVideos(w.q));
    // Moving footage makes a reel: if the exact search found little, try a broader one.
    if (list.length < 2) { const broad = w.q.split(/\s+/).slice(0, 2).join(" "); if (broad !== w.q) await add(() => pixabayVideos(broad)); }
    if (plan.space) { await add(() => nasaVideos(w.q)); if (list.length < 3) await add(() => nasaImages(w.q)); }
    if (list.length < 3) await add(() => unsplashPhotos(w.q));
    if (list.length < 3) await add(() => pixabayPhotos(w.q));
    if (list.length < 2) await add(() => commons(w.q));
    // Up to 5 candidates: keep every video found, then the best photos.
    return [...list.filter((c) => c.kind === "video").slice(0, 3), ...list.filter((c) => c.kind === "image")].slice(0, 5);
  }));
  const blocks = await Promise.all(cands.map((l) => Promise.all(l.map((c) => asBlock(c.preview ?? c.poster)))));
  // deno-lint-ignore no-explicit-any
  const content: any[] = [{ type: "text", text: "You are the photo editor for a beautiful science video channel. For each scene, pick the candidate that is both on-topic and genuinely beautiful as a full-screen vertical background. The style is cinematic and moody (dramatic light, deep shadows, night launches, glowing machines) or huge wide views (Earth from orbit, planets, landscapes, skies). Reject (-1) anything ugly or ordinary: flat or cluttered snapshots, offices, people pointing at screens, cheesy stock poses, low resolution, washed-out colours, charts, diagrams, documents, logos, text or watermarks, or anything misleading about the subject. Moving footage is what makes these reels feel alive: each video candidate is shown as one still frame, so imagine it moving, and pick a video whenever it scores within 1 point of the best photo. Score 1-10 for beauty and fit together; only 8+ is good enough." }];
  wants.forEach((w, i) => {
    content.push({ type: "text", text: `\nScene ${i}: "${reels[w.r].scenes[w.s].caption}" (looking for: ${w.q})` });
    cands[i].forEach((c, k) => { if (blocks[i][k]) { content.push({ type: "text", text: `Scene ${i}, candidate ${k} (${c.kind}${c.landscape ? ", landscape: the centre will be cropped to a tall phone screen" : ""})` }); content.push(blocks[i][k]); } });
  });
  content.push({ type: "text", text: "One entry per scene; id = the scene number." });
  const present = blocks.map((b) => b.map(Boolean));
  const postIds = reels.map((r) => (r.post_id && posts.some((p: { id: number }) => p.id === r.post_id) ? r.post_id : null));
  // The photo editor's judgement goes through the Message Batches API (half price, same model and
  // standards); a later call applies it. {"live": true} judges at once instead.
  if (!present.some((b) => b.some(Boolean))) return finalize(g, reels, wants, cands, present, postIds, null, fresh, errors, pre);
  if (!live) {
    const fmt = betaZodOutputFormat(Verdict);
    const batch = await claude.messages.batches.create({ requests: [{ custom_id: "judge", params: {
      model: MODEL, max_tokens: 16000, output_config: { effort: "low", format: { type: "json_schema", schema: fmt.schema } },
      messages: [{ role: "user", content }],
    } }] });
    await db("reel_jobs", { method: "POST", prefer: "return=minimal", body: { batch_id: batch.id, goal_id: g.id, slug: g.slug, fresh, reels, wants, cands, present, post_ids: postIds, pre } });
    await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { reels_at: new Date().toISOString() } });
    return { slug: g.slug, submitted: batch.id, wanted: wants.length, errors: [...new Set(errors)].slice(0, 4) };
  }
  let verdict: z.infer<typeof Verdict> | null = null;
  if (blocks.some((b) => b.some(Boolean))) {
    try {
      verdict = (await claude.beta.messages.stream({ model: MODEL, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "low", format: betaZodOutputFormat(Verdict) }, messages: [{ role: "user", content }] }).finalMessage().then(track("reels"))).parsed_output;
    } catch (e) {
      // One picture can spoil the whole call (an odd format or size): try again with the first candidate of each scene only.
      errors.push(`judge: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      blocks.forEach((b) => b.splice(1));
      const slim = content.filter((c, i, all) => !(c.type === "image" && /candidate [1-9]/.test(String(all[i - 1]?.text ?? ""))) && !(c.type === "text" && /candidate [1-9]/.test(String(c.text))));
      try { verdict = (await claude.beta.messages.stream({ model: MODEL, max_tokens: 64000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "low", format: betaZodOutputFormat(Verdict) }, messages: [{ role: "user", content: slim }] }).finalMessage().then(track("reels"))).parsed_output; } catch { /* text-only scenes this time */ }
    }
  }
  return finalize(g, reels, wants, cands, present, postIds, verdict, fresh, errors, pre);
}

type Reel = z.infer<typeof Plan>["reels"][number];
// Keep the visuals the photo editor approved (8/10 or better), copy Pixabay files, save the reels.
async function finalize(g: { id: number; slug: string }, reels: Reel[], wants: { r: number; s: number; q: string }[], cands: Cand[][], present: boolean[][], postIds: (number | null)[], verdict: z.infer<typeof Verdict> | null, fresh: boolean, errors: string[], pre: Record<string, Cand & { lib?: number }> = {}) {
  if (fresh) await db(`reels?goal_id=eq.${g.id}`, { method: "DELETE", prefer: "return=minimal" });
  const visual: Record<string, Cand> = {};
  for (const [k, v] of Object.entries(pre)) {
    const { lib, ...c } = v;
    visual[k] = c;
    if (lib) db(`rpc/parallax_visual_used`, { method: "POST", body: { vid: lib } }).catch(() => {});
  }
  const fresh_: { url: string; poster: string; kind: string; credit: string; license: string; source_url: string; source: string; query: string; caption: string; score: number }[] = [];
  for (let i = 0; i < wants.length; i++) {
    const v = verdict?.items.find((x) => String(x.id).replace(/\D/g, "") === String(i));
    const c = v && v.pick >= 0 && present[i]?.[v.pick] && (v.score >= 8 || (v.score >= 7 && cands[i][v.pick].kind === "video")) ? cands[i][v.pick] : null; // moving footage at 7/10 beats a plain background
    if (!c) continue;
    let url = c.url;
    if (c.kind === "image" && !(await alive(url, /^image\//))) url = (await alive(c.poster, /^image\//)) ? c.poster : "";
    if (c.kind === "video" && !(await alive(url, /^video\//))) url = "";
    if (!url) continue;
    let poster = c.poster;
    if (c.rehost) {
      try { url = await rehost({ ...c, url }, g.slug); poster = c.kind === "video" ? await rehost({ ...c, kind: "image", url: c.poster, id: `${c.id}-poster` }, g.slug) : url; }
      catch (e) { errors.push(`copy: ${e instanceof Error ? e.message : e}`); continue; }
    }
    if (c.ping) fetch(c.ping, { headers: { Authorization: `Client-ID ${UNSPLASH}` } }).then((r) => r.body?.cancel()).catch(() => {});
    visual[`${wants[i].r}:${wants[i].s}`] = { kind: c.kind, url, poster, credit: c.credit, license: c.license, source_url: c.source_url, source: c.source };
    fresh_.push({ url, poster, kind: c.kind, credit: c.credit, license: c.license, source_url: c.source_url, source: c.source, query: wants[i].q, caption: reels[wants[i].r].scenes[wants[i].s].caption, score: v?.score ?? 8 });
  }
  // Scenes the editor left empty: first a matching approved shot from the shared library, then one of
  // this goal's approved shots. Videos first; no shot twice in one reel or more than twice per goal.
  const qOf = new Map(wants.map((w) => [`${w.r}:${w.s}`, w.q]));
  const uses = new Map<string, number>();
  for (const v of Object.values(visual)) uses.set(v.url, (uses.get(v.url) ?? 0) + 1);
  const pool = Object.values(visual).sort((a, b) => Number(b.kind === "video") - Number(a.kind === "video"));
  for (let ri = 0; ri < reels.length; ri++) {
    const r = reels[ri];
    const inReel = new Set(r.scenes.map((_, si) => visual[`${ri}:${si}`]?.url).filter(Boolean));
    for (let si = 0; si < r.scenes.length; si++) {
      const k = `${ri}:${si}`;
      if (visual[k]) continue;
      const q = qOf.get(k) ?? r.scenes[si].visual ?? r.scenes[si].caption;
      const hits: LibVisual[] = await db("rpc/parallax_match_visuals", { method: "POST", body: { q, n: 12 } }).catch(() => []);
      const lib = hits.sort((a, b) => Number(b.kind === "video") - Number(a.kind === "video")).find((h) => !uses.has(h.url) && h.uses < 4);
      const pick: Cand | undefined = lib ? { kind: lib.kind, url: lib.url, poster: lib.poster ?? lib.url, credit: lib.credit, license: lib.license, source_url: lib.source_url, source: lib.source } : pool.find((v) => !inReel.has(v.url) && (uses.get(v.url) ?? 0) < 2);
      if (!pick) continue;
      visual[k] = pick; inReel.add(pick.url); uses.set(pick.url, (uses.get(pick.url) ?? 0) + 1);
      if (lib) db("rpc/parallax_visual_used", { method: "POST", body: { vid: lib.id } }).catch(() => {});
    }
  }
  // Every newly approved shot joins the shared library.
  if (fresh_.length) await db("visuals?on_conflict=url", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: fresh_ }).catch((e) => errors.push(`library: ${String(e).slice(0, 80)}`));

  let saved = 0;
  for (let ri = 0; ri < reels.length; ri++) {
    const r = reels[ri];
    const scenes = r.scenes.slice(0, 6).map((s, si) => ({
      caption: s.caption.trim().slice(0, 120), sub: s.sub.trim().slice(0, 200) || null,
      stat: s.stat_value.trim() ? { value: s.stat_value.trim().slice(0, 16), label: s.stat_label.trim().slice(0, 60) } : null,
      visual: visual[`${ri}:${si}`] ?? null,
      layout: s.layout,
    }));
    const postId = postIds[ri];
    if (r.kind === "intro" || r.kind === "people") await db(`reels?goal_id=eq.${g.id}&kind=eq.${r.kind}`, { method: "DELETE", prefer: "return=minimal" });
    await db("reels", { method: "POST", prefer: "return=minimal", body: { goal_id: g.id, post_id: r.kind === "intro" || r.kind === "people" ? null : postId, kind: r.kind, title: r.title.slice(0, 120), scenes, score: r.strength, mood: r.mood } }).catch((e) => errors.push(String(e).slice(0, 120)));
    saved++;
  }
  await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { reels_at: new Date().toISOString() } });
  return { slug: g.slug, reels: saved, kinds: reels.map((r) => r.kind), visuals: Object.keys(visual).length, wanted: wants.length, errors: [...new Set(errors)].slice(0, 4) };
}

// Apply finished photo-editor batches. A failed judgement leaves the old videos in place and retries.
async function collect() {
  // Look at every pending batch (a few slow ones must not hide finished ones behind them), and
  // finish up to 3 per run: saving a goal's videos takes a while.
  const jobs = await db(`reel_jobs?status=eq.pending&select=*&order=created_at.asc&limit=40`);
  const out = [];
  const fmt = betaZodOutputFormat(Verdict);
  const t0 = Date.now();
  let finished = 0;
  for (const j of jobs) {
    const b = await claude.messages.batches.retrieve(j.batch_id);
    if (b.processing_status === "ended" && (finished >= 3 || Date.now() - t0 > 90_000)) continue;
    if (b.processing_status !== "ended") {
      // Stuck: nothing finished after 4 hours (Anthropic sometimes leaves a batch queued), or never
      // ended. Cancel it (unfinished requests aren't billed) so the next run submits it again.
      const age = Date.now() - new Date(j.created_at).getTime();
      if ((age > 4 * 3600_000 && (b.request_counts?.succeeded ?? 0) === 0) || age > 26 * 3600_000) {
        if (b.processing_status === "in_progress") await claude.messages.batches.cancel(j.batch_id).catch(() => {});
        await db(`reel_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed" } });
        // Submit the goal again right away, as the same kind of run (a full remake stays a full remake).
        await run(j.slug, !!j.fresh).catch(async () => { await db(`goals?id=eq.${j.goal_id}`, { method: "PATCH", prefer: "return=minimal", body: { reels_at: null } }); });
      }
      continue;
    }
    let verdict: z.infer<typeof Verdict> | null = null;
    for await (const r of await claude.messages.batches.results(j.batch_id)) {
      if (r.result.type !== "succeeded") continue;
      track("reels", true)(r.result.message);
      try { verdict = fmt.parse(r.result.message.content.map((c) => (c.type === "text" ? c.text : "")).join("")); } catch { /* unreadable */ }
    }
    if (!verdict) {
      await db(`reel_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "failed" } });
      await db(`goals?id=eq.${j.goal_id}`, { method: "PATCH", prefer: "return=minimal", body: { reels_at: null } });
      out.push({ slug: j.slug, note: "judgement failed; will retry" });
      continue;
    }
    finished++;
    out.push(await finalize({ id: j.goal_id, slug: j.slug }, j.reels, j.wants, j.cands, j.present, j.post_ids, verdict, j.fresh, [], j.pre ?? {}));
    await db(`reel_jobs?batch_id=eq.${j.batch_id}`, { method: "PATCH", prefer: "return=minimal", body: { status: "done" } });
  }
  return out;
}

// One-time move of media from Supabase Storage to R2. "move_media" copies files (resumable, about
// 100 s per call); "drop_old" deletes Supabase copies no longer referenced once the URLs are rewritten.
async function mediaInUse(): Promise<string[]> {
  const [reels, vis] = await Promise.all([db(`reels?select=scenes`), db(`visuals?select=url,poster`)]);
  const urls = new Set<string>();
  for (const r of reels) for (const sc of r.scenes ?? []) for (const u of [sc.visual?.url, sc.visual?.poster]) if (typeof u === "string") urls.add(u);
  for (const v of vis) for (const u of [v.url, v.poster]) if (typeof u === "string") urls.add(u);
  return [...urls];
}
async function moveMedia() {
  if (!r2) return { error: "R2 secrets are not set" };
  const t0 = Date.now(), todo = (await mediaInUse()).filter((u) => u.startsWith(OLD_PREFIX));
  let copied = 0, skipped = 0;
  const errors: string[] = [];
  for (const u of todo) {
    if (Date.now() - t0 > 100_000) break;
    const path = u.slice(OLD_PREFIX.length);
    const head = await fetch(`${R2_PUBLIC}/${path}`, { method: "HEAD" }).catch(() => null);
    if (head?.ok) { skipped++; continue; }
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`read ${r.status}`);
      await r2Put(path, await r.arrayBuffer(), (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0]);
      copied++;
    } catch (e) { errors.push(`${path}: ${e instanceof Error ? e.message : e}`); }
  }
  return { in_supabase: todo.length, copied, already_there: skipped, errors: errors.slice(0, 5), done: copied + skipped === todo.length, old_prefix: OLD_PREFIX, new_prefix: `${R2_PUBLIC}/` };
}
// Re-save existing Pixabay clips at the sharper size chosen by bestPixabayFile, at the same address.
// Resumable: a clip already at that size is skipped.
async function upgradeMedia() {
  if (!r2 || !PIXABAY) return { error: "R2 or Pixabay not configured" };
  const t0 = Date.now();
  const clips = [...new Set((await mediaInUse()).filter((u) => u.startsWith(`${R2_PUBLIC}/`) && /\/pv\d+\.mp4$/.test(u)))];
  let upgraded = 0, same = 0, left = 0;
  const errors: string[] = [];
  for (const u of clips) {
    if (Date.now() - t0 > 100_000) { left++; continue; }
    try {
      const id = /\/pv(\d+)\.mp4$/.exec(u)![1];
      const d = await getJson(`https://pixabay.com/api/videos/?key=${PIXABAY}&id=${id}`);
      const f = bestPixabayFile(d.hits?.[0]?.videos ?? {});
      if (!f) { same++; continue; }
      const now = Number((await fetch(u, { method: "HEAD" })).headers.get("content-length") ?? 0);
      // deno-lint-ignore no-explicit-any
      if (!((f as any).size > now)) { same++; continue; }
      const r = await fetch(f.url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`pixabay ${r.status}`);
      await r2Put(u.slice(R2_PUBLIC.length + 1), await r.arrayBuffer(), "video/mp4");
      upgraded++;
    } catch (e) { errors.push(`${u.slice(-30)}: ${e instanceof Error ? e.message : e}`); }
  }
  return { clips: clips.length, upgraded, already_sharpest: same, left, errors: errors.slice(0, 5), done: left === 0 };
}

async function dropOld() {
  if ((await db(`reel_jobs?status=eq.pending&select=batch_id`)).length) return { note: "video batches still running; try again after they finish" };
  const used = new Set((await mediaInUse()).filter((u) => u.startsWith(OLD_PREFIX)).map((u) => u.slice(OLD_PREFIX.length)));
  const names: string[] = [];
  const walk = async (prefix: string) => {
    for (let off = 0; ; off += 1000) {
      const items = await fetch(`${SB}/storage/v1/object/list/reels-media`, { method: "POST", headers: { Authorization: `Bearer ${SRK}`, apikey: SRK, "Content-Type": "application/json" }, body: JSON.stringify({ prefix, limit: 1000, offset: off }) }).then((r) => r.json());
      for (const it of items) { const p = prefix ? `${prefix}/${it.name}` : it.name; if (it.id) names.push(p); else await walk(p); }
      if (items.length < 1000) break;
    }
  };
  await walk("");
  const gone = names.filter((n) => !used.has(n));
  for (let i = 0; i < gone.length; i += 500) {
    await fetch(`${SB}/storage/v1/object/reels-media`, { method: "DELETE", headers: { Authorization: `Bearer ${SRK}`, apikey: SRK, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: gone.slice(i, i + 500) }) });
  }
  return { files: names.length, deleted: gone.length, kept_in_use: names.length - gone.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "batch_status") {
      const jobs = await db(`reel_jobs?status=eq.pending&select=batch_id,slug,created_at,fresh`);
      return json(await Promise.all(jobs.map(async (j: { batch_id: string; slug: string; created_at: string; fresh: boolean }) => { const b = await claude.messages.batches.retrieve(j.batch_id); return { slug: j.slug, fresh: j.fresh, created_at: j.created_at, status: b.processing_status, counts: b.request_counts }; })));
    }
    if (body.action === "move_media") return json(await moveMedia());
    if (body.action === "r2_check") {
      if (!r2) return json({ ok: false, why: R2_PUBLIC.includes("r2.cloudflarestorage.com") ? "R2_PUBLIC_URL is the API endpoint; use the bucket's public URL (pub-….r2.dev)" : "R2 secrets missing" });
      const put = await r2.fetch(`https://${R2_ACCOUNT}.r2.cloudflarestorage.com/${R2_BUCKET}/check.txt`, { method: "PUT", body: "ok", headers: { "Content-Type": "text/plain" } });
      const pub = put.ok ? await fetch(`${R2_PUBLIC}/check.txt`).then((r) => r.status).catch(() => 0) : 0;
      let sample = null;
      if (typeof body.path === "string") { const r = await fetch(`${R2_PUBLIC}/${body.path}`, { headers: { Range: "bytes=0-999" } }); sample = { status: r.status, type: r.headers.get("content-type"), range: r.headers.get("content-range"), cors: r.headers.get("access-control-allow-origin") }; await r.body?.cancel(); }
      return json({ sample, ok: put.ok && pub === 200, bucket: R2_BUCKET, upload: put.status, upload_error: put.ok ? null : (await put.text()).slice(0, 160), public_read: pub });
    }
    if (body.action === "drop_old") return json(await dropOld());
    if (body.action === "upgrade_media") return json(await upgradeMedia());
    const collected = await collect();
    if (body.collect_only === true) return json({ collected });
    return json({ collected, made: await run(body.slug, !!body.fresh, body.live === true) });
  } catch (e) {
    console.error("reels failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
