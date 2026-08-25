#!/usr/bin/env node
/**
 * Focused law tests for the renderer-free TypeScript H2 RHF authority.
 *
 * These tests deliberately exercise behavior at the authority boundary. They
 * do not duplicate the cassette verifier's node constants; the verifier owns
 * the scientific payload, while this suite owns the runtime state machine.
 */

import assert from "node:assert/strict";
import { H2_RHF_CASSETTE } from "../src/lib/h2-rhf-cassette.generated.ts";
import {
  createH2RHFAuthority,
  createH2RHFAdapter,
  buildH2Fock,
  densityFromH2Fock,
  digestH2RHFCheckpoint,
  electronCountForH2Density,
  energyForH2Density,
  holdDurationToSeparation,
  interpolateH2Request,
  validateH2RHFInput,
} from "../src/lib/h2-rhf.ts";

const plain = (value) => JSON.parse(JSON.stringify(value));
const model = H2_RHF_CASSETTE.modelTuple;
const min = model.envelope.minAngstrom;
const max = model.envelope.maxAngstrom;
const midpoint = (min + max) / 2;

function assertDisposition(authority, expected, message) {
  assert.equal(authority.snapshot().disposition, expected, message);
}

function convergeReleased(authority, separation = midpoint, targetId = "h2-1") {
  authority.beginContact({ contactEpoch: 1, targetId, separationAngstrom: separation });
  authority.release();
  for (let i = 0; i < model.solver.maxIterations + 2; i += 1) {
    authority.tick();
    if (["promoted", "max-iterations", "numerical-failure"].includes(authority.snapshot().disposition)) break;
  }
  return authority.snapshot();
}

// — The authority rejects its scientific input before touching the solver —
{
  const bad = structuredClone(H2_RHF_CASSETTE);
  bad.modelVersion = "wrong-model";
  const report = validateH2RHFInput(bad);
  assert.equal(report.ok, false, "a model-mismatched cassette is rejected");
  const authority = createH2RHFAuthority(bad);
  assertDisposition(authority, "reference-unverified", "bad cassette becomes an explicit refusal");
  assert.equal(authority.snapshot().lastGood, null, "unverified input has no trusted fallback");
  assert.ok(authority.milestones().some((entry) => entry.kind === "reference-unverified"), "refusal milestone is renderer-free");
}

// — The exact two-AO map conserves the two-electron singlet —
{
  const authority = createH2RHFAuthority();
  const state = authority.snapshot();
  assert.ok(state.lastGood, "a valid authority starts with one trusted field");
  assert.ok(Math.abs(state.lastGood.electronCount - 2) <= model.solver.electronCountTolerance,
    "the trusted checkpoint has two electrons");
  assert.ok(Math.abs(electronCountForH2Density(state.lastGood.density, H2_RHF_CASSETTE.nodes[6].overlap) - 2) < 1e-8,
    "the AO density trace is two electrons");
  assert.equal(digestH2RHFCheckpoint(state.lastGood), state.lastGood.digest, "checkpoint digest is self-consistent");
}

