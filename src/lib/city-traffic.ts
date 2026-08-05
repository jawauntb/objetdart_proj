/**
 * city-traffic — three InstancedMeshes for the life on the ground.
 *
 *   cars   — 24 chamfered-box vehicles crawling along the visitor-drawn
 *            roads at 4..6 m/s with per-instance speed jitter. Each car
 *            carries a tiny emissive headlight quad that lights only
 *            when night > 0.3, and the bloom pass turns those quads into
 *            warm halos in the dusk-and-lit-windows moment the room hangs
 *            on.
 *   boats  — 6 low chamfered prisms crossing the harbour along the +z
 *            edge at ~1 m/s. Each boat drops a small wake into the
 *            Reflector's proxy scene (a soft blob translating with the
 *            boat) so the reflection catches a stripe of disturbed water.
 *   lamps  — up to 256 posts placed every 8m along both kerbs of every
 *            visitor road. Each post carries a small emissive bulb; there
 *            are no punctual lights on the scene — the existing composer
 *            bloom pass alone sells the halo. Cheap by design: no shadow
 *            maps, no per-lamp draw call, one InstancedMesh per part.
 *
 * The brief calls out that empty streets kill photoreal more than any
 * missing shader. The SF and London references are photoreal partly
 * BECAUSE they hold life at architectural scale: cars on grids, boats on
 * the river, lamp posts marching down every kerb with warm halos at dusk.
 * This module is the plainest possible fulfilment of that: InstancedMesh,
 * one shared PBR material per part, per-instance transforms updated in
 * place with no allocation per frame.
 *
 * The pure exports at the top — CAR_COUNT, BOAT_COUNT, MAX_LAMPS,
 * LAMP_SPACING_M, carSpeedFor, boatSpeedFor, nightEmissiveFor,
 * lampCountForRoadLength, positionAlongRoad — are what test-city-traffic
 * pins without a WebGL context. The three-step process the brief
 * describes (per-instance count + speed range + emissive gate) is
 * exactly what those functions promise.
 *
 * This module has NO import edge back into city.ts's laws. It reads the
 * road array as pure data (shape { x1, y1, x2, y2 } in normalized 0..1
 * coordinates, same space city-water.ts uses for its plot proxies) and
 * remaps to world with CITY_HALF from city-camera.ts.
 */

import * as THREE from "three";

import { CITY_HALF } from "@/lib/city-camera";
import type { QualityTier } from "@/lib/room-runtime";

// ─── pure constants + pinned functions ──────────────────────────────────

/** How many cars advance along the visitor-drawn road graph at any moment.
 * Sized to comfortably feel like a small settlement — a value low enough
 * that four cars on one road never overlap, high enough that a settlement
 * with two or three roads reads as populated. Pinned by test-city-traffic. */
export const CAR_COUNT = 24;

/** How many boats crawl across the harbour. Six is what the London-at-dusk
 * reference shows: a couple of barges, a small ferry, one distant tanker
 * on the horizon. The harbour width is finite; more than this and boats
 * queue visibly, which reads as a jam, not a settlement. */
export const BOAT_COUNT = 6;

/** InstancedMesh capacity for lamp posts. 256 is plenty for 32 roads with
 * 4 lamps per kerb per road; the true count is computed per frame from
 * `lampCountForRoadLength`. */
export const MAX_LAMPS = 256;

/** Distance in world meters between consecutive lamp posts along a road.
 * Eight metres is what the London kerb references show: close enough that
 * the halos overlap softly at dusk, far enough that a road doesn't read
 * as a fence. Pinned by the test so a later tune-up doesn't drift.  */
export const LAMP_SPACING_M = 8;

/** Car speed bounds in world m/s. The brief pins this at 4..6. */
export const CAR_SPEED_MIN = 4;
export const CAR_SPEED_MAX = 6;

/** Boat speed in world m/s. The brief pins this at ~1. */
export const BOAT_SPEED_M_S = 1.0;

/** Night amount at which the headlight/bulb emissive begins to lift off
 * zero. Below this the bloom pass has nothing warm to catch. The brief
 * pins this gate at 0.3; the shader smoothsteps to full at 0.55 so the
 * light doesn't snap on at the exact threshold. */
export const NIGHT_EMISSIVE_GATE = 0.3;
const NIGHT_EMISSIVE_TOP = 0.55;

/** Little deterministic 32-bit hash → unit float. Same shape the rest of
 * the /city library uses; not exported because there's no need to
 * cross-check hash equivalence between modules — the tests pin the
 * function outputs, not the internals. */
