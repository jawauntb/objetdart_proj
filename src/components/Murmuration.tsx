"use client";

/**
 * /birds — the flock as one animal. The birds band at ~10¹·³ m, between the
 * garden below and the shore above (docs/plans/life-and-vista-bands.md §2).
 *
 * The invariant is a boid parameter triple — separation, alignment, cohesion —
 * plus the wind (src/lib/flock.ts). The sky's shape is a deterministic
 * function of it, integrated on a FIXED timestep so the same second is the
 * same flock at 60 Hz and at 120 Hz.
 *
 * The load-bearing map is the flock's order parameter → the harmonic series.
 * A scattered sky rings a flat, stretched stack of partials — chatter; a
 * murmuration collapses onto one ringing partial, exactly k× the fundamental.
 * The ear knows the order before the eye resolves it, and the map runs
 * backwards: the interval between the first two partials IS the order
 * (`orderFromPartials`, pinned in scripts/test-flock.mjs).
 *
 * The vessel steers the wind. Tilt and the whole flock banks into it; shake
 * and it bursts and re-gathers; knock and one wave of wingbeats crosses the
 * sky. One finger reaches into the air — a stroke scatters, a held finger
 * gathers, and held long enough the flock settles onto the hand as one animal.
 * A circling hand turns the murmuration about its own axis. Two fingers turn
 * the observer, and the sun swings with the head. Three fingers are the
 * world-law: drag is the wind for a device that cannot be tilted, a twist
 * turns the season and with it where the flock is going, a hold slows the
 * clock, a tap is the tutti.
 *
 * The living aviary uses instanced billboard quads with per-kind SDF
 * silhouettes (shared eye / barb / ruffle primitives, species-custom beaks
 * and trains): large readable birds, still one WebGL pass and one rAF. The
 * meadow is the same camera as the birds — a ground-plane ray with foreshortened
 * grass blades, pond and tree at the flock's PLACES. No p5, no animation
 * library, no image assets (plan §3).
 *
 * The flock's character persists in `objetdart:birds:v1` with the quiet clear
 * at the bottom. Pinch is unbound — ScaleTravel owns it.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures, enableBreath } from "@/lib/gesture";
import { onVessel, requestVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import { spectralRegisterFor } from "@/lib/scale";
import {
  createFrameGovernor,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";
import LetGo from "@/components/LetGo";
import {
  ACTIVITIES,
  AVIARY_MAX,
  BIRD_KINDS,
  BIRD_SPECIES,
  MIN_SPEED,
  PARTIALS,
  SEASONS,
  WORLD_X,
  WORLD_Y,
  WORLD_Z,
  advanceFlock,
  callInterval,
  clearBirds,
  centroid,
  cullBird,
  flushNear,
  launchNearest,
  orderParameter,
  partialFreq,
  partialsForOrder,
  PLACES,
  roostNearest,
  seedAviary,
  seasonGoal,
  seasonIndex,
  spawnBird,
  windFromTilt,
  type BirdKind,
  type FlockParams,
  type FlockState,
} from "@/lib/flock";

const STORE_KEY = "objetdart:birds:v1";
/** Centre of the birds band, in log10 metres — where the room sounds from. */
const BAND_S = 1.35;
/** The wild aviary — enough cohesion for flyers to share a heading, not a ball. */
const WILD = { sep: 1.35, ali: 0.7, coh: 0.45 };
const SEASON_PULL = 1.6;
const WIND_MAX = 5;
const CAM_DIST = 78;
const SKY_SEED = 0xb1d5;
const SIZE_MIN = 0.35;
const SIZE_MAX = 1.8;

type Character = { sep: number; ali: number; coh: number };
type Stored = Character & { season: number; yaw: number; cleared?: boolean };

/** Four dusk skies — a murmuration is an evening thing. */
const SEASON_SKY: { low: number[]; high: number[]; sun: number[] }[] = [
  { low: [0.42, 0.45, 0.39], high: [0.07, 0.11, 0.19], sun: [0.95, 0.80, 0.56] },
  { low: [0.62, 0.46, 0.29], high: [0.09, 0.13, 0.23], sun: [1.0, 0.82, 0.50] },
  { low: [0.58, 0.29, 0.21], high: [0.07, 0.06, 0.13], sun: [1.0, 0.57, 0.31] },
  { low: [0.34, 0.38, 0.46], high: [0.05, 0.07, 0.14], sun: [0.82, 0.88, 0.98] },
];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const SKY_VERT = `
attribute vec2 a_pos;
varying vec2 vUv;
void main() { vUv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const SKY_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform vec3 u_low;
uniform vec3 u_high;
uniform vec3 u_ground;
uniform vec3 u_sunTint;
uniform vec3 u_sun;     // x, y in uv; z = visibility
uniform float u_aspect;
uniform float u_roll;
uniform float u_horizon;
uniform float u_breath;
uniform float u_time;
uniform vec2 u_viewOffset;
uniform float u_night;
uniform mat3 u_view;
uniform float u_camDist;
uniform float u_focalX;
uniform float u_focalY;

// habitat anchors — same metres as flock.PLACES
const float GROUND_Y = ${PLACES.grass.y.toFixed(2)};
const vec2 POND_XZ = vec2(${PLACES.pond.x.toFixed(1)}, ${PLACES.pond.z.toFixed(1)});
const vec2 HAY_XZ = vec2(${PLACES.hay.x.toFixed(1)}, ${PLACES.hay.z.toFixed(1)});
const vec2 TREE_XZ = vec2(${PLACES.tree.x.toFixed(1)}, ${PLACES.tree.z.toFixed(1)});
const float TREE_Y = ${PLACES.tree.y.toFixed(2)};
const float CELL = 0.55;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// view → world (u_view is Rx·Ry, column-major)
vec3 viewToWorld(vec3 v) {
  return vec3(
    u_view[0][0] * v.x + u_view[0][1] * v.y + u_view[0][2] * v.z,
    u_view[1][0] * v.x + u_view[1][1] * v.y + u_view[1][2] * v.z,
    u_view[2][0] * v.x + u_view[2][1] * v.y + u_view[2][2] * v.z
  );
}
vec3 worldToView(vec3 w) {
  return u_view * w;
}
// project a world point into the same NDC the birds use
vec2 projectWorld(vec3 w) {
  vec3 v = worldToView(w);
  float z = max(v.z + u_camDist, 1.0);
  return vec2(v.x * u_focalX / z, v.y * u_focalY / z) - u_viewOffset;
}
// soft distance from a ray (ro + t*rd, t>0) to a capsule segment
float rayCapsule(vec3 ro, vec3 rd, vec3 a, vec3 b, float rad, float tMax) {
  vec3 ba = b - a;
  vec3 oa = ro - a;
  float baba = max(dot(ba, ba), 1e-5);
  float bard = dot(ba, rd);
  float baoa = dot(ba, oa);
  float rdoa = dot(rd, oa);
  float rdrd = max(dot(rd, rd), 1e-5);
  float denom = baba * rdrd - bard * bard;
  float t = abs(denom) < 1e-5 ? 0.0 : (baba * rdoa - baoa * bard) / denom;
  t = clamp(t, 0.0, tMax);
  float h = clamp((baoa + t * bard) / baba, 0.0, 1.0);
  float dist = length(oa + rd * t - ba * h);
  return 1.0 - smoothstep(rad * 0.55, rad + 0.04, dist);
}

void main() {
  // roll the frame the same way the vessel rolls the birds
  vec2 c = vUv - 0.5;
  float cs = cos(u_roll), sn = sin(u_roll);
  float y = (c.x * sn + c.y * cs) + 0.5;
  float x = (c.x * cs - c.y * sn) + 0.5;
  // NDC matching bird centers (aspect already folded into u_focalX)
  vec2 ndc = vec2(x * 2.0 - 1.0, y * 2.0 - 1.0);

  // camera ray in VIEW space: camera at (0,0,-camDist), looking +z
  vec3 ro = vec3(0.0, 0.0, -u_camDist);
  vec3 rd = normalize(vec3(
    (ndc.x + u_viewOffset.x) / max(u_focalX, 0.2),
    (ndc.y + u_viewOffset.y) / max(u_focalY, 0.2),
    1.0
  ));

  // intersect world ground plane y = GROUND_Y
  // Wy = viewM col1 · V = cp*Vy + sp*Vz  (viewM[3]=0, [4]=cp, [5]=sp)
  float cp = u_view[1][1];
  float sp = u_view[1][2];
  float denom = cp * rd.y + sp * rd.z;
  float tHit = -1.0;
  if (abs(denom) > 1e-4) {
    tHit = (GROUND_Y + sp * u_camDist) / denom;
  }
  bool onGround = tHit > 0.8 && tHit < 220.0 && denom < 0.0;

  float a = y - u_horizon;
  // clearer dusk: warmer low, cooler high, less muddy mid
  vec3 skyLow = mix(u_low, vec3(0.55, 0.42, 0.30), 0.18);
  vec3 skyHigh = mix(u_high, vec3(0.04, 0.06, 0.12), 0.25);
  vec3 col = a >= 0.0
    ? mix(skyLow, skyHigh, smoothstep(0.0, 0.55, a))
    : mix(skyLow, u_ground, smoothstep(0.0, 0.4, -a));
  col += u_sunTint * 0.11 * exp(-abs(a) * 12.0);
  vec2 d2 = (vUv - u_sun.xy) * vec2(u_aspect, 1.0);
  float d = length(d2);
  col += u_sunTint * exp(-d * d * 26.0) * (0.34 + u_breath * 0.09) * u_sun.z;
  col += u_sunTint * smoothstep(0.026, 0.012, d) * 0.5 * u_sun.z;

  // —— clouds above the horizon ——
  if (a > 0.02) {
    float clouds = noise(vec2(x * u_aspect * 2.2 + u_time * 0.02, y * 3.0));
    float cm = smoothstep(0.55, 0.78, clouds) * smoothstep(0.02, 0.22, a) * (1.0 - smoothstep(0.4, 0.55, a));
    col = mix(col, mix(vec3(0.92, 0.90, 0.86), u_sunTint, 0.15), cm * 0.55);
  }

  // —— meadow on the real ground plane (same camera as the birds) ——
  if (onGround) {
    vec3 hitV = ro + rd * tHit;
    vec3 hitW = viewToWorld(hitV);
    vec2 xz = hitW.xz;
    float depth = tHit;

    // soil + living green, foreshortened by world noise (not screen UV)
    float soil = noise(xz * 0.11);
    float patch = noise(xz * 0.35 + 3.1);
    vec3 dirt = vec3(0.16, 0.12, 0.07);
    vec3 moss = vec3(0.14, 0.28, 0.12);
    vec3 bladeGreen = vec3(0.18, 0.38, 0.14);
    vec3 meadow = mix(dirt, moss, smoothstep(0.28, 0.72, soil));
    meadow = mix(meadow, bladeGreen, smoothstep(0.45, 0.85, patch) * 0.55);
    // wetter near the pond
    float pondDist = length(xz - POND_XZ);
    meadow = mix(meadow, vec3(0.12, 0.22, 0.14), (1.0 - smoothstep(6.0, 14.0, pondDist)) * 0.35);
    // aerial perspective toward the horizon colour
    float hazeG = smoothstep(28.0, 110.0, depth);
    col = mix(meadow, mix(u_low, u_ground, 0.55), hazeG * 0.72);

    // pond — circle on the ground plane (true ellipse after foreshortening)
    float pondR = 5.8;
    float pd = pondDist / pondR;
    float pond = 1.0 - smoothstep(0.92, 1.08, pd);
    float shore = smoothstep(0.88, 1.0, pd) * (1.0 - smoothstep(1.0, 1.22, pd));
    float ripple = noise(xz * 0.55 + vec2(u_time * 0.12, u_time * 0.07));
    vec3 water = mix(vec3(0.10, 0.26, 0.32), vec3(0.28, 0.46, 0.44), 0.25 + ripple * 0.45);
    water = mix(water, u_sunTint, 0.08 + ripple * 0.06);
    col = mix(col, vec3(0.40, 0.34, 0.22), shore);
    col = mix(col, water, pond);

    // hay pile — warm mound on the plane
    float hayD = length((xz - HAY_XZ) / vec2(4.2, 3.4));
    float hay = 1.0 - smoothstep(0.85, 1.15, hayD);
    vec3 hayCol = mix(vec3(0.58, 0.44, 0.18), vec3(0.78, 0.62, 0.28), noise(xz * 1.4));
    col = mix(col, hayCol, hay * (1.0 - pond));

    // foreshortened grass carpet across the whole plane (not a circular island)
    {
      // anisotropic: denser in world-x, compressed along view depth so rows
      // pack toward the horizon the way real turf does
      float row = xz.x * 1.7 + xz.y * 0.35;
      float colN = xz.y * 2.4 - xz.x * 0.2;
      float turf = noise(vec2(row, colN * mix(1.0, 3.5, hazeG)));
      float bladesFar = step(0.62, turf) * (1.0 - pond);
      vec3 turfA = vec3(0.12, 0.30, 0.10);
      vec3 turfB = vec3(0.22, 0.40, 0.14);
      vec3 turfC = vec3(0.34, 0.42, 0.16);
      col = mix(col, mix(turfA, turfB, turf), 0.35 * (1.0 - pond));
      col = mix(col, turfC, bladesFar * 0.28 * (1.0 - hazeG * 0.5));
    }

    // near-field upright blades — thin hairline stems under the birds' scale
    float bladeAmt = 0.0;
    vec3 bladeCol = vec3(0.0);
    if (depth < 48.0 && pond < 0.55) {
      float cellSize = mix(0.28, 0.55, smoothstep(10.0, 40.0, depth));
      vec2 base = floor(xz / cellSize);
      float dens = mix(0.97, 0.55, smoothstep(12.0, 45.0, depth));
      float nearFade = 1.0 - smoothstep(32.0, 48.0, depth);
      for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
          vec2 cell = base + vec2(float(i), float(j));
          float rnd = hash21(cell);
          if (rnd <= dens) {
            vec2 bp = (cell + vec2(hash21(cell + 1.3), hash21(cell + 2.7))) * cellSize;
            // keep blades shorter than a sparrow so they sit under the fauna
            float ht = mix(0.35, 0.95, hash21(cell + 4.1));
            ht *= mix(1.0, 0.4, smoothstep(14.0, 42.0, depth));
            float sway = sin(u_time * (1.1 + rnd * 0.8) + rnd * 40.0 + bp.x * 0.2) * 0.22 * ht;
            vec3 A = vec3(bp.x, GROUND_Y, bp.y);
            vec3 B = vec3(bp.x + sway, GROUND_Y + ht, bp.y + sway * 0.2);
            float zA = worldToView(A).z + u_camDist;
            if (zA >= 3.0) {
              vec2 pa = projectWorld(A);
              vec2 pb = projectWorld(B);
              vec2 spv = ndc - pa;
              vec2 ba = pb - pa;
              float h = clamp(dot(spv, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
              float stem = length(spv - ba * h);
              float w = mix(0.0022, 0.0007, smoothstep(10.0, 45.0, zA));
              w *= mix(1.2, 0.25, h);
              float b = 1.0 - smoothstep(w, w + 0.0018, stem);
              float nearCell = 1.0 - smoothstep(cellSize * 1.3, cellSize * 2.2, length(xz - bp));
              b *= nearCell * nearFade;
              if (b > bladeAmt) {
                bladeAmt = b;
                bladeCol = mix(vec3(0.08, 0.28, 0.08), vec3(0.24, 0.44, 0.13), hash21(cell + 5.5));
                bladeCol = mix(bladeCol, vec3(0.55, 0.50, 0.22), hash21(cell + 6.2) * 0.4 * h);
              }
            }
          }
        }
      }
      col = mix(col, bladeCol, clamp(bladeAmt, 0.0, 1.0) * 0.9);
    }
  } else if (a < 0.0) {
    // under the painted horizon but ray missed the plane — soft falloff
    col = mix(col, u_ground, 0.55);
  }

  // tree — trunk + canopy + fruit, projected with the bird camera
  {
    vec3 trunkBase = vec3(TREE_XZ.x, GROUND_Y, TREE_XZ.y);
    vec3 trunkTop = vec3(TREE_XZ.x, TREE_Y + 3.2, TREE_XZ.y);
    vec2 pb = projectWorld(trunkBase);
    vec2 pt = projectWorld(trunkTop);
    // only draw when both ends are in front
    vec3 vb = worldToView(trunkBase);
    vec3 vt = worldToView(trunkTop);
    if (vb.z + u_camDist > 4.0 && vt.z + u_camDist > 4.0) {
      vec2 pa = ndc - pb;
      vec2 ba = pt - pb;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
      float trunkDist = length(pa - ba * h);
      float trunkW = mix(0.012, 0.006, h);
      float trunk = 1.0 - smoothstep(trunkW, trunkW + 0.01, trunkDist);
      col = mix(col, vec3(0.24, 0.15, 0.08), trunk * 0.95);

      // canopy lobes in world space, projected as soft discs
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        vec3 cc = vec3(
          TREE_XZ.x + (fk - 1.5) * 1.6,
          TREE_Y + 3.8 + hash21(vec2(fk, 2.0)) * 1.4,
          TREE_XZ.y + sin(fk * 1.7) * 1.8
        );
        vec2 pc = projectWorld(cc);
        float zc = max(worldToView(cc).z + u_camDist, 1.0);
        float rad = 3.2 * u_focalY / zc;
        float canopy = 1.0 - smoothstep(rad * 0.75, rad, length(ndc - pc));
        vec3 leaf = mix(vec3(0.10, 0.28, 0.12), vec3(0.22, 0.42, 0.16), hash21(vec2(fk, 4.0)));
        col = mix(col, leaf, canopy * 0.88);
      }
      // fruit under the canopy
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        vec3 fc = vec3(
          TREE_XZ.x - 1.5 + fi * 0.7,
          TREE_Y + 2.4 + hash21(vec2(fi, 3.0)) * 1.8,
          TREE_XZ.y - 0.8 + hash21(vec2(fi, 7.0)) * 1.6
        );
        vec2 pf = projectWorld(fc);
        float zf = max(worldToView(fc).z + u_camDist, 1.0);
        float fr = 0.55 * u_focalY / zf;
        float fruit = 1.0 - smoothstep(fr * 0.5, fr, length(ndc - pf));
        col = mix(col, mix(vec3(0.72, 0.18, 0.12), vec3(0.86, 0.52, 0.16), hash21(vec2(fi, 8.0))), fruit);
      }
    }
  }

  col = mix(col, vec3(0.012, 0.017, 0.030) + col.bgr * 0.09, u_night);
  gl_FragColor = vec4(col, 1.0);
}
`;

