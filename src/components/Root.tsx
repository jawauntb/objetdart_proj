// object-compiler template — docs/plans/object-compiler.md M3.
// Filled by phase-6 track A (see data/object-compiler/audits/phase-6-root.md
// for the audit) — shader, domain imports, population layer, verbs, pins.
"use client";

/**
 * /root — the root — plant, node, edge. See docs/plans/object-compiler.md
 * §"Three creative slots" for what belongs in each slot.
 *
 * The invariant is a rooted directed tree of nodes anchored under a plant
 * crown (src/lib/rootnet.ts). The shader paints one hand-width of soil in
 * section: the plant crown as a warm gold-lit band above the surface, the
 * surface line, a soil column with real top-to-bottom depth contrast (humus
 * brown at the surface deepening to near-black at the bedrock), multi-scale
 * grain and moisture-band FBM texture, and a mycorrhizal glow that
 * concentrates wherever the root density is actually high (not painted-on —
 * read off the same uNodes/uNodesB positions the edges use). The population
 * layer (`createPopulationLayer`, custom frag below `POPULATION_FRAG`) draws
 * two instances per tip in one instanced pass: a warm capsule edge from
 * parent to child, and a bright glow terminus at the tip — the load-bearing
 * invariant map is still WATER×SUGAR → BRIGHTNESS, now painted on both the
 * edges (flow) and the termini (corona) instead of only the termini.
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
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
import {
  createPopulation,
  mulberry32 as sceneMulberry32,
  type SceneObjectSpec,
  type SceneObjectState,
} from "@/lib/scene/object";
import {
  MAX_NODES,
  MAX_GROWTH,
  MAX_GENERATION,
  CROWN_Y,
  POOL_X_MAX,
  POOL_X_MIN,
  POOL_Y_MAX,
  POOL_Y_MIN,
  advanceExact,
  deepenTip,
  hashSeed,
  inSectionBounds,
  initState,
  knockSweep,
  meanSugar,
  meanWater,
  nearestNode,
  ringHzFor,
  sealTip,
  sealedCount,
  spawnTip,
  treeDepth,
  totalRootLength,
  depthForRingHz,
  type Climate,
  type RootNode,
  type RootState,
} from "@/lib/rootnet";

/** Persistence key — versioned; a schema change bumps the suffix. */
const STORE_KEY = "objetdart:root:v1";
/** How often the idle writer flushes to storage while a hand is present. */
const SAVE_EVERY_MS = 4000;
/** How wide the shader's ripple wavefront pool is. */
const MAX_RIPPLES = 24;
/** How much a full-tier dwell adds to a tip's growth on a saturating curve. */
const GROWTH_STEP_MAX = 0.55;
/**
 * Time-constant of the tip's growth under a sustained press:
 * `g(t) = GROWTH_STEP_MAX · (1 − e^{-t/τ})`. A MATERIAL time-constant — how
 * fast a hand recruits a tip toward saturation under sunlight and water —
 * not a gesture tier; the tiers themselves live in `gesture/core.ts` alone
 * and are read from the `deepen` event's own `elapsed` and `tier`.
 */
const ROOT_GROW_TAU_MS = 900;
/** Simulation speed while a hand is present, in ledger seconds per real second. */
const WATCHED_SPEED = 60;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * The root tip, in the shared scene model's vocabulary. The physics ledger
 * is authoritative; this view is the render half, synced from the ledger
 * each frame so the shared `createPopulation` + `createPopulationLayer` can
 * draw every node in one instanced pass.
 */
type TipView = SceneObjectState & {
  waterVal: number;
  sugarVal: number;
  growthVal: number;
  sealed: boolean;
  phase: number;
  /** which branching level this tip sits at — 1 is straight off the crown. */
  generation: number;
  /** the parent node's own position, so emit() can draw the connecting edge
   *  without a second lookup pass — the population's own instance data. */
  parentNx: number;
  parentNy: number;
};

type StoredRoot = {
  v: 1;
  nodes: RootState["nodes"];
  soilWater: number;
  sunlight: number;
  tau: number;
  climate: Climate;
  lastSeen: number;
  cleared?: boolean;
};

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

// __SLOT_SHADER_BODY__
uniform vec4  uNodes[${MAX_NODES}];    // xy pos, z growth (0..1), w water*sugar
uniform vec4  uNodesB[${MAX_NODES}];   // parentX, parentY, sealed(0/1), phase
uniform vec4  uRipples[${MAX_RIPPLES}]; // xy pos, z age (s), w intensity (0..1)
uniform int   uNodeCount;
uniform int   uRippleCount;
uniform vec4  uClimate;   // warmth, wet, soilWater, sunlight
uniform float uLean;
uniform float uNight;
uniform float uStir;
uniform float uLens;

const vec3 BG      = vec3(0.026, 0.020, 0.015); // deep subsoil dark
const vec3 BG2     = vec3(0.227, 0.165, 0.102); // warm humus brown — distinct from BG
const vec3 GLOW    = vec3(0.859, 0.788, 0.541); // plant crown / root-tip light, warm gold
const vec3 ACCENT  = vec3(0.353, 0.545, 0.545); // cool moisture register
const vec3 ACCENT2 = vec3(0.784, 0.580, 0.353); // warm root / mycorrhizal register
const vec3 INK     = vec3(0.937, 0.910, 0.863);

