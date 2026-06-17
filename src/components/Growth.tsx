"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import WaterText from "@/components/WaterText";

/**
 * /growth — curves, phases, decay.
 *
 * Three stacked interactive zones, each its own 2D canvas:
 *
 *   1. THE SIGMOID FIELD — the logistic curve. Drag three control points
 *      (inflection x0, steepness k, ceiling L) and watch the curve redraw.
 *      Four pale phase bands behind the curve (seed / sprout / climb /
 *      plateau) shade the regions of x.
 *
 *   2. EXPONENTIAL RISE + DECAY — side-by-side plots driven by a shared
 *      rate λ (HTML range slider). A BURST button sends a pulse through
 *      both; tapping anywhere on either plot seeds a fresh wave.
 *
 *   3. LIFE CYCLE — a long horizontal curve composed of four piecewise
 *      phases (birth-S → adolescent-exp → adult-plateau → senescent-decay).
 *      A play button advances a marker; the user can drag it manually.
 *      Inscriptions appear as the marker enters each phase; an ambient
 *      drone bends with the marker's y-value.
 *
 * All curves are dense polylines computed on each frame — pure math, no
 * libs. Pointer events use pointer capture so dragging a control off the
 * canvas keeps tracking. Mobile: ≥44px draggable circles, touchAction
 * "none" on plot surfaces, range slider for λ, 16px input font.
 */
