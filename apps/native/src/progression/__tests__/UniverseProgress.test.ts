import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_UNIVERSE_PROGRESS,
  cycleLens,
  nextLensHint,
  normalizeUniverseProgress,
  recordProgress,
  unlockedLenses,
} from "../UniverseProgressLogic.ts";

const command = (semanticVerb: "material" | "grow" | "ceremony", answered = true) => ({
  verb: "tap" as const,
  semanticVerb,
  layer: "material" as const,
  source: "touch" as const,
  intensity: 1,
  answered,
});

test("progress unlocks the cosmic and genome lenses through answered acts", () => {
  let progress = EMPTY_UNIVERSE_PROGRESS;
  progress = recordProgress(progress, "solar", command("material"));
  progress = recordProgress(progress, "solar", command("material"));
  assert.deepEqual(unlockedLenses(progress, "solar"), [0]);

  progress = recordProgress(progress, "solar", command("material"));
  assert.deepEqual(unlockedLenses(progress, "solar"), [0, 1]);
  progress = recordProgress(progress, "solar", command("ceremony"));
  assert.deepEqual(unlockedLenses(progress, "solar"), [0, 1, 2]);
});

test("growth opens the finest cell register and unexpressed gestures do nothing", () => {
  let progress = EMPTY_UNIVERSE_PROGRESS;
  for (let index = 0; index < 5; index += 1) {
    progress = recordProgress(progress, "cell", command("grow"));
  }
  progress = recordProgress(progress, "cell", command("grow", false));
  assert.deepEqual(unlockedLenses(progress, "cell"), [0, 1, 3]);
  assert.equal(progress.cell.answeredActs, 5);
});

test("lens commands cannot skip keeper locks", () => {
  assert.equal(cycleLens(EMPTY_UNIVERSE_PROGRESS, "solar", 0, 1), 0);
  assert.equal(cycleLens(EMPTY_UNIVERSE_PROGRESS, "wave", 0, -1), 0);
  let progress = EMPTY_UNIVERSE_PROGRESS;
  for (let index = 0; index < 3; index += 1) progress = recordProgress(progress, "solar", command("material"));
  assert.equal(cycleLens(progress, "solar", 0, 1), 1);
  assert.equal(cycleLens(progress, "solar", 1, 1), 0);
  assert.equal(cycleLens(progress, "solar", 0, -1), 0);
});

test("old, malformed, and partial envelopes recover to safe state", () => {
  assert.deepEqual(normalizeUniverseProgress(null), EMPTY_UNIVERSE_PROGRESS);
  assert.deepEqual(normalizeUniverseProgress({ version: 0 }), EMPTY_UNIVERSE_PROGRESS);
  const partial = normalizeUniverseProgress({ version: 1, wave: { answeredActs: 4 }, cell: {}, solar: {} });
  assert.equal(partial.wave.answeredActs, 4);
  assert.equal(partial.wave.growthActs, 0);
  assert.equal(nextLensHint(partial, "solar"), "3 more answered acts open the next register.");
});

test("every keeper threshold and hint is scene-local", () => {
  assert.deepEqual(unlockedLenses(EMPTY_UNIVERSE_PROGRESS, "wave"), [0, 1, 2, 3]);
  assert.equal(nextLensHint(EMPTY_UNIVERSE_PROGRESS, "cell"), "3 more answered acts open the next register.");

  let solar = EMPTY_UNIVERSE_PROGRESS;
  for (let index = 0; index < 3; index += 1) solar = recordProgress(solar, "solar", command("material"));
  assert.equal(nextLensHint(solar, "solar"), "make the scene's solemn act to open the deeper register.");
  solar = recordProgress(solar, "solar", command("ceremony"));
  assert.equal(nextLensHint(solar, "solar"), "keep growing the material to open its finest register.");
  for (let index = 0; index < 5; index += 1) solar = recordProgress(solar, "solar", command("grow"));
  assert.deepEqual(unlockedLenses(solar, "solar"), [0, 1, 2, 3]);
  assert.equal(nextLensHint(solar, "solar"), "all four registers are open — tend the state, then travel through the fold.");

  let answeredOnly = EMPTY_UNIVERSE_PROGRESS;
  for (let index = 0; index < 9; index += 1) answeredOnly = recordProgress(answeredOnly, "solar", command("material"));
  assert.deepEqual(unlockedLenses(answeredOnly, "solar"), [0, 1, 3]);
  assert.deepEqual(unlockedLenses(answeredOnly, "cell"), [0]);
});
