// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.route.
// One LLM slot below carries the pins; the loader boilerplate is verbatim.

// The /tidepool laws. Every assertion names the bug it catches — a
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

const M = loadTsModule("src/lib/tidewater.ts");

const near = (a, b, rel, msg) =>
  assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg} (got ${a}, want ~${b})`);

const abs = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} (|${a} - ${b}| = ${Math.abs(a - b)} > ${tol})`);

// —— BIOMASS → PITCH IS A TRUE ROUND-TRIP (per kind) ————————————
// The room's central legibility claim: from the ring alone you recover the
// creature's kind and biomass. Bug this catches: a pitch that doesn't
// invert. Kelp does not ring — its base is 0 — so it's excluded from the
// round-trip and the map returns 0 for both directions there.
{
  for (const kind of ["snail", "anemone"]) {
    for (const b of [0, 0.1, 0.4, 0.6, 0.8, 1.0, 0.25, 0.75]) {
      const hz = M.ringHzFor(kind, b);
      abs(M.biomassForRingHz(kind, hz), b, 1e-12, `${kind}: b → hz → b at b = ${b}`);
      assert.ok(hz > 0, `${kind}: pitch is a real frequency`);
    }
  }
  assert.equal(M.ringHzFor("kelp", 0.5), 0, "kelp does not ring — pitch is always 0");
  assert.equal(M.biomassForRingHz("kelp", 220), 0, "kelp does not un-ring — biomass reads 0");
  // Monotone DECREASING sweep per kind (bell mass rule).
  for (const kind of ["snail", "anemone"]) {
    let last = Infinity;
    for (let i = 0; i <= 20; i++) {
      const b = (i / 20) * M.MAX_BIOMASS;
      const hz = M.ringHzFor(kind, b);
      assert.ok(hz < last, `${kind}: ringHzFor monotone decreasing at b = ${b.toFixed(2)}`);
      last = hz;
    }
  }
}

// —— THE TIDE CLOCK IS EXACTLY PERIODIC ————————————————————————
// H(t) = H_MEAN + H_AMP · sin(...) — a full period must return to the
// same value. Bug this catches: any accidental drift, integration, or
// off-by-one in the closed form.
{
  const climate = { warmth: 0.5, wet: 0.4 }; // below storm threshold
  for (let i = 0; i < 5; i++) {
    const t0 = i * 7.3;
    abs(M.waterLevel(t0, climate), M.waterLevel(t0 + M.TIDE_PERIOD_S, climate),
        1e-12, `tide clock periodic at t = ${t0}`);
  }
  // At t = 0, waterLevel = H_MEAN.
  abs(M.waterLevel(0, climate), M.H_MEAN, 1e-12, "H(0) = H_MEAN");
  // At t = TIDE_PERIOD_S/4, waterLevel = H_MEAN + H_AMP.
  abs(M.waterLevel(M.TIDE_PERIOD_S / 4, climate), M.H_MEAN + M.H_AMP,
      1e-12, "H(T/4) = mean + amplitude");
  // Below the storm threshold, waterLevel does NOT contain the storm.
  abs(M.stormDisplacement({ warmth: 0.5, wet: 0.5 }), 0, 1e-12,
      "storm displacement is zero below the threshold");
  // Above the threshold, storm displacement is monotone-increasing.
  const dispA = M.stormDisplacement({ warmth: 0.5, wet: 0.90 });
  const dispB = M.stormDisplacement({ warmth: 0.5, wet: 0.95 });
  assert.ok(dispB > dispA, "storm displacement climbs with wet past threshold");
  // Storm displacement is bounded at H_STORM_MAX.
  const dispCap = M.stormDisplacement({ warmth: 0.5, wet: 1.0 });
  abs(dispCap, M.H_STORM_MAX, 1e-9, "storm displacement caps at H_STORM_MAX at wet = 1");
}

// —— STATE WEIGHTS SUM TO 1 AND CROSSFADE — a real state machine ————
// The visible bug this catches: state weights that don't sum to 1
// produce a shader that darkens or blows out between transitions.
{
  const climate = { warmth: 0.5, wet: 0.4 };
  for (let i = 0; i < 40; i++) {
    const t = i * 0.83;
    const w = M.stateWeights(t, climate);
    abs(w.low + w.high + w.mid + w.storm, 1, 1e-9,
        `state weights sum to 1 at t = ${t.toFixed(2)}`);
    for (const k of ["low", "high", "mid", "storm"]) {
      assert.ok(w[k] >= 0 && w[k] <= 1, `weight ${k} in [0,1] at t = ${t.toFixed(2)}`);
    }
  }
  // Below the storm threshold, storm weight is zero.
  const w0 = M.stateWeights(0, { warmth: 0.5, wet: 0.5 });
  abs(w0.storm, 0, 1e-12, "storm weight is 0 below threshold");
  // At full wet, storm weight is 1.
  const w1 = M.stateWeights(0, { warmth: 0.5, wet: 1.0 });
  abs(w1.storm, 1, 1e-9, "storm weight is 1 at wet = 1");
  abs(w1.low + w1.high + w1.mid, 0, 1e-9, "other weights fold to 0 in full storm");
}

