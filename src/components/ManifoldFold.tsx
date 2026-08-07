"use client";

/**
 * /manifold — the spacetime fold at 10²⁶ m, the ceiling of the scale axis
 * (plan W6). The whole album seen as one object.
 *
 * Two intertwined ideas. The fabric: a hairline mesh that wells under
 * masses the hand places (dwell), rung by gravitational pulses (tap),
 * dragged and released (one finger), sheared by frame-dragging wind (three
 * fingers), dilated ×0.25 (three-finger hold — the one room where slowed
 * time should feel cosmic). Light rays race the field at one fixed speed
 * and bend hard around the wells; a tapped pulse propagates at exactly the
 * same speed, so your own ripple races the light and never beats it. Twin
 * beacons blink the same clock — the one drifting into a well blinks
 * slower and warmer than its far twin: gravity slowing time, watched, no
 * numbers. Ceremony on a mass collapses it in a slow flash that sends one
 * strong wave through everything.
 *
 * The filament: one luminous thread woven through the fabric carrying the
 * scale bands as beads, the axis floor to the manifold — built rooms candle-
 * warm, unbuilt embers. Tap a bead and it chimes at its band's spectral
 * register (compressed into a gentle audible range): the site heard as one
 * instrument from above. Ceremony on a built bead travels there — every
 * room reachable from the top. Twist rotates the lens: the fabric
 * straightens into the bare metric — flat measured grid, straight rays,
 * the thread a log₁₀-meter ruler in thin mono numerals (the only place
 * notation appears).
 *
 * The grain: the fabric's texture is the large-scale structure of the
 * universe — a seeded cosmic web of candle-warm filaments meeting at
 * nodes, galaxy motes clustered along them, dark voids between. The web
 * rides the same displacement field as the mesh (masses well it, pulses
 * ripple it, frame-drag shears it): one fabric, not wallpaper. And it
 * breathes apart — the Hubble breath: everything comoving drifts from
 * the view center as a(t) grows on the audio graph's slow tide, wrapped
 * at the rim by epoch crossfade so the room never empties. Inside a
 * placed mass's gravitational neighborhood the web holds together —
 * bound structures do not expand. Three-finger dilation slows the
 * breath; reduced motion freezes it.
 *
 * The fold: the fabric is not an infinite plane. Toward the boundary,
 * curvature takes over — mesh and web curl inward, foreshorten, and sink
 * into a darkened rim, and light that reaches the rim is steered along
 * the curl back inward at exactly c. The lens flattens the fold away
 * with everything else: the metric view stays a flat measured grid.
 *
 * All field math is pure and tested (src/lib/manifold-field.ts). Masses
 * persist in `objetdart:manifold:v1`, capped at 7; the oldest evaporates
 * gracefully. Deterministic throughout — seeded hashes, shared clocks;
 * Date.now() only at interaction moments. Pinch is unbound here:
 * ScaleTravel owns it (beyond lies below; above, the axis simply ends).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import {
  SCALE_BANDS,
  entryScaleInto,
  spectralRegisterFor,
  type EnteredFromMap,
  type ScaleBand,
  type ScaleBandId,
} from "@/lib/scale";
import {
  SOFTENING,
  boundFraction,
  buildCosmicWeb,
  foldPoint,
  mergeBodies,
  mergeRadiusFor,
  placeMotes,
  ringdownEnvelope,
  rimSteerRay,
  scaleFactor,
  seasonAccelAt,
  seasonGeodesicStep,
  stepMutualGravity,
  timeDilation,
  wellDepth,
  type LawSeason,
  type MassPoint,
  type OrbitBody,
  type Ray,
} from "@/lib/manifold-field";
import {
  resolveDpr,
  onGalleryPause,
  onVisibility,
  isEmbeddedFrame,
  createFrameGovernor,
  detailForTier,
} from "@/lib/room-runtime";
import { ScaleTravelOverlay, type EdgeUI } from "@/components/ScaleTravel";
import { playTravelPassage } from "@/components/TravelPassage";
import LetGo from "@/components/LetGo";
import { createGravityFieldRenderer, type GravityFieldRenderer } from "@/components/SpacetimeShader";

const STORE_KEY = "objetdart:manifold:v1";
const SCALE_S_KEY = "objetdart:scale:s";
const ENTERED_FROM_KEY = "objetdart:scale:enteredFrom:v1";
const MAX_MASSES = 7;
const RAY_COUNT = 6;
const TRAIL_MAX = 26;
const EVAP_MS = 1600;
const MESH_GAP = 34;
const DIL_SOFT = 96; // wells read wide for clocks
const DIL_K = 4;
const WEB_SEED = 3126; // the sky's one seed — the web never rolls dice
const WEB_SUB = 6; // segments per filament polyline
const WRAP = 2; // comoving wrap ratio: one epoch per doubling of a(t)
const WEB_DISP = 0.85; // the web rides the mesh's field, slightly supple
/** Physics BETWEEN the masses: every settled mass pulls every other one,
 *  softened exactly like the field they well. Small enough that a single
 *  planted pair drifts rather than snaps together — the fold is patient. */
const MUTUAL_G = 1400;
const MASS_SPEED_CAP = 220; // px/s — a close pass bends hard but never flings
const MERGE_UNIT = 9; // px per sqrt(mass) of contact radius
/** How the same mass compacts, stage by stage: neutron star, then hole. */
const STAGE_COMPACTION: readonly number[] = [1, 0.68, 0.42];
const STAGE_MASS_GAIN: readonly number[] = [1, 1.7, 2.1];
/**
 * Gyroscopic parallax (the vessel's tilt): max shift in px at full lean.
 * The fold hangs in real space beyond the glass — layers shift by depth
 * (the near thread most, the far web least, the rim not at all), smoothed
 * and clamped; subtle at rest, unmistakable in motion; off under reduce.
 */
const PAR_MAX = 22;
const PAR_WEB = 0.35;
const PAR_MESH = 0.55;
const PAR_MASS = 0.75;
const PAR_PULSE = 0.8;
const PAR_BEACON = 0.85;
const PAR_RAY = 0.9;
const PAR_THREAD = 1;

type Mass = {
  id: string;
  nx: number;
  ny: number;
  m: number;
  plantedAt: number;
  /** 0..1 while the fabric is still welling around a fresh mass. */
  growth: number;
  settled: boolean;
  /** 0..1 collapse charge under a ceremony hold. */
  charge: number;
  /** performance.now() when evaporation began; 0 = present. */
  evapAt: number;
  /** px/s, in the room's own frame — a settled mass pulls, and is pulled. */
  vx: number;
  vy: number;
  /** 0 star, 1 neutron star, 2 black hole — a double-tap collapse ladder,
   *  compacting the same mass into a smaller, denser, darker presence. */
  stage: 0 | 1 | 2;
};

type RayState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: Array<{ x: number; y: number; w: number }>;
};

type Pulse = { x: number; y: number; bornLight: number; strength: number };

type Tug = { x: number; y: number; dx: number; dy: number; strength: number; born: number };

type Orbit = { x: number; y: number; omega: number; until: number };

type Stored = { masses: Array<{ id: string; nx: number; ny: number; m: number; plantedAt: number }> };

/** One precomputed comoving copy of the cosmic web (two alternate by epoch). */
type WebLayer = {
  /** filament polylines, (WEB_SUB + 1) xy pairs per link */
  verts: Float32Array;
  linkCount: number;
  /** node xy pairs — where filaments meet */
  nodes: Float32Array;
  /** galaxy motes as x, y, glow triples */
  motes: Float32Array;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

// the ruler's band-edge scale values never change at runtime (SCALE_BANDS is
// a static import) — computed once instead of every frame the lens is raised
const RULER_EDGES: number[] = [...SCALE_BANDS.map((b) => b.sMin), SCALE_BANDS[SCALE_BANDS.length - 1].sMax];

function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * A radial falloff's *shape* is scale-invariant (its stop offsets are
 * ratios), so one sprite drawn once can stand in for every
 * `createRadialGradient` call that only ever varied in center/radius/alpha —
 * exactly the per-mass shadow and evaporation flash below. Baked at full
 * alpha; callers scale intensity with `ctx.globalAlpha`, size with
 * `drawImage`'s destination rect. This is the room-runtime contract's
 * sanctioned alternative to a shader for a single-color falloff.
 */
function makeRadialSprite(stops: Array<[number, string]>, size = 128): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const sctx = c.getContext("2d");
  if (sctx) {
    const g = sctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [offset, color] of stops) g.addColorStop(offset, color);
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, size, size);
  }
  return c;
}

/** Band center → a gentle audible chime pitch: the register compressed
 *  (power law, monotone, invertible) into the middle of hearing. */
function beadHz(band: ScaleBand): number {
  const { baseHz } = spectralRegisterFor((band.sMin + band.sMax) / 2);
  return clamp(220 * Math.pow(baseHz / 220, 0.62), 60, 1250);
}

/** Ruler numeral for a boundary: log₁₀ meters, thin and exact. */
function rulerLabel(s: number): string {
  return `${s < 0 ? "−" : ""}${Math.abs(s) % 1 === 0 ? Math.abs(s) : Math.abs(s).toFixed(1)}`;
}

function loadStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || !Array.isArray(parsed.masses)) return null;
    return {
      masses: parsed.masses.filter(
        (m) =>
          m &&
          typeof m.nx === "number" &&
          typeof m.ny === "number" &&
          typeof m.m === "number" &&
          typeof m.plantedAt === "number",
      ),
    };
  } catch {
    return null;
  }
}

