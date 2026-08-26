import assert from "node:assert/strict";
import {
  DEFAULT_MOLECULE_STORAGE_CAP,
  H2_RHF_PERSISTENCE_MODEL,
  MOLECULE_STORAGE_V1_KEY,
  MOLECULE_STORAGE_V2_KEY,
  buildMoleculePersistenceEnvelope,
  deriveMoleculeId,
  migrateMoleculePersistence,
  parseMoleculePersistence,
  readMoleculePersistence,
  serializeMoleculePersistence,
} from "../src/lib/molecule-persistence.ts";
import { digestH2RHFCheckpoint } from "../src/lib/h2-rhf.ts";

const molecule = (id, seed, nx = 0.2, ny = 0.3, extra = {}) => ({ id, seed, nx, ny, ...extra });
const good = (bodyId = "body-b") => {
  const checkpoint = {
    targetId: bodyId,
    separationAngstrom: 0.75,
    density: [0.604838540352, 0.604838540352, 0.604838540352, 0.604838540352],
    energy: -1.116151448939,
    electronCount: 2,
    promotionGeneration: 4,
  };
  return {
  bodyId,
  model: { ...H2_RHF_PERSISTENCE_MODEL },
  lastGood: {
    ...checkpoint,
    digest: digestH2RHFCheckpoint(checkpoint),
  },
  };
};

class MemoryStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
    this.writes = [];
  }
  getItem(key) {
    return this.entries.has(key) ? this.entries.get(key) : null;
  }
  setItem(key, value) {
    this.writes.push({ key, value });
    this.entries.set(key, value);
  }
}

const v1 = JSON.stringify({ molecules: [molecule("stable-a", 11), molecule(undefined, 12, 0.4, 0.5)] });

// Missing is not the same thing as an explicitly initialized empty beaker.
assert.equal(parseMoleculePersistence(null).status, "missing");
assert.equal(parseMoleculePersistence(undefined).status, "missing");
assert.equal(parseMoleculePersistence("").status, "malformed", "empty bytes are not a missing key");
const emptyV1 = parseMoleculePersistence(JSON.stringify({ molecules: [] }));
assert.equal(emptyV1.status, "valid-empty");
assert.equal(emptyV1.sourceVersion, 1);
assert.equal(emptyV1.state.initialized, true);
assert.deepEqual(emptyV1.state.molecules, []);

// v1 accepts optional ids and upgrades them deterministically without losing
// stable ids.  Two equal seeds remain two bodies, not one seed-keyed body.
const duplicateSeedV1 = parseMoleculePersistence(JSON.stringify({
  molecules: [molecule("first", 99, 0.1, 0.1), molecule("second", 99, 0.1, 0.1), molecule(undefined, 99, 0.1, 0.1)],
}));
assert.equal(duplicateSeedV1.status, "valid-populated");
assert.deepEqual(duplicateSeedV1.state.molecules.map((item) => item.id), ["first", "second", duplicateSeedV1.state.molecules[2].id]);
assert.equal(new Set(duplicateSeedV1.state.molecules.map((item) => item.id)).size, 3);
assert.equal(duplicateSeedV1.state.molecules[0].seed, duplicateSeedV1.state.molecules[2].seed);
const duplicateSeedAgain = parseMoleculePersistence(JSON.stringify({
  molecules: [molecule("first", 99, 0.1, 0.1), molecule("second", 99, 0.1, 0.1), molecule(undefined, 99, 0.1, 0.1)],
}));
assert.deepEqual(duplicateSeedAgain, duplicateSeedV1, "legacy id derivation is replay-stable");

