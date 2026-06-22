"use client";

import { useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";

const NOTES = [
  ["C", 261.63],
  ["D", 293.66],
  ["E", 329.63],
  ["G", 392.0],
  ["A", 440.0],
  ["B", 493.88],
] as const;

const WAVEFORMS = ["sine", "triangle", "square", "sawtooth"] as const satisfies readonly OscillatorType[];

type LightWaveform = (typeof WAVEFORMS)[number];

type Afterimage = {
  id: number;
  x: number;
  y: number;
  hue: number;
  lightness: number;
  waveform: LightWaveform;
};

const WAVE_VOICES: Record<LightWaveform, { partials: readonly number[]; note: number; intensity: number }> = {
  sine: { partials: [1], note: 64, intensity: 0.4 },
  triangle: { partials: [1, 1.5], note: 67, intensity: 0.5 },
  square: { partials: [1, 2], note: 72, intensity: 0.58 },
  sawtooth: { partials: [1, 1.25, 1.5], note: 76, intensity: 0.66 },
};

export default function LightInstrument() {
  const padRef = useRef<HTMLDivElement | null>(null);
  const lastToneAt = useRef(0);
  const afterimageId = useRef(0);
  const [hue, setHue] = useState(48);
  const [lightness, setLightness] = useState(64);
  const [waveform, setWaveform] = useState<LightWaveform>("sine");
  const [octave, setOctave] = useState(1);
  const [activeNote, setActiveNote] = useState("C");
  const [message, setMessage] = useState("tap the light");
  const [afterimages, setAfterimages] = useState<Afterimage[]>([]);

  const addAfterimage = (x: number, y: number, nextHue: number, nextLightness: number, nextWaveform = waveform) => {
    const id = afterimageId.current++;
    setAfterimages((current) => [
      ...current.slice(-8),
      { id, x, y, hue: nextHue, lightness: nextLightness, waveform: nextWaveform },
    ]);
    window.setTimeout(() => {
      setAfterimages((current) => current.filter((afterimage) => afterimage.id !== id));
    }, 1300);
  };

  const recordLight = (meta: string, intensity: number) => {
    useField.getState().recordTape("sigil", intensity, `light/${meta}`);
  };

  const play = (frequency: number, note: string, duration = 0.42, meta = "note", voice = waveform) => {
    const audio = getFieldAudio();
    const baseFrequency = frequency * octave;
    const profile = WAVE_VOICES[voice];
    try {
      profile.partials.forEach((partial, index) => {
        window.setTimeout(() => {
          audio.playTone(baseFrequency * partial, Math.max(0.08, duration * (index === 0 ? 1 : 0.46)));
        }, index * 24);
      });
    } catch { /* noop */ }
    setActiveNote(note);
    setMessage(`${note}${octave === 2 ? " high" : ""} / ${voice}`);
    recordLight(`${meta}/${note}`, Math.min(1, profile.intensity + (octave - 1) * 0.12));
  };

  const tunePad = (clientX: number, clientY: number, shouldSound: boolean) => {
    const target = padRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const nextHue = Math.round(x * 330);
    const nextLight = Math.round(38 + (1 - y) * 44);
    setHue(nextHue);
    setLightness(nextLight);
    addAfterimage(x, y, nextHue, nextLight);
    if (!shouldSound) return;
    const now = performance.now();
    if (now - lastToneAt.current < 90) return;
    lastToneAt.current = now;
    const frequency = 180 + x * 620 + (1 - y) * 180;
    play(frequency, "pad", 0.18, "pad");
  };

  const chooseWaveform = (name: LightWaveform) => {
    setWaveform(name);
    setMessage(`wave ${name}`);
    try { getFieldAudio().playNote(WAVE_VOICES[name].note, 120); } catch { /* noop */ }
    recordLight(`wave/${name}`, WAVE_VOICES[name].intensity);
    addAfterimage(0.5, 0.5, hue, lightness, name);
  };

  const chooseOctave = (value: number) => {
    setOctave(value);
    setMessage(value === 2 ? "raised octave" : "lower octave");
    try { getFieldAudio().playNote(value === 2 ? 76 : 64, 110); } catch { /* noop */ }
    recordLight(`octave/${value}`, value === 2 ? 0.62 : 0.42);
  };

  return (
    <div className="light-page" data-touch-surface="true" data-pretext-ignore="true">
      <section className="light-shell">
        <div className="light-copy">
          <p className="t-eyebrow light-kicker">light / color music instrument</p>
          <h1>Play the color of sound.</h1>
          <p>Tap notes or drag the lamp. Horizontal motion bends color, vertical motion lifts pitch.</p>
        </div>

        <div className="light-controls" aria-label="light instrument controls">
          <div className="light-notes" role="group" aria-label="notes">
            {NOTES.map(([note, frequency]) => (
              <button key={note} type="button" aria-pressed={activeNote === note} onClick={() => play(frequency, note)}>
                {note}
              </button>
            ))}
          </div>
          <div className="light-waves" role="group" aria-label="waveform">
            {WAVEFORMS.map((name) => (
              <button key={name} type="button" aria-pressed={waveform === name} onClick={() => chooseWaveform(name)}>
                {name}
              </button>
            ))}
          </div>
          <label>
            <span>octave</span>
            <input type="range" min="1" max="2" step="1" value={octave} onChange={(event) => chooseOctave(Number(event.target.value))} />
            <strong>{octave}</strong>
          </label>
        </div>

        <div
          ref={padRef}
          className="light-pad"
          role="button"
          tabIndex={0}
          aria-label="light pad"
          onPointerDown={(event) => {
            tunePad(event.clientX, event.clientY, true);
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
          }}
          onPointerMove={(event) => {
            if (event.buttons !== 1) return;
            tunePad(event.clientX, event.clientY, true);
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
              play(440, "A");
            }
          }}
          style={{
            background: `radial-gradient(circle at 50% 42%, hsl(${hue} 92% ${lightness}%) 0%, hsl(${(hue + 42) % 360} 82% 42%) 34%, #121415 72%)`,
            boxShadow: `0 0 80px hsla(${hue}, 92%, ${lightness}%, 0.32)`,
          }}
        >
          {afterimages.map((afterimage) => (
            <span
              key={afterimage.id}
              className="light-afterimage"
              data-wave={afterimage.waveform}
              style={{
                left: `${afterimage.x * 100}%`,
                top: `${afterimage.y * 100}%`,
                borderColor: `hsla(${afterimage.hue}, 94%, ${afterimage.lightness}%, 0.48)`,
                boxShadow: `0 0 34px hsla(${afterimage.hue}, 94%, ${afterimage.lightness}%, 0.38)`,
              }}
            />
          ))}
          <div className="light-core">
            <span>{message}</span>
            <strong>{hue} deg / {lightness}%</strong>
          </div>
        </div>
      </section>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .light-page {
          min-height: 100vh;
          background: #121415;
          color: rgba(242, 238, 230, 0.94);
        }
        .light-shell {
          max-width: 1120px;
          margin: 0 auto;
          padding: 34px var(--pad-x) 58px;
        }
        .light-copy {
          max-width: 740px;
        }
        .light-kicker {
          color: rgba(242, 238, 230, 0.58);
          letter-spacing: 0;
        }
        .light-copy h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: 58px;
          line-height: 1;
          font-weight: 300;
          letter-spacing: 0;
        }
        .light-copy p:last-child {
          color: rgba(242, 238, 230, 0.72);
          margin: 12px 0 0;
        }
        .light-controls {
          display: grid;
          grid-template-columns: minmax(320px, 1.4fr) minmax(260px, 1fr) minmax(150px, 0.7fr);
          gap: 10px;
          margin: 22px 0 14px;
        }
        .light-notes,
        .light-waves,
        .light-controls label {
          min-height: 50px;
          border: 1px solid rgba(242, 238, 230, 0.18);
          border-radius: 6px;
          background: rgba(242, 238, 230, 0.06);
          overflow: hidden;
        }
        .light-notes,
        .light-waves {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: 1fr;
        }
        .light-notes button,
        .light-waves button {
          border: 0;
          border-right: 1px solid rgba(242, 238, 230, 0.12);
          background: transparent;
          color: rgba(242, 238, 230, 0.9);
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          cursor: pointer;
        }
        .light-notes button:last-child,
        .light-waves button:last-child {
          border-right: 0;
        }
        .light-notes button[aria-pressed="true"],
        .light-waves button[aria-pressed="true"] {
          background: rgba(242, 238, 230, 0.16);
          color: #f4d778;
        }
        .light-controls label {
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
        .light-controls strong {
          font-family: var(--font-numerals);
        }
        .light-pad {
          min-height: 540px;
          border: 1px solid rgba(242, 238, 230, 0.14);
          border-radius: 8px;
          display: grid;
          place-items: center;
          touch-action: none;
          cursor: crosshair;
          transition: box-shadow 140ms linear;
          position: relative;
          overflow: hidden;
        }
        .light-pad:before {
          content: "";
          position: absolute;
          inset: 12%;
          border: 1px solid rgba(255, 255, 255, 0.24);
          border-radius: 50%;
          transform: rotate(18deg) scaleX(1.35);
          pointer-events: none;
        }
        .light-afterimage {
          position: absolute;
          width: clamp(44px, 9vw, 86px);
          aspect-ratio: 1;
          border: 1px solid rgba(244, 215, 120, 0.46);
          border-radius: 50%;
          transform: translate(-50%, -50%) scale(0.42);
          opacity: 0.82;
          pointer-events: none;
          animation: lightAfterimage 1300ms ease-out forwards;
          mix-blend-mode: screen;
        }
        .light-afterimage[data-wave="triangle"] {
          clip-path: polygon(50% 0%, 96% 86%, 4% 86%);
        }
        .light-afterimage[data-wave="square"] {
          border-radius: 12%;
        }
        .light-afterimage[data-wave="sawtooth"] {
          clip-path: polygon(0% 100%, 34% 10%, 34% 100%, 68% 10%, 68% 100%, 100% 10%, 100% 100%);
        }
        @keyframes lightAfterimage {
          0% {
            opacity: 0.78;
            transform: translate(-50%, -50%) scale(0.34) rotate(0deg);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.8) rotate(16deg);
          }
        }
        .light-core {
          width: min(280px, 70vw);
          aspect-ratio: 1;
          border-radius: 50%;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 8px;
          background: rgba(18, 20, 21, 0.36);
          border: 1px solid rgba(242, 238, 230, 0.22);
          backdrop-filter: blur(4px);
          text-align: center;
          pointer-events: none;
        }
        .light-core span,
        .light-core strong {
          font-family: var(--font-text);
          font-size: 13px;
          letter-spacing: 0;
          text-transform: lowercase;
        }
        .light-core strong {
          color: rgba(242, 238, 230, 0.66);
          font-weight: 400;
        }
        @media (max-width: 860px) {
          .light-shell {
            padding-top: 24px;
          }
          .light-copy h1 { font-size: clamp(40px, 13vw, 54px); }
          .light-controls {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .light-notes,
          .light-waves {
            min-width: 0;
          }
          .light-notes button,
          .light-waves button {
            min-height: 48px;
          }
          .light-pad {
            min-height: min(62svh, 470px);
          }
        }
      `,
        }}
      />
    </div>
  );
}
