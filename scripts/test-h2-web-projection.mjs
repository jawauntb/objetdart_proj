#!/usr/bin/env node
/**
 * Falsifiable law tests for the renderer-free H₂ web presentation seam.
 *
 * Run with Node 22's TypeScript strip mode:
 *   node --experimental-strip-types scripts/test-h2-web-projection.mjs
 */

import assert from "node:assert/strict";
import { H2_RHF_CASSETTE } from "../src/lib/h2-rhf-cassette.generated.ts";
import {
  createH2RHFAuthority,
} from "../src/lib/h2-rhf.ts";
import {
  H2_RHF_PROJECTION_COMPONENTS,
  H2_RHF_PROJECTION_LENGTH,
  createH2RHFTransitionCueDeduper,
  createH2RHFTransitionCueState,
  h2RHFProjectionSource,
  h2RHFResidualToTension,
  h2RHFTransitionIdentity,
  projectH2RHFTransitionCues,
  writeH2RHFProjection,
} from "../src/lib/h2-rhf-presentation.ts";

const MODEL = H2_RHF_CASSETTE.modelTuple;
const MIDPOINT = (MODEL.envelope.minAngstrom + MODEL.envelope.maxAngstrom) * 0.5;
const TARGET = {
  targetId: "h2-1",
  centerX: 137,
  centerY: 211,
  radiusPx: 18,
  separationPx: 34,
};

function target(targetId = TARGET.targetId) {
  return { ...TARGET, targetId };
}

function values(buffer) {
  return Array.from(buffer, (value) => Number(value));
}

function sameValues(left, right, tolerance = 1e-6) {
  assert.equal(left.length, right.length);
  for (let index = 0; index < left.length; index += 1) {
    assert.ok(Math.abs(left[index] - right[index]) <= tolerance,
      `projection lane ${index} differs: ${left[index]} vs ${right[index]}`);
  }
}

function assertDensityVerbatim(buffer, density, message) {
  const expected = new Float32Array(density);
  for (let index = 0; index < 4; index += 1) {
    assert.equal(buffer[index], expected[index], `${message} density[${index}] is copied exactly into Float32 storage`);
  }
}

function assertPresentationBounded(buffer, message) {
  for (const index of [
    H2_RHF_PROJECTION_COMPONENTS.tension,
    H2_RHF_PROJECTION_COMPONENTS.footprint,
    H2_RHF_PROJECTION_COMPONENTS.phase,
    H2_RHF_PROJECTION_COMPONENTS.fieldStrength,
  ]) {
    const value = buffer[index];
    assert.ok(Number.isFinite(value), `${message} presentation lane ${index} remains finite`);
    assert.ok(value >= 0 && value <= 1, `${message} presentation lane ${index} remains in [0, 1]`);
  }
}

function converge(authority, separation = MIDPOINT) {
  authority.beginContact({ contactEpoch: 1, targetId: TARGET.targetId, separationAngstrom: separation });
  authority.release();
  for (let index = 0; index < MODEL.solver.maxIterations + 2; index += 1) {
    authority.tick();
    if (["promoted", "max-iterations", "numerical-failure"].includes(authority.snapshot().disposition)) break;
  }
  return authority.snapshot();
}

function refusalSnapshot(kind) {
  if (kind === "outside-envelope") {
    const authority = createH2RHFAuthority();
    return authority.beginContact({ contactEpoch: 31, targetId: TARGET.targetId, separationAngstrom: MODEL.envelope.minAngstrom - 0.001 });
  }
  if (kind === "max-iterations") {
    const authority = createH2RHFAuthority({ testSeam: { forceMaxIterations: true } });
    authority.beginContact({ contactEpoch: 32, targetId: TARGET.targetId, separationAngstrom: MIDPOINT });
    authority.release();
    for (let index = 0; index < MODEL.solver.maxIterations + 1; index += 1) authority.tick();
    return authority.snapshot();
  }
  if (kind === "numerical-failure") {
    const authority = createH2RHFAuthority({ testSeam: { failNumericallyAtTick: 1 } });
    authority.beginContact({ contactEpoch: 33, targetId: TARGET.targetId, separationAngstrom: MIDPOINT });
    authority.release();
    authority.tick();
    return authority.snapshot();
  }
  if (kind === "cancelled") {
    const authority = createH2RHFAuthority();
    authority.beginContact({ contactEpoch: 34, targetId: TARGET.targetId, separationAngstrom: MIDPOINT });
    return authority.cancel();
  }
  throw new Error(`unknown refusal ${kind}`);
}

