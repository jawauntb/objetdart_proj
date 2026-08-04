/**
 * Every travel edge gets a film — registered trunk or the shared default.
 * Catches the bug where an unregistered edge hard-cut with an ink fade.
 */
import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

const { resolvePassageSpec, DEFAULT_PASSAGE, PASSAGES } = loadTsModule(
  "src/lib/travel-passage.ts",
);
const { SCALE_BANDS } = loadTsModule("src/lib/scale.ts");

assert.ok(DEFAULT_PASSAGE.durationMs > 0, "default film has a length");
assert.ok(DEFAULT_PASSAGE.navigateAt > 0 && DEFAULT_PASSAGE.navigateAt < 1);

// A registered trunk edge keeps its film.
{
  const stars = SCALE_BANDS.find((b) => b.id === "stars");
  const spec = resolvePassageSpec("atlas", stars);
  assert.equal(spec.durationMs, PASSAGES["atlas->stars"].durationMs, "trunk film wins");
  assert.equal(spec.out, true);
}

// An unregistered edge still resolves — never null, never silent.
{
  const earth = SCALE_BANDS.find((b) => b.id === "earth");
  const flowers = SCALE_BANDS.find((b) => b.id === "flowers");
  const out = resolvePassageSpec("earth", flowers);
  const back = resolvePassageSpec("flowers", earth);
  assert.equal(out.durationMs, DEFAULT_PASSAGE.durationMs, "fallback film length");
  assert.equal(out.out, false, "earth → flowers is inward (lower s)");
  assert.equal(back.out, true, "flowers → earth is outward (higher s)");
  assert.ok(out.navigateAt === DEFAULT_PASSAGE.navigateAt);
}

console.log("travel-passage ok: every edge resolves a film; trunk keeps its own");
