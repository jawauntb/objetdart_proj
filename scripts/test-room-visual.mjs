// The room quality bar — the VISUAL DENSITY half.
//
// `test:room-depth` reads a room's manifest and counts declarations: does
// the FRAG carry as many labelled layers as `shader_layers` promised, does
// the source hold as many `SceneObjectSpec<>` as `population.objects` named.
// That is a DECLARATION test — it can go fully green on a room whose
// screenshot is thin, because a manifest can promise four shader layers that
// each paint one flat wash of the same three colours. Phase 7's diagnosis:
// `/tidepool` scored 5/5 on `test:room-depth` and the guide screenshot still
// read as empty water and a few dots.
//
// This test never opens a manifest. It opens the JPG every room's guide
// entry already ships (`public/guide/<key>.jpg`, enforced present by
// `test:guide`) and measures the pixels: how many distinct hues actually
// appear, how much luminance range the frame spans, how much of the frame
// is an edge, how much spatial variety a coarse grid carries, and how many
// bytes the JPG needed to encode it all. A flat scene compresses well below
// a felt one on every one of those axes — that is the whole mechanism; a
// screenshot cannot fake density the way a manifest field can.
//
// Five checks, all skippable at most on the FIRST one (a room can honestly
// declare itself materially 2D-only or monochrome-by-design; nothing else
// exempts a room from carrying real pixel content). See docs/room-visual.md.
//
// Phase 9 added one more, narrower exemption on the THIRD check only
// (`edge_density`): `life.visual.soft_glow: true` (or membership in
// KNOWN_SOFT_GLOW below, for rooms with no manifest yet). The site's
// aesthetic is soft gradients and Fresnel falloffs, not hard specular
// cuts — Sobel edge counting is structurally biased against that look. The
// data that justifies the exemption (not a blanket threshold drop) lives in
// data/object-compiler/audits/phase-9-pebble-and-threshold.md: every room
// listed here clears hue_diversity, luminance_range, spatial_entropy AND
// file_size_floor with real margin, and fails ONLY edge_density, at values
// from 2.4% to 5.8% — a range that overlaps completely with rooms that are
// genuinely thin (failing 3-5 of the 5 checks at once). No single global
// edge_density number separates "soft-glow and rich" from "thin"; only a
// per-room look at all five numbers together does. That is why this is a
// flag, not a lowered constant.
//
// Voluntary, like `test:room-depth`: NOT wired into the composite `npm test`
// (package.json) until enough rooms have been rewritten that the failure
// surface is small. Run directly: `npm run test:room-visual`.

// Legacy rooms with the same evidence as the manifest-flagged ones above,
// but no `src/rooms/<key>/room.config.ts` yet to carry `life.visual.soft_glow`.
// Each cleared hue_diversity, luminance_range, spatial_entropy and
// file_size_floor with real margin at the time this list was written — see
// phase-9-pebble-and-threshold.md for the per-room numbers. Move a key out
// of this list and onto its manifest the day it gets one; don't leave it
// here out of inertia.
const KNOWN_SOFT_GLOW = new Set([
  "storm", // edge_density 4.95% — rest pass with margin (174 luminance, 6 bits entropy)
  "mountain", // edge_density 3.26% — rest pass with margin (157 luminance, 5.4 bits entropy)
  "stars", // edge_density 4.29% — rest pass with margin (16 hue buckets, 98 luminance)
  "timbre", // edge_density 2.38% — rest pass with margin (18 hue buckets, 96 luminance)
  "instrument", // edge_density 2.59% — rest pass with margin (18 hue buckets, 96 luminance)
  "plasma", // edge_density 3.07% — rest pass with margin (187 luminance, 5.5 bits entropy)
]);

import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadTsModule, rootUrl } from "./lib/load-ts.mjs";

const there = (p) => existsSync(new URL(p, rootUrl));
const metricsScript = fileURLToPath(new URL("./lib/room-visual-metrics.py", import.meta.url));

// ———————————————————————————————————————————————————————————————————————
// The rooms under test — every key the guide documents (src/data/guide.ts),
// which is exactly `["home", ...every SITE_ROUTES key]` per test:guide. That
// is a wider net than test-room-depth's (which only walks src/rooms/, the
// Track A manifests): the visual bar applies to every room with a
// screenshot on disk, migrated or not — /stars and /molecules have no
// room.config.ts yet and still belong in this report.
// ———————————————————————————————————————————————————————————————————————

/**
 * @typedef {Object} RoomTarget
 * @property {string} key
 * @property {string} image
 * @property {any}    life  manifest life block, or null when the room has
 *                          no src/rooms/<key>/room.config.ts yet
 */

const rooms = /** @type {RoomTarget[]} */ ([]);
{
  const guideModule = loadTsModule("src/data/guide.ts");
  const keys = guideModule.GUIDE_ROOMS.map((r) => r.key);
  for (const key of keys) {
    const imagePath = `public/guide/${key}.jpg`;
    if (!there(imagePath)) {
      // test:guide already enforces this file exists; if it is missing here
      // that test is already red. Do not double-report — just skip.
      continue;
    }
    let life = null;
    const configPath = `src/rooms/${key}/room.config.ts`;
    if (there(configPath)) {
      try {
        life = loadTsModule(configPath).default?.life ?? null;
      } catch {
        life = null;
      }
    }
    rooms.push({ key, image: fileURLToPath(new URL(imagePath, rootUrl)), life });
  }
}

