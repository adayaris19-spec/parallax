// Record the motion-graphics layer frame by frame (transparent PNGs): node mg.js spec.json outdir fps total
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
(async()=>{const [spec,out,fps,total]=process.argv.slice(2);const J=JSON.parse(fs.readFileSync(spec,'utf8'));fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch();const p=await b.newPage({viewport:{width:720,height:1280}});
await p.goto('file://'+path.join(__dirname,'mg.html'));await p.evaluate(async(o)=>{await window.setup(o);},J);await p.waitForTimeout(150);
const N=Math.ceil(Number(total)*Number(fps));const cdp=await p.context().newCDPSession(p);
await cdp.send('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
for(let f=0;f<N;f++){await p.evaluate((t)=>window.frame(t),f/Number(fps));
 const r=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 fs.writeFileSync(path.join(out,String(f).padStart(5,'0')+'.png'),Buffer.from(r.data,'base64'));}
await b.close();})();
