import { describe, expect, test } from "bun:test";

import {
  branchSummaries,
  projectNaturalHistory,
  retirementTransition,
  type ProjectableTrailEntry,
} from "../model.ts";

function entry(
  id: string,
  recordedAt: number,
  scene: ProjectableTrailEntry["scene"],
  historyKind: ProjectableTrailEntry["historyKind"],
  branchId = "root",
  parentEventId: string | null = null,
): ProjectableTrailEntry {
  return {
    id,
    recordedAt,
    scene,
    historyKind,
    branchId,
    parentEventId,
    verb: "tap",
    semanticVerb: "material",
    layer: "material",
    source: "touch",
    intensity: 0.75,
    answered: true,
  };
}

describe("natural-history projection", () => {
  test("orders events, names causes and consequences, and keeps scene return anchors", () => {
    const projection = projectNaturalHistory([
      entry("division", 30, "cell", "division", "root", "birth"),
      entry("birth", 10, "solar", "birth"),
      entry("collision", 20, "solar", "collision", "root", "birth"),
    ]);

    expect(projection.events.map((event) => event.id)).toEqual(["birth", "collision", "division"]);
    expect(projection.events.map((event) => event.scaleId)).toEqual([
      "solar-formation",
      "solar-formation",
      "cellular-colony",
    ]);
    expect(projection.events.every((event) => event.cause.length > 0)).toBe(true);
    expect(projection.events.every((event) => event.consequence.length > 0)).toBe(true);
    expect(projection.events.every((event) => event.scientificName.length > 0)).toBe(true);
    expect(projection.events[2]?.returnAnchor).toEqual({
      scene: "cell",
      eventId: "division",
      recordedAt: 30,
    });
  });

  test("represents birth, division, merge, collision, discovery, and branch events", () => {
    const kinds = ["birth", "division", "merge", "collision", "discovery", "branch"] as const;
    const projection = projectNaturalHistory(
      kinds.map((kind, index) => entry(kind, index, index % 2 === 0 ? "solar" : "cell", kind)),
    );
    expect(projection.events.map((event) => event.kind)).toEqual(kinds);
  });

  test("bounds a long trail and leaves empty history legible", () => {
    expect(projectNaturalHistory([]).emptyMessage).toContain("first change");

    const long = Array.from({ length: 140 }, (_, index) =>
      entry(`event-${index}`, index, "wave", "intervention"),
    );
    const projection = projectNaturalHistory(long);
    expect(projection.events).toHaveLength(120);
    expect(projection.events[0]?.id).toBe("event-20");
  });

  test("does not turn an unanswered gesture into world history", () => {
    const unanswered = { ...entry("attempt", 1, "wave", "intervention"), answered: false };
    expect(projectNaturalHistory([unanswered]).events).toEqual([]);
  });
});

describe("branch presentation", () => {
  test("shows parentage and a shared ancestor without inventing achievements", () => {
    const events = projectNaturalHistory([
      entry("root-birth", 1, "solar", "birth"),
      entry("left", 2, "cell", "branch", "left", "root-birth"),
      entry("right", 3, "wave", "branch", "right", "root-birth"),
    ]).events;
    const branches = branchSummaries(events, [
      { id: "root", parentId: null, retired: false },
      { id: "left", parentId: "root", retired: false },
      { id: "right", parentId: "root", retired: true },
    ]);

    expect(branches.find((branch) => branch.id === "left")?.parentId).toBe("root");
    expect(branches.find((branch) => branch.id === "right")?.commonAncestorId).toBe("root");
    expect(branches.find((branch) => branch.id === "right")?.retired).toBe(true);
  });

  test("retirement is reversible, current-branch retirement is deferred, and purge is never an action", () => {
    expect(retirementTransition("active", { isCurrent: false, confirmed: true })).toBe("retired");
    expect(retirementTransition("retired", { isCurrent: false, confirmed: true })).toBe("active");
    expect(retirementTransition("active", { isCurrent: true, confirmed: true })).toBe("deferred");
    expect(retirementTransition("active", { isCurrent: false, confirmed: false })).toBe("deferred");
    expect(String(retirementTransition)).not.toContain("purge");
  });
});
