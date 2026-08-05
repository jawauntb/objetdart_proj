/**
 * city-store-extras — the horizontal trim that anchors a store facade.
 *
 * At mid-zoom every store in the current build reads flat: a plain
 * extruded box with a painted window lattice and a rooftop condenser.
 * Real streetscapes are visually anchored by three horizontal features
 * the human eye locks onto — cornices catching the low-angle sun as a
 * bright horizontal ledge, first-floor awnings casting a hard oblique
 * shadow onto the sidewalk, and third-floor balconies breaking the
 * vertical rhythm of the facade.
 *
 * This module is the shared trim pack. Three InstancedMeshes hold
 * every piece across every host store plot:
 *
 *   cornice — merged BufferGeometry: a thin flat slab that overhangs
 *             the parapet by a few percent, catching the sun rake and
 *             throwing a hard horizontal shadow onto the wall below.
 *             Always present on every store.
 *   awning  — merged BufferGeometry: a shallow canvas-wedge attached
 *             at the ground-floor shopfront on one face of the store.
 *             Present on ~62% of stores. Two-toned face + soffit
 *             merged from two BoxGeometries so the underside picks up
 *             warm bounce from the sidewalk material.
 *   balcony — merged BufferGeometry: a thin horizontal rail plus the
 *             narrow slab it rides on, welded from two BoxGeometries.
 *             Present on ~34% of stores. Sits at ~62% of the store's
 *             height on the opposite face from the awning so the two
 *             don't stack.
 *
 * Three draw calls total, regardless of how many stores the settlement
 * asks for. Every piece's position, yaw, and dimensions are
 * deterministic in the host plot's seed, so a rebuild lands on the
 * same trim silhouette — same rule that keeps `rooftop-clutter` stable
 * across sessions. The seed-keyed presence predicate is the same
 * mulberry-style walk shared with the rooftop clutter pack, so a store
 * that carries a rooftop water tank is not correlated with whether it
 * carries an awning: the two features live on separate hash salts.
 *
 * The extras caller (city-geometry.createSkylineScene) collects the
 * per-plot host record for each store in the same walk that fills
 * `rooftopHosts`, then hands the batch to `syncHosts`. This module
 * owns no dwell logic and no role ladder — it just paints the trim
 * the host asks for.
 *
 * All world-space math. The pieces do NOT ride the host plot's
 * matrix; they live at the plot's world center with a fixed world
 * size so a doubled plot doesn't double-scale its awning. This
 * matters at the wide zoom: the whole city catches sun rake at
 * golden hour and the trim's own self-shadow onto the wall behind it
 * reads correctly regardless of the plot beneath it.
 *
 * A NOTE ON THE MERGE. Every part geometry is built ONCE at module
 * setup via a small merge helper (`mergeUnitParts`) that concatenates
 * two or three sub-box geometries into a single BufferGeometry with a
 * single materialIndex. This is the "merged BufferGeometry" the brief
 * calls for — not per-frame merging, and not runtime BufferGeometryUtils.
 * The merge is stamped at unit size 1×1×1 (or thereabouts), and every
 * instance matrix scales x/y/z to the piece's world size.
 */

import * as THREE from "three";
import { hashUnit } from "@/lib/city-geometry-pure";

/** The three part types. Kept as a `const` tuple so a regression that
 *  drops one is loud at type-check. */
export const STORE_EXTRA_PARTS = ["cornice", "awning", "balcony"] as const;
export type StoreExtraPart = typeof STORE_EXTRA_PARTS[number];

/**
 * Baseline WORLD-space size for each part. The instance matrix scales
 * around this baseline by a per-piece scale so a row of awnings
 * doesn't stamp.
 *
 *   cornice.sx / sz — the store's footprint x1.06 (overhang 3% per side)
 *                     is applied at instance time; the baseline here is
 *                     1.0 so a per-store multiplier reads clean.
 *   cornice.sy      — 0.28m thickness. A real limestone cornice sticks
 *                     down about a third of a meter.
 *   awning          — 1.60m projection out, 0.30m thick, wide enough to
 *                     span most of the shopfront (per-piece width).
 *   balcony         — 0.90m projection out, 0.85m tall (rail height),
 *                     baseline width 1.0 (per-piece width scaling).
 */
