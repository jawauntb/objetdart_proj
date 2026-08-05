/**
 * city-sun-disk — a real, visible sun disk anchored to the same solar
 * direction the sky, godrays, cloud slab, and directional light all read
 * from.
 *
 * The volumetric godrays (city-godrays.ts) currently emanate their shafts
 * from a screen-space point (the NDC projection of citySun.sunPosition).
 * The Preetham sky (city-sky.ts) paints a warm horizon band whose brightest
 * pixel sits at the sun's zenith direction. Neither of them draws an
 * actual disk. That mismatch is the strongest "CG" tell in the current
 * frame: shafts of light emanating from an invisible math point, a warm
 * sky with no source at its centre. Every reference the brief pins — a
 * London dusk, an SF afternoon, a Zootopia sunrise — has a discrete
 * bright disk sitting exactly where the light appears to originate.
 *
 * This module owns that disk. A billboarded plane at the sun's world-
 * space position (from `citySun.sunPosition`), oriented toward the
 * perspective camera every frame, drawn:
 *
 *   1. AFTER the sky mesh in worldScene (renderOrder > 0) so the disk
 *      lands ON the atmosphere the sky renders.
 *   2. BEFORE the cloud slab (renderOrder < cityClouds.mesh.renderOrder = 1)
 *      so the cloud slab's premultiplied-over blend NATURALLY occludes the
 *      disk pixel-by-pixel wherever the cloud alpha crosses it. When a
 *      dusk stratocumulus drifts across the sun, the sun visibly dims and
 *      pinks-out through the underside colour the cloud shader is already
 *      painting — no extra shader wiring needed.
 *   3. With depthWrite=false, depthTest=false, side=DoubleSide so no
 *      z-fight against the backdrop dome and no risk of a cascade shadow
 *      map picking up the disk.
 *   4. Additive blending — the disk deposits light onto the sky, not
 *      alpha-over it. Standard how a photographic sun disk composites on
 *      top of a sky background.
 *
 * The shader draws:
 *
 *   INNER CORE  (r < CORE_RADIUS)
 *     A very hot, very small central patch — luminance far above the
 *     UnrealBloom threshold curve (bloomParamsForDay is 0.55..0.90). The
 *     bloom sieve reads a strong signal from these pixels and produces
 *     the characteristic hot-core halo — the reason a photographed sun
 *     bleeds a bright bloom halo that the surrounding disk does NOT.
 *
 *   OUTER DISK  (CORE_RADIUS ≤ r ≤ 1.0)
 *     A Chapman-style limb darkening: brightness peaks at r=0 and rolls
 *     off smoothly toward r=1. Toward the limb, chromatic Rayleigh
 *     extinction reddens the disk — the same physics that reddens the
 *     sun near the horizon, but applied to the disk itself: the edge
 *     rays traverse more atmospheric slant path than the centre-ray, so
 *     blue is scattered out first and the limb ends warmer than the
 *     core. This is why a low-sun photo shows a bright yellow core with
 *     a red-orange halo bleeding into the sky.
 *
 *   HORIZON EXTINCTION
 *     A separate per-frame multiplier — the entire disk dims and reddens
 *     when the sun is low. dawn/dusk: warm, dim, huge-feeling. noon: hot,
 *     bright, tight. This is the same 2000K↔5500K curve the directional
 *     light rides via sunColorAt in city-sun.ts, so the disk COLOUR and
 *     the light DIRECTION agree.
 *
 * Pure-math halves so scripts/test-city-sun-disk.mjs can pin the curves
 * without touching WebGL:
 *
 *   SUN_DISK_ANGULAR_RADIUS_RAD    — 0.0192 rad ≈ 1.1° (twice the real angle)
 *   SUN_DISK_DISTANCE              — 1500 m (behind clouds, in front of sky)
 *   SUN_DISK_WORLD_RADIUS          — world-units radius at the mesh's distance
 *   SUN_DISK_CORE_RADIUS_FRAC      — 0.20 (the hot-core cutoff)
 *   SUN_DISK_CORE_BOOST            — 4.5 (how much brighter the core is)
 *   chapmanLimbDarkening(r)        — 1..~0.40 monotonic radial ramp
 *   sunDiskChromaticShift(r)       — Rayleigh redness that grows toward limb
 *   sunDiskIntensityForDay(df)     — 0..~2.4 diurnal envelope
 *   sunDiskColorForDay(df)         — blackbody at the sun's altitude
 *   sunDiskEnabledForTier(tier)    — off at sleep, on everywhere else
 *
 * Zero coupling to city.ts laws, gestures, audio, or persistence. The
 * module is a pure post-attach layer inside the world scene, driven each
 * frame by the same solar direction city-sun.ts owns.
 */

