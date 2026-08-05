"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import LetGo from "@/components/LetGo";
import { attachGestures } from "@/lib/gesture";
import { holdTier, tapTrainDepth, tapTrainTier, THRESHOLDS } from "@/lib/gesture/core";
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
import {
  CITY_DAY_MS,
  HESITATION_SPEED_FACTOR,
  PLOT_DWELL_MS,
  SEASON_ORDER,
  applyPersonLedger,
  dayFraction,
  dwellersPerHome,
  fadeForLeaving,
  headingFor,
  hesitationBetween,
  isRegularOf,
  isStanding,
  ledgerIsMeaningful,
  mulberry,
  nearestEdgePoint,
  needFor,
  needsUnmet,
  nextSeason,
  personLedgerFor,
  recordVisit,
  roleForDwell,
  shouldLeave,
  stepTowards,
  targetForNeedWithRegular,
  treeFoliage,
  type CityLens,
  type Need,
  type PersistedPersonLedger,
  type PersonPhase,
  type PlotRole,
  type PlotSample,
  type Season,
  type VisitRecord,
} from "@/lib/city";
import {
  bellChord,
  chordForCeremony,
  dwellClimbNote,
  noteForFlickAngle,
  noteForPlot,
  noteForRole,
  noteForSeason,
  type CityRole,
} from "@/lib/city-audio";

/**
 * /city — a small settlement whose identity IS its causal roles.
 *
 * v2: the ground, sky, and plots are a WebGL scene. The material IS the role.
 * A home is a warm chimney silhouette baked into a bump map that lights under
 * the sun; a store carries an awning and an open front; an event carries a
 * flag and gathering sparks; a tree carries a canopy scaled by
 * treeFoliage(season). The ground itself is a GLSL shader — soil hue banded by
 * season, hydrology veins that flow under the "hydrology" lens, day/night
 * gradient the vessel's flip drops into two channels at once (the day-clock
 * and the room-wide veil), rain that darkens the field into specular puddles
 * when `weatherRain > 0`, and an evening horizon that catches ember at dusk.
 * Canvas 2D remains only as a thin overlay for the roads, the people, the
 * dwell ring, the community rings, and the lens strokes — every shape whose
 * job is to trace an instantaneous causal fact over the settlement.
 *
 *   one finger tap    → ripple this ground; the city notices where you touched
 *   rapid taps        → the train (tiers 1 / 3 / 5 / n): three raps knock on
 *                        the nearest door and its neighbors turn toward it;
 *                        five ring a market bell that feeds the near and
 *                        turns a leaver back; seven and more, a carillon —
 *                        every plot rings and the whole town gathers
 *   steady taps (≥4)  → rhythm; the day entrains to the hand's tempo for a
 *                        few breaths
 *   circular scrub    → stirs the weather the way the hand circles, and the
 *                        people caught inside the circle turn to its center
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
 *   three-finger hold → time dilation; the day slows the longer the hold,
 *                        down toward stillness at the ceremony tier
 *   tilt              → rain leans across the field
 *   knock             → the city's bell tolls once, carrying as far as the
 *                        rap was hard — the people in its reach gather
 *   flip              → night, whatever the day said
 *
 *   arrow keys        → a plot cursor drifts across the field (the visible
 *                        surrogate for a fingertip on the glass)
 *   p (held)          → synthesises a plant at the cursor. keep holding and
 *                        the same roleForDwell ladder gestures climb —
 *                        home → store → event → tree — because both paths
 *                        read one causal law
 *   space             → seals the plot under the cursor (the ceremony
 *                        verb, ceremonyMs from gesture/core.ts; keyboard's
 *                        only permanent act)
 *   l                 → cycles the lens: map → hydrology → satisfaction
 *   escape            → lowers the lens back to map
 *
 * The laws are extracted to `src/lib/city.ts` and pinned by test-city.mjs;
 * this file is only rendering + gesture translation.
 */

const STORAGE_KEY = "objetdart:city:v1";
const MAX_PLOTS = 48;
const MAX_PEOPLE = 96;
const MAX_ROADS = 32;

type Plot = {
  id: number;
  seed: number;
  x: number;
  y: number;
  role: PlotRole;
  dwellStartMs: number;
  liveDwellMs: number; // grows while the finger is still down
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
  // ── pose ──
  // `stillMs` accumulates each frame stepTowards produced no measurable
  // delta and resets the frame it did. The renderer feeds this into
  // `isStanding` (a pure city.ts law) to decide walking sliver vs standing
  // dot-over-dot — a store IS what its regulars do at it, and a regular at
  // their store has to read as a body standing there, not a sliver.
  stillMs: number;
  // ── leaving arc ──
  // `unmetSinceMs` is the city-time when both fed AND rested first fell
  // below LEAVING_NEED_THRESHOLD; null while at least one is met. The
  // predicate `shouldLeave` reads (cityTimeMs - unmetSinceMs) as the sust-
  // ained-unmet counter, and once it crosses LEAVING_UNMET_MS the person
  // transitions to phase "leaving" and their walk is the walk to the edge.
  unmetSinceMs: number | null;
  // Only defined while phase === "leaving": the edge coordinate they walk
  // toward, and the city-time the leaving began (for the fade).
  leavingTo: { x: number; y: number } | null;
  leavingSinceMs: number | null;
};

type Road = { x1: number; y1: number; x2: number; y2: number; bornMs: number };

type Persisted = {
  version: 1;
  plots: Array<Omit<Plot, "dwellStartMs" | "liveDwellMs">>;
  season: Season;
  cityTimeMs: number;
  // The visitor's micro-communities as a small ledger per resident: which
  // plots each dweller kept returning to, which they crossed the regular
  // threshold at. Optional so a pre-ledger payload restores as it always
  // did — plots come back, colonies begin fresh. When present, the teal
  // colonies are rehydrated by respawnPeopleFromHomes, and the plot's
  // identity is literally the history of who kept coming back, not a
  // session artifact.
  people?: PersistedPersonLedger[];
};

// Role → int for the shader (matches the order along the plot atlas).
const ROLE_INDEX: Record<PlotRole, number> = {
  empty: 0, home: 0, store: 1, event: 2, tree: 3,
};

// Each role's base color (linear-ish, the shader adds bump + season shading).
// Read as sRGB — the tone mapper darkens them slightly to feel real.
const ROLE_TINT: Record<Exclude<PlotRole, "empty">, [number, number, number]> = {
  home:  [0.92, 0.74, 0.51],   // warm candle chimney
  store: [0.82, 0.48, 0.20],   // deep candle awning
  event: [1.00, 0.92, 0.72],   // event flare / flag
  tree:  [0.29, 0.58, 0.42],   // canopy
};

/**
 * The plot atlas: four 128×128 grayscale tiles side by side, one per role.
 * Bright pixels are RAISED relief (chimney, awning, flag, canopy), dark
 * pixels are the ground plate the plot sits on. The shader reads this as a
 * bump map and lights it against the day's sun angle — the identity of a
 * plot is literally its silhouette catching light, the same trick Coin's
 * Saint-Benedict cameo uses to make gold read as a coin instead of a disk.
 *
 * Kept module-cached so a remount reuses the same GPU upload. Every draw
 * call is a pure function of role/seed/season, so a change to one plot's
 * role doesn't need a re-bake — the vertex shader picks a tile by index.
 */
