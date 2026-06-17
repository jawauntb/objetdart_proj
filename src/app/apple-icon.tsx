import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Apple home-screen tile: dark night-sea ground with a cream candle.
// High contrast at 60–120px, recognizable as "the candle".
export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(160deg, #08111c 0%, #0d1a2b 55%, #143046 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {/* soft warm halo behind the flame */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 60,
            width: 60,
            height: 60,
            borderRadius: 9999,
            background:
              "radial-gradient(circle, rgba(255,180,120,0.35) 0%, rgba(255,180,120,0) 70%)",
            display: "flex",
          }}
        />
        <svg width={130} height={150} viewBox="0 0 40 60">
          {/* ring flame */}
          <circle
            cx="20"
            cy="14"
            r="7"
            fill="none"
            stroke="#E8A062"
            strokeWidth={2.4}
          />
          {/* wick */}
          <line
            x1="20"
            x2="20"
            y1="21"
            y2="23.5"
            stroke="#F2EEE6"
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.75}
          />
          {/* candle body */}
          <line
            x1="20"
            x2="20"
            y1="23.5"
            y2="56"
            stroke="#F2EEE6"
            strokeWidth={2.6}
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
