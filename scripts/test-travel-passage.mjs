/**
 * Every travel edge gets a film — registered trunk or the shared default.
 * Catches the bug where an unregistered edge hard-cut with an ink fade, pins
 * the richer films (astronomical trunk, small-scale spine, the living
 * middle) so they cannot silently fall back to the default planet, and — for
 * every film the test realm can build — checks the law a film cannot break
 * without anyone noticing until the return leg looks wrong: pure function of
 * u and a seed, no wall-clock, no Math.random, and identical output across
 * repeated / re-ordered calls (the mechanism that makes the backward replay
 * land on the outbound frames).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
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

// The small-scale spine, quanta → drop — the edges that used to be a bare
// 2400ms breath with no imagery at all. Every one of the ten trunk edges,
// both directions, must resolve to its own film and never the default.
{
  const spine = [
    ["quanta", "quarks", "quantum", true],
    ["quarks", "quanta", "quantum", false],
    ["quarks", "nucleons", "confine", true],
    ["nucleons", "quarks", "confine", false],
    ["nucleons", "atoms", "shell", true],
    ["atoms", "nucleons", "shell", false],
    ["atoms", "molecules", "bond", true],
    ["molecules", "atoms", "bond", false],
    ["molecules", "organics", "chain", true],
    ["organics", "molecules", "chain", false],
    ["organics", "dna", "helix", true],
    ["dna", "organics", "helix", false],
    ["dna", "organelles", "chromatin", true],
    ["organelles", "dna", "chromatin", false],
    ["organelles", "cells", "membrane", true],
    ["cells", "organelles", "membrane", false],
    ["cells", "tissue", "sheet", true],
    ["tissue", "cells", "sheet", false],
    ["tissue", "drop", "dissolve", true],
    ["drop", "tissue", "dissolve", false],
  ];
  for (const [from, to, film, out] of spine) {
    const key = `${from}->${to}`;
    const spec = resolvePassageSpec(from, band(to));
    assert.equal(spec.film, film, `${key} keeps film ${film}`);
    assert.equal(spec.out, out, `${key} direction`);
    assert.equal(spec.durationMs, PASSAGES[key].durationMs, `${key} duration from registry`);
    assert.notEqual(spec.durationMs, DEFAULT_PASSAGE.durationMs, `${key} is not the soft default`);
    // The small-scale spine is authored to run quicker than the
    // astronomical trunk — catches a film accidentally inheriting a 3.2s+
    // astronomical rhythm instead of its own.
    assert.ok(spec.durationMs <= 2600, `${key} is quicker than the astronomical trunk`);
  }
}

// The bottom of the axis: quanta ↔ plank walks the thirteen empty decades
// on the small-scale spine's budget, and plank ↔ manifold is the ouroboros —
// the wrap TRAVEL_OVERRIDES declares (the plank's floor opens onto the
// manifold). The ouroboros pair deliberately inverts metric-mid ordering:
// `out` follows the HAND, not the mids. plank->manifold presses DOWN through
// the floor (out:false) even though the manifold's mid sits 60 decades above
// the plank's, because playTravelPassage picks the departure wall from `out`
// (sFrom = out ? sMax : sMin) and the register glide must leave through the
// floor going down, the ceiling coming back. A "fix" that re-derives these
// two from band mids breaks the glide's wall, and this block.
{
  const bottom = [
    ["quanta", "plank", "loom", false],
    ["plank", "quanta", "loom", true],
    ["plank", "manifold", "ouroboros", false],
    ["manifold", "plank", "ouroboros", true],
  ];
  for (const [from, to, film, out] of bottom) {
    const key = `${from}->${to}`;
    const spec = resolvePassageSpec(from, band(to));
    assert.equal(spec.film, film, `${key} keeps film ${film}`);
    assert.equal(spec.out, out, `${key} direction follows the hand`);
    assert.equal(spec.durationMs, PASSAGES[key].durationMs, `${key} duration from registry`);
    assert.notEqual(spec.durationMs, DEFAULT_PASSAGE.durationMs, `${key} is not the soft default`);
    assert.ok(spec.durationMs <= 2600, `${key} stays on the small-scale spine's budget`);
  }
}

// The living middle and the top of the axis — the edges a hand actually
// walks between the two trunks, which resolved to the default planet until
// they were filmed. Same bug guarded as above: a key drifts, the hop goes
// quietly back to the turning globe on the busiest doors in the album.
{
  const middle = [
    ["atlas", "stars", "starchart", true],
    ["stars", "atlas", "starchart", false],
    ["tissue", "flowers", "lamina", true],
    ["flowers", "tissue", "lamina", false],
    ["drop", "coast", "tension", true],
    ["coast", "drop", "tension", false],
    ["drop", "flowers", "dew", true],
    ["flowers", "drop", "dew", false],
    ["flowers", "birds", "lift", true],
    ["birds", "flowers", "lift", false],
    ["birds", "coast", "shorewing", true],
    ["coast", "birds", "shorewing", false],
    ["olympus", "earth", "massif", true],
    ["earth", "olympus", "massif", false],
    ["space", "beyond", "interfere", true],
    ["beyond", "space", "interfere", false],
    ["beyond", "manifold", "curvature", true],
    ["manifold", "beyond", "curvature", false],
  ];
  for (const [from, to, film, out] of middle) {
    const key = `${from}->${to}`;
    const spec = resolvePassageSpec(from, band(to));
    assert.equal(spec.film, film, `${key} keeps film ${film}`);
    assert.equal(spec.out, out, `${key} direction`);
    assert.equal(spec.durationMs, PASSAGES[key].durationMs, `${key} duration from registry`);
    assert.notEqual(spec.durationMs, DEFAULT_PASSAGE.durationMs, `${key} is not the soft default`);
  }
}

// Every registered edge's return leg is the SAME film at the SAME length,
// with the direction flipped. The passage plays a film forward when
// `out` and backward when it is false, so a pair that disagrees on
// film or duration is not one crossing traversed both ways — it is two
// different films, and the second is the one nobody looked at. The bug this
// catches is the ordinary one: a registry block copy-pasted for the return
// leg with a name or a number left unedited.
{
  let pairs = 0;
  for (const [key, spec] of Object.entries(PASSAGES)) {
    const [from, to] = key.split("->");
    const back = PASSAGES[`${to}->${from}`];
    if (!back) continue; // one-way registrations are legal; unmatched is not a pair
    pairs++;
    assert.equal(back.film, spec.film, `${to}->${from} plays the same film as ${key}`);
    assert.equal(back.durationMs, spec.durationMs, `${to}->${from} runs as long as ${key}`);
    assert.equal(back.reducedMs, spec.reducedMs, `${to}->${from} reduces like ${key}`);
    assert.equal(back.out, !spec.out, `${to}->${from} is the reverse direction of ${key}`);
  }
  assert.ok(pairs >= 60, `both legs of every filmed edge are registered (saw ${pairs})`);
}

// An unregistered edge still resolves — never null, never silent.
//
// This deliberately names no edge. It used to assert on cells → tissue, and
// went red the day that edge got a film: the fixture was measuring the
// registry's contents, not the fallback law. Then it named birds → coast,
// which is itself queued for a film and would have rotted the same way. So
// the edge is *discovered* — any pair the registry has not claimed — and the
// test only has something to say while such a pair exists. When the last edge
// is registered, the law it guards is vacuous and it says so rather than
// failing.
{
  const unregistered = SCALE_BANDS.flatMap((from) =>
    SCALE_BANDS.filter((to) => to.id !== from.id)
      .map((to) => ({ from: from.id, to }))
      .filter(({ from, to }) => !PASSAGES[`${from}->${to.id}`]),
  );

  if (unregistered.length === 0) {
    console.log("travel-passage: every edge is registered — the fallback law has nothing left to guard");
  } else {
    const { from, to } = unregistered[0];
    const out = resolvePassageSpec(from, to);
    assert.equal(out.durationMs, DEFAULT_PASSAGE.durationMs, `${from} → ${to.id} falls back to the soft default`);
    assert.equal(out.film, undefined, `${from} → ${to.id} has no film, so it must not claim one`);
    assert.ok(out.navigateAt === DEFAULT_PASSAGE.navigateAt, "the fallback navigates when the default says to");
    assert.equal(typeof out.out, "boolean", "an unregistered edge still knows its direction");
  }
}

console.log("travel-passage ok: every edge resolves a film; both trunks keep their own");

// ——— Film purity: pure function of u and a seed ——————————————————————
//
// "no wall-clock, no randomness — the return leg replays it backward and
// must land on the same frames." A film that reaches for Math.random or the
// wall clock inside renderFrame breaks that silently: it still draws
// something, so nothing in the resolution tests above would catch it. This
// is a static ratchet in the style of scripts/test-room-paint.mjs: the bug
// it catches is a future film author writing `Math.random()` (or reading
// the clock) inside a renderFrame body instead of drawing from the seeded
// arrays built once at film-construction time.
{
  const source = readFileSync(
    fileURLToPath(new URL("../src/components/TravelPassage.tsx", import.meta.url)),
    "utf8",
  );
  assert.ok(!/Math\.random\s*\(/.test(source), "TravelPassage.tsx must never call Math.random");
  assert.ok(!/\bDate\.now\s*\(/.test(source), "TravelPassage.tsx must never read the wall clock");
  assert.ok(
    !/new\s+Date\s*\(/.test(source),
    "TravelPassage.tsx must never construct a wall-clock Date",
  );
}

// ——— Film determinism, executed ————————————————————————————————————————
//
// Load the component itself (not just the data module) so the ten spine
// film factories can be sampled directly. TravelPassage.tsx is a .tsx file
// with JSX in TravelPassageHost's return — scripts/lib/load-ts.mjs
// transpiles without the `jsx` compiler option (it only ever needs to load
// plain .ts data modules), so this loads it locally with jsx enabled rather
// than changing shared test infrastructure other lanes depend on. The JSX
// itself is never evaluated (no React component is instantiated below,
// only the plain film-factory functions), so a stub `react` is enough.
const rootUrl = new URL("../", import.meta.url);
function loadTsxModule(path) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
    fileName: filename,
  }).outputText;
  const mod = { exports: {} };
  const requireShim = (id) => {
    if (id === "react") {
      return {
        useEffect() {},
        useRef() {
          return { current: null };
        },
        useState() {
          return [null, () => {}];
        },
      };
    }
    if (id.startsWith("@/")) return loadTsModule(`src/${id.slice(2)}.ts`);
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  };
  new Function("module", "exports", "require", code)(mod, mod.exports, requireShim);
  return mod.exports;
}

const { __pureFilmFactories } = loadTsxModule("src/components/TravelPassage.tsx");
assert.ok(__pureFilmFactories, "TravelPassage.tsx exports the pure film factories for testing");
const PURE_FILM_NAMES = [
  // the astronomical trunk and the ground/vista films
  "arm",
  "node",
  "orbitfall",
  "sunfall",
  "peakair",
  "fogclimb",
  "garden",
  "strand",
  "fold",
  // the small-scale spine, quanta → drop
  "quantum",
  "confine",
  "shell",
  "bond",
  "chain",
  "helix",
  "chromatin",
  "membrane",
  "sheet",
  "dissolve",
  // the chart-to-sky hop, the living middle, and the top of the axis
  "starchart",
  "lamina",
  "tension",
  "dew",
  "lift",
  "shorewing",
  "massif",
  "interfere",
  "curvature",
  // the bottom of the axis, and the ouroboros wrap
  "loom",
  "ouroboros",
];
for (const name of PURE_FILM_NAMES) {
  assert.equal(
    typeof __pureFilmFactories[name],
    "function",
    `${name} film factory is exported for testing`,
  );
}
// Every film name a registered edge asks for must be one this suite can
// actually sample, or the purity checks below silently stop covering it —
// which is how a film gets written, registered, and never tested at all.
// The four that draw through an offscreen canvas cannot be built in node,
// and are named here so the exemption is a decision rather than a gap.
{
  const CANVAS_BOUND_FILMS = new Set(["beads", "chartland", "airmap", "planet"]);
  const registered = new Set(Object.values(PASSAGES).map((s) => s.film).filter(Boolean));
  for (const name of registered) {
    if (CANVAS_BOUND_FILMS.has(name)) continue;
    assert.ok(
      PURE_FILM_NAMES.includes(name),
      `film "${name}" is registered on an edge but is not sampled for purity — export its ` +
        "factory in __pureFilmFactories and add it to PURE_FILM_NAMES",
    );
  }
}

/** A recording stand-in for CanvasRenderingContext2D: no pixels, just the
 * sequence of calls and property writes a real renderFrame would make. Two
 * recordings that match imply two draws that would look identical. */