const float CROWN_LINE   = ${CROWN_Y.toFixed(3)};
const float BEDROCK_LINE = ${POOL_Y_MAX.toFixed(3)};
const float POOL_XMIN    = ${POOL_X_MIN.toFixed(3)};
const float POOL_XMAX    = ${POOL_X_MAX.toFixed(3)};

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
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.11; a *= 0.53; }
  return v;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(1e-6, dot(ba, ba)), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);
  float night = uNight;
  vec3 col;

  if (uv.y < CROWN_LINE - 0.005) {
    // Above-ground register: a warm glow-lit horizon rising into a cool
    // moisture-tinted sky — both named registers, no third unlisted hue.
    float sky = clamp((CROWN_LINE - uv.y) / CROWN_LINE, 0.0, 1.0);
    vec3 airCol = mix(GLOW * 0.55, ACCENT * 0.30, sky * sky);
    airCol *= 0.86 + 0.14 * uBreath;
    airCol += GLOW * 0.26 * (1.0 - sky) * (0.85 + 0.15 * uBreath) * (1.0 - night * 0.7);
    col = airCol * (1.0 - night * 0.72);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  if (uv.y < CROWN_LINE + 0.02) {
    // Plant crown — an olive-gold band mixed from the two named registers
    // (GLOW warm, ACCENT cool) rather than a separate green constant, so
    // the crown still reads as living growth without a sixth hue.
    float band = smoothstep(CROWN_LINE - 0.06, CROWN_LINE, uv.y)
                * (1.0 - smoothstep(CROWN_LINE, CROWN_LINE + 0.02, uv.y));
    float leaf = fbm(vec2(uv.x * 12.0, uv.y * 30.0 + uTime * 0.05));
    float leafFine = fbm(vec2(uv.x * 34.0 + 5.0, uv.y * 60.0 - uTime * 0.03));
    vec3 crownBase = mix(ACCENT, GLOW, 0.72);
    vec3 crown = mix(crownBase * 0.62, crownBase * 1.08, leaf);
    crown += GLOW * leafFine * 0.10;
    crown *= 0.85 + 0.15 * uBreath;
    col = mix(BG2, crown, band);
    col *= 1.0 - night * 0.55;
    for (int i = 0; i < ${MAX_NODES}; i++) {
      if (i >= uNodeCount) break;
      vec4 a = uNodesB[i];
      vec4 b = uNodes[i];
      if (a.x < 0.0) continue;
      vec2 pa = vec2(a.x, a.y) * vec2(aspect, 1.0);
      vec2 pb = vec2(b.x, b.y) * vec2(aspect, 1.0);
      vec2 pp = uv * vec2(aspect, 1.0);
      float d = sdSegment(pp, pa, pb);
      float lineW = 0.0022 + 0.0026 * b.z;
      float ink = 1.0 - smoothstep(lineW, lineW * 1.5, d);
      col = mix(col, ACCENT2 * 0.4, ink * (0.35 + 0.15 * uBreath));
    }
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  if (uv.y < BEDROCK_LINE) {
    float dGrad = clamp((uv.y - CROWN_LINE) / max(0.02, BEDROCK_LINE - CROWN_LINE), 0.0, 1.0);
    vec3 soil = mix(BG2, BG, dGrad * dGrad);
    soil *= 0.86 + 0.14 * uBreath;
    col = soil;

    // Soil texture — three grain scales, so the column reads as ground and
    // not a flat gradient: coarse clods, fine mineral speckle, a scatter of
    // hard-edged mineral flecks (a real Sobel boundary, not a soft blend),
    // and a directional moisture-band FBM tinted with the cool ACCENT
    // register (rides uClimate.z = soilWater — wetter ground bands more
    // visibly).
    float grainCoarse = fbm(uv * vec2(15.0 * aspect, 15.0) + vec2(2.3, 7.1));
    float grainFine = fbm(uv * vec2(68.0 * aspect, 68.0) + vec2(9.4, 1.6));
    col *= 0.62 + 0.56 * grainCoarse;
    col *= 0.86 + 0.20 * grainFine;

    vec2 fleckUv = uv * vec2(150.0 * aspect, 150.0);
    vec2 fleckCell = floor(fleckUv);
    vec2 fleckLocal = fract(fleckUv) - 0.5;
    vec2 fleckJitter = vec2(hash21(fleckCell + 1.3), hash21(fleckCell + 5.9)) - 0.5;
    float fleckDist = length(fleckLocal - fleckJitter * 0.6);
    float fleckPick = step(0.91, hash21(fleckCell + 3.7));
    float fleckMask = fleckPick * (1.0 - smoothstep(0.09, 0.20, fleckDist));
    float fleckShade = hash21(fleckCell + 9.2);
    col = mix(col, mix(BG * 0.3, GLOW * 0.8, fleckShade), fleckMask * 0.78);

    float moistureNoise = fbm(vec2(uv.x * 3.2, uv.y * 11.0 + uTime * 0.015));
    float moistureBand = smoothstep(0.38, 0.62, moistureNoise);
    col = mix(col, col + ACCENT * 0.4, moistureBand * clamp(uClimate.z, 0.0, 1.0) * (0.5 + 0.5 * uBreath));

    float wave = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      if (i >= uRippleCount) break;
      vec4 r = uRipples[i];
      float age = r.z;
      float rad = age * 0.28;
      vec2 dp = (uv - r.xy) * vec2(aspect, 1.0);
      float dist = length(dp);
      float ring = exp(-pow((dist - rad) * 24.0, 2.0));
      wave += ring * r.w * exp(-age * 1.4);
    }
    col += ACCENT * wave * 0.6;

    // Root channel — a dark groove where the field itself parts around each
    // edge, sharp enough to read on a Sobel pass, but deliberately faint:
    // the population layer (below, POPULATION_FRAG) draws the actual bright
    // capsule-and-terminus edges in its own instanced pass, so this loop's
    // real payload is density — a gaussian sum of distance-to-every-edge
    // — which drives the mycorrhizal patches: the glow concentrates exactly
    // where the tree the visitor grew is thick, never painted independent
    // of the physics.
    float grooveAlpha = 0.36 + 0.08 * uBreath;
    float density = 0.0;
    for (int i = 0; i < ${MAX_NODES}; i++) {
      if (i >= uNodeCount) break;
      vec4 a = uNodesB[i];
      vec4 b = uNodes[i];
      if (a.x < 0.0) continue;
      vec2 pa = vec2(a.x, a.y) * vec2(aspect, 1.0);
      vec2 pb = vec2(b.x, b.y) * vec2(aspect, 1.0);
      vec2 pp = uv * vec2(aspect, 1.0);
      float dSeg = sdSegment(pp, pa, pb);
      density += exp(-dSeg * dSeg * 34.0) * (0.45 + 0.55 * b.z);
      float lineW = 0.0026 + 0.0034 * b.z;
      float groove = 1.0 - smoothstep(lineW, lineW * 1.35, dSeg);
      vec3 grooveColor = mix(BG * 0.6, ACCENT2 * 0.4, a.z);
      col = mix(col, grooveColor, groove * grooveAlpha);
    }

    // Mycorrhizal hint — a faint fbm patch masked by root density, tinted
    // ACCENT2. Where the network is dense the ground itself glows faintly
    // warm; where it is sparse the ground stays plain soil.
    density = clamp(density, 0.0, 1.0);
    float mycoNoise = fbm(uv * vec2(22.0 * aspect, 22.0) + vec2(11.3, 4.8));
    col += ACCENT2 * mycoNoise * density * 0.4 * (0.65 + 0.35 * uBreath);

    if (uStir > 0.02) {
      vec2 sp = (uv - vec2(0.5, CROWN_LINE + 0.35)) * vec2(aspect, 1.0);
      float ang = atan(sp.y, sp.x);
      float rr = length(sp);
      col += ACCENT2 * uStir * 0.20 * sin(ang * 4.0 + uTime * 3.0)
              * exp(-rr * rr * 8.0);
    }

    // Vignette — the section reads as a lit column, not a flat poster: real
    // depth-of-field darkening toward the corners widens the frame's actual
    // light-to-dark spread the way /tidepool and /reef's does.
    vec2 vd = (uv - vec2(0.5, CROWN_LINE + 0.30)) * vec2(aspect, 1.0);
    col *= 1.0 - 0.60 * smoothstep(0.10, 1.0, dot(vd, vd));

    col *= 1.0 - night * 0.55;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  vec3 rock = vec3(0.028, 0.023, 0.020);
  vec3 dryRock = vec3(0.055, 0.043, 0.033);
  float dRock = clamp((uv.y - BEDROCK_LINE) / max(0.02, 1.0 - BEDROCK_LINE), 0.0, 1.0);
  col = mix(dryRock, rock, dRock * dRock);
  vec2 gp = floor(uv * uRes * 0.45);
  col *= 0.86 + 0.24 * hash21(gp);
  col *= 1.0 - 0.52 * smoothstep(0.18, 0.94,
    dot((uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0), (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0)));
  col *= 1.0 - night * 0.68;
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * The population's own material — /tidepool and /reef's pattern: a
 * shape-select packed into the low bits of vPhase (`shapeSlot`), two SDFs,
 * and a two-stop palette instead of the default sprite's disc-plus-corona.
 *
 * Two shapes share the pass:
 *  - SHAPE_EDGE (0): a capsule from a tip's parent to the tip itself,
 *    oriented by `a_rot` — the vertex stage rotates the *position* into
 *    place but leaves `vLocal` in the pre-rotation frame, so an SDF that is
 *    asymmetric along local x reads as a segment aligned with the edge on
 *    screen. `vGlow` carries the edge's half-width, already normalized by
 *    its own half-length (so a short edge and a long edge both read as the
 *    same felt thickness); `vHue` carries the local water×sugar flow,
 *    warming the capsule from ACCENT2 (root brown) toward GLOW (gold) the
 *    same way the field shader's edges do.
 *  - SHAPE_NODE (1): the tip terminus — a bright glow core, an ACCENT2
 *    body ring, and a faint ACCENT (cool, water) halo at the rim. `vGlow`
 *    is water×sugar; brightness still inverts to the tip's live state.
 */
const POPULATION_FRAG = `precision mediump float;
varying vec2 vLocal;
varying float vHue;
varying float vGlow;
varying float vPhase;
varying float vAlpha;
uniform vec3 u_palA; // ACCENT2 — warm root / mycorrhizal register
uniform vec3 u_palB; // GLOW    — plant crown / root-tip light
uniform vec3 u_palC; // ACCENT  — cool moisture register

// Capsule from -1.0..1.0 along local x, width set by halfWidth (already
// normalized against the instance's own half-length). Feathers past the
// ends so neighbouring edges never show a hard seam at a shared node.
float sdfEdgeCapsule(vec2 p, float halfWidth) {
  float alongFeather = 1.0 - smoothstep(0.90, 1.06, abs(p.x));
  // A steep core transition plus a thin dark ring just outside it — the
  // ring is what a Sobel pass actually locks onto; a soft corona alone is
  // too gentle a gradient to read as a real boundary.
  float core = 1.0 - smoothstep(halfWidth * 0.65, halfWidth * 0.92, abs(p.y));
  float darkRing = exp(-pow((abs(p.y) - halfWidth * 1.15) * (3.2 / max(0.02, halfWidth)), 2.0)) * 0.45;
  float corona = exp(-(p.y * p.y) / max(1e-4, halfWidth * halfWidth * 2.2)) * 0.18;
  return clamp((core + corona - darkRing) * alongFeather, 0.0, 1.0);
}

// Tip terminus — bright core, ACCENT2 body ring, faint outer halo, a crisp
// rim right at the body's edge so the terminus reads as a real silhouette
// (a Sobel-visible boundary) rather than only a soft glow blob.
float sdfRootTerminus(vec2 p, float breathPulse) {
  float r = length(p);
  if (r > 1.4) return 0.0;
  float coreR = 0.34 + breathPulse * 0.05;
  float core = smoothstep(coreR, coreR * 0.5, r);
  float bodyR = coreR * 1.9;
  float body = smoothstep(bodyR, bodyR * 0.55, r);
  float rim = exp(-pow((r - bodyR * 0.92) * 16.0, 2.0)) * 0.6;
  float corona = exp(-r * r * 1.4) * 0.32;
  return clamp(core + body * 0.4 + rim + corona, 0.0, 1.0);
}

void main() {
  float shapeF = floor(vPhase + 0.001);
  float breathPulse = 0.5 + 0.5 * sin(fract(vPhase) * 6.2832);
  vec3 c;
  float a;
  if (shapeF < 0.5) {
    // edge — capsule from parent to child, flow-warmed toward GLOW.
    float halfWidth = clamp(vGlow, 0.02, 0.9);
    float flow = clamp(vHue, 0.0, 1.0);
    a = sdfEdgeCapsule(vLocal, halfWidth);
    c = mix(u_palA, u_palB, flow * 0.65);
  } else {
    // node terminus — bright glow-gold core, ACCENT2 body, ACCENT halo.
    float wSugar = clamp(vGlow, 0.0, 1.0);
    float r = length(vLocal);
    a = sdfRootTerminus(vLocal, breathPulse);
    float coreMix = smoothstep(0.55, 0.0, r);
    vec3 c0 = mix(u_palA, u_palB, coreMix * (0.5 + 0.5 * wSugar));
    c0 = mix(c0, u_palC, smoothstep(0.85, 1.4, r) * 0.35);
    a *= 0.55 + 0.45 * wSugar;
    c = c0 * (0.8 + 0.5 * wSugar);
  }
  a *= vAlpha;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(c * a, a);
}
`;

// The imperative surface the room's voice speaks to.
type RootApi = {
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

export default function Root() {
  const surfaceRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<RootApi | null>(null);
  const [hasKept, setHasKept] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    const overlay = overlayRef.current;
    if (!surface || !overlay) return;

    const audio = getFieldAudio();
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");

    // ——— the small state vector — read from storage or freshly initialised ———
    const SEED = 0x67e0;
    let state: RootState = initState(SEED);
    let climate: Climate = { warmth: 0.6, wet: 0.5 };
    let cleared = false;
    let lastSeen = performance.now();
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredRoot>;
        cleared = parsed.cleared === true;
        if (
          Array.isArray(parsed.nodes) &&
          typeof parsed.soilWater === "number" &&
          typeof parsed.sunlight === "number" &&
          typeof parsed.tau === "number"
        ) {
          state = {
            nodes: parsed.nodes
              .filter(
                (n) =>
                  n &&
                  Number.isFinite(n.x) &&
                  Number.isFinite(n.y) &&
                  Number.isFinite(n.water) &&
                  Number.isFinite(n.sugar),
              )
              .slice(0, MAX_NODES),
            soilWater: clamp01(parsed.soilWater),
            sunlight: clamp01(parsed.sunlight),
            tau: parsed.tau,
            seedKey: SEED,
          };
          if (!state.nodes.some((n) => n.parentId === null)) {
            state = initState(SEED);
          }
        }
        if (parsed.climate) {
          climate = {
            warmth: clamp01(parsed.climate.warmth),
            wet: clamp01(parsed.climate.wet),
          };
        }
        if (typeof parsed.lastSeen === "number" && Number.isFinite(parsed.lastSeen)) {
          const awaySec = Math.max(0, (Date.now() - parsed.lastSeen) / 1000);
          if (awaySec > 0) state = advanceExact(state, awaySec, climate);
        }
      }
    } catch {
      /* fresh network */
    }
    setHasKept(state.nodes.some((n) => n.sealed && n.parentId !== null));
    lastSeen = performance.now();

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
        const payload: StoredRoot = {
          v: 1,
          nodes: state.nodes,
          soilWater: state.soilWater,
          sunlight: state.sunlight,
          tau: state.tau,
          climate,
          lastSeen: Date.now(),
          cleared,
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* storage full or unavailable */
      }
    });
    writer.schedule();

    // ——— the shared GL harness ———
    const stage = createGLStage(surface, {
      label: "root",
      wrap: surface.parentElement,
      overlay,
      renderScale: embedded ? 0.42 : 0.6,
      quality: embedded ? "medium" : "high",
      reducedMotion: reduced,
      embedded,
    });
    const prog = stage?.program(FULLSCREEN_VERT_UNIT, FRAG) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog, "unit") : null;

    // ——— the tip, as the shared scene model reads it ———
    const tipSpec: SceneObjectSpec<TipView> = {
      kind: "tip",
      cap: MAX_NODES,
      born(seed, nx, ny, tMs) {
        const rng = sceneMulberry32(seed);
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 0.05,
          sealedMs: null,
          presence: 1,
          waterVal: 0,
          sugarVal: 0,
          growthVal: 0,
          sealed: false,
          phase: rng(),
          generation: 1,
          parentNx: nx,
          parentNy: CROWN_Y,
        };
      },
      step(s, ctx) {
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 0.9);
      },
      // Two instances per tip: the connecting edge (parent → this tip, a
      // capsule oriented by the segment's own angle) and the bright glow
      // terminus at the tip itself. `SHAPE_EDGE = 0`, `SHAPE_NODE = 1`,
      // packed into vPhase's integer part the way /reef packs its shapes —
      // POPULATION_FRAG above reads it back with `floor(vPhase)`.
      emit(s, ctx, out) {
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        const baseR = Math.max(3, ctx.width * 0.011);
        const wSugar = clamp01(s.waterVal * s.sugarVal * 1.6);
        const presenceAlpha = s.presence * (0.5 + s.growth * 0.5);

        const ppx = s.parentNx * ctx.width;
        const ppy = s.parentNy * ctx.height;
        const dx = px - ppx;
        const dy = py - ppy;
        const segLen = Math.hypot(dx, dy);
        if (segLen > 1) {
          const midx = (px + ppx) / 2;
          const midy = (py + ppy) / 2;
          const angle = Math.atan2(dy, dx);
          const halfLen = segLen / 2;
          // Constant felt thickness regardless of length: a real half-width
          // in css px, tapered by generation (a primary root reads thicker
          // than a fine offshoot), then normalized against this instance's
          // own half-length so the capsule SDF's local-space width stays
          // correct no matter how long the edge is.
          const genFactor = 1 / (1 + s.generation * 0.22);
          const desiredHalfWidthPx = baseR * 0.34 * genFactor * (0.6 + s.growthVal * 0.4);
          // Only an UPPER clamp — a lower floor on the ratio would inflate a
          // long edge's absolute width (ratio = width / length, so a floor
          // here scales width back up with length, exactly backwards). The
          // felt thickness the visitor wants is the absolute px value; the
          // ratio is just how the capsule SDF (defined in the instance's own
          // -1..1 local space) recovers it.
          const halfWidthRatio = Math.min(0.5, desiredHalfWidthPx / Math.max(1, halfLen));
          out.push(
            midx, midy,
            halfLen,
            angle,
            wSugar, // vHue → flow warmth (root brown → gold)
            halfWidthRatio, // vGlow → normalized half-width
            0, // vPhase → SHAPE_EDGE (0) + 0 subphase
            presenceAlpha * (0.7 + 0.3 * wSugar),
          );
        }

        out.push(
          px, py,
          baseR * (0.6 + s.growthVal * 0.6) * (s.sealed ? 1.2 : 1),
          0,
          0, // vHue unused on the node shape
          wSugar, // vGlow → water×sugar brightness, still invertible
          1 + Math.min(0.999, Math.max(0, s.phase)), // vPhase → SHAPE_NODE (1) + phase
          presenceAlpha,
        );
      },
      verbs: [],
      respond: {},
    };
    const population = createPopulation(tipSpec);
    const populationLayer = stage
      ? createPopulationLayer(stage, {
          palette: ["#c8945a", "#dbc98a", "#5a8b8b"],
          frag: POPULATION_FRAG,
        })
      : null;
    const instanceBuffer = createInstanceBuffer(MAX_NODES * 2);

    // ——— what the shader reads: one Float32Array each, allocated once ———
    const nodeU = new Float32Array(MAX_NODES * 4);
    const nodeUB = new Float32Array(MAX_NODES * 4);
    const rippleU = new Float32Array(MAX_RIPPLES * 4);
    const ripples: { x: number; y: number; t0: number; intensity: number }[] = [];

    // ——— the live axes the shader lenses over, all continuous ———
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let lean = 0;
    let leanTarget = 0;
    let night = 0;
    let nightTarget = 0;
    let stir = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let cursorX = 0.5;
    let cursorY = CROWN_Y + 0.15;
    let cursorLit = 0;
    let kbCharge = 0;
    let lastSaveAt = performance.now();
    let dwellingTipId: number | null = null;
    let lastDeepenAt = 0;

    const toLocal = (px: number, py: number) => {
      const r = surface.getBoundingClientRect();
      return {
        nx: clamp01((px - r.left) / Math.max(1, r.width)),
        ny: clamp01((py - r.top) / Math.max(1, r.height)),
      };
    };

    const pushRipple = (nx: number, ny: number, intensity: number) => {
      ripples.push({ x: nx, y: ny, t0: performance.now(), intensity: clamp01(intensity) });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    };

    const meanY = () =>
      state.nodes.reduce((a, n) => a + n.y, 0) / Math.max(1, state.nodes.length);

    const ringHere = (nx: number, ny: number, weight = 1) => {
      const hz = ringHzFor(meanY());
      try {
        audio.playTone(hz, 0.12 + weight * 0.18);
        haptics.ripple(0.3 + weight * 0.35);
      } catch {
        /* the sea is not awake */
      }
      pushRipple(nx, ny, 0.5 + weight * 0.4);
    };

    const soundTip = (y: number) => {
      try {
        audio.playTone(ringHzFor(y), 0.16);
      } catch {
        /* noop */
      }
    };

    const chargeGrowthFor = (elapsedMs: number) =>
      GROWTH_STEP_MAX * (1 - Math.exp(-Math.max(0, elapsedMs) / ROOT_GROW_TAU_MS));

    const syncPopulationFromLedger = (now: number) => {
      const items = population.items;
      const ledger: RootNode[] = state.nodes;
      const byId = new Map<number, RootNode>();
      for (const n of ledger) byId.set(n.id, n);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.presence < 1) continue;
        if (!ledger.some((n) => n.id === item.id)) item.presence = 0.999;
      }
      for (const n of ledger) {
        if (n.parentId === null) continue;
        const parent = byId.get(n.parentId);
        const parentNx = parent ? parent.x : n.x;
        const parentNy = parent ? parent.y : n.y;
        let item = items.find((it) => it.id === n.id && it.presence >= 1);
        if (!item) {
          item = {
            id: n.id,
            seed: hashSeed(state.seedKey, n.id),
            nx: n.x,
            ny: n.y,
            bornMs: now,
            growth: 0.05,
            sealedMs: n.sealed ? now : null,
            presence: 1,
            waterVal: n.water,
            sugarVal: n.sugar,
            growthVal: n.growth,
            sealed: n.sealed,
            phase: n.phase,
            generation: n.generation,
            parentNx,
            parentNy,
          };
          items.push(item);
        } else {
          item.nx = n.x;
          item.ny = n.y;
          item.waterVal = n.water;
          item.sugarVal = n.sugar;
          item.growthVal = n.growth;
          item.sealed = n.sealed;
          item.phase = n.phase;
          item.generation = n.generation;
          item.parentNx = parentNx;
          item.parentNy = parentNy;
          if (n.sealed && item.sealedMs === null) item.sealedMs = now;
        }
      }
    };

    // ——— the hand's verbs, in this room's material ———
    const engine: RootApi = {
      tap: (x, y, intensity, count, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        if (fingers >= 2) return;
        const found = nearestNode(state, nx, ny, 0.08);
        if (found && found.parentId !== null) {
          soundTip(found.y);
          pushRipple(found.x, found.y, 0.7);
          haptics.tap();
          return;
        }
        ringHere(nx, ny, 0.6 + intensity * 0.4 + Math.min(0.4, (count - 1) * 0.08));
      },
      stepBack: () => {
        if (lensSnapped === 1) {
          lensSnapped = 0;
          lensTarget = 0;
          try { haptics.lens(); } catch { /* noop */ }
        }
      },
      tutti: (intensity) => {
        for (const n of state.nodes) if (n.parentId !== null) pushRipple(n.x, n.y, 0.6);
        const hz = ringHzFor(meanY());
        try {
          audio.playTone(hz, 0.24 + intensity * 0.2);
          audio.playTone(hz * 1.5, 0.18 + intensity * 0.15);
          haptics.roll();
        } catch { /* noop */ }
      },
      plant: (x, y) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        if (!inSectionBounds(nx, ny)) {
          try { audio.refuse(); } catch { /* noop */ }
          return;
        }
        const before = state.nodes.length;
        state = spawnTip(state, nx, ny, null);
        if (state.nodes.length > before) {
          const planted = state.nodes[state.nodes.length - 1];
          if (planted) dwellingTipId = planted.id;
          pushRipple(nx, ny, 0.55);
          try {
            audio.playNote(48, 220);
            haptics.tap();
          } catch { /* noop */ }
        } else {
          try { audio.refuse(); } catch { /* noop */ }
        }
        writer.schedule();
      },
      deepen: (elapsed, x, y, tier) => {
        if (dwellingTipId === null) return;
        const now = performance.now();
        if (now - lastDeepenAt < 60) return;
        lastDeepenAt = now;
        const target = chargeGrowthFor(elapsed);
        const current = state.nodes.find((n) => n.id === dwellingTipId)?.growth ?? 0;
        const dGrowth = Math.max(0, target - current);
        if (dGrowth <= 0) return;
        state = deepenTip(state, dwellingTipId, dGrowth);
        void x; void y; void tier;
        try {
          const g = state.nodes.find((n) => n.id === dwellingTipId);
          if (g) audio.playTone(ringHzFor(g.y), 0.05);
        } catch { /* noop */ }
      },
      ceremony: (x, y) => {
        if (dwellingTipId === null) {
          const { nx, ny } = toLocal(x, y);
          const found = nearestNode(state, nx, ny, 0.14);
          if (!found || found.parentId === null) {
            try { audio.refuse(); } catch { /* noop */ }
            return;
          }
          dwellingTipId = found.id;
        }
        state = sealTip(state, dwellingTipId);
        setHasKept(true);
        pushRipple(cursorX, cursorY, 1);
        try {
          audio.bell();
          const g = state.nodes.find((n) => n.id === dwellingTipId);
          if (g) audio.playTone(ringHzFor(g.y), 0.6);
          haptics.bloom();
        } catch { /* noop */ }
        dwellingTipId = null;
        writer.schedule();
      },
      settle: (elapsed, x, y, tier) => {
        void elapsed; void x; void y;
        if (tier < 3) dwellingTipId = null;
      },
      timeScale: (k) => {
        timeScaleTarget = clamp(k, 0.15, 1);
      },
      drag: (phase, x, y, dx, dy, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        if (fingers >= 3) return;
        stir = Math.min(1, stir + (Math.abs(dx) + Math.abs(dy)) / 4000);
        if (phase === "move" && Math.hypot(dx, dy) > 6) {
          pushRipple(nx, ny, 0.25);
        }
      },
      wind: (dx, dy) => {
        state = {
          ...state,
          soilWater: clamp01(state.soilWater + dy * 0.0018),
          sunlight: clamp01(state.sunlight + dx * 0.0018),
        };
        climate = {
          warmth: clamp01(climate.warmth + dx * 0.0018),
          wet: clamp01(climate.wet + dy * 0.0018),
        };
        try {
          audio.playTone(72 + state.sunlight * 60, 0.14);
        } catch { /* noop */ }
        writer.schedule();
      },
      flick: (x, y, angle, speed, fingers) => {
        const { nx, ny } = toLocal(x, y);
        pushRipple(nx, ny, Math.min(1, 0.5 + speed / 8));
        const hz = ringHzFor(meanY());
        try {
          audio.bell();
          audio.playTone(hz * (1 + Math.abs(angle) * 0.1), 0.32);
          haptics.chop();
        } catch { /* noop */ }
        stirTurbulence(0.05 + Math.min(0.2, speed / 5000));
        void fingers;
      },
      stir: (cx, cy, angularVelocity) => {
        const { nx, ny } = toLocal(cx, cy);
        stir = Math.min(1, stir + Math.min(1.2, Math.abs(angularVelocity)) * 0.18);
        pushRipple(nx, ny, 0.35);
        state = {
          ...state,
          soilWater: clamp01(state.soilWater + 0.02),
        };
        try {
          audio.playTone(ringHzFor(meanY()) * 0.75, 0.16);
          haptics.tap();
        } catch { /* noop */ }
      },
      lens: (angle, velocity) => {
        if (velocity === 0) {
          lensSnapped = lensTarget > 0.5 ? 1 : 0;
          lensTarget = lensSnapped;
          try { haptics.lens(); } catch { /* noop */ }
        } else {
          lensTarget = clamp01(lensTarget + angle / 2);
        }
      },
      season: (angle, velocity) => {
        const span = Math.abs(angle) * 24 * 3600;
        if (span > 0) {
          climate = {
            warmth: clamp01(climate.warmth + angle * 0.08),
            wet: clamp01(climate.wet - angle * 0.05),
          };
          state = advanceExact(state, span, climate);
        }
        if (velocity === 0) {
          try { haptics.detent(); } catch { /* noop */ }
          writer.schedule();
        }
      },
      drum: (hits, alternation, x, y) => {
        void hits;
        const { nx, ny } = toLocal(x, y);
        pushRipple(nx, ny, 0.4 + alternation * 0.3);
        state = {
          ...state,
          sunlight: clamp01(state.sunlight + 0.02 * alternation),
        };
        try {
          audio.playTone(ringHzFor(meanY()) * (0.75 + alternation * 0.5), 0.14);
          haptics.tap();
        } catch { /* noop */ }
      },
      scatter: (intensity) => {
        stirTurbulence(clamp01(intensity) * 0.6);
        for (const n of state.nodes) if (n.parentId !== null) pushRipple(n.x, n.y, 0.4 + intensity * 0.4);
      },
      gravity: (gamma) => {
        leanTarget = reduced ? 0 : clamp(gamma / 48, -1, 1);
      },
      knock: (intensity) => {
        const attempt = knockSweep(state, clamp01(intensity));
        state = attempt.state;
        try {
          const hz = ringHzFor(meanY());
          audio.playTone(hz, 0.5 + intensity * 0.3);
          audio.playTone(hz * 0.5, 0.35);
          haptics.detent();
        } catch { /* noop */ }
        for (const n of state.nodes) if (n.parentId !== null) pushRipple(n.x, n.y, 0.4 + intensity * 0.4);
        if (attempt.dislodged > 0) {
          try { audio.thud(); } catch { /* noop */ }
          writer.schedule();
        }
      },
      night: (faceDown) => {
        nightTarget = faceDown ? 1 : 0;
      },
      glimmer: () => {
        if (state.nodes.length > 0) {
          const idx = Math.floor(state.tau * 977) % state.nodes.length;
          const n = state.nodes[idx];
          if (n && n.parentId !== null) pushRipple(n.x, n.y, 0.35);
        }
      },
      reduced: (on) => {
        reduced = on;
      },
      moveCursor: (dx, dy) => {
        cursorX = clamp01(cursorX + dx * 0.06);
        cursorY = clamp01(cursorY + dy * 0.06);
        cursorLit = 1;
      },
      keyTap: () => {
        ringHere(cursorX, cursorY, 0.6);
      },
      keyHold: (elapsed) => {
        if (dwellingTipId === null && inSectionBounds(cursorX, cursorY)) {
          const before = state.nodes.length;
          state = spawnTip(state, cursorX, cursorY, null);
          if (state.nodes.length > before) {
            const planted = state.nodes[state.nodes.length - 1];
            if (planted) dwellingTipId = planted.id;
          }
        }
        if (dwellingTipId !== null) {
          const target = chargeGrowthFor(elapsed);
          const current = state.nodes.find((n) => n.id === dwellingTipId)?.growth ?? 0;
          if (target > current) {
            state = deepenTip(state, dwellingTipId, target - current);
          }
        }
        kbCharge = clamp01(elapsed / 2400);
        if (kbCharge >= 1 && dwellingTipId !== null) {
          state = sealTip(state, dwellingTipId);
          setHasKept(true);
          try {
            audio.bell();
            haptics.bloom();
          } catch { /* noop */ }
          dwellingTipId = null;
          kbCharge = 0;
          writer.schedule();
        }
      },
      keyEscape: () => {
        if (lensSnapped === 1) {
          lensSnapped = 0;
          lensTarget = 0;
        }
        kbCharge = 0;
        dwellingTipId = null;
      },
      clear: () => {
        cleared = true;
        state = {
          ...state,
          nodes: state.nodes.filter((n) => n.parentId === null),
        };
        setHasKept(false);
        try {
          audio.thud();
          haptics.roll();
        } catch { /* noop */ }
        writer.schedule();
      },
    };
    apiRef.current = engine;

    // ——— the loop ———
    const draw = (now: number) => {
      if (!running) return;
      const dtRaw = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tier = gov.beginFrame(now);
      void tier;

      relaxTurbulence(now);
      const agitation = getTurbulence();
      const t = audio.getAudioTime() ?? now / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dtRaw * 5);
      lens += (lensTarget - lens) * Math.min(1, dtRaw * 6);
      lean += (leanTarget - lean) * Math.min(1, dtRaw * 3);
      night += (nightTarget - night) * Math.min(1, dtRaw * 2);
      stir = Math.max(0, stir - dtRaw * 0.28);
      cursorLit = Math.max(0, cursorLit - dtRaw * 0.5);

      if (!asleep) {
        state = advanceExact(state, dtRaw * timeScale * WATCHED_SPEED, climate);
      }
      lastSeen = now;

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
        const byId = new Map<number, RootNode>();
        for (const n of state.nodes) byId.set(n.id, n);
        let nN = 0;
        for (const n of state.nodes) {
          if (nN >= MAX_NODES) break;
          nodeU[nN * 4] = n.x;
          nodeU[nN * 4 + 1] = n.y;
          nodeU[nN * 4 + 2] = clamp01(n.growth);
          nodeU[nN * 4 + 3] = clamp01(n.water * n.sugar);
          if (n.parentId !== null) {
            const p = byId.get(n.parentId);
            if (p) {
              nodeUB[nN * 4] = p.x;
              nodeUB[nN * 4 + 1] = p.y;
              nodeUB[nN * 4 + 2] = n.sealed ? 1 : 0;
              nodeUB[nN * 4 + 3] = n.phase;
            } else {
              nodeUB[nN * 4] = -1;
              nodeUB[nN * 4 + 1] = -1;
              nodeUB[nN * 4 + 2] = 0;
              nodeUB[nN * 4 + 3] = 0;
            }
          } else {
            nodeUB[nN * 4] = -1;
            nodeUB[nN * 4 + 1] = -1;
            nodeUB[nN * 4 + 2] = 1;
            nodeUB[nN * 4 + 3] = n.phase;
          }
          nN++;
        }
        for (let i = ripples.length - 1; i >= 0; i--) {
          const age = (now - ripples[i].t0) / 1000;
          if (age > 3.5) ripples.splice(i, 1);
        }
        let rN = 0;
        for (const r of ripples) {
          if (rN >= MAX_RIPPLES) break;
          rippleU[rN * 4] = r.x;
          rippleU[rN * 4 + 1] = r.y;
          rippleU[rN * 4 + 2] = (now - r.t0) / 1000;
          rippleU[rN * 4 + 3] = r.intensity;
          rN++;
        }
        prog.setInt("uNodeCount", nN);
        prog.setInt("uRippleCount", rN);
        prog.setVec4("uClimate", climate.warmth, climate.wet, state.soilWater, state.sunlight);
        prog.setFloat("uLean", lean);
        prog.setFloat("uNight", night);
        prog.setFloat("uStir", stir);
        prog.setFloat("uLens", lens);
        const nodeLoc = prog.location("uNodes[0]");
        if (nodeLoc) stage.gl.uniform4fv(nodeLoc, nodeU);
        const nodeBLoc = prog.location("uNodesB[0]");
        if (nodeBLoc) stage.gl.uniform4fv(nodeBLoc, nodeUB);
        const rippleLoc = prog.location("uRipples[0]");
        if (rippleLoc) stage.gl.uniform4fv(rippleLoc, rippleU);
        quad.draw();

        syncPopulationFromLedger(now);
        population.step({
          dt: Math.min(0.05, dtRaw),
          tMs: now,
          breath: reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 7),
          detail: 1,
          wind: 0,
          gravity: 0,
          agitation,
          season: 0,
          timeScale,
          reducedMotion: reduced,
        });
        instanceBuffer.reset();
        population.emit(
          {
            width: stage.size.width,
            height: stage.size.height,
            tMs: now,
            breath: reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 7),
            detail: 1,
            reducedMotion: reduced,
          },
          instanceBuffer,
        );
        populationLayer?.draw(instanceBuffer);
      }

      // ——— the twist lens: the network, drawn back off the soil ———
      const octx = stage?.overlay2d ?? null;
      if (octx) {
        const r = surface.getBoundingClientRect();
        const w = r.width;
        const h = r.height;
        octx.clearRect(0, 0, w, h);

        if (lens > 0.02) {
          octx.globalAlpha = lens;
          const pad = 16;
          const barY = h - 100;
          const barW = Math.min(200, w - pad * 2);
          const mw = meanWater(state);
          const ms = meanSugar(state);
          octx.fillStyle = "rgba(78, 169, 162, 0.6)";
          octx.fillRect(pad, barY, barW * mw, 8);
          octx.fillStyle = "rgba(234, 168, 122, 0.6)";
          octx.fillRect(pad, barY + 14, barW * ms, 8);
          const totalL = Math.min(1, totalRootLength(state) / 2);
          octx.fillStyle = "rgba(194, 106, 82, 0.6)";
          octx.fillRect(pad, barY + 28, barW * totalL, 6);
          octx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
          octx.textAlign = "left";
          octx.fillStyle = "rgba(232, 237, 229, 0.7)";
          const depth = treeDepth(state);
          octx.fillText(
            `tips ${Math.max(0, state.nodes.length - 1)}  sealed ${sealedCount(state)}  ` +
              `depth ${depth.toFixed(2)}  ${ringHzFor(depth).toFixed(0)}hz`,
            pad,
            barY + 54,
          );
          octx.fillText(
            `soil ${state.soilWater.toFixed(2)}  sun ${state.sunlight.toFixed(2)}  ` +
              `mean-water ${mw.toFixed(2)}  mean-sugar ${ms.toFixed(2)}`,
            pad,
            barY + 68,
          );
          octx.globalAlpha = 1;
        }

        if (cursorLit > 0.01) {
          octx.strokeStyle = `rgba(232, 237, 229, ${(0.4 * cursorLit).toFixed(3)})`;
          octx.lineWidth = 1;
          octx.beginPath();
          octx.arc(cursorX * w, cursorY * h, 9 + kbCharge * 20, 0, Math.PI * 2);
          octx.stroke();
        }
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
      populationLayer?.dispose();
      quad?.dispose();
      stage?.dispose();
      cancelAnimationFrame(raf);
      void lastSeen;
    };
  }, []);

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
      route="/root"
      surfaceRef={surfaceRef}
      voice={voice}
      keyboard={keyboard}
      onGlimmer={() => apiRef.current?.glimmer()}
      onReducedMotion={(on) => apiRef.current?.reduced(on)}
      letGo={{ label: "let the network rest", onLetGo: letGo, visible: hasKept }}
      style={{ position: "fixed", inset: 0, background: "#070504" }}
    >
      <canvas
        ref={surfaceRef}
        role="application"
        tabIndex={0}
        aria-label="a hand's width of soil in section — the network hunting water in the dark"
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

// Kept imports the compiler intentionally reserved for the shader-template
// interpolations and forward-compatibility. Referencing them here silences
// unused-import diagnostics without adding runtime overhead.
void MAX_GENERATION;
void MAX_GROWTH;
void POOL_Y_MIN;
void depthForRingHz;
