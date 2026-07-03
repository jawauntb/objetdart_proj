"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";

type Preset = "square" | "saw" | "triangle" | "pulse";

type Harmonic = {
  n: number;
  r: number;
  sign: number;
  hue: string;
};

type EpicyclePoint = Harmonic & {
  x: number;
  y: number;
};

const TAU = Math.PI * 2;
const CENTER_X = 380;
const CENTER_Y = 372;
const WAVE_X = 690;
const WAVE_Y = CENTER_Y;

const PRESETS: Array<{ id: Preset; label: string; tone: string; midi: number }> = [
  { id: "square", label: "square", tone: "#f1d77c", midi: 50 },
  { id: "saw", label: "saw", tone: "#66d4c9", midi: 55 },
  { id: "triangle", label: "triangle", tone: "#ff7f8f", midi: 59 },
  { id: "pulse", label: "pulse", tone: "#b7a0ff", midi: 62 },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function pathFromPoints(points: Array<readonly [number, number]>) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}

function harmonicRadius(preset: Preset, index: number, breath: number): Harmonic {
  const palette = ["#f1d77c", "#66d4c9", "#ff7f8f", "#92a7ff", "#f0a45e", "#8fe1aa"];
  const hue = palette[index % palette.length];

  if (preset === "saw") {
    const n = index + 1;
    return { n, r: 88 / n, sign: index % 2 ? -1 : 1, hue };
  }

  if (preset === "triangle") {
    const n = index * 2 + 1;
    return { n, r: 112 / (n * n), sign: index % 2 ? -1 : 1, hue };
  }

  if (preset === "pulse") {
    const n = index + 1;
    const duty = 0.34 + Math.sin(breath * TAU) * 0.08;
    const signed = 108 * (Math.sin(Math.PI * n * duty) / (Math.PI * n));
    return { n, r: Math.abs(signed), sign: signed < 0 ? -1 : 1, hue };
  }

  const n = index * 2 + 1;
  return { n, r: 80 / n, sign: 1, hue };
}

function epicycle(preset: Preset, terms: number, theta: number, breath: number) {
  let x = 0;
  let y = 0;
  const chain: EpicyclePoint[] = [{ x, y, n: 0, r: 0, sign: 1, hue: "#f1d77c" }];

  for (let i = 0; i < terms; i += 1) {
    const h = harmonicRadius(preset, i, breath);
    const drift = Math.sin(breath * TAU + i * 0.7) * 0.035;
    const angle = theta * h.n * h.sign + drift;
    x += Math.cos(angle) * h.r;
    y += Math.sin(angle) * h.r;
    chain.push({ ...h, x, y });
  }

  return chain;
}

function useLiveRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

function FourierSlider({
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
    <label className="fourier-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <strong>{display}</strong>
    </label>
  );
}

