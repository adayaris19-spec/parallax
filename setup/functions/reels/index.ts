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

// A small preview of any Commons file (the API returns the original when it is under the asked width).
const commonsThumb = (u: string) => { const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^?]+)/.exec(u); return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/330px-${m[3]}` : u; };
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
    return { kind: "image", url: ii.thumburl ?? ii.url, poster: commonsThumb(String(ii.url)), credit: `${strip(md.Artist?.value).slice(0, 60) || "Unknown author"} via Wikimedia Commons`, license: lic, source_url: ii.descriptionurl ?? ii.url, source: "commons" };
  }).filter(Boolean).slice(0, 4) as Cand[];
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
// Clips already in any goal's videos (by their source id, since the same clip is copied per goal).
// A clip appears once across the whole feed, so the Watch tab never shows the same shot twice.
let usedClips = new Set<string>();
// Money as people say it: $20K, $1.5M, $2B.
const money = (n: number) => n >= 1e9 ? `$${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const clipId = (u: string) => /\b((?:p[vp]|xv)\d+)\b/.exec(u)?.[1] ?? /(photo-\d+-[0-9a-f]+)/.exec(u)?.[1] ?? u.split("?")[0];
async function pixabayVideos(q: string, n = 3, vtype = "film"): Promise<Cand[]> {
  if (!PIXABAY) return [];
  // Filmed footage only: animation brought cartoons and clip art into science videos.
  const d = await getJson(`https://pixabay.com/api/videos/?key=${PIXABAY}&q=${encodeURIComponent(q.slice(0, 90))}&video_type=${vtype}&safesearch=true&per_page=24`);
  // deno-lint-ignore no-explicit-any
  return (d.hits ?? []).map((v: any) => {
    const vs = v.videos ?? {};
    const f = bestPixabayFile(vs);
    const thumb = vs.medium?.thumbnail || f?.thumbnail || vs.small?.thumbnail || (v.picture_id ? `https://i.vimeocdn.com/video/${v.picture_id}_960x540.jpg` : "");
    if (!f || !thumb || (v.duration ?? 0) < 6) return null;
    if (usedClips.has(`pv${v.id}`)) return null;
    return { kind: "video", url: f.url, poster: thumb, credit: `${String(v.user ?? "Pixabay creator").slice(0, 50)} via Pixabay`, license: "Pixabay Content License", source_url: v.pageURL, source: "pixabay", landscape: (f.width ?? 0) > (f.height ?? 0), rehost: true, id: `pv${v.id}`, preview: vs.tiny?.thumbnail || vs.small?.thumbnail || thumb }; // the smallest preview: a third of the judging cost
  }).filter(Boolean).slice(0, n);
}
// Pexels: a larger free video library, strong on medicine and people at work (Pexels License: free to
// use; we credit and link anyway). Files are copied like Pixabay's. Used only when PEXELS_API_KEY is set.
const PEXELS = Deno.env.get("PEXELS_API_KEY") ?? "";
async function pexelsVideos(q: string, n = 3): Promise<Cand[]> {
  if (!PEXELS) return [];
  const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q.slice(0, 90))}&per_page=15&size=medium`, { headers: { Authorization: PEXELS }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`pexels answered ${r.status}`);
  const d = await r.json();
  // deno-lint-ignore no-explicit-any
  return (d.videos ?? []).map((v: any) => {
    if ((v.duration ?? 0) < 6 || usedClips.has(`xv${v.id}`) || !v.image) return null;
    // deno-lint-ignore no-explicit-any
    const f = (v.video_files ?? []).filter((x: any) => x.file_type === "video/mp4" && x.link && Math.min(x.width ?? 0, x.height ?? 0) >= 540 && Math.min(x.width ?? 0, x.height ?? 0) <= 1080)
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => Math.min(b.width, b.height) - Math.min(a.width, a.height))[0];
    if (!f) return null;
    const poster = `${String(v.image).split("?")[0]}?auto=compress&cs=tinysrgb&w=1280`;
    return { kind: "video", url: f.link, poster, preview: `${String(v.image).split("?")[0]}?auto=compress&cs=tinysrgb&w=480`, credit: `${String(v.user?.name ?? "Pexels creator").slice(0, 50)} via Pexels`, license: "Pexels License", source_url: v.url ?? "https://www.pexels.com", source: "pexels", landscape: (f.width ?? 0) > (f.height ?? 0), rehost: true, id: `xv${v.id}` };
  }).filter(Boolean).slice(0, n);
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
let unsplashLeft = -1;
async function unsplashPhotos(q: string): Promise<Cand[]> {
  if (!UNSPLASH) return [];
  const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&orientation=portrait&content_filter=high&per_page=6`, { headers: { Authorization: `Client-ID ${UNSPLASH}`, "Accept-Version": "v1" }, signal: AbortSignal.timeout(15000) });
  unsplashLeft = Number(r.headers.get("x-ratelimit-remaining") ?? -1);
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
  search: z.array(z.string()).describe("3 search terms for a stock video library, most specific first, each 1-3 plain words that libraries really have (\"mosquito biting skin\", \"surgeon operating\", \"petri dish\", \"rocket launch\"). The real subject, never an idea or a feeling."),
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

