"use client";

import { useEffect, useRef, useState } from "react";
import { useField } from "@/store/field";
import { CONCERNS, PRESET_KEYS, PRESETS } from "@/data/content";
import { getFieldAudio } from "@/lib/audio";
import type { ConcernKey } from "@/lib/types";

/**
 * The concern compass.
 *
 * Eight concerns laid out as radial axes from a single center. Each
 * vertex on the polygon is a draggable handle. The polygon is your
 * valence geometry — the shape of your concern tonight. Drag a vertex
 * outward or inward and the whole polygon morphs.
 *
 * Layout is intentional, not data-order: opposites face across the
 * compass (prayer ↔ body, work ↔ memory, future ↔ love,
 * friendship ↔ risk). The cross- and diagonal-axes are the four
 * inner-life polarities.
 */

const RADIAL_ORDER: ConcernKey[] = [
  "prayer",      // 0  ▲ top
  "future",      // 1  ◢ upper-right
  "work",        // 2  ▶ right
  "risk",        // 3  ◣ lower-right
  "body",        // 4  ▼ bottom
  "love",        // 5  ◣ lower-left
  "memory",      // 6  ◀ left
  "friendship",  // 7  ◤ upper-left
];

// SVG geometry
const R_MAX = 220;
const VIEW = 640;
const CX = VIEW / 2;
const CY = VIEW / 2;

function axisAngle(i: number) {
  // start at top, go clockwise
  return -Math.PI / 2 + (i * Math.PI * 2) / 8;
}

function axisVec(i: number) {
  const a = axisAngle(i);
  return { x: Math.cos(a), y: Math.sin(a) };
}

function pointAt(i: number, value: number) {
  const v = axisVec(i);
  const r = (value / 100) * R_MAX;
  return { x: CX + v.x * r, y: CY + v.y * r };
}

function labelAt(i: number, pad = 32) {
  const v = axisVec(i);
  return {
    x: CX + v.x * (R_MAX + pad),
    y: CY + v.y * (R_MAX + pad),
    anchor:
      Math.abs(v.x) < 0.25 ? ("middle" as const) :
      v.x > 0 ? ("start" as const) : ("end" as const),
    align:
      Math.abs(v.y) < 0.25 ? ("middle" as const) :
      v.y > 0 ? ("hanging" as const) : ("auto" as const),
  };
}