// The v2 envelope has an explicit initialization marker, ordinal, and H2
// state.  Provisional fields are intentionally absent from the result.
const v2Input = {
  schemaVersion: 2,
  initialized: true,
  nextOrdinal: 12,
  molecules: [molecule("body-a", 10), molecule("body-b", 10, 0.6, 0.7)],
  h2: {
    ...good("body-b"),
    candidate: { status: "moving", energy: 123 },
    movingCandidate: { status: "moving" },
    frozenCandidate: { status: "frozen" },
    trace: [{ kind: "tick" }],
    milestones: [{ kind: "request" }],
    provisional: { density: [999] },
  },
};
const populatedV2 = parseMoleculePersistence(JSON.stringify(v2Input));
assert.equal(populatedV2.status, "valid-populated");
assert.equal(populatedV2.sourceVersion, 2);
assert.equal(populatedV2.state.nextOrdinal, 12);
assert.deepEqual(populatedV2.state.h2, good("body-b"));
assert.deepEqual(Object.keys(populatedV2.state.h2).sort(), ["bodyId", "lastGood", "model"]);
assert.deepEqual(Object.keys(populatedV2.state.h2.lastGood).sort(), [
  "density",
  "digest",
  "electronCount",
  "energy",
  "promotionGeneration",
  "separationAngstrom",
  "targetId",
]);
assert.deepEqual(populatedV2.state.h2.model, H2_RHF_PERSISTENCE_MODEL, "v2 keeps the trusted five-field model tuple exactly");
const wrongModel = parseMoleculePersistence(JSON.stringify({
  ...v2Input,
  h2: { ...good("body-b"), model: { ...H2_RHF_PERSISTENCE_MODEL, modelVersion: "future" } },
}));
assert.equal(wrongModel.status, "malformed", "a checkpoint from another solver cannot resume");
const badDensity = parseMoleculePersistence(JSON.stringify({
  ...v2Input,
  h2: { ...good("body-b"), lastGood: { ...good("body-b").lastGood, density: [1, 2, 3] } },
}));
assert.equal(badDensity.status, "malformed", "H2 density must be exactly four finite values");
const staleDigest = parseMoleculePersistence(JSON.stringify({
  ...v2Input,
  h2: { ...good("body-b"), lastGood: { ...good("body-b").lastGood, digest: "stale" } },
}));
assert.equal(staleDigest.status, "malformed", "checkpoint digest is recomputed, not trusted from storage");
const nestedSnapshot = parseMoleculePersistence(JSON.stringify({
  ...v2Input,
  h2: { ...good("body-b"), lastGood: { ...good("body-b").lastGood, nestedLastGood: { digest: "transient" } } },
}));
assert.equal(nestedSnapshot.status, "malformed", "a whole authority snapshot cannot hide inside lastGood");
const unsafeGeneration = parseMoleculePersistence(JSON.stringify({
  ...v2Input,
  h2: { ...good("body-b"), lastGood: { ...good("body-b").lastGood, promotionGeneration: 9007199254740992 } },
}));
assert.equal(unsafeGeneration.status, "malformed", "promotion generation must be a safe integer");
assert.equal(parseMoleculePersistence(JSON.stringify({
  schemaVersion: 2,
  initialized: true,
  nextOrdinal: 9007199254740992,
  molecules: [],
})).status, "malformed", "nextOrdinal must be a safe integer");
const emptyV2 = parseMoleculePersistence(JSON.stringify({ schemaVersion: 2, initialized: true, nextOrdinal: 8, molecules: [], h2: null }));
assert.equal(emptyV2.status, "valid-empty");
assert.equal(emptyV2.state.nextOrdinal, 8);
assert.equal(emptyV2.state.h2, null);
assert.equal(parseMoleculePersistence(JSON.stringify({ schemaVersion: 2, initialized: true, nextOrdinal: 0, molecules: [] })).status, "malformed", "v2 must own an explicit h2 field");
for (const separationAngstrom of [0.599, 1.201]) {
  const checkpoint = { ...good("body-b").lastGood, separationAngstrom };
  checkpoint.digest = digestH2RHFCheckpoint(checkpoint);
  const outside = parseMoleculePersistence(JSON.stringify({
    schemaVersion: 2,
    initialized: true,
    nextOrdinal: 2,
    molecules: [molecule("body-b", 2)],
    h2: { ...good("body-b"), lastGood: checkpoint },
  }));
  assert.equal(outside.status, "malformed", `H2 separation ${separationAngstrom} is outside the trusted inclusive envelope`);
}

// Malformed bytes and incomplete v2 envelopes never become missing data.
assert.equal(parseMoleculePersistence("{").status, "malformed");
assert.equal(parseMoleculePersistence(JSON.stringify({ molecules: [{ seed: "11", nx: 0, ny: 0 }] })).status, "malformed");
assert.equal(parseMoleculePersistence(JSON.stringify({ schemaVersion: 2, initialized: true, molecules: [] })).status, "malformed");
assert.equal(parseMoleculePersistence(JSON.stringify({ schemaVersion: 2, initialized: false, nextOrdinal: 0, molecules: [] })).status, "malformed");
assert.equal(parseMoleculePersistence(JSON.stringify({ schemaVersion: 2, initialized: true, nextOrdinal: 1, molecules: [molecule("x", 1)], h2: { bodyId: "x", lastGood: { digest: "orphan" }, model: {} } })).status, "malformed");