// The photo editor's rules, shared by new videos and repairs. Fit comes first: a beautiful shot that
// isn't about the scene is worse than no shot.
const EDITOR = `You are the photo editor for a science video channel about humanity's big goals. For each scene, pick the candidate a viewer would instantly see is ABOUT this scene: it must literally show the scene's subject or the goal's real-world subject (the disease and its patients, clinics and nurses, lab hands at work, the insect, the organ, the machine, the rocket, the place named). Many captions are abstract (a number, money, a deadline, "nobody has solved it"): for those, any strong shot of the goal's own world fits (for malaria: mosquitoes, bed nets, village clinics, blood tests; for fusion: reactors, plasma, magnets). Among on-topic candidates prefer footage where something is happening (people working, a procedure, machines moving, insects flying, a launch) over still or empty backgrounds, and cinematic shots (dramatic light, close detail, wide views) over ordinary ones.
Reject (-1) without exception: cartoons, animation, 3D characters or mascots, clip art, illustrations, infographics; posed portraits or random faces; food, drinks, pets, flowers, birds or landscapes unless the scene is literally about them; offices, laptops and phones; text, logos or watermarks; anything that could mislead (a different disease, organ or machine). A beautiful but unrelated shot scores at most 3.
Each video is shown as one still frame: imagine it moving.
The score is about FIT only: 9-10 shows exactly the scene's subject; 7-8 clearly shows the goal's real world even if not the exact detail named (surgeons operating for a transplant goal, lab hands at work for a lab result, real photos of patients, clinics or labs; the right target for abstract captions); 4-6 loosely related or generic; 1-3 unrelated. Use motion and beauty only to choose between candidates that fit about equally. Reject blurry, tiny or watermarked pictures.`;
const fits = (_c: Cand, score: number) => score >= 7;
const QUERY_MODEL = "claude-sonnet-5-5";
// Repairs are judged live, so by the cheaper model with the same rules (new videos use the batch, at half price).
const JUDGE_MODEL = Deno.env.get("REELS_JUDGE_MODEL") ?? "claude-sonnet-5-5";
let lastScores: Record<string, { pick: number; score: number; of: number }> = {};

// Up to 8 candidates for one scene from its search terms: filmed Pixabay footage first (NASA too
// for space goals), photos only if footage is scarce. Never a clip already in the feed.
async function gather(qs: string[], space: boolean, taken: Set<string>, errors: string[]): Promise<Cand[]> {
  const list: Cand[] = [];
  const seen = new Set<string>();
  const add = async (f: () => Promise<Cand[]>) => {
    try { for (const c of await f()) { const id = c.id ?? clipId(c.url); if (seen.has(id) || taken.has(id) || usedClips.has(id)) continue; seen.add(id); list.push(c); } }
    catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  };
  const terms = qs.map((q) => q.trim()).filter(Boolean).slice(0, 4);
  await Promise.all(terms.flatMap((q) => [add(() => pexelsVideos(q, 3)), add(() => pixabayVideos(q, 3))]));
  if (space) await Promise.all(terms.slice(0, 2).map((q) => add(() => nasaVideos(q))));
  // Real photos when footage is scarce (Unsplash, then Wikimedia Commons, which has real clinics,
  // mosquitoes and lab work from health agencies).
  // Always offered: stock footage searches often return near-misses (a basketball net for "mosquito net").
  if (terms[0]) await Promise.all([add(() => unsplashPhotos(terms[0])), ...(space ? [add(() => nasaImages(terms[0]))] : terms.map((q) => add(() => commons(q)))), add(() => pixabayPhotos(terms[1] ?? terms[0]))]);
  return [...list.filter((c) => c.kind === "video").slice(0, 8), ...list.filter((c) => c.kind === "image").slice(0, 8)].slice(0, 14);
}