export default function ManifoldFold() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fieldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const router = useRouter();
  const [travelUi, setTravelUi] = useState<EdgeUI>({ pressure: 0, towardLabel: null, crossing: false });
  const letGoRef = useRef<() => void>(() => {});
  // whether any mass still wells the fabric — gates the quiet clear
  const [standing, setStanding] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const fieldCanvas = fieldCanvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— the shared curvature field (SpacetimeShader.tsx) —————
    // the mesh's own well-shading loop stays cheap 2D sprites (above); this
    // WebGL layer adds the one thing 2D compositing can't do well — a true
    // per-pixel lensing ring around every live mass — shared with
    // RelativityRoom's well glow. Additive, so it sits above the 2D canvas
    // and needs no knowledge of what's beneath it; falls back to nothing
    // (the 2D room is already complete without it) when WebGL is absent.
    const field: GravityFieldRenderer | null = fieldCanvas ? createGravityFieldRenderer(fieldCanvas, "glow") : null;

    // sprites for the two per-mass falloffs that used to allocate a fresh
    // createRadialGradient every mass, every frame (room-runtime contract):
    // the well's shadow (flat solid to 0.2R, fading to 0 by 3.2R — the same
    // shape a nonzero-r0 gradient drew) and the evaporation flash.
    // ray heads and built-band beads used to allocate a fresh
    // createRadialGradient per ray and per bead every frame — the exact
    // Ocean/Fire pattern (a per-object gradient inside a for loop) the
    // paint test cannot see because the call itself is one static line.
    // Two hue-tinted variants of the standard 128px alpha halo: cool white
    // for ray heads, warm candle for built-band beads. Callers stamp with
    // drawImage and let globalAlpha carry per-object intensity.
    const rayHeadSprite = makeRadialSprite([
      [0, "rgba(240, 246, 255, 1)"],
      [1, "rgba(240, 246, 255, 0)"],
    ]);
    const beadBuiltSprite = makeRadialSprite([
      [0, "rgba(231, 172, 82, 1)"],
      [0.5, "rgba(200, 130, 60, 0.28)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    const shadowSprite = makeRadialSprite([
      [0, "rgba(0,0,0,1)"],
      [0.0625, "rgba(0,0,0,1)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    const flashSprite = makeRadialSprite([
      [0, "rgba(235,242,255,0.5)"],
      [0.5, "rgba(180,200,245,0.18)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    // fixed-size buffer for the shared WebGL field pass — mutated in place
    // every frame, never reallocated (room-runtime contract: no arrays/
    // objects inside the RAF loop)
    const fieldMasses: Array<{ x: number; y: number; r: number; strength: number }> = Array.from(
      { length: MAX_MASSES },
      () => ({ x: 0, y: 0, r: 0, strength: 0 }),
    );

    // ————— state —————
    let masses: Mass[] = [];
    let massSerial = 0;
    const rays: RayState[] = [];
    let spawnSerial = 0;
    // The one entropy roll this room is allowed (named in the registry's
    // `nondeterminism` field): a session salt for the ambient light rays.
    // The rays are never part of the kept state and no film replays them,
    // so the seed law's replay guarantee is untouched — the salt only keeps
    // the door's sky from flying last visit's exact crossings again.
    const raySalt = Math.floor(Math.random() * 0xffff);
    const pulses: Pulse[] = [];
    const tugs: Tug[] = [];
    let orbit: Orbit | null = null;
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    // the background wash's colors are fixed; only its span (height) moves,
    // and only on resize — rebuilt there, never per frame
    let bgGradient: CanvasGradient | null = null;
    let lightSpeed = 600; // px/s, set on resize; rays AND pulses share it
    let rayG = 0; // bending strength, derived from lightSpeed
    let raf = 0;
    let lastFrame = 0;
    let last = performance.now();
    let localT = 0; // the room's dilatable clock
    let lightT = 0; // the clock light lives on (dilation slows it hard)
    let reduce = false;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let rayScale = 1;
    let rayScaleTarget = 1;
    let windX = 0;
    let windY = 0;
    let windTargetX = 0;
    let windTargetY = 0;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    // the vessel: smoothed gyroscopic parallax (px) and its tilt target (-1..1)
    let parX = 0;
    let parY = 0;
    let parTX = 0;
    let parTY = 0;
    // two-finger drag pans the frame (grammar §5) — a raw px offset that
    // rides the same depth-layered parallax as the vessel's tilt, so both
    // read as one consistent "the fold hangs beyond the glass" motion
    let panX = 0;
    let panY = 0;
    const PAN_LIMIT = 140;
    let lastPanSoundAt = 0;
    let lastTiltSoundAt = 0;
    let lastTuttiAt = 0;
    let knockAt = -1e9;
    let night = 0;
    let nightTarget = 0;
    const beaconPhase = [0.4, 3.1];
    // reused every frame instead of a fresh tuple array (room-runtime
    // contract: no per-frame allocation) — x/y mutated in place below
    const beaconSpots = [{ x: 0, y: 0, i: 0 }, { x: 0, y: 0, i: 1 }];
    const beadSwell = new Array<number>(SCALE_BANDS.length).fill(0);
    const beadPos = SCALE_BANDS.map(() => ({ x: 0, y: 0 }));
    let beadChargeIdx = -1;
    let beadCharge = 0;
    let leaving = false;
    let lastInteractionAt = performance.now();
    let lastSaveAt = 0;
    let dirty = false;
    let focused = false;
    let cursorNx = 0.5;
    let cursorNy = 0.5;
    let cursorVisible = false;
    let beadSel = -1;
    let kbCharge = 0;
    let kbMassId: string | null = null;
    let lastGrowNoteAt = 0;
    let lastChargeNoteAt = 0;
    let lastWindSoundAt = 0;
    let lastScrubSoundAt = 0;
    let lastCaptureSoundAt = 0;
    let staticRayPaths: Array<Array<{ x: number; y: number }>> = [];
    let staticRaysStale = true;
    let expT = 0; // the expansion's comoving clock — dilates, freezes under reduce
    let webLayers: WebLayer[] = [];
    // the field grid's four per-cell buffers (room-runtime contract: typed
    // arrays allocated once, no per-frame churn) — grown only when the
    // lattice (tier-scaled by width/height) needs more cells than before,
    // never reallocated on a same-size or shrinking frame
    let meshCap = 0;
    let vxBuf = new Float64Array(0);
    let vyBuf = new Float64Array(0);
    let dispXBuf = new Float64Array(0);
    let dispYBuf = new Float64Array(0);
    const hold: { mode: "fabric" | "mass" | "bead" | null; massId: string | null; beadIdx: number; placed: boolean; done: boolean } = {
      mode: null,
      massId: null,
      beadIdx: -1,
      placed: false,
      done: false,
    };

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => { reduce = mq.matches; staticRaysStale = true; };
    mq.addEventListener?.("change", onMq);

    // ————— persistence —————
    const save = (force = false) => {
      const now = performance.now();
      if (!force && now - lastSaveAt < 800) { dirty = true; return; }
      lastSaveAt = now;
      dirty = false;
      try {
        const stored: Stored = {
          masses: masses
            .filter((m) => !m.evapAt)
            .map((m) => ({ id: m.id, nx: m.nx, ny: m.ny, m: m.m, plantedAt: m.plantedAt })),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      } catch { /* quota; the fold lives on in memory */ }
    };

    const stored = loadStored();
    // an empty masses list is a real state (the fold was unbent) — the
    // genesis mass does not respawn over a deliberate clearing.
    if (stored) {
      masses = stored.masses.slice(-MAX_MASSES).map((m) => ({
        id: m.id,
        nx: clamp01(m.nx),
        ny: clamp01(m.ny),
        m: clamp(m.m, 0.4, 2.2),
        plantedAt: m.plantedAt,
        growth: 1,
        settled: true,
        charge: 0,
        evapAt: 0,
        vx: 0,
        vy: 0,
        stage: 0,
      }));
      massSerial = masses.length;
    } else {
      // the first look is never an empty sky: one resident mass, so the
      // light already bends and the twin clocks already disagree
      masses = [{
        id: "ms-genesis",
        nx: 0.6,
        ny: 0.42,
        m: 1.0,
        plantedAt: Date.now(),
        growth: 1,
        settled: true,
        charge: 0,
        evapAt: 0,
        vx: 0,
        vy: 0,
        stage: 0,
      }];
      massSerial = 1;
      save(true);
    }
    const syncStanding = () => setStanding(masses.some((m) => !m.evapAt));
    syncStanding();

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };
    const tone = (hz: number, sec = 0.9) => { try { audio().playTone(hz, sec); } catch { /* noop */ } };

    /** Precompute one comoving copy of the web: filament polylines with a
     *  deterministic bow, node points, and motes — static in comoving
     *  space, so per-frame work is transform-and-stroke only. */
    const buildWebLayer = (seed: number): WebLayer => {
      const ww = width * 1.5;
      const wh = height * 1.5;
      const ox = -(ww - width) / 2;
      const oy = -(wh - height) / 2;
      const count = clamp(Math.round((ww * wh) / (170 * 170)), 24, 96);
      const web = buildCosmicWeb(seed, ww, wh, count);
      const verts = new Float32Array(web.links.length * (WEB_SUB + 1) * 2);
      let vi = 0;
      for (let li = 0; li < web.links.length; li++) {
        const [i, j] = web.links[li];
        const ax = web.nodes[i].x;
        const ay = web.nodes[i].y;
        const ex = web.nodes[j].x - ax;
        const ey = web.nodes[j].y - ay;
        const len = Math.hypot(ex, ey) || 1;
        const bow = (hash01(seed * 3 + li * 17 + 5) - 0.5) * 0.22;
        for (let k = 0; k <= WEB_SUB; k++) {
          const t = k / WEB_SUB;
          const sag = Math.sin(t * Math.PI) * bow * len;
          verts[vi++] = ax + ex * t + (-ey / len) * sag + ox;
          verts[vi++] = ay + ey * t + (ex / len) * sag + oy;
        }
      }
      const nodes = new Float32Array(web.nodes.length * 2);
      for (let k = 0; k < web.nodes.length; k++) {
        nodes[k * 2] = web.nodes[k].x + ox;
        nodes[k * 2 + 1] = web.nodes[k].y + oy;
      }
      const ms = placeMotes(web, seed + 13, Math.min(300, count * 6), ww, wh, 30);
      const motes = new Float32Array(ms.length * 3);
      for (let k = 0; k < ms.length; k++) {
        motes[k * 3] = ms[k].x + ox;
        motes[k * 3 + 1] = ms[k].y + oy;
        motes[k * 3 + 2] = ms[k].glow;
      }
      return { verts, linkCount: web.links.length, nodes, motes };
    };

    // ————— performance contract (room-runtime) —————
    const gov = createFrameGovernor();
    let sleeping = false;
    let galleryPaused = false;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = resolveDpr(gov.tier(), { embedded: isEmbeddedFrame(), reducedMotion: reduce, maxDpr: 1.5 });
      width = Math.max(320, Math.floor(r.width));
      height = Math.max(480, Math.floor(r.height));
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      field?.resize(width, height, ratio);
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, "#04060b");
      bg.addColorStop(0.6, "#05070d");
      bg.addColorStop(1, "#060810");
      bgGradient = bg;
      // one speed of light for this viewport: rays and pulses both use it
      lightSpeed = 0.85 * Math.max(width, height);
      rayG = 50 * lightSpeed * lightSpeed;
      // two alternate skies, one per epoch parity — built once per resize
      webLayers = [buildWebLayer(WEB_SEED), buildWebLayer(WEB_SEED + 1)];
      staticRaysStale = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toLocal = (clientX: number, clientY: number) => ({
      x: clamp(clientX - rectLeft, 0, width),
      y: clamp(clientY - rectTop, 0, height),
    });

    const livePoints = (): MassPoint[] =>
      masses
        .filter((m) => !m.evapAt)
        .map((m) => ({ x: m.nx * width, y: m.ny * height, m: m.m * (m.settled ? 1 : 0.25 + 0.75 * m.growth) }));

    const massAt = (x: number, y: number): Mass | null => {
      let best: Mass | null = null;
      let bestD = Infinity;
      for (const m of masses) {
        if (m.evapAt) continue;
        const d = Math.hypot(x - m.nx * width, y - m.ny * height);
        if (d < Math.max(30, 12 + m.m * 18) && d < bestD) { bestD = d; best = m; }
      }
      return best;
    };

    const beadAt = (x: number, y: number): number => {
      let best = -1;
      let bestD = 26;
      for (let k = 0; k < beadPos.length; k++) {
        const d = Math.hypot(x - beadPos[k].x, y - beadPos[k].y);
        if (d < bestD) { bestD = d; best = k; }
      }
      return best;
    };

    const firePulse = (x: number, y: number, strength: number) => {
      pulses.push({ x, y, bornLight: lightT, strength });
      if (pulses.length > 7) pulses.shift();
    };

    const placeMass = (x: number, y: number, settled: boolean, vx = 0, vy = 0): Mass => {
      const m: Mass = {
        id: `ms-${massSerial++}-${Date.now().toString(36)}`,
        nx: clamp(x / width, 0.05, 0.95),
        ny: clamp(y / height, 0.08, 0.92),
        m: settled ? 0.9 : 0.5,
        plantedAt: Date.now(),
        growth: settled ? 1 : 0.06,
        settled,
        charge: 0,
        evapAt: 0,
        vx,
        vy,
        stage: 0,
      };
      masses.push(m);
      // the cap: the oldest presence lets go, gracefully
      const alive = masses.filter((q) => !q.evapAt);
      if (alive.length > MAX_MASSES) {
        const oldest = alive.reduce((a, b) => (a.plantedAt <= b.plantedAt ? a : b));
        evaporate(oldest, 0.7);
      }
      note(26, 240);
      try { haptics.ripple(0.4); } catch { /* noop */ }
      if (settled) settleMass(m);
      staticRaysStale = true;
      useField.getState().recordTape("object", 0.6, "manifold/mass");
      save();
      syncStanding();
      return m;
    };

    const settleMass = (m: Mass) => {
      if (m.settled) return;
      m.settled = true;
      m.growth = 1;
      // the fabric closes around it: felt, heard, seen in the welling
      try { haptics.bloom(); } catch { /* noop */ }
      note(31, 420);
      staticRaysStale = true;
      dirty = true;
    };

    const evaporate = (m: Mass, strength = 1) => {
      if (m.evapAt) return;
      m.evapAt = performance.now();
      m.charge = 0;
      // collapse: one slow flash, one strong wave through the whole fabric
      firePulse(m.nx * width, m.ny * height, (1.1 + m.m * 0.5) * strength);
      try { audio().bell(); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
      staticRaysStale = true;
      useField.getState().recordTape("sigil", 0.85, "manifold/evaporate");
      save();
      syncStanding();
    };

    // ————— physics BETWEEN the masses: mutual gravity, merger, ringdown —————
    // A merged remnant's quasi-normal ringing: a handful of struck notes at
    // the damped-sinusoid's own cadence, loud then soft — ringdownEnvelope
    // decides which beats still speak.
    const playRingdown = (freqHz: number, strength: number) => {
      const damping = 2.1;
      let k = 0;
      const beats = 6;
      const step = () => {
        if (k >= beats) return;
        const env = Math.abs(ringdownEnvelope(k * 0.16, freqHz, damping));
        if (env > 0.04) note(Math.max(14, Math.round(20 + strength * 8 - k * 0.7)), 260);
        k += 1;
        window.setTimeout(step, 150);
      };
      step();
    };

    /** Two masses close their gap and become one — mass and momentum exactly
     *  conserved (mergeBodies), landing in sight, sound and haptics at once. */
    const mergeMasses = (a: Mass, b: Mass, into: OrbitBody) => {
      a.m = into.m;
      a.nx = clamp01(into.x / width);
      a.ny = clamp01(into.y / height);
      a.vx = into.vx;
      a.vy = into.vy;
      a.stage = Math.max(a.stage, b.stage) as 0 | 1 | 2;
      a.settled = true;
      a.growth = 1;
      a.charge = 0;
      const bi = masses.indexOf(b);
      if (bi >= 0) masses.splice(bi, 1);
      firePulse(a.nx * width, a.ny * height, 1.4 + into.m * 0.3);
      try { audio().bell(); } catch { /* noop */ }
      try { haptics.storm(); } catch { /* noop */ }
      playRingdown(22 + Math.round(clamp01(into.m / 3) * 10), clamp01(into.m / 3));
      staticRaysStale = true;
      useField.getState().recordTape("sigil", 0.9, "manifold/merge");
      save();
      syncStanding();
    };

    /** One step of mutual gravity among every settled mass, then a merge
     *  pass. This is the room's law, not a decal: it runs every frame,
     *  gestured or not — masses orbit and inspiral on their own timers. */
    const stepMassPhysics = (dt: number) => {
      const alive = masses.filter((m) => !m.evapAt && m.settled);
      if (alive.length < 2) return;
      const dtG = dt * timeScale;
      if (!(dtG > 0)) return;
      const bodies: OrbitBody[] = alive.map((m) => ({ x: m.nx * width, y: m.ny * height, m: m.m, vx: m.vx, vy: m.vy }));
      const stepped = stepMutualGravity(bodies, dtG, MUTUAL_G, SOFTENING * 1.5, MASS_SPEED_CAP);
      stepped.forEach((b, i) => {
        const m = alive[i];
        m.nx = clamp(b.x / width, 0.03, 0.97);
        m.ny = clamp(b.y / height, 0.05, 0.95);
        m.vx = b.vx;
        m.vy = b.vy;
      });
      const { merges } = mergeBodies(stepped, MERGE_UNIT);
      if (merges.length === 0) return;
      const findIdx = (body: OrbitBody) => stepped.findIndex((s) => s.x === body.x && s.y === body.y && s.m === body.m);
      for (const ev of merges) {
        const ia = findIdx(ev.a);
        const ib = findIdx(ev.b);
        if (ia < 0 || ib < 0 || ia === ib) continue;
        mergeMasses(alive[ia], alive[ib], ev.into);
      }
    };

    /** Double-tap on a mass: collapse it one step denser — star, neutron
     *  star, black hole — the same mass compacting, never a new object. */
    const collapseStage = (m: Mass) => {
      if (m.evapAt) return;
      if (m.stage >= 2) {
        firePulse(m.nx * width, m.ny * height, 0.6);
        note(16, 260);
        try { haptics.tap(); } catch { /* noop */ }
        return;
      }
      const next = (m.stage + 1) as 0 | 1 | 2;
      m.m *= STAGE_MASS_GAIN[next] / STAGE_MASS_GAIN[m.stage];
      m.stage = next;
      m.settled = true;
      m.growth = 1;
      firePulse(m.nx * width, m.ny * height, 0.9 + next * 0.5);
      note(next === 1 ? 26 : 15, 520);
      try { haptics.roll(); } catch { /* noop */ }
      staticRaysStale = true;
      useField.getState().recordTape("sigil", 0.75, next === 1 ? "manifold/neutron-star" : "manifold/black-hole");
      save();
    };

    /** Double-tap on empty fabric: the next rarity in a fixed, deterministic
     *  cycle — a passing body (real gravity, may be captured or fly off), a
     *  gravitational-wave burst, or a light ray sent out to bend. */
    let emptySummonIdx = 0;
    const summonEmpty = (x: number, y: number, intensity: number) => {
      const kinds = ["passing-body", "gravitational-wave", "bent-ray"] as const;
      const kind = kinds[emptySummonIdx % kinds.length];
      emptySummonIdx += 1;
      if (kind === "passing-body") {
        const edge = Math.floor(hash01(massSerial * 7 + 3) * 4);
        let sx = x;
        let sy = y;
        if (edge === 0) sx = -30;
        else if (edge === 1) sx = width + 30;
        else if (edge === 2) sy = -30;
        else sy = height + 30;
        const toward = Math.atan2(y - sy, x - sx) + (hash01(massSerial * 13 + 1) - 0.5) * 0.5;
        const speed = 55 + intensity * 60;
        placeMass(sx, sy, true, Math.cos(toward) * speed, Math.sin(toward) * speed);
        return;
      }
      if (kind === "gravitational-wave") {
        // the quadrupole pattern: two wavefronts, a beat apart
        firePulse(x, y, 0.7 + intensity * 0.6);
        window.setTimeout(() => firePulse(x, y, 0.5 + intensity * 0.4), 90);
        note(30, 900);
        try { haptics.ripple(0.5); } catch { /* noop */ }
        return;
      }
      const angle = hash01(massSerial * 19 + 7) * Math.PI * 2;
      rays.push({ x, y, vx: Math.cos(angle) * lightSpeed, vy: Math.sin(angle) * lightSpeed, trail: [] });
      if (rays.length > RAY_COUNT * 2) rays.shift();
      note(44, 200);
      try { haptics.tap(); } catch { /* noop */ }
    };

    /** Triple-tap: a binary inspiral and merger, run to completion in a few
     *  seconds — the two nearest settled masses are given a mutual velocity
     *  kick that dooms them to spiral together, the /stars merger done at
     *  this scale, with a real ringdown when they finally touch. */
    const forceInspiral = (x: number, y: number) => {
      const alive = masses.filter((m) => !m.evapAt && m.settled);
      if (alive.length < 2) return false;
      alive.sort((a, b) => Math.hypot(a.nx * width - x, a.ny * height - y) - Math.hypot(b.nx * width - x, b.ny * height - y));
      const a = alive[0];
      const b = alive[1];
      const dx = b.nx * width - a.nx * width;
      const dy = b.ny * height - a.ny * height;
      const d = Math.hypot(dx, dy) || 1;
      // a tangential kick, opposite senses — the initial orbit a real
      // inspiral decays from, tuned to close within a handful of seconds
      const speed = 70 + Math.min(d, 260) * 0.42;
      a.vx += (-dy / d) * speed * (a.m > b.m ? 0.4 : 1);
      a.vy += (dx / d) * speed * (a.m > b.m ? 0.4 : 1);
      b.vx += (dy / d) * speed * (b.m > a.m ? 0.4 : 1);
      b.vy += (-dx / d) * speed * (b.m > a.m ? 0.4 : 1);
      note(24, 500);
      try { haptics.ripple(0.6); } catch { /* noop */ }
      useField.getState().recordTape("sigil", 0.85, "manifold/inspiral");
      return true;
    };

    // the whole-fold parting (LetGo, §8c): every mass evaporates oldest-
    // first along the existing collapse path and the fabric relaxes flat —
    // an exhale, never a blink. Storage is written empty at once: an unbent
    // fold is a remembered state, and the genesis mass does not return.
    const letGo = () => {
      const alive = masses.filter((m) => !m.evapAt).sort((a, b) => a.plantedAt - b.plantedAt);
      if (alive.length === 0) return;
      const now = performance.now();
      alive.forEach((m, i) => {
        m.charge = 0;
        m.evapAt = reduce ? now : now + i * 150;
        // each departure sends its own slow wave through everything
        firePulse(m.nx * width, m.ny * height, (0.5 + m.m * 0.3) * (reduce ? 0.4 : 1));
      });
      if (kbMassId) { kbMassId = null; kbCharge = 0; }
      hold.massId = null;
      hold.mode = null;
      staticRaysStale = true;
      try { audio().thud(); } catch { /* noop */ }
      note(26, 600);
      try { haptics.roll(); } catch { /* noop */ }
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ masses: [] } satisfies Stored));
      } catch { /* noop */ }
      useField.getState().recordTape("object", 0.3, "manifold/letgo");
      setStanding(false);
    };
    letGoRef.current = letGo;

    const travelTo = (band: ScaleBand) => {
      if (!band.route || band.route === "/manifold" || leaving) return;
      leaving = true;
      // Bead travel descends the axis: land just inside the destination's ceiling,
      // same as every other downward crossing ScaleTravel makes.
      const sLand = entryScaleInto(band, -1);
      try { haptics.crossing(); } catch { /* noop */ }
      try {
        window.sessionStorage.setItem(SCALE_S_KEY, String(sLand));
        const raw = window.sessionStorage.getItem(ENTERED_FROM_KEY);
        const map = (raw ? JSON.parse(raw) : {}) as EnteredFromMap;
        map[band.id as ScaleBandId] = "manifold";
        window.sessionStorage.setItem(ENTERED_FROM_KEY, JSON.stringify(map));
      } catch { /* noop */ }
      useField.getState().recordTape("region", 0.8, `manifold/travel:${band.id}`);
      // Shared passage bus — registered trunk films when present, else the
      // default. Ink fade only if the host is unmounted (SSR / tests).
      if (playTravelPassage("manifold", band, sLand, () => router.push(band.route as string))) {
        setTravelUi({ pressure: 0, towardLabel: null, crossing: false });
        return;
      }
      setTravelUi({ pressure: 1, towardLabel: band.label, crossing: true });
      window.setTimeout(() => router.push(band.route as string), 380);
    };

    const chimeBead = (k: number, quiet = false) => {
      const band = SCALE_BANDS[k];
      tone(beadHz(band), quiet ? 0.35 : 1.1);
      beadSwell[k] = Math.max(beadSwell[k], quiet ? 0.55 : 1);
      try { haptics.tap(); } catch { /* noop */ }
    };

    // three-finger tap = tutti (grammar §5): the whole axis states itself —
    // the beads glimmer in sequence, a fast arpeggio of every band
    const tutti = () => {
      const now = performance.now();
      if (now - lastTuttiAt < 1400) return;
      lastTuttiAt = now;
      for (let k = 0; k < SCALE_BANDS.length; k++) {
        window.setTimeout(() => chimeBead(k, true), k * 70);
      }
    };

    // the raised-lens marker ScaleTravel reads before a step-back nudge
    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    // Ray spawning: the entering edge keeps its predetermined serial cycle,
    // but the rest of the flight — where along that edge it enters, and
    // which way it tilts across the fold — draws on the session's one salt
    // (see `raySalt` above), so the sky never replays last visit's crossings.
    const spawnRay = (): RayState => {
      const s = spawnSerial++;
      const edge = Math.floor(hash01(s * 7 + 1) * 4);
      const along = 0.12 + hash01(s * 13 + 5 + raySalt) * 0.76;
      const tilt = (hash01(s * 29 + 11 + raySalt * 3) - 0.5) * 0.9;
      let x = 0, y = 0, a = 0;
      if (edge === 0) { x = -20; y = along * height; a = tilt; }
      else if (edge === 1) { x = width + 20; y = along * height; a = Math.PI + tilt; }
      else if (edge === 2) { x = along * width; y = -20; a = Math.PI / 2 + tilt; }
      else { x = along * width; y = height + 20; a = -Math.PI / 2 + tilt; }
      return { x, y, vx: Math.cos(a) * lightSpeed, vy: Math.sin(a) * lightSpeed, trail: [] };
    };
    for (let i = 0; i < RAY_COUNT; i++) rays.push(spawnRay());

    // ————— gestures (the grammar only; pinch belongs to ScaleTravel) —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 2) {
          // step back: a raised lens lowers first; then a panned frame comes
          // home; the marker clears a beat later so ScaleTravel skips its
          // nudge on this same tap
          if (lensSnapped === 1) {
            lensSnapped = 0;
            lensTarget = 0;
            staticRaysStale = true;
            window.setTimeout(() => markLens(false), 0);
            try { haptics.lens(); } catch { /* noop */ }
            note(48, 160);
            return;
          }
          if (Math.abs(panX) > 1 || Math.abs(panY) > 1) {
            panX = 0;
            panY = 0;
            try { haptics.tap(); } catch { /* noop */ }
            note(41, 220);
            return;
          }
          return;
        }
        if (e.fingers === 3) { tutti(); return; }
        if (e.fingers !== 1) return; // anything else is gently absorbed
        const { x, y } = toLocal(e.x, e.y);
        const k = beadAt(x, y);
        // the site-wide rapid-tap ladder (tiers 1/3/5/n from tapTrainTier):
        // one rings a pulse (or a bead); three transforms a standing mass a
        // step denser, or on open fabric summons the next rarity in a fixed
        // cycle; five is the room's largest event — a real binary inspiral
        // and merger where two or more masses stand; n is the axis's
        // sustained crescendo, deepening continuously with the train
        const trainTier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (trainTier === "n") {
          tutti();
          firePulse(x, y, 1 + depth * 0.5);
          note(21, 340);
          try { haptics.bloom(); } catch { /* noop */ }
          return;
        }
        if (trainTier === 5) {
          // the room's biggest, rarest event: a real inspiral and merger
          // when two or more masses stand; otherwise the light itself is
          // caught into a closed orbit for a breath — lensing without a mass
          if (forceInspiral(x, y)) return;
          orbit = { x, y, omega: 3 + depth * 3, until: performance.now() + 2200 };
          firePulse(x, y, 0.5 + depth * 0.3);
          note(38, 220);
          try { haptics.ripple(0.5); } catch { /* noop */ }
          return;
        }
        if (trainTier === 3) {
          // on a standing mass: its own transformation — one step denser,
          // star to neutron star to black hole
          const m3 = massAt(x, y);
          if (m3 && !m3.evapAt) { collapseStage(m3); return; }
          // on open fabric: the next rarity in a fixed, deterministic cycle
          summonEmpty(x, y, e.intensity);
          return;
        }
        if (k >= 0) { chimeBead(k); return; }
        // a gravitational pulse — your ripple will race the light and lose
        firePulse(x, y, 0.5 + e.intensity * 0.8);
        note(33 + Math.round(e.intensity * 7), 200);
        try { haptics.ripple(0.3 + e.intensity * 0.4); } catch { /* noop */ }
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three fingers touch the law: time dilates — and here, of all
          // rooms, the light itself nearly stands still. Both keep deepening
          // for as long as the hold stands: 900ms and 2400ms differ.
          if (e.phase === "enter") {
            note(24, 500);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") { timeScaleTarget = 1; rayScaleTarget = 1; return; }
          timeScaleTarget = Math.max(0.15, 1 - 0.85 * Math.min(1, e.elapsed / 2000));
          rayScaleTarget = Math.max(0.04, 1 - 0.96 * Math.min(1, e.elapsed / 1800));
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          const k = beadAt(x, y);
          if (k >= 0) { hold.mode = "bead"; hold.beadIdx = k; hold.massId = null; }
          else {
            const m = massAt(x, y);
            if (m) { hold.mode = "mass"; hold.massId = m.id; hold.beadIdx = -1; }
            else { hold.mode = "fabric"; hold.massId = null; hold.beadIdx = -1; }
          }
          hold.placed = false;
          hold.done = false;
          return;
        }
        if (e.phase === "release") {
          if (hold.mode === "fabric" && hold.massId) {
            const m = masses.find((q) => q.id === hold.massId);
            if (m && !m.settled) settleMass(m);
          }
          if (hold.mode === "mass" && hold.massId) {
            const m = masses.find((q) => q.id === hold.massId);
            if (m) m.charge = 0;
          }
          if (hold.mode === "bead") { beadChargeIdx = -1; beadCharge = 0; }
          hold.mode = null;
          hold.massId = null;
          hold.beadIdx = -1;
          save();
          return;
        }
        // ticks
        if (hold.mode === "bead" && hold.beadIdx >= 0) {
          const band = SCALE_BANDS[hold.beadIdx];
          if (!band.route || band.route === "/manifold") {
            // an unbuilt room holds quietly; the room we're in swells a little
            beadSwell[hold.beadIdx] = Math.max(beadSwell[hold.beadIdx], 0.4);
            return;
          }
          beadChargeIdx = hold.beadIdx;
          beadCharge = clamp01((e.elapsed - 250) / 2250);
          const now = performance.now();
          if (beadCharge > 0.15 && now - lastChargeNoteAt > 420) {
            lastChargeNoteAt = now;
            tone(beadHz(band) * (1 + beadCharge * 0.06), 0.3);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.tier >= 3 && !hold.done) {
            hold.done = true;
            travelTo(band);
          }
          return;
        }
        if (hold.mode === "mass" && hold.massId) {
          const m = masses.find((q) => q.id === hold.massId);
          if (!m || m.evapAt) return;
          m.charge = clamp01((e.elapsed - 900) / 1600);
          const now = performance.now();
          if (m.charge > 0 && now - lastChargeNoteAt > 340) {
            lastChargeNoteAt = now;
            note(30 + Math.round(m.charge * 10), 100);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.tier >= 3 && !hold.done) {
            hold.done = true;
            hold.massId = null;
            evaporate(m);
          }
          return;
        }
        if (hold.mode === "fabric") {
          if (!hold.placed && e.tier >= 2) {
            // dwell on open fabric: a mass gathers — long-press means grow
            hold.placed = true;
            const m = placeMass(x, y, false);
            hold.massId = m.id;
          } else if (hold.placed && hold.massId) {
            const m = masses.find((q) => q.id === hold.massId);
            if (m && !m.settled) {
              m.growth = clamp01(m.growth + 0.0011 * 80 * (1 + e.intensity * 0.5));
              m.m = 0.5 + m.growth * 1.1;
              const now = performance.now();
              if (now - lastGrowNoteAt > 380) {
                lastGrowNoteAt = now;
                note(26 + Math.round(m.growth * 5), 140);
                try { haptics.tap(); } catch { /* noop */ }
              }
              if (m.growth >= 1) settleMass(m);
            } else if (m && m.settled && !m.evapAt) {
              // duration is an axis: past the settle the mass KEEPS gathering —
              // the well deepens, slower and lower, as long as the hand stays
              m.m = clamp(m.m + 0.0035 * (1 + e.intensity * 0.5), 0.4, 2.2);
              const now = performance.now();
              if (now - lastGrowNoteAt > 700) {
                lastGrowNoteAt = now;
                note(22 + Math.round(m.m * 2), 200);
                try { haptics.tap(); } catch { /* noop */ }
                staticRaysStale = true;
                dirty = true;
              }
            }
          }
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        if (e.fingers === 3) {
          // three fingers are the law: frame-dragging — the metric shears
          windTargetX = clamp(e.vx * 1.3, -1, 1);
          windTargetY = clamp(e.vy * 1.3, -1, 1);
          const now = performance.now();
          const mag = Math.hypot(windTargetX, windTargetY);
          if (mag > 0.5 && now - lastWindSoundAt > 520) {
            lastWindSoundAt = now;
            note(38 + Math.round(mag * 5), 260);
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1 || e.phase === "end") return;
        // one finger drags the fabric — a local pull that relaxes
        tugs.push({ x, y, dx: e.vx, dy: e.vy, strength: clamp(Math.hypot(e.vx, e.vy), 0.15, 1.6), born: performance.now() });
        if (tugs.length > 12) tugs.shift();
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.cx, e.cy);
        // a circling hand winds nearby light into closed orbits, briefly
        orbit = { x, y, omega: clamp(e.angularVelocity, -6, 6), until: performance.now() + 2600 };
        const now = performance.now();
        if (now - lastScrubSoundAt > 600) {
          lastScrubSoundAt = now;
          note(45 + Math.round(Math.min(6, Math.abs(e.winding))), 130);
          try { haptics.ripple(0.25); } catch { /* noop */ }
        }
      },
      drum: (e) => {
        lastInteractionAt = performance.now();
        // two hands pattering between two spots: each strike sends its own
        // slow wave, and the two zones speak in different registers — the
        // fold played as a drum, gravitational waves from alternating hands
        const { x, y } = toLocal(e.x, e.y);
        const a = toLocal(e.ax, e.ay);
        const b = toLocal(e.bx, e.by);
        const nearA = Math.hypot(x - a.x, y - a.y) <= Math.hypot(x - b.x, y - b.y);
        firePulse(x, y, 0.3 + e.alternation * 0.4);
        note(nearA ? 26 : 33, 100);
        try { haptics.tap(); } catch { /* noop */ }
      },
      twist: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three fingers on the law: turn the season wheel by hand —
          // enough turning steps the season; the crossing detector answers
          if (e.phase === "move") {
            seasonTwistAcc += e.angle;
            while (seasonTwistAcc > 0.6) { seasonTwistAcc -= 0.6; shiftSeason(1); }
            while (seasonTwistAcc < -0.6) { seasonTwistAcc += 0.6; shiftSeason(-1); }
          } else if (e.phase === "end") {
            seasonTwistAcc = 0;
          }
          return; // the lens answers two fingers only
        }
        // two fingers rotate the lens: the felt fabric ↔ the bare metric
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            markLens(snapped === 1);
            staticRaysStale = true; // stilled rays follow the lens too
            try { haptics.lens(); } catch { /* noop */ }
            if (snapped === 1) { try { audio().chime(); } catch { /* noop */ } }
            else note(48, 160);
          }
          lensTarget = snapped;
        }
      },
      pan2: (e) => {
        lastInteractionAt = performance.now();
        // two fingers pan the frame — the fold hangs beyond the glass, so
        // the whole scene slides depth-layered under the same parallax the
        // vessel's tilt already drives
        panX = clamp(panX + e.dx, -PAN_LIMIT, PAN_LIMIT);
        panY = clamp(panY + e.dy, -PAN_LIMIT, PAN_LIMIT);
        const now = performance.now();
        if (now - lastPanSoundAt > 260) {
          lastPanSoundAt = now;
          const reach = Math.hypot(panX, panY) / PAN_LIMIT;
          note(30 + Math.round(reach * 8), 90);
        }
      },
    });

    // ————— the vessel: the device is the fold's body (grammar §5) —————
    // Subscribed passively — nothing flows until the candle has invited the
    // senses. Tilt = move around the manifold gyroscopically (the parallax
    // targets the loop smooths); shake = a gravitational tremor. Handlers
    // only assign targets and fire debounced one-shots — always cheap.
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduce) { parTX = 0; parTY = 0; return; }
        const nx = clamp(gamma / 28, -1, 1);
        const ny = clamp((beta - 35) / 28, -1, 1); // rest angle ≈ a held phone
        const vel = Math.hypot(nx - parTX, ny - parTY);
        parTX = nx;
        parTY = ny;
        // a fast attitude change: the fold answers with the faintest low word
        const now = performance.now();
        if (vel > 0.16 && now - lastTiltSoundAt > 800) {
          lastTiltSoundAt = now;
          note(26 + Math.round(Math.hypot(nx, ny) * 4), 110);
        }
      },
      shake: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // a gravitational tremor: one soft wave through the whole fabric
        firePulse(width * 0.5, height * 0.45, 0.6 + intensity * 0.6);
        note(24, 380);
        try { haptics.ripple(0.35 + intensity * 0.4); } catch { /* noop */ }
      },
      knock: ({ intensity }) => {
        const now = performance.now();
        if (now - knockAt < 420) return;
        knockAt = now;
        lastInteractionAt = now;
        // a rap on the case rings the whole fold — a strong pulse from
        // dead center, sharper and colder than the hand's own tap
        firePulse(width * 0.5, height * 0.5, 0.9 + intensity * 0.6);
        note(21 + Math.round(intensity * 6), 260);
        try { haptics.roll(); } catch { /* noop */ }
        useField.getState().recordTape("object", 0.4 + intensity * 0.4, "manifold/knock");
      },
      flip: ({ faceDown }) => {
        nightTarget = faceDown ? 1 : 0;
        lastInteractionAt = performance.now();
        note(faceDown ? 19 : 33, 420);
        try { haptics.roll(); } catch { /* noop */ }
        useField.getState().recordTape("sigil", faceDown ? 0.25 : 0.45, faceDown ? "manifold/night" : "manifold/wake");
      },
    });

    // ————— keyboard dialect (same verbs, quieter) —————
    const onKeyDown = (ev: KeyboardEvent) => {
      const step = 0.05;
      if (ev.key === "[" || ev.key === "]") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        const dir = ev.key === "]" ? 1 : -1;
        beadSel = ((beadSel < 0 ? (dir > 0 ? -1 : 0) : beadSel) + dir + SCALE_BANDS.length) % SCALE_BANDS.length;
        cursorVisible = false;
        chimeBead(beadSel, true);
        return;
      }
      if (ev.key === "Escape") { beadSel = -1; return; }
      if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        beadSel = -1;
        cursorVisible = true;
        if (ev.key === "ArrowLeft") cursorNx = clamp(cursorNx - step, 0.05, 0.95);
        if (ev.key === "ArrowRight") cursorNx = clamp(cursorNx + step, 0.05, 0.95);
        if (ev.key === "ArrowUp") cursorNy = clamp(cursorNy - step, 0.08, 0.95);
        if (ev.key === "ArrowDown") cursorNy = clamp(cursorNy + step, 0.08, 0.95);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (beadSel >= 0) {
          if (!ev.repeat) travelTo(SCALE_BANDS[beadSel]);
          return;
        }
        if (!cursorVisible) { cursorVisible = true; return; }
        const x = cursorNx * width;
        const y = cursorNy * height;
        const m = massAt(x, y);
        if (m) {
          // held Enter repeats — the keyboard's ceremony
          if (kbMassId !== m.id) { kbMassId = m.id; kbCharge = 0; }
          kbCharge = clamp01(kbCharge + (ev.repeat ? 0.09 : 0.02));
          m.charge = kbCharge;
          const now = performance.now();
          if (now - lastChargeNoteAt > 340) {
            lastChargeNoteAt = now;
            note(30 + Math.round(kbCharge * 10), 100);
          }
          if (kbCharge >= 1) {
            kbCharge = 0;
            kbMassId = null;
            evaporate(m);
          }
        } else if (!ev.repeat) {
          placeMass(x, y, true);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        const m = masses.find((q) => q.id === kbMassId);
        if (m) m.charge = 0;
        kbCharge = 0;
        kbMassId = null;
      }
    };
    const onFocus = () => { focused = true; };
    const onBlur = () => { focused = false; cursorVisible = false; beadSel = -1; save(true); };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);
    wrap.addEventListener("focus", onFocus);
    wrap.addEventListener("blur", onBlur);
    const onVis = () => { if (document.visibilityState === "hidden") save(true); };
    document.addEventListener("visibilitychange", onVis);

    // ————— field geometry —————
    /** Mesh displacement at a point: mass welling + pulse rings + tugs + shear. */
    const dispAt = (x: number, y: number, pts: MassPoint[], now: number): { dx: number; dy: number } => {
      let dx = 0;
      let dy = 0;
      const felt = 1 - lens;
      if (felt <= 0.01) return { dx: 0, dy: 0 };
      for (const p of pts) {
        const ddx = p.x - x;
        const ddy = p.y - y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < 1) continue;
        const s2 = 70 * 70;
        const f = (26 * p.m * s2) / (d2 + s2) / Math.sqrt(d2);
        dx += ddx * f;
        dy += ddy * f;
      }
      for (const p of pulses) {
        const age = lightT - p.bornLight;
        const rf = age * lightSpeed;
        const prog = clamp01(rf / (Math.max(width, height) * 1.2));
        const ddx = x - p.x;
        const ddy = y - p.y;
        const d = Math.hypot(ddx, ddy);
        if (d < 1) continue;
        const g = Math.exp(-((d - rf) * (d - rf)) / (2 * 30 * 30));
        const amp = 11 * p.strength * (1 - prog) * g;
        dx += (ddx / d) * amp;
        dy += (ddy / d) * amp;
      }
      for (const t of tugs) {
        const age = (now - t.born) / 900;
        if (age >= 1) continue;
        const d2 = (x - t.x) * (x - t.x) + (y - t.y) * (y - t.y);
        const k = Math.exp(-d2 / (140 * 140)) * (1 - age) * t.strength * 26;
        dx += t.dx * k;
        dy += t.dy * k;
      }
      dx += windX * ((y / height) - 0.5) * 90;
      dy += windY * ((x / width) - 0.5) * 90;
      return { dx: dx * felt, dy: dy * felt };
    };

    /** The filament: a woven thread in the felt view, a ruler under the lens. */
    const pad = () => Math.max(24, width * 0.07);
    const wovenPoint = (u: number, pts: MassPoint[], now: number) => {
      const breathe = reduce ? 0 : Math.sin(localT * 0.9 + u * 4) * 0.012;
      const x = pad() * 0.5 + u * (width - pad());
      const y = height * (0.58 + 0.14 * Math.sin(u * Math.PI * 2.2 + 0.6) + 0.045 * Math.sin(u * Math.PI * 5.3 + 1.9) + breathe);
      const d = dispAt(x, y, pts, now);
      return { x: x + d.dx * 0.6, y: y + d.dy * 0.6 };
    };
    const rulerX = (s: number) => {
      const lo = SCALE_BANDS[0].sMin;
      const hi = SCALE_BANDS[SCALE_BANDS.length - 1].sMax;
      return pad() + ((s - lo) / (hi - lo)) * (width - pad() * 2);
    };
    const rulerY = () => height * 0.84;

    // ————— seasons of the law — the metric's own weather —————
    // The field turns through four regimes on its own slow clock: the
    // familiar pull, then a swirling frame-drag, then expansion, then a
    // brief spell of the fold's far side where gravity pushes. Nothing
    // is asked of the hand; the room simply does not sit still. Every
    // gesture keeps its meaning inside whichever season is blowing, and
    // the speed of light holds through all four (tested).
    const SEASON_SPANS: Array<{ s: LawSeason; ms: number }> = [
      { s: "attract", ms: 75000 },
      { s: "drag", ms: 45000 },
      { s: "expand", ms: 45000 },
      { s: "repel", ms: 25000 },
    ];
    const SEASON_CYCLE = SEASON_SPANS.reduce((acc, sp) => acc + sp.ms, 0);
    const seasonEpoch = performance.now();
    // the wheel can also be turned by hand: the shift is the hand's standing
    // adjustment to the clock, the accumulator its unfinished turning
    let seasonShiftMs = 0;
    let seasonTwistAcc = 0;
    const seasonAt = (nowMs: number): LawSeason => {
      let tt = (((nowMs - seasonEpoch + seasonShiftMs) % SEASON_CYCLE) + SEASON_CYCLE) % SEASON_CYCLE;
      for (const span of SEASON_SPANS) {
        if (tt < span.ms) return span.s;
        tt -= span.ms;
      }
      return "attract";
    };
    // three fingers on the law: turn the season wheel by hand — the clock
    // jumps to the next span's start (or back to the previous span's), and
    // the draw loop's own crossing detector answers with the note, the
    // touch, and the veil on the next frame. No signal is doubled here.
    const shiftSeason = (dir: 1 | -1) => {
      const nowMs = performance.now();
      const t = (((nowMs - seasonEpoch + seasonShiftMs) % SEASON_CYCLE) + SEASON_CYCLE) % SEASON_CYCLE;
      let start = 0;
      let idx = 0;
      for (let i = 0; i < SEASON_SPANS.length; i++) {
        if (t < start + SEASON_SPANS[i].ms) { idx = i; break; }
        start += SEASON_SPANS[i].ms;
      }
      const target = dir > 0
        ? start + SEASON_SPANS[idx].ms
        : start - SEASON_SPANS[(idx - 1 + SEASON_SPANS.length) % SEASON_SPANS.length].ms;
      seasonShiftMs += target - t;
    };
    let currentSeason: LawSeason = "attract";
    const SEASON_NOTE: Record<LawSeason, number> = { attract: 26, drag: 33, expand: 21, repel: 29 };
    const SEASON_WASH: Record<LawSeason, string | null> = {
      attract: null,
      drag: "rgba(150, 120, 220, 0.050)",
      expand: "rgba(90, 140, 190, 0.050)",
      repel: "rgba(210, 120, 70, 0.045)",
    };
    /** Expansion's outward term, px/s² per px from the frame's center. */
    const HUBBLE_PX = 0.02;

    /** Reduced motion: light as a few still geodesic curves, bent honestly
     *  (and straightened when the lens shows the bare metric). */
    const rebuildStaticRays = (pts: MassPoint[]) => {
      staticRaysStale = false;
      staticRayPaths = [];
      const dt = 1 / 120;
      const gEff = rayG * (1 - lensSnapped);
      for (let i = 0; i < 5; i++) {
        const y0 = height * (0.15 + 0.7 * (i / 4));
        let r: Ray = { x: -10, y: y0, vx: lightSpeed, vy: 0 };
        const path = [{ x: r.x, y: r.y }];
        for (let s = 0; s < 420; s++) {
          r = seasonGeodesicStep(
            currentSeason, pts, r, dt, lightSpeed, gEff, SOFTENING,
            width / 2, height / 2, HUBBLE_PX * (1 - lensSnapped),
          );
          // the fold holds even stilled light: rim streams curl, never exit
          if (lensSnapped === 0) {
            r = rimSteerRay(r, width / 2, height / 2, width / 2, height / 2, dt, lightSpeed);
          }
          path.push({ x: r.x, y: r.y });
          if (r.x < -40 || r.x > width + 40 || r.y < -40 || r.y > height + 40) break;
        }
        staticRayPaths.push(path);
      }
    };

    // ————— the loop —————
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tier = gov.beginFrame(now);
      if (sleeping || galleryPaused) return; // no draw while hidden or embedded-paused
      if (!reduce && now - lastFrame < 30) return;
      lastFrame = now;
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;
      const detail = detailForTier(tier);

      // the season turns on its own; the room marks the crossing once —
      // a low note, a touch, the still rays re-bent under the new law
      const seasonNow = seasonAt(now);
      if (seasonNow !== currentSeason) {
        currentSeason = seasonNow;
        staticRaysStale = true;
        note(SEASON_NOTE[currentSeason], 700);
        try { haptics.tap(); } catch { /* noop */ }
      }

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      rayScale += (rayScaleTarget - rayScale) * Math.min(1, dt * 5);
      if (!reduce) localT += dt * timeScale;
      // the Hubble breath rides the dilatable clock: three fingers slow the
      // expansion too, and reduced motion freezes a(t) entirely
      if (!reduce) expT += dt * timeScale;
      lightT += dt * (reduce ? 1 : rayScale);
      windX += (windTargetX - windX) * Math.min(1, dt * 2.2);
      windY += (windTargetY - windY) * Math.min(1, dt * 2.2);
      windTargetX *= Math.exp(-dt * 0.5);
      windTargetY *= Math.exp(-dt * 0.5);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      // gyroscopic parallax eases toward the tilt target — opposite the
      // lean, because the fold hangs beyond the glass and the glass slides
      const parGoalX = (reduce ? 0 : -parTX * PAR_MAX) + panX;
      const parGoalY = (reduce ? 0 : -parTY * PAR_MAX) + panY;
      parX += (parGoalX - parX) * Math.min(1, dt * 5);
      parY += (parGoalY - parY) * Math.min(1, dt * 5);
      night += (nightTarget - night) * Math.min(1, dt * 2.4);

      // the law between the masses runs whether or not a hand is present —
      // this is what makes the fold alive at rest, not merely decorated
      if (!reduce) stepMassPhysics(dt);

      const pts = livePoints();

      // masses: growth settles on its own if the hand wanders; charges decay
      for (let i = masses.length - 1; i >= 0; i--) {
        const m = masses[i];
        if (m.evapAt && now - m.evapAt > EVAP_MS) { masses.splice(i, 1); dirty = true; continue; }
        if (!hold.massId || hold.massId !== m.id) {
          if (kbMassId !== m.id) m.charge = Math.max(0, m.charge - dt * 1.6);
        }
      }
      for (let i = tugs.length - 1; i >= 0; i--) if (now - tugs[i].born > 900) tugs.splice(i, 1);
      for (let i = pulses.length - 1; i >= 0; i--) {
        if ((lightT - pulses[i].bornLight) * lightSpeed > Math.max(width, height) * 1.35) pulses.splice(i, 1);
      }
      if (orbit && now > orbit.until) orbit = null;
      for (let k = 0; k < beadSwell.length; k++) beadSwell[k] = Math.max(0, beadSwell[k] - dt * 1.4);
      if (beadChargeIdx >= 0 && hold.mode !== "bead") { beadChargeIdx = -1; beadCharge = 0; }

      // ————— background: ink, with the faintest cold breath —————
      ctx.fillStyle = bgGradient ?? "#04060b";
      ctx.fillRect(0, 0, width, height);
      // the season's veil — the same room in a different weather of law,
      // gone entirely when the lens shows the bare metric
      const wash = SEASON_WASH[currentSeason];
      if (wash && lens < 1) {
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, width, height);
      }
      const breathA = reduce ? 0.05 : 0.04 + Math.sin(localT * Math.PI * 2 * 0.14) * 0.015;
      const halo = ctx.createRadialGradient(width * 0.5, height * 0.42, 20, width * 0.5, height * 0.42, Math.max(width, height) * 0.8);
      halo.addColorStop(0, `rgba(120, 150, 210, ${breathA + lens * 0.02})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      // ————— the fold at the edges: the fabric closes on itself —————
      const cxv = width / 2;
      const cyv = height / 2;
      const foldMix = 1 - lens; // the lens flattens the fold away
      const foldXY = (x: number, y: number): { x: number; y: number } => {
        if (foldMix <= 0.02) return { x, y };
        const f = foldPoint(x, y, cxv, cyv, cxv, cyv);
        return { x: mix(x, f.x, foldMix), y: mix(y, f.y, foldMix) };
      };

      // ————— the field grid: one displacement pass shared by mesh and web —————
      // scaled by the frame governor's tier — a busy low-tier frame walks a
      // sparser lattice rather than starving the rest of the room
      const meshGap = MESH_GAP / Math.max(0.4, detail.samples);
      const cols = Math.ceil(width / meshGap) + 1;
      const rows = Math.ceil(height / meshGap) + 1;
      const cellCount = cols * rows;
      if (cellCount > meshCap) {
        meshCap = cellCount;
        vxBuf = new Float64Array(meshCap);
        vyBuf = new Float64Array(meshCap);
        dispXBuf = new Float64Array(meshCap);
        dispYBuf = new Float64Array(meshCap);
      }
      const vx = vxBuf;
      const vy = vyBuf;
      const dispX = dispXBuf;
      const dispY = dispYBuf;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = i * meshGap;
          const y = j * meshGap;
          const d = dispAt(x, y, pts, now);
          const idx = j * cols + i;
          dispX[idx] = d.dx;
          dispY[idx] = d.dy;
          const fp = foldXY(x + d.dx, y + d.dy);
          vx[idx] = fp.x;
          vy[idx] = fp.y;
        }
      }
      /** Bilinear sample of the mesh's displacement field — the web deforms
       *  with the same fabric for the cost of four reads. */
      const sampleDisp = (x: number, y: number): { dx: number; dy: number } => {
        const gx = clamp(x / meshGap, 0, cols - 1.001);
        const gy = clamp(y / meshGap, 0, rows - 1.001);
        const i0 = Math.floor(gx);
        const j0 = Math.floor(gy);
        const fx = gx - i0;
        const fy = gy - j0;
        const i1 = Math.min(i0 + 1, cols - 1);
        const j1 = Math.min(j0 + 1, rows - 1);
        const a00 = j0 * cols + i0;
        const a10 = j0 * cols + i1;
        const a01 = j1 * cols + i0;
        const a11 = j1 * cols + i1;
        return {
          dx: (dispX[a00] * (1 - fx) + dispX[a10] * fx) * (1 - fy) + (dispX[a01] * (1 - fx) + dispX[a11] * fx) * fy,
          dy: (dispY[a00] * (1 - fx) + dispY[a10] * fx) * (1 - fy) + (dispY[a01] * (1 - fx) + dispY[a11] * fx) * fy,
        };
      };

      // ————— the cosmic web: the fabric's grain, breathing apart —————
      if (webLayers.length === 2 && lens < 0.96) {
        ctx.save();
        ctx.translate(parX * PAR_WEB, parY * PAR_WEB); // the deepest layer drifts least
        const aNow = scaleFactor(expT);
        const la = Math.log(aNow) / Math.log(WRAP);
        const epoch = Math.floor(la);
        const uWrap = la - epoch;
        const webFade = 1 - lens;
        for (const pass of [0, 1]) {
          const layer = webLayers[(epoch + pass) & 1];
          const s = Math.pow(WRAP, uWrap - pass);
          const alpha = (pass === 0 ? 1 - uWrap : uWrap) * webFade;
          if (alpha <= 0.03) continue;
          // comoving → physical: expansion about the view center, tempered
          // where a mass binds its neighborhood; then the shared field;
          // then the fold — one fabric, three laws deep
          const tp = (qx: number, qy: number): { x: number; y: number } => {
            const px = cxv + (qx - cxv) * s;
            const py = cyv + (qy - cyv) * s;
            const b = pts.length > 0 ? boundFraction(pts, px, py) : 0;
            const e = 1 + (s - 1) * (1 - b);
            const x = cxv + (qx - cxv) * e;
            const y = cyv + (qy - cyv) * e;
            const d = sampleDisp(x, y);
            return foldXY(x + d.dx * WEB_DISP, y + d.dy * WEB_DISP);
          };
          // filaments: hairline parchment over near-black — grain, not decoration
          ctx.strokeStyle = `rgba(233, 210, 168, ${0.05 * alpha})`;
          ctx.lineWidth = 0.55;
          ctx.beginPath();
          const V = layer.verts;
          const per = (WEB_SUB + 1) * 2;
          for (let li = 0; li < layer.linkCount; li++) {
            const base = li * per;
            for (let k = 0; k <= WEB_SUB; k++) {
              const p = tp(V[base + k * 2], V[base + k * 2 + 1]);
              if (k === 0) ctx.moveTo(p.x, p.y);
              else ctx.lineTo(p.x, p.y);
            }
          }
          ctx.stroke();
          // nodes: where filaments meet, a breath brighter
          ctx.fillStyle = `rgba(238, 216, 176, ${0.11 * alpha})`;
          for (let k = 0; k < layer.nodes.length; k += 2) {
            const p = tp(layer.nodes[k], layer.nodes[k + 1]);
            ctx.fillRect(p.x - 0.7, p.y - 0.7, 1.4, 1.4);
          }
          // galaxy motes: sub-pixel warm points along the filaments, batched
          const M = layer.motes;
          for (const bucket of [0, 1]) {
            ctx.fillStyle =
              bucket === 0
                ? `rgba(240, 218, 178, ${0.2 * alpha})`
                : `rgba(236, 212, 172, ${0.1 * alpha})`;
            const sz = bucket === 0 ? 1.3 : 0.9;
            for (let k = 0; k < M.length; k += 3) {
              if ((M[k + 2] >= 0.45) !== (bucket === 0)) continue;
              const p = tp(M[k], M[k + 1]);
              ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
            }
          }
        }
        ctx.restore();
      }

      // ————— the mesh: hairlines of the metric —————
      ctx.save();
      ctx.translate(parX * PAR_MESH, parY * PAR_MESH);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = `rgba(206, 222, 250, ${0.055 + lens * 0.05})`;
      ctx.beginPath();
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const idx = j * cols + i;
          if (i === 0) ctx.moveTo(vx[idx], vy[idx]);
          else ctx.lineTo(vx[idx], vy[idx]);
        }
      }
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const idx = j * cols + i;
          if (j === 0) ctx.moveTo(vx[idx], vy[idx]);
          else ctx.lineTo(vx[idx], vy[idx]);
        }
      }
      ctx.stroke();
      ctx.restore();

      // ————— masses: unlit presences the fabric wells around —————
      ctx.save();
      ctx.translate(parX * PAR_MASS, parY * PAR_MASS);
      let fieldMassCount = 0;
      for (const m of masses) {
        const rawX = m.nx * width;
        const rawY = m.ny * height;
        const mfold = foldXY(rawX, rawY);
        const mx = mfold.x;
        const my = mfold.y;
        const grow = m.settled ? 1 : 0.3 + 0.7 * m.growth;
        // the collapse ladder compacts the same mass into a smaller,
        // denser presence — a neutron star reads tight and hard-rimmed, a
        // black hole tighter still, with a violet rather than cold-blue rim
        let R = (10 + m.m * 16) * grow * STAGE_COMPACTION[m.stage];
        let evapP = 0;
        if (m.evapAt) {
          evapP = clamp01((now - m.evapAt) / EVAP_MS);
          R *= 1 - evapP * 0.85;
        }
        // the well's shadow deepens the ink (physics reads the unfolded field)
        // — a cached sprite blitted with drawImage, never a per-mass gradient
        const depth = wellDepth(pts, rawX, rawY, SOFTENING);
        const shadeAlpha = 0.5 * (1 - evapP);
        if (shadeAlpha > 0.01) {
          ctx.globalAlpha = shadeAlpha;
          ctx.drawImage(shadowSprite, mx - R * 3.2, my - R * 3.2, R * 6.4, R * 6.4);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = `rgba(2, 3, 6, ${(0.92 - depth * 0.1) * (1 - evapP)})`;
        ctx.beginPath();
        ctx.arc(mx, my, R, 0, Math.PI * 2);
        ctx.fill();
        // a thin rim — cold blue for a star, pale for a neutron star, a
        // violet horizon for a black hole
        const rimColor = m.stage === 2 ? "192, 150, 255" : m.stage === 1 ? "205, 220, 245" : "150, 175, 225";
        ctx.strokeStyle = `rgba(${rimColor}, ${(m.settled ? 0.13 : 0.3) + m.stage * 0.09 * (1 - evapP)})`;
        ctx.lineWidth = m.settled ? 0.8 : 1.2;
        ctx.beginPath();
        ctx.arc(mx, my, R, 0, Math.PI * 2);
        ctx.stroke();
        // a black hole keeps a second, wider ring — the photon sphere
        if (m.stage === 2 && !m.evapAt) {
          ctx.strokeStyle = `rgba(231, 172, 82, ${0.22 * (1 - evapP)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(mx, my, R * 1.55, 0, Math.PI * 2);
          ctx.stroke();
        }
        // collapse charge: a warm arc closing around the presence
        if (m.charge > 0 && !m.evapAt) {
          ctx.strokeStyle = `rgba(231, 172, 82, ${0.25 + m.charge * 0.5})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(mx, my, R + 7, -Math.PI / 2, -Math.PI / 2 + m.charge * Math.PI * 2);
          ctx.stroke();
        }
        // the slow flash of evaporation — cached sprite, not a fresh gradient
        if (m.evapAt) {
          const flare = Math.sin(evapP * Math.PI);
          const fr = R + evapP * 90;
          if (flare > 0.01) {
            ctx.globalAlpha = flare;
            ctx.drawImage(flashSprite, mx - fr, my - fr, fr * 2, fr * 2);
            ctx.globalAlpha = 1;
          }
        }
        // feed the shared curvature field (WebGL, drawn after this pass) —
        // reusing the fixed-size buffer below, never allocating in the loop
        if (fieldMassCount < fieldMasses.length) {
          const fm = fieldMasses[fieldMassCount++];
          fm.x = mx; fm.y = my; fm.r = R;
          fm.strength = clamp01(m.m / 2.2) * (1 - evapP);
        }
      }
      for (let k = fieldMassCount; k < fieldMasses.length; k++) fieldMasses[k].strength = 0;

      ctx.restore();

      // ————— the curvature field: additive lensing ring, WebGL —————
      // one shader pass sums every live mass's ring at once — the field
      // fidelity upgrade (SPEC fix 2), shared verbatim with RelativityRoom.
      if (field?.ok) {
        field.draw(now, fieldMasses, {
          core: [0.62, 0.75, 0.98],
          ring: [0.78, 0.86, 1.0],
          alpha: (1 - lens) * 0.8,
          reduced: reduce,
        });
      }

      // ————— pulses: your ripple, racing the light at its own speed —————
      ctx.save();
      ctx.translate(parX * PAR_PULSE, parY * PAR_PULSE);
      for (const p of pulses) {
        const rf = (lightT - p.bornLight) * lightSpeed;
        const prog = clamp01(rf / (Math.max(width, height) * 1.2));
        if (rf < 2) continue;
        ctx.strokeStyle = `rgba(190, 210, 245, ${0.2 * p.strength * (1 - prog) * (1 - lens * 0.6)})`;
        ctx.lineWidth = 1;
        const pf = foldXY(p.x, p.y);
        ctx.beginPath();
        ctx.arc(pf.x, pf.y, rf, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // ————— light: few rays, racing, bending hard —————
      const dilated = rayScale < 0.5;
      // under the lens the metric goes bare: geodesics become straight rays
      const gEff = rayG * (1 - lens);
      if (!reduce) {
        const stepDt = (dt * rayScale) / 4;
        for (const r of rays) {
          for (let s = 0; s < 4; s++) {
            const st = seasonGeodesicStep(
              currentSeason, pts, r, stepDt, lightSpeed, gEff, SOFTENING,
              width / 2, height / 2, HUBBLE_PX * (1 - lens),
            );
            r.x = st.x; r.y = st.y; r.vx = st.vx; r.vy = st.vy;
            // frame-dragging: the wind leans on the light too (then the
            // step's renormalization keeps the speed limit honest)
            if (windX !== 0 || windY !== 0) {
              r.vx += windX * lightSpeed * 0.5 * stepDt;
              r.vy += windY * lightSpeed * 0.5 * stepDt;
              const sp = Math.hypot(r.vx, r.vy);
              if (sp > 0) { r.vx *= lightSpeed / sp; r.vy *= lightSpeed / sp; }
            }
            // a circling hand winds nearby light into a closed orbit
            if (orbit) {
              const ox = r.x - orbit.x;
              const oy = r.y - orbit.y;
              const od = Math.hypot(ox, oy);
              if (od > 8 && od < 190) {
                const sgn = orbit.omega >= 0 ? 1 : -1;
                const tx = (-oy / od) * sgn;
                const ty = (ox / od) * sgn;
                const k = Math.min(1, 6 * stepDt * Math.abs(orbit.omega));
                r.vx = mix(r.vx, tx * lightSpeed, k);
                r.vy = mix(r.vy, ty * lightSpeed, k);
                const sp = Math.hypot(r.vx, r.vy);
                if (sp > 0) { r.vx *= lightSpeed / sp; r.vy *= lightSpeed / sp; }
              }
            }
            // the fold: light that reaches the rim follows the boundary
            // curvature back inward — steered, renormalized, still exactly c
            if (lens < 0.9) {
              const st2 = rimSteerRay(
                { x: r.x, y: r.y, vx: r.vx, vy: r.vy },
                cxv, cyv, cxv, cyv,
                stepDt, lightSpeed, 9 * (1 - lens),
              );
              r.vx = st2.vx;
              r.vy = st2.vy;
            }
          }
          // doppler tint: falling in leans blue, climbing out leans red
          const a = seasonAccelAt(
            currentSeason, pts, r.x, r.y, gEff, SOFTENING,
            width / 2, height / 2, HUBBLE_PX * (1 - lens),
          );
          const am = Math.hypot(a.ax, a.ay);
          let w = 0;
          if (am > 1) {
            const proj = (r.vx * a.ax + r.vy * a.ay) / (am * lightSpeed);
            w = clamp(proj * wellDepth(pts, r.x, r.y, SOFTENING) * 6, -1, 1);
          }
          r.trail.push({ x: r.x, y: r.y, w });
          if (r.trail.length > TRAIL_MAX) r.trail.shift();

          // capture: light that falls in is kept
          let captured = false;
          for (const p of pts) {
            if (Math.hypot(r.x - p.x, r.y - p.y) < 11) { captured = true; break; }
          }
          // escape is measured in rim coordinates: steered light rides the
          // fold band (u up to ~1.4) without being recycled mid-curl; only
          // truly departed rays (straight lens-view exits) respawn
          const uRay = Math.hypot((r.x - cxv) / cxv, (r.y - cyv) / cyv);
          const gone = uRay > 1.7;
          if (captured || gone) {
            if (captured && now - lastCaptureSoundAt > 2000) {
              lastCaptureSoundAt = now;
              note(28, 180);
            }
            const fresh = spawnRay();
            r.x = fresh.x; r.y = fresh.y; r.vx = fresh.vx; r.vy = fresh.vy;
            r.trail.length = 0;
          }
        }

        // draw: long fading tails, luminous heads
        ctx.save();
        ctx.translate(parX * PAR_RAY, parY * PAR_RAY);
        ctx.globalCompositeOperation = "lighter";
        for (const r of rays) {
          const n = r.trail.length;
          let qPrev = n > 0 ? foldXY(r.trail[0].x, r.trail[0].y) : null;
          for (let i = 1; i < n; i++) {
            const p1 = r.trail[i];
            const q1 = foldXY(p1.x, p1.y);
            const f = i / n;
            const warm = p1.w < 0 ? -p1.w : 0;
            const cool = p1.w > 0 ? p1.w : 0;
            const rr = Math.round(mix(212, 255, warm) - cool * 60);
            const gg = Math.round(mix(226, 190, warm * 0.7) - cool * 30);
            const bb = Math.round(mix(255, 165, warm));
            ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${0.38 * f * f * (dilated ? 0.7 : 1)})`;
            ctx.lineWidth = 0.8 + f * 0.8;
            ctx.beginPath();
            ctx.moveTo((qPrev as { x: number; y: number }).x, (qPrev as { x: number; y: number }).y);
            ctx.lineTo(q1.x, q1.y);
            ctx.stroke();
            qPrev = q1;
          }
          if (n > 0) {
            const h = foldXY(r.trail[n - 1].x, r.trail[n - 1].y);
            // baked ray-head sprite replaces a per-ray createRadialGradient
            // (was one gradient per ray, every frame) — the sprite's 1.0
            // center carries the same rgba(240,246,255) tint, and 0.9 is
            // folded into globalAlpha for the head glow.
            const prev = ctx.globalAlpha;
            ctx.globalAlpha = prev * 0.9;
            ctx.drawImage(rayHeadSprite, h.x - 7, h.y - 7, 14, 14);
            ctx.globalAlpha = prev;
          }
        }
        ctx.restore();
      } else {
        // stilled streams: the same geodesics, held — curvature still legible
        if (staticRaysStale) rebuildStaticRays(pts);
        ctx.strokeStyle = "rgba(220, 232, 255, 0.16)";
        ctx.lineWidth = 0.8;
        for (const path of staticRayPaths) {
          ctx.beginPath();
          for (let i = 0; i < path.length; i++) {
            const p = foldXY(path[i].x, path[i].y);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
      }

      // ————— the twin beacons: gravity slowing time, watched —————
      {
        ctx.save();
        ctx.translate(parX * PAR_BEACON, parY * PAR_BEACON);
        // the twins' home positions are comoving: the Hubble breath carries
        // them apart (saturating, so the far twin never leaves the fold),
        // except where a placed mass binds its neighborhood still
        const aEff = scaleFactor(expT);
        const sBeacon = 1 + 0.9 * (1 - 1 / aEff);
        const bxA = width * (0.5 + 0.3 * Math.sin(localT * 0.045 + 1.3));
        const byA = height * (0.42 + 0.24 * Math.sin(localT * 0.036 + 0.4));
        const bxB = width * (0.5 + 0.42 * Math.sin(localT * 0.03 + 4.1));
        const byB = height * (0.15 + 0.03 * Math.sin(localT * 0.023 + 2.2));
        beaconSpots[0].x = bxA; beaconSpots[0].y = byA;
        beaconSpots[1].x = bxB; beaconSpots[1].y = byB;
        for (const { x: bx0, y: by0, i: bi } of beaconSpots) {
          const bBound = pts.length > 0 ? boundFraction(pts, bx0, by0) : 0;
          const eB = 1 + (sBeacon - 1) * (1 - bBound);
          const bxu = cxv + (bx0 - cxv) * eB;
          const byu = cyv + (by0 - cyv) * eB;
          const f = timeDilation(pts, bxu, byu, DIL_K, DIL_SOFT);
          const bfold = foldXY(bxu, byu);
          const bx = bfold.x;
          const by = bfold.y;
          if (!reduce) beaconPhase[bi] += dt * timeScale * Math.PI * 2 * 0.55 * f;
          const blink = reduce
            ? 0.35 + 0.5 * f
            : Math.pow(0.5 + 0.5 * Math.sin(beaconPhase[bi]), 3);
          const warmth = clamp01((1 - f) * 1.9);
          const rr = Math.round(mix(223, 255, warmth));
          const gg = Math.round(mix(233, 158, warmth));
          const bb = Math.round(mix(255, 106, warmth));
          const a = (0.2 + blink * 0.7) * (1 - lens * 0.5);
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, 13);
          g.addColorStop(0, `rgba(${rr}, ${gg}, ${bb}, ${a})`);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(bx, by, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, ${0.5 + blink * 0.5})`;
          ctx.beginPath();
          ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // ————— the filament: the album as one thread of twelve beads —————
      {
        const N = 84;
        ctx.save();
        ctx.translate(parX * PAR_THREAD, parY * PAR_THREAD); // the nearest layer drifts most
        // thread: warm faint underglow + fine bright line
        for (const pass of [0, 1]) {
          ctx.strokeStyle = pass === 0
            ? `rgba(231, 172, 82, ${0.05 + lens * 0.02})`
            : `rgba(240, 220, 180, ${0.16 + lens * 0.1})`;
          ctx.lineWidth = pass === 0 ? 3.4 : 0.8;
          ctx.beginPath();
          for (let i = 0; i <= N; i++) {
            const u = i / N;
            const wp = wovenPoint(u, pts, now);
            const rx = pad() + u * (width - pad() * 2);
            const tf = foldXY(mix(wp.x, rx, lens), mix(wp.y, rulerY(), lens));
            if (i === 0) ctx.moveTo(tf.x, tf.y);
            else ctx.lineTo(tf.x, tf.y);
          }
          ctx.stroke();
        }

        // ruler ticks + thin mono numerals — notation lives ONLY under the lens
        if (lens > 0.6) {
          const la = (lens - 0.6) / 0.4;
          ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
          ctx.textAlign = "center";
          for (const s of RULER_EDGES) {
            const x = rulerX(s);
            ctx.strokeStyle = `rgba(206, 222, 250, ${0.35 * la})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(x, rulerY() - 5);
            ctx.lineTo(x, rulerY() + 5);
            ctx.stroke();
            ctx.fillStyle = `rgba(206, 222, 250, ${0.5 * la})`;
            ctx.fillText(rulerLabel(s), x, rulerY() + 18);
          }
        }

        // beads: every band, in order, the axis floor to this room
        for (let k = 0; k < SCALE_BANDS.length; k++) {
          const band = SCALE_BANDS[k];
          const u = (k + 0.5) / SCALE_BANDS.length;
          const wp = wovenPoint(u, pts, now);
          const rx = rulerX((band.sMin + band.sMax) / 2);
          const bf = foldXY(mix(wp.x, rx, lens), mix(wp.y, rulerY(), lens));
          const x = bf.x;
          const y = bf.y;
          // hit tests live in screen space: fold the parallax into the record
          beadPos[k].x = x + parX * PAR_THREAD;
          beadPos[k].y = y + parY * PAR_THREAD;
          const built = !!band.route;
          const here = band.route === "/manifold";
          const swell = beadSwell[k];
          const breatheR = reduce ? 0 : Math.sin(localT * 0.9 + k * 0.7) * 0.35;
          const R = (built ? 3.4 : 2.4) + breatheR + swell * 4;
          if (built) {
            // candle-warm: a room that exists, heard from above.
            // Stamp the baked beadBuiltSprite instead of allocating a
            // per-bead createRadialGradient (was one gradient per bead,
            // every frame — 12 beads across the axis). The sprite's stops
            // match the old gradient's ramp; globalAlpha carries the swell.
            const R2 = R * (3 + swell * 2);
            const prev = ctx.globalAlpha;
            ctx.globalAlpha = prev * (0.5 + swell * 0.4);
            ctx.drawImage(beadBuiltSprite, x - R2, y - R2, R2 * 2, R2 * 2);
            ctx.globalAlpha = prev;
            ctx.fillStyle = `rgba(255, 232, 190, ${0.85 + swell * 0.15})`;
          } else {
            // ember-dim: a band the album holds open
            ctx.fillStyle = `rgba(122, 84, 52, ${0.4 + swell * 0.3})`;
          }
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.fill();
          if (here) {
            ctx.strokeStyle = "rgba(231, 172, 82, 0.4)";
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.arc(x, y, R + 4, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (beadSel === k) {
            ctx.strokeStyle = "rgba(242, 238, 230, 0.7)";
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.arc(x, y, R + 6.5, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (beadChargeIdx === k && beadCharge > 0) {
            // the road to travel: a ring closing around the bead
            ctx.strokeStyle = `rgba(231, 172, 82, ${0.35 + beadCharge * 0.55})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(x, y, R + 8, -Math.PI / 2, -Math.PI / 2 + beadCharge * Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // ————— the darkened rim: the closed fold that contains everything —————
      if (foldMix > 0.03) {
        ctx.save();
        ctx.translate(cxv, cyv);
        ctx.scale(cxv, cyv);
        const rim = ctx.createRadialGradient(0, 0, 0.7, 0, 0, 1.18);
        rim.addColorStop(0, "rgba(1, 2, 5, 0)");
        rim.addColorStop(0.62, `rgba(1, 2, 5, ${0.22 * foldMix})`);
        rim.addColorStop(1, `rgba(0, 1, 3, ${0.82 * foldMix})`);
        ctx.fillStyle = rim;
        ctx.fillRect(-1.4, -1.4, 2.8, 2.8);
        ctx.restore();
      }

      // glimmer — after quiet, a ring where a dwell would land (never text)
      const idleMs = now - lastInteractionAt;
      if (idleMs > 20000) {
        const slot = Math.floor(now / 9000);
        const gx = (0.22 + hash01(slot) * 0.56) * width;
        const gy = (0.16 + hash01(slot + 7) * 0.42) * height;
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        ctx.strokeStyle = `rgba(231, 172, 82, ${0.08 + pulse * 0.1})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gx, gy, 14 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // keyboard cursor
      if (focused && cursorVisible) {
        const cfold = foldXY(cursorNx * width, cursorNy * height);
        const cx = cfold.x;
        const cy = cfold.y;
        ctx.strokeStyle = "rgba(242, 238, 230, 0.7)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(231, 172, 82, 0.85)";
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // flip face-down: the room sleeps and the light goes out of it
      if (night > 0.004) {
        ctx.fillStyle = `rgba(2, 2, 6, ${(night * 0.92).toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }

      if (dirty && now - lastSaveAt > 800) save(true);
    };
    raf = requestAnimationFrame(draw);
    // no draw while hidden or paused inside a gallery iframe
    const offVis = onVisibility((hiddenNow) => {
      sleeping = hiddenNow;
      if (hiddenNow) save(true);
      if (!hiddenNow && !galleryPaused && !raf) raf = requestAnimationFrame(draw);
    });
    const offGallery = onGalleryPause((pausedNow) => {
      galleryPaused = pausedNow;
      if (!pausedNow && !sleeping && !raf) raf = requestAnimationFrame(draw);
    });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      detach();
      detachVessel();
      markLens(false);
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      wrap.removeEventListener("focus", onFocus);
      wrap.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      offVis();
      offGallery();
      mq.removeEventListener?.("change", onMq);
      field?.dispose();
      save(true);
    };
  }, [router]);

  return (
    <div className="manifold-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={wrapRef}
        className="manifold-field"
        role="application"
        tabIndex={0}
        aria-label="the manifold — every scale kept in one fold; rest a finger and a mass gathers, the light bends to meet it and your ripple races it; hold a warm bead through the long moment to travel there; arrows walk, enter sets a mass and, held, collapses it; brackets walk the thread, enter travels"
      >
        <canvas ref={canvasRef} className="manifold-canvas" aria-hidden="true" />
        <canvas ref={fieldCanvasRef} className="manifold-field-canvas" aria-hidden="true" />
      </div>
      <ScaleTravelOverlay ui={travelUi} />

      <LetGo label="unbend the fold" onLetGo={() => letGoRef.current()} visible={standing} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .manifold-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          background: #04060b;
          overflow: hidden;
        }

        .manifold-field {
          position: relative;
          min-height: 100svh;
          isolation: isolate;
          overflow: hidden;
          outline: none;
        }

        .manifold-field:focus-visible {
          outline: 2px solid rgba(231, 172, 82, 0.7);
          outline-offset: -2px;
        }

        body:has(.manifold-page) {
          overflow: hidden;
          background: #04060b;
        }

        body:has(.manifold-page) header:not(.oda-site-header) {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.manifold-page) .oda-field-watch,
        body:has(.manifold-page) .oda-candle-mark,
        body:has(.manifold-page) .oda-tape-shell,
        body:has(.manifold-page) .oda-sound-toggle {
          display: none !important;
        }

        .manifold-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          cursor: crosshair;
          touch-action: none;
          z-index: 0;
        }

        .manifold-field-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          pointer-events: none;
          z-index: 1;
        }
      ` }}
      />
    </div>
  );
}
