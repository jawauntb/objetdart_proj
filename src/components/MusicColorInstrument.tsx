"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import {
  formatHz,
  parseMusicInput,
  tonesForMusicToken,
  type ParsedMusicToken,
  type ParsedMusicTone,
} from "@/lib/light-music";
import {
  exportMusicColorImage,
  type MusicColorExportKind,
} from "@/lib/music-color-export";
import { useField } from "@/store/field";

type MusicCell = Exclude<ParsedMusicToken, { kind: "invalid" }>;
type ExportedImages = Record<MusicColorExportKind, boolean>;
type SheetImage = { data: string; mimeType: string; name: string };

const DEFAULT_SCORE = "tempo=104 time=4/4 key=C\nC4 D4 E4 G4 A4 G4 E4 D4\nC4 E4 G4 C5 B4 G4 E4 C4";
const EMPTY_EXPORTED: ExportedImages = { bar: false, matrix: false };

const SCORE_SAMPLES = [
  {
    label: "plain",
    value: DEFAULT_SCORE,
  },
  {
    label: "minor",
    value: "tempo=86 time=4/4 key=Amin\nA3 C4 E4 A4 G4 E4 C4 A3\nF3 A3 C4 F4 E4 C4 A3 F3",
  },
  {
    label: "chords",
    value: "tempo=92 time=3/4 key=C\n[C4 E4 G4]:2 [F4 A4 C5] G4\n[A3 C4 E4] rest [G3 B3 D4]:2 C4",
  },
  {
    label: "prism",
    value: "M:6/8\nQ:1/4=126\nK:D\nF#4/2 G4 A4 B4 C5 D5 E5 F#5/2\nrest G5 E5 C5 A4 F#4 D4 B3",
  },
] as const;

function isMusicCell(token: ParsedMusicToken): token is MusicCell {
  return token.kind !== "invalid";
}

function noteLabel(cell: MusicCell | null) {
  if (!cell) return "";
  if (cell.kind === "rest") return "rest";
  return cell.normalized;
}

function matrixLine(cell: MusicCell | null) {
  if (!cell) return "null";
  if (cell.kind === "rest") return "\"rest\"";
  if (cell.kind === "chord") {
    return `[${cell.notes.map((note) => `"${note.normalized} ${Math.round(note.wavelength)}nm ${note.color}"`).join(", ")}]`;
  }
  return `"${cell.normalized} ${Math.round(cell.wavelength)}nm ${cell.color}"`;
}

function tonesForCell(cell: MusicCell) {
  return tonesForMusicToken(cell);
}

function toneStops(tones: ParsedMusicTone[]) {
  return tones
    .map((tone, index) => {
      const start = (index / tones.length) * 100;
      const end = ((index + 1) / tones.length) * 100;
      return `${tone.color} ${start}% ${end}%`;
    })
    .join(", ");
}

function colorBandStyle(cell: MusicCell) {
  if (cell.kind === "rest") {
    return {
      background:
        "repeating-linear-gradient(90deg, rgba(238,232,218,0.14) 0 8px, rgba(238,232,218,0.03) 8px 16px)",
    };
  }

  const tones = tonesForCell(cell);
  if (tones.length > 1) {
    return {
      background: `linear-gradient(180deg, rgba(255,255,255,0.24), rgba(0,0,0,0.24)), linear-gradient(180deg, ${toneStops(tones)})`,
      boxShadow: `0 0 22px ${tones[0].color}`,
    };
  }

  return {
    background: `linear-gradient(180deg, rgba(255,255,255,0.28), ${cell.color} 36%, rgba(0,0,0,0.28))`,
    boxShadow: `0 0 22px ${cell.color}`,
  };
}

function cellBackground(cell: MusicCell) {
  if (cell.kind === "rest") return undefined;
  const tones = tonesForCell(cell);
  if (tones.length <= 1) return undefined;
  return `linear-gradient(180deg, rgba(255,255,255,0.22), transparent 32%), linear-gradient(180deg, ${toneStops(tones)})`;
}

function musicCellLabel(cell: MusicCell) {
  if (cell.kind === "rest") return "rest";
  const tones = tonesForCell(cell);
  return `${cell.normalized} ${tones.map((tone) => `${Math.round(tone.wavelength)} nanometers ${tone.color}`).join(", ")}`;
}

function metadataLabel(metadata: ReturnType<typeof parseMusicInput>["metadata"]) {
  const tempo = metadata.tempo ? `${Math.round(metadata.tempo)} bpm` : "120 bpm";
  const time = metadata.timeSignature ? `${metadata.timeSignature[0]}/${metadata.timeSignature[1]}` : "4/4";
  return `${tempo} / ${time}`;
}

