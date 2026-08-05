import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-store-extras — the pure-math half of the store trim pack.
 *
 * The Three.js path (three InstancedMeshes, geometry merges, matrix
 * writes into instanceMatrix buffers) is exercised by the browser mount
 * itself — stubbing it in node only pins the shape of the stub.
 *
 * What we CAN pin here:
 *   - the three named parts (cornice / awning / balcony) exist as a
 *     const tuple — a regression that dropped one is caught here
 *   - cornice is emitted for every store (no presence gate)
 *   - awning presence lands near ~62% and balcony near ~34% across a
 *     large seed sweep; both are deterministic per seed
 *   - the balcony face is NEVER the same face as the awning — the two
 *     features never stack on the same wall
 *   - a short store (<6m) NEVER carries a balcony — a 4m store with a
 *     balcony at 62% would sit at 2.5m, below the awning
 *   - every non-cornice piece attaches OUTSIDE the plot footprint
 *     (offset >= halfX / halfZ) so it hangs OFF the wall, not INTO it
 *   - the cornice's face dimensions overhang the plot by ~3-8%
 *   - the roofY fraction shape (cornice ~1, awning ~0.24, balcony ~0.62)
 *   - baseline part sizes are sane (cornice thinnest in Y; awning
 *     projects OUT along its z; balcony projects OUT along its z)
 *   - the scene factory exposes three InstancedMeshes with count=0 at
 *     construction and syncHosts writes matrices
 *   - the InstancedMesh buffer cap is honored — extras beyond cap are
 *     silently dropped
 */

const threeStub = {
  Vector3: class { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
    set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} },
  Quaternion: class { setFromAxisAngle() {} },
  Matrix4: class { compose() { return this; } },
  BoxGeometry: class { constructor(sx=1,sy=1,sz=1){
      this._sx=sx; this._sy=sy; this._sz=sz;
      // A minimal cube position/normal so mergeUnitParts can concat.
      const p = new Float32Array(24*3);
      const n = new Float32Array(24*3);
      // 8 corners × 3 faces per corner via 6 quads × 4 verts = 24 verts.
      const hx = sx/2, hy = sy/2, hz = sz/2;
      const verts = [
        // +X
         hx,-hy,-hz,  hx, hy,-hz,  hx, hy, hz,  hx,-hy, hz,
        // -X
        -hx,-hy,-hz, -hx, hy,-hz, -hx, hy, hz, -hx,-hy, hz,
        // +Y
        -hx, hy,-hz,  hx, hy,-hz,  hx, hy, hz, -hx, hy, hz,
        // -Y
        -hx,-hy,-hz,  hx,-hy,-hz,  hx,-hy, hz, -hx,-hy, hz,
        // +Z
        -hx,-hy, hz,  hx,-hy, hz,  hx, hy, hz, -hx, hy, hz,
        // -Z
        -hx,-hy,-hz,  hx,-hy,-hz,  hx, hy,-hz, -hx, hy,-hz,
      ];
      for (let i = 0; i < verts.length; i += 1) p[i] = verts[i];
      const nx = [ 1,-1, 0, 0, 0, 0];
      const ny = [ 0, 0, 1,-1, 0, 0];
      const nz = [ 0, 0, 0, 0, 1,-1];
      for (let f = 0; f < 6; f += 1) {
        for (let v = 0; v < 4; v += 1) {
          const i = (f*4 + v) * 3;
          n[i+0] = nx[f]; n[i+1] = ny[f]; n[i+2] = nz[f];
        }
      }
      const idx = new Uint32Array(6*6);
      let w = 0;
      for (let f = 0; f < 6; f += 1) {
        const b = f*4;
        idx[w++] = b+0; idx[w++] = b+1; idx[w++] = b+2;
        idx[w++] = b+0; idx[w++] = b+2; idx[w++] = b+3;
      }
      this.attributes = {
        position: { array: p, count: 24 },
        normal:   { array: n, count: 24 },
      };
      this._idx = { array: idx, count: idx.length };
      this._translate = { x: 0, y: 0, z: 0 };
    }
    translate(x,y,z){
      const p = this.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        p[i+0] += x; p[i+1] += y; p[i+2] += z;
      }
      this._translate.x += x; this._translate.y += y; this._translate.z += z;
      return this;
    }
    getIndex(){ return this._idx; }
    dispose() {} },
  BufferGeometry: class { constructor(){
      this.attributes = {}; this._idx = null;
    }
    setAttribute(name, attr){ this.attributes[name] = attr; return this; }
    setIndex(a){ this._idx = a; return this; }
    getIndex(){ return this._idx; }
    dispose() {} },
  BufferAttribute: class { constructor(array, itemSize){
      this.array = array; this.itemSize = itemSize;
      this.count = array.length / itemSize;
    } },
  MeshStandardMaterial: class { dispose() {} },
  Group: class { constructor(){ this.name=""; this.children=[]; }
    add(x){ this.children.push(x); }
    remove(x){ const i=this.children.indexOf(x); if(i>=0) this.children.splice(i,1); } },
  InstancedMesh: class { constructor(geo, mat){
      this.geometry = geo; this.material = mat;
      this.instanceMatrix={ setUsage(){}, needsUpdate:false };
      this.castShadow=false; this.receiveShadow=false; this.count=0; this.name="";
      this.parent=null;
    }
    setMatrixAt(){} },
  DynamicDrawUsage: 35048,
};

