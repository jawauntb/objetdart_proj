import type { BranchRecord } from "./model";

const SESSION_STATE_TRAIL_LIMIT = 120;

export type BranchState = Readonly<{
  branches: readonly BranchRecord[];
  activeBranchId: string;
}>;

export type BranchStateAction = Readonly<{
  type: "switch" | "retire" | "restore";
  branchId: string;
}>;

/** Merge disk hydration with live input by identity, keeping the bounded chronology. */
export function mergeTrailEntries<T extends Readonly<{ id: string; recordedAt: number }>>(
  current: readonly T[],
  hydrated: readonly T[],
): readonly T[] {
  const byId = new Map<string, T>();
  for (const entry of hydrated) byId.set(entry.id, entry);
  for (const entry of current) byId.set(entry.id, entry);
  return Array.from(byId.values())
    .sort((a, b) => a.recordedAt - b.recordedAt || a.id.localeCompare(b.id))
    .slice(-SESSION_STATE_TRAIL_LIMIT);
}

/** Reconcile persisted branch metadata with branches proven by recorded events. */
export function normalizeSessionBranches(
  entries: readonly Readonly<{ branchId?: string }>[],
  records: readonly BranchRecord[],
  requestedActiveBranchId: string,
): BranchState {
  const branches: BranchRecord[] = [];
  const seen = new Set<string>();
  const add = (record: BranchRecord) => {
    if (!record.id || seen.has(record.id)) return;
    seen.add(record.id);
    branches.push(Object.freeze(record));
  };

  for (const record of records) {
    add({
      id: record.id,
      parentId: record.parentId && record.parentId !== record.id ? record.parentId : null,
      retired: Boolean(record.retired),
    });
  }
  if (!seen.has("local-main")) add({ id: "local-main", parentId: null, retired: false });
  for (const entry of entries) {
    const id = entry.branchId?.trim();
    if (id && !seen.has(id)) add({ id, parentId: "local-main", retired: false });
  }

  const requested = branches.find((branch) => branch.id === requestedActiveBranchId && !branch.retired);
  const active = requested ?? branches.find((branch) => !branch.retired) ?? branches[0]!;
  const normalized = branches.map((branch) =>
    branch.id === active.id && branch.retired ? Object.freeze({ ...branch, retired: false }) : branch,
  );
  return Object.freeze({ branches: Object.freeze(normalized), activeBranchId: active.id });
}

/** Apply only valid, reversible local branch transitions. */
export function branchStateAfter(state: BranchState, action: BranchStateAction): BranchState {
  const target = state.branches.find((branch) => branch.id === action.branchId);
  if (!target) return state;

  if (action.type === "switch") {
    if (target.retired || target.id === state.activeBranchId) return state;
    return Object.freeze({ ...state, activeBranchId: target.id });
  }
  if (action.type === "retire") {
    if (target.retired || target.id === state.activeBranchId) return state;
    return Object.freeze({
      ...state,
      branches: Object.freeze(state.branches.map((branch) =>
        branch.id === target.id ? Object.freeze({ ...branch, retired: true }) : branch,
      )),
    });
  }
  if (!target.retired) return state;
  return Object.freeze({
    ...state,
    branches: Object.freeze(state.branches.map((branch) =>
      branch.id === target.id ? Object.freeze({ ...branch, retired: false }) : branch,
    )),
  });
}
