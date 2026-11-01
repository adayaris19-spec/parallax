// Record an animated background (anim2.html) frame by frame: node anim2rec.js kind hue seconds out.mp4
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');const {execFileSync}=require('child_process');
(async()=>{const [kind,hue,sec,out]=process.argv.slice(2);const dir=out+'.f';fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
const b=await chromium.launch();const p=await b.newPage({viewport:{width:720,height:1280}});await p.goto('file://'+path.join(__dirname,'anim2.html'));
const cdp=await p.context().newCDPSession(p);const N=Math.ceil(Number(sec)*30);
for(let f=0;f<N;f++){await p.evaluate(([k,t,h])=>window.draw(k,t,{hue:h}),[kind,f/30,Number(hue)]);const r=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:92});fs.writeFileSync(path.join(dir,String(f).padStart(5,'0')+'.jpg'),Buffer.from(r.data,'base64'));}
await b.close();execFileSync('ffmpeg',['-y','-v','error','-framerate','30','-i',dir+'/%05d.jpg','-c:v','libx264','-preset','veryfast','-crf','16','-pix_fmt','yuv420p',out]);fs.rmSync(dir,{recursive:true,force:true});})();
