import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function loadTsModule(path) {
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
  const sandbox = { module, exports: module.exports };
  vm.runInNewContext(code, sandbox, { filename });
  return module.exports;
}

const {
  SCALE_BANDS,
  SCALE_MIN,
  SCALE_MAX,
  TRAVEL_INTENT_MS,
  bandAt,
  bandBlend,
  initialScaleState,
  liveInput,
  stepScale,
  spectralRegisterFor,
  entryScaleFor,
  scaleForRoomZoom,
  residualScaleInput,
} = loadTsModule("src/lib/scale.ts");

// The rooms' declared internal zoom ranges — the same objects the
// components consume, so a drifted range fails here, not in the hand.
const { STARS_ZOOM_SPEC } = loadTsModule("src/lib/stars/nestedCosmos.ts");
const { ATLAS_ZOOM_SPEC } = loadTsModule("src/lib/atlas-navigation.ts");

// — Band registry is contiguous, ordered, and covers the whole axis —
for (let i = 1; i < SCALE_BANDS.length; i++) {
  assert.equal(
    SCALE_BANDS[i].sMin,
    SCALE_BANDS[i - 1].sMax,
    `bands contiguous at ${SCALE_BANDS[i].id}`,
  );
}
assert.equal(SCALE_BANDS[0].sMin, SCALE_MIN);
assert.equal(SCALE_BANDS[SCALE_BANDS.length - 1].sMax, SCALE_MAX);

// — bandAt respects half-open spans and clamps —
assert.equal(bandAt(-19).id, "quarks");
assert.equal(bandAt(-14).id, "atoms", "boundary belongs to the upper band");
assert.equal(bandAt(2).id, "coast");
assert.equal(bandAt(999).id, "manifold");
assert.equal(bandAt(-999).id, "quarks");

// — bandBlend: pure in the interior, symmetric crossfade near a wall —
const mid = bandBlend(2.5);
assert.equal(mid.t, 0, "band center has no secondary");
const nearWall = bandBlend(4.5 - 0.05);
assert.equal(nearWall.primary, "coast");
assert.equal(nearWall.secondary, "atlas");
assert.ok(nearWall.t > 0.35 && nearWall.t <= 0.5, `blend ramps toward 0.5 at wall (got ${nearWall.t})`);

// — Local zoom: a brief pinch cannot cross a band wall —
let st = initialScaleState(2.5);
let crossed = false;
for (let i = 0; i < 20; i++) {
  const r = stepScale(st, { zoomVel: 2.5, active: true }, 16);
  st = r.state;
  crossed ||= r.events.some((e) => e.type === "crossing");
}
// 20 frames ≈ 320ms of travel-speed pinch from band center: reaches the wall
// but must not break through without sustained intent *at* the wall.
assert.equal(crossed, false, "no accidental crossing on a short pinch");
assert.ok(st.s < 4.5, "s held inside the band");

// — A detent fires on first wall contact —
let detent = false;
let st2 = initialScaleState(4.4);
for (let i = 0; i < 15; i++) {
  const r = stepScale(st2, { zoomVel: 2.0, active: true }, 16);
  st2 = r.state;
  detent ||= r.events.some((e) => e.type === "detent");
}
assert.equal(detent, true, "wall contact emits detent");

// — Sustained push crosses, once, into the neighbor —
let st3 = initialScaleState(4.45);
const crossings = [];
for (let i = 0; i < 80; i++) {
  const r = stepScale(st3, { zoomVel: 2.0, active: true }, 16);
  st3 = r.state;
  for (const e of r.events) if (e.type === "crossing") crossings.push(e);
  if (crossings.length) break;
}
assert.equal(crossings.length, 1, "sustained push crosses");
assert.equal(crossings[0].from, "coast");
assert.equal(crossings[0].to, "atlas");
assert.ok(st3.s > 4.5, "landed inside the neighbor");

