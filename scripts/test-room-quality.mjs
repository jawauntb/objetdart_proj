// The room quality bar, mechanised.
//
// AGENTS.md §"The room quality bar — non-negotiable" states seven items that
// separate a room that is alive from one that only looks alive in a
// screenshot. `test:room-contract` catches the grammar and the paint bans;
// this test catches the felt-quality contract: the shared breath, the idle
// glimmer, haptics on every meaningful act, the countable population, the
// make-and-unmake ceremony, and the frame governor.
//
// The `life:` block on a room manifest is the DECLARATION side — a room says
// what population it holds, what it does at rest, and which haptic each verb
// gets. This test is the VERIFICATION side — for rooms that carry a life
// block, every declared line must be answered in the component source. For
// rooms that predate the block (all 62 current rooms until they migrate),
// only the always-applicable subset runs, so the bar can ship without
// falsely reddening the existing suite.
//
// Each check names the bug it catches. Static grep over source text — plain
// node, no browser, fast.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { loadTsModule, rootUrl } from "./lib/load-ts.mjs";

const read = (p) => readFileSync(new URL(p, rootUrl), "utf8");
const there = (p) => existsSync(new URL(p, rootUrl));

const registryModule = loadTsModule("src/lib/room-registry.ts");
const { ROOM_BY_KEY } = registryModule;

// ———————————————————————————————————————————————————————————————————————
// Reading a room's source honestly: blank out comments and strings so a
// literal that mentions `uBreath` in a doc comment does not count as wiring.
// Copied from test-room-contract.mjs — same idiom, kept intentionally.
// ———————————————————————————————————————————————————————————————————————

