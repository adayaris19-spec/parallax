// Record one of Parallax's live animations (ParallaxScene) as a short video clip.
const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const [kind,hue,out]=process.argv.slice(2);const b=await chromium.launch();
const c=await b.newContext({viewport:{width:720,height:1280},recordVideo:{dir:require('path').dirname(out)+'/rec',size:{width:720,height:1280}}});const p=await c.newPage();
await p.route(/r2\.dev|pixabay|unsplash|nasa|jsdelivr/,r=>r.abort());
await p.goto('http://localhost:8765/#/how');await p.waitForFunction(()=>!!window.ParallaxScene);
await p.evaluate(([kind,hue])=>{document.body.innerHTML='<canvas id="c" style="position:fixed;inset:0;width:100vw;height:100vh;background:#000"></canvas>';window.ParallaxScene(kind,document.getElementById('c'),{hue:Number(hue),seed:kind.length*13});},[kind,hue]);
const t0=Date.now();await p.waitForTimeout(9500);const v=await p.video().path();await c.close();await b.close();
require('child_process').execFileSync('ffmpeg',['-y','-v','error','-ss','1.5','-i',v,'-t','7.5','-c:v','libvpx-vp9','-b:v','3M',out]);fs.unlinkSync(v);})();
