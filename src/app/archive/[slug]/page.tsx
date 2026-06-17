"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ConcernSigil from "@/components/ConcernSigil";
import ShapedProse from "@/components/ShapedProse";
import { getFieldAudio } from "@/lib/audio";
import { findBySlug, neighbourSlug, entrySlug } from "@/lib/slug";
import { sigilPolygonPoints, polygonLeftEdgeAt, type ObstacleShape } from "@/lib/sigil-shape";
import { ARCHIVE_BODIES, bodyFor } from "@/data/archive-bodies";
import { REGIONS, OBJECTS, CONCERNS } from "@/data/content";
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
  // page-specific ambient bed: silent — entries read like prose
  useEffect(() => { getFieldAudio().setAmbientProfile("silent"); }, []);

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
          <div className="wrap">
            <div className="t-eyebrow">
              {a.year ?? ""}{a.status ? ` · ` : ""}{a.status ?? ""}{` · ${a.medium}`}{` · ${a.phase}`}{a.concerns.length ? ` · ${a.concerns.join(" / ")}` : ""}
            </div>

            <h1
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 400,
                fontSize: "clamp(36px, 5vw, 56px)",
                lineHeight: 1.05,
                letterSpacing: "-0.012em",
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
                  <ConcernSigil concerns={entryWeights(a.concerns)} size={sigilSize} showAxes showDots={false} />
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
                    <Link href={`/atlas/${region.id}`} style={{ borderBottom: "1px solid var(--candle)" }}>
                      {region.label.toLowerCase()}
                    </Link>
                  }
                />
              )}
              {relatedObjects.length > 0 && (
                <MetaRow label="objects" value={relatedObjects.map((s) => s.toLowerCase()).join(" / ")} />
              )}
            </div>

            <div style={{ marginTop: 36, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 18 }}>
                <Link href="/archive" className="t-mono" style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "lowercase", color: "var(--ink-2)" }}>
                  ← all drawers
                </Link>
                {prevSlug && prevSlug !== slug && (
                  <Link href={`/archive/${prevSlug}`} className="t-mono" style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "lowercase", color: "var(--ink-2)" }}>
                    ← previous
                  </Link>
                )}
              </div>
              {nextSlug && (
                <Link
                  href={`/archive/${nextSlug}`}
                  className="t-mono"
                  style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "lowercase", color: "var(--ink)", borderBottom: "1px solid var(--candle)" }}
                >
                  next drawer →
                </Link>
              )}
            </div>
          </div>
        </section>
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
