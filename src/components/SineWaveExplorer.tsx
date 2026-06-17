"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function pathFromPoints(points: Array<readonly [number, number]>) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}

export default function SineWaveExplorer() {
  const plotRef = useRef<SVGSVGElement | null>(null);
  const [amp, setAmp] = useState(78);
  const [freq, setFreq] = useState(2);
  const [phase, setPhase] = useState(0);
  const [damping, setDamping] = useState(0.08);
  const [harmonic, setHarmonic] = useState(0.24);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(40, now - previous);
      previous = now;
      setPhase((value) => (value + delta * 0.002) % (Math.PI * 2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const points = useMemo(() => {
    return Array.from({ length: 260 }, (_, i) => {
      const x = 40 + (i / 259) * 880;
      const u = (i / 259) * Math.PI * 2;
      const decay = Math.exp(-damping * (i / 259) * 4);
      const y =
        250 -
        Math.sin(u * freq + phase) * amp * decay -
        Math.sin(u * freq * 2 + phase * 1.5) * amp * harmonic * 0.5;
      return [x, y] as const;
    });
  }, [amp, damping, freq, harmonic, phase]);

  const ghostPoints = useMemo(() => {
    return Array.from({ length: 180 }, (_, i) => {
      const x = 40 + (i / 179) * 880;
      const u = (i / 179) * Math.PI * 2;
      const y = 250 - Math.cos(u * (freq + 1) - phase * 0.8) * amp * harmonic;
      return [x, y] as const;
    });
  }, [amp, freq, harmonic, phase]);

  const tuneFromPointer = (clientX: number, clientY: number) => {
    const svg = plotRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    setPhase(x * Math.PI * 2);
    setAmp(Math.round(28 + (1 - y) * 116));
  };

  return (
    <div className="sine-page" data-touch-surface="true">
      <section className="sine-shell">
        <div className="sine-topline">
          <div>
            <p className="t-eyebrow sine-kicker">sine / wave explorer</p>
            <h1>Sine wave explorer</h1>
          </div>
          <button type="button" onClick={() => setRunning((value) => !value)}>
            {running ? "pause" : "play"}
          </button>
        </div>

        <div className="sine-controls" aria-label="wave controls">
          <label>
            <span>amplitude</span>
            <input type="range" min="20" max="145" value={amp} onChange={(event) => setAmp(Number(event.target.value))} />
            <strong>{amp}</strong>
          </label>
          <label>
            <span>frequency</span>
            <input type="range" min="1" max="8" step="0.25" value={freq} onChange={(event) => setFreq(Number(event.target.value))} />
            <strong>{freq.toFixed(2)}</strong>
          </label>
          <label>
            <span>phase</span>
            <input type="range" min="0" max="6.28" step="0.01" value={phase} onChange={(event) => setPhase(Number(event.target.value))} />
            <strong>{phase.toFixed(2)}</strong>
          </label>
          <label>
            <span>damping</span>
            <input type="range" min="0" max="0.45" step="0.01" value={damping} onChange={(event) => setDamping(Number(event.target.value))} />
            <strong>{damping.toFixed(2)}</strong>
          </label>
          <label>
            <span>harmonic</span>
            <input type="range" min="0" max="0.8" step="0.01" value={harmonic} onChange={(event) => setHarmonic(Number(event.target.value))} />
            <strong>{harmonic.toFixed(2)}</strong>
          </label>
        </div>

        <svg
          ref={plotRef}
          className="sine-plot"
          viewBox="0 0 960 500"
          role="img"
          aria-label="Interactive sine wave plot"
          onPointerDown={(event) => {
            tuneFromPointer(event.clientX, event.clientY);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.buttons !== 1) return;
            tuneFromPointer(event.clientX, event.clientY);
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        >
          <rect width="960" height="500" rx="8" fill="#f2eee6" />
          {Array.from({ length: 11 }, (_, i) => (
            <line key={`v-${i}`} x1={40 + i * 88} y1="50" x2={40 + i * 88} y2="450" stroke="rgba(21,23,26,0.09)" />
          ))}
          {Array.from({ length: 7 }, (_, i) => (
            <line key={`h-${i}`} x1="40" y1={70 + i * 60} x2="920" y2={70 + i * 60} stroke="rgba(21,23,26,0.09)" />
          ))}
          <line x1="40" y1="250" x2="920" y2="250" stroke="rgba(44,74,92,0.32)" strokeWidth="2" />
          <path d={pathFromPoints(ghostPoints)} fill="none" stroke="#c8732a" strokeWidth="2" opacity="0.42" />
          <path d={pathFromPoints(points)} fill="none" stroke="#15171a" strokeWidth="5" strokeLinecap="round" />
          {points.filter((_, index) => index % 34 === 0).map(([x, y], index) => (
            <circle key={index} cx={x} cy={y} r="5" fill={index % 2 ? "#2c4a5c" : "#c8732a"} />
          ))}
          <text x="52" y="82" className="sine-readout">
            y = A sin(wx + phase) + a smaller echo
          </text>
        </svg>
      </section>

      <style>{`
        .sine-page {
          min-height: 100vh;
          background: linear-gradient(180deg, #e9dfcd 0%, #f2eee6 48%, #d4e3df 100%);
          color: var(--ink);
        }
        .sine-shell {
          max-width: 1180px;
          margin: 0 auto;
          padding: 34px var(--pad-x) 56px;
        }
        .sine-topline {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 16px;
        }
        .sine-kicker { letter-spacing: 0; }
        .sine-topline h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: 58px;
          font-weight: 300;
          line-height: 1;
          letter-spacing: 0;
        }
        .sine-topline button,
        .sine-controls label {
          border: 1px solid rgba(21, 23, 26, 0.18);
          border-radius: 6px;
          background: rgba(255, 252, 245, 0.62);
          min-height: 48px;
        }
        .sine-topline button {
          padding: 0 24px;
          cursor: pointer;
          font-family: var(--font-text);
          font-size: 13px;
          letter-spacing: 0;
          text-transform: lowercase;
        }
        .sine-controls {
          display: grid;
          grid-template-columns: repeat(5, minmax(140px, 1fr));
          gap: 10px;
          margin-bottom: 14px;
        }
        .sine-controls label {
          display: grid;
          grid-template-columns: 1fr;
          gap: 4px;
          padding: 9px 12px;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
        }
        .sine-controls strong {
          font-family: var(--font-numerals);
          font-size: 15px;
          font-weight: 500;
        }
        .sine-plot {
          width: 100%;
          min-height: 430px;
          display: block;
          border: 1px solid rgba(21, 23, 26, 0.14);
          border-radius: 8px;
          touch-action: none;
          box-shadow: 0 18px 60px rgba(21, 23, 26, 0.12);
        }
        .sine-readout {
          font-family: var(--font-text);
          font-size: 14px;
          fill: rgba(21, 23, 26, 0.48);
        }
        @media (max-width: 820px) {
          .sine-topline { align-items: start; }
          .sine-topline h1 { font-size: 42px; }
          .sine-controls {
            grid-auto-flow: column;
            grid-auto-columns: minmax(154px, 68vw);
            grid-template-columns: none;
            overflow-x: auto;
            overscroll-behavior-x: contain;
            padding-bottom: 8px;
          }
          .sine-plot { min-height: 390px; }
        }
      `}</style>
    </div>
  );
}
