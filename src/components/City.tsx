"use client";

/**
 * /city — a small settlement whose identity IS its causal roles.
 *
 * A city is not architecture; it is a cycle of care. Homes shelter, stores
 * feed, events gather, trees temper the weather, people walk between them
 * carrying a need. Every gesture in this room chooses one of those causal
 * roles: a plot's identity is what the hand held it long enough to become.
 *
 *   one finger tap    → ripple this ground; the city notices where you touched
 *   one finger dwell  → plant a plot. keep holding and it climbs the civic
 *                        ladder: home → store → event → tree (each rung is
 *                        a different answer to a different need)
 *   ceremony hold     → seals the plot at its current role (permanent,
 *                        the room's one solemn act) and lights it kept
 *   drag              → traces a road; roads speed the people who walk them
 *   two-finger twist  → the lens: map / hydrology / satisfaction
 *   three-finger tap  → tutti; every home rings its bell and the people
 *                        gather to the nearest event
 *   three-finger drag → wind; pushes weather across the settlement
 *   three-finger twist→ season; the year turns and the trees follow
 *   three-finger hold → time dilation; the day runs at 1/4
 *   tilt              → rain leans across the field
 *   knock             → the city's bell tolls once — people gather
 *   flip              → night, whatever the day said
 *
 * v2 moves the material to WebGL. The ground is a fragment shader (soil
 * grain, hydrology veins, evening horizon, day-night off `dayFraction`,
 * season tint, wet-ground darkening + specular sheen, wind-leaned rain);
 * the plots are one instanced draw over per-role SDFs (home = warm gable +
 * breathing chimney, store = awning + open front, event = pinwheel of
 * gathering sparks, tree = canopy shaped by `treeFoliage(season)`);
 * people are one instanced draw of heading-aligned slivers whose tint
 * carries the phased arc (arrival / consolidation / belonging / leaving)
 * and whose paler alpha marks a hesitation. Canvas 2D remains only as a
 * thin overlay for roads, the dwell ring, satisfaction halos and the
 * micro-community ring on plots with two or more regulars.
 *
 * The causal laws in `src/lib/city.ts` are untouched — this file is
 * rendering + gesture translation, and the tests in `test-city.mjs` pin
 * every function this room reads.
 *
 * The population is the density that manufactures the city's possibilities:
 * every dweller carries a heading (so a street of walkers reads as a street
 * of directed walkers), an arrival phase (a new resident enters from the
 * nearest edge and walks in, so the phased arc arrival → consolidation →
 * belonging is visible), a small per-need visit ledger (returning to the
 * same store or event N times makes that person a regular there, and the
 * plot's identity densifies from a role into a small community of the
 * people who keep coming back), and a hesitation state (when two plots
 * answer the same need at nearly-equal distance, the step slows and the
 * route may swap — the visible tradeoff density buys). All of that is
 * decided by pure functions in `src/lib/city.ts`; this file only writes
 * the rendering.
 */

import { useEffect, useRef, useState } from "react";
import LetGo from "@/components/LetGo";
import { attachGestures } from "@/lib/gesture";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { onVessel } from "@/lib/vessel";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  onGalleryPause,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";
import { clocksFrom } from "@/lib/webgl/sizing";
import {
  createGLStage,
  FULLSCREEN_VERT_UNIT,
  type FullscreenQuad,
  type GLProgram,
  type GLStage,
  type InstancedDraw,
} from "@/lib/webgl/stage";
import { spectralRegisterFor, entryScaleFor } from "@/lib/scale";
import {
  CITY_DAY_MS,
  HESITATION_SPEED_FACTOR,
  PLOT_DWELL_MS,
  SEASON_ORDER,
  dayFraction,
  dwellersPerHome,
  headingFor,
  hesitationBetween,
  isDaytime,
  isRegularOf,
  mulberry,
  nearestEdgePoint,
  needFor,
  nextSeason,
  recordVisit,
  roleForDwell,
  stepTowards,
  targetForNeedWithRegular,
  treeFoliage,
  type CityLens,
  type Need,
  type PersonPhase,
  type PlotRole,
  type PlotSample,
  type Season,
  type VisitRecord,
} from "@/lib/city";

const STORAGE_KEY = "objetdart:city:v1";
const MAX_PLOTS = 48;
const MAX_PEOPLE = 96;
const MAX_ROADS = 32;
/** Neighborhood radius (normalized) for the density-as-engine signal. */
const NEIGHBOR_R = 0.14;

type Plot = {
  id: number;
  seed: number;
  x: number;
  y: number;
  role: PlotRole;
  dwellStartMs: number;
  liveDwellMs: number;
  sealed: boolean;
  bornMs: number;
};

type Person = {
  id: number;
  seed: number;
  x: number;
  y: number;
  homeId: number;
  targetPlotId: number | null;
  need: Need;
  fed: number;
  rested: number;
  heading: number;
  phase: PersonPhase;
  foodVisit: VisitRecord | null;
  gatherVisit: VisitRecord | null;
  regularStoreId: number | null;
  regularEventId: number | null;
  hesitating: boolean;
  hesitationSince: number;
};

type Road = { x1: number; y1: number; x2: number; y2: number; bornMs: number };

type Persisted = {
  version: 1;
  plots: Array<Omit<Plot, "dwellStartMs" | "liveDwellMs">>;
  season: Season;
  cityTimeMs: number;
};

const SEASON_INDEX: Record<Season, number> = {
  spring: 0,
  summer: 1,
  fall: 2,
  winter: 3,
};

/** Season-tinted ground base colour, sampled in the fragment shader. */
const SEASON_RGB: Record<Season, [number, number, number]> = {
  spring: [0.44, 0.53, 0.36],
  summer: [0.62, 0.55, 0.32],
  fall: [0.56, 0.36, 0.20],
  winter: [0.44, 0.48, 0.53],
};

// ——— the ground: soil, hydrology, weather ————————————————————————————————

