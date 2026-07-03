"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";

/**
 * /time — a playable relativity instrument.
 *
 * The hero is a mass-warped spacetime manifold. A worldline climbs out of the
 * observer's origin; dragging left/right sets VELOCITY (the worldline tilts
 * toward the 45° light cone), dragging up/down sets MASS (the grid curves into
 * a gravity well). Two clocks sit side by side — coordinate time runs at the
 * full rate while proper time falls behind by the Lorentz factor
 * γ = 1/√(1−v²/c²), so proper = elapsed / γ. Ticks strung along the worldline
 * mark equal intervals of proper time; as v rises they spread apart, which is
 * the whole story: speed up, and your own clock runs slow.
 */

const TAU = Math.PI * 2;
const VMAX = 0.985;
const SECONDS_PER_CLIMB = 12; // coordinate seconds spanned by the visible worldline

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const gammaOf = (v: number) => 1 / Math.sqrt(Math.max(1e-4, 1 - v * v));

function colorAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const n = parseInt(
    clean.length === 3 ? clean.split("").map((ch) => ch + ch).join("") : clean,
    16,
  );
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

const GEO = "#ffcf7a";   // worldline / proper geodesic
const LIGHT = "#7fb0ff"; // light cone
const WELL = "#ff8f6a";  // mass well
const INK = "rgba(246, 241, 224, 0.94)";