// A trusted checkpoint is the default field, and a still-correcting candidate
// replaces it. The candidate has a changed density and a non-zero residual.
{
  const trusted = createH2RHFAuthority().snapshot();
  const candidateAuthority = createH2RHFAuthority();
  candidateAuthority.beginContact({ contactEpoch: 41, targetId: TARGET.targetId, separationAngstrom: 0.9 });
  candidateAuthority.tick();
  const candidate = candidateAuthority.snapshot();
  assert.equal(h2RHFProjectionSource(trusted)?.source, "last-good");
  assert.equal(h2RHFProjectionSource(candidate)?.source, "candidate");
  const lastGoodOut = new Float32Array(H2_RHF_PROJECTION_LENGTH);
  const candidateOut = new Float32Array(H2_RHF_PROJECTION_LENGTH);
  assert.equal(writeH2RHFProjection(trusted, TARGET, false, lastGoodOut), true);
  assert.equal(writeH2RHFProjection(candidate, TARGET, false, candidateOut), true);
  assert.notDeepEqual(values(candidateOut), values(lastGoodOut), "candidate density/tension replaces the last-good projection while correcting");
  assertDensityVerbatim(lastGoodOut, trusted.lastGood.density, "last-good");
  assertDensityVerbatim(candidateOut, candidate.candidate.density, "candidate");
  assert.ok(candidateOut[H2_RHF_PROJECTION_COMPONENTS.tension] > 0, "a candidate with residual has visible tension");
  assertPresentationBounded(candidateOut, "candidate projection");
  assertPresentationBounded(lastGoodOut, "last-good projection");
}

// Every terminal refusal is last-good-only. A candidate-shaped field beside a
// refusal cannot leak into the output; no last-good means the projection is
// disabled rather than inventing a fallback field.
{
  const baseline = createH2RHFAuthority().snapshot();
  for (const kind of ["outside-envelope", "max-iterations", "numerical-failure", "cancelled"]) {
    const refused = refusalSnapshot(kind);
    const expected = new Float32Array(H2_RHF_PROJECTION_LENGTH);
    const actual = new Float32Array(H2_RHF_PROJECTION_LENGTH);
    assert.equal(writeH2RHFProjection(baseline, TARGET, false, expected), true, `${kind} baseline is drawable`);
    assert.equal(writeH2RHFProjection(refused, TARGET, false, actual), true, `${kind} retains a last-good field`);
    sameValues(actual, expected);
    assertDensityVerbatim(actual, refused.lastGood.density, `${kind} refusal`);
    assert.equal(refused.lastGood?.digest, baseline.lastGood?.digest, `${kind} leaves the last-good digest unchanged`);
  }

  const candidate = structuredClone(baseline);
  candidate.disposition = "reference-unverified";
  candidate.candidate = {
    targetId: TARGET.targetId,
    contactEpoch: 99,
    status: "moving",
    rawSeparationAngstrom: 0.91,
    requestSeparationAngstrom: 0.91,
    density: [99, 0, 0, 99],
    energy: 99,
    residual: 0,
    energyDelta: 0,
    electronCount: 2,
    electronCountError: 0,
    iteration: 1,
    gateStreak: 0,
  };
  candidate.movingCandidate = candidate.candidate;
  const actual = new Float32Array(H2_RHF_PROJECTION_LENGTH);
  assert.equal(writeH2RHFProjection(candidate, TARGET, false, actual), true, "reference refusal with a last-good field remains drawable");
  const expected = new Float32Array(H2_RHF_PROJECTION_LENGTH);
  writeH2RHFProjection(baseline, TARGET, false, expected);
  sameValues(actual, expected);

  const invalidAuthority = createH2RHFAuthority({ cassette: { modelVersion: "wrong" } });
  const disabled = new Float32Array(H2_RHF_PROJECTION_LENGTH).fill(1);
  assert.equal(writeH2RHFProjection(invalidAuthority.snapshot(), TARGET, false, disabled), false, "reference-unverified without last-good disables the field");
  assert.deepEqual(values(disabled), new Array(H2_RHF_PROJECTION_LENGTH).fill(0), "disabled projection clears scratch");
}

