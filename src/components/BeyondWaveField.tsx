"use client";

import { useEffect, useRef, useState } from "react";

type TouchPoint = {
  x: number;
  y: number;
  force: number;
  born: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function fieldValue(
  x: number,
  y: number,
  width: number,
  height: number,
  time: number,
  fold: number,
  touch: TouchPoint | null,
) {
  const nx = (x / width - 0.5) * 2;
  const ny = (y / height - 0.5) * 2;
  const cellular = Math.sin((nx * nx - ny * ny) * fold + time * 0.74);
  const braid = Math.sin((nx * 3.3 + Math.sin(ny * fold + time)) * fold * 0.42 - time);
  const moire = Math.cos(Math.hypot(nx + 0.34, ny - 0.22) * fold * 2.4 - time * 1.35);
  const attractor = Math.sin((Math.sin(nx * fold + time * 0.4) + Math.cos(ny * fold - time * 0.35)) * 2.8);

  let pulse = 0;
  if (touch) {
    const dx = x - touch.x;
    const dy = y - touch.y;
    const distance = Math.hypot(dx, dy);
    pulse = Math.sin(distance * 0.045 - time * 5) * Math.exp(-distance * 0.006) * touch.force;
  }

  return cellular * 0.38 + braid * 0.28 + moire * 0.24 + attractor * 0.22 + pulse;
}

export default function BeyondWaveField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<TouchPoint | null>(null);
  const rafRef = useRef(0);
  const reduceMotionRef = useRef(false);

  const [running, setRunning] = useState(true);
  const [density, setDensity] = useState(24);
  const [fold, setFold] = useState(9);
  const [pull, setPull] = useState(0.72);
  const [bloom, setBloom] = useState(0.58);
  const [readout, setReadout] = useState("touch the field");

  const runningRef = useRef(running);
  const densityRef = useRef(density);
  const foldRef = useRef(fold);
  const pullRef = useRef(pull);
  const bloomRef = useRef(bloom);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    densityRef.current = density;
  }, [density]);

  useEffect(() => {
    foldRef.current = fold;
  }, [fold]);

  useEffect(() => {
    pullRef.current = pull;
  }, [pull]);

  useEffect(() => {
    bloomRef.current = bloom;
  }, [bloom]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const update = () => {
      reduceMotionRef.current = mq.matches;
    };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let last = performance.now();
    let time = 0;

    const resize = () => {
      const rect = shell.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(520, Math.floor(rect.height));
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (now: number) => {
      const delta = Math.min(48, now - last);
      last = now;
      if (runningRef.current && !reduceMotionRef.current) {
        time += delta * 0.001;
      }

      context.fillStyle = "rgba(7, 12, 20, 0.24)";
      context.fillRect(0, 0, width, height);

      const gradient = context.createRadialGradient(width * 0.48, height * 0.4, 20, width * 0.5, height * 0.5, Math.max(width, height));
      gradient.addColorStop(0, `rgba(243, 210, 126, ${0.08 + bloomRef.current * 0.08})`);
      gradient.addColorStop(0.45, "rgba(69, 188, 175, 0.05)");
      gradient.addColorStop(1, "rgba(7, 12, 20, 0.42)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const step = densityRef.current;
      const foldNow = foldRef.current;
      const pullNow = pullRef.current;
      const bloomNow = bloomRef.current;
      const touch = pointerRef.current;

      if (touch) {
        touch.force *= 0.985;
        if (touch.force < 0.04) pointerRef.current = null;
      }

      context.lineCap = "round";
      for (let y = step * 0.8; y < height; y += step) {
        for (let x = step * 0.8; x < width; x += step) {
          const a = fieldValue(x, y, width, height, time, foldNow, touch);
          const b = fieldValue(x + 8, y + 6, width, height, time + 0.18, foldNow, touch);
          const angle = Math.atan2(b - a, 0.22) + a * pullNow;
          const length = step * (0.26 + Math.abs(a) * 0.48);
          const hue = 166 + a * 62 + Math.sin(time + x * 0.006) * 22;
          const alpha = 0.18 + Math.abs(a) * (0.22 + bloomNow * 0.22);

          context.strokeStyle = `hsla(${hue}, 78%, ${58 + Math.abs(b) * 18}%, ${alpha})`;
          context.lineWidth = 0.8 + Math.abs(a) * 1.7;
          context.beginPath();
          context.moveTo(x - Math.cos(angle) * length, y - Math.sin(angle) * length);
          context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
          context.stroke();
        }
      }

      const ribbons = 5;
      for (let r = 0; r < ribbons; r += 1) {
        context.beginPath();
        for (let i = 0; i < 150; i += 1) {
          const u = i / 149;
          const baseX = u * width;
          const drift = Math.sin(time * (0.45 + r * 0.09) + u * foldNow * 2.2 + r) * height * 0.11;
          const v = fieldValue(baseX, height * (0.24 + r * 0.12) + drift, width, height, time, foldNow, touch);
          const px = baseX + Math.sin(v * 2 + time + r) * 18;
          const py = height * (0.2 + r * 0.14) + drift + v * 54;
          if (i === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.strokeStyle = `rgba(${r % 2 ? "245, 188, 104" : "105, 214, 205"}, ${0.2 + bloomNow * 0.18})`;
        context.lineWidth = 1.2 + r * 0.22;
        context.stroke();
      }

      if (touch) {
        const age = Math.min(1, (now - touch.born) / 1100);
        const radius = 42 + age * 190 * touch.force;
        context.strokeStyle = `rgba(244, 238, 222, ${0.26 * touch.force})`;
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(touch.x, touch.y, radius, 0, Math.PI * 2);
        context.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const stir = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    pointerRef.current = { x, y, force: 1.35, born: performance.now() };
    setFold(Number((6 + (x / rect.width) * 9).toFixed(1)));
    setPull(Number((0.22 + (1 - y / rect.height) * 1.2).toFixed(2)));
    setReadout(`${Math.round((x / rect.width) * 100)} / ${Math.round((1 - y / rect.height) * 100)}`);
  };

  return (
    <div className="beyond-page" data-touch-surface="true">
      <section ref={shellRef} className="beyond-field" aria-label="novel wave field">
        <canvas
          ref={canvasRef}
          className="beyond-canvas"
          aria-hidden="true"
          onPointerDown={(event) => {
            stir(event.clientX, event.clientY);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.buttons !== 1) return;
            stir(event.clientX, event.clientY);
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        />

        <div className="beyond-copy">
          <p className="t-eyebrow beyond-kicker">novel wave / beyond all this</p>
          <h1>Not a line. Not a circle. A living interference.</h1>
        </div>

        <div className="beyond-panel" aria-label="field controls">
          <div className="beyond-actions">
            <button type="button" onClick={() => setRunning((value) => !value)} aria-pressed={running}>
              {running ? "pause" : "move"}
            </button>
            <output className="beyond-readout" aria-live="polite">{readout}</output>
          </div>

          <label>
            <span>cell size</span>
            <input type="range" min="16" max="36" step="1" value={density} onChange={(event) => setDensity(Number(event.target.value))} />
            <strong>{density}</strong>
          </label>
          <label>
            <span>fold</span>
            <input type="range" min="4" max="16" step="0.1" value={fold} onChange={(event) => setFold(Number(event.target.value))} />
            <strong>{fold.toFixed(1)}</strong>
          </label>
          <label>
            <span>pull</span>
            <input type="range" min="0.1" max="1.6" step="0.01" value={pull} onChange={(event) => setPull(Number(event.target.value))} />
            <strong>{pull.toFixed(2)}</strong>
          </label>
          <label>
            <span>bloom</span>
            <input type="range" min="0.1" max="1" step="0.01" value={bloom} onChange={(event) => setBloom(Number(event.target.value))} />
            <strong>{bloom.toFixed(2)}</strong>
          </label>
        </div>
      </section>

      <style>{`
        .beyond-page {
          min-height: 100vh;
          background:
            radial-gradient(circle at 18% 14%, rgba(244, 188, 93, 0.16), transparent 28%),
            radial-gradient(circle at 82% 22%, rgba(82, 210, 196, 0.14), transparent 30%),
            #070c14;
          color: rgba(244, 238, 222, 0.94);
          overflow: hidden;
        }

        .beyond-field {
          position: relative;
          min-height: calc(100svh - 56px);
          isolation: isolate;
          overflow: hidden;
        }

        .beyond-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          cursor: crosshair;
          touch-action: none;
          z-index: 0;
        }

        .beyond-copy {
          position: relative;
          z-index: 1;
          width: min(780px, calc(100vw - var(--pad-x) * 2));
          padding: clamp(42px, 8vh, 86px) var(--pad-x) 0;
          pointer-events: none;
        }

        .beyond-kicker {
          color: rgba(244, 238, 222, 0.62);
          letter-spacing: 0;
          margin-bottom: 12px;
        }

        .beyond-copy h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: clamp(44px, 8vw, 104px);
          line-height: 0.94;
          font-weight: 300;
          letter-spacing: 0;
          text-wrap: balance;
          text-shadow: 0 18px 54px rgba(7, 12, 20, 0.72);
        }

        .beyond-panel {
          position: absolute;
          z-index: 2;
          left: var(--pad-x);
          right: var(--pad-x);
          bottom: max(18px, env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: minmax(150px, 0.8fr) repeat(4, minmax(130px, 1fr));
          gap: 8px;
          align-items: stretch;
        }

        .beyond-actions,
        .beyond-panel label {
          min-height: 58px;
          border: 1px solid rgba(244, 238, 222, 0.18);
          border-radius: 8px;
          background: rgba(7, 12, 20, 0.62);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
        }

        .beyond-actions {
          display: grid;
          grid-template-columns: 1fr;
          overflow: hidden;
        }

        .beyond-actions button {
          border: 0;
          border-bottom: 1px solid rgba(244, 238, 222, 0.12);
          background: rgba(244, 238, 222, 0.08);
          color: rgba(244, 238, 222, 0.95);
          min-height: 34px;
          cursor: pointer;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
        }

        .beyond-actions button[aria-pressed="false"] {
          color: #f4bc5d;
        }

        .beyond-readout {
          display: flex;
          align-items: center;
          padding: 0 12px;
          color: rgba(244, 238, 222, 0.68);
          font-family: var(--font-numerals);
          font-size: 13px;
          white-space: nowrap;
        }

        .beyond-panel label {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto auto;
          gap: 4px 12px;
          padding: 10px 12px 9px;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
        }

        .beyond-panel label span {
          color: rgba(244, 238, 222, 0.66);
        }

        .beyond-panel label strong {
          color: rgba(244, 238, 222, 0.95);
          font-family: var(--font-numerals);
          font-size: 13px;
          font-weight: 500;
        }

        .beyond-panel input {
          grid-column: 1 / -1;
          width: 100%;
          accent-color: #62d6ca;
        }

        @media (max-width: 920px) {
          .beyond-field {
            min-height: calc(100svh - 56px);
          }

          .beyond-copy {
            padding-top: 34px;
          }

          .beyond-panel {
            grid-auto-flow: column;
            grid-auto-columns: minmax(148px, 58vw);
            grid-template-columns: none;
            overflow-x: auto;
            overscroll-behavior-x: contain;
            padding-bottom: 8px;
          }
        }

        @media (max-width: 560px) {
          .beyond-copy h1 {
            font-size: clamp(38px, 14vw, 58px);
          }

          .beyond-copy {
            width: auto;
            padding-right: 18px;
          }

          .beyond-panel {
            left: 14px;
            right: 14px;
            bottom: max(12px, env(safe-area-inset-bottom, 0px));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .beyond-canvas {
            cursor: default;
          }
        }
      `}</style>
    </div>
  );
}
