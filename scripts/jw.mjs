import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
await mkdir("iterations/iter-11", { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist","--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 950, height: 950 }, deviceScaleFactor: 1.5 });
p.setDefaultTimeout(120000);
const errs=[]; p.on("pageerror",e=>errs.push("EXC "+e.message)); p.on("console",m=>{if(m.type()==="error")errs.push("ERR "+m.text());});
await p.goto("http://localhost:3100/jewel", { waitUntil:"load" });
await p.waitForTimeout(2500);
await p.screenshot({ path: "iterations/iter-11/jewel-default.png" });
// press emerald to recolor field
try { await p.getByRole("button",{name:"emerald"}).click(); } catch(e){ errs.push("emerald click "+e.message); }
await p.waitForTimeout(1200);
await p.screenshot({ path: "iterations/iter-11/jewel-emerald.png" });
// crop of the gem row (bottom area) for detail
await p.screenshot({ path: "iterations/iter-11/jewel-gems.png", clip: { x: 175, y: 560, width: 600, height: 200 } });
console.log(errs.length?("ERRS "+errs.join("|")):"NO ERRORS");
await b.close();
