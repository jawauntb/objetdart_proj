"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useField } from "@/store/field";
import { getFieldAudio } from "@/lib/audio";
import { buildReading, type ReadingInput } from "@/lib/reading";
import { entrySlug } from "@/lib/slug";
import { sigilPolygonPoints, polygonLeftEdgeAt, type ObstacleShape } from "@/lib/sigil-shape";
import ConcernSigil from "@/components/ConcernSigil";
import Sigil from "@/components/Sigil";
import ShapedProse from "@/components/ShapedProse";

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

export default function SharedReading({ input }: { input: ReadingInput }) {
  const hydrate = useField((s) => s.hydrateFromHash);
  const recordTape = useField((s) => s.recordTape);
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);
  const reading = buildReading(input);

  const stepInto = () => {
    recordTape("reading", 0.75, `shared/${reading.region.id}`);
    getFieldAudio().bell();
    hydrate(reading.hash);
    if (typeof window !== "undefined") window.location.href = "/";
  };

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(
        `${typeof location !== "undefined" ? location.origin : ""}/reading/${reading.hash}`,
      );
      setCopied(true);
      recordTape("reading", 0.45, "shared/copy");
      setTimeout(() => setCopied(false), 1800);
    } catch { /* noop */ }
  };

  const playSigil = async () => {
    if (playing) return;
    setPlaying(true);
    recordTape("sigil", 0.9, `shared/${reading.top[0]}`);
    try {
      await getFieldAudio().playSigilPhrase(input.concerns);
    } catch {
      getFieldAudio().refuse();
    } finally {
      setPlaying(false);
    }
  };

  const wrapRef = useRef<HTMLDivElement>(null);
  const wrapWidth = useElementWidth(wrapRef);

  const isNarrow = wrapWidth > 0 && wrapWidth < 620;
  // larger sigil here — this view is about the sigil
  const sigilSize = isNarrow ? Math.min(240, wrapWidth - 40) : Math.min(340, wrapWidth * 0.38);
  const sigilLeftInWrap = wrapWidth - sigilSize;
  const sigilTop = 0;

  const polygonPoints = useMemo(
    () => sigilPolygonPoints(input.concerns, sigilSize),
    [input.concerns, sigilSize],
  );

  const obstacle: ObstacleShape | undefined = useMemo(() => {
    if (isNarrow || sigilSize <= 0) return undefined;
    return {
      top: sigilTop,
      height: sigilSize,
      side: "right",
      edgeAt: (y: number) => {
        const yLocal = y - sigilTop;
        const xLocal = polygonLeftEdgeAt(polygonPoints, yLocal);
        return xLocal === null ? null : sigilLeftInWrap + xLocal;
      },
      padding: 26,
    };
  }, [polygonPoints, sigilLeftInWrap, sigilTop, sigilSize, isNarrow]);

  return (
    <section className="rule" data-pretext-ignore="true">
      <div className="wrap" style={{ maxWidth: 960 }}>
        <div className="t-eyebrow">reading · kept by someone</div>

        <h1 className="t-h2 italic" style={{ marginTop: 14, marginBottom: 8, maxWidth: "26ch" }}>
          {reading.headline}
        </h1>
        <p className="t-body" style={{ color: "var(--ink-2)", marginTop: 0, marginBottom: 28 }}>
          this is someone&rsquo;s room as it was when they kept it. their compass tilted
          toward {reading.top[0]}; their territory was{" "}
          <span className="italic">{reading.region.label.toLowerCase()}</span>
          {reading.carried ? <>, and they were carrying the <span className="italic">{reading.carried.label.toLowerCase()}</span></> : null}.
        </p>

        <div ref={wrapRef} style={{ position: "relative", marginTop: 8 }}>
          {wrapWidth > 0 && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: sigilLeftInWrap,
                top: sigilTop,
                width: sigilSize,
                height: sigilSize,
                pointerEvents: "none",
                opacity: isNarrow ? 0 : 1,
              }}
            >
              <ConcernSigil
                concerns={input.concerns}
                size={sigilSize}
                showAxes
                showRing
                showDots
              />
            </div>
          )}

          {wrapWidth > 0 && (
            <ShapedProse
              text={[reading.weights, reading.regionPara, reading.objectPara]}
              lineHeight={30}
              width={wrapWidth}
              obstacle={obstacle}
              paragraphGap={20}
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 19,
                color: "var(--ink)",
              }}
            />
          )}

          {isNarrow && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 32 }}>
              <ConcernSigil concerns={input.concerns} size={sigilSize} showAxes showRing showDots />
              <div style={{ marginLeft: 16 }} className="t-eyebrow">their sigil</div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "center", margin: "44px 0 32px", color: "var(--ink-2)" }}>
          <Sigil size={16} />
        </div>

        {reading.suggestions.length > 0 && (
          <div>
            <div className="t-eyebrow">drawers near this reading</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 10 }}>
              {reading.suggestions.map((a) => (
                <li key={a.id} className="t-body">
                  <Link
                    href={`/archive/${entrySlug(a)}`}
                    style={{ borderBottom: "1px solid var(--candle)", color: "var(--ink)" }}
                  >
                    {a.title}
                  </Link>
                  <span className="t-meta" style={{ color: "var(--ink-2)", marginLeft: 12 }}>
                    {a.year} · {a.medium}{a.status ? ` · ${a.status}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div
          style={{
            marginTop: 48,
            paddingTop: 28,
            borderTop: "1px solid var(--rule)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/"
            className="t-mono"
            style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "lowercase", color: "var(--ink-2)" }}
          >
            ← your own room
          </Link>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              onClick={playSigil}
              disabled={playing}
              className="t-mono"
              style={{
                background: playing ? "var(--paper-2)" : "none",
                border: "1px solid var(--rule)",
                padding: "10px 16px",
                cursor: playing ? "default" : "pointer",
                fontSize: 12,
                letterSpacing: "0.06em",
                textTransform: "lowercase",
                color: playing ? "var(--candle)" : "var(--ink)",
              }}
            >
              {playing ? "playing sigil" : "play sigil"}
            </button>
            <button
              onClick={copy}
              className="t-mono"
              style={{
                background: "none",
                border: "1px solid var(--rule)",
                padding: "10px 16px",
                cursor: "pointer",
                fontSize: 12,
                letterSpacing: "0.06em",
                textTransform: "lowercase",
                color: copied ? "var(--candle)" : "var(--ink)",
              }}
            >
              {copied ? "permalink kept ◦" : "permalink ⌁ copy"}
            </button>
            <button
              onClick={stepInto}
              className="t-mono"
              style={{
                background: "var(--ink)",
                border: "1px solid var(--ink)",
                color: "var(--paper)",
                padding: "10px 16px",
                cursor: "pointer",
                fontSize: 12,
                letterSpacing: "0.06em",
                textTransform: "lowercase",
              }}
            >
              step into this room →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