// — Every cassette node and deterministic midpoint replays through the runtime map —
{
  function replay(separation, initialDensity = [0, 0, 0, 0]) {
    const input = interpolateH2Request(separation);
    assert.equal(input.supported, true, "cassette oracle geometry is supported");
    let density = [...initialDensity];
    let previousEnergy = null;
    let energy = Number.NaN;
    let electronCountError = Number.NaN;
    for (let iteration = 1; iteration <= model.solver.maxIterations; iteration += 1) {
      const target = densityFromH2Fock(buildH2Fock(density, input.matrices.core, input.matrices.eri), input.matrices.overlap);
      const mixed = density.map((value, index) => (1 - model.solver.damping) * value + model.solver.damping * target[index]);
      const nextEnergy = energyForH2Density(mixed, input.matrices.core, input.matrices.eri, input.matrices.enuc);
      const residual = Math.max(...mixed.map((value, index) => Math.abs(value - density[index])));
      const energyDelta = previousEnergy === null ? Number.POSITIVE_INFINITY : Math.abs(nextEnergy - previousEnergy);
      electronCountError = Math.abs(electronCountForH2Density(mixed, input.matrices.overlap) - 2);
      density = mixed;
      energy = nextEnergy;
      previousEnergy = nextEnergy;
      if (residual <= model.solver.fixedPointDensityTolerance && energyDelta <= model.solver.fixedPointEnergyTolerance && electronCountError <= model.solver.electronCountTolerance) break;
    }
    return { density, energy, electronCountError };
  }
  const nodeMax = { density: 0, energy: 0, electrons: 0 };
  for (const node of H2_RHF_CASSETTE.nodes) {
    const actual = replay(node.separationAngstrom);
    nodeMax.density = Math.max(nodeMax.density, ...actual.density.map((value, index) => Math.abs(value - node.referenceDensity[index])));
    nodeMax.energy = Math.max(nodeMax.energy, Math.abs(actual.energy - node.referenceEnergy));
    nodeMax.electrons = Math.max(nodeMax.electrons, actual.electronCountError);
  }
  const midpointMax = { density: 0, energy: 0, electrons: 0 };
  for (const node of H2_RHF_CASSETTE.midpoints) {
    const actual = replay(node.separationAngstrom);
    midpointMax.density = Math.max(midpointMax.density, ...actual.density.map((value, index) => Math.abs(value - node.referenceDensity[index])));
    midpointMax.energy = Math.max(midpointMax.energy, Math.abs(actual.energy - node.referenceEnergy));
    midpointMax.electrons = Math.max(midpointMax.electrons, actual.electronCountError);
  }
  assert.ok(nodeMax.density <= H2_RHF_CASSETTE.comparison.densityMatrixMaxAbs, "all nodes reproduce density references");
  assert.ok(nodeMax.energy <= H2_RHF_CASSETTE.comparison.totalEnergyMaxAbs, "all nodes reproduce energy references");
  assert.ok(nodeMax.electrons <= H2_RHF_CASSETTE.comparison.electronCountMaxAbs, "all nodes reproduce electron counts");
  assert.ok(midpointMax.density <= H2_RHF_CASSETTE.comparison.densityMatrixMaxAbs, "all midpoints reproduce density references");
  assert.ok(midpointMax.energy <= H2_RHF_CASSETTE.comparison.totalEnergyMaxAbs, "all midpoints reproduce energy references");
  assert.ok(midpointMax.electrons <= H2_RHF_CASSETTE.comparison.electronCountMaxAbs, "all midpoints reproduce electron counts");
}

// — Supported convergence promotes exactly once, and only after release —
{
  const authority = createH2RHFAuthority();
  authority.beginContact({ contactEpoch: 4, targetId: "stable-h2", separationAngstrom: 0.9 });
  for (let i = 0; i < model.solver.maxIterations; i += 1) authority.tick();
  assert.notEqual(authority.snapshot().disposition, "promoted", "a moving request cannot promote");
  authority.release();
  for (let i = 0; i < model.solver.maxIterations; i += 1) {
    authority.tick();
    if (authority.snapshot().disposition === "promoted") break;
  }
  const state = authority.snapshot();
  assert.equal(state.disposition, "promoted", "a released supported request promotes after strict gates");
  assert.equal(state.promotionGeneration, 1, "promotion generation increments once");
  assert.equal(state.frozenCandidate, null, "promotion consumes the frozen candidate");
  assert.ok(state.milestones.some((entry) => entry.kind === "promotion"), "promotion is retained as a renderer-free milestone");
  assert.ok(Object.isFrozen(state.milestones), "snapshot milestones are immutable");
  const generation = state.promotionGeneration;
  authority.tick();
  assert.equal(authority.snapshot().promotionGeneration, generation, "idle ticks do not promote twice");
}

// — Immediate envelope neighbors refuse without clamping or extrapolating —
for (const separation of [min - 1e-9, max + 1e-9]) {
  const authority = createH2RHFAuthority();
  const before = authority.snapshot().lastGood.digest;
  authority.beginContact({ contactEpoch: 10, targetId: "h2-edge", separationAngstrom: separation });
  assertDisposition(authority, "outside-envelope", "raw unsupported geometry refuses immediately");
  const refused = authority.snapshot();
  assert.equal(refused.movingCandidate, null, "unsupported request has no candidate");
  assert.equal(refused.lastGood.digest, before, "unsupported request retains last-good");
  assert.equal(refused.outsideEnvelopeLatched, true, "outside refusal latches for the contact");
}

