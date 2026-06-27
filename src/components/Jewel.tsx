"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";

/**
 * /jewel — Atelier d'Or.
 *
 * A gold & diamond audio-reactive "sound shader" playground. A full-screen
 * fragment shader paints molten-gold guilloché caustics studded with sharp
 * brilliant-cut sparkle glints, all of it shimmering and blooming with the
 * live FFT pulled off the shared audio engine. The pointer warps the gold
 * like a gravity lens; taps spawn ripples and pentatonic notes. A row of
 * faceted gem buttons play chords and shift the palette; a "pour gold"
 * sustain toggle holds a shimmering tone and ramps the field energy.
 *
 * WebGL plumbing mirrors SpacetimeShader.tsx exactly (compile/link, a_pos
 * fullscreen quad, ResizeObserver, prefers-reduced-motion, RAF, cleanup, and
 * a data-shader-fallback CSS gradient if WebGL/compile fails).
 */

const MAX_RIPPLES = 6;
// a warm pentatonic, chosen by pointer x
const PENTA = [60, 62, 64, 67, 69, 72, 74];

// the faceted gem buttons — each plays a chord (midi) and shifts palette hue.
type Gem = {
  key: string;
  label: string;
  chord: number[];
  hue: number; // palette warp -1..1 (cooler↔warmer/pinker)
  color: string; // svg accent
};
const GEMS: Gem[] = [
  { key: "citrine",  label: "citrine",  chord: [60, 64, 67],     hue: 0.0,  color: "#f6e6b4" },
  { key: "topaz",    label: "topaz",    chord: [62, 65, 69],     hue: 0.18, color: "#e7b94e" },
  { key: "amber",    label: "amber",    chord: [57, 60, 64],     hue: 0.35, color: "#d98f2e" },
  { key: "rose",     label: "rose",     chord: [64, 67, 71],     hue: -0.3, color: "#f3b9c8" },
  { key: "emerald",  label: "emerald",  chord: [55, 59, 62, 67], hue: -0.55, color: "#bfe6c2" },
  { key: "brilliant",label: "brilliant",chord: [72, 76, 79, 84], hue: 0.55, color: "#ffffff" },
];

