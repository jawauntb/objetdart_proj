"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ConcernSigil from "@/components/ConcernSigil";
import { decodeReadingHash, buildReading, type ReadingInput } from "@/lib/reading";
import type { ConcernKey } from "@/lib/types";

const RADIAL_ORDER: ConcernKey[] = [
  "prayer", "future", "work", "risk", "body", "love", "memory", "friendship",
];

const BASE_CONCERNS = Object.fromEntries(
  RADIAL_ORDER.map((k) => [k, 50]),
) as Record<ConcernKey, number>;

function OverlayCompass({
  a,
  b,
  highlight,
}: {
  a: ReadingInput;
  b: ReadingInput;
  highlight?: ConcernKey | null;
}) {
  const SIZE = 460;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const rMax = SIZE * 0.40;

  const pointsFor = (concerns: Record<ConcernKey, number>) =>
    RADIAL_ORDER.map((k, i) => {
      const ang = -Math.PI / 2 + (i * Math.PI * 2) / 8;
      const r = ((concerns[k] ?? 50) / 100) * rMax;
      return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
    });

  const aPts = pointsFor(a.concerns);
  const bPts = pointsFor(b.concerns);

  return (
    <svg
      viewBox={`-70 -10 ${SIZE + 140} ${SIZE + 20}`}
      width="100%"
      style={{ display: "block", maxWidth: 620, height: "auto" }}
      aria-label="two compasses overlaid"
    >
      {/* rings */}
      {[0.25, 0.5, 0.75, 1].map((t, i) => (
        <circle key={i} cx={cx} cy={cy} r={t * rMax} fill="none" stroke="var(--rule)" />
      ))}
      <circle cx={cx} cy={cy} r={rMax * 0.5} fill="none" stroke="rgba(21,23,26,0.28)" strokeDasharray="3 4" />
      {/* axes */}
      {RADIAL_ORDER.map((k, i) => {
        const ang = -Math.PI / 2 + (i * Math.PI * 2) / 8;
        const active = highlight === k;
        return (
          <line
            key={k}
            x1={cx} y1={cy}
            x2={cx + Math.cos(ang) * rMax}
            y2={cy + Math.sin(ang) * rMax}
            stroke={active ? "var(--candle)" : "var(--rule)"}
            strokeWidth={active ? 2 : 1}
          />
        );
      })}

      {/* B polygon — sea-blue (the older/other) */}
      <polygon
        points={bPts.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="rgba(44, 74, 92, 0.18)"
        stroke="var(--sea)"
        strokeWidth={1.4}
      />
      {bPts.map((p, i) => (
        <circle key={`b-${i}`} cx={p.x} cy={p.y} r={3.4} fill="var(--sea)" />
      ))}

      {/* A polygon — candle (the focus / newer) */}
      <polygon
        points={aPts.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="rgba(200, 115, 42, 0.16)"
        stroke="var(--candle)"
        strokeWidth={1.6}
      />
      {aPts.map((p, i) => (
        <circle key={`a-${i}`} cx={p.x} cy={p.y} r={3.8} fill="var(--candle)" />
      ))}

      {/* axis labels */}
      {RADIAL_ORDER.map((k, i) => {
        const ang = -Math.PI / 2 + (i * Math.PI * 2) / 8;
        const lx = cx + Math.cos(ang) * (rMax + 26);
        const ly = cy + Math.sin(ang) * (rMax + 26);
        const active = highlight === k;
        const anchor =
          Math.abs(Math.cos(ang)) < 0.25 ? "middle" :
          Math.cos(ang) > 0 ? "start" : "end";
        return (
          <text
            key={`l-${k}`}
            x={lx} y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 14,
              fill: active ? "var(--candle)" : "var(--ink-2)",
              transition: "fill var(--t)",
            }}
          >
            {k}
          </text>
        );
      })}
    </svg>
  );
}

function ReadingColumn({
  input,
  color,
  label,
}: {
  input: ReadingInput;
  color: string;
  label: string;
}) {
  const r = buildReading(input);
  return (
    <div>
      <div
        className="t-eyebrow"
        style={{ color, marginBottom: 8 }}
      >
        <span style={{ display: "inline-block", width: 8, height: 8, background: color, marginRight: 8, verticalAlign: "middle" }} />
        {label}
      </div>
      <h3 className="t-h3 italic" style={{ marginTop: 0, marginBottom: 10, maxWidth: "26ch" }}>
        {r.headline}
      </h3>
      <p className="t-meta" style={{ color: "var(--ink)", marginTop: 0, marginBottom: 14 }}>
        {r.weights}
      </p>
      <p className="t-meta" style={{ color: "var(--ink-2)", margin: 0 }}>
        {r.regionPara}
      </p>
      <div style={{ marginTop: 14 }}>
        <Link
          href={`/reading/${r.hash}`}
          className="t-mono"
          style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "lowercase", borderBottom: `1px solid ${color}`, color: "var(--ink)" }}
        >
          step into this one →
        </Link>
      </div>
    </div>
  );
}

