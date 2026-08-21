import { beforeEach, describe, expect, mock, test } from "bun:test";

const files = new Map<string, string>();
const uri = "memory://objet-universe-trail-v1.json";

mock.module("expo-file-system/legacy", () => ({
  documentDirectory: "memory://",
  cacheDirectory: null,
  getInfoAsync: async (path: string) => ({ exists: files.has(path) }),
  readAsStringAsync: async (path: string) => {
    const value = files.get(path);
    if (value === undefined) throw new Error("missing");
    return value;
  },
  writeAsStringAsync: async (path: string, value: string) => {
    files.set(path, value);
  },
}));

mock.module("@objet/universe-contracts", () => ({
  NATIVE_SCALE_ADDRESSES: {
    "wave-medium": { physical: { label: "Wave medium" } },
    "cellular-colony": { physical: { label: "Cellular colony" } },
    "molecular-bond": { physical: { label: "Molecular bond" } },
    "atomic-shell": { physical: { label: "Atomic shell" } },
    "solar-formation": { physical: { label: "Solar formation" } },
  },
}));

const trail = await import("../SessionTrail.ts");

const command = {
  verb: "holdCeremony" as const,
  semanticVerb: "ceremony" as const,
  layer: "material" as const,
  source: "touch" as const,
  intensity: 0.8,
  answered: true,
};

beforeEach(async () => {
  await trail.loadSessionTrailState();
  files.clear();
});

describe("session trail persistence", () => {
  test("downgrades unproven legacy scientific kinds to an honest intervention", async () => {
    files.set(uri, JSON.stringify({
      version: 2,
      entries: [{
        ...command,
        version: 2,
        id: "legacy-discovery",
        recordedAt: 1,
        scene: "solar",
        historyKind: "discovery",
        branchId: "local-main",
        parentEventId: null,
        cause: "a discovery happened",
        consequence: "knowledge unlocked",
        scientificName: "observation",
      }],
    }));

    const state = await trail.loadSessionTrailState();
    expect(state.entries[0]?.historyKind).toBe("intervention");
    expect(state.entries[0]?.scientificName).toBe("intervention");
  });

  test("serializes rapid appends so neither interaction is lost", async () => {
    const first = trail.makeTrailEntry(command, 1, 10);
    const second = trail.makeTrailEntry(command, 2, 11);
    await Promise.all([trail.appendSessionTrail(first), trail.appendSessionTrail(second)]);
    expect((await trail.loadSessionTrailState()).entries.map((entry) => entry.id)).toEqual([
      "trail-10-1",
      "trail-11-2",
    ]);
  });

  test("persists branch switching, retirement, and restoration", async () => {
    await trail.appendSessionTrail(trail.makeTrailEntry(command, 1, 10));
    await trail.appendSessionTrail(trail.makeTrailEntry(command, 2, 11, {
      branchId: "side",
      parentEventId: "trail-10-1",
      historyKind: "branch",
    }));
    await trail.switchSessionBranch("side");
    await trail.retireSessionBranch("local-main");

    let state = await trail.loadSessionTrailState();
    expect(state.activeBranchId).toBe("side");
    expect(state.branches.find((branch) => branch.id === "local-main")?.retired).toBe(true);

    await trail.restoreSessionBranch("local-main");
    state = await trail.loadSessionTrailState();
    expect(state.branches.find((branch) => branch.id === "local-main")?.retired).toBe(false);
    expect(JSON.parse(files.get(uri) ?? "{}").activeBranchId).toBe("side");
  });
});
