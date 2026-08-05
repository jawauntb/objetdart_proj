// The room quality bar — the DEPTH half.
//
// Phase 3 landed `test:room-quality`, and its seven checks catch whether the
// calls are wired: whether the shared breath reaches the shader, whether the
// idle writer fires, whether every declared verb lands a haptic, whether the
// exhale actually empties the room. That test is a CONTRACT test — it asks
// "did the room declare a promise, and does the source keep it?"
//
// Phase 6 named the gap the contract test cannot see: a room can pass every
// contract check and still feel thin. A single-layer shader that computes one
// vec3 and returns it. A "population" of one. A state machine with two states
// that both look identical. A tap that is answered by exactly the same visual
// as the tap next to it. Contract-green, density-red: the mechanical bar has
// caught nothing.
//
// This test is the DENSITY half. It reads the same manifest, plus the new
// blocks Track A backfills (`shader_layers`, `discoverables`, `state_machine`)
// and asks: does the material actually carry as many layers as it declared,
// as many objects as it named, as many discoverable branches as it promised,
// as many states as it enumerated, and — universally — is the shader at
// least *thick enough* not to be a stub.
//
// Density-fail is a soft bar for phase 7: a room does not have to declare a
// depth block yet, and the composite `npm test` does not run this test
// (`package.json`). It is voluntary until enough rooms have opted in that the
// migration is done. See `docs/room-depth.md`.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { loadTsModule, rootUrl } from "./lib/load-ts.mjs";

const read = (p) => readFileSync(new URL(p, rootUrl), "utf8");
const there = (p) => existsSync(new URL(p, rootUrl));

const registryModule = loadTsModule("src/lib/room-registry.ts");
const { ROOM_BY_KEY } = registryModule;

// ———————————————————————————————————————————————————————————————————————
// Reading a room's source honestly — the same idiom test-room-contract and
// test-room-quality use, so a state name mentioned in a doc comment is not
// mistaken for a real reference. Copied verbatim so the three tests stay in
// step; when one grows a smarter blanker they all should.
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

// ———————————————————————————————————————————————————————————————————————
// Component discovery — same lookup test-room-quality uses.
// ———————————————————————————————————————————————————————————————————————

function pascalCase(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function componentPath(key) {
  const compiled = `src/components/${pascalCase(key)}.tsx`;
  if (there(compiled)) return compiled;
  const entry = ROOM_BY_KEY[key];
  if (entry && entry.source && there(entry.source)) return entry.source;
  return null;
}

// Extract the `@/lib/<name>` imports declared by a component. For the
// state_machine check we need to grep the room's domain library too — the
// component names its states through the domain functions (`plantSeep`,
// `advanceExact`), but the string literals typing the state union live in
// the lib itself.
function libImportsOf(raw) {
  const paths = new Set();
  const re = /from\s+["']@\/(lib\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    // `@/lib/foo` → `src/lib/foo.ts`; `@/lib/foo/bar` → `src/lib/foo/bar.ts`.
    // Some imports point at index modules (`@/lib/gesture`) — try the .ts
    // then the folder's `index.ts`.
    const rel = `src/${m[1]}`;
    const tsPath = `${rel}.ts`;
    if (there(tsPath)) { paths.add(tsPath); continue; }
    const idxPath = `${rel}/index.ts`;
    if (there(idxPath)) { paths.add(idxPath); continue; }
    // Silently skip missing imports; another test (tsc) catches those.
  }
  return [...paths];
}

// ———————————————————————————————————————————————————————————————————————
// FRAG extraction — every `const FRAG…= \`` in the component, back to the
// closing backtick. Rooms that declare multiple shaders (a background pass
// plus an instanced draw, a volume + a disc) contribute the sum of their
// bodies to the complexity floor — the room's material is the union of its
// passes.
// ———————————————————————————————————————————————————————————————————————

function fragBodies(raw) {
  const out = [];
  // `const FRAG = \`` or `const FRAG_SOMETHING = \`` — the name follows the
  // Spring / Pebble / SolarSystem convention. Case-sensitive `FRAG` on
  // purpose: a variable named `fragment` (a DOM DocumentFragment) is not a
  // shader, and Fire / Sea / Storm use a lower-case `frag` local — we grep
  // those too.
  const re = /\bconst\s+(FRAG[A-Z_0-9]*|frag)\s*(?::\s*[A-Za-z_<>|&\s]+)?\s*=\s*(?:\([^)]*\)\s*=>\s*)?`/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length; // just past the opening backtick
    // Walk to the matching backtick, honouring `\\` and `\``.
    let i = start;
    let end = -1;
    while (i < raw.length) {
      const c = raw[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { end = i; break; }
      i++;
    }
    if (end < 0) break;
    out.push({ name: m[1], body: raw.slice(start, end) });
    re.lastIndex = end + 1;
  }
  return out;
}

