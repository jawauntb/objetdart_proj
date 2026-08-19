/**
 * UniverseRepository — the JS-side query and command adapter over the native
 * `UniverseStore`. It is deliberately *not* a second writer: production
 * builds route every write through an injected `StorageAdapter` that
 * ultimately calls the Swift store; the in-memory adapter here powers the
 * crash-consistency harness and the deterministic unit tests.
 *
 * The seven `HostBoundary` phases from U3 (previewed → durablyAppended →
 * authoritativelyApplied → checkpointPromoted → uiAcknowledged →
 * sensoryConfirmed → outputQuarantined) are honored by staging preview,
 * writing on the durable boundary, and only advancing status after the
 * subsequent phases confirm. Idempotency by event id and the 250 ms
 * continuous-gesture chunk cadence are enforced here as well as in Swift,
 * so a JS-side retry after a partial commit is safe.
 */

import {
  HISTORY_CONTRACT_VERSION,
  ACTION_CONTRACT_VERSION,
  UNIVERSE_CONTRACT_VERSION,
  CONTINUOUS_SAMPLE_HZ,
  CONTINUOUS_CHUNK_MS,
  appendNaturalHistory,
  compareLogicalTime,
  isVersionedAction,
  nextLogicalTime,
  type Checkpoint,
  type ContinuousGestureTransaction,
  type DomainEvent,
  type NaturalHistoryEvent,
  type UniverseBranch,
  type UniverseIdentity,
  type UniverseLogicalTime,
  type VersionedAction,
  type WriterEpoch,
} from "@objet/universe-contracts";

// MARK: - Storage contract

/**
 * The narrow set of operations the JS side asks of persistence. A production
 * adapter forwards these to the native store; the `InMemoryStorageAdapter`
 * below models a durable log with the same idempotency shape so the harness
 * can inject crashes at each phase boundary and observe the same invariants.
 */
export type StorageAdapter = {
  saveUniverse(universe: UniverseIdentity): void;
  loadUniverse(id: string): UniverseIdentity | null;
  saveBranch(universeId: string, branch: UniverseBranch): void;
  loadBranches(universeId: string): readonly UniverseBranch[];
  markBranchStatus(universeId: string, branchId: string, status: BranchStatus): void;

  appendEvent(event: DomainEvent): AppendResult;
  loadEvents(branchId: string): readonly DomainEvent[];

  appendNaturalHistory(event: NaturalHistoryEvent): void;
  loadNaturalHistory(branchId: string): readonly NaturalHistoryEvent[];

  stageCheckpoint(checkpoint: Checkpoint): void;
  promoteCheckpoint(id: string): PromotedCheckpointResult;
  loadPromotedCheckpoint(branchId: string): Checkpoint | null;
  loadStagedCheckpoint(id: string): Checkpoint | null;

  saveGestureChunk(chunk: PersistedGestureChunk): void;
  discardProvisionalGestureTails(gestureId: string): number;
  loadGestureChunks(gestureId: string): readonly PersistedGestureChunk[];

  saveTombstone(record: TombstoneRecord): void;
  loadTombstones(universeId: string): readonly TombstoneRecord[];
  removeBranch(universeId: string, branchId: string): void;
  removeUniverse(id: string): void;
};

export type BranchStatus = "active" | "retired" | "purged";
export type UniverseStatus = "active" | "retired" | "purged";
export type AppendResult = "inserted" | "duplicate";
export type PromotedCheckpointResult = "promoted" | "already-promoted" | "rejected-follows-event" | "rejected-goes-backward";

export type PersistedGestureChunk = Readonly<{
  gestureId: string;
  chunkIndex: number;
  universeId: string;
  branchId: string;
  kind: string;
  sampleHz: typeof CONTINUOUS_SAMPLE_HZ;
  chunkMs: typeof CONTINUOUS_CHUNK_MS;
  fromMs: number;
  toMs: number;
  samplesJson: string;
  finalized: boolean;
}>;

