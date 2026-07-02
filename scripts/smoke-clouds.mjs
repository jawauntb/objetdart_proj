import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const baseUrl = (process.env.CLOUDS_SMOKE_BASE_URL || process.argv[2] || "http://127.0.0.1:3000").replace(/\/$/, "");
const outDir = process.env.CLOUDS_SMOKE_OUT_DIR || "iterations/clouds-smoke";
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
  return (
    text.includes("AudioContext was not allowed to start") ||
    text.includes("GL Driver Message") ||
    text.includes("Failed to fetch RSC payload")
  );
}

function watchPage(page, label) {
  const messages = [];
  page.on("pageerror", (error) => messages.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !isExpectedWarning(text)) messages.push(`${label} console error: ${text}`);
    if (message.type() === "warning" && !isExpectedWarning(text)) messages.push(`${label} console warning: ${text}`);
  });
  return messages;
}

function routeUrl(route) {
  return `${baseUrl}${route}`;
}

async function gotoRoute(page, route) {
  await page.goto(routeUrl(route), { waitUntil: "domcontentloaded", timeout: 45000 });
}

async function frameState(page) {
  return page.evaluate(() => {
    const frames = [...document.querySelectorAll('div[aria-hidden="true"]')].filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.position === "fixed" && rect.height > 100 && Boolean(element.querySelector("svg"));
    });
    const frame = frames[0];
    const left = frame?.children[2];
    const right = frame?.children[3];
    const leftRect = left?.getBoundingClientRect();
    const rightRect = right?.getBoundingClientRect();
    const leftInnerRect = left?.firstElementChild?.getBoundingClientRect();
    const rightInnerRect = right?.firstElementChild?.getBoundingClientRect();
    return {
      found: Boolean(frame),
      leftHeight: Math.round(leftRect?.height || 0),
      rightHeight: Math.round(rightRect?.height || 0),
      leftInnerHeight: Math.round(leftInnerRect?.height || 0),
      rightInnerHeight: Math.round(rightInnerRect?.height || 0),
    };
  });
}

async function assertGreekFrame(page, label) {
  const frame = await frameState(page);
  assert.equal(frame.found, true, `${label}: GreekKeyFrame should exist`);
  assert.ok(frame.leftHeight > 100, `${label}: left frame wrapper should have height`);
  assert.ok(frame.rightHeight > 100, `${label}: right frame wrapper should have height`);
  assert.ok(frame.leftInnerHeight > 100, `${label}: left rotated band should measure after hydration`);
  assert.ok(frame.rightInnerHeight > 100, `${label}: right rotated band should measure after hydration`);
}

async function getWeatherLabels(page) {
  return page.evaluate(() => [...document.querySelectorAll(".cloud-weather-ribbon span")]
    .map((element) => element.textContent?.trim())
    .filter(Boolean));
}

async function assertCloudChromeHidden(page, label) {
  const chrome = await page.evaluate(() => [".oda-field-watch", ".oda-candle-mark", ".oda-tape-shell", ".oda-sound-toggle"].map((selector) => {
    const element = document.querySelector(selector);
    return {
      selector,
      exists: Boolean(element),
      display: element ? getComputedStyle(element).display : "absent",
    };
  }));
  for (const item of chrome) {
    if (item.exists) assert.equal(item.display, "none", `${label}: ${item.selector} should be hidden on /clouds`);
  }
}

async function waitForCloudCanvases(page) {
  await page.waitForFunction(() => document.querySelectorAll(".clouds-root > canvas").length === 2, null, { timeout: 30000 });
}

async function assertCloudSurface(page, label) {
  const data = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll(".clouds-root > canvas")];
    const overlay = canvases[1];
    let overlayAlphaPixels = 0;
    if (overlay) {
      const ctx = overlay.getContext("2d");
      if (ctx) {
        const sw = Math.min(180, overlay.width);
        const sh = Math.min(180, overlay.height);
        const sx = Math.max(0, Math.floor(overlay.width * 0.45 - sw / 2));
        const sy = Math.max(0, Math.floor(overlay.height * 0.35 - sh / 2));
        const pixels = ctx.getImageData(sx, sy, sw, sh).data;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] > 0) overlayAlphaPixels += 1;
        }
      }
    }
    return {
      hasRoot: Boolean(document.querySelector(".clouds-root")),
      canvasCount: canvases.length,
      canvasSizes: canvases.map((canvas) => ({
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
      })),
      overlayAlphaPixels,
      title: document.querySelector(".cloud-title")?.textContent || "",
    };
  });
  assert.equal(data.hasRoot, true, `${label}: clouds root should exist`);
  assert.equal(data.canvasCount, 2, `${label}: clouds should have sky and overlay canvases`);
  for (const [index, size] of data.canvasSizes.entries()) {
    assert.ok(size.width > 0 && size.height > 0, `${label}: canvas ${index} should have backing pixels`);
    assert.ok(size.clientWidth > 0 && size.clientHeight > 0, `${label}: canvas ${index} should have CSS size`);
  }
  assert.match(data.title, /Olympusliving weather/i, `${label}: title should render`);
  assert.ok(data.overlayAlphaPixels > 0, `${label}: overlay should render nonblank weather/glyph pixels`);
}

async function dispatchPointer(page, target, type, pointerId, x, y) {
  await page.evaluate(
    ({ selector, eventType, id, clientX, clientY }) => {
      const event = new PointerEvent(eventType, {
        bubbles: true,
        cancelable: true,
        pointerId: id,
        pointerType: "touch",
        isPrimary: id === 1,
        clientX,
        clientY,
      });
      const receiver = selector === "window" ? window : document.querySelector(selector);
      receiver?.dispatchEvent(event);
    },
    { selector: target, eventType: type, id: pointerId, clientX: x, clientY: y },
  );
}

