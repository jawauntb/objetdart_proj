// The guide (/guide) must stay true to the site. These assertions catch the
// real bugs: a room shipped without documentation, documentation for a room
// that no longer exists, a documented room with no screenshot on disk, and a
// guide the visitor cannot reach.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function readRepoFile(path) {
  return readFileSync(new URL(path, rootUrl), "utf8");
}

function loadTsModule(path, requireMap = {}) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const requireShim = (id) => {
    if (id in requireMap) return requireMap[id];
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  };
  new Function("module", "exports", "require", code)(module, module.exports, requireShim);
  return module.exports;
}

const routesModule = loadTsModule("src/lib/routes.ts");
const guideModule = loadTsModule("src/data/guide.ts");
const iconModule = loadTsModule("src/lib/site-icon-config.ts");
const auroraModule = loadTsModule("src/lib/guide-aurora.ts", {
  "@/lib/site-icon-config": iconModule,
});
const { SITE_ROUTES } = routesModule;
const { GUIDE_ROOMS, GUIDE_GLOBAL_BINDINGS, GUIDE_FIRST_MINUTE, GUIDE_APIS } = guideModule;
const { auroraSpots, resolveRoomPalette } = auroraModule;

// --- coverage: the guide documents exactly the rooms that exist ------------

const guideKeys = GUIDE_ROOMS.map((room) => room.key);
assert.equal(new Set(guideKeys).size, guideKeys.length, "guide room keys must be unique");

const expectedKeys = ["home", ...SITE_ROUTES.map((route) => route.key)];
assert.deepEqual(
  [...guideKeys].sort(),
  [...expectedKeys].sort(),
  "the guide must document every registered route (plus home) and nothing else — " +
    "when a room is added or removed, src/data/guide.ts must change with it",
);

// --- every entry is a real entry -------------------------------------------

for (const room of GUIDE_ROOMS) {
  assert.ok(room.title.length > 0, `${room.key}: title required`);
  assert.equal(room.title, room.title.toLowerCase(), `${room.key}: titles are lowercase on this site`);
  assert.ok(room.essence.length > 12, `${room.key}: essence must say what the room is`);
  assert.ok(Array.isArray(room.moves) && room.moves.length >= 1, `${room.key}: at least one move`);
  for (const move of room.moves) {
    assert.ok(move.includes("→"), `${room.key}: each move reads "gesture → what answers": ${move}`);
  }
  const image = `public/guide/${room.key}.jpg`;
  assert.ok(
    existsSync(new URL(image, rootUrl)),
    `${room.key}: missing ${image} — run \`npm run shoot:guide\` (or --only=${room.key}) against a running build`,
  );
}

// interactive rooms owe the visitor at least three moves; only declared
// reading surfaces (archive, kept, colophon, the guide itself) may run lighter
for (const room of GUIDE_ROOMS) {
  if (room.readingSurface) continue;
  assert.ok(room.moves.length >= 3, `${room.key}: an instrument documents at least three moves`);
}

// --- the shared sections exist and hold their shape ------------------------

assert.ok(GUIDE_FIRST_MINUTE.length >= 3, "the onboarding walk needs its steps");
assert.ok(GUIDE_GLOBAL_BINDINGS.length >= 8, "the global bindings table must cover the grammar");
for (const binding of GUIDE_GLOBAL_BINDINGS) {
  assert.ok(binding.gesture && binding.meaning, "each global binding names a gesture and a meaning");
}
assert.ok(GUIDE_APIS.length >= 4, "every HTTP endpoint under src/app/api should be documented");
for (const api of GUIDE_APIS) {
  assert.ok(
    existsSync(new URL(`src/app/api/${api.name}/route.ts`, rootUrl)),
    `documented api ${api.name} does not exist under src/app/api/`,
  );
}

// --- the hero aurora: every room has real color, and the layout is stable --

for (const room of GUIDE_ROOMS) {
  const palette = resolveRoomPalette(room.key);
  for (const field of ["bg", "bg2", "glow", "accent", "accent2"]) {
    assert.match(palette[field], /^#[0-9a-f]{6}$/i, `${room.key}: palette.${field} should be a hex color`);
  }
}

const keys = GUIDE_ROOMS.map((room) => room.key);
const spotsA = auroraSpots(keys);
const spotsB = auroraSpots(keys);
assert.deepEqual(spotsA, spotsB, "the same room keys must lay out the same aurora every time (deterministic)");
assert.ok(spotsA.length > 0, "the hero should render at least one spot");
assert.ok(spotsA.length <= 26, "the hero should stay within its spot budget for paint cost");
for (const spot of spotsA) {
  assert.ok(spot.leftPct >= 0 && spot.leftPct <= 100, `${spot.key}: leftPct out of bounds`);
  assert.ok(spot.topPct >= 0 && spot.topPct <= 100, `${spot.key}: topPct out of bounds`);
  assert.ok(spot.sizePx > 0, `${spot.key}: sizePx must be positive`);
  assert.match(spot.color, /^#[0-9a-f]{6}$/i, `${spot.key}: color should be a hex color`);
}

// --- the guide is reachable and rendered -----------------------------------

assert.match(readRepoFile("src/components/SiteFooter.tsx"), /href="\/guide"/, "the footer must link the guide");
assert.match(readRepoFile("src/components/Guide.tsx"), /GUIDE_ROOMS/, "the guide page must render the room entries");
assert.ok(existsSync(new URL("src/app/guide/page.tsx", rootUrl)), "the /guide route must exist");

console.log(
  `guide ok: ${GUIDE_ROOMS.length} rooms documented, ${GUIDE_APIS.length} apis, ` +
    `screenshots present, aurora deterministic across ${spotsA.length} spots`,
);
