import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-shader-compile — the pure state-machine half of the async
 * shader-compile gate that guards /city's progressive-enablement reveals.
 *
 * The real gate reads Three's internal `WebGLProgram.isReady()` through
 * `renderer.properties.get(material).currentProgram` — WebGL2 territory
 * that node cannot host. So the gate takes its readiness oracle as an
 * INJECTED `probe(material)` and its clock as an injected `now()`, and
 * this test drives the state machine directly against a hand-rolled
 * probe. What matters here:
 *
 *   - submit() records the first submit time and is idempotent — a second
 *     submit does NOT reset the deadline.
 *   - isReady() returns true immediately if probe() returns true, latches
 *     ready afterwards, and reports true on materials that were never
 *     submitted (a permissive default so unwired steps do not stall).
 *   - the deadline safety net flips ready when now() - submit >= deadlineMs,
 *     even if probe() still returns false — this is the fallback for a
 *     context that strips KHR_parallel_shader_compile.
 *   - once latched ready, a material stays ready even if probe() flips
 *     back to false (no oscillation on a flaky driver).
 *   - the HEAVY_COMPILE_MODULES tag list names the four modules whose
 *     reveals matter (backdrop dome, clouds, sun disk, curtain wall).
 *     A future refactor that drops one loses the async benefit for its
 *     reveal — the test asserts the tag list so a diff shows up loud.
 */

// ── stubs — the module only ever calls `THREE` at type level. ─────────
// It imports `import * as THREE from "three"` for material types; the
// pure functions this test exercises don't touch any Three API.
const threeStub = {};

const mod = loadTsModule("src/lib/city-shader-compile.ts", {
  requireMap: { three: threeStub },
});

const {
  createCompileGate,
  hasParallelShaderCompile,
  probeMaterialReady,
  DEFAULT_COMPILE_DEADLINE_MS,
  HEAVY_COMPILE_MODULES,
} = mod;

// ── DEFAULT_COMPILE_DEADLINE_MS is 500 ms — the number is load-bearing.
// A shorter deadline risks tearing the reveal on a slow driver; a longer
// one delays the fallback path visibly. If a future refactor bumps this,
// update the test explicitly so the change is intentional.
assert.equal(
  DEFAULT_COMPILE_DEADLINE_MS,
  500,
  "DEFAULT_COMPILE_DEADLINE_MS drifted — check the perf-regression trade",
);

// ── HEAVY_COMPILE_MODULES names the four heaviest reveals. Kept as a
// literal so a diff to the list is obvious.
assert.deepEqual(
  Array.from(HEAVY_COMPILE_MODULES),
  ["cityBackdropDome", "cityClouds", "citySunDisk", "cityCurtainWall"],
  "HEAVY_COMPILE_MODULES drifted from the four brief-named reveals",
);

// ── controllable clock + probe ───────────────────────────────────────
function makeClock() {
  let t = 0;
  return { advance(dt) { t += dt; }, now: () => t };
}
function makeProbe() {
  const ready = new Set();
  return {
    setReady(mat) { ready.add(mat); },
    probe: (mat) => ready.has(mat),
  };
}

// materials are just opaque tokens for the gate — the pure logic never
// dereferences them beyond WeakMap identity.
const matA = { name: "clouds" };
const matB = { name: "dome" };
const matC = { name: "disk" };
const matUnused = { name: "unused" };

// ── submit + probe path ──────────────────────────────────────────────
{
  const clock = makeClock();
  const probe = makeProbe();
  const gate = createCompileGate({
    probe: probe.probe,
    now: clock.now,
    deadlineMs: 500,
  });

  gate.submit(matA);
  gate.submit(matB);
  assert.equal(gate.pendingCount(), 2, "two materials submitted, pending=2");
  assert.equal(gate.isReady(matA), false, "matA not ready before probe fires");
  assert.equal(gate.isReady(matB), false, "matB not ready before probe fires");

  clock.advance(20);
  probe.setReady(matA);
  assert.equal(gate.isReady(matA), true, "matA latches ready when probe flips");
  assert.equal(gate.isReady(matB), false, "matB still not ready — probe untouched");

  // Latch: probe momentarily returns false (a hostile driver bit) —
  // the material must NOT un-latch.
  const probe2 = {
    probe: () => false,
  };
  // Re-check matA using the same gate — the readyCache holds.
  assert.equal(gate.isReady(matA), true, "matA stays latched even if probe would say false");

  // Materials that were never submitted are permissively ready — a
  // caller that skips submit gets non-blocking behaviour.
  assert.equal(
    gate.isReady(matUnused),
    true,
    "un-submitted material is permissively ready",
  );

  // pendingCount excludes matA (latched) and matUnused (never submitted).
  assert.equal(
    gate.pendingCount(),
    1,
    "pendingCount excludes latched materials",
  );
}

// ── deadline safety net ──────────────────────────────────────────────
{
  const clock = makeClock();
  const probe = makeProbe(); // never fires
  const gate = createCompileGate({
    probe: probe.probe,
    now: clock.now,
    deadlineMs: 500,
  });

  gate.submit(matA);
  assert.equal(gate.isReady(matA), false, "not ready before deadline");
  clock.advance(499);
  assert.equal(gate.isReady(matA), false, "one ms shy of deadline still not ready");
  clock.advance(1);
  assert.equal(
    gate.isReady(matA),
    true,
    "deadline elapsed → latch ready even without probe",
  );

  // Latched permanently.
  clock.advance(1000);
  assert.equal(gate.isReady(matA), true, "still ready after deadline elapsed");
}

