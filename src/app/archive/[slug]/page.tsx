"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ConcernSigil from "@/components/ConcernSigil";
import ShapedProse from "@/components/ShapedProse";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { findBySlug, neighbourSlug, entrySlug } from "@/lib/slug";
import { sigilPolygonPoints, polygonLeftEdgeAt, type ObstacleShape } from "@/lib/sigil-shape";
import { ARCHIVE_BODIES, bodyFor } from "@/data/archive-bodies";
import { REGIONS, OBJECTS, CONCERNS } from "@/data/content";
import { useField } from "@/store/field";
import type { ConcernKey } from "@/lib/types";

void ARCHIVE_BODIES; // re-export reference, prevents tree-shake stripping when unused

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function entryWeights(concerns: ConcernKey[]): Record<ConcernKey, number> {
  const m = Object.fromEntries(CONCERNS.map((c) => [c.id, 26])) as Record<ConcernKey, number>;
  concerns.forEach((c) => { m[c] = 84; });
  return m;
}

export default function ArchiveEntryPage() {
  // page-specific ambient bed: intimate page-turn room
  useEffect(() => { getFieldAudio().setAmbientProfile("entry"); }, []);

  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const a = findBySlug(slug);
  if (!a) notFound();

  const region = REGIONS.find((r) => r.id === a.region);
  const relatedObjects = (a.objects ?? []).map((id) => OBJECTS.find((o) => o.id === id)?.label).filter(Boolean) as string[];
  const nextSlug = neighbourSlug(slug, 1);
  const prevSlug = neighbourSlug(slug, -1);

  const statusColor =
    a.status === "kept" ? "var(--kept)" :
    a.status === "open" ? "var(--open)" :
    a.status === "closed" ? "var(--closed)" :
    "var(--ink-2)";
  const recordTape = useField((s) => s.recordTape);
  const [entryPulse, setEntryPulse] = useState<{ id: number; label: string; color: string } | null>(null);
  const pulseId = useRef(0);

  const markEntry = (
    label: string,
    kind: "reading" | "region" | "object" = "reading",
    intensity = 0.45,
    color = statusColor,
  ) => {
    const id = ++pulseId.current;
    haptics.ripple(intensity);
    recordTape(kind, intensity, `entry/${a.id}/${label.toLowerCase().replace(/\s+/g, "-")}`);
    setEntryPulse({ id, label, color });
    window.setTimeout(() => {
      setEntryPulse((prev) => (prev?.id === id ? null : prev));
    }, 2400);
  };

  // body content from the data file
  const bodyParagraphs = bodyFor(a.id);

  // sigil + shape-aware prose
  const wrapRef = useRef<HTMLDivElement>(null);
  const wrapWidth = useElementWidth(wrapRef);
  const isNarrow = wrapWidth > 0 && wrapWidth < 620;
  const sigilSize = isNarrow ? Math.min(220, wrapWidth - 40) : Math.min(320, wrapWidth * 0.38);
  const sigilLeftInWrap = wrapWidth - sigilSize;

  const polygonPoints = useMemo(
    () => sigilPolygonPoints(entryWeights(a.concerns), sigilSize),
    [a.concerns, sigilSize],
  );

  const obstacle: ObstacleShape | undefined = useMemo(() => {
    if (isNarrow || sigilSize <= 0) return undefined;
    return {
      top: 0,
      height: sigilSize,
      side: "right",
      edgeAt: (y: number) => {
        const xLocal = polygonLeftEdgeAt(polygonPoints, y);
        return xLocal === null ? null : sigilLeftInWrap + xLocal;
      },
      padding: 24,
    };
  }, [polygonPoints, sigilLeftInWrap, sigilSize, isNarrow]);

  return (
    <>
      <SiteHeader />
      <main>
        <section className="rule">
          <div className="wrap entry-wrap">
            <div className="t-eyebrow">
              {a.year ?? ""}{a.status ? ` · ` : ""}{a.status ?? ""}{` · ${a.medium}`}{` · ${a.phase}`}{a.concerns.length ? ` · ${a.concerns.join(" / ")}` : ""}
            </div>

            <h1
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 400,
                fontSize: "clamp(36px, 5vw, 56px)",
                lineHeight: 1.05,
                letterSpacing: 0,
                margin: "20px 0 14px",
              }}
            >
              {a.title}
            </h1>
            <p
              className="italic"
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 22,
                lineHeight: 1.35,
                color: "var(--ink-2)",
                marginTop: 0,
                marginBottom: 36,
                maxWidth: "44ch",
              }}
            >
              {a.fn}
            </p>

            {/* pull-quote from the note */}
            {a.note && (
              <div
                style={{
                  borderLeft: "2px solid var(--candle)",
                  paddingLeft: 18,
                  margin: "0 0 28px",
                  fontSize: 22,
                  lineHeight: 1.4,
                  fontStyle: "italic",
                  color: "var(--ink)",
                  fontFamily: "var(--font-serif)",
                  maxWidth: "48ch",
                }}
              >
                {a.note}
              </div>
            )}

            <div className="entry-memory-strip" aria-live="polite">
              <span>
                <i style={{ background: statusColor }} />
                {a.status ?? "open"}
              </span>
              <span>{region?.label.toLowerCase() ?? a.region}</span>
              <span>{a.concerns.length} concerns</span>
              <span>{relatedObjects[0]?.toLowerCase() ?? a.medium}</span>
              <span
                className={`entry-memory-pulse${entryPulse ? " is-lit" : ""}`}
                style={{
                  ["--entry-pulse-color" as string]: entryPulse?.color ?? statusColor,
                }}
              >
                {entryPulse?.label ?? "still"}
              </span>
            </div>

            {/* the body — prose flows around the entry's sigil */}
            <div ref={wrapRef} style={{ position: "relative", marginTop: 32 }}>
              {wrapWidth > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: sigilLeftInWrap,
                    top: 0,
                    width: sigilSize,
                    height: sigilSize,
                    pointerEvents: "none",
                    opacity: isNarrow ? 0 : 1,
                  }}
                >
                  <ConcernSigil
                    concerns={entryWeights(a.concerns)}
                    size={sigilSize}
                    showAxes
                    showDots={false}
                  />
                </div>
              )}

              {wrapWidth > 0 && (
                <ShapedProse
                  text={bodyParagraphs.length > 0 ? bodyParagraphs : ["this drawer is open. the note above is what remains of it for now."]}
                  lineHeight={32}
                  width={wrapWidth}
                  obstacle={obstacle}
                  paragraphGap={22}
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: 20,
                    color: "var(--ink)",
                  }}
                />
              )}

              {isNarrow && (
                <div style={{ display: "flex", justifyContent: "center", marginTop: 32 }}>
                  <button
                    type="button"
                    aria-label="touch drawer sigil"
                    onClick={() => markEntry("sigil", "object", 0.62, "var(--candle)")}
                    style={{
                      background: "transparent",
                      border: 0,
                      padding: 0,
                      color: "var(--ink)",
                      cursor: "pointer",
                    }}
                  >
                    <ConcernSigil concerns={entryWeights(a.concerns)} size={sigilSize} showAxes showDots={false} />
                  </button>
                </div>
              )}
            </div>

            {/* meta strip at the bottom */}
            <div
              style={{
                marginTop: 56,
                paddingTop: 22,
                borderTop: "1px solid var(--rule)",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 18,
              }}
            >
              <MetaRow label="year"    value={a.year ?? "—"} />
              <MetaRow label="status"  value={a.status ?? "—"} color={statusColor} />
              <MetaRow label="medium"  value={a.medium} />
              <MetaRow label="phase"   value={a.phase} />
              <MetaRow label="concern" value={a.concerns.join(" / ")} />
              {region && (
                <MetaRow
                  label="region"
                  value={
                    <Link
                      href={`/atlas/${region.id}`}
                      onPointerDown={() => markEntry("atlas", "region", 0.52, "var(--candle)")}
                      style={{ borderBottom: "1px solid var(--candle)" }}
                    >
                      {region.label.toLowerCase()}
                    </Link>
                  }
                />
              )}
              {relatedObjects.length > 0 && (
                <MetaRow label="objects" value={relatedObjects.map((s) => s.toLowerCase()).join(" / ")} />
              )}
            </div>

            <div className="entry-nav">
              <div style={{ display: "flex", gap: 18 }}>
                <Link
                  href="/archive"
                  className="t-mono"
                  onPointerDown={() => markEntry("all drawers", "reading", 0.38, "var(--ink-2)")}
                  style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "lowercase", color: "var(--ink-2)" }}
                >
                  ← all drawers
                </Link>
                {prevSlug && prevSlug !== slug && (
                  <Link
                    href={`/archive/${prevSlug}`}
                    className="t-mono"
                    onPointerDown={() => markEntry("previous", "reading", 0.42, "var(--ink-2)")}
                    style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "lowercase", color: "var(--ink-2)" }}
                  >
                    ← previous
                  </Link>
                )}
              </div>
              {nextSlug && (
                <Link
                  href={`/archive/${nextSlug}`}
                  className="t-mono"
                  onPointerDown={() => markEntry("next drawer", "reading", 0.56, "var(--candle)")}
                  style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "lowercase", color: "var(--ink)", borderBottom: "1px solid var(--candle)" }}
                >
                  next drawer →
                </Link>
              )}
            </div>
          </div>
        </section>
        <style
          dangerouslySetInnerHTML={{
            __html: `
          .entry-wrap {
            padding-bottom: calc(104px + env(safe-area-inset-bottom));
          }
          .entry-memory-strip {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px 14px;
            margin: 30px 0 4px;
            padding: 12px 0;
            border-top: 1px solid color-mix(in srgb, var(--rule), transparent 28%);
            border-bottom: 1px solid color-mix(in srgb, var(--rule), transparent 28%);
            color: var(--ink-2);
            font-family: var(--font-mono);
            font-size: 12px;
            letter-spacing: 0;
            text-transform: lowercase;
          }
          .entry-memory-strip span {
            display: inline-flex;
            align-items: center;
            min-height: 22px;
            gap: 7px;
          }
          .entry-memory-strip i {
            width: 7px;
            height: 7px;
            border-radius: 999px;
            box-shadow: 0 0 16px currentColor;
          }
          .entry-memory-pulse {
            margin-left: auto;
            color: var(--entry-pulse-color, var(--ink-2));
            max-width: 170px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .entry-memory-pulse::before {
            content: "";
            width: 36px;
            height: 1px;
            background: currentColor;
            opacity: 0.42;
          }
          .entry-memory-pulse.is-lit::before {
            height: 22px;
            width: 2px;
            opacity: 0.9;
            box-shadow: 0 0 18px currentColor;
            animation: entry-pulse-rise 2.4s ease both;
          }
          .entry-nav {
            margin-top: 36px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 12px;
            flex-wrap: wrap;
          }
          @keyframes entry-pulse-rise {
            0% { opacity: 0; transform: translateY(8px) scaleY(0.2); }
            18% { opacity: 1; transform: translateY(0) scaleY(1); }
            100% { opacity: 0.4; transform: translateX(-14px) scaleY(0.72); }
          }
          @media (max-width: 620px) {
            .entry-wrap {
              padding-bottom: calc(136px + env(safe-area-inset-bottom));
            }
            .entry-memory-strip {
              align-items: flex-start;
              margin-top: 24px;
            }
            .entry-memory-pulse {
              margin-left: 0;
              max-width: 100%;
              flex-basis: 100%;
            }
            .entry-nav,
            .entry-nav > div {
              flex-direction: column;
              align-items: flex-start;
              gap: 14px !important;
            }
          }
        `,
          }}
        />
      </main>
      <SiteFooter />
    </>
  );
}

function MetaRow({
  label, value, color,
}: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div>
      <div className="t-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div className="t-mono" style={{ fontSize: 13, color: color ?? "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}

// quiet the linter about unused export refs
void entrySlug;
