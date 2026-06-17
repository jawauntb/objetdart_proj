import type { CSSProperties } from "react";

export default function Sigil({
  size = 16,
  color = "currentColor",
  flicker = false,
  style,
  ...rest
}: {
  size?: number;
  color?: string;
  flicker?: boolean;
  style?: CSSProperties;
} & React.SVGProps<SVGSVGElement>) {
  // ◦ over │ — the candle.
  const flame = size * 0.18;
  const stem = size * 0.45;
  const stemX = size / 2;
  const stemTop = size * 0.36;
  const stemBot = size * 0.92;
  const ringCx = size / 2;
  const ringCy = size * 0.22;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className={flicker ? "sigil-flicker" : undefined}
      style={style}
      {...rest}
    >
      <circle
        className="touchable-line"
        cx={ringCx}
        cy={ringCy}
        r={flame}
        fill="none"
        stroke={color}
        strokeWidth={Math.max(1, size * 0.04)}
      />
      <line
        className="touchable-line"
        x1={stemX}
        x2={stemX}
        y1={stemTop}
        y2={stemBot}
        stroke={color}
        strokeWidth={Math.max(1, size * 0.04)}
      />
      <line
        className="touchable-line"
        x1={stemX}
        x2={stemX}
        y1={stemTop - stem * 0.15}
        y2={stemTop}
        stroke={color}
        strokeWidth={Math.max(1, size * 0.04)}
        opacity={0.6}
      />
    </svg>
  );
}