const FRAG_GROUND = `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBreath;
uniform float uDayF;       // 0..1, dayFraction()
uniform float uIsDay;      // 1 during the working half, 0 at night
uniform vec3  uSeasonRGB;  // season-tinted base
uniform float uSeasonF;    // 0..3, continuous — a season detent smoothed
uniform float uWet;        // 0..1, weatherRain
uniform float uWind;       // -1..1
uniform float uLens;       // 0 map, 1 hydrology, 2 satisfaction
uniform float uReduced;
uniform float uPress;      // 0..1, active dwell (raises soil in a halo)
uniform vec2  uPressAt;    // where the finger stands, in 0..1 uv

float hash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++){
    v += a * vnoise(p);
    p *= 2.03;
    a *= 0.54;
  }
  return v;
}

void main(){
  vec2 uv = vUv;
  float aspect = uResolution.x / max(1.0, uResolution.y);

  // ——— sky above the horizon ———
  // dayFraction maps: 0 dawn, 0.25 noon, 0.5 dusk, 0.75 midnight.
  // brightness of the sky rides that cosine so the horizon warms toward dusk.
  float f = uDayF;
  float diurnal = 0.5 + 0.5 * cos((f - 0.25) * 6.2831853);
  float light = mix(0.28, 1.0, diurnal);

  vec3 seasonBase = uSeasonRGB;
  vec3 skyTop = seasonBase * light * vec3(0.86, 0.94, 1.04);
  vec3 skyLow = seasonBase * light * 0.72;
  // ember horizon at dawn / dusk
  float ember = smoothstep(0.03, 0.22, min(f, 1.0 - f));
  vec3 emberCol = mix(vec3(0.42, 0.16, 0.06), vec3(0.98, 0.62, 0.28), diurnal);
  vec3 horizonBand = mix(emberCol, vec3(0.0), ember);

  float horizon = 0.42;
  vec3 col;
  if (uv.y < horizon){
    // sky
    float k = uv.y / horizon;
    col = mix(skyTop, skyLow, pow(k, 1.3));
    col += horizonBand * exp(-pow((uv.y - horizon) / 0.10, 2.0)) * 0.5;
    // a slow drift of cloud, thicker in winter
    float clouds = fbm(vec2(uv.x * 3.0 + uTime * 0.006 * (1.0 + uWind * 0.6), uv.y * 6.0));
    float cover = 0.28 + 0.08 * sin(uSeasonF * 1.5) + uWet * 0.35;
    col = mix(col, vec3(0.62, 0.58, 0.55) * light, smoothstep(0.55, 0.85, clouds) * cover);
  } else {
    // ground — soil, tinted by season, with texture that varies by depth
    float d = (uv.y - horizon) / (1.0 - horizon);
    vec3 groundBase = seasonBase * light * 0.68;
    vec3 groundDeep = seasonBase * light * 0.42;
    col = mix(groundBase, groundDeep, d * d);
    // grain — soil is grainy, not smooth
    vec2 gp = floor(uv * uResolution * 0.5);
    col *= 0.86 + 0.24 * hash21(gp);
    // aggregate (clods / peds)
    float ped = fbm(uv * vec2(14.0 * aspect, 14.0));
    col *= 0.9 + 0.2 * ped;
    // hydrology: a sinuous drain across the middle of the field,
    // stronger and darker under the "hydrology" lens
    float meanderY = horizon + 0.28 + sin(uv.x * 6.5 + uTime * 0.05) * 0.05;
    float streamDist = abs(uv.y - meanderY) - (0.008 + 0.006 * sin(uv.x * 22.0));
    float stream = 1.0 - smoothstep(0.0, 0.012, streamDist);
    float lensStream = mix(0.20, 0.85, step(0.5, uLens) * step(uLens, 1.5));
    col = mix(col, vec3(0.08, 0.20, 0.30), stream * lensStream);

    // wet ground: darken the whole soil, add a specular sheen where the
    // slope catches sun — a light film of water reads as darkening and
    // brightening at once, the way a puddle does
    col *= 1.0 - uWet * 0.18;
    float slope = smoothstep(0.05, 0.45, d);
    float sheen = pow(vnoise(uv * vec2(60.0, 60.0)), 3.0);
    col += vec3(0.75, 0.86, 0.94) * sheen * uWet * slope * 0.35;

    // press ring — the ground answers where a finger stands
    vec2 pr = (uv - uPressAt) * vec2(aspect, 1.0);
    float pd = length(pr);
    col += vec3(0.30, 0.22, 0.12) * uPress * exp(-pd * pd / 0.006);

    // vignette so the edges quiet
    vec2 vd = (uv - vec2(0.5, 0.7)) * vec2(aspect, 1.0);
    col *= 1.0 - 0.35 * smoothstep(0.20, 1.10, dot(vd, vd));
  }

  // rain streaks in the shader — thin diagonal lines, wind-leaned,
  // drawn only when there is weather. Under reduced motion we still show
  // rain, but frozen: a stationary pattern is legibly "under weather"
  // without adding a shake.
  if (uWet > 0.02){
    vec2 rp = uv * vec2(90.0, 40.0);
    rp.x += uWind * (uv.y * 40.0);
    float advance = mix(0.0, uTime * (2.5 + uWet * 6.0), 1.0 - uReduced);
    rp.y -= advance;
    float col1 = smoothstep(0.98, 1.0, hash21(floor(rp)));
    float col2 = smoothstep(0.995, 1.0, hash21(floor(rp * vec2(1.7, 1.3)) + 33.0));
    float streaks = max(col1, col2) * uWet;
    col = mix(col, vec3(0.72, 0.80, 0.88), streaks * 0.55);
  }

  // night veil for a passed-dusk sky (day-clock only — the vessel's
  // face-down flip runs a separate DOM overlay on top, so night can land
  // in two channels at once)
  float night = 1.0 - uIsDay;
  col = mix(col, col * vec3(0.32, 0.36, 0.48), night * 0.35);

  gl_FragColor = vec4(col, 1.0);
}`;

// ——— the plots: one instanced draw over per-role SDFs ————————————————————
// Each plot occupies a small quad in screen space; the fragment shader
// branches on the role and renders the causal identity directly. Density
// and micro-community counts feed the fragment as per-instance uniforms
// so a plot literally glows brighter beside its neighbors, and a plot
// with regulars wears a soft warm halo without any texture atlas.

const VERT_PLOT = `
attribute vec2 a_corner;
attribute vec2 a_center;
attribute vec4 a_props;    // role, sizePx, sealed, dwellFrac
attribute vec4 a_extras;   // foliage(0..1), density(0..1), regulars(0..1), bornAge(s)
uniform vec2 uResolution;
varying vec2 vLocal;
varying vec4 vProps;
varying vec4 vExtras;
void main(){
  vec2 pxCenter = a_center * uResolution;
  float roleScale = mix(1.0, 1.35, step(3.5, a_props.x));
  float born = clamp(a_extras.w * 3.0, 0.0, 1.0);
  float size = a_props.y * roleScale * mix(0.6, 1.0, born);
  vec2 offset = a_corner * size;
  vec2 px = pxCenter + offset;
  vec2 clip = (px / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = a_corner;
  vProps = a_props;
  vExtras = a_extras;
}`;

