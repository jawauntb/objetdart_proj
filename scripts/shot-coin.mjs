import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
await mkdir("iterations/iter-13", { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist","--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 2 });
p.setDefaultTimeout(90000);
const errs=[]; p.on("pageerror",e=>errs.push("EXC "+e.message)); p.on("console",m=>{if(m.type()==="error")errs.push("ERR "+m.text());});
await p.goto("http://localhost:4599/coin", { waitUntil:"load" });
await p.waitForFunction(()=>window.__coin&&window.__coin.ready===true,{timeout:60000}).catch(()=>errs.push("no ready"));
await p.waitForTimeout(2500);
await p.screenshot({ path: "iterations/iter-13/coin-front.png" });
// horizontal slide → resize bigger
await p.mouse.move(400,450); await p.mouse.down(); await p.mouse.move(700,450,{steps:12}); await p.mouse.up();
await p.waitForTimeout(1000);
await p.screenshot({ path: "iterations/iter-13/coin-resized.png" });
// slide back to normal, then flip to see reverse
await p.mouse.move(400,450); await p.mouse.down(); await p.mouse.move(200,450,{steps:12}); await p.mouse.up();
await p.waitForTimeout(600);
await p.evaluate(()=>window.__coin.flip());
await p.waitForTimeout(1800);
await p.screenshot({ path: "iterations/iter-13/coin-back.png" });
console.log(errs.length?("ERRS "+errs.join("|")):"NO ERRORS");
await b.close();
