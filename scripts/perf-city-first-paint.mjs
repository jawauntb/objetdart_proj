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
 *   mode             — "dev" or "prod" (see PERF_MODE below)
 *   mobile           — false or true (see PERF_MOBILE below)
 *   cpu_throttle     — 1 (unthrottled) or rate N (see PERF_CPU_THROTTLE)
 *
 * ── how to run ─────────────────────────────────────────────────────────
 *   PERF_URL=http://localhost:3000/city npm run perf:city-first-paint
 * or against a Vercel preview URL:
 *   PERF_URL=https://<preview>.vercel.app/city npm run perf:city-first-paint
 *
 * ── env flags the brief requires ───────────────────────────────────────
 *   PERF_MODE=prod
 *     The harness spawns `next build` and `next start -p ${PERF_PROD_PORT
 *     :-3001}` before launching Chromium, waits for the server to answer,
 *     and tears both children down on exit. PERF_URL is ignored in this
 *     mode — the harness targets http://localhost:${PERF_PROD_PORT}/city.
 *     Dev-server compile jitter and HMR websocket traffic are confounders
 *     the brief's 60s tail cannot tolerate; prod mode removes them.
 *     Set PERF_PROD_SKIP_BUILD=1 to reuse an existing .next build (useful
 *     when the same build feeds several harness runs).
 *
 *   PERF_MOBILE=1
 *     Chromium context is created with viewport 390x844 (iPhone 12 CSS
 *     pixels), deviceScaleFactor 3, isMobile true, hasTouch true, and an
 *     iOS Safari 17 userAgent. This is the closest a desktop Chromium can
 *     come to the brief's iPhone 12-class target without a device farm.
 *
 *   PERF_CPU_THROTTLE=<rate>
 *     Emulation.setCPUThrottlingRate over CDP at rate N. 4 approximates
 *     iPhone 12 on desktop Chrome per WebPageTest calibration. Combine
 *     with PERF_MOBILE=1 for the mobile-class simulation the 60fps target
 *     was written against. Rate 1 is a no-op (default).
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
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Playwright is installed globally on the ops machine, not as a dep of this
// repo — the same pattern every other playwright script in scripts/ uses.
const globalRequire = createRequire("/usr/local/lib/node_modules/");
const { chromium } = globalRequire("playwright");

const PERF_MODE = (process.env.PERF_MODE || "dev").toLowerCase();
const PERF_MOBILE = process.env.PERF_MOBILE === "1";
const PERF_CPU_THROTTLE = Number(process.env.PERF_CPU_THROTTLE || 1);
const PERF_PROD_PORT = Number(process.env.PERF_PROD_PORT || 3001);
const PERF_PROD_SKIP_BUILD = process.env.PERF_PROD_SKIP_BUILD === "1";
const IDLE_MS = Number(process.env.PERF_IDLE_MS || 30000);
const NAV_TIMEOUT_MS = Number(process.env.PERF_NAV_TIMEOUT_MS || 30000);
const BUILD_TIMEOUT_MS = Number(process.env.PERF_BUILD_TIMEOUT_MS || 300000);
const START_TIMEOUT_MS = Number(process.env.PERF_START_TIMEOUT_MS || 60000);
const OUT_PATH = process.env.PERF_OUT || "";

// In prod mode we ignore PERF_URL and drive the port the harness owns —
// otherwise a stale env var could point us at a dev server and the
// "prod" label on the JSON would be a lie.
const URL_BASE = PERF_MODE === "prod"
  ? `http://localhost:${PERF_PROD_PORT}/city`
  : (process.env.PERF_URL || "http://localhost:3000/city");

// iPhone 12 CSS viewport + Safari 17 user agent. `deviceScaleFactor: 3`
// matches the device's actual DPR so the room's DPR-clamp path is
// exercised; `isMobile` and `hasTouch` flip the touch-first branches
// pointer/hover media queries and any UA-sniffing libs read.
const MOBILE_CONTEXT = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 " +
    "Mobile/15E148 Safari/604.1",
};

// 1280x800 mirrors the MacBook Air M1 baseline the brief asks for.
const DESKTOP_CONTEXT = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
};

// Append the devtools probe flag exactly once, whether the caller
// passed a URL with existing query or not.
function withProbeFlag(url) {
  const u = new URL(url);
  u.searchParams.set("__perf", "1");
  return u.toString();
}

