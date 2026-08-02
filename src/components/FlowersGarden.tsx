"use client";

/**
 * /flowers — a living garden of discrete, deterministic species (W4).
 *
 * Every flower is a point in the botany latent (src/lib/botany.ts): its seed
 * is a hash of where and when it was planted, and the same seed decodes to
 * the same species forever. The hand speaks the shared grammar through
 * lib/gesture — long-press the ground to plant, keep holding a flower to
 * carry it bud → bloom → close (the bloom lands in the palm via
 * haptics.bloom()), tap to sway it, three fingers for wind and time, a twist
 * to rotate the lens from felt garden to botanical diagram. All breath rides
 * the site's shared 0.14 Hz swell. The garden persists in
 * `objetdart:flowers:v1`.
 */

import { useEffect, useRef } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { useField } from "@/store/field";
import {
  BLOOM_PEAK,
  flowerGeometry,
  hashSeed,
  petalOutline,
  speciesFromSeed,
  type FlowerGeometry,
  type Species,
} from "@/lib/botany";

const STORE_KEY = "objetdart:flowers:v1";
const MAX_PLANTS = 28;
const GEO_EPS = 0.004;

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

type Stored = { count: number; plants: Array<{ id: string; seed: number; nx: number; ny: number; phase: number; plantedAt: number }> };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