export default function TimeManifold() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const velRef = useRef(0.42);   // |v|/c magnitude
  const dirRef = useRef(1);      // tilt direction of the worldline (+right / -left)
  const massRef = useRef(38);    // 0..100
  const runningRef = useRef(false);
  const coordRef = useRef(0);    // coordinate time (ms)
  const properRef = useRef(0);   // proper time (ms)
  const lastTickRef = useRef(0); // last whole proper-second that chimed
  const reduceRef = useRef(false);
  const lastSyncRef = useRef(0);
  const lastToneRef = useRef(0);
  const lastControlRef = useRef(0);
  const pointerRef = useRef({ active: false, id: -1 });

  const recordTape = useField((s) => s.recordTape);

  const [velocity, setVelocity] = useState(0.42);
  const [mass, setMass] = useState(38);
  const [running, setRunning] = useState(false);
  const [readout, setReadout] = useState("proper 00:00.00 · γ 1.10 · v/c 0.420");

  useEffect(() => { velRef.current = velocity; }, [velocity]);
  useEffect(() => { massRef.current = mass; }, [mass]);
  useEffect(() => { runningRef.current = running; }, [running]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceRef.current = mq.matches;
    const update = () => { reduceRef.current = mq.matches; };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // ── the heartbeat: integrate the two clocks + paint the manifold ──
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(480, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      const delta = Math.min(60, now - last);
      last = now;

      const reduce = reduceRef.current;
      const vel = velRef.current;
      const dir = dirRef.current;
      const massN = massRef.current / 100;
      const gamma = gammaOf(vel);

      // integrate the two clocks — proper time dilates by 1/γ
      if (runningRef.current) {
        coordRef.current += delta;
        properRef.current += delta / gamma;
        const ps = Math.floor(properRef.current / 1000);
        if (ps > lastTickRef.current) {
          lastTickRef.current = ps;
          try { getFieldAudio().playNote(62, 120); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
        }
      }

      // ── geometry ──
      const Ox = width * 0.5;
      const Oy = height * 0.86;
      const cx = width * 0.5;
      const cy = height * 0.42;
      const S = Math.min(width, height);
      const CLIMB = Oy - height * 0.06;
      const strength = massN * S * 0.5;

      const warp = (x: number, y: number): [number, number] => {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy) + S * 0.06;
        let pull = strength / d;
        if (pull > 0.9) pull = 0.9;
        return [x - dx * pull, y - dy * pull + pull * pull * S * 0.2];
      };
      const baseAt = (u: number): [number, number] => {
        const up = u * CLIMB;
        return [Ox + dir * vel * up, Oy - up];
      };

      // ── background ──
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, "#080611");
      bg.addColorStop(0.55, "#0a0a16");
      bg.addColorStop(1, "#050409");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.7);
      halo.addColorStop(0, colorAlpha(WELL, 0.05 + massN * 0.08));
      halo.addColorStop(0.5, "rgba(127, 176, 255, 0.03)");
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      // ── warped spacetime grid ──
      ctx.save();
      ctx.lineWidth = 1;
      const gx0 = -width * 0.15;
      const gx1 = width * 1.15;
      const gy0 = height * 0.02;
      const gy1 = height * 0.98;
      const stepX = Math.max(38, width / 16);
      const stepY = Math.max(38, height / 12);
      // lines of constant space (vertical)
      for (let x = gx0; x <= gx1; x += stepX) {
        ctx.beginPath();
        for (let y = gy0; y <= gy1; y += 10) {
          const [wx, wy] = warp(x, y);
          if (y === gy0) ctx.moveTo(wx, wy);
          else ctx.lineTo(wx, wy);
        }
        ctx.strokeStyle = "rgba(129, 150, 178, 0.10)";
        ctx.stroke();
      }
      // lines of constant time (horizontal)
      for (let y = gy0; y <= gy1; y += stepY) {
        ctx.beginPath();
        for (let x = gx0; x <= gx1; x += 12) {
          const [wx, wy] = warp(x, y);
          if (x === gx0) ctx.moveTo(wx, wy);
          else ctx.lineTo(wx, wy);
        }
        ctx.strokeStyle = "rgba(129, 150, 178, 0.085)";
        ctx.stroke();
      }
      ctx.restore();

      // ── light cone ──
      const coneUp = CLIMB;
      const lx = Ox - coneUp;
      const rx = Ox + coneUp;
      const topY = Oy - coneUp;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(Ox, Oy);
      ctx.lineTo(lx, topY);
      ctx.lineTo(rx, topY);
      ctx.closePath();
      const coneFill = ctx.createLinearGradient(0, Oy, 0, topY);
      coneFill.addColorStop(0, colorAlpha(LIGHT, 0.10));
      coneFill.addColorStop(1, "rgba(127, 176, 255, 0)");
      ctx.fillStyle = coneFill;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 8]);
      ctx.strokeStyle = colorAlpha(LIGHT, 0.4);
      ctx.beginPath();
      ctx.moveTo(Ox, Oy); ctx.lineTo(lx, topY);
      ctx.moveTo(Ox, Oy); ctx.lineTo(rx, topY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // ── mass well marker ──
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const wellR = S * (0.03 + massN * 0.09);
      const wg = ctx.createRadialGradient(cx, cy, 0, cx, cy, wellR * 2.4);
      wg.addColorStop(0, colorAlpha(WELL, 0.42 + massN * 0.28));
      wg.addColorStop(0.5, colorAlpha(WELL, 0.16));
      wg.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(cx, cy, wellR * 2.4, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = colorAlpha(WELL, 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(3, wellR * 0.42), 0, TAU);
      ctx.fill();
      ctx.restore();

      // ── worldline (glowing geodesic) ──
      const SAMPLES = 90;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = colorAlpha(GEO, 0.65);
      ctx.shadowBlur = reduce ? 0 : 16;
      ctx.strokeStyle = colorAlpha(GEO, 0.95);
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      for (let i = 0; i <= SAMPLES; i += 1) {
        const [wx, wy] = warp(...baseAt(i / SAMPLES));
        if (i === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
      ctx.restore();

      // ── proper-time ticks strung along the worldline ──
      // proper second k sits at u = k·γ / SECONDS_PER_CLIMB → they spread as γ grows
      ctx.save();
      const du = gamma / SECONDS_PER_CLIMB;
      for (let k = 1; k * du <= 1; k += 1) {
        const u = k * du;
        const [bx, by] = baseAt(u);
        const [b2x, b2y] = baseAt(Math.min(1, u + 0.004));
        const [px, py] = warp(bx, by);
        const [p2x, p2y] = warp(b2x, b2y);
        const ang = Math.atan2(p2y - py, p2x - px) + Math.PI / 2;
        const nx = Math.cos(ang);
        const ny = Math.sin(ang);
        const len = 7;
        ctx.strokeStyle = colorAlpha(GEO, 0.7);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(px - nx * len, py - ny * len);
        ctx.lineTo(px + nx * len, py + ny * len);
        ctx.stroke();
        ctx.fillStyle = colorAlpha(GEO, 0.9);
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      // ── the traveller climbing the worldline with coordinate time ──
      const prog = (coordRef.current / 1000 % SECONDS_PER_CLIMB) / SECONDS_PER_CLIMB;
      const [tx, ty] = warp(...baseAt(prog));
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 22);
      tg.addColorStop(0, colorAlpha("#fff3d6", 0.95));
      tg.addColorStop(0.4, colorAlpha(GEO, 0.5));
      tg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.arc(tx, ty, 22, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#fff6e2";
      ctx.beginPath();
      ctx.arc(tx, ty, 4.4, 0, TAU);
      ctx.fill();

      // ── velocity vector at the origin ──
      const [vTipX, vTipY] = baseAt(0.16);
      ctx.save();
      ctx.strokeStyle = colorAlpha(GEO, 0.85);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(Ox, Oy);
      ctx.lineTo(vTipX, vTipY);
      ctx.stroke();
      const va = Math.atan2(vTipY - Oy, vTipX - Ox);
      ctx.fillStyle = colorAlpha(GEO, 0.9);
      ctx.beginPath();
      ctx.moveTo(vTipX, vTipY);
      ctx.lineTo(vTipX - Math.cos(va - 0.4) * 10, vTipY - Math.sin(va - 0.4) * 10);
      ctx.lineTo(vTipX - Math.cos(va + 0.4) * 10, vTipY - Math.sin(va + 0.4) * 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // origin node
      ctx.fillStyle = colorAlpha(LIGHT, 0.95);
      ctx.beginPath();
      ctx.arc(Ox, Oy, 5, 0, TAU);
      ctx.fill();

      // ── the two clocks, side by side ──
      const cyClock = clamp(height * 0.16, 92, 210);
      const r = clamp(S * 0.088, 40, Math.min(width * 0.2, cyClock - 30));
      const off = r * 1.42;
      drawClock(ctx, cx - off, cyClock, r, coordRef.current, LIGHT, "coordinate");
      drawClock(ctx, cx + off, cyClock, r, properRef.current, GEO, "proper");
      // γ bridge between the dials
      ctx.save();
      ctx.fillStyle = "rgba(246, 241, 224, 0.6)";
      ctx.font = `600 ${Math.round(r * 0.34)}px var(--font-numerals, monospace)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`γ ${gamma.toFixed(2)}`, cx, cyClock);
      ctx.restore();

      // ── throttled sync to React for the console readout ──
      if (now - lastSyncRef.current > 110) {
        lastSyncRef.current = now;
        setReadout(
          `proper ${formatTime(properRef.current)} · γ ${gamma.toFixed(2)} · v/c ${vel.toFixed(3)}`,
        );
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ── direct manipulation on the manifold ──
  const tuneFromPointer = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = clamp(clientX - rect.left, 0, rect.width);
    const py = clamp(clientY - rect.top, 0, rect.height);
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    const signed = clamp((px - w / 2) / (w * 0.42), -1, 1);
    const nextVel = Number((Math.abs(signed) * VMAX).toFixed(3));
    const nextDir = signed < 0 ? -1 : 1;
    const nextMass = Math.round(clamp((h * 0.66 - py) / (h * 0.5), 0, 1) * 100);

    dirRef.current = nextDir;
    velRef.current = nextVel;
    massRef.current = nextMass;
    setVelocity(nextVel);
    setMass(nextMass);

    const now = performance.now();
    if (now - lastToneRef.current > 80) {
      lastToneRef.current = now;
      try { getFieldAudio().playNote(48 + Math.round(nextVel * 26), 80); } catch { /* noop */ }
      try { haptics.ripple(0.2 + nextVel * 0.3); } catch { /* noop */ }
      recordTape("ripple", 0.3 + nextVel * 0.5, "time/drag");
    }
  }, [recordTape]);

  const markControl = useCallback((meta: string, normalized: number) => {
    const now = performance.now();
    if (now - lastControlRef.current < 110) return;
    lastControlRef.current = now;
    const value = clamp(normalized, 0, 1);
    try { getFieldAudio().playNote(46 + Math.round(value * 24), 90); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTape("sigil", 0.32 + value * 0.5, `time/${meta}`);
  }, [recordTape]);

  const toggleRunning = () => {
    setRunning((value) => {
      const next = !value;
      runningRef.current = next;
      try {
        if (next) getFieldAudio().chime();
        else getFieldAudio().thud();
      } catch { /* noop */ }
      recordTape("sigil", next ? 0.78 : 0.48, next ? "time/start" : "time/pause");
      return next;
    });
  };

  const reset = () => {
    coordRef.current = 0;
    properRef.current = 0;
    lastTickRef.current = 0;
    setRunning(false);
    runningRef.current = false;
    try { getFieldAudio().thud(); } catch { /* noop */ }
    recordTape("sigil", 0.34, "time/reset");
  };

  return (
    <div
      ref={rootRef}
      className="time-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--geo": GEO } as CSSProperties}
    >
      <canvas
        ref={canvasRef}
        className="time-canvas"
        role="img"
        aria-label="A spacetime manifold: drag sideways to set velocity, up and down to set mass, and watch proper time dilate against coordinate time."
        onPointerDown={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          pointerRef.current.active = true;
          pointerRef.current.id = event.pointerId;
          tuneFromPointer(event.clientX, event.clientY);
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
        }}
        onPointerMove={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          const p = pointerRef.current;
          if (!p.active || p.id !== event.pointerId) return;
          tuneFromPointer(event.clientX, event.clientY);
        }}
        onPointerUp={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          const p = pointerRef.current;
          if (p.id !== event.pointerId) return;
          p.active = false;
          p.id = -1;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
        }}
        onPointerCancel={(event: ReactPointerEvent<HTMLCanvasElement>) => {
          const p = pointerRef.current;
          if (p.id !== event.pointerId) return;
          p.active = false;
          p.id = -1;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
        }}
      />

      <div className="time-title" aria-hidden="true">
        <span>time · coordinate vs proper</span>
        <strong>Relativity</strong>
      </div>

      <p className="time-hint" aria-hidden="true">
        drag ← → for velocity · ↑ ↓ for mass
      </p>

      <div className="time-console" aria-label="relativity controls">
        <button
          type="button"
          className="time-run"
          onClick={toggleRunning}
          aria-pressed={running}
        >
          {running ? "pause" : "start"}
        </button>
        <button type="button" className="time-reset" onClick={reset}>
          reset
        </button>
        <TimeSlider
          label="velocity"
          min={0}
          max={VMAX}
          step={0.005}
          value={velocity}
          display={`${velocity.toFixed(3)}c`}
          onChange={(value) => {
            const v = Number(value.toFixed(3));
            setVelocity(v);
            velRef.current = v;
            markControl("velocity", v / VMAX);
          }}
        />
        <TimeSlider
          label="mass"
          min={0}
          max={100}
          step={1}
          value={mass}
          display={String(Math.round(mass))}
          onChange={(value) => {
            const m = Math.round(value);
            setMass(m);
            massRef.current = m;
            markControl("mass", m / 100);
          }}
        />
        <output className="time-readout" aria-live="polite" aria-label={`relativity readout ${readout}`}>
          {readout}
        </output>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .time-instrument {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background: #050409;
          color: ${INK};
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .time-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: grab;
          z-index: 0;
        }

        .time-canvas:active { cursor: grabbing; }

        .time-title {
          position: fixed;
          z-index: 2;
          top: 76px;
          left: var(--pad-x);
          pointer-events: none;
        }

        .time-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(246, 241, 224, 0.46);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }

        .time-title strong {
          display: block;
          color: rgba(248, 244, 224, 0.96);
          font-family: var(--font-serif);
          font-size: 118px;
          font-weight: 400;
          line-height: 0.86;
          letter-spacing: -0.02em;
        }

        .time-hint {
          position: fixed;
          z-index: 2;
          left: var(--pad-x);
          bottom: calc(150px + env(safe-area-inset-bottom, 0px));
          margin: 0;
          color: rgba(246, 241, 224, 0.42);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.02em;
          pointer-events: none;
        }

        .time-console {
          position: fixed;
          z-index: 4;
          left: var(--pad-x);
          right: var(--pad-x);
          bottom: calc(20px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: 92px 92px minmax(150px, 1.2fr) minmax(150px, 1.2fr) minmax(200px, 1fr);
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(246, 241, 224, 0.13);
          border-radius: 8px;
          background: rgba(8, 7, 16, 0.62);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.4);
          pointer-events: auto;
        }

        .time-run,
        .time-reset,
        .time-slider,
        .time-readout {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(246, 241, 224, 0.12);
          border-radius: 6px;
          background: rgba(246, 241, 224, 0.055);
          color: rgba(246, 241, 224, 0.9);
        }

        .time-run,
        .time-reset {
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 12px;
          text-transform: lowercase;
        }

        .time-run[aria-pressed="true"] {
          border-color: color-mix(in srgb, var(--geo) 46%, transparent);
          color: var(--geo);
        }

        .time-slider {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto 28px;
          gap: 4px 8px;
          align-items: center;
          padding: 7px 11px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: rgba(246, 241, 224, 0.58);
        }

        .time-slider strong {
          color: var(--geo);
          font-family: var(--font-numerals, var(--font-mono));
          font-size: 13px;
          font-weight: 500;
        }

        .time-slider input {
          -webkit-appearance: none;
          appearance: none;
          grid-column: 1 / -1;
          width: 100%;
          height: 28px;
          margin: 0;
          background: transparent;
          accent-color: var(--geo);
        }

        .time-slider input::-webkit-slider-runnable-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--geo), rgba(246, 241, 224, 0.15));
        }

        .time-slider input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          margin-top: -7px;
          border: 0;
          border-radius: 4px;
          background: var(--geo);
          box-shadow: 0 0 14px var(--geo);
          cursor: pointer;
        }

        .time-slider input::-moz-range-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--geo), rgba(246, 241, 224, 0.15));
        }

        .time-slider input::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border: 0;
          border-radius: 4px;
          background: var(--geo);
          box-shadow: 0 0 14px var(--geo);
          cursor: pointer;
        }

        .time-readout {
          display: grid;
          place-items: center;
          padding: 0 12px;
          color: rgba(246, 241, 224, 0.74);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1.3;
          text-align: center;
          word-break: break-word;
        }

        body:has(.time-instrument) {
          overflow: hidden;
          background: #050409;
        }

        body:has(.time-instrument) header {
          display: none !important;
        }

        body:has(.time-instrument) .oda-field-watch,
        body:has(.time-instrument) .oda-candle-mark,
        body:has(.time-instrument) .oda-tape-shell,
        body:has(.time-instrument) .oda-sound-toggle {
          display: none !important;
        }

        @media (max-width: 940px) {
          .time-title {
            top: 30px;
            left: 22px;
          }

          .time-title strong {
            font-size: 72px;
          }

          .time-hint {
            bottom: calc(206px + env(safe-area-inset-bottom, 0px));
            left: 12px;
          }

          .time-console {
            left: 10px;
            right: 10px;
            bottom: calc(10px + env(safe-area-inset-bottom, 0px));
            grid-template-columns: 1fr 1fr;
            max-height: min(46svh, 380px);
            overflow-y: auto;
          }

          .time-slider {
            grid-column: 1 / -1;
          }

          .time-readout {
            grid-column: 1 / -1;
            min-height: 44px;
          }
        }

        @media (max-width: 520px) {
          .time-title strong {
            font-size: 56px;
          }

          .time-run,
          .time-reset {
            min-height: 52px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .time-canvas { cursor: default; }
        }
      `,
        }}
      />
    </div>
  );
}

function drawClock(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  ms: number,
  accent: string,
  label: string,
) {
  ctx.save();
  // face
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = "rgba(6, 8, 16, 0.66)";
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = colorAlpha(accent, 0.55);
  ctx.stroke();

  // ticks
  for (let i = 0; i < 60; i += 1) {
    const major = i % 5 === 0;
    const a = (i / 60) * TAU;
    const outer = r - 3;
    const inner = r - (major ? 10 : 5);
    ctx.strokeStyle = colorAlpha(accent, major ? 0.7 : 0.32);
    ctx.lineWidth = major ? 1.4 : 0.7;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * outer, cy - Math.cos(a) * outer);
    ctx.lineTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
    ctx.stroke();
  }

  const secA = ((ms / 1000) % 60) / 60 * TAU;
  const minA = ((ms / 60000) % 60) / 60 * TAU;

  // minute hand
  ctx.strokeStyle = colorAlpha(accent, 0.85);
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(minA) * r * 0.5, cy - Math.cos(minA) * r * 0.5);
  ctx.stroke();

  // second hand (glowing sweep)
  ctx.shadowColor = colorAlpha(accent, 0.7);
  ctx.shadowBlur = 8;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - Math.sin(secA) * r * 0.16, cy + Math.cos(secA) * r * 0.16);
  ctx.lineTo(cx + Math.sin(secA) * r * 0.82, cy - Math.cos(secA) * r * 0.82);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 2.6, 0, TAU);
  ctx.fill();

  // label + digital readout
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(246, 241, 224, 0.5)";
  ctx.font = `${Math.round(r * 0.2)}px var(--font-mono, monospace)`;
  ctx.fillText(label, cx, cy - r - r * 0.24);
  ctx.fillStyle = colorAlpha(accent, 0.95);
  ctx.font = `600 ${Math.round(r * 0.28)}px var(--font-numerals, monospace)`;
  ctx.fillText(formatTime(ms), cx, cy + r + r * 0.32);
  ctx.restore();
}

function TimeSlider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="time-slider">
      <span>{label}</span>
      <strong>{display}</strong>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
