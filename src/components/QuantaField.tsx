"use client";

/**
 * /quanta — the field floor at 10⁻²²…10⁻¹⁹ m, below the quarks: the new
 * floor of the whole axis. There are no things down here, only fields, and
 * every particle in the room is a ripple some field was made to carry.
 *
 * The room runs on ONE GREAT LAW: lifetime and reach are inverse to mass
 * (src/lib/quanta.ts). Photons are massless and cross the field forever —
 * they wrap at the walls and keep going, each one sounding its own pitch,
 * literally E = hf carried down into the audible register (a flick can't
 * change a photon's speed, only its direction — so it Doppler-bends the
 * note instead). Electrons are the lightest charged things there are, so
 * they stay. Muons live a while and die into electrons and neutrinos;
 * taus die sooner, into muons; the W, Z, and Higgs are so heavy they die
 * within a fingertip's breadth of where they were born, each decay a
 * deterministic, conservation-exact chain. Neutrinos are the ghosts:
 * barely visible, streaming through everything, deaf to wind and gravity,
 * answering a tap almost never. The gluon is the exception that proves
 * confinement: massless yet leashed, it never travels far — a scrub
 * shakes one out and it dresses itself in cycling color until the vacuum
 * takes it back.
 *
 * Hold duration IS deposited energy, so the hold axis climbs the mass
 * ladder: a short hold excites a photon; the dwell tier affords an
 * electron pair, then muons, then taus (pairs born flying apart — charge
 * always conserved, the vacuum owes nothing); the ceremony at full charge
 * births a Higgs, which dies in a breath into a τ⁺τ⁻ pair and onward down
 * the whole ladder. A W pair costs MORE than a Higgs, so the hand alone
 * can never make one — only the three-finger collision wind reaches that
 * rung, which is why the real ones needed a collider. Three fingers held
 * dilate time (the heavy bosons visibly live longer — the collider's own
 * trick); three fingers tapped ask everything alive to state itself. A
 * twist raises the bare-field lens — the Feynman view, world lines and
 * coils and wavy lines, the one lettered surface (γ, ν, μ, W±, Z, H).
 * Cosmic muons rain in on their own seeded schedule and die mid-flight.
 *
 * The stable residue persists in `objetdart:quanta:v1`. Pinch is
 * deliberately unbound — ScaleTravel owns it (quarks above; below is the
 * floor of the axis, and the integrator holds it).
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import LetGo from "@/components/LetGo";
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";
import {
  C_PX_S,
  CONFINEMENT_REACH_PX,
  LADDER,
  MAX_EXCITATIONS,
  PARTICLES,
  PHOTON_E_MIN,
  QUANTA_TINTS,
  betaFor,
  birthFor,
  decayProducts,
  dopplerHz,
  hashSeed,
  holdEnergy,
  lifetimeMs,
  mulberry32,
  photonPitchHz,
  reachPx,
  rungFor,
  settlePopulation,
  starterKinds,
  symbolOf,
  tintFamily,
  windEnergy,
  type Excitation,
  type ParticleId,
} from "@/lib/quanta";

const STORE_KEY = "objetdart:quanta:v1";
const RETIRE_MS = 1400;
const MOTE_COUNT = 64;
/** Seeded cosmic-muon schedule period, s of local time. */
const COSMIC_PERIOD_S = 24;

type Exc = {
  uid: number;
  id: ParticleId;
  anti: boolean;
  x: number;
  y: number;
  /** px/s. */
  vx: number;
  vy: number;
  /** Total energy carried, MeV. */
  energy: number;
  seed: number;
  /** Local-clock age, s — decays ride the dilatable clock. */
  age: number;
  /** Distance walked since birth, px — the reach law's odometer. */
  walked: number;
  /** Photons: the note it sounds, Hz. */
  pitch: number;
  ring: number;
  charge01: number;
  held: boolean;
  retiringAt: number;
  trail: number[];
  phase: number;
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
};

