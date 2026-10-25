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
async function pixabayVideos(q: string): Promise<Cand[]> {
  if (!PIXABAY) return [];
  const d = await getJson(`https://pixabay.com/api/videos/?key=${PIXABAY}&q=${encodeURIComponent(q.slice(0, 90))}&safesearch=true&per_page=8`);
  // deno-lint-ignore no-explicit-any
  return (d.hits ?? []).map((v: any) => {
    const vs = v.videos ?? {};
    const f = [vs.medium, vs.small, vs.large].find((x) => x?.url && (x.size ?? 0) < 25_000_000 && (x.height ?? 0) >= 540);
    const thumb = f?.thumbnail || vs.medium?.thumbnail || vs.small?.thumbnail || (v.picture_id ? `https://i.vimeocdn.com/video/${v.picture_id}_960x540.jpg` : "");
    if (!f || !thumb || (v.duration ?? 0) < 6) return null;
    return { kind: "video", url: f.url, poster: thumb, credit: `${String(v.user ?? "Pixabay creator").slice(0, 50)} via Pixabay`, license: "Pixabay Content License", source_url: v.pageURL, source: "pixabay", landscape: (f.width ?? 0) > (f.height ?? 0), rehost: true, id: `pv${v.id}`, preview: vs.tiny?.thumbnail || thumb };
  }).filter(Boolean).slice(0, 2);
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
    kind: "image", url: `${p.urls.raw}&w=1080&h=1920&fit=crop&crop=entropy&q=80&fm=jpg`, poster: `${p.urls.raw}&w=320&q=70&fm=jpg`,
    credit: `${String(p.user?.name ?? "Unsplash photographer").slice(0, 50)} on Unsplash`, license: "Unsplash License",
    source_url: `${p.links?.html ?? "https://unsplash.com"}?${UTM}`, source: "unsplash", ping: p.links?.download_location,
  }));
}

