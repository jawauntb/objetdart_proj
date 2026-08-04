import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
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
  // Same realm as the test: vm.runInNewContext builds arrays, objects and
  // strings on a foreign prototype chain, so deepStrictEqual rejects them
  // against host literals of identical content.
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const S = loadTsModule("src/lib/structure.ts");
const {
  PHASES,
  PHASE_ORDER,
  DEFAULT_PARAMS,
  initialState,
  structureFromSeed,
  step,
  conservedQuantity,
  currentThreshold,
  select,
  selectionShift,
  reachableRegion,
  carried,
  compileSound,
  decodeSound,
  compileVisual,
  decodeVisual,
  compileText,
  decodeTextPhase,
  compileNav,
  decodeNavReach,
  compileTactile,
  decodeTactile,
  NAV_GRID,
  MEDIUM_TOL,
} = S;

// A small driver: pour constant attention until a target predicate, logging
// the state trajectory and the total input poured.
function run(state, params, attention, dt, steps, renew) {
  const trace = [state];
  let s = state;
  let poured = 0;
  for (let i = 0; i < steps; i++) {
    s = step(s, { attention, renew: renew ?? attention }, dt, params);
    poured += attention * dt;
    trace.push(s);
  }
  return { state: s, trace, poured };
}

// ——————————————————————————————————————————————————————————————————————
// determinism of the realization fiber
// ——————————————————————————————————————————————————————————————————————
{
  const a = structureFromSeed(20260803);
  const b = structureFromSeed(20260803);
  assert.deepEqual(a, b, "structureFromSeed is deterministic for a fixed seed");
  const c = structureFromSeed(20260804);
  assert.notDeepEqual(a.params, c.params, "different seeds give different surface params");
  // Every seed shares the same initial invariant state (same structure).
  assert.equal(a.state.phase, "latent");
  assert.equal(a.state.reach, c.state.reach, "the fiber varies surface, not the invariant state");
}

// determinism of step itself
{
  const s0 = initialState();
  const p = DEFAULT_PARAMS;
  const x = step(step(s0, { attention: 0.7 }, 1 / 60, p), { attention: 0.3 }, 1 / 60, p);
  const y = step(step(s0, { attention: 0.7 }, 1 / 60, p), { attention: 0.3 }, 1 / 60, p);
  assert.deepEqual(x, y, "step is a pure deterministic function of (state, input, dt, params)");
}

// ——————————————————————————————————————————————————————————————————————
// invariant (i): monotone accumulation before the threshold
// ——————————————————————————————————————————————————————————————————————
{
  const p = DEFAULT_PARAMS;
  let s = initialState();
  const before = [];
  let crossed = false;
  for (let i = 0; i < 2000 && !crossed; i++) {
    const next = step(s, { attention: 1 }, 1 / 60, p);
    if (next.phase === "threshold") {
      crossed = true; // the crossing step itself is excluded from "before"
    } else {
      before.push(next.tension);
    }
    s = next;
  }
  assert.ok(crossed, "sustained attention eventually crosses the threshold");
  for (let i = 1; i < before.length; i++) {
    assert.ok(
      before[i] > before[i - 1],
      `tension strictly rises before the threshold (${before[i - 1]} !< ${before[i]})`,
    );
  }
}

// ——————————————————————————————————————————————————————————————————————
// invariant (ii): the phase transition is discontinuous in reach
// A crossing produces a finite reach jump that does NOT shrink with dt.
// ——————————————————————————————————————————————————————————————————————
{
  const p = DEFAULT_PARAMS;
  const jumps = [];
  for (const dt of [1 / 30, 1 / 120, 1 / 1000]) {
    // Poise the state just below the first threshold, then nudge over.
    const s = { tension: 0.82 - 1e-6, coherence: 0.22, reach: 0.12, phase: "gathering", visited: false, phaseT: 0 };
    const next = step(s, { attention: 1 }, dt, p);
    assert.equal(next.phase, "threshold", "the poised state crosses on the next step");
    jumps.push(next.reach - s.reach);
  }
  for (const j of jumps) {
    assert.ok(j > 0.2, `reach jumps discontinuously across the threshold (jump=${j})`);
  }
  // A strictly sub-critical step of the same dt moves reach not at all.
  const sub = { tension: 0.5, coherence: 0.22, reach: 0.12, phase: "gathering", visited: false, phaseT: 0 };
  const subNext = step(sub, { attention: 1 }, 1 / 1000, p);
  assert.equal(subNext.phase, "gathering");
  assert.equal(subNext.reach, sub.reach, "reach is flat while gathering — the jump is the discontinuity");
}

