"use client";

/**
 * /organics — what carbon does when it has time. The organic-molecules
 * band at ~10⁻⁸·⁵ m, between the solvent below and the helix above
 * (docs/plans/life-and-vista-bands.md §2).
 *
 * A warm solvent holding loose carbon, nitrogen and oxygen, and the chains
 * a hand has talked them into. The invariant is the molecular graph
 * (src/lib/organic.ts); the load-bearing map is STRAIN → BEAT. A chain
 * held at the wrong angle beats — two voices a few hertz apart — and the
 * beating slows and stops as the geometry relaxes onto the tetrahedral
 * angle. The room is in tune exactly when its molecules are at their
 * minimum, and the map runs backwards (strainFromBeat), so hearing the
 * beat rate is reading the geometry.
 *
 * Alive at rest: the solvent streams, the chains jitter and relax, the
 * whole field breathes on the shared 7s clock. A tap is a thermal kick and
 * the beating starts again. Dragging a loose atom onto a chain end bonds it
 * where valence allows — a felt click, refused firmly where it does not.
 * Dwelling on open solvent condenses a new chain bond by bond. Dwelling ON
 * a chain is folding time: the long-press IS the fold, extended → nucleated
 * → folded, and at the ceremony tier the chain locks into a coil — which is
 * the handoff, because a coiled backbone is what the ladder above is made
 * of. Twist raises the lens to skeletal notation (the one lettered surface,
 * where the compounds a hand has actually built are named). Three fingers
 * touch the world-law: drag is warmth, hold dilates the clock, tap is the
 * tutti. Tilt runs a current; shake is a thermal scatter; a knock spikes it.
 *
 * The field persists in `objetdart:organics:v1`, capped and retired oldest
 * first, with the quiet clear at the bottom. Pinch is deliberately unbound —
 * ScaleTravel owns it, so pinching travels the axis (dna above, molecules
 * below).
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import LetGo from "@/components/LetGo";
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";
import {
  BEAT_MAX_HZ,
  COVALENCE,
  GROUPS,
  MAX_CHAINS,
  TARGETS,
  backbonePoints,
  beatHz,
  chainFormula,
  chainFromSeed,
  chainFromTarget,
  chainHz,
  canAccept,
  foldPhase,
  foldStage,
  hashSeed,
  mulberry32,
  recognize,
  relaxChain,
  settlePopulation,
  strainEnergy,
  type Chain,
  type GroupKey,
  type OrganicElement,
  type TargetKey,
} from "@/lib/organic";

const STORE_KEY = "objetdart:organics:v1";
const SOLVENT_MOTES = 90;
const MAX_LOOSE = 9;
/** Below this the ear calls it tuned and the room stops beating. */
const IN_TUNE = 0.02;

type Placed = {
  /** normalized field position */
  nx: number;
  ny: number;
  seed: number;
  target: TargetKey;
  chain: Chain;
  /** slow tumble */
  spin: number;
  spinVel: number;
  /** drift velocity, normalized units/second */
  vx: number;
  vy: number;
  /** ms of hold accumulated against this chain */
  heldMs: number;
  /** 0..1 flash when a bond lands or the fold locks */
  lit: number;
};

type Loose = {
  el: OrganicElement;
  nx: number;
  ny: number;
  vx: number;
  vy: number;
  seed: number;
  /** groups already hung on it — a loose atom is not bare */
  subs: GroupKey[];
};

type Stored = {
  chains: { seed: number; target: TargetKey; nx: number; ny: number; fold: number }[];
  /** a deliberate clearing is a remembered state — starters never come back */
  cleared?: boolean;
};

/** What the solvent has already made by the time anyone arrives. */
const STARTERS: { target: TargetKey; nx: number; ny: number }[] = [
  { target: "hexane", nx: 0.31, ny: 0.38 },
  { target: "glycine", nx: 0.68, ny: 0.6 },
];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

const ELEMENT_TINT: Record<OrganicElement, string> = {
  C: "222, 214, 196",
  N: "150, 178, 226",
  O: "218, 132, 108",
};

const GROUP_TINT: Record<GroupKey, string> = {
  H: "236, 232, 220",
  OH: "218, 132, 108",
  NH2: "150, 178, 226",
  CH3: "222, 214, 196",
  O: "218, 132, 108",
};

/** Skeletal letters — notation only, and only when the lens is raised. */
const GROUP_LABEL: Record<GroupKey, string> = {
  H: "H",
  OH: "OH",
  NH2: "NH₂",
  CH3: "CH₃",
  O: "O",
};