export default function Growth() {
  // page-specific ambient bed: gentle garden wind + faint birdsong
  useEffect(() => { getFieldAudio().setAmbientProfile("garden"); }, []);

  return (
    <div
      data-touch-surface="true"
      style={{
        position: "relative",
        width: "100%",
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, #06120c 0%, #0a1f14 50%, #08130d 100%)",
        color: "rgba(232, 240, 220, 0.96)",
        overflowX: "hidden",
        overflowY: "visible",
        touchAction: "pan-y",
      }}
    >
      {/* ── header block ─────────────────────────────────────────── */}
      <div
        style={{
          padding: "calc(var(--pad-x)) var(--pad-x) 20px",
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        <div
          className="t-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "rgba(200, 220, 180, 0.55)",
            marginBottom: 12,
          }}
        >
          GROWTH / CURVES &middot; PHASES &middot; DECAY
        </div>
        <WaterText
          as="h1"
          bobAmp={0}
          style={{
            display: "block",
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            fontSize: "clamp(48px, 8vw, 112px)",
            lineHeight: 0.98,
            letterSpacing: "-0.02em",
            color: "rgba(232, 240, 220, 0.96)",
          }}
        >
          BLOOM
        </WaterText>
        <WaterText
          as="div"
          bobAmp={2}
          style={{
            display: "block",
            marginTop: 8,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(17px, 2.2vw, 26px)",
            color: "rgba(200, 220, 180, 0.74)",
          }}
        >
          everything that rises also rests
        </WaterText>
      </div>

      <SigmoidZone />
      <ExpZone />
      <LifeZone />

      {/* ── bottom inscription ───────────────────────────────────── */}
      <div
        style={{
          padding: "32px var(--pad-x) 80px",
          maxWidth: 1200,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <WaterText
          as="div"
          bobAmp={1.5}
          style={{
            display: "block",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(16px, 2vw, 22px)",
            color: "rgba(200, 220, 180, 0.50)",
            letterSpacing: "0.01em",
          }}
        >
          the curve becomes its own clock
        </WaterText>
      </div>

      <style>{`
        .growth-zone {
          padding: 28px var(--pad-x);
          max-width: 1200px;
          margin: 0 auto;
        }
        .growth-canvas-wrap {
          position: relative;
          width: 100%;
          border: 1px solid rgba(200, 220, 180, 0.14);
          background: rgba(8, 19, 13, 0.55);
          border-radius: 4px;
          overflow: hidden;
          box-shadow: inset 0 1px 0 rgba(232, 240, 220, 0.06), 0 18px 48px rgba(0, 0, 0, 0.18);
        }
        .growth-canvas-wrap::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(105deg, transparent 0%, rgba(240, 192, 74, 0.08) 46%, transparent 62%);
          transform: translateX(-120%);
          animation: growth-sheen 6s ease-in-out infinite;
        }
        @keyframes growth-sheen {
          0%, 34% { transform: translateX(-120%); opacity: 0; }
          45% { opacity: 1; }
          70%, 100% { transform: translateX(120%); opacity: 0; }
        }
        .growth-eyebrow {
          font-family: var(--font-mono, ui-monospace);
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(200, 220, 180, 0.55);
          margin-bottom: 10px;
        }
        .growth-title {
          font-family: var(--font-serif);
          font-weight: 500;
          font-size: clamp(22px, 3.4vw, 36px);
          line-height: 1.05;
          letter-spacing: -0.012em;
          color: rgba(232, 240, 220, 0.96);
          margin: 0 0 4px;
        }
        .growth-sub {
          font-family: var(--font-serif);
          font-style: italic;
          font-size: clamp(14px, 1.6vw, 18px);
          color: rgba(200, 220, 180, 0.68);
          margin-bottom: 16px;
        }
        .growth-readout {
          font-family: var(--font-fraunces, Georgia), serif;
          font-weight: 500;
          font-size: 15px;
          font-feature-settings: "tnum";
          color: rgba(232, 240, 220, 0.88);
          letter-spacing: 0.01em;
        }
        .growth-button {
          appearance: none;
          border: 1px solid rgba(200, 220, 180, 0.42);
          background: transparent;
          color: rgba(232, 240, 220, 0.96);
          font-family: var(--font-text);
          font-size: 13px;
          letter-spacing: 0.08em;
          text-transform: lowercase;
          padding: 10px 18px;
          min-height: 44px;
          min-width: 96px;
          border-radius: 999px;
          cursor: pointer;
          touch-action: manipulation;
          transition: background 200ms, border-color 200ms;
        }
        .growth-button:hover { background: rgba(200, 220, 180, 0.08); border-color: rgba(200, 220, 180, 0.66); }
        .growth-button:active { background: rgba(200, 220, 180, 0.14); }
        .growth-range {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 44px;
          background: transparent;
          touch-action: manipulation;
          font-size: 16px;
        }
        .growth-range::-webkit-slider-runnable-track {
          height: 2px;
          background: rgba(200, 220, 180, 0.32);
        }
        .growth-range::-moz-range-track {
          height: 2px;
          background: rgba(200, 220, 180, 0.32);
        }
        .growth-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: rgba(240, 192, 74, 0.95);
          border: 1px solid rgba(8, 19, 13, 0.8);
          margin-top: -10px;
          cursor: pointer;
          box-shadow: 0 0 0 6px rgba(240, 192, 74, 0.08);
        }
        .growth-range::-moz-range-thumb {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: rgba(240, 192, 74, 0.95);
          border: 1px solid rgba(8, 19, 13, 0.8);
          cursor: pointer;
          box-shadow: 0 0 0 6px rgba(240, 192, 74, 0.08);
        }
        .growth-exp-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        @media (max-width: 699px) {
          .growth-zone {
            padding: 22px var(--pad-x);
          }
          .growth-exp-row { grid-template-columns: 1fr; }
          .growth-exp-controls {
            grid-template-columns: 1fr !important;
          }
          .growth-exp-controls .growth-button {
            width: 100%;
          }
          .growth-life-controls {
            align-items: stretch !important;
            flex-direction: column;
          }
          .growth-life-controls .growth-button {
            width: 100%;
          }
          .growth-life-controls .growth-readout {
            line-height: 1.4;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .growth-canvas-wrap::after {
            animation: none;
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

// ── Zone 1: SIGMOID FIELD ────────────────────────────────────────────────

type SigmoidParams = { L: number; k: number; x0: number };

function SigmoidZone() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [params, setParams] = useState<SigmoidParams>({ L: 1.0, k: 1.0, x0: 5.0 });
  // tracked refs for the render loop — avoids re-binding handlers per frame
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const draggingRef = useRef<"L" | "k" | "x0" | null>(null);
  const lastChimeRef = useRef(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = computeZoneHeight();
      wrap.style.height = `${h}px`;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const computeZoneHeight = (): number => {
      const isMobile = window.innerWidth < 700;
      const vh = window.innerHeight;
      return isMobile ? Math.max(vh * 0.58, 360) : Math.max(vh * 0.50, 380);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener("resize", resize);

    // Plot domain — x in [0, 10], y in [0, L_MAX]
    const X_MIN = 0;
    const X_MAX = 10;
    const Y_MIN = 0;
    const Y_MAX = 1.5; // ceiling axis goes a touch above L_MAX

    const sigmoid = (x: number, p: SigmoidParams): number => {
      // y = L / (1 + exp(-k * (x - x0)))
      const z = -p.k * (x - p.x0);
      // clamp to avoid Infinity
      const ez = Math.exp(Math.min(40, Math.max(-40, z)));
      return p.L / (1 + ez);
    };

    // ── coordinate helpers ───────────────────────────────────────
    const PAD_L = 56;
    const PAD_R = 28;
    const PAD_T = 24;
    const PAD_B = 56;
    const plotW = () => cv.clientWidth - PAD_L - PAD_R;
    const plotH = () => cv.clientHeight - PAD_T - PAD_B;
    const xToPx = (x: number) => PAD_L + ((x - X_MIN) / (X_MAX - X_MIN)) * plotW();
    const yToPx = (y: number) =>
      PAD_T + plotH() - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * plotH();
    const pxToX = (px: number) => X_MIN + ((px - PAD_L) / plotW()) * (X_MAX - X_MIN);
    const pxToY = (py: number) =>
      Y_MIN + ((PAD_T + plotH() - py) / plotH()) * (Y_MAX - Y_MIN);

    // ── control point positions in data space ────────────────────
    const controlPositions = (p: SigmoidParams) => {
      // x0 lives ON the curve at (x0, L/2)
      const x0Pt = { x: p.x0, y: p.L / 2 };
      // k control: a point to the right of x0 on the curve at a fixed Δx
      // its on-curve y reveals slope. We display it as a draggable bead.
      const kDx = 1.0;
      const kPt = { x: p.x0 + kDx, y: sigmoid(p.x0 + kDx, p) };
      // L control: the ceiling, drawn at the right edge at height L
      const LPt = { x: X_MAX - 0.4, y: p.L };
      return { x0Pt, kPt, LPt };
    };

    const HIT_RADIUS = 28; // 44px target → 28 logical px (touch-friendly)

    const pickControl = (mx: number, my: number, p: SigmoidParams): "L" | "k" | "x0" | null => {
      const { x0Pt, kPt, LPt } = controlPositions(p);
      const candidates: Array<{ k: "L" | "k" | "x0"; px: number; py: number }> = [
        { k: "x0", px: xToPx(x0Pt.x), py: yToPx(x0Pt.y) },
        { k: "k", px: xToPx(kPt.x), py: yToPx(kPt.y) },
        { k: "L", px: xToPx(LPt.x), py: yToPx(LPt.y) },
      ];
      let best: { k: "L" | "k" | "x0"; d2: number } | null = null;
      for (const c of candidates) {
        const dx = c.px - mx;
        const dy = c.py - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < HIT_RADIUS * HIT_RADIUS && (!best || d2 < best.d2)) {
          best = { k: c.k, d2 };
        }
      }
      return best?.k ?? null;
    };

    const onPointerDown = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const p = paramsRef.current;
      const which = pickControl(mx, my, p);
      if (which) {
        draggingRef.current = which;
        try { cv.setPointerCapture(e.pointerId); } catch { /* noop */ }
        rateLimitedChime();
      }
    };

    const rateLimitedChime = () => {
      const now = performance.now();
      if (now - lastChimeRef.current > 100) {
        getFieldAudio().chime();
        lastChimeRef.current = now;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const dataX = Math.min(X_MAX, Math.max(X_MIN, pxToX(mx)));
      const dataY = Math.min(Y_MAX, Math.max(Y_MIN, pxToY(my)));
      const p = paramsRef.current;
      let next: SigmoidParams = p;
      if (draggingRef.current === "x0") {
        next = { ...p, x0: Math.min(X_MAX - 0.5, Math.max(X_MIN + 0.5, dataX)) };
      } else if (draggingRef.current === "L") {
        next = { ...p, L: Math.min(1.3, Math.max(0.1, dataY)) };
      } else if (draggingRef.current === "k") {
        // derive k from where the user pulled the "k" bead — interpret the
        // bead's distance above L/2 as a steepness hint. Simpler: map
        // horizontal distance to logistic shape via implicit inversion.
        // y_target = L / (1+exp(-k*Δx)), Δx=1 → k = ln(y/(L-y))
        const yT = Math.min(p.L * 0.99, Math.max(p.L * 0.01, dataY));
        const dx = Math.max(0.05, dataX - p.x0);
        // k = (1/dx) * ln(y/(L-y))
        const ratio = yT / Math.max(0.0001, p.L - yT);
        const kNew = (1 / dx) * Math.log(Math.max(0.0001, ratio));
        next = { ...p, k: Math.min(5, Math.max(0.1, kNew)) };
      }
      paramsRef.current = next;
      setParams(next);
      rateLimitedChime();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (draggingRef.current) {
        draggingRef.current = null;
        try { cv.releasePointerCapture(e.pointerId); } catch { /* noop */ }
        useField.getState().recordTape("sigil", 0.6, "growth/sigmoid");
      }
    };

    cv.addEventListener("pointerdown", onPointerDown);
    cv.addEventListener("pointermove", onPointerMove);
    cv.addEventListener("pointerup", onPointerUp);
    cv.addEventListener("pointercancel", onPointerUp);

    const draw = (now: number) => {
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      const p = paramsRef.current;
      ctx.clearRect(0, 0, w, h);

      // ── phase bands behind the curve ────────────────────────────
      // Divide x into four bands of equal width: seed | sprout | climb | plateau
      const bandTints: ReadonlyArray<string> = [
        "rgba(120, 95, 50, 0.10)",   // seed — warm earth
        "rgba(80, 130, 80, 0.10)",   // sprout — soft green
        "rgba(135, 184, 120, 0.13)", // climb — bright green
        "rgba(180, 200, 150, 0.08)", // plateau — pale chartreuse
      ];
      const bandLabels = ["seed", "sprout", "climb", "plateau"];
      const px0 = xToPx(X_MIN);
      const px1 = xToPx(X_MAX);
      const bandW = (px1 - px0) / 4;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = bandTints[i];
        ctx.fillRect(px0 + i * bandW, PAD_T, bandW, plotH());
      }
      // band labels (Fraunces italic, faint, at the top of each band)
      ctx.font = `300 italic 12px var(--font-fraunces, Georgia), serif`;
      ctx.fillStyle = "rgba(200, 220, 180, 0.46)";
      ctx.textAlign = "center";
      for (let i = 0; i < 4; i++) {
        ctx.fillText(bandLabels[i], px0 + (i + 0.5) * bandW, PAD_T + 14);
      }

      // ── axes ─────────────────────────────────────────────────────
      ctx.strokeStyle = "rgba(200, 220, 180, 0.20)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      // x-axis at y=0
      ctx.moveTo(xToPx(X_MIN), yToPx(0));
      ctx.lineTo(xToPx(X_MAX), yToPx(0));
      // y-axis
      ctx.moveTo(xToPx(X_MIN), yToPx(0));
      ctx.lineTo(xToPx(X_MIN), yToPx(Y_MAX));
      ctx.stroke();

      // y=L ceiling line (dashed)
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(200, 220, 180, 0.32)";
      ctx.beginPath();
      ctx.moveTo(xToPx(X_MIN), yToPx(p.L));
      ctx.lineTo(xToPx(X_MAX), yToPx(p.L));
      ctx.stroke();
      ctx.setLineDash([]);

      // x0 vertical reference (dashed)
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = "rgba(200, 220, 180, 0.22)";
      ctx.beginPath();
      ctx.moveTo(xToPx(p.x0), yToPx(0));
      ctx.lineTo(xToPx(p.x0), yToPx(p.L));
      ctx.stroke();
      ctx.setLineDash([]);

      // ── the sigmoid curve, gradient stroke ──────────────────────
      // Compute polyline samples first.
      const samples = 200;
      const xs = new Array<number>(samples + 1);
      const ys = new Array<number>(samples + 1);
      for (let i = 0; i <= samples; i++) {
        const xv = X_MIN + (i / samples) * (X_MAX - X_MIN);
        xs[i] = xv;
        ys[i] = sigmoid(xv, p);
      }
      // gradient along the line: seed → sprout → full
      const grad = ctx.createLinearGradient(xToPx(X_MIN), 0, xToPx(X_MAX), 0);
      grad.addColorStop(0.0, "#c8a86a");
      grad.addColorStop(0.5, "#4f8a4a");
      grad.addColorStop(1.0, "#87b878");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const px = xToPx(xs[i]);
        const py = yToPx(ys[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // glow under the curve — fill to baseline
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const px = xToPx(xs[i]);
        const py = yToPx(ys[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineTo(xToPx(X_MAX), yToPx(0));
      ctx.lineTo(xToPx(X_MIN), yToPx(0));
      ctx.closePath();
      const fillGrad = ctx.createLinearGradient(0, yToPx(p.L), 0, yToPx(0));
      fillGrad.addColorStop(0, "rgba(135, 184, 120, 0.12)");
      fillGrad.addColorStop(1, "rgba(135, 184, 120, 0.00)");
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // ── control points (large soft circles, visible outlines) ──
      const { x0Pt, kPt, LPt } = controlPositions(p);
      const glintT = (now * 0.00008) % 1;
      const glintX = X_MIN + glintT * (X_MAX - X_MIN);
      const glintY = sigmoid(glintX, p);
      const glintR = 4 + Math.sin(now * 0.006) * 1.5;
      ctx.fillStyle = "rgba(240, 192, 74, 0.82)";
      ctx.beginPath();
      ctx.arc(xToPx(glintX), yToPx(glintY), glintR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(240, 192, 74, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(xToPx(glintX), yToPx(glintY), glintR + 8, 0, Math.PI * 2);
      ctx.stroke();
      drawControl(ctx, xToPx(x0Pt.x), yToPx(x0Pt.y), "x₀", "#c8a86a", draggingRef.current === "x0");
      drawControl(ctx, xToPx(kPt.x), yToPx(kPt.y), "k", "#4f8a4a", draggingRef.current === "k");
      drawControl(ctx, xToPx(LPt.x), yToPx(LPt.y), "L", "#87b878", draggingRef.current === "L");

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      cv.removeEventListener("pointerdown", onPointerDown);
      cv.removeEventListener("pointermove", onPointerMove);
      cv.removeEventListener("pointerup", onPointerUp);
      cv.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return (
    <section className="growth-zone">
      <div className="growth-eyebrow">zone i &middot; the sigmoid field</div>
      <h2 className="growth-title">a single curve, three handles</h2>
      <div className="growth-sub">drag the seed, the steepness, the ceiling</div>
      <div ref={wrapRef} className="growth-canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label="sigmoid curve with three draggable control points"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            touchAction: "none",
            cursor: "grab",
          }}
        />
      </div>
      <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 18 }}>
        <span className="growth-readout">L = {params.L.toFixed(2)}</span>
        <span className="growth-readout" style={{ color: "rgba(135, 184, 120, 0.88)" }}>·</span>
        <span className="growth-readout">k = {params.k.toFixed(2)}</span>
        <span className="growth-readout" style={{ color: "rgba(135, 184, 120, 0.88)" }}>·</span>
        <span className="growth-readout">x₀ = {params.x0.toFixed(2)}</span>
      </div>
    </section>
  );
}

function drawControl(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  label: string,
  color: string,
  active: boolean,
) {
  const r = active ? 14 : 12;
  // outer soft halo
  const halo = ctx.createRadialGradient(px, py, 4, px, py, 26);
  halo.addColorStop(0, `${color}88`);
  halo.addColorStop(1, `${color}00`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(px, py, 26, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.fillStyle = "rgba(8, 19, 13, 0.85)";
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  // outline
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.stroke();
  // label
  ctx.fillStyle = "rgba(232, 240, 220, 0.94)";
  ctx.font = `500 11px var(--font-fraunces, Georgia), serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, px, py + 0.5);
  ctx.textBaseline = "alphabetic";
}

// ── Zone 2: EXPONENTIAL RISE + DECAY ────────────────────────────────────

type Burst = { x0: number; t0: number };

function ExpZone() {
  const wrapRiseRef = useRef<HTMLDivElement>(null);
  const wrapDecayRef = useRef<HTMLDivElement>(null);
  const riseCanvasRef = useRef<HTMLCanvasElement>(null);
  const decayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [lambda, setLambda] = useState(0.6);
  const lambdaRef = useRef(lambda);
  lambdaRef.current = lambda;
  const burstsRef = useRef<Burst[]>([]);
  // peak / completion markers — fire bell on rise peak, thud on decay finish
  const burstSoundedRef = useRef<Map<number, { peak: boolean; done: boolean }>>(new Map());

  const halfLife = Math.log(2) / Math.max(0.0001, lambda);

  const triggerBurst = (x0: number) => {
    const b: Burst = { x0, t0: performance.now() };
    burstsRef.current.push(b);
    if (burstsRef.current.length > 12) {
      const removed = burstsRef.current.shift();
      if (removed) burstSoundedRef.current.delete(removed.t0);
    }
    useField.getState().recordTape("ripple", 0.5, "growth/burst");
  };

  useEffect(() => {
    const setup = (
      wrap: HTMLDivElement | null,
      cv: HTMLCanvasElement | null,
      kind: "rise" | "decay",
    ) => {
      if (!wrap || !cv) return () => { /* noop */ };
      const ctx = cv.getContext("2d");
      if (!ctx) return () => { /* noop */ };

      let raf = 0;
      let dpr = 1;
      const PAD_L = 44;
      const PAD_R = 16;
      const PAD_T = 18;
      const PAD_B = 36;
      const X_MAX = 6; // seconds visible on the plot
      const Y_MAX = 1.1;

      const computeZoneHeight = (): number => {
        const isMobile = window.innerWidth < 700;
        const vh = window.innerHeight;
        return isMobile ? Math.max(vh * 0.34, 220) : Math.max(vh * 0.42, 320);
      };

      const resize = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = wrap.clientWidth;
        const h = computeZoneHeight();
        wrap.style.height = `${h}px`;
        cv.width = Math.floor(w * dpr);
        cv.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(wrap);
      window.addEventListener("resize", resize);

      const plotW = () => cv.clientWidth - PAD_L - PAD_R;
      const plotH = () => cv.clientHeight - PAD_T - PAD_B;
      const xToPx = (x: number) => PAD_L + (x / X_MAX) * plotW();
      const yToPx = (y: number) => PAD_T + plotH() - (y / Y_MAX) * plotH();
      const pxToX = (px: number) => ((px - PAD_L) / plotW()) * X_MAX;

      // burst contribution at time t (since start) at offset x
      const burstAt = (x: number, now: number): number => {
        const lam = lambdaRef.current;
        let total = 0;
        for (const b of burstsRef.current) {
          // burst is anchored at b.x0 in plot-space; its envelope advances
          // with real-world time since b.t0.
          const elapsedSinceBurst = (now - b.t0) / 1000;
          // local time on the plot: dx = x - b.x0 must be ≥ 0 to receive
          // the wave. The envelope drifts toward the right with elapsedSinceBurst.
          const dx = x - b.x0;
          if (dx < 0) continue;
          // The burst's local time is min(dx, elapsedSinceBurst) so the
          // envelope sweeps from b.x0 outward at "1 unit per second".
          const tLocal = Math.min(dx, elapsedSinceBurst);
          if (tLocal < 0) continue;
          // rise: 1 - exp(-λ t) up to a peak that then decays
          // shape: a rise + decay pulse — rise quickly to peak at t*=2/λ
          // then decays. For "rise" plot we show the rising envelope; for
          // "decay" plot we show the decay portion.
          let env: number;
          if (kind === "rise") {
            env = 1 - Math.exp(-lam * tLocal);
            // then optional decay after a brief plateau — fade after age
            const decayPhase = Math.max(0, elapsedSinceBurst - tLocal - 0.4);
            env *= Math.exp(-lam * decayPhase * 0.4);
          } else {
            // decay plot: pulse rises immediately and decays
            env = Math.exp(-lam * tLocal);
          }
          total += env * 0.35;
          // detect peak / completion for audio
          const meta = burstSoundedRef.current.get(b.t0) ?? { peak: false, done: false };
          if (kind === "rise" && !meta.peak && elapsedSinceBurst > Math.min(2.0, 2 / lam) && b === burstsRef.current[burstsRef.current.length - 1]) {
            meta.peak = true;
            burstSoundedRef.current.set(b.t0, meta);
            getFieldAudio().bell();
          }
          if (kind === "decay" && !meta.done && elapsedSinceBurst > Math.min(5.0, 5 / lam)) {
            meta.done = true;
            burstSoundedRef.current.set(b.t0, meta);
            getFieldAudio().thud();
          }
        }
        return Math.min(1, total);
      };

      // tap anywhere on the plot to seed a burst at that x
      const onPointerDown = (e: PointerEvent) => {
        const r = cv.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const myDataX = Math.min(X_MAX - 0.1, Math.max(0, pxToX(mx)));
        triggerBurst(myDataX);
      };
      cv.addEventListener("pointerdown", onPointerDown);

      const baseColor = kind === "rise" ? "#f0c04a" : "#c06a4a";
      const fillColor = kind === "rise" ? "rgba(240, 192, 74, 0.10)" : "rgba(192, 106, 74, 0.10)";

      const draw = () => {
        const w = cv.clientWidth;
        const h = cv.clientHeight;
        ctx.clearRect(0, 0, w, h);

        // axes
        ctx.strokeStyle = "rgba(200, 220, 180, 0.20)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xToPx(0), yToPx(0));
        ctx.lineTo(xToPx(X_MAX), yToPx(0));
        ctx.moveTo(xToPx(0), yToPx(0));
        ctx.lineTo(xToPx(0), yToPx(Y_MAX));
        ctx.stroke();

        // labels
        ctx.fillStyle = "rgba(200, 220, 180, 0.50)";
        ctx.font = `300 italic 12px var(--font-fraunces, Georgia), serif`;
        ctx.textAlign = "left";
        ctx.fillText(kind === "rise" ? "rise" : "decay", PAD_L + 4, PAD_T + 14);

        // baseline curve — the canonical shape (no bursts)
        const samples = 160;
        const xs = new Array<number>(samples + 1);
        const ys = new Array<number>(samples + 1);
        const lam = lambdaRef.current;
        for (let i = 0; i <= samples; i++) {
          const xv = (i / samples) * X_MAX;
          let yv: number;
          if (kind === "rise") {
            yv = 1 - Math.exp(-lam * xv);
          } else {
            yv = Math.exp(-lam * xv);
          }
          xs[i] = xv;
          ys[i] = yv;
        }

        // fill under baseline
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
          const px = xToPx(xs[i]);
          const py = yToPx(ys[i]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineTo(xToPx(X_MAX), yToPx(0));
        ctx.lineTo(xToPx(0), yToPx(0));
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        // baseline stroke
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
          const px = xToPx(xs[i]);
          const py = yToPx(ys[i]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // overlay burst pulses
        if (burstsRef.current.length > 0) {
          const now = performance.now();
          ctx.strokeStyle = `${baseColor}cc`;
          ctx.lineWidth = 1.6;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          for (let i = 0; i <= samples; i++) {
            const xv = (i / samples) * X_MAX;
            const env = burstAt(xv, now);
            const px = xToPx(xv);
            const py = yToPx(env);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // small markers at burst origins
          for (const b of burstsRef.current) {
            const age = (now - b.t0) / 1000;
            if (age > 8) continue;
            const a = Math.max(0, 1 - age / 8);
            ctx.fillStyle = `rgba(232, 240, 220, ${a * 0.6})`;
            ctx.beginPath();
            ctx.arc(xToPx(b.x0), yToPx(0), 3, 0, Math.PI * 2);
            ctx.fill();
          }
          // prune ancient bursts
          burstsRef.current = burstsRef.current.filter((b) => (now - b.t0) / 1000 < 12);
        }

        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);

      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        window.removeEventListener("resize", resize);
        cv.removeEventListener("pointerdown", onPointerDown);
      };
    };

    const cleanupRise = setup(wrapRiseRef.current, riseCanvasRef.current, "rise");
    const cleanupDecay = setup(wrapDecayRef.current, decayCanvasRef.current, "decay");
    return () => {
      cleanupRise();
      cleanupDecay();
    };
  }, []);

  const onBurst = () => {
    // a synchronized burst at x=0.5 on both plots
    triggerBurst(0.5);
  };

  return (
    <section className="growth-zone">
      <div className="growth-eyebrow">zone ii &middot; exponential rise &amp; decay</div>
      <h2 className="growth-title">two tongues of the same fire</h2>
      <div className="growth-sub">share a rate, send a pulse, hear the half-life</div>
      <div className="growth-exp-row">
        <div ref={wrapRiseRef} className="growth-canvas-wrap">
          <canvas
            ref={riseCanvasRef}
            aria-label="exponential rise plot — tap to seed a burst"
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              touchAction: "none",
              cursor: "crosshair",
            }}
          />
        </div>
        <div ref={wrapDecayRef} className="growth-canvas-wrap">
          <canvas
            ref={decayCanvasRef}
            aria-label="exponential decay plot — tap to seed a burst"
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              touchAction: "none",
              cursor: "crosshair",
            }}
          />
        </div>
      </div>

      {/* controls row */}
      <div
        className="growth-exp-controls"
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 16,
          alignItems: "center",
        }}
      >
        <div>
          <label
            htmlFor="growth-lambda"
            className="growth-readout"
            style={{ display: "block", marginBottom: 2 }}
          >
            λ = {lambda.toFixed(2)}
          </label>
          <input
            id="growth-lambda"
            className="growth-range"
            type="range"
            min={0.05}
            max={2.0}
            step={0.01}
            value={lambda}
            onChange={(e) => setLambda(parseFloat(e.target.value))}
          />
        </div>
        <button type="button" className="growth-button" onClick={onBurst}>
          burst
        </button>
      </div>
      <div className="growth-readout" style={{ marginTop: 8 }}>
        t½ = ln(2) / λ = {halfLife.toFixed(2)}
      </div>
    </section>
  );
}