export const STORE_EXTRA_PART_SIZE: Record<StoreExtraPart, { sx: number; sy: number; sz: number }> = {
  cornice: { sx: 1.00, sy: 0.28, sz: 1.00 },
  awning:  { sx: 1.00, sy: 0.30, sz: 1.60 },
  balcony: { sx: 1.00, sy: 0.85, sz: 0.90 },
};

/**
 * Where on the host plot's unit height each part sits.
 *
 *   cornice → 0.995  (just below the top of the box so the overhang
 *                     rides the parapet, not floats above it)
 *   awning  → 0.24   (ground-floor shopfront — ~2.5m on a 10m store)
 *   balcony → 0.62   (third-floor deck on a 5-floor store)
 *
 * A regression that put the awning at y=0.6 would leave the shopfront
 * bare and a floating shade slab midway up the wall.
 */
export function extraYFractionFor(part: StoreExtraPart): number {
  if (part === "cornice") return 0.995;
  if (part === "awning")  return 0.24;
  return 0.62;
}

/** Which face of the store the piece attaches to. 0=+X, 1=-X, 2=+Z, 3=-Z.
 *  Cornice wraps all faces so it has no face; awning and balcony each
 *  pick one deterministically. */
export type StoreExtraFace = 0 | 1 | 2 | 3;

/** Presence predicate — whether a store carries an awning. About 62%. */
export function hasAwning(seed: number): boolean {
  return hashUnit(seed, 43) < 0.62;
}

/** Presence predicate — whether a store carries a balcony. About 34%. */
export function hasBalcony(seed: number): boolean {
  return hashUnit(seed, 47) < 0.34;
}

/** Face for the awning — the store's front. Deterministic on seed. */
export function awningFaceFor(seed: number): StoreExtraFace {
  const t = hashUnit(seed, 53);
  return Math.floor(t * 4) as StoreExtraFace;
}

/** Face for the balcony — the OPPOSITE face from the awning so the two
 *  features don't stack on the same wall. Deterministic on seed. */
export function balconyFaceFor(seed: number): StoreExtraFace {
  const front = awningFaceFor(seed);
  // Opposite face pairs: 0<->1 (X), 2<->3 (Z). If seed picks perpendicular,
  // rotate one step so we still get a non-front face.
  const t = hashUnit(seed, 59);
  if (t < 0.5) {
    // strict opposite
    if (front === 0) return 1;
    if (front === 1) return 0;
    if (front === 2) return 3;
    return 2;
  }
  // perpendicular — the balcony wraps a corner-adjacent side
  if (front === 0 || front === 1) return t < 0.75 ? 2 : 3;
  return t < 0.75 ? 0 : 1;
}

/** One deterministic trim piece — part choice + local offset + yaw + size. */
export type StoreExtraPiece = {
  part: StoreExtraPart;
  /** Offset from plot center in WORLD units (pre-yaw), x axis. */
  ox: number;
  /** Offset from plot center in WORLD units (pre-yaw), z axis. */
  oz: number;
  /** Yaw jitter about Y in radians, added to the host plot's yaw. */
  yaw: number;
  /** Multiplier around the baseline part size. */
  scale: number;
  /** Per-piece width in world meters (cornice: footprint, awning/balcony:
   *  70% of the face length). */
  worldWidth: number;
  /** Per-piece height in world meters (cornice: baseline; awning: baseline;
   *  balcony: baseline scaled by per-piece scale). */
  worldHeight: number;
};

/**
 * Deterministic per-plot piece list.
 *
 * The cornice is emitted for every store. The awning and balcony are
 * emitted conditionally on their presence predicates. Every read is a
 * pure hashUnit — the settlement's trim stays stable across sessions
 * and across rebuilds triggered by resize or persistence-restore.
 *
 *   sx / sz are the WORLD footprint of the host plot (post-scale).
 *   worldHeight is the store's current world height (bornT * fullH).
 */
