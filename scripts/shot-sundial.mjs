import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
await mkdir("iterations/iter-12", { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist","--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 900, height: 950 }, deviceScaleFactor: 2 });
p.setDefaultTimeout(90000);
const errs=[]; p.on("pageerror",e=>errs.push("EXC "+e.message));
await p.goto("http://localhost:3200/movement?spin=0&view=top", { waitUntil:"load" });
await p.waitForFunction(()=>window.__movement&&window.__movement.ready===true,{timeout:60000}).catch(()=>errs.push("no ready"));
await p.waitForTimeout(2500);
// full page
await p.screenshot({ path: "iterations/iter-12/movement-full.png" });
// crop the sundial chip at bottom-center (CSS px space 900x950)
await p.screenshot({ path: "iterations/iter-12/sundial.png", clip: { x: 360, y: 800, width: 200, height: 140 } });
console.log(errs.length?("ERRS "+errs.join("|")):"NO ERRORS");
await b.close();
