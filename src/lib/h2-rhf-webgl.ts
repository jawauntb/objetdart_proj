/**
 * The GPU seam for the bounded H₂ RHF instrument.
 *
 * This module is deliberately split in two. `writeH2RHFFieldState` is a pure,
 * caller-owned packing seam: the authority and the presentation projection
 * remain in TypeScript, while this fixed record is the only thing the shader
 * sees. `createH2RHFWebGLField` is the thin fullscreen pass that consumes that
 * record. It owns no clock and starts no animation loop; the room's one RAF
 * calls `render()` after updating `state`.
 *
 * The stage and vertex shader are injected from `src/lib/webgl/stage.ts`.
 * Keeping that dependency at the integration edge makes the pure state seam
 * runnable in Node's strip-types test harness while the browser still uses the
 * shared `createGLStage` / `FULLSCREEN_VERT_UNIT` path.
 */

import type {
  GLProgram,
  GLStage,
  GLStageOptions,
  FullscreenQuad,
} from "./webgl/stage.ts";
import {
  H2_RHF_PROJECTION_LENGTH,
  type H2RHFProjectionTarget,
} from "./h2-rhf-presentation.ts";
import type { H2RHFDisposition } from "./h2-rhf.ts";

/** The eight presentation lanes copied from h2-rhf-presentation. */
export const H2_RHF_WEBGL_PROJECTION_LENGTH = H2_RHF_PROJECTION_LENGTH;

/**
 * The fixed uniform record shared by the room and the shader.
 *
 * [centerX, centerY, radiusPx, axisX, axisY, separationPx,
 *  density0, density1, density2, density3, residual, disposition,
 *  breath, time, active, tension, footprint, phase, fieldStrength]
 */
export const H2_RHF_FIELD_STATE_COMPONENTS = Object.freeze({
  centerX: 0,
  centerY: 1,
  radiusPx: 2,
  axisX: 3,
  axisY: 4,
  separationPx: 5,
  density0: 6,
  density1: 7,
  density2: 8,
  density3: 9,
  residual: 10,
  disposition: 11,
  breath: 12,
  time: 13,
  active: 14,
  tension: 15,
  footprint: 16,
  phase: 17,
  fieldStrength: 18,
  length: 19,
} as const);

export const H2_RHF_FIELD_STATE_LENGTH = H2_RHF_FIELD_STATE_COMPONENTS.length;

/** Stable numeric status values; the shader never receives a string. */
export const H2_RHF_DISPOSITION_CODES: Readonly<Record<H2RHFDisposition, number>> = Object.freeze({
  idle: 0,
  correcting: 1,
  promoted: 2,
  cancelled: 3,
  "outside-envelope": 4,
  "max-iterations": 5,
  "reference-unverified": 6,
  "numerical-failure": 7,
});

export type H2RHFWebGLStageDependencies = {
  /** Pass the shared `createGLStage` function here. */
  readonly createGLStage: (canvas: HTMLCanvasElement, options?: GLStageOptions) => GLStage | null;
  /** Pass the shared `FULLSCREEN_VERT_UNIT` source here. */
  readonly FULLSCREEN_VERT_UNIT: string;
};

export type H2RHFWebGLFieldOptions = {
  readonly wrap?: HTMLElement | null;
  readonly label?: string;
  readonly quality?: GLStageOptions["quality"];
  readonly reducedMotion?: boolean;
  readonly embedded?: boolean;
  readonly maxDpr?: number;
  readonly renderScale?: number;
  readonly maxPixels?: number;
  readonly onContextLost?: () => void;
  readonly onContextRestored?: () => void;
};

export type H2RHFWebGLField = {
  /** Reusable fixed record. Mutate this in the room's existing RAF. */
  readonly state: Float32Array;
  /** Explicit resize hook for a room-owned ResizeObserver or layout change. */
  resize: () => boolean;
  /** Draw one transparent fullscreen pass; this never schedules a frame. */
  render: () => boolean;
  /** Release the stage, program, quad, observer, and context listeners. */
  dispose: () => void;
  /** Exposes the stage's loss state without exposing scientific state. */
  contextLost: () => boolean;
};

const ZERO = 0;
const ONE = 1;
const AXIS_EPSILON = 1e-8;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function clamp01(value: number): number {
  if (!finite(value)) return ZERO;
  return Math.max(ZERO, Math.min(ONE, value));
}

