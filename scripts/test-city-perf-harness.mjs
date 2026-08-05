#!/usr/bin/env node
/**
 * test-city-perf-harness — the shape contract for the live perf harness.
 *
 * The perf-city-first-paint.mjs script drives a real Chromium against a
 * real GL canvas and cannot run inside a plain `npm test` — that would
 * require every CI lane to boot Next dev and Chromium. So this test only
 * asserts the harness's SHAPE contract, which is what every follow-up
 * perf PR needs to be stable:
 *
 *   1. scripts/perf-city-first-paint.mjs exists and is executable JS
 *   2. it declares the `?__perf=1` query flag as its probe gate
 *   3. it samples via `window.__cityRenderer`, `window.__cityComposer`,
 *      and `window.__cityPerf.firstPaintMs` — the three fields the probe
 *      in City.tsx mounts
 *   4. src/components/City.tsx guards the probe on `?__perf=1` — a
 *      production visitor without the flag cannot see it
 *   5. City.tsx stamps `firstPaintMs` inside the first-frame branch of
 *      the tick loop — so the number represents actual pixels presented
 *   6. City.tsx tears the probe down in the useEffect cleanup — no
 *      lingering references to the composer/renderer past unmount
 *
 * Every one of these has broken before in this codebase, quietly, and a
 * PR shipped with `measured_delta` present in the body but based on a
 * simulator. This test is the fence against that repeat.
 *
 * The test does not run the harness. Actually running requires:
 *   - a live Next server (dev or preview)
 *   - Chromium (globally installed here)
 *   - ~35 s of wall time (30 s idle window + boot)
 * That is the caller's job (npm run perf:city-first-paint).
 */

import { readFileSync } from "node:fs";

const errors = [];
function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

// 1 — harness file exists and looks right
const harness = readFileSync("scripts/perf-city-first-paint.mjs", "utf8");
assert(
  harness.length > 500,
  "harness file is truncated — expected the full playwright driver",
);
assert(
  harness.includes("playwright") && harness.includes("chromium"),
  "harness must import playwright's chromium — that is the whole point",
);
assert(
  harness.includes("waitUntil"),
  "harness must call page.goto with a load signal",
);

// 2 — probe flag is `?__perf=1`
assert(
  harness.includes("__perf") && harness.includes("\"1\""),
  "harness must set the ?__perf=1 query flag on the URL",
);

// 3 — samples via the three probe globals the room mounts
for (const key of ["__cityRenderer", "__cityComposer", "__cityPerf"]) {
  assert(
    harness.includes(key),
    `harness must reference window.${key} — that is how it reads live state`,
  );
}
assert(
  harness.includes("firstPaintMs"),
  "harness must read window.__cityPerf.firstPaintMs",
);
assert(
  harness.includes("info.render.calls") || harness.includes("render.calls"),
  "harness must sample renderer.info.render.calls — the brief's draw-call target",
);
assert(
  harness.includes("performance.memory") || harness.includes("usedJSHeapSize"),
  "harness must sample performance.memory.usedJSHeapSize — the brief's heap target",
);

// 4 — City.tsx guards the probe on `?__perf=1`
const city = readFileSync("src/components/City.tsx", "utf8");
assert(
  city.includes("__perf") && city.includes("URLSearchParams"),
  "City.tsx must gate its perf probe on ?__perf=1 via URLSearchParams",
);
for (const key of ["__cityRenderer", "__cityComposer", "__cityPerf"]) {
  assert(
    city.includes(key),
    `City.tsx must mount window.${key} — the harness reads this`,
  );
}

// 5 — firstPaintMs is stamped inside the first-frame branch of the tick loop.
// We look for a `firstPaintMs` assignment near the `hasEverRendered = true`
// branch — that is the only frame where "the pixels presented for the
// first time" is a truth.
{
  const idx = city.indexOf("hasEverRendered = true");
  assert(idx !== -1, "City.tsx must have the hasEverRendered = true first-frame branch");
  const branchWindow = city.slice(idx, idx + 1200);
  assert(
    branchWindow.includes("firstPaintMs"),
    "City.tsx must stamp firstPaintMs INSIDE the first-frame branch (hasEverRendered)",
  );
}

// 6 — cleanup detaches the probe. Otherwise the composer's bloom RTs
// leak past unmount and the second visit's numbers are all wrong.
assert(
  city.includes("delete w.__cityRenderer") || city.includes("__cityRenderer = undefined"),
  "City.tsx must delete window.__cityRenderer in the useEffect cleanup",
);

// package.json wires the npm scripts.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert(
  typeof pkg.scripts["perf:city-first-paint"] === "string" &&
    pkg.scripts["perf:city-first-paint"].includes("scripts/perf-city-first-paint.mjs"),
  "package.json must expose `perf:city-first-paint` running scripts/perf-city-first-paint.mjs",
);
assert(
  typeof pkg.scripts["test:city-perf-harness"] === "string" &&
    pkg.scripts["test:city-perf-harness"].includes("scripts/test-city-perf-harness.mjs"),
  "package.json must expose `test:city-perf-harness` running this file",
);
assert(
  pkg.scripts.test.includes("test:city-perf-harness"),
  "the aggregate `test` script must include `test:city-perf-harness`",
);

if (errors.length) {
  for (const e of errors) process.stderr.write(`[test-city-perf-harness] FAIL: ${e}\n`);
  process.exit(1);
}
process.stdout.write("test-city-perf-harness ok\n");
