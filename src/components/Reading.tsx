"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useField } from "@/store/field";
import { buildReading } from "@/lib/reading";
import { entrySlug } from "@/lib/slug";
import { getFieldAudio } from "@/lib/audio";
import { sigilPolygonPoints, polygonLeftEdgeAt, type ObstacleShape } from "@/lib/sigil-shape";
import Sigil from "@/components/Sigil";
import ConcernSigil from "@/components/ConcernSigil";
import MorphText from "@/components/MorphText";
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

export default function Reading() {
  const concerns = useField((s) => s.concerns);
  const region = useField((s) => s.region);
  const carried = useField((s) => s.carriedObject);
  const keepReading = useField((s) => s.keepReading);
  const kept = useField((s) => s.keptReadings);
  const [copied, setCopied] = useState(false);

  const reading = useMemo(
    () => buildReading({ concerns, region, carriedObject: carried }),
    [concerns, region, carried],
  );
  const isKept = kept.some((k) => k.hash === reading.hash);
  const [playing, setPlaying] = useState(false);

  const keep = () => {
    if (isKept) return;
    keepReading({
      hash: reading.hash,
      headline: reading.headline,
      topConcern: reading.top[0],
      region: reading.region.id,
      carriedObject: reading.carried?.id ?? null,
      keptAt: Date.now(),
    });
    getFieldAudio().thud();
  };

  const playSigil = async () => {
    if (playing) return;
    setPlaying(true);
    useField.getState().recordTape("sigil", 0.9, reading.top[0]);
    await getFieldAudio().playSigilPhrase(concerns);
    setPlaying(false);
  };

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // when concerns/region/carried change, the old answer no longer fits
  useEffect(() => {
    setAiAnswer(null);
    setAiError(null);
    useField.getState().recordTape("reading", 0.55, reading.top[0]);
  }, [reading.hash, reading.top]);

  const ask = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    setAiError(null);
    useField.getState().recordTape("ask", 0.7, reading.region.id);
    try {
      const res = await fetch("/api/ask-the-room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          concerns,
          region: reading.region.id,
          carriedObject: reading.carried?.id ?? null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setAiError(j?.hint ?? j?.error ?? "the room could not answer.");
      } else {
        const j = await res.json();
        setAiAnswer(typeof j.answer === "string" ? j.answer : null);
        getFieldAudio().bell();
      }
    } catch {
      setAiError("the field is unreachable right now.");
    } finally {
      setAsking(false);
    }
  };

  const copy = async () => {
    const permalink = `/reading/${reading.hash}`;
    try {
      await navigator.clipboard?.writeText(
        `${typeof location !== "undefined" ? location.origin : ""}${permalink}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* noop */ }
  };

  // measure container for shaped prose
  const wrapRef = useRef<HTMLDivElement>(null);
  const wrapWidth = useElementWidth(wrapRef);

  // sigil sized responsively. on narrow viewports the obstacle goes away
  // entirely so the prose just stacks linearly above the sigil.
  const isNarrow = wrapWidth > 0 && wrapWidth < 620;
  const sigilSize = isNarrow ? Math.min(220, wrapWidth - 40) : Math.min(360, wrapWidth * 0.40);
  const sigilLeftInWrap = wrapWidth - sigilSize;
  const sigilTop = 0;

  const polygonPoints = useMemo(
    () => sigilPolygonPoints(concerns, sigilSize),
    [concerns, sigilSize],
  );

  const obstacle: ObstacleShape | undefined = useMemo(() => {
    if (isNarrow || sigilSize <= 0) return undefined;
    return {
      top: sigilTop,
      height: sigilSize,
      side: "right",
      edgeAt: (yContainer: number) => {
        const yLocal = yContainer - sigilTop;
        const xLocal = polygonLeftEdgeAt(polygonPoints, yLocal);
        return xLocal === null ? null : sigilLeftInWrap + xLocal;
      },
      padding: 24,
    };
  }, [polygonPoints, sigilLeftInWrap, sigilTop, sigilSize, isNarrow]);

  const permalink = `/reading/${reading.hash}`;
  const proseParagraphs = [reading.weights, reading.regionPara, reading.objectPara];

  return (
    <section id="reading" className="rule" style={{ scrollMarginTop: 72 }}>
      <div className="wrap">
        <div className="t-eyebrow">reading · the room speaks back</div>

        <h2 className="t-h2 italic" style={{ marginTop: 14, marginBottom: 26, maxWidth: "30ch" }}>
          <MorphText>{reading.headline}</MorphText>
        </h2>

        <div ref={wrapRef} style={{ position: "relative", marginTop: 24 }}>
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
                concerns={concerns}
                size={sigilSize}
                showAxes
                showDots
              />
            </div>
          )}

          {wrapWidth > 0 && (
            <ShapedProse
              text={proseParagraphs}
              lineHeight={34}
              width={wrapWidth}
              obstacle={obstacle}
              paragraphGap={20}
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 22,
                color: "var(--ink)",
                fontStyle: "normal",
              }}
            />
          )}

          {/* on narrow screens stack a centered sigil below */}
          {isNarrow && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 32 }}>
              <ConcernSigil concerns={concerns} size={sigilSize} showAxes showDots />
            </div>
          )}
        </div>

        {/* ask the room — a free-text affordance that adds one short ai paragraph in voice */}
        <div style={{ marginTop: 40 }}>
          <div className="t-eyebrow">ask the room</div>
          <form
            className="reading-ask-form"
            onSubmit={(e) => { e.preventDefault(); ask(); }}
            style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="what would you ask, tonight?"
              aria-label="ask the room"
              disabled={asking}
              maxLength={400}
              className="t-mono"
              style={{
                flex: 1,
                minWidth: 240,
                background: "transparent",
                border: 0,
                borderBottom: "1px solid var(--rule)",
                padding: "8px 0",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 19,
                color: "var(--ink)",
                outline: "none",
              }}
            />
            <button
              type="submit"
              className="reading-ask-submit t-mono"
              disabled={asking || !question.trim()}
              style={{
                background: question.trim() && !asking ? "var(--ink)" : "var(--paper-2)",
                color: question.trim() && !asking ? "var(--paper)" : "var(--ink-2)",
                border: "1px solid var(--ink)",
                padding: "12px 18px",
                minHeight: 44,
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "lowercase",
                cursor: asking ? "default" : (question.trim() ? "pointer" : "default"),
              }}
            >
              {asking ? "the room is listening…" : "ask"}
            </button>
          </form>

          {aiAnswer && (
            <div
              style={{
                marginTop: 22,
                paddingLeft: 18,
                borderLeft: "2px solid var(--candle)",
                fontFamily: "var(--font-serif)",
                fontSize: 20,
                lineHeight: 1.45,
                color: "var(--ink)",
                maxWidth: "64ch",
                animation: "ask-fade-in 700ms ease both",
              }}
            >
              {aiAnswer}
            </div>
          )}
          {aiError && (
            <div className="t-meta italic" style={{ marginTop: 16, color: "var(--ink-2)" }}>
              {aiError}
            </div>
          )}
          <style>{`
            @keyframes ask-fade-in {
              from { opacity: 0; transform: translateY(4px); }
              to   { opacity: 1; transform: none; }
            }
          `}</style>
        </div>

        <div style={{ display: "flex", justifyContent: "center", margin: "48px 0 28px", color: "var(--ink-2)" }}>
          <Sigil size={18} />
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

        <div className="reading-keep-row" style={{ marginTop: 44, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={playSigil}
              aria-label="play your sigil as music"
              title="play this sigil"
              disabled={playing}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: playing ? "default" : "pointer",
                display: "inline-flex",
                position: "relative",
              }}
            >
              <ConcernSigil concerns={concerns} size={48} showAxes />
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: -4,
                  borderRadius: "50%",
                  border: "1px solid var(--candle)",
                  opacity: playing ? 0.7 : 0,
                  transform: playing ? "scale(1.15)" : "scale(0.9)",
                  transition: "opacity 320ms ease, transform 320ms ease",
                  pointerEvents: "none",
                }}
              />
            </button>
            <div>
              <div className="t-eyebrow">your sigil tonight</div>
              <div className="t-meta" style={{ color: "var(--ink-2)" }}>
                {playing ? "playing…" : permalink}
              </div>
            </div>
          </div>
          <div className="reading-keep-actions" style={{ display: "flex", gap: 8 }}>
            <button
              onClick={keep}
              disabled={isKept}
              className="t-mono"
              style={{
                background: isKept ? "var(--paper-2)" : "var(--ink)",
                border: "1px solid var(--ink)",
                padding: "12px 16px",
                minHeight: 44,
                cursor: isKept ? "default" : "pointer",
                fontSize: 12,
                letterSpacing: "0.06em",
                textTransform: "lowercase",
                color: isKept ? "var(--ink-2)" : "var(--paper)",
              }}
            >
              {isKept ? "kept ◦" : "keep this reading"}
            </button>
            <button
              onClick={copy}
              className="t-mono"
              style={{
                background: "none",
                border: "1px solid var(--rule)",
                padding: "12px 16px",
                minHeight: 44,
                cursor: "pointer",
                fontSize: 12,
                letterSpacing: "0.06em",
                textTransform: "lowercase",
                color: copied ? "var(--candle)" : "var(--ink)",
                transition: "all var(--t)",
              }}
            >
              {copied ? "permalink kept ◦" : "permalink ⌁ copy"}
            </button>
          </div>
        </div>
        <style>{`
          @media (max-width: 720px) {
            .reading-ask-form {
              display: grid !important;
              grid-template-columns: 1fr;
            }
            .reading-ask-form input {
              min-width: 0 !important;
              width: 100%;
            }
            .reading-ask-submit {
              width: 100%;
            }
            .reading-keep-row {
              align-items: stretch !important;
            }
            .reading-keep-row > div,
            .reading-keep-actions {
              width: 100%;
            }
            .reading-keep-actions {
              display: grid !important;
              grid-template-columns: 1fr;
            }
          }
        `}</style>
      </div>
    </section>
  );
}