// ———————————————————————————————————————————————————————————————————————
// Reporting plumbing — same shape as test-room-depth.mjs
// ———————————————————————————————————————————————————————————————————————

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
// Pixel metrics — one python3 subprocess per room. numpy + Pillow are the
// only dependencies (both already installed in this environment); the pixel
// math itself lives in scripts/lib/room-visual-metrics.py so this file stays
// about thresholds and reporting, not Sobel kernels.
// ———————————————————————————————————————————————————————————————————————

function readMetrics(room) {
  const result = spawnSync("python3", [metricsScript, room.image], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(
      `room-visual-metrics.py failed for /${room.key} (${room.image}): ` +
        `${result.stderr || result.error || "no output"}`,
    );
  }
  return JSON.parse(result.stdout);
}

// ———————————————————————————————————————————————————————————————————————
// 1. hue_diversity — the frame actually carries more than one or two colours
// ———————————————————————————————————————————————————————————————————————
//
// HSV hue histogram over 24 buckets (15° each). A bucket counts only when it
// holds >= 1% of the image's total pixel mass. PIL assigns hue 0 to every
// achromatic pixel (R==G==B), so a black or grey field piles honestly into
// bucket 0 alongside anything else with no real hue — it does not spread
// fake mass across the other 23 the way per-pixel JPEG noise might if hue
// were measured some other way. Pass iff >= 4 distinct buckets clear the bar.
//
// Skips when the room manifest declares `life.material_2d_only: true` or
// `life.visual.monochrome_by_design: true` — a room can honestly choose to
// be a flat 2D material or a deliberate monochrome; nothing else exempts it.

const HUE_DIVERSITY_FLOOR = 4;

// ———————————————————————————————————————————————————————————————————————
// 2. luminance_range — the frame spans real light-to-dark contrast
// ———————————————————————————————————————————————————————————————————————
//
// Y' = 0.2126R + 0.7152G + 0.0722B per pixel; range = p90 - p10. A flat wash
// lit from one soft source rarely spans 60 of 255 levels; a room with real
// depth (foreground/background separation, a lit focal object against a
// darker field) does.

const LUMINANCE_RANGE_FLOOR = 60;

// ———————————————————————————————————————————————————————————————————————
// 3. edge_density — the frame has enough boundaries to read as textured
// ———————————————————————————————————————————————————————————————————————
//
// Sobel gradient magnitude over Y'; count pixels where the magnitude exceeds
// 40, as a fraction of the frame. A screenshot of soft gradients and circles
// on an empty field has almost no hard boundaries; a room with populated
// detail, text, or textured material clears 6% of the frame.

const EDGE_DENSITY_FLOOR = 0.06;

// The lowered floor for rooms carrying `life.visual.soft_glow: true` or
// listed in KNOWN_SOFT_GLOW above. Set to 0.02 — 1.8 points under the
// lowest value in that vetted cohort (/timbre, 2.38%) — so it comfortably
// clears every room the evidence actually covers without approaching the
// range where genuinely thin rooms live (many score 2-3% edge_density
// *and* fail hue_diversity/luminance_range/spatial_entropy/file_size_floor
// too; this floor never rescues those, because the flag is opt-in per room,
// not a global drop).
const SOFT_GLOW_EDGE_DENSITY_FLOOR = 0.02;

// ———————————————————————————————————————————————————————————————————————
// 4. spatial_entropy — the frame's coarse layout is not one repeated patch
// ———————————————————————————————————————————————————————————————————————
//
// Shannon entropy, in bits, of a 60x40 box-downsample of the luminance
// channel, histogrammed over the 256 8-bit levels. A frame that is mostly
// one or two flat regions collapses to a few luminance levels and scores
// low; a frame with real spatial variety spreads across many levels.

const SPATIAL_ENTROPY_FLOOR = 4.5;

// ———————————————————————————————————————————————————————————————————————
// 5. file_size_floor — the encoder itself agrees there was something to draw
// ———————————————————————————————————————————————————————————————————————
//
// JPEG is a content-adaptive codec: a flat scene with soft gradients and a
// handful of circles compresses to a few KB at quality 82 on a 1200x750
// frame; a scene with real texture, edges, and colour variety does not.
// >= 30000 bytes is the floor test-room-visual.mjs was written to catch —
// the same number the shoot-guide.mjs jobs actually produce, split cleanly
// between the thin rooms and the rich ones.

const FILE_SIZE_FLOOR = 30000;

