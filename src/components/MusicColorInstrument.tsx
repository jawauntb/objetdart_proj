"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import {
  formatHz,
  parseMusicScore,
  type ParsedMusicToken,
} from "@/lib/light-music";
import {
  exportMusicColorImage,
  type MusicColorExportKind,
} from "@/lib/music-color-export";
import { useField } from "@/store/field";

type MusicCell = Exclude<ParsedMusicToken, { kind: "invalid" }>;
type MusicNote = Extract<ParsedMusicToken, { kind: "note" }>;
type ExportedImages = Record<MusicColorExportKind, boolean>;

const DEFAULT_SCORE = "C4 D4 E4 G4 A4 G4 E4 D4\nC4 E4 G4 C5 B4 G4 E4 C4";
const EMPTY_EXPORTED: ExportedImages = { bar: false, matrix: false };

const SCORE_SAMPLES = [
  {
    label: "plain",
    value: DEFAULT_SCORE,
  },
  {
    label: "minor",
    value: "A3 C4 E4 A4 G4 E4 C4 A3\nF3 A3 C4 F4 E4 C4 A3 F3",
  },
  {
    label: "prism",
    value: "F#4/2 G4 A4 B4 C5 D5 E5 F#5/2\nrest G5 E5 C5 A4 F#4 D4 B3",
  },
] as const;

function isMusicCell(token: ParsedMusicToken): token is MusicCell {
  return token.kind !== "invalid";
}

function isMusicNote(token: MusicCell): token is MusicNote {
  return token.kind === "note";
}

function noteLabel(cell: MusicCell | null) {
  if (!cell) return "";
  if (cell.kind === "rest") return "rest";
  return cell.normalized;
}

function matrixLine(cell: MusicCell | null) {
  if (!cell) return "null";
  if (cell.kind === "rest") return "\"rest\"";
  return `"${cell.normalized} ${Math.round(cell.wavelength)}nm ${cell.color}"`;
}

function colorBandStyle(cell: MusicCell) {
  if (cell.kind === "rest") {
    return {
      background:
        "repeating-linear-gradient(90deg, rgba(238,232,218,0.14) 0 8px, rgba(238,232,218,0.03) 8px 16px)",
    };
  }

  return {
    background: `linear-gradient(180deg, rgba(255,255,255,0.28), ${cell.color} 36%, rgba(0,0,0,0.28))`,
    boxShadow: `0 0 22px ${cell.color}`,
  };
}

export default function MusicColorInstrument() {
  const [score, setScore] = useState(DEFAULT_SCORE);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState<ExportedImages>(EMPTY_EXPORTED);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const timersRef = useRef<number[]>([]);

  const parsed = useMemo(() => parseMusicScore(score), [score]);
  const cells = useMemo(() => parsed.filter(isMusicCell), [parsed]);
  const notes = useMemo(() => cells.filter(isMusicNote), [cells]);
  const invalid = useMemo(() => parsed.filter((token) => token.kind === "invalid"), [parsed]);
  const matrixSize = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, cells.length))));
  const dominantColor = notes[0]?.color ?? "#f5d65b";
  const totalDuration = cells.reduce((sum, cell) => sum + cell.duration, 0);
  const averageWavelength = notes.length
    ? notes.reduce((sum, note) => sum + note.wavelength, 0) / notes.length
    : 0;
  const exactCount = notes.filter((note) => note.exact).length;

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
      const durationMs = Math.max(120, cell.duration * 180);
      elapsed += durationMs;

      const timer = window.setTimeout(() => {
        setActiveIndex(index);
        if (cell.kind === "note") {
          try { audio.playTone(cell.frequency, Math.min(0.5, durationMs / 1000)); } catch { /* noop */ }
        }
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
                setCopied(false);
                setExported(EMPTY_EXPORTED);
              }}
              spellCheck={false}
              placeholder="C4 D4 E4 G4 A4 G4 E4 D4"
            />
            <div className="music-color-samples" aria-label="sample scores">
              {SCORE_SAMPLES.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => {
                    setScore(sample.value);
                    setCopied(false);
                    setExported(EMPTY_EXPORTED);
                    recordMusicColor(`sample/${sample.label}`, 0.36);
                  }}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          <div className="music-color-readout" aria-label="translation summary">
            <div>
              <span>notes</span>
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
              <span>center color</span>
              <strong>{averageWavelength ? `${Math.round(averageWavelength)} nm` : "--"}</strong>
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
                    cell.kind === "note"
                      ? `${cell.normalized} ${Math.round(cell.wavelength)} nanometers ${cell.color}`
                      : "rest"
                  }
                  title={cell.kind === "note" ? `${cell.normalized} ${cell.color}` : "rest"}
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
                  className={`music-color-cell ${cell?.kind === "rest" ? "is-rest" : ""} ${!cell ? "is-empty" : ""} ${activeIndex === index ? "is-active" : ""}`}
                  style={cell?.kind === "note" ? { "--cell-color": cell.color } as React.CSSProperties : undefined}
                >
                  {cell?.kind === "note" && (
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
        .music-color-actions button:disabled {
          cursor: default;
          opacity: 0.48;
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
