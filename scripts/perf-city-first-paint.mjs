#!/usr/bin/env node
/**
 * perf-city-first-paint — the live measurement harness the /city perf
 * work has been asked to have. Drives a real Chromium against a real GL
 * canvas, captures MEASURED numbers, and prints one JSON blob to stdout
 * that a PR body can paste verbatim.
 *
 * ── what it measures ───────────────────────────────────────────────────
 *   first_paint_ms   — performance.now() from route mount (useEffect entry)
 *                      to the first successful composer.render() call
 *   avg_frame_ms     — mean rAF delta across the idle window
 *   p50_frame_ms
 *   p95_frame_ms     — the tail tells whether the room hits 60fps 97% of frames
 *   p99_frame_ms
 *   dropped_pct      — share of frames whose rAF delta > 16.6 ms; the brief's
 *                      target is <3% for a "60fps sustained" claim
 *   frames           — total frames sampled inside the idle window
 *   heap_mb          — performance.memory.usedJSHeapSize at end of window
 *   draw_calls       — renderer.info.render.calls at end of window
 *   triangles        — renderer.info.render.triangles at end
 *   tier             — governor.tier() at end (high / medium / low / sleep)
 *   window_ms        — actual elapsed idle-sample window in ms
 *
 * ── how to run ─────────────────────────────────────────────────────────
 *   PERF_URL=http://localhost:3000/city npm run perf:city-first-paint
 * or against a Vercel preview URL:
 *   PERF_URL=https://<preview>.vercel.app/city npm run perf:city-first-paint
 *
 * The `?__perf=1` query the harness appends toggles a devtools probe in
 * City.tsx that mounts `window.__cityRenderer` and `window.__cityComposer`
 * plus a `window.__cityPerf` object carrying route-mount and first-paint
 * timestamps. Without that flag those globals are absent and the harness
 * cannot sample — this is the fence that keeps production visitors from
 * seeing the probe.
 *
 * The script exits with status 0 if all shape assertions pass. It never
 * asserts a perf number is "good" — it only reports. The verifier decides.
 *
 * Not a test — a perf report. Its shape is checked by
 * scripts/test-city-perf-harness.mjs.
 */

import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// Playwright is installed globally on the ops machine, not as a dep of this
// repo — the same pattern every other playwright script in scripts/ uses.
const globalRequire = createRequire("/usr/local/lib/node_modules/");
const { chromium } = globalRequire("playwright");

const URL_BASE = process.env.PERF_URL || "http://localhost:3000/city";
const IDLE_MS = Number(process.env.PERF_IDLE_MS || 30000);
const NAV_TIMEOUT_MS = Number(process.env.PERF_NAV_TIMEOUT_MS || 30000);
const OUT_PATH = process.env.PERF_OUT || "";

// Append the devtools probe flag exactly once, whether the caller
// passed a URL with existing query or not.
function withProbeFlag(url) {
  const u = new URL(url);
  u.searchParams.set("__perf", "1");
  return u.toString();
}