function projectionIsFinite(projection: Float32Array): boolean {
  if (projection.length < H2_RHF_WEBGL_PROJECTION_LENGTH) return false;
  for (let index = 0; index < H2_RHF_WEBGL_PROJECTION_LENGTH; index += 1) {
    if (!finite(projection[index])) return false;
  }
  return true;
}

/**
 * Pack geometry, the authoritative density lanes, and presentation clocks into
 * caller-owned storage. The first four density lanes are copied verbatim into
 * Float32 storage; no field map, interpolation, or solver operation happens
 * here or in the shader.
 */
function packH2RHFFieldState(
  out: Float32Array,
  centerX: number,
  centerY: number,
  radiusPx: number,
  axisX: number,
  axisY: number,
  separationPx: number,
  projection: Float32Array,
  residual: number | null,
  disposition: H2RHFDisposition,
  breath: number,
  time: number,
  active: boolean,
): boolean {
  if (!(out instanceof Float32Array) || out.length < H2_RHF_FIELD_STATE_LENGTH) {
    throw new TypeError("H2 RHF WebGL state requires Float32Array(19 or larger)");
  }
  out.fill(ZERO);
  if (!(projection instanceof Float32Array) || !projectionIsFinite(projection)) return false;
  if (!finite(centerX) || !finite(centerY) || !finite(radiusPx) || radiusPx <= ZERO
    || !finite(separationPx) || separationPx < ZERO) return false;
  if (!Object.prototype.hasOwnProperty.call(H2_RHF_DISPOSITION_CODES, disposition)) return false;
  if (residual !== null && !finite(residual)) return false;
  if (!finite(breath) || !finite(time) || typeof active !== "boolean") return false;

  if (!finite(axisX) || !finite(axisY)) return false;
  const axisLength = Math.hypot(axisX, axisY);
  if (!(axisLength > AXIS_EPSILON)) return false;

  out[H2_RHF_FIELD_STATE_COMPONENTS.centerX] = centerX;
  out[H2_RHF_FIELD_STATE_COMPONENTS.centerY] = centerY;
  out[H2_RHF_FIELD_STATE_COMPONENTS.radiusPx] = radiusPx;
  out[H2_RHF_FIELD_STATE_COMPONENTS.axisX] = axisX / axisLength;
  out[H2_RHF_FIELD_STATE_COMPONENTS.axisY] = axisY / axisLength;
  out[H2_RHF_FIELD_STATE_COMPONENTS.separationPx] = separationPx;
  out[H2_RHF_FIELD_STATE_COMPONENTS.density0] = projection[0];
  out[H2_RHF_FIELD_STATE_COMPONENTS.density1] = projection[1];
  out[H2_RHF_FIELD_STATE_COMPONENTS.density2] = projection[2];
  out[H2_RHF_FIELD_STATE_COMPONENTS.density3] = projection[3];
  out[H2_RHF_FIELD_STATE_COMPONENTS.residual] = residual === null ? ZERO : clamp01(residual);
  out[H2_RHF_FIELD_STATE_COMPONENTS.disposition] = H2_RHF_DISPOSITION_CODES[disposition];
  out[H2_RHF_FIELD_STATE_COMPONENTS.breath] = clamp01(breath);
  out[H2_RHF_FIELD_STATE_COMPONENTS.time] = time;
  out[H2_RHF_FIELD_STATE_COMPONENTS.active] = active ? ONE : ZERO;
  out[H2_RHF_FIELD_STATE_COMPONENTS.tension] = clamp01(projection[4]);
  out[H2_RHF_FIELD_STATE_COMPONENTS.footprint] = clamp01(projection[5]);
  out[H2_RHF_FIELD_STATE_COMPONENTS.phase] = clamp01(projection[6]);
  out[H2_RHF_FIELD_STATE_COMPONENTS.fieldStrength] = clamp01(projection[7]);
  return true;
}

/**
 * Allocation-free primitive form for a hot RAF. Prefer this when geometry is
 * computed into scalar locals; the object-shaped overload below is convenient
 * for gesture transitions and existing molecule records.
 */
