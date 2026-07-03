import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const baseUrl = (process.argv[2] || "http://127.0.0.1:3210").replace(/\/$/, "");
const outDir = "iterations/water-storm-smoke";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const pwPath = process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.js";
const pw = await import(pwPath);
const chromium = pw.chromium || pw.default?.chromium;
assert.ok(chromium, "could not resolve chromium from playwright");
await mkdir(outDir, { recursive: true });

const routes = ["/waves", "/tide", "/ocean", "/storm"];

function isExpectedWarning(text) {
  return (
    text.includes("AudioContext was not allowed to start") ||
    text.includes("GL Driver Message") ||
    text.includes("Failed to fetch RSC payload") ||
    text.includes("navigator.vibrate") ||
    text.includes("WebGL") ||
    text.includes("THREE.WebGLRenderer") ||
    text.includes("Download the React DevTools")
  );
}

const problems = [];

// Wait until a full-viewport canvas has mounted, using the same evaluate
// approach the manual probe proved reliable (locator "visible" heuristics
// flake on these heavy WebGL pages).
async function waitReady(page) {
  await page.waitForFunction(() => {
    const cs = [...document.querySelectorAll("canvas")];
    return cs.some((c) => c.getBoundingClientRect().width > 200 && c.getBoundingClientRect().height > 200);
  }, { timeout: 30000 });
}

async function surfaceBox(page) {
  return page.evaluate(() => {
    const cs = [...document.querySelectorAll("canvas")].map((c) => c.getBoundingClientRect());
    const big = cs.find((r) => r.width > 200 && r.height > 200) || cs[0];
    return big ? { x: big.x, y: big.y, width: big.width, height: big.height } : null;
  });
}

async function drive(page) {
  const box = await surfaceBox(page);
  if (!box) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - box.width * 0.2, cy);
  await page.mouse.down();
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    await page.mouse.move(cx - box.width * 0.2 + box.width * 0.4 * t, cy + Math.sin(t * Math.PI * 2) * box.height * 0.18);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.mouse.click(cx + box.width * 0.15, cy - box.height * 0.1);
  await page.waitForTimeout(400);
}

async function run(label, viewport, isMobile) {
  const browser = await chromium.launch({
    executablePath: exe,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: isMobile ? 2 : 1,
  });
  for (const route of routes) {
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`${label} ${route} pageerror: ${e.message}`));
    page.on("console", (m) => {
      const text = m.text();
      if ((m.type() === "error" || m.type() === "warning") && !isExpectedWarning(text)) {
        problems.push(`${label} ${route} console ${m.type()}: ${text}`);
      }
    });
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitReady(page);
    await page.waitForTimeout(1200);
    const headerVisible = await page.evaluate(() => {
      const h = document.querySelector("header");
      if (!h) return false;
      return getComputedStyle(h).display !== "none" && h.getBoundingClientRect().height > 0;
    });
    if (headerVisible) problems.push(`${label} ${route}: global header still visible (chrome not hidden)`);
    await drive(page);
    const name = route.replace("/", "");
    await page.screenshot({ path: `${outDir}/${name}-${label}.png` });
    await page.close();
    console.log(`ok ${label} ${route}`);
  }
  await context.close();
  await browser.close();
}

await run("desktop", { width: 1440, height: 900 }, false);
await run("mobile", { width: 390, height: 844 }, true);

if (problems.length) {
  console.error("\nPROBLEMS:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("\nwater/storm smoke ok — 4 routes x desktop+mobile, no unexpected errors");
