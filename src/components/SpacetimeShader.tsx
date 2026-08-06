"use client";

import { useEffect, useRef } from "react";
import { isEmbeddedFrame, onVisibility, resolveDpr } from "@/lib/room-runtime";

/**
 * createGravityFieldRenderer — the shared curvature field.
 *
 * ManifoldFold and RelativityRoom both re-derive a gravity well's shading
 * per mass, per frame, on the 2D canvas (a `createRadialGradient` inside
 * the mass loop — forbidden by the room-runtime performance contract, and
 * the textbook case for a fragment shader: the room is drawing a *field*,
 * not compositing sprites). This is that field, factored once so both
 * rooms drive it from their own physics (`src/lib/manifold-field.ts` /
 * `src/lib/relativity.ts`) without duplicating the render.
 *
 * One fullscreen quad; up to `maxMasses` wells summed per pixel in the
 * fragment shader (a fixed-size unrolled loop — cheap regardless of how
 * many are actually live, unused slots carry zero strength). `mode`
 * chooses the blend: "shadow" darkens toward black (ManifoldFold's well
 * shade), "glow" adds warm light (RelativityRoom's well/lens glow). Both
 * rooms keep their own palette and physics; this only sums the falloff.
 *
 * WebGL2 preferred, WebGL1 fallback, `ok: false` (and a no-op draw) when
 * neither is available — the caller keeps its existing 2D path guarded
 * behind `renderer.ok`. Handles `webglcontextlost` / `webglcontextrestored`
 * by recompiling in place; `dispose()` frees every GL resource.
 */
export type FieldMass = { x: number; y: number; r: number; strength: number };
export type FieldMode = "shadow" | "glow";

// Hoisted so `draw()` never allocates a fresh fallback array on frames where
// the caller omits `opts.core` / `opts.ring` — same default values, read-only.
const DEFAULT_FIELD_CORE: [number, number, number] = [0.85, 0.63, 0.3];
const DEFAULT_FIELD_RING: [number, number, number] = [0.42, 0.71, 0.74];

export type GravityFieldRenderer = {
  /** false when WebGL is unavailable or the context is currently lost. */
  readonly ok: boolean;
  resize: (width: number, height: number, dpr: number) => void;
  draw: (
    now: number,
    masses: FieldMass[],
    opts?: { core?: [number, number, number]; ring?: [number, number, number]; alpha?: number; reduced?: boolean },
  ) => void;
  dispose: () => void;
};

const FIELD_VERT = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

function fieldFrag(maxMasses: number, mode: FieldMode) {
  return `
    precision highp float;
    uniform vec2 u_res;
    uniform float u_time;
    uniform float u_alpha;
    uniform vec3 u_core;
    uniform vec3 u_ring;
    uniform vec4 u_mass[${maxMasses}]; // x, y (px), r, strength
    void main() {
      vec2 p = gl_FragCoord.xy;
      p.y = u_res.y - p.y; // flip to canvas-2d's top-left origin
      float acc = 0.0;
      float ring = 0.0;
      for (int i = 0; i < ${maxMasses}; i++) {
        vec4 m = u_mass[i];
        if (m.w <= 0.0) continue;
        float d = distance(p, m.xy);
        float r = max(1.0, m.z);
        // well falloff: full strength near the core, gone by ~3.2r — the
        // same shape the old per-mass radial gradient stopped at.
        float u = clamp((d - r * 0.2) / (r * 3.0), 0.0, 1.0);
        float falloff = (1.0 - u);
        falloff = falloff * falloff;
        acc += m.w * falloff;
        // a thin bright rim just past the core — the lensing edge
        float e = abs(d - r * 1.15) / max(2.0, r * 0.35);
        ring += m.w * exp(-e * e) * 0.9;
      }
      acc = clamp(acc, 0.0, 1.0);
      ring = clamp(ring, 0.0, 1.0);
      ${
        mode === "shadow"
          ? `
      vec3 col = vec3(0.0);
      float alpha = acc * 0.55 * u_alpha;
      alpha = max(alpha, ring * 0.12 * u_alpha);
      col = mix(col, u_ring, ring * 0.4);
      gl_FragColor = vec4(col * alpha, alpha);
      `
          : `
      vec3 col = u_core * acc + u_ring * ring;
      float alpha = clamp(acc * 0.9 + ring * 0.8, 0.0, 1.0) * u_alpha;
      gl_FragColor = vec4(col * alpha, alpha);
      `
      }
    }
  `;
}

