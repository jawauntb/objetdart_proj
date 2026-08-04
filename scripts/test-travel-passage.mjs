/**
 * Every travel edge gets a film — registered trunk or the shared default.
 * Catches the bug where an unregistered edge hard-cut with an ink fade, and
 * pins the richer high-traffic trunk films so they cannot silently fall back.
 */
import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

const { resolvePassageSpec, DEFAULT_PASSAGE, PASSAGES } = loadTsModule(
  "src/lib/travel-passage.ts",
);
const { SCALE_BANDS } = loadTsModule("src/lib/scale.ts");

assert.ok(DEFAULT_PASSAGE.durationMs > 0, "default film has a length");
assert.ok(DEFAULT_PASSAGE.navigateAt > 0 && DEFAULT_PASSAGE.navigateAt < 1);

function band(id) {
  const b = SCALE_BANDS.find((x) => x.id === id);
  assert.ok(b, `band ${id} must exist`);
  return b;
}

// A registered trunk edge keeps its film.
{
  const stars = band("stars");
  const spec = resolvePassageSpec("atlas", stars);
  assert.equal(spec.durationMs, PASSAGES["atlas->stars"].durationMs, "trunk film wins");
  assert.equal(spec.out, true);
}

// High-traffic edges keep their richer films — the bug: a registry key drifts
// and the hop silently falls back to the soft default.
{
  const trunk = [
    ["coast", "olympus", "fogclimb", true],
    ["olympus", "coast", "fogclimb", false],
    ["earth", "flowers", "garden", false],
    ["flowers", "earth", "garden", true],
    ["atlas", "earth", "chartland", true],
    ["earth", "atlas", "chartland", false],
    ["earth", "coast", "strand", false],
    ["coast", "earth", "strand", true],
    ["space", "manifold", "fold", true],
    ["manifold", "space", "fold", false],
  ];
  for (const [from, to, film, out] of trunk) {
    const key = `${from}->${to}`;
    const spec = resolvePassageSpec(from, band(to));
    assert.equal(spec.film, film, `${key} keeps film ${film}`);
    assert.equal(spec.out, out, `${key} direction`);
    assert.equal(spec.durationMs, PASSAGES[key].durationMs, `${key} duration from registry`);
    assert.notEqual(spec.durationMs, DEFAULT_PASSAGE.durationMs, `${key} is not the soft default`);
  }
}

// An unregistered edge still resolves — never null, never silent.
{
  const tissue = band("tissue");
  const out = resolvePassageSpec("cells", tissue);
  assert.equal(out.durationMs, DEFAULT_PASSAGE.durationMs, "fallback film length");
  assert.equal(out.out, true, "cells → tissue is outward (higher s)");
  assert.ok(out.navigateAt === DEFAULT_PASSAGE.navigateAt);
}

console.log("travel-passage ok: every edge resolves a film; trunk keeps its own");
