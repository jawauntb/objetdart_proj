"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import SeaChart, { type SeaChartCandle } from "@/components/SeaChart";

/**
 * /tide — the phenomenology page.
 *
 * Night. Atlantic outside. Candle on the windowsill inside. Time is
 * horizontal: drag anywhere across the canvas to scrub. Territories —
 * abstract landmasses, never named — drift in and out as you scrub.
 * Audio rhythm morphs across the timeline so different t-positions
 * sound like different cadences.
 *
 * The page does not explain itself. There is one inscribed line at the
 * bottom. Everything else has to be felt.
 */
// territory tone signatures — keyed on territory index (0..6). Each plays a
// slightly different one-shot so a tapped territory has a "voice".
function triggerTerritoryTone(idx: number): void {
  const a = getFieldAudio();
  switch (idx % 7) {
    case 0: a.chime();  break;
    case 1: a.bell();   break;
    case 2: a.thud();   break;
    case 3: a.chime();  break;
    case 4: a.bell();   break;
    case 5: a.refuse(); break;
    case 6: a.thud();   break;
    default: a.chime(); break;
  }
}

type Ripple = { id: number; x: number; y: number; size: number; tone: "gold" | "pale" };

export default function Tide() {
  // page-specific ambient bed: ocean swell
  useEffect(() => { getFieldAudio().setAmbientProfile("ocean"); }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrubT = useRef<number>(0.5); // 0..1, "now" sits at 0.5
  const dragging = useRef<{ active: boolean; lastX: number; startX: number; startY: number; moved: boolean }>({
    active: false, lastX: 0, startX: 0, startY: 0, moved: false,
  });
  const presenceAudioRef = useRef<{ active: Set<number>; lastEnter: Map<number, number> }>({
    active: new Set(),
    lastEnter: new Map(),
  });
  // pointer for candle-lean (same model as Watch.tsx). Smoothed via lerp.
  const cursor = useRef({ x: -9999, y: -9999, tx: -9999, ty: -9999, over: false });
  // smoothed candle lean in px (additive with the existing flicker)
  const candleLean = useRef(0);

  // Hit data populated each frame inside draw(). The pointerdown/up handlers
  // read this to know what got tapped without re-running geometry.
  const hitRef = useRef<{
    territories: Array<{ idx: number; x: number; y: number; baseR: number }>;
    ships: Array<{ idx: number; x: number; y: number; r: number }>;
    candle: { x: number; y: number; r: number };
    window: { x: number; y: number; w: number; h: number };
    scrub: { x0: number; x1: number; y: number };
  }>({
    territories: [],
    ships: [],
    candle: { x: 0, y: 0, r: 0 },
    window: { x: 0, y: 0, w: 0, h: 0 },
    scrub: { x0: 0, x1: 0, y: 0 },
  });
  // The territory currently hovered (canvas-space). null = none.
  const hoverIdxRef = useRef<number | null>(null);
  // Per-territory pulse — set to performance.now() on tap; the draw loop
  // brightens the territory edge for ~500ms.
  const territoryPulseRef = useRef<Map<number, number>>(new Map());
  // Per-frame candle spark — performance.now() on tap; draw loop flashes the
  // halo brighter for ~350ms.
  const candleSparkRef = useRef<number>(0);
  const windowPulseRef = useRef<number>(0);
  const shipPulseRef = useRef<Map<number, number>>(new Map());

  // DOM ripples — small expanding circles layered on top of the canvas. We
  // keep them in state so React can render them; each removes itself after
  // the animation completes.
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleIdRef = useRef(0);

  // Chart pull key bumps every ~600ms so the inline tide chart re-pulls
  // synthetic tide-height candles derived from scrubT.current.
  const [tideChartPullKey, setTideChartPullKey] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTideChartPullKey((k) => k + 1), 600);
    return () => window.clearInterval(id);
  }, []);

  // Synthetic tide-height source: each "candle" is a slice along a 30-minute
  // window centered on the scrub position. The shape is a slow sine (tide
  // cycle) modulated by the current scrubT — so dragging through time
  // reshapes the chart in lock step with the visible territory presence.
  const tideSource = (i: number): SeaChartCandle => {
    const sT = scrubT.current;
    // 30 candles = 30 minutes; each one is 1 minute of tide.
    const COUNT = 30;
    const idxNorm = (i % COUNT) / COUNT; // 0..1 within window
    const center = sT;
    const u = center + (idxNorm - 0.5) * 0.1; // small +/- 5% wander
    const open = Math.sin(u * Math.PI * 2 * 1.2) * 0.7 + Math.sin(u * Math.PI * 5.3) * 0.18;
    const close = Math.sin((u + 0.012) * Math.PI * 2 * 1.2) * 0.7 + Math.sin((u + 0.012) * Math.PI * 5.3) * 0.18;
    const high = Math.max(open, close) + 0.08;
    const low = Math.min(open, close) - 0.08;
    const volume = Math.abs(close - open) + 0.05;
    return { open, close, high, low, volume };
  };

  const recordTape = useField((s) => s.recordTape);
  const recordTapeRef = useRef(recordTape);
  useEffect(() => {
    recordTapeRef.current = recordTape;
  }, [recordTape]);

  const reduceMotionRef = useRef(false);

  const addRipple = (x: number, y: number, size: number, tone: "gold" | "pale") => {
    if (reduceMotionRef.current) return;
    const id = ++rippleIdRef.current;
    setRipples((rs) => [...rs, { id, x, y, size, tone }]);
    window.setTimeout(() => {
      setRipples((rs) => rs.filter((r) => r.id !== id));
    }, 720);
  };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reduceMotionRef.current = reduce;
    let raf = 0;
    const t0 = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = window.innerWidth * dpr;
      cv.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // ── territories ──────────────────────────────────────────────
    // Each is an abstract landmass at a deterministic t-position with
    // a unique polygonal silhouette. They REAPPEAR at later t-positions
    // to model recurrence — a "person as landscape" returns.
    type Territory = {
      anchorT: number;       // primary t-position
      recurT: number[];      // t-positions where it returns
      seed: number;          // controls shape
      lobes: number;         // 3–7
      scale: number;         // baseline radius
      hue: "warm" | "cool" | "mid";
      name: string;          // internal label, never shown
    };
    const TERRITORIES: Territory[] = [
      { anchorT: 0.10, recurT: [0.42, 0.83], seed: 0.13, lobes: 5, scale: 0.06, hue: "warm", name: "first" },
      { anchorT: 0.20, recurT: [0.55, 0.90], seed: 0.27, lobes: 4, scale: 0.05, hue: "cool", name: "kept" },
      { anchorT: 0.34, recurT: [0.71],       seed: 0.41, lobes: 6, scale: 0.07, hue: "mid",  name: "long" },
      { anchorT: 0.46, recurT: [0.62, 0.94], seed: 0.55, lobes: 3, scale: 0.045, hue: "warm", name: "near" },
      { anchorT: 0.58, recurT: [0.86],       seed: 0.61, lobes: 7, scale: 0.075, hue: "cool", name: "wide" },
      { anchorT: 0.66, recurT: [0.18, 0.40], seed: 0.73, lobes: 5, scale: 0.055, hue: "mid",  name: "kept-again" },
      { anchorT: 0.78, recurT: [0.30],       seed: 0.89, lobes: 6, scale: 0.06, hue: "warm", name: "later" },
    ];
    const SHIPS = [
      { id: 0, t: 0.18, yFrac: 0.60, scale: 0.78, name: "skiff" },
      { id: 1, t: 0.48, yFrac: 0.70, scale: 1.0, name: "late-sail" },
      { id: 2, t: 0.76, yFrac: 0.82, scale: 0.88, name: "returning" },
    ];

    // deterministic per-territory polygon shape (no Math.random — same shape every render)
    function territoryShape(t: Territory, points = 80): Array<{ a: number; r: number }> {
      const pts: Array<{ a: number; r: number }> = [];
      for (let i = 0; i < points; i++) {
        const a = (i / points) * Math.PI * 2;
        // sum sines at lobes frequencies, seeded — gives a unique silhouette
        const r = 1 + 0.45 * Math.sin(a * t.lobes + t.seed * 7) +
                  0.22 * Math.sin(a * (t.lobes * 2 + 1) + t.seed * 11) +
                  0.12 * Math.sin(a * (t.lobes * 3 + 2) + t.seed * 17);
        pts.push({ a, r });
      }
      return pts;
    }

    const territoryHueColor = (h: Territory["hue"], alpha: number) => {
      switch (h) {
        case "warm": return `rgba(200, 115, 42, ${alpha})`;   // candle
        case "cool": return `rgba(120, 170, 210, ${alpha})`;  // azure
        case "mid":  return `rgba(180, 130, 90, ${alpha})`;   // muted clay
      }
    };

    // ── pointer scrub + interactive surface ──────────────────────
    // Hit-testing helpers — read from hitRef (populated per draw frame).
    const hitTestTerritory = (x: number, y: number): number | null => {
      let best: number | null = null;
      let bestDist = Infinity;
      for (const t of hitRef.current.territories) {
        const dx = x - t.x;
        const dy = y - t.y;
        // Use territory baseR with slack — silhouettes wobble, so be generous.
        const d = Math.hypot(dx, dy);
        if (d <= t.baseR * 1.25 && d < bestDist) {
          best = t.idx;
          bestDist = d;
        }
      }
      return best;
    };

    const hitTestCandle = (x: number, y: number): boolean => {
      const c = hitRef.current.candle;
      if (c.r <= 0) return false;
      return Math.hypot(x - c.x, y - c.y) <= c.r;
    };

    const hitTestWindow = (x: number, y: number): boolean => {
      const win = hitRef.current.window;
      if (win.w <= 0 || win.h <= 0) return false;
      return x >= win.x && x <= win.x + win.w && y >= win.y && y <= win.y + win.h;
    };

    const hitTestShip = (x: number, y: number): number | null => {
      let best: number | null = null;
      let bestD = Infinity;
      for (const ship of hitRef.current.ships) {
        const d = Math.hypot(x - ship.x, y - ship.y);
        if (d <= ship.r && d < bestD) {
          best = ship.idx;
          bestD = d;
        }
      }
      return best;
    };

    const hitTestScrub = (x: number, y: number): number | null => {
      const s = hitRef.current.scrub;
      if (s.x1 <= s.x0) return null;
      if (Math.abs(y - s.y) > 18) return null;
      const fx = Math.max(0, Math.min(1, (x - s.x0) / (s.x1 - s.x0)));
      return fx;
    };

    const onDown = (e: PointerEvent) => {
      dragging.current.active = true;
      dragging.current.lastX = e.clientX;
      dragging.current.startX = e.clientX;
      dragging.current.startY = e.clientY;
      dragging.current.moved = false;
      cv.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      // always track for the candle-lean
      cursor.current.tx = e.clientX;
      cursor.current.ty = e.clientY;
      cursor.current.over = true;

      // hover: update the territory under the cursor for visual feedback.
      const hov = hitTestTerritory(e.clientX, e.clientY);
      if (hov !== hoverIdxRef.current) {
        hoverIdxRef.current = hov;
      }

      if (!dragging.current.active) return;

      const tdx = e.clientX - dragging.current.startX;
      const tdy = e.clientY - dragging.current.startY;
      if (!dragging.current.moved && Math.hypot(tdx, tdy) > 6) {
        dragging.current.moved = true;
      }

      // Only treat as scrub once we've moved past the tap threshold.
      if (!dragging.current.moved) return;

      const dx = e.clientX - dragging.current.lastX;
      dragging.current.lastX = e.clientX;
      // 1.4x viewport-width = full scrub
      const sensitivity = 1 / (window.innerWidth * 1.4);
      scrubT.current = Math.max(0, Math.min(1, scrubT.current + dx * sensitivity));
    };
    const onCursorLeave = () => { cursor.current.over = false; hoverIdxRef.current = null; };
    const onUp = (e: PointerEvent) => {
      const wasActive = dragging.current.active;
      const moved = dragging.current.moved;
      dragging.current.active = false;
      dragging.current.moved = false;
      try { cv.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }

      // Treat as a tap only if the gesture barely moved.
      if (!wasActive || moved) return;
      const x = e.clientX;
      const y = e.clientY;

      // 1) candle on the sill
      if (hitTestCandle(x, y)) {
        candleSparkRef.current = performance.now();
        try { audio.spark(); } catch { /* noop */ }
        recordTapeRef.current("candle", 0.7);
        addRipple(x, y, 50, "gold");
        return;
      }

      // 2) window frame / room
      if (hitTestWindow(x, y)) {
        windowPulseRef.current = performance.now();
        try { audio.bell(); } catch { /* noop */ }
        recordTapeRef.current("candle", 0.45, "window");
        addRipple(x, y, 72, "gold");
        return;
      }

      // 3) scrub bar tap-to-jump
      const scrubF = hitTestScrub(x, y);
      if (scrubF !== null) {
        scrubT.current = scrubF;
        try { audio.chime(); } catch { /* noop */ }
        recordTapeRef.current("ripple", 0.4, `scrub-${scrubF.toFixed(2)}`);
        return;
      }

      // 4) ship tap
      const shipIdx = hitTestShip(x, y);
      if (shipIdx !== null) {
        shipPulseRef.current.set(shipIdx, performance.now());
        try { audio.chime(); } catch { /* noop */ }
        const name = SHIPS.find((s) => s.id === shipIdx)?.name ?? String(shipIdx);
        recordTapeRef.current("object", 0.45, `ship:${name}`);
        addRipple(x, y, 84, "pale");
        return;
      }

      // 5) territory tap
      const idx = hitTestTerritory(x, y);
      if (idx !== null) {
        triggerTerritoryTone(idx);
        territoryPulseRef.current.set(idx, performance.now());
        const name = TERRITORIES[idx]?.name ?? String(idx);
        recordTapeRef.current("ripple", 0.4, `tide:${name}`);
        addRipple(x, y, 90, "gold");
        return;
      }

      // 4) otherwise — soft chime on the open sea + a faint pale ripple.
      try { audio.chime(); } catch { /* noop */ }
      recordTapeRef.current("ripple", 0.25, "sea");
      addRipple(x, y, 70, "pale");
    };
    cv.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("pointerleave", onCursorLeave);
    window.addEventListener("blur", onCursorLeave);

    // ── audio: tide rhythm + territory presence ──────────────────
    const audio = getFieldAudio();
    // start the underlying ocean if not yet
    audio.start();

    let lastBeat = -1;
    const stepBeat = (now: number, sT: number) => {
      // overall BPM ranges 56 → 96 across t (slower earlier, faster later)
      const bpm = 56 + sT * 40;
      const beatLen = 60 / bpm;
      const beatPhase = ((now - t0) / 1000) % beatLen;
      const beatIndex = Math.floor((now - t0) / 1000 / beatLen);
      if (beatIndex !== lastBeat && beatPhase < 0.05) {
        lastBeat = beatIndex;
        // tonal layer changes by t
        // scale: pentatonic minor shifted by t
        const scaleSteps = [0, 3, 5, 7, 10]; // pentatonic minor
        const baseFreq = 110 * Math.pow(2, sT * 0.5); // A2 → ~D3
        const step = scaleSteps[beatIndex % scaleSteps.length];
        const freq = baseFreq * Math.pow(2, step / 12);
        // syncopation: skip beats based on t to give regional cadence
        const skip = (sT < 0.33 && beatIndex % 4 === 1)
                  || (sT > 0.66 && beatIndex % 3 === 2);
        if (!skip) {
          // a soft pluck — short oscillator handled via the chime helper-ish
          // (audio module has no direct "tone with explicit freq" — use chime
          // which produces a soft fall; reasonable for rhythm)
          // we'll dispatch via chime for now; consider extending audio.ts later
          if (sT > 0.5) audio.chime();
          else audio.thud();
          void freq; // freq is the design — kept for a future audio extension
        }
      }
    };

    // ── render loop ──────────────────────────────────────────────
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const sT = scrubT.current;
      const motion = reduce ? 0 : 1;

      // night palette: deep prussian sky → black-sea below, with a band
      // of mid-azure for the horizon
      const skyG = ctx.createLinearGradient(0, 0, 0, h * 0.55);
      skyG.addColorStop(0,    "rgba( 18,  24,  38, 1.0)");
      skyG.addColorStop(0.45, "rgba( 26,  46,  76, 1.0)");
      skyG.addColorStop(1,    "rgba( 42,  76, 112, 1.0)");
      ctx.fillStyle = skyG;
      ctx.fillRect(0, 0, w, h * 0.55);

      // sea
      const seaY = h * 0.55;
      const seaG = ctx.createLinearGradient(0, seaY, 0, h);
      seaG.addColorStop(0,   "rgba( 30,  56,  88, 1.0)");
      seaG.addColorStop(0.4, "rgba( 18,  36,  64, 1.0)");
      seaG.addColorStop(1,   "rgba(  6,  14,  28, 1.0)");
      ctx.fillStyle = seaG;
      ctx.fillRect(0, seaY, w, h - seaY);

      // a hairline horizon
      ctx.strokeStyle = "rgba(220, 220, 235, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, seaY + 0.5);
      ctx.lineTo(w, seaY + 0.5);
      ctx.stroke();

      // far stars (deterministic — same constellation each render)
      ctx.fillStyle = "rgba(240, 244, 248, 0.55)";
      for (let i = 0; i < 60; i++) {
        const sx = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
        const sy = (((Math.sin(i * 78.233) * 43758.5453) % 1) + 1) % 1;
        const x = sx * w;
        const y = sy * (h * 0.45);
        // very subtle twinkle
        const tw = 0.6 + 0.4 * Math.sin(t * 1.5 + i * 1.3);
        ctx.globalAlpha = 0.45 * tw;
        ctx.fillRect(x, y, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;

      // moon-glint streak — sweeps slowly with sT (anchored to time of night)
      const moonX = w * (0.3 + sT * 0.5);
      const moonG = ctx.createLinearGradient(moonX, seaY, moonX, h);
      moonG.addColorStop(0, "rgba(240, 245, 252, 0.40)");
      moonG.addColorStop(0.5, "rgba(240, 245, 252, 0.10)");
      moonG.addColorStop(1, "rgba(240, 245, 252, 0)");
      ctx.fillStyle = moonG;
      ctx.fillRect(moonX - 28, seaY, 56, h - seaY);

      // soft wave lines on the sea, slower at low sT, faster at high sT
      const speedScale = 0.35 + sT * 0.8;
      const swellLfo = Math.sin(t * Math.PI * 2 * (0.10 + sT * 0.10));
      const ampMod = 1 + swellLfo * 0.20;
      const swells = [
        { yFrac: 0.62, amp: 6,  freq: 0.011, color: "rgba(160, 200, 230, 0.45)" },
        { yFrac: 0.72, amp: 10, freq: 0.0095, color: "rgba(120, 170, 210, 0.55)" },
        { yFrac: 0.84, amp: 16, freq: 0.0080, color: "rgba(80, 130, 180, 0.65)" },
        { yFrac: 0.94, amp: 22, freq: 0.0065, color: "rgba(50, 100, 150, 0.78)" },
      ];
      for (const sw of swells) {
        const y0 = h * sw.yFrac;
        ctx.strokeStyle = sw.color;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const ph = x * sw.freq + t * speedScale * motion;
          const v = Math.sin(ph) + 0.35 * Math.sin(ph * 2.3);
          const yy = y0 + v * sw.amp * ampMod;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }

      const drawShip = (
        x: number,
        y: number,
        scale: number,
        pulse: number,
      ) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale * (1 + pulse * 0.08), scale * (1 + pulse * 0.08));
        ctx.strokeStyle = `rgba(242, 238, 230, ${0.66 + pulse * 0.24})`;
        ctx.fillStyle = `rgba(10, 18, 30, ${0.74 + pulse * 0.12})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-22, 8);
        ctx.quadraticCurveTo(-8, 18, 18, 8);
        ctx.lineTo(25, 1);
        ctx.quadraticCurveTo(2, 6, -25, 1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = `rgba(242, 238, 230, ${0.74 + pulse * 0.2})`;
        ctx.beginPath();
        ctx.moveTo(-2, 2);
        ctx.lineTo(-2, -31);
        ctx.stroke();
        ctx.fillStyle = `rgba(220, 235, 255, ${0.48 + pulse * 0.26})`;
        ctx.beginPath();
        ctx.moveTo(0, -29);
        ctx.quadraticCurveTo(18, -17, 4, -2);
        ctx.lineTo(0, -2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = `rgba(200, 115, 42, ${0.34 + pulse * 0.34})`;
        ctx.beginPath();
        ctx.moveTo(-4, -25);
        ctx.quadraticCurveTo(-18, -13, -5, -1);
        ctx.closePath();
        ctx.fill();
        if (pulse > 0) {
          ctx.strokeStyle = `rgba(255, 220, 160, ${pulse * 0.65})`;
          ctx.beginPath();
          ctx.ellipse(0, 4, 34, 12, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      };

      const shipHits: Array<{ idx: number; x: number; y: number; r: number }> = [];
      for (const ship of SHIPS) {
        const wrap = ((ship.t - sT + 0.5) % 1 + 1) % 1;
        const x = wrap * w;
        const y = h * ship.yFrac + Math.sin(t * 0.7 + ship.id * 1.4) * 4 * motion;
        const depthScale = ship.scale * (0.82 + ship.yFrac * 0.28);
        const pulseAt = shipPulseRef.current.get(ship.id);
        const pulseAge = pulseAt ? now - pulseAt : Infinity;
        if (pulseAt && pulseAge > 1200) shipPulseRef.current.delete(ship.id);
        const pulse = pulseAge < 720 ? Math.max(0, 1 - pulseAge / 720) : 0;
        drawShip(x, y, depthScale, pulse);
        shipHits.push({ idx: ship.id, x, y, r: 36 * depthScale });
      }
      hitRef.current.ships = shipHits;

      // territories — drifting landmasses, fading in as sT approaches them
      const cx = w * 0.5;
      const cy = h * 0.66;
      const presenceWindow = 0.16; // half-width of presence
      const nowActive = new Set<number>();
      // Rebuild the per-frame territory hit list. We only register the
      // largest-presence occurrence per territory so a tap maps to one idx.
      const hitTerritories: Array<{ idx: number; x: number; y: number; baseR: number; presence: number }> = [];

      TERRITORIES.forEach((tr, idx) => {
        const positions = [tr.anchorT, ...tr.recurT];
        positions.forEach((pos, posIdx) => {
          const dist = Math.abs(sT - pos);
          if (dist > presenceWindow) return;
          const presence = 1 - dist / presenceWindow; // 0..1
          if (presence < 0.06) return;
          nowActive.add(idx);

          // each occurrence drifts slightly so it doesn't sit in lockstep
          const drift = (posIdx + 1) * 0.13 + idx * 0.21;
          const driftX = Math.sin(t * 0.16 + drift * 7) * w * 0.12;
          const driftY = Math.cos(t * 0.12 + drift * 5) * h * 0.06;

          // first occurrence is the anchor (largest); recurrences slightly smaller
          const sizeFactor = posIdx === 0 ? 1.0 : 0.74;
          const baseR = Math.min(w, h) * tr.scale * sizeFactor * (0.6 + presence * 0.6);

          const x = cx + driftX + (posIdx - 0.5) * w * 0.10;
          const y = cy + driftY;

          // is this the territory currently hovered or pulsing from a tap?
          const isHover = hoverIdxRef.current === idx;
          const pulseAt = territoryPulseRef.current.get(idx);
          const pulseAge = pulseAt ? now - pulseAt : Infinity;
          const isPulsing = pulseAge < 500;
          if (!isPulsing && pulseAt !== undefined && pulseAge > 1500) {
            territoryPulseRef.current.delete(idx);
          }
          // visual boosts (skipped under prefers-reduced-motion):
          const motionBoost = reduce ? 0 : 1;
          const pulseBoost = isPulsing ? (1 - pulseAge / 500) : 0;
          const inflate = motionBoost * (isHover ? 0.06 : 0) + motionBoost * pulseBoost * 0.10;
          const effR = baseR * (1 + inflate);

          // record hit info for the highest-presence occurrence (the anchor)
          if (posIdx === 0) {
            hitTerritories.push({ idx, x, y, baseR: effR, presence });
          }

          const pts = territoryShape(tr);

          // territory fill — soft, with hue. Hover brightens slightly.
          const fillAlpha = 0.08 * presence + (isHover ? 0.04 : 0);
          ctx.fillStyle = territoryHueColor(tr.hue, fillAlpha);
          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const a = p.a;
            const r = p.r * effR * (1 + Math.sin(t * 0.5 + a * 3 + tr.seed * 4) * 0.04);
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();

          // territory edge — thin, etched. Hover brightens the stroke;
          // a pulse momentarily thickens it.
          const strokeAlpha = (isHover ? 0.85 : 0.55) * presence + pulseBoost * 0.30;
          ctx.strokeStyle = territoryHueColor(tr.hue, Math.min(1, strokeAlpha));
          ctx.lineWidth = 1.1 + (isHover ? 0.7 : 0) + pulseBoost * 1.4;
          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const a = p.a;
            const r = p.r * effR * (1 + Math.sin(t * 0.5 + a * 3 + tr.seed * 4) * 0.04);
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();

          // hover/pulse: a small pulsing inner shape at the centroid
          if (isHover || isPulsing) {
            const innerR = effR * (0.18 + (isHover ? 0.04 : 0) + pulseBoost * 0.12);
            ctx.strokeStyle = territoryHueColor(tr.hue, 0.7);
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.arc(x, y, innerR, 0, Math.PI * 2);
            ctx.stroke();
          }
        });
      });
      // Publish the new hit list for the pointer handlers.
      hitRef.current.territories = hitTerritories.map(({ idx, x, y, baseR }) => ({ idx, x, y, baseR }));

      // play a chime when a territory newly enters presence (debounced)
      const presenceAudio = presenceAudioRef.current;
      nowActive.forEach((idx) => {
        if (!presenceAudio.active.has(idx)) {
          const last = presenceAudio.lastEnter.get(idx) ?? 0;
          if (now - last > 1400) {
            // gentle chime, not on every render
            audio.chime();
            presenceAudio.lastEnter.set(idx, now);
          }
        }
      });
      presenceAudio.active = nowActive;

      // rhythm pulse
      stepBeat(now, sT);

      // window frame — interior, on the right edge, suggesting a room
      const narrow = w < 700;
      const winLeft = narrow ? w * 0.58 : w * 0.78;
      const winTop = narrow ? h * 0.14 : h * 0.18;
      const winRight = w - (narrow ? 22 : 36);
      const winBottom = narrow ? h * 0.52 : h * 0.62;
      const windowAge = windowPulseRef.current ? now - windowPulseRef.current : Infinity;
      const windowPulse = windowAge < 700 ? Math.max(0, 1 - windowAge / 700) : 0;
      if (windowPulse > 0) {
        ctx.strokeStyle = `rgba(255, 210, 140, ${windowPulse * 0.55})`;
        ctx.lineWidth = 10;
        ctx.strokeRect(winLeft - 4, winTop - 4, winRight - winLeft + 8, winBottom - winTop + 8);
      }
      // sill
      ctx.fillStyle = "rgba(80, 56, 36, 0.86)";
      ctx.fillRect(winLeft - 12, winBottom - 6, (winRight + 12) - (winLeft - 12), 18);
      // frame
      ctx.strokeStyle = "rgba(80, 56, 36, 0.88)";
      ctx.lineWidth = 5;
      ctx.strokeRect(winLeft, winTop, winRight - winLeft, winBottom - winTop);
      // mullion
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo((winLeft + winRight) / 2, winTop);
      ctx.lineTo((winLeft + winRight) / 2, winBottom);
      ctx.stroke();
      hitRef.current.window = {
        x: winLeft - 16,
        y: winTop - 16,
        w: winRight - winLeft + 32,
        h: winBottom - winTop + 34,
      };

      // the candle — on the windowsill, paper-warm against the night
      const candleX = winLeft + (winRight - winLeft) * 0.5;
      const candleBaseY = winBottom + 2;
      const candleW = narrow ? 18 : 22;
      const candleH = narrow ? 62 : 78;

      // ── cursor-lean: flame tips toward the pointer when nearby ──
      // ease the smoothed cursor toward the live pointer
      const cur = cursor.current;
      if (cur.tx > -9000) {
        cur.x = cur.x < -9000 ? cur.tx : cur.x + (cur.tx - cur.x) * 0.20;
        cur.y = cur.y < -9000 ? cur.ty : cur.y + (cur.ty - cur.y) * 0.20;
      }
      // target lean — flame top sits roughly at candleBaseY - candleH - 18
      const flameAnchorX = candleX;
      const flameAnchorY = candleBaseY - candleH - 18;
      let leanTarget = 0;
      if (cur.over && motion && cur.x > -9000) {
        const dx = cur.x - flameAnchorX;
        const dy = cur.y - flameAnchorY;
        const d = Math.hypot(dx, dy);
        // within ~300px, pull toward cursor; cap at 6px
        const pull = Math.max(0, 1 - d / 300);
        leanTarget = (dx / (d || 1)) * pull * 6;
      }
      candleLean.current += (leanTarget - candleLean.current) * 0.15;
      const leanX = candleLean.current;
      // candle spark — when tapped, the halo flashes brighter for ~350ms.
      const sparkAge = candleSparkRef.current ? now - candleSparkRef.current : Infinity;
      const sparkBoost = sparkAge < 350 ? (1 - sparkAge / 350) : 0;
      // halo
      const flickerR = (44 + Math.sin(t * 3.4) * 6 + Math.sin(t * 7.1) * 3) * (motion || 1) * (1 + sparkBoost * 0.6);
      const halo = ctx.createRadialGradient(candleX, candleBaseY - candleH - 10, 0, candleX, candleBaseY - candleH - 10, flickerR);
      halo.addColorStop(0, `rgba(255, 200, 130, ${0.55 + sparkBoost * 0.40})`);
      halo.addColorStop(0.4, `rgba(200, 115, 42, ${0.30 + sparkBoost * 0.30})`);
      halo.addColorStop(1, "rgba(200, 115, 42, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(candleX, candleBaseY - candleH - 10, flickerR, 0, 7);
      ctx.fill();

      // publish candle hit info (a generous circle around the flame & body).
      hitRef.current.candle = {
        x: candleX,
        y: candleBaseY - candleH * 0.5,
        r: Math.max(36, candleH * 0.65),
      };
      // candle body
      ctx.fillStyle = "rgba(242, 238, 230, 0.95)";
      ctx.fillRect(candleX - candleW / 2, candleBaseY - candleH, candleW, candleH);
      ctx.strokeStyle = "rgba(21,23,26,0.45)";
      ctx.lineWidth = 1;
      ctx.strokeRect(candleX - candleW / 2, candleBaseY - candleH, candleW, candleH);
      // wick
      ctx.strokeStyle = "rgba(21,23,26,0.85)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(candleX, candleBaseY - candleH - 1);
      ctx.lineTo(candleX, candleBaseY - candleH - 9);
      ctx.stroke();
      // flame — flicker (existing) + cursor-lean (new) are additive
      const flameJitter = motion ? Math.sin(t * 9) * 1.2 + Math.cos(t * 5.3) * 0.8 : 0;
      ctx.fillStyle = "rgba(255, 200, 130, 0.85)";
      ctx.beginPath();
      ctx.moveTo(candleX, candleBaseY - candleH - 9);
      ctx.quadraticCurveTo(candleX + 5 + flameJitter + leanX, candleBaseY - candleH - 16, candleX + leanX * 0.6, candleBaseY - candleH - 26);
      ctx.quadraticCurveTo(candleX - 5 - flameJitter + leanX, candleBaseY - candleH - 16, candleX, candleBaseY - candleH - 9);
      ctx.fill();
      ctx.fillStyle = "rgba(200, 115, 42, 0.92)";
      ctx.beginPath();
      ctx.moveTo(candleX, candleBaseY - candleH - 9);
      ctx.quadraticCurveTo(candleX + 2.6 + leanX * 0.6, candleBaseY - candleH - 13, candleX + leanX * 0.4, candleBaseY - candleH - 20);
      ctx.quadraticCurveTo(candleX - 2.6 + leanX * 0.6, candleBaseY - candleH - 13, candleX, candleBaseY - candleH - 9);
      ctx.fill();

      // scrub-position indicator — a gold tide rail showing where in the tide we are
      const indicatorY = h - 56;
      ctx.strokeStyle = "rgba(200, 115, 42, 0.30)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(40, indicatorY);
      ctx.lineTo(w - 40, indicatorY);
      ctx.stroke();
      for (let i = 0; i <= 6; i++) {
        const tx = 40 + (i / 6) * (w - 80);
        const tideLift = Math.sin((i / 6) * Math.PI * 2 + sT * Math.PI * 2) * 7;
        ctx.fillStyle = i % 2 === 0 ? "rgba(220,235,255,0.62)" : "rgba(200,115,42,0.56)";
        ctx.beginPath();
        ctx.arc(tx, indicatorY + tideLift, i % 2 === 0 ? 2.6 : 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      const ix = 40 + sT * (w - 80);
      // small mark
      ctx.fillStyle = "rgba(200, 115, 42, 0.95)";
      ctx.beginPath();
      ctx.arc(ix, indicatorY, 6, 0, 7);
      ctx.fill();
      ctx.strokeStyle = "rgba(242,238,230,0.65)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ix, indicatorY, 11, 0, Math.PI * 2);
      ctx.stroke();

      // publish scrub hit geometry
      hitRef.current.scrub = { x0: 40, x1: w - 40, y: indicatorY };

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      cv.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointerleave", onCursorLeave);
      window.removeEventListener("blur", onCursorLeave);
    };
  }, []);

  return (
    <div
      data-touch-surface="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "#0c1422",
        // overlap header + footer chrome by sitting fixed under them — but the
        // layout's header/footer should still float over us
      }}
    >
      <canvas
        ref={canvasRef}
        aria-label="the tide — drag horizontally to move through time"
        style={{
          display: "block",
          width: "100vw",
          height: "100vh",
          cursor: "ew-resize",
          touchAction: "none",
        }}
      />

      {/* the one inscribed line. nothing else explains the page. */}
      {/* The inscription. The outer div spans the page but has pointer-events:
          none; only the inner <span> is clickable so taps on the surrounding
          sea pass through to the canvas. */}
      <div
        className="tide-inscription-wrap"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 22,
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <span
          className="tide-inscription"
          role="button"
          tabIndex={0}
          aria-label="what burns also keeps watch — chime"
          onClick={(e) => {
            e.stopPropagation();
            try { getFieldAudio().bell(); } catch { /* noop */ }
            candleSparkRef.current = performance.now();
            recordTape("candle", 0.55, "inscription");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              try { getFieldAudio().bell(); } catch { /* noop */ }
              candleSparkRef.current = performance.now();
              recordTape("candle", 0.55, "inscription");
            }
          }}
          style={{
            display: "inline-block",
            padding: "4px 8px",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 16,
            color: "rgba(242, 238, 230, 0.55)",
            letterSpacing: "0.005em",
          }}
        >
          what burns also keeps watch.
        </span>
      </div>

      {/* DOM ripple overlay — small expanding circles for taps. Visual only;
          we keep pointerEvents:none so they never block subsequent taps. */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
        }}
      >
        {ripples.map((r) => (
          <span
            key={r.id}
            className="tide-ripple"
            style={{
              left: r.x - r.size / 2,
              top: r.y - r.size / 2,
              width: r.size,
              height: r.size,
              borderColor: r.tone === "gold"
                ? "rgba(200,115,42,0.85)"
                : "rgba(220,235,255,0.45)",
            }}
          />
        ))}
      </div>

      {/* ── Tide chart embeds: small candle + line view of the tide
            height across the last 30 simulated minutes. Bottom-left. ── */}
      <div
        className="tide-charts"
        style={{
          position: "fixed",
          left: 24,
          bottom: 64,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "auto",
          zIndex: 5,
        }}
      >
        <SeaChart
          variant="inline"
          mode="candles"
          title="tide — last 30 min"
          caption="drag a candle to nudge"
          width={280}
          height={96}
          tickMs={0}
          source={tideSource}
          pullKey={tideChartPullKey}
          static
          feedToOcean
          tapeLabel="tide/chart"
          upColor="#88B8D8"
          downColor="#C8732A"
          background="rgba(12, 20, 34, 0.78)"
        />
        <SeaChart
          variant="inline"
          mode="line"
          title="line · tide height"
          caption="moon at t = scrub"
          width={280}
          height={52}
          tickMs={0}
          source={tideSource}
          pullKey={tideChartPullKey}
          static
          feedToOcean={false}
          tapeLabel="tide/line"
          upColor="#88B8D8"
          downColor="#C8732A"
          background="rgba(12, 20, 34, 0.78)"
        />
      </div>
      <style>{`
        @media (max-width: 720px) {
          .tide-charts {
            display: none !important;
          }
          .tide-inscription-wrap {
            bottom: 54px !important;
          }
          .tide-inscription {
            font-size: 14px !important;
            padding: 8px 10px !important;
          }
        }
      `}</style>
    </div>
  );
}