function makeRecorder() {
  const calls = [];
  const round = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
  const gradientStub = {
    addColorStop(offset, color) {
      calls.push(["addColorStop", round(offset), color]);
    },
  };
  const handler = {
    get(_t, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        return (...args) => {
          calls.push([String(prop), ...args.map(round)]);
          return gradientStub;
        };
      }
      return (...args) => {
        calls.push([String(prop), ...args.map(round)]);
      };
    },
    set(_t, prop, value) {
      calls.push([`set:${String(prop)}`, round(value)]);
      return true;
    },
  };
  const ctx = new Proxy({}, handler);
  return { ctx, calls };
}

function fingerprint(film, w, h, u) {
  const { ctx, calls } = makeRecorder();
  film.renderFrame(ctx, w, h, u);
  return JSON.stringify(calls);
}

// Determinism in u: two independently-built films from the same seed must
// draw byte-identical frames at the same u. Catches a film whose factory
// leaks external state (e.g. a module-level counter) instead of closing
// only over its seeded arrays.
for (const name of PURE_FILM_NAMES) {
  const factory = __pureFilmFactories[name];
  const filmA = factory(0x51ee5eed);
  const filmB = factory(0x51ee5eed);
  for (const u of [0, 0.12, 0.37, 0.5, 0.68, 0.91, 1]) {
    const a = fingerprint(filmA, 800, 600, u);
    const b = fingerprint(filmB, 800, 600, u);
    assert.equal(a, b, `${name} film: same seed + same u must draw identically (u=${u})`);
  }
}

