import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-rooftop — the pure-math half of the rooftop clutter pack.
 *
 * The Three.js path (four InstancedMeshes, geometry allocations, matrix
 * writes into instanceMatrix buffers) is exercised by the browser mount
 * itself — stubbing it in node would only pin the shape of the stub.
 *
 * What we CAN pin here:
 *   - the piece-count ladder (event 3..6, store 1..3)
 *   - determinism per seed
 *   - piece distribution across all four part types (no part starves)
 *   - the roofY fraction shape (stores at ~1, events at ~0.5..0.7)
 *   - every piece stays inside the host footprint
 *   - events guarantee at least one elevator penthouse
 *   - stores NEVER produce a penthouse (an SF corner store with a full
 *     elevator machine room reads wrong)
 *   - part baseline sizes are sane (penthouse largest, vent thinnest)
 *
 * A regression that let piece counts drift (e.g. events emitting 12
 * pieces) would blow past the maxInstancesPerPart bound; the test
 * pins the caps here so the geometry allocator downstream is safe.
 */

const threeStub = {
  Vector3: class { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} },
  Quaternion: class { setFromAxisAngle() {} },
  Matrix4: class { compose() { return this; } },
  BoxGeometry: class { translate() {} dispose() {} },
  CylinderGeometry: class { translate() {} dispose() {} },
  MeshStandardMaterial: class { dispose() {} },
  Group: class { constructor(){ this.name=""; this.children=[]; }
    add(x){ this.children.push(x); }
    remove(x){ const i=this.children.indexOf(x); if(i>=0) this.children.splice(i,1); } },
  InstancedMesh: class { constructor(){
      this.instanceMatrix={ setUsage(){}, needsUpdate:false };
      this.castShadow=false; this.receiveShadow=false; this.count=0; this.name="";
      this.parent=null;
    }
    setMatrixAt(){} },
  DynamicDrawUsage: 35048,
};

const mod = loadTsModule("src/lib/city-rooftop.ts", {
  requireMap: { three: threeStub },
});

const {
  ROOFTOP_PARTS,
  ROOFTOP_PART_SIZE,
  clutterCountFor,
  roofYFractionFor,
  rooftopPiecesFor,
  createRooftopScene,
} = mod;

// ── ROOFTOP_PARTS is exactly the four named parts ────────────────────────
// The brief names four part types; a regression that dropped one would
// leave a rooftop missing a whole category of clutter (imagine an SF
// tower without any water tank — the eye reads the absence).
assert.deepEqual(
  [...ROOFTOP_PARTS].sort(),
  ["ac", "penthouse", "vent", "water"],
  "ROOFTOP_PARTS is exactly ac / water / penthouse / vent",
);

// ── clutterCountFor: determinism + range per role ────────────────────────
// The whole scene budget rests on these two ranges. Stores are 1..3 (a
// small corner store's roof doesn't fit six pieces); events are 3..6 (a
// tower's mechanical roof is a jungle). A regression that lifted the
// ceiling would silently blow past the maxInstancesPerPart bound in
// city-geometry.

assert.equal(clutterCountFor("store", 7), clutterCountFor("store", 7), "clutterCountFor pure");
assert.equal(clutterCountFor("event", 7), clutterCountFor("event", 7), "clutterCountFor pure");
{
  const counts = { store: new Array(10).fill(0), event: new Array(10).fill(0) };
  let sMin = 999, sMax = -1, eMin = 999, eMax = -1;
  for (let s = 0; s < 400; s += 1) {
    const seed = s * 191 + 5;
    const sc = clutterCountFor("store", seed);
    const ec = clutterCountFor("event", seed);
    counts.store[sc] = (counts.store[sc] ?? 0) + 1;
    counts.event[ec] = (counts.event[ec] ?? 0) + 1;
    if (sc < sMin) sMin = sc; if (sc > sMax) sMax = sc;
    if (ec < eMin) eMin = ec; if (ec > eMax) eMax = ec;
  }
  assert.equal(sMin, 1, "store minimum is 1 — every store gets at least one piece");
  assert.equal(sMax, 3, "store maximum is 3 — never blow past three pieces");
  assert.equal(eMin, 3, "event minimum is 3 — every event tower is busy");
  assert.equal(eMax, 6, "event maximum is 6 — never blow past six pieces");
  // Each bucket in the range must be hit.
  for (let k = 1; k <= 3; k += 1) {
    assert.ok(counts.store[k] > 20, `store count ${k} gets some hits (got ${counts.store[k]})`);
  }
  for (let k = 3; k <= 6; k += 1) {
    assert.ok(counts.event[k] > 20, `event count ${k} gets some hits (got ${counts.event[k]})`);
  }
}

// ── roofYFractionFor: stores land at the top of the box, events below ──
// Stores are flat lids at y≈1.0 (parapet just above). Events place
// clutter BELOW the crown (below the Gherkin's swell, below the
// Salesforce ellipsoid, on the Transamerica wings). If any event
// fraction ever exceeded ~0.9 the clutter would poke through the tower's
// visible crown — the pyramid or the ellipsoid — and read as a bug.