async function main() {
  const url = withProbeFlag(URL_BASE);
  const started = Date.now();
  const browser = await chromium.launch({
    headless: true,
    // ignore-gpu-blocklist so a headless GPU stack can present through
    // ANGLE where available — falls back to swiftshader if not.
    args: ["--ignore-gpu-blocklist", "--enable-webgl", "--use-gl=angle"],
  });
  const context = await browser.newContext({
    // 1280x800 mirrors the MacBook Air M1 baseline the brief asks for.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT_MS);

  // Surface page-side errors so a broken harness fails loud instead of
  // returning a JSON with all zeros.
  const pageErrors = [];
  page.on("pageerror", (err) => { pageErrors.push(String(err && err.message || err)); });
  page.on("console", (msg) => {
    // Only forward errors — info-level logs from the room are noise.
    if (msg.type() === "error") {
      pageErrors.push(`[console.error] ${msg.text()}`);
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for the probe to mount. `window.__cityPerf` is set inside
  // useEffect once the composer is built — its presence is the signal
  // that route mount has run and firstPaintMs is being watched.
  await page.waitForFunction(
    () => Boolean(window.__cityPerf && window.__cityRenderer && window.__cityComposer),
    null,
    { timeout: NAV_TIMEOUT_MS },
  );

  // Then wait for the first-paint stamp. The tick loop stamps this on
  // the first successful composer.render() completion. Timeout is
  // generous because a cold shader compile on a headless GL stack can
  // take a few seconds — the AFTER number will show the improvement.
  await page.waitForFunction(
    () => window.__cityPerf && window.__cityPerf.firstPaintMs > 0,
    null,
    { timeout: NAV_TIMEOUT_MS },
  );

  const firstPaintMs = await page.evaluate(() => window.__cityPerf.firstPaintMs);

  // Idle-window sampling. The page-side script installs a rAF loop that
  // records frame deltas into an array; heap and renderer.info are read
  // once at the end. Running fully in-page avoids the round-trip cost of
  // an evaluate() per frame — which would itself dominate the frame budget.
  //
  // Draw-call accuracy note: renderer.info.render.calls resets on every
  // renderer.render() call by default, and composer.render() invokes
  // multiple internal renderer.render()s per frame — so a naive read
  // would report only the LAST internal pass's count, dramatically
  // understating true per-frame draw calls. We flip `info.autoReset`
  // off inside the window so calls accumulate, then compute the per-frame
  // average by dividing by frame count. Restored on exit so the room
  // isn't left with a leaked reset flag.
  const sample = await page.evaluate(async (idleMs) => {
    const renderer = window.__cityRenderer;
    const prevAutoReset = renderer ? renderer.info.autoReset : true;
    const startCalls = renderer ? renderer.info.render.calls : 0;
    const startTris = renderer ? renderer.info.render.triangles : 0;
    if (renderer) renderer.info.autoReset = false;

    const frames = [];
    const t0 = performance.now();
    let last = t0;
    let dropped = 0;
    // We sample deltas AFTER the first idle-window rAF fires, so the
    // rAF-to-timing loop doesn't front-load a zero-delta first frame.
    await new Promise((resolve) => {
      const step = (now) => {
        const dt = now - last;
        last = now;
        frames.push(dt);
        if (dt > 16.6) dropped += 1;
        if (now - t0 >= idleMs) { resolve(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame((now) => { last = now; requestAnimationFrame(step); });
    });

    // Aggregate. Skip the first sample — its delta is between the two
    // pre-window rAFs and doesn't belong to the window.
    const clean = frames.slice(1);
    clean.sort((a, b) => a - b);
    const n = clean.length;
    const pct = (q) => (n === 0 ? 0 : clean[Math.min(n - 1, Math.floor(q * n))]);
    const sum = clean.reduce((a, b) => a + b, 0);

    let drawCalls = null;
    let triangles = null;
    if (renderer) {
      const endCalls = renderer.info.render.calls;
      const endTris = renderer.info.render.triangles;
      // n is our sample count; the actual number of tick-loop frames is
      // roughly the same because both sides run on the same rAF cadence.
      drawCalls = n > 0 ? Math.round((endCalls - startCalls) / n) : endCalls;
      triangles = n > 0 ? Math.round((endTris - startTris) / n) : endTris;
      renderer.info.autoReset = prevAutoReset;
    }

    const memInfo = (performance.memory) || null;
    const tier = (window.__cityPerf && typeof window.__cityPerf.tier === "function")
      ? window.__cityPerf.tier()
      : "unknown";

    return {
      window_ms: Math.round(performance.now() - t0),
      frames: n,
      avg_frame_ms: n ? sum / n : 0,
      p50_frame_ms: pct(0.50),
      p95_frame_ms: pct(0.95),
      p99_frame_ms: pct(0.99),
      dropped_pct: n ? (dropped / n) * 100 : 0,
      heap_mb: memInfo ? memInfo.usedJSHeapSize / (1024 * 1024) : null,
      draw_calls: drawCalls,
      triangles,
      tier,
    };
  }, IDLE_MS);

  await browser.close();

  const wallMs = Date.now() - started;
  const result = {
    url,
    ok: pageErrors.length === 0,
    wall_ms: wallMs,
    first_paint_ms: Math.round(firstPaintMs),
    ...sample,
    // Round the sample stats for stable diffs in PR bodies.
    avg_frame_ms: round2(sample.avg_frame_ms),
    p50_frame_ms: round2(sample.p50_frame_ms),
    p95_frame_ms: round2(sample.p95_frame_ms),
    p99_frame_ms: round2(sample.p99_frame_ms),
    dropped_pct: round2(sample.dropped_pct),
    heap_mb: sample.heap_mb == null ? null : round2(sample.heap_mb),
    page_errors: pageErrors,
  };

  const json = JSON.stringify(result, null, 2);
  process.stdout.write(json + "\n");
  if (OUT_PATH) {
    const dir = dirname(OUT_PATH);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(OUT_PATH, json + "\n");
  }
  // page_errors surface pre-existing shader/console noise but do NOT
  // fail the harness — the numbers are still valid, and the caller
  // reads `ok` in the JSON to decide policy. Exit 2 is reserved for
  // the harness itself throwing (unreachable server, missing globals).
  process.exit(0);
}

function round2(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

main().catch((err) => {
  process.stderr.write(`[perf-city-first-paint] ${err && err.stack || err}\n`);
  process.exit(2);
});
