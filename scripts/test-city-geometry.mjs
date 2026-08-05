import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-geometry — the pure-math half of the 3D skyline scene.
 *
 * The tests below pin the role → height ladder, the role → footprint
 * ladder, and the per-seed color drift. A regression that made stores
 * ever taller than events (or homes taller than stores) would break the
 * causal reading: the dwell ladder home → store → event → tree must be
 * legible AT A GLANCE as a rising skyline, or the whole /city aesthetic
 * collapses back into 48 identical stubs.
 *
 * The pure functions do not construct any Three.js objects, so the test
 * only needs a stub `three` module for the factory this file does not
 * exercise.
 */

const threeStub = {
  Vector3: class { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} },
  Quaternion: class { setFromAxisAngle() {} },
  Matrix4: class { compose() { return this; } },
  Color: class {
    constructor(r=1,g=1,b=1){this.r=r;this.g=g;this.b=b;}
    setRGB(r,g,b){this.r=r;this.g=g;this.b=b;return this;}
    offsetHSL(){return this;}
    multiplyScalar(s){this.r*=s;this.g*=s;this.b*=s;return this;}
    copy(c){this.r=c.r;this.g=c.g;this.b=c.b;return this;}
  },
  BoxGeometry: class { translate() {} dispose() {} },
  PlaneGeometry: class { dispose() {} },
  MeshStandardMaterial: class { dispose() {} },
  InstancedMesh: class { constructor(){ this.instanceMatrix={setUsage(){}};} setMatrixAt(){} setColorAt(){} },
  InstancedBufferAttribute: class { setUsage() {} },
  Mesh: class { constructor(){ this.rotation={x:0}; this.position={y:0}; } },
  Scene: class { add(){} },
  FogExp2: class { constructor(){ this.color={setRGB(){}}} },
  HemisphereLight: class {},
  DirectionalLight: class { constructor(){
    this.position={set(){}};
    this.target={position:{set(){}}};
    this.shadow={ mapSize:{set(){}}, camera:{}, bias:0, normalBias:0 };
    this.color={setRGB(){}};
  }},
  AmbientLight: class {},
  DynamicDrawUsage: 35048,
};

const cameraStub = {
  normToWorld(nx, ny) { return { x: (nx - 0.5) * 80, z: (ny - 0.5) * 80 }; },
  CITY_HALF: 40,
};

const mod = loadTsModule("src/lib/city-geometry.ts", {
  requireMap: { three: threeStub, "@/lib/city-camera": cameraStub },
});
const {
  heightForRole,
  footprintForRole,
  hashUnit,
  colorForInstance,
  ROLE_COLOR,
  BUILDING_ROLES,
  roofPitchForSeed,
  roofUnitHeightFor,
  hasChimneyForSeed,
  eventVariantForSeed,
} = mod;

// ——— BUILDING_ROLES holds the four civic roles that get their own mesh ——
// The role-split geometry pass built one InstancedMesh per role; a test
// pins the list so a regression that drops (or reorders) a role would fail
// loudly. `empty` is intentionally NOT in the list — empty plots don't render.
assert.ok(Array.isArray(BUILDING_ROLES), "BUILDING_ROLES is an array");
assert.deepEqual(
  [...BUILDING_ROLES].sort(),
  ["event", "home", "store", "tree"],
  "BUILDING_ROLES lists exactly home/store/event/tree",
);
assert.ok(!BUILDING_ROLES.includes("empty"), "empty is not a building role");

// ——— hashUnit determinism + spread ———————————————————————————————————————
// A seeded hash that returned the same value for every seed would silently
// collapse the settlement's variety back to one prefab. The test samples
// many seeds and asserts the resulting spread and the same-input equality.

assert.equal(hashUnit(12345, 3), hashUnit(12345, 3), "hashUnit is a pure function of (seed, salt)");
assert.notEqual(hashUnit(12345, 3), hashUnit(12345, 4), "different salts return different hashes");
assert.notEqual(hashUnit(12345, 3), hashUnit(12346, 3), "different seeds return different hashes");
{
  const samples = [];
  for (let i = 0; i < 200; i += 1) samples.push(hashUnit(i * 17 + 3, 5));
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  assert.ok(mean > 0.4 && mean < 0.6, "hash samples roughly cover [0,1]; mean=" + mean);
  const buckets = new Array(5).fill(0);
  for (const s of samples) buckets[Math.min(4, Math.floor(s * 5))] += 1;
  for (const b of buckets) assert.ok(b > 10, "each quintile of [0,1] gets at least 10 hits");
}

// ——— role → height ladder is strictly ordered ————————————————————————————
// This is the aesthetic invariant: an event is always taller than any
// store, a store is always taller than any home. A test that only checked
// the means would miss a bug where store's upper range crossed event's
// lower range. The ranges are set in the module so their extremes do NOT
// overlap; the test enforces that at every seed.

let maxHome = -Infinity, minStore = Infinity, maxStore = -Infinity, minEvent = Infinity;
let minHome = Infinity, maxEvent = -Infinity, minTree = Infinity, maxTree = -Infinity;
for (let s = 0; s < 400; s += 1) {
  const seed = s * 131 + 7;
  const h = heightForRole("home", seed);
  const st = heightForRole("store", seed);
  const ev = heightForRole("event", seed);
  const tr = heightForRole("tree", seed);
  if (h > maxHome) maxHome = h;
  if (h < minHome) minHome = h;
  if (st < minStore) minStore = st;
  if (st > maxStore) maxStore = st;
  if (ev < minEvent) minEvent = ev;
  if (ev > maxEvent) maxEvent = ev;
  if (tr < minTree) minTree = tr;
  if (tr > maxTree) maxTree = tr;
}
assert.ok(maxHome < minStore,  `home max ${maxHome} < store min ${minStore}: the ladder is strict`);
assert.ok(maxStore < minEvent, `store max ${maxStore} < event min ${minEvent}: the ladder is strict`);
assert.ok(minEvent > 20, `event towers rise above 20 units (got ${minEvent}) — the iconic silhouette`);
assert.ok(maxEvent < 50, `event towers stay below 50 units (got ${maxEvent}) — still a settlement scale`);
assert.ok(minTree > 0, "trees have positive height");

