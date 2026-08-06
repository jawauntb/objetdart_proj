"use client";

/**
 * /rocks — boulders, gems, salts. A cabinet peer at the drop band
 * (~10⁻³·⁵–10⁻¹·⁵ m), beside /drop and /seed: the mineral register, hard
 * and faceted and ringing, where /soil is soft and damp.
 *
 * The invariant is a lattice (src/lib/crystal.ts) — a metric, a centering,
 * a point group, a cleavage family. Everything here is that one object
 * again: the habit is the intersection of halfspaces on lattice planes, so
 * a salt grows a cube and a calcite a rhombohedron without either being
 * drawn; a fracture is a cut on a member of the cleavage orbit, so the
 * stone chooses the plane and the same strike always finds the same one;
 * and the ring is the reciprocal lattice heard — the partial ratios are
 * the allowed reflections, which is a diffraction fingerprint, so the room
 * can name the mineral back from its own sound (the lens does exactly
 * that, in front of you).
 *
 * Alive at rest: the brine is still supersaturated, so every stone is
 * still coming out of solution — slowly, on its own analytic clock, never
 * on a history — and the facets turn through the light on the shared 7s
 * breath. Salt creeps along the rim of the pool while nobody watches.
 *
 * One finger is the material: drag turns a stone in your fingers, a flick
 * cleaves it, a hold on the wet dark plants a nucleus and feeds it for as
 * long as you hold, a ceremony hold on the nodule opens the geode. Three
 * fingers are the world-law: drag is how much is dissolved, hold dilates
 * the clock, tap rings the whole shelf at once. Twist raises the lattice
 * lens. The vessel leans the light, shakes salt out of solution, and a
 * knock rings the tray.
 *
 * The shelf persists in `objetdart:rocks:v1` (stones as species + seed +
 * cut list, so every fragment is reconstructible) with the quiet clear at
 * the bottom. Pinch and pan2 stay unbound — ScaleTravel and MetaNavigator
 * own the frame.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import LetGo from "@/components/LetGo";
import {
  SPECIES,
  clamp,
  clamp01,
  cleavagePitch,
  cleavagePlanes,
  clipHalfspace,
  dissolveStep,
  drawFrom,
  elongationOf,
  faceNormal,
  growStep,
  habitMesh,
  hashSeed,
  meshVolume,
  MOHS,
  mulberry32,
  nucleate,
  partialsOf,
  planeNormal,
  ringRatios,
  ripen,
  scaleForMass,
  scratchOutcome,
  settleStones,
  speciesFromRing,
  type Mesh,
  type Miller,
  type SpeciesId,
  type Vec3,
} from "@/lib/crystal";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
  type QualityTier,
} from "@/lib/room-runtime";

const STORE_KEY = "objetdart:rocks:v1";
/** how much of a stone's mass a linear metre is worth — the drop band */
const METRES_PER_UNIT = 0.03;
const MAX_CUTS = 3;

type Cut = { hkl: Miller; sign: 1 | -1; offset: number };

type Stone = {
  species: SpeciesId;
  seed: number;
  nx: number;
  ny: number;
  yaw: number;
  pitch: number;
  spin: number;
  /** the pocket of solution this stone is still drawing from */
  dissolved: number;
  solid: number;
  cuts: Cut[];
  /** a rough nodule with a druse inside, waiting to be opened */
  geode: boolean;
  /** this piece was once the inside of a geode: its fresh face is lined */
  lined: boolean;
  /** how deeply another, harder stone has grooved this one, 0..1 */
  scratched: number;
  born: number;
  // — runtime only, never persisted —
  mesh?: Mesh;
  meshKey?: string;
  lit?: number;
  fresh?: number;
};

type Stored = { stones?: Partial<Stone>[]; pool?: number; cleared?: boolean };

const isSpecies = (s: unknown): s is SpeciesId =>
  typeof s === "string" && Object.prototype.hasOwnProperty.call(SPECIES, s);