// A storage exception is distinct from malformed bytes and missing data.
const readFailStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("must not write"); } };
const readFailure = readMoleculePersistence(readFailStorage, MOLECULE_STORAGE_V1_KEY);
assert.equal(readFailure.status, "read-failed");

// Cap policy: retiring entries never consume the live cap; when there are too
// many live entries, newest append-order records survive deterministically.
const capInput = {
  cap: 2,
  nextOrdinal: 1,
  molecules: [
    molecule("old", 1),
    molecule("retiring", 2, 0.4, 0.4, { retiringAt: 10 }),
    molecule("new-a", 3, 0.5, 0.5),
    molecule("new-b", 4, 0.6, 0.6),
  ],
};
const capped = buildMoleculePersistenceEnvelope(capInput);
assert.deepEqual(capped.molecules.map((item) => item.id), ["new-a", "new-b"]);
assert.equal(capped.nextOrdinal, 4, "ordinal never moves backwards during migration");
assert.deepEqual(buildMoleculePersistenceEnvelope(capInput), capped, "cap and ids are deterministic");

// A generated id cannot steal an occupied id, and collision resolution is
// deterministic even when the caller supplies an occupied/reserved set.
const generated = deriveMoleculeId(7, 0.1, 0.2, 3);
assert.equal(deriveMoleculeId(7, 0.1, 0.2, 3), generated);
assert.equal(deriveMoleculeId(7, 0.1, 0.2, 3, new Set([generated])), `${generated}-2`);
assert.throws(() => deriveMoleculeId(7, 0.1, 0.2, Number.MAX_SAFE_INTEGER + 1), /source ordinal/);
assert.throws(() => buildMoleculePersistenceEnvelope({ molecules: [], cap: Number.MAX_SAFE_INTEGER + 1 }), /cap/);
assert.throws(() => buildMoleculePersistenceEnvelope({ molecules: [], nextOrdinal: Number.MAX_SAFE_INTEGER + 1 }), /nextOrdinal/);
const collisionEnvelope = buildMoleculePersistenceEnvelope({
  molecules: [molecule(generated, 100), molecule(undefined, 7, 0.1, 0.2)],
});
assert.notEqual(collisionEnvelope.molecules[1].id, generated);
assert.equal(new Set(collisionEnvelope.molecules.map((item) => item.id)).size, 2);

// H2 remains attached to the exact body id, not to a duplicate seed.  If that
// body retires, the persisted subsystem state is removed rather than moved.
const duplicateBody = buildMoleculePersistenceEnvelope({
  molecules: [molecule("body-a", 44), molecule("body-b", 44)],
  h2: good("body-b"),
});
assert.equal(duplicateBody.h2.bodyId, "body-b");
assert.equal(duplicateBody.h2.lastGood.targetId, "body-b");
const retiredBody = buildMoleculePersistenceEnvelope({
  molecules: [molecule("body-a", 44), molecule("body-b", 44, 0.3, 0.4, { retiringAt: 99 })],
  h2: good("body-b"),
});
assert.deepEqual(retiredBody.molecules.map((item) => item.id), ["body-a"]);
assert.equal(retiredBody.h2, null);

// Serializer emits only the canonical v2 envelope, and a provisional H2
// snapshot cannot enter storage.
const serialized = serializeMoleculePersistence({
  molecules: [molecule("body-b", 2)],
  nextOrdinal: 2,
  h2: { ...good("body-b"), candidate: { transient: true }, trace: [{ transient: true }] },
});
const serializedObject = JSON.parse(serialized);
assert.equal(serializedObject.schemaVersion, 2);
assert.equal(serializedObject.initialized, true);
assert.deepEqual(Object.keys(serializedObject.h2).sort(), ["bodyId", "lastGood", "model"]);
assert.equal("candidate" in serializedObject.h2, false);
assert.equal("trace" in serializedObject.h2, false);

