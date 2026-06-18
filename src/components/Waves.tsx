"use client";

import { useEffect, useRef, useState } from "react";
import { useField } from "@/store/field";
import { getFieldAudio } from "@/lib/audio";
import { WAVES_POEM, WAVES_TITLE, WAVES_SUBTITLE, type WavePhase } from "@/data/waves-poem";
import PhaseChart from "@/components/PhaseChart";
import PlasmaOrb from "@/components/PlasmaOrb";
import WaterText from "@/components/WaterText";

/** Phase ids that PhaseChart knows how to draw. Kept narrow so the cast
 *  from the runtime `phase.id: string` is explicit. */
type PhaseKind =
  | "weather"
  | "cultivation"
  | "city"
  | "commute"
  | "ocean"
  | "feeling"
  | "seismograph"
  | "flame"
  | "coda";

/** Detect prefers-reduced-motion once on mount. Used to skip scale-ups
 *  while keeping audio cues intact, per a11y request. */
function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReduce(mq.matches);
      const h = () => setReduce(mq.matches);
      mq.addEventListener?.("change", h);
      return () => mq.removeEventListener?.("change", h);
    } catch { /* noop */ }
  }, []);
  return reduce;
}

/**
 * /waves — the Flow Compass.
 *
 * A vertical descent through the poem. Each phase is its own full-screen
 * section with its own palette, its own EKG trace divider, its own
 * phenomenological reading in the right gutter. The trace draws itself
 * when its phase scrolls into view; entering a phase also records a
 * pulse on the global tape and plays a soft chime.
 *
 * The descent itself is the recording — by the time the user reaches
 * the coda, their tape has eight new marks, one per regime they crossed.
 *
 * Second pass added an interaction layer: each visual element (trace,
 * numeral, tag, gutter reading, poem body) responds to hover/click.
 * The page is now a poem to TOUCH, not just to read.
 */
export default function Waves() {
  const [activeIdx, setActiveIdx] = useState(0);

  // page-specific ambient bed: phasey swell and analytic clicks
  useEffect(() => { getFieldAudio().setAmbientProfile("waves"); }, []);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-wave-phase]"));
    if (sections.length === 0) return;

    const seen = new Set<string>();

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const idx = Number(e.target.getAttribute("data-wave-idx") ?? "0");
            const id = e.target.getAttribute("data-wave-phase") ?? "";
            setActiveIdx(idx);
            // first time this phase enters the viewport, record a pulse + chime
            if (!seen.has(id)) {
              seen.add(id);
              useField.getState().recordTape("region", 0.55, `waves/${id}`);
              try {
                if (id === "coda") getFieldAudio().bell();
                else if (id === "city") getFieldAudio().spark();
                else getFieldAudio().chime();
              } catch { /* noop */ }
            }
          }
        }
      },
      { threshold: 0.5 },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  return (
    <div style={{ background: "#08111c" }}>
      <Threshold />
      {WAVES_POEM.map((phase, i) => (
        <PhaseSection key={phase.id} phase={phase} idx={i} active={activeIdx === i} />
      ))}
      <Footer />
    </div>
  );
}

// ── threshold ────────────────────────────────────────────────────────────

