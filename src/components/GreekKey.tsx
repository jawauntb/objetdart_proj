"use client";

import React from "react";

/**
 * GreekKey — a tileable Minoan/Greek meander border.
 *
 * Renders an SVG that fills its container's width via a `<pattern>` definition.
 * Three variants:
 *   - "straight"  — the canonical square-spiral meander, the workhorse band
 *   - "wave-key"  — meander interleaved with a small Aegean wave glyph
 *   - "circular"  — a closed ring of meander segments (a stamp, not a band)
 *
 * Crisp, graphic, paper-friendly. Use as a horizontal band at the top/bottom
 * of a scene, or as a circular stamp inline.
 */
export type GreekKeyVariant = "straight" | "wave-key" | "circular";

type GreekKeyProps = {
  variant?: GreekKeyVariant;
  color?: string;
  height?: number;
  thickness?: number;
  className?: string;
  style?: React.CSSProperties;
};

export default function GreekKey({
  variant = "straight",
  color = "#15171A",
  height = 24,
  thickness = 2,
  className,
  style,
}: GreekKeyProps) {
  // Stable but unique id so multiple instances on the page don't collide.
  // useId is safe in client components.
  const reactId = React.useId();
  const patternId = `gk-${reactId.replace(/[:]/g, "")}-${variant}`;

  if (variant === "circular") {
    // A circular stamp: 8 meander notches arranged radially around a ring.
    const size = height;
    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size / 2 - thickness / 2;
    const rInner = rOuter - thickness * 2.2;
    const segments = 8;
    const notches: string[] = [];
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 0.5) / segments) * Math.PI * 2;
      const ox = cx + Math.cos(a0) * rOuter;
      const oy = cy + Math.sin(a0) * rOuter;
      const mx = cx + Math.cos(a1) * (rOuter - thickness * 1.1);
      const my = cy + Math.sin(a1) * (rOuter - thickness * 1.1);
      notches.push(`M ${ox.toFixed(2)} ${oy.toFixed(2)} L ${mx.toFixed(2)} ${my.toFixed(2)}`);
    }
    return (
      <svg
        className={className}
        style={style}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        focusable="false"
      >
        <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke={color} strokeWidth={thickness} />
        <circle cx={cx} cy={cy} r={rInner} fill="none" stroke={color} strokeWidth={thickness} />
        <path d={notches.join(" ")} fill="none" stroke={color} strokeWidth={thickness} />
      </svg>
    );
  }

  // Banner variants. We render a <pattern> tile and fill a full-width rect.
  // Tile dimensions are normalized to the band height so the meander reads
  // proportionally at any scale.
  const h = height;
  const t = Math.max(1, thickness);

  // The unit meander tile: a continuous square spiral with a return key.
  // We design it inside a (tw × h) viewBox where tw = 1.4 * h, then chain via
  // pattern repeat. The path stays inside a band of (h - t) interior height.
  const tw = Math.round(h * 1.4);
  const inset = t / 2;

  // Coordinates for one meander unit. The spiral starts from the bottom-left,
  // turns inward into a square, comes back out, and connects to the next unit
  // along the bottom rail.
  // Layout (with h = 24, tw ≈ 34):
  //   - bottom rail at y = h - inset
  //   - the spiral occupies a band from y = inset to y = h - inset
  const top = inset;
  const bot = h - inset;
  const left = inset;
  const right = tw - inset;
  const mid = (top + bot) / 2;
  // inner spiral arms
  const a1 = top + (bot - top) * 0.28;
  const a2 = top + (bot - top) * 0.55;
  const x1 = left + (right - left) * 0.20;
  const x2 = left + (right - left) * 0.42;
  const x3 = left + (right - left) * 0.64;
  const x4 = left + (right - left) * 0.86;

  const meanderPath = [
    // bottom rail (chains tiles)
    `M ${left} ${bot}`,
    `L ${right} ${bot}`,
    // rise on the right
    `M ${x4} ${bot}`,
    `L ${x4} ${top}`,
    // top arm to mid
    `L ${x1} ${top}`,
    // drop to a1
    `L ${x1} ${a1}`,
    // arm across to x3
    `L ${x3} ${a1}`,
    // drop into the inner key
    `L ${x3} ${a2}`,
    `L ${x2} ${a2}`,
    `L ${x2} ${mid}`,
  ].join(" ");

  let bannerInner: React.ReactNode = (
    <path d={meanderPath} fill="none" stroke={color} strokeWidth={t} strokeLinecap="square" />
  );

  if (variant === "wave-key") {
    // Combine: a small Aegean wave on the lower half, the meander on the upper.
    // The wave is a series of half-circle scallops.
    const waveY = bot - t;
    const scallops = 4;
    const sw = (right - left) / scallops;
    const wavePath: string[] = [`M ${left} ${waveY}`];
    for (let i = 0; i < scallops; i++) {
      const sx0 = left + i * sw;
      const sx1 = sx0 + sw;
      const sxm = (sx0 + sx1) / 2;
      // alternate scallop direction — characteristic Aegean rhythm
      const dy = i % 2 === 0 ? -sw * 0.32 : sw * 0.18;
      wavePath.push(`Q ${sxm} ${waveY + dy} ${sx1} ${waveY}`);
    }
    // Upper-half meander, compressed
    const upperTop = top;
    const upperBot = (top + bot) / 2 - t * 0.25;
    const uMid = (upperTop + upperBot) / 2;
    const um1 = upperTop + (upperBot - upperTop) * 0.45;
    const ux1 = left + (right - left) * 0.18;
    const ux2 = left + (right - left) * 0.38;
    const ux3 = left + (right - left) * 0.62;
    const ux4 = left + (right - left) * 0.84;
    const upperMeander = [
      `M ${left} ${upperBot}`,
      `L ${right} ${upperBot}`,
      `M ${ux4} ${upperBot}`,
      `L ${ux4} ${upperTop}`,
      `L ${ux1} ${upperTop}`,
      `L ${ux1} ${um1}`,
      `L ${ux3} ${um1}`,
      `L ${ux3} ${uMid}`,
      `L ${ux2} ${uMid}`,
    ].join(" ");
    bannerInner = (
      <>
        <path d={upperMeander} fill="none" stroke={color} strokeWidth={t} strokeLinecap="square" />
        <path d={wavePath.join(" ")} fill="none" stroke={color} strokeWidth={t} strokeLinecap="round" />
      </>
    );
  }

  return (
    <svg
      className={className}
      style={{ display: "block", ...style }}
      width="100%"
      height={h}
      viewBox={`0 0 ${tw} ${h}`}
      preserveAspectRatio="xMinYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id={patternId}
          x={0}
          y={0}
          width={tw}
          height={h}
          patternUnits="userSpaceOnUse"
        >
          {bannerInner}
        </pattern>
      </defs>
      <rect x={0} y={0} width="100%" height={h} fill={`url(#${patternId})`} />
    </svg>
  );
}