export default function ConcernField() {
  const concerns = useField((s) => s.concerns);
  const preset = useField((s) => s.preset);
  const setConcern = useField((s) => s.setConcern);
  const applyPreset = useField((s) => s.applyPreset);
  const recordTape = useField((s) => s.recordTape);

  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<ConcernKey | null>(null);
  const [hovering, setHovering] = useState<ConcernKey | null>(null);
  const [hoverPreset, setHoverPreset] = useState<string | null>(null);

  // map a client-space pointer to a value on a given axis
  const valueFromPointer = (k: ConcernKey, clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    const i = RADIAL_ORDER.indexOf(k);
    const v = axisVec(i);
    const dx = local.x - CX;
    const dy = local.y - CY;
    const t = (dx * v.x + dy * v.y) / R_MAX;
    return Math.max(0, Math.min(100, Math.round(t * 100)));
  };

  // global pointer move / up while dragging a vertex.
  // each drag holds a continuous tone tuned to that concern's voice +
  // current value, so the user is literally *playing* the compass.
  //
  // While dragging, we also emit small "ripple" tape events every ~120ms
  // with intensity scaled to pointer speed. Ripples aren't dedupe-merged
  // against concern events (different kind), so they show as a flowing
  // burst of small ripple glyphs on the tape during the drag.
  useEffect(() => {
    if (!dragging) return;
    const audio = getFieldAudio();
    audio.holdConcernTone(dragging, concerns[dragging] ?? 50);
    // mirror the audio hold on the store so global palette can tint
    useField.getState().setHeldConcern(dragging);

    // drag-speed tracking for ripple intensity
    let lastSampleAt = performance.now();
    let lastX: number | null = null;
    let lastY: number | null = null;
    let lastRippleAt = 0;
    let currentSpeed = 0; // px/sec, EMA-smoothed

    const onMove = (e: PointerEvent) => {
      const v = valueFromPointer(dragging, e.clientX, e.clientY);
      if (v != null) {
        setConcern(dragging, v);
        audio.holdConcernTone(dragging, v);
      }

      // update drag speed (EMA over the last few samples)
      const nowMs = performance.now();
      const dt = Math.max(1, nowMs - lastSampleAt) / 1000; // seconds
      if (lastX != null && lastY != null) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        const instSpeed = Math.hypot(dx, dy) / dt; // px/sec
        currentSpeed = currentSpeed * 0.6 + instSpeed * 0.4;
      }
      lastSampleAt = nowMs;
      lastX = e.clientX;
      lastY = e.clientY;

      // emit ripple roughly every 120ms while the drag is active
      if (nowMs - lastRippleAt >= 120) {
        lastRippleAt = nowMs;
        // map speed (0..~1500 px/s) into 0.15..0.7
        const intensity = Math.max(0.15, Math.min(0.7, 0.15 + currentSpeed / 2200));
        recordTape("ripple", intensity, dragging);
      }
    };
    const onUp = () => {
      audio.releaseConcernTone(dragging);
      useField.getState().setHeldConcern(null);
      setDragging(null);
      audio.chime();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      // safety: release if effect tears down mid-drag
      audio.releaseConcernTone(dragging);
      useField.getState().setHeldConcern(null);
    };
  }, [dragging, setConcern, concerns, recordTape]);

  // build the polygon points string
  const polygonPoints = RADIAL_ORDER.map((k, i) => {
    const p = pointAt(i, concerns[k]);
    return `${p.x},${p.y}`;
  }).join(" ");

  // preset ghost — preview the polygon shape of a hovered preset
  const ghostPoints = hoverPreset && PRESETS[hoverPreset]
    ? RADIAL_ORDER.map((k, i) => {
        const p = pointAt(i, PRESETS[hoverPreset][k]);
        return `${p.x},${p.y}`;
      }).join(" ")
    : null;

  return (
    <section id="concern-field" className="rule" data-touch-surface="true" style={{ scrollMarginTop: 72 }}>
      <div className="wrap">
        <div className="t-eyebrow">concern field · drag the points</div>
        <h2 className="t-h2 italic" style={{ marginTop: 12, marginBottom: 12 }}>
          weights maintained against time
        </h2>
        <p className="t-meta italic" style={{ color: "var(--ink-2)", maxWidth: "56ch", marginTop: 0 }}>
          eight concerns, eight axes. each vertex of the polygon is your weight
          on that axis. drag it inward or outward. the shape is your night.
        </p>

        <div
          className="concern-field__stage"
          style={{
            marginTop: 48,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            placeItems: "center",
          }}
        >
          <div style={{ width: "100%", maxWidth: 720 }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEW} ${VIEW}`}
              role="group"
              aria-label="concern compass"
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                // The compass is embedded inside the home page (not
                // fullscreen). touch-action "none" would trap vertical
                // page scroll. "pan-y" still lets the page scroll while
                // the vertex pointerdown captures the drag for value-setting.
                touchAction: "pan-y",
                userSelect: "none",
              }}
            >
              {/* concentric rings */}
              {[0.25, 0.5, 0.75, 1].map((t, i) => (
                <circle
                  key={i}
                  cx={CX}
                  cy={CY}
                  r={t * R_MAX}
                  fill="none"
                  stroke="var(--rule)"
                  strokeWidth={1}
                />
              ))}
              {/* 50-mark ring highlighted slightly */}
              <circle
                cx={CX}
                cy={CY}
                r={R_MAX * 0.5}
                fill="none"
                stroke="rgba(21,23,26,0.28)"
                strokeWidth={1}
                strokeDasharray="3 4"
              />

              {/* axes */}
              {RADIAL_ORDER.map((k, i) => {
                const end = pointAt(i, 100);
                const active = dragging === k || hovering === k;
                return (
                  <line
                    key={k}
                    x1={CX}
                    y1={CY}
                    x2={end.x}
                    y2={end.y}
                    stroke={active ? "var(--ink)" : "var(--rule)"}
                    strokeWidth={active ? 1.2 : 1}
                  />
                );
              })}

              {/* preset ghost — what the polygon would become on hover */}
              {ghostPoints && (
                <polygon
                  points={ghostPoints}
                  fill="rgba(200, 115, 42, 0.08)"
                  stroke="var(--candle)"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  style={{ pointerEvents: "none" }}
                />
              )}

              {/* the valence polygon — your shape tonight */}
              <polygon
                points={polygonPoints}
                fill="rgba(44, 74, 92, 0.16)"
                stroke="var(--ink)"
                strokeWidth={1.4}
                style={{ transition: dragging ? "none" : "all var(--t)" }}
              />

              {/* polygon inner stroke for depth */}
              <polygon
                points={polygonPoints}
                fill="none"
                stroke="rgba(44, 74, 92, 0.55)"
                strokeWidth={0.6}
                style={{ transition: dragging ? "none" : "all var(--t)" }}
              />

              {/* labels + readouts */}
              {RADIAL_ORDER.map((k, i) => {
                const meta = CONCERNS.find((c) => c.id === k)!;
                const l = labelAt(i, 36);
                const value = concerns[k];
                const active = dragging === k || hovering === k;
                return (
                  <g key={`label-${k}`} pointerEvents="none">
                    <text
                      x={l.x}
                      y={l.y}
                      textAnchor={l.anchor}
                      dominantBaseline={l.align}
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontWeight: 400,
                        fontSize: 20,
                        fill: active ? "var(--ink)" : "var(--ink-2)",
                      }}
                    >
                      {meta.label.toLowerCase()}
                    </text>
                    <text
                      x={l.x}
                      y={l.y + (l.align === "hanging" ? 22 : -22)}
                      textAnchor={l.anchor}
                      dominantBaseline={l.align}
                      style={{
                        fontFamily: "var(--font-text)",
                        fontSize: 13,
                        fill: active ? "var(--candle)" : "var(--ink-2)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {Math.round(value)}
                    </text>
                  </g>
                );
              })}

              {/* vertices (last so they sit on top) */}
              {RADIAL_ORDER.map((k, i) => {
                const p = pointAt(i, concerns[k]);
                const active = dragging === k;
                const hover = hovering === k;
                return (
                  <g key={`v-${k}`}>
                    {(active || hover) && (
                      <circle cx={p.x} cy={p.y} r={14}
                        fill="rgba(200,115,42,0.12)" stroke="none" />
                    )}
                    {/* Invisible larger touch target. At the default
                        embed width (~720px CSS over a 640 viewBox), 1 user
                        unit ≈ 1.13 CSS px; on a 360px phone it shrinks to
                        ~0.56 CSS px. A radius of 26 user units gives a ~30
                        CSS px target on phone and ~58 CSS px on desktop —
                        clears the 44 CSS px floor at typical mobile widths
                        while staying invisible. */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={26}
                      fill="transparent"
                      stroke="none"
                      style={{ cursor: "grab", touchAction: "none" } as React.CSSProperties}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        (e.target as Element).setPointerCapture?.(e.pointerId);
                        setDragging(k);
                      }}
                      onPointerEnter={() => setHovering(k)}
                      onPointerLeave={() => setHovering((h) => (h === k ? null : h))}
                    >
                      <title>{`${k}: ${Math.round(concerns[k])}`}</title>
                    </circle>
                    {/* Visible bead — pointer-events disabled so the larger
                        invisible target above receives all input. */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={active ? 7 : hover ? 6 : 5}
                      fill="var(--candle)"
                      stroke="var(--paper)"
                      strokeWidth={1.5}
                      style={{ pointerEvents: "none", transition: active ? "none" : "r var(--t)" }}
                    />
                  </g>
                );
              })}
            </svg>

            {/* glosses — small italic line for whoever the compass is currently lit on */}
            <div
              style={{
                marginTop: 16,
                textAlign: "center",
                minHeight: "1.6em",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 18,
                color: "var(--ink-2)",
              }}
            >
              {(() => {
                const lit = dragging ?? hovering;
                if (!lit) return "drag any point — opposites face across the compass";
                const c = CONCERNS.find((x) => x.id === lit);
                return c ? c.inscription : "";
              })()}
            </div>
          </div>
        </div>

        {/* presets */}
        <div className="t-eyebrow" style={{ marginTop: 56 }}>presets · snap the polygon</div>
        <div className="concern-field__presets" style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PRESET_KEYS.map((name) => {
            const on = preset === name;
            return (
              <button
                key={name}
                onClick={() => { applyPreset(name); getFieldAudio().bell(); }}
                onMouseEnter={() => setHoverPreset(name)}
                onMouseLeave={() => setHoverPreset((p) => (p === name ? null : p))}
                onFocus={() => setHoverPreset(name)}
                onBlur={() => setHoverPreset((p) => (p === name ? null : p))}
                aria-pressed={on}
                className={`chip${on ? " is-active" : ""}`}
              >
                {name.toLowerCase()}
              </button>
            );
          })}
        </div>

        <div className="concern-field__next-row" style={{ marginTop: 56, display: "flex", justifyContent: "flex-end" }}>
          <button
            className="concern-field__next"
            onClick={() => document.getElementById("reading")?.scrollIntoView({ behavior: "smooth" })}
            style={{
              background: "none",
              border: "1px solid var(--rule)",
              padding: "12px 18px",
              cursor: "pointer",
              fontFamily: "var(--font-text)",
              fontSize: 13,
              letterSpacing: "0.08em",
              textTransform: "lowercase",
              color: "var(--ink)",
              transition: "border-color var(--t), color var(--t)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--candle)";
              e.currentTarget.style.color = "var(--candle)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--rule)";
              e.currentTarget.style.color = "var(--ink)";
            }}
          >
            read the room →
          </button>
        </div>
      </div>
      <style>{`
        @media (max-width: 720px) {
          .concern-field__stage {
            margin-top: 30px !important;
          }
          .concern-field__presets .chip {
            min-height: 38px;
          }
          .concern-field__next-row {
            margin-top: 34px !important;
            justify-content: stretch !important;
          }
          .concern-field__next {
            width: 100%;
          }
        }
      `}</style>
    </section>
  );
}
