// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.route.
// One LLM slot below carries the pins; the loader boilerplate is verbatim.

// The /spring laws. Every assertion names the bug it catches — a
// test that only restates a constant back at itself is not a test.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function loadTsModule(path) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", code)(module, module.exports, (id) => {
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  });
  return module.exports;
}

const M = loadTsModule("src/lib/springflow.ts");

const near = (a, b, rel, msg) =>
  assert.ok(
    Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)),
    `${msg} (got ${a}, want ~${b}, diff ${Math.abs(a - b)} > ${rel * Math.max(1, Math.abs(b))})`,
  );

const abs = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} (|${a} - ${b}| = ${Math.abs(a - b)} > ${tol})`);

// —— HEAD → PITCH IS A TRUE ROUND-TRIP ———————————————————————————————
// The room's central legibility claim: from the ring alone you recover the
// head. The bug this catches: a "pitch" that only reacts to the head
// instead of encoding it — a soil-timbre map with no inverse.
{
  for (const H of [0, 0.1, 0.4, 0.6, 0.8, 1.0, 1.4, -0.2, 2.0]) {
    const hz = M.ringHzFor(H);
    abs(M.headForRingHz(hz), H, 1e-12, `H → hz → H at H = ${H}`);
    assert.ok(hz > 0, "the pitch is always a real frequency");
  }
  for (const hz of [55, 110, 220, 440, 880, 1760]) {
    const H = M.headForRingHz(hz);
    abs(M.ringHzFor(H), hz, 1e-9, `hz → H → hz at hz = ${hz}`);
  }
  // Monotone increasing across a sweep — a fold in the map would break the
  // room's claim that two rings of the same note come from the same depth.
  let lastHz = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const H = -0.2 + (i / 20) * 1.6;
    const hz = M.ringHzFor(H);
    assert.ok(hz > lastHz, `ringHzFor monotone increasing at H = ${H.toFixed(2)}`);
    lastHz = hz;
  }
  // Base and octave calibration, computable by hand: hz(0) = base, and every
  // PITCH_SCALE_M of head doubles the pitch.
  abs(M.ringHzFor(0), M.PITCH_BASE_HZ, 1e-12, "H = 0 rings at the base pitch");
  abs(M.ringHzFor(M.PITCH_SCALE_M) / M.PITCH_BASE_HZ, 2, 1e-12, "one scale of head is one octave");
}

// —— MASS IS CONSERVED ACROSS A STABLE HOUR ————————————————————————
// The strongest claim the two-cell ledger makes. A stable climate where L
// stays below L_lip: total water = W·dt − E·dt, exactly. A leak here shows
// the eigen-decomposition is off, or the closed form has a term that
// invents or destroys water.
{
  const s0 = M.initState(0x501);
  const dt = 3600;
  // Choose warm and wet at their midpoint so the pool cannot reach the lip
  // in one hour: L(t) is bounded by (Σ_0 + |W − E|·dt)/2, well under L_LIP.
  const climate = { warmth: 0.4, wet: 0.6 };
  const W = M.rechargeRate(climate);
  const E = M.evaporationRate(climate);
  const s1 = M.advanceExact(s0, dt, climate);
  assert.ok(s1.L < M.L_LIP, "the lip stayed dry in this hour, so the ledger's law is exact");
  const expectedDelta = (W - E) * dt;
  abs(
    M.totalWater(s1) - M.totalWater(s0),
    expectedDelta,
    1e-12,
    "total water is Σ_0 + (W − E)·dt when the lip is dry",
  );
  // Time advanced by exactly the span lived — a Euler catch-up would drift.
  abs(s1.tau, s0.tau + dt, 1e-12, "tau advances by exactly the span");
}

// —— TWO SEEPS DRAW THE AQUIFER DOWN AT EXACTLY 2× ONE ————————————
// The eigen-decomposition means the head↔pool exchange rate scales linearly
// with the total throat. Two identical seeps ⇒ 2× the S ⇒ 2× the rate the
// head departs from a matched pool.
{
  // Two isolated states: same head, same pool, one has one seep and one has
  // two identical seeps. A calm climate (W = E = 0), and we look at ΔH.
  const seed = 0x1234;
  const base = { H: 0.8, L: 0.2, tau: 0, seeps: [], seedKey: seed };
  const one = M.plantSeep(base, 0.5, 0.5, 0.4);
  const two = M.plantSeep(one, 0.7, 0.5, 0.4);
  const calm = { warmth: 0, wet: 0 };
  const dt = 1; // one second, so the leading-order ΔD ≈ 2S·D·dt is tight
  const oneAfter = M.advanceExact(one, dt, calm);
  const twoAfter = M.advanceExact(two, dt, calm);
  const dH1 = one.H - oneAfter.H;
  const dH2 = two.H - twoAfter.H;
  // The 2× claim: ΔH is dominated by S·D_0·dt at leading order, and S doubles.
  near(dH2, 2 * dH1, 1e-3, "two seeps of the same throat draw the head down twice as fast");
  // And no water was lost: both are conservative in this hour (no lip, no rain, no sun).
  abs(
    M.totalWater(oneAfter) - M.totalWater(one),
    0,
    1e-12,
    "one seep, calm sky: no water made or lost",
  );
  abs(
    M.totalWater(twoAfter) - M.totalWater(two),
    0,
    1e-12,
    "two seeps, calm sky: no water made or lost",
  );
}

// —— MAX_ELAPSED_S CAPS A CENTURY-BUG ——————————————————————————————
// A month away is not a century of drift: the same law that world.ts uses.
{
  const s0 = M.initState(0x77);
  const climate = { warmth: 0.4, wet: 0.4 };
  const capped = M.advanceExact(s0, M.MAX_ELAPSED_S + 3600, climate);
  const atCap = M.advanceExact(s0, M.MAX_ELAPSED_S, climate);
  abs(capped.H, atCap.H, 1e-15, "advancing past the cap lands where advancing to it lands");
  abs(capped.L, atCap.L, 1e-15, "in both cells");
  abs(capped.tau, s0.tau + M.MAX_ELAPSED_S, 1e-15, "and tau is clamped to the cap");
  // Negative or zero spans are the identity — time does not run backwards.
  assert.equal(M.advanceExact(s0, -5, climate), s0, "a negative span is the identity");
  assert.equal(M.advanceExact(s0, 0, climate), s0, "no span, no change");
}

// —— DEEPEN WIDENS THE THROAT AND THE FLUX ————————————————————————
// The dwell's contract: a longer press is a wider seep. The flux the shader
// reads must move the same way — otherwise the wet-halo lies about the head.
{
  const seed = 0xa1;
  const base = { H: 0.9, L: 0.2, tau: 0, seeps: [], seedKey: seed };
  const planted = M.plantSeep(base, 0.5, 0.5, 0.1);
  const id = planted.seeps[0].id;
  let s = planted;
  let lastThroat = s.seeps[0].throat;
  let lastFlux = -1;
  const climate = { warmth: 0.4, wet: 0.4 };
  for (const step of [0.1, 0.15, 0.2, 0.25]) {
    s = M.deepenSeep(s, id, step);
    assert.ok(s.seeps[0].throat > lastThroat, `deepen strictly widened at +${step}`);
    lastThroat = s.seeps[0].throat;
    // Advance a small span so flux is reported, and read it back.
    const after = M.advanceExact(s, 60, climate);
    assert.ok(
      after.seeps[0].flux >= lastFlux,
      `wider throat means at-least-as-much flux (throat ${lastThroat.toFixed(3)})`,
    );
    lastFlux = after.seeps[0].flux;
  }
  // The ceiling holds: no dtheta can push a throat past MAX_THROAT.
  const filled = M.deepenSeep(s, id, 999);
  abs(
    filled.seeps[0].throat,
    M.MAX_THROAT,
    1e-15,
    "the ceiling holds — a throat cannot exceed MAX_THROAT",
  );
}

// —— A DROUGHT EMPTIES THE AQUIFER ————————————————————————————————
// A day of drought under an open seep must lower the head. The bug: a
// climate that only decorates the ledger without moving it.
{
  const s0 = M.initState(0xdead);
  // Ensure at least one open seep; initState plants one but we set warmth
  // high and wet low so the sun genuinely wins.
  const drought = { warmth: 1, wet: 0.02 };
  const after = M.advanceExact(s0, 24 * 3600, drought);
  assert.ok(after.H < s0.H, "a day of drought lowers the aquifer head");
  assert.ok(after.L < s0.L, "and the pool with it");
  // A wet fortnight refills what the drought took — the aliveness claim.
  const rain = M.advanceExact(after, 14 * 24 * 3600, { warmth: 0.15, wet: 1 });
  assert.ok(rain.H > after.H, "a wet fortnight refills the aquifer");
}

// —— PLANTSEEP REFUSES OUTSIDE THE POOL, AND HITS THE CAP CORRECTLY —————
// The pool has real bounds; a hand cannot breach bedrock or the sky.
{
  const s0 = { H: 0.5, L: 0.3, tau: 0, seeps: [], seedKey: 0x2 };
  // Above the waterline (in the air): no seep.
  const above = M.plantSeep(s0, 0.5, 0.05, 0.2);
  assert.equal(above.seeps.length, 0, "a seep cannot be planted in the air");
  // Below the bedrock floor: no seep.
  const below = M.plantSeep(s0, 0.5, 0.99, 0.2);
  assert.equal(below.seeps.length, 0, "…and not through the floor of the section");
  // In-pool: a seep with a stable id and a deterministic phase.
  const inside = M.plantSeep(s0, 0.5, 0.5, 0.2);
  assert.equal(inside.seeps.length, 1, "the pool accepts what the hand offered");
  assert.equal(inside.seeps[0].id, 1, "the first seep has id 1");
  assert.equal(
    inside.seeps[0].phase,
    M.plantSeep(s0, 0.5, 0.5, 0.2).seeps[0].phase,
    "the same seed grows the same phase",
  );
  // Population cap.
  let capped = s0;
  for (let i = 0; i < M.MAX_SEEPS + 4; i++) {
    capped = M.plantSeep(
      capped,
      M.POOL_X_MIN + ((i * 0.05) % (M.POOL_X_MAX - M.POOL_X_MIN)),
      M.POOL_Y_MIN + 0.1,
      0.1,
    );
  }
  assert.equal(capped.seeps.length, M.MAX_SEEPS, "the section holds its population cap");
  assert.equal(
    new Set(capped.seeps.map((s) => s.id)).size,
    M.MAX_SEEPS,
    "every seep keeps its own id",
  );
}

// —— sealSeep is the ceremony ————————————————————————————————————
// A sealed seep opens to full throat and refuses to narrow. The kept object.
{
  let s = M.plantSeep({ H: 0.7, L: 0.3, tau: 0, seeps: [], seedKey: 0x3 }, 0.5, 0.5, 0.2);
  const id = s.seeps[0].id;
  s = M.sealSeep(s, id);
  assert.equal(s.seeps[0].sealed, true, "the seep is sealed");
  abs(s.seeps[0].throat, M.MAX_THROAT, 1e-15, "and open to the aquifer at full");
  // A sealed seep refuses to narrow.
  const tried = M.deepenSeep(s, id, -0.5);
  abs(tried.seeps[0].throat, M.MAX_THROAT, 1e-15, "a sealed seep does not narrow under a hand");
}

// —— determinism ————————————————————————————————————————————————
{
  assert.deepEqual(M.initState(0xabc), M.initState(0xabc), "the same seed makes the same spring");
  assert.notDeepEqual(
    M.initState(1).seeps[0].phase,
    M.initState(2).seeps[0].phase,
    "different seeds produce different phases",
  );
  const rng1 = M.mulberry32(42);
  const rng2 = M.mulberry32(42);
  for (let i = 0; i < 8; i++) abs(rng1(), rng2(), 0, "mulberry32 is stable per seed");
  // hashSeed is pure and integer-collapsing — the whole determinism story leans on it.
  abs(M.hashSeed(1, 2, 3), M.hashSeed(1, 2, 3), 0, "hashSeed is a function of its inputs");
  assert.notEqual(M.hashSeed(1, 2, 3), M.hashSeed(1, 3, 2), "and order matters");
}

console.log(
  "springflow ok: head ↔ pitch is a true round-trip; the two-cell ledger conserves water " +
    "across a stable hour; two seeps drain twice as fast as one; MAX_ELAPSED_S caps the away " +
    "span; deepen widens throat and flux monotonically; drought empties the aquifer; and the " +
    "pool refuses a seep outside its own bounds",
);
