/**
 * city-backdrop-dome — the photographic haze annulus at r ≈ 2000 m.
 *
 * The frame has two established rings — the plot skyline (r ≤ 40 m) and
 * the infill + skyline-ring layer (r 90..500 m). Beyond the last landmark
 * silhouette the world's exponential fog fades to a flat solid; there is
 * no visible city past 500 m. Every reference the brief pins — SF from
 * the Marina, London from Primrose Hill — carries a distant skyline that
 * fades through *layered* warm-underside haze with faint building shadows
 * in it, not a flat wash. That fade is the horizon depth cue photographs
 * always carry and painterly stand-ins never do.
 *
 * This module owns that layer. A cylinder at r = 2000 m surrounds the
 * scene from outside the existing rings but well short of the Preetham
 * sky mesh at 4.5e5 m. Its inner face carries:
 *
 *   - a horizon band of distant-skyline silhouettes — multi-octave value
 *     noise across azimuth, warm-tinted at the crown, cooler above, with
 *     a slight radial jitter so the profile is not a flat rectangle
 *   - a warm dusk "underside" glow at the lowest 8..12° reading as sun
 *     scattering through humid horizon air (the Rayleigh + Mie ember band
 *     the sky itself paints, sampled once per slot and re-tinted here so
 *     the dome's horizon agrees with the sky's horizon on the same clock)
 *   - a haze taper — full opacity at the horizon band, fading through a
 *     cubic falloff to zero alpha as the shader climbs the wall, so the
 *     Preetham sky above shows through cleanly and the dome never fights
 *     the atmospheric colour up there
 *
 * The result: standing at the harbour edge at dusk, the eye sees the plot
 * skyline in front, the infill ring at 100..500 m in mid-ground, and a
 * photographic haze band with faint distant silhouettes at 2000 m —
 * three layers of horizon depth, not the one flat fog wall the previous
 * pipeline shipped. The horizon *has* a texture, and it agrees with the
 * sky above it because both are painted from the same Preetham state.
 *
 * Cost & footprint:
 *
 *   - one CylinderGeometry (open-ended, 128×32 segments, ~4k tris)
 *   - one ShaderMaterial (BackSide, transparent, depthWrite=false)
 *   - drawn once per frame with `renderOrder = -50` so it lands after the
 *     Preetham sky mesh but before any solid geometry — the plot skyline,
 *     the infill, and the skyline-ring layer all write depth on top
 *   - no textures — the silhouette is a deterministic GPU hash function
 *     seeded per-visit, so nothing allocates on remount
 *   - no per-frame CPU work beyond a scalar uniform push per slot change
 *
 * Determinism:
 *
 *   The seed the caller passes drives the hash chain the silhouette shader
 *   samples for its noise. No `Math.random`, no time. A remount of the
 *   same seed paints the same skyline profile. Different seeds paint
 *   plausibly different distant cities.
 *
 * Zero gameplay coupling:
 *
 *   The dome is pure backdrop. City.tsx calls `setSkyState(state)` on the
 *   same slot change that re-bakes the environment IBL, and `setDayFrac`
 *   every frame for the ember dial. `setTier` folds sleep → hidden so the
 *   paused frame doesn't ship a draw call. No observation of plots,
 *   people, roads, or gestures.
 */

import * as THREE from "three";
import type { SkyState } from "@/lib/city-sky";

// ── constants the tests pin ─────────────────────────────────────────────

/**
 * Radius of the dome cylinder. Chosen at 2000 m — comfortably beyond the
 * SKYLINE_OUTER_R = 500 m of the landmark ring, comfortably short of the
 * Preetham sky mesh at 4.5e5 m, and inside the perspective camera's
 * effective far clip. At r=2000 m the ~300 m band subtends roughly 8.5°
 * of pitch from a ground-level observer — the right vertical share of
 * the frame for a distant horizon.
 */
export const BACKDROP_RADIUS = 2000;

/**
 * Vertical extent of the cylinder. 300 m carries silhouettes tall enough
 * that the tallest distant skyscraper (an Empire State, a Shard) reads as
 * a peak against the sky, plus a haze taper above.
 */
export const BACKDROP_HEIGHT = 300;

/** Vertical offset — where the base of the dome sits. -8 keeps the
 *  bottom of the silhouette just below the visible ground plane so a
 *  low visitor angle doesn't see the seam between dome and ground. */
export const BACKDROP_BASE_Y = -8;

