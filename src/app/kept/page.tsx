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

export default function KeptPage() {
  const kept = useField((s) => s.keptReadings);
  const loadFromStorage = useField((s) => s.loadFromStorage);
  const forgetReading = useField((s) => s.forgetReading);
  const recordTape = useField((s) => s.recordTape);
  const [selected, setSelected] = useState<string[]>([]);
  const [playingHash, setPlayingHash] = useState<string | null>(null);
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

  return (
    <>
      <SiteHeader />
      <main>
        <section className="rule">
          <div className="wrap">
            <div className="t-eyebrow">kept · your trail of readings</div>
            <h2 className="t-h2 italic" style={{ marginTop: 12, marginBottom: 16 }}>
              every night you kept
            </h2>
            <p className="t-meta italic" style={{ color: "var(--ink-2)", maxWidth: "56ch", marginTop: 0 }}>
              readings live only in this browser. they are not posted, not synced — kept
              quietly until you forget them.
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
                  two readings selected — overlay them?
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
                  no readings kept yet. tune your compass, read the room, and keep one.
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
              <div
                style={{
                  marginTop: 40,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: 20,
                }}
              >
                {sorted.map((r) => {
                  const decoded = decodeReadingHash(r.hash);
                  const concerns = decoded?.concerns ??
                    BASE_CONCERNS;
                  const region = r.region ? REGIONS.find((x) => x.id === r.region) : null;
                  const obj = r.carriedObject ? OBJECTS.find((x) => x.id === r.carriedObject) : null;
                  const date = new Date(r.keptAt);
                  const isSelected = selected.includes(r.hash);
                  const selectionIndex = selected.indexOf(r.hash);
                  const isPlaying = playingHash === r.hash;
                  return (
                    <article
                      key={r.hash}
                      style={{
                        border: `1px solid ${isSelected ? "var(--ink)" : "var(--rule)"}`,
                        background: "var(--paper-2)",
                        padding: 18,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        transition: "border-color var(--t)",
                        outline: isSelected ? "1px solid var(--candle)" : "none",
                        outlineOffset: 2,
                        position: "relative",
                      }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--ink)"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--rule)"; }}
                    >
                      {isSelected && (
                        <span
                          className="t-mono"
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            right: 14,
                            bottom: 14,
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            border: "1px solid var(--candle)",
                            display: "grid",
                            placeItems: "center",
                            color: "var(--candle)",
                            fontSize: 12,
                            background: "var(--paper-2)",
                          }}
                        >
                          {selectionIndex + 1}
                        </span>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span className="t-eyebrow" suppressHydrationWarning>
                          {date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                        </span>
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <button
                            onClick={() => void playKept(r.hash, concerns, r.topConcern)}
                            disabled={Boolean(playingHash) && !isPlaying}
                            aria-label="play kept sigil"
                            className="t-mono"
                            style={{
                              background: "none",
                              border: "none",
                              cursor: playingHash && !isPlaying ? "default" : "pointer",
                              fontSize: 11,
                              color: isPlaying ? "var(--candle)" : "var(--ink-2)",
                              padding: 0,
                            }}
                          >
                            {isPlaying ? "playing" : "play"}
                          </button>
                          <button
                            onClick={() => toggleSelect(r.hash)}
                            aria-pressed={isSelected}
                            aria-label="select for compare"
                            className="t-mono"
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontSize: 11,
                              color: isSelected ? "var(--candle)" : "var(--ink-2)",
                              padding: 0,
                            }}
                          >
                            {isSelected ? "selected ◦" : "compare ↔"}
                          </button>
                          <button
                            onClick={() => forget(r.hash, r.headline)}
                            aria-label="forget"
                            className="t-mono"
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontSize: 11,
                              color: "var(--ink-2)",
                              padding: 0,
                            }}
                          >
                            forget
                          </button>
                        </div>
                      </div>
                      <Link
                        href={`/reading/${r.hash}`}
                        style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--ink)" }}
                      >
                        <ConcernSigil concerns={concerns} size={64} showAxes showDots={false} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="italic" style={{
                            fontFamily: "var(--font-serif)",
                            fontSize: 17,
                            lineHeight: 1.25,
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}>
                            {r.headline}
                          </div>
                        </div>
                      </Link>
                      <div className="t-eyebrow" style={{ color: "var(--ink-2)" }}>
                        {r.topConcern}{region ? ` · ${region.label.toLowerCase()}` : ""}{obj ? ` · ${obj.label.toLowerCase()}` : ""}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
