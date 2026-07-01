import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Apple home-screen tile: a polished gold St. Benedict medal on a dark luxe
// ground. Reads unmistakably as "a gold coin" at 60-120px.
export default async function AppleIcon() {
  // vertical arm: C S S M L — horizontal arm: N D S M D (center crossing skipped)
  const vLetters = [
    { ch: "C", y: 26 },
    { ch: "S", y: 50 },
    { ch: "S", y: 72 },
    { ch: "M", y: 122 },
    { ch: "L", y: 146 },
  ];
  const hLetters = [
    { ch: "N", x: 26 },
    { ch: "D", x: 50 },
    { ch: "S", x: 72 },
    { ch: "M", x: 122 },
    { ch: "D", x: 146 },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(circle at 50% 42%, #241b0b 0%, #14100a 55%, #0a0906 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {/* warm floor glow behind the coin */}
        <div
          style={{
            position: "absolute",
            width: 180,
            height: 180,
            background:
              "radial-gradient(circle at 50% 50%, rgba(231,185,78,0.35) 0%, rgba(231,185,78,0) 62%)",
            display: "flex",
          }}
        />

        {/* the coin */}
        <div
          style={{
            position: "relative",
            width: 158,
            height: 158,
            borderRadius: 9999,
            background:
              "radial-gradient(circle at 42% 34%, #fff6da 0%, #e7b94e 44%, #8a6410 100%)",
            border: "2px solid #6b4d0d",
            boxShadow:
              "0 6px 22px rgba(0,0,0,0.6), inset 0 3px 8px rgba(255,255,255,0.45), inset 0 -6px 14px rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* beaded / milled rim */}
          <svg
            width={158}
            height={158}
            viewBox="0 0 158 158"
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            {Array.from({ length: 44 }).map((_, i) => {
              const a = (i / 44) * Math.PI * 2;
              const cx = 79 + Math.cos(a) * 70;
              const cy = 79 + Math.sin(a) * 70;
              return <circle key={i} cx={cx} cy={cy} r={2.1} fill="#6b4d0d" opacity={0.85} />;
            })}
            {/* inner field ring */}
            <circle cx={79} cy={79} r={60} fill="none" stroke="#6b4d0d" strokeWidth={1.3} opacity={0.55} />
            {/* rim lettering hint band */}
            <circle cx={79} cy={79} r={65} fill="none" stroke="#7a5a12" strokeWidth={0.8} strokeDasharray="1.5 3.5" opacity={0.5} />
          </svg>

          {/* cross — vertical bar */}
          <div
            style={{
              position: "absolute",
              top: 20,
              left: 72,
              width: 14,
              height: 118,
              borderRadius: 4,
              background: "linear-gradient(180deg, #6b4d0d 0%, #5c420b 100%)",
              boxShadow: "inset 0 0 3px rgba(255,246,218,0.4)",
              display: "flex",
            }}
          />
          {/* cross — horizontal bar */}
          <div
            style={{
              position: "absolute",
              top: 72,
              left: 20,
              width: 118,
              height: 14,
              borderRadius: 4,
              background: "linear-gradient(90deg, #6b4d0d 0%, #5c420b 100%)",
              boxShadow: "inset 0 0 3px rgba(255,246,218,0.4)",
              display: "flex",
            }}
          />

          {/* letters on the vertical arm */}
          {vLetters.map((l, i) => (
            <div
              key={`v${i}`}
              style={{
                position: "absolute",
                top: l.y,
                left: 72,
                width: 14,
                height: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 700,
                color: "#fff6da",
              }}
            >
              {l.ch}
            </div>
          ))}
          {/* letters on the horizontal arm */}
          {hLetters.map((l, i) => (
            <div
              key={`h${i}`}
              style={{
                position: "absolute",
                top: 72,
                left: l.x,
                width: 14,
                height: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 700,
                color: "#fff6da",
              }}
            >
              {l.ch}
            </div>
          ))}

          {/* soft specular highlight */}
          <div
            style={{
              position: "absolute",
              top: 22,
              left: 30,
              width: 62,
              height: 44,
              borderRadius: 9999,
              background:
                "radial-gradient(circle at 40% 40%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 70%)",
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
