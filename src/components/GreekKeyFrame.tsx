"use client";

import React from "react";
import GreekKey from "@/components/GreekKey";

/**
 * GreekKeyFrame — a classical Hellenic window border.
 *
 * Wraps a content area in four meander bands (top, bottom, left, right) so
 * the viewport reads like a Greek picture frame rather than a single band.
 * The frame is non-interactive by default (pointerEvents: "none") so the
 * scene below stays fully clickable.
 *
 * Layout strategy:
 *   - Outer wrapper is `position: fixed; inset: top 0 0 0` (top offset is
 *     configurable so dark routes can leave the 56px sticky SiteHeader
 *     uncovered).
 *   - Top + bottom bands are full-width horizontal <GreekKey /> bands.
 *   - Left + right bands are also horizontal <GreekKey /> bands, rendered
 *     into a wrapper sized to the available vertical extent and then
 *     rotated ±90° with `transform-origin: top left`. After rotation the
 *     band sits flush against the corresponding edge.
 *   - Corner squares carry a tiny meander knot so the four bands appear
 *     continuous around each corner instead of stopping abruptly.
 *
 * On narrow viewports (≤ 640px) the band thickness collapses from the
 * default to `mobileThickness` so the frame doesn't dominate the canvas.
 */

type GreekKeyFrameProps = {
  /** Band width in px (used for top/bottom height and left/right width). */
  thickness?: number;
  /** Mobile band width — used when window.matchMedia("(max-width: 640px)"). */
  mobileThickness?: number;
  /** Stroke color of the meander. */
  color?: string;
  /** Pen weight inside the band, in px. */
  strokeThickness?: number;
  /** Opacity of the entire frame (the bands fade together). */
  opacity?: number;
  /** Top offset in px — set to 56 on routes with a sticky SiteHeader. */
  top?: number;
  /** Bottom offset in px. */
  bottom?: number;
  /** Should the frame block clicks? Defaults to "none" so it never does. */
  pointerEvents?: "none" | "auto";
  /** Stacking — kept below the SiteHeader (z-index 30) by default. */
  zIndex?: number;
};

export default function GreekKeyFrame({
  thickness = 22,
  mobileThickness = 16,
  color = "#B8693A",
  strokeThickness = 2,
  opacity = 0.55,
  top = 0,
  bottom = 0,
  pointerEvents = "none",
  zIndex = 20,
}: GreekKeyFrameProps) {
  // Resolve the active band thickness against the viewport. We track this
  // in state so a resize between portrait/landscape on tablets re-renders
  // the frame at the correct scale. Defaults to the desktop value during
  // SSR so the layout doesn't pop.
  const [isNarrow, setIsNarrow] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const t = isNarrow ? mobileThickness : thickness;

  // Corner ornament — a small square with a single nested meander notch.
  // Drawn once and reused at each corner via rotation; keeps the frame
  // visually continuous where horizontal and vertical bands meet.
  const corner = (rotateDeg: number, position: React.CSSProperties) => {
    const size = t;
    const inset = strokeThickness / 2;
    const cx = size / 2;
    const cy = size / 2;
    // A tiny meander knot — outer square + a single inward "L" tick — that
    // reads as a continuation of the band's spiral when chained between
    // horizontal and vertical neighbours.
    return (
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          width: size,
          height: size,
          transform: `rotate(${rotateDeg}deg)`,
          transformOrigin: "center center",
          ...position,
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
          focusable="false"
          style={{ display: "block" }}
        >
          {/* outer square */}
          <rect
            x={inset}
            y={inset}
            width={size - 2 * inset}
            height={size - 2 * inset}
            fill="none"
            stroke={color}
            strokeWidth={strokeThickness}
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
          {/* inward L — meander continuation */}
          <path
            d={`M ${cx} ${size - inset} L ${cx} ${cy} L ${size - inset} ${cy}`}
            fill="none"
            stroke={color}
            strokeWidth={strokeThickness}
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        </svg>
      </div>
    );
  };

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top,
        left: 0,
        right: 0,
        bottom,
        pointerEvents,
        zIndex,
        opacity,
      }}
    >
      {/* ── Top band ─────────────────────────────────────────────
          Full-width meander hugging the upper edge. Corners are drawn
          separately so the meander reads as a continuous frame. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: t,
          right: t,
          height: t,
          pointerEvents: "none",
        }}
      >
        <GreekKey
          variant="straight"
          color={color}
          height={t}
          thickness={strokeThickness}
        />
      </div>

      {/* ── Bottom band ──────────────────────────────────────────
          Rotated 180° so the meander faces inward (mirrors the top). */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: t,
          right: t,
          height: t,
          transform: "rotate(180deg)",
          transformOrigin: "center center",
          pointerEvents: "none",
        }}
      >
        <GreekKey
          variant="straight"
          color={color}
          height={t}
          thickness={strokeThickness}
        />
      </div>

      {/* ── Left band ───────────────────────────────────────────
          Vertical band: render a horizontal GreekKey inside a wrapper
          that fills the available vertical extent, then rotate -90°
          around its top-left so it lands flush against the left edge. */}
      <VerticalBand
        side="left"
        thickness={t}
        color={color}
        strokeThickness={strokeThickness}
      />

      {/* ── Right band ──────────────────────────────────────────
          Mirror of the left: rotated 90° so the meander faces inward. */}
      <VerticalBand
        side="right"
        thickness={t}
        color={color}
        strokeThickness={strokeThickness}
      />

      {/* ── Corner ornaments ─────────────────────────────────────
          A small meander knot at each corner — the four bands stop short
          of the corners (see the `left: t / right: t` insets above) so
          these squares can sit cleanly in the gap and bridge the bands.
      */}
      {corner(0,   { top: 0,     left: 0 })}
      {corner(90,  { top: 0,     right: 0 })}
      {corner(-90, { bottom: 0,  left: 0 })}
      {corner(180, { bottom: 0,  right: 0 })}
    </div>
  );
}

