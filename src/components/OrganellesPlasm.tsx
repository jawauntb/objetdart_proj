"use client";

/**
 * /organelles — the organs before the body. The organelles band at
 * ~10⁻⁶·⁵ m, between the helix below and the whole cell above
 * (docs/plans/life-and-vista-bands.md §2).
 *
 * The invariant is a MEMBRANE BUDGET (src/lib/membrane.ts). Every organelle
 * is surface area folded into a volume, and the plasm holds a fixed amount
 * of it: draw membrane into one organ and the others visibly smooth to pay
 * for it. Nothing here is created or destroyed, only moved.
 *
 * The load-bearing map is folded surface → timbre. A tightly cristae-folded
 * mitochondrion rings with many partials; a smooth vesicle is one sine.
 * `foldednessFromHarmonics` reads it back, so hearing how complex a thing
 * rings IS reading how folded it is.
 *
 * Alive at rest: the cytoplasm streams, the membranes breathe on the shared
 * 7s clock and drift with the flow. Tap an organelle and it rings its own
 * timbre. Hold one and the budget flows into it while you hold — the others
 * pay, in the same frame. Circle a finger on one to wind its folds deeper,
 * the other way to let them out. Two fingers held apart on two organs draw a
 * sustained membrane tubule between them, spending no membrane at all.
 * Dwell on open plasm and the organ the cell
 * is still missing condenses there; the ghost membrane grows with the set,
 * and its well gathers organs toward the forming cell. Gather all six and
 * the cell membrane settles closed — then the plasm becomes the cell above
 * (the handoff up). Hold the nucleus to the ceremony and it opens onto the
 * helix within — the door down. Twist raises the lens to the ledger, where
 * the budget is drawn as shares of one constant total. Three fingers hold
 * the world-law: drag is the streaming rate, hold dilates the clock, tap is
 * the tutti. Tilt pours the plasm; a shake churns it; a knock rings the
 * nearest organ.
 *
 * Persists in `objetdart:organelles:v1` with the quiet clear at the bottom.
 * Pinch is unbound — ScaleTravel owns it (cells above, dna below).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier } from "@/lib/gesture/core";
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
import { centerFieldForce } from "@/lib/scene/center-field";
import {
  KIND_BASE_HZ,
  MAX_ORGANELLES,
  MEMBRANE_KINDS,
  VESICLE_AREA,
  advanceCargo,
  brightness,
  budVesicle,
  cargoDestination,
  cellWellPull,
  fissionOrganelle,
  foldedness,
  freeMembrane,
  fuseVesicle,
  harmonicsFor,
  hasFullSet,
  hashSeed,
  membraneCompleteness,
  membranePoint,
  membraneRadius,
  missingKinds,
  mulberry32,
  organelleFromSeed,
  redistribute,
  settlePopulation,
  surfaceArea,
  totalArea,
  type CargoStage,
  type MembraneKind,
  type Organelle,
} from "@/lib/membrane";

const STORE_KEY = "objetdart:organelles:v1";
const PLASM_MOTES = 120;
const SCALE_S_KEY = "objetdart:scale:s";

const KIND_TINT: Record<MembraneKind, string> = {
  mitochondrion: "226, 140, 108",
  ribosome: "231, 172, 82",
  golgi: "196, 178, 132",
  er: "134, 186, 168",
  vacuole: "150, 178, 226",
  nucleus: "206, 196, 226",
};

/** Some organs are capsules rather than spheres — the sac's own proportion. */
const ELONGATION: Record<MembraneKind, number> = {
  mitochondrion: 0.62,
  ribosome: 1,
  golgi: 0.5,
  er: 0.44,
  vacuole: 0.92,
  nucleus: 0.88,
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

type Stored = {
  organelles: { kind: MembraneKind; seed: number; folds: number; amplitude: number; radius: number; nx: number; ny: number }[];
  cleared?: boolean;
};

export default function OrganellesPlasm() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const listRef = useRef<Organelle[]>([]);
  const router = useRouter();

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

    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let last = performance.now();
    let localT = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    /** the world-law: how fast the cytoplasm streams */
    let streaming = 0.5;
    let streamingTarget = 0.5;
    let pour = 0;
    let pourTarget = 0;
    let churn = 0;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let glimmerIdx = 0;
    let selIdx = -1;
    let kbCharge = 0;
    /** two-finger frame pan — pinch stays with ScaleTravel */
    let viewX = 0;
    let viewY = 0;
    let viewTX = 0;
    let viewTY = 0;
    let lastPanCueAt = 0;
    let dragIdx = -1;
    let holdIdx = -1;
    let holdDone = false;
    let condensing: { nx: number; ny: number; u: number } | null = null;
    let lastTickAt = 0;
    let closing = 0; // the cell membrane drawing itself around the set
    let closed = false;
    /** earned this visit — restored full sets do not auto-travel */
    let earnedClose = false;
    let leaving = false;
    let leaveGlow = 0;
    let holdCeremonyDone = false; // guards the non-nucleus annihilate act
    // span: two fingers held apart draw a membrane tubule between the two
    // organs they touch — a sustained contact site, both timbres held
    // together. No membrane is spent: the ledger's total never moves.
    let spanActive = false;
    let spanA = -1;
    let spanB = -1;
    let spanElapsed = 0;
    let spanTickAt = 0;
    let lastSpanToneAt = 0;
    const lit = new Float32Array(MAX_ORGANELLES);
    const vel = new Float32Array(MAX_ORGANELLES * 2);
    // the background wash only actually changes with size or season — cache
    // it and rebuild on those, instead of a fresh CanvasGradient every frame
    let bgGradient: CanvasGradient | null = null;
    let bgGradW = -1;
    let bgGradH = -1;
    let bgGradWarm = -1;

    // ——— membrane in transit ———
    // A vesicle is membrane that has left one organ and not yet arrived at
    // another: it carries an area out of the ledger and puts exactly that
    // back where it fuses. Cargo walks the real pathway — ribosome makes it
    // raw, the er folds it, the golgi matures it, and mature cargo leaves
    // the cell at the ghost membrane.
    type Vesicle = {
      nx: number;
      ny: number;
      vx: number;
      vy: number;
      area: number;
      cargo: CargoStage;
      seed: number;
      lit: number;
      /** seconds since it budded — a vesicle that finds no station dissolves */
      age: number;
    };
    const MAX_VESICLES = 10;
    const vesicles: Vesicle[] = [];
    let vesicleCount = 0;
    /** the double-tap-on-plasm cycle */
    let plasmEventIdx = 0;
    /** an atp pulse, drawn as a ring leaving its mitochondrion */
    const pulses: { x: number; y: number; t0: number; tint: string; gain: number }[] = [];
    /** the room's own metabolism, on seeded timers with no hand present */
    let lifeCount = 0;
    let nextLifeAt = 0;
    /** the triple tap: a cascade walking the organs in pitch order */
    let cascade: { at: number; step: number; gain: number } | null = null;

    // ————— performance contract —————
    const gov = createFrameGovernor();
    let sleeping = false;
    const offVis = onVisibility((hidden) => { sleeping = hidden; });

    // three-finger twist = season: the plasm's own slow cycle
    let season = 0;
    let lastSeasonSoundAt = 0;

    // two-finger pan: the frame peeks, then eases home
    let panX = 0;
    let panY = 0;
    let panTargetX = 0;
    let panTargetY = 0;

    const plasm = new Float32Array(PLASM_MOTES * 4);
    const rngP = mulberry32(hashSeed(0x0b, 0x1e));
    for (let i = 0; i < PLASM_MOTES; i++) {
      plasm[i * 4] = rngP();
      plasm[i * 4 + 1] = rngP();
      plasm[i * 4 + 2] = rngP() * Math.PI * 2;
      plasm[i * 4 + 3] = 0.4 + rngP() * 1.4;
    }

    // ——— persistence ———
    let cleared = false;
    let visited = false;
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        visited = true;
        const parsed = JSON.parse(raw) as Stored;
        cleared = parsed.cleared === true;
        if (Array.isArray(parsed.organelles)) {
          listRef.current = settlePopulation(
            parsed.organelles
              .filter((o) => MEMBRANE_KINDS.includes(o.kind))
              .map((o) => ({
                kind: o.kind,
                seed: o.seed >>> 0,
                folds: clamp(Math.round(o.folds), 1, 24),
                amplitude: clamp(o.amplitude, 0, 3),
                radius: clamp(o.radius, 0.05, 4),
                nx: clamp01(o.nx),
                ny: clamp01(o.ny),
              })),
          );
        }
      }
    } catch {
      /* a fresh plasm */
    }
    if (listRef.current.length === 0 && !cleared) {
      // Four organs are already at work when anyone arrives; the other
      // two are what the hand is for.
      listRef.current = (["mitochondrion", "er", "ribosome", "vacuole"] as MembraneKind[]).map((k, i) =>
        organelleFromSeed(k, hashSeed(0x0a11, i)),
      );
    }
    closed = hasFullSet(listRef.current);
    closing = membraneCompleteness(listRef.current);
    setHasKept(listRef.current.length > 0);

    const save = () => {
      try {
        const payload: Stored = { organelles: listRef.current, cleared };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* noop */
      }
      setHasKept(listRef.current.length > 0);
    };
    if (!visited) save();

    // ——— sound: how folded it is, heard ———
    const ring = (i: number, gain = 1) => {
      const list = listRef.current;
      const o = list[i];
      if (!o) return;
      const base = KIND_BASE_HZ[o.kind];
      const partials = harmonicsFor(foldedness(o));
      // The partial COUNT is the timbre — a smooth sac is one sine, a
      // cristae-folded organ is a stack of them.
      const voices = Math.min(5, partials);
      for (let k = 1; k <= voices; k++) {
        const step = k === 1 ? 1 : Math.round(1 + ((partials - 1) * (k - 1)) / (voices - 1));
        try {
          audio.playTone(base * step, (0.5 + gain * 0.6) / Math.sqrt(step));
        } catch {
          /* the sea is not awake */
        }
      }
      lit[i] = 1;
    };

    const tutti = () => {
      const order = [...listRef.current.keys()].sort(
        (a, b) => KIND_BASE_HZ[listRef.current[a].kind] - KIND_BASE_HZ[listRef.current[b].kind],
      );
      order.forEach((idx, k) => window.setTimeout(() => ring(idx, 0.4), k * 150));
      try {
        haptics.ripple(0.4);
      } catch {
        /* noop */
      }
    };

    /** Draw membrane into one organ; the plasm pays for it from the rest. */
    const draw_ = (i: number, delta: number) => {
      const before = listRef.current;
      const next = redistribute(before, i, delta);
      if (next === before) return;
      listRef.current = next;
      lit[i] = Math.max(lit[i], 0.7);
      for (let k = 0; k < next.length; k++) if (k !== i) lit[k] = Math.max(lit[k], 0.25);
    };

    const condenseMissing = (nx: number, ny: number) => {
      const list = listRef.current;
      const missing = missingKinds(list);
      const kind = missing[0] ?? MEMBRANE_KINDS[list.length % MEMBRANE_KINDS.length];
      const born = organelleFromSeed(kind, hashSeed(Math.round(nx * 8191), Math.round(ny * 4093), list.length));
      const placed = { ...born, nx, ny };
      listRef.current = settlePopulation([...list, placed]);
      save();
      ring(listRef.current.length - 1, 0.7);
      try {
        haptics.bloom();
        audio.spark();
      } catch {
        /* noop */
      }
    };

    /** Membrane currently riding in vesicles — not free, not folded. */
    const inTransit = () => {
      let a = 0;
      for (const v of vesicles) a += v.area;
      return a;
    };

    /** One vesicle enters the plasm, carrying real area from somewhere. */
    const addVesicle = (nx: number, ny: number, area: number, cargo: CargoStage, seedBase: number) => {
      if (area <= 0) return;
      if (vesicles.length >= MAX_VESICLES) {
        const gone = vesicles.shift();
        // at the cap the eldest gives its membrane back to the plasm, visibly
        if (gone) pulses.push({ x: gone.nx * width, y: gone.ny * height, t0: performance.now(), tint: "150, 190, 172", gain: 0.4 });
      }
      vesicleCount += 1;
      const rng = mulberry32(hashSeed(seedBase, vesicleCount));
      const ang = rng() * Math.PI * 2;
      vesicles.push({
        nx: clamp01(nx),
        ny: clamp01(ny),
        vx: Math.cos(ang) * 0.05,
        vy: Math.sin(ang) * 0.05,
        area,
        cargo,
        seed: hashSeed(seedBase, vesicleCount, 7),
        lit: 1,
        age: 0,
      });
    };

    /**
     * An organ buds a vesicle: the membrane comes OUT of it, so the organ
     * visibly smooths in the same frame the vesicle appears. Refused when
     * the organ has nothing to spare — the ledger is the law.
     */
    const budFrom = (i: number, cargo: CargoStage): boolean => {
      const list = listRef.current;
      const o = list[i];
      if (!o) return false;
      const bud = budVesicle(o, VESICLE_AREA);
      if (!bud) return false;
      listRef.current = list.map((q, k) => (k === i ? bud.parent : q));
      addVesicle(o.nx, o.ny, bud.area, cargo, hashSeed(o.seed, i));
      lit[i] = 1;
      pulses.push({ x: o.nx * width, y: o.ny * height, t0: performance.now(), tint: KIND_TINT[o.kind], gain: 0.5 });
      try {
        audio.playNote(58 + (cargo === "raw" ? 0 : cargo === "folded" ? 4 : 7), 140);
        haptics.tap();
      } catch {
        /* noop */
      }
      save();
      return true;
    };

    /**
     * Fusion: the vesicle's membrane goes back into the target organ, its
     * cargo advances one real station, and the organ answers in its own
     * timbre. What comes out of a golgi handed folded cargo is a mature
     * granule — neither the vesicle that arrived nor the organ it met.
     */
    const fuseInto = (k: number, i: number) => {
      const v = vesicles[k];
      const list = listRef.current;
      const o = list[i];
      if (!v || !o) return;
      const next = advanceCargo(v.cargo, o.kind);
      listRef.current = list.map((q, j) => (j === i ? fuseVesicle(q, v.area) : q));
      vesicles.splice(k, 1);
      lit[i] = 1;
      pulses.push({ x: o.nx * width, y: o.ny * height, t0: performance.now(), tint: KIND_TINT[o.kind], gain: 0.8 });
      try {
        haptics.detent();
      } catch {
        /* noop */
      }
      ring(i, 0.6);
      save();
      if (next !== v.cargo) {
        // the station did its work: the parcel leaves again, changed
        window.setTimeout(() => {
          if (listRef.current[i]) budFrom(i, next);
        }, 420);
        try {
          audio.chime();
          haptics.bloom();
        } catch {
          /* noop */
        }
      }
    };

    /** Mature cargo reaching the rim is released — the cell speaks outward. */
    const exocytose = (k: number) => {
      const v = vesicles[k];
      if (!v) return;
      vesicles.splice(k, 1);
      pulses.push({ x: v.nx * width, y: v.ny * height, t0: performance.now(), tint: "242, 238, 230", gain: 1 });
      churn = Math.min(1, churn + 0.16);
      try {
        audio.spark();
        audio.playNote(72, 180);
        haptics.bloom();
      } catch {
        /* noop */
      }
    };

    /**
     * A double tap on an organ makes it do what it is for, visibly: a
     * mitochondrion large enough divides, a smaller one fires atp, and the
     * pathway organs bud the parcel they are responsible for.
     */
    const performFunction = (i: number, intensity: number) => {
      const list = listRef.current;
      const o = list[i];
      if (!o) return;
      lit[i] = 1;
      if (o.kind === "mitochondrion") {
        const pair = surfaceArea(o) > 12 ? fissionOrganelle(o) : null;
        if (pair) {
          // fission: one organ becomes two, and the membrane is halved
          const off = 0.035 + intensity * 0.02;
          listRef.current = settlePopulation([
            ...list.filter((_, k) => k !== i),
            { ...pair[0], nx: clamp01(o.nx - off), ny: clamp01(o.ny + off * 0.4) },
            { ...pair[1], nx: clamp01(o.nx + off), ny: clamp01(o.ny - off * 0.4) },
          ]);
          pulses.push({ x: o.nx * width, y: o.ny * height, t0: performance.now(), tint: KIND_TINT.mitochondrion, gain: 1 });
          try {
            audio.bell();
            haptics.bloom();
          } catch {
            /* noop */
          }
          save();
          return;
        }
        // atp: a bright pulse that visibly speeds the whole cytoplasm
        streamingTarget = clamp01(streamingTarget + 0.2 + intensity * 0.3);
        pulses.push({ x: o.nx * width, y: o.ny * height, t0: performance.now(), tint: "231, 172, 82", gain: 0.6 + intensity * 0.4 });
        ring(i, 0.8 + intensity * 0.4);
        try {
          audio.playNote(64, 200);
          haptics.roll();
        } catch {
          /* noop */
        }
        return;
      }
      if (o.kind === "ribosome") {
        // translation: a raw parcel comes off it
        if (!budFrom(i, "raw")) ring(i, 0.7);
        return;
      }
      if (o.kind === "er" || o.kind === "golgi") {
        if (!budFrom(i, o.kind === "er" ? "folded" : "mature")) ring(i, 0.7);
        return;
      }
      if (o.kind === "vacuole") {
        // it contracts, and what it held goes back to the plasm as a parcel
        if (!budFrom(i, "mature")) ring(i, 0.7);
        pulses.push({ x: o.nx * width, y: o.ny * height, t0: performance.now(), tint: KIND_TINT.vacuole, gain: 0.7 });
        return;
      }
      // the nucleus: transcription — a raw parcel leaves for the ribosomes
      if (!budFrom(i, "raw")) ring(i, 0.7);
      pulses.push({ x: o.nx * width, y: o.ny * height, t0: performance.now(), tint: KIND_TINT.nucleus, gain: 0.8 });
    };

    /**
     * A double tap on open plasm cycles the traffic in: a parcel from
     * outside, an acid vesicle for the vacuole, a folded parcel already
     * halfway down the pathway, then an atp wave through everything.
     */
    const summonTraffic = (nx: number, ny: number, intensity: number) => {
      const kind = plasmEventIdx % 5;
      plasmEventIdx += 1;
      const list = listRef.current;
      const seed = hashSeed(plasmEventIdx, Math.round(nx * 4093), Math.round(ny * 8191));
      if (kind === 0) {
        // the organ the cell is still missing condenses here — the rung's
        // own creation, kept, and the first answer of the cycle
        condenseMissing(nx, ny);
        return;
      }
      if (kind === 4) {
        // an atp wave: every mitochondrion answers, and the plasm races
        streamingTarget = clamp01(streamingTarget + 0.25 + intensity * 0.35);
        list.forEach((o, i) => {
          if (o.kind !== "mitochondrion") return;
          lit[i] = 1;
          pulses.push({ x: o.nx * width, y: o.ny * height, t0: performance.now() + i * 60, tint: "231, 172, 82", gain: 0.7 });
        });
        churn = Math.min(1, churn + 0.2 + intensity * 0.2);
        try {
          audio.playNote(60, 200);
          haptics.ripple(0.3 + intensity * 0.35);
        } catch {
          /* noop */
        }
        return;
      }
      // the parcel's membrane is drawn from what the plasm has not spent;
      // if the plasm is full, the largest organ gives it up instead
      const want = VESICLE_AREA * (0.7 + intensity * 0.6);
      const free = freeMembrane(list, inTransit());
      let area = Math.min(free, want);
      if (area < want * 0.4) {
        let big = -1;
        let bigA = 0;
        list.forEach((o, i) => {
          const a = surfaceArea(o);
          if (a > bigA) {
            bigA = a;
            big = i;
          }
        });
        if (big >= 0) {
          const bud = budVesicle(list[big], want - area);
          if (bud) {
            listRef.current = list.map((q, k) => (k === big ? bud.parent : q));
            lit[big] = 1;
            area += bud.area;
          }
        }
      }
      if (area <= 0.05) {
        churn = Math.min(1, churn + 0.2);
        try {
          audio.refuse();
          haptics.chop();
        } catch {
          /* noop */
        }
        return;
      }
      const cargo: CargoStage = kind === 1 ? "raw" : kind === 2 ? "mature" : "folded";
      addVesicle(nx, ny, area, cargo, seed);
      pulses.push({ x: nx * width, y: ny * height, t0: performance.now(), tint: "150, 190, 172", gain: 0.5 });
      try {
        audio.playNote(50 + kind * 5, 170);
        haptics.tap();
      } catch {
        /* noop */
      }
      save();
    };

    // the raised-lens marker ScaleTravel reads before a step-back nudge
    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    /**
     * Ceremony on a non-nucleus organ (tier ≥ 3) is its solemn act — and,
     * because the invariant here is a budget, the touch-reachable delete
     * that IS the act: the organ gives its whole membrane back to the plasm.
     */
    const annihilate = (i: number) => {
      const list = listRef.current;
      if (i < 0 || i >= list.length) return;
      listRef.current = list.filter((_, k) => k !== i);
      lit.fill(0);
      try {
        audio.thud();
        haptics.roll();
      } catch {
        /* noop */
      }
      save();
    };

    const setLens = (snapped: number) => {
      if (snapped === lensSnapped) return;
      lensSnapped = snapped;
      lensTarget = snapped;
      markLens(snapped === 1);
      try {
        haptics.lens();
        if (snapped === 1) audio.chime();
        else audio.playNote(44, 160);
      } catch {
        /* noop */
      }
    };

    /** The nucleus opens onto the helix within — the door down the axis. */
    const intoTheNucleus = (o: Organelle) => {
      if (leaving) return;
      leaving = true;
      try {
        haptics.crossing();
        audio.bell();
      } catch {
        /* noop */
      }
      try {
        window.sessionStorage.setItem(SCALE_S_KEY, String(-7.6));
      } catch {
        /* noop */
      }
      void o;
      window.setTimeout(() => router.push("/dna"), 420);
    };

    /**
     * The membrane has finished closing — the plasm is a cell, and the band
     * above takes it. Same scale-session handoff as the door down.
     */
    const intoTheCell = () => {
      if (leaving) return;
      leaving = true;
      leaveGlow = 1;
      try {
        haptics.crossing();
        audio.bell();
      } catch {
        /* noop */
      }
      try {
        // mid of the cells band (−5.8 … −4.4), as intoTheNucleus lands mid-dna
        window.sessionStorage.setItem(SCALE_S_KEY, String(-5.1));
      } catch {
        /* noop */
      }
      window.setTimeout(() => router.push("/cells"), 420);
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

    const unit = () => Math.min(width, height) * 0.055;
    const panLimit = () => ({
      x: Math.max(48, width * 0.28),
      y: Math.max(48, height * 0.28),
    });
    /** Screen point → plasm space (accounts for the two-finger frame pan). */
    const toLocal = (cx: number, cy: number) => ({
      x: clamp(cx - rectLeft, 0, width) - viewX,
      y: clamp(cy - rectTop, 0, height) - viewY,
    });

    const organelleAt = (x: number, y: number): number => {
      const list = listRef.current;
      let best = -1;
      let bestD = Infinity;
      const u = unit(); // does not depend on i — hoisted out of the loop
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        const d = Math.hypot(x - o.nx * width, y - o.ny * height);
        const reach = Math.max(26, o.radius * u * (1 + o.amplitude) + 12);
        if (d < reach && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

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
              audio.playNote(44, 160);
            }
            return;
          }
          if (e.fingers === 3) {
            tutti();
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          const i = organelleAt(x, y);
          // rapid-tap ladder 1 / 3 / 5 / n — counts between tiers deepen intensity
          const tier = tapTrainTier(e.count);
          const base = tier === "n" ? 7 : tier;
          const deepen = Math.min(1, (e.count - base) * 0.5);
          const amp = e.intensity * (0.75 + deepen * 0.55);
          if (tier === 1) {
            if (i >= 0) {
              selIdx = i;
              ring(i, 0.55 + amp * 0.65);
              try {
                haptics.tap();
              } catch {
                /* noop */
              }
              return;
            }
            churn = Math.min(1, churn + 0.15 + amp * 0.22);
            stirTurbulence(0.05);
            try {
              audio.playNote(41, 180);
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          if (tier === 3) {
            // The 3-rung is the room's transformation rung. On an organ: the
            // plasm feeds it membrane (the shipped meaning) and the organ
            // spends it doing what it is FOR — a mitochondrion large enough
            // divides, a smaller one fires atp, the pathway organs bud the
            // parcel they are responsible for. On open plasm: the next
            // traffic of the cycle, whose first answer is the organ the cell
            // still lacks condensing there.
            if (i >= 0) {
              selIdx = i;
              draw_(i, 0.1 + amp * 0.16 + deepen * 0.08);
              performFunction(i, e.intensity + deepen * 0.3);
              try {
                haptics.detent();
              } catch {
                /* noop */
              }
              save();
            } else {
              summonTraffic(clamp01(x / width), clamp01(y / height), e.intensity + deepen * 0.3);
            }
            return;
          }
          if (tier === 5) {
            // rupture: the organ gives its membrane back to the plasm
            if (i >= 0) {
              annihilate(i);
            } else {
              churn = Math.min(1, churn + 0.35 + deepen * 0.25);
              stirTurbulence(0.12 + deepen * 0.1);
              try {
                audio.thud();
                haptics.chop();
              } catch {
                /* noop */
              }
            }
            return;
          }
          // n: rewrite — gather every missing organ, then the whole ledger rings
          const missing = missingKinds(listRef.current);
          if (missing.length > 0) {
            const nSpawn = Math.min(missing.length, 1 + Math.round(deepen * 2));
            for (let k = 0; k < nSpawn; k++) {
              const ang = (k / Math.max(1, nSpawn)) * Math.PI * 2;
              const r = 0.08 + deepen * 0.04;
              condenseMissing(
                clamp01(x / width + Math.cos(ang) * r),
                clamp01(y / height + Math.sin(ang) * r),
              );
            }
          } else if (i >= 0) {
            draw_(i, 0.2 + deepen * 0.12);
            ring(i, 1);
            try {
              haptics.bloom();
            } catch {
              /* noop */
            }
            save();
          }
          // ...and the top rung's own act, the largest thing this room does:
          // a METABOLIC CASCADE walking the organs from the lowest voice to
          // the highest — every mitochondrion firing, every maker budding a
          // fresh parcel, and every parcel in transit lit at the close.
          cascade = { at: performance.now(), step: 0, gain: e.intensity + deepen * 0.4 };
          streamingTarget = clamp01(streamingTarget + 0.25 + e.intensity * 0.3);
          stirTurbulence(0.12 + deepen * 0.12);
          try {
            audio.bell();
            haptics.roll();
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
            holdIdx = organelleAt(x, y);
            holdDone = false;
            holdCeremonyDone = false;
            if (holdIdx < 0) {
              // dwell on open plasm always gathers something — at the
              // population cap the eldest organ gives way (settlePopulation
              // in condenseMissing), never a silent refusal
              condensing = { nx: x / width, ny: y / height, u: 0 };
            }
            return;
          }
          if (e.phase === "release") {
            if (condensing && e.tier >= 2) condenseMissing(condensing.nx, condensing.ny);
            condensing = null;
            if (holdIdx >= 0) save();
            holdIdx = -1;
            return;
          }
          if (condensing) {
            condensing.u = clamp01((e.elapsed - 220) / 1500);
            const now = performance.now();
            if (now - lastTickAt > 330 && condensing.u > 0.05) {
              lastTickAt = now;
              try {
                audio.playNote(44 + Math.round(condensing.u * 12), 110);
                haptics.tap();
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (holdIdx < 0 || holdIdx >= listRef.current.length) return;
          // The budget flows into the held organ for as long as it is held,
          // and the others pay in the same frame. Duration is the axis.
          draw_(holdIdx, 0.028 * (0.4 + e.intensity));
          const now = performance.now();
          if (now - lastTickAt > 360) {
            lastTickAt = now;
            ring(holdIdx, 0.3);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
          if (e.tier >= 3 && !holdDone && listRef.current[holdIdx].kind === "nucleus") {
            holdDone = true;
            intoTheNucleus(listRef.current[holdIdx]);
          } else if (e.tier >= 3 && !holdCeremonyDone && listRef.current[holdIdx]?.kind !== "nucleus") {
            // ceremony on any other organ is its solemn act — and the
            // touch-reachable delete: it gives its membrane back whole
            holdCeremonyDone = true;
            const doomed = holdIdx;
            holdIdx = -1;
            annihilate(doomed);
          }
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          const { x, y } = toLocal(e.x, e.y);
          if (e.fingers === 3) {
            // the world-law: how hard the cytoplasm streams
            streamingTarget = clamp01(streamingTarget + e.dx * 0.002);
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "start") {
            dragIdx = organelleAt(x, y);
            return;
          }
          if (e.phase === "end") {
            if (dragIdx >= 0) {
              vel[dragIdx * 2] = e.vx * 0.0004;
              vel[dragIdx * 2 + 1] = e.vy * 0.0004;
              save();
            }
            dragIdx = -1;
            return;
          }
          if (dragIdx >= 0 && dragIdx < listRef.current.length) {
            // Soft mid-frame well, not a 0.06/0.94 edge roost.
            const nx0 = clamp(x / width, 0.02, 0.98);
            const ny0 = clamp(y / height, 0.02, 0.98);
            const minDim = Math.max(1, Math.min(width, height));
            const aspectX = width / minDim;
            const aspectY = height / minDim;
            const pull = cellWellPull(nx0, ny0, membraneCompleteness(listRef.current), aspectX, aspectY);
            const field = centerFieldForce(nx0, ny0);
            const nx = clamp(nx0 + pull.x * pull.strength * 0.018 + field.ax * 0.01, 0.02, 0.98);
            const ny = clamp(ny0 + pull.y * pull.strength * 0.018 + field.ay * 0.01, 0.02, 0.98);
            listRef.current = listRef.current.map((q, k) =>
              k === dragIdx ? { ...q, nx, ny } : q,
            );
            // the flow drags back: a wake through the plasm
            churn = Math.min(1, churn + Math.abs(e.dx + e.dy) * 0.0016);
            return;
          }
          churn = Math.min(1, churn + Math.abs(e.dx + e.dy) * 0.0012);
          pourTarget = clamp(pourTarget + e.dx * 0.0011, -1, 1);
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          // Circling on an organ winds its folds deeper; the other way lets
          // them out — and either way the plasm keeps its total.
          const { x: sx, y: sy } = toLocal(e.cx, e.cy);
          const i = organelleAt(sx, sy);
          if (i >= 0) {
            draw_(i, clamp(e.angularVelocity, -8, 8) * 0.02);
            const now = performance.now();
            if (now - lastTickAt > 300) {
              lastTickAt = now;
              ring(i, 0.3);
              try {
                haptics.ripple(0.25);
              } catch {
                /* noop */
              }
            }
            return;
          }
          churn = Math.min(1, churn + Math.abs(e.angularVelocity) * 0.05);
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          const { x: fx, y: fy } = toLocal(e.x, e.y);
          const i = organelleAt(fx, fy);
          if (i < 0) return;
          const speed = clamp(e.speed / 2400, 0.1, 1);
          vel[i * 2] += Math.cos(e.angle) * speed * 0.4;
          vel[i * 2 + 1] += Math.sin(e.angle) * speed * 0.4;
          ring(i, speed);
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // three-finger twist = season: the plasm's own slow cycle,
            // never the lens
            if (e.phase === "move") {
              season = (((season + e.angle / (Math.PI * 2)) % 1) + 1) % 1;
              const now = performance.now();
              if (now - lastSeasonSoundAt > 260) {
                lastSeasonSoundAt = now;
                audio.playNote(34 + Math.round(season * 14), 180);
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
          lastInteractionAt = performance.now();
          if (e.phase === "end") return;
          const lim = panLimit();
          const gain = reduced ? 0.55 : 1;
          viewTX = clamp(viewTX + e.dx * gain, -lim.x, lim.x);
          viewTY = clamp(viewTY + e.dy * gain, -lim.y, lim.y);
          if (reduced) {
            viewX = viewTX;
            viewY = viewTY;
          }
          if (e.phase === "start" || performance.now() - lastPanCueAt > 280) {
            lastPanCueAt = performance.now();
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
        },
        span: (e) => {
          // two fingers held apart draw a membrane tubule between two organs:
          // a sustained contact site, both timbres held, thickening as it
          // holds — and no membrane is spent, so the budget stays exact.
          lastInteractionAt = performance.now();
          const list = listRef.current;
          if (e.phase === "release") {
            spanActive = false;
            spanA = -1;
            spanB = -1;
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          const a = toLocal(e.ax, e.ay);
          const b = toLocal(e.bx, e.by);
          if (e.phase === "enter" || spanA < 0 || spanB < 0) {
            spanA = organelleAt(a.x, a.y);
            spanB = organelleAt(b.x, b.y);
          }
          if (spanA < 0 || spanB < 0 || spanA === spanB || spanA >= list.length || spanB >= list.length) {
            spanActive = false;
            return;
          }
          spanActive = true;
          spanElapsed = e.elapsed;
          spanTickAt = performance.now();
          const deep = Math.min(1, e.elapsed / 2600);
          const now = performance.now();
          if (now - lastSpanToneAt > 340) {
            lastSpanToneAt = now;
            // the two timbres sustain together, brighter as the tubule draws
            // out — a longer hold rings louder, never the same at 900 and 2400
            ring(spanA, 0.28 + deep * 0.34);
            ring(spanB, 0.28 + deep * 0.34);
            try {
              haptics.ripple(0.14 + deep * 0.24);
            } catch {
              /* noop */
            }
          }
        },
        rhythm: (e) => {
          if (e.stability > 0.65) tutti();
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel ———
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        pourTarget = reduced ? 0 : clamp(gamma / 34, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        churn = Math.min(1, churn + 0.5 + intensity * 0.5);
        for (let i = 0; i < listRef.current.length; i++) {
          const r = mulberry32(hashSeed(i, Math.round(intensity * 1000)));
          vel[i * 2] += (r() - 0.5) * intensity * 0.6;
          vel[i * 2 + 1] += (r() - 0.5) * intensity * 0.6;
        }
        stirTurbulence(0.2 + intensity * 0.3);
        try {
          haptics.chop();
        } catch {
          /* noop */
        }
      },
      knock: () => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        if (listRef.current.length > 0) ring(0, 0.8);
        try {
          audio.thud();
          haptics.detent();
        } catch {
          /* noop */
        }
      },
      flip: ({ faceDown }) => {
        // face-down is night: the plasm's streaming stills until turned back
        timeScaleTarget = faceDown ? 0.15 : 1;
        lastInteractionAt = performance.now();
        try {
          if (faceDown) {
            audio.thud();
            haptics.roll();
          } else {
            audio.chime();
            haptics.bloom();
          }
        } catch {
          /* noop */
        }
      },
    });

    // ——— keyboard ———
    const onKeyDown = (ev: KeyboardEvent) => {
      const list = listRef.current;
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
          condenseMissing(0.5, 0.5);
          return;
        }
        selIdx = (selIdx + 1) % list.length;
        ring(selIdx, 0.4);
        return;
      }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (list.length === 0) return;
        selIdx = (selIdx <= 0 ? list.length : selIdx) - 1;
        ring(selIdx, 0.4);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (list.length === 0) {
          condenseMissing(0.5, 0.5);
          return;
        }
        if (selIdx < 0) selIdx = 0;
        if (!ev.repeat) {
          ring(selIdx, 0.8);
          kbCharge = 0.04;
          return;
        }
        kbCharge = clamp01(kbCharge + 0.05);
        draw_(selIdx, 0.05);
        if (kbCharge >= 1) {
          kbCharge = 0;
          if (list[selIdx].kind === "nucleus") intoTheNucleus(list[selIdx]);
          else {
            ring(selIdx, 1);
            try {
              haptics.bloom();
            } catch {
              /* noop */
            }
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
      streaming += (streamingTarget - streaming) * Math.min(1, dt * 2);
      pour += (pourTarget - pour) * Math.min(1, dt * 2.4);
      churn *= Math.exp(-dt * 0.9);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      if (reduced) {
        viewX = viewTX;
        viewY = viewTY;
      } else {
        viewX += (viewTX - viewX) * Math.min(1, dt * 14);
        viewY += (viewTY - viewY) * Math.min(1, dt * 14);
      }
      for (let i = 0; i < lit.length; i++) if (lit[i] > 0) lit[i] = Math.max(0, lit[i] - dt * 1.3);
      // two-finger pan: the frame eases toward the hand's nudge, then home
      panX += (panTargetX - panX) * Math.min(1, dt * 5);
      panY += (panTargetY - panY) * Math.min(1, dt * 5);
      canvas.style.transform = (Math.abs(panX) > 0.05 || Math.abs(panY) > 0.05)
        ? `translate(${panX.toFixed(1)}px, ${panY.toFixed(1)}px)`
        : "";

      const list = listRef.current;
      const t = audio.getAudioTime() ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // the cell membrane closes around a full set, of its own accord —
      // and when that ring settles, the plasm becomes the cell above
      const completeness = membraneCompleteness(list);
      const full = hasFullSet(list);
      if (full && !closed) {
        closed = true;
        earnedClose = true;
        try {
          audio.bell();
          haptics.bloom();
        } catch {
          /* noop */
        }
      }
      if (!full) {
        closed = false;
        earnedClose = false;
      }
      closing += ((closed ? 1 : completeness) - closing) * Math.min(1, dt * 1.4);
      if (leaveGlow > 0) leaveGlow = Math.max(0, leaveGlow - dt * 2.2);
      if (earnedClose && closing > 0.98 && !leaving) intoTheCell();

      // the plasm streams and carries its organs with it
      if (!reduced) {
        const minDim = Math.max(1, Math.min(width, height));
        const aspectX = width / minDim;
        const aspectY = height / minDim;
        for (let i = 0; i < list.length; i++) {
          if (i === dragIdx) continue;
          const o = list[i];
          const flow = streaming * 0.02;
          const swirl = Math.sin(localT * 0.3 + o.nx * 6) * flow + pour * 0.03;
          const drift = Math.cos(localT * 0.24 + o.ny * 5) * flow;
          const pull = cellWellPull(o.nx, o.ny, completeness, aspectX, aspectY);
          const field = centerFieldForce(o.nx, o.ny);
          vel[i * 2] += (pull.x * pull.strength * 0.1 + field.ax * 0.55) * dt;
          vel[i * 2 + 1] += (pull.y * pull.strength * 0.1 + field.ay * 0.55) * dt;
          let nx = o.nx + (vel[i * 2] + swirl) * dt;
          let ny = o.ny + (vel[i * 2 + 1] + drift) * dt;
          vel[i * 2] *= Math.exp(-dt * 1.2);
          vel[i * 2 + 1] *= Math.exp(-dt * 1.2);
          // Hard safety only — the resting law is the center field, not the rim.
          if (nx < 0.02 || nx > 0.98) vel[i * 2] = -vel[i * 2] * 0.55;
          if (ny < 0.02 || ny > 0.98) vel[i * 2 + 1] = -vel[i * 2 + 1] * 0.55;
          nx = clamp(nx, 0.02, 0.98);
          ny = clamp(ny, 0.02, 0.98);
          // mutate in place — this runs for every organelle every frame, and
          // nothing downstream compares organelle object identity, so there
          // is no need to allocate a fresh object here each tick
          o.nx = nx;
          o.ny = ny;
        }
      }

      // ——— the physics BETWEEN organs: vesicle traffic ———
      // Every parcel knows which station it needs next (membrane.cargoDestination)
      // and goes there; mature cargo makes for the rim and is released. Fusion
      // is where the room's ledger closes: the area the parcel carried goes
      // into the organ it met, in the same frame the eye and ear are told.
      {
        const cur = listRef.current;
        for (let k = vesicles.length - 1; k >= 0; k--) {
          const v = vesicles[k];
          v.lit = Math.max(0, v.lit - dt * 1.1);
          v.age += dt;
          const want = cargoDestination(v.cargo);
          let ti = -1;
          let tD = Infinity;
          if (want) {
            for (let i = 0; i < cur.length; i++) {
              if (cur[i].kind !== want) continue;
              const d = Math.hypot(cur[i].nx - v.nx, cur[i].ny - v.ny);
              if (d < tD) {
                tD = d;
                ti = i;
              }
            }
          }
          if (ti >= 0) {
            const o = cur[ti];
            const seek = Math.min(1, dt * (0.9 + streaming * 1.2));
            v.nx += (o.nx - v.nx) * seek;
            v.ny += (o.ny - v.ny) * seek;
            const reach = Math.max(0.03, (o.radius * unit() * 1.3) / Math.max(1, Math.min(width, height)));
            if (tD < reach + 0.012) {
              fuseInto(k, ti);
              continue;
            }
          } else {
            // mature cargo makes for the rim: exocytosis at the ghost membrane
            const ang = Math.atan2(v.ny - 0.5, v.nx - 0.5) || (v.seed % 628) / 100;
            const seek = Math.min(1, dt * (0.4 + streaming * 0.6));
            v.nx += (0.5 + Math.cos(ang) * 0.52 - v.nx) * seek;
            v.ny += (0.5 + Math.sin(ang) * 0.52 - v.ny) * seek;
            if (Math.hypot(v.nx - 0.5, v.ny - 0.5) > 0.46) {
              exocytose(k);
              continue;
            }
          }
          if (!reduced) {
            v.nx += v.vx * dt * (0.4 + streaming);
            v.ny += v.vy * dt * (0.4 + streaming);
            v.vx *= Math.exp(-dt * 1.4);
            v.vy *= Math.exp(-dt * 1.4);
          }
          v.nx = clamp(v.nx, 0.02, 0.98);
          v.ny = clamp(v.ny, 0.02, 0.98);
          // a parcel with nowhere to go eventually gives its membrane back
          if (v.age > 26 && ti < 0) {
            const big = cur.length > 0 ? 0 : -1;
            if (big >= 0) {
              listRef.current = listRef.current.map((q, j) => (j === big ? fuseVesicle(q, v.area) : q));
              lit[big] = Math.max(lit[big], 0.5);
            }
            vesicles.splice(k, 1);
          }
        }
      }

      // ——— the cascade: the whole cell lit, organ by organ ———
      if (cascade && now >= cascade.at) {
        const order = [...listRef.current.keys()].sort(
          (a, b) => KIND_BASE_HZ[listRef.current[b].kind] - KIND_BASE_HZ[listRef.current[a].kind],
        );
        if (cascade.step >= order.length) {
          // the last rung: everything in transit jumps a station at once
          streamingTarget = clamp01(streamingTarget + 0.2);
          churn = Math.min(1, churn + 0.3 + cascade.gain * 0.3);
          for (const v of vesicles) v.lit = 1;
          try {
            audio.bell();
            haptics.bloom();
          } catch {
            /* noop */
          }
          cascade = null;
        } else {
          const idx = order[cascade.step];
          const o = listRef.current[idx];
          if (o) {
            lit[idx] = 1;
            ring(idx, 0.4 + cascade.gain * 0.5);
            pulses.push({
              x: o.nx * width,
              y: o.ny * height,
              t0: now,
              tint: KIND_TINT[o.kind],
              gain: 0.5 + cascade.gain * 0.4,
            });
            if (o.kind === "mitochondrion") streamingTarget = clamp01(streamingTarget + 0.06);
            if (o.kind === "ribosome" || o.kind === "nucleus") budFrom(idx, "raw");
          }
          cascade.step += 1;
          cascade.at = now + 170;
        }
      }

      // ——— aliveness: the cell metabolises with nobody here ———
      if (nextLifeAt === 0) nextLifeAt = now + 5000;
      if (now >= nextLifeAt && !reduced && !cascade) {
        const rng = mulberry32(hashSeed(lifeCount, 0x0b1e));
        const roll = rng();
        lifeCount += 1;
        nextLifeAt = now + 7000 + rng() * 11000;
        const cur = listRef.current;
        if (cur.length > 0) {
          if (roll < 0.5) {
            // a station buds of its own accord, and the traffic starts
            const makers = cur
              .map((o, i) => ({ o, i }))
              .filter(({ o }) => o.kind === "ribosome" || o.kind === "nucleus" || o.kind === "er");
            if (makers.length > 0) {
              const pick = makers[Math.floor(rng() * makers.length) % makers.length];
              budFrom(pick.i, pick.o.kind === "er" ? "folded" : "raw");
            }
          } else if (roll < 0.82) {
            // a mitochondrion fires on its own — the cell's own pulse
            const mitos = cur.map((o, i) => ({ o, i })).filter(({ o }) => o.kind === "mitochondrion");
            if (mitos.length > 0) {
              const pick = mitos[Math.floor(rng() * mitos.length) % mitos.length];
              lit[pick.i] = 1;
              ring(pick.i, 0.35);
              streamingTarget = clamp01(streamingTarget + 0.1);
              pulses.push({
                x: pick.o.nx * width,
                y: pick.o.ny * height,
                t0: now,
                tint: "231, 172, 82",
                gain: 0.45,
              });
            }
          } else {
            churn = Math.min(1, churn + 0.18);
          }
        }
      }

      // ——— render ———
      // season (three-finger twist) drifts the plasm's own slow cycle, a
      // faint warmth independent of anything the hand is doing
      const seasonWarm = Math.max(0, Math.sin(season * Math.PI * 2));
      if (bgGradient === null || bgGradW !== width || bgGradH !== height || bgGradWarm !== seasonWarm) {
        bgGradient = ctx.createRadialGradient(
          width * 0.5,
          height * 0.5,
          10,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.8,
        );
        bgGradient.addColorStop(0, `rgb(${16 + seasonWarm * 5}, ${19 + seasonWarm * 2}, 18)`);
        bgGradient.addColorStop(1, "rgb(8, 10, 10)");
        bgGradW = width;
        bgGradH = height;
        bgGradWarm = seasonWarm;
      }
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, width, height);

      // the frame slides under two fingers; the dark stays put
      ctx.save();
      ctx.translate(viewX, viewY);

      // the cytoplasm, streaming
      const U = unit();
      const activePlasm = Math.max(16, Math.round(PLASM_MOTES * detail.particles));
      if (lens < 0.92) {
        for (let i = 0; i < activePlasm; i++) {
          const ph = plasm[i * 4 + 2];
          const sx =
            (plasm[i * 4] +
              (reduced
                ? 0
                : Math.sin(localT * 0.2 * (0.4 + streaming) + ph) * 0.05 * (0.4 + streaming) +
                  pour * 0.04)) *
            width;
          const sy =
            (plasm[i * 4 + 1] +
              (reduced ? 0 : Math.cos(localT * 0.16 * (0.4 + streaming) + ph * 1.6) * 0.04)) *
            height;
          const cw = churn * Math.sin(localT * 3 + ph) * 7;
          ctx.fillStyle = `rgba(150, 190, 172, ${0.16 * (1 - lens)})`;
          ctx.beginPath();
          ctx.arc(sx + cw, sy, plasm[i * 4 + 3] * (1 + breath * 0.16), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // the cell membrane ghost: one sixth of the ring for each kind present,
      // then the last sixth settles before the handoff up.
      if (closing > 0.01) {
        const r = Math.min(width, height) * 0.44;
        ctx.strokeStyle = `rgba(170, 214, 190, ${0.04 + closing * 0.3 + leaveGlow * 0.5})`;
        ctx.lineWidth = 0.7 + closing * 1.7 + leaveGlow * 1.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, r * (0.92 + breath * 0.02), -Math.PI / 2, -Math.PI / 2 + closing * Math.PI * 2);
        ctx.stroke();
        ctx.lineCap = "butt";
      }

      // the organelles
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        const cx = o.nx * width;
        const cy = o.ny * height;
        const b = brightness(o);
        const l = lit[i];
        const tint = KIND_TINT[o.kind];
        const scale = U * (1 + l * 0.06);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(reduced ? 0 : Math.sin(localT * 0.15 + (o.seed % 7)) * 0.25);
        // some organs are capsules, not spheres — the sac's own proportion
        const squash = ELONGATION[o.kind];
        ctx.scale(1, squash);

        const R = o.radius * scale;
        // The outer sac: the VOLUME. Smooth, because a mitochondrion is not
        // a star — what is folded is the membrane inside it.
        ctx.beginPath();
        ctx.arc(0, 0, R * (1.34 + breath * 0.025), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${tint}, ${0.05 + b * 0.05 + l * 0.1})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${tint}, ${0.28 + l * 0.35})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // The inner membrane: the SURFACE the budget is spent on, drawn as
        // exactly the closed parametric curve the law measures. Deeper
        // cristae are literally more line inside the same sac. Sampled via
        // membraneRadius (a number) rather than membranePoint (an object) —
        // no per-point allocation in this per-organelle-per-frame loop.
        ctx.beginPath();
        const steps = Math.max(24, Math.round(132 * detail.samples));
        for (let k = 0; k <= steps; k++) {
          const th = (k / steps) * Math.PI * 2;
          const r = membraneRadius(o, th, reduced ? 0 : breath);
          const x = Math.cos(th) * r * scale;
          const y = Math.sin(th) * r * scale;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        // brighter timbre, brighter membrane — the same number twice
        ctx.strokeStyle = `rgba(${tint}, ${0.34 + b * 0.42 + l * 0.4})`;
        ctx.lineWidth = 0.9 + b * 0.7;
        ctx.stroke();

        // what each organ holds inside that
        if (o.kind === "nucleus") {
          // the chromatin within — the door down, hinted and never labelled
          ctx.strokeStyle = `rgba(206, 196, 226, ${0.16 + l * 0.3})`;
          ctx.lineWidth = 0.7;
          for (let k = 0; k < 3; k++) {
            const a = (reduced ? 0 : localT * 0.12) + k * 2.1;
            ctx.beginPath();
            ctx.ellipse(0, 0, R * 0.52, R * 0.15, a, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (o.kind === "ribosome") {
          ctx.fillStyle = `rgba(${tint}, ${0.45 + l * 0.4})`;
          ctx.beginPath();
          ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2);
          ctx.fill();
        } else if (o.kind !== "vacuole") {
          // the cristae read as folds of that inner line, not as spokes:
          // short chords across each lobe, which is what a section shows.
          // The negated-amplitude radius is derived inline (no per-fold
          // object allocation, no per-fold membranePoint call).
          ctx.strokeStyle = `rgba(${tint}, ${0.1 + b * 0.22 + l * 0.2})`;
          ctx.lineWidth = 0.6;
          for (let k = 0; k < o.folds; k++) {
            const a = ((k + 0.5) / o.folds) * Math.PI * 2;
            const innerR = o.radius * (1 - o.amplitude * Math.sin(o.folds * a));
            const outerR = membraneRadius(o, a, 0);
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            ctx.beginPath();
            ctx.moveTo(innerR * ca * scale, innerR * sa * scale);
            ctx.lineTo(outerR * ca * scale * 0.98, outerR * sa * scale * 0.98);
            ctx.stroke();
          }
        }
        ctx.restore();

        if (selIdx === i) {
          ctx.strokeStyle = "rgba(242, 238, 230, 0.55)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, cy, o.radius * scale * (1 + o.amplitude) + 12, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (holdIdx === i && listRef.current[i]?.kind === "nucleus") {
          // the door down: the charge closing around the nucleus
          ctx.strokeStyle = "rgba(231, 172, 82, 0.6)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(cx, cy, o.radius * scale * (1 + o.amplitude) + 17, -Math.PI / 2, -Math.PI / 2 + clamp01(l) * Math.PI * 2);
          ctx.stroke();
        }
      }

      // the parcels in transit: a smooth sac (one sine, and drawn as one
      // circle), tinted by how far down the pathway its cargo has come, with
      // a thread back toward the station it is making for
      for (const v of vesicles) {
        const vx = v.nx * width;
        const vy = v.ny * height;
        const r = Math.max(2.4, Math.sqrt(Math.max(0.2, v.area)) * U * 0.34);
        const tint = v.cargo === "raw" ? "150, 178, 226" : v.cargo === "folded" ? "134, 186, 168" : "231, 172, 82";
        ctx.strokeStyle = `rgba(${tint}, ${0.3 + v.lit * 0.5})`;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(vx, vy, r * (1 + breath * 0.06), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(${tint}, ${0.08 + v.lit * 0.28})`;
        ctx.fill();
        // the cargo inside it, a mark that changes at every station
        ctx.fillStyle = `rgba(${tint}, ${0.45 + v.lit * 0.4})`;
        ctx.beginPath();
        ctx.arc(vx, vy, r * (v.cargo === "mature" ? 0.5 : v.cargo === "folded" ? 0.38 : 0.26), 0, Math.PI * 2);
        ctx.fill();
      }

      // fusions, buds and releases: one soft ring each, where it happened
      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k];
        const u = (now - p.t0) / 780;
        if (u < 0) continue;
        if (u >= 1) {
          pulses.splice(k, 1);
          continue;
        }
        ctx.strokeStyle = `rgba(${p.tint}, ${(1 - u) * 0.5 * p.gain})`;
        ctx.lineWidth = 1.3 * (1 - u) + 0.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, U * (0.5 + u * 3.6 * (0.6 + p.gain)), 0, Math.PI * 2);
        ctx.stroke();
      }

      // the span's membrane tubule: a contact site sustained between two
      // organs while the grip holds — vesicles bud along it, and it thickens
      // with duration. Drawn in the same frame-panned space as the organs.
      if (spanActive && (now - spanTickAt > 380 || spanA >= list.length || spanB >= list.length)) {
        spanActive = false;
      }
      if (spanActive && spanA >= 0 && spanB >= 0) {
        const oa = list[spanA];
        const ob = list[spanB];
        const deep = Math.min(1, spanElapsed / 2600);
        const ax = oa.nx * width;
        const ay = oa.ny * height;
        const bx = ob.nx * width;
        const by = ob.ny * height;
        ctx.strokeStyle = `rgba(170, 214, 190, ${0.2 + deep * 0.4})`;
        ctx.lineWidth = 0.8 + deep * 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.lineCap = "butt";
        const beads = 2 + Math.round(deep * 4);
        for (let k = 0; k < beads; k++) {
          const f = (now / 800 + k / beads) % 1;
          ctx.fillStyle = `rgba(231, 172, 82, ${0.28 + (1 - Math.abs(f - 0.5) * 2) * 0.4})`;
          ctx.beginPath();
          ctx.arc(ax + (bx - ax) * f, ay + (by - ay) * f, 1.2 + deep * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // the condensing dwell
      if (condensing) {
        const x = condensing.nx * width;
        const y = condensing.ny * height;
        ctx.strokeStyle = `rgba(170, 214, 190, ${0.2 + condensing.u * 0.5})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, U * (0.6 + condensing.u * 1.2), -Math.PI / 2, -Math.PI / 2 + condensing.u * Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore(); // end frame pan

      // ——— the ledger: the budget drawn as shares of one constant total
      if (lens > 0.45 && list.length > 0) {
        const la = (lens - 0.45) / 0.55;
        const total = totalArea(list);
        ctx.globalAlpha = la;
        ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
        ctx.textAlign = "left";
        const x0 = 18;
        const w = Math.min(width - 36, 260);
        let y0 = height - 42 - list.length * 15;
        ctx.fillStyle = "rgba(206, 222, 250, 0.6)";
        ctx.fillText(`membrane ${total.toFixed(1)} · ${list.length}/6 organs`, x0, y0 - 8);
        for (let i = 0; i < list.length; i++) {
          const o = list[i];
          const share = surfaceArea(o) / Math.max(1e-6, total);
          ctx.fillStyle = `rgba(${KIND_TINT[o.kind]}, ${0.35 + lit[i] * 0.4})`;
          ctx.fillRect(x0, y0, w * share, 8);
          ctx.fillStyle = "rgba(206, 222, 250, 0.55)";
          ctx.fillText(`${o.kind} ×${foldedness(o).toFixed(2)}`, x0 + w * share + 6, y0 + 8);
          y0 += 15;
        }
        ctx.globalAlpha = 1;
      }

      // ——— glimmer: after ~20s idle one organ breathes a little wider
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 6000 && !reduced && list.length > 0) {
        glimmerAt = now;
        glimmerIdx = (glimmerIdx + 1) % list.length;
        lit[glimmerIdx] = Math.max(lit[glimmerIdx], 0.35);
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
  }, [router]);

  const letGo = () => {
    // an exhale: the organs give their membrane back to the plasm one by one
    const step = () => {
      const list = listRef.current;
      if (list.length === 0) return;
      listRef.current = list.slice(0, list.length - 1);
      window.setTimeout(step, 240);
    };
    window.setTimeout(step, 60);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ organelles: [], cleared: true }));
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
      aria-label="a plasm holding the organs before the body"
      style={{
        position: "fixed",
        inset: 0,
        background: "#080a0a",
        outline: "none",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <LetGo label="let the plasm go" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
