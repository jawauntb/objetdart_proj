"use client";

/**
 * /atoms — a near-vacuum at 10⁻¹⁰ m, the physics band of the scale
 * manifold (plan W6).
 *
 * A handful of atoms as soft probability clouds: shell rings, orbital
 * lobes rendered as translucent fields, a bright nucleus. Every atom is a
 * pure function of its seed (src/lib/atomics.ts) — electron count, shells,
 * lobe symmetry, tint — and the clouds breathe on the shared audio clock.
 * Tap excites: an electron jumps a shell (ring flash, rising note) and
 * decays back after a beat (falling note, a soft photon streak); intensity
 * decides the jump size. A drag sweeps the field and the clouds lean
 * toward the finger. Dwell on open space condenses a new atom. The
 * ceremony held where two atoms are near is COVALENCE: they share a bond,
 * lobes merging — the bond is the order-independent hash of both seeds,
 * the bridge toward molecules. Three fingers run a field wind or dilate
 * time, a scrub precesses the orbitals, a twist rotates the lens to the
 * orbital diagram (thin measured rings, energy rungs — no letters here).
 * A flick ionizes: an electron streaks out and falls home again. The field
 * persists in `objetdart:atoms:v1`. Pinch is deliberately unbound —
 * ScaleTravel owns it (molecules above; quarks below, still unbuilt).
 */

import { useEffect, useRef } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { useField } from "@/store/field";
import {
  ATOM_FAMILIES,
  MAX_ATOMS,
  MAX_RING,
  atomFromSeed,
  covalentBond,
  excitedRing,
  hashSeed,
  settlePopulation,
  type AtomMorph,
} from "@/lib/atomics";

const STORE_KEY = "objetdart:atoms:v1";
const MOTE_COUNT = 60;
const RETIRE_MS = 1400;
const EXCITE_MS = 900;

type AtomEnt = {
  id: string;
  seed: number;
  nx: number;
  ny: number;
  morph: AtomMorph;
  /** 0..1 — the cloud gathering from nothing when condensed. */
  growth: number;
  closed: boolean;
  /** Live excitation, if any. */
  excite: { ring: number; born: number; decayed: boolean } | null;
  /** 0..1 covalence charge — lobes reach for the partner. */
  charge: number;
  /** Extra precession from stirring, decays. */
  precessBoost: number;
  /** Ionization dimming, 0..1, decays. */
  dim: number;
  precessPhase: number;
  birth: number;
  retiringAt: number;
  pushX: number;
  pushY: number;
  sx: number;
  sy: number;
  sr: number;
};

type CovBond = { aId: string; bId: string; seed: number };
type Mote = { x: number; y: number; vx: number; vy: number };
type Speck = { x: number; y: number; vx: number; vy: number; born: number; life: number; r: number; color: string; streak?: boolean };
type PendingNote = { at: number; midi: number; ms: number };

type Stored = {
  atoms: Array<{ id: string; seed: number; nx: number; ny: number }>;
  bonds: Array<{ a: string; b: string }>;
};

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

function mixHex(a: string, b: string, t: number) {
  const va = parseInt(a.slice(1), 16);
  const vb = parseInt(b.slice(1), 16);
  const r = Math.round(((va >> 16) & 255) * (1 - t) + ((vb >> 16) & 255) * t);
  const g = Math.round(((va >> 8) & 255) * (1 - t) + ((vb >> 8) & 255) * t);
  const bl = Math.round((va & 255) * (1 - t) + (vb & 255) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function makeAtom(seed: number, nx: number, ny: number, growth: number): AtomEnt {
  const morph = atomFromSeed(seed);
  return {
    id: `at-${seed.toString(36)}`,
    seed,
    nx,
    ny,
    morph,
    growth,
    closed: growth >= 1,
    excite: null,
    charge: 0,
    precessBoost: 0,
    dim: 0,
    precessPhase: (hashSeed(seed, 97) / 4294967296) * Math.PI * 2,
    birth: performance.now(),
    retiringAt: 0,
    pushX: 0,
    pushY: 0,
    sx: -1,
    sy: -1,
    sr: 0,
  };
}

// the first look is never an empty vacuum — three deterministic presences
const STARTERS: Array<[number, number]> = [
  [0.3, 0.4],
  [0.7, 0.34],
  [0.5, 0.7],
];

function loadStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || !Array.isArray(parsed.atoms)) return null;
    return {
      atoms: parsed.atoms.filter(
        (a) => a && typeof a.seed === "number" && typeof a.nx === "number" && typeof a.ny === "number",
      ),
      bonds: Array.isArray(parsed.bonds)
        ? parsed.bonds.filter((b) => b && typeof b.a === "string" && typeof b.b === "string")
        : [],
    };
  } catch {
    return null;
  }
}

/** midi voice of an atom — the high shimmer end of the axis */
function midiOf(morph: AtomMorph): number {
  return 64 + morph.voice + morph.family * 2;
}

