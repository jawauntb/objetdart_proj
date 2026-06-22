"use client";

import { useEffect, useMemo, useState } from "react";

type Preset = "square" | "saw" | "triangle";

function pathFromPoints(points: Array<readonly [number, number]>) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}

function harmonicRadius(preset: Preset, index: number) {
  if (preset === "saw") {
    const n = index + 1;
    return { n, r: 70 / n, sign: index % 2 ? -1 : 1 };
  }
  const n = index * 2 + 1;
  if (preset === "triangle") {
    return { n, r: 82 / (n * n), sign: index % 2 ? -1 : 1 };
  }
  return { n, r: 58 / n, sign: 1 };
}

function epicycle(preset: Preset, terms: number, theta: number) {
  let x = 0;
  let y = 0;
  const chain: Array<{ x: number; y: number; r: number }> = [{ x, y, r: 0 }];
  for (let i = 0; i < terms; i += 1) {
    const h = harmonicRadius(preset, i);
    x += Math.cos(theta * h.n * h.sign) * h.r;
    y += Math.sin(theta * h.n * h.sign) * h.r;
    chain.push({ x, y, r: Math.abs(h.r) });
  }
  return chain;
}

export default function CircularityFourier() {
  const [preset, setPreset] = useState<Preset>("square");
  const [terms, setTerms] = useState(5);
  const [speed, setSpeed] = useState(0.9);
  const [theta, setTheta] = useState(0);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(40, now - previous);
      previous = now;
      setTheta((value) => (value + delta * 0.0014 * speed) % (Math.PI * 2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, speed]);

  const chain = useMemo(() => epicycle(preset, terms, theta), [preset, terms, theta]);
  const tip = chain[chain.length - 1];

  const trace = useMemo(() => {
    return Array.from({ length: 220 }, (_, i) => {
      const t = theta - (i / 219) * Math.PI * 2;
      const end = epicycle(preset, terms, t).at(-1) ?? { x: 0, y: 0 };
      return [515 + i * 1.35, 180 + end.y] as const;
    });
  }, [preset, terms, theta]);

  return (
    <div className="circularity-page" data-touch-surface="true" data-pretext-ignore="true">
      <section className="circularity-shell">
        <div className="circularity-copy">
          <p className="t-eyebrow circularity-kicker">circularity / fourier complement</p>
          <h1>Circles become waves.</h1>
          <p>
            Epicycles rotate on the left. Their endpoint writes the wave on the
            right. Change the series and watch corners arrive by accumulation.
          </p>
        </div>

        <div className="circularity-controls" aria-label="fourier controls">
          <div className="circularity-presets" role="group" aria-label="wave preset">
            {(["square", "saw", "triangle"] as const).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={preset === name}
                onClick={() => setPreset(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <label>
            <span>circles</span>
            <input type="range" min="1" max="10" value={terms} onChange={(event) => setTerms(Number(event.target.value))} />
            <strong>{terms}</strong>
          </label>
          <label>
            <span>speed</span>
            <input type="range" min="0.2" max="2.4" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
            <strong>{speed.toFixed(1)}</strong>
          </label>
          <button type="button" onClick={() => setRunning((value) => !value)}>
            {running ? "pause" : "play"}
          </button>
        </div>

        <svg className="circularity-stage" viewBox="0 0 920 420" role="img" aria-label="Fourier epicycle stage">
          <rect width="920" height="420" rx="8" fill="#141616" />
          <path d="M480 44 L480 376" stroke="rgba(242,238,230,0.12)" />
          <path d="M78 180 L842 180" stroke="rgba(242,238,230,0.11)" />
          <g transform="translate(250 180)">
            {chain.slice(1).map((point, index) => {
              const previous = chain[index];
              return (
                <g key={index}>
                  <circle cx={previous.x} cy={previous.y} r={point.r} fill="none" stroke="rgba(242,238,230,0.2)" />
                  <line x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} stroke={index % 2 ? "#78c7d2" : "#d49b50"} strokeWidth="2" />
                  <circle cx={point.x} cy={point.y} r="3" fill={index % 2 ? "#78c7d2" : "#d49b50"} />
                </g>
              );
            })}
          </g>
          <line x1={250 + tip.x} y1={180 + tip.y} x2="515" y2={180 + tip.y} stroke="rgba(242,238,230,0.25)" strokeDasharray="4 6" />
          <path d={pathFromPoints(trace)} fill="none" stroke="#f1d77c" strokeWidth="4" strokeLinecap="round" />
          <circle cx={250 + tip.x} cy={180 + tip.y} r="6" fill="#f1d77c" />
          <circle cx="515" cy={180 + tip.y} r="5" fill="#e36d63" />
          <text x="76" y="346" className="circularity-note">rotating circles</text>
          <text x="612" y="346" className="circularity-note">written wave</text>
        </svg>
      </section>

      <style dangerouslySetInnerHTML={{ __html: `
        .circularity-page {
          min-height: 100vh;
          background: #141616;
          color: rgba(242, 238, 230, 0.94);
        }
        .circularity-shell {
          max-width: 1180px;
          margin: 0 auto;
          padding: 34px var(--pad-x) 58px;
        }
        .circularity-copy {
          max-width: 760px;
        }
        .circularity-kicker {
          color: rgba(242, 238, 230, 0.56);
          letter-spacing: 0;
        }
        .circularity-copy h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-weight: 300;
          font-size: 60px;
          line-height: 1;
          letter-spacing: 0;
        }
        .circularity-copy p:last-child {
          margin: 12px 0 0;
          color: rgba(242, 238, 230, 0.7);
        }
        .circularity-controls {
          display: grid;
          grid-template-columns: minmax(260px, 1.4fr) repeat(2, minmax(150px, 1fr)) minmax(110px, auto);
          gap: 10px;
          margin: 22px 0 14px;
        }
        .circularity-presets,
        .circularity-controls label,
        .circularity-controls > button {
          min-height: 48px;
          border: 1px solid rgba(242, 238, 230, 0.18);
          border-radius: 6px;
          background: rgba(242, 238, 230, 0.06);
        }
        .circularity-presets {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          overflow: hidden;
        }
        .circularity-presets button,
        .circularity-controls > button {
          border: 0;
          background: transparent;
          color: rgba(242, 238, 230, 0.9);
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
          cursor: pointer;
          min-height: 48px;
        }
        .circularity-controls > button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(242, 238, 230, 0.18);
          border-radius: 6px;
          background: rgba(242, 238, 230, 0.06);
        }
        .circularity-presets button[aria-pressed="true"] {
          background: rgba(241, 215, 124, 0.16);
          color: #f1d77c;
        }
        .circularity-controls label {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 10px;
          align-items: center;
          padding: 8px 12px;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
          min-height: 48px;
        }
        .circularity-controls strong {
          font-family: var(--font-numerals);
          font-size: 15px;
        }
        .circularity-stage {
          width: 100%;
          min-height: 430px;
          display: block;
          border: 1px solid rgba(242, 238, 230, 0.14);
          border-radius: 8px;
        }
        .circularity-note {
          font-family: var(--font-text);
          font-size: 13px;
          fill: rgba(242, 238, 230, 0.48);
        }
        @media (max-width: 820px) {
          .circularity-copy h1 { font-size: 42px; }
          .circularity-controls {
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
            overflow: visible;
            padding-bottom: 0;
          }
          .circularity-presets {
            min-width: 0;
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .circularity-presets button,
          .circularity-controls > button {
            font-size: 13px;
          }
          .circularity-controls label {
            grid-template-columns: minmax(58px, auto) minmax(0, 1fr) minmax(32px, auto);
          }
          .circularity-controls input[type="range"] {
            min-width: 0;
          }
          .circularity-stage { min-height: 390px; }
        }
      ` }} />
    </div>
  );
}
