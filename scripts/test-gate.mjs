// The channel that answers the sample (/gate) — the laws that can lie, pinned.
// Falsifiable only: initial state is closed and unbound, bind / unbind are
// inverse-shaped, the subunit toggle is an involution, the gate converges
// toward 0 under a bound blocker regardless of span, converges toward 1 under
// span+unbound, ionFlow is 0 whenever the substance is bound, and the ion
// column sample is deterministic and bounded.

import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

const G = loadTsModule("src/lib/gate.ts");

// ——— constants sanity: gate/vestibule/filter sit in the right order ——————
// Catches: a swap that would put the vestibule below the gate, or the filter
// above it — the whole geometry is broken.
{
  assert.ok(G.VESTIBULE_Z > G.GATE_Z, "vestibule sits above the gate");
  assert.ok(G.SELECTIVITY_Z < G.GATE_Z, "selectivity filter sits below the gate");
  assert.ok(G.REST_ABOVE_Z > G.VESTIBULE_Z, "rest position is above the vestibule");
  assert.ok(G.BINDING_TOLERANCE > 0, "binding tolerance must be positive");
}

// ——— initialChannelState: unbound with the gate closed ———————————————————
// Catches: a birth that starts the door open, or the substance already in
// the pore, which would leak state between visits.
{
  const s = G.initialChannelState();
  assert.equal(s.substanceBound, false, "born unbound");
  assert.equal(s.gateOpenness, 0, "born with the gate closed");
  assert.equal(s.ionFlow, 0, "no flow before anything happens");
  assert.ok(s.substanceZ > G.VESTIBULE_Z, "substance rests above the vestibule");
  assert.ok(s.subunit === "2A" || s.subunit === "2B", "subunit is one of the two");
  // A different subunit at birth is still valid.
  const b = G.initialChannelState("2B");
  assert.equal(b.subunit, "2B", "born with the subunit the caller asked for");
}

// ——— bindSubstance: substance ends inside the binding tolerance —————————
// Catches: a bind that snaps to the wrong z (would put the block above the
// membrane, not in the vestibule) or forgets to set the bound flag.
{
  const s = G.initialChannelState();
  const bound = G.bindSubstance(s, 0.4);
  assert.equal(bound.substanceBound, true, "bind sets the bound flag");
  assert.ok(
    Math.abs(bound.substanceZ - G.VESTIBULE_Z) <= G.BINDING_TOLERANCE,
    `bound substance sits within tolerance of the vestibule; got ${bound.substanceZ}`,
  );
  assert.equal(bound.ionFlow, 0, "a fresh bind blocks the pore immediately");
}

// ——— unbindSubstance: clears bind and starts upward drift ————————————————
// Catches: an unbind that leaves the flag on (the visitor pulls but the pore
// is still blocked), or one that fails to start the drift up (the substance
// hangs in the vestibule after release).
{
  const bound = G.bindSubstance(G.initialChannelState(), 0.35);
  const released = G.unbindSubstance(bound);
  assert.equal(released.substanceBound, false, "unbind clears the flag");
  // One physics step, no span, no breath — the substance should have moved
  // toward REST_ABOVE_Z (positive z drift), not stayed put or fallen deeper.
  const stepped = G.stepChannel(released, 0.05, 0.5, false);
  assert.ok(stepped.substanceZ > released.substanceZ, "released substance drifts up");
}

// ——— toggleSubunit: involution ——————————————————————————————————————————
// Catches: a toggle that adds a third state, forgets to swap, or accumulates
// side-effects that break the identity round-trip.
{
  const a = G.initialChannelState("2A");
  const b = G.toggleSubunit(a);
  assert.equal(b.subunit, "2B", "2A toggles to 2B");
  const back = G.toggleSubunit(b);
  assert.equal(back.subunit, "2A", "2B toggles back to 2A — involution");
  // The other fields must not drift under a subunit swap.
  assert.equal(back.gateOpenness, a.gateOpenness, "toggle preserves gate openness");
  assert.equal(back.substanceBound, a.substanceBound, "toggle preserves binding");
}

