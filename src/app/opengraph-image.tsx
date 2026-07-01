import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const alt = "objet d'art — a gold medal you can hold.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadFont(filename: string): Promise<Buffer> {
  return readFile(path.join(process.cwd(), "src", "app", "_assets", filename));
}

export default async function Image() {
  const [serif, serifItalic, mono] = await Promise.all([
    loadFont("InstrumentSerif-Regular.ttf").catch(() => loadFont("CormorantGaramond-Light.ttf")),
    loadFont("InstrumentSerif-Italic.ttf").catch(() => loadFont("CormorantGaramond-Light.ttf")),
    loadFont("JetBrainsMono-Regular.ttf").catch(() => loadFont("SpaceMono-Regular.ttf")),
  ]);

  const D = 430; // coin diameter
  const R = D / 2;

  const vLetters = [
    { ch: "C", y: 62 },
    { ch: "S", y: 122 },
    { ch: "S", y: 176 },
    { ch: "M", y: 300 },
    { ch: "L", y: 360 },
  ];
  const hLetters = [
    { ch: "N", x: 62 },
    { ch: "D", x: 122 },
    { ch: "S", x: 176 },
    { ch: "M", x: 300 },
    { ch: "D", x: 360 },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(circle at 32% 50%, #241b0b 0%, #14100a 48%, #0a0906 100%)",
          color: "#F2EEE6",
          display: "flex",
          alignItems: "center",
          position: "relative",
        }}
      >
        {/* perimeter hairline */}
        <div
          style={{
            position: "absolute",
            inset: 28,
            border: "1px solid rgba(231,185,78,0.18)",
            display: "flex",
          }}
        />

        {/* golden vignette / glow behind the coin */}
        <div
          style={{
            position: "absolute",
            left: -120,
            top: 15,
            width: 720,
            height: 720,
            background:
              "radial-gradient(circle at 50% 50%, rgba(231,185,78,0.34) 0%, rgba(231,185,78,0) 60%)",
            display: "flex",
          }}
        />

        {/* coin — slightly left */}
        <div
          style={{
            position: "absolute",
            left: 110,
            top: (630 - D) / 2,
            width: D,
            height: D,
            borderRadius: 9999,
            background:
              "radial-gradient(circle at 42% 34%, #fff6da 0%, #e7b94e 44%, #8a6410 100%)",
            border: "5px solid #6b4d0d",
            boxShadow:
              "0 24px 70px rgba(0,0,0,0.7), inset 0 8px 20px rgba(255,255,255,0.45), inset 0 -16px 34px rgba(0,0,0,0.35)",
            display: "flex",
          }}
        >
          {/* beaded rim + inner rings */}
          <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`} style={{ position: "absolute", top: 0, left: 0 }}>
            {Array.from({ length: 60 }).map((_, i) => {
              const a = (i / 60) * Math.PI * 2;
              const cx = R + Math.cos(a) * (R - 18);
              const cy = R + Math.sin(a) * (R - 18);
              return <circle key={i} cx={cx} cy={cy} r={4.6} fill="#6b4d0d" opacity={0.85} />;
            })}
            <circle cx={R} cy={R} r={R - 42} fill="none" stroke="#6b4d0d" strokeWidth={3} opacity={0.55} />
            <circle cx={R} cy={R} r={R - 30} fill="none" stroke="#7a5a12" strokeWidth={2} strokeDasharray="3 8" opacity={0.5} />
          </svg>

          {/* cross vertical bar */}
          <div
            style={{
              position: "absolute",
              top: 52,
              left: R - 19,
              width: 38,
              height: D - 104,
              borderRadius: 10,
              background: "linear-gradient(180deg, #6b4d0d 0%, #5c420b 100%)",
              boxShadow: "inset 0 0 10px rgba(255,246,218,0.4)",
              display: "flex",
            }}
          />
          {/* cross horizontal bar */}
          <div
            style={{
              position: "absolute",
              top: R - 19,
              left: 52,
              width: D - 104,
              height: 38,
              borderRadius: 10,
              background: "linear-gradient(90deg, #6b4d0d 0%, #5c420b 100%)",
              boxShadow: "inset 0 0 10px rgba(255,246,218,0.4)",
              display: "flex",
            }}
          />

          {vLetters.map((l, i) => (
            <div
              key={`v${i}`}
              style={{
                position: "absolute",
                top: l.y,
                left: R - 19,
                width: 38,
                height: 38,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "Mono",
                fontSize: 24,
                color: "#fff6da",
              }}
            >
              {l.ch}
            </div>
          ))}
          {hLetters.map((l, i) => (
            <div
              key={`h${i}`}
              style={{
                position: "absolute",
                top: R - 19,
                left: l.x,
                width: 38,
                height: 38,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "Mono",
                fontSize: 24,
                color: "#fff6da",
              }}
            >
              {l.ch}
            </div>
          ))}

          {/* specular highlight */}
          <div
            style={{
              position: "absolute",
              top: 46,
              left: 70,
              width: 175,
              height: 120,
              borderRadius: 9999,
              background:
                "radial-gradient(circle at 40% 40%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 70%)",
              display: "flex",
            }}
          />
        </div>

        {/* wordmark block — right */}
        <div
          style={{
            position: "absolute",
            left: 610,
            top: 210,
            display: "flex",
            flexDirection: "column",
            gap: 20,
            width: 520,
          }}
        >
          <div
            style={{
              fontFamily: "Mono",
              fontSize: 20,
              letterSpacing: 12,
              textTransform: "uppercase",
              color: "rgba(231,185,78,0.75)",
              display: "flex",
            }}
          >
            an instrument
          </div>
          <div
            style={{
              fontFamily: "Serif",
              fontWeight: 400,
              fontSize: 132,
              lineHeight: 0.95,
              letterSpacing: "-0.02em",
              color: "#F5E9C6",
              display: "flex",
            }}
          >
            objet d&rsquo;art
          </div>
          <div
            style={{
              fontFamily: "SerifItalic",
              fontStyle: "italic",
              fontSize: 40,
              lineHeight: 1.2,
              color: "rgba(242,238,230,0.86)",
              display: "flex",
            }}
          >
            a gold medal you can hold
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Serif", data: serif, style: "normal", weight: 400 },
        { name: "SerifItalic", data: serifItalic, style: "italic", weight: 400 },
        { name: "Mono", data: mono, style: "normal", weight: 400 },
      ],
    },
  );
}
