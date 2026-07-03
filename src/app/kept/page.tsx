"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useField } from "@/store/field";
import { getFieldAudio } from "@/lib/audio";
import { REGIONS, OBJECTS } from "@/data/content";
import { decodeReadingHash } from "@/lib/reading";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ConcernSigil from "@/components/ConcernSigil";
import type { ConcernKey } from "@/lib/types";

const BASE_CONCERNS = Object.fromEntries(
  ["memory", "work", "love", "prayer", "risk", "future", "body", "friendship"].map((k) => [k, 50]),
) as Record<ConcernKey, number>;

// Deterministic position on the sea, derived from the reading hash.
// (Same idea as KeptConstellation on the home sea, kept independent so
// that component stays untouched for its home usage.)
function hashToPos(hash: string): { x: number; y: number } {
  let h = 0;
  for (let i = 0; i < hash.length; i++) h = (h * 31 + hash.charCodeAt(i)) | 0;
  const a = Math.abs(h);
  const b = Math.abs((h * 2654435761) | 0);
  const x = (a % 10000) / 10000;
  const y = (b % 10000) / 10000;
  // keep stars off the very edges so their blooms have room to open
  return { x: 0.08 + x * 0.84, y: 0.16 + y * 0.62 };
}

export default function KeptPage() {
  const kept = useField((s) => s.keptReadings);
  const loadFromStorage = useField((s) => s.loadFromStorage);
  const forgetReading = useField((s) => s.forgetReading);
  const recordTape = useField((s) => s.recordTape);
  const [selected, setSelected] = useState<string[]>([]);
  const [playingHash, setPlayingHash] = useState<string | null>(null);
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);
  // page-specific ambient bed: held shelf and memory shimmer
  useEffect(() => { getFieldAudio().setAmbientProfile("kept"); }, []);

  const sorted = [...kept].sort((a, b) => b.keptAt - a.keptAt);

  const toggleSelect = (hash: string) => {
    const already = selected.includes(hash);
    const next = already
      ? selected.filter((h) => h !== hash)
      : selected.length >= 2
        ? [selected[1], hash]
        : [...selected, hash];
    setSelected(next);
    recordTape("sigil", already ? 0.35 : 0.72, already ? "kept/deselect" : `kept/select-${next.indexOf(hash) + 1}`);
    try {
      if (already) getFieldAudio().chime();
      else if (next.length === 2) getFieldAudio().bell();
      else getFieldAudio().spark();
    } catch { /* noop */ }
  };

  const playKept = async (
    hash: string,
    concerns: Record<ConcernKey, number>,
    topConcern: ConcernKey,
  ) => {
    if (playingHash) return;
    setPlayingHash(hash);
    recordTape("sigil", 0.85, `kept/${topConcern}`);
    try {
      await getFieldAudio().playSigilPhrase(concerns);
    } catch {
      getFieldAudio().refuse();
    } finally {
      setPlayingHash(null);
    }
  };

  const forget = (hash: string, headline: string) => {
    forgetReading(hash);
    setSelected((s) => s.filter((h) => h !== hash));
    setOpenHash((h) => (h === hash ? null : h));
    setStatus(`forgotten: ${headline}`);
    recordTape("kept", 0.35, "forget");
    getFieldAudio().thud();
    window.setTimeout(() => setStatus(null), 2200);
  };

  const clearSelection = () => {
    setSelected([]);
    setStatus("selection cleared");
    recordTape("sigil", 0.25, "kept/clear");
    getFieldAudio().chime();
    window.setTimeout(() => setStatus(null), 1400);
  };

  // positions of the two selected stars, for the constellation line
  const line =
    selected.length === 2
      ? { a: hashToPos(selected[0]), b: hashToPos(selected[1]) }
      : null;

  return (
    <>
      <SiteHeader />
      <main>
        <section className="rule">
          <div className="wrap">
            <div className="t-eyebrow">kept · your constellation of nights</div>
            <h2 className="t-h2 italic" style={{ marginTop: 12, marginBottom: 16 }}>
              every night you kept
            </h2>
            <p className="t-meta italic" style={{ color: "var(--ink-2)", maxWidth: "56ch", marginTop: 0 }}>
              readings live only in this browser. they are not posted, not synced — kept
              quietly, each a star on the water, until you forget them.
            </p>
            {status && (
              <p className="t-mono" style={{ color: "var(--candle)", fontSize: 12, letterSpacing: "0.06em", marginTop: 14 }}>
                {status}
              </p>
            )}

            {selected.length === 2 && (
              <div
                style={{
                  marginTop: 24,
                  padding: "14px 18px",
                  border: "1px solid var(--ink)",
                  background: "var(--paper-2)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <span className="t-meta" style={{ color: "var(--ink)" }}>
                  two stars joined — overlay their readings?
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={clearSelection}
                    className="t-mono"
                    style={{
                      background: "none",
                      border: "1px solid var(--rule)",
                      padding: "8px 14px",
                      cursor: "pointer",
                      fontSize: 12,
                      letterSpacing: "0.06em",
                      textTransform: "lowercase",
                      color: "var(--ink-2)",
                    }}
                  >
                    clear
                  </button>
                  <Link
                    href={`/compare?a=${selected[1]}&b=${selected[0]}`}
                    className="t-mono"
                    style={{
                      background: "var(--ink)",
                      border: "1px solid var(--ink)",
                      color: "var(--paper)",
                      padding: "8px 14px",
                      fontSize: 12,
                      letterSpacing: "0.06em",
                      textTransform: "lowercase",
                    }}
                  >
                    compare →
                  </Link>
                </div>
              </div>
            )}

            {sorted.length === 0 ? (
              <div
                style={{
                  marginTop: 56,
                  padding: "72px 24px 58px",
                  border: "1px dashed var(--rule)",
                  textAlign: "center",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: "20px 0 auto",
                    display: "flex",
                    justifyContent: "center",
                    opacity: 0.14,
                    color: "var(--sea)",
                    pointerEvents: "none",
                  }}
                >
                  <ConcernSigil concerns={BASE_CONCERNS} size={170} showAxes showRing showDots={false} />
                </div>
                <p
                  className="t-h3 italic"
                  style={{
                    color: "var(--ink-2)",
                    maxWidth: "32ch",
                    margin: "0 auto",
                    position: "relative",
                    zIndex: 1,
                  }}
                >
                  no readings kept yet. tune your compass, read the room, and keep one —
                  it will rise here as a star.
                </p>
                <Link
                  href="/"
                  className="t-mono"
                  style={{
                    marginTop: 24,
                    display: "inline-block",
                    fontSize: 13,
                    letterSpacing: "0.08em",
                    textTransform: "lowercase",
                    color: "var(--candle)",
                    borderBottom: "1px solid var(--candle)",
                    position: "relative",
                    zIndex: 1,
                  }}
                >
                  the room →
                </Link>
              </div>
            ) : (
              <>
                <div
                  className="kept-sky"
                  aria-label="your kept readings, as a constellation on the water"
                  style={{ marginTop: 40 }}
                >
                  {/* line joining two selected stars */}
                  {line && (
                    <svg
                      className="kept-line-layer"
                      aria-hidden="true"
                      preserveAspectRatio="none"
                      viewBox="0 0 100 100"
                    >
                      <line
                        className="kept-line"
                        x1={line.a.x * 100}
                        y1={line.a.y * 100}
                        x2={line.b.x * 100}
                        y2={line.b.y * 100}
                      />
                    </svg>
                  )}

                  {sorted.map((r, i) => {
                    const decoded = decodeReadingHash(r.hash);
                    const concerns = decoded?.concerns ?? BASE_CONCERNS;
                    const region = r.region ? REGIONS.find((x) => x.id === r.region) : null;
                    const obj = r.carriedObject ? OBJECTS.find((x) => x.id === r.carriedObject) : null;
                    const date = new Date(r.keptAt);
                    const isSelected = selected.includes(r.hash);
                    const selectionIndex = selected.indexOf(r.hash);
                    const isPlaying = playingHash === r.hash;
                    const isOpen = openHash === r.hash;
                    const p = hashToPos(r.hash);
                    const openLeft = p.x > 0.6;
                    const openUp = p.y > 0.52;

                    const cls = [
                      "kept-star",
                      isSelected ? "is-selected" : "",
                      isOpen ? "is-open" : "",
                    ].filter(Boolean).join(" ");

                    return (
                      <div
                        key={r.hash}
                        className={cls}
                        style={{
                          left: `${p.x * 100}%`,
                          top: `${p.y * 100}%`,
                          animationDelay: `${(i * 0.43) % 5}s`,
                        }}
                      >
                        <button
                          type="button"
                          className="kept-star-core"
                          aria-expanded={isOpen}
                          aria-label={`${r.headline} — open actions`}
                          onClick={() => setOpenHash((h) => (h === r.hash ? null : r.hash))}
                        >
                          <span className="kept-star-halo" aria-hidden="true" />
                          <span className="sigil-wrap">
                            <ConcernSigil
                              concerns={concerns}
                              size={26}
                              showRing={false}
                              showAxes={false}
                              showDots={false}
                              fill={isSelected ? "rgba(200,115,42,0.30)" : "rgba(244, 248, 252, 0.18)"}
                              stroke={isSelected ? "rgba(232,178,120,0.98)" : "rgba(244, 248, 252, 0.92)"}
                            />
                          </span>
                          {isSelected && (
                            <span className="kept-star-badge" aria-hidden="true">
                              {selectionIndex + 1}
                            </span>
                          )}
                        </button>

                        <div
                          className="kept-bloom"
                          style={{
                            top: openUp ? "auto" : "calc(50% + 20px)",
                            bottom: openUp ? "calc(50% + 20px)" : "auto",
                            left: "50%",
                            transform: `translateX(${openLeft ? "-88%" : "-12%"})`,
                          }}
                        >
                          <div className="kept-bloom-card">
                            <div className="kept-bloom-meta t-eyebrow" suppressHydrationWarning>
                              {date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                            </div>
                            <Link href={`/reading/${r.hash}`} className="kept-bloom-headline italic">
                              {r.headline}
                            </Link>
                            <div className="kept-bloom-tags t-eyebrow">
                              {r.topConcern}{region ? ` · ${region.label.toLowerCase()}` : ""}{obj ? ` · ${obj.label.toLowerCase()}` : ""}
                            </div>
                            <div className="kept-bloom-actions">
                              <button
                                type="button"
                                className="kept-act"
                                onClick={() => void playKept(r.hash, concerns, r.topConcern)}
                                disabled={Boolean(playingHash) && !isPlaying}
                                aria-label={`play the sigil phrase of ${r.headline}`}
                              >
                                {isPlaying ? "playing…" : "play"}
                              </button>
                              <button
                                type="button"
                                className={`kept-act ${isSelected ? "is-on" : ""}`}
                                onClick={() => toggleSelect(r.hash)}
                                aria-pressed={isSelected}
                                aria-label={isSelected ? `deselect ${r.headline}` : `select ${r.headline} to compare`}
                              >
                                {isSelected ? "selected ◦" : "compare ↔"}
                              </button>
                              <button
                                type="button"
                                className="kept-act"
                                onClick={() => forget(r.hash, r.headline)}
                                aria-label={`forget ${r.headline}`}
                              >
                                forget
                              </button>
                              <Link href={`/reading/${r.hash}`} className="kept-act kept-act--link">
                                open →
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <span className="kept-sky-cue t-eyebrow" aria-hidden="true">
                    each night is a star — open one, join two
                  </span>
                </div>

                {/* Secondary, linear fallback — always reachable, screen-reader friendly */}
                <details className="kept-list">
                  <summary className="t-mono">list of kept readings ({sorted.length})</summary>
                  <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 12 }}>
                    {sorted.map((r) => {
                      const decoded = decodeReadingHash(r.hash);
                      const concerns = decoded?.concerns ?? BASE_CONCERNS;
                      const region = r.region ? REGIONS.find((x) => x.id === r.region) : null;
                      const obj = r.carriedObject ? OBJECTS.find((x) => x.id === r.carriedObject) : null;
                      const date = new Date(r.keptAt);
                      const isSelected = selected.includes(r.hash);
                      const selectionIndex = selected.indexOf(r.hash);
                      const isPlaying = playingHash === r.hash;
                      return (
                        <li
                          key={r.hash}
                          style={{
                            border: `1px solid ${isSelected ? "var(--ink)" : "var(--rule)"}`,
                            background: "var(--paper-2)",
                            padding: 14,
                            display: "flex",
                            gap: 14,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <Link href={`/reading/${r.hash}`} style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--ink)", flex: "1 1 220px", minWidth: 0 }}>
                            <ConcernSigil concerns={concerns} size={48} showAxes showDots={false} />
                            <span style={{ minWidth: 0 }}>
                              <span className="t-eyebrow" style={{ color: "var(--ink-2)", display: "block" }} suppressHydrationWarning>
                                {date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                                {isSelected ? ` · selected ${selectionIndex + 1}` : ""}
                              </span>
                              <span className="italic" style={{ fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.25, display: "block" }}>
                                {r.headline}
                              </span>
                              <span className="t-eyebrow" style={{ color: "var(--ink-2)", display: "block" }}>
                                {r.topConcern}{region ? ` · ${region.label.toLowerCase()}` : ""}{obj ? ` · ${obj.label.toLowerCase()}` : ""}
                              </span>
                            </span>
                          </Link>
                          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="kept-act kept-act--paper"
                              onClick={() => void playKept(r.hash, concerns, r.topConcern)}
                              disabled={Boolean(playingHash) && !isPlaying}
                              aria-label={`play the sigil phrase of ${r.headline}`}
                            >
                              {isPlaying ? "playing…" : "play"}
                            </button>
                            <button
                              type="button"
                              className={`kept-act kept-act--paper ${isSelected ? "is-on" : ""}`}
                              onClick={() => toggleSelect(r.hash)}
                              aria-pressed={isSelected}
                              aria-label={isSelected ? `deselect ${r.headline}` : `select ${r.headline} to compare`}
                            >
                              {isSelected ? "selected ◦" : "compare ↔"}
                            </button>
                            <button
                              type="button"
                              className="kept-act kept-act--paper"
                              onClick={() => forget(r.hash, r.headline)}
                              aria-label={`forget ${r.headline}`}
                            >
                              forget
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />

      <style dangerouslySetInnerHTML={{ __html: `
        .kept-sky {
          position: relative;
          width: 100%;
          height: clamp(440px, 62vh, 640px);
          border: 1px solid var(--rule);
          overflow: hidden;
          isolation: isolate;
          background:
            radial-gradient(130% 90% at 50% -18%, #17323f 0%, #0d1e2b 52%, #081521 100%);
        }
        .kept-sky::after {
          /* faint horizon / undertow near the base */
          content: "";
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 42%;
          background: linear-gradient(to top, rgba(4,10,18,0.55), rgba(4,10,18,0));
          pointer-events: none;
          z-index: 1;
        }
        .kept-sky-cue {
          position: absolute;
          left: 18px;
          bottom: 16px;
          color: rgba(244,248,252,0.6);
          pointer-events: none;
          z-index: 4;
          text-shadow: 0 1px 8px rgba(0,0,0,0.4);
        }

        .kept-line-layer {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 2;
          pointer-events: none;
        }
        .kept-line {
          stroke: var(--candle);
          stroke-width: 0.5;
          stroke-dasharray: 2 2;
          vector-effect: non-scaling-stroke;
          opacity: 0.9;
          filter: drop-shadow(0 0 4px rgba(200,115,42,0.7));
          animation: kept-draw 900ms ease-out both, kept-flow 6s linear infinite;
        }

        .kept-star {
          position: absolute;
          transform: translate(-50%, -50%);
          z-index: 3;
          animation: kept-twinkle 4.6s ease-in-out infinite;
        }
        .kept-star:hover,
        .kept-star:focus-within,
        .kept-star.is-open,
        .kept-star.is-selected { z-index: 20; }

        .kept-star-core {
          appearance: none;
          -webkit-appearance: none;
          background: none;
          border: none;
          margin: 0;
          padding: 10px;
          min-width: 46px;
          min-height: 46px;
          display: grid;
          place-items: center;
          position: relative;
          cursor: pointer;
          border-radius: 50%;
          transition: transform 360ms cubic-bezier(.2,.7,.2,1);
        }
        .kept-star-core:focus-visible {
          outline: 2px solid var(--candle);
          outline-offset: 2px;
        }
        .sigil-wrap {
          display: inline-grid;
          place-items: center;
          transition: transform 360ms cubic-bezier(.2,.7,.2,1), filter 360ms ease;
          filter: drop-shadow(0 0 4px rgba(170, 210, 240, 0.45));
        }
        .kept-star-halo {
          position: absolute;
          left: 50%; top: 50%;
          width: 26px; height: 26px;
          margin: -13px 0 0 -13px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(244,248,252,0.24), rgba(244,248,252,0));
          transform: scale(1);
          opacity: 0.6;
          transition: transform 360ms cubic-bezier(.2,.7,.2,1), opacity 360ms ease;
          pointer-events: none;
        }
        .kept-star-badge {
          position: absolute;
          right: 0; top: 0;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: var(--candle);
          color: #0d1e2b;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          display: grid;
          place-items: center;
          box-shadow: 0 0 8px rgba(200,115,42,0.7);
        }

        .kept-star:hover .kept-star-core,
        .kept-star:focus-within .kept-star-core,
        .kept-star.is-open .kept-star-core { transform: scale(1.12); }
        .kept-star:hover .sigil-wrap,
        .kept-star:focus-within .sigil-wrap,
        .kept-star.is-open .sigil-wrap {
          transform: scale(1.9);
          filter: drop-shadow(0 0 14px rgba(220, 240, 255, 0.75));
        }
        .kept-star:hover .kept-star-halo,
        .kept-star:focus-within .kept-star-halo,
        .kept-star.is-open .kept-star-halo { transform: scale(2.6); opacity: 1; }

        .kept-star.is-selected .sigil-wrap {
          filter: drop-shadow(0 0 12px rgba(232,178,120,0.85));
        }
        .kept-star.is-selected .kept-star-halo {
          background: radial-gradient(circle, rgba(232,178,120,0.4), rgba(232,178,120,0));
          opacity: 1;
        }

        .kept-bloom {
          position: absolute;
          width: 216px;
          opacity: 0;
          pointer-events: none;
          z-index: 30;
          transition: opacity 280ms ease;
        }
        .kept-star:hover .kept-bloom,
        .kept-star:focus-within .kept-bloom,
        .kept-star.is-open .kept-bloom { opacity: 1; pointer-events: auto; }
        .kept-bloom-card {
          transform: translateY(6px);
          transition: transform 300ms cubic-bezier(.2,.7,.2,1);
          background: rgba(8, 18, 32, 0.9);
          border: 1px solid rgba(244,248,252,0.22);
          backdrop-filter: blur(7px);
          -webkit-backdrop-filter: blur(7px);
          padding: 13px 14px 12px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.45);
        }
        .kept-star:hover .kept-bloom-card,
        .kept-star:focus-within .kept-bloom-card,
        .kept-star.is-open .kept-bloom-card { transform: translateY(0); }

        .kept-bloom-meta { color: rgba(244,248,252,0.58); }
        .kept-bloom-headline {
          display: block;
          margin: 4px 0 6px;
          font-family: var(--font-serif);
          font-style: italic;
          font-size: 15px;
          line-height: 1.3;
          color: #F2EEE6;
          text-decoration: none;
        }
        .kept-bloom-headline:hover { text-decoration: underline; }
        .kept-bloom-tags { color: rgba(244,248,252,0.5); }
        .kept-bloom-actions {
          margin-top: 10px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .kept-act {
          appearance: none;
          -webkit-appearance: none;
          background: rgba(244,248,252,0.06);
          border: 1px solid rgba(244,248,252,0.22);
          color: rgba(244,248,252,0.9);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: lowercase;
          text-decoration: none;
          padding: 0 12px;
          min-height: 40px;
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          transition: background 200ms ease, border-color 200ms ease, color 200ms ease;
        }
        .kept-act:hover { background: rgba(244,248,252,0.14); border-color: rgba(244,248,252,0.5); }
        .kept-act:focus-visible { outline: 2px solid var(--candle); outline-offset: 2px; }
        .kept-act:disabled { opacity: 0.45; cursor: default; }
        .kept-act.is-on { color: var(--candle); border-color: var(--candle); }
        .kept-act--link { background: var(--candle); border-color: var(--candle); color: #0d1e2b; }
        .kept-act--link:hover { background: #d98338; border-color: #d98338; }

        .kept-list { margin-top: 22px; }
        .kept-list > summary {
          cursor: pointer;
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: lowercase;
          color: var(--ink-2);
          padding: 6px 0;
        }
        .kept-list > summary:hover { color: var(--ink); }
        .kept-act--paper {
          background: none;
          border: 1px solid var(--rule);
          color: var(--ink-2);
        }
        .kept-act--paper:hover { background: none; border-color: var(--ink); color: var(--ink); }
        .kept-act--paper.is-on { color: var(--candle); border-color: var(--candle); }

        @keyframes kept-twinkle {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.35); }
        }
        @keyframes kept-draw {
          from { stroke-dashoffset: 60; opacity: 0; }
          to { stroke-dashoffset: 0; opacity: 0.9; }
        }
        @keyframes kept-flow {
          to { stroke-dashoffset: -40; }
        }
        @media (prefers-reduced-motion: reduce) {
          .kept-star { animation: none; }
          .kept-line { animation: kept-draw 1ms linear both; }
        }
      ` }} />
    </>
  );
}