// heightForRole is deterministic in the seed — a plot's rebuild after
// resize/persistence-restore must land at exactly the same height.
assert.equal(heightForRole("home", 7), heightForRole("home", 7));
assert.equal(heightForRole("event", 999), heightForRole("event", 999));

// ——— footprint ladder is strictly ordered on the mean —————————————————————
// The ranges overlap by design (a big home has the same footprint as a
// small store); the mean over many seeds must still climb, or the eye
// would read the settlement as one uniform block-size.

function meanFootprint(role) {
  let acc = 0;
  const N = 200;
  for (let s = 0; s < N; s += 1) {
    const { sx, sz } = footprintForRole(role, s * 197 + 11);
    acc += (sx + sz) * 0.5;
  }
  return acc / N;
}
const mHome = meanFootprint("home");
const mStore = meanFootprint("store");
const mEvent = meanFootprint("event");
assert.ok(mHome < mStore, `mean home footprint (${mHome}) < mean store footprint (${mStore})`);
assert.ok(mStore < mEvent, `mean store footprint (${mStore}) < mean event footprint (${mEvent})`);

// ——— sealed brightens the color ——————————————————————————————————————————
// The room's one solemn act (a ceremony seal) must read from a distance;
// the color for a sealed plot is brighter than the same plot unsealed.
{
  const unsealed = colorForInstance("home", 42, false);
  const sealed = colorForInstance("home", 42, true);
  const lu = unsealed.r + unsealed.g + unsealed.b;
  const ls = sealed.r + sealed.g + sealed.b;
  assert.ok(ls > lu, `sealed color brighter than unsealed (${ls} > ${lu})`);
}

// ——— role palette is defined and distinct ————————————————————————————————
// A palette that assigned the same base tint to home and event would
// dissolve the two roles into one color at a distance; the test names
// the palette and enforces its bounds.

for (const role of ["home", "store", "event", "tree"]) {
  const c = ROLE_COLOR[role];
  assert.ok(Array.isArray(c) && c.length === 3, role + " has an RGB triple");
  for (const v of c) assert.ok(v >= 0 && v <= 1, role + " channel is in [0,1]: " + v);
}
{
  const home = ROLE_COLOR.home;
  const event = ROLE_COLOR.event;
  const d = (home[0]-event[0])**2 + (home[1]-event[1])**2 + (home[2]-event[2])**2;
  assert.ok(d > 0.05, "home vs event tints are distinguishable in color-space");
}

// ——— compound-geometry knobs: roof pitch, chimney, event variant —————————
// The compound geometry pass introduces four small pure knobs that pick a
// home's roof pitch, a home's chimney presence, and an event tower's
// silhouette variant. Each must be deterministic per seed and produce a
// legible spread across many seeds so the settlement doesn't collapse
// into one prefab silhouette.

// Determinism.
assert.equal(roofPitchForSeed(101), roofPitchForSeed(101), "roofPitch is pure in seed");
assert.equal(eventVariantForSeed(202), eventVariantForSeed(202), "eventVariant is pure in seed");
assert.equal(hasChimneyForSeed(303), hasChimneyForSeed(303), "chimney presence is pure in seed");

// Spread — every bucket gets hit.
{
  const pitchCounts = [0, 0, 0];
  const variantCounts = [0, 0, 0];
  let chimneyOn = 0;
  const N = 400;
  for (let s = 0; s < N; s += 1) {
    const seed = s * 173 + 5;
    const p = roofPitchForSeed(seed);
    const v = eventVariantForSeed(seed);
    assert.ok(p === 0 || p === 1 || p === 2, "roof pitch is one of 0/1/2");
    assert.ok(v === 0 || v === 1 || v === 2, "event variant is one of 0/1/2");
    pitchCounts[p] += 1;
    variantCounts[v] += 1;
    if (hasChimneyForSeed(seed)) chimneyOn += 1;
  }
  for (const c of pitchCounts) assert.ok(c > 20, "each roof pitch bucket gets some homes: " + c);
  for (const c of variantCounts) assert.ok(c > 20, "each event variant bucket gets some towers: " + c);
  const chimneyFrac = chimneyOn / N;
  assert.ok(chimneyFrac > 0.4 && chimneyFrac < 0.7,
    "about half of homes have chimneys (got " + chimneyFrac + ")");
}

// Roof height buckets are monotone: steep > medium > shallow. If the
// buckets ever collapsed to the same height the block would read as one
// uniform roofline and the "48 individuals" property would fail.
assert.ok(roofUnitHeightFor(0) < roofUnitHeightFor(1), "roof pitch 0 (shallow) < pitch 1 (medium)");
assert.ok(roofUnitHeightFor(1) < roofUnitHeightFor(2), "roof pitch 1 (medium) < pitch 2 (steep)");
assert.ok(roofUnitHeightFor(0) > 0, "shallow roof has positive height");
assert.ok(roofUnitHeightFor(2) < 1, "steep roof stays below the wall's own height");

console.log(
  "city-geometry ok: role→height ladder strict (home<store<event), footprint means climb, " +
  "sealed brightens, palette distinct, hashUnit deterministic and evenly spread, " +
  "roof pitch/chimney/event silhouette knobs deterministic and spread across buckets.",
);