export function storeExtraPiecesFor(
  seed: number,
  sx: number,
  sz: number,
  worldHeight: number,
): StoreExtraPiece[] {
  const pieces: StoreExtraPiece[] = [];
  const halfX = Math.max(0, sx) * 0.5;
  const halfZ = Math.max(0, sz) * 0.5;

  // ── cornice — always present, centered on plot, overhangs by 3% ──
  {
    // Small yaw jitter so a row of stores doesn't perfectly line up.
    const yawJ = (hashUnit(seed, 71) - 0.5) * 0.03;
    // Cornice thickness scales up slightly on wider plots so the ledge
    // reads at a bigger stretch.
    const scale = 0.95 + hashUnit(seed, 73) * 0.12;
    pieces.push({
      part: "cornice",
      ox: 0,
      oz: 0,
      yaw: yawJ,
      scale,
      // A cornice picks up the plot footprint with 3% overhang.
      worldWidth: sx * 1.06,
      worldHeight: sz * 1.06,
    });
  }

  // ── awning — ~62% of stores ──────────────────────────────────────
  if (hasAwning(seed)) {
    const face = awningFaceFor(seed);
    // Position on the outer edge of the picked face, offset OUT by the
    // half-projection of the wedge so the awning hangs OFF the wall.
    const project = STORE_EXTRA_PART_SIZE.awning.sz * 0.5;
    let ox = 0, oz = 0;
    if (face === 0) ox =  halfX + project;
    if (face === 1) ox = -(halfX + project);
    if (face === 2) oz =  halfZ + project;
    if (face === 3) oz = -(halfZ + project);
    // Face-parallel width — 70% of the face length so the awning
    // doesn't wrap around corners.
    const faceLen = (face === 0 || face === 1) ? sz : sx;
    const width = faceLen * 0.70;
    const scale = 0.92 + hashUnit(seed, 79) * 0.20;
    pieces.push({
      part: "awning",
      ox,
      oz,
      // The awning's long edge must align with the wall face. When the
      // face is +X or -X, the wedge's local x-axis (its width) must
      // align with world Z — so add π/2 to yaw.
      yaw: (face === 2 || face === 3) ? 0 : Math.PI * 0.5,
      scale,
      worldWidth: width,
      worldHeight: STORE_EXTRA_PART_SIZE.awning.sy,
    });
  }

  // ── balcony — ~34% of stores ─────────────────────────────────────
  if (hasBalcony(seed) && worldHeight > 6) {
    // Only place a balcony on stores tall enough (>6m) to carry one.
    // A 4m store with a balcony at 62% would sit at 2.5m — too low.
    const face = balconyFaceFor(seed);
    const project = STORE_EXTRA_PART_SIZE.balcony.sz * 0.5;
    let ox = 0, oz = 0;
    if (face === 0) ox =  halfX + project;
    if (face === 1) ox = -(halfX + project);
    if (face === 2) oz =  halfZ + project;
    if (face === 3) oz = -(halfZ + project);
    const faceLen = (face === 0 || face === 1) ? sz : sx;
    const width = faceLen * 0.55;
    const scale = 0.90 + hashUnit(seed, 83) * 0.18;
    pieces.push({
      part: "balcony",
      ox,
      oz,
      yaw: (face === 2 || face === 3) ? 0 : Math.PI * 0.5,
      scale,
      worldWidth: width,
      worldHeight: STORE_EXTRA_PART_SIZE.balcony.sy,
    });
  }

  return pieces;
}

/** The host record — one entry per store plot that gets trim. */
export type StoreExtraHost = {
  seed: number;
  /** Plot center in world space. */
  worldX: number;
  worldZ: number;
  /** Host plot's yaw about Y (radians). */
  yaw: number;
  /** Host plot's world footprint (post-scale). */
  sx: number;
  sz: number;
  /** Host plot's current world height (bornT * heightForRole). */
  worldHeight: number;
};

// ── the scene ──────────────────────────────────────────────────────────

