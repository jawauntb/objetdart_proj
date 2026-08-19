import type { ScaleAddress } from "./scale.ts";

export const UNIVERSE_CONTRACT_VERSION = 1 as const;

/** Monotonic order for replay; it is not wall-clock time. */
export type UniverseLogicalTime = Readonly<{ tick: number; ordinal: number }>;
/** A scene's model-local elapsed time, explicitly attached to its scale address. */
export type DomainTime = Readonly<{ address: ScaleAddress; seconds: number }>;
export type WriterEpoch = Readonly<{ writerId: string; epoch: number }>;
export type UniverseBranch = Readonly<{
  id: string;
  parentId: string | null;
  forkedAt: UniverseLogicalTime | null;
  writerEpoch: WriterEpoch;
}>;
export type UniverseIdentity = Readonly<{
  version: typeof UNIVERSE_CONTRACT_VERSION;
  id: string;
  seed: string;
  modelVersion: string;
  logicalTime: UniverseLogicalTime;
  inhabitedBranchId: string;
}>;
export type Universe = Readonly<{ identity: UniverseIdentity; branches: readonly UniverseBranch[] }>;

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isLogicalTime(value: unknown): value is UniverseLogicalTime {
  if (typeof value !== "object" || value === null) return false;
  const time = value as Record<string, unknown>;
  return Number.isSafeInteger(time.tick) && (time.tick as number) >= 0 && Number.isSafeInteger(time.ordinal) && (time.ordinal as number) >= 0;
}

export function compareLogicalTime(a: UniverseLogicalTime, b: UniverseLogicalTime): number {
  return a.tick === b.tick ? a.ordinal - b.ordinal : a.tick - b.tick;
}

export function nextLogicalTime(time: UniverseLogicalTime): UniverseLogicalTime {
  return { tick: time.tick, ordinal: time.ordinal + 1 };
}

export function nextWriterEpoch(epoch: WriterEpoch): WriterEpoch {
  if (!validId(epoch.writerId) || !Number.isSafeInteger(epoch.epoch) || epoch.epoch < 0) throw new Error("Writer epochs require an id and a non-negative integer.");
  return { writerId: epoch.writerId, epoch: epoch.epoch + 1 };
}

export function isUniverse(value: unknown): value is Universe {
  if (typeof value !== "object" || value === null) return false;
  const universe = value as Record<string, unknown>;
  if (typeof universe.identity !== "object" || universe.identity === null || !Array.isArray(universe.branches)) return false;
  const identity = universe.identity as Record<string, unknown>;
  if (identity.version !== UNIVERSE_CONTRACT_VERSION || !validId(identity.id) || !validId(identity.seed) || !validId(identity.modelVersion) || !validId(identity.inhabitedBranchId) || !isLogicalTime(identity.logicalTime)) return false;
  const branches = new Map<string, Record<string, unknown>>();
  let rootCount = 0;
  for (const candidate of universe.branches) {
    if (typeof candidate !== "object" || candidate === null) return false;
    const branch = candidate as Record<string, unknown>;
    if (!validId(branch.id) || branches.has(branch.id) || (branch.parentId !== null && !validId(branch.parentId)) || typeof branch.writerEpoch !== "object" || branch.writerEpoch === null) return false;
    const epoch = branch.writerEpoch as Record<string, unknown>;
    if (!validId(epoch.writerId) || !Number.isSafeInteger(epoch.epoch) || (epoch.epoch as number) < 0) return false;
    if (branch.parentId === null) {
      rootCount += 1;
      if (branch.forkedAt !== null) return false;
    } else if (!isLogicalTime(branch.forkedAt) || compareLogicalTime(branch.forkedAt, identity.logicalTime as UniverseLogicalTime) > 0) {
      return false;
    }
    branches.set(branch.id, branch);
  }
  if (rootCount !== 1 || !branches.has(identity.inhabitedBranchId)) return false;
  for (const branch of branches.values()) {
    if (branch.parentId === null) continue;
    const parent = branches.get(branch.parentId as string);
    if (!parent) return false;
    if (parent.forkedAt !== null && compareLogicalTime(branch.forkedAt as UniverseLogicalTime, parent.forkedAt as UniverseLogicalTime) < 0) return false;
  }
  for (const branch of branches.values()) {
    const visited = new Set<string>();
    let cursor: Record<string, unknown> | undefined = branch;
    while (cursor) {
      const id = cursor.id as string;
      if (visited.has(id)) return false;
      visited.add(id);
      cursor = cursor.parentId === null ? undefined : branches.get(cursor.parentId as string);
    }
  }
  return true;
}

export function createUniverse(identity: UniverseIdentity, root: UniverseBranch): Universe {
  const universe: Universe = { identity, branches: [root] };
  if (!isUniverse(universe) || root.parentId !== null || root.id !== identity.inhabitedBranchId) throw new Error("A universe starts with its inhabited root branch.");
  return universe;
}
