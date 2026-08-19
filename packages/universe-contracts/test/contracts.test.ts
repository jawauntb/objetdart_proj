import * as assert from "node:assert/strict";
import {
  RELEASE_SCENE_MANIFEST,
  deserializeAction,
  serializeAction,
  serializeContinuousGesture,
  appendNaturalHistory,
  checkpointFollowsEvent,
  compareLogicalTime,
  createUniverse,
  deserializeContinuousGesture,
  isContinuousGestureTransaction,
  isPassageAnchor,
  isUniverse,
  isVersionedAction,
  NATIVE_SCALE_ADDRESSES,
  validateReleaseSceneManifest,
  validateSceneStyle,
  validateSimulationContract,
  type GestureWindow,
  type GestureSample,
} from "../src/index.ts";

const action = {
  version: 1 as const,
  id: "action-1",
  logicalTime: 7,
  action: { verb: "grow" as const, layer: "material" as const, source: "touch" as const, intensity: 0.75, payload: { durationMs: 900, target: "cell-1" } },
};

const encoded = serializeAction(action);
assert.equal(encoded, serializeAction(JSON.parse(encoded)));
assert.deepEqual(deserializeAction(encoded), { supported: true, value: action });
assert.deepEqual(deserializeAction('{"version":2,"future":"kept"}'), { supported: false, reason: "unsupported-version", raw: '{"version":2,"future":"kept"}' });
assert.equal(deserializeAction(JSON.stringify({ ...action, action: { ...action.action, payload: { renderer: "metal" } } })).supported, false);
assert.equal(isVersionedAction({ ...action, renderer: "metal" }), false);
assert.equal(isVersionedAction({ ...action, action: { ...action.action, frameState: "metal" } }), false);
assert.equal(isVersionedAction({ ...action, debug: "extra" }), false);

function linearSamples(hz: number): GestureSample[] {
  return Array.from({ length: hz + 1 }, (_, index) => {
    const atMs = (index * 1000) / hz;
    return { atMs, x: atMs / 10, y: atMs / 20, intensity: atMs / 1000 };
  });
}

const gestureWindow: GestureWindow = { startedAtMs: 0, endedAtMs: 1000 };
const trace30 = serializeContinuousGesture("gesture-1", "drag", linearSamples(30), gestureWindow);
const trace60 = serializeContinuousGesture("gesture-1", "drag", linearSamples(60), gestureWindow);
const trace120 = serializeContinuousGesture("gesture-1", "drag", linearSamples(120), gestureWindow);
assert.deepEqual(trace30, trace60);
assert.deepEqual(trace60, trace120);
assert.equal(trace30.chunks.length, 4);
assert.equal(trace30.chunks[0].samples.length, 5);
assert.deepEqual(trace30.final, { atMs: 1000, x: 100, y: 50, intensity: 1 });
assert.deepEqual(trace30.chunks.map((chunk) => chunk.index), [0, 5, 10, 15]);

function offsetLinearSamples(hz: number, offsetMs: number): GestureSample[] {
  const interval = 1000 / hz;
  const length = Math.floor((1000 - offsetMs) / interval) + 1;
  return Array.from({ length }, (_, index) => {
    const atMs = offsetMs + index * interval;
    return { atMs, x: atMs / 10, y: atMs / 20, intensity: atMs / 1000 };
  });
}

