/**
 * city-rooftop — the mechanical clutter on top of real buildings.
 *
 * Every SF/London roof in the reference photos is a jungle: AC
 * condensers, cylindrical water tanks, boxy elevator penthouses, thin
 * vent stacks. A flat lid without this reads as game asset; even one
 * penthouse with a vent stack next to it reads as a real place.
 *
 * This module is the shared clutter pack. Four InstancedMeshes hold
 * every piece across every host plot:
 *
 *   ac        — BoxGeometry rooftop AC condenser
 *   water     — CylinderGeometry water tank
 *   penthouse — taller BoxGeometry elevator penthouse
 *   vent      — thin CylinderGeometry vent stack
 *
 * Four draw calls total, regardless of how many pieces the settlement
 * asks for. Every piece's position and size is deterministic in the
 * host plot's seed, so a rebuild lands at the same silhouette; the
 * per-piece choice of part is a small mulberry-style seeded walk so a
 * row of stores still reads as a row of individual rooftops.
 *
 * The clutter caller (city-geometry.createSkylineScene) collects the
 * per-plot host record for each event tower and each store, then
 * hands the batch to `syncHosts`. This module owns no dwell logic and
 * no role ladder — it just paints the clutter the host asks for.
 *
 * All world-space math. The pieces do NOT ride the host plot's
 * matrix; they live at the plot's world center with a fixed world
 * size so a doubled plot doesn't double-scale its condenser. This
 * matters at the wide zoom: the whole city catches sun rake at
 * golden hour and the clutter's own self-shadow onto the roof plane
 * reads correctly regardless of the plot beneath it.
 */

import * as THREE from "three";
import { hashUnit, type EventVariant } from "@/lib/city-geometry-pure";

/** The four part types. Kept as a `const` tuple so a regression that
 *  drops one is loud at type-check. */
export const ROOFTOP_PARTS = ["ac", "water", "penthouse", "vent"] as const;
export type RooftopPart = typeof ROOFTOP_PARTS[number];

/**
 * Baseline WORLD-space size for each part. The instance matrix scales
 * around this baseline by a per-piece `scale` (0.85..1.17) so a row
 * of AC condensers doesn't stamp. Sizes tuned so the clutter reads at
 * pedestrian scale next to the human-scale stores (5..15 m tall) and
 * still catches a highlight against a 30 m event tower.
 */
export const ROOFTOP_PART_SIZE: Record<RooftopPart, { sx: number; sy: number; sz: number }> = {
  ac:        { sx: 1.10, sy: 0.62, sz: 1.10 },
  water:     { sx: 0.72, sy: 1.10, sz: 0.72 },
  penthouse: { sx: 1.55, sy: 1.85, sz: 2.10 },
  vent:      { sx: 0.16, sy: 1.25, sz: 0.16 },
};

/** Deterministic piece count for a host plot.
 *   event → 3..6 pieces (a busy mechanical roof)
 *   store → 1..3 pieces (a single condenser or a small cluster) */
export function clutterCountFor(role: "store" | "event", seed: number): number {
  const t = hashUnit(seed, 61);
  if (role === "event") return 3 + Math.floor(t * 4); // 3..6 inclusive
  return 1 + Math.floor(t * 3);                        // 1..3 inclusive
}

/**
 * Where on the host plot's unit height the "rooftop plane" sits.
 * The clutter's world-Y is `worldHeight * roofYFractionFor(...)`.
 *
 *   store        → 1.02  (top of the box, just above the wall)
 *   event var 0  → 0.58  (Gherkin: below the barrel-swell crown)
 *   event var 1  → 0.64  (Salesforce: on the major setback below the ellipsoid cap)
 *   event var 2  → 0.56  (Transamerica: on the wing prisms, below the pyramid)
 *
 * Placing clutter at these fractions makes the piece read as ON the
 * building silhouette rather than floating above it. A regression that
 * moved the fraction to 1.0 for events would poke the clutter through
 * the top of the pyramid / above the crown.
 */
export function roofYFractionFor(role: "store" | "event", variant?: EventVariant): number {
  if (role === "store") return 1.02;
  if (variant === 0) return 0.58;
  if (variant === 1) return 0.64;
  return 0.56; // variant 2 (Transamerica) or unspecified event
}

/** One deterministic clutter piece — part choice + local offset + yaw + scale. */
export type RooftopPiece = {
  part: RooftopPart;
  /** Offset from plot center in WORLD units (post-yaw), x axis. */
  ox: number;
  /** Offset from plot center in WORLD units (post-yaw), z axis. */
  oz: number;
  /** Yaw jitter about Y in radians, added to the host plot's yaw. */
  yaw: number;
  /** Multiplier around the baseline part size. */
  scale: number;
};

