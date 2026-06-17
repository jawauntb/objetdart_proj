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

export default function KeptPage() {
  const kept = useField((s) => s.keptReadings);
  const loadFromStorage = useField((s) => s.loadFromStorage);
  const forgetReading = useField((s) => s.forgetReading);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);
  // page-specific ambient bed: silent — quiet shelf of past readings
  useEffect(() => { getFieldAudio().setAmbientProfile("silent"); }, []);

  const sorted = [...kept].sort((a, b) => b.keptAt - a.keptAt);

  const toggleSelect = (hash: string) => {
    setSelected((s) => {
      if (s.includes(hash)) return s.filter((h) => h !== hash);
      if (s.length >= 2) return [s[1], hash];
      return [...s, hash];
    });
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
                    onClick={() => setSelected([])}
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
                  padding: "60px 24px",
                  border: "1px dashed var(--rule)",
                  textAlign: "center",
                }}
              >
                <p className="t-h3 italic" style={{ color: "var(--ink-2)", maxWidth: "32ch", margin: "0 auto" }}>
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
                    (Object.fromEntries(["memory","work","love","prayer","risk","future","body","friendship"].map((k) => [k, 50])) as Record<ConcernKey, number>);
                  const region = r.region ? REGIONS.find((x) => x.id === r.region) : null;
                  const obj = r.carriedObject ? OBJECTS.find((x) => x.id === r.carriedObject) : null;
                  const date = new Date(r.keptAt);
                  const isSelected = selected.includes(r.hash);
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
                      }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--ink)"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--rule)"; }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span className="t-eyebrow" suppressHydrationWarning>
                          {date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                        </span>
                        <div style={{ display: "flex", gap: 12 }}>
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
                            onClick={() => forgetReading(r.hash)}
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