function Threshold() {
  return (
    <section
      style={{
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "10vh 6vw",
        background: "linear-gradient(180deg, #08111c 0%, #0c111c 100%)",
        color: "rgba(232,226,213,0.96)",
        textAlign: "center",
      }}
    >
      <div
        className="t-mono"
        style={{
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          opacity: 0.6,
          marginBottom: 24,
        }}
      >
        objet d&rsquo;art · waves
      </div>
      <WaterText
        as="h1"
        bobAmp={0}
        style={{
          display: "block",
          fontFamily: "var(--font-fraunces, Georgia, serif)",
          fontWeight: 500,
          fontSize: "clamp(48px, 9vw, 96px)",
          lineHeight: 1.0,
          letterSpacing: "-0.02em",
          margin: 0,
          fontVariantNumeric: "lining-nums",
        }}
      >
        {WAVES_TITLE}
      </WaterText>
      <WaterText
        as="div"
        bobAmp={2}
        style={{
          display: "block",
          fontFamily: "var(--font-display, Georgia, serif)",
          fontStyle: "italic",
          fontSize: "clamp(18px, 2.6vw, 24px)",
          opacity: 0.85,
          marginTop: 16,
          letterSpacing: "-0.005em",
        }}
      >
        {WAVES_SUBTITLE}
      </WaterText>
      <div
        style={{
          marginTop: "10vh",
          fontFamily: "var(--font-fraunces, Georgia, serif)",
          fontWeight: 400,
          fontStyle: "italic",
          fontSize: "clamp(17px, 2.2vw, 22px)",
          maxWidth: 560,
          opacity: 0.78,
          lineHeight: 1.45,
        }}
      >
        a wildflower garden, a chart, a commute, an ocean —
        <br />
        eight regimes you cross before noon.
      </div>
      <div
        className="t-mono"
        style={{
          marginTop: "8vh",
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          opacity: 0.6,
        }}
      >
        scroll ↓
      </div>
    </section>
  );
}

// ── per-phase section ────────────────────────────────────────────────────

