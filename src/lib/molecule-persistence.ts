/**
 * The storage law for the molecule room.
 *
 * This module imports only the renderer-free H₂ authority contract and digest.
 * It owns the shape and recoverable migration of the molecule population, but
 * knows nothing about canvas, gestures, or clocks.  A molecule's identity is
 * its persisted id; a seed is only the deterministic material which grows
 * behind that identity.
 */

import {
  H2_RHF_CASSETTE,
  H2_RHF_MODEL_TUPLE,
  digestH2RHFCheckpoint,
  type H2RHFCheckpoint,
} from "./h2-rhf.ts";

export const MOLECULE_STORAGE_V1_KEY = "objetdart:molecules:v1" as const;
export const MOLECULE_STORAGE_V2_KEY = "objetdart:molecules:v2" as const;
export const MOLECULE_STORAGE_SCHEMA_VERSION = 2 as const;
export const DEFAULT_MOLECULE_STORAGE_CAP = 18 as const;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonRecord = { readonly [key: string]: JsonValue };

/** The only molecule fields allowed to cross the storage boundary. */
export type PersistedMolecule = {
  readonly id: string;
  readonly seed: number;
  readonly nx: number;
  readonly ny: number;
};

/** The exact model identity allowed to resume a persisted H₂ checkpoint. */
export type MoleculeH2Model = {
  readonly model: string;
  readonly modelVersion: string;
  readonly cassetteHash: string;
  readonly quantizationVersion: string;
  readonly traceVersion: number;
};

export const H2_RHF_PERSISTENCE_MODEL: MoleculeH2Model = Object.freeze({
  model: H2_RHF_MODEL_TUPLE.model,
  modelVersion: H2_RHF_MODEL_TUPLE.modelVersion,
  cassetteHash: H2_RHF_CASSETTE.payloadSha256,
  quantizationVersion: H2_RHF_MODEL_TUPLE.quantizationVersion,
  traceVersion: H2_RHF_MODEL_TUPLE.traceVersion,
});

/**
 * The authority owns the checkpoint implementation; this boundary admits the
 * same seven fields and nothing else.  Candidate/trace state is not storage.
 */
export type MoleculeH2LastGood = Pick<
  H2RHFCheckpoint,
  "targetId" | "separationAngstrom" | "density" | "energy" | "electronCount" | "promotionGeneration" | "digest"
>;

export type MoleculeH2State = {
  readonly bodyId: string;
  readonly model: MoleculeH2Model;
  readonly lastGood: MoleculeH2LastGood;
};

export type MoleculeInput = {
  readonly id?: string | null;
  readonly seed: number;
  readonly nx: number;
  readonly ny: number;
  /** Optional in-memory liveness markers; never serialized. */
  readonly alive?: boolean;
  readonly retiringAt?: number | null;
};

export type MoleculePersistenceInput = {
  readonly molecules: readonly MoleculeInput[];
  readonly nextOrdinal?: number;
  readonly h2?: MoleculeH2StateInput | null;
  readonly cap?: number;
};

export type MoleculeH2StateInput = {
  readonly bodyId: string;
  readonly model: MoleculeH2Model | JsonRecord;
  readonly lastGood?: MoleculeH2LastGood | null;
  /**
   * These fields are accepted on an in-memory candidate snapshot so callers
   * can hand the whole authority snapshot to the serializer.  They are never
   * copied to the envelope.
   */
  readonly candidate?: JsonValue;
  readonly movingCandidate?: JsonValue;
  readonly frozenCandidate?: JsonValue;
  readonly trace?: JsonValue;
  readonly milestones?: JsonValue;
  readonly provisional?: JsonValue;
  readonly [key: string]: JsonValue | undefined;
};

export type MoleculePersistenceEnvelope = {
  readonly schemaVersion: 2;
  readonly initialized: true;
  readonly nextOrdinal: number;
  readonly molecules: readonly PersistedMolecule[];
  readonly h2: MoleculeH2State | null;
};