const BIRD_VERT = `
attribute vec2 a_corner;
attribute vec3 a_pos;
attribute vec3 a_vel;
attribute vec3 a_tint;
attribute vec4 a_meta; // phase, sizeNorm, kind, activity
uniform mat3 u_view;
uniform float u_camDist;
uniform float u_focalX;
uniform float u_focalY;
uniform float u_time;
uniform float u_wingHz;
uniform float u_reduced;
uniform float u_pulseT;
uniform vec2 u_resolution;
uniform vec2 u_viewOffset;
varying float vWing;
varying float vFade;
varying float vDepth;
varying vec2 vDir;
varying vec3 vTint;
varying vec2 vUv;
varying float vKind;
varying float vActivity;
void main() {
  vec3 p = u_view * a_pos;
  float z = max(p.z + u_camDist, 1.0);
  vec2 center = vec2(p.x * u_focalX / z, p.y * u_focalY / z) - u_viewOffset;

  // activities that live on the ground or water keep a side-on pose so the
  // silhouette reads as a bird, not a spray of wing strokes.
  float act = a_meta.w;
  float grounded = step(3.5, act) * (1.0 - step(9.5, act)) // perch..strut
                 + step(11.5, act) * (1.0 - step(12.5, act)) // display
                 + step(13.5, act); // stalk
  vec3 q = u_view * (a_pos + a_vel * 0.05);
  float z2 = max(q.z + u_camDist, 1.0);
  vec2 dir = vec2(q.x * u_focalX / z2, q.y * u_focalY / z2) - center;
  float L = length(dir);
  vec2 flyDir = L > 1e-5 ? dir / L : vec2(1.0, 0.0);
  float face = a_vel.x >= 0.0 ? 1.0 : -1.0;
  vDir = mix(flyDir, normalize(vec2(face, 0.12)), clamp(grounded, 0.0, 1.0));

  float sp = length(a_vel);
  float air = 1.0 - clamp(grounded, 0.0, 1.0);
  float ph = u_time * u_wingHz * (0.85 + sp * 0.04) + a_meta.x * 6.2831853;
  float pw = u_pulseT - (a_pos.x + ${WORLD_X.toFixed(1)}) / ${(WORLD_X * 2).toFixed(1)} * 0.42;
  float pulse = (pw > 0.0 && pw < 0.6) ? sin(pw * 11.0) * exp(-pw * 5.0) : 0.0;
  float beat = mix(0.55 + 0.45 * sin(ph), 0.62, u_reduced);
  // folded on the ground; open and beating in the air
  vWing = clamp(mix(0.12, beat, air) + pulse * 0.5 * air, 0.0, 1.15);
  vDepth = z;
  vFade = clamp(1.0 - (z - u_camDist) / 110.0, 0.28, 1.0);
  vTint = a_tint;
  vUv = a_corner;
  vKind = a_meta.z;
  vActivity = act;
  // birdPx is a HALF-extent in pixels, scaled by depth so nearer birds grow.
  float sizeNorm = clamp(a_meta.y, 0.0, 1.0);
  float birdPx = u_resolution.y * (0.025 + 0.14 * sizeNorm) * clamp(u_camDist * 0.92 / z, 0.45, 1.85);
  vec2 clipPx = vec2(2.0 / u_resolution.x, 2.0 / u_resolution.y);
  // real depth so nearer birds win the soft blend instead of stacking into mush
  float zNdc = clamp(z / (u_camDist + 120.0), 0.05, 0.98);
  gl_Position = vec4(center + a_corner * birdPx * clipPx, zNdc, 1.0);
}
`;