export function writeH2RHFFieldStateValues(
  out: Float32Array,
  centerX: number,
  centerY: number,
  radiusPx: number,
  axisX: number,
  axisY: number,
  separationPx: number,
  projection: Float32Array,
  residual: number | null,
  disposition: H2RHFDisposition,
  breath: number,
  time: number,
  active: boolean,
): boolean {
  return packH2RHFFieldState(
    out,
    centerX,
    centerY,
    radiusPx,
    axisX,
    axisY,
    separationPx,
    projection,
    residual,
    disposition,
    breath,
    time,
    active,
  );
}

/** Object-shaped convenience form for non-hot transitions. */
export function writeH2RHFFieldState(
  out: Float32Array,
  target: Pick<H2RHFProjectionTarget, "centerX" | "centerY" | "radiusPx" | "separationPx"> & {
    readonly axisX?: number;
    readonly axisY?: number;
    readonly axis?: readonly [number, number];
  },
  projection: Float32Array,
  residual: number | null,
  disposition: H2RHFDisposition,
  breath: number,
  time: number,
  active: boolean,
): boolean {
  if (!target) return packH2RHFFieldState(out, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, projection, residual, disposition, breath, time, active);
  return packH2RHFFieldState(
    out,
    target.centerX,
    target.centerY,
    target.radiusPx,
    target.axisX ?? target.axis?.[0] ?? ONE,
    target.axisY ?? target.axis?.[1] ?? ZERO,
    target.separationPx,
    projection,
    residual,
    disposition,
    breath,
    time,
    active,
  );
}

/** Update only the room clock lanes, retaining the scientific projection. */
export function updateH2RHFFieldClock(
  state: Float32Array,
  breath: number,
  time: number,
  active: boolean,
): boolean {
  if (!(state instanceof Float32Array) || state.length < H2_RHF_FIELD_STATE_LENGTH) throw new TypeError("H2 RHF WebGL state requires Float32Array(19 or larger)");
  if (!finite(breath) || !finite(time) || typeof active !== "boolean") return false;
  state[H2_RHF_FIELD_STATE_COMPONENTS.breath] = clamp01(breath);
  state[H2_RHF_FIELD_STATE_COMPONENTS.time] = time;
  state[H2_RHF_FIELD_STATE_COMPONENTS.active] = active ? ONE : ZERO;
  return true;
}

/**
 * One transparent, pointer-inert field pass. The caller supplies the shared
 * stage factory and vertex source so this module has no browser-only import in
 * its pure packing seam. `render()` is intentionally a plain method, not an
 * animation primitive.
 */