// Geometry and stable identity are a hard gate. The caller can reuse the same
// scratch object, and the scientific snapshot is byte-for-byte unchanged.
{
  const snapshot = createH2RHFAuthority().snapshot();
  const before = JSON.stringify(snapshot);
  const scratch = new Float32Array(H2_RHF_PROJECTION_LENGTH);
  assert.equal(writeH2RHFProjection(snapshot, TARGET, false, scratch), true);
  assert.equal(writeH2RHFProjection(snapshot, TARGET, true, scratch), true);
  assert.equal(JSON.stringify(snapshot), before, "projection never mutates scientific input");
  assert.equal(writeH2RHFProjection(snapshot, target("other-body"), false, scratch), false, "target mismatch disables the projection");
  assert.deepEqual(values(scratch), new Array(H2_RHF_PROJECTION_LENGTH).fill(0), "target mismatch clears reused scratch");
  assert.equal(writeH2RHFProjection(snapshot, { ...TARGET, radiusPx: Number.NaN }, false, scratch), false, "malformed target geometry disables the projection");
  assert.deepEqual(values(scratch), new Array(H2_RHF_PROJECTION_LENGTH).fill(0), "malformed geometry clears reused scratch");

  const badDigest = structuredClone(snapshot);
  badDigest.lastGood.digest = "not-the-authority-digest";
  assert.equal(writeH2RHFProjection(badDigest, TARGET, false, scratch), false, "malformed last-good digest disables the field");
  assert.deepEqual(values(scratch), new Array(H2_RHF_PROJECTION_LENGTH).fill(0), "malformed digest clears reused scratch");

  const mutableCheckpoint = structuredClone(snapshot);
  assert.equal(writeH2RHFProjection(mutableCheckpoint, TARGET, false, scratch), true, "a valid mutable fixture is checked directly");
  mutableCheckpoint.lastGood.density[0] += 0.25;
  assert.equal(writeH2RHFProjection(mutableCheckpoint, TARGET, false, scratch), false, "mutating a checked checkpoint cannot reuse cached validity");

  const residualAuthority = createH2RHFAuthority();
  residualAuthority.beginContact({ contactEpoch: 52, targetId: TARGET.targetId, separationAngstrom: 0.93 });
  residualAuthority.tick();
  const badResidual = structuredClone(residualAuthority.snapshot());
  badResidual.candidate.residual = -1;
  badResidual.movingCandidate.residual = -1;
  assert.equal(writeH2RHFProjection(badResidual, TARGET, false, scratch), false, "negative candidate residual disables the field");
  assert.deepEqual(values(scratch), new Array(H2_RHF_PROJECTION_LENGTH).fill(0), "malformed residual clears reused scratch");
}

// Reduced motion freezes only the presentation phase; field strength,
// tension, and footprint stay scientific-input invariant.
{
  const authority = createH2RHFAuthority();
  authority.beginContact({ contactEpoch: 51, targetId: TARGET.targetId, separationAngstrom: 0.93 });
  authority.tick();
  const snapshot = authority.snapshot();
  const animated = new Float32Array(H2_RHF_PROJECTION_LENGTH);
  const reduced = new Float32Array(H2_RHF_PROJECTION_LENGTH);
  writeH2RHFProjection(snapshot, TARGET, false, animated);
  writeH2RHFProjection(snapshot, TARGET, true, reduced);
  sameValues(values(animated).slice(0, 6), values(reduced).slice(0, 6));
  assertDensityVerbatim(animated, snapshot.candidate.density, "reduced-motion candidate");
  assertDensityVerbatim(reduced, snapshot.candidate.density, "reduced-motion candidate");
  assert.equal(reduced[H2_RHF_PROJECTION_COMPONENTS.phase], 0.5, "reduced motion uses a quiet phase detent");
  assertPresentationBounded(animated, "animated projection");
  assertPresentationBounded(reduced, "reduced projection");
}

