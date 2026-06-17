"use client";

import type { CSSProperties } from "react";
import { useId } from "react";

type Density = "default" | "dense" | "sparse";

type Star = {
  cx: number;
  cy: number;
  r: number;
  /** color hint: undefined = currentColor, "cyan" / "amber" = accent stops */
  tone?: "cyan" | "amber";
  /** twinkle period in seconds */
  period?: number;
  /** twinkle phase delay in seconds */
  delay?: number;
};

type Edge = [number, number]; // indices into the stars array

/**
 * A tiny constellation/nebula glyph.
 *
 * Layered, in z-order:
 *  1. faint nebula cloud (radial gradient on a circle)
 *  2. thin connecting lines (currentColor at low opacity)
 *  3. accent + small stars (some twinkle)
 *  4. central primary star + its cross flare + soft glow pulse
 *
 * Each star has its own period/delay so they twinkle out of phase.
 * Primary star pulses at 0.14 Hz (~7.14s) to match the site's master LFO.
 * Reduced-motion users see a static composition.
 */
export default function ConstellationGlyph({
  size = 16,
  twinkle = true,
  density = "default",
  hue,
  className,
  style,
}: {
  size?: number;
  twinkle?: boolean;
  density?: Density;
  hue?: string;
  className?: string;
  style?: CSSProperties;
}) {
  // Unique ids per instance — multiple glyphs on the page are safe.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const nebulaId = `cg-nebula-${uid}`;
  const glowId = `cg-glow-${uid}`;
  const animClass = `cg-${uid}`;

  const { stars, edges } = layoutForDensity(density);

  const starColor = hue ?? "currentColor";
  const lineStroke = hue ?? "currentColor";

  // We render keyframes + per-star animation rules in a scoped <style> block.
  // The CSS is gated by `prefers-reduced-motion: no-preference` so reduced-motion
  // users get a static glyph automatically — no JS / matchMedia required.
  const css = buildScopedCss(animClass, stars, twinkle);

  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-flex",
        lineHeight: 0,
        ...style,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        className={animClass}
        focusable="false"
      >
        <defs>
          {/* faint nebula cloud */}
          <radialGradient id={nebulaId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(180,220,255,0.22)" />
            <stop offset="35%" stopColor="rgba(220,180,255,0.14)" />
            <stop offset="70%" stopColor="rgba(255,200,170,0.08)" />
            <stop offset="100%" stopColor="rgba(255,200,170,0)" />
          </radialGradient>
          {/* soft glow on the primary star */}
          <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,244,214,0.85)" />
            <stop offset="55%" stopColor="rgba(255,224,180,0.35)" />
            <stop offset="100%" stopColor="rgba(255,224,180,0)" />
          </radialGradient>
        </defs>

        {/* 1. nebula cloud */}
        <circle cx="16" cy="16" r="15" fill={`url(#${nebulaId})`} />

        {/* 2. constellation lines */}
        <g
          stroke={lineStroke}
          strokeWidth={0.7}
          strokeLinecap="round"
          opacity={0.35}
          fill="none"
        >
          {edges.map(([a, b], i) => {
            const s1 = stars[a];
            const s2 = stars[b];
            return (
              <line
                key={i}
                x1={s1.cx}
                y1={s1.cy}
                x2={s2.cx}
                y2={s2.cy}
              />
            );
          })}
        </g>

        {/* 3. satellite stars */}
        <g>
          {stars.map((s, i) => {
            if (i === 0) return null; // primary drawn below
            const fill =
              s.tone === "cyan"
                ? "rgba(190,228,242,0.95)"
                : s.tone === "amber"
                  ? "rgba(255,214,166,0.95)"
                  : starColor;
            return (
              <circle
                key={i}
                className={`cg-star cg-star-${i}`}
                cx={s.cx}
                cy={s.cy}
                r={s.r}
                fill={fill}
              />
            );
          })}
        </g>

        {/* 4. primary star: glow + cross flare + core */}
        <g>
          <circle
            className="cg-glow"
            cx={stars[0].cx}
            cy={stars[0].cy}
            r={6.5}
            fill={`url(#${glowId})`}
          />
          {/* cross flare — vertical + horizontal long, diagonals short */}
          <g
            stroke={starColor}
            strokeLinecap="round"
            opacity={0.9}
          >
            <line
              x1={stars[0].cx}
              y1={stars[0].cy - 4.2}
              x2={stars[0].cx}
              y2={stars[0].cy + 4.2}
              strokeWidth={0.7}
            />
            <line
              x1={stars[0].cx - 4.2}
              y1={stars[0].cy}
              x2={stars[0].cx + 4.2}
              y2={stars[0].cy}
              strokeWidth={0.7}
            />
            <line
              x1={stars[0].cx - 2.2}
              y1={stars[0].cy - 2.2}
              x2={stars[0].cx + 2.2}
              y2={stars[0].cy + 2.2}
              strokeWidth={0.45}
              opacity={0.7}
            />
            <line
              x1={stars[0].cx - 2.2}
              y1={stars[0].cy + 2.2}
              x2={stars[0].cx + 2.2}
              y2={stars[0].cy - 2.2}
              strokeWidth={0.45}
              opacity={0.7}
            />
          </g>
          <circle
            cx={stars[0].cx}
            cy={stars[0].cy}
            r={stars[0].r}
            fill={starColor}
          />
        </g>
      </svg>
    </span>
  );
}

