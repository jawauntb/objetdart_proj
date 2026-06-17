import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodeReadingHash, buildReading } from "@/lib/reading";
import type { ConcernKey } from "@/lib/types";

export const runtime = "nodejs";
export const alt = "a reading kept on objet d'art";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadFont(filename: string): Promise<Buffer> {
  return readFile(path.join(process.cwd(), "src", "app", "_assets", filename));
}

const RADIAL_ORDER: ConcernKey[] = [
  "prayer", "future", "work", "risk", "body", "love", "memory", "friendship",
];

export default async function Image({ params }: { params: { hash: string } }) {
  const [serif, mono] = await Promise.all([
    loadFont("CormorantGaramond-Light.ttf"),
    loadFont("JetBrainsMono-Regular.ttf"),
  ]);

  const input = decodeReadingHash(params.hash);
  // fallback to a neutral state if the hash is bad
  const reading = input
    ? buildReading(input)
    : null;

  // sigil geometry
  const SIGIL_SIZE = 360;
  const cx = SIGIL_SIZE / 2;
  const cy = SIGIL_SIZE / 2;
  const rMax = SIGIL_SIZE * 0.42;
  const concerns = input?.concerns ?? Object.fromEntries(RADIAL_ORDER.map((k) => [k, 50])) as Record<ConcernKey, number>;
  const points = RADIAL_ORDER.map((k, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 8;
    const r = ((concerns[k] ?? 50) / 100) * rMax;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  const pointsStr = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const axisEnds = RADIAL_ORDER.map((_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 8;
    return { x: cx + Math.cos(a) * rMax, y: cy + Math.sin(a) * rMax };
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#F2EEE6",
          color: "#15171A",
          padding: "60px 80px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        {/* perimeter hairline */}
        <div
          style={{
            position: "absolute",
            inset: 28,
            border: "1px solid rgba(21,23,26,0.18)",
          }}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div
            style={{
              fontFamily: "Mono",
              fontSize: 20,
              letterSpacing: 12,
              textTransform: "uppercase",
              color: "#3A3D42",
              display: "flex",
            }}
          >
            reading · kept
          </div>
          <div
            style={{
              fontFamily: "Mono",
              fontSize: 20,
              letterSpacing: 8,
              textTransform: "uppercase",
              color: "#3A3D42",
              display: "flex",
            }}
          >
            objet d&rsquo;art
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 60,
          }}
        >
          {/* the polygon sigil — their shape */}
          <div style={{ display: "flex", position: "relative", width: SIGIL_SIZE, height: SIGIL_SIZE }}>
            <svg width={SIGIL_SIZE} height={SIGIL_SIZE} viewBox={`0 0 ${SIGIL_SIZE} ${SIGIL_SIZE}`}>
              <circle cx={cx} cy={cy} r={rMax} fill="none" stroke="rgba(21,23,26,0.18)" strokeWidth={1} />
              <circle cx={cx} cy={cy} r={rMax * 0.5} fill="none" stroke="rgba(21,23,26,0.12)" strokeWidth={1} />
              {axisEnds.map((p, i) => (
                <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(21,23,26,0.16)" strokeWidth={1} />
              ))}
              <polygon points={pointsStr} fill="rgba(44,74,92,0.18)" stroke="#15171A" strokeWidth={1.6} />
              {points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4} fill="#C8732A" />
              ))}
            </svg>
          </div>

          {/* headline + meta */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 26 }}>
            <div
              style={{
                fontFamily: "Serif",
                fontStyle: "italic",
                fontWeight: 300,
                fontSize: 64,
                lineHeight: 1.06,
                letterSpacing: "-0.012em",
                color: "#15171A",
                display: "flex",
                maxWidth: 700,
              }}
            >
              {reading ? reading.headline : "a candle inside the command center, facing the sea."}
            </div>

            <div
              style={{
                fontFamily: "Mono",
                fontSize: 18,
                color: "#3A3D42",
                letterSpacing: "0.04em",
                display: "flex",
              }}
            >
              {reading
                ? `${reading.top[0]} · ${reading.region.label.toLowerCase()}${reading.carried ? " · " + reading.carried.label.toLowerCase() : ""}`
                : "a reading kept"}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontFamily: "Mono",
          }}
        >
          <div
            style={{
              fontSize: 16,
              letterSpacing: 6,
              color: "#3A3D42",
              textTransform: "lowercase",
              display: "flex",
            }}
          >
            kept since 2010
          </div>
          <div
            style={{
              fontSize: 16,
              letterSpacing: 6,
              color: "#3A3D42",
              textTransform: "lowercase",
              display: "flex",
            }}
          >
            /reading/{params.hash.slice(0, 12)}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Serif", data: serif, style: "italic", weight: 300 },
        { name: "Mono", data: mono, style: "normal", weight: 400 },
      ],
    },
  );
}