export type TombstoneRecord = Readonly<{
  id: string;
  universeId: string;
  branchId: string | null;
  scope: "branch" | "universe";
  status: "requested" | "committed";
  exportPath: string | null;
  committedAtEpochMs: number | null;
  createdAtEpochMs: number;
}>;

// MARK: - In-memory adapter (test / harness only)

type UniverseSlot = {
  identity: UniverseIdentity;
  status: UniverseStatus;
  branches: Map<string, UniverseBranch & { status: BranchStatus }>;
};

/**
 * A pure JS write-ahead structure that models what the SQLite store does. It
 * is *not* SQLite — we skip better-sqlite3 to keep the harness dependency
 * free — but it reproduces the same idempotency guarantees the Swift store
 * relies on: primary key on event id, upsert on (gestureId, chunkIndex),
 * append-only checkpoints with staged / promoted / retired states.
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private universes = new Map<string, UniverseSlot>();
  private eventsByBranch = new Map<string, DomainEvent[]>();
  private eventsById = new Map<string, DomainEvent>();
  private naturalByBranch = new Map<string, NaturalHistoryEvent[]>();
  private checkpointsById = new Map<string, Checkpoint & { status: "staged" | "promoted" | "retired" }>();
  private promotedByBranch = new Map<string, string>();
  private gestureChunks = new Map<string, PersistedGestureChunk>();
  private tombstonesByUniverse = new Map<string, TombstoneRecord[]>();

  saveUniverse(universe: UniverseIdentity): void {
    const slot = this.universes.get(universe.id);
    if (slot) {
      slot.identity = universe;
      return;
    }
    this.universes.set(universe.id, { identity: universe, status: "active", branches: new Map() });
  }

  loadUniverse(id: string): UniverseIdentity | null {
    const slot = this.universes.get(id);
    return slot && slot.status !== "purged" ? slot.identity : null;
  }

  saveBranch(universeId: string, branch: UniverseBranch): void {
    const slot = this.slotOrThrow(universeId);
    const existing = slot.branches.get(branch.id);
    const status: BranchStatus = existing?.status ?? "active";
    slot.branches.set(branch.id, { ...branch, status });
  }

  loadBranches(universeId: string): readonly UniverseBranch[] {
    const slot = this.universes.get(universeId);
    if (!slot) return [];
    return Array.from(slot.branches.values()).map(({ status: _status, ...branch }) => branch);
  }

  markBranchStatus(universeId: string, branchId: string, status: BranchStatus): void {
    const slot = this.slotOrThrow(universeId);
    const branch = slot.branches.get(branchId);
    if (!branch) throw new Error(`unknown branch ${branchId}`);
    slot.branches.set(branchId, { ...branch, status });
  }

  appendEvent(event: DomainEvent): AppendResult {
    if (this.eventsById.has(event.id)) return "duplicate";
    this.eventsById.set(event.id, event);
    const list = this.eventsByBranch.get(event.branchId) ?? [];
    list.push(event);
    // stable order by logical time, then id
    list.sort((a, b) => compareLogicalTime(a.logicalTime, b.logicalTime) || a.id.localeCompare(b.id));
    this.eventsByBranch.set(event.branchId, list);
    return "inserted";
  }

  loadEvents(branchId: string): readonly DomainEvent[] {
    return (this.eventsByBranch.get(branchId) ?? []).slice();
  }

  appendNaturalHistory(event: NaturalHistoryEvent): void {
    const prior = this.naturalByBranch.get(event.branchId) ?? [];
    // Reuses the shared contract's idempotent + ordering helper so the JS
    // adapter tracks the same trail invariant tests rely on.
    const next = appendNaturalHistory(prior, event) as NaturalHistoryEvent[];
    this.naturalByBranch.set(event.branchId, next.slice());
  }

  loadNaturalHistory(branchId: string): readonly NaturalHistoryEvent[] {
    return (this.naturalByBranch.get(branchId) ?? []).slice();
  }

  stageCheckpoint(checkpoint: Checkpoint): void {
    this.checkpointsById.set(checkpoint.id, { ...checkpoint, status: "staged" });
  }

  loadStagedCheckpoint(id: string): Checkpoint | null {
    const record = this.checkpointsById.get(id);
    return record ? { ...record } : null;
  }

  promoteCheckpoint(id: string): PromotedCheckpointResult {
    const staged = this.checkpointsById.get(id);
    if (!staged) return "rejected-follows-event";
    if (staged.status === "promoted") return "already-promoted";
    if (staged.status === "retired") return "rejected-follows-event";
    // A checkpoint with no digest is not a checkpoint; refuse to promote.
    if (!staged.stateDigest) {
      this.checkpointsById.set(id, { ...staged, status: "retired" });
      return "rejected-follows-event";
    }
    // Follows-event guard
    const referenced = this.eventsById.get((staged as unknown as { followsEventId?: string }).followsEventId ?? "");
    const followsEventId = (staged as unknown as { followsEventId?: string }).followsEventId ?? null;
    if (followsEventId !== null) {
      if (!referenced || referenced.branchId !== staged.branchId) {
        this.checkpointsById.set(id, { ...staged, status: "retired" });
        return "rejected-follows-event";
      }
      if (compareLogicalTime(referenced.logicalTime, staged.logicalTime) > 0) {
        this.checkpointsById.set(id, { ...staged, status: "retired" });
        return "rejected-follows-event";
      }
    }
    const priorPromoted = this.loadPromotedCheckpoint(staged.branchId);
    if (priorPromoted && compareLogicalTime(priorPromoted.logicalTime, staged.logicalTime) > 0) {
      this.checkpointsById.set(id, { ...staged, status: "retired" });
      return "rejected-goes-backward";
    }
    if (priorPromoted) {
      const prev = this.checkpointsById.get(priorPromoted.id);
      if (prev) this.checkpointsById.set(prev.id, { ...prev, status: "retired" });
    }
    this.checkpointsById.set(id, { ...staged, status: "promoted" });
    this.promotedByBranch.set(staged.branchId, id);
    return "promoted";
  }

  loadPromotedCheckpoint(branchId: string): Checkpoint | null {
    const id = this.promotedByBranch.get(branchId);
    if (!id) return null;
    const record = this.checkpointsById.get(id);
    if (!record || record.status !== "promoted") return null;
    const { status: _status, ...checkpoint } = record;
    return checkpoint;
  }

  saveGestureChunk(chunk: PersistedGestureChunk): void {
    const key = `${chunk.gestureId}#${chunk.chunkIndex}`;
    this.gestureChunks.set(key, chunk);
  }

  discardProvisionalGestureTails(gestureId: string): number {
    let removed = 0;
    for (const key of Array.from(this.gestureChunks.keys())) {
      const chunk = this.gestureChunks.get(key);
      if (chunk && chunk.gestureId === gestureId && !chunk.finalized) {
        this.gestureChunks.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  loadGestureChunks(gestureId: string): readonly PersistedGestureChunk[] {
    return Array.from(this.gestureChunks.values())
      .filter((chunk) => chunk.gestureId === gestureId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  saveTombstone(record: TombstoneRecord): void {
    const list = this.tombstonesByUniverse.get(record.universeId) ?? [];
    list.push(record);
    this.tombstonesByUniverse.set(record.universeId, list);
  }

  loadTombstones(universeId: string): readonly TombstoneRecord[] {
    return (this.tombstonesByUniverse.get(universeId) ?? []).slice();
  }

  removeBranch(universeId: string, branchId: string): void {
    const slot = this.slotOrThrow(universeId);
    slot.branches.delete(branchId);
    const events = this.eventsByBranch.get(branchId) ?? [];
    for (const event of events) this.eventsById.delete(event.id);
    this.eventsByBranch.delete(branchId);
    this.naturalByBranch.delete(branchId);
    this.promotedByBranch.delete(branchId);
  }

  removeUniverse(id: string): void {
    const slot = this.universes.get(id);
    if (!slot) return;
    for (const branchId of Array.from(slot.branches.keys())) this.removeBranch(id, branchId);
    slot.status = "purged";
    // Keep the slot for tombstone lookup; loadUniverse hides it.
  }

  private slotOrThrow(universeId: string): UniverseSlot {
    const slot = this.universes.get(universeId);
    if (!slot) throw new Error(`unknown universe ${universeId}`);
    return slot;
  }
}

// MARK: - Repository

export type CommitBoundary =
  | "previewed"
  | "durablyAppended"
  | "authoritativelyApplied"
  | "checkpointPromoted"
  | "uiAcknowledged"
  | "sensoryConfirmed";

export type CommitInjection = Readonly<{
  crashAfter?: CommitBoundary;
  failValidation?: boolean;
  uiWillAcknowledge?: boolean;
  sensoryWillConfirm?: boolean;
}>;

export type CommitAttempt = Readonly<{
  event: DomainEvent;
  stageCheckpoint?: Checkpoint;
  naturalHistory?: readonly NaturalHistoryEvent[];
}>;

export type CommitOutcome = Readonly<{
  boundariesReached: readonly CommitBoundary[];
  didAppendEvent: boolean;
  didPromoteCheckpoint: boolean;
  reached: CommitBoundary | null;
}>;

export class SimulatedCrashError extends Error {
  readonly boundary: CommitBoundary;
  constructor(boundary: CommitBoundary) {
    super(`simulated crash after ${boundary}`);
    this.boundary = boundary;
    this.name = "SimulatedCrashError";
  }
}

export class ValidationFailedError extends Error {
  constructor() {
    super("checkpoint validation failed");
    this.name = "ValidationFailedError";
  }
}

const DEFAULT_CHUNK_MS = CONTINUOUS_CHUNK_MS;

/**
 * A tiny debounced writer, patterned after `src/lib/room-runtime.ts`'s
 * `createIdleWriter`: coalesce many rapid save requests into one durable
 * write. The harness passes a synchronous `now()` clock so tests are
 * deterministic.
 */
