import { describe, expect, test } from "bun:test";

import {
  branchStateAfter,
  mergeTrailEntries,
  normalizeSessionBranches,
} from "../sessionState.ts";
import type { ProjectableTrailEntry } from "../model.ts";

function entry(id: string, recordedAt: number, branchId = "local-main"): ProjectableTrailEntry {
  return {
    id,
    recordedAt,
    scene: "wave",
    branchId,
    parentEventId: null,
    verb: "tap",
    semanticVerb: "material",
    layer: "material",
    source: "touch",
    intensity: 0.5,
    answered: true,
  };
}

describe("session trail state", () => {
  test("merges hydration with an immediate interaction instead of overwriting it", () => {
    const merged = mergeTrailEntries([entry("immediate", 20)], [entry("saved", 10)]);
    expect(merged.map((item) => item.id)).toEqual(["saved", "immediate"]);
  });

  test("deduplicates the same event while merging hydration", () => {
    const merged = mergeTrailEntries([entry("same", 10)], [entry("same", 10)]);
    expect(merged).toHaveLength(1);
  });

  test("derives real branches from persisted records and recorded events", () => {
    const state = normalizeSessionBranches(
      [entry("root", 1), entry("side-event", 2, "side")],
      [{ id: "local-main", parentId: null, retired: false }],
      "side",
    );
    expect(state.activeBranchId).toBe("side");
    expect(state.branches).toEqual([
      { id: "local-main", parentId: null, retired: false },
      { id: "side", parentId: "local-main", retired: false },
    ]);
  });

  test("switches, retires, and restores branches without retiring the inhabited branch", () => {
    const initial = {
      activeBranchId: "local-main",
      branches: [
        { id: "local-main", parentId: null, retired: false },
        { id: "side", parentId: "local-main", retired: false },
      ],
    } as const;

    expect(branchStateAfter(initial, { type: "retire", branchId: "local-main" })).toEqual(initial);
    const switched = branchStateAfter(initial, { type: "switch", branchId: "side" });
    expect(switched.activeBranchId).toBe("side");
    const retired = branchStateAfter(switched, { type: "retire", branchId: "local-main" });
    expect(retired.branches[0]?.retired).toBe(true);
    const restored = branchStateAfter(retired, { type: "restore", branchId: "local-main" });
    expect(restored.branches[0]?.retired).toBe(false);
  });
});