// ——— stepChannel: bound + no span → gate closes ————————————————————————
// Catches: a block that fails to close the door (the physics doesn't say
// what the material claims), or a slow convergence that never gets there.
{
  let s = G.bindSubstance(G.initialChannelState(), 0.35);
  s = { ...s, gateOpenness: 0.9 }; // start open, so the closing motion is real
  for (let i = 0; i < 200; i++) {
    s = G.stepChannel(s, 1 / 60, 0.5, false);
  }
  assert.ok(
    s.gateOpenness < 0.05,
    `bound blocker must close the gate; after 200 steps openness=${s.gateOpenness}`,
  );
  assert.equal(s.ionFlow, 0, "ions cannot flow past a bound blocker");
}

// ——— stepChannel: unbound + span → gate opens ————————————————————————
// Catches: a span that never actually dilates the pore, or a convergence
// that stops short of full open.
{
  let s = G.initialChannelState();
  for (let i = 0; i < 200; i++) {
    s = G.stepChannel(s, 1 / 60, 0.5, true);
  }
  assert.ok(
    s.gateOpenness > 0.95,
    `held-open + unbound must dilate the gate; after 200 steps openness=${s.gateOpenness}`,
  );
  assert.ok(s.ionFlow > 0.9, "with the pore dilated and no blocker, ions flow strongly");
}

// ——— stepChannel: bound blocks ions regardless of openness ————————————
// Catches: a spurious flow leaking through a bound receptor — the whole
// pharmacological claim depends on this being exact.
{
  let s = G.bindSubstance(G.initialChannelState(), 0.35);
  // Force the openness dial to a high value AFTER binding — a caller could
  // conceivably set both; the physics still must say no flow.
  s = { ...s, gateOpenness: 0.8 };
  const stepped = G.stepChannel(s, 1 / 60, 0.5, true /* even if span holds */);
  assert.equal(stepped.ionFlow, 0, "bound blocker gives no flow, no matter what");
  // Multiple steps: still zero.
  let t = stepped;
  for (let i = 0; i < 50; i++) t = G.stepChannel(t, 1 / 60, 0.5, true);
  assert.equal(t.ionFlow, 0, "and stays zero across a hold");
}

// ——— stepChannel: alive at rest — the gate breathes on the 7s clock ————
// Catches: a rest state that goes to zero (dead pore) or that ignores
// breath entirely. The rest baseline sits between BASELINE_LO and _HI.
{
  let sLow = G.initialChannelState();
  let sHigh = G.initialChannelState();
  for (let i = 0; i < 400; i++) {
    sLow = G.stepChannel(sLow, 1 / 60, 0, false);
    sHigh = G.stepChannel(sHigh, 1 / 60, 1, false);
  }
  assert.ok(
    sHigh.gateOpenness > sLow.gateOpenness,
    `a room at rest with breath=1 sits more open than one with breath=0; got ${sLow.gateOpenness} vs ${sHigh.gateOpenness}`,
  );
  assert.ok(sLow.gateOpenness >= G.GATE_BASELINE_LO - 0.01, "low breath does not drop below the baseline low");
  assert.ok(sHigh.gateOpenness <= G.GATE_BASELINE_HI + 0.01, "high breath does not rise above the baseline high");
}

// ——— ionColumnSample: deterministic and bounded ————————————————————————
// Catches: a Math.random leak, an alpha that walks past 1, a jitter that
// blows past the ion-column halfwidth.
{
  for (let i = 0; i < 32; i++) {
    const z = -0.5 + (i / 32);
    const t = i * 0.13;
    const seed = 0xbeef * (i + 1);
    const a = G.ionColumnSample(z, t, seed);
    const b = G.ionColumnSample(z, t, seed);
    assert.deepEqual(a, b, `ionColumnSample is a pure function at (${z},${t},${seed})`);
    assert.ok(a.alpha >= 0 && a.alpha <= 1, `alpha in [0,1] at (${z},${t}) got ${a.alpha}`);
    assert.ok(Math.abs(a.x) <= 0.05 && Math.abs(a.y) <= 0.05, "jitter stays small");
  }
  // The alpha peaks near the gate.
  const atGate = G.ionColumnSample(G.GATE_Z, 0, 1).alpha;
  const farAbove = G.ionColumnSample(0.7, 0, 1).alpha;
  const farBelow = G.ionColumnSample(-0.7, 0, 1).alpha;
  assert.ok(atGate > farAbove, "column brightens toward the gate from above");
  assert.ok(atGate > farBelow, "column brightens toward the gate from below");
}