function unitHash(seed: number, salt: number): number {
  let x = ((seed | 0) ^ ((salt * 0x9e3779b1) | 0)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 0xffffffff;
}

/**
 * A deterministic per-car speed in [CAR_SPEED_MIN, CAR_SPEED_MAX]. Pure
 * function of the car's seed so the tests can pin the range without
 * running the module against a WebGL context. Every car in the InstancedMesh
 * carries its own seed (index-based) and gets its own steady pace — one
 * road with three cars reads as three distinct drivers, not a clock.
 */
export function carSpeedFor(seed: number): number {
  const u = unitHash(seed, 0x1cad);
  return CAR_SPEED_MIN + u * (CAR_SPEED_MAX - CAR_SPEED_MIN);
}

/**
 * A deterministic per-boat speed jitter, in world m/s. Boats hold near
 * BOAT_SPEED_M_S with ±0.2 m/s per-instance drift — enough that six boats
 * on the same harbour cross the frame at visibly different rates.
 */
export function boatSpeedFor(seed: number): number {
  const u = unitHash(seed, 0x2b0a);
  return BOAT_SPEED_M_S + (u - 0.5) * 0.4;
}

/**
 * The night-gated emissive multiplier. Zero for nightAmt ≤ 0.3, ramps to
 * 1 by nightAmt ≥ 0.55 via smoothstep. The bloom pass is what makes the
 * bulbs read as halos; this scalar drives their emissive intensity.
 */
export function nightEmissiveFor(nightAmt: number): number {
  const n = Math.max(0, Math.min(1, nightAmt || 0));
  if (n <= NIGHT_EMISSIVE_GATE) return 0;
  if (n >= NIGHT_EMISSIVE_TOP) return 1;
  const t = (n - NIGHT_EMISSIVE_GATE) / (NIGHT_EMISSIVE_TOP - NIGHT_EMISSIVE_GATE);
  return t * t * (3 - 2 * t);
}

/**
 * How many lamp posts a road of world length `lengthM` carries per kerb.
 * A road of length exactly 8 m gets two lamps (one at each end), a road
 * of 16 m gets three lamps, etc. Zero-length or negative inputs give one
 * lamp — a mistaken road stays visible as a single street light. Clamped
 * high at 24 lamps per kerb so a run-away road doesn't consume MAX_LAMPS.
 */
export function lampCountForRoadLength(lengthM: number): number {
  if (!Number.isFinite(lengthM) || lengthM <= 0) return 1;
  return Math.min(24, Math.max(1, Math.floor(lengthM / LAMP_SPACING_M) + 1));
}

/**
 * A point along a normalized road at parameter t in [0..1], reported as
 * normalized (nx, ny) coordinates. Wraps out-of-range t modulo 1 so a
 * car's advance can add speed*dt without a branch.
 */
export function positionAlongRoad(
  road: { x1: number; y1: number; x2: number; y2: number },
  t: number,
): { nx: number; ny: number } {
  const tt = ((t % 1) + 1) % 1;
  return {
    nx: road.x1 + tt * (road.x2 - road.x1),
    ny: road.y1 + tt * (road.y2 - road.y1),
  };
}

/**
 * The world-space heading (radians, standard atan2 in the XZ plane)
 * a car should face at any point along the given normalized road. The
 * yaw is derived from the world-space direction (dx, dz) after the
 * normalized road is remapped to XZ with CITY_HALF.
 */
export function roadYawFor(road: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = (road.x2 - road.x1) * 2 * CITY_HALF;
  const dz = (road.y2 - road.y1) * 2 * CITY_HALF;
  return Math.atan2(dx, dz);
}

/**
 * Road world-length in metres. Same remap the rest of the module uses:
 * normalized delta × 2 × CITY_HALF is a world-metre delta on either axis.
 * Exported so the same function shows in tests as the code path the
 * traffic module actually uses.
 */
export function roadWorldLength(road: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = (road.x2 - road.x1) * 2 * CITY_HALF;
  const dz = (road.y2 - road.y1) * 2 * CITY_HALF;
  return Math.sqrt(dx * dx + dz * dz);
}

// ─── traffic scene ──────────────────────────────────────────────────────

/** The road shape City.tsx already carries. The `bornMs` and other fields
 * on the visitor's Road struct are ignored here; the module only needs the
 * four normalized endpoints. */
export type TrafficRoad = { x1: number; y1: number; x2: number; y2: number };

/** The harbour geometry the boat lane rides in. City.tsx passes the same
 * strip the water module uses so the wake proxies land under the reflector. */
export type TrafficHarbour = {
  /** Centre Z of the water plane in world coordinates. */
  centerZ: number;
  /** Depth of the water strip in world metres. */
  depth: number;
  /** Half-width of the water strip in world metres (spans [-halfWidth, +halfWidth]). */
  halfWidth: number;
  /** Y-position of the water surface. Boats float at surface + boatFreeboard. */
  surfaceY: number;
};

/** The wake proxy shape the water module reads to soften the reflection
 * around a boat's stern. Exposed so City.tsx can hand a live snapshot to
 * the harbour without a shared mutable buffer. */
export type TrafficWakeProxy = {
  /** World-space x of the wake centre. */
  x: number;
  /** World-space z of the wake centre. */
  z: number;
  /** Wake amplitude 0..1 — 1 while the boat is moving, tapers to 0 as it
   * exits the harbour. */
  strength: number;
};

/** The public API createCityTraffic returns. */
export type CityTraffic = {
  /** The Object3D tree City.tsx adds to the skyline scene so all three
   * InstancedMeshes ride through the same camera and bloom pass. */
  group: THREE.Group;
  /** Push the visitor's live road array. Idempotent — same roads twice
   * only pays for the lamp-count recompute inside. */
  setRoads(roads: ReadonlyArray<TrafficRoad>): void;
  /** Per-frame update: advances every car and boat, drives the emissive
   * gate, and hands back a live wake-proxy list the water module reads. */
  update(u: TrafficUpdate): ReadonlyArray<TrafficWakeProxy>;
  /** Drop GL resources. Call before renderer.dispose(). */
  dispose(): void;
};

export type TrafficUpdate = {
  /** ms elapsed since the last update — feeds every car's forward step. */
  dtMs: number;
  /** Night amount 0..1, same value the ground shader takes. Gates emissive. */
  night: number;
  /** Current governor tier. Sleep hides the traffic group entirely. */
  tier: QualityTier;
};

export type CityTrafficOptions = {
  /** The harbour strip the boats cross. Fixed at construction; if the
   * water module later reshapes the strip, rebuild the traffic. */
  harbour: TrafficHarbour;
  /** Optional per-mount seed for the car/boat/lamp jitter. Default is a
   * fixed constant so a remount produces the same distribution — a
   * settlement remounted from persistence sees the same cars. */
  seed?: number;
};

// ─── module-internal state carriers ─────────────────────────────────────
// Kept out of createCityTraffic() so the JS engine doesn't recreate the
// per-instance state layout on every mount. The state itself is per-
// instance and lives inside the factory.

type CarState = {
  /** Which road index the car currently advances along. May be -1 while
   * the visitor has drawn no roads — car is hidden. */
  roadIdx: number;
  /** Parameter along the road in [0..1]. Wraps at 1; on wrap we may
   * hop to a different road so the car reads as circulating. */
  t: number;
  /** Per-instance speed, cached from carSpeedFor(seed). */
  speedMs: number;
  /** Per-instance seed. Determines colour, speed, headlight offset. */
  seed: number;
};

type BoatState = {
  /** Parameter along the harbour crossing in [0..1]. Wraps at 1 so the
   * boat re-enters from the other side. */
  t: number;
  /** Direction 1 = +x, -1 = -x. Fixed at construction per-instance so
   * some boats cross east, some west. */
  dir: 1 | -1;
  /** Per-boat z-offset within the harbour depth, in world metres. */
  zOffset: number;
  /** Per-boat width in world metres. */
  width: number;
  /** Per-boat length in world metres. */
  length: number;
  /** Per-boat seed for colour + wake strength taper. */
  seed: number;
};

// ─── car mesh construction ──────────────────────────────────────────────
// Chamfered box: the box has soft top edges so the sunset light rakes a
// small highlight along the roof rather than reading as a shipping crate.
// We build it once per module load; the InstancedMesh reuses this geometry
// for every car (transform + colour is per-instance).
function buildChamferedCarBody(): THREE.BufferGeometry {
  // A 4.2 m long, 1.8 m wide, 1.4 m tall car with the top slightly narrower
  // than the base (a subtle taper, like a saloon or a small SUV). Built
  // from an extruded shape so the corners chamfer softly.
  const shape = new THREE.Shape();
  const w = 0.9;   // half-width at the base
  const wt = 0.72; // half-width at the top (subtle taper)
  const halfL = 2.1;
  shape.moveTo(-halfL, -w);
  shape.lineTo(halfL, -w);
  shape.lineTo(halfL, w);
  shape.lineTo(-halfL, w);
  shape.lineTo(-halfL, -w);
  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: 1.4,
    bevelEnabled: true,
    bevelThickness: 0.22,
    bevelSize: 0.22,
    bevelSegments: 2,
    curveSegments: 3,
  };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  // ExtrudeGeometry produces vertices in the XY plane with depth on +Z; we
  // want the car flat on the ground (XZ plane) with height on +Y and the
  // taper applied so the top narrows relative to the base. First rotate
  // the extrude axis onto +Y, then squeeze the top faces inward on X to
  // give the taper. The subtle squeeze is what reads as a car body vs a
  // brick — the shader's highlight walks the taper at sunset.
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    if (y > 1.0) {
      const ratio = wt / w;
      pos.setX(i, pos.getX(i) * ratio);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// A small emissive quad that sits in front of the car — the headlights.
// The quad is 0.9 m wide, 0.35 m tall, and lives 0.2 m in front of the
// car's forward face. Two quads per car (left+right) would be ideal but
// one wide quad reads as a pair of lights once bloom takes over, and
// halves the instance count. The material's emissive is scaled per-
// instance by nightEmissiveFor(night).
function buildHeadlightQuad(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1.6, 0.36, 1, 1);
}

// ─── boat mesh ──────────────────────────────────────────────────────────
function buildBoatHull(): THREE.BufferGeometry {
  // A low chamfered prism: 8 m long, 2.4 m wide, 1 m tall, with a bow taper.
  const shape = new THREE.Shape();
  const halfL = 4;
  const halfW = 1.2;
  shape.moveTo(halfL, 0);           // bow tip
  shape.lineTo(halfL * 0.6, halfW);  // starboard shoulder
  shape.lineTo(-halfL, halfW);       // stern starboard
  shape.lineTo(-halfL, -halfW);      // stern port
  shape.lineTo(halfL * 0.6, -halfW); // port shoulder
  shape.lineTo(halfL, 0);
  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: 1.0,
    bevelEnabled: true,
    bevelThickness: 0.15,
    bevelSize: 0.15,
    bevelSegments: 1,
    curveSegments: 3,
  };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

// ─── lamp post + bulb ───────────────────────────────────────────────────
function buildLampPost(): THREE.BufferGeometry {
  // 4.2 m tall, 0.10 m diameter cylinder. Bevelled top by adding a small
  // cap so the bulb sits on a lip instead of floating in the air.
  const geo = new THREE.CylinderGeometry(0.05, 0.075, 4.2, 8, 1, false);
  geo.translate(0, 2.1, 0); // base sits at y=0
  return geo;
}
function buildLampBulb(): THREE.BufferGeometry {
  // 0.28 m radius sphere, low poly. Emissive under night gate.
  const geo = new THREE.SphereGeometry(0.28, 10, 6);
  geo.translate(0, 4.3, 0); // sits just above the post
  return geo;
}

// ─── the factory ────────────────────────────────────────────────────────

export function createCityTraffic(opts: CityTrafficOptions): CityTraffic {
  const seed = opts.seed ?? 0x51ad7e;

  const group = new THREE.Group();
  group.name = "cityTraffic";

  // ── shared materials ────────────────────────────────────────────────
  // Cars: a matte PBR body that reads under the sky IBL. Instance colour
  // varies per car via THREE's `instanceColor` attribute. Metalness low
  // so a car doesn't read as a chrome brick; roughness middling so the
  // sun catches a small highlight along the taper.
  const carBodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff), // multiplied by instanceColor
    metalness: 0.35,
    roughness: 0.5,
  });
  const carHeadlightMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xfff2c8),
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // Boats: warmer roughness — a barge reads as painted metal, not car
  // enamel — with per-instance colour picking a couple of hues per seed.
  const boatMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    metalness: 0.15,
    roughness: 0.75,
  });
  // Lamp post: near-black painted iron. Instance colour uniform grey so
  // the InstancedMesh doesn't allocate an instanceColor buffer for parts
  // that are all the same colour.
  const lampPostMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x1a1c22),
    metalness: 0.6,
    roughness: 0.55,
  });
  // Bulb: cheap emissive sphere. Emissive intensity is driven per-frame by
  // nightEmissiveFor(nightAmt); the bloom pass is what turns it into a
  // halo. Colour is a warm tungsten — 3000K-ish — to match the lit-window
  // emissive the plot atlas writes.
  const lampBulbMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffc078),
    emissive: new THREE.Color(0xffc078),
    emissiveIntensity: 0,
    roughness: 0.4,
    metalness: 0.0,
  });

  // ── car instances ───────────────────────────────────────────────────
  const carBodyGeo = buildChamferedCarBody();
  const headlightGeo = buildHeadlightQuad();

  const carBody = new THREE.InstancedMesh(carBodyGeo, carBodyMat, CAR_COUNT);
  carBody.castShadow = false; // shadows come from the sun on the world scene
  carBody.receiveShadow = false;
  carBody.name = "cars-body";
  carBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Per-instance colour so 24 cars read as different vehicles.
  const carColorArr = new Float32Array(CAR_COUNT * 3);
  for (let i = 0; i < CAR_COUNT; i += 1) {
    // A palette of muted paint hues — silver, navy, red, olive, white,
    // black — the mix a London street reference actually shows.
    const paletteIdx = Math.floor(unitHash(seed, i * 13 + 0x7e) * 6);
    const palette: Array<[number, number, number]> = [
      [0.75, 0.76, 0.78], // silver
      [0.13, 0.18, 0.28], // navy
      [0.55, 0.16, 0.18], // deep red
      [0.30, 0.35, 0.24], // olive
      [0.92, 0.92, 0.90], // off-white
      [0.09, 0.09, 0.10], // near-black
    ];
    const c = palette[Math.max(0, Math.min(palette.length - 1, paletteIdx))];
    carColorArr[i * 3 + 0] = c[0];
    carColorArr[i * 3 + 1] = c[1];
    carColorArr[i * 3 + 2] = c[2];
  }
  carBody.instanceColor = new THREE.InstancedBufferAttribute(carColorArr, 3);
  carBody.instanceColor.setUsage(THREE.StaticDrawUsage);
  group.add(carBody);

  const carLights = new THREE.InstancedMesh(headlightGeo, carHeadlightMat, CAR_COUNT);
  carLights.name = "cars-headlights";
  carLights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  carLights.renderOrder = 2; // draw after the body so the additive quad reads
  group.add(carLights);

  // Per-car state. The InstancedMesh transforms are computed each frame
  // from these; the state itself is what advances.
  const cars: CarState[] = [];
  for (let i = 0; i < CAR_COUNT; i += 1) {
    const carSeed = (seed ^ (i * 0x1b9d1)) >>> 0;
    cars.push({
      roadIdx: -1,
      t: unitHash(carSeed, 0x2a),
      speedMs: carSpeedFor(carSeed),
      seed: carSeed,
    });
  }

  // ── boat instances ──────────────────────────────────────────────────
  const boatGeo = buildBoatHull();
  const boats = new THREE.InstancedMesh(boatGeo, boatMat, BOAT_COUNT);
  boats.name = "boats";
  boats.castShadow = false;
  boats.receiveShadow = false;
  boats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const boatColorArr = new Float32Array(BOAT_COUNT * 3);
  const boatStates: BoatState[] = [];
  for (let i = 0; i < BOAT_COUNT; i += 1) {
    const boatSeed = (seed ^ (i * 0x9e12b)) >>> 0;
    const zSpread = opts.harbour.depth * 0.7; // most of the harbour depth
    const zOffset = (unitHash(boatSeed, 0x4b) - 0.5) * zSpread;
    const dir: 1 | -1 = unitHash(boatSeed, 0x11) > 0.5 ? 1 : -1;
    const width = 2.0 + unitHash(boatSeed, 0x77) * 1.4;
    const length = 6 + unitHash(boatSeed, 0x91) * 8;
    boatStates.push({
      t: unitHash(boatSeed, 0x03),
      dir,
      zOffset,
      width,
      length,
      seed: boatSeed,
    });
    // Colour: mostly hull-blue/red/rust; per-boat seed picks the family.
    const boatPalette: Array<[number, number, number]> = [
      [0.18, 0.24, 0.32], // navy hull
      [0.42, 0.16, 0.14], // rust hull
      [0.28, 0.30, 0.28], // slate grey
      [0.14, 0.20, 0.18], // dark green
    ];
    const bc = boatPalette[Math.floor(unitHash(boatSeed, 0xaa) * boatPalette.length)];
    boatColorArr[i * 3 + 0] = bc[0];
    boatColorArr[i * 3 + 1] = bc[1];
    boatColorArr[i * 3 + 2] = bc[2];
  }
  boats.instanceColor = new THREE.InstancedBufferAttribute(boatColorArr, 3);
  boats.instanceColor.setUsage(THREE.StaticDrawUsage);
  group.add(boats);

  // ── lamp instances ──────────────────────────────────────────────────
  const lampPostGeo = buildLampPost();
  const lampBulbGeo = buildLampBulb();
  const lampPosts = new THREE.InstancedMesh(lampPostGeo, lampPostMat, MAX_LAMPS);
  lampPosts.name = "lamps-post";
  lampPosts.castShadow = false;
  lampPosts.receiveShadow = false;
  lampPosts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  lampPosts.count = 0;
  group.add(lampPosts);

  const lampBulbs = new THREE.InstancedMesh(lampBulbGeo, lampBulbMat, MAX_LAMPS);
  lampBulbs.name = "lamps-bulb";
  lampBulbs.castShadow = false;
  lampBulbs.receiveShadow = false;
  lampBulbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  lampBulbs.count = 0;
  group.add(lampBulbs);

  // ── mutable state carried across frames ─────────────────────────────
  let currentRoads: TrafficRoad[] = [];
  const wakeProxies: TrafficWakeProxy[] = [];
  for (let i = 0; i < BOAT_COUNT; i += 1) {
    wakeProxies.push({ x: 0, z: opts.harbour.centerZ, strength: 0 });
  }

  // Scratch matrices — allocated once, reused every frame.
  const scratchMatrix = new THREE.Matrix4();
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3(1, 1, 1);
  const scratchEuler = new THREE.Euler();

  // ── road → car assignment ───────────────────────────────────────────
  function assignCarsToRoads(): void {
    if (currentRoads.length === 0) {
      for (const car of cars) car.roadIdx = -1;
      return;
    }
    // Round-robin: car i → road (i % roadCount). Cars keep their same
    // road if the road count didn't change; only new roads pick up cars
    // whose previous road disappeared.
    for (let i = 0; i < cars.length; i += 1) {
      const c = cars[i];
      if (c.roadIdx < 0 || c.roadIdx >= currentRoads.length) {
        c.roadIdx = i % currentRoads.length;
      }
    }
  }

  // ── lamp layout ─────────────────────────────────────────────────────
  // Placed once per setRoads() call. Each road gets a lamp every
  // LAMP_SPACING_M metres on both kerbs; lamps sit 1.8 m off the road
  // centreline (the kerb offset). Total is capped at MAX_LAMPS so a
  // pathologically long road list can't overflow.
  function relayoutLamps(): void {
    let placed = 0;
    for (const road of currentRoads) {
      const worldLen = roadWorldLength(road);
      if (worldLen <= 0.001) continue;
      const perKerb = lampCountForRoadLength(worldLen);
      const yaw = roadYawFor(road);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      // Kerb offset in world metres, perpendicular to the road direction.
      // With yaw derived from (dx, dz), the perpendicular in XZ is
      // (cos(yaw), -sin(yaw)) rotated 90° → (dz, -dx) normalized, which
      // in trig terms is (cos(yaw+π/2), -sin(yaw+π/2)) = (-sin, -cos).
      const kerb = 1.8;
      for (let side = 0; side < 2; side += 1) {
        const s = side === 0 ? 1 : -1;
        const ox = -sin * kerb * s;
        const oz = -cos * kerb * s;
        for (let i = 0; i < perKerb; i += 1) {
          if (placed >= MAX_LAMPS) break;
          const t = perKerb === 1 ? 0.5 : i / (perKerb - 1);
          const pos = positionAlongRoad(road, t);
          const worldX = (pos.nx - 0.5) * 2 * CITY_HALF + ox;
          const worldZ = (pos.ny - 0.5) * 2 * CITY_HALF + oz;
          scratchPos.set(worldX, 0, worldZ);
          scratchEuler.set(0, yaw, 0);
          scratchQuat.setFromEuler(scratchEuler);
          scratchScale.set(1, 1, 1);
          scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
          lampPosts.setMatrixAt(placed, scratchMatrix);
          lampBulbs.setMatrixAt(placed, scratchMatrix);
          placed += 1;
        }
        if (placed >= MAX_LAMPS) break;
      }
      if (placed >= MAX_LAMPS) break;
    }
    lampPosts.count = placed;
    lampBulbs.count = placed;
    lampPosts.instanceMatrix.needsUpdate = true;
    lampBulbs.instanceMatrix.needsUpdate = true;
  }

  function setRoads(roads: ReadonlyArray<TrafficRoad>): void {
    // Copy so we hold a stable list even if the caller mutates theirs.
    currentRoads = roads.slice();
    assignCarsToRoads();
    relayoutLamps();
  }

  // ── the update loop ─────────────────────────────────────────────────
  function update(u: TrafficUpdate): ReadonlyArray<TrafficWakeProxy> {
    // Sleep: hide the whole group. The instanced draw calls are then
    // frustum-culled by three at the group root — nothing to pay per
    // frame beyond the visibility check.
    if (u.tier === "sleep") {
      group.visible = false;
      // Wake strengths taper toward 0 so a wake-up frame doesn't blob
      // the reflection until the boat has resumed motion.
      for (const w of wakeProxies) w.strength = Math.max(0, w.strength - 0.05);
      return wakeProxies;
    }
    group.visible = true;

    const dtSec = Math.max(0, Math.min(0.1, (u.dtMs || 0) / 1000));
    const emissive = nightEmissiveFor(u.night);

    // Cars: advance t along the assigned road at speed / roadLength (m/s
    // ÷ metres = 1/s in road-parameter units). On wrap, hop to a
    // neighbouring road so the fleet reads as circulating a small town.
    let bodyVisible = 0;
    for (let i = 0; i < CAR_COUNT; i += 1) {
      const car = cars[i];
      if (car.roadIdx < 0 || car.roadIdx >= currentRoads.length) {
        // Hide by scaling to zero — cheap and doesn't touch instanceCount.
        scratchPos.set(0, -1000, 0);
        scratchScale.set(0, 0, 0);
        scratchQuat.identity();
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        carBody.setMatrixAt(i, scratchMatrix);
        carLights.setMatrixAt(i, scratchMatrix);
        continue;
      }
      const road = currentRoads[car.roadIdx];
      const worldLen = roadWorldLength(road);
      if (worldLen <= 0.001) continue;
      const advance = (car.speedMs * dtSec) / worldLen;
      // Direction hop: each car carries a fixed 1 or -1 direction via
      // seed parity, so half the fleet drives east, half west — reads
      // as a two-way street.
      const dir = (car.seed & 1) === 0 ? 1 : -1;
      car.t += advance * dir;
      if (car.t >= 1) {
        car.t -= 1;
        // Chance to hop to the next road so cars circulate instead of
        // patrolling a single stripe forever. 40% chance per lap.
        if (unitHash(car.seed, Math.floor(u.dtMs) & 0xff) > 0.6) {
          car.roadIdx = (car.roadIdx + 1) % currentRoads.length;
        }
      } else if (car.t < 0) {
        car.t += 1;
        if (unitHash(car.seed, Math.floor(u.dtMs) & 0xff) > 0.6) {
          car.roadIdx = (car.roadIdx + currentRoads.length - 1) % currentRoads.length;
        }
      }

      const pos = positionAlongRoad(road, car.t);
      const worldX = (pos.nx - 0.5) * 2 * CITY_HALF;
      const worldZ = (pos.ny - 0.5) * 2 * CITY_HALF;
      const yaw = roadYawFor(road) + (dir === 1 ? 0 : Math.PI);
      // Kerb-side offset so two cars going opposite directions don't
      // overlap — right-hand-drive lane offset.
      const laneCos = Math.cos(yaw);
      const laneSin = Math.sin(yaw);
      const laneOffsetX = -laneSin * 1.05;
      const laneOffsetZ = -laneCos * 1.05;
      scratchPos.set(worldX + laneOffsetX, 0.55, worldZ + laneOffsetZ);
      scratchEuler.set(0, yaw, 0);
      scratchQuat.setFromEuler(scratchEuler);
      scratchScale.set(1, 1, 1);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      carBody.setMatrixAt(i, scratchMatrix);

      // Headlight quad — sits 2.4 m in front of the car centre at hood
      // height. When emissive gate is zero, the quad is off-screen (y
      // large negative) so its transparent-additive draw call still runs
      // but writes nothing — the opacity is also zero. When gate lifts,
      // the quad slides forward, opacity opens.
      const hx = worldX + laneOffsetX + laneCos * 2.4;
      const hz = worldZ + laneOffsetZ + laneSin * 2.4;
      scratchPos.set(hx, emissive > 0 ? 0.8 : -1000, hz);
      // Face the quad along the road direction (facing the same way the
      // car is looking).
      scratchEuler.set(0, yaw, 0);
      scratchQuat.setFromEuler(scratchEuler);
      const headlightScale = 0.6 + emissive * 0.8;
      scratchScale.set(headlightScale, headlightScale, 1);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      carLights.setMatrixAt(i, scratchMatrix);
      bodyVisible += 1;
    }
    carBody.instanceMatrix.needsUpdate = true;
    carLights.instanceMatrix.needsUpdate = true;
    // Emissive quad opacity rides the night gate. AdditiveBlending +
    // transparent so bloom picks it up as a hot spot at dusk.
    carHeadlightMat.opacity = 0.85 * emissive;

    // Boats: advance t at BOAT_SPEED / harbour width. On wrap, keep the
    // boat crossing; strength stays ~1 while moving.
    for (let i = 0; i < BOAT_COUNT; i += 1) {
      const boat = boatStates[i];
      const crossingWidth = opts.harbour.halfWidth * 2 + boat.length + 4;
      const speedMs = boatSpeedFor(boat.seed);
      const advance = (speedMs * dtSec) / crossingWidth;
      boat.t += advance;
      if (boat.t >= 1) boat.t -= 1;
      // Boat X sweeps from -halfWidth - length/2 to +halfWidth + length/2
      // (so it enters/exits the frame cleanly), then wraps.
      const startX = -(opts.harbour.halfWidth + boat.length * 0.5 + 2);
      const endX = (opts.harbour.halfWidth + boat.length * 0.5 + 2);
      const x = boat.dir === 1
        ? startX + boat.t * (endX - startX)
        : endX - boat.t * (endX - startX);
      const z = opts.harbour.centerZ + boat.zOffset;
      // Boat surface bob: a small sinusoidal Y around surface + 0.35 m
      // freeboard so the hull sits with a bit of freeboard.
      const bob = Math.sin(boat.t * Math.PI * 2 + boat.seed * 0.01) * 0.06;
      const surfaceY = opts.harbour.surfaceY + 0.35 + bob;
      const yaw = boat.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
      scratchPos.set(x, surfaceY, z);
      scratchEuler.set(0, yaw, 0);
      scratchQuat.setFromEuler(scratchEuler);
      scratchScale.set(boat.length / 8, 1, boat.width / 2.4);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      boats.setMatrixAt(i, scratchMatrix);

      // Wake proxy centred behind the stern.
      const wake = wakeProxies[i];
      const sternX = boat.dir === 1
        ? x - boat.length * 0.5
        : x + boat.length * 0.5;
      wake.x = sternX;
      wake.z = z;
      // Strength ramps up in the middle of the crossing, tapers at the
      // ends so a boat entering/exiting doesn't drop a wake outside the
      // reflector plane.
      const inMid = boat.t > 0.05 && boat.t < 0.95 ? 1 : 0;
      wake.strength = wake.strength * 0.7 + inMid * 0.3;
    }
    boats.instanceMatrix.needsUpdate = true;

    // Lamps: emissive intensity on the bulb material. One write per frame,
    // no per-instance emissive attribute — the bloom pass sells the halo.
    lampBulbMat.emissiveIntensity = emissive * 4.5;

    return wakeProxies;
  }

  function dispose(): void {
    try { carBodyGeo.dispose(); } catch { /* noop */ }
    try { headlightGeo.dispose(); } catch { /* noop */ }
    try { boatGeo.dispose(); } catch { /* noop */ }
    try { lampPostGeo.dispose(); } catch { /* noop */ }
    try { lampBulbGeo.dispose(); } catch { /* noop */ }
    try { carBodyMat.dispose(); } catch { /* noop */ }
    try { carHeadlightMat.dispose(); } catch { /* noop */ }
    try { boatMat.dispose(); } catch { /* noop */ }
    try { lampPostMat.dispose(); } catch { /* noop */ }
    try { lampBulbMat.dispose(); } catch { /* noop */ }
  }

  return {
    group,
    setRoads,
    update,
    dispose,
  };
}

// A future PR may vary boat speed with wind or a tidal current. Today the
// speed is a pure function of the boat's seed via boatSpeedFor(); the boat
// update loop above calls that helper each frame so the change would be
// local when it arrives.
