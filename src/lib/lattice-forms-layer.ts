"use client";

/**
 * lattice-forms-layer — every visiting lattice animal, in every form, in one
 * instanced draw.
 *
 * `lattice-forms.ts` writes FORM_STRIDE floats per cell (and per bond between
 * two cells); this uploads them on `createGLStage`'s instanced path and draws
 * the whole population with one `drawArrays*Instanced`. The fragment shader
 * branches on the instance's kind — the same twelve primitives the form atlas
 * classifies every component into, plus the bond — so a star-form cell gets
 * diffraction spikes, a cell-form cell a membrane and nucleus, a quantum-form
 * cell a ripple, all as signed-distance fields. No gradient objects, no blur:
 * the paint law (`npm run test:paint`) holds by construction.
 */

import { FORM_STRIDE } from "@/lib/lattice-forms";
import type { GLProgram, GLStage, InstancedDraw } from "@/lib/webgl/stage";

const VERT = `attribute vec2 a_corner;
attribute vec2 a_pos;
attribute vec4 a_shape;
attribute vec4 a_look;
attribute vec3 a_ca;
attribute vec3 a_cb;
uniform vec2 u_resolution;
varying vec2 vLocal;
varying float vKind;
varying float vPhase;
varying float vAlpha;
varying float vGlow;
varying float vFacets;
varying float vJitter;
varying vec3 vA;
varying vec3 vB;
void main() {
  vec2 local = a_corner * 1.7;
  float c = cos(a_shape.y), s = sin(a_shape.y);
  vec2 px = a_pos + vec2(local.x * c - local.y * s, local.x * s + local.y * c) * a_shape.x;
  vec2 clip = (px / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = local;
  vKind = a_shape.z;
  vPhase = a_shape.w;
  vAlpha = a_look.x;
  vGlow = a_look.y;
  vFacets = a_look.z;
  vJitter = a_look.w;
  vA = a_ca;
  vB = a_cb;
}`;

