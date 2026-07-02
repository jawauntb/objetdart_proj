"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";
import WaterText from "@/components/WaterText";

/**
 * /stars — the night sky (Hubble Deep-Space pass).
 *
 * Deep space, redrawn with photographic ambition: spectral-class star
 * colors with halo + glow + core + diffraction spikes; dense layered
 * nebulae built from overlapping radial-gradient wisps; black holes
 * with accretion disks and faint gravitational lensing of nearby
 * stars; small log-spiral galaxies; a structured Milky Way band with
 * dark dust lanes and HII regions embedded.
 *
 * Performance: the static, distant universe (background gradient,
 * Milky Way structure, nebulae, black holes' rings, galaxies) is
 * painted ONCE on mount/resize into an offscreen canvas, then
 * blit per-frame via drawImage. Only the star field (twinkle,
 * gravitational lensing offsets, camera rotation) and the
 * foreground constellation layer redraw each frame.
 *
 * Two visible canvases:
 *   - background canvas: blit the static offscreen + draw stars on top.
 *   - foreground canvas: constellation lines, the pending selection,
 *     star hit-halos, the names floating beside their shapes.
 *
 * Slow camera drift gives a sense of cosmic time. Reduced-motion holds
 * everything still.
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

type CosmicEventKind = "birth" | "collapse" | "supernova";
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
};

type CosmicMemory = {
  bornStars: BornStar[];
  blackHoles: UserBlackHole[];
};

type SavedConstellation = {
  id: string;
  name: string;
  starIndices: number[];
  createdAt: number;
};

type SkyPulseTone = "star" | "nebula" | "gravity" | "kept" | "wish" | "birth" | "supernova";
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

const STAR_SEED = 0xC0FFEE;
const STAR_COUNT = 520;
const NEBULA_SEED = 0xBADA55;
const BLACKHOLE_SEED = 0xB14CC0;
const GALAXY_SEED = 0x9A1A99;
const PLANET_SEED = 0x51A751;
const STORAGE_KEY = "objetdart:constellations:v1";
const COSMIC_STORAGE_KEY = "objetdart:stars:cosmic:v1";
const MAX_BORN_STARS = 96;
const MAX_USER_BLACK_HOLES = 7;
const RANDOM_SUPERNOVA_MS = 18000;

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

// ── field generation ─────────────────────────────────────────────────

// Pareto-ish: bias the size distribution so most stars are tiny and a
// small tail is large — gives the "deep field" speckle look.
function paretoSize(u: number): number {
  // 0.35 .. ~3.2px; the cubic falloff means the 99th percentile is
  // still under ~3px, with bright outliers occasionally larger.
  return 0.35 + Math.pow(u, 4.5) * 2.9;
}

function generateStars(): Star[] {
  const rng = makeRng(STAR_SEED);
  const out: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    // ~28% of stars belong to the milky way band — sampled around a
    // diagonal y = 0.5 + (x - 0.5) * 0.35 with soft thickness.
    const inBand = rng() < 0.28;
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

    const size = paretoSize(rng());
    const brightness = 0.32 + Math.pow(rng(), 1.8) * 0.6;
    const twinkleAmt = rng() < 0.55 ? 0.18 + rng() * 0.42 : 0;
    const spectral = pickSpectral(rng());
    const rgb = SPECTRAL_RGB[spectral];

    // diffraction spikes only on bright/large stars — Hubble's spikes
    // come from telescope strut diffraction so we mimic them on the
    // brightest sources only. spikeLen 0 = no spikes.
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

const STARS: Star[] = generateStars();

function generateNebulae(): Nebula[] {
  const rng = makeRng(NEBULA_SEED);
  const out: Nebula[] = [];
  // 5 nebulae across the field — anchor points spread by quadrant so
  // they don't clump. Each gets 3-5 wisps in its palette, with offsets,
  // rotation, squash, and alpha sampled from the seeded RNG.
  const anchors: Array<[number, number]> = [
    [0.22, 0.30],
    [0.74, 0.62],
    [0.52, 0.18],
    [0.18, 0.74],
    [0.82, 0.30],
  ];
  for (let i = 0; i < anchors.length; i++) {
    const [ax, ay] = anchors[i];
    const palette = NEBULA_PALETTES[i % NEBULA_PALETTES.length];
    const wispCount = 3 + Math.floor(rng() * 3); // 3..5
    const wisps: NebulaWisp[] = [];
    for (let j = 0; j < wispCount; j++) {
      // alternate the two palette colors so the wisps blend
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
      nx: ax + (rng() - 0.5) * 0.08,
      ny: ay + (rng() - 0.5) * 0.08,
      rBase: 0.34 + rng() * 0.18,
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

const NEBULAE: Nebula[] = generateNebulae();

function generateBlackHoles(): BlackHole[] {
  const rng = makeRng(BLACKHOLE_SEED);
  // place two black holes; keep them off-center and not on top of
  // the Milky Way band so the disk silhouette reads.
  const slots: Array<[number, number]> = [
    [0.32, 0.70],
    [0.78, 0.22],
  ];
  return slots.map(([nx, ny]) => {
    const rHorizon = 0.010 + rng() * 0.006;
    const rDiskIn = rHorizon * 1.6;
    const rDiskOut = rHorizon * 6.5;
    return {
      nx,
      ny,
      rHorizon,
      rDiskIn,
      rDiskOut,
      tilt: 0.28 + rng() * 0.35,
      rot: rng() * Math.PI * 2,
      rLens: rHorizon * 14,
      lensStrength: 0.42,
      hotRgb: [255, 210, 150] as [number, number, number],
    };
  });
}

const BLACKHOLES: BlackHole[] = generateBlackHoles();

function generateGalaxies(): Galaxy[] {
  const rng = makeRng(GALAXY_SEED);
  // 2 small log-spirals in opposite quadrants so the eye finds them.
  const slots: Array<[number, number]> = [
    [0.12, 0.52],
    [0.88, 0.78],
  ];
  return slots.map(([nx, ny]) => ({
    nx,
    ny,
    rCore: 0.012 + rng() * 0.008,
    rDisk: 0.060 + rng() * 0.030,
    rot: rng() * Math.PI * 2,
    // very slow rotation (galaxies should be effectively still)
    rotSpeed: (rng() < 0.5 ? -1 : 1) * (0.0014 + rng() * 0.0010),
    tilt: 0.32 + rng() * 0.30,
    arms: 2 + (rng() < 0.5 ? 0 : 1),
    twist: 0.45 + rng() * 0.20,
    coreRgb: [255, 240, 210] as [number, number, number],
    armRgb: [180, 200, 240] as [number, number, number],
  }));
}

const GALAXIES: Galaxy[] = generateGalaxies();

function generatePlanetSystems(): PlanetSystem[] {
  const rng = makeRng(PLANET_SEED);
  const anchors: Array<[number, number]> = [
    [0.38, 0.34],
    [0.63, 0.56],
    [0.48, 0.72],
    [0.72, 0.42],
    [0.27, 0.58],
  ];
  const palettes: Array<[[number, number, number], [number, number, number]]> = [
    [[194, 218, 230], [230, 218, 180]],
    [[226, 168, 126], [184, 206, 230]],
    [[150, 196, 172], [224, 196, 146]],
    [[205, 188, 232], [180, 212, 220]],
    [[230, 205, 152], [220, 180, 150]],
  ];
  return anchors.map(([nx, ny], i) => {
    const [hueRgb, ringRgb] = palettes[i % palettes.length];
    const moons = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => ({
      ang: rng() * Math.PI * 2,
      dist: 1.9 + rng() * 2.5,
      size: 0.16 + rng() * 0.20,
    }));
    return {
      nx: nx + (rng() - 0.5) * 0.06,
      ny: ny + (rng() - 0.5) * 0.06,
      bodyR: 0.0065 + rng() * 0.0045,
      ringR: 2.05 + rng() * 1.10,
      ringTilt: 0.23 + rng() * 0.28,
      rot: rng() * Math.PI * 2,
      hueRgb,
      ringRgb,
      moons,
    };
  });
}

const PLANET_SYSTEMS: PlanetSystem[] = generatePlanetSystems();

// ── component ────────────────────────────────────────────────────────

// transient visual effects, kept in refs so they update without re-rendering
type Spark = { x: number; y: number; t0: number };
type NebulaBreath = { idx: number; t0: number };
type GravityWell = {
  active: boolean;
  x: number;
  y: number;
  t0: number;
  pointerId: number | null;
};

type PointerIntent = {
  x: number;
  y: number;
  starIdx: number;
  nebulaIdx: number;
  inMilkyWay: boolean;
};

// breath effect duration, seconds
const NEBULA_BREATH_DUR = 4;
// spark lifetime, seconds
const SPARK_LIFE = 0.8;
// Milky Way band — keep these constants in sync with the draw code
const MW_BAND_ANGLE = 0.34;        // base angle in radians
const MW_BAND_HALF_THICKNESS = 0.10; // normalized to min(w,h)
const USER_ZOOM_MIN = 1;
const USER_ZOOM_MAX = 4.2;
const USER_ZOOM_STEP = 0.55;
const PLANET_REVEAL_ZOOM = 2.05;

function clampZoom(v: number): number {
  return Math.max(USER_ZOOM_MIN, Math.min(USER_ZOOM_MAX, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
  const [naming, setNaming] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hoveredSaved, setHoveredSaved] = useState<string | null>(null);
  const [hoveredNebula, setHoveredNebula] = useState<number | null>(null);
  const [hoveredMilkyWay, setHoveredMilkyWay] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [userZoom, setUserZoom] = useState(1);
  const [skyPulse, setSkyPulse] = useState<SkyPulse | null>(null);

  // transient effects — mutated by event handlers, read by the RAF loop
  const skyPulseId = useRef(0);
  const sparksRef = useRef<Spark[]>([]);
  const breathsRef = useRef<NebulaBreath[]>([]);
  const cosmicEventsRef = useRef<CosmicEvent[]>([]);
  const gravityWellRef = useRef<GravityWell>({
    active: false,
    x: 0,
    y: 0,
    t0: 0,
    pointerId: null,
  });
  const pointerIntentRef = useRef<PointerIntent | null>(null);
  const milkyPulseRef = useRef<number>(0); // performance.now() of last MW click
  // hover flags also mirrored into refs so the RAF loop can read them cheaply
  const hoveredNebulaRef = useRef<number | null>(null);
  const hoveredMilkyWayRef = useRef<boolean>(false);
  const userZoomRef = useRef(userZoom);
  const bornStarsRef = useRef<BornStar[]>(bornStars);
  const userBlackHolesRef = useRef<UserBlackHole[]>(userBlackHoles);
  useEffect(() => { hoveredNebulaRef.current = hoveredNebula; }, [hoveredNebula]);
  useEffect(() => { hoveredMilkyWayRef.current = hoveredMilkyWay; }, [hoveredMilkyWay]);
  useEffect(() => { userZoomRef.current = userZoom; }, [userZoom]);
  useEffect(() => { bornStarsRef.current = bornStars; }, [bornStars]);
  useEffect(() => { userBlackHolesRef.current = userBlackHoles; }, [userBlackHoles]);

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

  const setZoomLevel = useCallback((next: number | ((cur: number) => number)) => {
    setUserZoom((cur) => {
      const value = clampZoom(typeof next === "function" ? next(cur) : next);
      userZoomRef.current = value;
      return value;
    });
  }, []);

  const zoomIn = useCallback(() => {
    setZoomLevel((cur) => cur + USER_ZOOM_STEP);
    haptics.ripple(0.38);
    markSky("rings closer", "nebula", 0.38, "object", "zoom-in");
    try { getFieldAudio().chime(); } catch { /* noop */ }
  }, [markSky, setZoomLevel]);

  const zoomOut = useCallback(() => {
    setZoomLevel((cur) => cur - USER_ZOOM_STEP);
    haptics.tap();
    markSky("galaxies wider", "star", 0.34, "object", "zoom-out");
    try { getFieldAudio().spark(); } catch { /* noop */ }
  }, [markSky, setZoomLevel]);

  const persistCosmicMemory = useCallback((memory: CosmicMemory) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(COSMIC_STORAGE_KEY, JSON.stringify({
        bornStars: memory.bornStars.slice(-MAX_BORN_STARS),
        blackHoles: memory.blackHoles.slice(-MAX_USER_BLACK_HOLES),
      }));
    } catch {
      /* noop */
    }
  }, []);

  const screenToSky = useCallback((x: number, y: number): { nx: number; ny: number } => {
    const ww = window.innerWidth || 1;
    const wh = window.innerHeight || 1;
    const zoom = Math.max(0.001, userZoomRef.current);
    return {
      nx: Math.max(0.015, Math.min(0.985, 0.5 + (x - ww * 0.5) / (ww * zoom))),
      ny: Math.max(0.015, Math.min(0.985, 0.5 + (y - wh * 0.5) / (wh * zoom))),
    };
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

  const birthStarAt = useCallback((x: number, y: number) => {
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
    const born: BornStar = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      nx,
      ny,
      size: 0.75 + rng() * 1.8,
      brightness: 0.66 + rng() * 0.30,
      twinklePhase: rng() * Math.PI * 2,
      twinkleAmt: 0.22 + rng() * 0.52,
      spikeLen: rng() > 0.52 ? 5 + rng() * 8 : 0,
      rgb,
      createdAt: Date.now(),
    };
    const nextStars = [...bornStarsRef.current, born].slice(-MAX_BORN_STARS);
    bornStarsRef.current = nextStars;
    setBornStars(nextStars);
    persistCosmicMemory({
      bornStars: nextStars,
      blackHoles: userBlackHolesRef.current,
    });
    addCosmicEvent({
      kind: "birth",
      x,
      y,
      life: 2.9,
      seed,
      rgb,
      power: 0.72 + rng() * 0.40,
    });
    haptics.ripple(0.48);
    markSky("star born", "birth", 0.68, "object", "star-birth");
    try { getFieldAudio().chime(); } catch { /* noop */ }
  }, [addCosmicEvent, markSky, persistCosmicMemory, screenToSky]);

  const supernovaAt = useCallback((
    x: number,
    y: number,
    rgb: [number, number, number] = [255, 180, 96],
    writeTape = true,
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
    markSky("supernova", "supernova", 0.88, "sigil", "supernova", writeTape);
    try { getFieldAudio().bell(); } catch { /* noop */ }
  }, [addCosmicEvent, markSky]);

  const createBlackHoleAt = useCallback((x: number, y: number) => {
    const { nx, ny } = screenToSky(x, y);
    const seed = Math.floor((Date.now() + x * 619 + y * 173) % 0xFFFFFFFF);
    const rng = makeRng(seed);
    const hole: UserBlackHole = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `bh-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      nx,
      ny,
      mass: 0.82 + rng() * 0.88,
      spin: (rng() < 0.5 ? -1 : 1) * (0.45 + rng() * 0.75),
      hue: 28 + rng() * 220,
      createdAt: Date.now(),
    };
    const nextHoles = [...userBlackHolesRef.current, hole].slice(-MAX_USER_BLACK_HOLES);
    userBlackHolesRef.current = nextHoles;
    setUserBlackHoles(nextHoles);
    persistCosmicMemory({
      bornStars: bornStarsRef.current,
      blackHoles: nextHoles,
    });
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
    markSky("black hole made", "gravity", 0.95, "sigil", "black-hole");
    try { getFieldAudio().thud(); } catch { /* noop */ }
  }, [addCosmicEvent, markSky, persistCosmicMemory, screenToSky]);

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

  // load locally evolved sky matter: born stars and user-made black holes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(COSMIC_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<CosmicMemory>;
      if (Array.isArray(parsed.bornStars)) {
        const stars = parsed.bornStars
          .filter((s) =>
            typeof s?.id === "string" &&
            typeof s.nx === "number" &&
            typeof s.ny === "number" &&
            Array.isArray(s.rgb) &&
            s.rgb.length === 3,
          )
          .slice(-MAX_BORN_STARS);
        setBornStars(stars);
        bornStarsRef.current = stars;
      }
      if (Array.isArray(parsed.blackHoles)) {
        const holes = parsed.blackHoles
          .filter((h) =>
            typeof h?.id === "string" &&
            typeof h.nx === "number" &&
            typeof h.ny === "number" &&
            typeof h.mass === "number" &&
            typeof h.spin === "number",
          )
          .slice(-MAX_USER_BLACK_HOLES);
        setUserBlackHoles(holes);
        userBlackHolesRef.current = holes;
      }
    } catch {
      /* noop */
    }
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

  // delete a saved constellation (with confirmation)
  const deleteSaved = useCallback(
    (id: string) => {
      if (deleteConfirm === id) {
        const list = savedRef.current.filter((c) => c.id !== id);
        setSaved(list);
        persistSaved(list);
        setDeleteConfirm(null);
        haptics.roll();
        markSky("constellation forgotten", "gravity", 0.62, "object", "forget");
      } else {
        setDeleteConfirm(id);
        haptics.chop();
        markSky("confirm forget", "gravity", 0.36, "object", "forget-confirm");
        // auto-clear confirmation after a few seconds
        setTimeout(() => {
          setDeleteConfirm((cur) => (cur === id ? null : cur));
        }, 3000);
      }
    },
    [deleteConfirm, markSky, persistSaved],
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
    const t0 = performance.now();

    let w = window.innerWidth;
    let h = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    // ── static-layer painter ──────────────────────────────────────
    // Paint the universe that never changes: gradient sky, Milky Way
    // structure (band + dust lanes + HII regions + perpendicular
    // gradient), nebulae (5, each with 3-5 wisps), black-hole
    // accretion rings, and small galaxies. We render at backing-store
    // resolution so the blit is 1:1 in device pixels.
    const paintStatic = () => {
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
      {
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
      dpr = Math.min(window.devicePixelRatio || 1, 2);
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

    const cameraZoom = (t: number): number => {
      const breath = motion ? 1 + Math.sin(t * 0.05) * 0.012 : 1;
      return userZoomRef.current * breath;
    };

    const worldPos = (
      nx: number,
      ny: number,
      t: number,
      rotate: boolean,
    ): { x: number; y: number } => {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const bx = (nx - 0.5) * w;
      const by = (ny - 0.5) * h;
      const ang = rotate && motion ? t * 0.003 : 0;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      const zoom = cameraZoom(t);
      return {
        x: cx + (bx * cs - by * sn) * zoom,
        y: cy + (bx * sn + by * cs) * zoom,
      };
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

      for (const bh of BLACKHOLES) {
        const { x: hx, y: hy } = worldPos(bh.nx, bh.ny, t, false);
        const horizon = base * bh.rHorizon * zoom;
        applyLens(
          hx,
          hy,
          horizon,
          base * bh.rLens * zoom,
          bh.lensStrength,
          Math.sin(bh.rot) * 0.65,
        );
      }

      for (const hole of userBlackHolesRef.current) {
        const { x: hx, y: hy } = worldPos(hole.nx, hole.ny, t, false);
        const bornAge = Math.min(1, (Date.now() - hole.createdAt) / 1800);
        const horizon = base * (0.010 + hole.mass * 0.0065) * zoom * (0.72 + bornAge * 0.28);
        applyLens(
          hx,
          hy,
          horizon,
          horizon * (18 + hole.mass * 4.5),
          0.72 + hole.mass * 0.22,
          hole.spin,
        );
      }

      const well = gravityWellRef.current;
      if (well.active) {
        const ageMs = performance.now() - well.t0;
        if (ageMs > 90) {
          const grow = Math.min(1, (ageMs - 90) / 820);
          applyLens(
            well.x,
            well.y,
            base * (0.012 + grow * 0.014),
            base * (0.18 + grow * 0.18),
            0.58 + grow * 0.70,
            0.82,
          );
        }
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
      const s = STARS[idx];
      if (!s) return { x: -9999, y: -9999 };
      const { x, y } = worldPos(s.nx, s.ny, t, true);
      return lensPoint(x, y, t);
    };

    const bornStarPos = (s: BornStar, t: number): { x: number; y: number } => {
      const { x, y } = worldPos(s.nx, s.ny, t, true);
      return lensPoint(x, y, t);
    };

    starPosRef.current = starPos;

    // ── per-star renderer — halo / glow / core / diffraction spikes
    // Layered draw for a single star at (x, y). For most stars this is
    // 2 passes (glow + core); for the brightest, we add a 4-pointed
    // cross flare (telescope diffraction).
    const drawStar = (
      s: Pick<Star, "rgb" | "size" | "spikeLen">,
      x: number,
      y: number,
      alpha: number,
    ): void => {
      const [r, g, b] = s.rgb;
      const size = s.size * Math.min(2.2, Math.sqrt(userZoomRef.current));

      // outer halo — only for stars that have it (medium+)
      if (size > 1.0) {
        const haloR = size * 5.5;
        const halo = bctx.createRadialGradient(x, y, 0, x, y, haloR);
        halo.addColorStop(0,    `rgba(${r}, ${g}, ${b}, ${(alpha * 0.20).toFixed(3)})`);
        halo.addColorStop(0.4,  `rgba(${r}, ${g}, ${b}, ${(alpha * 0.08).toFixed(3)})`);
        halo.addColorStop(1,    `rgba(${r}, ${g}, ${b}, 0)`);
        bctx.fillStyle = halo;
        bctx.beginPath();
        bctx.arc(x, y, haloR, 0, Math.PI * 2);
        bctx.fill();
      }

      // mid glow — soft bloom around the core
      const glowR = size * 2.4;
      const glow = bctx.createRadialGradient(x, y, 0, x, y, glowR);
      glow.addColorStop(0,    `rgba(${r}, ${g}, ${b}, ${(alpha * 0.55).toFixed(3)})`);
      glow.addColorStop(0.5,  `rgba(${r}, ${g}, ${b}, ${(alpha * 0.18).toFixed(3)})`);
      glow.addColorStop(1,    `rgba(${r}, ${g}, ${b}, 0)`);
      bctx.fillStyle = glow;
      bctx.beginPath();
      bctx.arc(x, y, glowR, 0, Math.PI * 2);
      bctx.fill();

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
        bctx.globalCompositeOperation = "lighter";
        // horizontal spike — linear gradient that fades from center
        const hg = bctx.createLinearGradient(x - len, y, x + len, y);
        hg.addColorStop(0,    `rgba(${cr}, ${cg}, ${cb}, 0)`);
        hg.addColorStop(0.5,  `rgba(${cr}, ${cg}, ${cb}, ${(alpha * 0.75).toFixed(3)})`);
        hg.addColorStop(1,    `rgba(${cr}, ${cg}, ${cb}, 0)`);
        bctx.fillStyle = hg;
        bctx.fillRect(x - len, y - 0.6, len * 2, 1.2);
        // vertical spike
        const vg = bctx.createLinearGradient(x, y - len, x, y + len);
        vg.addColorStop(0,    `rgba(${cr}, ${cg}, ${cb}, 0)`);
        vg.addColorStop(0.5,  `rgba(${cr}, ${cg}, ${cb}, ${(alpha * 0.75).toFixed(3)})`);
        vg.addColorStop(1,    `rgba(${cr}, ${cg}, ${cb}, 0)`);
        bctx.fillStyle = vg;
        bctx.fillRect(x - 0.6, y - len, 1.2, len * 2);
        bctx.globalCompositeOperation = prev;
      }
    };

    const drawPlanetSystems = (t: number): void => {
      const zoom = userZoomRef.current;
      const reveal = smoothstep(PLANET_REVEAL_ZOOM, USER_ZOOM_MAX * 0.82, zoom);
      if (reveal <= 0) return;
      const base = Math.min(w, h);
      bctx.save();
      bctx.globalCompositeOperation = "lighter";
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

        const glow = bctx.createRadialGradient(0, 0, 0, 0, 0, r * 4.4);
        glow.addColorStop(0, `rgba(${br}, ${bg}, ${bb}, ${(0.18 * a).toFixed(3)})`);
        glow.addColorStop(0.42, `rgba(${br}, ${bg}, ${bb}, ${(0.06 * a).toFixed(3)})`);
        glow.addColorStop(1, `rgba(${br}, ${bg}, ${bb}, 0)`);
        bctx.fillStyle = glow;
        bctx.beginPath();
        bctx.arc(0, 0, r * 4.4, 0, Math.PI * 2);
        bctx.fill();

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

        const planet = bctx.createRadialGradient(-r * 0.45, -r * 0.55, r * 0.1, 0, 0, r * 1.25);
        planet.addColorStop(0, `rgba(255, 255, 245, ${(0.90 * a).toFixed(3)})`);
        planet.addColorStop(0.38, `rgba(${br}, ${bg}, ${bb}, ${(0.88 * a).toFixed(3)})`);
        planet.addColorStop(1, `rgba(${Math.max(0, br - 90)}, ${Math.max(0, bg - 90)}, ${Math.max(0, bb - 90)}, ${(0.92 * a).toFixed(3)})`);
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

    const drawUserBlackHoles = (t: number): void => {
      const base = Math.min(w, h);
      const zoom = cameraZoom(t);
      const holes = userBlackHolesRef.current;
      if (!holes.length) return;
      for (const hole of holes) {
        const { x, y } = worldPos(hole.nx, hole.ny, t, false);
        const bornAge = Math.min(1, (Date.now() - hole.createdAt) / 1800);
        const horizon = base * (0.010 + hole.mass * 0.0065) * zoom * (0.72 + bornAge * 0.28);
        const lensR = horizon * (18 + hole.mass * 4.5);
        const einsteinR = Math.sqrt(horizon * lensR) * 0.72;
        if (x < -lensR || x > w + lensR || y < -lensR || y > h + lensR) continue;

        // A clipped magnified copy of the static sky makes the area read as
        // gravitationally lensed before the accretion disk is drawn over it.
        bctx.save();
        bctx.beginPath();
        bctx.arc(x, y, lensR * 0.92, 0, Math.PI * 2);
        bctx.clip();
        bctx.globalAlpha = 0.10 * bornAge;
        bctx.globalCompositeOperation = "screen";
        bctx.translate(x, y);
        bctx.rotate(hole.spin * 0.04 + t * hole.spin * 0.015);
        bctx.scale(1.035 + hole.mass * 0.010, 1.035 + hole.mass * 0.010);
        bctx.drawImage(staticCanvas, -x, -y, w, h);
        bctx.restore();

        bctx.save();
        bctx.translate(x, y);
        bctx.rotate(t * hole.spin * 0.18);
        bctx.globalCompositeOperation = "lighter";

        const ringHue = hole.hue;
        const coolHue = (hole.hue + 185) % 360;
        const diskOuter = horizon * (5.4 + hole.mass * 1.2);
        const diskInner = horizon * 1.55;
        bctx.save();
        bctx.rotate(hole.spin * 0.65);
        bctx.scale(1, 0.28 + hole.mass * 0.045);
        const disk = bctx.createRadialGradient(0, 0, diskInner, 0, 0, diskOuter);
        disk.addColorStop(0, `hsla(${ringHue}, 95%, 76%, ${(0.58 * bornAge).toFixed(3)})`);
        disk.addColorStop(0.23, `hsla(${ringHue + 18}, 92%, 58%, ${(0.38 * bornAge).toFixed(3)})`);
        disk.addColorStop(0.58, `hsla(${coolHue}, 88%, 66%, ${(0.18 * bornAge).toFixed(3)})`);
        disk.addColorStop(1, `hsla(${coolHue}, 90%, 50%, 0)`);
        bctx.fillStyle = disk;
        bctx.beginPath();
        bctx.arc(0, 0, diskOuter, 0, Math.PI * 2);
        bctx.fill();

        bctx.strokeStyle = `hsla(${coolHue}, 96%, 74%, ${(0.22 * bornAge).toFixed(3)})`;
        bctx.lineWidth = 1.1;
        bctx.beginPath();
        bctx.ellipse(0, 0, einsteinR, einsteinR, 0, 0, Math.PI * 2);
        bctx.stroke();
        bctx.restore();

        // Doppler-bright beamed crescent on one side of the disk.
        bctx.strokeStyle = `hsla(${ringHue + 25}, 100%, 78%, ${(0.54 * bornAge).toFixed(3)})`;
        bctx.lineWidth = Math.max(1.4, horizon * 0.13);
        bctx.beginPath();
        bctx.ellipse(0, 0, diskOuter * 0.88, diskOuter * 0.25, hole.spin * 0.45, -0.22 * Math.PI, 0.82 * Math.PI);
        bctx.stroke();
        bctx.globalCompositeOperation = "source-over";

        const photon = bctx.createRadialGradient(0, 0, horizon * 0.88, 0, 0, horizon * 3.0);
        photon.addColorStop(0, `hsla(${ringHue}, 100%, 84%, ${(0.34 * bornAge).toFixed(3)})`);
        photon.addColorStop(0.52, `hsla(${coolHue}, 100%, 74%, ${(0.16 * bornAge).toFixed(3)})`);
        photon.addColorStop(1, "rgba(0, 0, 0, 0)");
        bctx.fillStyle = photon;
        bctx.beginPath();
        bctx.arc(0, 0, horizon * 3.0, 0, Math.PI * 2);
        bctx.fill();

        const core = bctx.createRadialGradient(0, 0, 0, 0, 0, horizon * 1.48);
        core.addColorStop(0, "rgba(0, 0, 0, 1)");
        core.addColorStop(0.74, "rgba(0, 0, 0, 0.98)");
        core.addColorStop(1, "rgba(0, 0, 0, 0)");
        bctx.fillStyle = core;
        bctx.beginPath();
        bctx.arc(0, 0, horizon * 1.48, 0, Math.PI * 2);
        bctx.fill();
        bctx.restore();
      }
    };

    const drawCosmicEvents = (nowMs: number): void => {
      const base = Math.min(w, h);
      cosmicEventsRef.current = cosmicEventsRef.current.filter((ev) => (nowMs - ev.t0) / 1000 < ev.life);
      if (!cosmicEventsRef.current.length) return;

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
          const glow = bctx.createRadialGradient(0, 0, 0, 0, 0, ringR * 1.8);
          glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(0.22 * bloom).toFixed(3)})`);
          glow.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${(0.09 * bloom).toFixed(3)})`);
          glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          bctx.fillStyle = glow;
          bctx.beginPath();
          bctx.arc(0, 0, ringR * 1.8, 0, Math.PI * 2);
          bctx.fill();
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
          const blast = bctx.createRadialGradient(0, 0, 0, 0, 0, shell * 1.12);
          blast.addColorStop(0, `rgba(255, 255, 230, ${(0.38 * alpha).toFixed(3)})`);
          blast.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, ${(0.22 * alpha).toFixed(3)})`);
          blast.addColorStop(0.72, `rgba(${r}, ${g}, ${b}, ${(0.07 * alpha).toFixed(3)})`);
          blast.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          bctx.fillStyle = blast;
          bctx.beginPath();
          bctx.arc(0, 0, shell * 1.12, 0, Math.PI * 2);
          bctx.fill();
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
          const core = bctx.createRadialGradient(0, 0, 0, 0, 0, rOuter * 0.62);
          core.addColorStop(0, `rgba(0, 0, 0, ${(0.96 * (1 - implosion * 0.24)).toFixed(3)})`);
          core.addColorStop(0.72, "rgba(0, 0, 0, 0.70)");
          core.addColorStop(1, "rgba(0, 0, 0, 0)");
          bctx.fillStyle = core;
          bctx.beginPath();
          bctx.arc(0, 0, rOuter * 0.62, 0, Math.PI * 2);
          bctx.fill();
        }

        bctx.restore();
      }
    };

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const nowMs = now;

      // ── BACKGROUND ───────────────────────────────────────────────
      // Blit the static universe in one drawImage. Then we layer
      // dynamic things (nebula breath flashes, star field) on top.
      bctx.clearRect(0, 0, w, h);
      const zoom = cameraZoom(t);
      bctx.save();
      bctx.translate(w * 0.5, h * 0.5);
      bctx.scale(zoom, zoom);
      bctx.drawImage(staticCanvas, -w * 0.5, -h * 0.5, w, h);
      bctx.restore();

      // A slow, almost imperceptible night-shift: the field never reads
      // as a flat backdrop, even when nobody touches it.
      if (motion) {
        const era = 0.5 + 0.5 * Math.sin(t * 0.028);
        const driftX = w * (0.22 + 0.58 * (0.5 + 0.5 * Math.sin(t * 0.019)));
        const driftY = h * (0.24 + 0.42 * (0.5 + 0.5 * Math.cos(t * 0.016)));
        const night = bctx.createRadialGradient(driftX, driftY, 0, driftX, driftY, Math.min(w, h) * 0.92);
        night.addColorStop(0, `rgba(80, 120, 180, ${(0.020 + era * 0.018).toFixed(3)})`);
        night.addColorStop(0.45, `rgba(130, 80, 170, ${(0.010 + (1 - era) * 0.012).toFixed(3)})`);
        night.addColorStop(1, "rgba(0, 0, 0, 0)");
        bctx.save();
        bctx.globalCompositeOperation = "screen";
        bctx.fillStyle = night;
        bctx.fillRect(0, 0, w, h);
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
          const palette = NEBULA_PALETTES.find((p) => p.name === n.paletteName)
            ?? NEBULA_PALETTES[0];
          const [pr, pg, pb] = palette.a;
          const a = 0.08 * env;
          const grad = bctx.createRadialGradient(px, py, 0, px, py, r);
          grad.addColorStop(0,    `rgba(${pr}, ${pg}, ${pb}, ${a.toFixed(3)})`);
          grad.addColorStop(0.6,  `rgba(${pr}, ${pg}, ${pb}, ${(a * 0.4).toFixed(3)})`);
          grad.addColorStop(1,    `rgba(${pr}, ${pg}, ${pb}, 0)`);
          bctx.fillStyle = grad;
          bctx.beginPath();
          bctx.arc(px, py, r, 0, Math.PI * 2);
          bctx.fill();
        }
        bctx.globalCompositeOperation = prev;
      }

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
      for (let i = 0; i < STARS.length; i++) {
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
        if (s.twinkleAmt > 0) {
          const speed = inBand && mwHover ? 4.6 : (motion ? 1.7 : 0.6);
          const amp = motion ? s.twinkleAmt : s.twinkleAmt * 0.3;
          const tw = 0.5 + 0.5 * Math.sin(t * speed + s.twinklePhase);
          alpha = s.brightness * (1 - amp + amp * tw);
        }
        if (inBand && mwPulse > 0) {
          alpha = Math.min(1, alpha + 0.35 * mwPulse);
        }

        drawStar(s, x, y, alpha);

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
      for (const s of bornStarsRef.current) {
        const { x, y } = bornStarPos(s, t);
        const cullM = 18 + s.size * 8;
        if (x < -cullM || x > w + cullM || y < -cullM || y > h + cullM) continue;
        const bornAge = Math.min(1, (Date.now() - s.createdAt) / 2200);
        const tw = 0.5 + 0.5 * Math.sin(t * (2.4 + s.twinkleAmt) + s.twinklePhase);
        const alpha = s.brightness * (0.34 + bornAge * 0.66) * (1 - s.twinkleAmt * 0.34 + s.twinkleAmt * 0.34 * tw);
        drawStar(s, x, y, alpha);
        const [r, g, b] = s.rgb;
        const newborn = 1 - bornAge;
        if (newborn > 0.02) {
          const halo = bctx.createRadialGradient(x, y, 0, x, y, 34 + s.size * 12);
          halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(0.22 * newborn).toFixed(3)})`);
          halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          bctx.fillStyle = halo;
          bctx.beginPath();
          bctx.arc(x, y, 34 + s.size * 12, 0, Math.PI * 2);
          bctx.fill();
        }
      }
      bctx.restore();

      drawUserBlackHoles(t);
      drawCosmicEvents(nowMs);
      drawPlanetSystems(t);

      const well = gravityWellRef.current;
      if (well.active) {
        const age = (nowMs - well.t0) / 1000;
        if (age > 0.08) {
          const grow = Math.min(1, (age - 0.08) / 0.82);
          const base = Math.min(w, h);
          const coreR = 10 + grow * 18;
          const ringR = base * (0.06 + grow * 0.09);
          bctx.save();
          bctx.translate(well.x, well.y);
          bctx.rotate(t * 0.9);
          bctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < 3; i++) {
            bctx.strokeStyle = i === 0
              ? `rgba(255, 198, 120, ${(0.34 * grow).toFixed(3)})`
              : `rgba(132, 170, 255, ${(0.16 * grow).toFixed(3)})`;
            bctx.lineWidth = 2.2 - i * 0.5;
            bctx.beginPath();
            bctx.ellipse(0, 0, ringR * (1 + i * 0.26), ringR * (0.26 + i * 0.05), 0, 0, Math.PI * 2);
            bctx.stroke();
          }
          bctx.globalCompositeOperation = "source-over";
          const lens = bctx.createRadialGradient(0, 0, 0, 0, 0, ringR * 1.6);
          lens.addColorStop(0, "rgba(0, 0, 0, 0.92)");
          lens.addColorStop(0.32, "rgba(0, 0, 0, 0.62)");
          lens.addColorStop(0.58, `rgba(15, 24, 46, ${(0.26 * grow).toFixed(3)})`);
          lens.addColorStop(1, "rgba(15, 24, 46, 0)");
          bctx.fillStyle = lens;
          bctx.beginPath();
          bctx.arc(0, 0, ringR * 1.6, 0, Math.PI * 2);
          bctx.fill();
          bctx.fillStyle = "rgba(0, 0, 0, 0.98)";
          bctx.beginPath();
          bctx.arc(0, 0, coreR, 0, Math.PI * 2);
          bctx.fill();
          bctx.restore();

          if (age > 0.26 && sparksRef.current.length < 18 && Math.floor(nowMs / 140) % 2 === 0) {
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
      }

      // ── FOREGROUND: constellations ───────────────────────────────
      fctx.clearRect(0, 0, w, h);

      // saved constellations
      const hovered = hoveredSavedRef.current;
      for (const c of savedRef.current) {
        const isHover = hovered === c.id;
        const lineAlpha = isHover ? 0.55 : 0.28;
        fctx.strokeStyle = `rgba(232, 226, 213, ${lineAlpha})`;
        fctx.lineWidth = isHover ? 1.2 : 0.9;
        fctx.beginPath();
        let lastValid: { x: number; y: number } | null = null;
        for (let i = 0; i < c.starIndices.length; i++) {
          const idx = c.starIndices[i];
          if (idx < 0 || idx >= STARS.length) continue;
          const p = starPos(idx, t);
          if (i === 0 || !lastValid) {
            fctx.moveTo(p.x, p.y);
          } else {
            fctx.lineTo(p.x, p.y);
          }
          lastValid = p;
        }
        fctx.stroke();

        // small open circles around each named star
        for (const idx of c.starIndices) {
          if (idx < 0 || idx >= STARS.length) continue;
          const p = starPos(idx, t);
          fctx.strokeStyle = `rgba(232, 226, 213, ${isHover ? 0.65 : 0.35})`;
          fctx.lineWidth = 0.9;
          fctx.beginPath();
          fctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
          fctx.stroke();
        }

        // name beside the centroid
        if (c.starIndices.length) {
          let sx = 0;
          let sy = 0;
          let n = 0;
          for (const idx of c.starIndices) {
            if (idx < 0 || idx >= STARS.length) continue;
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
          const hg = fctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, rad + 6);
          hg.addColorStop(0,   `rgba(255, 230, 170, ${0.55 * a})`);
          hg.addColorStop(0.6, `rgba(255, 230, 170, ${0.18 * a})`);
          hg.addColorStop(1,   "rgba(255, 230, 170, 0)");
          fctx.fillStyle = hg;
          fctx.beginPath();
          fctx.arc(sp.x, sp.y, rad + 6, 0, Math.PI * 2);
          fctx.fill();
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
          const hg = fctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 18);
          hg.addColorStop(0,   `rgba(255, 230, 170, ${0.32 * pulse})`);
          hg.addColorStop(0.6, `rgba(255, 230, 170, ${0.10 * pulse})`);
          hg.addColorStop(1,   "rgba(255, 230, 170, 0)");
          fctx.fillStyle = hg;
          fctx.beginPath();
          fctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
          fctx.fill();
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
    const zoom = userZoomRef.current;
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < NEBULAE.length; i++) {
      const n = NEBULAE[i];
      const px = w * 0.5 + (n.nx - 0.5) * w * zoom;
      const py = h * 0.5 + (n.ny - 0.5) * h * zoom;
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
    const w = window.innerWidth;
    const h = window.innerHeight;
    const base = Math.min(w, h);
    const zoom = userZoomRef.current;
    const lx = (cx - w * 0.5) / zoom;
    const ly = (cy - h * 0.5) / zoom;
    const cs = Math.cos(-MW_BAND_ANGLE);
    const sn = Math.sin(-MW_BAND_ANGLE);
    const localY = lx * sn + ly * cs;
    return Math.abs(localY) < base * MW_BAND_HALF_THICKNESS;
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
        if (idx < 0 || idx >= STARS.length) continue;
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
        if (idx < 0 || idx >= STARS.length) continue;
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

  // ── pointer handlers ───────────────────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (namingRef.current) return;
      const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (e.button === 2) {
        const savedId = findSavedAt(x, y);
        if (savedId) {
          deleteSaved(savedId);
        }
        return;
      }

      const idx = findStarAt(x, y);
      if (e.shiftKey && idx >= 0) {
        const cur = pendingRef.current;
        if (cur.length > 0 && cur[cur.length - 1] === idx) return;
        setPending([...cur, idx]);
        lastClickPos.current = { x, y };
        haptics.ripple(0.34 + Math.min(0.34, cur.length * 0.08));
        markSky(`${cur.length + 1} stars chosen`, "star", 0.42, "object", `select-${cur.length + 1}`);
        try { getFieldAudio().chime(); } catch { /* noop */ }
        return;
      }

      if (pendingRef.current.length > 0) {
        cancelPending();
      }

      pointerIntentRef.current = {
        x,
        y,
        starIdx: idx,
        nebulaIdx: findNebulaAt(x, y),
        inMilkyWay: isInMilkyWay(x, y),
      };
      gravityWellRef.current = {
        active: true,
        x,
        y,
        t0: performance.now(),
        pointerId: e.pointerId,
      };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    },
    [findStarAt, findSavedAt, findNebulaAt, isInMilkyWay, deleteSaved, cancelPending, markSky],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const well = gravityWellRef.current;
      if (well.active && well.pointerId === e.pointerId) {
        well.x = x;
        well.y = y;
      }
      setHoveredSaved(findSavedAt(x, y));
      setHoveredNebula(findNebulaAt(x, y));
      setHoveredMilkyWay(isInMilkyWay(x, y));
    },
    [findSavedAt, findNebulaAt, isInMilkyWay],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const well = gravityWellRef.current;
    if (well.pointerId === e.pointerId) {
      const held = performance.now() - well.t0;
      const intent = pointerIntentRef.current;
      const move = intent ? Math.hypot(well.x - intent.x, well.y - intent.y) : 0;

      if (held > 430) {
        createBlackHoleAt(well.x, well.y);
      } else if (!intent || move > 26) {
        markSky("light bent", "gravity", 0.48, "sigil", "light-bent");
      } else if (intent.starIdx >= 0) {
        const star = STARS[intent.starIdx];
        if (star && (star.size > 1.55 || star.brightness > 0.78)) {
          const p = starPosRef.current?.(intent.starIdx, performance.now() / 1000) ?? { x: well.x, y: well.y };
          supernovaAt(p.x, p.y, star.rgb);
        } else {
          birthStarAt(well.x, well.y);
        }
      } else if (intent.nebulaIdx >= 0) {
        const nebIdx = intent.nebulaIdx;
        breathsRef.current = [
          ...breathsRef.current.filter((b) => b.idx !== nebIdx),
          { idx: nebIdx, t0: performance.now() },
        ];
        haptics.roll();
        markSky("nebula breath", "nebula", 0.58, "sigil", "nebula");
        try { getFieldAudio().bell(); } catch { /* noop */ }
      } else if (intent.inMilkyWay) {
        milkyPulseRef.current = performance.now();
        haptics.roll();
        markSky("milky way brightened", "nebula", 0.62, "region", "milky-way");
        try { getFieldAudio().bell(); } catch { /* noop */ }
      } else {
        birthStarAt(well.x, well.y);
      }

      gravityWellRef.current.active = false;
      gravityWellRef.current.pointerId = null;
      pointerIntentRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    }
  }, [birthStarAt, createBlackHoleAt, markSky, supernovaAt]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = findSavedNameAt(x, y);
      if (!id) return;
      const c = savedRef.current.find((cc) => cc.id === id);
      if (!c) return;
      const w = window.innerWidth;
      const mobile = w < 700;
      const clampedX = mobile ? w / 2 : Math.max(20, Math.min(w - 280, x + 24));
      const clampedY = mobile ? 110 : Math.max(20, Math.min(window.innerHeight - 80, y + 24));
      setNamePos({ x: clampedX, y: clampedY });
      setNameValue(c.name);
      setEditingId(id);
      setNaming(true);
      haptics.tap();
      markSky("rename constellation", "kept", 0.38, "object", "rename-open");
    },
    [findSavedNameAt, markSky],
  );

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // The sky is not a static wallpaper: once in a while a visible bright
  // star dies on its own. It is rare enough to feel discovered, not noisy.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      if (document.hidden || namingRef.current || Math.random() > 0.54) return;
      const fn = starPosRef.current;
      if (!fn) return;
      for (let tries = 0; tries < 18; tries++) {
        const idx = Math.floor(Math.random() * STARS.length);
        const star = STARS[idx];
        if (!star || (star.size < 1.35 && star.brightness < 0.76)) continue;
        const p = fn(idx, performance.now() / 1000);
        if (p.x < 40 || p.x > window.innerWidth - 40 || p.y < 80 || p.y > window.innerHeight - 80) continue;
        supernovaAt(p.x, p.y, star.rgb, false);
        break;
      }
    }, RANDOM_SUPERNOVA_MS);
    return () => window.clearInterval(id);
  }, [supernovaAt]);

  // ── keyboard: Enter (name) / Escape (cancel) ───────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (namingRef.current) return;
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelPending, zoomIn, zoomOut]);

  // ── render ─────────────────────────────────────────────────────────
  return (
    <div
      data-touch-surface="true"
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
        aria-label="a living night sky with star births, supernovae, nebulae, galaxies, and black holes"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
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

      <div
        data-stars-memory="true"
        aria-live="polite"
        style={{
          position: "fixed",
          left: 18,
          bottom: "calc(168px + env(safe-area-inset-bottom, 0px))",
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
        <span>{pending.length ? `${pending.length} connected` : userZoom >= PLANET_REVEAL_ZOOM ? "rings near" : "galaxies wide"}</span>
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
          living night · galaxies, nebulae, black holes
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
        birthlight · stellar death · collapsed space
      </div>

      {/* compact zoom controls */}
      <div
        data-stars-zoom="true"
        aria-label="sky zoom controls"
        style={{
          position: "fixed",
          left: 18,
          bottom: "calc(104px + env(safe-area-inset-bottom, 0px))",
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 6px",
          border: "1px solid rgba(232, 226, 213, 0.18)",
          borderRadius: 6,
          background: "rgba(4, 8, 14, 0.58)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
        }}
      >
        <button
          type="button"
          aria-label="zoom out"
          onClick={zoomOut}
          disabled={userZoom <= USER_ZOOM_MIN}
          style={{
            width: 30,
            height: 30,
            border: "1px solid rgba(232, 226, 213, 0.24)",
            borderRadius: 4,
            background: "rgba(232, 226, 213, 0.08)",
            color: "rgba(244, 238, 222, 0.88)",
            fontFamily: "var(--font-text)",
            fontSize: 18,
            lineHeight: "28px",
            padding: 0,
            cursor: userZoom <= USER_ZOOM_MIN ? "default" : "pointer",
            opacity: userZoom <= USER_ZOOM_MIN ? 0.38 : 1,
          }}
        >
          -
        </button>
        <div
          className="t-mono"
          aria-live="polite"
          style={{
            minWidth: 42,
            textAlign: "center",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "lowercase",
            color: "rgba(232, 226, 213, 0.66)",
          }}
        >
          {userZoom >= PLANET_REVEAL_ZOOM ? "rings" : "galaxies"}
        </div>
        <button
          type="button"
          aria-label="zoom in"
          onClick={zoomIn}
          disabled={userZoom >= USER_ZOOM_MAX}
          style={{
            width: 30,
            height: 30,
            border: "1px solid rgba(232, 226, 213, 0.24)",
            borderRadius: 4,
            background: "rgba(232, 226, 213, 0.08)",
            color: "rgba(244, 238, 222, 0.88)",
            fontFamily: "var(--font-text)",
            fontSize: 18,
            lineHeight: "28px",
            padding: 0,
            cursor: userZoom >= USER_ZOOM_MAX ? "default" : "pointer",
            opacity: userZoom >= USER_ZOOM_MAX ? 0.38 : 1,
          }}
        >
          +
        </button>
      </div>

      {/* delete-confirmation toast */}
      {deleteConfirm && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            top: 200,
            textAlign: "center",
            pointerEvents: "none",
            color: "rgba(232, 226, 213, 0.82)",
            fontFamily: "var(--font-text)",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "lowercase",
          }}
        >
          right-click again to forget this constellation
        </div>
      )}

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
            bottom: calc(184px + env(safe-area-inset-bottom, 0px)) !important;
            max-width: none !important;
            justify-content: center;
            gap: 8px !important;
          }
          [data-stars-hint="true"] {
            bottom: calc(146px + env(safe-area-inset-bottom, 0px)) !important;
            padding: 0 18px;
            line-height: 1.45;
          }
          [data-stars-zoom="true"] {
            left: 12px !important;
            bottom: calc(102px + env(safe-area-inset-bottom, 0px)) !important;
            gap: 4px !important;
            padding: 4px !important;
          }
          [data-stars-zoom="true"] button {
            width: 28px !important;
            height: 28px !important;
            line-height: 26px !important;
          }
        }
      `,
        }}
      />
    </div>
  );
}