export type MoleculeLoadStatus =
  | "missing"
  | "valid-empty"
  | "valid-populated"
  | "malformed"
  | "read-failed";

export type MoleculeLoadResult =
  | { readonly status: "missing" }
  | {
      readonly status: "valid-empty" | "valid-populated";
      readonly sourceVersion: 1 | 2;
      readonly state: MoleculePersistenceEnvelope;
    }
  | { readonly status: "malformed"; readonly reason: string }
  | { readonly status: "read-failed"; readonly error: unknown };

export interface MoleculeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type MoleculeMigrationFailure =
  | "read-failed"
  | "malformed"
  | "write-failed"
  | "readback-failed"
  | "state-required";

export type MoleculeMigrationResult =
  | {
      readonly ok: true;
      readonly source: MoleculeLoadResult;
      readonly state: MoleculePersistenceEnvelope;
      readonly serialized: string;
      readonly oldKey: string;
      readonly newKey: string;
    }
  | {
      readonly ok: false;
      readonly failure: MoleculeMigrationFailure;
      readonly source: MoleculeLoadResult;
      readonly oldKey: string;
      readonly newKey: string;
      readonly error?: unknown;
      /** The v1 bytes remain available as rollback input. */
      readonly rollbackRaw: string | null;
      /** The other key's read result, when v2-first loading needed it. */
      readonly rollbackSource?: MoleculeLoadResult;
    };