// ——————————————————————————————————————————————————————————————————————
// invariant (iv): the crossing conserves total intensity (redistribution)
// ——————————————————————————————————————————————————————————————————————
{
  const p = DEFAULT_PARAMS;
  // Poise infinitesimally below the threshold with a tiny push, so the
  // accumulation added is negligible (~1.6e-8) and only the redistribution
  // matters. Any leak in the weights (G_REACH + G_COH ≠ 1) would move Q by
  // O(release) ≈ 0.6 — far past this tolerance.
  // Full attention makes the leak term vanish, so a very short dt adds only
  // ~1.6e-7 of tension — enough to cross the 1e-9 poise, small enough that a
  // conserving redistribution keeps ΔQ well under tolerance.
  const s = { tension: 0.82 - 1e-9, coherence: 0.31, reach: 0.12, phase: "gathering", visited: false, phaseT: 0 };
  const qBefore = conservedQuantity(s);
  const next = step(s, { attention: 1 }, 1e-6, p);
  assert.equal(next.phase, "threshold");
  const qAfter = conservedQuantity(next);
  assert.ok(
    Math.abs(qAfter - qBefore) < 1e-6,
    `tension is redistributed into reach+coherence, not created (ΔQ=${qAfter - qBefore})`,
  );
}

// ——————————————————————————————————————————————————————————————————————
// invariant (v): decay to rest is monotone absent input
// ——————————————————————————————————————————————————————————————————————
{
  const p = DEFAULT_PARAMS;
  // Start in agency with the way open, then withdraw all attention.
  let s = { tension: 0.2, coherence: 0.5, reach: 0.55, phase: "agency", visited: true, phaseT: 0 };
  const reach = [];
  const coh = [];
  let reachedRest = false;
  for (let i = 0; i < 3000; i++) {
    reach.push(s.reach);
    coh.push(s.coherence);
    s = step(s, { attention: 0, renew: 0 }, 1 / 60, p);
    if (s.phase === "rest") {
      reachedRest = true;
      break;
    }
  }
  assert.ok(reachedRest, "agency without renewal decays to rest");
  for (let i = 1; i < reach.length; i++) {
    assert.ok(reach[i] <= reach[i - 1] + 1e-12, "reach is monotone non-increasing during decay");
    assert.ok(coh[i] <= coh[i - 1] + 1e-12, "coherence is monotone non-increasing during decay");
  }
  assert.ok(reach[reach.length - 1] < reach[0], "reach strictly falls overall");
}

// ——————————————————————————————————————————————————————————————————————
// invariant (iii): hysteresis — the second crossing needs strictly less input
// ——————————————————————————————————————————————————————————————————————
{
  const p = DEFAULT_PARAMS;
  const dt = 1 / 60;
  const att = 0.8;

  // First crossing from a virgin latent state.
  let s = initialState();
  let poured1 = 0;
  for (let i = 0; i < 5000; i++) {
    s = step(s, { attention: att }, dt, p);
    poured1 += att * dt;
    if (s.phase === "threshold") break;
  }
  assert.equal(s.phase, "threshold", "first crossing reached");
  assert.equal(s.visited, true, "first crossing marks the run as visited");

  // Let it fall all the way to rest with no input.
  for (let i = 0; i < 5000 && s.phase !== "rest"; i++) {
    s = step(s, { attention: 0, renew: 0 }, dt, p);
  }
  assert.equal(s.phase, "rest", "the run settles to rest before re-accumulating");
  const restReach = s.reach;

  // Second crossing from rest under the same attention.
  let poured2 = 0;
  for (let i = 0; i < 5000; i++) {
    s = step(s, { attention: att }, dt, p);
    poured2 += att * dt;
    if (s.phase === "threshold") break;
  }
  assert.equal(s.phase, "threshold", "second crossing reached");
  assert.ok(
    poured2 < poured1 - 1e-6,
    `hysteresis: the second crossing needs strictly less accumulated input (${poured2} !< ${poured1})`,
  );
  assert.ok(currentThreshold({ visited: true }) < currentThreshold({ visited: false }), "the visited threshold is lower");
  void restReach;
}

// ——————————————————————————————————————————————————————————————————————
// the commuting diagrams: compile∘step ≈ step_medium∘compile
//
// step_medium := compile∘step∘decode. For every medium we advance both the
// structure and the medium's decoded reconstruction, then compare in the
// medium's own params. Bookkeeping fields (visited/phaseT) are shared
// context — the fiber, not carried by any medium.
// ——————————————————————————————————————————————————————————————————————

// Collect a spread of states across the whole arc from several seeds.
function sampleStates() {
  const out = [];
  for (const seed of [1, 7, 42, 1000, 20260803]) {
    const { params, state } = structureFromSeed(seed);
    let s = state;
    // Drive through the whole arc twice: gather → cross → dwell in agency →
    // renew → withdraw fully to rest → re-cross (hysteresis) → rest again.
    // The withdrawal windows are long enough for reach to decay past R_EXIT.
    const script = [
      [0.9, 400],
      [0.2, 120],
      [0.7, 200],
      [0.0, 900],
      [0.85, 400],
      [0.0, 900],
    ];
    for (const [att, n] of script) {
      for (let i = 0; i < n; i++) {
        s = step(s, { attention: att }, 1 / 60, params);
        if ((i & 7) === 0) out.push({ s, params });
      }
    }
  }
  return out;
}