const mod = loadTsModule("src/lib/city-store-extras.ts", {
  requireMap: { three: threeStub },
});

const {
  STORE_EXTRA_PARTS,
  STORE_EXTRA_PART_SIZE,
  extraYFractionFor,
  hasAwning,
  hasBalcony,
  awningFaceFor,
  balconyFaceFor,
  storeExtraPiecesFor,
  createStoreExtrasScene,
} = mod;

// ── STORE_EXTRA_PARTS is exactly the three named parts ──────────────────
// The brief names three part types (cornice, awning, balcony); a
// regression that dropped one would leave a store missing a category
// of trim (a facade without a cornice reads as a shipping container).
assert.deepEqual(
  [...STORE_EXTRA_PARTS].sort(),
  ["awning", "balcony", "cornice"],
  "STORE_EXTRA_PARTS is exactly awning / balcony / cornice",
);

// ── extraYFractionFor: cornice at top, awning at ground, balcony mid ────
// A regression that hoisted the awning to y=0.6 would leave shopfronts
// bare and paint a floating slab midway up the wall.
assert.ok(extraYFractionFor("cornice") > 0.98 && extraYFractionFor("cornice") <= 1.02,
  "cornice sits at ~top of the box");
assert.ok(extraYFractionFor("awning") > 0.15 && extraYFractionFor("awning") < 0.40,
  "awning sits at ground-floor shopfront");
assert.ok(extraYFractionFor("balcony") > 0.50 && extraYFractionFor("balcony") < 0.75,
  "balcony sits mid-facade");

// ── presence rates: hasAwning ~62%, hasBalcony ~34% ─────────────────────
// A regression that made every store carry a balcony would put railings
// on every corner store — reads as a bug at mid-zoom.
{
  let aw = 0, ba = 0, N = 5000;
  for (let s = 0; s < N; s += 1) {
    if (hasAwning(s * 191 + 3)) aw += 1;
    if (hasBalcony(s * 191 + 3)) ba += 1;
  }
  const awRate = aw / N;
  const baRate = ba / N;
  assert.ok(awRate > 0.55 && awRate < 0.70,
    `awning presence rate near 62% (got ${(awRate*100).toFixed(1)}%)`);
  assert.ok(baRate > 0.28 && baRate < 0.40,
    `balcony presence rate near 34% (got ${(baRate*100).toFixed(1)}%)`);
}

// ── determinism: same seed → same presence, same face ───────────────────
for (let s = 0; s < 200; s += 1) {
  const seed = s * 233 + 11;
  assert.equal(hasAwning(seed), hasAwning(seed), "hasAwning pure");
  assert.equal(hasBalcony(seed), hasBalcony(seed), "hasBalcony pure");
  assert.equal(awningFaceFor(seed), awningFaceFor(seed), "awningFaceFor pure");
  assert.equal(balconyFaceFor(seed), balconyFaceFor(seed), "balconyFaceFor pure");
}

// ── balcony face is NEVER the same as the awning face ───────────────────
// The two features must not stack on the same wall — the whole point
// of the balcony is to break the vertical rhythm on a DIFFERENT face.
for (let s = 0; s < 500; s += 1) {
  const seed = s * 419 + 13;
  const front = awningFaceFor(seed);
  const back = balconyFaceFor(seed);
  assert.notEqual(front, back,
    `balcony face (${back}) is not the awning face (${front}) at seed ${seed}`);
}