// — First outside raw request latches through re-entry; release enables retry —
{
  const authority = createH2RHFAuthority();
  authority.beginContact({ contactEpoch: 20, targetId: "h2-latch", separationAngstrom: midpoint });
  authority.tick();
  const before = authority.snapshot().lastGood.digest;
  authority.requestSeparation(min - 1e-6);
  authority.requestSeparation(midpoint);
  assertDisposition(authority, "outside-envelope", "re-entry cannot re-arm a refused contact");
  assert.equal(authority.snapshot().movingCandidate, null, "latched contact discards its candidate");
  authority.release();
  assert.equal(authority.snapshot().outsideEnvelopeLatched, false, "release clears the contact latch");
  assert.equal(authority.snapshot().lastGood.digest, before, "release does not erase last-good");
  authority.beginContact({ contactEpoch: 21, targetId: "h2-latch", separationAngstrom: midpoint });
  assert.equal(authority.snapshot().movingCandidate.targetId, "h2-latch", "next contact can retry the supported request");
}

// — Release freezes the final supported request and request changes reset gates —
{
  const authority = createH2RHFAuthority();
  authority.beginContact({ contactEpoch: 30, targetId: "h2-warm", separationAngstrom: midpoint });
  authority.tick();
  authority.tick();
  const before = authority.snapshot();
  authority.requestSeparation(midpoint + 0.02);
  const changed = authority.snapshot();
  assert.equal(changed.gateStreak, 0, "supported request change resets the gate streak");
  assert.equal(changed.movingCandidate.iteration, 0, "supported request change resets its budget");
  assert.deepEqual(changed.movingCandidate.density, before.movingCandidate.density,
    "supported request change warm-starts from the current candidate, not a blank field");
  authority.tick();
  assert.notDeepEqual(authority.snapshot().movingCandidate.density, changed.movingCandidate.density,
    "the warm-start candidate continues evolving on its next authority tick");
  authority.release();
  assert.equal(authority.snapshot().frozenCandidate.requestSeparationAngstrom, changed.movingCandidate.requestSeparationAngstrom,
    "release freezes the final supported raw request");
}

// — Terminal paths retain last-good: bounded exhaustion and numerical seam —
{
  const exhausted = createH2RHFAuthority({ testSeam: { forceMaxIterations: true } });
  const before = exhausted.snapshot().lastGood.digest;
  exhausted.beginContact({ contactEpoch: 40, targetId: "h2-exhaust", separationAngstrom: midpoint });
  exhausted.release();
  for (let i = 0; i < model.solver.maxIterations; i += 1) exhausted.tick();
  assertDisposition(exhausted, "max-iterations", "a frozen request exhausts exactly its bounded budget");
  assert.equal(exhausted.snapshot().lastGood.digest, before, "exhaustion cannot replace last-good");
  assert.equal(exhausted.snapshot().movingCandidate, null, "exhaustion discards the candidate");

  const failed = createH2RHFAuthority({ testSeam: { failNumericallyAtTick: 1 } });
  const failedBefore = failed.snapshot().lastGood.digest;
  failed.beginContact({ contactEpoch: 41, targetId: "h2-fail", separationAngstrom: midpoint });
  failed.release();
  failed.tick();
  assertDisposition(failed, "numerical-failure", "the deliberate numerical seam is explicit");
  assert.equal(failed.snapshot().lastGood.digest, failedBefore, "numerical failure retains last-good");
}

