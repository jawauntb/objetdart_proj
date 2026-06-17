"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";

/**
 * PhaseChart — per-phase candlestick whose SHAPE is the phenomenology.
 *
 * The thesis of /waves is candle ↔ candlestick ↔ chart ↔ wave: each phase
 * of the poem already names a market regime by the way it feels. This
 * component turns that intuition literal — a tiny chart drawn with the
 * data generator that matches the phase's kinesthesia.
 *
 * Interactivity (added second pass):
 *   - hover a candle → it scales 1.15× + alpha→1.0, tooltip with OHLC
 *   - click a candle → playNote() at a pitch from the phase's mood scale
 *   - drag across candles → plays them in sequence (~150ms rate-limited)
 *
 * The cascade draw-in still runs once on IntersectionObserver entry.
 */

type Kind =
  | "weather"
  | "cultivation"
  | "city"
  | "commute"
  | "ocean"
  | "feeling"
  | "seismograph"
  | "flame"
  | "coda";

type Candle = {
  open: number;
  close: number;
  high: number;
  low: number;
};

/** A laid-out candle: data + its hit-test rect in CSS pixel space. */
type LaidCandle = Candle & {
  index: number;
  cx: number;     // center x in CSS px
  hitX: number;   // hit-test rect left edge in CSS px
  hitW: number;   // hit-test rect width in CSS px
};

const CANDLE_COUNT = 24;
const CHART_HEIGHT = 96;
const DRAW_IN_MS = 800;
// Min ms between drag-scrub notes — fast enough to feel like piano keys,
// slow enough that a fast drag doesn't strobe the audio bus.
const DRAG_NOTE_MS = 150;

// ── mood-scale config ────────────────────────────────────────────────────

type ScaleSpec = {
  /** MIDI of scale-degree 0 (tonic). */
  root: number;
  /** Semitone offsets from root, ordered low → high. */
  steps: number[];
};

/**
 * Per-phase mood scale → MIDI notes. Matches the natural-language
 * convention used elsewhere in composeMusic: weather=pentatonic minor,
 * cultivation=pentatonic major, city=natural minor, commute=dorian,
 * ocean=mixolydian, feeling=lydian, seismograph=aeolian, flame=phrygian
 * dominant, coda=ionian.
 */
const PHASE_SCALES: Record<Kind, ScaleSpec> = {
  weather:     { root: 50, steps: [0, 3, 5, 7, 10] },           // pent minor on D4
  cultivation: { root: 48, steps: [0, 2, 4, 7, 9] },            // pent major on C4
  city:        { root: 45, steps: [0, 2, 3, 5, 7, 8, 10] },     // aeolian on A3
  commute:     { root: 50, steps: [0, 2, 3, 5, 7, 9, 10] },     // dorian on D4
  ocean:       { root: 43, steps: [0, 2, 4, 5, 7, 9, 10] },     // mixolydian on G3
  feeling:     { root: 53, steps: [0, 2, 4, 6, 7, 9, 11] },     // lydian on F4
  seismograph: { root: 45, steps: [0, 2, 3, 5, 7, 8, 10] },     // aeolian on A3
  flame:       { root: 50, steps: [0, 1, 4, 5, 7, 8, 10] },     // phrygian dom on D4
  coda:        { root: 48, steps: [0, 2, 4, 5, 7, 9, 11] },     // ionian on C4
};

/**
 * Map a candle's close value (in series-normalised space) to a MIDI
 * pitch on the phase scale. yMin/yMax are passed so we get a stable
 * mapping across the whole series, not per-call. Spans two octaves
 * so the chart sings across a meaningful range.
 */
function closeToMidi(
  close: number,
  yMin: number,
  yMax: number,
  spec: ScaleSpec,
): number {
  const span = yMax - yMin || 1;
  const t = Math.max(0, Math.min(1, (close - yMin) / span));
  // ~14 degrees ≈ 2 octaves of the scale
  const degCount = spec.steps.length * 2;
  const degIdx = Math.min(degCount - 1, Math.floor(t * degCount));
  const stepIdx = degIdx % spec.steps.length;
  const octaveShift = Math.floor(degIdx / spec.steps.length) * 12;
  return spec.root + spec.steps[stepIdx] + octaveShift;
}

// ── seeded PRNG ───────────────────────────────────────────────────────────