export type StoreExtrasOptions = {
  /** Upper bound of instances per part-mesh. Sized once; unused slots
   *  ride at count=0 without an allocation. A safe worst case is
   *  `maxPlots` since a single store contributes at most one piece per
   *  part type. */
  maxInstancesPerPart: number;
  shadows?: boolean;
};

export type StoreExtrasScene = {
  /** Wrapping Group. Add this to any parent scene. */
  group: THREE.Group;
  /** One InstancedMesh per part. Exposed for tests + debug overlays. */
  meshes: Record<StoreExtraPart, THREE.InstancedMesh>;
  syncHosts(hosts: readonly StoreExtraHost[]): void;
  setShadows(on: boolean): void;
  dispose(): void;
};

/**
 * PBR material for each part. Cornice = pale limestone with a matte
 * finish; awning = saturated canvas with a slightly darker soffit
 * (baked into the merged geometry); balcony = weathered dark metal
 * that catches a bright specular highlight against the wall behind.
 *
 * Every part is a MeshStandardMaterial — the trim never needs
 * transmission or clearcoat, it just needs to sit in the same PBR
 * sun/IBL as the walls beneath it.
 */
function makeMaterial(part: StoreExtraPart): THREE.MeshStandardMaterial {
  if (part === "cornice") {
    return new THREE.MeshStandardMaterial({
      color: 0xd7cfbe,       // pale weathered limestone
      roughness: 0.86,
      metalness: 0.04,
    });
  }
  if (part === "awning") {
    return new THREE.MeshStandardMaterial({
      color: 0x8f3a2c,       // rusty canvas red — reads at dusk against tungsten window light
      roughness: 0.92,
      metalness: 0.02,
    });
  }
  // balcony — dark iron rail
  return new THREE.MeshStandardMaterial({
    color: 0x2a2622,
    roughness: 0.44,
    metalness: 0.68,
  });
}

/**
 * Merge N unit-space BoxGeometries into a single BufferGeometry.
 *
 * Each sub-part is described by an offset + a size (in unit space) so
 * the merged output stays anchored at local origin. Concatenates the
 * `position` and `normal` attributes and the index buffer — enough for
 * PBR shading; the trim never needs UVs since it wears a solid color.
 *
 * This is a small, deterministic implementation (no dependency on
 * BufferGeometryUtils) so the module has zero extra runtime import
 * cost and the merge is stamped at construction time — one merged
 * geometry per InstancedMesh, forever.
 */
function mergeUnitParts(
  subs: readonly { ox: number; oy: number; oz: number; sx: number; sy: number; sz: number }[],
): THREE.BufferGeometry {
  const boxes = subs.map(s => {
    const g = new THREE.BoxGeometry(s.sx, s.sy, s.sz);
    g.translate(s.ox, s.oy, s.oz);
    return g;
  });
  // Concatenate: sum vertex + index counts, splice.
  let vCount = 0;
  let iCount = 0;
  for (const g of boxes) {
    vCount += g.attributes.position.count;
    const idx = g.getIndex();
    iCount += idx ? idx.count : g.attributes.position.count;
  }
  const posOut = new Float32Array(vCount * 3);
  const nrmOut = new Float32Array(vCount * 3);
  const idxOut = new Uint32Array(iCount);
  let vOff = 0, iOff = 0;
  for (const g of boxes) {
    const pa = g.attributes.position as THREE.BufferAttribute;
    const na = g.attributes.normal   as THREE.BufferAttribute;
    const ia = g.getIndex();
    const vN = pa.count;
    posOut.set(pa.array as Float32Array, vOff * 3);
    nrmOut.set(na.array as Float32Array, vOff * 3);
    if (ia) {
      for (let k = 0; k < ia.count; k += 1) {
        idxOut[iOff + k] = (ia.array as ArrayLike<number>)[k] + vOff;
      }
      iOff += ia.count;
    } else {
      for (let k = 0; k < vN; k += 1) idxOut[iOff + k] = k + vOff;
      iOff += vN;
    }
    vOff += vN;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(posOut, 3));
  merged.setAttribute("normal",   new THREE.BufferAttribute(nrmOut, 3));
  merged.setIndex(new THREE.BufferAttribute(idxOut, 1));
  return merged;
}