// ——— seasonTarget: walks vestibule → filter → out, bound in the middle ——
// Catches: a season cycle that never reaches the filter, or one that
// forgets to release the substance when it walks back up past the vestibule.
{
  const start = G.seasonTarget(0);
  const mid = G.seasonTarget(0.5);
  const end = G.seasonTarget(1);
  assert.ok(start.z > G.GATE_Z && start.bound, "u=0 is the bound vestibule position");
  assert.ok(mid.z < G.GATE_Z && mid.bound, "u=0.5 sits at the selectivity filter, still bound");
  assert.ok(end.z > G.VESTIBULE_Z && !end.bound, "u=1 is unbound, above the membrane");
  // Continuous: neighbouring positions land close in z.
  const a = G.seasonTarget(0.3);
  const b = G.seasonTarget(0.31);
  assert.ok(Math.abs(a.z - b.z) < 0.05, "the season walk is continuous");
}

// ——— helixHalfWidth: pinches at the gate, opens with dilation ————————
// Catches: a shader math mismatch that widens the pore at the constriction,
// or a taper that ignores the openness knob entirely.
{
  const closedAtGate = G.helixHalfWidth(G.GATE_Z, 0);
  const openAtGate = G.helixHalfWidth(G.GATE_Z, 1);
  const closedAway = G.helixHalfWidth(0.5, 0);
  assert.ok(closedAtGate < closedAway, "closed pore pinches at the gate");
  assert.ok(openAtGate > closedAtGate, "dilated gate widens the constriction");
  // Bounded — no shader NaN, no negative width.
  for (let z = -1; z <= 1; z += 0.1) {
    const w = G.helixHalfWidth(z, 0.4);
    assert.ok(w >= 0.28 && w <= 1.0, `helix halfwidth stays in [0.28, 1.0] at z=${z}`);
  }
}

// ——— serialization: round-trips the kept sigil ————————————————————————
// Catches: a serializer that loses information the ceremony's kept state
// needs (subunit, bound flag, openness at commit).
{
  const s = G.bindSubstance(G.initialChannelState("2B"), 0.4);
  const withOpen = { ...s, gateOpenness: 0.62 };
  const kept = G.serializeChannel(withOpen);
  const back = G.loadChannel(kept);
  assert.equal(back.subunit, "2B", "subunit round-trips");
  assert.equal(back.substanceBound, true, "bound flag round-trips");
  assert.ok(Math.abs(back.gateOpenness - 0.62) < 1e-6, "openness round-trips");
  // Corrupt input gives a clean fresh state.
  const fresh = G.loadChannel("garbage");
  assert.equal(fresh.substanceBound, false, "garbage load yields a fresh, unbound channel");
  assert.equal(G.loadChannel(null).substanceBound, false, "null load yields fresh channel");
  // A wrong-version blob is not loaded.
  const wrong = G.loadChannel({ v: 2, subunit: "2A" });
  assert.equal(wrong.gateOpenness, 0, "unknown version falls back to the birth state");
}

// ——— hashSeed: deterministic and order-sensitive ——————————————————————
{
  assert.equal(G.hashSeed(1, 2, 3), G.hashSeed(1, 2, 3), "hashSeed is a function");
  assert.notEqual(G.hashSeed(1, 2, 3), G.hashSeed(3, 2, 1), "hashSeed hears order");
}

console.log("gate: ok");
