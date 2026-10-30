// Draw a reel's text layers (bg / A / B per scene) with the overlay template.
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
(async()=>{const J=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+path.join(__dirname,'overlay3.html'));
for(const [out,o] of J){await p.evaluate(o=>window.render(o),o);await p.waitForTimeout(40);await p.screenshot({path:out,omitBackground:true});}
await b.close();})();