export default function MusicColorInstrument() {
  const [score, setScore] = useState(DEFAULT_SCORE);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState<ExportedImages>(EMPTY_EXPORTED);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sheetImage, setSheetImage] = useState<SheetImage | null>(null);
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretStatus, setInterpretStatus] = useState("");
  const [interpretError, setInterpretError] = useState("");
  const timersRef = useRef<number[]>([]);

  const parsed = useMemo(() => parseMusicInput(score), [score]);
  const cells = useMemo(() => parsed.tokens.filter(isMusicCell), [parsed.tokens]);
  const notes = useMemo(() => cells.flatMap(tonesForCell), [cells]);
  const invalid = useMemo(() => parsed.tokens.filter((token) => token.kind === "invalid"), [parsed.tokens]);
  const matrixSize = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, cells.length))));
  const dominantColor = notes[0]?.color ?? "#f5d65b";
  const totalDuration = cells.reduce((sum, cell) => sum + cell.duration, 0);
  const beatMs = 60000 / (parsed.metadata.tempo ?? 120);
  const exactCount = notes.filter((note) => note.exact).length;
  const scoreMeta = metadataLabel(parsed.metadata);

  const matrixCells = useMemo(
    () => Array.from({ length: matrixSize * matrixSize }, (_, index) => cells[index] ?? null),
    [cells, matrixSize],
  );

  const matrixRows = useMemo(
    () => Array.from({ length: matrixSize }, (_, row) => matrixCells.slice(row * matrixSize, row * matrixSize + matrixSize)),
    [matrixCells, matrixSize],
  );

  const matrixText = useMemo(
    () => matrixRows.map((row) => `[${row.map(matrixLine).join(", ")}]`).join("\n"),
    [matrixRows],
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const clearTimers = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  };

  const recordMusicColor = (meta: string, intensity: number) => {
    useField.getState().recordTape("sigil", intensity, `music-color/${meta}`);
  };

  const resetGeneratedState = () => {
    setCopied(false);
    setExported(EMPTY_EXPORTED);
    setInterpretStatus("");
    setInterpretError("");
  };

  const handleSheetImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSheetImage(null);
      return;
    }

    try {
      const data = await readFileAsBase64(file);
      setSheetImage({ data, mimeType: file.type || "image/png", name: file.name });
      setInterpretStatus(file.name);
      setInterpretError("");
      recordMusicColor("image/ready", 0.34);
    } catch {
      setSheetImage(null);
      setInterpretStatus("");
      setInterpretError("image could not be read");
      try { getFieldAudio().refuse(); } catch { /* noop */ }
    }
  };

  const interpretInput = async () => {
    setIsInterpreting(true);
    setInterpretError("");
    setInterpretStatus("listening");

    try {
      const response = await fetch("/api/parse-music-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: score.trim(),
          image: sheetImage,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error ?? "could not read music");
      }

      setScore(payload.scoreText);
      setCopied(false);
      setExported(EMPTY_EXPORTED);
      setInterpretStatus(payload.model ? `${payload.model} normalized` : "normalized");
      recordMusicColor(`interpret/${payload.model ?? "local"}`, 0.66);
    } catch (error) {
      setInterpretError(error instanceof Error ? error.message : "could not read music");
      setInterpretStatus("");
      try { getFieldAudio().refuse(); } catch { /* noop */ }
    } finally {
      setIsInterpreting(false);
    }
  };

  const playScore = () => {
    clearTimers();
    setCopied(false);

    if (notes.length === 0) {
      try { getFieldAudio().refuse(); } catch { /* noop */ }
      recordMusicColor("empty", 0.24);
      return;
    }

    const audio = getFieldAudio();
    let elapsed = 0;
    setIsPlaying(true);
    recordMusicColor(`play/${notes.length}`, 0.72);

    cells.forEach((cell, index) => {
      const delay = elapsed;
      const durationMs = Math.max(120, cell.duration * beatMs);
      elapsed += durationMs;

      const timer = window.setTimeout(() => {
        setActiveIndex(index);
        tonesForCell(cell).forEach((tone) => {
          try { audio.playTone(tone.frequency, Math.min(1.2, durationMs / 1000)); } catch { /* noop */ }
        });
      }, delay);
      timersRef.current.push(timer);
    });

    const doneTimer = window.setTimeout(() => {
      setActiveIndex(null);
      setIsPlaying(false);
    }, elapsed + 180);
    timersRef.current.push(doneTimer);
  };

  const copyMatrix = async () => {
    try {
      await navigator.clipboard.writeText(matrixText);
      setCopied(true);
      recordMusicColor(`copy/${matrixSize}`, 0.4);
    } catch {
      setCopied(false);
      try { getFieldAudio().refuse(); } catch { /* noop */ }
    }
  };

  const exportImage = async (kind: MusicColorExportKind) => {
    if (cells.length === 0) {
      try { getFieldAudio().refuse(); } catch { /* noop */ }
      recordMusicColor(`export/${kind}/empty`, 0.22);
      return;
    }

    try {
      await exportMusicColorImage({ kind, cells, matrixRows, matrixSize, totalDuration });
      setExported((current) => ({ ...current, [kind]: true }));
      recordMusicColor(`export/${kind}/${cells.length}`, 0.5);
    } catch {
      setExported((current) => ({ ...current, [kind]: false }));
      try { getFieldAudio().refuse(); } catch { /* noop */ }
    }
  };

  return (
    <div
      className="music-color-page"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--mc-accent": dominantColor } as React.CSSProperties}
    >
      <section className="music-color-shell">
        <header className="music-color-hero">
          <div>
            <p className="t-eyebrow">light / inverse translator</p>
            <h1>Music becomes visible color.</h1>
          </div>
          <Link className="music-color-return" href="/light">
            light to sound
          </Link>
        </header>

        <section className="music-color-workbench" aria-label="music note input and score stats">
          <div className="music-color-score">
            <label className="t-eyebrow" htmlFor="music-color-score">
              score
            </label>
            <textarea
              id="music-color-score"
              value={score}
              onChange={(event) => {
                setScore(event.target.value);
                resetGeneratedState();
              }}
              spellCheck={false}
              placeholder={"tempo=120 time=4/4 key=C\nC4 D4 E4 [G4 B4 D5] rest"}
            />
            <div className="music-color-samples" aria-label="sample scores">
              {SCORE_SAMPLES.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => {
                    setScore(sample.value);
                    resetGeneratedState();
                    recordMusicColor(`sample/${sample.label}`, 0.36);
                  }}
                >
                  {sample.label}
                </button>
              ))}
            </div>
            <div className="music-color-intake" aria-label="music interpretation input">
              <label className="music-color-upload">
                <input type="file" accept="image/*" onChange={(event) => void handleSheetImage(event)} />
                <span>{sheetImage?.name ?? "sheet image"}</span>
              </label>
              <button
                type="button"
                onClick={() => void interpretInput()}
                disabled={isInterpreting || (!score.trim() && !sheetImage)}
              >
                {isInterpreting ? "reading" : "interpret"}
              </button>
            </div>
            {(interpretStatus || interpretError) && (
              <p className={`music-color-status ${interpretError ? "is-error" : ""}`}>
                {interpretError || interpretStatus}
              </p>
            )}
          </div>

          <div className="music-color-readout" aria-label="translation summary">
            <div>
              <span>tones</span>
              <strong>{notes.length}</strong>
            </div>
            <div>
              <span>matrix</span>
              <strong>{matrixSize} x {matrixSize}</strong>
            </div>
            <div>
              <span>bridge fit</span>
              <strong>{notes.length ? `${exactCount}/${notes.length}` : "0/0"}</strong>
            </div>
            <div>
              <span>time</span>
              <strong>{scoreMeta}</strong>
            </div>
          </div>
        </section>

        {invalid.length > 0 && (
          <p className="music-color-invalid">
            skipped {invalid.map((token) => token.raw).join(", ")}
          </p>
        )}

        <section className="music-color-actions" aria-label="score actions">
          <button type="button" onClick={playScore} disabled={isPlaying}>
            {isPlaying ? "playing" : "play notes"}
          </button>
          <button type="button" onClick={copyMatrix}>
            {copied ? "copied" : "copy matrix"}
          </button>
          <button type="button" onClick={() => void exportImage("bar")} disabled={cells.length === 0}>
            {exported.bar ? "bar saved" : "export bar"}
          </button>
          <button type="button" onClick={() => void exportImage("matrix")} disabled={cells.length === 0}>
            {exported.matrix ? "matrix saved" : "export matrix"}
          </button>
          <output>{totalDuration.toFixed(totalDuration >= 10 ? 0 : 1)} beats</output>
        </section>

        <section className="music-color-bar" aria-label="long color bar chart">
          <div className="music-color-bar-frame">
            <div className="music-color-bar-track">
              {cells.map((cell, index) => (
                <span
                  key={`${cell.raw}-${index}`}
                  className={activeIndex === index ? "is-active" : undefined}
                  style={{
                    ...colorBandStyle(cell),
                    flexGrow: cell.duration,
                    flexBasis: `${Math.max(34, cell.duration * 54)}px`,
                  }}
                  aria-label={
                    musicCellLabel(cell)
                  }
                  title={cell.kind === "rest" ? "rest" : `${cell.normalized} ${cell.color}`}
                >
                  <em>{noteLabel(cell)}</em>
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="music-color-output" aria-label="matrix output">
          <div className="music-color-matrix-frame">
            <div
              className="music-color-matrix"
              style={{
                "--matrix-size": matrixSize,
                minWidth: `${matrixSize * 86}px`,
              } as React.CSSProperties}
            >
              {matrixCells.map((cell, index) => (
                <div
                  key={index}
                  className={`music-color-cell ${cell?.kind === "rest" ? "is-rest" : ""} ${cell?.kind === "chord" ? "is-chord" : ""} ${!cell ? "is-empty" : ""} ${activeIndex === index ? "is-active" : ""}`}
                  style={cell && cell.kind !== "rest" ? {
                    "--cell-color": cell.color,
                    background: cellBackground(cell),
                  } as React.CSSProperties : undefined}
                >
                  {(cell?.kind === "note" || cell?.kind === "chord") && (
                    <>
                      <strong>{cell.normalized}</strong>
                      <span>{Math.round(cell.wavelength)} nm</span>
                      <small>{cell.color}</small>
                    </>
                  )}
                  {cell?.kind === "rest" && <strong>rest</strong>}
                </div>
              ))}
            </div>
          </div>

          <pre className="music-color-printout" aria-label="matrix printout">
            {matrixText}
          </pre>
        </section>

        {notes[0] && (
          <footer className="music-color-footer">
            <span>{notes[0].normalized}</span>
            <span>{formatHz(notes[0].frequency)}</span>
            <span>2^{notes[0].bridgeDivisor}</span>
            <span>{Math.round(notes[0].wavelength)} nm</span>
          </footer>
        )}
      </section>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .music-color-page {
          min-height: 100vh;
          background:
            linear-gradient(90deg, rgba(216,58,46,0.12), rgba(245,214,91,0.09), rgba(79,202,117,0.10), rgba(69,184,232,0.10), rgba(154,99,238,0.12)),
            linear-gradient(180deg, #07090d 0%, #101113 46%, #050607 100%);
          color: rgba(245, 240, 230, 0.94);
          overflow-x: hidden;
        }
        body:has(.music-color-page) .oda-field-watch,
        body:has(.music-color-page) .oda-candle-mark,
        body:has(.music-color-page) .oda-tape-shell,
        body:has(.music-color-page) .oda-sound-toggle {
          display: none !important;
        }
        .music-color-shell {
          width: min(1180px, calc(100vw - var(--pad-x) * 2));
          margin: 0 auto;
          padding: 30px 0 calc(70px + env(safe-area-inset-bottom, 0px));
        }
        .music-color-shell section {
          padding: 0;
        }
        .music-color-hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: end;
          gap: 18px;
          padding-bottom: 18px;
          border-bottom: 1px solid rgba(245, 240, 230, 0.16);
        }
        .music-color-hero .t-eyebrow,
        .music-color-score .t-eyebrow {
          color: rgba(245, 240, 230, 0.58);
          letter-spacing: 0;
        }
        .music-color-hero h1 {
          max-width: 760px;
          margin: 0;
          font-family: var(--font-serif);
          font-size: 74px;
          line-height: 0.94;
          font-weight: 300;
          letter-spacing: 0;
        }
        .music-color-return {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 14px;
          border: 1px solid rgba(245, 240, 230, 0.22);
          border-radius: 4px;
          color: rgba(245, 240, 230, 0.82);
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
          background: rgba(7, 9, 13, 0.48);
        }
        .music-color-workbench {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(290px, 0.65fr);
          gap: 18px;
          padding: 20px 0 14px;
        }
        .music-color-score textarea {
          display: block;
          width: 100%;
          min-height: 164px;
          margin-top: 8px;
          resize: vertical;
          border: 1px solid rgba(245, 240, 230, 0.18);
          border-radius: 6px;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.06), transparent),
            rgba(6, 8, 12, 0.74);
          color: rgba(245, 240, 230, 0.96);
          padding: 14px;
          font-family: var(--font-numerals);
          font-size: 16px;
          line-height: 1.55;
          letter-spacing: 0;
          outline: none;
        }
        .music-color-score textarea:focus {
          border-color: var(--mc-accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--mc-accent), transparent 72%);
        }
        .music-color-samples {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .music-color-samples button,
        .music-color-intake button,
        .music-color-upload,
        .music-color-actions button,
        .music-color-actions output {
          min-height: 44px;
          border: 1px solid rgba(245, 240, 230, 0.18);
          border-radius: 4px;
          background: rgba(7, 9, 13, 0.64);
          color: rgba(245, 240, 230, 0.88);
          padding: 0 13px;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
          cursor: pointer;
        }
        .music-color-intake {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(112px, auto);
          gap: 8px;
          margin-top: 10px;
        }
        .music-color-upload {
          position: relative;
          display: flex;
          align-items: center;
          min-width: 0;
        }
        .music-color-upload input {
          position: absolute;
          width: 1px;
          height: 1px;
          opacity: 0;
          pointer-events: none;
        }
        .music-color-upload span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .music-color-intake button:disabled,
        .music-color-actions button:disabled {
          cursor: default;
          opacity: 0.48;
        }
        .music-color-status {
          margin: 8px 0 0;
          color: rgba(245, 240, 230, 0.62);
          font-family: var(--font-text);
          font-size: 12px;
          line-height: 1.35;
        }
        .music-color-status.is-error {
          color: rgba(255, 173, 145, 0.86);
        }
        .music-color-readout {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1px;
          border: 1px solid rgba(245, 240, 230, 0.14);
          background: rgba(245, 240, 230, 0.12);
          align-self: stretch;
        }
        .music-color-readout div {
          min-height: 78px;
          display: grid;
          align-content: center;
          gap: 8px;
          padding: 14px;
          background: rgba(7, 9, 13, 0.74);
        }
        .music-color-readout span,
        .music-color-actions output {
          color: rgba(245, 240, 230, 0.56);
          font-family: var(--font-text);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }
        .music-color-readout strong {
          color: rgba(245, 240, 230, 0.98);
          font-family: var(--font-numerals);
          font-size: 24px;
          font-weight: 400;
          letter-spacing: 0;
          white-space: nowrap;
        }
        .music-color-invalid {
          margin: 0 0 14px;
          color: rgba(245, 240, 230, 0.62);
          font-family: var(--font-text);
          font-size: 12px;
          line-height: 1.4;
        }
        .music-color-actions {
          display: grid;
          grid-template-columns: repeat(5, minmax(118px, 1fr));
          gap: 8px;
          max-width: 820px;
          margin-bottom: 16px;
          padding-top: 0;
          padding-bottom: 0;
        }
        .music-color-actions output {
          display: grid;
          place-items: center;
          cursor: default;
        }
        .music-color-bar {
          border-top: 1px solid rgba(245, 240, 230, 0.16);
          border-bottom: 1px solid rgba(245, 240, 230, 0.16);
          padding: 16px 0;
        }
        .music-color-bar-frame {
          overflow-x: auto;
          overflow-y: hidden;
          padding-bottom: 2px;
        }
        .music-color-bar-track {
          min-width: 760px;
          height: 138px;
          display: flex;
          align-items: stretch;
          gap: 3px;
        }
        .music-color-bar-track span {
          position: relative;
          min-width: 34px;
          border: 1px solid rgba(255,255,255,0.12);
          display: flex;
          align-items: end;
          justify-content: center;
          padding: 8px 2px;
          opacity: 0.84;
          transition: opacity var(--t), transform var(--t), border-color var(--t);
        }
        .music-color-bar-track span.is-active {
          opacity: 1;
          transform: translateY(-4px);
          border-color: rgba(255,255,255,0.72);
        }
        .music-color-bar-track em {
          writing-mode: vertical-rl;
          transform: rotate(180deg);
          color: rgba(255,255,255,0.88);
          font-family: var(--font-numerals);
          font-size: 12px;
          font-style: normal;
          line-height: 1;
          letter-spacing: 0;
          text-shadow: 0 1px 8px rgba(0,0,0,0.55);
        }
        .music-color-output {
          display: grid;
          grid-template-columns: minmax(0, 0.72fr) minmax(320px, 0.28fr);
          gap: 18px;
          padding-top: 18px;
        }
        .music-color-matrix-frame {
          overflow-x: auto;
          border: 1px solid rgba(245, 240, 230, 0.14);
          background: rgba(245, 240, 230, 0.08);
        }
        .music-color-matrix {
          display: grid;
          grid-template-columns: repeat(var(--matrix-size), minmax(0, 1fr));
          gap: 1px;
        }
        .music-color-cell {
          aspect-ratio: 1;
          min-height: 84px;
          display: grid;
          align-content: end;
          gap: 4px;
          padding: 8px;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.22), transparent 32%),
            var(--cell-color, rgba(245,240,230,0.08));
          color: white;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: inset 0 -24px 44px rgba(0,0,0,0.24);
          transition: transform var(--t), border-color var(--t), box-shadow var(--t);
        }
        .music-color-cell.is-active {
          transform: scale(0.96);
          border-color: rgba(255,255,255,0.88);
          box-shadow: inset 0 -24px 44px rgba(0,0,0,0.18), 0 0 24px var(--cell-color, rgba(245,240,230,0.2));
        }
        .music-color-cell.is-rest {
          background:
            repeating-linear-gradient(135deg, rgba(245,240,230,0.16) 0 9px, rgba(245,240,230,0.04) 9px 18px),
            rgba(7, 9, 13, 0.7);
          color: rgba(245, 240, 230, 0.66);
        }
        .music-color-cell.is-chord strong {
          font-size: 18px;
          line-height: 1.05;
        }
        .music-color-cell.is-empty {
          background: rgba(245,240,230,0.04);
          box-shadow: none;
        }
        .music-color-cell strong,
        .music-color-cell span,
        .music-color-cell small {
          display: block;
          min-width: 0;
          overflow-wrap: anywhere;
          text-shadow: 0 1px 8px rgba(0,0,0,0.55);
        }
        .music-color-cell strong {
          font-family: var(--font-serif);
          font-size: 26px;
          line-height: 1;
          font-weight: 300;
          letter-spacing: 0;
        }
        .music-color-cell span,
        .music-color-cell small {
          font-family: var(--font-numerals);
          font-size: 11px;
          line-height: 1.1;
          letter-spacing: 0;
        }
        .music-color-printout {
          margin: 0;
          min-height: 260px;
          max-height: 520px;
          overflow: auto;
          border: 1px solid rgba(245, 240, 230, 0.14);
          border-radius: 0;
          background: rgba(7, 9, 13, 0.76);
          color: rgba(245, 240, 230, 0.82);
          padding: 14px;
          font-family: var(--font-numerals);
          font-size: 12px;
          line-height: 1.55;
          white-space: pre;
        }
        .music-color-footer {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding-top: 14px;
          color: rgba(245, 240, 230, 0.62);
          font-family: var(--font-numerals);
          font-size: 12px;
          letter-spacing: 0;
        }
        .music-color-footer span {
          min-height: 28px;
          display: inline-flex;
          align-items: center;
          border: 1px solid rgba(245, 240, 230, 0.14);
          padding: 0 9px;
          background: rgba(7, 9, 13, 0.5);
        }
        @media (max-width: 920px) {
          .music-color-hero h1 {
            font-size: 54px;
          }
          .music-color-workbench,
          .music-color-output {
            grid-template-columns: 1fr;
          }
          .music-color-readout {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
        @media (max-width: 620px) {
          .music-color-shell {
            width: min(100vw - 24px, 1180px);
            padding-top: 18px;
          }
          .music-color-hero {
            grid-template-columns: 1fr;
            align-items: start;
          }
          .music-color-hero h1 {
            font-size: 40px;
            line-height: 0.98;
          }
          .music-color-return {
            justify-self: start;
          }
          .music-color-workbench {
            gap: 12px;
            padding-top: 14px;
          }
          .music-color-score textarea {
            min-height: 140px;
            font-size: 15px;
          }
          .music-color-readout {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .music-color-readout div {
            min-height: 66px;
            padding: 11px;
          }
          .music-color-readout strong {
            font-size: 19px;
          }
          .music-color-actions {
            max-width: none;
            grid-template-columns: 1fr 1fr;
          }
          .music-color-intake {
            grid-template-columns: 1fr;
          }
          .music-color-actions output {
            grid-column: 1 / -1;
          }
          .music-color-bar-track {
            min-width: 620px;
            height: 112px;
          }
          .music-color-output {
            gap: 12px;
          }
          .music-color-printout {
            min-height: 190px;
            max-height: 300px;
          }
        }
      `,
        }}
      />
    </div>
  );
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}