// —— currentState PICKS THE MAX ——————————————————————————————————
// Bug this catches: state readback that lies (dispatches on the wrong
// state, hiding the discoverables the room promises).
{
  const climate = { warmth: 0.5, wet: 0.4 };
  // At T/4, high tide dominates.
  assert.equal(M.currentState(M.TIDE_PERIOD_S / 4, climate), "high_tide",
              "quarter period reads as high tide");
  // At 3T/4, low tide dominates.
  assert.equal(M.currentState((3 * M.TIDE_PERIOD_S) / 4, climate), "low_tide",
              "three-quarters period reads as low tide");
  // Under storm climate at any t, storm dominates.
  assert.equal(M.currentState(0, { warmth: 0.5, wet: 0.98 }), "storm",
              "high wet reads as storm regardless of t");
}

// —— PLANT REFUSES OUTSIDE POOL BOUNDS AND OUTSIDE ZONE ————————————
// Bug this catches: a dwell that seeded an anemone outside a hollow, or
// a snail below the shelf. The room's own geometry.
{
  let state = M.initState(0x7ee5);
  const before = state.creatures.length;
  // Plant in bounds, on the shelf — should add a kelp.
  const stateShelf = M.plantCreature(state, 0.5, 0.45);
  assert.ok(stateShelf.creatures.length > before, "plantCreature on shelf adds a kelp");
  const newC = stateShelf.creatures[stateShelf.creatures.length - 1];
  assert.equal(newC.kind, "kelp", "shelf plant is kelp");
  // Plant in the hollow via dwell — REFUSES (anemones need ceremony).
  const stateHollow = M.plantCreature(state, 0.5, 0.75);
  assert.equal(stateHollow.creatures.length, state.creatures.length,
               "plantCreature in hollow REFUSES (anemones via ceremony only)");
  // Plant outside pool bounds — refuses.
  const stateOOB = M.plantCreature(state, 0.02, 0.5);
  assert.equal(stateOOB.creatures.length, state.creatures.length,
               "plantCreature outside bounds refuses");
  // Ceremony plants an anemone in the hollow.
  const stateCeremony = M.ceremonyPlantAnemone(state, 0.5, 0.75);
  assert.ok(stateCeremony.creatures.length > state.creatures.length,
            "ceremonyPlantAnemone in hollow adds an anemone");
  const anemoneC = stateCeremony.creatures[stateCeremony.creatures.length - 1];
  assert.equal(anemoneC.kind, "anemone", "hollow ceremony is an anemone");
  // Ceremony outside the hollow refuses.
  const stateCFail = M.ceremonyPlantAnemone(state, 0.5, 0.30);
  assert.equal(stateCFail.creatures.length, state.creatures.length,
               "ceremonyPlantAnemone outside hollow refuses");
}

// —— advanceExact IS BOUNDED AND STABLE ACROSS A FORTNIGHT ————————
// Bug this catches: an integration blow-up. CFL sub-stepping guidance
// from phase-6 is honored — anemone filtering is bounded per subDt.
{
  let state = M.initState(0x7ee6);
  const climate = { warmth: 0.6, wet: 0.4 };
  // Ten one-day advances — total two weeks. No NaN, no unbounded biomass.
  for (let d = 0; d < 14; d++) {
    state = M.advanceExact(state, 24 * 3600, climate);
    for (const c of state.creatures) {
      assert.ok(Number.isFinite(c.biomass), `biomass finite after day ${d} kind ${c.kind}`);
      assert.ok(c.biomass >= 0 && c.biomass <= M.MAX_BIOMASS,
                `biomass in [0, MAX] after day ${d} kind ${c.kind}: ${c.biomass}`);
    }
    assert.ok(Number.isFinite(state.biofilm) && state.biofilm >= 0 && state.biofilm <= 1,
              `biofilm in [0,1] after day ${d}`);
  }
}

// —— KNOCK STARTLES EVERY CREATURE ——————————————————————————————
// Bug this catches: a knock that misses a species (a "storm" that only
// hurts one kind — a room whose state didn't reach every population).
{
  let state = M.initState(0x7ee7);
  // Plant a kelp near the sealed anemone.
  state = M.plantCreature(state, 0.5, 0.45);
  const before = state.creatures.length;
  const { state: after, affected } = M.knockStartle(state, 1.0, 1000);
  assert.equal(affected, before, "knockStartle affects every creature");
  const anyAnemone = after.creatures.find((c) => c.kind === "anemone");
  assert.ok(anyAnemone && anyAnemone.curl >= 0.7, "knock curls every anemone (curl ≥ 0.7)");
  const anySnail = after.creatures.find((c) => c.kind === "snail");
  if (anySnail) {
    assert.ok(anySnail.retreated, "knock retreats every snail");
    assert.ok(anySnail.retreatedUntilMs > 1000, "retreat is timed forward");
  }
  const anyKelp = after.creatures.find((c) => c.kind === "kelp");
  if (anyKelp) {
    assert.ok(Math.abs(anyKelp.bendPhase) > 0.4, "knock bends every kelp");
  }
}

