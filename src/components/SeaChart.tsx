"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { createFrameGovernor, onVisibility, resolveDpr } from "@/lib/room-runtime";
import * as haptics from "@/lib/haptics";

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
  // twist(2) rotates the lens through candles/line/oscillator. `mode` is a
  // parent-controlled prop (this component is meant to be embedded), so a
  // local override mirrors it — a new `mode` prop always wins, a hand's
  // twist wins until then. Kept in state (not just a ref) so the inline
  // header label stays in sync with what the canvas actually renders.
  const [displayMode, setDisplayMode] = useState<SeaChartMode>(mode);
  useEffect(() => { setDisplayMode(mode); }, [mode]);
  const modeRef = useRef(displayMode);
  const candleCountRef = useRef(candleCount);
  const upColorRef = useRef(upColor);
  const downColorRef = useRef(downColor);
  const staticRef = useRef(isStatic);
  const tickMsRef = useRef(tickMs);
  const pullKeyRef = useRef(pullKey);

  useEffect(() => { sourceRef.current = source; }, [source]);
  useEffect(() => { modeRef.current = displayMode; }, [displayMode]);
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
  const lensTwistAccRef = useRef(0);

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
    // Reused every frame by draw() — allocated once here, never in the
    // RAF loop. Sized for the widest possible render (all candles plus
    // the one sliding in).
    const nudgedView: SeaChartCandle[] = [];
    for (let k = 0; k <= candleCountRef.current; k++) {
      nudgedView.push({ open: 0, close: 0, high: 0, low: 0, volume: 0 });
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

    const gov = createFrameGovernor();
    let sleeping = document.hidden;
    const offVisibility = onVisibility((hidden) => { sleeping = hidden; });

    const resize = () => {
      const dpr = resolveDpr(gov.tier(), { reducedMotion: reduce });
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

    const commitDrag = () => {
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

    // ── the gesture surface ─────────────────────────────────────────
    // One finger touches the material: the instant of contact (below any
    // gesture threshold) strikes the tapped candle's note — same
    // precedent as Jewel.tsx's onContact — then a vertical drag nudges
    // its price, reverberating outward to any subscriber (the ocean).
    // Two fingers touch the map: twist rotates the lens between candles,
    // line, and oscillator. Pinch/pan2 are exempt — a fixed candle count
    // has no zoomable/pannable range. Vessel: knock rings the chart;
    // shake/tilt/flip are exempt — this component is meant to be
    // embedded, often several at once, and a device-wide shake driving
    // every instance on the page at once would be noise, not music.
    const onContact = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = canvas.clientWidth;
      const i = indexAtX(x, w);
      if (i === null) return;
      const candle = i < candles.length ? candles[i] : incoming;
      if (candle) playCandleNote(candle);
      interactionRef.current.dragIdx = i;
      interactionRef.current.dragStartY = y;
      interactionRef.current.dragOffset = 0;
      interactionRef.current.hoverIdx = i;
    };
    canvas.addEventListener("pointerdown", onContact);

    // Cosmetic hover only (desktop mouse, no button down) — not a
    // gesture; the drag lifecycle below owns dragOffset.
    const onHover = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      interactionRef.current.hoverX = x;
      interactionRef.current.hoverY = y;
      if (interactionRef.current.dragIdx === null) {
        interactionRef.current.hoverIdx = indexAtX(x, canvas.clientWidth);
      }
    };
    canvas.addEventListener("pointermove", onHover);
    const onLeave = () => {
      if (interactionRef.current.dragIdx === null) interactionRef.current.hoverIdx = null;
    };
    canvas.addEventListener("pointerleave", onLeave);

    const detachGestures = attachGestures(
      canvas,
      {
        drag: (e) => {
          if (e.fingers !== 1) return;
          if (e.phase === "end") { commitDrag(); return; }
          if (interactionRef.current.dragIdx === null) return;
          const rect = canvas.getBoundingClientRect();
          const y = e.y - rect.top;
          interactionRef.current.dragOffset = interactionRef.current.dragStartY - y;
        },
        twist: (e) => {
          if (e.fingers === 3) return; // season — no world-law axis on this widget
          if (e.phase === "start") lensTwistAccRef.current = 0;
          if (e.phase === "move") lensTwistAccRef.current += e.angle;
          if (e.phase === "end" && Math.abs(lensTwistAccRef.current) > Math.PI / 2) {
            setDisplayMode((m) => (m === "candles" ? "line" : m === "line" ? "oscillator" : "candles"));
            try { haptics.lens(); } catch { /* noop */ }
          }
        },
        tap: (e) => {
          if (e.fingers === 2) {
            interactionRef.current.hoverIdx = null;
            try { haptics.tap(); } catch { /* noop */ }
            return;
          }
          if (e.fingers === 3) {
            // tutti — one synchronized pulse of everything alive.
            for (let i = 0; i < candles.length; i++) {
              const c = candles[i];
              window.setTimeout(() => playCandleNote(c), i * 16);
            }
            try { haptics.ripple(0.6); } catch { /* noop */ }
          }
        },
      },
      { wheelZoom: false },
    );

    const detachVessel = onVessel({
      knock: () => {
        if (candles.length === 0) return;
        playCandleNote(candles[Math.floor(candles.length / 2)]);
        interactionRef.current.pulseAt = performance.now();
        try { haptics.tap(); } catch { /* noop */ }
      },
    });

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

      // Apply pending nudges (+ the live drag) into the reused nudgedView
      // buffer — mutated in place every frame. SPEC forbids allocation
      // inside the RAF loop; this used to `.map()`/`.concat()` a fresh
      // array and object per candle, every frame, forever.
      const nudgeMap = nudgeMapRef.current;
      const NUDGE_LIFE = 1500;
      for (const [idx, nudge] of nudgeMap) {
        if (now - nudge.t0 >= NUDGE_LIFE) nudgeMap.delete(idx);
      }
      const renderCount = candles.length + (incoming ? 1 : 0);
      for (let i = 0; i < renderCount; i++) {
        const src = i < candles.length ? candles[i] : (incoming as SeaChartCandle);
        const n = nudgeMap.get(i);
        const d = n ? n.value * Math.max(0, 1 - (now - n.t0) / NUDGE_LIFE) : 0;
        const dst = nudgedView[i];
        dst.open = src.open + d;
        dst.close = src.close + d;
        dst.high = src.high + d;
        dst.low = src.low + d;
        dst.volume = src.volume;
      }

      // also fold in the LIVE drag for the candle being grabbed (since the
      // user hasn't released yet, no entry exists in nudgeMap).
      const dragIdx = interactionRef.current.dragIdx;
      const dragPx = interactionRef.current.dragOffset;
      if (dragIdx !== null && dragIdx >= 0 && dragIdx < renderCount) {
        // We need the y-scale to convert px → price. Computed below.
        // First derive it now from non-dragged values so the conversion is
        // stable, then apply.
        let tempMin = Infinity, tempMax = -Infinity;
        for (let i = 0; i < renderCount; i++) {
          const c = nudgedView[i];
          if (c.low < tempMin) tempMin = c.low;
          if (c.high > tempMax) tempMax = c.high;
        }
        if (!Number.isFinite(tempMin) || !Number.isFinite(tempMax) || tempMax === tempMin) {
          tempMin = -1; tempMax = 1;
        }
        const pricePerPx = (tempMax - tempMin) / Math.max(1, candleAreaH);
        const livePriceDelta = Math.max(-1.5, Math.min(1.5, dragPx * pricePerPx));
        const c = nudgedView[dragIdx];
        c.open += livePriceDelta;
        c.close += livePriceDelta;
        c.high += livePriceDelta;
        c.low += livePriceDelta;
      }

      // y-scale
      let yMin = Infinity;
      let yMax = -Infinity;
      for (let i = 0; i < renderCount; i++) {
        const c = nudgedView[i];
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
      for (let i = 0; i < renderCount; i++) if (nudgedView[i].volume > vMax) vMax = nudgedView[i].volume;
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
      const renderIdxAt = (i: number) => (i < candles.length ? i : candleCountRef.current);

      if (mode === "line") {
        // draw a polyline over the close prices
        ctx.strokeStyle = fillFromHex(upHex, 0.85);
        ctx.lineWidth = 1.6;
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i < renderCount; i++) {
          const idx = renderIdxAt(i);
          const c = nudgedView[i];
          const cx = padL + idx * slot + slot / 2 + xShift;
          const cy = yOfPrice(c.close);
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        // subtle filled area below
        if (renderCount > 0) {
          const lastIdx = renderIdxAt(renderCount - 1);
          const firstIdx = renderIdxAt(0);
          ctx.lineTo(padL + lastIdx * slot + slot / 2 + xShift, candleAreaH);
          ctx.lineTo(padL + firstIdx * slot + slot / 2 + xShift, candleAreaH);
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
        for (let i = 0; i < renderCount; i++) {
          const idx = renderIdxAt(i);
          const c = nudgedView[i];
          const cx = padL + idx * slot + slot / 2 + xShift;
          const cy = yOfPrice(c.close);
          const above = c.close >= midPrice;
          ctx.fillStyle = fillFromHex(above ? upHex : dnHex, 0.78);
          ctx.fillRect(cx - bodyW / 2, Math.min(cy, midY), bodyW, Math.abs(cy - midY));
        }
      } else {
        // candles (default)
        for (let i = 0; i < renderCount; i++) {
          const idx = renderIdxAt(i);
          const c = nudgedView[i];
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
      if (mode === "candles" && hi !== null && hi >= 0 && hi < candles.length) {
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
    const loop = (now: number) => {
      gov.beginFrame(now);
      raf = requestAnimationFrame(loop);
      if (sleeping) return; // no draw while the tab/frame is hidden
      draw();
    };

    raf = requestAnimationFrame(loop);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      offVisibility();
      canvas.removeEventListener("pointerdown", onContact);
      canvas.removeEventListener("pointermove", onHover);
      canvas.removeEventListener("pointerleave", onLeave);
      detachGestures();
      detachVessel();
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
          <span style={{ opacity: 0.55 }}>{displayMode === "line" ? "line" : displayMode === "oscillator" ? "osc" : "ohlc"}</span>
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
