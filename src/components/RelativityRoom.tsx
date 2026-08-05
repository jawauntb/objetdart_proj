"use client";

/**
 * /relativity — the law itself, taught by hand in one continuous room.
 * The intimate counterpart to /manifold's cosmic overlook: where the fold
 * shows curvature from above, this room puts the covenant of light in
 * your fingers within two minutes, no words.
 *
 * Four phenomena share the space. Light is fast and nothing beats it:
 * rays cross at shooting-star speed, a tap rings a pulse at exactly c,
 * and a flick throws a matter comet that always lags its own launch
 * flash — harder flicks glow hotter instead of going faster (effort is
 * rapidity; energy diverges, speed doesn't). Motion slows time: two big
 * light clocks tick side by side, and dragging one stretches its
 * photon's path into diagonals at the same c, so its tick audibly and
 * visibly slows, recovering at rest. Gravity slows time: dwell plants a
 * mass (capped at four; the oldest evaporates), rays whip around the
 * well blue-in red-out, and of the twin drifting beacons the one caught
 * near a well blinks slower and warmer. Doppler: a grabbed lantern runs
 * blue ahead and red behind and its hum pitch-bends the same way.
 *
 * Three more phenomena complete the canonical set. Simultaneity: a long
 * translucent car glides on a quiet strip; tap its midpoint and one
 * flash splits toward both ends — the car blooms both ends in one
 * car-tinted moment, but the room's own strikes land rear-first, two
 * notes with a gap that widens with speed and closes to a single chord
 * at rest. Drag the car to set its speed (rapidity-capped like all
 * matter); the ghost outline it slides inside keeps its rest length, so
 * the moving car visibly fits short of its own ghost by exactly 1/γ —
 * and the flicked comets squash along their motion by the same law.
 * The twin reunion: flick the marked drifting beacon and it flies out,
 * arcs, and returns to its stay-at-home twin visibly younger — each
 * beacon accretes rings of its own proper time like tree rings, the
 * traveler comes home with fewer, and the reunion sounds as a two-note
 * chord detuned by exactly the age gap.
 *
 * Twist rotates the lens: the room re-renders as a minimal Minkowski
 * diagram — worldlines of clocks, comets, lantern, car and beacons;
 * tapped pulses as light cones at exactly 45°; the moving clock's tick
 * dots visibly sparser; the car's tilted simultaneity line against the
 * room's horizontal one with the two strikes straddling them; the
 * twin's bent worldline dropping fewer proper-time dots than the
 * stayer's straight one. Thin mono numerals appear only there.
 * Three-finger hold is this room's one legitimate slow-light moment:
 * time dilates and the light nearly stands still so its geometry — the
 * rear end catching its own flash included — can be seen.
 *
 * Pure math in src/lib/relativity.ts (tick dilation, matter cap, doppler,
 * simultaneity gap, proper time, contraction) and src/lib/manifold-field.ts
 * (bending, wells, gravitational dilation — reused, not rebuilt).
 * Deterministic throughout; no persistence — this room is a law, not a
 * place, and a law keeps no belongings.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import {
  SOFTENING,
  accelAt,
  geodesicStep,
  mergeBodies,
  ringdownEnvelope,
  stepMutualGravity,
  timeDilation,
  wellDepth,
  type MassPoint,
  type OrbitBody,
  type Ray,
} from "@/lib/manifold-field";
import {
  MATTER_CAP,
  contractedLength,
  dopplerShift,
  lorentzGamma,
  matterGlow,
  matterSpeed,
  properTimeRatio,
  simultaneityGapMs,
} from "@/lib/relativity";
import {
  resolveDpr,
  onGalleryPause,
  onVisibility,
  isEmbeddedFrame,
  createFrameGovernor,
  detailForTier,
} from "@/lib/room-runtime";
import { createGravityFieldRenderer, type GravityFieldRenderer } from "@/components/SpacetimeShader";
import LetGo from "@/components/LetGo";

const MAX_MASSES = 4;
const RAY_COUNT = 5;
const RAY_TRAIL = 26;
const EVAP_MS = 1600;
const MESH_GAP = 44;
const DIL_SOFT = 96; // wells read wide for clocks and beacons
const DIL_K = 4;
const MAX_COMETS = 7;
const MAX_PULSES = 8;
const MAX_RINGS = 9;
const HIST_MAX = 260;
const TICKS_MAX = 48;
const CLOCK_V_CAP = 0.95; // a carried clock's effective fraction of c
const RING_EVERY = 0.3; // lantern wavefront cadence, seconds of light time
const CAR_NY = 0.52; // the train's quiet strip
const CAR_H = 24; // car body height, px
const RING_TAU = 1.4; // seconds of proper time per accreted beacon ring
const RINGS_SHOWN = 12; // rings drawn before the oldest merge inward
const TDOT_TAU = 0.12; // proper-time tick spacing on lens worldlines
const REUNION_MS = 4000; // how long the twins compare rings side by side
/** Physics BETWEEN the masses: mutual gravity, tuned gentler than /manifold
 *  since this room's field is meant to be watched up close. */
const MUTUAL_G = 1000;
const MASS_SPEED_CAP = 180;
const MERGE_UNIT = 9;
const STAGE_COMPACTION: readonly number[] = [1, 0.68, 0.42];
const STAGE_MASS_GAIN: readonly number[] = [1, 1.7, 2.1];

type Mass = {
  id: string;
  nx: number;
  ny: number;
  m: number;
  plantedAt: number;
  growth: number;
  settled: boolean;
  charge: number;
  evapAt: number;
  /** px/s — a settled mass pulls its neighbors, and is pulled in turn. */
  vx: number;
  vy: number;
  /** 0 star, 1 neutron star, 2 black hole — double-tap collapses a step. */
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

type Comet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heat: number;
  born: number;
  trail: Array<{ x: number; y: number }>;
  hist: Array<{ x: number; tau: number }>;
};

type Ring = { x: number; y: number; bornLight: number; dx: number; dy: number; beta: number };

type Clock = {
  homeNx: number;
  homeNy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  dir: 1 | -1;
  held: boolean;
  targetX: number;
  targetY: number;
  vEff: number;
  flashTop: number;
  flashBot: number;
  lastNoteAt: number;
  photonTrail: Array<{ x: number; y: number }>;
  hist: Array<{ x: number; tau: number }>;
  ticks: Array<{ x: number; tau: number }>;
};

type Lantern = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  held: boolean;
  targetX: number;
  targetY: number;
  humOn: boolean;
  lastRingAt: number;
  hist: Array<{ x: number; tau: number }>;
};

type Current = { x: number; y: number; dx: number; dy: number; born: number };

type Orbit = { x: number; y: number; omega: number; until: number };

type Carried = "clockA" | "clockB" | "lantern" | "car" | null;

/** One flash from the car's midpoint, kept in room-frame coordinates. */
type SimFlash = {
  born: number; // lightT at emission
  x0: number; // emission point, fixed in the room
  y: number;
  sgn: 1 | -1; // direction of the car's motion at emission
  vAbs: number; // px/s at emission
  halfC: number; // contracted half-length at emission
  tRear: number; // seconds after born — the rear runs into its flash
  tFront: number; // — the front runs away from its flash
  rearX: number;
  frontX: number;
  rearDone: boolean;
  frontDone: boolean;
  carDone: boolean;
};

/** A beacon that keeps its own proper time as slowly accreted rings. */
type Beacon = {
  tau: number;
  nextTdot: number;
  x: number;
  y: number;
  beta: number;
  ringFlashAt: number;
  hist: Array<{ x: number; tau: number }>;
  tdots: Array<{ x: number; tau: number }>;
};