export function createH2RHFWebGLField(
  canvas: HTMLCanvasElement,
  dependencies: H2RHFWebGLStageDependencies,
  options: H2RHFWebGLFieldOptions = {},
): H2RHFWebGLField | null {
  if (!canvas || !dependencies || typeof dependencies.createGLStage !== "function" || typeof dependencies.FULLSCREEN_VERT_UNIT !== "string") {
    throw new TypeError("H2 RHF WebGL field requires the shared createGLStage and FULLSCREEN_VERT_UNIT");
  }

  // The 2D interaction/assistive layer stays above this canvas. The GPU pass
  // is decorative material only, so it must never steal a gesture or a11y
  // focus from the room's playable surface.
  canvas.style.pointerEvents = "none";
  canvas.setAttribute("aria-hidden", "true");

  let disposed = false;
  let stage: GLStage | null = null;
  let program: GLProgram | null = null;
  let quad: FullscreenQuad | null = null;
  let uniforms: Readonly<{
    resolution: WebGLUniformLocation | null;
    center: WebGLUniformLocation | null;
    radius: WebGLUniformLocation | null;
    axis: WebGLUniformLocation | null;
    separation: WebGLUniformLocation | null;
    density: WebGLUniformLocation | null;
    residual: WebGLUniformLocation | null;
    disposition: WebGLUniformLocation | null;
    breath: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    active: WebGLUniformLocation | null;
    tension: WebGLUniformLocation | null;
    footprint: WebGLUniformLocation | null;
    phase: WebGLUniformLocation | null;
    fieldStrength: WebGLUniformLocation | null;
  }> | null = null;

  const state = new Float32Array(H2_RHF_FIELD_STATE_LENGTH);
  const rebuild = () => {
    program = null;
    quad = null;
    uniforms = null;
    if (disposed || stage === null || stage.contextLost()) return;
    program = stage.program(dependencies.FULLSCREEN_VERT_UNIT, H2_RHF_FIELD_FRAGMENT_SHADER);
    quad = program ? stage.fullscreenQuad(program, "unit") : null;
    uniforms = program ? Object.freeze({
      resolution: program.location("u_res"),
      center: program.location("u_center"),
      radius: program.location("u_radius"),
      axis: program.location("u_axis"),
      separation: program.location("u_separation"),
      density: program.location("u_density"),
      residual: program.location("u_residual"),
      disposition: program.location("u_disposition"),
      breath: program.location("u_breath"),
      time: program.location("u_time"),
      active: program.location("u_active"),
      tension: program.location("u_tension"),
      footprint: program.location("u_footprint"),
      phase: program.location("u_phase"),
      fieldStrength: program.location("u_fieldStrength"),
    }) : null;
    const gl = stage.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(ZERO, ZERO, ZERO, ZERO);
  };

  stage = dependencies.createGLStage(canvas, {
    wrap: options.wrap,
    label: options.label ?? "h2-rhf",
    quality: options.quality,
    reducedMotion: options.reducedMotion,
    embedded: options.embedded,
    maxDpr: options.maxDpr,
    renderScale: options.renderScale,
    maxPixels: options.maxPixels,
    contextAttributes: {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
    },
    onContextLost: () => {
      program = null;
      quad = null;
      uniforms = null;
      options.onContextLost?.();
    },
    onContextRestored: () => {
      rebuild();
      options.onContextRestored?.();
    },
  });
  if (!stage) return null;
  rebuild();

  const resize = (): boolean => {
    if (disposed || stage === null) return false;
    const size = stage.measure();
    stage.gl.viewport(ZERO, ZERO, size.pixelWidth, size.pixelHeight);
    return true;
  };

  const render = (): boolean => {
    if (disposed || stage === null || program === null || quad === null || uniforms === null || stage.contextLost()) return false;
    const gl = stage.gl;
    const size = stage.size;
    gl.viewport(ZERO, ZERO, size.pixelWidth, size.pixelHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);
    program.use();
    // Target geometry is measured in CSS pixels. Keep the shader in that
    // coordinate system while the viewport uses drawing-buffer pixels, so a
    // DPR change cannot move or shrink the field relative to the 2D bodies.
    gl.uniform2f(uniforms.resolution, size.width, size.height);
    gl.uniform2f(
      uniforms.center,
      state[H2_RHF_FIELD_STATE_COMPONENTS.centerX],
      state[H2_RHF_FIELD_STATE_COMPONENTS.centerY],
    );
    gl.uniform1f(uniforms.radius, state[H2_RHF_FIELD_STATE_COMPONENTS.radiusPx]);
    gl.uniform2f(
      uniforms.axis,
      state[H2_RHF_FIELD_STATE_COMPONENTS.axisX],
      state[H2_RHF_FIELD_STATE_COMPONENTS.axisY],
    );
    gl.uniform1f(uniforms.separation, state[H2_RHF_FIELD_STATE_COMPONENTS.separationPx]);
    gl.uniform4f(
      uniforms.density,
      state[H2_RHF_FIELD_STATE_COMPONENTS.density0],
      state[H2_RHF_FIELD_STATE_COMPONENTS.density1],
      state[H2_RHF_FIELD_STATE_COMPONENTS.density2],
      state[H2_RHF_FIELD_STATE_COMPONENTS.density3],
    );
    gl.uniform1f(uniforms.residual, state[H2_RHF_FIELD_STATE_COMPONENTS.residual]);
    gl.uniform1f(uniforms.disposition, state[H2_RHF_FIELD_STATE_COMPONENTS.disposition]);
    gl.uniform1f(uniforms.breath, state[H2_RHF_FIELD_STATE_COMPONENTS.breath]);
    gl.uniform1f(uniforms.time, state[H2_RHF_FIELD_STATE_COMPONENTS.time]);
    gl.uniform1f(uniforms.active, state[H2_RHF_FIELD_STATE_COMPONENTS.active]);
    gl.uniform1f(uniforms.tension, state[H2_RHF_FIELD_STATE_COMPONENTS.tension]);
    gl.uniform1f(uniforms.footprint, state[H2_RHF_FIELD_STATE_COMPONENTS.footprint]);
    gl.uniform1f(uniforms.phase, state[H2_RHF_FIELD_STATE_COMPONENTS.phase]);
    gl.uniform1f(uniforms.fieldStrength, state[H2_RHF_FIELD_STATE_COMPONENTS.fieldStrength]);
    quad.draw();
    return true;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    quad?.dispose();
    quad = null;
    program = null;
    uniforms = null;
    stage?.dispose();
    stage = null;
  };

  return {
    state,
    resize,
    render,
    dispose,
    contextLost: () => stage?.contextLost() ?? false,
  };
}

