"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";

/**
 * /jewel — one stone you hold and turn in the light.
 *
 * A full-screen fragment shader paints a molten-gold, brilliant-cut jewel:
 * guilloché caustics studded with sharp sparkle glints, all of it shimmering
 * with the live FFT pulled off the shared audio engine. But the object here is
 * a single gem you grasp: DRAG anywhere to turn the stone — the specular
 * highlight glances across it and the prismatic dispersion (fire) sweeps over
 * the facets as it rotates. It has weight: release with velocity and it keeps
 * turning, momentum bleeding off until it settles level. A fast turn throws a
 * bright flash across a facet with a stronger haptic; a slow turn is subtle.
 * A quiet rail of stones re-cuts the gem (facet scale), its chord and its tint.
 * Tapping (without turning) rings a pentatonic note and a ripple.
 *
 * WebGL plumbing mirrors the house pattern (compile/link, a_pos fullscreen
 * quad, ResizeObserver, prefers-reduced-motion, RAF, cleanup, and a
 * data-shader-fallback CSS gradient if WebGL/compile fails).
 */

const MAX_RIPPLES = 6;
// a warm pentatonic, chosen by pointer x
const PENTA = [60, 62, 64, 67, 69, 72, 74];

// how hard a drag turns the stone (radians per screen-width of drag)
const TURN_GAIN = 3.4;
const TILT_GAIN = 2.2;
// heavy-stone momentum: velocity bleeds off slowly after release
const FRICTION = 0.955;

// the stones — each re-cuts the gem (facet scale), plays a chord, shifts tint.
type Gem = {
  key: string;
  label: string;
  chord: number[];
  color: string;                 // svg accent (the gem's true colour)
  rgb: [number, number, number]; // 0..1 for the shader tint
  setting: "gold" | "silver";    // forged bezel metal
  cut: number;                    // facet scale in the shader (larger = finer)
};
const GEMS: Gem[] = [
  { key: "citrine",  label: "citrine",  chord: [60, 64, 67],     color: "#f3cf3a", rgb: [0.95, 0.81, 0.23], setting: "gold",   cut: 12.0 },
  { key: "topaz",    label: "topaz",    chord: [62, 65, 69],     color: "#4aa3e0", rgb: [0.29, 0.64, 0.88], setting: "silver", cut: 14.0 },
  { key: "amber",    label: "amber",    chord: [57, 60, 64],     color: "#e08a2a", rgb: [0.88, 0.54, 0.16], setting: "gold",   cut: 10.0 },
  { key: "rose",     label: "rose",     chord: [64, 67, 71],     color: "#f29bbf", rgb: [0.95, 0.61, 0.75], setting: "silver", cut: 13.0 },
  { key: "emerald",  label: "emerald",  chord: [55, 59, 62, 67], color: "#3fbf85", rgb: [0.25, 0.75, 0.52], setting: "gold",   cut: 8.6 },
  { key: "brilliant",label: "brilliant",chord: [72, 76, 79, 84], color: "#eaf2ff", rgb: [0.92, 0.95, 1.0], setting: "silver", cut: 16.0 },
];

