import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
await mkdir("iterations/iter-17", { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist","--no-sandbox"] });
async function shot(glow, name){
  const p = await b.newPage({ viewport: { width: 820, height: 900 }, deviceScaleFactor: 2 });
  p.setDefaultTimeout(90000);
  await p.addInitScript((g)=>{ try{ localStorage.setItem("objetdart:coin:aventurine", JSON.stringify({t:1,glow:g})); }catch{} }, glow);
  await p.goto("http://localhost:4599/coin", { waitUntil:"load" });
  await p.waitForFunction(()=>window.__coin&&window.__coin.ready===true,{timeout:60000}).catch(()=>{});
  await p.waitForTimeout(2600);
  for(let i=0;i<16;i++){ await p.mouse.move(18,18+(i%2)); await p.waitForTimeout(70); } // settle shine
  await p.screenshot({ path: `iterations/iter-17/${name}.png` });
  await p.close();
}
await shot(1.5, "a-early");   // a few interactions
await shot(40, "b-deep");     // long play — should be far more brilliant/iridescent
console.log("done");
await b.close();
