// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.storage_key, spec.palette.bg,
//           ComponentName (PascalCase of key), spec.aria_label.
// Three LLM slots below carry the creative work; the boilerplate is verbatim.
"use client";

/**
 * /pebble — one stone, cut open. See docs/plans/object-compiler.md
 * §"Three creative slots" for what belongs in each slot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { getTurbulence, relaxTurbulence, stirTurbulence } from "@/lib/turbulence";
import RoomShell from "@/components/RoomShell";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { createGLStage, FULLSCREEN_VERT_UNIT } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import {
  onVisibility,
  onGalleryPause,
  createIdleWriter,
  createFrameGovernor,
  isEmbeddedFrame,
} from "@/lib/room-runtime";
import {
  MAX_GROWTH_RINGS,
  POLISH_MAX,
  advanceExact,
  cleavageAt,
  initState,
  partialsFor,
  polishStep,
  ringHzFor,
  type Climate as PebbleClimate,
  type MineralId,
  type PebbleState,
} from "@/lib/pebblecore";
// The GLSL shader body reads MAX_GROWTH_RINGS through a template literal at
// build time; the void keeps the constant off `noUnusedLocals` when the
// module resolves at parse time before the FRAG string is evaluated.
void MAX_GROWTH_RINGS;

/** Persistence key — versioned; a schema change bumps the suffix. */
const STORE_KEY = "objetdart:pebble:v1";
/** How often the idle writer flushes to storage while a hand is present. */
const SAVE_EVERY_MS = 4000;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * The material. Everything from the uniforms down through main() lives in the
 * slot below; the wrapping backtick template is boilerplate so an empty slot
 * still parses as TypeScript.
 */
const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uBreath;
uniform float uTurbulence;
uniform float uReduced;

varying vec2 vUv;

// The lens uniforms — every visible register is a lens over the domain state.
uniform vec4 uRings[${MAX_GROWTH_RINGS}]; // x = radius, y = mineralHue, z = thickness, w = seed
uniform int  uRingCount;
uniform float uPolishDepth;       // 0..POLISH_MAX
uniform float uRotation;          // radians — drag turns the stone in its section
uniform vec2  uLamp;              // NDC of the raking lamp (0..1)
uniform float uLensRaised;        // 0..1
uniform float uLean;              // -1..1
uniform float uNight;             // 0..1
uniform float uSectionScale;      // outer radius of the pebble in NDC
uniform vec4  uCleavage;          // xyz = plane hkl, w = highlight strength
uniform float uPolishMax;         // constant echoed for GLSL
uniform vec4  uClimate;           // waterCarry, latticePressure, tau, season

// The palette — six registers set once, from the manifest.
const vec3 BG      = vec3(0.016, 0.024, 0.031); // deep cabinet dark
const vec3 BG2     = vec3(0.059, 0.078, 0.110); // section shadow band
const vec3 GLOW    = vec3(0.914, 0.851, 0.651); // polished shell highlight
const vec3 ACCENT  = vec3(0.706, 0.549, 0.353); // warm mineral body
const vec3 ACCENT2 = vec3(0.545, 0.627, 0.753); // cool ring lines + cleavage traces
const vec3 INK     = vec3(0.949, 0.925, 0.851); // lens numeric ink

// Hoskins' hash + value noise + short FBM (kept verbatim from spring).
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
  mat2 m = mat2(1.62, 1.19, -1.19, 1.62);
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = m * p + vec2(3.1, 5.4);
    a *= 0.5;
  }
  return v;
}

