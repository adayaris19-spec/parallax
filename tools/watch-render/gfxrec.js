// Capture one animated graphic (gfx.html) frame by frame into a video: node gfxrec.js <url> <spec.json> <dur> <look> <out.mp4>
// Each frame is drawn for its exact time, so motion is smooth and in sync whatever the machine's speed.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
(async () => {
  const [url, specFile, dur, look, out, fps, over] = process.argv.slice(2); const OVER = over === 'over';
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8')), D = Number(dur), FPS = Number(fps) || 30;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  p.on('pageerror', (e) => console.error('page:', e.message));
  await p.goto(url); await p.waitForFunction(() => window.ready === true);
  await p.evaluate(([g, d, l, o]) => window.setup(g, d, l, o), [spec, D, look, OVER]);
  // Over footage: transparent PNG frames into a video that keeps the alpha channel (PNG in MOV).
  const enc = OVER ? ['-c:v', 'png', '-pix_fmt', 'rgba'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p'];
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', OVER ? 'png' : 'mjpeg', '-i', '-', ...enc, '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.ceil(D * FPS);
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => window.frame(t), i / FPS);
    const buf = OVER ? await p.screenshot({ type: 'png', omitBackground: true }) : await p.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r)); await b.close();
})();
