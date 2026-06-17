import type { ConcernKey } from "@/lib/types";

/**
 * The concern polygon, rendered small as a personal mark.
 * Same eight-axis arrangement as the compass — same shape, smaller,
 * usable as an inline sigil next to a reading or in a permalink card.
 */
const RADIAL_ORDER: ConcernKey[] = [
  "prayer", "future", "work", "risk", "body", "love", "memory", "friendship",
];

export default function ConcernSigil({
  concerns,
  size = 88,
  stroke = "var(--ink)",
  fill = "rgba(44,74,92,0.18)",
  showRing = true,
  showDots = true,
  showAxes = false,
}: {
  concerns: Record<ConcernKey, number>;
  size?: number;
  stroke?: string;
  fill?: string;
  showRing?: boolean;
  showDots?: boolean;
  showAxes?: boolean;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const rMax = size * 0.42;

  const points = RADIAL_ORDER.map((k, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 8;
    const r = ((concerns[k] ?? 50) / 100) * rMax;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  const pointsStr = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      style={{ display: "inline-block" }}
    >
      {showRing && (
        <circle
          cx={cx} cy={cy} r={rMax}
          fill="none"
          stroke="var(--rule)"
          strokeWidth={1}
        />
      )}
      {showAxes && (
        <g stroke="var(--rule)" strokeWidth={0.5}>
          {RADIAL_ORDER.map((_, i) => {
            const a = -Math.PI / 2 + (i * Math.PI * 2) / 8;
            return (
              <line
                key={i}
                x1={cx} y1={cy}
                x2={cx + Math.cos(a) * rMax}
                y2={cy + Math.sin(a) * rMax}
              />
            );
          })}
        </g>
      )}
      <polygon className="touchable-line" points={pointsStr} fill={fill} stroke={stroke} strokeWidth={1.2} />
      {showDots && points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.6} fill="var(--candle)" />
      ))}
    </svg>
  );
}
