"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";
import { relaxTurbulence, stirTurbulence } from "@/lib/turbulence";

/**
 * /ocean — the whole body of water, fullscreen.
 *
 * Where the embedded Sea is a horizon-strip, this is the open ocean seen
 * from just above the surface: a sky meeting the water at a high horizon,
 * a column of sun-glint shivering down the middle, depth falling away from
 * azure at the skyline through cerulean and a teal-green shelf into deep
 * ocean and a cold prussian-gray floor. A river current meanders across
 * the surface — a brighter, faster ribbon advected by its own flow — so
 * the page reads as ocean *and* river at once.
 *
 * Two layered canvases:
 *   1. WebGL water — the deep material. Depth gradient, fbm caustics,
 *      sun glint, the meandering river ribbon, foam at the wave crests,
 *      pointer ripples that displace and brighten the surface, and a
 *      device-tilt slosh that leans the whole body toward the low edge.
 *   2. 2D surface — foam crest lines, glint sparkle, the cursor halo, and
 *      a faint nautical bearing ring that turns with the phone's tilt.
 *
 * Touch-sensitive: every finger is its own wave source (multitouch), hard
 * presses stir the storm axis. Motion-sensitive: tilt sloshes, shake
 * churns whitecaps and thuds the room. If WebGL is unavailable the 2D
 * layer paints its own depth gradient and the piece still reads.
 */
