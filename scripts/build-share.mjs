// PARALLAX share pages. Link previews (WhatsApp, iMessage, X, Slack...) ignore everything after "#",
// so every #/g/<slug> link showed the same generic card. This writes, for each goal:
//   g/<slug>/index.html   its own title, description and preview image, then forwards to #/g/<slug>
//   share/<slug>.png      a 1200x630 preview card (name, progress, bottleneck, its picture)
// Run by .github/workflows/share.yml every few hours, so new goals get theirs. Needs Playwright.
//   node scripts/build-share.mjs [--base https://adayaris19-spec.github.io/parallax/]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";

const BASE = (process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : process.env.SITE_BASE || "https://adayaris19-spec.github.io/parallax/").replace(/\/?$/, "/");
const html = await readFile("index.html", "utf8");
const SUPA_URL = /const SUPA_URL = '([^']+)'/.exec(html)[1];
const SUPA_KEY = /const SUPA_KEY = '([^']+)'/.exec(html)[1]; // the public (anon) key the site already uses
const rest = async (path) => {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status}`);
  return r.json();
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const goals = await rest("goals?status=eq.ready&select=id,slug,name,tagline,progress,horizon_low,horizon_high,bottleneck_key&order=id.asc");
const nodes = await rest("nodes?parent_key=not.is.null&select=goal_id,key,title,plain_title,status");
const reels = await rest("reels?select=goal_id,kind,scenes&order=score.desc");
const pictureOf = (gid) => {
  const vis = reels.filter((r) => r.goal_id === gid).sort((a, b) => (a.kind === "intro" ? -1 : b.kind === "intro" ? 1 : 0))
    .flatMap((r) => (r.scenes || []).map((s) => s.visual).filter((v) => v?.url));
  const v = vis.find((x) => x.kind === "image") || vis[0];
  return v ? (v.kind === "image" ? v.url : v.poster) : null;
};

const card = (g, d) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}body{width:1200px;height:630px;font-family:Geist,system-ui,sans-serif;color:#fff;background:#0B0B0D;overflow:hidden;position:relative}
.bg{position:absolute;inset:0;background:${d.pic ? `url('${d.pic}') center/cover` : "radial-gradient(80% 90% at 80% 20%,#2a2f8a 0%,transparent 60%),radial-gradient(70% 80% at 10% 100%,#3a1d4f 0%,transparent 60%)"};filter:saturate(1.05)}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,9,12,.94) 0%,rgba(8,9,12,.82) 48%,rgba(8,9,12,.35) 100%)}
.in{position:absolute;inset:0;padding:64px 72px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:14px;font-size:26px;font-weight:600;letter-spacing:-.01em}
.brand svg{width:40px;height:40px}
h1{margin-top:auto;font-size:${g.name.length > 34 ? 60 : 72}px;line-height:1.02;letter-spacing:-.035em;font-weight:600;max-width:820px}
.bn{margin-top:22px;font-size:25px;line-height:1.35;color:rgba(255,255,255,.78);max-width:760px}
.bn b{color:#fff;font-weight:500}
.row{margin-top:34px;display:flex;align-items:center;gap:28px;font-family:"Geist Mono",monospace;font-size:22px;color:rgba(255,255,255,.8)}
.bar{width:300px;height:10px;border-radius:6px;background:rgba(255,255,255,.18);overflow:hidden}.bar i{display:block;height:100%;background:#7C83FF;border-radius:6px}
.row b{color:#fff;font-size:30px;font-weight:500}
</style></head><body><div class="bg"></div><div class="shade"></div><div class="in">
<div class="brand"><svg viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#111214"/><line x1="150" y1="352" x2="256" y2="152" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity=".55"/><line x1="362" y1="352" x2="256" y2="152" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity=".55"/><circle cx="150" cy="352" r="34" fill="#fff"/><circle cx="362" cy="352" r="34" fill="#fff"/><circle cx="256" cy="152" r="46" fill="#5C64F0"/></svg>Parallax</div>
<h1>${esc(g.name)}</h1>
${d.bottleneck ? `<p class="bn">Biggest bottleneck: <b>${esc(d.bottleneck)}</b></p>` : ""}
<div class="row"><b>${d.pct}%</b><div class="bar"><i style="width:${Math.max(2, d.pct)}%"></i></div><span>${d.solved ? `${d.solved} of ${d.total} problems solved` : `${d.total} problems mapped`}</span>${g.horizon_low ? `<span>· ${g.horizon_low}–${g.horizon_high} yrs to go</span>` : ""}</div>
</div></body></html>`;