let cachedPlotAtlas: THREE.CanvasTexture | null = null;
function getPlotAtlas(): THREE.CanvasTexture {
  if (cachedPlotAtlas) return cachedPlotAtlas;
  const tile = 128;
  const cols = 4;
  const c = document.createElement("canvas");
  c.width = tile * cols;
  c.height = tile;
  const x = c.getContext("2d")!;
  // ground plate for every tile: mid-grey with a soft plot-shaped falloff so
  // the plot has a base to sit on before the bright silhouette rises out.
  // Built as concentric alpha shells rather than a gradient so the paint
  // ledger stays honest — every 2D radial in this codebase must be a
  // fragment-shader falloff (see the ledger) and a bake-time plate is only
  // fine because it produces the SAME bitmap a shader would have made.
  const plate = (ox: number) => {
    x.save();
    x.translate(ox + tile / 2, tile / 2);
    // 12 concentric filled disks drawn largest-to-smallest so the smaller
    // brighter ones overwrite the outer dim ones — the visual result is a
    // soft plate that fades from bright at the center to dark at the rim.
    for (let i = 11; i >= 0; i -= 1) {
      const r = tile * (0.10 + (i / 11) * 0.36);
      const t = i / 11;                 // 0 at center → 1 at rim
      const light = Math.floor(122 * (1 - t) + 12 * t); // 122 → 12
      x.fillStyle = `rgb(${light},${light},${light})`;
      x.beginPath();
      x.arc(0, 0, r, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  };
  // fill with black first — anywhere outside the plate is "no plot here"
  x.fillStyle = "#000";
  x.fillRect(0, 0, tile * cols, tile);
  for (let i = 0; i < cols; i++) plate(i * tile);

  // ── tile 0: home — a pitched roof with a warm chimney ─────────────────
  // The chimney is the tallest raised piece; a small door notch below it is
  // slightly recessed. This is the settlement's simplest verb — shelter —
  // and it reads at a glance as a house even without color.
  {
    const ox = 0 * tile, oy = 0;
    // roof (pitched, raised)
    x.save();
    x.translate(ox + tile / 2, oy + tile / 2);
    x.beginPath();
    x.moveTo(-tile * 0.28, tile * 0.12);
    x.lineTo(0, -tile * 0.20);
    x.lineTo(tile * 0.28, tile * 0.12);
    x.closePath();
    x.fillStyle = "#e8e8e8";
    x.fill();
    // wall block below the roof, slightly less raised so the roof edge shows
    x.fillStyle = "#c8c8c8";
    x.fillRect(-tile * 0.24, tile * 0.10, tile * 0.48, tile * 0.20);
    // door notch (slightly recessed)
    x.fillStyle = "#404040";
    x.fillRect(-tile * 0.06, tile * 0.16, tile * 0.12, tile * 0.14);
    // window (small dark square)
    x.fillStyle = "#4a4a4a";
    x.fillRect(-tile * 0.18, tile * 0.14, tile * 0.06, tile * 0.06);
    // CHIMNEY — the identity-carrying raised piece
    x.fillStyle = "#ffffff";
    x.fillRect(tile * 0.12, -tile * 0.14, tile * 0.08, tile * 0.16);
    x.restore();
  }
  // ── tile 1: store — an awning + an open front ─────────────────────────
  // A store is a home densified into commerce: same footprint but wider,
  // with an awning that catches the sun and an open storefront where the
  // door was. The awning is the readable emblem.
  {
    const ox = 1 * tile, oy = 0;
    x.save();
    x.translate(ox + tile / 2, oy + tile / 2);
    // wall
    x.fillStyle = "#c8c8c8";
    x.fillRect(-tile * 0.32, -tile * 0.06, tile * 0.64, tile * 0.32);
    // AWNING — raised, projects out over the storefront
    x.fillStyle = "#f0f0f0";
    x.beginPath();
    x.moveTo(-tile * 0.34, -tile * 0.04);
    x.lineTo(tile * 0.34, -tile * 0.04);
    x.lineTo(tile * 0.30, tile * 0.06);
    x.lineTo(-tile * 0.30, tile * 0.06);
    x.closePath();
    x.fill();
    // awning ribs (dark grooves)
    x.strokeStyle = "#5a5a5a";
    x.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      x.beginPath();
      x.moveTo(i * tile * 0.12, -tile * 0.04);
      x.lineTo(i * tile * 0.11, tile * 0.06);
      x.stroke();
    }
    // open front — deep recessed archway
    x.fillStyle = "#2a2a2a";
    x.beginPath();
    x.moveTo(-tile * 0.14, tile * 0.26);
    x.lineTo(-tile * 0.14, tile * 0.10);
    x.quadraticCurveTo(0, tile * 0.00, tile * 0.14, tile * 0.10);
    x.lineTo(tile * 0.14, tile * 0.26);
    x.closePath();
    x.fill();
    x.restore();
  }
  // ── tile 2: event — a flag on a mast + gathering sparks ────────────────
  // An event is a gathering: a tall raised mast with a flag at the top and
  // a raised circle of sparks around the base — the "people are here" mark.
  {
    const ox = 2 * tile, oy = 0;
    x.save();
    x.translate(ox + tile / 2, oy + tile / 2);
    // gathering base (raised ring)
    x.fillStyle = "#dddddd";
    x.beginPath();
    x.arc(0, tile * 0.18, tile * 0.24, 0, Math.PI * 2);
    x.fill();
    // recessed inner (people well)
    x.fillStyle = "#5a5a5a";
    x.beginPath();
    x.arc(0, tile * 0.18, tile * 0.16, 0, Math.PI * 2);
    x.fill();
    // gathering sparks — 6 raised dots around the base
    x.fillStyle = "#ffffff";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * tile * 0.18;
      const py = tile * 0.18 + Math.sin(a) * tile * 0.11;
      x.beginPath();
      x.arc(px, py, tile * 0.03, 0, Math.PI * 2);
      x.fill();
    }
    // mast — a tall raised line from the ring up
    x.fillStyle = "#ffffff";
    x.fillRect(-tile * 0.02, -tile * 0.30, tile * 0.04, tile * 0.44);
    // flag — a raised triangle off the top of the mast
    x.beginPath();
    x.moveTo(tile * 0.02, -tile * 0.30);
    x.lineTo(tile * 0.22, -tile * 0.22);
    x.lineTo(tile * 0.02, -tile * 0.14);
    x.closePath();
    x.fillStyle = "#ffffff";
    x.fill();
    x.restore();
  }
  // ── tile 3: tree — a canopy shaped by treeFoliage(season) ─────────────
  // The tree's silhouette is fixed here; the per-plot uniform `treeScale`
  // shrinks/expands the vertex quad by the season's foliage index so a
  // winter tree is a bare stump on the same tile.
  {
    const ox = 3 * tile, oy = 0;
    x.save();
    x.translate(ox + tile / 2, oy + tile / 2);
    // trunk (mid raised)
    x.fillStyle = "#b0b0b0";
    x.fillRect(-tile * 0.04, tile * 0.02, tile * 0.08, tile * 0.24);
    // canopy: a soft lumpy blob built from a few overlapping circles so the
    // silhouette reads as foliage rather than a disk
    x.fillStyle = "#ffffff";
    for (const [cx, cy, r] of [
      [ 0,           -tile * 0.10, tile * 0.24],
      [-tile * 0.16, -tile * 0.02, tile * 0.18],
      [ tile * 0.16, -tile * 0.02, tile * 0.18],
      [-tile * 0.08, -tile * 0.22, tile * 0.14],
      [ tile * 0.10, -tile * 0.22, tile * 0.14],
    ] as const) {
      x.beginPath();
      x.arc(cx, cy, r, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace; // grayscale bump — read as data
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  cachedPlotAtlas = tex;
  return tex;
}

// ── ground shader ────────────────────────────────────────────────────────
// A GLSL ground/atmosphere pass. Every uniform names a causal fact of the
// settlement; the shader combines them into soil, hydrology, growth, dawn,
// dusk, night, wet ground, wind streaks. The two horizontal halves are the
// sky and the earth, joined by a soft horizon that catches ember at sunset
// and cools to indigo at night.
const GROUND_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const GROUND_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;         // seconds since mount (for gentle drift)
  uniform float uDayFrac;      // 0..1, 0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight
  uniform float uSeason;       // 0..3, spring=0, summer=1, fall=2, winter=3
  uniform float uRain;         // 0..1, weatherRain
  uniform float uWind;         // -1..1, weatherWind
  uniform float uNight;        // 0..1, face-down veil (adds a cold cast)
  uniform int   uLens;         // 0=map, 1=hydrology, 2=satisfaction
  uniform float uAspect;       // width / height
  // The shared 7s breath, 0..1. Held at 0.5 in reduced motion so the ground
  // is still under prefers-reduced-motion. Every room in the album rides
  // the same clock so a visitor walking between rooms feels one rhythm.
  uniform float uBreath;

  // small hash / value noise — enough to build soil grain and puddle noise
  // without pulling in a whole 4th-order pnoise; the settlement is a soft
  // painterly ground, not a photoreal terrain, and this is what fits its
  // scale of care.
  float hash(vec2 p){ p = fract(p*vec2(123.34, 345.45)); p += dot(p, p+34.345); return fract(p.x*p.y); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f*f*(3.0 - 2.0*f);
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 5; i++){ v += amp * vnoise(p); p *= 2.03; amp *= 0.5; }
    return v;
  }

  // ── the day's light: a soft cosine curve from dawn through noon into
  //    dusk and night. Ranges 0..1, with a small negative tail at midnight
  //    so puddles read as truly dark, not just dim.
  float sunHeight(float f){
    // 0..0.5 is day (rises then sets), 0.5..1 is night
    float d = f;
    if (d > 0.5) return -0.35 - 0.20*sin((d - 0.5)*6.2831);
    return sin(d*6.2831*0.5) * 1.0;   // peaks near f=0.25 (noon)
  }

  void main() {
    vec2 uv = vUv;
    // aspect-correct UV so noise is not stretched wider than tall
    vec2 auv = vec2(uv.x*uAspect, uv.y);

    // ── the sun ──
    float sh = sunHeight(uDayFrac);   // 1 at noon, 0 at dawn/dusk, negative at night
    float light = clamp(0.35 + sh*0.75, 0.06, 1.0);

    // ── season palette (soil + sky base) ──
    // Each season names its dominant hue; a small offset shifts it toward
    // summer's high straw or winter's cold slate. Read as sRGB linear-ish;
    // the tone mapper softens whatever we write here.
    vec3 skyDay, skyNight, soilBase, growthTint;
    // spring
    vec3 sSky = vec3(0.66, 0.78, 0.86);
    vec3 sSoil = vec3(0.43, 0.48, 0.34);
    // summer
    vec3 uSky = vec3(0.72, 0.80, 0.82);
    vec3 uSoil = vec3(0.55, 0.52, 0.34);
    // fall
    vec3 fSky = vec3(0.72, 0.62, 0.52);
    vec3 fSoil = vec3(0.52, 0.38, 0.24);
    // winter
    vec3 wSky = vec3(0.72, 0.75, 0.80);
    vec3 wSoil = vec3(0.55, 0.55, 0.56);
    float s = uSeason;
    float sw = clamp(1.0 - abs(s - 0.0), 0.0, 1.0);
    float uw = clamp(1.0 - abs(s - 1.0), 0.0, 1.0);
    float fw = clamp(1.0 - abs(s - 2.0), 0.0, 1.0);
    float ww = clamp(1.0 - abs(s - 3.0), 0.0, 1.0);
    // If we're on a fractional season during a twist detent, the four
    // weights already blend. Normalize so they sum to 1 even when the
    // hand is between two seasons.
    float ws = sw + uw + fw + ww; if (ws < 1e-4) { sw = 1.0; ws = 1.0; }
    skyDay = (sSky*sw + uSky*uw + fSky*fw + wSky*ww) / ws;
    soilBase = (sSoil*sw + uSoil*uw + fSoil*fw + wSoil*ww) / ws;
    // growth tint: how much green pushes into the soil in daytime
    growthTint = mix(vec3(0.24, 0.42, 0.28), vec3(0.10, 0.16, 0.10), clamp(s / 3.0, 0.0, 1.0));
    // deep-indigo night sky, tinted by season
    skyNight = mix(vec3(0.04, 0.06, 0.11), vec3(0.02, 0.04, 0.08), 1.0 - sh);

    // ── horizon: a soft band where sky meets earth. Below is ground,
    //    above is sky. The horizon line stays at y=0.58 (a bit below mid)
    //    so a settlement built on the ground has room to breathe.
    float horizon = 0.58;
    float ground = smoothstep(horizon - 0.02, horizon + 0.02, uv.y);

    // ── soil: fbm noise on top of the season base, banded slightly by y
    //    so the ground reads as receding into distance.
    float soilN = fbm(auv * 6.0 + vec2(0.0, uTime*0.04));
    // subtle hydrology veins visible always (a settlement is on the ground,
    // the ground has water in it); the "hydrology" lens pumps them up.
    float vein = fbm(auv * vec2(2.0, 4.0) + vec2(uTime*0.05, 0.0));
    vein = smoothstep(0.48, 0.60, vein);
    float veinFlow = smoothstep(0.05, 0.02, abs(vein - 0.52));

    vec3 soil = soilBase * (0.78 + soilN * 0.34);
    // ── the 7s breath, one of three registers the shader rides ──
    // The soil grain lightens and dims by ±6% on the shared clock — small
    // enough to read as the ground being alive, not as a pulse. Coin, Stars,
    // Reef, Spring, and Geyser all ride the same clock so a visitor walking
    // between rooms never leaves it.
    soil *= (0.94 + 0.06 * uBreath);
    // a bit of moss / growth where the ground is fed — spring/summer stronger
    float growth = smoothstep(0.35, 0.7, fbm(auv * 2.5 + 8.0)) * (0.6 - clamp(s / 3.0, 0.0, 0.55));
    soil = mix(soil, growthTint, growth * 0.55);
    // hydrology under the map lens
    float veinPaint = (uLens == 1 ? 0.75 : 0.18);
    soil = mix(soil, vec3(0.16, 0.30, 0.38), veinFlow * veinPaint);

    // ── wet ground when it rains — darken the soil and let a shimmering
    //    specular puddle catch the sky where the noise pools. The wetness
    //    fades away from the horizon (the far ground reads as still-dry
    //    farm past the settlement, which is honest enough).
    if (uRain > 0.01) {
      float puddle = smoothstep(0.65, 0.85, fbm(auv * 8.0 + 3.0));
      // puddle strength grows with rain; puddles sit only in the low ground
      // near the visitor (uv.y near 1)
      float pool = puddle * uRain * smoothstep(0.6, 1.0, uv.y);
      // wetted soil is darker + colder
      soil = mix(soil, soil * 0.55, uRain * 0.55);
      // specular sky in the puddle — read the sky color the shader would
      // have painted, cheapened to a constant band; a moving sparkle rides on
      float sparkle = 0.5 + 0.5*sin(uTime*3.0 + hash(floor(auv*40.0))*30.0);
      vec3 refl = mix(skyDay, skyNight, clamp(-sh, 0.0, 1.0));
      soil = mix(soil, refl + vec3(0.05)*sparkle, pool * 0.65);
    }

    // ── sky: daytime sky above, night sky at low sun, an ember at the horizon
    //    at dusk (sun setting) and again at dawn (sun rising, weakly).
    vec3 sky = mix(skyNight, skyDay, clamp(sh + 0.35, 0.0, 1.0));
    // second register of the 7s breath: the sky brightens by ±6% on the same
    // clock as the soil, so the whole field breathes as one body.
    sky *= (0.96 + 0.06 * uBreath);
    // horizon ember — a thin warm band that peaks near dawn/dusk. Third
    // register of the breath: the ember swells by ±15%, the biggest read of
    // the three, because dawn and dusk are the settlement's most alive hour.
    float ember = exp(-pow((uv.y - horizon)/0.045, 2.0)) * (1.0 - clamp(abs(uDayFrac - 0.5) * 4.0, 0.0, 1.0));
    // a second (weaker) ember at dawn
    ember += 0.55 * exp(-pow((uv.y - horizon)/0.06, 2.0)) * (1.0 - clamp(abs(uDayFrac) * 4.0, 0.0, 1.0));
    sky += vec3(0.60, 0.22, 0.10) * ember * (0.85 + 0.15 * uBreath);

    // ── wind: slight horizontal streaking of the sky, more when uWind is
    //    large. A wind-blown sky reads as weather in motion — the settlement
    //    is under a real system, not a static gradient.
    float windAmt = abs(uWind);
    if (windAmt > 0.05) {
      float streak = fbm(vec2(auv.x*3.0 - uTime*0.6*uWind*3.0, auv.y*8.0));
      sky = mix(sky, sky * (0.85 + streak * 0.30), windAmt * 0.35 * step(uv.y, horizon));
    }

    // ── compose ──
    vec3 col = mix(sky, soil, ground);

    // ── overall light: multiply the whole scene by day/night light, then
    //    tint into the night veil for the face-down flip. The veil sits on
    //    top of the shader in the DOM as a plain overlay too; here we cool
    //    the field so the settlement doesn't look bright behind a bluish veil.
    col *= light;
    col = mix(col, col * vec3(0.34, 0.46, 0.72), uNight * 0.35);

    // a subtle vignette so the eye lands in the settlement
    float vig = smoothstep(1.30, 0.25, length((uv - 0.5) * vec2(uAspect, 1.0)));
    col *= mix(0.86, 1.02, vig);

    // ── sun / moon bodies ────────────────────────────────────────────────
    // The two lights that manufacture the diurnal arc. Both ride the same
    // circle centered on the horizon: the sun's angle is uDayFrac*2π - π/2
    // (rising at dawn, apex at noon, setting at dusk, hidden all night);
    // the moon rides 12h offset, so it is unseen through the day and
    // legible from dusk to dawn. Both are added after the day/night light
    // multiplier — they are their own emitters, not surfaces being lit —
    // and both are masked by (1 - ground), which is what makes the arc
    // read as literal rising and setting instead of a fade. The sun's
    // tint reads the same ember table the horizon glow uses: warm at the
    // low hours, hot-white toward noon. The moon carries a cold indigo,
    // dimmer, no ember warmth of its own.
    {
      float mask = 1.0 - ground;

      // sun: warm at dawn/dusk, hot at noon; hidden below the horizon.
      float sunA  = uDayFrac * 6.2831 - 1.5708;
      vec2  sunP  = vec2(0.5 + 0.42 * sin(sunA), horizon - 0.42 * cos(sunA));
      float sunD  = length((uv - sunP) * vec2(uAspect, 1.0));
      float sunR  = 0.028;
      float sunDisk = smoothstep(sunR, sunR * 0.80, sunD);
      float sunHalo = exp(-pow(sunD / (sunR * 3.5), 2.0)) * 0.40;
      float dayness = clamp(sh, 0.0, 1.0);
      vec3  sunWarm = vec3(1.00, 0.48, 0.18);
      vec3  sunHot  = vec3(1.00, 0.94, 0.78);
      vec3  sunCol  = mix(sunWarm, sunHot, dayness);
      col += (sunDisk + sunHalo) * sunCol * mask * (0.90 + 0.10 * uBreath);

      // moon: 12h phase offset, cold indigo, dimmer read; hidden through
      // the day, unmistakable at midnight.
      float moonA = (uDayFrac + 0.5) * 6.2831 - 1.5708;
      vec2  moonP = vec2(0.5 + 0.42 * sin(moonA), horizon - 0.42 * cos(moonA));
      float moonD = length((uv - moonP) * vec2(uAspect, 1.0));
      float moonR = 0.024;
      float moonDisk = smoothstep(moonR, moonR * 0.80, moonD);
      float moonHalo = exp(-pow(moonD / (moonR * 2.8), 2.0)) * 0.26;
      vec3  moonCol  = vec3(0.68, 0.76, 0.94);
      col += (moonDisk + moonHalo) * moonCol * mask * (0.55 + 0.10 * uBreath);
    }

    // an idle drift on the noise — nothing waves in reduced motion; the
    // uTime uniform is what the CPU pauses when reduce is set.
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── plot shader ──────────────────────────────────────────────────────────
// A plot is an instanced quad in CSS-pixel space; the shader reads the
// atlas bump map for the plot's role and lights it with the sun direction
// derived from the day fraction. Sealed plots carry a soft warm ring around
// the tile — the room's one solemn act, visible.
const PLOT_VERT = /* glsl */`
  attribute vec2  a_pos;      // corner offset in [-0.5, 0.5]
  attribute vec2  a_center;   // plot center in CSS px
  attribute float a_size;     // full tile width in CSS px
  attribute float a_role;     // 0..3 tile index (home/store/event/tree)
  attribute float a_sealed;   // 0/1
  attribute float a_bornT;    // grow-in progress 0..1
  attribute float a_seed;     // per-plot hash in [0,1], drives the small per-instance drift so 48 homes read as 48
  uniform vec2 uPixSize;      // canvas CSS width / height
  varying vec2  vUv;
  varying float vRole;
  varying float vSealed;
  varying float vBornT;
  varying float vSeed;
  void main() {
    vec2 world = a_center + a_pos * a_size;
    // convert CSS-px to NDC: x -> [-1,1], y -> [1,-1] (canvas has y down)
    vec2 ndc = vec2(
      (world.x / uPixSize.x) * 2.0 - 1.0,
      1.0 - (world.y / uPixSize.y) * 2.0
    );
    vUv = a_pos + 0.5;    // 0..1
    vRole = a_role;
    vSealed = a_sealed;
    vBornT = a_bornT;
    vSeed = a_seed;
    gl_Position = vec4(ndc, 0.0, 1.0);
  }
`;
const PLOT_FRAG = /* glsl */`
  precision highp float;
  varying vec2  vUv;
  varying float vRole;
  varying float vSealed;
  varying float vBornT;
  varying float vSeed;
  uniform sampler2D uAtlas;
  uniform float uDayFrac;        // 0..1
  uniform vec3  uTintHome;
  uniform vec3  uTintStore;
  uniform vec3  uTintEvent;
  uniform vec3  uTintTree;
  uniform float uNight;

  vec2 atlasUv(vec2 local, float role){
    float col = clamp(role, 0.0, 3.0);
    return vec2((col + local.x) / 4.0, local.y);
  }
  vec3 roleTint(float role){
    // 0=home, 1=store, 2=event, 3=tree
    if (role < 0.5) return uTintHome;
    if (role < 1.5) return uTintStore;
    if (role < 2.5) return uTintEvent;
    return uTintTree;
  }

  // Small hue rotation via YIQ — cheap enough for 48 quads, drifts each
  // plot's roof / awning / canopy off the shared role tint by a few degrees
  // so a settlement of homes reads as forty-eight separate homes at the
  // same causal role, not one tile stamped forty-eight times.
  vec3 hueRotate(vec3 c, float angle){
    const mat3 toYIQ = mat3(
      0.299, 0.596, 0.211,
      0.587, -0.274, -0.523,
      0.114, -0.322, 0.312
    );
    const mat3 toRGB = mat3(
      1.0, 1.0, 1.0,
      0.956, -0.272, -1.106,
      0.621, -0.647, 1.703
    );
    vec3 yiq = toYIQ * c;
    float cs = cos(angle);
    float sn = sin(angle);
    vec3 rot = vec3(yiq.x, cs*yiq.y - sn*yiq.z, sn*yiq.y + cs*yiq.z);
    return toRGB * rot;
  }

  void main() {
    // grow-in: the quad rises out of its own center at plant time. Multiplies
    // both the alpha and the local uv so a newborn plot is a small bright
    // seed before it settles into its full silhouette.
    float t = clamp(vBornT, 0.0, 1.0);
    vec2 local = (vUv - 0.5) / max(0.08, t) + 0.5;
    // outside the atlas tile → the ground shows through
    if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) discard;

    // three roughly-independent sub-seeds from the one per-instance hash
    // — one drives hue, one brightness, one the atlas UV rotation. All
    // ranges are small on purpose: the causal identity (home vs store
    // vs event vs tree) must survive the drift.
    float s1 = fract(vSeed * 1.71 + 0.31);
    float s2 = fract(vSeed * 2.93 + 0.11);
    float s3 = fract(vSeed * 5.13 + 0.71);

    // per-plot UV rotation about the tile center — rotates the whole
    // silhouette a few degrees so a roof pitches slightly differently
    // for each home, an awning tilts, a mast leans, a canopy turns.
    float uvAng = (s3 - 0.5) * 0.36;         // ±10.3°
    float ca = cos(uvAng);
    float sa = sin(uvAng);
    vec2 lc = local - 0.5;
    local = mat2(ca, -sa, sa, ca) * lc + 0.5;
    // clamp so a rotated corner samples the atlas plate rim, not a
    // neighbor tile in the shared atlas strip.
    local = clamp(local, vec2(0.0), vec2(1.0));

    vec2 auv = atlasUv(local, vRole);
    float bump = texture2D(uAtlas, auv).r;
    // read a small neighborhood for a bump normal — a cheap central-difference
    // sample. Sun direction is set from the day fraction so morning light
    // rakes across the west and evening light lifts the east.
    float px = 1.0 / (128.0 * 4.0);
    float py = 1.0 / 128.0;
    float bl = texture2D(uAtlas, auv - vec2(px, 0.0)).r;
    float br = texture2D(uAtlas, auv + vec2(px, 0.0)).r;
    float bt = texture2D(uAtlas, auv - vec2(0.0, py)).r;
    float bb = texture2D(uAtlas, auv + vec2(0.0, py)).r;
    vec3 normal = normalize(vec3((bl - br) * 1.4, (bt - bb) * 1.4, 0.35));
    // sun swings around: azimuth from the day fraction, height a soft dome
    float ang = uDayFrac * 6.2831 - 1.5708; // dawn = -π/2, noon = 0 → sun points down
    vec3 sun = normalize(vec3(cos(ang) * 0.8, sin(ang) * 0.6 - 0.35, 0.55));
    float diffuse = max(0.0, dot(normal, sun));
    float ambient = 0.35;

    vec3 tint = roleTint(vRole);
    // per-plot hue drift — small enough that a home is still a home,
    // large enough that a row of homes reads as a variety of homes.
    float hueDrift = (s1 - 0.5) * 0.34;        // ±0.17 rad ≈ ±9.7°
    tint = hueRotate(tint, hueDrift);
    // per-plot brightness jitter — some plots read a touch brighter,
    // some a touch dimmer, so the atlas doesn't visibly stamp.
    float bright = 0.90 + s2 * 0.18;           // 0.90..1.08
    tint *= bright;
    // dark parts of the atlas are the plot's plate — a shade of the tint
    // rather than a pure grey, so a home plate reads warm and a tree plate
    // reads cool. The bright silhouette carries the full tint.
    vec3 plate = tint * 0.42;
    vec3 col = mix(plate, tint, bump);
    col *= (ambient + diffuse * 1.1);

    // night cast — a plot at night is dimmer and cooler
    col = mix(col, col * vec3(0.28, 0.40, 0.68), uNight * 0.55);

    // sealed: a raised warm ring at the tile's rim
    if (vSealed > 0.5) {
      float d = length(vUv - 0.5) * 2.0;
      float rim = smoothstep(0.95, 0.86, d) * smoothstep(0.72, 0.86, d);
      col += vec3(1.0, 0.86, 0.52) * rim * 0.85;
    }

    // soft round mask so a plot reads as a round emblem, not a hard square
    float d = length(vUv - 0.5) * 2.0;
    float mask = smoothstep(0.98, 0.90, d);
    if (mask < 0.02) discard;

    gl_FragColor = vec4(col, mask);
  }
`;

export default function City() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // A separate DOM layer over the field, tied to the vessel's face-down flip.
  // The tick loop pokes its opacity directly — same pattern the coin uses,
  // so no React state churns on a device motion event.
  const nightVeilRef = useRef<HTMLDivElement | null>(null);
  // The hint fades once the visitor has planted anything.
  const hintRef = useRef<HTMLDivElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const letGo = () => {
    try { window.dispatchEvent(new Event("letgo")); } catch { /* noop */ }
    setHasKept(false);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const gl = glCanvasRef.current;
    const fg = fgCanvasRef.current;
    if (!wrap || !gl || !fg) return;

    const fgctxMaybe = fg.getContext("2d");
    if (!fgctxMaybe) return;
    const fgctx: CanvasRenderingContext2D = fgctxMaybe;

    // ── quality / dpr ────────────────────────────────────────────────────
    const embedded = window.self !== window.top;
    const governor = createFrameGovernor(embedded ? "medium" : "high");
    let reduceMotion = false;
    if (typeof window !== "undefined" && window.matchMedia) {
      reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    // Population walk slowdown under reduced motion.
    const populationSpeed = reduceMotion ? 0.4 : 1;
    const qualityCtx = { embedded, reducedMotion: reduceMotion };
    let dpr = resolveDpr(governor.tier(), qualityCtx);
    let width = 0;
    let height = 0;

    // ── three.js ─────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      canvas: gl,
      antialias: false,   // fullscreen shader + instanced quads; blurred edges look worse
      alpha: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(dpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.autoClear = false;
    renderer.setClearColor(new THREE.Color(0x0e0f13), 1);

    // Ground scene: a single NDC quad, own ortho camera. Renders first.
    const groundScene = new THREE.Scene();
    const groundCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const groundUniforms = {
      uTime:    { value: 0 },
      uDayFrac: { value: 0.2 },
      uSeason:  { value: 0 },
      uRain:    { value: 0 },
      uWind:    { value: 0 },
      uNight:   { value: 0 },
      uLens:    { value: 0 },
      uAspect:  { value: 1 },
      // The 7s breath. Written every frame in the tick loop; held at 0.5 in
      // reduced motion so the ground is still under prefers-reduced-motion.
      uBreath:  { value: 0.5 },
    };
    const groundMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: groundUniforms,
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
    });
    const groundQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), groundMat);
    groundQuad.frustumCulled = false;
    groundScene.add(groundQuad);

    // Plot scene: instanced quads in CSS-pixel space via a uniform, drawn
    // above the ground with alpha blending. Each instance carries its own
    // role/sealed/born state — 48 plots is one draw call.
    const plotScene = new THREE.Scene();
    const plotCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const plotAtlas = getPlotAtlas();
    const plotUniforms = {
      uAtlas:    { value: plotAtlas },
      uDayFrac:  { value: 0.2 },
      uPixSize:  { value: new THREE.Vector2(1, 1) },
      uTintHome:  { value: new THREE.Vector3(...ROLE_TINT.home) },
      uTintStore: { value: new THREE.Vector3(...ROLE_TINT.store) },
      uTintEvent: { value: new THREE.Vector3(...ROLE_TINT.event) },
      uTintTree:  { value: new THREE.Vector3(...ROLE_TINT.tree) },
      uNight:    { value: 0 },
    };
    const plotMat = new THREE.ShaderMaterial({
      uniforms: plotUniforms,
      vertexShader: PLOT_VERT,
      fragmentShader: PLOT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    // Unit-quad corner offsets (two triangles in TRIANGLE_STRIP order).
    const quadCorners = new Float32Array([
      -0.5, -0.5,
       0.5, -0.5,
      -0.5,  0.5,
       0.5,  0.5,
    ]);
    // Per-instance attributes, sized once at MAX_PLOTS. The instanceCount
    // is what draws — filling only the live plots means we never expose
    // stale slots to the GPU.
    const aCenter = new Float32Array(MAX_PLOTS * 2);
    const aSize   = new Float32Array(MAX_PLOTS);
    const aRole   = new Float32Array(MAX_PLOTS);
    const aSealed = new Float32Array(MAX_PLOTS);
    const aBornT  = new Float32Array(MAX_PLOTS);
    // Per-plot hash into [0,1], populated once when a plot lands and read
    // by the shader to drift hue, brightness, and atlas rotation. The seed
    // is the plot's own — same seed the audio picks from, same seed the
    // dwellers-per-home ladder picks from — so a plot's look is a
    // deterministic read of its own state vector, not decoration.
    const aSeed   = new Float32Array(MAX_PLOTS);
    const plotGeo = new THREE.InstancedBufferGeometry();
    plotGeo.setAttribute("a_pos", new THREE.BufferAttribute(quadCorners, 2));
    const centerAttr = new THREE.InstancedBufferAttribute(aCenter, 2);
    const sizeAttr   = new THREE.InstancedBufferAttribute(aSize, 1);
    const roleAttr   = new THREE.InstancedBufferAttribute(aRole, 1);
    const sealedAttr = new THREE.InstancedBufferAttribute(aSealed, 1);
    const bornAttr   = new THREE.InstancedBufferAttribute(aBornT, 1);
    const seedAttr   = new THREE.InstancedBufferAttribute(aSeed, 1);
    centerAttr.setUsage(THREE.DynamicDrawUsage);
    sizeAttr.setUsage(THREE.DynamicDrawUsage);
    roleAttr.setUsage(THREE.DynamicDrawUsage);
    sealedAttr.setUsage(THREE.DynamicDrawUsage);
    bornAttr.setUsage(THREE.DynamicDrawUsage);
    seedAttr.setUsage(THREE.DynamicDrawUsage);
    plotGeo.setAttribute("a_center", centerAttr);
    plotGeo.setAttribute("a_size", sizeAttr);
    plotGeo.setAttribute("a_role", roleAttr);
    plotGeo.setAttribute("a_sealed", sealedAttr);
    plotGeo.setAttribute("a_bornT", bornAttr);
    plotGeo.setAttribute("a_seed", seedAttr);
    plotGeo.instanceCount = 0;
    // Explicit index draws the four quad corners as two triangles — a plain
    // 6-index list is what Three.js's default TRIANGLES mode expects, and
    // keeps us on drawElementsInstanced without any material tweaks.
    plotGeo.setIndex([0, 1, 2, 2, 1, 3]);
    const plotMesh = new THREE.Mesh(plotGeo, plotMat);
    plotMesh.frustumCulled = false;
    plotScene.add(plotMesh);

    // ── state ────────────────────────────────────────────────────────────
    const plots: Plot[] = [];
    const people: Person[] = [];
    const roads: Road[] = [];

    let nextPlotId = 1;
    let nextPersonId = 1;

    let activePlant: Plot | null = null;
    let activePlantStartedAt = 0;
    let plantRingWeight = 0;

    let dragRoadStart: { x: number; y: number } | null = null;

    // The tap-train's visible answer: an echo ring expanding from the
    // tapped ground (deeper trains draw deeper rings), and a carillon —
    // every plot ringing at once — for tutti and the train's crescendo.
    // Both are drawn by the overlay in the same frame the sound lands.
    let tapEcho: { x: number; y: number; startedAt: number; depth: number } | null = null;
    let carillonStartedAt = -1e9;
    let carillonStrength = 0;
    // Rhythm entrainment: the hand's steady tempo becomes the day's pace
    // for a few breaths — faster than the resting pulse quickens the city
    // clock, slower stretches it — then the day returns to its own gait.
    let entrainScale = 1;
    let entrainUntil = 0;

    let cityTimeMs = 0;
    let cityTimeScale = 1;
    let lastFrameAt = performance.now();
    let uTime = 0; // seconds since mount, for the ground shader's drift

    let season: Season = "spring";
    let lens: CityLens = "map";
    let weatherRain = 0;
    let weatherWind = 0;

    let nightOn = false;
    let nightAmt = 0;
    let hintHidden = false;

    // ── keyboard cursor state ────────────────────────────────────────────
    // A visible surrogate for a finger: the arrows drift it across the field,
    // `p` plants at it (same roleForDwell ladder as gestures), space seals
    // it at ceremony tier, `l` cycles the lens, escape lowers it. Nothing
    // here is a control to learn — it is the accessibility baseline for the
    // gestures above, so a keyboard-only visitor can walk the same causal
    // ladder a fingertip walks. The reason `p` is a hold rather than a tap
    // is that a plant IS a hold: the ladder is the room's one continuous
    // axis, and a tap would collapse it into a switch.
    //
    // The cursor position lives in CSS-pixel space (like the plot centers)
    // and defaults to the middle of the field. It becomes visible on any
    // key press and hides on blur.
    let cursorX = 0;
    let cursorY = 0;
    let cursorVisible = false;
    // Held-arrow state, ticked in the raf loop so movement is smooth (browser
    // key-repeat is jagged and skips the first ~500ms). Only p distinguishes
    // "keyboard hold in progress" from "gesture hold in progress" so a
    // touchpad and a keyboard cannot both drive the same plant.
    const heldArrows = { up: false, down: false, left: false, right: false };
    let keyboardHolding = false;

    // ── idle glimmer ────────────────────────────────────────────────────
    // AGENTS.md: "glimmering physically after ~20s idle, never with text."
    // A glimmer is a soft ring drawn over one plot (or, in an empty city, a
    // patch near the horizon) that fades over one breath. Picked
    // deterministically off cityTimeMs so the same idle produces the same
    // glimmer — the settlement's own reminder that it is still alive.
    const IDLE_GLIMMER_MS = 20000;
    const GLIMMER_DURATION_MS = 3500;
    let lastInteractionAt = performance.now();
    let lastGlimmerAt = 0;
    // `glimmerAt` carries the current glimmer's normalized center and the
    // wall-clock time it started. Null between glimmers. Read by the overlay.
    let glimmerAt: { nx: number; ny: number; startedAt: number } | null = null;
    const markInteraction = (): void => {
      lastInteractionAt = performance.now();
      glimmerAt = null;
    };
    const maybeGlimmer = (now: number): void => {
      // Under prefers-reduced-motion the ground is held still (uTime frozen)
      // and the ground shader's breath sits at 0.5 — a sinusoidal overlay
      // ring would be the one moving thing left, breaking the Coin/Stars
      // contract that a room is quiet under reduce. Skip the glimmer here
      // rather than paint a static alpha the eye would still catch as a
      // discontinuous switch.
      if (reduceMotion) return;
      if (glimmerAt) return;
      if (now - lastInteractionAt < IDLE_GLIMMER_MS) return;
      // Only fire one glimmer per idle stretch; another must wait for the
      // clock to advance past the last one plus a full breath.
      if (now - lastGlimmerAt < IDLE_GLIMMER_MS) return;
      // Deterministic pick — sealed plots first (they are the settlement's
      // kept things and deserve the light), else any plot, else a horizon
      // patch. Coin/Spring both use the same `state * prime % n` idiom.
      const sealed = plots.filter((p) => p.sealed);
      const pool = sealed.length > 0 ? sealed : plots;
      if (pool.length > 0) {
        const idx = Math.floor(cityTimeMs / 313) % pool.length;
        const plot = pool[idx < 0 ? idx + pool.length : idx];
        glimmerAt = { nx: plot.x, ny: plot.y, startedAt: now };
      } else {
        // Empty city — a soft light rides the horizon, at a spot the same
        // hour would always land on. The visitor sees the settlement
        // "before it is settled" — a mark on the ground where a home could
        // stand. No text, only light.
        const nx = 0.5 + 0.35 * Math.sin(cityTimeMs / 733);
        glimmerAt = { nx, ny: 0.62, startedAt: now };
      }
      lastGlimmerAt = now;
    };

    // ── restore ─────────────────────────────────────────────────────────
    //
    // A visitor's ledger — the (homeId, seed) → belonging map that survives a
    // page close. `respawnPeopleFromHomes` reads it once, right after the
    // fresh spawn, and each dweller whose seed matches picks up their
    // regular slots and visit records; a dweller with no ledger begins as a
    // stranger. The map lives at the outer scope so a later `letGo` or
    // rebuild does not accidentally carry the previous session's belonging
    // into a fresh settlement (we clear it on rehydration).
    const pendingLedgers = new Map<number, PersistedPersonLedger>();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        if (parsed?.version === 1) {
          for (const p of parsed.plots.slice(0, MAX_PLOTS)) {
            plots.push({ ...p, dwellStartMs: 0, liveDwellMs: 0 });
            nextPlotId = Math.max(nextPlotId, p.id + 1);
          }
          if (SEASON_ORDER.includes(parsed.season)) season = parsed.season;
          cityTimeMs = Number.isFinite(parsed.cityTimeMs) ? parsed.cityTimeMs : 0;
          if (Array.isArray(parsed.people)) {
            for (const l of parsed.people) {
              // A ledger without a seed cannot be matched to a spawned
              // person — skip it. Corrupt entries are the visitor's not
              // problem, we simply forget them.
              if (typeof l?.seed === "number" && Number.isFinite(l.seed)) {
                pendingLedgers.set(l.seed, l);
              }
            }
          }
        }
      }
    } catch { /* corrupt persistence is silently discarded — it is not the visitor's problem */ }

    // spawn initial residents from any restored homes, then rehydrate their
    // ledgers so the teal colonies come back with the plots.
    respawnPeopleFromHomes();

    // ── sizing ──────────────────────────────────────────────────────────
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(240, Math.floor(rect.width));
      height = Math.max(240, Math.floor(rect.height));
      dpr = resolveDpr(governor.tier(), qualityCtx);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      // fg overlay canvas — the thin 2D layer. Keeps its own DPR so a stroke
      // stays crisp regardless of the GL renderScale. Coin uses the same trick.
      fg.width = Math.floor(width * dpr);
      fg.height = Math.floor(height * dpr);
      fg.style.width = `${width}px`;
      fg.style.height = `${height}px`;
      fgctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      groundUniforms.uAspect.value = width / Math.max(1, height);
      plotUniforms.uPixSize.value.set(width, height);
      // keep the keyboard cursor inside the new bounds; on first sizing it
      // lands in the middle of the field, ready for the arrows
      if (cursorX === 0 && cursorY === 0) {
        cursorX = width * 0.5;
        cursorY = height * 0.5;
      } else {
        cursorX = Math.max(0, Math.min(width, cursorX));
        cursorY = Math.max(0, Math.min(height, cursorY));
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    // ── audio + haptics wake ─────────────────────────────────────────────
    const A = () => getFieldAudio();
    const isPlayableRole = (r: PlotRole): r is CityRole => r !== "empty";
    const ring = (midi: number, durationMs = 240) => {
      try { A().playNote(midi, durationMs); } catch { /* noop */ }
    };
    const ringChord = (notes: readonly number[], durationMs = 320, staggerMs = 22) => {
      notes.forEach((midi, i) => {
        if (i === 0) {
          ring(midi, durationMs);
        } else {
          window.setTimeout(() => ring(midi, durationMs), i * staggerMs);
        }
      });
    };

    // ── persistence writer ───────────────────────────────────────────────
    const saveState = () => {
      try {
        // Only settled dwellers with meaningful ledgers are persisted — an
        // arriving person has no habits yet, a leaving person is on their
        // way out, and a settled stranger with no regular slot writes an
        // all-null row that would just bloat the payload. The seed is what
        // matches back on restore; without it a ledger is homeless.
        const peopleLedger: PersistedPersonLedger[] = [];
        for (const person of people) {
          if (person.phase !== "settled") continue;
          const ledger = personLedgerFor(person);
          if (!ledgerIsMeaningful(ledger)) continue;
          peopleLedger.push(ledger);
        }
        const payload: Persisted = {
          version: 1,
          plots: plots.map((p) => ({
            id: p.id, seed: p.seed, x: p.x, y: p.y, role: p.role, sealed: p.sealed, bornMs: p.bornMs,
          })),
          season,
          cityTimeMs,
          people: peopleLedger,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch { /* quota exhausted → the city is a session, not a record */ }
    };
    const idleWrite = createIdleWriter(saveState);

    // ── gestures ─────────────────────────────────────────────────────────
    const detach = attachGestures(wrap, {
      tap: (e) => {
        markInteraction();
        if (e.fingers === 1) {
          // the train (tiers 1 / 3 / 5 / n): each rung is a civic act,
          // and between the rungs the echo only deepens.
          const tier = tapTrainTier(e.count);
          const depth = tapTrainDepth(e.count);
          tapEcho = { x: e.x, y: e.y, startedAt: performance.now(), depth };
          if (e.count === 3) {
            // three raps knock on the nearest door: the plot answers in
            // its own note and a fifth, and its neighbors turn toward it.
            const door = plotAt(e.x, e.y) ?? nearestPlot(e.x / width, e.y / height);
            if (door && isPlayableRole(door.role)) {
              const note = noteForPlot({ role: door.role, seed: door.seed });
              ringChord([note, note + 7], 300, 40);
              for (const person of people) {
                if (person.phase === "leaving") continue;
                const d2 = (person.x - door.x) ** 2 + (person.y - door.y) ** 2;
                if (d2 < 0.05) {
                  person.targetPlotId = door.id;
                  person.need = "gather";
                }
              }
              plantRingWeight = 1;
            } else {
              ring(noteForRole("home") - 12, 260);
            }
            try { haptics.roll(); } catch { /* noop */ }
            return;
          }
          if (e.count === 5) {
            // five ring a market bell: everyone within its carry is fed
            // a little, and a leaver still inside it turns back — the
            // train can call a departure home.
            const nx = e.x / width;
            const ny = e.y / height;
            ringChord(chordForCeremony("store"), 420, 30);
            for (const person of people) {
              const d2 = (person.x - nx) ** 2 + (person.y - ny) ** 2;
              if (d2 >= 0.1) continue;
              person.fed = Math.min(1, person.fed + 0.35);
              person.unmetSinceMs = null;
              if (person.phase === "leaving") {
                person.phase = "settled";
                person.leavingTo = null;
                person.leavingSinceMs = null;
                person.targetPlotId = null;
              }
            }
            try { haptics.bloom(); } catch { /* noop */ }
            return;
          }
          if (tier === "n") {
            // seven and more — the carillon: every plot rings, the sky
            // clears a step, and the whole town is called in to rest,
            // deeper with every further tap in the train.
            carillonStartedAt = performance.now();
            carillonStrength = Math.min(1, 0.6 + (e.count - 7) * 0.2);
            try { A().bell(); } catch { /* noop */ }
            const voices = plots.slice(0, 6).map((p) =>
              isPlayableRole(p.role) ? noteForPlot({ role: p.role, seed: p.seed }) : noteForRole("home"));
            if (voices.length > 0) ringChord(voices, 480, 36);
            for (const person of people) {
              if (person.phase === "leaving") continue;
              person.targetPlotId = person.homeId;
              person.need = "rest";
            }
            weatherRain = Math.max(0, weatherRain - 0.3 * carillonStrength);
            try { haptics.storm(); } catch { /* noop */ }
            return;
          }
          // tier 1, and the counts between rungs: the ground (or the
          // plot under the tap) acknowledges, scaled by how hard the
          // tap landed and how deep the train has run.
          const p = plotAt(e.x, e.y);
          if (p && isPlayableRole(p.role)) {
            plantRingWeight = 0.55 + e.intensity * 0.3 + depth * 0.15;
            ring(noteForPlot({ role: p.role, seed: p.seed }), 180 + e.intensity * 120 + depth * 80);
            try { haptics.ripple(0.25 + e.intensity * 0.35 + depth * 0.2); } catch { /* noop */ }
          } else {
            try { haptics.tap(); } catch { /* noop */ }
          }
        } else if (e.fingers === 3) {
          // tutti — as loud as the hand meant it: the bells carry on
          // e.intensity and every plot answers in the same frame.
          const events = plots.filter((p) => p.role === "event");
          for (const person of people) {
            if (events.length > 0) {
              const target = events.reduce((best, ev) => {
                const d2 = (ev.x - person.x) ** 2 + (ev.y - person.y) ** 2;
                return d2 < best.d ? { d: d2, ev } : best;
              }, { d: Infinity, ev: events[0] });
              person.targetPlotId = target.ev.id;
              person.need = "gather";
            }
          }
          carillonStartedAt = performance.now();
          carillonStrength = 0.35 + e.intensity * 0.5;
          try { A().bell(); } catch { /* noop */ }
          ringChord(bellChord(events.length), 280 + e.intensity * 220, 28);
          try { haptics.roll(); } catch { /* noop */ }
        }
      },

      hold: (e) => {
        markInteraction();
        if (e.fingers === 3) {
          if (e.phase === "release") { cityTimeScale = 1; return; }
          if (e.phase === "enter") {
            try { haptics.tap(); } catch { /* noop */ }
          }
          // time dilation is a continuous axis, never a switch: the day
          // keeps slowing the longer the hold — a quarter pace by the
          // dwell tier, on toward near-stillness at the ceremony tier.
          cityTimeScale = Math.max(0.06, 1 - 0.94 * Math.min(1, e.elapsed / THRESHOLDS.ceremonyMs));
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
              x: e.x / width,
              y: e.y / height,
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
            ring(noteForPlot({ role: "home", seed: plot.seed }), 240);
            try { haptics.tap(); } catch { /* noop */ }
          }
        }

        if (e.phase === "tick" && activePlant) {
          activePlant.liveDwellMs = performance.now() - activePlantStartedAt;
          if (e.tier >= 2) climbPlantRole(activePlant, activePlant.liveDwellMs);
          if (e.tier >= 3) sealPlot(activePlant);
        }

        if (e.phase === "release") {
          activePlant = null;
          idleWrite.schedule();
        }
      },

      drag: (e) => {
        markInteraction();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          weatherWind = Math.max(-1, Math.min(1, weatherWind + e.dx * 0.006));
          weatherRain = Math.max(0, Math.min(1, weatherRain + Math.abs(e.dy) * 0.002));
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          dragRoadStart = { x: e.x / width, y: e.y / height };
          return;
        }
        if (e.phase === "end") {
          if (dragRoadStart) {
            if (roads.length >= MAX_ROADS) roads.shift();
            roads.push({
              x1: dragRoadStart.x, y1: dragRoadStart.y,
              x2: e.x / width, y2: e.y / height,
              bornMs: cityTimeMs,
            });
            try { haptics.chop(); } catch { /* noop */ }
          }
          dragRoadStart = null;
        }
      },

      twist: (e) => {
        markInteraction();
        if (e.fingers === 3) {
          if (e.phase !== "move") return;
          const detent = Math.PI / 2;
          if (Math.abs(e.angle) < detent * 0.9) return;
          season = nextSeason(season, e.angle > 0 ? 1 : -1);
          ring(noteForSeason(season), 320);
          try { haptics.detent(); } catch { /* noop */ }
          idleWrite.schedule();
          return;
        }
        if (e.phase !== "move") return;
        if (Math.abs(e.angle) < Math.PI / 3) return;
        cycleLens(e.angle > 0 ? 1 : -1);
      },

      flick: (e) => {
        markInteraction();
        if (e.fingers !== 1) return;
        ring(noteForFlickAngle(e.angle), 260);
        try { haptics.chop(); } catch { /* noop */ }
        const px = e.x / width;
        const py = e.y / height;
        for (const person of people) {
          const d2 = (person.x - px) ** 2 + (person.y - py) ** 2;
          if (d2 < 0.09) person.need = "gather";
        }
      },

      scrub: (e) => {
        markInteraction();
        // stir — the circular path is a weather verb in this material:
        // the hand whips wind up in the direction it circles (harder
        // circling, harder wind), a deep stir drags rain out of the sky,
        // and the people caught inside the circle turn toward its
        // center like a round-dance called on the green.
        const dir = e.winding > 0 ? 1 : -1;
        const whip = dir * Math.min(0.6, 0.15 + Math.abs(e.angularVelocity) * 0.25);
        weatherWind = Math.max(-1, Math.min(1, weatherWind + whip));
        weatherRain = Math.min(1, weatherRain + Math.min(0.25, Math.abs(e.winding) * 0.08));
        const nx = e.cx / width;
        const ny = e.cy / height;
        const center = plotAt(e.cx, e.cy) ?? nearestPlot(nx, ny);
        if (center) {
          for (const person of people) {
            if (person.phase === "leaving") continue;
            const d2 = (person.x - nx) ** 2 + (person.y - ny) ** 2;
            if (d2 < 0.04) {
              person.targetPlotId = center.id;
              person.need = "gather";
            }
          }
        }
        ring(noteForSeason(season) + (dir > 0 ? 7 : -5), 200);
        try { haptics.ripple(Math.min(1, 0.3 + Math.abs(e.angularVelocity) * 0.4)); } catch { /* noop */ }
      },

      rhythm: (e) => {
        markInteraction();
        if (e.stability < 0.55) return;
        // entrain — the hand's steady tempo becomes the day's pace for
        // a few breaths: 72bpm holds the day, faster quickens the sun,
        // slower stretches the afternoon. Stability buys duration.
        entrainScale = Math.max(0.35, Math.min(3, e.bpm / 72));
        entrainUntil = performance.now() + 4000 + e.stability * 4000;
        ring(noteForRole("event") + 12, 180);
        try { haptics.detent(); } catch { /* noop */ }
      },
    }, { wheelZoom: false });

    // ── vessel: tilt / shake / knock / flip ──────────────────────────────
    const detachVessel = onVessel({
      tilt: (e) => {
        markInteraction();
        const lean = Math.min(1, Math.hypot(e.beta, e.gamma) / 45);
        weatherRain = Math.max(weatherRain, lean * 0.9);
      },
      shake: (e) => {
        markInteraction();
        dragRoadStart = null;
        weatherWind = Math.max(-1, Math.min(1, weatherWind + (e.intensity - 0.5) * 0.4));
      },
      knock: (e) => {
        markInteraction();
        // the toll carries as far as the rap was hard: a soft knock
        // turns only the near neighbors, a hard one the whole town.
        const events = plots.filter((p) => p.role === "event");
        try { A().bell(); } catch { /* noop */ }
        ringChord(bellChord(events.length), 300 + e.intensity * 220, 28);
        try { haptics.detent(); } catch { /* noop */ }
        if (events.length === 0) return;
        const reach = 0.25 + e.intensity * 0.75;
        for (const person of people) {
          const d2 = (person.x - events[0].x) ** 2 + (person.y - events[0].y) ** 2;
          if (d2 < reach * reach) {
            person.targetPlotId = events[0].id;
            person.need = "gather";
          }
        }
      },
      flip: (e) => {
        markInteraction();
        nightOn = e.faceDown;
        if (e.faceDown) {
          cityTimeMs = Math.floor(cityTimeMs / CITY_DAY_MS) * CITY_DAY_MS + CITY_DAY_MS * 0.75;
          ring(noteForRole("home") - 24, 320);
          try { haptics.detent(); } catch { /* noop */ }
        }
      },
    });

    // ── keyboard ────────────────────────────────────────────────────────
    // The gestures above, reachable without a hand on the glass. Nothing
    // here is a control the visitor has to learn — the arrows drift a
    // cursor over the field, `p` plants at it and keeps deepening while
    // held (the same roleForDwell ladder a dwell walks, so the causal law
    // stays single-sourced), space seals at ceremony tier (THRESHOLDS
    // .ceremonyMs from gesture/core.ts, never a private copy), `l` cycles
    // the lens forward, escape lowers it back to map. The wrap div is the
    // one focus target on this page and it receives its own keydown so a
    // typed key elsewhere on the site never fires here by accident.
    const onKeyDown = (e: KeyboardEvent) => {
      // guard against typing into anything editable (there is nothing on
      // /city yet, but the check keeps the room safe against a later panel)
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" ||
                     active.isContentEditable)) return;

      const key = e.key;
      const isArrow = key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
      const isPlant = key === "p" || key === "P";
      const isSeal = key === " " || key === "Spacebar";
      const isLens = key === "l" || key === "L";
      const isLower = key === "Escape";
      if (!(isArrow || isPlant || isSeal || isLens || isLower)) return;
      // any keyboard interaction reveals the cursor AND resets the idle
      // glimmer clock — a keyboard visitor is a visitor.
      cursorVisible = true;
      markInteraction();

      if (key === "ArrowUp")    { heldArrows.up    = true; e.preventDefault(); return; }
      if (key === "ArrowDown")  { heldArrows.down  = true; e.preventDefault(); return; }
      if (key === "ArrowLeft")  { heldArrows.left  = true; e.preventDefault(); return; }
      if (key === "ArrowRight") { heldArrows.right = true; e.preventDefault(); return; }

      if (isPlant) {
        e.preventDefault();
        if (e.repeat) return;                    // browser repeat is ignored;
        if (keyboardHolding) return;             // one plant hold at a time
        keyboardHolding = true;
        beginKeyboardPlant(cursorX, cursorY);
        return;
      }

      if (isSeal) {
        e.preventDefault();
        if (e.repeat) return;
        // The touch-reachable ceremony: seal the plot the cursor is over,
        // or the active keyboard plant if it is already growing. If neither
        // is present the press is silent — nothing to seal is not an error.
        const under = plotAt(cursorX, cursorY);
        const target = under ?? activePlant;
        if (target && !target.sealed) sealPlot(target);
        return;
      }

      if (isLens) {
        e.preventDefault();
        cycleLens(1);
        return;
      }

      if (isLower) {
        e.preventDefault();
        // Escape's cascade: if the visitor is mid-plant, release without
        // sealing; else if the lens is raised (anything but map), lower it;
        // else hide the cursor and blur — the room returns to still water.
        if (keyboardHolding) {
          releaseKeyboardPlant();
          return;
        }
        if (lens !== "map") {
          lens = "map";
          try { haptics.lens(); } catch { /* noop */ }
          return;
        }
        cursorVisible = false;
        if (wrap === document.activeElement) wrap.blur();
        return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp")    heldArrows.up    = false;
      if (e.key === "ArrowDown")  heldArrows.down  = false;
      if (e.key === "ArrowLeft")  heldArrows.left  = false;
      if (e.key === "ArrowRight") heldArrows.right = false;
      if ((e.key === "p" || e.key === "P") && keyboardHolding) {
        releaseKeyboardPlant();
      }
    };
    // Focus loss mid-hold must release the hold — the counterpart of the
    // gesture engine's pointercancel path. Without this, a `p` press during
    // blur leaves keyboardHolding=true and activePlant non-null, and the
    // next `p` press is silently swallowed by `if (keyboardHolding) return`.
    // releaseKeyboardPlant nulls activePlant and schedules the write, mirror
    // of the mouse hold's `release` phase (line ~1141).
    const onWrapBlur = () => {
      cursorVisible = false;
      if (keyboardHolding) releaseKeyboardPlant();
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);
    wrap.addEventListener("blur", onWrapBlur);

    // ── pause and visibility ────────────────────────────────────────────
    let docHidden = document.hidden;
    let galleryPaused = embedded;
    const applyPause = () => {
      if (docHidden || galleryPaused) governor.force("sleep");
    };
    applyPause();
    const offVisibility = onVisibility((hidden) => { docHidden = hidden; applyPause(); });
    const offGallery = onGalleryPause((paused) => { galleryPaused = paused; applyPause(); });

    // ── frame loop ──────────────────────────────────────────────────────
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
      void tier; // detail is read per-frame from detailForTier below
      const dt = Math.min(66, now - lastFrameAt);
      lastFrameAt = now;
      // rhythm entrainment rides on top of dilation: the hand's tempo
      // paces the day for a few breaths, then the pace eases back to 1.
      const entrain = now < entrainUntil ? entrainScale : 1;
      cityTimeMs += dt * cityTimeScale * entrain;
      uTime += reduceMotion ? 0 : dt * 0.001;
      advanceKeyboardCursor(dt);
      advanceKeyboardPlant();
      stepPopulation(dt * populationSpeed);
      decayWeather(dt);
      plantRingWeight = Math.max(0, plantRingWeight - dt * 0.002);
      // night veil ease (same trick Coin uses)
      const nightEase = reduceMotion ? 0.10 : Math.min(1, dt * 0.0025);
      nightAmt += ((nightOn ? 1 : 0) - nightAmt) * nightEase;
      if (nightVeilRef.current) {
        nightVeilRef.current.style.opacity = String(nightAmt * 0.55);
      }
      // hint hidden edge
      const wantHintHidden = plots.length > 0;
      if (hintRef.current && wantHintHidden !== hintHidden) {
        hintHidden = wantHintHidden;
        hintRef.current.style.opacity = wantHintHidden ? "0" : "";
      }
      // the shared 7s breath — every room in the album rides this same
      // clock. Held at 0.5 under prefers-reduced-motion so the ground is
      // still without the visitor being cheated of the register that says
      // "alive at rest". A phase of 2π * (uTime / 7) sends the sinusoid
      // once around every seven seconds; mapped 0..1 in the shader.
      const breath = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(uTime * (Math.PI * 2 / 7));

      // idle glimmer — after 20s of no touch and no vessel event, one
      // sealed plot (or a horizon patch in an empty city) breathes a
      // wider ring, alone, and nothing is said.
      maybeGlimmer(now);
      if (glimmerAt && now - glimmerAt.startedAt > GLIMMER_DURATION_MS) {
        glimmerAt = null;
      }

      // draw
      syncPlotAttributes();
      groundUniforms.uTime.value = uTime;
      groundUniforms.uDayFrac.value = dayFraction(cityTimeMs);
      groundUniforms.uSeason.value = SEASON_ORDER.indexOf(season);
      groundUniforms.uRain.value = weatherRain;
      groundUniforms.uWind.value = weatherWind;
      groundUniforms.uNight.value = nightAmt;
      groundUniforms.uLens.value = lens === "map" ? 0 : lens === "hydrology" ? 1 : 2;
      groundUniforms.uBreath.value = breath;
      plotUniforms.uDayFrac.value = dayFraction(cityTimeMs);
      plotUniforms.uNight.value = nightAmt;
      renderer.clear();
      renderer.render(groundScene, groundCam);
      renderer.render(plotScene, plotCam);
      drawOverlay();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // ── helpers ─────────────────────────────────────────────────────────

    function plotAt(px: number, py: number): Plot | null {
      const nx = px / width;
      const ny = py / height;
      const r = 22 / Math.min(width, height);
      let best: Plot | null = null;
      let bestD = r * r;
      for (const plot of plots) {
        const d = (plot.x - nx) ** 2 + (plot.y - ny) ** 2;
        if (d < bestD) { bestD = d; best = plot; }
      }
      return best;
    }

    // Unlike plotAt (a fingertip's reach), this answers with the nearest
    // plot at any distance — the door a knock-train raps on, the center a
    // stir gathers around. Null only in an empty city.
    function nearestPlot(nx: number, ny: number): Plot | null {
      let best: Plot | null = null;
      let bestD = Infinity;
      for (const plot of plots) {
        const d = (plot.x - nx) ** 2 + (plot.y - ny) ** 2;
        if (d < bestD) { bestD = d; best = plot; }
      }
      return best;
    }

    function spawnDwellersFor(home: Plot): void {
      const count = dwellersPerHome(home.seed);
      const rng = mulberry(home.seed ^ 0x1eaf);
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
          stillMs: 0,
          unmetSinceMs: null,
          leavingTo: null,
          leavingSinceMs: null,
        });
      }
    }

    function respawnPeopleFromHomes(): void {
      people.length = 0;
      for (const p of plots) {
        if (p.role === "home") spawnDwellersFor(p);
      }
      // Rehydrate the ledgers from persistence, one per person, matched by
      // the deterministic seed. `pendingLedgers` is populated once on
      // restore and consumed here — a seed only rehydrates one person, so
      // a subsequent respawn (a `letGo` then fresh plants) cannot pick up
      // a stale ledger from an earlier session.
      if (pendingLedgers.size > 0) {
        for (const person of people) {
          const ledger = pendingLedgers.get(person.seed);
          if (ledger && ledger.homeId === person.homeId) {
            applyPersonLedger(person, ledger);
            pendingLedgers.delete(person.seed);
          }
        }
        // Whatever ledgers didn't match a fresh spawn are dropped — the
        // home they belonged to may have been climbed away from "home" and
        // no longer spawns anyone. The belonging retires with its home.
        pendingLedgers.clear();
      }
    }

    function stepPopulation(dt: number): void {
      const HESITATION_SWAP_MS = 550;
      const ARRIVAL_MS = 260;
      // The step-delta threshold below which a person reads as stationary.
      // A walking frame moves ~5e-5 normalized units per ms of dt (see
      // PERSON_SPEED_NORM_PER_MS), so a 16ms frame walks ~8e-4 units and its
      // squared norm is ~6.4e-7. A hundredth of that (~1e-8) is safely below
      // any real walk and above the floating-point noise of stepTowards'
      // arithmetic — a person hovering on their target lands here every
      // frame, and their `stillMs` counter accrues until isStanding fires.
      const STILL_DELTA_NORM_SQ = 1e-8;
      // Walk the array with an index so retiring a leaving person on arrival
      // at the edge is a splice, not a rebuild — the population is small and
      // the mutation is honest: a person who reached the edge is gone.
      let idx = 0;
      while (idx < people.length) {
        const person = people[idx];
        const prevX = person.x;
        const prevY = person.y;

        person.fed = Math.max(0, person.fed - dt * 0.00003);
        person.rested = Math.max(0, person.rested - dt * 0.00002);

        // ── the sustained-unmet ledger ──
        // Only settled people can decide to leave: an arriving person has
        // not yet had a chance to try, and a leaving person has already
        // decided. The counter reads city-time so the run under 3-finger
        // hold (time dilation) slows the trip out the same as it slows
        // everything else — the tradeoff is continuous with the room.
        if (person.phase === "settled") {
          if (needsUnmet(person.fed, person.rested)) {
            if (person.unmetSinceMs == null) person.unmetSinceMs = cityTimeMs;
            const unmetMs = cityTimeMs - person.unmetSinceMs;
            if (shouldLeave(person.fed, person.rested, unmetMs)) {
              person.phase = "leaving";
              person.leavingSinceMs = cityTimeMs;
              person.leavingTo = nearestEdgePoint({ x: person.x, y: person.y });
              person.targetPlotId = null;
              person.hesitating = false;
              person.hesitationSince = 0;
              // A leaving is a small solemn act — sight+sound in the same
              // frame. The note is low, the haptic soft: the settlement
              // noticed, the visitor can too.
              ring(noteForRole("home") - 12, 320);
              try { haptics.tap(); } catch { /* noop */ }
            }
          } else {
            person.unmetSinceMs = null;
          }
        }

        // ── leaving people walk to the edge, no plot in sight ──
        if (person.phase === "leaving" && person.leavingTo) {
          const target = person.leavingTo;
          const roadBoost = personOnRoad(person) ? 2.2 : 1;
          const stepped = stepTowards(
            { x: person.x, y: person.y },
            target,
            dt * roadBoost,
          );
          person.x = stepped.x;
          person.y = stepped.y;
          person.heading = headingFor(
            { x: prevX, y: prevY },
            { x: person.x, y: person.y },
            person.heading,
          );
          // A leaving person is defined by walking to the edge; their pose
          // must never flip to standing. Reset the still counter every frame
          // in this branch so the renderer keeps drawing them as slivers
          // heading out of the field.
          person.stillMs = 0;
          const arrivedAtEdge =
            Math.abs(person.x - target.x) < 0.006 &&
            Math.abs(person.y - target.y) < 0.006;
          if (arrivedAtEdge) {
            // Retire the person from the array. The homeId is intact — a
            // future arrival from this same home spawns fresh.
            people.splice(idx, 1);
            continue;
          }
          idx += 1;
          continue;
        }

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
              if (target.role === "home") person.rested = Math.min(1, person.rested + dt * 0.0012);
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
        // Accumulate the still counter that isStanding() reads. A frame
        // whose delta is beneath STILL_DELTA_NORM_SQ is not a walking
        // frame — the person is hovering on a plot they've already
        // arrived at, or waiting because their targetPlotId is null in a
        // city with no matching plot. A frame with any real delta resets
        // the counter to 0 so the pose flips back to walking the instant
        // they move.
        {
          const ddx = person.x - prevX;
          const ddy = person.y - prevY;
          if (ddx * ddx + ddy * ddy < STILL_DELTA_NORM_SQ) {
            person.stillMs += dt;
          } else {
            person.stillMs = 0;
          }
        }
        idx += 1;
      }
    }

    function personOnRoad(person: Person): boolean {
      for (const road of roads) {
        const t = clamp(((person.x - road.x1) * (road.x2 - road.x1) + (person.y - road.y1) * (road.y2 - road.y1))
          / Math.max(1e-6, (road.x2 - road.x1) ** 2 + (road.y2 - road.y1) ** 2), 0, 1);
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

    // ── plot instance sync ──────────────────────────────────────────────
    // The plot instance attributes read directly off the `plots` array
    // every frame, then only mark the changed range for upload. 48 quads
    // is small enough that a full rewrite is faster than tracking dirty
    // slots — the GPU eats the whole buffer either way.
    function syncPlotAttributes(): void {
      const n = plots.length;
      const detail = detailForTier(governor.tier());
      const growMs = reduceMotion ? 250 : 380;
      for (let i = 0; i < n; i += 1) {
        const plot = plots[i];
        // pixel center on the current canvas
        const cx = plot.x * width;
        const cy = plot.y * height;
        // tile size: a sealed plot is a touch larger; trees are shaped by
        // the season's foliage index. Store/event share the standard size.
        const isTree = plot.role === "tree";
        const treeScale = isTree ? treeFoliage(season) : 1;
        const base = plot.sealed ? 44 : 36;
        const size = base * (0.6 + 0.4 * treeScale) * (detail.samples >= 2 ? 1 : 0.95);
        aCenter[i * 2 + 0] = cx;
        aCenter[i * 2 + 1] = cy;
        aSize[i] = size;
        aRole[i] = ROLE_INDEX[plot.role];
        aSealed[i] = plot.sealed ? 1 : 0;
        // born-in: 0 → 1 over growMs, starting from bornMs on the city clock
        const age = cityTimeMs - plot.bornMs;
        aBornT[i] = age >= growMs ? 1 : Math.max(0.08, age / growMs);
        aSeed[i] = hashSeedToUnit(plot.seed);
      }
      centerAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      roleAttr.needsUpdate = true;
      sealedAttr.needsUpdate = true;
      bornAttr.needsUpdate = true;
      seedAttr.needsUpdate = true;
      plotGeo.instanceCount = n;
    }

    // Integer → [0,1) hash, splashed on the same shape as Mulberry32's
    // avalanche so a small integer difference in plot.seed lands in a
    // very different quadrant of the unit interval. Cheap enough to run
    // per plot per frame; the write is what matters, not the compute.
    function hashSeedToUnit(seed: number): number {
      let n = (seed | 0) >>> 0;
      n = ((n ^ 0x9e3779b9) >>> 0);
      n = (Math.imul(n, 0x85ebca6b) >>> 0);
      n = ((n ^ (n >>> 13)) >>> 0);
      n = (Math.imul(n, 0xc2b2ae35) >>> 0);
      n = ((n ^ (n >>> 16)) >>> 0);
      return n / 4294967295;
    }

    // ── overlay drawing (the thin 2D layer) ─────────────────────────────
    // Roads, people, dwell ring, community rings, lens strokes, rain streaks.
    // Nothing here allocates a gradient per frame — the ledger's ban stays
    // honored, and the only 2D calls that touch this canvas are strokes and
    // fills over a cleared surface.
    function drawOverlay(): void {
      const detail = detailForTier(governor.tier());
      fgctx.clearRect(0, 0, width, height);

      // idle glimmer — a soft ochre ring, rising and fading over one breath.
      // Drawn UNDER the roads and people so the settlement's own strokes
      // land on top of the light, not the other way around; this is the
      // ground exhaling, not something the visitor did. The ring's radius
      // eases outward and its alpha rides a sine over its short life so
      // the eye reads it as one soft pulse.
      if (glimmerAt) {
        const age = performance.now() - glimmerAt.startedAt;
        const t = Math.min(1, Math.max(0, age / GLIMMER_DURATION_MS));
        // sin(π t) peaks at t=0.5 → ring is brightest in its middle, dark
        // at both ends. Radius grows monotonically so the glimmer expands.
        const alpha = Math.sin(t * Math.PI) * 0.42;
        const r = 22 + t * 46;
        const px = glimmerAt.nx * width;
        const py = glimmerAt.ny * height;
        fgctx.strokeStyle = `rgba(232, 187, 129, ${alpha.toFixed(3)})`;
        fgctx.lineWidth = 1.5;
        fgctx.beginPath();
        fgctx.arc(px, py, r, 0, Math.PI * 2);
        fgctx.stroke();
      }

      // tap-train echo — one ring expanding from the tapped ground, its
      // weight riding the train's depth: the visible half of the ladder
      // whose audible half is the ring/chord the tap handler played.
      if (tapEcho) {
        const age = performance.now() - tapEcho.startedAt;
        if (age > 700) {
          tapEcho = null;
        } else {
          const t = age / 700;
          const alpha = (1 - t) * (0.22 + tapEcho.depth * 0.4);
          fgctx.strokeStyle = `rgba(255, 232, 178, ${alpha.toFixed(3)})`;
          fgctx.lineWidth = 1.5 + tapEcho.depth * 1.5;
          fgctx.beginPath();
          fgctx.arc(tapEcho.x, tapEcho.y, 10 + t * (24 + tapEcho.depth * 34), 0, Math.PI * 2);
          fgctx.stroke();
        }
      }

      // carillon — tutti and the train's crescendo: every plot rings a
      // brief ring at once, the whole settlement stating itself in one
      // frame with the bells.
      {
        const carAge = performance.now() - carillonStartedAt;
        if (carAge < 1100 && carillonStrength > 0) {
          const t = carAge / 1100;
          const alpha = (1 - t) * 0.4 * carillonStrength;
          fgctx.strokeStyle = `rgba(246, 230, 180, ${alpha.toFixed(3)})`;
          fgctx.lineWidth = 1.5;
          for (const plot of plots) {
            fgctx.beginPath();
            fgctx.arc(plot.x * width, plot.y * height, 14 + t * 36, 0, Math.PI * 2);
            fgctx.stroke();
          }
        }
      }

      // roads (thin strokes over the ground shader)
      fgctx.strokeStyle = "rgba(21, 23, 26, 0.35)";
      fgctx.lineWidth = 3;
      fgctx.lineCap = "round";
      for (const road of roads) {
        fgctx.beginPath();
        fgctx.moveTo(road.x1 * width, road.y1 * height);
        fgctx.lineTo(road.x2 * width, road.y2 * height);
        fgctx.stroke();
      }

      // hydrology lens — a soft moving meander line across the settlement
      if (lens === "hydrology") {
        fgctx.strokeStyle = "rgba(44, 74, 92, 0.42)";
        fgctx.lineWidth = 2.5;
        fgctx.beginPath();
        for (let x = 0; x < width; x += 3) {
          const y = height * 0.55 + Math.sin(x * 0.02 + cityTimeMs * 0.0005) * 26;
          if (x === 0) fgctx.moveTo(x, y); else fgctx.lineTo(x, y);
        }
        fgctx.stroke();
      }

      // active plant dwell ring — the ring rises around the touched plot
      // during a dwell, expanding as the role climbs the ladder. This is
      // the causal accompaniment of the plot's role change, and it lives
      // in the thin overlay because it's an instantaneous per-frame stroke.
      if (activePlant && !activePlant.sealed) {
        const dwell = activePlant.liveDwellMs;
        const nextThreshold = nextRoleThreshold(activePlant.role);
        const prev = prevRoleThreshold(activePlant.role);
        const frac = nextThreshold ? Math.min(1, (dwell - prev) / (nextThreshold - prev)) : 1;
        const px = activePlant.x * width;
        const py = activePlant.y * height;
        fgctx.strokeStyle = `rgba(255, 232, 178, ${0.55 + plantRingWeight * 0.35})`;
        fgctx.lineWidth = 2;
        fgctx.beginPath();
        fgctx.arc(px, py, 24 + frac * 14, 0, Math.PI * 2);
        fgctx.stroke();
      }

      // micro-communities: a plot with two or more regulars carries a cool
      // ring — the visible record of the plot's identity densifying from a
      // role into a community. The ring is teal so a colony of regulars
      // reads AGAINST its warm plot rather than dissolving into it (a warm
      // ring on a warm awning was one plot and one regular class, both
      // arguing the same hue).
      const regularCountByPlot = new Map<number, number>();
      for (const person of people) {
        if (person.regularStoreId != null) {
          regularCountByPlot.set(person.regularStoreId, (regularCountByPlot.get(person.regularStoreId) ?? 0) + 1);
        }
        if (person.regularEventId != null) {
          regularCountByPlot.set(person.regularEventId, (regularCountByPlot.get(person.regularEventId) ?? 0) + 1);
        }
      }
      for (const plot of plots) {
        const count = regularCountByPlot.get(plot.id) ?? 0;
        if (count < 2) continue;
        const px = plot.x * width;
        const py = plot.y * height;
        const radius = 22 + count * 3;
        fgctx.strokeStyle = `rgba(74, 158, 158, ${Math.min(0.62, 0.22 + count * 0.10)})`;
        fgctx.lineWidth = 1.5;
        fgctx.beginPath();
        fgctx.arc(px, py, radius, 0, Math.PI * 2);
        fgctx.stroke();
      }

      // people — two poses drawn by one causal predicate.
      //
      // A walking person is a heading-aligned sliver (body along the
      // motion vector, head-dot at the leading end). A person whose
      // stepTowards delta has stayed ~0 for more than STANDING_STILL_MS
      // is a STANDING person: drawn as a small vertical body — a head
      // dot above a body dot — so a colony of regulars at a plot reads
      // as *people standing at a store*, not as strokes indistinguishable
      // from motion. The predicate is `isStanding(stillMs)` from
      // src/lib/city.ts, single-sourced with the test that pins it.
      //
      // A leaving person fades toward the edge — their opacity eases
      // from 1 to 0 across LEAVING_FADE_MS via `fadeForLeaving`; their
      // stillMs is reset every frame in the leaving branch so they
      // never freeze into a standing pose mid-departure.
      const dropTails = detail.samples < 2;
      for (const person of people) {
        const px = person.x * width;
        const py = person.y * height;
        const leavingFade = person.phase === "leaving" && person.leavingSinceMs != null
          ? fadeForLeaving(cityTimeMs - person.leavingSinceMs)
          : 1;
        if (leavingFade <= 0) continue;

        const baseAlpha = person.hesitating ? 0.6 : 0.9;
        const bodyAlpha = baseAlpha * leavingFade;
        // Regulars wear cool teal (reads AGAINST the settlement's warm
        // plots); the ordinary body is candle-black. A leaving person is
        // a neutral desaturated grey — the belonging teal drops away as
        // they walk to the edge. Visual language: teal is belonging,
        // grey is departure, and the fade takes care of the rest.
        const isRegular = person.regularStoreId != null || person.regularEventId != null;
        const bodyColor = person.phase === "leaving"
          ? `rgba(64, 68, 76, ${bodyAlpha})`
          : isRegular
            ? `rgba(74, 158, 158, ${bodyAlpha})`
            : `rgba(21, 23, 26, ${bodyAlpha})`;

        const standing = isStanding(person.stillMs);
        if (standing) {
          // Standing pose — a small vertical body: a head dot above a
          // body dot, aligned to gravity (screen +y is down). Not
          // heading-aligned: a person parked at a store points nowhere.
          // The body dot is a touch larger than the head so the eye
          // reads posture rather than punctuation.
          fgctx.fillStyle = bodyColor;
          const bodyRadius = isRegular ? 2.0 : 1.6;
          const headRadius = isRegular ? 1.5 : 1.2;
          const stackGap = 3.2;
          fgctx.beginPath();
          fgctx.arc(px, py + 0.4, bodyRadius, 0, Math.PI * 2);
          fgctx.fill();
          fgctx.beginPath();
          fgctx.arc(px, py + 0.4 - stackGap, headRadius, 0, Math.PI * 2);
          fgctx.fill();
          continue;
        }

        // Walking pose — a heading-aligned sliver with a leading head dot.
        const cos = Math.cos(person.heading);
        const sin = Math.sin(person.heading);
        const length = person.phase === "arriving" ? 6 : 5;
        const bx = px + cos * (length * 0.5);
        const by = py + sin * (length * 0.5);
        const tx = px - cos * (length * 0.5);
        const ty = py - sin * (length * 0.5);
        if (!dropTails && person.phase === "arriving") {
          const home = plots.find((p) => p.id === person.homeId);
          if (home) {
            const hx = home.x * width;
            const hy = home.y * height;
            const dx = px - hx;
            const dy = py - hy;
            const dLen = Math.hypot(dx, dy);
            if (dLen > 16) {
              const backLen = Math.min(14, dLen * 0.25);
              fgctx.strokeStyle = "rgba(232, 226, 213, 0.22)";
              fgctx.lineWidth = 1;
              fgctx.beginPath();
              fgctx.moveTo(px, py);
              fgctx.lineTo(px + (dx / dLen) * backLen, py + (dy / dLen) * backLen);
              fgctx.stroke();
            }
          }
        }
        fgctx.strokeStyle = bodyColor;
        fgctx.lineWidth = 2;
        fgctx.lineCap = "round";
        fgctx.beginPath();
        fgctx.moveTo(tx, ty);
        fgctx.lineTo(bx, by);
        fgctx.stroke();
        fgctx.fillStyle = bodyColor;
        // Regulars carry a slightly larger head dot — a colony of
        // regulars reads as a small ring of round dots around a plot,
        // not as several strokes indistinguishable from the crowd.
        const headRadius = isRegular ? 2.0 : 1.4;
        fgctx.beginPath();
        fgctx.arc(bx, by, headRadius, 0, Math.PI * 2);
        fgctx.fill();
      }

      // satisfaction lens — halo plots by how many people are near
      if (lens === "satisfaction") {
        for (const plot of plots) {
          if (plot.role !== "home" && plot.role !== "store" && plot.role !== "event") continue;
          let visitors = 0;
          for (const person of people) {
            if ((person.x - plot.x) ** 2 + (person.y - plot.y) ** 2 < 0.005) visitors += 1;
          }
          if (visitors === 0) continue;
          fgctx.strokeStyle = `rgba(74, 145, 106, ${Math.min(0.55, visitors * 0.18)})`;
          fgctx.lineWidth = 4;
          fgctx.beginPath();
          fgctx.arc(plot.x * width, plot.y * height, 20 + visitors * 2, 0, Math.PI * 2);
          fgctx.stroke();
        }
      }

      // keyboard cursor — a soft ring at the arrow-driven position. The
      // ring's radius matches the dwell ring so the visitor's eye reads
      // the same target for keyboard and touch. A thin cross inside marks
      // the exact center — it is a cursor, not a shape. Under an active
      // keyboard plant the ring is drawn only by the plant's own dwell ring
      // (above), and the cursor cross would double-strike, so it is skipped.
      if (cursorVisible) {
        const showCross = !(keyboardHolding && activePlant);
        fgctx.strokeStyle = "rgba(246, 230, 180, 0.72)";
        fgctx.lineWidth = 1.5;
        fgctx.beginPath();
        fgctx.arc(cursorX, cursorY, 18, 0, Math.PI * 2);
        fgctx.stroke();
        if (showCross) {
          fgctx.strokeStyle = "rgba(246, 230, 180, 0.6)";
          fgctx.lineWidth = 1;
          fgctx.beginPath();
          fgctx.moveTo(cursorX - 6, cursorY);
          fgctx.lineTo(cursorX + 6, cursorY);
          fgctx.moveTo(cursorX, cursorY - 6);
          fgctx.lineTo(cursorX, cursorY + 6);
          fgctx.stroke();
        }
      }

      // rain streaks over the wet ground shader — the streaks are thin
      // lines whose angle is driven by weatherWind. Under reduced motion
      // the field is stationary: the streaks are drawn from a stationary
      // seed so the sky reads as under weather without any animated fall.
      if (weatherRain > 0.01) {
        fgctx.strokeStyle = `rgba(44, 74, 92, ${0.15 + weatherRain * 0.35})`;
        fgctx.lineWidth = 1;
        const count = Math.floor(weatherRain * 60);
        const seedT = reduceMotion ? 1 : Math.floor(cityTimeMs / 40);
        const rng = mulberry(seedT);
        for (let i = 0; i < count; i += 1) {
          const x = rng() * width;
          const y = reduceMotion
            ? rng() * height
            : ((rng() * height) + (cityTimeMs * 0.4)) % height;
          const wind = weatherWind * 22;
          fgctx.beginPath();
          fgctx.moveTo(x, y);
          fgctx.lineTo(x + wind, y + 12);
          fgctx.stroke();
        }
      }
    }

    // ── plant-ladder helpers (shared by touch and keyboard paths) ───────
    // Both callers pass the plot and the elapsed dwell time; the causal law
    // roleForDwell() decides what role that plot has become. Keeping the
    // ladder in one place means touch and keyboard climb literally the same
    // rungs — the audit that added this file also removed the private 540ms
    // timer /earth used to reimplement, and the same discipline applies here.
    function climbPlantRole(plot: Plot, dwellMs: number): void {
      if (plot.sealed) return;
      const newRole = roleForDwell(dwellMs);
      if (newRole === plot.role || !isPlayableRole(newRole)) return;
      plot.role = newRole;
      ring(dwellClimbNote(newRole), 260);
      try { haptics.detent(); } catch { /* noop */ }
      plantRingWeight = 1;
    }
    function sealPlot(plot: Plot): void {
      if (plot.sealed) return;
      plot.sealed = true;
      try { A().bell(); } catch { /* noop */ }
      if (isPlayableRole(plot.role)) {
        ringChord(chordForCeremony(plot.role), 520, 34);
      }
      try { haptics.bloom(); } catch { /* noop */ }
      plantRingWeight = 1;
      idleWrite.schedule();
    }
    function cycleLens(direction: 1 | -1): void {
      const lenses: CityLens[] = ["map", "hydrology", "satisfaction"];
      const cur = lenses.indexOf(lens);
      lens = lenses[(cur + direction + lenses.length) % lenses.length];
      try { haptics.lens(); } catch { /* noop */ }
    }

    // ── keyboard driving ────────────────────────────────────────────────
    // The keyboard synthesises a hold the same way the finger does: it
    // grabs (or plants) a plot at press time, then the tick loop climbs
    // its ladder using elapsed time and the shared holdTier() / roleForDwell
    // functions. releaseKeyboardPlant() is the counterpart of hold's
    // "release" phase; the plot stays at whatever role the ladder reached.
    function beginKeyboardPlant(cx: number, cy: number): void {
      const existing = plotAt(cx, cy);
      if (existing && !existing.sealed) {
        activePlant = existing;
        activePlantStartedAt = performance.now();
        existing.dwellStartMs = activePlantStartedAt;
        return;
      }
      if (existing) {
        // sealed plots refuse the plant — keyboard mirrors the touch path
        keyboardHolding = false;
        return;
      }
      if (plots.length >= MAX_PLOTS) {
        keyboardHolding = false;
        return;
      }
      const seed = ((cx * 1000) | 0) ^ ((cy * 1000) | 0) ^ nextPlotId;
      const plot: Plot = {
        id: nextPlotId++,
        seed,
        x: cx / width,
        y: cy / height,
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
      ring(noteForPlot({ role: "home", seed: plot.seed }), 240);
      try { haptics.tap(); } catch { /* noop */ }
    }
    function advanceKeyboardPlant(): void {
      if (!keyboardHolding || !activePlant) return;
      const dwell = performance.now() - activePlantStartedAt;
      activePlant.liveDwellMs = dwell;
      const tier = holdTier(dwell);
      if (tier >= 2) climbPlantRole(activePlant, dwell);
      if (tier >= 3) sealPlot(activePlant);
    }
    function releaseKeyboardPlant(): void {
      keyboardHolding = false;
      if (activePlant) {
        activePlant = null;
        idleWrite.schedule();
      }
    }

    // The cursor drifts under held arrow keys. Speed is a plain px-per-ms
    // rate; it is not a threshold in the gesture-grammar sense, only a
    // continuous velocity — the room's own kinematic constant. Reduced
    // motion halves the speed so a keyboard visitor with reduced motion is
    // still walking, not sliding.
    const CURSOR_PX_PER_MS = reduceMotion ? 0.20 : 0.42;
    function advanceKeyboardCursor(dt: number): void {
      if (!cursorVisible) return;
      let dx = 0;
      let dy = 0;
      if (heldArrows.left)  dx -= 1;
      if (heldArrows.right) dx += 1;
      if (heldArrows.up)    dy -= 1;
      if (heldArrows.down)  dy += 1;
      if (dx === 0 && dy === 0) return;
      // diagonals normalize so up-right moves the same speed as up
      const norm = dx * dx + dy * dy === 2 ? 0.7071 : 1;
      cursorX = Math.max(0, Math.min(width, cursorX + dx * norm * CURSOR_PX_PER_MS * dt));
      cursorY = Math.max(0, Math.min(height, cursorY + dy * norm * CURSOR_PX_PER_MS * dt));
    }

    function nextRoleThreshold(role: PlotRole): number | null {
      if (role === "home") return PLOT_DWELL_MS.store;
      if (role === "store") return PLOT_DWELL_MS.event;
      if (role === "event") return PLOT_DWELL_MS.tree;
      return null;
    }
    function prevRoleThreshold(role: PlotRole): number {
      if (role === "home") return 0;
      if (role === "store") return PLOT_DWELL_MS.home;
      if (role === "event") return PLOT_DWELL_MS.store;
      if (role === "tree") return PLOT_DWELL_MS.event;
      return 0;
    }
    function clamp(v: number, lo: number, hi: number): number {
      return v < lo ? lo : v > hi ? hi : v;
    }

    // ── LetGo support ───────────────────────────────────────────────────
    const onLetGo = () => {
      markInteraction();
      plots.length = 0;
      people.length = 0;
      roads.length = 0;
      activePlant = null;
      idleWrite.schedule();
    };
    window.addEventListener("letgo", onLetGo);

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
      observer.disconnect();
      offVisibility();
      offGallery();
      detachVessel();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      wrap.removeEventListener("blur", onWrapBlur);
      window.removeEventListener("letgo", onLetGo);
      window.clearInterval(standingInterval);
      idleWrite.flush();
      idleWrite.cancel();
      saveState();
      plotGeo.dispose();
      groundQuad.geometry.dispose();
      groundMat.dispose();
      plotMat.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      aria-label="a small settlement — arrows drift a cursor, p plants and keeps deepening while held, space seals, l cycles the lens, escape lowers it"
      style={{
        position: "fixed",
        inset: 0,
        touchAction: "none",
        overflow: "hidden",
        background: "#0e0f13",
        outline: "none",
      }}
    >
      <canvas ref={glCanvasRef} style={{ position: "absolute", inset: 0, display: "block" }} />
      <canvas ref={fgCanvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      {/* Night veil — face-down flips this from transparent to a deep dusk
          across the whole field. The shader already dims the ground; this
          is the second channel — the room-wide overlay that says "night". */}
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
