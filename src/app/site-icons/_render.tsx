import { ImageResponse } from "next/og";
import {
  SITE_ICON_VISUALS,
  type SiteIconKey,
  type SiteIconKind,
  type SiteIconVisual,
} from "@/lib/site-icon-config";

type ReadingPoint = {
  x: number;
  y: number;
};

export function renderIconImage(key: SiteIconKey, size: number): ImageResponse {
  const visual = SITE_ICON_VISUALS[key];

  return new ImageResponse(
    <IconArtwork visual={visual} size={size} />,
    { width: size, height: size },
  );
}

export function renderOpenGraphImage(key: SiteIconKey, readingPoints?: ReadingPoint[]): ImageResponse {
  const visual = SITE_ICON_VISUALS[key];

  return new ImageResponse(
    <OpenGraphArtwork visual={visual} readingPoints={readingPoints} />,
    { width: 1200, height: 630 },
  );
}

function IconArtwork({ visual, size }: { visual: SiteIconVisual; size: number }) {
  const medallion = size * 0.74;
  const halo = size * 0.92;
  const stroke = Math.max(1.2, size * 0.026);

  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundColor: visual.bg,
        backgroundImage:
          `radial-gradient(circle at 32% 24%, ${visual.glow} 0%, transparent 31%), ` +
          `radial-gradient(circle at 75% 78%, ${visual.bg2} 0%, transparent 48%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: halo,
          height: halo,
          borderRadius: size,
          border: `${Math.max(1, size * 0.014)}px solid ${hexAlpha(visual.accent, 0.2)}`,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: size * 0.52,
          height: size * 0.52,
          borderRadius: size,
          backgroundImage:
            `radial-gradient(circle at 45% 38%, ${hexAlpha(visual.accent, 0.32)} 0%, transparent 64%)`,
          display: "flex",
        }}
      />
      <div
        style={{
          width: medallion,
          height: medallion,
          borderRadius: size,
          backgroundImage:
            `radial-gradient(circle at 37% 28%, ${hexAlpha("#ffffff", 0.55)} 0%, transparent 20%), ` +
            `linear-gradient(145deg, ${hexAlpha(visual.accent, 0.96)}, ${hexAlpha(visual.accent2, 0.9)})`,
          border: `${Math.max(1.5, size * 0.032)}px solid ${hexAlpha(visual.ink, 0.46)}`,
          boxShadow:
            `0 ${size * 0.08}px ${size * 0.22}px rgba(0,0,0,0.48), ` +
            `inset 0 ${size * 0.03}px ${size * 0.08}px ${hexAlpha("#ffffff", 0.28)}, ` +
            `inset 0 -${size * 0.045}px ${size * 0.1}px rgba(0,0,0,0.32)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <Ring size={medallion} color={visual.ink} />
        <RouteSigilSvg
          kind={visual.kind}
          color={visual.ink}
          accent={visual.accent2}
          size={medallion * 0.64}
          stroke={stroke}
        />
      </div>
    </div>
  );
}

