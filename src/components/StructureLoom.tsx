"use client";

/**
 * /loom — one structure woven through every sense.
 *
 * A single abstract dynamical structure S ("concern becoming agency",
 * src/lib/structure.ts) compiled AT ONCE into five materials — sound, shape,
 * text, space, touch — with a live table proving each compiler still carries
 * the same invariant. This is the gesamtkunstwerk made literal: not several
 * arts arranged together, ONE structure embodied several times, and the
 * commuting diagrams (compile∘step ≈ step∘compile) made visible.
 *
 * A law/lens room: it takes no scale address and mounts no ScaleTravel — the
 * structure holds at every band. pinch is bound in-room (off-axis) to the
 * selection at agency.
 *
 * The hand pours attention (tap/hold) → tension rises → at the threshold the
 * five substrates cross in the same frame → at agency a ceremony makes a
 * selection and the reach opens. twist rotates the lens between the five
 * embodiments and the bare structure (phase portrait, conserved quantity,
 * hysteresis loop).
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import {
  structureFromSeed,
  step,
  initialState,
  compileSound,
  compileVisual,
  compileText,
  compileNav,
  compileTactile,
  verify,
  conservedQuantity,
  reachableRegion,
  selectionShift,
  select,
  isMonotoneRising,
  isMonotoneFalling,
  NAV_GRID,
  type State,
  type Params,
  type Phase,
  type MediumId,
} from "@/lib/structure";

const STORAGE_KEY = "objetdart:loom:v1";
const SEED = 20260803;

// The five substrates, in table order.
const MEDIA: MediumId[] = ["sound", "visual", "text", "nav", "tactile"];
// The five invariants, in table order.
const INVARIANTS = ["accum", "jump", "hyst", "cons", "decay"] as const;
type InvariantId = (typeof INVARIANTS)[number];

// Which axes each medium carries — a lossy medium legitimately CANNOT witness
// an invariant about an axis it forgets (that variation lives in the fiber).
const CARRIES: Record<MediumId, { tension: boolean; reach: boolean; coherence: boolean; phase: boolean }> = {
  sound: { tension: true, reach: true, coherence: true, phase: true },
  visual: { tension: true, reach: true, coherence: true, phase: true },
  text: { tension: false, reach: false, coherence: false, phase: true },
  nav: { tension: false, reach: true, coherence: false, phase: true },
  tactile: { tension: true, reach: true, coherence: true, phase: true },
};

type Mark = "hold" | "fail" | "na";

type TableSnapshot = {
  verdicts: ReturnType<typeof verify>;
  grid: Record<MediumId, Record<InvariantId, Mark>>;
  crossings: number;
};

// A medium's proxy for an axis, read back through its compiler output.
function tensionProxy(medium: MediumId, s: State, p: Params): number | null {
  if (!CARRIES[medium].tension) return null;
  if (medium === "sound") return compileSound(s, p).dissonance;
  if (medium === "visual") return compileVisual(s, p).gather;
  if (medium === "tactile") return (compileTactile(s).tickHz - 1) / 7;
  return s.tension;
}
function reachProxy(medium: MediumId, s: State, p: Params): number | null {
  if (!CARRIES[medium].reach) return null;
  if (medium === "sound") return compileSound(s, p).spread;
  if (medium === "visual") return (compileVisual(s, p).radius - 0.15) / 0.85;
  if (medium === "nav") return compileNav(s).openCells / NAV_GRID;
  if (medium === "tactile") return compileTactile(s).presence;
  return s.reach;
}

// Run the five invariant predicates against each compiler's output over a
// rolling buffer — this is the room's thesis surface, computed live.
function buildGrid(
  buffer: State[],
  params: Params,
  hysteresisSeen: boolean,
  conservationOk: boolean,
): Record<MediumId, Record<InvariantId, Mark>> {
  // longest recent run of consecutive gathering states (accumulation window)
  let accRun: State[] = [];
  let cur: State[] = [];
  for (const s of buffer) {
    if (s.phase === "gathering") cur.push(s);
    else {
      if (cur.length > accRun.length) accRun = cur;
      cur = [];
    }
  }
  if (cur.length > accRun.length) accRun = cur;

  // longest recent run of agency/rest decay (reach falling)
  let decRun: State[] = [];
  cur = [];
  for (const s of buffer) {
    if (s.phase === "agency" || s.phase === "rest") cur.push(s);
    else {
      if (cur.length > decRun.length) decRun = cur;
      cur = [];
    }
  }
  if (cur.length > decRun.length) decRun = cur;

  // a threshold appears in the buffer (the discontinuity's signature)
  const sawThreshold = buffer.some((s) => s.phase === "threshold");
  const sawRestAfterAgency = decRun.some((s) => s.phase === "rest");

  const grid = {} as Record<MediumId, Record<InvariantId, Mark>>;
  for (const medium of MEDIA) {
    const c = CARRIES[medium];
    const row = {} as Record<InvariantId, Mark>;

    // (i) accumulation — tension monotone rising while gathering
    if (!c.tension) row.accum = "na";
    else {
      const vals = accRun.map((s) => tensionProxy(medium, s, params)!).filter((v) => v != null);
      row.accum = vals.length >= 3 ? (isMonotoneRising(vals, 1e-6) ? "hold" : "fail") : "na";
    }

    // (ii) discontinuity — a finite reach jump across the threshold
    if (medium === "text") row.jump = sawThreshold ? "hold" : "na";
    else if (!c.reach) row.jump = "na";
    else {
      let jump = 0;
      for (let i = 1; i < buffer.length; i++) {
        if (buffer[i - 1].phase === "gathering" && buffer[i].phase === "threshold") {
          const a = reachProxy(medium, buffer[i - 1], params)!;
          const b = reachProxy(medium, buffer[i], params)!;
          jump = Math.max(jump, b - a);
        }
      }
      row.jump = jump > 0 ? (jump > 0.12 ? "hold" : "fail") : "na";
    }

    // (iii) hysteresis — the crossing recurs, and cheaper (a run property)
    row.hyst = hysteresisSeen ? "hold" : sawThreshold ? "fail" : "na";

    // (iv) conservation — needs all three axes to witness Q
    if (!(c.tension && c.reach && c.coherence)) row.cons = "na";
    else row.cons = sawThreshold ? (conservationOk ? "hold" : "fail") : "na";

    // (v) decay — presence monotone falling toward rest
    if (medium === "text") row.decay = sawRestAfterAgency ? "hold" : "na";
    else if (!c.reach) row.decay = "na";
    else {
      const vals = decRun.map((s) => reachProxy(medium, s, params)!);
      row.decay = vals.length >= 3 && sawRestAfterAgency ? (isMonotoneFalling(vals, 1e-6) ? "hold" : "fail") : "na";
    }

    grid[medium] = row;
  }
  return grid;
}

export default function StructureLoom() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [keptCrossings, setKeptCrossings] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx: CanvasRenderingContext2D = context;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const params: Params = structureFromSeed(SEED).params;

    // ——— the one structure ———
    let s: State = initialState();
    let pour = 0; // attention poured this moment (0..1), decays each frame
    let choice = 0; // -1..1 selection bias (pinch / arrows at agency)
    let clockScale = 1; // 3-finger hold dilates the structure's clock
    let tiltLean = 0; // vessel/wind leans the gathering
    let lens = 0; // 0 = five embodiments, 1 = bare structure
    let lensTarget = 0;
    let lastPhase: Phase = s.phase;
    let lastCross = 0; // audio time of last threshold entry (for flashes)
    let selShift = 0; // most recent selection shift, for the readout

    // persistence — a small kept-crossings count (the only memory this room asks)
    let crossings = 0;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { crossings?: number };
        if (typeof parsed.crossings === "number") crossings = Math.max(0, Math.floor(parsed.crossings));
      }
    } catch {
      /* a fresh loom */
    }
    setKeptCrossings(crossings);
    const saveCrossings = () => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ crossings }));
      } catch {
        /* noop */
      }
      setKeptCrossings(crossings);
    };

    // hysteresis / conservation evidence for the live table
    const buffer: State[] = [];
    let pouredThisRun = 0;
    let firstCrossInput = 0;
    let hysteresisSeen = false;
    let conservationOk = true;
    let qBeforeCross = 0;

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    // ——— sound: two continuous voices track dissonance (tension) and reach,
    // released at rest; a resolved chord + bell at the crossing. ———
    let toneLive = false;
    const startTones = () => {
      toneLive = true;
    };
    const stopTones = () => {
      if (!toneLive) return;
      toneLive = false;
      audio.releaseConcernTone("risk");
      audio.releaseConcernTone("future");
    };
    const driveSound = () => {
      const spec = compileSound(s, params);
      if (spec.phase === "latent" || spec.phase === "rest") {
        stopTones();
        return;
      }
      startTones();
      // tension → a taut, beating voice; reach → a higher, opening voice.
      audio.holdConcernTone("risk", spec.dissonance * 100);
      audio.holdConcernTone("future", 24 + spec.spread * 74);
    };

    // ——— the vessel: tilt leans the gathering; shake scatters coherence ———
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (!reduced) tiltLean = Math.max(-1, Math.min(1, gamma / 40));
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        s = { ...s, coherence: Math.max(0, s.coherence - 0.15 * intensity) };
        haptics.chop();
      },
    });

    // ——— pouring attention: a pulse (tap) or a sustained pour (hold) ———
    const pourPulse = (amount: number) => {
      pour = Math.min(1, pour + amount);
      audio.start();
      startTones();
    };

    // ——— the selection ceremony (agency only) ———
    const doSelect = () => {
      if (s.phase !== "agency") return;
      const sel = select(s, choice);
      s = sel.state;
      selShift = sel.shift;
      audio.chime();
      haptics.bloom();
    };

    const detachGestures = attachGestures(
      canvas,
      {
        tap: (e) => {
          audio.start();
          if (e.fingers === 3) {
            // tutti — one soft synchronized pulse of everything alive.
            pour = Math.min(1, pour + 0.12);
            audio.chime();
            haptics.ripple(0.4);
            return;
          }
          if (e.fingers === 2) {
            // step back — a raised lens lowers.
            if (lensTarget > 0.5) {
              lensTarget = 0;
              haptics.lens();
            }
            return;
          }
          pourPulse(0.14 + 0.2 * e.intensity);
          audio.playNote(46 + Math.round(s.tension * 22 + s.reach * 8), 200);
          haptics.tap();
        },
        hold: (e) => {
          if (e.fingers === 3) {
            // three-finger hold = time dilation while held.
            clockScale = e.phase === "release" ? 1 : 0.25;
            return;
          }
          if (e.fingers !== 1) return;
          audio.start();
          if (e.phase === "enter") {
            pourPulse(0.1);
            haptics.ripple(0.4);
          }
          if (e.phase === "tick") {
            // duration is an axis: pour harder the longer you hold.
            pour = Math.min(1, pour + (0.5 + e.elapsed / 3000) * (1 / 60));
          }
          // ceremony at agency: the one solemn act — keep a future, once,
          // on release, and SEE the reach open.
          if (e.phase === "release" && e.tier >= 3 && s.phase === "agency") doSelect();
        },
        drag: (e) => {
          if (e.fingers === 3 && !reduced) {
            // wind — the law layer leans the whole gathering.
            tiltLean = Math.max(-1, Math.min(1, tiltLean + e.dx * 0.003));
          }
        },
        pinch: (e) => {
          // off-axis (no scale here): pinch reaches for far vs. near futures
          // at agency — the selection bias, felt live in the shift readout.
          choice = Math.max(-1, Math.min(1, choice + (e.scale - 1) * 1.2));
          if (s.phase === "agency") selShift = selectionShift(s, choice);
        },
        twist: (e) => {
          if (e.fingers === 3) return; // three fingers turn the season, not the lens
          if (e.phase !== "move") return;
          lensTarget = Math.max(0, Math.min(1, lensTarget + e.angle / 1.6));
        },
        scrub: () => {
          pour = Math.min(1, pour + 0.12);
          haptics.ripple(0.4);
        },
      },
      { wheelZoom: false },
    );

    // ——— keyboard: nothing is touch-only ———
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        pourPulse(0.16);
        audio.playNote(46 + Math.round(s.tension * 22), 200);
        haptics.tap();
      } else if (e.key === "Enter") {
        e.preventDefault();
        // enter pours; at agency it is also the keep — the keyboard ceremony.
        if (s.phase === "agency") doSelect();
        else {
          pourPulse(0.16);
          audio.playNote(46 + Math.round(s.tension * 22), 200);
          haptics.tap();
        }
      } else if (e.key === "ArrowUp") {
        choice = Math.min(1, choice + 0.15);
        if (s.phase === "agency") selShift = selectionShift(s, choice);
      } else if (e.key === "ArrowDown") {
        choice = Math.max(-1, choice - 0.15);
        if (s.phase === "agency") selShift = selectionShift(s, choice);
      } else if (e.key === "l" || e.key === "L") {
        lensTarget = lensTarget > 0.5 ? 0 : 1;
        haptics.lens();
      } else if (e.key === "Escape") {
        lensTarget = 0;
      }
    };
    window.addEventListener("keydown", onKey);

    // ——— the shared clock ———
    let raf = 0;
    let last = audio.getAudioTime() ?? performance.now() / 1000;
    let tableAt = 0;

    const palette = {
      bg: "#07090e",
      ink: "#e9edf6",
      dim: "rgba(233,237,246,0.32)",
      faint: "rgba(233,237,246,0.13)",
      warm: `hsl(${params.hueDeg}, 70%, 62%)`,
      cool: `hsl(${(params.hueDeg + 190) % 360}, 66%, 60%)`,
      crossed: "#f4d37a",
    };

    const draw = () => {
      const now = audio.getAudioTime() ?? performance.now() / 1000;
      let dt = now - last;
      last = now;
      if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
      dt *= clockScale;

      // ——— advance the ONE structure ———
      // tilt leans the gathering: a lean adds a little attention on its side.
      const attention = Math.min(1, pour + Math.max(0, tiltLean) * 0.12);
      const prev = s;
      s = step(s, { attention, renew: attention }, dt, params);
      pour *= reduced ? 0.9 : 0.92;
      pouredThisRun += attention * dt;

      // phase-change events fire across all substrates in the same frame.
      if (s.phase !== lastPhase) {
        if (s.phase === "threshold") {
          lastCross = now;
          qBeforeCross = conservedQuantity(prev);
          // resolved chord + bell — the sound's phase transition.
          const spec = compileSound(s, params);
          audio.bell();
          audio.playTone(spec.rootHz, 1.4);
          audio.playTone(spec.rootHz * 1.5, 1.2);
          audio.playTone(spec.rootHz * 2 * (1 + spec.spread * 0.02), 1.0);
          haptics.bloom();
          // conservation evidence + hysteresis bookkeeping
          conservationOk = Math.abs(conservedQuantity(s) - qBeforeCross) < 1e-6;
          crossings += 1;
          if (firstCrossInput === 0) firstCrossInput = pouredThisRun;
          else if (pouredThisRun < firstCrossInput - 1e-6) hysteresisSeen = true;
          pouredThisRun = 0;
          saveCrossings();
        } else if (s.phase === "rest") {
          audio.thud();
          stopTones();
          haptics.roll();
          choice = 0;
          selShift = 0;
        } else if (s.phase === "agency") {
          haptics.detent();
        }
        lastPhase = s.phase;
      }

      driveSound();

      // rolling buffer for the live invariant table
      buffer.push(s);
      if (buffer.length > 220) buffer.shift();

      // ——— render ———
      const breath = reduced ? 0.5 : Math.sin(now * Math.PI * 2 * 0.14) * 0.5 + 0.5;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, width, height);

      if (lens > 0.02) drawLens(now);
      if (lens < 0.98) drawEmbodiments(now, breath);

      // update the table snapshot a few times a second (not every frame)
      if (now - tableAt > 0.25) {
        tableAt = now;
        setSnapshot({
          verdicts: verify(s, params),
          grid: buildGrid(buffer, params, hysteresisSeen, conservationOk),
          crossings,
        });
      }

      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      raf = requestAnimationFrame(draw);
    };

    // ——— the five embodiments, side by side, from the one S ———
    function drawEmbodiments(now: number, breath: number) {
      const alpha = 1 - lens;
      const pad = 16;
      const labelW = width < 460 ? 54 : 78;
      const n = 5;
      const laneH = (height - pad * 2) / n;
      const laneX = pad + labelW;
      const laneW = width - pad - laneX;

      const sound = compileSound(s, params);
      const visual = compileVisual(s, params);
      const text = compileText(s);
      const nav = compileNav(s);
      const tactile = compileTactile(s);
      const crossFlash = Math.max(0, 1 - (now - lastCross) / 0.9);

      const label = (row: number, name: string) => {
        ctx.fillStyle = `rgba(233,237,246,${0.34 * alpha})`;
        ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
        ctx.textAlign = "left";
        ctx.fillText(name, pad, pad + laneH * row + laneH / 2 + 3);
      };
      const laneTop = (row: number) => pad + laneH * row;
      const cy = (row: number) => laneTop(row) + laneH / 2;

      // 1 — sound: voices spread by reach, beating by dissonance
      {
        const row = 0;
        label(row, "sound");
        const voices = params.voices;
        const base = laneTop(row) + laneH * 0.72;
        for (let i = 0; i < voices; i++) {
          const u = voices === 1 ? 0 : i / (voices - 1);
          const y = base - u * laneH * 0.5 * (0.3 + sound.spread);
          const x = laneX + laneW * (0.1 + 0.8 * u);
          const beat = reduced ? 0 : Math.sin(now * (5 + sound.dissonance * 9) + i) * sound.dissonance;
          const r = 3 + sound.harmonicity * 3 + breath * 1.4;
          ctx.beginPath();
          ctx.fillStyle = `hsla(${params.hueDeg + u * 60}, 70%, 62%, ${(0.3 + 0.5 * sound.harmonicity) * alpha})`;
          ctx.arc(x + beat * 4, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (sound.resolve) {
          ctx.strokeStyle = `rgba(244,211,122,${0.3 * alpha})`;
          ctx.beginPath();
          ctx.moveTo(laneX, base + 6);
          ctx.lineTo(laneX + laneW, base + 6);
          ctx.stroke();
        }
      }

      // 2 — visual: a sigil polygon that gathers then snaps symmetry
      {
        const row = 1;
        label(row, "shape");
        const c = { x: laneX + laneW * 0.5, y: cy(row) };
        const rad = Math.min(laneH, laneW) * 0.42 * visual.radius;
        const sym = visual.symmetry;
        ctx.beginPath();
        for (let i = 0; i <= sym; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / sym;
          const jitter = reduced ? 0 : Math.sin(now * 2 + i) * visual.gather * rad * 0.14;
          const rr = rad + jitter - visual.gather * rad * 0.18 + tiltLean * 6;
          const x = c.x + Math.cos(a) * rr;
          const y = c.y + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${params.hueDeg}, 72%, ${52 + visual.lock * 22}%, ${(0.4 + 0.5 * visual.lock) * alpha})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        if (crossFlash > 0) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, rad + crossFlash * 22, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(244,211,122,${0.5 * crossFlash * alpha})`;
          ctx.stroke();
        }
      }

      // 3 — text: the tiered line
      {
        const row = 2;
        label(row, "text");
        ctx.fillStyle = `rgba(233,237,246,${0.72 * alpha})`;
        ctx.font = `300 ${width < 460 ? 12 : 14}px ui-serif, Georgia, 'Times New Roman', serif`;
        ctx.textAlign = "left";
        wrapText(ctx, text.line, laneX, cy(row) - 6, laneW, 17);
      }

      // 4 — nav: a corridor, penned then open (reach = traversable fraction)
      {
        const row = 3;
        label(row, "space");
        const cells = 24;
        const open = Math.round((nav.openCells / NAV_GRID) * cells);
        const cw = laneW / cells;
        const y = cy(row);
        for (let i = 0; i < cells; i++) {
          const lit = i < open;
          ctx.fillStyle = lit
            ? `hsla(${(params.hueDeg + 190) % 360}, 66%, 60%, ${(0.28 + 0.5 * (1 - i / cells)) * alpha})`
            : `rgba(233,237,246,${0.06 * alpha})`;
          ctx.fillRect(laneX + i * cw + 1, y - 7, cw - 2, 14);
        }
        // the token, free to walk only the lit corridor
        const tx = laneX + Math.max(0.5, open - 0.5) * cw;
        ctx.beginPath();
        ctx.fillStyle = `rgba(244,211,122,${(nav.penned ? 0.5 : 0.95) * alpha})`;
        ctx.arc(tx, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 5 — tactile: ticks, a bloom, a sustained presence bar
      {
        const row = 4;
        label(row, "touch");
        const y = cy(row);
        const period = 1 / tactile.tickHz;
        const phaseFrac = ((now % period) / period);
        const nticks = 7;
        for (let i = 0; i < nticks; i++) {
          const x = laneX + (laneW * (i + 0.5)) / nticks;
          const on = reduced ? 0.4 : Math.max(0, 1 - Math.abs(((i / nticks) - phaseFrac + 1) % 1) * 6);
          ctx.beginPath();
          ctx.fillStyle = `rgba(233,237,246,${(0.12 + 0.5 * on) * alpha})`;
          ctx.arc(x, y - 8, 2 + on * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // sustained presence bar
        ctx.fillStyle = `hsla(${params.hueDeg}, 60%, 60%, ${0.5 * alpha})`;
        ctx.fillRect(laneX, y + 6, laneW * tactile.presence, 4);
        if (tactile.bloom || crossFlash > 0.2) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(244,211,122,${0.5 * (tactile.bloom ? 1 : crossFlash) * alpha})`;
          ctx.arc(laneX + laneW * tactile.presence, y + 8, 6 + crossFlash * 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // the current phase, quietly named at the very top
      ctx.fillStyle = `rgba(233,237,246,${0.3 * alpha})`;
      ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${s.phase}`, width - pad, pad + 2);
    }

    // ——— the lens: the bare structure — phase portrait, conserved
    // quantity, hysteresis loop — in thin hairlines + mono. ———
    function drawLens(now: number) {
      const a = lens;
      ctx.fillStyle = `rgba(7,9,14,${a * 0.9})`;
      ctx.fillRect(0, 0, width, height);
      const pad = 28;
      const cx = width * 0.5;
      const cy = height * 0.44;
      const R = Math.min(width, height) * 0.3;
      ctx.strokeStyle = `rgba(233,237,246,${0.5 * a})`;
      ctx.fillStyle = `rgba(233,237,246,${0.5 * a})`;
      ctx.lineWidth = 1;
      ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
      ctx.textAlign = "left";

      // axes: tension (x) vs reach (y) — the phase portrait
      ctx.beginPath();
      ctx.moveTo(cx - R, cy + R);
      ctx.lineTo(cx + R, cy + R);
      ctx.moveTo(cx - R, cy + R);
      ctx.lineTo(cx - R, cy - R);
      ctx.stroke();
      ctx.fillText("tension →", cx + R - 60, cy + R + 14);
      ctx.save();
      ctx.translate(cx - R - 8, cy - R + 60);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("reach →", 0, 0);
      ctx.restore();

      // the two thresholds (hysteresis loop): first high, second low
      const px = (t: number) => cx - R + t * 2 * R;
      const py = (r: number) => cy + R - r * 2 * R;
      for (const [t, lab] of [
        [0.82, "θ₁"],
        [0.52, "θ₂ (visited)"],
      ] as [number, string][]) {
        ctx.strokeStyle = `rgba(244,211,122,${0.3 * a})`;
        ctx.beginPath();
        ctx.moveTo(px(t), cy - R);
        ctx.lineTo(px(t), cy + R);
        ctx.stroke();
        ctx.fillStyle = `rgba(244,211,122,${0.6 * a})`;
        ctx.fillText(lab, px(t) + 3, cy - R + 12);
      }

      // the hysteresis trajectory sketch: accumulate right along low reach,
      // jump up at θ, decay left-down back to rest, re-enter at θ₂.
      ctx.strokeStyle = `rgba(233,237,246,${0.28 * a})`;
      ctx.beginPath();
      ctx.moveTo(px(0), py(0.12));
      ctx.lineTo(px(0.82), py(0.12));
      ctx.lineTo(px(0.18), py(0.5)); // the jump + slump
      ctx.lineTo(px(0), py(0.12));
      ctx.stroke();

      // the live point
      ctx.beginPath();
      ctx.fillStyle = `rgba(244,211,122,${0.95 * a})`;
      ctx.arc(px(s.tension), py(s.reach), 4.5, 0, Math.PI * 2);
      ctx.fill();

      // conserved quantity bar
      const q = conservedQuantity(s);
      ctx.fillStyle = `rgba(233,237,246,${0.5 * a})`;
      ctx.fillText(`Q = tension + reach + coherence = ${q.toFixed(3)}  (conserved across the crossing)`, pad, height - pad - 26);
      ctx.strokeStyle = `rgba(233,237,246,${0.3 * a})`;
      ctx.strokeRect(pad, height - pad - 20, width - pad * 2, 8);
      ctx.fillStyle = `hsla(${params.hueDeg}, 66%, 60%, ${0.6 * a})`;
      ctx.fillRect(pad, height - pad - 20, (width - pad * 2) * Math.min(1, q / 2), 8);

      // the reachable-future landscape at agency (selection made abstract)
      if (s.phase === "agency" || s.phase === "threshold") {
        const region = reachableRegion(s, choice);
        const gw = (width - pad * 2) / region.length;
        for (let i = 0; i < region.length; i++) {
          ctx.fillStyle = `rgba(244,211,122,${region[i] * 0.5 * a})`;
          ctx.fillRect(pad + i * gw + 1, cy + R + 26, gw - 2, 10);
        }
        ctx.fillStyle = `rgba(233,237,246,${0.5 * a})`;
        ctx.fillText(`reachable futures · selection shift ${selShift.toFixed(3)}`, pad, cy + R + 22);
      }
      void now;
    }

    raf = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      detachGestures();
      detachVessel();
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      stopTones();
    };
  }, []);

  // ——— the quiet clear: only present because the loom keeps its crossings ———
  const letGo = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ crossings: 0 }));
    } catch {
      /* noop */
    }
    setKeptCrossings(0);
    getFieldAudio().thud();
    haptics.roll();
  };

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#07090e" }}>
      <canvas
        ref={canvasRef}
        role="application"
        aria-label="loom — one structure compiled into sound, shape, text, space, and touch at once; tap and hold to pour attention and raise the tension, and when it crosses the threshold all five substrates cross in the same frame; at agency, pinch or the arrows choose a future and a held touch keeps it; twist raises the lens onto the bare structure; enter or space pours, escape lowers the lens"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      {snapshot && <VerificationTable snapshot={snapshot} />}
      <LetGo label="let the crossings go" onLetGo={letGo} visible={keptCrossings > 0} />
    </div>
  );
}

// ——— the verification table: quiet, always-live, mono, lowercase. The
// commuting diagrams made visible — each substrate proven to carry the same
// invariant right now. ✓ = holds, · = the fiber (this medium forgets that
// axis), ✗ = would mean a broken compiler. ———
function VerificationTable({ snapshot }: { snapshot: TableSnapshot }) {
  const mark = (m: Mark) => (m === "hold" ? "✓" : m === "fail" ? "✗" : "·");
  const invLabels: Record<InvariantId, string> = {
    accum: "acc",
    jump: "jmp",
    hyst: "hys",
    cons: "cns",
    decay: "dcy",
  };
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        padding: "10px 12px",
        fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
        fontSize: 10,
        lineHeight: 1.5,
        color: "rgba(233,237,246,0.5)",
        letterSpacing: "0.04em",
        pointerEvents: "none",
        userSelect: "none",
        borderLeft: "1px solid rgba(233,237,246,0.12)",
        background: "rgba(7,9,14,0.35)",
      }}
    >
      <div style={{ opacity: 0.7, marginBottom: 4 }}>one structure · five proofs</div>
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ opacity: 0.55 }}>
            <th style={{ textAlign: "left", fontWeight: 300, paddingRight: 8 }}> </th>
            {INVARIANTS.map((inv) => (
              <th key={inv} style={{ fontWeight: 300, padding: "0 3px" }}>
                {invLabels[inv]}
              </th>
            ))}
            <th style={{ fontWeight: 300, paddingLeft: 8 }}>ε</th>
          </tr>
        </thead>
        <tbody>
          {MEDIA.map((medium) => {
            const verdict = snapshot.verdicts.find((v) => v.medium === medium);
            const preserves = verdict?.preserves ?? true;
            return (
              <tr key={medium}>
                <td style={{ paddingRight: 8, opacity: 0.8 }}>{medium}</td>
                {INVARIANTS.map((inv) => {
                  const m = snapshot.grid[medium][inv];
                  return (
                    <td
                      key={inv}
                      style={{
                        textAlign: "center",
                        padding: "0 3px",
                        color:
                          m === "hold"
                            ? "rgba(244,211,122,0.9)"
                            : m === "fail"
                              ? "rgba(240,120,120,0.9)"
                              : "rgba(233,237,246,0.22)",
                      }}
                    >
                      {mark(m)}
                    </td>
                  );
                })}
                <td
                  style={{
                    paddingLeft: 8,
                    textAlign: "right",
                    color: preserves ? "rgba(233,237,246,0.5)" : "rgba(240,120,120,0.9)",
                  }}
                >
                  {preserves ? "✓" : "✗"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ opacity: 0.5, marginTop: 5 }}>kept crossings · {snapshot.crossings}</div>
    </div>
  );
}

// tiny word-wrap for canvas text
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lh: number,
) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}