const samples = sampleStates();
assert.ok(samples.length > 200, "the sample sweep visits the whole arc");
// Confirm the sweep really touches every phase (otherwise the diagram tests
// would be vacuous on the phases they never see).
{
  const seen = new Set(samples.map(({ s }) => s.phase));
  for (const ph of PHASES) assert.ok(seen.has(ph), `the sweep reaches the ${ph} phase`);
}

function reconstruct(s, decoded) {
  // Override the carried axes with the medium's decoded values; keep the
  // shared bookkeeping (the fiber).
  return { ...s, tension: decoded.tension, coherence: decoded.coherence, reach: decoded.reach, phase: decoded.phase };
}

// sound — lossless on the axes
{
  let worst = 0;
  for (const { s, params } of samples) {
    const input = { attention: 0.5 };
    const viaS = compileSound(step(s, input, 1 / 60, params), params);
    const rebuilt = reconstruct(s, decodeSound(compileSound(s, params)));
    const viaM = compileSound(step(rebuilt, input, 1 / 60, params), params);
    worst = Math.max(
      worst,
      Math.abs(viaS.dissonance - viaM.dissonance),
      Math.abs(viaS.harmonicity - viaM.harmonicity),
      Math.abs(viaS.spread - viaM.spread),
      viaS.phase === viaM.phase ? 0 : 1,
    );
  }
  assert.ok(worst <= MEDIUM_TOL.sound, `sound compiler commutes with step (residual ${worst} ≤ ${MEDIUM_TOL.sound})`);
}

// visual — lossless on the continuous axes; symmetry is a separate invariant
{
  let worst = 0;
  for (const { s, params } of samples) {
    const input = { attention: 0.5 };
    const viaS = compileVisual(step(s, input, 1 / 60, params), params);
    const rebuilt = reconstruct(s, decodeVisual(compileVisual(s, params)));
    const viaM = compileVisual(step(rebuilt, input, 1 / 60, params), params);
    worst = Math.max(
      worst,
      Math.abs(viaS.radius - viaM.radius),
      Math.abs(viaS.gather - viaM.gather),
      Math.abs(viaS.lock - viaM.lock),
      viaS.symmetry === viaM.symmetry ? 0 : 1,
      viaS.phase === viaM.phase ? 0 : 1,
    );
  }
  assert.ok(worst <= MEDIUM_TOL.visual, `visual compiler commutes with step (residual ${worst} ≤ ${MEDIUM_TOL.visual})`);
}

// visual — the symmetry snap is discontinuous at the threshold and constant
// within a phase (the "gathers, then snaps into a new symmetry" invariant).
{
  const p = { ...DEFAULT_PARAMS, symmetry: 4 };
  const gather = compileVisual({ tension: 0.5, coherence: 0.2, reach: 0.12, phase: "gathering", visited: false, phaseT: 0 }, p);
  const agency = compileVisual({ tension: 0.2, coherence: 0.5, reach: 0.5, phase: "agency", visited: true, phaseT: 0 }, p);
  assert.notEqual(gather.symmetry, agency.symmetry, "the form snaps into a new symmetry across the threshold");
  const g2 = compileVisual({ tension: 0.7, coherence: 0.25, reach: 0.12, phase: "gathering", visited: false, phaseT: 0 }, p);
  assert.equal(gather.symmetry, g2.symmetry, "symmetry is constant within the gathering phase");
}

// text — the phase quotient: tier depends ONLY on phase, order-preserving,
// and the tier transition is a well-formed step of the phase automaton.
{
  for (const { s } of samples) {
    assert.equal(compileText(s).tier, PHASE_ORDER[s.phase], "text tier is the order-preserving image of the phase");
  }
  // descends: same phase, different magnitudes → same tier (fiber forgotten).
  const a = compileText({ tension: 0.1, coherence: 0.2, reach: 0.3, phase: "agency", visited: true, phaseT: 0 });
  const b = compileText({ tension: 0.9, coherence: 0.8, reach: 0.7, phase: "agency", visited: true, phaseT: 1 });
  assert.equal(a.tier, b.tier, "text forgets the magnitudes — the quotient descends to the phase");
  assert.notEqual(a.line, undefined);
  // commuting on the lattice: tier(step) is reachable from tier(now).
  const legal = new Set(["0->1", "1->2", "2->3", "3->4", "4->1", "4->0"]);
  for (const { s, params } of samples) {
    const now = compileText(s).tier;
    const nxt = compileText(step(s, { attention: 0.6 }, 1 / 60, params)).tier;
    assert.ok(
      now === nxt || legal.has(`${now}->${nxt}`),
      `text tier advances by a legal automaton step (${now}->${nxt})`,
    );
    assert.equal(decodeTextPhase(compileText(s)), s.phase, "decodeTextPhase inverts the tier");
  }
}

