"use client";

import { useEffect, useRef } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import type { ConcernKey } from "@/lib/types";

/**
 * The Atlantic.
 *
 * Two layered canvases:
 *   1. WebGL water  — the deep material. Multi-blue depth gradient,
 *      flowing caustic light, subtle UV warp. Renders behind.
 *   2. 2D wave lines — five rolling swells with compound sines,
 *      foam dabs at the crests, audio-synced amplitude, and pointer
 *      ripples that propagate outward. Renders in front, transparent
 *      background.
 *
 * The amplitude of the 2D waves and the period of the caustic flow
 * both ride the 0.14 Hz audio LFO so what you see breathes with what
 * you hear.
 *
 * If WebGL isn't available the 2D layer paints its own gradient
 * fallback and the piece still reads.
 */
export default function Sea({
  height = "clamp(280px, 46vh, 480px)",
}: {
  height?: string | number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const waterRef = useRef<HTMLCanvasElement>(null);
  const linesRef = useRef<HTMLCanvasElement>(null);
  const ripples = useRef<Array<{ x: number; y: number; t0: number; strength: number }>>([]);
  const pointer = useRef<{ x: number; y: number; over: boolean; pressed: boolean; lastEmit: number }>({
    x: 0, y: 0, over: false, pressed: false, lastEmit: 0,
  });

  // Chart-driven nudges from SeaChart instances elsewhere on the page. Each
  // event boosts (+1) or damps (-1) the visual swell amplitude for ~800ms.
  // We accumulate the impulse on a ref and decay it inside the draw loop.
  const nudgeRef = useRef<{ impulse: number; t0: number }>({ impulse: 0, t0: 0 });

  useEffect(() => {
    const onNudge = (e: Event) => {
      const ce = e as CustomEvent<{ direction?: 1 | -1 }>;
      const dir = ce.detail?.direction === -1 ? -1 : 1;
      nudgeRef.current.impulse = dir;
      nudgeRef.current.t0 = performance.now();
    };
    window.addEventListener("oda:sea-nudge", onNudge);
    return () => window.removeEventListener("oda:sea-nudge", onNudge);
  }, []);

  // Subscribe to concerns. We read them through a ref the render loop can poll
  // so we never tear down the GL context when sliders move.
  const concerns = useField((s) => s.concerns);
  const concernTargetRef = useRef<{
    magnitude: number;            // 0..1 mean of all concern values
    tint: [number, number, number]; // additive rgb tint, small magnitudes
  }>({ magnitude: 0.5, tint: [0, 0, 0] });
  const concernSmoothedRef = useRef<{
    magnitude: number;
    tint: [number, number, number];
  }>({ magnitude: 0.5, tint: [0, 0, 0] });

  // Recompute target whenever concerns change. The render loop lerps toward it.
  useEffect(() => {
    const values = Object.values(concerns) as number[];
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 50;
    const magnitude = Math.min(1, Math.max(0, mean / 100));

    // Find dominant concern (highest value)
    const entries = Object.entries(concerns) as Array<[ConcernKey, number]>;
    let dominant: ConcernKey | null = null;
    let topVal = -Infinity;
    for (const [k, v] of entries) {
      if (v > topVal) { topVal = v; dominant = k; }
    }

    // Small additive tint by dominant concern. Subtle (~0.04 units).
    let tint: [number, number, number] = [0, 0, 0];
    switch (dominant) {
      case "prayer":
      case "love":
        tint = [0.04, 0.01, -0.01]; // warm
        break;
      case "memory":
        tint = [-0.01, 0.005, 0.04]; // cool
        break;
      case "work":
      case "risk":
        tint = [-0.015, -0.012, -0.012]; // slight desat
        break;
      case "body":
        tint = [-0.01, 0.04, -0.005]; // green
        break;
      case "future":
      case "friendship":
      default:
        tint = [0, 0, 0]; // standard blue
        break;
    }
    concernTargetRef.current = { magnitude, tint };
  }, [concerns]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const water = waterRef.current;
    const lines = linesRef.current;
    if (!wrap || !water || !lines) return;
    const lctx = lines.getContext("2d");
    if (!lctx) return;

    // ── WebGL setup ───────────────────────────────────────────────
    const gl =
      (water.getContext("webgl", { antialias: false, premultipliedAlpha: false }) ||
        water.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: false } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;

    let glProg: WebGLProgram | null = null;
    let uTimeLoc: WebGLUniformLocation | null = null;
    let uResLoc: WebGLUniformLocation | null = null;
    let uSwellLoc: WebGLUniformLocation | null = null;
    let uRipplesLoc: WebGLUniformLocation | null = null;
    let uRippleCountLoc: WebGLUniformLocation | null = null;
    let uConcernTintLoc: WebGLUniformLocation | null = null;

    if (gl) {
      const vert = `
        attribute vec2 a_pos;
        varying vec2 vUv;
        void main() {
          vUv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;
      const frag = `
        precision highp float;
        uniform float uTime;
        uniform vec2 uRes;
        uniform float uSwell;
        // up to 12 active ripples: xy = position in normalized canvas uv (0..1),
        // z = age in seconds, w = strength (peak amplitude).
        uniform vec4 uRipples[12];
        uniform int uRippleCount;
        uniform vec3 u_concern_tint;
        varying vec2 vUv;

        // hash + value noise + fbm — organic caustic substrate
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
          for (int i = 0; i < 5; i++) {
            v += a * vnoise(p);
            p *= 2.07;
            a *= 0.52;
          }
          return v;
        }

        void main() {
          // y=0 top, y=1 bottom
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
          float t = uTime;

          // pointer ripples — also displace the water surface, not just the lines
          float rippleHi = 0.0;
          for (int i = 0; i < 12; i++) {
            if (i >= uRippleCount) break;
            vec4 r = uRipples[i];
            vec2 dp = uv - r.xy;
            float dist = length(dp);
            float age = r.z;
            if (age > 2.6) continue;
            float speed = 0.32; // in uv units per second
            float front = dist - age * speed;
            float env = exp(-(front * front) / 0.0030);
            float falloff = 1.0 / (1.0 + dist * 3.5);
            float temporal = max(0.0, 1.0 - age / 2.6);
            rippleHi += r.w * env * falloff * temporal;
          }

          // flow warp — slow displacement + ripple-driven micro-warp
          vec2 flow = vec2(
            sin(uv.y * 8.0 + t * 0.40) * 0.018,
            sin(uv.x * 6.0 + t * 0.30) * 0.012
          );
          vec2 wuv = uv + flow + vec2(0.0, uSwell * 0.012);
          wuv += rippleHi * 0.012;

          // depth gradient — paper at the horizon, deepening through azure,
          // cerulean, ultramarine, into prussian.
          vec3 azure     = vec3(0.50, 0.69, 0.81);
          vec3 cerulean  = vec3(0.24, 0.48, 0.69);
          vec3 ultram    = vec3(0.15, 0.32, 0.55);
          vec3 prussian  = vec3(0.07, 0.15, 0.30);

          vec3 color = mix(azure, cerulean, smoothstep(0.05, 0.42, wuv.y));
          color = mix(color, ultram, smoothstep(0.42, 0.78, wuv.y));
          color = mix(color, prussian, smoothstep(0.78, 1.0, wuv.y));

          // caustics — fbm-warped sine networks. The fbm noise advances slowly
          // through the same time, so the light cells drift instead of pulsing
          // in a perfectly periodic grid.
          vec2 nuv = wuv * vec2(uRes.x / uRes.y, 1.0) * 3.4 + vec2(t * 0.05, t * 0.03);
          float n = fbm(nuv);
          float c1 = sin((wuv.x + n * 0.18) * 22.0 + t * 0.55)
                   * sin((wuv.y + n * 0.14) * 14.0 - t * 0.38);
          float c2 = sin(wuv.x *  9.0 - t * 0.30 + n * 1.2)
                   * sin(wuv.y *  6.5 + t * 0.22 - n * 1.0);
          float c3 = sin((wuv.x + wuv.y + n * 0.4) * 13.0 + t * 0.33);
          float caustic = c1 * 0.40 + c2 * 0.55 + c3 * 0.30;
          caustic = smoothstep(0.55, 1.10, caustic);

          // caustics bright near surface, dim at depth, audio-reactive:
          // louder swell phases brighten the peaks
          float surfMask = 1.0 - smoothstep(0.05, 0.6, wuv.y);
          float audioBoost = 0.11 + clamp(uSwell, -1.0, 1.0) * 0.065;
          color += caustic * audioBoost * mix(vec3(1.0), vec3(0.70, 0.90, 1.00), wuv.y) * surfMask;

          // ripple highlights — wavefronts visibly brighten the water
          color += rippleHi * 0.012 * vec3(0.70, 0.92, 1.00);

          // subtle low-frequency wash so the body has weather
          float wash = sin(wuv.x * 1.8 + t * 0.12) * sin(wuv.y * 2.6 - t * 0.07);
          color += wash * 0.025 * vec3(0.85, 0.92, 1.0);

          // top haze — softer band where the sea meets the air
          float haze = smoothstep(0.0, 0.10, wuv.y) * (1.0 - smoothstep(0.10, 0.30, wuv.y));
          color = mix(color, vec3(0.80, 0.88, 0.93), haze * 0.30);

          // hard fade to paper at the very top so it reads as a sea edge
          float topFade = smoothstep(0.0, 0.02, wuv.y);
          color = mix(vec3(0.949, 0.933, 0.902), color, topFade);

          // concern-mood tint — additive, small magnitude, clamped.
          // attenuated near the paper-edge so the horizon line stays neutral.
          color = clamp(color + u_concern_tint * topFade, 0.0, 1.0);

          gl_FragColor = vec4(color, 1.0);
        }
      `;
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn("shader compile failed", gl.getShaderInfoLog(s));
          gl.deleteShader(s);
          return null;
        }
        return s;
      };
      const vs = compile(gl.VERTEX_SHADER, vert);
      const fs = compile(gl.FRAGMENT_SHADER, frag);
      if (vs && fs) {
        const p = gl.createProgram();
        if (p) {
          gl.attachShader(p, vs);
          gl.attachShader(p, fs);
          gl.linkProgram(p);
          if (gl.getProgramParameter(p, gl.LINK_STATUS)) {
            glProg = p;
            uTimeLoc = gl.getUniformLocation(p, "uTime");
            uResLoc = gl.getUniformLocation(p, "uRes");
            uSwellLoc = gl.getUniformLocation(p, "uSwell");
            uRipplesLoc = gl.getUniformLocation(p, "uRipples");
            uRippleCountLoc = gl.getUniformLocation(p, "uRippleCount");
            uConcernTintLoc = gl.getUniformLocation(p, "u_concern_tint");

            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(
              gl.ARRAY_BUFFER,
              new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
              gl.STATIC_DRAW,
            );
            const loc = gl.getAttribLocation(p, "a_pos");
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            gl.useProgram(p);
          }
        }
      }
    }

    // ── resize handler ────────────────────────────────────────────
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      water.width = Math.floor(w * dpr);
      water.height = Math.floor(h * dpr);
      lines.width = Math.floor(w * dpr);
      lines.height = Math.floor(h * dpr);
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gl) gl.viewport(0, 0, water.width, water.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── pointer / touch interaction ──────────────────────────────
    const addRipple = (x: number, y: number, strength: number) => {
      ripples.current.push({ x, y, t0: performance.now(), strength });
      if (ripples.current.length > 28) ripples.current.shift();
    };
    const onDown = (e: PointerEvent) => {
      const r = lines.getBoundingClientRect();
      pointer.current.pressed = true;
      pointer.current.over = true;
      pointer.current.x = e.clientX - r.left;
      pointer.current.y = e.clientY - r.top;
      addRipple(pointer.current.x, pointer.current.y, 26);
      useField.getState().recordTape("ripple", 0.85);
    };
    const onUp = () => { pointer.current.pressed = false; };
    const onMove = (e: PointerEvent) => {
      const r = lines.getBoundingClientRect();
      pointer.current.over = true;
      pointer.current.x = e.clientX - r.left;
      pointer.current.y = e.clientY - r.top;
      const now = performance.now();
      if (pointer.current.pressed && now - pointer.current.lastEmit > 80) {
        addRipple(pointer.current.x, pointer.current.y, 13);
        pointer.current.lastEmit = now;
        useField.getState().recordTape("ripple", 0.45);
      } else if (!pointer.current.pressed && now - pointer.current.lastEmit > 220) {
        addRipple(pointer.current.x, pointer.current.y, 3);
        pointer.current.lastEmit = now;
      }
    };
    const onLeave = () => {
      pointer.current.over = false;
      pointer.current.pressed = false;
    };
    lines.addEventListener("pointerdown", onDown);
    lines.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    lines.addEventListener("pointerleave", onLeave);

    // ── render loop ──────────────────────────────────────────────
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = reduce ? 0 : 1;
    const t0 = performance.now();
    let raf = 0;

    const rippleDisp = (x: number, y: number, now: number): number => {
      let d = 0;
      const list = ripples.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i];
        const age = (now - r.t0) / 1000;
        if (age > 2.6) { list.splice(i, 1); continue; }
        const dx = x - r.x;
        const dy = y - r.y;
        const dist = Math.hypot(dx, dy);
        const spatialFalloff = 1 / (1 + dist / 90);
        const temporal = Math.max(0, 1 - age / 2.6);
        const speed = 260;
        const front = dist - age * speed;
        const env = Math.exp(-(front * front) / (70 * 70));
        d += r.strength * env * spatialFalloff * temporal;
      }
      return d;
    };

    type Swell = {
      yFrac: number; amp: number; freq: number; speed: number; compound: number;
      line: string; foam: string;
    };
    const swells: Swell[] = [
      { yFrac: 0.18, amp: 4,  freq: 0.0140, speed: 0.18, compound: 0.25,
        line: "rgba(180, 220, 240, 0.55)", foam: "rgba(244, 246, 250, 0.55)" },
      { yFrac: 0.32, amp: 7,  freq: 0.0110, speed: 0.22, compound: 0.32,
        line: "rgba(150, 200, 230, 0.62)", foam: "rgba(244, 246, 250, 0.62)" },
      { yFrac: 0.48, amp: 11, freq: 0.0095, speed: 0.27, compound: 0.40,
        line: "rgba(120, 175, 215, 0.72)", foam: "rgba(248, 248, 250, 0.72)" },
      { yFrac: 0.66, amp: 16, freq: 0.0080, speed: 0.32, compound: 0.48,
        line: "rgba( 92, 150, 195, 0.80)", foam: "rgba(248, 248, 250, 0.82)" },
      { yFrac: 0.86, amp: 23, freq: 0.0065, speed: 0.37, compound: 0.58,
        line: "rgba( 68, 130, 180, 0.85)", foam: "rgba(248, 248, 250, 0.90)" },
    ];

    const draw = (now: number) => {
      const w = lines.clientWidth;
      const h = lines.clientHeight;

      // Use the AudioContext clock once audio has started so the visual
      // swell stays in phase with the audible swell. Fall back to the
      // RAF clock until then.
      const audioT = getFieldAudio().getAudioTime();
      const t = audioT != null ? audioT : (now - t0) / 1000;

      // audio-synced LFOs (visual amplitude + shader swell pump)
      const swellLfo = Math.sin(t * Math.PI * 2 * 0.14);
      const driftLfo = Math.sin(t * Math.PI * 2 * 0.03);
      let swellMod = 1 + swellLfo * 0.28 + driftLfo * 0.10;

      // ── lerp smoothed concern state toward target ─────────────
      // When reduced-motion is set we snap to the neutral baseline so we
      // don't drive concern-coupled amplitude / color shifts at all.
      const target = concernTargetRef.current;
      const sm = concernSmoothedRef.current;
      if (reduce) {
        sm.magnitude = 0.5;
        sm.tint[0] = 0;
        sm.tint[1] = 0;
        sm.tint[2] = 0;
      } else {
        const k = 0.05;
        sm.magnitude += (target.magnitude - sm.magnitude) * k;
        sm.tint[0] += (target.tint[0] - sm.tint[0]) * k;
        sm.tint[1] += (target.tint[1] - sm.tint[1]) * k;
        sm.tint[2] += (target.tint[2] - sm.tint[2]) * k;
      }

      // amplitude rides concern magnitude: calm = 0.7x, peak = 1.3x
      if (!reduce) {
        const concernAmp = 0.7 + sm.magnitude * 0.6;
        swellMod *= concernAmp;
      }

      // chart-nudge envelope — adds a brief 0..±0.35 multiplicative kick on
      // top of swellMod, decaying over 800ms. Visual + WebGL both see it.
      const NUDGE_LIFE = 800;
      const nudgeAge = nudgeRef.current.t0 > 0 ? now - nudgeRef.current.t0 : Infinity;
      let nudgeFactor = 0;
      if (nudgeAge < NUDGE_LIFE) {
        const k = 1 - nudgeAge / NUDGE_LIFE;
        nudgeFactor = nudgeRef.current.impulse * k * 0.35;
        if (!reduce) swellMod *= (1 + nudgeFactor);
      } else if (nudgeRef.current.t0 > 0) {
        nudgeRef.current.t0 = 0;
        nudgeRef.current.impulse = 0;
      }

      // WebGL water
      if (gl && glProg) {
        gl.useProgram(glProg);
        if (uTimeLoc) gl.uniform1f(uTimeLoc, t);
        if (uResLoc) gl.uniform2f(uResLoc, water.width, water.height);
        if (uSwellLoc) gl.uniform1f(uSwellLoc, swellLfo);
        if (uConcernTintLoc) {
          gl.uniform3f(uConcernTintLoc, sm.tint[0], sm.tint[1], sm.tint[2]);
        }

        // pack active ripples into a vec4[12] uniform: (uvX, uvY, ageSec, strength)
        if (uRipplesLoc && uRippleCountLoc) {
          const MAX = 12;
          const data = new Float32Array(MAX * 4);
          const cw = lines.clientWidth || 1;
          const ch = lines.clientHeight || 1;
          let count = 0;
          for (let i = ripples.current.length - 1; i >= 0 && count < MAX; i--) {
            const r = ripples.current[i];
            const age = (now - r.t0) / 1000;
            if (age > 2.6) continue;
            data[count * 4 + 0] = r.x / cw;
            data[count * 4 + 1] = r.y / ch;
            data[count * 4 + 2] = age;
            data[count * 4 + 3] = r.strength;
            count++;
          }
          gl.uniform4fv(uRipplesLoc, data);
          gl.uniform1i(uRippleCountLoc, count);
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        // fallback: paint a depth gradient on the water canvas
        const wctx = water.getContext("2d");
        if (wctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const sg = wctx.createLinearGradient(0, 0, 0, h);
          sg.addColorStop(0.00, "rgba(242,238,230,1.0)");
          sg.addColorStop(0.18, "rgba(125,180,210, 1.0)");
          sg.addColorStop(0.55, "rgba( 60,120,180, 1.0)");
          sg.addColorStop(1.00, "rgba( 18, 38, 78, 1.0)");
          wctx.fillStyle = sg;
          wctx.fillRect(0, 0, w, h);
        }
      }

      // 2D wave lines layer — transparent, only the surface form
      lctx.clearRect(0, 0, w, h);

      // hairline horizon at the very top
      lctx.strokeStyle = "rgba(21, 23, 26, 0.18)";
      lctx.lineWidth = 1;
      lctx.beginPath();
      lctx.moveTo(0, 0.5);
      lctx.lineTo(w, 0.5);
      lctx.stroke();

      // cursor halo — small azure highlight near pointer
      if (pointer.current.over) {
        const px = pointer.current.x;
        const py = pointer.current.y;
        const r = 90;
        const hg = lctx.createRadialGradient(px, py, 0, px, py, r);
        hg.addColorStop(0, "rgba(220, 240, 250, 0.22)");
        hg.addColorStop(1, "rgba(220, 240, 250, 0)");
        lctx.fillStyle = hg;
        lctx.beginPath();
        lctx.arc(px, py, r, 0, 7);
        lctx.fill();
      }

      for (const sw of swells) {
        const y0 = h * sw.yFrac;
        const ampHere = sw.amp * swellMod;

        lctx.strokeStyle = sw.line;
        lctx.lineWidth = 1.4;
        lctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const phase = x * sw.freq + t * sw.speed * motion;
          const base =
            Math.sin(phase) +
            sw.compound * Math.sin(phase * 2.4 + t * sw.speed * 0.6 * motion) +
            sw.compound * 0.4 * Math.sin(phase * 0.6 - t * sw.speed * 0.3 * motion);
          const yy = y0 + base * ampHere + rippleDisp(x, y0, now);
          if (x === 0) lctx.moveTo(x, yy);
          else lctx.lineTo(x, yy);
        }
        lctx.stroke();

        // foam dabs at the crests
        lctx.fillStyle = sw.foam;
        for (let x = 0; x <= w; x += 5) {
          const phase = x * sw.freq + t * sw.speed * motion;
          const v =
            Math.sin(phase) +
            sw.compound * Math.sin(phase * 2.4 + t * sw.speed * 0.6 * motion);
          if (v > 1.05) {
            const yy = y0 + v * ampHere + rippleDisp(x, y0, now);
            const len = 1.5 + (v - 1.05) * 5;
            lctx.fillRect(x, yy - 1, len, 1);
          }
        }
      }

      // azure crest tips on the foremost swell
      const front = swells[swells.length - 1];
      lctx.fillStyle = "rgba(210, 240, 250, 0.7)";
      const y0f = h * front.yFrac;
      for (let x = 0; x <= w; x += 9) {
        const phase = x * front.freq + t * front.speed * motion;
        const v =
          Math.sin(phase) +
          front.compound * Math.sin(phase * 2.4 + t * front.speed * 0.6 * motion);
        if (v > 1.15) {
          const yy = y0f + v * (front.amp * swellMod) + rippleDisp(x, y0f, now);
          lctx.fillRect(x, yy - 2, 2, 1);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      lines.removeEventListener("pointerdown", onDown);
      lines.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      lines.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      aria-label="the sea — drag to disturb"
      data-touch-surface="true"
      style={{
        position: "relative",
        width: "100%",
        height: typeof height === "number" ? `${height}px` : height,
        overflow: "hidden",
        background: "var(--paper)",
      }}
    >
      <canvas
        ref={waterRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      <canvas
        ref={linesRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          // The Sea is embedded inside the home page, not fullscreen. If we
          // use touchAction: "none" the user can't scroll vertically past
          // the sea on phones. "pan-y" lets the page scroll while still
          // letting us own horizontal-ish drag for ripples.
          touchAction: "pan-y",
          cursor: "crosshair",
        }}
      />
    </div>
  );
}
