// One-off: capture the aventurine dial face. node scripts/shoot-face.mjs
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
await mkdir("iterations/iter-07", { recursive: true });
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.setDefaultTimeout(120000);
await page.goto("http://localhost:3000/movement?spin=0&view=iso&shot=1", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__movement && window.__movement.ready === true);
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "aventurine" }).click();
await page.waitForTimeout(800);
await page.evaluate(() => window.__movement.setView("top"));
await page.waitForTimeout(700);
await page.screenshot({ path: "iterations/iter-07/aventurine.png" });
console.log("saved aventurine");
await browser.close();
