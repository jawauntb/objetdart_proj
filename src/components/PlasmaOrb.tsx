"use client";

import { useEffect, useRef } from "react";

/**
 * PlasmaOrb.
 *
 * A self-contained WebGL canvas that renders a glowing plasma-wave disc:
 * two crossing curved bands of color that breathe and refract, sitting
 * inside a soft radial bloom. The orb reads on both dark and light
 * backgrounds because alpha is driven by a radial falloff and everything
 * outside the unit disc is fully transparent.
 *
 * The shader does all the work in one full-canvas quad. Two band masks
 * are generated from sin/cos of fbm-warped coordinates so the ribbons
 * have organic edges rather than mechanical sine waveforms. A slow
 * 0.14 Hz LFO breathes the overall brightness; a higher-frequency
 * `flicker` term agitates the band positions and intensity.
 *
 * If WebGL is unavailable, a CSS radial-gradient + keyframe pulse
 * fallback paints in place so the piece still reads.
 */

type Palette = "candle" | "sea" | "flame";

type PaletteSpec = {
  a: [number, number, number];      // core / inner band tint
  aHot: [number, number, number];   // hotter midpoint of band A
  b: [number, number, number];      // counter band — paper/foam highlight
  glow: [number, number, number];   // outer radial glow
  /** CSS fallback colors (sRGB hex). */
  cssCore: string;
  cssGlow: string;
  cssBand: string;
};

const PALETTES: Record<Palette, PaletteSpec> = {
  candle: {
    a:    [1.000, 0.706, 0.431], // #FFB46E
    aHot: [1.000, 0.541, 0.235], // #FF8A3C
    b:    [0.957, 0.910, 0.839], // #F4E8D6
    glow: [0.784, 0.451, 0.165], // #C8732A
    cssCore: "#FFB46E",
    cssGlow: "#C8732A",
    cssBand: "#F4E8D6",
  },
  sea: {
    a:    [0.435, 0.812, 0.894], // #6FCFE4
    aHot: [0.173, 0.290, 0.361], // #2C4A5C
    b:    [0.863, 0.933, 0.957], // #DCEEF4
    glow: [0.102, 0.227, 0.322], // #1A3A52
    cssCore: "#6FCFE4",
    cssGlow: "#1A3A52",
    cssBand: "#DCEEF4",
  },
  flame: {
    a:    [1.000, 0.416, 0.235], // #FF6A3C
    aHot: [0.878, 0.231, 0.165], // #E03B2A
    b:    [0.949, 0.933, 0.902], // #F2EEE6
    glow: [0.784, 0.267, 0.094], // #C84418
    cssCore: "#FF6A3C",
    cssGlow: "#C84418",
    cssBand: "#F2EEE6",
  },
};

