import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
await mkdir("iterations/iter-12", { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist","--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 950, height: 1000 }, deviceScaleFactor: 2 });
p.setDefaultTimeout(90000);
const errs=[]; p.on("pageerror",e=>errs.push("EXC "+e.message));
await p.goto("http://localhost:3300/jewel", { waitUntil:"load" });
await p.waitForTimeout(3000);
await p.screenshot({ path: "iterations/iter-12/jewel-real-full.png" });
// press a gem to pour carats
try{ await p.getByRole("button",{name:"emerald"}).click(); }catch(e){ errs.push("gem "+e.message); }
await p.waitForTimeout(700);
await p.screenshot({ path: "iterations/iter-12/jewel-real-pour.png" });
console.log(errs.length?("ERRS "+errs.join("|")):"NO ERRORS");
await b.close();