export default function RockShelf() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const stonesRef = useRef<Stone[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !canvas || !overlay) return;
    // The material is a shader. The 2D layer above it carries only the
    // lattice lens's notation — glyphs, never the stone (the Sea precedent).
    const gl = (canvas.getContext("webgl", {
      antialias: true,
      alpha: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    }) ||
      canvas.getContext("experimental-webgl" as "webgl")) as WebGLRenderingContext | null;
    const ctx = overlay.getContext("2d");
    if (!gl || !ctx) return;

    const audio = getFieldAudio();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;
    const onMq = () => {
      reduced = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    // The shared performance organs — never a private pause bus.
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let tier: QualityTier = gov.tier();
    let hidden = false;
    let galleryPaused = false;
    let asleep = false;

    // ——— 1. state ————————————————————————————————————————
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let last = performance.now();
    let localT = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    /** the world-law: how supersaturated the brine is, 0..1 */
    let saturation = 0.22;
    let saturationTarget = 0.22;
    /** what is still dissolved in the tray itself, waiting to be given out */
    let pool = 1.6;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let lean = 0;
    let leanTarget = 0;
    let night = 0;
    let nightTarget = 0;
    let selected = -1;
    let heldStone = -1;
    let holdFed = 0;
    let kbCharge = 0;
    let leaving = 0;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let glimmerStone = -1;
    let entrainBpm = 0;
    let entrainUntil = 0;
    let entrainBeat = -1;
    let lastTurnSoundAt = 0;
    let lastScratchAt = 0;
    /** the room's season: how hot the brine has been run, 0..1 */
    let season = 0.4;
    let dirty = false;

    // ——— 2. persistence ————————————————————————————————
    let cleared = false;
    let visited = false;
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        visited = true;
        const parsed = JSON.parse(raw) as Stored;
        cleared = parsed.cleared === true;
        if (typeof parsed.pool === "number" && isFinite(parsed.pool)) pool = clamp(parsed.pool, 0, 4);
        if (Array.isArray(parsed.stones)) {
          stonesRef.current = settleStones(
            parsed.stones
              .filter((s) => isSpecies(s?.species))
              .map((s, i) => reviveStone(s, i)),
          );
        }
      }
    } catch {
      /* a fresh shelf */
    }

    function reviveStone(s: Partial<Stone>, i: number): Stone {
      const cuts: Cut[] = Array.isArray(s.cuts)
        ? s.cuts
            .filter((c) => Array.isArray(c?.hkl) && c.hkl.length === 3)
            .slice(0, MAX_CUTS)
            .map((c) => ({
              hkl: [Math.round(c.hkl[0]), Math.round(c.hkl[1]), Math.round(c.hkl[2])] as Miller,
              sign: c.sign === -1 ? -1 : 1,
              offset: Number.isFinite(c.offset) ? clamp(c.offset as number, -2, 2) : 0,
            }))
        : [];
      return {
        species: (s.species as SpeciesId) ?? "halite",
        seed: Number.isFinite(s.seed) ? (s.seed as number) : hashSeed(i, 7),
        nx: clamp(Number(s.nx) || 0.5, 0.08, 0.92),
        ny: clamp(Number(s.ny) || 0.6, 0.22, 0.9),
        yaw: Number(s.yaw) || 0,
        pitch: clamp(Number(s.pitch) || 0, -1.1, 1.1),
        spin: 0,
        dissolved: clamp(Number(s.dissolved) || 0, 0, 1),
        solid: clamp(Number(s.solid) || 0.02, 0.0006, 0.6),
        cuts,
        geode: s.geode === true,
        lined: s.lined === true,
        scratched: clamp01(Number(s.scratched) || 0),
        born: performance.now(),
      };
    }

    // Alive before it is touched: a shelf already stands when anyone
    // arrives — unless it was deliberately let go, which is remembered.
    if (stonesRef.current.length === 0 && !cleared) {
      const starters: {
        species: SpeciesId;
        nx: number;
        ny: number;
        solid: number;
        yaw: number;
        pitch: number;
        geode?: boolean;
      }[] = [
        { species: "quartz", nx: 0.245, ny: 0.6, solid: 0.14, yaw: 0.5, pitch: -0.12 },
        { species: "halite", nx: 0.415, ny: 0.615, solid: 0.055, yaw: 0.62, pitch: 0.18 },
        { species: "halite", nx: 0.34, ny: 0.715, solid: 0.03, yaw: 1.15, pitch: 0.05 },
        { species: "calcite", nx: 0.555, ny: 0.665, solid: 0.09, yaw: 2.3, pitch: 0.5 },
        { species: "topaz", nx: 0.485, ny: 0.775, solid: 0.06, yaw: 0.9, pitch: -0.2 },
        { species: "pyrite", nx: 0.685, ny: 0.605, solid: 0.055, yaw: 0.35, pitch: 0.32 },
        { species: "zircon", nx: 0.63, ny: 0.76, solid: 0.035, yaw: 1.9, pitch: 0.1 },
        { species: "quartz", nx: 0.15, ny: 0.775, solid: 0.15, yaw: 2.7, pitch: 0.24, geode: true },
      ];
      stonesRef.current = starters.map((s, i) => {
        const rng = mulberry32(hashSeed(0x0c3a, i));
        return {
          species: s.species,
          seed: hashSeed(0x0c3a, i, 3),
          nx: s.nx,
          ny: s.ny,
          yaw: s.yaw,
          pitch: s.pitch,
          spin: 0,
          dissolved: 0.02 + rng() * 0.05,
          solid: s.solid,
          cuts: [],
          geode: s.geode === true,
          lined: false,
          scratched: 0,
          born: performance.now(),
        };
      });
    }
    setHasKept(stonesRef.current.length > 0);

    const save = () => {
      try {
        const payload: Stored = {
          stones: stonesRef.current.map((s) => ({
            species: s.species,
            seed: s.seed,
            nx: s.nx,
            ny: s.ny,
            yaw: s.yaw,
            pitch: s.pitch,
            dissolved: s.dissolved,
            solid: s.solid,
            cuts: s.cuts,
            geode: s.geode,
            lined: s.lined,
            scratched: s.scratched,
          })),
          pool,
          cleared,
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* noop */
      }
      setHasKept(stonesRef.current.length > 0);
    };
    // persistence rides the shared idle writer, never a per-frame write
    const writer = createIdleWriter(save, 400);
    if (!visited) save();

    // hidden tab, gallery iframe, unfocused embed — one sleep bit, shared
    const syncSleep = () => {
      const sleep = hidden || galleryPaused || (embedded && !document.hasFocus());
      if (sleep) gov.force("sleep");
      asleep = sleep;
    };
    const unvis = onVisibility((h) => {
      hidden = h;
      syncSleep();
    });
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    // ——— 3. geometry: the habit, and what the cuts made of it ————
    // Habit meshes are computed once per species and cached; a stone's own
    // mesh is rebuilt only when its cut list changes. Growth is a scale, so
    // the per-frame cost is O(visible faces) and never O(history).
    const habitCache = new Map<SpeciesId, Mesh>();
    const habitOf = (id: SpeciesId): Mesh => {
      let m = habitCache.get(id);
      if (!m) {
        m = habitMesh(id);
        habitCache.set(id, m);
      }
      return m;
    };

    /** A geode's rough nodule: the same lattice, knocked about by its seed. */
    const noduleMesh = (s: Stone): Mesh => {
      let mesh: Mesh | null = habitOf(s.species);
      const rng = mulberry32(s.seed);
      for (let i = 0; i < 14 && mesh; i++) {
        const a = rng() * Math.PI * 2;
        const b = Math.acos(2 * rng() - 1);
        const n: Vec3 = [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)];
        mesh = clipHalfspace(mesh, n, 0.36 + rng() * 0.16);
      }
      if (!mesh) return habitOf(s.species);
      const v = meshVolume(mesh);
      const k = 1 / Math.cbrt(Math.max(1e-9, v));
      return { verts: mesh.verts.map((x) => x * k), faces: mesh.faces };
    };

    const meshOf = (s: Stone): Mesh => {
      const key = `${s.geode ? "g" : "h"}:${s.cuts.map((c) => `${c.hkl.join("")}${c.sign}${c.offset.toFixed(3)}`).join("|")}`;
      if (s.mesh && s.meshKey === key) return s.mesh;
      let mesh: Mesh | null = s.geode ? noduleMesh(s) : habitOf(s.species);
      for (const cut of s.cuts) {
        if (!mesh) break;
        const n = planeNormal(SPECIES[s.species].lattice, cut.hkl);
        mesh = clipHalfspace(
          mesh,
          [n[0] * cut.sign, n[1] * cut.sign, n[2] * cut.sign],
          cut.offset * cut.sign,
        );
      }
      s.mesh = mesh ?? habitOf(s.species);
      s.meshKey = key;
      return s.mesh;
    };

    const sizeMetres = (s: Stone) => METRES_PER_UNIT * Math.cbrt(Math.max(1e-6, s.solid));

    // ——— 4. sound: the ring is the reciprocal lattice ————————
    const ringStone = (s: Stone, strength = 1) => {
      const mesh = meshOf(s);
      const parts = partialsOf(s.species, sizeMetres(s), elongationOf(mesh), 5);
      let voiced = 0;
      for (const p of parts) {
        if (p.gain < 0.24 || voiced >= 4) break;
        voiced += 1;
        try {
          audio.playTone(p.hz, p.seconds * (0.45 + 0.55 * strength));
        } catch {
          /* the sea is not awake */
        }
      }
      s.lit = Math.max(s.lit ?? 0, 0.6 + 0.4 * strength);
    };

    /** A cleaved plane speaks its own spacing: a wide plane speaks low. */
    const soundCleave = (s: Stone, hkl: Miller) => {
      const f = cleavagePitch(s.species, hkl, sizeMetres(s));
      try {
        audio.playTone(f, 0.5);
        audio.playTone(f * 2.02, 0.22);
      } catch {
        /* noop */
      }
    };

    // ——— 5. the shelf's own acts ————————————————————————
    const stoneAt = (px: number, py: number): number => {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < stonesRef.current.length; i++) {
        const s = stonesRef.current[i];
        const r = stoneRadiusPx(s);
        const dx = px - s.nx * width;
        const dy = py - s.ny * height;
        const d = Math.hypot(dx, dy);
        if (d < r * 1.35 && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

    /** One unit of habit, in pixels — the room's only length scale. */
    const unitPx = () => Math.min(width, height) * 0.2;

    const stoneRadiusPx = (s: Stone) => unitPx() * scaleForMass(meshOf(s), s.solid);

    /**
     * The stone chooses the plane. A strike direction picks the member of
     * the cleavage orbit it is most nearly across, in the stone's own
     * turned frame — so a fracture follows the lattice, and turning the
     * stone turns which plane your hand can find.
     */
    const cleave = (i: number, dirScreen: [number, number], strength: number) => {
      const s = stonesRef.current[i];
      if (!s || s.cuts.length >= MAX_CUTS) return;
      const mesh = meshOf(s);
      const inv = invRotation(s);
      // the strike's plane normal in world space is across the stroke
      const worldN: Vec3 = [dirScreen[1], 0.35, -dirScreen[0]];
      const objN = applyMat(inv, worldN);
      const planes = cleavagePlanes(s.species);
      let bestHkl: Miller = planes[0];
      let bestA = -Infinity;
      const on = norm(objN);
      for (const hkl of planes) {
        const n = planeNormal(SPECIES[s.species].lattice, hkl);
        const a = n[0] * on[0] + n[1] * on[1] + n[2] * on[2];
        if (a > bestA) {
          bestA = a;
          bestHkl = hkl;
        }
      }
      const n = planeNormal(SPECIES[s.species].lattice, bestHkl);
      // the cut lands a little off centre, deterministically from the seed —
      // in object units, because the habit meshes are unit-volume
      const rng = mulberry32(hashSeed(s.seed, s.cuts.length, Math.round(strength * 100)));
      const offset = (rng() - 0.5) * 0.42;
      const front = clipHalfspace(mesh, n, offset);
      const back = clipHalfspace(mesh, [-n[0], -n[1], -n[2]], -offset);
      if (!front || !back) return;
      const vf = meshVolume(front);
      const vb = meshVolume(back);
      const total = vf + vb;
      if (total <= 1e-9) return;
      const wasGeode = s.geode;

      const other: Stone = {
        ...s,
        seed: hashSeed(s.seed, 0x5c, s.cuts.length),
        cuts: [...s.cuts, { hkl: bestHkl, sign: -1, offset }],
        solid: s.solid * (vb / total),
        dissolved: s.dissolved * 0.5,
        geode: false,
        lined: wasGeode,
        scratched: s.scratched * 0.5,
        nx: clamp(s.nx + n[0] * 0.05, 0.08, 0.92),
        ny: clamp(s.ny - n[2] * 0.03 + 0.01, 0.22, 0.9),
        yaw: s.yaw + 0.22,
        spin: -0.5 * strength,
        mesh: undefined,
        meshKey: undefined,
        fresh: 1,
        born: performance.now(),
      };
      s.cuts = [...s.cuts, { hkl: bestHkl, sign: 1, offset }];
      s.solid = s.solid * (vf / total);
      s.dissolved *= 0.5;
      s.geode = false;
      s.lined = wasGeode;
      s.nx = clamp(s.nx - n[0] * 0.05, 0.08, 0.92);
      s.spin = 0.5 * strength;
      s.mesh = undefined;
      s.meshKey = undefined;
      s.fresh = 1;

      stonesRef.current = settleStones([...stonesRef.current, other]);
      selected = stonesRef.current.indexOf(s);

      soundCleave(s, bestHkl);
      ringStone(s, 0.5 + strength * 0.5);
      try {
        haptics.detent();
        if (wasGeode) haptics.bloom();
      } catch {
        /* noop */
      }
      stirTurbulence(0.1 + strength * 0.2);
      dirty = true;
    };

    /** A nucleus lands on the wet dark and starts drawing from the tray. */
    const plant = (px: number, py: number, amount: number): number => {
      const seedN = hashSeed(Math.round(px), Math.round(py), stonesRef.current.length);
      const spec = nucleate(seedN, stonesRef.current.length);
      const drawn = drawFrom({ dissolved: pool, solid: 0 }, amount);
      pool = drawn.pool.dissolved;
      const rng = mulberry32(seedN);
      const s: Stone = {
        species: spec.species,
        seed: seedN,
        nx: clamp(px / Math.max(1, width), 0.08, 0.92),
        ny: clamp(py / Math.max(1, height), 0.22, 0.9),
        yaw: rng() * Math.PI * 2,
        pitch: (rng() - 0.5) * 0.6,
        spin: 0,
        dissolved: drawn.taken,
        solid: 0.0009,
        cuts: [],
        geode: false,
        lined: false,
        scratched: 0,
        born: performance.now(),
        fresh: 0.6,
      };
      stonesRef.current = settleStones([...stonesRef.current, s]);
      dirty = true;
      return stonesRef.current.indexOf(s);
    };

    const feed = (i: number, amount: number) => {
      const s = stonesRef.current[i];
      if (!s) return;
      const drawn = drawFrom({ dissolved: pool, solid: 0 }, amount);
      pool = drawn.pool.dissolved;
      s.dissolved += drawn.taken;
    };

    /**
     * Two stones dragged across each other: the softer one takes the mark.
     * Mohs, straight — salt grooves under quartz and quartz never under
     * salt — heard as a dry scrape pitched by the victim, felt as chop.
     */
    const scratch = (a: Stone, b: Stone, force: number) => {
      const out = scratchOutcome(a.species, b.species);
      if (!out) {
        // equal hardness: they only knock, and both ring
        ringStone(a, 0.3);
        ringStone(b, 0.3);
        try {
          haptics.tap();
        } catch {
          /* noop */
        }
        return;
      }
      const victim = out.victim === a.species ? a : b;
      const agent = victim === a ? b : a;
      const bite = out.depth * force;
      victim.scratched = clamp01((victim.scratched ?? 0) + bite * 0.5);
      // a groove is stone taken off: the mass goes back into the brine
      const lost = victim.solid * bite * 0.02;
      victim.solid = Math.max(0.0006, victim.solid - lost);
      pool += lost;
      victim.lit = Math.max(victim.lit ?? 0, 0.3 + bite * 0.4);
      agent.lit = Math.max(agent.lit ?? 0, 0.2);
      try {
        // the scrape: the softer stone's own voice, dulled and short
        const f = partialsOf(victim.species, sizeMetres(victim), 1, 2)[0];
        audio.playTone(f.hz * (0.5 + bite * 0.3), 0.09);
        audio.playNote(38, 90);
        haptics.chop();
      } catch {
        /* noop */
      }
      stirTurbulence(0.05 + bite * 0.1);
      dirty = true;
    };

    /** Which other stone this one is currently lying against, if any. */
    const neighbourOf = (i: number): number => {
      const a = stonesRef.current[i];
      if (!a) return -1;
      const ra = stoneRadiusPx(a);
      for (let j = 0; j < stonesRef.current.length; j++) {
        if (j === i) continue;
        const b = stonesRef.current[j];
        const rb = stoneRadiusPx(b);
        const dx = (a.nx - b.nx) * width;
        const dy = (a.ny - b.ny) * height;
        if (Math.hypot(dx, dy) < (ra + rb) * 0.82) return j;
      }
      return -1;
    };

    /**
     * Everything alive answers at once — the chord of the whole shelf,
     * struck exactly as hard as the hand asked for it.
     */
    const tutti = (strength = 0.4) => {
      const list = stonesRef.current;
      const step = clamp(900 / Math.max(1, list.length), 40, 140);
      list.forEach((s, i) => {
        window.setTimeout(() => ringStone(s, strength), i * step);
      });
      try {
        haptics.ripple(strength);
      } catch {
        /* noop */
      }
    };

    const setLens = (snapped: number) => {
      if (snapped === lensSnapped) return;
      lensSnapped = snapped;
      lensTarget = snapped;
      try {
        haptics.lens();
        if (snapped === 1) audio.chime();
        else audio.playNote(44, 160);
      } catch {
        /* noop */
      }
    };

    // ——— 6. the room's frame, and the shaders that draw it ————
    // fwidth lives behind an extension on WebGL1: take it before compiling,
    // and fall back to a fixed edge width where it is not offered.
    const derivs = !!gl.getExtension("OES_standard_derivatives");

    const compile = (type: number, src: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const link = (vsrc: string, fsrc: string): WebGLProgram | null => {
      const vs = compile(gl.VERTEX_SHADER, vsrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsrc);
      if (!vs || !fs) return null;
      const p = gl.createProgram();
      if (!p) return null;
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
    };

    // — the brine: tray, lamp, suspended grains and the creeping rim, all
    //   marched in one fragment pass. Bounded loops, no gradients, no blur.
    const brineProg = link(
      `attribute vec2 a_pos;
       varying vec2 v_uv;
       void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`,
      `precision highp float;
       varying vec2 v_uv;
       uniform vec2  u_res;
       uniform float u_t;        // the room's own slow clock
       uniform float u_breath;   // the shared 7s breath, 0..1
       uniform float u_sat;      // how supersaturated the brine is
       uniform float u_lean;     // the vessel's tilt
       uniform float u_dim;      // night
       uniform float u_creep;    // how far the salt has crawled the rim
       uniform float u_detail;   // quality tier, 0..1
       uniform vec3  u_stones[14]; // x, y (0..1 of the frame), radius
       uniform int   u_nStones;

       float hash(vec2 p) {
         return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
       }

       void main() {
         vec2 uv = v_uv;
         float aspect = u_res.x / max(1.0, u_res.y);

         // the dark of the cabinet, deepening toward the floor
         vec3 col = mix(vec3(0.020, 0.023, 0.031),
                        vec3(0.055, 0.059, 0.078), pow(1.0 - uv.y, 1.6));

         // the lamp: one warm source off the upper left, breathing
         vec2 lampP = vec2(0.18 - u_lean * 0.06, 0.90);
         float ld = distance(vec2(uv.x * aspect, uv.y), vec2(lampP.x * aspect, lampP.y));
         float lamp = exp(-ld * 2.1) * (0.72 + 0.28 * u_breath);
         col += vec3(0.95, 0.84, 0.48) * lamp * 0.15;

         // the dish of brine — an ellipse, shaded by its own depth
         vec2 c = vec2(0.5, 0.37);
         vec2 d = vec2((uv.x - c.x) * aspect, (uv.y - c.y));
         float rx = min(0.43 * aspect, 0.35);
         float ry = rx * 0.38;
         float e = length(vec2(d.x / rx, d.y / ry));
         float inDish = 1.0 - smoothstep(0.985, 1.0, e);
         float depth = sqrt(max(0.0, 1.0 - e * e));
         float brine = 0.12 + u_sat * 0.5;
         col = mix(col,
                   mix(vec3(0.040, 0.052, 0.074), vec3(0.32, 0.40, 0.52), depth * (0.35 + brine * 0.5)),
                   inDish * 0.92);

         // the meniscus, catching the lamp along its upper left
         float rim = smoothstep(0.02, 0.0, abs(e - 1.0));
         float facing = clamp(0.5 - d.x / rx * 0.5 + d.y / ry * 0.5, 0.0, 1.0);
         col += mix(vec3(0.47, 0.58, 0.78), vec3(0.96, 0.91, 0.74), facing)
                * rim * (0.34 + brine * 0.34);

         // grains still in suspension, and the salt crawling the rim —
         // one bounded loop, count folded down on weak frames
         int steps = 24;
         for (int i = 0; i < 24; i++) {
           if (float(i) > 24.0 * u_detail) break;
           float fi = float(i);
           float a = hash(vec2(fi, 1.0)) * 6.2831;
           float rr = sqrt(hash(vec2(fi, 2.0)));
           float sz = hash(vec2(fi, 3.0));
           // suspended: drifting inside the dish
           vec2 gp = vec2(cos(a + sin(u_t * 0.2 + fi) * 0.03) * rx * rr,
                          sin(a + sin(u_t * 0.2 + fi) * 0.03) * ry * rr);
           float g = exp(-distance(d, gp) * 620.0 / (1.0 + sz));
           col += vec3(0.88, 0.92, 0.98) * g * (0.06 + u_sat * 0.34) * sz;
           // creeping: jutting past the rim, advancing while nobody watches
           float jut = hash(vec2(fi, 4.0));
           if (jut < u_creep) {
             float k = 1.0 + jut * 0.12 + sin(u_t * 0.25 + fi) * 0.004;
             vec2 cp = vec2(cos(a + 0.7) * rx * k, sin(a + 0.7) * ry * k);
             float s = exp(-distance(d, cp) * 420.0 / (1.0 + sz * 2.0));
             float face = 0.35 + 0.65 * clamp(-cos(a) * 0.5 - sin(a) * 0.5 + 0.5, 0.0, 1.0);
             col += vec3(0.96, 0.96, 0.98) * s * (0.2 + brine * 0.7) * (1.0 - jut) * face;
           }
         }
         steps = 0;

         // the shadow each stone casts on the wet tray — the thing that
         // makes a crystal sit IN the brine rather than float over it
         for (int i = 0; i < 14; i++) {
           if (i >= u_nStones) break;
           vec3 st = u_stones[i];
           vec2 sd = vec2((uv.x - st.x) * aspect, (uv.y - st.y));
           float sh = 1.0 - smoothstep(st.z * 0.35, st.z * 1.15, length(vec2(sd.x, sd.y / 0.42)));
           col *= 1.0 - sh * 0.62 * inDish;
           col *= 1.0 - sh * 0.30 * (1.0 - inDish);
         }

         // a saturated brine glows faintly at the near edge
         col += vec3(0.30, 0.40, 0.55) * max(0.0, u_sat - 0.35) * 0.2 * pow(1.0 - uv.y, 2.0);

         gl_FragColor = vec4(col * u_dim, 1.0);
       }`,
    );

    // — the stones: flat-shaded lattice facets, one dynamic buffer, one draw
    const stoneProg = link(
      `precision highp float;
       attribute vec2 a_pos;    // pixels
       attribute vec3 a_norm;   // view-space facet normal
       attribute vec3 a_tint;
       attribute vec3 a_props;  // clarity, glow, selected
       attribute vec3 a_bary;
       attribute vec3 a_mask;   // 1 on true polygon edges, large on fan seams
       uniform vec2 u_res;
       varying vec3 v_norm;
       varying vec3 v_tint;
       varying vec3 v_props;
       varying vec3 v_bary;
       varying vec3 v_mask;
       void main() {
         v_norm = a_norm; v_tint = a_tint; v_props = a_props;
         v_bary = a_bary; v_mask = a_mask;
         vec2 cl = vec2(a_pos.x / u_res.x * 2.0 - 1.0, 1.0 - a_pos.y / u_res.y * 2.0);
         gl_Position = vec4(cl, 0.0, 1.0);
       }`,
      `${derivs ? "#extension GL_OES_standard_derivatives : enable\n" : ""}precision highp float;
       varying vec3 v_norm;
       varying vec3 v_tint;
       varying vec3 v_props;
       varying vec3 v_bary;
       varying vec3 v_mask;
       uniform vec3  u_key;
       uniform vec3  u_rim;
       uniform vec3  u_half;
       uniform float u_dim;
       void main() {
         vec3 n = normalize(v_norm);
         float clarity = v_props.x;
         float glow = v_props.y;
         float sel = v_props.z;
         bool front = n.y < 0.0;

         float diff = max(0.0, dot(n, u_key));
         float rimlit = max(0.0, dot(n, u_rim));
         float hl = pow(max(0.0, dot(n, u_half)), 26.0);

         float body = front ? 0.20 + diff * 0.95 : 0.14 + diff * 0.34;
         float alpha = front ? (1.0 - clarity * 0.44) : clarity * 0.40;

         vec3 col = v_tint * body
                  + vec3(0.98, 0.93, 0.78) * (hl * 1.7 + glow * 0.5)
                  + vec3(0.42, 0.59, 0.82) * rimlit * rimlit * 0.5;

         // the edge of a facet is where the light actually lives. Only the
         // polygon's own edges count — the fan seams inside a facet carry a
         // mask of their own and are dropped, or every crystal would be
         // drawn with its triangulation showing.
         vec3 w3 = ${derivs ? "fwidth(v_bary) * 1.4" : "vec3(0.035)"} + 1e-5;
         vec3 e3 = vec3(1.0) - smoothstep(vec3(0.0), w3, v_bary);
         vec3 keep = vec3(1.0) - step(vec3(1.5), v_mask);
         e3 *= keep;
         float edge = max(max(e3.x, e3.y), e3.z);
         if (front) {
           col += vec3(0.98, 0.96, 0.89) * edge * (0.16 + hl * 0.8 + rimlit * 0.22 + glow * 0.4 + sel * 0.2);
           alpha = max(alpha, edge * 0.9);
         }

         gl_FragColor = vec4(clamp(col, 0.0, 1.0) * u_dim * alpha, alpha);
       }`,
    );
    if (!brineProg || !stoneProg) return;

    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const bU = {
      pos: gl.getAttribLocation(brineProg, "a_pos"),
      res: gl.getUniformLocation(brineProg, "u_res"),
      t: gl.getUniformLocation(brineProg, "u_t"),
      breath: gl.getUniformLocation(brineProg, "u_breath"),
      sat: gl.getUniformLocation(brineProg, "u_sat"),
      lean: gl.getUniformLocation(brineProg, "u_lean"),
      dim: gl.getUniformLocation(brineProg, "u_dim"),
      creep: gl.getUniformLocation(brineProg, "u_creep"),
      detail: gl.getUniformLocation(brineProg, "u_detail"),
      stones: gl.getUniformLocation(brineProg, "u_stones"),
      nStones: gl.getUniformLocation(brineProg, "u_nStones"),
    };
    /** x, y, radius per stone, in frame units — the tray's shadow list. */
    const shadowBuf = new Float32Array(14 * 3);

    // 17 floats a vertex: pos2 norm3 tint3 props3 bary3 mask3
    const STRIDE = 17;
    const MAX_VERTS = 24000;
    const verts = new Float32Array(MAX_VERTS * STRIDE);
    const stoneBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, stoneBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts.byteLength, gl.DYNAMIC_DRAW);

    const sU = {
      pos: gl.getAttribLocation(stoneProg, "a_pos"),
      norm: gl.getAttribLocation(stoneProg, "a_norm"),
      tint: gl.getAttribLocation(stoneProg, "a_tint"),
      props: gl.getAttribLocation(stoneProg, "a_props"),
      bary: gl.getAttribLocation(stoneProg, "a_bary"),
      mask: gl.getAttribLocation(stoneProg, "a_mask"),
      res: gl.getUniformLocation(stoneProg, "u_res"),
      key: gl.getUniformLocation(stoneProg, "u_key"),
      rim: gl.getUniformLocation(stoneProg, "u_rim"),
      half: gl.getUniformLocation(stoneProg, "u_half"),
      dim: gl.getUniformLocation(stoneProg, "u_dim"),
    };
    // vertex layout is fixed — bytes-per-vertex never changes frame to
    // frame, so the binder is one function, not a closure rebuilt per draw
    const STONE_VERT_BYTES = STRIDE * 4;
    const setStoneAttr = (loc: number, size: number, off: number) => {
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STONE_VERT_BYTES, off * 4);
    };

    let dpr = 1;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      dpr = resolveDpr(tier, { embedded, reducedMotion: reduced });
      width = Math.max(240, r.width);
      height = Math.max(320, r.height);
      rectLeft = r.left;
      rectTop = r.top;
      for (const cv of [canvas, overlay]) {
        cv.width = Math.round(width * dpr);
        cv.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toLocal = (cx: number, cy: number) => ({
      x: clamp(cx - rectLeft, 0, width),
      y: clamp(cy - rectTop, 0, height),
    });

    // ——— 7. the grammar ————————————————————————————————
    // Mounted on the OVERLAY, never the wrapper: the overlay is the topmost
    // surface, and the wrapper is position:fixed — its stacking context
    // swallows the quiet clear.
    let dragStone = -1;
    let dragMoved = 0;
    const detachGestures = attachGestures(
      overlay,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) return; // ScaleTravel's step back
          if (e.fingers === 3) {
            // tutti rides the strike: everything alive answers, as hard as asked
            tutti(0.4 + e.intensity * 0.5);
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          const i = stoneAt(x, y);
          // the rapid-tap ladder (1 / 3 / 5 / n), in the mineral register:
          // 1 rings the stone, 3 knocks it against whatever it lies on,
          // 5 raps it loose into a bright spin — or shakes a grain of salt
          // out of the brine — and n rolls the whole shelf, harder with
          // every extra tap while the brine climbs toward saturation
          const trainTier = tapTrainTier(e.count);
          if (trainTier === "n") {
            const crest = clamp01(0.4 + (e.count - 7) * 0.12 + e.intensity * 0.3);
            tutti(0.5 + crest * 0.5);
            saturationTarget = clamp01(saturationTarget + 0.05 + crest * 0.08);
            stirTurbulence(0.08 + crest * 0.12);
            return;
          }
          if (trainTier === 5 && e.count === 5) {
            if (i >= 0) {
              // rapped loose: the stone jumps into a spin and rings bright
              const s = stonesRef.current[i];
              s.spin += (s.seed % 2 ? 1 : -1) * (0.5 + e.intensity * 0.4);
              s.lit = Math.max(s.lit ?? 0, 0.8);
              ringStone(s, 0.9 + e.intensity * 0.1);
              try {
                haptics.detent();
              } catch {
                /* noop */
              }
              dirty = true;
            } else {
              // the patter shakes a grain of salt out of solution
              const j = plant(x, y, 0.02);
              const s = stonesRef.current[j];
              if (s) s.species = "halite";
              saturationTarget = clamp01(saturationTarget + 0.06);
              try {
                audio.playNote(31, 260);
                haptics.chop();
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (trainTier === 3 && e.count === 3) {
            if (i >= 0) {
              // knocked against its neighbour: both stones speak, the pair a
              // dyad of two lattices — or the stone alone, twice as lit
              const s = stonesRef.current[i];
              selected = i;
              ringStone(s, 0.6 + e.intensity * 0.4);
              const j = neighbourOf(i);
              if (j >= 0) {
                ringStone(stonesRef.current[j], 0.5 + e.intensity * 0.3);
                stonesRef.current[j].spin += 0.12 * (e.intensity + 0.4);
              }
              s.spin += (s.seed % 2 ? 1 : -1) * 0.15 * (e.intensity + 0.4);
              try {
                haptics.ripple(0.4 + e.intensity * 0.3);
              } catch {
                /* noop */
              }
              dirty = true;
            } else {
              // the brine shivers: a patter on the wet dark stirs the tray
              saturationTarget = clamp01(saturationTarget + 0.08 + 0.06 * e.intensity);
              stirTurbulence(0.1 + e.intensity * 0.08);
              try {
                audio.playNote(38, 220);
                haptics.ripple(0.35);
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (i >= 0) {
            selected = i;
            ringStone(stonesRef.current[i], 0.4 + e.intensity * 0.6);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          // the wet dark: a ripple through the brine, and a grain of salt
          saturationTarget = clamp01(saturationTarget + 0.04 * e.intensity);
          stirTurbulence(0.04);
          try {
            audio.playNote(34, 200);
            haptics.tap();
          } catch {
            /* noop */
          }
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // dilation is a continuous axis: the brine's clock keeps slowing
            // the longer the three fingers stay, toward a near-standstill —
            // never the same at 900ms as at 2400ms
            if (e.phase === "enter") {
              timeScaleTarget = 0.6;
              try {
                audio.playNote(26, 480);
                haptics.tap();
              } catch {
                /* noop */
              }
              return;
            }
            if (e.phase === "release") {
              timeScaleTarget = 1;
              return;
            }
            timeScaleTarget = clamp(1 - 1.4 * (e.elapsed / (e.elapsed + 1400)), 0.12, 0.6);
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          if (e.phase === "enter") {
            heldStone = stoneAt(x, y);
            holdFed = 0;
            if (heldStone >= 0) selected = heldStone;
            else if (e.tier >= 1) {
              heldStone = plant(x, y, 0.012);
              selected = heldStone;
              try {
                audio.spark();
                haptics.ripple(0.4);
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (e.phase === "release") {
            if (heldStone >= 0) {
              // a ceremony hold on the nodule is what opens the geode
              const s = stonesRef.current[heldStone];
              if (s && e.tier >= 3 && s.geode) cleave(heldStone, [1, 0.2], 0.9);
              else if (s && e.tier >= 3) ringStone(s, 1);
              if (e.tier >= 3) {
                try {
                  audio.bell();
                  haptics.bloom();
                } catch {
                  /* noop */
                }
              }
            }
            heldStone = -1;
            dirty = true;
            return;
          }
          // Duration is an axis: the longer the hold, the more of the tray
          // goes into this one stone — and the growth is audible while it
          // happens, the pitch climbing down as the crystal takes on size.
          if (heldStone >= 0) {
            const want = 0.00035 * (1 + e.elapsed / 1400) * (0.4 + e.intensity);
            feed(heldStone, want);
            holdFed += want;
            if (holdFed > 0.02) {
              holdFed = 0;
              const s = stonesRef.current[heldStone];
              if (s) {
                ringStone(s, 0.25);
                try {
                  haptics.tap();
                } catch {
                  /* noop */
                }
              }
            }
          }
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // the world-law: how much the brine is holding
            saturationTarget = clamp01(saturationTarget + e.dx * 0.0022);
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          if (e.phase === "start") {
            dragStone = stoneAt(x, y);
            dragMoved = 0;
            if (dragStone >= 0) {
              selected = dragStone;
              stonesRef.current[dragStone].spin = 0;
            }
            return;
          }
          if (e.phase === "end") {
            if (dragStone >= 0) {
              const s = stonesRef.current[dragStone];
              if (s) s.spin = clamp(e.vx * 0.0016, -0.9, 0.9);
              dirty = true;
            }
            dragStone = -1;
            return;
          }
          // dragging a stone THROUGH its neighbour is the hardness test:
          // whichever is softer takes the groove
          if (dragStone >= 0 && dragMoved > 12) {
            const j = neighbourOf(dragStone);
            const now = performance.now();
            if (j >= 0 && now - lastScratchAt > 220) {
              lastScratchAt = now;
              scratch(
                stonesRef.current[dragStone],
                stonesRef.current[j],
                clamp01(Math.hypot(e.vx, e.vy) / 2.4),
              );
            }
          }
          if (dragStone < 0) {
            // the brine itself: a slow current across the tray
            saturationTarget = clamp01(saturationTarget + Math.abs(e.dy) * 0.0004);
            return;
          }
          // one finger is the material: the stone turns in your fingers
          const s = stonesRef.current[dragStone];
          if (!s) return;
          if (!reduced) {
            s.yaw += (e.dx / Math.max(1, width)) * 5.2;
            s.pitch = clamp(s.pitch + (e.dy / Math.max(1, height)) * 3.4, -1.15, 1.15);
          }
          dragMoved += Math.hypot(e.dx, e.dy);
          const speed = Math.hypot(e.vx, e.vy);
          const now = performance.now();
          if (speed > 0.4 && now - lastTurnSoundAt > 130) {
            lastTurnSoundAt = now;
            // facets catching light, heard: the ring's own partials, faint
            const parts = partialsOf(s.species, sizeMetres(s), elongationOf(meshOf(s)), 4);
            const p = parts[Math.min(parts.length - 1, 1 + Math.floor(clamp01(speed / 3) * 2))];
            try {
              audio.playTone(p.hz, 0.12);
              haptics.tap();
            } catch {
              /* noop */
            }
            s.lit = Math.max(s.lit ?? 0, 0.35);
          }
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          const i = stoneAt(x, y);
          if (i < 0) return;
          // a sharp strike, not a slow turn: the stone parts on its plane
          const strength = clamp01(e.speed / 3.2);
          cleave(i, [Math.cos(e.angle), Math.sin(e.angle)], 0.35 + strength * 0.65);
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // three fingers turn the season: the brine runs hot, then cold.
            // Hot holds more and grows the slow minerals; cold gives it back.
            if (e.phase === "move") {
              season = clamp01(season + e.angle / 3.4);
              saturationTarget = clamp01(saturationTarget + e.angle / 9.0);
            } else if (e.phase === "end") {
              try {
                audio.playNote(29 + Math.round(season * 14), 340);
                haptics.detent();
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (e.phase === "move") lensTarget = clamp01(lensTarget + e.angle / 1.7);
          else if (e.phase === "end") setLens(lensTarget > 0.5 ? 1 : 0);
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          // stirring the brine drives the solvent off: it holds more
          saturationTarget = clamp01(saturationTarget + Math.abs(e.angularVelocity) * 0.02 + 0.05);
          stirTurbulence(0.08);
          try {
            audio.playNote(46, 220);
            haptics.ripple(0.3);
          } catch {
            /* noop */
          }
        },
        rhythm: (e) => {
          if (e.stability <= 0.65) return;
          entrainBpm = clamp(e.bpm, 40, 170);
          entrainUntil = performance.now() + 9000;
          entrainBeat = -1;
        },
      },
      { wheelZoom: false },
    );

    // ——— 8. the vessel ————————————————————————————————
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        leanTarget = reduced ? 0 : clamp(gamma / 40, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        // agitation drops the salt out of solution all at once
        const n = Math.max(1, Math.round(intensity * 3));
        for (let k = 0; k < n; k++) {
          const rng = mulberry32(hashSeed(k, Math.round(intensity * 997), stonesRef.current.length));
          const i = plant(width * (0.16 + rng() * 0.68), height * (0.5 + rng() * 0.36), 0.02);
          const s = stonesRef.current[i];
          if (s) s.species = "halite";
        }
        saturationTarget = clamp01(saturationTarget + 0.2 * intensity);
        stirTurbulence(0.2 + intensity * 0.3);
        try {
          audio.playNote(31, 320);
          haptics.chop();
        } catch {
          /* noop */
        }
        dirty = true;
      },
      knock: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        // a knock on the case is a knock on the tray: every stone answers
        for (const s of stonesRef.current) {
          s.spin += (s.seed % 2 ? 1 : -1) * 0.25 * intensity;
          s.lit = Math.max(s.lit ?? 0, 0.5);
        }
        const first = stonesRef.current[0];
        if (first) ringStone(first, intensity);
        try {
          audio.thud();
          haptics.detent();
        } catch {
          /* noop */
        }
      },
      flip: ({ faceDown }) => {
        nightTarget = faceDown ? 1 : 0;
      },
    });

    // ——— 9. keyboard ————————————————————————————————
    const onKeyDown = (ev: KeyboardEvent) => {
      const list = stonesRef.current;
      if (ev.key === "Escape") {
        if (lensSnapped === 1) setLens(0);
        selected = -1;
        kbCharge = 0;
        return;
      }
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (list.length) {
          selected = (selected + 1) % list.length;
          ringStone(list[selected], 0.4);
        }
        return;
      }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (list.length) {
          selected = (selected <= 0 ? list.length : selected) - 1;
          ringStone(list[selected], 0.4);
        }
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!ev.repeat) {
          if (selected < 0 && list.length) selected = 0;
          if (selected >= 0) ringStone(list[selected], 0.8);
          else plant(width * 0.5, height * 0.66, 0.02);
          kbCharge = 0.05;
          return;
        }
        // held Enter is the keyboard's hold: the stone keeps drinking
        kbCharge = clamp01(kbCharge + 0.03);
        if (selected >= 0) feed(selected, 0.0016);
        if (kbCharge >= 1) {
          kbCharge = 0;
          if (selected >= 0) cleave(selected, [1, 0.2], 0.8);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") kbCharge = 0;
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);

    // ——— 10. small linear algebra for the turn ————————————
    function rotation(s: Stone): number[] {
      const cy = Math.cos(s.yaw);
      const sy = Math.sin(s.yaw);
      const cp = Math.cos(s.pitch);
      const sp = Math.sin(s.pitch);
      // Rz(yaw) then Rx(pitch)
      return [cy, -sy, 0, cp * sy, cp * cy, -sp, sp * sy, sp * cy, cp];
    }
    function invRotation(s: Stone): number[] {
      const m = rotation(s);
      return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
    }
    function applyMat(m: number[], v: Vec3): Vec3 {
      return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
      ];
    }
    function norm(v: Vec3): Vec3 {
      const m = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / m, v[1] / m, v[2] / m];
    }

    // the camera: a slight look-down, so a stone shows its top facets
    const CAM_TILT = 0.42;
    const camC = Math.cos(CAM_TILT);
    const camS = Math.sin(CAM_TILT);

    // scratch buffers — no per-frame allocation in the hot path
    const px = new Float32Array(512);
    const py = new Float32Array(512);
    const pz = new Float32Array(512);
    const faceDepth = new Float32Array(96);
    const faceIdx: number[] = [];
    const drawOrder: number[] = [];
    const byDepth = (a: number, b: number) => faceDepth[b] - faceDepth[a];
    // the stone vertex buffer's write head, and its writer — defined once,
    // never a per-frame closure. `n` is reset to 0 at the top of pass 2.
    let n = 0;
    const push = (
      x: number,
      y: number,
      nx3: number,
      ny3: number,
      nz3: number,
      tr: number,
      tg: number,
      tb: number,
      clarity: number,
      glow: number,
      sel: number,
      b0: number,
      b1: number,
      b2: number,
      m0: number,
      m1: number,
      m2: number,
    ) => {
      if (n >= MAX_VERTS) return;
      const o = n * STRIDE;
      verts[o] = x;
      verts[o + 1] = y;
      verts[o + 2] = nx3;
      verts[o + 3] = ny3;
      verts[o + 4] = nz3;
      verts[o + 5] = tr;
      verts[o + 6] = tg;
      verts[o + 7] = tb;
      verts[o + 8] = clarity;
      verts[o + 9] = glow;
      verts[o + 10] = sel;
      verts[o + 11] = b0;
      verts[o + 12] = b1;
      verts[o + 13] = b2;
      verts[o + 14] = m0;
      verts[o + 15] = m1;
      verts[o + 16] = m2;
      n += 1;
    };

    // ——— 11. the loop ————————————————————————————————
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      tier = gov.beginFrame(now);
      const detail = detailForTier(tier);
      // asleep: the room keeps its clock but stops spending frames on it
      if (asleep) {
        last = now;
        return;
      }
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduced) localT += dt * timeScale;
      saturation += (saturationTarget - saturation) * Math.min(1, dt * 2.2);
      saturationTarget += (0.18 - saturationTarget) * Math.min(1, dt * 0.06);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      lean += (leanTarget - lean) * Math.min(1, dt * 3);
      night += (nightTarget - night) * Math.min(1, dt * 1.5);
      if (leaving > 0) leaving = Math.max(0, leaving - dt * 0.7);

      const list = stonesRef.current;
      const t = audio.getAudioTime() ?? now / 1000;
      // the shared breath — 7s, 0.14 Hz, the clock the whole album keeps
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // — growth and dissolution: mass moves, analytic, O(visible) —
      // Below the saturation the brine can hold, the stones go back into
      // solution — the room's delete path is its create path reversed.
      let solidTotal = 0;
      const under = saturation < 0.08;
      for (const s of list) {
        const k = 0.06 * SPECIES[s.species].growthRate * (0.15 + saturation) * (1 - night * 0.8);
        if (under) {
          const back = dissolveStep(
            { dissolved: s.dissolved, solid: s.solid },
            0.28 * (0.08 - saturation) * 12 * SPECIES[s.species].growthRate,
            dt * timeScale,
          );
          s.dissolved = back.dissolved;
          s.solid = back.solid;
          pool += s.dissolved * 0.5;
          s.dissolved *= 0.5;
        } else if (s.dissolved > 1e-6 && k > 0) {
          const p = growStep({ dissolved: s.dissolved, solid: s.solid }, k, dt * timeScale);
          s.dissolved = p.dissolved;
          s.solid = Math.min(0.6, p.solid);
        }
        // the tray itself keeps handing out what it holds, slowly
        if (!under && pool > 1e-4 && saturation > 0.05) {
          const give = Math.min(pool, 0.00022 * saturation * dt * 60 * timeScale);
          pool -= give;
          s.dissolved += give;
        }
        if (!reduced) {
          s.yaw += s.spin * dt;
          s.spin *= Math.exp(-dt * 1.4);
          // alive at rest: every facet turns slowly through the light,
          // and the turn itself breathes on the shared clock
          s.yaw += dt * 0.045 * timeScale * (s.seed % 2 ? 1 : -1) * (0.7 + breath * 0.6);
        }
        if (s.lit) s.lit = Math.max(0, s.lit - dt * 1.4);
        if (s.fresh) s.fresh = Math.max(0, s.fresh - dt * 0.5);
        solidTotal += s.solid;
      }

      // — Ostwald ripening: neighbours in one brine are not independent.
      //   The big stone quietly eats the small one it lies against, so a
      //   shelf left alone resolves toward a few large crystals. This is
      //   the room's ambient interaction, and it runs while nobody watches.
      if (!under && list.length > 1) {
        for (let i = 0; i < list.length; i++) {
          const j = neighbourOf(i);
          if (j < 0 || j < i) continue;
          const a = list[i];
          const b = list[j];
          const small = a.solid < b.solid ? a : b;
          const large = small === a ? b : a;
          const moved = ripen(small.solid, large.solid, 0.05 * (0.4 + saturation), dt * timeScale);
          small.solid = moved.small;
          large.solid = moved.large;
          if (small.solid < 0.0009) {
            // the last of it goes back to the tray, and the stone is gone
            pool += small.solid + small.dissolved;
            stonesRef.current = list.filter((s) => s !== small);
            try {
              audio.playNote(30, 260);
              haptics.tap();
            } catch {
              /* noop */
            }
            dirty = true;
            break;
          }
        }
      }
      // stones that have fully dissolved leave the shelf
      if (under) {
        const before = stonesRef.current.length;
        stonesRef.current = stonesRef.current.filter((s) => {
          if (s.solid > 0.0008) return true;
          pool += s.solid + s.dissolved;
          return false;
        });
        if (stonesRef.current.length !== before) {
          dirty = true;
          try {
            haptics.tap();
          } catch {
            /* noop */
          }
        }
      }

      // entrained ringing — the shelf keeps your tempo for a while
      if (now < entrainUntil && entrainBpm > 0 && list.length) {
        const beat = Math.floor(now / (60000 / entrainBpm));
        if (beat !== entrainBeat) {
          entrainBeat = beat;
          ringStone(list[Math.abs(beat) % list.length], 0.3);
        }
      }

      if (dirty && now - lastInteractionAt > 400) {
        dirty = false;
        writer.schedule();
      }

      const dim = 1 - night * 0.62;

      // ——— pass 1: the brine, in one fragment shader ———————————
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.useProgram(brineProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(bU.pos);
      gl.vertexAttribPointer(bU.pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(bU.res, canvas.width, canvas.height);
      gl.uniform1f(bU.t, localT);
      gl.uniform1f(bU.breath, breath);
      gl.uniform1f(bU.sat, saturation);
      gl.uniform1f(bU.lean, lean);
      gl.uniform1f(bU.dim, dim);
      gl.uniform1f(bU.creep, clamp01(solidTotal * 1.8 + saturation * 0.6));
      gl.uniform1f(bU.detail, detail.particles);
      let nSh = 0;
      for (let i = 0; i < list.length && nSh < 14; i++) {
        const s = list[i];
        const r = stoneRadiusPx(s);
        if (r < 0.4) continue;
        shadowBuf[nSh * 3] = (s.nx * width + lean * 5) / Math.max(1, width);
        // the shader's y runs up from the floor; the room's runs down
        shadowBuf[nSh * 3 + 1] = 1 - (s.ny * height) / Math.max(1, height);
        shadowBuf[nSh * 3 + 2] = (r * 0.95) / Math.max(1, height);
        nSh += 1;
      }
      gl.uniform3fv(bU.stones, shadowBuf);
      gl.uniform1i(bU.nStones, nSh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // ——— pass 2: the stones, back to front, one dynamic buffer ————
      drawOrder.length = 0;
      for (let i = 0; i < list.length; i++) drawOrder.push(i);
      drawOrder.sort((a, b) => list[a].ny - list[b].ny);
      const unit = unitPx();
      // View space: X right, Y into the screen, Z up. One warm key from the
      // upper left and one cool rim from behind the right — the light the
      // whole site keeps.
      const key = norm([-0.46 + lean * 0.3, -0.62, 0.64]);
      const rimL = norm([0.66, 0.42, -0.28]);
      const halfV = norm([key[0], key[1] - 1, key[2]]);

      n = 0; // vertices written this frame
      const SEAM = 99; // a fan seam is never an edge of the real facet

      for (const idx of drawOrder) {
        const s = list[idx];
        const mesh = meshOf(s);
        const k = scaleForMass(mesh, s.solid) * unit * (1 - leaving * 0.9);
        if (k < 0.4) continue;
        const R = rotation(s);
        const cx = s.nx * width + lean * 5;
        const cy = s.ny * height;
        const nv = mesh.verts.length / 3;
        if (nv > px.length) continue;

        let lowest = -Infinity;
        for (let i = 0; i < nv; i++) {
          const vx = mesh.verts[i * 3];
          const vy = mesh.verts[i * 3 + 1];
          const vz = mesh.verts[i * 3 + 2];
          const rx = R[0] * vx + R[1] * vy + R[2] * vz;
          const ry = R[3] * vx + R[4] * vy + R[5] * vz;
          const rz = R[6] * vx + R[7] * vy + R[8] * vz;
          const depth = ry * camC - rz * camS;
          const up = ry * camS + rz * camC;
          px[i] = cx + rx * k;
          py[i] = cy - up * k;
          pz[i] = depth;
          if (py[i] > lowest) lowest = py[i];
        }
        // the stone stands ON the tray rather than floating over it
        const drop = cy - lowest;
        for (let i = 0; i < nv; i++) py[i] += drop;

        const nf = Math.min(mesh.faces.length, faceDepth.length);
        faceIdx.length = 0;
        for (let f = 0; f < nf; f++) {
          const face = mesh.faces[f];
          let d = 0;
          for (const vi of face) d += pz[vi];
          faceDepth[f] = d / face.length;
          faceIdx.push(f);
        }
        faceIdx.sort(byDepth);

        const spec = SPECIES[s.species];
        // a grooved stone has lost its polish: it scatters instead of
        // transmitting, so a scratch is visible as well as audible
        const clarity = spec.clarity * (1 - leaving) * (1 - (s.scratched ?? 0) * 0.7);
        const glow = (s.lit ?? 0) + (s.fresh ?? 0) * 0.5;
        const sel = idx === selected ? 1 : 0;
        const tr = spec.tint[0] / 255;
        const tg = spec.tint[1] / 255;
        const tb = spec.tint[2] / 255;

        for (const f of faceIdx) {
          const face = mesh.faces[f];
          const fn = faceNormal(mesh, face);
          const rnx = R[0] * fn[0] + R[1] * fn[1] + R[2] * fn[2];
          const rny = R[3] * fn[0] + R[4] * fn[1] + R[5] * fn[2];
          const rnz = R[6] * fn[0] + R[7] * fn[1] + R[8] * fn[2];
          const nX = rnx;
          const nY = rny * camC - rnz * camS;
          const nZ = rny * camS + rnz * camC;
          const front = nY < 0;
          if (!front && clarity < 0.35) continue;
          const isFresh = f === nf - 1 && (s.fresh ?? 0) > 0.01;
          const faceGlow = glow + (isFresh ? (s.fresh ?? 0) * 0.8 : 0);
          // fan-triangulate the facet; only real polygon edges get the light
          for (let i = 1; i + 1 < face.length; i++) {
            const a = face[0];
            const b = face[i];
            const c = face[i + 1];
            const mA = 1; // edge (b,c) is always a polygon edge
            const mB = i + 1 === face.length - 1 ? 1 : SEAM; // edge (c,a)
            const mC = i === 1 ? 1 : SEAM; // edge (a,b)
            push(px[a], py[a], nX, nY, nZ, tr, tg, tb, clarity, faceGlow, sel, 1, 0, 0, mA, mB, mC);
            push(px[b], py[b], nX, nY, nZ, tr, tg, tb, clarity, faceGlow, sel, 0, 1, 0, mA, mB, mC);
            push(px[c], py[c], nX, nY, nZ, tr, tg, tb, clarity, faceGlow, sel, 0, 0, 1, mA, mB, mC);
          }
        }

        // the druse: what was inside the nodule, now facing out — little
        // pyramids on the opened face, twinkling on the shared breath
        if (s.lined && nf > 0) {
          const face = mesh.faces[nf - 1];
          let fx = 0;
          let fy = 0;
          for (const vi of face) {
            fx += px[vi];
            fy += py[vi];
          }
          fx /= face.length;
          fy /= face.length;
          const rng = mulberry32(s.seed ^ 0x0dd);
          const many = Math.round(22 * detail.particles);
          for (let i = 0; i < many; i++) {
            const a = rng() * Math.PI * 2;
            const rr = Math.sqrt(rng()) * k * 0.62;
            const gx = fx + Math.cos(a) * rr;
            const gy = fy + Math.sin(a) * rr * 0.7;
            const gs = k * (0.05 + rng() * 0.08);
            const tw = reduced ? 0.6 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(localT * 1.3 + i * 2.1 + breath));
            const g = tw * 0.9;
            push(gx, gy - gs, 0, -1, 0.4, 0.84, 0.9, 0.96, 0.1, g, 0, 1, 0, 0, 1, 1, 1);
            push(gx + gs * 0.5, gy, 0, -1, 0.4, 0.84, 0.9, 0.96, 0.1, g, 0, 0, 1, 0, 1, 1, 1);
            push(gx, gy + gs, 0, -1, 0.4, 0.84, 0.9, 0.96, 0.1, g, 0, 0, 0, 1, 1, 1, 1);
          }
        }
      }

      if (n > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(stoneProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, stoneBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts.subarray(0, n * STRIDE));
        setStoneAttr(sU.pos, 2, 0);
        setStoneAttr(sU.norm, 3, 2);
        setStoneAttr(sU.tint, 3, 5);
        setStoneAttr(sU.props, 3, 8);
        setStoneAttr(sU.bary, 3, 11);
        setStoneAttr(sU.mask, 3, 14);
        // a_pos is in CSS pixels — the stone program must be told the CSS
        // frame, not the backing store, or every stone lands at 1/dpr
        gl.uniform2f(sU.res, width, height);
        gl.uniform3f(sU.key, key[0], key[1], key[2]);
        gl.uniform3f(sU.rim, rimL[0], rimL[1], rimL[2]);
        gl.uniform3f(sU.half, halfV[0], halfV[1], halfV[2]);
        gl.uniform1f(sU.dim, dim);
        gl.drawArrays(gl.TRIANGLES, 0, n);
      }

      // ——— pass 3: the lens's notation, and nothing else ——————————
      // The only 2D in the room: glyphs the shader has no business drawing.
      ctx.clearRect(0, 0, width, height);
      if (lens > 0.01) {
        const la = lens;
        const s = list[selected] ?? list[0];
        ctx.save();
        ctx.globalAlpha = la;
        ctx.fillStyle = "rgba(4, 6, 9, 0.62)";
        ctx.fillRect(0, 0, width, height);
        if (s) {
          const spec = SPECIES[s.species];
          const ratios = ringRatios(spec.lattice, 8);
          const named = speciesFromRing(ratios);
          const baseY = height - 92;
          // the ring, drawn: every line a reflection the lattice allows
          const x0 = 22;
          const x1 = width - 22;
          ctx.strokeStyle = "rgba(243, 215, 122, 0.5)";
          ctx.lineWidth = 1;
          for (let i = 0; i < ratios.length; i++) {
            const u = (ratios[i] - 1) / (ratios[ratios.length - 1] - 1 || 1);
            const x = x0 + u * (x1 - x0);
            const h = 12 + 22 / ratios[i];
            ctx.globalAlpha = la * (0.3 + 0.7 / ratios[i]);
            ctx.beginPath();
            ctx.moveTo(x, baseY);
            ctx.lineTo(x, baseY - h);
            ctx.stroke();
          }
          ctx.globalAlpha = la;
          ctx.font = "300 11px ui-monospace, 'SF Mono', Menlo, monospace";
          ctx.textAlign = "left";
          ctx.fillStyle = "rgba(226, 232, 244, 0.72)";
          const lat = spec.lattice;
          ctx.fillText(
            `${lat.system} ${lat.centering} · a:c ${lat.ca.toFixed(3)} · mohs ${MOHS[s.species]}`,
            x0,
            height - 54,
          );
          ctx.fillText(`${ratios.map((r) => r.toFixed(2)).join("  ")}`, x0, height - 38);
          ctx.fillStyle = "rgba(243, 215, 122, 0.78)";
          ctx.fillText(`the ring reads ${named ?? "no lattice"}`, x0, height - 22);

          // the cleavage traces, on the stone itself
          const mesh = meshOf(s);
          const k = scaleForMass(mesh, s.solid) * unit;
          const R = rotation(s);
          const cx = s.nx * width + lean * 5;
          const cy = s.ny * height;
          ctx.strokeStyle = "rgba(150, 196, 238, 0.5)";
          for (const hkl of cleavagePlanes(s.species)) {
            const pn = planeNormal(spec.lattice, hkl);
            const rnx = R[0] * pn[0] + R[1] * pn[1] + R[2] * pn[2];
            const rny = R[3] * pn[0] + R[4] * pn[1] + R[5] * pn[2];
            const rnz = R[6] * pn[0] + R[7] * pn[1] + R[8] * pn[2];
            const vnz = rny * camS + rnz * camC;
            // the trace of the plane on the screen is across its normal
            const tx = -vnz;
            const ty = rnx;
            const m = Math.hypot(tx, ty) || 1;
            ctx.globalAlpha = la * 0.55;
            ctx.beginPath();
            ctx.moveTo(cx - (tx / m) * k * 1.5, cy - (ty / m) * k * 1.5);
            ctx.lineTo(cx + (tx / m) * k * 1.5, cy + (ty / m) * k * 1.5);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // — the glimmer: after ~20s of quiet, one facet catches the light —
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 7000 && !reduced && list.length) {
        glimmerAt = now;
        glimmerStone = Math.floor(mulberry32(hashSeed(Math.round(now / 7000)))() * list.length);
        const s = list[glimmerStone];
        if (s) s.lit = Math.max(s.lit ?? 0, 0.45);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      detachGestures();
      detachVessel();
      unvis();
      ungal();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      mq.removeEventListener?.("change", onMq);
      cancelAnimationFrame(raf);
      writer.flush();
      save();
    };
  }, []);

  // ——— the quiet clear: the stones go back into solution ————
  const letGo = () => {
    const step = () => {
      const list = stonesRef.current;
      if (list.length === 0) return;
      for (const s of list) s.solid *= 0.72;
      stonesRef.current = list.filter((s) => s.solid > 0.0008);
      window.setTimeout(step, 90);
    };
    window.setTimeout(step, 40);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ stones: [], pool: 1.6, cleared: true }));
    } catch {
      /* noop */
    }
    setHasKept(false);
    try {
      getFieldAudio().thud();
      haptics.roll();
    } catch {
      /* noop */
    }
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="a shelf of stones growing out of brine"
      style={{
        position: "fixed",
        inset: 0,
        background: "#05070a",
        outline: "none",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <canvas
        ref={overlayRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
        }}
      />
      <LetGo label="let the stones go" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