export default function Jewel() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // pointer + smoothed warp
  const ptr = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, warp: 0.16, twarp: 0.16 });
  // ripple ring buffer: x, y (0..1), born time (s), strength
  const ripples = useRef(
    Array.from({ length: MAX_RIPPLES }, () => ({ x: 0.5, y: 0.5, born: -100, str: 0 })),
  );
  const ripIdx = useRef(0);
  // palette hue target + smoothed, driven by gem presses
  const hue = useRef({ v: 0, t: 0 });
  // sustain ("pour gold") energy boost
  const pour = useRef(0); // 0..1 smoothed
  const pourTarget = useRef(0);

  const [pouring, setPouring] = useState(false);
  const [activeGem, setActiveGem] = useState<string | null>(null);

  // sustain tone scheduler (repeated shimmering playNote while pouring)
  const pourTimer = useRef<number | null>(null);

  // spawn a ripple into the ring buffer
  const spawnRipple = (x: number, y: number, str: number, tNow: number) => {
    const r = ripples.current[ripIdx.current % MAX_RIPPLES];
    r.x = x; r.y = y; r.born = tNow; r.str = str;
    ripIdx.current = (ripIdx.current + 1) % MAX_RIPPLES;
  };
  // wall-clock seconds since component start, kept in sync with the draw loop
  const t0Ref = useRef(performance.now());
  const nowSec = () => (performance.now() - t0Ref.current) / 1000;

  const onGem = (g: Gem) => {
    const a = getFieldAudio();
    try {
      g.chord.forEach((m, i) => {
        window.setTimeout(() => { try { a.playNote(m, 420); } catch { /* noop */ } }, i * 55);
      });
    } catch { /* noop */ }
    haptics.ripple(0.7);
    useField.getState().recordTape("object", 0.7, `jewel/gem/${g.key}`);
    hue.current.t = g.hue;
    setActiveGem(g.key);
    window.setTimeout(() => setActiveGem((k) => (k === g.key ? null : k)), 260);
    // a big central ripple bloom on each gem
    spawnRipple(0.5, 0.42, 1.0, nowSec());
  };

  const setPour = (on: boolean) => {
    setPouring(on);
    pourTarget.current = on ? 1 : 0;
    const a = getFieldAudio();
    if (on) {
      try { a.bell(); } catch { /* noop */ }
      haptics.roll();
      useField.getState().recordTape("sigil", 0.9, "jewel/pour/on");
      // shimmering held tone: cascade soft pentatonic notes on an interval
      let step = 0;
      const fire = () => {
        try { a.playNote(PENTA[step % PENTA.length] + 12, 320); } catch { /* noop */ }
        step++;
      };
      fire();
      pourTimer.current = window.setInterval(fire, 360);
    } else {
      haptics.tap();
      useField.getState().recordTape("object", 0.4, "jewel/pour/off");
      if (pourTimer.current !== null) { window.clearInterval(pourTimer.current); pourTimer.current = null; }
    }
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    try { getFieldAudio().setAmbientProfile("light"); } catch { /* noop */ }

    const gl = (canvas.getContext("webgl", { antialias: false, premultipliedAlpha: true, alpha: true }) ||
      canvas.getContext("experimental-webgl" as "webgl", { alpha: true } as WebGLContextAttributes)) as WebGLRenderingContext | null;
    if (!gl) { wrap.setAttribute("data-shader-fallback", "1"); return; }

    const vert = `
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;

    const frag = `
      precision highp float;
      uniform float u_time;
      uniform float u_reduced;
      uniform vec2  u_res;
      uniform vec2  u_cursor;     // 0..1
      uniform float u_warp;       // attract strength
      uniform float u_energy;     // 0..1 overall audio energy
      uniform vec3  u_bands;      // low / mid / high 0..1
      uniform float u_hue;        // palette warp -1..1
      uniform float u_pour;       // sustain energy boost 0..1
      uniform vec3  u_rip[${MAX_RIPPLES}];  // x, y, age(seconds)
      uniform float u_ripStr[${MAX_RIPPLES}];

      float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }

      // 2D value noise for soft molten flow
      float vnoise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        float a = hash21(i);
        float b = hash21(i+vec2(1.0,0.0));
        float c = hash21(i+vec2(0.0,1.0));
        float d = hash21(i+vec2(1.0,1.0));
        return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
      }
      float fbm(vec2 p){
        float s = 0.0; float a = 0.5;
        for(int i=0;i<5;i++){ s += a*vnoise(p); p *= 2.02; a *= 0.5; }
        return s;
      }

      void main(){
        vec2 res = u_res;
        float ar = res.x / max(1.0, res.y);
        vec2 uv = (gl_FragCoord.xy / res) * 2.0 - 1.0;
        uv.x *= ar;

        float mo = 1.0 - u_reduced;                 // motion gate
        float energy = clamp(u_energy + u_pour*0.6, 0.0, 1.4);
        float t = u_time * mix(0.05, 0.55, mo) * (0.7 + energy*0.6);

        // ── pointer gravity warp (lens toward cursor) ──
        vec2 cur = (u_cursor * 2.0 - 1.0); cur.x *= ar; cur.y *= -1.0;
        vec2 toC = uv - cur;
        float dc = length(toC) + 0.05;
        float pull = u_warp * 0.42 / dc;
        vec2 wuv = uv - toC * pull;

        // ── ripple displacement (taps + gem booms) ──
        float ripField = 0.0;
        for(int i=0;i<${MAX_RIPPLES};i++){
          vec3 rp = u_rip[i];
          vec2 rc = (rp.xy * 2.0 - 1.0); rc.x *= ar; rc.y *= -1.0;
          float age = rp.z;
          if(age < 0.0 || age > 3.0) continue;
          float rd = length(uv - rc);
          float ring = sin(rd*24.0 - age*9.0);
          float env = exp(-rd*2.2) * exp(-age*1.7) * u_ripStr[i];
          ripField += ring * env;
          wuv += normalize(uv - rc + 1e-4) * ring * env * 0.06;
        }

        // ── molten-gold guilloché: crossed flow + rose-engine interference ──
        float flow = fbm(wuv*2.2 + vec2(t*0.6, -t*0.4) + ripField*0.4);
        float r = length(wuv);
        float a = atan(wuv.y, wuv.x);
        float rings = sin(r*38.0 - t*1.6 + flow*5.0);
        float rays  = sin(a*26.0 + r*6.0 - t*0.8);
        float guill = rings*0.55 + rays*0.35;
        float caustic = abs(flow*1.6 + guill*0.5);
        float vein = smoothstep(0.85, 0.18, caustic);   // bright gold veins

        // molten body brightness, breathing with low band
        float body = pow(vein, 1.4) * (0.65 + u_bands.x*0.9 + u_pour*0.5);

        // ── diamond / brilliant sparkle glints ──
        // place facets on a jittered grid; high band makes them bloom & flash.
        float spark = 0.0;
        vec3 disp = vec3(0.0);
        float scale = 13.0;
        vec2 gv = wuv * scale;
        vec2 cell = floor(gv);
        for(int oy=-1; oy<=1; oy++){
          for(int ox=-1; ox<=1; ox++){
            vec2 c2 = cell + vec2(float(ox), float(oy));
            float h = hash21(c2);
            float h2 = hash21(c2+7.3);
            // only some cells host a diamond
            if(h > 0.62){
              vec2 center = c2 + vec2(h2, fract(h*7.0));
              vec2 d = gv - center;
              float dist = length(d);
              // twinkle phase keyed to high band + time
              float ph = h*30.0 + t*3.4 + u_bands.z*8.0;
              float tw = 0.5 + 0.5*sin(ph);
              tw = pow(tw, 3.0);
              // sharp brilliant: cross-star + tight core
              float core = exp(-dist*dist*36.0);
              float star = max(0.0, 1.0 - abs(d.x)*9.0) * max(0.0, 1.0-abs(d.y)*0.7)
                         + max(0.0, 1.0 - abs(d.y)*9.0) * max(0.0, 1.0-abs(d.x)*0.7);
              float facet = (core*1.4 + star*0.5) * tw * (0.5 + energy*1.3);
              spark += facet;
              // prismatic dispersion at the glints — split rgb by angle
              float ang = atan(d.y, d.x);
              disp += vec3(
                facet * (0.5+0.5*sin(ang*3.0+0.0)),
                facet * (0.5+0.5*sin(ang*3.0+2.094)),
                facet * (0.5+0.5*sin(ang*3.0+4.188))
              );
            }
          }
        }

        // ── palette ── warm golds, white-hot diamond highs
        vec3 gLo = vec3(0.72, 0.52, 0.17);   // b8860b-ish deep gold
        vec3 gMid= vec3(0.905,0.725,0.305);  // e7b94e
        vec3 gHi = vec3(0.965,0.902,0.706);  // f6e6b4
        // hue warp: positive → warmer/amber, negative → cooler/rose
        vec3 warm = vec3(1.05, 0.92, 0.72);
        vec3 cool = vec3(0.92, 0.95, 1.02);
        vec3 hueTint = mix(vec3(1.0), u_hue > 0.0 ? warm : cool, abs(u_hue));

        vec3 base = vec3(0.045, 0.035, 0.022);          // dark lacquer ground
        vec3 col = base;
        col = mix(col, gLo, smoothstep(0.0, 0.5, body));
        col = mix(col, gMid, smoothstep(0.35, 0.85, body));
        col = mix(col, gHi, smoothstep(0.7, 1.05, body));
        col *= hueTint;

        // central warm bloom + gentle vignette
        col += gMid * exp(-r*r*0.7) * (0.12 + u_bands.y*0.25);
        col *= smoothstep(2.1, 0.1, r);

        // lens ridge ringing the cursor
        float lens = smoothstep(0.42, 0.0, abs(dc - 0.30)) * u_warp;
        col += gHi * lens * 0.5;

        // diamonds: white-hot core + prismatic fringe + bloom
        col += vec3(spark) * vec3(1.0, 0.97, 0.90) * 1.3;
        col += disp * 0.5;
        col += vec3(spark) * energy * 0.4;  // sound-driven over-bloom

        // ripple shimmer overlay
        col += gHi * max(0.0, ripField) * 0.18;

        // subtle filmic-ish lift so it reads opulent not garish
        col = col / (col + vec3(0.6));
        col = pow(col, vec3(0.92));

        float alpha = clamp(max(max(col.r,col.g),col.b)*1.3 + 0.05, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
      }
    `;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type); if (!s) return null;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) { wrap.setAttribute("data-shader-fallback", "1"); return; }
    const prog = gl.createProgram();
    if (!prog) { wrap.setAttribute("data-shader-fallback", "1"); return; }
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { wrap.setAttribute("data-shader-fallback", "1"); return; }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uReduced = gl.getUniformLocation(prog, "u_reduced");
    const uRes = gl.getUniformLocation(prog, "u_res");
    const uCursor = gl.getUniformLocation(prog, "u_cursor");
    const uWarp = gl.getUniformLocation(prog, "u_warp");
    const uEnergy = gl.getUniformLocation(prog, "u_energy");
    const uBands = gl.getUniformLocation(prog, "u_bands");
    const uHue = gl.getUniformLocation(prog, "u_hue");
    const uPour = gl.getUniformLocation(prog, "u_pour");
    const uRip = gl.getUniformLocation(prog, "u_rip");
    const uRipStr = gl.getUniformLocation(prog, "u_ripStr");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches ? 1 : 0;
    const onMq = () => { reduced = mq.matches ? 1 : 0; };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      ptr.current.tx = (e.clientX - rect.left) / rect.width;
      ptr.current.ty = (e.clientY - rect.top) / rect.height;
      ptr.current.twarp = 0.5;
    };
    const onLeave = () => { ptr.current.twarp = 0.16; };
    const onDown = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      // ignore taps that land on the UI controls
      const el = e.target as HTMLElement;
      if (el && el.closest && el.closest(".jw-ui")) return;
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      spawnRipple(x, y, 0.9, nowSec());
      ptr.current.twarp = 0.7;
      const midi = PENTA[Math.max(0, Math.min(PENTA.length - 1, Math.floor(x * PENTA.length)))];
      try { getFieldAudio().playNote(midi, 220); } catch { /* noop */ }
      haptics.ripple(0.6);
      useField.getState().recordTape("sigil", 0.8, "jewel/tap");
    };
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);
    wrap.addEventListener("pointerdown", onDown);

    // FFT buffers
    const ripVec = new Float32Array(MAX_RIPPLES * 3);
    const ripStrVec = new Float32Array(MAX_RIPPLES);
    let fftBuf: Uint8Array | null = null;

    let raf = 0;
    const t0 = performance.now();
    t0Ref.current = t0;
    const draw = (now: number) => {
      const p = ptr.current;
      p.x += (p.tx - p.x) * 0.09;
      p.y += (p.ty - p.y) * 0.09;
      p.warp += (p.twarp - p.warp) * 0.06;
      p.twarp += (0.16 - p.twarp) * 0.02;

      // pour energy smoothing
      pour.current += (pourTarget.current - pour.current) * 0.06;
      // hue smoothing + relax toward neutral
      hue.current.v += (hue.current.t - hue.current.v) * 0.07;
      hue.current.t += (0 - hue.current.t) * 0.01;

      // ── audio: pull FFT, compute energy + 3 bands ──
      let energy = 0.14 + pour.current * 0.3;   // gentle idle
      let bLow = 0.12, bMid = 0.1, bHigh = 0.08;
      try {
        const an = getFieldAudio().getAnalyser();
        if (an) {
          if (!fftBuf || fftBuf.length !== an.frequencyBinCount) {
            fftBuf = new Uint8Array(an.frequencyBinCount);
          }
          an.getByteFrequencyData(fftBuf);
          const n = fftBuf.length;
          let sum = 0, lo = 0, mi = 0, hi = 0;
          const loEnd = Math.floor(n * 0.12);
          const miEnd = Math.floor(n * 0.45);
          for (let i = 0; i < n; i++) {
            const v = fftBuf[i] / 255;
            sum += v;
            if (i < loEnd) lo += v;
            else if (i < miEnd) mi += v;
            else hi += v;
          }
          const avg = sum / n;
          energy = Math.max(energy, Math.min(1, avg * 2.6 + pour.current * 0.4));
          bLow = Math.min(1, (lo / Math.max(1, loEnd)) * 1.6);
          bMid = Math.min(1, (mi / Math.max(1, miEnd - loEnd)) * 2.2);
          bHigh = Math.min(1, (hi / Math.max(1, n - miEnd)) * 3.2);
        }
      } catch { /* noop */ }

      // pack ripples (age in seconds)
      const tSec = (now - t0) / 1000;
      for (let i = 0; i < MAX_RIPPLES; i++) {
        const r = ripples.current[i];
        ripVec[i * 3] = r.x;
        ripVec[i * 3 + 1] = r.y;
        ripVec[i * 3 + 2] = r.born < 0 ? -1 : tSec - r.born;
        ripStrVec[i] = r.str;
      }

      gl.uniform1f(uTime, tSec);
      gl.uniform1f(uReduced, reduced);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uCursor, p.x, p.y);
      gl.uniform1f(uWarp, p.warp);
      gl.uniform1f(uEnergy, energy);
      gl.uniform3f(uBands, bLow, bMid, bHigh);
      gl.uniform1f(uHue, hue.current.v);
      gl.uniform1f(uPour, pour.current);
      gl.uniform3fv(uRip, ripVec);
      gl.uniform1fv(uRipStr, ripStrVec);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // hide global site chrome while the atelier is mounted
    const hideStyle = document.createElement("style");
    hideStyle.textContent = ".oda-tape-shell,.oda-field-watch,.oda-candle-mark,.oda-sound-toggle{display:none !important;}";
    document.head.appendChild(hideStyle);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onMq);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      wrap.removeEventListener("pointerdown", onDown);
      hideStyle.remove();
      if (pourTimer.current !== null) { window.clearInterval(pourTimer.current); pourTimer.current = null; }
      gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className="jewel-shader" style={{ position: "fixed", inset: 0, background: "#0a0805" }}>
      <canvas ref={canvasRef} />

      {/* gold & diamond UI overlay */}
      <div className="jw-ui">
        <div className="jw-title">
          <span className="jw-title-main">Atelier d&rsquo;Or</span>
          <span className="jw-title-sub">gold &amp; diamond · sound shader</span>
        </div>

        <div className="jw-controls">
          <div className="jw-gems" role="group" aria-label="gems">
            {GEMS.map((g) => (
              <button
                key={g.key}
                type="button"
                className={`jw-gem ${activeGem === g.key ? "on" : ""}`}
                aria-label={g.label}
                onPointerDown={(e) => { e.preventDefault(); onGem(g); }}
              >
                <Diamond accent={g.color} />
                <span className="jw-gem-label">{g.label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`jw-pour ${pouring ? "on" : ""}`}
            aria-pressed={pouring}
            onPointerDown={(e) => { e.preventDefault(); setPour(!pouring); }}
          >
            <span className="jw-pour-glow" />
            {pouring ? "pouring gold…" : "pour gold"}
          </button>
        </div>

        <div className="jw-hint">tap the field for chimes · drag to warp the gold · play the gems · pour to hold a shimmer</div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .jewel-shader canvas { width: 100%; height: 100%; display: block; }
        .jewel-shader[data-shader-fallback="1"] {
          background:
            repeating-radial-gradient(circle at 50% 42%, rgba(231,185,78,0.10) 0 2px, transparent 2px 9px),
            radial-gradient(circle at 50% 40%, rgba(246,230,180,0.22), rgba(10,8,5,0) 62%),
            radial-gradient(circle at 50% 50%, rgba(184,134,11,0.18), #0a0805 70%);
        }

        .jw-ui {
          position: absolute; inset: 0; z-index: 10;
          pointer-events: none;
          display: flex; flex-direction: column;
          justify-content: space-between;
          padding: calc(72px + env(safe-area-inset-top, 0px)) 20px
                   calc(22px + env(safe-area-inset-bottom, 0px)) 20px;
        }

        .jw-title { display: grid; gap: 4px; justify-items: start;
          text-shadow: 0 2px 18px rgba(0,0,0,0.55); }
        .jw-title-main {
          font-family: var(--font-fraunces, var(--font-serif, Georgia), serif);
          font-weight: 600; font-size: clamp(26px, 6vw, 46px);
          letter-spacing: 0.01em; line-height: 1;
          background: linear-gradient(180deg, #fff6da 0%, #f6e6b4 28%, #e7b94e 64%, #b8860b 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: #e7b94e;
        }
        .jw-title-sub {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px; letter-spacing: 0.22em; text-transform: lowercase;
          color: rgba(246,230,180,0.72);
        }

        .jw-controls {
          display: flex; flex-direction: column; gap: 14px; align-items: center;
        }
        .jw-gems {
          pointer-events: auto;
          display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;
        }
        .jw-gem {
          appearance: none; cursor: pointer; pointer-events: auto;
          display: flex; flex-direction: column; align-items: center; gap: 5px;
          width: 78px; padding: 10px 6px 8px;
          border-radius: 14px;
          border: 1px solid rgba(231,185,78,0.42);
          background: linear-gradient(180deg, rgba(40,30,12,0.42), rgba(14,10,5,0.32));
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          box-shadow: 0 1px 0 rgba(255,240,200,0.18) inset, 0 8px 24px rgba(0,0,0,0.4);
          transition: transform .14s ease, border-color .18s ease, box-shadow .18s ease;
        }
        .jw-gem svg { width: 40px; height: 40px; display: block;
          filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5)); transition: transform .14s ease; }
        .jw-gem:hover { border-color: rgba(246,230,180,0.85); transform: translateY(-2px); }
        .jw-gem:hover svg { transform: scale(1.06) rotate(-2deg); }
        .jw-gem:active { transform: translateY(0) scale(0.97); }
        .jw-gem.on {
          border-color: #fff6da;
          box-shadow: 0 0 0 1px rgba(255,246,218,0.6) inset, 0 0 26px rgba(246,230,180,0.55);
        }
        .jw-gem.on svg { transform: scale(1.16); }
        .jw-gem-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px; letter-spacing: 0.1em; text-transform: lowercase;
          color: rgba(246,230,180,0.82);
        }

        .jw-pour {
          position: relative; overflow: hidden;
          appearance: none; cursor: pointer; pointer-events: auto;
          padding: 12px 26px; min-height: 48px; border-radius: 999px;
          font-family: var(--font-fraunces, var(--font-serif, Georgia), serif);
          font-size: 16px; letter-spacing: 0.02em;
          color: #2a1d05;
          border: 1px solid rgba(255,246,218,0.7);
          background: linear-gradient(180deg, #fff6da, #f6e6b4 38%, #e7b94e 78%, #c9962f 100%);
          box-shadow: 0 2px 0 rgba(255,255,255,0.5) inset,
                      0 -3px 8px rgba(120,80,10,0.4) inset,
                      0 10px 30px rgba(231,185,78,0.35);
          transition: transform .14s ease, box-shadow .2s ease, filter .2s ease;
        }
        .jw-pour:hover { transform: translateY(-1px); }
        .jw-pour:active { transform: translateY(1px) scale(0.99); }
        .jw-pour.on {
          color: #fff6da;
          background: linear-gradient(180deg, #c9962f, #b8860b 55%, #8a6410 100%);
          box-shadow: 0 0 0 1px rgba(255,246,218,0.5) inset, 0 0 34px rgba(246,230,180,0.7);
          animation: jwPourPulse 1.4s ease-in-out infinite;
        }
        .jw-pour-glow {
          position: absolute; inset: -40%;
          background: radial-gradient(circle at 50% 0%, rgba(255,255,255,0.6), transparent 60%);
          opacity: 0; transition: opacity .25s ease; pointer-events: none;
        }
        .jw-pour.on .jw-pour-glow { opacity: 0.5; animation: jwGlow 1.4s ease-in-out infinite; }
        @keyframes jwPourPulse {
          0%,100% { box-shadow: 0 0 0 1px rgba(255,246,218,0.5) inset, 0 0 22px rgba(246,230,180,0.5); }
          50%     { box-shadow: 0 0 0 1px rgba(255,246,218,0.7) inset, 0 0 44px rgba(246,230,180,0.95); }
        }
        @keyframes jwGlow { 0%,100% { transform: translateY(6px); } 50% { transform: translateY(-2px); } }

        .jw-hint {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px; letter-spacing: 0.08em; text-transform: lowercase;
          text-align: center; color: rgba(246,230,180,0.5);
          text-shadow: 0 1px 8px rgba(0,0,0,0.6);
        }

        @media (max-width: 560px) {
          .jw-ui { padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
          .jw-gem { width: 84px; padding: 12px 6px 10px; }
          .jw-gem svg { width: 44px; height: 44px; }
          .jw-pour { font-size: 17px; padding: 14px 28px; min-height: 52px; }
          .jw-hint { font-size: 9px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .jw-pour.on, .jw-pour.on .jw-pour-glow { animation: none; }
        }
      ` }} />
    </div>
  );
}

