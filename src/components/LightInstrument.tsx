"use client";

import { useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";

const SPEED_OF_LIGHT = 299_792_458;
const MIN_WAVELENGTH = 380;
const MAX_WAVELENGTH = 700;
const BASE_OCTAVE_DROP = 40;

const SPECTRAL_STOPS = [
  { nm: 700, color: "#d83a2e", name: "red" },
  { nm: 610, color: "#f08a28", name: "orange" },
  { nm: 575, color: "#f5d65b", name: "gold" },
  { nm: 530, color: "#4fca75", name: "green" },
  { nm: 485, color: "#45b8e8", name: "cyan" },
  { nm: 450, color: "#5574f7", name: "blue" },
  { nm: 405, color: "#9a63ee", name: "violet" },
] as const;

const OCTAVE_SHIFTS = [-3, -2, -1, 0, 1, 2, 3] as const;

type ToneMark = {
  id: number;
  x: number;
  y: number;
  wavelength: number;
  audible: number;
  optical: number;
  color: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function wavelengthFromX(x: number) {
  return Math.round(MAX_WAVELENGTH - x * (MAX_WAVELENGTH - MIN_WAVELENGTH));
}

function colorFromWavelength(nm: number) {
  const stops = [...SPECTRAL_STOPS].sort((a, b) => a.nm - b.nm);
  const lowerIndex = stops.findIndex((stop) => nm <= stop.nm);
  const upper = stops[Math.max(0, lowerIndex)];
  const lower = stops[Math.max(0, lowerIndex - 1)] ?? upper;
  if (!upper || !lower || upper.nm === lower.nm) return upper?.color ?? "#f4d778";
  const mix = (nm - lower.nm) / (upper.nm - lower.nm);
  const from = lower.color.match(/\w\w/g)?.map((part) => parseInt(part, 16)) ?? [244, 215, 120];
  const to = upper.color.match(/\w\w/g)?.map((part) => parseInt(part, 16)) ?? from;
  const rgb = from.map((channel, index) => Math.round(channel + (to[index] - channel) * mix));
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function opticalFrequencyThz(nm: number) {
  return SPEED_OF_LIGHT / (nm * 1e-9) / 1e12;
}

function audibleFrequency(nm: number, octaveShift: number) {
  const opticalHz = SPEED_OF_LIGHT / (nm * 1e-9);
  return opticalHz / 2 ** (BASE_OCTAVE_DROP - octaveShift);
}

function noteName(freq: number) {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function formatHz(freq: number) {
  return `${freq.toFixed(freq >= 100 ? 1 : 2)} Hz`;
}

export default function LightInstrument() {
  const plateRef = useRef<HTMLDivElement | null>(null);
  const markId = useRef(0);
  const lastToneAt = useRef(0);
  const [wavelength, setWavelength] = useState(532);
  const [octaveShift, setOctaveShift] = useState(0);
  const [marks, setMarks] = useState<ToneMark[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);

  const color = useMemo(() => colorFromWavelength(wavelength), [wavelength]);
  const optical = useMemo(() => opticalFrequencyThz(wavelength), [wavelength]);
  const audible = useMemo(() => audibleFrequency(wavelength, octaveShift), [wavelength, octaveShift]);
  const currentNote = useMemo(() => noteName(audible), [audible]);
  const bridgeLine = useMemo(() => {
    const divisor = BASE_OCTAVE_DROP - octaveShift;
    return `divide by 2^${divisor}`;
  }, [octaveShift]);

  const recordLight = (meta: string, intensity: number) => {
    useField.getState().recordTape("sigil", intensity, `light/${meta}`);
  };

  const playTranslatedTone = (freq: number, duration = 0.32) => {
    const audio = getFieldAudio();
    try {
      audio.playTone(freq, duration);
      window.setTimeout(() => audio.playTone(freq * 2, duration * 0.42), 26);
      window.setTimeout(() => audio.playTone(freq * 3 / 2, duration * 0.34), 58);
    } catch { /* noop */ }
  };

  const commitTranslation = (x: number, y: number, shouldSound: boolean) => {
    const nextWavelength = wavelengthFromX(x);
    const nextShift = OCTAVE_SHIFTS[Math.round((1 - y) * (OCTAVE_SHIFTS.length - 1))];
    const nextColor = colorFromWavelength(nextWavelength);
    const nextOptical = opticalFrequencyThz(nextWavelength);
    const nextAudible = audibleFrequency(nextWavelength, nextShift);

    setWavelength(nextWavelength);
    setOctaveShift(nextShift);

    if (shouldSound) {
      const now = performance.now();
      if (now - lastToneAt.current > 72) {
        lastToneAt.current = now;
        playTranslatedTone(nextAudible, 0.2 + (1 - y) * 0.16);
      }
    }

    const id = markId.current++;
    setMarks((current) => [
      ...current.slice(-11),
      {
        id,
        x,
        y,
        wavelength: nextWavelength,
        audible: nextAudible,
        optical: nextOptical,
        color: nextColor,
      },
    ]);
    recordLight(`translate/${nextWavelength}nm/${Math.round(nextAudible)}hz`, clamp(0.35 + x * 0.32 + (1 - y) * 0.24, 0.2, 1));
  };

  const tuneFromPointer = (clientX: number, clientY: number, shouldSound: boolean) => {
    const target = plateRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const x = clamp((clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((clientY - rect.top) / rect.height, 0, 1);
    commitTranslation(x, y, shouldSound);
  };

  const replayMarks = () => {
    if (marks.length === 0) {
      try { getFieldAudio().refuse(); } catch { /* noop */ }
      recordLight("memory/empty", 0.24);
      return;
    }
    setIsReplaying(true);
    recordLight("memory/replay", 0.88);
    marks.forEach((mark, index) => {
      window.setTimeout(() => {
        setWavelength(mark.wavelength);
        setOctaveShift(Math.round(Math.log2(mark.audible / audibleFrequency(mark.wavelength, 0))) as (typeof OCTAVE_SHIFTS)[number]);
        playTranslatedTone(mark.audible, 0.28);
      }, index * 260);
    });
    window.setTimeout(() => setIsReplaying(false), marks.length * 260 + 420);
  };

  const clearMarks = () => {
    setMarks([]);
    recordLight("memory/clear", 0.34);
    try { getFieldAudio().thud(); } catch { /* noop */ }
  };

  return (
    <div className="light-page" data-touch-surface="true" data-pretext-ignore="true" style={{ "--light-color": color } as React.CSSProperties}>
      <section className="light-stage">
        <div className="light-intro">
          <p className="t-eyebrow">light / octave translator</p>
          <h1>Light is music raised beyond hearing.</h1>
          <p>
            Touch the spectrum. The instrument divides optical frequency by powers of two until color falls back into sound.
          </p>
        </div>

        <div className="light-readout" aria-label="current light and sound translation">
          <div>
            <span>wavelength</span>
            <strong>{wavelength} nm</strong>
          </div>
          <div>
            <span>light frequency</span>
            <strong>{optical.toFixed(1)} THz</strong>
          </div>
          <div>
            <span>octave bridge</span>
            <strong>{bridgeLine}</strong>
          </div>
          <div>
            <span>audible tone</span>
            <strong>{formatHz(audible)} / {currentNote}</strong>
          </div>
        </div>

        <div
          ref={plateRef}
          className="light-plate"
          role="button"
          tabIndex={0}
          aria-label="touch spectrum to translate light into sound"
          onPointerDown={(event) => {
            tuneFromPointer(event.clientX, event.clientY, true);
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
          }}
          onPointerMove={(event) => {
            if (event.buttons !== 1) return;
            tuneFromPointer(event.clientX, event.clientY, true);
          }}
          onPointerUp={(event) => {
            try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
          }}
          onPointerCancel={(event) => {
            try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              playTranslatedTone(audible, 0.34);
              recordLight(`key/${wavelength}nm`, 0.42);
            }
          }}
        >
          <div className="light-beam" />
          <div className="light-prism">
            <span />
            <span />
            <span />
          </div>
          <div className="light-spectrum" aria-hidden="true">
            {SPECTRAL_STOPS.map((stop) => (
              <i key={stop.name} style={{ background: stop.color }} />
            ))}
          </div>
          <div className="light-octaves" aria-hidden="true">
            {OCTAVE_SHIFTS.map((shift) => (
              <span key={shift}>{shift > 0 ? `+${shift}` : shift}</span>
            ))}
          </div>
          {marks.map((mark) => (
            <span
              key={mark.id}
              className="light-mark"
              style={{
                left: `${mark.x * 100}%`,
                top: `${mark.y * 100}%`,
                borderColor: mark.color,
                boxShadow: `0 0 30px ${mark.color}`,
              }}
            />
          ))}
          <div className="light-current">
            <span>{wavelength} nm</span>
            <strong>{currentNote}</strong>
            <em>{formatHz(audible)}</em>
          </div>
        </div>

        <div className="light-actions" aria-label="light memory controls">
          <button type="button" onClick={replayMarks} disabled={isReplaying}>
            {isReplaying ? "replaying" : "replay translations"}
          </button>
          <button type="button" onClick={clearMarks} disabled={marks.length === 0}>
            clear
          </button>
          <output>{marks.length} kept</output>
        </div>
      </section>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .light-page {
          min-height: 100vh;
          background:
            radial-gradient(circle at 50% 35%, rgba(255,255,255,0.14), transparent 36%),
            radial-gradient(circle at 55% 46%, var(--light-color), transparent 34%),
            linear-gradient(180deg, #111312 0%, #070908 100%);
          background-blend-mode: screen, soft-light, normal;
          color: rgba(245, 240, 230, 0.94);
          overflow: hidden;
        }
        body:has(.light-page) .oda-field-watch,
        body:has(.light-page) .oda-candle-mark,
        body:has(.light-page) .oda-tape-shell,
        body:has(.light-page) .oda-sound-toggle {
          display: none !important;
        }
        .light-stage {
          width: min(1180px, calc(100vw - var(--pad-x) * 2));
          margin: 0 auto;
          padding: 30px 0 58px;
        }
        .light-intro {
          max-width: 820px;
          position: relative;
          z-index: 2;
        }
        .light-intro .t-eyebrow {
          color: rgba(245, 240, 230, 0.58);
          letter-spacing: 0;
        }
        .light-intro h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: clamp(46px, 7vw, 86px);
          line-height: 0.92;
          font-weight: 300;
          letter-spacing: 0;
        }
        .light-intro p:last-child {
          max-width: 640px;
          margin: 14px 0 0;
          color: rgba(245, 240, 230, 0.72);
          font-size: 15px;
          line-height: 1.5;
        }
        .light-readout {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1px;
          margin: 24px 0 12px;
          border: 1px solid rgba(245, 240, 230, 0.14);
          background: rgba(245, 240, 230, 0.12);
        }
        .light-readout div {
          min-height: 74px;
          display: grid;
          align-content: center;
          gap: 7px;
          padding: 12px 14px;
          background: rgba(8, 10, 9, 0.72);
        }
        .light-readout span,
        .light-actions output {
          color: rgba(245, 240, 230, 0.54);
          font-family: var(--font-text);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }
        .light-readout strong {
          color: rgba(245, 240, 230, 0.95);
          font-family: var(--font-numerals);
          font-size: clamp(15px, 1.55vw, 22px);
          font-weight: 400;
          letter-spacing: 0;
          white-space: nowrap;
        }
        .light-plate {
          min-height: min(62svh, 610px);
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(245, 240, 230, 0.16);
          border-radius: 8px;
          cursor: crosshair;
          touch-action: none;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.08), transparent 18%, rgba(0,0,0,0.34) 100%),
            linear-gradient(90deg, #d83a2e 0%, #f08a28 16%, #f5d65b 31%, #4fca75 47%, #45b8e8 63%, #5574f7 80%, #9a63ee 100%);
          box-shadow: 0 0 90px rgba(255,255,255,0.18), 0 0 42px var(--light-color);
          isolation: isolate;
        }
        .light-plate:before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            repeating-linear-gradient(90deg, rgba(255,255,255,0.22) 0 1px, transparent 1px 8.4%),
            linear-gradient(180deg, rgba(5,7,8,0.12), rgba(5,7,8,0.78));
          mix-blend-mode: overlay;
          pointer-events: none;
        }
        .light-plate:after {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 48%, transparent 0 22%, rgba(2,3,3,0.34) 54%, rgba(2,3,3,0.72) 100%);
          pointer-events: none;
          z-index: 1;
        }
        .light-beam {
          position: absolute;
          left: -10%;
          top: 45%;
          width: 120%;
          height: 9px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.94), var(--light-color), transparent);
          filter: blur(0.5px);
          box-shadow: 0 0 42px var(--light-color), 0 0 120px rgba(255,255,255,0.34);
          transform: rotate(-8deg);
          z-index: 2;
          pointer-events: none;
        }
        .light-prism {
          position: absolute;
          left: 50%;
          top: 48%;
          width: clamp(150px, 23vw, 260px);
          aspect-ratio: 1;
          transform: translate(-50%, -50%) rotate(45deg);
          border: 1px solid rgba(255,255,255,0.46);
          background:
            linear-gradient(135deg, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 48%, rgba(0,0,0,0.18)),
            rgba(255,255,255,0.06);
          backdrop-filter: blur(2px);
          z-index: 3;
          pointer-events: none;
        }
        .light-prism span {
          position: absolute;
          inset: 18%;
          border: 1px solid rgba(255,255,255,0.2);
        }
        .light-prism span:nth-child(2) { inset: 33%; }
        .light-prism span:nth-child(3) { inset: 48%; }
        .light-spectrum {
          position: absolute;
          left: 22px;
          right: 22px;
          bottom: 22px;
          height: 18px;
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          border: 1px solid rgba(255,255,255,0.28);
          z-index: 4;
        }
        .light-octaves {
          position: absolute;
          top: 18px;
          bottom: 54px;
          right: 18px;
          display: grid;
          align-content: space-between;
          z-index: 4;
          color: rgba(255,255,255,0.66);
          font-family: var(--font-numerals);
          font-size: 12px;
          pointer-events: none;
        }
        .light-mark {
          position: absolute;
          width: clamp(44px, 8vw, 86px);
          aspect-ratio: 1;
          border: 1px solid currentColor;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          mix-blend-mode: screen;
          opacity: 0.82;
          z-index: 5;
          pointer-events: none;
          animation: lightPulse 1600ms ease-out forwards;
        }
        .light-mark:before,
        .light-mark:after {
          content: "";
          position: absolute;
          inset: 50% auto auto 50%;
          width: 150%;
          height: 1px;
          background: currentColor;
          transform: translate(-50%, -50%);
          opacity: 0.7;
        }
        .light-mark:after {
          transform: translate(-50%, -50%) rotate(90deg);
        }
        @keyframes lightPulse {
          0% { opacity: 0.96; scale: 0.24; }
          70% { opacity: 0.62; }
          100% { opacity: 0; scale: 1.9; }
        }
        .light-current {
          position: absolute;
          left: 50%;
          top: 48%;
          width: min(280px, 72vw);
          aspect-ratio: 1;
          transform: translate(-50%, -50%);
          border: 1px solid rgba(255,255,255,0.24);
          border-radius: 50%;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 6px;
          background: rgba(5,7,8,0.34);
          backdrop-filter: blur(6px);
          text-align: center;
          z-index: 6;
          pointer-events: none;
        }
        .light-current span,
        .light-current em {
          color: rgba(245, 240, 230, 0.72);
          font-family: var(--font-numerals);
          font-size: 13px;
          font-style: normal;
        }
        .light-current strong {
          color: white;
          font-family: var(--font-serif);
          font-size: clamp(62px, 10vw, 112px);
          line-height: 0.85;
          font-weight: 300;
          letter-spacing: 0;
          text-shadow: 0 0 34px var(--light-color);
        }
        .light-actions {
          display: grid;
          grid-template-columns: minmax(160px, 1fr) minmax(86px, 0.46fr) minmax(88px, 0.36fr);
          gap: 1px;
          margin-top: 10px;
          border: 1px solid rgba(245, 240, 230, 0.14);
          background: rgba(245, 240, 230, 0.12);
          max-width: 520px;
        }
        .light-actions button,
        .light-actions output {
          min-height: 46px;
          border: 0;
          background: rgba(8,10,9,0.72);
          color: rgba(245, 240, 230, 0.86);
          font-family: var(--font-text);
          font-size: 12px;
          line-height: 1;
          text-transform: lowercase;
          cursor: pointer;
        }
        .light-actions button:disabled {
          cursor: default;
          opacity: 0.44;
        }
        .light-actions output {
          display: grid;
          place-items: center;
        }
        @media (max-width: 860px) {
          .light-stage {
            padding-top: 18px;
            padding-bottom: calc(118px + env(safe-area-inset-bottom, 0px));
          }
          .light-intro p:last-child {
            display: none;
          }
          .light-readout {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .light-readout div {
            min-height: 62px;
            padding: 10px;
          }
          .light-readout strong {
            font-size: 14px;
          }
          .light-plate {
            min-height: min(56svh, 520px);
          }
          .light-current {
            width: min(220px, 62vw);
          }
          .light-actions {
            max-width: none;
          }
        }
        @media (max-width: 420px) {
          .light-readout {
            grid-template-columns: 1fr;
          }
          .light-actions {
            grid-template-columns: 1fr 0.52fr;
          }
          .light-actions output {
            grid-column: 1 / -1;
          }
        }
      `,
        }}
      />
    </div>
  );
}