// ———————————————————————————————————————————————————————————————————————
// The rooms under test
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
    if (!src) continue;
    const raw = read(src);
    rooms.push({
      key: manifest.key,
      manifest,
      sourcePath: src,
      raw,
      clean: blankLiterals(raw),
      life: manifest.life ?? null,
    });
  }
}

const findings = [];
const skips = new Map(); // key -> Set<checkName>
const perRoomPass = new Map(); // key -> { pass, fail, skip }
const perRoomDetail = new Map(); // key -> Map<checkName, string>

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
function detail(key, check, label) {
  let d = perRoomDetail.get(key);
  if (!d) { d = new Map(); perRoomDetail.set(key, d); }
  d.set(check, label);
}
function fail(key, check, reason, label) {
  findings.push({ key, check, reason });
  tally(key, "fail");
  if (label) detail(key, check, label);
}
function pass(key, check, label) {
  tally(key, "pass");
  if (label) detail(key, check, label);
}
function skip(key, check, label) {
  recordSkip(key, check);
  tally(key, "skip");
  if (label) detail(key, check, label);
}

// ———————————————————————————————————————————————————————————————————————
// 1. shader_layer_count — the FRAG carries as many labelled layers as the
//    manifest promised
// ———————————————————————————————————————————————————————————————————————
//
// A room's `shader_layers` block is the DECLARATION side: an ordered list of
// visible registers (base, waterline, mineral bloom, cleavage traces, lens
// numeric ink, …). The VERIFICATION side is a mechanical count of the
// labelled comments the shader author writes to name each layer where it
// begins in the FRAG body: `// layer: waterline`. The bar is at least one
// labelled `// layer:` for each declared entry.
//
// Under-labelling is the actual bug this catches: a shader whose whole
// picture is one indivisible `mix()` blob is a shader nobody can debug or
// grow. Requiring the labels makes the author state where each register
// LIVES, and the count is proof there is that many of them.

for (const room of rooms) {
  const declared = room.life?.shader_layers;
  if (!Array.isArray(declared) || declared.length === 0) {
    skip(room.key, "shader_layer_count", "0(skip)");
    continue;
  }
  const bodies = fragBodies(room.raw);
  const combined = bodies.map((b) => b.body).join("\n");
  // Grep the layer labels inside the FRAG body only — a `// layer:` in the
  // TypeScript comments above the shader would not prove anything.
  const layerRe = /\/\/\s*layer\s*:/gi;
  const matches = combined.match(layerRe) ?? [];
  const count = matches.length;
  const need = declared.length;
  const label = `${count}/${need}`;
  if (count >= need) {
    pass(room.key, "shader_layer_count", label);
  } else {
    fail(room.key, "shader_layer_count",
      `spec declares ${need} shader_layers but ${room.sourcePath} has ${count} \`// layer:\` labels in its FRAG body — the material is one blob where the manifest asks for ${need} registers`,
      label);
  }
}

// ———————————————————————————————————————————————————————————————————————
// 2. population_count — as many SceneObjectSpec declarations as the manifest
//    named populations
// ———————————————————————————————————————————————————————————————————————
//
// A room whose `life.population.objects` names N entries with hints other
// than `inline array` is promising N countable populations riding the shared
// scene model. The check counts `SceneObjectSpec<` declarations in the
// component source. Two facts land at once: does the count match the
// manifest, and is the count ≥ 2 (the density floor — a single population is
// not "the room has life", it is one object in space).
//
// Skips when: no `population.objects`; or every entry declares
// `implementation_hint: inline array` (those are valid choices, they just do
// not ride the shared model and would fail the count on legitimate grounds).