/**
 * Build the merged BufferGeometry for a part.
 *
 * The unit geometry is anchored so that (0,0,0) is the ATTACHMENT
 * POINT on the wall the piece hangs from — at unit y=0 for the awning
 * and balcony, and at the parapet plane for the cornice. The instance
 * matrix places (0,0,0) at the wall's world coordinate and scales the
 * unit box to world size.
 *
 *   cornice: a single slab at unit size 1x1x1 anchored so its top
 *            sits at local y=0 (i.e. the slab hangs down from the
 *            parapet). Simple; the "merge" is a single sub-box, kept
 *            in the merge helper for shape consistency with the
 *            other two.
 *   awning:  two sub-boxes — a top canvas slab at y=+0.5, and a
 *            slightly slimmer soffit slab at y=-0.05 that sticks out
 *            a hair below. Both anchored so local z=+0 sits on the
 *            wall face and local z=+1 is the outer edge.
 *   balcony: two sub-boxes — a deck slab at y=+0.1 (the walking
 *            surface) and a thin rail at y=+0.75, both hanging out
 *            from the wall along +z with local width along local x.
 */
function makeGeometry(part: StoreExtraPart): THREE.BufferGeometry {
  if (part === "cornice") {
    // A single overhang slab — top at y=0 so the instance matrix places
    // the slab's top surface exactly at parapet plane, and the slab
    // sticks DOWN from there.
    return mergeUnitParts([
      { ox: 0, oy: -0.5, oz: 0, sx: 1, sy: 1, sz: 1 },
    ]);
  }
  if (part === "awning") {
    // Awning wedge — anchored so local z=0 is against the wall,
    // local z=+1 is the front edge, local y=0 is where the awning
    // meets the wall (mid-height of shopfront). Two sub-boxes:
    //   top canvas: at (0, +0.35, +0.5), size (1, 0.7, 1)
    //   soffit:     at (0, -0.10, +0.5), size (0.94, 0.1, 0.96)
    // The soffit slab is a hair narrower + thinner and hangs below —
    // reads as a canvas back-lit by the sidewalk bounce.
    return mergeUnitParts([
      { ox: 0, oy:  0.35, oz: 0.5, sx: 1.00, sy: 0.70, sz: 1.00 },
      { ox: 0, oy: -0.10, oz: 0.5, sx: 0.94, sy: 0.12, sz: 0.96 },
    ]);
  }
  // balcony — two sub-boxes: deck slab + rail top.
  //   deck: at (0, +0.10, +0.5), size (1.00, 0.10, 1.00)
  //   rail: at (0, +0.75, +0.5), size (0.98, 0.06, 0.98)
  // The rail sits nearly a meter above the deck; on stores this reads
  // as an iron-railing balcony at the third floor. Both anchored so
  // local z=+0 is against the wall.
  return mergeUnitParts([
    { ox: 0, oy: 0.10, oz: 0.5, sx: 1.00, sy: 0.10, sz: 1.00 },
    { ox: 0, oy: 0.75, oz: 0.5, sx: 0.98, sy: 0.06, sz: 0.98 },
  ]);
}

/**
 * Build the store-extras scene. Adds three InstancedMeshes to a
 * wrapping Group; the caller adds the Group to whatever parent scene
 * the skyline lives in.
 */
