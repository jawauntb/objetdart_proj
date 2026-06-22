"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function pathFromPoints(points: Array<readonly [number, number]>) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

function cubicPoint(
  t: number,
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
): readonly [number, number] {
  const inv = 1 - t;
  const x = inv * inv * inv * p0[0] + 3 * inv * inv * t * p1[0] + 3 * inv * t * t * p2[0] + t * t * t * p3[0];
  const y = inv * inv * inv * p0[1] + 3 * inv * inv * t * p1[1] + 3 * inv * t * t * p2[1] + t * t * t * p3[1];
  return [x, y];
}

export default function TimeManifold() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [mass, setMass] = useState(42);
  const [velocity, setVelocity] = useState(0.42);
  const [laps, setLaps] = useState<number[]>([]);
  const startedAt = useRef(0);
  const storedElapsed = useRef(0);
  const lastControlAt = useRef(0);

  useEffect(() => {
    if (!running) return;
    startedAt.current = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setElapsed(storedElapsed.current + now - startedAt.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const gamma = 1 / Math.sqrt(Math.max(0.02, 1 - velocity * velocity));
  const proper = elapsed / gamma;
  const progress = (elapsed % 60000) / 60000;
  const worldline = useMemo(() => ({
    p0: [112, 342 - velocity * 82] as const,
    p1: [280, 280 - mass * 0.34] as const,
    p2: [462, 278 + velocity * 40] as const,
    p3: [812, 132 + velocity * 92] as const,
  }), [mass, velocity]);
  const lapMarkers = useMemo(() => {
    return laps.map((value, index) => {
      const t = (value % 60000) / 60000;
      const [x, y] = cubicPoint(t, worldline.p0, worldline.p1, worldline.p2, worldline.p3);
      return { value, index, x, y };
    });
  }, [laps, worldline]);

  const grid = useMemo(() => {
    const cx = 470;
    const cy = 230;
    const warp = (x: number, y: number): readonly [number, number] => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) + 8;
      const pull = (mass / 100) * 92 / d;
      return [x - dx * pull, y - dy * pull + pull * 30];
    };
    const lines: Array<Array<readonly [number, number]>> = [];
    for (let y = 62; y <= 398; y += 42) {
      lines.push(Array.from({ length: 70 }, (_, i) => warp(70 + i * 12, y)));
    }
    for (let x = 82; x <= 850; x += 48) {
      lines.push(Array.from({ length: 46 }, (_, i) => warp(x, 44 + i * 8)));
    }
    return lines;
  }, [mass]);

  const toggle = () => {
    if (running) {
      storedElapsed.current = elapsed;
      setRunning(false);
      try { getFieldAudio().thud(); } catch { /* noop */ }
      useField.getState().recordTape("sigil", 0.48, "time/pause");
      return;
    }
    setRunning(true);
    try {
      getFieldAudio().chime();
      window.setTimeout(() => getFieldAudio().playNote(72, 85), 95);
    } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.78, "time/start");
  };

  const reset = () => {
    storedElapsed.current = 0;
    setElapsed(0);
    setRunning(false);
    setLaps([]);
    try { getFieldAudio().thud(); } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.34, "time/reset");
  };

  const lap = () => {
    setLaps((current) => [elapsed, ...current].slice(0, 4));
    try { getFieldAudio().playNote(76, 120); } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.72, `time/lap/${formatTime(elapsed)}`);
  };

  const markControl = (meta: string, normalized: number) => {
    const now = performance.now();
    if (now - lastControlAt.current < 140) return;
    lastControlAt.current = now;
    const value = Math.max(0, Math.min(1, normalized));
    try { getFieldAudio().playNote(45 + Math.round(value * 24), 90); } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.32 + value * 0.5, `time/${meta}`);
  };

  return (
    <div className="time-page" data-touch-surface="true" data-pretext-ignore="true">
      <section className="time-shell">
        <div className="time-copy">
          <p className="t-eyebrow time-kicker">time / chronograph / spacetime manifold</p>
          <h1>Time bends while it counts.</h1>
        </div>

        <div className="time-controls" aria-label="chronograph controls">
          <div className="time-buttons">
            <button type="button" onClick={toggle}>{running ? "pause" : "start"}</button>
            <button type="button" onClick={lap}>lap</button>
            <button type="button" onClick={reset}>reset</button>
          </div>
          <label>
            <span>mass</span>
            <input
              type="range"
              min="0"
              max="100"
              value={mass}
              onChange={(event) => {
                const value = Number(event.target.value);
                setMass(value);
                markControl("mass", value / 100);
              }}
            />
            <strong>{mass}</strong>
          </label>
          <label>
            <span>velocity</span>
            <input
              type="range"
              min="0"
              max="0.94"
              step="0.01"
              value={velocity}
              onChange={(event) => {
                const value = Number(event.target.value);
                setVelocity(value);
                markControl("velocity", value / 0.94);
              }}
            />
            <strong>{velocity.toFixed(2)}c</strong>
          </label>
        </div>

        <div className="time-stage">
          <div className="time-watch">
            <svg viewBox="0 0 240 240" aria-label="chronograph dial">
              <circle cx="120" cy="120" r="96" fill="none" stroke="rgba(242,238,230,0.16)" strokeWidth="1" />
              <circle
                cx="120"
                cy="120"
                r="82"
                fill="none"
                stroke="#d9a14d"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${progress * 515} 515`}
                transform="rotate(-90 120 120)"
              />
              {Array.from({ length: 12 }, (_, i) => {
                const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
                const x1 = 120 + Math.cos(angle) * 72;
                const y1 = 120 + Math.sin(angle) * 72;
                const x2 = 120 + Math.cos(angle) * 84;
                const y2 = 120 + Math.sin(angle) * 84;
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(242,238,230,0.42)" />;
              })}
              <line
                x1="120"
                y1="120"
                x2={120 + Math.cos(progress * Math.PI * 2 - Math.PI / 2) * 70}
                y2={120 + Math.sin(progress * Math.PI * 2 - Math.PI / 2) * 70}
                stroke="#f2eee6"
                strokeWidth="2"
              />
              <circle cx="120" cy="120" r="5" fill="#f2eee6" />
            </svg>
            <div className="time-readout">
              <strong>{formatTime(elapsed)}</strong>
              <span>proper {formatTime(proper)} / gamma {gamma.toFixed(2)}</span>
            </div>
            <ol className="time-laps" aria-label="laps">
              {laps.length === 0 ? <li>laps wait here</li> : laps.map((value, index) => <li key={`${value}-${index}`}>{formatTime(value)}</li>)}
            </ol>
          </div>

          <svg className="time-manifold" viewBox="0 0 920 460" role="img" aria-label="spacetime manifold">
            <rect width="920" height="460" rx="8" fill="#171413" />
            {grid.map((line, index) => (
              <path
                key={index}
                d={pathFromPoints(line)}
                fill="none"
                stroke={index % 2 ? "rgba(108,181,190,0.28)" : "rgba(217,161,77,0.24)"}
                strokeWidth="1"
              />
            ))}
            <ellipse cx="470" cy="238" rx={42 + mass * 0.34} ry={18 + mass * 0.16} fill="rgba(217,161,77,0.2)" />
            <circle cx="470" cy="230" r={18 + mass * 0.24} fill="#d9a14d" opacity="0.86" />
            <path
              d={`M${worldline.p0[0]} ${worldline.p0[1]} C ${worldline.p1[0]} ${worldline.p1[1]}, ${worldline.p2[0]} ${worldline.p2[1]}, ${worldline.p3[0]} ${worldline.p3[1]}`}
              fill="none"
              stroke="#f2eee6"
              strokeWidth="3"
              strokeLinecap="round"
            />
            {lapMarkers.map((marker) => (
              <g key={`${marker.value}-${marker.index}`} className="time-lap-marker">
                <line
                  x1={marker.x}
                  y1={marker.y - 18}
                  x2={marker.x}
                  y2={marker.y + 18}
                  stroke="rgba(217,161,77,0.62)"
                  strokeWidth="1"
                  strokeDasharray="3 5"
                />
                <circle cx={marker.x} cy={marker.y} r="6" fill="#d9a14d" />
                <circle cx={marker.x} cy={marker.y} r="13" fill="none" stroke="rgba(217,161,77,0.28)" />
                <text x={marker.x + 12} y={marker.y - 10} className="time-caption">lap {marker.index + 1}</text>
              </g>
            ))}
            <text x="68" y="410" className="time-caption">space grid</text>
            <text x="650" y="80" className="time-caption">worldline tilts with velocity</text>
          </svg>
        </div>
      </section>

      <style dangerouslySetInnerHTML={{ __html: `
        .time-page {
          min-height: 100vh;
          background: #171413;
          color: rgba(242, 238, 230, 0.94);
        }
        .time-shell {
          max-width: 1240px;
          margin: 0 auto;
          padding: 34px var(--pad-x) 58px;
        }
        .time-kicker {
          color: rgba(242, 238, 230, 0.56);
          letter-spacing: 0;
        }
        .time-copy h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: 58px;
          line-height: 1;
          font-weight: 300;
          letter-spacing: 0;
        }
        .time-controls {
          display: grid;
          grid-template-columns: minmax(240px, 0.9fr) repeat(2, minmax(180px, 1fr));
          gap: 10px;
          margin: 22px 0 14px;
        }
        .time-buttons,
        .time-controls label {
          min-height: 50px;
          border: 1px solid rgba(242, 238, 230, 0.18);
          border-radius: 6px;
          background: rgba(242, 238, 230, 0.06);
        }
        .time-buttons {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          overflow: hidden;
        }
        .time-buttons button {
          border: 0;
          border-right: 1px solid rgba(242, 238, 230, 0.12);
          background: transparent;
          color: rgba(242, 238, 230, 0.92);
          cursor: pointer;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
        }
        .time-buttons button:last-child { border-right: 0; }
        .time-controls label {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 10px;
          align-items: center;
          padding: 8px 12px;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
        }
        .time-controls strong {
          font-family: var(--font-numerals);
          font-size: 15px;
        }
        .time-stage {
          display: grid;
          grid-template-columns: minmax(270px, 0.72fr) minmax(0, 1.4fr);
          gap: 14px;
          align-items: stretch;
        }
        .time-watch,
        .time-manifold {
          border: 1px solid rgba(242, 238, 230, 0.14);
          border-radius: 8px;
          background: rgba(242, 238, 230, 0.04);
        }
        .time-watch {
          padding: 18px;
          display: grid;
          gap: 12px;
          align-content: start;
        }
        .time-readout {
          display: grid;
          gap: 4px;
          text-align: center;
        }
        .time-readout strong {
          font-family: var(--font-numerals);
          font-size: 42px;
          line-height: 1;
          font-weight: 500;
        }
        .time-readout span,
        .time-laps,
        .time-caption {
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          color: rgba(242, 238, 230, 0.58);
          fill: rgba(242, 238, 230, 0.58);
        }
        .time-laps {
          list-style: decimal-leading-zero;
          margin: 0;
          padding-left: 28px;
        }
        .time-manifold {
          width: 100%;
          min-height: 440px;
          display: block;
        }
        @media (max-width: 900px) {
          .time-copy h1 { font-size: 42px; }
          .time-controls {
            grid-template-columns: minmax(0, 1fr);
            overflow: visible;
            padding-bottom: 0;
          }
          .time-buttons { min-width: 0; }
          .time-controls label {
            grid-template-columns: minmax(66px, auto) minmax(0, 1fr) minmax(58px, auto);
          }
          .time-controls input[type="range"] {
            min-width: 0;
          }
          .time-stage { grid-template-columns: 1fr; }
          .time-watch {
            grid-template-columns: minmax(170px, 220px) 1fr;
            align-items: center;
          }
          .time-laps { grid-column: 1 / -1; }
          .time-manifold { min-height: 360px; }
        }
        @media (max-width: 560px) {
          .time-watch { grid-template-columns: 1fr; }
          .time-readout strong { font-size: 34px; }
        }
      ` }} />
    </div>
  );
}