for (const room of rooms) {
  const objects = room.life?.population?.objects;
  if (!Array.isArray(objects) || objects.length === 0) {
    skip(room.key, "population_count", "0(skip)");
    continue;
  }
  const allInline = objects.every((o) => {
    const hint = String(o?.implementation_hint || "").toLowerCase();
    return hint.startsWith("inline array") || hint.includes("world.ts registry");
  });
  if (allInline) {
    skip(room.key, "population_count", `${objects.length}(skip:inline)`);
    continue;
  }
  const specRe = /\bSceneObjectSpec\s*</g;
  const matches = room.clean.match(specRe) ?? [];
  // A single component might name the type in an import AND in a
  // declaration. Ignore the import line (`type SceneObjectSpec,`) by
  // requiring the `<` opener — the import form does not carry the generic.
  // The regex above already requires `SceneObjectSpec<`, which the import
  // form (`type SceneObjectSpec,`) does not match, so no extra work.
  const count = matches.length;
  const need = objects.length;
  const label = `${count}/${need}`;
  if (count < need) {
    fail(room.key, "population_count",
      `spec declares ${need} population(s) but ${room.sourcePath} has ${count} \`SceneObjectSpec<\` declaration(s) — a promised population is missing from the source`,
      label);
    continue;
  }
  if (count < 2) {
    // The density floor: one population is not density. The manifest is
    // asking for at least a two-species room.
    fail(room.key, "population_count",
      `${room.sourcePath} declares ${count} \`SceneObjectSpec<\` — the density floor is 2 (a room is a population, not one object in space); add a second scene object or declare a second entry in life.population.objects with a non-inline hint`,
      `${label}(<2)`);
    continue;
  }
  pass(room.key, "population_count", label);
}

// ———————————————————————————————————————————————————————————————————————
// 3. discoverable_count — the source has as many state-guarded gesture
//    branches as the manifest promises discoveries
// ———————————————————————————————————————————————————————————————————————
//
// A `discoverables` entry is the promise a patient hand will find something
// the same gesture DOES NOT do under other states. The mechanical proxy is
// the count of state-guarded conditional branches: `if (phase === "…")`,
// `if (tier === n)`, `if (fingers === 3)`, `switch (state)`. If the source
// has ≥ N of those, the room has structurally room to answer differently
// under different states; if it has fewer, it cannot possibly deliver N
// distinct discoveries.