/**
 * The scientific model stops at the projection record. This fragment shader
 * only draws a bounded visual field around the supplied geometry: two soft AO
 * lobes, a bond-shaped bridge, and a low-frequency breath. It never branches
 * on a cassette node, solves a map, or invents density values.
 */
export const H2_RHF_FIELD_FRAGMENT_SHADER = `precision highp float;
varying vec2 vUv;

uniform vec2 u_res;
uniform vec2 u_center;
uniform float u_radius;
uniform vec2 u_axis;
uniform float u_separation;
uniform vec4 u_density;
uniform float u_residual;
uniform float u_disposition;
uniform float u_breath;
uniform float u_time;
uniform float u_active;
uniform float u_tension;
uniform float u_footprint;
uniform float u_phase;
uniform float u_fieldStrength;

float gaussian(float x, float width) {
  return exp(-(x * x) / max(width * width, 0.0001));
}

void main() {
  // WebGL fragments rise from the lower-left; molecule geometry is measured
  // in CSS/canvas coordinates from the upper-left. Flip once at the seam so
  // the electronic field stays attached to its stable body.
  vec2 pixel = vec2(vUv.x * u_res.x, (1.0 - vUv.y) * u_res.y);
  vec2 delta = pixel - u_center;
  vec2 axis = u_axis;
  float axisLength = length(axis);
  if (axisLength < 0.0001) axis = vec2(1.0, 0.0);
  else axis /= axisLength;
  vec2 normal = vec2(-axis.y, axis.x);
  float along = dot(delta, axis);
  float across = dot(delta, normal);
  float radius = max(u_radius, 1.0);
  float halfSeparation = max(u_separation, 0.0) * 0.5;

  float left = gaussian(along + halfSeparation, radius * 0.82) * gaussian(across, radius * 0.82);
  float right = gaussian(along - halfSeparation, radius * 0.82) * gaussian(across, radius * 0.82);
  float bridge = gaussian(along, max(halfSeparation + radius * 0.2, radius * 0.32))
    * gaussian(across, max(radius * 0.17, 1.0));
  float halo = gaussian(length(delta), radius * (1.25 + u_footprint * 0.65));
  float leftDensity = clamp(abs(u_density.x), 0.0, 1.5);
  float rightDensity = clamp(abs(u_density.w), 0.0, 1.5);
  float bondDensity = clamp(0.5 * (abs(u_density.y) + abs(u_density.z)), 0.0, 1.5);
  float densitySignal = leftDensity + rightDensity + 2.0 * bondDensity;
  float densityWave = 0.5 + 0.5 * sin(u_time * 0.35 + u_phase * 6.2831853 + densitySignal * 0.7);
  float breath = mix(0.82, 1.08, clamp(u_breath, 0.0, 1.0));
  float correcting = 1.0 - step(0.5, abs(u_disposition - 1.0));
  float refusal = step(3.5, u_disposition);
  vec3 settledColour = vec3(0.55, 0.78, 0.94);
  vec3 correctingColour = vec3(0.95, 0.71, 0.42);
  vec3 refusalColour = vec3(0.78, 0.44, 0.46);
  vec3 colour = mix(settledColour, correctingColour, correcting * (1.0 - refusal));
  colour = mix(colour, refusalColour, refusal);
  float material = (left * leftDensity + right * rightDensity) * (0.62 + u_fieldStrength * 0.7)
    + bridge * bondDensity * (0.24 + u_tension * 0.56)
    + halo * 0.08 * densityWave;
  float alpha = clamp(material * breath * clamp(u_active, 0.0, 1.0), 0.0, 0.92);
  vec3 premultiplied = colour * (0.72 + u_residual * 0.22) * alpha;
  gl_FragColor = vec4(premultiplied, alpha);
}`;