for (const room of rooms) {
  const metrics = readMetrics(room);
  const fileSize = statSync(room.image).size;

  // 1. hue_diversity
  const life2dOnly = room.life?.material_2d_only === true;
  const monochromeByDesign = room.life?.visual?.monochrome_by_design === true;
  if (life2dOnly || monochromeByDesign) {
    skip(room.key, "hue_diversity", `skip:${life2dOnly ? "2d" : "monochrome"}`);
  } else {
    const label = `${metrics.hue_buckets} buckets`;
    if (metrics.hue_buckets >= HUE_DIVERSITY_FLOOR) {
      pass(room.key, "hue_diversity", `ok(${label})`);
    } else {
      fail(room.key, "hue_diversity",
        `${room.image} carries only ${metrics.hue_buckets} distinct hue bucket(s) (>=1% pixel mass each) ` +
          `out of 24 — the density floor is ${HUE_DIVERSITY_FLOOR}; the frame reads as one or two colours`,
        `FAIL(${label})`);
    }
  }

  // 2. luminance_range
  {
    const label = `${metrics.luminance_range}`;
    if (metrics.luminance_range >= LUMINANCE_RANGE_FLOOR) {
      pass(room.key, "luminance_range", `ok(${label})`);
    } else {
      fail(room.key, "luminance_range",
        `${room.image} spans only ${metrics.luminance_range} of 255 luminance levels (p90-p10) — ` +
          `the density floor is ${LUMINANCE_RANGE_FLOOR}; the frame is flatly lit, no real light-to-dark contrast`,
        `FAIL(${label})`);
    }
  }

  // 3. edge_density
  {
    const softGlow = room.life?.visual?.soft_glow === true || KNOWN_SOFT_GLOW.has(room.key);
    const floor = softGlow ? SOFT_GLOW_EDGE_DENSITY_FLOOR : EDGE_DENSITY_FLOOR;
    const label = `${metrics.edge_fraction}`;
    if (metrics.edge_fraction >= floor) {
      pass(room.key, "edge_density", `ok${softGlow ? ":soft_glow" : ""}(${label})`);
    } else {
      fail(room.key, "edge_density",
        `${room.image} has only ${(metrics.edge_fraction * 100).toFixed(1)}% of pixels on a hard edge ` +
          `(Sobel magnitude > 40) — the density floor is ${(floor * 100).toFixed(0)}%` +
          `${softGlow ? " (soft_glow-lowered)" : ""}; ` +
          "the frame is soft gradients and empty field, nothing textured enough to read as material",
        `FAIL(${label})`);
    }
  }

  // 4. spatial_entropy
  {
    const label = `${metrics.spatial_entropy}`;
    if (metrics.spatial_entropy >= SPATIAL_ENTROPY_FLOOR) {
      pass(room.key, "spatial_entropy", `ok(${label})`);
    } else {
      fail(room.key, "spatial_entropy",
        `${room.image} scores ${metrics.spatial_entropy} bits of spatial entropy over a 60x40 luminance grid — ` +
          `the density floor is ${SPATIAL_ENTROPY_FLOOR}; the coarse layout is one or two repeated patches, not a varied frame`,
        `FAIL(${label})`);
    }
  }

  // 5. file_size_floor
  {
    if (fileSize >= FILE_SIZE_FLOOR) {
      pass(room.key, "file_size_floor", "ok");
    } else {
      fail(room.key, "file_size_floor",
        `${room.image} is ${fileSize} bytes — the density floor is ${FILE_SIZE_FLOOR} bytes; ` +
          "the JPEG encoder itself agrees there was almost nothing to draw",
        `FAIL(${fileSize}b)`);
    }
  }
}

// ———————————————————————————————————————————————————————————————————————
// The report
// ———————————————————————————————————————————————————————————————————————

const CHECK_NAMES = [
  "hue_diversity",
  "luminance_range",
  "edge_density",
  "spatial_entropy",
  "file_size_floor",
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
    if (failed) return `${name}:${d ?? "FAIL"}`;
    if (skipped) return `${name}:${d ?? "skip"}`;
    return `${name}:${d ?? "ok"}`;
  }).join("  ");
  return `  /${room.key.padEnd(12)}  ${t.pass}✓ ${t.fail}✗ ${t.skip}·  ${marks}`;
}

if (K === 0) {
  console.log(`room-visual ok: ${N} rooms, ${M} checks each, 0 failures`);
  for (const room of rooms) console.log(lineForRoom(room));
  process.exit(0);
}

const lines = [];
lines.push("");
lines.push("— the room VISUAL bar is red. this is pixel content, not declaration count. —");
lines.push("");
lines.push(`room-visual FAIL: ${N} rooms, ${M} checks each, ${K} failures`);
lines.push("");
for (const room of rooms) lines.push(lineForRoom(room));
lines.push("");
lines.push(`failures (${K}):`);
for (const f of findings) lines.push(`  · /${f.key}  ${f.check}: ${f.reason}`);
lines.push("");
lines.push("grow the material until the screenshot actually carries the content — more hue, more contrast,");
lines.push("more texture, more spatial variety — then re-shoot with `npm run shoot:guide -- --only=<key>`.");
lines.push("this test is voluntary until enough rooms have opted in — see docs/room-visual.md.");
lines.push("");
console.error(lines.join("\n"));
process.exit(1);