/* ---------- layout ---------- */

function layoutForDensity(density: Density): { stars: Star[]; edges: Edge[] } {
  // Index 0 is always the primary (central) star.
  // Coords live in the 0..32 viewBox. Positions are deliberately asymmetric.
  const base: Star[] = [
    { cx: 16, cy: 16, r: 1.4, period: 7.14, delay: 0 }, // 0 primary
    { cx: 6.5, cy: 8.5, r: 0.9, tone: "cyan", period: 2.1, delay: 0.0 }, // 1
    { cx: 24.5, cy: 7.2, r: 1.0, tone: "amber", period: 1.8, delay: 0.6 }, // 2
    { cx: 26.8, cy: 21.0, r: 0.85, period: 2.3, delay: 1.1 }, // 3
    { cx: 9.0, cy: 24.0, r: 1.05, tone: "cyan", period: 1.95, delay: 0.4 }, // 4
    { cx: 19.5, cy: 26.2, r: 0.8, tone: "amber", period: 2.05, delay: 1.4 }, // 5
    { cx: 4.0, cy: 18.0, r: 0.75, period: 1.7, delay: 0.9 }, // 6 (dense only)
  ];

  if (density === "sparse") {
    // primary + 3 satellites (1, 2, 4)
    const stars = [base[0], base[1], base[2], base[4]];
    return {
      stars,
      edges: [
        [0, 1],
        [0, 2],
        [0, 3],
      ],
    };
  }

  if (density === "dense") {
    // all 7
    return {
      stars: base,
      edges: [
        [0, 1],
        [0, 2],
        [0, 4],
        [1, 2],
        [2, 3],
        [3, 5],
        [4, 5],
        [1, 6],
        [4, 6],
      ],
    };
  }

  // default — 6 stars (drop index 6)
  return {
    stars: base.slice(0, 6),
    edges: [
      [0, 1],
      [0, 2],
      [0, 4],
      [2, 3],
      [3, 5],
      [4, 5],
    ],
  };
}

/* ---------- scoped css ---------- */

function buildScopedCss(scope: string, stars: Star[], twinkle: boolean): string {
  if (!twinkle) {
    return `.${scope} .cg-glow { opacity: 0.7; }`;
  }

  // Per-star twinkle rules (skip primary at index 0).
  const starRules = stars
    .map((s, i) => {
      if (i === 0) return "";
      const period = (s.period ?? 2).toFixed(2);
      const delay = (s.delay ?? 0).toFixed(2);
      return `.${scope} .cg-star-${i} { animation: cg-twinkle ${period}s ease-in-out ${delay}s infinite; transform-origin: ${s.cx}px ${s.cy}px; transform-box: fill-box; }`;
    })
    .join("\n");

  return `
    @keyframes cg-twinkle {
      0%, 100% { opacity: 0.42; }
      50% { opacity: 1; }
    }
    @keyframes cg-pulse {
      0%, 100% { opacity: 0.55; }
      50% { opacity: 1; }
    }
    .${scope} .cg-glow { opacity: 0.7; }
    @media (prefers-reduced-motion: no-preference) {
      ${starRules}
      .${scope} .cg-glow {
        animation: cg-pulse 7.14s ease-in-out infinite;
        transform-origin: 16px 16px;
        transform-box: fill-box;
      }
    }
  `;
}
