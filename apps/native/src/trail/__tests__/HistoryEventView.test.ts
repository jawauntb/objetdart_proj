import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../HistoryEventView.tsx", import.meta.url), "utf8");

describe("history event checkpoint affordance", () => {
  test("does not present a tappable return action before checkpoints exist", () => {
    expect(source).not.toContain("Pressable");
    expect(source).not.toContain("onPress");
    expect(source).toContain("you cannot return to this moment");
    expect(source).toContain("no restorable checkpoint");
  });
});