import * as THREE from "three";
import type { QualityTier } from "@/lib/room-runtime";
import { sunAltitude, sunColorAt } from "@/lib/city-sun";

// ── constants pinned by the brief ────────────────────────────────────────

/**
 * The sun's angular half-radius as seen from Earth, in radians.
 * 0.53° / 2 ≈ 0.00465 rad — but a photograph exaggerates the disk
 * slightly through the diffraction-limited lens, and every reference the
 * brief pins carries a disk noticeably larger than the physical value.
 * We land on ~1.1° (0.0192 rad) — twice the physical angle, still small
 * enough to read as sun-not-moon, large enough to catch the bloom halo
 * clearly. Fixing the number here (not letting it drift through a per-
 * frame randomisation) keeps the disk stable across mounts.
 */
export const SUN_DISK_ANGULAR_RADIUS_RAD = 0.0192;

/**
 * World-space distance from the camera the disk mesh is positioned at.
 * Placed WELL beyond the tallest tower (~180 m) and the cloud slab base
 * (~700 m) so the disk sits behind clouds when a cloud drifts across
 * it, but comfortably in front of the Preetham sky mesh (SKY_RADIUS ~
 * 4.5e5 m) so no depth-fight can happen even without depthTest.
 *
 * 1500 m places the disk between the volumetric cloud slab (which
 * composites over it) and the horizon backdrop dome (r=2000 m), so the
 * disk sits IN the world but far enough away that the mesh's world-
 * radius maps cleanly to the desired angular size.
 */
export const SUN_DISK_DISTANCE = 1500;

/**
 * World radius of the disk mesh at SUN_DISK_DISTANCE. Derived from
 * angular radius: r = tan(angular_radius) * distance. At 0.0192 rad,
 * 1500 m distance → ~28.8 m radius. Kept as a derived constant so
 * a future refactor that changed the distance would automatically
 * update the mesh scale.
 */
export const SUN_DISK_WORLD_RADIUS =
  Math.tan(SUN_DISK_ANGULAR_RADIUS_RAD) * SUN_DISK_DISTANCE;

/**
 * Fraction of the disk radius that is the "hot core". The inner 20 %
 * of the disk carries a much brighter emission than the outer 80 %.
 * This is the signal the UnrealBloom threshold sieve reads to produce
 * the characteristic photographic bloom halo — a small very bright
 * point emitting a diffuse warm glow into the sky around it.
 */
export const SUN_DISK_CORE_RADIUS_FRAC = 0.20;

/**
 * Multiplier applied to the inner-core emission on top of the outer
 * disk brightness. 4.5× is picked so a mid-day core lands well above
 * the bloom threshold (~0.55 at noon in bloomParamsForDay) while the
 * outer disk stays below or near it — the core blooms, the disk
 * outlines the source.
 */
export const SUN_DISK_CORE_BOOST = 4.5;

/**
 * Linear coefficient of the Chapman-style limb darkening law. The classical
 * quadratic stellar limb-darkening formula is I(mu)/I(0) = 1 - u*(1-mu),
 * where mu = sqrt(1 - r^2) for r in [0, 1]. u=0.60 matches the visual
 * solar-photosphere limb darkening in the 550 nm band — bright centre,
 * darkened by ~40 % at the visible limb.
 */
export const SUN_DISK_LIMB_U = 0.60;

/**
 * Rayleigh chromatic-extinction strength at the limb. Multiplied by the
 * atmospheric-path factor (which is 0 at r=0 and 1 at r=1), then applied
 * per channel as (1 - kλ * r_norm). k_R = 0.05, k_G = 0.15, k_B = 0.35 —
 * blue is scattered out fastest, so the limb ends redder than the core.
 * A refactor that flattened these to equal values would strip the disk's
 * warm halo — the tests pin the ratio.
 */
export const SUN_DISK_RAYLEIGH_R = 0.05;
export const SUN_DISK_RAYLEIGH_G = 0.15;
export const SUN_DISK_RAYLEIGH_B = 0.35;

/**
 * Peak whole-disk luminance multiplier at noon. Above 1 so the core
 * always exceeds the bloom threshold and the visible disk reads as
 * emitting light, not reflecting it.
 */
export const SUN_DISK_LUMINANCE_NOON = 2.4;