const BIRD_FRAG = `
precision mediump float;
varying float vWing;
varying float vFade;
varying float vDepth;
varying vec2 vDir;
varying vec3 vTint;
varying vec2 vUv;
varying float vKind;
varying float vActivity;
uniform vec3 u_ink;
uniform vec3 u_low;
uniform vec3 u_high;
uniform vec3 u_ground;
uniform vec2 u_res;
uniform float u_horizon;
uniform float u_haze;
uniform float u_night;
uniform float u_hazeFrom;

float ellipse(vec2 p, vec2 r) {
  return 1.0 - smoothstep(0.86, 1.01, length(p / max(r, vec2(0.001))));
}
float capsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return 1.0 - smoothstep(r * 0.9, r + 0.024, length(pa - ba * h));
}
// —— shared anatomy (every kind reuses these; species only customize placement) ——
float eyeDot(vec2 p, vec2 c, float s) {
  float ball = ellipse(p - c, vec2(s * 1.15, s));
  float pupil = ellipse(p - (c + vec2(s * 0.15, 0.0)), vec2(s * 0.45, s * 0.42));
  float glint = ellipse(p - (c + vec2(s * 0.28, s * 0.22)), vec2(s * 0.18, s * 0.16));
  return max(ball, max(pupil, glint * 0.7));
}
float featherBarb(vec2 p, vec2 root, vec2 tip, float w) {
  return capsule(p, root, tip, w);
}
// soft body ruffles along the breast / flank
float ruffle(vec2 p, vec2 c, float span, float amp) {
  float a = 0.0;
  for (float i = 0.0; i < 4.0; i += 1.0) {
    float t = (i + 0.5) / 4.0;
    vec2 o = c + vec2(-span * 0.5 + span * t, sin(t * 6.2831853 + amp) * 0.04 * amp);
    a = max(a, ellipse(p - o, vec2(0.055, 0.04)));
  }
  return a;
}
// hooked upper mandible — parrot / cockatiel
float hookedBeak(vec2 p, vec2 root, float len) {
  float upper = capsule(p, root, root + vec2(len, -0.02 * len), 0.045 * len / 0.22);
  float hook = capsule(p, root + vec2(len * 0.85, -0.01), root + vec2(len * 1.05, -0.12), 0.032);
  float lower = capsule(p, root + vec2(0.02, -0.04), root + vec2(len * 0.55, -0.06), 0.028);
  return max(upper, max(hook, lower));
}
// folded wing tucked against the body (perched) with soft primary tips
float foldedWing(vec2 p, float y) {
  float body = ellipse(p - vec2(-0.02, y), vec2(0.22, 0.11));
  float tip = featherBarb(p, vec2(-0.12, y - 0.02), vec2(-0.34, y - 0.08), 0.028);
  return max(body, tip);
}
// open flight wing — pointed (falcon) or broad (hawk), with primary notches
float flightWing(vec2 p, float side, float open, float pointed) {
  float o = clamp(open, 0.05, 1.2);
  vec2 tip = vec2(side * (0.22 + 0.55 * o), -0.02 - 0.18 * o * (1.0 - 0.35 * pointed));
  vec2 mid = vec2(side * (0.12 + 0.22 * o), 0.04 - 0.04 * o);
  float lobe = ellipse(p - mid, vec2(0.18 + 0.32 * o, 0.07 + 0.10 * o * (1.0 - 0.4 * pointed)));
  float edge = capsule(p, vec2(side * 0.06, 0.02), tip, 0.03 + 0.02 * (1.0 - pointed));
  // fingered primaries
  float fingers = 0.0;
  for (float i = 0.0; i < 3.0; i += 1.0) {
    float k = 0.55 + i * 0.14;
    vec2 ft = tip + vec2(side * 0.08 * o, (i - 1.0) * 0.05 * o);
    fingers = max(fingers, featherBarb(p, mid * k, ft, 0.018 + 0.01 * (1.0 - pointed)));
  }
  return max(lobe, max(edge, fingers));
}
float legPair(vec2 p, float stance, float thick) {
  float L = max(capsule(p, vec2(-0.06, -0.22), vec2(-0.08 - 0.04 * stance, -0.72), thick),
                capsule(p, vec2(0.08, -0.22), vec2(0.10 + 0.04 * stance, -0.72), thick));
  // three-toed feet
  L = max(L, capsule(p, vec2(-0.08 - 0.04 * stance, -0.72), vec2(-0.18 - 0.04 * stance, -0.78), thick * 0.65));
  L = max(L, capsule(p, vec2(-0.08 - 0.04 * stance, -0.72), vec2(-0.12 - 0.04 * stance, -0.82), thick * 0.55));
  L = max(L, capsule(p, vec2(0.10 + 0.04 * stance, -0.72), vec2(0.20 + 0.04 * stance, -0.78), thick * 0.65));
  L = max(L, capsule(p, vec2(0.10 + 0.04 * stance, -0.72), vec2(0.14 + 0.04 * stance, -0.82), thick * 0.55));
  return L;
}
// head anchor per kind — where the shared eye sits
vec2 headOf(float kind) {
  if (kind < 0.5) return vec2(0.30, 0.18);
  if (kind < 1.5) return vec2(0.24, 0.14);
  if (kind < 2.5) return vec2(0.48, 0.04);
  if (kind < 3.5) return vec2(0.42, 0.04);
  if (kind < 4.5) return vec2(0.42, 0.14);
  if (kind < 5.5) return vec2(0.28, 0.30);
  if (kind < 6.5) return vec2(0.30, 0.78);
  if (kind < 7.5) return vec2(0.26, 0.10);
  if (kind < 8.5) return vec2(0.22, 0.08);
  if (kind < 9.5) return vec2(0.12, 0.06);
  if (kind < 10.5) return vec2(0.36, 0.48);
  if (kind < 11.5) return vec2(0.36, 0.50);
  return vec2(0.22, 0.08);
}

float birdShape(vec2 p, float kind, float activity, float wing) {
  float swim = step(6.5, activity) * (1.0 - step(7.5, activity));
  float display = step(11.5, activity) * (1.0 - step(12.5, activity));
  float hover = step(12.5, activity) * (1.0 - step(13.5, activity));
  float dive = step(10.5, activity) * (1.0 - step(11.5, activity));
  float soar = step(9.5, activity) * (1.0 - step(10.5, activity));
  float open = clamp(wing, 0.0, 1.15);
  float air = max(open, max(dive, soar));
  float a = 0.0;

  // 0 parrot — stocky amazon: oversized head, deep hooked beak, short square tail
  if (kind < 0.5) {
    a = max(ellipse(p - vec2(-0.02, 0.0), vec2(0.30, 0.26)), capsule(p, vec2(0.12, 0.06), vec2(0.28, 0.14), 0.10));
    a = max(a, ellipse(p - vec2(0.30, 0.16), vec2(0.20, 0.19))); // big head
    a = max(a, hookedBeak(p, vec2(0.42, 0.10), 0.30));
    a = max(a, mix(foldedWing(p, -0.04), flightWing(p, 1.0, open, 0.15), air));
    a = max(a, mix(0.0, flightWing(p, -1.0, open * 0.65, 0.15), air));
    a = max(a, ellipse(p + vec2(0.32, 0.02), vec2(0.12, 0.09))); // short square tail
    a = max(a, legPair(p, 0.08, 0.026) * (1.0 - air * 0.85));
  }
  // 1 cockatiel — tall erect crest, long tapering tail (half the bird), small hook
  else if (kind < 1.5) {
    a = max(ellipse(p - vec2(0.02, 0.0), vec2(0.26, 0.20)), ellipse(p - vec2(0.22, 0.10), vec2(0.14, 0.13)));
    a = max(a, hookedBeak(p, vec2(0.32, 0.08), 0.16));
    // erect crest — three fingers, the cockatiel's signature
    a = max(a, capsule(p, vec2(0.16, 0.20), vec2(0.18, 0.66), 0.032));
    a = max(a, capsule(p, vec2(0.12, 0.22), vec2(0.02, 0.58), 0.024));
    a = max(a, capsule(p, vec2(0.20, 0.20), vec2(0.34, 0.56), 0.022));
    a = max(a, mix(foldedWing(p, 0.0), flightWing(p, 1.0, open, 0.35), air));
    a = max(a, capsule(p, vec2(-0.18, 0.0), vec2(-0.82, -0.08), 0.042)); // long tapering tail
    a = max(a, legPair(p, 0.0, 0.02) * (1.0 - air * 0.85));
  }
  // 2 falcon — bullet body, scythe wings, short pointed tail, malar slash
  else if (kind < 2.5) {
    float span = mix(0.5, 1.15, max(open, dive));
    a = max(ellipse(p - vec2(0.0, 0.0), vec2(0.40, 0.11)), capsule(p, vec2(0.32, 0.0), vec2(0.62, -0.01), 0.024));
    a = max(a, flightWing(p, 1.0, span, 1.0));
    a = max(a, flightWing(p, -1.0, span, 1.0));
    // primary tip slash — more scythe than paddle
    a = max(a, capsule(p, vec2(0.20, -0.02), vec2(0.20 + 0.70 * span, -0.22 * span), 0.02));
    a = max(a, capsule(p, vec2(-0.20, -0.02), vec2(-0.20 - 0.70 * span, -0.22 * span), 0.02));
    a = max(a, capsule(p, vec2(-0.32, 0.0), vec2(-0.62, 0.0), 0.022)); // pointed tail
    a = max(a, capsule(p, vec2(0.36, 0.02), vec2(0.46, -0.08), 0.016)); // malar
  }
  // 3 hawk — broad paddle wings, fanned rounded tail, bulkier torso
  else if (kind < 3.5) {
    float span = mix(0.55, 1.05, max(open, soar));
    a = max(ellipse(p - vec2(0.0, 0.0), vec2(0.38, 0.17)), capsule(p, vec2(0.30, 0.02), vec2(0.54, 0.0), 0.03));
    a = max(a, flightWing(p, 1.0, span, 0.08));
    a = max(a, flightWing(p, -1.0, span, 0.08));
    // fingered primaries (soft notches)
    a = max(a, capsule(p, vec2(0.25, 0.02), vec2(0.25 + 0.55 * span, 0.12), 0.028));
    a = max(a, capsule(p, vec2(-0.25, 0.02), vec2(-0.25 - 0.55 * span, 0.12), 0.028));
    // broad fan tail
    a = max(a, ellipse(p + vec2(0.42, 0.0), vec2(0.26, 0.14)));
    a = max(a, capsule(p, vec2(-0.24, 0.05), vec2(-0.58, 0.14), 0.032));
    a = max(a, capsule(p, vec2(-0.24, -0.05), vec2(-0.58, -0.14), 0.032));
  }
  // 4 duck — boat hull, flat spatulate bill, low waterline when swimming
  else if (kind < 4.5) {
    vec2 pp = p + vec2(0.0, swim * 0.14);
    a = max(ellipse(pp - vec2(0.0, 0.0), vec2(0.52, 0.20)), capsule(pp, vec2(0.28, 0.06), vec2(0.42, 0.12), 0.08));
    a = max(a, ellipse(pp - vec2(0.42, 0.12), vec2(0.14, 0.12))); // head
    // spatulate bill — wide and flat
    a = max(a, capsule(pp, vec2(0.50, 0.10), vec2(0.84, 0.08), 0.06));
    a = max(a, capsule(pp, vec2(0.50, 0.05), vec2(0.82, 0.03), 0.045));
    a = max(a, mix(foldedWing(pp, 0.02), flightWing(pp, 1.0, open, 0.4), air * (1.0 - swim)));
    a = max(a, ellipse(pp + vec2(0.42, 0.02), vec2(0.12, 0.07)));
    a *= mix(1.0, smoothstep(-0.36, -0.02, p.y), swim);
  }
  // 5 chicken — upright pear body, tall serrated comb, wattles, thick legs
  else if (kind < 5.5) {
    a = max(ellipse(p - vec2(-0.02, 0.02), vec2(0.32, 0.36)), capsule(p, vec2(0.14, 0.18), vec2(0.26, 0.28), 0.08));
    a = max(a, ellipse(p - vec2(0.28, 0.28), vec2(0.14, 0.13)));
    a = max(a, capsule(p, vec2(0.36, 0.22), vec2(0.54, 0.16), 0.032)); // short beak
    // tall serrated comb
    a = max(a, ellipse(p - vec2(0.18, 0.46), vec2(0.08, 0.12)));
    a = max(a, ellipse(p - vec2(0.10, 0.50), vec2(0.055, 0.10)));
    a = max(a, ellipse(p - vec2(0.26, 0.48), vec2(0.055, 0.09)));
    a = max(a, ellipse(p - vec2(0.32, 0.14), vec2(0.055, 0.08))); // wattle
    a = max(a, mix(foldedWing(p, 0.0), flightWing(p, 1.0, open * 0.45, 0.25), air));
    a = max(a, ellipse(p + vec2(0.24, -0.02), vec2(0.14, 0.12))); // arched tail
    a = max(a, legPair(p, 0.3, 0.034));
  }
  // 6 emu — tallest: tiny head on long S-neck, shaggy oval body, pillar legs
  else if (kind < 6.5) {
    a = max(ellipse(p - vec2(0.0, -0.06), vec2(0.26, 0.34)), capsule(p, vec2(0.08, 0.22), vec2(0.10, 0.52), 0.05));
    a = max(a, capsule(p, vec2(0.10, 0.52), vec2(0.22, 0.78), 0.042)); // long neck
    a = max(a, ellipse(p - vec2(0.30, 0.78), vec2(0.11, 0.08))); // small head
    a = max(a, capsule(p, vec2(0.38, 0.76), vec2(0.56, 0.74), 0.026)); // stubby bill
    a = max(a, ellipse(p - vec2(0.10, 0.02), vec2(0.16, 0.20))); // shaggy chest
    a = max(a, capsule(p, vec2(-0.08, -0.30), vec2(-0.12, -0.88), 0.036));
    a = max(a, capsule(p, vec2(0.10, -0.30), vec2(0.14, -0.88), 0.036));
    a = max(a, capsule(p, vec2(-0.12, -0.88), vec2(-0.24, -0.90), 0.02));
    a = max(a, capsule(p, vec2(0.14, -0.88), vec2(0.26, -0.90), 0.02));
  }
  // 7 finch — compact goldfinch: deep conical bill, notched short tail
  else if (kind < 7.5) {
    a = max(ellipse(p - vec2(0.0, 0.0), vec2(0.32, 0.24)), ellipse(p - vec2(0.24, 0.06), vec2(0.13, 0.12)));
    a = max(a, capsule(p, vec2(0.32, 0.04), vec2(0.60, 0.02), 0.05)); // deep cone
    a = max(a, capsule(p, vec2(0.32, 0.0), vec2(0.56, -0.02), 0.036));
    a = max(a, mix(foldedWing(p, -0.02), flightWing(p, 1.0, open, 0.45), air));
    a = max(a, mix(0.0, flightWing(p, -1.0, open * 0.75, 0.45), air));
    a = max(a, capsule(p, vec2(-0.24, 0.04), vec2(-0.50, 0.08), 0.028));
    a = max(a, capsule(p, vec2(-0.24, -0.04), vec2(-0.50, -0.08), 0.028));
    a = max(a, legPair(p, 0.0, 0.016) * (1.0 - air * 0.9));
  }
  // 8 sparrow — round neckless ball, stubby bill, short square tail
  else if (kind < 8.5) {
    a = max(ellipse(p - vec2(0.0, 0.0), vec2(0.34, 0.28)), ellipse(p - vec2(0.20, 0.04), vec2(0.15, 0.14)));
    a = max(a, capsule(p, vec2(0.30, 0.02), vec2(0.48, 0.0), 0.038)); // stubby
    a = max(a, mix(foldedWing(p, 0.0), flightWing(p, 1.0, open, 0.4), air));
    a = max(a, ellipse(p + vec2(0.26, 0.0), vec2(0.12, 0.07)));
    a = max(a, legPair(p, 0.15, 0.018) * (1.0 - air * 0.9));
  }
  // 9 hummingbird — extreme needle bill, tiny fuselage, hover blur disc
  else if (kind < 9.5) {
    a = max(ellipse(p - vec2(-0.02, 0.0), vec2(0.18, 0.11)), ellipse(p - vec2(0.12, 0.02), vec2(0.08, 0.07)));
    a = max(a, capsule(p, vec2(0.16, 0.02), vec2(0.92, 0.02), 0.014)); // extreme needle
    float blur = mix(0.6, 1.2, open);
    a = max(a, flightWing(p, 1.0, blur, 0.75));
    a = max(a, flightWing(p, -1.0, blur, 0.75));
    a = max(a, hover * ellipse(p - vec2(0.0, 0.0), vec2(0.78, 0.32)) * 0.3);
    a = max(a, capsule(p, vec2(-0.14, 0.0), vec2(-0.36, -0.02), 0.018));
  }
  // 10 scarlet ibis — extreme downcurved sickle bill, S-neck, stilt legs
  else if (kind < 10.5) {
    a = max(ellipse(p - vec2(-0.02, 0.0), vec2(0.26, 0.18)), capsule(p, vec2(0.14, 0.10), vec2(0.22, 0.32), 0.045));
    a = max(a, capsule(p, vec2(0.22, 0.32), vec2(0.32, 0.46), 0.038)); // S-neck
    a = max(a, ellipse(p - vec2(0.36, 0.46), vec2(0.10, 0.08)));
    // long sickle bill
    a = max(a, capsule(p, vec2(0.42, 0.44), vec2(0.62, 0.30), 0.028));
    a = max(a, capsule(p, vec2(0.62, 0.30), vec2(0.86, 0.02), 0.022));
    a = max(a, mix(foldedWing(p, 0.0), flightWing(p, 1.0, open, 0.35), air));
    a = max(a, air * capsule(p, vec2(0.16, -0.02), vec2(0.58, -0.20), 0.032));
    a = max(a, capsule(p, vec2(-0.06, -0.16), vec2(-0.10, -0.86), 0.02));
    a = max(a, capsule(p, vec2(0.08, -0.16), vec2(0.12, -0.86), 0.02));
    a = max(a, capsule(p, vec2(-0.10, -0.86), vec2(-0.22, -0.88), 0.014));
    a = max(a, capsule(p, vec2(0.12, -0.86), vec2(0.24, -0.88), 0.014));
  }
  // 11 peacock — slender blue neck + fan crest; train with eye spots when displayed
  else if (kind < 11.5) {
    float fan = mix(0.18, 1.0, max(display, 0.22));
    // upright train behind the body
    a = max(a, ellipse(p - vec2(-0.32, 0.12), vec2(0.55 * fan, 0.70 * fan)) * fan);
    for (float i = 0.0; i < 7.0; i += 1.0) {
      float ang = -1.15 + i * 0.38;
      vec2 ep = vec2(-0.32, 0.12) + vec2(cos(ang), sin(ang)) * (0.44 * fan);
      a = max(a, ellipse(p - ep, vec2(0.05, 0.06)) * fan * 0.92);
    }
    a = max(a, ellipse(p - vec2(0.04, -0.02), vec2(0.22, 0.16))); // compact body
    a = max(a, capsule(p, vec2(0.18, 0.08), vec2(0.30, 0.46), 0.036)); // long blue neck
    a = max(a, ellipse(p - vec2(0.36, 0.48), vec2(0.08, 0.07)));
    // wire crest with tip dots
    a = max(a, capsule(p, vec2(0.32, 0.52), vec2(0.26, 0.74), 0.012));
    a = max(a, capsule(p, vec2(0.36, 0.52), vec2(0.40, 0.74), 0.012));
    a = max(a, capsule(p, vec2(0.34, 0.52), vec2(0.34, 0.76), 0.01));
    a = max(a, ellipse(p - vec2(0.26, 0.76), vec2(0.03, 0.03)));
    a = max(a, ellipse(p - vec2(0.40, 0.76), vec2(0.03, 0.03)));
    a = max(a, ellipse(p - vec2(0.34, 0.78), vec2(0.03, 0.03)));
    a = max(a, capsule(p, vec2(0.40, 0.46), vec2(0.56, 0.44), 0.024));
    a = max(a, legPair(p, 0.18, 0.022));
  }
  // 12 bird of paradise — compact dark body, streaming flank wires + gold cape
  else {
    a = max(ellipse(p - vec2(0.02, 0.0), vec2(0.24, 0.15)), ellipse(p - vec2(0.20, 0.05), vec2(0.12, 0.11)));
    a = max(a, capsule(p, vec2(0.26, 0.04), vec2(0.52, 0.02), 0.026));
    float plume = max(display, 0.55);
    a = max(a, capsule(p, vec2(-0.06, 0.06), vec2(-0.58, 0.62), 0.048) * plume);
    a = max(a, capsule(p, vec2(-0.08, -0.02), vec2(-0.78, -0.48), 0.052) * plume);
    a = max(a, capsule(p, vec2(-0.04, 0.02), vec2(-0.52, 0.32), 0.032) * plume);
    // wiry racket-tipped wires
    a = max(a, capsule(p, vec2(-0.18, -0.04), vec2(-0.78, -0.20), 0.012));
    a = max(a, capsule(p, vec2(-0.16, 0.04), vec2(-0.72, 0.16), 0.01));
    a = max(a, ellipse(p - vec2(-0.80, -0.20), vec2(0.045, 0.032)));
    a = max(a, ellipse(p - vec2(-0.74, 0.16), vec2(0.04, 0.03)));
    a = max(a, mix(foldedWing(p, 0.0), flightWing(p, 1.0, open, 0.5), air));
    a = max(a, mix(0.0, flightWing(p, -1.0, open * 0.5, 0.5), air));
  }

  // —— shared life: eye + breast ruffles on every kind ——
  vec2 head = headOf(kind);
  float eyeS = kind < 6.5 && kind > 5.5 ? 0.035 : (kind < 9.5 && kind > 8.5 ? 0.028 : 0.04);
  a = max(a, eyeDot(p, head + vec2(0.02, 0.02), eyeS));
  // ruffles sit on the breast for grounded poses; quieter in flight
  float ruf = ruffle(p, vec2(-0.02, -0.06), 0.28, 0.7 + open * 0.4);
  a = max(a, ruf * mix(0.85, 0.35, air));
  return clamp(a, 0.0, 1.0);
}

// species marks painted in local bird space — beak, comb, cheek, train, cape…
// shared: eye paint + feather sheen; custom: everything that names the species
vec3 speciesInk(vec2 p, float kind, float activity, vec3 base) {
  vec3 c = base;
  float display = step(11.5, activity) * (1.0 - step(12.5, activity));
  // feather sheen — cool rim along the upper mantle (shared)
  float sheen = smoothstep(0.18, 0.02, abs(p.y - 0.08)) * smoothstep(0.35, -0.05, p.x);
  c = mix(c, c * 1.25 + vec3(0.04, 0.05, 0.06), sheen * 0.35);
  if (kind < 0.5) {
    // parrot: warm horn beak + cheek blush
    float beak = smoothstep(0.42, 0.55, p.x) * smoothstep(0.22, -0.05, abs(p.y - 0.04));
    float cheek = ellipse(p - vec2(0.22, 0.08), vec2(0.10, 0.08));
    c = mix(c, vec3(0.92, 0.72, 0.18), clamp(beak, 0.0, 1.0) * 0.85);
    c = mix(c, vec3(0.85, 0.35, 0.22), cheek * 0.55);
  } else if (kind < 1.5) {
    // cockatiel: orange cheek patch, grey wash on body, cream face
    float cheek = ellipse(p - vec2(0.20, 0.06), vec2(0.09, 0.08));
    float face = smoothstep(0.05, 0.28, p.x) * smoothstep(0.28, 0.0, abs(p.y - 0.08));
    c = mix(c, vec3(0.78, 0.78, 0.76), (1.0 - face) * 0.35);
    c = mix(c, vec3(0.95, 0.55, 0.18), cheek * 0.9);
  } else if (kind < 2.5) {
    // falcon: darker hood / malar
    float hood = smoothstep(0.18, 0.45, p.x) * smoothstep(0.18, 0.0, abs(p.y));
    c = mix(c, vec3(0.18, 0.18, 0.20), hood * 0.55);
  } else if (kind < 3.5) {
    // hawk: rusty fan tail
    float tail = smoothstep(-0.15, -0.45, p.x);
    c = mix(c, vec3(0.78, 0.32, 0.12), tail * 0.7);
  } else if (kind < 4.5) {
    // mallard: green head, yellow bill, chestnut breast wash
    float head = smoothstep(0.22, 0.48, p.x);
    float bill = smoothstep(0.50, 0.70, p.x);
    float breast = smoothstep(0.18, -0.05, p.x) * smoothstep(0.22, -0.05, abs(p.y + 0.02));
    c = mix(c, vec3(0.08, 0.48, 0.28), head * 0.75);
    c = mix(c, vec3(0.92, 0.78, 0.18), bill * 0.9);
    c = mix(c, vec3(0.55, 0.28, 0.14), breast * 0.45);
  } else if (kind < 5.5) {
    // chicken: scarlet comb + wattle
    float comb = smoothstep(0.28, 0.48, p.y) * smoothstep(0.28, 0.0, abs(p.x - 0.14));
    float watt = ellipse(p - vec2(0.30, 0.12), vec2(0.07, 0.08));
    c = mix(c, vec3(0.86, 0.12, 0.12), clamp(comb + watt, 0.0, 1.0) * 0.95);
  } else if (kind < 6.5) {
    // emu: slightly paler neck, darker shaggy body
    float neck = smoothstep(0.25, 0.65, p.y);
    c = mix(c, vec3(0.55, 0.48, 0.40), neck * 0.4);
  } else if (kind < 7.5) {
    // goldfinch: black cap, warm yellow body already in base
    float cap = smoothstep(0.08, 0.22, p.y) * smoothstep(0.22, 0.40, p.x);
    c = mix(c, vec3(0.08, 0.07, 0.08), cap * 0.85);
  } else if (kind < 8.5) {
    // house sparrow: grey cheek, darker bib
    float bib = ellipse(p - vec2(0.18, -0.02), vec2(0.10, 0.08));
    c = mix(c, vec3(0.22, 0.18, 0.16), bib * 0.55);
  } else if (kind < 9.5) {
    // hummingbird: brighter throat flash + dark needle
    float throat = ellipse(p - vec2(0.10, -0.02), vec2(0.10, 0.07));
    float bill = smoothstep(0.28, 0.55, p.x);
    c = mix(c, vec3(0.15, 0.85, 0.55), throat * 0.7);
    c = mix(c, vec3(0.12, 0.12, 0.14), bill * 0.8);
  } else if (kind < 10.5) {
    // scarlet ibis: inky primary tip
    float tip = smoothstep(0.25, 0.55, p.x) * smoothstep(0.05, -0.25, p.y);
    c = mix(c, vec3(0.08, 0.06, 0.08), tip * 0.85);
  } else if (kind < 11.5) {
    // peacock: green-bronze train + bright eye spots; keep teal on neck/head
    float train = smoothstep(0.05, -0.25, p.x);
    float neck = smoothstep(0.15, 0.45, p.y) * smoothstep(0.05, 0.35, p.x);
    c = mix(c, vec3(0.12, 0.48, 0.28), train * 0.75);
    c = mix(c, vec3(0.05, 0.42, 0.55), neck * 0.85);
    // eye-spot discs (blue ring, gold pupil)
    float fan = mix(0.18, 1.0, max(display, 0.22));
    for (float i = 0.0; i < 7.0; i += 1.0) {
      float ang = -1.15 + i * 0.38;
      vec2 ep = vec2(-0.32, 0.12) + vec2(cos(ang), sin(ang)) * (0.44 * fan);
      float spot = ellipse(p - ep, vec2(0.05, 0.06));
      c = mix(c, vec3(0.12, 0.48, 0.78), spot * fan * 0.9);
      c = mix(c, vec3(0.95, 0.82, 0.22), ellipse(p - ep, vec2(0.02, 0.024)) * fan);
    }
  } else {
    // bird of paradise: gold cape / flank plumes on velvet body
    float cape = max(capsule(p, vec2(-0.08, 0.04), vec2(-0.55, 0.55), 0.06),
                     max(capsule(p, vec2(-0.10, -0.02), vec2(-0.72, -0.42), 0.06),
                         capsule(p, vec2(-0.06, 0.0), vec2(-0.48, 0.28), 0.04)));
    c = mix(c, vec3(0.92, 0.72, 0.18), cape * 0.92);
  }
  // eye paint — dark pupil, warm glint (shared; headOf places it)
  vec2 head = headOf(kind);
  vec2 ec = head + vec2(0.02, 0.02);
  float eyeS = kind < 6.5 && kind > 5.5 ? 0.035 : (kind < 9.5 && kind > 8.5 ? 0.028 : 0.04);
  float ball = ellipse(p - ec, vec2(eyeS * 1.15, eyeS));
  float pupil = ellipse(p - (ec + vec2(eyeS * 0.15, 0.0)), vec2(eyeS * 0.45, eyeS * 0.42));
  float glint = ellipse(p - (ec + vec2(eyeS * 0.28, eyeS * 0.22)), vec2(eyeS * 0.18, eyeS * 0.16));
  c = mix(c, vec3(0.92, 0.90, 0.86), ball * 0.55);
  c = mix(c, vec3(0.05, 0.05, 0.06), pupil);
  c = mix(c, vec3(1.0, 0.98, 0.92), glint);
  return c;
}

void main() {
  // rotate local bird space so +x is heading (beak)
  vec2 q = vec2(vUv.x * vDir.x + vUv.y * vDir.y, -vUv.x * vDir.y + vUv.y * vDir.x);
  float a = birdShape(q, vKind, vActivity, vWing);
  if (a < 0.16) discard;
  vec3 ink = mix(u_ink, speciesInk(q, vKind, vActivity, vTint), 0.94);
  ink = mix(ink, ink * 0.6 + vec3(0.05, 0.055, 0.07), u_night * 0.8);
  float hb = clamp(gl_FragCoord.y / u_res.y, 0.0, 1.0) - u_horizon;
  vec3 back = hb >= 0.0
    ? mix(u_low, u_high, smoothstep(0.0, 0.48, hb))
    : mix(u_low, u_ground, smoothstep(0.0, 0.34, -hb));
  float haze = clamp((vDepth - u_hazeFrom) / 180.0, 0.0, 1.0) * u_haze * 0.22;
  float rim = smoothstep(0.14, 0.32, a) * (1.0 - smoothstep(0.40, 0.76, a));
  vec3 col = mix(ink, back, haze);
  col = mix(col, col * 0.28, rim * 0.85);
  col += vTint * (1.0 - rim) * 0.08;
  gl_FragColor = vec4(col, clamp(a * vFade * 1.06, 0.0, 1.0));
}
`;

