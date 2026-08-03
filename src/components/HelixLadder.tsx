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
 * supercoils it. Tap a rung to sound its degree. Three fingers touch the
 * world-law: drag is the mutation temperature, hold dilates the clock,
 * tap plays the whole strand as its melody. Twist raises the lens to
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
import { onVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import LetGo from "@/components/LetGo";
import {
  BASES_PER_TURN,
  H_BONDS,
  MAX_BASES,
  complement,
  gcContent,
  hashSeed,
  hydrogenBonds,
  melodyOf,
  meltingTemp,
  mutate,
  mutationRate,
  openPairs,
  parseSequence,
  rungAt,
  sequenceFromSeed,
  settleLength,
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
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let selIdx = -1;
    let kbCharge = 0;
    let dragMode: "none" | "unzip" | "coil" = "none";
    const litRung = new Float32Array(MAX_BASES);
    let leaving = 0;

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

    // ——— geometry ———
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
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
          if (e.fingers === 2) return; // ScaleTravel's step back
          if (e.fingers === 3) {
            playStrand(false);
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          const i = rungAtPoint(x, y);
          if (i >= 0) {
            soundBase(i, 220 + Math.round(e.intensity * 200));
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
            selIdx = i;
            return;
          }
          // open dark: the whole ladder rings once, softly
          stirTurbulence(0.05);
          try {
            audio.playNote(38, 220);
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
          if (e.phase === "enter") {
            const { x, y } = toLocal(e.x, e.y);
            selIdx = rungAtPoint(x, y);
            return;
          }
          if (e.phase === "release") {
            holdingOpen = false;
            polymerase = -1;
            return;
          }
          // Holding the ladder open sets the polymerase running: it copies
          // the complement, and the melody plays back in the mirror.
          if (unzip > 0.06) {
            holdingOpen = true;
            if (polymerase < 0) polymerase = 0;
          }
          // Duration keeps deepening: a longer hold on a rung under a warm
          // world eventually rewrites it.
          if (e.tier >= 3 && selIdx >= 0 && temperature > 0.05) {
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
          if (e.phase === "move") lensTarget = clamp01(lensTarget + e.angle / 1.7);
          else if (e.phase === "end") setLens(lensTarget > 0.5 ? 1 : 0);
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          // a circling hand winds the coil the way a finger winds a spring
          supercoilTarget = clamp(supercoilTarget + e.angularVelocity * 0.02, 0.5, 2.6);
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
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduced) localT += dt * timeScale;
      unzip += (unzipTarget - unzip) * Math.min(1, dt * 5);
      supercoil += (supercoilTarget - supercoil) * Math.min(1, dt * 4);
      temperature += (temperatureTarget - temperature) * Math.min(1, dt * 2);
      temperatureTarget *= Math.exp(-dt * 0.05); // the world cools on its own
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      lean += (leanTarget - lean) * Math.min(1, dt * 3);
      if (leaving > 0) leaving = Math.max(0, leaving - dt * 0.6);
      for (let i = 0; i < litRung.length; i++) {
        if (litRung[i] > 0) litRung[i] = Math.max(0, litRung[i] - dt * 1.6);
      }

      const seq = seqRef.current;
      const n = seq.length;
      const t = audio.getAudioTime() ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // the zipper breaks bonds IN ORDER, one tick each
      const opened = openPairs(n, unzip);
      while (brokenTo < opened) {
        breakBond(brokenTo);
        brokenTo += 1;
      }
      if (opened < brokenTo) brokenTo = opened;

      // the polymerase runs the complement while the ladder is held open
      if (holdingOpen && polymerase >= 0 && n > 0) {
        if (now - lastPolyAt > 120) {
          lastPolyAt = now;
          if (polymerase < opened) {
            soundBase(polymerase, 130, true);
            polymerase += 1;
          }
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
      const heat = temperature;
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

      // nuclear dust, drifting
      if (lens < 0.9) {
        for (let i = 0; i < DUST; i++) {
          const dx = (dust[i * 3] + (reduced ? 0 : Math.sin(localT * 0.12 + i) * 0.02)) * width;
          const dy = (dust[i * 3 + 1] + (reduced ? 0 : Math.cos(localT * 0.09 + i * 1.3) * 0.02)) * height;
          ctx.fillStyle = `rgba(150, 168, 200, ${0.1 * (1 - lens)})`;
          ctx.beginPath();
          ctx.arc(dx, dy, dust[i * 3 + 2] * (1 + breath * 0.2), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (n > 0) {
        const cx = axisX();
        const cy = height / 2;
        const hh = halfH();
        const hw = helixW();
        const turn = reduced ? 0 : localT * 0.35;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(lean * 0.14);

        const pts1: number[] = [];
        const pts2: number[] = [];
        for (let i = 0; i < n; i++) {
          const r = rungAt(i, n, unzip, supercoil);
          // the room's own turn ridden on top of the strand's geometry
          const ph = (i / BASES_PER_TURN) * Math.PI * 2 * supercoil + turn;
          const spread = 1 + r.open * 2.4;
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
          pts1.push(x1 + shiver, y);
          pts2.push(x2 - shiver, y);

          const lit = litRung[i];
          const alpha = (1 - leaving) * (1 - lens * 0.55);
          // the rung itself: its colour is its base, its weight its bonds
          if (r.open < 0.98) {
            ctx.strokeStyle = `rgba(${BASE_TINT[seq[i]]}, ${
              (0.12 + depth * 0.3 + lit * 0.55) * (1 - r.open) * alpha
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
            [x2 - shiver, complement(seq)[i]],
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
            ctx.fillText(complement(seq)[i], -hw * 3.2 - 6, y + 3);
            ctx.globalAlpha = 1;
          }
        }

        // The two backbones, sampled finer than the bases so the sine is a
        // curve rather than a polygon, and drawn segment by segment with
        // the near strand over the far one — the turn you see is the turn
        // the geometry actually has.
        void pts1;
        void pts2;
        const SUB = 6;
        const steps = Math.max(2, n * SUB);
        for (let k = 0; k < steps; k++) {
          const f0 = k / steps;
          const f1 = (k + 1) / steps;
          const seg = (f: number, side: 1 | -1) => {
            const i = f * n;
            const idx = Math.min(n - 1, Math.floor(i));
            const r = rungAt(idx, n, unzip, supercoil);
            const ph = (i / BASES_PER_TURN) * Math.PI * 2 * supercoil + turn;
            const spread = 1 + r.open * 2.4;
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

      // ——— glimmer: after ~20s idle one rung sounds itself, faintly
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 6000 && !reduced && n > 0) {
        glimmerAt = now;
        const i = Math.floor(mulberry(hashSeed(Math.round(now / 6000)))() * n);
        litRung[i] = 0.5;
      }

      // the heat of the world, felt at the edge
      if (heat > 0.03) {
        const g = ctx.createLinearGradient(0, 0, width, 0);
        g.addColorStop(0, `rgba(200, 92, 40, ${heat * 0.1})`);
        g.addColorStop(0.5, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(200, 92, 40, ${heat * 0.1})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      detachGestures();
      detachVessel();
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
