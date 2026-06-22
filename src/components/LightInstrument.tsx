"use client";

import { useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";

const CHROMATIC_KEYS = [
  { label: "C", midi: 60, hue: 48, accidental: false },
  { label: "C#/Db", midi: 61, hue: 64, accidental: true },
  { label: "D", midi: 62, hue: 82, accidental: false },
  { label: "D#/Eb", midi: 63, hue: 104, accidental: true },
  { label: "E", midi: 64, hue: 126, accidental: false },
  { label: "F", midi: 65, hue: 154, accidental: false },
  { label: "F#/Gb", midi: 66, hue: 184, accidental: true },
  { label: "G", midi: 67, hue: 206, accidental: false },
  { label: "G#/Ab", midi: 68, hue: 232, accidental: true },
  { label: "A", midi: 69, hue: 260, accidental: false },
  { label: "A#/Bb", midi: 70, hue: 292, accidental: true },
  { label: "B", midi: 71, hue: 322, accidental: false },
] as const;

const HARMONIES = [
  { id: "single", label: "single", intervals: [0], intensity: 0.36 },
  { id: "fifth", label: "fifth", intervals: [0, 7], intensity: 0.42 },
  { id: "minor", label: "minor", intervals: [0, 3, 7], intensity: 0.56 },
  { id: "major", label: "major", intervals: [0, 4, 7], intensity: 0.58 },
  { id: "sus4", label: "sus4", intervals: [0, 5, 7], intensity: 0.54 },
  { id: "min7", label: "min7", intervals: [0, 3, 7, 10], intensity: 0.72 },
  { id: "maj7", label: "maj7", intervals: [0, 4, 7, 11], intensity: 0.74 },
  { id: "add9", label: "add9", intervals: [0, 4, 7, 14], intensity: 0.76 },
] as const;

const WAVEFORMS = ["sine", "triangle", "square", "sawtooth"] as const satisfies readonly OscillatorType[];

type LightWaveform = (typeof WAVEFORMS)[number];
type HarmonyId = (typeof HARMONIES)[number]["id"];
type LightKey = (typeof CHROMATIC_KEYS)[number];

type Afterimage = {
  id: number;
  x: number;
  y: number;
  hue: number;
  lightness: number;
  waveform: LightWaveform;
};

type ProgressionStep = {
  id: number;
  rootLabel: string;
  rootMidi: number;
  harmony: HarmonyId;
  octave: number;
  waveform: LightWaveform;
  hue: number;
  lightness: number;
};

type ChordOptions = {
  source?: string;
  duration?: number;
  addToProgression?: boolean;
  harmonyId?: HarmonyId;
  octaveValue?: number;
  voice?: LightWaveform;
  strumMs?: number;
};

const WAVE_VOICES: Record<LightWaveform, { partials: readonly number[]; note: number; intensity: number }> = {
  sine: { partials: [1], note: 64, intensity: 0.4 },
  triangle: { partials: [1, 1.5], note: 67, intensity: 0.5 },
  square: { partials: [1, 2], note: 72, intensity: 0.58 },
  sawtooth: { partials: [1, 1.25, 1.5], note: 76, intensity: 0.66 },
};

const HARMONY_BY_ID = Object.fromEntries(HARMONIES.map((harmony) => [harmony.id, harmony])) as Record<HarmonyId, (typeof HARMONIES)[number]>;

function frequencyFromMidi(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function labelForMidi(midi: number) {
  return CHROMATIC_KEYS[((midi % 12) + 12) % 12].label;
}

function rootFromMidi(midi: number): LightKey {
  return CHROMATIC_KEYS[((midi % 12) + 12) % 12];
}

export default function LightInstrument() {
  const padRef = useRef<HTMLDivElement | null>(null);
  const lastToneAt = useRef(0);
  const afterimageId = useRef(0);
  const progressionId = useRef(0);
  const [hue, setHue] = useState(48);
  const [lightness, setLightness] = useState(64);
  const [waveform, setWaveform] = useState<LightWaveform>("sine");
  const [harmony, setHarmony] = useState<HarmonyId>("minor");
  const [octave, setOctave] = useState(1);
  const [activeRoot, setActiveRoot] = useState("C");
  const [activeNotes, setActiveNotes] = useState<string[]>(["C", "D#/Eb", "G"]);
  const [message, setMessage] = useState("C minor / sine");
  const [afterimages, setAfterimages] = useState<Afterimage[]>([]);
  const [progression, setProgression] = useState<ProgressionStep[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);

  const addAfterimage = (x: number, y: number, nextHue: number, nextLightness: number, nextWaveform = waveform) => {
    const id = afterimageId.current++;
    setAfterimages((current) => [
      ...current.slice(-11),
      { id, x, y, hue: nextHue, lightness: nextLightness, waveform: nextWaveform },
    ]);
    window.setTimeout(() => {
      setAfterimages((current) => current.filter((afterimage) => afterimage.id !== id));
    }, 1400);
  };

  const addChordAfterimages = (count: number, nextHue: number, nextLightness: number, voice: LightWaveform) => {
    const total = Math.max(1, count);
    Array.from({ length: total }).forEach((_, index) => {
      const x = (index + 1) / (total + 1);
      const y = 0.68 - (index % 3) * 0.16;
      window.setTimeout(() => addAfterimage(x, y, (nextHue + index * 18) % 360, nextLightness, voice), index * 35);
    });
  };

  const recordLight = (meta: string, intensity: number) => {
    useField.getState().recordTape("sigil", intensity, `light/${meta}`);
  };

  const playLayeredTone = (frequency: number, duration: number, voice: LightWaveform) => {
    const audio = getFieldAudio();
    const profile = WAVE_VOICES[voice];
    profile.partials.forEach((partial, index) => {
      window.setTimeout(() => {
        try {
          audio.playTone(frequency * partial, Math.max(0.07, duration * (index === 0 ? 1 : 0.42)));
        } catch { /* noop */ }
      }, index * 18);
    });
  };

  const playChord = (root: LightKey, options: ChordOptions = {}) => {
    const harmonyId = options.harmonyId ?? harmony;
    const octaveValue = options.octaveValue ?? octave;
    const voice = options.voice ?? waveform;
    const duration = options.duration ?? 0.5;
    const strumMs = options.strumMs ?? 34;
    const harmonyDef = HARMONY_BY_ID[harmonyId];
    const baseMidi = root.midi + (octaveValue - 1) * 12;
    const midiNotes = harmonyDef.intervals.map((interval, index) => baseMidi + interval + (index > 2 ? 12 : 0));
    const noteLabels = midiNotes.map(labelForMidi);
    const nextLight = Math.min(82, Math.max(44, lightness + (harmonyDef.intervals.length - 2) * 3));

    midiNotes.forEach((midi, index) => {
      window.setTimeout(() => playLayeredTone(frequencyFromMidi(midi), duration + index * 0.025, voice), index * strumMs);
    });

    setActiveRoot(root.label);
    setActiveNotes(noteLabels);
    if (options.harmonyId) setHarmony(harmonyId);
    if (options.voice) setWaveform(voice);
    if (options.octaveValue) setOctave(octaveValue);
    setHue(root.hue);
    setLightness(nextLight);
    setMessage(`${root.label} ${harmonyDef.label} / ${voice}`);
    addChordAfterimages(midiNotes.length, root.hue, nextLight, voice);
    recordLight(`chord/${root.label}-${harmonyDef.label}`, Math.min(1, harmonyDef.intensity + WAVE_VOICES[voice].intensity * 0.35));

    if (options.addToProgression !== false && !isReplaying) {
      setProgression((current) => [
        ...current.slice(-7),
        {
          id: progressionId.current++,
          rootLabel: root.label,
          rootMidi: root.midi,
          harmony: harmonyId,
          octave: octaveValue,
          waveform: voice,
          hue: root.hue,
          lightness: nextLight,
        },
      ]);
    }
  };

  const tunePad = (clientX: number, clientY: number, shouldSound: boolean) => {
    const target = padRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const root = CHROMATIC_KEYS[Math.round(x * (CHROMATIC_KEYS.length - 1))];
    const nextHue = Math.round(root.hue + x * 18) % 360;
    const nextLight = Math.round(38 + (1 - y) * 44);
    setHue(nextHue);
    setLightness(nextLight);
    addAfterimage(x, y, nextHue, nextLight);
    if (!shouldSound) return;
    const now = performance.now();
    if (now - lastToneAt.current < 105) return;
    lastToneAt.current = now;
    playChord(root, {
      source: "pad",
      duration: 0.18 + (1 - y) * 0.12,
      addToProgression: false,
      strumMs: 10 + Math.round(y * 30),
    });
  };

  const chooseWaveform = (name: LightWaveform) => {
    setWaveform(name);
    setMessage(`wave ${name}`);
    try { getFieldAudio().playNote(WAVE_VOICES[name].note, 120); } catch { /* noop */ }
    recordLight(`wave/${name}`, WAVE_VOICES[name].intensity);
    addAfterimage(0.5, 0.5, hue, lightness, name);
  };

  const chooseHarmony = (nextHarmony: HarmonyId) => {
    setHarmony(nextHarmony);
    const root = CHROMATIC_KEYS.find((key) => key.label === activeRoot) ?? CHROMATIC_KEYS[0];
    playChord(root, { harmonyId: nextHarmony, addToProgression: false, duration: 0.32, source: "harmony" });
  };

  const chooseOctave = (value: number) => {
    setOctave(value);
    setMessage(value === 2 ? "raised octave" : "lower octave");
    try { getFieldAudio().playNote(value === 2 ? 76 : 64, 110); } catch { /* noop */ }
    recordLight(`octave/${value}`, value === 2 ? 0.62 : 0.42);
  };

  const replayProgression = () => {
    if (progression.length === 0) {
      try { getFieldAudio().refuse(); } catch { /* noop */ }
      recordLight("phrase/empty", 0.22);
      return;
    }

    setIsReplaying(true);
    recordLight("phrase/replay", 0.9);
    progression.forEach((step, index) => {
      window.setTimeout(() => {
        const root = rootFromMidi(step.rootMidi);
        setHue(step.hue);
        setLightness(step.lightness);
        playChord(root, {
          harmonyId: step.harmony,
          octaveValue: step.octave,
          voice: step.waveform,
          addToProgression: false,
          duration: 0.42,
          source: "phrase",
          strumMs: 42,
        });
      }, index * 430);
    });
    window.setTimeout(() => setIsReplaying(false), progression.length * 430 + 620);
  };

  const clearProgression = () => {
    setProgression([]);
    setMessage("phrase cleared");
    try { getFieldAudio().thud(); } catch { /* noop */ }
    recordLight("phrase/clear", 0.34);
  };

  return (
    <div className="light-page" data-touch-surface="true" data-pretext-ignore="true">
      <section className="light-shell">
        <div className="light-copy">
          <p className="t-eyebrow light-kicker">light / chromatic color instrument</p>
          <h1>Play the color of sound.</h1>
          <p>Chromatic lamps bloom into borrowed harmonies; touch bends the chord.</p>
        </div>

        <div className="light-controls" aria-label="light instrument controls">
          <div className="light-notes" role="group" aria-label="chromatic notes">
            {CHROMATIC_KEYS.map((key) => (
              <button
                key={key.label}
                type="button"
                data-accidental={key.accidental}
                aria-pressed={activeNotes.includes(key.label)}
                onClick={() => playChord(key)}
              >
                {key.label}
              </button>
            ))}
          </div>

          <div className="light-harmonies" role="group" aria-label="harmony">
            {HARMONIES.map((item) => (
              <button key={item.id} type="button" aria-pressed={harmony === item.id} onClick={() => chooseHarmony(item.id)}>
                {item.label}
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

          <div className="light-phrase" aria-label="phrase memory">
            <button type="button" onClick={replayProgression} aria-pressed={isReplaying} disabled={isReplaying}>
              {isReplaying ? "playing" : "replay"}
            </button>
            <button type="button" onClick={clearProgression} disabled={progression.length === 0}>
              clear
            </button>
            <output aria-live="polite">{progression.length} chord phrase</output>
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
              playChord(CHROMATIC_KEYS.find((key) => key.label === activeRoot) ?? CHROMATIC_KEYS[0]);
            }
          }}
          style={{
            background: `radial-gradient(circle at 50% 42%, hsl(${hue} 92% ${lightness}%) 0%, hsl(${(hue + 42) % 360} 82% 42%) 34%, #121415 72%)`,
            boxShadow: `0 0 88px hsla(${hue}, 92%, ${lightness}%, 0.34)`,
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
            <strong>{hue} hue / {lightness}% / {progression.length} kept</strong>
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
          max-width: 760px;
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
          grid-template-columns: minmax(460px, 1.25fr) minmax(240px, 0.75fr);
          gap: 10px;
          margin: 22px 0 14px;
        }
        .light-notes,
        .light-harmonies,
        .light-waves,
        .light-phrase,
        .light-controls label {
          min-height: 50px;
          border: 1px solid rgba(242, 238, 230, 0.18);
          border-radius: 6px;
          background: rgba(242, 238, 230, 0.06);
          overflow: hidden;
        }
        .light-notes {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(12, minmax(0, 1fr));
        }
        .light-harmonies,
        .light-waves,
        .light-phrase {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: 1fr;
        }
        .light-notes button,
        .light-harmonies button,
        .light-waves button,
        .light-phrase button {
          min-width: 0;
          border: 0;
          border-right: 1px solid rgba(242, 238, 230, 0.12);
          background: transparent;
          color: rgba(242, 238, 230, 0.9);
          font-family: var(--font-text);
          font-size: 12px;
          line-height: 1;
          letter-spacing: 0;
          cursor: pointer;
        }
        .light-notes button:last-child,
        .light-harmonies button:last-child,
        .light-waves button:last-child,
        .light-phrase button:last-of-type {
          border-right: 0;
        }
        .light-notes button[data-accidental="true"] {
          background: rgba(8, 10, 12, 0.36);
          color: rgba(242, 238, 230, 0.72);
        }
        .light-notes button[aria-pressed="true"],
        .light-harmonies button[aria-pressed="true"],
        .light-waves button[aria-pressed="true"],
        .light-phrase button[aria-pressed="true"] {
          background: rgba(242, 238, 230, 0.16);
          color: #f4d778;
        }
        .light-phrase {
          grid-template-columns: minmax(82px, 0.8fr) minmax(68px, 0.65fr) minmax(112px, 1fr);
          grid-auto-flow: initial;
        }
        .light-phrase button:disabled {
          cursor: default;
          opacity: 0.46;
        }
        .light-phrase output {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 10px;
          color: rgba(242, 238, 230, 0.68);
          font-family: var(--font-numerals);
          font-size: 12px;
          white-space: nowrap;
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
        .light-pad:after {
          content: "";
          position: absolute;
          inset: auto 8% 12%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(242, 238, 230, 0.24), transparent);
          opacity: 0.7;
          pointer-events: none;
        }
        .light-afterimage {
          position: absolute;
          width: clamp(44px, 9vw, 92px);
          aspect-ratio: 1;
          border: 1px solid rgba(244, 215, 120, 0.46);
          border-radius: 50%;
          transform: translate(-50%, -50%) scale(0.42);
          opacity: 0.82;
          pointer-events: none;
          animation: lightAfterimage 1400ms ease-out forwards;
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
            transform: translate(-50%, -50%) scale(1.9) rotate(16deg);
          }
        }
        .light-core {
          width: min(300px, 72vw);
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
          line-height: 1.3;
          letter-spacing: 0;
          text-transform: lowercase;
        }
        .light-core strong {
          color: rgba(242, 238, 230, 0.66);
          font-weight: 400;
        }
        @media (max-width: 860px) {
          .light-shell {
            padding-top: 18px;
            padding-bottom: calc(112px + env(safe-area-inset-bottom, 0px));
          }
          .light-copy h1 { font-size: clamp(38px, 11vw, 48px); }
          .light-copy p:last-child {
            display: none;
          }
          .light-controls {
            grid-template-columns: 1fr;
            gap: 8px;
            margin-top: 16px;
          }
          .light-notes {
            grid-template-columns: repeat(6, minmax(0, 1fr));
          }
          .light-harmonies {
            grid-auto-flow: initial;
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          .light-waves {
            grid-auto-flow: initial;
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          .light-phrase {
            grid-template-columns: minmax(82px, 0.9fr) minmax(68px, 0.7fr) minmax(108px, 1fr);
          }
          .light-notes button,
          .light-harmonies button,
          .light-waves button,
          .light-phrase button {
            min-height: 42px;
            font-size: 11px;
          }
          .light-phrase output {
            font-size: 11px;
          }
          .light-controls label {
            min-height: 44px;
          }
          .light-pad {
            min-height: min(58svh, 470px);
          }
          .light-core {
            width: min(220px, 60vw);
            transform: translateY(-100px);
          }
        }
        @media (max-width: 360px) {
          .light-phrase {
            grid-template-columns: 1fr 0.8fr;
          }
          .light-phrase output {
            grid-column: 1 / -1;
            min-height: 30px;
            border-top: 1px solid rgba(242, 238, 230, 0.12);
          }
        }
      `,
        }}
      />
    </div>
  );
}