/**
 * Deterministic per-plot piece list.
 *
 * A small mulberry-style seeded walk over `clutterCountFor(role, seed)`
 * indices picks a part per piece, an angular offset within the roof
 * footprint, a yaw jitter, and a size multiplier. Every read is a pure
 * hashUnit — the settlement's clutter stays stable across sessions and
 * across rebuilds triggered by resize or persistence-restore.
 *
 *   sx / sz are the WORLD footprint of the host plot (post-scale).
 *   Pieces sit inside the inner 62% of the footprint so no piece hangs
 *   over the parapet.
 */
export function rooftopPiecesFor(
  role: "store" | "event",
  seed: number,
  sx: number,
  sz: number,
  variant?: EventVariant,
): RooftopPiece[] {
  const n = clutterCountFor(role, seed);
  const pieces: RooftopPiece[] = [];
  const halfX = Math.max(0, sx) * 0.5 * 0.62;
  const halfZ = Math.max(0, sz) * 0.5 * 0.62;
  for (let i = 0; i < n; i += 1) {
    // Part choice — events get a guaranteed penthouse on piece 0 so
    // every event tower reads with the boxy mechanical silhouette that
    // an SF setback carries. Stores never get a penthouse — a corner
    // store with a full elevator machine room reads wrong.
    let part: RooftopPart;
    const partT = hashUnit(seed + i * 7919, 67);
    if (role === "event") {
      if (i === 0) part = "penthouse";
      else if (partT < 0.34) part = "ac";
      else if (partT < 0.62) part = "vent";
      else if (partT < 0.86) part = "water";
      else part = "penthouse";
    } else {
      if (partT < 0.55) part = "ac";
      else if (partT < 0.85) part = "vent";
      else part = "water";
    }

    // Position — polar coordinates on the roof plane. Radius 0.15..1.0
    // of the inner-halved footprint so the penthouse near the center
    // reads first, condensers ring out from it. Angle is a full turn
    // so the ring doesn't clump on one axis.
    const ang = hashUnit(seed + i * 2333, 71) * Math.PI * 2;
    const rad = 0.15 + hashUnit(seed + i * 1789, 73) * 0.85;
    const ox = Math.cos(ang) * rad * halfX;
    const oz = Math.sin(ang) * rad * halfZ;

    // Yaw jitter — ±26° so an AC unit doesn't perfectly axis-align with
    // the plot; feels like the janitor rotated it to fit around a duct.
    const yaw = (hashUnit(seed + i * 4111, 79) - 0.5) * 0.9;

    // Size multiplier — a modest spread. Penthouses stay closer to 1.0
    // so they don't dwarf the tower; smaller parts (vent, water) get
    // the wider spread.
    const scaleT = hashUnit(seed + i * 9137, 83);
    const scale = part === "penthouse" ? 0.92 + scaleT * 0.16 : 0.85 + scaleT * 0.32;

    pieces.push({ part, ox, oz, yaw, scale });
  }
  return pieces;
}