// ── storeExtraPiecesFor: cornice always emitted ─────────────────────────
// Every store, regardless of seed, must carry a cornice — that is the
// horizontal shadow-throwing feature that anchors the mid-zoom silhouette.
for (let s = 0; s < 300; s += 1) {
  const seed = s * 281 + 3;
  const pieces = storeExtraPiecesFor(seed, 5, 5, 10);
  const hasCornice = pieces.some(p => p.part === "cornice");
  assert.ok(hasCornice, `store seed ${seed} has a cornice`);
}

// ── storeExtraPiecesFor: piece count matches presence predicates ────────
// The count is 1 (cornice) + hasAwning + hasBalcony (only for tall stores).
for (let s = 0; s < 300; s += 1) {
  const seed = s * 331 + 7;
  const worldH = 10;
  const pieces = storeExtraPiecesFor(seed, 5, 5, worldH);
  const expect = 1 + (hasAwning(seed) ? 1 : 0) + (hasBalcony(seed) ? 1 : 0);
  assert.equal(pieces.length, expect,
    `store seed ${seed} emits ${expect} pieces (got ${pieces.length})`);
}

// ── short stores NEVER carry a balcony ──────────────────────────────────
// The gate is worldHeight > 6. A 4m or 5m store with a balcony at 62%
// would sit at 2.5-3m — below the awning. This gate keeps the balcony
// visually plausible.
{
  let found = 0;
  for (let s = 0; s < 500; s += 1) {
    const seed = s * 463 + 19;
    const pieces = storeExtraPiecesFor(seed, 5, 5, 4.0);
    for (const p of pieces) {
      if (p.part === "balcony") found += 1;
    }
  }
  assert.equal(found, 0,
    "no short store emits a balcony piece");
}

// ── every non-cornice piece attaches OUTSIDE the plot footprint ─────────
// The awning + balcony must project OFF the wall face — their offset
// magnitude must be >= halfX / halfZ (never inside the plot).
for (let s = 0; s < 400; s += 1) {
  const seed = s * 191 + 5;
  const sx = 5;
  const sz = 5;
  const halfX = sx * 0.5;
  const halfZ = sz * 0.5;
  const pieces = storeExtraPiecesFor(seed, sx, sz, 12);
  for (const p of pieces) {
    if (p.part === "cornice") {
      // Cornice sits at plot center (ox=oz=0).
      assert.equal(p.ox, 0, "cornice center-x");
      assert.equal(p.oz, 0, "cornice center-z");
    } else {
      // Awning or balcony must hang OFF ONE face — one axis outside plot.
      const outsideX = Math.abs(p.ox) > halfX;
      const outsideZ = Math.abs(p.oz) > halfZ;
      assert.ok(outsideX || outsideZ,
        `${p.part} at seed ${seed} attaches OUTSIDE plot (ox=${p.ox}, oz=${p.oz})`);
      // But the OTHER axis stays inside — it doesn't diagonal off a corner.
      const bothOutside = outsideX && outsideZ;
      assert.ok(!bothOutside,
        `${p.part} at seed ${seed} does not stick off two axes (ox=${p.ox}, oz=${p.oz})`);
    }
  }
}

// ── the cornice's face dimensions overhang the plot by ~3-8% ────────────
// A cornice is a limestone ledge that sticks out from the wall a few
// percent so the sun catches its front edge. A regression that dropped
// the overhang to 0% would remove the shadow line that anchors the roof.
for (let s = 0; s < 200; s += 1) {
  const seed = s * 179 + 21;
  const sx = 5;
  const sz = 5;
  const [c] = storeExtraPiecesFor(seed, sx, sz, 10);
  assert.equal(c.part, "cornice");
  assert.ok(c.worldWidth > sx * 1.02 && c.worldWidth < sx * 1.15,
    `cornice worldWidth overhangs sx (got ${c.worldWidth} vs ${sx})`);
  assert.ok(c.worldHeight > sz * 1.02 && c.worldHeight < sz * 1.15,
    `cornice worldHeight overhangs sz (got ${c.worldHeight} vs ${sz})`);
}

// ── baseline part sizes are sane and distinct ───────────────────────────
// Cornice is thinnest in Y (thin ledge); awning projects along its z
// (out from the wall); balcony has a taller rail than the awning's
// canvas.
const c = STORE_EXTRA_PART_SIZE.cornice;
const a = STORE_EXTRA_PART_SIZE.awning;
const b = STORE_EXTRA_PART_SIZE.balcony;
assert.ok(c.sy < a.sy || c.sy < b.sy, "cornice is thin in Y");
assert.ok(a.sz > a.sy, "awning projects further along z than its thickness in y");
assert.ok(b.sy > c.sy, "balcony rail is taller than the cornice ledge");