export type MoleculeMigrationOptions = {
  readonly oldKey?: string;
  readonly newKey?: string;
  readonly state?: MoleculePersistenceInput;
  readonly cap?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function validCap(cap: unknown): number {
  if (cap === undefined) return DEFAULT_MOLECULE_STORAGE_CAP;
  if (!isSafeNonNegativeInteger(cap)) throw new Error("molecule cap must be a non-negative safe integer");
  return cap;
}

function validNextOrdinal(nextOrdinal: unknown, fallback: number): number {
  if (nextOrdinal === undefined) return fallback;
  if (!isSafeNonNegativeInteger(nextOrdinal)) {
    throw new Error("nextOrdinal must be a non-negative safe integer");
  }
  return Math.max(nextOrdinal, fallback);
}

/** A small stable hash; persistence must not depend on a random source. */
function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function numberKey(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toPrecision(15);
}

/**
 * Derive a stable id for a legacy record which has no usable id (or whose id
 * is already occupied).  The source ordinal disambiguates equal seeds while
 * the occupied set makes the result collision-free.
 */
export function deriveMoleculeId(
  seed: number,
  nx: number,
  ny: number,
  sourceOrdinal: number,
  occupied: ReadonlySet<string> = new Set(),
  reserved: ReadonlySet<string> = new Set(),
): string {
  if (!isSafeNonNegativeInteger(sourceOrdinal)) {
    throw new Error("source ordinal must be a non-negative safe integer");
  }
  const base = `mo-${hashText(`${numberKey(seed)}|${numberKey(nx)}|${numberKey(ny)}|${sourceOrdinal}`).toString(36)}`;
  let candidate = base;
  let suffix = 2;
  while (occupied.has(candidate) || reserved.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function isAlive(input: MoleculeInput): boolean {
  if (input.alive === false) return false;
  if (typeof input.retiringAt === "number" && input.retiringAt > 0) return false;
  return true;
}

function validateMoleculeInput(input: unknown, index: number): asserts input is MoleculeInput {
  if (!isRecord(input)) throw new Error(`molecules[${index}] is not an object`);
  if (!isFiniteNumber(input.seed) || !isFiniteNumber(input.nx) || !isFiniteNumber(input.ny)) {
    throw new Error(`molecules[${index}] has non-finite coordinates or seed`);
  }
  if (input.id !== undefined && input.id !== null && typeof input.id !== "string") {
    throw new Error(`molecules[${index}].id is not a string`);
  }
  if (input.alive !== undefined && typeof input.alive !== "boolean") {
    throw new Error(`molecules[${index}].alive is not boolean`);
  }
  if (input.retiringAt !== undefined && input.retiringAt !== null && !isFiniteNumber(input.retiringAt)) {
    throw new Error(`molecules[${index}].retiringAt is not finite`);
  }
}

function normalizedMolecules(input: readonly MoleculeInput[], cap: number): PersistedMolecule[] {
  const active = input
    .map((entry, sourceOrdinal) => ({ entry, sourceOrdinal }))
    .filter(({ entry }) => isAlive(entry));
  // Array order is the room's append order.  Retiring objects are gone, and
  // the newest live records survive a cap without a clock or random tie-break.
  const retained = active.length > cap ? active.slice(active.length - cap) : active;

  // Reserve every usable id before deriving legacy ids.  Otherwise a missing
  // record could steal the stable id of a later record whose seed happens to
  // hash to the same text.
  const reserved = new Set<string>();
  for (const { entry } of retained) if (typeof entry.id === "string" && entry.id.length > 0) reserved.add(entry.id);

  const occupied = new Set<string>();
  const out: PersistedMolecule[] = [];
  for (const { entry, sourceOrdinal } of retained) {
    const requested = typeof entry.id === "string" && entry.id.length > 0 ? entry.id : null;
    let id = requested;
    if (!id || occupied.has(id)) {
      id = deriveMoleculeId(entry.seed, entry.nx, entry.ny, sourceOrdinal, occupied, reserved);
    }
    occupied.add(id);
    out.push({ id, seed: entry.seed, nx: entry.nx, ny: entry.ny });
  }
  return out;
}

function sanitizeH2Model(value: unknown): MoleculeH2Model {
  if (!isRecord(value)) throw new Error("h2.model is not an object");
  const expectedKeys = Object.keys(H2_RHF_PERSISTENCE_MODEL).sort();
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("h2.model tuple keys are not exact");
  }
  for (const key of expectedKeys) {
    if (!isJsonValue(value[key])) throw new Error(`h2.model.${key} is not JSON-safe`);
  }
  if (
    typeof value.model !== "string" ||
    typeof value.modelVersion !== "string" ||
    typeof value.cassetteHash !== "string" ||
    typeof value.quantizationVersion !== "string" ||
    typeof value.traceVersion !== "number"
  ) {
    throw new Error("h2.model tuple contains a value of the wrong type");
  }
  const candidate: MoleculeH2Model = {
    model: value.model,
    modelVersion: value.modelVersion,
    cassetteHash: value.cassetteHash,
    quantizationVersion: value.quantizationVersion,
    traceVersion: value.traceVersion,
  };
  if (
    !sameJson(candidate, H2_RHF_PERSISTENCE_MODEL)
  ) {
    throw new Error("h2.model tuple does not match the trusted authority");
  }
  return candidate;
}

function sanitizeLastGood(value: unknown, bodyId: string): MoleculeH2LastGood {
  if (!isRecord(value)) throw new Error("h2.lastGood is not an object");
  const expectedKeys = [
    "density",
    "digest",
    "electronCount",
    "energy",
    "promotionGeneration",
    "separationAngstrom",
    "targetId",
  ];
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpected.length || actualKeys.some((key, index) => key !== sortedExpected[index])) {
    throw new Error("h2.lastGood checkpoint keys are not allowlisted");
  }
  if (value.targetId !== bodyId || typeof value.targetId !== "string") {
    throw new Error("h2.lastGood.targetId does not match h2.bodyId");
  }
  if (!isFiniteNumber(value.separationAngstrom) || !isFiniteNumber(value.energy) || !isFiniteNumber(value.electronCount)) {
    throw new Error("h2.lastGood contains a non-finite number");
  }
  if (
    value.separationAngstrom < H2_RHF_MODEL_TUPLE.envelope.minAngstrom ||
    value.separationAngstrom > H2_RHF_MODEL_TUPLE.envelope.maxAngstrom
  ) {
    throw new Error("h2.lastGood.separationAngstrom is outside the trusted envelope");
  }
  if (!isSafeNonNegativeInteger(value.promotionGeneration)) {
    throw new Error("h2.lastGood.promotionGeneration is not a safe integer");
  }
  if (
    !Array.isArray(value.density) ||
    value.density.length !== 4 ||
    !value.density.every((entry) => isFiniteNumber(entry))
  ) {
    throw new Error("h2.lastGood.density must contain four finite numbers");
  }
  if (typeof value.digest !== "string" || value.digest.length === 0) throw new Error("h2.lastGood.digest is missing");
  const checkpoint = {
    targetId: value.targetId,
    separationAngstrom: value.separationAngstrom,
    density: value.density,
    energy: value.energy,
    electronCount: value.electronCount,
    promotionGeneration: value.promotionGeneration,
  };
  if (value.digest !== digestH2RHFCheckpoint(checkpoint)) {
    throw new Error("h2.lastGood.digest does not match the checkpoint");
  }
  return { ...checkpoint, digest: value.digest };
}

function sanitizeH2(value: MoleculeH2StateInput | null | undefined, moleculeIds: ReadonlySet<string>): MoleculeH2State | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new Error("h2 state is not an object");
  if (typeof value.bodyId !== "string" || value.bodyId.length === 0) throw new Error("h2.bodyId is missing");
  if (!moleculeIds.has(value.bodyId)) return null;
  if (value.lastGood == null) return null;
  const model = sanitizeH2Model(value.model);
  const lastGood = sanitizeLastGood(value.lastGood, value.bodyId);
  return { bodyId: value.bodyId, model, lastGood };
}

