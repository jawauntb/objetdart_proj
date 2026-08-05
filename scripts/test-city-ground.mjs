import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-ground — pin the pure math of the baked streets pass.
 *
 * The Three.js and DOM canvas paths are exercised by the browser mount
 * itself (a plane wearing a real MeshStandardMaterial cannot be run in
 * node without a full WebGL stub, and stubbing that would only pin the
 * shape of the stub, not the actual bake). What we CAN pin here — and
 * therefore must — is the deterministic shape of the block plan sampler,
 * the invariants of the road-projection function, and that the module's
 * public factory refuses to bake outside a browser rather than crashing
 * deep in an image-data allocation.
 *
 * The stub `three` module only needs to satisfy the top-level `import
 * * as THREE from "three"` — the pure exports below never call any
 * Three constructor.
 */

const threeStub = {
  RepeatWrapping: 1000,
  ClampToEdgeWrapping: 1001,
  LinearFilter: 1006,
  LinearMipmapLinearFilter: 1008,
  SRGBColorSpace: "srgb",
  NoColorSpace: "",
  Vector2: class { constructor(x=0,y=0){this.x=x;this.y=y;} },
  CanvasTexture: class { constructor(){ this.repeat={set(){}}; } dispose(){} },
  MeshStandardMaterial: class { constructor(){ this.normalScale=null; } dispose(){} },
  PlaneGeometry: class { dispose(){} },
  Mesh: class { constructor(){ this.rotation={x:0}; this.position={y:0}; } },
};

const cameraStub = {
  CITY_HALF: 40,
  normToWorld(nx, ny){ return { x: (nx-0.5)*80, z: (ny-0.5)*80 }; },
};

const mod = loadTsModule("src/lib/city-ground.ts", {
  requireMap: { three: threeStub, "@/lib/city-camera": cameraStub, "./city-camera": cameraStub },
});

const {
  sampleBlockPlan,
  projectRoadToOverlayUv,
  normToOverlayUv,
  DEFAULT_BLOCK_PLAN,
  createCityGround,
} = mod;

// ── determinism: same seed → same tag at every sampled point ─────────────
//
// The whole point of a seeded block plan is that a remount at the same
// cityTimeMs produces the same streets. If a future refactor accidentally
// pulled in Math.random or wall-clock, this test fires — the sampler is
// called at the same points twice and both walks must agree exactly.

{
  const N = 40;
  const seed = 424242;
  const first = [];
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      first.push(sampleBlockPlan(i / N, j / N, seed));
    }
  }
  const second = [];
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      second.push(sampleBlockPlan(i / N, j / N, seed));
    }
  }
  assert.deepStrictEqual(first, second, "block plan sampler must be deterministic for a fixed seed");
}

// ── seed sensitivity: two seeds produce two different plans ──────────────
//
// A block plan that IGNORES the seed reads as one atlas stamped forty-eight
// times — the brief is explicit that the settlement is fifty-something
// individual causes, not one prefab. Assert that at least a few sampled
// cells differ between two seeds.

{
  const N = 40;
  let differences = 0;
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const a = sampleBlockPlan(i / N, j / N, 111);
      const b = sampleBlockPlan(i / N, j / N, 999);
      if (a !== b) differences += 1;
    }
  }
  assert.ok(
    differences > 0,
    "two distinct seeds must produce at least one sampled cell that differs — otherwise the seed is a decorative parameter",
  );
}

// ── shape: streets are on the grid, lots are inside ─────────────────────
//
// At u=v=0 (the tile's top-left corner) we sit right on a grid edge, so
// the sampler must land on 'asphalt' or 'centerline' — the road is
// exactly at the block edge. At the center of a block (u=v=0.125 for a
// 4-blocks-per-tile plan) we must be inside a lot. The tests here pin
// the shape of the grid; a refactor that widens streets to 40% of the
// tile would still pass, but one that ate the entire tile as street or
// left no streets at all would fire.

{
  const seedForShape = 1234567;
  const edgeTag = sampleBlockPlan(0.0001, 0.5, seedForShape);
  assert.ok(
    edgeTag === "asphalt" || edgeTag === "centerline",
    `tile edge must be street or centerline (got ${edgeTag})`,
  );
  // Middle of the first block: u=v=1/8 for the default 4-per-tile plan.
  const cellCenter = 1 / (DEFAULT_BLOCK_PLAN.blocksPerTile * 2);
  const centerTag = sampleBlockPlan(cellCenter, cellCenter, seedForShape);
  assert.ok(
    centerTag === "lot",
    `middle of a block must be interior lot (got ${centerTag})`,
  );
}