export default function PlasmaOrb({
  size = 280,
  palette = "candle",
  flicker = 0.4,
  className,
  style,
}: {
  size?: number;
  palette?: Palette;
  flicker?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // mirror props into a ref so the effect doesn't have to tear down on every prop change
  const propsRef = useRef({ palette, flicker });
  propsRef.current = { palette, flicker };

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    // ── WebGL setup ───────────────────────────────────────────────
    const gl =
      (canvas.getContext("webgl", { antialias: false, premultipliedAlpha: true, alpha: true }) ||
        canvas.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: true, alpha: true } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;

    if (!gl) {
      // CSS fallback. Mark wrap so the className-driven layer paints in.
      wrap.setAttribute("data-plasma-fallback", "1");
      return;
    }

    const vert = `
      attribute vec2 a_pos;
      varying vec2 vUv;
      void main() {
        vUv = a_pos;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;
    const frag = `
      precision highp float;
      uniform float u_time;
      uniform float u_size;
      uniform float u_flicker;
      uniform float u_reduced;
      uniform vec3  u_palette_a;
      uniform vec3  u_palette_a_hot;
      uniform vec3  u_palette_b;
      uniform vec3  u_palette_glow;
      varying vec2 vUv;

      // hash + value noise + fbm — organic substrate for the bands
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * vnoise(p);
          p *= 2.07;
          a *= 0.52;
        }
        return v;
      }

      void main() {
        // Centered uv in [-1, 1]; vUv already in [-1, 1] from the quad.
        vec2 uv = vUv;
        float r = length(uv);

        // Anything outside the unit disc is fully transparent. A small
        // smoothstep window prevents an aliased edge.
        float disc = 1.0 - smoothstep(0.98, 1.005, r);
        if (disc <= 0.0) {
          gl_FragColor = vec4(0.0);
          return;
        }

        float t = u_time;

        // Flow speed dampens hard under prefers-reduced-motion.
        float motion = mix(0.08, 1.0, 1.0 - u_reduced);
        float flow = 0.35 * motion;

        // Breath LFO at ~0.14 Hz, ±~14% brightness.
        float breath = 1.0 + sin(t * 6.2831853 * 0.14 * motion) * 0.14;

        // Higher-frequency flicker — scaled by flicker prop.
        // A small chorus of sines so it doesn't read as one regular wobble.
        float flickAmp = clamp(u_flicker, 0.0, 1.0);
        float flickA = sin(t * 7.3  * motion + uv.x * 2.1) * 0.5
                     + sin(t * 11.1 * motion + uv.y * 1.7) * 0.5;
        float flickB = sin(t * 9.4  * motion - uv.y * 2.3) * 0.5
                     + sin(t * 13.7 * motion + uv.x * 1.3) * 0.5;
        float fjitterA = flickA * flickAmp * 0.06;
        float fjitterB = flickB * flickAmp * 0.06;

        // FBM-warped sample positions for each band. The bands sweep at
        // crossed angles (one tracking uv.x + time, the other uv.y + time)
        // so they form an X through the disc.
        vec2 pA = uv * 1.6 + vec2(t * flow * 0.30, t * flow * 0.20);
        vec2 pB = uv * 1.6 + vec2(t * flow * -0.22, t * flow * 0.27);
        float nA = fbm(pA);
        float nB = fbm(pB + 17.3);

        // Two crossing band centers. Each one is a thin smoothstep
        // around a sinusoidal curve that's been warped by fbm.
        // Band A: roughly horizontal, S-curving across the disc.
        float curveA = sin((uv.x + nA * 0.45 + fjitterA) * 1.9 + t * flow * 0.55) * 0.45;
        float dA = abs(uv.y - curveA);
        float bandA = smoothstep(0.42, 0.02, dA);

        // Band B: roughly vertical, crossing it diagonally.
        float curveB = sin((uv.y + nB * 0.45 + fjitterB) * 1.7 + t * flow * 0.40 + 0.4) * 0.45;
        float dB = abs(uv.x - curveB);
        float bandB = smoothstep(0.42, 0.02, dB);

        // Inner turbulence inside the bands — gives the ribbons grain.
        float turbA = fbm(uv * 3.4 + vec2(t * flow * 0.5, 0.0));
        float turbB = fbm(uv * 3.4 + vec2(0.0, t * flow * -0.5) + 9.1);
        bandA *= mix(0.75, 1.10, turbA);
        bandB *= mix(0.75, 1.10, turbB);

        // Edge falloff — bands taper as they approach the rim of the disc.
        float rimFade = smoothstep(1.0, 0.55, r);
        bandA *= rimFade;
        bandB *= rimFade;

        // Hot core of band A — brighten where it's densest near the middle.
        float hotMix = pow(bandA, 1.6) * smoothstep(0.9, 0.0, r);

        // Radial bloom — soft glow peaking at center.
        float bloom = exp(-r * r * 2.6);
        float coreHi = exp(-r * r * 8.0); // tighter inner highlight

        // Compose color in linear-ish sRGB. Start from glow tint at low
        // density and lift toward the warmer band-A color as band A grows.
        vec3 col = u_palette_glow * bloom * 0.85;
        vec3 bandAColor = mix(u_palette_a, u_palette_a_hot, hotMix);
        col += bandAColor * bandA * 1.05;
        col += u_palette_b * bandB * 0.80;

        // Center spark — a small bright kernel so the orb feels lit, not flat.
        col += u_palette_b * coreHi * 0.35;
        col += u_palette_a_hot * coreHi * 0.25;

        // Apply breath + a small flicker on global brightness.
        float globalFlick = 1.0 + (flickA + flickB) * 0.04 * flickAmp;
        col *= breath * globalFlick;

        // Subtle inner shadow on the very rim so the disc reads as a sphere
        // rather than a flat disc.
        float rimShade = smoothstep(0.86, 1.0, r) * 0.35;
        col *= (1.0 - rimShade);

        // Alpha = radial falloff. Bands and bloom can push it up so the
        // densest parts are fully opaque while the edge feathers out.
        float aRadial = smoothstep(1.0, 0.0, r);
        float aField = clamp(bandA * 0.9 + bandB * 0.6 + bloom * 0.9 + coreHi * 1.0, 0.0, 1.0);
        float alpha = clamp(mix(aRadial * 0.35, 1.0, aField), 0.0, 1.0) * disc;

        // Premultiplied output — matches the canvas alpha mode and lets
        // the orb composite cleanly on both dark and light backgrounds.
        gl_FragColor = vec4(col * alpha, alpha);
      }
    `;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn("PlasmaOrb shader compile failed", gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };

    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) {
      wrap.setAttribute("data-plasma-fallback", "1");
      return;
    }

    const prog = gl.createProgram();
    if (!prog) {
      wrap.setAttribute("data-plasma-fallback", "1");
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("PlasmaOrb program link failed", gl.getProgramInfoLog(prog));
      wrap.setAttribute("data-plasma-fallback", "1");
      return;
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);

    // Premultiplied-alpha blending so the orb sits cleanly on any background.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const uTime    = gl.getUniformLocation(prog, "u_time");
    const uSize    = gl.getUniformLocation(prog, "u_size");
    const uFlicker = gl.getUniformLocation(prog, "u_flicker");
    const uReduced = gl.getUniformLocation(prog, "u_reduced");
    const uPalA    = gl.getUniformLocation(prog, "u_palette_a");
    const uPalAHot = gl.getUniformLocation(prog, "u_palette_a_hot");
    const uPalB    = gl.getUniformLocation(prog, "u_palette_b");
    const uPalGlow = gl.getUniformLocation(prog, "u_palette_glow");

    // ── resize handler ───────────────────────────────────────────
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (uSize) gl.uniform1f(uSize, Math.max(w, h));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── render loop ──────────────────────────────────────────────
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches ? 1 : 0;
    const onMq = () => { reduced = mq.matches ? 1 : 0; };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);

    const t0 = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const { palette: pal, flicker: fk } = propsRef.current;
      const p = PALETTES[pal] || PALETTES.candle;

      gl.useProgram(prog);
      if (uTime)    gl.uniform1f(uTime, t);
      if (uFlicker) gl.uniform1f(uFlicker, Math.max(0, Math.min(1, fk)));
      if (uReduced) gl.uniform1f(uReduced, reduced);
      if (uPalA)    gl.uniform3f(uPalA, p.a[0], p.a[1], p.a[2]);
      if (uPalAHot) gl.uniform3f(uPalAHot, p.aHot[0], p.aHot[1], p.aHot[2]);
      if (uPalB)    gl.uniform3f(uPalB, p.b[0], p.b[1], p.b[2]);
      if (uPalGlow) gl.uniform3f(uPalGlow, p.glow[0], p.glow[1], p.glow[2]);

      // Clear to transparent black each frame.
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onMq);
      // Best-effort GL teardown.
      try {
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      } catch {
        // ignore — context may already be lost
      }
    };
  }, []);

  // CSS fallback colors for this palette.
  const fallback = PALETTES[palette] || PALETTES.candle;

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      className={className}
      style={{
        position: "relative",
        width: size,
        height: size,
        // The fallback layer paints in via this CSS variable trick: the
        // wrapper renders a radial-gradient pulse, and the canvas (when
        // WebGL works) sits on top and covers it. When the canvas can't
        // initialise we set data-plasma-fallback so the gradient remains
        // visible — but it's harmless either way because the canvas is
        // fully transparent outside the disc.
        background: `radial-gradient(circle at 50% 50%,
          ${fallback.cssCore} 0%,
          ${fallback.cssGlow} 45%,
          transparent 72%)`,
        borderRadius: "50%",
        animation: "plasma-orb-pulse 7s ease-in-out infinite",
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        }}
      />
      <style>{`
        @keyframes plasma-orb-pulse {
          0%, 100% { filter: brightness(0.92); }
          50%      { filter: brightness(1.10); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-plasma-fallback="1"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