export default function CircularityFourier() {
  const stageRef = useRef<SVGSVGElement | null>(null);
  const pointerRef = useRef({ active: false, id: -1, lastTone: 0 });
  const reduceMotionRef = useRef(false);
  const recordTape = useField((s) => s.recordTape);

  const [preset, setPreset] = useState<Preset>("square");
  const [terms, setTerms] = useState(7);
  const [speed, setSpeed] = useState(0.9);
  const [theta, setTheta] = useState(0);
  const [running, setRunning] = useState(true);
  const [energy, setEnergy] = useState(0.18);
  const [compact, setCompact] = useState(false);
  const [readout, setReadout] = useState("7 harmonics / square");

  const presetRef = useLiveRef(preset);
  const termsRef = useLiveRef(terms);
  const speedRef = useLiveRef(speed);
  const thetaRef = useLiveRef(theta);
  const runningRef = useLiveRef(running);
  const energyRef = useLiveRef(energy);

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
    if (typeof window === "undefined") return;
    const update = () => {
      setCompact(window.innerWidth <= 720);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    let raf = 0;
    let previous = performance.now();
    let localEnergy = energyRef.current;

    const tick = (now: number) => {
      const delta = Math.min(48, now - previous);
      previous = now;
      const reduce = reduceMotionRef.current;

      if (runningRef.current && !reduce) {
        const nextTheta = (thetaRef.current + delta * 0.00145 * speedRef.current) % TAU;
        thetaRef.current = nextTheta;
        setTheta(nextTheta);
      }

      localEnergy = mix(localEnergy, pointerRef.current.active ? 1 : 0.2, pointerRef.current.active ? 0.14 : 0.018);
      energyRef.current = localEnergy;
      setEnergy(localEnergy);
      setReadout(`${termsRef.current} harmonics / ${presetRef.current}`);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [energyRef, presetRef, runningRef, speedRef, termsRef, thetaRef]);

  const chain = useMemo(() => epicycle(preset, terms, theta, energy), [energy, preset, terms, theta]);
  const tip = chain[chain.length - 1];
  const centerX = compact ? 430 : CENTER_X;
  const centerY = CENTER_Y;
  const waveX = compact ? 620 : WAVE_X;
  const waveY = WAVE_Y;
  const orbitScale = compact ? 0.66 : 1;
  const waveScale = compact ? 0.72 : 1;
  const traceStep = compact ? 0.92 : 1.34;

  const trace = useMemo(() => {
    return Array.from({ length: 330 }, (_, i) => {
      const t = theta - (i / 329) * TAU * 1.18;
      const end = epicycle(preset, terms, t, energy).at(-1) ?? chain[0];
      return [waveX + i * traceStep, waveY + end.y * waveScale] as const;
    });
  }, [chain, energy, preset, terms, theta, traceStep, waveScale, waveX, waveY]);

  const harmonicBars = useMemo(
    () => Array.from({ length: 12 }, (_, index) => harmonicRadius(preset, index, energy)),
    [energy, preset],
  );

  const activePreset = PRESETS.find((item) => item.id === preset) ?? PRESETS[0];
  const wavePath = pathFromPoints(trace);
  const tipX = centerX + tip.x * orbitScale;
  const tipY = centerY + tip.y * orbitScale;
  const waveTipY = waveY + tip.y * waveScale;
  const stageStyle = {
    "--circularity-tone": activePreset.tone,
    "--circularity-energy": energy.toFixed(3),
    "--circularity-shadow-opacity": (0.09 + energy * 0.18).toFixed(3),
  } as CSSProperties;

  const ringTone = useCallback((meta: string, intensity: number, offset = 0) => {
    const cfg = PRESETS.find((item) => item.id === presetRef.current) ?? PRESETS[0];
    try { getFieldAudio().playNote(cfg.midi + offset + Math.round(intensity * 18), 95); } catch { /* noop */ }
    try { haptics.ripple(0.16 + intensity * 0.24); } catch { /* noop */ }
    recordTape("sigil", 0.32 + intensity * 0.44, `circularity/${meta}`);
  }, [presetRef, recordTape]);

  const setFourierPreset = (next: Preset) => {
    setPreset(next);
    presetRef.current = next;
    const cfg = PRESETS.find((item) => item.id === next) ?? PRESETS[0];
    try { getFieldAudio().playNote(cfg.midi + 12, 120); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTape("object", 0.66, `circularity/preset/${next}`);
  };

  const setFourierTerms = (next: number, meta = "terms") => {
    const value = clamp(Math.round(next), 1, 12);
    setTerms(value);
    termsRef.current = value;
    ringTone(meta, value / 12, value);
  };

  const tuneFromPointer = useCallback((clientX: number, clientY: number, strength = 1) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const y = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const nextTheta = x * TAU;
    const nextTerms = clamp(Math.round(1 + (1 - y) * 11), 1, 12);
    const nextEnergy = clamp(energyRef.current + 0.16 * strength, 0.18, 1);

    thetaRef.current = nextTheta;
    energyRef.current = nextEnergy;
    termsRef.current = nextTerms;
    setTheta(nextTheta);
    setEnergy(nextEnergy);
    setTerms(nextTerms);

    const now = performance.now();
    if (now - pointerRef.current.lastTone > 85) {
      pointerRef.current.lastTone = now;
      const cfg = PRESETS.find((item) => item.id === presetRef.current) ?? PRESETS[0];
      try { getFieldAudio().playNote(cfg.midi + nextTerms + Math.round((1 - y) * 16), 82); } catch { /* noop */ }
      try { haptics.ripple(0.22 + strength * 0.2); } catch { /* noop */ }
      recordTape("ripple", 0.38 + nextEnergy * 0.36, "circularity/drag");
    }
  }, [energyRef, presetRef, recordTape, termsRef, thetaRef]);

  const toggleRunning = () => {
    setRunning((value) => {
      const next = !value;
      runningRef.current = next;
      try {
        if (next) getFieldAudio().chime();
        else getFieldAudio().thud();
      } catch { /* noop */ }
      recordTape("sigil", next ? 0.72 : 0.42, next ? "circularity/run" : "circularity/rest");
      return next;
    });
  };

  return (
    <div
      className="circularity-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={stageStyle}
    >
      <svg
        ref={stageRef}
        className="circularity-stage"
        viewBox={compact ? "-80 0 1200 760" : "0 0 1200 760"}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="An interactive Fourier instrument where rotating circles draw a waveform"
        onPointerDown={(event: ReactPointerEvent<SVGSVGElement>) => {
          pointerRef.current.active = true;
          pointerRef.current.id = event.pointerId;
          tuneFromPointer(event.clientX, event.clientY, event.pressure || 1);
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
        }}
        onPointerMove={(event: ReactPointerEvent<SVGSVGElement>) => {
          const pointer = pointerRef.current;
          if (!pointer.active || pointer.id !== event.pointerId) return;
          tuneFromPointer(event.clientX, event.clientY, event.pressure > 0 ? event.pressure + 0.42 : 0.86);
        }}
        onPointerUp={(event: ReactPointerEvent<SVGSVGElement>) => {
          const pointer = pointerRef.current;
          if (pointer.id !== event.pointerId) return;
          pointer.active = false;
          pointer.id = -1;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
        }}
        onPointerCancel={(event: ReactPointerEvent<SVGSVGElement>) => {
          const pointer = pointerRef.current;
          if (pointer.id !== event.pointerId) return;
          pointer.active = false;
          pointer.id = -1;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
        }}
      >
        <defs>
          <radialGradient id="circularity-core" cx="36%" cy="46%" r="56%">
            <stop offset="0%" stopColor={activePreset.tone} stopOpacity={0.26 + energy * 0.16} />
            <stop offset="44%" stopColor="#182b2a" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#050507" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="circularity-wave-glow" cx="72%" cy="52%" r="42%">
            <stop offset="0%" stopColor="#f7e7ac" stopOpacity={0.22 + energy * 0.26} />
            <stop offset="52%" stopColor="#66d4c9" stopOpacity="0.09" />
            <stop offset="100%" stopColor="#050507" stopOpacity="0" />
          </radialGradient>
          <filter id="circularity-soft-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width="1200" height="760" fill="#050507" />
        <rect width="1200" height="760" fill="url(#circularity-core)" />
        <rect width="1200" height="760" fill="url(#circularity-wave-glow)" />
        <g className="circularity-grid" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <line key={`v-${i}`} x1={80 + i * 80} y1="58" x2={80 + i * 80} y2="704" />
          ))}
          {Array.from({ length: 8 }, (_, i) => (
            <line key={`h-${i}`} x1="58" y1={104 + i * 80} x2="1142" y2={104 + i * 80} />
          ))}
          <line className="circularity-axis" x1="68" y1={centerY} x2="1132" y2={centerY} />
          <line className="circularity-axis" x1={centerX} y1="70" x2={centerX} y2="662" />
          <line className="circularity-axis" x1={waveX - 22} y1="70" x2={waveX - 22} y2="662" />
        </g>

        <g className="circularity-shadow" aria-hidden="true">
          <path d={wavePath} />
        </g>

        <g className="circularity-epicycles" transform={`translate(${centerX} ${centerY}) scale(${orbitScale})`}>
          {chain.slice(1).map((point, index) => {
            const previous = chain[index];
            return (
              <g key={`${point.n}-${index}`} style={{ "--harmonic-hue": point.hue } as CSSProperties}>
                <circle className="circularity-orbit" cx={previous.x} cy={previous.y} r={point.r} />
                <line className="circularity-radius" x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} />
                <circle className="circularity-joint" cx={point.x} cy={point.y} r={index === terms - 1 ? 5.2 : 3.4} />
                {index < 5 ? (
                  <text className="circularity-harmonic-label" x={previous.x + point.r + 8} y={previous.y - 5}>
                    {point.n}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        <line
          className="circularity-transfer"
          x1={tipX}
          y1={tipY}
          x2={waveX}
          y2={waveTipY}
        />
        <path className="circularity-wave" d={wavePath} />
        <circle className="circularity-tip" cx={tipX} cy={tipY} r={7 + energy * 3} />
        <circle className="circularity-wave-tip" cx={waveX} cy={waveTipY} r={6 + energy * 2} />

        <g className="circularity-spectrum" transform="translate(76 665)" aria-hidden="true">
          {harmonicBars.map((bar, index) => {
            const height = clamp(bar.r * 1.22, 6, 116);
            const active = index < terms;
            return (
              <g
                key={`${bar.n}-${index}`}
                className={active ? "is-active" : undefined}
                transform={`translate(${index * 34} 0)`}
                onPointerDown={(event: ReactPointerEvent<SVGGElement>) => {
                  event.stopPropagation();
                  setFourierTerms(index + 1, "spectrum");
                }}
              >
                <rect className="circularity-spectrum-stem" x="0" y={-height} width="20" height={height} rx="4" style={{ "--harmonic-hue": bar.hue } as CSSProperties} />
                <text x="10" y="28">{bar.n}</text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="circularity-title" aria-hidden="true">
        <span>circularity / Fourier series</span>
        <strong>Circularity</strong>
      </div>

      <div className="circularity-equation" aria-hidden="true">
        <span>sum</span>
        <strong>r_n e^in theta</strong>
      </div>

      <div className="circularity-preset-rail" aria-label="wave presets">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={preset === item.id}
            onClick={() => setFourierPreset(item.id)}
            style={{ "--preset-tone": item.tone } as CSSProperties}
          >
            <i aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="circularity-console" aria-label="Fourier controls">
        <button type="button" className="circularity-run" onClick={toggleRunning} aria-pressed={running}>
          {running ? "pause" : "play"}
        </button>
        <FourierSlider
          label="terms"
          min={1}
          max={12}
          step={1}
          value={terms}
          display={String(terms)}
          onChange={(value) => setFourierTerms(value)}
        />
        <FourierSlider
          label="speed"
          min={0.2}
          max={2.6}
          step={0.1}
          value={speed}
          display={speed.toFixed(1)}
          onChange={(value) => {
            setSpeed(value);
            speedRef.current = value;
            ringTone("speed", value / 2.6, Math.round(value * 4));
          }}
        />
        <FourierSlider
          label="phase"
          min={0}
          max={6.28}
          step={0.01}
          value={theta}
          display={theta.toFixed(2)}
          onChange={(value) => {
            const next = value % TAU;
            setTheta(next);
            thetaRef.current = next;
            ringTone("phase", next / TAU, Math.round(next * 2));
          }}
        />
        <output className="circularity-readout" aria-live="polite" aria-label={`Fourier readout ${readout}`}>
          {readout}
        </output>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .circularity-instrument {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          overflow: hidden;
          background: #050507;
          color: rgba(246, 241, 224, 0.94);
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .circularity-stage {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: crosshair;
          z-index: 0;
        }

        .circularity-grid line {
          stroke: rgba(246, 241, 224, 0.055);
          stroke-width: 1;
        }

        .circularity-grid .circularity-axis {
          stroke: color-mix(in srgb, var(--circularity-tone) 26%, rgba(246, 241, 224, 0.12));
          stroke-width: 1.2;
          stroke-dasharray: 8 18;
        }

        .circularity-shadow path {
          fill: none;
          stroke: color-mix(in srgb, var(--circularity-tone) 48%, transparent);
          stroke-width: 34;
          stroke-linecap: round;
          stroke-linejoin: round;
          opacity: var(--circularity-shadow-opacity);
          filter: url(#circularity-soft-glow);
        }

        .circularity-orbit {
          fill: color-mix(in srgb, var(--harmonic-hue) 5%, transparent);
          stroke: color-mix(in srgb, var(--harmonic-hue) 42%, rgba(246, 241, 224, 0.16));
          stroke-width: 1.15;
          opacity: 0.78;
        }

        .circularity-radius {
          stroke: var(--harmonic-hue);
          stroke-width: 2.2;
          stroke-linecap: round;
          opacity: 0.86;
          filter: drop-shadow(0 0 8px color-mix(in srgb, var(--harmonic-hue) 42%, transparent));
        }

        .circularity-joint,
        .circularity-tip,
        .circularity-wave-tip {
          fill: var(--harmonic-hue, var(--circularity-tone));
          stroke: rgba(255, 249, 225, 0.86);
          stroke-width: 1;
          filter: drop-shadow(0 0 12px color-mix(in srgb, var(--harmonic-hue, var(--circularity-tone)) 60%, transparent));
        }

        .circularity-wave {
          fill: none;
          stroke: #f7e7ac;
          stroke-width: 4.5;
          stroke-linecap: round;
          stroke-linejoin: round;
          filter: drop-shadow(0 0 14px rgba(247, 231, 172, 0.38));
        }

        .circularity-transfer {
          stroke: rgba(246, 241, 224, 0.34);
          stroke-width: 1.5;
          stroke-dasharray: 7 10;
        }

        .circularity-harmonic-label {
          fill: rgba(246, 241, 224, 0.52);
          font-family: var(--font-mono);
          font-size: 12px;
        }

        .circularity-spectrum {
          cursor: pointer;
        }

        .circularity-spectrum-stem {
          fill: color-mix(in srgb, var(--harmonic-hue) 52%, rgba(246, 241, 224, 0.16));
          opacity: 0.28;
          transition: opacity 160ms ease, filter 160ms ease;
        }

        .circularity-spectrum .is-active .circularity-spectrum-stem {
          opacity: 0.94;
          filter: drop-shadow(0 0 13px color-mix(in srgb, var(--harmonic-hue) 58%, transparent));
        }

        .circularity-spectrum text {
          fill: rgba(246, 241, 224, 0.46);
          font-family: var(--font-mono);
          font-size: 11px;
          text-anchor: middle;
        }

        .circularity-title {
          position: fixed;
          z-index: 3;
          top: 78px;
          left: var(--pad-x);
          pointer-events: none;
        }

        .circularity-title span,
        .circularity-equation span {
          display: block;
          margin-bottom: 9px;
          color: rgba(246, 241, 224, 0.48);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0;
          text-transform: lowercase;
        }

        .circularity-title strong {
          display: block;
          color: rgba(248, 244, 224, 0.97);
          font-family: var(--font-serif);
          font-size: 116px;
          font-weight: 500;
          line-height: 0.88;
          text-shadow: 0 0 42px color-mix(in srgb, var(--circularity-tone) 24%, transparent);
        }

        .circularity-equation {
          position: fixed;
          z-index: 2;
          left: var(--pad-x);
          bottom: 166px;
          pointer-events: none;
          color: rgba(248, 244, 224, 0.82);
          text-shadow: 0 0 24px rgba(0, 0, 0, 0.5);
        }

        .circularity-equation strong {
          display: block;
          font-family: var(--font-mono);
          font-size: 21px;
          font-weight: 500;
          line-height: 1;
          letter-spacing: 0;
        }

        .circularity-preset-rail {
          position: fixed;
          z-index: 4;
          top: 90px;
          right: var(--pad-x);
          display: grid;
          gap: 8px;
          width: 244px;
          pointer-events: auto;
        }

        .circularity-preset-rail button {
          min-width: 0;
          min-height: 46px;
          display: grid;
          grid-template-columns: 28px 1fr;
          align-items: center;
          gap: 10px;
          border: 1px solid color-mix(in srgb, var(--preset-tone) 30%, transparent);
          border-radius: 8px;
          background: rgba(5, 5, 7, 0.58);
          color: rgba(246, 241, 224, 0.78);
          padding: 7px 11px;
          font-family: var(--font-mono);
          font-size: 11px;
          text-align: left;
          cursor: pointer;
          backdrop-filter: blur(15px);
          -webkit-backdrop-filter: blur(15px);
        }

        .circularity-preset-rail button i {
          width: 23px;
          height: 23px;
          border-radius: 50%;
          border: 1px solid var(--preset-tone);
          background: color-mix(in srgb, var(--preset-tone) 10%, transparent);
          box-shadow: 0 0 18px color-mix(in srgb, var(--preset-tone) 36%, transparent);
        }

        .circularity-preset-rail button[aria-pressed="true"] {
          background: color-mix(in srgb, var(--preset-tone) 16%, rgba(5, 5, 7, 0.62));
          color: rgba(248, 244, 224, 0.96);
        }

        .circularity-console {
          position: fixed;
          z-index: 5;
          left: var(--pad-x);
          right: var(--pad-x);
          bottom: calc(20px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: 86px repeat(3, minmax(128px, 1fr)) minmax(194px, 0.86fr);
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(246, 241, 224, 0.13);
          border-radius: 8px;
          background: rgba(5, 5, 7, 0.64);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.4);
          pointer-events: auto;
        }

        .circularity-run,
        .fourier-slider,
        .circularity-readout {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(246, 241, 224, 0.12);
          border-radius: 6px;
          background: rgba(246, 241, 224, 0.055);
          color: rgba(246, 241, 224, 0.9);
        }

        .circularity-run {
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 11px;
          text-transform: lowercase;
        }

        .fourier-slider {
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr) 50px;
          align-items: center;
          gap: 9px;
          padding: 8px 11px;
          font-family: var(--font-mono);
          font-size: 11px;
        }

        .fourier-slider span {
          color: rgba(246, 241, 224, 0.58);
        }

        .fourier-slider strong,
        .circularity-readout {
          font-family: var(--font-numerals);
          font-size: 14px;
          font-weight: 500;
        }

        .fourier-slider input {
          width: 100%;
          min-width: 0;
          accent-color: var(--circularity-tone);
        }

        .circularity-readout {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 12px;
          color: rgba(246, 241, 224, 0.72);
          text-align: center;
        }

        body:has(.circularity-instrument) {
          background: #050507;
          overflow: hidden;
        }

        body:has(.circularity-instrument) header,
        body:has(.circularity-instrument) .oda-field-watch,
        body:has(.circularity-instrument) .oda-candle-mark,
        body:has(.circularity-instrument) .oda-tape-shell,
        body:has(.circularity-instrument) .oda-sound-toggle {
          display: none !important;
        }

        @media (max-width: 900px) {
          .circularity-title {
            top: 28px;
            left: 18px;
          }

          .circularity-title strong {
            font-size: 64px;
          }

          .circularity-preset-rail {
            top: auto;
            left: 18px;
            right: 18px;
            bottom: calc(190px + env(safe-area-inset-bottom, 0px));
            width: auto;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 6px;
          }

          .circularity-preset-rail button {
            min-height: 42px;
            grid-template-columns: 18px 1fr;
            gap: 7px;
            padding: 6px 8px;
            font-size: 10px;
          }

          .circularity-preset-rail button i {
            width: 15px;
            height: 15px;
          }

          .circularity-equation {
            display: none;
          }

          .circularity-console {
            left: 12px;
            right: 12px;
            bottom: calc(10px + env(safe-area-inset-bottom, 0px));
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            gap: 6px;
            padding: 6px;
          }

          .circularity-run,
          .fourier-slider,
          .circularity-readout {
            min-height: 50px;
          }

          .fourier-slider {
            grid-template-columns: 42px minmax(0, 1fr) 42px;
            gap: 7px;
            padding: 7px 9px;
          }

          .circularity-readout {
            grid-column: 1 / -1;
            min-height: 38px;
          }
        }

        @media (max-width: 520px) {
          .circularity-title strong {
            font-size: 52px;
          }

          .circularity-title span {
            font-size: 10px;
          }

          .circularity-preset-rail {
            bottom: calc(206px + env(safe-area-inset-bottom, 0px));
          }

          .circularity-preset-rail button {
            grid-template-columns: 1fr;
            justify-items: center;
            font-size: 10px;
          }

          .circularity-preset-rail button i {
            display: none;
          }
        }
          `,
        }}
      />
    </div>
  );
}