export default function Jewel() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedRef = useRef(false);

  // pointer + smoothed warp (the lens follows your grasp)
  const ptr = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, warp: 0.16, twarp: 0.16 });
  // ripple ring buffer: x, y (0..1), born time (s), strength
  const ripples = useRef(
    Array.from({ length: MAX_RIPPLES }, () => ({ x: 0.5, y: 0.5, born: -100, str: 0 })),
  );
  const ripIdx = useRef(0);
  // palette tint (the gem's colour the gold field turns toward), smoothed
  const tint = useRef({ r: 1, g: 1, b: 1, amt: 0, tr: 1, tg: 1, tb: 1, tamt: 0 });

  // ── the held stone's orientation: yaw (in-plane turn) + pitch (tilt), each
  //    with angular velocity so a released turn keeps going (heavy momentum) ──
  const turn = useRef({ yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 });
  // fire: dispersion / glint flash driven by turn velocity, decays each frame
  const fire = useRef(0);
  // cut: facet scale, eased toward the selected stone
  const cut = useRef({ v: 13, t: 13 });

  // live drag bookkeeping (kept in a ref so the RAF loop can read `active`)
  const drag = useRef({ active: false, id: -1, lx: 0, ly: 0, lt: 0, moved: 0, dyaw: 0, dpitch: 0 });
  const lastFx = useRef(0);
  const lastTape = useRef(0);

  const [activeGem, setActiveGem] = useState<string | null>(null);
  const [hint, setHint] = useState(true);

  // wall-clock seconds since component start, kept in sync with the draw loop
  const t0Ref = useRef(performance.now());
  const nowSec = () => (performance.now() - t0Ref.current) / 1000;

  // spawn a ripple into the ring buffer
  const spawnRipple = (x: number, y: number, str: number, tNow: number) => {
    const r = ripples.current[ripIdx.current % MAX_RIPPLES];
    r.x = x; r.y = y; r.born = tNow; r.str = str;
    ripIdx.current = (ripIdx.current + 1) % MAX_RIPPLES;
  };

  // re-cut the stone: change facet scale, chord, and the tint the gold turns to
  const onGem = (g: Gem) => {
    const a = getFieldAudio();
    try {
      g.chord.forEach((m, i) => {
        window.setTimeout(() => { try { a.playNote(m, 420); } catch { /* noop */ } }, i * 55);
      });
    } catch { /* noop */ }
    haptics.ripple(0.7);
    useField.getState().recordTape("object", 0.7, `jewel/gem/${g.key}`);
    tint.current.tr = g.rgb[0]; tint.current.tg = g.rgb[1]; tint.current.tb = g.rgb[2];
    tint.current.tamt = 0.82;
    cut.current.t = g.cut;
    setActiveGem(g.key);
    window.setTimeout(() => setActiveGem((k) => (k === g.key ? null : k)), 260);
    // a bright fire pop as the fresh cut catches light + a central bloom
    fire.current = Math.min(1.9, fire.current + 0.8);
    spawnRipple(0.5, 0.42, 1.0, nowSec());
  };

  // hint auto-fades on its own so the gem is the whole object
  useEffect(() => {
    const id = window.setTimeout(() => setHint(false), 5200);
    return () => window.clearTimeout(id);
  }, []);

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
      uniform float u_pour;       // extra bloom (driven by turn velocity) 0..1
      uniform float u_spin;       // turn angle (yaw, radians)
      uniform float u_stretch;    // tilt foreshorten 0..1
      uniform float u_flip;       // palette/mirror flip 0..1 (kept neutral)
      uniform vec2  u_tilt;       // stone tilt — shifts the specular highlight
      uniform float u_fire;       // dispersion / glint flash from turn velocity
      uniform float u_cut;        // facet scale (the cut of the stone)
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

        // ── pointer gravity warp (lens toward your grasp) ──
        vec2 cur = (u_cursor * 2.0 - 1.0); cur.x *= ar; cur.y *= -1.0;
        vec2 toC = uv - cur;
        float dc = length(toC) + 0.05;
        float pull = u_warp * 0.42 / dc;
        vec2 wuv = uv - toC * pull;

        // ── turn (yaw), tilt-foreshorten, flip transforms ──
        wuv.x = mix(wuv.x, -wuv.x, u_flip);                       // flip mirrors the field
        float cs = cos(u_spin), sn = sin(u_spin);
        wuv = mat2(cs, -sn, sn, cs) * wuv;                        // turning the stone
        wuv *= vec2(1.0 / (1.0 + u_stretch * 0.7), 1.0 + u_stretch * 1.1); // tilt

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
        float scale = u_cut;
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
              float facet = (core*1.4 + star*0.5) * tw * (0.5 + energy*1.3 + u_fire*1.4);
              spark += facet;
              // prismatic dispersion at the glints — the RGB split sweeps as
              // the stone turns (yaw + tilt bias the fringe angle).
              float ang = atan(d.y, d.x) + u_spin*0.5 + u_tilt.x*1.8;
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

        // ── specular highlight of the held stone: a bright hotspot that glances
        //    across the gem as you tilt/turn it (light fixed, stone rotating). ──
        vec2 hl = uv - u_tilt;
        float hd = length(hl);
        float highlight = exp(-hd*hd*(3.2 - clamp(u_fire,0.0,1.5)*1.1));
        col += thi * highlight * (0.35 + energy*0.45 + u_fire*0.9);

        // lens ridge ringing the grasp
        float lens = smoothstep(0.42, 0.0, abs(dc - 0.30)) * u_warp;
        col += thi * lens * 0.5;

        // diamonds: white-hot core + prismatic fire (blooms with the turn) + bloom
        col += vec3(spark) * vec3(1.0, 0.97, 0.90) * 1.15;
        col += disp * (0.95 + u_fire*1.1);   // fast turn throws a bright flash of fire
        col += vec3(spark) * energy * 0.4;    // sound-driven over-bloom

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
    const uTilt = gl.getUniformLocation(prog, "u_tilt");
    const uFire = gl.getUniformLocation(prog, "u_fire");
    const uCut = gl.getUniformLocation(prog, "u_cut");
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
    reducedRef.current = mq.matches;
    const onMq = () => { reduced = mq.matches ? 1 : 0; reducedRef.current = mq.matches; };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);

    // ── the tactile heart: DRAG anywhere to turn the one stone ──
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (el && el.closest && el.closest(".jw-ui")) return; // let the rail buttons act
      const rect = wrap.getBoundingClientRect();
      const d = drag.current;
      d.active = true; d.id = e.pointerId;
      d.lx = e.clientX; d.ly = e.clientY; d.lt = performance.now();
      d.moved = 0; d.dyaw = 0; d.dpitch = 0;
      // catching a spinning stone arrests most of its momentum
      turn.current.vyaw *= 0.22; turn.current.vpitch *= 0.22;
      try { wrap.setPointerCapture(e.pointerId); } catch { /* noop */ }
      // the lens presses toward your grasp
      ptr.current.tx = (e.clientX - rect.left) / rect.width;
      ptr.current.ty = (e.clientY - rect.top) / rect.height;
      ptr.current.twarp = 0.7;
      setHint(false);
    };
    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      const d = drag.current;
      if (!d.active || e.pointerId !== d.id) {
        // idle hover: the lens drifts toward the pointer (desktop)
        ptr.current.tx = (e.clientX - rect.left) / rect.width;
        ptr.current.ty = (e.clientY - rect.top) / rect.height;
        ptr.current.twarp = 0.42;
        return;
      }
      const now = performance.now();
      const dt = Math.max(8, now - d.lt);
      const dx = (e.clientX - d.lx) / Math.max(1, rect.width);
      const dy = (e.clientY - d.ly) / Math.max(1, rect.height);
      d.lx = e.clientX; d.ly = e.clientY; d.lt = now;
      // the lens follows your finger over the stone
      ptr.current.tx = (e.clientX - rect.left) / rect.width;
      ptr.current.ty = (e.clientY - rect.top) / rect.height;
      ptr.current.twarp = 0.62;
      if (reducedRef.current) return;              // no turning under reduced motion
      d.moved += Math.hypot(dx, dy);
      const dyaw = dx * TURN_GAIN;
      const dpitch = dy * TILT_GAIN;
      turn.current.yaw += dyaw;
      turn.current.pitch = Math.max(-1.15, Math.min(1.15, turn.current.pitch + dpitch));
      // smoothed estimate becomes the release velocity (heavy-stone throw)
      d.dyaw = d.dyaw * 0.4 + dyaw * 0.6;
      d.dpitch = d.dpitch * 0.4 + dpitch * 0.6;
      // velocity → fire flash + haptic + a light-catch note (all throttled)
      const speed = Math.hypot(dx, dy) / (dt / 1000);
      fire.current = Math.min(1.7, fire.current + speed * 0.06);
      if (speed > 0.6 && now - lastFx.current > 90) {
        lastFx.current = now;
        const inten = Math.min(1, speed * 0.35);
        haptics.ripple(0.22 + inten * 0.5);
        if (speed > 1.7) { try { haptics.tap(); } catch { /* noop */ } }
        const idx = Math.max(0, Math.min(PENTA.length - 1, Math.floor(((e.clientX - rect.left) / rect.width) * PENTA.length)));
        try { getFieldAudio().playNote(PENTA[idx] + 12, 120); } catch { /* noop */ }
      }
      if (now - lastTape.current > 180) {
        lastTape.current = now;
        useField.getState().recordTape("ripple", 0.3 + Math.min(0.6, speed * 0.3), "jewel/turn");
      }
    };
    const release = (e: PointerEvent, allowTap: boolean) => {
      const d = drag.current;
      if (!d.active || e.pointerId !== d.id) return;
      d.active = false; d.id = -1;
      try { wrap.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      ptr.current.twarp = 0.16;
      if (allowTap && d.moved < 0.014) {
        // a tap (no turn): ring a pentatonic note + a ripple bloom
        const rect = wrap.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        spawnRipple(x, y, 0.9, nowSec());
        const midi = PENTA[Math.max(0, Math.min(PENTA.length - 1, Math.floor(x * PENTA.length)))];
        try { getFieldAudio().playNote(midi, 220); } catch { /* noop */ }
        haptics.ripple(0.6);
        useField.getState().recordTape("sigil", 0.8, "jewel/tap");
        return;
      }
      // released mid-turn: momentum carries the heavy stone on
      turn.current.vyaw = d.dyaw;
      turn.current.vpitch = d.dpitch;
      const rel = Math.hypot(d.dyaw, d.dpitch);
      fire.current = Math.min(1.9, fire.current + rel * 2.4);
      const inten = Math.min(1, rel * 5.0);
      haptics.ripple(0.3 + inten * 0.6);
      if (inten > 0.5) { try { getFieldAudio().chime(); } catch { /* noop */ } }
      useField.getState().recordTape("object", 0.4 + inten * 0.4, "jewel/release");
    };
    const onUp = (e: PointerEvent) => release(e, true);
    const onCancel = (e: PointerEvent) => release(e, false);
    const onLeave = () => { if (!drag.current.active) ptr.current.twarp = 0.16; };

    wrap.addEventListener("pointerdown", onDown);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onUp);
    wrap.addEventListener("pointercancel", onCancel);
    wrap.addEventListener("pointerleave", onLeave);

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

      // ── turn integration: momentum + friction; pitch settles level ──
      const tn = turn.current;
      if (!drag.current.active) {
        tn.yaw += tn.vyaw; tn.vyaw *= FRICTION;
        tn.pitch += tn.vpitch; tn.vpitch *= FRICTION;
        tn.vpitch += (0 - tn.pitch) * 0.004;   // gentle spring back to level
        tn.pitch += (0 - tn.pitch) * 0.006;    // slow settle so it comes to rest
      }
      fire.current *= 0.9;                       // fire flash decays
      cut.current.v += (cut.current.t - cut.current.v) * 0.08;
      // tint smoothing toward the active stone colour
      tint.current.r += (tint.current.tr - tint.current.r) * 0.08;
      tint.current.g += (tint.current.tg - tint.current.g) * 0.08;
      tint.current.b += (tint.current.tb - tint.current.b) * 0.08;
      tint.current.amt += (tint.current.tamt - tint.current.amt) * 0.06;

      // ── audio: pull FFT, compute energy + 3 bands ──
      let energy = 0.14 + fire.current * 0.14;   // gentle idle, lifts on a turn
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
          energy = Math.max(energy, Math.min(1, avg * 2.6));
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

      // the specular highlight glances with the turn: it orbits as the stone
      // spins (sin/cos of yaw), lurches with yaw velocity, and rides the tilt.
      const hlx = Math.sin(tn.yaw * 0.6) * 0.42 + Math.max(-0.5, Math.min(0.5, tn.vyaw * 3.0));
      const hly = -Math.cos(tn.yaw * 0.6) * 0.16 + Math.max(-0.7, Math.min(0.7, tn.pitch * 0.62));

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
      gl.uniform1f(uPour, Math.min(1, fire.current * 0.5));
      gl.uniform1f(uSpin, tn.yaw);
      gl.uniform1f(uStretch, Math.min(0.4, Math.abs(tn.pitch) * 0.45));
      gl.uniform1f(uFlip, 0.0);
      gl.uniform2f(uTilt, hlx, hly);
      gl.uniform1f(uFire, fire.current);
      gl.uniform1f(uCut, cut.current.v);
      gl.uniform3fv(uRip, ripVec);
      gl.uniform1fv(uRipStr, ripStrVec);

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
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointercancel", onCancel);
      wrap.removeEventListener("pointerleave", onLeave);
      gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={wrapRef}
      className="jewel-shader"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ position: "fixed", inset: 0, background: "#0a0805" }}
    >
      <canvas ref={canvasRef} />

      {/* quiet chrome — the gem is the whole object */}
      <div className="jw-ui">
        <div className="jw-title" aria-hidden="true">
          <span>objet d&rsquo;art / hold &middot; turn in the light</span>
          <strong>Jewel</strong>
        </div>

        <div className="jw-rail" role="group" aria-label="stones">
          {GEMS.map((g) => (
            <button
              key={g.key}
              type="button"
              className={`jw-stone jw-stone--${g.setting} ${activeGem === g.key ? "on" : ""}`}
              aria-label={`${g.label} — ${g.setting} setting`}
              aria-pressed={activeGem === g.key}
              onPointerDown={(e) => { e.preventDefault(); onGem(g); }}
            >
              <span className="jw-stone-jewel"><GemSetting gem={g} /></span>
              <span className="jw-stone-label">{g.label}</span>
            </button>
          ))}
        </div>

        <div className={`jw-hint ${hint ? "" : "gone"}`} aria-hidden="true">drag to turn the stone</div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .jewel-shader {
          touch-action: none;
          -webkit-user-select: none; user-select: none;
          -webkit-tap-highlight-color: transparent;
          cursor: grab;
        }
        .jewel-shader:active { cursor: grabbing; }
        .jewel-shader > canvas { width: 100%; height: 100%; display: block; }
        .jewel-shader[data-shader-fallback="1"] {
          background:
            repeating-radial-gradient(circle at 50% 42%, rgba(231,185,78,0.10) 0 2px, transparent 2px 9px),
            radial-gradient(circle at 50% 40%, rgba(246,230,180,0.22), rgba(10,8,5,0) 62%),
            radial-gradient(circle at 50% 50%, rgba(184,134,11,0.18), #0a0805 70%);
        }

        .jw-ui {
          position: absolute; inset: 0; z-index: 10;
          pointer-events: none;
        }

        /* ── quiet serif title, benchmark-style ── */
        .jw-title {
          position: fixed; z-index: 11;
          top: calc(74px + env(safe-area-inset-top, 0px));
          left: clamp(20px, 4vw, 46px);
          pointer-events: none;
          text-shadow: 0 2px 20px rgba(0,0,0,0.55);
        }
        .jw-title span {
          display: block; margin-bottom: 8px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px; line-height: 1; letter-spacing: 0.02em;
          text-transform: lowercase;
          color: rgba(246,230,180,0.5);
        }
        .jw-title strong {
          display: block; font-weight: 500;
          font-family: var(--font-fraunces, var(--font-serif, Georgia), serif);
          font-size: clamp(56px, 12vw, 120px); line-height: 0.86;
          background: linear-gradient(180deg, #fff6da 0%, #f6e6b4 30%, #e7b94e 66%, #b8860b 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: #e7b94e;
        }

        /* ── a single quiet rail of stones (re-cuts the gem) ── */
        .jw-rail {
          position: fixed; z-index: 12;
          top: 50%; right: clamp(12px, 2.6vw, 26px);
          transform: translateY(-50%);
          display: grid; gap: 8px;
          pointer-events: auto;
        }
        .jw-stone {
          appearance: none; cursor: pointer;
          display: grid; grid-template-columns: 34px 1fr; align-items: center; gap: 10px;
          min-height: 44px; padding: 6px 12px 6px 6px;
          border-radius: 12px;
          border: 1px solid rgba(231,185,78,0.22);
          background: rgba(14,10,5,0.5);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          color: rgba(246,230,180,0.82);
          text-align: left;
          transition: transform .14s ease, border-color .18s ease, background .18s ease, color .18s ease;
        }
        .jw-stone--silver { border-color: rgba(200,210,222,0.22); color: rgba(240,246,252,0.85); }
        .jw-stone-jewel { display: grid; place-items: center; }
        .jw-stone svg { width: 30px; height: 30px; display: block;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6)); transition: transform .16s ease; }
        .jw-stone-label {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px; letter-spacing: 0.08em; text-transform: lowercase;
        }
        .jw-stone:hover { transform: translateX(-3px); border-color: rgba(246,230,180,0.6); }
        .jw-stone:hover svg { transform: scale(1.08); }
        .jw-stone:active { transform: translateX(-1px) scale(0.97); }
        .jw-stone.on {
          border-color: rgba(246,230,180,0.85);
          background: rgba(40,30,12,0.62);
          color: #fff6da;
          box-shadow: 0 0 22px rgba(246,230,180,0.32);
        }
        .jw-stone.on svg { transform: scale(1.12); }

        /* ── unobtrusive, auto-fading hint ── */
        .jw-hint {
          position: fixed; z-index: 11;
          left: 0; right: 0; bottom: calc(26px + env(safe-area-inset-bottom, 0px));
          text-align: center; pointer-events: none;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px; letter-spacing: 0.18em; text-transform: lowercase;
          color: rgba(246,230,180,0.46);
          text-shadow: 0 1px 10px rgba(0,0,0,0.6);
          opacity: 1; transition: opacity 1.1s ease;
        }
        .jw-hint.gone { opacity: 0; }

        body:has(.jewel-shader) { overflow: hidden; }
        body:has(.jewel-shader) header { display: none !important; }
        body:has(.jewel-shader) .oda-field-watch,
        body:has(.jewel-shader) .oda-candle-mark,
        body:has(.jewel-shader) .oda-tape-shell,
        body:has(.jewel-shader) .oda-sound-toggle {
          display: none !important;
        }

        @media (max-width: 720px) {
          .jw-title { top: calc(58px + env(safe-area-inset-top, 0px)); left: 22px; }
          .jw-rail {
            top: auto; right: 0; left: 0; bottom: calc(58px + env(safe-area-inset-bottom, 0px));
            transform: none;
            grid-auto-flow: column; gap: 8px;
            justify-content: center; align-items: end;
            padding: 0 12px; overflow-x: auto;
          }
          .jw-stone {
            grid-template-columns: 1fr; grid-auto-flow: row; justify-items: center; gap: 4px;
            min-width: 58px; padding: 7px 8px;
          }
          .jw-stone-label { font-size: 9px; letter-spacing: 0.04em; }
          .jw-stone:hover { transform: translateY(-3px); }
          .jw-hint { bottom: calc(18px + env(safe-area-inset-bottom, 0px)); font-size: 10px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .jw-hint { transition: none; }
          .jewel-shader { cursor: default; }
        }
      ` }} />
    </div>
  );
}

// metal ramps for SVG settings (gold / silver), per the house realism spec
const METAL = {
  gold: { hi: "#fff6da", mid: "#e7b94e", lo: "#8a6410", prongHi: "#fff6da", prongMid: "#e7b94e", prongLo: "#9a6f12", girdle: "rgba(201,150,47,0.95)" },
  silver: { hi: "#ffffff", mid: "#aab4bf", lo: "#3c434b", prongHi: "#ffffff", prongMid: "#cdd6de", prongLo: "#6b7682", girdle: "rgba(190,200,210,0.95)" },
} as const;

/**
 * A forged jeweller's object: a faceted round-brilliant (girdle facets, kite
 * band, table + culet sparkle, prismatic fire) seated in prongs, wrapped in a
 * thick beveled metal bezel (gold or silver), and ringed by a "carat halo" of
 * tiny set diamonds — so the swatch reads minted, weighty and real.
 */
function GemSetting({ gem }: { gem: Gem }) {
  const accent = gem.color;
  const m = METAL[gem.setting];
  const id = `${gem.key}-${gem.setting}`;
  const cx = 32, cy = 32;
  const TWO = Math.PI * 2;
  const pol = (r: number, a: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  const N = 16;
  // stone sits inside the bezel + halo, so it's smaller than the full circle
  const Rg = 16.5, Rm = 11.5, Rt = 6.2;      // girdle, mid, table radii (the stone)
  const Rbez = 26.5;                          // outer bezel rim
  const Rhalo = 21.5;                         // ring the halo diamonds sit on
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
  const HALO = 16; // tiny set diamonds in the carat-halo ring
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
          <stop offset="0%" stopColor={m.prongHi} /><stop offset="45%" stopColor={m.prongMid} /><stop offset="100%" stopColor={m.prongLo} />
        </linearGradient>
        {/* beveled forged bezel — bright top-left to dark bottom-right */}
        <linearGradient id={`gbez-${id}`} x1="0.18" y1="0.1" x2="0.85" y2="0.95">
          <stop offset="0%" stopColor={m.hi} />
          <stop offset="42%" stopColor={m.mid} />
          <stop offset="100%" stopColor={m.lo} />
        </linearGradient>
        <radialGradient id={`gseat-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#000000" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* soft cast shadow under the whole forged piece */}
      <ellipse cx="32" cy="56" rx="22" ry="5" fill="#000000" opacity="0.35" />

      {/* ── forged bezel ring (thick, beveled) ── */}
      <circle cx={cx} cy={cy} r={Rbez} fill={`url(#gbez-${id})`} />
      {/* bright specular arc top-left */}
      <path d={`M ${cx - 19} ${cy - 14} A ${Rbez - 1} ${Rbez - 1} 0 0 1 ${cx + 16} ${cy - 19}`}
        fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="2.2" strokeLinecap="round" />
      {/* dark rim bottom-right for the bevel */}
      <path d={`M ${cx + 19} ${cy + 14} A ${Rbez - 1} ${Rbez - 1} 0 0 1 ${cx - 16} ${cy + 19}`}
        fill="none" stroke="#000000" strokeOpacity="0.4" strokeWidth="2.4" strokeLinecap="round" />
      {/* inner seat — a recessed dark cup so the stone sits in metal */}
      <circle cx={cx} cy={cy} r={Rhalo + 2.2} fill="#15100a" />
      <circle cx={cx} cy={cy} r={Rhalo + 2.2} fill={`url(#gseat-${id})`} />

      {/* ── carat halo: a ring of tiny set diamonds in the metal ── */}
      {Array.from({ length: HALO }, (_, i) => {
        const a = (i / HALO) * TWO;
        const [hx, hy] = pol(Rhalo, a);
        return (
          <g key={`halo${i}`}>
            <circle cx={hx} cy={hy} r="2.1" fill={`url(#gprong-${id})`} />
            <circle cx={hx} cy={hy} r="1.35" fill="#ffffff" opacity="0.95" />
            <circle cx={hx - 0.4} cy={hy - 0.4} r="0.5" fill="#ffffff" />
          </g>
        );
      })}

      {/* ── the seated stone ── */}
      <circle cx={cx} cy={cy} r={Rg} fill={`url(#gd-${id})`} />
      <g strokeLinejoin="round">
        {facets.map((f, i) => (
          <path key={i} d={f.d}
            fill={f.b > 0.5 ? "#ffffff" : "#04060a"}
            fillOpacity={Math.abs(f.b - 0.5) * 0.62}
            stroke="rgba(255,255,255,0.14)" strokeWidth="0.35" />
        ))}
      </g>
      {/* iridescent fire — spectral conic fan */}
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
        const [fx, fy] = pol(Rm - 1.5, (deg * Math.PI) / 180);
        return <circle key={i} cx={fx} cy={fy} r="1.7" fill={c} opacity="0.55" style={{ mixBlendMode: "screen" }} />;
      })}
      {/* table facet */}
      <polygon points={tablePts} fill="#ffffff" opacity="0.16" stroke="rgba(255,255,255,0.45)" strokeWidth="0.5" />
      {/* edge darkening + metal girdle */}
      <circle cx={cx} cy={cy} r={Rg} fill={`url(#gdEdge-${id})`} />
      <circle cx={cx} cy={cy} r={Rg} fill="none" stroke={m.girdle} strokeWidth="1.2" />
      {/* specular highlight + culet sparkle */}
      <ellipse cx="27" cy="25" rx="4.4" ry="2.2" fill="#ffffff" opacity="0.5" transform="rotate(-28 27 25)" />
      <circle cx={cx} cy={cy} r="1.1" fill="#ffffff" />
      <path d={`M${cx} ${cy - 3.4}L${cx} ${cy + 3.4}M${cx - 3.4} ${cy}L${cx + 3.4} ${cy}`} stroke="#ffffff" strokeWidth="0.5" opacity="0.7" />
      {/* metal prongs gripping the girdle */}
      {prongs.map(([px, py], i) => (
        <g key={i}>
          <circle cx={px} cy={py} r="2.6" fill={`url(#gprong-${id})`} stroke="rgba(0,0,0,0.45)" strokeWidth="0.5" />
          <circle cx={px - 0.8} cy={py - 0.8} r="0.9" fill={m.prongHi} opacity="0.95" />
        </g>
      ))}
    </svg>
  );
}