function PhaseSection({ phase, idx, active }: { phase: WavePhase; idx: number; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const reduce = useReducedMotion();

  // Click-on-numeral pulse: when the user clicks the big "01", "02"…, we
  // bump this counter; a useEffect schedules a 400ms window during which
  // the section background renders +5% brighter. Counter avoids stuck
  // state if the user mashes it rapidly.
  const [pulseTick, setPulseTick] = useState(0);
  const [pulsed, setPulsed] = useState(false);
  useEffect(() => {
    if (pulseTick === 0) return;
    setPulsed(true);
    const id = window.setTimeout(() => setPulsed(false), 400);
    return () => window.clearTimeout(id);
  }, [pulseTick]);

  // Reveal the gutter "reading" on mobile when the user taps the tag.
  const [readingForced, setReadingForced] = useState(false);

  // Set of reading-line indices the user has "kept" (clicked once).
  // Kept lines play a chime + post to the global tape; clicking again
  // removes the kept state. Local state — the tape itself is the source
  // of truth for cross-page persistence.
  const [keptLines, setKeptLines] = useState<Set<number>>(() => new Set());
  const toggleKeptLine = (i: number, line: string) => {
    setKeptLines((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
        // tape + chime — one-shot on add. Removal is silent.
        try { getFieldAudio().chime(); } catch { /* noop */ }
        try {
          useField.getState().recordTape("kept", 0.7, `waves/${phase.id}: ${line}`);
        } catch { /* noop */ }
      }
      return next;
    });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setVisible(true); }),
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Phase background gets +5% brightness during the pulse. We use
  // a CSS filter on the section so the gradient remains intact.
  const sectionFilter = pulsed ? "brightness(1.05)" : "brightness(1)";

  return (
    <section
      ref={ref}
      data-wave-phase={phase.id}
      data-wave-idx={idx}
      className="waves-phase-section"
      style={{
        position: "relative",
        minHeight: "100svh",
        padding: "clamp(8vh, 12vh, 18vh) clamp(20px, 6vw, 64px)",
        background: phase.bg,
        color: phase.ink,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(180px, 280px)",
        gap: "clamp(20px, 5vw, 64px)",
        alignItems: "start",
        filter: sectionFilter,
        transition: "filter 380ms ease",
      }}
    >
      <style>{`
        @media (max-width: 820px) {
          .waves-phase-section { grid-template-columns: minmax(0, 1fr) !important; }
          .waves-phase-aside { position: static !important; opacity: 0.7; }
          .waves-phase-aside[data-revealed="1"] { opacity: 1; }
          /* on mobile the gutter is hidden by default until the tag is tapped */
          .waves-phase-aside[data-revealed="0"] { display: none; }
          .waves-phase-controls {
            gap: 12px !important;
            margin-top: 22px !important;
            margin-bottom: 22px !important;
          }
        }
        .waves-phase-controls { flex-wrap: wrap; }
        /* per-line hover for the poem body — very gentle ~5% brightness lift */
        .waves-poem-line { transition: filter 200ms ease, color 200ms ease; }
        @media (hover: hover) {
          .waves-poem-line:hover { filter: brightness(1.05); }
        }
        .waves-kept-line { color: var(--phase-accent, currentColor); }
      `}</style>
      {/* flame phase only: a small plasma orb sits in the top-right
          of the section's main content column. pointer-events disabled
          so it never intercepts scroll/clicks. */}
      {phase.id === "flame" && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 24,
            right: 24,
            pointerEvents: "none",
            opacity: 0.92,
            zIndex: 1,
          }}
        >
          <PlasmaOrb size={140} palette="flame" flicker={0.6} />
        </div>
      )}

      {/* main column: trace + index + tag + poem */}
      <div style={{ maxWidth: 680 }}>
        <EkgTrace
          d={phase.trace}
          stroke={phase.accent}
          visible={visible}
          phaseIndex={phase.index}
          reduce={reduce}
        />
        <div
          className="waves-phase-controls"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginTop: 28,
            marginBottom: 28,
          }}
        >
          <PhaseNumeral
            indexLabel={pad2(phase.index)}
            accent={phase.accent}
            reduce={reduce}
            onActivate={() => {
              // bell + pulse window
              try { getFieldAudio().bell(); } catch { /* noop */ }
              setPulseTick((t) => t + 1);
            }}
          />
          <PhaseTag
            label={phase.tag}
            onActivate={() => setReadingForced((v) => !v)}
          />
        </div>

        <div
          style={{
            fontFamily: "var(--font-fraunces, Georgia, serif)",
            fontWeight: 400,
            fontSize: "clamp(22px, 3vw, 30px)",
            lineHeight: 1.42,
            letterSpacing: "-0.005em",
          }}
        >
          {phase.body.map((stanza, si) => (
            <p key={si} style={{ margin: "0 0 1.05em" }}>
              {stanza.map((line, li) => (
                <span
                  key={li}
                  className="waves-poem-line text-selectable"
                  style={{
                    display: "block",
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(8px)",
                    transition: `opacity 600ms ease ${300 + (si * stanza.length + li) * 60}ms, transform 600ms ease ${300 + (si * stanza.length + li) * 60}ms, filter 200ms ease, color 200ms ease`,
                  }}
                >
                  {line}
                </span>
              ))}
            </p>
          ))}
        </div>

        {/* per-phase candlestick — its SHAPE is the phenomenology */}
        <div style={{ marginTop: 32, maxWidth: 540 }}>
          <PhaseChart kind={phase.id as PhaseKind} accent={phase.accent} />
        </div>
      </div>

      {/* right gutter: phenomenological reading in mono.
          aria-hidden because the rest of the experience is the source of
          meaning; the gutter is metadata. On mobile we hide it until the
          user taps the tag to reveal. */}
      <aside
        aria-hidden="true"
        className="waves-phase-aside"
        data-revealed={readingForced ? "1" : "0"}
        style={{
          position: "sticky",
          top: "calc(56px + 4vh)",
          paddingTop: 28,
          opacity: 0.78,
          ["--phase-accent" as string]: phase.accent,
        } as React.CSSProperties}
      >
        <div
          className="t-mono"
          style={{
            fontSize: 10.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: 0.55,
            marginBottom: 14,
          }}
        >
          reading
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {phase.reading.map((line, i) => {
            const kept = keptLines.has(i);
            return (
              <li
                key={i}
                className={`t-mono waves-reading-line${kept ? " waves-kept-line" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={kept}
                onClick={() => toggleKeptLine(i, line)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleKeptLine(i, line);
                  }
                }}
                style={{
                  fontSize: 12,
                  letterSpacing: "0.02em",
                  lineHeight: 1.5,
                  padding: "8px 0",
                  minHeight: 44,
                  display: "flex",
                  alignItems: "center",
                  borderTop: i === 0 ? "1px solid rgba(255,255,255,0.10)" : undefined,
                  borderBottom: "1px solid rgba(255,255,255,0.10)",
                  opacity: visible ? 1 : 0,
                  transform: visible ? "translateY(0)" : "translateY(6px)",
                  transition: `opacity 500ms ease ${600 + i * 80}ms, transform 500ms ease ${600 + i * 80}ms, color 200ms ease`,
                  cursor: "pointer",
                  color: kept ? phase.accent : undefined,
                  userSelect: "none",
                }}
              >
                {kept ? "✓ " : ""}{line}
              </li>
            );
          })}
        </ul>
        <div
          style={{
            marginTop: 18,
            fontFamily: "var(--font-fraunces, Georgia, serif)",
            fontWeight: 500,
            fontSize: 11,
            letterSpacing: "0.06em",
            opacity: 0.5,
            fontVariantNumeric: "lining-nums",
          }}
        >
          {pad2(phase.index)} / {pad2(WAVES_POEM.length)}
        </div>
      </aside>
      {/* tiny indicator: which phase is dominant */}
      <PhaseDot active={active} accent={phase.accent} />
    </section>
  );
}

function PhaseDot({ active, accent }: { active: boolean; accent: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: "calc(56px + 24px)",
        right: 20,
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: active ? accent : "rgba(255,255,255,0.18)",
        transition: "background 320ms ease",
      }}
    />
  );
}

// ── interactive numeral / tag ───────────────────────────────────────────

/**
 * PhaseNumeral — the big "01", "02" Fraunces digit. Hover scales 1.05×
 * (skipped under reduced-motion) and the cursor turns to a pointer.
 * Click → soft bell + parent section pulses (handled via onActivate).
 */
function PhaseNumeral({
  indexLabel,
  accent,
  reduce,
  onActivate,
}: {
  indexLabel: string;
  accent: string;
  reduce: boolean;
  onActivate: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onActivate}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      // strip default button chrome; we want this to look exactly like
      // a piece of typography, not a CTA.
      style={{
        all: "unset",
        cursor: "pointer",
        fontFamily: "var(--font-fraunces, Georgia, serif)",
        fontWeight: 500,
        fontSize: 38,
        lineHeight: 1,
        letterSpacing: "-0.02em",
        color: accent,
        fontVariantNumeric: "lining-nums",
        transform: hover && !reduce ? "scale(1.05)" : "scale(1)",
        transformOrigin: "left center",
        transition: "transform 220ms ease",
        // make sure the tap target on touch is comfortably > 44×44
        minWidth: 44,
        minHeight: 44,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2px 4px",
        margin: "-2px -4px",
      }}
      aria-label={`phase ${indexLabel}`}
    >
      {indexLabel}
    </button>
  );
}

/**
 * PhaseTag — the mono "weather", "cultivation"... eyebrow. Hover bumps
 * opacity to 1.0. Click toggles the gutter reading on mobile.
 */
function PhaseTag({
  label,
  onActivate,
}: {
  label: string;
  onActivate: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      className="t-mono"
      onClick={onActivate}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        all: "unset",
        cursor: "pointer",
        fontFamily: "var(--font-mono, monospace)",
        fontSize: 12,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        opacity: hover ? 1 : 0.74,
        transition: "opacity 200ms ease",
        minHeight: 44,
        display: "inline-flex",
        alignItems: "center",
        padding: "0 6px",
        margin: "0 -6px",
      }}
    >
      {label}
    </button>
  );
}

// ── EKG trace ────────────────────────────────────────────────────────────

/**
 * EKG trace. Hovering brightens the stroke. Clicking re-triggers the
 * draw-in animation and emits a chime whose pitch maps to phase index
 * (low → high) — earlier phases play lower notes, the coda hits highest.
 */
function EkgTrace({
  d,
  stroke,
  visible,
  phaseIndex,
  reduce,
}: {
  d: string;
  stroke: string;
  visible: boolean;
  phaseIndex: number;
  reduce: boolean;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(1400);
  const [hover, setHover] = useState(false);
  // Internal toggle so click can re-trigger the draw-in even after the
  // path has already drawn. We invert this on each click — the path's
  // strokeDashoffset is bound to (visible XOR replayFlip).
  const [replayTick, setReplayTick] = useState(0);
  // When replayTick changes we briefly force the dashoffset back to len,
  // then schedule another paint to 0 so CSS transitions interpolate.
  const [replayPhase, setReplayPhase] = useState<"idle" | "reset" | "drawing">("idle");
  const drawMs = reduce ? 900 : 2200;

  useEffect(() => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const l = p.getTotalLength();
      if (l > 0) setLen(l);
    } catch { /* noop */ }
  }, [d]);

  // Handle replay: reset offset, then on next frame put it back to 0
  // so the CSS transition runs again.
  useEffect(() => {
    if (replayTick === 0) return;
    setReplayPhase("reset");
    const id = window.requestAnimationFrame(() => {
      // second rAF guarantees the browser commits the reset before the
      // transition starts.
      window.requestAnimationFrame(() => setReplayPhase("drawing"));
    });
    const finishId = window.setTimeout(() => setReplayPhase("idle"), drawMs + 200);
    return () => {
      window.cancelAnimationFrame(id);
      window.clearTimeout(finishId);
    };
  }, [drawMs, replayTick]);

  /** dashoffset is len when reset, 0 when drawn or idle (after first draw). */
  const offset = (() => {
    if (replayPhase === "reset") return len;
    if (replayPhase === "drawing") return 0;
    return visible ? 0 : len;
  })();

  const onClickTrace = () => {
    // chime pitch: A3 (57) + phaseIndex * 2 semitones → ~A3..F#5 range
    const midi = 57 + (phaseIndex - 1) * 2;
    try { getFieldAudio().playNote(midi, 260); } catch { /* noop */ }
    setReplayTick((t) => t + 1);
  };

  return (
    <svg
      viewBox="0 0 760 34"
      preserveAspectRatio="none"
      role="button"
      tabIndex={0}
      aria-label="replay ekg trace"
      onClick={onClickTrace}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClickTrace();
        }
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        width: "100%",
        // give the trace a comfortable touch target on mobile while keeping
        // the visual height roughly the same on desktop.
        height: 34,
        minHeight: 34,
        overflow: "visible",
        cursor: "pointer",
        // wider tap area than the painted line itself
        padding: "10px 0",
        boxSizing: "content-box",
      }}
    >
      <path
        ref={pathRef}
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={hover ? 2.0 : 1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: len,
          strokeDashoffset: offset,
          // brighten by lifting opacity via filter; cheaper than re-coloring
          filter: hover ? "brightness(1.35)" : "brightness(1)",
          transition: `stroke-dashoffset ${drawMs}ms cubic-bezier(.2,.6,.2,1), stroke-width 200ms ease, filter 200ms ease`,
        }}
      />
    </svg>
  );
}

// ── footer ───────────────────────────────────────────────────────────────

function Footer() {
  return (
    <section
      style={{
        minHeight: "60svh",
        padding: "12vh 6vw",
        background: "linear-gradient(180deg, #15314a 0%, #0a1a2c 100%)",
        color: "rgba(232,226,213,0.94)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div
        className="t-mono"
        style={{
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          opacity: 0.55,
          marginBottom: 18,
        }}
      >
        after
      </div>
      <div
        style={{
          fontFamily: "var(--font-fraunces, Georgia, serif)",
          fontStyle: "italic",
          fontSize: "clamp(18px, 2.4vw, 24px)",
          maxWidth: 520,
          opacity: 0.85,
          lineHeight: 1.4,
        }}
      >
        the tape at the bottom of your screen now carries
        <br />
        the regimes you crossed.
      </div>
      <div style={{ marginTop: "8vh", display: "flex", gap: 22 }}>
        <a className="t-mono" href="/tide" style={footLink}>tide ↓</a>
        <a className="t-mono" href="/watch" style={footLink}>watch ↓</a>
        <a className="t-mono" href="/" style={footLink}>return ↑</a>
      </div>
    </section>
  );
}

const footLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 12,
  letterSpacing: "0.06em",
  textTransform: "lowercase",
  color: "rgba(232,226,213,0.78)",
  borderBottom: "1px solid rgba(232,226,213,0.20)",
  minHeight: 44,
  paddingBottom: 2,
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