for (const room of rooms) {
  const declared = room.life?.discoverables;
  if (!Array.isArray(declared) || declared.length === 0) {
    skip(room.key, "discoverable_count", "0(skip)");
    continue;
  }
  // Six patterns — enough to reach the common shapes without dragging the
  // grep into raw pointer wiring (which the contract test already forbids).
  const patterns = [
    /\bif\s*\(\s*state\s*===/g,
    /\bif\s*\(\s*phase\s*===/g,
    /\bswitch\s*\(\s*state\b/g,
    /\bif\s*\(\s*currentState\b/g,
    /\bif\s*\(\s*tier\s*===/g,
    /\bif\s*\(\s*fingers\s*===/g,
    // A tier read that isn't `tier ===` also counts — `e.tier >= 3` is the
    // ceremony branch that /rocks writes inside its hold handler.
    /\be\.tier\s*(?:>=|>|===)\s*[0-9]/g,
  ];
  let count = 0;
  for (const p of patterns) {
    const matches = room.clean.match(p) ?? [];
    count += matches.length;
  }
  const need = declared.length;
  const label = `${count}/${need}`;
  if (count >= need) {
    pass(room.key, "discoverable_count", label);
  } else {
    fail(room.key, "discoverable_count",
      `spec declares ${need} discoverable(s) but ${room.sourcePath} has ${count} state-guarded branch(es) (if state===/phase===/tier===/fingers===/switch(state)) — a discovery the manifest promises has no branch to fire from`,
      label);
  }
}

// ———————————————————————————————————————————————————————————————————————
// 4. state_machine_states — every named state appears somewhere in the
//    component or its domain library
// ———————————————————————————————————————————————————————————————————————
//
// A room that declares `state_machine.states: [{ name: "…" }, …]` is
// promising each state is a real thing the code can be in. The mechanical
// proxy: each state.name must appear as a string literal (`"idle"` or
// `'idle'`) in the component source or in one of the `@/lib/*` domain files
// the component imports. A state named in the manifest that never appears
// in code is a fiction — the state machine has fewer states than declared,
// and the visible_change never happens because the code never enters that
// state.

for (const room of rooms) {
  const declared = room.life?.state_machine?.states;
  if (!Array.isArray(declared) || declared.length === 0) {
    skip(room.key, "state_machine_states", "0(skip)");
    continue;
  }
  // The search corpus: component source + every domain-lib file it imports.
  // A state name is a short bareword that could easily collide with common
  // identifiers, so the check demands a quoted string — the shape the code
  // uses when comparing (`state === "idle"`), when typing (`type Phase =
  // "idle" | "..."`), or when initialising (`return { phase: "idle" }`).
  const libs = libImportsOf(room.raw).map(read).join("\n");
  const corpus = room.raw + "\n" + libs;
  const missing = [];
  for (const state of declared) {
    const name = String(state?.name || "").trim();
    if (!name) {
      missing.push("(unnamed state in schema)");
      continue;
    }
    const needle = new RegExp(`["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
    if (!needle.test(corpus)) missing.push(name);
  }
  const need = declared.length;
  const found = need - missing.length;
  const label = `${found}/${need}`;
  if (missing.length === 0) {
    pass(room.key, "state_machine_states", label);
  } else {
    fail(room.key, "state_machine_states",
      `spec declares state(s) [${declared.map((s) => s?.name).join(", ")}] but the following never appear as string literals in ${room.sourcePath} or its @/lib imports: ${missing.join(", ")}`,
      label);
  }
}

// ———————————————————————————————————————————————————————————————————————
// 5. shader_complexity_floor — the FRAG is thick enough not to be a stub
// ———————————————————————————————————————————————————————————————————————
//
// The universal density check. Every room's FRAG body must be at least 400
// characters. Under 400 is a stub — a solid colour, a single mix() of two
// palette entries, a body no more expressive than the wallpaper. A room
// whose material is legitimately 2D-only (`life.material_2d_only: true`)
// skips; nothing else exempts it. Rooms with multiple FRAGs sum: a two-pass
// material is judged on the union of its passes.
//
// This is the check that catches thin material even when the room declares
// no depth block at all — the felt bar shipping without waiting for every
// author to opt in.

const FRAG_FLOOR = 400;

for (const room of rooms) {
  if (room.life?.material_2d_only === true) {
    skip(room.key, "shader_complexity_floor", "skip:2d");
    continue;
  }
  const bodies = fragBodies(room.raw);
  const total = bodies.reduce((n, b) => n + b.body.length, 0);
  const label = `${total}c`;
  if (total >= FRAG_FLOOR) {
    pass(room.key, "shader_complexity_floor", "ok");
    continue;
  }
  if (bodies.length === 0) {
    fail(room.key, "shader_complexity_floor",
      `${room.sourcePath} declares no FRAG shader body and no life.material_2d_only: true — the room is 2D by silence, which reads as a stub; either add the flag or paint the material as a shader`,
      "0c");
    continue;
  }
  fail(room.key, "shader_complexity_floor",
    `${room.sourcePath} has ${total} chars of FRAG body across ${bodies.length} shader(s), under the ${FRAG_FLOOR}-char density floor — the shader is essentially a stub`,
    label);
}

// ———————————————————————————————————————————————————————————————————————
// The report
// ———————————————————————————————————————————————————————————————————————

const CHECK_NAMES = [
  "shader_layer_count",
  "population_count",
  "discoverable_count",
  "state_machine_states",
  "shader_complexity_floor",
];

const N = rooms.length;
const M = CHECK_NAMES.length;
const K = findings.length;

function lineForRoom(room) {
  const t = perRoomPass.get(room.key) ?? { pass: 0, fail: 0, skip: 0 };
  const detailMap = perRoomDetail.get(room.key) ?? new Map();
  const marks = CHECK_NAMES.map((name) => {
    const failed = findings.some((f) => f.key === room.key && f.check === name);
    const skipped = skips.get(room.key)?.has(name);
    const d = detailMap.get(name);
    if (failed) return `${name}:FAIL(${d ?? "?"})`;
    if (skipped) return `${name}:${d ?? "skip"}`;
    return `${name}:${d ?? "ok"}`;
  }).join("  ");
  return `  /${room.key.padEnd(12)}  ${t.pass}✓ ${t.fail}✗ ${t.skip}·  ${marks}`;
}

if (K === 0) {
  console.log(`room-depth ok: ${N} rooms, ${M} checks/room, 0 failures`);
  for (const room of rooms) console.log(lineForRoom(room));
  process.exit(0);
}

const lines = [];
lines.push("");
lines.push("— the room DEPTH bar is red. this is the density bar the contract test could not see. —");
lines.push("");
lines.push(`room-depth FAIL: ${N} rooms, ${M} checks/room, ${K} failures`);
lines.push("");
for (const room of rooms) lines.push(lineForRoom(room));
lines.push("");
lines.push(`failures (${K}):`);
for (const f of findings) lines.push(`  · /${f.key}  ${f.check}: ${f.reason}`);
lines.push("");
lines.push("declare the depth block on the room manifest, or grow the material until the count is real.");
lines.push("this test is voluntary until enough rooms have opted in — see docs/room-depth.md.");
lines.push("");
console.error(lines.join("\n"));
process.exit(1);