/**
 * VerticalBand — internal helper. Renders a horizontal <GreekKey /> into a
 * box sized to the available vertical extent, then rotates it ±90° so the
 * meander runs along the corresponding edge.
 *
 * Why rotate a horizontal SVG rather than draw a vertical pattern from
 * scratch? It keeps a single source of truth for the meander geometry
 * (in GreekKey.tsx) and means tweaks there ripple through the frame.
 */
function VerticalBand({
  side,
  thickness,
  color,
  strokeThickness,
}: {
  side: "left" | "right";
  thickness: number;
  color: string;
  strokeThickness: number;
}) {
  // We measure the wrapper's height after mount so the rotated band knows
  // how long to be. The CSS fallback is stable across SSR and hydration;
  // the ResizeObserver tightens it to the exact clipped height after mount.
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [length, setLength] = React.useState(0);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      // Use the parent's bounding height (the GreekKeyFrame wrapper). The
      // VerticalBand wrapper itself is `top: thickness; bottom: thickness`
      // so its own clientHeight already excludes the corner squares.
      setLength(Math.round(el.getBoundingClientRect().height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compose the rotation. CSS applies the transform list right-to-left, so
  // these read as "rotate first, then translate" — bringing the rotated
  // strip back into the wrapper's coordinate box.
  //
  // Left band:
  //   - Source is a horizontal band of (width: length, height: thickness).
  //   - rotate(90deg) around top-left maps it to (x: -thickness..0,
  //     y: 0..length); translating (thickness, 0) afterwards yields the
  //     desired (x: 0..thickness, y: 0..length).
  //   - The meander's "up" direction (toward the top of the SVG) now
  //     points to the RIGHT, i.e. inward — the picture-frame direction.
  //
  // Right band:
  //   - rotate(-90deg) around top-left maps the band to (x: 0..thickness,
  //     y: -length..0); translating (0, length) brings it back into
  //     (x: 0..thickness, y: 0..length). The meander's "up" now points
  //     to the LEFT, again inward.
  const bandLength = length > 0 ? `${length}px` : "100vh";
  const transform =
    side === "left"
      ? `translate(${thickness}px, 0) rotate(90deg)`
      : `translate(0, ${bandLength}) rotate(-90deg)`;

  return (
    <div
      ref={wrapRef}
      style={{
        position: "absolute",
        top: thickness,
        bottom: thickness,
        left: side === "left" ? 0 : undefined,
        right: side === "right" ? 0 : undefined,
        width: thickness,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* The inner box is the unrotated horizontal band. The transform on
          this element rotates it into place along the side edge. We use
          `transformOrigin: top left` so the math above lines up. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: bandLength,
          height: thickness,
          transform,
          transformOrigin: "top left",
        }}
      >
        <GreekKey
          variant="straight"
          color={color}
          height={thickness}
          thickness={strokeThickness}
        />
      </div>
    </div>
  );
}