/** Build a canonical v2 envelope from a live or legacy-compatible state. */
export function buildMoleculePersistenceEnvelope(input: MoleculePersistenceInput): MoleculePersistenceEnvelope {
  if (!isRecord(input) || !Array.isArray(input.molecules)) throw new Error("molecules must be an array");
  input.molecules.forEach((entry, index) => validateMoleculeInput(entry, index));
  const cap = validCap(input.cap);
  const molecules = normalizedMolecules(input.molecules, cap);
  const nextOrdinal = validNextOrdinal(input.nextOrdinal, input.molecules.length);
  const ids = new Set(molecules.map((molecule) => molecule.id));
  const h2 = sanitizeH2(input.h2, ids);
  return {
    schemaVersion: MOLECULE_STORAGE_SCHEMA_VERSION,
    initialized: true,
    nextOrdinal,
    molecules,
    h2,
  };
}

export function serializeMoleculePersistence(input: MoleculePersistenceInput | MoleculePersistenceEnvelope): string {
  const envelope = buildMoleculePersistenceEnvelope(input);
  return JSON.stringify(envelope);
}

function sourceStatus(state: MoleculePersistenceEnvelope): "valid-empty" | "valid-populated" {
  return state.molecules.length === 0 ? "valid-empty" : "valid-populated";
}

function malformed(reason: string): MoleculeLoadResult {
  return { status: "malformed", reason };
}

function parseObject(value: unknown): MoleculeLoadResult {
  if (!isRecord(value)) return malformed("record must be an object");

  const hasV2Marker = value.schemaVersion !== undefined || value.initialized !== undefined || value.nextOrdinal !== undefined || value.h2 !== undefined;
  if (!hasV2Marker && Array.isArray(value.molecules)) {
    try {
      const state = buildMoleculePersistenceEnvelope({ molecules: value.molecules as MoleculeInput[] });
      return { status: sourceStatus(state), sourceVersion: 1, state };
    } catch (error) {
      return malformed(error instanceof Error ? error.message : "invalid v1 molecule record");
    }
  }

  if (value.schemaVersion !== MOLECULE_STORAGE_SCHEMA_VERSION) return malformed("unsupported schemaVersion");
  if (value.initialized !== true) return malformed("v2 initialized marker is not true");
  if (!Array.isArray(value.molecules)) return malformed("v2 molecules is not an array");
  if (!Object.prototype.hasOwnProperty.call(value, "h2")) return malformed("v2 h2 field is missing");
  if (!isSafeNonNegativeInteger(value.nextOrdinal)) {
    return malformed("v2 nextOrdinal is not a non-negative safe integer");
  }
  try {
    const state = buildMoleculePersistenceEnvelope({
      molecules: value.molecules as MoleculeInput[],
      nextOrdinal: value.nextOrdinal as number | undefined,
      h2: value.h2 as MoleculeH2StateInput | null | undefined,
    });
    return { status: sourceStatus(state), sourceVersion: 2, state };
  } catch (error) {
    return malformed(error instanceof Error ? error.message : "invalid v2 molecule record");
  }
}

