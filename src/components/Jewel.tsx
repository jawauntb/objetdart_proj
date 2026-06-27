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
  color: string;          // svg + shader accent (the gem's true colour)
  rgb: [number, number, number]; // 0..1 for the shader tint
};
const GEMS: Gem[] = [
  { key: "citrine",  label: "citrine",  chord: [60, 64, 67],     color: "#f3cf3a", rgb: [0.95, 0.81, 0.23] },
  { key: "topaz",    label: "topaz",    chord: [62, 65, 69],     color: "#4aa3e0", rgb: [0.29, 0.64, 0.88] },
  { key: "amber",    label: "amber",    chord: [57, 60, 64],     color: "#e08a2a", rgb: [0.88, 0.54, 0.16] },
  { key: "rose",     label: "rose",     chord: [64, 67, 71],     color: "#f29bbf", rgb: [0.95, 0.61, 0.75] },
  { key: "emerald",  label: "emerald",  chord: [55, 59, 62, 67], color: "#3fbf85", rgb: [0.25, 0.75, 0.52] },
  { key: "brilliant",label: "brilliant",chord: [72, 76, 79, 84], color: "#eaf2ff", rgb: [0.92, 0.95, 1.0] },
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
  // palette tint (the gem's colour the gold field turns toward), smoothed
  const tint = useRef({ r: 1, g: 1, b: 1, amt: 0, tr: 1, tg: 1, tb: 1, tamt: 0 });
  // sustain ("pour gold") energy boost
  const pour = useRef(0); // 0..1 smoothed
  const pourTarget = useRef(0);
  // spin (whirl), stretch, flip
  const spin = useRef({ v: 0, vel: 0 });
  const stretch = useRef({ v: 0, t: 0 });
  const flip = useRef({ v: 0, t: 0 });

  const [pouring, setPouring] = useState(false);
  const [activeGem, setActiveGem] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [stretching, setStretching] = useState(false);

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
    // turn the whole gold field toward this gem's colour (held until next gem)
    tint.current.tr = g.rgb[0]; tint.current.tg = g.rgb[1]; tint.current.tb = g.rgb[2];
    tint.current.tamt = 0.82;
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

  // ── SPIN: tap to whirl the gold (impulse that decays) + rising glint ──
  const doSpin = () => {
    spin.current.vel += 0.42;
    const a = getFieldAudio();
    try {
      [0, 1, 2, 3].forEach((i) => window.setTimeout(() => { try { a.playNote(64 + i * 3, 150); } catch { /* noop */ } }, i * 60));
    } catch { /* noop */ }
    haptics.chop();
    useField.getState().recordTape("sigil", 0.7, "jewel/spin");
  };
  // ── STRETCH: hold to stretch the caustics + low swell ──
  const holdStretch = (on: boolean) => {
    stretch.current.t = on ? 1 : 0;
    setStretching(on);
    if (on) {
      try { getFieldAudio().playNote(45, 420); } catch { /* noop */ }
      haptics.roll();
      useField.getState().recordTape("sigil", 0.6, "jewel/stretch");
    } else { haptics.tap(); }
  };
  // ── FLIP: mirror + flip the palette to rose-champagne, with a whoosh ──
  const doFlip = () => {
    const nf = !flipped;
    setFlipped(nf);
    flip.current.t = nf ? 1 : 0;
    const a = getFieldAudio();
    try { a.chime(); window.setTimeout(() => { try { a.playNote(nf ? 71 : 59, 320); } catch { /* noop */ } }, 60); } catch { /* noop */ }
    haptics.roll();
    spawnRipple(0.5, 0.5, 1.0, nowSec());
    useField.getState().recordTape("object", 0.6, `jewel/flip/${nf ? "on" : "off"}`);
  };
  // ── SHAKE: a reverberant cascade + a storm of sparkle ripples ──
  const doShake = () => {
    const a = getFieldAudio();
    const cascade = [72, 76, 79, 84, 79, 76, 72, 67];
    cascade.forEach((m, i) => window.setTimeout(() => { try { a.playNote(m, 300 + i * 50); } catch { /* noop */ } }, i * 75));
    for (let i = 0; i < MAX_RIPPLES; i++) {
      spawnRipple(Math.random() * 0.8 + 0.1, Math.random() * 0.7 + 0.15, 1.0, nowSec());
    }
    spin.current.vel += 0.25;
    haptics.storm();
    useField.getState().recordTape("ripple", 1.0, "jewel/shake");
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
      uniform float u_hue;        // palette warp -1..1 (legacy, kept neutral)
      uniform vec3  u_tint;       // gem colour the gold turns toward
      uniform float u_tintAmt;    // 0 = pure gold, 1 = full gem colour
      uniform float u_pour;       // sustain energy boost 0..1
      uniform float u_spin;       // whirl angle (radians)
      uniform float u_stretch;    // vertical stretch 0..1
      uniform float u_flip;       // palette/mirror flip 0..1
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

        // ── spin (whirl), stretch, flip transforms ──
        wuv.x = mix(wuv.x, -wuv.x, u_flip);                       // flip mirrors the field
        float cs = cos(u_spin), sn = sin(u_spin);
        wuv = mat2(cs, -sn, sn, cs) * wuv;                        // spin rotates the gold
        wuv *= vec2(1.0 / (1.0 + u_stretch * 0.7), 1.0 + u_stretch * 1.1); // stretch

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
        hueTint *= mix(vec3(1.0), vec3(1.05, 0.84, 0.97), u_flip);  // rose-champagne when flipped

        // recolour the gold ramp toward the chosen gem's colour
        vec3 tlo = mix(gLo, u_tint * 0.5, u_tintAmt);
        vec3 tmid = mix(gMid, u_tint * 0.85, u_tintAmt);
        vec3 thi = mix(gHi, mix(u_tint, vec3(1.0), 0.25), u_tintAmt);

        vec3 base = vec3(0.045, 0.035, 0.022);          // dark lacquer ground
        vec3 col = base;
        col = mix(col, tlo, smoothstep(0.0, 0.5, body));
        col = mix(col, tmid, smoothstep(0.35, 0.85, body));
        col = mix(col, thi, smoothstep(0.7, 1.05, body));
        col *= hueTint;
        // unmistakable recolour: re-tint the field to the gem's hue (luminance × colour)
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 gemmed = lum * u_tint * 1.9 + u_tint * 0.05;
        col = mix(col, gemmed, u_tintAmt * 0.82);

        // central bloom (tinted) + gentle vignette
        col += tmid * exp(-r*r*0.7) * (0.12 + u_bands.y*0.25);
        col *= smoothstep(2.1, 0.1, r);

        // lens ridge ringing the cursor
        float lens = smoothstep(0.42, 0.0, abs(dc - 0.30)) * u_warp;
        col += thi * lens * 0.5;

        // diamonds: white-hot core + prismatic fringe + bloom
        col += vec3(spark) * vec3(1.0, 0.97, 0.90) * 1.15;
        col += disp * 0.95;                 // stronger prismatic fire (iridescence)
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
    const uTint = gl.getUniformLocation(prog, "u_tint");
    const uTintAmt = gl.getUniformLocation(prog, "u_tintAmt");
    const uPour = gl.getUniformLocation(prog, "u_pour");
    const uSpin = gl.getUniformLocation(prog, "u_spin");
    const uStretch = gl.getUniformLocation(prog, "u_stretch");
    const uFlip = gl.getUniformLocation(prog, "u_flip");
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
    // SCROLL → STRETCH the gold (desktop wheel)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stretch.current.t = Math.max(0, Math.min(1, stretch.current.t + (e.deltaY > 0 ? 0.1 : -0.1)));
    };
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
    wrap.addEventListener("wheel", onWheel, { passive: false });

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
      // spin integrates + decays; stretch & flip ease toward target
      spin.current.v += spin.current.vel;
      spin.current.vel *= 0.95;
      stretch.current.v += (stretch.current.t - stretch.current.v) * 0.08;
      flip.current.v += (flip.current.t - flip.current.v) * 0.12;
      // tint smoothing toward the active gem colour
      tint.current.r += (tint.current.tr - tint.current.r) * 0.08;
      tint.current.g += (tint.current.tg - tint.current.g) * 0.08;
      tint.current.b += (tint.current.tb - tint.current.b) * 0.08;
      tint.current.amt += (tint.current.tamt - tint.current.amt) * 0.06;

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
      gl.uniform1f(uHue, 0.0);
      gl.uniform3f(uTint, tint.current.r, tint.current.g, tint.current.b);
      gl.uniform1f(uTintAmt, tint.current.amt);
      gl.uniform1f(uPour, pour.current);
      gl.uniform1f(uSpin, spin.current.v);
      gl.uniform1f(uStretch, stretch.current.v);
      gl.uniform1f(uFlip, flip.current.v);
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
      wrap.removeEventListener("wheel", onWheel);
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

          <div className="jw-acts" role="group" aria-label="play">
            <button type="button" className="jw-act" onPointerDown={(e) => { e.preventDefault(); doSpin(); }}>spin</button>
            <button
              type="button"
              className={`jw-act ${stretching ? "on" : ""}`}
              onPointerDown={(e) => { e.preventDefault(); holdStretch(true); }}
              onPointerUp={(e) => { e.preventDefault(); holdStretch(false); }}
              onPointerLeave={() => { if (stretching) holdStretch(false); }}
            >stretch</button>
            <button type="button" className={`jw-act ${flipped ? "on" : ""}`} onPointerDown={(e) => { e.preventDefault(); doFlip(); }}>flip</button>
            <button type="button" className="jw-act" onPointerDown={(e) => { e.preventDefault(); doShake(); }}>shake</button>
            <button
              type="button"
              className={`jw-pour ${pouring ? "on" : ""}`}
              aria-pressed={pouring}
              onPointerDown={(e) => { e.preventDefault(); setPour(!pouring); }}
            >
              <span className="jw-pour-glow" />
              {pouring ? "pouring…" : "pour gold"}
            </button>
          </div>
        </div>

        <div className="jw-hint">tap to chime · drag to twirl · press the gems · spin · hold to stretch · flip · shake for reverb · pour to sustain</div>
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

        .jw-acts {
          pointer-events: auto;
          display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center;
        }
        .jw-act {
          appearance: none; cursor: pointer; pointer-events: auto;
          min-height: 44px; padding: 10px 16px; border-radius: 999px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 12px; letter-spacing: 0.12em; text-transform: lowercase;
          color: #f6e6b4;
          border: 1px solid rgba(231,185,78,0.5);
          background: linear-gradient(180deg, rgba(48,36,14,0.5), rgba(16,11,5,0.4));
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          box-shadow: 0 1px 0 rgba(255,240,200,0.18) inset, 0 8px 22px rgba(0,0,0,0.4);
          transition: transform .14s ease, border-color .18s ease, box-shadow .18s ease, color .18s ease;
        }
        .jw-act:hover { border-color: rgba(246,230,180,0.9); transform: translateY(-2px); }
        .jw-act:active { transform: translateY(0) scale(0.96); }
        .jw-act.on {
          color: #2a1d05; border-color: #fff6da;
          background: linear-gradient(180deg, #fff6da, #f6e6b4 40%, #e7b94e 100%);
          box-shadow: 0 0 22px rgba(246,230,180,0.6);
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

/**
 * A jeweler's round-brilliant, viewed from the top: a girdle ring of facets,
 * a band of kite/bezel facets, and a table — each facet shaded light/dark to
 * fake refraction — set in four gold prongs, with prismatic fire and a culet
 * sparkle. Coloured by the gem's accent.
 */
function Diamond({ accent }: { accent: string }) {
  const id = accent.replace("#", "");
  const cx = 32, cy = 32;
  const TWO = Math.PI * 2;
  const pol = (r: number, a: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  const N = 16;
  const Rg = 25.5, Rm = 17.5, Rt = 9.5; // girdle, mid, table radii
  const quad = (r0: number, r1: number, a0: number, a1: number) => {
    const p = [pol(r0, a0), pol(r0, a1), pol(r1, a1), pol(r1, a0)];
    return p.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" L ");
  };
  const facets: Array<{ d: string; b: number }> = [];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TWO, a1 = ((i + 1) / N) * TWO;
    facets.push({ d: `M ${quad(Rg, Rm, a0, a1)} Z`, b: 0.5 + 0.5 * Math.sin(i * 2.7) });
  }
  for (let i = 0; i < N; i++) {
    const off = Math.PI / N;
    const a0 = (i / N) * TWO + off, a1 = ((i + 1) / N) * TWO + off;
    facets.push({ d: `M ${quad(Rm, Rt, a0, a1)} Z`, b: 0.5 + 0.5 * Math.sin(i * 1.9 + 1.1) });
  }
  const tablePts = Array.from({ length: N }, (_, i) => pol(Rt, (i / N) * TWO).map((v) => v.toFixed(1)).join(",")).join(" ");
  const prongs = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4].map((a) => pol(Rg, a));
  const fire = [["#ff5da2", 8], ["#5ad1ff", 132], ["#b9ff5a", 250]] as const;
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={`gd-${id}`} cx="42%" cy="36%" r="68%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="46%" stopColor={accent} />
          <stop offset="100%" stopColor={accent} />
        </radialGradient>
        <radialGradient id={`gdEdge-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="62%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.45" />
        </radialGradient>
        <linearGradient id={`gprong-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff6da" /><stop offset="45%" stopColor="#e7b94e" /><stop offset="100%" stopColor="#9a6f12" />
        </linearGradient>
      </defs>
      {/* gem body */}
      <circle cx={cx} cy={cy} r={Rg} fill={`url(#gd-${id})`} />
      {/* facets — light/dark shards fake refraction */}
      <g strokeLinejoin="round">
        {facets.map((f, i) => (
          <path key={i} d={f.d}
            fill={f.b > 0.5 ? "#ffffff" : "#04060a"}
            fillOpacity={Math.abs(f.b - 0.5) * 0.62}
            stroke="rgba(255,255,255,0.14)" strokeWidth="0.35" />
        ))}
      </g>
      {/* iridescent fire — a spectral conic fan dispersed across the stone */}
      <g style={{ mixBlendMode: "screen" }}>
        {Array.from({ length: N }, (_, i) => {
          const a0 = (i / N) * TWO, a1 = ((i + 1) / N) * TWO;
          const [x0, y0] = pol(Rg, a0), [x1, y1] = pol(Rg, a1);
          return <path key={`sp${i}`} d={`M${cx} ${cy}L${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}Z`}
            fill={`hsl(${Math.round((i / N) * 360)} 95% 62%)`} opacity="0.17" />;
        })}
      </g>
      {/* prismatic fire flecks */}
      {fire.map(([c, deg], i) => {
        const [fx, fy] = pol(Rm - 2, (deg * Math.PI) / 180);
        return <circle key={i} cx={fx} cy={fy} r="2.4" fill={c} opacity="0.55" style={{ mixBlendMode: "screen" }} />;
      })}
      {/* table facet */}
      <polygon points={tablePts} fill="#ffffff" opacity="0.16" stroke="rgba(255,255,255,0.45)" strokeWidth="0.5" />
      <polyline points={tablePts + " " + tablePts.split(" ")[0]} fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="0.4" />
      {/* edge darkening for depth + gold girdle */}
      <circle cx={cx} cy={cy} r={Rg} fill={`url(#gdEdge-${id})`} />
      <circle cx={cx} cy={cy} r={Rg} fill="none" stroke="rgba(201,150,47,0.95)" strokeWidth="1.4" />
      {/* specular highlight + culet sparkle */}
      <ellipse cx="24" cy="21" rx="7" ry="3.4" fill="#ffffff" opacity="0.5" transform="rotate(-28 24 21)" />
      <circle cx={cx} cy={cy} r="1.5" fill="#ffffff" />
      <path d={`M${cx} ${cy - 5}L${cx} ${cy + 5}M${cx - 5} ${cy}L${cx + 5} ${cy}`} stroke="#ffffff" strokeWidth="0.6" opacity="0.7" />
      {/* gold prongs gripping the girdle */}
      {prongs.map(([px, py], i) => (
        <g key={i}>
          <circle cx={px} cy={py} r="3.1" fill={`url(#gprong-${id})`} stroke="rgba(120,80,12,0.6)" strokeWidth="0.5" />
          <circle cx={px - 0.9} cy={py - 0.9} r="1" fill="#fff6da" opacity="0.9" />
        </g>
      ))}
    </svg>
  );
}