// — Duration and intensity map to distinct raw supported trajectories before quantization —
{
  const short = holdDurationToSeparation(900, 1);
  const long = holdDurationToSeparation(2400, 1);
  assert.notEqual(short.rawSeparationAngstrom, long.rawSeparationAngstrom, "hold duration is a continuous axis");
  assert.equal(interpolateH2Request(short.rawSeparationAngstrom).supported, true, "raw short request is checked in the envelope");
  assert.equal(interpolateH2Request(long.rawSeparationAngstrom).supported, true, "raw long request is checked in the envelope");
  assert.notEqual(short.separationAngstrom, long.separationAngstrom, "semantic quantization preserves the distinction");
}

// — Same semantic trace is invariant to presentation cadence and background rebase —
{
  function runCadence(hz, withRebase = false) {
    const authority = createH2RHFAuthority();
    const adapter = createH2RHFAdapter(authority);
    adapter.queue({ kind: "begin-contact", contactEpoch: 77, targetId: "cadence-h2", separationAngstrom: 0.9 });
    adapter.queue({ kind: "release" });
    const frameMs = 1000 / hz;
    let rebaseTicks = null;
    for (let frame = 0; frame < hz * 4; frame += 1) {
      if (withRebase && frame === hz * 2) {
        const before = authority.snapshot().tick;
        adapter.rebase();
        rebaseTicks = { before, after: authority.snapshot().tick };
      }
      adapter.advance(frameMs);
    }
    return {
      snapshot: authority.snapshot(),
      trace: authority.trace(),
      milestones: authority.milestones(),
      adapter: adapter.snapshot(),
      rebaseTicks,
    };
  }
  const runs = [30, 60, 120].map((hz) => runCadence(hz));
  const semantic = (run) => plain({
    ticks: run.trace.filter((entry) => entry.kind === "tick").map((entry) => entry.tick),
    milestones: run.milestones.map((entry) => entry.kind),
    dispositions: run.trace.filter((entry) => entry.disposition).map((entry) => entry.disposition),
    generation: run.snapshot.promotionGeneration,
    digest: run.snapshot.lastGood?.digest ?? null,
  });
  assert.deepEqual(semantic(runs[0]), semantic(runs[1]), "30 and 60 Hz share one logical trace");
  assert.deepEqual(semantic(runs[1]), semantic(runs[2]), "60 and 120 Hz share one logical trace");
  const rebased = runCadence(60, true);
  assert.deepEqual(rebased.rebaseTicks, { before: 40, after: 40 }, "background rebase does not advance the authority");
  assert.deepEqual(semantic(rebased), semantic(runs[1]), "a zero-catch-up rebase preserves active-time semantics");
  assert.equal(rebased.adapter.accumulatorMs, 0, "background rebase drops suspended presentation time");
}

// — Replaying one semantic intervention produces byte-identical renderer-free state —
{
  function replayOnce() {
    const authority = createH2RHFAuthority();
    authority.beginContact({ contactEpoch: 88, targetId: "replay-h2", separationAngstrom: holdDurationToSeparation(900, 1).rawSeparationAngstrom });
    authority.requestSeparation(holdDurationToSeparation(2400, 1).rawSeparationAngstrom);
    authority.release();
    authority.advanceTicks(64);
    return plain({ snapshot: authority.snapshot(), trace: authority.trace(), milestones: authority.milestones() });
  }
  assert.deepEqual(replayOnce(), replayOnce(), "the same semantic intervention has one deterministic trace");
}

// — Traces and snapshots are immutable views, and their buffers are bounded —
{
  const authority = createH2RHFAuthority({ maxTraceEntries: 12 });
  authority.beginContact({ contactEpoch: 90, targetId: "h2-bounded", separationAngstrom: midpoint });
  for (let i = 0; i < 100; i += 1) authority.tick();
  const snapshot = authority.snapshot();
  assert.ok(Object.isFrozen(snapshot), "snapshot is immutable");
  assert.ok(Object.isFrozen(snapshot.lastGood), "checkpoint is immutable");
  assert.ok(authority.trace().length <= 12, "renderer-free trace is bounded");
  assert.ok(authority.milestones().length <= 12, "milestones are bounded");
  assert.ok(Object.isFrozen(authority.milestones()), "milestones are immutable");
}

console.log("h2-rhf ok: exact two-AO fixed-point map, release-only promotion, refusal latch, bounded trace, and cadence-invariant adapter");
