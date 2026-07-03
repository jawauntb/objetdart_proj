import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const baseUrl = (process.argv[2] || "http://127.0.0.1:3210").replace(/\/$/, "");
const outDir = "iterations/utility-a-smoke";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const pwPath = process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.js";
const pw = await import(pwPath);
const chromium = pw.chromium || pw.default?.chromium;
assert.ok(chromium, "no chromium");
await mkdir(outDir, { recursive: true });

// name -> {url, headerHidden}
const routes = [
  { name: "pretext", url: "/pretext", headerHidden: true },
  { name: "atlas", url: "/atlas/origin", headerHidden: false },
  { name: "charts", url: "/charts", headerHidden: false },
  { name: "compare", url: "/compare", headerHidden: false },
  { name: "home", url: "/", headerHidden: false },
];

function isExpectedWarning(t) {
  return ["AudioContext", "GL Driver", "Failed to fetch RSC", "navigator.vibrate", "WebGL", "THREE.WebGL", "React DevTools"].some((s) => t.includes(s));
}

const problems = [];

async function ready(page) {
  // wait for meaningful content: a large canvas OR the touch surface OR an <svg>/main with children
  await page.waitForFunction(() => {
    const big = [...document.querySelectorAll("canvas")].some((c) => { const r = c.getBoundingClientRect(); return r.width > 200 && r.height > 200; });
    const ts = document.querySelector('[data-touch-surface="true"]');
    const svg = document.querySelector("main svg, section svg");
    const main = document.querySelector("main");
    return big || !!ts || !!svg || (main && main.textContent.trim().length > 20);
  }, { timeout: 30000 });
}

async function drive(page) {
  // drag across the center of the viewport
  const vp = page.viewportSize();
  const cx = vp.width / 2, cy = vp.height / 2;
  await page.mouse.move(cx - vp.width * 0.15, cy);
  await page.mouse.down();
  for (let i = 0; i <= 10; i++) { await page.mouse.move(cx - vp.width * 0.15 + vp.width * 0.3 * (i / 10), cy + Math.sin(i / 10 * Math.PI) * vp.height * 0.15); await page.waitForTimeout(25); }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function run(label, viewport, isMobile) {
  const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"] });
  const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1 });
  for (const r of routes) {
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`${label} ${r.url} pageerror: ${e.message}`));
    page.on("console", (m) => { const t = m.text(); if ((m.type() === "error" || m.type() === "warning") && !isExpectedWarning(t)) problems.push(`${label} ${r.url} ${m.type()}: ${t}`); });
    await page.goto(`${baseUrl}${r.url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await ready(page);
    await page.waitForTimeout(1000);
    const headerVisible = await page.evaluate(() => { const h = document.querySelector("header"); return !!h && getComputedStyle(h).display !== "none" && h.getBoundingClientRect().height > 0; });
    if (r.headerHidden && headerVisible) problems.push(`${label} ${r.url}: header should be hidden but is visible`);
    if (!r.headerHidden && !headerVisible) problems.push(`${label} ${r.url}: header should be visible but is hidden`);
    await drive(page);
    await page.screenshot({ path: `${outDir}/${r.name}-${label}.png` });
    await page.close();
    console.log(`ok ${label} ${r.url}`);
  }
  await context.close();
  await browser.close();
}

await run("desktop", { width: 1440, height: 900 }, false);
await run("mobile", { width: 390, height: 844 }, true);

if (problems.length) { console.error("\nPROBLEMS:\n" + problems.join("\n")); process.exit(1); }
console.log("\nutility-a smoke ok — pretext/atlas/charts/compare/home x desktop+mobile, no unexpected errors");