export default function Murmuration() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const [noGl, setNoGl] = useState(false);
  const letGoRef = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const glOpts: WebGLContextAttributes = {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    };
    const gl2 = canvas.getContext("webgl2", glOpts) as WebGL2RenderingContext | null;
    const gl = (gl2 ||
      canvas.getContext("webgl", glOpts) ||
      canvas.getContext("experimental-webgl" as "webgl", glOpts)) as WebGLRenderingContext | null;
    const angle = !gl2 && gl ? gl.getExtension("ANGLE_instanced_arrays") : null;
    if (!gl || (!gl2 && !angle)) {
      setNoGl(true);
      return;
    }
    const divisor = (loc: number, d: number) => {
      if (loc < 0) return;
      if (gl2) gl2.vertexAttribDivisor(loc, d);
      else angle?.vertexAttribDivisorANGLE(loc, d);
    };
    const drawInstanced = (instances: number) => {
      if (gl2) gl2.drawArraysInstanced(gl2.TRIANGLE_STRIP, 0, 4, instances);
      else angle?.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, instances);
    };

    const audio = getFieldAudio();
    const register = spectralRegisterFor(BAND_S);
    // The shared room runtime: one governor for the frame, one tier for the
    // resolution and the population, and no flock flying in a hidden tab.
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let paused = false;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;
    const onMq = () => {
      reduced = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    // ——— the kept character ———
    let cleared = false;
    let char: Character = { ...WILD };
    let season = 0;
    let yaw = 0;
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Stored;
        cleared = p.cleared === true;
        if (!cleared) {
          char = {
            sep: clamp(Number(p.sep) || WILD.sep, 0.15, 2),
            ali: clamp(Number(p.ali) || WILD.ali, 0.15, 2),
            coh: clamp(Number(p.coh) || WILD.coh, 0.15, 2),
          };
          season = seasonIndex(Number(p.season) || 0);
          yaw = Number(p.yaw) || 0;
          setHasKept(true);
        }
      }
    } catch {
      /* a wild flock */
    }

    let saveAt = 0;
    const save = (now: number, force = false) => {
      if (!force && now - saveAt < 700) return;
      saveAt = now;
      cleared = false;
      try {
        const payload: Stored = { ...char, season, yaw, cleared: false };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* noop */
      }
      setHasKept(true);
    };

    // ——— the sky ———
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let aspect = 1;
    let focalX = 1.9;
    const focalY = 1.9;

    const compile = (type: number, src: string, label: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn(`[birds] ${label} compile`, gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const link = (vsrc: string, fsrc: string, label: string) => {
      const vs = compile(gl.VERTEX_SHADER, vsrc, `${label} vert`);
      const fs = compile(gl.FRAGMENT_SHADER, fsrc, `${label} frag`);
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      if (!prog) return null;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn(`[birds] ${label} link`, gl.getProgramInfoLog(prog));
        return null;
      }
      return prog;
    };

    const skyProg = link(SKY_VERT, SKY_FRAG, "sky");
    const birdProg = link(BIRD_VERT, BIRD_FRAG, "bird");
    if (!skyProg || !birdProg) {
      setNoGl(true);
      return;
    }

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const uSky = {
      pos: gl.getAttribLocation(skyProg, "a_pos"),
      low: gl.getUniformLocation(skyProg, "u_low"),
      high: gl.getUniformLocation(skyProg, "u_high"),
      ground: gl.getUniformLocation(skyProg, "u_ground"),
      sunTint: gl.getUniformLocation(skyProg, "u_sunTint"),
      sun: gl.getUniformLocation(skyProg, "u_sun"),
      aspect: gl.getUniformLocation(skyProg, "u_aspect"),
      roll: gl.getUniformLocation(skyProg, "u_roll"),
      horizon: gl.getUniformLocation(skyProg, "u_horizon"),
      breath: gl.getUniformLocation(skyProg, "u_breath"),
      time: gl.getUniformLocation(skyProg, "u_time"),
      viewOffset: gl.getUniformLocation(skyProg, "u_viewOffset"),
      night: gl.getUniformLocation(skyProg, "u_night"),
      view: gl.getUniformLocation(skyProg, "u_view"),
      camDist: gl.getUniformLocation(skyProg, "u_camDist"),
      focalX: gl.getUniformLocation(skyProg, "u_focalX"),
      focalY: gl.getUniformLocation(skyProg, "u_focalY"),
    };
    const uBird = {
      corner: gl.getAttribLocation(birdProg, "a_corner"),
      pos: gl.getAttribLocation(birdProg, "a_pos"),
      vel: gl.getAttribLocation(birdProg, "a_vel"),
      tint: gl.getAttribLocation(birdProg, "a_tint"),
      meta: gl.getAttribLocation(birdProg, "a_meta"),
      view: gl.getUniformLocation(birdProg, "u_view"),
      camDist: gl.getUniformLocation(birdProg, "u_camDist"),
      focalX: gl.getUniformLocation(birdProg, "u_focalX"),
      focalY: gl.getUniformLocation(birdProg, "u_focalY"),
      time: gl.getUniformLocation(birdProg, "u_time"),
      wingHz: gl.getUniformLocation(birdProg, "u_wingHz"),
      reduced: gl.getUniformLocation(birdProg, "u_reduced"),
      pulseT: gl.getUniformLocation(birdProg, "u_pulseT"),
      resolution: gl.getUniformLocation(birdProg, "u_resolution"),
      viewOffset: gl.getUniformLocation(birdProg, "u_viewOffset"),
      ink: gl.getUniformLocation(birdProg, "u_ink"),
      low: gl.getUniformLocation(birdProg, "u_low"),
      high: gl.getUniformLocation(birdProg, "u_high"),
      ground: gl.getUniformLocation(birdProg, "u_ground"),
      horizon: gl.getUniformLocation(birdProg, "u_horizon"),
      res: gl.getUniformLocation(birdProg, "u_res"),
      haze: gl.getUniformLocation(birdProg, "u_haze"),
      night: gl.getUniformLocation(birdProg, "u_night"),
      hazeFrom: gl.getUniformLocation(birdProg, "u_hazeFrom"),
    };

    // ——— the flock ———
    // The room is an aviary now: readable individuals at human scale. The
    // murmuration laws still live in flock.ts for high-count tests, but the
    // component never asks the screen for thousands of dots.
    const state = seedAviary(SKY_SEED, 0.25, season) as FlockState;
    let drawn = state.n;
    const meta = new Float32Array(AVIARY_MAX * 4);
    const writeMeta = () => {
      for (let i = 0; i < state.n; i++) {
        meta[i * 4] = state.bird[i * 2];
        meta[i * 4 + 1] = clamp01((state.bird[i * 2 + 1] - SIZE_MIN) / (SIZE_MAX - SIZE_MIN));
        meta[i * 4 + 2] = state.kindOf[i];
        meta[i * 4 + 3] = state.activityOf[i];
      }
    };
    writeMeta();

    const cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.pos, gl.DYNAMIC_DRAW);
    const velBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, velBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.vel, gl.DYNAMIC_DRAW);
    const tintBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.tint, gl.DYNAMIC_DRAW);
    const metaBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, metaBuf);
    gl.bufferData(gl.ARRAY_BUFFER, meta, gl.DYNAMIC_DRAW);

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = resolveDpr(gov.tier(), { embedded, reducedMotion: reduced });
      width = Math.max(240, r.width);
      height = Math.max(320, r.height);
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
      aspect = width / height;
      // portrait narrows the view rather than squeezing the sky flat
      focalX = focalY / Math.max(aspect, 0.62);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    // ——— the room's live state ———
    let raf = 0;
    let last = performance.now();
    let visualT = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    // look slightly into the meadow so the ground plane and grass blades read
    let pitch = -0.10;
    let pitchTarget = -0.10;
    let yawVel = 0;
    let lastCardinal = Math.round(yaw / (Math.PI / 2));
    let roll = 0;
    let rollTarget = 0;
    let viewOffsetX = 0;
    let viewOffsetY = 0;
    let viewOffsetTX = 0;
    let viewOffsetTY = 0;
    let night = 0;
    let nightTarget = 0;
    let soften = 0;
    let softenTarget = 0;
    const wind = { x: 0, y: 0, z: 0 };
    const tiltWind = { x: 0, y: 0, z: 0 };
    const handWind = { x: 0, y: 0, z: 0 };
    const lure = { x: 0, y: 0, z: 0 };
    let lurePull = 0;
    let lurePullTarget = 0;
    let swirl = 0;
    let scatter = 0;
    let gather = 0;
    let wingHz = 7.2;
    let wingHzTarget = 7.2;
    let order = 0;
    let seasonBlend = season;
    let pulseT = -1;
    let lastCallAt = 0;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let kbCharge = 0;
    let energy = 0; // reduced-motion budget: the sky moves when a hand asks
    let leaving = 0;
    let lastDeathAt = 0;
    let uploaded = false;
    let metaDirty = true;
    const low = [...SEASON_SKY[seasonIndex(season)].low];
    const high = [...SEASON_SKY[seasonIndex(season)].high];
    const sunTint = [...SEASON_SKY[seasonIndex(season)].sun];

    const viewM = new Float32Array(9);
    const setView = () => {
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      // column-major Rx(pitch)·Ry(yaw)
      viewM[0] = cy;
      viewM[1] = sp * sy;
      viewM[2] = -cp * sy;
      viewM[3] = 0;
      viewM[4] = cp;
      viewM[5] = sp;
      viewM[6] = sy;
      viewM[7] = -sp * cy;
      viewM[8] = cp * cy;
    };

    /** A point on the screen, read back onto the plane the flock sits in. */
    const screenToWorld = (cx: number, cy: number) => {
      const nx = ((cx - rectLeft) / Math.max(1, width)) * 2 - 1 + viewOffsetX;
      const ny = 1 - ((cy - rectTop) / Math.max(1, height)) * 2 + viewOffsetY;
      const vx = (nx * CAM_DIST) / focalX;
      const vy = (ny * CAM_DIST) / focalY;
      const cyw = Math.cos(yaw);
      const syw = Math.sin(yaw);
      const cpw = Math.cos(pitch);
      const spw = Math.sin(pitch);
      return {
        x: clamp(cyw * vx + spw * syw * vy, -WORLD_X, WORLD_X),
        y: clamp(cpw * vy, -WORLD_Y, WORLD_Y),
        z: clamp(syw * vx - spw * cyw * vy, -WORLD_Z, WORLD_Z),
      };
    };

    /**
     * Where the sun stands, projected through the same camera as the birds —
     * so turning the observer swings it across the sky and off the edge, and
     * the season carries it round the year.
     */
    const sunScreen = () => {
      const az = (seasonBlend / SEASONS) * Math.PI * 2 + 0.7;
      const alt = -0.05 - 0.02 * Math.cos((seasonBlend / SEASONS) * Math.PI * 2);
      const r = 900;
      const d = {
        x: Math.sin(az) * Math.cos(alt) * r,
        y: Math.sin(alt) * r,
        z: Math.cos(az) * Math.cos(alt) * r,
      };
      const px = viewM[0] * d.x + viewM[3] * d.y + viewM[6] * d.z;
      const py = viewM[1] * d.x + viewM[4] * d.y + viewM[7] * d.z;
      const pz = viewM[2] * d.x + viewM[5] * d.y + viewM[8] * d.z + CAM_DIST;
      if (pz < 40) return { x: 0.5, y: -2, v: 0 };
      return {
        x: ((px * focalX) / pz) * 0.5 + 0.5,
        y: ((py * focalY) / pz) * 0.5 + 0.5,
        v: clamp01((pz - 40) / 260),
      };
    };

    /** Where the camera's own level falls on the screen. */
    const horizonUv = () => clamp(0.5 - Math.sin(pitch) * focalY * 0.5, -0.4, 1.4);

    // ——— sound: the order, heard ———
    /**
     * The flock's call. The partial stack IS the order parameter: one long
     * ringing fundamental when the sky is one animal, a spray of stretched,
     * staggered partials when it is not. Nothing here is decorative — the
     * interval between the first two partials reads the order straight back.
     */
    const call = (gain = 1) => {
      const amps = partialsForOrder(order);
      let sounded = 0;
      for (let k = 0; k < PARTIALS && sounded < 4; k++) {
        const a = amps[k];
        if (a < 0.22) continue;
        sounded += 1;
        const hz = partialFreq(register.baseHz, k + 1, order);
        const dur = (0.1 + a * 0.62) * gain;
        const stagger = k * 46 * (1 - order);
        if (stagger < 1) audio.playTone(hz, dur);
        else window.setTimeout(() => audio.playTone(hz, dur), stagger);
      }
    };

    /** One wave of wingbeats crossing the sky, west to east. */
    const pulse = () => {
      pulseT = 0;
    };

    const startle = (p: { x: number; y: number; z: number }, strength: number) => {
      lure.x = p.x;
      lure.y = p.y;
      lure.z = p.z;
      lurePull = -strength;
      lurePullTarget = 0;
    };

    const activityOf = (name: (typeof ACTIVITIES)[number]) => ACTIVITIES.indexOf(name);
    const kindOf = (i: number): BirdKind => BIRD_KINDS[state.kindOf[i]] as BirdKind;
    const setBirdActivity = (i: number, activity: (typeof ACTIVITIES)[number]) => {
      if (i < 0 || i >= state.n) return;
      state.activityOf[i] = activityOf(activity);
      state.eatProgress[i] = activity === "eat" ? Math.max(state.eatProgress[i], 0.5) : state.eatProgress[i] * 0.6;
      metaDirty = true;
    };

    const birdScreen = (i: number) => {
      const x = state.pos[i * 3];
      const y = state.pos[i * 3 + 1];
      const z = state.pos[i * 3 + 2];
      const px = viewM[0] * x + viewM[3] * y + viewM[6] * z;
      const py = viewM[1] * x + viewM[4] * y + viewM[7] * z;
      const pz = viewM[2] * x + viewM[5] * y + viewM[8] * z + CAM_DIST;
      if (pz < 1) return null;
      const cx = ((px * focalX) / pz - viewOffsetX) * 0.5 + 0.5;
      const cy = 0.5 - (((py * focalY) / pz - viewOffsetY) * 0.5);
      const sizeNorm = clamp01((state.bird[i * 2 + 1] - SIZE_MIN) / (SIZE_MAX - SIZE_MIN));
      return {
        x: cx * width,
        y: cy * height,
        z: pz,
        r: height * (0.025 + 0.14 * sizeNorm) * 0.55,
      };
    };

    const birdAtScreen = (clientX: number, clientY: number) => {
      const sx = clientX - rectLeft;
      const sy = clientY - rectTop;
      let best = -1;
      let bestScore = Infinity;
      setView();
      for (let i = 0; i < state.n; i++) {
        const p = birdScreen(i);
        if (!p) continue;
        const dx = p.x - sx;
        const dy = p.y - sy;
        const d2 = dx * dx + dy * dy;
        const r = Math.max(28, p.r);
        if (d2 <= r * r && d2 + p.z * 0.02 < bestScore) {
          bestScore = d2 + p.z * 0.02;
          best = i;
        }
      }
      return best;
    };

    const chirp = (i: number, gain = 1) => {
      const kind = i >= 0 ? kindOf(i) : "finch";
      const sp = BIRD_SPECIES[kind];
      const scale = clamp(state.bird[Math.max(0, i) * 2 + 1] || sp.size, SIZE_MIN, SIZE_MAX);
      try {
        audio.playTone(register.baseHz * (1.2 + (1.8 - scale) * 0.45), 0.12 * gain);
      } catch {
        /* noop */
      }
    };

    const reactBird = (i: number, at: { x: number; y: number; z: number }, intensity: number) => {
      if (i < 0 || i >= state.n) return false;
      const kind = kindOf(i);
      if (kind === "hummingbird") setBirdActivity(i, "hover");
      else if (kind === "peacock" || kind === "bird-of-paradise") setBirdActivity(i, "display");
      else if (kind === "duck") setBirdActivity(i, "swim");
      else if (kind === "hawk" || kind === "falcon") setBirdActivity(i, intensity > 0.55 ? "dive" : "soar");
      else if (kind === "chicken" || kind === "sparrow" || kind === "finch") setBirdActivity(i, "hop");
      else if (kind === "emu" || kind === "red-ibis") setBirdActivity(i, "stalk");
      else if (kind === "parrot" || kind === "cockatiel") setBirdActivity(i, "perch");
      state.vel[i * 3] += (state.pos[i * 3] - at.x) * 0.22;
      state.vel[i * 3 + 1] += 2.2 + intensity * 2.4;
      state.vel[i * 3 + 2] += (state.pos[i * 3 + 2] - at.z) * 0.22;
      chirp(i, 0.9 + intensity * 0.5);
      try {
        haptics.ripple(0.35 + intensity * 0.35);
      } catch {
        /* noop */
      }
      return true;
    };

    const spawnAt = (at: { x: number; y: number; z: number }, kind?: BirdKind) => {
      const i = spawnBird(state, kind, at);
      if (i < 0) return -1;
      metaDirty = true;
      uploaded = false;
      drawn = state.n;
      chirp(i, 1.3);
      try {
        haptics.bloom();
      } catch {
        /* noop */
      }
      return i;
    };

    const cullAt = (i: number) => {
      const gone = cullBird(state, i);
      if (gone >= 0) {
        metaDirty = true;
        uploaded = false;
        drawn = state.n;
        try {
          audio.thud();
          haptics.roll();
        } catch {
          /* noop */
        }
      }
      return gone;
    };

    let breathStop: (() => void) | null = null;
    const armVessel = () => {
      void requestVessel().catch(() => {
        /* unavailable */
      });
    };
    const armBreath = async () => {
      if (breathStop) return;
      const stop = await enableBreath({
        breath: ({ strength }) => {
          softenTarget = Math.max(softenTarget, strength);
          wingHzTarget = clamp(wingHzTarget - strength * 2.5, 2.4, 13);
          try {
            audio.playTone(register.baseHz * (0.5 + strength * 0.2), 0.2);
          } catch {
            /* noop */
          }
        },
      });
      if (stop) breathStop = stop;
    };

    // ——— the grammar ———
    // On the canvas, not the wrapper (RoomTemplate §3): the engine takes
    // pointer capture on whatever it is mounted to, and a wrapper that owns
    // the capture eats the quiet clear's own click.
    const detach = attachGestures(
      canvas,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          armVessel();
          if (e.fingers === 2) return; // ScaleTravel's step back
          if (e.fingers === 3) {
            // tutti: the whole sky answers at once
            pulse();
            call(1.5);
            stirTurbulence(0.08);
            try {
              haptics.ripple(0.45);
            } catch {
              /* noop */
            }
            return;
          }
          if (e.fingers !== 1) return;
          const at = screenToWorld(e.x, e.y);
          if (e.count >= 3) {
            const hit = birdAtScreen(e.x, e.y);
            if (hit >= 0) cullAt(hit);
            else {
              clearBirds(state);
              metaDirty = true;
              uploaded = false;
              drawn = state.n;
              leaving = Math.max(leaving, 0.75);
              try {
                audio.thud();
                haptics.roll();
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (e.count === 2) {
            spawnAt(at);
            stirTurbulence(0.05);
            return;
          }
          const hit = birdAtScreen(e.x, e.y);
          if (hit >= 0 && reactBird(hit, at, e.intensity)) return;
          // one finger in the air: the birds nearest it break away —
          // residents flush into flight, the murmuration startles.
          flushNear(state, at, 10 + e.intensity * 8);
          startle(at, 26 + e.intensity * 60);
          call(0.7 + e.intensity * 0.5);
          try {
            haptics.tap();
          } catch {
            /* noop */
          }
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          if (e.phase === "enter") armVessel();
          if (e.fingers === 3) {
            if (e.phase === "enter") {
              timeScaleTarget = 0.25;
              try {
                audio.playTone(register.baseHz / 4, 0.7);
                haptics.tap();
              } catch {
                /* noop */
              }
            }
            if (e.phase === "release") timeScaleTarget = 1;
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "release") {
            lurePullTarget = 0;
            gather = 0;
            return;
          }
          if (e.tier >= 3) void armBreath();
          const p = screenToWorld(e.x, e.y);
          lure.x = p.x;
          lure.y = p.y;
          lure.z = p.z;
          if (state.n <= 0) {
            spawnAt(p);
            return;
          }
          const held = birdAtScreen(e.x, e.y);
          if (held >= 0) {
            setBirdActivity(held, "eat");
            state.bird[held * 2 + 1] = clamp(state.bird[held * 2 + 1] + (e.elapsed / 2500) * 0.004, SIZE_MIN, SIZE_MAX);
            state.eatProgress[held] = clamp01(state.eatProgress[held] + 0.08);
            metaDirty = true;
            if (e.phase === "enter") chirp(held, 0.8);
          }
          // A dwell on the meadow roosts the nearest bird; the longer hold
          // still gathers the murmuration onto the hand.
          if (held < 0 && e.phase === "enter" && e.tier >= 1) {
            roostNearest(state, p);
            metaDirty = true;
            try {
              haptics.ripple(0.4);
            } catch {
              /* noop */
            }
          }
          // Duration is an axis: the longer the hand waits, the harder the
          // flock comes in, and past the ceremony it settles onto the hand.
          gather = clamp01(e.elapsed / 2500);
          lurePullTarget = 4 + gather * 26;
          if (e.tier >= 3 && gather >= 1 && e.phase === "tick") {
            char.ali = clamp(char.ali + 0.006, 0.15, 2);
            char.coh = clamp(char.coh + 0.006, 0.15, 2);
            save(performance.now());
            if (order > 0.86 && performance.now() - lastCallAt > 500) {
              lastCallAt = performance.now();
              call(1.6);
              try {
                haptics.bloom();
              } catch {
                /* noop */
              }
            }
          }
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          if (e.fingers === 3) {
            // the world-law, for a hand with no gyroscope: the wind itself
            handWind.x = clamp(handWind.x + e.dx * 0.02, -WIND_MAX, WIND_MAX);
            handWind.z = clamp(handWind.z + e.dy * 0.02, -WIND_MAX, WIND_MAX);
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "end") {
            lurePullTarget = 0;
            return;
          }
          // a hand drawn through the aviary steers the wind and pushes aside
          // whatever it crosses.
          handWind.x = clamp(handWind.x + e.dx * 0.012, -WIND_MAX, WIND_MAX);
          handWind.z = clamp(handWind.z + e.dy * 0.012, -WIND_MAX, WIND_MAX);
          const p = screenToWorld(e.x, e.y);
          lure.x = p.x;
          lure.y = p.y;
          lure.z = p.z;
          const speed = Math.min(1, Math.hypot(e.vx, e.vy) / 1.4);
          lurePull = -(6 + speed * 26);
          lurePullTarget = 0;
        },
        pan2: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.0;
          if (e.phase === "end") return;
          viewOffsetTX = clamp(viewOffsetTX - (e.dx / Math.max(1, width)) * 1.6, -0.42, 0.42);
          viewOffsetTY = clamp(viewOffsetTY + (e.dy / Math.max(1, height)) * 1.2, -0.34, 0.34);
          try {
            if (Math.abs(e.dx) + Math.abs(e.dy) > 8) haptics.tap();
          } catch {
            /* noop */
          }
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          const g = Math.min(1, e.speed / 3.5) * WIND_MAX;
          handWind.x = clamp(handWind.x + Math.cos(e.angle) * g, -WIND_MAX, WIND_MAX);
          handWind.z = clamp(handWind.z + Math.sin(e.angle) * g, -WIND_MAX, WIND_MAX);
          // A flick also launches the nearest bird into a swoop / flight.
          if (e.fingers === 1) {
            const at = screenToWorld(e.x, e.y);
            launchNearest(
              state,
              at,
              { x: Math.cos(e.angle) * 2, y: 0.6, z: Math.sin(e.angle) * 2 },
              MIN_SPEED + e.speed * 3,
            );
          }
          try {
            haptics.ripple(0.3);
          } catch {
            /* noop */
          }
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          if (e.fingers === 3) {
            // the world-law: the season, and with it where the flock is going
            if (e.phase === "move") {
              seasonBlend += e.angle / 1.4;
              const s = seasonIndex(Math.round(seasonBlend));
              if (s !== season) {
                season = s;
                try {
                  audio.chime();
                  haptics.detent();
                } catch {
                  /* noop */
                }
                save(performance.now(), true);
              }
            }
            if (e.phase === "end") seasonBlend = season;
            return;
          }
          // two fingers turn the observer — the sun swings with the head
          if (e.phase === "move") {
            yaw -= e.angle;
            yawVel = -e.velocity;
            const card = Math.round(yaw / (Math.PI / 2));
            if (card !== lastCardinal) {
              lastCardinal = card;
              try {
                haptics.lens();
                audio.playTone(register.baseHz / 2, 0.22);
              } catch {
                /* noop */
              }
            }
          }
          if (e.phase === "end") save(performance.now());
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          // a circling hand turns the whole animal about its own axis
          lure.x = 0;
          lure.y = 0;
          lure.z = 0;
          swirl = clamp(swirl + e.angularVelocity * 2.2, -34, 34);
          char.coh = clamp(char.coh + Math.abs(e.angularVelocity) * 0.02, 0.15, 2);
          save(performance.now());
        },
        rhythm: (e) => {
          // the wingbeat takes the hand's tempo
          if (e.stability > 0.6) {
            wingHzTarget = clamp(e.bpm / 60, 2.4, 13);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel: this is the room where tilt IS the control ———
    let lastTiltTickAt = 0;
    let lastTiltBand = 0;
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        const w = windFromTilt(beta, gamma, WIND_MAX);
        tiltWind.x = w.x;
        tiltWind.y = w.y;
        tiltWind.z = w.z;
        rollTarget = clamp(-gamma / 90, -0.4, 0.4);
        pitchTarget = clamp(-0.06 + (beta - 45) / 320, -0.32, 0.24);
        wingHzTarget = clamp(7.2 + Math.abs(gamma) * 0.035 + Math.abs(beta - 45) * 0.018, 2.4, 13);
        viewOffsetTX = clamp(viewOffsetTX + gamma * 0.00018, -0.42, 0.42);
        viewOffsetTY = clamp(viewOffsetTY + (beta - 45) * 0.00012, -0.34, 0.34);
        if (Math.abs(gamma) > 6) energy = Math.max(energy, 0.6);
        const mag = Math.hypot(gamma / 35, (beta - 45) / 45);
        const band = Math.floor(clamp(mag, 0, 2.4) * 4);
        const now = performance.now();
        if (band > 1 && (band !== lastTiltBand || now - lastTiltTickAt > 420)) {
          lastTiltBand = band;
          lastTiltTickAt = now;
          try {
            haptics.tap();
            audio.playTone(register.baseHz * (0.62 + band * 0.06), 0.08);
          } catch {
            /* noop */
          }
        }
      },
      shake: ({ intensity }) => {
        lastInteractionAt = performance.now();
        energy = 2.2;
        // the sky bursts, and gathers itself again —
        // residents leave the tree and pond for the air
        scatter = Math.min(1, scatter + 0.55 + intensity * 0.45);
        const c = centroid(state.pos, state.n);
        flushNear(state, c, 40);
        startle(c, 40 + intensity * 60);
        stirTurbulence(0.25 + intensity * 0.35);
        pulse();
        try {
          audio.playTone(register.baseHz * 0.5, 0.5);
          haptics.chop();
        } catch {
          /* noop */
        }
        window.setTimeout(() => call(1.2), 220);
      },
      knock: () => {
        lastInteractionAt = performance.now();
        energy = 1.6;
        pulse();
        try {
          audio.thud();
          haptics.detent();
        } catch {
          /* noop */
        }
        window.setTimeout(() => call(1.1), 120);
      },
      flip: ({ faceDown }) => {
        // face-down is night: the flock goes quiet and low
        timeScaleTarget = faceDown ? 0.35 : 1;
        nightTarget = faceDown ? 1 : 0;
        if (faceDown) {
          try {
            audio.playTone(register.baseHz / 3, 0.8);
            haptics.roll();
          } catch {
            /* noop */
          }
        }
      },
    });

    // ——— keyboard ———
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        lurePullTarget = 0;
        lurePull = 0;
        kbCharge = 0;
        handWind.x = 0;
        handWind.z = 0;
        return;
      }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        energy = 1.4;
        yaw += ev.key === "ArrowLeft" ? -0.11 : 0.11;
        const card = Math.round(yaw / (Math.PI / 2));
        if (card !== lastCardinal) {
          lastCardinal = card;
          try {
            haptics.lens();
            audio.playTone(register.baseHz / 2, 0.22);
          } catch {
            /* noop */
          }
        }
        save(performance.now());
        return;
      }
      if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        energy = 1.4;
        handWind.z = clamp(handWind.z + (ev.key === "ArrowUp" ? -1.1 : 1.1), -WIND_MAX, WIND_MAX);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        energy = 1.6;
        if (!ev.repeat) {
          startle({ x: 0, y: 0, z: 0 }, 34);
          call(0.9);
          try {
            haptics.tap();
          } catch {
            /* noop */
          }
          kbCharge = 0.05;
          return;
        }
        // held Enter is the keyboard's gathering — the same slow road
        kbCharge = clamp01(kbCharge + 0.05);
        lure.x = 0;
        lure.y = 0;
        lure.z = 0;
        lurePullTarget = 4 + kbCharge * 26;
        gather = kbCharge;
        if (kbCharge >= 1) {
          kbCharge = 0;
          char.ali = clamp(char.ali + 0.1, 0.15, 2);
          char.coh = clamp(char.coh + 0.1, 0.15, 2);
          save(performance.now(), true);
          call(1.6);
          try {
            haptics.bloom();
          } catch {
            /* noop */
          }
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        kbCharge = 0;
        lurePullTarget = 0;
        gather = 0;
      }
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);

    // ——— letting the flock go ———
    letGoRef.current = () => {
      try {
        window.localStorage.setItem(
          STORE_KEY,
          JSON.stringify({ ...WILD, season: 0, yaw: 0, cleared: true } satisfies Stored),
        );
      } catch {
        /* noop */
      }
      cleared = true;
      setHasKept(false);
      // it leaves the way a flock leaves: outward, over a breath or two
      leaving = 1;
      const c = centroid(state.pos, state.n);
      startle(c, 30);
      try {
        audio.thud();
        haptics.roll();
      } catch {
        /* noop */
      }
    };

    const onScaleTravel = () => {
      leaving = 1;
      lastDeathAt = 0;
      const c = centroid(state.pos, state.n);
      startle(c, 44);
      try {
        audio.thud();
        haptics.crossing();
      } catch {
        /* noop */
      }
    };
    window.addEventListener("objetdart:scale-travel:start", onScaleTravel);

    // ——— the one loop ———
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      gov.beginFrame(now);
      if (paused) {
        last = now;
        return;
      }
      const deltaMs = Math.min(64, now - last);
      last = now;
      const dt = deltaMs / 1000;

      drawn = state.n;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      pitch += (pitchTarget - pitch) * Math.min(1, dt * 2.5);
      roll += (rollTarget - roll) * Math.min(1, dt * 2.5);
      viewOffsetX += (viewOffsetTX - viewOffsetX) * (reduced ? 1 : Math.min(1, dt * 3.2));
      viewOffsetY += (viewOffsetTY - viewOffsetY) * (reduced ? 1 : Math.min(1, dt * 3.2));
      night += (nightTarget - night) * Math.min(1, dt * 4);
      soften += (softenTarget - soften) * Math.min(1, dt * 3);
      softenTarget *= Math.exp(-dt * 1.2);
      wingHz += (wingHzTarget - wingHz) * Math.min(1, dt * 2);
      lurePull += (lurePullTarget - lurePull) * Math.min(1, dt * 4);
      swirl *= Math.exp(-dt * 0.9);
      scatter *= Math.exp(-dt * 0.5);
      handWind.x *= Math.exp(-dt * 0.22);
      handWind.z *= Math.exp(-dt * 0.22);
      if (Math.abs(yawVel) > 1e-4) {
        yaw += yawVel * dt;
        yawVel *= Math.exp(-dt * 4);
      }
      if (energy > 0) energy = Math.max(0, energy - dt);
      if (leaving > 0) leaving = Math.max(0, leaving - dt * 0.5);
      if (leaving > 0 && state.n > 1 && now - lastDeathAt > 120) {
        lastDeathAt = now;
        cullBird(state, state.n - 1);
        metaDirty = true;
        uploaded = false;
      }
      if (leaving > 0 && leaving < 0.02) {
        // the sky comes back wild, the way it was found
        char = { ...WILD };
        season = 0;
        seasonBlend = 0;
      }

      for (const k of ["x", "y", "z"] as const) {
        const target = tiltWind[k] + (k === "y" ? 0 : handWind[k]);
        wind[k] += (target - wind[k]) * Math.min(1, dt * 1.6);
      }

      const t = audio.getAudioTime() ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // the law the flock is living under this frame
      const p: FlockParams = {
        separation: char.sep * (1 + scatter * 0.9),
        alignment: char.ali * (1 - scatter * 0.95) + gather * 0.5 - soften * 0.22,
        cohesion: char.coh * (1 - scatter * 0.85) + gather * 0.4 - soften * 0.18,
        wind,
        goal: seasonGoal(season),
        goalPull: SEASON_PULL * (1 - scatter * 0.5),
        lure,
        lurePull: lurePull + (leaving > 0 ? -14 * leaving : 0),
        swirl,
      };

      // Fixed timestep, accumulator inside: the same second of real time is
      // the same flock whatever the display is doing. Under reduced motion the
      // sky is still, but every verb still moves it.
      const advance = reduced ? (energy > 0 ? dt * timeScale : 0) : dt * timeScale;
      const steps = advance > 0 ? advanceFlock(state, p, advance) : 0;
      if (!reduced || energy > 0) visualT += dt * timeScale;
      if (pulseT >= 0) {
        pulseT += dt;
        if (pulseT > 1.2) pulseT = -1;
      }

      order = orderParameter(state.vel, state.n);

      // The call: the sound says the order before the eye resolves it. Only
      // once the sea has been woken — no room on this site ever starts sound
      // on its own.
      if (
        audio.getAudioTime() !== null &&
        !document.hidden &&
        now - lastCallAt > callInterval(order)
      ) {
        lastCallAt = now;
        call(0.55 + (1 - order) * 0.2);
      }

      // glimmer: after ~20s of stillness, one wave of wings crosses the sky
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 9000 && !reduced) {
        glimmerAt = now;
        pulse();
      }

      // ——— render ———
      setView();
      // the sky turns toward the season rather than cutting to it
      const sk = SEASON_SKY[seasonIndex(season)];
      const k = Math.min(1, dt * 1.1);
      for (let i = 0; i < 3; i++) {
        low[i] += (sk.low[i] - low[i]) * k;
        high[i] += (sk.high[i] - high[i]) * k;
        sunTint[i] += (sk.sun[i] - sunTint[i]) * k;
      }
      const sun = sunScreen();
      const horizon = horizonUv();
      // warmer living meadow base — soil under green, not a dead grey wash
      const ground = [
        mix(0.10, low[0] * 0.22, 0.55),
        mix(0.18, low[1] * 0.28, 0.55),
        mix(0.08, low[2] * 0.18, 0.55),
      ];

      gl.disable(gl.BLEND);
      gl.useProgram(skyProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(uSky.pos);
      gl.vertexAttribPointer(uSky.pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform3f(uSky.low, low[0], low[1], low[2]);
      gl.uniform3f(uSky.high, high[0], high[1], high[2]);
      gl.uniform3f(uSky.sunTint, sunTint[0], sunTint[1], sunTint[2]);
      gl.uniform3f(uSky.sun, sun.x, sun.y, sun.v);
      gl.uniform3f(uSky.ground, ground[0], ground[1], ground[2]);
      gl.uniform1f(uSky.aspect, aspect);
      gl.uniform1f(uSky.roll, roll);
      gl.uniform1f(uSky.horizon, horizon);
      gl.uniform1f(uSky.breath, breath);
      gl.uniform1f(uSky.time, visualT);
      gl.uniform2f(uSky.viewOffset, viewOffsetX, viewOffsetY);
      gl.uniform1f(uSky.night, night);
      gl.uniformMatrix3fv(uSky.view, false, viewM);
      gl.uniform1f(uSky.camDist, CAM_DIST);
      gl.uniform1f(uSky.focalX, focalX);
      gl.uniform1f(uSky.focalY, focalY);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(uSky.pos);

      if (steps > 0 || !uploaded) {
        uploaded = true;
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.pos.subarray(0, state.capacity * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, velBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.vel.subarray(0, state.capacity * 3));
        metaDirty = true;
      }
      if (metaDirty || !uploaded) {
        metaDirty = false;
        writeMeta();
        gl.bindBuffer(gl.ARRAY_BUFFER, metaBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, meta);
        gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.tint.subarray(0, state.capacity * 3));
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(birdProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
      gl.enableVertexAttribArray(uBird.corner);
      gl.vertexAttribPointer(uBird.corner, 2, gl.FLOAT, false, 0, 0);
      divisor(uBird.corner, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(uBird.pos);
      gl.vertexAttribPointer(uBird.pos, 3, gl.FLOAT, false, 0, 0);
      divisor(uBird.pos, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, velBuf);
      gl.enableVertexAttribArray(uBird.vel);
      gl.vertexAttribPointer(uBird.vel, 3, gl.FLOAT, false, 0, 0);
      divisor(uBird.vel, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
      if (uBird.tint >= 0) {
        gl.enableVertexAttribArray(uBird.tint);
        gl.vertexAttribPointer(uBird.tint, 3, gl.FLOAT, false, 0, 0);
        divisor(uBird.tint, 1);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, metaBuf);
      gl.enableVertexAttribArray(uBird.meta);
      gl.vertexAttribPointer(uBird.meta, 4, gl.FLOAT, false, 0, 0);
      divisor(uBird.meta, 1);
      gl.uniformMatrix3fv(uBird.view, false, viewM);
      gl.uniform1f(uBird.camDist, CAM_DIST);
      gl.uniform1f(uBird.focalX, focalX);
      gl.uniform1f(uBird.focalY, focalY);
      gl.uniform1f(uBird.time, visualT);
      gl.uniform1f(uBird.wingHz, wingHz);
      gl.uniform1f(uBird.reduced, reduced ? 1 : 0);
      gl.uniform1f(uBird.pulseT, pulseT);
      gl.uniform2f(uBird.resolution, canvas.width, canvas.height);
      gl.uniform2f(uBird.viewOffset, viewOffsetX, viewOffsetY);
      gl.uniform3f(uBird.ink, 0.035, 0.032, 0.045);
      gl.uniform3f(uBird.low, low[0], low[1], low[2]);
      gl.uniform3f(uBird.high, high[0], high[1], high[2]);
      gl.uniform3f(uBird.ground, ground[0], ground[1], ground[2]);
      gl.uniform1f(uBird.horizon, horizon);
      gl.uniform2f(uBird.res, canvas.width, canvas.height);
      gl.uniform1f(uBird.haze, 0.72 - order * 0.22);
      gl.uniform1f(uBird.night, night);
      gl.uniform1f(uBird.hazeFrom, CAM_DIST * 0.6);
      drawInstanced(drawn);
      divisor(uBird.pos, 0);
      divisor(uBird.vel, 0);
      divisor(uBird.tint, 0);
      divisor(uBird.meta, 0);
      gl.disableVertexAttribArray(uBird.corner);
      gl.disableVertexAttribArray(uBird.pos);
      gl.disableVertexAttribArray(uBird.vel);
      gl.disableVertexAttribArray(uBird.meta);
      if (uBird.tint >= 0) gl.disableVertexAttribArray(uBird.tint);
      gl.disable(gl.DEPTH_TEST);
    };
    raf = requestAnimationFrame(draw);

    // A flock in a hidden tab, or in a gallery card nobody is looking at,
    // costs nothing: the clock stops rather than the sky racing.
    let hiddenNow = false;
    let galleryPaused = false;
    const settlePause = () => {
      const next = hiddenNow || galleryPaused;
      if (next === paused) return;
      paused = next;
      if (!paused) last = performance.now();
    };
    const detachVisibility = onVisibility((hidden) => {
      hiddenNow = hidden;
      settlePause();
    });
    const detachGallery = onGalleryPause((p) => {
      galleryPaused = p;
      settlePause();
    });

    return () => {
      observer.disconnect();
      detach();
      detachVessel();
      detachVisibility();
      detachGallery();
      window.removeEventListener("objetdart:scale-travel:start", onScaleTravel);
      breathStop?.();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      mq.removeEventListener?.("change", onMq);
      cancelAnimationFrame(raf);
      gl.deleteBuffer(cornerBuf);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(velBuf);
      gl.deleteBuffer(tintBuf);
      gl.deleteBuffer(metaBuf);
      gl.deleteBuffer(quad);
      gl.deleteProgram(skyProg);
      gl.deleteProgram(birdProg);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="a flock over an evening field"
      style={{
        position: "fixed",
        inset: 0,
        background: noGl ? "linear-gradient(#1a2030, #6a5b46)" : "#10131c",
        outline: "none",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          // a machine with no shader keeps the dusk behind it rather than an
          // opaque black buffer
          display: noGl ? "none" : "block",
        }}
      />
      <LetGo label="let the flock go" onLetGo={() => letGoRef.current()} visible={hasKept} />
    </div>
  );
}
