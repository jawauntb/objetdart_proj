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
  // Same realm as the test: vm.runInNewContext builds arrays, objects and
  // strings on a foreign prototype chain, so deepStrictEqual rejects them
  // against host literals of identical content.
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const {
  SCALE_BANDS,
  SCALE_MIN,
  SCALE_MAX,
  STEP_BACK_DECADES,
  TRAVEL_INTENT_MS,
  DOOR_ROOMS,
  LATERAL_ROUTE_BANDS,
  ROUTE_TRAVEL_OVERRIDES,
  stepBackVelocity,
  bandAt,
  bandBlend,
  doorMemoryFor,
  initialScaleState,
  liveInput,
  stepScale,
  scaleBandIdForRoute,
  spectralRegisterFor,
  entryScaleFor,
  scaleForRoomZoom,
  residualScaleInput,
  travelOptions,
  travelOptionsForRoute,
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
assert.equal(bandAt(-20).id, "quanta");
assert.equal(bandAt(-19).id, "quarks", "boundary belongs to the upper band");
assert.equal(bandAt(-14).id, "atoms", "boundary belongs to the upper band");
assert.equal(bandAt(2).id, "birds");
assert.equal(bandAt(2.8).id, "coast");
assert.equal(bandAt(-8.5).id, "organics");
assert.equal(bandAt(-5).id, "cells");
// The sky re-cut, pinned by physics rather than by restating spans: the air
// column (~100 km) is atmosphere, not atlas; a chart sheet (~1000 km) is
// atlas; Mercury's orbit (5.8e10 m) is the planetary neighbourhood;
// Neptune's (4.5e12 m) is the system; the nearest star (4e16 m) is
// interstellar; the galactic disc read from ~2e19 m is the galaxy; the web
// keeps the top. The bug each line catches: a boundary cut on the wrong
// side of the thing the band is named for.
assert.equal(bandAt(5).id, "atmosphere");
assert.equal(bandAt(6).id, "atlas");
assert.equal(bandAt(Math.log10(5.8e10)).id, "planets");
assert.equal(bandAt(Math.log10(4.5e12)).id, "solar");
assert.equal(bandAt(Math.log10(4e16)).id, "stars");
assert.equal(bandAt(Math.log10(2e19)).id, "galaxy");
assert.equal(bandAt(21).id, "space");
assert.equal(bandAt(999).id, "manifold");
assert.equal(bandAt(-999).id, "quanta");

// — bandBlend: pure in the interior, symmetric crossfade near a wall —
const mid = bandBlend(6.0);
assert.equal(mid.t, 0, "band center has no secondary");
const nearWall = bandBlend(4.5 + 0.05);
assert.equal(nearWall.primary, "atmosphere");
assert.equal(nearWall.secondary, "olympus");
assert.ok(nearWall.t > 0.35 && nearWall.t <= 0.5, `blend ramps toward 0.5 at wall (got ${nearWall.t})`);

// — Local zoom: a brief pinch cannot cross a band wall —
let st = initialScaleState(6.0);
let crossed = false;
for (let i = 0; i < 20; i++) {
  const r = stepScale(st, { zoomVel: 2.5, active: true }, 16);
  st = r.state;
  crossed ||= r.events.some((e) => e.type === "crossing");
}
// 20 frames ≈ 320ms of travel-speed pinch from band center: reaches the wall
// but must not break through without sustained intent *at* the wall.
assert.equal(crossed, false, "no accidental crossing on a short pinch");
assert.ok(st.s < 6.5, "s held inside the band");

// — A detent fires on first wall contact —
let detent = false;
let st2 = initialScaleState(6.4);
for (let i = 0; i < 15; i++) {
  const r = stepScale(st2, { zoomVel: 2.0, active: true }, 16);
  st2 = r.state;
  detent ||= r.events.some((e) => e.type === "detent");
}
assert.equal(detent, true, "wall contact emits detent");

// — Sustained push crosses, once, into the neighbor —
let st3 = initialScaleState(6.45);
const crossings = [];
for (let i = 0; i < 80; i++) {
  const r = stepScale(st3, { zoomVel: 2.0, active: true }, 16);
  st3 = r.state;
  for (const e of r.events) if (e.type === "crossing") crossings.push(e);
  if (crossings.length) break;
}
assert.equal(crossings.length, 1, "sustained push crosses");
assert.equal(crossings[0].from, "atlas");
assert.equal(crossings[0].to, "earth");
assert.ok(st3.s > 6.5, "landed inside the neighbor");

// — Releasing at the wall lets intent decay: no delayed crossing —
let st4 = initialScaleState(6.45);
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
  let st = initialScaleState(6.45);
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
  let st2 = initialScaleState(6.45);
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
  assert.equal(travelNeighbor("flowers", 1), "earth", "the garden grows from the ground");
  assert.equal(travelNeighbor("flowers", -1), "tissue", "a petal is tissue before it is one cell");
  assert.equal(travelNeighbor("tissue", 1), "flowers", "a sheet belongs to what it is a sheet of");
  assert.equal(travelNeighbor("earth", 1), "atlas", "the ground lies on the map");
  assert.equal(travelNeighbor("earth", -1), "flowers", "the ground opens onto flowers");
  assert.equal(travelNeighbor("atlas", 1), "stars", "the map recedes into the sky");
  assert.equal(travelNeighbor("atlas", -1), "atmosphere", "the map descends into the air column");
  assert.equal(travelNeighbor("olympus", -1), "coast", "the peak descends through fog to the sea");
  assert.equal(travelNeighbor("olympus", 1), "atmosphere", "the peak rises into the air");
  assert.equal(travelNeighbor("stars", -1), "atlas", "the sky descends onto the map");
  assert.equal(travelNeighbor("manifold", 1), null, "the axis ends above the manifold");
  assert.equal(travelNeighbor("manifold", -1), "space", "the fold descends into the web");
  // The upper axis is metric-monotone after the sky re-cut: no override
  // anywhere from the ground to the web — each of these is plain adjacency,
  // and an override sneaking back in (the old inverted galaxy door) fails here.
  assert.equal(travelNeighbor("earth", 1), "atlas", "the ground still lies on the map");
  assert.equal(travelNeighbor("planets", 1), "solar", "the neighbourhood joins the system");
  assert.equal(travelNeighbor("planets", -1), "earth", "the neighbourhood holds the earth");
  assert.equal(travelNeighbor("solar", 1), "stars", "the system is one star among the vault");
  assert.equal(travelNeighbor("stars", 1), "galaxy", "the vault streams into the arm");
  assert.equal(travelNeighbor("galaxy", 1), "space", "the galaxy is one node of the web");
  assert.equal(travelNeighbor("galaxy", -1), "stars", "the arm resolves back into stars");
  assert.equal(travelNeighbor("space", 1), "manifold", "the web opens onto the fold");
  // /beyond is a branch: entered from it, the manifold sends you back there.
  const viaBeyond = resolveDestination("manifold", -1, { manifold: "beyond" });
  assert.equal(viaBeyond.id, "beyond", "the beyond receives its own returns");
  assert.equal(travelNeighbor("beyond", 1), "manifold", "beyond still opens upward");
  assert.equal(travelNeighbor("beyond", -1), "space", "beyond descends into the web");

  // The life ladder: part-of and smaller-than agree the whole way down, so
  // every rung is plain metric adjacency. A future override that re-routes
  // any of these has broken the one clean chain on the axis.
  const ladder = ["flowers", "tissue", "cells", "organelles", "dna", "organics", "molecules", "atoms"];
  for (let i = 1; i < ladder.length; i++) {
    assert.equal(travelNeighbor(ladder[i - 1], -1), ladder[i], `${ladder[i - 1]} opens into ${ladder[i]}`);
    assert.equal(travelNeighbor(ladder[i], 1), ladder[i - 1], `${ladder[i]} belongs to ${ladder[i - 1]}`);
  }
  // The flock's neighbours are the garden below and the shore above — no
  // override needed, which is the evidence the band was placed right.
  assert.equal(travelNeighbor("birds", -1), "flowers", "the flock lands in the garden");
  assert.equal(travelNeighbor("birds", 1), "coast", "the flock carries out to the shore");

  // Return the way you came, across the semantic doors.
  const backToGround = resolveDestination("atlas", -1, { atlas: "earth" });
  assert.equal(backToGround.id, "earth", "risen from the ground, the map returns you to it");
  const backToGarden = resolveDestination("earth", -1, { earth: "flowers" });
  assert.equal(backToGarden.id, "flowers", "entered from the garden, descend to the garden");
  // Memory that names a band that is not a door in that direction never hijacks travel.
  const wrongWay = resolveDestination("drop", -1, { drop: "coast" });
  assert.equal(wrongWay.id, "tissue", "memory of an upward door cannot answer a downward push");

  // Forks offer every built door, resolved-first — this is how a hand
  // reaches a branch for the first time (press, release, press again).
  const { travelOptions } = loadTsModule("src/lib/scale.ts");
  assert.deepEqual(
    Array.from(travelOptions("atlas", -1, {}), (b) => b.id),
    ["olympus", "earth"],
    "the map opens inward onto the peak first, then the ground",
  );
  assert.deepEqual(
    Array.from(travelOptions("atlas", -1, { atlas: "earth" }), (b) => b.id),
    ["earth", "olympus"],
    "memory reorders the offer, never removes a door",
  );
  assert.deepEqual(
    Array.from(travelOptions("flowers", -1, {}), (b) => b.id),
    ["tissue", "drop"],
    "a petal opens into the sheet it is made of, and dew gathers on it too",
  );
  assert.deepEqual(
    Array.from(travelOptions("drop", 1, {}), (b) => b.id),
    ["coast", "flowers"],
    "a drop rises to the sea, or to the petal it sat on",
  );
  assert.deepEqual(
    Array.from(travelOptions("manifold", -1, {}), (b) => b.id),
    ["space", "beyond"],
    "the fold offers the web first, then the beyond",
  );
  assert.deepEqual(
    Array.from(travelOptions("stars", 1, {}), (b) => b.id),
    ["galaxy"],
    "the sky thins upward into the arms — /galaxy is built now",
  );
  assert.deepEqual(
    Array.from(travelOptions("earth", 1, {}), (b) => b.id),
    ["atlas", "stars"],
    "the ground rises onto the map, or through the unbuilt neighbourhoods into the sky",
  );
  assert.deepEqual(
    Array.from(travelOptions("stars", -1, {}), (b) => b.id),
    ["atlas", "earth"],
    "the sky descends onto the map first, or walks the unbuilt system down to the ground",
  );
  assert.deepEqual(
    Array.from(travelOptions("cells", 1, {}), (b) => b.id),
    ["tissue"],
    "the plasm rises into the sheet it belongs to",
  );

  // An unbuilt band is transparent, never a wall. This is the law that lets
  // the axis be re-cut ahead of its rooms: every door that worked before the
  // life ladder and the vistas were declared must still work now, resolving
  // through the routeless addresses to the nearest built room.
  for (const [from, dir, expected] of [
    ["atlas", -1, "olympus"], // peak is built
    ["coast", 1, "olympus"], // peak stands above the fog
    ["flowers", -1, "tissue"], // /tissue is built now: the walk is one rung
  ]) {
    const opts = travelOptions(from, dir, {});
    assert.ok(opts.length > 0, `${from} must keep a door in direction ${dir}`);
    assert.equal(opts[0].id, expected, `${from} resolves through unbuilt bands to ${expected}`);
  }
  assert.deepEqual(
    Array.from(travelOptions("coast", 1, {}), (b) => b.id),
    ["olympus", "earth"],
    "the shore rises to the peak, and opens laterally onto the land",
  );
  assert.deepEqual(
    Array.from(travelOptions("earth", -1, {}), (b) => b.id),
    ["flowers", "coast", "olympus"],
    "the ground opens onto the garden, the beach, and the mountain",
  );
  assert.equal(bandAt(entryScaleFor("/ocean")).id, "coast");
  assert.equal(bandAt(entryScaleFor("/coast")).id, "coast");
  assert.equal(bandAt(entryScaleFor("/seed")).id, "drop");
  assert.equal(bandAt(entryScaleFor("/clouds")).id, "olympus");
  assert.equal(bandAt(entryScaleFor("/mountain")).id, "olympus");
  assert.equal(bandAt(entryScaleFor("/birds")).id, "birds");
  for (const band of SCALE_BANDS) {
    for (const dir of [1, -1]) {
      for (const opt of travelOptions(band.id, dir, {})) {
        assert.ok(opt.route, `offered door ${band.id}→${opt.id} must be built`);
      }
    }
  }

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

// — Per-route doors: rooms sharing one band open onto different worlds —
// The band grain can only say "the drop's span goes to tissue"; the route
// grain lets a drop sink into the plasm while a rock on the same span
// cleaves into molecules. Each assertion names the bug it catches.
{
  // Array.from, not .map: the module is loaded in its own realm, so an
  // array it built is not deepStrictEqual to a literal here however equal
  // its contents. Every other comparison in this file normalises the same
  // way — this helper was the one that did not.
  const routes = (dir, route, mem = {}) =>
    Array.from(travelOptionsForRoute(route, dir, mem), (d) => d.route);

  // A route override beats its band's door — the bug: the route layer
  // declared but never consulted, every drop-band room still falling to tissue.
  assert.equal(routes(-1, "/drop")[0], "/cells", "a drop magnifies the plasm swimming in it");
  assert.equal(
    travelOptions("drop", -1, {})[0].id,
    "tissue",
    "…while the band grain keeps its default, unchanged for old callers",
  );

  // Two rooms on one band resolve to different destinations — the bug: door
  // resolution collapsing to the band, making every sibling one room.
  assert.equal(routes(-1, "/seed")[0], "/tissue", "a seed, no override, keeps the band default");
  assert.equal(routes(-1, "/soil")[0], "/cells", "soil crumbles into the living plasm");
  assert.equal(routes(-1, "/rocks")[0], "/molecules", "rock cleaves into its lattice");

  // The ground's downward fork: garden first, then the strata. /rocks has
  // shipped, so it now answers as itself; /soil is still an address without
  // a page and resolves through to the built room of its band — the drop —
  // never to a 404 and never to a dead wall. When /soil lands too this
  // becomes ["/flowers", "/rocks", "/soil"].
  const earthDown = routes(-1, "/earth");
  assert.equal(earthDown[0], "/flowers", "the ground's first door down is still the garden");
  assert.deepEqual(
    earthDown,
    ["/flowers", "/rocks", "/drop"],
    "a built stratum answers as itself; an unbuilt one walks through rather than walling",
  );

  // The strata's own walls (travel FROM an address whose page is unbuilt
  // still resolves, so the rooms are playable the moment they ship).
  assert.deepEqual(routes(1, "/soil"), ["/earth", "/flowers"], "soil returns to the ground or the garden");
  assert.deepEqual(routes(1, "/rocks"), ["/earth", "/mountain"], "rock returns to the ground or rises as the peak");

  // The peak's downward fork and the shore's doors.
  assert.deepEqual(
    routes(-1, "/mountain"),
    ["/coast", "/rocks", "/birds"],
    "the peak descends to the shore, the rock it stands on, the flock",
  );
  assert.deepEqual(routes(-1, "/coast"), ["/drop", "/birds"], "the shore gives the drop back, and opens onto the flock");
  assert.deepEqual(routes(1, "/coast"), ["/mountain", "/earth"], "the shore keeps its peak and its land");

  // Tissue stays reachable: the petal still opens into its sheet.
  assert.deepEqual(routes(-1, "/flowers"), ["/tissue", "/drop"], "a petal opens into the sheet it is made of");

  // A route with no override is transparent to the layer entirely — the
  // bug: the route grain swallowing band doors for innocent laterals.
  assert.deepEqual(
    routes(1, "/tide"),
    Array.from(travelOptions("coast", 1, {}), (b) => b.route),
    "an unoverridden lateral walks through to its band's wall",
  );

  // Return the way you came, at the route grain. The coast→earth lateral
  // must survive the ground's wall now forking elsewhere; a door-room
  // memory must resolve through its unbuilt address; travel that resolved
  // THROUGH an unbuilt band must still round-trip.
  assert.equal(
    routes(-1, "/earth", { earth: "coast" })[0],
    "/coast",
    "band-grain memory reopens a door the route wall no longer offers unprompted",
  );
  assert.equal(
    routes(1, "/cells", { cells: "/soil" })[0],
    "/drop",
    "a door-room memory resolves through its unbuilt address (flips to /soil when it lands)",
  );
  assert.equal(
    routes(1, "/earth", { earth: "stars" })[0],
    "/stars",
    "travel that resolved through the unbuilt system still returns to the sky",
  );
  assert.deepEqual(
    routes(1, "/cells"),
    ["/tissue", "/drop"],
    "the plasm rises into its sheet, or back into the drop that held it",
  );

  // Round-trip law at the route grain: every door offered from every
  // overridden route must answer — from where it lands, remembering the
  // origin, the first door back is the origin room (or, while the origin
  // is an address without a page, a room of the origin's band). The bug:
  // a one-way door that strands the hand after one pinch.
  for (const origin of Object.keys(ROUTE_TRAVEL_OVERRIDES)) {
    for (const dir of [1, -1]) {
      for (const door of travelOptionsForRoute(origin, dir, {})) {
        const mem = { [door.band.id]: doorMemoryFor(origin) };
        const back = travelOptionsForRoute(door.route, -dir, mem);
        assert.ok(back.length > 0, `${origin} → ${door.route}: the return wall must hold a door`);
        const originRoom = DOOR_ROOMS.find((d) => d.prefix === origin);
        if (originRoom && !originRoom.route) {
          assert.equal(
            back[0].band.id,
            scaleBandIdForRoute(origin),
            `${origin} → ${door.route} must return to the origin's band while unbuilt`,
          );
        } else {
          assert.equal(
            back[0].route,
            origin,
            `${origin} → ${door.route} must return the way it came`,
          );
        }
      }
    }
  }

  // Door rooms and lateral bands must agree on where a room lives — drift
  // would give the door and the room itself two different scale addresses.
  for (const d of DOOR_ROOMS) {
    const lateral = LATERAL_ROUTE_BANDS.find((l) => l.prefix === d.prefix);
    assert.ok(lateral, `${d.prefix} must have a LATERAL_ROUTE_BANDS entry`);
    assert.equal(lateral.band, d.band, `${d.prefix}: door room and lateral must share a band`);
  }
  assert.equal(bandAt(entryScaleFor("/rocks")).id, "drop", "the strata take the drop's address");
  assert.equal(bandAt(entryScaleFor("/soil")).id, "drop", "a handful of soil is the drop's size");
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

  // The guard, extended to the route grain: every door offered from every
  // addressed route (band primaries, laterals, built door rooms), in both
  // directions, must land on a real page. This is the 404 bug's second
  // chance to ship — an unbuilt door room forgetting to resolve through,
  // or a route override naming a room that never existed, fails here.
  const addressedRoutes = [
    ...SCALE_BANDS.filter((b) => b.route).map((b) => b.route),
    ...LATERAL_ROUTE_BANDS.map((l) => l.prefix),
    ...DOOR_ROOMS.filter((d) => d.route).map((d) => d.route),
  ];
  for (const route of addressedRoutes) {
    for (const dir of [1, -1]) {
      for (const door of travelOptionsForRoute(route, dir, {})) {
        assert.ok(
          resolvesToPage(door.route),
          `door ${route} →(${dir}) ${door.route} is not a page — travel there would 404`,
        );
      }
    }
  }
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

// stepScale's crossing events name the METRIC neighbor; the door actually
// taken is travelOptions', asserted in the travel-graph block above.
const starsOut = wallCrossing(STARS_ZOOM_SPEC, STARS_ZOOM_SPEC.zoomMin, -2);
assert.equal(starsOut?.to, "galaxy", "stars: pinching in at the widest field presses the galaxy wall");
const starsIn = wallCrossing(STARS_ZOOM_SPEC, STARS_ZOOM_SPEC.zoomMax, 2);
assert.equal(starsIn?.to, "solar", "stars: pinching out at the tightest field presses the system wall");
const atlasOut = wallCrossing(ATLAS_ZOOM_SPEC, ATLAS_ZOOM_SPEC.zoomMin, -2);
assert.equal(atlasOut?.to, "earth", "atlas: pinching in at the widest chart travels toward earth");
const atlasIn = wallCrossing(ATLAS_ZOOM_SPEC, ATLAS_ZOOM_SPEC.zoomMax, 2);
assert.equal(atlasIn?.to, "atmosphere", "atlas: pinching out at the deepest detail presses the air wall");
// The adapters reuse the one integrator: travel still costs sustained intent.
assert.ok(starsOut.elapsed >= TRAVEL_INTENT_MS, "adapter walls keep the sustained-intent price");
assert.ok(atlasIn.elapsed >= TRAVEL_INTENT_MS, "adapter walls keep the sustained-intent price");

// — Step back (two-finger tap): a nudge toward larger scales that can
// approach but never touch the wall — no detent, no crossing, from any s —
{
  const idle = { zoomVel: 0, active: false };
  const runOut = (s0) => {
    let state = { ...initialScaleState(s0), v: stepBackVelocity(s0) };
    const seen = [];
    for (let t = 0; t < 2000; t += 16) {
      const r = stepScale(state, idle, 16);
      state = r.state;
      seen.push(...r.events);
    }
    return { state, seen };
  };
  for (const band of SCALE_BANDS) {
    const mid = (band.sMin + band.sMax) / 2;
    const nearCeiling = band.sMax - 0.05;
    for (const s0 of [band.sMin + 0.01, mid, nearCeiling]) {
      const { state, seen } = runOut(s0);
      assert.equal(seen.length, 0, `${band.id}: step back from ${s0} never wakes the wall`);
      assert.equal(bandAt(state.s).id, band.id, `${band.id}: step back stays inside the band`);
      assert.ok(state.s < band.sMax, `${band.id}: step back never reaches the ceiling`);
      assert.ok(state.s >= s0, `${band.id}: step back never moves toward smaller scales`);
    }
    // Away from the ceiling the nudge really retreats — by the full step where
    // the band is wide enough to hold one, and by whatever headroom remains
    // where it is not. The life ladder's rungs are genuinely close together
    // (six bands across six decades of real sizes), so the narrow-band case is
    // the common one, not an edge case: assert the clamped law, which still
    // fails if the step ever dies or overshoots into the peek margin.
    const { state } = runOut(mid);
    const headroom = Math.max(0, band.sMax - 0.18 /* EDGE_PEEK */ - mid);
    const expected = Math.min(STEP_BACK_DECADES, headroom);
    assert.ok(expected > 0, `${band.id}: a band must be wide enough to step back inside`);
    assert.ok(
      state.s > mid + expected * 0.8,
      `${band.id}: the step lands (≈${expected.toFixed(2)} decades of ${STEP_BACK_DECADES})`,
    );
    // Pressed against the peek margin there is no headroom left: it holds.
    assert.equal(stepBackVelocity(band.sMax - 1e-4), 0, `${band.id}: at the wall the step yields nothing`);
  }
}

console.log("scale manifold tests passed");