export default function OrganicsField() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const placedRef = useRef<Placed[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const audio = getFieldAudio();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;
    const onMq = () => {
      reduced = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    // ——— field state ———
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let last = performance.now();
    let localT = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    /** the world-law knob: heat holds every chain off its floor */
    let warmth = 0;
    let warmthTarget = 0;
    let current = 0; // solvent lean from tilt / drag
    let currentTarget = 0;
    let vortex = 0;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let glimmerIdx = 0;
    let selIdx = -1;
    let kbCharge = 0;
    let lastBeatAt = 0;
    let dragging = -1; // index into loose
    let condensing: { nx: number; ny: number; bonds: number } | null = null;
    let holdIdx = -1;
    let holdDone = false;
    let holdWasSealed = false; // ceremony on an already-folded chain dissolves it
    let leaving = 0; // the exhale of a let-go

    // ————— performance contract —————
    const gov = createFrameGovernor();
    let sleeping = false;
    const offVis = onVisibility((hidden) => { sleeping = hidden; });

    // three-finger twist = season: the solvent's own slow cycle
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
    // with drawImage every frame; never a createRadialGradient per loose atom
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

    const loose: Loose[] = [];
    const solvent = new Float32Array(SOLVENT_MOTES * 4); // x, y, phase, size

    const rng0 = mulberry32(hashSeed(0x0c, 0x1a, 0x7b));
    for (let i = 0; i < SOLVENT_MOTES; i++) {
      solvent[i * 4] = rng0();
      solvent[i * 4 + 1] = rng0();
      solvent[i * 4 + 2] = rng0() * Math.PI * 2;
      solvent[i * 4 + 3] = 0.4 + rng0() * 1.5;
    }

    const spawnLoose = (n: number, seedBase: number) => {
      for (let i = 0; i < n && loose.length < MAX_LOOSE; i++) {
        const rng = mulberry32(hashSeed(seedBase, i, loose.length));
        const r = rng();
        const el: OrganicElement = r < 0.62 ? "C" : r < 0.83 ? "O" : "N";
        // A loose atom arrives already wearing what it can: carbon with
        // three hydrogens has one bond left to give, and that is the bond
        // the hand spends.
        const subs: GroupKey[] = [];
        for (let k = 0; k < COVALENCE[el] - 1; k++) subs.push("H");
        loose.push({
          el,
          nx: 0.1 + rng() * 0.8,
          ny: 0.1 + rng() * 0.8,
          vx: (rng() - 0.5) * 0.012,
          vy: (rng() - 0.5) * 0.012,
          seed: hashSeed(seedBase, i, 7),
          subs,
        });
      }
    };
    spawnLoose(MAX_LOOSE, 0x51e);

    // ——— persistence ———
    const makePlaced = (
      target: TargetKey,
      seed: number,
      nx: number,
      ny: number,
      fold = 0,
    ): Placed => {
      const chain = chainFromTarget(target, seed);
      const rng = mulberry32(seed ^ 0x9e37);
      return {
        nx,
        ny,
        seed,
        target,
        chain: { ...chain, fold },
        spin: rng() * Math.PI * 2,
        spinVel: (rng() - 0.5) * 0.16,
        vx: (rng() - 0.5) * 0.008,
        vy: (rng() - 0.5) * 0.008,
        heldMs: fold > 0 ? 4000 : 0,
        lit: 0,
      };
    };

    let cleared = false;
    let visited = false;
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        visited = true;
        const parsed = JSON.parse(raw) as Stored;
        cleared = parsed.cleared === true;
        if (Array.isArray(parsed.chains)) {
          placedRef.current = settlePopulation(
            parsed.chains
              .filter((c) => TARGETS.some((t) => t.key === c.target))
              .map((c) => makePlaced(c.target, c.seed >>> 0, clamp01(c.nx), clamp01(c.ny), clamp01(c.fold))),
          );
        }
      }
    } catch {
      /* a fresh solvent */
    }
    // The solvent has been busy without us: a first visit finds chemistry
    // already standing. A deliberate clearing is remembered, and nothing
    // grows back over it.
    if (!visited && !cleared) {
      placedRef.current = STARTERS.map((s, i) =>
        makePlaced(s.target, hashSeed(0x5eed, i, s.nx * 1000), s.nx, s.ny),
      );
    }
    setHasKept(placedRef.current.length > 0);

    const save = () => {
      try {
        const payload: Stored = {
          chains: placedRef.current.map((p) => ({
            seed: p.seed,
            target: p.target,
            nx: p.nx,
            ny: p.ny,
            fold: p.chain.fold,
          })),
          cleared,
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* noop */
      }
      setHasKept(placedRef.current.length > 0);
    };
    if (!visited) save();

    // ——— sound: the interval IS the strain ———
    const soundChain = (p: Placed, gain = 1) => {
      const strain = strainEnergy(p.chain);
      const base = chainHz(p.chain);
      const beat = beatHz(strain);
      try {
        audio.playTone(base, 0.55 + gain * 0.5);
        // The second voice, detuned by exactly the beat the strain names.
        if (beat > 0.05) audio.playTone(base + beat, 0.55 + gain * 0.5);
      } catch {
        /* the sea is not awake */
      }
    };

    const kick = (p: Placed, amount: number) => {
      // A thermal kick bends the geometry: strain rises, and the beating
      // that reports it starts in the same frame as the light.
      p.chain = {
        ...p.chain,
        angles: p.chain.angles.map((a, i) => a + (i % 2 ? amount : -amount) * 0.7),
        torsions: p.chain.torsions.map((t, i) => t + (i % 2 ? -amount : amount) * 1.1),
      };
      p.spinVel += (mulberry32(p.seed + Math.round(amount * 1000))() - 0.5) * amount * 2;
      p.lit = Math.min(1, p.lit + 0.6);
      soundChain(p, amount);
    };

    // ——— geometry helpers ———
    const scaleOf = () => Math.min(width, height) * 0.072;
    const toLocal = (cx: number, cy: number) => ({
      x: clamp(cx - rectLeft, 0, width),
      y: clamp(cy - rectTop, 0, height),
    });

    const chainScreen = (p: Placed) => ({ x: p.nx * width, y: p.ny * height });

    const nearestChain = (x: number, y: number, within: number): number => {
      let best = -1;
      let bestD = within;
      for (let i = 0; i < placedRef.current.length; i++) {
        const c = chainScreen(placedRef.current[i]);
        const d = Math.hypot(x - c.x, y - c.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

    const nearestLoose = (x: number, y: number, within: number): number => {
      let best = -1;
      let bestD = within;
      for (let i = 0; i < loose.length; i++) {
        const d = Math.hypot(x - loose[i].nx * width, y - loose[i].ny * height);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

    // ——— bonding: valence decides, and the refusal is felt ———
    const tryBond = (li: number, x: number, y: number): boolean => {
      const pi = nearestChain(x, y, scaleOf() * 3.2);
      if (pi < 0) return false;
      const p = placedRef.current[pi];
      const n = p.chain.atoms.length;
      if (n >= 12) return false;
      const a = loose[li];
      // The new atom joins at an end, carrying what it already wore. It has
      // one bond free by construction; the end it lands on must too.
      const endFree = canAccept(p.chain, n - 1, "H");
      if (!endFree) {
        try {
          audio.refuse();
          haptics.chop();
        } catch {
          /* noop */
        }
        // pushed firmly away — a refusal you feel, never a message
        a.vx += (a.nx - p.nx) * 0.5;
        a.vy += (a.ny - p.ny) * 0.5;
        return false;
      }
      // The end atom spends one of its hydrogens to hold the newcomer.
      const atoms = p.chain.atoms.map((at, i) => {
        if (i !== n - 1) return at;
        const subs = [...at.subs];
        const h = subs.lastIndexOf("H");
        if (h >= 0) subs.splice(h, 1);
        return { ...at, subs };
      });
      atoms.push({ el: a.el, subs: [...a.subs] });
      const rngb = mulberry32(hashSeed(p.seed, n));
      p.chain = {
        ...p.chain,
        atoms,
        angles: [...p.chain.angles, Math.PI * 0.5 + rngb() * 0.9],
        torsions: n >= 3 ? [...p.chain.torsions, rngb() * Math.PI * 2] : p.chain.torsions,
      };
      p.lit = 1;
      loose.splice(li, 1);
      try {
        haptics.detent();
        audio.playNote(58 + n, 150);
      } catch {
        /* noop */
      }
      // If the counts now name something real, the room says so in light
      // and in a bell — never in words unless the lens is up.
      if (recognize(chainFormula(p.chain))) {
        try {
          audio.bell();
          haptics.bloom();
        } catch {
          /* noop */
        }
        p.lit = 1;
      }
      save();
      return true;
    };

    const condenseAt = (nx: number, ny: number, bonds: number) => {
      const seed = hashSeed(Math.round(nx * 8191), Math.round(ny * 4093), placedRef.current.length);
      const born = chainFromSeed(seed);
      const p = makePlaced(
        (recognize(chainFormula(born))?.key ?? "hexane") as TargetKey,
        seed,
        nx,
        ny,
      );
      void bonds;
      placedRef.current = settlePopulation([...placedRef.current, p], MAX_CHAINS);
      save();
      try {
        haptics.bloom();
        audio.spark();
      } catch {
        /* noop */
      }
      soundChain(p, 0.6);
    };

    // the raised-lens marker ScaleTravel reads before a step-back nudge
    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    const setLens = (snapped: number) => {
      if (snapped === lensSnapped) return;
      lensSnapped = snapped;
      lensTarget = snapped;
      markLens(snapped === 1);
      try {
        haptics.lens();
        if (snapped === 1) audio.chime();
        else audio.playNote(46, 160);
      } catch {
        /* noop */
      }
    };

    const tutti = () => {
      placedRef.current.forEach((p, i) => {
        window.setTimeout(() => soundChain(p, 0.4), i * 110);
      });
      try {
        haptics.ripple(0.4);
      } catch {
        /* noop */
      }
    };

    // ——— canvas ———
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = resolveDpr(gov.tier(), { embedded: isEmbeddedFrame(), reducedMotion: reduced, maxDpr: 2 });
      width = Math.max(240, r.width);
      height = Math.max(320, r.height);
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    // ——— the grammar ———
    const detachGestures = attachGestures(
      // On the CANVAS, not the wrapper (RoomTemplate §3). The engine takes
      // pointer capture on whatever it is mounted to, and the quiet clear
      // control is a DOM child of the wrapper — mounted there, the capture
      // swallowed its clicks and the control could never be pressed.
      canvas,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) {
            // step back: a raised lens lowers first; the marker clears a
            // beat later so ScaleTravel skips its nudge on this same tap
            if (lensSnapped === 1) {
              lensSnapped = 0;
              lensTarget = 0;
              window.setTimeout(() => markLens(false), 0);
              try {
                haptics.lens();
              } catch {
                /* noop */
              }
              audio.playNote(46, 160);
            }
            return;
          }
          if (e.fingers === 3) {
            tutti();
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          const pi = nearestChain(x, y, scaleOf() * 4);
          if (pi >= 0) {
            kick(placedRef.current[pi], 0.18 + e.intensity * 0.5);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          // open solvent: a thermal kick spends itself on everything nearby
          for (const p of placedRef.current) {
            const c = chainScreen(p);
            const d = Math.hypot(x - c.x, y - c.y);
            const w = Math.max(0, 1 - d / (Math.min(width, height) * 0.6));
            if (w > 0.02) kick(p, (0.06 + e.intensity * 0.16) * w);
          }
          stirTurbulence(0.06 + e.intensity * 0.1);
          try {
            audio.playNote(48 + Math.round(e.intensity * 10), 140);
            haptics.tap();
          } catch {
            /* noop */
          }
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            if (e.phase === "enter") {
              timeScaleTarget = 0.25;
              try {
                audio.playNote(26, 480);
                haptics.tap();
              } catch {
                /* noop */
              }
            }
            if (e.phase === "release") timeScaleTarget = 1;
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          if (e.phase === "enter") {
            holdIdx = nearestChain(x, y, scaleOf() * 4);
            holdDone = false;
            holdWasSealed = holdIdx >= 0 && placedRef.current[holdIdx].chain.fold >= 0.98;
            if (holdIdx < 0) {
              // dwell on open solvent always gathers something — at the
              // population cap the eldest chain gives way (settlePopulation
              // in condenseAt), never a silent refusal
              condensing = { nx: x / width, ny: y / height, bonds: 0 };
              try {
                haptics.tap();
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (e.phase === "release") {
            if (condensing && e.tier >= 2) {
              condenseAt(condensing.nx, condensing.ny, condensing.bonds);
            }
            condensing = null;
            holdIdx = -1;
            return;
          }
          // tick: duration is the axis, not a switch
          if (condensing) {
            condensing.bonds = clamp01((e.elapsed - 220) / 1400);
            const now = performance.now();
            if (now - lastBeatAt > 380 && condensing.bonds > 0.05) {
              lastBeatAt = now;
              try {
                audio.playNote(50 + Math.round(condensing.bonds * 14), 110);
                haptics.tap();
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (holdIdx < 0 || holdIdx >= placedRef.current.length) return;
          const p = placedRef.current[holdIdx];
          // THE LONG-PRESS IS THE FOLDING TIME.
          p.heldMs = e.elapsed;
          p.chain = { ...p.chain, fold: foldPhase(e.elapsed) };
          const now = performance.now();
          if (now - lastBeatAt > 420) {
            lastBeatAt = now;
            soundChain(p, 0.3 + p.chain.fold * 0.5);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
          if (e.tier >= 3 && !holdDone) {
            holdDone = true;
            if (holdWasSealed) {
              // the solemn act, held past its lock a second time: the coil
              // that was already sealed comes apart — the touch-reachable
              // delete, symmetric with the seal it follows
              placedRef.current = placedRef.current.filter((q) => q !== p);
              holdIdx = -1;
              try {
                audio.thud();
                haptics.roll();
              } catch {
                /* noop */
              }
            } else {
              // ceremony: the coil locks, and the strain floor with it
              p.lit = 1;
              try {
                audio.bell();
                haptics.bloom();
              } catch {
                /* noop */
              }
            }
            save();
          }
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          const { x, y } = toLocal(e.x, e.y);
          if (e.fingers === 3) {
            // the world-law: warmth. Heat holds every chain off its floor.
            warmthTarget = clamp01(warmthTarget + e.dx * 0.0022);
            currentTarget = clamp(currentTarget + e.dy * 0.0009, -1, 1);
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "start") {
            dragging = nearestLoose(x, y, scaleOf() * 2.4);
            if (dragging >= 0) {
              try {
                haptics.tap();
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (e.phase === "end") {
            if (dragging >= 0 && dragging < loose.length) {
              if (!tryBond(dragging, x, y)) {
                loose[dragging].vx = e.vx * 0.0006;
                loose[dragging].vy = e.vy * 0.0006;
              }
            }
            dragging = -1;
            return;
          }
          if (dragging >= 0 && dragging < loose.length) {
            loose[dragging].nx = clamp01(x / width);
            loose[dragging].ny = clamp01(y / height);
            loose[dragging].vx = 0;
            loose[dragging].vy = 0;
            return;
          }
          // no atom in hand: the hand is a current in the solvent
          currentTarget = clamp(currentTarget + e.dx * 0.0012, -1, 1);
          vortex = Math.min(1, vortex + Math.abs(e.dx + e.dy) * 0.0022);
          stirTurbulence(0.01);
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          const { x, y } = toLocal(e.x, e.y);
          const pi = nearestChain(x, y, scaleOf() * 5);
          if (pi < 0) return;
          const p = placedRef.current[pi];
          const speed = clamp(e.speed / 2200, 0.1, 1);
          p.vx += Math.cos(e.angle) * speed * 0.5;
          p.vy += Math.sin(e.angle) * speed * 0.5;
          p.spinVel += (Math.cos(e.angle) > 0 ? 1 : -1) * speed * 2.2;
          kick(p, speed * 0.3);
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // three-finger twist = season: the solvent's own slow cycle,
            // never the lens
            if (e.phase === "move") {
              season = (((season + e.angle / (Math.PI * 2)) % 1) + 1) % 1;
              const now = performance.now();
              if (now - lastSeasonSoundAt > 260) {
                lastSeasonSoundAt = now;
                audio.playNote(30 + Math.round(season * 14), 180);
                try {
                  haptics.tap();
                } catch {
                  /* noop */
                }
              }
            }
            return;
          }
          if (e.phase === "move") lensTarget = clamp01(lensTarget + e.angle / 1.7);
          else if (e.phase === "end") setLens(lensTarget > 0.5 ? 1 : 0);
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
          vortex = Math.min(1, vortex + Math.abs(e.angularVelocity) * 0.06);
          currentTarget = clamp(currentTarget + e.angularVelocity * 0.02, -1, 1);
          const now = performance.now();
          if (now - lastBeatAt > 520) {
            lastBeatAt = now;
            try {
              audio.playNote(45 + Math.round(clamp(Math.abs(e.winding), 0, 5)), 150);
              haptics.ripple(0.25);
            } catch {
              /* noop */
            }
          }
        },
        rhythm: (e) => {
          // a steady hand entrains the thermal jitter to its own pulse
          if (e.stability > 0.65) {
            for (const p of placedRef.current) kick(p, 0.05);
          }
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel ———
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (reduced) {
          currentTarget = 0;
          return;
        }
        currentTarget = clamp(gamma / 34, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        for (const p of placedRef.current) kick(p, 0.2 + intensity * 0.5);
        for (const a of loose) {
          a.vx += (mulberry32(a.seed)() - 0.5) * 0.5 * intensity;
          a.vy += (mulberry32(a.seed + 1)() - 0.5) * 0.5 * intensity;
        }
        vortex = Math.min(1, vortex + intensity * 0.6);
        stirTurbulence(0.2 + intensity * 0.3);
        try {
          haptics.chop();
        } catch {
          /* noop */
        }
      },
      knock: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        // a sharp spike: the solvent rings once and every chain answers
        for (const p of placedRef.current) kick(p, 0.12 + intensity * 0.3);
        try {
          audio.thud();
          haptics.detent();
        } catch {
          /* noop */
        }
      },
      flip: ({ faceDown }) => {
        // face-down is night: the solvent cools and stills until turned back
        nightTarget = faceDown ? 1 : 0;
        lastInteractionAt = performance.now();
        if (faceDown) {
          try {
            audio.thud();
            haptics.roll();
          } catch {
            /* noop */
          }
        } else {
          try {
            audio.spark();
            haptics.bloom();
          } catch {
            /* noop */
          }
        }
      },
    });

    // ——— keyboard ———
    const onKeyDown = (ev: KeyboardEvent) => {
      const list = placedRef.current;
      if (ev.key === "Escape") {
        if (lensSnapped === 1) setLens(0);
        selIdx = -1;
        kbCharge = 0;
        return;
      }
      if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (list.length === 0) {
          condenseAt(0.5, 0.5, 1);
          return;
        }
        selIdx = (selIdx + 1) % list.length;
        kbCharge = 0;
        soundChain(list[selIdx], 0.4);
        return;
      }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (list.length === 0) return;
        selIdx = (selIdx <= 0 ? list.length : selIdx) - 1;
        kbCharge = 0;
        soundChain(list[selIdx], 0.4);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (list.length === 0) {
          condenseAt(0.5, 0.5, 1);
          return;
        }
        if (selIdx < 0) selIdx = 0;
        if (!ev.repeat) {
          kick(list[selIdx], 0.3);
          kbCharge = 0.04;
          return;
        }
        // held Enter is the keyboard's folding time — the same slow road
        kbCharge = clamp01(kbCharge + 0.05);
        const p = list[selIdx];
        p.chain = { ...p.chain, fold: kbCharge };
        p.heldMs = kbCharge * 8000;
        if (kbCharge >= 1) {
          kbCharge = 0;
          p.lit = 1;
          try {
            audio.bell();
            haptics.bloom();
          } catch {
            /* noop */
          }
          save();
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") kbCharge = 0;
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);

    // ——— the loop ———
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tier = gov.beginFrame(now);
      if (sleeping) return; // no draw while the document is hidden
      const detail = detailForTier(tier);
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduced) localT += dt * timeScale;
      warmth += (warmthTarget - warmth) * Math.min(1, dt * 2);
      current += (currentTarget - current) * Math.min(1, dt * 2.4);
      vortex *= Math.exp(-dt * 0.9);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      night += (nightTarget - night) * Math.min(1, dt * (nightTarget > night ? 1.6 : 2.8));
      warmthTarget *= Math.exp(-dt * 0.06); // heat leaks away on its own
      if (leaving > 0) leaving = Math.max(0, leaving - dt * 0.6);
      // two-finger pan: the frame eases toward the hand's nudge, then home
      panX += (panTargetX - panX) * Math.min(1, dt * 5);
      panY += (panTargetY - panY) * Math.min(1, dt * 5);
      canvas.style.transform = (Math.abs(panX) > 0.05 || Math.abs(panY) > 0.05)
        ? `translate(${panX.toFixed(1)}px, ${panY.toFixed(1)}px)`
        : "";

      const t = audio.getAudioTime() ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // ——— physics ———
      const list = placedRef.current;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (i !== holdIdx) {
          // the chain relaxes toward its floor; heat holds it off
          p.chain = relaxChain(p.chain, delta * timeScale, warmth);
        }
        if (!reduced) {
          p.spin += p.spinVel * dt * timeScale;
          p.spinVel *= Math.exp(-dt * 0.7);
          p.spinVel += Math.sin(localT * 0.4 + p.seed % 7) * 0.02 * dt;
          p.nx += (p.vx + current * 0.05 + Math.sin(localT * 0.3 + p.seed % 5) * 0.006) * dt;
          p.ny += (p.vy + Math.cos(localT * 0.22 + p.seed % 3) * 0.005) * dt;
          p.vx *= Math.exp(-dt * 1.1);
          p.vy *= Math.exp(-dt * 1.1);
          if (p.nx < 0.08 || p.nx > 0.92) p.vx = -p.vx * 0.7;
          if (p.ny < 0.1 || p.ny > 0.9) p.vy = -p.vy * 0.7;
          p.nx = clamp(p.nx, 0.07, 0.93);
          p.ny = clamp(p.ny, 0.09, 0.91);
        }
        p.lit = Math.max(0, p.lit - dt * 1.4);
      }
      for (const a of loose) {
        if (reduced) break;
        a.nx += (a.vx + current * 0.04) * dt;
        a.ny += a.vy * dt;
        a.vx *= Math.exp(-dt * 1.3);
        a.vy *= Math.exp(-dt * 1.3);
        if (a.nx < 0.05 || a.nx > 0.95) a.vx = -a.vx * 0.8;
        if (a.ny < 0.06 || a.ny > 0.94) a.vy = -a.vy * 0.8;
        a.nx = clamp(a.nx, 0.04, 0.96);
        a.ny = clamp(a.ny, 0.05, 0.95);
      }
      // the solvent keeps its stock of loose atoms — the room is never empty.
      // MAX_LOOSE is a fixed count; the frame governor scales how much of it
      // the current tier bothers keeping topped up.
      const looseFloor = Math.max(3, Math.round(MAX_LOOSE * 0.45 * detail.particles));
      if (loose.length < looseFloor) spawnLoose(2, hashSeed(Math.round(localT * 10), loose.length));

      // ——— the beating: the room's own voice, sounding only while strained
      if (now - lastBeatAt > 2600 && holdIdx < 0 && !condensing) {
        let worst = -1;
        let worstE = IN_TUNE;
        for (let i = 0; i < list.length; i++) {
          const e = strainEnergy(list[i].chain);
          if (e > worstE) {
            worstE = e;
            worst = i;
          }
        }
        if (worst >= 0) {
          lastBeatAt = now;
          soundChain(list[worst], 0.25);
        }
      }

      // ——— render ———
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      // season (three-finger twist) drifts the solvent's ambient warmth on
      // its own slow cycle, independent of the hand's own heat
      const warm = warmth * 0.5 + Math.max(0, Math.sin(season * Math.PI * 2)) * 0.12;
      bg.addColorStop(0, `rgb(${14 + warm * 26}, ${12 + warm * 8}, ${10})`);
      bg.addColorStop(0.6, `rgb(${11 + warm * 18}, ${10 + warm * 6}, ${9})`);
      bg.addColorStop(1, "rgb(8, 8, 8)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      // face-down is night: the solvent dims until the phone turns back over
      if (night > 0.01) {
        ctx.fillStyle = `rgba(4, 3, 2, ${night * 0.6})`;
        ctx.fillRect(0, 0, width, height);
      }

      // the solvent: water you can already see moving — the fixed count
      // scales with the frame governor's tier
      const solA = 0.16 * (1 - lens * 0.8);
      const activeSolvent = Math.max(12, Math.round(SOLVENT_MOTES * detail.particles));
      if (solA > 0.005) {
        for (let i = 0; i < activeSolvent; i++) {
          const ph = solvent[i * 4 + 2];
          const sx =
            (solvent[i * 4] + (reduced ? 0 : (Math.sin(localT * 0.18 + ph) * 0.03 + current * 0.05))) *
            width;
          const sy =
            (solvent[i * 4 + 1] + (reduced ? 0 : Math.cos(localT * 0.13 + ph * 1.7) * 0.025)) * height;
          const vx = vortex * Math.sin(localT * 2 + ph) * 8;
          ctx.fillStyle = `rgba(150, 176, 190, ${solA * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(ph + localT * 0.5)))})`;
          ctx.beginPath();
          ctx.arc(sx + vx, sy, solvent[i * 4 + 3] * (1 + breath * 0.2), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const S = scaleOf();

      // loose atoms
      for (let i = 0; i < loose.length; i++) {
        const a = loose[i];
        const x = a.nx * width;
        const y = a.ny * height;
        const held = i === dragging;
        const r = S * (a.el === "C" ? 0.3 : a.el === "N" ? 0.29 : 0.28) * (1 + breath * 0.05);
        if (held) {
          ctx.strokeStyle = "rgba(231, 172, 82, 0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, r + 7, 0, Math.PI * 2);
          ctx.stroke();
        }
        // the hydrogens it already wears, and the one bond still free —
        // the free one reaches further and pulses, which is the whole tell
        const tumble = localT * (0.3 + (a.seed % 7) * 0.04) + (a.seed % 13);
        const arms = a.subs.length + 1;
        for (let k = 0; k < arms; k++) {
          const free = k === arms - 1;
          const ang = (k / arms) * Math.PI * 2 + tumble;
          const len = r * (free ? 2.1 + breath * 0.4 : 1.55);
          ctx.strokeStyle = free
            ? `rgba(231, 172, 82, ${0.2 + breath * 0.18 + (held ? 0.35 : 0)})`
            : `rgba(236, 232, 220, ${0.16 + (held ? 0.2 : 0)})`;
          ctx.lineWidth = free ? 1.2 : 0.8;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
          ctx.stroke();
          if (!free) {
            ctx.fillStyle = `rgba(236, 232, 220, ${0.3 + breath * 0.1})`;
            ctx.beginPath();
            ctx.arc(x + Math.cos(ang) * len, y + Math.sin(ang) * len, r * 0.24, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // a cached sprite per element+held state, stamped with drawImage —
        // never a createRadialGradient inside the per-atom loop
        stampSprite(
          `org-loose-halo-${a.el}-${held ? 1 : 0}`,
          [
            [0, `rgba(${ELEMENT_TINT[a.el]}, ${0.2 + (held ? 0.2 : 0)})`],
            [1, `rgba(${ELEMENT_TINT[a.el]}, 0)`],
          ],
          x, y, r * 2.2,
          1,
        );
        ctx.fillStyle = `rgba(${ELEMENT_TINT[a.el]}, ${0.6 + (held ? 0.3 : 0.1) + breath * 0.06})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (lens > 0.1) {
          ctx.globalAlpha = lens;
          ctx.fillStyle = "rgba(238, 234, 219, 0.8)";
          ctx.font = "300 11px ui-monospace, 'SF Mono', Menlo, monospace";
          ctx.textAlign = "center";
          ctx.fillText(a.el, x, y + 4);
          ctx.globalAlpha = 1;
        }
      }

      // the chains
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const c = chainScreen(p);
        const strain = strainEnergy(p.chain);
        const beat = beatHz(strain);
        const tense = clamp01(beat / BEAT_MAX_HZ);
        const pts = backbonePoints(p.chain);
        const bond = S * (1 - p.chain.fold * 0.3);
        // center the walk on the chain's own position
        let mx = 0;
        let my = 0;
        for (const q of pts) {
          mx += q.x;
          my += q.y;
        }
        mx /= pts.length;
        my /= pts.length;

        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(reduced ? 0 : p.spin);
        const alpha = 1 - leaving;

        // the strain shimmer: it beats at exactly the rate you hear
        if (tense > 0.02) {
          const beatPhase = 0.5 + 0.5 * Math.sin(localT * Math.PI * 2 * beat);
          ctx.strokeStyle = `rgba(231, 172, 82, ${tense * 0.35 * beatPhase * alpha})`;
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          for (let k = 0; k < pts.length; k++) {
            const x = (pts[k].x - mx) * bond;
            const y = (pts[k].y - my) * bond;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        // the backbone
        ctx.strokeStyle = `rgba(214, 222, 216, ${(0.58 + p.lit * 0.35) * alpha * (1 - lens * 0.3)})`;
        ctx.lineWidth = lens > 0.5 ? 1 : 1.6;
        ctx.beginPath();
        for (let k = 0; k < pts.length; k++) {
          const x = (pts[k].x - mx) * bond;
          const y = (pts[k].y - my) * bond;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // atoms and their groups
        for (let k = 0; k < pts.length; k++) {
          const at = p.chain.atoms[k];
          if (!at) continue;
          const x = (pts[k].x - mx) * bond;
          const y = (pts[k].y - my) * bond;
          const subs = at.subs;
          for (let m = 0; m < subs.length; m++) {
            const ang = (m / Math.max(1, subs.length)) * Math.PI * 2 + k * 1.1 + localT * 0.08;
            const len = bond * (GROUPS[subs[m]].bonds === 2 ? 0.42 : 0.5);
            const gx = x + Math.cos(ang) * len;
            const gy = y + Math.sin(ang) * len;
            ctx.strokeStyle = `rgba(${GROUP_TINT[subs[m]]}, ${0.2 * alpha})`;
            ctx.lineWidth = GROUPS[subs[m]].bonds === 2 ? 2 : 0.8;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(gx, gy);
            ctx.stroke();
            if (lens > 0.4 && subs[m] !== "H") {
              ctx.globalAlpha = (lens - 0.4) / 0.6;
              ctx.fillStyle = `rgba(${GROUP_TINT[subs[m]]}, 0.9)`;
              ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
              ctx.textAlign = "center";
              ctx.fillText(GROUP_LABEL[subs[m]], gx, gy + 3);
              ctx.globalAlpha = 1;
            } else if (lens < 0.6) {
              ctx.fillStyle = `rgba(${GROUP_TINT[subs[m]]}, ${(0.35 + breath * 0.1) * alpha * (1 - lens)})`;
              ctx.beginPath();
              ctx.arc(gx, gy, bond * 0.11, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          const rr = bond * 0.2 * (1 + breath * 0.06 + p.lit * 0.4);
          ctx.fillStyle = `rgba(${ELEMENT_TINT[at.el]}, ${(0.72 + p.lit * 0.28) * alpha * (1 - lens * 0.55)})`;
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, Math.PI * 2);
          ctx.fill();
          if (lens > 0.4 && at.el !== "C") {
            ctx.globalAlpha = (lens - 0.4) / 0.6;
            ctx.fillStyle = "rgba(238, 234, 219, 0.9)";
            ctx.font = "300 11px ui-monospace, 'SF Mono', Menlo, monospace";
            ctx.textAlign = "center";
            ctx.fillText(at.el, x, y + 4);
            ctx.globalAlpha = 1;
          }
        }
        ctx.restore();

        // the fold's own ring: how far the coil has come
        if (p.chain.fold > 0.02) {
          const stage = foldStage(p.chain.fold);
          ctx.strokeStyle = `rgba(231, 172, 82, ${(0.12 + p.chain.fold * 0.35) * alpha})`;
          ctx.lineWidth = stage === "folded" ? 1.6 : 1;
          ctx.beginPath();
          ctx.arc(c.x, c.y, S * (2.6 - p.chain.fold * 0.7), -Math.PI / 2, -Math.PI / 2 + p.chain.fold * Math.PI * 2);
          ctx.stroke();
        }
        // selection ring, keyboard's own
        if (selIdx === i) {
          ctx.strokeStyle = "rgba(242, 238, 230, 0.6)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(c.x, c.y, S * 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        // the name, only where notation lives
        if (lens > 0.55) {
          const named = recognize(chainFormula(p.chain));
          ctx.globalAlpha = (lens - 0.55) / 0.45;
          ctx.font = "300 11px ui-monospace, 'SF Mono', Menlo, monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(206, 222, 250, 0.75)";
          const f = chainFormula(p.chain);
          const parts = [
            f.C ? `C${f.C}` : "",
            f.H ? `H${f.H}` : "",
            f.N ? `N${f.N}` : "",
            f.O ? `O${f.O}` : "",
          ].join("");
          ctx.fillText(named ? named.label : parts, c.x, c.y + S * 3.4);
          ctx.globalAlpha = 1;
        }
      }

      // the condensing dwell: bonds closing under the finger
      if (condensing) {
        const x = condensing.nx * width;
        const y = condensing.ny * height;
        const u = condensing.bonds;
        ctx.strokeStyle = `rgba(231, 172, 82, ${0.2 + u * 0.5})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, S * (1.4 + u * 1.1), -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2);
        ctx.stroke();
        for (let k = 0; k < 6; k++) {
          if (k / 6 > u) break;
          const ang = (k / 6) * Math.PI * 2 + localT * 0.3;
          ctx.fillStyle = `rgba(222, 214, 196, ${0.3 + u * 0.5})`;
          ctx.beginPath();
          ctx.arc(x + Math.cos(ang) * S * u * 1.3, y + Math.sin(ang) * S * u * 1.3, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ——— glimmer: after ~20s idle, one loose atom drifts a little closer
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 6000 && !reduced && loose.length > 0) {
        glimmerAt = now;
        glimmerIdx = (glimmerIdx + 1) % loose.length;
        const a = loose[glimmerIdx];
        if (list.length > 0) {
          const target = list[glimmerIdx % list.length];
          a.vx += (target.nx - a.nx) * 0.35;
          a.vy += (target.ny - a.ny) * 0.35;
        }
      }
      if (glimmerAt && now - glimmerAt < 1500 && loose.length > glimmerIdx) {
        const u = (now - glimmerAt) / 1500;
        const a = loose[glimmerIdx];
        ctx.strokeStyle = `rgba(238, 234, 219, ${0.2 * (1 - u)})`;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(a.nx * width, a.ny * height, S * 0.6 + u * 26, 0, Math.PI * 2);
        ctx.stroke();
      }

      // the warmth of the world, felt at the edge and nowhere written
      if (warmth > 0.03) {
        const g = ctx.createRadialGradient(width / 2, height, 10, width / 2, height, height * 1.1);
        g.addColorStop(0, `rgba(200, 92, 40, ${warmth * 0.13})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      detachGestures();
      detachVessel();
      offVis();
      markLens(false);
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      mq.removeEventListener?.("change", onMq);
      cancelAnimationFrame(raf);
    };
  }, []);

  const letGo = () => {
    // an exhale, not a blink: the chains come apart over a breath and the
    // storage is written empty at once
    const list = placedRef.current;
    let i = list.length;
    const step = () => {
      i -= 1;
      if (i < 0) return;
      placedRef.current = list.slice(0, i);
      window.setTimeout(step, 220);
    };
    window.setTimeout(step, 60);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ chains: [], cleared: true }));
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
      aria-label="a solvent where carbon learns to chain"
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0a0a",
        outline: "none",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <LetGo label="let the solution go" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