function colorAlpha(hex: string, alpha: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

function twinkleHash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function makePlant(seed: number, nx: number, ny: number, phase: number, plantedAt: number): Plant {
  const species = speciesFromSeed(seed);
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
    const hold: { plantId: string | null; planted: boolean } = { plantId: null, planted: false };

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => { reduce = mq.matches; };
    mq.addEventListener?.("change", onMq);

    // ————— persistence —————
    const save = (force = false) => {
      const now = performance.now();
      if (!force && now - lastSaveAt < 800) { dirty = true; return; }
      lastSaveAt = now;
      dirty = false;
      try {
        const stored: Stored = {
          count: plantCount,
          plants: plants.map((p) => ({ id: p.id, seed: p.seed, nx: p.nx, ny: p.ny, phase: p.phase, plantedAt: p.plantedAt })),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      } catch { /* quota; the garden lives on in memory */ }
    };

    const stored = loadStored();
    if (stored && stored.plants.length > 0) {
      plantCount = stored.count;
      plants = stored.plants.slice(-MAX_PLANTS).map((p) =>
        makePlant(p.seed, clamp01(p.nx), clamp01(p.ny), clamp01(p.phase), p.plantedAt || Date.now()),
      );
    } else {
      plants = STARTERS.map(([nx, ny, phase], i) =>
        makePlant(hashSeed(Math.round(nx * 997), Math.round(ny * 991), i), nx, ny, phase, Date.now()),
      );
      plantCount = plants.length;
      save(true);
    }

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(320, Math.floor(r.width));
      height = Math.max(480, Math.floor(r.height));
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toLocal = (clientX: number, clientY: number) => ({
      x: clamp(clientX - rectLeft, 0, width),
      y: clamp(clientY - rectTop, 0, height),
    });

    const plantAt = (x: number, y: number): Plant | null => {
      let best: Plant | null = null;
      let bestD = Infinity;
      for (const p of plants) {
        const dHead = Math.hypot(x - p.hx, y - p.hy);
        const rHit = Math.max(26, p.hr * 1.5);
        // the stem column also answers the hand
        const stemHit = Math.abs(x - p.bx) < 18 && y < p.by + 12 && y > p.hy;
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
      if (plants.length > MAX_PLANTS) plants.shift();
      // seed enters soil: two senses in the same frame
      try { audio().spark(); } catch { /* noop */ }
      note(midiOf(p.species) - 12, 160);
      try { haptics.ripple(0.55); } catch { /* noop */ }
      burst(x, y, [p.species.palette.stem, p.species.palette.heart], 8, 26);
      useField.getState().recordTape("object", 0.5, "flowers/plant");
      save();
      return p;
    };

    const advancePhase = (p: Plant, d: number, intensity: number) => {
      if (p.phase >= 1) return; // its season is done; the hand is absorbed
      p.phase = clamp01(p.phase + d * (0.7 + intensity * 0.6));
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
      if (!p.bloomed && p.phase >= BLOOM_PEAK) {
        p.bloomed = true;
        // full bloom: sight (burst), sound (bell), touch (bloom word) — one frame
        try { audio().bell(); } catch { /* noop */ }
        try { haptics.bloom(); } catch { /* noop */ }
        burst(p.hx, p.hy, [p.species.palette.heart, p.species.palette.petal, p.species.palette.glow], 18, 60);
        useField.getState().recordTape("sigil", 0.85, "flowers/bloom");
      }
      dirty = true;
    };

    // ————— gestures (the grammar, nothing private) —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers !== 1) return; // the frame and the law absorb stray taps
        const { x, y } = toLocal(e.x, e.y);
        const p = plantAt(x, y);
        if (p) {
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
          // three fingers touch the law: time dilates while held
          if (e.phase === "enter") { timeScaleTarget = 0.25; try { haptics.tap(); } catch { /* noop */ } note(36, 260); }
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          const p = plantAt(x, y);
          hold.plantId = p ? p.id : null;
          hold.planted = false;
          return;
        }
        if (e.phase === "release") {
          hold.plantId = null;
          hold.planted = false;
          save();
          return;
        }
        // ticks (~80ms)
        if (hold.plantId) {
          const p = plants.find((q) => q.id === hold.plantId);
          if (p) advancePhase(p, 0.00021 * 80, e.intensity);
        } else if (e.tier >= 2 && !hold.planted) {
          // dwell on open ground: plant — long-press means grow, everywhere
          hold.planted = true;
          const p = doPlant(x, y);
          if (p) hold.plantId = p.id; // keep holding and it keeps growing
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
      twist: (e) => {
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
        // circling stirs the pollen
        burst(x, y, ["#E7AC52", "#F2EEE6", "#4E7D8C"], 12, 34);
        for (const s of specks) s.swirl += Math.sign(e.winding) * 1.4;
        note(64, 90);
        try { haptics.ripple(0.3); } catch { /* noop */ }
      },
    });

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
        if (p) {
          advancePhase(p, 0.028, 0.5); // held Enter repeats — the keyboard's long-press
        } else if (!ev.repeat) {
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
    const drawPetalPath = (o: ReturnType<typeof petalOutline>, len: number, w: number) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(o.c1.x * w, o.c1.y * len, o.c2.x * w, o.c2.y * len, o.tip.x * w, o.tip.y * len);
      ctx.bezierCurveTo(-o.c2.x * w, o.c2.y * len, -o.c1.x * w, o.c1.y * len, 0, 0);
      ctx.closePath();
    };

    const drawHead = (p: Plant, geo: FlowerGeometry, hs: number, feltAlpha: number, breathScale: number, detail: boolean) => {
      const sp = p.species;
      const o = petalOutline(sp.petal);
      ctx.save();
      ctx.scale(hs * breathScale, hs * breathScale);
      // sepal / bud casing, fading as it opens
      const budA = clamp01(1 - geo.openness * 1.7);
      if (budA > 0.01) {
        ctx.fillStyle = colorAlpha(sp.palette.stem, budA * 0.9 * feltAlpha);
        ctx.beginPath();
        ctx.ellipse(0, 0, geo.headRadius * 0.42, geo.headRadius * 0.58, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // petals, outer layer first
      for (let i = geo.petals.length - 1; i >= 0; i--) {
        const pe = geo.petals[i];
        if (pe.length <= 0.001) continue;
        if (!detail && pe.layer > 0) continue; // side crowns keep one whorl
        ctx.save();
        ctx.rotate(pe.angle);
        ctx.translate(0, -geo.heartRadius * 0.55 * pe.splay);
        ctx.fillStyle = colorAlpha(
          pe.layer % 2 === 0 ? sp.palette.petal : sp.palette.petalDeep,
          (0.6 + 0.34 * pe.splay) * feltAlpha,
        );
        drawPetalPath(o, pe.length, pe.width);
        ctx.fill();
        ctx.restore();
      }
      // the heart and its golden-angle florets
      if (geo.openness > 0.3) {
        const heartA = clamp01((geo.openness - 0.3) / 0.4) * feltAlpha;
        ctx.fillStyle = colorAlpha(sp.palette.petalDeep, heartA * 0.85);
        ctx.beginPath();
        ctx.arc(0, 0, geo.heartRadius, 0, Math.PI * 2);
        ctx.fill();
        if (detail) {
          ctx.fillStyle = colorAlpha(sp.palette.heart, heartA);
          for (const f of geo.florets) {
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          ctx.fillStyle = colorAlpha(sp.palette.heart, heartA * 0.9);
          ctx.beginPath();
          ctx.arc(0, 0, geo.heartRadius * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
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

    const drawPlant = (p: Plant, t: number, breath: number) => {
      if (!p.geo || Math.abs(p.phase - p.geoPhase) > GEO_EPS) {
        p.geo = flowerGeometry(p.species, p.phase);
        p.geoPhase = p.phase;
      }
      const geo = p.geo;
      const sp = p.species;
      const minDim = Math.min(width, height);
      const size = minDim * (0.26 + 0.2 * ((sp.height - 0.55) / 0.45)) * zoom;
      const bx = p.nx * width;
      const by = p.ny * height;
      const lean = reduce ? 0 : p.swayX * 0.16 + wind * 0.11 + breath * 0.012 * sp.breathDepth;
      const feltAlpha = 1 - lens;

      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(lean);
      ctx.scale(size, size);

      // stems + leaves — felt pass
      if (feltAlpha > 0.02) {
        ctx.strokeStyle = colorAlpha(sp.palette.stem, 0.9 * feltAlpha);
        ctx.lineCap = "round";
        for (const s of geo.stems) {
          ctx.lineWidth = 0.016 * s.width;
          ctx.beginPath();
          ctx.moveTo(s.pts[0].x, s.pts[0].y);
          for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
          ctx.stroke();
        }
        ctx.fillStyle = colorAlpha(sp.palette.leaf, 0.75 * feltAlpha);
        for (const lf of geo.leaves) {
          ctx.save();
          ctx.translate(lf.x, lf.y);
          ctx.rotate(lf.angle);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(lf.size * 0.5, -lf.size * 0.25, lf.size * 0.55, -lf.size * 0.9, 0, -lf.size * 1.2);
          ctx.bezierCurveTo(-lf.size * 0.5, -lf.size * 0.9, -lf.size * 0.45, -lf.size * 0.25, 0, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      // lens pass — the skeleton
      if (lens > 0.02) {
        ctx.strokeStyle = colorAlpha(sp.palette.glow, lens * 0.55);
        ctx.lineCap = "round";
        for (const s of geo.stems) {
          ctx.lineWidth = 0.006;
          ctx.beginPath();
          ctx.moveTo(s.pts[0].x, s.pts[0].y);
          for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
          ctx.stroke();
        }
      }

      // crowns
      const breathScale = reduce ? 1 : 1 + Math.sin(breath + p.breathOffset) * 0.035 * sp.breathDepth;
      for (let h = 0; h < geo.heads.length; h++) {
        const head = geo.heads[h];
        const hs = h === 0 ? 1 : 0.42 + head.scale * 0.4;
        ctx.save();
        ctx.translate(head.x, head.y);
        if (feltAlpha > 0.02) drawHead(p, geo, hs, feltAlpha, breathScale, h === 0);
        if (lens > 0.02) drawHeadLens(p, geo, hs, lens, h === 0);
        ctx.restore();
        if (h === 0) {
          // record screen-space head + base for hit tests (sway ignored — small)
          p.hx = bx + head.x * size;
          p.hy = by + head.y * size;
          p.hr = geo.headRadius * size * Math.max(1, sp.petal.length);
          p.bx = bx;
          p.by = by;
        }
      }
      ctx.restore();
      void t;
    };

    // ————— the loop —————
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!reduce && now - lastFrame < 30) return;
      lastFrame = now;
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduce) localT += dt * timeScale;
      wind += (windTarget - wind) * Math.min(1, dt * 2.2);
      windTarget *= Math.exp(-dt * 0.5);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);

      // shared breath: the audio swell clock when audible, RAF when not
      const audioT = (() => { try { return audio().getAudioTime(); } catch { return null; } })();
      const bt = audioT != null ? audioT : now / 1000;
      const breath = bt * Math.PI * 2 * 0.14;

      // springs
      for (const p of plants) {
        if (reduce) { p.swayX = 0; p.swayV = 0; continue; }
        const omega = 2.2 + p.species.swayStiffness * 3.4;
        p.swayV += (-omega * omega * p.swayX - 2 * 0.55 * omega * p.swayV) * dt * timeScale;
        p.swayX += p.swayV * dt * timeScale;
      }

      // background — a garden after dark, lit by the candle families
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, "#0a1214");
      bg.addColorStop(0.62, "#0d1a1c");
      bg.addColorStop(1, "#122023");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      const glow = ctx.createRadialGradient(width * 0.5, height * 0.3, 10, width * 0.5, height * 0.42, Math.max(width, height) * 0.7);
      glow.addColorStop(0, "rgba(231, 172, 82, 0.10)");
      glow.addColorStop(0.5, "rgba(78, 125, 140, 0.05)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      // drifting parchment motes
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 60; i++) {
        const px = twinkleHash(i + 401) * width;
        const py = twinkleHash(i + 809) * height;
        const tw = reduce ? 0.1 : 0.09 + Math.sin(localT * 0.5 + i) * 0.05;
        ctx.fillStyle = colorAlpha(i % 4 === 0 ? "#E7AC52" : "#DDD3BE", Math.max(0, tw));
        ctx.beginPath();
        ctx.arc(px, py, 0.4 + twinkleHash(i + 601) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // plants, painter's order
      const sorted = [...plants].sort((a, b) => a.ny - b.ny);
      for (const p of sorted) drawPlant(p, localT, breath);

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
        aria-label="a garden held in seed — rest a finger on the soil and a species opens under your hand; arrows walk, enter plants and, held, blooms"
      >
        <canvas ref={canvasRef} className="flowers-canvas" aria-hidden="true" />
      </div>

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