/** The traveler's journey: out, arc, home — computed whole at launch. */
type Journey = {
  t: number;
  T: number;
  beta: number;
  v: number;
  pts: Array<{ x: number; y: number }>;
  cum: number[];
  len: number;
  s: number;
  trail: Array<{ x: number; y: number }>;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** See ManifoldFold.tsx for the rationale — a radial falloff's shape is
 *  scale-invariant, so one cached sprite replaces every per-mass
 *  `createRadialGradient` call that only ever varied center/radius/alpha. */
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

export default function RelativityRoom() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fieldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const letGoRef = useRef<() => void>(() => {});
  // whether any mass currently wells the room — gates the quiet clear
  const [standing, setStanding] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const fieldCanvas = fieldCanvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // the shared curvature field (SpacetimeShader.tsx) — the same additive
    // lensing-ring pass ManifoldFold drives, unifying the two rooms' well
    // shading in one fragment shader instead of two duplicated CPU loops.
    const field: GravityFieldRenderer | null = fieldCanvas ? createGravityFieldRenderer(fieldCanvas, "glow") : null;
    const fieldMasses: Array<{ x: number; y: number; r: number; strength: number }> = Array.from(
      { length: MAX_MASSES },
      () => ({ x: 0, y: 0, r: 0, strength: 0 }),
    );

    // sprites for the per-mass falloffs that used to allocate a fresh
    // createRadialGradient every mass, every frame — see ManifoldFold for
    // the identical technique and rationale (a radial falloff's shape is
    // scale-invariant; one sprite blitted with drawImage stands in for all).
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

    // ————— performance contract (room-runtime) —————
    const gov = createFrameGovernor();
    let sleeping = false;
    let galleryPaused = false;

    // ————— state —————
    let masses: Mass[] = [];
    let massSerial = 0;
    const rays: RayState[] = [];
    let spawnSerial = 0;
    const pulses: Pulse[] = [];
    const comets: Comet[] = [];
    const rings: Ring[] = [];
    const currents: Current[] = [];
    let orbit: Orbit | null = null;
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let c = 600; // px/s — the one speed; rays, pulses, rings all ride it
    let rayG = 0;
    // the law's own weather (three-finger twist, grammar §5 "season"): 0 is
    // the room's ordinary attraction, 1 turns it fully inside out — light
    // and matter pushed instead of pulled. Continuous, never a switch.
    let season = 0;
    let seasonTarget = 0;
    let lawG = 0; // rayG signed by the season, recomputed once per frame
    // two-finger drag pans the frame (grammar §5) — px, smoothed
    let panX = 0;
    let panY = 0;
    let panTX = 0;
    let panTY = 0;
    const PAN_LIMIT = 130;
    let clockGap = 150;
    let clockHalfW = 36;
    let raf = 0;
    let lastFrame = 0;
    let last = performance.now();
    let localT = 0; // matter's clock (dilatable ×0.25)
    let lightT = 0; // light's clock (freeze-frame under the three-finger law)
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
    let carried: Carried = null;
    const beaconPhase = [0.4, 3.1];
    let beaconOffX = 0;
    let beaconOffY = 0;
    // the train: one car on a quiet strip, its speed set by hand
    let carX = 0;
    let carVx = 0;
    let carBeta = 0.4; // cruise fraction of c — starts gliding, visibly shy of its ghost
    let carDir: 1 | -1 = 1;
    let carHeld = false;
    let carTargetX = 0;
    let carRestLen = 260;
    let carBetaEff = 0;
    let carGlintAt = -1e9;
    let kbCarHold = false;
    const carHist: Array<{ x: number; tau: number }> = [];
    let simFlash: SimFlash | null = null;
    // the twins: proper time accreted as rings; one can be sent away
    const mkBeacon = (): Beacon => ({
      tau: 0,
      nextTdot: TDOT_TAU,
      x: 0,
      y: 0,
      beta: 0,
      ringFlashAt: -1e9,
      hist: [],
      tdots: [],
    });
    const beaconA = mkBeacon(); // the traveler — flick it and it journeys
    const beaconB = mkBeacon(); // the stayer
    let journey: Journey | null = null;
    let reunionAt = -1e9;
    let reunionRatio = 1;
    let blendOffX = 0;
    let blendOffY = 0;
    // the vessel: the aether current leans with real gravity (-1..1)
    let tiltLeanX = 0;
    let tiltLeanY = 0;
    let aetherX = 0; // wind + tilt, refreshed each frame — rays and comets ride it
    let aetherY = 0;
    let lastTiltSoundAt = 0;
    let lastTuttiAt = 0;
    let lastKnockAt = -1e9;
    let night = 0;
    let nightTarget = 0;
    let lastInteractionAt = performance.now();
    let focused = false;
    let cursorNx = 0.5;
    let cursorNy = 0.55;
    let cursorVisible = false;
    let kbCharge = 0;
    let kbMassId: string | null = null;
    let lastGrowNoteAt = 0;
    let lastChargeNoteAt = 0;
    let lastCurrentNoteAt = 0;
    let lastScrubSoundAt = 0;
    let lastWindSoundAt = 0;
    let lastCaptureSoundAt = 0;
    let staticRayPaths: Array<Array<{ x: number; y: number }>> = [];
    let staticRaysStale = true;
    // the span: two still fingers build a light clock between the fingertips —
    // a photon bounces at exactly c, and the tick period IS the geometry:
    // spread the fingers and the tick audibly slows. Rides the light clock,
    // so the three-finger law slows this photon too.
    const spanClock = { active: false, ax: 0, ay: 0, bx: 0, by: 0, s: 0, dir: 1, held: 0 };
    let lastSpanTickAt = 0;
    const trainTimers = new Set<ReturnType<typeof setTimeout>>();
    const hold: { mode: "fabric" | "mass" | null; massId: string | null; placed: boolean; done: boolean } = {
      mode: null,
      massId: null,
      placed: false,
      done: false,
    };

    const mkClock = (homeNx: number, homeNy: number, phase0: number): Clock => ({
      homeNx,
      homeNy,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      phase: phase0,
      dir: 1,
      held: false,
      targetX: 0,
      targetY: 0,
      vEff: 0,
      flashTop: -1e9,
      flashBot: -1e9,
      lastNoteAt: 0,
      photonTrail: [],
      hist: [],
      ticks: [],
    });
    // the twin at rest, and the one made to move — side by side, unmissable
    const clockA = mkClock(0.3, 0.3, 0.0);
    const clockB = mkClock(0.66, 0.3, 0.0);
    const lantern: Lantern = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      held: false,
      targetX: 0,
      targetY: 0,
      humOn: false,
      lastRingAt: 0,
      hist: [],
    };
    let placed = false; // homes assigned on first resize

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => { reduce = mq.matches; staticRaysStale = true; };
    mq.addEventListener?.("change", onMq);

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };
    const tone = (hz: number, sec = 0.4) => { try { audio().playTone(hz, sec); } catch { /* noop */ } };

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
      // one speed of light for this viewport — rays, pulses, rings, comets' ceiling
      c = 0.85 * Math.max(width, height);
      rayG = 50 * c * c; // manifold strengths: whips and slingshots, not drift
      clockGap = clamp(0.22 * c, 84, height * 0.26);
      clockHalfW = clamp(width * 0.085, 26, 44);
      carRestLen = clamp(width * 0.36, 170, 380);
      if (!placed) {
        placed = true;
        clockA.x = clockA.homeNx * width; clockA.y = clockA.homeNy * height;
        clockB.x = clockB.homeNx * width; clockB.y = clockB.homeNy * height;
        clockA.targetX = clockA.x; clockA.targetY = clockA.y;
        clockB.targetX = clockB.x; clockB.targetY = clockB.y;
        lantern.x = width * 0.5; lantern.y = height * 0.72;
        lantern.targetX = lantern.x; lantern.targetY = lantern.y;
        carX = width * 0.5;
        carTargetX = carX;
      }
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

    const clockAt = (x: number, y: number): "clockA" | "clockB" | null => {
      for (const [id, k] of [["clockA", clockA], ["clockB", clockB]] as const) {
        if (Math.abs(x - k.x) < clockHalfW + 20 && Math.abs(y - k.y) < clockGap / 2 + 26) return id;
      }
      return null;
    };

    const lanternAt = (x: number, y: number): boolean =>
      Math.hypot(x - lantern.x, y - lantern.y) < 40;

    const carY = () => height * CAR_NY;

    const carAt = (x: number, y: number): boolean =>
      Math.abs(y - carY()) < CAR_H + 16 && Math.abs(x - carX) < carRestLen / 2 + 18;

    const beaconAt = (x: number, y: number): 0 | 1 | null => {
      if (Math.hypot(x - beaconA.x, y - beaconA.y) < 30) return 0;
      if (Math.hypot(x - beaconB.x, y - beaconB.y) < 26) return 1;
      return null;
    };

    // the twins' drift tracks — deterministic functions of the room clock
    const driftA = (t: number) => ({
      x: width * (0.5 + 0.34 * Math.sin(t * 0.045 + 1.3)) + beaconOffX,
      y: height * (0.56 + 0.2 * Math.sin(t * 0.036 + 0.4)) + beaconOffY,
    });
    const driftB = (t: number) => ({
      x: width * (0.5 + 0.4 * Math.sin(t * 0.03 + 4.1)) + beaconOffX,
      y: height * (0.84 + 0.05 * Math.sin(t * 0.023 + 2.2)) + beaconOffY,
    });

    // one flash from the car's midpoint: two framings of the same instant
    const fireSimFlash = () => {
      const vSigned = clamp(carVx, -MATTER_CAP * c, MATTER_CAP * c);
      const vAbs = Math.abs(vSigned);
      const beta = vAbs / c;
      const halfC = contractedLength(carRestLen, beta) / 2;
      const sgn: 1 | -1 = vSigned >= 0 ? 1 : -1;
      // the kernel's law, verbatim: the strikes straddle their midpoint by
      // γβL — zero at rest, so the two framings collapse into one
      const gapSec = simultaneityGapMs(beta, (carRestLen / c) * 1000) / 1000;
      const tMid = (halfC / (c + vAbs) + halfC / (c - vAbs)) / 2;
      const tRear = tMid - gapSec / 2;
      const tFront = tMid + gapSec / 2;
      simFlash = {
        born: lightT,
        x0: carX,
        y: carY(),
        sgn,
        vAbs,
        halfC,
        tRear,
        tFront,
        rearX: carX - sgn * c * tRear,
        frontX: carX + sgn * c * tFront,
        rearDone: false,
        frontDone: false,
        carDone: false,
      };
      note(64, 70); // the emission spark; the two strikes answer below
      try { haptics.ripple(0.3); } catch { /* noop */ }
      useField.getState().recordTape("object", 0.5, "relativity/train");
    };

    // ring the beacon's age: its rings shimmer, its note deepened by tau
    const soundBeaconAge = (b: Beacon, now: number) => {
      b.ringFlashAt = now;
      note(66 - Math.min(14, Math.round(b.tau / RING_TAU)), 170);
      try { haptics.tap(); } catch { /* noop */ }
    };

    const journeyPointAt = (j: Journey, s: number) => {
      const n = j.pts.length;
      if (s <= 0) return j.pts[0];
      if (s >= j.len) return j.pts[n - 1];
      let lo = 0;
      let hi = n - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (j.cum[mid] <= s) lo = mid; else hi = mid;
      }
      const seg = j.cum[hi] - j.cum[lo] || 1;
      const f = (s - j.cum[lo]) / seg;
      return {
        x: mix(j.pts[lo].x, j.pts[hi].x, f),
        y: mix(j.pts[lo].y, j.pts[hi].y, f),
      };
    };

    // send the traveler out: rapidity-capped speed, a wide arc, and a
    // homecoming aimed at where the stayer will be when it gets there
    const launchJourney = (angle: number, speedPxMs: number) => {
      if (journey || performance.now() - reunionAt < 1500) return;
      const v = Math.max(matterSpeed(speedPxMs * 1000, c), 0.22 * c);
      const beta = v / c;
      const from = { x: beaconA.x, y: beaconA.y };
      const range = Math.max(160, Math.min(width, height) * (0.2 + beta * 0.5));
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const perpX = -dirY;
      const perpY = dirX;
      let target = driftB(localT);
      let pts: Array<{ x: number; y: number }> = [];
      let cum: number[] = [];
      let len = 0;
      for (let pass = 0; pass < 2; pass++) {
        const p0 = from;
        const p3 = { x: target.x + 26, y: target.y - 8 }; // side by side, not on top
        const p1 = {
          x: clamp(p0.x + dirX * range * 1.35, -width * 0.15, width * 1.15),
          y: clamp(p0.y + dirY * range * 1.35, -height * 0.15, height * 1.15),
        };
        const p2 = {
          x: clamp(p3.x + dirX * range * 0.9 + perpX * range * 0.5, -width * 0.15, width * 1.15),
          y: clamp(p3.y + dirY * range * 0.9 + perpY * range * 0.5, -height * 0.15, height * 1.15),
        };
        pts = [];
        cum = [];
        len = 0;
        const N = 56;
        for (let i = 0; i <= N; i++) {
          const u = i / N;
          const w = 1 - u;
          const x = w * w * w * p0.x + 3 * w * w * u * p1.x + 3 * w * u * u * p2.x + u * u * u * p3.x;
          const y = w * w * w * p0.y + 3 * w * w * u * p1.y + 3 * w * u * u * p2.y + u * u * u * p3.y;
          if (i > 0) len += Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
          pts.push({ x, y });
          cum.push(len);
        }
        target = driftB(localT + len / v); // aim again, now knowing the flight time
      }
      journey = { t: 0, T: len / v, beta, v, pts, cum, len, s: 0, trail: [] };
      note(52, 180);
      try { audio().chime(); } catch { /* noop */ }
      try { haptics.ripple(0.45); } catch { /* noop */ }
      useField.getState().recordTape("object", 0.6, "relativity/journey");
    };

    const firePulse = (x: number, y: number, strength: number) => {
      pulses.push({ x, y, bornLight: lightT, strength });
      if (pulses.length > MAX_PULSES) pulses.shift();
    };

    const placeMass = (x: number, y: number, settled: boolean, vx = 0, vy = 0): Mass => {
      const m: Mass = {
        id: `rm-${massSerial++}`,
        nx: clamp(x / width, 0.05, 0.95),
        ny: clamp(y / height, 0.08, 0.92),
        m: settled ? 0.9 : 0.5,
        plantedAt: performance.now(),
        growth: settled ? 1 : 0.06,
        settled,
        charge: 0,
        evapAt: 0,
        vx,
        vy,
        stage: 0,
      };
      masses.push(m);
      const alive = masses.filter((q) => !q.evapAt);
      if (alive.length > MAX_MASSES) {
        const oldest = alive.reduce((a, b) => (a.plantedAt <= b.plantedAt ? a : b));
        evaporate(oldest, 0.7);
      }
      note(26, 240);
      try { haptics.ripple(0.4); } catch { /* noop */ }
      staticRaysStale = true;
      useField.getState().recordTape("object", 0.6, "relativity/mass");
      syncStanding();
      return m;
    };

    const settleMass = (m: Mass) => {
      if (m.settled) return;
      m.settled = true;
      m.growth = 1;
      try { haptics.bloom(); } catch { /* noop */ }
      note(31, 420);
      staticRaysStale = true;
    };

    const evaporate = (m: Mass, strength = 1) => {
      if (m.evapAt) return;
      m.evapAt = performance.now();
      m.charge = 0;
      // collapse: one strong wave through everything, at c and no faster
      firePulse(m.nx * width, m.ny * height, (1.2 + m.m * 0.5) * strength);
      try { audio().bell(); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
      staticRaysStale = true;
      useField.getState().recordTape("sigil", 0.85, "relativity/collapse");
      syncStanding();
    };

    const syncStanding = () => setStanding(masses.some((m) => !m.evapAt));

    // ————— physics BETWEEN the masses: mutual gravity, merger, ringdown —————
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
     *  conserved, landing in sight, sound and haptics at once. */
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
      useField.getState().recordTape("sigil", 0.9, "relativity/merge");
      syncStanding();
    };

    /** One step of mutual gravity among every settled mass, then a merge
     *  pass — runs every frame, gestured or not. */
    const stepMassPhysics = (dt: number) => {
      const alive = masses.filter((m) => !m.evapAt && m.settled);
      if (alive.length < 2) return;
      if (!(dt > 0)) return;
      const bodies: OrbitBody[] = alive.map((m) => ({ x: m.nx * width, y: m.ny * height, m: m.m, vx: m.vx, vy: m.vy }));
      const stepped = stepMutualGravity(bodies, dt, MUTUAL_G, SOFTENING * 1.5, MASS_SPEED_CAP);
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
     *  star, black hole. */
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
      useField.getState().recordTape("sigil", 0.75, next === 1 ? "relativity/neutron-star" : "relativity/black-hole");
    };

    /** Double-tap on empty fabric: the next rarity in a fixed, deterministic
     *  cycle — a passing body, a gravitational-wave burst, or a bent ray. */
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
        const speed = 50 + intensity * 55;
        placeMass(sx, sy, true, Math.cos(toward) * speed, Math.sin(toward) * speed);
        return;
      }
      if (kind === "gravitational-wave") {
        firePulse(x, y, 0.7 + intensity * 0.6);
        window.setTimeout(() => firePulse(x, y, 0.5 + intensity * 0.4), 90);
        note(30, 900);
        try { haptics.ripple(0.5); } catch { /* noop */ }
        return;
      }
      const angle = hash01(massSerial * 19 + 7) * Math.PI * 2;
      rays.push({ x, y, vx: Math.cos(angle) * c, vy: Math.sin(angle) * c, trail: [] });
      if (rays.length > RAY_COUNT * 2) rays.shift();
      note(44, 200);
      try { haptics.tap(); } catch { /* noop */ }
    };

    /** Triple-tap: a binary inspiral and merger, run to completion in a few
     *  seconds, ringdown included. */
    const forceInspiral = (x: number, y: number): boolean => {
      const alive = masses.filter((m) => !m.evapAt && m.settled);
      if (alive.length < 2) return false;
      alive.sort((a, b) => Math.hypot(a.nx * width - x, a.ny * height - y) - Math.hypot(b.nx * width - x, b.ny * height - y));
      const a = alive[0];
      const b = alive[1];
      const dx = b.nx * width - a.nx * width;
      const dy = b.ny * height - a.ny * height;
      const d = Math.hypot(dx, dy) || 1;
      const speed = 65 + Math.min(d, 260) * 0.4;
      a.vx += (-dy / d) * speed * (a.m > b.m ? 0.4 : 1);
      a.vy += (dx / d) * speed * (a.m > b.m ? 0.4 : 1);
      b.vx += (dy / d) * speed * (b.m > a.m ? 0.4 : 1);
      b.vy += (-dx / d) * speed * (b.m > a.m ? 0.4 : 1);
      note(24, 500);
      try { haptics.ripple(0.6); } catch { /* noop */ }
      useField.getState().recordTape("sigil", 0.85, "relativity/inspiral");
      return true;
    };

    // the whole-room parting (LetGo, §8c): every mass evaporates oldest-
    // first along the existing collapse path — an exhale, never a blink.
    // This room keeps no belongings (no persistence), so there is nothing
    // to write empty; letting go simply clears what stands right now.
    const letGo = () => {
      const alive = masses.filter((m) => !m.evapAt).sort((a, b) => a.plantedAt - b.plantedAt);
      if (alive.length === 0) return;
      const now0 = performance.now();
      alive.forEach((m, i) => {
        m.charge = 0;
        m.evapAt = reduce ? now0 : now0 + i * 150;
        firePulse(m.nx * width, m.ny * height, (0.5 + m.m * 0.3) * (reduce ? 0.4 : 1));
      });
      staticRaysStale = true;
      try { audio().thud(); } catch { /* noop */ }
      note(26, 600);
      try { haptics.roll(); } catch { /* noop */ }
      useField.getState().recordTape("object", 0.3, "relativity/letgo");
      setStanding(false);
    };
    letGoRef.current = letGo;

    const throwComet = (x: number, y: number, angle: number, speedPxMs: number) => {
      const effort = speedPxMs * 1000; // px/s of intent
      const v = matterSpeed(effort, c);
      const heat = matterGlow(effort, c);
      comets.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        heat,
        born: performance.now(),
        trail: [],
        hist: [],
      });
      if (comets.length > MAX_COMETS) comets.shift();
      // the launch flash: light from the same hand, same instant — it wins,
      // every time, no matter the effort
      firePulse(x, y, 0.3 + heat * 0.25);
      note(38 + Math.round(heat * 10), 170);
      try { haptics.ripple(0.3 + heat * 0.4); } catch { /* noop */ }
      useField.getState().recordTape("object", 0.5, "relativity/comet");
    };

    // deterministic ray spawning, seeded by serial, entering from an edge
    const spawnRay = (): RayState => {
      const s = spawnSerial++;
      const edge = Math.floor(hash01(s * 7 + 1) * 4);
      const along = 0.12 + hash01(s * 13 + 5) * 0.76;
      const tilt = (hash01(s * 29 + 11) - 0.5) * 0.9;
      let x = 0, y = 0, a = 0;
      if (edge === 0) { x = -20; y = along * height; a = tilt; }
      else if (edge === 1) { x = width + 20; y = along * height; a = Math.PI + tilt; }
      else if (edge === 2) { x = along * width; y = -20; a = Math.PI / 2 + tilt; }
      else { x = along * width; y = height + 20; a = -Math.PI / 2 + tilt; }
      return { x, y, vx: Math.cos(a) * c, vy: Math.sin(a) * c, trail: [] };
    };
    for (let i = 0; i < RAY_COUNT; i++) rays.push(spawnRay());

    const grabAt = (x: number, y: number): Carried => {
      const k = clockAt(x, y);
      if (k) return k;
      if (lanternAt(x, y)) return "lantern";
      if (carAt(x, y)) return "car";
      return null;
    };

    const carriedObj = (): Clock | Lantern | null =>
      carried === "clockA" ? clockA : carried === "clockB" ? clockB : carried === "lantern" ? lantern : null;

    // let the car go: whatever speed the hand meant, read as rapidity —
    // capped like all matter, and near-stillness settles into true rest
    const releaseCar = (vxIntent: number) => {
      carHeld = false;
      const v = matterSpeed(Math.abs(vxIntent), c);
      carDir = vxIntent >= 0 ? 1 : -1;
      carBeta = v < 0.03 * c ? 0 : v / c;
      carVx = carDir * carBeta * c;
      note(40 + Math.round((carBeta / MATTER_CAP) * 10), 190);
      try { haptics.tap(); } catch { /* noop */ }
      carried = null;
    };

    const releaseCarried = (throwVx?: number, throwVy?: number) => {
      if (carried === "car") {
        releaseCar(throwVx !== undefined ? throwVx : carVx);
        return;
      }
      const obj = carriedObj();
      if (!obj) return;
      obj.held = false;
      if (throwVx !== undefined && throwVy !== undefined) {
        const cap = carried === "lantern" ? 0.9 * c : CLOCK_V_CAP * c;
        const sp = Math.hypot(throwVx, throwVy);
        const s = sp > cap ? cap / sp : 1;
        obj.vx = throwVx * s;
        obj.vy = throwVy * s;
      }
      carried = null;
    };

    // three-finger tap = tutti (grammar §5): one synchronized soft pulse —
    // both clocks flash and tick, the lantern breathes one wavefront, every
    // mass glints its warm arc: the covenant states itself at once
    const tutti = () => {
      const now = performance.now();
      if (now - lastTuttiAt < 1400) return;
      lastTuttiAt = now;
      for (const k of [clockA, clockB]) { k.flashTop = now; k.flashBot = now; }
      note(64, 70);
      window.setTimeout(() => note(59, 70), 60);
      rings.push({ x: lantern.x, y: lantern.y, bornLight: lightT, dx: 1, dy: 0, beta: 0 });
      if (rings.length > MAX_RINGS) rings.shift();
      for (const m of masses) if (!m.evapAt) m.charge = Math.max(m.charge, 0.22);
      carGlintAt = now;
      beaconA.ringFlashAt = now;
      beaconB.ringFlashAt = now;
      try { haptics.tap(); } catch { /* noop */ }
    };

    // ————— gestures (grammar only; thresholds live in gesture/core) —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 2) {
          // step back: a raised lens lowers first, then a panned frame comes home
          if (lensSnapped === 1) {
            lensSnapped = 0;
            lensTarget = 0;
            try { haptics.lens(); } catch { /* noop */ }
            note(48, 160);
            return;
          }
          if (Math.abs(panTX) > 1 || Math.abs(panTY) > 1) {
            panTX = 0;
            panTY = 0;
            try { haptics.tap(); } catch { /* noop */ }
            note(41, 220);
          }
          return;
        }
        if (e.fingers === 3) { tutti(); return; }
        if (e.fingers !== 1) return; // anything else is gently absorbed
        const { x, y } = toLocal(e.x, e.y);
        // tap the car: one flash from its midpoint, two framings of "at once"
        if (carAt(x, y)) { fireSimFlash(); return; }
        // tap a twin: its rings shimmer and its age is heard, deeper when older
        const b = beaconAt(x, y);
        if (b !== null) { soundBeaconAge(b === 0 ? beaconA : beaconB, performance.now()); return; }
        // the rapid-tap ladder (tiers 1/3/5/n) on open dark: one rings your
        // pulse at c, three stage the race, five make the wells echo, n is
        // the covenant's crescendo
        const trainTier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (trainTier === "n") {
          tutti();
          firePulse(x, y, 1 + depth * 0.6);
          note(31, 320);
          try { haptics.bloom(); } catch { /* noop */ }
          return;
        }
        if (trainTier === 5) {
          // the wells echo the strike: every standing mass answers with its
          // own ring, each arriving when light from the tap would reach it
          const alive = masses.filter((m) => !m.evapAt);
          if (alive.length > 0) {
            for (const m of alive) {
              const mx = m.nx * width;
              const my = m.ny * height;
              const delayMs = (Math.hypot(mx - x, my - y) / c) * 1000;
              const t = setTimeout(() => {
                trainTimers.delete(t);
                firePulse(mx, my, 0.5 + m.m * 0.3);
                note(29 + Math.round(m.m * 4), 160);
              }, delayMs);
              trainTimers.add(t);
            }
          } else {
            // no wells standing: three nested wavefronts, none beats the rest
            for (let k = 0; k < 3; k++) {
              const t = setTimeout(() => {
                trainTimers.delete(t);
                firePulse(x, y, 0.55 + k * 0.12);
              }, k * 140);
              trainTimers.add(t);
            }
            note(41, 220);
          }
          try { haptics.ripple(0.5); } catch { /* noop */ }
          return;
        }
        if (trainTier === 3) {
          // the race, staged in one strike: a flash and a comet leave the
          // same point in the same instant — the light wins, every time
          firePulse(x, y, 0.6 + e.intensity * 0.4);
          throwComet(x, y, hash01(x * 3.7 + y * 1.3) * Math.PI * 2, 0.9 + depth * 0.6);
          return;
        }
        // your pulse: a ring at exactly c — race it with anything you like
        firePulse(x, y, 0.5 + e.intensity * 0.8);
        note(45 + Math.round(e.intensity * 7), 200);
        try { haptics.ripple(0.3 + e.intensity * 0.4); } catch { /* noop */ }
      },
      flick: (e) => {
        lastInteractionAt = performance.now();
        if (carried) {
          // a thrown clock or lantern keeps its cast-off speed (capped, of course)
          releaseCarried(Math.cos(e.angle) * e.speed * 1000, Math.sin(e.angle) * e.speed * 1000);
          try { audio().chime(); } catch { /* noop */ }
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        // flick the marked twin: it leaves on a journey and comes home younger
        if (beaconAt(x, y) === 0) { launchJourney(e.angle, e.speed); return; }
        throwComet(x, y, e.angle, e.speed);
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three fingers touch the law: time dilates, and — this room's one
          // legitimate slow-light moment — the light itself nearly stands
          // still, so its geometry can finally be seen. Both keep deepening
          // for as long as the hold stands: 900ms and 2400ms are different.
          if (e.phase === "enter") {
            note(24, 500);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") { timeScaleTarget = 1; rayScaleTarget = 1; return; }
          timeScaleTarget = Math.max(0.15, 1 - 0.85 * Math.min(1, e.elapsed / 2000));
          rayScaleTarget = Math.max(0.03, 1 - 0.97 * Math.min(1, e.elapsed / 1800));
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          if (grabAt(x, y)) { hold.mode = null; hold.massId = null; return; } // resting on an instrument is rest
          const m = massAt(x, y);
          if (m) { hold.mode = "mass"; hold.massId = m.id; }
          else { hold.mode = "fabric"; hold.massId = null; }
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
          hold.mode = null;
          hold.massId = null;
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
            // dwell on open dark: a mass gathers — long-press means grow
            hold.placed = true;
            const m = placeMass(x, y, false);
            hold.massId = m.id;
          } else if (hold.placed && hold.massId) {
            const m = masses.find((q) => q.id === hold.massId);
            if (m && !m.settled) {
              m.growth = clamp01(m.growth + 0.088 * (1 + e.intensity * 0.5));
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
              // the well deepens, the beacons near it slow further, all held
              m.m = clamp(m.m + 0.0035 * (1 + e.intensity * 0.5), 0.4, 2.0);
              const now = performance.now();
              if (now - lastGrowNoteAt > 700) {
                lastGrowNoteAt = now;
                note(22 + Math.round(m.m * 2), 200);
                try { haptics.tap(); } catch { /* noop */ }
                staticRaysStale = true;
              }
            }
          }
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        if (e.fingers === 3) {
          // three fingers sweep the wanderers — comets, lantern, beacons, light
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
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          carried = grabAt(x, y);
          if (carried === "car") {
            // towing the car sets its speed: let go and it keeps your pace
            carHeld = true;
            carTargetX = x;
            try { audio().chime(); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
            return;
          }
          const obj = carriedObj();
          if (obj) {
            obj.held = true;
            obj.targetX = x;
            obj.targetY = y;
            try { audio().chime(); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        if (e.phase === "end") { releaseCarried(); return; }
        if (carried === "car") { carTargetX = x; return; }
        const obj = carriedObj();
        if (obj) {
          obj.targetX = x;
          obj.targetY = y;
          return;
        }
        // one finger elsewhere: a gentle aether current the light leans into
        currents.push({ x, y, dx: e.vx, dy: e.vy, born: performance.now() });
        if (currents.length > 10) currents.shift();
        const now = performance.now();
        if (now - lastCurrentNoteAt > 700) {
          lastCurrentNoteAt = now;
          note(50, 90);
        }
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.cx, e.cy);
        // a circling hand stirs nearby light into brief closed orbits
        orbit = { x, y, omega: clamp(e.angularVelocity, -6, 6), until: performance.now() + 2600 };
        const now = performance.now();
        if (now - lastScrubSoundAt > 600) {
          lastScrubSoundAt = now;
          note(45 + Math.round(Math.min(6, Math.abs(e.winding))), 130);
          try { haptics.ripple(0.25); } catch { /* noop */ }
        }
      },
      span: (e) => {
        lastInteractionAt = performance.now();
        if (e.phase === "release") {
          if (spanClock.active) {
            spanClock.active = false;
            const held = Math.min(1, e.elapsed / 4000);
            note(45, 120 + held * 220);
            try { haptics.ripple(0.2 + held * 0.3); } catch { /* noop */ }
          }
          return;
        }
        const a = toLocal(e.ax, e.ay);
        const b = toLocal(e.bx, e.by);
        if (e.phase === "enter") {
          // two still fingers become a light clock: a photon starts bouncing
          // between the fingertips at exactly c
          spanClock.active = true;
          spanClock.s = 0;
          spanClock.dir = 1;
          note(50, 140);
          try { haptics.tap(); } catch { /* noop */ }
        }
        spanClock.ax = a.x;
        spanClock.ay = a.y;
        spanClock.bx = b.x;
        spanClock.by = b.y;
        spanClock.held = Math.min(1, e.elapsed / 4000);
      },
      twist: (e) => {
        if (e.fingers === 3) {
          // three fingers turn the season: the law's own weather, attraction
          // sliding continuously toward its own inversion and back
          lastInteractionAt = performance.now();
          if (e.phase === "move") {
            seasonTarget = clamp01(seasonTarget + e.angle / 2.6);
            try { audio().holdConcernTone("season", 20 + seasonTarget * 60); } catch { /* noop */ }
          } else if (e.phase === "end") {
            try { audio().releaseConcernTone("season"); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        lastInteractionAt = performance.now();
        // two fingers rotate the lens: the felt room ↔ its spacetime record
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            try { haptics.lens(); } catch { /* noop */ }
            if (snapped === 1) { try { audio().chime(); } catch { /* noop */ } }
            else note(48, 160);
          }
          lensTarget = snapped;
        }
      },
      pan2: (e) => {
        lastInteractionAt = performance.now();
        // two fingers pan the frame — the mesh and its masses slide; the
        // clocks, car, lantern, and beacons stay put, exactly where the
        // hand can still reach them
        panTX = clamp(panTX + e.dx, -PAN_LIMIT, PAN_LIMIT);
        panTY = clamp(panTY + e.dy, -PAN_LIMIT, PAN_LIMIT);
      },
    });

    // ————— the vessel: the device is the covenant's body (grammar §5) —————
    // Subscribed passively — nothing flows until the candle has invited the
    // senses. Tilt = the aether current leans (rays and comets drift with
    // real gravity); shake = a scatter of pulses, each at exactly c.
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduce) { tiltLeanX = 0; tiltLeanY = 0; return; }
        tiltLeanX = clamp(gamma / 28, -1, 1);
        tiltLeanY = clamp((beta - 35) / 28, -1, 1); // rest angle ≈ a held phone
        const mag = Math.hypot(tiltLeanX, tiltLeanY);
        const now = performance.now();
        if (mag > 0.55 && now - lastTiltSoundAt > 1400) {
          lastTiltSoundAt = now;
          note(38 + Math.round(mag * 4), 240); // the current's low word
        }
      },
      shake: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // a scatter of pulses: three rings race out — none beats the others
        const now = performance.now();
        for (let k = 0; k < 3; k++) {
          firePulse(
            (0.25 + hash01(now + k * 41.3) * 0.5) * width,
            (0.25 + hash01(now * 1.7 + k * 23.1) * 0.5) * height,
            0.35 + intensity * 0.45,
          );
        }
        note(45, 180);
        try { (intensity > 0.7 ? haptics.storm : haptics.chop)(); } catch { /* noop */ }
      },
      knock: ({ intensity }) => {
        const now = performance.now();
        if (now - lastKnockAt < 420) return;
        lastKnockAt = now;
        lastInteractionAt = now;
        // a rap on the case: one pulse from dead center, sharper than a tap
        firePulse(width * 0.5, height * 0.5, 0.85 + intensity * 0.6);
        note(41 + Math.round(intensity * 6), 240);
        try { haptics.roll(); } catch { /* noop */ }
      },
      flip: ({ faceDown }) => {
        nightTarget = faceDown ? 1 : 0;
        lastInteractionAt = performance.now();
        note(faceDown ? 22 : 45, 400);
        try { haptics.roll(); } catch { /* noop */ }
      },
    });

    // ————— keyboard dialect (arrows + enter + escape, quieter) —————
    const onKeyDown = (ev: KeyboardEvent) => {
      const step = 0.05;
      if (ev.key === "Escape") {
        lensTarget = 0;
        lensSnapped = 0;
        cursorVisible = false;
        kbCharge = 0;
        kbMassId = null;
        kbCarHold = false;
        return;
      }
      if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        lastInteractionAt = performance.now();
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
        if (!cursorVisible) { cursorVisible = true; return; }
        const x = cursorNx * width;
        const y = cursorNy * height;
        if (kbCarHold) {
          // the held key retunes the car — longer is faster; release cruises
          kbCharge = clamp01(kbCharge + (ev.repeat ? 0.055 : 0.02));
          const nowK = performance.now();
          if (nowK - lastChargeNoteAt > 340) {
            lastChargeNoteAt = nowK;
            note(40 + Math.round(kbCharge * 12), 100);
          }
          return;
        }
        if (!ev.repeat) {
          if (carAt(x, y)) {
            // a press on the car is its tap: the flash; keep holding to retune
            kbCarHold = true;
            kbCharge = 0;
            fireSimFlash();
            return;
          }
          const b = beaconAt(x, y);
          if (b === 0 && !journey) {
            // the keyboard's flick: the twin departs, away from its stayer
            const ang = Math.atan2(beaconA.y - beaconB.y, beaconA.x - beaconB.x);
            launchJourney(ang, 0.45 * (c / 1000));
            return;
          }
          if (b !== null) {
            soundBeaconAge(b === 0 ? beaconA : beaconB, performance.now());
            return;
          }
        }
        const m = massAt(x, y);
        if (!ev.repeat && !m) {
          // a press is a tap: your pulse, at exactly c
          firePulse(x, y, 0.8);
          note(47, 200);
          return;
        }
        // held enter is the keyboard's dwell and ceremony
        kbCharge = clamp01(kbCharge + (ev.repeat ? 0.09 : 0.02));
        if (m) {
          if (kbMassId !== m.id) { kbMassId = m.id; kbCharge = 0.02; }
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
        } else if (kbCharge >= 1) {
          kbCharge = 0;
          placeMass(x, y, true);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        if (kbCarHold) {
          kbCarHold = false;
          if (kbCharge >= 0.15) {
            carBeta = clamp01(kbCharge) * MATTER_CAP;
            carVx = carDir * carBeta * c;
            note(40 + Math.round((carBeta / MATTER_CAP) * 10), 190);
          } else if (kbCharge >= 0.06) {
            // a settling hold: the car comes to rest, the framings collapse
            carBeta = 0;
            carVx = 0;
            note(40, 190);
          }
          kbCharge = 0;
          return;
        }
        const m = masses.find((q) => q.id === kbMassId);
        if (m) m.charge = 0;
        kbCharge = 0;
        kbMassId = null;
      }
    };
    const onFocus = () => { focused = true; };
    const onBlur = () => { focused = false; cursorVisible = false; };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);
    wrap.addEventListener("focus", onFocus);
    wrap.addEventListener("blur", onBlur);

    // ————— field geometry: masses well the mesh, pulses ring through it —————
    const dispAt = (x: number, y: number, pts: MassPoint[]): { dx: number; dy: number } => {
      let dx = 0;
      let dy = 0;
      for (const p of pts) {
        const ddx = p.x - x;
        const ddy = p.y - y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < 1) continue;
        const s2 = 70 * 70;
        const f = (22 * p.m * s2) / (d2 + s2) / Math.sqrt(d2);
        dx += ddx * f;
        dy += ddy * f;
      }
      for (const p of pulses) {
        const age = lightT - p.bornLight;
        const rf = age * c;
        const prog = clamp01(rf / (Math.max(width, height) * 1.2));
        const ddx = x - p.x;
        const ddy = y - p.y;
        const d = Math.hypot(ddx, ddy);
        if (d < 1) continue;
        const g = Math.exp(-((d - rf) * (d - rf)) / (2 * 30 * 30));
        const amp = 9 * p.strength * (1 - prog) * g;
        dx += (ddx / d) * amp;
        dy += (ddy / d) * amp;
      }
      return { dx, dy };
    };

    /** Reduced motion: light as still dashed geodesic traces, bent honestly. */
    const rebuildStaticRays = (pts: MassPoint[]) => {
      staticRaysStale = false;
      staticRayPaths = [];
      const dt = 1 / 120;
      for (let i = 0; i < 5; i++) {
        const y0 = height * (0.12 + 0.76 * (i / 4));
        let r: Ray = { x: -10, y: y0, vx: c, vy: 0 };
        const path = [{ x: r.x, y: r.y }];
        for (let s = 0; s < 420; s++) {
          r = geodesicStep(pts, r, dt, c, lawG, SOFTENING);
          path.push({ x: r.x, y: r.y });
          if (r.x < -40 || r.x > width + 40 || r.y < -40 || r.y > height + 40) break;
        }
        staticRayPaths.push(path);
      }
    };

    const pushHist = (hist: Array<{ x: number; tau: number }>, x: number) => {
      hist.push({ x, tau: lightT });
      if (hist.length > HIST_MAX) hist.shift();
    };

    // ————— per-frame physics —————
    const stepClock = (k: Clock, other: Clock, pts: MassPoint[], dt: number, now: number) => {
      if (k.held) {
        const nx = mix(k.x, k.targetX, Math.min(1, dt * 16));
        const ny = mix(k.y, k.targetY, Math.min(1, dt * 16));
        k.vx = dt > 0 ? (nx - k.x) / dt : 0;
        k.vy = dt > 0 ? (ny - k.y) / dt : 0;
        k.x = nx;
        k.y = ny;
      } else {
        // glide, then a soft damped spring home — the twins end up side by side
        const hx = k.homeNx * width;
        const hy = k.homeNy * height;
        k.vx += ((hx - k.x) * 1.6 - k.vx * 1.5) * dt;
        k.vy += ((hy - k.y) * 1.6 - k.vy * 1.5) * dt;
        const sp = Math.hypot(k.vx, k.vy);
        const cap = CLOCK_V_CAP * c;
        if (sp > cap) { k.vx *= cap / sp; k.vy *= cap / sp; }
        k.x = clamp(k.x + k.vx * dt * timeScale, clockHalfW, width - clockHalfW);
        k.y = clamp(k.y + k.vy * dt * timeScale, clockGap / 2 + 24, height - clockGap / 2 - 24);
      }
      // keep the twins from overlapping into one clock
      const sep = clockHalfW * 2 + 14;
      const ddx = k.x - other.x;
      if (Math.abs(ddx) < sep && Math.abs(k.y - other.y) < clockGap) {
        k.x = clamp(other.x + (ddx >= 0 ? sep : -sep), clockHalfW, width - clockHalfW);
      }
      const vMag = Math.min(Math.hypot(k.vx, k.vy), CLOCK_V_CAP * c);
      k.vEff = mix(k.vEff, vMag, Math.min(1, dt * 8));
      // the photon holds c: its vertical share is what motion leaves over —
      // and a nearby well leans on the clock too (gravitational dilation)
      const grav = timeDilation(pts, k.x, k.y, DIL_K, DIL_SOFT);
      const vert = Math.sqrt(Math.max(0, c * c - k.vEff * k.vEff));
      const lightRate = reduce ? 1 : rayScale;
      k.phase += (k.dir * vert * grav * dt * lightRate) / clockGap;
      if (k.phase >= 1 || k.phase <= 0) {
        k.phase = clamp01(k.phase);
        k.dir = (k.dir === 1 ? -1 : 1) as 1 | -1;
        if (k.phase >= 1) k.flashBot = now; else k.flashTop = now;
        k.ticks.push({ x: k.x, tau: lightT });
        if (k.ticks.length > TICKS_MAX) k.ticks.shift();
        // the tick: deeper and softer as the clock slows — heard, not read
        if (now - k.lastNoteAt > 80) {
          k.lastNoteAt = now;
          const gamma = lorentzGamma(k.vEff, c) / Math.max(0.25, grav);
          const dropped = Math.round(clamp((gamma - 1) * 8, 0, 12));
          if (k.phase <= 0) note(64 - dropped, 90);
          else tone(660 / Math.pow(2, dropped / 12), 0.06);
          if (k.held) { try { haptics.tap(); } catch { /* noop */ } }
        }
      }
      // the photon's world-path: straight down at rest, a long diagonal in
      // motion — the stretched path IS the slower tick, drawn
      k.photonTrail.push({ x: k.x, y: k.y - clockGap / 2 + k.phase * clockGap });
      if (k.photonTrail.length > 22) k.photonTrail.shift();
      pushHist(k.hist, k.x);
    };

    const stepLantern = (dt: number) => {
      if (lantern.held) {
        const nx = mix(lantern.x, lantern.targetX, Math.min(1, dt * 16));
        const ny = mix(lantern.y, lantern.targetY, Math.min(1, dt * 16));
        lantern.vx = dt > 0 ? (nx - lantern.x) / dt : 0;
        lantern.vy = dt > 0 ? (ny - lantern.y) / dt : 0;
        lantern.x = nx;
        lantern.y = ny;
      } else {
        // released: it coasts, then settles
        lantern.vx *= Math.exp(-dt * 1.1);
        lantern.vy *= Math.exp(-dt * 1.1);
        lantern.vx += aetherX * c * 0.25 * dt;
        lantern.vy += aetherY * c * 0.25 * dt;
        const sp = Math.hypot(lantern.vx, lantern.vy);
        const cap = 0.9 * c;
        if (sp > cap) { lantern.vx *= cap / sp; lantern.vy *= cap / sp; }
        lantern.x += lantern.vx * dt * timeScale;
        lantern.y += lantern.vy * dt * timeScale;
        if (lantern.x < 30 || lantern.x > width - 30) { lantern.vx *= -0.6; lantern.x = clamp(lantern.x, 30, width - 30); }
        if (lantern.y < 30 || lantern.y > height - 30) { lantern.vy *= -0.6; lantern.y = clamp(lantern.y, 30, height - 30); }
      }
      const sp = Math.hypot(lantern.vx, lantern.vy);
      // moving light leaves its wavefronts behind: rings at c, blue ahead,
      // red behind — the doppler pattern drawn by the lantern itself
      if ((sp > 40 || lantern.held) && lightT - lantern.lastRingAt > RING_EVERY) {
        lantern.lastRingAt = lightT;
        const beta = clamp(sp / c, 0, 0.95);
        rings.push({
          x: lantern.x,
          y: lantern.y,
          bornLight: lightT,
          dx: sp > 1 ? lantern.vx / sp : 1,
          dy: sp > 1 ? lantern.vy / sp : 0,
          beta,
        });
        if (rings.length > MAX_RINGS) rings.shift();
      }
      // the hum: pitch-bent toward the listener by the same law as the color
      if (sp > 24 || lantern.held) {
        const lx = width / 2;
        const ly = height / 2;
        const rx = lantern.x - lx;
        const ry = lantern.y - ly;
        const rd = Math.hypot(rx, ry) || 1;
        const vTow = -(lantern.vx * rx + lantern.vy * ry) / rd;
        const shift = dopplerShift(clamp(vTow, -0.9 * c, 0.9 * c), c);
        lantern.humOn = true;
        try { audio().holdConcernTone("love", clamp(50 + (shift - 1) * 55, 2, 98)); } catch { /* noop */ }
      } else if (lantern.humOn) {
        lantern.humOn = false;
        try { audio().releaseConcernTone("love"); } catch { /* noop */ }
      }
      pushHist(lantern.hist, lantern.x);
    };

    const stepCar = (dt: number) => {
      if (carHeld) {
        const nx = mix(carX, carTargetX, Math.min(1, dt * 14));
        carVx = dt > 0 ? (nx - carX) / dt : 0;
        carX = nx;
      } else {
        const cruise = carDir * carBeta * c;
        carVx = mix(carVx, cruise, Math.min(1, dt * 4));
        carX += carVx * dt * (reduce ? 0 : timeScale);
        // the deterministic loop: off one side, in from the other
        if (carX > width + carRestLen) carX = -carRestLen;
        if (carX < -carRestLen) carX = width + carRestLen;
      }
      carBetaEff = mix(carBetaEff, clamp(Math.abs(carVx) / c, 0, MATTER_CAP), Math.min(1, dt * 6));
      pushHist(carHist, carX);

      // the flash lives in light's time: under the three-finger law the
      // rear end can be watched, slowly, running into its own light
      if (simFlash) {
        const t = lightT - simFlash.born;
        if (!simFlash.rearDone && t >= simFlash.tRear) {
          simFlash.rearDone = true;
          note(52, 140); // the rear strike — first, whenever the car moves
          try { haptics.tap(); } catch { /* noop */ }
        }
        if (!simFlash.frontDone && t >= simFlash.tFront) {
          simFlash.frontDone = true;
          note(59, 140); // the front strike — late by exactly the kernel's gap
          try { haptics.tap(); } catch { /* noop */ }
        }
        if (!simFlash.carDone && t >= (simFlash.tRear + simFlash.tFront) / 2) {
          simFlash.carDone = true; // the car's verdict: both ends, one moment
          try { haptics.ripple(0.2); } catch { /* noop */ }
        }
        if (t > simFlash.tFront + 6) simFlash = null; // linger for the lens
      }
    };

    const accrueBeacon = (
      b: Beacon,
      x: number,
      y: number,
      dtP: number,
      betaUse: number,
      pts: MassPoint[],
    ) => {
      // proper time: the special ratio times the gravitational one — the
      // same 1/γ the kernel integrates, accrued live
      const grav = timeDilation(pts, x, y, DIL_K, DIL_SOFT);
      b.tau += dtP * properTimeRatio(betaUse) * grav;
      b.beta = betaUse;
      while (b.tau >= b.nextTdot) {
        b.tdots.push({ x, tau: lightT });
        if (b.tdots.length > TICKS_MAX) b.tdots.shift();
        b.nextTdot += TDOT_TAU;
      }
      b.x = x;
      b.y = y;
      pushHist(b.hist, x);
    };

    const stepBeacons = (dt: number, now: number, pts: MassPoint[]) => {
      const mdt = dt * (reduce ? 1 : timeScale);
      const dA = driftA(localT);
      const dB = driftB(localT);
      // the stayer: its drift is slow, so its clock runs at nearly full rate
      const betaB = mdt > 0
        ? clamp(Math.hypot(dB.x - beaconB.x, dB.y - beaconB.y) / (mdt * c), 0, MATTER_CAP)
        : 0;
      accrueBeacon(beaconB, dB.x, dB.y, mdt, betaB, pts);

      if (journey) {
        journey.t += mdt;
        let ax = beaconA.x;
        let ay = beaconA.y;
        if (!reduce) {
          journey.s = Math.min(journey.s + journey.v * mdt, journey.len);
          const p = journeyPointAt(journey, journey.s);
          ax = p.x;
          ay = p.y;
          journey.trail.push({ x: ax, y: ay });
          if (journey.trail.length > 30) journey.trail.shift();
        }
        accrueBeacon(beaconA, ax, ay, mdt, journey.beta, pts);
        const done = reduce ? journey.t >= journey.T : journey.s >= journey.len - 0.5;
        if (done) {
          // the reunion: side by side, and the traveler is plainly younger
          reunionAt = now;
          reunionRatio = properTimeRatio(journey.beta);
          if (!reduce) {
            blendOffX = ax - dA.x;
            blendOffY = ay - dA.y;
          }
          journey = null;
          beaconA.ringFlashAt = now;
          beaconB.ringFlashAt = now;
          tone(392, 0.9);
          tone(392 * reunionRatio, 0.9); // the age gap, heard as detune
          note(64, 130);
          try { haptics.bloom(); } catch { /* noop */ }
          useField.getState().recordTape("sigil", 0.8, "relativity/reunion");
        }
      } else {
        // after the reunion the traveler lingers beside its twin, then drifts home
        if (now - reunionAt > REUNION_MS * 0.6) {
          const k = Math.exp(-dt * 1.2);
          blendOffX *= k;
          blendOffY *= k;
        }
        const ax = dA.x + blendOffX;
        const ay = dA.y + blendOffY;
        const betaA = mdt > 0
          ? clamp(Math.hypot(ax - beaconA.x, ay - beaconA.y) / (mdt * c), 0, MATTER_CAP)
          : 0;
        accrueBeacon(beaconA, ax, ay, mdt, betaA, pts);
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

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      rayScale += (rayScaleTarget - rayScale) * Math.min(1, dt * 5);
      season += (seasonTarget - season) * Math.min(1, dt * 3);
      lawG = rayG * (1 - 2 * season);
      panX += (panTX - panX) * Math.min(1, dt * 8);
      panY += (panTY - panY) * Math.min(1, dt * 8);
      night += (nightTarget - night) * Math.min(1, dt * 2.4);
      if (!reduce) localT += dt * timeScale;
      lightT += dt * (reduce ? 1 : rayScale);
      windX += (windTargetX - windX) * Math.min(1, dt * 2.2);
      windY += (windTargetY - windY) * Math.min(1, dt * 2.2);
      windTargetX *= Math.exp(-dt * 0.5);
      windTargetY *= Math.exp(-dt * 0.5);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      // the aether: the hand's wind plus the vessel's lean, one current
      aetherX = windX + tiltLeanX * 0.4;
      aetherY = windY + tiltLeanY * 0.4;
      beaconOffX = beaconOffX * Math.exp(-dt * 0.6) + aetherX * 160 * dt;
      beaconOffY = beaconOffY * Math.exp(-dt * 0.6) + aetherY * 160 * dt;

      const pts = livePoints();

      for (let i = masses.length - 1; i >= 0; i--) {
        const m = masses[i];
        if (m.evapAt && now - m.evapAt > EVAP_MS) { masses.splice(i, 1); continue; }
        if (!hold.massId || hold.massId !== m.id) {
          if (kbMassId !== m.id) m.charge = Math.max(0, m.charge - dt * 1.6);
        }
      }
      for (let i = currents.length - 1; i >= 0; i--) if (now - currents[i].born > 900) currents.splice(i, 1);
      for (let i = pulses.length - 1; i >= 0; i--) {
        if ((lightT - pulses[i].bornLight) * c > Math.max(width, height) * 1.35) pulses.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        if ((lightT - rings[i].bornLight) * c > Math.max(width, height) * 0.9) rings.splice(i, 1);
      }
      if (orbit && now > orbit.until) orbit = null;

      // matter: comets fall toward wells, never past their cap
      const matterCap = MATTER_CAP * c;
      for (let i = comets.length - 1; i >= 0; i--) {
        const q = comets[i];
        const a = accelAt(pts, q.x, q.y, lawG * 0.35, SOFTENING);
        q.vx += (a.ax + aetherX * c * 0.4) * dt * timeScale;
        q.vy += (a.ay + aetherY * c * 0.4) * dt * timeScale;
        const sp = Math.hypot(q.vx, q.vy);
        if (sp > matterCap) { q.vx *= matterCap / sp; q.vy *= matterCap / sp; }
        q.x += q.vx * dt * timeScale;
        q.y += q.vy * dt * timeScale;
        q.trail.push({ x: q.x, y: q.y });
        if (q.trail.length > 30) q.trail.shift();
        pushHist(q.hist, q.x);
        let gone = q.x < -70 || q.x > width + 70 || q.y < -70 || q.y > height + 70 || now - q.born > 14000;
        for (const p of pts) {
          if (Math.hypot(q.x - p.x, q.y - p.y) < 12) {
            gone = true;
            if (now - lastCaptureSoundAt > 1500) { lastCaptureSoundAt = now; note(28, 180); }
            break;
          }
        }
        if (gone) comets.splice(i, 1);
      }

      stepClock(clockA, clockB, pts, dt, now);
      stepClock(clockB, clockA, pts, dt, now);
      stepLantern(dt);
      stepCar(dt);
      stepBeacons(dt, now, pts);

      // the span's photon: it bounces between the fingertips at exactly c on
      // the light clock, so the tick period is the spread itself — and the
      // three-finger law slows this photon like every other light
      if (spanClock.active) {
        const dist = Math.max(24, Math.hypot(spanClock.bx - spanClock.ax, spanClock.by - spanClock.ay));
        spanClock.s += ((c * dt * (reduce ? 1 : rayScale)) / dist) * spanClock.dir;
        if (spanClock.s >= 1 || spanClock.s <= 0) {
          spanClock.s = clamp01(spanClock.s);
          spanClock.dir *= -1;
          if (now - lastSpanTickAt > 90) {
            lastSpanTickAt = now;
            // the geometry heard: a wider interval ticks lower and slower
            note(60 - Math.round(clamp01(dist / 500) * 18), 60 + spanClock.held * 60);
            try { haptics.tap(); } catch { /* noop */ }
          }
        }
      }

      // ————— background: ink with a cold slow breath —————
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, "#05070c");
      bg.addColorStop(0.6, "#05070e");
      bg.addColorStop(1, "#070810");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      const breathA = reduce ? 0.05 : 0.04 + Math.sin(localT * Math.PI * 2 * 0.14) * 0.015;
      const halo = ctx.createRadialGradient(width * 0.5, height * 0.36, 20, width * 0.5, height * 0.36, Math.max(width, height) * 0.8);
      halo.addColorStop(0, `rgba(130, 160, 220, ${breathA})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);
      // the season's veil — the law leaning toward its own inversion
      if (season > 0.02) {
        ctx.fillStyle = `rgba(220, 120, 70, ${(season * 0.05).toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }

      // two fingers pan the frame — mesh and masses are the room's "map"
      // layer, so they're what visibly rides the pan (matching ManifoldFold)
      ctx.save();
      ctx.translate(panX, panY);

      // ————— the mesh: hairlines, welling only where mass gathers —————
      // grid resolution scales with the frame governor's tier
      const meshGap = MESH_GAP / Math.max(0.4, detail.samples);
      if (pts.length > 0 || pulses.length > 0) {
        const cols = Math.ceil(width / meshGap) + 1;
        const rows = Math.ceil(height / meshGap) + 1;
        const vx: number[] = new Array(cols * rows);
        const vy: number[] = new Array(cols * rows);
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const x = i * meshGap;
            const y = j * meshGap;
            const d = dispAt(x, y, pts);
            vx[j * cols + i] = x + d.dx;
            vy[j * cols + i] = y + d.dy;
          }
        }
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = "rgba(206, 222, 250, 0.045)";
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
      }

      // ————— masses: dark presences with a cold rim —————
      // the two per-mass falloffs are cached sprites blitted with drawImage
      // (never a fresh createRadialGradient per mass, per frame)
      let fieldMassCount = 0;
      for (const m of masses) {
        const mx = m.nx * width;
        const my = m.ny * height;
        const grow = m.settled ? 1 : 0.3 + 0.7 * m.growth;
        let R = (10 + m.m * 16) * grow;
        let evapP = 0;
        if (m.evapAt) {
          evapP = clamp01((now - m.evapAt) / EVAP_MS);
          R *= 1 - evapP * 0.85;
        }
        const depth = wellDepth(pts, mx, my, SOFTENING);
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
        ctx.strokeStyle = `rgba(150, 175, 225, ${(m.settled ? 0.13 : 0.3) * (1 - evapP)})`;
        ctx.lineWidth = m.settled ? 0.8 : 1.2;
        ctx.beginPath();
        ctx.arc(mx, my, R, 0, Math.PI * 2);
        ctx.stroke();
        if (m.charge > 0 && !m.evapAt) {
          ctx.strokeStyle = `rgba(231, 172, 82, ${0.25 + m.charge * 0.5})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(mx, my, R + 7, -Math.PI / 2, -Math.PI / 2 + m.charge * Math.PI * 2);
          ctx.stroke();
        }
        if (m.evapAt) {
          const flare = Math.sin(evapP * Math.PI);
          const fr = R + evapP * 90;
          if (flare > 0.01) {
            ctx.globalAlpha = flare;
            ctx.drawImage(flashSprite, mx - fr, my - fr, fr * 2, fr * 2);
            ctx.globalAlpha = 1;
          }
        }
        if (fieldMassCount < fieldMasses.length) {
          const fm = fieldMasses[fieldMassCount++];
          fm.x = mx + panX; fm.y = my + panY; fm.r = R;
          fm.strength = clamp01(m.m / 2.0) * (1 - evapP);
        }
      }
      for (let k = fieldMassCount; k < fieldMasses.length; k++) fieldMasses[k].strength = 0;
      ctx.restore();

      // ————— the curvature field: additive lensing ring, WebGL —————
      // shared verbatim with ManifoldFold (SPEC fix 2) — one shader pass
      // sums every live mass's ring instead of a per-mass gradient
      if (field?.ok) {
        field.draw(now, fieldMasses, {
          core: [0.7, 0.62, 0.95],
          ring: [0.86, 0.78, 1.0],
          alpha: (1 - lens) * 0.75,
          reduced: reduce,
        });
      }

      // ————— pulses: your ring, at exactly c, first across any line —————
      for (const p of pulses) {
        const rf = (lightT - p.bornLight) * c;
        const prog = clamp01(rf / (Math.max(width, height) * 1.2));
        if (rf < 2) continue;
        ctx.strokeStyle = `rgba(198, 216, 248, ${0.24 * p.strength * (1 - prog)})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rf, 0, Math.PI * 2);
        ctx.stroke();
      }

      // ————— lantern wavefronts: bunched blue ahead, stretched red behind —————
      {
        const SEG = 22;
        for (const ring of rings) {
          const rf = (lightT - ring.bornLight) * c;
          if (rf < 3) continue;
          const fade = clamp01(1 - rf / (Math.max(width, height) * 0.85));
          for (let s = 0; s < SEG; s++) {
            const a0 = (s / SEG) * Math.PI * 2;
            const a1 = ((s + 1) / SEG) * Math.PI * 2;
            const am = (a0 + a1) / 2;
            const cosA = Math.cos(am) * ring.dx + Math.sin(am) * ring.dy;
            const shift = dopplerShift(ring.beta * cosA * c, c);
            const t = clamp((shift - 1) * 1.4, -1, 1);
            const rr = t > 0 ? Math.round(mix(240, 130, t)) : Math.round(mix(240, 255, -t));
            const gg = t > 0 ? Math.round(mix(228, 175, t)) : Math.round(mix(228, 130, -t));
            const bb = t > 0 ? Math.round(mix(210, 255, t)) : Math.round(mix(210, 90, -t));
            ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${0.22 * fade * (0.5 + 0.5 * Math.abs(t) + 0.3)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(ring.x, ring.y, rf, a0, a1);
            ctx.stroke();
          }
        }
      }

      // ————— light: few rays racing, bending hard, never slowing —————
      if (!reduce) {
        const stepDt = (dt * rayScale) / 4;
        for (const r of rays) {
          for (let s = 0; s < 4; s++) {
            const st = geodesicStep(pts, r, stepDt, c, lawG, SOFTENING);
            r.x = st.x; r.y = st.y; r.vx = st.vx; r.vy = st.vy;
            if (aetherX !== 0 || aetherY !== 0) {
              r.vx += aetherX * c * 0.5 * stepDt;
              r.vy += aetherY * c * 0.5 * stepDt;
              const sp = Math.hypot(r.vx, r.vy);
              if (sp > 0) { r.vx *= c / sp; r.vy *= c / sp; }
            }
            for (const cur of currents) {
              const age = (now - cur.born) / 900;
              if (age >= 1) continue;
              const d2 = (r.x - cur.x) * (r.x - cur.x) + (r.y - cur.y) * (r.y - cur.y);
              if (d2 > 170 * 170) continue;
              const k = Math.exp(-d2 / (120 * 120)) * (1 - age) * 2.4 * stepDt;
              r.vx += cur.dx * c * k;
              r.vy += cur.dy * c * k;
              const sp = Math.hypot(r.vx, r.vy);
              if (sp > 0) { r.vx *= c / sp; r.vy *= c / sp; }
            }
            if (orbit) {
              const ox = r.x - orbit.x;
              const oy = r.y - orbit.y;
              const od = Math.hypot(ox, oy);
              if (od > 8 && od < 190) {
                const sgn = orbit.omega >= 0 ? 1 : -1;
                const tx = (-oy / od) * sgn;
                const ty = (ox / od) * sgn;
                const k = Math.min(1, 6 * stepDt * Math.abs(orbit.omega));
                r.vx = mix(r.vx, tx * c, k);
                r.vy = mix(r.vy, ty * c, k);
                const sp = Math.hypot(r.vx, r.vy);
                if (sp > 0) { r.vx *= c / sp; r.vy *= c / sp; }
              }
            }
          }
          // doppler tint: blue falling in, red climbing out
          const a = accelAt(pts, r.x, r.y, lawG, SOFTENING);
          const am = Math.hypot(a.ax, a.ay);
          let w = 0;
          if (am > 1) {
            const proj = (r.vx * a.ax + r.vy * a.ay) / (am * c);
            w = clamp(proj * wellDepth(pts, r.x, r.y, SOFTENING) * 6, -1, 1);
          }
          r.trail.push({ x: r.x, y: r.y, w });
          if (r.trail.length > RAY_TRAIL) r.trail.shift();

          let captured = false;
          for (const p of pts) {
            if (Math.hypot(r.x - p.x, r.y - p.y) < 11) { captured = true; break; }
          }
          const gone = r.x < -60 || r.x > width + 60 || r.y < -60 || r.y > height + 60;
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

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const dimmed = rayScale < 0.5 ? 0.7 : 1;
        for (const r of rays) {
          const n = r.trail.length;
          for (let i = 1; i < n; i++) {
            const p0 = r.trail[i - 1];
            const p1 = r.trail[i];
            const f = i / n;
            const warm = p1.w < 0 ? -p1.w : 0;
            const cool = p1.w > 0 ? p1.w : 0;
            const rr = Math.round(mix(212, 255, warm) - cool * 60);
            const gg = Math.round(mix(226, 190, warm * 0.7) - cool * 30);
            const bb = Math.round(mix(255, 165, warm));
            ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${0.36 * f * f * dimmed * (1 - lens * 0.7)})`;
            ctx.lineWidth = 0.8 + f * 0.8;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
          }
          if (n > 0) {
            const h = r.trail[n - 1];
            const glow = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 7);
            glow.addColorStop(0, `rgba(240, 246, 255, ${0.9 * (1 - lens * 0.7)})`);
            glow.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      } else {
        // stilled light: the same geodesics as slow dashed traces
        if (staticRaysStale) rebuildStaticRays(pts);
        ctx.strokeStyle = "rgba(220, 232, 255, 0.16)";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([5, 9]);
        ctx.lineDashOffset = -((lightT * 12) % 14);
        for (const path of staticRayPaths) {
          ctx.beginPath();
          for (let i = 0; i < path.length; i++) {
            if (i === 0) ctx.moveTo(path[i].x, path[i].y);
            else ctx.lineTo(path[i].x, path[i].y);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // ————— comets: matter that lags the light, hotter the harder thrown —————
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const q of comets) {
        const rr = Math.round(160 + 95 * clamp01(q.heat * 1.4));
        const gg = Math.round(190 + 40 * q.heat - 60 * Math.max(0, q.heat - 0.6));
        const bb = Math.round(255 - 160 * q.heat);
        const n = q.trail.length;
        for (let i = 1; i < n; i++) {
          const f = i / n;
          ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${(0.1 + q.heat * 0.3) * f * f})`;
          ctx.lineWidth = 1 + f * (1.6 + q.heat * 1.6);
          ctx.beginPath();
          ctx.moveTo(q.trail[i - 1].x, q.trail[i - 1].y);
          ctx.lineTo(q.trail[i].x, q.trail[i].y);
          ctx.stroke();
        }
        const R = 3.5 + q.heat * 5;
        // the moving body is shorter along its motion by exactly 1/γ —
        // the head squashes into an ellipse, flattest at the matter cap
        const sp = Math.hypot(q.vx, q.vy);
        const squash = contractedLength(1, Math.min(sp / c, 0.95));
        const ang = sp > 1 ? Math.atan2(q.vy, q.vx) : 0;
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(ang);
        ctx.scale(squash, 1);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.4);
        g.addColorStop(0, `rgba(255, 250, 240, ${0.65 + q.heat * 0.35})`);
        g.addColorStop(0.5, `rgba(${rr}, ${gg}, ${bb}, ${0.3 + q.heat * 0.35})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, R * 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      // ————— the span's light clock: a photon held between two fingers —————
      if (spanClock.active) {
        const px = spanClock.ax + (spanClock.bx - spanClock.ax) * spanClock.s;
        const py = spanClock.ay + (spanClock.by - spanClock.ay) * spanClock.s;
        const glow = 0.3 + spanClock.held * 0.4;
        ctx.strokeStyle = `rgba(198, 216, 248, ${0.12 + spanClock.held * 0.14})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(spanClock.ax, spanClock.ay);
        ctx.lineTo(spanClock.bx, spanClock.by);
        ctx.stroke();
        for (const [ex, ey] of [[spanClock.ax, spanClock.ay], [spanClock.bx, spanClock.by]] as const) {
          ctx.strokeStyle = `rgba(198, 216, 248, ${glow * 0.6})`;
          ctx.beginPath();
          ctx.arc(ex, ey, 6, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(240, 246, 255, ${0.7 + spanClock.held * 0.3})`;
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // ————— the train: rest-length ghost, contracted car, one flash —————
      {
        const cy = carY();
        const halfC = contractedLength(carRestLen, carBetaEff) / 2;
        const held = carHeld || kbCarHold;
        // the strip: two hairlines the car rides between — its quiet track
        ctx.strokeStyle = "rgba(206, 222, 250, 0.05)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(0, cy - CAR_H / 2 - 9);
        ctx.lineTo(width, cy - CAR_H / 2 - 9);
        ctx.moveTo(0, cy + CAR_H / 2 + 9);
        ctx.lineTo(width, cy + CAR_H / 2 + 9);
        ctx.stroke();
        // rest-length ruler marks, fixed to the room, slid past and measured against
        ctx.strokeStyle = "rgba(206, 222, 250, 0.09)";
        ctx.beginPath();
        for (let gx = 0; gx <= width; gx += carRestLen / 2) {
          ctx.moveTo(gx, cy + CAR_H / 2 + 5);
          ctx.lineTo(gx, cy + CAR_H / 2 + 12);
        }
        ctx.stroke();
        // the ghost: the car's rest length riding along, never contracting
        ctx.strokeStyle = `rgba(206, 222, 250, ${held ? 0.32 : 0.17})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        ctx.strokeRect(carX - carRestLen / 2, cy - CAR_H / 2, carRestLen, CAR_H);
        ctx.setLineDash([]);
        // the car: translucent glass, short of its ghost by exactly 1/γ
        ctx.fillStyle = `rgba(140, 225, 205, ${0.1 + (held ? 0.06 : 0) + carBetaEff * 0.06})`;
        ctx.fillRect(carX - halfC, cy - CAR_H / 2, halfC * 2, CAR_H);
        ctx.strokeStyle = `rgba(150, 232, 210, ${0.45 + (held ? 0.2 : 0)})`;
        ctx.lineWidth = 1.1;
        ctx.strokeRect(carX - halfC, cy - CAR_H / 2, halfC * 2, CAR_H);
        // end posts, brightened by the tutti's glint
        const glint = clamp01(1 - (now - carGlintAt) / 260);
        ctx.strokeStyle = `rgba(190, 245, 228, ${0.5 + glint * 0.45})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const ex of [carX - halfC, carX + halfC]) {
          ctx.moveTo(ex, cy - CAR_H / 2 - 3);
          ctx.lineTo(ex, cy + CAR_H / 2 + 3);
        }
        ctx.stroke();
        // the midpoint lamp — the tappable heart of the demonstration
        ctx.fillStyle = "rgba(200, 248, 232, 0.9)";
        ctx.beginPath();
        ctx.arc(carX, cy, 2.6, 0, Math.PI * 2);
        ctx.fill();
        // keyboard retuning: the charge arc over the car
        if (kbCarHold && kbCharge > 0.04) {
          ctx.strokeStyle = `rgba(231, 172, 82, ${0.3 + kbCharge * 0.5})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(carX, cy, CAR_H * 1.4, -Math.PI / 2, -Math.PI / 2 + kbCharge * Math.PI * 2);
          ctx.stroke();
        }

        // the flash: photons at c both ways, the room's strikes rear-first,
        // and the car's own verdict — both ends blooming in one moment
        if (simFlash) {
          const sf = simFlash;
          const t = lightT - sf.born;
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          if (!reduce) {
            for (const [done, dir2, tArr] of [
              [sf.rearDone, -sf.sgn, sf.tRear],
              [sf.frontDone, sf.sgn, sf.tFront],
            ] as const) {
              if (done) continue;
              const px2 = sf.x0 + dir2 * c * Math.min(t, tArr);
              const g = ctx.createRadialGradient(px2, sf.y, 0, px2, sf.y, 6);
              g.addColorStop(0, "rgba(240, 246, 255, 0.95)");
              g.addColorStop(1, "rgba(0,0,0,0)");
              ctx.fillStyle = g;
              ctx.beginPath();
              ctx.arc(px2, sf.y, 6, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          for (const [done, ax2, tArr] of [
            [sf.rearDone, sf.rearX, sf.tRear],
            [sf.frontDone, sf.frontX, sf.tFront],
          ] as const) {
            if (!done) continue;
            const age = clamp01((t - tArr) / 0.8);
            if (age >= 1) continue;
            const rr2 = reduce ? 12 : 4 + age * 26;
            ctx.strokeStyle = `rgba(214, 228, 252, ${0.6 * (1 - age)})`;
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.arc(ax2, sf.y, rr2, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (sf.carDone) {
            const tCar = (sf.tRear + sf.tFront) / 2;
            const age = clamp01((t - tCar) / 0.9);
            if (age < 1) {
              const rr2 = reduce ? 14 : 5 + age * 22;
              ctx.strokeStyle = `rgba(150, 232, 210, ${0.55 * (1 - age)})`;
              ctx.lineWidth = 1.3;
              for (const ex of [carX - halfC, carX + halfC]) {
                ctx.beginPath();
                ctx.arc(ex, cy, rr2, 0, Math.PI * 2);
                ctx.stroke();
              }
            }
          }
          ctx.restore();
        }
      }

      // ————— the lantern: blue running ahead, red trailing behind —————
      {
        const sp = Math.hypot(lantern.vx, lantern.vy);
        const beta = clamp(sp / c, 0, 0.95);
        const dxn = sp > 1 ? lantern.vx / sp : 0;
        const dyn = sp > 1 ? lantern.vy / sp : 0;
        const body = ctx.createRadialGradient(lantern.x, lantern.y, 0, lantern.x, lantern.y, 26);
        body.addColorStop(0, "rgba(255, 226, 170, 0.9)");
        body.addColorStop(0.4, "rgba(231, 172, 82, 0.35)");
        body.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(lantern.x, lantern.y, 26, 0, Math.PI * 2);
        ctx.fill();
        if (beta > 0.04) {
          const lead = ctx.createRadialGradient(
            lantern.x + dxn * 14, lantern.y + dyn * 14, 0,
            lantern.x + dxn * 14, lantern.y + dyn * 14, 22,
          );
          lead.addColorStop(0, `rgba(150, 190, 255, ${0.5 * beta})`);
          lead.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = lead;
          ctx.beginPath();
          ctx.arc(lantern.x + dxn * 14, lantern.y + dyn * 14, 22, 0, Math.PI * 2);
          ctx.fill();
          const tail = ctx.createRadialGradient(
            lantern.x - dxn * 16, lantern.y - dyn * 16, 0,
            lantern.x - dxn * 16, lantern.y - dyn * 16, 24,
          );
          tail.addColorStop(0, `rgba(255, 120, 70, ${0.45 * beta})`);
          tail.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = tail;
          ctx.beginPath();
          ctx.arc(lantern.x - dxn * 16, lantern.y - dyn * 16, 24, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(255, 240, 205, 0.95)";
        ctx.beginPath();
        ctx.arc(lantern.x, lantern.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        if (lantern.held) {
          ctx.strokeStyle = "rgba(255, 226, 170, 0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(lantern.x, lantern.y, 32, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ————— the light clocks: the centerpiece, big and unmissable —————
      for (const k of [clockA, clockB]) {
        const topY = k.y - clockGap / 2;
        const botY = k.y + clockGap / 2;
        const grav = timeDilation(pts, k.x, k.y, DIL_K, DIL_SOFT);
        const gamma = lorentzGamma(k.vEff, c) / Math.max(0.25, grav);
        const slow = clamp01((gamma - 1) / 1.6); // 0 at rest → 1 well dilated
        // frame: a faint slot the clock lives in
        ctx.strokeStyle = `rgba(190, 208, 240, ${k.held ? 0.22 : 0.1})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(k.x - clockHalfW - 10, topY - 14, (clockHalfW + 10) * 2, clockGap + 28);
        // mirrors: two bars, flashing softly on each strike
        for (const [my, flash] of [[topY, k.flashTop], [botY, k.flashBot]] as const) {
          const f = clamp01(1 - (now - flash) / 220);
          ctx.fillStyle = `rgba(220, 232, 255, ${0.35 + f * 0.5})`;
          ctx.fillRect(k.x - clockHalfW, my - 2.5, clockHalfW * 2, 5);
        }
        // the photon: a world-trail — diagonals appear the moment it moves
        const py = topY + k.phase * clockGap;
        if (!reduce) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          const n = k.photonTrail.length;
          for (let i = 1; i < n; i++) {
            const f = i / n;
            ctx.strokeStyle = `rgba(255, ${Math.round(246 - slow * 60)}, ${Math.round(235 - slow * 110)}, ${0.55 * f * f})`;
            ctx.lineWidth = 1 + f * 1.2;
            ctx.beginPath();
            ctx.moveTo(k.photonTrail[i - 1].x, k.photonTrail[i - 1].y);
            ctx.lineTo(k.photonTrail[i].x, k.photonTrail[i].y);
            ctx.stroke();
          }
          const glow = ctx.createRadialGradient(k.x, py, 0, k.x, py, 9);
          glow.addColorStop(0, `rgba(255, ${Math.round(250 - slow * 60)}, ${Math.round(240 - slow * 120)}, 0.95)`);
          glow.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(k.x, py, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          // stilled: the geometry itself — vertical at rest, a long diagonal
          // in motion; the comparison carries even without the flight
          const vert = Math.sqrt(Math.max(0, c * c - k.vEff * k.vEff));
          const legT = vert > 1 ? clockGap / vert : 0;
          const sp = Math.hypot(k.vx, k.vy);
          const dxLeg = sp > 1 ? (k.vx / sp) * Math.min(sp, CLOCK_V_CAP * c) * legT : 0;
          ctx.strokeStyle = `rgba(255, ${Math.round(246 - slow * 60)}, ${Math.round(235 - slow * 110)}, 0.55)`;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.moveTo(k.x - dxLeg / 2, topY);
          ctx.lineTo(k.x, botY);
          ctx.lineTo(k.x + dxLeg / 2, topY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(255, 246, 235, 0.9)";
          ctx.beginPath();
          ctx.arc(k.x, (topY + botY) / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ————— twin beacons: time worn as rings; one can be sent away —————
      {
        const reunLive = now - reunionAt < REUNION_MS;
        // the stilled journey: the bent path drawn, not flown — reduced
        // motion keeps the paradox teachable as a comparison at rest
        if (journey && reduce) {
          ctx.strokeStyle = "rgba(255, 200, 130, 0.3)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 6]);
          ctx.beginPath();
          journey.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // the traveler's arc, glowing faintly behind it
        if (journey && !reduce && journey.trail.length > 1) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          const n = journey.trail.length;
          for (let i = 1; i < n; i++) {
            const f = i / n;
            ctx.strokeStyle = `rgba(255, 200, 130, ${0.2 * f * f})`;
            ctx.lineWidth = 1 + f;
            ctx.beginPath();
            ctx.moveTo(journey.trail[i - 1].x, journey.trail[i - 1].y);
            ctx.lineTo(journey.trail[i].x, journey.trail[i].y);
            ctx.stroke();
          }
          ctx.restore();
        }
        const spots: Array<[Beacon, number]> = [[beaconA, 0], [beaconB, 1]];
        for (const [bcn, bi] of spots) {
          const bx = bcn.x;
          const by = bcn.y;
          // gravity and motion both lean on this clock — one rate, felt
          const f = timeDilation(pts, bx, by, DIL_K, DIL_SOFT);
          const rate = f * properTimeRatio(bcn.beta);
          if (!reduce) beaconPhase[bi] += dt * timeScale * Math.PI * 2 * 0.55 * rate;
          const blink = reduce
            ? 0.35 + 0.5 * rate
            : Math.pow(0.5 + 0.5 * Math.sin(beaconPhase[bi]), 3);
          const warmth = clamp01((1 - rate) * 1.9);
          const rr = Math.round(mix(223, 255, warmth));
          const gg = Math.round(mix(233, 158, warmth));
          const bb = Math.round(mix(255, 106, warmth));
          const a = 0.2 + blink * 0.7;
          const pulseUp = reunLive
            ? 1 + 0.45 * Math.sin(clamp01((now - reunionAt) / 900) * Math.PI)
            : 1;
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, 13 * pulseUp);
          g.addColorStop(0, `rgba(${rr}, ${gg}, ${bb}, ${a})`);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(bx, by, 13 * pulseUp, 0, Math.PI * 2);
          ctx.fill();
          // rings of proper time, accreted like tree rings — no numerals;
          // after the journey the traveler simply has fewer of them
          const flash = now - bcn.ringFlashAt < 1200;
          const ringScale = reunLive ? 1.6 : flash ? 1.35 : 1;
          const ringsF = bcn.tau / RING_TAU;
          const full = Math.floor(ringsF);
          const shown = Math.min(full, RINGS_SHOWN);
          const ringA = 0.1 + blink * 0.05 + (reunLive || flash ? 0.16 : 0);
          ctx.lineWidth = 1;
          for (let i = 0; i < shown; i++) {
            const r = (5.5 + (i + 1) * 2.3) * ringScale;
            ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${ringA * (0.45 + 0.55 * ((i + 1) / (shown + 1)))})`;
            ctx.beginPath();
            ctx.arc(bx, by, r, 0, Math.PI * 2);
            ctx.stroke();
          }
          // the ring still accreting: a fractional arc, slow as aging
          const frac = ringsF - full;
          if (frac > 0.02) {
            const r = (5.5 + (shown + 1) * 2.3) * ringScale;
            ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${ringA + 0.12})`;
            ctx.beginPath();
            ctx.arc(bx, by, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
            ctx.stroke();
          }
          // the traveler's mark: a faint dashed halo — the one that can go
          if (bi === 0 && !journey) {
            ctx.strokeStyle = `rgba(255, 200, 130, ${0.14 + blink * 0.08})`;
            ctx.setLineDash([2, 5]);
            ctx.beginPath();
            ctx.arc(bx, by, (5.5 + (shown + 2) * 2.3) * ringScale + 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, ${0.5 + blink * 0.5})`;
          ctx.beginPath();
          ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ————— the lens: the room re-read as a Minkowski diagram —————
      if (lens > 0.02) {
        ctx.fillStyle = `rgba(4, 6, 11, ${lens * 0.86})`;
        ctx.fillRect(0, 0, width, height);
        const la = lens;
        const topY = height * 0.14;
        const botY = height * 0.92;
        const yOf = (tau: number) => topY + (lightT - tau) * c;
        // the now-line, and thin mono numerals — the room's only notation
        ctx.strokeStyle = `rgba(206, 222, 250, ${0.35 * la})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, topY);
        ctx.lineTo(width, topY);
        ctx.stroke();
        ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
        ctx.textAlign = "right";
        for (let kk = 0; ; kk++) {
          const tauBack = kk * 0.25;
          const y = topY + tauBack * c;
          if (y > botY) break;
          ctx.strokeStyle = `rgba(206, 222, 250, ${(kk === 0 ? 0 : 0.1) * la})`;
          if (kk > 0) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
          }
          ctx.fillStyle = `rgba(206, 222, 250, ${0.45 * la})`;
          ctx.fillText(tauBack === 0 ? "0" : `−${tauBack.toFixed(2)}`, width - 8, y - 4);
        }
        // light cones from each pulse: exactly 45°, always
        for (const p of pulses) {
          const y0 = yOf(p.bornLight);
          if (y0 < topY || y0 > botY + width) continue;
          const span = y0 - topY; // px of elapsed light-time = px of reach
          ctx.strokeStyle = `rgba(240, 246, 255, ${0.5 * la * p.strength})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, Math.min(y0, botY));
          ctx.lineTo(p.x - span, topY);
          ctx.moveTo(p.x, Math.min(y0, botY));
          ctx.lineTo(p.x + span, topY);
          ctx.stroke();
          ctx.fillStyle = `rgba(240, 246, 255, ${0.7 * la})`;
          ctx.beginPath();
          ctx.arc(p.x, Math.min(y0, botY), 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        // worldlines: rest is vertical, motion tilts, light alone touches 45°
        const drawWorldline = (
          hist: Array<{ x: number; tau: number }>,
          color: string,
          lw: number,
        ) => {
          if (hist.length < 2) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.beginPath();
          let started = false;
          for (const h of hist) {
            const y = yOf(h.tau);
            if (y > botY) { started = false; continue; }
            if (!started) { ctx.moveTo(h.x, y); started = true; }
            else ctx.lineTo(h.x, y);
          }
          ctx.stroke();
        };
        drawWorldline(clockA.hist, `rgba(206, 226, 255, ${0.75 * la})`, 1.3);
        drawWorldline(clockB.hist, `rgba(255, 214, 150, ${0.8 * la})`, 1.3);
        drawWorldline(lantern.hist, `rgba(231, 172, 82, ${0.55 * la})`, 1);
        // the car's worldline tilts with its speed; the twins' pair shows
        // the bend — and the bent line drops fewer proper-time dots below
        drawWorldline(carHist, `rgba(150, 232, 210, ${0.7 * la})`, 1.2);
        drawWorldline(beaconA.hist, `rgba(255, 200, 130, ${0.7 * la})`, 1.1);
        drawWorldline(beaconB.hist, `rgba(190, 214, 250, ${0.7 * la})`, 1.1);
        for (const q of comets) {
          drawWorldline(q.hist, `rgba(${Math.round(180 + 75 * q.heat)}, 200, ${Math.round(255 - 140 * q.heat)}, ${0.55 * la})`, 1);
        }
        // tick dots: the moving clock's ticks sit visibly farther apart
        for (const [k, col] of [[clockA, "206, 226, 255"], [clockB, "255, 214, 150"]] as const) {
          for (const t of k.ticks) {
            const y = yOf(t.tau);
            if (y < topY || y > botY) continue;
            ctx.fillStyle = `rgba(${col}, ${0.9 * la})`;
            ctx.beginPath();
            ctx.arc(t.x, y, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // proper-time dots: per stretch of room time, the bent worldline
        // drops fewer of them — the bent path IS the shorter one
        for (const [bcn, col] of [
          [beaconA, "255, 200, 130"],
          [beaconB, "190, 214, 250"],
        ] as const) {
          for (const t of bcn.tdots) {
            const y = yOf(t.tau);
            if (y < topY || y > botY) continue;
            ctx.fillStyle = `rgba(${col}, ${0.85 * la})`;
            ctx.beginPath();
            ctx.arc(t.x, y, 1.7, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // simultaneity, diagrammed: the flash's 45° legs, the room's
        // horizontal "at once" and the car's tilted one — the two strikes
        // straddling them, farther apart the faster the car ran
        if (simFlash) {
          const sf = simFlash;
          const yR = yOf(sf.born + sf.tRear);
          const yF = yOf(sf.born + sf.tFront);
          const yE = yOf(sf.born);
          if (Math.min(yR, yF) < botY && yE > topY) {
            ctx.strokeStyle = `rgba(240, 246, 255, ${0.4 * la})`;
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(sf.x0, Math.min(yE, botY));
            ctx.lineTo(sf.rearX, yR);
            ctx.moveTo(sf.x0, Math.min(yE, botY));
            ctx.lineTo(sf.frontX, yF);
            ctx.stroke();
            const yMid = (yR + yF) / 2;
            const ext = 40;
            ctx.strokeStyle = `rgba(206, 222, 250, ${0.5 * la})`;
            ctx.setLineDash([3, 5]);
            ctx.beginPath();
            ctx.moveTo(Math.min(sf.rearX, sf.frontX) - ext, yMid);
            ctx.lineTo(Math.max(sf.rearX, sf.frontX) + ext, yMid);
            ctx.stroke();
            ctx.setLineDash([]);
            const ddx = sf.frontX - sf.rearX;
            const ddy = yF - yR;
            const dl = Math.hypot(ddx, ddy) || 1;
            const ux = ddx / dl;
            const uy = ddy / dl;
            ctx.strokeStyle = `rgba(150, 232, 210, ${0.7 * la})`;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(sf.rearX - ux * ext, yR - uy * ext);
            ctx.lineTo(sf.frontX + ux * ext, yF + uy * ext);
            ctx.stroke();
            for (const [ex, ey] of [[sf.rearX, yR], [sf.frontX, yF]] as const) {
              if (ey < topY || ey > botY) continue;
              ctx.fillStyle = `rgba(240, 246, 255, ${0.9 * la})`;
              ctx.beginPath();
              ctx.arc(ex, ey, 2.6, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        // now-markers so the hand still finds its instruments under the lens
        for (const [x, col] of [
          [clockA.x, "206, 226, 255"],
          [clockB.x, "255, 214, 150"],
          [lantern.x, "231, 172, 82"],
          [carX, "150, 232, 210"],
          [beaconA.x, "255, 200, 130"],
          [beaconB.x, "190, 214, 250"],
        ] as const) {
          ctx.fillStyle = `rgba(${col}, ${0.85 * la})`;
          ctx.beginPath();
          ctx.arc(x, topY, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // glimmer — after quiet, a ring where a dwell would land (never text)
      const idleMs = now - lastInteractionAt;
      if (idleMs > 20000) {
        const slot = Math.floor(now / 9000);
        const gx = (0.22 + hash01(slot) * 0.56) * width;
        const gy = (0.5 + hash01(slot + 7) * 0.38) * height;
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        ctx.strokeStyle = `rgba(231, 172, 82, ${0.08 + pulse * 0.1})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gx, gy, 14 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // keyboard cursor
      if (focused && cursorVisible) {
        const cx = cursorNx * width;
        const cy = cursorNy * height;
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
    };
    raf = requestAnimationFrame(draw);
    // no draw while hidden or paused inside a gallery iframe
    const offVis = onVisibility((hiddenNow) => {
      sleeping = hiddenNow;
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
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      wrap.removeEventListener("focus", onFocus);
      wrap.removeEventListener("blur", onBlur);
      mq.removeEventListener?.("change", onMq);
      offVis();
      offGallery();
      trainTimers.forEach((t) => clearTimeout(t));
      field?.dispose();
      try { getFieldAudio().releaseConcernTone("love"); } catch { /* noop */ }
      try { getFieldAudio().releaseConcernTone("season"); } catch { /* noop */ }
    };
  }, []);

  return (
    <div className="relativity-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={wrapRef}
        className="relativity-field"
        role="application"
        tabIndex={0}
        aria-label="relativity — light keeps its own covenant; tap and your ring runs at the one speed, flick matter and watch it lose the race, drag a clock and hear its tick slow, rest a finger and a mass gathers to slow the beacons near it; tap the gliding car and one flash strikes its rear first by the room's count, drag the car to set its pace and watch it fall short of its resting ghost, flick the haloed beacon and it journeys home younger, its rings fewer; arrows walk, enter pulses and, held, gathers, collapses, or retunes the car; escape lowers the lens"
      >
        <canvas ref={canvasRef} className="relativity-canvas" aria-hidden="true" />
        <canvas ref={fieldCanvasRef} className="relativity-field-canvas" aria-hidden="true" />
      </div>

      <LetGo label="let the field go" onLetGo={() => letGoRef.current()} visible={standing} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .relativity-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          background: #05070c;
          overflow: hidden;
        }

        .relativity-field {
          position: relative;
          min-height: 100svh;
          isolation: isolate;
          overflow: hidden;
          outline: none;
        }

        .relativity-field:focus-visible {
          outline: 2px solid rgba(231, 172, 82, 0.7);
          outline-offset: -2px;
        }

        body:has(.relativity-page) {
          overflow: hidden;
          background: #05070c;
        }

        body:has(.relativity-page) header:not(.oda-site-header) {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.relativity-page) .oda-field-watch,
        body:has(.relativity-page) .oda-candle-mark,
        body:has(.relativity-page) .oda-tape-shell,
        body:has(.relativity-page) .oda-sound-toggle {
          display: none !important;
        }

        .relativity-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          cursor: crosshair;
          touch-action: none;
          z-index: 0;
        }

        .relativity-field-canvas {
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
