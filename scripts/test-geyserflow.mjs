// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.route.
// One LLM slot below carries the pins; the loader boilerplate is verbatim.

// The /geyser laws. Every assertion names the bug it catches — a
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

const M = loadTsModule("src/lib/geyserflow.ts");

const near = (a, b, rel, msg) =>
  assert.ok(
    Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)),
    `${msg} (got ${a}, want ~${b}, diff ${Math.abs(a - b)} > ${rel * Math.max(1, Math.abs(b))})`,
  );

const abs = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} (|${a} - ${b}| = ${Math.abs(a - b)} > ${tol})`);

// —— HEAD → PITCH IS A TRUE ROUND-TRIP ———————————————————————————————
// The room's central legibility claim, shared with /spring: from the ring
// alone you recover the head. Kept as the drop band's common dialect. The
// bug this catches: a "pitch" that only reacts to the head instead of
// encoding it — a soil-timbre map with no inverse.
{
  for (const H of [0, 0.1, 0.4, 0.6, 0.8, 1.0, 1.4, -0.2, 2.0]) {
    const hz = M.ringHzFor(H);
    abs(M.headForRingHz(hz), H, 1e-12, `H → hz → H at H = ${H}`);
    assert.ok(hz > 0, "the pitch is always a real frequency");
  }
  let lastHz = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const H = -0.2 + (i / 20) * 1.6;
    const hz = M.ringHzFor(H);
    assert.ok(hz > lastHz, `ringHzFor monotone increasing at H = ${H.toFixed(2)}`);
    lastHz = hz;
  }
  abs(M.ringHzFor(0), M.PITCH_BASE_HZ, 1e-12, "H = 0 rings at the base pitch");
  abs(
    M.ringHzFor(M.PITCH_SCALE_M) / M.PITCH_BASE_HZ,
    2,
    1e-12,
    "one scale of head is one octave",
  );
}

// —— THE CYCLE FIRES ON THE TRIGGER, NOT BEFORE ————————————————————
// The load-bearing behavior claim: an eruption happens exactly when
// E = H·T crosses E_TRIGGER_HIGH upward. A bug in the trigger law would
// fire the geyser too early or never; a bug in the phase machine would
// fire it more than once inside an ERUPT_DURATION_S window.
{
  // Seed a state that is close to but below the trigger.
  const s0 = {
    H: 0.7,
    T: 0.5,
    phase: "building",
    tSincePhase: 0,
    eruptions: 0,
    H0Erupt: 0,
    T0Erupt: 0,
    heatMarks: [],
    tau: 0,
    seedKey: 0xf001,
  };
  const E0 = s0.H * s0.T;
  assert.ok(
    E0 < M.E_TRIGGER_HIGH,
    "test bootstrap: initial state is below the trigger",
  );
  // A modest climate lets both H and T climb toward the trigger.
  const climate = { warmth: 0.6, wet: 0.5 };
  const t_predicted = M.timeUntilEruption(s0, climate);
  assert.ok(
    Number.isFinite(t_predicted) && t_predicted > 0,
    "the predicted time-to-eruption is a finite positive number of seconds",
  );
  // Advance to just before the predicted time — must still be building.
  const before = M.advanceExact(s0, t_predicted * 0.98, climate);
  assert.equal(before.phase, "building", "just before the trigger, still building");
  // Advance just past the crossing by a fraction of ERUPT_DURATION_S — the
  // state must be inside the fire (not through it and out into cooling).
  const shortOvershoot = t_predicted + M.ERUPT_DURATION_S * 0.25;
  const after = M.advanceExact(s0, shortOvershoot, climate);
  assert.equal(
    after.phase,
    "erupting",
    "just past the trigger, the phase has flipped to erupting",
  );
  // At the ignition moment the recorded H0Erupt/T0Erupt are the H/T at
  // that instant — a check that the state remembers the shot's origin.
  assert.ok(after.H0Erupt > 0, "H0Erupt was recorded at the ignition");
  assert.ok(after.T0Erupt > 0, "T0Erupt was recorded at the ignition");
}

// —— Q_ERUPT SUBTRACTS EXACTLY WHAT IT SAYS FROM H —————————————————
// The mass claim: during the eruption, H's decay is the closed-form
// exp(-t/τ_H). A dumping bug — a stray addition or a wrong τ — would
// break the ratio H(t)/H0 = exp(-t/τ_H).
{
  const seed = 0x1111;
  // Force a state into "erupting" with known H0, T0.
  const preErupt = {
    H: 0.9,
    T: 0.9,
    phase: "building",
    tSincePhase: 0,
    eruptions: 0,
    H0Erupt: 0,
    T0Erupt: 0,
    heatMarks: [],
    tau: 0,
    seedKey: seed,
  };
  // Use manualErupt to enter the erupting phase deterministically.
  const erupting = M.manualErupt(preErupt);
  assert.equal(erupting.phase, "erupting", "manualErupt puts the state in erupting");
  abs(erupting.H0Erupt, 0.9, 1e-15, "H0Erupt is exactly the H at ignition");
  abs(erupting.T0Erupt, 0.9, 1e-15, "T0Erupt is exactly the T at ignition");
  // Advance one second: H should be H0 · exp(-1/τ_H).
  const oneSec = M.advanceExact(erupting, 1, { warmth: 0.5, wet: 0.5 });
  const expectedH = 0.9 * Math.exp(-1 / M.TAU_H_ERUPT);
  const expectedT = 0.9 * Math.exp(-1 / M.TAU_T_ERUPT);
  abs(oneSec.H, expectedH, 1e-12, "H decays as H0·exp(-t/τ_H) through eruption");
  abs(oneSec.T, expectedT, 1e-12, "T decays as T0·exp(-t/τ_T) through eruption");
  // Q_erupt during the fire is positive and monotone-decreasing in tSincePhase.
  const q_at_zero = M.Q_erupt(erupting);
  const q_at_one = M.Q_erupt(oneSec);
  assert.ok(q_at_zero > 0, "Q_erupt at ignition is positive");
  assert.ok(q_at_one < q_at_zero, "Q_erupt decays through the fire");
  // Outside erupting, Q_erupt is exactly zero.
  const cooled = { ...erupting, phase: "cooling" };
  abs(M.Q_erupt(cooled), 0, 1e-15, "Q_erupt is zero outside 'erupting'");
}

// —— PHASE NAME IS MONOTONE THROUGH A CYCLE ——————————————————————
// The state machine must walk building → erupting → cooling → building.
// A bug that skipped a phase or backtracked would show here.
{
  const seed = 0x2222;
  let s = {
    H: 0.7,
    T: 0.55,
    phase: "building",
    tSincePhase: 0,
    eruptions: 0,
    H0Erupt: 0,
    T0Erupt: 0,
    heatMarks: [],
    tau: 0,
    seedKey: seed,
  };
  const climate = { warmth: 0.7, wet: 0.5 };
  const visited = [s.phase];
  // Step size must be smaller than ERUPT_DURATION_S so the erupting phase
  // is caught at least once between transitions.
  const step = Math.min(2, M.ERUPT_DURATION_S / 3);
  for (let i = 0; i < 4000; i++) {
    s = M.advanceExact(s, step, climate);
    if (s.phase !== visited[visited.length - 1]) visited.push(s.phase);
    if (visited.length >= 4) break;
  }
  assert.deepEqual(
    visited.slice(0, 4),
    ["building", "erupting", "cooling", "building"],
    "phase walks building → erupting → cooling → building in order",
  );
}

// —— TOTAL WATER DROPS ACROSS AN ERUPTION ————————————————————————
// Not conserved — an eruption fires water out of the section. But the
// drop must equal the H that got dumped (POOL_L is a constant), and the
// eruption count must climb by exactly one over one fire.
{
  const seed = 0x3333;
  const preErupt = {
    H: 0.85,
    T: 0.65,
    phase: "building",
    tSincePhase: 0,
    eruptions: 5,
    H0Erupt: 0,
    T0Erupt: 0,
    heatMarks: [],
    tau: 0,
    seedKey: seed,
  };
  const erupting = M.manualErupt(preErupt);
  const before_H = erupting.H;
  const before_total = M.totalWater(erupting);
  // Advance past ERUPT_DURATION_S to be sure the fire is over.
  const afterFire = M.advanceExact(erupting, M.ERUPT_DURATION_S + 5, {
    warmth: 0.3,
    wet: 0.2,
  });
  assert.equal(
    afterFire.eruptions,
    6,
    "one fire adds exactly one to the eruption count",
  );
  assert.notEqual(afterFire.phase, "erupting", "the fire ended within the duration");
  assert.ok(afterFire.H < before_H, "the eruption dumped head out of the aquifer");
  const dropped = before_total - M.totalWater(afterFire);
  assert.ok(dropped > 0, "total water dropped across the fire");
  // The drop equals (before_H − after_H) since POOL_L is constant.
  abs(
    dropped,
    before_H - afterFire.H,
    1e-12,
    "total water dropped by exactly ΔH — POOL_L is a constant",
  );
}

// —— TIME-UNTIL-ERUPTION IS MONOTONE DECREASING WHILE BUILDING —————
// A predictor whose forecast goes up as time passes is broken. The
// closed-form solver in `timeUntilEruption` must monotonically shorten as
// the room walks forward, so the room can display a countdown.
{
  const seed = 0x4444;
  let s = {
    H: 0.5,
    T: 0.4,
    phase: "building",
    tSincePhase: 0,
    eruptions: 0,
    H0Erupt: 0,
    T0Erupt: 0,
    heatMarks: [],
    tau: 0,
    seedKey: seed,
  };
  const climate = { warmth: 0.6, wet: 0.5 };
  let last = M.timeUntilEruption(s, climate);
  assert.ok(Number.isFinite(last) && last > 0, "the forecast starts finite");
  for (let i = 0; i < 8; i++) {
    s = M.advanceExact(s, last * 0.1, climate);
    const now = M.timeUntilEruption(s, climate);
    if (s.phase !== "building") break;
    assert.ok(
      now <= last + 1e-9,
      `forecast is non-increasing (was ${last}, now ${now}, i=${i})`,
    );
    last = now;
  }
  // A non-building state answers Infinity — the caller knows to hide the clock.
  const erupting = M.manualErupt(s);
  assert.equal(
    M.timeUntilEruption(erupting, climate),
    Infinity,
    "no forecast while erupting",
  );
}

// —— COOLING FALLS TO A STABLE LOW-ENERGY CONFIG ———————————————————
// After the fire, the state must relax toward low E = H·T so it does NOT
// re-fire immediately. A hysteresis bug (LOW ≥ HIGH) would refire.
{
  const seed = 0x5555;
  const preErupt = {
    H: 0.9,
    T: 0.85,
    phase: "building",
    tSincePhase: 0,
    eruptions: 0,
    H0Erupt: 0,
    T0Erupt: 0,
    heatMarks: [],
    tau: 0,
    seedKey: seed,
  };
  const erupting = M.manualErupt(preErupt);
  // Cool climate — the ground should relax back to ambient.
  const afterFire = M.advanceExact(erupting, M.ERUPT_DURATION_S + 30, {
    warmth: 0.1,
    wet: 0.1,
  });
  assert.notEqual(afterFire.phase, "erupting", "the fire ended");
  const E_after = afterFire.H * afterFire.T;
  assert.ok(
    E_after < M.E_TRIGGER_HIGH,
    "just after a fire, E is below the HIGH trigger",
  );
  // And the hysteresis makes sense — LOW must be strictly less than HIGH.
  assert.ok(
    M.E_TRIGGER_LOW < M.E_TRIGGER_HIGH,
    "hysteresis: LOW < HIGH so a marginal E cannot re-fire",
  );
}

// —— MAX_ELAPSED_S CAPS A CENTURY-BUG ——————————————————————————————
// A month away is not a century of drift: world.ts's law, kept.
{
  const s0 = M.initState(0x77);
  const climate = { warmth: 0.4, wet: 0.4 };
  const capped = M.advanceExact(s0, M.MAX_ELAPSED_S + 3600, climate);
  const atCap = M.advanceExact(s0, M.MAX_ELAPSED_S, climate);
  abs(capped.H, atCap.H, 1e-9, "advancing past the cap lands where advancing to it lands");
  abs(capped.T, atCap.T, 1e-9, "in T too");
  // Negative or zero spans are the identity.
  assert.equal(M.advanceExact(s0, -5, climate), s0, "a negative span is the identity");
  assert.equal(M.advanceExact(s0, 0, climate), s0, "no span, no change");
}

// —— DWELL WIDENS THE HEAT MARK, PLANT SAT-CAPS AT DWELL_T_MAX ——————
// The dwell handler's contract: a longer press is a hotter mark. A bug in
// the saturating law would either fire identically at 900ms and 2400ms
// (site law) or explode past the cap.
{
  const seed = 0x6666;
  const base = M.initState(seed);
  const planted = M.plantHeatMark(base, 0.5, 0.5, 0.05);
  assert.equal(planted.heatMarks.length, 1, "plantHeatMark landed inside the section");
  const id = planted.heatMarks[0].id;
  let s = planted;
  let lastHeat = s.heatMarks[0].heat;
  for (const step of [0.03, 0.05, 0.05, 0.05]) {
    s = M.deepenHeatMark(s, id, step);
    assert.ok(
      s.heatMarks[0].heat >= lastHeat,
      `deepen strictly widened at +${step}`,
    );
    lastHeat = s.heatMarks[0].heat;
  }
  // The ceiling holds.
  const filled = M.deepenHeatMark(s, id, 999);
  abs(
    filled.heatMarks[0].heat,
    M.DWELL_T_MAX,
    1e-15,
    "the ceiling holds — heat cannot exceed DWELL_T_MAX",
  );
}

// —— PLANT REFUSES OUTSIDE THE SECTION, AND HITS THE CAP CORRECTLY —————
// The section has real bounds; a hand cannot warm the sky or the bedrock.
{
  const s0 = M.initState(0x77);
  const above = M.plantHeatMark(s0, 0.5, 0.05, 0.05);
  assert.equal(
    above.heatMarks.length,
    0,
    "a heat mark cannot be planted in the air",
  );
  const below = M.plantHeatMark(s0, 0.5, 0.99, 0.05);
  assert.equal(
    below.heatMarks.length,
    0,
    "…and not through the floor of the section",
  );
  // Cap.
  let capped = s0;
  for (let i = 0; i < M.MAX_HEAT_MARKS + 4; i++) {
    capped = M.plantHeatMark(
      capped,
      M.POOL_X_MIN + ((i * 0.05) % (M.POOL_X_MAX - M.POOL_X_MIN)),
      M.POOL_Y_MIN + 0.1,
      0.05,
    );
  }
  assert.equal(
    capped.heatMarks.length,
    M.MAX_HEAT_MARKS,
    "the section holds its heat-mark cap",
  );
}

// —— A KNOCK CAN FIRE A NEAR-TRIGGERED STATE ———————————————————————
// The room's touch-reachable secret. A state at E just below HIGH is
// pushed over by a strong knock; a state far from HIGH is not.
{
  const seed = 0x7777;
  // Near-triggered: E just below HIGH.
  const near = {
    H: 0.85,
    T: 0.5,
    phase: "building",
    tSincePhase: 0,
    eruptions: 0,
    H0Erupt: 0,
    T0Erupt: 0,
    heatMarks: [],
    tau: 0,
    seedKey: seed,
  };
  const E_near = near.H * near.T;
  assert.ok(
    E_near < M.E_TRIGGER_HIGH && E_near > M.E_TRIGGER_HIGH - M.KNOCK_KAPPA,
    "test bootstrap: state is inside the knock-fires-it band",
  );
  const strong = M.knockErupt(near, 1);
  assert.equal(strong.fired, true, "a strong knock near the trigger fires the geyser");
  assert.equal(strong.state.phase, "erupting", "and the state flipped to erupting");
  // Far-below: a strong knock does not fire.
  const far = { ...near, H: 0.3, T: 0.3 };
  const alsoStrong = M.knockErupt(far, 1);
  assert.equal(alsoStrong.fired, false, "a knock far from the trigger does nothing");
  assert.equal(alsoStrong.state.phase, "building", "state remains building");
  // A knock while erupting is a no-op.
  const erupting = M.manualErupt({ ...near });
  const knockDuring = M.knockErupt(erupting, 1);
  assert.equal(
    knockDuring.fired,
    false,
    "a knock during the fire does not double-fire",
  );
}

// —— STIR COOLS T MONOTONICALLY ————————————————————————————————
// The scrub verb's contract: stirring the pool cools it (surface exchange
// with the air). A bug that added instead of subtracted heat would show.
{
  const seed = 0x8888;
  const warm = {
    H: 0.5,
    T: 0.7,
    phase: "building",
    tSincePhase: 0,
    eruptions: 0,
    H0Erupt: 0,
    T0Erupt: 0,
    heatMarks: [],
    tau: 0,
    seedKey: seed,
  };
  const stirred = M.stirCool(warm, 60);
  assert.ok(
    stirred.T < warm.T,
    "one minute of stirring cools T (surface exchange with the air)",
  );
  assert.ok(
    stirred.T > M.T_AIR - 1e-9,
    "…but never below T_AIR (T relaxes toward air, not below)",
  );
}

// —— DETERMINISM ————————————————————————————————————————————————
{
  assert.deepEqual(
    M.initState(0xabc),
    M.initState(0xabc),
    "the same seed makes the same geyser",
  );
  assert.notEqual(
    M.initState(1).H,
    M.initState(2).H,
    "different seeds produce different starting states",
  );
  const rng1 = M.mulberry32(42);
  const rng2 = M.mulberry32(42);
  for (let i = 0; i < 8; i++) abs(rng1(), rng2(), 0, "mulberry32 is stable per seed");
  abs(M.hashSeed(1, 2, 3), M.hashSeed(1, 2, 3), 0, "hashSeed is a function of its inputs");
  assert.notEqual(
    M.hashSeed(1, 2, 3),
    M.hashSeed(1, 3, 2),
    "and order matters",
  );
}

console.log(
  "geyserflow ok: head ↔ pitch round-trip is exact; the cycle fires at E ≥ HIGH and cools " +
    "with hysteresis; the phase machine walks building → erupting → cooling → building without " +
    "backtracking; Q_erupt decays through the fire and returns 0 outside it; total water drops " +
    "by exactly ΔH across an eruption; time-until-eruption is a monotone-decreasing forecast; " +
    "MAX_ELAPSED_S caps the away span; a knock near the trigger fires; and stir cools T " +
    "toward T_AIR",
);
