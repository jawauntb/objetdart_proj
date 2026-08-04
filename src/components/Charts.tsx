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
import { attachGestures } from "@/lib/gesture";
import type { ConcernKey } from "@/lib/types";
import * as haptics from "@/lib/haptics";
import { onVessel } from "@/lib/vessel";
import { relaxTurbulence, stirTurbulence } from "@/lib/turbulence";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import LetGo from "@/components/LetGo";
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
  type QualityTier,
} from "@/lib/room-runtime";

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
 * The plate is alive at rest: a slow breath walks the whole reading on the
 * shared 7s/47s clocks (render-time only — the series stays a pure function
 * of the seed), and the room's agitation rides `lib/turbulence`, so a shake
 * churns the panels and every haptic in the room hits heavier until it
 * settles. The device is the vessel: tilt leans the reading down-slope, a
 * knock rings the plate, face-down is night.
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

// the shared clock family (INSPIRATION §5 law 3): the 7s breath under a slow tide
const BREATH_MS = 7000;
const TIDE_MS = 47000;
const TAU = Math.PI * 2;

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

type ChartMark = { id: number; label: string; tone: "rise" | "fall" | "amber" | "pale"; strength: number };

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

/**
 * Effective close = seed close + user tweak. A candle's `tweak` shifts its
 * close in price-units; the body, wick, derivative and RSI all follow. This
 * is what lets a drag in ANY panel back-solve the same underlying series so
 * all three panels stay coherent.
 */
function effClose(c: Candle): number {
  return c.close + c.tweak;
}

/**
 * Apply the close-shift and rebuild the OHLC box. The seed wick lengths are
 * preserved relative to the (shifted) body, so pulling a candle also pulls
 * its wicks — the whole reading answers the finger.
 */
function effectiveCandle(c: Candle): { open: number; close: number; high: number; low: number } {
  const close = c.close + c.tweak;
  const wickUp = c.high - Math.max(c.open, c.close);
  const wickDn = Math.min(c.open, c.close) - c.low;
  const top = Math.max(c.open, close);
  const bot = Math.min(c.open, close);
  return { open: c.open, close, high: top + wickUp, low: bot - wickDn };
}

/** Back-compat helper — effective high/low with the tweak applied. */
function effectiveHL(c: Candle): { high: number; low: number } {
  const e = effectiveCandle(c);
  return { high: e.high, low: e.low };
}

// ── second-order derivative + EMA ────────────────────────────────────────

/** First derivative of the effective-close series; length CANDLE_COUNT - 1. */
function deriveD1(candles: ReadonlyArray<Candle>): number[] {
  const closes = candles.map(effClose);
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
  return computeRSIFromCloses(candles.map(effClose), period);
}