const yStore = roofYFractionFor("store");
assert.ok(yStore >= 1.0 && yStore <= 1.1, `store roof fraction sits at top of box (got ${yStore})`);
for (const v of [0, 1, 2]) {
  const y = roofYFractionFor("event", v);
  assert.ok(y > 0.3 && y < 0.9, `event variant ${v} clutter sits mid-height (got ${y})`);
}
// The three event variants have DIFFERENT roof fractions — a regression
// to a single value would put Gherkin and Salesforce clutter at the
// same relative height, defeating the per-variant tuning.
{
  const ys = new Set([roofYFractionFor("event", 0), roofYFractionFor("event", 1), roofYFractionFor("event", 2)]);
  assert.ok(ys.size >= 2, "at least two event variants place clutter at different fractions");
}

// ── rooftopPiecesFor: determinism, count matches clutterCountFor ────────
// Same seed and footprint must produce the same piece list; a slot in
// the list at index i has the same (part, ox, oz, yaw, scale) across
// two calls. Otherwise the settlement's rooftops would drift between
// rebuilds and no session would agree with another.

{
  const a = rooftopPiecesFor("event", 4242, 6, 6, 1);
  const b = rooftopPiecesFor("event", 4242, 6, 6, 1);
  assert.equal(a.length, b.length, "same seed produces same length");
  for (let i = 0; i < a.length; i += 1) {
    assert.equal(a[i].part, b[i].part, `piece ${i} part matches`);
    assert.equal(a[i].ox, b[i].ox, `piece ${i} ox matches`);
    assert.equal(a[i].oz, b[i].oz, `piece ${i} oz matches`);
    assert.equal(a[i].yaw, b[i].yaw, `piece ${i} yaw matches`);
    assert.equal(a[i].scale, b[i].scale, `piece ${i} scale matches`);
  }
  assert.equal(a.length, clutterCountFor("event", 4242),
    "piece count matches clutterCountFor");
}

// ── pieces stay INSIDE the footprint ────────────────────────────────────
// A piece whose ox extended past sx/2 would poke over the parapet and
// float over the sidewalk below. The module keeps every piece inside
// the inner ~62% of the footprint; the test enforces the inner box.

for (let s = 0; s < 200; s += 1) {
  const seed = s * 233 + 11;
  const sx = 5 + (s % 4);
  const sz = 5 + ((s + 2) % 4);
  const pieces = rooftopPiecesFor("event", seed, sx, sz, s % 3);
  for (const p of pieces) {
    assert.ok(Math.abs(p.ox) <= sx * 0.5, `event piece ox stays inside sx (got ${p.ox} for sx ${sx})`);
    assert.ok(Math.abs(p.oz) <= sz * 0.5, `event piece oz stays inside sz (got ${p.oz} for sz ${sz})`);
    assert.ok(p.scale > 0.5 && p.scale < 1.5, `piece scale within sane bounds (got ${p.scale})`);
  }
}

// ── every event tower carries at least one elevator penthouse ───────────
// The mechanical penthouse is the boxy silhouette that reads "real
// building" against a glass shaft. A regression that turned it into an
// optional part would leave some events with only ACs and vents — the
// tower would read as a plastic prop again.

for (let s = 0; s < 200; s += 1) {
  const seed = s * 281 + 3;
  const pieces = rooftopPiecesFor("event", seed, 6, 6, s % 3);
  const hasPenthouse = pieces.some(p => p.part === "penthouse");
  assert.ok(hasPenthouse, `event seed ${seed} has at least one penthouse`);
}

// ── stores NEVER carry a penthouse ──────────────────────────────────────
// A corner store getting a full elevator machine room reads as a bug.
// Stores are limited to ac / water / vent. A regression that widened
// the store part pool would fire here.

for (let s = 0; s < 200; s += 1) {
  const seed = s * 331 + 7;
  const pieces = rooftopPiecesFor("store", seed, 4, 4);
  for (const p of pieces) {
    assert.notEqual(p.part, "penthouse",
      `store seed ${seed} must not carry a penthouse (got ${p.part})`);
    assert.ok(["ac", "water", "vent"].includes(p.part),
      `store parts limited to ac/water/vent (got ${p.part})`);
  }
}

// ── part distribution across many seeds ─────────────────────────────────
// Every part must be hit by at least one plot in a large seed sweep, or
// the settlement would look monotonous. The event pool covers all four;
// the store pool covers three.

{
  const eventHits = new Set();
  const storeHits = new Set();
  for (let s = 0; s < 400; s += 1) {
    const seed = s * 419 + 13;
    for (const p of rooftopPiecesFor("event", seed, 6, 6, s % 3)) eventHits.add(p.part);
    for (const p of rooftopPiecesFor("store", seed, 4, 4)) storeHits.add(p.part);
  }
  for (const part of ROOFTOP_PARTS) {
    assert.ok(eventHits.has(part), `event pool covers ${part} across seeds`);
  }
  for (const part of ["ac", "water", "vent"]) {
    assert.ok(storeHits.has(part), `store pool covers ${part} across seeds`);
  }
}