// ── sidewalks bracket the streets ────────────────────────────────────────
//
// Walking from the block interior outward toward an edge, we must
// encounter sidewalk before asphalt — this is what makes a curb a curb.
// If a refactor accidentally puts asphalt directly against the lot
// (no sidewalk band), a tower would step straight from mud onto tarmac
// and the diorama read returns.

{
  const seed = 77777;
  const perBlock = 1 / DEFAULT_BLOCK_PLAN.blocksPerTile;
  const half = perBlock * 0.5;
  const tags = [];
  const y = half; // walk along the middle of a block
  for (let step = 0; step <= 40; step += 1) {
    const u = step / 40 * perBlock;
    tags.push(sampleBlockPlan(u, y, seed));
  }
  // From the interior (start of the walk) out to the edge, we must see
  // 'sidewalk' AFTER 'lot' and BEFORE 'asphalt' at least somewhere.
  const firstLot = tags.indexOf("lot");
  const firstAsphalt = tags.indexOf("asphalt");
  const firstSidewalk = tags.indexOf("sidewalk");
  assert.ok(firstLot >= 0, "there must be at least one lot cell along a block middle");
  assert.ok(firstSidewalk >= 0, "there must be at least one sidewalk cell along a block middle");
  assert.ok(firstAsphalt >= 0, "there must be at least one asphalt cell along a block middle");
  // Walking from a tile edge (asphalt) inward, we must cross sidewalk
  // before landing in the lot interior — the curb sits between road
  // and lot, not directly against the lot.
  assert.ok(
    firstAsphalt < firstSidewalk && firstSidewalk < firstLot,
    `expected asphalt → sidewalk → lot ordering along the block middle (got asphalt@${firstAsphalt}, sidewalk@${firstSidewalk}, lot@${firstLot})`,
  );
}

// ── projection: normalized ↔ overlay uv is an identity (within [0..1]²) ─
//
// The overlay maps 1:1 to the settlement area. Roads at cardinal points
// must project to the same cardinal points in UV.

{
  assert.deepStrictEqual(normToOverlayUv(0, 0), { u: 0, v: 0 });
  assert.deepStrictEqual(normToOverlayUv(1, 1), { u: 1, v: 1 });
  assert.deepStrictEqual(normToOverlayUv(0.5, 0.25), { u: 0.5, v: 0.25 });
  // Clamping — a road that starts inside and ends outside must still
  // produce a drawable segment (the visitor's fingertip may leave the
  // settlement box mid-drag; the overlay clips it to the edge).
  const p = projectRoadToOverlayUv(0.4, 0.4, 1.6, 0.5);
  assert.ok(p, "a road with one endpoint outside must still project");
  assert.equal(p.a.u, 0.4);
  assert.equal(p.b.u, 1);
}

// ── projection: entirely-outside segments are rejected ──────────────────
//
// A road drawn entirely outside the settlement box should return null
// so the caller can skip drawing — otherwise the shader clamp would
// pin the segment to an edge and paint a bright stripe against the
// nearest border, a visible artifact.

{
  assert.equal(
    projectRoadToOverlayUv(-0.5, 0.5, -0.2, 0.6),
    null,
    "segment entirely below u=0 must be rejected",
  );
  assert.equal(
    projectRoadToOverlayUv(0.5, 1.4, 0.6, 1.9),
    null,
    "segment entirely above v=1 must be rejected",
  );
  assert.equal(
    projectRoadToOverlayUv(NaN, 0.5, 0.6, 0.6),
    null,
    "NaN endpoints must be rejected — the visitor never drew such a road",
  );
}

// ── factory: refuses to bake in node ─────────────────────────────────────
//
// The bake requires a DOM canvas. A future test that accidentally imports
// createCityGround at the top level of a node script should get a clear
// error, not a null-pointer in three's texture allocator. `document`
// exists at module top-level in some Node environments; in this script's
// realm it does not, so the guard fires.

{
  assert.throws(
    () => createCityGround({ size: 400, baseResolution: 32, overlayResolution: 32 }),
    /city-ground: baking requires a DOM canvas/,
    "createCityGround must refuse to run without a DOM canvas",
  );
}

console.log("test-city-ground: ok");