// v2 is authoritative: a valid v2 plus an old v1 record is returned byte-for-
// byte without a write or a downgrade.
const existingV2 = JSON.stringify({
  schemaVersion: 2,
  initialized: true,
  nextOrdinal: 7,
  molecules: [molecule("v2-body", 77)],
  h2: null,
});
const v2FirstStorage = new MemoryStorage({
  [MOLECULE_STORAGE_V2_KEY]: existingV2,
  [MOLECULE_STORAGE_V1_KEY]: v1,
});
const v2First = migrateMoleculePersistence(v2FirstStorage);
assert.equal(v2First.ok, true);
assert.equal(v2First.source.sourceVersion, 2);
assert.equal(v2First.serialized, existingV2);
assert.equal(v2FirstStorage.writes.length, 0, "valid v2 is not rewritten");

const v1UnderNewKeyStorage = new MemoryStorage({
  [MOLECULE_STORAGE_V2_KEY]: v1,
  [MOLECULE_STORAGE_V1_KEY]: v1,
});
const v1UnderNewKey = migrateMoleculePersistence(v1UnderNewKeyStorage);
assert.equal(v1UnderNewKey.ok, false);
assert.equal(v1UnderNewKey.failure, "malformed", "v2-first success requires sourceVersion 2");
assert.equal(v1UnderNewKey.source.sourceVersion, 1);
assert.equal(v1UnderNewKeyStorage.writes.length, 0);

// A corrupt v2 must never be overwritten by a readable v1.  The old bytes are
// exposed only as rollback material, and no destination write is attempted.
const corruptV2Storage = new MemoryStorage({
  [MOLECULE_STORAGE_V2_KEY]: "{not-json",
  [MOLECULE_STORAGE_V1_KEY]: v1,
});
const corruptV2 = migrateMoleculePersistence(corruptV2Storage);
assert.equal(corruptV2.ok, false);
assert.equal(corruptV2.failure, "malformed");
assert.equal(corruptV2.rollbackRaw, v1);
assert.equal(corruptV2.rollbackSource.sourceVersion, 1);
assert.equal(corruptV2Storage.writes.length, 0);
assert.equal(corruptV2Storage.getItem(MOLECULE_STORAGE_V2_KEY), "{not-json");

// Neither key means no initialization decision may be inferred.  An explicit
// starter state is the only path that may create v2 from an empty device.
const noKeysStorage = new MemoryStorage();
const noKeys = migrateMoleculePersistence(noKeysStorage);
assert.equal(noKeys.ok, false);
assert.equal(noKeys.failure, "state-required");
assert.equal(noKeysStorage.writes.length, 0);
const explicitInit = migrateMoleculePersistence(noKeysStorage, {
  state: { molecules: [molecule("starter", 1)], nextOrdinal: 1 },
});
assert.equal(explicitInit.ok, true);
assert.equal(explicitInit.source.status, "missing");
assert.equal(noKeysStorage.getItem(MOLECULE_STORAGE_V2_KEY), explicitInit.serialized);

const v1WinsStarterStorage = new MemoryStorage({ [MOLECULE_STORAGE_V1_KEY]: v1 });
const v1WinsStarter = migrateMoleculePersistence(v1WinsStarterStorage, {
  state: { molecules: [molecule("starter-must-not-win", 999)], nextOrdinal: 99 },
});
assert.equal(v1WinsStarter.ok, true);
assert.deepEqual(v1WinsStarter.state.molecules.map((item) => item.id), ["stable-a", v1WinsStarter.state.molecules[1].id]);
assert.equal(v1WinsStarter.state.nextOrdinal, 2, "valid v1 owns migration even when starter options are present");

// Successful migration writes v2, reads it back, and leaves v1 untouched.
const successfulStorage = new MemoryStorage({ [MOLECULE_STORAGE_V1_KEY]: v1 });
const success = migrateMoleculePersistence(successfulStorage);
assert.equal(success.ok, true);
assert.equal(success.source.sourceVersion, 1);
assert.equal(success.state.schemaVersion, 2);
assert.equal(successfulStorage.getItem(MOLECULE_STORAGE_V1_KEY), v1, "v1 remains rollback input");
assert.equal(successfulStorage.getItem(MOLECULE_STORAGE_V2_KEY), success.serialized);
assert.deepEqual(JSON.parse(success.serialized), success.state);