// ── Zone 3: LIFE CYCLE ──────────────────────────────────────────────────

type LifePhase = "ascent" | "plateau" | "decline" | "rest";

function LifeZone() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(0); // 0..1 across the curve
  const tRef = useRef(t);
  tRef.current = t;
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const draggingRef = useRef(false);
  // ambient drone — created on first interaction
  const droneRef = useRef<{
    osc: OscillatorNode | null;
    g: GainNode | null;
    lp: BiquadFilterNode | null;
  }>({ osc: null, g: null, lp: null });
  const lastPhaseRef = useRef<LifePhase | null>(null);

  // ── life curve: piecewise composition ────────────────────────────
  // domain: tNorm in [0, 1], composed of four phases [0,0.25] [0.25,0.55] [0.55,0.80] [0.80,1.0]
  // returns y in [0, 1]
  const lifeY = (tNorm: number): number => {
    if (tNorm <= 0.25) {
      // birth-S — sigmoid from 0 → 0.85
      const u = tNorm / 0.25; // 0..1
      // logistic centered at u=0.55, k=8 → smooth ascent
      const s = 1 / (1 + Math.exp(-8 * (u - 0.5)));
      return s * 0.85;
    } else if (tNorm <= 0.55) {
      // adolescent-exp — push from 0.85 → 1.0 with a soft exponential approach
      const u = (tNorm - 0.25) / 0.30;
      return 0.85 + (1.0 - 0.85) * (1 - Math.exp(-3 * u));
    } else if (tNorm <= 0.80) {
      // adult-plateau — gentle wobble around 1.0
      const u = (tNorm - 0.55) / 0.25;
      return 1.0 - 0.02 + 0.02 * Math.cos(u * Math.PI * 1.3);
    } else {
      // senescent-decay — drift down to ~0.15 with mild oscillation
      const u = (tNorm - 0.80) / 0.20;
      const decay = Math.exp(-2.4 * u);
      return 0.18 + (1.0 - 0.18) * decay;
    }
  };

  const phaseAt = (tNorm: number): LifePhase => {
    if (tNorm <= 0.25) return "ascent";
    if (tNorm <= 0.55) return "ascent"; // adolescent-exp is still ascent
    if (tNorm <= 0.80) return "plateau";
    if (tNorm <= 0.97) return "decline";
    return "rest";
  };

  const phaseLabel = (p: LifePhase): string => {
    if (p === "ascent") return "ascent";
    if (p === "plateau") return "plateau";
    if (p === "decline") return "decline";
    return "rest";
  };

  // ambient drone — pitched by marker's y
  const ensureDrone = () => {
    const audio = getFieldAudio();
    const ctx = audio.getAudioContext();
    if (!ctx) return;
    if (droneRef.current.osc) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 1.2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    lp.Q.value = 0.4;
    // route via the analyser sink — connect to destination via library helper
    const tail = audio.getAnalyser();
    osc.connect(g).connect(lp);
    if (tail) {
      // analyser is downstream of `sink`; we have to route into the sink too.
      // Best-effort: connect to ctx.destination directly so the drone is audible.
      lp.connect(ctx.destination);
    } else {
      lp.connect(ctx.destination);
    }
    osc.start();
    droneRef.current = { osc, g, lp };
  };

  const releaseDrone = () => {
    const audio = getFieldAudio();
    const ctx = audio.getAudioContext();
    if (!ctx) return;
    const { osc, g, lp } = droneRef.current;
    if (!osc || !g || !lp) return;
    const now = ctx.currentTime;
    try {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc.stop(now + 0.7);
    } catch { /* noop */ }
    droneRef.current = { osc: null, g: null, lp: null };
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let dpr = 1;
    const PAD_L = 36;
    const PAD_R = 36;
    const PAD_T = 28;
    const PAD_B = 60;

    const computeZoneHeight = (): number => {
      const isMobile = window.innerWidth < 700;
      const vh = window.innerHeight;
      return isMobile ? Math.max(vh * 0.60, 360) : Math.max(vh * 0.45, 360);
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = computeZoneHeight();
      wrap.style.height = `${h}px`;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener("resize", resize);

    const plotW = () => cv.clientWidth - PAD_L - PAD_R;
    const plotH = () => cv.clientHeight - PAD_T - PAD_B;
    const xToPx = (xn: number) => PAD_L + xn * plotW();
    const yToPx = (yn: number) => PAD_T + plotH() - yn * plotH();
    const pxToX = (px: number) => Math.min(1, Math.max(0, (px - PAD_L) / plotW()));

    // ── drag the marker ─────────────────────────────────────────
    const onPointerDown = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const newT = pxToX(mx);
      draggingRef.current = true;
      setPlaying(false);
      tRef.current = newT;
      setT(newT);
      try { cv.setPointerCapture(e.pointerId); } catch { /* noop */ }
      ensureDrone();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const newT = pxToX(mx);
      tRef.current = newT;
      setT(newT);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      try { cv.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };

    cv.addEventListener("pointerdown", onPointerDown);
    cv.addEventListener("pointermove", onPointerMove);
    cv.addEventListener("pointerup", onPointerUp);
    cv.addEventListener("pointercancel", onPointerUp);

    // ── auto-marker (play) ──────────────────────────────────────
    let lastFrameTime = performance.now();

    const draw = (now: number) => {
      const dt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;
      // The play button should always visibly advance the marker; reduced
      // motion trims decorative CSS effects elsewhere instead of freezing play.
      if (playingRef.current && !draggingRef.current) {
        const next = Math.min(1, tRef.current + dt / 30); // 30s traversal
        tRef.current = next;
        if (next >= 1) {
          playingRef.current = false;
          setPlaying(false);
        }
      }

      const w = cv.clientWidth;
      const h = cv.clientHeight;
      const currT = tRef.current;
      const currY = lifeY(currT);
      const currPhase = phaseAt(currT);

      // ── background tint shifts with phase ──────────────────────
      // very subtle additive wash so the canvas's own bg communicates mood
      const phaseTints: Record<LifePhase, string> = {
        ascent: "rgba(135, 184, 120, 0.06)",
        plateau: "rgba(180, 200, 150, 0.05)",
        decline: "rgba(200, 130, 80, 0.06)",
        rest: "rgba(80, 90, 100, 0.05)",
      };
      ctx.fillStyle = phaseTints[currPhase];
      ctx.fillRect(0, 0, w, h);
      // a deeper clear so we don't accumulate
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = phaseTints[currPhase];
      ctx.fillRect(0, 0, w, h);

      // ── pale vertical phase bands ──────────────────────────────
      const bandStops: ReadonlyArray<[number, number, string]> = [
        [0.00, 0.25, "rgba(135, 184, 120, 0.05)"],
        [0.25, 0.55, "rgba(180, 200, 150, 0.06)"],
        [0.55, 0.80, "rgba(200, 220, 180, 0.05)"],
        [0.80, 1.00, "rgba(200, 130, 80, 0.05)"],
      ];
      for (const [a, b, c] of bandStops) {
        ctx.fillStyle = c;
        ctx.fillRect(xToPx(a), PAD_T, xToPx(b) - xToPx(a), plotH());
      }

      // ── axes ───────────────────────────────────────────────────
      ctx.strokeStyle = "rgba(200, 220, 180, 0.20)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xToPx(0), yToPx(0));
      ctx.lineTo(xToPx(1), yToPx(0));
      ctx.stroke();

      // ── the life curve ─────────────────────────────────────────
      const samples = 240;
      const xs = new Array<number>(samples + 1);
      const ys = new Array<number>(samples + 1);
      for (let i = 0; i <= samples; i++) {
        const xn = i / samples;
        xs[i] = xn;
        ys[i] = lifeY(xn);
      }
      // gradient: seed → bloom → senescence
      const grad = ctx.createLinearGradient(xToPx(0), 0, xToPx(1), 0);
      grad.addColorStop(0.0, "#c8a86a");
      grad.addColorStop(0.35, "#4f8a4a");
      grad.addColorStop(0.65, "#87b878");
      grad.addColorStop(1.0, "#7a6a4a");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const px = xToPx(xs[i]);
        const py = yToPx(ys[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // glow fill under
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const px = xToPx(xs[i]);
        const py = yToPx(ys[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.lineTo(xToPx(1), yToPx(0));
      ctx.lineTo(xToPx(0), yToPx(0));
      ctx.closePath();
      const fillGrad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + plotH());
      fillGrad.addColorStop(0, "rgba(135, 184, 120, 0.10)");
      fillGrad.addColorStop(1, "rgba(135, 184, 120, 0.00)");
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // ── inscription near current phase ─────────────────────────
      // italic display label of the current phase, near the marker
      const inscr = phaseLabel(currPhase);
      ctx.font = `300 italic 22px var(--font-fraunces, Georgia), serif`;
      ctx.fillStyle = "rgba(232, 240, 220, 0.78)";
      ctx.textAlign = "center";
      const markerPx = xToPx(currT);
      const markerPy = yToPx(currY);
      const labelY = Math.max(PAD_T + 22, markerPy - 26);
      ctx.fillText(inscr, markerPx, labelY);

      // ── the marker ─────────────────────────────────────────────
      const markerColor = currPhase === "ascent"
        ? "#87b878"
        : currPhase === "plateau"
        ? "#a8c890"
        : currPhase === "decline"
        ? "#c06a4a"
        : "#7a8090";

      // halo
      const halo = ctx.createRadialGradient(markerPx, markerPy, 4, markerPx, markerPy, 32);
      halo.addColorStop(0, `${markerColor}99`);
      halo.addColorStop(1, `${markerColor}00`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(markerPx, markerPy, 32, 0, Math.PI * 2);
      ctx.fill();
      // body (large for touch)
      ctx.fillStyle = "rgba(8, 19, 13, 0.85)";
      ctx.beginPath();
      ctx.arc(markerPx, markerPy, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = markerColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(markerPx, markerPy, 12, 0, Math.PI * 2);
      ctx.stroke();

      // bottom label: t = ##%
      ctx.fillStyle = "rgba(200, 220, 180, 0.55)";
      ctx.font = `500 12px var(--font-fraunces, Georgia), serif`;
      ctx.textAlign = "left";
      ctx.fillText(`t = ${Math.round(currT * 100)}%`, PAD_L, PAD_T + plotH() + 22);
      ctx.textAlign = "right";
      ctx.fillText(`y = ${currY.toFixed(2)}`, PAD_L + plotW(), PAD_T + plotH() + 22);

      // ── audio: bend drone pitch with y, chime on phase change ──
      const drone = droneRef.current;
      const audioCtx = getFieldAudio().getAudioContext();
      if (drone.osc && drone.g && audioCtx) {
        try {
          // y in [0, 1] → freq in [120, 360] (gentle bend)
          const targetFreq = 120 + currY * 240;
          drone.osc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.08);
        } catch { /* noop */ }
      }
      if (lastPhaseRef.current !== null && lastPhaseRef.current !== currPhase) {
        // phase transition — chime
        getFieldAudio().chime();
      }
      lastPhaseRef.current = currPhase;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      cv.removeEventListener("pointerdown", onPointerDown);
      cv.removeEventListener("pointermove", onPointerMove);
      cv.removeEventListener("pointerup", onPointerUp);
      cv.removeEventListener("pointercancel", onPointerUp);
      releaseDrone();
    };
  }, []);

  const onPlay = () => {
    setPlaying((p) => !p);
    if (!playing) {
      ensureDrone();
      // if we're at the end, restart
      if (tRef.current >= 0.999) {
        tRef.current = 0;
        setT(0);
      }
    }
  };

  return (
    <section className="growth-zone">
      <div className="growth-eyebrow">zone iii &middot; life cycle</div>
      <h2 className="growth-title">birth, climb, plateau, rest</h2>
      <div className="growth-sub">drag the marker, or let it walk</div>
      <div ref={wrapRef} className="growth-canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label="life cycle curve — drag the marker to scrub, press play to advance"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            touchAction: "none",
            cursor: "grab",
          }}
        />
      </div>
      <div className="growth-life-controls" style={{ marginTop: 14, display: "flex", gap: 14, alignItems: "center" }}>
        <button type="button" className="growth-button" onClick={onPlay}>
          {playing ? "pause" : "play"}
        </button>
        <span className="growth-readout" style={{ color: "rgba(200, 220, 180, 0.62)" }}>
          {playing ? "marker walking · 30s traversal" : "free scrub · drag the marker"}
        </span>
      </div>
    </section>
  );
}