// Residual-to-tension is continuous, monotone, finite, and bounded at both
// ends, including the initial infinite residual sentinel.
{
  const samples = [0, 1e-12, 0.001, 0.01, 0.1, 1, Number.MAX_VALUE, null, Number.POSITIVE_INFINITY];
  const mapped = samples.map(h2RHFResidualToTension);
  for (const value of mapped) assert.ok(value >= 0 && value <= 1 && Number.isFinite(value));
  assert.equal(mapped.at(-2), 1);
  assert.equal(mapped.at(-1), 1);
  assert.equal(mapped[0], 0);
  for (let index = 1; index < mapped.length; index += 1) assert.ok(mapped[index] >= mapped[index - 1], "tension does not fall as residual grows");
}

// Accessibility and sensory cues are semantic transitions, not solver ticks.
// One contact emits one correction cue; repeated drains and ordinary ticks do
// not duplicate it. A new contact epoch is a new correction identity.
{
  const authority = createH2RHFAuthority();
  const deduper = createH2RHFTransitionCueDeduper();
  authority.beginContact({ contactEpoch: 61, targetId: TARGET.targetId, separationAngstrom: 0.9 });
  const first = deduper.drain(authority.snapshot());
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, "field-correcting");
  assert.equal(first[0].cueKind, "correction");
  assert.equal(first[0].retry, "continue-contact");
  assert.equal(deduper.drain(authority.snapshot()).length, 0, "same semantic milestone is deduplicated");
  authority.requestSeparation({ separationAngstrom: 0.91 });
  authority.requestSeparation({ separationAngstrom: 0.92 });
  assert.equal(deduper.drain(authority.snapshot()).length, 0, "request updates inside one contact do not repeat the correction cue");
  authority.tick();
  assert.equal(deduper.drain(authority.snapshot()).length, 0, "solver tick emits no accessibility or sensory cue");
  assert.equal(deduper.emittedCount, 0, "an empty logical tick advances the bounded cue cursor");
  assert.equal(deduper.drain(authority.snapshot()), deduper.drain(authority.snapshot()), "empty drains reuse the shared immutable result");

  authority.release();
  for (let index = 0; index < MODEL.solver.maxIterations + 2; index += 1) {
    authority.tick();
    if (["promoted", "max-iterations", "numerical-failure"].includes(authority.snapshot().disposition)) break;
  }
  const settled = deduper.drain(authority.snapshot());
  assert.equal(settled.length, 1, "promotion emits one settled cue");
  assert.equal(settled[0].kind, "field-settled");
  assert.equal(settled[0].retry, "no-retry-needed");
  assert.equal(deduper.drain(authority.snapshot()).length, 0);

  authority.beginContact({ contactEpoch: 62, targetId: TARGET.targetId, separationAngstrom: 0.91 });
  assert.equal(deduper.drain(authority.snapshot()).length, 1, "new contact epoch emits a new correction cue");
}

// Every refusal has distinct outcome and retry data, and each is emitted only
// once even if the snapshot is drained repeatedly.
{
  for (const kind of ["outside-envelope", "max-iterations", "numerical-failure", "cancelled"]) {
    const state = createH2RHFTransitionCueState();
    const refused = refusalSnapshot(kind);
    const cues = projectH2RHFTransitionCues(refused, state);
    const refusalCues = cues.filter((cue) => cue.cueKind === "refusal");
    assert.equal(refusalCues.length, 1, `${kind} emits one refusal cue`);
    assert.equal(refusalCues[0].kind, "field-refused");
    assert.equal(refusalCues[0].outcome, kind);
    assert.ok(refusalCues[0].outcomeText.plain.length > 0);
    assert.ok(refusalCues[0].outcomeText.retry.length > 0);
    assert.equal(refusalCues[0].sensory.eventId, refusalCues[0].id);
    assert.equal(projectH2RHFTransitionCues(refused, state).length, 0, `${kind} is deduplicated by semantic milestone identity`);
  }
  const invalid = createH2RHFAuthority({ cassette: { modelVersion: "wrong" } });
  const invalidState = createH2RHFTransitionCueState();
  const invalidCue = projectH2RHFTransitionCues(invalid.snapshot(), invalidState);
  assert.equal(invalidCue.length, 1, "reference-unverified emits a refusal cue");
  assert.equal(invalidCue[0].outcome, "reference-unverified");
  assert.equal(invalidCue[0].retry, "restore-reference");
}

