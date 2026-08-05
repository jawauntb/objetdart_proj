"use client";

/**
 * /atmosphere — the air column above the peak. The band at 10^4.5–10^5.5 m:
 * the hundred kilometres of air standing on the mountain's summit.
 *
 * The invariant is a VERTICAL PROFILE (src/lib/aircolumn.ts): pressure and
 * density against altitude under one lapse rate, a wind field sheared across
 * the column, and the moisture the air carries. The frame is the column
 * itself, side on — the last dark ridge of the band below at the bottom, the
 * Kármán line and the first stars at the top.
 *
 * The material is a VOLUME, marched in a fragment shader on the shared GL
 * harness (`src/lib/webgl/stage.ts`). Nothing here is painted: each pixel's
 * blue is Rayleigh's λ⁻⁴ against the real barometric column, and every cloud
 * is a density field lit by the sun's own transmittance through that same
 * column. Raise the lapse rate and the sky thins because the air overhead
 * genuinely weighs less. The only 2D is the thin overlay — isobar lens,
 * pressure rings, stars — strokes and points, no gradients.
 *
 * THE OBJECTS. A press lifts the parcel of air standing there and warms it,
 * as sunlit ground does. It cools on the dry adiabat until its vapour
 * saturates — that altitude is the lifting condensation level, and it is
 * where the cloud becomes visible. Past the level of free convection the
 * parcel is warmer than the column and climbs on its own to the equilibrium
 * level, where it spreads. Cloud base, cloud top and vigour are all computed
 * from the column; none of them is chosen. So:
 *
 *   - a short press makes a puff that never goes free and fades
 *   - a long press warms the parcel enough to build a tower
 *   - steepening the lapse rate (three fingers) makes every cloud taller
 *   - turning the season drier (three-finger twist) raises every base
 *   - clouds advect in the wind at their own altitude, LEAN in the shear,
 *     merge when they touch (mass and momentum conserved), and are torn
 *     apart by a flick, a shake, or simply by standing in the jet
 *
 * The vessel's tilt IS wind — the world leaning adds the net momentum a
 * finger's stir never can. A knock rings the column from the ground up.
 * Face-down is night. Agitation is the shared turbulence axis, so a hand
 * that arrives from the storm finds this air already moving.
 *
 * Lanterns are what is kept: a ceremony hold gives the candle to the wind,
 * and it lives in the shared world (`lib/world.ts`, zone "sky") where it
 * drifts on its layer's wind between visits.
 *
 * `RoomShell` owns the grammar, the vessel, the keyboard, the glimmer clock
 * and the axis chrome; this file owns the air.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { getTurbulence, relaxTurbulence, stirTurbulence } from "@/lib/turbulence";
import {
  addNatural,
  commitZone,
  getNaturalsInZone,
  subscribeNaturals,
  type WorldNatural,
} from "@/lib/world";
import RoomShell from "@/components/RoomShell";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { createGLStage, FULLSCREEN_VERT_UNIT } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import {
  FRAME_KM,
  ISOBARS_KPA,
  LAPSE_MAX,
  LAPSE_MIN,
  LAPSE_STD,
  MAX_PARCELS,
  PARCEL_MIN_MASS,
  TOP_KM,
  WIND_MODES,
  altitudeForPressure,
  dewPointK,
  dissipationRate,
  hashSeed,
  hazeBankAltitudes,
  liftParcel,
  mergeParcels,
  midiForPressure,
  mulberry32,
  parcelRadiusKm,
  parcelsTouch,
  pressureKPa,
  satMixingRatio,
  shearAt,
  skyColor,
  stirImpulse,
  temperatureK,
  tropopauseKm,
  windAt,
  type Parcel,
} from "@/lib/aircolumn";
import {
  onVisibility,
  onGalleryPause,
  createIdleWriter,
  createFrameGovernor,
  isEmbeddedFrame,
} from "@/lib/room-runtime";

/** Screen ← altitude: the lower air, where everything lives, gets the room. */
const Z_EXP = 2.6;
/** How many lanterns the sky will hold. */
const MAX_LANTERNS = 12;
/** One sky, always yours. */
const SEED = 0x0a7a;
/** The shader's own caps — the uniform arrays are sized to these. */
const GL_PARCELS = MAX_PARCELS;
const GL_LANTERNS = MAX_LANTERNS;

type Ring = { x: number; y: number; t0: number };

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * The column, marched. Everything below mirrors src/lib/aircolumn.ts — the
 * same barometric power law, the same λ⁻⁴, the same wind modes — so the
 * picture and the numbers the room sounds can never drift apart.
 */
const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uLapse;      // K/km
uniform float uSunElev;    // rad
uniform float uSunAz;      // rad
uniform float uHaze;
uniform float uRH;         // the season: 0.05 bone dry .. 1 saturated
uniform float uDrift;      // accumulated wind travel (km-seconds)
uniform float uTurbulence; // shared turbulence, 0..1, bound by the harness
uniform float uBreath;     // the shared 7s breath, 0..1, likewise
uniform vec3  uAmpsA;      // wind modes 0..2
uniform vec3  uAmpsB;      // wind modes 3..5
uniform float uTilt;       // the vessel's own wind
uniform float uSteps;      // march budget, walked by the frame governor
uniform vec4  uParcelA[${GL_PARCELS}];  // xKm, zKm, radiusKm, density
uniform vec4  uParcelB[${GL_PARCELS}];  // lclKm, topKm, spin, depthKm
uniform float uParcelN;
uniform vec4  uLantern[${GL_LANTERNS}]; // u(0..1), zKm, glow, phase
uniform float uLanternN;
uniform float uReduced;

varying vec2 vUv;

const float TOP_KM      = ${TOP_KM.toFixed(1)};
const float FRAME_KM    = ${FRAME_KM.toFixed(1)};
const float Z_EXP       = ${Z_EXP.toFixed(2)};
const float P0          = 101.325;
const float T0          = 288.15;
const float T_STRAT     = 216.65;
const float G_MS2       = 9.80665;
const float M_AIR       = 0.0289644;
const float R_GAS       = 8.31446;
const float BETA_R550   = 0.0135;
const float HAZE_H      = 1.2;
const float BETA_HAZE   = 0.02;
const float SUN_I       = 20.0;
const float VIEW_RANGE  = 220.0;
const float HAZE_G      = 0.6;
const float DEPTH_KM    = 90.0;
const float WIND_SURF   = 0.12;
const float WIND_JET    = 1.0;
const float JET_WIDTH   = 5.5;
/** How far a unit of shear tilts a cloud, km. */
const float LEAN_KM     = 11.0;

// ——— the standard column, exactly as the library states it ———

float tropopause() { return (T0 - T_STRAT) / uLapse; }
float baroExp()    { return (G_MS2 * M_AIR) / (R_GAS * (uLapse / 1000.0)); }
float hStrat()     { return (R_GAS * T_STRAT) / (G_MS2 * M_AIR) / 1000.0; }

float temperatureK(float z) { return max(T_STRAT, T0 - uLapse * max(0.0, z)); }