// ── scene factory: 3 InstancedMeshes, count=0 at construction ───────────
{
  const scene = createStoreExtrasScene({ maxInstancesPerPart: 32 });
  const parts = Object.keys(scene.meshes).sort();
  assert.deepEqual(parts, ["awning", "balcony", "cornice"],
    "scene exposes one mesh per part");
  for (const part of STORE_EXTRA_PARTS) {
    assert.equal(scene.meshes[part].count, 0,
      `mesh for ${part} starts at count=0`);
  }
  assert.equal(typeof scene.syncHosts, "function", "syncHosts is exposed");
  assert.equal(typeof scene.setShadows, "function", "setShadows is exposed");
  assert.equal(typeof scene.dispose, "function", "dispose is exposed");

  // syncHosts writes matrices; count grows per host with cornice always.
  scene.syncHosts([
    { seed: 42, worldX: 0, worldZ: 0, yaw: 0, sx: 5, sz: 5, worldHeight: 12 },
    { seed: 7, worldX: 10, worldZ: 5, yaw: 0.3, sx: 5, sz: 5, worldHeight: 10 },
  ]);
  // Two stores → 2 cornices minimum.
  assert.equal(scene.meshes.cornice.count, 2,
    `two hosts produce two cornices (got ${scene.meshes.cornice.count})`);
  // Awning + balcony counts must be <= 2 (one per store max).
  assert.ok(scene.meshes.awning.count <= 2, "awning count <= host count");
  assert.ok(scene.meshes.balcony.count <= 2, "balcony count <= host count");

  // Every mesh flagged dirty so the GPU picks up the new matrices.
  for (const part of STORE_EXTRA_PARTS) {
    assert.equal(scene.meshes[part].instanceMatrix.needsUpdate, true,
      `${part} instanceMatrix flagged for upload`);
  }

  // Empty resync resets counts.
  scene.syncHosts([]);
  for (const part of STORE_EXTRA_PARTS) {
    assert.equal(scene.meshes[part].count, 0,
      `${part} count returns to 0 after empty resync`);
  }

  scene.setShadows(false);
  for (const part of STORE_EXTRA_PARTS) {
    assert.equal(scene.meshes[part].castShadow, false,
      `${part} castShadow toggled off`);
    assert.equal(scene.meshes[part].receiveShadow, false,
      `${part} receiveShadow toggled off`);
  }

  scene.dispose();
}

// ── merged geometry has positions + normals + an index ──────────────────
// The merge helper concatenates two sub-boxes into a single
// BufferGeometry. Awning has 2 sub-boxes = 48 verts + 72 indices;
// balcony has the same. Cornice has 1 sub-box = 24 verts + 36 indices.
{
  const scene = createStoreExtrasScene({ maxInstancesPerPart: 4 });
  for (const part of STORE_EXTRA_PARTS) {
    const g = scene.meshes[part].geometry;
    assert.ok(g && g.attributes && g.attributes.position,
      `${part} geometry has positions`);
    assert.ok(g.attributes.normal, `${part} geometry has normals`);
    const idx = g.getIndex();
    assert.ok(idx && idx.count > 0, `${part} geometry has an index`);
    // Awning and balcony are two-box merges → 48 verts, cornice 24.
    if (part === "cornice") {
      assert.equal(g.attributes.position.count, 24,
        "cornice has 24 verts (single sub-box)");
    } else {
      assert.equal(g.attributes.position.count, 48,
        `${part} has 48 verts (two-box merge)`);
    }
  }
  scene.dispose();
}

// ── buffer cap: oversubscribed part drops the extras silently ──────────
{
  const tiny = createStoreExtrasScene({ maxInstancesPerPart: 2 });
  const hosts = [];
  for (let i = 0; i < 8; i += 1) {
    hosts.push({
      seed: i * 100 + 3,
      worldX: i * 5, worldZ: 0, yaw: 0, sx: 5, sz: 5, worldHeight: 12,
    });
  }
  tiny.syncHosts(hosts);
  for (const part of STORE_EXTRA_PARTS) {
    assert.ok(tiny.meshes[part].count <= 2,
      `${part} count respects buffer cap of 2 (got ${tiny.meshes[part].count})`);
  }
  tiny.dispose();
}

console.log(
  "test-city-store-extras: ok — 3 shared part meshes, cornice always, " +
  "awning ~62% + balcony ~34%, balcony face ≠ awning face, " +
  "short stores never balcony, non-cornice off wall, buffer cap honored.",
);
