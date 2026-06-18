"use client";

import {
  layoutNextLineRange,
  materializeLineRange,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import { useEffect, useMemo, useRef, useState } from "react";
import WaterText from "@/components/WaterText";
import { useGeneratedSpeech } from "@/lib/useGeneratedSpeech";

type MotionMode = "move" | "shift" | "shake" | "quake" | "wave" | "sine";

type LaidLine = {
  text: string;
  top: number;
  width: number;
  phase: number;
};

const MODES: Array<{ key: MotionMode; label: string }> = [
  { key: "move", label: "move" },
  { key: "shift", label: "shift" },
  { key: "shake", label: "shake" },
  { key: "quake", label: "quake" },
  { key: "wave", label: "wave" },
  { key: "sine", label: "sine" },
];

const STARTER_TEXT =
  "type a sentence and the room will make a coast of it. the words keep their measure, then loosen into wave, quake, shake, and sine. press play and the line becomes a small instrument.";

const LOCAL_ENDINGS = [
  "the sentence leaves a bright edge on the harbor wall.",
  "a candle keeps time beside the soft machine.",
  "the phrase comes back with salt on its hands.",
  "each line makes room for the next small tide.",
];

function useElementWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function localFallback(prompt: string) {
  const clean = prompt.trim().replace(/\s+/g, " ");
  const seed = clean.length + clean.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const ending = LOCAL_ENDINGS[seed % LOCAL_ENDINGS.length];
  if (!clean) return STARTER_TEXT;
  return `${clean.toLowerCase()} is placed on the table and listened to slowly. the room measures it as tide, work, breath, and signal. ${ending}`;
}

function splitTokens(text: string) {
  return text.split(/(\s+)/).filter(Boolean);
}

function layoutText(prepared: PreparedTextWithSegments | null, width: number, lineHeight: number) {
  if (!prepared || width <= 0) return null;
  const lines: LaidLine[] = [];
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
  let top = 0;
  let safety = 0;

  while (safety++ < 140) {
    const inset = Math.sin((top / lineHeight) * 0.9) * Math.min(34, width * 0.04);
    const maxWidth = Math.max(180, width - Math.abs(inset) * 2);
    const range = layoutNextLineRange(prepared, cursor, maxWidth);
    if (!range) break;
    const line = materializeLineRange(prepared, range);
    lines.push({
      text: line.text,
      top,
      width: maxWidth,
      phase: lines.length * 0.42,
    });
    cursor = range.end;
    top += lineHeight;
  }

  return {
    lines,
    height: Math.max(lineHeight * 5, top + lineHeight * 0.8),
  };
}

export default function PretextWave() {
  const stageRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const width = useElementWidth(stageRef);

  const [prompt, setPrompt] = useState("make this sentence into a playable tide");
  const [text, setText] = useState(STARTER_TEXT);
  const [font, setFont] = useState<string | null>(null);
  const [mode, setMode] = useState<MotionMode>("wave");
  const [playing, setPlaying] = useState(true);
  const [phase, setPhase] = useState(0);
  const [amp, setAmp] = useState(18);
  const [density, setDensity] = useState(1.2);
  const [status, setStatus] = useState("local text ready");
  const [generating, setGenerating] = useState(false);
  const { speaking, speechStatus, setSpeechStatus, speakText, stopSpeech } = useGeneratedSpeech({
    context: "pretext wave page, playable sentence, oceanic text instrument",
    doneStatus: "voice complete",
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const ready = "fonts" in document ? document.fonts.ready : Promise.resolve();
    ready.then(() => {
      if (!probeRef.current) return;
      const cs = getComputedStyle(probeRef.current);
      setFont(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`);
    });
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(50, now - previous);
      previous = now;
      setPhase((value) => (value + delta * 0.0025) % (Math.PI * 2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const prepared = useMemo(() => {
    if (!font) return null;
    try {
      return prepareWithSegments(text, font);
    } catch {
      return null;
    }
  }, [font, text]);

  const lineHeight = width > 640 ? 50 : 38;
  const layout = useMemo(
    () => layoutText(prepared, Math.max(0, width - 2), lineHeight),
    [prepared, width, lineHeight],
  );

  const generate = async () => {
    const question = prompt.trim();
    if (!question || generating) return;
    stopSpeech(null);
    setGenerating(true);
    setStatus("asking the room");
    try {
      const res = await fetch("/api/ask-the-room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok) throw new Error("api unavailable");
      const json = await res.json();
      if (typeof json.answer !== "string" || !json.answer.trim()) throw new Error("empty answer");
      setText(json.answer.trim());
      setSpeechStatus(null);
      setStatus(json.model ? `generated by ${json.model}` : "generated by the room");
    } catch {
      setText(localFallback(question));
      setSpeechStatus(null);
      setStatus("local fallback text");
    } finally {
      setGenerating(false);
    }
  };

  const speak = () => {
    void speakText(text);
  };

  const impulse = (nextMode: MotionMode) => {
    setMode(nextMode);
    setPlaying(true);
    if (nextMode === "shift") setPhase((value) => value + Math.PI * 0.55);
    if (nextMode === "shake") setAmp(26);
    if (nextMode === "quake") setAmp(34);
    if (nextMode === "move") setAmp(14);
    if (nextMode === "wave") setAmp(20);
    if (nextMode === "sine") setAmp(18);
  };

  return (
    <div className="pretext-page" data-touch-surface="true">
      <section className="pretext-shell">
        <div className="pretext-top">
          <div>
            <p className="t-eyebrow pretext-kicker">pretext / wavy text</p>
            <h1>
              <WaterText as="span" bobAmp={2.5} maxDisplace={7}>
                a playable sentence
              </WaterText>
            </h1>
          </div>
          <button type="button" className="pretext-play" onClick={() => setPlaying((value) => !value)}>
            {playing ? "pause" : "play"}
          </button>
        </div>

        <div className="pretext-workbench">
          <form
            className="pretext-prompt"
            onSubmit={(event) => {
              event.preventDefault();
              generate();
            }}
          >
            <label htmlFor="pretext-prompt">prompt or text</label>
            <textarea
              id="pretext-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="write the sentence you want the room to bend"
              rows={4}
              maxLength={400}
            />
            <div className="pretext-actions">
              <button type="submit" disabled={generating || !prompt.trim()}>
                {generating ? "generating" : "generate"}
              </button>
              <button
                type="button"
                onClick={() => {
                  stopSpeech(null);
                  setText(prompt.trim() || STARTER_TEXT);
                  setSpeechStatus(null);
                }}
              >
                use text
              </button>
              <button type="button" onClick={speak}>
                {speaking ? "stop voice" : "speak"}
              </button>
            </div>
            <p className="t-mono pretext-status">{speechStatus ?? status}</p>
          </form>

          <div className="pretext-controls" aria-label="text motion controls">
            {MODES.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={mode === item.key}
                onClick={() => impulse(item.key)}
              >
                {item.label}
              </button>
            ))}
            <label>
              <span>amplitude</span>
              <input
                type="range"
                min="0"
                max="42"
                value={amp}
                onChange={(event) => setAmp(Number(event.target.value))}
              />
              <strong>{amp}</strong>
            </label>
            <label>
              <span>frequency</span>
              <input
                type="range"
                min="0.4"
                max="3"
                step="0.05"
                value={density}
                onChange={(event) => setDensity(Number(event.target.value))}
              />
              <strong>{density.toFixed(2)}</strong>
            </label>
          </div>
        </div>

        <div
          ref={stageRef}
          className={`pretext-stage pretext-stage--${mode}`}
          style={{
            "--pretext-amp": `${amp}px`,
            "--pretext-phase": `${phase}`,
            "--pretext-density": `${density}`,
            minHeight: layout ? layout.height : 280,
          } as React.CSSProperties}
          aria-live="polite"
        >
          <span ref={probeRef} className="pretext-probe">measure me</span>
          {!layout ? (
            <p className="pretext-fallback">{text}</p>
          ) : (
            layout.lines.map((line, lineIndex) => (
              <p
                key={`${line.text}-${lineIndex}`}
                className="pretext-line"
                style={{
                  top: line.top,
                  width: line.width,
                  "--line-phase": `${line.phase}`,
                } as React.CSSProperties}
              >
                {splitTokens(line.text).map((token, tokenIndex) => {
                  if (/^\s+$/.test(token)) return <span key={tokenIndex}>{token}</span>;
                  return (
                    <span
                      key={tokenIndex}
                      className="pretext-word"
                      style={{ "--word-index": `${tokenIndex}` } as React.CSSProperties}
                    >
                      {token}
                    </span>
                  );
                })}
              </p>
            ))
          )}
        </div>
      </section>

      <style>{`
        .pretext-page {
          min-height: calc(100vh - 56px);
          background:
            radial-gradient(circle at 18% 14%, rgba(200,115,42,0.18), transparent 24%),
            linear-gradient(145deg, #101a24 0%, #203d49 48%, #f2eee6 48%, #e8e2d5 100%);
          color: #f7f0df;
        }
        .pretext-shell {
          min-height: calc(100vh - 56px);
          padding: clamp(26px, 4vw, 54px) var(--pad-x) clamp(34px, 5vw, 70px);
          display: flex;
          flex-direction: column;
          gap: clamp(18px, 3vw, 30px);
        }
        .pretext-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 18px;
          max-width: 1180px;
          width: 100%;
          margin: 0 auto;
        }
        .pretext-kicker { color: rgba(247,240,223,0.72); }
        .pretext-top h1 {
          margin: 8px 0 0;
          max-width: 11ch;
          font-family: var(--font-serif);
          font-weight: 300;
          font-style: italic;
          font-size: clamp(48px, 9vw, 116px);
          line-height: 0.9;
          letter-spacing: 0;
        }
        .pretext-play,
        .pretext-actions button,
        .pretext-controls button {
          min-height: 44px;
          border: 1px solid rgba(247,240,223,0.32);
          border-radius: 4px;
          background: rgba(247,240,223,0.08);
          color: inherit;
          cursor: pointer;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0.04em;
          text-transform: lowercase;
        }
        .pretext-play { padding: 0 18px; }
        .pretext-actions button:disabled {
          cursor: default;
          opacity: 0.48;
        }
        .pretext-workbench {
          max-width: 1180px;
          width: 100%;
          margin: 0 auto;
          display: grid;
          grid-template-columns: minmax(280px, 0.88fr) minmax(320px, 1.12fr);
          gap: 14px;
          align-items: stretch;
        }
        .pretext-prompt,
        .pretext-controls {
          border: 1px solid rgba(247,240,223,0.16);
          background: rgba(7,15,23,0.58);
          backdrop-filter: blur(12px);
          border-radius: 8px;
          padding: 14px;
        }
        .pretext-prompt label,
        .pretext-controls label span {
          display: block;
          margin-bottom: 8px;
          font-family: var(--font-text);
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: lowercase;
          color: rgba(247,240,223,0.68);
        }
        .pretext-prompt textarea {
          width: 100%;
          resize: vertical;
          min-height: 108px;
          border: 1px solid rgba(247,240,223,0.22);
          border-radius: 4px;
          background: rgba(242,238,230,0.92);
          color: #15171a;
          padding: 12px;
          font-family: var(--font-serif);
          font-size: 20px;
          line-height: 1.35;
        }
        .pretext-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .pretext-actions button { padding: 0 12px; }
        .pretext-status {
          min-height: 18px;
          margin: 10px 0 0;
          color: rgba(247,240,223,0.68);
          font-size: 11px;
        }
        .pretext-controls {
          display: grid;
          grid-template-columns: repeat(6, minmax(68px, 1fr));
          gap: 10px;
        }
        .pretext-controls button {
          padding: 0 10px;
          width: 100%;
        }
        .pretext-controls button[aria-pressed="true"] {
          background: rgba(200,115,42,0.72);
          border-color: rgba(247,240,223,0.78);
        }
        .pretext-controls label {
          grid-column: span 3;
          min-width: 0;
          margin-top: 2px;
        }
        .pretext-controls label strong {
          display: block;
          margin-top: 2px;
          font-family: var(--font-text);
          font-size: 11px;
          color: rgba(247,240,223,0.72);
          font-weight: 400;
        }
        .pretext-stage {
          position: relative;
          max-width: 1180px;
          width: 100%;
          margin: 0 auto;
          overflow: hidden;
          border: 1px solid rgba(21,23,26,0.16);
          border-radius: 8px;
          background:
            repeating-linear-gradient(0deg, rgba(21,23,26,0.05) 0 1px, transparent 1px 50px),
            linear-gradient(180deg, rgba(242,238,230,0.98), rgba(232,226,213,0.96));
          color: #15171a;
          padding: clamp(18px, 4vw, 38px);
          isolation: isolate;
          touch-action: pan-y;
        }
        .pretext-stage::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(90deg, rgba(44,74,92,0.12), transparent 34%, rgba(200,115,42,0.10)),
            radial-gradient(circle at 78% 24%, rgba(44,74,92,0.18), transparent 30%);
          pointer-events: none;
        }
        .pretext-probe {
          position: absolute;
          left: -9999px;
          top: -9999px;
          visibility: hidden;
          font-family: var(--font-serif);
          font-size: clamp(28px, 4vw, 42px);
          font-style: italic;
          font-weight: 300;
        }
        .pretext-fallback,
        .pretext-line {
          font-family: var(--font-serif);
          font-size: clamp(28px, 4vw, 42px);
          font-style: italic;
          font-weight: 300;
          line-height: 1.12;
          letter-spacing: 0;
        }
        .pretext-fallback {
          position: relative;
          z-index: 1;
          margin: 0;
        }
        .pretext-line {
          position: absolute;
          z-index: 1;
          left: clamp(18px, 4vw, 38px);
          margin: 0;
          white-space: pre;
          will-change: transform;
          transform:
            translate3d(
              calc(sin((var(--pretext-phase) + var(--line-phase)) * var(--pretext-density)) * var(--pretext-amp) * 0.26),
              calc(cos((var(--pretext-phase) + var(--line-phase)) * var(--pretext-density)) * var(--pretext-amp) * 0.18),
              0
            );
        }
        .pretext-word {
          display: inline-block;
          will-change: transform, filter;
          transform:
            translateY(calc(sin((var(--pretext-phase) * var(--pretext-density)) + var(--line-phase) + (var(--word-index) * 0.48)) * var(--pretext-amp)));
        }
        .pretext-stage--move .pretext-word {
          transform:
            translateX(calc(cos(var(--pretext-phase) + (var(--word-index) * 0.7)) * var(--pretext-amp) * 0.6))
            translateY(calc(sin(var(--pretext-phase) + var(--line-phase)) * var(--pretext-amp) * 0.32));
        }
        .pretext-stage--shift .pretext-line {
          transform:
            translateX(calc(sin(var(--pretext-phase) + var(--line-phase)) * var(--pretext-amp) * 0.9));
        }
        .pretext-stage--shake .pretext-word {
          transform:
            translateX(calc(sin((var(--pretext-phase) * 7) + (var(--word-index) * 1.7)) * var(--pretext-amp) * 0.26))
            translateY(calc(cos((var(--pretext-phase) * 9) + var(--line-phase)) * var(--pretext-amp) * 0.18));
        }
        .pretext-stage--quake .pretext-line {
          filter: blur(0.2px);
          transform:
            translateX(calc(sin((var(--pretext-phase) * 10) + var(--line-phase)) * var(--pretext-amp) * 0.34))
            translateY(calc(cos((var(--pretext-phase) * 8) + var(--line-phase)) * var(--pretext-amp) * 0.28));
        }
        .pretext-stage--sine .pretext-word {
          transform:
            translateY(calc(sin((var(--word-index) * 0.72) + var(--pretext-phase)) * var(--pretext-amp) * 0.86))
            rotate(calc(cos((var(--word-index) * 0.5) + var(--pretext-phase)) * 1.5deg));
        }
        @media (max-width: 780px) {
          .pretext-page {
            background: linear-gradient(180deg, #101a24 0%, #203d49 42%, #e8e2d5 42%, #f2eee6 100%);
          }
          .pretext-shell {
            min-height: auto;
            padding-top: 24px;
          }
          .pretext-top {
            align-items: flex-end;
          }
          .pretext-top h1 {
            font-size: clamp(42px, 14vw, 70px);
          }
          .pretext-workbench {
            grid-template-columns: 1fr;
          }
          .pretext-controls {
            grid-template-columns: repeat(3, minmax(74px, 1fr));
            order: 2;
          }
          .pretext-controls label {
            grid-column: span 3;
          }
          .pretext-stage {
            min-height: 380px;
            padding: 18px;
          }
          .pretext-line {
            left: 18px;
          }
        }
        @media (max-width: 460px) {
          .pretext-top {
            flex-direction: column;
            align-items: stretch;
          }
          .pretext-play {
            width: 100%;
          }
          .pretext-controls {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .pretext-controls label {
            grid-column: span 2;
          }
          .pretext-actions button {
            flex: 1 1 94px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretext-line,
          .pretext-word {
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}