// The identity carries the trusted model version and stable target. Two
// semantic milestones at one authority tick remain distinct when the target
// changes, while repeated drains do not replay either cue.
{
  const authority = createH2RHFAuthority();
  authority.beginContact({ contactEpoch: 91, targetId: TARGET.targetId, separationAngstrom: 0.9 });
  const contact = authority.snapshot().milestones.find((milestone) => milestone.kind === "contact-begin");
  assert.ok(contact);
  const otherTarget = { ...contact, targetId: "h2-2", contactEpoch: 92 };
  const sameTick = { ...authority.snapshot(), milestones: Object.freeze([contact, otherTarget]) };
  const state = createH2RHFTransitionCueState(1);
  const cues = projectH2RHFTransitionCues(sameTick, state);
  assert.equal(cues.length, 2, "same-tick milestones for different targets both emit once");
  assert.notEqual(cues[0].id, cues[1].id, "target identity participates in cue identity");
  assert.ok(cues[0].id.startsWith(`h2-rhf:${H2_RHF_CASSETTE.modelVersion}|`), "cue id keeps the trusted model version namespace");
  assert.equal(cues[0].modelVersion, H2_RHF_CASSETTE.modelVersion);
  assert.match(h2RHFTransitionIdentity(contact), new RegExp(`^${H2_RHF_CASSETTE.modelVersion}\\|${TARGET.targetId}\\|`));
  assert.equal(projectH2RHFTransitionCues(sameTick, state).length, 0, "same-tick cues are deduplicated without eviction");
}

// A former tiny max-key limit cannot evict identities: retained unseen history
// is emitted once on a delayed first drain, then never replays when later
// history still contains those older milestones.
{
  const baseAuthority = createH2RHFAuthority();
  baseAuthority.beginContact({ contactEpoch: 101, targetId: TARGET.targetId, separationAngstrom: 0.9 });
  const contact = baseAuthority.snapshot().milestones.find((milestone) => milestone.kind === "contact-begin");
  assert.ok(contact);
  const promoted = converge(createH2RHFAuthority(), 0.9).milestones.find((milestone) => milestone.kind === "promotion");
  assert.ok(promoted);
  const refused = refusalSnapshot("outside-envelope").milestones.find((milestone) => milestone.kind === "outside-envelope");
  assert.ok(refused);
  const delayed = {
    ...baseAuthority.snapshot(),
    tick: 3,
    milestones: Object.freeze([
      contact,
      { ...promoted, tick: 1, contactEpoch: 102 },
      { ...refused, tick: 2, contactEpoch: 103 },
    ]),
  };
  const state = createH2RHFTransitionCueState(1);
  assert.equal(projectH2RHFTransitionCues(delayed, state).length, 3, "all retained unseen milestones emit after a delayed drain");
  assert.equal(projectH2RHFTransitionCues(delayed, state).length, 0, "delayed milestones do not replay after the first drain");
  const later = {
    ...delayed,
    tick: 4,
    milestones: Object.freeze([
      ...delayed.milestones,
      { ...contact, tick: 4, contactEpoch: 104 },
    ]),
  };
  const laterCues = projectH2RHFTransitionCues(later, state);
  assert.equal(laterCues.length, 1, "a new later-tick transition emits once");
  assert.equal(projectH2RHFTransitionCues(later, state).length, 0, "scanning old history never replays prior cues");
}

console.log("h2-rhf web projection: ok (candidate/last-good, refusals, reduced motion, and transition cues)");
