import { chromium } from "playwright";
import { existsSync } from "node:fs";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(EXE) ? EXE : undefined,
  args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e.stack || e).slice(0, 1500)));
page.on("requestfailed", (r) => console.log("[reqfail]", r.url().slice(0,200), r.failure()?.errorText));
page.on("response", (r) => { if (r.status() >= 400) console.log("[http", r.status(), "]", r.url().slice(0, 160)); });
await page.goto("http://127.0.0.1:3111/mountain", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(2000);
const html = await page.evaluate(() => document.body.innerHTML.length);
console.log("body html len", html);
console.log("wrapper present:", await page.evaluate(() => !!document.querySelector('[aria-label="the peak above the sea of fog"]')));
// try loading the room chunk by hand and report the real error
const err = await page.evaluate(async () => {
  const links = Array.from(document.querySelectorAll("script")).map((s) => s.src).filter(Boolean);
  return links.filter((u) => /chunk|_next\/static/.test(u)).length;
});
console.log("script tags", err);
await browser.close();