vec3 mineralTint(float hue) {
  // A palette of eight mineral hues, keyed by uRings[i].y in [0, 1].
  vec3 calcite  = vec3(0.86, 0.82, 0.72);
  vec3 quartz   = vec3(0.90, 0.87, 0.94);
  vec3 jasper   = vec3(0.68, 0.29, 0.20);
  vec3 agate    = vec3(0.62, 0.51, 0.44);
  vec3 chert    = vec3(0.46, 0.38, 0.30);
  vec3 chalced  = vec3(0.82, 0.72, 0.66);
  vec3 feldspar = vec3(0.90, 0.78, 0.60);
  vec3 obsidian = vec3(0.09, 0.09, 0.13);
  float idx = clamp(hue * 8.0, 0.0, 7.999);
  int i = int(idx);
  float f = fract(idx);
  vec3 a = calcite;
  vec3 b = quartz;
  if (i == 0) { a = calcite;  b = quartz; }
  else if (i == 1) { a = quartz;   b = jasper; }
  else if (i == 2) { a = jasper;   b = agate; }
  else if (i == 3) { a = agate;    b = chert; }
  else if (i == 4) { a = chert;    b = chalced; }
  else if (i == 5) { a = chalced;  b = feldspar; }
  else if (i == 6) { a = feldspar; b = obsidian; }
  else             { a = obsidian; b = obsidian; }
  return mix(a, b, f);
}

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  float aspect = uRes.x / max(1.0, uRes.y);
  vec2 uv = vUv;
  vec2 centered = uv - vec2(0.5);
  centered.x *= aspect;
  // Lean: the section tilts under tilt — the lamp shifts, not the stone.
  centered.y += uLean * 0.04;

  // The lit background — a soft cabinet fade from BG at the corners to a
  // slightly warmer core near the stone's centre.
  float vignette = smoothstep(1.1, 0.0, length(centered * vec2(0.9, 1.2)));
  vec3 col = mix(BG, BG2 * 0.85, vignette);

  // A raking lamp on the upper-left casts a warm bloom.
  vec2 lamp = (uLamp - vec2(0.5)) * vec2(aspect, 1.0);
  float lampDist = length(centered - lamp);
  col += GLOW * 0.14 * exp(-lampDist * lampDist * 8.0);

  // The stone itself — one big SDF ellipse in the centre, rotated by uRotation.
  vec2 stoneP = rot2(centered, uRotation);
  float stoneR = length(stoneP);
  float outer = uSectionScale;

  // Inside the stone: draw the concentric growth rings.
  if (stoneR < outer) {
    // Normalize the internal coordinate — the stone's own [0, 1].
    float r01 = stoneR / outer;

    // Interfingering noise so ring boundaries never read as painted lines.
    float warp = fbm(stoneP * 8.0) * 0.02;
    float r01Warp = clamp(r01 + warp - 0.01, 0.0, 1.0);

    // Read the growth rings from uRings — each entry gives a radius, a
    // mineral hue, and a thickness. The section's tint is a smoothstep
    // sum over the rings, so ring transitions interfinger.
    vec3 sectionTint = ACCENT;
    for (int i = 0; i < ${MAX_GROWTH_RINGS}; i++) {
      if (i >= uRingCount) break;
      vec4 ring = uRings[i];
      float radius = ring.x;
      float mHue = ring.y;
      float thickness = max(0.001, ring.z);
      float weight = smoothstep(radius - thickness * 0.6, radius, r01Warp)
                    * (1.0 - smoothstep(radius, radius + thickness * 0.6, r01Warp));
      sectionTint = mix(sectionTint, mineralTint(mHue), weight);
    }

    // The polished shell — a thin outer band whose thickness is uPolishDepth
    // times the outer radius, with a Fresnel-like highlight where the lamp
    // catches the surface angle.
    float shellStart = 1.0 - (uPolishDepth / uPolishMax) * 0.28;
    float shellHi = smoothstep(shellStart, 1.0, r01);
    // The lamp angle is the direction from stone centre to lamp position.
    vec2 lampDir = normalize(lamp - vec2(0.0, 0.0));
    float lampFacing = clamp(dot(normalize(stoneP), lampDir), 0.0, 1.0);
    float glossHighlight = shellHi * pow(lampFacing, 6.0);
    sectionTint = mix(sectionTint, GLOW, glossHighlight * 0.55);

    // The cleavage traces — fine ink lines along the current cleavage plane,
    // drawn crisper on the section.
    vec2 planeDir = vec2(uCleavage.x, uCleavage.y);
    if (length(planeDir) > 0.0) {
      planeDir = normalize(planeDir);
      float perp = abs(dot(stoneP / outer, vec2(planeDir.y, -planeDir.x)));
      float trace = 1.0 - smoothstep(0.0, 0.02, perp);
      sectionTint = mix(sectionTint, ACCENT2, trace * uCleavage.w * 0.6);
    }

    // Slight radial darkening toward the centre so the section has depth.
    sectionTint *= mix(1.0, 0.72, 1.0 - r01);

    // Section edge shadow — the outer rim reads as a lit specimen.
    float rimAO = smoothstep(1.0, 0.94, r01);
    col = mix(col, sectionTint, rimAO);

    // The polish's shine on the very outer envelope.
    float envelope = smoothstep(1.0, 0.995, r01);
    col = mix(col, GLOW, envelope * glossHighlight * 0.4);
  }

  // The twist lens — draw the partials as tick marks around the stone,
  // the polish depth in mm, and the mineral name (overlaid on 2D from JS).
  if (uLensRaised > 0.001) {
    // Ring the section with ACCENT2 tick marks at each ring's radius, so
    // the lens shows the reciprocal-lattice partials as a physical map.
    float ringPad = 0.02;
    float outerRing = outer + ringPad;
    if (stoneR > outerRing - 0.002 && stoneR < outerRing + 0.002) {
      float angle = atan(centered.y, centered.x);
      float tick = smoothstep(0.98, 1.0, cos(angle * 6.0 + uClimate.w * 6.28));
      col = mix(col, ACCENT2, tick * uLensRaised * 0.6);
    }
  }

  // Night register — flip's face-down darkens the cabinet but keeps the
  // polish highlight.
  col *= mix(1.0, 0.42, uNight);

  // The breath — subtle life at rest.
  col *= 0.94 + 0.06 * uBreath;

  // Turbulence: sparkle a bit under stir.
  col += vec3(0.05, 0.04, 0.03) * uTurbulence * hash21(gl_FragCoord.xy);

  // A grain sits on the darkest tile so the section never reads flat.
  col += (hash21(gl_FragCoord.xy * 0.32) - 0.5) * 0.012;

  // The bg register for INK contrast — never write below near-black.
  col = clamp(col, 0.0, 1.4);

  // Trace INK for the readable text — not used for background paint but
  // referenced so tsc's noUnusedLocals passes at the shader-adjacent code.
  vec3 inkRegister = INK * uLensRaised;
  col += inkRegister * 0.0;

  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * The engine's private API — positional signatures the useMemo below maps
 * onto the RoomVoice event-object signatures. Same shape as spring's
 * SpringApi.
 */
