"use client";

/**
 * /observe — the sample under the beam.
 *
 * A cuvette of solvent seen from above, dissolved with the o-chlorophenyl
 * cyclohexanone family (an aromatic π→π* band near 260 nm, a shallow
 * carbonyl n→π* shoulder near 285 nm). The hidden horizontal axis of the
 * room is a wavelength axis, 200 nm at one edge to 800 nm at the other; the
 * visitor's finger picks the wavelength, and a shaft of that color falls
 * through the bath. Molecules whose electronic transition matches the
 * photon energy ignite — a shudder, an outer glow the color of the emission
 * — then relax back to ground. The far wall paints the beam through
 * Beer-Lambert, so at a band the wall darkens; between bands it stays
 * bright. As the beam sweeps, a ghost spectrum (absorbance vs wavelength)
 * accumulates along the top edge of the cuvette, drawn from the
 * population's response — the sample's UV/Vis fingerprint, from felt
 * experience, not from a chart.
 *
 * The physics all lives in @/lib/observe.ts; this file is the rendering
 * and gesture wiring. RoomShell owns the gesture engine, the vessel bus,
 * the axis chrome, the glimmer clock and the quiet clear.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
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
  BAND_N,
  BAND_PI,
  MOLECULE_CAP,
  OBSERVE_STORAGE_KEY,
  REFERENCE_CONCENTRATION,
  SPECTRUM_BINS,
  SPECTRUM_MAX,
  bornMolecule,
  createSpectrumAccumulator,
  loadSpectrum,
  moleculeRadius,
  photonHit,
  sampleAbsorbance,
  serializeSpectrum,
  spectrumAdd,
  spectrumDecay,
  spectrumPeak,
  stepMolecules,
  wavelengthAtBin,
  wavelengthToRgb,
  wavelengthToX,
  xToWavelength,
  type FieldInput,
  type Molecule,
  type SpectrumAccumulator,
} from "@/lib/observe";

// ——— rendering constants ————————————————————————————————————————————
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

// ——— the material: solvent bath, beam, absorption wall ————————————
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

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);

  // subtle vortex distortion when the finger stirs
  if (uStir > 0.02) {
    vec2 sp = (uv - vec2(0.5)) * vec2(aspect, 1.0);
    float ang = atan(sp.y, sp.x);
    float rr = length(sp);
    float twist = uStir * 0.06 * exp(-rr * 4.0);
    float ca = cos(ang + twist), sa = sin(ang + twist);
    uv = vec2(0.5) + vec2(ca, sa) * rr / vec2(aspect, 1.0);
  }
  // tilt lean — the bath's surface slides toward the low side
  uv.x += uTilt.x * 0.010 * (1.0 - abs(uv.y - 0.5) * 2.0);
  uv.y += uTilt.y * 0.010 * (1.0 - abs(uv.x - 0.5) * 2.0);

  vec3 col = bathColor(uv, uBreath);

  // ——— the beam: a shaft at uBeamX, from top to bottom of the cuvette ——
  // Its column brightness attenuates with distance from the axis, and its
  // full-column color is the beam's palette color. On-band the shaft is
  // dimmer past the population (Beer-Lambert), off-band it stays bright.
  if (uBeamOn > 0.01) {
    float xdiff = abs(uv.x - uBeamX) * aspect;
    float shaft = exp(-xdiff * xdiff * 380.0);
    float trans = pow(10.0, -uBeamAbsorb * (uv.y * 0.7 + 0.15));
    // beam is bright above the population, attenuated below by absorbance
    vec3 beamCol = uBeamRgb * (0.55 + 0.45 * uBreath) * (0.7 + 0.3 * trans);
    col += beamCol * shaft * uBeamOn * (0.85 - 0.25 * uNight);

    // ——— the far wall paint: bottom stripe carries transmitted color ——
    // Reads: Beer-Lambert transmittance through the full path.
    float wallY = smoothstep(0.94, 0.98, uv.y);
    float wallTrans = pow(10.0, -uBeamAbsorb);
    vec3 wallCol = uBeamRgb * wallTrans;
    col = mix(col, wallCol * 1.2, wallY * shaft * uBeamOn);
  }

  // ——— sustained span beam (two still fingers), a second column ——
  if (uSustainLambda > 199.5) {
    float xs = clamp((uSustainLambda - 200.0) / 600.0, 0.0, 1.0);
    float xdiff = abs(uv.x - xs) * aspect;
    float shaft = exp(-xdiff * xdiff * 380.0);
    float trans = pow(10.0, -uSustainAbsorb * (uv.y * 0.7 + 0.15));
    col += uSustainRgb * shaft * 0.6 * (0.7 + 0.3 * trans);
    float wallY = smoothstep(0.94, 0.98, uv.y);
    float wallTrans = pow(10.0, -uSustainAbsorb);
    col = mix(col, uSustainRgb * wallTrans * 1.2, wallY * shaft * 0.9);
  }

  // ——— night mode: everything dims but the two absorption bands stay
  //     visible as a fingerprint across the top wavelength strip ——
  if (uNight > 0.01) {
    // wavelength strip across the very top edge — always visible in night mode
    float stripY = smoothstep(0.02, 0.0, uv.y);
    float nm = 200.0 + uv.x * 600.0;
    float A = sampleAbsorbance(nm, uConcentration);
    float darken = 1.0 - clamp(A * 0.7, 0.0, 0.9);
    vec3 stripCol = wavelengthRgb(nm) * darken;
    col = mix(col * (1.0 - uNight * 0.75), stripCol, stripY * uNight);
  }

  // ——— lens tier 1: draw an A(λ) chart lightly over the whole cuvette ——
  if (uLens > 0.5) {
    float nm = 200.0 + uv.x * 600.0;
    float A = sampleAbsorbance(nm, uConcentration);
    float chartH = 0.35 + clamp(A / 1.6, 0.0, 0.95);
    float band = exp(-pow((uv.y - (1.0 - chartH)) * 100.0, 2.0));
    col = mix(col, wavelengthRgb(nm) * 0.85, band * uLens * 0.32);
  }

  // ——— lens tier 2: an orbital diagram, faint SVG-like overlay ——
  if (uLens > 1.5) {
    vec2 op = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
    float dist = length(op);
    float homo = smoothstep(0.14, 0.13, dist);
    float lumo = smoothstep(0.30, 0.29, dist) - smoothstep(0.29, 0.28, dist);
    col = mix(col, vec3(1.0), (homo * 0.15 + lumo * 0.20) * (uLens - 1.0));
  }

  // vignette
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

    // ——— the voice: RoomShell speaks these; every meaningful verb lands
    //     in the two senses and a haptic ———
    const voice: RoomVoice = {
      tap: (t) => {
        if (t.fingers >= 2) return; // 2f is stepBack, 3f is tutti
        lastGestureAt = performance.now();
        const nx = t.x / Math.max(1, wrap.clientWidth);
        const ny = t.y / Math.max(1, wrap.clientHeight);
        cursorNx = nx; cursorNy = ny;
        const lambda = xToWavelength(nx);
        // tap-train ladder — 1 / 3 / 5 / n rungs
        const tier = tapTrainTier(t.count);
        if (tier === "n") {
          // seven and beyond: the peal — sweep the whole axis fast, ghost curve fills
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
          // five: mid-band diode-array snapshot — fire the three anchor λ
          for (const lam of [BAND_PI.center, BAND_N.center, 500]) fireBeam(lam, 0.9, performance.now());
          beamOn(lambda, 0.95, 320);
          try { haptics.chop(); } catch { /* noop */ }
          try { audio.bell?.(); } catch { /* noop */ }
          return;
        }
        if (tier === 3) {
          // three: a burst at the finger's λ (three photons in a chord)
          for (let i = 0; i < 3; i++) fireBeam(lambda + (i - 1) * 4, 0.8, performance.now());
          beamOn(lambda, 0.9, 300);
          try { haptics.roll(); } catch { /* noop */ }
          try { audio.playNote?.(72, 220); } catch { /* noop */ }
          return;
        }
        // tier 1: one photon
        fireBeam(lambda, t.intensity, performance.now());
        beamOn(lambda, 0.7 + t.intensity * 0.3);
        try { haptics.ripple(0.4 + t.intensity * 0.35); } catch { /* noop */ }
        try {
          // pitch tracks wavelength — shorter λ rings higher
          const midi = Math.round(96 - (wavelengthToX(lambda) * 40));
          audio.playNote?.(midi, 180);
        } catch { /* noop */ }
      },
      stepBack: (_e) => {
        lastGestureAt = performance.now();
        if (world.lensTarget > 0) {
          world.lensTarget = Math.max(0, Math.floor(world.lensTarget) - 1);
        }
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
        const lambda = xToWavelength(nx);
        // sweep the beam; every ~20ms fire a soft photon-hit test
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
        // span: two still fingers hold a beam of the midpoint wavelength
        // open. While held, molecules resonant with λ keep re-exciting.
        if (s.phase === "release") {
          sustain.lambda = NO_LAMBDA;
          // On release, the spectrum has a deep well drawn at that λ (the
          // sustained beam wrote strongly to the accumulator during the hold)
          return;
        }
        const cx = s.cx / Math.max(1, wrap.clientWidth);
        const lambda = xToWavelength(cx);
        sustain.lambda = lambda;
        // continuously add to spectrum while held
        fireBeam(lambda, 0.7, performance.now());
      },
      lens: (l) => {
        // twist: cycle raw → A(λ) → orbital
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

    letGoRef.current = () => {
      for (const m of molecules) m.presence = 0.999;
      spectrum = createSpectrumAccumulator(performance.now());
      try {
        window.localStorage.setItem(
          OBSERVE_STORAGE_KEY,
          JSON.stringify({ v: 1, spectrum: serializeSpectrum(spectrum) }),
        );
      } catch { /* noop */ }
      writer.cancel();
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
        prog.setFloat("uBeamOn", beam.on * beam.intensity * world.breathAmp);
        prog.setFloat("uBeamX", beam.x);
        prog.setVec3("uBeamRgb", beamRgb[0], beamRgb[1], beamRgb[2]);
        prog.setFloat("uBeamAbsorb", absA);
        prog.setFloat("uConcentration", world.concentration);
        prog.setFloat("uStir", world.stir);
        prog.setVec2("uTilt", world.tiltX, world.tiltY);
        prog.setFloat("uNight", world.night);
        prog.setFloat("uLens", world.lens);
        prog.setFloat("uBroaden", world.temperature * 0.9);
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

      // draw the population
      syncPopulation(now);
      instanceBuffer.reset();
      population.emit(
        {
          width: size.width,
          height: size.height,
          tMs: now,
          breath: clocksFrom(clocks).breath,
          detail: detail.particles,
          reducedMotion: reduced,
        },
        instanceBuffer,
      );
      populationLayer?.draw(instanceBuffer);

      // ——— the ghost spectrum overlay (2D polyline; NO gradients, NO shadowBlur) ——
      const ctx2 = stage?.overlay2d;
      if (ctx2) {
        const w = size.width;
        const h = size.height;
        ctx2.clearRect(0, 0, w, h);
        const peak = Math.max(0.001, spectrumPeak(spectrum));
        const scale = Math.min(1, peak / SPECTRUM_MAX);
        const topH = 0.32 * h;
        // draw the axis stripe of wavelength color across the top edge
        const stripeH = Math.max(2, h * 0.005);
        const chunks = 60;
        for (let i = 0; i < chunks; i++) {
          const x0 = (i / chunks) * w;
          const x1 = ((i + 1) / chunks) * w;
          const lam = 200 + ((i + 0.5) / chunks) * 600;
          const rgb = wavelengthToRgb(lam);
          ctx2.fillStyle = `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${0.35 + 0.35 * world.breathAmp})`;
          ctx2.fillRect(x0, 0, x1 - x0, stripeH);
        }
        // draw the ghost curve
        ctx2.lineWidth = 1.5;
        ctx2.strokeStyle = `rgba(240,236,210,${0.7 + 0.25 * world.breathAmp})`;
        ctx2.beginPath();
        for (let i = 0; i < SPECTRUM_BINS; i++) {
          const x = (i / (SPECTRUM_BINS - 1)) * w;
          const y = stripeH + topH * (1 - (spectrum.bins[i] / SPECTRUM_MAX) * (0.8 + 0.4 * scale));
          if (i === 0) ctx2.moveTo(x, y);
          else ctx2.lineTo(x, y);
        }
        ctx2.stroke();
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
      style={{ position: "fixed", inset: 0, background: "#050912" }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={canvasRef}
          role="application"
          tabIndex={0}
          aria-label="a shallow cuvette of solvent from above; the horizontal axis is a hidden wavelength axis 200 to 800 nm, and the finger picks a beam that ignites molecules in resonance"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        />
        <canvas
          ref={overlayRef}
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        />
      </div>
    </RoomShell>
  );
}
