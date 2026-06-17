"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useField } from "@/store/field";
import { getFieldAudio } from "@/lib/audio";
import type { ConcernKey } from "@/lib/types";

/**
 * Charts — /charts route.
 *
 * Trading-style charts as a phenomenology of the room. Three stacked panels:
 *
 *   1. Primary candlestick (40% h)  — 40 procedural candles. Drag any candle
 *      up/down to lengthen its wick that direction. This is the "first
 *      chart the user manipulates."
 *   2. Second-order derivative (30% h) — line plot of rate-of-change on the
 *      Panel-1 closes. Recomputes IN REAL TIME when Panel 1 is touched.
 *      Amber→cyan gradient and a 9-period EMA smoothing line.
 *   3. Oscillator (30% h) — RSI computed from Panel 1's closes. Threshold
 *      bands at 30 / 70. Colour follows the zone the oscillator is in.
 *
 * Feedback loop — the OCEAN influences the chart:
 *   - concerns (especially `risk`) raise base volatility
 *   - recent tape events spike the chart at their time location
 *   - the user manipulating the chart writes back to the tape, which then
 *     informs the next reactive pass
 *
 * No external chart libs. Everything is canvas. 60fps target.
 */

// ── tuning ───────────────────────────────────────────────────────────────

const CANDLE_COUNT = 40;
const RSI_PERIOD = 14;
const EMA_PERIOD = 9;
const DRAG_NOTE_MS = 90;
const PIN_KEY = "objetdart:charts:pinned:v1";

// Panel proportions (fractions of inner viewport)
const P1_FRAC = 0.40;
const P2_FRAC = 0.30;
const P3_FRAC = 0.30;

// ── types ────────────────────────────────────────────────────────────────

type Candle = {
  open: number;
  close: number;
  high: number;
  low: number;
  /** user manipulation in price-units — added to high if positive, low if negative */
  tweak: number;
};

type Snapshot = {
  candles: Candle[];
  volatility: number;
  pinnedAt: number;
};

type Layout = {
  width: number;
  height: number;
  // Panel 1 (candles)
  p1Top: number;
  p1H: number;
  // Panel 2 (derivative)
  p2Top: number;
  p2H: number;
  // Panel 3 (oscillator)
  p3Top: number;
  p3H: number;
  // candle layout (Panel 1)
  padL: number;
  padR: number;
  slot: number;
  bodyW: number;
};

// ── seeded PRNG ──────────────────────────────────────────────────────────

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

// ── noise generator ──────────────────────────────────────────────────────

/**
 * Build CANDLE_COUNT candles from a seeded random walk plus a few sines.
 * Volatility multiplier scales the magnitude of the random step. Concerns
 * shift the bias (high `risk` → wider swings, high `prayer` → calmer).
 *
 * tweak is preserved across regenerations by passing an old series in.
 */
function buildSeries(
  seed: number,
  volatility: number,
  concerns: Record<ConcernKey, number>,
  oceanSpikes: ReadonlyArray<{ index: number; magnitude: number }>,
  prev: ReadonlyArray<Candle> | null,
): Candle[] {
  const rnd = mulberry32(seed);
  // Concern → noise bias. Risk amps amplitude. Prayer/memory calm it.
  const risk = (concerns.risk ?? 50) / 100;
  const work = (concerns.work ?? 50) / 100;
  const prayer = (concerns.prayer ?? 50) / 100;
  const memory = (concerns.memory ?? 50) / 100;
  // base amp grows with risk+work and shrinks with prayer+memory.
  const tone = 0.6 + (risk + work) * 0.7 - (prayer + memory) * 0.3;
  const amp = volatility * Math.max(0.15, tone);

  // Build a continuous price walk first, then derive candles per step.
  const prices: number[] = [];
  let p = 0;
  for (let i = 0; i <= CANDLE_COUNT; i++) {
    // FBM-ish: random walk + slow sines
    const drift = (rnd() - 0.5) * amp * 0.55;
    const slow = Math.sin(i * 0.18 + seed * 0.0001) * amp * 0.18;
    const fast = Math.sin(i * 0.93 - seed * 0.0003) * amp * 0.08;
    p = p * 0.985 + drift + slow + fast;
    prices.push(p);
  }

  // Inject ocean spikes from the tape — each spike biases a candle's close.
  for (const sp of oceanSpikes) {
    if (sp.index < 0 || sp.index > CANDLE_COUNT) continue;
    prices[sp.index] += sp.magnitude;
  }

  const out: Candle[] = [];
  for (let i = 0; i < CANDLE_COUNT; i++) {
    const open = prices[i];
    const close = prices[i + 1];
    const bodyMag = Math.abs(close - open);
    const wickScale = 0.35 + rnd() * 0.4;
    const wickUp = bodyMag * wickScale + rnd() * amp * 0.18;
    const wickDn = bodyMag * wickScale + rnd() * amp * 0.18;
    const top = Math.max(open, close);
    const bot = Math.min(open, close);
    out.push({
      open,
      close,
      high: top + wickUp,
      low: bot - wickDn,
      tweak: prev && prev[i] ? prev[i].tweak : 0,
    });
  }
  return out;
}

