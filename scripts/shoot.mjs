// Drive the /movement page through camera presets and save PNGs for review.
// Dev-only tooling — Playwright is intentionally NOT a package.json dependency
// (its postinstall downloads a browser, which we keep off the deploy path).
// To run locally: `npm i -D playwright` then `node scripts/shoot.mjs <name>`.
// Usage: node scripts/shoot.mjs <iterationName> [baseURL]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const iter = process.argv[2] || "iter";
const base = process.argv[3] || "http://localhost:3000";
const outDir = `iterations/${iter}`;
await mkdir(outDir, { recursive: true });

const VIEWS = ["iso", "top", "side", "macro-balance", "macro-escape", "macro-train"];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE ERR:", m.text()); });
page.on("pageerror", (e) => console.log("PAGE EXC:", e.message));

const url = `${base}/movement?spin=0&view=iso&shot=1`;
console.log("navigating", url);
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

// wait for the movement hook + a few rendered frames
await page.waitForFunction(() => window.__movement && window.__movement.ready === true, { timeout: 30000 });
await page.waitForTimeout(1200);

for (const v of VIEWS) {
  await page.evaluate((name) => window.__movement.setView(name), v);
  await page.waitForTimeout(600);
  const path = `${outDir}/${v}.png`;
  await page.screenshot({ path });
  console.log("saved", path);
}

await browser.close();
console.log("done", outDir);