// Copy a file into Supabase Storage and return its public address.
async function rehost(c: Cand, folder: string) {
  const r = await fetch(c.url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok || !r.body) throw new Error(`copy failed ${r.status}`);
  const type = (r.headers.get("content-type") ?? (c.kind === "video" ? "video/mp4" : "image/jpeg")).split(";")[0];
  const path = `${folder}/${c.id}.${c.kind === "video" ? "mp4" : "jpg"}`;
  const up = await fetch(`${SB}/storage/v1/object/reels-media/${path}`, { method: "POST", headers: { Authorization: `Bearer ${SRK}`, apikey: SRK, "Content-Type": type, "x-upsert": "true", "cache-control": "max-age=31536000" }, body: r.body, signal: AbortSignal.timeout(90000) });
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

async function run(slug?: string, fresh = false) {
  const goals = await db(`goals?status=eq.ready&select=id,slug,handle,name,tagline,summary,progress,horizon_low,horizon_high,bottleneck_key,papers_count,reels_at${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ""}&order=reels_at.asc.nullsfirst`);
  // Remake a goal's videos only when there is something new (at most weekly), or monthly otherwise.
  const latest = slug ? [] : await db(`posts?kind=neq.mapped&select=goal_id,created_at&order=created_at.desc&limit=500`);
  const newest = (id: number) => latest.find((p: { goal_id: number }) => p.goal_id === id)?.created_at;
  const due = (x: { id: number; reels_at: string | null }) => {
    if (!x.reels_at) return true;
    const age = Date.now() - new Date(x.reels_at).getTime(), n = newest(x.id);
    return age > 30 * DAY || (age > 7 * DAY && !!n && n > x.reels_at);
  };
  const att = slug ? new Map() : await attention();
  const g = slug ? goals[0] : goals.filter((x: { id: number }) => (att.get(x.id) ?? 0) > 0).sort((a: { id: number }, b: { id: number }) => (att.get(b.id) ?? 0) - (att.get(a.id) ?? 0)).find(due);
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
Progress ${Math.round((g.progress ?? 0) * 100)}%. ${nodes.length} problems: ${solved} solved, ${blocked} blocked. Estimate: ${g.horizon_low ?? "?"}-${g.horizon_high ?? "?"} years at today's pace.
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
Use ONLY the facts given. Never invent numbers, names, dates or events. Numbers on screen must appear in the facts.`,
    messages: [{ role: "user", content: facts }],
  }).finalMessage().then(track("reels"))).parsed_output;
  if (!plan) return { slug: g.slug, note: "no plan" };
  const reels = plan.reels.filter((r) => fresh || !done.has(`${r.kind}:${r.post_id || 0}`) || r.kind === "intro").slice(0, 4);
  if (fresh) await db(`reels?goal_id=eq.${g.id}`, { method: "DELETE", prefer: "return=minimal" });

  // Visuals: find candidates for each scene that wants one, then let Claude keep only good ones.
  const wants: { r: number; s: number; q: string }[] = [];
  reels.forEach((r, ri) => r.scenes.forEach((s, si) => { if (s.visual.trim()) wants.push({ r: ri, s: si, q: s.visual }); }));
  const errors: string[] = [];
  const cands: Cand[][] = await Promise.all(wants.map(async (w) => {
    const list: Cand[] = [];
    const add = async (f: () => Promise<Cand[]>) => { try { list.push(...await f()); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); } };
    await add(() => pixabayVideos(w.q));
    if (plan.space) { await add(() => nasaVideos(w.q)); if (list.length < 3) await add(() => nasaImages(w.q)); }
    if (list.length < 3) await add(() => unsplashPhotos(w.q));
    if (list.length < 3) await add(() => pixabayPhotos(w.q));
    if (list.length < 2) await add(() => commons(w.q));
    return list.slice(0, 4);
  }));
  const blocks = await Promise.all(cands.map((l) => Promise.all(l.map((c) => asBlock(c.preview ?? c.poster)))));
  // deno-lint-ignore no-explicit-any
  const content: any[] = [{ type: "text", text: "You are the photo editor for a beautiful science video channel. For each scene, pick the candidate that is both on-topic and genuinely beautiful as a full-screen vertical background. The style is cinematic and moody (dramatic light, deep shadows, night launches, glowing machines) or huge wide views (Earth from orbit, planets, landscapes, skies). Reject (-1) anything ugly or ordinary: flat or cluttered snapshots, offices, people pointing at screens, cheesy stock poses, low resolution, washed-out colours, charts, diagrams, documents, logos, text or watermarks, or anything misleading about the subject. Prefer video when it is as good. Score 1-10 for beauty and fit together; only 8+ is good enough." }];
  wants.forEach((w, i) => {
    content.push({ type: "text", text: `\nScene ${i}: "${reels[w.r].scenes[w.s].caption}" (looking for: ${w.q})` });
    cands[i].forEach((c, k) => { if (blocks[i][k]) { content.push({ type: "text", text: `Scene ${i}, candidate ${k} (${c.kind}${c.landscape ? ", landscape: the centre will be cropped to a tall phone screen" : ""})` }); content.push(blocks[i][k]); } });
  });
  content.push({ type: "text", text: "One entry per scene; id = the scene number." });
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
  const visual: Record<string, Cand> = {};
  for (let i = 0; i < wants.length; i++) {
    const v = verdict?.items.find((x) => String(x.id).replace(/\D/g, "") === String(i));
    const c = v && v.pick >= 0 && v.score >= 8 && blocks[i][v.pick] ? cands[i][v.pick] : null;
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
  }

  let saved = 0;
  for (let ri = 0; ri < reels.length; ri++) {
    const r = reels[ri];
    const scenes = r.scenes.slice(0, 6).map((s, si) => ({
      caption: s.caption.trim().slice(0, 120), sub: s.sub.trim().slice(0, 200) || null,
      stat: s.stat_value.trim() ? { value: s.stat_value.trim().slice(0, 16), label: s.stat_label.trim().slice(0, 60) } : null,
      visual: visual[`${ri}:${si}`] ?? null,
      layout: s.layout,
    }));
    const postId = r.post_id && posts.some((p: { id: number }) => p.id === r.post_id) ? r.post_id : null;
    if (r.kind === "intro" || r.kind === "people") await db(`reels?goal_id=eq.${g.id}&kind=eq.${r.kind}`, { method: "DELETE", prefer: "return=minimal" });
    await db("reels", { method: "POST", prefer: "return=minimal", body: { goal_id: g.id, post_id: r.kind === "intro" || r.kind === "people" ? null : postId, kind: r.kind, title: r.title.slice(0, 120), scenes, score: r.strength, mood: r.mood } }).catch((e) => errors.push(String(e).slice(0, 120)));
    saved++;
  }
  await db(`goals?id=eq.${g.id}`, { method: "PATCH", prefer: "return=minimal", body: { reels_at: new Date().toISOString() } });
  return { slug: g.slug, reels: saved, kinds: reels.map((r) => r.kind), visuals: Object.keys(visual).length, wanted: wants.length, errors: [...new Set(errors)].slice(0, 4) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    return json(await run(body.slug, !!body.fresh));
  } catch (e) {
    console.error("reels failed:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