const offset30 = serializeContinuousGesture("gesture-1", "drag", offsetLinearSamples(30, 7), gestureWindow);
const offset60 = serializeContinuousGesture("gesture-1", "drag", offsetLinearSamples(60, 13), { startedAtMs: 24, endedAtMs: 1024 });
const offset120 = serializeContinuousGesture("gesture-1", "drag", offsetLinearSamples(120, 19), gestureWindow);
assert.deepEqual(offset30, trace30);
assert.deepEqual(offset60, trace60);
assert.deepEqual(offset120, trace120);
const shiftedTrace = serializeContinuousGesture("gesture-2", "drag", linearSamples(30).map((sample) => ({ ...sample, atMs: sample.atMs + 50 })), { startedAtMs: 61, endedAtMs: 1061 });
assert.equal(shiftedTrace.startedAtMs, 50);
assert.equal(shiftedTrace.endedAtMs, 1050);
assert.deepEqual(shiftedTrace.chunks.map((chunk) => chunk.index), [1, 6, 11, 16]);
assert.equal(isContinuousGestureTransaction(trace30), true);
assert.deepEqual(deserializeContinuousGesture(JSON.stringify(trace30)), { supported: true, value: trace30 });
assert.equal(isContinuousGestureTransaction({ ...trace30, kind: "spin" }), false);
assert.equal(isContinuousGestureTransaction({ ...trace30, chunks: trace30.chunks.slice(1) }), false);
assert.equal(isContinuousGestureTransaction({ ...trace30, final: { ...trace30.final, atMs: 999 } }), false);
assert.equal(isContinuousGestureTransaction({ ...trace30, chunks: [{ ...trace30.chunks[0], samples: [] }, { ...trace30.chunks[1], samples: [trace30.chunks[0].samples[0], ...trace30.chunks[1].samples] }, ...trace30.chunks.slice(2)] }), false);
assert.equal(deserializeContinuousGesture('{"version":2}').supported, false);

const release = validateReleaseSceneManifest(RELEASE_SCENE_MANIFEST);
assert.equal(release.valid, true, release.errors.join("\n"));
assert.deepEqual(RELEASE_SCENE_MANIFEST.map((scene) => scene.id), ["wave", "cell", "solar"]);
const fabricatedScaleManifest = [{ ...RELEASE_SCENE_MANIFEST[0], scale: { ...RELEASE_SCENE_MANIFEST[0].scale, physical: { ...RELEASE_SCENE_MANIFEST[0].scale.physical, log10Metres: 99 } } }, ...RELEASE_SCENE_MANIFEST.slice(1)] as unknown as typeof RELEASE_SCENE_MANIFEST;
assert.equal(validateReleaseSceneManifest(fabricatedScaleManifest).valid, false);
const unreviewedManifest = [{ ...RELEASE_SCENE_MANIFEST[0], requirements: { ...RELEASE_SCENE_MANIFEST[0].requirements, science: { ...RELEASE_SCENE_MANIFEST[0].requirements.science, evidence: { ...RELEASE_SCENE_MANIFEST[0].requirements.science.evidence, sourceIds: [] } } } }, ...RELEASE_SCENE_MANIFEST.slice(1)];
assert.equal(validateReleaseSceneManifest(unreviewedManifest).valid, false);
const wrongScienceSourceManifest = [{ ...RELEASE_SCENE_MANIFEST[0], requirements: { ...RELEASE_SCENE_MANIFEST[0].requirements, science: { ...RELEASE_SCENE_MANIFEST[0].requirements.science, evidence: { ...RELEASE_SCENE_MANIFEST[0].requirements.science.evidence, sourceIds: ["wave-fdtd-taflove-hagness-2005", "not-a-stable-source", "wave-nist-dlmf"] } } } }, ...RELEASE_SCENE_MANIFEST.slice(1)];
assert.equal(validateReleaseSceneManifest(wrongScienceSourceManifest).valid, false);
const unapprovedManifest = [{ ...RELEASE_SCENE_MANIFEST[0], requirements: { ...RELEASE_SCENE_MANIFEST[0].requirements, performance: { ...RELEASE_SCENE_MANIFEST[0].requirements.performance, evidence: { ...RELEASE_SCENE_MANIFEST[0].requirements.performance.evidence, reviewerId: "" } } } }, ...RELEASE_SCENE_MANIFEST.slice(1)];
assert.equal(validateReleaseSceneManifest(unapprovedManifest).valid, false);

