"use client";

/**
 * scene/population-layer — a whole population in one draw call.
 *
 * The bug this ends: every object in this codebase drew *itself*. A
 * `createRadialGradient` inside `for (const a of atoms)`, a `shadowBlur` per
 * petal, a fresh gradient per nucleon halo, ~44 gradient allocations a frame
 * on /stars. Each is a full paint-server rebuild on the main thread, and
 * mobile pays twice — once in allocation, once in fill.
 *
 * Here an object writes eight numbers (`scene/instances.ts`) and the whole
 * population arrives as instance attributes on `createGLStage`'s instanced
 * path: one `drawArraysInstanced`, an SDF disc with an additive corona for the
 * shape a radial gradient was being rebuilt every frame to fake.
 *
 * The stage owns the context, the DPR, the clocks and the disposal. This owns
 * only the sprite program and the upload — deliberately thin, so it composes
 * with whatever a room draws behind it.
 */

import { INSTANCE_STRIDE, type InstanceBuffer } from "@/lib/scene/instances";
import type { GLProgram, GLStage, InstancedDraw } from "@/lib/webgl/stage";

/**
 * WebGL1 dialect on purpose — the stage reaches WebGL2 when it can and falls
 * back through ANGLE_instanced_arrays when it cannot, and the population must
 * draw either way.
 */
const SPRITE_VERT = `attribute vec2 a_corner;
attribute vec2 a_pos;
attribute float a_r;
attribute float a_rot;
attribute float a_hue;
attribute float a_glow;
attribute float a_phase;
attribute float a_alpha;
uniform vec2 u_resolution;
varying vec2 vLocal;
varying float vHue;
varying float vGlow;
varying float vPhase;
varying float vAlpha;
void main() {
  // The corona wants room past the disc, so the quad is oversized and the
  // additive falloff is never clipped at the sprite edge.
  vec2 local = a_corner * 1.9;
  float c = cos(a_rot), s = sin(a_rot);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 px = a_pos + rotated * a_r;
  vec2 clip = (px / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = local;
  vHue = a_hue;
  vGlow = a_glow;
  vPhase = a_phase;
  vAlpha = a_alpha;
}`;

const SPRITE_FRAG = `precision mediump float;
varying vec2 vLocal;
varying float vHue;
varying float vGlow;
varying float vPhase;
varying float vAlpha;
uniform vec3 u_palA;
uniform vec3 u_palB;
uniform vec3 u_palC;
vec3 palette(float h) {
  h = clamp(h, 0.0, 1.0);
  return h < 0.5 ? mix(u_palA, u_palB, h * 2.0) : mix(u_palB, u_palC, (h - 0.5) * 2.0);
}
void main() {
  float d = length(vLocal);
  float core = 1.0 - smoothstep(0.72, 1.0, d);
  float corona = exp(-d * d * 2.6) * vGlow;
  float a = clamp(core + corona, 0.0, 1.0) * vAlpha;
  if (a <= 0.003) discard;
  vec3 c = palette(vHue) * (0.75 + 0.45 * vPhase);
  gl_FragColor = vec4(c * a, a);
}`;

/** Two triangles, in the sprite's own local space. */
const CORNERS = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

const ATTRS: { name: string; offset: number }[] = [
  { name: "a_r", offset: 2 },
  { name: "a_rot", offset: 3 },
  { name: "a_hue", offset: 4 },
  { name: "a_glow", offset: 5 },
  { name: "a_phase", offset: 6 },
  { name: "a_alpha", offset: 7 },
];

export type PopulationLayer = {
  /** Draw the buffer's written region. Additive over whatever is behind it. */
  draw(buf: InstanceBuffer): void;
  dispose(): void;
};

export type PopulationLayerOptions = {
  /** Three anchor colours the instance `hue` (0..1) is read against. */
  palette?: [string, string, string];
};

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Build the population pass on an existing stage. Returns null when the sprite
 * program will not compile — the caller keeps its own fallback, because what a
 * room looks like without a GPU is a design decision, not a library one.
 */
export function createPopulationLayer(
  stage: GLStage,
  options: PopulationLayerOptions = {},
): PopulationLayer | null {
  const prog: GLProgram | null = stage.program(SPRITE_VERT, SPRITE_FRAG);
  if (!prog) return null;
  const draw: InstancedDraw = stage.instanced(prog);
  const gl = stage.gl;
  const pal = (options.palette ?? ["#2c4a5c", "#c8732a", "#f3d77a"]).map(hexToRgb);

  // Per-attribute scratch, allocated once at the buffer's capacity. The
  // stride-slicing happens here rather than in the RAF loop's own arithmetic.
  let scratch: Float32Array[] = [];
  let positions = new Float32Array(0);
  let capacity = 0;

  const ensure = (count: number) => {
    if (count <= capacity) return;
    capacity = Math.max(64, count);
    positions = new Float32Array(capacity * 2);
    scratch = ATTRS.map(() => new Float32Array(capacity));
  };

  return {
    draw(buf) {
      if (buf.count <= 0 || stage.contextLost()) return;
      ensure(buf.count);
      const data = buf.data;
      for (let i = 0; i < buf.count; i++) {
        const o = i * INSTANCE_STRIDE;
        positions[i * 2] = data[o];
        positions[i * 2 + 1] = data[o + 1];
        for (let a = 0; a < ATTRS.length; a++) scratch[a][i] = data[o + ATTRS[a].offset];
      }
      prog.use();
      prog.setVec2(["u_resolution", "uRes", "resolution"], stage.size.width, stage.size.height);
      prog.setVec3("u_palA", pal[0][0], pal[0][1], pal[0][2]);
      prog.setVec3("u_palB", pal[1][0], pal[1][1], pal[1][2]);
      prog.setVec3("u_palC", pal[2][0], pal[2][1], pal[2][2]);
      draw.attribute("a_corner", CORNERS, 2, 0);
      draw.attribute("a_pos", positions.subarray(0, buf.count * 2), 2, 1);
      for (let a = 0; a < ATTRS.length; a++) {
        draw.attribute(ATTRS[a].name, scratch[a].subarray(0, buf.count), 1, 1);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      draw.draw(gl.TRIANGLES, 6, buf.count);
      draw.reset();
      gl.disable(gl.BLEND);
    },
    dispose() {
      draw.dispose();
    },
  };
}