// Wait for an HTTP GET to return any 2xx/3xx/4xx (a 404 still means the
// server is answering). Polls until the deadline, then throws so the
// caller can tear down and exit 2 instead of hanging on page.goto.
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      // Any response — the server is listening. Content check is the
      // page.goto stage's problem, not ours.
      if (res.status < 500) return;
      lastErr = new Error(`server returned ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await delay(500);
  }
  throw new Error(`server at ${url} did not answer within ${timeoutMs}ms: ${lastErr}`);
}

// Run `next build` once. Streams stderr to our stderr so a compile
// error is visible; returns when the child exits 0, throws otherwise.
function runNextBuild(timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["next", "build"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    let stderrBuf = "";
    child.stdout.on("data", () => { /* build log noise — swallow */ });
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderrBuf += s;
      process.stderr.write(`[next build] ${s}`);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`next build exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`next build exited ${code}: ${stderrBuf.slice(-400)}`));
    });
  });
}

// Spawn `next start -p <port>`. Returns the child handle so main() can
// kill it on exit; the caller waits for the server via waitForServer.
function spawnNextStart(port) {
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    detached: false,
  });
  child.stdout.on("data", () => { /* startup log noise — swallow */ });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[next start] ${chunk.toString()}`);
  });
  return child;
}

async function main() {
  // ── prod-mode preflight ────────────────────────────────────────────
  // We spawn build + start BEFORE launching Chromium so a failed build
  // fails fast without booting an expensive headless GL stack.
  let nextChild = null;
  if (PERF_MODE === "prod") {
    if (!PERF_PROD_SKIP_BUILD) {
      await runNextBuild(BUILD_TIMEOUT_MS);
    }
    nextChild = spawnNextStart(PERF_PROD_PORT);
    try {
      await waitForServer(`http://localhost:${PERF_PROD_PORT}/`, START_TIMEOUT_MS);
    } catch (err) {
      if (nextChild) { try { nextChild.kill("SIGKILL"); } catch {} }
      throw err;
    }
  } else if (PERF_MODE !== "dev") {
    throw new Error(`PERF_MODE must be "dev" or "prod", got "${PERF_MODE}"`);
  }

  const url = withProbeFlag(URL_BASE);
  const started = Date.now();
  const browser = await chromium.launch({
    headless: true,
    // ignore-gpu-blocklist so a headless GPU stack can present through
    // ANGLE where available — falls back to swiftshader if not.
    args: ["--ignore-gpu-blocklist", "--enable-webgl", "--use-gl=angle"],
  });
  const context = await browser.newContext(
    PERF_MOBILE ? MOBILE_CONTEXT : DESKTOP_CONTEXT,
  );
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT_MS);

  // CPU throttling is a CDP-only knob. Rate 1 is a no-op — we still set
  // it explicitly so the JSON's `cpu_throttle: 1` is a truth, not a
  // guess about what the browser is doing.
  if (Number.isFinite(PERF_CPU_THROTTLE) && PERF_CPU_THROTTLE > 0) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: PERF_CPU_THROTTLE });
  }

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

  let firstPaintMs = 0;
  let sample = null;
  try {
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

    firstPaintMs = await page.evaluate(() => window.__cityPerf.firstPaintMs);

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
    sample = await page.evaluate(async (idleMs) => {
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
  } finally {
    await browser.close().catch(() => {});
    if (nextChild) {
      try { nextChild.kill("SIGTERM"); } catch {}
      // Give next start a beat to exit cleanly; escalate if it doesn't.
      await delay(1000);
      try { nextChild.kill("SIGKILL"); } catch {}
    }
  }

  const wallMs = Date.now() - started;
  const result = {
    url,
    ok: pageErrors.length === 0,
    mode: PERF_MODE,
    mobile: PERF_MOBILE,
    cpu_throttle: PERF_CPU_THROTTLE,
    wall_ms: wallMs,
    first_paint_ms: Math.round(firstPaintMs),
    ...(sample || {}),
    // Round the sample stats for stable diffs in PR bodies.
    avg_frame_ms: sample ? round2(sample.avg_frame_ms) : 0,
    p50_frame_ms: sample ? round2(sample.p50_frame_ms) : 0,
    p95_frame_ms: sample ? round2(sample.p95_frame_ms) : 0,
    p99_frame_ms: sample ? round2(sample.p99_frame_ms) : 0,
    dropped_pct: sample ? round2(sample.dropped_pct) : 0,
    heap_mb: sample && sample.heap_mb != null ? round2(sample.heap_mb) : null,
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