function CompareInner() {
  const params = useSearchParams();
  const recordTape = useField((s) => s.recordTape);
  const aHash = params?.get("a") ?? "";
  const bHash = params?.get("b") ?? "";
  const a = aHash ? decodeReadingHash(aHash) : null;
  const b = bHash ? decodeReadingHash(bHash) : null;
  const [playing, setPlaying] = useState<"a" | "b" | null>(null);
  const [highlight, setHighlight] = useState<ConcernKey | null>(null);

  // diff between the two — concerns delta
  const diff: { k: ConcernKey; d: number }[] | null = (a && b)
    ? RADIAL_ORDER.map((k) => ({ k, d: (a.concerns[k] ?? 50) - (b.concerns[k] ?? 50) }))
      .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
      .slice(0, 4)
    : null;

  const playInput = async (which: "a" | "b", input: ReadingInput) => {
    if (playing) return;
    setPlaying(which);
    recordTape("sigil", 0.85, `compare/${which}`);
    try {
      await getFieldAudio().playSigilPhrase(input.concerns);
    } catch {
      getFieldAudio().refuse();
    } finally {
      setPlaying(null);
    }
  };

  const pulseAxis = (k: ConcernKey, delta: number) => {
    setHighlight(k);
    recordTape("concern", Math.min(1, Math.abs(delta) / 80 + 0.25), `compare/${k}`);
    try {
      getFieldAudio().playNote(57 + RADIAL_ORDER.indexOf(k) * 2, 180);
    } catch { /* noop */ }
    window.setTimeout(() => {
      setHighlight((current) => (current === k ? null : current));
    }, 900);
  };

  return (
    <section className="rule" data-pretext-ignore="true">
      <div className="wrap">
        <div className="t-eyebrow">compare · two nights overlaid</div>
        <h2 className="t-h2 italic" style={{ marginTop: 12, marginBottom: 24 }}>
          two shapes, one room
        </h2>

        {!a || !b ? (
          <div
            style={{
              marginTop: 40,
              padding: "60px 24px",
              border: "1px dashed var(--rule)",
              textAlign: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 18,
                marginBottom: 22,
                opacity: 0.28,
                color: "var(--sea)",
              }}
            >
              <ConcernSigil concerns={BASE_CONCERNS} size={96} showAxes showRing showDots={false} />
              <ConcernSigil
                concerns={{ ...BASE_CONCERNS, prayer: 72, risk: 38, future: 68 }}
                size={96}
                showAxes
                showRing
                showDots={false}
                stroke="var(--candle)"
                fill="rgba(200,115,42,0.12)"
              />
            </div>
            <p className="t-h3 italic" style={{ color: "var(--ink-2)", maxWidth: "40ch", margin: "0 auto" }}>
              pick two readings to compare. open /kept and use the compare button on any pair.
            </p>
            <Link
              href="/kept"
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
              your kept readings →
            </Link>
          </div>
        ) : (
          <div
            className="compare-grid"
            style={{
              marginTop: 36,
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              columnGap: 56,
              rowGap: 32,
            }}
          >
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "center" }}>
              <OverlayCompass a={a} b={b} highlight={highlight} />
            </div>
            <div
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                justifyContent: "center",
                gap: 10,
                flexWrap: "wrap",
                marginTop: -12,
              }}
            >
              <button
                type="button"
                onClick={() => void playInput("a", a)}
                disabled={Boolean(playing) && playing !== "a"}
                className="t-mono"
                style={compareButton(playing === "a", "var(--candle)")}
              >
                {playing === "a" ? "playing a" : "play a sigil"}
              </button>
              <button
                type="button"
                onClick={() => void playInput("b", b)}
                disabled={Boolean(playing) && playing !== "b"}
                className="t-mono"
                style={compareButton(playing === "b", "var(--sea)")}
              >
                {playing === "b" ? "playing b" : "play b sigil"}
              </button>
            </div>
            <ReadingColumn input={a} color="var(--candle)" label="reading a" />
            <ReadingColumn input={b} color="var(--sea)" label="reading b" />

            {diff && (
              <div style={{ gridColumn: "1 / -1", marginTop: 20 }}>
                <div className="t-eyebrow">where they differ most</div>
                <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 8 }}>
                  {diff.map(({ k, d }) => (
                    <li key={k}>
                      <button
                        type="button"
                        onClick={() => pulseAxis(k, d)}
                        className="t-meta"
                        style={{
                          width: "100%",
                          border: `1px solid ${highlight === k ? "var(--candle)" : "var(--rule)"}`,
                          background: highlight === k ? "rgba(200,115,42,0.08)" : "transparent",
                          color: "var(--ink)",
                          padding: "9px 12px",
                          textAlign: "left",
                          cursor: "pointer",
                          transition: "border-color var(--t), background var(--t)",
                        }}
                      >
                        <span className="italic" style={{ fontFamily: "var(--font-serif)", fontSize: 17 }}>{k}</span>
                        <span style={{ marginLeft: 12, color: d > 0 ? "var(--candle)" : "var(--sea)" }}>
                          {d > 0 ? `+${d}` : d} {d > 0 ? "in a" : "in b"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <style>{`
          @media (max-width: 760px) {
            .compare-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </div>
    </section>
  );
}

function compareButton(active: boolean, color: string): React.CSSProperties {
  return {
    background: active ? "var(--paper-2)" : "transparent",
    border: `1px solid ${active ? color : "var(--rule)"}`,
    color: active ? color : "var(--ink)",
    padding: "10px 16px",
    cursor: active ? "default" : "pointer",
    fontSize: 12,
    letterSpacing: "0.06em",
    textTransform: "lowercase",
  };
}

export default function ComparePage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("compare"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Suspense fallback={null}>
          <CompareInner />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
