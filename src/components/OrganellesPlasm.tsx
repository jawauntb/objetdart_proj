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
 * the other way to let them out. Dwell on open plasm and the organ the cell
 * is still missing condenses there; gather all six and the cell membrane
 * closes around them of its own accord, which is the handoff. Hold the
 * nucleus to the ceremony and it opens onto the helix within — the door
 * down. Twist raises the lens to the ledger, where the budget is drawn as
 * shares of one constant total. Three fingers hold the world-law: drag is
 * the streaming rate, hold dilates the clock, tap is the tutti. Tilt pours
 * the plasm; a shake churns it; a knock rings the nearest organ.
 *
 * Persists in `objetdart:organelles:v1` with the quiet clear at the bottom.
 * Pinch is unbound — ScaleTravel owns it (cells above, dna below).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import LetGo from "@/components/LetGo";
import {
  KIND_BASE_HZ,
  MAX_ORGANELLES,
  MEMBRANE_KINDS,
  brightness,
  foldedness,
  harmonicsFor,
  hasFullSet,
  hashSeed,
  membranePoint,
  missingKinds,
  mulberry32,
  organelleFromSeed,
  redistribute,
  settlePopulation,
  surfaceArea,
  totalArea,
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
    let dragIdx = -1;
    let holdIdx = -1;
    let holdDone = false;
    let condensing: { nx: number; ny: number; u: number } | null = null;
    let lastTickAt = 0;
    let closing = 0; // the cell membrane drawing itself around the set
    let closed = false;
    let leaving = false;
    const lit = new Float32Array(MAX_ORGANELLES);
    const vel = new Float32Array(MAX_ORGANELLES * 2);

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
    closing = closed ? 1 : 0;
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

    // ——— canvas ———
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

    const unit = () => Math.min(width, height) * 0.055;
    const toLocal = (cx: number, cy: number) => ({
      x: clamp(cx - rectLeft, 0, width),
      y: clamp(cy - rectTop, 0, height),
    });

    const organelleAt = (x: number, y: number): number => {
      const list = listRef.current;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        const d = Math.hypot(x - o.nx * width, y - o.ny * height);
        const reach = Math.max(26, o.radius * unit() * (1 + o.amplitude) + 12);
        if (d < reach && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

    // ——— the grammar ———
    const detachGestures = attachGestures(
      wrap,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) return; // ScaleTravel's step back
          if (e.fingers === 3) {
            tutti();
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          const i = organelleAt(x, y);
          if (i >= 0) {
            selIdx = i;
            ring(i, 0.6 + e.intensity * 0.6);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          // open plasm: the streaming takes a nudge
          churn = Math.min(1, churn + 0.15 + e.intensity * 0.2);
          stirTurbulence(0.05);
          try {
            audio.playNote(41, 180);
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
            holdIdx = organelleAt(x, y);
            holdDone = false;
            if (holdIdx < 0 && listRef.current.length < MAX_ORGANELLES) {
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
            const o = listRef.current[dragIdx];
            listRef.current = listRef.current.map((q, k) =>
              k === dragIdx ? { ...q, nx: clamp(x / width, 0.06, 0.94), ny: clamp(y / height, 0.08, 0.92) } : q,
            );
            void o;
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
          const i = organelleAt(e.cx - rectLeft, e.cy - rectTop);
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
          const i = organelleAt(e.x - rectLeft, e.y - rectTop);
          if (i < 0) return;
          const speed = clamp(e.speed / 2400, 0.1, 1);
          vel[i * 2] += Math.cos(e.angle) * speed * 0.4;
          vel[i * 2 + 1] += Math.sin(e.angle) * speed * 0.4;
          ring(i, speed);
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.phase === "move") lensTarget = clamp01(lensTarget + e.angle / 1.7);
          else if (e.phase === "end") setLens(lensTarget > 0.5 ? 1 : 0);
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
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduced) localT += dt * timeScale;
      streaming += (streamingTarget - streaming) * Math.min(1, dt * 2);
      pour += (pourTarget - pour) * Math.min(1, dt * 2.4);
      churn *= Math.exp(-dt * 0.9);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      for (let i = 0; i < lit.length; i++) if (lit[i] > 0) lit[i] = Math.max(0, lit[i] - dt * 1.3);

      const list = listRef.current;
      const t = audio.getAudioTime() ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // the cell membrane closes around a full set, of its own accord
      const full = hasFullSet(list);
      if (full && !closed) {
        closed = true;
        try {
          audio.bell();
          haptics.bloom();
        } catch {
          /* noop */
        }
      }
      if (!full) closed = false;
      closing += ((closed ? 1 : 0) - closing) * Math.min(1, dt * 1.4);

      // the plasm streams and carries its organs with it
      if (!reduced) {
        for (let i = 0; i < list.length; i++) {
          if (i === dragIdx) continue;
          const o = list[i];
          const flow = streaming * 0.02;
          const swirl = Math.sin(localT * 0.3 + o.nx * 6) * flow + pour * 0.03;
          const drift = Math.cos(localT * 0.24 + o.ny * 5) * flow;
          let nx = o.nx + (vel[i * 2] + swirl) * dt;
          let ny = o.ny + (vel[i * 2 + 1] + drift) * dt;
          vel[i * 2] *= Math.exp(-dt * 1.2);
          vel[i * 2 + 1] *= Math.exp(-dt * 1.2);
          if (nx < 0.07 || nx > 0.93) vel[i * 2] = -vel[i * 2] * 0.7;
          if (ny < 0.09 || ny > 0.91) vel[i * 2 + 1] = -vel[i * 2 + 1] * 0.7;
          nx = clamp(nx, 0.06, 0.94);
          ny = clamp(ny, 0.08, 0.92);
          list[i] = { ...o, nx, ny };
        }
      }

      // ——— render ———
      const bg = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        10,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.8,
      );
      bg.addColorStop(0, "rgb(16, 19, 18)");
      bg.addColorStop(1, "rgb(8, 10, 10)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // the cytoplasm, streaming
      const U = unit();
      if (lens < 0.92) {
        for (let i = 0; i < PLASM_MOTES; i++) {
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

      // the cell membrane, closing
      if (closing > 0.01) {
        const r = Math.min(width, height) * 0.44;
        ctx.strokeStyle = `rgba(170, 214, 190, ${0.1 + closing * 0.28})`;
        ctx.lineWidth = 1 + closing * 1.6;
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, r * (0.92 + breath * 0.02), -Math.PI / 2, -Math.PI / 2 + closing * Math.PI * 2);
        ctx.stroke();
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
        // cristae are literally more line inside the same sac.
        ctx.beginPath();
        const steps = 132;
        for (let k = 0; k <= steps; k++) {
          const th = (k / steps) * Math.PI * 2;
          const p = membranePoint(o, th, reduced ? 0 : breath);
          const x = p.x * scale;
          const y = p.y * scale;
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
          // short chords across each lobe, which is what a section shows
          ctx.strokeStyle = `rgba(${tint}, ${0.1 + b * 0.22 + l * 0.2})`;
          ctx.lineWidth = 0.6;
          for (let k = 0; k < o.folds; k++) {
            const a = ((k + 0.5) / o.folds) * Math.PI * 2;
            const inner = membranePoint({ ...o, amplitude: -o.amplitude }, a, 0);
            const outer = membranePoint(o, a, 0);
            ctx.beginPath();
            ctx.moveTo(inner.x * scale, inner.y * scale);
            ctx.lineTo(outer.x * scale * 0.98, outer.y * scale * 0.98);
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