const FRAG_PLOT = `
precision highp float;
varying vec2 vLocal;
varying vec4 vProps;
varying vec4 vExtras;
uniform float uTime;
uniform float uBreath;

float sdBox(vec2 p, vec2 b){
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

vec4 drawHome(vec2 p, float sealed, float density){
  // a warm gable over a lit rectangle, with a chimney flame that breathes
  float body = sdBox(p - vec2(0.0, 0.15), vec2(0.55, 0.40));
  float roof = max(abs(p.x) + (p.y - 0.15) * 1.6 - 0.9, -(p.y - 0.6));
  float shell = min(body, roof);
  float m = smoothstep(0.02, -0.02, shell);
  vec3 warm = mix(vec3(0.55, 0.35, 0.20), vec3(0.92, 0.72, 0.36), 0.5 + 0.5 * density);
  vec3 col = warm;
  float win = sdBox(p - vec2(0.0, 0.10), vec2(0.16, 0.14));
  col = mix(col, vec3(1.00, 0.86, 0.52), smoothstep(0.02, -0.02, win));
  float flame = smoothstep(0.10, 0.0, distance(p, vec2(0.30, -0.55 + 0.05 * sin(uTime * 3.0))));
  col = mix(col, vec3(1.00, 0.72, 0.30), flame * (0.6 + 0.4 * uBreath));
  float outline = abs(shell) < 0.03 && sealed > 0.5 ? 1.0 : 0.0;
  col = mix(col, vec3(0.98, 0.94, 0.80), outline * 0.7);
  return vec4(col, m);
}

vec4 drawStore(vec2 p, float sealed, float density){
  // rectangular body with a bright awning and a darker open front
  float body = sdBox(p - vec2(0.0, 0.06), vec2(0.60, 0.45));
  float m = smoothstep(0.02, -0.02, body);
  vec3 warm = mix(vec3(0.66, 0.36, 0.16), vec3(0.90, 0.48, 0.22), 0.4 + 0.6 * density);
  vec3 col = warm;
  float awning = sdBox(p - vec2(0.0, -0.32), vec2(0.62, 0.11));
  col = mix(col, vec3(0.96, 0.86, 0.40), smoothstep(0.02, -0.02, awning));
  float door = sdBox(p - vec2(0.0, 0.28), vec2(0.32, 0.18));
  col = mix(col, vec3(0.12, 0.09, 0.07), smoothstep(0.02, -0.02, door));
  float outline = abs(body) < 0.03 && sealed > 0.5 ? 1.0 : 0.0;
  col = mix(col, vec3(0.98, 0.94, 0.80), outline * 0.7);
  return vec4(col, m);
}

vec4 drawEvent(vec2 p, float sealed, float density){
  // a bright pinwheel of gathering sparks over a small stage
  float ang = atan(p.y, p.x);
  float rad = length(p);
  float petals = 0.5 + 0.5 * cos(ang * 5.0 + uTime * 1.7);
  float star = smoothstep(0.85, 0.0, rad + petals * 0.18);
  vec3 col = mix(vec3(0.86, 0.58, 0.16), vec3(1.00, 0.94, 0.66), star);
  float pole = sdBox(p - vec2(0.0, 0.10), vec2(0.04, 0.44));
  col = mix(col, vec3(0.22, 0.16, 0.10), smoothstep(0.01, -0.01, pole));
  float flag = sdBox(p - vec2(0.20 + 0.06 * sin(uTime * 2.0), -0.28), vec2(0.20, 0.10));
  col = mix(col, vec3(0.94, 0.34, 0.28), smoothstep(0.02, -0.02, flag));
  float spark = smoothstep(0.90, 0.30, rad) * pow(0.5 + 0.5 * sin(ang * 12.0 + uTime * 6.0), 6.0);
  col += vec3(1.0, 0.86, 0.44) * spark * density;
  float outline = smoothstep(0.03, 0.0, abs(rad - 0.85)) * sealed;
  col = mix(col, vec3(0.98, 0.94, 0.80), outline * 0.7);
  float m = smoothstep(0.90, 0.0, rad);
  return vec4(col, m);
}

vec4 drawTree(vec2 p, float sealed, float foliage){
  // trunk plus a canopy shaped by treeFoliage(season)
  float trunk = sdBox(p - vec2(0.0, 0.35), vec2(0.07, 0.30));
  float canopyR = mix(0.30, 0.80, foliage);
  float canopyD = length(p - vec2(0.0, -0.10)) - canopyR;
  float wobble = 0.06 * sin(atan(p.y + 0.10, p.x) * 6.0 + uTime * 0.5);
  canopyD += wobble;
  float m = max(smoothstep(0.02, -0.02, canopyD), smoothstep(0.02, -0.02, trunk));
  vec3 green = mix(vec3(0.34, 0.30, 0.20), vec3(0.24, 0.55, 0.28), foliage);
  vec3 col = green;
  col = mix(col, vec3(0.30, 0.20, 0.12), smoothstep(0.01, -0.01, trunk));
  float outline = smoothstep(0.02, 0.0, abs(canopyD)) * sealed;
  col = mix(col, vec3(0.98, 0.94, 0.80), outline * 0.7);
  return vec4(col, m);
}

void main(){
  float role = vProps.x;
  float sealed = vProps.z;
  float dwell = vProps.w;
  float foliage = vExtras.x;
  float density = vExtras.y;
  float regulars = vExtras.z;

  vec4 shape = vec4(0.0);
  if (role < 1.5)      shape = drawHome(vLocal, sealed, density);
  else if (role < 2.5) shape = drawStore(vLocal, sealed, density);
  else if (role < 3.5) shape = drawEvent(vLocal, sealed, density);
  else                 shape = drawTree(vLocal, sealed, foliage);

  // micro-community halo: regulars soften a warm ring around the plot —
  // "a store is where THESE people eat", drawn on the material itself.
  float haloD = length(vLocal) - 1.05;
  float halo = smoothstep(0.15, 0.0, abs(haloD));
  vec3 col = shape.rgb + vec3(0.36, 0.24, 0.10) * halo * regulars * 0.5;
  float m = max(shape.a, halo * regulars * 0.35);

  // dwell hint — a plot climbing the ladder glimmers along its silhouette
  float glimmer = smoothstep(0.4, 1.0, dwell) * (0.5 + 0.5 * sin(uTime * 6.0));
  col += vec3(1.0, 0.90, 0.50) * glimmer * m * 0.25;

  if (m < 0.02) discard;
  gl_FragColor = vec4(col, m);
}`;

// ——— the people: one instanced draw, heading-aligned slivers ———————————
// A dweller is a small quad rotated onto its heading, coloured by phase
// (arrival cool → belonging warm → leaving grey), and paled while
// hesitating. Regulars carry a warm cast, exactly as the canvas-2D layer
// did — the code just lives on the GPU now.

const VERT_PERSON = `
attribute vec2 a_corner;
attribute vec2 a_center;
attribute vec4 a_state;    // cos(h), sin(h), phase(0 arriving / 1 settled), flags (bit0 hesitating, bit1 regular)
uniform vec2 uResolution;
varying vec2 vLocal;
varying vec4 vState;
void main(){
  vec2 pxCenter = a_center * uResolution;
  // sliver is 6px along heading, 2.4px across
  vec2 body = vec2(a_corner.x * 3.0, a_corner.y * 1.2);
  vec2 rotated = vec2(
    body.x * a_state.x - body.y * a_state.y,
    body.x * a_state.y + body.y * a_state.x
  );
  vec2 px = pxCenter + rotated;
  vec2 clip = (px / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = a_corner;
  vState = a_state;
}`;

const FRAG_PERSON = `
precision mediump float;
varying vec2 vLocal;
varying vec4 vState;
void main(){
  float d = length(vLocal);
  if (d > 1.0) discard;
  float m = smoothstep(1.0, 0.5, d);
  float phase = vState.z;
  float flags = vState.w;
  float hesitating = floor(mod(flags, 2.0));
  float regular    = floor(mod(flags / 2.0, 2.0));
  vec3 arriving = vec3(0.34, 0.44, 0.68);
  vec3 settled  = vec3(0.13, 0.14, 0.16);
  vec3 warmReg  = vec3(0.78, 0.45, 0.16);
  vec3 base = mix(arriving, settled, phase);
  vec3 col = mix(base, warmReg, regular);
  float alpha = m * mix(0.85, 0.55, hesitating);
  gl_FragColor = vec4(col, alpha);
}`;

