/**
 * city-camera — the perspective camera for /city.
 *
 * The room used to draw with two OrthographicCameras stamped over each
 * other: the ground shader as one NDC quad, the plot atlas emblems as a
 * second layer of NDC quads. That flat pipeline had nowhere to hang
 * PBR facades, sky IBL, water reflections, or shadows — the aesthetic
 * bar the brief calls Disney/Pixar can only rest on a real 3D scene
 * lit by a real sun.
 *
 * This module owns the perspective camera and the visitor's one hand
 * on it: a single scalar `zoom` in [0..1] that couples pitch *and*
 * distance on a shared curve, spring-eased so a fast pinch never snaps.
 *
 *   zoom = 0   → Currier & Ives bird's-eye — high altitude, near-top-down
 *   zoom = 1   → SF / London street-level — eye height, near-horizon
 *
 * Pitch is a linear map from 78° (near-nadir) at zoom=0 to 8° (near-horizon)
 * at zoom=1, and distance is a smoothstep-eased map from 165 units to 22
 * units — so a slow pinch feels like walking down from a helicopter, and
 * a fast pinch feels like a satisfying spring.
 *
 * The `orbit` axis is here for the hero moment a later PR ships: a slow
 * yaw around the tallest sealed plot at dusk. It stays at 0 by default.
 *
 * The projection helpers let the 2D overlay project world-space plot
 * centers onto screen coordinates — the roads, people, and dwell rings
 * still land where the extruded prisms rise, at any pitch.
 */

import * as THREE from "three";

/** Vertical FOV in degrees. 42° reads close to what a hand-held phone camera
 * shows through its normal lens — wide enough to hold the skyline at eye
 * level, narrow enough to keep the bird's-eye view from looking fisheyed. */
export const CAM_FOV = 42;

/** World-space half-extent of the city on X/Z. The 48 plots' normalized
 * (0..1, 0..1) coordinates map to (-CITY_HALF..+CITY_HALF) on both axes,
 * so the settlement is an 80-unit square centered at the origin. */
export const CITY_HALF = 40;

/** Camera near-plane and far-plane. Near tight enough that a street-level
 * pass through the settlement doesn't clip the base of a tower; far large
 * enough that the bird's-eye view reaches the far edge of the ground plane
 * plus a comfortable horizon. */
export const CAM_NEAR = 0.5;
export const CAM_FAR = 2000;

/**
 * Pitch (radians below horizontal) for a given zoom input. Pinned by
 * test-city-camera.mjs at the two extremes.
 *
 * The map is intentionally near-linear so the visitor feels the pitch
 * change track the pinch scalar 1:1. A cubic curve here felt like the
 * camera "hesitated" in the middle of the travel.
 */
export function pitchForZoom(zoom01: number): number {
  const z = Math.max(0, Math.min(1, zoom01));
  // 72° at bird's-eye was near-nadir — read as a floorplan, not a
  // photograph. 72° still gives a strong helicopter feel while keeping
  // the buildings' vertical silhouette visible. Eye-level end lifted
  // from 8° to 10° so the horizon doesn't clip the tallest tower's tip.
  const highDeg = 72;
  const lowDeg = 10;
  const deg = highDeg * (1 - z) + lowDeg * z;
  return deg * (Math.PI / 180);
}

/**
 * Distance from the target (city center) for a given zoom input. Eased
 * with a smoothstep so the far end of the pinch (helicopter altitude)
 * sits still while the visitor's fingers travel — the psychophysics of
 * a zoom read as continuous only if the near-end changes fastest.
 */
export function distanceForZoom(zoom01: number): number {
  const z = Math.max(0, Math.min(1, zoom01));
  // Bird's-eye stays tight so the skyline fills the frame; eye-level
  // drops closer so the river and far-bank towers read as midground.
  const far = 95;
  const near = 18;
  const t = z * z * (3 - 2 * z);
  return far * (1 - t) + near * t;
}

/**
 * Look-at Y offset for a given zoom. At bird's-eye we look at ground
 * level (y=0); as we zoom in we lift the aim point toward tower mid-
 * heights so the horizon and the skyline sit centered in the frame.
 * Pinned by test-city-camera.mjs.
 */
export function lookYForZoom(zoom01: number): number {
  const z = Math.max(0, Math.min(1, zoom01));
  // Lift the bird's-eye aim from y=0.3 to y=2.5 so the camera looks *at*
  // the middle of the settlement's short buildings rather than at their
  // shadows on the ground — cities photograph well when the aim is on
  // the mass, not the pavement. Eye-level end unchanged at ~6.8 so the
  // skyline sits at horizon height as it did.
  return 2.5 + 4.3 * z;
}

