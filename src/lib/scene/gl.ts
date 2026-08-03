"use client";

/**
 * scene/gl — the room's two passes: a background field, then the whole
 * population in one instanced draw.
 *
 * A room is a field plus the things standing in it. The field is a fragment
 * shader over a fullscreen quad — sky, water, curvature, plasm, caustics,
 * density — because that is what a shader is *for* and what 2D compositing
 * can only imitate. The things are instances: eight numbers each, one draw
 * call for the population, an SDF disc with a soft additive corona instead of
 * a `createRadialGradient` per object per frame.
 *
 * Everything here degrades rather than fails: no WebGL2 → a 2D fallback that
 * draws the same instances from ONE pre-rendered sprite via `drawImage` (still
 * no per-object gradients, still no `shadowBlur`); context lost → the room
 * keeps its state and re-uploads on restore; `dispose()` returns every GL
 * object.
 *
 * Rooms never write this wiring. They hand `createSceneLayer` a GLSL function
 * for their field and then describe their objects.
 */

import { resolveDpr, type QualityTier } from "@/lib/room-runtime";
import { INSTANCE_STRIDE, type InstanceBuffer } from "@/lib/scene/instances";

export type SceneLayerOptions = {
  /**
   * The room's field, as GLSL ES 3.0. Must define:
   *   `vec3 field(vec2 uv, float t)`
   * with `uv` in 0..1 (y up) and `t` in seconds. Uniforms available:
   * `uRes` (vec2, css px), `uBreath` (0..1), `uWind`, `uGravity`,
   * `uAgitation`, `uSeason`, `uDetail`.
   */
  field?: string;
  /** Palette the instance pass reads `hue` against: three anchor colours. */
  palette?: [string, string, string];
  /** Fallback flat background when there is no GL context at all. */
  fallback?: string;
  maxInstances?: number;
};

export type SceneLayer = {
  readonly mode: "webgl2" | "2d";
  /** css size + the tier's DPR ceiling. Safe to call every resize. */
  resize(cssWidth: number, cssHeight: number, tier: QualityTier, ctx?: { embedded?: boolean; reducedMotion?: boolean }): void;
  /** one frame: field, then the population. */
  draw(buf: InstanceBuffer, uniforms: FieldUniforms): void;
  dispose(): void;
};

export type FieldUniforms = {
  tSec: number;
  breath: number;
  wind: number;
  gravity: number;
  agitation: number;
  season: number;
  detail: number;
};