// — Releasing at the wall lets intent decay: no delayed crossing —
let st4 = initialScaleState(4.45);
for (let i = 0; i < 12; i++) st4 = stepScale(st4, { zoomVel: 2.0, active: true }, 16).state;
let lateCross = false;
for (let i = 0; i < 60; i++) {
  const r = stepScale(st4, { zoomVel: 0, active: false }, 16);
  st4 = r.state;
  lateCross ||= r.events.some((e) => e.type === "crossing");
}
assert.equal(lateCross, false, "letting go never crosses");
assert.equal(st4.intentMs, 0, "intent fully decays");

// — Regression: one orphan wheel tick must never self-travel —
// A trackpad pinch is a burst of discrete ticks with no end event. Simulate
// the real driver loop (liveInput applied each frame, as ScaleTravel does):
// a single tick right next to a wall, then 3 seconds of frames.
{
  let st = initialScaleState(4.45);
  let input = { zoomVel: 2.0, active: true };
  let lastTick = 0;
  let crossedFromOneTick = false;
  for (let t = 16; t <= 3000; t += 16) {
    input = liveInput(input, t - lastTick);
    const r = stepScale(st, input, 16);
    st = r.state;
    crossedFromOneTick ||= r.events.some((e) => e.type === "crossing");
  }
  assert.equal(crossedFromOneTick, false, "an orphan tick decays instead of self-traveling");

  // The counterpart keeps the test honest: a *sustained* tick stream (fresh
  // ticks every 80ms, well inside the TTL) must still cross.
  let st2 = initialScaleState(4.45);
  let input2 = { zoomVel: 2.0, active: true };
  let lastTick2 = 0;
  let crossedFromStream = false;
  for (let t = 16; t <= 3000; t += 16) {
    if (t - lastTick2 >= 80) {
      lastTick2 = t;
      input2 = { zoomVel: 2.0, active: true };
    }
    input2 = liveInput(input2, t - lastTick2);
    const r = stepScale(st2, input2, 16);
    st2 = r.state;
    crossedFromStream ||= r.events.some((e) => e.type === "crossing");
    if (crossedFromStream) break;
  }
  assert.equal(crossedFromStream, true, "a sustained tick stream still travels");
}

// — Spectral register: small is high and quick, large is low and slow —
const micro = spectralRegisterFor(SCALE_MIN);
const cosmic = spectralRegisterFor(SCALE_MAX);
assert.ok(micro.baseHz > cosmic.baseHz * 20, "pitch falls with scale");
assert.ok(micro.lfoHz > cosmic.lfoHz * 20, "breath slows with scale");
assert.ok(micro.brightness > cosmic.brightness, "shimmer fades with scale");
assert.ok(cosmic.baseHz >= 20 && micro.baseHz <= 8000, "registers stay audible");

// — Route entry points —
assert.equal(bandAt(entryScaleFor("/stars")).id, "stars");
assert.equal(bandAt(entryScaleFor("/tide")).id, "coast");
assert.equal(entryScaleFor("/colophon"), null);

