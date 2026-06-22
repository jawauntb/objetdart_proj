"use client";

import { useEffect, useRef } from "react";

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
      cursor.current.tx = (e.clientX - rect.left) / rect.width;
      cursor.current.ty = (e.clientY - rect.top) / rect.height;
      cursor.current.twarp = 0.55;
    };
    const onLeave = () => { cursor.current.twarp = 0.18; };
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);

    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
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

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onMq);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
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
