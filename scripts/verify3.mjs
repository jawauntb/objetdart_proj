import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
await mkdir("iterations/iter-10", { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell", args: ["--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist","--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 950, height: 950 } });
p.setDefaultTimeout(120000);
const errs=[]; p.on("pageerror",e=>errs.push("EXC "+e.message)); p.on("console",m=>{if(m.type()==="error")errs.push("ERR "+m.text());});
// aventurine on /movement
await p.goto("http://localhost:3100/movement?spin=0&view=top&shot=1", { waitUntil:"networkidle" });
await p.waitForFunction(() => window.__movement && window.__movement.ready === true);
await p.waitForTimeout(1200);
await p.getByRole("button",{name:"aventurine"}).click(); await p.waitForTimeout(900);
await p.screenshot({ path: "iterations/iter-10/aventurine-fixed.png" });
console.log("movement errs:", errs.length?errs.join("|"):"none"); errs.length=0;
// jewel page
await p.goto("http://localhost:3100/jewel", { waitUntil:"networkidle" });
await p.waitForTimeout(2500);
await p.screenshot({ path: "iterations/iter-10/jewel.png" });
console.log("jewel errs:", errs.length?errs.join("|"):"none");
await b.close();