export function createStoreExtrasScene(opts: StoreExtrasOptions): StoreExtrasScene {
  const shadowsOn = opts.shadows !== false;
  const group = new THREE.Group();
  group.name = "cityStoreExtras";

  const meshes = {} as Record<StoreExtraPart, THREE.InstancedMesh>;
  const materials: THREE.MeshStandardMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  for (const part of STORE_EXTRA_PARTS) {
    const geo = makeGeometry(part);
    const mat = makeMaterial(part);
    geometries.push(geo);
    materials.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, opts.maxInstancesPerPart);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = shadowsOn;
    mesh.receiveShadow = shadowsOn;
    mesh.count = 0;
    mesh.name = `cityStoreExtras.${part}`;
    group.add(mesh);
    meshes[part] = mesh;
  }

  // Temporaries reused per syncHosts call — a hot path (up to
  // MAX_PLOTS pieces per part per resync).
  const _pos = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4();

  function syncHosts(hosts: readonly StoreExtraHost[]): void {
    // Per-part write index. Every part starts at 0 and grows as pieces
    // are appended. When a part's count exceeds maxInstancesPerPart the
    // extras are silently dropped — the InstancedMesh's fixed buffer
    // cannot grow at runtime, and the settlement's worst-case count is
    // bounded by MAX_PLOTS which is well under the sized buffer.
    const idx: Record<StoreExtraPart, number> = { cornice: 0, awning: 0, balcony: 0 };
    const cap = opts.maxInstancesPerPart;

    for (const host of hosts) {
      const pieces = storeExtraPiecesFor(host.seed, host.sx, host.sz, host.worldHeight);
      const cosY = Math.cos(host.yaw);
      const sinY = Math.sin(host.yaw);

      for (const p of pieces) {
        const i = idx[p.part];
        if (i >= cap) continue; // buffer full — drop rest for this part
        const mesh = meshes[p.part];

        // Rotate the local piece offset by the host's yaw so a store
        // whose long axis snapped to a diagonal street places its
        // trim along that same diagonal wall.
        const wx = host.worldX + cosY * p.ox - sinY * p.oz;
        const wz = host.worldZ + sinY * p.ox + cosY * p.oz;

        // World Y — the piece rides the current bornT-scaled height.
        // Cornice sits at ~top of the box; awning at ground-floor;
        // balcony at ~62%. See extraYFractionFor.
        const yFrac = extraYFractionFor(p.part);
        const wy = host.worldHeight * yFrac;

        // Per-part scaling: cornice + awning + balcony each read their
        // own worldWidth (face-parallel length) + worldHeight so the
        // trim widens with the store it hangs from.
        let scaleX = p.worldWidth * p.scale;
        let scaleY = p.worldHeight * p.scale;
        let scaleZ: number;
        if (p.part === "cornice") {
          // The cornice slab hangs BELOW the parapet: unit-space anchor
          // at top means y-scale sizes the DROP of the ledge.
          scaleY = STORE_EXTRA_PART_SIZE.cornice.sy * p.scale;
          // Both horizontal axes scale to the plot footprint — worldWidth
          // = sx * 1.06, and the second dimension = sz * 1.06 (baked
          // into worldHeight for cornices; see storeExtraPiecesFor).
          scaleZ = p.worldHeight * p.scale;
          // For the cornice the "worldWidth" carries sx dimension and
          // "worldHeight" carries sz dimension; y-scale is the fixed
          // baseline set above.
        } else {
          // Awning / balcony — the wedge projects outward along local z.
          // Fixed baseline projection so a wider store doesn't stretch
          // the projection unrealistically.
          scaleZ = STORE_EXTRA_PART_SIZE[p.part].sz * p.scale;
        }

        _pos.set(wx, wy, wz);
        _q.setFromAxisAngle(_yAxis, host.yaw + p.yaw);
        _s.set(scaleX, scaleY, scaleZ);
        _m.compose(_pos, _q, _s);
        mesh.setMatrixAt(i, _m);
        idx[p.part] = i + 1;
      }
    }

    // Commit each part's count + flag the matrix buffer for GPU upload.
    for (const part of STORE_EXTRA_PARTS) {
      const mesh = meshes[part];
      mesh.count = idx[part];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function setShadows(on: boolean): void {
    for (const part of STORE_EXTRA_PARTS) {
      const mesh = meshes[part];
      mesh.castShadow = on;
      mesh.receiveShadow = on;
    }
  }

  function dispose(): void {
    for (const g of geometries) {
      try { g.dispose(); } catch { /* noop */ }
    }
    for (const m of materials) {
      try { m.dispose(); } catch { /* noop */ }
    }
    for (const part of STORE_EXTRA_PARTS) {
      const mesh = meshes[part];
      if (mesh.parent) mesh.parent.remove(mesh);
    }
  }

  return { group, meshes, syncHosts, setShadows, dispose };
}