/**
 * Whole-disk luminance at horizon crossing (dawn/dusk). Dimmer than
 * noon because the atmospheric slant path attenuates the sun. Still
 * bright enough that the ember dusk disk reads clearly against the
 * sunset sky.
 */
export const SUN_DISK_LUMINANCE_HORIZON = 1.2;

// ── pure-math halves (unit-testable, no THREE dependency) ────────────────

/**
 * The Chapman-style limb darkening law:
 *   I(r) / I(0) = 1 - u * (1 - sqrt(1 - r^2))     for r in [0, 1]
 *
 * At r=0 (disk centre) mu=1 → I/I0 = 1 (peak).
 * At r=1 (limb)        mu=0 → I/I0 = 1 - u.
 * Between them, smooth quadratic-ish rolloff.
 *
 * Callers pass r in [0, 1] where 1 = disk-edge. Values outside are
 * clamped: r > 1 returns 0 (off-disk).
 */
export function chapmanLimbDarkening(r: number, u = SUN_DISK_LIMB_U): number {
  if (r > 1) return 0;
  if (r <= 0) return 1;
  const mu = Math.sqrt(1 - r * r);
  return 1 - u * (1 - mu);
}

/**
 * Rayleigh chromatic extinction across the disk. Returns a per-channel
 * multiplier such that at r=0 the RGB stays neutral (1,1,1) and at r=1
 * the limb loses blue faster than green faster than red — a warm
 * reddening at the disk edge.
 *
 * The path-length grows non-linearly with r on the disk image — a
 * ray to the limb traverses a longer atmospheric slant. Approximated
 * here as a smooth quadratic in r so the reddening ramps in gently.
 */
export function sunDiskChromaticShift(r: number): { r: number; g: number; b: number } {
  const clamped = Math.max(0, Math.min(1, r));
  // quadratic path length — a small effect at r=0.3, strong at r=0.95
  const path = clamped * clamped;
  return {
    r: Math.max(0, 1 - SUN_DISK_RAYLEIGH_R * path),
    g: Math.max(0, 1 - SUN_DISK_RAYLEIGH_G * path),
    b: Math.max(0, 1 - SUN_DISK_RAYLEIGH_B * path),
  };
}

/**
 * dayFraction → whole-disk luminance multiplier. Peaks at noon
 * (SUN_DISK_LUMINANCE_NOON), drops to SUN_DISK_LUMINANCE_HORIZON at
 * dawn/dusk, and returns 0 at night so the disk is invisible below the
 * horizon (the moon is not this module's job).
 *
 * A smooth curve driven by the sun's altitude — same one city-sun.ts
 * uses for the directional light intensity, so the disk brightness and
 * the light strength agree.
 */
export function sunDiskIntensityForDay(dayFraction: number): number {
  const alt = sunAltitude(dayFraction);
  // sun below horizon: no disk
  if (alt <= 0) return 0;
  // 0 at horizon → 1 at zenith
  const t = Math.min(1, alt / (Math.PI * 0.45));
  const eased = t * t * (3 - 2 * t); // smoothstep
  return SUN_DISK_LUMINANCE_HORIZON + (SUN_DISK_LUMINANCE_NOON - SUN_DISK_LUMINANCE_HORIZON) * eased;
}

/**
 * dayFraction → sun disk base colour. Warm 2000K at horizon, hot ~5500K
 * at noon, dark below horizon. Read from city-sun.ts's sunColorAt so
 * the disk's tint agrees with the directional light's tint every frame.
 * A small dawn/dusk red boost is applied so the ember disk reads warmer
 * than the light source itself (the atmosphere reddens the disk more
 * than the fill light that reaches ground level).
 */
export function sunDiskColorForDay(dayFraction: number): { r: number; g: number; b: number } {
  const alt = sunAltitude(dayFraction);
  if (alt <= 0) return { r: 0, g: 0, b: 0 };
  const base = sunColorAt(dayFraction);
  // Extra ember boost at horizon crossings — the disk itself reddens
  // beyond the fill light. horizonWeight is 1 at horizon, 0 at zenith.
  const horizonWeight = Math.max(0, 1 - alt / (Math.PI * 0.25));
  const boostR = 1 + 0.15 * horizonWeight;
  const boostG = 1 - 0.10 * horizonWeight;
  const boostB = 1 - 0.20 * horizonWeight;
  return {
    r: Math.max(0, base.r * boostR),
    g: Math.max(0, base.g * boostG),
    b: Math.max(0, base.b * boostB),
  };
}

