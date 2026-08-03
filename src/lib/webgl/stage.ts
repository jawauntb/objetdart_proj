"use client";

/**
 * webgl/stage — the GPU path made the path of least resistance.
 *
 * INSPIRATION.md's law is "procedural over assets: shaders, not sprites", and
 * DESIGN.md's anti-patterns name per-frame `createRadialGradient`, `shadowBlur`
 * on paths, and `ctx.filter` blur as the things that make a room both ugly and
 * slow. Rooms reached for canvas-2D anyway because raw WebGL setup is ~80 lines
 * of ceremony before a single pixel — context cascade, compile, link, quad,
 * DPR, teardown — and every room wrote its own, slightly differently. Six of
 * the twelve shader rooms leaked their programs; none of them survived a lost
 * context.
 *
 * `createGLStage` is that ceremony, once:
 *
 *   const stage = createGLStage(canvas, { wrap, label: "cells" });
 *   if (!stage) { …2D fallback… }
 *   const prog = stage.program(VERT, FRAG);
 *   const quad = stage.fullscreenQuad(prog);
 *   // per frame:
 *   stage.beginFrame(clocks, prog);   // sizes, viewports, binds the clocks
 *   quad.draw();
 *   // teardown:
 *   stage.dispose();                  // every program, shader and buffer
 *
 * The stage owns: the webgl2→webgl→experimental cascade, DPR through
 * `room-runtime`'s quality tiers, an optional lockstep 2D overlay canvas for
 * the *thin* interaction layer, shader errors with source context, the shared
 * clock uniforms in both naming dialects, an instanced-draw path that works on
 * WebGL1 via ANGLE, context-loss recovery, and complete disposal.
 */

import { resolveDpr, type QualityTier } from "@/lib/room-runtime";
import {
  CLOCK_UNIFORMS,
  POINTER_UNIFORMS,
  RESOLUTION_UNIFORMS,
  formatShaderError,
  resolveStageSize,
  sizeUnchanged,
  type RoomClocks,
  type StageSize,
} from "@/lib/webgl/sizing";

