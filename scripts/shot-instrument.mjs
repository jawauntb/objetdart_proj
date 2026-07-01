import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
await mkdir("iterations/iter-14", { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist","--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 2 });
p.setDefaultTimeout(90000);
const errs=[]; p.on("pageerror",e=>errs.push("EXC "+e.message)); p.on("console",m=>{if(m.type()==="error")errs.push("ERR "+m.text());});
await p.goto("http://localhost:4599/coin", { waitUntil:"load" });
await p.waitForFunction(()=>window.__coin&&window.__coin.ready===true,{timeout:60000}).catch(()=>errs.push("no ready"));
await p.waitForTimeout(2500);
await p.screenshot({ path: "iterations/iter-14/a-front.png" });
// directional tap: upper-right region → flip toward that corner + region note
await p.mouse.click(560, 330);
for (let i=0;i<24;i++){ await p.mouse.move(400+(i%2),450); await p.waitForTimeout(120); }
await p.screenshot({ path: "iterations/iter-14/b-tapflip.png" });
// two-finger twist via touch pointers to rotate in-plane
await p.evaluate(async () => {
  const el = document.querySelector('canvas');
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width/2, cy = r.top + r.height/2, rad = 120;
  const mk = (id,x,y,type)=> el.dispatchEvent(new PointerEvent(type,{pointerId:id,clientX:x,clientY:y,bubbles:true,pointerType:'touch'}));
  mk(1, cx-rad, cy, 'pointerdown'); mk(2, cx+rad, cy, 'pointerdown');
  for (let a=0; a<=Math.PI*0.9; a+=0.06){
    const x1=cx-Math.cos(a)*rad, y1=cy-Math.sin(a)*rad, x2=cx+Math.cos(a)*rad, y2=cy+Math.sin(a)*rad;
    mk(1,x1,y1,'pointermove'); mk(2,x2,y2,'pointermove');
    await new Promise(r=>setTimeout(r,16));
  }
  mk(1,0,0,'pointerup'); mk(2,0,0,'pointerup');
});
await p.waitForTimeout(400);
await p.screenshot({ path: "iterations/iter-14/c-twist.png" });
console.log(errs.length?("ERRS "+errs.join(" | ")):"NO ERRORS");
await b.close();