/** Apply per-candle tweak to high/low. Positive tweak lifts the high; negative dips the low. */
function effectiveHL(c: Candle): { high: number; low: number } {
  return {
    high: c.tweak > 0 ? c.high + c.tweak : c.high,
    low: c.tweak < 0 ? c.low + c.tweak : c.low,
  };
}

// ── second-order derivative + EMA ────────────────────────────────────────

/** First derivative of the close series; output has length CANDLE_COUNT - 1. */
function deriveD1(candles: ReadonlyArray<Candle>): number[] {
  const closes = candles.map((c) => c.close);
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    out.push(closes[i] - closes[i - 1]);
  }
  return out;
}

function ema(values: ReadonlyArray<number>, period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

// ── RSI (Wilder) ────────────────────────────────────────────────────────

function computeRSI(candles: ReadonlyArray<Candle>, period: number): number[] {
  const closes = candles.map((c) => c.close);
  if (closes.length < period + 1) return new Array(closes.length).fill(50);
  // Use a simple Wilder's smoothing.
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const rsi: number[] = new Array(closes.length).fill(50);
  rsi[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    rsi[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  // Fill early values with the first computed rsi so the line isn't a jump.
  for (let i = 0; i < period; i++) rsi[i] = rsi[period] ?? 50;
  return rsi;
}

// ── component ────────────────────────────────────────────────────────────

export default function Charts() {
  // page-specific ambient bed: faint clockwork ticks
  useEffect(() => { getFieldAudio().setAmbientProfile("clockwork"); }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Pull ocean state — concerns + tape — but DON'T re-build the series on
  // every concern slide (would feel chaotic). We rebuild on a debounced
  // window via an effect that watches a hashed signature.
  const concerns = useField((s) => s.concerns);
  const tape = useField((s) => s.tape);
  const recordTape = useField((s) => s.recordTape);

  const [seed, setSeed] = useState<number>(() =>
    typeof window === "undefined" ? 12345 : Date.now() % 1_000_000,
  );
  const [volatility, setVolatility] = useState<number>(1.2);
  const [candles, setCandles] = useState<Candle[]>(() =>
    buildSeries(12345, 1.2, defaultConcerns(), [], null),
  );
  const [hoverIdx, setHoverIdx] = useState<number>(-1);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<Snapshot | null>(null);

  // Layout cached so pointer handlers can hit-test without recomputing.
  const layoutRef = useRef<Layout | null>(null);
  // y-scale of Panel 1 (price range), updated each draw — used for drag math.
  const p1RangeRef = useRef<{ yMin: number; yMax: number }>({ yMin: 0, yMax: 1 });
  // drag state
  const dragRef = useRef<{ active: boolean; idx: number; startY: number; startTweak: number; lastChimeAt: number }>(
    { active: false, idx: -1, startY: 0, startTweak: 0, lastChimeAt: 0 },
  );
  // oscillator threshold-cross state (so we only bell once per crossing)
  const lastZoneRef = useRef<"over" | "under" | "mid">("mid");

  // Compute spikes from tape that the chart should react to.
  const oceanSpikes = useMemo(() => {
    // Map recent ripple/kept events into candle indices. Newest events
    // land toward the right of the chart; older ones to the left.
    // Window: last 4 minutes.
    const now = Date.now();
    const WINDOW = 4 * 60 * 1000;
    return tape
      .filter((e) => e.kind === "ripple" || e.kind === "kept" || e.kind === "sigil")
      .filter((e) => now - e.t < WINDOW)
      .map((e) => {
        // age 0 → rightmost (CANDLE_COUNT); age = WINDOW → leftmost (0)
        const t = 1 - Math.min(1, (now - e.t) / WINDOW);
        const index = Math.round(t * CANDLE_COUNT);
        const magnitude =
          (e.kind === "kept" ? 0.55 : e.kind === "ripple" ? 0.3 : 0.4) * e.intensity;
        return { index, magnitude };
      });
  }, [tape]);

  // Signature of inputs that should trigger a series rebuild.
  // Rebuilding on every concern keystroke would be jittery — we only
  // rebuild when seed/volatility change, or when oceanSpikes meaningfully
  // change (we hash their count and rough sum).
  const oceanSig = useMemo(() => {
    let s = 0;
    for (const sp of oceanSpikes) s += sp.index * 31 + Math.round(sp.magnitude * 100);
    return `${oceanSpikes.length}:${s}`;
  }, [oceanSpikes]);

  // Concern signature is a quantised hash — we rebuild only when concerns
  // shift by more than ~10 points so dragging the compass doesn't strobe
  // the chart.
  const concernSig = useMemo(() => {
    return (Object.entries(concerns) as Array<[ConcernKey, number]>)
      .map(([k, v]) => `${k}:${Math.round(v / 10)}`)
      .join(",");
  }, [concerns]);

  useEffect(() => {
    // Rebuild when seed, volatility, oceanSig, or concernSig change.
    // Preserves user tweaks via the prev argument.
    setCandles((prev) => buildSeries(seed, volatility, concerns, oceanSpikes, prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, volatility, oceanSig, concernSig]);

  // Load pinned snapshot from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(PIN_KEY);
      if (raw) {
        const j = JSON.parse(raw) as Snapshot;
        if (j && Array.isArray(j.candles)) setPinned(j);
      }
    } catch {
      /* noop */
    }
  }, []);

  // ── derived chart series (cheap, recomputed each render) ───────────────

  const d1 = useMemo(() => deriveD1(candles), [candles]);
  const d1Ema = useMemo(() => ema(d1, EMA_PERIOD), [d1]);
  const rsi = useMemo(() => computeRSI(candles, RSI_PERIOD), [candles]);

  // ── canvas draw ────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rebuildLayout();
    };

    const rebuildLayout = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const padL = Math.max(24, Math.min(56, w * 0.04));
      const padR = Math.max(24, Math.min(56, w * 0.04));
      const innerW = w - padL - padR;
      const slot = innerW / CANDLE_COUNT;
      const bodyW = Math.max(2, Math.min(18, slot * 0.6));
      const p1H = Math.round(h * P1_FRAC);
      const p2H = Math.round(h * P2_FRAC);
      const p3H = h - p1H - p2H;
      const p1Top = 0;
      const p2Top = p1H;
      const p3Top = p1H + p2H;
      layoutRef.current = {
        width: w,
        height: h,
        p1Top,
        p1H,
        p2Top,
        p2H,
        p3Top,
        p3H,
        padL,
        padR,
        slot,
        bodyW,
      };
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (now: number) => {
      const L = layoutRef.current;
      if (!L) {
        raf = requestAnimationFrame(draw);
        return;
      }
      ctx.clearRect(0, 0, L.width, L.height);

      // BG — deep ink with very faint vignette
      ctx.fillStyle = "rgba(8, 12, 20, 1)";
      ctx.fillRect(0, 0, L.width, L.height);

      drawPanel1(ctx, L, candles, hoverIdx, p1RangeRef);
      drawPanel2(ctx, L, d1, d1Ema);
      drawPanel3(ctx, L, rsi);

      // panel separators
      ctx.strokeStyle = "rgba(232,226,213,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.floor(L.p2Top) + 0.5);
      ctx.lineTo(L.width, Math.floor(L.p2Top) + 0.5);
      ctx.moveTo(0, Math.floor(L.p3Top) + 0.5);
      ctx.lineTo(L.width, Math.floor(L.p3Top) + 0.5);
      ctx.stroke();

      // A quiet scan line keeps the instrument alive even when the data is
      // not being regenerated. It does not change hit targets or layout.
      const scanSpan = Math.max(1, L.width - L.padL - L.padR);
      const scanX = L.padL + ((now * 0.035) % scanSpan);
      const scanAlpha = reduce ? 0.08 : 0.18;
      const scanGrad = ctx.createLinearGradient(scanX, 0, scanX + 20, 0);
      scanGrad.addColorStop(0, `rgba(255,180,110,0)`);
      scanGrad.addColorStop(0.45, `rgba(255,180,110,${scanAlpha})`);
      scanGrad.addColorStop(1, `rgba(255,180,110,0)`);
      ctx.fillStyle = scanGrad;
      ctx.fillRect(scanX - 10, 0, 24, L.height);

      // panel labels — top-left of each
      ctx.fillStyle = "rgba(232,226,213,0.42)";
      ctx.font = "10px var(--font-mono, ui-monospace)";
      ctx.textAlign = "left";
      ctx.fillText("price · ohlc", L.padL, L.p1Top + 14);
      ctx.fillText("d/dt · 9-ema", L.padL, L.p2Top + 14);
      ctx.fillText(`rsi · ${RSI_PERIOD}`, L.padL, L.p3Top + 14);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [candles, d1, d1Ema, rsi, hoverIdx]);

  // ── threshold-cross bell ───────────────────────────────────────────────
  useEffect(() => {
    const last = rsi[rsi.length - 1];
    if (last === undefined) return;
    const zone: "over" | "under" | "mid" =
      last > 70 ? "over" : last < 30 ? "under" : "mid";
    if (zone !== lastZoneRef.current && zone !== "mid") {
      try {
        getFieldAudio().bell();
      } catch {
        /* noop */
      }
    }
    lastZoneRef.current = zone;
  }, [rsi]);

  // ── pointer / drag handlers ────────────────────────────────────────────

  const hitTestPanel1 = useCallback(
    (clientX: number, clientY: number): { idx: number; localY: number } | null => {
      const canvas = canvasRef.current;
      const L = layoutRef.current;
      if (!canvas || !L) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (y < L.p1Top || y > L.p1Top + L.p1H) return null;
      if (x < L.padL || x > L.width - L.padR) return null;
      const rel = (x - L.padL) / (L.width - L.padL - L.padR);
      const idx = Math.max(0, Math.min(CANDLE_COUNT - 1, Math.floor(rel * CANDLE_COUNT)));
      return { idx, localY: y - L.p1Top };
    },
    [],
  );

  const playClickForCandle = useCallback((c: Candle) => {
    // pitch derived from close — mapped onto a 2-octave window centered on C4.
    const { yMin, yMax } = p1RangeRef.current;
    const span = yMax - yMin || 1;
    const t = Math.max(0, Math.min(1, (c.close - yMin) / span));
    const midi = 48 + Math.floor(t * 24);
    try {
      getFieldAudio().playNote(midi, 180);
    } catch {
      /* noop */
    }
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const hit = hitTestPanel1(e.clientX, e.clientY);
    if (!hit) return;
    const c = candles[hit.idx];
    if (!c) return;
    dragRef.current = {
      active: true,
      idx: hit.idx,
      startY: e.clientY,
      startTweak: c.tweak,
      lastChimeAt: 0,
    };
    playClickForCandle(c);
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // hover tooltip
    const hit = hitTestPanel1(e.clientX, e.clientY);
    if (hit) {
      if (hit.idx !== hoverIdx) {
        setHoverIdx(hit.idx);
        const wrap = wrapRef.current;
        const canvas = canvasRef.current;
        const L = layoutRef.current;
        if (wrap && canvas && L) {
          const wrect = wrap.getBoundingClientRect();
          const crect = canvas.getBoundingClientRect();
          const cx = L.padL + hit.idx * L.slot + L.slot / 2;
          setTip({
            x: crect.left - wrect.left + cx,
            y: crect.top - wrect.top + L.p1Top + 8,
          });
        }
      }
    } else if (hoverIdx !== -1) {
      setHoverIdx(-1);
      setTip(null);
    }

    // drag-to-tweak
    const d = dragRef.current;
    if (!d.active) return;
    const L = layoutRef.current;
    if (!L) return;
    // Convert vertical pixel delta into price-units using current y-range.
    // Drag DOWN extends low (negative tweak), drag UP extends high (positive).
    const { yMin, yMax } = p1RangeRef.current;
    const span = yMax - yMin || 1;
    const pxPerPrice = L.p1H / span;
    const dy = e.clientY - d.startY;
    const tweak = d.startTweak + (-dy / pxPerPrice);
    setCandles((prev) => {
      if (!prev[d.idx]) return prev;
      const next = prev.slice();
      next[d.idx] = { ...next[d.idx], tweak };
      return next;
    });
    // rate-limited chime + tape mark
    const now = performance.now();
    if (now - d.lastChimeAt > DRAG_NOTE_MS) {
      d.lastChimeAt = now;
      const c = candles[d.idx];
      if (c) playClickForCandle({ ...c, tweak });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d.active && d.idx >= 0) {
      // record one tape event per drag (the rate-limited dedupe in the
      // store collapses extras within 80ms anyway)
      try {
        recordTape("sigil", 0.6, "charts/manipulate");
      } catch {
        /* noop */
      }
    }
    dragRef.current = { active: false, idx: -1, startY: 0, startTweak: 0, lastChimeAt: 0 };
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const onPointerLeave = () => {
    setHoverIdx(-1);
    setTip(null);
  };

  // ── controls ───────────────────────────────────────────────────────────

  const onGenerate = () => {
    setSeed(Date.now() % 1_000_000);
    try {
      getFieldAudio().chime();
    } catch {
      /* noop */
    }
  };

  const onReset = () => {
    setCandles((prev) => prev.map((c) => ({ ...c, tweak: 0 })));
    try {
      getFieldAudio().thud();
    } catch {
      /* noop */
    }
  };

  const onPin = () => {
    const snap: Snapshot = {
      candles: candles.map((c) => ({ ...c })),
      volatility,
      pinnedAt: Date.now(),
    };
    setPinned(snap);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(PIN_KEY, JSON.stringify(snap));
      } catch {
        /* noop */
      }
    }
    try {
      recordTape("kept", 1.0, "charts/pin");
    } catch {
      /* noop */
    }
    try {
      getFieldAudio().bell();
    } catch {
      /* noop */
    }
  };

  // ── render ─────────────────────────────────────────────────────────────

  const hoverC = hoverIdx >= 0 ? candles[hoverIdx] : null;
  const lastRsi = rsi[rsi.length - 1] ?? 50;

  return (
    <div
      ref={wrapRef}
      className="oda-charts-root"
      data-touch-surface="true"
      style={{
        minHeight: "calc(100vh - 56px)",
        background: "#08101a",
        color: "rgba(244,238,222,0.96)",
        padding: "clamp(16px, 3vh, 32px) clamp(16px, 4vw, 48px)",
        display: "flex",
        flexDirection: "column",
        gap: "clamp(12px, 2vh, 22px)",
        touchAction: "manipulation",
      }}
    >
      {/* header — eyebrow + title + subtitle */}
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          className="t-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: 0.55,
          }}
        >
          CHARTS / LINES · CANDLES · OSCILLATORS
        </div>
        <div
          style={{
            fontFamily: "var(--font-fraunces, var(--font-display), Georgia, serif)",
            fontWeight: 500,
            fontSize: "clamp(28px, 4.2vw, 48px)",
            letterSpacing: "-0.01em",
            lineHeight: 1.05,
          }}
        >
          FLOW COMPASS
        </div>
        <div
          style={{
            fontFamily: "var(--font-fraunces, var(--font-display), Georgia, serif)",
            fontStyle: "italic",
            fontSize: "clamp(14px, 1.6vw, 18px)",
            opacity: 0.7,
          }}
        >
          the chart that reads the field
        </div>
      </header>

      {/* canvas region */}
      <div
        className="oda-charts-surface"
        style={{
          position: "relative",
          flex: 1,
          minHeight: 420,
          border: "1px solid rgba(232,226,213,0.10)",
          borderRadius: 6,
          background: "linear-gradient(180deg, rgba(8,12,20,1), rgba(6,10,16,1))",
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
          }}
        />
        {/* pointer overlay only on the canvas — keeps controls untouched */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          style={{
            position: "absolute",
            inset: 0,
            touchAction: "none",
            cursor: hoverIdx >= 0 ? "ns-resize" : "crosshair",
          }}
        />
        {/* OHLC tooltip */}
        {hoverC && tip ? (
          <div
            aria-hidden="true"
            className="t-mono"
            style={{
              position: "absolute",
              left: tip.x,
              top: tip.y,
              transform: "translate(-50%, 0)",
              background: "rgba(8,12,20,0.92)",
              border: "1px solid rgba(232,226,213,0.18)",
              borderRadius: 4,
              padding: "6px 10px",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              fontSize: 11,
              letterSpacing: "0.04em",
              color: "rgba(244,238,222,0.96)",
              fontVariantNumeric: "lining-nums tabular-nums",
              zIndex: 4,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "2px 12px" }}>
              <span style={{ opacity: 0.55 }}>o</span>
              <span style={fraunceNum}>{fmt(hoverC.open)}</span>
              <span style={{ opacity: 0.55 }}>h</span>
              <span style={fraunceNum}>{fmt(effectiveHL(hoverC).high)}</span>
              <span style={{ opacity: 0.55 }}>l</span>
              <span style={fraunceNum}>{fmt(effectiveHL(hoverC).low)}</span>
              <span style={{ opacity: 0.55 }}>c</span>
              <span style={fraunceNum}>{fmt(hoverC.close)}</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* controls */}
      <div
        className="oda-charts-controls"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 14,
          padding: "8px 0",
        }}
      >
        <button type="button" onClick={onGenerate} style={ctrlBtn}>
          generate
        </button>
        <button type="button" onClick={onReset} style={ctrlBtn}>
          reset
        </button>
        <button type="button" onClick={onPin} style={{ ...ctrlBtn, ...ctrlBtnAccent }}>
          pin snapshot
        </button>

        <label
          className="t-mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "lowercase",
            color: "rgba(232,226,213,0.78)",
            minHeight: 44,
          }}
        >
          volatility
          <input
            type="range"
            min={0.1}
            max={3.0}
            step={0.05}
            value={volatility}
            onChange={(e) => setVolatility(parseFloat(e.target.value))}
            style={{
              width: "min(46vw, 200px)",
              accentColor: "rgba(255,180,110,0.95)",
              minHeight: 44,
              touchAction: "manipulation",
            }}
          />
          <span style={{ ...fraunceNum, fontSize: 12, opacity: 0.7, minWidth: 36 }}>
            {volatility.toFixed(2)}
          </span>
        </label>

        <span
          className="t-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "lowercase",
            opacity: 0.55,
            marginLeft: "auto",
          }}
        >
          rsi:{" "}
          <span style={{ ...fraunceNum, color: zoneColor(lastRsi), opacity: 0.95 }}>
            {fmt(lastRsi)}
          </span>
          {pinned ? (
            <span style={{ marginLeft: 14, opacity: 0.5 }}>
              pinned · {timeAgo(pinned.pinnedAt)}
            </span>
          ) : null}
        </span>
      </div>

      {/* footer inscription */}
      <div
        style={{
          fontFamily: "var(--font-fraunces, var(--font-display), Georgia, serif)",
          fontStyle: "italic",
          fontSize: 14,
          opacity: 0.55,
          textAlign: "center",
          padding: "6px 0",
        }}
      >
        manipulate one and watch the others answer
      </div>

      {/* scoped styling — mobile stack */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: 699px) {
              .oda-charts-root {
                min-height: calc(100svh - 56px) !important;
                padding-bottom: calc(56px + env(safe-area-inset-bottom)) !important;
              }
              .oda-charts-surface {
                flex: 0 0 auto !important;
                min-height: clamp(300px, 44svh, 420px) !important;
              }
              .oda-charts-controls {
                gap: 10px !important;
                align-items: stretch !important;
              }
              .oda-charts-controls > * { flex: 1 1 auto; }
              .oda-charts-controls > button { flex-basis: calc(50% - 10px); }
              .oda-charts-controls label { width: 100%; }
              .oda-charts-controls input[type="range"] {
                width: 100% !important;
              }
              .oda-charts-controls > span {
                width: 100%;
                margin-left: 0 !important;
                min-height: 32px;
              }
            }
          `,
        }}
      />
    </div>
  );
}

// ── drawing helpers ──────────────────────────────────────────────────────

function drawPanel1(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  candles: ReadonlyArray<Candle>,
  hoverIdx: number,
  rangeRef: React.MutableRefObject<{ yMin: number; yMax: number }>,
) {
  const top = L.p1Top + 6;
  const bot = L.p1Top + L.p1H - 6;
  const h = bot - top;

  // y-scale across visible (with tweaks applied)
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const c of candles) {
    const { high, low } = effectiveHL(c);
    if (low < yMin) yMin = low;
    if (high > yMax) yMax = high;
  }
  if (!isFinite(yMin) || !isFinite(yMax)) {
    yMin = -1;
    yMax = 1;
  }
  const span = yMax - yMin || 1;
  yMin -= span * 0.08;
  yMax += span * 0.08;
  rangeRef.current = { yMin, yMax };

  const yOf = (p: number) => bot - ((p - yMin) / (yMax - yMin)) * h;

  // BG grid — faint dark green
  ctx.strokeStyle = "rgba(60,130,90,0.10)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = top + (i / 5) * h;
    ctx.beginPath();
    ctx.moveTo(L.padL, Math.floor(y) + 0.5);
    ctx.lineTo(L.width - L.padR, Math.floor(y) + 0.5);
    ctx.stroke();
  }
  // vertical grid every 5 candles
  for (let i = 0; i <= CANDLE_COUNT; i += 5) {
    const x = L.padL + i * L.slot;
    ctx.beginPath();
    ctx.moveTo(Math.floor(x) + 0.5, top);
    ctx.lineTo(Math.floor(x) + 0.5, bot);
    ctx.stroke();
  }

  // candles
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const { high, low } = effectiveHL(c);
    const up = c.close >= c.open;
    const isHovered = i === hoverIdx;
    const cx = L.padL + i * L.slot + L.slot / 2;
    const yOpen = yOf(c.open);
    const yClose = yOf(c.close);
    const yHigh = yOf(high);
    const yLow = yOf(low);
    const cxPx = Math.floor(cx) + 0.5;

    // soft glow under the body — bigger when hovered or tweaked
    const tweakMag = Math.min(1, Math.abs(c.tweak) / (span * 0.3));
    const glowAlpha = (isHovered ? 0.35 : 0.10) + tweakMag * 0.25;
    const glowColor = up ? "rgba(120,210,160," : "rgba(232,120,110,";
    ctx.fillStyle = `${glowColor}${glowAlpha})`;
    const bodyTop = Math.min(yOpen, yClose);
    const bodyBot = Math.max(yOpen, yClose);
    const bw = L.bodyW * (isHovered ? 1.18 : 1);
    ctx.fillRect(cx - bw * 1.3, bodyTop - 2, bw * 2.6, bodyBot - bodyTop + 4);

    // wick
    ctx.strokeStyle = isHovered
      ? "rgba(244,238,222,0.92)"
      : "rgba(232,226,213,0.62)";
    ctx.lineWidth = isHovered ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(cxPx, yHigh);
    ctx.lineTo(cxPx, yLow);
    ctx.stroke();

    // body
    ctx.fillStyle = up
      ? `rgba(106,210,150,${isHovered ? 1.0 : 0.92})`
      : `rgba(232,110,100,${isHovered ? 1.0 : 0.92})`;
    const bodyH = Math.max(1, bodyBot - bodyTop);
    ctx.fillRect(cx - bw / 2, bodyTop, bw, bodyH);

    // tweak indicator — a small bright marker at the dragged wick tip
    if (Math.abs(c.tweak) > 0.001) {
      ctx.fillStyle = "rgba(255,180,110,0.95)";
      ctx.beginPath();
      const tipY = c.tweak > 0 ? yHigh : yLow;
      ctx.arc(cxPx, tipY, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPanel2(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  d1: ReadonlyArray<number>,
  d1Ema: ReadonlyArray<number>,
) {
  const top = L.p2Top + 18;
  const bot = L.p2Top + L.p2H - 6;
  const h = bot - top;
  if (h <= 0 || d1.length === 0) return;

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const v of d1) {
    if (v < yMin) yMin = v;
    if (v > yMax) yMax = v;
  }
  for (const v of d1Ema) {
    if (v < yMin) yMin = v;
    if (v > yMax) yMax = v;
  }
  // symmetric range so zero is centered
  const m = Math.max(Math.abs(yMin), Math.abs(yMax), 0.001) * 1.2;
  yMin = -m;
  yMax = m;
  const yOf = (v: number) => bot - ((v - yMin) / (yMax - yMin)) * h;

  // zero line — faint horizontal
  ctx.strokeStyle = "rgba(232,226,213,0.18)";
  ctx.lineWidth = 1;
  const zy = Math.floor(yOf(0)) + 0.5;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(L.padL, zy);
  ctx.lineTo(L.width - L.padR, zy);
  ctx.stroke();
  ctx.setLineDash([]);

  // X spacing — d1 has CANDLE_COUNT-1 samples, span them across panel width
  const N = d1.length;
  const xOf = (i: number) =>
    L.padL + ((i + 0.5) / N) * (L.width - L.padL - L.padR);

  // Bezier-smoothed line, coloured by sign. We draw two passes — bottom
  // amber fill from zero-line down for negative, top cyan fill for positive.
  // For the line itself we use segment-by-segment stroke with sign-coloured
  // segments.
  const pts: Array<{ x: number; y: number; v: number }> = [];
  for (let i = 0; i < N; i++) pts.push({ x: xOf(i), y: yOf(d1[i]), v: d1[i] });

  // soft fill under the line, faint
  ctx.beginPath();
  ctx.moveTo(pts[0].x, zy);
  for (let i = 0; i < pts.length - 1; i++) {
    const cp1x = (pts[i].x + pts[i + 1].x) / 2;
    ctx.bezierCurveTo(cp1x, pts[i].y, cp1x, pts[i + 1].y, pts[i + 1].x, pts[i + 1].y);
  }
  ctx.lineTo(pts[pts.length - 1].x, zy);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, top, 0, bot);
  grad.addColorStop(0, "rgba(120,210,230,0.16)");
  grad.addColorStop(0.5, "rgba(232,226,213,0.04)");
  grad.addColorStop(1, "rgba(255,180,110,0.14)");
  ctx.fillStyle = grad;
  ctx.fill();

  // main derivative line — segmented colour
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const sign = (a.v + b.v) / 2;
    const t = Math.max(-1, Math.min(1, sign / Math.max(0.001, m)));
    // mix amber (negative) → cyan (positive)
    const color =
      t >= 0
        ? `rgba(${Math.round(120 - t * 30)}, ${Math.round(210)}, ${Math.round(230)}, 0.92)`
        : `rgba(${Math.round(255)}, ${Math.round(180 + t * 30)}, ${Math.round(110 + t * 20)}, 0.92)`;
    ctx.strokeStyle = color;
    const cp1x = (a.x + b.x) / 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(cp1x, a.y, cp1x, b.y, b.x, b.y);
    ctx.stroke();
  }

  // EMA — soft secondary line
  ctx.strokeStyle = "rgba(244,238,222,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < d1Ema.length; i++) {
    const x = xOf(i);
    const y = yOf(d1Ema[i]);
    if (i === 0) ctx.moveTo(x, y);
    else {
      const px = xOf(i - 1);
      const py = yOf(d1Ema[i - 1]);
      const cp1x = (px + x) / 2;
      ctx.bezierCurveTo(cp1x, py, cp1x, y, x, y);
    }
  }
  ctx.stroke();
}

function drawPanel3(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  rsi: ReadonlyArray<number>,
) {
  const top = L.p3Top + 18;
  const bot = L.p3Top + L.p3H - 6;
  const h = bot - top;
  if (h <= 0 || rsi.length === 0) return;

  const yOf = (v: number) => bot - (v / 100) * h;

  // threshold zones — soft fills
  const y70 = yOf(70);
  const y30 = yOf(30);
  // overbought fill (above 70) — green tint
  ctx.fillStyle = "rgba(106,210,150,0.06)";
  ctx.fillRect(L.padL, top, L.width - L.padL - L.padR, y70 - top);
  // oversold fill (below 30) — red tint
  ctx.fillStyle = "rgba(232,110,100,0.06)";
  ctx.fillRect(L.padL, y30, L.width - L.padL - L.padR, bot - y30);

  // threshold lines at 30 / 70
  ctx.strokeStyle = "rgba(232,226,213,0.22)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(L.padL, Math.floor(y70) + 0.5);
  ctx.lineTo(L.width - L.padR, Math.floor(y70) + 0.5);
  ctx.moveTo(L.padL, Math.floor(y30) + 0.5);
  ctx.lineTo(L.width - L.padR, Math.floor(y30) + 0.5);
  ctx.stroke();
  // midline
  ctx.strokeStyle = "rgba(232,226,213,0.10)";
  ctx.beginPath();
  ctx.moveTo(L.padL, Math.floor(yOf(50)) + 0.5);
  ctx.lineTo(L.width - L.padR, Math.floor(yOf(50)) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  // labels
  ctx.fillStyle = "rgba(232,226,213,0.40)";
  ctx.font = "10px var(--font-mono, ui-monospace)";
  ctx.textAlign = "left";
  ctx.fillText("70", L.padL - 18, y70 + 3);
  ctx.fillText("30", L.padL - 18, y30 + 3);

  // line
  const N = rsi.length;
  const xOf = (i: number) =>
    L.padL + ((i + 0.5) / N) * (L.width - L.padL - L.padR);

  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // colour each segment by which zone its midpoint lies in
  for (let i = 0; i < rsi.length - 1; i++) {
    const a = rsi[i];
    const b = rsi[i + 1];
    const mid = (a + b) / 2;
    ctx.strokeStyle = zoneColor(mid);
    ctx.beginPath();
    ctx.moveTo(xOf(i), yOf(a));
    const cp1x = (xOf(i) + xOf(i + 1)) / 2;
    ctx.bezierCurveTo(cp1x, yOf(a), cp1x, yOf(b), xOf(i + 1), yOf(b));
    ctx.stroke();
  }

  // current value dot
  const last = rsi[rsi.length - 1];
  ctx.fillStyle = zoneColor(last);
  ctx.beginPath();
  ctx.arc(xOf(rsi.length - 1), yOf(last), 2.6, 0, Math.PI * 2);
  ctx.fill();
}

// ── small helpers ────────────────────────────────────────────────────────

const fraunceNum: React.CSSProperties = {
  fontFamily: "var(--font-fraunces, Georgia, serif)",
  fontVariantNumeric: "lining-nums tabular-nums",
  fontWeight: 500,
};

function fmt(n: number): string {
  if (!isFinite(n)) return "—";
  const s = n.toFixed(2);
  if (s.startsWith("0.")) return s.slice(1);
  if (s.startsWith("-0.")) return "-" + s.slice(2);
  return s;
}

function zoneColor(rsiVal: number): string {
  if (rsiVal >= 70) return "rgba(106,210,150,0.95)"; // green — overbought
  if (rsiVal <= 30) return "rgba(232,110,100,0.95)"; // red — oversold
  return "rgba(232,226,213,0.62)";
}

function timeAgo(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function defaultConcerns(): Record<ConcernKey, number> {
  return {
    memory: 50,
    work: 50,
    love: 50,
    prayer: 50,
    risk: 50,
    future: 50,
    body: 50,
    friendship: 50,
  };
}

// ── control button styles ────────────────────────────────────────────────

const ctrlBtn: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: 11,
  letterSpacing: "0.10em",
  textTransform: "lowercase",
  color: "rgba(232,226,213,0.86)",
  background: "transparent",
  border: "1px solid rgba(232,226,213,0.22)",
  borderRadius: 999,
  padding: "10px 18px",
  minHeight: 44,
  cursor: "pointer",
  touchAction: "manipulation",
  transition: "color var(--t), border-color var(--t), background var(--t)",
};

const ctrlBtnAccent: React.CSSProperties = {
  color: "rgba(255,180,110,0.96)",
  borderColor: "rgba(255,180,110,0.42)",
};
