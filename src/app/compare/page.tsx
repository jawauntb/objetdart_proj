"use client";

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The morphing overlay. Two source readings sit ghosted behind a single
 * shape that interpolates between them: morph 0 = all of A (candle),
 * morph 1 = all of B (sea). The axes that travel furthest between A and B
 * are drawn with a connector and thicker rule — "where they differ most",
 * felt as the vertices that slide the most as you drag.
 */
function MorphCompass({
  a,
  b,
  morph,
  highlight,
  topKeys,
  onAxis,
  onAxisLeave,
  onAxisTap,
}: {
  a: ReadingInput;
  b: ReadingInput;
  morph: number;
  highlight: ConcernKey | null;
  topKeys: Set<ConcernKey>;
  onAxis: (k: ConcernKey) => void;
  onAxisLeave: () => void;
  onAxisTap: (k: ConcernKey) => void;
}) {
  const SIZE = 460;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const rMax = SIZE * 0.40;

  const geom = RADIAL_ORDER.map((k, i) => {
    const ang = -Math.PI / 2 + (i * Math.PI * 2) / 8;
    const va = a.concerns[k] ?? 50;
    const vb = b.concerns[k] ?? 50;
    const vm = va + (vb - va) * morph;
    const at = { x: cx + Math.cos(ang) * (va / 100) * rMax, y: cy + Math.sin(ang) * (va / 100) * rMax };
    const bt = { x: cx + Math.cos(ang) * (vb / 100) * rMax, y: cy + Math.sin(ang) * (vb / 100) * rMax };
    const mt = { x: cx + Math.cos(ang) * (vm / 100) * rMax, y: cy + Math.sin(ang) * (vm / 100) * rMax };
    return { k, ang, va, vb, at, bt, mt };
  });

  const poly = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");
  const aPts = geom.map((g) => g.at);
  const bPts = geom.map((g) => g.bt);
  const mPts = geom.map((g) => g.mt);

  return (
    <svg
      viewBox={`-70 -10 ${SIZE + 140} ${SIZE + 20}`}
      width="100%"
      style={{ display: "block", maxWidth: 620, height: "auto", touchAction: "none" }}
      aria-label={`two readings overlaid, morphed ${Math.round(morph * 100)}% toward reading b`}
    >
      {/* rings */}
      {[0.25, 0.5, 0.75, 1].map((t, i) => (
        <circle key={i} cx={cx} cy={cy} r={t * rMax} fill="none" stroke="var(--rule)" />
      ))}
      <circle cx={cx} cy={cy} r={rMax * 0.5} fill="none" stroke="rgba(21,23,26,0.28)" strokeDasharray="3 4" />

      {/* axes */}
      {geom.map(({ k, ang }) => {
        const active = highlight === k;
        const emphasized = topKeys.has(k);
        return (
          <line
            key={k}
            x1={cx} y1={cy}
            x2={cx + Math.cos(ang) * rMax}
            y2={cy + Math.sin(ang) * rMax}
            stroke={active ? "var(--candle)" : emphasized ? "rgba(21,23,26,0.42)" : "var(--rule)"}
            strokeWidth={active ? 2.2 : emphasized ? 1.6 : 1}
          />
        );
      })}

      {/* travel connectors for the axes that differ most */}
      {geom.filter((g) => topKeys.has(g.k)).map((g) => (
        <line
          key={`travel-${g.k}`}
          x1={g.at.x} y1={g.at.y}
          x2={g.bt.x} y2={g.bt.y}
          stroke={highlight === g.k ? "var(--candle)" : "rgba(21,23,26,0.30)"}
          strokeWidth={highlight === g.k ? 2 : 1.2}
          strokeDasharray="2 4"
        />
      ))}

      {/* ghost B — the other shape, held faint behind */}
      <polygon points={poly(bPts)} fill="none" stroke="var(--sea)" strokeWidth={1} opacity={0.32} />
      {/* ghost A — the focus shape, held faint behind */}
      <polygon points={poly(aPts)} fill="none" stroke="var(--candle)" strokeWidth={1} opacity={0.32} />

      {/* the morphing shape — candle and sea fills crossfade by morph */}
      <polygon points={poly(mPts)} fill="rgba(200, 115, 42, 0.16)" stroke="var(--candle)" strokeWidth={1.7} opacity={1 - morph} />
      <polygon points={poly(mPts)} fill="rgba(44, 74, 92, 0.18)" stroke="var(--sea)" strokeWidth={1.7} opacity={morph} />
      {mPts.map((p, i) => (
        <g key={`m-${i}`}>
          <circle cx={p.x} cy={p.y} r={4} fill="var(--candle)" opacity={1 - morph} />
          <circle cx={p.x} cy={p.y} r={4} fill="var(--sea)" opacity={morph} />
        </g>
      ))}

      {/* axis labels — interactive; show a vs b on hover / focus / tap */}
      {geom.map(({ k, ang, va, vb }) => {
        const lx = cx + Math.cos(ang) * (rMax + 26);
        const ly = cy + Math.sin(ang) * (rMax + 26);
        const active = highlight === k;
        const emphasized = topKeys.has(k);
        const anchor =
          Math.abs(Math.cos(ang)) < 0.25 ? "middle" :
          Math.cos(ang) > 0 ? "start" : "end";
        const valueDy = Math.sin(ang) < -0.4 ? -20 : 20;
        return (
          <g
            key={`l-${k}`}
            tabIndex={0}
            role="button"
            aria-label={`${k}: reading a ${va}, reading b ${vb}. differs by ${va - vb}. activate to sound it.`}
            style={{ cursor: "pointer", outline: "none" }}
            onMouseEnter={() => onAxis(k)}
            onMouseLeave={onAxisLeave}
            onFocus={() => onAxis(k)}
            onBlur={onAxisLeave}
            onClick={() => onAxisTap(k)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAxisTap(k); }
            }}
          >
            {/* generous transparent hit target */}
            <circle cx={lx} cy={ly} r={24} fill="transparent" />
            <text
              x={lx} y={ly}
              textAnchor={anchor}
              dominantBaseline="middle"
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: emphasized ? 15 : 14,
                fontWeight: emphasized ? 600 : 400,
                fill: active ? "var(--candle)" : "var(--ink-2)",
                transition: "fill var(--t)",
              }}
            >
              {k}
            </text>
            {active && (
              <text
                x={lx} y={ly + valueDy}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="t-mono"
                style={{ fontSize: 11, letterSpacing: "0.04em" }}
              >
                <tspan fill="var(--candle)">a {va}</tspan>
                <tspan fill="var(--ink-2)"> / </tspan>
                <tspan fill="var(--sea)">b {vb}</tspan>
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Compact identity + entry point for one reading — headline and "step into". */
function ReadingTag({
  input,
  color,
  label,
  align,
}: {
  input: ReadingInput;
  color: string;
  label: string;
  align: "start" | "end";
}) {
  const r = buildReading(input);
  return (
    <div style={{ textAlign: align === "end" ? "right" : "left", maxWidth: "34ch" }}>
      <div className="t-eyebrow" style={{ color, marginBottom: 6 }}>
        <span
          style={{
            display: "inline-block", width: 8, height: 8, background: color,
            [align === "end" ? "marginLeft" : "marginRight"]: 8, verticalAlign: "middle",
          }}
        />
        {label}
      </div>
      <p className="t-h3 italic" style={{ margin: "0 0 8px", fontSize: 18, lineHeight: 1.25 }}>
        {r.headline}
      </p>
      <Link
        href={`/reading/${r.hash}`}
        className="t-mono"
        style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "lowercase", borderBottom: `1px solid ${color}`, color: "var(--ink)" }}
      >
        step into this one →
      </Link>
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
  const [morph, setMorph] = useState(0);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const morphRef = useRef(0);
  const draggingRef = useRef(false);
  const lastMorphAt = useRef(0);

  // full concern-delta diff, sorted by magnitude
  const diff: { k: ConcernKey; d: number }[] | null = (a && b)
    ? RADIAL_ORDER.map((k) => ({ k, d: (a.concerns[k] ?? 50) - (b.concerns[k] ?? 50) }))
      .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    : null;
  const topDiff = diff ? diff.slice(0, 4) : null;
  const topKeys = new Set<ConcernKey>((topDiff ?? []).filter((x) => x.d !== 0).slice(0, 3).map((x) => x.k));
  const totalDelta = diff ? diff.reduce((s, x) => s + Math.abs(x.d), 0) : 0;
  const deltaNorm = Math.min(1, totalDelta / 320);

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
    try { haptics.tap(); } catch { /* noop */ }
    window.setTimeout(() => {
      setHighlight((current) => (current === k ? null : current));
    }, 900);
  };

  // The morph gesture — dragging the shape (or the wipe) between a and b,
  // sounding the changing delta as it moves. Throttled audio + haptic + tape.
  const applyMorph = useCallback((next: number, sounding: boolean) => {
    const t = clamp01(next);
    morphRef.current = t;
    setMorph(t);
    if (!sounding) return;
    const now = performance.now();
    if (now - lastMorphAt.current < 90) return;
    lastMorphAt.current = now;
    try {
      getFieldAudio().playNote(50 + Math.round(t * 19) + Math.round(deltaNorm * 6), 92);
    } catch { /* noop */ }
    try { haptics.ripple(0.2 + deltaNorm * 0.4); } catch { /* noop */ }
    recordTape("ripple", 0.3 + t * 0.4, "compare/morph");
  }, [deltaNorm, recordTape]);

  const morphFromClientX = useCallback((clientX: number) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    applyMorph((clientX - rect.left) / Math.max(1, rect.width), true);
  }, [applyMorph]);

  return (
    <section className="rule" data-pretext-ignore="true">
      <div className="wrap">
        <div className="t-eyebrow">compare · two nights overlaid</div>
        <h2 className="t-h2 italic" style={{ marginTop: 12, marginBottom: 8 }}>
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
          <div className="compare-layout">
            <p className="t-meta" style={{ color: "var(--ink-2)", margin: "0 0 20px", maxWidth: "52ch" }}>
              drag across the shape to morph from{" "}
              <span style={{ color: "var(--candle)" }}>reading a</span> to{" "}
              <span style={{ color: "var(--sea)" }}>reading b</span>. the corners that travel
              furthest are where they differ most. hover an axis to read both.
            </p>

            {/* HERO — the directly manipulable morph */}
            <div
              ref={stageRef}
              className="morph-stage"
              onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
                draggingRef.current = true;
                morphFromClientX(e.clientX);
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
              }}
              onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => {
                if (!draggingRef.current) return;
                morphFromClientX(e.clientX);
              }}
              onPointerUp={(e: ReactPointerEvent<HTMLDivElement>) => {
                draggingRef.current = false;
                try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
                try { getFieldAudio().chime(); } catch { /* noop */ }
              }}
              onPointerCancel={() => { draggingRef.current = false; }}
            >
              <MorphCompass
                a={a}
                b={b}
                morph={morph}
                highlight={highlight}
                topKeys={topKeys}
                onAxis={setHighlight}
                onAxisLeave={() => setHighlight(null)}
                onAxisTap={(k) => pulseAxis(k, (a.concerns[k] ?? 50) - (b.concerns[k] ?? 50))}
              />
            </div>

            {/* the wipe — draggable slider between a and b (keyboard-accessible) */}
            <div className="morph-wipe">
              <span className="wipe-end" style={{ color: "var(--candle)" }}>a</span>
              <label style={{ flex: 1, display: "block", minHeight: 44, position: "relative" }}>
                <span className="sr-only">morph between reading a and reading b</span>
                <input
                  className="morph-range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={morph}
                  aria-label="morph between reading a and reading b"
                  aria-valuetext={`${Math.round(morph * 100)} percent toward reading b`}
                  onChange={(e) => applyMorph(Number(e.target.value), true)}
                  onPointerUp={() => { try { getFieldAudio().chime(); } catch { /* noop */ } }}
                />
              </label>
              <span className="wipe-end" style={{ color: "var(--sea)" }}>b</span>
              <output className="t-mono wipe-readout" aria-live="polite">
                {morph <= 0.04 ? "all a" : morph >= 0.96 ? "all b" : `${Math.round(morph * 100)}% → b`}
              </output>
            </div>

            {/* play the two source sigils */}
            <div className="morph-plays">
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

            {/* where they differ most — inspectable chips that light the compass */}
            {topDiff && (
              <div className="morph-deltas">
                <span className="t-eyebrow" style={{ marginRight: 4 }}>moving most</span>
                {topDiff.filter((x) => x.d !== 0).map(({ k, d }) => (
                  <button
                    key={k}
                    type="button"
                    onMouseEnter={() => setHighlight(k)}
                    onMouseLeave={() => setHighlight((c) => (c === k ? null : c))}
                    onClick={() => pulseAxis(k, d)}
                    className="t-mono delta-chip"
                    aria-label={`${k} differs by ${d}, ${d > 0 ? "stronger in a" : "stronger in b"}`}
                    style={{
                      borderColor: highlight === k ? "var(--candle)" : "var(--rule)",
                      background: highlight === k ? "rgba(200,115,42,0.08)" : "transparent",
                    }}
                  >
                    <span className="italic" style={{ fontFamily: "var(--font-serif)", fontSize: 15 }}>{k}</span>
                    <span style={{ marginLeft: 8, color: d > 0 ? "var(--candle)" : "var(--sea)" }}>
                      {d > 0 ? `+${d}` : d}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* compact identities + entry points */}
            <div className="morph-tags">
              <ReadingTag input={a} color="var(--candle)" label="reading a" align="start" />
              <ReadingTag input={b} color="var(--sea)" label="reading b" align="end" />
            </div>
          </div>
        )}

        <style>{`
          .compare-layout { margin-top: 28px; }
          .morph-stage {
            display: flex;
            justify-content: center;
            cursor: ew-resize;
            touch-action: none;
            -webkit-user-select: none;
            user-select: none;
            -webkit-tap-highlight-color: transparent;
          }
          .morph-stage svg g[role="button"]:focus-visible circle { stroke: var(--candle); stroke-width: 1; }
          .morph-wipe {
            display: flex;
            align-items: center;
            gap: 12px;
            max-width: 560px;
            margin: 4px auto 0;
          }
          .morph-wipe .wipe-end {
            font-family: var(--font-serif);
            font-style: italic;
            font-size: 17px;
          }
          .morph-range {
            -webkit-appearance: none;
            appearance: none;
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            left: 0;
            width: 100%;
            height: 28px;
            margin: 0;
            background: transparent;
            cursor: ew-resize;
          }
          .morph-range::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 999px;
            background: linear-gradient(90deg, var(--candle), var(--sea));
          }
          .morph-range::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 20px;
            height: 20px;
            margin-top: -8.5px;
            border-radius: 999px;
            border: 2px solid var(--paper, #fff);
            background: var(--ink);
            box-shadow: 0 1px 4px rgba(0,0,0,0.25);
            cursor: ew-resize;
          }
          .morph-range::-moz-range-track {
            height: 3px;
            border-radius: 999px;
            background: linear-gradient(90deg, var(--candle), var(--sea));
          }
          .morph-range::-moz-range-thumb {
            width: 20px;
            height: 20px;
            border-radius: 999px;
            border: 2px solid var(--paper, #fff);
            background: var(--ink);
            box-shadow: 0 1px 4px rgba(0,0,0,0.25);
            cursor: ew-resize;
          }
          .morph-range:focus-visible { outline: none; }
          .morph-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px rgba(200,115,42,0.4); }
          .wipe-readout {
            min-width: 74px;
            font-size: 11px;
            letter-spacing: 0.04em;
            color: var(--ink-2);
            text-align: right;
          }
          .morph-plays {
            display: flex;
            justify-content: center;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 18px;
          }
          .morph-deltas {
            display: flex;
            align-items: center;
            justify-content: center;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 22px;
          }
          .delta-chip {
            min-height: 44px;
            display: inline-flex;
            align-items: center;
            border: 1px solid var(--rule);
            color: var(--ink);
            padding: 6px 12px;
            cursor: pointer;
            transition: border-color var(--t), background var(--t);
          }
          .morph-tags {
            display: flex;
            justify-content: space-between;
            gap: 32px;
            margin-top: 30px;
            padding-top: 22px;
            border-top: 1px solid var(--rule);
          }
          .sr-only {
            position: absolute;
            width: 1px; height: 1px;
            padding: 0; margin: -1px;
            overflow: hidden;
            clip: rect(0 0 0 0);
            white-space: nowrap;
            border: 0;
          }
          @media (max-width: 620px) {
            .morph-tags { flex-direction: column; gap: 24px; }
            .morph-tags > div { text-align: left !important; max-width: none; }
            .wipe-readout { display: none; }
          }
          @media (prefers-reduced-motion: reduce) {
            .delta-chip { transition: none; }
          }
        `}</style>
      </div>
    </section>
  );
}

function compareButton(active: boolean, color: string): CSSProperties {
  return {
    background: active ? "var(--paper-2)" : "transparent",
    border: `1px solid ${active ? color : "var(--rule)"}`,
    color: active ? color : "var(--ink)",
    minHeight: 44,
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
