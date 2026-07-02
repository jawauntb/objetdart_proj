import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
await mkdir("iterations/iter-15", { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist","--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 820, height: 900 }, deviceScaleFactor: 2 });
p.setDefaultTimeout(90000);
const errs=[]; p.on("pageerror",e=>errs.push("EXC "+e.message)); p.on("console",m=>{if(m.type()==="error")errs.push("ERR "+m.text());});
// pre-seed a full sky so we can see the settled aventurine
await p.addInitScript(()=>{ try{ localStorage.setItem("objetdart:coin:aventurine","1"); }catch{} });
await p.goto("http://localhost:4599/coin", { waitUntil:"load" });
await p.waitForFunction(()=>window.__coin&&window.__coin.ready===true,{timeout:60000}).catch(()=>errs.push("no ready"));
await p.waitForTimeout(2500);
// let shine settle: no interaction, just keep RAF alive far from the coin
for(let i=0;i<20;i++){ await p.mouse.move(30, 30+(i%2)); await p.waitForTimeout(80); }
await p.screenshot({ path: "iterations/iter-15/e-full-settled.png" });
// now play a bit to bring up jewel sparkle
for(let i=0;i<24;i++){ await p.mouse.move(410+(i*5)%180, 450+(i*7)%160); await p.evaluate(()=>window.__coin.flip()); await p.waitForTimeout(70); }
for(let i=0;i<10;i++){ await p.mouse.move(60,60+(i%2)); await p.waitForTimeout(70); }
await p.screenshot({ path: "iterations/iter-15/f-jewels.png" });
console.log(errs.length?("ERRS "+errs.slice(0,4).join(" | ")):"NO ERRORS");
await b.close();