/** Parse storage bytes without conflating absent data and broken data. */
export function parseMoleculePersistence(raw: string | null | undefined | unknown): MoleculeLoadResult {
  if (raw === null || raw === undefined) return { status: "missing" };
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return malformed("storage bytes are not valid JSON");
    }
  }
  return parseObject(value);
}

/** Read one key and preserve a storage exception as read-failed. */
export function readMoleculePersistence(storage: MoleculeStorage, key = MOLECULE_STORAGE_V2_KEY): MoleculeLoadResult {
  try {
    return parseMoleculePersistence(storage.getItem(key));
  } catch (error) {
    return { status: "read-failed", error };
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => sameJson(entry, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length || !ak.every((key) => Object.prototype.hasOwnProperty.call(b, key))) return false;
  return ak.every((key) => sameJson(a[key], b[key]));
}

function readKey(storage: MoleculeStorage, key: string): { readonly raw: string | null; readonly result: MoleculeLoadResult } {
  try {
    const raw = storage.getItem(key);
    return { raw, result: parseMoleculePersistence(raw) };
  } catch (error) {
    return { raw: null, result: { status: "read-failed", error } };
  }
}

/**
 * Write one canonical v2 envelope and require an exact readback.  The source
 * key is never removed or written, so a failed migration always leaves its
 * rollback bytes available.
 */
function writeAndValidateV2(
  storage: MoleculeStorage,
  source: MoleculeLoadResult,
  state: MoleculePersistenceEnvelope,
  oldKey: string,
  newKey: string,
  rollbackRaw: string | null,
  rollbackSource?: MoleculeLoadResult,
): MoleculeMigrationResult {
  const serialized = JSON.stringify(state);
  try {
    storage.setItem(newKey, serialized);
  } catch (error) {
    return { ok: false, failure: "write-failed", source, oldKey, newKey, error, rollbackRaw, rollbackSource };
  }

  let readbackRaw: string | null;
  try {
    readbackRaw = storage.getItem(newKey);
  } catch (error) {
    return { ok: false, failure: "readback-failed", source, oldKey, newKey, error, rollbackRaw, rollbackSource };
  }
  if (readbackRaw !== serialized) {
    return {
      ok: false,
      failure: "readback-failed",
      source,
      oldKey,
      newKey,
      error: new Error("v2 readback bytes differ from the written envelope"),
      rollbackRaw,
      rollbackSource,
    };
  }
  const readback = parseMoleculePersistence(readbackRaw);
  if (
    (readback.status !== "valid-empty" && readback.status !== "valid-populated") ||
    !sameJson(readback.state, state)
  ) {
    return {
      ok: false,
      failure: "readback-failed",
      source,
      oldKey,
      newKey,
      error: new Error("v2 readback envelope failed exact validation"),
      rollbackRaw,
      rollbackSource,
    };
  }
  return { ok: true, source, state, serialized, oldKey, newKey };
}

/**
 * Migrate v1 into v2 transactionally, with v2 as the authoritative first
 * read.  A valid v2 record is returned untouched; malformed or unreadable v2
 * is never overwritten.  If neither key exists, callers must explicitly pass
 * a starter state so an absent record cannot accidentally become an empty
 * initialized beaker.
 */
export function migrateMoleculePersistence(
  storage: MoleculeStorage,
  options: MoleculeMigrationOptions = {},
): MoleculeMigrationResult {
  const oldKey = options.oldKey ?? MOLECULE_STORAGE_V1_KEY;
  const newKey = options.newKey ?? MOLECULE_STORAGE_V2_KEY;
  if (oldKey === newKey) {
    const sameKey = readKey(storage, newKey);
    const error = new Error("migration destination must differ from rollback source");
    return {
      ok: false,
      failure: "write-failed",
      source: sameKey.result,
      oldKey,
      newKey,
      error,
      rollbackRaw: sameKey.raw,
    };
  }

  const v2 = readKey(storage, newKey);
  if (
    (v2.result.status === "valid-empty" || v2.result.status === "valid-populated") &&
    v2.result.sourceVersion === 2
  ) {
    // Do not rewrite even if the bytes are pretty-printed or v1 also exists.
    return { ok: true, source: v2.result, state: v2.result.state, serialized: v2.raw as string, oldKey, newKey };
  }
  if (
    v2.result.status === "malformed" ||
    v2.result.status === "read-failed" ||
    ((v2.result.status === "valid-empty" || v2.result.status === "valid-populated") && v2.result.sourceVersion === 1)
  ) {
    // Read v1 only to expose rollback material.  Its contents cannot authorize
    // overwriting a broken v2 destination.
    const rollback = readKey(storage, oldKey);
    return {
      ok: false,
      failure: v2.result.status === "read-failed" ? "read-failed" : "malformed",
      source: v2.result,
      oldKey,
      newKey,
      error:
        v2.result.status === "read-failed"
          ? v2.result.error
          : new Error(v2.result.status === "malformed" ? v2.result.reason : "v1-shaped payload cannot authorize v2"),
      rollbackRaw: rollback.raw,
      rollbackSource: rollback.result,
    };
  }

  // v2 is genuinely absent.  Only now is v1 eligible for migration.
  const v1 = readKey(storage, oldKey);
  if (v1.result.status === "malformed" || v1.result.status === "read-failed") {
    return {
      ok: false,
      failure: v1.result.status === "read-failed" ? "read-failed" : "malformed",
      source: v1.result,
      oldKey,
      newKey,
      error: v1.result.status === "read-failed" ? v1.result.error : new Error(v1.result.reason),
      rollbackRaw: v1.raw,
      rollbackSource: v2.result,
    };
  }
  if (v1.result.status === "missing" && options.state === undefined) {
    return {
      ok: false,
      failure: "state-required",
      source: v1.result,
      oldKey,
      newKey,
      error: new Error("both molecule storage keys are missing; explicit starter state required"),
      rollbackRaw: v1.raw,
      rollbackSource: v2.result,
    };
  }

  let state: MoleculePersistenceEnvelope;
  try {
    const input = v1.result.status === "missing" ? options.state ?? { molecules: [] } : v1.result.state;
    const inputCap = "cap" in input ? input.cap : undefined;
    state = buildMoleculePersistenceEnvelope({ ...input, cap: options.cap ?? inputCap });
  } catch (error) {
    return { ok: false, failure: "malformed", source: v1.result, oldKey, newKey, error, rollbackRaw: v1.raw, rollbackSource: v2.result };
  }
  return writeAndValidateV2(storage, v1.result, state, oldKey, newKey, v1.raw, v2.result);
}

// Descriptive aliases keep the boundary easy to discover for callers which
// think in terms of “stored” records or a transaction rather than a migration.
export const parseStoredMolecules = parseMoleculePersistence;
export const createMoleculeEnvelope = buildMoleculePersistenceEnvelope;
export const serializeStoredMolecules = serializeMoleculePersistence;
export const migrateStoredMolecules = migrateMoleculePersistence;
export const transactMoleculePersistence = migrateMoleculePersistence;
