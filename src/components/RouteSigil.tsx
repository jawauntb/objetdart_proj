import type { CSSProperties } from "react";

export type RouteSigilKind =
  | "atlas"
  | "tide"
  | "waves"
  | "storm"
  | "clouds"
  | "aphros"
  | "fire"
  | "earth"
  | "growth"
  | "stars"
  | "signal"
  | "plasma"
  | "pulse"
  | "charts"
  | "watch"
  | "archive"
  | "kept"
  | "colophon";

/**
 * Small, graphic, single-stroke sigils for each route in the constellation panel.
 * Each is drawn into a 24x24 viewBox with stroke 1.4 — same hand-drawn family.
 */
export default function RouteSigil({
  kind,
  size = 24,
  color = "currentColor",
  style,
}: {
  kind: RouteSigilKind;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  const common = {
    fill: "none" as const,
    stroke: color,
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "touchable-line",
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={style}
    >
      {renderSigil(kind, common)}
    </svg>
  );
}

function renderSigil(
  kind: RouteSigilKind,
  s: {
    fill: "none";
    stroke: string;
    strokeWidth: number;
    strokeLinecap: "round";
    strokeLinejoin: "round";
    className: string;
  },
) {
  switch (kind) {
    case "atlas":
      // a wobbly closed island shape
      return (
        <path
          {...s}
          d="M7 11 C 6 9, 8 6, 11 6 C 14 5.5, 17 7, 18 10 C 19 12.5, 17.5 15, 15 16 C 12 17.2, 9 17, 7.5 15 C 6.4 13.6, 6.6 12, 7 11 Z"
        />
      );
    case "tide":
      // single sine with one low point dot
      return (
        <>
          <path {...s} d="M3 12 C 6 8, 9 8, 12 12 C 15 16, 18 16, 21 12" />
          <circle cx="12" cy="14.6" r="0.9" fill={s.stroke} stroke="none" />
        </>
      );
    case "waves":
      // three stacked horizontal waves
      return (
        <>
          <path {...s} d="M3 8 C 6 6, 9 10, 12 8 C 15 6, 18 10, 21 8" />
          <path {...s} d="M3 12 C 6 10, 9 14, 12 12 C 15 10, 18 14, 21 12" />
          <path {...s} d="M3 16 C 6 14, 9 18, 12 16 C 15 14, 18 18, 21 16" />
        </>
      );
    case "storm":
      // a wave crest with a lightning bolt crossing it
      return (
        <>
          <path {...s} d="M3 15 C 6 12, 9 16, 12 13 C 15 10, 18 14, 21 11" />
          <path {...s} d="M13 4 L 9 12 L 12 12 L 10 20" />
        </>
      );
    case "clouds":
      // a small cloud with a curling tail (Minoan air glyph)
      return (
        <>
          <path
            {...s}
            d="M7 13 C 5.5 13, 5 11.5, 6 10.5 C 6.4 9, 8 8.5, 9 9.4 C 9.6 8, 11.4 7.8, 12.4 9 C 13.6 8.6, 15 9.6, 14.8 11 C 16 11.2, 16.2 13, 14.6 13 Z"
          />
          <path {...s} d="M14.6 13 C 16.5 14, 18 14.5, 19 16 C 19.6 17, 18.8 18, 17.6 17.6 C 16.8 17.3, 16.8 16.2, 17.8 16" />
        </>
      );
    case "aphros":
      // a logarithmic / nautilus spiral
      return (
        <path
          {...s}
          d="M12 12 C 12 10.8, 13.2 10.8, 13.2 12 C 13.2 13.6, 10.8 13.6, 10.8 11.4 C 10.8 9, 14 9, 14 12.4 C 14 15.6, 9.6 15.6, 9.6 11.8 C 9.6 7.4, 15.4 7.4, 15.4 12.8 C 15.4 18.4, 7.8 18.4, 7.8 12.2"
        />
      );
    case "fire":
      // flame: small triangle base with a curling wisp at the top
      return (
        <>
          {/* triangular flame base */}
          <path
            {...s}
            d="M9.5 18 L 12 11 L 14.5 18 Z"
          />
          {/* curling wisp rising from the tip */}
          <path
            {...s}
            d="M12 11 C 13.4 9, 11.2 7.4, 12.6 5.6 C 13.6 4.3, 12.6 3.4, 11.8 4.4"
          />
        </>
      );
    case "earth":
      // small mountain triangle above a horizontal earth line, with a
      // descending root branching below
      return (
        <>
          {/* mountain triangle */}
          <path {...s} d="M7 11 L 12 5 L 17 11" />
          {/* horizontal earth / ground line */}
          <line {...s} x1="3" y1="13" x2="21" y2="13" />
          {/* descending root: trunk + two branches */}
          <path {...s} d="M12 13 L 12 20" />
          <path {...s} d="M12 16 L 9 19" />
          <path {...s} d="M12 17 L 15 20" />
        </>
      );
    case "growth":
      // a small S-curve / sigmoid — flat seed, steep climb, plateau ceiling.
      // Two faint dashed reference lines mark the floor and the ceiling so
      // the eye reads it as a logistic curve, not just an undulating line.
      return (
        <>
          {/* floor reference (the seedbed) */}
          <line
            {...s}
            x1="3"
            y1="18"
            x2="21"
            y2="18"
            strokeDasharray="1.2 2"
            opacity="0.55"
          />
          {/* the sigmoid itself — flat at the start, rises through ~12, settles */}
          <path
            {...s}
            d="M3 18 C 6 18, 8 18, 10 14 C 12 9, 14 6, 17 6 C 19 6, 21 6, 21 6"
          />
          {/* a small dot at the inflection point */}
          <circle cx="11.5" cy="12" r="0.9" fill={s.stroke} stroke="none" />
        </>
      );
    case "stars":
      // a small naturalistic star cluster — six dots scattered like a real
      // patch of sky, with one polyline tracing a partial constellation
      // through four of them. Different from "kept" (which is a tidy
      // center-out 5-spoke asterisk) — this reads as a cluster, not a star.
      {
        const dots: Array<readonly [number, number, number]> = [
          [5.5,  6.8, 1.0],
          [10.5, 4.6, 0.7],
          [14.0, 8.5, 1.1],
          [18.2, 6.5, 0.7],
          [9.0,  13.0, 0.9],
          [16.5, 15.2, 0.8],
        ];
        return (
          <>
            {/* the connecting line — through four of the six */}
            <path
              {...s}
              d="M5.5 6.8 L 10.5 4.6 L 14 8.5 L 16.5 15.2"
            />
            {dots.map(([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} fill={s.stroke} stroke="none" />
            ))}
          </>
        );
      }
    case "signal":
      // vertical waveform — small line spectrum bars rising from a baseline
      {
        const baseline = 17;
        // deterministic heights (looks like a tiny FFT readout)
        const heights = [2.5, 5, 3.5, 8, 5.5, 9.5, 4, 6.5, 3, 5.5, 2.5];
        const left = 3.5;
        const span = 17;
        const step = span / (heights.length - 1);
        return (
          <>
            {/* baseline */}
            <line {...s} x1={left - 0.5} y1={baseline} x2={left + span + 0.5} y2={baseline} />
            {heights.map((h, i) => {
              const x = left + i * step;
              return (
                <line
                  key={i}
                  {...s}
                  x1={x}
                  y1={baseline}
                  x2={x}
                  y2={baseline - h}
                />
              );
            })}
          </>
        );
      }
    case "plasma":
      // a light source (circle) with a single ray emerging up-right —
      // light as point and beam, the wave/particle gesture in one mark.
      return (
        <>
          <circle {...s} cx="9.5" cy="14.5" r="3.2" />
          <line {...s} x1="11.8" y1="12.2" x2="19" y2="5" />
        </>
      );
    case "pulse":
      // a tiny QRS waveform — flat baseline, single sharp R spike with the
      // characteristic Q dip before and S dip after, then back to baseline.
      return (
        <path
          {...s}
          d="M3 12 L 8 12 L 9.2 13.6 L 10.6 7 L 12 16.4 L 13.4 12 L 21 12"
        />
      );
    case "charts":
      // a small candlestick: vertical wick line with a filled body rectangle
      // centered on it. Reads as a single candle on a price chart.
      return (
        <>
          {/* the wick — vertical line top to bottom */}
          <line {...s} x1="12" y1="4" x2="12" y2="20" />
          {/* the body — small filled rectangle */}
          <rect
            x="9.5"
            y="9"
            width="5"
            height="7"
            fill={s.stroke}
            stroke={s.stroke}
            strokeWidth={s.strokeWidth}
            strokeLinejoin={s.strokeLinejoin}
          />
        </>
      );
    case "watch":
      // a candle: circle (flame) on top of a stem
      return (
        <>
          <circle {...s} cx="12" cy="7" r="2" />
          <line {...s} x1="12" y1="9.5" x2="12" y2="19" />
        </>
      );
    case "archive":
      // three drawer-pull lines
      return (
        <>
          <line {...s} x1="5" y1="8" x2="19" y2="8" />
          <line {...s} x1="5" y1="12" x2="19" y2="12" />
          <line {...s} x1="5" y1="16" x2="19" y2="16" />
        </>
      );
    case "kept":
      // a 5-point asterisk constellation (lines from center to 5 points)
      {
        const cx = 12;
        const cy = 12;
        const r = 6;
        const pts = Array.from({ length: 5 }, (_, i) => {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
          return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
        });
        return (
          <>
            {pts.map(([x, y], i) => (
              <line key={i} {...s} x1={cx} y1={cy} x2={x} y2={y} />
            ))}
            {pts.map(([x, y], i) => (
              <circle key={`d${i}`} cx={x} cy={y} r="0.9" fill={s.stroke} stroke="none" />
            ))}
          </>
        );
      }
    case "colophon":
      // ⊕ — cross in circle
      return (
        <>
          <circle {...s} cx="12" cy="12" r="6" />
          <line {...s} x1="12" y1="6" x2="12" y2="18" />
          <line {...s} x1="6" y1="12" x2="18" y2="12" />
        </>
      );
  }
}