const DEFAULT_FIELD = `
vec3 field(vec2 uv, float t) {
  float d = length(uv - vec2(0.5, 0.55));
  float haze = smoothstep(0.85, 0.05, d);
  return mix(vec3(0.031, 0.043, 0.063), vec3(0.07, 0.09, 0.13), haze * (0.6 + 0.4 * uBreath));
}`;

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aPos;
layout(location = 2) in float aR;
layout(location = 3) in float aRot;
layout(location = 4) in float aHue;
layout(location = 5) in float aGlow;
layout(location = 6) in float aPhase;
layout(location = 7) in float aAlpha;
uniform vec2 uRes;
out vec2 vLocal;
out float vHue;
out float vGlow;
out float vPhase;
out float vAlpha;
void main() {
  // The corona wants room past the disc; the quad is oversized so the
  // additive falloff is never clipped at the sprite edge.
  vec2 local = aCorner * 1.9;
  float c = cos(aRot), s = sin(aRot);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 px = aPos + rotated * aR;
  vec2 clip = (px / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = local;
  vHue = aHue;
  vGlow = aGlow;
  vPhase = aPhase;
  vAlpha = aAlpha;
}`;

const FRAG_FIELD = (field: string) => `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uBreath;
uniform float uWind;
uniform float uGravity;
uniform float uAgitation;
uniform float uSeason;
uniform float uDetail;
out vec4 fragColor;
${field}
void main() {
  vec2 uv = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  fragColor = vec4(field(uv, uTime), 1.0);
}`;

const FRAG_SPRITE = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vHue;
in float vGlow;
in float vPhase;
in float vAlpha;
uniform vec3 uPalA;
uniform vec3 uPalB;
uniform vec3 uPalC;
out vec4 fragColor;
vec3 palette(float h) {
  h = clamp(h, 0.0, 1.0);
  return h < 0.5 ? mix(uPalA, uPalB, h * 2.0) : mix(uPalB, uPalC, (h - 0.5) * 2.0);
}
void main() {
  float d = length(vLocal);
  // One signed-distance disc plus its corona — the shape a radial gradient
  // was being rebuilt every frame to fake.
  float core = 1.0 - smoothstep(0.72, 1.0, d);
  float corona = exp(-d * d * 2.6) * vGlow;
  float a = clamp(core + corona, 0.0, 1.0) * vAlpha;
  if (a <= 0.003) discard;
  vec3 c = palette(vHue) * (0.75 + 0.45 * vPhase);
  fragColor = vec4(c * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function createSceneLayer(
  canvas: HTMLCanvasElement,
  options: SceneLayerOptions = {},
): SceneLayer {
  const palette = options.palette ?? ["#2c4a5c", "#c8732a", "#f3d77a"];
  const maxInstances = options.maxInstances ?? 4096;
  const fallback = options.fallback ?? "#0a0d12";

  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
  } catch {
    gl = null;
  }

  if (!gl) return create2dLayer(canvas, palette, fallback);

  const g = gl;
  let fieldProg = link(g, VERT_FULLSCREEN, FRAG_FIELD(options.field ?? DEFAULT_FIELD));
  let spriteProg = link(g, VERT, FRAG_SPRITE);
  if (!fieldProg || !spriteProg) {
    // A shader that will not compile must not take the room down with it.
    if (fieldProg) g.deleteProgram(fieldProg);
    if (spriteProg) g.deleteProgram(spriteProg);
    return create2dLayer(canvas, palette, fallback);
  }

  const quad = g.createBuffer();
  const corners = g.createBuffer();
  const instances = g.createBuffer();
  const vaoField = g.createVertexArray();
  const vaoSprite = g.createVertexArray();

  g.bindBuffer(g.ARRAY_BUFFER, quad);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
  g.bindVertexArray(vaoField);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);

  g.bindBuffer(g.ARRAY_BUFFER, corners);
  g.bufferData(
    g.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    g.STATIC_DRAW,
  );
  g.bindVertexArray(vaoSprite);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  g.bindBuffer(g.ARRAY_BUFFER, instances);
  g.bufferData(g.ARRAY_BUFFER, maxInstances * INSTANCE_STRIDE * 4, g.DYNAMIC_DRAW);
  const stride = INSTANCE_STRIDE * 4;
  // location 1 = vec2 position; 2..7 = the six scalars
  g.enableVertexAttribArray(1);
  g.vertexAttribPointer(1, 2, g.FLOAT, false, stride, 0);
  g.vertexAttribDivisor(1, 1);
  for (let i = 0; i < 6; i++) {
    const loc = 2 + i;
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 1, g.FLOAT, false, stride, 8 + i * 4);
    g.vertexAttribDivisor(loc, 1);
  }
  g.bindVertexArray(null);

  const uField = {
    res: g.getUniformLocation(fieldProg, "uRes"),
    time: g.getUniformLocation(fieldProg, "uTime"),
    breath: g.getUniformLocation(fieldProg, "uBreath"),
    wind: g.getUniformLocation(fieldProg, "uWind"),
    gravity: g.getUniformLocation(fieldProg, "uGravity"),
    agitation: g.getUniformLocation(fieldProg, "uAgitation"),
    season: g.getUniformLocation(fieldProg, "uSeason"),
    detail: g.getUniformLocation(fieldProg, "uDetail"),
  };
  const uSprite = {
    res: g.getUniformLocation(spriteProg, "uRes"),
    a: g.getUniformLocation(spriteProg, "uPalA"),
    b: g.getUniformLocation(spriteProg, "uPalB"),
    c: g.getUniformLocation(spriteProg, "uPalC"),
  };
  const pal = palette.map(hexToRgb);

  let cssW = 1;
  let cssH = 1;
  let lost = false;

  const onLost = (ev: Event) => {
    ev.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    // State lives in the population, not in the GPU — a restored context only
    // has to be re-sized and it draws the same room again.
    lost = false;
  };
  canvas.addEventListener("webglcontextlost", onLost as EventListener);
  canvas.addEventListener("webglcontextrestored", onRestored);

  return {
    mode: "webgl2",
    resize(w, h, tier, ctx) {
      cssW = Math.max(1, w);
      cssH = Math.max(1, h);
      const dpr = resolveDpr(tier, ctx ?? {});
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      g.viewport(0, 0, canvas.width, canvas.height);
    },
    draw(buf, u) {
      if (lost || g.isContextLost()) return;
      g.viewport(0, 0, canvas.width, canvas.height);
      g.disable(g.DEPTH_TEST);

      g.useProgram(fieldProg);
      g.uniform2f(uField.res, cssW, cssH);
      g.uniform1f(uField.time, u.tSec);
      g.uniform1f(uField.breath, u.breath);
      g.uniform1f(uField.wind, u.wind);
      g.uniform1f(uField.gravity, u.gravity);
      g.uniform1f(uField.agitation, u.agitation);
      g.uniform1f(uField.season, u.season);
      g.uniform1f(uField.detail, u.detail);
      g.bindVertexArray(vaoField);
      g.disable(g.BLEND);
      g.drawArrays(g.TRIANGLES, 0, 3);

      if (buf.count > 0) {
        g.useProgram(spriteProg);
        g.uniform2f(uSprite.res, cssW, cssH);
        g.uniform3f(uSprite.a, pal[0][0], pal[0][1], pal[0][2]);
        g.uniform3f(uSprite.b, pal[1][0], pal[1][1], pal[1][2]);
        g.uniform3f(uSprite.c, pal[2][0], pal[2][1], pal[2][2]);
        g.bindBuffer(g.ARRAY_BUFFER, instances);
        g.bufferSubData(g.ARRAY_BUFFER, 0, buf.view());
        g.bindVertexArray(vaoSprite);
        g.enable(g.BLEND);
        g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
        g.drawArraysInstanced(g.TRIANGLES, 0, 6, Math.min(buf.count, maxInstances));
      }
      g.bindVertexArray(null);
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost as EventListener);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      g.deleteBuffer(quad);
      g.deleteBuffer(corners);
      g.deleteBuffer(instances);
      g.deleteVertexArray(vaoField);
      g.deleteVertexArray(vaoSprite);
      if (fieldProg) g.deleteProgram(fieldProg);
      if (spriteProg) g.deleteProgram(spriteProg);
      fieldProg = null;
      spriteProg = null;
    },
  };
}

const VERT_FULLSCREEN = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
void main() { gl_Position = vec4(aCorner, 0.0, 1.0); }`;

/**
 * The 2D path. It is a fallback, not a second implementation: the same
 * instances, drawn from ONE pre-rendered sprite with `drawImage`. No
 * `createRadialGradient` in the loop, no `shadowBlur`, no `filter: blur()` —
 * the three things that make a mobile frame budget disappear.
 */
function create2dLayer(
  canvas: HTMLCanvasElement,
  palette: [string, string, string],
  fallback: string,
): SceneLayer {
  const ctx = canvas.getContext("2d");
  let cssW = 1;
  let cssH = 1;
  let dpr = 1;

  // Three tinted sprites, built once, sampled by hue. The gradient is
  // allocated three times in the life of the room instead of N times a frame.
  const SPRITE_PX = 64;
  const sprites: HTMLCanvasElement[] = palette.map((hex) => {
    const c = document.createElement("canvas");
    c.width = SPRITE_PX;
    c.height = SPRITE_PX;
    const s = c.getContext("2d");
    if (s) {
      const grad = s.createRadialGradient(
        SPRITE_PX / 2,
        SPRITE_PX / 2,
        0,
        SPRITE_PX / 2,
        SPRITE_PX / 2,
        SPRITE_PX / 2,
      );
      const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * 255));
      grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
      grad.addColorStop(0.45, `rgba(${r},${g},${b},0.55)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      s.fillStyle = grad;
      s.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
    }
    return c;
  });

  return {
    mode: "2d",
    resize(w, h, tier, c) {
      cssW = Math.max(1, w);
      cssH = Math.max(1, h);
      dpr = resolveDpr(tier, c ?? {});
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    draw(buf, u) {
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = fallback;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.globalCompositeOperation = "lighter";
      const data = buf.data;
      for (let i = 0; i < buf.count; i++) {
        const o = i * INSTANCE_STRIDE;
        const r = data[o + 2] * 1.9;
        const hue = data[o + 4];
        const sprite = sprites[hue < 0.34 ? 0 : hue < 0.67 ? 1 : 2];
        ctx.globalAlpha = Math.min(1, data[o + 7] * (0.55 + 0.45 * data[o + 5]));
        ctx.drawImage(sprite, data[o] - r, data[o + 1] - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      void u;
    },
    dispose() {
      /* nothing retained but the sprites, which the GC takes */
    },
  };
}