export default function Ocean() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const waterRef = useRef<HTMLCanvasElement>(null);
  const surfRef = useRef<HTMLCanvasElement>(null);
  const ripples = useRef<Array<{ x: number; y: number; t0: number; strength: number }>>([]);
  const pointer = useRef<{ x: number; y: number; over: boolean; pressed: boolean; lastEmit: number }>({
    x: 0, y: 0, over: false, pressed: false, lastEmit: 0,
  });
  // device tilt, surfaced to the DOM bearing ring as a smoothed heading.
  const [bearing, setBearing] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const water = waterRef.current;
    const surf = surfRef.current;
    if (!wrap || !water || !surf) return;
    const sctx = surf.getContext("2d");
    if (!sctx) return;

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
    let uTiltLoc: WebGLUniformLocation | null = null;
    let uTurbLoc: WebGLUniformLocation | null = null;
    let uRipplesLoc: WebGLUniformLocation | null = null;
    let uRippleCountLoc: WebGLUniformLocation | null = null;

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
        uniform float uSwell;   // audio swell LFO, ~-1..1
        uniform float uTurb;    // storm axis 0..~1 (shake / hard press)
        uniform vec2 uTilt;     // device tilt bias
        uniform vec4 uRipples[12]; // xy uv, z age sec, w strength
        uniform int uRippleCount;
        varying vec2 vUv;

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
          for (int i = 0; i < 6; i++) {
            v += a * vnoise(p);
            p *= 2.03;
            a *= 0.52;
          }
          return v;
        }

        void main() {
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y); // y=0 sky, y=1 near water
          float aspect = uRes.x / uRes.y;
          float t = uTime;

          // ── horizon split ──────────────────────────────────────
          // sky occupies the top ~17%, the sea everything below. A soft
          // band of haze sits where they meet.
          float horizon = 0.17;
          float seaT = clamp((uv.y - horizon) / (1.0 - horizon), 0.0, 1.0);

          // ── pointer ripples (height field) ─────────────────────
          float rippleHi = 0.0;
          for (int i = 0; i < 12; i++) {
            if (i >= uRippleCount) break;
            vec4 r = uRipples[i];
            vec2 dp = (uv - r.xy) * vec2(aspect, 1.0);
            float dist = length(dp);
            float age = r.z;
            if (age > 2.8) continue;
            float speed = 0.30;
            float front = dist - age * speed;
            float env = exp(-(front * front) / 0.0026);
            float falloff = 1.0 / (1.0 + dist * 3.2);
            float temporal = max(0.0, 1.0 - age / 2.8);
            rippleHi += r.w * env * falloff * temporal;
          }

          // perspective compression: detail packs toward the horizon.
          float persp = mix(0.18, 1.0, seaT);

          // ── flow warp ──────────────────────────────────────────
          vec2 flow = vec2(
            sin(uv.y * 9.0 + t * 0.45) * 0.014,
            sin(uv.x * 7.0 + t * 0.32) * 0.010
          ) * persp;
          vec2 wuv = uv + flow + uTilt * (0.4 + seaT) + vec2(0.0, uSwell * 0.010 * persp);
          wuv += rippleHi * 0.012;

          // ── depth palette ──────────────────────────────────────
          // azure skyline -> cerulean -> teal-green shelf -> deep ocean
          // -> cold prussian-gray floor.
          vec3 azure    = vec3(0.52, 0.71, 0.82);
          vec3 cerulean = vec3(0.20, 0.48, 0.66);
          vec3 teal     = vec3(0.10, 0.42, 0.46); // the green shelf
          vec3 deep     = vec3(0.06, 0.20, 0.36);
          vec3 floorGray= vec3(0.10, 0.16, 0.22); // deep ocean gray

          vec3 color = mix(azure, cerulean, smoothstep(0.00, 0.30, seaT));
          color = mix(color, teal,      smoothstep(0.26, 0.52, seaT));
          color = mix(color, deep,      smoothstep(0.50, 0.80, seaT));
          color = mix(color, floorGray, smoothstep(0.80, 1.00, seaT));

          // ── river ribbon ───────────────────────────────────────
          // a meandering current crossing the sea: a brighter, faster band
          // whose centre wanders with fbm and whose interior is advected
          // along its length. reads as a river feeding the ocean.
          float meander = (fbm(vec2(uv.x * 1.6, t * 0.05)) - 0.5) * 0.34;
          float riverY = 0.52 + meander;
          float band = exp(-pow((uv.y - riverY) * 4.6, 2.0));
          vec2 ruv = vec2(uv.x * 3.0 - t * 0.16, uv.y * 6.0);
          float riverFlow = fbm(ruv + fbm(ruv * 0.5));
          vec3 riverCol = mix(vec3(0.16, 0.50, 0.55), vec3(0.40, 0.70, 0.74), riverFlow);
          color = mix(color, riverCol, band * 0.42);

          // ── caustics ───────────────────────────────────────────
          vec2 nuv = wuv * vec2(aspect, 1.0) * (3.0 + 4.0 * seaT) + vec2(t * 0.05, t * 0.03);
          float n = fbm(nuv);
          float c1 = sin((wuv.x + n * 0.18) * 24.0 + t * 0.55)
                   * sin((wuv.y + n * 0.14) * 16.0 - t * 0.38);
          float c2 = sin(wuv.x * 10.0 - t * 0.30 + n * 1.2)
                   * sin(wuv.y *  7.0 + t * 0.22 - n * 1.0);
          float caustic = c1 * 0.45 + c2 * 0.55;
          caustic = smoothstep(0.52, 1.05, caustic);
          float causticVis = mix(0.16, 0.04, seaT); // brighter up near the light
          color += caustic * causticVis * mix(vec3(1.0), vec3(0.72, 0.92, 1.0), seaT);

          // ── sun glint ──────────────────────────────────────────
          // a column of shivering specular near centre-x, strongest just
          // below the horizon, broken into facets by high-freq noise.
          float col = exp(-pow((uv.x - 0.5) * 2.4, 2.0));
          float facets = fbm(vec2(uv.x * 60.0, uv.y * 40.0 - t * 1.4));
          float glint = col * smoothstep(0.55, 1.0, facets) * (1.0 - seaT * 0.7);
          color += glint * 0.55 * vec3(1.0, 0.98, 0.90);

          // ── whitecaps / storm foam (turb-driven) ───────────────
          float caps = fbm(wuv * vec2(aspect, 1.0) * 14.0 + vec2(0.0, -t * 0.6));
          float foam = smoothstep(0.62, 0.9, caps) * uTurb * seaT;
          color = mix(color, vec3(0.86, 0.91, 0.93), foam * 0.6);

          // ripple highlights brighten their wavefronts
          color += rippleHi * 0.012 * vec3(0.74, 0.93, 1.0);

          // low-frequency weather wash
          float wash = sin(wuv.x * 1.8 + t * 0.12) * sin(wuv.y * 2.6 - t * 0.07);
          color += wash * 0.022 * vec3(0.85, 0.92, 1.0);

          // ── sky ────────────────────────────────────────────────
          // pale azure high, warming to a misty gray-blue at the skyline.
          vec3 skyTop = vec3(0.74, 0.84, 0.90);
          vec3 skyLow = vec3(0.86, 0.89, 0.88);
          vec3 sky = mix(skyTop, skyLow, smoothstep(0.0, horizon, uv.y));
          // faint sun bloom in the sky above the glint column
          sky += col * exp(-pow((horizon - uv.y) * 6.0, 2.0)) * 0.10;

          // horizon haze: blend a soft band so the seam is atmospheric.
          float seam = smoothstep(horizon - 0.04, horizon, uv.y)
                     * (1.0 - smoothstep(horizon, horizon + 0.06, uv.y));
          color = mix(color, vec3(0.80, 0.87, 0.90), seam * 0.5);

          // choose sky above the horizon
          float isSea = step(horizon, uv.y);
          vec3 outc = mix(sky, color, isSea);

          // gentle vignette toward the corners for depth
          vec2 vc = (vUv - 0.5);
          float vig = 1.0 - dot(vc, vc) * 0.35;
          outc *= vig;

          gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
        }
      `;
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn("ocean shader compile failed", gl.getShaderInfoLog(s));
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
            uTiltLoc = gl.getUniformLocation(p, "uTilt");
            uTurbLoc = gl.getUniformLocation(p, "uTurb");
            uRipplesLoc = gl.getUniformLocation(p, "uRipples");
            uRippleCountLoc = gl.getUniformLocation(p, "uRippleCount");

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

    // ── resize ────────────────────────────────────────────────────
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      water.width = Math.floor(w * dpr);
      water.height = Math.floor(h * dpr);
      surf.width = Math.floor(w * dpr);
      surf.height = Math.floor(h * dpr);
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gl) gl.viewport(0, 0, water.width, water.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── pointer / touch ───────────────────────────────────────────
    const addRipple = (x: number, y: number, strength: number) => {
      ripples.current.push({ x, y, t0: performance.now(), strength });
      if (ripples.current.length > 30) ripples.current.shift();
    };
    const pressed = new Map<number, { x: number; y: number; lastEmit: number }>();
    const pressureOf = (e: PointerEvent) => (e.pressure > 0 ? e.pressure : 0.5);
    const strengthScale = (p: number) => 0.6 + p * 0.95;

    // ── device sensors ────────────────────────────────────────────
    const tiltTarget = { x: 0, y: 0 };
    const tiltSmoothed = { x: 0, y: 0 };
    let sensorsArmed = false;
    let lastAccelMag: number | null = null;
    let lastShakeAt = 0;

    const onOrient = (e: DeviceOrientationEvent) => {
      const gx = (e.gamma ?? 0) / 45;
      const gy = ((e.beta ?? 45) - 45) / 45;
      tiltTarget.x = Math.max(-1, Math.min(1, gx));
      tiltTarget.y = Math.max(-1, Math.min(1, gy));
      // expose a compass heading from alpha for the bearing ring
      if (e.alpha != null) setBearing(e.alpha);
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      if (lastAccelMag != null) {
        const jolt = Math.abs(mag - lastAccelMag);
        if (jolt > 13) {
          stirTurbulence(Math.min(0.6, jolt / 34));
          const now = performance.now();
          if (now - lastShakeAt > 320) {
            lastShakeAt = now;
            haptics.storm();
            try { getFieldAudio().thud(); } catch { /* noop */ }
          }
        }
      }
      lastAccelMag = mag;
    };
    const armSensors = () => {
      if (sensorsArmed) return;
      sensorsArmed = true;
      type PermCtor = { requestPermission?: () => Promise<"granted" | "denied"> };
      const DOE = (window as unknown as { DeviceOrientationEvent?: PermCtor }).DeviceOrientationEvent;
      const DME = (window as unknown as { DeviceMotionEvent?: PermCtor }).DeviceMotionEvent;
      const add = () => {
        window.addEventListener("deviceorientation", onOrient);
        window.addEventListener("devicemotion", onMotion);
      };
      if (DOE && typeof DOE.requestPermission === "function") {
        Promise.allSettled([
          DOE.requestPermission?.(),
          DME?.requestPermission?.(),
        ]).then((res) => {
          if (res.some((r) => r.status === "fulfilled" && r.value === "granted")) add();
        }).catch(() => { /* noop */ });
      } else {
        add();
      }
    };

    const onDown = (e: PointerEvent) => {
      const r = surf.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const p = pressureOf(e);
      pressed.set(e.pointerId, { x, y, lastEmit: performance.now() });
      pointer.current.pressed = true;
      pointer.current.over = true;
      pointer.current.x = x;
      pointer.current.y = y;
      addRipple(x, y, 28 * strengthScale(p));
      stirTurbulence(p * 0.05);
      haptics.ripple(p);
      useField.getState().recordTape("ripple", 0.85);
      try { getFieldAudio().chime(); } catch { /* noop */ }
      armSensors();
    };
    const onUp = (e: PointerEvent) => {
      pressed.delete(e.pointerId);
      if (pressed.size === 0) pointer.current.pressed = false;
    };
    const onMove = (e: PointerEvent) => {
      const r = surf.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      pointer.current.over = true;
      pointer.current.x = x;
      pointer.current.y = y;
      const now = performance.now();
      const finger = pressed.get(e.pointerId);
      if (finger) {
        finger.x = x;
        finger.y = y;
        if (now - finger.lastEmit > 70) {
          const p = pressureOf(e);
          addRipple(x, y, 14 * strengthScale(p));
          finger.lastEmit = now;
          useField.getState().recordTape("ripple", 0.45);
          haptics.chop();
        }
      } else if (now - pointer.current.lastEmit > 200) {
        addRipple(x, y, 4);
        pointer.current.lastEmit = now;
      }
    };
    const onLeave = () => { pointer.current.over = false; };
    surf.addEventListener("pointerdown", onDown);
    surf.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    surf.addEventListener("pointerleave", onLeave);

    // ── render loop ───────────────────────────────────────────────
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
        if (age > 2.8) { list.splice(i, 1); continue; }
        const dx = x - r.x;
        const dy = y - r.y;
        const dist = Math.hypot(dx, dy);
        const spatialFalloff = 1 / (1 + dist / 90);
        const temporal = Math.max(0, 1 - age / 2.8);
        const speed = 260;
        const front = dist - age * speed;
        const env = Math.exp(-(front * front) / (70 * 70));
        d += r.strength * env * spatialFalloff * temporal;
      }
      return d;
    };

    const draw = (now: number) => {
      const w = surf.clientWidth;
      const h = surf.clientHeight;

      const audioT = getFieldAudio().getAudioTime();
      const t = audioT != null ? audioT : (now - t0) / 1000;

      const swellLfo = Math.sin(t * Math.PI * 2 * 0.12);
      const driftLfo = Math.sin(t * Math.PI * 2 * 0.03);
      let swellMod = 1 + swellLfo * 0.26 + driftLfo * 0.10;

      const turb = reduce ? 0 : relaxTurbulence(now);
      if (turb > 0) swellMod *= 1 + turb * 0.9;

      tiltSmoothed.x += (tiltTarget.x - tiltSmoothed.x) * 0.06;
      tiltSmoothed.y += (tiltTarget.y - tiltSmoothed.y) * 0.06;

      // ── WebGL water ─────────────────────────────────────────────
      if (gl && glProg) {
        gl.useProgram(glProg);
        if (uTimeLoc) gl.uniform1f(uTimeLoc, t);
        if (uResLoc) gl.uniform2f(uResLoc, water.width, water.height);
        if (uSwellLoc) gl.uniform1f(uSwellLoc, swellLfo + turb * 0.6);
        if (uTurbLoc) gl.uniform1f(uTurbLoc, Math.min(1, turb));
        if (uTiltLoc) gl.uniform2f(uTiltLoc, tiltSmoothed.x * 0.028, tiltSmoothed.y * 0.022);

        if (uRipplesLoc && uRippleCountLoc) {
          const MAX = 12;
          const data = new Float32Array(MAX * 4);
          const cw = surf.clientWidth || 1;
          const ch = surf.clientHeight || 1;
          let count = 0;
          for (let i = ripples.current.length - 1; i >= 0 && count < MAX; i--) {
            const r = ripples.current[i];
            const age = (now - r.t0) / 1000;
            if (age > 2.8) continue;
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
        // fallback depth gradient
        const wctx = water.getContext("2d");
        if (wctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const sg = wctx.createLinearGradient(0, 0, 0, h);
          sg.addColorStop(0.00, "rgba(196,214,222,1)");
          sg.addColorStop(0.17, "rgba(130,180,205,1)");
          sg.addColorStop(0.40, "rgba( 26,107,117,1)"); // teal shelf
          sg.addColorStop(0.72, "rgba( 16, 52, 92,1)");
          sg.addColorStop(1.00, "rgba( 24, 40, 56,1)"); // ocean gray
          wctx.fillStyle = sg;
          wctx.fillRect(0, 0, w, h);
        }
      }

      // ── 2D surface layer ────────────────────────────────────────
      sctx.clearRect(0, 0, w, h);
      const horizonY = h * 0.17;

      // foam crest lines marching toward the viewer; spacing widens with
      // perspective so they read as receding swells.
      const crests = 7;
      for (let i = 0; i < crests; i++) {
        const f = i / (crests - 1);
        // perspective: cluster near horizon, spread near the bottom
        const yBase = horizonY + (h - horizonY) * (f * f);
        const amp = (3 + f * 18) * swellMod;
        const freq = 0.006 + (1 - f) * 0.010;
        const speed = 0.14 + f * 0.30;
        const alpha = 0.10 + f * 0.32;
        sctx.strokeStyle = `rgba(232, 244, 248, ${alpha})`;
        sctx.lineWidth = 1 + f * 0.6;
        sctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const phase = x * freq + t * speed * motion;
          const base =
            Math.sin(phase) +
            0.35 * Math.sin(phase * 2.3 + t * speed * 0.6 * motion) +
            0.18 * Math.sin(phase * 0.6 - t * speed * 0.3 * motion);
          const yy = yBase + base * amp + rippleDisp(x, yBase, now) * (0.4 + f * 0.6);
          if (x === 0) sctx.moveTo(x, yy);
          else sctx.lineTo(x, yy);
        }
        sctx.stroke();

        // foam dabs at the crests of the nearer swells
        if (f > 0.4) {
          sctx.fillStyle = `rgba(244, 250, 252, ${alpha + 0.1})`;
          for (let x = 0; x <= w; x += 6) {
            const phase = x * freq + t * speed * motion;
            const v = Math.sin(phase) + 0.35 * Math.sin(phase * 2.3 + t * speed * 0.6 * motion);
            if (v > 1.04) {
              const yy = yBase + v * amp + rippleDisp(x, yBase, now) * (0.4 + f * 0.6);
              sctx.fillRect(x, yy - 1, 1.5 + (v - 1.04) * 6, 1.2);
            }
          }
        }
      }

      // sun-glint sparkle in the central column just under the horizon
      const glintTop = horizonY + 6;
      const glintBottom = h * 0.55;
      const cx = w * 0.5;
      sctx.fillStyle = "rgba(255, 252, 238, 0.5)";
      for (let s = 0; s < 46; s++) {
        const seed = s * 12.9898;
        const rx = (Math.sin(seed) * 43758.5453) % 1;
        const ry = (Math.sin(seed * 1.7) * 24634.6345) % 1;
        const sparkleX = cx + (Math.abs(rx) - 0.5) * w * 0.34;
        const sy = glintTop + Math.abs(ry) * (glintBottom - glintTop);
        const tw = 0.5 + 0.5 * Math.sin(t * 5 + s * 1.3);
        if (tw > 0.55) {
          const sz = (1 - (sy - glintTop) / (glintBottom - glintTop)) * 2.4 * tw;
          sctx.globalAlpha = 0.18 + tw * 0.4;
          sctx.fillRect(sparkleX, sy, sz + 0.6, 0.9);
        }
      }
      sctx.globalAlpha = 1;

      // cursor halo
      if (pointer.current.over) {
        const px = pointer.current.x;
        const py = pointer.current.y;
        const rad = 100;
        const hg = sctx.createRadialGradient(px, py, 0, px, py, rad);
        hg.addColorStop(0, "rgba(224, 244, 250, 0.22)");
        hg.addColorStop(1, "rgba(224, 244, 250, 0)");
        sctx.fillStyle = hg;
        sctx.beginPath();
        sctx.arc(px, py, rad, 0, 7);
        sctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      surf.removeEventListener("pointerdown", onDown);
      surf.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      surf.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      data-touch-surface="true"
      aria-label="the ocean — drag to disturb the water; tilt your phone to lean the sea"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#0e1c2c",
      }}
    >
      <canvas
        ref={waterRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      <canvas
        ref={surfRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
          cursor: "crosshair",
        }}
      />

      {/* faint nautical bearing ring — turns with the phone's heading */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: 22,
          bottom: 26,
          width: 64,
          height: 64,
          pointerEvents: "none",
          opacity: 0.5,
        }}
      >
        <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: `rotate(${-bearing}deg)`, transition: "transform 200ms linear" }}>
          <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(232,244,248,0.55)" strokeWidth="1" />
          <circle cx="32" cy="32" r="22" fill="none" stroke="rgba(232,244,248,0.22)" strokeWidth="0.6" />
          {/* N S E W ticks */}
          {[0, 90, 180, 270].map((d) => (
            <line
              key={d}
              x1="32" y1="4" x2="32" y2={d === 0 ? 12 : 9}
              stroke="rgba(232,244,248,0.7)" strokeWidth={d === 0 ? 1.4 : 0.8}
              transform={`rotate(${d} 32 32)`}
            />
          ))}
          {/* compass needle: north half warm */}
          <polygon points="32,8 35,32 32,30 29,32" fill="rgba(200,115,42,0.85)" />
          <polygon points="32,56 35,32 32,34 29,32" fill="rgba(232,244,248,0.6)" />
        </svg>
      </div>

      {/* the inscription */}
      <div
        style={{
          position: "fixed",
          left: 0, right: 0, bottom: 24,
          textAlign: "center",
          pointerEvents: "none",
          zIndex: 6,
        }}
      >
        <span
          role="button"
          tabIndex={0}
          aria-label="the river remembers the sea — bell"
          onClick={(e) => {
            e.stopPropagation();
            try { getFieldAudio().bell(); } catch { /* noop */ }
            useField.getState().recordTape("ripple", 0.55, "inscription");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              try { getFieldAudio().bell(); } catch { /* noop */ }
            }
          }}
          style={{
            display: "inline-block",
            padding: "4px 8px",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 16,
            color: "rgba(238, 246, 248, 0.6)",
            letterSpacing: "0.005em",
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        >
          every river is the sea remembering its way home.
        </span>
      </div>
    </div>
  );
}
