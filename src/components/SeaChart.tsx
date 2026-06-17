"use client";

import { useEffect, useRef } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";

/**
 * SeaChart — the sea, but as a candlestick.
 *
 * The thesis of the site: candle <-> candlestick <-> chart <-> wave.
 * Each candle is hoverable (scaled with OHLC tooltip), clickable (plays a
 * pitched note based on close price), and draggable (vertical nudge that
 * reverberates outward through a custom "oda:sea-nudge" event picked up
 * by the global ocean visualizer).
 *
 * The component is reusable: pass `variant="card"` for the standalone
 * homepage section, or `variant="inline"` to embed a compact instrument
 * in the corner of any other scene. A `source` callback can supply an
 * external time series (e.g. storm intensity, tide height, foam pressure)
 * in place of the default sine-based wave sampling.
 */

export type SeaChartCandle = {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
};

export type SeaChartVariant = "card" | "inline";
export type SeaChartMode = "candles" | "line" | "oscillator";

export type SeaChartProps = {
  variant?: SeaChartVariant;
  mode?: SeaChartMode;
  title?: string;
  caption?: string;
  width?: number | string;
  height?: number;
  /** Optional explicit candle count. Defaults to 30. */
  candleCount?: number;
  /** Tick rate in ms. Defaults to 4000. Set 0 to freeze ticking. */
  tickMs?: number;
  /** Override accent colors (CSS rgba). Up = bullish, Down = bearish. */
  upColor?: string;
  downColor?: string;
  /** Background color (defaults to var(--paper)). */
  background?: string;
  /** Optional data source. If provided, the chart pulls candles from this
   *  function rather than the built-in sine sampler. The callback receives
   *  an absolute integer index that advances by 1 per tick. */
  source?: (index: number) => SeaChartCandle;
  /** When true, nudge events dispatch on window so the global ocean reacts.
   *  Defaults to true for the homepage card, false for inline embeds. */
  feedToOcean?: boolean;
  /** Optional label propagated into the recordTape `meta` slot. */
  tapeLabel?: string;
  /** When true, the chart freezes time (no ticking, no slide). Used by
   *  embeds that derive candles from an external buffer they manage. */
  static?: boolean;
  /** When set, the chart re-pulls candles from `source` on this counter
   *  changing. Lets the parent push fresh data without remounting. */
  pullKey?: number;
};

const DEFAULT_CANDLE_COUNT = 30;
const DEFAULT_TICK_MS = 4000;
const SLIDE_MS = 600;
const SESSION_SEED = typeof window !== "undefined" ? Date.now() % 100000 : 12345;

/** Default sine-FBM wave sampler used by the homepage card. */
function sampleWave(i: number): number {
  const base = Math.sin(i * 0.32 + SESSION_SEED * 0.0001);
  const n1 = Math.sin(i * 0.91 + SESSION_SEED * 0.0007) * 0.35;
  const n2 = Math.sin(i * 1.73 - SESSION_SEED * 0.0003) * 0.18;
  const n3 = Math.sin(i * 3.21 + SESSION_SEED * 0.0011) * 0.09;
  return base + n1 + n2 + n3;
}

function buildDefaultCandle(i: number): SeaChartCandle {
  const open = sampleWave(i);
  const close = sampleWave(i + 1);
  const dv = Math.abs(close - open);
  const vol = dv + Math.abs(Math.sin(i * 2.07 + SESSION_SEED * 0.0005)) * 0.22;
  const wickUp = vol * (0.35 + 0.25 * Math.abs(Math.sin(i * 1.13)));
  const wickDn = vol * (0.35 + 0.25 * Math.abs(Math.cos(i * 0.79)));
  const top = Math.max(open, close);
  const bot = Math.min(open, close);
  const high = top + wickUp;
  const low = bot - wickDn;
  const volume = Math.abs(close - sampleWave(i - 1)) + 0.05;
  return { open, close, high, low, volume };
}

/** Public: nudge the ocean (or any subscriber). Direction is +1 (boost
 *  amplitude) or -1 (damp). Subscribers receive a CustomEvent on `window`. */
export function dispatchSeaNudge(direction: 1 | -1, source?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("oda:sea-nudge", { detail: { direction, source } }),
    );
  } catch {
    /* noop */
  }
}

