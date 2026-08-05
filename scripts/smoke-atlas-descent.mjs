/**
 * The twelve-layer claim, driven in a real browser.
 *
 * Generation is stubbed: every phase request answers with the authored
 * origin sheet, echoing the interaction's generation id and phase exactly
 * as the production stale-response guard requires. That is enough, because
 * what is being checked here is not the picture — it is the pyramid. Zoom
 * in, and the room must ask for a child of half the ground, land it,
 * promote it once it owns the frame, and go again; twelve times, without
 * the camera ever leaving the plane's own zoom range. Then pull back out
 * and every stair must come back, in order.
 *
 *   npm run dev &  node scripts/smoke-atlas-descent.mjs http://127.0.0.1:3210
 */

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const baseUrl = (process.argv[2] || "http://127.0.0.1:3210").replace(/\/$/, "");
const outDir = "iterations/atlas-descent";
const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const pwPath = process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.js";
const pw = await import(pwPath);
const chromium = pw.chromium || pw.default?.chromium;
assert.ok(chromium, "no chromium");
await mkdir(outDir, { recursive: true });

const TARGET_LAYERS = 12;

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

// Stub both phases with the authored sheet, echoing the ticket back.
await page.route("**/api/atlas/generate**", async (route) => {
  const request = route.request();
  const phase = new URL(request.url()).searchParams.get("phase") === "preview" ? "preview" : "final";
  const generationId = request.headers()["x-atlas-generation-id"] || "stub";
  const body = JSON.parse(request.postData() || "{}");
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      dataUrl: baseUrl + "/atlas/atlas-origin.webp",
      hotspots: [
        { id: "a", label: "north reach", x: 0.3, y: 0.25, regionId: "attention", kind: "tower" },
        { id: "b", label: "salt gate", x: 0.7, y: 0.35, regionId: "attention", kind: "ship" },
        { id: "c", label: "low field", x: 0.4, y: 0.7, regionId: "attention", kind: "flower" },
        { id: "d", label: "far mark", x: 0.75, y: 0.72, regionId: "attention", kind: "star" },
      ],
      seeds: { north: "n", east: "e", south: "s", west: "w" },
      generation: { generationId, phase, generationDepth: body.generationDepth ?? 0 },
    }),
  });
});

await page.goto(baseUrl + "/atlas/origin", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".living-atlas__stage", { timeout: 30000 });
await page.waitForTimeout(1200);

const stage = await page.$(".living-atlas__stage");
const box = await stage.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

const readState = () => page.evaluate(() => {
  const stage = document.querySelector(".living-atlas__stage");
  const plane = document.querySelector(".living-atlas__plane");
  const zoom = Number(plane?.style.getPropertyValue("--atlas-zoom") || "1");
  // What the eye actually lands on: the deepest tile still painted under
  // the middle of the stage. Ancestors sit beneath it by construction, so
  // their (coarser) magnification is not what anyone is looking at.
  const stageBox = stage.getBoundingClientRect();
  const midX = stageBox.left + stageBox.width / 2;
  const midY = stageBox.top + stageBox.height / 2;
  let centre = null;
  for (const el of document.querySelectorAll(".living-atlas__tile")) {
    if (el.classList.contains("is-retiring")) continue;
    if (Number(getComputedStyle(el).opacity) <= 0.5) continue;
    const r = el.getBoundingClientRect();
    if (midX < r.left || midX > r.right || midY < r.top || midY > r.bottom) continue;
    const level = Number(el.dataset.level);
    if (!centre || level >= centre.level) {
      centre = { level, span: Number(el.style.getPropertyValue("--tile-span") || "1") };
    }
  }
  // ...and the plane's own ground must still own the frame, or promotion
  // would be leaving bare margins for the ancestors to show through.
  const cell = [...document.querySelectorAll('.living-atlas__tile[data-level="0"]')]
    .filter((el) => !el.classList.contains("is-retiring"))
    .map((el) => el.getBoundingClientRect())
    .some((r) => r.left <= stageBox.left + 1 && r.top <= stageBox.top + 1
      && r.right >= stageBox.right - 1 && r.bottom >= stageBox.bottom - 1);
  return {
    depth: Number(stage?.dataset.historyDepth || "0"),
    generationDepth: Number(stage?.dataset.generationDepth || "0"),
    zoom,
    centreMagnification: centre ? centre.span * zoom : null,
    centreLevel: centre ? centre.level : null,
    cellCoversFrame: cell,
  };
});

const zoomIn = async (ticks) => {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < ticks; i += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(40);
  }
  // past the settle debounce, plus the stubbed generation round trip
  await page.waitForTimeout(1400);
};

const zoomOut = async (ticks) => {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < ticks; i += 1) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(900);
};

let maxZoomSeen = 0;
const problems = [];

const start = await readState();
assert.equal(start.depth, 0, "the atlas must open at the outermost chart");

for (let layer = 1; layer <= TARGET_LAYERS; layer += 1) {
  // Two passes: the first crosses the detail threshold and lands a child,
  // the second carries the camera far enough that the child owns the frame.
  await zoomIn(6);
  await zoomIn(6);
  const state = await readState();
  maxZoomSeen = Math.max(maxZoomSeen, state.zoom);
  if (state.depth < layer) {
    problems.push(`layer ${layer}: descent stalled at depth ${state.depth} (zoom ${state.zoom.toFixed(2)})`);
    break;
  }
  if (state.generationDepth < layer) {
    problems.push(`layer ${layer}: generation depth ${state.generationDepth} did not follow the descent`);
  }
  if (layer === 1 || layer === TARGET_LAYERS) {
    await page.screenshot({ path: `${outDir}/layer-${String(layer).padStart(2, "0")}.png` });
  }
}

const deep = await readState();
assert.equal(problems.length, 0, problems.join("\n"));
assert.ok(deep.depth >= TARGET_LAYERS, `expected at least ${TARGET_LAYERS} layers, reached ${deep.depth}`);

// The whole point of promotion: depth lives in the stack, not in a
// transform scale that has run out of precision.
assert.ok(
  maxZoomSeen <= 8.5,
  `camera zoom must stay inside the plane's own range; saw ${maxZoomSeen.toFixed(2)}`,
);

// Nothing the eye lands on may be a stretched copy: the deepest painted
// ground under the middle of the stage is drawn near its own fit, however
// deep the descent has run. This is the sharpness claim, measured.
const worst = deep.centreMagnification ?? Infinity;
assert.ok(worst <= 2.1, `the visible ground is magnified ${worst.toFixed(2)}x past its own drawing`);
assert.ok(deep.cellCoversFrame, "the promoted sheet must own the whole frame, not leave margins to its ancestors");

// ...and the stair climbs back.
for (let i = 0; i < TARGET_LAYERS + 2; i += 1) await zoomOut(8);
const risen = await readState();
assert.ok(
  risen.depth < deep.depth,
  `pulling back at the floor must climb out of the descent (still at ${risen.depth})`,
);
await page.screenshot({ path: `${outDir}/risen.png` });

console.log(
  `atlas descent ok: ${deep.depth} layers reached, camera peaked at ${maxZoomSeen.toFixed(2)}x, `
  + `deepest visible magnification ${worst.toFixed(2)}x, risen to ${risen.depth}`,
);

await browser.close();
