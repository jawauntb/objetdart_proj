"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures, THRESHOLDS } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel, requestVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import WaterText from "@/components/WaterText";
import { useBandEdgeTravel } from "@/components/ScaleTravel";
import LetGo from "@/components/LetGo";
import {
  type Camera,
  type LayerId,
  type LayerProfile,
  LAYER_ORDER,
  LAYER_PROFILES,
  MAX_BORN_STARS_PER_LAYER,
  MAX_USER_BLACK_HOLES,
  MAX_USER_PLANETS_PER_LAYER,
  PLANET_DESCENT_KEY,
  STARS_ZOOM_SPEC,
  ZOOM_MAX,
  ZOOM_STEP,
  applyHoleNBody,
  clampPan,
  clampPanForZoom,
  clampZoom,
  createAutomata,
  emptyLayerMemory,
  heatAutomata,
  layerFromZoom,
  layerLabel,
  loadCosmicMemoryV2,
  panByScreen,
  rankMergePairs,
  sampleAutomata,
  saveCosmicMemoryV2,
  screenToSky as camScreenToSky,
  skyToScreen,
  tickAutomata,
  zoomAtScreen,
} from "@/lib/stars/nestedCosmos";
import {
  createFrameGovernor,
  detailForTier,
  resolveDpr,
  onGalleryPause,
  onVisibility,
  isEmbeddedFrame,
  type QualityTier,
} from "@/lib/room-runtime";

/**
 * /stars — nested living cosmos.
 *
 * Deep space with photographic ambition, now navigable: pinch/pan/wheel
 * camera across nested zoom layers (galactic → cluster → system → local).
 * Each layer owns a seeded field + coarse density automata. Soft N-body
 * gravity and hierarchical mergers let multiple holes interact; long-hold
 * accretion grows a well that pulls matter in.
 *
 * Performance: static deep field painted per active layer into an
 * offscreen canvas and blit each frame; only stars, events, and
 * constellation chrome redraw live.
 */

// ── types ────────────────────────────────────────────────────────────

// spectral classes — Morgan-Keenan; assigned deterministically by seed.
// Each carries RGB tint, prevalence weight (rare → common), and the
// brightness/size profile shorthand for the renderer.
type Spectral = "O" | "B" | "A" | "F" | "G" | "K" | "M";

type Star = {
  // base canvas-space position computed at field generation, in 0..1
  // normalized units so we can scale to viewport at draw time.
  nx: number;
  ny: number;
  size: number;          // radius px (Pareto — most tiny, few large)
  brightness: number;    // base alpha 0..1
  twinklePhase: number;  // phase offset for the twinkle LFO
  twinkleAmt: number;    // 0..1 how much the star twinkles
  spectral: Spectral;    // O/B/A/F/G/K/M
  // diffraction-spike length in px (only the brightest stars get them)
  spikeLen: number;
  // pre-computed core color (rgb tuple) so we don't re-derive per frame
  rgb: [number, number, number];
};

// a single wisp inside a nebula — its own offset, rotation, color
type NebulaWisp = {
  ox: number;       // offset from nebula center in 0..1 of base
  oy: number;
  rScale: number;   // 0.4..1.0 of nebula base radius
  rot: number;
  squashY: number;  // 0.55..0.95
  rgb: [number, number, number];
  // alpha amplitude — modulated by seeded noise per draw
  alpha: number;
  // seeded noise field index (drives subtle alpha mod)
  noiseSeed: number;
};

type Nebula = {
  nx: number;
  ny: number;
  rBase: number;            // base radius in 0..1 (relative to min(w,h))
  rot: number;              // initial rotation
  rotSpeed: number;         // rad/sec
  driftX: number;           // px/sec
  driftY: number;           // px/sec
  phase: number;
  wisps: NebulaWisp[];      // 3..5 component clouds
  // used for hit testing + the breath effect
  paletteName: string;
};

type BlackHole = {
  nx: number;
  ny: number;
  // event-horizon (singularity) radius normalized to min(w,h)
  rHorizon: number;
  // accretion disk inner/outer radii (normalized)
  rDiskIn: number;
  rDiskOut: number;
  // disk tilt — squashY for the elliptical projection
  tilt: number;
  rot: number;
  // gravitational-lensing pull radius (normalized) and strength
  rLens: number;
  lensStrength: number;
  // hot-side accent color tuple
  hotRgb: [number, number, number];
};

type Galaxy = {
  nx: number;
  ny: number;
  rCore: number;            // core radius normalized to min(w,h)
  rDisk: number;            // overall extent
  rot: number;              // initial rotation
  rotSpeed: number;         // rad/sec
  tilt: number;             // squashY
  arms: number;             // number of spiral arms
  twist: number;            // log-spiral pitch
  coreRgb: [number, number, number];
  armRgb: [number, number, number];
};

type PlanetSystem = {
  nx: number;
  ny: number;
  bodyR: number;
  ringR: number;
  ringTilt: number;
  rot: number;
  hueRgb: [number, number, number];
  ringRgb: [number, number, number];
  moons: Array<{ ang: number; dist: number; size: number }>;
};

type BornStar = {
  id: string;
  nx: number;
  ny: number;
  size: number;
  brightness: number;
  twinklePhase: number;
  twinkleAmt: number;
  spikeLen: number;
  rgb: [number, number, number];
  createdAt: number;
  vx?: number; // normalized units / sec — accretion coast
  vy?: number;
};

type UserBlackHole = {
  id: string;
  nx: number;
  ny: number;
  mass: number;
  spin: number;
  hue: number;
  createdAt: number;
};

// A world condensed from a born star's disk — double-tap a star you made
// and a planet takes orbit in its light. Everything visible (body, rings,
// moons, weather-word) decodes deterministically from the seed; the hue is
// inherited from the parent star. Persisted per layer beside stars/holes.
type UserPlanet = {
  id: string;
  nx: number;
  ny: number;
  seed: number;
  hue: number;
  createdAt: number;
};

// the deterministic decode — one seed, one species of world. Used by the
// renderer and by the descent prompt so what the atlas is told matches
// exactly what the sky shows.
const PLANET_LANDS = [
  "tide-locked seas",
  "basalt archipelagos",
  "salt plains under thin cloud",
  "monsoon forests",
  "glass deserts",
  "fog canyons",
  "reef rings",
  "lantern marshes",
] as const;
function planetAdjective(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  if (h < 30) return "rose";
  if (h < 70) return "amber";
  if (h < 160) return "verdant";
  if (h < 230) return "cobalt";
  if (h < 300) return "violet";
  return "pearl";
}
function decodeUserPlanet(p: UserPlanet) {
  const rng = makeRng(p.seed);
  const bodyR = 0.0075 + rng() * 0.005;    // normalized to min(w,h)
  const ringed = rng() < 0.55;
  const ringR = ringed ? 1.7 + rng() * 0.7 : 0;
  const ringTilt = 0.3 + rng() * 0.35;
  const moons = 1 + Math.floor(rng() * 3);
  const land = PLANET_LANDS[Math.floor(rng() * PLANET_LANDS.length)];
  const moonSeed = rng();
  return { bodyR, ringed, ringR, ringTilt, moons, land, moonSeed };
}
function planetPrompt(p: UserPlanet): string {
  const d = decodeUserPlanet(p);
  const moonWord = d.moons === 1 ? "one moon" : d.moons === 2 ? "two moons" : "three moons";
  return `${planetAdjective(p.hue)} world of ${d.land}, ${moonWord} keeping watch`;
}

type CosmicEventKind =
  | "birth"
  | "collapse"
  | "supernova"
  | "pulsar"
  | "comet"
  | "tidal"
  | "nova"
  | "starform"
  | "grb"
  | "merger";
type CosmicEvent = {
  id: number;
  kind: CosmicEventKind;
  x: number;
  y: number;
  t0: number;
  life: number;
  seed: number;
  rgb: [number, number, number];
  power: number;
  // optional trajectory (comet / grb / tidal) — direction in radians and a
  // travel distance in px. Derived at spawn so the RAF loop stays cheap.
  ang?: number;
  reach?: number;
};

type SavedConstellation = {
  id: string;
  name: string;
  starIndices: number[];
  createdAt: number;
};

type SkyPulseTone =
  | "star"
  | "nebula"
  | "gravity"
  | "kept"
  | "wish"
  | "birth"
  | "supernova"
  | "pulsar"
  | "comet"
  | "tidal"
  | "nova"
  | "starform"
  | "grb"
  | "merger";
type SkyPulse = {
  id: number;
  label: string;
  tone: SkyPulseTone;
};

const SKY_PULSE_COLOR: Record<SkyPulseTone, string> = {
  star: "rgba(244, 238, 222, 0.94)",
  nebula: "rgba(144, 210, 230, 0.94)",
  gravity: "rgba(184, 160, 255, 0.94)",
  kept: "rgba(218, 176, 92, 0.96)",
  wish: "rgba(240, 130, 170, 0.94)",
  birth: "rgba(128, 222, 214, 0.96)",
  supernova: "rgba(255, 170, 96, 0.96)",
  pulsar: "rgba(150, 220, 255, 0.96)",
  comet: "rgba(190, 226, 255, 0.96)",
  tidal: "rgba(255, 138, 96, 0.96)",
  nova: "rgba(255, 236, 196, 0.96)",
  starform: "rgba(140, 236, 200, 0.96)",
  grb: "rgba(206, 255, 176, 0.98)",
  merger: "rgba(198, 156, 255, 0.98)",
};

// ── seeded PRNG (mulberry32) — same field every load ─────────────────
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// integer hash → 0..1 (used inside draw loop for noise alpha mod)
function hash01(n: number): number {
  let x = (n | 0) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967296;
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const STORAGE_KEY = "objetdart:constellations:v1";
const RANDOM_SUPERNOVA_MS = 18000;
const DEFAULT_CAMERA: Camera = { panX: 0.5, panY: 0.5, zoom: 1 };
/**
 * Tap / dwell / ceremony are the grammar's, never this room's — they live in
 * `lib/gesture/core.ts` and arrive as `e.tier`. What the room owns is only
 * what each tier *means* here: the well opens at dwell, the horizon keeps
 * swelling past ceremony, a constellation frays and lets go at ceremony.
 */
const WELL_MASS_PER_SEC = 0.66;

/** The lens ladder: what the sky is, what it is made of, what it is doing. */
const LENS_RUNGS = 3; // 0 visible · 1 spectral/temperature · 2 gravitational

// ── spectral palette ─────────────────────────────────────────────────
// Approximate stellar locus colors (RGB 0..255). O/B blue, A white,
// F yellow-white, G yellow, K orange, M red.
const SPECTRAL_RGB: Record<Spectral, [number, number, number]> = {
  O: [155, 176, 255],
  B: [170, 191, 255],
  A: [233, 236, 255],
  F: [248, 247, 229],
  G: [255, 244, 214],
  K: [255, 210, 161],
  M: [255, 167, 114],
};

// The temperature lens (twist, rung 1): the same seven classes at their
// real blackbody chromaticity — saturated toward the true stellar locus
// instead of prettified. Turning the lens stops showing what the sky looks
// like and starts showing what it is made of.
const SPECTRAL_TRUE: Record<Spectral, [number, number, number]> = {
  O: [104, 146, 255],
  B: [148, 180, 255],
  A: [214, 228, 255],
  F: [255, 250, 232],
  G: [255, 230, 160],
  K: [255, 180, 100],
  M: [255, 112, 54],
};

// The gravitational lens (rung 2): starlight drains to a single pale value
// so nothing competes with the curvature drawn over it.
const LENS_GRAV_RGB: [number, number, number] = [198, 204, 216];

// real-universe relative prevalence (rough M-K main-sequence weights):
// M dominates by a huge margin; O is vanishingly rare. These weights
// pick spectral class for each star deterministically via seed.
const SPECTRAL_WEIGHTS: Array<[Spectral, number]> = [
  ["O", 0.0003],
  ["B", 0.0013],
  ["A", 0.006],
  ["F", 0.030],
  ["G", 0.076],
  ["K", 0.121],
  ["M", 0.7654],
];

function pickSpectral(rng01: number): Spectral {
  let acc = 0;
  for (const [cls, w] of SPECTRAL_WEIGHTS) {
    acc += w;
    if (rng01 <= acc) return cls;
  }
  return "M";
}

// ── nebula palettes — paired colors per the brief ────────────────────
const NEBULA_PALETTES: Array<{
  name: string;
  a: [number, number, number];
  b: [number, number, number];
}> = [
  { name: "violet+rose",   a: [168, 96, 200], b: [220, 110, 150] },
  { name: "cyan+green",    a: [80, 180, 220], b: [120, 220, 170] },
  { name: "orange+yellow", a: [220, 130, 70], b: [240, 200, 110] },
  { name: "magenta+blue",  a: [210, 90, 200], b: [110, 130, 230] },
  { name: "coral+pink",    a: [240, 130, 110], b: [240, 170, 200] },
];

const NEBULA_PALETTE_BY_NAME = new Map(NEBULA_PALETTES.map((p) => [p.name, p]));

// ── field generation ─────────────────────────────────────────────────

// Pareto-ish: bias the size distribution so most stars are tiny and a
// small tail is large — gives the "deep field" speckle look.
function paretoSize(u: number): number {
  // 0.35 .. ~3.2px; the cubic falloff means the 99th percentile is
  // still under ~3px, with bright outliers occasionally larger.
  return 0.35 + Math.pow(u, 4.5) * 2.9;
}

type Quasar = {
  nx: number;
  ny: number;
  power: number;
  hue: number;
  phase: number;
};

type LayerField = {
  id: LayerId;
  stars: Star[];
  nebulae: Nebula[];
  blackHoles: BlackHole[];
  galaxies: Galaxy[];
  planets: PlanetSystem[];
  quasars: Quasar[];
  profile: LayerProfile;
};

function generateStarsFor(profile: LayerProfile): Star[] {
  const rng = makeRng(profile.seed);
  const out: Star[] = [];
  for (let i = 0; i < profile.starCount; i++) {
    const inBand = rng() < profile.bandFrac;
    let nx: number;
    let ny: number;
    if (inBand) {
      const x = rng();
      const yCenter = 0.5 + (x - 0.5) * 0.35;
      const j = (rng() + rng() + rng() - 1.5) * 0.16;
      nx = x;
      ny = Math.min(0.98, Math.max(0.02, yCenter + j));
    } else {
      nx = rng();
      ny = rng();
    }

    const size = paretoSize(rng()) * profile.sizeScale;
    const brightness = 0.32 + Math.pow(rng(), 1.8) * 0.6;
    const twinkleAmt = rng() < 0.55 ? 0.18 + rng() * 0.42 : 0;
    const spectral = pickSpectral(rng());
    const rgb = SPECTRAL_RGB[spectral];
    const isBright = size > 1.9 && brightness > 0.7;
    const spikeLen = isBright ? size * (3.6 + rng() * 2.4) : 0;

    out.push({
      nx,
      ny,
      size,
      brightness,
      twinklePhase: rng() * Math.PI * 2,
      twinkleAmt,
      spectral,
      spikeLen,
      rgb,
    });
  }
  return out;
}

function generateNebulaeFor(profile: LayerProfile): Nebula[] {
  const rng = makeRng(profile.seed ^ 0xbada55);
  const out: Nebula[] = [];
  const baseAnchors: Array<[number, number]> = [
    [0.22, 0.30],
    [0.74, 0.62],
    [0.52, 0.18],
    [0.18, 0.74],
    [0.82, 0.30],
    [0.40, 0.48],
    [0.66, 0.28],
    [0.30, 0.82],
  ];
  for (let i = 0; i < profile.nebulaCount; i++) {
    const [ax, ay] = baseAnchors[i % baseAnchors.length];
    const jitter = i >= baseAnchors.length ? 0.12 : 0.08;
    const palette = NEBULA_PALETTES[i % NEBULA_PALETTES.length];
    const wispCount = 3 + Math.floor(rng() * 3);
    const wisps: NebulaWisp[] = [];
    for (let j = 0; j < wispCount; j++) {
      const useB = (j % 2 === 1) || rng() < 0.35;
      wisps.push({
        ox: (rng() - 0.5) * 0.42,
        oy: (rng() - 0.5) * 0.32,
        rScale: 0.45 + rng() * 0.55,
        rot: rng() * Math.PI * 2,
        squashY: 0.55 + rng() * 0.40,
        rgb: useB ? palette.b : palette.a,
        alpha: 0.10 + rng() * 0.10,
        noiseSeed: Math.floor(rng() * 0xFFFF),
      });
    }
    out.push({
      nx: clampPan(ax + (rng() - 0.5) * jitter),
      ny: clampPan(ay + (rng() - 0.5) * jitter),
      rBase: (0.28 + rng() * 0.20) * (profile.id === "local" ? 0.7 : 1),
      rot: rng() * Math.PI * 2,
      rotSpeed: (rng() < 0.5 ? -1 : 1) * (0.003 + rng() * 0.004),
      driftX: (rng() - 0.5) * 7,
      driftY: (rng() - 0.5) * 5,
      phase: rng() * Math.PI * 2,
      wisps,
      paletteName: palette.name,
    });
  }
  return out;
}

function generateBlackHolesFor(profile: LayerProfile): BlackHole[] {
  const rng = makeRng(profile.seed ^ 0xb14cc0);
  const slots: Array<[number, number]> = [
    [0.32, 0.70],
    [0.78, 0.22],
    [0.55, 0.45],
    [0.18, 0.38],
  ];
  return slots.slice(0, profile.bhCount).map(([nx, ny]) => {
    const rHorizon = (0.010 + rng() * 0.006) * (profile.id === "local" ? 1.4 : 1);
    return {
      nx: nx + (rng() - 0.5) * 0.04,
      ny: ny + (rng() - 0.5) * 0.04,
      rHorizon,
      rDiskIn: rHorizon * 1.6,
      rDiskOut: rHorizon * 6.5,
      tilt: 0.28 + rng() * 0.35,
      rot: rng() * Math.PI * 2,
      rLens: rHorizon * 14,
      lensStrength: 0.42,
      hotRgb: [255, 210, 150] as [number, number, number],
    };
  });
}

function generateGalaxiesFor(profile: LayerProfile): Galaxy[] {
  if (profile.galaxyCount <= 0) return [];
  const rng = makeRng(profile.seed ^ 0x9a1a99);
  const slots: Array<[number, number]> = [
    [0.12, 0.52],
    [0.88, 0.78],
    [0.48, 0.22],
  ];
  return slots.slice(0, profile.galaxyCount).map(([nx, ny]) => ({
    nx,
    ny,
    rCore: 0.012 + rng() * 0.008,
    rDisk: 0.060 + rng() * 0.030,
    rot: rng() * Math.PI * 2,
    rotSpeed: (rng() < 0.5 ? -1 : 1) * (0.0014 + rng() * 0.0010),
    tilt: 0.32 + rng() * 0.30,
    arms: 2 + (rng() < 0.5 ? 0 : 1),
    twist: 0.45 + rng() * 0.20,
    coreRgb: [255, 240, 210] as [number, number, number],
    armRgb: [180, 200, 240] as [number, number, number],
  }));
}

function generatePlanetSystemsFor(profile: LayerProfile): PlanetSystem[] {
  const rng = makeRng(profile.seed ^ 0x51a751);
  const anchors: Array<[number, number]> = [
    [0.38, 0.34],
    [0.63, 0.56],
    [0.48, 0.72],
    [0.72, 0.42],
    [0.27, 0.58],
    [0.58, 0.28],
    [0.44, 0.48],
    [0.80, 0.66],
  ];
  const palettes: Array<[[number, number, number], [number, number, number]]> = [
    [[194, 218, 230], [230, 218, 180]],
    [[226, 168, 126], [184, 206, 230]],
    [[150, 196, 172], [224, 196, 146]],
    [[205, 188, 232], [180, 212, 220]],
    [[230, 205, 152], [220, 180, 150]],
  ];
  return anchors.slice(0, profile.planetCount).map(([nx, ny], i) => {
    const [hueRgb, ringRgb] = palettes[i % palettes.length];
    const moons = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => ({
      ang: rng() * Math.PI * 2,
      dist: 1.9 + rng() * 2.5,
      size: 0.16 + rng() * 0.20,
    }));
    return {
      nx: nx + (rng() - 0.5) * 0.06,
      ny: ny + (rng() - 0.5) * 0.06,
      bodyR: (0.0065 + rng() * 0.0045) * (profile.id === "system" ? 1.35 : 1),
      ringR: 2.05 + rng() * 1.10,
      ringTilt: 0.23 + rng() * 0.28,
      rot: rng() * Math.PI * 2,
      hueRgb,
      ringRgb,
      moons,
    };
  });
}

function generateQuasarsFor(profile: LayerProfile): Quasar[] {
  if (profile.quasarCount <= 0) return [];
  const rng = makeRng(profile.seed ^ 0x9a5a17);
  const out: Quasar[] = [];
  for (let i = 0; i < profile.quasarCount; i++) {
    out.push({
      nx: 0.15 + rng() * 0.7,
      ny: 0.15 + rng() * 0.7,
      power: 0.7 + rng() * 0.5,
      hue: 200 + rng() * 80,
      phase: rng() * Math.PI * 2,
    });
  }
  return out;
}

const layerFieldCache = new Map<LayerId, LayerField>();

function getLayerField(id: LayerId): LayerField {
  let field = layerFieldCache.get(id);
  if (field) return field;
  const profile = LAYER_PROFILES[id];
  field = {
    id,
    stars: generateStarsFor(profile),
    nebulae: generateNebulaeFor(profile),
    blackHoles: generateBlackHolesFor(profile),
    galaxies: generateGalaxiesFor(profile),
    planets: generatePlanetSystemsFor(profile),
    quasars: generateQuasarsFor(profile),
    profile,
  };
  layerFieldCache.set(id, field);
  return field;
}

/** Prefetch neighboring layers while idle so depth transitions stay snappy. */
function prefetchNearbyLayers(id: LayerId): void {
  const idx = LAYER_ORDER.indexOf(id);
  for (const j of [idx - 1, idx + 1]) {
    if (j >= 0 && j < LAYER_ORDER.length) getLayerField(LAYER_ORDER[j]);
  }
}

// ── component ────────────────────────────────────────────────────────

// transient visual effects, kept in refs so they update without re-rendering
type Spark = { x: number; y: number; t0: number };
type NebulaBreath = { idx: number; t0: number };
type GravityWell = {
  active: boolean;
  x: number;
  y: number;
  t0: number;
  mass: number;    // grows for as long as the hand stays — never plateaus
  gather: number;  // 0..1 before the dwell tier: matter visibly collecting
  mode: "gather" | "accrete";
};

/** Where a hold began — the only thing the well needs to remember. */
type PointerIntent = { x: number; y: number };

/** A saved constellation coming undone under a ceremony hold. */
type Fraying = { id: string; t0: number };

// A mote of matter falling into a black hole. Lives in the hole's local
// polar frame (radius as a fraction of min(w,h); angle in radians) so the
// camera's drift/zoom carries it for free. rn shrinks as it spirals in;
// at the horizon it is never seen to cross — seen from far away its clock
// dilates to a stop, so it freezes just above the edge, reddens, and fades
// out on the exponential the sky actually obeys (L = L0·e^(−0.19T/M)).
type InfallMote = {
  rn: number;       // radius as fraction of base (min(w,h))
  ang: number;      // orbital angle
  va: number;       // angular velocity sign/scale
  size: number;     // px core size
  hue: number;      // captured light hue
  seed: number;
  dyingAt?: number; // ms timestamp of reaching the horizon — the long fade
};

// A gravitational wave — spawned by a black-hole merger. Expands from a
// normalized sky point and both displaces starlight (in lensPoint) and
// paints a racing shimmer ring.
type GravWave = {
  id: number;
  nx: number;
  ny: number;
  t0Ms: number;
  life: number;
  strength: number;
  // per-frame cache, filled by the RAF loop so lensPoint stays cheap
  _cx?: number;
  _cy?: number;
  _r?: number;
  _amp?: number;
  _env?: number;
};

// An in-progress inspiral of two user black holes toward a merger.
type Merger = {
  aId: string;
  bId: string;
  ax: number;       // snapshot base positions at capture (normalized)
  ay: number;
  bx: number;
  by: number;
  tStartMs: number;
  durMs: number;
  spinSign: number;
  committed: boolean;
};

// breath effect duration, seconds
const NEBULA_BREATH_DUR = 4;
// spark lifetime, seconds
const SPARK_LIFE = 0.8;
// Milky Way band — keep these constants in sync with the draw code
const MW_BAND_ANGLE = 0.34;        // base angle in radians
const MW_BAND_HALF_THICKNESS = 0.10; // normalized to min(w,h)
const PLANET_REVEAL_ZOOM = 2.05; // cluster+ reveals planet systems

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── baked falloff sprites ────────────────────────────────────────────
// Every soft edge in this sky used to be a canvas gradient allocated inside
// a per-element loop; at galactic depth that was well over a thousand
// allocations a frame just for the star field. But a falloff is a function
// of colour alone — its radius is only a scale and its brightness only an
// alpha — so each one is baked once into an offscreen canvas and stamped
// with drawImage for ever after. The look is unchanged: same stops, same
// compositing order, same number of passes.

/** offset · alpha · optional colour override for that stop. */
type Stop = readonly [number, number, (readonly [number, number, number])?];

const FALL_HALO: readonly Stop[] = [[0, 0.2], [0.4, 0.08], [1, 0]];
const FALL_GLOW: readonly Stop[] = [[0, 0.55], [0.5, 0.18], [1, 0]];
const FALL_SOFT: readonly Stop[] = [[0, 1], [1, 0]];
const FALL_BREATH: readonly Stop[] = [[0, 1], [0.6, 0.4], [1, 0]];
const FALL_BLOOM: readonly Stop[] = [[0, 0.22], [0.45, 0.09], [1, 0]];
const FALL_SPARK: readonly Stop[] = [[0, 1], [0.6, 0.325], [1, 0]];
const FALL_PGLOW: readonly Stop[] = [[0, 1], [0.42, 0.333], [1, 0]];
const FALL_DARK: readonly Stop[] = [[0, 1], [0.74, 0.98], [1, 0]];
const FALL_COLLAPSE: readonly Stop[] = [[0, 0.96], [0.72, 0.7], [1, 0]];
const FALL_BLAST: readonly Stop[] = [[0, 0.38, [255, 255, 230]], [0.18, 0.22], [0.72, 0.07], [1, 0]];
const FALL_PULSAR: readonly Stop[] = [[0, 0.9, [255, 255, 255]], [0.5, 0.5], [1, 0]];
const FALL_HEAD: readonly Stop[] = [[0, 0.9, [255, 255, 255]], [0.4, 0.4], [1, 0]];
const FALL_TIDAL: readonly Stop[] = [[0, 0.5, [255, 244, 220]], [0.3, 0.28], [1, 0]];
const FALL_NOVA: readonly Stop[] = [[0, 0.6, [255, 255, 245]], [0.35, 0.3], [1, 0]];
const FALL_SFORM: readonly Stop[] = [[0, 0.16], [0.5, 0.07], [1, 0]];
const FALL_MERGER: readonly Stop[] = [[0, 0.6, [255, 250, 255]], [0.3, 0.34], [1, 0]];

/** Sprite tags — one baked family per falloff profile. */
const TAG_HALO = 0;
const TAG_GLOW = 1;
const TAG_SOFT = 2;
const TAG_BREATH = 3;
const TAG_BLOOM = 4;
const TAG_SPARK = 5;
const TAG_PGLOW = 6;
const TAG_SPIKE_H = 7;
const TAG_SPIKE_V = 8;
const TAG_DARK = 9;
const TAG_COLLAPSE = 10;
const TAG_BLAST = 11;
const TAG_PULSAR = 12;
const TAG_HEAD = 13;
const TAG_TIDAL = 14;
const TAG_NOVA = 15;
const TAG_SFORM = 16;
const TAG_MERGER = 17;

/**
 * Baked radius, px. Everything scales from here with drawImage — small
 * enough that stamping a 0.4px star is a cheap minification, large enough
 * that the biggest halo at full zoom never looks resampled.
 */
const SPRITE_R = 40;
const SPIKE_L = 128;

const spriteCache = new Map<number, HTMLCanvasElement>();