// — The travel graph follows part-of, not size-of —
// The author's law: a drop zooms out to the sea it belongs to, not to a
// garden that happens to be the next size up. These pins catch any future
// re-flattening of travel back to bare metric adjacency.
{
  const { travelNeighbor, resolveDestination, entryScaleInto } = loadTsModule("src/lib/scale.ts");

  assert.equal(travelNeighbor("drop", 1), "coast", "a drop returns to the sea");
  assert.equal(travelNeighbor("coast", -1), "drop", "the sea gives the drop back");
  assert.equal(travelNeighbor("flowers", 1), "earth", "the garden grows on the planet");
  assert.equal(travelNeighbor("flowers", -1), "cells", "a petal opens into cells");
  assert.equal(travelNeighbor("earth", -1), "atlas", "earth descends to the atlas by default");
  assert.equal(travelNeighbor("cells", 1), "drop", "cells rise into the drop by default");
  assert.equal(travelNeighbor("manifold", 1), null, "the axis ends above the manifold");

  // Return the way you came: earth remembers which child you rose from.
  const viaFlowers = resolveDestination("earth", -1, { earth: "flowers" });
  assert.equal(viaFlowers.id, "flowers", "entered from the garden, descend to the garden");
  const viaAtlas = resolveDestination("earth", -1, { earth: "atlas" });
  assert.equal(viaAtlas.id, "atlas", "entered from the atlas, descend to the atlas");
  // Memory in the wrong direction never hijacks travel.
  const wrongWay = resolveDestination("drop", -1, { drop: "coast" });
  assert.equal(wrongWay.id, "cells", "memory of an upward door cannot answer a downward push");

  // Round-trip law: wherever canonical travel takes you, remembering the
  // origin brings you home — no one-way doors anywhere on the axis.
  for (const band of SCALE_BANDS) {
    for (const dir of [1, -1]) {
      const dest = resolveDestination(band.id, dir, {});
      if (!dest) continue;
      const back = resolveDestination(dest.id, -dir, { [dest.id]: band.id });
      assert.equal(back.id, band.id, `${band.id} → ${dest.id} must return the way it came`);
      const landing = entryScaleInto(dest, dir);
      assert.equal(bandAt(landing).id, dest.id, `arrival into ${dest.id} lands inside it`);
    }
  }
}

// — Every band route must be a real page —
// The bug this catches shipped once: the atlas band routed to "/atlas", which
// has no page (only /atlas/[region]), so crossing the coast wall 404'd in
// production. Resolve each non-null band route against src/app, honoring
// dynamic [param] segments, and require a page file at the end.
{
  const { readdirSync, existsSync, statSync } = await import("node:fs");
  const appDir = fileURLToPath(new URL("src/app/", rootUrl));

  function resolvesToPage(route) {
    let dir = appDir;
    for (const seg of route.split("/").filter(Boolean)) {
      const exact = `${dir}${seg}/`;
      if (existsSync(exact) && statSync(exact).isDirectory()) {
        dir = exact;
        continue;
      }
      const dynamic = readdirSync(dir).find(
        (d) => d.startsWith("[") && d.endsWith("]") && statSync(dir + d).isDirectory(),
      );
      if (!dynamic) return false;
      dir = `${dir}${dynamic}/`;
    }
    return existsSync(`${dir}page.tsx`) || existsSync(`${dir}page.ts`);
  }

  for (const band of SCALE_BANDS) {
    if (band.route === null) continue;
    assert.ok(
      resolvesToPage(band.route),
      `band "${band.id}" routes to ${band.route}, which is not a page — travel there would 404`,
    );
  }
  // Keep the checker honest: it must reject a route that truly has no page.
  assert.equal(resolvesToPage("/atlas"), false, "bare /atlas has no page and must fail");
  assert.equal(resolvesToPage("/no-such-room"), false);
}

// — Room band adapters: internal zoom ↔ manifold position —
// Monotone and order-reversing (zooming in must move DOWN the axis — the
// bug this catches is an inverted mapping, which would send /stars to
// /earth when the hand asked for /beyond), and never outside the band.
for (const spec of [STARS_ZOOM_SPEC, ATLAS_ZOOM_SPEC]) {
  const band = SCALE_BANDS.find((b) => b.id === spec.band);
  let prev = Infinity;
  for (let i = 0; i <= 16; i++) {
    const z = spec.zoomMin * Math.pow(spec.zoomMax / spec.zoomMin, i / 16);
    const s = scaleForRoomZoom(spec, z);
    assert.equal(bandAt(s).id, spec.band, `${spec.band}: zoom ${z} maps into its own band`);
    assert.ok(s < prev, `${spec.band}: zoom ${z} keeps the map order-reversing`);
    prev = s;
  }
  // The extremes must land flush on the walls; a center landing would mean
  // residual pinch never reaches wall contact and travel silently dies.
  assert.ok(
    band.sMax - scaleForRoomZoom(spec, spec.zoomMin) < 1e-3,
    `${spec.band}: widest view sits at the band ceiling`,
  );
  assert.ok(
    scaleForRoomZoom(spec, spec.zoomMax) - band.sMin < 1e-3,
    `${spec.band}: tightest view sits on the band floor`,
  );
}

