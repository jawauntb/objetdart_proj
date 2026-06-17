import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const alt = "objet d'art — a candle inside the command center, facing the sea.";
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

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          // deep indigo to ocean — a sea seen from a lit room at night
          background:
            "linear-gradient(140deg, #08111c 0%, #0d1a2b 38%, #143046 72%, #1a4259 100%)",
          color: "#F2EEE6",
          padding: "78px 96px",
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
            border: "1px solid rgba(242,238,230,0.18)",
          }}
        />

        {/* subtle horizon wash — a low band of "sea" light */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 220,
            background:
              "linear-gradient(180deg, rgba(26,66,89,0) 0%, rgba(26,66,89,0.55) 100%)",
            display: "flex",
          }}
        />

        {/* constellation glyph — top-right */}
        <svg
          width="120"
          height="120"
          viewBox="0 0 32 32"
          style={{ position: "absolute", top: 60, right: 80 }}
        >
          {/* faint connecting lines */}
          <g stroke="#F2EEE6" strokeWidth={0.35} strokeLinecap="round" opacity={0.35} fill="none">
            <line x1="16" y1="16" x2="6.5" y2="8.5" />
            <line x1="16" y1="16" x2="24.5" y2="7.2" />
            <line x1="16" y1="16" x2="9" y2="24" />
            <line x1="24.5" y1="7.2" x2="26.8" y2="21" />
            <line x1="26.8" y1="21" x2="19.5" y2="26.2" />
            <line x1="9" y1="24" x2="19.5" y2="26.2" />
          </g>
          {/* satellite stars */}
          <circle cx="6.5" cy="8.5" r="0.9" fill="rgba(190,228,242,0.95)" />
          <circle cx="24.5" cy="7.2" r="1.0" fill="rgba(255,214,166,0.95)" />
          <circle cx="26.8" cy="21" r="0.85" fill="#F2EEE6" />
          <circle cx="9" cy="24" r="1.05" fill="rgba(190,228,242,0.95)" />
          <circle cx="19.5" cy="26.2" r="0.8" fill="rgba(255,214,166,0.95)" />
          {/* primary star — cross flare + core */}
          <g stroke="#FFF4D6" strokeLinecap="round" opacity={0.9}>
            <line x1="16" y1="11.8" x2="16" y2="20.2" strokeWidth={0.7} />
            <line x1="11.8" y1="16" x2="20.2" y2="16" strokeWidth={0.7} />
            <line x1="13.8" y1="13.8" x2="18.2" y2="18.2" strokeWidth={0.45} opacity={0.7} />
            <line x1="13.8" y1="18.2" x2="18.2" y2="13.8" strokeWidth={0.45} opacity={0.7} />
          </g>
          <circle cx="16" cy="16" r="1.6" fill="#FFF4D6" />
        </svg>

        {/* eyebrow row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              fontFamily: "Mono",
              fontSize: 22,
              letterSpacing: 14,
              textTransform: "uppercase",
              color: "rgba(242,238,230,0.62)",
              display: "flex",
            }}
          >
            an instrument
          </div>
          <div
            style={{
              fontFamily: "Mono",
              fontSize: 22,
              letterSpacing: 8,
              textTransform: "uppercase",
              color: "rgba(242,238,230,0.62)",
              display: "flex",
              // leave room for the glyph
              marginRight: 160,
            }}
          >
            kept since 2010
          </div>
        </div>

        {/* title block */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontFamily: "Serif",
              fontWeight: 400,
              fontSize: 168,
              lineHeight: 0.95,
              letterSpacing: "-0.02em",
              color: "#F2EEE6",
              display: "flex",
            }}
          >
            objet d&rsquo;art
          </div>
          <div
            style={{
              fontFamily: "SerifItalic",
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 44,
              lineHeight: 1.18,
              letterSpacing: "-0.005em",
              color: "rgba(242,238,230,0.86)",
              display: "flex",
              maxWidth: 980,
            }}
          >
            a candle inside the command center, facing the sea
          </div>
        </div>

        {/* footer row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontFamily: "Mono",
            position: "relative",
            zIndex: 1,
          }}
        >
          {/* candle bottom-left */}
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <svg width="48" height="78" viewBox="0 0 40 64">
              {/* ring flame */}
              <circle
                cx="20"
                cy="14"
                r="7"
                fill="none"
                stroke="#C8732A"
                strokeWidth={1.8}
              />
              {/* wick */}
              <line
                x1="20"
                x2="20"
                y1="21"
                y2="23"
                stroke="#F2EEE6"
                strokeWidth={1.4}
                opacity={0.7}
              />
              {/* body */}
              <line
                x1="20"
                x2="20"
                y1="23"
                y2="60"
                stroke="#F2EEE6"
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            </svg>
            <div
              style={{
                fontSize: 18,
                letterSpacing: 8,
                color: "rgba(242,238,230,0.62)",
                textTransform: "lowercase",
                display: "flex",
              }}
            >
              handle · calibrate · route · keep
            </div>
          </div>
          <div
            style={{
              fontSize: 22,
              letterSpacing: 6,
              color: "rgba(242,238,230,0.86)",
              textTransform: "lowercase",
              display: "flex",
            }}
          >
            objetdart
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