export function createGravityFieldRenderer(
  canvas: HTMLCanvasElement,
  mode: FieldMode,
  maxMasses = 8,
): GravityFieldRenderer {
  let ok = false;
  let gl: WebGLRenderingContext | null = null;
  let prog: WebGLProgram | null = null;
  let buf: WebGLBuffer | null = null;
  let vs: WebGLShader | null = null;
  let fs: WebGLShader | null = null;
  let uRes: WebGLUniformLocation | null = null;
  let uTime: WebGLUniformLocation | null = null;
  let uAlpha: WebGLUniformLocation | null = null;
  let uCore: WebGLUniformLocation | null = null;
  let uRing: WebGLUniformLocation | null = null;
  let uMass: WebGLUniformLocation | null = null;
  let w = 1;
  let h = 1;
  let dpr = 1; // masses arrive in the caller's CSS-px space; the shader works in device px
  const massBuf = new Float32Array(maxMasses * 4);

  const compile = (type: number, src: string) => {
    if (!gl) return null;
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  };

  const init = () => {
    ok = false;
    gl = (canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true }) ||
      canvas.getContext("experimental-webgl" as "webgl")) as WebGLRenderingContext | null;
    if (!gl) return;
    vs = compile(gl.VERTEX_SHADER, FIELD_VERT);
    fs = compile(gl.FRAGMENT_SHADER, fieldFrag(maxMasses, mode));
    if (!vs || !fs) return;
    prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.useProgram(prog);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    uRes = gl.getUniformLocation(prog, "u_res");
    uTime = gl.getUniformLocation(prog, "u_time");
    uAlpha = gl.getUniformLocation(prog, "u_alpha");
    uCore = gl.getUniformLocation(prog, "u_core");
    uRing = gl.getUniformLocation(prog, "u_ring");
    uMass = gl.getUniformLocation(prog, "u_mass[0]");
    gl.viewport(0, 0, canvas.width, canvas.height);
    ok = true;
  };

  const teardown = () => {
    if (gl) {
      if (prog) gl.deleteProgram(prog);
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      if (buf) gl.deleteBuffer(buf);
    }
    prog = null; vs = null; fs = null; buf = null;
    ok = false;
  };

  const onLost = (ev: Event) => {
    ev.preventDefault();
    ok = false;
  };
  const onRestored = () => {
    teardown();
    init();
  };
  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);

  init();

  return {
    get ok() { return ok; },
    resize(width, height, nextDpr) {
      dpr = nextDpr;
      w = Math.max(1, Math.floor(width * dpr));
      h = Math.max(1, Math.floor(height * dpr));
      canvas.width = w;
      canvas.height = h;
      if (gl && ok) gl.viewport(0, 0, w, h);
    },
    draw(now, masses, opts) {
      if (!gl || !ok || !prog) return;
      const alpha = opts?.alpha ?? 1;
      const core = opts?.core ?? DEFAULT_FIELD_CORE;
      const ring = opts?.ring ?? DEFAULT_FIELD_RING;
      massBuf.fill(0);
      const n = Math.min(maxMasses, masses.length);
      for (let i = 0; i < n; i++) {
        const m = masses[i];
        massBuf[i * 4] = m.x * dpr;
        massBuf[i * 4 + 1] = m.y * dpr;
        massBuf[i * 4 + 2] = m.r * dpr;
        massBuf[i * 4 + 3] = m.strength;
      }
      gl.useProgram(prog);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, now / 1000);
      gl.uniform1f(uAlpha, alpha);
      gl.uniform3f(uCore, core[0], core[1], core[2]);
      gl.uniform3f(uRing, ring[0], ring[1], ring[2]);
      gl.uniform4fv(uMass, massBuf);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      teardown();
    },
  };
}

/**
 * A living backdrop for the grande complication: rose-engine guilloché
 * interference fused with a gravitational lens that bends toward the cursor.
 * Gold-and-teal to match the house palette; deliberately dim so the dial
 * stays the star. Falls back to a static CSS gradient if WebGL is absent.
 */