/** The host record — one entry per store / event plot that gets clutter. */
export type RooftopHost = {
  role: "store" | "event";
  seed: number;
  variant?: EventVariant;
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

export type RooftopOptions = {
  /** Upper bound of instances per part-mesh. Sized once; unused slots
   *  ride at count=0 without an allocation. A safe worst case is
   *  `maxPlots * 6` since a single plot can source up to 6 pieces. */
  maxInstancesPerPart: number;
  shadows?: boolean;
};

export type RooftopScene = {
  /** Wrapping Group. Add this to any parent scene. */
  group: THREE.Group;
  /** One InstancedMesh per part. Exposed for tests + debug overlays. */
  meshes: Record<RooftopPart, THREE.InstancedMesh>;
  syncHosts(hosts: readonly RooftopHost[]): void;
  setShadows(on: boolean): void;
  dispose(): void;
};

function makeMaterial(part: RooftopPart): THREE.MeshStandardMaterial {
  // PBR: matte-metal condenser, painted-steel water tank, brick-ish
  // penthouse, dark galvanized vent. Every part is a MeshStandardMaterial
  // — the clutter never needs transmission or clearcoat, it just needs
  // to be visible under the same sun/IBL as the walls beneath it.
  if (part === "ac") {
    return new THREE.MeshStandardMaterial({
      color: 0x8b9095,
      roughness: 0.66,
      metalness: 0.42,
    });
  }
  if (part === "water") {
    return new THREE.MeshStandardMaterial({
      color: 0x3c4a3a,
      roughness: 0.74,
      metalness: 0.18,
    });
  }
  if (part === "penthouse") {
    return new THREE.MeshStandardMaterial({
      color: 0x776a5d,
      roughness: 0.88,
      metalness: 0.06,
    });
  }
  // vent
  return new THREE.MeshStandardMaterial({
    color: 0x3a3a38,
    roughness: 0.46,
    metalness: 0.72,
  });
}

function makeGeometry(part: RooftopPart): THREE.BufferGeometry {
  // Every geometry is baked at unit size 1×1×1 and translated so its
  // base sits at local y=0 and top at y=1. The instance matrix then
  // scales x/y/z to `ROOFTOP_PART_SIZE[part] * piece.scale`. This lets
  // the same InstancedMesh serve pieces of slightly different sizes
  // without a per-piece geometry allocation.
  if (part === "ac") {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  }
  if (part === "water") {
    // Cylinder with a slightly narrower top — a real rooftop tank has
    // a lid narrower than its base by a few percent.
    const g = new THREE.CylinderGeometry(0.46, 0.5, 1, 20, 1, false);
    g.translate(0, 0.5, 0);
    return g;
  }
  if (part === "penthouse") {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  }
  // vent — thin cylinder
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * Build the rooftop clutter scene. Adds four InstancedMeshes to a
 * wrapping Group; the caller adds the Group to whatever parent scene
 * the skyline lives in.
 */
export function createRooftopScene(opts: RooftopOptions): RooftopScene {
  const shadowsOn = opts.shadows !== false;
  const group = new THREE.Group();
  group.name = "cityRooftopClutter";

  const meshes = {} as Record<RooftopPart, THREE.InstancedMesh>;
  const materials: THREE.MeshStandardMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  for (const part of ROOFTOP_PARTS) {
    const geo = makeGeometry(part);
    const mat = makeMaterial(part);
    geometries.push(geo);
    materials.push(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, opts.maxInstancesPerPart);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = shadowsOn;
    mesh.receiveShadow = shadowsOn;
    mesh.count = 0;
    mesh.name = `cityRooftopClutter.${part}`;
    group.add(mesh);
    meshes[part] = mesh;
  }

  // Temporaries reused per syncHosts call — a hot path (up to
  // MAX_PLOTS * 6 pieces per resync).
  const _pos = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _m = new THREE.Matrix4();

  function syncHosts(hosts: readonly RooftopHost[]): void {
    // Per-part write index. Every part starts at 0 and grows as pieces
    // are appended. When a part's count exceeds maxInstancesPerPart the
    // extras are silently dropped — the InstancedMesh's fixed buffer
    // cannot grow at runtime, and the settlement's worst-case count is
    // bounded by MAX_PLOTS * 6 which is well under the sized buffer.
    const idx: Record<RooftopPart, number> = { ac: 0, water: 0, penthouse: 0, vent: 0 };
    const cap = opts.maxInstancesPerPart;

    for (const host of hosts) {
      const pieces = rooftopPiecesFor(host.role, host.seed, host.sx, host.sz, host.variant);
      const roofFrac = roofYFractionFor(host.role, host.variant);
      const roofY = host.worldHeight * roofFrac;
      const cosY = Math.cos(host.yaw);
      const sinY = Math.sin(host.yaw);

      for (const p of pieces) {
        const i = idx[p.part];
        if (i >= cap) continue; // buffer full — drop rest for this part
        const mesh = meshes[p.part];

        // Rotate the local piece offset by the host's yaw so a store
        // whose long axis snapped to a diagonal street places its
        // clutter along that same diagonal.
        const wx = host.worldX + cosY * p.ox - sinY * p.oz;
        const wz = host.worldZ + sinY * p.ox + cosY * p.oz;
        const base = ROOFTOP_PART_SIZE[p.part];
        _pos.set(wx, roofY, wz);
        _q.setFromAxisAngle(_yAxis, host.yaw + p.yaw);
        _s.set(base.sx * p.scale, base.sy * p.scale, base.sz * p.scale);
        _m.compose(_pos, _q, _s);
        mesh.setMatrixAt(i, _m);
        idx[p.part] = i + 1;
      }
    }

    // Commit each part's count + flag the matrix buffer for GPU upload.
    for (const part of ROOFTOP_PARTS) {
      const mesh = meshes[part];
      mesh.count = idx[part];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function setShadows(on: boolean): void {
    for (const part of ROOFTOP_PARTS) {
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
    for (const part of ROOFTOP_PARTS) {
      const mesh = meshes[part];
      // Detach from parent; InstancedMesh has no dispose beyond its
      // geometry + material, both freed above.
      if (mesh.parent) mesh.parent.remove(mesh);
    }
  }

  return { group, meshes, syncHosts, setShadows, dispose };
}
