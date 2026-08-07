"use client";

/**
 * /observe — one substance, five altitudes.
 *
 * A pinch-through in the /drop band: the widest view is a small heap of
 * crystalline solid on a matte-black bench-top (zoom 1, "crystal"); pinch
 * in and the crystal falls into a beaker of solvent (2–16, the "dissolve"
 * transition); the cuvette-from-above (Phase 1's material) fills the frame
 * (16–256, "solution"); one molecule swells out of the population and
 * dominates the frame (256–1024 "moleculeZoom" transition, then 1024–2048
 * "molecule"); pinching in further reveals that molecule's aromatic ring
 * alone — its π-cloud pulsing with the room breath, a small HOMO/LUMO
 * diagram in a corner, a photon descending from the finger's y that either
 * kicks an electron across the gap or passes through unabsorbed (2048–4096,
 * "chromophore"). The subject is one substance the maker knows; the room
 * carries the reticence about naming it (§manifest voice).
 *
 * The room OWNS pinch. useBandEdgeTravel maps the internal 1..4096 zoom
 * onto the /drop band via OBSERVE_ZOOM_SPEC, so residual pinch at the two
 * extremes still presses the manifold's band walls (the same detent, the
 * same 320 ms of intent as every yielded-frame room), but between the walls
 * the camera is entirely the room's own composition. AxisChrome is told
 * `travel: false` in the room manifest.
 *
 * Every physics law lives in @/lib/observe.ts; this file is the rendering
 * and gesture wiring. RoomShell owns the vessel bus, the glimmer clock and
 * the quiet clear; a second gesture handler in this component owns pinch
 * and the two-finger drag (pan2) for altitude-specific meanings.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { useBandEdgeTravel } from "@/components/ScaleTravel";
import { getFieldAudio } from "@/lib/audio";
import { attachGestures } from "@/lib/gesture";
import * as haptics from "@/lib/haptics";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { tapTrainTier } from "@/lib/gesture/core";
import { createGLStage, FULLSCREEN_VERT_UNIT } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  type QualityTier,
} from "@/lib/room-runtime";
import {
  createPopulation,
  hashSeed as sceneHashSeed,
  mulberry32 as sceneMulberry32,
  type SceneObjectSpec,
  type SceneObjectState,
} from "@/lib/scene/object";
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
import {
  ALTITUDE_BOUNDS,
  BAND_N,
  BAND_PI,
  CRYSTAL_CAP,
  MOLECULE_CAP,
  OBSERVE_STORAGE_KEY,
  OBSERVE_ZOOM_SPEC,
  REFERENCE_CONCENTRATION,
  SPECTRUM_BINS,
  SPECTRUM_MAX,
  altitudeFromZoom,
  altitudeWeights,
  bornCrystalFlake,
  bornMolecule,
  bornMolecule3D,
  chromophoreBoxLength,
  createSpectrumAccumulator,
  crystalCaustics,
  flipChirality,
  loadSpectrum,
  moTransitionEnergy,
  moleculeRadius,
  photonHit,
  resonant,
  rotateMolecule,
  sampleAbsorbance,
  serializeSpectrum,
  spectrumAdd,
  spectrumDecay,
  spectrumPeak,
  stepChromophorePhotons,
  stepCrystal,
  stepMolecule,
  stepMolecules,
  wavelengthAtBin,
  wavelengthToRgb,
  wavelengthToX,
  xToWavelength,
  type Altitude,
  type ChromophorePhoton,
  type CrystalFlake,
  type FieldInput,
  type Molecule,
  type MoleculeState,
  type SpectrumAccumulator,
} from "@/lib/observe";

// ——— rendering constants ————————————————————————————————————————————
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

// ——— the material: five altitudes, one substance —————————————
// The shader composes four altitude layers weighted by uAlt* uniforms
// (crystal, solution, molecule, chromophore). Inside a transition band two
// neighbouring weights are non-zero and their materials alpha-blend into
// each other — the visitor SEES the crystal dissolve into the bath, the
// bath shrink around one molecule, the molecule fade behind its π-cloud.
const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uBreath;
uniform float uTurbulence;
uniform float uReduced;

uniform float uBeamOn;         // 0..1 how present the beam is
uniform float uBeamX;          // 0..1 wavelength-x of the beam
uniform vec3  uBeamRgb;        // the beam's color (from wavelengthToRgb)
uniform float uBeamAbsorb;     // 0..1 current absorbance at that wavelength
uniform float uConcentration;  // ratio to reference (drives wall darkening)
uniform float uStir;           // 0..1 vortex intensity
uniform vec2  uTilt;           // -1..1 gravity lean
uniform float uNight;          // 0..1 face-down — fingerprint-only
uniform float uLens;           // 0..2 lens tier: 0 raw, 1 A(λ), 2 orbital
uniform float uBroaden;        // 0..1 thermal broadening (shake)
uniform float uSustainLambda;  // -1 if off, else λ of the sustained span
uniform float uSustainAbsorb;  // absorbance at the sustained λ
uniform vec3  uSustainRgb;     // color of the sustained beam

// ——— altitude weights: sum to 1, one or two non-zero at a time ——
uniform float uAltCrystal;      // 0..1 weight of the crystal-on-bench layer
uniform float uAltSolution;     // 0..1 weight of the cuvette-from-above layer
uniform float uAltMolecule;     // 0..1 weight of the ball-and-stick backdrop
uniform float uAltChromophore;  // 0..1 weight of the π-cloud layer
uniform float uMoleculeSeed;    // deterministic hue seed for the crystal caustics

varying vec2 vUv;

// ——— cheap noise —————————————————————————————————————————————
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.55; }
  return v;
}

// ——— wavelength → RGB, mirrored from lib/observe.ts —————————————
// The palette is a pedagogical remapping of 200–800 nm onto visible light
// (documented in lib/observe.ts). Kept in the shader to color the wall
// under the beam and the axis stripe at rest — the CPU path and this must
// agree, so a change in one must move the other.
vec3 wavelengthRgb(float nm) {
  float w = clamp(nm, 200.0, 800.0);
  float r = 0.0, g = 0.0, b = 0.0;
  if (w < 380.0) {
    float t = (w - 200.0) / 180.0;
    r = 0.15 + 0.35 * t; g = 0.0; b = 0.25 + 0.55 * t;
  } else if (w < 440.0) {
    r = -(w - 440.0) / 60.0; g = 0.0; b = 1.0;
  } else if (w < 490.0) {
    r = 0.0; g = (w - 440.0) / 50.0; b = 1.0;
  } else if (w < 510.0) {
    r = 0.0; g = 1.0; b = -(w - 510.0) / 20.0;
  } else if (w < 580.0) {
    r = (w - 510.0) / 70.0; g = 1.0; b = 0.0;
  } else if (w < 645.0) {
    r = 1.0; g = -(w - 645.0) / 65.0; b = 0.0;
  } else if (w < 780.0) {
    r = 1.0; g = 0.0; b = 0.0;
  } else {
    float t = (w - 780.0) / 20.0;
    r = 1.0 - t * 0.6; g = 0.0; b = 0.0;
  }
  float f = 1.0;
  if (w < 380.0) f = 0.35 + 0.65 * ((w - 200.0) / 180.0);
  else if (w > 700.0) f = 1.0 - 0.7 * min(1.0, (w - 700.0) / 100.0);
  return clamp(vec3(r, g, b) * f, 0.0, 1.0);
}

// Absorbance for the two Gaussians. Kept in the shader so the wall paint
// under the beam can vary continuously across the frame — the ghost
// spectrum along the top mirrors this exactly, from the CPU's ε(λ).
float gaussBand(float lambda, float center, float width, float epsMax, float broaden) {
  float w = width * (1.0 + broaden);
  float z = (lambda - center) / w;
  return epsMax * exp(-z * z);
}
float sampleAbsorbance(float lambda, float conc) {
  float eps =
    gaussBand(lambda, ${BAND_PI.center.toFixed(1)}, ${BAND_PI.width.toFixed(1)}, ${BAND_PI.epsilonMax.toFixed(1)}, uBroaden) +
    gaussBand(lambda, ${BAND_N.center.toFixed(1)}, ${BAND_N.width.toFixed(1)}, ${BAND_N.epsilonMax.toFixed(1)}, uBroaden);
  return eps * conc * ${(REFERENCE_CONCENTRATION).toExponential(3)};
}

// ——— the solvent bath ——————————————————————————————————————
vec3 bathColor(vec2 uv, float breath) {
  // A slightly refractive teal, with two-octave turbulence rolled in and a
  // subtle warp from the vortex if the finger is stirring. Reads uBreath so
  // the whole bath is alive at rest.
  float aspect = uRes.x / max(1.0, uRes.y);
  vec2 wp = vec2(uv.x * aspect, uv.y) * 3.2 + vec2(uTime * 0.06, uTime * 0.04);
  float base = fbm(wp);
  float mid = fbm(wp * 2.1 + vec2(1.7, 0.4));
  vec3 shallow = vec3(0.08, 0.20, 0.28);
  vec3 deep = vec3(0.04, 0.11, 0.16);
  vec3 c = mix(deep, shallow, 0.35 + 0.4 * base + 0.15 * mid);
  c *= 0.92 + 0.12 * breath;
  return c;
}

// ——— crystal-on-bench layer ————————————————————————————————
// A matte-black bench-top with a soft overhead lamp pool, and caustic light
// lines scattered across the bench beneath the (2D-overlay-drawn) flakes.
// The JS twin (crystalCaustics in lib/observe) matches this in shape so the
// tests can pin the caustic; only the seed axis is quantized differently.
float crystalCausticsGLSL(float x, float y, float tSec, float seed) {
  float s = fract(seed * 0.0000152587890625); // /0x10000 → 0..1
  float kx = 8.5 + s * 4.0;
  float ky = 9.7 - s * 3.0;
  float t = tSec * 0.4 + s * 6.2831853;
  float a = sin(x * kx + t) * cos(y * ky - t * 0.7);
  float b = sin((x + y) * (kx * 0.6) + t * 0.9) * cos((x - y) * (ky * 0.6));
  return clamp(0.5 + 0.5 * (a * 0.6 + b * 0.4), 0.0, 1.0);
}

vec3 crystalMaterial(vec2 uv, float breath) {
  float aspect = uRes.x / max(1.0, uRes.y);
  // matte-black bench with a very subtle warm gradient (no gradient calls
  // needed — pure math, per pixel).
  vec3 bench = vec3(0.02, 0.02, 0.03);
  // overhead lamp pool, centered slightly above the visual center
  vec2 pool = (uv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
  float pd = length(pool);
  float lampFall = exp(-pd * pd * 3.4);
  bench += vec3(0.08, 0.07, 0.05) * lampFall * (0.75 + 0.25 * breath);
  // caustic scatter on the bench beneath the flakes
  float causticZone = smoothstep(0.55, 0.86, uv.y);
  float c = crystalCausticsGLSL(uv.x, uv.y, uTime, uMoleculeSeed);
  bench += vec3(0.22, 0.24, 0.28) * causticZone * pow(c, 2.5) * (0.55 + 0.45 * breath) * (1.0 - 0.4 * uReduced);
  return bench;
}

// ——— molecule backdrop layer ——————————————————————————————
// A darkened lab background — a soft warm haze from the lamp — over which
// the 2D overlay draws the ball-and-stick model itself. The shader's job
// here is only to hold a neutral dark frame while the overlay carries the
// geometry (bonds, atoms, chair-flip in progress).
vec3 moleculeBackdrop(vec2 uv, float breath) {
  float aspect = uRes.x / max(1.0, uRes.y);
  vec2 p = (uv - vec2(0.5)) * vec2(aspect, 1.0);
  float d = length(p);
  vec3 bg = vec3(0.03, 0.035, 0.055);
  bg += vec3(0.06, 0.05, 0.08) * exp(-d * d * 2.6) * (0.6 + 0.35 * breath);
  return bg;
}

// ——— chromophore π-cloud layer ————————————————————————————
// The aromatic ring's electron density: two soft translucent lobes above
// and below the ring's plane (the plane is drawn by the overlay). The
// lobes pulse with the room breath — that pulse IS the electron cloud
// filled by the shared 7s clock, the atomic-scale beat of the album.
vec3 chromophoreLobes(vec2 uv, float breath) {
  float aspect = uRes.x / max(1.0, uRes.y);
  vec2 p = (uv - vec2(0.5)) * vec2(aspect, 1.0);
  // Two lobes centered on x=0, above and below the ring plane at y=0.
  vec2 topP = vec2(p.x, p.y - 0.20);
  vec2 botP = vec2(p.x, p.y + 0.20);
  float topD = dot(topP, vec2(1.0, 1.6)); // stretch vertically
  float botD = dot(botP, vec2(1.0, 1.6));
  float top = exp(-dot(topP, topP) * 8.0) * (0.55 + 0.45 * breath);
  float bot = exp(-dot(botP, botP) * 8.0) * (0.55 + 0.45 * breath);
  vec3 c = vec3(0.02, 0.03, 0.05);
  c += vec3(0.42, 0.30, 0.55) * (top + bot);
  // subtle radial vignette so the frame reads as a portrait of the ring
  float r = length(p);
  c *= 1.0 - 0.35 * smoothstep(0.35, 0.85, r);
  return c;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);

  // subtle vortex distortion when the finger stirs — read only through the
  // solution weight so the crystal or molecule altitudes never warp
  float stirActive = uStir * uAltSolution;
  if (stirActive > 0.02) {
    vec2 sp = (uv - vec2(0.5)) * vec2(aspect, 1.0);
    float ang = atan(sp.y, sp.x);
    float rr = length(sp);
    float twist = stirActive * 0.06 * exp(-rr * 4.0);
    float ca = cos(ang + twist), sa = sin(ang + twist);
    uv = vec2(0.5) + vec2(ca, sa) * rr / vec2(aspect, 1.0);
  }
  // tilt lean — reads across all altitudes so a leaned device slides the
  // crystal heap, the beaker's surface, and the molecule alike
  uv.x += uTilt.x * 0.010 * (1.0 - abs(uv.y - 0.5) * 2.0);
  uv.y += uTilt.y * 0.010 * (1.0 - abs(uv.x - 0.5) * 2.0);

  // ——— the solution-altitude material (Phase 1's cuvette-from-above) ——
  vec3 solutionCol = bathColor(uv, uBreath);
  if (uBeamOn > 0.01) {
    float xdiff = abs(uv.x - uBeamX) * aspect;
    float shaft = exp(-xdiff * xdiff * 380.0);
    float trans = pow(10.0, -uBeamAbsorb * (uv.y * 0.7 + 0.15));
    vec3 beamCol = uBeamRgb * (0.55 + 0.45 * uBreath) * (0.7 + 0.3 * trans);
    solutionCol += beamCol * shaft * uBeamOn * (0.85 - 0.25 * uNight);
    float wallY = smoothstep(0.94, 0.98, uv.y);
    float wallTrans = pow(10.0, -uBeamAbsorb);
    vec3 wallCol = uBeamRgb * wallTrans;
    solutionCol = mix(solutionCol, wallCol * 1.2, wallY * shaft * uBeamOn);
  }
  if (uSustainLambda > 199.5) {
    float xs = clamp((uSustainLambda - 200.0) / 600.0, 0.0, 1.0);
    float xdiff = abs(uv.x - xs) * aspect;
    float shaft = exp(-xdiff * xdiff * 380.0);
    float trans = pow(10.0, -uSustainAbsorb * (uv.y * 0.7 + 0.15));
    solutionCol += uSustainRgb * shaft * 0.6 * (0.7 + 0.3 * trans);
    float wallY = smoothstep(0.94, 0.98, uv.y);
    float wallTrans = pow(10.0, -uSustainAbsorb);
    solutionCol = mix(solutionCol, uSustainRgb * wallTrans * 1.2, wallY * shaft * 0.9);
  }
  if (uNight > 0.01) {
    float stripY = smoothstep(0.02, 0.0, uv.y);
    float nm = 200.0 + uv.x * 600.0;
    float A = sampleAbsorbance(nm, uConcentration);
    float darken = 1.0 - clamp(A * 0.7, 0.0, 0.9);
    vec3 stripCol = wavelengthRgb(nm) * darken;
    solutionCol = mix(solutionCol * (1.0 - uNight * 0.75), stripCol, stripY * uNight);
  }
  if (uLens > 0.5) {
    float nm = 200.0 + uv.x * 600.0;
    float A = sampleAbsorbance(nm, uConcentration);
    float chartH = 0.35 + clamp(A / 1.6, 0.0, 0.95);
    float band = exp(-pow((uv.y - (1.0 - chartH)) * 100.0, 2.0));
    solutionCol = mix(solutionCol, wavelengthRgb(nm) * 0.85, band * uLens * 0.32);
  }
  if (uLens > 1.5) {
    vec2 op = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
    float dist = length(op);
    float homo = smoothstep(0.14, 0.13, dist);
    float lumo = smoothstep(0.30, 0.29, dist) - smoothstep(0.29, 0.28, dist);
    solutionCol = mix(solutionCol, vec3(1.0), (homo * 0.15 + lumo * 0.20) * (uLens - 1.0));
  }

  // ——— the four altitude layers, weighted and summed ——
  vec3 crystalCol = crystalMaterial(uv, uBreath);
  vec3 moleculeCol = moleculeBackdrop(uv, uBreath);
  vec3 chromophoreCol = chromophoreLobes(uv, uBreath);
  vec3 col =
      crystalCol * uAltCrystal
    + solutionCol * uAltSolution
    + moleculeCol * uAltMolecule
    + chromophoreCol * uAltChromophore;

  // vignette shared across every altitude
  vec2 vd = (uv - vec2(0.5)) * vec2(aspect, 1.0);
  col *= 1.0 - 0.28 * smoothstep(0.20, 0.90, dot(vd, vd));

  gl_FragColor = vec4(col, 1.0);
}
`;

// ——— molecule view for the shared population layer ——————————————————
type MoleculeView = SceneObjectState & {
  excited: number;
  lastLambda: number;
};

// A rich fragment for molecules: a soft SDF disc + a strong additive corona
// whose color is the *last absorbed* wavelength (via vHue mapped from λ).
// A resting molecule (excited=0) reads as a pale bath-tinted disc; an
// excited molecule blooms in the color of its emission. Kept mediump.
const MOLECULE_FRAG = `precision mediump float;
varying vec2 vLocal;
varying float vHue;
varying float vGlow;
varying float vPhase;
varying float vAlpha;
uniform vec3 u_palA;
uniform vec3 u_palB;
uniform vec3 u_palC;

vec3 pickPalette(float h) {
  h = clamp(h, 0.0, 1.0);
  return h < 0.5 ? mix(u_palA, u_palB, h * 2.0) : mix(u_palB, u_palC, (h - 0.5) * 2.0);
}

void main() {
  float d = length(vLocal);
  // shudder: a small ring perturbation when excited (vPhase encodes phase)
  float shudder = 0.9 + 0.1 * sin(vPhase * 6.2831 * 3.0);
  float core = 1.0 - smoothstep(0.55 * shudder, 0.90 * shudder, d);
  float corona = exp(-d * d * 1.8) * vGlow;
  float a = clamp(core * 0.85 + corona, 0.0, 1.0) * vAlpha;
  if (a <= 0.003) discard;
  vec3 body = mix(u_palA * 0.7, u_palC, vGlow * 0.7);
  vec3 emissColor = pickPalette(vHue);
  vec3 c = mix(body, emissColor, vGlow);
  gl_FragColor = vec4(c * a, a);
}`;

// Reserved wavelength code that means "no beam". Kept < 200 so the shader
// checks `uSustainLambda > 199.5` to decide whether the second beam draws.
const NO_LAMBDA = -1;

// ——— molecule projection & tap picking ————————————————————————————
// A tiny orthographic projection: rotate every atom around the model's
// local origin by the state's euler angles, then scale into screen pixels.
// No perspective divide — the molecule sits close enough that ortho reads
// like a real close-up, and the arithmetic stays cheap per frame.

type ProjectedAtom = { el: string; x: number; y: number; z: number; r: number };
type ProjectedBond = { ax: number; ay: number; bx: number; by: number; order: 1 | 2 | 3 };

const ATOM_RADIUS = { C: 12, O: 13, N: 12.5, H: 7, Cl: 15 } as const;
const ATOM_COLOR = {
  C: "rgba(230, 220, 210, 1)",
  O: "rgba(240, 120, 90, 1)",
  N: "rgba(120, 150, 240, 1)",
  H: "rgba(240, 240, 240, 1)",
  Cl: "rgba(150, 220, 130, 1)",
} as const;

function rotateAtom(
  a: { x: number; y: number; z: number },
  rx: number,
  ry: number,
): { x: number; y: number; z: number } {
  // Rx then Ry (matches rotateMolecule's rotation order)
  let y1 = a.y * Math.cos(rx) - a.z * Math.sin(rx);
  let z1 = a.y * Math.sin(rx) + a.z * Math.cos(rx);
  const x2 = a.x * Math.cos(ry) + z1 * Math.sin(ry);
  z1 = -a.x * Math.sin(ry) + z1 * Math.cos(ry);
  return { x: x2, y: y1, z: z1 };
}

function projectMoleculeAtoms(state: MoleculeState, w: number, h: number): ProjectedAtom[] {
  const [rx, ry] = state.rotation;
  const cx = w / 2;
  const cy = h / 2;
  const s = Math.min(w, h) * 0.13; // scale so the ring fits comfortably
  const out: ProjectedAtom[] = [];
  for (const a of state.atoms) {
    const p = rotateAtom(a, rx, ry);
    out.push({
      el: a.el,
      x: cx + p.x * s,
      y: cy + p.y * s,
      z: p.z,
      r: ATOM_RADIUS[a.el as keyof typeof ATOM_RADIUS] ?? 10,
    });
  }
  return out;
}

function projectMoleculeBonds(state: MoleculeState, w: number, h: number): ProjectedBond[] {
  const atoms = projectMoleculeAtoms(state, w, h);
  return state.bonds.map((b) => ({
    ax: atoms[b.a].x,
    ay: atoms[b.a].y,
    bx: atoms[b.b].x,
    by: atoms[b.b].y,
    order: b.order,
  }));
}

function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(apx, apy);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  return Math.hypot(px - qx, py - qy);
}

export default function Observe() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const voiceRef = useRef<RoomVoice | null>(null);
  const letGoRef = useRef<() => void>(() => {});
  const keyTapRef = useRef<() => void>(() => {});
  const keyHoldRef = useRef<(elapsed: number) => void>(() => {});
  const keyArrowRef = useRef<(dx: number, dy: number) => void>(() => {});
  const [standing, setStanding] = useState(0);

  // The room owns pinch — useBandEdgeTravel maps the internal 1..4096 zoom
  // onto /drop, so residual pinch at either extreme still presses the band
  // walls exactly as ScaleTravel would for a yielded-frame room.
  const {
    report: reportScaleEdge,
    release: releaseScaleEdge,
    reset: resetScaleEdge,
    overlay: scaleEdgeOverlay,
  } = useBandEdgeTravel("/observe", OBSERVE_ZOOM_SPEC);

  // Passed to the useEffect through refs so a route-parent re-render never
  // re-attaches the gesture engine mid-hold.
  const reportRef = useRef(reportScaleEdge);
  reportRef.current = reportScaleEdge;
  const releaseRef = useRef(releaseScaleEdge);
  releaseRef.current = releaseScaleEdge;
  const resetRef = useRef(resetScaleEdge);
  resetRef.current = resetScaleEdge;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !canvas || !overlay) return;

    const audio = getFieldAudio();
    try { audio.setAmbientProfile?.("light"); } catch { /* noop */ }
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");

    // ——— the small state vector, seeded from the room's own key ———
    const SEED = 0x0b5e5e;
    const nextIdRef = { v: 1 };
    const molecules: Molecule[] = [];
    let spectrum: SpectrumAccumulator = createSpectrumAccumulator(0);

    // Load the kept sigil (spectrum + a fresh population near center).
    try {
      const raw = window.localStorage.getItem(OBSERVE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        spectrum = loadSpectrum(parsed?.spectrum ?? parsed, performance.now());
      }
    } catch {
      /* fresh sample */
    }

    // seed a small initial population so the room is alive at first paint
    const seedPopulation = () => {
      if (molecules.length > 0) return;
      const rng = sceneMulberry32(SEED);
      const n = 42;
      for (let i = 0; i < n; i++) {
        const nx = 0.15 + rng() * 0.7;
        const ny = 0.15 + rng() * 0.7;
        const id = nextIdRef.v++;
        molecules.push(bornMolecule(id, sceneHashSeed(SEED, id), nx, ny, performance.now()));
      }
    };
    seedPopulation();
    setStanding(molecules.length);

    // ——— the beam state and world axes ———
    const beam = {
      on: 0, // 0..1 fade
      x: 0.5, // normalized wavelength-x
      lambda: xToWavelength(0.5),
      intensity: 1,
      fadeAt: 0, // performance.now() when the current beam should fade
    };
    const sustain = {
      lambda: NO_LAMBDA,
      on: 0,
    };
    const world = {
      windX: 0,
      windY: 0,
      tiltX: 0,
      tiltY: 0,
      temperature: 0,
      stir: 0,
      night: 0,
      nightTarget: 0,
      lens: 0,
      lensTarget: 0,
      concentration: 1, // ratio to REFERENCE_CONCENTRATION
      timeScale: 1,
      timeScaleTarget: 1,
      breathAmp: 1,
    };
    let lastGestureAt = performance.now();
    let cursorNx = 0.5;
    let cursorNy = 0.4;

    // ——— the altitude sweep state ————————————————————————————————————
    // The internal zoom starts at 64 (deep inside the solution altitude — the
    // room lands where Phase 1 landed). Pinching moves it, and altitude
    // dispatch reads it every tick.
    let zoom = 64;
    // Smoothed altitude weights, eased toward altitudeWeights(zoom) so the
    // crossfade is always continuous even when a hard pinch punches through.
    const altWeights = { crystal: 0, solution: 1, molecule: 0, chromophore: 0 };

    // Crystal flakes on the bench — populated only while the crystal altitude
    // is visible, retired when the visitor pinches into the solution.
    const flakes: CrystalFlake[] = [];
    const seedCrystalHeap = () => {
      if (flakes.length > 0) return;
      const rng = sceneMulberry32(sceneHashSeed(SEED, 0x0abcde));
      const n = 12;
      for (let i = 0; i < n; i++) {
        const nx = 0.28 + rng() * 0.44;
        const flake = bornCrystalFlake(nextIdRef.v++, sceneHashSeed(SEED, i, 0xa11), nx, 0.5 + rng() * 0.2);
        flake.settled = true;
        flake.y = 0.82 + rng() * 0.06;
        flakes.push(flake);
      }
    };

    // One ball-and-stick molecule for the molecule altitude — the maker's
    // compound as a small solid drawn in orthographic 3D.
    let molecule3D: MoleculeState = bornMolecule3D();

    // Photons descending on the chromophore altitude. Each carries the
    // wavelength the finger picked when it was fired; the render loop steps
    // them down and the resonant check decides absorption.
    let chromophorePhotons: ChromophorePhoton[] = [];
    // The particle-in-a-box state — span (two still fingers) sets L, twist
    // picks n1→n2. Kept in state so the corner MO diagram can read it.
    const box = {
      L: 1.2e-9, // metres
      n1: 1,
      n2: 2,
      lastDE: moTransitionEnergy(1, 2, 1.2e-9), // eV
      selectedBondIdx: -1, // for the molecule altitude — a tapped bond
      selectedBondUntil: 0,
    };

    // ——— visibility / gallery pause ———
    let hidden = document.hidden;
    let galleryPaused = false;
    const syncSleep = () => {
      if (hidden || galleryPaused) gov.force("sleep");
    };
    const unvis = onVisibility((h) => { hidden = h; syncSleep(); });
    const ungal = onGalleryPause((p) => { galleryPaused = p; syncSleep(); });
    syncSleep();

    // ——— persistence: the kept sigil is the spectrum ———
    const writer = createIdleWriter(() => {
      try {
        const payload = { v: 1, spectrum: serializeSpectrum(spectrum) };
        window.localStorage.setItem(OBSERVE_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* quota */
      }
    });

    // ——— the population layer, mirroring the observe.ts ledger ———
    // The physics module owns Molecule[]; the SceneObjectSpec below is the
    // render view — every frame it syncs from the ledger. This is the same
    // shape /reef uses over its coralflow ledger.
    const moleculeSpec: SceneObjectSpec<MoleculeView> = {
      kind: "molecule",
      cap: MOLECULE_CAP,
      born(seed, nx, ny, tMs) {
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 1,
          sealedMs: null,
          presence: 1,
          excited: 0,
          lastLambda: 0,
        };
      },
      step(_s, _ctx) { /* the ledger is authoritative; render mirror only */ },
      emit(s, ctx, out) {
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        const r = moleculeRadius({ excited: s.excited } as Molecule) * (0.8 + 0.4 * ctx.detail);
        // hue: normalize lastLambda (200..800) onto 0..1, so u_pal* renders
        // the emission color the molecule swallowed
        const hue = s.lastLambda > 0 ? wavelengthToX(s.lastLambda) : 0.55;
        const glow = clamp01(s.excited * 1.4);
        const phase = ((ctx.tMs / 40 + s.seed * 0.001) % 1);
        const alpha = s.presence * (0.35 + 0.55 * (0.5 + 0.5 * (ctx.breath ?? 0.5)));
        out.push(px, py, r, s.seed * 0.001, hue, glow, phase, alpha);
      },
      verbs: [],
      respond: {},
    };
    const population = createPopulation(moleculeSpec);

    // ——— the shared GL harness ———
    const stage = createGLStage(canvas, {
      label: "observe",
      wrap,
      overlay,
      renderScale: embedded ? 0.45 : 0.65,
      quality: embedded ? "medium" : "high",
      reducedMotion: reduced,
      embedded,
    });
    const prog = stage?.program(FULLSCREEN_VERT_UNIT, FRAG) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog, "unit") : null;
    const populationLayer = stage
      ? createPopulationLayer(stage, {
          // u_palA — deep violet (UV end), u_palB — green, u_palC — red
          palette: ["#8a3ad8", "#4ad03b", "#e04a3c"],
          frag: MOLECULE_FRAG,
        })
      : null;
    const instanceBuffer = createInstanceBuffer(MOLECULE_CAP);

    // ——— sync the render view from the observe.ts ledger ———
    const syncPopulation = (now: number) => {
      const items = population.items;
      // retire scene items whose ledger molecule is gone
      for (const item of items) {
        if (item.presence < 1) continue;
        if (!molecules.some((m) => m.id === item.id && m.presence >= 1)) {
          item.presence = 0.999;
        }
      }
      // update or add
      for (const m of molecules) {
        if (m.presence < 1) continue;
        let item = items.find((it) => it.id === m.id && it.presence >= 1);
        if (!item) {
          item = {
            id: m.id,
            seed: m.seed,
            nx: m.nx,
            ny: m.ny,
            bornMs: now,
            growth: 1,
            sealedMs: null,
            presence: 1,
            excited: m.excited,
            lastLambda: m.lastLambda,
          };
          items.push(item);
        } else {
          item.nx = m.nx;
          item.ny = m.ny;
          item.excited = m.excited;
          item.lastLambda = m.lastLambda;
        }
      }
    };

    // ——— molecule helpers ———
    const spawnAt = (nx: number, ny: number, tMs: number) => {
      if (molecules.filter((m) => m.presence >= 1).length >= MOLECULE_CAP) {
        // retire the oldest so the newest can join
        let oldest: Molecule | null = null;
        for (const m of molecules) {
          if (m.presence < 1) continue;
          if (!oldest || m.bornMs < oldest.bornMs) oldest = m;
        }
        if (oldest) oldest.presence = 0.999;
      }
      const id = nextIdRef.v++;
      const seed = sceneHashSeed(SEED, id, Math.round(nx * 8191), Math.round(ny * 4093));
      const mol = bornMolecule(id, seed, nx, ny, tMs);
      molecules.push(mol);
      return mol;
    };

    const fireBeam = (lambda: number, intensity: number, tMs: number) => {
      // Route the photon to every molecule under the beam's column (within
      // reach) and update the ghost spectrum from the SUM of energies.
      let hits = 0;
      let energySum = 0;
      const xTarget = wavelengthToX(lambda);
      for (const m of molecules) {
        if (m.presence < 1) continue;
        const dx = Math.abs(m.nx - xTarget);
        if (dx > 0.06) continue;
        const result = photonHit(m, lambda, intensity, tMs, world.temperature * 0.8);
        if (result.absorbed) {
          hits++;
          energySum += result.energyDeposited;
        }
      }
      // A single sample of A(λ) at the peak absorbs strongly; the ghost
      // curve adds proportional to the observed absorbance at the beam's λ
      // regardless of hits (a beam with no molecule under it teaches
      // nothing) — hits > 0 means the population confirmed the sample.
      if (hits > 0) {
        const A = sampleAbsorbance(lambda, REFERENCE_CONCENTRATION * world.concentration, world.temperature * 0.8);
        spectrumAdd(spectrum, lambda, A * (0.4 + intensity * 0.6));
        writer.schedule();
      }
      return { hits, energySum };
    };

    const beamOn = (lambda: number, intensity: number, holdMs = 260) => {
      beam.lambda = lambda;
      beam.x = wavelengthToX(lambda);
      beam.intensity = intensity;
      beam.on = Math.max(beam.on, 0.85);
      beam.fadeAt = performance.now() + holdMs;
    };

    // ——— altitude helpers ————————————————————————————————————————
    // The altitude a verb dispatches under. Reads the live zoom so a hand
    // sweeping through the altitudes gets the right binding at each frame.
    const currentAltitude = (): Altitude => altitudeFromZoom(zoom).current;

    // Fire a photon toward the chromophore's ring; the render loop advances
    // it and the resonance check decides absorption.
    const fireChromophorePhoton = (lambda: number, born: number) => {
      chromophorePhotons.push({ lambda, y: -0.02, born });
      // cap the population
      if (chromophorePhotons.length > 24) chromophorePhotons.shift();
    };

    // Two-finger tap steps back one altitude jump. Since the room owns pinch,
    // the shell has no way to send the visitor's zoom back — it does it
    // itself, walking down a small table of altitude landmarks.
    const stepBackAltitude = () => {
      const anchors = [
        ALTITUDE_BOUNDS.chromophore.lo, // 2048
        ALTITUDE_BOUNDS.molecule.lo,    // 1024
        ALTITUDE_BOUNDS.solution.lo,    // 16
        ALTITUDE_BOUNDS.crystal.lo,     // 1
      ];
      for (const a of anchors) {
        if (zoom > a * 1.5) {
          zoom = a;
          try { reportRef.current(zoom, 0); } catch { /* noop */ }
          try { releaseRef.current(); } catch { /* noop */ }
          return;
        }
      }
      // already at the widest — the manifold catches it if we press harder
      zoom = OBSERVE_ZOOM_SPEC.zoomMin;
      try { reportRef.current(zoom, 0); } catch { /* noop */ }
    };

    // ——— the voice: RoomShell speaks these; every meaningful verb lands
    //     in the two senses and a haptic, and the altitude decides what
    //     that verb MEANS on the current material ———
    const voice: RoomVoice = {
      tap: (t) => {
        if (t.fingers >= 2) return; // 2f is stepBack, 3f is tutti
        lastGestureAt = performance.now();
        const nx = t.x / Math.max(1, wrap.clientWidth);
        const ny = t.y / Math.max(1, wrap.clientHeight);
        cursorNx = nx; cursorNy = ny;
        const alt = currentAltitude();
        const tier = tapTrainTier(t.count);

        // ——— crystal altitude: tap presses a facet, a flake tumbles free ——
        if (alt === "crystal") {
          // find the nearest settled flake and unsettle it — the small
          // perturbation makes it fall a little and rejoin the pile
          let nearest: CrystalFlake | null = null;
          let dMin = 0.18;
          for (const f of flakes) {
            const d = Math.hypot(f.x - nx, f.y - ny);
            if (d < dMin) { dMin = d; nearest = f; }
          }
          if (nearest) {
            nearest.settled = false;
            nearest.vy -= 0.15 * t.intensity;
            nearest.omega += (nx - nearest.x) * 4;
          } else if (tier === 3 || tier === 5 || tier === "n") {
            // no facet under the finger, a train of taps mints a new flake
            if (flakes.length < CRYSTAL_CAP) {
              flakes.push(bornCrystalFlake(nextIdRef.v++, sceneHashSeed(SEED, Math.round(nx * 8191), Math.round(ny * 4093)), nx, ny));
            }
          }
          try { haptics.tap(); } catch { /* noop */ }
          try { audio.spark?.(); } catch { /* noop */ }
          return;
        }

        // ——— chromophore altitude: tap fires a photon at the finger's λ ——
        if (alt === "chromophore") {
          const lambda = xToWavelength(nx);
          fireChromophorePhoton(lambda, performance.now());
          try { haptics.ripple(0.3 + t.intensity * 0.3); } catch { /* noop */ }
          try { audio.playNote?.(80 - Math.round(wavelengthToX(lambda) * 30), 180); } catch { /* noop */ }
          return;
        }

        // ——— molecule altitude: tap on a bond highlights it ——
        if (alt === "molecule") {
          // Project bonds to screen and pick the nearest to the tap
          const bp = projectMoleculeBonds(molecule3D, wrap.clientWidth, wrap.clientHeight);
          let bestIdx = -1;
          let bestD = 24; // px tolerance
          for (let i = 0; i < bp.length; i++) {
            const seg = bp[i];
            const d = pointToSegmentDistance(t.x, t.y, seg.ax, seg.ay, seg.bx, seg.by);
            if (d < bestD) { bestD = d; bestIdx = i; }
          }
          if (bestIdx >= 0) {
            box.selectedBondIdx = bestIdx;
            box.selectedBondUntil = performance.now() + 1400;
            try { haptics.lens(); } catch { /* noop */ }
            try { audio.spark?.(); } catch { /* noop */ }
            return;
          }
          try { haptics.tap(); } catch { /* noop */ }
          return;
        }

        // ——— solution altitude: Phase 1's tap ladder ——
        const lambda = xToWavelength(nx);
        if (tier === "n") {
          for (let i = 0; i < 24; i++) {
            const lam = 200 + (i / 23) * 600;
            fireBeam(lam, 0.7, performance.now());
          }
          beamOn(lambda, 1, 380);
          try { haptics.storm(); } catch { /* noop */ }
          try { audio.playNote?.(60, 320); } catch { /* noop */ }
          return;
        }
        if (tier === 5) {
          for (const lam of [BAND_PI.center, BAND_N.center, 500]) fireBeam(lam, 0.9, performance.now());
          beamOn(lambda, 0.95, 320);
          try { haptics.chop(); } catch { /* noop */ }
          try { audio.bell?.(); } catch { /* noop */ }
          return;
        }
        if (tier === 3) {
          for (let i = 0; i < 3; i++) fireBeam(lambda + (i - 1) * 4, 0.8, performance.now());
          beamOn(lambda, 0.9, 300);
          try { haptics.roll(); } catch { /* noop */ }
          try { audio.playNote?.(72, 220); } catch { /* noop */ }
          return;
        }
        fireBeam(lambda, t.intensity, performance.now());
        beamOn(lambda, 0.7 + t.intensity * 0.3);
        try { haptics.ripple(0.4 + t.intensity * 0.35); } catch { /* noop */ }
        try {
          const midi = Math.round(96 - (wavelengthToX(lambda) * 40));
          audio.playNote?.(midi, 180);
        } catch { /* noop */ }
      },
      stepBack: (_e) => {
        lastGestureAt = performance.now();
        // The room OWNS pinch, so stepBack is altitude retreat — a
        // two-finger tap lifts the visitor one altitude jump toward the
        // wider view. Every ScaleTravel-yielded room's stepBack goes to
        // ScaleTravel; here it goes to the internal camera.
        stepBackAltitude();
        try { haptics.lens(); } catch { /* noop */ }
      },
      tutti: (t) => {
        // the diode array fires: every wavelength at once, every resonant
        // molecule alight, ghost curve flashes complete
        lastGestureAt = performance.now();
        for (let i = 0; i < SPECTRUM_BINS; i += 4) {
          const lam = wavelengthAtBin(i);
          fireBeam(lam, 0.6 + t.intensity * 0.4, performance.now());
        }
        beam.on = 1;
        beam.fadeAt = performance.now() + 480;
        try { haptics.roll(); } catch { /* noop */ }
        try { audio.bell?.(); } catch { /* noop */ }
      },
      plant: (p) => {
        lastGestureAt = performance.now();
        const nx = p.x / Math.max(1, wrap.clientWidth);
        const ny = p.y / Math.max(1, wrap.clientHeight);
        cursorNx = nx; cursorNy = ny;
        spawnAt(nx, ny, performance.now());
        setStanding(molecules.filter((m) => m.presence >= 1).length);
        try { haptics.tap(); } catch { /* noop */ }
        try { audio.spark?.(); } catch { /* noop */ }
      },
      deepen: (d) => {
        // keep gathering: a molecule per ~140ms while held
        const now = performance.now();
        const gap = 140 - Math.min(90, d.elapsed / 30);
        if (now - lastGestureAt < gap) return;
        lastGestureAt = now;
        const nx = d.x / Math.max(1, wrap.clientWidth);
        const ny = d.y / Math.max(1, wrap.clientHeight);
        const alive = molecules.filter((m) => m.presence >= 1).length;
        if (alive >= MOLECULE_CAP) return;
        spawnAt(nx + (Math.sin(d.elapsed * 0.01) * 0.03), ny + (Math.cos(d.elapsed * 0.013) * 0.03), now);
        setStanding(molecules.filter((m) => m.presence >= 1).length);
        try { haptics.tap(); } catch { /* noop */ }
      },
      ceremony: (_c) => {
        // seal the current spectrum as a kept sigil
        lastGestureAt = performance.now();
        writer.flush();
        try { haptics.bloom(); } catch { /* noop */ }
        try { audio.bell?.(); } catch { /* noop */ }
      },
      timeScale: (k) => {
        world.timeScaleTarget = clamp(k, 0.15, 1);
      },
      drag: (d) => {
        lastGestureAt = performance.now();
        if (d.fingers >= 3) return; // wind is its own handler
        if (d.phase === "end") return;
        const nx = d.x / Math.max(1, wrap.clientWidth);
        cursorNx = nx;
        const alt = currentAltitude();
        // ——— molecule altitude: drag rotates the model ——
        if (alt === "molecule") {
          const rx = (d.dx / Math.max(1, wrap.clientWidth)) * Math.PI * 2;
          const ry = (d.dy / Math.max(1, wrap.clientHeight)) * Math.PI * 2;
          molecule3D = rotateMolecule(molecule3D, rx, ry);
          try { haptics.tap(); } catch { /* noop */ }
          return;
        }
        // ——— crystal altitude: drag pushes the heap laterally ——
        if (alt === "crystal") {
          const dxNorm = d.dx / Math.max(1, wrap.clientWidth);
          for (const f of flakes) {
            f.settled = false;
            f.vx += dxNorm * 0.6;
          }
          try { haptics.tap(); } catch { /* noop */ }
          return;
        }
        // ——— solution altitude: sweep the beam (Phase 1) ——
        const lambda = xToWavelength(nx);
        const now = performance.now();
        if (now - beam.fadeAt < 0 || now - lastGestureAt < 20) {
          beamOn(lambda, 0.55);
          return;
        }
        fireBeam(lambda, 0.55, now);
        beamOn(lambda, 0.7, 180);
        try { haptics.tap(); } catch { /* noop */ }
      },
      wind: (w) => {
        world.windX = clamp(world.windX + w.dx * 0.008, -1, 1);
        world.windY = clamp(world.windY + w.dy * 0.008, -1, 1);
        try { haptics.roll(); } catch { /* noop */ }
      },
      flick: (f) => {
        lastGestureAt = performance.now();
        const nx = f.x / Math.max(1, wrap.clientWidth);
        const lambda = xToWavelength(nx);
        fireBeam(lambda, Math.min(1, 0.7 + f.speed * 0.1), performance.now());
        beamOn(lambda, 1, 460);
        // molecules along the beam path shake once — a velocity kick
        for (const m of molecules) {
          if (m.presence < 1) continue;
          if (Math.abs(m.nx - nx) > 0.08) continue;
          m.vx += Math.cos(f.angle) * 0.4;
          m.vy += Math.sin(f.angle) * 0.4;
        }
        try { haptics.chop(); } catch { /* noop */ }
      },
      stir: (s) => {
        // scrub: vortex briefly forms
        world.stir = clamp01(world.stir + Math.min(0.5, Math.abs(s.angularVelocity) * 0.28));
        lastGestureAt = performance.now();
        try { haptics.tap(); } catch { /* noop */ }
      },
      sustain: (s) => {
        const alt = currentAltitude();
        // ——— chromophore altitude: span opens particle-in-a-box ——
        // The live spread sets L; ΔE and the on-band wavelength recompute
        // every tick. The photon fired by tap becomes resonant when the
        // finger's λ matches ΔE (moTransitionEnergy).
        if (alt === "chromophore") {
          if (s.phase === "release") return;
          box.L = chromophoreBoxLength(s.spread, wrap.clientWidth);
          box.lastDE = moTransitionEnergy(box.n1, box.n2, box.L);
          return;
        }
        // ——— solution altitude: Phase 1 sustained beam ——
        if (s.phase === "release") {
          sustain.lambda = NO_LAMBDA;
          return;
        }
        const cx = s.cx / Math.max(1, wrap.clientWidth);
        const lambda = xToWavelength(cx);
        sustain.lambda = lambda;
        fireBeam(lambda, 0.7, performance.now());
      },
      lens: (l) => {
        const alt = currentAltitude();
        // ——— molecule altitude: two-finger twist flips chirality ——
        // A firm turn past ±0.6 rad is a commit; small quivers ignore.
        if (alt === "molecule") {
          if (Math.abs(l.angle) > 0.6) {
            molecule3D = flipChirality(molecule3D);
            try { haptics.bloom(); } catch { /* noop */ }
            try { audio.bell?.(); } catch { /* noop */ }
          }
          return;
        }
        // ——— chromophore altitude: twist picks n (1→2, 2→3, ...) ——
        if (alt === "chromophore") {
          if (l.angle > 0.4) {
            box.n2 = Math.min(6, box.n2 + 1);
            box.lastDE = moTransitionEnergy(box.n1, box.n2, box.L);
            try { haptics.detent(); } catch { /* noop */ }
          } else if (l.angle < -0.4) {
            box.n2 = Math.max(box.n1 + 1, box.n2 - 1);
            box.lastDE = moTransitionEnergy(box.n1, box.n2, box.L);
            try { haptics.detent(); } catch { /* noop */ }
          }
          return;
        }
        // ——— solution altitude: cycle raw → A(λ) → orbital ——
        world.lensTarget = clamp(world.lensTarget + l.angle * 0.5, 0, 2);
        if (Math.abs(l.velocity) < 0.01) {
          world.lensTarget = Math.round(world.lensTarget);
        }
        try { haptics.lens(); } catch { /* noop */ }
      },
      season: (s) => {
        // twist3: concentration up / down, continuous
        world.concentration = clamp(world.concentration * Math.exp(s.angle * 0.4), 0.1, 6);
        try { haptics.detent(); } catch { /* noop */ }
      },
      scatter: (s) => {
        // shake: thermal broadening + brownian churn
        world.temperature = clamp01(world.temperature + s.intensity * 0.4);
        try { haptics.storm(); } catch { /* noop */ }
      },
      gravity: (g) => {
        world.tiltX = clamp(g.gamma / 45, -1, 1);
        world.tiltY = clamp((g.beta - 35) / 90, -1, 1);
      },
      knock: (k) => {
        // the chopper: beam briefly interrupted, every excited molecule
        // relaxes to ground at once
        for (const m of molecules) m.excited = 0;
        beam.on = 0;
        beam.fadeAt = performance.now() + 220;
        try { haptics.detent(); } catch { /* noop */ }
        try { audio.thud?.(); } catch { /* noop */ }
      },
      night: (n) => {
        world.nightTarget = n.faceDown ? 1 : 0;
      },
      breath: (b) => {
        world.breathAmp = 0.7 + 0.3 * b.strength;
      },
    };
    voiceRef.current = voice;

    // ——— the pinch: the room owns it ————————————————————————————————
    // A second attachGestures on the same surface owns pinch and pan2. The
    // shell's own gesture engine ignores those verbs (travelOwnsFrame: false
    // wires only a soft ack), so the two engines never fight over a verb.
    // The pinch handler mutates `zoom` and reports the residual to the
    // manifold — inside the range that residual is zero and the internal
    // camera is the room's alone; at the extremes the residual becomes the
    // /drop band's wall pressure, exactly as if ScaleTravel owned pinch.
    let pinchLastAt = 0;
    let pinchLastZoom = zoom;
    const detachPinch = attachGestures(wrap, {
      pinch: (e) => {
        if (e.phase === "start") {
          pinchLastAt = performance.now();
          pinchLastZoom = zoom;
          return;
        }
        if (e.phase === "end") {
          try { releaseRef.current(); } catch { /* noop */ }
          return;
        }
        // e.scale is the multiplicative ratio for THIS event
        const nowMs = performance.now();
        const attempted = pinchLastZoom * e.scale;
        const next = Math.max(OBSERVE_ZOOM_SPEC.zoomMin, Math.min(OBSERVE_ZOOM_SPEC.zoomMax, attempted));
        const dt = Math.max(1, nowMs - pinchLastAt);
        pinchLastAt = nowMs;
        zoom = next;
        pinchLastZoom = next;
        lastGestureAt = nowMs;
        // ln-ratio per second: attempted minus achieved (zero inside the
        // range, non-zero only at a held extreme).
        const attemptedLn = Math.log(Math.max(1e-9, attempted / Math.max(1e-9, next)));
        const rateLnPerS = attemptedLn / (dt / 1000);
        try { reportRef.current(next, rateLnPerS); } catch { /* noop */ }
      },
      pan2: (e) => {
        // Two-finger pan is otherwise handled by ScaleTravel; here the room
        // owns pinch, and the shell has no pan2 mapping to speak of. Use it
        // as a gentle "nudge" — at the molecule altitude, rotate; elsewhere,
        // no-op (the whole-field pan is not what the material means).
        if (e.phase !== "move") return;
        const alt = currentAltitude();
        if (alt !== "molecule") return;
        const rx = (e.dx / Math.max(1, wrap.clientWidth)) * Math.PI * 2;
        const ry = (e.dy / Math.max(1, wrap.clientHeight)) * Math.PI * 2;
        molecule3D = rotateMolecule(molecule3D, rx, ry);
      },
    });

    letGoRef.current = () => {
      // solution altitude: the drifting molecules + the ghost spectrum
      for (const m of molecules) m.presence = 0.999;
      spectrum = createSpectrumAccumulator(performance.now());
      try {
        window.localStorage.setItem(
          OBSERVE_STORAGE_KEY,
          JSON.stringify({ v: 1, spectrum: serializeSpectrum(spectrum) }),
        );
      } catch { /* noop */ }
      writer.cancel();
      // crystal altitude: retire every flake so the heap returns to nothing
      flakes.length = 0;
      // chromophore altitude: retire every descending photon
      chromophorePhotons = [];
      // molecule altitude: back to the room's canonical enantiomer, no rotation
      molecule3D = bornMolecule3D();
      setStanding(0);
      try { audio.thud?.(); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
    };

    // ——— keyboard: nothing on this site is touch-only ———
    keyTapRef.current = () => {
      const lambda = xToWavelength(cursorNx);
      fireBeam(lambda, 0.7, performance.now());
      beamOn(lambda, 0.9);
      try { haptics.tap(); } catch { /* noop */ }
    };
    keyHoldRef.current = (elapsed) => {
      const now = performance.now();
      if (now - lastGestureAt < 200) return;
      lastGestureAt = now;
      spawnAt(cursorNx, cursorNy + (elapsed % 4000) / 40000, now);
      setStanding(molecules.filter((m) => m.presence >= 1).length);
    };
    keyArrowRef.current = (dx, dy) => {
      cursorNx = clamp01(cursorNx + dx * 0.04);
      cursorNy = clamp01(cursorNy + dy * 0.04);
    };

    // ——— the loop ———
    const clocks = {
      time: 0,
      turbulence: 0,
      register: { baseHz: 220, lfoHz: 0.14, brightness: 0.5 },
      reducedMotion: reduced,
    };

    let raf = 0;
    let last = performance.now();
    let lastGlimmerAt = 0;

    const step = (now: number) => {
      if (hidden || galleryPaused) {
        raf = requestAnimationFrame(step);
        last = now;
        return;
      }
      const tier: QualityTier = gov.beginFrame(now);
      const detail = detailForTier(tier);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // ease the world's easing axes toward their targets
      world.timeScale += (world.timeScaleTarget - world.timeScale) * Math.min(1, dt * 6);
      world.night += (world.nightTarget - world.night) * Math.min(1, dt * 4);
      world.lens += (world.lensTarget - world.lens) * Math.min(1, dt * 5);
      world.stir *= Math.exp(-dt * 1.8);
      world.windX *= Math.exp(-dt * 0.7);
      world.windY *= Math.exp(-dt * 0.7);
      world.temperature *= Math.exp(-dt * 0.28);
      if (beam.fadeAt < now) beam.on *= Math.exp(-dt * 3.4);

      // ——— altitude sweep: ease the four altitude weights toward target ——
      // The visitor's live zoom decides the target; the actual weights ease
      // in over ~180 ms so a hard pinch still crossfades smoothly.
      const targetW = altitudeWeights(zoom);
      const ease = Math.min(1, dt * 5.5);
      altWeights.crystal += (targetW.crystal - altWeights.crystal) * ease;
      altWeights.solution += (targetW.solution - altWeights.solution) * ease;
      altWeights.molecule += (targetW.molecule - altWeights.molecule) * ease;
      altWeights.chromophore += (targetW.chromophore - altWeights.chromophore) * ease;

      // ——— per-altitude physics ————————————————————————————————
      if (altWeights.crystal > 0.02 || altWeights.solution > 0.05) {
        if (flakes.length === 0 && altWeights.crystal > 0.05) seedCrystalHeap();
        stepCrystal(flakes, dt, { x: world.tiltX, y: world.tiltY });
      } else if (flakes.length > 0 && altWeights.crystal < 0.01) {
        // drop the heap once fully out of view — no crystal at this altitude
        flakes.length = 0;
      }
      if (altWeights.molecule > 0.02 || altWeights.chromophore > 0.02) {
        // the molecule is alive at every zoom past solution — its chair
        // flips on the shared breath, and its rotation eases toward rest
        molecule3D = stepMolecule(molecule3D, dt, clocksFrom(clocks).breath);
      }
      if (chromophorePhotons.length > 0) {
        chromophorePhotons = stepChromophorePhotons(chromophorePhotons, dt);
      }

      // advance the sample
      const field: FieldInput = {
        windX: world.windX,
        windY: world.windY,
        tiltX: world.tiltX,
        tiltY: world.tiltY,
        temperature: world.temperature,
        timeScale: world.timeScale,
        tMs: now,
        reduced,
      };
      stepMolecules(molecules, dt, field);

      // decay the ghost spectrum toward zero (a hand that pauses sees it breathe out)
      spectrumDecay(spectrum, dt, now);

      // retire fully-faded molecules
      for (let i = molecules.length - 1; i >= 0; i--) {
        if (molecules[i].presence <= 0) molecules.splice(i, 1);
      }

      // sustained span keeps feeding the spectrum while held
      if (sustain.lambda > 0) {
        fireBeam(sustain.lambda, 0.5, now);
        sustain.on = Math.min(1, sustain.on + dt * 4);
      } else {
        sustain.on = Math.max(0, sustain.on - dt * 4);
      }

      // glimmer: after ~20s idle, a molecule ignites at a seeded wavelength
      if (
        now - lastGestureAt > 20000 &&
        now - lastGlimmerAt > 6000 &&
        !reduced &&
        molecules.length > 0
      ) {
        lastGlimmerAt = now;
        // deterministic: pick a wavelength from the tick and beam glimmer color
        const wRng = sceneMulberry32(sceneHashSeed(SEED, Math.floor(now / 1000)));
        const lambda = 240 + wRng() * 80; // near the bands
        fireBeam(lambda, 0.55, now);
        beamOn(lambda, 0.6, 900);
      }

      // shader draw
      const audioT = audio.getAudioTime?.() ?? now / 1000;
      clocks.time = audioT;
      clocks.turbulence = world.stir;
      const size = stage?.beginFrame(clocksFrom(clocks), prog) ?? { width: wrap.clientWidth, height: wrap.clientHeight };

      if (prog) {
        // set the room's own uniforms
        const beamRgb = wavelengthToRgb(beam.lambda);
        const absA = sampleAbsorbance(
          beam.lambda,
          REFERENCE_CONCENTRATION * world.concentration,
          world.temperature * 0.8,
        );
        prog.setFloat("uBeamOn", beam.on * beam.intensity * world.breathAmp * altWeights.solution);
        prog.setFloat("uBeamX", beam.x);
        prog.setVec3("uBeamRgb", beamRgb[0], beamRgb[1], beamRgb[2]);
        prog.setFloat("uBeamAbsorb", absA);
        prog.setFloat("uConcentration", world.concentration);
        prog.setFloat("uStir", world.stir);
        prog.setVec2("uTilt", world.tiltX, world.tiltY);
        prog.setFloat("uNight", world.night);
        prog.setFloat("uLens", world.lens);
        prog.setFloat("uBroaden", world.temperature * 0.9);
        // altitude weights: the shader mixes crystal / solution / molecule /
        // chromophore materials in these proportions. sums to ~1 by design.
        prog.setFloat("uAltCrystal", altWeights.crystal);
        prog.setFloat("uAltSolution", altWeights.solution);
        prog.setFloat("uAltMolecule", altWeights.molecule);
        prog.setFloat("uAltChromophore", altWeights.chromophore);
        prog.setFloat("uMoleculeSeed", (SEED & 0xffff));
        // sustained span uniforms
        if (sustain.lambda > 0 && sustain.on > 0.02) {
          const srgb = wavelengthToRgb(sustain.lambda);
          const sA = sampleAbsorbance(
            sustain.lambda,
            REFERENCE_CONCENTRATION * world.concentration,
            world.temperature * 0.8,
          );
          prog.setFloat("uSustainLambda", sustain.lambda);
          prog.setFloat("uSustainAbsorb", sA);
          prog.setVec3("uSustainRgb", srgb[0], srgb[1], srgb[2]);
        } else {
          prog.setFloat("uSustainLambda", NO_LAMBDA);
          prog.setFloat("uSustainAbsorb", 0);
          prog.setVec3("uSustainRgb", 0, 0, 0);
        }
        quad?.draw();
      }

      // draw the population — only when the solution altitude is visible.
      // Under crystal / molecule / chromophore the molecule instances would
      // read as noise, so the alpha in each instance's emit scales by the
      // solution weight (and the fade during the moleculeZoom transition
      // matches the crossfade the shader is running).
      syncPopulation(now);
      instanceBuffer.reset();
      if (altWeights.solution > 0.02) {
        population.emit(
          {
            width: size.width,
            height: size.height,
            tMs: now,
            breath: clocksFrom(clocks).breath * altWeights.solution,
            detail: detail.particles,
            reducedMotion: reduced,
          },
          instanceBuffer,
        );
      }
      populationLayer?.draw(instanceBuffer);

      // ——— the overlays: altitude-aware, all solid fills, no gradients ——
      // Every overlay draws only when its altitude weight rises above a
      // small threshold; the crossfade is per-primitive alpha, so the
      // dissolve zone (crystal → beaker) blends legibly, the molecule zoom
      // fades the beaker as the ball-and-stick swells in, etc.
      const ctx2 = stage?.overlay2d;
      if (ctx2) {
        const w = size.width;
        const h = size.height;
        ctx2.clearRect(0, 0, w, h);

        // ——— crystal altitude overlay: flakes on the bench ——
        if (altWeights.crystal > 0.02) {
          const a = altWeights.crystal;
          for (const f of flakes) {
            const cx = f.x * w;
            const cy = f.y * h;
            const r = 14 + f.size * 22;
            const c = Math.cos(f.rot);
            const s = Math.sin(f.rot);
            // A faceted hexagon: solid fill with a hint of edge highlight.
            ctx2.beginPath();
            for (let k = 0; k < 6; k++) {
              const ang = (k / 6) * Math.PI * 2;
              const px = cx + Math.cos(ang) * r * c - Math.sin(ang) * r * s * 0.6;
              const py = cy + Math.sin(ang) * r * 0.72;
              if (k === 0) ctx2.moveTo(px, py);
              else ctx2.lineTo(px, py);
            }
            ctx2.closePath();
            ctx2.fillStyle = `rgba(220, 226, 236, ${0.35 * a})`;
            ctx2.fill();
            ctx2.strokeStyle = `rgba(240, 246, 252, ${0.75 * a})`;
            ctx2.lineWidth = 1;
            ctx2.stroke();
            // one bright glint per facet, from the caustic
            const glint = crystalCaustics(f.x, f.y, now / 1000, f.seed);
            ctx2.fillStyle = `rgba(255, 255, 255, ${a * glint * 0.6})`;
            ctx2.beginPath();
            ctx2.arc(cx - r * 0.25, cy - r * 0.35, r * 0.15, 0, Math.PI * 2);
            ctx2.fill();
          }
        }

        // ——— dissolve transition overlay: a beaker outline ——
        if (altWeights.solution > 0.05 && altWeights.crystal > 0.05) {
          // during the crossfade, hint at a beaker's rim so the visitor
          // reads the crystal falling INTO something
          const a = Math.min(altWeights.solution, altWeights.crystal);
          const cx = w * 0.5;
          const cy = h * 0.55;
          const rw = w * 0.35;
          const rh = h * 0.32;
          ctx2.strokeStyle = `rgba(200, 220, 235, ${a * 0.55})`;
          ctx2.lineWidth = 2;
          ctx2.beginPath();
          ctx2.moveTo(cx - rw, cy - rh);
          ctx2.lineTo(cx - rw, cy + rh);
          ctx2.lineTo(cx + rw, cy + rh);
          ctx2.lineTo(cx + rw, cy - rh);
          ctx2.stroke();
          // waterline
          ctx2.strokeStyle = `rgba(160, 220, 220, ${a * 0.4})`;
          ctx2.beginPath();
          ctx2.moveTo(cx - rw + 4, cy - rh * 0.25);
          ctx2.lineTo(cx + rw - 4, cy - rh * 0.25);
          ctx2.stroke();
        }

        // ——— solution altitude overlay: the ghost spectrum + stripe ——
        if (altWeights.solution > 0.02) {
          const a = altWeights.solution;
          const peak = Math.max(0.001, spectrumPeak(spectrum));
          const scale = Math.min(1, peak / SPECTRUM_MAX);
          const topH = 0.32 * h;
          const stripeH = Math.max(2, h * 0.005);
          const chunks = 60;
          for (let i = 0; i < chunks; i++) {
            const x0 = (i / chunks) * w;
            const x1 = ((i + 1) / chunks) * w;
            const lam = 200 + ((i + 0.5) / chunks) * 600;
            const rgb = wavelengthToRgb(lam);
            ctx2.fillStyle = `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${(0.35 + 0.35 * world.breathAmp) * a})`;
            ctx2.fillRect(x0, 0, x1 - x0, stripeH);
          }
          ctx2.lineWidth = 1.5;
          ctx2.strokeStyle = `rgba(240,236,210,${(0.7 + 0.25 * world.breathAmp) * a})`;
          ctx2.beginPath();
          for (let i = 0; i < SPECTRUM_BINS; i++) {
            const x = (i / (SPECTRUM_BINS - 1)) * w;
            const y = stripeH + topH * (1 - (spectrum.bins[i] / SPECTRUM_MAX) * (0.8 + 0.4 * scale));
            if (i === 0) ctx2.moveTo(x, y);
            else ctx2.lineTo(x, y);
          }
          ctx2.stroke();
        }

        // ——— molecule altitude overlay: the ball-and-stick model ——
        if (altWeights.molecule > 0.02) {
          const a = altWeights.molecule;
          const bonds = projectMoleculeBonds(molecule3D, w, h);
          const atoms = projectMoleculeAtoms(molecule3D, w, h);
          // Bonds first (behind the atom balls). Double / triple bonds
          // draw as parallel strokes.
          for (let i = 0; i < bonds.length; i++) {
            const seg = bonds[i];
            const dx = seg.bx - seg.ax;
            const dy = seg.by - seg.ay;
            const len = Math.max(1, Math.hypot(dx, dy));
            const nx = -dy / len;
            const ny = dx / len;
            const strokes = seg.order === 3 ? 3 : seg.order === 2 ? 2 : 1;
            for (let k = 0; k < strokes; k++) {
              const off = strokes === 1 ? 0 : (k - (strokes - 1) / 2) * 4;
              ctx2.strokeStyle = `rgba(210, 210, 220, ${a * (i === box.selectedBondIdx && now < box.selectedBondUntil ? 1 : 0.75)})`;
              ctx2.lineWidth = i === box.selectedBondIdx && now < box.selectedBondUntil ? 3.2 : 2.2;
              ctx2.beginPath();
              ctx2.moveTo(seg.ax + nx * off, seg.ay + ny * off);
              ctx2.lineTo(seg.bx + nx * off, seg.by + ny * off);
              ctx2.stroke();
            }
          }
          // Atoms — sorted by z so far-side atoms draw first.
          const zSorted = [...atoms.entries()].sort((a1, b1) => a1[1].z - b1[1].z);
          for (const [, atom] of zSorted) {
            const alpha = 0.95 * a * (0.75 + 0.25 * ((atom.z + 2) / 4));
            ctx2.fillStyle = ATOM_COLOR[atom.el as keyof typeof ATOM_COLOR] ?? "rgba(240,240,240,1)";
            ctx2.globalAlpha = alpha;
            ctx2.beginPath();
            ctx2.arc(atom.x, atom.y, atom.r, 0, Math.PI * 2);
            ctx2.fill();
            ctx2.globalAlpha = 1;
            // subtle outline
            ctx2.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.5})`;
            ctx2.lineWidth = 1;
            ctx2.stroke();
          }
          // chirality label — small, unobtrusive
          ctx2.fillStyle = `rgba(240, 236, 210, ${a * 0.85})`;
          ctx2.font = `${Math.max(14, h * 0.025)}px system-ui, -apple-system, sans-serif`;
          ctx2.textAlign = "left";
          ctx2.textBaseline = "top";
          ctx2.fillText(`(${molecule3D.chirality})`, w * 0.03, h * 0.03);
          // selected-bond order readout
          if (box.selectedBondIdx >= 0 && now < box.selectedBondUntil) {
            const bond = molecule3D.bonds[box.selectedBondIdx];
            const label = bond.order === 3 ? "triple" : bond.order === 2 ? "double" : "single";
            ctx2.fillStyle = `rgba(240, 236, 210, ${a * 0.75})`;
            ctx2.fillText(label, w * 0.03, h * 0.03 + Math.max(14, h * 0.025) * 1.4);
          }
        }

        // ——— chromophore altitude overlay: HOMO/LUMO + photons ——
        if (altWeights.chromophore > 0.02) {
          const a = altWeights.chromophore;
          // aromatic ring plane, drawn as a hex
          const cx = w * 0.5;
          const cy = h * 0.5;
          const rr = Math.min(w, h) * 0.18;
          ctx2.strokeStyle = `rgba(180, 200, 235, ${a * 0.55})`;
          ctx2.lineWidth = 2;
          ctx2.beginPath();
          for (let k = 0; k < 6; k++) {
            const ang = (k / 6) * Math.PI * 2;
            const px = cx + Math.cos(ang) * rr;
            const py = cy + Math.sin(ang) * rr * 0.35; // squashed = the plane seen from a shallow angle
            if (k === 0) ctx2.moveTo(px, py);
            else ctx2.lineTo(px, py);
          }
          ctx2.closePath();
          ctx2.stroke();

          // HOMO/LUMO diagram — bottom-left corner
          const dx = w * 0.04;
          const dy = h * 0.66;
          const dw = Math.min(w * 0.24, 180);
          const dh = Math.min(h * 0.24, 160);
          // frame
          ctx2.strokeStyle = `rgba(220, 220, 230, ${a * 0.6})`;
          ctx2.lineWidth = 1;
          ctx2.strokeRect(dx, dy, dw, dh);
          // HOMO line (low), LUMO line (high) — scaled to the current n1/n2 ΔE
          const dEeV = box.lastDE;
          const bandScale = Math.min(1, 8 / Math.max(0.01, dEeV)); // more energy → tighter gap on screen
          const homoY = dy + dh * 0.72;
          const lumoY = dy + dh * (0.72 - 0.48 * bandScale);
          ctx2.strokeStyle = `rgba(240, 220, 180, ${a * 0.9})`;
          ctx2.lineWidth = 2;
          ctx2.beginPath();
          ctx2.moveTo(dx + 20, homoY);
          ctx2.lineTo(dx + dw - 20, homoY);
          ctx2.stroke();
          ctx2.strokeStyle = `rgba(180, 220, 240, ${a * 0.9})`;
          ctx2.beginPath();
          ctx2.moveTo(dx + 20, lumoY);
          ctx2.lineTo(dx + dw - 20, lumoY);
          ctx2.stroke();
          // gap label — no compound-naming, just ΔE and n1→n2
          ctx2.fillStyle = `rgba(240, 236, 210, ${a * 0.8})`;
          ctx2.font = `${Math.max(11, h * 0.018)}px system-ui, -apple-system, sans-serif`;
          ctx2.textAlign = "left";
          ctx2.textBaseline = "top";
          ctx2.fillText(`n=${box.n1}→${box.n2}`, dx + 6, dy + 6);
          ctx2.fillText(`${dEeV.toFixed(2)} eV`, dx + 6, dy + 6 + Math.max(11, h * 0.018) * 1.3);

          // photons descending from the finger's y
          for (const p of chromophorePhotons) {
            const px = wavelengthToX(p.lambda) * w;
            const py = p.y * h;
            const rgb = wavelengthToRgb(p.lambda);
            ctx2.fillStyle = `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${a * 0.9})`;
            ctx2.beginPath();
            ctx2.arc(px, py, 5, 0, Math.PI * 2);
            ctx2.fill();
            // resonance check: when a photon reaches the ring plane, flash
            // an arrow between HOMO and LUMO if resonant
            if (Math.abs(py - cy) < 12) {
              if (resonant(p.lambda, box.lastDE, 0.35)) {
                ctx2.strokeStyle = `rgba(240, 236, 210, ${a})`;
                ctx2.lineWidth = 2;
                ctx2.beginPath();
                ctx2.moveTo(dx + dw * 0.6, homoY);
                ctx2.lineTo(dx + dw * 0.6, lumoY);
                ctx2.stroke();
                // arrowhead
                ctx2.beginPath();
                ctx2.moveTo(dx + dw * 0.6, lumoY);
                ctx2.lineTo(dx + dw * 0.6 - 4, lumoY + 6);
                ctx2.lineTo(dx + dw * 0.6 + 4, lumoY + 6);
                ctx2.closePath();
                ctx2.fill();
              }
            }
          }
        }
      }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      unvis();
      ungal();
      writer.flush();
      writer.cancel();
      detachPinch();
      try { resetRef.current(); } catch { /* noop */ }
      populationLayer?.dispose();
      quad?.dispose();
      stage?.dispose();
      voiceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const letGo = useCallback(() => letGoRef.current(), []);

  return (
    <RoomShell
      route="/observe"
      surfaceRef={wrapRef}
      voice={voiceRef.current ?? undefined}
      letGo={{ label: "let the sample go", onLetGo: letGo, visible: standing > 0 }}
      keyboard={{
        enter: () => keyTapRef.current(),
        enterHeld: (elapsed) => keyHoldRef.current(elapsed),
        arrow: (dx, dy) => keyArrowRef.current(dx, dy),
      }}
      // The room owns pinch (useBandEdgeTravel maps the internal 1..4096
      // zoom onto the /drop band). RoomShell disables its own ScaleTravel
      // mount so the two never fight over the frame verb.
      ownsFrame
      style={{ position: "fixed", inset: 0, background: "#050912" }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={canvasRef}
          role="application"
          tabIndex={0}
          aria-label="one substance in five altitudes: a heap of crystalline solid on a matte-black bench, a beaker, a cuvette from above, one ball-and-stick molecule, and its chromophore's π-system. pinch to travel between them."
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        />
        <canvas
          ref={overlayRef}
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        />
      </div>
      {scaleEdgeOverlay}
    </RoomShell>
  );
}