const FRAG = `precision mediump float;
varying vec2 vLocal;
varying float vKind;
varying float vPhase;
varying float vAlpha;
varying float vGlow;
varying float vFacets;
varying float vJitter;
varying vec3 vA;
varying vec3 vB;
uniform float u_time;
const float TAU = 6.2831853;

float disc(vec2 p, float r, float soft) { return 1.0 - smoothstep(r - soft, r, length(p)); }
float tear(vec2 q) {
  // round end at the bottom, a point at the top (q.y up)
  float k = clamp((q.y + 0.35) / 1.3, 0.0, 1.0);
  return length(vec2(q.x / max(0.08, 1.0 - k * 0.92), (q.y + 0.35) * 0.62 * (1.0 - k * 0.2))) - 0.5;
}

void main() {
  vec2 p = vLocal;
  float r = length(p);
  float a = atan(p.y, p.x);
  float t = u_time;
  float ph = vPhase * TAU;
  float I = 0.0;      // how much is here
  float m = 0.0;      // 0 = rim colour, 1 = core colour
  vec3 col;
  int k = int(vKind + 0.5);

  if (k == 1) {        // star: a hot point, diffraction spikes, a slow twinkle
    float core = exp(-r * r * 16.0);
    float spikes = exp(-abs(p.x) * 20.0) * exp(-abs(p.y) * 1.5) + exp(-abs(p.y) * 20.0) * exp(-abs(p.x) * 1.5);
    float tw = 0.7 + 0.3 * sin(t * 2.7 + ph * 9.0);
    I = core * 1.3 + spikes * 0.55 * tw + exp(-r * r * 2.6) * 0.3 * vGlow;
    m = clamp(core * 1.6, 0.0, 1.0);
    col = mix(mix(vA, vB, 0.55), vec3(1.0), m * 0.6);
  } else if (k == 2) { // spiral: log-spiral arms of dust around a bulge
    float arms = 2.0 + mod(vFacets, 3.0);
    float s = cos(arms * (a - log(r + 0.04) * 2.4 - t * 0.25 - ph));
    float dust = smoothstep(0.15, 1.0, s) * exp(-r * 2.0) * (1.0 - smoothstep(1.0, 1.6, r));
    float bulge = exp(-r * r * 14.0);
    I = dust * 1.1 + bulge;
    m = bulge;
    col = mix(vA, vB, clamp(m + dust * 0.4, 0.0, 1.0));
  } else if (k == 3) { // cell: membrane, cytoplasm, nucleus, two organelles
    float wob = 0.03 * sin(a * 5.0 + t * 1.3 + ph);
    float membrane = 1.0 - smoothstep(0.0, 0.07, abs(r - 0.8 - wob));
    float plasm = (1.0 - smoothstep(0.74, 0.82, r - wob)) * 0.33;
    vec2 nc = 0.2 * vec2(cos(ph + t * 0.2), sin(ph * 1.3 + t * 0.17));
    float nucleus = disc(p - nc, 0.27, 0.05);
    float org = disc(p - vec2(-0.38, 0.22) * (0.8 + 0.2 * sin(t + ph)), 0.08, 0.03) + disc(p - vec2(0.3, -0.36), 0.06, 0.03);
    I = membrane + plasm + nucleus * 0.9 + org * 0.7;
    m = nucleus + org * 0.6;
    col = mix(mix(vA, vB, 0.35), vB, clamp(m, 0.0, 1.0));
    col = mix(col, vB * 1.15, membrane * 0.5);
  } else if (k == 4) { // quantum: an excitation and its outgoing ripple
    float rings = 0.5 + 0.5 * sin(r * 15.0 - t * 3.2 - ph);
    float env = exp(-r * 1.9) * (1.0 - smoothstep(1.2, 1.7, r));
    float core = exp(-r * r * 22.0);
    I = rings * env * 0.85 + core * 1.2;
    m = core;
    col = mix(vA, vB, clamp(rings * 0.6 + core, 0.0, 1.0));
  } else if (k == 5) { // orbit: an inclined ring with its body going round
    vec2 q = vec2(p.x, p.y * 2.0);
    float ring = 1.0 - smoothstep(0.0, 0.07, abs(length(q) - 0.9));
    float th = t * 0.9 + ph;
    vec2 body = vec2(cos(th) * 0.9, sin(th) * 0.45);
    float b = disc(p - body, 0.17, 0.05);
    float centre = disc(p, 0.34, 0.08) + exp(-r * r * 3.0) * 0.3 * vGlow;
    I = ring * 0.7 + b + centre;
    m = clamp(centre, 0.0, 1.0);
    col = mix(vA, vB, m);
    col = mix(col, vec3(1.0), b * 0.35);
  } else if (k == 6) { // flame: a teardrop that flickers upward
    vec2 q = vec2(p.x + sin(t * 7.0 + ph * 5.0 - p.y * 4.0) * 0.07 * (0.6 - p.y), -p.y * 0.9 + 0.1);
    float d = tear(q);
    float body = 1.0 - smoothstep(-0.02, 0.06, d);
    float heart = 1.0 - smoothstep(-0.28, -0.05, d);
    I = body + exp(-max(d, 0.0) * 9.0) * 0.35 * vGlow;
    m = heart;
    col = mix(vA, vB, clamp(body * 0.5 + heart, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.97, 0.85), heart * 0.4);
  } else if (k == 7) { // drop: water held round, a highlight, a refracted rim
    vec2 q = vec2(p.x, p.y * 0.95 + 0.08);
    float d = tear(q);
    float body = 1.0 - smoothstep(-0.02, 0.05, d);
    float rim = 1.0 - smoothstep(0.0, 0.08, abs(d + 0.05));
    float hi = disc(p - vec2(-0.16, 0.12), 0.1, 0.06);
    I = body * 0.55 + rim * 0.6 + hi;
    m = hi;
    col = mix(vA, vB, clamp(rim * 0.7 + body * 0.2, 0.0, 1.0));
    col = mix(col, vec3(1.0), hi * 0.8);
  } else if (k == 8) { // petal: a rose of n petals around a centre
    float n = clamp(vFacets, 3.0, 8.0);
    float rr = 0.3 + 0.6 * pow(abs(cos(a * n * 0.5 + ph + t * 0.1)), 0.7);
    float petals = 1.0 - smoothstep(rr - 0.1, rr, r);
    float centre = disc(p, 0.2, 0.06);
    I = petals * 0.85 + centre;
    m = centre;
    col = mix(mix(vA, vB, r * 0.9), vB, m);
  } else if (k == 9) { // crystal: a hexagon whose facets catch the light
    vec2 q = abs(p);
    float d = max(q.x * 0.866 + q.y * 0.5, q.y) - 0.74;
    float body = 1.0 - smoothstep(0.0, 0.04, d);
    float edge = 1.0 - smoothstep(0.0, 0.05, abs(d));
    float facet = floor((a + 3.14159) / (TAU / 6.0));
    float shade = 0.45 + 0.55 * fract(sin(facet * 12.9898 + ph * 7.0) * 43758.5453);
    float glint = pow(max(0.0, sin(t * 0.9 + facet + ph)), 12.0);
    I = body * (0.35 + 0.45 * shade) + edge * 0.8 + body * glint * 0.4;
    m = shade * body;
    col = mix(vA, vB, clamp(m + edge * 0.4, 0.0, 1.0));
  } else if (k == 10) { // glyph: a set tile with a written mark
    vec2 q = abs(p) - vec2(0.62);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.12;
    float tile = 1.0 - smoothstep(0.0, 0.04, d);
    float edge = 1.0 - smoothstep(0.0, 0.05, abs(d));
    float stroke = (1.0 - smoothstep(0.05, 0.1, abs(p.y + 0.18 * sin(p.x * vFacets + ph)))) * step(abs(p.x), 0.42);
    float dot_ = disc(p - vec2(0.3 * cos(ph), -0.38), 0.07, 0.03);
    I = tile * 0.28 + edge * 0.75 + (stroke + dot_) * tile;
    m = clamp(stroke + dot_, 0.0, 1.0);
    col = mix(vA, vB, clamp(m + edge * 0.3, 0.0, 1.0));
  } else if (k == 11) { // cloud: three soft lobes that drift
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 o = 0.32 * vec2(cos(fi * 2.1 + ph + t * 0.15), sin(fi * 2.1 + ph * 1.3 + t * 0.12));
      s += exp(-dot(p - o, p - o) * 4.2);
    }
    float body = smoothstep(0.3, 0.9, s);
    I = body * 0.8 + exp(-r * r * 1.6) * 0.18 * vGlow;
    m = smoothstep(0.8, 1.6, s);
    col = mix(vA, vB, clamp(m + 0.3, 0.0, 1.0));
  } else if (k == 12) { // bond: the bridge two neighbouring cells share
    vec2 q = vec2(max(abs(p.x) - 0.7, 0.0), p.y);
    float d = length(q);
    I = (1.0 - smoothstep(0.06, 0.2, d)) * 0.8;
    m = 0.4;
    col = mix(vA, vB, 0.4);
  } else {             // orb: a disc with its corona
    float core = disc(p, 0.78, 0.18);
    I = core + exp(-r * r * 2.4) * 0.45 * vGlow;
    m = core;
    col = mix(vA, vB, m * 0.8);
  }
  float alpha = clamp(I, 0.0, 1.0) * vAlpha;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col * alpha, alpha);
}`;