export default function SpacetimeShader({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursor = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, warp: 0.18, twarp: 0.18 });

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const gl = (canvas.getContext("webgl", { antialias: false, premultipliedAlpha: true, alpha: true }) ||
      canvas.getContext("experimental-webgl" as "webgl", { alpha: true } as WebGLContextAttributes)) as WebGLRenderingContext | null;
    if (!gl) { wrap.setAttribute("data-shader-fallback", "1"); return; }

    const vert = `
      attribute vec2 a_pos;
      varying vec2 vUv;
      void main() { vUv = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;
    const frag = `
      precision highp float;
      uniform float u_time;
      uniform float u_reduced;
      uniform vec2  u_res;
      uniform vec2  u_cursor;   // 0..1
      uniform float u_warp;     // gravity strength 0..1

      float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }

      void main(){
        vec2 res = u_res;
        float ar = res.x / max(1.0, res.y);
        vec2 uv = (gl_FragCoord.xy / res) * 2.0 - 1.0;
        uv.x *= ar;

        // gravity well toward the cursor — spacetime curvature
        vec2 cur = (u_cursor * 2.0 - 1.0); cur.x *= ar; cur.y *= -1.0;
        vec2 toC = uv - cur;
        float d = length(toC) + 0.06;
        float pull = u_warp * 0.55 / d;
        vec2 wuv = uv - toC * pull;

        float t = u_time * mix(0.06, 1.0, 1.0 - u_reduced);
        float r = length(wuv);
        float a = atan(wuv.y, wuv.x);

        // rose-engine guilloché: crossed radial + circular interference
        float rings = sin(r * 46.0 - t * 0.9);
        float rays  = sin(a * 30.0 + r * 8.0 - t * 0.4);
        float bary  = sin((wuv.x + wuv.y) * 60.0) * sin((wuv.x - wuv.y) * 60.0); // barleycorn
        float eng   = rings * 0.5 + rays * 0.35 + bary * 0.3;
        float lines = smoothstep(0.55, 0.95, abs(eng));

        // a soft gravity-lens ridge ringing the cursor
        float lens = smoothstep(0.5, 0.0, abs(d - 0.34)) * u_warp;

        // palette — ink base, gold ridges, teal counter-light
        vec3 ink  = vec3(0.055, 0.06, 0.07);
        vec3 gold = vec3(0.85, 0.63, 0.30);
        vec3 teal = vec3(0.42, 0.71, 0.74);
        vec3 col = ink;
        col = mix(col, gold, lines * 0.5);
        col = mix(col, teal, smoothstep(0.7, 1.0, abs(rays)) * 0.18);
        col += gold * lens * 0.9;

        // central bloom under the dial + vignette
        col += gold * exp(-r * r * 1.4) * 0.10;
        col *= smoothstep(1.7, 0.2, r);

        // starfield twinkle in the dark corners
        vec2 gp = floor((gl_FragCoord.xy) / 3.0);
        float star = step(0.992, hash21(gp));
        float tw = 0.5 + 0.5 * sin(t * 3.0 + hash21(gp) * 30.0);
        col += vec3(0.8, 0.85, 1.0) * star * tw * smoothstep(0.7, 1.4, r) * 0.5;

        float alpha = clamp(max(max(col.r, col.g), col.b) * 1.2, 0.0, 1.0);
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

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches ? 1 : 0;
    const onMq = () => { reduced = mq.matches ? 1 : 0; };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);

    const resize = () => {
      const dpr = resolveDpr("high", { embedded: isEmbeddedFrame(), reducedMotion: reduced === 1, maxDpr: 2 });
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      cursor.current.tx = (e.clientX - rect.left) / rect.width;
      cursor.current.ty = (e.clientY - rect.top) / rect.height;
      cursor.current.twarp = 0.55;
    };
    const onLeave = () => { cursor.current.twarp = 0.18; };
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);

    let raf = 0;
    let sleeping = false;
    const t0 = performance.now();
    const draw = (now: number) => {
      if (sleeping) { raf = 0; return; } // no draw while the tab can't see it
      const c = cursor.current;
      c.x += (c.tx - c.x) * 0.08;
      c.y += (c.ty - c.y) * 0.08;
      c.warp += (c.twarp - c.warp) * 0.05;
      c.twarp += (0.18 - c.twarp) * 0.02; // relax toward idle
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.uniform1f(uReduced, reduced);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uCursor, c.x, c.y);
      gl.uniform1f(uWarp, c.warp);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const offVis = onVisibility((hiddenNow) => {
      sleeping = hiddenNow;
      if (!hiddenNow && !raf) raf = requestAnimationFrame(draw);
    });

    const onLost = (ev: Event) => { ev.preventDefault(); cancelAnimationFrame(raf); raf = 0; };
    const onRestored = () => { /* a static ambient backdrop: reload is enough */ };
    canvas.addEventListener("webglcontextlost", onLost, false);
    canvas.addEventListener("webglcontextrestored", onRestored, false);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      offVis();
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onMq);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buf);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`spacetime-shader ${className ?? ""}`} aria-hidden="true">
      <canvas ref={canvasRef} />
      <style dangerouslySetInnerHTML={{ __html: `
        .spacetime-shader {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          overflow: hidden;
          background: radial-gradient(circle at 50% 42%, rgba(217,161,77,0.10), rgba(8,9,12,0.0) 62%);
        }
        .spacetime-shader canvas { width: 100%; height: 100%; display: block; }
        .spacetime-shader[data-shader-fallback="1"] {
          background:
            repeating-radial-gradient(circle at 50% 50%, rgba(217,161,77,0.06) 0 2px, transparent 2px 7px),
            radial-gradient(circle at 50% 42%, rgba(217,161,77,0.12), rgba(8,9,12,0) 62%);
        }
      ` }} />
    </div>
  );
}