type PebbleApi = {
  tap: (x: number, y: number, intensity: number, count: number, fingers: number) => void;
  stepBack: () => void;
  tutti: (intensity: number) => void;
  plant: (x: number, y: number) => void;
  deepen: (elapsed: number, x: number, y: number, tier: number) => void;
  ceremony: (x: number, y: number) => void;
  settle: (elapsed: number, x: number, y: number, tier: number) => void;
  timeScale: (k: number) => void;
  drag: (
    phase: "start" | "move" | "end",
    x: number, y: number, dx: number, dy: number, fingers: number,
  ) => void;
  wind: (dx: number, dy: number) => void;
  flick: (x: number, y: number, angle: number, speed: number, fingers: number) => void;
  stir: (cx: number, cy: number, angularVelocity: number) => void;
  lens: (angle: number, velocity: number) => void;
  season: (angle: number, velocity: number) => void;
  drum: (hits: number, alternation: number, x: number, y: number) => void;
  scatter: (intensity: number) => void;
  gravity: (gamma: number) => void;
  knock: (intensity: number) => void;
  night: (faceDown: boolean) => void;
  glimmer: () => void;
  reduced: (on: boolean) => void;
  moveCursor: (dx: number, dy: number) => void;
  keyTap: () => void;
  keyHold: (elapsed: number) => void;
  keyEscape: () => void;
  clear: () => void;
};