function computeRSIFromCloses(closes: ReadonlyArray<number>, period: number): number[] {
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

// ── back-solvers (Panel 2 / Panel 3 → candle closes) ─────────────────────

/**
 * Panel 2 scrub. The derivative sample `i` is the slope between candle `i`
 * and `i + 1`. To make that slope equal `target`, we move the arrival
 * candle's close to `effClose(i) + target`. Returns the tweak candle `i+1`
 * needs. Neighbouring derivative samples ripple — that is the coherence.
 */
function solveTweakForD1(
  candles: ReadonlyArray<Candle>,
  i: number,
  target: number,
): number {
  const from = candles[i];
  const to = candles[i + 1];
  if (!from || !to) return to ? to.tweak : 0;
  const desiredClose = effClose(from) + target;
  return desiredClose - to.close;
}

/**
 * Panel 3 scrub. RSI is a non-linear Wilder average, but RSI[idx] is
 * monotonic in candle[idx]'s close (raising the close raises that step's
 * gain), so we bisect the tweak until RSI[idx] meets the finger. Cheap:
 * ~36 evals of a 40-length pass.
 */
function solveTweakForRSI(
  candles: ReadonlyArray<Candle>,
  idx: number,
  targetRSI: number,
  period: number,
): number {
  const base = candles.map(effClose);
  const seedClose = candles[idx].close;
  const evalAt = (tw: number): number => {
    const closes = base.slice();
    closes[idx] = seedClose + tw;
    return computeRSIFromCloses(closes, period)[idx] ?? 50;
  };
  let lo = -100;
  let hi = 100;
  for (let k = 0; k < 36; k++) {
    const mid = (lo + hi) / 2;
    if (evalAt(mid) < targetRSI) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── component ────────────────────────────────────────────────────────────

export default function Charts() {
  // page-specific ambient bed: faint clockwork ticks
  useEffect(() => { getFieldAudio().setAmbientProfile("clockwork"); }, []);
  useEffect(() => onVisibility((hidden) => {
    if (hidden) getFieldAudio().setAmbientProfile("ocean");
  }), []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

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
  const [chartMarks, setChartMarks] = useState<ChartMark[]>([]);
  const chartMarkIdRef = useRef(0);

  // Layout cached so pointer handlers can hit-test without recomputing.
  const layoutRef = useRef<Layout | null>(null);
  // y-scale of Panel 1 (price range), updated each draw — used for drag math.
  const p1RangeRef = useRef<{ yMin: number; yMax: number }>({ yMin: 0, yMax: 1 });
  // plot rectangles + value-ranges for Panels 2 & 3, refreshed each draw so
  // pointer handlers can invert screen-y → value for the back-solve.
  const p2RangeRef = useRef<{ top: number; bot: number; yMin: number; yMax: number }>(
    { top: 0, bot: 1, yMin: -1, yMax: 1 },
  );
  const p3RangeRef = useRef<{ top: number; bot: number }>({ top: 0, bot: 1 });
  // live volatility so drag math reads the current value without re-binding
  const volRef = useRef(1.2);
  // drag state — `mode` selects which panel/gesture answers the finger
  const dragRef = useRef<{
    active: boolean;
    mode: "candle" | "d1" | "rsi" | "vol";
    idx: number;
    startY: number;
    startTweak: number;
    lastChimeAt: number;
    lastMarkAt: number;
  }>(
    { active: false, mode: "candle", idx: -1, startY: 0, startTweak: 0, lastChimeAt: 0, lastMarkAt: 0 },
  );
  // oscillator threshold-cross state (so we only bell once per crossing)
  const lastZoneRef = useRef<"over" | "under" | "mid">("mid");

  // ── gesture-grammar state (law layer, lens, tempo) ──
  const candlesRef = useRef<Candle[]>([]);          // latest series for stable handlers
  const lensRef = useRef({ cur: 0, target: 0 });    // twist: chart ↔ the raw walk
  const rippleRef = useRef({ t0: -1e9, amp: 0, dir: 1 }); // 3-finger drag ripples the field
  const scanRef = useRef({ t: 0, lastFrameAt: -1 });      // scan line rides the room clock
  const scanScaleRef = useRef({ cur: 1, target: 1 });     // 3-finger hold dilates it
  const entrainRef = useRef({ bpm: 0, until: 0, lastBeat: -1, pulse: 0 });
  const lastGestureAtRef = useRef(0);
  const panRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 }); // pan2: shifts the frame
  const seasonRef = useRef(0); // 3-finger twist: the market's slow season

  // ── vessel state (the device is the plate's gravity) ──
  const tiltRef = useRef({ target: 0, cur: 0, over: false, lastCueAt: 0 });
  const knockRef = useRef({ t0: -1e9, intensity: 0 });
  const nightRef = useRef({ target: 0, cur: 0 });
  const seedRef = useRef(0);
  seedRef.current = seed;

  const addChartMark = (label: string, tone: ChartMark["tone"] = "amber", strength = 0.5) => {
    const id = ++chartMarkIdRef.current;
    setChartMarks((marks) => [...marks.slice(-4), { id, label, tone, strength }]);
    window.setTimeout(() => {
      setChartMarks((marks) => marks.filter((mark) => mark.id !== id));
    }, 4600);
  };

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

  // keep the drag-math mirror of volatility current
  useEffect(() => {
    volRef.current = volatility;
  }, [volatility]);

  // stable mirror of the series for the gesture engine's handlers
  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

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

    // ── performance contract (room-runtime): frame governor + DPR ceiling,
    // shared with every other room. Visibility pause already lived here
    // (document.hidden below) — gallery-pause joins it. ──
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let tier: QualityTier = gov.tier();
    let galleryPaused = false;
    const ungal = onGalleryPause((p) => { galleryPaused = p; });

    const resize = () => {
      const dpr = resolveDpr(tier, { embedded, reducedMotion: reduce });
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
      // slightly wider left gutter — it doubles as the volatility handle track
      const padL = Math.max(38, Math.min(60, w * 0.055));
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

    let restedWhileHidden = false;

    const draw = (now: number) => {
      tier = gov.beginFrame(now);
      const detail = detailForTier(tier);
      const L = layoutRef.current;
      if (!L) {
        raf = requestAnimationFrame(draw);
        return;
      }
      // a hidden tab (or a paused gallery iframe) costs nothing: one
      // settled frame so the plate is never blank, then no paint at all,
      // and the clock resumes from here rather than jumping the breath
      // forward
      if (document.hidden || galleryPaused) {
        scanRef.current.lastFrameAt = -1;
        if (restedWhileHidden) {
          raf = requestAnimationFrame(draw);
          return;
        }
        restedWhileHidden = true;
      } else {
        restedWhileHidden = false;
      }
      ctx.clearRect(0, 0, L.width, L.height);

      // BG — deep ink with very faint vignette
      ctx.fillStyle = "rgba(8, 12, 20, 1)";
      ctx.fillRect(0, 0, L.width, L.height);

      // faint inscriptions — the words are pressed into the plate, not
      // captioning it. Drawn under the data so the lines read over them.
      drawInscriptions(ctx, L);

      // the shared calm↔storm axis (lib/turbulence): the room's own energy,
      // decaying here because this loop owns the frame. Haptic weight rides
      // it too — gain() in lib/haptics reads the same scalar.
      // (always relax, even under reduced motion — otherwise a stirred axis
      // would stay high forever and every haptic with it)
      const turb = relaxTurbulence(now) * (reduce ? 0 : 1);

      // the vessel, smoothed: raw orientation would jitter the panels
      const tilt = tiltRef.current;
      tilt.cur += (tilt.target - tilt.cur) * 0.06;
      const night = nightRef.current;
      night.cur += (night.target - night.cur) * 0.05;

      // three-finger weather: a transient wave rolls through every panel —
      // the data field ripples and settles, nothing is rewritten
      const rippleAge = (now - rippleRef.current.t0) / 1000;
      const rippleEnv = rippleAge < 3 ? rippleRef.current.amp * Math.exp(-rippleAge * 2.1) : 0;

      // idle breath: the plate never sits still. A slow swell walks the whole
      // reading on the shared clock — 7s breath under a 47s tide — with the
      // per-candle phase fixed by the seed, so the same field always breathes
      // the same way. Render-time only: the series itself is untouched, so an
      // idle frame costs a few sines and nothing recomputes.
      const wake = 1 - night.cur;
      const driftAmp = reduce ? 0 : 0.15 * wake;
      const churnAmp = reduce ? 0 : turb * 1.1 * wake;
      const breathPh = (now / BREATH_MS) * TAU;
      const tidePh = (now / TIDE_MS) * TAU;
      const churnPh = (now / 900) * TAU;
      const seedPh = (seedRef.current % 997) * 0.0063;
      const lean = tilt.cur * 0.9 * wake;
      const waveOff =
        rippleEnv > 0.004 || driftAmp > 0.004 || churnAmp > 0.004 || Math.abs(lean) > 0.004
          ? (i: number) => {
              const ph = seedPh + i * 0.37;
              return (
                (rippleEnv > 0.004
                  ? rippleEnv * Math.sin(i * 0.55 - rippleRef.current.dir * rippleAge * 13)
                  : 0) +
                driftAmp *
                  (Math.sin(breathPh + ph) * 0.6 + Math.sin(tidePh + ph * 0.31) * 0.4) +
                // the churn a shake leaves behind, riding the shared axis down
                (churnAmp > 0.004 ? churnAmp * Math.sin(churnPh + ph * 1.7) : 0) +
                // tilt: the plate tips and the reading slides down-slope
                lean * (i / CANDLE_COUNT - 0.5) * 2
              );
            }
          : undefined;

      // the lens (twist): candlestick dressing ↔ the raw walk underneath
      const lens = lensRef.current;
      lens.cur += (lens.target - lens.cur) * 0.08;

      // two-finger pan (pan2) shifts the whole frame, eased back to rest —
      // distinct from a one-finger drag, which manipulates the data itself.
      const pan = panRef.current;
      pan.x += (pan.tx - pan.x) * 0.12;
      pan.y += (pan.ty - pan.y) * 0.12;
      pan.tx *= 0.9;
      pan.ty *= 0.9;

      ctx.save();
      ctx.translate(pan.x, pan.y);
      drawPanel1(ctx, L, candles, hoverIdx, p1RangeRef, lens.cur, waveOff, detail.particles);
      drawPanel2(ctx, L, d1, d1Ema, p2RangeRef, waveOff);
      drawPanel3(ctx, L, rsi, p3RangeRef, waveOff);

      // volatility handle lives in the left gutter beside Panel 1
      drawVolHandle(ctx, L, volRef.current);
      ctx.restore();

      // three-finger twist = season: a slow, render-only warm/cool cast —
      // one fillRect, never a per-element gradient.
      const seasonWarm = Math.sin(seasonRef.current) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(${Math.round(200 + 40 * seasonWarm)}, ${Math.round(150 + 20 * (1 - seasonWarm))}, ${Math.round(120 + 60 * (1 - seasonWarm))}, 0.02)`;
      ctx.fillRect(0, 0, L.width, L.height);

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
      // not being regenerated. It rides the room's clock: a three-finger
      // hold slows it to a quarter, a steady tapped pulse entrains it.
      const scan = scanRef.current;
      if (scan.lastFrameAt < 0) scan.lastFrameAt = now;
      const scanDt = Math.min(80, now - scan.lastFrameAt);
      scan.lastFrameAt = now;
      const scanScale = scanScaleRef.current;
      scanScale.cur += (scanScale.target - scanScale.cur) * Math.min(1, scanDt * 0.005);
      const entrain = entrainRef.current;
      const entrained = now < entrain.until && entrain.bpm > 0;
      const scanSpan = Math.max(1, L.width - L.padL - L.padR);
      const scanRate = entrained
        ? scanSpan / ((60000 / entrain.bpm) * 8) // one crossing per eight beats
        : 0.035;
      scan.t += scanDt * scanRate * scanScale.cur * wake;
      if (entrained) {
        const beatIdx = Math.floor(now / (60000 / entrain.bpm));
        if (beatIdx !== entrain.lastBeat) {
          entrain.lastBeat = beatIdx;
          entrain.pulse = 1;
          try { getFieldAudio().playNote(64 + (beatIdx % 2) * 5, 70); } catch { /* noop */ }
        }
      }
      entrain.pulse *= Math.exp(-scanDt / 300);
      const scanX = L.padL + (scan.t % scanSpan);
      const scanAlpha = ((reduce ? 0.08 : 0.18) + entrain.pulse * 0.3 + turb * 0.22) * wake;
      const scanGrad = ctx.createLinearGradient(scanX, 0, scanX + 20, 0);
      scanGrad.addColorStop(0, `rgba(255,180,110,0)`);
      scanGrad.addColorStop(0.45, `rgba(255,180,110,${scanAlpha})`);
      scanGrad.addColorStop(1, `rgba(255,180,110,0)`);
      ctx.fillStyle = scanGrad;
      ctx.fillRect(scanX - 10, 0, 24, L.height);

      // a knock on the case rings the plate: one wave of light crosses all
      // three panels and dies, the way a struck rim rings and stills
      const knock = knockRef.current;
      const knockAge = (now - knock.t0) / 1000;
      if (knockAge < 1.2) {
        const env = Math.exp(-knockAge * 2.6) * (0.3 + knock.intensity * 0.7);
        const r = 40 + knockAge * L.width * 0.9;
        const cx = L.padL + (L.width - L.padL - L.padR) * 0.5;
        const cy = L.p1Top + L.p1H * 0.5;
        ctx.strokeStyle = `rgba(255,190,124,${(env * 0.5).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.stroke();
      }

      // glimmer (grammar §6): after ~20s of quiet, a faint ring breathes
      // over one of the candles — a physical hint, never text.
      if (now - lastGestureAtRef.current > 20000) {
        const slot = Math.floor(now / 9000);
        const gseed = Math.abs(Math.sin(slot * 127.1) * 43758.5453) % 1;
        const gi = Math.floor(gseed * CANDLE_COUNT);
        const gx = L.padL + gi * L.slot + L.slot / 2;
        const gy = L.p1Top + L.p1H * 0.5;
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        ctx.strokeStyle = `rgba(255,180,110,${(0.05 + pulse * 0.08).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gx, gy, 14 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // panel labels — top-left of each; the first names the lens in play
      ctx.fillStyle = "rgba(232,226,213,0.42)";
      ctx.font = "10px var(--font-mono, ui-monospace)";
      ctx.textAlign = "left";
      ctx.fillText(lens.cur > 0.5 ? "price · the raw walk" : "price · ohlc", L.padL, L.p1Top + 14);
      ctx.fillText("d/dt · 9-ema", L.padL, L.p2Top + 14);
      ctx.fillText(`rsi · ${RSI_PERIOD}`, L.padL, L.p3Top + 14);

      // face-down is night: the plate darkens and the scan stands still
      if (night.cur > 0.004) {
        ctx.fillStyle = `rgba(6,10,16,${(night.cur * 0.84).toFixed(3)})`;
        ctx.fillRect(0, 0, L.width, L.height);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      ungal();
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

  // Resolve a pointer into a target: the volatility gutter, or a sample in
  // one of the three panels. Every plotted point is a handle.
  const locate = useCallback(
    (
      clientX: number,
      clientY: number,
    ):
      | { zone: "vol" }
      | { zone: "p1" | "p2" | "p3"; idx: number; localY: number }
      | null => {
      const canvas = canvasRef.current;
      const L = layoutRef.current;
      if (!canvas || !L) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      // volatility handle — left gutter, alongside Panel 1
      if (x < L.padL && y >= L.p1Top && y <= L.p1Top + L.p1H) {
        return { zone: "vol" };
      }
      const innerW = L.width - L.padL - L.padR;
      if (x < L.padL || x > L.width - L.padR || innerW <= 0) return null;
      const rel = Math.max(0, Math.min(1, (x - L.padL) / innerW));
      if (y >= L.p1Top && y <= L.p1Top + L.p1H) {
        const idx = Math.max(0, Math.min(CANDLE_COUNT - 1, Math.floor(rel * CANDLE_COUNT)));
        return { zone: "p1", idx, localY: y - L.p1Top };
      }
      if (y >= L.p2Top && y <= L.p2Top + L.p2H) {
        const N = CANDLE_COUNT - 1;
        const idx = Math.max(0, Math.min(N - 1, Math.round(rel * N - 0.5)));
        return { zone: "p2", idx, localY: y - L.p2Top };
      }
      if (y >= L.p3Top && y <= L.p3Top + L.p3H) {
        const N = CANDLE_COUNT;
        const idx = Math.max(0, Math.min(N - 1, Math.round(rel * N - 0.5)));
        return { zone: "p3", idx, localY: y - L.p3Top };
      }
      return null;
    },
    [],
  );

  const playNote = useCallback((midi: number, ms = 170) => {
    try {
      getFieldAudio().playNote(Math.round(midi), ms);
    } catch {
      /* noop */
    }
  }, []);

  const playClickForCandle = useCallback(
    (c: Candle) => {
      // pitch derived from effective close — 2-octave window centred on C4.
      const { yMin, yMax } = p1RangeRef.current;
      const span = yMax - yMin || 1;
      const t = Math.max(0, Math.min(1, (effClose(c) - yMin) / span));
      playNote(48 + Math.floor(t * 24), 180);
    },
    [playNote],
  );

  // invert pointer-y within a panel back to that panel's value
  const p2ValueAt = (clientY: number): number => {
    const canvas = canvasRef.current;
    const { top, bot, yMin, yMax } = p2RangeRef.current;
    if (!canvas || bot <= top) return 0;
    const y = clientY - canvas.getBoundingClientRect().top;
    const t = Math.max(0, Math.min(1, (bot - y) / (bot - top)));
    return yMin + t * (yMax - yMin);
  };
  const p3ValueAt = (clientY: number): number => {
    const canvas = canvasRef.current;
    const { top, bot } = p3RangeRef.current;
    if (!canvas || bot <= top) return 50;
    const y = clientY - canvas.getBoundingClientRect().top;
    return Math.max(0, Math.min(100, ((bot - y) / (bot - top)) * 100));
  };
  const volValueAt = (clientY: number): number => {
    const canvas = canvasRef.current;
    const L = layoutRef.current;
    if (!canvas || !L) return volRef.current;
    const y = clientY - canvas.getBoundingClientRect().top;
    const top = L.p1Top + 18;
    const bot = L.p1Top + L.p1H - 18;
    const t = Math.max(0, Math.min(1, (bot - y) / (bot - top || 1)));
    const v = 0.1 + t * (3.0 - 0.1);
    return Math.round(v / 0.05) * 0.05;
  };

  // Panel 2 back-solve — set the arrival candle's close so the slope answers.
  const applyD1Drag = (idx: number, targetV: number) => {
    setCandles((prev) => {
      if (!prev[idx] || !prev[idx + 1]) return prev;
      const next = prev.slice();
      next[idx + 1] = { ...next[idx + 1], tweak: solveTweakForD1(prev, idx, targetV) };
      return next;
    });
    const { yMin, yMax } = p2RangeRef.current;
    const span = yMax - yMin || 1;
    const t = Math.max(0, Math.min(1, (targetV - yMin) / span));
    playNote(50 + t * 22, 130);
    haptics.chop();
  };

  // Panel 3 back-solve — bisect a candle's close until RSI meets the finger.
  const applyRSIDrag = (hitIdx: number, targetRSI: number) => {
    const solveIdx = Math.max(RSI_PERIOD, hitIdx);
    setCandles((prev) => {
      if (!prev[solveIdx]) return prev;
      const next = prev.slice();
      next[solveIdx] = {
        ...next[solveIdx],
        tweak: solveTweakForRSI(prev, solveIdx, targetRSI, RSI_PERIOD),
      };
      return next;
    });
    playNote(48 + (targetRSI / 100) * 24, 130);
    haptics.chop();
  };

  // Desktop hover is the grammar's quiet dialect (hover ≈ light touch):
  // the tooltip gathers over Panel 1. All contact gestures live in the
  // engine below.
  const onHoverMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.active) return;
    const hit = locate(e.clientX, e.clientY);
    if (hit && hit.zone === "p1") {
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
  };

  const onPointerLeave = () => {
    setHoverIdx(-1);
    setTip(null);
  };

  // ── controls ───────────────────────────────────────────────────────────

  const onGenerate = () => {
    setSeed(Date.now() % 1_000_000);
    stirTurbulence(0.2);
    try {
      getFieldAudio().chime();
    } catch {
      /* noop */
    }
    haptics.roll();
    recordTape("object", 0.45, "charts:generate");
    addChartMark("generated", "amber", 0.68);
  };

  const onReset = () => {
    setCandles((prev) => prev.map((c) => ({ ...c, tweak: 0 })));
    try {
      getFieldAudio().thud();
    } catch {
      /* noop */
    }
    haptics.chop();
    recordTape("object", 0.38, "charts:reset");
    addChartMark("reset", "pale", 0.48);
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
    haptics.roll();
    addChartMark("pinned", "amber", 0.86);
  };

  // whole-field clear — the shared <LetGo/>, never a hand-rolled button.
  const letGoPinned = () => {
    setPinned(null);
    if (typeof window !== "undefined") {
      try { localStorage.removeItem(PIN_KEY); } catch { /* noop */ }
    }
    try { getFieldAudio().thud(); } catch { /* noop */ }
    haptics.roll();
    recordTape("kept", 0.4, "charts/let-go");
    addChartMark("let go", "pale", 0.4);
  };

  // latest chrome actions for the stable gesture handlers
  const onGenerateRef = useRef(onGenerate);
  const onPinRef = useRef(onPin);
  const addMarkRef = useRef(addChartMark);
  onGenerateRef.current = onGenerate;
  onPinRef.current = onPin;
  addMarkRef.current = addChartMark;

  // ── gestures (the shared grammar — src/lib/gesture) ────────────────────
  // One finger touches the data (drag any plotted point and the whole
  // reading answers); two fingers turn the lens (chart ↔ the raw walk);
  // three fingers touch the law (drag ripples the field, hold slows the
  // scan to a quarter); the device is the vessel (below). Pinch and pan2
  // stay unbound: the plate holds one reading and has no scale to travel.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    let twistAcc = 0;
    let lastRippleCueAt = 0;
    let lastScrubAt = 0;
    let lastGrowNoteAt = 0;
    let holdIdx = -1;
    let holdCeremony = false;

    const detach = attachGestures(overlay, {
      tap: (e) => {
        lastGestureAtRef.current = performance.now();
        if (e.fingers === 3) {
          // tutti — every panel answers at once, the plate stating itself.
          rippleRef.current = { t0: performance.now(), amp: 0.7, dir: 1 };
          playNote(52, 200);
          try { haptics.bloom(); } catch { /* noop */ }
          recordTape("region", 0.6, "charts/tutti");
          return;
        }
        if (e.fingers === 2) {
          // step back: lower the raised lens first. ScaleTravel reads
          // data-lens-raised and yields to us when this is set.
          if (lensRef.current.target > 0.5) {
            lensRef.current.target = 0;
            overlay.removeAttribute("data-lens-raised");
            try { haptics.tap(); } catch { /* noop */ }
            recordTape("sigil", 0.4, "charts/lens-candles");
          }
          return;
        }
        if (e.fingers !== 1) return; // the plate absorbs frame/law taps
        if (e.count === 3) {
          // a triple tap reseeds the field — the same act as the generate
          // chrome, spoken by hand
          onGenerateRef.current();
          return;
        }
        const hit = locate(e.x, e.y);
        if (!hit) return;
        // tap intensity is the strike: haptic and mark ride the 0..1 from core
        try { haptics.ripple(0.2 + e.intensity * 0.3); } catch { /* noop */ }
        if (hit.zone === "vol") {
          const v = volValueAt(e.y);
          setVolatility(v);
          playNote(46 + (v / 3.0) * 26, 150);
          addChartMark(`vol ${v.toFixed(2)}`, "amber", 0.5);
          return;
        }
        if (hit.zone === "p1") {
          const c = candlesRef.current[hit.idx];
          if (!c) return;
          playClickForCandle(c);
          addChartMark(`c${hit.idx + 1}`, effClose(c) >= c.open ? "rise" : "fall", 0.4 + e.intensity * 0.3);
          return;
        }
        if (hit.zone === "p2") {
          applyD1Drag(hit.idx, p2ValueAt(e.y));
          addChartMark(`d ${hit.idx + 1}`, "amber", 0.52);
          return;
        }
        applyRSIDrag(hit.idx, p3ValueAt(e.y));
        addChartMark(`rsi ${hit.idx + 1}`, "amber", 0.52);
      },
      drag: (e) => {
        lastGestureAtRef.current = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          // three fingers drag the weather: a wave rolls through all three
          // panels — the field ripples and settles, nothing is rewritten
          const speed = Math.hypot(e.vx, e.vy);
          rippleRef.current = {
            t0: performance.now(),
            amp: Math.min(1, 0.3 + speed * 0.6),
            dir: e.vx < 0 ? -1 : 1,
          };
          const nowMs = performance.now();
          if (speed > 0.25 && nowMs - lastRippleCueAt > 700) {
            lastRippleCueAt = nowMs;
            stirTurbulence(Math.min(0.12, speed * 0.08));
            playNote(40, 220);
            try { haptics.chop(); } catch { /* noop */ }
            recordTape("region", 0.45, "charts/ripple");
          }
          return;
        }
        if (e.fingers !== 1) return;
        const d = dragRef.current;
        const now = performance.now();
        if (e.phase === "start") {
          const hit = locate(e.x, e.y);
          if (!hit) return;
          try { haptics.tap(); } catch { /* noop */ }
          if (hit.zone === "vol") {
            d.active = true; d.mode = "vol"; d.idx = -1;
            d.startY = e.y; d.startTweak = 0; d.lastChimeAt = 0; d.lastMarkAt = 0;
            const v = volValueAt(e.y);
            setVolatility(v);
            playNote(46 + (v / 3.0) * 26, 150);
            addChartMark(`vol ${v.toFixed(2)}`, "amber", 0.5);
            return;
          }
          if (hit.zone === "p1") {
            const c = candlesRef.current[hit.idx];
            if (!c) return;
            d.active = true; d.mode = "candle"; d.idx = hit.idx;
            d.startY = e.y; d.startTweak = c.tweak; d.lastChimeAt = 0; d.lastMarkAt = 0;
            playClickForCandle(c);
            addChartMark(`c${hit.idx + 1}`, effClose(c) >= c.open ? "rise" : "fall", 0.5);
            return;
          }
          if (hit.zone === "p2") {
            d.active = true; d.mode = "d1"; d.idx = hit.idx;
            d.startY = e.y; d.startTweak = 0; d.lastChimeAt = 0; d.lastMarkAt = 0;
            applyD1Drag(hit.idx, p2ValueAt(e.y));
            addChartMark(`d ${hit.idx + 1}`, "amber", 0.52);
            return;
          }
          d.active = true; d.mode = "rsi"; d.idx = hit.idx;
          d.startY = e.y; d.startTweak = 0; d.lastChimeAt = 0; d.lastMarkAt = 0;
          applyRSIDrag(hit.idx, p3ValueAt(e.y));
          addChartMark(`rsi ${hit.idx + 1}`, "amber", 0.52);
          return;
        }
        if (e.phase === "end") {
          if (d.active) {
            try {
              if (d.mode === "vol") {
                recordTape("object", 0.34, `charts:vol:${volRef.current.toFixed(2)}`);
                addChartMark(`vol ${volRef.current.toFixed(2)}`, "amber", 0.6);
              } else if (d.mode === "candle") {
                recordTape("sigil", 0.6, "charts/manipulate");
                addChartMark(`set ${d.idx + 1}`, "amber", 0.66);
              } else if (d.mode === "d1") {
                recordTape("sigil", 0.56, "charts/derivative");
                addChartMark(`d set ${d.idx + 1}`, "amber", 0.64);
              } else {
                recordTape("sigil", 0.56, "charts/rsi");
                addChartMark(`rsi set ${d.idx + 1}`, "amber", 0.64);
              }
            } catch { /* noop */ }
            try { haptics.ripple(0.58); } catch { /* noop */ }
          }
          d.active = false; d.mode = "candle"; d.idx = -1;
          d.startY = 0; d.startTweak = 0; d.lastChimeAt = 0; d.lastMarkAt = 0;
          return;
        }
        if (!d.active) return;
        const L = layoutRef.current;
        if (!L) return;
        if (d.mode === "vol") {
          const v = volValueAt(e.y);
          if (Math.abs(v - volRef.current) > 1e-6) {
            setVolatility(v);
            if (now - d.lastChimeAt > DRAG_NOTE_MS) {
              d.lastChimeAt = now;
              stirTurbulence(Math.min(0.12, Math.max(0, v - volRef.current) * 0.6));
              playNote(46 + (v / 3.0) * 26, 120);
              haptics.chop();
            }
            if (now - d.lastMarkAt > 360) {
              d.lastMarkAt = now;
              addChartMark(`vol ${v.toFixed(2)}`, "amber", 0.46);
            }
          }
          return;
        }
        if (d.mode === "candle") {
          // vertical pixel delta → price-units via the current Panel-1 range
          const { yMin, yMax } = p1RangeRef.current;
          const span = yMax - yMin || 1;
          const pxPerPrice = L.p1H / span;
          const dy = e.y - d.startY;
          const tweak = d.startTweak + -dy / pxPerPrice;
          setCandles((prev) => {
            if (!prev[d.idx]) return prev;
            const next = prev.slice();
            next[d.idx] = { ...next[d.idx], tweak };
            return next;
          });
          if (now - d.lastChimeAt > DRAG_NOTE_MS) {
            d.lastChimeAt = now;
            stirTurbulence(0.012);
            const c = candlesRef.current[d.idx];
            if (c) playClickForCandle({ ...c, tweak });
            haptics.chop();
          }
          if (now - d.lastMarkAt > 360) {
            d.lastMarkAt = now;
            addChartMark(
              `${d.idx + 1} ${tweak >= 0 ? "up" : "dn"}`,
              tweak >= 0 ? "rise" : "fall",
              Math.min(0.88, 0.42 + Math.abs(tweak) * 0.12),
            );
          }
          return;
        }
        if (d.mode === "d1") {
          const targetV = p2ValueAt(e.y);
          applyD1Drag(d.idx, targetV);
          if (now - d.lastMarkAt > 360) {
            d.lastMarkAt = now;
            addChartMark(`d ${d.idx + 1} ${targetV >= 0 ? "↑" : "↓"}`, targetV >= 0 ? "rise" : "fall", 0.6);
          }
          return;
        }
        const targetRSI = p3ValueAt(e.y);
        applyRSIDrag(d.idx, targetRSI);
        if (now - d.lastMarkAt > 360) {
          d.lastMarkAt = now;
          addChartMark(
            `rsi ${fmt(targetRSI)}`,
            targetRSI >= 70 ? "rise" : targetRSI <= 30 ? "fall" : "pale",
            0.6,
          );
        }
      },
      hold: (e) => {
        lastGestureAtRef.current = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: the scan slows to a quarter speed
          if (e.phase === "enter") {
            scanScaleRef.current.target = 0.25;
            playNote(36, 260);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") scanScaleRef.current.target = 1;
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter") {
          holdCeremony = false;
          const hit = locate(e.x, e.y);
          holdIdx = hit && hit.zone === "p1" ? hit.idx : -1;
          return;
        }
        if (e.phase === "release") {
          if (holdIdx >= 0 && e.tier >= 2) {
            recordTape("sigil", 0.5, "charts/grown");
            addChartMark(`grown ${holdIdx + 1}`, "rise", 0.6);
          }
          holdIdx = -1;
          return;
        }
        // dwell tier — the held candle grows: its close accretes upward
        // under the finger, tick by tick
        if (e.tier >= 2 && holdIdx >= 0 && !holdCeremony) {
          const { yMin, yMax } = p1RangeRef.current;
          const span = yMax - yMin || 1;
          const idx = holdIdx;
          setCandles((prev) => {
            if (!prev[idx]) return prev;
            const next = prev.slice();
            next[idx] = { ...next[idx], tweak: next[idx].tweak + span * 0.0035 };
            return next;
          });
          const nowMs = performance.now();
          if (nowMs - lastGrowNoteAt > 240) {
            lastGrowNoteAt = nowMs;
            const c = candlesRef.current[idx];
            if (c) playClickForCandle(c);
            try { haptics.tap(); } catch { /* noop */ }
          }
        }
        // ceremony tier — the room's one solemn act: the reading is pinned,
        // kept exactly as the hand shaped it
        if (e.tier >= 3 && !holdCeremony) {
          holdCeremony = true;
          onPinRef.current();
          try { haptics.bloom(); } catch { /* noop */ }
        }
      },
      pan2: (e) => {
        lastGestureAtRef.current = performance.now();
        panRef.current.tx = Math.max(-30, Math.min(30, panRef.current.tx + e.dx * 0.25));
        panRef.current.ty = Math.max(-20, Math.min(20, panRef.current.ty + e.dy * 0.25));
      },
      twist: (e) => {
        lastGestureAtRef.current = performance.now();
        if (e.fingers === 3) {
          // three-finger twist = season: a slow warm/cool drift.
          if (e.phase === "move") seasonRef.current += e.angle * 0.7;
          return;
        }
        if (e.phase !== "move") return;
        // twist rotates the lens: the same series as candlestick chart or
        // as the raw walk beneath it
        twistAcc += e.angle;
        const step = Math.PI / 2;
        while (Math.abs(twistAcc) >= step) {
          twistAcc -= Math.sign(twistAcc) * step;
          lensRef.current.target = lensRef.current.target > 0.5 ? 0 : 1;
          if (lensRef.current.target > 0.5) overlay.setAttribute("data-lens-raised", "1");
          else overlay.removeAttribute("data-lens-raised");
          playNote(lensRef.current.target > 0.5 ? 64 : 57, 140);
          try { haptics.lens(); } catch { /* noop */ }
          recordTape("sigil", 0.5, lensRef.current.target > 0.5 ? "charts/lens-walk" : "charts/lens-candles");
          addChartMark(lensRef.current.target > 0.5 ? "the raw walk" : "ohlc", "pale", 0.6);
        }
      },
      scrub: (e) => {
        lastGestureAtRef.current = performance.now();
        const nowMs = performance.now();
        if (nowMs - lastScrubAt < 500) return;
        lastScrubAt = nowMs;
        // circling winds the field's storminess — with the turn volatility
        // rises, against it the series calms
        const dir = Math.sign(e.winding) || 1;
        const v = Math.round(Math.min(3, Math.max(0.1, volRef.current + dir * 0.2)) / 0.05) * 0.05;
        setVolatility(v);
        if (dir > 0) stirTurbulence(0.09);
        playNote(46 + (v / 3.0) * 26, 130);
        try { haptics.ripple(0.32); } catch { /* noop */ }
        recordTape("object", 0.4, "charts/vol-wind");
        addChartMark(`vol ${v.toFixed(2)}`, "amber", 0.5);
      },
      rhythm: (e) => {
        // a steady tapped pulse: the scan line locks to your tempo
        if (e.stability <= 0.7) return;
        entrainRef.current.bpm = Math.max(40, Math.min(150, e.bpm));
        entrainRef.current.until = performance.now() + 9000;
        recordTape("sigil", 0.45, "charts/entrain");
      },
    }, { wheelZoom: false });

    return detach;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locate, playClickForCandle, playNote, recordTape]);

  // ── the vessel (lib/vessel) — the plate hangs from real gravity ────────
  // Passive subscription: nothing flows until the candle has granted the
  // senses. Tilt leans the whole reading down-slope; shake churns the field
  // through the shared turbulence axis; a knock on the case rings the plate;
  // face-down is night and the instrument sleeps.
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const detach = onVessel({
      tilt: ({ gamma }) => {
        const lean = Math.max(-1, Math.min(1, gamma / 38));
        tiltRef.current.target = lean;
        // a detent where the slope gets steep: the reading answers in sound
        // and touch, not only in the lean the eye already reads
        const mag = Math.abs(lean);
        const now = performance.now();
        if (!tiltRef.current.over && mag > 0.55 && now - tiltRef.current.lastCueAt > 700) {
          tiltRef.current.over = true;
          tiltRef.current.lastCueAt = now;
          lastGestureAtRef.current = now;
          playNote(lean > 0 ? 55 : 48, 200);
          try { haptics.detent(); } catch { /* noop */ }
          addMarkRef.current(lean > 0 ? "lean up" : "lean dn", lean > 0 ? "rise" : "fall", 0.5);
        } else if (tiltRef.current.over && mag < 0.34) {
          tiltRef.current.over = false;
        }
      },
      shake: ({ intensity }) => {
        // agitation lands on the shared axis — the churn the panels draw,
        // and the weight every haptic in the room hits with
        stirTurbulence(Math.min(0.55, 0.18 + intensity * 0.6));
        lastGestureAtRef.current = performance.now();
        try { getFieldAudio().thud(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
        recordTape("ripple", Math.min(1, 0.5 + intensity * 0.5), "charts/churn");
        addMarkRef.current("churn", "amber", Math.min(0.9, 0.5 + intensity * 0.4));
      },
      knock: ({ intensity }) => {
        const now = performance.now();
        if (now - knockRef.current.t0 < 420) return;
        knockRef.current = { t0: now, intensity };
        lastGestureAtRef.current = now;
        stirTurbulence(0.06 + intensity * 0.08);
        try { getFieldAudio().bell(); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        recordTape("object", 0.4 + intensity * 0.3, "charts/knock");
        addMarkRef.current("ring", "pale", 0.5 + intensity * 0.3);
      },
      flip: ({ faceDown }) => {
        nightRef.current.target = faceDown ? 1 : 0;
        if (reduce) nightRef.current.cur = faceDown ? 1 : 0;
        lastGestureAtRef.current = performance.now();
        playNote(faceDown ? 33 : 45, faceDown ? 320 : 200);
        try { haptics.roll(); } catch { /* noop */ }
        addMarkRef.current(faceDown ? "night" : "plate", "pale", 0.44);
      },
    });

    return detach;
  }, [playNote, recordTape]);

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
        padding: "clamp(16px, 3vh, 32px) clamp(16px, 4vw, 48px) calc(96px + env(safe-area-inset-bottom))",
        display: "flex",
        flexDirection: "column",
        gap: "clamp(12px, 2vh, 22px)",
        touchAction: "manipulation",
      }}
    >
      {/* whisper-quiet title — the chart is the object, not a captioned figure */}
      <header
        aria-hidden="true"
        style={{ display: "flex", alignItems: "baseline", gap: 12, opacity: 0.44 }}
      >
        <span
          style={{
            fontFamily: "var(--font-fraunces, var(--font-display), Georgia, serif)",
            fontWeight: 500,
            fontSize: "clamp(15px, 1.9vw, 20px)",
            letterSpacing: "0.01em",
            lineHeight: 1,
          }}
        >
          Flow Compass
        </span>
        <span
          className="t-mono"
          style={{
            fontSize: 9.5,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            opacity: 0.7,
          }}
        >
          candles · d/dt · rsi
        </span>
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
        <div className="oda-charts-mark-strip" aria-hidden="true">
          <span className="oda-charts-mark-pulse" />
          {chartMarks.length === 0 ? (
            <span className="oda-charts-mark-idle">rsi {fmt(lastRsi)}</span>
          ) : (
            chartMarks.map((mark) => (
              <span
                key={mark.id}
                className={`oda-charts-mark oda-charts-mark-${mark.tone}`}
                style={{ opacity: 0.4 + mark.strength * 0.48 }}
              >
                {mark.label}
              </span>
            ))
          )}
        </div>
        <div className="oda-charts-gesture" aria-hidden="true">
          drag the plots · left edge tunes volatility
        </div>
        {/* pointer overlay only on the canvas — keeps controls untouched.
            contact gestures live in the engine; hover is the quiet dialect */}
        <div
          ref={overlayRef}
          onPointerMove={onHoverMove}
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
              <span style={fraunceNum}>{fmt(effClose(hoverC))}</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Exact controls stay present on desktop and move into an opt-in sheet on phones. */}
      <MobileInstrumentPanel
        title="chart tune & history"
        triggerLabel="tune"
        summary={`vol ${volatility.toFixed(2)} · rsi ${fmt(lastRsi)}`}
      >
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

          {/* The canvas gutter is primary; this is the precise keyboard fallback. */}
          <label className="sr-only oda-charts-volatility">
            <span>volatility</span>
            <input
              type="range"
              min={0.1}
              max={3.0}
              step={0.05}
              value={volatility}
              onChange={(e) => setVolatility(parseFloat(e.target.value))}
              onPointerUp={() => {
                haptics.tap();
                recordTape("object", 0.34, `charts:vol:${volatility.toFixed(2)}`);
                addChartMark(`vol ${volatility.toFixed(2)}`, "amber", 0.46);
              }}
              onKeyUp={() => {
                recordTape("object", 0.28, `charts:vol:${volatility.toFixed(2)}`);
                addChartMark(`vol ${volatility.toFixed(2)}`, "amber", 0.42);
              }}
            />
            <strong>{volatility.toFixed(2)}</strong>
          </label>

          <span
            className="t-mono oda-charts-status"
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "lowercase",
              opacity: 0.55,
              marginLeft: "auto",
            }}
          >
            vol{" "}
            <span style={{ ...fraunceNum, opacity: 0.82 }}>{volatility.toFixed(2)}</span>
            <span style={{ margin: "0 10px", opacity: 0.3 }}>·</span>
            rsi{" "}
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
      </MobileInstrumentPanel>

      <LetGo label="let the pinned reading go" onLetGo={letGoPinned} visible={pinned !== null} />

      {/* scoped styling — mobile stack */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .oda-charts-mark-strip {
              position: absolute;
              top: 12px;
              right: 12px;
              z-index: 3;
              display: flex;
              align-items: center;
              justify-content: flex-end;
              gap: 7px;
              max-width: min(440px, calc(100% - 24px));
              min-height: 31px;
              padding: 8px 10px;
              border: 1px solid rgba(232,226,213,0.13);
              border-radius: 999px;
              background: rgba(8,12,20,0.62);
              color: rgba(232,226,213,0.64);
              font-family: var(--font-mono, ui-monospace, monospace);
              font-size: 11px;
              line-height: 1;
              pointer-events: none;
              overflow: hidden;
              backdrop-filter: blur(12px);
            }
            .oda-charts-mark-pulse {
              flex: 0 0 auto;
              width: 7px;
              height: 7px;
              border-radius: 999px;
              background: rgba(255,180,110,0.9);
              box-shadow: 0 0 14px rgba(255,180,110,0.42);
            }
            .oda-charts-mark-idle,
            .oda-charts-mark {
              white-space: nowrap;
            }
            .oda-charts-gesture {
              display: none;
            }
            .oda-charts-mark-rise {
              color: rgba(118,218,158,0.9);
            }
            .oda-charts-mark-fall {
              color: rgba(238,126,112,0.9);
            }
            .oda-charts-mark-amber {
              color: rgba(255,190,124,0.9);
            }
            .oda-charts-mark-pale {
              color: rgba(232,226,213,0.78);
            }
            @media (max-width: 699px) {
              .oda-charts-root {
                box-sizing: border-box;
                height: calc(100svh - 56px) !important;
                min-height: calc(100svh - 56px) !important;
                gap: 10px !important;
                padding: 14px 14px calc(86px + env(safe-area-inset-bottom)) !important;
              }
              .oda-charts-surface {
                flex: 1 1 auto !important;
                min-height: 0 !important;
              }
              .oda-charts-mark-strip {
                top: 10px;
                left: 10px;
                right: 10px;
                max-width: none;
                justify-content: center;
              }
              .oda-charts-gesture {
                position: absolute;
                z-index: 3;
                right: 12px;
                bottom: 12px;
                left: 12px;
                display: block;
                color: rgba(232,226,213,0.48);
                font-family: var(--font-mono, ui-monospace, monospace);
                font-size: 9px;
                letter-spacing: 0.06em;
                text-align: center;
                text-transform: lowercase;
                pointer-events: none;
              }
              .oda-charts-controls {
                display: grid !important;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px !important;
                align-items: stretch !important;
                padding: 0 !important;
              }
              .oda-charts-controls > button {
                min-height: 46px !important;
              }
              .oda-charts-controls > button:nth-child(3) {
                grid-column: 1 / -1;
              }
              .oda-charts-volatility {
                position: relative !important;
                grid-column: 1 / -1;
                width: 100% !important;
                height: auto !important;
                display: grid !important;
                grid-template-columns: auto minmax(0, 1fr) 46px;
                align-items: center;
                gap: 10px;
                margin: 0 !important;
                overflow: visible !important;
                clip: auto !important;
                clip-path: none !important;
                white-space: normal !important;
                padding: 12px;
                border: 1px solid rgba(232,226,213,0.14);
                border-radius: 8px;
                color: rgba(232,226,213,0.68);
                font-family: var(--font-mono, ui-monospace, monospace);
                font-size: 10px;
                text-transform: lowercase;
              }
              .oda-charts-volatility input[type="range"] {
                width: 100%;
                min-width: 0;
                accent-color: rgba(255,180,110,0.9);
              }
              .oda-charts-volatility strong {
                color: rgba(255,190,124,0.92);
                font-family: var(--font-numerals, var(--font-serif, Georgia, serif));
                font-size: 15px;
                font-weight: 500;
                text-align: right;
              }
              .oda-charts-status {
                grid-column: 1 / -1;
                margin-left: 0 !important;
                min-height: 28px;
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
  lensT = 0,
  waveOff?: (i: number) => number,
  detailParticles = 1,
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

  // candles — the dressed representation fades as the lens turns to the walk
  ctx.save();
  ctx.globalAlpha = 1 - lensT * 0.82;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const e = effectiveCandle(c);
    const { high, low } = e;
    const up = e.close >= e.open;
    const isHovered = i === hoverIdx;
    const off = waveOff ? waveOff(i) * h * 0.05 : 0;
    const cx = L.padL + i * L.slot + L.slot / 2;
    const yOpen = yOf(e.open) + off;
    const yClose = yOf(e.close) + off;
    const yHigh = yOf(high) + off;
    const yLow = yOf(low) + off;
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

    // tweak indicator — a small bright marker at the manipulated close.
    // A decorative extra draw, so it scales off first on lower tiers.
    if (Math.abs(c.tweak) > 0.001 && detailParticles > 0.5) {
      ctx.fillStyle = "rgba(255,180,110,0.95)";
      ctx.beginPath();
      ctx.arc(cxPx, yClose, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // the raw walk — the same series stripped to the price path itself; the
  // twist lens rotates between this and the candlestick dressing
  if (lensT > 0.02) {
    ctx.save();
    ctx.globalAlpha = lensT;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < candles.length; i++) {
      const off = waveOff ? waveOff(i) * h * 0.05 : 0;
      const x = L.padL + i * L.slot + L.slot / 2;
      const y = yOf(effClose(candles[i])) + off;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // additive glow pass instead of ctx.shadowBlur — the same path, once
    // wide and dim underneath, once crisp on top.
    ctx.strokeStyle = "rgba(255,180,110,0.35)";
    ctx.lineWidth = 1.8 + 7;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,190,124,0.92)";
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
  }
}

function drawPanel2(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  d1: ReadonlyArray<number>,
  d1Ema: ReadonlyArray<number>,
  rangeRef: React.MutableRefObject<{ top: number; bot: number; yMin: number; yMax: number }>,
  waveOff?: (i: number) => number,
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
  rangeRef.current = { top, bot, yMin, yMax };
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
  for (let i = 0; i < N; i++) {
    const off = waveOff ? waveOff(i) * h * 0.06 : 0;
    pts.push({ x: xOf(i), y: yOf(d1[i]) + off, v: d1[i] });
  }

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
    const emaOff = (j: number) => (waveOff ? waveOff(j) * h * 0.06 : 0);
    const x = xOf(i);
    const y = yOf(d1Ema[i]) + emaOff(i);
    if (i === 0) ctx.moveTo(x, y);
    else {
      const px = xOf(i - 1);
      const py = yOf(d1Ema[i - 1]) + emaOff(i - 1);
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
  rangeRef: React.MutableRefObject<{ top: number; bot: number }>,
  waveOff?: (i: number) => number,
) {
  const top = L.p3Top + 18;
  const bot = L.p3Top + L.p3H - 6;
  const h = bot - top;
  if (h <= 0 || rsi.length === 0) return;
  rangeRef.current = { top, bot };

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
  const rsiOff = (j: number) => (waveOff ? waveOff(j) * h * 0.06 : 0);
  for (let i = 0; i < rsi.length - 1; i++) {
    const a = rsi[i];
    const b = rsi[i + 1];
    const mid = (a + b) / 2;
    ctx.strokeStyle = zoneColor(mid);
    ctx.beginPath();
    ctx.moveTo(xOf(i), yOf(a) + rsiOff(i));
    const cp1x = (xOf(i) + xOf(i + 1)) / 2;
    ctx.bezierCurveTo(cp1x, yOf(a) + rsiOff(i), cp1x, yOf(b) + rsiOff(i + 1), xOf(i + 1), yOf(b) + rsiOff(i + 1));
    ctx.stroke();
  }

  // current value dot
  const last = rsi[rsi.length - 1];
  ctx.fillStyle = zoneColor(last);
  ctx.beginPath();
  ctx.arc(xOf(rsi.length - 1), yOf(last) + rsiOff(rsi.length - 1), 2.6, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Faint inscriptions pressed into the plate. Not captions — the words sit
 * under the data at whisper alpha so the chart stays the object.
 */
function drawInscriptions(ctx: CanvasRenderingContext2D, L: Layout) {
  ctx.save();
  ctx.textAlign = "center";
  const cx = L.padL + (L.width - L.padL - L.padR) / 2;

  ctx.fillStyle = "rgba(244,238,222,0.06)";
  ctx.font = "italic 500 clamp(15px, 2.4vw, 26px) Georgia, 'Times New Roman', serif";
  ctx.fillText("the chart that reads the field", cx, L.p1Top + L.p1H * 0.52);

  ctx.fillStyle = "rgba(244,238,222,0.05)";
  ctx.font = "italic 13px Georgia, 'Times New Roman', serif";
  ctx.fillText("manipulate one and watch the others answer", cx, L.height - 12);
  ctx.restore();
}

/**
 * The volatility control, on-canvas. A knob rides a vertical track in the
 * left gutter beside Panel 1 — drag it to breathe the series wider or calmer.
 */
function drawVolHandle(ctx: CanvasRenderingContext2D, L: Layout, volatility: number) {
  const top = L.p1Top + 18;
  const bot = L.p1Top + L.p1H - 18;
  if (bot <= top) return;
  const x = Math.round(L.padL * 0.5) + 0.5;
  const t = Math.max(0, Math.min(1, (volatility - 0.1) / (3.0 - 0.1)));
  const knobY = bot - t * (bot - top);

  ctx.save();
  // track
  ctx.strokeStyle = "rgba(232,226,213,0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bot);
  ctx.stroke();
  // filled portion (amber), from bottom up to the knob
  ctx.strokeStyle = "rgba(255,180,110,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, bot);
  ctx.lineTo(x, knobY);
  ctx.stroke();
  // knob
  ctx.fillStyle = "rgba(255,180,110,0.95)";
  ctx.beginPath();
  ctx.arc(x, knobY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(8,12,20,0.9)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // vertical label
  ctx.translate(x - 9, (top + bot) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "rgba(232,226,213,0.34)";
  ctx.font = "9px var(--font-mono, ui-monospace)";
  ctx.textAlign = "center";
  ctx.fillText("vol", 0, 0);
  ctx.restore();
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