/**
 * The pitch cliff runs from `pitchForZoom(0)` (78°) to `pitchForZoom(1)` (8°).
 * `pitch01` normalises the *current* pitch onto that range so a post-process
 * pass can rank the frame as "bird's-eye" vs "eye-level" without having to
 * know the specific degree values or reimplement the coupling curve.
 *
 *   pitch01 = 0  → eye-level  (photoreal SF/London skyline read)
 *   pitch01 = 1  → bird's-eye (Currier & Ives model-scale read)
 *
 * The brief's Bokeh DOF pass rides this: at bird's-eye we WANT the diorama
 * blur, at eye-level we want none. A sharp threshold would judder as the
 * spring settled, so callers should smoothstep over pitch01, not step it.
 */
export const PITCH_MIN_RAD = pitchForZoom(1);
export const PITCH_MAX_RAD = pitchForZoom(0);

export function pitch01ForZoom(zoom01: number): number {
  const p = pitchForZoom(zoom01);
  const span = PITCH_MAX_RAD - PITCH_MIN_RAD;
  if (span <= 0) return 0;
  const t = (p - PITCH_MIN_RAD) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export type CityCamera = {
  /** The Three.js camera instance. Add to no scene; pass to RenderPass. */
  camera: THREE.PerspectiveCamera;
  /** Set the target zoom in [0..1]. The spring will ease toward it. */
  setZoomTarget(z: number): void;
  /** Add a delta to the target zoom (clamped). Called from the pinch
   * gesture — dz is a small signed number, positive = zoom in. */
  nudgeZoom(dz: number): void;
  /** The current eased zoom value (what the frame is drawn at). */
  currentZoom(): number;
  /** The target zoom value (what the spring is chasing). */
  targetZoom(): number;
  /** Current pitch in [0..1] where 0 = eye-level (near-horizon) and
   * 1 = bird's-eye (near-nadir). Consumed by post-process passes that
   * want to ramp on the bird's-eye read (Bokeh DOF, the Currier &
   * Ives color grade later). Read from the *eased* zoom so a fast
   * pinch feels like the DOF rides the spring, not the intent. */
  pitch01(): number;
  /** Set the orbit angle target in radians (yaw around Y axis). */
  setOrbit(a: number): void;
  /** Pan the camera's target on the ground plane by (dx, dz) world units.
   * The pan2 verb writes here — two-finger drag translates the camera aim
   * so a visitor at eye-level can walk the far side of the settlement. */
  panTarget(dx: number, dz: number): void;
  /** Reset the camera target back to the origin. Called on stepBack (two-
   * finger tap) so the ceremony of "seeing the settlement whole" always
   * returns to the same center. */
  resetTarget(): void;
  /** Vessel lean — small roll/pitch bias from device tilt, radians. */
  setTiltBias(roll: number, pitch: number): void;
  /** Advance the spring by dtMs milliseconds. Called from the tick loop. */
  tick(dtMs: number): void;
  /** Resize handler — updates the camera's aspect ratio. */
  setSize(w: number, h: number): void;
};

export type CityCameraOptions = {
  width: number;
  height: number;
  /** Initial zoom in [0..1]. Default 0.15 — a touch above bird's-eye so
   * the visitor sees the settlement AND the pitch has room to travel. */
  initialZoom?: number;
  /** Spring stiffness (higher = snappier). Default 62. */
  springStiffness?: number;
  /** Spring damping (higher = less overshoot). Default 14 pairs with
   * K=62 for a near-critically-damped feel. */
  springDamping?: number;
};

export function createCityCamera(opts: CityCameraOptions): CityCamera {
  const cam = new THREE.PerspectiveCamera(
    CAM_FOV,
    Math.max(0.001, opts.width / Math.max(1, opts.height)),
    CAM_NEAR,
    CAM_FAR,
  );

  let zoomTarget = clamp01(opts.initialZoom ?? 0.15);
  let zoomCurrent = zoomTarget;
  let zoomVelocity = 0;

  let orbit = 0;
  let orbitTarget = 0;
  let tiltRoll = 0;
  let tiltPitch = 0;

  const K = opts.springStiffness ?? 62;
  const D = opts.springDamping ?? 14;

  const target = new THREE.Vector3(0, 0, 0);

  const applyCamera = (): void => {
    const pitch = pitchForZoom(zoomCurrent) + tiltPitch;
    const dist = distanceForZoom(zoomCurrent);
    const y = dist * Math.sin(pitch);
    const horizontal = dist * Math.cos(pitch);
    const sinA = Math.sin(orbit);
    const cosA = Math.cos(orbit);
    cam.position.set(cosA * horizontal, y, sinA * horizontal);
    const lookY = lookYForZoom(zoomCurrent);
    cam.lookAt(target.x, target.y + lookY, target.z);
    // Roll after lookAt so vessel tilt leans the postcard without
    // fighting the orbit spring.
    if (tiltRoll !== 0) cam.rotateZ(tiltRoll);
  };

  applyCamera();

  return {
    camera: cam,
    setZoomTarget(z: number) {
      zoomTarget = clamp01(z);
    },
    nudgeZoom(dz: number) {
      zoomTarget = clamp01(zoomTarget + dz);
    },
    currentZoom() {
      return zoomCurrent;
    },
    targetZoom() {
      return zoomTarget;
    },
    pitch01() {
      return pitch01ForZoom(zoomCurrent);
    },
    setOrbit(a: number) {
      orbitTarget = a;
    },
    panTarget(dx: number, dz: number) {
      const limit = CITY_HALF * 2.2;
      target.x = Math.max(-limit, Math.min(limit, target.x + dx));
      target.z = Math.max(-limit, Math.min(limit, target.z + dz));
    },
    resetTarget() {
      target.set(0, 0, 0);
    },
    setTiltBias(roll: number, pitch: number) {
      // Soft clamp — a pocket tilt should lean the view, not flip it.
      tiltRoll = Math.max(-0.18, Math.min(0.18, roll));
      tiltPitch = Math.max(-0.12, Math.min(0.12, pitch));
    },
    tick(dtMs: number) {
      const dt = Math.max(0.001, Math.min(0.05, dtMs / 1000));
      // Critically-damped spring for zoom
      const zAccel = -K * (zoomCurrent - zoomTarget) - D * zoomVelocity;
      zoomVelocity += zAccel * dt;
      zoomCurrent += zoomVelocity * dt;
      // Snap if we're within a tiny epsilon and nearly still — avoids
      // the spring buzzing at rest at fp precision.
      if (
        Math.abs(zoomCurrent - zoomTarget) < 1e-4 &&
        Math.abs(zoomVelocity) < 1e-3
      ) {
        zoomCurrent = zoomTarget;
        zoomVelocity = 0;
      }
      orbit += (orbitTarget - orbit) * Math.min(1, dt * 3);
      applyCamera();
    },
    setSize(w: number, h: number) {
      cam.aspect = Math.max(0.001, w / Math.max(1, h));
      cam.updateProjectionMatrix();
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Normalized plot coord (0..1 in x/y as stored in city.ts) → world-space
 * ground coords (X on ground, Z depth). Y=0 is the ground plane. The
 * center of the settlement lives at world (0, 0, 0).
 */
export function normToWorld(nx: number, ny: number): { x: number; z: number } {
  return {
    x: (nx - 0.5) * 2 * CITY_HALF,
    z: (ny - 0.5) * 2 * CITY_HALF,
  };
}

const _pv = new THREE.Vector3();

/**
 * Project a world-space point through the perspective camera into screen
 * coordinates. Used by the 2D overlay so roads and people land at the
 * feet of the extruded prisms at any pitch.
 *
 * `outWidth`/`outHeight` are CSS-pixel dimensions of the overlay canvas.
 * The returned `visible` flag is true only if the point is inside the
 * NDC cube and in front of the camera — the caller should skip drawing
 * for false, otherwise a point behind the camera would draw as a mirror.
 */
export function projectToScreen(
  cam: THREE.PerspectiveCamera,
  worldX: number,
  worldY: number,
  worldZ: number,
  outWidth: number,
  outHeight: number,
): { x: number; y: number; z: number; visible: boolean } {
  _pv.set(worldX, worldY, worldZ);
  const v = _pv.project(cam);
  const sx = (v.x + 1) * 0.5 * outWidth;
  const sy = (1 - (v.y + 1) * 0.5) * outHeight;
  const visible = v.z >= -1 && v.z <= 1 && v.x >= -1.05 && v.x <= 1.05 && v.y >= -1.05 && v.y <= 1.05;
  return { x: sx, y: sy, z: v.z, visible };
}

/**
 * Convenience: project a normalized (0..1) plot coordinate at ground
 * height directly to screen. Combines normToWorld + projectToScreen.
 */
export function projectPlotToScreen(
  cam: THREE.PerspectiveCamera,
  nx: number,
  ny: number,
  outWidth: number,
  outHeight: number,
): { x: number; y: number; z: number; visible: boolean } {
  const w = normToWorld(nx, ny);
  return projectToScreen(cam, w.x, 0, w.z, outWidth, outHeight);
}