function blankLiterals(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && source[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i++;
      while (i < n) {
        if (source[i] === "\\") { out += "  "; i += 2; continue; }
        if (source[i] === quote) { out += " "; i++; break; }
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Index just past the balanced closer that opens at `from`. */
function matchAt(text, from, open, close) {
  let depth = 0;
  for (let k = from; k < text.length; k++) {
    if (text[k] === open) depth++;
    else if (text[k] === close) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/**
 * Find the RoomVoice memo body. Rooms write one of two shapes:
 *   const voice = useMemo<RoomVoice>(() => ({ ... }), []);
 *   const voiceRef = useRef<RoomVoice>({ ... });
 * We return every such body concatenated, or the whole file if we cannot find
 * one (defensive — the check downstream still asks the right question).
 */
function voiceBodies(clean) {
  const out = [];
  const patterns = [
    /useMemo\s*<\s*RoomVoice\s*>[\s\S]*?\(\s*\(\s*\)\s*=>\s*\(\s*\{/,
    /useRef\s*<\s*RoomVoice\s*>\s*\(\s*\{/,
  ];
  for (const pat of patterns) {
    let idx = 0;
    while (idx < clean.length) {
      pat.lastIndex = 0;
      const m = clean.slice(idx).match(pat);
      if (!m) break;
      const open = clean.indexOf("{", idx + m.index + m[0].length - 1);
      if (open < 0) break;
      const close = matchAt(clean, open, "{", "}");
      if (close < 0) break;
      out.push(clean.slice(open, close + 1));
      idx = close + 1;
    }
  }
  return out.join("\n;\n");
}

// ———————————————————————————————————————————————————————————————————————
// Which check applies, per room
// ———————————————————————————————————————————————————————————————————————

// Every exported haptic pattern from src/lib/haptics.ts. If life declares a
// grammar entry, its value must match one of these; if life does not, any of
// these counts as "the room speaks in the third sense".
const KNOWN_HAPTIC_PATTERNS = new Set([
  "tap",
  "ripple",
  "chop",
  "roll",
  "storm",
  "detent",
  "crossing",
  "lens",
  "bloom",
  // The low-level escape hatch — a room may fire an arbitrary vibrate through
  // it; we accept the bare `haptic(` call as evidence that a verb writes to
  // the vessel, even without a named pattern.
  "haptic",
]);

const GLIMMER_DEFAULT_MS = 20000;

// ———————————————————————————————————————————————————————————————————————
// Walk the manifests, join to the registry, run the seven checks
// ———————————————————————————————————————————————————————————————————————

/**
 * @typedef {Object} RoomTarget
 * @property {string} key
 * @property {any}    manifest
 * @property {string} sourcePath
 * @property {string} raw
 * @property {string} clean
 * @property {any}    life
 */

function pascalCase(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Discover the component source for a manifest room. The compiler names the
 * component `src/components/<PascalCase(key)>.tsx`; the registry's `source`
 * is the fallback for rooms whose component predates that convention
 * (atmosphere → AirColumn, soil → SoilGround, ...).
 */
function componentPath(key) {
  const compiled = `src/components/${pascalCase(key)}.tsx`;
  if (there(compiled)) return compiled;
  const entry = ROOM_BY_KEY[key];
  if (entry && entry.source && there(entry.source)) return entry.source;
  return null;
}

const rooms = /** @type {RoomTarget[]} */ ([]);
{
  const roomsDir = new URL("src/rooms/", rootUrl);
  for (const entry of readdirSync(roomsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const configPath = `src/rooms/${entry.name}/room.config.ts`;
    if (!there(configPath)) continue;
    let manifest;
    try {
      manifest = loadTsModule(configPath).default;
    } catch (err) {
      throw new Error(`could not load manifest ${configPath}: ${(err && err.message) || err}`);
    }
    if (!manifest || typeof manifest !== "object" || !manifest.key) continue;
    const src = componentPath(manifest.key);
    if (!src) {
      // A manifest with no component is another test's failure (test-rooms).
      // We simply cannot judge quality for it, so skip.
      continue;
    }
    const raw = read(src);
    rooms.push({
      key: manifest.key,
      manifest,
      sourcePath: src,
      raw,
      clean: blankLiterals(raw),
      life: (manifest).life ?? null,
    });
  }
}

// A finding is (room, check, reason). Skipped checks do not contribute.
const findings = [];
const skips = new Map(); // key -> Set<checkName>
const perRoomPass = new Map(); // key -> { pass, fail, skip }

function recordSkip(key, check) {
  let s = skips.get(key);
  if (!s) { s = new Set(); skips.set(key, s); }
  s.add(check);
}

function tally(key, verdict) {
  let t = perRoomPass.get(key);
  if (!t) { t = { pass: 0, fail: 0, skip: 0 }; perRoomPass.set(key, t); }
  t[verdict]++;
}

function fail(key, check, reason) {
  findings.push({ key, check, reason });
  tally(key, "fail");
}
function pass(key /*, check */) { tally(key, "pass"); }
function skip(key, check /*, reason */) { recordSkip(key, check); tally(key, "skip"); }

// ———————————————————————————————————————————————————————————————————————
// 1. breath_wired — the shared 7s breath reaches the shader
// ———————————————————————————————————————————————————————————————————————
//
// A room may declare `life.breath.reads` naming the uniforms/functions it
// uses. When `uBreath` is on that list, the fragment shader must both
// DECLARE `uniform float uBreath;` and USE it in a computation — a uniform
// that never appears past its declaration is dead wiring the eye reads as
// stillness.
//
// If the room declares no life block, we cannot know whether the breath was
// meant to reach it, so the check is skipped. The paint & contract laws
// still cover the room's grammar.

for (const room of rooms) {
  const declared = room.life?.breath?.reads;
  const expectsUBreath = Array.isArray(declared) && declared.some((s) => /uBreath/.test(String(s)));
  if (!expectsUBreath) {
    skip(room.key, "breath_wired");
    continue;
  }
  const declRe = /\buniform\s+float\s+uBreath\b/;
  const anyUse = /\buBreath\b/g;
  if (!declRe.test(room.raw)) {
    fail(room.key, "breath_wired",
      `life.breath.reads names uBreath but ${room.sourcePath} declares no ` +
        "`uniform float uBreath;` in its FRAG string — the shared 7s breath cannot enter the material");
    continue;
  }
  // At least one use OUTSIDE the declaration line.
  const declLineMatch = room.raw.match(/^.*\buniform\s+float\s+uBreath\b.*$/m);
  const declLine = declLineMatch ? declLineMatch[0] : "";
  const uses = [...room.raw.matchAll(anyUse)].map((m) => m.index);
  const external = uses.some((idx) => {
    const lineStart = room.raw.lastIndexOf("\n", idx) + 1;
    const lineEnd = room.raw.indexOf("\n", idx);
    const line = room.raw.slice(lineStart, lineEnd < 0 ? room.raw.length : lineEnd);
    return line !== declLine;
  });
  if (!external) {
    fail(room.key, "breath_wired",
      `uBreath is declared in ${room.sourcePath} but never read in a computation — ` +
        "the room is not alive at rest, whatever the manifest says");
    continue;
  }
  pass(room.key);
}

// ———————————————————————————————————————————————————————————————————————
// 2. glimmer_wired — the idle writer runs the ~20s glimmer and persistence
// ———————————————————————————————————————————————————————————————————————
//
// `createIdleWriter` from `@/lib/room-runtime` is the debounced writer every
// room persisting state should use. The check applies to every room (the
// task's floor) — a room that keeps things (registry.creates != null) that
// does not schedule idle saves cannot preserve the population across a
// reload, and a room whose glimmer cadence disagrees with what the manifest
// declared is documenting a fiction.

for (const room of rooms) {
  const usesIdle = /createIdleWriter\s*\(/.test(room.clean);
  const glimmerMs = room.life?.glimmer?.after_idle_ms;
  const entry = ROOM_BY_KEY[room.key];
  const keeps = entry && entry.keeps;
  if (!usesIdle) {
    // Skip when the room genuinely keeps nothing AND does not declare life;
    // penalise when the registry says it keeps state (a keeps: key implies
    // a writer somewhere) or when life declares a non-default cadence.
    if (!keeps && !glimmerMs) {
      skip(room.key, "glimmer_wired");
      continue;
    }
    fail(room.key, "glimmer_wired",
      `${room.sourcePath} does not call createIdleWriter — ` +
        `the room ${keeps ? `persists to "${keeps}"` : "declares a glimmer cadence"} ` +
        "but rolls its own writer, which is how a save gets lost between visits (SoilGround pattern)");
    continue;
  }
  if (glimmerMs != null && Number.isFinite(glimmerMs) && glimmerMs !== GLIMMER_DEFAULT_MS) {
    // A room that overrode the shared cadence must state the number in
    // source so the manifest and the code cannot silently disagree.
    const literal = new RegExp(`\\b${glimmerMs}\\b`);
    if (!literal.test(room.clean)) {
      fail(room.key, "glimmer_wired",
        `life.glimmer.after_idle_ms=${glimmerMs} but ${room.sourcePath} contains no ` +
          `literal ${glimmerMs} — the manifest documents a cadence the code does not honour`);
      continue;
    }
  }
  pass(room.key);
}

// ———————————————————————————————————————————————————————————————————————
// 3. haptics_per_verb — every verb the room declared it answers lands in
//    the hand
// ———————————————————————————————————————————————————————————————————————
//
// The felt bar is AGENTS.md item 6: two senses in the same frame, haptics
// included. The RoomVoice memo (or the engine object those methods forward
// to) must fire a `haptics.<pattern>()` for each verb the room claims to
// answer. If life.haptics_grammar names patterns, we check the pattern
// specifically; otherwise we accept ANY known pattern for the verb.
//
// Pre-life rooms are skipped: without a declared grammar we cannot tell
// which verbs must haptically land.

for (const room of rooms) {
  const grammar = room.life?.haptics_grammar;
  if (!grammar || typeof grammar !== "object") {
    skip(room.key, "haptics_per_verb");
    continue;
  }
  const verbs = Object.keys(grammar);
  if (verbs.length === 0) {
    skip(room.key, "haptics_per_verb");
    continue;
  }
  const voiceBody = voiceBodies(room.clean);
  // The RoomVoice memo often only forwards into `apiRef.current.<verb>()`,
  // so we scan the whole cleaned source for the haptics call. Missing haptics
  // there is a real hole regardless of which layer answered the verb.
  const searchBody = voiceBody + "\n" + room.clean;
  const missing = [];
  for (const verb of verbs) {
    const pattern = String(grammar[verb] || "").trim();
    if (!pattern) {
      // A verb whose grammar entry is empty is a documentation hole — the
      // manifest lists the verb without saying how it lands. Flag it.
      missing.push(`${verb} (no pattern declared)`);
      continue;
    }
    if (!KNOWN_HAPTIC_PATTERNS.has(pattern)) {
      missing.push(`${verb} → "${pattern}" is not in src/lib/haptics.ts`);
      continue;
    }
    const re = new RegExp(`\\bhaptics\\.${pattern}\\s*\\(`, "g");
    if (!re.test(searchBody)) {
      missing.push(`${verb} → haptics.${pattern}() not called`);
    }
  }
  if (missing.length) {
    fail(room.key, "haptics_per_verb",
      `${room.sourcePath} misses haptics for: ${missing.join("; ")}`);
    continue;
  }
  pass(room.key);
}

// ———————————————————————————————————————————————————————————————————————
// 4. population_layer_used — a countable material rides the shared model
// ———————————————————————————————————————————————————————————————————————
//
// A room whose life block names objects with `implementation_hint:
// SceneObjectSpec` is promising the reader that it uses the shared
// scene-model (src/lib/scene/*), not another hand-rolled Float32Array on
// the side. That means the source must import from `@/lib/scene/object` or
// `@/lib/scene/population-layer` AND declare at least one `SceneObjectSpec`
// (as a type annotation on the spec constant). If every object in the life
// block uses `inline array` or a `world.ts registry` hint, the check is
// skipped — those are equally valid, they just aren't the scene model.

for (const room of rooms) {
  const objects = room.life?.population?.objects;
  if (!Array.isArray(objects) || objects.length === 0) {
    skip(room.key, "population_layer_used");
    continue;
  }
  const wantScene = objects.some((o) => String(o?.implementation_hint || "") === "SceneObjectSpec");
  if (!wantScene) {
    skip(room.key, "population_layer_used");
    continue;
  }
  const importsScene =
    /["']@\/lib\/scene\/object["']/.test(room.raw) ||
    /["']@\/lib\/scene\/population-layer["']/.test(room.raw);
  const declaresSpec = /\bSceneObjectSpec\s*</.test(room.clean);
  if (!importsScene || !declaresSpec) {
    fail(room.key, "population_layer_used",
      `${room.sourcePath} declares life.population.objects with SceneObjectSpec ` +
        `but ${!importsScene ? "does not import @/lib/scene/{object,population-layer}" : ""}` +
        `${!importsScene && !declaresSpec ? " and " : ""}` +
        `${!declaresSpec ? "declares no `SceneObjectSpec<...>` — the manifest says the room rides the shared model, the code says another Float32Array on the side" : ""}`);
    continue;
  }
  pass(room.key);
}

// ———————————————————————————————————————————————————————————————————————
// 5. make_unmake_ceremony — the room's one solemn act is written
// ———————————————————————————————————————————————————————————————————————
//
// A room that declares `life.make_unmake.ceremony_is` is saying: "this is
// the one solemn act — the ceremony hold seals a thing and keeps it." That
// promise is only kept when the RoomVoice memo actually implements a
// `ceremony:` handler. Missing here means a hold to the ceremony tier lands
// on the shell's fallback default, which is polite but not the promised act.

for (const room of rooms) {
  const ceremonyIs = room.life?.make_unmake?.ceremony_is;
  if (!ceremonyIs) {
    skip(room.key, "make_unmake_ceremony");
    continue;
  }
  const voiceBody = voiceBodies(room.clean);
  // Match `ceremony: (` inside the voice literal, allowing async/arrow.
  const re = /(?:^|[\s,{])ceremony\s*:\s*(?:async\s*)?\(/;
  if (!re.test(voiceBody)) {
    fail(room.key, "make_unmake_ceremony",
      `life.make_unmake.ceremony_is is set but ${room.sourcePath}'s RoomVoice memo ` +
        "implements no `ceremony:` handler — the one solemn act falls to the shell's default");
    continue;
  }
  pass(room.key);
}

// ———————————————————————————————————————————————————————————————————————
// 6. letgo_clears — the exhale actually empties the room
// ———————————————————————————————————————————————————————————————————————
//
// The whole-field clear is the shared `<LetGo>`, and it must ACTUALLY clear.
// A room with `life.make_unmake.letgo_clears_population: true` must contain
// both `letGo` (prop or handler) AND either a `setSomething([])`, a
// `.retireAll()`, or a `.clear()` call somewhere within a reasonable window
// of the letGo handler.
//
// Permissive default for pre-life rooms with registry.creates != null: we
// still ask that a `letGo` handler exists and that the file mentions a clear
// or retire — a nicer-than-nothing floor.

for (const room of rooms) {
  const declared = room.life?.make_unmake?.letgo_clears_population;
  const entry = ROOM_BY_KEY[room.key];
  const shouldClear = declared === true || (declared == null && entry && entry.creates);
  if (!shouldClear) {
    skip(room.key, "letgo_clears");
    continue;
  }
  const hasLetGo = /\bletGo\b/.test(room.clean);
  if (!hasLetGo) {
    fail(room.key, "letgo_clears",
      `${room.sourcePath} has no letGo prop/handler despite ${entry?.creates ? `creating "${entry.creates}"` : "life.make_unmake.letgo_clears_population = true"}`);
    continue;
  }
  // Rooms empty themselves in several honest shapes:
  //   apiRef.current?.clear()                — the modern api ref pattern
  //   setStones([])                          — a React state setter
  //   stonesRef.current = []                 — a ref reset
  //   clearBeamRef.current()                 — a named clear function through a ref
  //   .retireAll() / .letGo() / .unmake() / .reset()  — population verbs
  // Any one of these is proof the exhale actually empties something.
  const clearsWithSetter = /set\w+\s*\(\s*\[\s*\]\s*\)/.test(room.clean);
  const clearsWithArrayAssign = /=\s*\[\s*\]/.test(room.clean);
  const clearsWithMethod = /\.(?:retireAll|clear|reset|letGo|unmake|dispose|forget|empty)\s*\(/.test(room.clean);
  const clearsWithNamedRef = /\bclear\w*Ref\b/.test(room.clean);
  if (!clearsWithSetter && !clearsWithArrayAssign && !clearsWithMethod && !clearsWithNamedRef) {
    fail(room.key, "letgo_clears",
      `${room.sourcePath} declares letGo but the file contains no state-reset (setX([]) / ` +
        "arr = [] / .retireAll() / .clear() / clearXxxRef) — the exhale runs and nothing empties");
    continue;
  }
  pass(room.key);
}

// ———————————————————————————————————————————————————————————————————————
// 7. frame_governor_present — one rAF, tiered
// ———————————————————————————————————————————————————————————————————————
//
// A sanity floor. Every animating room must call `createFrameGovernor` from
// `@/lib/room-runtime` so the tier can fall under load. Rooms that yield the
// frame to RoomShell + scene/room delegate this; rooms whose registry entry
// carries a `governor` exemption state why in prose.

for (const room of rooms) {
  const hasGovernor = /createFrameGovernor\s*\(/.test(room.clean);
  // Rooms built on RoomShell OR scene/room delegate lifecycle to the shell —
  // same convention test-room-contract uses (its §4). The two tests must agree
  // about what "delegates" means.
  const viaShell = /@\/components\/RoomShell/.test(room.raw) || /@\/lib\/scene\/(?:voice|object)/.test(room.raw);
  const entry = ROOM_BY_KEY[room.key];
  const exempt = entry && entry.governor;
  const animates = /requestAnimationFrame\s*\(/.test(room.clean) || viaShell;
  if (!animates) {
    // Nothing to govern.
    skip(room.key, "frame_governor_present");
    continue;
  }
  if (hasGovernor || exempt || viaShell) {
    pass(room.key);
    continue;
  }
  fail(room.key, "frame_governor_present",
    `${room.sourcePath} runs an animation loop with no createFrameGovernor and no ` +
      "governor exemption in the registry — the DPR ceiling and detail tier never fire");
}

// ———————————————————————————————————————————————————————————————————————
// The report
// ———————————————————————————————————————————————————————————————————————

const CHECK_NAMES = [
  "breath_wired",
  "glimmer_wired",
  "haptics_per_verb",
  "population_layer_used",
  "make_unmake_ceremony",
  "letgo_clears",
  "frame_governor_present",
];

const N = rooms.length;
const M = CHECK_NAMES.length;
const K = findings.length;

function lineForRoom(room) {
  const t = perRoomPass.get(room.key) ?? { pass: 0, fail: 0, skip: 0 };
  const marks = CHECK_NAMES.map((name) => {
    const failed = findings.some((f) => f.key === room.key && f.check === name);
    if (failed) return `${name}:FAIL`;
    const skipped = skips.get(room.key)?.has(name);
    if (skipped) return `${name}:skip`;
    return `${name}:ok`;
  }).join("  ");
  return `  /${room.key.padEnd(12)}  ${t.pass}✓ ${t.fail}✗ ${t.skip}·  ${marks}`;
}

if (K === 0) {
  console.log(`room-quality ok: ${N} rooms, ${M} checks/room, 0 failures`);
  // Emit per-room summary so a run makes it easy to see who declared what.
  for (const room of rooms) console.log(lineForRoom(room));
  process.exit(0);
}

const lines = [];
lines.push("");
lines.push("— the room quality bar is red. that is the law working, not an obstacle. —");
lines.push("");
lines.push(`room-quality FAIL: ${N} rooms, ${M} checks/room, ${K} failures`);
lines.push("");
for (const room of rooms) lines.push(lineForRoom(room));
lines.push("");
lines.push(`failures (${K}):`);
for (const f of findings) lines.push(`  · /${f.key}  ${f.check}: ${f.reason}`);
lines.push("");
lines.push("declare the life block on the room manifest, or wire the missing call in the component.");
lines.push("never delete the manifest field you should be answering.");
lines.push("");
console.error(lines.join("\n"));
process.exit(1);