const CORNERS = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

export type FormsLayer = {
  /** Draw `count` instances from a FORM_STRIDE-packed buffer. */
  draw(data: Float32Array, count: number, time: number): void;
  dispose(): void;
};

export function createFormsLayer(stage: GLStage): FormsLayer | null {
  const prog: GLProgram | null = stage.program(VERT, FRAG);
  if (!prog) return null;
  const inst: InstancedDraw = stage.instanced(prog);
  const gl = stage.gl;
  let cap = 0;
  let pos = new Float32Array(0), shape = pos, look = pos, ca = pos, cb = pos;
  const ensure = (n: number) => {
    if (n <= cap) return;
    cap = Math.max(256, n);
    pos = new Float32Array(cap * 2);
    shape = new Float32Array(cap * 4);
    look = new Float32Array(cap * 4);
    ca = new Float32Array(cap * 3);
    cb = new Float32Array(cap * 3);
  };
  return {
    draw(data, count, time) {
      if (count <= 0 || stage.contextLost()) return;
      ensure(count);
      for (let i = 0; i < count; i++) {
        const o = i * FORM_STRIDE;
        pos[i * 2] = data[o]; pos[i * 2 + 1] = data[o + 1];
        shape[i * 4] = data[o + 2]; shape[i * 4 + 1] = data[o + 3]; shape[i * 4 + 2] = data[o + 4]; shape[i * 4 + 3] = data[o + 5];
        look[i * 4] = data[o + 6]; look[i * 4 + 1] = data[o + 7]; look[i * 4 + 2] = data[o + 14]; look[i * 4 + 3] = data[o + 15];
        ca[i * 3] = data[o + 8]; ca[i * 3 + 1] = data[o + 9]; ca[i * 3 + 2] = data[o + 10];
        cb[i * 3] = data[o + 11]; cb[i * 3 + 1] = data[o + 12]; cb[i * 3 + 2] = data[o + 13];
      }
      prog.use();
      prog.setVec2("u_resolution", stage.size.width, stage.size.height);
      prog.setFloat("u_time", time);
      inst.attribute("a_corner", CORNERS, 2, 0);
      inst.attribute("a_pos", pos.subarray(0, count * 2), 2, 1);
      inst.attribute("a_shape", shape.subarray(0, count * 4), 4, 1);
      inst.attribute("a_look", look.subarray(0, count * 4), 4, 1);
      inst.attribute("a_ca", ca.subarray(0, count * 3), 3, 1);
      inst.attribute("a_cb", cb.subarray(0, count * 3), 3, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      inst.draw(gl.TRIANGLES, 6, count);
      inst.reset();
      gl.disable(gl.BLEND);
    },
    dispose() {
      inst.dispose();
    },
  };
}