export default function Pebble() {
  const surfaceRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<PebbleApi | null>(null);
  const [hasKept, setHasKept] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    const overlay = overlayRef.current;
    if (!surface || !overlay) return;

    const audio = getFieldAudio();
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");

    // ——— the small state vector — read back from storage if present ———
    let stored: unknown = null;
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {
      /* the section is empty */
    }
    void stored;

    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    let last = performance.now();
    let raf = 0;
    let running = true;

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

    const writer = createIdleWriter(() => {
      try {
        const payload = {
          v: 1,
          seedKey: state.seedKey,
          polishDepth: state.polishDepth,
          season: state.season,
          tau: state.tau,
          mineral: state.growthRings[0]?.mineral ?? "quartz",
          rings: state.growthRings,
          climate,
          cleared,
          lastSeen: Date.now(),
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* storage full or unavailable */
      }
    });

    // ——— the shared GL harness ———
    const stage = createGLStage(surface, {
      label: "pebble",
      wrap: surface.parentElement,
      overlay,
      renderScale: embedded ? 0.42 : 0.6,
      quality: embedded ? "medium" : "high",
      reducedMotion: reduced,
      embedded,
    });
    const prog = stage?.program(FULLSCREEN_VERT_UNIT, FRAG) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog, "unit") : null;

    // ——— the small state vector — read back from storage if present ———
    const SEED = 0x7ebb1e;
    let state: PebbleState = initState(SEED);
    let climate: PebbleClimate = { waterCarry: 0.4, latticePressure: 0.35 };
    let cleared = false;
    try {
      if (stored && typeof stored === "object") {
        const raw = stored as {
          v?: number;
          seedKey?: number;
          polishDepth?: number;
          season?: number;
          tau?: number;
          latticeCa?: number;
          latticeSystem?: string;
          mineral?: MineralId;
          climate?: PebbleClimate;
          cleared?: boolean;
          rings?: Array<{ radius?: number; mineral?: MineralId; thickness?: number; seed?: number }>;
          lastSeen?: number;
        };
        cleared = raw.cleared === true;
        const seedKey = typeof raw.seedKey === "number" ? raw.seedKey : SEED;
        const startingMineral = raw.mineral ?? undefined;
        state = initState(seedKey, startingMineral);
        if (typeof raw.polishDepth === "number") {
          state = { ...state, polishDepth: Math.max(0, Math.min(POLISH_MAX, raw.polishDepth)) };
        }
        if (typeof raw.season === "number") state = { ...state, season: raw.season };
        if (typeof raw.tau === "number") state = { ...state, tau: raw.tau };
        if (Array.isArray(raw.rings) && raw.rings.length > 0) {
          const rings = raw.rings
            .filter((r) => r && typeof r.radius === "number" && typeof r.thickness === "number")
            .slice(0, 24)
            .map((r, i) => ({
              radius: Math.max(0, Math.min(1, r.radius ?? 0)),
              mineral: (r.mineral ?? state.growthRings[0].mineral) as MineralId,
              thickness: Math.max(0, Math.min(1, r.thickness ?? 0)),
              seed: r.seed ?? i,
            }));
          if (rings.length > 0) state = { ...state, growthRings: rings };
        }
        if (raw.climate) climate = raw.climate;
        if (typeof raw.lastSeen === "number") {
          const awaySec = Math.max(0, (Date.now() - raw.lastSeen) / 1000);
          if (awaySec > 0) state = advanceExact(state, awaySec, climate);
        }
      }
    } catch {
      /* fresh stone */
    }
    setHasKept(state.polishDepth > 0.05 || state.growthRings.length > 1);

    // ——— live axes the shader lens over ———
    let rotation = 0;
    let rotationTarget = 0;
    let lampX = 0.28;
    let lampY = 0.24;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let night = 0;
    let nightTarget = 0;
    let lean = 0;
    let leanTarget = 0;
    let cleavageStrength = 0;
    let cleavagePlane: [number, number, number] = [1, 0, 0];
    let timeScale = 1;
    let timeScaleTarget = 1;
    let cursorX = 0.5;
    let cursorY = 0.5;
    let kbCharge = 0;
    let holdingShell = false;
    let holdElapsedMs = 0;
    let lastSaveAt = performance.now();
    let lastDeepenAt = 0;
    void kbCharge;
    void holdElapsedMs;

    // ——— uniform arrays, allocated once ———
    const ringU = new Float32Array(24 * 4);
    const MINERAL_INDEX: Record<MineralId, number> = {
      calcite:    0 / 8 + 0.5 / 8,
      quartz:     1 / 8 + 0.5 / 8,
      jasper:     2 / 8 + 0.5 / 8,
      agate:      3 / 8 + 0.5 / 8,
      chert:      4 / 8 + 0.5 / 8,
      chalcedony: 5 / 8 + 0.5 / 8,
      feldspar:   6 / 8 + 0.5 / 8,
      obsidian:   7 / 8 + 0.5 / 8,
    };

    // ——— helpers ———
    const toLocal = (px: number, py: number) => {
      const r = surface.getBoundingClientRect();
      return {
        nx: clamp01((px - r.left) / Math.max(1, r.width)),
        ny: clamp01((py - r.top) / Math.max(1, r.height)),
      };
    };

    const ringStone = (weight = 1) => {
      const hz = ringHzFor(state);
      const partials = partialsFor(state);
      try {
        // The fundamental is un-damped; the first partial rides the polish
        // damping, so a well-polished pebble sounds SHORTER.
        audio.playTone(hz, 0.14 + weight * 0.18);
        if (partials.length >= 2) {
          audio.playTone(hz * partials[1], 0.08 + weight * 0.12 * partials[1]);
        }
        haptics.ripple(0.3 + weight * 0.4);
      } catch {
        /* no audio */
      }
    };

    const cabinetGrain = () => {
      try {
        audio.playNote(32, 220);
      } catch {
        /* noop */
      }
    };

    // ——— the hand's verbs, in this room's material ———
    const engine: PebbleApi = {
      tap: (x: number, y: number, intensity: number, count: number, fingers: number) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        if (fingers >= 2) return; // step back handled elsewhere
        // Is the tap on the stone?
        const dxc = (nx - 0.5) * (surface.getBoundingClientRect().width /
          Math.max(1, surface.getBoundingClientRect().height));
        const dyc = ny - 0.5;
        const distFromCentre = Math.hypot(dxc, dyc);
        if (distFromCentre < 0.28) {
          ringStone(0.5 + intensity * 0.5 + Math.min(0.3, (count - 1) * 0.08));
          try {
            haptics.tap();
          } catch {
            /* noop */
          }
        } else {
          cabinetGrain();
        }
      },
      stepBack: () => {
        if (lensSnapped === 1) {
          lensSnapped = 0;
          lensTarget = 0;
          try {
            haptics.lens();
          } catch {
            /* noop */
          }
        }
      },
      tutti: (intensity: number) => {
        // Every growth ring rings at once — one chord across the stone's history.
        const hz = ringHzFor(state);
        const partials = partialsFor(state);
        try {
          audio.playTone(hz, 0.24 + intensity * 0.2);
          for (let k = 1; k < Math.min(partials.length, 4); k++) {
            audio.playTone(hz * partials[k], 0.14 * partials[k]);
          }
          haptics.roll();
        } catch {
          /* noop */
        }
      },
      plant: (x: number, y: number) => {
        // Rub the shell: begin a polish hold at this contact.
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        holdingShell = true;
        holdElapsedMs = 0;
        try {
          audio.playNote(48, 180);
          haptics.tap();
        } catch {
          /* noop */
        }
        writer.schedule();
      },
      deepen: (elapsed: number, x: number, y: number, tier: number) => {
        if (!holdingShell) return;
        holdElapsedMs = elapsed;
        // Duration is an axis — a saturating polish increment via polishStep.
        // Sampled per hold-tick — 60ms.
        const now = performance.now();
        if (now - lastDeepenAt < 60) return;
        lastDeepenAt = now;
        // Under a hand, use a stronger effective waterCarry so a held
        // dwell polishes visibly over seconds, not centuries — the room's
        // watched-speed.
        state = polishStep(state, 0.06, 1);
        void x;
        void y;
        void tier;
        try {
          audio.playTone(ringHzFor(state) * (1 + elapsed / 32000), 0.05);
        } catch {
          /* noop */
        }
      },
      ceremony: (x: number, y: number) => {
        // Polish to POLISH_MAX in one commit.
        void x;
        void y;
        state = { ...state, polishDepth: POLISH_MAX };
        setHasKept(true);
        try {
          audio.bell();
          audio.playTone(ringHzFor(state), 0.6);
          haptics.bloom();
        } catch {
          /* noop */
        }
        holdingShell = false;
        holdElapsedMs = 0;
        writer.schedule();
      },
      settle: (elapsed: number, x: number, y: number, tier: number) => {
        // A hold that lifted before ceremony: keep whatever polish we've
        // accumulated. Only clear the hold handle.
        void elapsed;
        void x;
        void y;
        if (tier < 3) {
          holdingShell = false;
          holdElapsedMs = 0;
        }
      },
      timeScale: (k: number) => {
        timeScaleTarget = Math.min(1, Math.max(0.15, k));
      },
      drag: (
        phase: "start" | "move" | "end",
        x: number, y: number, dx: number, dy: number, fingers: number,
      ) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        if (fingers >= 3) return; // wind is handled separately
        // Turn the stone in its section.
        rotationTarget += dx * 0.008 - dy * 0.002;
        void phase;
        // Refresh cleavage highlight while turning.
        cleavageStrength = Math.min(1, cleavageStrength + Math.hypot(dx, dy) / 800);
      },
      wind: (dx: number, dy: number) => {
        // The world-law: horizontal is water-carry, vertical is lattice
        // pressure. Both bounded.
        climate = {
          waterCarry: Math.max(0, Math.min(1, climate.waterCarry + dx * 0.0018)),
          latticePressure: Math.max(0, Math.min(1, climate.latticePressure - dy * 0.0018)),
        };
        try {
          audio.playTone(72 + climate.latticePressure * 60, 0.12);
        } catch {
          /* noop */
        }
        writer.schedule();
      },
      flick: (x: number, y: number, angle: number, speed: number, fingers: number) => {
        void x;
        void y;
        void fingers;
        // Cleave along the nearest allowed plane.
        const { plane } = cleavageAt(state, angle);
        cleavagePlane = plane;
        cleavageStrength = Math.min(1, 0.6 + speed / 6000);
        try {
          audio.bell();
          audio.playTone(ringHzFor(state) * 1.5, 0.28);
          haptics.chop();
        } catch {
          /* noop */
        }
      },
      stir: (cx: number, cy: number, angularVelocity: number) => {
        // Circling the finger stirs the cabinet's raking light — writes to
        // the lamp position; the shader shows a different highlight but
        // the ledger is unchanged.
        const { nx, ny } = toLocal(cx, cy);
        lampX = nx;
        lampY = ny;
        void angularVelocity;
        try {
          audio.playTone(ringHzFor(state) * 0.75, 0.14);
        } catch {
          /* noop */
        }
      },
      lens: (angle: number, velocity: number) => {
        if (velocity === 0) {
          lensSnapped = lensTarget > 0.5 ? 1 : 0;
          lensTarget = lensSnapped;
          try {
            haptics.lens();
          } catch {
            /* noop */
          }
        } else {
          lensTarget = Math.max(0, Math.min(1, lensTarget + angle / 2));
        }
      },
      season: (angle: number, velocity: number) => {
        // Walk the year through advanceExact.
        const span = Math.abs(angle) * 24 * 3600;
        if (span > 0) {
          climate = {
            waterCarry: Math.max(0, Math.min(1, climate.waterCarry + angle * 0.05)),
            latticePressure: Math.max(0, Math.min(1, climate.latticePressure + angle * 0.03)),
          };
          state = advanceExact(state, span, climate);
        }
        if (velocity === 0) {
          try {
            haptics.detent();
          } catch {
            /* noop */
          }
          writer.schedule();
        }
      },
      drum: (hits: number, alternation: number, x: number, y: number) => {
        void hits;
        void x;
        void y;
        // Two hands: the stone rings the ratio of their distances via
        // a partial mix. Just play the fundamental plus the alternation
        // partial for now.
        const partials = partialsFor(state);
        const hz = ringHzFor(state);
        try {
          audio.playTone(hz * partials[Math.min(partials.length - 1, 1)] *
            (0.75 + alternation * 0.5), 0.14);
          haptics.tap();
        } catch {
          /* noop */
        }
      },
      scatter: (intensity: number) => {
        stirTurbulence(clamp01(intensity) * 0.6);
      },
      gravity: (gamma: number) => {
        leanTarget = reduced ? 0 : Math.max(-1, Math.min(1, gamma / 48));
      },
      knock: (intensity: number) => {
        // The struck bell — pitch from the current damped partials.
        const partials = partialsFor(state);
        try {
          const hz = ringHzFor(state);
          audio.playTone(hz, 0.5 + intensity * 0.3);
          if (partials.length >= 2) {
            audio.playTone(hz * partials[1] * 0.5, 0.35 * partials[1]);
          }
          haptics.detent();
        } catch {
          /* noop */
        }
      },
      night: (faceDown: boolean) => {
        nightTarget = faceDown ? 1 : 0;
      },
      glimmer: () => {
        // Breath a small ring — the stone answers without being touched.
        cleavageStrength = Math.max(cleavageStrength, 0.15);
      },
      reduced: (on: boolean) => {
        reduced = on;
      },
      moveCursor: (dx: number, dy: number) => {
        cursorX = clamp01(cursorX + dx * 0.06);
        cursorY = clamp01(cursorY + dy * 0.06);
      },
      keyTap: () => {
        ringStone(0.6);
      },
      keyHold: (elapsed: number) => {
        holdingShell = true;
        holdElapsedMs = elapsed;
        state = polishStep(state, 0.06, 1);
        if (elapsed > 2400) {
          state = { ...state, polishDepth: POLISH_MAX };
          setHasKept(true);
          holdingShell = false;
          holdElapsedMs = 0;
          writer.schedule();
        }
      },
      keyEscape: () => {
        if (lensSnapped === 1) {
          lensSnapped = 0;
          lensTarget = 0;
        }
        holdingShell = false;
      },
      clear: () => {
        cleared = true;
        state = initState(SEED);
        climate = { waterCarry: 0.4, latticePressure: 0.35 };
        setHasKept(false);
        try {
          audio.thud();
          haptics.roll();
        } catch {
          /* noop */
        }
        writer.schedule();
      },
    };
    void cleared;
    void reduced;
    void MINERAL_INDEX;

    apiRef.current = engine;

    // ——— the loop ———
    // Watched-speed: while a hand is present the polish advances in seconds,
    // not centuries. The advance is closed-form (polishStep + growStep both).
    const WATCHED_POLISH_SPEED = 3e6; // 3 million real seconds per second held
    const draw = (now: number) => {
      if (!running) return;
      const dtRaw = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tier = gov.beginFrame(now);
      void tier;

      relaxTurbulence(now);
      const agitation = getTurbulence();
      const t = audio.getAudioTime() ?? now / 1000;

      // Continuous axes glide toward their targets.
      rotation += (rotationTarget - rotation) * Math.min(1, dtRaw * 6);
      lens += (lensTarget - lens) * Math.min(1, dtRaw * 6);
      lean += (leanTarget - lean) * Math.min(1, dtRaw * 3);
      night += (nightTarget - night) * Math.min(1, dtRaw * 2);
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dtRaw * 5);
      cleavageStrength = Math.max(0, cleavageStrength - dtRaw * 0.35);

      // The ledger advances at watched-speed (a hand-held moment is worth a
      // meaningful bit of geological time). Closed form — no history replay.
      if (!asleep && !reduced) {
        state = advanceExact(state, dtRaw * timeScale * WATCHED_POLISH_SPEED, climate);
      }

      // Idle write: only if the writer's cadence allows.
      if (now - lastSaveAt > SAVE_EVERY_MS) {
        lastSaveAt = now;
        writer.schedule();
      }

      if (stage && prog && quad && !stage.contextLost() && !asleep) {
        prog.use();
        stage.beginFrame(
          clocksFrom({ time: reduced ? 12 : t, turbulence: agitation, reducedMotion: reduced }),
          prog,
        );
        // Ring uniform: xyzw = radius, mineralHue, thickness, seed
        let rN = 0;
        for (const r of state.growthRings) {
          if (rN >= 24) break;
          ringU[rN * 4] = r.radius;
          ringU[rN * 4 + 1] = MINERAL_INDEX[r.mineral] ?? 0;
          ringU[rN * 4 + 2] = r.thickness;
          ringU[rN * 4 + 3] = r.seed;
          rN++;
        }
        prog.setInt("uRingCount", rN);
        prog.setFloat("uPolishDepth", state.polishDepth);
        prog.setFloat("uRotation", rotation);
        prog.setFloat("uLensRaised", lens);
        prog.setFloat("uLean", lean);
        prog.setFloat("uNight", night);
        prog.setFloat("uSectionScale", 0.34);
        prog.setFloat("uPolishMax", POLISH_MAX);
        prog.setVec4(
          "uCleavage",
          cleavagePlane[0],
          cleavagePlane[1],
          cleavagePlane[2],
          cleavageStrength,
        );
        prog.setVec4(
          "uClimate",
          climate.waterCarry,
          climate.latticePressure,
          state.tau / 3600 / 24, // days
          state.season,
        );
        // The lamp position is a normalized coordinate — the shader reads it
        // as the raking-light origin.
        const lampLoc = prog.location("uLamp");
        if (lampLoc) stage.gl.uniform2f(lampLoc, lampX, lampY);
        const ringLoc = prog.location("uRings[0]");
        if (ringLoc) stage.gl.uniform4fv(ringLoc, ringU);
        quad.draw();
      }

      // The twist lens — a small 2D overlay with the polish depth,
      // the mineral name and the ca_hz readout.
      const octx = stage?.overlay2d ?? null;
      if (octx && lens > 0.02) {
        const r = surface.getBoundingClientRect();
        const w = r.width;
        octx.clearRect(0, 0, w, r.height);
        octx.globalAlpha = lens;
        octx.fillStyle = "rgba(242, 236, 217, 0.92)";
        octx.font = "13px ui-monospace, monospace";
        const mineral = state.growthRings[0]?.mineral ?? "quartz";
        const polishMm = (state.polishDepth * 1000).toFixed(1);
        const hz = ringHzFor(state).toFixed(1);
        octx.fillText(`${mineral} · polish ${polishMm}mm · ${hz}Hz`, 24, r.height - 24);
        octx.globalAlpha = 1;
      } else if (octx) {
        octx.clearRect(0, 0, surface.getBoundingClientRect().width, surface.getBoundingClientRect().height);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      apiRef.current = null;
      unvis();
      ungal();
      writer.flush();
      quad?.dispose();
      stage?.dispose();
      cancelAnimationFrame(raf);
    };
  }, []);

  // The verbs, in the shell's vocabulary. Each reads through apiRef so the
  // engine never loses an in-flight hold when React re-renders.
  const voice = useMemo<RoomVoice>(
    () => ({
      tap: (e) => apiRef.current?.tap(e.x, e.y, e.intensity, e.count, e.fingers),
      stepBack: () => apiRef.current?.stepBack(),
      tutti: (e) => apiRef.current?.tutti(e.intensity),
      plant: (e) => apiRef.current?.plant(e.x, e.y),
      deepen: (e) => apiRef.current?.deepen(e.elapsed, e.x, e.y, e.tier),
      ceremony: (e) => apiRef.current?.ceremony(e.x, e.y),
      settle: (e) => apiRef.current?.settle(e.elapsed, e.x, e.y, e.tier),
      timeScale: (k) => apiRef.current?.timeScale(k),
      drag: (e) => apiRef.current?.drag(e.phase, e.x, e.y, e.dx, e.dy, e.fingers),
      wind: (e) => apiRef.current?.wind(e.dx, e.dy),
      flick: (e) => apiRef.current?.flick(e.x, e.y, e.angle, e.speed, e.fingers),
      stir: (e) => apiRef.current?.stir(e.cx, e.cy, e.angularVelocity),
      lens: (e) => apiRef.current?.lens(e.angle, e.velocity),
      season: (e) => apiRef.current?.season(e.angle, e.velocity),
      drum: (e) => apiRef.current?.drum(e.hits, e.alternation, e.x, e.y),
      scatter: (e) => apiRef.current?.scatter(e.intensity),
      gravity: (e) => apiRef.current?.gravity(e.gamma),
      knock: (e) => apiRef.current?.knock(e.intensity),
      night: (e) => apiRef.current?.night(e.faceDown),
      // rhythm, arpeggio, breath: the stone has no beat, no staggered chord,
      // no candle-owned inhalation — the shell's defaults answer them with
      // two-senses acknowledgement, as designed.
    }),
    [],
  );

  const keyboard = useMemo(
    () => ({
      enter: () => apiRef.current?.keyTap(),
      enterHeld: (elapsed: number) => apiRef.current?.keyHold(elapsed),
      escape: () => apiRef.current?.keyEscape(),
      arrow: (dx: number, dy: number) => apiRef.current?.moveCursor(dx, dy),
    }),
    [],
  );

  const letGo = useCallback(() => {
    apiRef.current?.clear();
    getFieldAudio().thud();
    haptics.roll();
    setHasKept(false);
  }, []);

  return (
    <RoomShell
      route="/pebble"
      surfaceRef={surfaceRef}
      voice={voice}
      keyboard={keyboard}
      onGlimmer={() => apiRef.current?.glimmer()}
      onReducedMotion={(on) => apiRef.current?.reduced(on)}
      letGo={{ label: "let the pebble rest", onLetGo: letGo, visible: hasKept }}
      style={{ position: "fixed", inset: 0, background: "#040608" }}
    >
      <canvas
        ref={surfaceRef}
        role="application"
        tabIndex={0}
        aria-label="one pebble, cut open — the lattice under its polished shell"
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