function OpenGraphArtwork({
  visual,
  readingPoints,
}: {
  visual: SiteIconVisual;
  readingPoints?: ReadingPoint[];
}) {
  return (
    <div
      style={{
        width: "1200px",
        height: "630px",
        backgroundColor: visual.bg,
        backgroundImage:
          `radial-gradient(circle at 30% 36%, ${hexAlpha(visual.glow, 0.62)} 0%, transparent 30%), ` +
          `radial-gradient(circle at 74% 56%, ${hexAlpha(visual.accent2, 0.35)} 0%, transparent 36%), ` +
          `linear-gradient(135deg, ${visual.bg} 0%, ${visual.bg2} 54%, ${visual.bg} 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 32,
          border: `1px solid ${hexAlpha(visual.ink, 0.18)}`,
          display: "flex",
        }}
      />
      <DecorativeField visual={visual} />
      <div
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: 520,
          backgroundImage:
            `radial-gradient(circle at 38% 30%, ${hexAlpha("#ffffff", 0.34)} 0%, transparent 18%), ` +
            `radial-gradient(circle at 56% 61%, ${hexAlpha(visual.accent, 0.96)} 0%, ${hexAlpha(visual.accent2, 0.9)} 56%, ${hexAlpha("#000000", 0.18)} 100%)`,
          border: `8px solid ${hexAlpha(visual.ink, 0.36)}`,
          boxShadow:
            "0 42px 120px rgba(0,0,0,0.58), " +
            `0 0 130px ${hexAlpha(visual.glow, 0.42)}, ` +
            "inset 0 24px 56px rgba(255,255,255,0.22), " +
            "inset 0 -34px 60px rgba(0,0,0,0.38)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ring size={520} color={visual.ink} />
        <RouteSigilSvg
          kind={visual.kind}
          color={visual.ink}
          accent={visual.accent2}
          size={315}
          stroke={6}
          readingPoints={readingPoints}
        />
      </div>
    </div>
  );
}

function DecorativeField({ visual }: { visual: SiteIconVisual }) {
  const flecks = Array.from({ length: 38 }, (_, i) => {
    const x = 70 + ((i * 97) % 1060);
    const y = 54 + ((i * 151) % 510);
    const r = 1.8 + ((i * 13) % 12) / 5;
    const opacity = 0.25 + ((i * 7) % 9) / 18;
    return { x, y, r, opacity };
  });

  return (
    <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", inset: 0 }}>
      <path
        d="M-30 452 C 168 360, 310 553, 504 423 C 695 296, 830 409, 1230 238"
        fill="none"
        stroke={hexAlpha(visual.ink, 0.13)}
        strokeWidth="2"
      />
      <path
        d="M-20 188 C 190 264, 318 76, 512 178 C 740 298, 915 107, 1220 174"
        fill="none"
        stroke={hexAlpha(visual.accent, 0.16)}
        strokeWidth="2"
      />
      <circle cx="600" cy="315" r="284" fill="none" stroke={hexAlpha(visual.ink, 0.08)} strokeWidth="1.5" />
      <circle cx="600" cy="315" r="226" fill="none" stroke={hexAlpha(visual.ink, 0.1)} strokeWidth="1.5" strokeDasharray="5 18" />
      {flecks.map((f, i) => (
        <circle
          key={i}
          cx={f.x}
          cy={f.y}
          r={f.r}
          fill={i % 3 === 0 ? visual.accent : i % 3 === 1 ? visual.accent2 : visual.ink}
          opacity={f.opacity}
        />
      ))}
    </svg>
  );
}

function Ring({ size, color }: { size: number; color: string }) {
  const r = size / 2 - size * 0.085;
  const beads = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    return {
      x: size / 2 + Math.cos(a) * r,
      y: size / 2 + Math.sin(a) * r,
    };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0 }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={size / 2 - size * 0.16}
        fill="none"
        stroke={hexAlpha(color, 0.4)}
        strokeWidth={size * 0.012}
      />
      {beads.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r={size * 0.012} fill={hexAlpha(color, 0.52)} />
      ))}
    </svg>
  );
}

function RouteSigilSvg({
  kind,
  color,
  accent,
  size,
  stroke,
  readingPoints,
}: {
  kind: SiteIconKind;
  color: string;
  accent: string;
  size: number;
  stroke: number;
  readingPoints?: ReadingPoint[];
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" style={{ position: "relative" }}>
      {renderSigil(kind, color, accent, stroke, readingPoints)}
    </svg>
  );
}

function renderSigil(
  kind: SiteIconKind,
  color: string,
  accent: string,
  stroke: number,
  readingPoints?: ReadingPoint[],
) {
  const s = {
    fill: "none",
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (kind) {
    case "home":
      return (
        <g>
          <path {...s} d="M60 14 C 71 31, 88 39, 87 62 C 86 84, 72 98, 60 104 C 48 98, 34 84, 33 62 C 32 39, 49 31, 60 14 Z" />
          <path {...s} d="M60 29 L60 91 M37 60 L83 60" />
          <circle cx="60" cy="60" r="14" fill={hexAlpha(accent, 0.45)} stroke={color} strokeWidth={stroke * 0.6} />
        </g>
      );
    case "atlas":
      return <path {...s} d="M26 58 C20 44 35 26 55 27 C77 24 98 38 99 59 C100 77 87 91 67 94 C46 98 29 88 24 72 C22 66 23 61 26 58 Z" />;
    case "ocean":
      return (
        <g>
          <path {...s} d="M16 58 C30 42 45 42 60 58 C75 74 90 74 104 58" />
          <path {...s} d="M16 76 C30 60 45 60 60 76 C75 92 90 92 104 76" opacity="0.8" />
          <circle cx="82" cy="35" r="9" fill={hexAlpha(accent, 0.45)} stroke={color} strokeWidth={stroke * 0.55} />
        </g>
      );
    case "tide":
      return (
        <g>
          <path {...s} d="M21 66 C39 42 57 42 75 66 C85 80 95 80 103 66" />
          <path {...s} d="M28 82 C45 67 62 67 79 82" opacity="0.65" />
          <path {...s} d="M79 23 C60 28 49 43 52 61 C63 52 75 47 93 51 C91 39 87 30 79 23 Z" fill={hexAlpha(accent, 0.36)} />
        </g>
      );
    case "waves":
      return (
        <g>
          <path {...s} d="M16 42 C29 33 42 51 55 42 C68 33 81 51 104 42" />
          <path {...s} d="M16 60 C29 51 42 69 55 60 C68 51 81 69 104 60" />
          <path {...s} d="M16 78 C29 69 42 87 55 78 C68 69 81 87 104 78" />
        </g>
      );
    case "sine":
      return (
        <g>
          <path {...s} d="M15 60 C30 22 45 22 60 60 C75 98 90 98 105 60" />
          <line x1="16" y1="60" x2="104" y2="60" stroke={color} strokeWidth={stroke * 0.45} opacity="0.45" />
        </g>
      );
    case "pretext":
      return (
        <g>
          <path {...s} d="M18 36 H96" opacity="0.55" />
          <path {...s} d="M24 58 H102" opacity="0.75" />
          <path {...s} d="M18 80 H84" opacity="0.55" />
          <path {...s} d="M23 67 C36 49 49 49 62 67 C73 82 85 82 97 67" />
        </g>
      );
    case "circularity":
      return (
        <g>
          <circle {...s} cx="60" cy="60" r="35" />
          <circle {...s} cx="60" cy="60" r="19" opacity="0.72" />
          <path {...s} d="M24 60 C36 37 47 37 60 60 C73 83 84 83 96 60" />
        </g>
      );
    case "beyond":
      return (
        <g>
          <path {...s} d="M18 78 C35 22 53 102 70 46 C83 5 93 57 104 35" />
          <path {...s} d="M23 39 C40 96 58 17 75 73 C88 115 98 63 109 85" opacity="0.62" />
        </g>
      );
    case "storm":
      return (
        <g>
          <path {...s} d="M15 76 C31 53 46 83 61 60 C78 35 91 67 105 45" />
          <path {...s} d="M69 14 L43 62 H62 L50 106 L84 52 H64 Z" fill={hexAlpha(accent, 0.38)} />
        </g>
      );
    case "clouds":
      return (
        <g>
          <path {...s} d="M24 70 C14 69 13 53 24 50 C28 32 51 30 59 45 C73 36 94 45 91 63 C105 64 105 82 91 83 H28" />
          <path {...s} d="M79 82 C94 89 102 95 99 104 C95 113 81 106 90 98" opacity="0.7" />
        </g>
      );
    case "aphros":
      return <path {...s} d="M61 61 C61 52 72 52 72 61 C72 74 52 74 52 58 C52 38 80 38 80 63 C80 91 42 91 42 57 C42 24 91 24 91 66 C91 109 29 109 29 60" />;
    case "flowers":
      return (
        <g>
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * Math.PI * 2;
            const x = 60 + Math.cos(a) * 22;
            const y = 60 + Math.sin(a) * 22;
            return <ellipse key={i} cx={x} cy={y} rx="13" ry="24" fill={hexAlpha(accent, 0.38)} stroke={color} strokeWidth={stroke * 0.48} transform={`rotate(${(a * 180) / Math.PI} ${x} ${y})`} />;
          })}
          <circle cx="60" cy="60" r="14" fill={hexAlpha(color, 0.42)} />
        </g>
      );
    case "fire":
      return (
        <g>
          <path {...s} d="M61 15 C66 38 91 47 88 76 C85 99 66 108 50 101 C33 94 25 77 34 58 C37 72 53 71 55 58 C58 43 48 36 61 15 Z" fill={hexAlpha(accent, 0.32)} />
          <path {...s} d="M62 57 C73 69 69 88 56 94 C44 88 43 73 54 62" opacity="0.75" />
        </g>
      );
    case "earth":
      return (
        <g>
          <path {...s} d="M20 65 L43 33 L60 55 L75 31 L101 65" />
          <path {...s} d="M18 72 H102" />
          <path {...s} d="M60 72 L60 106 M60 86 L42 104 M60 91 L78 106" opacity="0.78" />
        </g>
      );
    case "growth":
      return (
        <g>
          <path {...s} d="M18 86 C35 86 44 86 52 64 C60 38 72 30 102 30" />
          <path {...s} d="M55 62 C41 47 37 30 43 18 C56 22 64 38 55 62 Z" fill={hexAlpha(accent, 0.35)} />
          <path {...s} d="M65 48 C75 33 91 28 104 34 C100 49 82 58 65 48 Z" fill={hexAlpha(accent, 0.28)} />
        </g>
      );
    case "stars":
      return (
        <g>
          <path {...s} d="M25 33 L50 24 L67 45 L93 37 L78 69 L92 94 L58 83 L30 98 L39 64 Z" opacity="0.8" />
          {[
            [25, 33, 5],
            [50, 24, 4],
            [67, 45, 5],
            [93, 37, 4],
            [78, 69, 5],
            [58, 83, 4],
            [30, 98, 4],
          ].map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} fill={i % 2 ? accent : color} stroke="none" />
          ))}
        </g>
      );
    case "signal":
      return (
        <g>
          <line x1="18" y1="88" x2="102" y2="88" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
          {[18, 26, 34, 42, 50, 58, 66, 74, 82, 90, 98].map((x, i) => {
            const heights = [20, 44, 30, 64, 42, 76, 34, 52, 26, 46, 22];
            return <line key={i} x1={x} y1={88} x2={x} y2={88 - heights[i]} stroke={i % 3 === 1 ? accent : color} strokeWidth={stroke * 0.82} strokeLinecap="round" />;
          })}
        </g>
      );
    case "light":
      return (
        <g>
          <circle {...s} cx="45" cy="75" r="20" fill={hexAlpha(accent, 0.34)} />
          <path {...s} d="M59 61 L99 21" />
          <path {...s} d="M70 50 L99 50 M70 50 L70 21" opacity="0.68" />
        </g>
      );
    case "plasma":
      return (
        <g>
          <circle {...s} cx="48" cy="72" r="24" fill={hexAlpha(accent, 0.3)} />
          <path {...s} d="M64 56 C75 36 85 32 102 20" />
          <path {...s} d="M34 75 C47 59 59 88 72 73 C86 57 95 82 105 66" opacity="0.72" />
        </g>
      );
    case "pulse":
      return <path {...s} d="M14 64 H36 L43 75 L52 24 L65 96 L74 62 H106" />;
    case "charts":
      return (
        <g>
          {[31, 51, 71, 91].map((x, i) => {
            const top = [24, 35, 19, 42][i];
            const bottom = [82, 95, 72, 101][i];
            const bodyTop = [43, 48, 35, 57][i];
            const bodyHeight = [22, 28, 20, 24][i];
            return (
              <g key={x}>
                <line x1={x} y1={top} x2={x} y2={bottom} stroke={color} strokeWidth={stroke * 0.58} strokeLinecap="round" />
                <rect x={x - 8} y={bodyTop} width="16" height={bodyHeight} rx="2" fill={i % 2 ? hexAlpha(accent, 0.45) : hexAlpha(color, 0.38)} stroke={color} strokeWidth={stroke * 0.45} />
              </g>
            );
          })}
        </g>
      );
    case "time":
    case "watch":
      return (
        <g>
          <circle {...s} cx="60" cy="60" r="39" />
          <circle {...s} cx="60" cy="60" r="5" fill={hexAlpha(accent, 0.45)} />
          <path {...s} d="M60 60 L60 31 M60 60 L82 73" />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
            const x1 = 60 + Math.cos(a) * 33;
            const y1 = 60 + Math.sin(a) * 33;
            const x2 = 60 + Math.cos(a) * 39;
            const y2 = 60 + Math.sin(a) * 39;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={stroke * 0.55} strokeLinecap="round" />;
          })}
        </g>
      );
    case "movement":
      return (
        <g>
          <circle {...s} cx="44" cy="48" r="22" />
          <circle {...s} cx="78" cy="73" r="25" />
          <circle {...s} cx="44" cy="48" r="5" fill={hexAlpha(accent, 0.45)} />
          <circle {...s} cx="78" cy="73" r="6" fill={hexAlpha(accent, 0.45)} />
          <path {...s} d="M44 48 L78 73 M29 92 C50 107 74 108 96 91" opacity="0.7" />
        </g>
      );
    case "coin":
      return (
        <g>
          <circle {...s} cx="60" cy="60" r="42" fill={hexAlpha(accent, 0.2)} />
          <path {...s} d="M60 24 V96 M24 60 H96" />
          <circle cx="60" cy="60" r="9" fill={hexAlpha(color, 0.5)} />
        </g>
      );
    case "jewel":
      return (
        <g>
          <path {...s} d="M29 42 L45 23 H76 L93 42 L60 101 Z" fill={hexAlpha(accent, 0.25)} />
          <path {...s} d="M29 42 H93 M45 23 L60 101 M76 23 L60 101 M45 42 L60 23 L76 42" opacity="0.82" />
        </g>
      );
    case "archive":
      return (
        <g>
          <path {...s} d="M25 31 H95 V91 H25 Z" fill={hexAlpha(accent, 0.22)} />
          <path {...s} d="M25 51 H95 M25 71 H95 M45 42 H75 M45 62 H75 M45 82 H75" />
        </g>
      );
    case "kept":
      return (
        <g>
          <path {...s} d="M28 82 C42 43 78 43 92 82" />
          <path {...s} d="M60 21 V70" />
          <circle cx="60" cy="20" r="8" fill={hexAlpha(accent, 0.45)} stroke={color} strokeWidth={stroke * 0.55} />
          <circle cx="36" cy="86" r="5" fill={color} />
          <circle cx="84" cy="86" r="5" fill={color} />
        </g>
      );
    case "colophon":
      return (
        <g>
          <path {...s} d="M28 31 H92 V84 H28 Z" fill={hexAlpha(accent, 0.18)} />
          <path {...s} d="M38 44 H82 M38 58 H82 M38 72 H70" />
          <path {...s} d="M29 93 C48 82 72 82 91 93" opacity="0.78" />
        </g>
      );
    case "compare":
      return (
        <g>
          <polygon points="32,26 75,37 67,87 24,77" fill={hexAlpha(accent, 0.26)} stroke={color} strokeWidth={stroke} strokeLinejoin="round" />
          <polygon points="57,31 96,53 78,96 41,81" fill={hexAlpha(color, 0.18)} stroke={color} strokeWidth={stroke} strokeLinejoin="round" />
          <circle cx="60" cy="62" r="6" fill={hexAlpha(accent, 0.6)} />
        </g>
      );
    case "reading": {
      const points = readingPoints ?? [
        { x: 58, y: 22 },
        { x: 80, y: 37 },
        { x: 88, y: 60 },
        { x: 76, y: 84 },
        { x: 58, y: 94 },
        { x: 37, y: 80 },
        { x: 29, y: 59 },
        { x: 39, y: 36 },
      ];
      const pointString = points.map((p) => `${p.x},${p.y}`).join(" ");
      return (
        <g>
          <circle {...s} cx="60" cy="60" r="42" opacity="0.42" />
          <circle {...s} cx="60" cy="60" r="22" opacity="0.28" />
          {points.map((p, i) => (
            <line key={`axis-${i}`} x1="60" y1="60" x2={p.x} y2={p.y} stroke={color} strokeWidth={stroke * 0.34} opacity="0.38" />
          ))}
          <polygon points={pointString} fill={hexAlpha(accent, 0.3)} stroke={color} strokeWidth={stroke} strokeLinejoin="round" />
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="4" fill={i % 2 ? accent : color} />
          ))}
        </g>
      );
    }
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