// Find, judge and copy a fitting shot for each scene (live, not batched: used for repairs and for
// scenes the first pass left empty). Search terms are rewritten by a cheaper model when asked.
type Ask = { key: string; caption: string; sub?: string | null; search?: string[] };
async function pickVisuals(g: { slug: string; name: string }, asks: Ask[], space: boolean, taken: Set<string>, errors: string[], rewrite = false, avoid: string[] = []) {
  const out: Record<string, Cand & { score: number; query: string }> = {};
  if (!asks.length) return out;
  if (rewrite || asks.some((a) => !a.search?.length)) {
    const Terms = z.object({ items: z.array(z.object({ key: z.string(), search: z.array(z.string()) })) });
    const r = (await claude.beta.messages.stream({
      model: QUERY_MODEL, max_tokens: 8000, output_config: { effort: "low", format: betaZodOutputFormat(Terms) },
      system: `You find footage for short science videos about the goal "${g.name}". For each scene, write 4 search terms for stock video libraries (Pexels, Pixabay), most specific first. Each is 1-3 plain words for something stock libraries really film: the real-world subject of the scene or of the goal (patients, clinics, nurses, lab hands pipetting, a surgeon operating, mosquitoes, pills, an MRI scanner, wind turbines, a rocket launch, a factory line). The first term includes the goal's own key word (like "malaria clinic", "tuberculosis x-ray", "kidney transplant"), since archives of real health and science photos are searched by it. At least two of the 4 should be something happening (an action). Never abstract ideas, feelings, metaphors, numbers or text. When a caption is abstract (money, a deadline, a number), search for the goal's own core subject instead.${avoid.length ? ` These terms found nothing good before; try different ones: ${avoid.slice(0, 40).join(", ")}.` : ""}`,
      messages: [{ role: "user", content: asks.map((a) => `${a.key}: "${a.caption}"${a.sub ? ` (${a.sub})` : ""}`).join("\n") }],
    }).finalMessage().then(track("reels"))).parsed_output;
    for (const a of asks) a.search = r?.items.find((x) => x.key === a.key)?.search ?? a.search ?? [a.caption];
  }
  const cands = await Promise.all(asks.map((a) => gather(a.search!, space, taken, errors)));
  const blocks = await Promise.all(cands.map((l) => Promise.all(l.map((c) => asBlock(c.preview ?? c.poster)))));
  // Ten scenes per judgement keeps each call well under the picture limit.
  for (let from = 0; from < asks.length; from += 10) {
    const idx = asks.map((_, i) => i).slice(from, from + 10).filter((i) => blocks[i].some(Boolean));
    if (!idx.length) continue;
    // deno-lint-ignore no-explicit-any
    const content: any[] = [{ type: "text", text: EDITOR }];
    for (const i of idx) {
      content.push({ type: "text", text: `\nScene ${i}: "${asks[i].caption}"${asks[i].sub ? ` (${asks[i].sub})` : ""} in a video about ${g.name}` });
      cands[i].forEach((c, k) => { if (blocks[i][k]) { content.push({ type: "text", text: `Scene ${i}, candidate ${k} (${c.kind})` }); content.push(blocks[i][k]); } });
    }
    content.push({ type: "text", text: "One entry per scene; id = the scene number; pick -1 if nothing fits." });
    let verdict: z.infer<typeof Verdict> | null = null;
    try { verdict = (await claude.beta.messages.stream({ model: JUDGE_MODEL, max_tokens: 16000, output_config: { effort: "low", format: betaZodOutputFormat(Verdict) }, messages: [{ role: "user", content }] }).finalMessage().then(track("reels"))).parsed_output; }
    catch (e) {
      // One unreadable picture spoils the whole call: judge these scenes one at a time instead.
      errors.push(`judge: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      if (idx.length > 1) { for (const i of idx) { const one = await pickVisuals(g, [asks[i]], space, taken, errors, false); Object.assign(out, one); } }
      continue;
    }
    // One copy at a time: videos are big, and an edge function has little memory.
    for (const i of idx) await (async () => {
      const v = verdict?.items.find((x) => String(x.id).replace(/\D/g, "") === String(i));
      lastScores[asks[i].key] = { pick: v?.pick ?? -1, score: v?.score ?? 0, of: cands[i].length };
      const c = v && v.pick >= 0 && blocks[i][v.pick] ? cands[i][v.pick] : null;
      if (!c || !fits(c, v!.score)) return;
      const id = c.id ?? clipId(c.url);
      if (taken.has(id)) return;
      taken.add(id);
      let url = c.url;
      if (c.kind === "image" && !(await alive(url, /^image\//))) url = (await alive(c.poster, /^image\//)) ? c.poster : "";
      if (c.kind === "video" && !(await alive(url, /^video\//))) url = "";
      if (!url) return;
      let poster = c.poster;
      if (c.rehost) {
        try { url = await rehost({ ...c, url }, g.slug); poster = c.kind === "video" ? await rehost({ ...c, kind: "image", url: c.poster, id: `${c.id}-poster` }, g.slug) : url; }
        catch (e) { errors.push(`copy: ${e instanceof Error ? e.message : e}`); return; }
      }
      if (c.ping) fetch(c.ping, { headers: { Authorization: `Client-ID ${UNSPLASH}` } }).then((r) => r.body?.cancel()).catch(() => {});
      out[asks[i].key] = { kind: c.kind, url, poster, credit: c.credit, license: c.license, source_url: c.source_url, source: c.source, score: v!.score, query: asks[i].search!.join(" / ") };
    })();
  }
  return out;
}

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
    if (avoid.has(h.url) || h.uses >= 1 || usedClips.has(clipId(h.url))) continue; // each clip once across the feed
    const have = words(`${h.query} ${h.caption ?? ""}`);
    const shared = [...want].filter((w) => have.has(w)).length;
    if (shared >= 2 && shared / want.size >= 0.6) return h;
  }
  return null;
}

// Everything the scripts may say about a goal: its map, posts and real activity.
// deno-lint-ignore no-explicit-any
async function goalFacts(g: any, fresh: boolean) {
  // Real things happening on this goal, so a new goal's videos have events, not just an overview.
  const [evid, topIdeas, chals] = await Promise.all([
    db(`node_evidence?goal_id=eq.${g.id}&select=node_key,source,count,amount_cents,top&order=amount_cents.desc.nullslast&limit=8`).catch(() => []),
    db(`ideas?goal_id=eq.${g.id}&status=eq.open&select=title,pitch,test_low,test_high,borrowed_from&limit=4`).catch(() => []),
    db(`challenges?goal_id=eq.${g.id}&status=eq.open&select=title,useful&limit=3`).catch(() => []),
  ]);
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
REAL ACTIVITY (grants, trials, ideas, challenges; each a concrete event you can build a scene around):
${(evid as { source: string; count: number; amount_cents: number | null; top: { title: string; who: string; amount?: number; phase?: string }[] }[]).flatMap((e) => (e.top || []).slice(0, 2).map((t) => e.source === "grants" ? `- Grant: ${t.who} is funded to work on "${t.title}"${t.amount ? ` (${money(t.amount)} award)` : ""}` : `- Trial: ${t.who} is running "${t.title}"${t.phase ? ` (${t.phase})` : ""}`)).slice(0, 8).join("\n") || "- none found yet"}
${(topIdeas as { title: string; pitch: string; test_low: number | null; test_high: number | null; borrowed_from: string | null }[]).map((i) => `- Idea to try: ${i.title}. ${i.pitch.split(/(?<=\.)\s/)[0]}${i.test_high ? ` First test costs about ${money(i.test_low ?? 0)}–${money(i.test_high)}.` : ""}${i.borrowed_from ? ` Borrowed from ${i.borrowed_from}.` : ""}`).join("\n")}
${(chals as { title: string; useful: string }[]).map((c) => `- Open challenge anyone can take on: ${c.title}. ${c.useful.split(/(?<=\.)\s/)[0]}`).join("\n")}
Already made (skip these): ${fresh ? "none" : [...done].join(", ") || "none"}`;
  return { facts, posts, have, done };
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
  // New and remade videos are written footage first (cinematic clips, then the script around them).
  if (!live) return footageFirst(g.slug);
  usedClips = new Set(((await db(`reels?select=scenes`).catch(() => [])) as { scenes: { visual?: { url?: string } }[] }[]).flatMap((r) => (r.scenes || []).map((x) => x.visual?.url ? clipId(x.visual.url) : "").filter(Boolean)));
  const { facts, posts, have, done } = await goalFacts(g, fresh);

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
- Something must happen: build each reel around concrete events from the facts (a grant, a trial, a result, a broken promise, an idea someone could test for a few thousand dollars, an open challenge), not a general overview.
- Visual: describe a real, filmable shot that stock libraries have, with motion and action, specific to THIS goal's subject ("a person in a wheelchair standing up in a robotic exoskeleton", "an MRI scanner sliding a patient in", "wind turbines in fog at dawn", "rocket engine test fire, night"). Never abstract ideas. Avoid generic lab b-roll ("scientist in a lab", "microscope", "test tubes", "DNA helix", "data on a screen") unless that exact thing is the scene's point. Every scene in a reel needs a different kind of shot: vary subject and scale (wide, close-up, people, places, machines).
- Something happening: at least one scene in every four (more is better) needs a shot full of action: people at work, hands doing a procedure, machines moving, a launch, insects in flight, crowds, flowing liquid. Still or empty backgrounds are boring.
- Health and biology goals: show the real world of the disease and its care (patients, clinics, nurses, lab hands pipetting, the insect that spreads it, a surgery), never a pretty landscape, a random face, food or animals that aren't the subject.`,
    messages: [{ role: "user", content: facts }],
  }).finalMessage().then(track("reels"))).parsed_output;
  if (!plan) return { slug: g.slug, note: "no plan" };
  const reels = plan.reels.filter((r) => fresh || !done.has(`${r.kind}:${r.post_id || 0}`) || r.kind === "intro").slice(0, 4);

  // Visuals: find candidates for each scene that wants one, then let Claude keep only good ones.
  const wants: { r: number; s: number; q: string; search: string[] }[] = [];
  reels.forEach((r, ri) => r.scenes.forEach((s, si) => { if (s.visual.trim()) wants.push({ r: ri, s: si, q: s.visual, search: s.search?.length ? s.search : [s.visual] }); }));
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
  const cands: Cand[][] = await Promise.all(wants.map((w) => gather(w.search, plan.space, new Set(), errors)));
  const blocks = await Promise.all(cands.map((l) => Promise.all(l.map((c) => asBlock(c.preview ?? c.poster)))));
  // deno-lint-ignore no-explicit-any
  const content: any[] = [{ type: "text", text: EDITOR }];
  wants.forEach((w, i) => {
    content.push({ type: "text", text: `\nScene ${i}: "${reels[w.r].scenes[w.s].caption}" in a video about ${g.name} (looking for: ${w.q})` });
    cands[i].forEach((c, k) => { if (blocks[i][k]) { content.push({ type: "text", text: `Scene ${i}, candidate ${k} (${c.kind}${c.landscape ? ", landscape: the centre will be cropped to a tall phone screen" : ""})` }); content.push(blocks[i][k]); } });
  });
  content.push({ type: "text", text: "One entry per scene; id = the scene number." });
  const present = blocks.map((b) => b.map(Boolean));
  const postIds = reels.map((r) => (r.post_id && posts.some((p: { id: number }) => p.id === r.post_id) ? r.post_id : null));
  // The photo editor's judgement goes through the Message Batches API (half price, same model and
  // standards); a later call applies it. {"live": true} judges at once instead, and so does a new
  // goal's first set of videos (the batch queue can take hours; one small call costs cents).
  if (!present.some((b) => b.some(Boolean))) return finalize(g, reels, wants, cands, present, postIds, null, fresh, errors, pre, plan.space);
  if (!live && have.length) {
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
  return finalize(g, reels, wants, cands, present, postIds, verdict, fresh, errors, pre, plan.space);
}

type Reel = z.infer<typeof Plan>["reels"][number];
// Keep the visuals the photo editor approved (8/10 or better), copy Pixabay files, save the reels.
async function finalize(g: { id: number; slug: string }, reels: Reel[], wants: { r: number; s: number; q: string; search?: string[] }[], cands: Cand[][], present: boolean[][], postIds: (number | null)[], verdict: z.infer<typeof Verdict> | null, fresh: boolean, errors: string[], pre: Record<string, Cand & { lib?: number }> = {}, space = false) {
  if (fresh) await db(`reels?goal_id=eq.${g.id}`, { method: "DELETE", prefer: "return=minimal" });
  const visual: Record<string, Cand> = {};
  for (const [k, v] of Object.entries(pre)) {
    const { lib, ...c } = v;
    visual[k] = c;
    if (lib) db(`rpc/parallax_visual_used`, { method: "POST", body: { vid: lib } }).catch(() => {});
  }
  const fresh_: { url: string; poster: string; kind: string; credit: string; license: string; source_url: string; source: string; query: string; caption: string; score: number }[] = [];
  // Every clip once across the whole feed: not in another goal's videos, not twice in this run.
  const taken = new Set<string>(Object.values(visual).map((v) => clipId(v.url)));
  const free = (c: Cand) => { const id = c.id ?? clipId(c.url); return !taken.has(id) && !usedClips.has(id); };
  for (let i = 0; i < wants.length; i++) {
    const v = verdict?.items.find((x) => String(x.id).replace(/\D/g, "") === String(i));
    const c = v && v.pick >= 0 && present[i]?.[v.pick] && fits(cands[i][v.pick], v.score) && free(cands[i][v.pick]) ? cands[i][v.pick] : null; // moving footage at 7/10 beats a plain background
    if (!c) continue;
    taken.add(c.id ?? clipId(c.url));
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
  // Scenes the editor left empty get a second, live search with fresh search terms, judged by the
  // same rules. Never an unjudged clip: a scene with nothing fitting shows on the goal's colours.
  const empty: Ask[] = [];
  reels.forEach((r, ri) => r.scenes.forEach((sc, si) => { if (!visual[`${ri}:${si}`] && sc.visual?.trim()) empty.push({ key: `${ri}:${si}`, caption: sc.caption, sub: sc.sub }); }));
  if (empty.length) {
    const tried = wants.flatMap((w) => w.search ?? []);
    const name = (await db(`goals?id=eq.${g.id}&select=name`).catch(() => []))[0]?.name ?? g.slug;
    try {
      const got = await pickVisuals({ slug: g.slug, name }, empty.slice(0, 8), space, taken, errors, true, tried);
      for (const [k, v] of Object.entries(got)) {
        const { score, query, ...c } = v;
        visual[k] = c;
        const [ri, si] = k.split(":").map(Number);
        fresh_.push({ ...c, query, caption: reels[ri].scenes[si].caption, score });
      }
    } catch (e) { errors.push(`rescue: ${e instanceof Error ? e.message.slice(0, 100) : e}`); }
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
      if ((age > 3.9 * 3600_000 && /* 4 hours, less a few minutes so the hourly run 4 hours later counts */ (b.request_counts?.succeeded ?? 0) === 0) || age > 26 * 3600_000) {
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
    out.push(await finalize({ id: j.goal_id, slug: j.slug }, j.reels, j.wants, j.cands, j.present, j.post_ids, verdict, j.fresh, [], j.pre ?? {}, (j.cands ?? []).flat().some((c: Cand) => c?.source === "nasa")));
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

async function revisual(items: { reel_id: number; si: number }[], space: boolean, avoid: string[]) {
  const ids = [...new Set(items.map((x) => Number(x.reel_id)))];
  const rows: { id: number; goal_id: number; scenes: { caption: string; sub: string | null; visual: Cand | null }[] }[] = await db(`reels?id=in.(${ids.join(",")})&select=id,goal_id,scenes`);
  const goalIds = [...new Set(rows.map((r) => r.goal_id))];
  if (goalIds.length !== 1) return { error: "one goal per call" };
  const g = (await db(`goals?id=eq.${goalIds[0]}&select=slug,name`))[0];
  usedClips = new Set(((await db(`reels?select=scenes`)) as { scenes: { visual?: { url?: string } }[] }[]).flatMap((r) => (r.scenes || []).map((x) => x.visual?.url ? clipId(x.visual.url) : "").filter(Boolean)));
  const asks: Ask[] = items.slice(0, 8).map((x) => { const sc = rows.find((r) => r.id === Number(x.reel_id))?.scenes[x.si]; return sc ? { key: `${x.reel_id}:${x.si}`, caption: sc.caption, sub: sc.sub } : null; }).filter(Boolean) as Ask[];
  const errors: string[] = [];
  const got = await pickVisuals(g, asks, space, new Set(), errors, true, avoid);
  const gone: string[] = [];
  for (const r of rows) {
    let changed = false;
    r.scenes.forEach((sc, si) => {
      const v = got[`${r.id}:${si}`];
      if (!v) return;
      if (sc.visual?.url) gone.push(sc.visual.url);
      const { score: _s, query: _q, ...c } = v;
      sc.visual = c; changed = true;
    });
    if (changed) await db(`reels?id=eq.${r.id}`, { method: "PATCH", prefer: "return=minimal", body: { scenes: r.scenes } });
  }
  if (gone.length) await db(`visuals?url=in.(${gone.map((u) => `"${u}"`).join(",")})`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
  const fresh = Object.entries(got).map(([k, v]) => ({ url: v.url, poster: v.poster, kind: v.kind, credit: v.credit, license: v.license, source_url: v.source_url, source: v.source, query: v.query, caption: asks.find((a) => a.key === k)?.caption ?? null, score: v.score }));
  if (fresh.length) await db("visuals?on_conflict=url", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: fresh }).catch(() => {});
  return { slug: g.slug, unsplash_left: unsplashLeft, replaced: Object.keys(got), failed: asks.filter((a) => !got[a.key]).map((a) => ({ key: a.key, caption: a.caption, tried: a.search, best: lastScores[a.key] })), errors: [...new Set(errors)].slice(0, 4) };
}

// ---------------------------------------------------------------------------------------------
// Footage first. Stock libraries have plenty of space footage and little for most other goals, so
// writing a script and then hunting for each scene's shot left scenes with wrong or no pictures.
// Instead: gather the goal's real world first (many searches), judge every candidate once, then
// write a short script around the approved shots only. Every scene has a shot that fits it.
const ShotList = z.object({ terms: z.array(z.string()) });
const ShotVerdict = z.object({ items: z.array(z.object({ id: z.number(), shows: z.string().describe("What the picture literally shows, at most 10 words."), fit: z.number().describe("1-10: how clearly it shows this goal's real world."), quality: z.number().describe("1-10: sharp, well composed, striking on a phone."), action: z.boolean().describe("Something visibly happening (people working, a procedure, motion)."), dynamic: z.number().describe("1-10: how dynamic and eye-catching it would be moving: fly-throughs, streams of particles, bursts, fast motion, strong colour and contrast score high; a static object on a plain background scores low.") })) });
const ScriptScene = z.object({
  caption: z.string().describe("At most 9 words. Big text on screen."),
  sub: z.string().describe("Optional second line, at most 16 words. Empty if not needed."),
  stat_value: z.string().describe("Optional striking number from the facts. Empty if none."),
  stat_label: z.string().describe("What the number means, at most 6 words. Empty if no number."),
  layout: z.enum(["bottom", "center", "top", "number", "quote"]),
  shot: z.number().describe("The approved shot behind this scene (its S number). Each shot at most once in the whole set."),
});
const Script = z.object({ reels: z.array(z.object({
  kind: z.enum(["intro", "breakthrough", "setback", "promise", "people"]),
  mood: z.enum(["epic", "uplifting", "tense", "bittersweet", "mysterious", "calm"]),
  post_id: z.number().describe("The post this reel is about, or 0 for intro and people."),
  title: z.string().describe("At most 8 words."),
  hook_score: z.number().describe("Honest 1-10: would a stranger stop scrolling at scene 1 and watch to the end?"),
  scenes: z.array(ScriptScene).describe("4 or 5 scenes."),
})) });

async function footageFirst(slug: string, opts: { dry?: boolean } = {}) {
  const g = (await db(`goals?slug=eq.${encodeURIComponent(slug)}&select=id,slug,handle,name,tagline,summary,progress,horizon_low,horizon_high,bottleneck_key,papers_count,reels_at`))[0];
  if (!g) return { error: "no such goal" };
  // Clips in other goals' videos stay off limits; this goal's own old clips may be reused.
  usedClips = new Set(((await db(`reels?goal_id=neq.${g.id}&select=scenes`)) as { scenes: { visual?: { url?: string } }[] }[]).flatMap((r) => (r.scenes || []).map((x) => x.visual?.url ? clipId(x.visual.url) : "").filter(Boolean)));
  const { facts, posts } = await goalFacts(g, true);
  const space = /mars|moon|space|orbit|asteroid|planet|rocket|satellite/i.test(`${g.slug} ${g.name}`);
  const errors: string[] = [];

  // 1. Search terms covering the goal's real, filmable world.
  const terms = (await claude.beta.messages.stream({
    model: QUERY_MODEL, max_tokens: 4000, output_config: { effort: "low", format: betaZodOutputFormat(ShotList) },
    system: `You find footage for cinematic science videos about the goal "${g.name}". The look is animated 3D science footage (cells, molecules, viruses, DNA, neurons, blood vessels, plasma, particles, glowing technology, planets) plus a few striking real clips of the goal's own subject. List 16 search terms for the Pixabay video library, each 1-3 plain words. 12 should find animated science footage of this goal's world (for malaria: "red blood cells", "parasite", "blood vessel", "virus 3d", "immune cells"; for fusion: "plasma", "energy particles", "magnetic field"). Up to 4 may find real footage only where the subject itself is filmed (for malaria: "mosquito"; for Mars: "rocket launch"; for grid storage: "wind turbines"). Nothing abstract, no feelings or metaphors.`,
    messages: [{ role: "user", content: facts.slice(0, 2500) }],
  }).finalMessage().then(track("reels"))).parsed_output?.terms.slice(0, 16) ?? [];
  if (terms.length < 6) return { slug, error: "no search terms" };

  // 2. Candidates from every term.
  const pool: Cand[] = [];
  const seen = new Set<string>();
  const add = async (f: () => Promise<Cand[]>) => {
    try { for (const c of await f()) { const id = c.id ?? clipId(c.url); if (seen.has(id) || usedClips.has(id)) continue; seen.add(id); pool.push(c); } }
    catch (e) { errors.push(e instanceof Error ? e.message.slice(0, 80) : String(e)); }
  };
  // Moving footage only: animated science clips and real clips (no photos, which looked flat).
  await Promise.all(terms.map((q, i) => Promise.all([
    add(() => pixabayVideos(q, 6, "all")),
    ...(space && i < 8 ? [add(() => nasaVideos(q))] : []),
  ])));
  const cands = pool.slice(0, 84);
  const blocks = await Promise.all(cands.map((c) => asBlock(c.preview ?? c.poster)));

  // 3. Judge every candidate once (25 per call).
  const judged: { c: Cand; shows: string; fit: number; quality: number; action: boolean; dynamic: number }[] = [];
  const ids = cands.map((_, i) => i).filter((i) => blocks[i]);
  const parts: number[][] = [];
  for (let from = 0; from < ids.length; from += 21) parts.push(ids.slice(from, from + 21));
  await Promise.all(parts.map(async (part) => {
    // deno-lint-ignore no-explicit-any
    const content: any[] = [{ type: "text", text: `You pick footage for cinematic science videos about "${g.name}". The look: animated 3D science visuals (cells, molecules, viruses, DNA, neurons, blood vessels, plasma, particles, glowing technology, planets) and striking real footage of the goal's own subject. For each clip (shown as one still frame) say what it literally shows, how clearly it relates to this goal's science or subject (fit), how cinematic, rich and beautiful it is full screen on a phone (quality), and how dynamic and eye-catching it would be in motion (dynamic). Fit 1 and quality 1 for cartoons, characters with faces, mascots, clip art, flat or childish illustrations, labelled diagrams, text and logos. Quality 3 or less for documentary snapshots: rooms, beds, hospital wards, X-ray films, offices, people posing or at computers, food, pets, unrelated landscapes.` }];
    for (const i of part) { content.push({ type: "text", text: `Picture ${i} (${cands[i].kind})` }); content.push(blocks[i]); }
    try {
      const v = (await claude.beta.messages.stream({ model: JUDGE_MODEL, max_tokens: 8000, output_config: { effort: "low", format: betaZodOutputFormat(ShotVerdict) }, messages: [{ role: "user", content }] }).finalMessage().then(track("reels"))).parsed_output;
      for (const it of v?.items ?? []) if (part.includes(it.id)) judged.push({ c: cands[it.id], shows: it.shows, fit: it.fit, quality: it.quality, action: it.action, dynamic: it.dynamic });
    } catch (e) { errors.push(`judge: ${e instanceof Error ? e.message.slice(0, 80) : e}`); }
  }));
  const strict = (j: { fit: number; quality: number; dynamic: number }) => j.dynamic >= 5 && ((j.fit >= 6 && j.quality >= 7) || (j.fit >= 8 && j.quality >= 6));
  const rank = (j: { fit: number; quality: number; dynamic: number }) => j.fit + j.quality + j.dynamic * 1.5;
  // No look-alikes: one clip per creator series (Pixabay ids close together from the same creator),
  // none whose description matches a clip already kept or one in another goal's videos.
  const pvNum = (c: Cand) => Number(/^pv(\d+)$/.exec(c.id ?? "")?.[1] ?? NaN);
  const others: string[] = ((await db(`visuals?select=caption,url&order=created_at.desc&limit=600`).catch(() => [])) as { caption: string | null; url: string }[])
    .filter((v) => v.caption && usedClips.has(clipId(v.url))).map((v) => v.caption!);
  const otherIds = [...usedClips].map((x) => Number(/^pv(\d+)$/.exec(x)?.[1] ?? NaN)).filter((n) => !isNaN(n));
  const alike = (a: string, b: string) => { const A = words(a), B = words(b); const shared = [...A].filter((w) => B.has(w)).length; return shared / Math.max(1, Math.min(A.size, B.size)) >= 0.6; };
  const shots: typeof judged = [];
  for (const j of judged.filter(strict).sort((a, b) => rank(b) - rank(a))) {
    const n = pvNum(j.c);
    if (!isNaN(n) && otherIds.some((m) => Math.abs(m - n) < 40)) continue;
    if (shots.some((k) => (!isNaN(n) && k.c.credit === j.c.credit && Math.abs(pvNum(k.c) - n) < 400) || alike(k.shows, j.shows))) continue;
    if (others.some((o) => alike(o, j.shows))) continue;
    shots.push(j);
    if (shots.length >= 22) break;
  }
  const verdicts = opts.dry ? judged.map((j) => ({ fit: j.fit, quality: j.quality, dynamic: j.dynamic, action: j.action, kind: j.c.kind, source: j.c.source, shows: j.shows, poster: j.c.preview ?? j.c.poster })) : undefined;
  if (shots.length < 8) return { slug, error: "too few good shots", found: shots.length, judged: judged.length, candidates: cands.length, terms, verdicts, errors: [...new Set(errors)].slice(0, 5) };

  // 4. The script, written around the approved shots.
  const list = shots.map((x, i) => `S${i} [${x.c.kind}${x.action ? ", action" : ""}] ${x.shows}`).join("\n");
  const script = (await claude.beta.messages.stream({
    model: MODEL, max_tokens: 32000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(Script) },
    system: `You write short vertical videos for Parallax, a feed of humanity's big goals. Captions only, no voice, over real footage.
Use ONLY the facts given. Never invent numbers, names, dates or events.
Write 2 or 3 reels of 4-5 scenes: always one intro, then only stories strong enough to hold a stranger.
What makes people watch:
- Scene 1 is a hook: a stark contrast, a startling concrete fact, or an open question ("A 100-year-old vaccine still can't stop it"). Never the goal's name, a definition or a summary.
- Every reel is one story with tension: a problem, the stakes for real people, a turn (what changed, what failed, who is trying something), and an ending that leaves a question or a next step.
- Each caption is a punch, at most 9 words, spoken style. Concrete nouns and numbers beat adjectives. The sub line adds the detail.
- Never: "revolutionary", "game-changer", "unlock", "the future of", "imagine", "journey", "landscape", "crucial", "key", vague words like "progress is being made".
Shots: every scene uses one approved clip (S number), each at most once. Animated science clips (cells, particles, molecules) suit captions about the science; real clips go where the caption is about that very thing. Never a clip that contradicts the caption. Vary them: never two of the same kind in a row, and open every reel on the most dynamic, eye-catching clip that fits.
Score each reel's hook honestly; a reel under 7 is not worth making.`,
    messages: [{ role: "user", content: `${facts}\n\nAPPROVED SHOTS (${shots.length}; make ${shots.length >= 14 ? "up to 3 reels" : shots.length >= 10 ? "2 reels" : "1 intro reel"}):\n${list}` }],
  }).finalMessage().then(track("reels"))).parsed_output;
  if (!script) return { slug, error: "no script" };
  const reels = script.reels.filter((r) => r.kind === "intro" || r.hook_score >= 7).slice(0, 3);
  const usedShot = new Set<number>();
  const preview = reels.map((r) => ({ kind: r.kind, title: r.title, hook: r.hook_score, scenes: r.scenes.slice(0, 5).map((sc) => {
    const ok = sc.shot >= 0 && sc.shot < shots.length && !usedShot.has(sc.shot);
    if (ok) usedShot.add(sc.shot);
    return { caption: sc.caption, sub: sc.sub, shot: ok ? sc.shot : -1, shows: ok ? shots[sc.shot].shows : null, poster: ok ? (shots[sc.shot].c.preview ?? shots[sc.shot].c.poster) : null };
  }) }));
  if (opts.dry) return { slug, terms, candidates: cands.length, approved: shots.length, verdicts, reels: preview, errors: [...new Set(errors)].slice(0, 5) };

  // 5. Copy the chosen files and save, replacing the goal's videos.
  const visualOf = new Map<number, Cand>();
  const copy = async (i: number) => {
    const c = shots[i].c;
    try {
      let url = c.url, poster = c.poster;
      if (c.kind === "image" && !(await alive(url, /^image\//))) url = (await alive(c.poster, /^image\//)) ? c.poster : "";
      if (c.kind === "video" && !(await alive(url, /^video\//))) url = "";
      if (!url) { errors.push(`dead: ${c.source}`); return; }
      if (c.rehost) { url = await rehost({ ...c, url }, g.slug); poster = c.kind === "video" ? await rehost({ ...c, kind: "image", url: c.poster, id: `${c.id}-poster` }, g.slug) : url; }
      if (c.ping) fetch(c.ping, { headers: { Authorization: `Client-ID ${UNSPLASH}` } }).then((r) => r.body?.cancel()).catch(() => {});
      visualOf.set(i, { kind: c.kind, url, poster, credit: c.credit, license: c.license, source_url: c.source_url, source: c.source });
    } catch (e) { errors.push(`copy: ${e instanceof Error ? e.message.slice(0, 80) : e}`); }
  };
  for (const i of usedShot) await copy(i);
  // A shot that failed to copy gives its scene the next unused approved shot, never a blank.
  for (const r of preview) for (const sc of r.scenes) {
    if (sc.shot >= 0 && visualOf.has(sc.shot)) continue;
    for (let j = 0; j < shots.length; j++) {
      if (usedShot.has(j)) continue;
      usedShot.add(j);
      await copy(j);
      if (visualOf.has(j)) { sc.shot = j; sc.shows = shots[j].shows; break; }
    }
  }
  await db(`reels?goal_id=eq.${g.id}`, { method: "DELETE", prefer: "return=minimal" });
  const postIds = new Set(posts.map((p: { id: number }) => p.id));
  for (const r of reels) {
    const scenes = r.scenes.slice(0, 5).map((sc, k) => ({
      caption: sc.caption.trim().slice(0, 120), sub: sc.sub.trim().slice(0, 200) || null,
      stat: sc.stat_value.trim() ? { value: sc.stat_value.trim().slice(0, 16), label: sc.stat_label.trim().slice(0, 60) } : null,
      visual: preview[reels.indexOf(r)].scenes[k].shot >= 0 ? visualOf.get(preview[reels.indexOf(r)].scenes[k].shot) ?? null : null,
      layout: sc.layout,
    }));
    await db("reels", { method: "POST", prefer: "return=minimal", body: { goal_id: g.id, post_id: r.kind === "intro" || r.kind === "people" || !postIds.has(r.post_id) ? null : r.post_id, kind: r.kind, title: r.title.slice(0, 120), scenes, score: r.hook_score, mood: r.mood } });
  }
  const lib = [...usedShot].filter((i) => visualOf.has(i)).map((i) => { const v = visualOf.get(i)!; return { url: v.url, poster: v.poster, kind: v.kind, credit: v.credit, license: v.license, source_url: v.source_url, source: v.source, query: shots[i].shows, caption: shots[i].shows, score: shots[i].fit }; });
  if (lib.length) await db("visuals?on_conflict=url", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: lib }).catch(() => {});
  await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { reels_at: new Date().toISOString() } });
  return { slug, terms, candidates: cands.length, approved: shots.length, reels: preview.map((r) => ({ kind: r.kind, title: r.title, hook: r.hook, scenes: r.scenes.map((x) => `${x.caption} | ${x.shows ?? "NO SHOT"}`) })), errors: [...new Set(errors)].slice(0, 5) };
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
    if (body.action === "clip_check") {
      const rows = await db(`reels?select=scenes`);
      const ids = new Set((rows as { scenes: { visual?: { url?: string } }[] }[]).flatMap((r) => (r.scenes || []).map((x) => x.visual?.url ? clipId(x.visual.url) : "").filter(Boolean)));
      return json({ reels: rows.length, clips: ids.size, sample: [...ids].slice(0, 5) });
    }
    if (body.action === "upgrade_media") return json(await upgradeMedia());
    // Repair: new shots for chosen scenes only ({items: [{reel_id, si}]}, one goal per call), found
    // and judged by the editor's rules. Replaced shots leave the library so they're never reused.
    // Footage first: {"action": "footage_first", "slug": "end-malaria", "dry": true} previews without saving.
    if (body.action === "footage_first" && typeof body.slug === "string") return json(await footageFirst(body.slug, { dry: body.dry === true }));
    if (body.action === "revisual" && Array.isArray(body.items)) return json(await revisual(body.items, body.space === true, Array.isArray(body.avoid) ? body.avoid : []));
    // Admin review: what the footage search finds for some terms, as pictures.
    if (body.action === "peek" && Array.isArray(body.terms)) {
      const errs: string[] = [];
      const c = body.vtype ? (await Promise.all((body.terms as string[]).map((q) => pixabayVideos(q, 4, String(body.vtype))))).flat() : await gather(body.terms, body.space === true, new Set(), errs);
      return json({ errors: errs, unsplash_left: unsplashLeft, items: await Promise.all(c.map(async (x) => { const block = await asBlock(x.preview ?? x.poster); return { id: x.id, kind: x.kind, source: x.source, block, why: block ? null : await fetch(x.preview ?? x.poster, { headers: { "User-Agent": `Parallax/1.0 (${MAIL})` } }).then((r) => `${r.status} ${r.headers.get("content-type")} ${r.headers.get("content-length")} ${x.preview ?? x.poster}`).catch((e) => String(e)) }; })) });
    }
    // Admin review: our own stored posters as data, for checking the videos by eye.
    if (body.action === "posters" && Array.isArray(body.urls)) {
      const urls = (body.urls as string[]).filter((u) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 40);
      return json(await Promise.all(urls.map(async (u) => ({ url: u, block: await asBlock(u) }))));
    }
    const collected = await collect();
    if (body.collect_only === true) return json({ collected });
    return json({ collected, made: await run(body.slug, !!body.fresh, body.live === true) });
  } catch (e) {
    console.error("reels failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