// —— GRAZE + FILTER — the cross-population interactions are REAL ————
// Bug this catches: a compiled room whose populations don't touch — a
// slideshow-of-three (phase-7 depth failure).
{
  // Build a controlled pool: one snail next to one kelp, no anemone.
  let stateA = M.initState(0x7ee8);
  // Snail and kelp within grazing radius (0.12) — snail at (0.42, 0.36) is within
  // 0.05 of the kelp at (0.42, 0.4).
  stateA = {
    ...stateA,
    creatures: [
      { id: 1, kind: "snail", x: 0.42, y: 0.36, biomass: 0.7, phase: 0.1, sealed: false, curl: 0, retreated: false, retreatedUntilMs: 0, bendPhase: 0 },
      { id: 2, kind: "kelp",  x: 0.42, y: 0.40, biomass: 0.5, phase: 0.2, sealed: false, curl: 0, retreated: false, retreatedUntilMs: 0, bendPhase: 0 },
    ],
  };
  // Build a control: same kelp alone (no snail nearby).
  let stateB = {
    ...M.initState(0x7ee8),
    creatures: [
      { id: 2, kind: "kelp",  x: 0.42, y: 0.40, biomass: 0.5, phase: 0.2, sealed: false, curl: 0, retreated: false, retreatedUntilMs: 0, bendPhase: 0 },
    ],
  };
  const climate = { warmth: 0.9, wet: 0.4 }; // bright, calm
  // Short enough that neither saturates — the DIFFERENCE is what we're pinning.
  const dt = 15 * 60; // 15 minutes
  stateA = M.advanceExact(stateA, dt, climate);
  stateB = M.advanceExact(stateB, dt, climate);
  const kelpA = stateA.creatures.find((c) => c.kind === "kelp");
  const kelpB = stateB.creatures.find((c) => c.kind === "kelp");
  // Kelp near a snail grows SLOWER — grazing.
  assert.ok(kelpA.biomass < kelpB.biomass,
            `grazing pressure real: kelpA (${kelpA.biomass.toFixed(4)}) < kelpB (${kelpB.biomass.toFixed(4)})`);
  // And the snail grew FASTER because there is kelp nearby.
  const snailAlone = { ...stateA.creatures.find((c) => c.kind === "snail") };
  // Compare against a solo snail without kelp.
  let stateC = {
    ...M.initState(0x7ee9),
    creatures: [
      { id: 1, kind: "snail", x: 0.42, y: 0.36, biomass: 0.7, phase: 0.1, sealed: false, curl: 0, retreated: false, retreatedUntilMs: 0, bendPhase: 0 },
    ],
  };
  stateC = M.advanceExact(stateC, dt, climate);
  const snailC = stateC.creatures.find((c) => c.kind === "snail");
  assert.ok(snailAlone.biomass > snailC.biomass,
            `snail with kelp grew MORE than snail without: ${snailAlone.biomass.toFixed(4)} > ${snailC.biomass.toFixed(4)}`);
}

// —— BIOFILM RESPONDS TO THE BREATH ——————————————————————————————
// Bug this catches: a breath verb that says it warms the biofilm but
// doesn't actually move the scalar the shader reads.
{
  let state = M.initState(0x7eea);
  const before = state.biofilm;
  state = M.breathWarm(state, 0.35);
  assert.ok(state.biofilm > before, "breathWarm raises biofilm");
  const after = state.biofilm;
  // Bounded at 1.
  state = M.breathWarm(state, 5.0);
  assert.equal(state.biofilm, 1, "breathWarm caps at 1");
  void after;
}

// —— relaxTransients DECAYS EVERY FLAG ————————————————————————————
// Bug this catches: a snail that retreats forever or a kelp that never
// stops thrashing.
{
  let state = M.initState(0x7eeb);
  const nowMs = 100000;
  // Force a fresh startle.
  const startle = M.knockStartle(state, 1.0, nowMs);
  state = startle.state;
  // Simulate 3.5 seconds passing (well beyond SNAIL_RETREAT_MS = 3000).
  state = M.relaxTransients(state, nowMs + 3500, 0.1, 0);
  const snails = state.creatures.filter((c) => c.kind === "snail");
  for (const s of snails) {
    assert.equal(s.retreated, false, "snail retreat decays after SNAIL_RETREAT_MS");
  }
  // Anemone curl relaxes toward target 0 (high tide).
  state = M.relaxTransients(state, nowMs + 10000, 3.0, 0);
  const anemones = state.creatures.filter((c) => c.kind === "anemone");
  for (const a of anemones) {
    assert.ok(a.curl < 0.15, `anemone curl relaxes toward target 0 (got ${a.curl.toFixed(3)})`);
  }
}
