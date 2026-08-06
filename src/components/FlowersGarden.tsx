"use client";

/**
 * /flowers — a living garden of discrete, deterministic species (W4).
 *
 * Every flower is a point in the botany latent (src/lib/botany.ts): its seed
 * is a hash of where and when it was planted, and the same seed decodes to
 * the same species forever. The hand speaks the shared grammar through
 * lib/gesture — rest a finger anywhere and the soil gathers light under it;
 * at the touch tier (250ms) a seed takes, and holding on carries it
 * bud → bloom → close (the bloom lands in the palm via haptics.bloom()).
 * Tap sways, three fingers are wind and time, a twist rotates the lens from
 * felt garden to botanical diagram. A ceremony hold on a spent flower wilts
 * it back into the soil; the quiet clear control (LetGo, RoomTemplate §8c)
 * at bottom-center lets the whole garden go.
 * Volunteers sprout on their own seeded schedule, bloom, and return to soil —
 * the room lives while watched and stays calm when glanced at. All breath
 * rides the site's shared 0.14 Hz swell. The garden persists in
 * `objetdart:flowers:v1` (volunteers never persist).
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures, THRESHOLDS } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import LetGo from "@/components/LetGo";
import {
  BLOOM_PEAK,
  GOLDEN_ANGLE,
  LATENT_DIM,
  canopySpread,
  crossLatent,
  flowerGeometry,
  hashSeed,
  petalOutline,
  rootOverlap,
  shadeFrom,
  speciesFromLatent,
  speciesFromSeed,
  vigour as vigourOf,
  type FlowerGeometry,
  type Species,
} from "@/lib/botany";
import {
  resolveDpr,
  onGalleryPause,
  onVisibility,
  isEmbeddedFrame,
  createFrameGovernor,
  detailForTier,
} from "@/lib/room-runtime";

const STORE_KEY = "objetdart:flowers:v1";
const MAX_PLANTS = 28;
const MAX_VOLUNTEERS = 6;
const GEO_EPS = 0.004;
const WILT_MS = 1700;
const WILT_MS_REDUCED = 650;

type Plant = {
  id: string;
  seed: number;
  nx: number;
  ny: number;
  phase: number; // phenophase 0..1
  plantedAt: number;
  bloomed: boolean; // crossed BLOOM_PEAK at least once
  species: Species;
  geo: FlowerGeometry | null;
  geoPhase: number;
  swayX: number;
  swayV: number;
  breathOffset: number;
  // screen-space head center + radius, refreshed every draw, for hit tests
  hx: number;
  hy: number;
  hr: number;
  bx: number;
  by: number;
  lastBrushAt: number;
  // the bloom moment (performance.now), for the overshoot-and-settle pulse
  bloomAt: number;
  // 0..1 overbloom: a hold kept past full bloom keeps deepening — the crown
  // breathes wider, then slowly settles back (duration is an axis)
  over: number;
  // ambient volunteers: transient, never persisted
  volunteer: boolean;
  volAge: number; // dilated ms lived so far
  volLife: number; // ms from sprout to soil
  // wilting: stem bows, petals fall, the space frees
  wiltAt: number | null;
  wiltStep: number;
  wiltDir: number;
  blowAway: boolean;
  // —— what the neighbours do to it ——
  /** 0..1 of full sun, after everything taller standing over it */
  light: number;
  /** 0..1 of its root disc shared with somebody else's */
  rootShare: number;
  /** what is left of the plant after light and root competition */
  vigour: number;
  /** 0..1 — pollen the head is carrying, spent when a grain leaves */
  pollen: number;
  /** born of two parents rather than of a seed */
  crossed: boolean;
};

/** A grain in flight, from one head toward another. */
type Grain = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fromId: string;
  fromSeed: number;
  seed: number;
  born: number;
  color: string;
};

/** A pollinator working the garden — it carries what it last touched. */
type Bee = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  seed: number;
  born: number;
  /** the plant it last drank at, whose pollen it is carrying */
  carrying: string | null;
  carrySeed: number;
  targetId: string | null;
};

type Speck = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  r: number;
  color: string;
  swirl: number;
};