/**
 * Cylinder tessellation. 128 azimuth segments is coarse enough for a fast
 * draw and fine enough that the silhouette noise reads continuous rather
 * than stepped. 32 vertical segments give the shader enough room to run
 * a smooth haze taper without banding.
 */
export const BACKDROP_RADIAL_SEGMENTS = 128;
export const BACKDROP_HEIGHT_SEGMENTS = 32;

/**
 * The vertical fraction (0..1 of the dome height) at which the horizon
 * silhouette band peaks. Below this the shader paints solid silhouette
 * shape; above it fades through the haze taper. 0.22 puts the crest of
 * the tallest building at ~66 m dome-relative height, which reads well.
 */
export const BACKDROP_SILHOUETTE_PEAK = 0.22;

/**
 * Base height of the silhouette (fraction of dome height). Below this the
 * dome is filled with dense haze regardless of the noise — the shortest
 * building on the horizon is at least this tall against the sky.
 */
export const BACKDROP_SILHOUETTE_FLOOR = 0.06;

/**
 * Noise octaves for the silhouette height along azimuth. More octaves
 * → richer detail; three is a musical count — a low frequency giving
 * the district scale, a mid frequency giving block scale, a high
 * frequency giving individual-building notches.
 */
export const BACKDROP_NOISE_OCTAVES = 3;

/**
 * Governor tier tag — same shape the ring modules use. Sleep hides the
 * dome (nothing draws on a paused frame). All active tiers draw the same
 * one-mesh backdrop.
 */
export type BackdropTier = "low" | "medium" | "high" | "sleep";

// ── pure helpers (tested) ────────────────────────────────────────────────

/**
 * Deterministic 32-bit hash → unit float in [0, 1). Same mixer shape the
 * infill + skyline-ring modules use so a future consolidation into one
 * shared helper is a rename, not a rewrite.
 */