float pressureKPa(float z) {
  float zz = max(0.0, z);
  float zt = tropopause();
  float n  = baroExp();
  if (zz <= zt) return P0 * pow(max(1e-6, 1.0 - (uLapse * zz) / T0), n);
  float pT = P0 * pow(max(1e-6, 1.0 - (uLapse * zt) / T0), n);
  return pT * exp(-(zz - zt) / hStrat());
}

float relDensity(float z) {
  float rho0 = (P0 * 1000.0 * M_AIR) / (R_GAS * T0);
  float rho  = (pressureKPa(z) * 1000.0 * M_AIR) / (R_GAS * temperatureK(z));
  return rho / rho0;
}

// ∫ relDensity dz, closed form, piecewise across the tropopause.
float tropoAnti(float z, float n) {
  return -((T0 / (uLapse * n)) * pow(max(1e-6, 1.0 - (uLapse * z) / T0), n));
}
float columnKm(float z0, float z1) {
  float a = max(0.0, min(z0, z1));
  float b = max(0.0, max(z0, z1));
  float zt = tropopause();
  float n = baroExp();
  float sum = 0.0;
  if (a < zt) {
    float hi = min(b, zt);
    sum += tropoAnti(hi, n) - tropoAnti(a, n);
    a = hi;
  }
  if (b > zt) {
    float lo = max(a, zt);
    float H = hStrat();
    float rhoT = pow(max(1e-6, 1.0 - (uLapse * zt) / T0), n - 1.0);
    sum += rhoT * H * (exp(-(lo - zt) / H) - exp(-(b - zt) / H));
  }
  return sum;
}

vec3 betaR() {
  vec3 lam = vec3(680.0, 550.0, 440.0);
  vec3 r = 550.0 / lam;
  return BETA_R550 * r * r * r * r;
}

/** What the sun's light has left after the slant column above z. */
vec3 sunTransmit(float z, float elev) {
  float dirY = max(0.015, sin(elev));
  float dist = (TOP_KM - min(z, TOP_KM - 1.0)) / dirY;
  float air  = columnKm(z, z + dirY * dist) / dirY;
  float e0 = exp(-max(0.0, z) / HAZE_H);
  float e1 = exp(-max(0.0, z + dirY * dist) / HAZE_H);
  float hz = abs((HAZE_H / dirY) * (e0 - e1)) * uHaze * BETA_HAZE;
  vec3 tau = min(vec3(60.0), betaR() * air + hz);
  return exp(-tau);
}

float rayleighPhase(float c) { return (3.0 / (16.0 * 3.14159265)) * (1.0 + c * c); }
float hgPhase(float c) {
  float g = HAZE_G;
  float d = 1.0 + g * g - 2.0 * g * c;
  return (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(1e-4, d), 1.5));
}

/**
 * The level ray's single scatter, integrated in closed form:
 * ∫₀ᴰ e^{-kt}·σ dt = σ(1-e^{-kD})/k. No loop — the sky costs nothing, so
 * the whole march budget can go to the clouds.
 */
vec3 skyAt(float z, float cosTheta) {
  float rho = relDensity(z);
  // only the part of the aerosol the march does NOT carry: the strata are
  // volume, this is the smooth remainder
  float hzD = uHaze * exp(-z / HAZE_H) * 0.3;
  vec3 sun = sunTransmit(z, uSunElev);
  vec3 bR = betaR();
  vec3 k = bR * rho + BETA_HAZE * hzD;
  vec3 reach = (1.0 - exp(-k * VIEW_RANGE)) / max(k, vec3(1e-9));
  vec3 AR = bR * rho * sun * SUN_I * reach;
  vec3 AM = BETA_HAZE * hzD * sun * SUN_I * reach;
  return AR * rayleighPhase(cosTheta) + AM * hgPhase(cosTheta);
}

vec3 tonemap(vec3 x, float e) { return 1.0 - exp(-max(x, 0.0) * e); }

// ——— the wind, mode for mode as the library has it ———

float baseWind(float z) {
  float zt = tropopause();
  float u = (max(0.0, z) - zt) / JET_WIDTH;
  float fade = 1.0 - min(1.0, max(0.0, z - zt) / (TOP_KM - zt)) * 0.55;
  return (WIND_SURF + WIND_JET * exp(-u * u)) * fade;
}
float modeShape(float n, float z) {
  return sin((2.0 * 3.14159265 * (n + 1.0) * z) / TOP_KM);
}
float windAt(float z) {
  float v = baseWind(z);
  v += uAmpsA.x * modeShape(0.0, z);
  v += uAmpsA.y * modeShape(1.0, z);
  v += uAmpsA.z * modeShape(2.0, z);
  v += uAmpsB.x * modeShape(3.0, z);
  v += uAmpsB.y * modeShape(4.0, z);
  v += uAmpsB.z * modeShape(5.0, z);
  return v + uTilt * 0.55;
}

// ——— noise: the only thing here that is not physics ———

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}
float fbm3(vec3 p) {
  float v = vnoise3(p) * 0.6;
  v += vnoise3(p * 2.13 + 11.7) * 0.28;
  v += vnoise3(p * 4.31 + 3.1) * 0.12;
  return v;
}
// ——— the volume: haze strata, and the clouds a hand made ———

/**
 * Density at a point in the column. Every altitude is advected by ITS OWN
 * wind, which is the entire reason the shear is visible before anyone
 * touches anything: neighbouring strata simply slide past each other.
 */
float densityAt(vec3 p, out float cloudPart) {
  float wind = windAt(p.y);
  vec3 q = vec3(p.x - wind * uDrift, p.y, p.z);

  // stratified aerosol: thick near the ground, banded, on its own scale
  // height. High frequency in altitude, almost none along the ray — a slab
  // the eye can see the edge of, not a fog the march averages into milk.
  float band = fbm3(vec3(q.x * 0.055, q.y * 1.85, q.z * 0.010));
  // the shared 7s breath, spent where it can be seen: the strata swell and
  // thin on it, and thicker air breathes more visibly than thin air does
  float swell = 1.0 + (uBreath - 0.5) * 0.34 * exp(-p.y / 9.0);
  float haze = uHaze * swell * exp(-p.y / (HAZE_H * 2.0))
             * smoothstep(0.47, 0.72, band) * 0.135
             * (0.45 + 0.85 * uRH)           // moist air carries more of it
             * smoothstep(0.75, 2.6, p.y);   // the lowest air belongs to the rock

  float cloud = 0.0;
  for (int i = 0; i < ${GL_PARCELS}; i++) {
    if (float(i) >= uParcelN) break;
    vec4 A = uParcelA[i];
    vec4 B = uParcelB[i];
    float base = B.x;
    float top  = B.y;
    if (p.y < base || p.y > top + A.z * 0.9) continue;

    // the cloud LEANS: each of its levels rides the wind of that level
    // the cloud leans by the shear it is standing IN, not by how long the
    // page has been open: a bounded displacement, from the wind difference
    // between this level and the parcel's own
    float lean = clamp((windAt(p.y) - windAt(A.y)) * LEAN_KM, -14.0, 14.0);
    float t = clamp((p.y - base) / max(0.35, top - base), 0.0, 1.0);
    // a cauliflower: narrow at the base where the air is still being drawn
    // in, widest through the middle, and spreading only at the very top —
    // and only for a parcel that actually reached its equilibrium level,
    // because an anvil IS the cloud meeting the ceiling the column gave it
    float prof = 0.46 + 0.78 * pow(t, 0.62);
    float anvil = smoothstep(2.4, 6.0, top - base);
    prof *= 1.0 + smoothstep(0.80, 1.0, t) * 0.62 * anvil;
    prof *= 1.0 - smoothstep(0.90, 1.06, t) * 0.62;
    float rad = A.z * prof;

    vec3 d = vec3(p.x - (A.x + lean), p.y - (base + t * (top - base)), p.z - B.w);
    // the hand's winding turns the parcel about its own axis
    float s = sin(B.z * uTime * 0.35), c = cos(B.z * uTime * 0.35);
    d.xz = mat2(c, -s, s, c) * d.xz;
    float r = length(vec3(d.x, d.y * 1.25, d.z)) / max(0.4, rad);
    if (r > 1.1) continue;
    float shell = smoothstep(1.02, 0.12, r);
    // erode the envelope away entirely: what the eye reads is the noise, and
    // the ellipsoid only says where the noise is allowed to be
    float k = 1.9 / max(1.2, A.z);
    float n = fbm3(vec3(d.x, d.y * 0.75, d.z) * k + vec3(0.0, -uTime * 0.02, float(i) * 7.3));
    float carve = smoothstep(0.34, 0.66, n * 0.72 + shell * 0.62);
    cloud += A.w * shell * carve;
  }
  cloudPart = cloud;
  return haze + cloud;
}

