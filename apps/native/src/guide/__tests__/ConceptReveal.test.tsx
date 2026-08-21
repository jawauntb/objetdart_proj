import { describe, expect, test } from "bun:test";

import { GUIDE_ENTRIES_BY_VERB } from "../guideData.ts";
import { conceptRevealFor } from "../conceptAccess.ts";

const tap = GUIDE_ENTRIES_BY_VERB.tap;

describe("concept reveal access", () => {
  test("does not volunteer a concept before it is discovered", () => {
    expect(
      conceptRevealFor(tap, {
        reason: "discovery",
        causedVerbs: [],
      }),
    ).toBeNull();
  });

  test("reveals the canonical guide entry after discovery", () => {
    const reveal = conceptRevealFor(tap, {
      reason: "discovery",
      causedVerbs: ["tap"],
    });
    expect(reveal?.plain).toBe(tap.plain);
    expect(reveal?.notation).toBe(tap.notation);
  });

  test("permits direct seeking and accessibility without pretending discovery", () => {
    expect(conceptRevealFor(tap, { reason: "direct-seeking", causedVerbs: [] })?.reason).toBe(
      "direct-seeking",
    );
    expect(conceptRevealFor(tap, { reason: "accessibility", causedVerbs: [] })?.reason).toBe(
      "accessibility",
    );
  });

  test("rejects unknown access reasons at runtime", () => {
    expect(
      conceptRevealFor(tap, {
        reason: "automatic" as "discovery",
        causedVerbs: ["tap"],
      }),
    ).toBeNull();
  });
});
