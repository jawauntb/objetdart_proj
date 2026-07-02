import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const STORAGE_KEY = "objetdart:home-cabinet:v1";
const baseUrl = process.env.HOME_SMOKE_BASE_URL || process.argv[2] || "http://127.0.0.1:3000";
const outDir = process.env.HOME_SMOKE_OUT_DIR || "iterations/home-smoke";
const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";

let chromium;
try {
  ({ chromium } = await import(playwrightModule));
} catch (error) {
  console.error(`Unable to import Playwright from ${playwrightModule}. Set PLAYWRIGHT_MODULE to an installed Playwright module path.`);
  console.error(error?.message || error);
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

function launchOptions() {
  const options = {
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
  };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }
  return options;
}

function isExpectedWarning(text) {
  return text.includes("AudioContext was not allowed to start") || text.includes("GL Driver Message");
}

function watchPage(page, label) {
  const messages = [];
  page.on("pageerror", (error) => messages.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error") messages.push(`${label} console error: ${text}`);
    if (message.type() === "warning" && !isExpectedWarning(text)) messages.push(`${label} console warning: ${text}`);
  });
  return messages;
}

async function assertHomeSurface(page, label) {
  const data = await page.evaluate(() => {
    const cabinet = document.querySelector(".home-cabinet");
    const canvas = document.querySelector(".home-cabinet canvas");
    const actions = [...document.querySelectorAll(".home-cabinet a, .home-cabinet button")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
    const badTargets = actions.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        name: element.textContent?.trim() || element.getAttribute("aria-label") || element.tagName,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }).filter((target) => target.width < 44 || target.height < 44);

    const rects = {
      drawer: document.querySelector(".home-cabinet__drawer")?.getBoundingClientRect(),
      local: document.querySelector(".home-cabinet__local")?.getBoundingClientRect(),
      clusters: document.querySelector(".home-cabinet__clusters")?.getBoundingClientRect(),
      sound: document.querySelector(".oda-sound-toggle")?.getBoundingClientRect(),
      watch: document.querySelector(".oda-field-watch")?.getBoundingClientRect(),
      lensMeta: document.querySelector(".home-cabinet__lens-meta")?.getBoundingClientRect(),
    };
    const overlaps = [];
    const addOverlap = (name, a, b) => {
      if (!a || !b || a.width === 0 || b.width === 0) return;
      if (!(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)) overlaps.push(name);
    };
    addOverlap("drawer/sound", rects.drawer, rects.sound);
    addOverlap("local/sound", rects.local, rects.sound);
    addOverlap("clusters/sound", rects.clusters, rects.sound);
    addOverlap("drawer/watch", rects.drawer, rects.watch);
    addOverlap("local/watch", rects.local, rects.watch);
    addOverlap("clusters/watch", rects.clusters, rects.watch);
    addOverlap("lens-meta/clusters", rects.lensMeta, rects.clusters);

    return {
      ready: Boolean(window.__homeCabinet?.ready),
      hasCanvas: Boolean(canvas),
      canvasWidth: canvas?.width || 0,
      canvasHeight: canvas?.height || 0,
      actionCount: actions.length,
      badTargets,
      overlaps,
      cabinetBottom: cabinet ? Math.round(cabinet.getBoundingClientRect().bottom) : null,
      viewportHeight: window.innerHeight,
    };
  });

  assert.equal(data.ready, true, `${label}: cabinet readiness hook should be set`);
  assert.equal(data.hasCanvas, true, `${label}: cabinet canvas should exist`);
  assert.ok(data.canvasWidth > 0 && data.canvasHeight > 0, `${label}: cabinet canvas should have pixels`);
  assert.ok(data.actionCount >= 10, `${label}: cabinet should expose DOM actions`);
  assert.deepEqual(data.badTargets, [], `${label}: visible controls should be at least 44px`);
  assert.deepEqual(data.overlaps, [], `${label}: cabinet controls should not overlap fixed chrome`);
  assert.ok(data.cabinetBottom < data.viewportHeight, `${label}: first viewport should hint at the next section`);
}

async function runViewport(browser, label, viewport, deviceScaleFactor, isMobile) {
  const context = await browser.newContext({ viewport, deviceScaleFactor, isMobile, hasTouch: isMobile });
  await context.addInitScript((key) => {
    window.localStorage.setItem(key, "{not-json");
  }, STORAGE_KEY);
  const page = await context.newPage();
  const messages = watchPage(page, label);

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__homeCabinet?.ready === true, null, { timeout: 30000 });
  await page.screenshot({ path: `${outDir}/${label}.png`, fullPage: false });
  await assertHomeSurface(page, label);

  const parsedAfterCorruptStorage = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)), STORAGE_KEY);
  assert.equal(typeof parsedAfterCorruptStorage.glow, "number", `${label}: corrupt patina should be replaced with valid JSON`);

  await page.evaluate(() => {
    window.__homeSmokeSeaNudge = 0;
    window.addEventListener("oda:sea-nudge", () => { window.__homeSmokeSeaNudge += 1; }, { once: true });
    window.scrollTo(0, 0);
  });
  await page.getByRole("button", { name: /chart: the departure swell/i }).click();
  await page.waitForFunction(() => window.__homeSmokeSeaNudge === 1, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const chart = document.getElementById("live-chart");
    return chart && chart.getBoundingClientRect().top < 180;
  }, null, { timeout: 10000 });

  await page.evaluate((key) => {
    window.scrollTo(0, 0);
    window.localStorage.removeItem(key);
  }, STORAGE_KEY);
  await page.getByRole("button", { name: /mechanism/i }).focus();
  await page.waitForTimeout(25);
  await page.getByRole("button", { name: /mechanism/i }).click();
  await page.waitForTimeout(350);
  const patina = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)), STORAGE_KEY);
  assert.ok((patina.routes.coin || 0) >= 2, `${label}: focus followed by click should record both preview and activation`);
  assert.ok(patina.glow >= 1.2, `${label}: click activation should persist stronger patina`);

  await Promise.all([
    page.waitForURL(/\/coin$/, { timeout: 30000 }),
    page.getByRole("link", { name: /^coin$/i }).click(),
  ]);

  assert.deepEqual(messages, [], `${label}: unexpected browser messages`);
  await context.close();
}

async function runDeniedStorage(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "getItem", {
      configurable: true,
      value() { throw new Error("storage denied"); },
    });
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value() { throw new Error("storage denied"); },
    });
  });
  const page = await context.newPage();
  const messages = watchPage(page, "denied-storage");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__homeCabinet?.ready === true, null, { timeout: 30000 });
  await assertHomeSurface(page, "denied-storage");
  assert.deepEqual(messages, [], "denied-storage: unexpected browser messages");
  await context.close();
}

const browser = await chromium.launch(launchOptions());
try {
  await runViewport(browser, "desktop", { width: 1440, height: 1000 }, 1, false);
  await runViewport(browser, "mobile", { width: 390, height: 844 }, 2, true);
  await runDeniedStorage(browser);
  console.log(`home smoke ok: ${baseUrl}`);
} finally {
  await browser.close();
}