/** The one vertex shader eleven rooms had each written out by hand. */
export const FULLSCREEN_VERT_CLIP = `attribute vec2 a_pos;
varying vec2 vUv;
void main() {
  vUv = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** Same quad, uv in 0..1 instead of -1..1 (the /aphros convention). */
export const FULLSCREEN_VERT_UNIT = `attribute vec2 a_pos;
varying vec2 vUv;
void main() {
  vUv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export type GLStageOptions = {
  /** Element the canvas sizes to. Defaults to the canvas's parent. */
  wrap?: HTMLElement | null;
  /** Names the room in shader errors and warnings. */
  label?: string;
  /** WebGL2 first — instancing and 3D textures without extensions. */
  preferWebGL2?: boolean;
  contextAttributes?: WebGLContextAttributes;
  /** A second canvas kept at the same CSS size for the thin 2D layer. */
  overlay?: HTMLCanvasElement | null;
  /** Render the GL buffer at a fraction of layout size (sky, volumetrics). */
  renderScale?: number;
  quality?: QualityTier;
  reducedMotion?: boolean;
  embedded?: boolean;
  maxDpr?: number;
  /** Ceiling on drawing-buffer pixels; 0 disables. Default ~4.2M (≈1440p×2). */
  maxPixels?: number;
  /**
   * Force the context loss on dispose to hand GPU memory back immediately.
   * Off by default: a force-lost context can never be re-acquired on the same
   * canvas, so this makes the element single-use. Only set it when the canvas
   * is being discarded with the stage.
   */
  releaseContext?: boolean;
  onResize?: (size: StageSize) => void;
  onContextLost?: () => void;
  /** Rebuild programs here — every GL object is gone after a loss. */
  onContextRestored?: () => void;
};

export type GLProgram = {
  program: WebGLProgram;
  use: () => void;
  /** Cached; returns null when the uniform is absent or optimized away. */
  location: (name: string) => WebGLUniformLocation | null;
  attrib: (name: string) => number;
  /** Sets the first name that exists. Returns true if anything was written. */
  setFloat: (names: string | readonly string[], value: number) => boolean;
  setVec2: (names: string | readonly string[], x: number, y: number) => boolean;
  setVec3: (names: string | readonly string[], x: number, y: number, z: number) => boolean;
  setVec4: (names: string | readonly string[], x: number, y: number, z: number, w: number) => boolean;
  setInt: (names: string | readonly string[], value: number) => boolean;
  setFloatArray: (names: string | readonly string[], value: Float32Array) => boolean;
};

export type FullscreenQuad = {
  draw: () => void;
  dispose: () => void;
};

export type InstancedDraw = {
  /**
   * Upload (or re-upload) a per-instance attribute. `divisor` 1 advances once
   * per instance, 0 per vertex. Typed arrays only — the perf law.
   */
  attribute: (name: string, data: Float32Array, componentsPerVertex: number, divisor?: number) => void;
  /** One draw call for the whole population. */
  draw: (mode: number, verticesPerInstance: number, instances: number) => void;
  /** Zero every divisor — required before the next program's attributes bind. */
  reset: () => void;
  dispose: () => void;
};

export type GLStage = {
  gl: WebGLRenderingContext;
  /** Non-null when a WebGL2 context was obtained. */
  gl2: WebGL2RenderingContext | null;
  readonly size: StageSize;
  /** The 2D context of the lockstep overlay, pre-scaled to CSS pixels. */
  overlay2d: CanvasRenderingContext2D | null;
  program: (vert: string, frag: string) => GLProgram | null;
  fullscreenQuad: (prog: GLProgram, uv?: "clip" | "unit") => FullscreenQuad;
  instanced: (prog: GLProgram) => InstancedDraw;
  /** Resize if needed, set the viewport, and bind clocks + resolution. */
  beginFrame: (clocks: RoomClocks, prog?: GLProgram | null) => StageSize;
  /** Bind pointer position (CSS px) into whichever cursor uniform exists. */
  bindPointer: (prog: GLProgram, x: number, y: number) => void;
  /** Force a resize check (call from a ResizeObserver if you have your own). */
  measure: () => StageSize;
  contextLost: () => boolean;
  dispose: () => void;
};

const DEFAULT_MAX_PIXELS = 4_200_000;

/**
 * Acquire a context and build the stage. Returns null when the browser has no
 * WebGL at all — the caller owns the fallback, because "what this room looks
 * like without a GPU" is a design decision, not a library one.
 */
export function createGLStage(
  canvas: HTMLCanvasElement,
  options: GLStageOptions = {},
): GLStage | null {
  const label = options.label ?? "room";
  const wrap = options.wrap ?? canvas.parentElement ?? canvas;
  const attrs: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: true,
    powerPreference: "high-performance",
    ...options.contextAttributes,
  };

  let gl2: WebGL2RenderingContext | null = null;
  if (options.preferWebGL2 !== false) {
    gl2 = canvas.getContext("webgl2", attrs) as WebGL2RenderingContext | null;
  }
  const gl = (gl2 ??
    canvas.getContext("webgl", attrs) ??
    canvas.getContext("experimental-webgl" as "webgl", attrs)) as WebGLRenderingContext | null;
  if (!gl) return null;

  const angle = gl2 ? null : gl.getExtension("ANGLE_instanced_arrays");

  // Everything the stage creates, so dispose() is complete by construction
  // rather than by the author remembering.
  const programs = new Set<WebGLProgram>();
  const shaders = new Set<WebGLShader>();
  const buffers = new Set<WebGLBuffer>();
  let disposed = false;

  let size: StageSize = { width: 1, height: 1, pixelWidth: 1, pixelHeight: 1, ratio: 1 };
  let lastSize: StageSize | null = null;

  const overlay = options.overlay ?? null;
  const overlay2d = overlay ? overlay.getContext("2d") : null;

  const measure = (): StageSize => {
    const rect = wrap.getBoundingClientRect();
    const maxRatio = resolveDpr(options.quality ?? "high", {
      embedded: options.embedded,
      reducedMotion: options.reducedMotion,
      maxDpr: options.maxDpr,
    });
    const next = resolveStageSize({
      width: rect.width || wrap.clientWidth || 1,
      height: rect.height || wrap.clientHeight || 1,
      devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
      maxRatio,
      renderScale: options.renderScale,
      maxPixels: options.maxPixels ?? DEFAULT_MAX_PIXELS,
    });
    size = next;
    if (!sizeUnchanged(lastSize, next)) {
      canvas.width = next.pixelWidth;
      canvas.height = next.pixelHeight;
      canvas.style.width = `${next.width}px`;
      canvas.style.height = `${next.height}px`;
      if (overlay && overlay2d) {
        // The overlay is the *thin* interaction layer and stays at real DPR
        // even when the GL pass is downscaled — crisp strokes over a soft sky.
        const overlayRatio = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
        overlay.width = Math.max(1, Math.round(next.width * overlayRatio));
        overlay.height = Math.max(1, Math.round(next.height * overlayRatio));
        overlay.style.width = `${next.width}px`;
        overlay.style.height = `${next.height}px`;
        overlay2d.setTransform(overlayRatio, 0, 0, overlayRatio, 0, 0);
      }
      lastSize = next;
      options.onResize?.(next);
    }
    gl.viewport(0, 0, next.pixelWidth, next.pixelHeight);
    return next;
  };

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
  observer?.observe(wrap);
  measure();

  const compile = (type: number, src: string, stage: "vertex" | "fragment"): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(formatShaderError(label, stage, gl.getShaderInfoLog(shader), src));
      gl.deleteShader(shader);
      return null;
    }
    shaders.add(shader);
    return shader;
  };

  const makeProgram = (vert: string, frag: string): GLProgram | null => {
    const vs = compile(gl.VERTEX_SHADER, vert, "vertex");
    if (!vs) return null;
    const fs = compile(gl.FRAGMENT_SHADER, frag, "fragment");
    if (!fs) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    // Detach and delete immediately: the linked program holds what it needs,
    // and this is the leak six rooms had.
    gl.detachShader(program, vs);
    gl.detachShader(program, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    shaders.delete(vs);
    shaders.delete(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(formatShaderError(label, "link", gl.getProgramInfoLog(program), undefined));
      gl.deleteProgram(program);
      return null;
    }
    programs.add(program);

    const uniformCache = new Map<string, WebGLUniformLocation | null>();
    const attribCache = new Map<string, number>();

    const location = (name: string) => {
      if (!uniformCache.has(name)) uniformCache.set(name, gl.getUniformLocation(program, name));
      return uniformCache.get(name) ?? null;
    };
    const first = (names: string | readonly string[]) => {
      const list = typeof names === "string" ? [names] : names;
      for (const n of list) {
        const loc = location(n);
        if (loc) return loc;
      }
      return null;
    };

    return {
      program,
      use: () => gl.useProgram(program),
      location,
      attrib: (name) => {
        if (!attribCache.has(name)) attribCache.set(name, gl.getAttribLocation(program, name));
        return attribCache.get(name) ?? -1;
      },
      setFloat: (names, value) => {
        const loc = first(names);
        if (loc) gl.uniform1f(loc, value);
        return !!loc;
      },
      setInt: (names, value) => {
        const loc = first(names);
        if (loc) gl.uniform1i(loc, value);
        return !!loc;
      },
      setVec2: (names, x, y) => {
        const loc = first(names);
        if (loc) gl.uniform2f(loc, x, y);
        return !!loc;
      },
      setVec3: (names, x, y, z) => {
        const loc = first(names);
        if (loc) gl.uniform3f(loc, x, y, z);
        return !!loc;
      },
      setVec4: (names, x, y, z, w) => {
        const loc = first(names);
        if (loc) gl.uniform4f(loc, x, y, z, w);
        return !!loc;
      },
      setFloatArray: (names, value) => {
        const loc = first(names);
        if (loc) gl.uniform1fv(loc, value);
        return !!loc;
      },
    };
  };

  const fullscreenQuad = (prog: GLProgram, uv: "clip" | "unit" = "clip"): FullscreenQuad => {
    void uv; // the convention lives in the vertex shader the room chose
    const buffer = gl.createBuffer();
    if (buffer) buffers.add(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = prog.attrib("a_pos");
    return {
      draw: () => {
        prog.use();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        if (aPos >= 0) {
          gl.enableVertexAttribArray(aPos);
          gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      dispose: () => {
        if (buffer) {
          gl.deleteBuffer(buffer);
          buffers.delete(buffer);
        }
      },
    };
  };

  const setDivisor = (loc: number, d: number) => {
    if (gl2) gl2.vertexAttribDivisor(loc, d);
    else angle?.vertexAttribDivisorANGLE(loc, d);
  };

  const instanced = (prog: GLProgram): InstancedDraw => {
    const own = new Map<string, { buffer: WebGLBuffer; loc: number; components: number; divisor: number }>();
    return {
      attribute: (name, data, componentsPerVertex, divisor = 1) => {
        let entry = own.get(name);
        if (!entry) {
          const buffer = gl.createBuffer();
          if (!buffer) return;
          buffers.add(buffer);
          entry = { buffer, loc: prog.attrib(name), components: componentsPerVertex, divisor };
          own.set(name, entry);
        }
        entry.components = componentsPerVertex;
        entry.divisor = divisor;
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      },
      draw: (mode, verticesPerInstance, instances) => {
        if (instances <= 0) return;
        prog.use();
        for (const entry of own.values()) {
          if (entry.loc < 0) continue;
          gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
          gl.enableVertexAttribArray(entry.loc);
          gl.vertexAttribPointer(entry.loc, entry.components, gl.FLOAT, false, 0, 0);
          setDivisor(entry.loc, entry.divisor);
        }
        if (gl2) gl2.drawArraysInstanced(mode, 0, verticesPerInstance, instances);
        else angle?.drawArraysInstancedANGLE(mode, 0, verticesPerInstance, instances);
      },
      reset: () => {
        // Leaving a divisor set corrupts the next program's attributes — the
        // bug that costs an afternoon every time someone adds a second pass.
        for (const entry of own.values()) {
          if (entry.loc >= 0) setDivisor(entry.loc, 0);
        }
      },
      dispose: () => {
        for (const entry of own.values()) {
          gl.deleteBuffer(entry.buffer);
          buffers.delete(entry.buffer);
        }
        own.clear();
      },
    };
  };

  const beginFrame = (clocks: RoomClocks, prog?: GLProgram | null): StageSize => {
    const next = measure();
    if (prog) {
      prog.use();
      prog.setVec2(RESOLUTION_UNIFORMS, next.pixelWidth, next.pixelHeight);
      for (const [key, names] of Object.entries(CLOCK_UNIFORMS)) {
        prog.setFloat(names, clocks[key as keyof RoomClocks]);
      }
    }
    return next;
  };

  const bindPointer = (prog: GLProgram, x: number, y: number) => {
    prog.use();
    prog.setVec2(POINTER_UNIFORMS, x, y);
  };

  // Context loss: nothing in this codebase handled it, so a backgrounded tab
  // on a memory-pressured phone came back to a dead room. Swallow the default
  // so the browser will attempt a restore, and tell the room to rebuild.
  const onLost = (e: Event) => {
    e.preventDefault();
    lastSize = null;
    options.onContextLost?.();
  };
  const onRestored = () => {
    programs.clear();
    shaders.clear();
    buffers.clear();
    lastSize = null;
    measure();
    options.onContextRestored?.();
  };
  canvas.addEventListener("webglcontextlost", onLost as EventListener, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);

  return {
    gl,
    gl2,
    get size() {
      return size;
    },
    overlay2d,
    program: makeProgram,
    fullscreenQuad,
    instanced,
    beginFrame,
    bindPointer,
    measure,
    contextLost: () => gl.isContextLost(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost as EventListener);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      for (const b of buffers) gl.deleteBuffer(b);
      for (const s of shaders) gl.deleteShader(s);
      for (const p of programs) gl.deleteProgram(p);
      buffers.clear();
      shaders.clear();
      programs.clear();
      // Every program, shader and buffer is already gone, which is the bulk
      // of the memory. Forcing the context loss on top of that hands the rest
      // back sooner — but it also POISONS THE CANVAS: a lost context is never
      // re-acquired by `getContext` on the same element, so any remount onto
      // the same <canvas> renders nothing. React StrictMode double-invokes
      // every effect in development, so leaving this on by default made every
      // stage room blank the moment it mounted. Opt in only where the canvas
      // is genuinely being thrown away.
      if (options.releaseContext) gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