// ── baseline part sizes are sane and distinct ───────────────────────────
// Penthouse is the largest (it's a room-sized box); vent is the thinnest
// (it's a pipe). A regression that swapped their sizes would put a
// pipe-sized penthouse next to a room-sized vent.

const penthouse = ROOFTOP_PART_SIZE.penthouse;
const vent = ROOFTOP_PART_SIZE.vent;
const ac = ROOFTOP_PART_SIZE.ac;
const water = ROOFTOP_PART_SIZE.water;

assert.ok(penthouse.sx > ac.sx, "penthouse wider than AC");
assert.ok(penthouse.sy > ac.sy, "penthouse taller than AC");
assert.ok(vent.sx < ac.sx, "vent thinner than AC");
assert.ok(vent.sx < water.sx, "vent thinner than water tank");
assert.ok(water.sy > water.sx, "water tank is taller than it is wide (a real rooftop tank)");

// ── factory: builds a scene with 4 InstancedMeshes and 0-count start ──
// The scene's four InstancedMeshes must all start at count=0 (nothing
// drawn until syncHosts writes matrices). A regression that primed the
// meshes with a stale count would draw one shadowy piece at the origin
// before the first syncHosts.

{
  const scene = createRooftopScene({ maxInstancesPerPart: 32 });
  const parts = Object.keys(scene.meshes).sort();
  assert.deepEqual(parts, ["ac", "penthouse", "vent", "water"],
    "scene exposes one mesh per part");
  for (const part of ROOFTOP_PARTS) {
    assert.equal(scene.meshes[part].count, 0,
      `mesh for ${part} starts at count=0`);
  }
  assert.equal(typeof scene.syncHosts, "function", "syncHosts is exposed");
  assert.equal(typeof scene.setShadows, "function", "setShadows is exposed");
  assert.equal(typeof scene.dispose, "function", "dispose is exposed");

  // syncHosts writes matrices; count grows per host.
  scene.syncHosts([
    { role: "event", seed: 42, variant: 1, worldX: 0, worldZ: 0, yaw: 0, sx: 6, sz: 6, worldHeight: 30 },
    { role: "store", seed: 7, worldX: 10, worldZ: 5, yaw: 0.3, sx: 5, sz: 5, worldHeight: 10 },
  ]);
  let totalCount = 0;
  for (const part of ROOFTOP_PARTS) totalCount += scene.meshes[part].count;
  // 3..6 event pieces + 1..3 store pieces = 4..9 total.
  assert.ok(totalCount >= 4 && totalCount <= 9,
    `total pieces in expected range 4..9 (got ${totalCount})`);
  // Every mesh flagged dirty so the GPU picks up the new matrices.
  for (const part of ROOFTOP_PARTS) {
    assert.equal(scene.meshes[part].instanceMatrix.needsUpdate, true,
      `${part} instanceMatrix flagged for upload`);
  }

  // A second syncHosts with an empty batch resets every count to 0.
  scene.syncHosts([]);
  for (const part of ROOFTOP_PARTS) {
    assert.equal(scene.meshes[part].count, 0,
      `${part} count returns to 0 after empty resync`);
  }

  scene.setShadows(false);
  for (const part of ROOFTOP_PARTS) {
    assert.equal(scene.meshes[part].castShadow, false,
      `${part} castShadow toggled off`);
    assert.equal(scene.meshes[part].receiveShadow, false,
      `${part} receiveShadow toggled off`);
  }

  // dispose runs cleanly.
  scene.dispose();
}

// ── the buffer cap is honored: pieces beyond cap are dropped ────────────
// A settlement that oversubscribes a part beyond maxInstancesPerPart
// must drop the extras silently rather than write past the InstancedMesh's
// fixed buffer. Verify by building a tiny scene and cramming many hosts.

{
  const tiny = createRooftopScene({ maxInstancesPerPart: 3 });
  const hosts = [];
  for (let i = 0; i < 12; i += 1) {
    hosts.push({
      role: "event", seed: i * 100 + 3, variant: i % 3,
      worldX: i * 4, worldZ: 0, yaw: 0, sx: 6, sz: 6, worldHeight: 30,
    });
  }
  tiny.syncHosts(hosts);
  for (const part of ROOFTOP_PARTS) {
    assert.ok(tiny.meshes[part].count <= 3,
      `${part} count respects buffer cap of 3 (got ${tiny.meshes[part].count})`);
  }
  tiny.dispose();
}

console.log(
  "test-city-rooftop: ok — 4 shared part meshes, event 3..6 + store 1..3 pieces, " +
  "penthouse guaranteed on events + forbidden on stores, pieces inside footprint, " +
  "buffer cap honored.",
);