// ——— the ridge of the band below ———

float ridgeKm(float x) {
  float u = x / FRAME_KM + 0.5;
  float v = 0.0;
  v += (1.0 - abs(2.0 * vnoise3(vec3(u * 6.0, 0.5, 0.5)) - 1.0)) * 0.62;
  v += (1.0 - abs(2.0 * vnoise3(vec3(u * 13.0, 7.5, 0.5)) - 1.0)) * 0.28;
  v += (1.0 - abs(2.0 * vnoise3(vec3(u * 29.0, 3.5, 9.5)) - 1.0)) * 0.10;
  // the peak band's own metres, and no more: the ridge is the floor of this
  // room, not its subject, so the air a hand can reach stands clear of it
  return 0.16 + v * 1.05;
}

void main() {
  vec2 uv = vUv;
  float zKm = TOP_KM * pow(max(0.0, uv.y), Z_EXP);
  float xKm = (uv.x - 0.5) * FRAME_KM;

  float az = (uv.x - 0.5) * 1.9;
  float cosTheta = cos(uSunElev) * cos(az - uSunAz) * 0.985 + sin(uSunElev) * 0.02;

  // ——— what stands behind the air ———
  vec3 sky = skyAt(zKm, cosTheta);
  vec3 bg = tonemap(sky, 1.35);
  float rk = ridgeKm(xKm);
  // one pixel row, in kilometres — the silhouette is resolved against the
  // downscaled pass instead of stair-stepping across it
  float dz = max(1e-4, TOP_KM * Z_EXP * pow(max(1e-4, uv.y), Z_EXP - 1.0) / max(1.0, uRes.y));
  float rockMask = smoothstep(rk + dz, rk - dz, zKm);
  if (rockMask > 0.002) {
    vec3 lit = sunTransmit(0.4, max(0.03, uSunElev));
    float veil = 1.0 - exp(-(betaR().z * 30.0 + BETA_HAZE * uHaze * 24.0));
    // relief: the faces turned toward the sun keep a little more of it
    float slope = clamp((ridgeKm(xKm + 1.6) - ridgeKm(xKm - 1.6)) * 0.5, -1.0, 1.0);
    float face = 0.72 + 0.5 * clamp(slope * sign(uSunAz), -0.5, 0.6);
    vec3 rock = vec3(0.010, 0.013, 0.024)
              + vec3(0.052, 0.048, 0.058) * face * veil * tonemap(lit * 2.0, 1.0);
    bg = mix(bg, rock, rockMask);
  }

  // ——— the sun, coloured by its own column ———
  {
    float sx = 0.5 + uSunAz / 1.9;
    float sy = sin(uSunElev) * 1.02;
    float zSun = TOP_KM * pow(clamp(sy, 0.0, 1.0), Z_EXP);
    vec2 dsun = (uv - vec2(sx, sy)) * vec2(uRes.x / max(1.0, uRes.y), 1.0);
    float dd = length(dsun);
    vec3 c = sunTransmit(zSun, max(0.03, uSunElev));
    float mx = max(max(c.r, c.g), max(c.b, 1e-6));
    vec3 hue = c / mx;                    // the ratio the column left it
    float bright = 1.0 - exp(-mx * 3.0);
    bg += hue * bright * (exp(-dd * 90.0) * 1.05 + exp(-dd * 11.0) * 0.10);
  }

  // ——— airglow: the shell where the column runs out ———
  {
    float ya = pow(91.0 / TOP_KM, 1.0 / Z_EXP);
    bg += vec3(0.19, 0.30, 0.23) * exp(-pow((uv.y - ya) * 42.0, 2.0))
        * (0.24 + 0.16 * uBreath);
  }

  // ——— the march: what the air itself is made of ———
  vec3 sunDir = vec3(cos(uSunElev) * cos(uSunAz), sin(uSunElev), cos(uSunElev) * sin(uSunAz));
  vec3 col = bg;
  if (zKm < 46.0) {
    float steps = uSteps;
    float dt = DEPTH_KM / steps;
    vec3 rd = normalize(vec3((uv.x - 0.5) * 0.22, 0.0, 1.0));
    float trans = 1.0;
    vec3 acc = vec3(0.0);
    float phase = mix(hgPhase(cosTheta), rayleighPhase(cosTheta) * 2.4, 0.35);
    // the ridge stands about twenty kilometres off: the air in front of it is
    // still air, and a cloud made there is seen against the rock
    float far = mix(DEPTH_KM, 20.0, rockMask);
    for (int i = 0; i < 40; i++) {
      if (float(i) >= steps) break;
      float t = (float(i) + 0.5) * dt;
      if (t > far) break;
      vec3 p = vec3(xKm, zKm, 0.0) + rd * t;
      p.y = zKm;                                  // altitude is never a lie
      float cloudPart;
      float d = densityAt(p, cloudPart);
      if (d < 0.004) continue;
      // the sun's own light, through the column and through the cloud above
      vec3 lin = sunTransmit(zKm, uSunElev);
      float depthIn = 0.0;
      for (int k = 1; k <= 3; k++) {
        vec3 sp = p + sunDir * float(k) * 1.7;
        sp.y = zKm + float(k) * 1.7 * sunDir.y;
        float cp2;
        depthIn += densityAt(sp, cp2);
      }
      float sunT = exp(-depthIn * 1.15);
      // Beer–Powder: the edges of a cloud are brighter than Beer alone says,
      // because that is where the light that bounced inside it comes back out
      float powder = 1.0 - exp(-d * 7.0);
      float sigma = d * 0.34;
      float a = 1.0 - exp(-sigma * dt);
      vec3 albedo = mix(vec3(0.86, 0.89, 0.94), vec3(1.0, 0.99, 0.97), cloudPart / max(1e-4, d));
      vec3 direct = lin * (0.30 + 2.30 * sunT) * mix(1.0, powder, 0.45) * (0.42 + phase * 1.6);
      vec3 ambient = bg * 0.75;   // the sky the cloud is standing in
      acc += trans * a * albedo * (direct + ambient);
      trans *= 1.0 - a;
      if (trans < 0.02) break;
    }
    col = bg * trans + acc;
  }

  // ——— lanterns: candles the wind is carrying ———
  for (int i = 0; i < ${GL_LANTERNS}; i++) {
    if (float(i) >= uLanternN) break;
    vec4 L = uLantern[i];
    float ly = pow(clamp(L.y, 0.0, TOP_KM) / TOP_KM, 1.0 / Z_EXP);
    vec2 dl = (uv - vec2(L.x, ly)) * vec2(uRes.x / max(1.0, uRes.y), 1.0);
    float dd = length(dl);
    float flick = uReduced > 0.5 ? 0.82 : 0.72 + 0.28 * sin(uTime * 2.3 + L.w * 6.28);
    vec3 warm = vec3(1.0, 0.80, 0.44);
    col += warm * L.z * flick * (exp(-dd * 300.0) * 0.9 + exp(-dd * 42.0) * 0.22 * (1.0 + uTurbulence));
  }

  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;
/** What the hand's verbs reach: set once the stage and the loop exist. */
type Air = {
  tap: (x: number, y: number, intensity: number, count?: number) => void;
  tutti: (intensity: number) => void;
  stepBack: () => void;
  plant: (x: number, y: number) => void;
  deepen: (elapsed: number, x: number, y: number) => void;
  ceremony: (x: number, y: number) => void;
  timeScale: (k: number) => void;
  stirAt: (x: number, y: number, dx: number, dy: number) => void;
  law: (dx: number, dy: number) => void;
  tear: (x: number, y: number, angle: number, speed: number) => void;
  lens: (angle: number) => void;
  season: (angle: number) => void;
  vortex: (cx: number, cy: number, angularVelocity: number) => void;
  gust: (x: number, y: number, hits: number, alternation: number) => void;
  entrain: (bpm: number, stability: number) => void;
  lid: (ayPx: number, byPx: number, elapsed: number, phase: "enter" | "tick" | "release") => void;
  scatter: (intensity: number) => void;
  gravity: (gamma: number) => void;
  ring: (intensity: number) => void;
  night: (faceDown: boolean) => void;
  glimmer: () => void;
  reduced: (on: boolean) => void;
  clear: () => void;
  keySun: (dx: number) => void;
  keyLapse: (dy: number) => void;
  unmake: () => void;
};

export default function AirColumn() {
  const skyRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const airRef = useRef<Air | null>(null);
  const [hasKept, setHasKept] = useState(false);

  useEffect(() => {
    const sky = skyRef.current;
    const overlay = overlayRef.current;
    if (!sky || !overlay) return;

    const audio = getFieldAudio();
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");

    // ——— the small state vector ———
    let sunElev = 0.42; // radians — a working morning
    let sunAz = -0.38; // west of the eye, clear of the site chrome
    let lapse = LAPSE_STD;
    let haze = 1;
    let rh = 0.72; // the season: how much water this air is carrying
    let lens = 0;
    let tiltWind = 0;
    let timeScale = 1;
    let drift = 0;
    let night = false;
    const amps = new Array<number>(WIND_MODES).fill(0);
    let parcels: Parcel[] = [];
    let rings: Ring[] = [];
    let glimmerAt = 0;
    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    let last = performance.now();
    let raf = 0;
    let running = true;
    let windAtMs = 0;
    let lanternWriteAt = 0;
    let heldParcelId = -1;
    let nextParcelId = 1;
    // a steady tapped pulse entrains the thermals to the hand's tempo
    let entrainBpm = 0;
    let entrainUntil = 0;
    let entrainDepth = 0;
    let lastEntrainBeat = -1;
    let shownElevNow = sunElev;
    let width = 1;
    let height = 1;

    // ——— what is kept: lanterns, in the shared world ———
    let lanterns: WorldNatural[] = getNaturalsInZone("sky").slice(-MAX_LANTERNS);
    setHasKept(lanterns.length > 0);
    const unworld = subscribeNaturals(() => {
      lanterns = getNaturalsInZone("sky").slice(-MAX_LANTERNS);
      setHasKept(lanterns.length > 0);
    });
    const writer = createIdleWriter(() => {
      commitZone("sky", lanterns);
      setHasKept(lanterns.length > 0);
    });

    const syncSleep = () => {
      asleep = hidden || galleryPaused;
      if (asleep) gov.force("sleep");
    };
    const unvis = onVisibility((h) => {
      hidden = h;
      syncSleep();
    });
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    // ——— the shared GL harness ———
    const stage = createGLStage(sky, {
      label: "atmosphere",
      wrap: sky.parentElement,
      overlay,
      renderScale: embedded ? 0.42 : 0.6,
      quality: embedded ? "medium" : "high",
      reducedMotion: reduced,
      embedded,
      onResize: (size) => {
        width = size.width;
        height = size.height;
      },
    });
    const prog = stage?.program(FULLSCREEN_VERT_UNIT, FRAG) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog, "unit") : null;
    if (stage) {
      width = stage.size.width;
      height = stage.size.height;
    }
    const octx = stage?.overlay2d ?? null;

    const parcelA = new Float32Array(GL_PARCELS * 4);
    const parcelB = new Float32Array(GL_PARCELS * 4);
    const lanternU = new Float32Array(GL_LANTERNS * 4);

    // ——— projection ———
    const yForZ = (zKm: number) =>
      height * (1 - Math.pow(clamp(zKm, 0, TOP_KM) / TOP_KM, 1 / Z_EXP));
    const zForY = (y: number) => TOP_KM * Math.pow(clamp01(1 - y / Math.max(1, height)), Z_EXP);
    const xKmForPx = (x: number) => (x / Math.max(1, width) - 0.5) * FRAME_KM;
    const pxForXKm = (xKm: number) => (xKm / FRAME_KM + 0.5) * width;

    const bankZ = hazeBankAltitudes(SEED);

    // Stars live on the overlay, not in the downscaled raster: at real device
    // resolution they are points instead of blocks. Where they show is not a
    // choice — a row is dark when the library's own scatter says the column
    // there has stopped answering the sun.
    const STAR_ROWS = 40;
    const starRng = mulberry32(hashSeed(SEED, 0x57a5));
    const stars: Array<{ u: number; v: number; r: number; ph: number }> = [];
    for (let i = 0; i < 200; i++) {
      stars.push({
        u: starRng(),
        v: starRng() * 0.55,
        r: 0.55 + starRng() * 0.95,
        ph: starRng() * 7,
      });
    }
    const rowDark = new Float32Array(STAR_ROWS);
    let rowsAt = 0;
    const rebuildRows = () => {
      for (let j = 0; j < STAR_ROWS; j++) {
        const z = TOP_KM * Math.pow(1 - (j + 0.5) / STAR_ROWS, Z_EXP);
        const g = skyColor(z, 0.001, 0.2, shownElevNow, lapse, haze * 0.3).rgb[1];
        rowDark[j] = clamp01(1 - (1 - Math.exp(-g * 1.35)) * 12);
      }
    };
    rebuildRows();

    // ——— the objects: parcels lifted out of the column ———

    const seedParcel = (xKm: number, zKm: number, warmK: number): Parcel => {
      const a = liftParcel(zKm, rh, lapse, warmK);
      const seed = hashSeed(Math.round(xKm * 91), Math.round(zKm * 977), nextParcelId);
      const p: Parcel = {
        id: nextParcelId++,
        xKm,
        zKm: a.lclKm,
        lclKm: a.lclKm,
        elKm: Math.max(a.elKm, a.lclKm + 0.5),
        mass: 0.22 + warmK * 0.1,
        spin: 0,
        w: a.peakBuoyancy > 0 ? 0.0006 + a.peakBuoyancy * 0.0016 : -0.0004,
        seed,
        born: performance.now(),
      };
      parcels.push(p);
      if (parcels.length > MAX_PARCELS) parcels.shift();
      return p;
    };

    /** Re-ask the column what this parcel may do — after the law moved. */
    const relift = (p: Parcel, warmK: number) => {
      const a = liftParcel(Math.min(p.lclKm, p.zKm), rh, lapse, warmK);
      p.lclKm = a.lclKm;
      p.elKm = Math.max(a.elKm, a.lclKm + 0.5);
      p.w = a.peakBuoyancy > 0 ? 0.0006 + a.peakBuoyancy * 0.0016 : -0.0004;
    };

    const nearestParcel = (xKm: number, zKm: number): Parcel | null => {
      let best: Parcel | null = null;
      let bestD = Infinity;
      for (const p of parcels) {
        const d = (p.xKm - xKm) ** 2 + ((p.zKm - zKm) * 2) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return bestD < 900 ? best : null;
    };

    /** A cloud torn: the rag it loses is gone, and the rest spins down. */
    const tearParcel = (p: Parcel, strength: number) => {
      p.mass *= 1 - clamp(strength, 0.1, 0.9);
      p.spin *= 0.4;
      audio.playNote(Math.round(midiForPressure(pressureKPa(p.zKm, lapse))) + 7, 260);
      haptics.chop();
    };

    const soundAltitude = (zKm: number, durMs = 220) => {
      audio.playNote(Math.round(midiForPressure(pressureKPa(zKm, lapse))), durMs);
    };

    const pushRing = (x: number, y: number) => {
      rings.push({ x, y, t0: performance.now() });
      if (rings.length > 12) rings.shift();
    };

    const stirAtAltitude = (zKm: number, push: number) => {
      const g = stirImpulse(zKm, clamp(push, -1, 1));
      for (let n = 0; n < WIND_MODES; n++) amps[n] = clamp(amps[n] + g[n], -1.4, 1.4);
    };

    // ——— the hand's verbs, in the room's own material ———
    const air: Air = {
      tap: (x, y, intensity, count = 1) => {
        const zKm = zForY(y);
        const xKm = xKmForPx(x);
        // rapid-tap ladder: ring → seed puff → warm tower → column scatter
        const tier = tapTrainTier(count);
        const depth = tapTrainDepth(count);
        if (tier === "n") {
          stirTurbulence(0.18 + intensity * 0.25 + depth * 0.15);
          stirAtAltitude(zKm, 0.35 + depth * 0.25);
          for (const p of parcels) p.w += 0.0006 + depth * 0.0004;
          pushRing(x, y);
          soundAltitude(zKm, 320 + Math.round(intensity * 220));
          haptics.roll();
          return;
        }
        if (tier === 5) {
          const p = seedParcel(xKm, zKm, 1.8 + depth * 2.2);
          relift(p, 2.4 + depth * 2);
          p.mass = clamp(p.mass + 0.35 + depth * 0.4, 0, 4.2);
          pushRing(x, y);
          soundAltitude(p.lclKm, 260 + Math.round(intensity * 200));
          stirAtAltitude(zKm, 0.18 + depth * 0.15);
          haptics.bloom();
          return;
        }
        if (tier === 3) {
          const p = seedParcel(xKm, zKm, 0.7 + depth * 0.8);
          pushRing(x, y);
          soundAltitude(zKm, 220 + Math.round(intensity * 180));
          haptics.ripple(0.3 + depth * 0.25);
          void p;
          return;
        }
        pushRing(x, y);
        soundAltitude(zKm, 200 + Math.round(intensity * 180 * (1 + depth * 0.3)));
        const near = nearestParcel(xKm, zKm);
        if (near) near.w += 0.0004 + intensity * 0.0008 + depth * 0.0005;
        haptics.tap();
      },
      tutti: (intensity) => {
        // one synchronized pulse, as strong as it was asked: every cloud
        // takes a breath of buoyancy, and the column sounds ground and
        // tropopause together — the room stating its own two ends
        stirTurbulence(0.12 + intensity * 0.18);
        for (const p of parcels) {
          p.w += 0.0006 + intensity * 0.0007;
          pushRing(pxForXKm(p.xKm), yForZ(p.zKm));
        }
        soundAltitude(0.5, 240);
        soundAltitude(tropopauseKm(lapse), 200);
        haptics.ripple(0.25 + intensity * 0.3);
      },
      stepBack: () => {
        // the frame retreats one step: a raised lens lowers; otherwise the
        // column settles — the stirred wind damps and the haze thins
        if (lens > 0.02) {
          lens = 0;
        } else {
          for (let n = 0; n < WIND_MODES; n++) amps[n] *= 0.6;
          haze = clamp(haze * 0.75 + 0.25, 0.2, 2.2);
        }
        soundAltitude(12, 180);
        haptics.tap();
      },
      plant: (x, y) => {
        const p = seedParcel(xKmForPx(x), zForY(y), 0.6);
        heldParcelId = p.id;
      },
      deepen: (elapsed, x, y) => {
        const p = parcels.find((q) => q.id === heldParcelId);
        if (!p) {
          void x;
          void y;
          return;
        }
        // duration is an axis: the longer the press, the warmer the parcel,
        // the higher its base and the taller it can build
        const warm = clamp(0.6 + elapsed / 620, 0.6, 7);
        p.mass = clamp(p.mass + 0.09, 0, 4.2);
        relift(p, warm);
        if (elapsed > 900 && elapsed % 700 < 60) soundAltitude(p.lclKm, 180);
      },
      ceremony: (x, y) => {
        const n = addNatural(
          "lantern",
          "sky",
          clamp01(x / Math.max(1, width)),
          clamp01(zForY(y) / TOP_KM),
          0.004,
        );
        if (n) {
          lanterns = getNaturalsInZone("sky").slice(-MAX_LANTERNS);
          setHasKept(true);
          writer.schedule();
        }
        heldParcelId = -1;
      },
      timeScale: (k) => {
        timeScale = k;
      },
      stirAt: (x, y, dx, dy) => {
        const zKm = zForY(y);
        const push = clamp(dx * 0.004, -0.5, 0.5);
        if (Math.abs(push) > 0.002) {
          stirAtAltitude(zKm, push);
          stirTurbulence(Math.abs(push) * 0.05);
        }
        const near = nearestParcel(xKmForPx(x), zKm);
        if (near) {
          near.xKm += (dx / Math.max(1, width)) * FRAME_KM * 0.8;
          near.zKm = clamp(near.zKm - (dy / Math.max(1, height)) * 6, 0.3, TOP_KM);
        }
      },
      law: (dx, dy) => {
        const before = lapse;
        lapse = clamp(lapse - dy * 0.004, LAPSE_MIN, LAPSE_MAX);
        sunElev = clamp(sunElev + dx * 0.0016, -0.24, 1.25);
        sunAz += dx * 0.001;
        if (Math.abs(lapse - before) > 0.02) for (const p of parcels) relift(p, 2.4);
      },
      tear: (x, y, angle, speed) => {
        const near = nearestParcel(xKmForPx(x), zForY(y));
        if (near) {
          tearParcel(near, clamp(speed * 0.5, 0.2, 0.85));
          near.xKm += Math.cos(angle) * 12;
        } else {
          stirAtAltitude(zForY(y), clamp(Math.cos(angle) * speed * 0.4, -0.6, 0.6));
        }
      },
      lens: (angle) => {
        lens = clamp01(lens + angle * 0.15);
      },
      season: (angle) => {
        const before = rh;
        rh = clamp(rh + angle * 0.12, 0.06, 1);
        if (Math.abs(rh - before) > 0.01) for (const p of parcels) relift(p, 2.4);
      },
      vortex: (cx, cy, angularVelocity) => {
        const zKm = zForY(cy);
        const xKm = xKmForPx(cx);
        stirAtAltitude(zKm, clamp(angularVelocity * 0.1, -0.4, 0.4));
        const near = nearestParcel(xKm, zKm) ?? seedParcel(xKm, zKm, 1.4);
        near.spin = clamp(near.spin + angularVelocity * 0.4, -3, 3);
        haze = clamp(haze + 0.05, 0.2, 2.2);
        audio.playNote(Math.round(midiForPressure(pressureKPa(zKm, lapse))) + 12, 160);
      },
      gust: (x, y, hits, alternation) => {
        // drumming gusts the layer under each landing, harder as the patter
        // lengthens and steadier hands push steadier wind — seen as a ring,
        // heard at the layer's own pressure
        const roll = clamp01(hits / 9);
        stirAtAltitude(zForY(y), 0.16 + roll * 0.24 + alternation * 0.1);
        stirTurbulence(0.05 + roll * 0.06);
        pushRing(x, y);
        soundAltitude(zForY(y), 90 + Math.round(roll * 90));
        haptics.tap();
      },
      entrain: (bpm, stability) => {
        // the hand's pulse becomes the convective cycle: every beat, each
        // cloud takes a breath of lift for as long as the tempo holds
        entrainBpm = clamp(bpm, 40, 150);
        entrainDepth = clamp01(stability);
        entrainUntil = performance.now() + 9000;
        haptics.tap();
      },
      lid: (ayPx, byPx, elapsed, phase) => {
        // span — two still fingers pin two altitudes and hold the air
        // between them: a capping lid, by hand. The wind in the band damps,
        // climbing parcels flatten under it (deeper the longer it stands),
        // and both levels sound as one held interval. Release lets the
        // band convect again with a stir sized by the wait.
        const zLo = zForY(Math.max(ayPx, byPx));
        const zHi = zForY(Math.min(ayPx, byPx));
        const depth = clamp01(elapsed / 4000);
        if (phase === "release") {
          stirAtAltitude((zLo + zHi) / 2, 0.2 + depth * 0.3);
          for (const p of parcels) {
            if (p.zKm > zLo && p.zKm < zHi) p.w += 0.0005 + depth * 0.0008;
          }
          soundAltitude((zLo + zHi) / 2, 220);
          haptics.ripple(0.2 + depth * 0.3);
          return;
        }
        for (let n = 0; n < WIND_MODES; n++) amps[n] *= 1 - 0.015 - depth * 0.02;
        for (const p of parcels) {
          if (p.zKm > zLo && p.zKm < zHi) p.w *= 0.9 - depth * 0.2;
        }
        if (phase === "enter" || elapsed % 900 < 60) {
          soundAltitude(zLo, 200);
          soundAltitude(zHi, 180);
          pushRing(width * 0.5, yForZ(zHi));
          haptics.ripple(0.12 + depth * 0.18);
        }
      },
      scatter: (intensity) => {
        stirTurbulence(intensity * 0.6);
        stirAtAltitude(2 + intensity * 14, intensity * 0.8);
        // a gust tears at every cloud at once
        for (const p of parcels) p.mass *= 1 - clamp(intensity * 0.35, 0, 0.6);
      },
      gravity: (gamma) => {
        // the world leaning adds the net momentum a finger's stir never can
        tiltWind = clamp(gamma / 40, -1.2, 1.2);
      },
      ring: (intensity) => {
        // the column rings: a pressure wave walks the profile from the ground
        // up, sounding each layer it passes
        stirTurbulence(intensity * 0.25);
        const zs = [0.4, 2, 6, 12, 24, 48];
        zs.forEach((z, i) => {
          window.setTimeout(() => {
            if (!running) return;
            soundAltitude(z, 200);
            pushRing(width * 0.5, yForZ(z));
          }, i * 110);
        });
        for (const p of parcels) p.w += 0.0007 * intensity;
      },
      night: (faceDown) => {
        night = faceDown;
      },
      glimmer: () => {
        glimmerAt = performance.now();
      },
      reduced: (on) => {
        reduced = on;
      },
      clear: () => {
        lanterns = [];
        commitZone("sky", []);
        setHasKept(false);
      },
      keySun: (dx) => {
        sunElev = clamp(sunElev + dx * 0.05, -0.24, 1.25);
      },
      keyLapse: (dy) => {
        lapse = clamp(lapse - dy * 0.25, LAPSE_MIN, LAPSE_MAX);
        for (const p of parcels) relift(p, 2.4);
      },
      unmake: () => {
        const p = parcels[parcels.length - 1];
        if (p) tearParcel(p, 0.9);
      },
    };
    airRef.current = air;

    // ——— the loop ———
    const draw = (now: number) => {
      if (!running) return;
      const dtRaw = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tier = gov.beginFrame(now);
      const dt = dtRaw * timeScale;
      const t = (audio.getAudioTime() ?? now / 1000) * timeScale;

      // the shared calm↔storm axis: this room owns the frame, so it relaxes
      relaxTurbulence(now);
      const agitation = getTurbulence();

      // stirs ring and settle; the sky never keeps a grudge
      let ampSum = 0;
      for (let n = 0; n < WIND_MODES; n++) {
        amps[n] *= Math.exp(-dt * 0.16);
        ampSum += Math.abs(amps[n]);
      }
      haze += (1 - haze) * (1 - Math.exp(-dt * 0.02));
      // wrapped so a long visit never loses the noise field's precision
      if (!asleep && !reduced) drift = (drift + dt * 2.2) % 4096;

      // the sun keeps its own slow arc; face-down walks it under
      const base = night ? -0.22 : sunElev;
      shownElevNow = reduced || night ? base : base + Math.sin(t * 0.011) * 0.05;
      if (now - rowsAt > 480) {
        rowsAt = now;
        rebuildRows();
      }

      // ——— the parcels live ———
      if (!asleep) {
        // the entrained pulse: while the hand's tempo holds, every beat
        // lifts the thermals together and the ground sounds its pressure
        if (now < entrainUntil && entrainBpm > 0) {
          const beatIdx = Math.floor((now / 1000) * (entrainBpm / 60));
          if (beatIdx !== lastEntrainBeat) {
            lastEntrainBeat = beatIdx;
            for (const p of parcels) p.w += 0.0004 + entrainDepth * 0.0005;
            pushRing(width * (0.3 + (beatIdx % 3) * 0.2), yForZ(0.8));
            audio.playNote(Math.round(midiForPressure(pressureKPa(0.8, lapse))) - 12, 90);
          }
        }
        for (const p of parcels) {
          const shear = shearAt(p.zKm, amps, lapse);
          if (!reduced) {
            // it rises while it is warmer than the column, and settles at the
            // ceiling the column gave it
            const gap = p.elKm - p.zKm;
            p.w += clamp(gap, -1, 1) * 0.00035 * dt * 60;
            p.w *= Math.exp(-dt * 0.5);
            p.zKm = clamp(p.zKm + p.w * dt * 60, 0.25, TOP_KM);
            p.xKm += (windAt(p.zKm, amps, lapse) + tiltWind * 0.55) * dt * 1.5;
            if (p.xKm > FRAME_KM * 0.72) p.xKm -= FRAME_KM * 1.44;
            if (p.xKm < -FRAME_KM * 0.72) p.xKm += FRAME_KM * 1.44;
            p.spin *= Math.exp(-dt * 0.25);
          }
          // entrainment and shear eat it
          p.mass -= p.mass * dissipationRate(p.mass, shear, rh) * dt * 0.35;
        }
        // clouds that meet become one — mass and momentum carried, never made
        for (let i = 0; i < parcels.length; i++) {
          for (let j = i + 1; j < parcels.length; j++) {
            if (!parcelsTouch(parcels[i], parcels[j])) continue;
            const a = parcels[i];
            const b = parcels[j];
            const merged = mergeParcels(a, b);
            parcels.splice(j, 1);
            parcels[i] = merged;
            if (heldParcelId === a.id || heldParcelId === b.id) heldParcelId = merged.id;
            audio.playNote(Math.round(midiForPressure(pressureKPa(merged.zKm, lapse))) - 5, 420);
            haptics.ripple(0.35);
            j--;
          }
        }
        const before = parcels.length;
        parcels = parcels.filter((p) => p.mass > PARCEL_MIN_MASS);
        if (parcels.length !== before) haptics.tap();
      }

      // ——— lanterns ride the wind of their own layer ———
      if (!asleep && !reduced && lanterns.length) {
        for (const l of lanterns) {
          const zKm = l.ny * TOP_KM;
          l.nx = (((l.nx + (windAt(zKm, amps, lapse) + tiltWind * 0.55) * dt * 0.012) % 1) + 1) % 1;
        }
        if (now - lanternWriteAt > 4000) {
          lanternWriteAt = now;
          writer.schedule();
        }
      }

      // ——— the volume ———
      if (stage && prog && quad && !stage.contextLost()) {
        let n = 0;
        for (const p of parcels) {
          if (n >= GL_PARCELS) break;
          const rad = parcelRadiusKm(p.mass);
          const top = Math.max(p.lclKm + 0.6, Math.min(p.zKm + rad * 1.2, p.elKm + rad));
          parcelA[n * 4] = p.xKm;
          parcelA[n * 4 + 1] = p.zKm;
          parcelA[n * 4 + 2] = rad;
          parcelA[n * 4 + 3] = clamp(0.7 + p.mass * 0.35, 0, 2.4);
          parcelB[n * 4] = p.lclKm;
          parcelB[n * 4 + 1] = top;
          parcelB[n * 4 + 2] = p.spin;
          parcelB[n * 4 + 3] = ((p.seed % 41) - 20) * 0.4;
          n++;
        }
        let ln = 0;
        for (const l of lanterns) {
          if (ln >= GL_LANTERNS) break;
          lanternU[ln * 4] = l.nx;
          lanternU[ln * 4 + 1] = l.ny * TOP_KM;
          lanternU[ln * 4 + 2] = 0.55;
          lanternU[ln * 4 + 3] = (l.seed % 1000) / 1000;
          ln++;
        }

        prog.use();
        stage.beginFrame(
          clocksFrom({ time: reduced ? 12 : t, turbulence: agitation, reducedMotion: reduced }),
          prog,
        );
        prog.setFloat("uLapse", lapse);
        prog.setFloat("uSunElev", shownElevNow);
        prog.setFloat("uSunAz", sunAz);
        prog.setFloat("uHaze", haze);
        prog.setFloat("uRH", rh);
        prog.setFloat("uDrift", drift);
        prog.setVec3("uAmpsA", amps[0], amps[1], amps[2]);
        prog.setVec3("uAmpsB", amps[3], amps[4], amps[5]);
        prog.setFloat("uTilt", tiltWind);
        prog.setFloat("uSteps", tier === "low" || tier === "sleep" ? 14 : tier === "medium" ? 20 : 28);
        prog.setFloat("uParcelN", n);
        prog.setFloat("uLanternN", ln);
        const la = prog.location("uParcelA[0]");
        if (la) stage.gl.uniform4fv(la, parcelA);
        const lb = prog.location("uParcelB[0]");
        if (lb) stage.gl.uniform4fv(lb, parcelB);
        const ll = prog.location("uLantern[0]");
        if (ll) stage.gl.uniform4fv(ll, lanternU);
        quad.draw();
      }

      // ——— the overlay: thin ink over the air ———
      if (octx) {
        octx.clearRect(0, 0, width, height);

        // the first stars, where the air has run out
        for (const st of stars) {
          const row = clamp(Math.floor(st.v * STAR_ROWS), 0, STAR_ROWS - 1);
          const d = rowDark[row];
          if (d <= 0.03) continue;
          const tw = reduced ? 0.85 : 0.6 + 0.4 * Math.sin(t * 1.7 + st.ph);
          octx.fillStyle = `rgba(238,242,255,${(0.8 * d * tw).toFixed(3)})`;
          octx.fillRect(st.u * width, st.v * height, st.r, st.r);
        }

        rings = rings.filter((r) => now - r.t0 < 1400);
        for (const r of rings) {
          const u = (now - r.t0) / 1400;
          octx.beginPath();
          octx.strokeStyle = `rgba(240,246,255,${(0.55 * (1 - u)).toFixed(3)})`;
          octx.lineWidth = 1.8 - u;
          octx.ellipse(r.x, r.y, 8 + u * 90, (8 + u * 90) * 0.42, 0, 0, Math.PI * 2);
          octx.stroke();
        }

        // the lens: the same column as its own diagram
        if (lens > 0.02) {
          octx.save();
          octx.globalAlpha = lens;
          octx.fillStyle = "rgba(9,12,18,0.42)";
          octx.fillRect(0, 0, width, height);
          const zt = tropopauseKm(lapse);
          for (const p of ISOBARS_KPA) {
            const y = yForZ(altitudeForPressure(p, lapse));
            if (y < 4 || y > height - 2) continue;
            octx.strokeStyle = "rgba(238,234,219,0.5)";
            octx.lineWidth = 1;
            octx.beginPath();
            octx.moveTo(0, y);
            octx.lineTo(width, y);
            octx.stroke();
          }
          // the tropopause, where the law bends
          const yT = yForZ(zt);
          octx.strokeStyle = "rgba(231,172,82,0.75)";
          octx.setLineDash([6, 5]);
          octx.beginPath();
          octx.moveTo(0, yT);
          octx.lineTo(width, yT);
          octx.stroke();
          octx.setLineDash([]);
          // the profile's other half: the wind, barb by barb
          octx.lineWidth = 1.4;
          const bx = width * 0.13;
          for (let k = 0; k <= 16; k++) {
            const z = TOP_KM * Math.pow(k / 16, Z_EXP) * 0.42;
            const y = yForZ(z);
            const w = windAt(z, amps, lapse) + tiltWind * 0.55;
            octx.strokeStyle = "rgba(143,181,232,0.7)";
            octx.beginPath();
            octx.moveTo(bx, y);
            octx.lineTo(bx + w * width * 0.09, y);
            octx.stroke();
          }
          // the two curves the moisture lives between
          const curve = (f: (z: number) => number, color: string) => {
            octx.strokeStyle = color;
            octx.lineWidth = 1.6;
            octx.beginPath();
            for (let k = 0; k <= 40; k++) {
              const z = (k / 40) * 26;
              const x = width * 0.52 + (f(z) - 240) * width * 0.0055;
              const y = yForZ(z);
              if (k === 0) octx.moveTo(x, y);
              else octx.lineTo(x, y);
            }
            octx.stroke();
          };
          curve((z) => temperatureK(z, lapse), "rgba(226,140,96,0.8)");
          curve(
            (z) =>
              dewPointK(
                pressureKPa(z, lapse),
                rh * satMixingRatio(pressureKPa(z, lapse), temperatureK(z, lapse)),
              ),
            "rgba(126,190,152,0.8)",
          );
          // every cloud base, where the air actually condenses
          for (const p of parcels) {
            octx.strokeStyle = "rgba(238,234,219,0.55)";
            octx.setLineDash([2, 4]);
            octx.beginPath();
            octx.moveTo(pxForXKm(p.xKm) - 40, yForZ(p.lclKm));
            octx.lineTo(pxForXKm(p.xKm) + 40, yForZ(p.lclKm));
            octx.stroke();
            octx.setLineDash([]);
          }
          octx.restore();
        }

        // the glimmer, when the shell says the hand has gone quiet: a stir's
        // ghost sliding along a haze bank. Physical, never text.
        if (glimmerAt && now - glimmerAt < 1600) {
          const u = (now - glimmerAt) / 1600;
          const y = yForZ(bankZ[2] ?? 4);
          octx.strokeStyle = `rgba(238,234,219,${(0.22 * (1 - u)).toFixed(3)})`;
          octx.lineWidth = 1.5;
          octx.beginPath();
          octx.moveTo(width * (0.3 - u * 0.06), y);
          octx.bezierCurveTo(
            width * 0.42,
            y - 12 * u,
            width * 0.55,
            y + 12 * u,
            width * (0.68 + u * 0.06),
            y,
          );
          octx.stroke();
        }
      }

      // the wind heard: the strongest shear finds a voice now and then
      if (!asleep && !reduced && now - windAtMs > 5600) {
        windAtMs = now;
        const zt = tropopauseKm(lapse);
        const s = Math.abs(shearAt(zt - 2, amps, lapse)) + ampSum * 0.2 + Math.abs(tiltWind) * 0.1;
        if (s > 0.05) {
          try {
            audio.playTone(96 + Math.min(1, s * 3) * 260, 2.6);
          } catch {
            /* the sea is not awake */
          }
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      airRef.current = null;
      unvis();
      ungal();
      unworld();
      writer.flush();
      quad?.dispose();
      stage?.dispose();
      cancelAnimationFrame(raf);
    };
  }, []);

  // The verbs, in the shell's vocabulary. Each reads through the ref so the
  // engine never loses an in-flight hold when React re-renders.
  const voice = useMemo<RoomVoice>(
    () => ({
      tap: (e) => airRef.current?.tap(e.x, e.y, e.intensity, e.count),
      tutti: (e) => airRef.current?.tutti(e.intensity),
      stepBack: () => airRef.current?.stepBack(),
      plant: (e) => airRef.current?.plant(e.x, e.y),
      deepen: (e) => airRef.current?.deepen(e.elapsed, e.x, e.y),
      ceremony: (e) => airRef.current?.ceremony(e.x, e.y),
      timeScale: (k) => airRef.current?.timeScale(k),
      drag: (e) => airRef.current?.stirAt(e.x, e.y, e.dx, e.dy),
      wind: (e) => airRef.current?.law(e.dx, e.dy),
      flick: (e) => airRef.current?.tear(e.x, e.y, e.angle, e.speed),
      stir: (e) => airRef.current?.vortex(e.cx, e.cy, e.angularVelocity),
      lens: (e) => airRef.current?.lens(e.angle),
      season: (e) => airRef.current?.season(e.angle),
      drum: (e) => airRef.current?.gust(e.x, e.y, e.hits, e.alternation),
      rhythm: (e) => airRef.current?.entrain(e.bpm, e.stability),
      sustain: (e) => airRef.current?.lid(e.ay, e.by, e.elapsed, e.phase),
      scatter: (e) => airRef.current?.scatter(e.intensity),
      gravity: (e) => airRef.current?.gravity(e.gamma),
      knock: (e) => airRef.current?.ring(e.intensity),
      night: (e) => airRef.current?.night(e.faceDown),
    }),
    [],
  );

  const keyboard = useMemo(
    () => ({
      // enter lifts a parcel out of the middle of the frame; holding it warms
      // that same parcel, exactly as a press does
      enter: () => airRef.current?.plant(0.5 * window.innerWidth, 0.86 * window.innerHeight),
      enterHeld: (elapsed: number) =>
        airRef.current?.deepen(elapsed, 0.5 * window.innerWidth, 0.86 * window.innerHeight),
      escape: () => airRef.current?.lens(-8),
      arrow: (dx: number, dy: number) => {
        if (dx) airRef.current?.keySun(dx);
        if (dy) airRef.current?.keyLapse(dy);
      },
    }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Backspace" || e.key === "Delete") airRef.current?.unmake();
      if (e.key === "[") airRef.current?.season(-0.5);
      if (e.key === "]") airRef.current?.season(0.5);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const letGo = useCallback(() => {
    airRef.current?.clear();
    getFieldAudio().thud();
    haptics.roll();
    setHasKept(false);
  }, []);

  return (
    <RoomShell
      route="/atmosphere"
      surfaceRef={skyRef}
      voice={voice}
      keyboard={keyboard}
      onGlimmer={() => airRef.current?.glimmer()}
      onReducedMotion={(on) => airRef.current?.reduced(on)}
      letGo={{ label: "let the lanterns go", onLetGo: letGo, visible: hasKept }}
      style={{ position: "fixed", inset: 0, background: "#0a1526" }}
    >
      <canvas
        ref={skyRef}
        role="application"
        tabIndex={0}
        aria-label="the air column above the peak"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
          outline: "none",
        }}
      />
      <canvas
        ref={overlayRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </RoomShell>
  );
}
