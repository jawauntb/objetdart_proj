import { describe, expect, test } from "bun:test";

import { dismissOverlay, pathForScene } from "../navigation.ts";

describe("overlay navigation", () => {
  test("returns through stack history when the overlay was pushed", () => {
    const calls: string[] = [];
    dismissOverlay({
      canGoBack: () => true,
      back: () => calls.push("back"),
      replace: (path) => calls.push(`replace:${path}`),
    }, "cell");
    expect(calls).toEqual(["back"]);
  });

  test("uses a scene fallback when a deep link has no stack history", () => {
    const calls: string[] = [];
    dismissOverlay({
      canGoBack: () => false,
      back: () => calls.push("back"),
      replace: (path) => calls.push(`replace:${path}`),
    }, "wave");
    expect(calls).toEqual(["replace:/world"]);
    expect(pathForScene("solar")).toBe("/solar");
  });
});