// Call-order independence — the actual mechanism the reversal law rests on.
// The outbound leg calls renderFrame with u rising 0→1; the return leg,
// mounted fresh, calls it with u falling 1→0. For the return leg to "replay
// the outbound backward," renderFrame(u) must not depend on which frames
// were rendered before it — no accumulator, no frame counter, no rAF-timing
// leak. This renders u values out of order and confirms a later call at the
// same u reproduces the very first call at that u exactly.
for (const name of PURE_FILM_NAMES) {
  const factory = __pureFilmFactories[name];
  const film = factory(0x0a0b1e5);
  const probe = 0.42;
  const first = fingerprint(film, 640, 480, probe);
  // Scramble through unrelated frames — forward, backward, and repeated —
  // between the two samples at the probe u.
  for (const u of [0.9, 0.05, 0.6, 0.2, 0.77, 0.33, 0.9, 0.1]) {
    fingerprint(film, 640, 480, u);
  }
  const second = fingerprint(film, 640, 480, probe);
  assert.equal(
    second,
    first,
    `${name} film: renderFrame(u) must be call-order independent (probe u=${probe}) — ` +
      "a film that drifts here will not reverse correctly on the return leg",
  );
}

console.log(
  `travel-passage ok: ${PURE_FILM_NAMES.length} films are pure — deterministic in u, ` +
    "no wall-clock, order-independent",
);