const page = (g, d) => {
  const url = `${BASE}g/${encodeURIComponent(g.slug)}/`, img = `${BASE}share/${encodeURIComponent(g.slug)}.png?v=${d.v}`;
  const title = `${g.name} · Parallax`;
  const desc = g.tagline || `Follow ${g.name} on Parallax: what's blocking it, and what moved today.`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Parallax">
<meta property="og:title" content="${esc(g.name)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`${g.name}: ${d.pct}% of the way`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(g.name)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<meta name="theme-color" content="#0B0B0D">
<meta http-equiv="refresh" content="0; url=../../#/g/${encodeURIComponent(g.slug)}">
<script>location.replace('../../#/g/${encodeURIComponent(g.slug)}');</script>
</head><body style="font-family:system-ui;background:#0B0B0D;color:#fff;display:grid;place-items:center;height:100vh;margin:0">
<a href="../../#/g/${encodeURIComponent(g.slug)}" style="color:#fff">${esc(g.name)} on Parallax →</a>
</body></html>
`;
};

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await mkdir("share", { recursive: true });
const keep = new Set();
for (const g of goals) {
  const leaves = nodes.filter((n) => n.goal_id === g.id);
  const bn = leaves.find((n) => n.key === g.bottleneck_key);
  const d = {
    pct: Math.round((g.progress || 0) * 100), solved: leaves.filter((n) => n.status === "solved").length, total: leaves.length,
    bottleneck: bn ? (bn.plain_title || bn.title) : "", pic: pictureOf(g.id),
  };
  d.v = [d.pct, d.solved, d.total, d.bottleneck, d.pic].join("|").split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
  await tab.setContent(card(g, d), { waitUntil: "networkidle" }).catch(() => {});
  await tab.waitForTimeout(300);
  await tab.screenshot({ path: `share/${g.slug}.png`, type: "png" });
  await mkdir(`g/${g.slug}`, { recursive: true });
  await writeFile(`g/${g.slug}/index.html`, page(g, d));
  keep.add(g.slug);
  console.log(`${g.slug}: ${d.pct}%, picture ${d.pic ? "yes" : "no"}`);
}
// The site's own card, for links to the home page.
await tab.setContent(card({ name: "The feed of human progress", horizon_low: 0 }, { pct: Math.round(goals.reduce((a, g) => a + (g.progress || 0), 0) / Math.max(1, goals.length) * 100), solved: nodes.filter((n) => n.status === "solved").length, total: nodes.length, bottleneck: "", pic: null }).replace(/<div class="row">[\s\S]*?<\/div>\n<\/div>/, `<div class="row"><span>${goals.length} goals · ${nodes.length} problems mapped · what's blocking each, and what moved today</span></div>\n</div>`), { waitUntil: "networkidle" }).catch(() => {});
await tab.waitForTimeout(300);
await tab.screenshot({ path: "share/parallax.png", type: "png" });
await browser.close();
// Goals that no longer exist lose their pages.
for (const dir of await readdir("g").catch(() => [])) if (!keep.has(dir)) await rm(`g/${dir}`, { recursive: true, force: true });
for (const f of await readdir("share").catch(() => [])) if (f.endsWith(".png") && !keep.has(f.slice(0, -4)) && f !== "parallax.png") await rm(`share/${f}`);