/**
 * Per-tier enable flag. The disk is a single tiny quad plus a fragment
 * shader with maybe a dozen ALU ops — cheap enough to keep on at every
 * active tier. Sleep tier disables it so the pause-state renders the
 * dim frame the room's other modules also drop back to.
 */
export function sunDiskEnabledForTier(tier: QualityTier): boolean {
  return tier !== "sleep";
}

// ── shaders ──────────────────────────────────────────────────────────────

const SUN_DISK_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SUN_DISK_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform float uCoreRadiusFrac;   // 0.20
  uniform float uCoreBoost;        // 4.5
  uniform float uLimbU;            // 0.60
  uniform vec3  uRayleighK;        // (0.05, 0.15, 0.35)
  uniform vec3  uBaseColor;        // sun colour at this altitude
  uniform float uLuminance;        // per-frame whole-disk multiplier
  uniform float uOpacity;          // fade-in for horizon transitions

  void main() {
    // Map uv [0..1] to disk-space r in [0..~1.4] centred on (0.5, 0.5).
    vec2 p = (vUv - vec2(0.5)) * 2.0;
    float r = length(p);

    // Off-disk: alpha 0. Anti-aliased edge over ~1/64 of the radius.
    if (r > 1.05) discard;
    float edge = 1.0 - smoothstep(0.985, 1.02, r);

    // Chapman-style limb darkening: I/I0 = 1 - u * (1 - sqrt(1-r^2)).
    float rc = min(r, 0.9999);
    float mu = sqrt(max(0.0, 1.0 - rc * rc));
    float I  = 1.0 - uLimbU * (1.0 - mu);

    // Chromatic Rayleigh extinction — blue leaks out fastest toward
    // the limb, so the edge ends warmer than the core.
    float path = rc * rc;
    vec3 rayleigh = vec3(1.0) - uRayleighK * path;
    rayleigh = max(rayleigh, vec3(0.0));

    // Hot-core boost — a small inner circle emits far brighter than
    // the surrounding disk so UnrealBloom's threshold sieve reads the
    // core as a bright point and haloes it. Smoothstep for anti-aliased
    // core edge (no ring of hot-core cutoff visible in the halo).
    float coreT = 1.0 - smoothstep(uCoreRadiusFrac * 0.7, uCoreRadiusFrac, r);
    float coreMul = 1.0 + (uCoreBoost - 1.0) * coreT;

    // Compose: base sun colour × limb darkening × Rayleigh × core boost × luminance.
    vec3 col = uBaseColor * I * rayleigh * coreMul * uLuminance;

    // Alpha rides the base intensity so the disk edge fades into sky
    // instead of terminating on a hard line; the core stays opaque.
    float a = edge * (0.75 + 0.25 * I) * uOpacity;

    // Additive blend expects pre-multiplied colour — no premul division.
    gl_FragColor = vec4(col, a);
  }