type Stored = {
  count: number;
  plants: Array<{
    id: string;
    seed: number;
    nx: number;
    ny: number;
    phase: number;
    plantedAt: number;
    /** a crossed plant's own genome — without it a hybrid would come back
     *  as whatever its seed alone decodes to, and the cross would be lost */
    lat?: number[];
  }>;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

function colorAlpha(hex: string, alpha: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

/** Deterministic blend of two token colors — the realism pass never leaves the families. */
function mixHex(a: string, b: string, t: number): string {
  const va = parseInt(a.slice(1), 16);
  const vb = parseInt(b.slice(1), 16);
  const r = Math.round(((va >> 16) & 255) * (1 - t) + ((vb >> 16) & 255) * t);
  const g = Math.round(((va >> 8) & 255) * (1 - t) + ((vb >> 8) & 255) * t);
  const bl = Math.round((va & 255) * (1 - t) + (vb & 255) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, "0")}`;
}

function twinkleHash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** Same PRNG family as the botany latent — seeded, advanced per event, never Math.random. */
function mulberry32(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePlant(
  seed: number,
  nx: number,
  ny: number,
  phase: number,
  plantedAt: number,
  latent?: number[],
): Plant {
  // A crossed child carries a genome of its own — half of each parent, locus
  // by locus — and it is decoded by exactly the same decoder a seeded plant
  // is, so a hybrid is a real flower and not two pictures blended.
  const species = latent ? speciesFromLatent(latent, seed) : speciesFromSeed(seed);
  return {
    id: `fl-${seed.toString(36)}-${Math.round(nx * 997)}`,
    seed,
    nx,
    ny,
    phase,
    plantedAt,
    bloomed: phase >= BLOOM_PEAK,
    species,
    geo: null,
    geoPhase: -1,
    swayX: 0,
    swayV: 0,
    breathOffset: species.latent[28] * 7,
    hx: -1,
    hy: -1,
    hr: 0,
    bx: -1,
    by: -1,
    lastBrushAt: 0,
    bloomAt: 0,
    over: 0,
    volunteer: false,
    volAge: 0,
    volLife: 0,
    wiltAt: null,
    wiltStep: 0,
    wiltDir: 1,
    blowAway: false,
    light: 1,
    rootShare: 0,
    vigour: 1,
    pollen: phase >= BLOOM_PEAK ? 1 : 0,
    crossed: latent != null,
  };
}

// the first visit is never an empty field — three deterministic residents
const STARTERS: Array<[number, number, number]> = [
  [0.3, 0.66, 0.72],
  [0.57, 0.74, 0.4],
  [0.75, 0.58, 0.14],
];

function loadStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || !Array.isArray(parsed.plants)) return null;
    // an empty plants list is a real state (the garden was let go) — starters
    // do not respawn over a deliberate clearing.
    return {
      count: typeof parsed.count === "number" ? parsed.count : parsed.plants.length,
      plants: parsed.plants.filter(
        (p) =>
          p &&
          typeof p.seed === "number" &&
          typeof p.nx === "number" &&
          typeof p.ny === "number" &&
          typeof p.phase === "number",
      ),
    };
  } catch {
    return null;
  }
}

/** midi voice of a species — petals set the degree, the latent detunes it */
function midiOf(sp: Species): number {
  return 52 + (sp.petals % 13) + Math.round(sp.latent[25] * 7);
}

export default function FlowersGarden() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const letGoRef = useRef<() => void>(() => {});
  // how many planted (persisted) flowers stand — gates the letting-go affordance
  const [plantedAlive, setPlantedAlive] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state (all refs of the effect closure) —————
    let plants: Plant[] = [];
    let plantCount = 0;
    const specks: Speck[] = [];
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let lastFrame = 0;
    let last = performance.now();
    let localT = 0; // dilatable clock for particles / twinkle
    let reduce = false;
    let wind = 0;
    let windTarget = 0;
    let tiltWind = 0; // the vessel's lean: wind toward the downhill side
    let lastTiltSoundAt = 0;
    let lastTuttiAt = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let zoom = 1;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let lastInteractionAt = performance.now();
    let lastSaveAt = 0;
    let dirty = false;
    let focused = false;
    let cursorNx = 0.5;
    let cursorNy = 0.6;
    let cursorVisible = false;
    let lastGrowNoteAt = 0;
    let lastGrowHapticAt = 0;
    let lastBrushSoundAt = 0;
    let lastWindSoundAt = 0;
    let lastScrubAt = 0;
    // the hand's tempo, entrained into the beds: they sway on the pulse
    let pulseBpm = 0;
    let pulseUntil = 0;
    let lastBeatIdx = -1;
    let clearing = false;
    const hold: { plantId: string | null; doneId: string | null } = { plantId: null, doneId: null };
    let keyWilt: { id: string; t0: number } | null = null;

    // ————— performance contract (room-runtime): governed detail, hard sleep
    // while hidden or gallery-paused, DPR ceiling by tier —————
    const embedded = isEmbeddedFrame();
    const governor = createFrameGovernor(embedded ? "medium" : "high");
    let currentTier = governor.tier();
    let detail = detailForTier(currentTier);
    let docHidden = false;
    let galleryPaused = embedded;
    let sleeping = docHidden || galleryPaused;
    // two-finger pan (grammar §5): offsets the frame, clamped to a gentle range
    let panX = 0;
    let panY = 0;
    let panTargetX = 0;
    let panTargetY = 0;
    // three-finger twist = season (grammar §5): a slow cyclic tint + growth mood
    let season = 0; // 0..4, wraps — spring/summer/autumn/winter
    let seasonTarget = 0;
    let seasonSnapped = 0;
    // flip face-down = night (vessel): the garden dims and hushes
    let night = false;
    let nightAmt = 0;

    // fingertip charge — visual only; every semantic threshold stays in the
    // gesture engine. These listeners never plant, never time gestures: they
    // only let the draw loop show the soil answering from the first ms of
    // contact, so no press is ever silent.
    let pressOn = false;
    let pressX = 0;
    let pressY = 0;
    let pressT0 = 0;
    let pressContacts = 0;

    // ambient volunteers — a seeded scheduler, advanced one draw per event.
    // Law: prng = mulberry32(hashSeed(dayNumber, 0x766c)); next sprout at
    // +20s..45s of dilated room time; spot = best of 5 candidates by distance
    // to the living; life 120s..240s: rise → bloom → linger → close → soil.
    const volRng = mulberry32(hashSeed(Math.floor(Date.now() / 86400000), 0x766c));
    let volClock = 0; // dilated seconds
    let nextVolAt = 20 + volRng() * 25;
    let volSpawned = 0;

    // ————— what the plants do to each other —————
    // Light and root space are competed for every frame; pollen actually
    // travels, and where a grain lands on another open head a seed is set
    // whose genome is half of each parent — a plant that is neither.
    const grains: Grain[] = [];
    const bees: Bee[] = [];
    let crossCount = 0;
    /** the open-soil cycle: a pollinator, rain, frost */
    let soilEventIdx = 0;
    /** rain and frost, as the weather the garden is actually under */
    let rainUntil = 0;
    let frostUntil = 0;
    /** the top rung: a season racing the length of the garden */
    let seasonRace: { x: number; u: number; speed: number; gain: number } | null = null;
    /** the garden's own pollination clock */
    let nextPollenAt = 0;
    let pollenTick = 0;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => { reduce = mq.matches; };
    mq.addEventListener?.("change", onMq);

    const offVisibility = onVisibility((hidden) => {
      docHidden = hidden;
      sleeping = docHidden || galleryPaused;
      if (sleeping) governor.force("sleep");
    });
    const offGalleryPause = onGalleryPause((paused) => {
      galleryPaused = paused;
      sleeping = docHidden || galleryPaused;
      if (sleeping) governor.force("sleep");
    });

    const syncPlanted = () => {
      setPlantedAlive(plants.filter((p) => !p.volunteer && p.wiltAt == null).length);
    };

    // ————— persistence (volunteers and the wilting never persist) —————
    const save = (force = false) => {
      const now = performance.now();
      if (!force && now - lastSaveAt < 800) { dirty = true; return; }
      lastSaveAt = now;
      dirty = false;
      try {
        const stored: Stored = {
          count: plantCount,
          plants: plants
            .filter((p) => !p.volunteer && p.wiltAt == null)
            .map((p) => ({
              id: p.id,
              seed: p.seed,
              nx: p.nx,
              ny: p.ny,
              phase: p.phase,
              plantedAt: p.plantedAt,
              // only a cross needs its genome written: a seeded plant decodes
              // back out of its seed exactly
              ...(p.crossed ? { lat: p.species.latent.map((v) => Math.round(v * 1000) / 1000) } : {}),
            })),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      } catch { /* quota; the garden lives on in memory */ }
    };

    const stored = loadStored();
    if (stored) {
      plantCount = stored.count;
      plants = stored.plants.slice(-MAX_PLANTS).map((p) =>
        makePlant(
          p.seed,
          clamp01(p.nx),
          clamp01(p.ny),
          clamp01(p.phase),
          p.plantedAt || Date.now(),
          Array.isArray(p.lat) && p.lat.length >= LATENT_DIM
            ? p.lat.slice(0, LATENT_DIM).map((v) => clamp01(Number(v) || 0))
            : undefined,
        ),
      );
    } else {
      plants = STARTERS.map(([nx, ny, phase], i) =>
        makePlant(hashSeed(Math.round(nx * 997), Math.round(ny * 991), i), nx, ny, phase, Date.now()),
      );
      plantCount = plants.length;
      save(true);
    }
    syncPlanted();

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };

    // background wash + ambient glow — recomputed only on resize, never per
    // frame (a per-frame createLinearGradient/createRadialGradient is the
    // hazard the performance contract forbids).
    let bgGrad: CanvasGradient | null = null;
    let glowGrad: CanvasGradient | null = null;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = resolveDpr(currentTier, { embedded, reducedMotion: reduce, maxDpr: 1.5 });
      width = Math.max(320, Math.floor(r.width));
      height = Math.max(480, Math.floor(r.height));
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, "#0a1214");
      bgGrad.addColorStop(0.62, "#0d1a1c");
      bgGrad.addColorStop(1, "#122023");
      glowGrad = ctx.createRadialGradient(width * 0.5, height * 0.3, 10, width * 0.5, height * 0.42, Math.max(width, height) * 0.7);
      glowGrad.addColorStop(0, "rgba(231, 172, 82, 0.10)");
      glowGrad.addColorStop(0.5, "rgba(78, 125, 140, 0.05)");
      glowGrad.addColorStop(1, "rgba(0,0,0,0)");
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toLocal = (clientX: number, clientY: number) => ({
      x: clamp(clientX - rectLeft, 0, width),
      y: clamp(clientY - rectTop, 0, height),
    });

    // tight hit zones: the head answers within its own radius, the stem in a
    // narrow column strictly below the crown — open soil stays plantable.
    const plantAt = (x: number, y: number): Plant | null => {
      let best: Plant | null = null;
      let bestD = Infinity;
      for (const p of plants) {
        if (p.wiltAt != null) continue; // the leaving are past the hand
        const dHead = Math.hypot(x - p.hx, y - p.hy);
        const rHit = Math.max(18, p.hr);
        const stemHit = Math.abs(x - p.bx) < 8 && y > p.hy + p.hr && y < p.by + 6;
        if (dHead < rHit || stemHit) {
          const d = Math.min(dHead, Math.abs(x - p.bx));
          if (d < bestD) { bestD = d; best = p; }
        }
      }
      return best;
    };

    const burst = (x: number, y: number, colors: string[], n: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + twinkleHash(i + n) * 0.8;
        const s = speed * (0.4 + twinkleHash(i * 3 + 1) * 0.9);
        specks.push({
          x, y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s - speed * 0.3,
          born: performance.now(),
          life: 900 + twinkleHash(i * 7 + 2) * 1400,
          r: 0.8 + twinkleHash(i * 11 + 3) * 1.8,
          color: colors[i % colors.length],
          swirl: (twinkleHash(i * 13 + 4) - 0.5) * 2,
        });
      }
      if (specks.length > 220) specks.splice(0, specks.length - 220);
    };

    // petals leaving a wilting crown: they fall, or ride the parting wind
    const fallPetals = (x: number, y: number, colors: string[], n: number, blow: boolean) => {
      for (let i = 0; i < n; i++) {
        const h = twinkleHash(i * 5 + n * 3 + 1);
        specks.push({
          x: x + (twinkleHash(i * 7 + 2) - 0.5) * 26,
          y: y + (h - 0.5) * 14,
          vx: blow ? 26 + h * 46 : (h - 0.5) * 14,
          vy: blow ? -6 + h * 14 : 6 + h * 20,
          born: performance.now(),
          life: 1300 + h * 1300,
          r: 1.2 + twinkleHash(i * 11 + 5) * 2.2,
          color: colors[i % colors.length],
          swirl: (twinkleHash(i * 13 + 7) - 0.5) * 1.6,
        });
      }
      if (specks.length > 220) specks.splice(0, specks.length - 220);
    };

    const swayPlant = (p: Plant, impulse: number) => {
      p.swayV += impulse;
    };

    const doPlant = (x: number, y: number): Plant | null => {
      const nx = clamp01(x / width);
      const ny = clamp(y / height, 0.12, 0.96);
      const seed = hashSeed(Math.round(nx * 997), Math.round(ny * 991), plantCount);
      plantCount += 1;
      const p = makePlant(seed, nx, ny, 0, Date.now());
      plants.push(p);
      const planted = plants.filter((q) => !q.volunteer);
      if (planted.length > MAX_PLANTS) {
        const oldest = planted[0];
        plants.splice(plants.indexOf(oldest), 1);
      }
      // seed enters soil: two senses in the same frame
      try { audio().spark(); } catch { /* noop */ }
      note(midiOf(p.species) - 12, 160);
      try { haptics.ripple(0.55); } catch { /* noop */ }
      burst(x, y, [p.species.palette.stem, p.species.palette.heart], 8, 26);
      useField.getState().recordTape("object", 0.5, "flowers/plant");
      save();
      syncPlanted();
      return p;
    };

    /**
     * Fertilisation. A grain from one head reaches another open head, and a
     * seed sets: `crossLatent` takes each locus from one parent or the other,
     * so the seedling is a real cross and not a blend. Sight (a burst in both
     * parents' colours), sound (both parents' notes and a bell), and the
     * bloom word in the hand — one frame.
     */
    const setSeedFrom = (mother: Plant, fatherSeed: number, fatherLatent: number[]) => {
      if (clearing) return;
      const planted = plants.filter((q) => !q.volunteer && q.wiltAt == null);
      crossCount += 1;
      const seed = hashSeed(mother.seed, fatherSeed, crossCount);
      const latent = crossLatent(mother.species.latent, fatherLatent, seed);
      const side = twinkleHash(seed % 4093) > 0.5 ? 1 : -1;
      const nx = clamp(mother.nx + side * (0.05 + twinkleHash(seed % 997) * 0.06), 0.04, 0.96);
      const ny = clamp(mother.ny + (twinkleHash((seed >> 3) % 991) - 0.5) * 0.05, 0.12, 0.96);
      const child = makePlant(seed, nx, ny, 0, Date.now(), latent);
      child.volunteer = planted.length >= MAX_PLANTS; // at the cap it is the garden's, not the ledger's
      if (child.volunteer) child.volLife = 140000 + twinkleHash(seed % 3079) * 90000;
      plants.push(child);
      if (!child.volunteer) {
        plantCount += 1;
        const stillPlanted = plants.filter((q) => !q.volunteer);
        if (stillPlanted.length > MAX_PLANTS) {
          // at the cap the eldest visibly gives way — never a silent refusal
          beginWilt(stillPlanted[0], "volunteer", performance.now());
        }
        save();
        syncPlanted();
      }
      mother.pollen = Math.max(0, mother.pollen - 0.5);
      burst(
        mother.hx,
        mother.hy,
        [mother.species.palette.petal, child.species.palette.petal, child.species.palette.heart],
        16,
        44,
      );
      burst(child.nx * width, child.ny * height, [child.species.palette.stem, child.species.palette.glow], 8, 22);
      note(midiOf(mother.species), 120);
      window.setTimeout(() => note(midiOf(child.species), 220), 110);
      try { audio().bell(); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
      useField.getState().recordTape("sigil", 0.8, "flowers/cross");
    };

    /** A grain leaves a head, aimed downwind at whatever is open nearby. */
    const releasePollen = (p: Plant, n: number, gust: number) => {
      if (p.pollen <= 0.05) return;
      for (let k = 0; k < n && grains.length < 40; k++) {
        const seed = hashSeed(p.seed, grains.length, k + pollenTick);
        const a = twinkleHash(seed % 6151) * Math.PI * 2;
        const sp = 26 + twinkleHash((seed >> 4) % 4001) * 34 + gust * 40;
        grains.push({
          x: p.hx,
          y: p.hy,
          vx: Math.cos(a) * sp * 0.5 + wind * 90 + gust * 30,
          vy: Math.sin(a) * sp * 0.5 - 12,
          fromId: p.id,
          fromSeed: p.seed,
          seed,
          born: performance.now(),
          color: p.species.palette.glow,
        });
      }
      p.pollen = Math.max(0, p.pollen - 0.12 * n);
      pollenTick += 1;
    };

    /** A pollinator enters the garden and starts working the open heads. */
    const releaseBee = (x: number, y: number) => {
      if (bees.length >= 4) bees.shift();
      const seed = hashSeed(Math.round(x), Math.round(y), bees.length + crossCount);
      bees.push({
        x,
        y,
        vx: 0,
        vy: 0,
        seed,
        born: performance.now(),
        carrying: null,
        carrySeed: 0,
        targetId: null,
      });
      note(74, 90);
      try { haptics.tap(); } catch { /* noop */ }
    };

    /**
     * The 3-rung on open soil cycles the garden's weather: a pollinator, then
     * rain (every plant drinks and quickens), then frost (the open heads shut
     * and the weakest go).
     */
    const summonSoilEvent = (x: number, y: number, intensity: number) => {
      const kind = soilEventIdx % 3;
      soilEventIdx += 1;
      const now = performance.now();
      if (kind === 0) {
        releaseBee(x, y);
        burst(x, y, ["#E7AC52", "#F2C56B"], 6, 22);
        return;
      }
      if (kind === 1) {
        rainUntil = now + 9000 + intensity * 6000;
        windTarget = clamp(windTarget + 0.2, -1, 1);
        for (const q of plants) if (q.wiltAt == null) swayPlant(q, (twinkleHash(q.seed % 683) - 0.5) * 0.5);
        note(45, 320);
        try { audio().chime(); } catch { /* noop */ }
        try { haptics.ripple(0.35 + intensity * 0.3); } catch { /* noop */ }
        return;
      }
      frostUntil = now + 8000 + intensity * 5000;
      for (const q of plants) {
        if (q.wiltAt != null) continue;
        q.over = Math.max(0, q.over - 0.4);
        // the weakest are the ones frost takes — competition made visible
        if (q.vigour < 0.3 && q.volunteer) beginWilt(q, "volunteer", now);
      }
      note(31, 420);
      try { audio().thud(); } catch { /* noop */ }
      try { haptics.chop(); } catch { /* noop */ }
    };

    const crossBloom = (p: Plant, loud: boolean) => {
      p.bloomed = true;
      p.bloomAt = performance.now();
      // full bloom: sight (burst + overshoot), sound, and — when it happened
      // in the palm — the bloom word in the hand. one frame, every sense.
      if (loud) {
        try { audio().bell(); } catch { /* noop */ }
        try { haptics.bloom(); } catch { /* noop */ }
      } else {
        try { audio().chime(); } catch { /* noop */ }
      }
      burst(p.hx, p.hy, [p.species.palette.heart, p.species.palette.petal, p.species.palette.glow], 22, 74);
      useField.getState().recordTape("sigil", 0.85, "flowers/bloom");
    };

    // three-finger twist's season (grammar §5): spring quickens growth,
    // winter slows it near dormant — a real law change, not a coat of paint.
    const seasonGrowthMul = () => {
      const si = Math.floor(((season % 4) + 4) % 4);
      return [1.3, 1.0, 0.75, 0.45][si];
    };

    const advancePhase = (p: Plant, d: number, intensity: number) => {
      if (p.phase >= 1 || p.wiltAt != null) return; // its season is done
      p.phase = clamp01(p.phase + d * (0.7 + intensity * 0.6) * seasonGrowthMul());
      const now = performance.now();
      if (now - lastGrowNoteAt > 300) {
        lastGrowNoteAt = now;
        const openness = p.geo ? p.geo.openness : 0;
        note(midiOf(p.species) + Math.round(openness * 10), 100);
      }
      if (now - lastGrowHapticAt > 620) {
        lastGrowHapticAt = now;
        try { haptics.tap(); } catch { /* noop */ }
      }
      if (!p.bloomed && p.phase >= BLOOM_PEAK) crossBloom(p, true);
      dirty = true;
    };

    // the spent flower answers before the ceremony asks anything of it
    const tiredSway = (p: Plant) => {
      swayPlant(p, (twinkleHash(p.seed % 997) - 0.5) * 0.9);
      note(midiOf(p.species) - 7, 240);
      try { haptics.tap(); } catch { /* noop */ }
    };

    const beginWilt = (p: Plant, kind: "ceremony" | "volunteer" | "letgo", at: number) => {
      if (p.wiltAt != null) return;
      p.wiltAt = at;
      p.wiltDir = twinkleHash(p.seed % 9973) > 0.5 ? 1 : -1;
      p.blowAway = kind === "letgo";
      if (kind === "ceremony") {
        // the parting: a low note and the bloom word, then the space is free
        note(midiOf(p.species) - 12, 520);
        try { haptics.bloom(); } catch { /* noop */ }
        useField.getState().recordTape("object", 0.4, "flowers/wilt");
        if (!p.volunteer) { save(true); syncPlanted(); }
      }
      if (kind === "volunteer") {
        note(midiOf(p.species) - 19, 300);
      }
    };

    const spawnVolunteer = () => {
      // one draw for the spot search (x,y × 5) and one for the lifespan —
      // consumed whether or not the garden has room, so the schedule stays
      // a pure function of the seed.
      let bnx = 0.5;
      let bny = 0.6;
      let bestScore = -1;
      for (let k = 0; k < 5; k++) {
        const nx = 0.06 + volRng() * 0.88;
        const ny = 0.16 + volRng() * 0.78;
        let minD = Infinity;
        for (const q of plants) {
          if (q.wiltAt != null) continue;
          minD = Math.min(minD, Math.hypot(nx - q.nx, ny - q.ny));
        }
        const score = plants.length === 0 ? 1 : minD;
        if (score > bestScore) { bestScore = score; bnx = nx; bny = ny; }
      }
      const life = 120000 + volRng() * 120000;
      const alive = plants.filter((p) => p.volunteer && p.wiltAt == null).length;
      if (clearing || alive >= MAX_VOLUNTEERS) return;
      const seed = hashSeed(Math.round(bnx * 997), Math.round(bny * 991), 4096 + volSpawned);
      volSpawned += 1;
      const p = makePlant(seed, bnx, bny, 0, Date.now());
      p.volunteer = true;
      p.volLife = life;
      // a quiet stir of soil — visible if watched, missable if not
      burst(bnx * width, bny * height, [p.species.palette.stem, p.species.palette.glow], 5, 12);
      plants.push(p);
    };

    // the whole-garden parting: every flower folds and rides the wind out
    const letGo = () => {
      if (clearing) return;
      const living = plants.filter((p) => p.wiltAt == null);
      if (living.filter((p) => !p.volunteer).length === 0) return;
      clearing = true;
      const now = performance.now();
      living.forEach((p, i) => {
        beginWilt(p, "letgo", now + (i % 7) * 130 + twinkleHash(p.seed % 997) * 180);
      });
      windTarget = 0.85;
      try { audio().thud(); } catch { /* noop */ }
      note(40, 520);
      try { haptics.ripple(0.5); } catch { /* noop */ }
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ count: plantCount, plants: [] }));
      } catch { /* noop */ }
      useField.getState().recordTape("object", 0.3, "flowers/letgo");
      setPlantedAlive(0);
    };
    letGoRef.current = letGo;

    // three-finger tap = tutti (grammar §5): one synchronized soft pulse —
    // every flower sways once and its note whispers, the garden answering
    const tutti = (strength = 0.5) => {
      const now = performance.now();
      if (now - lastTuttiAt < 1400) return;
      lastTuttiAt = now;
      const living = plants.filter((p) => p.wiltAt == null);
      living.forEach((p, i) => {
        swayPlant(p, (twinkleHash(p.seed % 997) - 0.5) * (0.7 + strength * 0.9));
        if (i < 12) window.setTimeout(() => note(midiOf(p.species), 70), i * 45);
      });
      try { haptics.ripple(0.2 + strength * 0.4); } catch { /* noop */ }
    };

    // ————— gestures (the grammar, nothing private) —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 2) {
          // step back: a raised lens lowers first; otherwise the garden's
          // own camera takes one gentle step out (never past its widest)
          if (lensSnapped === 1) {
            lensSnapped = 0;
            lensTarget = 0;
            try { haptics.lens(); } catch { /* noop */ }
            note(48, 160);
          } else {
            zoom = clamp(zoom * 0.86, 0.75, 1.5);
            try { haptics.tap(); } catch { /* noop */ }
            note(43, 140);
          }
          return;
        }
        if (e.fingers === 3) { tutti(e.intensity); return; }
        if (e.fingers !== 1) return; // anything else is gently absorbed
        const { x, y } = toLocal(e.x, e.y);
        // the rapid-tap ladder: a sway → loose pollen → a coaxed crown or a
        // volunteer called up → a wave across the whole garden
        const trainTier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (trainTier === "n") {
          const living = plants.filter((q) => q.wiltAt == null);
          living
            .map((q) => ({ q, d: Math.hypot(x - q.hx, y - q.hy) }))
            .sort((qa, qb) => qa.d - qb.d)
            .forEach(({ q }, i) => {
              window.setTimeout(() => {
                swayPlant(q, (twinkleHash(q.seed % 997) - 0.5) * (1.2 + depth));
                if (i < 10) note(midiOf(q.species), 70);
              }, i * 55);
            });
          windTarget = clamp(windTarget + 0.4 + depth * 0.4, -1, 1);
          // ...and the top rung's own act, the largest thing this room does:
          // a SEASON RACING the length of the garden. A front crosses the
          // soil; every plant it passes runs bud → bloom → pollen → seed in
          // its wake, and what the grains reach sets crossed seedlings behind
          // the front.
          seasonRace = {
            x: 0,
            u: 0,
            speed: 0.28 + e.intensity * 0.22 + depth * 0.16,
            gain: e.intensity + depth * 0.4,
          };
          try { audio().bell(); } catch { /* noop */ }
          try { haptics.ripple(0.5 + depth * 0.4); } catch { /* noop */ }
          return;
        }
        if (trainTier === 5) {
          const p5 = plantAt(x, y);
          const volunteersAlive = plants.filter((q) => q.volunteer && q.wiltAt == null).length;
          if (p5) {
            // five taps coax the crown: it swells wide and breathes there
            p5.over = Math.min(1, p5.over + 0.45 + depth * 0.3);
            swayPlant(p5, (x < p5.hx ? -1 : 1) * 0.8);
            burst(p5.hx, p5.hy, [p5.species.palette.petal, p5.species.palette.glow], 14, 48);
            try { audio().bell(); } catch { /* noop */ }
            try { haptics.bloom(); } catch { /* noop */ }
          } else if (!clearing && volunteersAlive < MAX_VOLUNTEERS) {
            // five taps on open soil call a volunteer up out of turn
            const seed = hashSeed(Math.round(x), Math.round(y), 8192 + volSpawned);
            volSpawned += 1;
            const vp = makePlant(seed, clamp01(x / width), clamp(y / height, 0.12, 0.96), 0, Date.now());
            vp.volunteer = true;
            vp.volLife = 120000 + twinkleHash(seed % 4093) * 120000;
            plants.push(vp);
            burst(x, y, [vp.species.palette.stem, vp.species.palette.glow], 8, 20);
            note(midiOf(vp.species) - 12, 200);
            try { haptics.ripple(0.5); } catch { /* noop */ }
          } else {
            burst(x, y, ["#E7AC52", "#F2EEE6"], 8, 26);
            note(64, 90);
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        if (trainTier === 3) {
          const p3 = plantAt(x, y);
          if (p3) {
            // three taps shake the pollen loose — a rising arpeggio, and the
            // grains actually leave the head. Where one lands on another open
            // flower a seed sets that is half of each of them.
            fallPetals(p3.hx, p3.hy, [p3.species.palette.petal, p3.species.palette.heart], 4, false);
            swayPlant(p3, (x < p3.hx ? -1 : 1) * (0.8 + depth));
            if (p3.geo && p3.geo.openness > 0.25) {
              releasePollen(p3, 3 + Math.round(depth * 4 + e.intensity * 3), 0.3 + depth * 0.5);
            } else {
              // not open yet: the shake brings it on toward its bloom instead
              advancePhase(p3, 0.06 + depth * 0.05, e.intensity);
            }
            note(midiOf(p3.species), 90);
            window.setTimeout(() => note(midiOf(p3.species) + 4, 90), 80);
            window.setTimeout(() => note(midiOf(p3.species) + 7, 120), 170);
          } else {
            summonSoilEvent(x, y, e.intensity + depth * 0.3);
          }
          try { haptics.tap(); } catch { /* noop */ }
          return;
        }
        const p = plantAt(x, y);
        if (p) {
          if (p.phase >= 1) {
            // a done season answers tired, never silent
            swayPlant(p, (x < p.hx ? -1 : 1) * 0.6);
            note(midiOf(p.species) - 7, 200);
            try { haptics.tap(); } catch { /* noop */ }
            return;
          }
          swayPlant(p, (x < p.hx ? -1 : 1) * (0.9 + e.intensity * 1.8));
          note(midiOf(p.species), 130);
          try { haptics.tap(); } catch { /* noop */ }
          if (p.geo && p.geo.openness > 0.4) {
            burst(p.hx, p.hy, [p.species.palette.petal, p.species.palette.heart], 4, 22);
          }
        } else {
          // neutral absorb — the soil takes the touch
          burst(x, y, ["#243D4A"], 3, 9);
        }
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three fingers touch the law: time dilates while held, and the
          // dilation keeps deepening for as long as the hand stays
          if (e.phase === "enter") { try { haptics.tap(); } catch { /* noop */ } note(36, 260); }
          if (e.phase === "release") timeScaleTarget = 1;
          else timeScaleTarget = clamp(1 - e.elapsed / 3400, 0.08, 1);
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          // the touch tier (250ms): open ground takes a seed right here —
          // any arbitrary space grows, and holding on keeps growing it
          const p = plantAt(x, y);
          if (p && p.phase >= 1) {
            hold.doneId = p.id;
            tiredSway(p);
          } else if (p) {
            hold.plantId = p.id;
          } else if (!clearing) {
            const np = doPlant(x, y);
            if (np) hold.plantId = np.id;
          }
          return;
        }
        if (e.phase === "release") {
          hold.plantId = null;
          hold.doneId = null;
          save();
          return;
        }
        // ticks (~80ms)
        if (hold.doneId) {
          const p = plants.find((q) => q.id === hold.doneId);
          if (p && e.tier >= 3) {
            // the ceremony: a held goodbye wilts it back into the soil
            beginWilt(p, "ceremony", performance.now());
            hold.doneId = null;
          } else if (p && !reduce) {
            p.swayV += (twinkleHash(Math.floor(e.elapsed / 160)) - 0.5) * 0.16; // a tired tremble
          }
        } else if (hold.plantId) {
          const p = plants.find((q) => q.id === hold.plantId);
          if (p && p.phase < 1) advancePhase(p, 0.00021 * 80, e.intensity);
          else if (p && p.wiltAt == null) {
            // duration is an axis: a hold kept past full bloom keeps
            // deepening — a slow breathing overbloom, sighing as it widens
            p.over = Math.min(1, p.over + 0.009 * (1 + e.intensity * 0.6));
            const now = performance.now();
            if (now - lastGrowNoteAt > 800) {
              lastGrowNoteAt = now;
              note(midiOf(p.species) - 5 + Math.round(p.over * 4), 160);
              try { haptics.tap(); } catch { /* noop */ }
            }
          }
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        if (e.fingers === 3) {
          // three fingers are the weather
          windTarget = clamp(e.vx * 1.6, -1, 1);
          const now = performance.now();
          if (Math.abs(windTarget) > 0.5 && now - lastWindSoundAt > 520) {
            lastWindSoundAt = now;
            note(38 + Math.round(Math.abs(windTarget) * 5), 240);
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1 || e.phase === "end") return;
        // one finger brushes the material — a hand-wide breeze
        const now = performance.now();
        for (const p of plants) {
          if (p.wiltAt != null) continue;
          const near = Math.hypot(x - p.hx, y - p.hy) < Math.max(44, p.hr * 1.8) ||
            (Math.abs(x - p.bx) < 30 && y < p.by && y > p.hy - 20);
          if (!near) continue;
          swayPlant(p, clamp(e.vx * 0.9, -1.6, 1.6));
          if (now - p.lastBrushAt > 260) {
            p.lastBrushAt = now;
            if (now - lastBrushSoundAt > 140) {
              lastBrushSoundAt = now;
              note(midiOf(p.species) + 5, 70);
              try { haptics.ripple(0.2); } catch { /* noop */ }
            }
          }
        }
      },
      pan2: (e) => {
        lastInteractionAt = performance.now();
        // two-finger drag pans the frame — a gentle, self-centering window
        // onto the bed (the garden has no wider world to travel to yet)
        panTargetX = clamp(panTargetX + e.dx * 0.6, -width * 0.16, width * 0.16);
        panTargetY = clamp(panTargetY + e.dy * 0.6, -height * 0.12, height * 0.12);
      },
      twist: (e) => {
        if (e.fingers === 3) {
          // three fingers turn the season — the law layer's slow cycle.
          // Continuous: the season keeps advancing while the wrist turns,
          // and crosses into the next quarter with a felt click.
          lastInteractionAt = performance.now();
          if (e.phase === "move") {
            seasonTarget += e.angle / (Math.PI / 2);
            const now = performance.now();
            const cur = Math.floor(((seasonTarget % 4) + 4) % 4);
            if (cur !== seasonSnapped) {
              seasonSnapped = cur;
              if (now - lastTiltSoundAt > 180) {
                lastTiltSoundAt = now;
                note(45 + cur * 2, 220);
                try { haptics.detent(); } catch { /* noop */ }
              }
            }
          }
          return;
        }
        lastInteractionAt = performance.now();
        // two fingers rotate the lens: felt garden ↔ botanical diagram
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
      pinch: (e) => {
        lastInteractionAt = performance.now();
        // zoom within the band; travel across bands arrives with W1
        if (e.phase !== "end") zoom = clamp(zoom * e.scale, 0.75, 1.5);
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        const now = performance.now();
        if (now - lastScrubAt < 700) return;
        lastScrubAt = now;
        const { x, y } = toLocal(e.cx, e.cy);
        // circling stirs the pollen — deeper, faster circles lift more of it
        const turn = Math.min(3, Math.abs(e.winding));
        const spin = Math.min(1, e.angularVelocity / 1.4);
        burst(x, y, ["#E7AC52", "#F2EEE6", "#4E7D8C"], 8 + Math.round(turn * 5), 26 + Math.round(spin * 22));
        for (const s of specks) s.swirl += Math.sign(e.winding) * (1 + turn * 0.5);
        note(62 + Math.round(turn * 3), 90);
        try { haptics.ripple(0.2 + turn * 0.12); } catch { /* noop */ }
      },
      rhythm: (e) => {
        if (e.stability < 0.6) return;
        // a steady tap tempo entrains the garden: every bed sways on the
        // hand's own pulse for a while
        lastInteractionAt = performance.now();
        pulseBpm = clamp(e.bpm, 40, 170);
        pulseUntil = performance.now() + 10000;
        lastBeatIdx = -1;
        try { audio().chime(); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
      },
    });

    // ————— the vessel: the device is the garden's body (grammar §5) —————
    // Subscribed passively — nothing flows until the candle has invited the
    // senses. Tilt = the wind leans toward the downhill side (the garden's
    // one wind pathway, reused); shake = petals shed briefly.
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (reduce) { tiltWind = 0; return; }
        tiltWind = clamp(gamma / 28, -1, 1) * 0.6;
        const now = performance.now();
        if (Math.abs(tiltWind) > 0.33 && now - lastTiltSoundAt > 1400) {
          lastTiltSoundAt = now;
          note(38 + Math.round(Math.abs(tiltWind) * 5), 240); // the wind's word
        }
      },
      shake: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // a shaken garden sheds: open crowns let a few petals go
        let shed = 0;
        for (const p of plants) {
          if (p.wiltAt != null || !p.geo || p.geo.openness < 0.5) continue;
          swayPlant(p, (twinkleHash(p.seed % 1013) - 0.5) * (1.2 + intensity));
          if (shed < 6) {
            shed += 1;
            fallPetals(p.hx, p.hy, [p.species.palette.petal, p.species.palette.petalDeep], 3, false);
          }
        }
        note(40, 200);
        try { (intensity > 0.7 ? haptics.storm : haptics.chop)(); } catch { /* noop */ }
      },
      // knock = wake / ring the room (rhymes with /coin's pop-to-flip): a
      // rap on the case rings the garden the same way three fingers do,
      // as loud as the knuckle asked
      knock: ({ intensity }) => {
        lastInteractionAt = performance.now();
        tutti(0.4 + intensity * 0.6);
      },
      // flip face-down = night: the garden dims and quiets until turned back
      flip: ({ faceDown }) => {
        night = faceDown;
        if (!faceDown) lastInteractionAt = performance.now();
        note(faceDown ? 28 : 76, faceDown ? 480 : 160);
      },
    });

    // fingertip-charge tracking (visual only — see note at the declarations)
    const onPressDown = (ev: PointerEvent) => {
      pressContacts += 1;
      const inset = THRESHOLDS.edgeInsetPx;
      if (
        pressContacts !== 1 ||
        ev.clientX < inset || ev.clientY < inset ||
        ev.clientX > window.innerWidth - inset || ev.clientY > window.innerHeight - inset
      ) {
        pressOn = false;
        return;
      }
      const { x, y } = toLocal(ev.clientX, ev.clientY);
      pressOn = true;
      pressX = x;
      pressY = y;
      pressT0 = performance.now();
    };
    const onPressMove = (ev: PointerEvent) => {
      if (!pressOn || pressContacts !== 1) return;
      const { x, y } = toLocal(ev.clientX, ev.clientY);
      if (Math.hypot(x - pressX, y - pressY) > THRESHOLDS.moveTolPx) pressOn = false;
    };
    const onPressUp = () => {
      pressContacts = Math.max(0, pressContacts - 1);
      if (pressContacts === 0) pressOn = false;
    };
    wrap.addEventListener("pointerdown", onPressDown);
    wrap.addEventListener("pointermove", onPressMove);
    wrap.addEventListener("pointerup", onPressUp);
    wrap.addEventListener("pointercancel", onPressUp);

    // ————— keyboard dialect (same verbs, quieter) —————
    const onKeyDown = (ev: KeyboardEvent) => {
      const step = 0.05;
      if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        cursorVisible = true;
        lastInteractionAt = performance.now();
        if (ev.key === "ArrowLeft") cursorNx = clamp(cursorNx - step, 0.05, 0.95);
        if (ev.key === "ArrowRight") cursorNx = clamp(cursorNx + step, 0.05, 0.95);
        if (ev.key === "ArrowUp") cursorNy = clamp(cursorNy - step, 0.1, 0.95);
        if (ev.key === "ArrowDown") cursorNy = clamp(cursorNy + step, 0.1, 0.95);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!cursorVisible) { cursorVisible = true; return; }
        const x = cursorNx * width;
        const y = cursorNy * height;
        const p = plantAt(x, y);
        if (p && p.phase >= 1) {
          // held Enter is the keyboard's ceremony: the tired answer first,
          // then — held through the same 2.5s — the wilt
          const now = performance.now();
          if (!ev.repeat || !keyWilt || keyWilt.id !== p.id) {
            keyWilt = { id: p.id, t0: now };
            tiredSway(p);
          } else if (now - keyWilt.t0 > THRESHOLDS.ceremonyMs) {
            beginWilt(p, "ceremony", now);
            keyWilt = null;
          }
        } else if (p) {
          advancePhase(p, 0.028, 0.5); // held Enter repeats — the keyboard's long-press
        } else if (!ev.repeat && !clearing) {
          doPlant(x, y);
        }
      }
    };
    const onFocus = () => { focused = true; };
    const onBlur = () => { focused = false; cursorVisible = false; save(true); };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("focus", onFocus);
    wrap.addEventListener("blur", onBlur);
    const onVis = () => { if (document.visibilityState === "hidden") save(true); };
    document.addEventListener("visibilitychange", onVis);

    // ————— drawing —————
    // per-species caches: petal Path2D in unit space (base 0,0 · tip 0,-1),
    // petal gradients (deep base → pale tip), heart gradients. Species are
    // pure functions of their seeds, so these never invalidate.
    const petalPathCache = new Map<number, Path2D>();
    const petalPathFor = (sp: Species): Path2D => {
      let path = petalPathCache.get(sp.seed);
      if (!path) {
        const o = petalOutline(sp.petal);
        path = new Path2D();
        path.moveTo(0, 0);
        path.bezierCurveTo(o.c1.x, o.c1.y, o.c2.x, o.c2.y, o.tip.x, o.tip.y);
        path.bezierCurveTo(-o.c2.x, o.c2.y, -o.c1.x, o.c1.y, 0, 0);
        path.closePath();
        petalPathCache.set(sp.seed, path);
      }
      return path;
    };
    const petalGradCache = new Map<string, CanvasGradient>();
    const petalGradFor = (sp: Species, layer: number): CanvasGradient => {
      const key = `${sp.seed}:${layer % 2}`;
      let g = petalGradCache.get(key);
      if (!g) {
        g = ctx.createLinearGradient(0, 0, 0, -1);
        if (layer % 2 === 0) {
          g.addColorStop(0, sp.palette.petalDeep);
          g.addColorStop(0.45, sp.palette.petal);
          g.addColorStop(1, mixHex(sp.palette.petal, "#F7F3EA", 0.55));
        } else {
          g.addColorStop(0, sp.palette.petalDeep);
          g.addColorStop(0.6, mixHex(sp.palette.petalDeep, sp.palette.petal, 0.6));
          g.addColorStop(1, mixHex(sp.palette.petal, "#F7F3EA", 0.3));
        }
        petalGradCache.set(key, g);
      }
      return g;
    };
    const heartGradCache = new Map<number, CanvasGradient>();
    const heartGradFor = (sp: Species): CanvasGradient => {
      let g = heartGradCache.get(sp.seed);
      if (!g) {
        g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, mixHex(sp.palette.heart, "#F2C56B", 0.35));
        g.addColorStop(0.65, sp.palette.heart);
        g.addColorStop(1, sp.palette.petalDeep);
        heartGradCache.set(sp.seed, g);
      }
      return g;
    };
    // one shared soft-shadow gradient, transformed per plant
    const shadowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    shadowGrad.addColorStop(0, "rgba(4, 8, 10, 0.55)");
    shadowGrad.addColorStop(1, "rgba(4, 8, 10, 0)");
    // one shared unit-space press-glimmer gradient, transformed + alpha-scaled
    // per frame instead of recreated (the same trick as shadowGrad above)
    const glimmerGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    glimmerGrad.addColorStop(0, "#E7AC52");
    glimmerGrad.addColorStop(1, "rgba(231, 172, 82, 0)");

    // the bloom moment overshoots, then settles — the ceremony of opening
    const bloomPulseOf = (p: Plant, now: number): number => {
      if (reduce || !p.bloomAt) return 1;
      const u = (now - p.bloomAt) / 1200;
      if (u >= 1) return 1;
      return 1 + 0.24 * Math.exp(-3 * u) * Math.sin(u * Math.PI * 2.4);
    };

    const drawHead = (
      p: Plant,
      geo: FlowerGeometry,
      hs: number,
      feltAlpha: number,
      breathScale: number,
      detail: boolean,
      now: number,
    ) => {
      const sp = p.species;
      ctx.save();
      const s = hs * breathScale * bloomPulseOf(p, now);
      ctx.scale(s, s);
      // sepal / bud casing, fading as it opens
      const budA = clamp01(1 - geo.openness * 1.7);
      if (budA > 0.01) {
        ctx.fillStyle = colorAlpha(sp.palette.stem, budA * 0.9 * feltAlpha);
        ctx.beginPath();
        ctx.ellipse(0, 0, geo.headRadius * 0.42, geo.headRadius * 0.58, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // petals back-to-front: the outer whorl behind, inner whorls over it,
      // each petal with seeded rotation/length jitter — pressed, not stamped
      const path = petalPathFor(sp);
      for (let i = 0; i < geo.petals.length; i++) {
        const pe = geo.petals[i];
        if (pe.length <= 0.001) continue;
        if (!detail && pe.layer > 0) continue; // side crowns keep one whorl
        const jr = (twinkleHash((sp.seed % 8191) + i * 17.3) - 0.5) * 0.11 * pe.splay;
        const jl = 0.93 + twinkleHash((sp.seed % 8191) + i * 29.7) * 0.14;
        ctx.save();
        ctx.rotate(pe.angle + jr);
        ctx.translate(0, -geo.heartRadius * 0.55 * pe.splay);
        ctx.scale(pe.width, pe.length * jl);
        ctx.globalAlpha = (0.72 + 0.28 * pe.splay) * feltAlpha;
        ctx.fillStyle = petalGradFor(sp, pe.layer);
        ctx.fill(path);
        ctx.restore();
      }
      // the heart, its golden-angle florets, and — at full bloom — stamens
      if (geo.openness > 0.3) {
        const heartA = clamp01((geo.openness - 0.3) / 0.4) * feltAlpha;
        ctx.save();
        ctx.globalAlpha = heartA;
        ctx.save();
        ctx.scale(geo.heartRadius, geo.heartRadius);
        ctx.fillStyle = heartGradFor(sp);
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (detail) {
          const fA = mixHex(sp.palette.heart, "#F2C56B", 0.4);
          const fB = mixHex(sp.palette.heart, sp.palette.petalDeep, 0.35);
          for (let i = 0; i < geo.florets.length; i++) {
            const f = geo.florets[i];
            ctx.fillStyle = i % 2 === 0 ? fA : fB;
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
            ctx.fill();
          }
          if (geo.openness > 0.82) {
            const stA = clamp01((geo.openness - 0.82) / 0.14);
            ctx.strokeStyle = colorAlpha(mixHex(sp.palette.heart, "#F7F3EA", 0.35), stA * 0.85);
            ctx.fillStyle = colorAlpha("#E7AC52", stA * 0.9);
            ctx.lineWidth = geo.heartRadius * 0.08;
            const nSt = 8 + (sp.petals % 5);
            for (let k = 0; k < nSt; k++) {
              const a = k * GOLDEN_ANGLE * 3 + sp.latent[27] * Math.PI * 2;
              const r0 = geo.heartRadius * 0.55;
              const r1 = geo.heartRadius * (1.2 + 0.3 * twinkleHash((sp.seed % 4093) + k * 7));
              ctx.beginPath();
              ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
              ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(Math.cos(a) * r1, Math.sin(a) * r1, geo.heartRadius * 0.11, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else {
          ctx.fillStyle = colorAlpha(sp.palette.heart, 0.9);
          ctx.beginPath();
          ctx.arc(0, 0, geo.heartRadius * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    };

    const drawHeadLens = (p: Plant, geo: FlowerGeometry, hs: number, a: number, detail: boolean) => {
      // the diagram: the same species as line and lattice
      const sp = p.species;
      ctx.save();
      ctx.scale(hs, hs);
      ctx.strokeStyle = colorAlpha(sp.palette.glow, a * 0.8);
      ctx.lineWidth = 0.008 / hs;
      ctx.beginPath();
      ctx.arc(0, 0, geo.headRadius, 0, Math.PI * 2);
      ctx.stroke();
      for (const pe of geo.petals) {
        if (!detail || pe.layer !== 0) continue;
        ctx.save();
        ctx.rotate(pe.angle);
        ctx.beginPath();
        ctx.moveTo(0, -geo.heartRadius);
        ctx.lineTo(0, -(geo.heartRadius + pe.length));
        ctx.stroke();
        ctx.restore();
      }
      if (detail) {
        ctx.fillStyle = colorAlpha(sp.palette.glow, a);
        for (const f of geo.florets) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, Math.max(0.002, f.r * 0.7), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    };

    const drawPlant = (p: Plant, now: number, breath: number) => {
      if (!p.geo || Math.abs(p.phase - p.geoPhase) > GEO_EPS) {
        p.geo = flowerGeometry(p.species, p.phase);
        p.geoPhase = p.phase;
      }
      const geo = p.geo;
      const sp = p.species;
      const minDim = Math.min(width, height);
      const size = minDim * (0.28 + 0.21 * ((sp.height - 0.55) / 0.45)) * zoom;
      const bx = p.nx * width;
      const by = p.ny * height;

      // grander crowns: heads swell toward ~2× as they open, capped so a
      // full bloom still fits a 390px screen
      const openBoost = 1 + 0.95 * geo.openness;
      const reachUnit = geo.headRadius * Math.max(1, sp.petal.length) * 1.15;
      const capBoost = (minDim * 0.3) / Math.max(1e-6, reachUnit * size);
      const boost = Math.max(0.8, Math.min(openBoost, capBoost));

      // wilting: the stem bows, the crown fades, petals leave
      let wiltW = 0;
      let alphaMul = 1;
      if (p.wiltAt != null && now >= p.wiltAt) {
        const dur = reduce ? WILT_MS_REDUCED : WILT_MS;
        wiltW = clamp01((now - p.wiltAt) / dur);
        alphaMul = clamp01(1 - Math.pow(Math.max(0, wiltW * 1.25 - 0.25), 1.2));
        if (!reduce) {
          const steps = [0.08, 0.26, 0.48];
          while (p.wiltStep < steps.length && wiltW >= steps[p.wiltStep]) {
            fallPetals(p.hx, p.hy, [sp.palette.petal, sp.palette.petalDeep, sp.palette.glow], 5 + p.wiltStep * 2, p.blowAway);
            p.wiltStep += 1;
          }
        }
      }

      const bow = reduce ? 0 : p.wiltDir * Math.pow(wiltW, 1.4) * (p.blowAway ? 1.1 : 0.85);
      const lean = (reduce ? 0 : p.swayX * 0.16 + wind * 0.11 + breath * 0.012 * sp.breathDepth) + bow;
      const feltAlpha = (1 - lens) * alphaMul;

      // soil shadow pooled beneath the crown — drawn unrotated, on the ground
      if (feltAlpha > 0.02) {
        const shR = Math.max(0.05, geo.headRadius * boost * 1.15) * size;
        ctx.save();
        ctx.translate(bx + panX, by + panY + 2);
        ctx.scale(shR, shR * 0.26);
        ctx.globalAlpha = 0.32 * feltAlpha * (0.4 + 0.6 * geo.openness);
        ctx.fillStyle = shadowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(bx + panX, by + panY);
      ctx.rotate(lean);
      ctx.scale(size, size * (1 - 0.18 * wiltW));

      // stems — felt pass: tapered, midpoint-smoothed, rooted dark
      if (feltAlpha > 0.02) {
        ctx.lineCap = "round";
        ctx.strokeStyle = colorAlpha(sp.palette.stem, 0.92 * feltAlpha);
        for (const st of geo.stems) {
          const pts = st.pts;
          const n = pts.length;
          if (n < 2) continue;
          const w0 = 0.02 * st.width;
          let prev = pts[0];
          for (let i = 1; i < n; i++) {
            const t = i / (n - 1);
            const cur = pts[i];
            const ex = i < n - 1 ? (cur.x + pts[i + 1].x) / 2 : cur.x;
            const ey = i < n - 1 ? (cur.y + pts[i + 1].y) / 2 : cur.y;
            ctx.lineWidth = Math.max(0.0045, w0 * (1 - 0.58 * t));
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.quadraticCurveTo(cur.x, cur.y, ex, ey);
            ctx.stroke();
            prev = { x: ex, y: ey };
          }
        }
        // leaves with a midrib — seeded placement comes from the L-system
        for (const lf of geo.leaves) {
          ctx.save();
          ctx.translate(lf.x, lf.y);
          ctx.rotate(lf.angle);
          ctx.fillStyle = colorAlpha(sp.palette.leaf, 0.8 * feltAlpha);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(lf.size * 0.5, -lf.size * 0.25, lf.size * 0.55, -lf.size * 0.9, 0, -lf.size * 1.2);
          ctx.bezierCurveTo(-lf.size * 0.5, -lf.size * 0.9, -lf.size * 0.45, -lf.size * 0.25, 0, 0);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = colorAlpha(mixHex(sp.palette.leaf, "#1E3440", 0.45), 0.6 * feltAlpha);
          ctx.lineWidth = lf.size * 0.05;
          ctx.beginPath();
          ctx.moveTo(0, -lf.size * 0.08);
          ctx.quadraticCurveTo(lf.size * 0.1, -lf.size * 0.6, 0, -lf.size * 1.08);
          ctx.stroke();
          ctx.restore();
        }
      }
      // lens pass — the skeleton
      if (lens > 0.02) {
        ctx.strokeStyle = colorAlpha(sp.palette.glow, lens * 0.55 * alphaMul);
        ctx.lineCap = "round";
        for (const s of geo.stems) {
          ctx.lineWidth = 0.006;
          ctx.beginPath();
          ctx.moveTo(s.pts[0].x, s.pts[0].y);
          for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
          ctx.stroke();
        }
      }

      // crowns — the overbloom breathes the crown wider, slow and audible
      const overSwell = p.over * (0.14 + (reduce ? 0 : 0.05 * Math.sin(breath * 2 + p.breathOffset)));
      const breathScale = (reduce ? 1 : 1 + Math.sin(breath + p.breathOffset) * 0.035 * sp.breathDepth) + overSwell;
      for (let h = 0; h < geo.heads.length; h++) {
        const head = geo.heads[h];
        const hs = (h === 0 ? 1 : 0.42 + head.scale * 0.4) * boost;
        ctx.save();
        ctx.translate(head.x, head.y);
        if (feltAlpha > 0.02) drawHead(p, geo, hs, feltAlpha, breathScale, h === 0, now);
        if (lens > 0.02) drawHeadLens(p, geo, hs, lens * alphaMul, h === 0);
        ctx.restore();
        if (h === 0) {
          // record screen-space head + base for hit tests (sway ignored — small)
          p.hx = bx + panX + head.x * size;
          p.hy = by + panY + head.y * size;
          p.hr = geo.headRadius * size * boost * Math.max(1, sp.petal.length);
          p.bx = bx + panX;
          p.by = by + panY;
        }
      }
      ctx.restore();
    };

    // ————— the loop —————
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tier = governor.beginFrame(now);
      if (sleeping) return; // hard pause: tab hidden or gallery parent paused
      if (tier !== currentTier) {
        currentTier = tier;
        detail = detailForTier(tier);
        resize(); // also re-resolves DPR for the new tier
      }
      if (!reduce && now - lastFrame < 30) return;
      lastFrame = now;
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduce) localT += dt * timeScale;
      // the hand's weather decays; the vessel's lean stands as long as held
      wind += (windTarget + tiltWind - wind) * Math.min(1, dt * 2.2);
      windTarget *= Math.exp(-dt * 0.5);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      // two-finger pan eases toward its target and gently springs home — the
      // garden always has a rest frame to return to
      panTargetX *= Math.exp(-dt * 0.4);
      panTargetY *= Math.exp(-dt * 0.4);
      panX += (panTargetX - panX) * Math.min(1, dt * 4);
      panY += (panTargetY - panY) * Math.min(1, dt * 4);
      // season eases toward wherever the three-finger twist left it
      season += (seasonTarget - season) * Math.min(1, dt * 3);
      nightAmt += ((night ? 1 : 0) - nightAmt) * Math.min(1, dt * 1.4);

      // shared breath: the audio swell clock when audible, RAF when not
      const audioT = (() => { try { return audio().getAudioTime(); } catch { return null; } })();
      const bt = audioT != null ? audioT : now / 1000;
      const breath = bt * Math.PI * 2 * 0.14;

      // the entrained pulse: while the hand's tempo lasts, every bed leans
      // into the beat, fading as the entrainment lets go
      if (pulseBpm > 0) {
        if (now < pulseUntil) {
          const beat = Math.floor((localT * pulseBpm) / 60);
          if (beat !== lastBeatIdx) {
            lastBeatIdx = beat;
            const fade = clamp01((pulseUntil - now) / 10000);
            for (const p of plants) {
              if (p.wiltAt != null) continue;
              swayPlant(p, (twinkleHash((p.seed % 997) + beat) - 0.5) * 0.5 * fade);
            }
            if (beat % 2 === 0) note(52 + (beat % 7), 60);
          }
        } else {
          pulseBpm = 0;
        }
      }

      // the volunteer clock — dilated with the room, deterministic in seed
      volClock += dt * timeScale;
      if (volClock >= nextVolAt) {
        spawnVolunteer();
        nextVolAt = volClock + 20 + volRng() * 25;
      }

      // springs + volunteer lives
      for (const p of plants) {
        if (p.volunteer && p.wiltAt == null) {
          p.volAge += delta * timeScale * seasonGrowthMul();
          const a = p.volAge / p.volLife;
          const target =
            a < 0.32 ? (a / 0.32) * BLOOM_PEAK :
            a < 0.6 ? BLOOM_PEAK :
            a < 0.85 ? BLOOM_PEAK + ((a - 0.6) / 0.25) * (1 - BLOOM_PEAK) : 1;
          if (target > p.phase) p.phase = clamp01(target);
          if (!p.bloomed && p.phase >= BLOOM_PEAK) crossBloom(p, false);
          if (a >= 0.86) beginWilt(p, "volunteer", now);
        }
        p.over *= Math.exp(-dt * 0.25); // the overbloom settles back, slowly
        if (reduce) { p.swayX = 0; p.swayV = 0; continue; }
        const omega = 2.2 + p.species.swayStiffness * 3.4;
        p.swayV += (-omega * omega * p.swayX - 2 * 0.55 * omega * p.swayV) * dt * timeScale;
        p.swayX += p.swayV * dt * timeScale;
      }

      // ————— the physics BETWEEN plants —————
      // Light and root space are finite and shared. A taller neighbour standing
      // over a plant takes its light (shade is one-directional — a seedling
      // never shades the flower above it); overlapping root discs share what
      // the soil has. What is left is the plant's vigour, and vigour is what
      // it grows and blooms on, so a crowded corner visibly thins itself.
      {
        const living = plants.filter((q) => q.wiltAt == null);
        const rainOn = now < rainUntil;
        const frostOn = now < frostUntil;
        for (const p of living) {
          const spread = canopySpread(p.species);
          let shade = 0;
          let root = 0;
          for (const q of living) {
            if (q === p) continue;
            const dx = q.nx - p.nx;
            if (Math.abs(dx) > 0.34) continue;
            shade += shadeFrom(p.species.height, q.species.height, dx, spread + canopySpread(q.species) * 0.5);
            root += rootOverlap(dx, 0.055 + p.species.height * 0.05, 0.055 + q.species.height * 0.05) * 0.6;
          }
          p.light = clamp01(1 - shade) * (rainOn ? 0.92 : 1) * (frostOn ? 0.7 : 1);
          p.rootShare = clamp01(root);
          const v = vigourOf(p.light, p.rootShare) * (rainOn ? 1.25 : 1) * (frostOn ? 0.55 : 1);
          p.vigour += (clamp01(v) - p.vigour) * Math.min(1, dt * 0.9);
          // a plant with enough of itself left grows on its own; one starved
          // in somebody else's shadow stalls, and a volunteer there is lost
          if (!reduce && p.phase > 0 && p.phase < 1) {
            p.phase = clamp01(p.phase + dt * timeScale * 0.006 * p.vigour * seasonGrowthMul());
            if (!p.bloomed && p.phase >= BLOOM_PEAK) crossBloom(p, false);
          }
          if (p.geo && p.geo.openness > 0.3) p.pollen = Math.min(1, p.pollen + dt * 0.14 * p.vigour);
          if (p.volunteer && p.vigour < 0.12 && p.volAge > p.volLife * 0.2) beginWilt(p, "volunteer", now);
        }

        // — the pollinators, working the open heads —
        for (let k = bees.length - 1; k >= 0; k--) {
          const b = bees[k];
          if (now - b.born > 42000) {
            bees.splice(k, 1);
            continue;
          }
          let target: Plant | null = null;
          let bestD = Infinity;
          for (const q of living) {
            if (!q.geo || q.geo.openness < 0.25) continue;
            if (q.id === b.carrying) continue;
            const d = Math.hypot(q.hx - b.x, q.hy - b.y);
            if (d < bestD) {
              bestD = d;
              target = q;
            }
          }
          if (target) {
            const d = Math.max(1, bestD);
            b.vx += ((target.hx - b.x) / d) * 260 * dt;
            b.vy += ((target.hy - b.y) / d) * 260 * dt;
            if (bestD < Math.max(14, target.hr)) {
              // it drinks, and what it was carrying fertilises this head
              if (b.carrying && b.carrying !== target.id) {
                const father = plants.find((q) => q.id === b.carrying);
                if (father && target.geo && target.geo.openness > 0.25) {
                  setSeedFrom(target, b.carrySeed, father.species.latent);
                }
              }
              b.carrying = target.id;
              b.carrySeed = target.seed;
              target.pollen = Math.min(1, target.pollen + 0.2);
              swayPlant(target, (twinkleHash(b.seed % 811) - 0.5) * 0.5);
              b.vx *= -0.4;
              b.vy *= -0.4;
            }
          }
          b.vx += Math.sin(localT * 3.1 + b.seed % 7) * 40 * dt + wind * 30 * dt;
          b.vy += Math.cos(localT * 2.7 + b.seed % 5) * 40 * dt;
          b.vx *= Math.exp(-dt * 1.6);
          b.vy *= Math.exp(-dt * 1.6);
          b.x = clamp(b.x + b.vx * dt, 0, width);
          b.y = clamp(b.y + b.vy * dt, 0, height);
        }

        // — the grains in flight: gravity, the wind, and where they land —
        for (let k = grains.length - 1; k >= 0; k--) {
          const g = grains[k];
          const age = (now - g.born) / 1000;
          if (age > 6 || g.y > height) {
            grains.splice(k, 1);
            continue;
          }
          g.vx += wind * 120 * dt;
          g.vy += 26 * dt;
          g.vx *= Math.exp(-dt * 0.7);
          g.vy *= Math.exp(-dt * 0.7);
          g.x += g.vx * dt;
          g.y += g.vy * dt;
          for (const q of living) {
            if (q.id === g.fromId) continue;
            if (!q.geo || q.geo.openness < 0.25) continue;
            if (Math.hypot(q.hx - g.x, q.hy - g.y) > Math.max(12, q.hr * 0.9)) continue;
            const father = plants.find((f) => f.id === g.fromId);
            if (father) setSeedFrom(q, g.fromSeed, father.species.latent);
            grains.splice(k, 1);
            break;
          }
        }

        // ————— the garden pollinates itself, with nobody here —————
        if (nextPollenAt === 0) nextPollenAt = now + 7000;
        if (now >= nextPollenAt && !reduce && !clearing) {
          nextPollenAt = now + 8000 + volRng() * 12000;
          const open = living.filter((q) => q.geo && q.geo.openness > 0.4 && q.pollen > 0.4);
          if (open.length > 0) {
            const pick = open[Math.floor(volRng() * open.length) % open.length];
            releasePollen(pick, 2, 0.2 + Math.abs(wind) * 0.5);
          } else if (bees.length === 0 && living.length > 1 && volRng() < 0.4) {
            releaseBee(width * (0.1 + volRng() * 0.8), height * (0.3 + volRng() * 0.4));
          }
        }

        // — the season racing the length of the garden (the top rung) —
        if (seasonRace) {
          const before = seasonRace.u;
          seasonRace.u = Math.min(1, seasonRace.u + dt * timeScale * seasonRace.speed);
          for (const p of living) {
            if (p.nx > before && p.nx <= seasonRace.u) {
              // the front reaches it: a whole season in one pass
              p.phase = clamp01(Math.max(p.phase, BLOOM_PEAK + 0.05));
              if (!p.bloomed) crossBloom(p, false);
              p.over = Math.min(1, p.over + 0.4 + seasonRace.gain * 0.4);
              p.pollen = 1;
              releasePollen(p, 2 + Math.round(seasonRace.gain * 3), 0.6);
              swayPlant(p, (twinkleHash(p.seed % 997) - 0.5) * (1.4 + seasonRace.gain));
              note(midiOf(p.species), 90);
            }
          }
          if (seasonRace.u >= 1) {
            seasonRace = null;
            try { audio().chime(); } catch { /* noop */ }
            try { haptics.bloom(); } catch { /* noop */ }
            save();
          }
        }
      }

      // background — a garden after dark, lit by the candle families. Season
      // tints the wash toward its own light without leaving the palette.
      ctx.fillStyle = bgGrad ?? "#0a1214";
      ctx.fillRect(0, 0, width, height);
      const seasonTint = ["rgba(78,140,90,0.05)", "rgba(231,172,82,0.07)", "rgba(200,110,60,0.07)", "rgba(120,150,190,0.06)"];
      const si = Math.floor(((season % 4) + 4) % 4);
      ctx.fillStyle = seasonTint[si];
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(panX * 0.3, panY * 0.3);
      ctx.fillStyle = glowGrad ?? "rgba(231,172,82,0.1)";
      ctx.fillRect(-panX, -panY, width + Math.abs(panX) * 2, height + Math.abs(panY) * 2);
      ctx.restore();
      // drifting parchment motes — count scaled by the governed detail tier
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const moteCount = Math.max(6, Math.round(60 * detail.particles));
      for (let i = 0; i < moteCount; i++) {
        const px = twinkleHash(i + 401) * width + panX * 0.5;
        const py = twinkleHash(i + 809) * height + panY * 0.5;
        const tw = reduce ? 0.1 : 0.09 + Math.sin(localT * 0.5 + i) * 0.05;
        ctx.fillStyle = colorAlpha(i % 4 === 0 ? "#E7AC52" : "#DDD3BE", Math.max(0, tw));
        ctx.beginPath();
        ctx.arc(px, py, 0.4 + twinkleHash(i + 601) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // plants, painter's order
      const sorted = [...plants].sort((a, b) => a.ny - b.ny);
      for (const p of sorted) drawPlant(p, now, breath);

      // the wilted return to soil; the space is theirs to give back
      const wiltDur = reduce ? WILT_MS_REDUCED : WILT_MS;
      let removedPlanted = false;
      for (let i = plants.length - 1; i >= 0; i--) {
        const p = plants[i];
        if (p.wiltAt != null && now - p.wiltAt >= wiltDur) {
          if (!p.volunteer) removedPlanted = true;
          plants.splice(i, 1);
        }
      }
      if (removedPlanted) { save(true); syncPlanted(); }
      if (clearing && plants.every((p) => p.wiltAt == null)) clearing = false;

      // the season's front, where one is running the garden
      if (seasonRace) {
        const fx = seasonRace.u * width;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.16 + seasonRace.gain * 0.12);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx, 0);
        ctx.lineTo(fx, height);
        ctx.stroke();
        ctx.restore();
      }

      // the grains in flight, and the pollinators working the heads
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const g of grains) {
        const age = (now - g.born) / 6000;
        ctx.fillStyle = colorAlpha(g.color, (1 - age) * 0.75);
        ctx.beginPath();
        ctx.arc(g.x, g.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      for (const b of bees) {
        const flick = reduce ? 0 : Math.sin(localT * 26 + (b.seed % 13)) * 2.2;
        ctx.fillStyle = colorAlpha("#E7AC52", 0.75);
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, 3.2, 2.2, Math.atan2(b.vy, b.vx), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = colorAlpha("#F2EEE6", 0.4);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - 1);
        ctx.lineTo(b.x - 3, b.y - 3 - flick);
        ctx.moveTo(b.x, b.y - 1);
        ctx.lineTo(b.x + 3, b.y - 3 + flick);
        ctx.stroke();
        // what it is carrying, riding on its back
        if (b.carrying) {
          ctx.fillStyle = colorAlpha("#F2C56B", 0.8);
          ctx.beginPath();
          ctx.arc(b.x, b.y - 2.4, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // specks
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = specks.length - 1; i >= 0; i--) {
        const s = specks[i];
        const age = (now - s.born) / s.life;
        if (age >= 1) { specks.splice(i, 1); continue; }
        if (!reduce) {
          const drift = s.swirl * dt * timeScale;
          const nvx = s.vx * Math.cos(drift) - s.vy * Math.sin(drift);
          const nvy = s.vx * Math.sin(drift) + s.vy * Math.cos(drift);
          s.vx = nvx * (1 - dt * 0.6);
          s.vy = nvy * (1 - dt * 0.6) + 14 * dt;
          s.x += (s.vx + wind * 22) * dt * timeScale;
          s.y += s.vy * dt * timeScale;
        }
        ctx.fillStyle = colorAlpha(s.color, (1 - age) * 0.7);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * (1 + age * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // the fingertip charge — soil dimple and gathering glimmer from the
      // first millisecond of contact; the seed takes at the touch tier
      if (pressOn && pressContacts === 1) {
        const el = now - pressT0;
        const u = clamp01(el / THRESHOLDS.tapMaxMs);
        // dimple
        ctx.save();
        ctx.translate(pressX, pressY + 2);
        ctx.scale(12 + 7 * u, (12 + 7 * u) * 0.45);
        ctx.globalAlpha = 0.5 * u;
        ctx.fillStyle = shadowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // gathering glimmer, converging on the fingertip — a cached unit
        // gradient transformed + alpha-scaled, never recreated per frame
        const rr = reduce ? 16 : 26 - 12 * u;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(pressX, pressY);
        ctx.scale(rr, rr);
        ctx.globalAlpha = 0.1 + 0.24 * u;
        ctx.fillStyle = glimmerGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        if (!reduce) {
          ctx.fillStyle = colorAlpha("#F2C56B", 0.2 + 0.3 * u);
          for (let k = 0; k < 6; k++) {
            const a = k * 1.047 + el * 0.006;
            const rad = (1 - u) * 22 + 4;
            ctx.beginPath();
            ctx.arc(pressX + Math.cos(a) * rad, pressY + Math.sin(a) * rad, 1.1, 0, Math.PI * 2);
            ctx.fill();
          }
          if (el > THRESHOLDS.tapMaxMs) {
            // the hold is growing something — a slow breathing ring
            const q = ((el - THRESHOLDS.tapMaxMs) % 900) / 900;
            ctx.strokeStyle = colorAlpha("#E7AC52", (1 - q) * 0.25);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(pressX, pressY, 8 + q * 20, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // night (vessel: flip face-down) — the garden dims under a hushed veil
      if (nightAmt > 0.01) {
        ctx.fillStyle = `rgba(2, 4, 6, ${nightAmt * 0.72})`;
        ctx.fillRect(0, 0, width, height);
      }

      // glimmer — after quiet, a ring where a dwell would land (never text)
      const idleMs = now - lastInteractionAt;
      if (idleMs > 20000) {
        const slot = Math.floor(now / 9000);
        const gx = (0.2 + twinkleHash(slot) * 0.6) * width;
        const gy = (0.3 + twinkleHash(slot + 7) * 0.5) * height;
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.1 + pulse * 0.12);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gx, gy, 14 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // keyboard cursor
      if (focused && cursorVisible) {
        const cx = cursorNx * width;
        const cy = cursorNy * height;
        ctx.strokeStyle = colorAlpha("#F2EEE6", 0.7);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fillStyle = colorAlpha("#E7AC52", 0.85);
        ctx.fill();
      }

      if (dirty && now - lastSaveAt > 800) save(true);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      detach();
      detachVessel();
      offVisibility();
      offGalleryPause();
      wrap.removeEventListener("pointerdown", onPressDown);
      wrap.removeEventListener("pointermove", onPressMove);
      wrap.removeEventListener("pointerup", onPressUp);
      wrap.removeEventListener("pointercancel", onPressUp);
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("focus", onFocus);
      wrap.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener?.("change", onMq);
      save(true);
    };
  }, []);

  return (
    <div className="flowers-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={wrapRef}
        className="flowers-field"
        role="application"
        tabIndex={0}
        aria-label="a garden held in seed — rest a finger anywhere and a species gathers under your hand; arrows walk, enter plants and, held, blooms; a long-held press on a spent flower returns it to soil"
      >
        <canvas ref={canvasRef} className="flowers-canvas" aria-hidden="true" />
      </div>

      <LetGo label="let the garden go" onLetGo={() => letGoRef.current()} visible={plantedAlive > 0} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .flowers-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          background: #0a1214;
          overflow: hidden;
        }

        .flowers-field {
          position: relative;
          min-height: 100svh;
          isolation: isolate;
          overflow: hidden;
          outline: none;
        }

        .flowers-field:focus-visible {
          outline: 2px solid rgba(231, 172, 82, 0.7);
          outline-offset: -2px;
        }

        body:has(.flowers-page) {
          overflow: hidden;
          background: #0a1214;
        }

        body:has(.flowers-page) header:not(.oda-site-header) {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.flowers-page) .oda-field-watch,
        body:has(.flowers-page) .oda-candle-mark,
        body:has(.flowers-page) .oda-tape-shell,
        body:has(.flowers-page) .oda-sound-toggle {
          display: none !important;
        }

        .flowers-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          cursor: crosshair;
          touch-action: none;
          z-index: 0;
        }
      ` }}
      />
    </div>
  );
}