export function backdropUnitHash(seed: number, salt: number): number {
  let x = ((seed | 0) ^ ((salt * 0x9e3779b1) | 0)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 0xffffffff;
}

/**
 * CPU-side twin of the shader's silhouette height function. Returns the
 * normalized height in [0, 1] of the silhouette crest at a given azimuth
 * (0..1 wraps the whole cylinder) for a given seed. Used by the test to
 * pin the profile's floor / ceiling / determinism without invoking a
 * GPU. Match the shader's chain (see fragmentShaderSource below) so a
 * regression in either lands in the test.
 */
export function silhouetteHeightAtAzimuth(
  azimuth: number,
  seed: number,
): number {
  // Wrap to [0, 1).
  const a = ((azimuth % 1) + 1) % 1;
  // Sample BACKDROP_NOISE_OCTAVES octaves of value noise. Each octave
  // doubles frequency and halves amplitude. Amplitudes sum to 1 so the
  // total is bounded in [0, 1].
  let total = 0;
  let ampSum = 0;
  for (let o = 0; o < BACKDROP_NOISE_OCTAVES; o += 1) {
    const freq = 1 << (o + 3); // 8, 16, 32
    const amp = Math.pow(0.5, o);
    ampSum += amp;
    // Sample two lattice points and interpolate.
    const f = a * freq;
    const ix = Math.floor(f);
    const t = f - ix;
    // Hermite ease for a smoother crest.
    const te = t * t * (3 - 2 * t);
    const h0 = backdropUnitHash(seed, ix ^ ((o + 1) * 0xa1b2c3d));
    const h1 = backdropUnitHash(seed, (ix + 1) ^ ((o + 1) * 0xa1b2c3d));
    total += (h0 * (1 - te) + h1 * te) * amp;
  }
  const noise = total / ampSum;
  // Map to [floor, peak].
  return (
    BACKDROP_SILHOUETTE_FLOOR +
    noise * (BACKDROP_SILHOUETTE_PEAK - BACKDROP_SILHOUETTE_FLOOR)
  );
}

/**
 * Dusk amount for a given dayFraction. 0 at noon (0.25) and midnight
 * (0.75), 1 at dawn (0) and dusk (0.5). Same shape city-clouds uses so
 * every warm-underside layer lights on the same clock.
 */
export function backdropDuskAmount(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  // Two peaks per day at dawn (0) and dusk (0.5).
  const phase = Math.cos(f * Math.PI * 4); // +1 at dawn/dusk, -1 at noon/midnight
  return Math.max(0, phase * 0.5 + 0.5);
}

/**
 * Night amount for a given dayFraction. 1 at midnight (0.75), 0 through
 * daylight. Rises again after dusk. The dome's silhouette carries a
 * faint blue-cool bias at night so distant buildings sit in the
 * moonlit-haze regime rather than the dusk-ember regime.
 */
export function backdropNightAmount(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  // 0 at noon (0.25), 1 at midnight (0.75), symmetric.
  const c = Math.cos((f - 0.75) * Math.PI * 2);
  return Math.max(0, Math.min(1, c * 0.5 + 0.5));
}

/**
 * Compute the dome's horizon tint from a Preetham sky state.
 *
 * Returns three linear-RGB triples for the shader:
 *   - horizonColor: the crest of the horizon band (mid-brightness, warm
 *     at dusk / cool at noon, sampled just above the true horizon)
 *   - underColor:   the warm dusk underside — a Rayleigh-boosted amber
 *     the sky's horizon paints itself; drives the "sun scattering
 *     through humid air" ember at the base of the dome
 *   - hazeColor:    the pale wash above the silhouette; where the dome
 *     fades toward transparent, blending into the Preetham sky above
 *
 * Sampling matches the shape city-sky.fogColorFromSky uses so the dome's
 * horizon reads as the same colour the fog is dissolving toward, and the
 * eye picks up no seam between the two layers.
 */
export function backdropTintFromSky(state: SkyState): {
  horizon: [number, number, number];
  under: [number, number, number];
  haze: [number, number, number];
} {
  // The sun's altitude in radians drives horizon vs. midday-blue balance.
  const altitude = state.sunAltitude;
  // dayness: 1 when the sun is at zenith, 0 at horizon, negative below.
  const dayness = Math.max(0, Math.sin(altitude));
  // horizonProx: 1 at the horizon, 0 at zenith — the dusk-warmth dial.
  const horizonProx = 1 - Math.min(1, Math.abs(altitude) / (Math.PI * 0.5));
  // dusk: ember at horizon.
  const dusk = Math.max(0, horizonProx) * (1 - dayness);
  // night: negative altitude.
  const night = Math.max(0, -Math.sin(altitude));

  // Base horizon RGB — a pale-blue mid-day tone.
  const dayHorizon: [number, number, number] = [0.58, 0.68, 0.78];
  // A warm dusk band — amber under-glow the horizon carries at 0.5.
  const duskHorizon: [number, number, number] = [0.94, 0.62, 0.42];
  // A cool moonlit-haze — the after-dusk indigo horizon.
  const nightHorizon: [number, number, number] = [0.18, 0.22, 0.32];

  function mix3(
    a: [number, number, number],
    b: [number, number, number],
    t: number,
  ): [number, number, number] {
    return [
      a[0] * (1 - t) + b[0] * t,
      a[1] * (1 - t) + b[1] * t,
      a[2] * (1 - t) + b[2] * t,
    ];
  }

  // Blend: day → dusk → night as the sun descends.
  let horizon = mix3(dayHorizon, duskHorizon, Math.min(1, dusk * 1.4));
  horizon = mix3(horizon, nightHorizon, Math.min(1, night));

  // Underside — a shade warmer + brighter than the horizon at dusk,
  // deeper indigo at night.
  const dayUnder: [number, number, number] = [0.72, 0.78, 0.84];
  const duskUnder: [number, number, number] = [1.00, 0.54, 0.30];
  const nightUnder: [number, number, number] = [0.14, 0.18, 0.26];
  let under = mix3(dayUnder, duskUnder, Math.min(1, dusk * 1.6));
  under = mix3(under, nightUnder, Math.min(1, night));

  // Haze wash above the silhouette — desaturated version of the horizon
  // so the dome fades into the sky without a chromatic shift.
  const dayHaze: [number, number, number] = [0.72, 0.78, 0.86];
  const duskHaze: [number, number, number] = [0.86, 0.72, 0.62];
  const nightHaze: [number, number, number] = [0.20, 0.24, 0.32];
  let haze = mix3(dayHaze, duskHaze, Math.min(1, dusk));
  haze = mix3(haze, nightHaze, Math.min(1, night));

  return { horizon, under, haze };
}

// ── shader source ────────────────────────────────────────────────────────

const vertexShaderSource = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShaderSource = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vWorldPos;

  uniform vec3 uHorizonColor;
  uniform vec3 uUnderColor;
  uniform vec3 uHazeColor;
  uniform float uSeed;
  uniform float uDusk;
  uniform float uNight;
  uniform float uSilFloor;
  uniform float uSilPeak;

  // 32-bit hash → unit float. Match the CPU chain in
  // backdropUnitHash so silhouetteHeightAtAzimuth stays testable.
  float unitHash(float seedF, float saltF) {
    float x = seedF + saltF * 2654435761.0;
    x = fract(sin(x * 0.9375) * 43758.5453);
    x = fract(sin((x + saltF) * 12.9898) * 43758.5453);
    return x;
  }

  // One octave of value noise across azimuth.
  float valueOctave(float a, float freq, float saltBias) {
    float f = a * freq;
    float ix = floor(f);
    float t = f - ix;
    // Hermite ease.
    float te = t * t * (3.0 - 2.0 * t);
    float h0 = unitHash(uSeed, ix + saltBias);
    float h1 = unitHash(uSeed, ix + 1.0 + saltBias);
    return mix(h0, h1, te);
  }

  // Silhouette crest height at a given azimuth in [0, 1).
  float silhouette(float a) {
    // Three octaves: 8, 16, 32 cycles around the dome.
    float amp = 1.0;
    float ampSum = 0.0;
    float total = 0.0;
    for (int o = 0; o < 3; o++) {
      float freq = pow(2.0, float(o) + 3.0);
      float saltBias = (float(o) + 1.0) * 169.2836;
      total += valueOctave(a, freq, saltBias) * amp;
      ampSum += amp;
      amp *= 0.5;
    }
    float noise = total / ampSum;
    return mix(uSilFloor, uSilPeak, noise);
  }

  void main() {
    // Azimuth from UV. u wraps 0..1 around the cylinder.
    float a = fract(vUv.x);
    // Silhouette height at this azimuth.
    float sil = silhouette(a);

    // The dome's vertical coordinate — v runs bottom (0) to top (1).
    float v = clamp(vUv.y, 0.0, 1.0);

    // A tiny per-column jitter softens the crest so the silhouette does
    // not read as a hard mathematical step. 6 px of jitter at typical
    // resolutions.
    float jitter = (unitHash(uSeed, floor(a * 512.0) + 0.5) - 0.5) * 0.008;
    float silJ = sil + jitter;

    // How far are we above the crest?
    float aboveCrest = smoothstep(silJ - 0.008, silJ + 0.008, v);

    // Two zones:
    //   1) below the crest — solid silhouette body, warm at the base,
    //      cool at the top.
    //   2) above the crest — haze taper into transparency.
    vec3 belowColor;
    {
      // Vertical mix inside the silhouette body: under-glow at base,
      // horizon tint at crest.
      float bodyV = v / max(silJ, 1e-4);
      // Warm dusk under-glow is strongest at the base (bodyV=0), fades
      // upward to the horizon tint at the crest (bodyV=1).
      vec3 base = mix(uUnderColor, uHorizonColor, pow(bodyV, 0.85));
      // Silhouettes are DARKER than the horizon band — distant buildings
      // sit as slightly-cool shadows against the sky's warmth.
      float sub = 0.62 + 0.28 * bodyV; // top of silhouette lighter than base
      // At night the silhouette body is dark, at day it holds the horizon
      // tint. Dusk sits in-between as the ember catches the roof edges.
      float dayScale = mix(0.82, 1.0, 1.0 - uNight);
      float duskLift = uDusk * 0.15;
      belowColor = base * (sub * dayScale + duskLift);
    }

    vec3 aboveColor;
    float aboveAlpha;
    {
      // Above the crest: haze taper toward transparent.
      // Distance above the crest, normalized to the taper zone (0..1).
      float taperDist = clamp((v - silJ) / max(1.0 - silJ, 1e-4), 0.0, 1.0);
      // Cubic falloff so the dome dissolves cleanly into the sky.
      float haze = 1.0 - pow(taperDist, 1.6);
      // Warm-under lick above the crest (the last kiss of dusk light on
      // the underside of high haze).
      float underLick = smoothstep(0.0, 0.18, taperDist) *
                        (1.0 - smoothstep(0.18, 0.42, taperDist));
      vec3 tint = mix(uHorizonColor, uHazeColor, taperDist);
      tint += uUnderColor * underLick * uDusk * 0.35;
      aboveColor = tint;
      aboveAlpha = haze;
    }

    vec3 rgb = mix(belowColor, aboveColor, aboveCrest);
    // Below-crest alpha is 1 (the silhouette occludes the sky behind it,
    // even though we do not write depth); above-crest fades via the haze.
    float alpha = mix(1.0, aboveAlpha, aboveCrest);

    // Overall dome opacity — always a shade below 1 near the base so the
    // Preetham sky's own ember bleeds THROUGH the dome slightly (the
    // dome ADDS a silhouette to the sky, it does not fully occlude it).
    // The alpha stays high near the crest so silhouettes read solid.
    float baseTransparency = 0.94;
    alpha *= baseTransparency;

    gl_FragColor = vec4(rgb, alpha);
  }
`;

// ── the dome ─────────────────────────────────────────────────────────────

export type CityBackdropDomeOptions = {
  seed: number;
  radius?: number;
  height?: number;
};

export type CityBackdropDome = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  setSkyState(state: SkyState): void;
  setDayFrac(day: number): void;
  setTier(tier: BackdropTier): void;
  dispose(): void;
};

/**
 * Build the horizon backdrop dome. Cylinder at r=2000, drawn from inside
 * (BackSide), depth-write off, renderOrder pushed low so it lands after
 * the sky and before every solid layer. One shader material, one draw.
 */
export function createCityBackdropDome(
  opts: CityBackdropDomeOptions,
): CityBackdropDome {
  const seed = opts.seed >>> 0;
  const radius = Math.max(100, opts.radius ?? BACKDROP_RADIUS);
  const height = Math.max(20, opts.height ?? BACKDROP_HEIGHT);

  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    BACKDROP_RADIAL_SEGMENTS,
    BACKDROP_HEIGHT_SEGMENTS,
    /* openEnded */ true,
  );
  // The default cylinder is centred at y=0; translate so its base sits
  // at BACKDROP_BASE_Y.
  geometry.translate(0, BACKDROP_BASE_Y + height * 0.5, 0);

  // Seed as a float uniform — the shader's hash reads it as a float, so
  // convert once here. Reducing modulo a big prime avoids the
  // uSeed=0-produces-zero corner.
  const seedF = ((seed % 1000003) + 1) * 0.001;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uHorizonColor: { value: new THREE.Color(0.58, 0.68, 0.78) },
      uUnderColor: { value: new THREE.Color(0.72, 0.78, 0.84) },
      uHazeColor: { value: new THREE.Color(0.72, 0.78, 0.86) },
      uSeed: { value: seedF },
      uDusk: { value: 0 },
      uNight: { value: 0 },
      uSilFloor: { value: BACKDROP_SILHOUETTE_FLOOR },
      uSilPeak: { value: BACKDROP_SILHOUETTE_PEAK },
    },
    vertexShader: vertexShaderSource,
    fragmentShader: fragmentShaderSource,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    // We still test against depth so the world ground plane and the
    // infill boxes correctly occlude the base of the dome — the dome is
    // only visible where nothing solid is in front of it.
    depthTest: true,
    fog: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "cityBackdropDome";
  // Push behind everything solid but ahead of the sky mesh (which uses
  // its own default render order). renderOrder is only a within-scene
  // sort key; the composer draws the whole scene in one pass.
  mesh.renderOrder = -50;
  // Never frustum-cull — the dome's bounding sphere is very large and
  // we want it to draw at every camera pose.
  mesh.frustumCulled = false;
  // No shadow work — the dome is a backdrop, not a shadow caster.
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const group = new THREE.Group();
  group.name = "cityBackdropDomeGroup";
  group.add(mesh);

  let currentTier: BackdropTier = "high";
  group.visible = true;

  function setSkyState(state: SkyState): void {
    const t = backdropTintFromSky(state);
    (material.uniforms.uHorizonColor.value as THREE.Color).setRGB(
      t.horizon[0],
      t.horizon[1],
      t.horizon[2],
    );
    (material.uniforms.uUnderColor.value as THREE.Color).setRGB(
      t.under[0],
      t.under[1],
      t.under[2],
    );
    (material.uniforms.uHazeColor.value as THREE.Color).setRGB(
      t.haze[0],
      t.haze[1],
      t.haze[2],
    );
  }

  function setDayFrac(day: number): void {
    material.uniforms.uDusk.value = backdropDuskAmount(day);
    material.uniforms.uNight.value = backdropNightAmount(day);
  }

  function setTier(tier: BackdropTier): void {
    if (tier === currentTier) return;
    currentTier = tier;
    // Sleep hides the dome. All active tiers draw the same single mesh
    // — there's no meaningful cheaper version of a one-draw backdrop.
    group.visible = tier !== "sleep";
  }

  function dispose(): void {
    group.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return {
    group,
    mesh,
    material,
    setSkyState,
    setDayFrac,
    setTier,
    dispose,
  };
}