// — No wall engagement strictly inside the internal range, and never for
//   motion headed back INTO the room from an extreme —
for (const spec of [STARS_ZOOM_SPEC, ATLAS_ZOOM_SPEC]) {
  const zMid = Math.sqrt(spec.zoomMin * spec.zoomMax);
  assert.equal(residualScaleInput(spec, zMid, 4).active, false, `${spec.band}: interior zoom-in is the room's`);
  assert.equal(residualScaleInput(spec, zMid, -4).active, false, `${spec.band}: interior zoom-out is the room's`);
  const nearTight = spec.zoomMax - (spec.zoomMax - spec.zoomMin) * 0.01;
  const nearWide = spec.zoomMin + (spec.zoomMax - spec.zoomMin) * 0.01;
  assert.equal(residualScaleInput(spec, nearTight, 4).active, false, `${spec.band}: one step shy of tightest is still interior`);
  assert.equal(residualScaleInput(spec, nearWide, -4).active, false, `${spec.band}: one step shy of widest is still interior`);
  assert.equal(residualScaleInput(spec, spec.zoomMin, 4).active, false, `${spec.band}: zooming in from widest is the room's move`);
  assert.equal(residualScaleInput(spec, spec.zoomMax, -4).active, false, `${spec.band}: zooming out from tightest is the room's move`);
}

// — Neighbor directions at the extremes, through the real physics —
// Drive residual input into stepScale from the mapped extreme and observe
// which band the crossing lands in. This is the direction table the rooms
// rely on; a sign slip anywhere in the chain fails here.
function wallCrossing(spec, zoom, zoomInVel) {
  const input = residualScaleInput(spec, zoom, zoomInVel);
  assert.equal(input.active, true, `${spec.band}: overflow at a held extreme engages the wall`);
  let st = initialScaleState(scaleForRoomZoom(spec, zoom));
  let elapsed = 0;
  for (let i = 0; i < 200; i++) {
    const r = stepScale(st, input, 16);
    st = r.state;
    elapsed += 16;
    for (const e of r.events) {
      if (e.type === "crossing") return { to: e.to, elapsed };
    }
  }
  return null;
}

const starsOut = wallCrossing(STARS_ZOOM_SPEC, STARS_ZOOM_SPEC.zoomMin, -2);
assert.equal(starsOut?.to, "beyond", "stars: pinching in at the widest field travels toward beyond");
const starsIn = wallCrossing(STARS_ZOOM_SPEC, STARS_ZOOM_SPEC.zoomMax, 2);
assert.equal(starsIn?.to, "earth", "stars: pinching out at the tightest field travels toward earth");
const atlasOut = wallCrossing(ATLAS_ZOOM_SPEC, ATLAS_ZOOM_SPEC.zoomMin, -2);
assert.equal(atlasOut?.to, "earth", "atlas: pinching in at the widest chart travels toward earth");
const atlasIn = wallCrossing(ATLAS_ZOOM_SPEC, ATLAS_ZOOM_SPEC.zoomMax, 2);
assert.equal(atlasIn?.to, "coast", "atlas: pinching out at the deepest detail travels toward the coast");
// The adapters reuse the one integrator: travel still costs sustained intent.
assert.ok(starsOut.elapsed >= TRAVEL_INTENT_MS, "adapter walls keep the sustained-intent price");
assert.ok(atlasIn.elapsed >= TRAVEL_INTENT_MS, "adapter walls keep the sustained-intent price");

console.log("scale manifold tests passed");