// nav — quantized reach: commutes to within one cell
{
  let worst = 0;
  for (const { s, params } of samples) {
    const input = { attention: 0.5 };
    const viaS = compileNav(step(s, input, 1 / 60, params));
    const rebuilt = { ...s, reach: decodeNavReach(compileNav(s)) };
    const viaM = compileNav(step(rebuilt, input, 1 / 60, params));
    worst = Math.max(worst, Math.abs(viaS.openCells - viaM.openCells));
  }
  assert.ok(worst <= 1, `nav compiler commutes with step to within one cell (worst ${worst})`);
  // penned before agency, open at agency (the felt claustrophobia→openness).
  assert.equal(compileNav({ tension: 0.5, coherence: 0.2, reach: 0.12, phase: "gathering", visited: false, phaseT: 0 }).penned, true);
  assert.equal(compileNav({ tension: 0.2, coherence: 0.5, reach: 0.6, phase: "agency", visited: true, phaseT: 0 }).penned, false);
}

// tactile — lossless on the axes
{
  let worst = 0;
  for (const { s, params } of samples) {
    const input = { attention: 0.5 };
    const viaS = compileTactile(step(s, input, 1 / 60, params));
    const rebuilt = reconstruct(s, decodeTactile(compileTactile(s)));
    const viaM = compileTactile(step(rebuilt, input, 1 / 60, params));
    worst = Math.max(
      worst,
      Math.abs(viaS.tickHz - viaM.tickHz),
      Math.abs(viaS.presence - viaM.presence),
      Math.abs(viaS.grip - viaM.grip),
      viaS.bloom === viaM.bloom ? 0 : 1,
    );
  }
  assert.ok(worst <= MEDIUM_TOL.tactile, `tactile compiler commutes with step (residual ${worst} ≤ ${MEDIUM_TOL.tactile})`);
}

// ——————————————————————————————————————————————————————————————————————
// selection: 0 outside agency, >0 at agency, monotone in |choice|
// ——————————————————————————————————————————————————————————————————————
{
  const agencyState = { tension: 0.2, coherence: 0.5, reach: 0.5, phase: "agency", visited: true, phaseT: 0 };
  const gatheringState = { tension: 0.5, coherence: 0.2, reach: 0.12, phase: "gathering", visited: false, phaseT: 0 };
  const restState = { tension: 0.1, coherence: 0.1, reach: 0.1, phase: "rest", visited: true, phaseT: 0 };
  const latentState = initialState();

  for (const st of [gatheringState, restState, latentState]) {
    for (const ch of [-1, -0.5, 0.2, 0.5, 1]) {
      assert.equal(selectionShift(st, ch), 0, `selection is inert outside agency (${st.phase})`);
    }
    const sel = select(st, 0.8);
    assert.deepEqual(sel.reachableBefore, sel.reachableAfter, "no landscape moves outside agency");
    assert.equal(sel.state, st, "select is a no-op outside agency");
  }

  // monotone (strictly increasing) in choice magnitude at agency.
  const mags = [0.05, 0.15, 0.3, 0.5, 0.75, 1.0];
  let prev = -1;
  for (const m of mags) {
    const shift = selectionShift(agencyState, m);
    assert.ok(shift > 0, `selection shifts the landscape at agency (m=${m})`);
    assert.ok(shift > prev + 1e-9, `selectionShift is strictly monotone in |choice| (${prev} !< ${shift})`);
    prev = shift;
  }
  // both directions move the landscape (reach toward far futures, or hug the
  // near) — the shift is positive for either sign of a non-zero choice.
  assert.ok(selectionShift(agencyState, 0.6) > 0, "a positive choice moves the landscape");
  assert.ok(selectionShift(agencyState, -0.6) > 0, "a negative choice moves the landscape");

  // select actually reopens reach (agency as selective reopening).
  const applied = select(agencyState, 1);
  assert.ok(applied.state.reach > agencyState.reach, "a strong selection reopens reach");
  assert.ok(applied.shift > 0);
  let moved = 0;
  for (let i = 0; i < applied.reachableBefore.length; i++) {
    moved += Math.abs(applied.reachableAfter[i] - applied.reachableBefore[i]);
  }
  assert.ok(moved > 0, "the reachable landscape genuinely moves under selection");
  void reachableRegion;
  void carried;
}

console.log(
  `structure ok: ${PHASES.length} phases, 5 invariants, 5 compilers commute, ${samples.length} sampled states`,
);