function bakeDot(r: number, g: number, b: number, fall: readonly Stop[]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const S = SPRITE_R * 2;
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const grad = ctx.createRadialGradient(SPRITE_R, SPRITE_R, 0, SPRITE_R, SPRITE_R, SPRITE_R);
  for (const st of fall) {
    const c = st[2];
    const sr = c ? c[0] : r;
    const sg = c ? c[1] : g;
    const sb = c ? c[2] : b;
    grad.addColorStop(st[0], `rgba(${sr}, ${sg}, ${sb}, ${st[1]})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  return c;
}

function bakeSpike(r: number, g: number, b: number, vertical: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = vertical ? 8 : SPIKE_L;
  c.height = vertical ? SPIKE_L : 8;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const grad = vertical
    ? ctx.createLinearGradient(0, 0, 0, SPIKE_L)
    : ctx.createLinearGradient(0, 0, SPIKE_L, 0);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
  grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.75)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * One sprite per (falloff, colour), keyed by a packed integer so the hot
 * path builds no strings. Colours in this room come from a handful of fixed
 * palettes, so the cache saturates within a second and never grows.
 */
function sprite(tag: number, r: number, g: number, b: number, fall: readonly Stop[]): HTMLCanvasElement {
  const ri = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  const gi = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  const bi = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  const key = tag * 0x1000000 + (ri << 16) + (gi << 8) + bi;
  let s = spriteCache.get(key);
  if (s === undefined) {
    s = tag === TAG_SPIKE_H || tag === TAG_SPIKE_V
      ? bakeSpike(ri, gi, bi, tag === TAG_SPIKE_V)
      : bakeDot(ri, gi, bi, fall);
    spriteCache.set(key, s);
  }
  return s;
}

/** Stamp a baked falloff centred at (x, y) out to `radius`, at `alpha`. */
function stamp(
  ctx: CanvasRenderingContext2D,
  sp: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): void {
  if (radius <= 0 || alpha <= 0.002) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * (alpha > 1 ? 1 : alpha);
  ctx.drawImage(sp, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prev;
}

/**
 * Gradient memo for the few falloffs that genuinely change shape (an
 * accretion disk's inner rim moves with mass and zoom). Keys are packed
 * numbers, never strings; a canvas gradient is painted in the transform
 * live at fill time, so callers translate to the element's origin first
 * and quantise the radii they key on.
 */
function makeGradCache(): (key: number, build: () => CanvasGradient) => CanvasGradient {
  const m = new Map<number, CanvasGradient>();
  return (key, build) => {
    let g = m.get(key);
    if (g === undefined) {
      if (m.size > 480) m.clear();
      g = build();
      m.set(key, g);
    }
    return g;
  };
}

export default function Stars() {
  // page-specific ambient bed: very faint cosmic noise + sine drones
  useEffect(() => { getFieldAudio().setAmbientProfile("cosmic"); }, []);

  const bgRef = useRef<HTMLCanvasElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);
  // offscreen canvas for the static deep universe — painted once
  // on mount/resize and blit per frame via drawImage. Living in a ref
  // because we own its lifetime and never need React to render it.
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const recordTape = useField((s) => s.recordTape);

  // pending selection — indices of stars the user has clicked, in order
  const [pending, setPending] = useState<number[]>([]);
  const [saved, setSaved] = useState<SavedConstellation[]>([]);
  const [bornStars, setBornStars] = useState<BornStar[]>([]);
  const [userBlackHoles, setUserBlackHoles] = useState<UserBlackHole[]>([]);
  const [userPlanets, setUserPlanets] = useState<UserPlanet[]>([]);
  const [naming, setNaming] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hoveredSaved, setHoveredSaved] = useState<string | null>(null);
  const [hoveredNebula, setHoveredNebula] = useState<number | null>(null);
  const [hoveredMilkyWay, setHoveredMilkyWay] = useState(false);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [activeLayer, setActiveLayer] = useState<LayerId>("galactic");
  const [skyPulse, setSkyPulse] = useState<SkyPulse | null>(null);
  const [layerFade, setLayerFade] = useState(1);

  // transient effects — mutated by event handlers, read by the RAF loop
  const skyPulseId = useRef(0);
  const summonRef = useRef(0);
  const sparksRef = useRef<Spark[]>([]);
  const breathsRef = useRef<NebulaBreath[]>([]);
  const cosmicEventsRef = useRef<CosmicEvent[]>([]);
  // per-black-hole infalling matter, keyed by hole identity ("bh0"/id).
  const bhMotesRef = useRef<Map<string, InfallMote[]>>(new Map());
  // last-consumption timestamp (ms) per hole — drives the feeding flare.
  const bhFeedRef = useRef<Map<string, number>>(new Map());
  // last horizon-arrival tone (ms, global) — keeps the fade-out song sparse.
  const bhToneRef = useRef<number>(0);
  const gravWavesRef = useRef<GravWave[]>([]);
  const mergerRef = useRef<Merger | null>(null);
  const mergerQueueRef = useRef<Array<{ aId: string; bId: string }>>([]);
  const mergerScanRef = useRef<number>(0); // next allowed self-merger (ms)
  const gravityWellRef = useRef<GravityWell>({
    active: false,
    x: 0,
    y: 0,
    t0: 0,
    mass: 0,
    gather: 0,
    mode: "gather",
  });
  const pointerIntentRef = useRef<PointerIntent | null>(null);
  // The scale manifold at the walls: pinching out past zoom 1 opens onto
  // /manifold (with /beyond as the second-press fork door); pinching in
  // past zoom 14 dives to /atlas. Inside 1..14 the nested layers above
  // own the camera exactly as before.
  const {
    report: reportScaleEdge,
    release: releaseScaleEdge,
    overlay: scaleEdgeOverlay,
  } = useBandEdgeTravel("/stars", STARS_ZOOM_SPEC);
  const milkyPulseRef = useRef<number>(0); // performance.now() of last MW click

  // ── the layers above the material (grammar §3) ────────────────────
  // two fingers turn the lens, three turn the law, the device is the vessel.
  /** Continuous lens position 0..2 while a hand turns it. */
  const lensRef = useRef(0);
  /** Where the ease is heading — the rung during a rest, the turn mid-twist. */
  const lensSnapRef = useRef(0);
  /** The rung itself. Only this changes the room's description of the sky. */
  const lensRungRef = useRef(0);
  const [lensRung, setLensRung] = useState(0);
  /** Precession: three fingers walk the constellations through the year. */
  const seasonRef = useRef(0);
  /** Interstellar wind — three-finger drag combs the gas off the stars. */
  const windRef = useRef({ vx: 0, vy: 0, ox: 0, oy: 0 });
  /** Time dilation while three fingers rest on the sky. */
  const timeScaleRef = useRef(1);
  const timeScaleTargetRef = useRef(1);
  /** One synchronized answer from everything alive (three-finger tap). */
  const tuttiRef = useRef(0);
  /** A knock on the case rings the sky: a bell front racing outward. */
  const knockRef = useRef<{ t0: number; x: number; y: number } | null>(null);
  /** Face-down: the sky deepens and the simulation idles down. */
  const nightRef = useRef(0);
  const nightTargetRef = useRef(0);
  /** Tilt = parallax lean on the dome. */
  const leanRef = useRef({ x: 0, y: 0 });
  /** A saved constellation slackening under a ceremony hold. */
  const frayRef = useRef<Fraying | null>(null);
  /** Shift held: the desktop dialect of "add this star to the shape". */
  const shiftRef = useRef(false);
  /** Last hand contact — the glimmer waits on this. */
  const lastTouchRef = useRef(0);
  /** Render quality, resolved by the frame governor. */
  const qualityRef = useRef<QualityTier>("high");
  // hover flags also mirrored into refs so the RAF loop can read them cheaply
  const hoveredNebulaRef = useRef<number | null>(null);
  const hoveredMilkyWayRef = useRef<boolean>(false);
  const cameraRef = useRef(camera);
  const activeLayerRef = useRef<LayerId>(activeLayer);
  const activeFieldRef = useRef<LayerField>(getLayerField("galactic"));
  const layerFadeRef = useRef(1);
  const paintStaticRef = useRef<(() => void) | null>(null);
  const automataRef = useRef<Map<LayerId, Float32Array>>(new Map());
  const consumedSeedRef = useRef<Map<LayerId, Set<number>>>(new Map());
  const memoryRef = useRef(loadCosmicMemoryV2());
  // the forgetting (LetGo, §8c): what the sky is letting go of — born stars
  // fade and black holes evaporate over a couple of breaths while the
  // memory itself is already written empty.
  const forgetRef = useRef<{ t0: number; dur: number; stars: BornStar[]; holes: UserBlackHole[]; planets: UserPlanet[] } | null>(null);
  const pageHiddenRef = useRef(false);
  const bornStarsRef = useRef<BornStar[]>(bornStars);
  const userBlackHolesRef = useRef<UserBlackHole[]>(userBlackHoles);
  const userPlanetsRef = useRef<UserPlanet[]>(userPlanets);
  // handlers need born-star / planet positions the draw loop computes
  const bornStarPosRef = useRef<((s: { nx: number; ny: number }, t: number) => { x: number; y: number }) | null>(null);
  useEffect(() => { hoveredNebulaRef.current = hoveredNebula; }, [hoveredNebula]);
  useEffect(() => { hoveredMilkyWayRef.current = hoveredMilkyWay; }, [hoveredMilkyWay]);
  useEffect(() => { cameraRef.current = camera; }, [camera]);
  useEffect(() => { layerFadeRef.current = layerFade; }, [layerFade]);
  useEffect(() => { bornStarsRef.current = bornStars; }, [bornStars]);
  useEffect(() => { userBlackHolesRef.current = userBlackHoles; }, [userBlackHoles]);
  useEffect(() => { userPlanetsRef.current = userPlanets; }, [userPlanets]);

  // swap layer field + restore that layer's memory when zoom band changes
  useEffect(() => {
    if (activeLayerRef.current === activeLayer) return;
    // stash current layer matter
    const prev = activeLayerRef.current;
    memoryRef.current.layers[prev] = {
      bornStars: bornStarsRef.current,
      blackHoles: userBlackHolesRef.current,
      planets: userPlanetsRef.current,
      consumedSeedIds: [...(consumedSeedRef.current.get(prev) ?? [])],
    };
    activeLayerRef.current = activeLayer;
    activeFieldRef.current = getLayerField(activeLayer);
    prefetchNearbyLayers(activeLayer);
    const mem = memoryRef.current.layers[activeLayer] ?? emptyLayerMemory();
    const stars = (Array.isArray(mem.bornStars) ? mem.bornStars : []) as BornStar[];
    const holes = (Array.isArray(mem.blackHoles) ? mem.blackHoles : []) as UserBlackHole[];
    const worlds = (Array.isArray(mem.planets) ? mem.planets : []) as UserPlanet[];
    bornStarsRef.current = stars;
    userBlackHolesRef.current = holes;
    userPlanetsRef.current = worlds;
    setBornStars(stars);
    setUserBlackHoles(holes);
    setUserPlanets(worlds);
    consumedSeedRef.current.set(
      activeLayer,
      new Set((mem.consumedSeedIds ?? []).filter((n) => typeof n === "number")),
    );
    if (!automataRef.current.has(activeLayer)) {
      automataRef.current.set(activeLayer, createAutomata(LAYER_PROFILES[activeLayer].seed));
    }
    setLayerFade(0);
    // rebuild static canvas for the new layer
    window.setTimeout(() => paintStaticRef.current?.(), 0);
    const fadeId = window.setInterval(() => {
      setLayerFade((f) => {
        const next = Math.min(1, f + 0.12);
        if (next >= 1) window.clearInterval(fadeId);
        return next;
      });
    }, 32);
    return () => window.clearInterval(fadeId);
  }, [activeLayer]);

  // we need the latest pending/saved inside the RAF loop without forcing
  // a re-init of the loop on each click, so mirror through refs.
  const pendingRef = useRef<number[]>(pending);
  const savedRef = useRef<SavedConstellation[]>(saved);
  const hoveredSavedRef = useRef<string | null>(hoveredSaved);
  const namingRef = useRef<boolean>(naming);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => { savedRef.current = saved; }, [saved]);
  useEffect(() => { hoveredSavedRef.current = hoveredSaved; }, [hoveredSaved]);
  useEffect(() => { namingRef.current = naming; }, [naming]);

  // last clicked star — for positioning the name input on desktop
  const lastClickPos = useRef<{ x: number; y: number } | null>(null);
  const [namePos, setNamePos] = useState<{ x: number; y: number } | null>(null);

  // expose the latest starPos function from the RAF loop. We need it for
  // pointer hit-tests and for placing the name input.
  const starPosRef = useRef<((i: number, t: number) => { x: number; y: number }) | null>(null);

  const markSky = useCallback((
    label: string,
    tone: SkyPulseTone,
    intensity = 0.45,
    kind: "object" | "sigil" | "region" | "kept" = "object",
    meta = label,
    writeTape = true,
  ) => {
    const id = ++skyPulseId.current;
    setSkyPulse({ id, label, tone });
    if (writeTape) recordTape(kind, intensity, `stars/${meta.toLowerCase().replace(/\s+/g, "-")}`);
    window.setTimeout(() => {
      setSkyPulse((prev) => (prev?.id === id ? null : prev));
    }, 2400);
  }, [recordTape]);

  const applyCamera = useCallback((next: Camera, announce = false) => {
    const zoom = clampZoom(next.zoom);
    const cam = {
      zoom,
      panX: clampPanForZoom(next.panX, zoom),
      panY: clampPanForZoom(next.panY, zoom),
    };
    cameraRef.current = cam;
    setCamera(cam);
    memoryRef.current.camera = cam;
    const layer = layerFromZoom(cam.zoom);
    if (layer !== activeLayerRef.current) {
      setActiveLayer(layer);
      if (announce) {
        markSky(`entering ${layerLabel(layer)}`, "nebula", 0.4, "region", `layer-${layer}`, false);
      }
    }
  }, [markSky]);

  const zoomBy = useCallback((delta: number, screenX?: number, screenY?: number) => {
    const ww = window.innerWidth || 1;
    const wh = window.innerHeight || 1;
    const sx = screenX ?? ww * 0.5;
    const sy = screenY ?? wh * 0.5;
    const next = zoomAtScreen(cameraRef.current, sx, sy, cameraRef.current.zoom + delta, ww, wh);
    applyCamera(next, true);
  }, [applyCamera]);

  /** Let the well go without committing anything (cancel, second finger). */
  const abortWell = useCallback(() => {
    const well = gravityWellRef.current;
    well.active = false;
    well.mass = 0;
    well.gather = 0;
    well.mode = "gather";
    pointerIntentRef.current = null;
    frayRef.current = null;
  }, []);

  const zoomIn = useCallback(() => {
    zoomBy(ZOOM_STEP);
    haptics.ripple(0.38);
    markSky("deeper in", "nebula", 0.38, "object", "zoom-in");
    try { getFieldAudio().chime(); } catch { /* noop */ }
  }, [markSky, zoomBy]);

  const zoomOut = useCallback(() => {
    zoomBy(-ZOOM_STEP);
    haptics.tap();
    markSky("wider field", "star", 0.34, "object", "zoom-out");
    try { getFieldAudio().spark(); } catch { /* noop */ }
  }, [markSky, zoomBy]);

  const persistCosmicMemory = useCallback((
    born: BornStar[] = bornStarsRef.current,
    holes: UserBlackHole[] = userBlackHolesRef.current,
    worlds: UserPlanet[] = userPlanetsRef.current,
  ) => {
    const layer = activeLayerRef.current;
    memoryRef.current.layers[layer] = {
      bornStars: born.slice(-MAX_BORN_STARS_PER_LAYER),
      blackHoles: holes.slice(-MAX_USER_BLACK_HOLES),
      planets: worlds.slice(-MAX_USER_PLANETS_PER_LAYER),
      consumedSeedIds: [...(consumedSeedRef.current.get(layer) ?? [])],
    };
    memoryRef.current.camera = cameraRef.current;
    memoryRef.current.version = 2;
    saveCosmicMemoryV2(memoryRef.current);
  }, []);

  // the whole-sky parting (LetGo, §8c): every layer's born stars fade and
  // every kept black hole evaporates — an exhale, never a blink. The cosmic
  // memory is written empty at once (an empty sky is a remembered state);
  // the visible matter lingers only as ghosts while the light leaves.
  const letSkyForget = useCallback(() => {
    if (forgetRef.current) return;
    const stars = bornStarsRef.current;
    const holes = userBlackHolesRef.current;
    const worlds = userPlanetsRef.current;
    const layers = memoryRef.current.layers;
    const anywhere =
      stars.length > 0 ||
      holes.length > 0 ||
      worlds.length > 0 ||
      Object.values(layers).some(
        (l) => l && ((l.bornStars?.length ?? 0) > 0 || (l.blackHoles?.length ?? 0) > 0 || (l.planets?.length ?? 0) > 0),
      );
    if (!anywhere) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dur = reduce ? 420 : 1800;
    forgetRef.current = { t0: performance.now(), dur, stars, holes, planets: worlds };
    window.setTimeout(() => { forgetRef.current = null; }, dur + 120);
    bornStarsRef.current = [];
    userBlackHolesRef.current = [];
    userPlanetsRef.current = [];
    setBornStars([]);
    setUserBlackHoles([]);
    setUserPlanets([]);
    consumedSeedRef.current.set(activeLayerRef.current, new Set());
    memoryRef.current.layers = {};
    saveCosmicMemoryV2(memoryRef.current);
    try { getFieldAudio().thud(); } catch { /* noop */ }
    try { getFieldAudio().playNote(33, 520); } catch { /* noop */ }
    haptics.roll();
    markSky("the sky forgets", "star", 0.4, "kept", "letgo");
  }, [markSky]);

  const screenToSky = useCallback((x: number, y: number): { nx: number; ny: number } => {
    const ww = window.innerWidth || 1;
    const wh = window.innerHeight || 1;
    return camScreenToSky(cameraRef.current, x, y, ww, wh);
  }, []);

  const heatSky = useCallback((nx: number, ny: number, amount: number) => {
    const layer = activeLayerRef.current;
    let grid = automataRef.current.get(layer);
    if (!grid) {
      grid = createAutomata(LAYER_PROFILES[layer].seed);
      automataRef.current.set(layer, grid);
    }
    heatAutomata(grid, nx, ny, amount);
  }, []);

  const addCosmicEvent = useCallback((event: Omit<CosmicEvent, "id" | "t0">) => {
    cosmicEventsRef.current = [
      ...cosmicEventsRef.current.slice(-18),
      {
        ...event,
        id: ++skyPulseId.current,
        t0: performance.now(),
      },
    ];
  }, []);

  /**
   * A star is struck out of the sky, and how hard it was struck is how much
   * of a star it is: intensity (force, then contact area, then approach
   * speed — whatever the hardware can actually feel) sets its mass, its
   * light, and whether it is bright enough to carry diffraction spikes.
   */
  const birthStarAt = useCallback((x: number, y: number, intensity = 0.5) => {
    const { nx, ny } = screenToSky(x, y);
    const seed = Math.floor((Date.now() + x * 997 + y * 431) % 0xFFFFFFFF);
    const rng = makeRng(seed);
    const palettes: Array<[number, number, number]> = [
      [126, 220, 214],
      [255, 218, 148],
      [184, 206, 255],
      [238, 156, 204],
    ];
    const rgb = palettes[Math.floor(rng() * palettes.length)];
    const force = 0.5 + intensity; // 0.5 (feather) .. 1.5 (a real strike)
    const born: BornStar = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      nx,
      ny,
      size: (0.75 + rng() * 1.8) * force,
      brightness: Math.min(1, (0.66 + rng() * 0.3) * (0.72 + intensity * 0.56)),
      twinklePhase: rng() * Math.PI * 2,
      twinkleAmt: 0.22 + rng() * 0.52,
      spikeLen: rng() > 0.72 - intensity * 0.34 ? (5 + rng() * 8) * force : 0,
      rgb,
      createdAt: Date.now(),
    };
    const nextStars = [...bornStarsRef.current, born].slice(-MAX_BORN_STARS_PER_LAYER);
    bornStarsRef.current = nextStars;
    setBornStars(nextStars);
    persistCosmicMemory(nextStars, userBlackHolesRef.current);
    heatSky(nx, ny, 0.2 + intensity * 0.34);
    addCosmicEvent({
      kind: "birth",
      x,
      y,
      life: 3.4,
      seed,
      rgb,
      power: (0.95 + rng() * 0.4) * force,
    });
    haptics.ripple(0.28 + intensity * 0.42);
    markSky("star born", "birth", 0.72, "object", "star-birth");
    try {
      const audio = getFieldAudio();
      audio.chime();
      // heavier stars ring lower — the strike is audible as well as visible
      audio.playTone(520 / force, 0.18 + intensity * 0.22);
    } catch { /* noop */ }
  }, [addCosmicEvent, heatSky, markSky, persistCosmicMemory, screenToSky]);

  /** Find the born star nearest a screen point, within radiusPx. */
  const findBornStarAt = useCallback((x: number, y: number, radiusPx = 18): BornStar | null => {
    const pos = bornStarPosRef.current;
    if (!pos) return null;
    const t = performance.now() / 1000;
    let best: BornStar | null = null;
    let bestD = radiusPx;
    for (const s of bornStarsRef.current) {
      const p = pos(s, t);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }, []);

  // Tap a star you made and it answers — a small flare of its own light,
  // its own tone. Nothing is created; the sky simply knows you.
  const answerBornStar = useCallback((star: BornStar, x: number, y: number) => {
    addCosmicEvent({ kind: "birth", x, y, life: 1.1, seed: Math.floor(star.createdAt % 0xffff), rgb: star.rgb, power: 0.4 + star.size * 0.2 });
    haptics.tap();
    const [r, g, b] = star.rgb;
    const bright = (r + g + b) / (3 * 255);
    try { getFieldAudio().playTone(220 + bright * 320 + star.size * 40, 0.24); } catch { /* noop */ }
    markSky("the star answers", "star", 0.3, "object", "star-answer", false);
  }, [addCosmicEvent, markSky]);

  // Double-tap a born star and a world condenses out of its disk — the
  // way planets actually arrive, from the leftover light of a star's
  // making. The planet keeps the star's hue and takes a close orbit.
  const condensePlanetAt = useCallback((star: BornStar, x: number, y: number) => {
    const seed = Math.floor((Date.now() + star.nx * 4093 + star.ny * 8191) % 0xFFFFFFFF);
    const rng = makeRng(seed);
    const [r, g, b] = star.rgb;
    const hue = (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180 / Math.PI + 360) % 360;
    const orbit = 0.020 + rng() * 0.016;
    const ang = rng() * Math.PI * 2;
    const world: UserPlanet = {
      id: makeId("pl"),
      nx: clampPan(star.nx + Math.cos(ang) * orbit),
      ny: clampPan(star.ny + Math.sin(ang) * orbit),
      seed,
      hue,
      createdAt: Date.now(),
    };
    const next = [...userPlanetsRef.current, world].slice(-MAX_USER_PLANETS_PER_LAYER);
    userPlanetsRef.current = next;
    setUserPlanets(next);
    persistCosmicMemory(bornStarsRef.current, userBlackHolesRef.current, next);
    addCosmicEvent({ kind: "birth", x, y, life: 1.8, seed, rgb: [r, g, b], power: 0.85 });
    heatSky(world.nx, world.ny, 0.4);
    haptics.ripple(0.6);
    try {
      const audio = getFieldAudio();
      audio.chime();
      window.setTimeout(() => { try { audio.playTone(140 + (hue % 120), 0.4); } catch { /* noop */ } }, 180);
    } catch { /* noop */ }
    markSky("a world condenses", "birth", 0.8, "sigil", "planet-birth");
  }, [addCosmicEvent, heatSky, markSky, persistCosmicMemory]);

  // A black hole merger sings its true "chirp" — a rising, quickening
  // glide as the orbit tightens, the audible signature of two horizons
  // becoming one. Heavier pairs sing deeper and slower, and the sweep
  // cuts off into the low ringdown of the single horizon left behind.
  const chirpTone = useCallback((totalMass = 2) => {
    try {
      const audio = getFieldAudio();
      const depth = 0.7 + totalMass * 0.28;
      const steps = 9;
      let at = 0;
      for (let i = 0; i < steps; i++) {
        const u = i / (steps - 1);
        const f = (110 / depth) * Math.pow(3.4, u * u);
        window.setTimeout(() => {
          try { audio.playTone(f, 0.14); } catch { /* noop */ }
        }, at);
        at += (95 - 62 * u) * depth;
      }
      window.setTimeout(() => {
        try { audio.playTone(66 / depth, 0.6); } catch { /* noop */ }
      }, at + 160 * depth);
    } catch {
      /* noop */
    }
  }, []);

  // Core black-hole birth — commits a hole to state + persistence and
  // returns it. Callers add their own flourishes (touch / collapse).
  const commitBlackHole = useCallback((
    nx: number,
    ny: number,
    seed: number,
    massBoost = 0,
  ): UserBlackHole => {
    const rng = makeRng(seed);
    const hole: UserBlackHole = {
      id: makeId("bh"),
      nx,
      ny,
      mass: Math.min(3.6, 0.82 + rng() * 0.88 + massBoost),
      spin: (rng() < 0.5 ? -1 : 1) * (0.45 + rng() * 0.75),
      hue: 28 + rng() * 220,
      createdAt: Date.now(),
    };
    const nextHoles = [...userBlackHolesRef.current, hole].slice(-MAX_USER_BLACK_HOLES);
    userBlackHolesRef.current = nextHoles;
    setUserBlackHoles(nextHoles);
    heatSky(nx, ny, 0.55);
    persistCosmicMemory(bornStarsRef.current, nextHoles);
    return hole;
  }, [heatSky, persistCosmicMemory]);

  const supernovaAt = useCallback((
    x: number,
    y: number,
    rgb: [number, number, number] = [255, 180, 96],
    writeTape = true,
    collapse = false,
  ) => {
    const seed = Math.floor((Date.now() + x * 379 + y * 883) % 0xFFFFFFFF);
    addCosmicEvent({
      kind: "supernova",
      x,
      y,
      life: 3.6,
      seed,
      rgb,
      power: 1.0,
    });
    haptics.roll();
    markSky(collapse ? "core-collapse" : "supernova", "supernova", 0.88, "sigil", "supernova", writeTape);
    try { getFieldAudio().bell(); } catch { /* noop */ }
    // A massive core-collapse leaves a remnant that falls in on itself and
    // becomes a brand-new black hole — the two systems, tied together.
    if (collapse) {
      const { nx, ny } = screenToSky(x, y);
      window.setTimeout(() => {
        if (userBlackHolesRef.current.length >= MAX_USER_BLACK_HOLES) return;
        commitBlackHole(nx, ny, (seed ^ 0x9e3779b9) >>> 0, 0.25);
        addCosmicEvent({ kind: "collapse", x, y, life: 2.2, seed, rgb: [210, 180, 255], power: 1.1 });
        haptics.chop();
        try { getFieldAudio().thud(); } catch { /* noop */ }
      }, 2500);
    }
  }, [addCosmicEvent, commitBlackHole, markSky, screenToSky]);

  const createBlackHoleAt = useCallback((x: number, y: number, massBoost = 0) => {
    const { nx, ny } = screenToSky(x, y);
    const seed = Math.floor((Date.now() + x * 619 + y * 173) % 0xFFFFFFFF);
    const hole = commitBlackHole(nx, ny, seed, massBoost);
    addCosmicEvent({
      kind: "collapse",
      x,
      y,
      life: 2.2,
      seed,
      rgb: [210, 180, 255],
      power: hole.mass,
    });
    haptics.chop();
    markSky(massBoost > 0.4 ? "horizon swollen" : "black hole made", "gravity", 0.95, "sigil", "black-hole");
    try { getFieldAudio().thud(); } catch { /* noop */ }
    return hole;
  }, [addCosmicEvent, commitBlackHole, markSky, screenToSky]);

  /** Long-hold release: grow/create hole, consume nearby born stars, coast the rest inward. */
  const releaseAccretion = useCallback((x: number, y: number, holdMs: number, wellMass: number) => {
    const { nx, ny } = screenToSky(x, y);
    const massBoost = Math.min(2.2, wellMass * 0.85 + holdMs / 2200);
    const horizon = 0.012 + massBoost * 0.01;
    const pullR = horizon * 8;
    const remaining: BornStar[] = [];
    const layer = activeLayerRef.current;
    let consumed = consumedSeedRef.current.get(layer);
    if (!consumed) {
      consumed = new Set();
      consumedSeedRef.current.set(layer, consumed);
    }
    for (const s of bornStarsRef.current) {
      const d = Math.hypot(s.nx - nx, s.ny - ny);
      if (d < horizon * 1.35) {
        continue; // swallowed
      }
      if (d < pullR) {
        const ux = (nx - s.nx) / Math.max(0.0001, d);
        const uy = (ny - s.ny) / Math.max(0.0001, d);
        const speed = 0.04 + wellMass * 0.05;
        remaining.push({
          ...s,
          vx: (s.vx ?? 0) + ux * speed,
          vy: (s.vy ?? 0) + uy * speed,
        });
      } else {
        remaining.push(s);
      }
    }
    // dim/consume nearby seeded stars for this session
    const stars = activeFieldRef.current.stars;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const d = Math.hypot(s.nx - nx, s.ny - ny);
      if (d < horizon * 1.6) consumed.add(i);
    }
    bornStarsRef.current = remaining;
    setBornStars(remaining);
    // condensed worlds too close to the new horizon go with it
    const keptWorlds = userPlanetsRef.current.filter(
      (p) => Math.hypot(p.nx - nx, p.ny - ny) >= horizon * 1.5,
    );
    if (keptWorlds.length !== userPlanetsRef.current.length) {
      userPlanetsRef.current = keptWorlds;
      setUserPlanets(keptWorlds);
    }
    createBlackHoleAt(x, y, massBoost);
    persistCosmicMemory(remaining, userBlackHolesRef.current);
    heatSky(nx, ny, 0.7);
    markSky("stars follow in", "gravity", 0.85, "sigil", "accretion-release", false);
  }, [createBlackHoleAt, heatSky, markSky, persistCosmicMemory, screenToSky]);

  // ── new cosmic-event spawners ──────────────────────────────────────
  // Each fires on its own timer AND can be summoned by touch. They share
  // the addCosmicEvent transient pool; the RAF loop draws them by kind.

  const spawnPulsar = useCallback((x: number, y: number) => {
    const seed = Math.floor((Date.now() + x * 211 + y * 733) % 0xFFFFFFFF);
    addCosmicEvent({ kind: "pulsar", x, y, life: 4.6, seed, rgb: [170, 224, 255], power: 0.9 });
    haptics.tap();
    markSky("pulsar sweeping", "pulsar", 0.6, "object", "pulsar");
    try {
      const audio = getFieldAudio();
      for (let i = 0; i < 6; i++) {
        window.setTimeout(() => { try { audio.playTone(1180, 0.05); } catch { /* noop */ } }, i * 320);
      }
    } catch { /* noop */ }
  }, [addCosmicEvent, markSky]);

  const spawnComet = useCallback((x?: number, y?: number) => {
    const ww = typeof window !== "undefined" ? window.innerWidth : 1200;
    const wh = typeof window !== "undefined" ? window.innerHeight : 800;
    const ang = Math.random() * Math.PI * 2;
    const reach = Math.hypot(ww, wh) * (0.85 + Math.random() * 0.4);
    // start off an edge if no explicit origin, so it truly streaks across
    const sx = x ?? ww * 0.5 - Math.cos(ang) * reach * 0.5;
    const sy = y ?? wh * 0.5 - Math.sin(ang) * reach * 0.5;
    const seed = Math.floor((Date.now() + sx * 97 + sy * 389) % 0xFFFFFFFF);
    addCosmicEvent({ kind: "comet", x: sx, y: sy, life: 4.4, seed, rgb: [198, 228, 255], power: 0.85, ang, reach });
    haptics.ripple(0.34);
    markSky("comet streaking", "comet", 0.5, "object", "comet");
    try { getFieldAudio().spark(); } catch { /* noop */ }
  }, [addCosmicEvent, markSky]);

  const spawnTidalFlare = useCallback((x: number, y: number) => {
    const seed = Math.floor((Date.now() + x * 457 + y * 131) % 0xFFFFFFFF);
    addCosmicEvent({ kind: "tidal", x, y, life: 3.4, seed, rgb: [255, 150, 96], power: 1.0, ang: Math.random() * Math.PI * 2 });
    haptics.roll();
    markSky("star torn apart", "tidal", 0.82, "sigil", "tidal-disruption");
    try { getFieldAudio().bell(); } catch { /* noop */ }
  }, [addCosmicEvent, markSky]);

  const spawnNova = useCallback((x: number, y: number) => {
    const seed = Math.floor((Date.now() + x * 619 + y * 241) % 0xFFFFFFFF);
    addCosmicEvent({ kind: "nova", x, y, life: 1.9, seed, rgb: [255, 238, 200], power: 0.8 });
    haptics.tap();
    markSky("nova flash", "nova", 0.58, "object", "nova");
    try { getFieldAudio().chime(); } catch { /* noop */ }
  }, [addCosmicEvent, markSky]);

  const spawnStarForm = useCallback((x: number, y: number) => {
    const { nx, ny } = screenToSky(x, y);
    const seed = Math.floor((Date.now() + x * 331 + y * 907) % 0xFFFFFFFF);
    const rng = makeRng(seed);
    addCosmicEvent({ kind: "starform", x, y, life: 4.0, seed, rgb: [140, 236, 200], power: 0.9 });
    // a nebula region condensing into new twinkling stars — birthlight.
    const palettes: Array<[number, number, number]> = [
      [126, 220, 214], [255, 218, 148], [184, 206, 255], [238, 156, 204],
    ];
    const spawned: BornStar[] = [];
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const rgb = palettes[Math.floor(rng() * palettes.length)];
      spawned.push({
        id: makeId("s"),
        nx: Math.max(0.02, Math.min(0.98, nx + (rng() - 0.5) * 0.05)),
        ny: Math.max(0.02, Math.min(0.98, ny + (rng() - 0.5) * 0.05)),
        size: 0.6 + rng() * 1.3,
        brightness: 0.6 + rng() * 0.3,
        twinklePhase: rng() * Math.PI * 2,
        twinkleAmt: 0.3 + rng() * 0.5,
        spikeLen: rng() > 0.6 ? 4 + rng() * 6 : 0,
        rgb,
        createdAt: Date.now(),
      });
    }
    const nextStars = [...bornStarsRef.current, ...spawned].slice(-MAX_BORN_STARS_PER_LAYER);
    bornStarsRef.current = nextStars;
    setBornStars(nextStars);
    heatSky(nx, ny, 0.45);
    persistCosmicMemory(nextStars, userBlackHolesRef.current);
    haptics.ripple(0.42);
    markSky("stars forming", "starform", 0.66, "object", "star-formation");
    try { getFieldAudio().chime(); } catch { /* noop */ }
  }, [addCosmicEvent, heatSky, markSky, persistCosmicMemory, screenToSky]);

  const spawnGrb = useCallback((x: number, y: number) => {
    const seed = Math.floor((Date.now() + x * 787 + y * 149) % 0xFFFFFFFF);
    addCosmicEvent({ kind: "grb", x, y, life: 1.5, seed, rgb: [206, 255, 176], power: 1.0, ang: Math.random() * Math.PI });
    haptics.chop();
    markSky("gamma-ray burst", "grb", 0.9, "sigil", "gamma-ray-burst");
    try { getFieldAudio().bell(); } catch { /* noop */ }
  }, [addCosmicEvent, markSky]);

  // load saved constellations on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const j = JSON.parse(raw) as SavedConstellation[];
        if (Array.isArray(j)) setSaved(j);
      }
    } catch {
      /* noop */
    }
  }, []);

  // load nested cosmic memory (v2) + migrate v1 galactic matter
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mem = loadCosmicMemoryV2();
    memoryRef.current = mem;
    if (mem.camera) {
      const zoom = clampZoom(mem.camera.zoom ?? 1);
      const cam = {
        zoom,
        panX: clampPanForZoom(mem.camera.panX ?? 0.5, zoom),
        panY: clampPanForZoom(mem.camera.panY ?? 0.5, zoom),
      };
      cameraRef.current = cam;
      setCamera(cam);
      const layer = layerFromZoom(cam.zoom);
      activeLayerRef.current = layer;
      setActiveLayer(layer);
      activeFieldRef.current = getLayerField(layer);
    }
    for (const id of LAYER_ORDER) {
      automataRef.current.set(id, createAutomata(LAYER_PROFILES[id].seed));
      const lm = mem.layers[id];
      if (lm?.consumedSeedIds?.length) {
        consumedSeedRef.current.set(id, new Set(lm.consumedSeedIds.filter((n) => typeof n === "number")));
      }
    }
    const layer = activeLayerRef.current;
    const lm = mem.layers[layer] ?? emptyLayerMemory();
    const stars = (Array.isArray(lm.bornStars) ? lm.bornStars : [])
      .filter((s): s is BornStar =>
        !!s && typeof (s as BornStar).id === "string" &&
        typeof (s as BornStar).nx === "number" &&
        typeof (s as BornStar).ny === "number" &&
        Array.isArray((s as BornStar).rgb),
      )
      .slice(-MAX_BORN_STARS_PER_LAYER);
    const holes = (Array.isArray(lm.blackHoles) ? lm.blackHoles : [])
      .filter((h): h is UserBlackHole =>
        !!h && typeof (h as UserBlackHole).id === "string" &&
        typeof (h as UserBlackHole).nx === "number" &&
        typeof (h as UserBlackHole).ny === "number" &&
        typeof (h as UserBlackHole).mass === "number",
      )
      .slice(-MAX_USER_BLACK_HOLES);
    const worlds = (Array.isArray(lm.planets) ? lm.planets : [])
      .filter((p): p is UserPlanet =>
        !!p && typeof (p as UserPlanet).id === "string" &&
        typeof (p as UserPlanet).nx === "number" &&
        typeof (p as UserPlanet).ny === "number" &&
        typeof (p as UserPlanet).seed === "number",
      )
      .slice(-MAX_USER_PLANETS_PER_LAYER);
    setBornStars(stars);
    bornStarsRef.current = stars;
    setUserBlackHoles(holes);
    userBlackHolesRef.current = holes;
    setUserPlanets(worlds);
    userPlanetsRef.current = worlds;
    prefetchNearbyLayers(layer);
  }, []);

  const persistSaved = useCallback((list: SavedConstellation[]) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* noop */
    }
  }, []);

  // commit a named constellation — either rename an existing saved one
  // (when editingId is set, e.g. via double-click on a name) or create a
  // new one from the pending selection.
  const commitName = useCallback(() => {
    const name = nameValue.trim();
    // editing path: rename in place
    if (editingId) {
      if (!name) {
        setNaming(false);
        setNameValue("");
        setEditingId(null);
        setNamePos(null);
        return;
      }
      const list = savedRef.current.map((c) =>
        c.id === editingId ? { ...c, name } : c,
      );
      setSaved(list);
      persistSaved(list);
      setNaming(false);
      setNameValue("");
      setEditingId(null);
      setNamePos(null);
      try { getFieldAudio().bell(); } catch { /* noop */ }
      haptics.roll();
      markSky("name changed", "kept", 0.72, "kept", "rename", false);
      recordTape("kept", 0.85, `stars/${name}`);
      return;
    }
    if (!name || pendingRef.current.length < 3) {
      setNaming(false);
      setNameValue("");
      return;
    }
    const next: SavedConstellation = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      starIndices: [...pendingRef.current],
      createdAt: Date.now(),
    };
    const list = [next, ...savedRef.current];
    setSaved(list);
    persistSaved(list);
    setPending([]);
    setNaming(false);
    setNameValue("");
    setNamePos(null);
    try { getFieldAudio().bell(); } catch { /* noop */ }
    haptics.roll();
    markSky("constellation kept", "kept", 0.9, "kept", "kept", false);
    recordTape("kept", 1.0, `stars/${name}`);
  }, [editingId, markSky, nameValue, persistSaved, recordTape]);

  // cancel pending
  const cancelPending = useCallback(() => {
    if (pendingRef.current.length > 0) {
      haptics.chop();
      markSky("selection cleared", "gravity", 0.32, "object", "clear");
    }
    setPending([]);
    setNaming(false);
    setNameValue("");
    setNamePos(null);
  }, [markSky]);

  // Unbind a saved constellation. The old two-step (right-click, then
  // right-click again to confirm) is now physical and touch-reachable: a
  // ceremony hold on the shape slackens and frays its lines while the hand
  // stays, and only the completed ceremony calls this. Letting go early
  // snaps the lines back — the confirmation is the holding.
  const deleteSaved = useCallback(
    (id: string) => {
      const list = savedRef.current.filter((c) => c.id !== id);
      if (list.length === savedRef.current.length) return;
      setSaved(list);
      persistSaved(list);
      haptics.roll();
      try { getFieldAudio().thud(); } catch { /* noop */ }
      markSky("constellation forgotten", "gravity", 0.62, "object", "forget");
    },
    [markSky, persistSaved],
  );

  // ── canvas init + render loop ──────────────────────────────────────
  useEffect(() => {
    const bg = bgRef.current;
    const fg = fgRef.current;
    if (!bg || !fg) return;
    const bctx = bg.getContext("2d");
    const fctx = fg.getContext("2d");
    if (!bctx || !fctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = reduce ? 0 : 1;

    // create the offscreen canvas once and stash on the ref so we can
    // repaint on resize without recreating the element.
    if (!staticRef.current) {
      staticRef.current = document.createElement("canvas");
    }
    const staticCanvas = staticRef.current;
    const sctx = staticCanvas.getContext("2d");
    if (!sctx) return;

    let raf = 0;

    // Gradient memos for the handful of falloffs whose *shape* moves (an
    // accretion disk's rim tracks mass and zoom). Everything with a fixed
    // shape is a baked sprite; nothing here allocates on a steady frame.
    // One memo per family so the keys stay small and cannot collide.
    const gPlanet = makeGradCache();
    const gWorld = makeGradCache();
    const gJet = makeGradCache();
    const gDisk = makeGradCache();
    const gPhoton = makeGradCache();
    const gBeam = makeGradCache();
    const gTail = makeGradCache();
    const gBurst = makeGradCache();
    const gSky = makeGradCache();
    const gNight = makeGradCache();
    const gQuasar = makeGradCache();
    const gWell = makeGradCache();

    // ── interstellar dust — the medium the wind actually combs ───────
    // Seeded motes in normalized sky space. They drift on their own slow
    // current when nobody is touching (the sky is never still), and lean
    // into the wind when three fingers push, so weather lands in the
    // material instead of in a number. Flat pixels: no gradient, no blur.
    const DUST_N = 200;
    const dust = new Float32Array(DUST_N * 3); // nx, ny, phase
    {
      const drng = makeRng(0xd05715);
      for (let i = 0; i < DUST_N; i++) {
        dust[i * 3] = drng();
        dust[i * 3 + 1] = drng();
        dust[i * 3 + 2] = drng() * Math.PI * 2;
      }
    }

    // The frame governor: real frame time picks the quality tier, the tier
    // picks the DPR and how much of the field is drawn at all.
    const gov = createFrameGovernor();
    let detail = detailForTier("high");
    let tier: QualityTier = "high";
    let simT = 0;      // dilated clock — three fingers slow this, not the wall
    let lastFrame = 0;
    let frameDilation = 1; // read by the per-frame integrators (infall, etc.)

    let w = window.innerWidth;
    let h = window.innerHeight;
    let dpr = resolveDpr(isEmbeddedFrame() ? "medium" : "high", {
      embedded: isEmbeddedFrame(),
      reducedMotion: reduce,
      maxDpr: 2,
    });

    // ── static-layer painter ──────────────────────────────────────
    // Paint the universe that never changes: gradient sky, Milky Way
    // structure (band + dust lanes + HII regions + perpendicular
    // gradient), nebulae (5, each with 3-5 wisps), black-hole
    // accretion rings, and small galaxies. We render at backing-store
    // resolution so the blit is 1:1 in device pixels.
    const paintStatic = () => {
      const field = activeFieldRef.current;
      const NEBULAE = field.nebulae;
      const BLACKHOLES = field.blackHoles;
      const GALAXIES = field.galaxies;
      const showMw = field.id === "galactic" || field.id === "cluster";
      const sw = w;
      const sh = h;
      const base = Math.min(sw, sh);
      staticCanvas.width = sw * dpr;
      staticCanvas.height = sh * dpr;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, sw, sh);

      // ── deep background gradient — slightly warm horizon ─────
      // From near-black at edges into a marginally lighter blue-black
      // center, with a faint warm cast pulled in from the bottom so
      // the scene reads as a vast field with an atmospheric base.
      const sky = sctx.createLinearGradient(0, 0, 0, sh);
      sky.addColorStop(0,    "#000204");
      sky.addColorStop(0.55, "#04060c");
      sky.addColorStop(1,    "#070a12");
      sctx.fillStyle = sky;
      sctx.fillRect(0, 0, sw, sh);

      // faint warm horizon glow (Hubble images often have one)
      {
        const horizon = sctx.createRadialGradient(
          sw * 0.18, sh * 1.05, 0,
          sw * 0.18, sh * 1.05, base * 1.4,
        );
        horizon.addColorStop(0,    "rgba(80, 50, 30, 0.18)");
        horizon.addColorStop(0.45, "rgba(40, 30, 25, 0.06)");
        horizon.addColorStop(1,    "rgba(0, 0, 0, 0)");
        sctx.fillStyle = horizon;
        sctx.fillRect(0, 0, sw, sh);
      }

      // ── Milky Way band ───────────────────────────────────────
      // (1) perpendicular gradient: a diagonal band of soft light
      // (2) dark dust lanes: a few subtle dark splotches along the
      //     band axis to break it up
      // (3) HII regions: small pink/cyan emission nebulae embedded
      if (showMw) {
        const cx = sw * 0.5;
        const cy = sh * 0.5;
        sctx.save();
        sctx.translate(cx, cy);
        sctx.rotate(MW_BAND_ANGLE);

        const bandLen = Math.max(sw, sh) * 1.2;
        const bandHalf = base * MW_BAND_HALF_THICKNESS;
        // perpendicular gradient — soft on edges, bright at middle
        const bg = sctx.createLinearGradient(0, -bandHalf * 2.4, 0, bandHalf * 2.4);
        bg.addColorStop(0,    "rgba(120, 140, 180, 0.00)");
        bg.addColorStop(0.35, "rgba(150, 165, 200, 0.04)");
        bg.addColorStop(0.5,  "rgba(190, 200, 225, 0.085)");
        bg.addColorStop(0.65, "rgba(150, 165, 200, 0.04)");
        bg.addColorStop(1,    "rgba(120, 140, 180, 0.00)");
        sctx.fillStyle = bg;
        sctx.fillRect(-bandLen, -bandHalf * 2.4, bandLen * 2, bandHalf * 4.8);

        // dust lanes — dark, organic blobs along the band centerline
        const dustRng = makeRng(0xDEAD12);
        for (let i = 0; i < 14; i++) {
          const u = (dustRng() - 0.5) * bandLen * 1.6;
          const v = (dustRng() - 0.5) * bandHalf * 0.8;
          const r = base * (0.04 + dustRng() * 0.07);
          const dg = sctx.createRadialGradient(u, v, 0, u, v, r);
          dg.addColorStop(0,    "rgba(0, 0, 0, 0.22)");
          dg.addColorStop(0.55, "rgba(0, 0, 0, 0.08)");
          dg.addColorStop(1,    "rgba(0, 0, 0, 0)");
          sctx.fillStyle = dg;
          sctx.beginPath();
          sctx.ellipse(u, v, r * (0.8 + dustRng() * 0.6), r * (0.5 + dustRng() * 0.5), dustRng() * Math.PI, 0, Math.PI * 2);
          sctx.fill();
        }

        // HII regions — small pink/cyan emission nebulae embedded
        // in the band. They're tiny relative to the main nebulae and
        // colored to evoke Sagittarius / Eagle Nebula clumps.
        const hiiRng = makeRng(0xC0EDA1);
        const hiiColors: Array<[number, number, number]> = [
          [240, 130, 170], // pink
          [120, 200, 220], // cyan
          [240, 170, 130], // warm pink-orange
        ];
        for (let i = 0; i < 10; i++) {
          const u = (hiiRng() - 0.5) * bandLen * 1.2;
          const v = (hiiRng() - 0.5) * bandHalf * 1.2;
          const r = base * (0.020 + hiiRng() * 0.030);
          const c = hiiColors[Math.floor(hiiRng() * hiiColors.length)];
          const hg = sctx.createRadialGradient(u, v, 0, u, v, r);
          hg.addColorStop(0,    `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.30)`);
          hg.addColorStop(0.5,  `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.10)`);
          hg.addColorStop(1,    `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0)`);
          sctx.fillStyle = hg;
          sctx.beginPath();
          sctx.arc(u, v, r, 0, Math.PI * 2);
          sctx.fill();
        }

        sctx.restore();
      }

      // ── nebulae — layered wisps ──────────────────────────────
      // each nebula is a stack of 3-5 wisps with their own offsets,
      // rotation, squash, and seeded noise-modulated alpha. Drawn
      // with "lighter" composite so overlapping wisps brighten
      // rather than just average — this is what creates the
      // structured deep-space color volume.
      for (let ni = 0; ni < NEBULAE.length; ni++) {
        const n = NEBULAE[ni];
        const px = n.nx * sw;
        const py = n.ny * sh;
        const baseR = base * n.rBase;
        sctx.save();
        sctx.translate(px, py);
        sctx.rotate(n.rot);
        const prevComp = sctx.globalCompositeOperation;
        sctx.globalCompositeOperation = "lighter";
        for (const wisp of n.wisps) {
          const wx = wisp.ox * baseR * 2;
          const wy = wisp.oy * baseR * 2;
          const wr = baseR * wisp.rScale;
          // seeded noise modulation — sample a hash value to get a
          // pseudo-noise alpha multiplier per wisp.
          const noiseA =
            0.6 +
            0.4 * hash01(wisp.noiseSeed * 1.7 + ni * 31);
          const coreA = Math.min(1, wisp.alpha * noiseA * 2.3);
          const midA = Math.min(1, wisp.alpha * noiseA * 0.9);
          sctx.save();
          sctx.translate(wx, wy);
          sctx.rotate(wisp.rot);
          sctx.scale(1, wisp.squashY);
          const [r, g, b] = wisp.rgb;
          const grad = sctx.createRadialGradient(0, 0, 0, 0, 0, wr);
          grad.addColorStop(0,    `rgba(${r}, ${g}, ${b}, ${coreA.toFixed(3)})`);
          grad.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${midA.toFixed(3)})`);
          grad.addColorStop(1,    `rgba(${r}, ${g}, ${b}, 0)`);
          sctx.fillStyle = grad;
          sctx.beginPath();
          sctx.arc(0, 0, wr, 0, Math.PI * 2);
          sctx.fill();
          sctx.restore();
        }
        sctx.globalCompositeOperation = prevComp;
        sctx.restore();
      }

      // ── black holes — accretion disks + lensing halo ─────────
      // The actual gravitational lensing of stars happens per frame
      // (offsetting star positions). What we bake here is the
      // dark singularity, the bright disk, and a faint photon-ring
      // glow around the horizon.
      for (const bh of BLACKHOLES) {
        const px = bh.nx * sw;
        const py = bh.ny * sh;
        const rH = base * bh.rHorizon;
        const rDin = base * bh.rDiskIn;
        const rDout = base * bh.rDiskOut;
        sctx.save();
        sctx.translate(px, py);

        // photon-ring glow — faint warm halo just outside horizon
        const photon = sctx.createRadialGradient(0, 0, rH, 0, 0, rH * 3.2);
        photon.addColorStop(0,    `rgba(${bh.hotRgb[0]}, ${bh.hotRgb[1]}, ${bh.hotRgb[2]}, 0.35)`);
        photon.addColorStop(0.5,  `rgba(${bh.hotRgb[0]}, ${bh.hotRgb[1]}, ${bh.hotRgb[2]}, 0.12)`);
        photon.addColorStop(1,    `rgba(${bh.hotRgb[0]}, ${bh.hotRgb[1]}, ${bh.hotRgb[2]}, 0)`);
        sctx.fillStyle = photon;
        sctx.beginPath();
        sctx.arc(0, 0, rH * 3.2, 0, Math.PI * 2);
        sctx.fill();

        // accretion disk — elliptical projection (squash on Y),
        // built from a radial gradient ring. We composite "lighter"
        // so the disk reads as luminance over the photon ring.
        const prevComp = sctx.globalCompositeOperation;
        sctx.globalCompositeOperation = "lighter";
        sctx.rotate(bh.rot);
        sctx.save();
        sctx.scale(1, bh.tilt);
        const disk = sctx.createRadialGradient(0, 0, rDin, 0, 0, rDout);
        disk.addColorStop(0,    "rgba(255, 230, 180, 0.70)");
        disk.addColorStop(0.20, "rgba(255, 190, 130, 0.55)");
        disk.addColorStop(0.55, "rgba(220, 130, 100, 0.30)");
        disk.addColorStop(1,    "rgba(160, 60, 90, 0)");
        sctx.fillStyle = disk;
        sctx.beginPath();
        sctx.arc(0, 0, rDout, 0, Math.PI * 2);
        sctx.fill();
        sctx.restore();
        sctx.globalCompositeOperation = prevComp;

        // dark singularity — pure black core punched over the disk
        const core = sctx.createRadialGradient(0, 0, 0, 0, 0, rH * 1.6);
        core.addColorStop(0,    "rgba(0, 0, 0, 1)");
        core.addColorStop(0.7,  "rgba(0, 0, 0, 0.9)");
        core.addColorStop(1,    "rgba(0, 0, 0, 0)");
        sctx.fillStyle = core;
        sctx.beginPath();
        sctx.arc(0, 0, rH * 1.6, 0, Math.PI * 2);
        sctx.fill();

        sctx.restore();
      }

      // ── galaxies — small log-spirals ─────────────────────────
      // rotation is so slow that for static-painting purposes we use
      // the initial rot; the visible turn is imperceptible at typical
      // viewing time scales. (If we wanted to animate them we'd need
      // to repaint, which would defeat the perf goal.)
      for (const gx of GALAXIES) {
        const px = gx.nx * sw;
        const py = gx.ny * sh;
        const rCore = base * gx.rCore;
        const rDisk = base * gx.rDisk;
        sctx.save();
        sctx.translate(px, py);
        sctx.rotate(gx.rot);
        sctx.scale(1, gx.tilt);

        // diffuse galaxy halo
        const prevComp = sctx.globalCompositeOperation;
        sctx.globalCompositeOperation = "lighter";
        const halo = sctx.createRadialGradient(0, 0, 0, 0, 0, rDisk);
        halo.addColorStop(0,    `rgba(${gx.armRgb[0]}, ${gx.armRgb[1]}, ${gx.armRgb[2]}, 0.22)`);
        halo.addColorStop(0.4,  `rgba(${gx.armRgb[0]}, ${gx.armRgb[1]}, ${gx.armRgb[2]}, 0.10)`);
        halo.addColorStop(1,    `rgba(${gx.armRgb[0]}, ${gx.armRgb[1]}, ${gx.armRgb[2]}, 0)`);
        sctx.fillStyle = halo;
        sctx.beginPath();
        sctx.arc(0, 0, rDisk, 0, Math.PI * 2);
        sctx.fill();

        // spiral arms — sample points along a log spiral, paint a
        // small soft dot at each. The arms are stamped by replacing
        // theta with theta + (2pi/arms)*armIdx.
        const armSteps = 80;
        for (let arm = 0; arm < gx.arms; arm++) {
          for (let s = 0; s < armSteps; s++) {
            const u = s / armSteps; // 0..1
            // log spiral: r = rCore * exp(twist * theta)
            const theta = u * 2.6 * Math.PI + (arm * (2 * Math.PI)) / gx.arms;
            const rad = rCore * 1.4 + Math.exp(gx.twist * theta) * rCore * 0.55;
            if (rad > rDisk) break;
            const x = Math.cos(theta) * rad;
            const y = Math.sin(theta) * rad;
            const a = (1 - u) * 0.55;
            const dotR = rCore * 0.55 * (1 + u * 0.6);
            const dg = sctx.createRadialGradient(x, y, 0, x, y, dotR);
            dg.addColorStop(0,    `rgba(${gx.armRgb[0]}, ${gx.armRgb[1]}, ${gx.armRgb[2]}, ${a.toFixed(3)})`);
            dg.addColorStop(1,    `rgba(${gx.armRgb[0]}, ${gx.armRgb[1]}, ${gx.armRgb[2]}, 0)`);
            sctx.fillStyle = dg;
            sctx.beginPath();
            sctx.arc(x, y, dotR, 0, Math.PI * 2);
            sctx.fill();
          }
        }
        sctx.globalCompositeOperation = prevComp;

        // bright core
        const core = sctx.createRadialGradient(0, 0, 0, 0, 0, rCore * 2.2);
        core.addColorStop(0,    `rgba(${gx.coreRgb[0]}, ${gx.coreRgb[1]}, ${gx.coreRgb[2]}, 0.95)`);
        core.addColorStop(0.4,  `rgba(${gx.coreRgb[0]}, ${gx.coreRgb[1]}, ${gx.coreRgb[2]}, 0.5)`);
        core.addColorStop(1,    `rgba(${gx.coreRgb[0]}, ${gx.coreRgb[1]}, ${gx.coreRgb[2]}, 0)`);
        sctx.fillStyle = core;
        sctx.beginPath();
        sctx.arc(0, 0, rCore * 2.2, 0, Math.PI * 2);
        sctx.fill();

        sctx.restore();
      }
    };

    const resize = () => {
      // The governor's tier is the DPR ceiling: a phone that starts to
      // labour drops backing-store resolution before it drops frames.
      dpr = resolveDpr(tier, { embedded: isEmbeddedFrame(), reducedMotion: reduce, maxDpr: 2 });
      w = window.innerWidth;
      h = window.innerHeight;
      bg.width = w * dpr;
      bg.height = h * dpr;
      fg.width = w * dpr;
      fg.height = h * dpr;
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintStatic();
    };
    resize();
    window.addEventListener("resize", resize);

    paintStaticRef.current = paintStatic;

    const cameraZoom = (t: number): number => {
      const breath = motion ? 1 + Math.sin(t * 0.05) * 0.012 : 1;
      return cameraRef.current.zoom * breath;
    };

    // Scratch camera reused every call — worldPos runs thousands of times a
    // frame and must not allocate.
    const camScratch: Camera = { panX: 0.5, panY: 0.5, zoom: 1 };

    const worldPos = (
      nx: number,
      ny: number,
      t: number,
      rotate: boolean,
    ): { x: number; y: number } => {
      const cam = cameraRef.current;
      const breath = motion ? 1 + Math.sin(t * 0.05) * 0.012 : 1;
      // three fingers turn the season: the whole field precesses, walking
      // the constellations through the year without moving the camera.
      const ang = (rotate && motion ? t * 0.003 : 0) + (rotate ? seasonRef.current : 0);
      camScratch.panX = cam.panX;
      camScratch.panY = cam.panY;
      camScratch.zoom = cam.zoom * breath;
      const p = skyToScreen(camScratch, nx, ny, w, h, ang);
      // the vessel leaning: the near sky slides further than the deep field
      const lean = leanRef.current;
      p.x += lean.x * 22;
      p.y += lean.y * 22;
      return p;
    };

    // idle drift — even a lone hole should feel alive. Small, slow, seeded
    // by createdAt so each hole wanders on its own path. Held still under
    // reduced motion.
    const holeDrift = (hole: UserBlackHole, t: number): { nx: number; ny: number } => {
      if (!motion) return { nx: hole.nx, ny: hole.ny };
      const ph = ((hole.createdAt % 1000) / 1000) * Math.PI * 2;
      const rate = 0.045 + ((hole.createdAt % 7) * 0.006);
      return {
        nx: hole.nx + Math.sin(t * rate + ph) * 0.016,
        ny: hole.ny + Math.cos(t * rate * 0.8 + ph * 1.3) * 0.013,
      };
    };

    // effective normalized position of a user hole, incorporating idle
    // drift and — during a merger — the tightening inspiral toward the
    // shared midpoint of the two doomed horizons.
    const effHoleNorm = (hole: UserBlackHole, t: number, nowMs: number): { nx: number; ny: number; inspiral: number } => {
      const d = holeDrift(hole, t);
      const m = mergerRef.current;
      if (m && !m.committed && (m.aId === hole.id || m.bId === hole.id)) {
        const u = Math.max(0, Math.min(1, (nowMs - m.tStartMs) / m.durMs));
        const midNx = (m.ax + m.bx) / 2;
        const midNy = (m.ay + m.by) / 2;
        const baseNx = hole.id === m.aId ? m.ax : m.bx;
        const baseNy = hole.id === m.aId ? m.ay : m.by;
        const vx = baseNx - midNx;
        const vy = baseNy - midNy;
        const r0 = Math.hypot(vx, vy);
        const ang0 = Math.atan2(vy, vx);
        const tighten = Math.pow(1 - u, 1.4);
        const orbit = ang0 + (motion ? u * u * Math.PI * 7 * m.spinSign : 0);
        return {
          nx: midNx + Math.cos(orbit) * r0 * tighten,
          ny: midNy + Math.sin(orbit) * r0 * tighten,
          inspiral: u,
        };
      }
      return { nx: d.nx, ny: d.ny, inspiral: 0 };
    };

    const userHoleScreen = (hole: UserBlackHole, t: number, nowMs: number): { x: number; y: number; inspiral: number } => {
      const e = effHoleNorm(hole, t, nowMs);
      const p = worldPos(e.nx, e.ny, t, false);
      return { x: p.x, y: p.y, inspiral: e.inspiral };
    };

    const lensPoint = (
      px: number,
      py: number,
      t: number,
    ): { x: number; y: number } => {
      let x = px;
      let y = py;
      const base = Math.min(w, h);
      const zoom = cameraZoom(t);

      const applyLens = (
        hx: number,
        hy: number,
        horizon: number,
        lensRadius: number,
        strength: number,
        spin: number,
      ) => {
        const dx = hx - x;
        const dy = hy - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= 0.5 || d2 > lensRadius * lensRadius) return;
        const d = Math.sqrt(d2);
        const ux = dx / d;
        const uy = dy / d;
        const b = Math.max(d, horizon * 1.08);
        const falloff = Math.pow(Math.max(0, 1 - d / lensRadius), 1.65);
        const einsteinR = Math.sqrt(horizon * lensRadius) * 0.72;
        const ring = Math.exp(-(((d - einsteinR) / Math.max(1, einsteinR * 0.34)) ** 2));
        // Schwarzschild-ish deflection: proportional to radius^2 / impact
        // parameter, damped so it stays beautiful instead of swallowing the UI.
        const schwarz = Math.min(lensRadius * 0.22, (horizon * horizon * 9.5 * strength) / b);
        const pull = schwarz * falloff + ring * horizon * 0.42 * strength;
        const swirl = spin * (schwarz * 0.24 + ring * horizon * 0.62) * falloff;
        x += ux * pull - uy * swirl;
        y += uy * pull + ux * swirl;
      };

      for (const bh of activeFieldRef.current.blackHoles) {
        const { x: hx, y: hy } = worldPos(bh.nx, bh.ny, t, false);
        const horizon = base * bh.rHorizon * zoom;
        // animate the lens: a living Einstein-ring shimmer + a swirl that
        // keeps pace with the disk rotation, so starlight bends and drags.
        const shimmer = motion ? 1 + 0.14 * Math.sin(t * 1.3 + bh.rot * 3) : 1;
        applyLens(
          hx,
          hy,
          horizon,
          base * bh.rLens * zoom,
          bh.lensStrength * shimmer,
          (motion ? Math.sin(bh.rot + t * 0.5) : Math.sin(bh.rot)) * 0.72,
        );
      }

      const nowMsL = performance.now();
      for (const hole of userBlackHolesRef.current) {
        const { x: hx, y: hy, inspiral } = userHoleScreen(hole, t, nowMsL);
        const bornAge = Math.min(1, (Date.now() - hole.createdAt) / 1800);
        const horizon = base * (0.010 + hole.mass * 0.0065) * zoom * (0.72 + bornAge * 0.28);
        // stronger, animated swirl drags nearby starlight into a spiral and
        // stretches it into spaghettification streaks near the horizon.
        const spinDrag = hole.spin * (motion ? 1.15 + 0.25 * Math.sin(t * 1.6 + hole.mass) : 1);
        const shimmer = motion ? 1 + 0.16 * Math.sin(t * 1.7 + hole.mass * 4) : 1;
        applyLens(
          hx,
          hy,
          horizon * (1 + inspiral * 0.5),
          horizon * (18 + hole.mass * 4.5) * (1 + inspiral * 0.4),
          (0.78 + hole.mass * 0.24) * shimmer,
          spinDrag,
        );
      }

      const well = gravityWellRef.current;
      // Lens only while truly accreting — not on every brief touch.
      if (well.active && well.mode === "accrete") {
        const grow = Math.min(1, well.mass / 2.4);
        applyLens(
          well.x,
          well.y,
          base * (0.014 + grow * 0.028),
          base * (0.20 + grow * 0.28),
          0.62 + grow * 0.75,
          0.82,
        );
      }

      // gravitational waves — a merger's spacetime ripple races outward and
      // displaces starlight radially as the wavefront passes through it. The
      // per-frame geometry (_cx/_cy/_r/_amp) is cached in draw().
      const waves = gravWavesRef.current;
      for (let wi = 0; wi < waves.length; wi++) {
        const gw = waves[wi];
        if (gw._amp === undefined || gw._cx === undefined || gw._cy === undefined || gw._r === undefined) continue;
        const dx = x - gw._cx;
        const dy = y - gw._cy;
        const d = Math.hypot(dx, dy);
        if (d < 1) continue;
        const width = base * 0.14;
        const off = d - gw._r;
        if (Math.abs(off) > width) continue;
        const disp = Math.sin((off / width) * Math.PI) * gw._amp;
        x += (dx / d) * disp;
        y += (dy / d) * disp;
      }

      return { x, y };
    };

    // map a star (by index) to its current viewport position, taking the
    // slow camera rotation + breathing zoom into account. Also applies
    // gravitational lensing — stars near a black hole get nudged toward
    // it within the lensing radius.
    const starPos = (
      idx: number,
      t: number,
    ): { x: number; y: number } => {
      const s = activeFieldRef.current.stars[idx];
      if (!s) return { x: -9999, y: -9999 };
      const { x, y } = worldPos(s.nx, s.ny, t, true);
      return lensPoint(x, y, t);
    };

    const bornStarPos = (s: { nx: number; ny: number }, t: number): { x: number; y: number } => {
      const { x, y } = worldPos(s.nx, s.ny, t, true);
      return lensPoint(x, y, t);
    };

    starPosRef.current = starPos;
    bornStarPosRef.current = bornStarPos;

    // ── per-star renderer — halo / glow / core / diffraction spikes
    // Layered draw for a single star at (x, y). For most stars this is
    // 2 passes (glow + core); for the brightest, we add a 4-pointed
    // cross flare (telescope diffraction).
    //
    // Same layers, same order, same stops as before — but the two soft
    // passes are baked sprites stamped with drawImage instead of a pair of
    // canvas gradients built from scratch for every star of every frame.
    // At galactic depth that is ~1400 allocations a frame removed; the core
    // stays a flat arc fill so its edge never softens.
    const drawStar = (
      s: Pick<Star, "rgb" | "size" | "spikeLen">,
      x: number,
      y: number,
      alpha: number,
      rgbOverride?: readonly [number, number, number],
    ): void => {
      const src = rgbOverride ?? s.rgb;
      const r = src[0];
      const g = src[1];
      const b = src[2];
      const size = s.size * Math.min(2.2, Math.sqrt(cameraRef.current.zoom));

      // outer halo — only for stars that have it (medium+)
      if (size > 1.0) {
        stamp(bctx, sprite(TAG_HALO, r, g, b, FALL_HALO), x, y, size * 5.5, alpha);
      }

      // mid glow — soft bloom around the core
      stamp(bctx, sprite(TAG_GLOW, r, g, b, FALL_GLOW), x, y, size * 2.4, alpha);

      // core — slightly desaturated toward white for hot reading
      const coreAlpha = Math.min(1, alpha * 1.1);
      // mix in white based on size — bigger stars look "saturated" at center
      const wt = Math.min(1, (size - 0.4) / 2.4);
      const cr = Math.round(r + (255 - r) * wt * 0.55);
      const cg = Math.round(g + (255 - g) * wt * 0.55);
      const cb = Math.round(b + (255 - b) * wt * 0.55);
      bctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${coreAlpha.toFixed(3)})`;
      bctx.beginPath();
      bctx.arc(x, y, size, 0, Math.PI * 2);
      bctx.fill();

      // diffraction spikes — 4-pointed cross for the brightest sources
      if (s.spikeLen > 0) {
        const len = s.spikeLen;
        // thin highlight at center crossings — composite as lighter so
        // overlapping nebulae receive the spike's full brightness.
        const prev = bctx.globalCompositeOperation;
        const prevA = bctx.globalAlpha;
        bctx.globalCompositeOperation = "lighter";
        bctx.globalAlpha = prevA * Math.min(1, alpha);
        bctx.drawImage(sprite(TAG_SPIKE_H, cr, cg, cb, FALL_SOFT), x - len, y - 0.6, len * 2, 1.2);
        bctx.drawImage(sprite(TAG_SPIKE_V, cr, cg, cb, FALL_SOFT), x - 0.6, y - len, 1.2, len * 2);
        bctx.globalAlpha = prevA;
        bctx.globalCompositeOperation = prev;
      }
    };

    const drawPlanetSystems = (t: number): void => {
      const zoom = cameraRef.current.zoom;
      const reveal = smoothstep(PLANET_REVEAL_ZOOM, ZOOM_MAX * 0.82, zoom);
      if (reveal <= 0) return;
      const base = Math.min(w, h);
      bctx.save();
      bctx.globalCompositeOperation = "lighter";
      const PLANET_SYSTEMS = activeFieldRef.current.planets;
      for (let i = 0; i < PLANET_SYSTEMS.length; i++) {
        const p = PLANET_SYSTEMS[i];
        const { x, y } = worldPos(p.nx, p.ny, t, false);
        const r = base * p.bodyR * zoom;
        const cull = r * p.ringR * 2.2 + 24;
        if (x < -cull || x > w + cull || y < -cull || y > h + cull) continue;
        const a = reveal * Math.min(1, 0.55 + (zoom - PLANET_REVEAL_ZOOM) * 0.35);
        const [br, bg, bb] = p.hueRgb;
        const [rr, rg, rb] = p.ringRgb;
        const rot = p.rot + (motion ? t * (0.035 + i * 0.004) : 0);

        bctx.save();
        bctx.translate(x, y);
        bctx.rotate(rot);

        stamp(bctx, sprite(TAG_PGLOW, br, bg, bb, FALL_PGLOW), 0, 0, r * 4.4, 0.18 * a);

        bctx.save();
        bctx.scale(1, p.ringTilt);
        bctx.strokeStyle = `rgba(${rr}, ${rg}, ${rb}, ${(0.46 * a).toFixed(3)})`;
        bctx.lineWidth = Math.max(0.8, r * 0.16);
        bctx.beginPath();
        bctx.ellipse(0, 0, r * p.ringR, r * p.ringR, 0, 0, Math.PI * 2);
        bctx.stroke();
        bctx.strokeStyle = `rgba(${rr}, ${rg}, ${rb}, ${(0.20 * a).toFixed(3)})`;
        bctx.lineWidth = Math.max(0.6, r * 0.08);
        bctx.beginPath();
        bctx.ellipse(0, 0, r * (p.ringR * 1.24), r * (p.ringR * 1.24), 0, 0, Math.PI * 2);
        bctx.stroke();
        bctx.restore();

        // lit limb: the only falloff here whose shape is offset, so it keys
        // on the palette index and a quantised radius rather than baking.
        const aq = Math.round(a * 12);
        const planet = gPlanet(
          i * 100000 + Math.round(r * 4) * 32 + aq,
          () => {
            const gd = bctx.createRadialGradient(-r * 0.45, -r * 0.55, r * 0.1, 0, 0, r * 1.25);
            const av = aq / 12;
            gd.addColorStop(0, `rgba(255, 255, 245, ${(0.9 * av).toFixed(3)})`);
            gd.addColorStop(0.38, `rgba(${br}, ${bg}, ${bb}, ${(0.88 * av).toFixed(3)})`);
            gd.addColorStop(1, `rgba(${Math.max(0, br - 90)}, ${Math.max(0, bg - 90)}, ${Math.max(0, bb - 90)}, ${(0.92 * av).toFixed(3)})`);
            return gd;
          },
        );
        bctx.fillStyle = planet;
        bctx.beginPath();
        bctx.arc(0, 0, r, 0, Math.PI * 2);
        bctx.fill();

        for (const moon of p.moons) {
          const ma = moon.ang + (motion ? t * 0.045 : 0);
          const mx = Math.cos(ma) * r * moon.dist;
          const my = Math.sin(ma) * r * moon.dist * 0.62;
          bctx.fillStyle = `rgba(235, 230, 210, ${(0.58 * a).toFixed(3)})`;
          bctx.beginPath();
          bctx.arc(mx, my, Math.max(0.9, r * moon.size), 0, Math.PI * 2);
          bctx.fill();
        }

        bctx.restore();
      }
      bctx.restore();
    };

    // ── user worlds — condensed from born stars, persisted per layer ──
    // Each decodes wholly from its seed; hue is the parent star's light.
    // Unlike the deep procedural systems these are always visible — they
    // are yours, and the sky does not hide what you made.
    const drawUserPlanets = (t: number, alphaMul = 1, list?: UserPlanet[]): void => {
      const worlds = list ?? userPlanetsRef.current;
      if (!worlds.length) return;
      const zoom = cameraRef.current.zoom;
      const base = Math.min(w, h);
      bctx.save();
      bctx.globalCompositeOperation = "lighter";
      for (const p of worlds) {
        const d = decodeUserPlanet(p);
        const { x, y } = bornStarPos(p, t);
        const r = Math.max(2, base * d.bodyR * Math.sqrt(zoom));
        const cull = r * Math.max(2.2, d.ringR * 2.2) + 24;
        if (x < -cull || x > w + cull || y < -cull || y > h + cull) continue;
        const a = alphaMul * Math.min(1, 0.5 + zoom * 0.08);
        bctx.save();
        bctx.translate(x, y);
        if (d.ringed) {
          bctx.save();
          bctx.rotate(0.4 + (p.seed % 7) * 0.2);
          bctx.scale(1, d.ringTilt);
          bctx.strokeStyle = `hsla(${p.hue.toFixed(0)}, 60%, 72%, ${(0.4 * a).toFixed(3)})`;
          bctx.lineWidth = Math.max(0.8, r * 0.14);
          bctx.beginPath();
          bctx.ellipse(0, 0, r * d.ringR, r * d.ringR, 0, 0, Math.PI * 2);
          bctx.stroke();
          bctx.restore();
        }
        const hq = Math.round(p.hue / 6);
        const aq = Math.round(a * 12);
        const body = gWorld(
          hq * 100000 + Math.round(r * 4) * 32 + aq,
          () => {
            const hue = (hq * 6).toFixed(0);
            const av = aq / 12;
            const gd = bctx.createRadialGradient(-r * 0.4, -r * 0.5, r * 0.1, 0, 0, r * 1.2);
            gd.addColorStop(0, `hsla(${hue}, 55%, 88%, ${(0.9 * av).toFixed(3)})`);
            gd.addColorStop(0.4, `hsla(${hue}, 65%, 62%, ${(0.85 * av).toFixed(3)})`);
            gd.addColorStop(1, `hsla(${hue}, 70%, 26%, ${(0.9 * av).toFixed(3)})`);
            return gd;
          },
        );
        bctx.fillStyle = body;
        bctx.beginPath();
        bctx.arc(0, 0, r, 0, Math.PI * 2);
        bctx.fill();
        for (let mi = 0; mi < d.moons; mi++) {
          const ma = d.moonSeed * 6.28 + mi * 2.1 + (motion ? t * (0.14 + mi * 0.05) : 0);
          bctx.fillStyle = `rgba(235, 230, 210, ${(0.55 * a).toFixed(3)})`;
          bctx.beginPath();
          bctx.arc(
            Math.cos(ma) * r * (1.9 + mi * 0.55),
            Math.sin(ma) * r * (1.9 + mi * 0.55) * 0.6,
            Math.max(0.8, r * 0.16),
            0,
            Math.PI * 2,
          );
          bctx.fill();
        }
        bctx.restore();
      }
      bctx.restore();
    };

    // ── active black hole — the showpiece ──────────────────────────
    // A living engine that keeps the real proportions: the disk ends at
    // the last stable orbit (3 horizons), trapped light rings the last
    // photon orbit (1.5 horizons), the disk runs blackbody white→ember
    // as 1/R, tidal shredding scales as M/R³, and matter arriving at the
    // horizon is never seen to cross — it freezes, reddens, and fades on
    // the fade-out exponential, one quiet falling tone marking arrival.
    type BhVisual = {
      x: number; y: number; horizon: number; lensR: number;
      spin: number; tilt: number; hue: number; coolHue: number;
      intensity: number; mass: number; key: string;
      inspiral: number; lensCopy: boolean;
    };
    const MOTE_CAP = motion ? 16 : 7;
    const drawBlackHoleActive = (v: BhVisual, t: number, nowMs: number): void => {
      const base = Math.min(w, h);
      const zoom = cameraZoom(t);
      const { x, y, horizon, lensR, spin, tilt, hue, coolHue, intensity } = v;
      const orient = spin * 0.65;
      const diskOuter = horizon * (5.4 + v.mass * 1.2) * (1 + v.inspiral * 0.35);
      // the last stable orbit sits at 3 horizons — inside it nothing can
      // circle, so the disk ends there and a true gap opens to the edge
      const diskInner = horizon * 3.0;
      // the last photon orbit — trapped light rings the hole at 1.5 horizons
      const photonR = horizon * 1.5;
      const einsteinR = Math.sqrt(horizon * lensR) * 0.72;

      // ── infalling matter: spiral in, spaghettify, get consumed ──
      let motes = bhMotesRef.current.get(v.key);
      if (!motes) { motes = []; bhMotesRef.current.set(v.key, motes); }
      const horizonN = horizon / (base * zoom);
      const iscoN = diskInner / (base * zoom);
      const lensN = lensR / (base * zoom);
      // infall runs on the sky's clock, so it slows with it
      const step = (motion ? 1 : 0.32) * frameDilation;
      // feed the hole — always something falling in. Motes frozen at the
      // horizon hold their light but not a place in the live pool.
      let liveMotes = 0;
      for (const q of motes) if (!q.dyingAt) liveMotes++;
      if (liveMotes < MOTE_CAP && (Math.random() < (motion ? 0.34 : 0.12))) {
        const a = Math.random() * Math.PI * 2;
        motes.push({
          rn: lensN * (0.72 + Math.random() * 0.5),
          ang: a,
          va: Math.sign(spin || 1),
          size: 0.6 + Math.random() * 1.4,
          hue: hue + (Math.random() - 0.5) * 60,
          seed: Math.floor(Math.random() * 0xffff),
        });
      }
      bctx.save();
      bctx.translate(x, y);
      bctx.globalCompositeOperation = "lighter";
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        if (m.dyingAt) {
          // frozen at the edge: seen from here the mote never crosses.
          // Its last light dims on the fade-out exponential — half-life
          // grows with mass — while its color slides down the spectrum,
          // x-ray to ember to gone, and its orbital clock runs down.
          const dieT = (nowMs - m.dyingAt) / 1000;
          const half = 0.7 + v.mass * 0.55;
          const fadeL = Math.pow(0.5, dieT / half);
          if (fadeL < 0.035) { motes.splice(i, 1); continue; }
          m.ang += m.va * 0.02 * fadeL * step;
          const R = m.rn * base * zoom;
          const cs = Math.cos(orient);
          const sn = Math.sin(orient);
          const lx = Math.cos(m.ang) * R;
          const ly = Math.sin(m.ang) * R * tilt;
          const emberHue = 4 + 26 * fadeL;
          bctx.fillStyle = `hsla(${emberHue.toFixed(0)}, 96%, ${(38 + 30 * fadeL).toFixed(0)}%, ${(intensity * 0.6 * fadeL).toFixed(3)})`;
          bctx.beginPath();
          bctx.arc(lx * cs - ly * sn, lx * sn + ly * cs, Math.max(0.4, m.size * (0.5 + 0.5 * fadeL)), 0, Math.PI * 2);
          bctx.fill();
          continue;
        }
        // Kepler outside the last stable orbit; inside it there is no
        // orbit left to hold — the fall turns radial and runs away.
        const near = horizonN / Math.max(horizonN, m.rn);
        const plunge = Math.max(0, 1 - (m.rn - horizonN) / Math.max(1e-5, iscoN - horizonN));
        m.ang += m.va * (0.02 + 0.06 * near) * step * (0.6 + Math.abs(spin) * 0.5);
        m.rn -= (0.0011 + plunge * plunge * 0.0085) * step;
        if (m.rn <= horizonN * 1.02) {
          // arrival — the disk flares once, and the mote begins its long
          // frozen fade instead of vanishing. Keep the frozen pool bounded.
          m.rn = horizonN * 1.02;
          m.dyingAt = nowMs;
          bhFeedRef.current.set(v.key, nowMs);
          // the arrival, heard from far away: a quiet falling pair of
          // tones, pitched down by mass the way a heavier horizon rings
          // deeper — throttled so the sky never turns metronome
          if (nowMs - bhToneRef.current > 2800 && !v.key.startsWith("ghost-")) {
            bhToneRef.current = nowMs;
            try {
              const audio = getFieldAudio();
              const f0 = 196 / (0.8 + v.mass * 0.3);
              audio.playTone(f0, 0.2);
              window.setTimeout(() => {
                try { audio.playTone(f0 * 0.5, 0.3); } catch { /* noop */ }
              }, 150);
            } catch { /* noop */ }
          }
          let dyingCount = 0;
          let oldestIdx = -1;
          let oldestAt = Infinity;
          for (let j = 0; j < motes.length; j++) {
            const q = motes[j];
            if (!q.dyingAt) continue;
            dyingCount++;
            if (q.dyingAt < oldestAt) { oldestAt = q.dyingAt; oldestIdx = j; }
          }
          if (dyingCount > MOTE_CAP && oldestIdx >= 0) motes.splice(oldestIdx, 1);
          continue;
        }
        const R = m.rn * base * zoom;
        const lx = Math.cos(m.ang) * R;
        const ly = Math.sin(m.ang) * R * tilt;
        // orient into the disk plane
        const cs = Math.cos(orient);
        const sn = Math.sin(orient);
        const px = lx * cs - ly * sn;
        const py = lx * sn + ly * cs;
        const dopp = 0.5 + 0.5 * Math.cos(m.ang);
        const mh = m.hue - 40 * dopp;
        // spaghettification goes as M/R³ across the mote — relative to its
        // own horizon a small hole shreds far harder than a giant one, so
        // the streaks stretch long on light holes and stay short on heavy
        const shred = 2.4 * (1.9 / (0.7 + v.mass));
        const spag = Math.pow(Math.max(0, 1 - (m.rn - horizonN) / (lensN * 0.35)), 2);
        const streak = spag * horizon * shred;
        const alpha = intensity * (0.4 + 0.5 * dopp) * (0.5 + 0.5 * (1 - spag * 0.4));
        if (streak > 1) {
          const inx = (px / (R || 1));
          const iny = (py / (R || 1));
          bctx.strokeStyle = `hsla(${mh}, 100%, ${(70 + dopp * 20).toFixed(0)}%, ${alpha.toFixed(3)})`;
          bctx.lineWidth = Math.max(0.6, m.size * 0.9);
          bctx.beginPath();
          bctx.moveTo(px, py);
          bctx.lineTo(px - inx * streak, py - iny * streak);
          bctx.stroke();
        }
        bctx.fillStyle = `hsla(${mh}, 100%, ${(78 + dopp * 18).toFixed(0)}%, ${alpha.toFixed(3)})`;
        bctx.beginPath();
        bctx.arc(px, py, Math.max(0.5, m.size * (0.8 + dopp * 0.5)), 0, Math.PI * 2);
        bctx.fill();
      }
      bctx.restore();

      // ── optional lensed copy of the sky (user holes) ──
      if (v.lensCopy) {
        bctx.save();
        bctx.beginPath();
        bctx.arc(x, y, lensR * 0.92, 0, Math.PI * 2);
        bctx.clip();
        bctx.globalAlpha = 0.1 * intensity;
        bctx.globalCompositeOperation = "screen";
        bctx.translate(x, y);
        bctx.rotate(spin * 0.04 + t * spin * 0.015);
        bctx.scale(1.035 + v.mass * 0.01, 1.035 + v.mass * 0.01);
        bctx.drawImage(staticCanvas, -x, -y, w, h);
        bctx.restore();
      }

      // feeding flare boost — a fresh consumption briefly brightens the disk
      const feedAt = bhFeedRef.current.get(v.key) ?? 0;
      const feed = Math.max(0, 1 - (nowMs - feedAt) / 460);

      // ── relativistic jets — twin polar beams (active/large holes) ──
      const jetP = Math.max(0, Math.min(1, (v.mass - 0.85) * 1.3 + v.inspiral));
      if (jetP > 0.02 && motion) {
        bctx.save();
        bctx.translate(x, y);
        bctx.rotate(orient);
        bctx.globalCompositeOperation = "lighter";
        const jetLen = diskOuter * (2.0 + v.mass * 0.6);
        const flick = 0.55 + 0.45 * Math.sin(t * 9 + v.mass * 3);
        const chq = Math.round(coolHue / 6);
        const jlq = Math.round(jetLen / 4);
        const prevJetA = bctx.globalAlpha;
        // the beams' whole gradient scales with one factor, so the shape is
        // cached and the flicker rides globalAlpha
        bctx.globalAlpha = prevJetA * Math.min(1, jetP * flick);
        for (const dir of [-1, 1]) {
          const jg = gJet(
            chq * 100000 + jlq * 4 + (dir > 0 ? 1 : 0),
            () => {
              const hue = (chq * 6).toFixed(0);
              const gd = bctx.createLinearGradient(0, 0, 0, dir * jlq * 4);
              gd.addColorStop(0, `hsla(${hue}, 100%, 90%, 0.5)`);
              gd.addColorStop(0.5, `hsla(${hue}, 100%, 80%, 0.16)`);
              gd.addColorStop(1, `hsla(${hue}, 100%, 70%, 0)`);
              return gd;
            },
          );
          bctx.fillStyle = jg;
          const wBase = Math.max(1.2, horizon * 0.34);
          bctx.beginPath();
          bctx.moveTo(-wBase, 0);
          bctx.lineTo(wBase, 0);
          bctx.lineTo(wBase * 0.28, dir * jetLen);
          bctx.lineTo(-wBase * 0.28, dir * jetLen);
          bctx.closePath();
          bctx.fill();
        }
        bctx.restore();
      }

      bctx.save();
      bctx.translate(x, y);
      bctx.globalCompositeOperation = "lighter";

      // base disk gradient
      bctx.save();
      bctx.rotate(orient);
      bctx.scale(1, Math.max(0.14, tilt));
      const diskA = intensity * (0.5 + feed * 0.5);
      // the disk runs blackbody-hot: temperature falls as 1/R, so the
      // inner edge at the last stable orbit burns near-white (x-ray),
      // the middle glows in the hole's own light, and the rim cools to
      // ember red (infrared). More mass, hotter edge.
      const heat = Math.min(1, 0.55 + v.mass * 0.16);
      // every stop scales by diskA, so the shape caches and the brightness
      // rides globalAlpha — the feeding flare still breathes, for free
      const hq = Math.round(hue / 6);
      const htq = Math.round(heat * 10);
      const dinq = Math.round(diskInner * 2);
      const doutq = Math.round(diskOuter * 2);
      const disk = gDisk(
        hq * 1e8 + htq * 1e6 + (dinq % 1000) * 1000 + (doutq % 1000),
        () => {
          const hu = hq * 6;
          const ht = htq / 10;
          const gd = bctx.createRadialGradient(0, 0, dinq / 2, 0, 0, Math.max(dinq / 2 + 0.1, doutq / 2));
          gd.addColorStop(0, `hsla(${hu}, ${(34 + 30 * (1 - ht)).toFixed(0)}%, ${(86 + ht * 9).toFixed(0)}%, 0.55)`);
          gd.addColorStop(0.3, `hsla(${hu}, 95%, 66%, 0.32)`);
          gd.addColorStop(0.62, `hsla(${hu + 14}, 90%, 52%, 0.16)`);
          gd.addColorStop(1, `hsla(8, 92%, 42%, 0)`);
          return gd;
        },
      );
      const prevDiskA = bctx.globalAlpha;
      bctx.globalAlpha = prevDiskA * Math.min(1, diskA);
      bctx.fillStyle = disk;
      bctx.beginPath();
      bctx.arc(0, 0, diskOuter, 0, Math.PI * 2);
      bctx.fill();
      bctx.globalAlpha = prevDiskA;

      // swirling orbital streaks — inner rings turn faster, all flicker
      const streaks = motion ? 11 : 4;
      for (let i = 0; i < streaks; i++) {
        const frac = (i * 0.618) % 1;
        const rr = diskInner + (diskOuter - diskInner) * frac;
        const speed = spin * (0.4 + 0.8 * (diskInner / rr));
        const a0 = i * 2.399 + (motion ? t * speed : 0);
        const arcLen = 0.55 + 0.6 * ((i * 0.37) % 1);
        const ca = a0 + arcLen * 0.5;
        const dopp = 0.5 + 0.5 * Math.cos(ca);
        const flick = 0.55 + 0.45 * Math.sin(t * (3.5 + i) + i * 1.7);
        // outer arcs ride the cooling gradient — their light slides down
        // toward ember red as 1/R carries the temperature away
        const hh = hue + (8 - hue) * (frac * 0.55) - 38 * dopp;
        const light = 52 + 34 * dopp + 12 * (1 - frac);
        const alpha = intensity * flick * (0.08 + 0.26 * dopp) * (0.6 + feed * 0.6);
        bctx.strokeStyle = `hsla(${hh}, 96%, ${light.toFixed(0)}%, ${alpha.toFixed(3)})`;
        bctx.lineWidth = Math.max(0.7, horizon * 0.05);
        bctx.beginPath();
        bctx.ellipse(0, 0, rr, rr, 0, a0, a0 + arcLen);
        bctx.stroke();
      }

      // Doppler-bright inner crescent (approaching side) + dim far edge —
      // ringing the disk's true inner rim at the last stable orbit
      bctx.strokeStyle = `hsla(${hue - 45}, 100%, 82%, ${(0.5 * intensity * (0.7 + feed * 0.5)).toFixed(3)})`;
      bctx.lineWidth = Math.max(1.4, horizon * 0.16);
      bctx.beginPath();
      bctx.ellipse(0, 0, diskInner * 1.02, diskInner * 1.02, 0, -0.5 * Math.PI, 0.5 * Math.PI);
      bctx.stroke();
      bctx.strokeStyle = `hsla(${hue + 40}, 80%, 52%, ${(0.2 * intensity).toFixed(3)})`;
      bctx.lineWidth = Math.max(1.0, horizon * 0.1);
      bctx.beginPath();
      bctx.ellipse(0, 0, diskInner * 1.02, diskInner * 1.02, 0, 0.5 * Math.PI, 1.5 * Math.PI);
      bctx.stroke();

      // Einstein-ring shimmer
      const ringSh = motion ? 0.6 + 0.4 * Math.sin(t * 2.2 + v.mass) : 0.7;
      bctx.strokeStyle = `hsla(${coolHue}, 96%, 76%, ${(0.2 * intensity * ringSh).toFixed(3)})`;
      bctx.lineWidth = 1.1;
      bctx.beginPath();
      bctx.ellipse(0, 0, einsteinR, einsteinR, 0, 0, Math.PI * 2);
      bctx.stroke();
      bctx.restore();

      // the last photon orbit — a razor ring of light circling at 1.5
      // horizons, round regardless of the disk's tilt: photons keep their
      // own orbit, disturbed only into flicker
      const photonSh = motion ? 0.65 + 0.35 * Math.sin(t * 3.1 + v.mass * 2) : 0.8;
      bctx.strokeStyle = `hsla(${hue}, 55%, 92%, ${(0.30 * intensity * photonSh).toFixed(3)})`;
      bctx.lineWidth = Math.max(0.7, horizon * 0.07);
      bctx.beginPath();
      bctx.arc(0, 0, photonR, 0, Math.PI * 2);
      bctx.stroke();

      // hot inner edge / Hawking shimmer at the horizon
      const hawk = motion ? 0.7 + 0.3 * Math.sin(t * 6 + v.mass * 5) : 0.7;
      const hotq = Math.round(hawk * (1 + feed) * 8);
      const feedq = Math.round(feed * 8);
      const horq = Math.round(horizon * 2);
      const hOut = (horq / 2) * (3 + feedq / 8);
      const photon = gPhoton(
        hq * 1e9 + Math.round(coolHue / 12) * 1e7 + hotq * 1e5 + feedq * 1e4 + (horq % 10000),
        () => {
          const gd = bctx.createRadialGradient(0, 0, (horq / 2) * 0.86, 0, 0, Math.max(0.1, hOut));
          gd.addColorStop(0, `hsla(${hq * 6}, 100%, 86%, ${(0.32 * (hotq / 8)).toFixed(3)})`);
          gd.addColorStop(0.52, `hsla(${coolHue.toFixed(0)}, 100%, 74%, 0.15)`);
          gd.addColorStop(1, "rgba(0, 0, 0, 0)");
          return gd;
        },
      );
      const prevPhA = bctx.globalAlpha;
      bctx.globalAlpha = prevPhA * Math.min(1, intensity);
      bctx.fillStyle = photon;
      bctx.beginPath();
      bctx.arc(0, 0, hOut, 0, Math.PI * 2);
      bctx.fill();
      bctx.globalAlpha = prevPhA;
      bctx.globalCompositeOperation = "source-over";

      // dark singularity — colourless, so one baked sprite serves every hole
      stamp(bctx, sprite(TAG_DARK, 0, 0, 0, FALL_DARK), 0, 0, horizon * 1.48, 1);
      bctx.restore();
    };

    const drawUserBlackHoles = (t: number, nowMs: number): void => {
      const base = Math.min(w, h);
      const zoom = cameraZoom(t);
      const holes = userBlackHolesRef.current;
      const liveKeys = new Set<string>();
      for (const hole of holes) {
        const { x, y, inspiral } = userHoleScreen(hole, t, nowMs);
        const bornAge = Math.min(1, (Date.now() - hole.createdAt) / 1800);
        const horizon = base * (0.010 + hole.mass * 0.0065) * zoom * (0.72 + bornAge * 0.28);
        const lensR = horizon * (18 + hole.mass * 4.5);
        liveKeys.add(hole.id);
        if (x < -lensR || x > w + lensR || y < -lensR || y > h + lensR) continue;
        drawBlackHoleActive({
          x, y, horizon, lensR,
          spin: hole.spin, tilt: 0.28 + hole.mass * 0.045,
          hue: hole.hue, coolHue: (hole.hue + 185) % 360,
          intensity: bornAge, mass: hole.mass, key: hole.id,
          inspiral, lensCopy: true,
        }, t, nowMs);
      }
      // release mote/feed pools for holes that no longer exist
      for (const key of bhMotesRef.current.keys()) {
        if (!key.startsWith("bh#") && !liveKeys.has(key)) bhMotesRef.current.delete(key);
      }
    };

    // Per-frame animated overlay for the two built-in black holes — the
    // static canvas bakes their base glow; this brings them to life.
    const drawStaticBlackHolesActive = (t: number, nowMs: number): void => {
      const BLACKHOLES = activeFieldRef.current.blackHoles;
      const base = Math.min(w, h);
      const zoom = cameraZoom(t);
      for (let i = 0; i < BLACKHOLES.length; i++) {
        const bh = BLACKHOLES[i];
        const { x, y } = worldPos(bh.nx, bh.ny, t, false);
        const horizon = base * bh.rHorizon * zoom;
        const lensR = base * bh.rLens * zoom;
        if (x < -lensR || x > w + lensR || y < -lensR || y > h + lensR) continue;
        drawBlackHoleActive({
          x, y, horizon, lensR,
          spin: (i === 0 ? 1 : -1) * 0.9, tilt: bh.tilt,
          hue: 34, coolHue: 210,
          intensity: 0.9, mass: 1.15, key: `bh#${i}`,
          inspiral: 0, lensCopy: false,
        }, t, nowMs);
      }
    };

    // gravitational waves — prep per-frame geometry + paint the shimmer ring
    const drawGravWaves = (t: number, nowMs: number): void => {
      const base = Math.min(w, h);
      const waves = gravWavesRef.current;
      if (!waves.length) return;
      gravWavesRef.current = waves.filter((gw) => (nowMs - gw.t0Ms) / 1000 < gw.life);
      for (const gw of gravWavesRef.current) {
        const age = (nowMs - gw.t0Ms) / 1000;
        const u = age / gw.life;
        const c = worldPos(gw.nx, gw.ny, t, false);
        const r = base * (0.05 + u * 1.15) * cameraZoom(t);
        const env = Math.pow(1 - u, 1.3);
        const amp = base * (motion ? 0.024 : 0.006) * env * Math.min(1.2, gw.strength);
        gw._cx = c.x; gw._cy = c.y; gw._r = r; gw._amp = amp; gw._env = env;
        // paint a racing double shimmer ring across the field
        bctx.save();
        bctx.globalCompositeOperation = "lighter";
        for (let k = -1; k <= 1; k++) {
          bctx.strokeStyle = `rgba(198, 168, 255, ${(0.22 * env * (k === 0 ? 1 : 0.5)).toFixed(3)})`;
          bctx.lineWidth = k === 0 ? 2.2 : 1.1;
          bctx.beginPath();
          bctx.arc(c.x, c.y, Math.max(1, r + k * base * 0.05), 0, Math.PI * 2);
          bctx.stroke();
        }
        bctx.restore();
      }
    };

    const drawCosmicEvents = (nowMs: number): void => {
      const base = Math.min(w, h);
      cosmicEventsRef.current = cosmicEventsRef.current.filter((ev) => (nowMs - ev.t0) / 1000 < ev.life);
      if (!cosmicEventsRef.current.length) return;

      const spinT = nowMs / 1000;
      for (const ev of cosmicEventsRef.current) {
        const age = (nowMs - ev.t0) / 1000;
        const u = Math.max(0, Math.min(1, age / ev.life));
        const [r, g, b] = ev.rgb;
        bctx.save();
        bctx.translate(ev.x, ev.y);

        if (ev.kind === "birth") {
          const bloom = Math.sin(Math.PI * u);
          const ringR = base * (0.012 + u * 0.090) * ev.power;
          bctx.globalCompositeOperation = "lighter";
          stamp(bctx, sprite(TAG_BLOOM, r, g, b, FALL_BLOOM), 0, 0, ringR * 1.8, bloom);
          bctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(0.48 * (1 - u)).toFixed(3)})`;
          bctx.lineWidth = 1.2;
          bctx.beginPath();
          bctx.arc(0, 0, ringR, 0, Math.PI * 2);
          bctx.stroke();
          for (let i = 0; i < 18; i++) {
            const a = hash01(ev.seed + i * 97) * Math.PI * 2;
            const d = ringR * (0.25 + hash01(ev.seed + i * 131) * 0.95);
            const px = Math.cos(a) * d;
            const py = Math.sin(a) * d;
            bctx.fillStyle = `rgba(255, 245, 210, ${(0.50 * (1 - u)).toFixed(3)})`;
            bctx.beginPath();
            bctx.arc(px, py, 0.8 + hash01(ev.seed + i * 173) * 1.2, 0, Math.PI * 2);
            bctx.fill();
          }
        } else if (ev.kind === "supernova") {
          const shell = base * (0.025 + u * 0.42) * ev.power;
          const alpha = Math.pow(1 - u, 0.82);
          bctx.globalCompositeOperation = "lighter";
          stamp(bctx, sprite(TAG_BLAST, r, g, b, FALL_BLAST), 0, 0, shell * 1.12, alpha);
          bctx.strokeStyle = `rgba(255, 232, 170, ${(0.62 * alpha).toFixed(3)})`;
          bctx.lineWidth = 1.6;
          bctx.beginPath();
          bctx.arc(0, 0, shell, 0, Math.PI * 2);
          bctx.stroke();
          bctx.strokeStyle = `rgba(160, 210, 255, ${(0.28 * alpha).toFixed(3)})`;
          bctx.lineWidth = 0.9;
          bctx.beginPath();
          bctx.arc(0, 0, shell * 0.64, 0, Math.PI * 2);
          bctx.stroke();
          for (let i = 0; i < 28; i++) {
            const a = hash01(ev.seed + i * 211) * Math.PI * 2;
            const d = shell * (0.24 + hash01(ev.seed + i * 241) * 0.88);
            const px = Math.cos(a) * d;
            const py = Math.sin(a) * d;
            bctx.fillStyle = `rgba(255, 230, 180, ${(0.42 * alpha).toFixed(3)})`;
            bctx.beginPath();
            bctx.arc(px, py, 0.7 + hash01(ev.seed + i * 263) * 1.8, 0, Math.PI * 2);
            bctx.fill();
          }
        } else if (ev.kind === "pulsar") {
          // spinning neutron star — sweeping lighthouse beams + strobe
          const life01 = Math.pow(1 - u, 0.5);
          const beamAng = motion ? spinT * 3.4 : ev.seed;
          const strobe = 0.4 + 0.6 * Math.abs(Math.sin(spinT * (motion ? 7 : 0.5)));
          bctx.globalCompositeOperation = "lighter";
          const beamLen = base * 0.52;
          for (const d of [0, Math.PI]) {
            bctx.save();
            bctx.rotate(beamAng + d);
            const bg = gBeam(
              (r << 16) + (g << 8) + b,
              () => {
                const gd = bctx.createLinearGradient(0, 0, beamLen, 0);
                gd.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.5)`);
                gd.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.14)`);
                gd.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
                return gd;
              },
            );
            bctx.globalAlpha = Math.min(1, life01 * strobe);
            bctx.fillStyle = bg;
            const halfW = base * 0.03;
            bctx.beginPath();
            bctx.moveTo(0, -halfW * 0.3);
            bctx.lineTo(0, halfW * 0.3);
            bctx.lineTo(beamLen, halfW);
            bctx.lineTo(beamLen, -halfW);
            bctx.closePath();
            bctx.fill();
            bctx.globalAlpha = 1;
            bctx.restore();
          }
          stamp(bctx, sprite(TAG_PULSAR, r, g, b, FALL_PULSAR), 0, 0, base * 0.02, life01 * strobe);
        } else if (ev.kind === "comet") {
          // a comet streaking across with a glowing tail
          const ang = ev.ang ?? 0;
          const reach = ev.reach ?? base;
          const hx = Math.cos(ang) * reach * u;
          const hy = Math.sin(ang) * reach * u;
          const fade = Math.sin(Math.PI * u);
          const tailLen = base * (0.13 + 0.05 * Math.sin(spinT * 10));
          const tx = hx - Math.cos(ang) * tailLen;
          const ty = hy - Math.sin(ang) * tailLen;
          bctx.globalCompositeOperation = "lighter";
          // the tail is drawn in its own frame so its gradient is cacheable:
          // head at the origin, tail running down +x
          const tlq = Math.max(2, Math.round(Math.hypot(tx - hx, ty - hy) / 2) * 2);
          const tg = gTail(
            tlq * 1e7 + (r << 16) + (g << 8) + b,
            () => {
              const gd = bctx.createLinearGradient(0, 0, tlq, 0);
              gd.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.7)`);
              gd.addColorStop(0.4, "rgba(180, 210, 255, 0.22)");
              gd.addColorStop(1, "rgba(180, 210, 255, 0)");
              return gd;
            },
          );
          bctx.save();
          bctx.translate(hx, hy);
          bctx.rotate(Math.atan2(ty - hy, tx - hx));
          bctx.globalAlpha = Math.min(1, fade);
          bctx.strokeStyle = tg;
          bctx.lineWidth = Math.max(1.4, base * 0.006);
          bctx.lineCap = "round";
          bctx.beginPath();
          bctx.moveTo(0, 0);
          bctx.lineTo(tlq, 0);
          bctx.stroke();
          bctx.restore();
          stamp(bctx, sprite(TAG_HEAD, r, g, b, FALL_HEAD), hx, hy, base * 0.02, fade);
        } else if (ev.kind === "tidal") {
          // tidal disruption flare — a star shredded into a spiral stream
          const flare = Math.sin(Math.PI * Math.min(1, u * 1.7));
          bctx.globalCompositeOperation = "lighter";
          stamp(bctx, sprite(TAG_TIDAL, r, g, b, FALL_TIDAL), 0, 0, base * 0.09, flare);
          const base0 = ev.ang ?? 0;
          for (let i = 0; i < 24; i++) {
            const p = i / 24;
            const a = base0 + p * 2.4 + (motion ? spinT * 0.7 : 0);
            const d = base * (0.02 + p * 0.15) * (0.7 + u);
            const px = Math.cos(a) * d;
            const py = Math.sin(a) * d * 0.55;
            bctx.fillStyle = `rgba(255, ${Math.round(150 + p * 60)}, 110, ${(0.5 * (1 - u) * (0.4 + p)).toFixed(3)})`;
            bctx.beginPath();
            bctx.arc(px, py, 0.8 + hash01(ev.seed + i * 53) * 1.6, 0, Math.PI * 2);
            bctx.fill();
          }
        } else if (ev.kind === "nova") {
          // nova flash — a quick brilliant bloom + thin ring, no remnant
          const fl = Math.pow(1 - u, 1.5);
          bctx.globalCompositeOperation = "lighter";
          stamp(bctx, sprite(TAG_NOVA, r, g, b, FALL_NOVA), 0, 0, base * 0.11, fl);
          bctx.strokeStyle = `rgba(255, 240, 210, ${(0.5 * (1 - u)).toFixed(3)})`;
          bctx.lineWidth = 1.3;
          bctx.beginPath();
          bctx.arc(0, 0, base * (0.02 + u * 0.14), 0, Math.PI * 2);
          bctx.stroke();
        } else if (ev.kind === "starform") {
          // star formation — a gas region condensing into new birthlight
          const cond = 1 - u;
          const bloom = Math.sin(Math.PI * u);
          bctx.globalCompositeOperation = "lighter";
          stamp(bctx, sprite(TAG_SFORM, r, g, b, FALL_SFORM), 0, 0, base * (0.14 * cond + 0.02), bloom);
          for (let i = 0; i < 10; i++) {
            const a = hash01(ev.seed + i * 71) * Math.PI * 2;
            const d = base * (0.015 + 0.05 * (1 - cond)) * (0.5 + hash01(ev.seed + i * 97));
            const px = Math.cos(a) * d;
            const py = Math.sin(a) * d;
            const ig = Math.max(0, u - 0.3) * (0.6 + hash01(ev.seed + i * 131) * 0.6);
            bctx.fillStyle = `rgba(255, 250, 230, ${(0.7 * ig).toFixed(3)})`;
            bctx.beginPath();
            bctx.arc(px, py, 0.7 + ig * 1.6, 0, Math.PI * 2);
            bctx.fill();
          }
        } else if (ev.kind === "grb") {
          // gamma-ray burst — a brief brilliant collimated twin beam
          const fl = Math.pow(1 - u, 0.8) * Math.min(1, u * 5);
          bctx.rotate(ev.ang ?? 0);
          bctx.globalCompositeOperation = "lighter";
          const len = base * 0.72;
          for (const d of [-1, 1]) {
            const bg = gBurst(
              (d > 0 ? 1 : 0) * 1e8 + (r << 16) + (g << 8) + b,
              () => {
                const gd = bctx.createLinearGradient(0, 0, 0, d * len);
                gd.addColorStop(0, "rgba(240, 255, 220, 0.85)");
                gd.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.3)`);
                gd.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
                return gd;
              },
            );
            bctx.globalAlpha = Math.min(1, fl);
            bctx.fillStyle = bg;
            const halfW = base * 0.012;
            bctx.beginPath();
            bctx.moveTo(-halfW, 0);
            bctx.lineTo(halfW, 0);
            bctx.lineTo(halfW * 0.25, d * len);
            bctx.lineTo(-halfW * 0.25, d * len);
            bctx.closePath();
            bctx.fill();
          }
          bctx.globalAlpha = 1;
          stamp(bctx, sprite(TAG_SOFT, 255, 255, 255, FALL_SOFT), 0, 0, base * 0.03, 0.9 * fl);
        } else if (ev.kind === "merger") {
          // black-hole merger burst — a bright ringing flash at the union
          const bl = Math.pow(1 - u, 0.7);
          bctx.globalCompositeOperation = "lighter";
          const br = base * (0.03 + u * 0.14) * ev.power;
          stamp(bctx, sprite(TAG_MERGER, r, g, b, FALL_MERGER), 0, 0, base * 0.16, bl);
          bctx.strokeStyle = `rgba(230, 210, 255, ${(0.6 * bl).toFixed(3)})`;
          bctx.lineWidth = 2;
          bctx.beginPath();
          bctx.arc(0, 0, br, 0, Math.PI * 2);
          bctx.stroke();
        } else {
          const implosion = Math.pow(1 - u, 0.72);
          const rOuter = base * (0.16 * implosion + 0.018) * ev.power;
          bctx.rotate(u * Math.PI * 3.4);
          bctx.globalCompositeOperation = "lighter";
          bctx.strokeStyle = `rgba(188, 168, 255, ${(0.36 * implosion).toFixed(3)})`;
          bctx.lineWidth = 1.4;
          for (let i = 0; i < 3; i++) {
            bctx.beginPath();
            bctx.ellipse(0, 0, rOuter * (1 + i * 0.20), rOuter * (0.22 + i * 0.05), i * 0.72, 0, Math.PI * 2);
            bctx.stroke();
          }
          bctx.globalCompositeOperation = "source-over";
          stamp(bctx, sprite(TAG_COLLAPSE, 0, 0, 0, FALL_COLLAPSE), 0, 0, rOuter * 0.62, 1 - implosion * 0.24);
        }

        bctx.restore();
      }
    };

    const draw = (now: number) => {
      const nowMs = now;
      // Hidden means asleep: no frame is measured, nothing is drawn, and
      // the governor keeps the tier it earned while it was being watched.
      if (pageHiddenRef.current) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const nextTier = gov.beginFrame(now);
      if (nextTier !== tier) {
        tier = nextTier;
        detail = detailForTier(tier);
        const nextDpr = resolveDpr(tier, { embedded: isEmbeddedFrame(), reducedMotion: reduce, maxDpr: 2 });
        if (Math.abs(nextDpr - dpr) > 0.01) {
          dpr = nextDpr;
          resize();
        }
      }
      // The clock the sky runs on. Three fingers resting on the field slow
      // it; face-down slows it further. The wall clock keeps its own time —
      // only what is alive here is dilated.
      const wallDt = lastFrame > 0 ? Math.min(0.064, (now - lastFrame) / 1000) : 0.016;
      lastFrame = now;
      const ease = Math.min(1, wallDt * 5);
      timeScaleRef.current += (timeScaleTargetRef.current - timeScaleRef.current) * ease;
      nightRef.current += (nightTargetRef.current - nightRef.current) * Math.min(1, wallDt * 1.6);
      const dilation = timeScaleRef.current * (1 - 0.55 * nightRef.current);
      frameDilation = dilation;
      simT += wallDt * dilation;
      const t = simT; // the sky's own seconds
      const night = nightRef.current;

      // the lens settles toward its rung between turns
      lensRef.current += (lensSnapRef.current - lensRef.current) * Math.min(1, wallDt * 6);
      const lensPos = lensRef.current;
      const lensSpectral = Math.max(0, 1 - Math.abs(lensPos - 1));
      const lensGrav = Math.max(0, 1 - Math.abs(lensPos - 2));

      // the wind lets go slowly — dust keeps travelling after the hand stops
      const wind = windRef.current;
      wind.ox += wind.vx * wallDt;
      wind.oy += wind.vy * wallDt;
      wind.vx *= Math.exp(-wallDt * 0.9);
      wind.vy *= Math.exp(-wallDt * 0.9);
      wind.ox *= Math.exp(-wallDt * 0.16);
      wind.oy *= Math.exp(-wallDt * 0.16);

      // one synchronised answer from everything alive
      const tuttiU = tuttiRef.current > 0 ? (nowMs - tuttiRef.current) / 1500 : 2;
      const tutti = tuttiU >= 0 && tuttiU < 1 ? Math.sin(Math.PI * tuttiU) : 0;

      // a knock on the case: a bell front racing out through the field
      const knock = knockRef.current;
      const knockU = knock ? (nowMs - knock.t0) / 1800 : 2;
      if (knock && knockU >= 1) knockRef.current = null;
      const knockR = knock && knockU < 1 ? Math.hypot(w, h) * knockU : -1;
      const knockAmp = knock && knockU < 1 ? Math.pow(1 - knockU, 1.4) : 0;
      const knockBand = Math.min(w, h) * 0.12;
      const field = activeFieldRef.current;
      const STARS = field.stars;
      const NEBULAE = field.nebulae;
      const BLACKHOLES = field.blackHoles;
      const GALAXIES = field.galaxies;
      const PLANET_SYSTEMS = field.planets;
      const fade = layerFadeRef.current;
      void GALAXIES;

      // ── BACKGROUND ───────────────────────────────────────────────
      // Blit the static universe in one drawImage. Then we layer
      // dynamic things (nebula breath flashes, star field) on top.
      bctx.clearRect(0, 0, w, h);
      // Continuous night fill so pan/zoom never flashes a hard black frame edge.
      {
        // one gradient for the life of this viewport, not one per frame
        const sky = gSky(Math.round(h), () => {
          const gd = bctx.createLinearGradient(0, 0, 0, h);
          gd.addColorStop(0, "#000204");
          gd.addColorStop(0.55, "#04060c");
          gd.addColorStop(1, "#070a12");
          return gd;
        });
        bctx.fillStyle = sky;
        bctx.fillRect(0, 0, w, h);
      }
      const zoom = cameraZoom(t);
      bctx.save();
      // Only soften during layer crossfade — otherwise keep the deep field solid.
      // Face-down night draws the gas down toward the dark it came from; the
      // temperature lens burns the coloured wash off so only stars are left.
      bctx.globalAlpha = (fade < 0.999 ? 0.55 + 0.45 * fade : 1)
        * (1 - 0.72 * night)
        * (1 - 0.55 * lensSpectral - 0.35 * lensGrav);
      bctx.translate(w * 0.5, h * 0.5);
      bctx.scale(zoom, zoom);
      // pan is already in worldPos; static is painted in layer-local normalized
      // space — shift by camera pan so deep field tracks navigation.
      const cam = cameraRef.current;
      // The wind combs the gas: the deep field slides against the star
      // field, and the vessel's lean parallaxes it a third as far as the
      // near sky, so the dome reads as depth rather than a flat card.
      const lean = leanRef.current;
      bctx.translate(
        (0.5 - cam.panX) * w + wind.ox + lean.x * 7,
        (0.5 - cam.panY) * h + wind.oy + lean.y * 7,
      );
      bctx.drawImage(staticCanvas, -w * 0.5, -h * 0.5, w, h);
      bctx.restore();

      // A slow, almost imperceptible night-shift: the field never reads
      // as a flat backdrop, even when nobody touches it.
      if (motion) {
        const era = 0.5 + 0.5 * Math.sin(t * 0.028);
        const driftX = w * (0.22 + 0.58 * (0.5 + 0.5 * Math.sin(t * 0.019)));
        const driftY = h * (0.24 + 0.42 * (0.5 + 0.5 * Math.cos(t * 0.016)));
        // built at the origin and carried under the drift by the transform,
        // so 32 era buckets cover every frame this room will ever draw
        const eraQ = Math.round(era * 31);
        const nightR = Math.min(w, h) * 0.92;
        const night = gNight(eraQ * 1e5 + Math.round(nightR), () => {
          const e = eraQ / 31;
          const gd = bctx.createRadialGradient(0, 0, 0, 0, 0, nightR);
          gd.addColorStop(0, `rgba(80, 120, 180, ${(0.02 + e * 0.018).toFixed(3)})`);
          gd.addColorStop(0.45, `rgba(130, 80, 170, ${(0.01 + (1 - e) * 0.012).toFixed(3)})`);
          gd.addColorStop(1, "rgba(0, 0, 0, 0)");
          return gd;
        });
        bctx.save();
        bctx.globalCompositeOperation = "screen";
        bctx.translate(driftX, driftY);
        bctx.fillStyle = night;
        bctx.fillRect(-driftX, -driftY, w, h);
        bctx.restore();
      }

      // ── dust ─────────────────────────────────────────────────────
      // The wind is only real if something is carried by it.
      {
        const dn = Math.floor(DUST_N * detail.particles);
        const windSpeed = Math.hypot(wind.vx, wind.vy);
        const streak = Math.min(14, windSpeed * 0.045);
        const ux = windSpeed > 1 ? wind.vx / windSpeed : 0;
        const uy = windSpeed > 1 ? wind.vy / windSpeed : 0;
        const dustA = (1 - 0.72 * night) * (1 - 0.6 * lensGrav) * (1 - 0.3 * lensSpectral);
        bctx.save();
        bctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < dn; i++) {
          const ph = dust[i * 3 + 2];
          const p = worldPos(
            dust[i * 3] + Math.sin(t * 0.021 + ph) * 0.012,
            dust[i * 3 + 1] + Math.cos(t * 0.017 + ph * 1.7) * 0.009,
            t,
            false,
          );
          const x = p.x + wind.ox * 1.4;
          const y = p.y + wind.oy * 1.4;
          if (x < -24 || x > w + 24 || y < -24 || y > h + 24) continue;
          const a = (0.045 + 0.05 * (0.5 + 0.5 * Math.sin(t * 0.55 + ph))) * dustA;
          if (a <= 0.004) continue;
          bctx.fillStyle = `rgba(150, 162, 188, ${a.toFixed(3)})`;
          if (streak > 1.5) {
            bctx.fillRect(x - ux * streak, y - uy * streak, 1 + streak * Math.abs(ux), 1 + streak * Math.abs(uy));
          } else {
            bctx.fillRect(x, y, 1.1, 1.1);
          }
        }
        bctx.restore();
      }

      // nebula breath flashes — when a user clicks a nebula, a soft
      // expanding overlay flashes within its hit area. Cheap: one
      // additional radial gradient per active breath, briefly.
      breathsRef.current = breathsRef.current.filter(
        (br) => (nowMs - br.t0) / 1000 < NEBULA_BREATH_DUR,
      );
      if (breathsRef.current.length > 0) {
        const prev = bctx.globalCompositeOperation;
        bctx.globalCompositeOperation = "lighter";
        for (const br of breathsRef.current) {
          const n = NEBULAE[br.idx];
          if (!n) continue;
          const u = (nowMs - br.t0) / 1000 / NEBULA_BREATH_DUR;
          const env = motion ? Math.sin(Math.PI * u) : 0.5;
          if (env <= 0) continue;
          const { x: px, y: py } = worldPos(n.nx, n.ny, t, false);
          const base = Math.min(w, h);
          const r = base * n.rBase * 0.9 * zoom;
          const palette = NEBULA_PALETTE_BY_NAME.get(n.paletteName) ?? NEBULA_PALETTES[0];
          const [pr, pg, pb] = palette.a;
          stamp(bctx, sprite(TAG_BREATH, pr, pg, pb, FALL_BREATH), px, py, r, 0.08 * env);
        }
        bctx.globalCompositeOperation = prev;
      }

      // gravitational-wave ripples — compute geometry + paint the shimmer
      // BEFORE stars, so lensPoint (which reads the cached front) displaces
      // starlight consistently as the wavefront passes.
      drawGravWaves(t, nowMs);

      // ── stars — layered renderer ─────────────────────────────────
      const mwHover = hoveredMilkyWayRef.current;
      const mwPulse = (() => {
        const last = milkyPulseRef.current;
        if (!last) return 0;
        const age = (nowMs - last) / 1000;
        if (age > 1.2) return 0;
        return Math.max(0, 1 - age / 1.2);
      })();

      bctx.save();
      const consumed = consumedSeedRef.current.get(field.id);
      // The field thins on a struggling frame instead of dropping frames:
      // the faintest stars go first, and they are the ones nobody counts.
      const starCut = STARS.length * (detail.particles < 1 ? detail.particles : 1);
      // Which palette the lens is showing. The rung is discrete — the sky is
      // either being looked at or being measured — while the turn itself
      // (the wash burning off, the mass field rising) is continuous.
      const rung = lensRungRef.current;
      for (let i = 0; i < STARS.length; i++) {
        if (i >= starCut) break;
        const s = STARS[i];
        const { x, y } = starPos(i, t);
        // generous off-screen culling — bigger stars have larger
        // glow halos, so widen the cull margin for them.
        const cullM = 8 + s.size * 6;
        if (x < -cullM || x > w + cullM || y < -cullM || y > h + cullM) continue;
        const yBand = 0.5 + (s.nx - 0.5) * 0.35;
        const inBand = Math.abs(s.ny - yBand) < 0.10;

        // twinkle — reduced motion reduces both rate and amplitude
        let alpha = s.brightness;
        if (consumed?.has(i)) alpha *= 0.06;
        if (s.twinkleAmt > 0) {
          const speed = inBand && mwHover ? 4.6 : (motion ? 1.7 : 0.6);
          const amp = motion ? s.twinkleAmt : s.twinkleAmt * 0.3;
          const tw = 0.5 + 0.5 * Math.sin(t * speed + s.twinklePhase);
          alpha = s.brightness * (1 - amp + amp * tw);
        }
        if (inBand && mwPulse > 0) {
          alpha = Math.min(1, alpha + 0.35 * mwPulse);
        }
        // the room stating itself: every star answers at once, softly
        if (tutti > 0) alpha = Math.min(1, alpha + 0.42 * tutti);
        // the knock's bell front sweeping outward through the field
        if (knockAmp > 0) {
          const dk = Math.abs(Math.hypot(x - knock!.x, y - knock!.y) - knockR);
          if (dk < knockBand) {
            alpha = Math.min(1, alpha + 0.55 * knockAmp * (1 - dk / knockBand));
          }
        }
        // the temperature lens reads brightness off the class, not the eye:
        // the hot rare stars blaze and the red dwarfs sink toward ember.
        if (rung === 1) {
          const heat = s.spectral === "O" ? 1 : s.spectral === "B" ? 0.9
            : s.spectral === "A" ? 0.78 : s.spectral === "F" ? 0.62
            : s.spectral === "G" ? 0.5 : s.spectral === "K" ? 0.36 : 0.22;
          alpha *= 0.45 + heat * 1.05;
        }
        alpha *= 1 - 0.5 * night;

        drawStar(
          s,
          x,
          y,
          alpha,
          rung === 1 ? SPECTRAL_TRUE[s.spectral] : rung === 2 ? LENS_GRAV_RGB : undefined,
        );

        if (motion && s.twinkleAmt > 0) {
          const flare = Math.max(
            0,
            (Math.sin(t * (2.2 + s.twinkleAmt * 1.8) + s.twinklePhase * 2.7) - 0.88) / 0.12,
          );
          if (flare > 0 && (i % 3 === 0 || s.size > 1.5)) {
            const [r, g, b] = s.rgb;
            const len = (4 + s.size * 4) * flare;
            bctx.save();
            bctx.globalCompositeOperation = "lighter";
            bctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(0.35 * flare).toFixed(3)})`;
            bctx.lineWidth = 0.8;
            bctx.beginPath();
            bctx.moveTo(x - len, y);
            bctx.lineTo(x + len, y);
            bctx.moveTo(x, y - len);
            bctx.lineTo(x, y + len);
            bctx.stroke();
            bctx.restore();
          }
        }
      }
      // coast born stars that still carry accretion velocity
      if (motion && bornStarsRef.current.some((s) => (s.vx || s.vy))) {
        const dt = 1 / 60;
        bornStarsRef.current = bornStarsRef.current.map((s) => {
          if (!s.vx && !s.vy) return s;
          return {
            ...s,
            nx: clampPan(s.nx + (s.vx ?? 0) * dt),
            ny: clampPan(s.ny + (s.vy ?? 0) * dt),
            vx: (s.vx ?? 0) * 0.985,
            vy: (s.vy ?? 0) * 0.985,
          };
        });
      }
      for (const s of bornStarsRef.current) {
        const { x, y } = bornStarPos(s, t);
        const cullM = 18 + s.size * 8;
        if (x < -cullM || x > w + cullM || y < -cullM || y > h + cullM) continue;
        const bornAge = Math.min(1, (Date.now() - s.createdAt) / 2200);
        const tw = 0.5 + 0.5 * Math.sin(t * (2.4 + s.twinkleAmt) + s.twinklePhase);
        let alpha = s.brightness * (0.34 + bornAge * 0.66) * (1 - s.twinkleAmt * 0.34 + s.twinkleAmt * 0.34 * tw);
        if (tutti > 0) alpha = Math.min(1, alpha + 0.42 * tutti);
        if (knockAmp > 0) {
          const dk = Math.abs(Math.hypot(x - knock!.x, y - knock!.y) - knockR);
          if (dk < knockBand) alpha = Math.min(1, alpha + 0.55 * knockAmp * (1 - dk / knockBand));
        }
        alpha *= 1 - 0.5 * night;
        drawStar(s, x, y, alpha, rung === 2 ? LENS_GRAV_RGB : undefined);
        const [r, g, b] = s.rgb;
        const newborn = 1 - bornAge;
        if (newborn > 0.02) {
          stamp(bctx, sprite(TAG_SOFT, r, g, b, FALL_SOFT), x, y, 34 + s.size * 12, 0.22 * newborn);
        }
      }
      // the forgetting: ghost born stars linger and fade while the sky
      // lets them go — the memory beneath them is already empty.
      const forgetting = forgetRef.current;
      const forgetFade = forgetting
        ? Math.max(0, 1 - (nowMs - forgetting.t0) / forgetting.dur)
        : 0;
      if (forgetting && forgetFade > 0) {
        for (const s of forgetting.stars) {
          const { x, y } = bornStarPos(s, t);
          const cullM = 18 + s.size * 8;
          if (x < -cullM || x > w + cullM || y < -cullM || y > h + cullM) continue;
          drawStar(s, x, y, s.brightness * forgetFade);
        }
      }
      bctx.restore();

      drawStaticBlackHolesActive(t, nowMs);
      drawUserBlackHoles(t, nowMs);
      // the forgetting: kept black holes evaporate — horizons shrink and
      // their light thins until the sky holds only what it was born with.
      if (forgetting && forgetFade > 0) {
        const fBase = Math.min(w, h);
        const fZoom = cameraZoom(t);
        for (const hole of forgetting.holes) {
          // evaporation keeps Hawking's ledger: lifetime goes as mass
          // cubed and temperature as one-over-mass — the small holes go
          // first, and every horizon burns brighter as it shrinks,
          // leaving as a spark instead of a dimming.
          const lifeFrac = Math.max(0.2, Math.pow(hole.mass / 3.6, 3));
          const u = Math.min(1, (nowMs - forgetting.t0) / (forgetting.dur * lifeFrac));
          if (u >= 1) continue;
          const holeFade = 1 - u;
          const { x, y } = userHoleScreen(hole, t, nowMs);
          const horizon =
            fBase * (0.010 + hole.mass * 0.0065) * fZoom * (0.2 + 0.8 * holeFade);
          const lensR = horizon * (18 + hole.mass * 4.5);
          if (x < -lensR || x > w + lensR || y < -lensR || y > h + lensR) continue;
          drawBlackHoleActive({
            x, y, horizon, lensR,
            spin: hole.spin, tilt: 0.28 + hole.mass * 0.045,
            hue: hole.hue, coolHue: (hole.hue + 185) % 360,
            intensity: holeFade * 0.8 + 0.45 * Math.pow(u, 7), mass: hole.mass,
            key: `ghost-${hole.id}`,
            inspiral: 0, lensCopy: false,
          }, t, nowMs);
        }
      }
      drawCosmicEvents(nowMs);
      drawPlanetSystems(t);
      drawUserPlanets(t);
      // the forgetting: condensed worlds thin out with everything else
      if (forgetting && forgetFade > 0 && forgetting.planets.length) {
        drawUserPlanets(t, forgetFade, forgetting.planets);
      }

      // quasars — rare beacons at cluster+ depths
      if (field.quasars.length) {
        bctx.save();
        bctx.globalCompositeOperation = "lighter";
        for (const q of field.quasars) {
          const { x, y } = worldPos(q.nx, q.ny, t, false);
          const pulse = 0.55 + 0.45 * Math.sin(t * 2.4 + q.phase);
          const r = Math.min(w, h) * 0.012 * q.power * (0.8 + pulse * 0.4) * cameraZoom(t);
          const qg = gQuasar(Math.round(q.hue), () => {
            const gd = bctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            gd.addColorStop(0, `hsla(${q.hue}, 90%, 88%, 0.55)`);
            gd.addColorStop(0.35, `hsla(${q.hue}, 70%, 72%, 0.22)`);
            gd.addColorStop(1, `hsla(${q.hue}, 70%, 60%, 0)`);
            return gd;
          });
          bctx.save();
          bctx.translate(x, y);
          bctx.scale(r * 6, r * 6);
          bctx.globalAlpha = Math.min(1, pulse * fade);
          bctx.fillStyle = qg;
          bctx.beginPath();
          bctx.arc(0, 0, 1, 0, Math.PI * 2);
          bctx.fill();
          bctx.restore();
          // jet
          bctx.strokeStyle = `hsla(${q.hue}, 80%, 80%, ${(0.28 * pulse).toFixed(3)})`;
          bctx.lineWidth = 1.2;
          bctx.beginPath();
          bctx.moveTo(x, y - r * 10);
          bctx.lineTo(x, y + r * 10);
          bctx.stroke();
        }
        bctx.restore();
      }

      // ── the gravitational lens (rung 2) ──────────────────────────
      // The map made explicit: a lattice of the sky pushed through the same
      // deflection the starlight already obeys, plus the mass contours of
      // every horizon. Nothing new is simulated — the geometry that was
      // always bending the field is simply drawn.
      if (lensGrav > 0.02) {
        const cols = 15;
        const rows = 11;
        bctx.save();
        bctx.globalCompositeOperation = "lighter";
        bctx.lineWidth = 0.7;
        bctx.strokeStyle = `rgba(126, 152, 220, ${(0.3 * lensGrav).toFixed(3)})`;
        for (let r0 = 0; r0 <= rows; r0++) {
          bctx.beginPath();
          for (let c0 = 0; c0 <= cols * 2; c0++) {
            const p = lensPoint((c0 / (cols * 2)) * w, (r0 / rows) * h, t);
            if (c0 === 0) bctx.moveTo(p.x, p.y);
            else bctx.lineTo(p.x, p.y);
          }
          bctx.stroke();
        }
        for (let c0 = 0; c0 <= cols; c0++) {
          bctx.beginPath();
          for (let r0 = 0; r0 <= rows * 2; r0++) {
            const p = lensPoint((c0 / cols) * w, (r0 / (rows * 2)) * h, t);
            if (r0 === 0) bctx.moveTo(p.x, p.y);
            else bctx.lineTo(p.x, p.y);
          }
          bctx.stroke();
        }
        // mass contours — one ring per e-fold of the potential
        const lBase = Math.min(w, h);
        const lZoom = cameraZoom(t);
        for (const hole of userBlackHolesRef.current) {
          const hp = userHoleScreen(hole, t, nowMs);
          const hr = lBase * (0.01 + hole.mass * 0.0065) * lZoom;
          for (let k = 1; k <= 4; k++) {
            bctx.strokeStyle = `rgba(206, 176, 255, ${(0.24 * lensGrav / k).toFixed(3)})`;
            bctx.beginPath();
            bctx.arc(hp.x, hp.y, hr * Math.pow(2.2, k), 0, Math.PI * 2);
            bctx.stroke();
          }
        }
        bctx.restore();
      }

      const well = gravityWellRef.current;
      // The dwell has not landed yet, but the sky already knows: matter
      // gathers under the finger from the first quarter-second, so the hand
      // learns what holding means without being told a thing.
      if (well.active && well.mode === "gather" && well.gather > 0.01) {
        const gr = 10 + well.gather * 46;
        bctx.save();
        bctx.globalCompositeOperation = "lighter";
        stamp(bctx, sprite(TAG_SOFT, 176, 196, 255, FALL_SOFT), well.x, well.y, gr, 0.3 * well.gather);
        bctx.strokeStyle = `rgba(190, 206, 255, ${(0.34 * well.gather).toFixed(3)})`;
        bctx.lineWidth = 1;
        bctx.beginPath();
        bctx.arc(well.x, well.y, gr * (1.25 - 0.45 * well.gather), 0, Math.PI * 2);
        bctx.stroke();
        // infalling flecks, drawn tighter the longer the hand stays
        for (let i = 0; i < 8; i++) {
          const a = i * 0.785 + t * 1.4;
          const rr = gr * (1.5 - well.gather * 0.9);
          bctx.fillStyle = `rgba(226, 234, 255, ${(0.5 * well.gather).toFixed(3)})`;
          bctx.fillRect(well.x + Math.cos(a) * rr, well.y + Math.sin(a) * rr, 1.6, 1.6);
        }
        bctx.restore();
      }
      // ── glimmer ──────────────────────────────────────────────────
      // After a long silence the sky hints, and only ever physically: a
      // gathering opens and closes where a held finger would open one.
      // No copy, no label, nothing to dismiss.
      if (lastTouchRef.current === 0) lastTouchRef.current = nowMs;
      const idle = nowMs - lastTouchRef.current;
      if (idle > 20000 && !well.active && motion && night < 0.5) {
        const beat = ((idle - 20000) / 5200) % 1;
        const gl = Math.sin(Math.PI * beat);
        if (gl > 0.02) {
          const k = Math.floor((idle - 20000) / 5200);
          const gx = w * (0.2 + hash01(k * 7919 + 3) * 0.6);
          const gy = h * (0.28 + hash01(k * 104729 + 11) * 0.44);
          const gr = 12 + gl * 40;
          bctx.save();
          bctx.globalCompositeOperation = "lighter";
          stamp(bctx, sprite(TAG_SOFT, 176, 196, 255, FALL_SOFT), gx, gy, gr, 0.15 * gl);
          bctx.strokeStyle = `rgba(190, 206, 255, ${(0.15 * gl).toFixed(3)})`;
          bctx.lineWidth = 1;
          bctx.beginPath();
          bctx.arc(gx, gy, gr * (1.4 - 0.5 * gl), 0, Math.PI * 2);
          bctx.stroke();
          bctx.restore();
        }
      }

      // Horizon only after a committed hold — longer hold ⇒ wider event horizon.
      if (well.active && well.mode === "accrete") {
        // The horizon never plateaus: the first seconds open it fast, and
        // past the ceremony tier it keeps widening, slower but without end.
        const grow = 1 - Math.exp(-well.mass / 1.5);
        const deep = Math.max(0, well.mass - 2.2);
        const base = Math.min(w, h);
        const coreR = 8 + grow * 36 + deep * 9;
        const ringR = base * (0.05 + grow * 0.16 + deep * 0.035);
        bctx.save();
        bctx.translate(well.x, well.y);
        bctx.rotate(t * 0.9);
        bctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 3; i++) {
          bctx.strokeStyle = i === 0
            ? `rgba(255, 198, 120, ${(0.40 * grow).toFixed(3)})`
            : `rgba(132, 170, 255, ${(0.18 * grow).toFixed(3)})`;
          bctx.lineWidth = 2.2 - i * 0.5;
          bctx.beginPath();
          bctx.ellipse(0, 0, ringR * (1 + i * 0.26), ringR * (0.26 + i * 0.05), 0, 0, Math.PI * 2);
          bctx.stroke();
        }
        bctx.globalCompositeOperation = "source-over";
        const growQ = Math.round(grow * 16);
        const lens = gWell(growQ, () => {
          const gd = bctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          gd.addColorStop(0, "rgba(0, 0, 0, 0.92)");
          gd.addColorStop(0.32, "rgba(0, 0, 0, 0.62)");
          gd.addColorStop(0.58, `rgba(15, 24, 46, ${(0.26 * (growQ / 16)).toFixed(3)})`);
          gd.addColorStop(1, "rgba(15, 24, 46, 0)");
          return gd;
        });
        bctx.save();
        bctx.scale(ringR * 1.6, ringR * 1.6);
        bctx.fillStyle = lens;
        bctx.beginPath();
        bctx.arc(0, 0, 1, 0, Math.PI * 2);
        bctx.fill();
        bctx.restore();
        bctx.fillStyle = "rgba(0, 0, 0, 0.98)";
        bctx.beginPath();
        bctx.arc(0, 0, coreR, 0, Math.PI * 2);
        bctx.fill();
        bctx.restore();

        if (grow > 0.12 && sparksRef.current.length < 18 && Math.floor(nowMs / 140) % 2 === 0) {
          sparksRef.current = [
            ...sparksRef.current.slice(-14),
            {
              x: well.x + (Math.random() - 0.5) * ringR * 1.4,
              y: well.y + (Math.random() - 0.5) * ringR * 0.55,
              t0: nowMs,
            },
          ];
        }
      }

      // ── FOREGROUND: constellations ───────────────────────────────
      fctx.clearRect(0, 0, w, h);

      // saved constellations
      const hovered = hoveredSavedRef.current;
      const fraying = frayRef.current;
      for (const c of savedRef.current) {
        const isHover = hovered === c.id;
        // A ceremony hold on a kept shape unbinds it — and the unbinding is
        // visible the whole time it is happening. The lines go slack and
        // fray toward the release; let go early and they snap back.
        const fray = fraying && fraying.id === c.id
          ? Math.min(1, (nowMs - fraying.t0) / 2500)
          : 0;
        const slack = fray > 0 ? fray * fray * 16 : 0;
        const lineAlpha = (isHover ? 0.55 : 0.28) * (1 - fray * 0.75);
        fctx.strokeStyle = `rgba(232, 226, 213, ${lineAlpha.toFixed(3)})`;
        fctx.lineWidth = isHover ? 1.2 : 0.9;
        fctx.beginPath();
        let lastValid: { x: number; y: number } | null = null;
        for (let i = 0; i < c.starIndices.length; i++) {
          const idx = c.starIndices[i];
          if (idx < 0 || idx >= activeFieldRef.current.stars.length) continue;
          const p = starPos(idx, t);
          const jx = slack > 0 ? (hash01(idx * 7919 + i) - 0.5) * slack : 0;
          const jy = slack > 0 ? (hash01(idx * 104729 + i) - 0.5) * slack : 0;
          if (i === 0 || !lastValid) {
            fctx.moveTo(p.x + jx, p.y + jy);
          } else {
            fctx.lineTo(p.x + jx, p.y + jy);
          }
          lastValid = p;
        }
        fctx.stroke();

        // small open circles around each named star
        for (const idx of c.starIndices) {
          if (idx < 0 || idx >= activeFieldRef.current.stars.length) continue;
          const p = starPos(idx, t);
          fctx.strokeStyle = `rgba(232, 226, 213, ${((isHover ? 0.65 : 0.35) * (1 - fray * 0.7)).toFixed(3)})`;
          fctx.lineWidth = 0.9;
          fctx.beginPath();
          fctx.arc(p.x, p.y, 4.5 + fray * 5, 0, Math.PI * 2);
          fctx.stroke();
        }

        // name beside the centroid
        if (c.starIndices.length) {
          let sx = 0;
          let sy = 0;
          let n = 0;
          for (const idx of c.starIndices) {
            if (idx < 0 || idx >= activeFieldRef.current.stars.length) continue;
            const p = starPos(idx, t);
            sx += p.x;
            sy += p.y;
            n++;
          }
          if (n > 0) {
            const cx = sx / n;
            const cy = sy / n;
            fctx.fillStyle = `rgba(232, 226, 213, ${isHover ? 0.78 : 0.42})`;
            fctx.font = "italic 14px var(--font-serif), serif";
            fctx.textAlign = "left";
            fctx.textBaseline = "middle";
            fctx.fillText(c.name, cx + 14, cy);
          }
        }
      }

      // ── transient sparks (wishes) ────────────────────────────────
      if (sparksRef.current.length > 0) {
        sparksRef.current = sparksRef.current.filter(
          (sp) => (nowMs - sp.t0) / 1000 < SPARK_LIFE,
        );
        for (const sp of sparksRef.current) {
          const u = (nowMs - sp.t0) / 1000 / SPARK_LIFE; // 0..1
          const a = 1 - u;
          const rad = 2 + u * 14;
          stamp(fctx, sprite(TAG_SPARK, 255, 230, 170, FALL_SPARK), sp.x, sp.y, rad + 6, 0.55 * a);
          fctx.fillStyle = `rgba(255, 240, 200, ${0.95 * a})`;
          fctx.beginPath();
          fctx.arc(sp.x, sp.y, 1.6, 0, Math.PI * 2);
          fctx.fill();
        }
      }

      // pending selection — brighter, in-progress
      const pend = pendingRef.current;
      if (pend.length > 0) {
        fctx.strokeStyle = "rgba(244, 238, 222, 0.65)";
        fctx.lineWidth = 1.1;
        fctx.beginPath();
        for (let i = 0; i < pend.length; i++) {
          const p = starPos(pend[i], t);
          if (i === 0) fctx.moveTo(p.x, p.y);
          else fctx.lineTo(p.x, p.y);
        }
        fctx.stroke();

        for (let i = 0; i < pend.length; i++) {
          const idx = pend[i];
          const p = starPos(idx, t);
          const pulse = motion ? 0.55 + 0.45 * Math.sin(t * 2.8 + i * 0.5) : 0.7;
          stamp(fctx, sprite(TAG_SPARK, 255, 230, 170, FALL_SPARK), p.x, p.y, 18, 0.32 * pulse);
          fctx.fillStyle = "rgba(255, 240, 200, 0.95)";
          fctx.beginPath();
          fctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
          fctx.fill();
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ── hit-testing: which star is under (x,y)? ────────────────────────
  // touch-friendly hit radius
  const HIT_R = 15;

  const findStarAt = useCallback((cx: number, cy: number): number => {
    const fn = starPosRef.current;
    if (!fn) return -1;
    const t = performance.now() / 1000;
    let best = -1;
    let bestD = HIT_R * HIT_R;
    const STARS = activeFieldRef.current.stars;
    for (let i = 0; i < STARS.length; i++) {
      const p = fn(i, t);
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    }
    return best;
  }, []);

  // hit-test for a nebula. Approximate: each nebula is checked against
  // its anchor center using its base radius. Static-painting means
  // nebulae no longer drift across the viewport — they sit where the
  // offscreen canvas put them.
  const findNebulaAt = useCallback((cx: number, cy: number): number => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const base = Math.min(w, h);
    const zoom = cameraRef.current.zoom;
    let best = -1;
    let bestD2 = Infinity;
    const NEBULAE = activeFieldRef.current.nebulae;
    for (let i = 0; i < NEBULAE.length; i++) {
      const n = NEBULAE[i];
      const p = skyToScreen(cameraRef.current, n.nx, n.ny, w, h, 0);
      const px = p.x;
      const py = p.y;
      const r = base * n.rBase * zoom;
      const dx = cx - px;
      const dy = cy - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < (r * 0.5) ** 2 && d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }, []);

  // hit-test for the Milky Way diagonal band. Inverse-rotate the click into
  // the band's local frame and check |y| against the band thickness.
  const isInMilkyWay = useCallback((cx: number, cy: number): boolean => {
    const layer = activeLayerRef.current;
    if (layer !== "galactic" && layer !== "cluster") return false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const base = Math.min(w, h);
    const sky = camScreenToSky(cameraRef.current, cx, cy, w, h);
    // band in normalized sky space around diagonal
    const yCenter = 0.5 + (sky.nx - 0.5) * 0.35;
    return Math.abs(sky.ny - yCenter) < MW_BAND_HALF_THICKNESS * (base / Math.min(w, h)) * 1.2;
  }, []);

  // hit-test for a saved constellation NAME (centroid label).
  const findSavedNameAt = useCallback((cx: number, cy: number): string | null => {
    const fn = starPosRef.current;
    if (!fn) return null;
    const t = performance.now() / 1000;
    for (const c of savedRef.current) {
      if (!c.starIndices.length) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const idx of c.starIndices) {
        if (idx < 0 || idx >= activeFieldRef.current.stars.length) continue;
        const p = fn(idx, t);
        sx += p.x;
        sy += p.y;
        n++;
      }
      if (n === 0) continue;
      const ccx = sx / n + 14;
      const ccy = sy / n;
      const labelW = Math.max(60, c.name.length * 9);
      if (cx >= ccx - 4 && cx <= ccx + labelW + 8 && Math.abs(cy - ccy) < 14) {
        return c.id;
      }
    }
    return null;
  }, []);

  // hit-test for hovering a saved constellation (by checking line proximity)
  const findSavedAt = useCallback((cx: number, cy: number): string | null => {
    const fn = starPosRef.current;
    if (!fn) return null;
    const t = performance.now() / 1000;
    const THRESH = 8;
    for (const c of savedRef.current) {
      for (const idx of c.starIndices) {
        if (idx < 0 || idx >= activeFieldRef.current.stars.length) continue;
        const p = fn(idx, t);
        const dx = p.x - cx;
        const dy = p.y - cy;
        if (dx * dx + dy * dy < (HIT_R * 0.8) ** 2) return c.id;
      }
      for (let i = 0; i + 1 < c.starIndices.length; i++) {
        const a = fn(c.starIndices[i], t);
        const b = fn(c.starIndices[i + 1], t);
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const len2 = vx * vx + vy * vy;
        if (len2 < 1) continue;
        const u = Math.max(0, Math.min(1, ((cx - a.x) * vx + (cy - a.y) * vy) / len2));
        const px = a.x + u * vx;
        const py = a.y + u * vy;
        const dx = cx - px;
        const dy = cy - py;
        if (dx * dx + dy * dy < THRESH * THRESH) return c.id;
      }
    }
    return null;
  }, []);

  // ── the grammar ────────────────────────────────────────────────────
  // Everything below is a meaning bound to a verb from
  // docs/gesture-grammar.md through `attachGestures`. This room owns only
  // what each verb means in starlight; the thresholds that decide when a
  // press becomes a dwell, or when two fingers become a pinch, live in
  // lib/gesture/core.ts and nowhere else. The old machine here — hand-rolled
  // pinch math, pixel-counted tap-vs-drag, two nested hold timers, manual
  // pointer capture, a private wheel listener — is gone.

  /** One finger's path, kept only so a closed loop can gather a shape. */
  const pathRef = useRef<number[]>([]);
  const frayTierRef = useRef(0);
  const wellTierRef = useRef(0);
  const wellToneRef = useRef(0);
  const seasonVoiceRef = useRef(0);
  const windVoiceRef = useRef(0);

  const openNaming = useCallback((x: number, y: number) => {
    const ww = window.innerWidth;
    const mobile = ww < 700;
    setNamePos({
      x: mobile ? ww / 2 : Math.max(20, Math.min(ww - 280, x + 24)),
      y: mobile ? 110 : Math.max(20, Math.min(window.innerHeight - 80, y + 24)),
    });
    setNaming(true);
  }, []);

  /** Add a star to the shape being drawn. */
  const extendShape = useCallback((idx: number, x: number, y: number) => {
    const cur = pendingRef.current;
    if (cur.length > 0 && cur[cur.length - 1] === idx) return;
    const next = [...cur, idx];
    pendingRef.current = next;
    setPending(next);
    lastClickPos.current = { x, y };
    haptics.ripple(0.34 + Math.min(0.34, cur.length * 0.08));
    markSky(`${next.length} stars chosen`, "star", 0.42, "object", `select-${next.length}`);
    try { getFieldAudio().chime(); } catch { /* noop */ }
  }, [markSky]);

  /**
   * A finger circling the sky gathers what it enclosed. This is the touch
   * path to a constellation — no modifier key, no menu: draw the shape you
   * mean and the stars inside it bind, then ask to be named.
   */
  const gatherShapeIn = useCallback((cx: number, cy: number, radius: number) => {
    const fn = starPosRef.current;
    if (!fn) return;
    const tt = performance.now() / 1000;
    const stars = activeFieldRef.current.stars;
    const found: Array<{ idx: number; ang: number }> = [];
    for (let i = 0; i < stars.length; i++) {
      const p = fn(i, tt);
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (stars[i].size < 0.9 && stars[i].brightness < 0.6) continue;
      found.push({ idx: i, ang: Math.atan2(dy, dx) });
    }
    if (found.length < 3) return;
    found.sort((a, b) => a.ang - b.ang);
    const picked = found.slice(0, 12).map((f) => f.idx);
    pendingRef.current = picked;
    setPending(picked);
    lastClickPos.current = { x: cx, y: cy };
    haptics.roll();
    try { getFieldAudio().bell(); } catch { /* noop */ }
    markSky(`${picked.length} stars gathered`, "star", 0.6, "object", "gather");
    openNaming(cx, cy);
  }, [markSky, openNaming]);

  /** Raise or lower the lens. Discrete rungs; the turn between them is not. */
  const setLensRungTo = useCallback((n: number) => {
    const next = Math.max(0, Math.min(LENS_RUNGS - 1, Math.round(n)));
    lensSnapRef.current = next;
    lensRef.current = Math.max(0, Math.min(LENS_RUNGS - 1, lensRef.current));
    if (next === lensRungRef.current) return;
    lensRungRef.current = next;
    setLensRung(next);
    haptics.lens();
    try { getFieldAudio().playTone(180 + next * 150, 0.26); } catch { /* noop */ }
    markSky(
      next === 0 ? "visible sky" : next === 1 ? "by temperature" : "by curvature",
      next === 2 ? "gravity" : "nebula",
      0.4,
      "region",
      `lens-${next}`,
      false,
    );
  }, [markSky]);

  /** Two-finger tap: the frame retreats one step, lens first. */
  const stepBack = useCallback(() => {
    if (lensRungRef.current > 0) {
      setLensRungTo(lensRungRef.current - 1);
      return;
    }
    zoomOut();
  }, [setLensRungTo, zoomOut]);

  /**
   * Three-finger tap: every living thing in the sky answers at once. A
   * steady tap-tempo hands in its own beat, and the sweep walks that beat
   * instead of the house cadence — the sky answering ON the pulse.
   */
  const tuttiNow = useCallback((beatMs = 110) => {
    tuttiRef.current = performance.now();
    const nebulae = activeFieldRef.current.nebulae;
    const now = performance.now();
    breathsRef.current = nebulae.map((_, i) => ({ idx: i, t0: now }));
    haptics.roll();
    try {
      const audio = getFieldAudio();
      audio.playNote(33, 900);
      window.setTimeout(() => { try { audio.playNote(45, 700); } catch { /* noop */ } }, beatMs);
      window.setTimeout(() => { try { audio.playNote(52, 600); } catch { /* noop */ } }, beatMs * 2);
    } catch { /* noop */ }
    markSky("the whole sky answers", "star", 0.66, "region", "tutti", false);
  }, [markSky]);

  /** One finger on the material. Intensity is how hard the sky was struck. */
  const singleTapAt = useCallback((x: number, y: number, intensity: number) => {
    const idx = findStarAt(x, y);
    const shape = pendingRef.current;

    // desktop dialect of the same verb — shift keeps the shape open
    if (shiftRef.current && idx >= 0) {
      extendShape(idx, x, y);
      return;
    }
    // a shape already being drawn: stars join it, and touching the star it
    // began from closes the loop and asks for a name
    if (shape.length > 0 && idx >= 0) {
      if (shape.length >= 3 && idx === shape[0]) {
        openNaming(x, y);
        return;
      }
      extendShape(idx, x, y);
      return;
    }
    if (shape.length > 0) cancelPending();

    // a star you made answers rather than crowding another on top
    const bs = findBornStarAt(x, y);
    if (bs) {
      answerBornStar(bs, x, y);
      return;
    }
    if (idx >= 0) {
      const star = activeFieldRef.current.stars[idx];
      // how hard the tap landed decides what the star can be made to do: a
      // firm strike will tip a marginal star over into collapse
      const push = 0.62 + intensity * 0.76;
      if (star && (star.size * push > 1.55 || star.brightness * push > 0.78)) {
        const p = starPosRef.current?.(idx, performance.now() / 1000) ?? { x, y };
        supernovaAt(p.x, p.y, star.rgb);
      } else {
        birthStarAt(x, y, intensity);
      }
      return;
    }
    const nebIdx = findNebulaAt(x, y);
    if (nebIdx >= 0) {
      breathsRef.current = [
        ...breathsRef.current.filter((b) => b.idx !== nebIdx),
        { idx: nebIdx, t0: performance.now() },
      ];
      spawnStarForm(x, y);
      haptics.roll();
      markSky("nebula birthlight", "nebula", 0.62, "sigil", "nebula");
      try { getFieldAudio().bell(); } catch { /* noop */ }
      return;
    }
    if (isInMilkyWay(x, y)) {
      milkyPulseRef.current = performance.now();
      birthStarAt(x, y, intensity);
      haptics.roll();
      markSky("milky way brightened", "nebula", 0.62, "region", "milky-way");
      try { getFieldAudio().bell(); } catch { /* noop */ }
      return;
    }
    birthStarAt(x, y, intensity);
  }, [
    answerBornStar, birthStarAt, cancelPending, extendShape, findBornStarAt, findNebulaAt,
    findStarAt, isInMilkyWay, markSky, openNaming, spawnStarForm, supernovaAt,
  ]);

  const doubleTapAt = useCallback((x: number, y: number) => {
    const id = findSavedNameAt(x, y);
    if (id) {
      const c = savedRef.current.find((cc) => cc.id === id);
      if (!c) return;
      setNameValue(c.name);
      setEditingId(id);
      openNaming(x, y);
      haptics.tap();
      markSky("rename constellation", "kept", 0.38, "object", "rename-open");
      return;
    }
    // a world condenses out of the disk of a star you made
    const bs = findBornStarAt(x, y);
    if (bs) {
      condensePlanetAt(bs, x, y);
      return;
    }
    // open sky: the next weather in the cycle, summoned by hand
    const summoners = [spawnComet, spawnPulsar, spawnNova, spawnTidalFlare, spawnStarForm, spawnGrb];
    const pick = summoners[summonRef.current % summoners.length];
    summonRef.current += 1;
    pick(x, y);
  }, [
    condensePlanetAt, findBornStarAt, findSavedNameAt, markSky, openNaming,
    spawnComet, spawnGrb, spawnNova, spawnPulsar, spawnStarForm, spawnTidalFlare,
  ]);

  /**
   * Rapid-tap ladder beyond a single birth: nova → rarer weather → rarest.
   * Returns true when an object-specific double-tap meaning claimed the train.
   */
  const trainTapAt = useCallback((
    x: number,
    y: number,
    tier: 3 | 5 | "n",
    depth: number,
    intensity: number,
  ): boolean => {
    const id = findSavedNameAt(x, y);
    if (id) {
      doubleTapAt(x, y);
      return true;
    }
    const bs = findBornStarAt(x, y);
    if (bs) {
      doubleTapAt(x, y);
      return true;
    }
    void intensity;
    if (tier === 3) {
      spawnNova(x, y);
      if (depth > 0.45) spawnComet(x + 12, y - 8);
      return true;
    }
    if (tier === 5) {
      spawnPulsar(x, y);
      if (depth > 0.55) spawnTidalFlare(x - 10, y + 6);
      return true;
    }
    spawnGrb(x, y);
    if (depth > 0.7) spawnNova(x + 18, y + 10);
    return true;
  }, [
    doubleTapAt, findBornStarAt, findSavedNameAt,
    spawnComet, spawnGrb, spawnNova, spawnPulsar, spawnTidalFlare,
  ]);

  /** Throttle: one comet per patter, not one per hit. */
  const drumCometAtRef = useRef(0);

  /**
   * Drumming plays the space between the hands: each hit rings at its own
   * height and rolls a ring out from under it, and a steady alternation
   * sends a comet streaking from one hand to the other.
   */
  const drumAt = useCallback((e: {
    hits: number;
    alternation: number;
    x: number;
    y: number;
    ax: number;
    ay: number;
    bx: number;
    by: number;
  }) => {
    const wh = window.innerHeight || 1;
    haptics.tap();
    knockRef.current = { t0: performance.now(), x: e.x, y: e.y };
    try { getFieldAudio().playTone(170 + (1 - e.y / wh) * 250, 0.09); } catch { /* noop */ }
    const now = performance.now();
    if (e.hits >= 5 && e.alternation > 0.8 && now - drumCometAtRef.current > 1500) {
      drumCometAtRef.current = now;
      const ang = Math.atan2(e.by - e.ay, e.bx - e.ax);
      const reach = Math.hypot(e.bx - e.ax, e.by - e.ay) * 1.6;
      addCosmicEvent({
        kind: "comet", x: e.ax, y: e.ay, life: 4.4,
        seed: Math.floor(now % 0xffffffff), rgb: [198, 228, 255], power: 0.85, ang, reach,
      });
      haptics.ripple(0.4);
      markSky("a comet crosses between the hands", "comet", 0.5, "object", "drum-comet");
      try { getFieldAudio().spark(); } catch { /* noop */ }
    }
  }, [addCosmicEvent, markSky]);

  /** Span voice cadence — a sustain hums, it does not rattle. */
  const spanVoiceAtRef = useRef(0);

  /**
   * Two still fingers hold an interval open: the sky sustains the dyad —
   * each fingertip's height is a voice, the ring under the midpoint pulses
   * for as long as the interval stands, and the weather warms where it was
   * held. Duration is an axis: the tones lengthen the longer it is kept.
   */
  const spanAt = useCallback((e: {
    phase: "enter" | "tick" | "release";
    spread: number;
    elapsed: number;
    cx: number;
    cy: number;
    ax: number;
    ay: number;
    bx: number;
    by: number;
  }) => {
    if (e.phase === "release") {
      if (e.elapsed > 900) { try { getFieldAudio().chime(); } catch { /* noop */ } }
      return;
    }
    const now = performance.now();
    if (e.phase === "enter") {
      haptics.ripple(0.25);
      markSky("an interval held open", "star", 0.4, "region", "span", false);
    } else if (now - spanVoiceAtRef.current < 680) {
      return;
    }
    spanVoiceAtRef.current = now;
    knockRef.current = { t0: now, x: e.cx, y: e.cy };
    const wh = window.innerHeight || 1;
    const dur = 0.3 + Math.min(1.4, e.elapsed / 2200);
    try {
      const audio = getFieldAudio();
      audio.playTone(150 + (1 - e.ay / wh) * 260, dur);
      audio.playTone(150 + (1 - e.by / wh) * 260, dur);
    } catch { /* noop */ }
    const mid = screenToSky(e.cx, e.cy);
    heatSky(mid.nx, mid.ny, 0.08 + Math.min(0.2, e.elapsed / 12000));
    if (e.phase === "tick") haptics.ripple(0.12 + Math.min(0.2, e.elapsed / 9000));
  }, [heatSky, markSky, screenToSky]);

  /** The hold, in one place: gather → horizon, or a kept shape coming undone. */
  const onHoldEvent = useCallback((e: {
    fingers: number;
    phase: "enter" | "tick" | "release";
    elapsed: number;
    tier: number;
    intensity: number;
    x: number;
    y: number;
  }) => {
    if (namingRef.current) return;
    lastTouchRef.current = performance.now();

    // three fingers rest on the law: the sky's clock stretches, and keeps
    // stretching for as long as they stay
    if (e.fingers === 3) {
      if (e.phase === "release") {
        timeScaleTargetRef.current = 1;
        try { getFieldAudio().spark(); } catch { /* noop */ }
        return;
      }
      if (e.phase === "enter") {
        haptics.detent();
        try { getFieldAudio().playNote(28, 900); } catch { /* noop */ }
        markSky("time thickens", "gravity", 0.4, "region", "dilation", false);
      }
      timeScaleTargetRef.current = Math.max(0.05, 1 - Math.min(0.95, e.elapsed / 3600));
      return;
    }
    if (e.fingers !== 1) {
      // two fingers address the frame, not the material — the well lets go
      if (gravityWellRef.current.active || frayRef.current) abortWell();
      return;
    }

    const well = gravityWellRef.current;

    if (e.phase === "enter" && !well.active && !frayRef.current) {
      // what lies under the hand decides what holding means
      const savedId = findSavedAt(e.x, e.y);
      if (savedId) {
        frayTierRef.current = 1;
        frayRef.current = { id: savedId, t0: performance.now() - e.elapsed };
        haptics.tap();
        try { getFieldAudio().buzz(); } catch { /* noop */ }
        return;
      }
      pointerIntentRef.current = { x: e.x, y: e.y };
      well.active = true;
      well.x = e.x;
      well.y = e.y;
      well.t0 = performance.now() - e.elapsed;
      well.mass = 0;
      well.gather = 0;
      well.mode = "gather";
      wellToneRef.current = 0;
      wellTierRef.current = 1;
      // the vessel is invited from inside a real gesture, never demanded
      void requestVessel();
      return;
    }

    const fray = frayRef.current;
    if (fray) {
      if (e.phase === "release") {
        // let go before the ceremony completes and the lines snap back
        frayRef.current = null;
        haptics.tap();
        try { getFieldAudio().chime(); } catch { /* noop */ }
        return;
      }
      if (e.tier >= 3) {
        frayRef.current = null;
        deleteSaved(fray.id);
        return;
      }
      if (e.tier > frayTierRef.current) {
        frayTierRef.current = e.tier;
        haptics.detent();
        try { getFieldAudio().playTone(150, 0.3); } catch { /* noop */ }
      }
      return;
    }

    if (!well.active) return;

    if (e.phase === "release") {
      const intent = pointerIntentRef.current;
      const moved = intent ? Math.hypot(e.x - intent.x, e.y - intent.y) : 0;
      if (well.mode === "accrete") {
        releaseAccretion(well.x, well.y, e.elapsed, well.mass);
      } else if (moved <= THRESHOLDS.moveTolPx) {
        // a slow touch is still a touch — the sky answers it as a tap
        singleTapAt(well.x, well.y, e.intensity);
      }
      abortWell();
      return;
    }

    well.x = e.x;
    well.y = e.y;

    if (e.tier < 2) {
      // legible before it is committed: matter visibly collecting under
      // the finger from the moment the touch tier is crossed
      well.mode = "gather";
      well.gather = Math.max(0, Math.min(1, (e.elapsed - THRESHOLDS.tapMaxMs) / (THRESHOLDS.dwellMs - THRESHOLDS.tapMaxMs)));
      return;
    }

    if (well.mode !== "accrete") {
      well.mode = "accrete";
      well.gather = 1;
      haptics.roll();
      markSky("horizon opening", "gravity", 0.42, "sigil", "accrete-start", false);
    }

    // Continuous, never a switch: the horizon keeps swelling for as long as
    // the hand stays — through the ceremony tier and past it.
    const held = (e.elapsed - THRESHOLDS.dwellMs) / 1000;
    well.mass = Math.max(0, held) * WELL_MASS_PER_SEC * (0.62 + e.intensity * 0.9);

    // the ceremony tier is a threshold, not a ceiling: it is marked, and
    // then the horizon goes on opening
    const nowMs = performance.now();
    if (e.tier > wellTierRef.current) {
      wellTierRef.current = e.tier;
      if (e.tier >= 3) {
        haptics.detent();
        markSky("the horizon deepens", "gravity", 0.7, "sigil", "accrete-deep", false);
      }
    }

    // the deepening voice: the tone falls as the horizon widens
    if (nowMs - wellToneRef.current > 620) {
      wellToneRef.current = nowMs;
      try { getFieldAudio().playTone(196 / (0.8 + well.mass * 0.55), 0.22); } catch { /* noop */ }
      haptics.ripple(0.18 + Math.min(0.5, well.mass * 0.16));
    }

    // matter falls toward the well while it grows
    const sky = screenToSky(e.x, e.y);
    const pull = 0.0009 * (0.4 + well.mass);
    let changed = false;
    const next = bornStarsRef.current.map((s) => {
      const dx = sky.nx - s.nx;
      const dy = sky.ny - s.ny;
      const d2 = dx * dx + dy * dy + 0.0002;
      if (d2 > 0.08) return s;
      changed = true;
      return {
        ...s,
        nx: clampPan(s.nx + (dx / Math.sqrt(d2)) * pull),
        ny: clampPan(s.ny + (dy / Math.sqrt(d2)) * pull),
        vx: (s.vx ?? 0) + dx * pull * 8,
        vy: (s.vy ?? 0) + dy * pull * 8,
      };
    });
    if (changed) {
      bornStarsRef.current = next;
      setBornStars(next);
    }
  }, [abortWell, deleteSaved, findSavedAt, markSky, releaseAccretion, screenToSky, singleTapAt]);

  // The bindings change every render (they close over fresh state), but the
  // engine attaches once. One ref carries the current table across.
  const bindingsRef = useRef({
    singleTapAt, doubleTapAt, trainTapAt, onHoldEvent, stepBack, tuttiNow, setLensRungTo,
    gatherShapeIn, applyCamera, reportScaleEdge, releaseScaleEdge, abortWell, markSky,
    drumAt, spanAt,
  });
  bindingsRef.current = {
    singleTapAt, doubleTapAt, trainTapAt, onHoldEvent, stepBack, tuttiNow, setLensRungTo,
    gatherShapeIn, applyCamera, reportScaleEdge, releaseScaleEdge, abortWell, markSky,
    drumAt, spanAt,
  };

  useEffect(() => {
    const el = fgRef.current;
    if (!el) return;
    const touched = () => { lastTouchRef.current = performance.now(); };

    return attachGestures(el, {
      tap: (e) => {
        touched();
        if (namingRef.current) return;
        if (e.fingers === 2) {
          bindingsRef.current.stepBack();
          return;
        }
        if (e.fingers === 3) {
          bindingsRef.current.tuttiNow();
          return;
        }
        if (e.fingers !== 1) return;
        void requestVessel();
        // rapid-tap ladder: birth → nova → rarer weather → rarest burst
        const tier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (tier === 1) {
          bindingsRef.current.singleTapAt(e.x, e.y, e.intensity * (1 + depth * 0.35));
          return;
        }
        bindingsRef.current.trainTapAt(e.x, e.y, tier, depth, e.intensity);
      },

      hold: (e) => {
        // Dispatched whole so a hold never tears mid-gesture; the grammar's
        // rungs are all onHoldEvent's — three fingers stretch the sky's
        // clock, the touch tier gathers matter under the finger, and the
        // ceremony tier is the horizon deepening or a kept shape fraying
        // away. The branches name the rungs where the law can read them.
        if (e.fingers === 3) {
          bindingsRef.current.onHoldEvent(e);
          return;
        }
        if (e.tier >= 3) {
          bindingsRef.current.onHoldEvent(e);
          return;
        }
        if (e.tier >= 1) {
          bindingsRef.current.onHoldEvent(e);
          return;
        }
        bindingsRef.current.onHoldEvent(e);
      },

      drag: (e) => {
        touched();
        if (namingRef.current) return;
        // three fingers on the law: interstellar wind, combing the gas off
        // the star field and dragging the dust with it
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          const wind = windRef.current;
          wind.vx = Math.max(-900, Math.min(900, wind.vx + e.dx * 7));
          wind.vy = Math.max(-900, Math.min(900, wind.vy + e.dy * 7));
          const now = performance.now();
          if (now - windVoiceRef.current > 240) {
            windVoiceRef.current = now;
            const speed = Math.min(1, Math.hypot(wind.vx, wind.vy) / 700);
            haptics.ripple(0.2 + speed * 0.4);
            try { getFieldAudio().playTone(90 + speed * 220, 0.18); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          bindingsRef.current.abortWell();
          pathRef.current.length = 0;
        }
        if (e.phase === "end") return;
        const path = pathRef.current;
        path.push(e.x, e.y);
        if (path.length > 480) path.splice(0, 2);
        bindingsRef.current.applyCamera(
          panByScreen(cameraRef.current, e.dx, e.dy, window.innerWidth || 1, window.innerHeight || 1),
        );
      },

      // a closed loop, drawn deliberately: the stars inside it bind
      scrub: (e) => {
        if (namingRef.current) return;
        if (Math.abs(e.winding) < 1.2) return;
        const path = pathRef.current;
        if (path.length < 24) return;
        let cx = 0;
        let cy = 0;
        const n = path.length / 2;
        for (let i = 0; i < path.length; i += 2) {
          cx += path[i];
          cy += path[i + 1];
        }
        cx /= n;
        cy /= n;
        let rr = 0;
        for (let i = 0; i < path.length; i += 2) rr += Math.hypot(path[i] - cx, path[i + 1] - cy);
        rr = (rr / n) * 1.12;
        path.length = 0;
        bindingsRef.current.gatherShapeIn(cx, cy, rr);
      },

      pinch: (e) => {
        touched();
        if (namingRef.current) return;
        bindingsRef.current.abortWell();
        if (e.phase === "end") {
          bindingsRef.current.releaseScaleEdge();
          return;
        }
        if (e.phase === "start") return;
        const ww = window.innerWidth || 1;
        const wh = window.innerHeight || 1;
        const z0 = cameraRef.current.zoom;
        bindingsRef.current.applyCamera(
          zoomAtScreen(cameraRef.current, e.cx, e.cy, z0 * e.scale, ww, wh),
          true,
        );
        // Whatever the band walls swallowed is what the hand is still
        // saying: the residual ln-ratio belongs to the manifold.
        const attempted = Math.log(Math.max(1e-9, e.scale));
        const achieved = Math.log(Math.max(1e-9, cameraRef.current.zoom / Math.max(1e-9, z0)));
        const rate = Math.abs(attempted) > 1e-9 ? e.velocity / attempted : 0;
        bindingsRef.current.reportScaleEdge(cameraRef.current.zoom, (attempted - achieved) * rate);
      },

      pan2: (e) => {
        touched();
        if (namingRef.current || e.phase !== "move") return;
        bindingsRef.current.applyCamera(
          panByScreen(cameraRef.current, e.dx, e.dy, window.innerWidth || 1, window.innerHeight || 1),
        );
      },

      twist: (e) => {
        touched();
        if (namingRef.current) return;
        if (e.fingers === 3) {
          // three fingers turn the season: the sky precesses, walking the
          // constellations through the year
          if (e.phase !== "move") return;
          seasonRef.current += e.angle * 0.85;
          const now = performance.now();
          if (now - seasonVoiceRef.current > 260) {
            seasonVoiceRef.current = now;
            haptics.tap();
            try {
              getFieldAudio().playTone(
                220 + ((seasonRef.current % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * 40,
                0.16,
              );
            } catch { /* noop */ }
          }
          return;
        }
        if (e.phase === "start") return;
        if (e.phase === "end") {
          bindingsRef.current.setLensRungTo(lensRef.current);
          return;
        }
        const next = Math.max(0, Math.min(LENS_RUNGS - 1, lensRef.current + e.angle / 1.5));
        lensRef.current = next;
        lensSnapRef.current = next;
      },

      // a steady pulse and the whole sky answers ON the beat: the tutti's
      // sweep is spaced to the hand's own tempo, not the house cadence
      rhythm: (e) => {
        if (namingRef.current) return;
        if (e.stability > 0.66) {
          bindingsRef.current.tuttiNow(Math.max(90, Math.min(700, 60000 / e.bpm)));
        }
      },

      // drumming plays the space between the hands: rings under each hit,
      // and a steady patter sends a comet from one hand to the other
      drum: (e) => {
        touched();
        if (namingRef.current) return;
        bindingsRef.current.drumAt(e);
      },

      // two still fingers hold an interval open, and the sky sustains it
      span: (e) => {
        touched();
        if (namingRef.current) return;
        bindingsRef.current.spanAt(e);
      },
    });
  }, []);

  /**
   * Hover — the desktop dialect of a light touch (grammar §1), and the one
   * channel the semantic engine deliberately does not model, because a
   * mouse resting on the sky is not a gesture. Mouse only; a finger never
   * generates it.
   */
  useEffect(() => {
    const el = fgRef.current;
    if (!el) return;
    let last = 0;
    const onHover = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse" || ev.buttons !== 0) return;
      const now = performance.now();
      if (now - last < 60) return;
      last = now;
      setHoveredSaved(findSavedAt(ev.clientX, ev.clientY));
      setHoveredNebula(findNebulaAt(ev.clientX, ev.clientY));
      setHoveredMilkyWay(isInMilkyWay(ev.clientX, ev.clientY));
    };
    el.addEventListener("pointermove", onHover);
    return () => el.removeEventListener("pointermove", onHover);
  }, [findNebulaAt, findSavedAt, isInMilkyWay]);

  // ── the vessel ─────────────────────────────────────────────────────
  // The device's own body: gravity leans the dome, a shake unbinds the
  // dust, a knock on the case rings the field, face-down is night.
  useEffect(() => {
    const reduce = typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduce) return;
        const lean = leanRef.current;
        const gx = Math.max(-1, Math.min(1, gamma / 38));
        const gy = Math.max(-1, Math.min(1, (beta - 42) / 55));
        lean.x += (gx - lean.x) * 0.16;
        lean.y += (gy - lean.y) * 0.16;
      },
      shake: ({ intensity }) => {
        lastTouchRef.current = performance.now();
        // agitation in this material: loose dust unbinds and the orbits of
        // everything you made are perturbed off their tracks
        const wind = windRef.current;
        const seed = Math.floor(performance.now());
        wind.vx += (hash01(seed) - 0.5) * 700 * (0.4 + intensity);
        wind.vy += (hash01(seed ^ 0x9e37) - 0.5) * 420 * (0.4 + intensity);
        const stars = bornStarsRef.current;
        if (stars.length) {
          const next = stars.map((s, i) => ({
            ...s,
            vx: (s.vx ?? 0) + (hash01(seed + i * 131) - 0.5) * 0.14 * (0.5 + intensity),
            vy: (s.vy ?? 0) + (hash01(seed + i * 977) - 0.5) * 0.14 * (0.5 + intensity),
          }));
          bornStarsRef.current = next;
          setBornStars(next);
        }
        haptics.chop();
        try { getFieldAudio().thud(); } catch { /* noop */ }
        markSky("the dust unbinds", "gravity", 0.6, "region", "shake", false);
      },
      knock: ({ intensity }) => {
        lastTouchRef.current = performance.now();
        // a rap on the case is a bell struck through the whole field
        knockRef.current = {
          t0: performance.now(),
          x: (window.innerWidth || 1) * 0.5,
          y: (window.innerHeight || 1) * 0.5,
        };
        haptics.detent();
        try {
          const audio = getFieldAudio();
          audio.bell();
          window.setTimeout(() => {
            try { audio.playTone(96 + intensity * 60, 0.9); } catch { /* noop */ }
          }, 90);
        } catch { /* noop */ }
        markSky("the sky rings", "star", 0.7, "region", "knock", false);
      },
      flip: ({ faceDown }) => {
        nightTargetRef.current = faceDown ? 1 : 0;
        try { getFieldAudio()[faceDown ? "thud" : "spark"](); } catch { /* noop */ }
        if (faceDown) haptics.roll();
        markSky(faceDown ? "night" : "the sky returns", "nebula", 0.34, "region", "night", false);
      },
    });
  }, [markSky]);

  // The sky is not a static wallpaper: once in a while a visible bright
  // star dies on its own. It is rare enough to feel discovered, not noisy.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      if (document.hidden || namingRef.current || Math.random() > 0.54) return;
      const fn = starPosRef.current;
      if (!fn) return;
      const STARS = activeFieldRef.current.stars;
      for (let tries = 0; tries < 18; tries++) {
        const idx = Math.floor(Math.random() * STARS.length);
        const star = STARS[idx];
        if (!star || (star.size < 1.35 && star.brightness < 0.76)) continue;
        if (consumedSeedRef.current.get(activeLayerRef.current)?.has(idx)) continue;
        const p = fn(idx, performance.now() / 1000);
        if (p.x < 40 || p.x > window.innerWidth - 40 || p.y < 80 || p.y > window.innerHeight - 80) continue;
        const collapse = (star.size > 2.1 || star.brightness > 0.9) && Math.random() < 0.34
          && userBlackHolesRef.current.length < MAX_USER_BLACK_HOLES;
        supernovaAt(p.x, p.y, star.rgb, false, collapse);
        break;
      }
    }, RANDOM_SUPERNOVA_MS);
    return () => window.clearInterval(id);
  }, [supernovaAt]);

  // ── cosmic weather — biased by per-layer automata density ──────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer = 0;
    const safePoint = (): { x: number; y: number; nx: number; ny: number } => {
      const ww = window.innerWidth;
      const wh = window.innerHeight;
      const x = 60 + Math.random() * Math.max(1, ww - 120);
      const y = 120 + Math.random() * Math.max(1, wh - 220);
      const sky = camScreenToSky(cameraRef.current, x, y, ww, wh);
      return { x, y, nx: sky.nx, ny: sky.ny };
    };
    const fire = () => {
      if (!(document.hidden || namingRef.current)) {
        const layer = activeLayerRef.current;
        const profile = LAYER_PROFILES[layer];
        let grid = automataRef.current.get(layer);
        if (!grid) {
          grid = createAutomata(profile.seed);
          automataRef.current.set(layer, grid);
        }
        const p = safePoint();
        const dens = sampleAutomata(grid, p.nx, p.ny);
        // hotter cells → more violent events; cool cells prefer comets/birth
        let roll = Math.random();
        if (dens > 0.55) roll = Math.min(0.99, roll + 0.18);
        if (dens < 0.22) roll *= 0.7;
        if (profile.quasarCount > 0 && dens > 0.6 && roll > 0.85) {
          spawnGrb(p.x, p.y);
        } else if (roll < 0.26) spawnComet();
        else if (roll < 0.46) spawnPulsar(p.x, p.y);
        else if (roll < 0.62) spawnNova(p.x, p.y);
        else if (roll < 0.76) spawnStarForm(p.x, p.y);
        else if (roll < 0.9) spawnTidalFlare(p.x, p.y);
        else spawnGrb(p.x, p.y);
      }
      const bias = LAYER_PROFILES[activeLayerRef.current].weatherBias;
      // the cosmic weather runs on the sky's dilated clock too: three
      // fingers held down stretch the wait between events, and a
      // face-down phone stretches it further still
      const dilation = Math.max(0.08, timeScaleRef.current * (1 - 0.55 * nightRef.current));
      timer = window.setTimeout(fire, (9000 + Math.random() * 8000) / bias / dilation);
    };
    timer = window.setTimeout(fire, 5000 + Math.random() * 5000);
    return () => window.clearTimeout(timer);
  }, [spawnComet, spawnPulsar, spawnNova, spawnStarForm, spawnTidalFlare, spawnGrb]);

  // ── the room runtime: sleep when unseen, tick the density automata ──
  // Both the document's own visibility and the gallery frame's pause
  // protocol are hard sleep bits: a hidden sky costs nothing at all.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let hidden = false;
    let paused = false;
    const settle = () => { pageHiddenRef.current = hidden || paused; };
    const offVis = onVisibility((h) => { hidden = h; settle(); });
    const offPause = onGalleryPause((p) => { paused = p; settle(); });
    const autoId = window.setInterval(() => {
      if (pageHiddenRef.current) return;
      const layer = activeLayerRef.current;
      let grid = automataRef.current.get(layer);
      if (!grid) {
        grid = createAutomata(LAYER_PROFILES[layer].seed);
        automataRef.current.set(layer, grid);
      }
      automataRef.current.set(layer, tickAutomata(grid));
    }, 1600);
    return () => {
      offVis();
      offPause();
      window.clearInterval(autoId);
    };
  }, []);

  // ── black-hole mergers — hierarchical pairs + soft N-body dance ────
  // Closest pair inspirals; when it commits, the next queued pair can
  // start immediately so triples chain as A+B → C+(AB).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lastTick = performance.now();
    const tick = () => {
      if (pageHiddenRef.current) return;
      const nowMs = performance.now();
      // An inspiral is an orbit, and orbits obey the sky's dilated clock:
      // while three fingers rest on the field the fall is held open by
      // pushing the merger's own start time forward.
      const dilation = Math.max(0.05, timeScaleRef.current * (1 - 0.55 * nightRef.current));
      const wallStep = nowMs - lastTick;
      lastTick = nowMs;
      if (mergerRef.current && dilation < 0.999) {
        mergerRef.current.tStartMs += wallStep * (1 - dilation);
      }
      let holes = userBlackHolesRef.current;

      // soft N-body nudge among free holes (and active accretion well)
      if (holes.length >= 2 || gravityWellRef.current.mode === "accrete") {
        const well = gravityWellRef.current;
        let wellSky: { nx: number; ny: number; mass: number } | null = null;
        if (well.active && well.mode === "accrete") {
          const s = camScreenToSky(cameraRef.current, well.x, well.y, window.innerWidth, window.innerHeight);
          wellSky = { nx: s.nx, ny: s.ny, mass: Math.max(0.2, well.mass) };
        }
        const busy = new Set<string>();
        if (mergerRef.current) {
          busy.add(mergerRef.current.aId);
          busy.add(mergerRef.current.bId);
        }
        const free = holes.filter((h) => !busy.has(h.id));
        if (free.length) {
          const deltas = applyHoleNBody(free, 0.14, wellSky);
          const byId = new Map(deltas.map((d) => [d.id, d]));
          let moved = false;
          holes = holes.map((h) => {
            const d = byId.get(h.id);
            if (!d) return h;
            const nx = clampPan(h.nx + d.dnx);
            const ny = clampPan(h.ny + d.dny);
            if (nx !== h.nx || ny !== h.ny) moved = true;
            return { ...h, nx, ny };
          });
          if (moved) {
            userBlackHolesRef.current = holes;
            setUserBlackHoles(holes);
          }
        }
      }

      const m = mergerRef.current;
      if (m) {
        if (!m.committed && nowMs - m.tStartMs >= m.durMs) {
          m.committed = true;
          const a = holes.find((hh) => hh.id === m.aId);
          const b = holes.find((hh) => hh.id === m.bId);
          if (a && b) {
            const midNx = (m.ax + m.bx) / 2;
            const midNy = (m.ay + m.by) / 2;
            // the ledger of a merger: the masses add, minus the ~5% the
            // gravitational wave carries away — and that lost mass is
            // exactly what powers the ripple. The orbit's own angular
            // momentum spins the remnant up no matter how the two were
            // turning; an equal pair lands near 0.69 of maximal.
            const total = a.mass + b.mass;
            const radiated = total * 0.05;
            const merged: UserBlackHole = {
              id: makeId("bh"),
              nx: midNx,
              ny: midNy,
              mass: Math.min(3.6, total - radiated),
              spin: m.spinSign * Math.min(1.25, 0.69 + Math.abs(a.spin + b.spin) * 0.18),
              hue: (a.hue + b.hue) / 2,
              createdAt: Date.now(),
            };
            const next = holes.filter((hh) => hh.id !== a.id && hh.id !== b.id)
              .concat(merged).slice(-MAX_USER_BLACK_HOLES);
            userBlackHolesRef.current = next;
            setUserBlackHoles(next);
            persistCosmicMemory(bornStarsRef.current, next);
            gravWavesRef.current = [
              ...gravWavesRef.current.slice(-4),
              { id: ++skyPulseId.current, nx: midNx, ny: midNy, t0Ms: nowMs, life: reduce ? 2.2 : 3.0, strength: Math.min(1.2, 0.55 + radiated * 3.5) },
            ];
            const ww = window.innerWidth;
            const wh = window.innerHeight;
            const scr = skyToScreen(cameraRef.current, midNx, midNy, ww, wh, 0);
            addCosmicEvent({ kind: "merger", x: scr.x, y: scr.y, life: 2.4, seed: Math.floor(nowMs) >>> 0, rgb: [210, 180, 255], power: merged.mass });
            chirpTone(total);
            haptics.storm();
            markSky("black holes merged", "merger", 0.98, "sigil", "merger");
            holes = next;
          }
          mergerRef.current = null;
          // immediately consider the next closest pair (triple chain)
        } else {
          return;
        }
      }

      if (holes.length < 2) return;
      const pairs = rankMergePairs(holes, 0.075);
      // also queue near-misses for later
      for (const p of pairs.slice(0, 3)) {
        if (!mergerQueueRef.current.some((q) => q.aId === p.aId && q.bId === p.bId)) {
          mergerQueueRef.current.push({ aId: p.aId, bId: p.bId });
        }
      }
      mergerQueueRef.current = mergerQueueRef.current.slice(0, 6);

      const startMergeById = (aId: string, bId: string) => {
        const a = holes.find((h) => h.id === aId);
        const b = holes.find((h) => h.id === bId);
        if (!a || !b) return false;
        mergerRef.current = {
          aId: a.id, bId: b.id,
          ax: a.nx, ay: a.ny, bx: b.nx, by: b.ny,
          tStartMs: performance.now(),
          durMs: reduce ? 1500 : 2400,
          spinSign: (a.spin + b.spin) >= 0 ? 1 : -1,
          committed: false,
        };
        haptics.roll();
        markSky(
          holes.length >= 4
            ? "a hierarchy falling together"
            : holes.length >= 3
              ? "triple system collapsing"
              : "black holes falling together",
          "merger",
          0.6,
          "object",
          "inspiral",
          false,
        );
        return true;
      };

      if (pairs.length && pairs[0].d < 0.075) {
        startMergeById(pairs[0].aId, pairs[0].bId);
        mergerQueueRef.current = mergerQueueRef.current.filter(
          (q) => !(q.aId === pairs[0].aId && q.bId === pairs[0].bId),
        );
        return;
      }

      // drain queue after a free merge slot
      while (mergerQueueRef.current.length) {
        const q = mergerQueueRef.current.shift()!;
        if (startMergeById(q.aId, q.bId)) return;
      }

      if (nowMs > mergerScanRef.current && holes.length >= 2 && Math.random() < 0.45) {
        mergerScanRef.current = nowMs + 18000;
        const ranked = rankMergePairs(holes, 0.22);
        if (ranked[0]) startMergeById(ranked[0].aId, ranked[0].bId);
      }
    };
    const id = window.setInterval(tick, 140);
    return () => window.clearInterval(id);
  }, [addCosmicEvent, chirpTone, markSky, persistCosmicMemory]);

  // ── the way down ───────────────────────────────────────────────────
  // At local-band zoom, the condensed world nearest the frame's center is
  // the one being dived into. It rides sessionStorage to the atlas (the
  // same channel the manifold uses for its landing position), so pinching
  // through the deep wall opens the chart on that world instead of the
  // origin sheet. The beacon clears itself whenever no world is under you.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      try {
        const cam = cameraRef.current;
        if (cam.zoom < 8 || userPlanetsRef.current.length === 0) {
          window.sessionStorage.removeItem(PLANET_DESCENT_KEY);
          return;
        }
        const ww = window.innerWidth || 1;
        const wh = window.innerHeight || 1;
        const c = camScreenToSky(cam, ww / 2, wh / 2, ww, wh);
        let best: UserPlanet | null = null;
        let bestD = 0.09;
        for (const p of userPlanetsRef.current) {
          const d = Math.hypot(p.nx - c.nx, p.ny - c.ny);
          if (d < bestD) { bestD = d; best = p; }
        }
        if (best) {
          window.sessionStorage.setItem(
            PLANET_DESCENT_KEY,
            JSON.stringify({ prompt: planetPrompt(best), seed: best.seed, at: Date.now() }),
          );
        } else {
          window.sessionStorage.removeItem(PLANET_DESCENT_KEY);
        }
      } catch { /* noop */ }
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  // ── keyboard ───────────────────────────────────────────────────────
  // The same verbs, reachable without a hand on the glass. Nothing here is
  // a control to learn — it is the accessibility baseline for the gestures
  // above: space is the hold (press to gather, keep holding to open a
  // horizon, release to commit), backspace is the ceremony, brackets turn
  // the lens, and the sky answers t as it answers three fingers.
  useEffect(() => {
    const centre = (): { x: number; y: number } => ({
      x: (window.innerWidth || 1) * 0.5,
      y: (window.innerHeight || 1) * 0.5,
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftRef.current = true;
      if (namingRef.current) return;
      lastTouchRef.current = performance.now();
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        setLensRungTo(lensRungRef.current - 1);
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        setLensRungTo(lensRungRef.current + 1);
        return;
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        tuttiNow();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        // the ceremony, without the holding: unbind the shape under the
        // cursor, or the most recently kept one
        const id = hoveredSavedRef.current ?? savedRef.current[0]?.id;
        if (id) {
          e.preventDefault();
          deleteSaved(id);
        }
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        const well = gravityWellRef.current;
        const c = centre();
        if (!e.repeat) {
          well.active = true;
          well.x = c.x;
          well.y = c.y;
          well.t0 = performance.now();
          well.mass = 0;
          well.gather = 0;
          well.mode = "gather";
          void requestVessel();
          return;
        }
        if (!well.active) return;
        const held = performance.now() - well.t0;
        if (held < THRESHOLDS.dwellMs) {
          well.gather = Math.max(0, Math.min(1, (held - THRESHOLDS.tapMaxMs) / (THRESHOLDS.dwellMs - THRESHOLDS.tapMaxMs)));
          return;
        }
        if (well.mode !== "accrete") {
          well.mode = "accrete";
          well.gather = 1;
          haptics.roll();
        }
        well.mass = ((held - THRESHOLDS.dwellMs) / 1000) * WELL_MASS_PER_SEC;
        return;
      }
      if (e.key === "Escape" && pendingRef.current.length > 0) {
        cancelPending();
        return;
      }
      if (e.key === "Enter" && pendingRef.current.length >= 3) {
        const last = lastClickPos.current;
        const w = window.innerWidth;
        const mobile = w < 700;
        if (mobile || !last) {
          setNamePos({ x: w / 2, y: 110 });
        } else {
          const clampedX = Math.max(20, Math.min(w - 280, last.x + 24));
          const clampedY = Math.max(20, Math.min(window.innerHeight - 80, last.y + 24));
          setNamePos({ x: clampedX, y: clampedY });
        }
        setNaming(true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftRef.current = false;
      if (e.key !== " " || namingRef.current) return;
      const well = gravityWellRef.current;
      if (!well.active) return;
      const held = performance.now() - well.t0;
      if (well.mode === "accrete") {
        releaseAccretion(well.x, well.y, held, well.mass);
      } else {
        singleTapAt(well.x, well.y, 0.5);
      }
      abortWell();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    abortWell, cancelPending, deleteSaved, releaseAccretion, setLensRungTo,
    singleTapAt, tuttiNow, zoomIn, zoomOut,
  ]);

  // ── render ─────────────────────────────────────────────────────────
  // anything the sky still keeps, on any layer — gates the quiet clear
  const skyKeeps =
    bornStars.length > 0 ||
    userBlackHoles.length > 0 ||
    Object.values(memoryRef.current.layers).some(
      (l) => l != null && ((l.bornStars?.length ?? 0) > 0 || (l.blackHoles?.length ?? 0) > 0),
    );

  return (
    <div
      data-touch-surface="true"
      // the shared step-back convention: a raised lens is lowered before the
      // frame retreats (see ScaleTravel's roomLensRaised)
      data-lens-raised={lensRung > 0 ? "1" : undefined}
      className="stars-root"
      style={{
        position: "fixed",
        inset: 0,
        background: "#000204",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={bgRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100vw",
          height: "100vh",
          display: "block",
          pointerEvents: "none",
        }}
      />
      <canvas
        ref={fgRef}
        tabIndex={0}
        aria-label="a living night sky with star births, supernovae, pulsars, comets, nebulae, galaxies, and feeding, merging black holes"
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "absolute",
          inset: 0,
          width: "100vw",
          height: "100vh",
          display: "block",
          touchAction: "none",
          cursor:
            hoveredSaved || hoveredNebula !== null || hoveredMilkyWay
              ? "pointer"
              : "crosshair",
        }}
      />

      {scaleEdgeOverlay}

      <div
        data-stars-memory="true"
        aria-live="polite"
        style={{
          position: "fixed",
          left: 18,
          bottom: "calc(128px + env(safe-area-inset-bottom, 0px))",
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          gap: 10,
          maxWidth: "min(520px, calc(100vw - 36px))",
          padding: "8px 10px",
          border: "1px solid rgba(232, 226, 213, 0.16)",
          borderRadius: 6,
          background: "rgba(4, 8, 14, 0.48)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          color: "rgba(232, 226, 213, 0.68)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 0,
          textTransform: "lowercase",
          pointerEvents: "none",
        }}
      >
        <span>{userBlackHoles.length ? `${userBlackHoles.length} holes` : `${bornStars.length} born`}</span>
        <span>{pending.length ? `${pending.length} connected` : layerLabel(activeLayer)}</span>
        <span
          className={skyPulse ? "is-lit" : ""}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            minWidth: 86,
            maxWidth: 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: skyPulse ? SKY_PULSE_COLOR[skyPulse.tone] : "rgba(232, 226, 213, 0.44)",
          }}
        >
          <i
            style={{
              width: skyPulse ? 2 : 28,
              height: skyPulse ? 24 : 1,
              flex: "0 0 auto",
              background: "currentColor",
              boxShadow: skyPulse ? "0 0 18px currentColor" : "none",
              opacity: skyPulse ? 0.9 : 0.48,
              transition: "width 240ms ease, height 240ms ease, opacity 240ms ease",
            }}
          />
          {skyPulse?.label ?? (hoveredSaved ? "old constellation" : hoveredNebula !== null ? "nebula" : hoveredMilkyWay ? "milky way" : "night changing")}
        </span>
      </div>

      {/* top eyebrow + title */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: 78,
          textAlign: "center",
          pointerEvents: "none",
          color: "rgba(232, 226, 213, 0.85)",
        }}
      >
        <div
          className="t-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "lowercase",
            opacity: 0.7,
            marginBottom: 10,
          }}
        >
          living night · pinch deeper · hold to accrete
        </div>
        <WaterText
          as="h1"
          bobAmp={0}
          style={{
            display: "block",
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            fontSize: 44,
            letterSpacing: "0.10em",
            lineHeight: 1.0,
            color: "rgba(244, 238, 222, 0.96)",
          }}
        >
          STARS
        </WaterText>
        <WaterText
          as="div"
          bobAmp={2}
          style={{
            display: "block",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 15,
            marginTop: 8,
            opacity: 0.7,
          }}
        >
          stars are born and collapse
        </WaterText>
      </div>

      {/* bottom hint */}
      <div
        data-stars-hint="true"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: "calc(118px + env(safe-area-inset-bottom, 0px))",
          textAlign: "center",
          fontFamily: "var(--font-text)",
          fontSize: 12,
          letterSpacing: "0.10em",
          textTransform: "lowercase",
          color: "rgba(232, 226, 213, 0.50)",
          pointerEvents: "none",
        }}
      >
        tap to birth · hold for a hole · drag to pan · pinch/trackpad to zoom
      </div>

      {/* name input */}
      {naming && namePos && (
        <div
          style={{
            position: "fixed",
            left: namePos.x,
            top: namePos.y,
            transform:
              namePos.y < 140
                ? "translate(-50%, 0)"
                : undefined,
            background: "rgba(8, 17, 28, 0.86)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "1px solid rgba(232, 226, 213, 0.22)",
            borderRadius: 6,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            zIndex: 5,
            boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
          }}
        >
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitName();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setNaming(false);
                setNameValue("");
                setEditingId(null);
                setNamePos(null);
              }
            }}
            placeholder="name this shape"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "rgba(244, 238, 222, 0.96)",
              fontFamily: "var(--font-serif), serif",
              fontStyle: "italic",
              fontSize: 16,
              minWidth: 200,
              letterSpacing: "0.01em",
            }}
          />
          <span
            className="t-mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.1em",
              opacity: 0.55,
              color: "rgba(232, 226, 213, 0.9)",
              textTransform: "lowercase",
            }}
          >
            enter
          </span>
        </div>
      )}
      <LetGo label="let the sky forget" onLetGo={letSkyForget} visible={skyKeeps} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        body:has(.stars-root) .oda-field-watch,
        body:has(.stars-root) .oda-candle-mark,
        body:has(.stars-root) .oda-tape-shell,
        body:has(.stars-root) .oda-sound-toggle {
          display: none !important;
        }
        @media (max-width: 700px) {
          [data-stars-memory="true"] {
            left: 12px !important;
            right: 12px !important;
            bottom: calc(148px + env(safe-area-inset-bottom, 0px)) !important;
            max-width: none !important;
            justify-content: center;
            gap: 8px !important;
          }
          [data-stars-hint="true"] {
            bottom: calc(118px + env(safe-area-inset-bottom, 0px)) !important;
            padding: 0 18px;
            line-height: 1.45;
          }
        }
      `,
        }}
      />
    </div>
  );
}