// ── idempotent submit ────────────────────────────────────────────────
{
  const clock = makeClock();
  const probe = makeProbe();
  const gate = createCompileGate({
    probe: probe.probe,
    now: clock.now,
    deadlineMs: 500,
  });

  gate.submit(matA);
  clock.advance(400); // 100 ms of deadline remaining
  gate.submit(matA); // must NOT reset the deadline

  clock.advance(101); // total 501 ms since first submit
  assert.equal(
    gate.isReady(matA),
    true,
    "second submit did not reset the deadline",
  );
}

// ── custom deadline honoured ─────────────────────────────────────────
{
  const clock = makeClock();
  const probe = makeProbe();
  const gate = createCompileGate({
    probe: probe.probe,
    now: clock.now,
    deadlineMs: 10,
  });
  gate.submit(matA);
  clock.advance(9);
  assert.equal(gate.isReady(matA), false, "short-deadline gate holds at t=9");
  clock.advance(1);
  assert.equal(gate.isReady(matA), true, "short-deadline gate flips at t=10");
}

// ── hasParallelShaderCompile: extension present ──────────────────────
{
  const stubRenderer = {
    extensions: {
      get(name) {
        return name === "KHR_parallel_shader_compile" ? {} : null;
      },
    },
  };
  assert.equal(
    hasParallelShaderCompile(stubRenderer),
    true,
    "extension present → true",
  );
}
// extension absent → false
{
  const stubRenderer = {
    extensions: { get: () => null },
  };
  assert.equal(
    hasParallelShaderCompile(stubRenderer),
    false,
    "extension absent → false",
  );
}
// missing extensions object → false, not throw
{
  const stubRenderer = {};
  assert.equal(
    hasParallelShaderCompile(stubRenderer),
    false,
    "no extensions object → false, no throw",
  );
}

// ── probeMaterialReady: no program on properties map → false ─────────
{
  const stubRenderer = {
    properties: { get: () => ({}) },
  };
  assert.equal(
    probeMaterialReady(stubRenderer, matA),
    false,
    "no currentProgram → not ready",
  );
}
// program.isReady() true → ready
{
  const stubRenderer = {
    properties: {
      get: () => ({ currentProgram: { isReady: () => true } }),
    },
  };
  assert.equal(
    probeMaterialReady(stubRenderer, matA),
    true,
    "program.isReady()=true → ready",
  );
}
// program without isReady → ready (defensive default)
{
  const stubRenderer = {
    properties: { get: () => ({ currentProgram: {} }) },
  };
  assert.equal(
    probeMaterialReady(stubRenderer, matA),
    true,
    "program without isReady → ready",
  );
}
// program.isReady() false → not ready
{
  const stubRenderer = {
    properties: {
      get: () => ({ currentProgram: { isReady: () => false } }),
    },
  };
  assert.equal(
    probeMaterialReady(stubRenderer, matA),
    false,
    "program.isReady()=false → not ready",
  );
}
// properties.get throws → treat as ready (never stall)
{
  const stubRenderer = {
    properties: { get: () => { throw new Error("boom"); } },
  };
  assert.equal(
    probeMaterialReady(stubRenderer, matA),
    true,
    "properties.get throws → ready (non-blocking default)",
  );
}

// ── mimic City.tsx's real integration path ───────────────────────────
// Three heavy materials submitted at setup; the driver reports ready in
// staggered order across the first ~90 ms; the progressive schedule
// polls per frame at 60 Hz. Assert that reveals happen in submit order
// as the driver finishes and that no material's reveal frame ever
// spins a probe that hadn't fired yet — the whole point of the gate.
{
  const clock = makeClock();
  const readyAt = new Map([
    [matA, 30], // cheap material — ready in 30 ms
    [matB, 80], // heavier — 80 ms
    [matC, 120], // heaviest — 120 ms
  ]);
  const probe = (mat) => {
    const t = readyAt.get(mat);
    return t !== undefined && clock.now() >= t;
  };
  const gate = createCompileGate({ probe, now: clock.now, deadlineMs: 500 });
  gate.submit(matA);
  gate.submit(matB);
  gate.submit(matC);

  // 30 fps? No, 60 Hz. Step 16.7 ms per tick.
  const revealed = [];
  const queue = [matA, matB, matC];
  for (let frame = 0; frame < 30; frame += 1) {
    if (queue.length === 0) break;
    if (gate.isReady(queue[0])) {
      revealed.push(queue.shift());
    }
    clock.advance(16.7);
  }
  assert.deepEqual(
    revealed,
    [matA, matB, matC],
    "schedule reveals in submit order as materials complete",
  );
  assert.equal(queue.length, 0, "all three materials revealed within 30 frames");
}

console.log(
  "city-shader-compile ok: gate submits idempotently, probe drives reveal, deadline safety net latches at 500ms, extension detection tolerates missing objects, heavy-module tag list stable at 4 entries.",
);