async function runCloudGestures(page, label) {
  const viewport = page.viewportSize() || { width: 900, height: 700 };
  const tapX = Math.round(viewport.width * 0.62);
  const tapY = Math.round(viewport.height * 0.82);
  await page.mouse.click(tapX, tapY);
  await page.waitForTimeout(300);
  let labels = await getWeatherLabels(page);
  assert.ok(labels.includes("vapor"), `${label}: empty-sky tap should add vapor mark`);

  const dragStartX = Math.round(viewport.width * 0.18);
  const dragBaseY = Math.round(viewport.height * 0.52);
  await page.mouse.move(dragStartX, dragBaseY);
  await page.mouse.down();
  for (let i = 0; i <= 18; i += 1) {
    await page.mouse.move(
      dragStartX + i * Math.max(12, viewport.width * 0.035),
      dragBaseY + Math.sin((i / 18) * Math.PI * 2) * Math.max(34, viewport.height * 0.08),
      { steps: 2 },
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  labels = await getWeatherLabels(page);
  assert.ok(labels.includes("wind shear"), `${label}: drag should add wind shear mark`);

  await page.mouse.move(Math.round(viewport.width * 0.56), Math.round(viewport.height * 0.40));
  await page.mouse.down();
  await page.waitForTimeout(920);
  await page.mouse.up();
  await page.waitForTimeout(450);
  labels = await getWeatherLabels(page);
  assert.ok(labels.includes("storm cell"), `${label}: long hold should add storm cell mark`);
}

async function assertPointerCancelDoesNotStorm(page) {
  await gotoRoute(page, "/clouds");
  await waitForCloudCanvases(page);
  await page.waitForTimeout(700);
  await dispatchPointer(page, ".clouds-root > canvas:nth-of-type(2)", "pointerdown", 31, 680, 360);
  await page.waitForTimeout(900);
  await dispatchPointer(page, "window", "pointercancel", 31, 680, 360);
  await page.waitForTimeout(300);
  const labels = await getWeatherLabels(page);
  assert.equal(labels.includes("storm cell"), false, "pointercancel should not create a storm cell");
  assert.equal(labels.includes("lightning"), false, "pointercancel should not trigger lightning");
}

async function assertPointerIdIsolation(page) {
  await gotoRoute(page, "/clouds");
  await waitForCloudCanvases(page);
  await page.waitForTimeout(700);
  await dispatchPointer(page, ".clouds-root > canvas:nth-of-type(2)", "pointerdown", 1, 620, 340);
  await dispatchPointer(page, ".clouds-root > canvas:nth-of-type(2)", "pointerdown", 2, 320, 440);
  await dispatchPointer(page, "window", "pointerup", 2, 320, 440);
  await page.waitForTimeout(900);
  await dispatchPointer(page, "window", "pointerup", 1, 620, 340);
  await page.waitForTimeout(450);
  const labels = await getWeatherLabels(page);
  assert.ok(labels.includes("storm cell"), "non-active pointerup should not cancel the active long press");
}

async function runCloudViewport(browser, label, viewport, deviceScaleFactor, isMobile) {
  const context = await browser.newContext({ viewport, deviceScaleFactor, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  const messages = watchPage(page, label);
  await gotoRoute(page, "/clouds");
  await waitForCloudCanvases(page);
  await page.waitForTimeout(900);
  await assertGreekFrame(page, label);
  await assertCloudChromeHidden(page, label);
  await runCloudGestures(page, label);
  await assertCloudSurface(page, label);
  await page.screenshot({ path: `${outDir}/${label}.png`, fullPage: false });
  assert.deepEqual(messages, [], `${label}: unexpected browser messages`);
  await context.close();
}

async function runRouteExitCheck(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const messages = watchPage(page, "route-exit");
  await gotoRoute(page, "/clouds");
  await page.waitForSelector(".clouds-root");
  await assertCloudChromeHidden(page, "route-exit");
  await gotoRoute(page, "/");
  await page.waitForFunction(() => !document.querySelector(".clouds-root"), null, { timeout: 10000 });
  const visibleChromeCount = await page.evaluate(() => [".oda-field-watch", ".oda-candle-mark", ".oda-tape-shell", ".oda-sound-toggle"].filter((selector) => {
    const element = document.querySelector(selector);
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }).length);
  assert.ok(visibleChromeCount > 0, "global chrome should return after leaving /clouds");
  assert.deepEqual(messages, [], "route-exit: unexpected browser messages");
  await context.close();
}

async function runGreekFrameCompanionRoute(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const messages = watchPage(page, "aphros-frame");
  await gotoRoute(page, "/aphros");
  await page.waitForTimeout(1200);
  await assertGreekFrame(page, "aphros-frame");
  assert.deepEqual(messages, [], "aphros-frame: unexpected browser messages");
  await context.close();
}

const browser = await chromium.launch(launchOptions());
try {
  await runCloudViewport(browser, "desktop", { width: 1440, height: 960 }, 1, false);
  await runCloudViewport(browser, "mobile", { width: 390, height: 844 }, 2, true);

  const pointerContext = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const pointerPage = await pointerContext.newPage();
  const pointerMessages = watchPage(pointerPage, "pointer-events");
  await assertPointerCancelDoesNotStorm(pointerPage);
  await assertPointerIdIsolation(pointerPage);
  assert.deepEqual(pointerMessages, [], "pointer-events: unexpected browser messages");
  await pointerContext.close();

  await runRouteExitCheck(browser);
  await runGreekFrameCompanionRoute(browser);
  console.log(`clouds smoke ok: ${baseUrl}`);
} finally {
  await browser.close();
}
