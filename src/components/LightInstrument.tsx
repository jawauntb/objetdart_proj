"use client";

import { useRef, useState } from "react";

type AudioBag = {
  context: AudioContext;
  master: GainNode;
};

const NOTES = [
  ["C", 261.63],
  ["D", 293.66],
  ["E", 329.63],
  ["G", 392.0],
  ["A", 440.0],
  ["B", 493.88],
] as const;

const WAVEFORMS: OscillatorType[] = ["sine", "triangle", "square", "sawtooth"];

function ensureAudio(current: AudioBag | null): AudioBag | null {
  if (current) return current;
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  const context = new AudioContextCtor();
  const master = context.createGain();
  master.gain.value = 0.16;
  master.connect(context.destination);
  return { context, master };
}

export default function LightInstrument() {
  const audioRef = useRef<AudioBag | null>(null);
  const lastToneAt = useRef(0);
  const [hue, setHue] = useState(48);
  const [lightness, setLightness] = useState(64);
  const [waveform, setWaveform] = useState<OscillatorType>("sine");
  const [octave, setOctave] = useState(1);
  const [activeNote, setActiveNote] = useState("C");
  const [message, setMessage] = useState("tap the light");

  const play = async (frequency: number, note: string, duration = 0.42) => {
    const bag = ensureAudio(audioRef.current);
    if (!bag) return;
    audioRef.current = bag;
    if (bag.context.state === "suspended") await bag.context.resume();

    const oscillator = bag.context.createOscillator();
    const gain = bag.context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.value = frequency * octave;
    gain.gain.setValueAtTime(0.0001, bag.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.45, bag.context.currentTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, bag.context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(bag.master);
    oscillator.start();
    oscillator.stop(bag.context.currentTime + duration + 0.04);
    setActiveNote(note);
    setMessage(`${note}${octave === 2 ? " high" : ""} / ${waveform}`);
  };

  const tunePad = (clientX: number, clientY: number, shouldSound: boolean) => {
    const target = document.querySelector(".light-pad");
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const nextHue = Math.round(x * 330);
    const nextLight = Math.round(38 + (1 - y) * 44);
    setHue(nextHue);
    setLightness(nextLight);
    if (!shouldSound) return;
    const now = performance.now();
    if (now - lastToneAt.current < 90) return;
    lastToneAt.current = now;
    const frequency = 180 + x * 620 + (1 - y) * 180;
    void play(frequency, "pad", 0.22);
  };

  return (
    <div className="light-page" data-touch-surface="true">
      <section className="light-shell">
        <div className="light-copy">
          <p className="t-eyebrow light-kicker">light / color music instrument</p>
          <h1>Play the color of sound.</h1>
          <p>Tap notes or drag the lamp. Horizontal motion bends color, vertical motion lifts pitch.</p>
        </div>

        <div className="light-controls" aria-label="light instrument controls">
          <div className="light-notes" role="group" aria-label="notes">
            {NOTES.map(([note, frequency]) => (
              <button key={note} type="button" aria-pressed={activeNote === note} onClick={() => void play(frequency, note)}>
                {note}
              </button>
            ))}
          </div>
          <div className="light-waves" role="group" aria-label="waveform">
            {WAVEFORMS.map((name) => (
              <button key={name} type="button" aria-pressed={waveform === name} onClick={() => setWaveform(name)}>
                {name}
              </button>
            ))}
          </div>
          <label>
            <span>octave</span>
            <input type="range" min="1" max="2" step="1" value={octave} onChange={(event) => setOctave(Number(event.target.value))} />
            <strong>{octave}</strong>
          </label>
        </div>

        <div
          className="light-pad"
          role="button"
          tabIndex={0}
          aria-label="light pad"
          onPointerDown={(event) => {
            tunePad(event.clientX, event.clientY, true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.buttons !== 1) return;
            tunePad(event.clientX, event.clientY, true);
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void play(440, "A");
            }
          }}
          style={{
            background: `radial-gradient(circle at 50% 42%, hsl(${hue} 92% ${lightness}%) 0%, hsl(${(hue + 42) % 360} 82% 42%) 34%, #121415 72%)`,
            boxShadow: `0 0 80px hsla(${hue}, 92%, ${lightness}%, 0.32)`,
          }}
        >
          <div className="light-core">
            <span>{message}</span>
            <strong>{hue} deg / {lightness}%</strong>
          </div>
        </div>
      </section>

      <style>{`
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
          .light-copy h1 { font-size: 42px; }
          .light-controls {
            grid-auto-flow: column;
            grid-auto-columns: minmax(210px, 78vw);
            grid-template-columns: none;
            overflow-x: auto;
            overscroll-behavior-x: contain;
            padding-bottom: 8px;
          }
          .light-notes { min-width: 330px; }
          .light-waves { min-width: 300px; }
          .light-pad { min-height: 440px; }
        }
      `}</style>
    </div>
  );
}