function hashKind(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── data generators ───────────────────────────────────────────────────────

/**
 * Build 24 candles whose SHAPE matches the phenomenology of the phase.
 * Each generator returns values centered around 0; the draw step rescales
 * them to fit the canvas. Wicks are derived from local body magnitude
 * with a small per-candle jitter so they don't read mechanical.
 */
function buildSeries(kind: Kind): Candle[] {
  const rnd = mulberry32(hashKind(kind));
  const series: Candle[] = [];

  // First pass: produce a baseline value per candle index. The strategy
  // is per-kind; second pass turns adjacent values into open/close pairs.
  const values: number[] = [];

  switch (kind) {
    case "weather": {
      // low-amplitude noise around a slow-drifting mean — pressure arriving
      let mean = 0;
      for (let i = 0; i <= CANDLE_COUNT; i++) {
        mean += (rnd() - 0.5) * 0.06;
        const noise = (rnd() - 0.5) * 0.18;
        values.push(mean + noise);
      }
      break;
    }
    case "cultivation": {
      // low base + occasional gentle bumps every ~5 candles (blooms)
      for (let i = 0; i <= CANDLE_COUNT; i++) {
        const bump = i % 5 === 0 ? 0.55 + rnd() * 0.25 : 0;
        const base = (rnd() - 0.5) * 0.10;
        values.push(base + bump);
      }
      break;
    }
    case "city": {
      // sharp spikes — most candles tiny, then one huge candle every ~4 (sirens)
      for (let i = 0; i <= CANDLE_COUNT; i++) {
        if (i % 4 === 0) {
          values.push((rnd() > 0.5 ? 1 : -1) * (0.85 + rnd() * 0.4));
        } else {
          values.push((rnd() - 0.5) * 0.14);
        }
      }
      break;
    }
    case "commute": {
      // stepped — flat for 5, sharp rise for 2, flat for 5, rise...
      // (regime crossings: bus chop → train flow → stairs → street...)
      let level = 0;
      for (let i = 0; i <= CANDLE_COUNT; i++) {
        const cycle = i % 7;
        if (cycle >= 5) {
          // rising segment
          level += 0.18 + rnd() * 0.04;
        }
        const jitter = (rnd() - 0.5) * 0.06;
        values.push(level + jitter);
      }
      break;
    }
    case "ocean": {
      // smooth sine — all small body, traced from sin(i * 0.3)
      for (let i = 0; i <= CANDLE_COUNT; i++) {
        values.push(Math.sin(i * 0.3) * 0.75);
      }
      break;
    }
    case "feeling": {
      // rising amplitude sine — feeling building into a map
      for (let i = 0; i <= CANDLE_COUNT; i++) {
        values.push(Math.sin(i * 0.4) * (i / CANDLE_COUNT) * 1.05);
      }
      break;
    }
    case "seismograph": {
      // mostly flat, two prominent spikes — the canonical heartbeat
      const spikeAt1 = Math.floor(CANDLE_COUNT * 0.35);
      const spikeAt2 = Math.floor(CANDLE_COUNT * 0.72);
      for (let i = 0; i <= CANDLE_COUNT; i++) {
        if (i === spikeAt1 || i === spikeAt2) {
          values.push(1.1);
        } else if (i === spikeAt1 + 1 || i === spikeAt2 + 1) {
          values.push(-0.85);
        } else {
          values.push((rnd() - 0.5) * 0.06);
        }
      }
      break;
    }
    case "flame": {
      // flickering — base value with high-freq ±30% jitter
      let base = 0.2;
      for (let i = 0; i <= CANDLE_COUNT; i++) {
        base += (rnd() - 0.5) * 0.08;
        const jitter = (rnd() - 0.5) * 0.6;
        values.push(base + jitter);
      }
      break;
    }
    case "coda": {
      // long flat baseline; the very last candle is a single tall spike
      for (let i = 0; i <= CANDLE_COUNT; i++) {
        if (i === CANDLE_COUNT - 1 || i === CANDLE_COUNT) {
          values.push(i === CANDLE_COUNT - 1 ? -0.05 : 1.3);
        } else {
          values.push((rnd() - 0.5) * 0.04);
        }
      }
      break;
    }
  }

  // Second pass: turn the value series into open/close/high/low.
  for (let i = 0; i < CANDLE_COUNT; i++) {
    const open = values[i] ?? 0;
    const close = values[i + 1] ?? open;
    const bodyMag = Math.abs(close - open);
    // Wick proportions vary slightly per-kind so flame reads jagged
    // while ocean reads clean.
    const wickScale =
      kind === "flame"
        ? 0.45 + rnd() * 0.35
        : kind === "ocean"
          ? 0.10 + rnd() * 0.08
          : kind === "city" || kind === "seismograph"
            ? 0.35 + rnd() * 0.25
            : 0.22 + rnd() * 0.18;
    const wickUp = bodyMag * wickScale + (rnd() * 0.05);
    const wickDn = bodyMag * wickScale + (rnd() * 0.05);
    const top = Math.max(open, close);
    const bot = Math.min(open, close);
    series.push({
      open,
      close,
      high: top + wickUp,
      low: bot - wickDn,
    });
  }

  return series;
}

// ── component ─────────────────────────────────────────────────────────────

export default function PhaseChart({
  kind,
  accent,
}: {
  kind: Kind;
  accent: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Hit-test layout for the most recent resize. Read on pointer events.
  const layoutRef = useRef<LaidCandle[]>([]);
  // y-range used for both draw and pitch mapping. Stored so close→midi
  // matches what the user sees.
  const yRangeRef = useRef<{ yMin: number; yMax: number }>({ yMin: 0, yMax: 1 });
  // Drag scrubbing state — last candle index played + last play timestamp.
  // Refs so we don't trigger renders during pointermove.
  const dragRef = useRef<{ active: boolean; lastIdx: number; lastAt: number }>({
    active: false, lastIdx: -1, lastAt: 0,
  });

  // Hovered candle drives both the canvas highlight (re-draw) and the
  // tooltip in the DOM overlay.
  const [hoverIdx, setHoverIdx] = useState<number>(-1);
  // Tooltip position in CSS px relative to the wrapper. Kept in state so
  // React positions the tooltip after the hover changes.
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const series = buildSeries(kind);

    // y-scale across all candles
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const c of series) {
      if (c.low < yMin) yMin = c.low;
      if (c.high > yMax) yMax = c.high;
    }
    const span = yMax - yMin || 1;
    const yPad = span * 0.10;
    yMin -= yPad;
    yMax += yPad;
    yRangeRef.current = { yMin, yMax };

    /**
     * Recompute the per-candle hit-test layout. Called after every
     * resize so layoutRef matches the current CSS pixel coordinates.
     */
    const rebuildLayout = () => {
      const w = canvas.clientWidth;
      const padL = 4;
      const padR = 4;
      const innerW = w - padL - padR;
      const slot = innerW / CANDLE_COUNT;
      const next: LaidCandle[] = [];
      for (let i = 0; i < series.length; i++) {
        const cx = padL + i * slot + slot / 2;
        next.push({
          ...series[i],
          index: i,
          cx,
          hitX: padL + i * slot,
          hitW: slot,
        });
      }
      layoutRef.current = next;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rebuildLayout();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Closure over current hover state for redraws. We read the latest
    // from a ref to avoid stale-closure bugs during the cascade tick.
    let currentHover = -1;

    // Draw the chart with a per-candle progress array. progress[i] in
    // [0,1] = how much of candle i's body is currently expressed.
    const drawAt = (progress: number[]) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const padL = 4;
      const padR = 4;
      const innerW = w - padL - padR;
      const slot = innerW / CANDLE_COUNT;
      const bodyW = Math.max(2, Math.min(12, slot * 0.62));

      const yOf = (p: number): number => {
        const t = (p - yMin) / (yMax - yMin);
        return h - t * h;
      };

      for (let i = 0; i < series.length; i++) {
        const c = series[i];
        const t = progress[i] ?? 1;
        if (t <= 0) continue;

        const cx = padL + i * slot + slot / 2;
        const up = c.close >= c.open;
        const isHovered = i === currentHover && !reduce;
        const scale = isHovered ? 1.15 : 1;
        const drawBodyW = bodyW * scale;

        const yOpen = yOf(c.open);
        const yClose = yOf(c.close);
        const yHigh = yOf(c.high);
        const yLow = yOf(c.low);

        // Lerp body + wick lengths from midline outward by t.
        const bodyTop = Math.min(yOpen, yClose);
        const bodyBot = Math.max(yOpen, yClose);
        const bodyMid = (bodyTop + bodyBot) / 2;
        const halfBody = (bodyBot - bodyTop) / 2 * scale;
        const bTop = bodyMid - halfBody * t;
        const bBot = bodyMid + halfBody * t;

        const wickTop = bodyMid - (bodyMid - yHigh) * t;
        const wickBot = bodyMid + (yLow - bodyMid) * t;

        // wick — slightly brighter under hover
        ctx.strokeStyle = isHovered
          ? "rgba(255,255,255,0.85)"
          : "rgba(255,255,255,0.45)";
        ctx.lineWidth = isHovered ? 1.4 : 1;
        ctx.beginPath();
        const cxPx = Math.floor(cx) + 0.5;
        ctx.moveTo(cxPx, wickTop);
        ctx.lineTo(cxPx, wickBot);
        ctx.stroke();

        // body — hover bumps alpha to 1.0
        const bodyAlpha = isHovered ? 1.0 : 0.85;
        const downAlpha = isHovered ? 0.72 : 0.35;
        ctx.fillStyle = up
          ? toRgba(accent, bodyAlpha)
          : `rgba(255,255,255,${downAlpha})`;
        const bodyH = Math.max(1, bBot - bTop);
        ctx.fillRect(cx - drawBodyW / 2, bTop, drawBodyW, bodyH);
      }
    };

    // Expose a public re-render hook so the hover handler in the
    // outer effect can trigger a redraw without re-running the
    // entire setup.
    (canvas as unknown as { __waveDraw: (hover: number) => void }).__waveDraw = (h: number) => {
      currentHover = h;
      // Re-draw assuming the cascade is already complete; on initial
      // mount before scroll-in this just means everything's still at 0.
      drawAt(currentProgress);
    };

    // Keep the most recent progress so the hover re-draw above can
    // reuse it. Updated by the cascade tick.
    let currentProgress: number[] = new Array<number>(CANDLE_COUNT).fill(0);

    if (reduce) {
      // Static, fully drawn — no cascade.
      currentProgress = new Array<number>(CANDLE_COUNT).fill(1);
      drawAt(currentProgress);
      return () => ro.disconnect();
    }

    // IntersectionObserver: when the canvas crosses threshold 0.3,
    // run the draw-in cascade once. Cleaned up on unmount.
    let raf = 0;
    let started = false;
    let startTime = 0;

    const tick = (now: number) => {
      if (!startTime) startTime = now;
      const elapsed = now - startTime;
      const overall = Math.min(1, elapsed / DRAW_IN_MS);
      // Stagger: each candle gets a small window inside [0,1].
      const progress: number[] = new Array(CANDLE_COUNT);
      for (let i = 0; i < CANDLE_COUNT; i++) {
        const start = i / (CANDLE_COUNT + 4);
        const end = start + 4 / (CANDLE_COUNT + 4);
        const local = (overall - start) / (end - start);
        progress[i] = local <= 0 ? 0 : local >= 1 ? 1 : easeOut(local);
      }
      currentProgress = progress;
      drawAt(progress);
      if (overall < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    // Idle initial draw — empty.
    drawAt(currentProgress);

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started) {
            started = true;
            startTime = 0;
            raf = requestAnimationFrame(tick);
          }
        }
      },
      { threshold: 0.3 },
    );
    io.observe(canvas);

    return () => {
      io.disconnect();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [kind, accent]);

  // ── hover redraw bridge ────────────────────────────────────────────────
  // When React state hoverIdx changes we ping the canvas' attached draw
  // hook so the highlight appears without re-running the full effect.
  useEffect(() => {
    const canvas = canvasRef.current as unknown as {
      __waveDraw?: (hover: number) => void;
    } | null;
    if (canvas && typeof canvas.__waveDraw === "function") {
      canvas.__waveDraw(hoverIdx);
    }
  }, [hoverIdx]);

  // ── pointer handlers ───────────────────────────────────────────────────

  /** Find which candle (by index) the pointer is over, or -1. */
  const hitTest = (clientX: number, clientY: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (y < 0 || y > rect.height) return -1;
    const lc = layoutRef.current;
    if (lc.length === 0) return -1;
    // O(log n) would be possible but n=24; linear is fine and clearer.
    for (const c of lc) {
      if (x >= c.hitX && x < c.hitX + c.hitW) return c.index;
    }
    return -1;
  };

  /** Trigger the click-sound for a candle index. */
  const playForCandle = (idx: number) => {
    const lc = layoutRef.current[idx];
    if (!lc) return;
    const { yMin, yMax } = yRangeRef.current;
    const midi = closeToMidi(lc.close, yMin, yMax, PHASE_SCALES[kind]);
    try { getFieldAudio().playNote(midi, 200); } catch { /* noop */ }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const idx = hitTest(e.clientX, e.clientY);
    if (idx !== hoverIdx) {
      setHoverIdx(idx);
      if (idx >= 0) {
        const wrap = wrapRef.current;
        if (wrap) {
          const wrect = wrap.getBoundingClientRect();
          const lc = layoutRef.current[idx];
          const canvas = canvasRef.current;
          const crect = canvas ? canvas.getBoundingClientRect() : wrect;
          setTip({
            x: (crect.left - wrect.left) + lc.cx,
            y: (crect.top - wrect.top) - 6,
          });
        }
      } else {
        setTip(null);
      }
    }
    // drag scrubbing — only if pointer is down and idx advanced
    if (dragRef.current.active && idx >= 0 && idx !== dragRef.current.lastIdx) {
      const now = performance.now();
      if (now - dragRef.current.lastAt >= DRAG_NOTE_MS) {
        playForCandle(idx);
        dragRef.current.lastIdx = idx;
        dragRef.current.lastAt = now;
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const idx = hitTest(e.clientX, e.clientY);
    if (idx < 0) return;
    // immediate click → note. Mark drag so subsequent moves can scrub.
    dragRef.current.active = true;
    dragRef.current.lastIdx = idx;
    dragRef.current.lastAt = performance.now();
    playForCandle(idx);
    // capture pointer so we keep receiving moves outside the wrapper
    try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    dragRef.current.lastIdx = -1;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const onPointerLeave = () => {
    setHoverIdx(-1);
    setTip(null);
    dragRef.current.active = false;
    dragRef.current.lastIdx = -1;
  };

  // Tooltip OHLC for the hovered candle (read at render time).
  const tipCandle = hoverIdx >= 0 ? layoutRef.current[hoverIdx] : null;

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", width: "100%", maxWidth: 540 }}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerLeave}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          display: "block",
          width: "100%",
          maxWidth: 540,
          height: CHART_HEIGHT,
          background: "transparent",
          // help pointer events line up with the candles, not text selection
          touchAction: "none",
          cursor: hoverIdx >= 0 ? "pointer" : "default",
        }}
      />
      {tipCandle && tip ? (
        <div
          aria-hidden="true"
          className="t-mono"
          style={{
            position: "absolute",
            left: tip.x,
            top: tip.y,
            transform: "translate(-50%, -100%)",
            background: "rgba(8,12,20,0.92)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 4,
            padding: "6px 8px",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            fontSize: 10,
            letterSpacing: "0.04em",
            color: "rgba(244,238,222,0.96)",
            // Numeric OHLC reads as Fraunces — same family as the phase numeral.
            fontVariantNumeric: "lining-nums tabular-nums",
            zIndex: 4,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "2px 10px" }}>
            <span style={{ opacity: 0.6 }}>o</span>
            <span style={fraunceNum}>{fmt(tipCandle.open)}</span>
            <span style={{ opacity: 0.6 }}>h</span>
            <span style={fraunceNum}>{fmt(tipCandle.high)}</span>
            <span style={{ opacity: 0.6 }}>l</span>
            <span style={fraunceNum}>{fmt(tipCandle.low)}</span>
            <span style={{ opacity: 0.6 }}>c</span>
            <span style={fraunceNum}>{fmt(tipCandle.close)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

const fraunceNum: React.CSSProperties = {
  fontFamily: "var(--font-fraunces, Georgia, serif)",
  fontVariantNumeric: "lining-nums tabular-nums",
  fontWeight: 500,
};

function fmt(n: number): string {
  // 2 sig figs is more than enough for these synthetic values; keep
  // them right-aligned by using a fixed-width style above.
  const s = n.toFixed(2);
  // strip leading "0." → ".42" for compactness, keep sign
  if (s.startsWith("0.")) return s.slice(1);
  if (s.startsWith("-0.")) return "-" + s.slice(2);
  return s;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 2.2);
}

/**
 * Coerce an arbitrary CSS color string to an rgba() with the given alpha.
 * Handles `#rgb`, `#rrggbb`, `rgb(...)`, and `rgba(...)`. Falls back to the
 * input string if parsing fails — Canvas will then use whatever it can.
 */
function toRgba(color: string, alpha: number): string {
  const s = color.trim();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  const rgbMatch = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }
  return s;
}