`;

// ── the object ───────────────────────────────────────────────────────────

export type SunDiskUpdate = {
  /** dayFraction in [0..1]. Drives base colour and intensity. */
  dayFraction: number;
  /**
   * World-space sun position (from citySun.sunPosition). The disk mesh
   * is placed on the ray from the camera through this point at distance
   * SUN_DISK_DISTANCE — so the disk always tracks the sun direction
   * even as the visitor moves.
   */
  sunPosition: THREE.Vector3;
  /** The camera the disk billboards toward. */
  camera: THREE.PerspectiveCamera;
  /** Current governor tier. Sleep tier hides the disk. */
  tier: QualityTier;
};

export type CitySunDisk = {
  /** The billboarded disk mesh to add to worldScene. */
  mesh: THREE.Mesh;
  /**
   * Update the disk for this frame. Positions the mesh on the sun ray,
   * orients it toward the camera, feeds uniforms. Cheap — no allocation
   * per tick.
   */
  update(state: SunDiskUpdate): void;
  /** Free the geometry, material, and shader compilation. */
  dispose(): void;
};

/**
 * Build the sun disk. Idempotent per worldScene — creating two disks on
 * the same scene is legal but only one is needed.
 *
 * The mesh uses a small PlaneGeometry sized to SUN_DISK_WORLD_RADIUS.
 * frustumCulled=false because a billboard's bounding sphere is
 * cheaper to skip; the mesh is always in view during the day.
 * renderOrder=0.5 places the disk AFTER the sky (default 0) and
 * BEFORE the cloud slab (renderOrder=1) so cloud alpha naturally
 * occludes the disk without any extra shader wiring.
 */
export function createCitySunDisk(): CitySunDisk {
  const geometry = new THREE.PlaneGeometry(
    SUN_DISK_WORLD_RADIUS * 2,
    SUN_DISK_WORLD_RADIUS * 2,
  );

  const baseColorUniform = new THREE.Vector3(1, 1, 1);
  const rayleighUniform = new THREE.Vector3(
    SUN_DISK_RAYLEIGH_R,
    SUN_DISK_RAYLEIGH_G,
    SUN_DISK_RAYLEIGH_B,
  );

  const material = new THREE.ShaderMaterial({
    name: "citySunDisk",
    vertexShader: SUN_DISK_VERTEX,
    fragmentShader: SUN_DISK_FRAGMENT,
    uniforms: {
      uCoreRadiusFrac: { value: SUN_DISK_CORE_RADIUS_FRAC },
      uCoreBoost: { value: SUN_DISK_CORE_BOOST },
      uLimbU: { value: SUN_DISK_LIMB_U },
      uRayleighK: { value: rayleighUniform },
      uBaseColor: { value: baseColorUniform },
      uLuminance: { value: SUN_DISK_LUMINANCE_NOON },
      uOpacity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    // Additive blend — the disk deposits light on top of the sky.
    // Alpha channel is respected so anti-aliased edges look smooth.
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    // Tone mapping is applied by the composer's OutputPass — the disk
    // colour we write is in linear RGB and will be tone-mapped down
    // together with the sky and clouds. Explicit here so a shader-
    // material default doesn't drift into a re-linearised pipeline.
    toneMapped: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Draw AFTER the sky (renderOrder=0 by default) and BEFORE the cloud
  // slab (renderOrder=1). This lets the cloud shader's premultiplied
  // over-blend NATURALLY dim / tint the sun disk pixel-by-pixel wherever
  // cloud alpha crosses it — the "cloud-slab occlusion" the brief calls
  // for happens without any extra shader wiring.
  mesh.renderOrder = 0.5;
  mesh.name = "citySunDisk";
  mesh.visible = true;
  // The disk is a pure emitter — no shadows to cast or receive. Both
  // flags off so the cascade shadow pass skips this mesh entirely.
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // Scratch vectors reused each frame — mutation only.
  const sunUnit = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const diskPos = new THREE.Vector3();

  return {
    mesh,
    update(state: SunDiskUpdate) {
      // Tier gate. Off entirely at sleep — mesh.visible=false so the
      // renderer skips the draw.
      const enabled = sunDiskEnabledForTier(state.tier);
      mesh.visible = enabled;
      if (!enabled) return;

      // Below-horizon → hide. Cheaper than drawing a fully-black quad.
      const intensity = sunDiskIntensityForDay(state.dayFraction);
      if (intensity <= 0) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;

      // Place the mesh on the ray from the camera to the sun at fixed
      // distance SUN_DISK_DISTANCE. Because we anchor on the CAMERA and
      // not on the world origin, the disk keeps a constant angular size
      // as the visitor moves through the settlement — it always sits at
      // ~1.1° across, exactly like the real sun does regardless of the
      // observer's position on Earth.
      sunUnit.copy(state.sunPosition).normalize();
      camPos.setFromMatrixPosition(state.camera.matrixWorld);
      diskPos.copy(sunUnit).multiplyScalar(SUN_DISK_DISTANCE).add(camPos);
      mesh.position.copy(diskPos);

      // Billboard: orient the plane's normal along the camera-to-disk
      // direction so the disk always faces the camera regardless of
      // viewing angle. `lookAt` orients the +Z of the mesh toward the
      // target — a PlaneGeometry's face normal is +Z, so lookAt(cam)
      // gives us a camera-facing quad.
      mesh.lookAt(camPos);
      mesh.updateMatrixWorld();

      // Update uniforms.
      const color = sunDiskColorForDay(state.dayFraction);
      baseColorUniform.set(color.r, color.g, color.b);
      material.uniforms.uBaseColor.value = baseColorUniform;
      material.uniforms.uLuminance.value = intensity;
      // Opacity fades in during the last 6° of horizon rise / fall to
      // avoid the disk snapping in/out at sun altitude = 0. Read the
      // altitude directly so a tiny angle gives a partial disk.
      const alt = sunAltitude(state.dayFraction);
      const fade = Math.min(1, Math.max(0, alt / (Math.PI / 30))); // 6°
      material.uniforms.uOpacity.value = fade;
    },
    dispose() {
      try { geometry.dispose(); } catch { /* noop */ }
      try { material.dispose(); } catch { /* noop */ }
    },
  };
}