export default function SeaChart(props: SeaChartProps = {}) {
  const {
    variant = "card",
    mode = "candles",
    title = "what the sea was doing",
    caption = "swell · spray · wash · 30 minutes",
    width,
    height,
    candleCount = DEFAULT_CANDLE_COUNT,
    tickMs = DEFAULT_TICK_MS,
    upColor,
    downColor,
    background,
    source,
    feedToOcean,
    tapeLabel = "seachart",
    static: isStatic = false,
    pullKey,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Track refs that update on every prop change without re-running the RAF.
  const sourceRef = useRef(source);
  const modeRef = useRef(mode);
  const candleCountRef = useRef(candleCount);
  const upColorRef = useRef(upColor);
  const downColorRef = useRef(downColor);
  const staticRef = useRef(isStatic);
  const tickMsRef = useRef(tickMs);
  const pullKeyRef = useRef(pullKey);

  useEffect(() => { sourceRef.current = source; }, [source]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { candleCountRef.current = candleCount; }, [candleCount]);
  useEffect(() => { upColorRef.current = upColor; }, [upColor]);
  useEffect(() => { downColorRef.current = downColor; }, [downColor]);
  useEffect(() => { staticRef.current = isStatic; }, [isStatic]);
  useEffect(() => { tickMsRef.current = tickMs; }, [tickMs]);

  // Tooltip / hover / drag state lives on a ref so the RAF can read it
  // without re-running the effect when state churns.
  const interactionRef = useRef<{
    hoverIdx: number | null;
    hoverX: number;
    hoverY: number;
    dragIdx: number | null;
    dragOffset: number;        // y-delta in "price" units
    dragStartY: number;        // canvas y where drag began
    pulseAt: number;            // performance.now() of last nudge
  }>({
    hoverIdx: null,
    hoverX: 0,
    hoverY: 0,
    dragIdx: null,
    dragOffset: 0,
    dragStartY: 0,
    pulseAt: 0,
  });
  // Per-candle nudge offsets — additive on the open/close midpoint. Lerps
  // back to zero over ~1.5s so the chart "breathes back" after a drag.
  const nudgeMapRef = useRef<Map<number, { value: number; t0: number }>>(new Map());

  // shouldFeedOcean — default to card variant only, override via prop
  const shouldFeed = feedToOcean ?? (variant === "card");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // anchor + candle list
    let anchor = 0;
    const buildCandle = (i: number): SeaChartCandle =>
      sourceRef.current ? sourceRef.current(i) : buildDefaultCandle(i);
    let candles: SeaChartCandle[] = [];
    for (let k = 0; k < candleCountRef.current; k++) {
      candles.push(buildCandle(anchor + k));
    }

    let slideStart = 0;
    let incoming: SeaChartCandle | null = null;
    let lastTick = performance.now();
    let lastPullKey = pullKeyRef.current;

    const cssColor = (name: string, fallback: string): string => {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      return v.length ? v : fallback;
    };

    const fillFromHex = (hex: string, alpha: number): string => {
      // accept #rrggbb or already-rgba/rgb
      if (hex.startsWith("rgba") || hex.startsWith("rgb(")) return hex;
      const m = hex.replace("#", "");
      if (m.length < 6) return `rgba(60, 90, 130, ${alpha})`;
      const r = parseInt(m.slice(0, 2), 16);
      const g = parseInt(m.slice(2, 4), 16);
      const b = parseInt(m.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ── interaction helpers ───────────────────────────────────────
    const candleSlot = (w: number): number => {
      const innerW = w - 12; // padL + padR
      return innerW / candleCountRef.current;
    };

    const indexAtX = (cssX: number, w: number): number | null => {
      const padL = 6;
      const slot = candleSlot(w);
      const i = Math.floor((cssX - padL) / slot);
      if (i < 0 || i >= candleCountRef.current) return null;
      return i;
    };

    const playCandleNote = (c: SeaChartCandle) => {
      // map close price into MIDI 57..81 (A3..A5) within a pentatonic minor.
      // We need the visible price range so we can normalize close → 0..1.
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const x of candles) {
        if (x.low < yMin) yMin = x.low;
        if (x.high > yMax) yMax = x.high;
      }
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax === yMin) {
        yMin = -1; yMax = 1;
      }
      const norm = Math.max(0, Math.min(1, (c.close - yMin) / (yMax - yMin)));
      const scale = [0, 3, 5, 7, 10]; // pentatonic minor
      const step = scale[Math.floor(norm * scale.length) % scale.length];
      const octaveJump = Math.floor(norm * 2.99); // 0..2 octaves
      const midi = 57 + octaveJump * 12 + step;
      try { getFieldAudio().playNote(midi, 200); } catch { /* noop */ }
    };

    const recordNudgeTape = () => {
      try {
        useField.getState().recordTape("sigil", 0.6, `${tapeLabel}/nudge`);
      } catch { /* noop */ }
    };

    // ── pointer events ────────────────────────────────────────────
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      interactionRef.current.hoverX = x;
      interactionRef.current.hoverY = y;

      if (interactionRef.current.dragIdx !== null) {
        // y-delta → price delta. We approximate via the current visible
        // price range vs canvas height. Updated each frame in draw via
        // dragOffset being applied at render time. Store the px delta here;
        // the draw loop converts it using the live y-scale.
        interactionRef.current.dragOffset =
          (interactionRef.current.dragStartY - y); // px upward = positive
        return;
      }

      const w = canvas.clientWidth;
      const i = indexAtX(x, w);
      interactionRef.current.hoverIdx = i;
    };

    const onPointerLeave = () => {
      if (interactionRef.current.dragIdx === null) {
        interactionRef.current.hoverIdx = null;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = canvas.clientWidth;
      const i = indexAtX(x, w);
      if (i === null) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      // click → play note immediately. We'll convert to a drag if the
      // pointer moves > 4px on the y axis.
      const candle = i < candles.length ? candles[i] : incoming;
      if (candle) {
        playCandleNote(candle);
      }
      interactionRef.current.dragIdx = i;
      interactionRef.current.dragStartY = y;
      interactionRef.current.dragOffset = 0;
      interactionRef.current.hoverIdx = i;
    };

    const onPointerUp = (e: PointerEvent) => {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      const idx = interactionRef.current.dragIdx;
      if (idx === null) return;
      // Convert the drag pixel offset into a normalized nudge in price
      // units. We approximate using the current visible price range.
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const c of candles) {
        if (c.low < yMin) yMin = c.low;
        if (c.high > yMax) yMax = c.high;
      }
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax === yMin) {
        yMin = -1; yMax = 1;
      }
      const h = canvas.clientHeight;
      const pricePerPx = (yMax - yMin) / Math.max(1, h - 40);
      const delta = interactionRef.current.dragOffset * pricePerPx;
      if (Math.abs(delta) > 0.005) {
        // commit a nudge: stash in nudgeMapRef so the draw loop renders it,
        // then decays it. Direction → +1 boost, -1 damp.
        nudgeMapRef.current.set(idx, { value: delta, t0: performance.now() });
        // clamp range — too large nudges look broken
        const clamped = Math.max(-1.2, Math.min(1.2, delta));
        nudgeMapRef.current.set(idx, { value: clamped, t0: performance.now() });
        recordNudgeTape();
        if (shouldFeed) {
          dispatchSeaNudge(delta > 0 ? 1 : -1, tapeLabel);
        }
        interactionRef.current.pulseAt = performance.now();
      }
      interactionRef.current.dragIdx = null;
      interactionRef.current.dragOffset = 0;
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    // ── draw ──────────────────────────────────────────────────────
    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const paperVar = cssColor("--paper", "#F2EEE6");
      const seaVar = cssColor("--sea", "#2C4A5C");
      const candleVar = cssColor("--candle", "#C8732A");
      const rule = cssColor("--rule", "rgba(21,23,26,0.18)");
      const upHex = upColorRef.current ?? seaVar;
      const dnHex = downColorRef.current ?? candleVar;

      // background
      ctx.fillStyle = background ?? paperVar;
      ctx.fillRect(0, 0, w, h);

      // pull fresh candles when pullKey changes (lets external sources push
      // data without remounting the chart).
      if (pullKeyRef.current !== lastPullKey) {
        lastPullKey = pullKeyRef.current;
        candles = [];
        for (let k = 0; k < candleCountRef.current; k++) {
          candles.push(buildCandle(anchor + k));
        }
      }

      // tick
      const now = performance.now();
      const tickFrozen = staticRef.current || tickMsRef.current <= 0;
      if (!tickFrozen && now - lastTick >= tickMsRef.current && slideStart === 0) {
        const newIndex = anchor + candleCountRef.current;
        incoming = buildCandle(newIndex);
        anchor += 1;
        slideStart = now;
        lastTick = now;
      }

      // layout
      const padL = 6;
      const padR = 6;
      const candleAreaH = h - 28;
      const volumeAreaH = 20;
      const volumeTop = candleAreaH + 6;

      let slideT = 0;
      if (slideStart > 0) {
        slideT = Math.min(1, (now - slideStart) / (reduce ? SLIDE_MS * 1.5 : SLIDE_MS));
        if (slideT >= 1 && incoming) {
          candles = candles.slice(1).concat([incoming]);
          incoming = null;
          slideStart = 0;
          slideT = 0;
        }
      }

      // apply pending nudges to working-copy prices; decay over 1.5s
      const view = incoming ? candles.concat([incoming]) : candles;
      const nudgeMap = nudgeMapRef.current;
      const NUDGE_LIFE = 1500;
      for (const [idx, nudge] of nudgeMap) {
        const age = now - nudge.t0;
        if (age >= NUDGE_LIFE) nudgeMap.delete(idx);
      }
      // We only render with the nudge — the underlying candle stays clean.
      const nudgedView: SeaChartCandle[] = view.map((c, i) => {
        const n = nudgeMap.get(i);
        if (!n) return c;
        const age = now - n.t0;
        const k = Math.max(0, 1 - age / NUDGE_LIFE);
        const d = n.value * k;
        return {
          open: c.open + d,
          close: c.close + d,
          high: c.high + d,
          low: c.low + d,
          volume: c.volume,
        };
      });

      // also fold in the LIVE drag for the candle being grabbed (since the
      // user hasn't released yet, no entry exists in nudgeMap).
      const dragIdx = interactionRef.current.dragIdx;
      const dragPx = interactionRef.current.dragOffset;
      let livePriceDelta = 0;
      if (dragIdx !== null && dragIdx >= 0 && dragIdx < nudgedView.length) {
        // We need the y-scale to convert px → price. Computed below.
        // First derive it now from non-dragged values so the conversion is
        // stable, then apply.
        let tempMin = Infinity, tempMax = -Infinity;
        for (const c of nudgedView) {
          if (c.low < tempMin) tempMin = c.low;
          if (c.high > tempMax) tempMax = c.high;
        }
        if (!Number.isFinite(tempMin) || !Number.isFinite(tempMax) || tempMax === tempMin) {
          tempMin = -1; tempMax = 1;
        }
        const pricePerPx = (tempMax - tempMin) / Math.max(1, candleAreaH);
        livePriceDelta = dragPx * pricePerPx;
        // clamp
        livePriceDelta = Math.max(-1.5, Math.min(1.5, livePriceDelta));
        const c = nudgedView[dragIdx];
        nudgedView[dragIdx] = {
          open: c.open + livePriceDelta,
          close: c.close + livePriceDelta,
          high: c.high + livePriceDelta,
          low: c.low + livePriceDelta,
          volume: c.volume,
        };
      }

      // y-scale
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const c of nudgedView) {
        if (c.low < yMin) yMin = c.low;
        if (c.high > yMax) yMax = c.high;
      }
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax === yMin) {
        yMin = -1; yMax = 1;
      }
      const yPad = (yMax - yMin) * 0.08 || 0.1;
      yMin -= yPad;
      yMax += yPad;

      let vMax = 0;
      for (const c of nudgedView) if (c.volume > vMax) vMax = c.volume;
      if (vMax <= 0) vMax = 1;

      const innerW = w - padL - padR;
      const slot = innerW / candleCountRef.current;
      const bodyW = Math.max(2, Math.min(14, slot * 0.6));

      const yOfPrice = (p: number) => {
        const t = (p - yMin) / (yMax - yMin);
        return candleAreaH - t * candleAreaH;
      };

      // baseline rule
      ctx.strokeStyle = rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const baselineY = candleAreaH + volumeAreaH / 2 + 2;
      ctx.moveTo(0, Math.floor(baselineY) + 0.5);
      ctx.lineTo(w, Math.floor(baselineY) + 0.5);
      ctx.stroke();

      const mode = modeRef.current;
      const xShift = -slideT * slot;

      const renderList: Array<{ idx: number; c: SeaChartCandle }> = [];
      for (let i = 0; i < candles.length; i++) {
        renderList.push({ idx: i, c: nudgedView[i] });
      }
      if (incoming) {
        renderList.push({ idx: candleCountRef.current, c: nudgedView[nudgedView.length - 1] });
      }

      if (mode === "line") {
        // draw a polyline over the close prices
        ctx.strokeStyle = fillFromHex(upHex, 0.85);
        ctx.lineWidth = 1.6;
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i < renderList.length; i++) {
          const { idx, c } = renderList[i];
          const cx = padL + idx * slot + slot / 2 + xShift;
          const cy = yOfPrice(c.close);
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        // subtle filled area below
        const lastIdx = renderList[renderList.length - 1];
        if (lastIdx) {
          ctx.lineTo(padL + lastIdx.idx * slot + slot / 2 + xShift, candleAreaH);
          ctx.lineTo(padL + renderList[0].idx * slot + slot / 2 + xShift, candleAreaH);
          ctx.closePath();
          ctx.fillStyle = fillFromHex(upHex, 0.10);
          ctx.fill();
        }
      } else if (mode === "oscillator") {
        // Draw zero baseline at midpoint, plot close as deviation
        const midPrice = (yMax + yMin) / 2;
        const midY = yOfPrice(midPrice);
        ctx.strokeStyle = rule;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, Math.floor(midY) + 0.5);
        ctx.lineTo(w, Math.floor(midY) + 0.5);
        ctx.stroke();
        for (let i = 0; i < renderList.length; i++) {
          const { idx, c } = renderList[i];
          const cx = padL + idx * slot + slot / 2 + xShift;
          const cy = yOfPrice(c.close);
          const above = c.close >= midPrice;
          ctx.fillStyle = fillFromHex(above ? upHex : dnHex, 0.78);
          ctx.fillRect(cx - bodyW / 2, Math.min(cy, midY), bodyW, Math.abs(cy - midY));
        }
      } else {
        // candles (default)
        for (const { idx, c } of renderList) {
          const cx = padL + idx * slot + slot / 2 + xShift;
          if (cx < -bodyW || cx > w + bodyW) continue;

          const up = c.close >= c.open;
          const yOpen = yOfPrice(c.open);
          const yClose = yOfPrice(c.close);
          const yHigh = yOfPrice(c.high);
          const yLow = yOfPrice(c.low);

          // wick
          ctx.strokeStyle = "rgba(21, 23, 26, 0.45)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.floor(cx) + 0.5, yHigh);
          ctx.lineTo(Math.floor(cx) + 0.5, yLow);
          ctx.stroke();

          const bodyTop = Math.min(yOpen, yClose);
          const bodyBot = Math.max(yOpen, yClose);
          const bodyH = Math.max(1, bodyBot - bodyTop);

          // hover scaling — render at 1.15× width via translated rect
          const isHover = interactionRef.current.hoverIdx === idx;
          const isDrag = interactionRef.current.dragIdx === idx;
          const scale = isDrag ? 1.22 : isHover ? 1.15 : 1.0;
          const drawW = bodyW * scale;

          ctx.fillStyle = fillFromHex(up ? upHex : dnHex, isHover || isDrag ? 0.95 : 0.85);
          ctx.fillRect(cx - drawW / 2, bodyTop, drawW, bodyH);

          // volume — under baseline
          const vh = (c.volume / vMax) * (volumeAreaH - 2);
          ctx.fillStyle = "rgba(21, 23, 26, 0.16)";
          ctx.fillRect(cx - bodyW / 2, volumeTop, bodyW, Math.max(1, vh));

          // dragging halo
          if (isDrag) {
            ctx.strokeStyle = fillFromHex(up ? upHex : dnHex, 0.45);
            ctx.lineWidth = 1.4;
            ctx.strokeRect(
              cx - drawW / 2 - 2,
              bodyTop - 2,
              drawW + 4,
              bodyH + 4,
            );
          }
        }
      }

      // pulse ring at chart center after a nudge (200ms fade)
      const pulseAge = now - interactionRef.current.pulseAt;
      if (pulseAge < 480 && interactionRef.current.pulseAt > 0) {
        const k = 1 - pulseAge / 480;
        ctx.strokeStyle = `rgba(200, 115, 42, ${0.45 * k})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const cx = w / 2;
        const cy = candleAreaH / 2;
        ctx.arc(cx, cy, 8 + (1 - k) * 28, 0, Math.PI * 2);
        ctx.stroke();
      }

      // tooltip — only when hovering a candle in candles mode
      const hi = interactionRef.current.hoverIdx;
      if (mode === "candles" && hi !== null && hi >= 0 && hi < nudgedView.length) {
        const c = nudgedView[hi];
        const tx = interactionRef.current.hoverX + 10;
        const ty = Math.max(4, interactionRef.current.hoverY - 56);
        const pad = 6;
        const lines = [
          `O ${c.open.toFixed(2)}`,
          `H ${c.high.toFixed(2)}`,
          `L ${c.low.toFixed(2)}`,
          `C ${c.close.toFixed(2)}`,
        ];
        ctx.font = '10px var(--font-numerals, Fraunces), Georgia, serif';
        let maxW = 0;
        for (const l of lines) {
          const m = ctx.measureText(l);
          if (m.width > maxW) maxW = m.width;
        }
        const tw = maxW + pad * 2;
        const th = lines.length * 13 + pad * 2;
        // keep tooltip on-canvas
        const drawX = Math.min(w - tw - 2, Math.max(2, tx));
        const drawY = Math.min(h - th - 2, Math.max(2, ty));
        ctx.fillStyle = "rgba(21, 23, 26, 0.78)";
        ctx.fillRect(drawX, drawY, tw, th);
        ctx.fillStyle = "rgba(244, 246, 250, 0.95)";
        ctx.textBaseline = "top";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], drawX + pad, drawY + pad + i * 13);
        }
      }
    };

    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [background, shouldFeed, tapeLabel]);

  // pullKey via ref — write each render so the draw loop sees the latest
  pullKeyRef.current = pullKey;

  if (variant === "inline") {
    const w = typeof width === "number" ? `${width}px` : width ?? 280;
    const h = height ?? 120;
    return (
      <div
        aria-label={title}
        style={{
          width: w,
          maxWidth: "100%",
          background: background ?? "rgba(20, 24, 32, 0.55)",
          border: "1px solid rgba(244, 248, 255, 0.10)",
          borderRadius: 4,
          padding: 8,
          color: "rgba(244, 248, 255, 0.80)",
          fontFamily: "var(--font-mono, ui-monospace)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "lowercase",
            opacity: 0.72,
            marginBottom: 4,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>{title}</span>
          <span style={{ opacity: 0.55 }}>{mode === "line" ? "line" : mode === "oscillator" ? "osc" : "ohlc"}</span>
        </div>
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{
            display: "block",
            width: "100%",
            height: h,
            touchAction: "none",
            cursor: "ew-resize",
          }}
        />
        {caption && (
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.10em",
              textTransform: "lowercase",
              opacity: 0.50,
              marginTop: 4,
            }}
          >
            {caption}
          </div>
        )}
      </div>
    );
  }

  // card variant (homepage)
  return (
    <section
      style={{
        padding: "clamp(4vh, 7vh, 10vh) var(--pad-x)",
        borderTop: "1px solid var(--rule)",
      }}
      aria-label={title}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 22,
            color: "rgba(21, 23, 26, 0.75)",
            textAlign: "center",
            marginBottom: 16,
          }}
        >
          {title}
        </div>
        <canvas
          ref={canvasRef}
          aria-label="candlestick chart — hover for OHLC, click to play, drag a candle to nudge the sea"
          style={{
            display: "block",
            width: "100%",
            height: height ?? 260,
            touchAction: "none",
            cursor: "crosshair",
          }}
        />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "lowercase",
            color: "var(--ink-2)",
            textAlign: "center",
            marginTop: 12,
          }}
        >
          {caption}
        </div>
      </div>
    </section>
  );
}