// Quota/write failures are explicit and never erase the readable source.
const writeFailStorage = new MemoryStorage({ [MOLECULE_STORAGE_V1_KEY]: v1 });
writeFailStorage.setItem = () => { throw new Error("quota"); };
const writeFailure = migrateMoleculePersistence(writeFailStorage);
assert.equal(writeFailure.ok, false);
assert.equal(writeFailure.failure, "write-failed");
assert.equal(writeFailure.rollbackRaw, v1);
assert.equal(writeFailStorage.getItem(MOLECULE_STORAGE_V1_KEY), v1);

// An interrupted/corrupt readback is not a commit, even though setItem did
// return.  The old bytes remain available for retry/rollback.
const corruptReadbackStorage = new MemoryStorage({ [MOLECULE_STORAGE_V1_KEY]: v1 });
const originalSet = corruptReadbackStorage.setItem.bind(corruptReadbackStorage);
corruptReadbackStorage.setItem = (key, value) => originalSet(key, `${value.slice(0, -1)}x`);
const corruptReadback = migrateMoleculePersistence(corruptReadbackStorage);
assert.equal(corruptReadback.ok, false);
assert.equal(corruptReadback.failure, "readback-failed");
assert.equal(corruptReadback.rollbackRaw, v1);
assert.equal(corruptReadbackStorage.getItem(MOLECULE_STORAGE_V1_KEY), v1);

const readbackFailStorage = new MemoryStorage({ [MOLECULE_STORAGE_V1_KEY]: v1 });
const originalGet = readbackFailStorage.getItem.bind(readbackFailStorage);
const originalReadbackSet = readbackFailStorage.setItem.bind(readbackFailStorage);
let readbackWritten = false;
readbackFailStorage.getItem = (key) => {
  if (key === MOLECULE_STORAGE_V2_KEY && readbackWritten) throw new Error("readback unavailable");
  return originalGet(key);
};
readbackFailStorage.setItem = (key, value) => {
  originalReadbackSet(key, value);
  readbackWritten = true;
};
const readbackFailure = migrateMoleculePersistence(readbackFailStorage);
assert.equal(readbackFailure.ok, false);
assert.equal(readbackFailure.failure, "readback-failed");

// A migration cannot use the rollback key as its destination.
const sameKey = migrateMoleculePersistence(new MemoryStorage({ [MOLECULE_STORAGE_V1_KEY]: v1 }), {
  oldKey: MOLECULE_STORAGE_V1_KEY,
  newKey: MOLECULE_STORAGE_V1_KEY,
});
assert.equal(sameKey.ok, false);
assert.equal(sameKey.failure, "write-failed");

// Malformed source is reported before any destination write.
const malformedStorage = new MemoryStorage({ [MOLECULE_STORAGE_V1_KEY]: "not-json" });
const malformedMigration = migrateMoleculePersistence(malformedStorage);
assert.equal(malformedMigration.ok, false);
assert.equal(malformedMigration.failure, "malformed");
assert.equal(malformedStorage.writes.length, 0);

// A read error at the old key is not a missing migration.
const migrationReadFail = migrateMoleculePersistence({
  getItem() { throw new Error("storage denied"); },
  setItem() { throw new Error("must not write"); },
});
assert.equal(migrationReadFail.ok, false);
assert.equal(migrationReadFail.failure, "read-failed");

const v2ReadFailWithRollback = new MemoryStorage({ [MOLECULE_STORAGE_V1_KEY]: v1 });
v2ReadFailWithRollback.getItem = (key) => {
  if (key === MOLECULE_STORAGE_V2_KEY) throw new Error("v2 read denied");
  return v1;
};
const v2ReadFailure = migrateMoleculePersistence(v2ReadFailWithRollback);
assert.equal(v2ReadFailure.ok, false);
assert.equal(v2ReadFailure.failure, "read-failed");
assert.equal(v2ReadFailure.rollbackRaw, v1);
assert.equal(v2ReadFailWithRollback.writes.length, 0);

assert.equal(DEFAULT_MOLECULE_STORAGE_CAP, 18);
console.log("molecule persistence: ok (missing/empty/populated/malformed/read-write-readback/cap/id/H2 cases)");
