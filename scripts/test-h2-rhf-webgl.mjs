#!/usr/bin/env node
/**
 * Focused contract tests for the H₂ RHF WebGL seam.
 *
 * These tests stay GPU-free: the browser owns context creation and one RAF,
 * while this suite pins the fixed state record and the source-level lifecycle
 * invariants that a headless Node process can falsify.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { H2_RHF_DISPOSITION_CODES,
  H2_RHF_FIELD_STATE_COMPONENTS,
  H2_RHF_FIELD_STATE_LENGTH,
  H2_RHF_WEBGL_PROJECTION_LENGTH,
  H2_RHF_FIELD_FRAGMENT_SHADER,
  updateH2RHFFieldClock,
  writeH2RHFFieldState,
  writeH2RHFFieldStateValues,
} from "../src/lib/h2-rhf-webgl.ts";

const source = await readFile(new URL("../src/lib/h2-rhf-webgl.ts", import.meta.url), "utf8");

// The fixed record is large enough for all geometry, density and clock lanes,
// and the constants are the only index authority.
assert.equal(H2_RHF_FIELD_STATE_LENGTH, 19, "the field record has exactly 19 lanes");
assert.equal(H2_RHF_FIELD_STATE_COMPONENTS.length, 19, "the length sentinel agrees with the record");
assert.equal(H2_RHF_WEBGL_PROJECTION_LENGTH, 8, "the field consumes the eight presentation lanes");
assert.equal(Object.keys(H2_RHF_DISPOSITION_CODES).length, 8, "every H₂ disposition has a numeric shader code");

// Scientific density lanes are copied into the typed record; geometry is
// normalized once in JS, so the shader does not perform model work.
{
  const projection = new Float32Array([0.81, -0.22, -0.22, 0.34, 0.7, 0.5, 0.25, 0.9]);
  const state = new Float32Array(H2_RHF_FIELD_STATE_LENGTH);
  const ok = writeH2RHFFieldState(
    state,
    { centerX: 137, centerY: 211, radiusPx: 18, separationPx: 34, axis: [3, 4] },
    projection,
    0.31,
    "correcting",
    0.75,
    12.5,
    true,
  );
  assert.equal(ok, true, "a finite H₂ field record packs successfully");
  assert.equal(state[H2_RHF_FIELD_STATE_COMPONENTS.centerX], 137, "center x is retained in CSS pixels");
  assert.equal(state[H2_RHF_FIELD_STATE_COMPONENTS.centerY], 211, "center y is retained in CSS pixels");
  assert.equal(state[H2_RHF_FIELD_STATE_COMPONENTS.radiusPx], 18, "radius is retained in CSS pixels");
  assert.ok(Math.abs(state[H2_RHF_FIELD_STATE_COMPONENTS.axisX] - 0.6) < 1e-6, "axis x is normalized once at the seam");
  assert.ok(Math.abs(state[H2_RHF_FIELD_STATE_COMPONENTS.axisY] - 0.8) < 1e-6, "axis y is normalized once at the seam");
  for (let index = 0; index < 4; index += 1) {
    assert.equal(state[H2_RHF_FIELD_STATE_COMPONENTS.density0 + index], projection[index], `density lane ${index} is copied verbatim`);
  }
  assert.equal(state[H2_RHF_FIELD_STATE_COMPONENTS.disposition], H2_RHF_DISPOSITION_CODES.correcting, "disposition is a stable numeric presentation code");
  assert.equal(state[H2_RHF_FIELD_STATE_COMPONENTS.active], 1, "active state reaches the fixed record");

  const hotState = new Float32Array(H2_RHF_FIELD_STATE_LENGTH);
  assert.equal(writeH2RHFFieldStateValues(hotState, 137, 211, 18, 3, 4, 34, projection, 0.31, "correcting", 0.75, 12.5, true), true, "the scalar hot-path packer avoids a geometry object");
  assert.deepEqual(Array.from(hotState), Array.from(state), "scalar and object-shaped packers agree");
}

// Invalid evidence is fail-closed and clears stale typed state rather than
// leaving the last molecule's density visible under a new target.
{
  const state = new Float32Array(H2_RHF_FIELD_STATE_LENGTH).fill(9);
  const invalid = writeH2RHFFieldState(
    state,
    { centerX: 0, centerY: 0, radiusPx: 5, separationPx: 1 },
    new Float32Array([1, Number.NaN, 3, 4, 0, 0, 0, 0]),
    null,
    "idle",
    0.5,
    1,
    false,
  );
  assert.equal(invalid, false, "non-finite projection is rejected");
  assert.deepEqual(Array.from(state), new Array(H2_RHF_FIELD_STATE_LENGTH).fill(0), "failed packing clears stale field state");
}

// Clock updates mutate only the reusable record: no density rewrite or new
// array is needed on the room's existing RAF.
{
  const state = new Float32Array(H2_RHF_FIELD_STATE_LENGTH);
  state[H2_RHF_FIELD_STATE_COMPONENTS.density0] = 0.8;
  assert.equal(updateH2RHFFieldClock(state, 0.25, 44, false), true, "finite clock updates are accepted");
  assert.equal(state[H2_RHF_FIELD_STATE_COMPONENTS.breath], 0.25, "breath is updated in place");
  assert.equal(state[H2_RHF_FIELD_STATE_COMPONENTS.time], 44, "time is updated in place");
  assert.equal(state[H2_RHF_FIELD_STATE_COMPONENTS.active], 0, "inactive state is updated in place");
  assert.ok(Math.abs(state[H2_RHF_FIELD_STATE_COMPONENTS.density0] - 0.8) < 1e-6, "authoritative density survives a clock update");
}

// Source-level lifecycle laws: the field uses the shared stage/quad, is
// pointer-inert, and cannot silently grow a second timing loop or a forbidden
// per-frame canvas paint path.
assert.match(source, /createGLStage/, "the integration seam names the shared createGLStage factory");
assert.match(source, /FULLSCREEN_VERT_UNIT/, "the integration seam uses the shared unit-UV vertex source");
assert.match(source, /fullscreenQuad\(/, "the field is one fullscreen quad");
assert.match(source, /onContextLost/, "context loss clears stale program state");
assert.match(source, /onContextRestored/, "context restore rebuilds the program and quad");
assert.match(source, /pointerEvents\s*=\s*"none"/, "the GPU canvas is pointer-inert");
assert.match(source, /aria-hidden/, "the GPU canvas is hidden from assistive navigation");
assert.match(source, /resize\s*:\s*\(\)\s*=>\s*boolean/, "resize is explicit");
assert.match(source, /render\s*:\s*\(\)\s*=>\s*boolean/, "render is explicit and caller-driven");
assert.match(source, /dispose\s*:\s*\(\)\s*=>\s*void/, "dispose is explicit");
assert.match(source, /uniform2f\(uniforms\.resolution, size\.width, size\.height\)/, "shader geometry stays in CSS pixels when DPR changes");
assert.doesNotMatch(source, /program\.set(?:Float|Vec[234])\("u_/, "the hot render path does not allocate temporary uniform-name arrays");
assert.doesNotMatch(source, /requestAnimationFrame|setInterval|setTimeout|Math\.random\s*\(/, "the field does not own a timing loop or entropy");
assert.doesNotMatch(source, /createRadialGradient|createLinearGradient|shadowBlur|ctx\.filter/, "the field does not fall back to per-frame 2D paint");

for (const uniform of [
  "u_center", "u_radius", "u_axis", "u_separation", "u_density", "u_residual",
  "u_disposition", "u_breath", "u_time", "u_active", "u_tension", "u_footprint",
  "u_phase", "u_fieldStrength",
]) {
  assert.match(H2_RHF_FIELD_FRAGMENT_SHADER, new RegExp(`uniform [^;]+ ${uniform};`), `${uniform} remains an explicit visual uniform`);
}
assert.match(H2_RHF_FIELD_FRAGMENT_SHADER, /gl_FragColor\s*=\s*vec4/, "the pass writes transparent fragment colour");
assert.match(H2_RHF_FIELD_FRAGMENT_SHADER, /\(1\.0 - vUv\.y\) \* u_res\.y/,
  "bottom-left WebGL coordinates are flipped once into top-left molecule geometry");
assert.match(H2_RHF_FIELD_FRAGMENT_SHADER, /premultiplied[\s\S]*\* alpha/, "transparent output premultiplies RGB for the shared blend mode");
assert.match(H2_RHF_FIELD_FRAGMENT_SHADER, /left \* leftDensity \+ right \* rightDensity/, "individual density coefficients shape the two atomic lobes");
assert.match(H2_RHF_FIELD_FRAGMENT_SHADER, /1\.0 - step\(0\.5, abs\(u_disposition - 1\.0\)\)/, "only the correcting disposition uses the tension colour");
assert.match(H2_RHF_FIELD_FRAGMENT_SHADER, /float refusal = step\(3\.5, u_disposition\)/,
  "only scientific refusal dispositions use the refusal palette; cancellation remains neutral");

console.log("h2-rhf-webgl tests: ok");