export default function AtomsField() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state —————
    let atoms: AtomEnt[] = [];
    let bonds: CovBond[] = [];
    let seedCount = 0;
    const motes: Mote[] = [];
    const specks: Speck[] = [];
    const pendingNotes: PendingNote[] = [];
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let lastFrame = 0;
    let last = performance.now();
    let localT = 0;
    let reduce = false;
    let windX = 0;
    let windY = 0;
    let windTargetX = 0;
    let windTargetY = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let sweepX = 0;
    let sweepY = 0;
    let sweepStrength = 0;
    let stirOmega = 0;
    let lastInteractionAt = performance.now();
    let lastSaveAt = 0;
    let dirty = false;
    let focused = false;
    let cursorNx = 0.5;
    let cursorNy = 0.5;
    let cursorVisible = false;
    let kbCharge = 0;
    let kbAtomId: string | null = null;
    let lastSweepSoundAt = 0;
    let lastWindSoundAt = 0;
    let lastScrubAt = 0;
    let lastChargeNoteAt = 0;
    const hold: { atomId: string | null; partnerId: string | null; onExisting: boolean; seeded: boolean; bonded: boolean } = {
      atomId: null,
      partnerId: null,
      onExisting: false,
      seeded: false,
      bonded: false,
    };

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
        const alive = new Set(atoms.filter((a) => !a.retiringAt).map((a) => a.id));
        const stored: Stored = {
          atoms: atoms
            .filter((a) => !a.retiringAt)
            .map((a) => ({ id: a.id, seed: a.seed, nx: a.nx, ny: a.ny })),
          bonds: bonds
            .filter((b) => alive.has(b.aId) && alive.has(b.bId))
            .map((b) => ({ a: b.aId, b: b.bId })),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
      } catch { /* quota; the vacuum keeps its own counsel */ }
    };

    const bondBetween = (a: AtomEnt, b: AtomEnt) => {
      bonds.push({ aId: a.id, bId: b.id, seed: covalentBond(a.seed, b.seed).seed });
    };

    const stored = loadStored();
    if (stored && stored.atoms.length > 0) {
      atoms = stored.atoms
        .slice(-MAX_ATOMS)
        .map((a) => makeAtom(a.seed, clamp01(a.nx), clamp01(a.ny), 1));
      const byId = new Map(atoms.map((a) => [a.id, a]));
      for (const b of stored.bonds) {
        const pa = byId.get(b.a);
        const pb = byId.get(b.b);
        if (pa && pb && pa !== pb && !bonds.some((q) => (q.aId === b.a && q.bId === b.b) || (q.aId === b.b && q.bId === b.a))) {
          bondBetween(pa, pb);
        }
      }
      seedCount = atoms.length;
    } else {
      atoms = STARTERS.map(([nx, ny], i) =>
        makeAtom(hashSeed(Math.round(nx * 811), Math.round(ny * 809), i), nx, ny, 1),
      );
      seedCount = atoms.length;
      save(true);
    }

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };
    const noteLater = (delayMs: number, midi: number, ms = 120) => {
      pendingNotes.push({ at: performance.now() + delayMs, midi, ms });
    };

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
      if (motes.length === 0) {
        for (let i = 0; i < MOTE_COUNT; i++) {
          motes.push({ x: twinkleHash(i + 37) * width, y: twinkleHash(i + 733) * height, vx: 0, vy: 0 });
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

    const atomAt = (x: number, y: number): AtomEnt | null => {
      let best: AtomEnt | null = null;
      let bestD = Infinity;
      for (const a of atoms) {
        if (a.retiringAt) continue;
        const d = Math.hypot(x - a.sx, y - a.sy);
        if (d < Math.max(40, a.sr * 1.2) && d < bestD) { bestD = d; best = a; }
      }
      return best;
    };

    const nearestAtom = (x: number, y: number): AtomEnt | null => {
      let best: AtomEnt | null = null;
      let bestD = Infinity;
      for (const a of atoms) {
        if (a.retiringAt || !a.closed) continue;
        const d = Math.hypot(x - a.sx, y - a.sy);
        if (d < bestD) { bestD = d; best = a; }
      }
      return best;
    };

    const areBonded = (a: AtomEnt, b: AtomEnt) =>
      bonds.some((q) => (q.aId === a.id && q.bId === b.id) || (q.aId === b.id && q.bId === a.id));

    /** The nearest other unbonded-to-it atom within covalent reach of a. */
    const covalentPartner = (a: AtomEnt): AtomEnt | null => {
      let best: AtomEnt | null = null;
      let bestD = Infinity;
      for (const o of atoms) {
        if (o === a || o.retiringAt || !o.closed || areBonded(a, o)) continue;
        const d = Math.hypot(o.sx - a.sx, o.sy - a.sy);
        if (d < (a.sr + o.sr) * 1.5 && d < bestD) { bestD = d; best = o; }
      }
      return best;
    };

    const burst = (x: number, y: number, colors: string[], n: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + twinkleHash(i + n) * 0.8;
        const s = speed * (0.4 + twinkleHash(i * 3 + 1) * 0.9);
        specks.push({
          x, y,
          vx: Math.cos(ang) * s,
          vy: Math.sin(ang) * s,
          born: performance.now(),
          life: 800 + twinkleHash(i * 7 + 2) * 1200,
          r: 0.7 + twinkleHash(i * 11 + 3) * 1.6,
          color: colors[i % colors.length],
        });
      }
      if (specks.length > 200) specks.splice(0, specks.length - 200);
    };

    const photonStreak = (a: AtomEnt, angle: number, speed: number, color: string) => {
      specks.push({
        x: a.sx,
        y: a.sy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        born: performance.now(),
        life: 900,
        r: 1.6,
        color,
        streak: true,
      });
    };

    const retireOldest = () => {
      const alive = atoms.filter((a) => !a.retiringAt);
      const { retired } = settlePopulation(alive, MAX_ATOMS);
      for (const r of retired) {
        r.retiringAt = performance.now();
        bonds = bonds.filter((b) => b.aId !== r.id && b.bId !== r.id);
        note(midiOf(r.morph) - 12, 340); // a low word as the eldest disperses
      }
    };

    const condense = (x: number, y: number): AtomEnt | null => {
      const nx = clamp01(x / width);
      const ny = clamp(y / height, 0.08, 0.95);
      const seed = hashSeed(Math.round(nx * 811), Math.round(ny * 809), seedCount);
      seedCount += 1;
      const a = makeAtom(seed, nx, ny, 0.03);
      atoms.push(a);
      retireOldest();
      try { audio().spark(); } catch { /* noop */ }
      note(midiOf(a.morph) - 12, 200);
      try { haptics.ripple(0.5); } catch { /* noop */ }
      burst(x, y, [ATOM_FAMILIES[a.morph.family][4], "#DDD3BE"], 6, 20);
      useField.getState().recordTape("object", 0.5, "atoms/condense");
      save();
      return a;
    };

    const growAtom = (a: AtomEnt, d: number) => {
      if (a.closed) return;
      a.growth = clamp01(a.growth + d);
      if (!a.closed && a.growth >= 1) {
        a.closed = true;
        // the cloud settles into itself: shimmer, note, bloom
        try { haptics.bloom(); } catch { /* noop */ }
        note(midiOf(a.morph), 280);
        burst(a.sx, a.sy, [ATOM_FAMILIES[a.morph.family][5], "#E7AC52"], 10, 30);
        dirty = true;
      }
    };

    const excite = (a: AtomEnt, intensity: number) => {
      if (!a.closed || a.retiringAt) return;
      const ring = excitedRing(a.morph, intensity);
      a.excite = { ring, born: performance.now(), decayed: false };
      // the jump: a rising note, sized like the leap
      note(midiOf(a.morph) + (ring - a.morph.shells) * 4, 160);
      try { haptics.tap(); } catch { /* noop */ }
      useField.getState().recordTape("ripple", 0.4 + intensity * 0.4, "atoms/excite");
    };

    const covalesce = (a: AtomEnt, b: AtomEnt) => {
      if (!a.closed || !b.closed || a.retiringAt || b.retiringAt || areBonded(a, b)) return;
      bondBetween(a, b);
      const cb = covalentBond(a.seed, b.seed);
      // covalence: one solemn act, three senses in one frame
      try { audio().bell(); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
      note(52 + cb.tone, 420);
      burst((a.sx + b.sx) / 2, (a.sy + b.sy) / 2, [
        ATOM_FAMILIES[a.morph.family][5],
        ATOM_FAMILIES[b.morph.family][5],
        "#F2EEE6",
      ], 18, 46);
      useField.getState().recordTape("sigil", 0.85, "atoms/covalence");
      save();
    };

    // ————— gestures (the grammar, nothing private; pinch belongs to the manifold) —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        const a = nearestAtom(x, y);
        if (a) excite(a, e.intensity);
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "enter") { timeScaleTarget = 0.25; try { haptics.tap(); } catch { /* noop */ } note(34, 280); }
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          const a = atomAt(x, y);
          hold.atomId = a ? a.id : null;
          hold.partnerId = null;
          hold.onExisting = !!a;
          hold.seeded = false;
          hold.bonded = false;
          return;
        }
        if (e.phase === "release") {
          const a = atoms.find((q) => q.id === hold.atomId);
          if (a) a.charge = 0;
          const p = atoms.find((q) => q.id === hold.partnerId);
          if (p) p.charge = 0;
          hold.atomId = null;
          hold.partnerId = null;
          hold.onExisting = false;
          save();
          return;
        }
        // ticks (~80ms)
        if (hold.onExisting && hold.atomId) {
          const a = atoms.find((q) => q.id === hold.atomId);
          if (!a || a.retiringAt) return;
          const partner = covalentPartner(a);
          hold.partnerId = partner ? partner.id : null;
          if (!partner || !a.closed) {
            // no partner in reach: the cloud only deepens under the hand
            return;
          }
          // the road to the ceremony: lobes reach, ticks rise
          a.charge = clamp01((e.elapsed - 900) / 1600);
          partner.charge = a.charge;
          const d = Math.hypot(partner.sx - a.sx, partner.sy - a.sy);
          if (d > (a.sr + partner.sr) * 0.8) {
            const k = 10 * a.charge + 3;
            a.pushX += ((partner.sx - a.sx) / d) * k;
            a.pushY += ((partner.sy - a.sy) / d) * k;
            partner.pushX += ((a.sx - partner.sx) / d) * k;
            partner.pushY += ((a.sy - partner.sy) / d) * k;
          }
          const now = performance.now();
          if (a.charge > 0 && now - lastChargeNoteAt > 340) {
            lastChargeNoteAt = now;
            note(midiOf(a.morph) + Math.round(a.charge * 9), 90);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.tier >= 3 && !hold.bonded) {
            hold.bonded = true;
            hold.atomId = null;
            hold.partnerId = null;
            covalesce(a, partner);
            a.charge = 0;
            partner.charge = 0;
          }
        } else if (hold.atomId) {
          // an atom this hand just condensed — keep holding, it keeps gathering
          const a = atoms.find((q) => q.id === hold.atomId);
          if (a) growAtom(a, 0.0011 * 80 * (1 + e.intensity * 0.6));
        } else if (e.tier >= 2 && !hold.seeded && !hold.onExisting && !hold.bonded) {
          // dwell on open space: condense — long-press means grow, everywhere
          hold.seeded = true;
          const a = condense(x, y);
          if (a) hold.atomId = a.id;
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        if (e.fingers === 3) {
          // three fingers are the law: a field wind through the vacuum
          windTargetX = clamp(e.vx * 1.4, -1, 1);
          windTargetY = clamp(e.vy * 1.4, -1, 1);
          const now = performance.now();
          const mag = Math.hypot(windTargetX, windTargetY);
          if (mag > 0.5 && now - lastWindSoundAt > 520) {
            lastWindSoundAt = now;
            note(36 + Math.round(mag * 5), 260);
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "end") {
          sweepStrength = 0;
          return;
        }
        // one finger sweeps the field — probability leans toward the hand
        sweepX = x;
        sweepY = y;
        sweepStrength = Math.min(1, sweepStrength + 0.2);
        const now = performance.now();
        if (now - lastSweepSoundAt > 300) {
          lastSweepSoundAt = now;
          note(70 + Math.round(twinkleHash(Math.floor(now / 300)) * 4), 70);
          try { haptics.ripple(0.15); } catch { /* noop */ }
        }
      },
      flick: (e) => {
        lastInteractionAt = performance.now();
        // a flick ionizes: an electron streaks away, the cloud dims, and
        // after a beat it falls home with a soft return
        const { x, y } = toLocal(e.x, e.y);
        const a = nearestAtom(x, y);
        if (!a) return;
        const speed = clamp(e.speed, 0.6, 2.4);
        photonStreak(a, e.angle, 220 * speed, ATOM_FAMILIES[a.morph.family][5]);
        a.dim = Math.min(1, a.dim + 0.6);
        a.pushX -= Math.cos(e.angle) * 8;
        a.pushY -= Math.sin(e.angle) * 8;
        note(midiOf(a.morph) + 12, 90);
        noteLater(650, midiOf(a.morph) + 3, 220);
        try { haptics.ripple(0.4); } catch { /* noop */ }
      },
      twist: (e) => {
        lastInteractionAt = performance.now();
        // two fingers rotate the lens: felt cloud ↔ orbital diagram
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            try { haptics.lens(); } catch { /* noop */ }
            if (snapped === 1) { try { audio().chime(); } catch { /* noop */ } }
            else note(46, 160);
          }
          lensTarget = snapped;
        }
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        // orbital stirring: the lobes precess with the winding
        stirOmega = clamp(stirOmega + e.angularVelocity * 0.15, -4, 4);
        for (const a of atoms) a.precessBoost = clamp(a.precessBoost + e.angularVelocity * 0.1, -3, 3);
        const now = performance.now();
        if (now - lastScrubAt > 600) {
          lastScrubAt = now;
          note(72 + Math.round(Math.abs(e.winding)), 90);
          try { haptics.ripple(0.3); } catch { /* noop */ }
        }
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
        const a = atomAt(x, y);
        if (a && a.closed) {
          const partner = covalentPartner(a);
          if (partner) {
            // held Enter repeats — the keyboard's ceremony
            if (kbAtomId !== a.id) { kbAtomId = a.id; kbCharge = 0; }
            kbCharge = clamp01(kbCharge + (ev.repeat ? 0.09 : 0.02));
            a.charge = kbCharge;
            partner.charge = kbCharge;
            const now = performance.now();
            if (now - lastChargeNoteAt > 340) {
              lastChargeNoteAt = now;
              note(midiOf(a.morph) + Math.round(kbCharge * 9), 90);
            }
            if (kbCharge >= 1) {
              kbCharge = 0;
              kbAtomId = null;
              covalesce(a, partner);
              a.charge = 0;
              partner.charge = 0;
            }
          } else if (!ev.repeat) {
            excite(a, 0.6);
          }
        } else if (!ev.repeat) {
          const seeded = condense(x, y);
          if (seeded) growAtom(seeded, 0.05);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        const a = atoms.find((q) => q.id === kbAtomId);
        if (a) {
          a.charge = 0;
          const partner = covalentPartner(a);
          if (partner) partner.charge = 0;
        }
        kbCharge = 0;
        kbAtomId = null;
      }
    };
    const onFocus = () => { focused = true; };
    const onBlur = () => { focused = false; cursorVisible = false; save(true); };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);
    wrap.addEventListener("focus", onFocus);
    wrap.addEventListener("blur", onBlur);
    const onVis = () => { if (document.visibilityState === "hidden") save(true); };
    document.addEventListener("visibilitychange", onVis);

    // ————— drawing —————
    const shellRadius = (R: number, ring: number, shells: number) =>
      R * (0.34 + 0.66 * (ring / Math.max(shells + 1, 4)));

    const drawAtom = (a: AtomEnt, t: number, breath: number) => {
      const morph = a.morph;
      const fam = ATOM_FAMILIES[morph.family];
      const minDim = Math.min(width, height);
      const grow = a.growth < 1 ? 0.2 + 0.8 * a.growth : 1;
      let fade = 1;
      let retireScale = 1;
      if (a.retiringAt) {
        const e = clamp01((performance.now() - a.retiringAt) / RETIRE_MS);
        fade = 1 - e;
        retireScale = 1 + e * 0.3; // an atom disperses outward, not inward
      }
      const breathScale = reduce ? 1 : 1 + Math.sin(breath + morph.breathOffset) * 0.035;
      const R = minDim * morph.radius * grow * breathScale * retireScale;
      if (R < 1) return;
      const cx = a.nx * width;
      const cy = a.ny * height;
      a.sx = cx;
      a.sy = cy;
      a.sr = R;

      const dimK = 1 - a.dim * 0.55;
      const feltAlpha = (1 - lens) * fade * dimK;
      const lensAlpha = lens * fade;
      const precession = a.precessPhase + (reduce ? 0 : t * (morph.precess + a.precessBoost + stirOmega * 0.3));
      // field sweep: the cloud leans toward the finger
      let leanX = 0;
      let leanY = 0;
      if (sweepStrength > 0.01) {
        const dx = sweepX - cx;
        const dy = sweepY - cy;
        const d = Math.max(1, Math.hypot(dx, dy));
        const reach = minDim * 0.5;
        const k = Math.max(0, 1 - d / reach) * sweepStrength;
        leanX = (dx / d) * R * 0.22 * k;
        leanY = (dy / d) * R * 0.22 * k;
      }

      ctx.save();
      ctx.translate(cx, cy);

      // the covalence ceremony: a warm halo tightens as lobes reach
      if (a.charge > 0) {
        const halo = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * (2 - a.charge * 0.6));
        halo.addColorStop(0, colorAlpha("#E7AC52", 0.09 * a.charge * fade));
        halo.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = halo;
        ctx.fillRect(-R * 2, -R * 2, R * 4, R * 4);
      }

      // — felt pass: probability as translucent light —
      if (feltAlpha > 0.02) {
        // the whole cloud: a soft envelope
        const cloud = ctx.createRadialGradient(leanX * 0.5, leanY * 0.5, R * 0.05, leanX * 0.5, leanY * 0.5, R * 1.1);
        cloud.addColorStop(0, colorAlpha(fam[3], 0.1 * feltAlpha * grow));
        cloud.addColorStop(0.6, colorAlpha(fam[2], 0.06 * feltAlpha * grow));
        cloud.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = cloud;
        ctx.beginPath();
        ctx.arc(leanX * 0.5, leanY * 0.5, R * 1.1, 0, Math.PI * 2);
        ctx.fill();

        // orbital lobes — translucent fields with the seed's symmetry
        const lobeR = R * 0.62;
        for (let i = 0; i < morph.lobes; i++) {
          const ang = morph.lobeTilt + precession + (i / morph.lobes) * Math.PI * 2;
          const hum = reduce ? 0 : Math.sin(t * Math.PI * 2 * morph.hum.rateHz + i * 1.9) * morph.hum.amp;
          const lx = Math.cos(ang) * lobeR * 0.62 + leanX;
          const ly = Math.sin(ang) * lobeR * 0.62 + leanY;
          const lr = lobeR * (0.55 + hum * 3);
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(ang);
          const lg = ctx.createRadialGradient(0, 0, lr * 0.08, 0, 0, lr);
          lg.addColorStop(0, colorAlpha(fam[4], 0.16 * feltAlpha));
          lg.addColorStop(0.65, colorAlpha(fam[2], 0.07 * feltAlpha));
          lg.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.ellipse(0, 0, lr, lr * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // shell rings — faint circles of standing probability
        for (let ringI = 1; ringI <= morph.shells; ringI++) {
          const rr = shellRadius(R, ringI, morph.shells);
          ctx.strokeStyle = colorAlpha(fam[Math.min(5, 2 + ringI)], 0.16 * feltAlpha);
          ctx.lineWidth = Math.max(0.6, R * 0.008);
          ctx.beginPath();
          ctx.arc(leanX * (ringI / morph.shells) * 0.5, leanY * (ringI / morph.shells) * 0.5, rr, 0, Math.PI * 2);
          ctx.stroke();
          // electrons on this shell, small pearls on their round
          const count = morph.electrons[ringI - 1];
          const shown = Math.min(count, 8);
          for (let k = 0; k < shown; k++) {
            const ea = precession * (ringI % 2 === 0 ? -1.3 : 1) + (k / shown) * Math.PI * 2 + ringI * 0.7;
            const ex = Math.cos(ea) * rr + leanX * (ringI / morph.shells) * 0.5;
            const ey = Math.sin(ea) * rr + leanY * (ringI / morph.shells) * 0.5;
            ctx.fillStyle = colorAlpha(fam[5], 0.5 * feltAlpha);
            ctx.beginPath();
            ctx.arc(ex, ey, Math.max(0.8, R * 0.016), 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // excitation: the jumped ring flashes; decay throws a photon
        if (a.excite) {
          const age = (performance.now() - a.excite.born) / EXCITE_MS;
          if (age < 1) {
            const rr = shellRadius(R, a.excite.ring, morph.shells);
            const flash = age < 0.3 ? age / 0.3 : 1 - (age - 0.3) / 0.7;
            ctx.strokeStyle = colorAlpha("#F2C56B", 0.55 * flash * feltAlpha);
            ctx.lineWidth = Math.max(1, R * 0.02);
            ctx.beginPath();
            ctx.arc(0, 0, rr, 0, Math.PI * 2);
            ctx.stroke();
            // the traveling electron, one bright pearl on the high ring
            const ea = precession * 2 + age * Math.PI * 3;
            ctx.fillStyle = colorAlpha("#F7F3EA", 0.85 * flash * feltAlpha);
            ctx.beginPath();
            ctx.arc(Math.cos(ea) * rr, Math.sin(ea) * rr, Math.max(1.2, R * 0.022), 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // nucleus — the one bright certainty
        const nR = R * morph.nucleus * (1 + (reduce ? 0 : Math.sin(breath * 2 + morph.breathOffset) * 0.08));
        const ng = ctx.createRadialGradient(0, 0, 0, 0, 0, nR * 3);
        ng.addColorStop(0, colorAlpha("#F7F3EA", 0.9 * feltAlpha));
        ng.addColorStop(0.25, colorAlpha(fam[5], 0.6 * feltAlpha));
        ng.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = ng;
        ctx.beginPath();
        ctx.arc(0, 0, nR * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // — lens pass: the orbital diagram, the same atom as measure —
      if (lensAlpha > 0.02) {
        const ink = morph.family === 1 ? "#B25048" : "#DDD3BE";
        // shells as thin measured rings
        for (let ringI = 1; ringI <= morph.shells; ringI++) {
          const rr = shellRadius(R, ringI, morph.shells);
          ctx.setLineDash(ringI === morph.shells ? [] : [3, 4]);
          ctx.strokeStyle = colorAlpha(ink, 0.6 * lensAlpha);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(0, 0, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // energy levels as rungs, a ladder standing beside the cloud —
        // spacing tightens as the levels climb, the way energy does
        const lx = R * 1.18;
        const rungW = R * 0.3;
        for (let ringI = 1; ringI <= MAX_RING; ringI++) {
          const frac = 1 - 1 / (ringI + 0.6);
          const ry = R * 0.7 - frac * R * 1.35;
          const occupied = ringI <= morph.shells;
          const excitedHere = a.excite && !a.excite.decayed && a.excite.ring === ringI
            && (performance.now() - a.excite.born) / EXCITE_MS < 1;
          ctx.strokeStyle = colorAlpha(
            excitedHere ? "#F2C56B" : ink,
            (occupied ? 0.75 : 0.28) * lensAlpha * (excitedHere ? 1 : 1),
          );
          ctx.lineWidth = occupied ? 1.4 : 0.7;
          ctx.beginPath();
          ctx.moveTo(lx, ry);
          ctx.lineTo(lx + rungW, ry);
          ctx.stroke();
          if (occupied) {
            // occupancy pips, up to four per rung
            const pips = Math.min(4, morph.electrons[ringI - 1]);
            for (let p = 0; p < pips; p++) {
              ctx.fillStyle = colorAlpha(ink, 0.7 * lensAlpha);
              ctx.beginPath();
              ctx.arc(lx + rungW * ((p + 1) / (pips + 1)), ry - R * 0.035, R * 0.014, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        // the nucleus as a small measured cross
        ctx.strokeStyle = colorAlpha(ink, 0.8 * lensAlpha);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(-R * 0.05, 0);
        ctx.lineTo(R * 0.05, 0);
        ctx.moveTo(0, -R * 0.05);
        ctx.lineTo(0, R * 0.05);
        ctx.stroke();
      }

      ctx.restore();
    };

    const drawBonds = (t: number) => {
      const byId = new Map(atoms.map((a) => [a.id, a]));
      for (const b of bonds) {
        const pa = byId.get(b.aId);
        const pb = byId.get(b.bId);
        if (!pa || !pb || pa.retiringAt || pb.retiringAt) continue;
        if (pa.sr <= 0 || pb.sr <= 0) continue; // not drawn yet: no geometry to shine between
        const cb = covalentBond(pa.seed, pb.seed);
        const midX = (pa.sx + pb.sx) / 2;
        const midY = (pa.sy + pb.sy) / 2;
        const d = Math.max(1, Math.hypot(pb.sx - pa.sx, pb.sy - pa.sy));
        const feltAlpha = 1 - lens;
        if (feltAlpha > 0.02) {
          // merged lobes: a shared luminous field between the pair
          const g = ctx.createRadialGradient(midX, midY, 2, midX, midY, d * 0.55);
          const fa = ATOM_FAMILIES[pa.morph.family][4];
          g.addColorStop(0, colorAlpha(fa, 0.14 * cb.gleam * feltAlpha));
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.save();
          ctx.translate(midX, midY);
          ctx.rotate(Math.atan2(pb.sy - pa.sy, pb.sx - pa.sx));
          const pulse = reduce ? 1 : 1 + Math.sin(t * 1.7 + cb.tone) * 0.12;
          ctx.beginPath();
          ctx.ellipse(0, 0, d * 0.52 * pulse, Math.min(pa.sr, pb.sr) * 0.5 * pulse, 0, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
          ctx.restore();
        }
        if (lens > 0.02) {
          // the diagram draws covalence as a measured double line
          const nx = (pb.sy - pa.sy) / d;
          const ny = -(pb.sx - pa.sx) / d;
          const off = 2.4;
          ctx.strokeStyle = colorAlpha("#DDD3BE", 0.55 * lens);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(pa.sx + nx * off, pa.sy + ny * off);
          ctx.lineTo(pb.sx + nx * off, pb.sy + ny * off);
          ctx.moveTo(pa.sx - nx * off, pa.sy - ny * off);
          ctx.lineTo(pb.sx - nx * off, pb.sy - ny * off);
          ctx.stroke();
        }
      }
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
      windX += (windTargetX - windX) * Math.min(1, dt * 2.2);
      windY += (windTargetY - windY) * Math.min(1, dt * 2.2);
      windTargetX *= Math.exp(-dt * 0.5);
      windTargetY *= Math.exp(-dt * 0.5);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      sweepStrength *= Math.exp(-dt * 2.2);
      stirOmega *= Math.exp(-dt * 0.8);

      // deferred notes (the ionized electron falling home)
      for (let i = pendingNotes.length - 1; i >= 0; i--) {
        if (now >= pendingNotes[i].at) {
          note(pendingNotes[i].midi, pendingNotes[i].ms);
          pendingNotes.splice(i, 1);
        }
      }

      const audioT = (() => { try { return audio().getAudioTime(); } catch { return null; } })();
      const bt = audioT != null ? audioT : now / 1000;
      const breath = bt * Math.PI * 2 * 0.14;

      // atoms: growth, excitation decay, drift, bonds as soft springs
      const byId = new Map(atoms.map((a) => [a.id, a]));
      for (const b of bonds) {
        const pa = byId.get(b.aId);
        const pb = byId.get(b.bId);
        if (!pa || !pb || pa.retiringAt || pb.retiringAt) continue;
        if (pa.sr <= 0 || pb.sr <= 0) continue; // not drawn yet: no geometry to spring against
        const cb = covalentBond(pa.seed, pb.seed);
        const rest = (pa.sr + pb.sr) * cb.rest;
        const dx = pb.sx - pa.sx;
        const dy = pb.sy - pa.sy;
        const d = Math.max(1, Math.hypot(dx, dy));
        const err = (d - rest) / Math.max(1, rest);
        const k = err * 16;
        pa.pushX += (dx / d) * k;
        pa.pushY += (dy / d) * k;
        pb.pushX -= (dx / d) * k;
        pb.pushY -= (dy / d) * k;
      }
      for (let i = atoms.length - 1; i >= 0; i--) {
        const a = atoms[i];
        if (a.retiringAt && now - a.retiringAt > RETIRE_MS) { atoms.splice(i, 1); dirty = true; continue; }
        if (!a.closed) growAtom(a, dt * 0.45);
        a.dim = Math.max(0, a.dim - dt * 0.9);
        a.precessBoost *= Math.exp(-dt * 0.8);
        if (!hold.atomId || hold.atomId !== a.id) {
          if (kbAtomId !== a.id && hold.partnerId !== a.id) a.charge = Math.max(0, a.charge - dt * 1.6);
        }
        // excitation decays back after a beat: falling note + photon streak
        if (a.excite && !a.excite.decayed && now - a.excite.born >= EXCITE_MS * 0.72) {
          a.excite.decayed = true;
          const jump = a.excite.ring - a.morph.shells;
          note(midiOf(a.morph) - 2, 200);
          const ang = twinkleHash(a.seed + Math.floor(now / 100)) * Math.PI * 2;
          photonStreak(a, ang, 150 + jump * 60, "#F2C56B");
          try { haptics.tap(); } catch { /* noop */ }
        }
        if (a.excite && now - a.excite.born > EXCITE_MS) a.excite = null;
        if (!reduce) {
          const d = a.morph.drift;
          const wx = Math.sin(localT * d.rate + d.ax) * 0.0028;
          const wy = Math.cos(localT * d.rate * 0.8 + d.ay) * 0.0024;
          const vx = wx + (a.pushX + windX * 26) / Math.max(1, width);
          const vy = wy + (a.pushY + windY * 26) / Math.max(1, height);
          a.nx = clamp(a.nx + vx * dt * timeScale, 0.08, 0.92);
          a.ny = clamp(a.ny + vy * dt * timeScale, 0.09, 0.92);
          a.pushX *= Math.exp(-dt * 2.2);
          a.pushY *= Math.exp(-dt * 2.2);
        }
      }

      // background — the vacuum after dark; the lens deepens it to slate
      const bgTop = mixHex("#0a0c11", "#111319", lens);
      const bgMid = mixHex("#0c0e14", "#151721", lens);
      const bgLow = mixHex("#0e0f13", "#13141c", lens);
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, bgTop);
      bg.addColorStop(0.55, bgMid);
      bg.addColorStop(1, bgLow);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      // the candle far above the vacuum: a faint warm presence
      const glowPulse = reduce ? 0.05 : 0.045 + Math.sin(breath) * 0.02;
      const glow = ctx.createRadialGradient(width * 0.5, height * 0.4, 10, width * 0.5, height * 0.4, Math.max(width, height) * 0.8);
      glow.addColorStop(0, `rgba(231, 172, 82, ${glowPulse + lens * 0.03})`);
      glow.addColorStop(0.55, "rgba(200, 115, 42, 0.028)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // vacuum motes — the faint noise floor of the field
      ctx.save();
      ctx.globalCompositeOperation = lens > 0.5 ? "source-over" : "screen";
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        if (!reduce) {
          const jx = Math.sin(localT * (0.8 + twinkleHash(i + 53) * 1.4) + twinkleHash(i + 11) * 6.28) * 4;
          const jy = Math.cos(localT * (0.7 + twinkleHash(i + 97) * 1.5) + twinkleHash(i + 5) * 6.28) * 4;
          m.vx += (jx - m.vx) * dt * 2 + windX * 110 * dt;
          m.vy += (jy - m.vy) * dt * 2 + windY * 110 * dt;
          m.x += m.vx * dt * timeScale;
          m.y += m.vy * dt * timeScale;
          m.vx *= Math.exp(-dt * 1.1);
          m.vy *= Math.exp(-dt * 1.1);
          if (m.x < -8) m.x += width + 16;
          if (m.x > width + 8) m.x -= width + 16;
          if (m.y < -8) m.y += height + 16;
          if (m.y > height + 8) m.y -= height + 16;
        }
        const tw = reduce ? 0.1 : 0.06 + Math.sin(localT * 0.6 + i) * 0.05;
        ctx.fillStyle = colorAlpha(i % 7 === 0 ? "#E7AC52" : "#CFC2A6", Math.max(0.02, tw));
        ctx.beginPath();
        ctx.arc(m.x, m.y, 0.4 + twinkleHash(i + 411) * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // bonds beneath, then atoms by size (small behind, large in front)
      drawBonds(localT);
      const sorted = [...atoms].sort((a, b) => a.morph.radius - b.morph.radius);
      for (const a of sorted) drawAtom(a, localT, breath);

      // specks (bursts and photon streaks)
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = specks.length - 1; i >= 0; i--) {
        const s = specks[i];
        const age = (now - s.born) / s.life;
        if (age >= 1) { specks.splice(i, 1); continue; }
        if (!reduce) {
          s.x += s.vx * dt * timeScale;
          s.y += s.vy * dt * timeScale;
          s.vx *= 1 - dt * (s.streak ? 0.4 : 1.2);
          s.vy *= 1 - dt * (s.streak ? 0.4 : 1.2);
        }
        if (s.streak) {
          // a photon is a line of light, not a point
          const lenS = Math.max(4, Math.hypot(s.vx, s.vy) * 0.06);
          const ang = Math.atan2(s.vy, s.vx);
          ctx.strokeStyle = colorAlpha(s.color, (1 - age) * 0.7);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(s.x - Math.cos(ang) * lenS, s.y - Math.sin(ang) * lenS);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        } else {
          ctx.fillStyle = colorAlpha(s.color, (1 - age) * 0.6);
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * (1 + age * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      // glimmer — after quiet, a ring where a dwell would land (never text)
      const idleMs = now - lastInteractionAt;
      if (idleMs > 20000) {
        const slot = Math.floor(now / 9000);
        const gx = (0.25 + twinkleHash(slot) * 0.5) * width;
        const gy = (0.25 + twinkleHash(slot + 7) * 0.5) * height;
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
      wrap.removeEventListener("keyup", onKeyUp);
      wrap.removeEventListener("focus", onFocus);
      wrap.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener?.("change", onMq);
      save(true);
    };
  }, []);

  return (
    <div className="atoms-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={wrapRef}
        className="atoms-field"
        role="application"
        tabIndex={0}
        aria-label="a vacuum where probability keeps watch — touch and an electron climbs, rest a finger and an atom gathers; hold where two clouds drift near and they share a bond; arrows walk, enter excites and, held beside a neighbor, joins"
      >
        <canvas ref={canvasRef} className="atoms-canvas" aria-hidden="true" />
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .atoms-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          background: #0a0c11;
          overflow: hidden;
        }

        .atoms-field {
          position: relative;
          min-height: 100svh;
          isolation: isolate;
          overflow: hidden;
          outline: none;
        }

        .atoms-field:focus-visible {
          outline: 2px solid rgba(231, 172, 82, 0.7);
          outline-offset: -2px;
        }

        body:has(.atoms-page) {
          overflow: hidden;
          background: #0a0c11;
        }

        body:has(.atoms-page) header:not(.oda-site-header) {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.atoms-page) .oda-field-watch,
        body:has(.atoms-page) .oda-candle-mark,
        body:has(.atoms-page) .oda-tape-shell,
        body:has(.atoms-page) .oda-sound-toggle {
          display: none !important;
        }

        .atoms-canvas {
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
