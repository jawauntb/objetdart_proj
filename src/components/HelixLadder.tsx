"use client";

/**
 * /dna — the ladder that copies. The dna band at ~10⁻⁷·⁶ m, between the
 * organic chains below and the organelles above
 * (docs/plans/life-and-vista-bands.md §2).
 *
 * The invariant is a base sequence (src/lib/helix.ts). Everything here is
 * a representation of that one string: the helix standing in the dark, the
 * hydrogen-bond ledger you feel as resistance, the transcript, and — the
 * load-bearing one — the melody. Four bases, four scale degrees, the
 * octave carrying position along the strand, and the map runs BACKWARDS:
 * `sequenceFromMelody` returns the strand the tune came from. The strand
 * and its music are one object seen twice.
 *
 * Alive at rest: the helix turns and breathes on the shared 7s clock, the
 * weak a·t rungs shivering more than the g·c ones. One finger across the
 * helix unzips it — the hydrogen bonds break in order, each a tick you
 * hear and feel, and the resistance is the real bond count, so a gc-rich
 * stretch is genuinely harder to open. Keep that finger down while the
 * strand is open and a polymerase runs the complement, playing the tune
 * back in the mirror. Let go and it re-anneals. One finger along the helix
 * supercoils it. Two fingers held apart on two rungs hold a denaturation
 * bubble open between them — the sustained interval, re-annealing on lift.
 * Tap a rung to sound its degree. Three fingers touch the
 * world-law: drag is the mutation temperature, hold dilates the clock,
 * tap trains climb 1 / 3 / 5 / n (sound, rewrite, mutate, burst). Twist raises the lens to
 * notation — the letters, the transcript, the melting point. Tilt leans
 * the ladder; a shake is a mutation burst; a knock rings one rung. Held
 * Enter is the same road on a keyboard.
 *
 * The strand persists in `objetdart:dna:v1` with the quiet clear at the
 * bottom. Pinch is unbound — ScaleTravel owns it (organelles above,
 * organics below).
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
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";
import { clocksFrom } from "@/lib/webgl/sizing";
import {
  BASES,
  BASES_PER_TURN,
  H_BONDS,
  MAX_BASES,
  MIN_BASES,
  annealHolds,
  bestAnnealSite,
  complement,
  fragmentFrom,
  gcContent,
  hashSeed,
  hydrogenBonds,
  melodyOf,
  meltingTemp,
  mutate,
  mutationRate,
  openPairs,
  parseSequence,
  cycleBase,
  rungAt,
  sequenceFromSeed,
  settleLength,
  spliceInto,
  transcribe,
  type Base,
} from "@/lib/helix";

const STORE_KEY = "objetdart:dna:v1";
const DEFAULT_LEN = 42;
const DUST = 70;

const BASE_TINT: Record<Base, string> = {
  A: "231, 172, 82",
  T: "226, 140, 108",
  G: "134, 186, 168",
  C: "150, 178, 226",
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

type Stored = { seq: string; cleared?: boolean };

export default function HelixLadder() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const seqRef = useRef<Base[]>([]);

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
    /** 0..1 — how far the ladder has been pulled apart from the top */
    let unzip = 0;
    let unzipTarget = 0;
    /** the last rung whose bond we have already broken aloud */
    let brokenTo = 0;
    // span: two fingers held apart hold a denaturation bubble open between
    // the two base pairs they touch — a sustained interval, the two edge
    // pairs pinned by the fingers while the stretch between them melts.
    // Re-anneals when the grip lifts; the strand itself is never rewritten.
    let spanActive = false;
    let spanLo = -1;
    let spanHi = -1;
    let spanOpen = 0;
    let spanOpenTarget = 0;
    let lastSpanToneAt = 0;
    /** turns per length — a supercoiled strand is a wound spring */
    let supercoil = 1;
    let supercoilTarget = 1;
    /** the world-law: how fast the world rewrites the code */
    let temperature = 0;
    let temperatureTarget = 0;
    let mutationDebt = 0;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let lean = 0;
    let leanTarget = 0;
    let holdingOpen = false;
    /** the polymerase's position along the open strand, in bases */
    let polymerase = -1;
    let lastPolyAt = 0;
    /** daughter length peeled off after a polymerase run (0 = none yet) */
    let chromatid = 0;
    /** 0..1 — how far the daughter has condensed into a chromatid */
    let chromatidCoil = 0;
    let chromatidFlash = 0;
    let lastGrowSoundAt = 0;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let selIdx = -1;
    let kbCharge = 0;
    let dragMode: "none" | "unzip" | "coil" = "none";
    const litRung = new Float32Array(MAX_BASES);
    let leaving = 0;

    // create/delete: dwelling past the ladder's ends grows the strand,
    // visibly gathering a new rung under the finger; ceremony on an existing
    // rung is the room's solemn act (mutate) — cold, it snips the strand
    let growing: { end: "head" | "tail"; progress: number; x: number; y: number } | null = null;
    let holdCeremonyDone = false;

    // ————— performance contract —————
    const gov = createFrameGovernor();
    let sleeping = false;
    let galleryPaused = false;
    const offVis = onVisibility((hidden) => { sleeping = hidden; });
    const offGalleryPause = onGalleryPause((p) => { galleryPaused = p; });

    // three-finger twist = season: the strand's own slow cycle
    let season = 0;
    let lastSeasonSoundAt = 0;

    // ——— the other strands in the nucleoplasm ———
    // Loose fragments drift, find their own site on the ladder BY SEQUENCE
    // (helix.bestAnnealSite — nothing here snaps to whatever is nearest),
    // hold there while the heat is below what their bonds can stand, and a
    // fragment that holds long enough is read into the template: the strand
    // that comes out is neither the strand that was there nor the patch.
    type Frag = {
      seq: Base[];
      nx: number;
      ny: number;
      vx: number;
      vy: number;
      seed: number;
      /** site on the template, and how well it fits there */
      site: number;
      score: number;
      bonds: number;
      /** 0..1 — how far it has settled onto its site */
      bound: number;
      /** seconds it has been fully bound */
      held: number;
      lit: number;
    };
    const MAX_FRAGS = 5;
    const frags: Frag[] = [];
    let fragCount = 0;
    /** the double-tap-on-empty cycle: fork, bubble, repair, primer */
    let eventIdx = 0;
    /** the room's own life, on seeded timers with no hand present */
    let lifeCount = 0;
    let nextLifeAt = 0;
    /** the triple tap: replication running the whole length of the strand */
    let replicating: { u: number; speed: number; gain: number } | null = null;
    /** a transcription bubble opened by the room rather than by two fingers */
    let autoBubble: { lo: number; hi: number; open: number; target: number } | null = null;
    let lastTranscriptAt = 0;

    // vessel flip: face-down is night
    let night = 0;
    let nightTarget = 0;

    // two-finger pan: the frame peeks, then eases home
    let panX = 0;
    let panY = 0;
    let panTargetX = 0;
    let panTargetY = 0;

    // the heat overlay's cached gradient strip — baked once, stretched with
    // drawImage every frame instead of a per-frame createLinearGradient
    let heatStrip: HTMLCanvasElement | null = null;

    const dust = new Float32Array(DUST * 3);
    const rngD = mulberry(hashSeed(0xd, 0x2a));
    for (let i = 0; i < DUST; i++) {
      dust[i * 3] = rngD();
      dust[i * 3 + 1] = rngD();
      dust[i * 3 + 2] = 0.3 + rngD() * 1.2;
    }

    function mulberry(seed: number): () => number {
      let a = seed >>> 0;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
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
        const parsedSeq = parseSequence(String(parsed.seq ?? ""));
        if (parsedSeq.length > 0) seqRef.current = settleLength(parsedSeq);
      }
    } catch {
      /* a fresh strand */
    }
    if (seqRef.current.length === 0 && !cleared) {
      // The ladder is already standing when anyone arrives.
      seqRef.current = sequenceFromSeed(0x1d1a, DEFAULT_LEN);
    }
    setHasKept(seqRef.current.length > 0);

    const save = () => {
      try {
        const payload: Stored = { seq: seqRef.current.join(""), cleared };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* noop */
      }
      setHasKept(seqRef.current.length > 0);
    };
    if (!visited) save();

    // ——— sound: the strand, heard ———
    const soundBase = (i: number, ms = 190, transposed = false) => {
      const seq = seqRef.current;
      if (i < 0 || i >= seq.length) return;
      const midis = melodyOf(transposed ? complement(seq) : seq);
      try {
        audio.playNote(midis[i], ms);
      } catch {
        /* the sea is not awake */
      }
      litRung[i] = 1;
    };

    /** A bond breaking: pitch and haptic weight are the real bond count. */
    const breakBond = (i: number) => {
      const seq = seqRef.current;
      if (i < 0 || i >= seq.length) return;
      const bonds = H_BONDS[seq[i]];
      try {
        audio.playNote(melodyOf(seq)[i] - 12, bonds === 3 ? 150 : 100);
        if (bonds === 3) haptics.detent();
        else haptics.tap();
      } catch {
        /* noop */
      }
      litRung[i] = 1;
    };

    /**
     * Create: a dwell past the ladder's end grows the strand by one base.
     * The oldest end — whichever the hand is NOT growing from — gives way
     * at the cap, never a silent refusal.
     */
    const growBase = (end: "head" | "tail") => {
      const seq = seqRef.current;
      const rng = mulberry(hashSeed(seq.length, end === "head" ? 0x48 : 0x54, Math.round(performance.now() / 30)));
      const base = BASES[Math.floor(rng() * BASES.length) % BASES.length];
      let next = end === "tail" ? [...seq, base] : [base, ...seq];
      if (next.length > MAX_BASES) {
        next = end === "tail" ? next.slice(next.length - MAX_BASES) : next.slice(0, MAX_BASES);
      }
      seqRef.current = next;
      const litIdx = end === "tail" ? next.length - 1 : 0;
      litRung[litIdx] = 1;
      soundBase(litIdx, 220);
      try {
        haptics.bloom();
      } catch {
        /* noop */
      }
      save();
    };

    /** The whole strand as its melody — the tutti of this room. */
    const playStrand = (transposed = false) => {
      const seq = seqRef.current;
      const step = clamp(1400 / Math.max(1, seq.length), 26, 90);
      for (let i = 0; i < seq.length; i++) {
        window.setTimeout(() => soundBase(i, 130, transposed), i * step);
      }
      try {
        haptics.ripple(0.4);
      } catch {
        /* noop */
      }
    };

    /**
     * A fragment enters the nucleoplasm. `drift` is how many bases of it are
     * wrong — 0 is a clean primer, 2 is a patch that will rewrite what it
     * lands on. Where it belongs is never passed in: the sequence decides.
     */
    const spawnFragment = (drift: number, at?: { nx: number; ny: number }) => {
      const seq = seqRef.current;
      if (seq.length < 12) return;
      fragCount += 1;
      const seed = hashSeed(0xf7a6, fragCount, seq.length);
      const rng = mulberry(seed);
      const len = 6 + Math.floor(rng() * 5);
      const from = Math.floor(rng() * Math.max(1, seq.length - len));
      const fseq = fragmentFrom(seq, from, len, drift, seed);
      const site = bestAnnealSite(seq, fseq);
      if (!site) return;
      if (frags.length >= MAX_FRAGS) {
        // at the cap the eldest visibly washes out rather than a silent no
        const gone = frags.shift();
        if (gone) {
          try {
            audio.playNote(30, 120);
          } catch {
            /* noop */
          }
        }
      }
      frags.push({
        seq: fseq,
        nx: at ? at.nx : 0.12 + rng() * 0.76,
        ny: at ? at.ny : 0.12 + rng() * 0.76,
        vx: (rng() - 0.5) * 0.05,
        vy: (rng() - 0.5) * 0.05,
        seed,
        site: site.index,
        score: site.score,
        bonds: site.bonds,
        bound: 0,
        held: 0,
        lit: 1,
      });
      try {
        audio.playNote(46 + Math.round(site.score * 10), 140);
        haptics.tap();
      } catch {
        /* noop */
      }
    };

    /** A bound fragment is read into the template — repair, and a strand
     *  that is neither the one that stood there nor the patch that landed. */
    const spliceFragment = (k: number) => {
      const f = frags[k];
      if (!f) return;
      const before = seqRef.current;
      const after = spliceInto(before, f.seq, f.site);
      frags.splice(k, 1);
      let changed = 0;
      for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) changed += 1;
      seqRef.current = after;
      for (let i = 0; i < f.seq.length; i++) litRung[f.site + i] = 1;
      try {
        if (changed > 0) {
          audio.bell();
          haptics.bloom();
        } else {
          audio.chime();
          haptics.detent();
        }
        audio.playNote(melodyOf(after)[f.site], 240);
      } catch {
        /* noop */
      }
      save();
    };

    /** The transcript of one stretch, played as the bubble opens. */
    const soundTranscript = (lo: number, hi: number) => {
      const seq = seqRef.current;
      const midis = melodyOf(complement(seq));
      const step = clamp(900 / Math.max(1, hi - lo), 30, 110);
      for (let i = lo; i <= hi && i < seq.length; i++) {
        window.setTimeout(() => {
          try {
            audio.playNote(midis[i], 120);
          } catch {
            /* noop */
          }
          litRung[i] = 1;
        }, (i - lo) * step);
      }
    };

    /**
     * A double tap on the open nucleoplasm calls in the next real event of
     * the cycle: a replication fork, a transcription bubble, a repair
     * enzyme, then a clean primer. Deterministic — the same order, always.
     */
    const summonEvent = (x: number, y: number, intensity: number) => {
      const seq = seqRef.current;
      const n = seq.length;
      const kind = eventIdx % 4;
      eventIdx += 1;
      if (n === 0) return;
      if (kind === 0) {
        // a replication fork opens and a polymerase starts down it
        unzipTarget = clamp01(0.25 + intensity * 0.35);
        holdingOpen = true;
        if (polymerase < 0) polymerase = 0;
        try {
          audio.playNote(36, 260);
          haptics.roll();
        } catch {
          /* noop */
        }
      } else if (kind === 1) {
        // a transcription bubble: a stretch melts open and is read off as rna
        const span = Math.max(4, Math.round(n * (0.16 + intensity * 0.16)));
        const lo = Math.max(0, Math.min(n - span - 1, Math.floor((y / height) * n) - Math.floor(span / 2)));
        autoBubble = { lo, hi: lo + span, open: 0, target: 0.6 + intensity * 0.35 };
        soundTranscript(lo, lo + span);
        try {
          haptics.ripple(0.3 + intensity * 0.3);
        } catch {
          /* noop */
        }
      } else if (kind === 2) {
        // a repair enzyme: a patch that is deliberately imperfect, so what
        // it splices in genuinely changes the code
        spawnFragment(1 + Math.round(intensity * 2), { nx: clamp01(x / width), ny: clamp01(y / height) });
      } else {
        // a clean primer — perfect complement, and it holds
        spawnFragment(0, { nx: clamp01(x / width), ny: clamp01(y / height) });
      }
      stirTurbulence(0.05 + intensity * 0.08);
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
        else audio.playNote(44, 160);
      } catch {
        /* noop */
      }
    };

    // ——— geometry ———
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

    const axisX = () => width / 2;
    const halfH = () => height * 0.38;
    const helixW = () => Math.min(width * 0.2, height * 0.11);

    const toLocal = (cx: number, cy: number) => ({
      x: clamp(cx - rectLeft, 0, width),
      y: clamp(cy - rectTop, 0, height),
    });

    /** Which rung is under this point, or -1. */
    const rungAtPoint = (x: number, y: number): number => {
      const seq = seqRef.current;
      if (seq.length === 0) return -1;
      const u = (y - (height / 2 - halfH())) / (halfH() * 2);
      if (u < -0.05 || u > 1.05) return -1;
      if (Math.abs(x - axisX()) > helixW() * 4) return -1;
      return clamp(Math.round(u * (seq.length - 1)), 0, seq.length - 1);
    };

    /** Which end of the strand a dwell near this point would extend, or
     *  null when the touch is nowhere near the ladder's axis at all. */
    const endNear = (x: number, y: number): "head" | "tail" | null => {
      if (Math.abs(x - axisX()) > helixW() * 5) return null;
      if (seqRef.current.length === 0) return "tail";
      const u = (y - (height / 2 - halfH())) / (halfH() * 2);
      if (u < 0.12) return "head";
      if (u > 0.88) return "tail";
      return null;
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
            playStrand(false);
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          const i = rungAtPoint(x, y);
          // rapid-tap ladder 1 / 3 / 5 / n — counts between tiers deepen intensity
          const tier = tapTrainTier(e.count);
          const base = tier === "n" ? 7 : tier;
          const deepen = Math.min(1, (e.count - base) * 0.5);
          const amp = e.intensity * (0.75 + deepen * 0.55);
          if (tier === 1) {
            if (i >= 0) {
              selIdx = i;
              soundBase(i, 200 + Math.round(amp * 220));
              try {
                haptics.tap();
              } catch {
                /* noop */
              }
              return;
            }
            stirTurbulence(0.05);
            try {
              audio.playNote(38, 220);
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          if (tier === 3) {
            // Off the ladder, the 3-rung calls in the next real event of the
            // nucleus: a replication fork, a transcription bubble, a repair
            // enzyme carrying a deliberately imperfect patch, then a clean
            // primer. Struck ON a rung it keeps its shipped meaning — the
            // ordered A→T→G→C rewrite, the nucleotide felt changing.
            if (i < 0) {
              summonEvent(x, y, e.intensity + deepen * 0.3);
              return;
            }
            // rewrite: cycle the nucleotide A→T→G→C
            const t = i;
            if (t < 0 || t >= seqRef.current.length) return;
            selIdx = t;
            const next = cycleBase(seqRef.current, t);
            if (next !== seqRef.current) {
              seqRef.current = next;
              litRung[t] = 1;
              soundBase(t, 260 + Math.round(amp * 180));
              try {
                haptics.bloom();
              } catch {
                /* noop */
              }
              save();
            }
            return;
          }
          if (tier === 5) {
            // rupture: a true mutation at the rung (or a snip when cold and short)
            const t = i >= 0 ? i : Math.floor(seqRef.current.length / 2);
            if (t < 0 || t >= seqRef.current.length) return;
            selIdx = t;
            if (temperature > 0.05 || seqRef.current.length <= MIN_BASES) {
              const next = mutate(seqRef.current, t, hashSeed(t, Math.round(amp * 1000)));
              if (next !== seqRef.current) {
                seqRef.current = next;
                litRung[t] = 1;
                soundBase(t, 280 + Math.round(deepen * 80));
                try {
                  haptics.chop();
                  audio.playNote(31, 260);
                } catch {
                  /* noop */
                }
                save();
              }
            } else if (seqRef.current.length > MIN_BASES) {
              const seq = seqRef.current;
              seqRef.current = seq.slice(0, t).concat(seq.slice(t + 1));
              selIdx = Math.min(t, seqRef.current.length - 1);
              try {
                audio.thud();
                haptics.roll();
              } catch {
                /* noop */
              }
              save();
            }
            return;
          }
          // n: rewrite — a local mutation burst, then the strand sings what it became
          const seq = seqRef.current;
          if (seq.length === 0) return;
          const center = i >= 0 ? i : Math.floor(seq.length / 2);
          const hits = 3 + Math.round(deepen * 4);
          let next = seq;
          for (let k = 0; k < hits; k++) {
            const idx = Math.max(0, Math.min(seq.length - 1, center + (k % 2 === 0 ? k : -k)));
            next = mutate(next, idx, hashSeed(k, idx, Math.round(amp * 500)));
            litRung[idx] = 1;
          }
          seqRef.current = next;
          save();
          // ...and then the top rung's own act, the largest thing this room
          // does: the whole strand REPLICATES. The fork runs its full length,
          // the polymerase riding it base by base, and a complete daughter
          // chromatid peels off and condenses beside the parent.
          replicating = { u: 0, speed: 0.16 + e.intensity * 0.22 + deepen * 0.1, gain: e.intensity };
          holdingOpen = true;
          polymerase = 0;
          chromatid = 0;
          chromatidCoil = 0;
          stirTurbulence(0.15 + deepen * 0.2);
          try {
            audio.bell();
            audio.playNote(31, 300);
            haptics.bloom();
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
          if (e.phase === "enter") {
            const { x, y } = toLocal(e.x, e.y);
            selIdx = rungAtPoint(x, y);
            holdCeremonyDone = false;
            if (selIdx < 0) {
              const end = endNear(x, y);
              growing = end ? { end, progress: 0, x, y } : null;
              if (growing) {
                try {
                  haptics.tap();
                } catch {
                  /* noop */
                }
              }
            } else {
              growing = null;
            }
            return;
          }
          if (e.phase === "release") {
            if (growing && e.tier >= 2) growBase(growing.end);
            growing = null;
            holdingOpen = false;
            polymerase = -1;
            return;
          }
          if (growing) {
            // dwell past the ladder's end: a new rung visibly gathers under
            // the finger from the moment the dwell tier is crossed, and
            // holding longer keeps deepening it until it commits on release
            const { x: gx, y: gy } = toLocal(e.x, e.y);
            growing.x = gx;
            growing.y = gy;
            growing.progress = clamp01((e.elapsed - 220) / 1400);
            const nowT = performance.now();
            if (nowT - lastGrowSoundAt > 340 && growing.progress > 0.05) {
              lastGrowSoundAt = nowT;
              try {
                audio.playNote(40 + Math.round(growing.progress * 12), 110);
                haptics.tap();
              } catch {
                /* noop */
              }
            }
            return;
          }
          // Holding the ladder open sets the polymerase running: it copies
          // the complement, and the melody plays back in the mirror.
          if (unzip > 0.06) {
            holdingOpen = true;
            if (polymerase < 0) polymerase = 0;
          }
          // Duration keeps deepening: a longer hold on a rung under a warm
          // world eventually rewrites it. Ceremony (tier 3) on a rung with
          // no warmth to rewrite it is the room's solemn act read cold —
          // the touch-reachable delete, snipping the strand there.
          if (e.tier >= 3 && selIdx >= 0) {
            if (temperature > 0.05) {
              const seq = seqRef.current;
              const next = mutate(seq, selIdx, hashSeed(Math.round(e.elapsed / 900), selIdx));
              if (next !== seq) {
                seqRef.current = next;
                litRung[selIdx] = 1;
                soundBase(selIdx, 260);
                try {
                  haptics.bloom();
                } catch {
                  /* noop */
                }
                save();
              }
            } else if (!holdCeremonyDone && seqRef.current.length > MIN_BASES) {
              holdCeremonyDone = true;
              const seq = seqRef.current;
              const cut = selIdx;
              seqRef.current = seq.slice(0, cut).concat(seq.slice(cut + 1));
              selIdx = Math.min(cut, seqRef.current.length - 1);
              try {
                audio.thud();
                haptics.roll();
              } catch {
                /* noop */
              }
              save();
            }
          }
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // the world-law: how fast the world rewrites the code
            temperatureTarget = clamp01(temperatureTarget + e.dx * 0.0022);
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "start") {
            dragMode = "none";
            return;
          }
          if (e.phase === "end") {
            dragMode = "none";
            // release is the only re-anneal — the unzip finger has left
            unzipTarget = 0;
            holdingOpen = false;
            polymerase = -1;
            return;
          }
          if (dragMode === "none") {
            // across the helix unzips it; along the helix winds it
            dragMode = Math.abs(e.dx) > Math.abs(e.dy) ? "unzip" : "coil";
          }
          if (dragMode === "unzip") {
            const seq = seqRef.current;
            const bonds = Math.max(1, hydrogenBonds(seq));
            // The resistance IS the ledger: a gc-rich strand opens slower
            // under exactly the same hand.
            const resist = (seq.length * 2.4) / bonds;
            unzipTarget = clamp01(unzipTarget + (Math.abs(e.dx) / Math.max(1, width)) * resist * 2.2);
            // The unzip finger is still down: keep the ladder open and let
            // the polymerase run. (Drag clears the hold channel in the
            // engine, so this contact *is* the hold the guide names.)
            if (unzipTarget > 0.06) {
              holdingOpen = true;
              if (polymerase < 0) polymerase = 0;
            }
          } else {
            supercoilTarget = clamp(supercoilTarget + e.dy * 0.0025, 0.5, 2.6);
          }
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          // a flick along the ladder springs the supercoil back
          supercoilTarget = clamp(supercoilTarget + Math.sin(e.angle) * (e.speed / 4000), 0.5, 2.6);
          try {
            haptics.ripple(0.3);
          } catch {
            /* noop */
          }
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // three-finger twist = season: the strand's own slow cycle,
            // never the lens
            if (e.phase === "move") {
              season = (((season + e.angle / (Math.PI * 2)) % 1) + 1) % 1;
              const now = performance.now();
              if (now - lastSeasonSoundAt > 260) {
                lastSeasonSoundAt = now;
                audio.playNote(28 + Math.round(season * 14), 180);
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
          // a circling hand winds the coil the way a finger winds a spring
          supercoilTarget = clamp(supercoilTarget + e.angularVelocity * 0.02, 0.5, 2.6);
        },
        span: (e) => {
          // two fingers held apart hold a bubble open between their rungs —
          // the sustained interval this room means literally: the two base
          // pairs kept apart while the stretch between them denatures.
          lastInteractionAt = performance.now();
          const n = seqRef.current.length;
          if (e.phase === "release" || n === 0) {
            spanActive = false;
            spanOpenTarget = 0;
            if (e.phase === "release") {
              try {
                haptics.tap();
              } catch {
                /* noop */
              }
            }
            return;
          }
          const a = toLocal(e.ax, e.ay);
          const b = toLocal(e.bx, e.by);
          const ra = rungAtPoint(a.x, a.y);
          const rb = rungAtPoint(b.x, b.y);
          if (ra < 0 || rb < 0 || ra === rb) {
            spanActive = false;
            spanOpenTarget = 0;
            return;
          }
          spanLo = Math.min(ra, rb);
          spanHi = Math.max(ra, rb);
          spanActive = true;
          // duration is the axis: the bubble melts wider the longer it is held
          const deep = Math.min(1, e.elapsed / 2600);
          spanOpenTarget = clamp01(0.34 + deep * 0.62);
          const now = performance.now();
          if (now - lastSpanToneAt > 300) {
            lastSpanToneAt = now;
            // sustain the dyad of the two held pairs — it lengthens and drops
            // as the interval opens, so 900ms and 2400ms never sound the same
            const midis = melodyOf(seqRef.current);
            const dur = Math.round((0.22 + deep * 0.5) * 1000);
            try {
              audio.playNote(midis[spanLo], dur);
              audio.playNote(midis[spanHi] - (deep > 0.6 ? 12 : 0), dur);
              haptics.ripple(0.18 + deep * 0.26);
            } catch {
              /* noop */
            }
            litRung[spanLo] = 1;
            litRung[spanHi] = 1;
          }
        },
        rhythm: (e) => {
          if (e.stability > 0.65) playStrand(false);
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel ———
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        leanTarget = reduced ? 0 : clamp(gamma / 40, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        // a mutation burst — the world rewrites several sites at once
        const seq = seqRef.current;
        const hits = Math.max(1, Math.round(intensity * 5));
        let next = seq;
        for (let k = 0; k < hits; k++) {
          const i = Math.floor(mulberry(hashSeed(k, Math.round(intensity * 1000)))() * seq.length);
          next = mutate(next, i, hashSeed(k, i));
          litRung[i] = 1;
        }
        seqRef.current = next;
        save();
        stirTurbulence(0.2 + intensity * 0.3);
        try {
          audio.playNote(31, 320);
          haptics.chop();
        } catch {
          /* noop */
        }
      },
      knock: () => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        const seq = seqRef.current;
        const i = Math.floor(seq.length / 2);
        soundBase(i, 320);
        try {
          audio.thud();
          haptics.detent();
        } catch {
          /* noop */
        }
      },
      flip: ({ faceDown }) => {
        // face-down is night: the ladder stills until the phone turns back
        nightTarget = faceDown ? 1 : 0;
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
      const seq = seqRef.current;
      if (ev.key === "Escape") {
        if (lensSnapped === 1) setLens(0);
        selIdx = -1;
        kbCharge = 0;
        unzipTarget = 0;
        holdingOpen = false;
        polymerase = -1;
        return;
      }
      if (ev.key === "ArrowDown" || ev.key === "ArrowRight") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        selIdx = (selIdx + 1) % Math.max(1, seq.length);
        soundBase(selIdx, 150);
        return;
      }
      if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        selIdx = (selIdx <= 0 ? seq.length : selIdx) - 1;
        soundBase(selIdx, 150);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!ev.repeat) {
          if (selIdx < 0) selIdx = 0;
          soundBase(selIdx, 240);
          kbCharge = 0.04;
          return;
        }
        // held Enter is the keyboard's unzip — keep it open while the key
        // is down so the polymerase can run the open strand, same as touch
        kbCharge = clamp01(kbCharge + 0.045);
        unzipTarget = kbCharge;
        if (kbCharge > 0.06) {
          holdingOpen = true;
          if (polymerase < 0) polymerase = 0;
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        kbCharge = 0;
        unzipTarget = 0;
        holdingOpen = false;
        polymerase = -1;
      }
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);

    // ——— the loop ———
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tier = gov.beginFrame(now);
      if (sleeping || galleryPaused) return; // no draw while the document is hidden or the gallery has paused this iframe
      const detail = detailForTier(tier);
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduced) localT += dt * timeScale;
      unzip += (unzipTarget - unzip) * Math.min(1, dt * 5);
      // the held bubble opens and re-anneals continuously — never a switch
      spanOpen += (spanOpenTarget - spanOpen) * Math.min(1, dt * 4);
      supercoil += (supercoilTarget - supercoil) * Math.min(1, dt * 4);
      temperature += (temperatureTarget - temperature) * Math.min(1, dt * 2);
      temperatureTarget *= Math.exp(-dt * 0.05); // the world cools on its own
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      lean += (leanTarget - lean) * Math.min(1, dt * 3);
      night += (nightTarget - night) * Math.min(1, dt * (nightTarget > night ? 1.6 : 2.8));
      if (leaving > 0) leaving = Math.max(0, leaving - dt * 0.6);
      // two-finger pan: the frame eases toward the hand's nudge, then home
      panX += (panTargetX - panX) * Math.min(1, dt * 5);
      panY += (panTargetY - panY) * Math.min(1, dt * 5);
      canvas.style.transform = (Math.abs(panX) > 0.05 || Math.abs(panY) > 0.05)
        ? `translate(${panX.toFixed(1)}px, ${panY.toFixed(1)}px)`
        : "";
      for (let i = 0; i < litRung.length; i++) {
        if (litRung[i] > 0) litRung[i] = Math.max(0, litRung[i] - dt * 1.6);
      }

      const seq = seqRef.current;
      const n = seq.length;
      const t = audio.getAudioTime() ?? now / 1000;
      // the album's shared 7s breath (clocksFrom) — the ladder's strand
      // luminance, nucleoplasm dust radius and origin glimmer all ride it,
      // so /dna lifts and settles in phase with the shader rooms.
      const breath = clocksFrom({ time: t, reducedMotion: reduced }).breath;

      // the zipper breaks bonds IN ORDER, one tick each
      const opened = openPairs(n, unzip);
      while (brokenTo < opened) {
        breakBond(brokenTo);
        brokenTo += 1;
      }
      if (opened < brokenTo) brokenTo = opened;

      // the polymerase runs the complement while the ladder is held open
      if (holdingOpen && polymerase >= 0 && n > 0) {
        if (now - lastPolyAt > (replicating ? 60 : 120)) {
          lastPolyAt = now;
          if (polymerase < opened) {
            soundBase(polymerase, 130, true);
            polymerase += 1;
          } else if (opened >= 4 && polymerase >= opened && chromatid < opened) {
            // the open stretch is copied — a daughter ribbon peels aside
            chromatid = opened;
            chromatidCoil = Math.max(chromatidCoil, 0.08);
            chromatidFlash = 1;
            try {
              audio.chime();
              haptics.bloom();
            } catch {
              /* noop */
            }
          }
        }
      }
      // free of the fork, the daughter condenses into a chromatid
      if (chromatid > 0) {
        const target = holdingOpen && polymerase < opened ? 0.2 : 1;
        chromatidCoil += (target - chromatidCoil) * Math.min(1, dt * 1.4);
        if (chromatidFlash > 0) chromatidFlash = Math.max(0, chromatidFlash - dt * 1.6);
      }

      // ——— replication: the fork runs the whole length of the strand ———
      if (replicating && n > 0) {
        replicating.u = Math.min(1, replicating.u + dt * timeScale * replicating.speed);
        unzipTarget = Math.max(unzipTarget, replicating.u);
        holdingOpen = true;
        if (polymerase < 0) polymerase = 0;
        if (replicating.u >= 1) {
          chromatid = n;
          chromatidCoil = Math.max(chromatidCoil, 0.12);
          chromatidFlash = 1;
          replicating = null;
          holdingOpen = false;
          polymerase = -1;
          unzipTarget = 0;
          try {
            audio.bell();
            audio.chime();
            haptics.bloom();
          } catch {
            /* noop */
          }
        }
      }

      // ——— the transcription bubble the room opens for itself ———
      if (autoBubble) {
        autoBubble.open += (autoBubble.target - autoBubble.open) * Math.min(1, dt * 2.2);
        autoBubble.target *= Math.exp(-dt * 0.22); // it closes again, as they do
        if (autoBubble.target < 0.02 && autoBubble.open < 0.02) autoBubble = null;
      }

      // ——— the physics BETWEEN strands ———
      // A fragment seeks the site its own letters name, holds while its bond
      // ledger can stand the heat, and melts off when it cannot. One that
      // holds long enough is read into the template.
      for (let k = frags.length - 1; k >= 0; k--) {
        const f = frags[k];
        f.lit = Math.max(0, f.lit - dt * 1.2);
        if (n === 0 || f.site + f.seq.length > n) {
          // the ladder moved under it: find the site again, or drift free
          const again = n > 0 ? bestAnnealSite(seq, f.seq) : null;
          if (!again) {
            frags.splice(k, 1);
            continue;
          }
          f.site = again.index;
          f.score = again.score;
          f.bonds = again.bonds;
          f.bound = 0;
          f.held = 0;
        }
        const holds = annealHolds(f.bonds, f.seq.length, temperature) && f.score > 0.55;
        if (!holds) {
          // denaturation: the duplex lets go, and it is heard letting go
          if (f.bound > 0.5) {
            f.lit = 1;
            try {
              audio.playNote(29, 140);
              haptics.tap();
            } catch {
              /* noop */
            }
          }
          f.bound = Math.max(0, f.bound - dt * 1.8);
          f.held = 0;
          if (!reduced) {
            f.nx += f.vx * dt;
            f.ny += f.vy * dt;
            f.vx += Math.sin(localT * 0.7 + f.seed % 7) * 0.02 * dt;
            f.vy += Math.cos(localT * 0.5 + f.seed % 5) * 0.02 * dt;
            if (f.nx < 0.06 || f.nx > 0.94) f.vx = -f.vx;
            if (f.ny < 0.06 || f.ny > 0.94) f.vy = -f.vy;
            f.nx = clamp(f.nx, 0.05, 0.95);
            f.ny = clamp(f.ny, 0.05, 0.95);
          }
          continue;
        }
        // its site, in field coordinates — the strand's own geometry
        const mid = (f.site + f.seq.length / 2) / n;
        const tx = clamp01((axisX() + helixW() * 3.1) / width);
        const ty = clamp01((height / 2 - halfH() + mid * halfH() * 2) / height);
        const near = Math.hypot(f.nx - tx, f.ny - ty);
        if (!reduced) {
          const seek = Math.min(1, dt * (1.1 + f.score * 1.6));
          f.nx += (tx - f.nx) * seek;
          f.ny += (ty - f.ny) * seek;
        } else {
          f.nx = tx;
          f.ny = ty;
        }
        if (near < 0.06) {
          const was = f.bound;
          f.bound = Math.min(1, f.bound + dt * (0.7 + f.score));
          if (was < 0.5 && f.bound >= 0.5) {
            f.lit = 1;
            for (let i = 0; i < f.seq.length; i++) litRung[f.site + i] = Math.max(litRung[f.site + i], 0.6);
            try {
              audio.playNote(52 + Math.round(f.score * 12), 150);
              haptics.detent();
            } catch {
              /* noop */
            }
          }
          if (f.bound >= 1) {
            f.held += dt;
            // a mismatched patch is read in sooner — that is what repair is
            if (f.held > 1.6 + f.score * 2.4) {
              spliceFragment(k);
              continue;
            }
          }
        }
      }

      // ——— aliveness: the nucleus works whether or not a hand is here ———
      if (nextLifeAt === 0) nextLifeAt = now + 5200;
      if (now >= nextLifeAt && !reduced && n > 0 && !replicating) {
        const rng = mulberry(hashSeed(lifeCount, 0x11fe));
        const roll = rng();
        lifeCount += 1;
        nextLifeAt = now + 9000 + rng() * 13000;
        if (roll < 0.42 && frags.length < MAX_FRAGS) {
          spawnFragment(roll < 0.16 ? 1 : 0);
        } else if (roll < 0.8) {
          // a gene is read: a bubble opens somewhere and the rna comes off
          const span = Math.max(4, Math.round(n * 0.18));
          const lo = Math.floor(rng() * Math.max(1, n - span - 1));
          autoBubble = { lo, hi: lo + span, open: 0, target: 0.55 };
          if (now - lastTranscriptAt > 4000) {
            lastTranscriptAt = now;
            soundTranscript(lo, lo + span);
          }
        } else if (frags.length > 0) {
          // ...or the heat spikes and whatever was bound comes off
          temperatureTarget = clamp01(temperatureTarget + 0.35);
        }
      }

      // the world rewrites the code at its own rate — never at rest
      if (n > 0 && temperature > 0.02 && !reduced) {
        mutationDebt += mutationRate(temperature) * dt * timeScale;
        while (mutationDebt >= 1) {
          mutationDebt -= 1;
          const i = Math.floor(mulberry(hashSeed(Math.round(localT * 1000), n))() * n);
          seqRef.current = mutate(seqRef.current, i, hashSeed(i, Math.round(localT * 97)));
          litRung[i] = 1;
          soundBase(i, 90);
          save();
        }
      }

      // ——— render ———
      // season (three-finger twist) drifts the ladder's own slow cycle,
      // read as a faint warmth independent of the hand's own heat
      const heat = temperature + Math.max(0, Math.sin(season * Math.PI * 2)) * 0.12;
      const bg = ctx.createRadialGradient(
        width / 2,
        height * 0.45,
        10,
        width / 2,
        height * 0.45,
        Math.max(width, height) * 0.8,
      );
      bg.addColorStop(0, `rgb(${13 + heat * 22}, ${14 + heat * 4}, ${19})`);
      bg.addColorStop(1, "rgb(6, 7, 10)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      // face-down is night: the ladder dims until the phone turns back over
      if (night > 0.01) {
        ctx.fillStyle = `rgba(3, 3, 5, ${night * 0.6})`;
        ctx.fillRect(0, 0, width, height);
      }

      // nuclear dust, drifting — the fixed count scales with the tier
      const activeDust = Math.max(10, Math.round(DUST * detail.particles));
      if (lens < 0.9) {
        for (let i = 0; i < activeDust; i++) {
          const dx = (dust[i * 3] + (reduced ? 0 : Math.sin(localT * 0.12 + i) * 0.02)) * width;
          const dy = (dust[i * 3 + 1] + (reduced ? 0 : Math.cos(localT * 0.09 + i * 1.3) * 0.02)) * height;
          ctx.fillStyle = `rgba(150, 168, 200, ${0.1 * (1 - lens)})`;
          ctx.beginPath();
          ctx.arc(dx, dy, dust[i * 3 + 2] * (1 + breath * 0.2), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (n === 0 && chromatid > 0) {
        chromatid = 0;
        chromatidCoil = 0;
        chromatidFlash = 0;
      }

      if (n > 0) {
        const cx = axisX();
        const cy = height / 2;
        const hh = halfH();
        const hw = helixW();
        const turn = reduced ? 0 : localT * 0.35;
        // computed once per frame — was being recomputed (a fresh O(n)
        // array) inside the per-rung loop and inside the fragments loop
        const comp = complement(seq);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(lean * 0.14);

        // a raised-cosine bubble held open between the two spanned pairs:
        // pinned (0) at each held rung, widest in the middle of the stretch
        const bubbleAt = (idx: number) => {
          let v = 0;
          if (!(spanOpen <= 0.001 || spanLo < 0 || spanHi <= spanLo || idx < spanLo || idx > spanHi)) {
            const u = (idx - spanLo) / (spanHi - spanLo);
            v = (0.5 - 0.5 * Math.cos(u * Math.PI * 2)) * spanOpen;
          }
          // ...and the bubble the room opens for itself, to read a gene
          if (autoBubble && autoBubble.open > 0.001 && idx >= autoBubble.lo && idx <= autoBubble.hi) {
            const u = (idx - autoBubble.lo) / Math.max(1, autoBubble.hi - autoBubble.lo);
            v = Math.max(v, (0.5 - 0.5 * Math.cos(u * Math.PI * 2)) * autoBubble.open);
          }
          return v;
        };

        for (let i = 0; i < n; i++) {
          const r = rungAt(i, n, unzip, supercoil);
          const rOpen = Math.max(r.open, bubbleAt(i));
          // the room's own turn ridden on top of the strand's geometry
          const ph = (i / BASES_PER_TURN) * Math.PI * 2 * supercoil + turn;
          const spread = 1 + rOpen * 2.4;
          const x1 = Math.sin(ph) * hw * spread;
          const x2 = -Math.sin(ph) * hw * spread;
          const depth = Math.cos(ph) * 0.5 + 0.5;
          // weak a·t rungs shiver more than the g·c ones — visible physics
          const shiver = reduced
            ? 0
            : Math.sin(localT * (H_BONDS[seq[i]] === 2 ? 5.5 : 3.1) + i) *
              (H_BONDS[seq[i]] === 2 ? 1.6 : 0.8) *
              (0.5 + heat);
          const y = r.y * hh + shiver * 0.4;

          const lit = litRung[i];
          const alpha = (1 - leaving) * (1 - lens * 0.55);
          // the rung itself: its colour is its base, its weight its bonds
          if (rOpen < 0.98) {
            ctx.strokeStyle = `rgba(${BASE_TINT[seq[i]]}, ${
              (0.12 + depth * 0.3 + lit * 0.55) * (1 - rOpen) * alpha
            })`;
            ctx.lineWidth = H_BONDS[seq[i]] === 3 ? 1.9 : 1.1;
            ctx.beginPath();
            ctx.moveTo(x1 + shiver, y);
            ctx.lineTo(x2 - shiver, y);
            ctx.stroke();
          } else {
            // broken: the two half-rungs reach for each other
            for (const [xs, dir] of [
              [x1 + shiver, 1],
              [x2 - shiver, -1],
            ] as const) {
              ctx.strokeStyle = `rgba(${BASE_TINT[seq[i]]}, ${(0.16 + lit * 0.4) * alpha})`;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(xs, y);
              ctx.lineTo(xs - dir * hw * 0.35, y);
              ctx.stroke();
            }
          }
          // the base marks on each backbone
          for (const [xs, b] of [
            [x1 + shiver, seq[i]],
            [x2 - shiver, comp[i]],
          ] as [number, Base][]) {
            ctx.fillStyle = `rgba(${BASE_TINT[b]}, ${(0.3 + depth * 0.4 + lit * 0.5) * alpha})`;
            ctx.beginPath();
            ctx.arc(xs, y, (1.6 + depth * 1.4) * (1 + lit * 0.9 + breath * 0.08), 0, Math.PI * 2);
            ctx.fill();
          }
          if (lens > 0.35 && (i % 2 === 0 || n < 30)) {
            ctx.globalAlpha = (lens - 0.35) / 0.65;
            ctx.font = "300 9px ui-monospace, 'SF Mono', Menlo, monospace";
            ctx.textAlign = "left";
            ctx.fillStyle = `rgba(${BASE_TINT[seq[i]]}, 0.9)`;
            ctx.fillText(seq[i], hw * 3.2, y + 3);
            ctx.fillStyle = "rgba(206, 222, 250, 0.45)";
            ctx.fillText(comp[i], -hw * 3.2 - 6, y + 3);
            ctx.globalAlpha = 1;
          }
        }

        // The two backbones, sampled finer than the bases so the sine is a
        // curve rather than a polygon, and drawn segment by segment with
        // the near strand over the far one — the turn you see is the turn
        // the geometry actually has.
        const SUB = 6;
        const steps = Math.max(2, n * SUB);
        for (let k = 0; k < steps; k++) {
          const f0 = k / steps;
          const f1 = (k + 1) / steps;
          const seg = (f: number, side: 1 | -1) => {
            const i = f * n;
            const idx = Math.min(n - 1, Math.floor(i));
            const r = rungAt(idx, n, unzip, supercoil);
            const open = Math.max(r.open, bubbleAt(idx));
            const ph = (i / BASES_PER_TURN) * Math.PI * 2 * supercoil + turn;
            const spread = 1 + open * 2.4;
            return {
              x: side * Math.sin(ph) * hw * spread,
              y: (f * 2 - 1) * hh,
              depth: Math.cos(ph) * side * 0.5 + 0.5,
            };
          };
          for (const side of [1, -1] as const) {
            const a = seg(f0, side);
            const b = seg(f1, side);
            const near = (a.depth + b.depth) / 2;
            const tint = side === 1 ? "240, 220, 180" : "160, 186, 214";
            ctx.strokeStyle = `rgba(${tint}, ${
              (0.16 + near * 0.42 - lens * 0.2) * (1 - leaving)
            })`;
            ctx.lineWidth = 1 + near * 1.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }

        // the loose fragments: short ladders of their own, drifting until
        // they find the letters that match them, then lying alongside the
        // template with their pairing drawn rung by rung
        for (const f of frags) {
          const fx = f.nx * width - cx;
          const fy = f.ny * height - cy;
          const m = f.seq.length;
          const rise = (halfH() * 2) / Math.max(1, n);
          const half = (m * rise) / 2;
          ctx.save();
          ctx.translate(fx, fy);
          // free, it tumbles; bound, it lies straight along the ladder
          ctx.rotate((1 - f.bound) * (Math.sin(localT * 0.5 + (f.seed % 11)) * 0.7 + 0.4));
          const a0 = (0.4 + f.bound * 0.4 + f.lit * 0.4) * (1 - leaving);
          ctx.strokeStyle = `rgba(206, 222, 250, ${a0 * 0.8})`;
          ctx.lineWidth = 1.1 + f.bound * 0.6;
          ctx.beginPath();
          ctx.moveTo(0, -half);
          ctx.lineTo(0, half);
          ctx.stroke();
          for (let i = 0; i < m; i++) {
            const y = -half + (i + 0.5) * rise;
            const b = f.seq[i];
            // the pairing itself: a matched base reaches for the template,
            // a mismatched one sits stubbed and unpaired
            const matched = f.site + i < n && comp[f.site + i] === b;
            const reach = matched ? -helixW() * 0.55 * f.bound : -helixW() * 0.18 * f.bound;
            ctx.strokeStyle = `rgba(${BASE_TINT[b]}, ${a0 * (matched ? 0.6 : 0.25)})`;
            ctx.lineWidth = H_BONDS[b] === 3 ? 1.5 : 0.9;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(reach, y);
            ctx.stroke();
            ctx.fillStyle = `rgba(${BASE_TINT[b]}, ${a0 * 0.85})`;
            ctx.beginPath();
            ctx.arc(0, y, 1.8 + f.lit * 1.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        // the polymerase: a small bright thing walking the open strand
        if (holdingOpen && polymerase >= 0 && polymerase < n) {
          const y = (polymerase / n) * 2 * hh - hh;
          ctx.fillStyle = "rgba(242, 238, 230, 0.8)";
          ctx.beginPath();
          ctx.arc(0, y, 3.4 + breath, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(242, 238, 230, 0.28)";
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.arc(0, y, 9 + breath * 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        // the daughter chromatid — a condensed complement peeled beside the ladder
        if (chromatid > 0) {
          const m = Math.min(chromatid, n);
          const daughter = comp.slice(0, m);
          const peel = 0.35 + chromatidCoil * 0.9;
          const cx = hw * (3.6 + peel * 2.4);
          const coil = 1 + chromatidCoil * 1.8;
          const hhC = hh * (0.55 + (1 - chromatidCoil) * 0.35);
          const flash = chromatidFlash * 0.35;
          ctx.save();
          ctx.translate(cx, -hh * 0.15 * chromatidCoil);
          ctx.globalAlpha = (0.55 + chromatidCoil * 0.35 + flash) * (1 - leaving);
          // condensed backbone
          ctx.beginPath();
          for (let i = 0; i < m; i++) {
            const r = rungAt(i, m, 0, coil);
            const px = r.x1 * hw * (0.55 + chromatidCoil * 0.2);
            const py = (i / Math.max(1, m - 1)) * 2 * hhC - hhC;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = `rgba(206, 222, 250, ${0.45 + chromatidCoil * 0.35})`;
          ctx.lineWidth = 1.6 + chromatidCoil;
          ctx.stroke();
          ctx.beginPath();
          for (let i = 0; i < m; i++) {
            const r = rungAt(i, m, 0, coil);
            const px = r.x2 * hw * (0.55 + chromatidCoil * 0.2);
            const py = (i / Math.max(1, m - 1)) * 2 * hhC - hhC;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = `rgba(231, 172, 82, ${0.4 + chromatidCoil * 0.35})`;
          ctx.lineWidth = 1.4 + chromatidCoil * 0.8;
          ctx.stroke();
          // a few base sparks along the chromatid
          for (let i = 0; i < m; i += Math.max(1, Math.floor(m / 8))) {
            const r = rungAt(i, m, 0, coil);
            const py = (i / Math.max(1, m - 1)) * 2 * hhC - hhC;
            const tint = BASE_TINT[daughter[i]];
            ctx.fillStyle = `rgba(${tint}, ${0.55 + flash})`;
            ctx.beginPath();
            ctx.arc(((r.x1 + r.x2) * 0.5) * hw * 0.5, py, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        // the keyboard's mark
        if (selIdx >= 0 && selIdx < n) {
          const y = (selIdx / n) * 2 * hh - hh;
          ctx.strokeStyle = "rgba(242, 238, 230, 0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-hw * 4, y);
          ctx.lineTo(hw * 4, y);
          ctx.stroke();
        }
        ctx.restore();

        // the notation surface: only where the lens is raised
        if (lens > 0.5) {
          const la = (lens - 0.5) / 0.5;
          ctx.globalAlpha = la;
          ctx.font = "300 11px ui-monospace, 'SF Mono', Menlo, monospace";
          ctx.textAlign = "left";
          ctx.fillStyle = "rgba(206, 222, 250, 0.7)";
          const rna = transcribe(seq);
          const lines = [
            `${n} bp · ${hydrogenBonds(seq)} h-bonds`,
            `gc ${(gcContent(seq) * 100).toFixed(0)}% · tm ${meltingTemp(seq)}°`,
            `${rna.slice(0, 34)}${rna.length > 34 ? "…" : ""}`,
          ];
          lines.forEach((line, k) => {
            ctx.fillText(line, 18, height - 96 + k * 16);
          });
          // the melody drawn as a contour — the strand's other face
          const midis = melodyOf(seq);
          const lo = Math.min(...midis);
          const hi = Math.max(...midis);
          ctx.strokeStyle = "rgba(231, 172, 82, 0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const x = 18 + (i / Math.max(1, n - 1)) * (width - 36);
            const y = height - 30 - ((midis[i] - lo) / Math.max(1, hi - lo)) * 34;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // the dwell that grows the strand: a new rung visibly gathers under
      // the finger, deepening the longer it is held
      if (growing) {
        const u = growing.progress;
        ctx.strokeStyle = `rgba(231, 172, 82, ${0.2 + u * 0.5})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(growing.x, growing.y, helixW() * (0.6 + u * 1.1), -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2);
        ctx.stroke();
        if (u > 0.05) {
          ctx.fillStyle = `rgba(222, 214, 196, ${0.3 + u * 0.5})`;
          ctx.beginPath();
          ctx.arc(growing.x, growing.y, 2.4 + u * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ——— glimmer: after ~20s idle one rung sounds itself, faintly
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 6000 && !reduced && n > 0) {
        glimmerAt = now;
        const i = Math.floor(mulberry(hashSeed(Math.round(now / 6000)))() * n);
        litRung[i] = 0.5;
      }

      // the heat of the world, felt at the edge — a cached horizontal strip
      // stretched across the frame, never rebuilt per frame
      if (heat > 0.03) {
        let strip = heatStrip;
        if (!strip) {
          strip = document.createElement("canvas");
          strip.width = 256;
          strip.height = 1;
          const sctx = strip.getContext("2d");
          if (sctx) {
            const g = sctx.createLinearGradient(0, 0, 256, 0);
            g.addColorStop(0, "rgba(200, 92, 40, 1)");
            g.addColorStop(0.5, "rgba(0,0,0,0)");
            g.addColorStop(1, "rgba(200, 92, 40, 1)");
            sctx.fillStyle = g;
            sctx.fillRect(0, 0, 256, 1);
          }
          heatStrip = strip;
        }
        ctx.globalAlpha = heat * 0.1;
        ctx.drawImage(strip, 0, 0, width, height);
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      detachGestures();
      detachVessel();
      offVis();
      offGalleryPause();
      markLens(false);
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      mq.removeEventListener?.("change", onMq);
      cancelAnimationFrame(raf);
    };
  }, []);

  const letGo = () => {
    // the strand comes apart from one end over a breath, then is gone
    const step = () => {
      const seq = seqRef.current;
      if (seq.length === 0) return;
      seqRef.current = seq.slice(0, Math.max(0, seq.length - 4));
      window.setTimeout(step, 60);
    };
    window.setTimeout(step, 40);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ seq: "", cleared: true }));
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
      aria-label="a ladder that copies itself"
      style={{
        position: "fixed",
        inset: 0,
        background: "#06070a",
        outline: "none",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <LetGo label="let the strand go" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
