import { chromium } from "playwright";
import { existsSync } from "node:fs";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(EXE) ? EXE : undefined,
  args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("console", (m) => console.log(`[${m.type()}]`, m.text().slice(0, 600)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 800)));
await page.goto("http://127.0.0.1:3111/mountain", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(3500);
const info = await page.evaluate(() => {
  const cs = Array.from(document.querySelectorAll("canvas"));
  return cs.map((c) => {
    const r = c.getBoundingClientRect();
    return { w: c.width, h: c.height, css: [Math.round(r.width), Math.round(r.height)], role: c.getAttribute("role"), cls: c.className,
      parentBg: getComputedStyle(c.parentElement).background.slice(0,60), display: getComputedStyle(c).display, vis: getComputedStyle(c).visibility, op: getComputedStyle(c).opacity };
  });
});
console.log("canvases:", JSON.stringify(info, null, 1));
console.log("body bg:", await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
await page.screenshot({ path: "/tmp/claude-0/-home-user-objetdart-proj/ef13bafa-aa28-5c10-b6a6-4f1a903a7a7e/scratchpad/live.png" });
await browser.close();
