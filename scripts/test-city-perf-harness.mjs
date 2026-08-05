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
 *   7. the harness accepts PERF_MODE=prod and spawns `next build`
 *      + `next start` on PERF_PROD_PORT (default 3001), tearing both
 *      down on exit — the only way the brief's target B (sustained
 *      60fps in production) is measurable from this repo
 *   8. the harness accepts PERF_MOBILE=1 and applies an iPhone
 *      12-class context (390x844, DPR 3, isMobile, hasTouch, iOS
 *      Safari 17 UA)
 *   9. the harness accepts PERF_CPU_THROTTLE=<rate> and passes it to
 *      CDP `Emulation.setCPUThrottlingRate`
 *  10. the JSON output includes `mode`, `mobile`, and `cpu_throttle`
 *      — the fields the verifier reads to confirm which regime a
 *      given measurement came from
 *
 * Every one of these has broken before in this codebase, quietly, and a
 * PR shipped with `measured_delta` present in the body but based on a
 * simulator. This test is the fence against that repeat.
 *
 * The test does not run the harness. Actually running requires:
 *   - a live Next server (dev or preview) OR PERF_MODE=prod
 *   - Chromium (globally installed here)
 *   - ~35 s of wall time (30 s idle window + boot), plus ~2min for a
 *     prod build the first time
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

// 7 — PERF_MODE=prod spawns `next build` + `next start` on the harness's
// port and tears both down on exit. Shape-check the ingredients: the env
// var is read, both commands are referenced, and a SIGKILL/SIGTERM path
// exists for teardown.
assert(
  harness.includes("PERF_MODE"),
  "harness must read PERF_MODE — dev vs prod is a first-class env flag",
);
assert(
  harness.includes("next build"),
  "PERF_MODE=prod must spawn `next build` before Chromium launches",
);
assert(
  harness.includes("next start"),
  "PERF_MODE=prod must spawn `next start` after the build succeeds",
);
assert(
  harness.includes("PERF_PROD_PORT"),
  "harness must accept PERF_PROD_PORT so parallel prod runs don't collide",
);
assert(
  harness.includes("SIGKILL") || harness.includes("SIGTERM"),
  "PERF_MODE=prod must tear the next-start child down on exit",
);
assert(
  harness.includes("child_process") || harness.includes("spawn"),
  "PERF_MODE=prod requires spawning child processes for build + start",
);

// 8 — PERF_MOBILE=1 applies an iPhone 12-class context. Shape-check the
// three fingerprints of that context: the 390x844 viewport, DPR 3, and
// the iOS Safari UA — plus isMobile + hasTouch, which flip the room's
// touch-first branches.
assert(
  harness.includes("PERF_MOBILE"),
  "harness must read PERF_MOBILE — mobile viewport is a first-class env flag",
);
assert(
  harness.includes("390") && harness.includes("844"),
  "PERF_MOBILE=1 must apply the iPhone 12 CSS viewport (390x844)",
);
assert(
  /deviceScaleFactor\s*:\s*3/.test(harness),
  "PERF_MOBILE=1 must set deviceScaleFactor 3 to match iPhone 12 DPR",
);
assert(
  /isMobile\s*:\s*true/.test(harness),
  "PERF_MOBILE=1 must set isMobile: true — mobile media queries depend on it",
);
assert(
  /hasTouch\s*:\s*true/.test(harness),
  "PERF_MOBILE=1 must set hasTouch: true — pointer/hover branches depend on it",
);
assert(
  /iPhone|Mobile\/15E148|Safari\/604/.test(harness),
  "PERF_MOBILE=1 must send an iOS Safari userAgent",
);

// 9 — PERF_CPU_THROTTLE routes through CDP Emulation.setCPUThrottlingRate.
// A number in the env, forwarded to a CDP session on the tab.
assert(
  harness.includes("PERF_CPU_THROTTLE"),
  "harness must read PERF_CPU_THROTTLE — CPU throttle is a first-class env flag",
);
assert(
  harness.includes("Emulation.setCPUThrottlingRate"),
  "PERF_CPU_THROTTLE must be applied via CDP Emulation.setCPUThrottlingRate",
);
assert(
  harness.includes("newCDPSession"),
  "PERF_CPU_THROTTLE must open a CDP session on the page to send the throttle",
);

// 10 — the JSON output carries `mode`, `mobile`, and `cpu_throttle`.
// The verifier reads these to confirm which regime a given measurement
// came from — a prod-mode number labeled `mode: "dev"` is a lie.
for (const field of ["mode", "mobile", "cpu_throttle"]) {
  assert(
    new RegExp(`${field}\\s*:`).test(harness),
    `harness JSON must include the \`${field}\` field so the regime is legible`,
  );
}

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