const brokenSimulation = { ...RELEASE_SCENE_MANIFEST[0].simulation, validity: [] };
assert.equal(validateSimulationContract(brokenSimulation).valid, false);
const brokenStyle = { ...RELEASE_SCENE_MANIFEST[0].style, forms: ["generic-particles"] };
assert.equal(validateSceneStyle(brokenStyle).valid, false);
assert.doesNotThrow(() => validateSimulationContract({ ...RELEASE_SCENE_MANIFEST[0].simulation, units: [null] }));
assert.equal(validateSimulationContract({ ...RELEASE_SCENE_MANIFEST[0].simulation, units: [null] }).valid, false);
assert.doesNotThrow(() => validateSceneStyle({ ...RELEASE_SCENE_MANIFEST[0].style, stateToSense: [null] }));
assert.equal(validateSceneStyle({ ...RELEASE_SCENE_MANIFEST[0].style, stateToSense: [null] }).valid, false);

const root = { id: "branch-root", parentId: null, forkedAt: null, writerEpoch: { writerId: "device-a", epoch: 0 } } as const;
const universe = createUniverse({ version: 1, id: "universe-1", seed: "seed-1", modelVersion: "v1", logicalTime: { tick: 4, ordinal: 2 }, inhabitedBranchId: "branch-root" }, root);
assert.equal(universe.branches[0].id, "branch-root");
assert.ok(compareLogicalTime({ tick: 4, ordinal: 2 }, { tick: 5, ordinal: 0 }) < 0);
const identity = universe.identity;
const child = { id: "branch-child", parentId: "branch-root", forkedAt: { tick: 4, ordinal: 2 }, writerEpoch: { writerId: "device-a", epoch: 1 } };
assert.equal(isUniverse({ identity, branches: [root, child] }), true);
assert.equal(isUniverse({ identity, branches: [root, { ...child, id: "second-root", parentId: null, forkedAt: null }] }), false);
assert.equal(isUniverse({ identity, branches: [root, { ...child, parentId: "missing" }] }), false);
assert.equal(isUniverse({ identity, branches: [root, { ...child, id: "branch-a", parentId: "branch-b" }, { ...child, id: "branch-b", parentId: "branch-a" }] }), false);
assert.equal(isUniverse({ identity, branches: [root, { ...child, forkedAt: { tick: 5, ordinal: 0 } }] }), false);
assert.equal(isUniverse({ identity, branches: [root, { ...child, forkedAt: null }] }), false);
assert.equal(isUniverse({ identity, branches: [root, child, { ...child, id: "branch-grandchild", parentId: "branch-child", forkedAt: { tick: 4, ordinal: 1 } }] }), false);

const historyEvent = { version: 1 as const, id: "history-1", kind: "birth" as const, branchId: "branch-root", logicalTime: { tick: 4, ordinal: 2 }, domainEventId: "event-1", subjectIds: ["cell-1"], summary: "a cell begins" };
assert.equal(appendNaturalHistory([historyEvent], historyEvent).length, 1);
assert.equal(checkpointFollowsEvent({ version: 1, id: "checkpoint-1", branchId: "branch-root", logicalTime: { tick: 4, ordinal: 3 }, modelVersion: "v1", stateDigest: "digest" }, { version: 1, id: "event-1", branchId: "branch-root", logicalTime: { tick: 4, ordinal: 2 }, domainTime: { address: NATIVE_SCALE_ADDRESSES["cellular-colony"], seconds: 3 }, action }), true);
assert.equal(isPassageAnchor({ version: 1, id: "same-place", from: NATIVE_SCALE_ADDRESSES["wave-medium"], to: { ...NATIVE_SCALE_ADDRESSES["wave-medium"], lens: "spectrum" }, handoff: "detent" }), false);

console.log("universe contracts: action versioning, 20Hz serialization, manifest, and validators pass");
