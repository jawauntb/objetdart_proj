"use client";

import {
  layoutNextLineRange,
  materializeLineRange,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import { useEffect, useMemo, useRef, useState } from "react";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import WaterText from "@/components/WaterText";
import { getFieldAudio } from "@/lib/audio";
import { useGeneratedSpeech } from "@/lib/useGeneratedSpeech";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";

type MotionMode = "move" | "shift" | "shake" | "quake" | "wave" | "sine";
type PretextMark = { id: number; label: string; tone: "water" | "ember" | "voice"; strength: number };

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

const AMP_MIN = 0;
const AMP_MAX = 42;
const DENSITY_MIN = 0.4;
const DENSITY_MAX = 3;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const STARTER_TEXT =
  "type a sentence and the room will make a coast of it. the words keep their measure, then loosen into wave, quake, shake, and sine. drag across the words to play them, or press play and the line becomes a small instrument.";

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
  const recordTape = useField((s) => s.recordTape);

  const [prompt, setPrompt] = useState("make this sentence into a playable tide");
  const [text, setText] = useState(STARTER_TEXT);
  const [font, setFont] = useState<string | null>(null);
  const [mode, setMode] = useState<MotionMode>("wave");
  const [playing, setPlaying] = useState(true);
  const [phase, setPhase] = useState(0);
  const [amp, setAmp] = useState(18);
  const [density, setDensity] = useState(1.2);
  const [status, setStatus] = useState("drag the words, or ask the room");
  const [generating, setGenerating] = useState(false);
  const [marks, setMarks] = useState<PretextMark[]>([]);
  const markIdRef = useRef(0);

  // Live mirrors so the direct-manipulation drag reads current values
  // without re-binding pointer handlers.
  const ampRef = useRef(amp);
  const densityRef = useRef(density);
  useEffect(() => { ampRef.current = amp; }, [amp]);
  useEffect(() => { densityRef.current = density; }, [density]);

  const dragRef = useRef({
    active: false,
    id: -1,
    x0: 0,
    y0: 0,
    amp0: 18,
    den0: 1.2,
    moved: 0,
    lastFx: 0,
  });

  const { speaking, speechStatus, setSpeechStatus, speakText, stopSpeech } = useGeneratedSpeech({
    context: "pretext wave page, playable sentence, oceanic text instrument",
    doneStatus: "voice complete",
  });

  const addMark = (label: string, tone: PretextMark["tone"] = "water", strength = 0.5) => {
    const id = ++markIdRef.current;
    setMarks((current) => [...current.slice(-4), { id, label, tone, strength }]);
    window.setTimeout(() => {
      setMarks((current) => current.filter((mark) => mark.id !== id));
    }, 4600);
  };

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
    haptics.roll();
    recordTape("sigil", 0.45, "pretext:ask");
    addMark("asking", "voice", 0.62);
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
      haptics.ripple(0.64);
      recordTape("sigil", 0.72, "pretext:generated");
      addMark("answered", "ember", 0.78);
    } catch {
      setText(localFallback(question));
      setSpeechStatus(null);
      setStatus("local fallback text");
      haptics.tap();
      recordTape("object", 0.38, "pretext:local");
      addMark("local", "water", 0.5);
    } finally {
      setGenerating(false);
    }
  };

  const speak = () => {
    haptics.roll();
    recordTape("sigil", 0.62, "pretext:voice");
    addMark(speaking ? "voice" : "speak", "voice", 0.72);
    void speakText(text);
  };

  const impulse = (nextMode: MotionMode) => {
    setMode(nextMode);
    setPlaying(true);
    if (nextMode === "shift") setPhase((value) => value + Math.PI * 0.55);
    if (nextMode === "shake") { setAmp(26); ampRef.current = 26; }
    if (nextMode === "quake") { setAmp(34); ampRef.current = 34; }
    if (nextMode === "move") { setAmp(14); ampRef.current = 14; }
    if (nextMode === "wave") { setAmp(20); ampRef.current = 20; }
    if (nextMode === "sine") { setAmp(18); ampRef.current = 18; }
    try { getFieldAudio().playNote(52 + MODES.findIndex((m) => m.key === nextMode) * 3, 130); } catch { /* noop */ }
    haptics.chop();
    recordTape("ripple", nextMode === "quake" ? 0.72 : 0.48, `pretext:${nextMode}`);
    addMark(nextMode, nextMode === "quake" || nextMode === "shake" ? "ember" : "water", 0.62);
  };

  const markControl = (label: string, value: string, strength = 0.42) => {
    haptics.tap();
    recordTape("object", strength, `pretext:${label}:${value}`);
    addMark(`${label} ${value}`, "water", strength);
  };

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    haptics.tap();
    try { if (next) getFieldAudio().chime(); else getFieldAudio().thud(); } catch { /* noop */ }
    recordTape("object", next ? 0.42 : 0.28, next ? "pretext:play" : "pretext:pause");
    addMark(next ? "play" : "pause", "water", next ? 0.52 : 0.42);
  };

  // Direct manipulation: dragging the words tunes the instrument.
  // Vertical drag drives amplitude, horizontal drag drives frequency.
  const tuneFromDrag = (clientX: number, clientY: number) => {
    const drag = dragRef.current;
    const el = stageRef.current;
    const w = el ? Math.max(1, el.clientWidth) : window.innerWidth || 1;
    const h = el ? Math.max(1, el.clientHeight) : window.innerHeight || 1;
    const dx = clientX - drag.x0;
    const dy = clientY - drag.y0;
    drag.moved += Math.abs(dx) + Math.abs(dy);

    // Drag up = more amplitude; a full stage height ≈ full amplitude sweep.
    const nextAmp = clamp(drag.amp0 - (dy / h) * (AMP_MAX - AMP_MIN) * 1.6, AMP_MIN, AMP_MAX);
    // Drag right = higher frequency across the stage width.
    const nextDensity = clamp(drag.den0 + (dx / w) * (DENSITY_MAX - DENSITY_MIN) * 1.4, DENSITY_MIN, DENSITY_MAX);

    const roundedAmp = Math.round(nextAmp);
    const roundedDen = Number(nextDensity.toFixed(2));
    ampRef.current = roundedAmp;
    densityRef.current = roundedDen;
    setAmp(roundedAmp);
    setDensity(roundedDen);

    const now = performance.now();
    if (now - drag.lastFx > 90) {
      drag.lastFx = now;
      try {
        getFieldAudio().playNote(
          46 + Math.round((nextAmp / AMP_MAX) * 20) + Math.round(nextDensity * 4),
          80,
        );
      } catch { /* noop */ }
      try { haptics.ripple(0.2 + (nextAmp / AMP_MAX) * 0.3); } catch { /* noop */ }
      recordTape("ripple", 0.3 + (nextAmp / AMP_MAX) * 0.4, "pretext:drag");
    }
  };

  const onStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    drag.active = true;
    drag.id = event.pointerId;
    drag.x0 = event.clientX;
    drag.y0 = event.clientY;
    drag.amp0 = ampRef.current;
    drag.den0 = densityRef.current;
    drag.moved = 0;
    drag.lastFx = 0;
    setPlaying(true);
    try { haptics.tap(); } catch { /* noop */ }
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
  };

  const onStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.id !== event.pointerId) return;
    tuneFromDrag(event.clientX, event.clientY);
  };

  const endStageDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag.id !== event.pointerId) return;
    const played = drag.moved > 8;
    drag.active = false;
    drag.id = -1;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    if (played) {
      addMark(`amp ${ampRef.current}`, "water", 0.44);
      setStatus(`amp ${ampRef.current} / freq ${densityRef.current.toFixed(2)}`);
    }
  };

  return (
    <div className="pretext-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={stageRef}
        className={`pretext-stage pretext-stage--${mode}`}
        style={{
          "--pretext-amp": `${amp}px`,
          "--pretext-phase": `${phase}`,
          "--pretext-density": `${density}`,
        } as React.CSSProperties}
        aria-label="Playable text field. Drag to bend the words: up and down for amplitude, left and right for frequency."
        aria-describedby="pretext-gesture-hint"
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={endStageDrag}
        onPointerCancel={endStageDrag}
      >
        <span ref={probeRef} className="pretext-probe">measure me</span>
        <div className="pretext-field" style={{ height: layout ? layout.height : undefined }} aria-live="polite">
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
      </div>

      <p id="pretext-gesture-hint" className="pretext-gesture-hint">
        drag <span aria-hidden="true">↔</span> frequency · <span aria-hidden="true">↕</span> amplitude
      </p>

      <div className="pretext-title" aria-hidden="true">
        <span>pretext / playable sentence</span>
        <strong>
          <WaterText as="span" bobAmp={2.5} maxDisplace={7}>
            tide
          </WaterText>
        </strong>
      </div>

      <div className="pretext-state-strip" aria-hidden="true">
        <span className="pretext-state-pulse" />
        {marks.length === 0 ? (
          <span className="pretext-state-idle">{mode}</span>
        ) : (
          marks.map((mark) => (
            <span
              key={mark.id}
              className={`pretext-state-mark pretext-state-${mark.tone}`}
              style={{ opacity: 0.42 + mark.strength * 0.48 }}
            >
              {mark.label}
            </span>
          ))
        )}
      </div>

      <label className="pretext-mode-chip">
        <span>motion ·</span>
        <select
          value={mode}
          aria-label="motion mode"
          onChange={(event) => impulse(event.target.value as MotionMode)}
        >
          {MODES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>

      <MobileInstrumentPanel
        title="compose & tune"
        triggerLabel="compose"
      >
        <form
          className="pretext-prompt"
          aria-label="ask the room"
          onSubmit={(event) => {
            event.preventDefault();
            generate();
          }}
        >
          <label htmlFor="pretext-prompt-input">prompt or text</label>
          <textarea
            id="pretext-prompt-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="write the sentence you want the room to bend"
            rows={2}
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
                haptics.ripple(0.44);
                recordTape("object", 0.46, "pretext:use-text");
                addMark("placed", "water", 0.5);
              }}
            >
              use text
            </button>
            <button type="button" onClick={speak}>
              {speaking ? "stop voice" : "speak"}
            </button>
          </div>
          <p className="t-mono pretext-status" aria-live="polite">{speechStatus ?? status}</p>
        </form>

        <div className="pretext-console" aria-label="text motion controls">
          <button type="button" className="pretext-run" onClick={togglePlay} aria-pressed={playing}>
            {playing ? "pause" : "play"}
          </button>
          <div className="pretext-modes" aria-label="motion modes">
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
          </div>
          <label className="pretext-slider">
            <span>amp</span>
            <strong>{amp}</strong>
            <input
              type="range"
              min={AMP_MIN}
              max={AMP_MAX}
              value={amp}
              onChange={(event) => { const v = Number(event.target.value); setAmp(v); ampRef.current = v; }}
              onPointerUp={() => markControl("amp", String(amp), 0.44)}
              onKeyUp={() => markControl("amp", String(amp), 0.38)}
            />
          </label>
          <label className="pretext-slider">
            <span>freq</span>
            <strong>{density.toFixed(2)}</strong>
            <input
              type="range"
              min={DENSITY_MIN}
              max={DENSITY_MAX}
              step="0.05"
              value={density}
              onChange={(event) => { const v = Number(event.target.value); setDensity(v); densityRef.current = v; }}
              onPointerUp={() => markControl("freq", density.toFixed(2), 0.42)}
              onKeyUp={() => markControl("freq", density.toFixed(2), 0.36)}
            />
          </label>
        </div>
      </MobileInstrumentPanel>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .pretext-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          overflow: hidden;
          background:
            radial-gradient(circle at 18% 14%, rgba(200,115,42,0.16), transparent 30%),
            linear-gradient(150deg, #0c141d 0%, #16303a 52%, #ecebe1 52%, #f3efe6 100%);
          color: #15171a;
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .pretext-stage {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background:
            repeating-linear-gradient(0deg, rgba(21,23,26,0.045) 0 1px, transparent 1px 50px),
            linear-gradient(180deg, rgba(12,20,29,0) 0%, rgba(12,20,29,0) 46%, rgba(242,238,230,0.0) 46%);
          color: #15171a;
          padding: clamp(18px, 4vw, 44px);
          touch-action: none;
          cursor: grab;
          z-index: 0;
        }
        .pretext-stage:active {
          cursor: grabbing;
        }
        .pretext-stage::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(90deg, rgba(44,74,92,0.10), transparent 34%, rgba(200,115,42,0.08)),
            radial-gradient(circle at 78% 24%, rgba(44,74,92,0.14), transparent 34%);
          pointer-events: none;
        }
        .pretext-field {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
        }
        .pretext-probe {
          position: absolute;
          left: -9999px;
          top: -9999px;
          visibility: hidden;
          font-family: var(--font-serif);
          font-size: clamp(28px, 4.4vw, 46px);
          font-style: italic;
          font-weight: 300;
        }
        .pretext-fallback,
        .pretext-line {
          font-family: var(--font-serif);
          font-size: clamp(28px, 4.4vw, 46px);
          font-style: italic;
          font-weight: 300;
          line-height: 1.12;
          letter-spacing: 0;
          color: rgba(24,30,36,0.92);
        }
        .pretext-fallback {
          position: relative;
          z-index: 1;
          margin: 0;
          padding: 0 clamp(18px, 4vw, 44px);
        }
        .pretext-line {
          position: absolute;
          z-index: 1;
          left: clamp(18px, 4vw, 44px);
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

        .pretext-title {
          position: fixed;
          z-index: 2;
          top: 72px;
          left: var(--pad-x);
          pointer-events: none;
        }
        .pretext-title span {
          display: block;
          margin-bottom: 6px;
          color: rgba(247,240,223,0.6);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0.02em;
          text-transform: lowercase;
        }
        .pretext-title strong {
          display: block;
          color: rgba(248,244,224,0.9);
          font-family: var(--font-serif);
          font-weight: 300;
          font-style: italic;
          font-size: clamp(52px, 9vw, 116px);
          line-height: 0.86;
          mix-blend-mode: overlay;
        }

        .pretext-gesture-hint {
          display: none;
          position: fixed;
          z-index: 2;
          left: 50%;
          bottom: 200px;
          margin: 0;
          padding: 8px 12px;
          border: 1px solid rgba(247,240,223,0.16);
          border-radius: 999px;
          background: rgba(7,15,23,0.42);
          color: rgba(247,240,223,0.62);
          font-family: var(--font-mono);
          font-size: 10px;
          line-height: 1;
          white-space: nowrap;
          pointer-events: none;
          transform: translateX(-50%);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        .pretext-state-strip {
          position: fixed;
          z-index: 3;
          top: 78px;
          right: var(--pad-x);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 7px;
          max-width: min(340px, 52vw);
          min-height: 31px;
          padding: 8px 12px;
          border: 1px solid rgba(247,240,223,0.16);
          border-radius: 999px;
          background: rgba(7,15,23,0.42);
          color: rgba(247,240,223,0.66);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          overflow: hidden;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          pointer-events: none;
        }
        .pretext-state-pulse {
          flex: 0 0 auto;
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: rgba(136,184,216,0.88);
          box-shadow: 0 0 14px rgba(136,184,216,0.44);
        }
        .pretext-state-idle,
        .pretext-state-mark {
          white-space: nowrap;
        }
        .pretext-state-water { color: rgba(174,218,233,0.86); }
        .pretext-state-ember { color: rgba(255,200,132,0.9); }
        .pretext-state-voice { color: rgba(242,238,230,0.82); }

        .pretext-mode-chip {
          display: none;
        }

        .pretext-prompt {
          position: fixed;
          z-index: 4;
          right: var(--pad-x);
          bottom: calc(122px + env(safe-area-inset-bottom, 0px));
          width: min(360px, calc(100vw - 2 * var(--pad-x)));
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          border: 1px solid rgba(247,240,223,0.14);
          border-radius: 10px;
          background: rgba(7,15,23,0.5);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 24px 60px rgba(0,0,0,0.32);
          color: rgba(247,240,223,0.92);
          pointer-events: auto;
        }
        .pretext-prompt label {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.04em;
          text-transform: lowercase;
          color: rgba(247,240,223,0.56);
        }
        .pretext-prompt textarea {
          width: 100%;
          resize: none;
          min-height: 52px;
          border: 1px solid rgba(247,240,223,0.18);
          border-radius: 6px;
          background: rgba(242,238,230,0.94);
          color: #15171a;
          padding: 10px;
          font-family: var(--font-serif);
          font-size: 17px;
          line-height: 1.32;
        }
        .pretext-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .pretext-actions button {
          flex: 1 1 84px;
          min-height: 44px;
          padding: 0 12px;
          border: 1px solid rgba(247,240,223,0.22);
          border-radius: 6px;
          background: rgba(247,240,223,0.06);
          color: inherit;
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.03em;
          text-transform: lowercase;
        }
        .pretext-actions button:disabled {
          cursor: default;
          opacity: 0.44;
        }
        .pretext-status {
          min-height: 14px;
          margin: 0;
          color: rgba(247,240,223,0.6);
          font-size: 11px;
        }

        .pretext-console {
          position: fixed;
          z-index: 4;
          left: var(--pad-x);
          right: var(--pad-x);
          bottom: calc(20px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: 92px minmax(0, 1.6fr) minmax(150px, 1fr) minmax(150px, 1fr);
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(247,240,223,0.13);
          border-radius: 10px;
          background: rgba(7,15,23,0.6);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 24px 70px rgba(0,0,0,0.36);
          pointer-events: auto;
        }
        .pretext-run,
        .pretext-slider {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(247,240,223,0.12);
          border-radius: 6px;
          background: rgba(247,240,223,0.055);
          color: rgba(247,240,223,0.9);
        }
        .pretext-run {
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 12px;
          text-transform: lowercase;
        }
        .pretext-run[aria-pressed="true"] {
          border-color: rgba(200,115,42,0.5);
          color: rgba(255,200,132,0.94);
        }
        .pretext-modes {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 6px;
        }
        .pretext-modes button {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(247,240,223,0.14);
          border-radius: 6px;
          background: rgba(247,240,223,0.05);
          color: rgba(247,240,223,0.82);
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.02em;
          text-transform: lowercase;
        }
        .pretext-modes button[aria-pressed="true"] {
          background: rgba(200,115,42,0.6);
          border-color: rgba(247,240,223,0.7);
          color: rgba(255,246,232,0.98);
        }
        .pretext-slider {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto 28px;
          gap: 4px 8px;
          align-items: center;
          padding: 7px 11px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: rgba(247,240,223,0.58);
        }
        .pretext-slider span {
          text-transform: lowercase;
          letter-spacing: 0.04em;
        }
        .pretext-slider strong {
          justify-self: end;
          color: rgba(255,200,132,0.94);
          font-family: var(--font-numerals, var(--font-mono));
          font-size: 13px;
          font-weight: 500;
        }
        .pretext-slider input {
          -webkit-appearance: none;
          appearance: none;
          grid-column: 1 / -1;
          width: 100%;
          height: 28px;
          margin: 0;
          background: transparent;
          accent-color: rgba(200,115,42,0.9);
          cursor: pointer;
        }
        .pretext-slider input::-webkit-slider-runnable-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(200,115,42,0.9), rgba(247,240,223,0.15));
        }
        .pretext-slider input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          margin-top: -6px;
          border: 0;
          border-radius: 4px;
          background: rgba(255,200,132,0.96);
          box-shadow: 0 0 14px rgba(200,115,42,0.7);
        }
        .pretext-slider input::-moz-range-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(200,115,42,0.9), rgba(247,240,223,0.15));
        }
        .pretext-slider input::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border: 0;
          border-radius: 4px;
          background: rgba(255,200,132,0.96);
          box-shadow: 0 0 14px rgba(200,115,42,0.7);
        }

        body:has(.pretext-page) {
          overflow: hidden;
          background: #0c141d;
        }
        body:has(.pretext-page) header:not(.oda-site-header) {
          display: none !important;
        }
        body:has(.pretext-page) .oda-field-watch,
        body:has(.pretext-page) .oda-candle-mark,
        body:has(.pretext-page) .oda-tape-shell,
        body:has(.pretext-page) .oda-sound-toggle {
          display: none !important;
        }

        @media (max-width: 940px) {
          .pretext-title {
            top: 30px;
            left: 22px;
          }
          .pretext-title strong {
            font-size: clamp(46px, 13vw, 74px);
          }
          .pretext-state-strip {
            top: 34px;
            right: 16px;
            max-width: min(200px, 46vw);
          }
          .pretext-prompt {
            left: 12px;
            right: 12px;
            width: auto;
            bottom: calc(214px + env(safe-area-inset-bottom, 0px));
          }
          .pretext-console {
            left: 10px;
            right: 10px;
            bottom: calc(10px + env(safe-area-inset-bottom, 0px));
            grid-template-columns: repeat(2, minmax(0, 1fr));
            max-height: min(46svh, 420px);
            overflow-y: auto;
          }
          .pretext-run {
            grid-column: 1 / -1;
          }
          .pretext-modes {
            grid-column: 1 / -1;
          }
        }
        @media (max-width: 520px) {
          .pretext-modes {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .pretext-slider {
            min-height: 52px;
          }
          .pretext-prompt textarea {
            font-size: 16px;
          }
        }
        @media (max-width: 720px) {
          .pretext-state-strip {
            top: 106px;
            right: 14px;
            max-width: min(180px, 48vw);
            min-height: 28px;
            padding: 7px 10px;
            font-size: 9px;
          }

          .pretext-gesture-hint {
            display: block;
            top: 148px;
            bottom: auto;
            padding: 7px 10px;
            font-size: 9px;
          }

          .pretext-mode-chip {
            position: fixed;
            z-index: 122;
            right: max(14px, env(safe-area-inset-right, 0px));
            bottom: calc(68px + env(safe-area-inset-bottom, 0px));
            min-height: 42px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(247,240,223,0.28);
            border-radius: 999px;
            padding: 0 13px;
            background: rgba(7,15,23,0.78);
            color: rgba(247,240,223,0.88);
            box-shadow: 0 12px 34px rgba(0,0,0,0.24);
            font-family: var(--font-mono);
            font-size: 9px;
            letter-spacing: 0.04em;
            text-transform: lowercase;
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
          }

          .pretext-mode-chip span {
            flex: none;
            color: rgba(247,240,223,0.54);
          }

          .pretext-mode-chip select {
            max-width: 88px;
            border: 0;
            padding: 6px 18px 6px 4px;
            color: inherit;
            background: transparent;
            font: inherit;
            text-transform: lowercase;
          }

          .mobile-instrument-panel__content > .pretext-console {
            margin-top: 10px !important;
          }

          .pretext-console {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }

          .pretext-run,
          .pretext-slider,
          .pretext-modes button {
            min-height: 48px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretext-line,
          .pretext-word {
            transform: none !important;
          }
        }
      `,
        }}
      />
    </div>
  );
}