/** Inline brilliant-cut diamond with a gold gradient and white facet highlights. */
function Diamond({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`jwGold-${accent}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff6da" />
          <stop offset="40%" stopColor="#f6e6b4" />
          <stop offset="78%" stopColor="#e7b94e" />
          <stop offset="100%" stopColor="#b8860b" />
        </linearGradient>
        <linearGradient id={`jwAcc-${accent}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.85" />
        </linearGradient>
      </defs>
      {/* crown table + girdle outline of a round brilliant, drawn as a gem */}
      <g stroke="rgba(120,80,12,0.55)" strokeWidth="0.8" strokeLinejoin="round">
        {/* table (top facet) */}
        <polygon points="22,14 42,14 50,24 14,24" fill={`url(#jwAcc-${accent})`} />
        {/* left + right crown */}
        <polygon points="14,24 22,14 28,24" fill={`url(#jwGold-${accent})`} />
        <polygon points="42,14 50,24 36,24" fill={`url(#jwGold-${accent})`} />
        <polygon points="28,24 36,24 32,30" fill="#fff6da" opacity="0.85" />
        {/* pavilion (the point) */}
        <polygon points="14,24 50,24 32,56" fill={`url(#jwGold-${accent})`} />
        {/* pavilion facets / sparkle lines */}
        <polygon points="14,24 24,24 32,56" fill="#ffffff" opacity="0.16" />
        <polygon points="40,24 50,24 32,56" fill="#000000" opacity="0.12" />
        <polyline points="22,24 32,56 42,24" fill="none" stroke="rgba(255,250,230,0.55)" strokeWidth="0.7" />
      </g>
      {/* a tiny twinkle highlight */}
      <circle cx="26" cy="19" r="1.6" fill="#ffffff" opacity="0.95" />
    </svg>
  );
}