type Stored = {
  residue: Array<{ id: string; anti: boolean; nx: number; ny: number; energy: number; seed: number; pitch: number }>;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

function colorAlpha(hex: string, alpha: number) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

const isNeutrino = (id: ParticleId) => id === "nu-e" || id === "nu-mu" || id === "nu-tau";
const isMassive = (id: ParticleId) => PARTICLES[id].massMeV > 1e-3;

/** The voice of a massive excitation: the heavier the field, the lower it hums. */
function midiOf(id: ParticleId): number {
  const m = Math.max(0.5, PARTICLES[id].massMeV);
  return Math.round(88 - 5.2 * Math.log10(m * 2000));
}

export default function QuantaField() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasResidue, setHasResidue] = useState(false);
  const stillRef = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state —————
    let excs: Exc[] = [];
    const specks: Speck[] = [];
    const motes: Array<{ x: number; y: number; p: number }> = [];
    let uid = 1;
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let last = performance.now();
    let localT = 0;
    let reduce = false;
    let windX = 0;
    let windY = 0;
    let windTargetX = 0;
    let windTargetY = 0;
    /** Accumulated collision work — the beam the hand is winding up. */
    let beamWork = 0;
    let beamRung = -1;
    let lastBeamX = 0.5;
    let lastBeamY = 0.4;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let tiltLeanX = 0;
    let tiltLeanY = 0;
    let tuttiPulse = 0;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let lastSaveAt = 0;
    let lastWindSoundAt = 0;
    let lastChargeRung = -1;
    let lastTuttiAt = 0;
    let lastCosmicSlot = -1;
    let scrubWinding = 0;
    let cursorNx = 0.5;
    let cursorNy = 0.5;
    let cursorVisible = false;
    let kbHoldStart = 0;
    const hold: {
      active: boolean;
      x: number;
      y: number;
      energy: number;
      onUid: number | null;
      seed: number;
    } = { active: false, x: 0, y: 0, energy: 0, onUid: null, seed: 1 };

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => {
      reduce = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    // ————— performance contract —————
    const gov = createFrameGovernor();
    let sleeping = false;
    const offVis = onVisibility((hidden) => { sleeping = hidden; });

    // three-finger twist = season: the field's own slow cycle
    let season = 0;
    let lastSeasonSoundAt = 0;

    // vessel flip: face-down is night
    let night = 0;
    let nightTarget = 0;

    // two-finger pan: the frame peeks, then eases home
    let panX = 0;
    let panY = 0;
    let panTargetX = 0;
    let panTargetY = 0;

    // cached radial-gradient sprites — baked once per palette key, stamped
    // with drawImage every frame; never a per-excitation gradient
    const spriteCache = new Map<string, HTMLCanvasElement>();
    const SPRITE_REF = 128;
    const radialSprite = (key: string, stops: Array<[number, string]>): HTMLCanvasElement | null => {
      let c = spriteCache.get(key);
      if (c) return c;
      c = document.createElement("canvas");
      c.width = SPRITE_REF;
      c.height = SPRITE_REF;
      const sctx = c.getContext("2d");
      if (!sctx) return null;
      const rad = SPRITE_REF / 2;
      const g = sctx.createRadialGradient(rad, rad, 0, rad, rad, rad);
      for (const [o, color] of stops) g.addColorStop(o, color);
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, SPRITE_REF, SPRITE_REF);
      spriteCache.set(key, c);
      return c;
    };
    const stampSprite = (key: string, stops: Array<[number, string]>, cx: number, cy: number, r: number, alpha: number) => {
      if (r <= 0 || alpha <= 0.002) return;
      const sprite = radialSprite(key, stops);
      if (!sprite) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, cx - r, cy - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    };

    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => {
      try {
        audio().playNote(midi, ms);
      } catch {
        /* noop */
      }
    };
    const tone = (hz: number, sec = 0.5) => {
      try {
        audio().playTone(hz, sec);
      } catch {
        /* noop */
      }
    };
    const softly = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* noop */
      }
    };

    // ————— persistence: the stable residue —————
    const save = (force = false) => {
      const now = performance.now();
      setHasResidue(excs.some((e) => !e.retiringAt));
      if (!force && now - lastSaveAt < 900) return;
      lastSaveAt = now;
      try {
        const stored: Stored = {
          residue: excs
            .filter((e) => !e.retiringAt && PARTICLES[e.id].stable)
            .slice(-MAX_EXCITATIONS)
            .map((e) => ({
              id: e.id,
              anti: e.anti,
              nx: e.x / Math.max(1, width),
              ny: e.y / Math.max(1, height),
              energy: e.energy,
              seed: e.seed,
              pitch: e.pitch,
            })),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      } catch {
        /* quota; the field keeps its own counsel */
      }
    };

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
      if (motes.length === 0) {
        for (let i = 0; i < MOTE_COUNT; i++) {
          motes.push({ x: hash01(i + 31) * width, y: hash01(i + 977) * height, p: hash01(i * 5 + 3) * 7 });
        }
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toLocal = (clientX: number, clientY: number) => ({
      x: clamp(clientX - rectLeft, 0, width),
      y: clamp(clientY - rectTop, 0, height),
    });

    const burst = (x: number, y: number, colors: readonly string[], n: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + hash01(i + n) * 0.9;
        const s = speed * (0.4 + hash01(i * 3 + 1) * 0.9);
        specks.push({
          x,
          y,
          vx: Math.cos(ang) * s,
          vy: Math.sin(ang) * s,
          born: performance.now(),
          life: 600 + hash01(i * 7 + 2) * 900,
          r: 0.7 + hash01(i * 11 + 3) * 1.4,
          color: colors[i % colors.length],
        });
      }
      if (specks.length > 200) specks.splice(0, specks.length - 200);
    };

    const retireOldestResidue = () => {
      const alive = excs.filter((e) => !e.retiringAt);
      const { retired } = settlePopulation(alive, MAX_EXCITATIONS);
      for (const r of retired) {
        // never retire the unstable mid-story; they leave on their own
        if (!PARTICLES[r.id].stable) continue;
        r.retiringAt = performance.now();
      }
    };

    const spawn = (
      kind: Excitation,
      x: number,
      y: number,
      energy: number,
      ang: number,
      seed: number,
    ): Exc => {
      const spec = PARTICLES[kind.id];
      const beta = betaFor(spec.massMeV, Math.max(energy, spec.massMeV * 1.0001));
      const speed = kind.id === "gluon" ? C_PX_S * 0.5 : beta * C_PX_S;
      const e: Exc = {
        uid: uid++,
        id: kind.id,
        anti: kind.anti,
        x,
        y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        energy: Math.max(energy, spec.massMeV),
        seed,
        age: 0,
        walked: 0,
        pitch: kind.id === "photon" ? photonPitchHz(Math.max(PHOTON_E_MIN, energy)) : 0,
        ring: 0.7,
        charge01: 0,
        held: false,
        retiringAt: 0,
        trail: [],
        phase: hash01(seed) * Math.PI * 2,
      };
      excs.push(e);
      retireOldestResidue();
      return e;
    };

    /** An excitation's moment is up: it becomes what the ladder says. */
    const decay = (e: Exc) => {
      const products = decayProducts({ id: e.id, anti: e.anti }, e.seed);
      excs = excs.filter((q) => q !== e);
      if (products.length === 0) {
        // the gluon: reabsorbed, dressing the vacuum on its way out
        burst(e.x, e.y, QUANTA_TINTS.gluon, 7, 40);
        softly(() => audio().buzz());
        return;
      }
      const heavy = PARTICLES[e.id].massMeV > 10000;
      const share = Math.max(e.energy / products.length, 1);
      const baseAng = Math.atan2(e.vy, e.vx) || hash01(e.seed) * Math.PI * 2;
      products.forEach((p, i) => {
        const ang = baseAng + (i - (products.length - 1) / 2) * 1.9 + hash01(e.seed + i) * 0.5;
        spawn(p, e.x, e.y, Math.max(share, PARTICLES[p.id].massMeV * 1.4), ang, hashSeed(e.seed, i, 7));
      });
      const fam = tintFamily(e.id);
      burst(e.x, e.y, QUANTA_TINTS[fam], heavy ? 16 : 8, heavy ? 120 : 60);
      if (heavy) {
        softly(() => audio().bell());
        softly(() => audio().thud());
        note(midiOf(e.id), 420);
        softly(() => haptics.bloom());
      } else {
        softly(() => audio().spark());
        note(midiOf(e.id) + 5, 180);
        softly(() => haptics.tap());
      }
      useField.getState().recordTape("ripple", heavy ? 0.7 : 0.4, `quanta/decay-${e.id}`);
      save();
    };

    /** Deposit a birth into the field: what the energy affords, conserved. */
    const birth = (energyMeV: number, x: number, y: number, seed: number, quiet = false) => {
      const born = birthFor(energyMeV, seed);
      if (born.length === 0) {
        // below the first rung the vacuum only shivers
        burst(x, y, QUANTA_TINTS.neutrino, 3, 16);
        softly(() => audio().refuse());
        return;
      }
      const rung = rungFor(energyMeV);
      const ang0 = hash01(seed * 3 + 1) * Math.PI * 2;
      born.forEach((p, i) => {
        const ang = born.length === 1 ? ang0 : ang0 + i * Math.PI; // pairs part ways
        const each = Math.max(energyMeV / born.length, PARTICLES[p.id].massMeV);
        const e = spawn(p, x, y, each, ang, hashSeed(seed, i));
        if (p.id === "photon" && !quiet) tone(e.pitch, 0.9);
      });
      const heavy = LADDER[rung].thresholdMeV > 10000;
      if (born[0].id !== "photon") {
        burst(x, y, QUANTA_TINTS[tintFamily(born[0].id)], heavy ? 18 : 10, heavy ? 130 : 70);
        if (heavy) {
          softly(() => audio().bell());
          note(midiOf(born[0].id), 480);
          softly(() => haptics.storm());
        } else {
          softly(() => audio().chime());
          note(midiOf(born[0].id) + 3, 240);
          softly(() => haptics.bloom());
        }
      } else {
        burst(x, y, QUANTA_TINTS.photon, 5, 26);
        softly(() => haptics.ripple(0.35));
      }
      useField.getState().recordTape("object", clamp01(0.3 + rung * 0.1), `quanta/birth-${LADDER[rung].name}`);
      save();
    };

    // ————— load, or open with the starters —————
    let seededStart = false;
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Stored;
        if (parsed && Array.isArray(parsed.residue) && parsed.residue.length > 0) {
          for (const r of parsed.residue.slice(-MAX_EXCITATIONS)) {
            if (!(r.id in PARTICLES) || !PARTICLES[r.id as ParticleId].stable) continue;
            const e = spawn(
              { id: r.id as ParticleId, anti: !!r.anti },
              clamp01(r.nx) * Math.max(1, width),
              clamp01(r.ny) * Math.max(1, height),
              Math.max(0.05, r.energy),
              hash01(r.seed) * Math.PI * 2,
              r.seed >>> 0,
            );
            e.pitch = r.pitch || e.pitch;
            e.ring = 0;
          }
          seededStart = true;
        }
      }
    } catch {
      /* a fresh field */
    }
    if (!seededStart) {
      const kinds = starterKinds(0x51ab7);
      const spots: Array<[number, number, number]> = [
        [0.18, 0.3, 0.35], // photon, already crossing
        [0.62, 0.58, 0], // electron, at rest-ish
        [0.1, 0.75, -0.2], // neutrino, streaming
      ];
      kinds.forEach((k, i) => {
        const [nx, ny, ang] = spots[i];
        const en = k.id === "photon" ? 0.6 : PARTICLES[k.id].massMeV * (k.id === "electron" ? 1.1 : 400);
        spawn(k, nx * width, ny * height, en, ang, hashSeed(0x51ab7, i));
      });
      save(true);
    }
    setHasResidue(excs.length > 0);

    // ————— the quiet clear —————
    stillRef.current = () => {
      const now = performance.now();
      for (const e of excs) {
        if (e.retiringAt) continue;
        e.retiringAt = now;
      }
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ residue: [] }));
      } catch {
        /* noop */
      }
      setHasResidue(false);
      softly(() => audio().thud());
      softly(() => haptics.roll());
    };

    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    const excAt = (x: number, y: number, r = 42): Exc | null => {
      let best: Exc | null = null;
      let bestD = Infinity;
      for (const e of excs) {
        if (e.retiringAt) continue;
        const d = Math.hypot(x - e.x, y - e.y);
        if (d < r && d < bestD) {
          bestD = d;
          best = e;
        }
      }
      return best;
    };

    const tutti = () => {
      const now = performance.now();
      if (now - lastTuttiAt < 1400) return;
      lastTuttiAt = now;
      tuttiPulse = 1;
      const alive = excs.filter((e) => !e.retiringAt).slice(0, 9);
      alive.forEach((e, i) => {
        window.setTimeout(() => {
          if (e.id === "photon") tone(e.pitch, 0.35);
          else if (!isNeutrino(e.id)) note(midiOf(e.id), 120);
          e.ring = Math.min(1, e.ring + 0.5);
        }, i * 60);
      });
      softly(() => haptics.tap());
    };

    // ————— gestures —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 2) {
          if (lensSnapped === 1) {
            lensSnapped = 0;
            lensTarget = 0;
            window.setTimeout(() => markLens(false), 0);
            softly(() => haptics.lens());
            note(44, 160);
          }
          return;
        }
        if (e.fingers === 3) {
          tutti();
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        const target = excAt(x, y);
        if (target && isNeutrino(target.id)) {
          // the ghost: it almost never answers — one knock in eight lands
          if (hash01(target.seed + Math.round(localT * 10)) < 0.125) {
            target.ring = Math.min(1, target.ring + 0.5);
            note(96, 80);
            softly(() => haptics.tap());
          } else {
            burst(x, y, QUANTA_TINTS.neutrino, 2, 10);
          }
          return;
        }
        if (target) {
          target.ring = Math.min(1, target.ring + 0.4 + e.intensity * 0.5);
          if (target.id === "photon") tone(target.pitch, 0.4 + e.intensity * 0.4);
          else note(midiOf(target.id) + Math.round(e.intensity * 6), 160);
          softly(() => haptics.tap());
          useField.getState().recordTape("ripple", 0.3 + e.intensity * 0.4, "quanta/ping");
          return;
        }
        // open vacuum: a shiver of virtual light, scaled by how hard it landed
        burst(x, y, QUANTA_TINTS.photon, 3 + Math.round(e.intensity * 5), 22 + e.intensity * 30);
        note(70 + Math.round(e.intensity * 10), 90);
        softly(() => haptics.ripple(0.2 + e.intensity * 0.3));
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "enter") {
            timeScaleTarget = 0.25;
            softly(() => haptics.tap());
            note(30, 320);
          }
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          const target = excAt(x, y);
          hold.active = true;
          hold.x = x;
          hold.y = y;
          hold.energy = 0;
          hold.onUid = target && !isNeutrino(target.id) ? target.uid : null;
          hold.seed = hashSeed(Math.round(x * 7), Math.round(y * 13), Math.round(performance.now()));
          lastChargeRung = -1;
          return;
        }
        if (e.phase === "tick") {
          hold.x = x;
          hold.y = y;
          if (hold.onUid != null) {
            // asking an excitation: charging hastens what it already wants
            const target = excs.find((q) => q.uid === hold.onUid);
            if (!target || target.retiringAt) return;
            target.charge01 = clamp01((e.elapsed - 500) / 2000);
            if (e.tier >= 3 && !PARTICLES[target.id].stable) {
              target.charge01 = 0;
              hold.onUid = null;
              hold.active = false;
              decay(target);
              return;
            }
            if (e.tier >= 3 && PARTICLES[target.id].stable) {
              // a stable thing asked to its limit simply sings its self
              target.ring = Math.min(1, target.ring + 0.4);
              if (target.id === "photon") tone(target.pitch, 0.8);
              else note(midiOf(target.id), 420);
              hold.onUid = null;
              hold.active = false;
              softly(() => haptics.ripple(0.4));
              return;
            }
            return;
          }
          // charging the bare field: the hold axis climbs the mass ladder
          hold.energy = holdEnergy(e.elapsed);
          const rung = rungFor(hold.energy);
          if (rung !== lastChargeRung) {
            lastChargeRung = rung;
            if (rung >= 0) {
              note(46 + rung * 7, 140);
              softly(() => haptics.detent());
            }
          }
          return;
        }
        if (e.phase === "release") {
          const target = hold.onUid != null ? excs.find((q) => q.uid === hold.onUid) : null;
          if (target) target.charge01 = 0;
          if (hold.active && hold.onUid == null && e.elapsed >= 250) {
            birth(holdEnergy(e.elapsed), hold.x, hold.y, hold.seed);
          }
          hold.active = false;
          hold.onUid = null;
          hold.energy = 0;
          save();
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        if (e.fingers === 3) {
          // the collision wind: only the beam road reaches the W pair
          windTargetX = clamp(e.vx * 1.5, -1, 1);
          windTargetY = clamp(e.vy * 1.5, -1, 1);
          lastBeamX = x / Math.max(1, width);
          lastBeamY = y / Math.max(1, height);
          const mag = Math.hypot(windTargetX, windTargetY);
          const now = performance.now();
          if (mag > 0.45 && now - lastWindSoundAt > 480) {
            lastWindSoundAt = now;
            note(34 + Math.round(mag * 8), 260);
            softly(() => haptics.chop());
          }
          return;
        }
        if (e.fingers !== 1 || e.phase === "end") return;
        // a finger carries what it can: only slow massive things. Photons
        // and neutrinos pass under it — you cannot hold light.
        const target = excAt(x, y, 48);
        if (target && isMassive(target.id) && !isNeutrino(target.id)) {
          target.x = x;
          target.y = y;
          target.vx = e.vx * 30;
          target.vy = e.vy * 30;
          target.held = true;
        }
      },
      flick: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        const target = excAt(x, y, 52);
        if (!target) return;
        const speed = clamp(e.speed, 0.6, 2.6);
        if (target.id === "photon") {
          // light cannot be hurried — only redirected. The pitch bends.
          const beta = clamp(0.15 + speed * 0.2, 0, 0.62);
          target.vx = Math.cos(e.angle) * C_PX_S;
          target.vy = Math.sin(e.angle) * C_PX_S;
          target.pitch = clamp(dopplerHz(target.pitch, beta), 60, 4200);
          target.energy = target.energy * Math.sqrt((1 + beta) / (1 - beta));
          tone(target.pitch, 0.5);
          softly(() => haptics.ripple(0.4));
          useField.getState().recordTape("ripple", 0.45, "quanta/doppler");
          return;
        }
        if (isNeutrino(target.id)) return; // the ghost ignores the hand
        const spec = PARTICLES[target.id];
        target.energy = Math.max(target.energy, spec.massMeV) * (1 + speed * 0.8);
        const beta = betaFor(spec.massMeV, target.energy);
        target.vx = Math.cos(e.angle) * beta * C_PX_S;
        target.vy = Math.sin(e.angle) * beta * C_PX_S;
        target.held = false;
        target.ring = Math.min(1, target.ring + 0.3);
        note(midiOf(target.id) + 7, 100);
        softly(() => haptics.ripple(0.35));
      },
      twist: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three-finger twist = season: the field's own slow cycle, never
          // the lens — an unguarded twist here would let it wrongly drive
          // the bare-field lens on a three-finger turn
          if (e.phase === "move") {
            season = (((season + e.angle / (Math.PI * 2)) % 1) + 1) % 1;
            const now = performance.now();
            if (now - lastSeasonSoundAt > 260) {
              lastSeasonSoundAt = now;
              note(26 + Math.round(season * 16), 180);
              softly(() => haptics.tap());
            }
          }
          return;
        }
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            markLens(snapped === 1);
            softly(() => haptics.lens());
            if (snapped === 1) softly(() => audio().chime());
            else note(44, 160);
          }
          lensTarget = snapped;
        }
      },
      pan2: (e) => {
        // two-finger drag pans the frame: a peek, not a permanent move
        lastInteractionAt = performance.now();
        if (e.phase === "move") {
          panTargetX = clamp(panTargetX + e.dx * 0.6, -48, 48);
          panTargetY = clamp(panTargetY + e.dy * 0.6, -48, 48);
        } else if (e.phase === "end") {
          panTargetX = 0;
          panTargetY = 0;
        }
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        // stirring the vacuum shakes a gluon loose — massless, leashed,
        // dressing itself in cycling color until the field takes it back
        scrubWinding += Math.abs(e.angularVelocity) * 0.016;
        if (scrubWinding >= 1) {
          scrubWinding = 0;
          const { x, y } = toLocal(e.cx, e.cy);
          const seed = hashSeed(Math.round(x), Math.round(y), Math.round(localT * 60));
          spawn({ id: "gluon", anti: false }, x, y, 200, hash01(seed) * Math.PI * 2, seed);
          softly(() => audio().buzz());
          note(58, 140);
          softly(() => haptics.ripple(0.45));
          useField.getState().recordTape("object", 0.4, "quanta/gluon");
        }
      },
    });

    // ————— the vessel —————
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduce) {
          tiltLeanX = 0;
          tiltLeanY = 0;
          return;
        }
        tiltLeanX = clamp(gamma / 28, -1, 1);
        tiltLeanY = clamp((beta - 35) / 28, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // agitation: everything unstable does what it wanted, at once
        for (const e of [...excs]) {
          if (e.retiringAt || PARTICLES[e.id].stable) continue;
          decay(e);
        }
        softly(() => (intensity > 0.7 ? haptics.storm() : haptics.chop()));
      },
      knock: ({ intensity }) => {
        if (reduce) return;
        lastInteractionAt = performance.now();
        // a knock on the case shakes a photon out of the wall
        const k = hash01(Math.round(intensity * 997) + Math.round(localT));
        const fromLeft = k < 0.5;
        const en = 0.1 + k * 0.8;
        const e = spawn(
          { id: "photon", anti: false },
          fromLeft ? 6 : width - 6,
          height * (0.2 + k * 0.6),
          en,
          fromLeft ? 0 : Math.PI,
          hashSeed(Math.round(k * 8191), Math.round(localT * 7)),
        );
        tone(e.pitch, 0.5);
        softly(() => haptics.tap());
      },
      flip: ({ faceDown }) => {
        // face-down is night: the field stills until the phone turns back
        nightTarget = faceDown ? 1 : 0;
        lastInteractionAt = performance.now();
        if (faceDown) {
          softly(() => audio().thud());
          note(24, 600);
          softly(() => haptics.roll());
        } else {
          softly(() => audio().spark());
          note(48, 300);
          softly(() => haptics.bloom());
        }
      },
    });

    // ————— keyboard dialect —————
    const onKeyDown = (ev: KeyboardEvent) => {
      const step = 0.05;
      if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        cursorVisible = true;
        lastInteractionAt = performance.now();
        if (ev.key === "ArrowLeft") cursorNx = clamp(cursorNx - step, 0.05, 0.95);
        if (ev.key === "ArrowRight") cursorNx = clamp(cursorNx + step, 0.05, 0.95);
        if (ev.key === "ArrowUp") cursorNy = clamp(cursorNy - step, 0.08, 0.95);
        if (ev.key === "ArrowDown") cursorNy = clamp(cursorNy + step, 0.08, 0.95);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!cursorVisible) {
          cursorVisible = true;
          return;
        }
        if (kbHoldStart === 0) {
          kbHoldStart = performance.now();
          hold.active = true;
          hold.onUid = null;
          hold.x = cursorNx * width;
          hold.y = cursorNy * height;
          hold.seed = hashSeed(Math.round(cursorNx * 997), Math.round(cursorNy * 991), Math.round(performance.now()));
          lastChargeRung = -1;
        } else {
          hold.energy = holdEnergy(performance.now() - kbHoldStart);
          const rung = rungFor(hold.energy);
          if (rung !== lastChargeRung) {
            lastChargeRung = rung;
            if (rung >= 0) {
              note(46 + rung * 7, 140);
            }
          }
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        if (kbHoldStart > 0) {
          const elapsed = performance.now() - kbHoldStart;
          kbHoldStart = 0;
          hold.active = false;
          if (elapsed >= 250) birth(holdEnergy(elapsed), cursorNx * width, cursorNy * height, hold.seed);
        }
      }
    };
    const onBlur = () => {
      cursorVisible = false;
      kbHoldStart = 0;
      save(true);
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);
    wrap.addEventListener("blur", onBlur);
    const onVis = () => {
      if (document.visibilityState === "hidden") save(true);
    };
    document.addEventListener("visibilitychange", onVis);

    // ————— drawing —————

    const drawFelt = (e: Exc, t: number, feltAlpha: number) => {
      const fam = tintFamily(e.id);
      const tints: readonly string[] = QUANTA_TINTS[fam];
      const bright = tints[tints.length - 1];
      const spec = PARTICLES[e.id];
      let fade = 1;
      if (e.retiringAt) fade = 1 - clamp01((performance.now() - e.retiringAt) / RETIRE_MS);
      const alpha = feltAlpha * fade;
      if (alpha <= 0.02) return;

      if (e.id === "photon") {
        // a traveling wave-packet: the field literally waving as it goes
        const ang = Math.atan2(e.vy, e.vx);
        const wl = clamp(46 - (e.pitch - 110) * 0.009, 10, 46); // higher note, tighter wave
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(ang);
        ctx.strokeStyle = colorAlpha(bright, 0.85 * alpha);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = -30; i <= 30; i += 2) {
          const env = Math.exp(-(i * i) / 520);
          const yy = Math.sin((i / wl) * Math.PI * 2 + (reduce ? 0 : t * 9)) * 6 * env;
          if (i === -30) ctx.moveTo(i, yy);
          else ctx.lineTo(i, yy);
        }
        ctx.stroke();
        stampSprite(
          `q-photon-glow-${fam}`,
          [[0, colorAlpha(bright, 1)], [1, "rgba(0,0,0,0)"]],
          0, 0, 22,
          0.35 * alpha,
        );
        ctx.restore();
      } else if (isNeutrino(e.id)) {
        // the ghost: a whisper-thin dashed streak, barely there at all
        const ang = Math.atan2(e.vy, e.vx);
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(ang);
        ctx.setLineDash([2, 7]);
        ctx.strokeStyle = colorAlpha(tints[2], (0.14 + e.ring * 0.4) * alpha);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-26, 0);
        ctx.lineTo(26, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else if (e.id === "gluon") {
        // dressed in cycling color: the leash made visible
        const leash = clamp01(e.walked / CONFINEMENT_REACH_PX);
        const ci = Math.floor(((reduce ? 0 : t * 2.2) + e.phase) % 3);
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.strokeStyle = colorAlpha(QUANTA_TINTS.gluon[ci], (0.8 - leash * 0.4) * alpha);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const u = i / 24;
          const a2 = u * Math.PI * 5 + (reduce ? 0 : t * 6) + e.phase;
          const rr = 4 + u * 5;
          const xx = (u - 0.5) * 22;
          const yy = Math.sin(a2) * rr * 0.55;
          if (i === 0) ctx.moveTo(xx, yy);
          else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        ctx.restore();
      } else {
        // a massive excitation: a standing knot in its field, sized by mass
        const m = spec.massMeV;
        const R = clamp(4 + Math.log10(Math.max(1, m * 100)) * 2.6, 4, 22);
        const trembleAmp = m > 10000 && !reduce ? 1.6 : 0; // the heavies shiver
        const tx = e.x + (trembleAmp ? Math.sin(performance.now() * 0.03 + e.phase) * trembleAmp : 0);
        const ty = e.y + (trembleAmp ? Math.cos(performance.now() * 0.027 + e.phase) * trembleAmp : 0);
        stampSprite(
          `q-mass-halo-${fam}`,
          [
            [0, colorAlpha(bright, 0.5)],
            [0.5, colorAlpha(tints[1], 0.22)],
            [1, "rgba(0,0,0,0)"],
          ],
          tx, ty, R * 2.6,
          alpha,
        );
        ctx.fillStyle = colorAlpha(tints[e.anti ? 1 : 2], 0.95 * alpha);
        ctx.beginPath();
        ctx.arc(tx, ty, R * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // antimatter wears a hollow center — the conjugate, visibly
        if (e.anti) {
          ctx.fillStyle = colorAlpha("#050506", 0.85 * alpha);
          ctx.beginPath();
          ctx.arc(tx, ty, R * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
        // the unstable wear their remaining time as a waning arc
        const life = lifetimeMs(e.id);
        if (Number.isFinite(life)) {
          const leftFrac = clamp01(1 - (e.age * 1000) / life);
          ctx.strokeStyle = colorAlpha(bright, 0.55 * alpha);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(tx, ty, R * 0.95, -Math.PI / 2, -Math.PI / 2 + leftFrac * Math.PI * 2);
          ctx.stroke();
        }
      }

      if (e.ring > 0.02) {
        ctx.strokeStyle = colorAlpha(bright, 0.4 * e.ring * alpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 12 + (1 - e.ring) * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (e.charge01 > 0.02) {
        ctx.strokeStyle = colorAlpha("#E7AC52", 0.5 * e.charge01 * alpha);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 18 + e.charge01 * 10, 0, Math.PI * 2 * e.charge01);
        ctx.stroke();
      }
    };

    /** The bare-field lens: the Feynman view, the one lettered surface. */
    const drawBare = (alpha: number, t: number) => {
      if (alpha <= 0.02) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(5, 6, 9, 0.88)";
      ctx.fillRect(0, 0, width, height);

      // the field lattice, faint — spacetime as graph paper
      ctx.strokeStyle = "rgba(232, 226, 213, 0.05)";
      ctx.lineWidth = 0.5;
      const grid = 44;
      ctx.beginPath();
      for (let gx = grid; gx < width; gx += grid) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
      }
      for (let gy = grid; gy < height; gy += grid) {
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
      }
      ctx.stroke();

      for (const e of excs) {
        if (e.retiringAt) continue;
        const ang = Math.atan2(e.vy, e.vx) || 0;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(ang);
        const fam = tintFamily(e.id);
        const tint = QUANTA_TINTS[fam][2] ?? QUANTA_TINTS[fam][1];
        ctx.strokeStyle = colorAlpha(tint, 0.85);
        ctx.lineWidth = 1.1;
        if (e.id === "photon") {
          // the wavy propagator
          ctx.beginPath();
          for (let i = -26; i <= 26; i += 2) {
            const yy = Math.sin(i * 0.45) * 4;
            if (i === -26) ctx.moveTo(i, yy);
            else ctx.lineTo(i, yy);
          }
          ctx.stroke();
        } else if (e.id === "gluon") {
          // the coiled propagator
          ctx.beginPath();
          for (let i = 0; i <= 28; i++) {
            const u = i / 28;
            const xx = (u - 0.5) * 40;
            const yy = Math.sin(u * Math.PI * 7) * 5;
            if (i === 0) ctx.moveTo(xx, yy);
            else ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        } else if (PARTICLES[e.id].massMeV > 10000) {
          // the heavy dashed propagator
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(-22, 0);
          ctx.lineTo(22, 0);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          // the fermion line, arrow along matter, against for anti
          ctx.beginPath();
          ctx.moveTo(-24, 0);
          ctx.lineTo(24, 0);
          ctx.stroke();
          const dir = e.anti ? -1 : 1;
          ctx.beginPath();
          ctx.moveTo(dir * 4, -4);
          ctx.lineTo(dir * 10, 0);
          ctx.lineTo(dir * 4, 4);
          ctx.stroke();
        }
        ctx.restore();

        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = "rgba(247, 243, 234, 0.85)";
        ctx.textAlign = "left";
        ctx.fillText(symbolOf({ id: e.id, anti: e.anti }), e.x + 16, e.y - 10);
        ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = "rgba(232, 226, 213, 0.45)";
        const spec = PARTICLES[e.id];
        const massLabel = spec.massMeV <= 0 ? "0" : spec.massMeV < 1 ? spec.massMeV.toFixed(3) : Math.round(spec.massMeV).toString();
        ctx.fillText(`${massLabel} mev`, e.x + 16, e.y + 2);
        const life = lifetimeMs(e.id);
        ctx.fillText(Number.isFinite(life) ? `${(life / 1000).toFixed(2)} s` : "∞", e.x + 16, e.y + 12);
      }

      // the mass ladder itself, along the left margin — rungs as ticks
      const lx = Math.max(22, width * 0.05);
      const ly0 = height * 0.82;
      const ly1 = height * 0.16;
      ctx.strokeStyle = "rgba(232, 226, 213, 0.2)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(lx, ly0);
      ctx.lineTo(lx, ly1);
      ctx.stroke();
      ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "left";
      const eMin = Math.log(PHOTON_E_MIN);
      const eMax = Math.log(LADDER[LADDER.length - 1].thresholdMeV);
      for (const rung of LADDER) {
        const u = (Math.log(rung.thresholdMeV) - eMin) / (eMax - eMin);
        const yy = ly0 + (ly1 - ly0) * u;
        ctx.strokeStyle = "rgba(231, 172, 82, 0.5)";
        ctx.beginPath();
        ctx.moveTo(lx - 3, yy);
        ctx.lineTo(lx + 3, yy);
        ctx.stroke();
        ctx.fillStyle = "rgba(232, 226, 213, 0.5)";
        ctx.fillText(rung.name, lx + 8, yy + 3);
      }
      // the hand's charge, climbing the same ladder live
      if (hold.active && hold.onUid == null && hold.energy > 0) {
        const u = clamp01((Math.log(Math.max(PHOTON_E_MIN, hold.energy)) - eMin) / (eMax - eMin));
        const yy = ly0 + (ly1 - ly0) * u;
        ctx.fillStyle = "rgba(242, 197, 107, 0.9)";
        ctx.beginPath();
        ctx.arc(lx, yy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    // ————— the frame —————
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const nowReal = performance.now();
      const tier = gov.beginFrame(nowReal);
      if (sleeping) return; // no draw while the document is hidden
      const detail = detailForTier(tier);
      const dtReal = Math.min(64, nowReal - last);
      last = nowReal;
      timeScale += (timeScaleTarget - timeScale) * 0.12;
      const dt = (dtReal * timeScale) / 1000;
      localT += dt;
      const t = audio().getAudioTime() ?? nowReal / 1000;
      const breath = reduce ? 0 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      lens += (lensTarget - lens) * 0.14;
      night += (nightTarget - night) * (nightTarget > night ? 0.09 : 0.16);
      windX += (windTargetX - windX) * 0.06;
      windY += (windTargetY - windY) * 0.06;
      windTargetX *= 0.985;
      windTargetY *= 0.985;
      tuttiPulse *= 0.94;
      // two-finger pan: the frame eases toward the hand's nudge, then home
      panX += (panTargetX - panX) * 0.14;
      panY += (panTargetY - panY) * 0.14;
      canvas.style.transform = (Math.abs(panX) > 0.05 || Math.abs(panY) > 0.05)
        ? `translate(${panX.toFixed(1)}px, ${panY.toFixed(1)}px)`
        : "";

      // ——— the collision beam: sustained wind winds up real energy ———
      const windMag = Math.hypot(windX, windY);
      if (windMag > 0.2) {
        beamWork += windMag * dt * 1.1;
        const rung = rungFor(windEnergy(beamWork));
        if (rung > beamRung && rung >= 1) {
          beamRung = rung;
          // the beam crests a rung: pair production along the sweep
          const bx = clamp01(lastBeamX + (hash01(beamWork * 7) - 0.5) * 0.3) * width;
          const by = clamp01(lastBeamY + (hash01(beamWork * 13) - 0.5) * 0.3) * height;
          birth(
            Math.min(windEnergy(beamWork), LADDER[rung].thresholdMeV * 1.15),
            bx,
            by,
            hashSeed(Math.round(beamWork * 997), rung),
          );
        }
      } else {
        beamWork = Math.max(0, beamWork - dt * 0.8);
        if (beamWork === 0) beamRung = -1;
      }

      // ——— seeded cosmic rain: a muon falls in on its own schedule ———
      const slot = Math.floor(localT / COSMIC_PERIOD_S);
      if (slot !== lastCosmicSlot) {
        lastCosmicSlot = slot;
        if (slot > 0 && hash01(slot * 17.3) < 0.62) {
          const nx = 0.15 + hash01(slot * 31.7) * 0.7;
          spawn(
            { id: "muon", anti: hash01(slot * 3.1) < 0.5 },
            nx * width,
            -14,
            PARTICLES.muon.massMeV * 6,
            Math.PI / 2 + (hash01(slot * 7.7) - 0.5) * 0.5,
            hashSeed(slot, 0xc05),
          );
        }
      }

      // ——— excitations: walk, wrap or die, and answer the world ———
      for (const e of [...excs]) {
        if (e.retiringAt) continue;
        e.age += dt;
        e.ring *= Math.exp(-dt * 2.2);
        const spec = PARTICLES[e.id];
        const massive = isMassive(e.id) && !isNeutrino(e.id);

        if (!e.held) {
          // only charged mass feels wind and gravity; light and ghosts don't
          if (massive && !reduce) {
            e.vx += windX * 220 * dt + tiltLeanX * 30 * dt * 60;
            e.vy += windY * 220 * dt + tiltLeanY * 30 * dt * 60;
            // and mass drifts: a slow thermal wander on the shared clock
            e.vx += Math.sin(localT * 0.4 + e.phase) * 3 * dt * 60;
            e.vy += Math.cos(localT * 0.33 + e.phase * 1.3) * 3 * dt * 60;
            e.vx *= Math.exp(-dt * 0.7);
            e.vy *= Math.exp(-dt * 0.7);
          }
          const step = Math.hypot(e.vx * dt, e.vy * dt);
          e.walked += step;
          e.x += e.vx * dt;
          e.y += e.vy * dt;
        } else {
          e.held = false;
        }

        // photons and neutrinos wrap: they cross the field forever
        if (e.id === "photon" || isNeutrino(e.id)) {
          if (e.x < -30) e.x = width + 28;
          if (e.x > width + 30) e.x = -28;
          if (e.y < -30) e.y = height + 28;
          if (e.y > height + 30) e.y = -28;
        } else {
          // massives bounce softly — the field's walls are gentle
          if (e.x < 12) {
            e.x = 12;
            e.vx = Math.abs(e.vx) * 0.6;
          }
          if (e.x > width - 12) {
            e.x = width - 12;
            e.vx = -Math.abs(e.vx) * 0.6;
          }
          if (e.y < 12) {
            e.y = 12;
            e.vy = Math.abs(e.vy) * 0.6;
          }
          if (e.y > height - 12) {
            e.y = height - 12;
            e.vy = -Math.abs(e.vy) * 0.6;
          }
        }

        if (!reduce && (e.id === "photon" || isNeutrino(e.id))) {
          e.trail.push(e.x, e.y);
          if (e.trail.length > 12) e.trail.splice(0, e.trail.length - 12);
          // wrap seams would smear the trail across the screen; cut it
          if (e.trail.length >= 4) {
            const n = e.trail.length;
            if (Math.hypot(e.trail[n - 2] - e.trail[n - 4], e.trail[n - 1] - e.trail[n - 3]) > 80) e.trail.length = 0;
          }
        }

        // the one great law, enforced per-frame: out of time or out of reach
        const life = lifetimeMs(e.id);
        if (Number.isFinite(life)) {
          const reach = reachPx(e.id, e.energy);
          if (e.age * 1000 >= life || e.walked >= reach) {
            decay(e);
          }
        }
      }

      // ——— specks ———
      for (let i = specks.length - 1; i >= 0; i--) {
        const s = specks[i];
        const age = nowReal - s.born;
        if (age > s.life) {
          specks.splice(i, 1);
          continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= Math.exp(-dt * 0.9);
        s.vy *= Math.exp(-dt * 0.9);
      }

      // ——— paint ———
      ctx.clearRect(0, 0, width, height);
      // season (three-finger twist) drifts a faint warmth through the
      // vacuum on its own slow cycle
      const seasonWarm = Math.max(0, Math.sin(season * Math.PI * 2));
      const bg = ctx.createRadialGradient(
        width * 0.5,
        height * 0.44,
        Math.min(width, height) * 0.06,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.8,
      );
      bg.addColorStop(0, `rgb(${10 + seasonWarm * 5}, 10, 16)`);
      bg.addColorStop(1, "#040406");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      // face-down is night: the field stills until the phone turns back over
      if (night > 0.01) {
        ctx.fillStyle = `rgba(2, 2, 4, ${night * 0.6})`;
        ctx.fillRect(0, 0, width, height);
      }

      // the vacuum's own seethe: virtual pairs flickering on a seeded clock.
      // The fixed count scales with the frame governor's tier.
      const feltAlpha = 1 - lens;
      const activeMotes = Math.max(10, Math.round(motes.length * detail.particles));
      for (let i = 0; i < activeMotes; i++) {
        const m = motes[i];
        const ph = (localT * (0.25 + hash01(i) * 0.5) + m.p) % 1;
        const a = reduce ? 0.05 : Math.sin(ph * Math.PI) * (0.05 + 0.05 * hash01(i + 3));
        const sep = reduce ? 2 : 2 + Math.sin(ph * Math.PI) * 3;
        ctx.fillStyle = `rgba(221, 211, 190, ${(a + tuttiPulse * 0.06 + breath * 0.015) * feltAlpha})`;
        ctx.beginPath();
        ctx.arc(m.x - sep, m.y, 0.7, 0, Math.PI * 2);
        ctx.arc(m.x + sep, m.y, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // the charge rings while a hand holds the bare field
      if (hold.active && hold.onUid == null && hold.energy > 0 && feltAlpha > 0.05) {
        const rung = rungFor(hold.energy);
        for (let i = 0; i <= rung; i++) {
          const rr = 16 + i * 13;
          ctx.strokeStyle = colorAlpha("#E7AC52", (0.5 - i * 0.05) * feltAlpha);
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(hold.x, hold.y, rr + (reduce ? 0 : Math.sin(t * 5 + i) * 1.6), 0, Math.PI * 2);
          ctx.stroke();
        }
        // the standing wave gathering under the finger
        const gg = ctx.createRadialGradient(hold.x, hold.y, 2, hold.x, hold.y, 34);
        gg.addColorStop(0, colorAlpha("#F2C56B", 0.28 * feltAlpha));
        gg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gg;
        ctx.fillRect(hold.x - 36, hold.y - 36, 72, 72);
      }

      // the collision beam's gathering glow
      if (beamWork > 0.3 && feltAlpha > 0.05) {
        const u = clamp01(beamWork / 6);
        ctx.strokeStyle = colorAlpha("#B25048", 0.3 * u * feltAlpha);
        ctx.lineWidth = 1 + u * 2;
        ctx.beginPath();
        ctx.moveTo(lastBeamX * width - windX * 90, lastBeamY * height - windY * 90);
        ctx.lineTo(lastBeamX * width + windX * 90, lastBeamY * height + windY * 90);
        ctx.stroke();
      }

      // trails (photons and neutrinos), under the excitations
      if (feltAlpha > 0.05) {
        for (const e of excs) {
          if (e.retiringAt || e.trail.length < 4) continue;
          const fam = tintFamily(e.id);
          ctx.strokeStyle = colorAlpha(QUANTA_TINTS[fam][1], (isNeutrino(e.id) ? 0.08 : 0.2) * feltAlpha);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(e.trail[0], e.trail[1]);
          for (let i = 2; i < e.trail.length; i += 2) ctx.lineTo(e.trail[i], e.trail[i + 1]);
          ctx.stroke();
        }
        for (const e of excs) drawFelt(e, t, feltAlpha);
      }

      // specks over everything felt
      for (const s of specks) {
        const u = (nowReal - s.born) / s.life;
        ctx.fillStyle = colorAlpha(s.color, 0.7 * (1 - u) * feltAlpha);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // the keyboard's cursor
      if (cursorVisible) {
        ctx.strokeStyle = "rgba(242, 197, 107, 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cursorNx * width, cursorNy * height, 13, 0, Math.PI * 2);
        ctx.stroke();
      }

      drawBare(lens, t);

      // the glimmer: after a long stillness, a neutrino streams through
      if (!reduce && nowReal - lastInteractionAt > 20000 && nowReal - glimmerAt > 16000) {
        glimmerAt = nowReal;
        const k = hash01(nowReal * 0.13);
        const nus: ParticleId[] = ["nu-e", "nu-mu", "nu-tau"];
        spawn(
          { id: nus[Math.floor(k * 3) % 3], anti: k > 0.5 },
          -20,
          height * (0.15 + k * 0.7),
          1,
          (k - 0.5) * 0.3,
          hashSeed(Math.round(nowReal), 0x91),
        );
      }

      if (excs.some((e) => e.retiringAt && nowReal - e.retiringAt > RETIRE_MS)) {
        excs = excs.filter((e) => !e.retiringAt || nowReal - e.retiringAt <= RETIRE_MS);
      }
      save();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      mq.removeEventListener?.("change", onMq);
      observer.disconnect();
      detach();
      detachVessel();
      offVis();
      markLens(false);
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      wrap.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      cancelAnimationFrame(raf);
      save(true);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="the quantum field floor — excitations born, decaying, and crossing forever"
      style={{
        position: "fixed",
        inset: 0,
        background: "#040406",
        outline: "none",
        touchAction: "none",
      }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <LetGo label="let the field rest" onLetGo={() => stillRef.current()} visible={hasResidue} />
    </div>
  );
}
