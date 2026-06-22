"use client";

import { useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";

type Bloom = {
  id: number;
  x: number;
  y: number;
  hue: number;
  size: number;
  spin: number;
};

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function makeBloom(seed: number, count: number): Bloom {
  return {
    id: seed,
    x: Math.round((58 + rand(seed + 1) * 884) * 100) / 100,
    y: Math.round((62 + rand(seed + 2) * 496) * 100) / 100,
    hue: Math.round(((18 + rand(seed + 3) * 286 + count * 7) % 360) * 100) / 100,
    size: Math.round((18 + rand(seed + 4) * 42) * 100) / 100,
    spin: Math.round(rand(seed + 5) * 360 * 100) / 100,
  };
}

export default function FlowersPlayground() {
  const surfaceRef = useRef<SVGSVGElement | null>(null);
  const lastPlantAt = useRef(0);
  const lastControlAt = useRef(0);
  const tapIdRef = useRef(10_000);
  const [seed, setSeed] = useState(12);
  const [petals, setPetals] = useState(7);
  const [breeze, setBreeze] = useState(4);
  const [mirror, setMirror] = useState(true);
  const [taps, setTaps] = useState<Bloom[]>([]);
  const [dragging, setDragging] = useState(false);

  const planted = useMemo(() => {
    return Array.from({ length: seed }, (_, i) => makeBloom(i + 1, seed));
  }, [seed]);

  const blooms = mirror
    ? [
        ...planted,
        ...planted.slice(0, Math.max(3, Math.floor(planted.length / 2))).map((bloom) => ({
          ...bloom,
          id: -bloom.id,
          x: 1000 - bloom.x,
          hue: (bloom.hue + 42) % 360,
          spin: -bloom.spin,
        })),
        ...taps,
      ]
    : [...planted, ...taps];

  const markControl = (meta: string, intensity = 0.44) => {
    const now = performance.now();
    if (now - lastControlAt.current < 140) return;
    lastControlAt.current = now;
    useField.getState().recordTape("object", intensity, `flowers/${meta}`);
    try { getFieldAudio().chime(); } catch { /* noop */ }
  };

  const plantAt = (clientX: number, clientY: number) => {
    const svg = surfaceRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 1000;
    const y = ((clientY - rect.top) / rect.height) * 620;
    if (x < 0 || y < 0 || x > 1000 || y > 620) return;
    const now = performance.now();
    if (now - lastPlantAt.current > 70) {
      lastPlantAt.current = now;
      try {
        getFieldAudio().playNote(54 + Math.round((1 - y / 620) * 16) + Math.round((x / 1000) * 7), 130);
      } catch { /* noop */ }
      useField.getState().recordTape("object", 0.38 + (1 - y / 620) * 0.42, "flowers/plant");
    }
    setTaps((current) => [
      ...current.slice(-20),
      {
        id: tapIdRef.current++,
        x,
        y,
        hue: Math.round(((x * 0.28 + y * 0.18) % 360) * 100) / 100,
        size: 26 + ((x + y) % 34),
        spin: (x - y) % 360,
      },
    ]);
  };

  const replayBouquet = () => {
    const recent = taps.slice(-7);
    if (recent.length === 0) {
      try { getFieldAudio().refuse(); } catch { /* noop */ }
      useField.getState().recordTape("object", 0.24, "flowers/empty-bouquet");
      return;
    }
    useField.getState().recordTape("sigil", 0.82, "flowers/bouquet");
    recent.forEach((bloom, index) => {
      window.setTimeout(() => {
        try {
          getFieldAudio().playNote(52 + Math.round((1 - bloom.y / 620) * 18) + (index % 4), 170);
        } catch { /* noop */ }
      }, index * 115);
    });
  };

  return (
    <div className="flowers-page" data-touch-surface="true" data-pretext-ignore="true">
      <section className="flowers-hero">
        <div className="flowers-copy">
          <p className="t-eyebrow flowers-kicker">flowers / radial instruments</p>
          <h1>Plant a little field.</h1>
          <p>
            Tap the plot to grow blooms. Petals, density, and breeze alter the
            garden without asking it to sit still.
          </p>
        </div>

        <div className="flowers-controls" aria-label="flower controls">
          <label>
            <span>density</span>
            <input
              type="range"
              min="4"
              max="30"
              value={seed}
              onChange={(event) => {
                setSeed(Number(event.target.value));
                markControl("density", 0.46);
              }}
            />
            <strong>{seed}</strong>
          </label>
          <label>
            <span>petals</span>
            <input
              type="range"
              min="4"
              max="14"
              value={petals}
              onChange={(event) => {
                setPetals(Number(event.target.value));
                markControl("petals", 0.52);
              }}
            />
            <strong>{petals}</strong>
          </label>
          <label>
            <span>breeze</span>
            <input
              type="range"
              min="0"
              max="10"
              value={breeze}
              onChange={(event) => {
                setBreeze(Number(event.target.value));
                markControl("breeze", 0.4);
              }}
            />
            <strong>{breeze}</strong>
          </label>
          <button
            type="button"
            onClick={() => {
              setMirror((value) => !value);
              markControl("mirror", 0.62);
            }}
          >
            {mirror ? "unmirror" : "mirror"}
          </button>
          <button
            type="button"
            onClick={() => {
              setTaps([]);
              useField.getState().recordTape("object", 0.36, "flowers/clear");
              try { getFieldAudio().thud(); } catch { /* noop */ }
            }}
          >
            clear taps
          </button>
          <button type="button" onClick={replayBouquet} disabled={taps.length === 0}>
            bouquet {Math.min(taps.length, 7)}
          </button>
        </div>

        <svg
          ref={surfaceRef}
          className="flowers-surface"
          viewBox="0 0 1000 620"
          role="img"
          aria-label="Interactive flower field"
          onPointerDown={(event) => {
            setDragging(true);
            plantAt(event.clientX, event.clientY);
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
          }}
          onPointerMove={(event) => {
            if (!dragging) return;
            plantAt(event.clientX, event.clientY);
          }}
          onPointerUp={(event) => {
            setDragging(false);
            try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
          }}
          onPointerCancel={() => setDragging(false)}
        >
          <defs>
            <linearGradient id="flowersGround" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#13251a" />
              <stop offset="0.5" stopColor="#20391f" />
              <stop offset="1" stopColor="#102735" />
            </linearGradient>
            <radialGradient id="flowersGlow" cx="50%" cy="42%" r="66%">
              <stop offset="0" stopColor="rgba(247, 205, 122, 0.28)" />
              <stop offset="1" stopColor="rgba(247, 205, 122, 0)" />
            </radialGradient>
          </defs>
          <rect width="1000" height="620" rx="8" fill="url(#flowersGround)" />
          <rect width="1000" height="620" rx="8" fill="url(#flowersGlow)" />
          {Array.from({ length: 18 }, (_, i) => (
            <path
              key={i}
              d={`M${i * 62 - 12} 620 C ${90 + i * 42} ${520 - i * 4}, ${160 + i * 34} ${440 + i * 5}, ${240 + i * 48} 334`}
              fill="none"
              stroke={i % 2 ? "rgba(150,216,171,0.13)" : "rgba(111,190,210,0.11)"}
              strokeWidth="1"
            />
          ))}
          {blooms.map((bloom, index) => {
            const sway = Math.sin((index + 1) * 0.9) * breeze;
            const rotation = Math.round((bloom.spin + sway) * 100) / 100;
            const stemX = Math.round(sway * 150) / 100;
            return (
              <g
                key={bloom.id}
                transform={`translate(${bloom.x} ${bloom.y}) rotate(${rotation})`}
                className="flower-bloom"
                style={{ animationDuration: `${4.5 + (index % 5) * 0.6}s` }}
              >
                <line
                  x1="0"
                  y1={bloom.size * 0.24}
                  x2={stemX}
                  y2={bloom.size * 2.5}
                  stroke="rgba(185, 222, 158, 0.38)"
                  strokeWidth="2"
                />
                {Array.from({ length: petals }, (_, petal) => {
                  const angle = (petal / petals) * 360;
                  const fill = `hsl(${(bloom.hue + petal * 8) % 360} 72% 62%)`;
                  return (
                    <ellipse
                      key={petal}
                      cx="0"
                      cy={-bloom.size * 0.55}
                      rx={bloom.size * 0.25}
                      ry={bloom.size * 0.68}
                      fill={fill}
                      opacity="0.78"
                      transform={`rotate(${angle})`}
                    />
                  );
                })}
                <circle r={Math.max(5, bloom.size * 0.22)} fill="#f5c65f" />
                <circle r={Math.max(2, bloom.size * 0.08)} fill="#1b1714" opacity="0.78" />
              </g>
            );
          })}
        </svg>
      </section>

      <style dangerouslySetInnerHTML={{ __html: `
        .flowers-page {
          min-height: 100vh;
          background: #101714;
          color: rgba(242, 238, 230, 0.94);
        }
        .flowers-hero {
          padding: 34px var(--pad-x) 54px;
          max-width: 1180px;
          margin: 0 auto;
        }
        .flowers-copy {
          max-width: 720px;
          margin-bottom: 18px;
        }
        .flowers-kicker {
          color: rgba(218, 226, 193, 0.64);
          letter-spacing: 0;
        }
        .flowers-copy h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: 64px;
          line-height: 0.98;
          font-weight: 300;
          letter-spacing: 0;
        }
        .flowers-copy p:last-child {
          margin: 12px 0 0;
          max-width: 620px;
          color: rgba(226, 221, 204, 0.75);
        }
        .flowers-controls {
          display: grid;
          grid-template-columns: repeat(3, minmax(150px, 1fr)) repeat(3, minmax(112px, auto));
          gap: 10px;
          align-items: stretch;
          margin: 22px 0 14px;
        }
        .flowers-controls label,
        .flowers-controls button {
          min-height: 48px;
          border: 1px solid rgba(226, 221, 204, 0.2);
          border-radius: 6px;
          background: rgba(242, 238, 230, 0.06);
          color: rgba(242, 238, 230, 0.93);
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
        }
        .flowers-controls label {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 10px;
          align-items: center;
          padding: 8px 12px;
        }
        .flowers-controls strong {
          font-family: var(--font-numerals);
          font-size: 16px;
          font-weight: 500;
        }
        .flowers-controls button {
          cursor: pointer;
          padding: 0 14px;
        }
        .flowers-controls button:disabled {
          cursor: default;
          opacity: 0.46;
        }
        .flowers-surface {
          width: 100%;
          min-height: 520px;
          display: block;
          touch-action: none;
          border: 1px solid rgba(226, 221, 204, 0.16);
          border-radius: 8px;
        }
        .flower-bloom {
          transform-box: fill-box;
          transform-origin: center;
          animation-name: flowerBreath;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          animation-direction: alternate;
        }
        @keyframes flowerBreath {
          from { opacity: 0.86; }
          to { opacity: 1; }
        }
        @media (max-width: 760px) {
          .flowers-hero { padding-top: 24px; }
          .flowers-copy h1 { font-size: 44px; }
          .flowers-controls {
            grid-template-columns: minmax(0, 1fr);
            overflow: visible;
            padding-bottom: 0;
          }
          .flowers-controls label {
            grid-template-columns: minmax(70px, auto) minmax(0, 1fr) minmax(34px, auto);
          }
          .flowers-controls input[type="range"] {
            min-width: 0;
          }
          .flowers-controls button {
            min-width: 0;
          }
          .flowers-surface { min-height: 430px; }
        }
      ` }} />
    </div>
  );
}