export default function City() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const nightVeilRef = useRef<HTMLDivElement | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);
  // The room "stands" (LetGo is shown) whenever any plot exists. This
  // state is deliberately not a dep of the mount effect — remounting on a
  // standing-poll flip would tear the WebGL context down every time the
  // first plot appears or the last one leaves.
  const [hasKept, setHasKept] = useState(false);
  const letGo = () => {
    try { window.dispatchEvent(new Event("letgo")); } catch { /* noop */ }
    setHasKept(false);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const glCanvas = glCanvasRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !glCanvas || !overlay) return;
    // TypeScript narrowing does not survive the nested closures below —
    // capture the guarded elements once as non-null aliases.
    const wrapEl = wrap;

    // ── quality tier + DPR through the shared runtime ────────────────────
    const embedded = window.self !== window.top;
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
    const populationSpeed = reduceMotion ? 0.4 : 1;
    const governor = createFrameGovernor(embedded ? "medium" : "high");

    // ── state ────────────────────────────────────────────────────────────
    const plots: Plot[] = [];
    const people: Person[] = [];
    const roads: Road[] = [];

    let nextPlotId = 1;
    let nextPersonId = 1;

    let activePlant: Plot | null = null;
    let activePlantStartedAt = 0;
    let plantRingWeight = 0;

    // roads being traced by the current drag — the live pointer is kept so
    // the preview segment is drawn honestly on every frame the finger is down
    let dragRoadStart: { x: number; y: number } | null = null;
    let dragRoadLive: { x: number; y: number } | null = null;

    let cityTimeMs = 0;
    let cityTimeScale = 1;
    let lastFrameAt = performance.now();

    let season: Season = "spring";
    let seasonPhase = 0;
    let lens: CityLens = "map";
    let lensFade = 0;
    let weatherRain = 0;
    let weatherWind = 0;

    let nightOn = false;
    let nightAmt = 0;
    let hintHidden = false;

    // ── restore ──────────────────────────────────────────────────────────
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        if (parsed?.version === 1) {
          for (const p of parsed.plots.slice(0, MAX_PLOTS)) {
            plots.push({ ...p, dwellStartMs: 0, liveDwellMs: 0 });
            nextPlotId = Math.max(nextPlotId, p.id + 1);
          }
          if (SEASON_ORDER.includes(parsed.season)) {
            season = parsed.season;
            seasonPhase = SEASON_INDEX[season];
          }
          cityTimeMs = Number.isFinite(parsed.cityTimeMs) ? parsed.cityTimeMs : 0;
        }
      }
    } catch { /* corrupt persistence is silently discarded */ }

    respawnPeopleFromHomes();

    // ── audio ────────────────────────────────────────────────────────────
    const A = () => getFieldAudio();

    // ── persistence writer ───────────────────────────────────────────────
    const saveState = () => {
      try {
        const payload: Persisted = {
          version: 1,
          plots: plots.map((p) => ({
            id: p.id, seed: p.seed, x: p.x, y: p.y, role: p.role, sealed: p.sealed, bornMs: p.bornMs,
          })),
          season,
          cityTimeMs,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch { /* quota exhausted → the city is a session, not a record */ }
    };
    const idleWrite = createIdleWriter(saveState);

    // ── the stage: the shader for the whole field ───────────────────────
    let stage: GLStage | null = null;
    let groundProg: GLProgram | null = null;
    let groundQuad: FullscreenQuad | null = null;
    let plotProg: GLProgram | null = null;
    let plotDraw: InstancedDraw | null = null;
    let personProg: GLProgram | null = null;
    let personDraw: InstancedDraw | null = null;
    // one Float32Array per attribute, sized to the population cap once
    const plotCenter = new Float32Array(MAX_PLOTS * 2);
    const plotProps = new Float32Array(MAX_PLOTS * 4);
    const plotExtras = new Float32Array(MAX_PLOTS * 4);
    const personCenter = new Float32Array(MAX_PEOPLE * 2);
    const personState = new Float32Array(MAX_PEOPLE * 4);

    const buildPrograms = () => {
      if (!stage) return;
      groundProg = stage.program(FULLSCREEN_VERT_UNIT, FRAG_GROUND);
      groundQuad = groundProg ? stage.fullscreenQuad(groundProg, "unit") : null;
      plotProg = stage.program(VERT_PLOT, FRAG_PLOT);
      plotDraw = plotProg ? stage.instanced(plotProg) : null;
      personProg = stage.program(VERT_PERSON, FRAG_PERSON);
      personDraw = personProg ? stage.instanced(personProg) : null;
      const corners = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
      if (plotDraw) plotDraw.attribute("a_corner", corners, 2, 0);
      if (personDraw) personDraw.attribute("a_corner", corners, 2, 0);
      const gl = stage.gl;
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    };

    stage = createGLStage(glCanvas, {
      wrap,
      label: "city",
      overlay,
      reducedMotion: reduceMotion,
      embedded,
      quality: governor.tier(),
      contextAttributes: { alpha: false, antialias: false, depth: false },
      onContextRestored: () => buildPrograms(),
    });
    if (stage) buildPrograms();
    const overlayCtx = stage?.overlay2d ?? overlay.getContext("2d");
    const register = spectralRegisterFor(entryScaleFor("/city") ?? 4.5);
    let currentDpr = resolveDpr(governor.tier(), { embedded, reducedMotion: reduceMotion });

    // ── gestures ─────────────────────────────────────────────────────────
    const detach = attachGestures(wrap, {
      tap: (e) => {
        if (e.fingers === 1) {
          const p = plotAt(e.x, e.y);
          if (p) {
            plantRingWeight = 0.9;
            try { A().playNote(48 + p.id % 12, 220); } catch { /* noop */ }
            try { haptics.ripple(0.3 + e.intensity * 0.35); } catch { /* noop */ }
          } else {
            try { haptics.tap(); } catch { /* noop */ }
          }
        } else if (e.fingers === 3) {
          const events = plots.filter((p) => p.role === "event");
          for (const person of people) {
            if (events.length > 0) {
              const target = events.reduce(
                (best, ev) => {
                  const d2 = (ev.x - person.x) ** 2 + (ev.y - person.y) ** 2;
                  return d2 < best.d ? { d: d2, ev } : best;
                },
                { d: Infinity, ev: events[0] },
              );
              person.targetPlotId = target.ev.id;
              person.need = "gather";
            }
          }
          try { A().bell(); } catch { /* noop */ }
          try { haptics.roll(); } catch { /* noop */ }
        }
      },

      hold: (e) => {
        if (e.fingers === 3) {
          if (e.phase === "enter") {
            cityTimeScale = 0.25;
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") cityTimeScale = 1;
          return;
        }
        if (e.fingers !== 1) return;

        if (e.phase === "enter") {
          const existing = plotAt(e.x, e.y);
          if (existing && !existing.sealed) {
            activePlant = existing;
            activePlantStartedAt = performance.now();
            existing.dwellStartMs = activePlantStartedAt;
          } else if (!existing) {
            if (plots.length >= MAX_PLOTS) return;
            const seed = ((e.x * 1000) | 0) ^ ((e.y * 1000) | 0) ^ nextPlotId;
            const plot: Plot = {
              id: nextPlotId++,
              seed,
              x: e.x / stageWidth(),
              y: e.y / stageHeight(),
              role: "home",
              dwellStartMs: performance.now(),
              liveDwellMs: 0,
              sealed: false,
              bornMs: cityTimeMs,
            };
            plots.push(plot);
            activePlant = plot;
            activePlantStartedAt = plot.dwellStartMs;
            spawnDwellersFor(plot);
            try { A().playNote(52, 240); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
        }

        if (e.phase === "tick" && activePlant) {
          activePlant.liveDwellMs = performance.now() - activePlantStartedAt;
          if (e.tier >= 2 && !activePlant.sealed) {
            const newRole = roleForDwell(activePlant.liveDwellMs);
            if (newRole !== activePlant.role) {
              activePlant.role = newRole;
              try { A().playNote(56 + roleTier(newRole) * 2, 260); } catch { /* noop */ }
              try { haptics.detent(); } catch { /* noop */ }
              plantRingWeight = 1;
            }
          }
          if (e.tier >= 3 && !activePlant.sealed) {
            activePlant.sealed = true;
            try { A().bell(); } catch { /* noop */ }
            try { haptics.bloom(); } catch { /* noop */ }
            plantRingWeight = 1;
            idleWrite.schedule();
          }
        }

        if (e.phase === "release") {
          activePlant = null;
          idleWrite.schedule();
        }
      },

      drag: (e) => {
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          weatherWind = Math.max(-1, Math.min(1, weatherWind + e.dx * 0.006));
          weatherRain = Math.max(0, Math.min(1, weatherRain + Math.abs(e.dy) * 0.002));
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          dragRoadStart = { x: e.x / stageWidth(), y: e.y / stageHeight() };
          dragRoadLive = { ...dragRoadStart };
          return;
        }
        if (e.phase === "move") {
          dragRoadLive = { x: e.x / stageWidth(), y: e.y / stageHeight() };
          return;
        }
        if (e.phase === "end") {
          if (dragRoadStart) {
            if (roads.length >= MAX_ROADS) roads.shift();
            roads.push({
              x1: dragRoadStart.x, y1: dragRoadStart.y,
              x2: e.x / stageWidth(), y2: e.y / stageHeight(),
              bornMs: cityTimeMs,
            });
            try { haptics.chop(); } catch { /* noop */ }
          }
          dragRoadStart = null;
          dragRoadLive = null;
        }
      },

      twist: (e) => {
        if (e.fingers === 3) {
          if (e.phase !== "move") return;
          const detent = Math.PI / 2;
          if (Math.abs(e.angle) < detent * 0.9) return;
          season = nextSeason(season, e.angle > 0 ? 1 : -1);
          try { A().playNote(44 + SEASON_ORDER.indexOf(season) * 2, 320); } catch { /* noop */ }
          try { haptics.detent(); } catch { /* noop */ }
          idleWrite.schedule();
          return;
        }
        if (e.phase !== "move") return;
        if (Math.abs(e.angle) < Math.PI / 3) return;
        const lenses: CityLens[] = ["map", "hydrology", "satisfaction"];
        const cur = lenses.indexOf(lens);
        lens = lenses[(cur + (e.angle > 0 ? 1 : -1) + lenses.length) % lenses.length];
        lensFade = 1;
        try { haptics.lens(); } catch { /* noop */ }
      },

      flick: (e) => {
        if (e.fingers !== 1) return;
        try { A().playNote(60 + Math.floor(e.angle * 4) % 12, 260); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        const px = e.x / stageWidth();
        const py = e.y / stageHeight();
        for (const person of people) {
          const d2 = (person.x - px) ** 2 + (person.y - py) ** 2;
          if (d2 < 0.09) person.need = "gather";
        }
      },

      scrub: () => {
        try { haptics.tap(); } catch { /* noop */ }
      },
    }, { wheelZoom: false });

    // ── vessel: tilt / shake / knock / flip ──────────────────────────────
    const detachVessel = onVessel({
      tilt: (e) => {
        const lean = Math.min(1, Math.hypot(e.beta, e.gamma) / 45);
        weatherRain = Math.max(weatherRain, lean * 0.9);
      },
      shake: (e) => {
        dragRoadStart = null;
        dragRoadLive = null;
        weatherWind = Math.max(-1, Math.min(1, weatherWind + (e.intensity - 0.5) * 0.4));
      },
      knock: () => {
        try { A().bell(); } catch { /* noop */ }
        try { haptics.detent(); } catch { /* noop */ }
        const events = plots.filter((p) => p.role === "event");
        if (events.length === 0) return;
        for (const person of people) {
          person.targetPlotId = events[0].id;
          person.need = "gather";
        }
      },
      flip: (e) => {
        // face-down is night: the day-clock jumps to midnight AND the DOM
        // veil darkens, so dusk lands in two channels at once.
        nightOn = e.faceDown;
        if (e.faceDown) {
          cityTimeMs = Math.floor(cityTimeMs / CITY_DAY_MS) * CITY_DAY_MS + CITY_DAY_MS * 0.75;
          try { A().playNote(38, 320); } catch { /* noop */ }
          try { haptics.detent(); } catch { /* noop */ }
        }
      },
    });

    // ── pause + visibility ───────────────────────────────────────────────
    let docHidden = document.hidden;
    let galleryPaused = embedded;
    const applyPause = () => {
      if (docHidden || galleryPaused) governor.force("sleep");
    };
    applyPause();
    const offVisibility = onVisibility((hidden) => { docHidden = hidden; applyPause(); });
    const offGallery = onGalleryPause((paused) => { galleryPaused = paused; applyPause(); });

    // ── frame loop ───────────────────────────────────────────────────────
    let stopped = false;
    let raf = 0;
    let slowWake: ReturnType<typeof setTimeout> | null = null;
    const tick = (now: number) => {
      if (stopped) return;
      if (docHidden || galleryPaused) {
        slowWake = setTimeout(() => { raf = requestAnimationFrame(tick); }, 250);
        return;
      }
      const tier = governor.beginFrame(now);
      const detail = detailForTier(tier);
      const nextDpr = resolveDpr(tier, { embedded, reducedMotion: reduceMotion });
      if (nextDpr !== currentDpr) {
        currentDpr = nextDpr;
        stage?.measure();
      }
      const dt = Math.min(66, now - lastFrameAt);
      lastFrameAt = now;
      cityTimeMs += dt * cityTimeScale;
      // season phase eases toward the discrete detent so the tree canopy
      // grows across the change instead of snapping
      const targetPhase = SEASON_INDEX[season];
      seasonPhase += (targetPhase - seasonPhase) * Math.min(1, dt * 0.003);
      stepPopulation(dt * populationSpeed);
      decayWeather(dt);
      lensFade = Math.max(0, lensFade - dt * 0.0018);
      plantRingWeight = Math.max(0, plantRingWeight - dt * 0.002);
      // night veil eases toward its target; a color change is fine under
      // reduced motion (it is not a shake), only a touch faster.
      const nightEase = reduceMotion ? 0.10 : Math.min(1, dt * 0.0025);
      nightAmt += ((nightOn ? 1 : 0) - nightAmt) * nightEase;
      if (nightVeilRef.current) {
        nightVeilRef.current.style.opacity = String(nightAmt * 0.82);
      }
      // hint fades once anything has been planted — edge-triggered, not per-frame
      const wantHintHidden = plots.length > 0;
      if (hintRef.current && wantHintHidden !== hintHidden) {
        hintHidden = wantHintHidden;
        hintRef.current.style.opacity = wantHintHidden ? "0" : "";
      }
      drawFrame(now, detail);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // ── helpers ──────────────────────────────────────────────────────────

    function stageWidth(): number {
      return stage?.size.width ?? wrapEl.clientWidth ?? 1;
    }
    function stageHeight(): number {
      return stage?.size.height ?? wrapEl.clientHeight ?? 1;
    }

    function plotAt(px: number, py: number): Plot | null {
      const w = stageWidth();
      const h = stageHeight();
      const nx = px / w;
      const ny = py / h;
      const r = 22 / Math.min(w, h);
      let best: Plot | null = null;
      let bestD = r * r;
      for (const plot of plots) {
        const d = (plot.x - nx) ** 2 + (plot.y - ny) ** 2;
        if (d < bestD) { bestD = d; best = plot; }
      }
      return best;
    }

    function spawnDwellersFor(home: Plot): void {
      const count = dwellersPerHome(home.seed);
      const rng = mulberry(home.seed ^ 0x1eaf);
      // Arrivals begin at the nearest map edge and walk home — the phased-arc
      // "arrival" is what the visitor sees before the first "settled" step.
      // Small deterministic jitter along the edge so two siblings do not stand
      // in the same pixel; still 100% seed-derived, no `Math.random`.
      const edge = nearestEdgePoint({ x: home.x, y: home.y });
      const onVerticalEdge = edge.x === 0 || edge.x === 1;
      for (let i = 0; i < count && people.length < MAX_PEOPLE; i += 1) {
        const jitter = (rng() - 0.5) * 0.06;
        const sx = onVerticalEdge ? edge.x : clamp(edge.x + jitter, 0, 1);
        const sy = onVerticalEdge ? clamp(edge.y + jitter, 0, 1) : edge.y;
        const initialHeading = Math.atan2(home.y - sy, home.x - sx);
        people.push({
          id: nextPersonId++,
          seed: home.seed ^ (i + 1),
          x: sx,
          y: sy,
          homeId: home.id,
          targetPlotId: home.id,
          need: "rest",
          fed: 0.7,
          rested: 0.6,
          heading: initialHeading,
          phase: "arriving",
          foodVisit: null,
          gatherVisit: null,
          regularStoreId: null,
          regularEventId: null,
          hesitating: false,
          hesitationSince: 0,
        });
      }
    }

    function respawnPeopleFromHomes(): void {
      people.length = 0;
      for (const p of plots) {
        if (p.role === "home") spawnDwellersFor(p);
      }
    }

    function roleTier(role: PlotRole): number {
      switch (role) {
        case "empty": return 0;
        case "home":  return 1;
        case "store": return 2;
        case "event": return 3;
        case "tree":  return 4;
      }
    }

    function stepPopulation(dt: number): void {
      // arrivals are gated on distance-to-home: the traveller is "arriving"
      // until their first close pass with the front door, then flips to
      // "settled" and the ordinary need cycle takes over. Route swaps only
      // land on a settled person — an arriving dweller has one target and
      // one job (get home). Every visible slowdown is a hesitation, and
      // every hesitation is a genuine same-need tradeoff, not a stutter.
      const HESITATION_SWAP_MS = 550;
      const ARRIVAL_MS = 260;
      for (const person of people) {
        const prevX = person.x;
        const prevY = person.y;

        person.fed = Math.max(0, person.fed - dt * 0.00003);
        person.rested = Math.max(0, person.rested - dt * 0.00002);

        let chosenNeed: Need;
        let regularForNeed: number | null = null;
        if (person.phase === "arriving") {
          chosenNeed = "rest";
          if (person.need !== chosenNeed || person.targetPlotId !== person.homeId) {
            person.need = chosenNeed;
            person.targetPlotId = person.homeId;
          }
        } else {
          chosenNeed = needFor(cityTimeMs, person.fed, person.rested);
          regularForNeed =
            chosenNeed === "food" ? person.regularStoreId :
            chosenNeed === "gather" ? person.regularEventId : null;
          if (person.need !== chosenNeed || person.targetPlotId == null) {
            const target = targetForNeedWithRegular(
              { x: person.x, y: person.y, homeId: person.homeId },
              chosenNeed,
              plots as PlotSample[],
              regularForNeed,
            );
            person.targetPlotId = target?.id ?? null;
            person.need = chosenNeed;
            person.hesitating = false;
            person.hesitationSince = 0;
          }
        }

        if (person.phase === "settled" && (chosenNeed === "food" || chosenNeed === "gather")) {
          const h = hesitationBetween(
            { x: person.x, y: person.y },
            chosenNeed,
            plots as PlotSample[],
          );
          if (h.hesitating) {
            if (!person.hesitating) {
              person.hesitating = true;
              person.hesitationSince = cityTimeMs;
            }
            if (h.secondBestId != null &&
                h.secondBestId !== person.targetPlotId &&
                cityTimeMs - person.hesitationSince > HESITATION_SWAP_MS) {
              person.targetPlotId = h.secondBestId;
              person.hesitating = false;
              person.hesitationSince = 0;
            }
          } else if (person.hesitating) {
            person.hesitating = false;
            person.hesitationSince = 0;
          }
        }

        if (person.targetPlotId != null) {
          const target = plots.find((p) => p.id === person.targetPlotId);
          if (target) {
            const roadBoost = personOnRoad(person) ? 2.2 : 1;
            const hesitationBrake = person.hesitating ? HESITATION_SPEED_FACTOR : 1;
            const stepped = stepTowards(
              { x: person.x, y: person.y },
              { x: target.x, y: target.y },
              dt * roadBoost * hesitationBrake,
            );
            person.x = stepped.x;
            person.y = stepped.y;
            const arrived =
              Math.abs(person.x - target.x) < 0.008 &&
              Math.abs(person.y - target.y) < 0.008;
            if (arrived) {
              if (target.role === "store") person.fed = Math.min(1, person.fed + dt * 0.0015);
              if (target.role === "event") person.rested = Math.min(1, person.rested + dt * 0.0004);
              if (target.role === "home")  person.rested = Math.min(1, person.rested + dt * 0.0012);
              if (person.phase === "arriving" && target.id === person.homeId) {
                if (!person.hesitationSince) person.hesitationSince = cityTimeMs;
                else if (cityTimeMs - person.hesitationSince > ARRIVAL_MS) {
                  person.phase = "settled";
                  person.hesitating = false;
                  person.hesitationSince = 0;
                }
              }
              if (person.phase === "settled" && target.role === "store") {
                person.foodVisit = recordVisit(person.foodVisit, target.id);
                if (isRegularOf(person.foodVisit, target.id)) person.regularStoreId = target.id;
              }
              if (person.phase === "settled" && target.role === "event") {
                person.gatherVisit = recordVisit(person.gatherVisit, target.id);
                if (isRegularOf(person.gatherVisit, target.id)) person.regularEventId = target.id;
              }
            }
          }
        }

        person.heading = headingFor(
          { x: prevX, y: prevY },
          { x: person.x, y: person.y },
          person.heading,
        );
      }
    }

    function personOnRoad(person: Person): boolean {
      for (const road of roads) {
        const denom = Math.max(1e-6, (road.x2 - road.x1) ** 2 + (road.y2 - road.y1) ** 2);
        const t = clamp(
          ((person.x - road.x1) * (road.x2 - road.x1) +
            (person.y - road.y1) * (road.y2 - road.y1)) / denom,
          0,
          1,
        );
        const px = road.x1 + t * (road.x2 - road.x1);
        const py = road.y1 + t * (road.y2 - road.y1);
        if ((person.x - px) ** 2 + (person.y - py) ** 2 < 0.0004) return true;
      }
      return false;
    }

    function decayWeather(dt: number): void {
      weatherRain = Math.max(0, weatherRain - dt * 0.00008);
      weatherWind *= Math.exp(-dt * 0.00015);
    }

    /** density-as-engine: how many peer plots stand within a hand's width. */
    function densityAt(px: number, py: number, selfId: number): number {
      let n = 0;
      for (const q of plots) {
        if (q.id === selfId) continue;
        const d = Math.hypot(q.x - px, q.y - py);
        if (d < NEIGHBOR_R) n += 1;
      }
      return Math.min(1, n / 6);
    }

    // ── drawing ──────────────────────────────────────────────────────────

    function drawFrame(now: number, detail: { simHz: number; samples: number }): void {
      void detail;
      const t = A().getAudioTime() ?? now / 1000;
      const clocks = clocksFrom({
        time: t,
        turbulence: Math.abs(weatherWind),
        register,
        reducedMotion: reduceMotion,
      });

      if (!stage || !groundProg || !groundQuad) return;
      const size = stage.beginFrame(clocks, groundProg);
      const width = size.width;
      const height = size.height;

      // ── ground ────────────────────────────────────────────────────────
      const dayF = dayFraction(cityTimeMs);
      const isDay = isDaytime(cityTimeMs) ? 1 : 0;
      const rgb = SEASON_RGB[season];
      const pressAt = activePlant
        ? { x: activePlant.x, y: activePlant.y }
        : dragRoadLive ?? { x: -1, y: -1 };
      const pressActive = activePlant
        ? Math.min(1, plantRingWeight + 0.35)
        : dragRoadLive ? 0.35 : 0;

      groundProg.setFloat("uDayF", dayF);
      groundProg.setFloat("uIsDay", isDay);
      groundProg.setVec3("uSeasonRGB", rgb[0], rgb[1], rgb[2]);
      groundProg.setFloat("uSeasonF", seasonPhase);
      groundProg.setFloat("uWet", weatherRain);
      groundProg.setFloat("uWind", weatherWind);
      groundProg.setFloat(
        "uLens",
        lens === "map" ? 0 : lens === "hydrology" ? 1 : 2,
      );
      groundProg.setFloat("uReduced", reduceMotion ? 1 : 0);
      groundProg.setFloat("uPress", pressActive);
      groundProg.setVec2("uPressAt", pressAt.x, pressAt.y);
      groundQuad.draw();

      // regular-count per plot, computed once per frame from the people
      const regularCountByPlot = new Map<number, number>();
      for (const person of people) {
        if (person.regularStoreId != null) {
          regularCountByPlot.set(
            person.regularStoreId,
            (regularCountByPlot.get(person.regularStoreId) ?? 0) + 1,
          );
        }
        if (person.regularEventId != null) {
          regularCountByPlot.set(
            person.regularEventId,
            (regularCountByPlot.get(person.regularEventId) ?? 0) + 1,
          );
        }
      }

      // ── plots ─────────────────────────────────────────────────────────
      if (plotProg && plotDraw && plots.length > 0) {
        const foliage = treeFoliage(season);
        for (let i = 0; i < plots.length; i += 1) {
          const p = plots[i];
          plotCenter[i * 2 + 0] = p.x;
          plotCenter[i * 2 + 1] = p.y;
          plotProps[i * 4 + 0] = roleTier(p.role);
          plotProps[i * 4 + 1] = p.sealed ? 26 : 20;
          plotProps[i * 4 + 2] = p.sealed ? 1 : 0;
          const next = nextRoleThreshold(p.role);
          const prev = prevRoleThreshold(p.role);
          const dwellFrac = next
            ? Math.min(1, Math.max(0, (p.liveDwellMs - prev) / (next - prev)))
            : 1;
          plotProps[i * 4 + 3] = dwellFrac;
          plotExtras[i * 4 + 0] = foliage;
          plotExtras[i * 4 + 1] = densityAt(p.x, p.y, p.id);
          plotExtras[i * 4 + 2] = Math.min(1, (regularCountByPlot.get(p.id) ?? 0) / 4);
          plotExtras[i * 4 + 3] = Math.min(3, (cityTimeMs - p.bornMs) / 1000);
        }
        plotProg.use();
        plotProg.setVec2("uResolution", width, height);
        plotProg.setFloat("uTime", now / 1000);
        plotProg.setFloat("uBreath", clocks.breath);
        plotDraw.attribute("a_center", plotCenter.subarray(0, plots.length * 2), 2, 1);
        plotDraw.attribute("a_props", plotProps.subarray(0, plots.length * 4), 4, 1);
        plotDraw.attribute("a_extras", plotExtras.subarray(0, plots.length * 4), 4, 1);
        plotDraw.draw(stage.gl.TRIANGLE_STRIP, 4, plots.length);
        plotDraw.reset();
      }

      // ── people ────────────────────────────────────────────────────────
      if (personProg && personDraw && people.length > 0) {
        for (let i = 0; i < people.length; i += 1) {
          const person = people[i];
          personCenter[i * 2 + 0] = person.x;
          personCenter[i * 2 + 1] = person.y;
          personState[i * 4 + 0] = Math.cos(person.heading);
          personState[i * 4 + 1] = Math.sin(person.heading);
          personState[i * 4 + 2] = person.phase === "arriving" ? 0 : 1;
          const hesitating = person.hesitating ? 1 : 0;
          const isRegular = person.regularStoreId != null || person.regularEventId != null ? 1 : 0;
          personState[i * 4 + 3] = hesitating + isRegular * 2;
        }
        personProg.use();
        personProg.setVec2("uResolution", width, height);
        personDraw.attribute("a_center", personCenter.subarray(0, people.length * 2), 2, 1);
        personDraw.attribute("a_state", personState.subarray(0, people.length * 4), 4, 1);
        personDraw.draw(stage.gl.TRIANGLE_STRIP, 4, people.length);
        personDraw.reset();
      }

      // ── overlay (canvas 2D thin layer) ────────────────────────────────
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, width, height);

        // roads — the strokes a drag has traced across the ground
        if (roads.length > 0 || dragRoadStart) {
          overlayCtx.strokeStyle = "rgba(21, 23, 26, 0.42)";
          overlayCtx.lineWidth = 3;
          overlayCtx.lineCap = "round";
          for (const road of roads) {
            overlayCtx.beginPath();
            overlayCtx.moveTo(road.x1 * width, road.y1 * height);
            overlayCtx.lineTo(road.x2 * width, road.y2 * height);
            overlayCtx.stroke();
          }
          if (dragRoadStart && dragRoadLive) {
            overlayCtx.strokeStyle = "rgba(200, 115, 42, 0.55)";
            overlayCtx.lineWidth = 2;
            overlayCtx.setLineDash([4, 6]);
            overlayCtx.beginPath();
            overlayCtx.moveTo(dragRoadStart.x * width, dragRoadStart.y * height);
            overlayCtx.lineTo(dragRoadLive.x * width, dragRoadLive.y * height);
            overlayCtx.stroke();
            overlayCtx.setLineDash([]);
          }
        }

        // active plant dwell ring
        if (activePlant && !activePlant.sealed) {
          const next = nextRoleThreshold(activePlant.role);
          const prev = prevRoleThreshold(activePlant.role);
          const frac = next
            ? Math.min(1, (activePlant.liveDwellMs - prev) / (next - prev))
            : 1;
          const px = activePlant.x * width;
          const py = activePlant.y * height;
          overlayCtx.strokeStyle = `rgba(255, 232, 178, ${0.55 + plantRingWeight * 0.35})`;
          overlayCtx.lineWidth = 2;
          overlayCtx.beginPath();
          overlayCtx.arc(px, py, 22 + frac * 12, 0, Math.PI * 2);
          overlayCtx.stroke();
        }

        // micro-community ring — a plot with 2+ regulars is not just a
        // role, it is a community of the people who keep coming back
        for (const plot of plots) {
          const count = regularCountByPlot.get(plot.id) ?? 0;
          if (count < 2) continue;
          const px = plot.x * width;
          const py = plot.y * height;
          const radius = 22 + count * 3;
          overlayCtx.strokeStyle = `rgba(232, 187, 129, ${Math.min(0.55, 0.18 + count * 0.08)})`;
          overlayCtx.lineWidth = 1.5;
          overlayCtx.beginPath();
          overlayCtx.arc(px, py, radius, 0, Math.PI * 2);
          overlayCtx.stroke();
        }

        // satisfaction lens — a soft ring on plots with the most visitors
        if (lens === "satisfaction") {
          for (const plot of plots) {
            if (plot.role !== "home" && plot.role !== "store" && plot.role !== "event") continue;
            let visitors = 0;
            for (const person of people) {
              if ((person.x - plot.x) ** 2 + (person.y - plot.y) ** 2 < 0.005) visitors += 1;
            }
            if (visitors === 0) continue;
            overlayCtx.strokeStyle = `rgba(74, 145, 106, ${Math.min(0.55, visitors * 0.18)})`;
            overlayCtx.lineWidth = 4;
            overlayCtx.beginPath();
            overlayCtx.arc(plot.x * width, plot.y * height, 18 + visitors * 2, 0, Math.PI * 2);
            overlayCtx.stroke();
          }
        }

        // lens name — a small named line that fades after each rotation
        if (lensFade > 0.02) {
          overlayCtx.globalAlpha = Math.min(1, lensFade);
          overlayCtx.font = "300 12px ui-monospace, 'SF Mono', Menlo, monospace";
          overlayCtx.fillStyle = "rgba(228, 212, 178, 0.7)";
          overlayCtx.textAlign = "center";
          const label =
            lens === "map"
              ? "map — the plain reading"
              : lens === "hydrology"
                ? "hydrology — the water's own map"
                : "satisfaction — where the feet gather";
          overlayCtx.fillText(label, width / 2, height - 32);
          overlayCtx.globalAlpha = 1;
        }
      }
    }

    function nextRoleThreshold(role: PlotRole): number | null {
      if (role === "home")  return PLOT_DWELL_MS.store;
      if (role === "store") return PLOT_DWELL_MS.event;
      if (role === "event") return PLOT_DWELL_MS.tree;
      return null;
    }
    function prevRoleThreshold(role: PlotRole): number {
      if (role === "home")  return 0;
      if (role === "store") return PLOT_DWELL_MS.home;
      if (role === "event") return PLOT_DWELL_MS.store;
      if (role === "tree")  return PLOT_DWELL_MS.event;
      return 0;
    }
    function clamp(v: number, lo: number, hi: number): number {
      return v < lo ? lo : v > hi ? hi : v;
    }

    // ── LetGo support ────────────────────────────────────────────────────
    const onLetGo = () => {
      plots.length = 0;
      people.length = 0;
      roads.length = 0;
      activePlant = null;
      idleWrite.schedule();
    };
    window.addEventListener("letgo", onLetGo);

    // Poll the room's "standing" state on an edge tracker so this effect
    // stays `[]`-mounted — remounting on a standing-poll flip would tear
    // the WebGL context down every time a plot appears or disappears.
    let standingBroadcast = plots.length > 0;
    setHasKept(standingBroadcast);
    const standingInterval = window.setInterval(() => {
      const standing = plots.length > 0;
      if (standing !== standingBroadcast) {
        standingBroadcast = standing;
        setHasKept(standing);
      }
    }, 125);

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      if (slowWake) clearTimeout(slowWake);
      detach();
      offVisibility();
      offGallery();
      detachVessel();
      window.removeEventListener("letgo", onLetGo);
      window.clearInterval(standingInterval);
      idleWrite.flush();
      idleWrite.cancel();
      saveState();
      if (stage) {
        groundQuad?.dispose();
        plotDraw?.dispose();
        personDraw?.dispose();
        stage.dispose();
      }
    };
    // Mount once. Every mutation flows through refs and the /letgo event;
    // the standing-poll broadcasts into React state without re-entering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "fixed",
        inset: 0,
        touchAction: "none",
        overflow: "hidden",
        background: "#0e0f13",
      }}
    >
      <canvas
        ref={glCanvasRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%" }}
      />
      <canvas
        ref={overlayRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%" }}
      />
      {/* Night veil — face-down flips this from transparent to a deep dusk
          across the whole field. Positioned above the canvases but below
          the HUD/LetGo so the small copy stays readable at night. */}
      <div
        ref={nightVeilRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 3,
          background: "#04060b",
          opacity: 0,
          pointerEvents: "none",
          transition: "opacity 220ms ease",
        }}
      />
      <div className="city-hud">
        <div className="city-title">objet&nbsp;d&rsquo;art &mdash; la cit&eacute;</div>
        <div className="city-hint" ref={hintRef}>
          a settlement made of the care it takes
        </div>
      </div>
      <LetGo label="let the city go" onLetGo={letGo} visible={hasKept} />
      <style dangerouslySetInnerHTML={{ __html: `
        .city-hud {
          position: absolute; left: 0; right: 0; z-index: 10; pointer-events: none;
          top: 0; padding: calc(70px + env(safe-area-inset-top,0px)) 20px 0;
          display: grid; gap: 6px; justify-items: center; text-align: center;
        }
        .city-title {
          font-family: var(--font-fraunces, var(--font-serif, Georgia), serif);
          font-weight: 600; font-size: clamp(20px, 4.5vw, 30px);
          background: linear-gradient(180deg,#fff6da,#f6e6b4 30%,#e7b94e 70%,#b8860b 100%);
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: #e7b94e;
          text-shadow: 0 2px 16px rgba(0,0,0,0.5);
        }
        .city-hint {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px; letter-spacing: 0.14em; text-transform: lowercase;
          color: rgba(246,230,180,0.6);
          transition: opacity .6s ease;
        }
        @media (max-width: 560px){ .city-hint{ font-size: 10px; padding: 0 18px; line-height: 1.45; } }
      ` }} />
    </div>
  );
}