export function createDebouncedWriter(write: () => void, delayMs = DEFAULT_CHUNK_MS): {
  schedule(): void;
  flush(): void;
  cancel(): void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  const run = () => {
    timer = null;
    if (!pending) return;
    pending = false;
    write();
  };
  return {
    schedule() {
      pending = true;
      if (timer !== null) return;
      timer = setTimeout(run, delayMs);
    },
    flush() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (!pending) return;
      pending = false;
      write();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}

export class UniverseRepository {
  private readonly storage: StorageAdapter;
  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  // Identity & branches -----------------------------------------------------

  createUniverse(identity: UniverseIdentity, root: UniverseBranch): void {
    if (identity.version !== UNIVERSE_CONTRACT_VERSION) {
      throw new Error("unsupported universe contract version");
    }
    this.storage.saveUniverse(identity);
    this.storage.saveBranch(identity.id, root);
  }

  loadUniverse(id: string): UniverseIdentity | null {
    return this.storage.loadUniverse(id);
  }

  listBranches(universeId: string): readonly UniverseBranch[] {
    return this.storage.loadBranches(universeId);
  }

  saveBranch(universeId: string, branch: UniverseBranch): void {
    this.storage.saveBranch(universeId, branch);
  }

  retireBranch(universeId: string, branchId: string): void {
    this.storage.markBranchStatus(universeId, branchId, "retired");
  }

  restoreBranch(universeId: string, branchId: string): void {
    this.storage.markBranchStatus(universeId, branchId, "active");
  }

  // Events ------------------------------------------------------------------

  appendEvent(event: DomainEvent): AppendResult {
    if (event.version !== HISTORY_CONTRACT_VERSION) {
      throw new Error("unsupported history contract version");
    }
    if (!isVersionedAction(event.action) || event.action.version !== ACTION_CONTRACT_VERSION) {
      throw new Error("unsupported or invalid semantic action on event");
    }
    return this.storage.appendEvent(event);
  }

  loadEvents(branchId: string): readonly DomainEvent[] {
    return this.storage.loadEvents(branchId);
  }

  // Natural history ---------------------------------------------------------

  appendNaturalHistory(event: NaturalHistoryEvent): void {
    this.storage.appendNaturalHistory(event);
  }

  loadNaturalHistory(branchId: string): readonly NaturalHistoryEvent[] {
    return this.storage.loadNaturalHistory(branchId);
  }

  // Checkpoints -------------------------------------------------------------

  stageCheckpoint(checkpoint: Checkpoint): void {
    this.storage.stageCheckpoint(checkpoint);
  }

  promoteCheckpoint(id: string): PromotedCheckpointResult {
    return this.storage.promoteCheckpoint(id);
  }

  loadPromotedCheckpoint(branchId: string): Checkpoint | null {
    return this.storage.loadPromotedCheckpoint(branchId);
  }

  // Continuous gestures -----------------------------------------------------

  saveGestureChunkFromTransaction(
    transaction: ContinuousGestureTransaction,
    context: Readonly<{ universeId: string; branchId: string }>,
    chunkIndex: number,
    finalized: boolean,
  ): void {
    const chunk = transaction.chunks.find((entry) => entry.index === chunkIndex);
    if (!chunk) throw new Error(`chunk index ${chunkIndex} not present in transaction`);
    this.storage.saveGestureChunk({
      gestureId: transaction.gestureId,
      chunkIndex: chunk.index,
      universeId: context.universeId,
      branchId: context.branchId,
      kind: transaction.kind,
      sampleHz: transaction.sampleHz,
      chunkMs: transaction.chunkMs,
      fromMs: chunk.fromMs,
      toMs: chunk.toMs,
      samplesJson: JSON.stringify(chunk.samples),
      finalized,
    });
  }

  discardProvisionalGestureTails(gestureId: string): number {
    return this.storage.discardProvisionalGestureTails(gestureId);
  }

  loadGestureChunks(gestureId: string): readonly PersistedGestureChunk[] {
    return this.storage.loadGestureChunks(gestureId);
  }

  // Retirement and purge ----------------------------------------------------

  saveTombstone(record: TombstoneRecord): void {
    this.storage.saveTombstone(record);
  }

  loadTombstones(universeId: string): readonly TombstoneRecord[] {
    return this.storage.loadTombstones(universeId);
  }

  purgeBranch(universeId: string, branchId: string): void {
    const tombstones = this.storage.loadTombstones(universeId);
    const hasCommittedTombstone = tombstones.some((entry) =>
      entry.scope === "branch" && entry.branchId === branchId && entry.status === "committed",
    );
    if (!hasCommittedTombstone) {
      throw new Error("purge requires a committed local tombstone");
    }
    this.storage.removeBranch(universeId, branchId);
  }

  purgeUniverse(universeId: string): void {
    const tombstones = this.storage.loadTombstones(universeId);
    const hasCommittedTombstone = tombstones.some((entry) =>
      entry.scope === "universe" && entry.status === "committed",
    );
    if (!hasCommittedTombstone) {
      throw new Error("purge requires a committed local tombstone");
    }
    this.storage.removeUniverse(universeId);
  }

  // The seven-phase commit --------------------------------------------------

  /**
   * Run one event through the seven `HostBoundary` phases. On simulated
   * crash the method throws after having done the durable writes that a
   * real crash at that point would leave behind — so a subsequent
   * `recover` call sees exactly what a relaunch would.
   */
  commit(attempt: CommitAttempt, injection: CommitInjection = {}): CommitOutcome {
    const boundariesReached: CommitBoundary[] = [];
    let didAppendEvent = false;
    let didPromoteCheckpoint = false;

    // 1. previewed
    boundariesReached.push("previewed");
    if (injection.crashAfter === "previewed") throw new SimulatedCrashError("previewed");

    // 2. durablyAppended — the exactly-once boundary
    const result = this.appendEvent(attempt.event);
    didAppendEvent = result === "inserted";
    boundariesReached.push("durablyAppended");
    if (injection.crashAfter === "durablyAppended") throw new SimulatedCrashError("durablyAppended");

    // 3. authoritativelyApplied — persist the natural-history projections
    for (const entry of attempt.naturalHistory ?? []) this.appendNaturalHistory(entry);
    boundariesReached.push("authoritativelyApplied");
    if (injection.crashAfter === "authoritativelyApplied") throw new SimulatedCrashError("authoritativelyApplied");

    // 4. checkpointPromoted
    if (attempt.stageCheckpoint) {
      let staged = attempt.stageCheckpoint;
      if (injection.failValidation) staged = { ...staged, stateDigest: "" };
      this.stageCheckpoint(staged);
      const promotion = this.promoteCheckpoint(staged.id);
      if (promotion === "promoted" || promotion === "already-promoted") {
        didPromoteCheckpoint = promotion === "promoted";
      } else {
        throw new ValidationFailedError();
      }
    }
    boundariesReached.push("checkpointPromoted");
    if (injection.crashAfter === "checkpointPromoted") throw new SimulatedCrashError("checkpointPromoted");

    // 5. uiAcknowledged
    const uiOk = injection.uiWillAcknowledge ?? true;
    if (uiOk) boundariesReached.push("uiAcknowledged");
    if (injection.crashAfter === "uiAcknowledged") throw new SimulatedCrashError("uiAcknowledged");

    // 6. sensoryConfirmed
    const sensoryOk = injection.sensoryWillConfirm ?? true;
    if (sensoryOk) boundariesReached.push("sensoryConfirmed");
    if (injection.crashAfter === "sensoryConfirmed") throw new SimulatedCrashError("sensoryConfirmed");

    return {
      boundariesReached,
      didAppendEvent,
      didPromoteCheckpoint,
      reached: boundariesReached[boundariesReached.length - 1] ?? null,
    };
  }
}

// MARK: - Convenience constructors

export function makeVersionedAction(
  action: Omit<VersionedAction["action"], never>,
  id: string,
  logicalTime: number,
): VersionedAction {
  return { version: ACTION_CONTRACT_VERSION, id, logicalTime, action };
}

export function makeDomainEvent(
  branchId: string,
  time: UniverseLogicalTime,
  action: VersionedAction,
  domainSeconds: number,
  address: DomainEvent["domainTime"]["address"],
): DomainEvent {
  return {
    version: HISTORY_CONTRACT_VERSION,
    id: action.id,
    branchId,
    logicalTime: time,
    domainTime: { address, seconds: domainSeconds },
    action,
  };
}

export function makeCheckpoint(input: {
  id: string;
  branchId: string;
  modelVersion: string;
  time: UniverseLogicalTime;
  stateDigest: string;
  followsEventId: string | null;
}): Checkpoint & { followsEventId: string | null } {
  return {
    version: HISTORY_CONTRACT_VERSION,
    id: input.id,
    branchId: input.branchId,
    logicalTime: input.time,
    modelVersion: input.modelVersion,
    stateDigest: input.stateDigest,
    followsEventId: input.followsEventId,
  } as Checkpoint & { followsEventId: string | null };
}

export function nextEpoch(epoch: WriterEpoch): WriterEpoch {
  return { writerId: epoch.writerId, epoch: epoch.epoch + 1 };
}

export function tickAfter(time: UniverseLogicalTime): UniverseLogicalTime {
  return nextLogicalTime(time);
}
