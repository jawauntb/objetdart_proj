"use client";

/**
 * Zeus — the peak ring's fourth seat: the charged sky held as the god who
 * surveys the whole world.
 *
 * /storm owns the meteorology of a storm — pressure, charge, discharge as
 * weather. This room is the same sky held as governance: cosmic thunderheads
 * gather under a dwell, court each other by induction (lib/zeussky
 * attraction), merge into greater houses when their anvils touch, and spend
 * themselves in one bolt that arcs across the cosmos to the small earth in
 * the corner. The thunder is the ledger — thunderHz inverts, so a listener
 * reads the size of every strike off its pitch alone.
 *
 * The material is a fragment shader (deep cosmos, dense starfield, faint
 * galactic wisp, and the earth-in-corner: a shaded sphere with terminator,
 * atmosphere rim, procedural continents, and the earth-scorch — the god's
 * warm touch where a ceremony bolt lands) plus a 2D overlay for the bolt
 * itself. Every strike is a set of segments returned by src/lib/lightning.ts's
 * buildBolt, drawn on the overlay with the same glow + branch + main-channel
 * grammar /storm uses, so a visitor moving between the two rooms sees the
 * same lightning anatomy. The population is one instanced draw; every law
 * the room claims lives in src/lib/zeussky.ts and is pinned by
 * scripts/test-zeussky.mjs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { tapTrainTier, tapTrainDepth } from "@/lib/gesture/core";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
} from "@/lib/room-runtime";
import { createGLStage, FULLSCREEN_VERT_CLIP } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
import { populationVoice } from "@/lib/scene/voice";
import {
  createPopulation,
  createVerbEvent,
  mulberry32,
  type SceneObjectSpec,
  type SceneObjectState,
  type StepContext,
} from "@/lib/scene/object";
import {
  CELL_CAP,
  PEAL_STAGGER_MS,
  attraction,
  boltEnergy,
  calve,
  inContact,
  mergeCells,
  pealOrder,
  thunderHz,
} from "@/lib/zeussky";
import {
  DEFAULT_BOLT_CFG,
  buildBolt,
  hashSeed as boltHashSeed,
  type BoltSeg,
} from "@/lib/lightning";

const STORAGE_KEY = "objetdart:zeus:v1";

// The cosmos the court convenes in: houses roam almost the whole frame — the
// earth-in-corner is the only anchor, so the SKY_TOP climbs and the SKY_FLOOR
// falls almost to the frame's bottom. These constants ARE the shader's uv
// bounds for the thunderhead population; the earth-corner constants below
// keep the JS side agreed with what the shader draws.
const SKY_TOP = 0.05;
const SKY_FLOOR = 0.75;

// The earth-in-corner — position and radius in uv space. uv.y here is the
// shader's already-flipped uv (0 at bottom, 1 at top). Hoisted to JS so both
// the shader and fireBolt agree on where the earth actually is: a ceremony
// bolt aims at a point on the lit hemisphere derived from these numbers.
const EARTH_CENTER_UV_X = 0.82;
const EARTH_CENTER_UV_Y = 0.20;
const EARTH_RADIUS_UV = 0.10;

// ——— the field: deep cosmos, dense starfield, faint galactic wisp, the
// earth-in-corner, and the earth-scorch where the god's touch lands.
// Naming: the shared breath (`uBreath`) reaches every room whose shader
// declares it, per `src/lib/webgl/sizing.ts` — same convention as /reef and
// /root — and the room-quality bar reads the manifest's `life.breath.reads`
// against that literal. The other room-local uniforms keep the `u_*` dialect
// this file established.
const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float uBreath;
uniform float u_turbulence;
uniform float u_brightness;
uniform float u_reduced;
uniform float u_wind;
uniform float u_charge;
uniform float u_flash;
uniform float u_night;
uniform float u_lens;
// the earth's answer to the bolt — 1 at the moment of the strike, decaying
// to 0 over ~1.5s. u_earthStrikeUV is a 2D point in local earth space
// (offset from the earth's center in radius-units, ~-1..1 on each axis) so
// the warm scorch stays exactly where the bolt actually landed.
uniform float u_earthStrike;
uniform vec2  u_earthStrikeUV;
// the vessel's own lean — gamma / 45 clamped to ±1. Pushes the cosmos and
// the starfield a few percent of the frame laterally, so a tilt actually
// leans the whole sky.
uniform float u_tiltX;
// pre-ceremony dimming — 0 at rest, climbs while a one-finger hold approaches
// the ceremony tier so the cosmos feels inevitable before the crack lands.
uniform float u_darken;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), u);
}
// 2D value noise for the earth's continents and the galactic wisp.
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Three-octave fbm — the wisp is faint, so four would be waste.
float fbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * noise2(p);
    p = p * 2.03 + vec2(11.7, 5.3);
    a *= 0.5;
  }
  return s;
}

// The bolt itself is no longer drawn in the shader — /storm and /zeus now
// share the fractal in src/lib/lightning.ts and render the segments on a
// 2D overlay on top of this pass. The shader still owns the earth-scorch
// (u_earthStrike / u_earthStrikeUV) so the earth visibly RECEIVES the
// strike, and the frame-wide u_flash still lights the cosmic thunderheads
// from within.

// The earth-in-corner: a shaded sphere with a lit hemisphere, a terminator,
// a paler atmosphere rim, procedural continents, and a warm scorch where a
// ceremony bolt landed. Returns pre-multiplied vec4 so it composites cleanly
// on the cosmos underneath.
vec4 earthCorner(vec2 uv, float earthStrike, vec2 earthStrikeUV) {
  vec2 center = vec2(${EARTH_CENTER_UV_X.toFixed(3)}, ${EARTH_CENTER_UV_Y.toFixed(3)});
  float radius = ${EARTH_RADIUS_UV.toFixed(3)};
  vec2 d = uv - center;
  float r = length(d);
  if (r > radius * 1.20) return vec4(0.0);
  // rim: atmosphere reads first, before the body
  float atmo = smoothstep(radius * 1.18, radius * 1.00, r);
  float body = smoothstep(radius * 1.02, radius * 0.96, r);
  // sphere normal — clamp so the sqrt behaves at the limb
  float rn = min(1.0, r / radius);
  float z = sqrt(max(0.0, 1.0 - rn * rn));
  vec3 n = normalize(vec3(d / radius, z));
  // light from the upper-left, warm-white; the terminator is dot(n, L)
  vec3 L = normalize(vec3(-0.42, 0.55, 0.72));
  float lit = max(0.0, dot(n, L));
  float day = smoothstep(-0.05, 0.40, dot(n, L));
  // continents: a two-octave noise on the local sphere direction, thresholded
  // into a landness field. Not literal geography — a plausible world.
  float land = fbm2(n.xy * 3.6 + vec2(n.z * 2.1, -n.z * 1.3));
  float coast = smoothstep(0.48, 0.56, land);
  vec3 sea = mix(vec3(0.05, 0.09, 0.18), vec3(0.10, 0.16, 0.28), 0.5 + 0.5 * n.z);
  vec3 landLo = vec3(0.14, 0.20, 0.14);
  vec3 landHi = vec3(0.32, 0.30, 0.18);
  vec3 surface = mix(sea, mix(landLo, landHi, smoothstep(0.55, 0.75, land)), coast);
  // ice on the poles — a subtle cap on the north/south of the sphere
  float ice = smoothstep(0.72, 0.86, abs(n.y));
  surface = mix(surface, vec3(0.78, 0.82, 0.90), ice * 0.55);
  // shade: day side keeps its color, night side falls into deep indigo. A
  // narrow band of golden terminator warms the boundary.
  vec3 nightSide = surface * 0.05 + vec3(0.010, 0.014, 0.030);
  vec3 shaded = mix(nightSide, surface * (0.35 + 0.75 * lit), day);
  // terminator warmth — the boundary between night and day catches a ribbon
  // of the star's light like a real horizon does
  float term = exp(-pow((dot(n, L) - 0.02) * 6.0, 2.0));
  shaded += vec3(0.35, 0.20, 0.08) * term * 0.20;
  // atmosphere rim: pale blue at the limb, denser on the day side; also
  // breathes with the site's 7s swell so the air visibly lives.
  vec3 atmoTint = vec3(0.32, 0.52, 0.78);
  vec3 atmoLayer = atmoTint * atmo * (0.40 + 0.55 * day) * (0.85 + 0.15 * uBreath);
  vec3 c = shaded * body + atmoLayer;
  // earth-scorch: the god's touch, warm at the strike point. u_earthStrike
  // decays 1 → 0 over ~1.5s; the color cools from bright orange to a deep
  // ember red as it fades. Distance from the strike point falls off sharply
  // so the scorch is a small, precise mark, not a curtain over the sphere.
  vec2 strikePx = earthStrikeUV * radius;
  vec2 strikeD = d - strikePx;
  float strikeR = length(strikeD);
  float scorch = exp(-strikeR / (radius * 0.22)) * earthStrike;
  vec3 hot = mix(vec3(0.32, 0.06, 0.02), vec3(1.0, 0.62, 0.22), earthStrike);
  c += hot * scorch * body * 2.0;
  // alpha: the body writes fully, the atmosphere writes softly at the rim
  float a = max(body, atmo * 0.55);
  return vec4(c, a);
}

void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  uv.y = 1.0 - uv.y;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);

  // layer: cosmos — a near-black base with a faint blue-violet gradient
  // that gently sways on the shared breath. Even an empty cosmos is not
  // still: the tint drifts a percent or two with uBreath, and the horizon
  // vs. zenith carries a small warm-cold difference so the frame reads as
  // depth, not a flat wash.
  vec3 zenith = vec3(0.006, 0.008, 0.020);
  vec3 low = vec3(0.020, 0.014, 0.036);
  float depth = smoothstep(0.0, 1.0, uv.y);
  vec3 sky = mix(zenith, low, depth);
  sky += vec3(0.008, 0.006, 0.014) * (0.5 + 0.5 * uBreath);

  // layer: starfield — a dense scatter, denser than /storm's sky by a
  // factor of two, with each star its own falloff inside its cell and its
  // own breath phase. The tilt lean pushes the whole field a few percent
  // laterally so the phone's body is felt in the stars, not just anywhere.
  vec2 starUv = uv + vec2(u_tiltX * 0.02, 0.0);
  // three grids at different densities — the same technique as the seeded
  // scatter /storm's sky uses, but layered so the eye reads it as a real deep
  // field, not a flat scatter
  for (int layer = 0; layer < 3; layer++) {
    float lf = float(layer);
    vec2 grid = vec2((80.0 + lf * 60.0) * aspect, 80.0 + lf * 60.0);
    vec2 cell = floor(starUv * grid);
    float starSeed = hash(cell.x * 127.1 + cell.y * 311.7 + lf * 71.3);
    vec2 starPos = vec2(hash(starSeed * 53.7), hash(starSeed * 97.3));
    float starD = length(fract(starUv * grid) - starPos);
    float thr = 0.88 - lf * 0.02;
    float bright = 0.4 + 0.6 * fract(starSeed * 91.7);
    float twinklePhase = fract(starSeed * 17.3);
    float twinkle = 0.65 + 0.35 * sin(u_time * (0.6 + twinklePhase) + twinklePhase * 6.28);
    float star = step(thr, starSeed) * smoothstep(0.10 - lf * 0.02, 0.0, starD);
    // faint blue-white tint that shifts toward warm on the low-threshold
    // stars — a few of the brightest read as older, redder suns
    vec3 starTint = mix(vec3(0.9, 0.94, 1.0), vec3(1.0, 0.88, 0.72), step(0.97, starSeed));
    sky += starTint * star * bright * twinkle * (0.5 + 0.35 * uBreath);
  }

  // layer: galactic wisp — a faint interstellar dust cloud drifting across
  // the mid-frame at an angle. Two-octave fbm on a slowly sliding field,
  // thresholded soft so it reads as gas, not a shape. Very low amplitude:
  // the eye should sense it, not name it.
  vec2 wispUv = uv + vec2(u_tiltX * 0.015, 0.0);
  // wind picks up the wisp — a three-finger drag drifts the whole galactic
  // dust with the hand's own weather, so a gesture the eye can name lands
  float wispDrift = u_time * (0.006 + abs(u_wind) * 0.008) * (1.0 - u_reduced);
  vec2 wispRot = vec2(
    wispUv.x * 0.94 - wispUv.y * 0.34,
    wispUv.x * 0.34 + wispUv.y * 0.94
  );
  float wisp = fbm2(wispRot * 2.1 * vec2(aspect, 1.0) + vec2(wispDrift + u_wind * 0.4, -wispDrift * 0.3));
  float band = exp(-pow((uv.y - 0.52) * 3.4, 2.0));
  float wispField = smoothstep(0.42, 0.72, wisp) * band;
  vec3 wispTint = mix(vec3(0.10, 0.09, 0.20), vec3(0.28, 0.20, 0.36), wisp);
  sky += wispTint * wispField * 0.32;

  // layer: cosmic dust — a very-low-frequency haze that gathers where the
  // charge is high, so a court that is full of unspent bolts visibly
  // charges the space around it. The lens raises this into a chart.
  float dust = fbm2(uv * 3.2 * vec2(aspect, 1.0) + vec2(u_time * 0.003, 0.0));
  sky += vec3(0.045, 0.038, 0.09) * dust * (0.12 + u_charge) * (0.55 + 0.45 * uBreath);

  // layer: lens — two fingers turn the sky into its charge chart. Isolines
  // of the noise field brighten so the cosmos reads as a field, not a
  // picture, exactly the same instrument /storm carried.
  float iso = smoothstep(0.94, 1.0, sin(uv.y * 90.0)) * u_lens;
  sky += vec3(0.10, 0.09, 0.16) * iso;

  // layer: frame-wide flash — a bolt lights the whole cosmos for a frame,
  // brightest near the mid-band and falling with distance from center.
  sky += vec3(0.85, 0.82, 0.95) * u_flash * (0.35 + 0.65 * band);

  vec3 c = sky;

  // pre-ceremony dimming: a one-finger hold approaching the ceremony tier
  // dims the whole cosmos by up to 30%, so the crack lands into a darker
  // frame and the moment before feels inevitable.
  c *= 1.0 - 0.30 * u_darken;

  // the earth-in-corner — composited on top of the cosmos so its lit
  // hemisphere reads clean against the deep space around it
  vec4 earth = earthCorner(uv, u_earthStrike, u_earthStrikeUV);
  c = mix(c, earth.rgb, earth.a);

  c *= 1.0 - 0.72 * u_night;
  c *= u_brightness;
  float vig = smoothstep(1.35, 0.45, length(uv - vec2(0.5, 0.48)));
  gl_FragColor = vec4(c * (0.72 + 0.28 * vig), 1.0);
}`;

// ——— the object: a thunderhead — one house of the court.
type Thunderhead = SceneObjectState & {
  /** the store a bolt spends; hue and core brightness read it directly. */
  charge: number;
  /** the column that conducts; the anvil's reach and the strike's heat. */
  water: number;
  /** sheet lightning inside the cloud, decaying between taps. */
  flicker: number;
  vx: number;
  vy: number;
  drift: number;
};

const thunderhead: SceneObjectSpec<Thunderhead> = {
  kind: "a thunderhead",
  cap: CELL_CAP,

  born(seed, nx, ny, tMs) {
    const rng = mulberry32(seed);
    return {
      id: 0,
      seed,
      nx,
      ny: Math.max(SKY_TOP, Math.min(SKY_FLOOR, ny)),
      bornMs: tMs,
      growth: 0.15,
      sealedMs: null,
      presence: 1,
      charge: 0.18 + rng() * 0.1,
      water: 0.12 + rng() * 0.08,
      flicker: 0,
      vx: 0,
      vy: 0,
      drift: rng() * Math.PI * 2,
    };
  },

  step(s, ctx) {
    s.growth += (1 - s.growth) * Math.min(1, ctx.dt * 0.5);
    s.flicker *= 1 - Math.min(1, ctx.dt * 2.2);
    // the court drifts: its own slow orbit, the wind, and the induction the
    // room integrates into vx/vy each frame (see the pair pass in the loop)
    if (!ctx.reducedMotion) {
      s.drift += ctx.dt * (0.16 + 0.1 * Math.sin(s.seed));
      s.vx += ctx.wind * ctx.dt * 0.05;
    }
    s.vx *= 1 - Math.min(1, ctx.dt * 0.8);
    s.vy *= 1 - Math.min(1, ctx.dt * 0.8);
    s.nx = Math.min(0.96, Math.max(0.04, s.nx + s.vx * ctx.dt + (ctx.reducedMotion ? 0 : Math.sin(s.drift) * 0.004 * ctx.dt)));
    s.ny = Math.min(SKY_FLOOR, Math.max(SKY_TOP, s.ny + s.vy * ctx.dt + ctx.gravity * ctx.dt * 0.02));
  },

  emit(s, ctx, out) {
    const x = s.nx * ctx.width;
    const y = s.ny * ctx.height;
    const q = Math.min(1, s.charge);
    const anvil = (18 + s.water * 46) * (0.6 + 0.4 * s.growth);
    // the body: a wide slate anvil, breathing with the site's 7s swell
    out.push(
      x,
      y,
      anvil * (1 + ctx.breath * 0.06),
      s.drift * 0.1,
      0.12 + q * 0.25,
      0.18 + s.flicker * 0.5,
      0.4,
      s.presence * (0.5 + s.growth * 0.35),
    );
    // the core: the charge itself, read straight off the palette ramp
    out.push(
      x,
      y,
      anvil * (0.34 + q * 0.2),
      -s.drift * 0.2,
      0.45 + q * 0.55,
      0.5 + q * 0.7 + s.flicker,
      0.6 + 0.4 * ctx.breath,
      s.presence * (0.55 + q * 0.4),
    );
    // sheet lightning: a third, wide pass only while the flicker lives
    if (s.flicker > 0.02) {
      out.push(
        x,
        y,
        anvil * 1.9,
        0,
        0.95,
        s.flicker * 1.4,
        1,
        s.presence * s.flicker * 0.5,
      );
    }
  },

  verbs: [
    "touch",
    "stroke",
    "dwell",
    "ceremony",
    "tutti",
    "lens",
    "season",
    "wind",
    "dilate",
    "gravity",
    "agitate",
    "knock",
    "night",
  ],
  respond: {
    touch: (s, e) => {
      // sheet lightning inside the tapped house, scaled by how hard it landed
      s.flicker = Math.min(1.4, s.flicker + 0.35 + 0.5 * e.intensity);
      s.charge = Math.min(2, s.charge + 0.02 * e.intensity);
    },
    stroke: (s, e) => {
      s.nx = Math.min(0.96, Math.max(0.04, s.nx + e.dx));
      s.ny = Math.min(SKY_FLOOR, Math.max(SKY_TOP, s.ny + e.dy));
    },
    dwell: (s, e) => {
      // the hold keeps feeding both stores — 2400ms is visibly past 900ms,
      // and the growth saturates instead of stepping
      const feed = Math.min(0.9, e.elapsedMs / 4000);
      s.water = Math.min(1.5, s.water + feed * 0.012);
      s.charge = Math.min(2, s.charge + feed * 0.016);
      s.growth = Math.min(1, s.growth + e.elapsedMs / 80000);
    },
    // the ceremony is answered at the room level (the bolt needs the field's
    // uniforms and the thunder bus); the handler marks the house chosen so
    // the room's pass can spend it
    ceremony: (s, e) => {
      if (s.sealedMs === null) s.sealedMs = e.tMs;
    },
    tutti: (s, e) => {
      s.flicker = Math.min(1.4, s.flicker + 0.5 + 0.4 * e.intensity);
    },
    lens: (s, e) => {
      s.flicker = Math.min(1.4, s.flicker + Math.abs(e.angle) * 0.05);
    },
    season: () => {
      /* the year turns in the field; the houses keep their stores */
    },
    wind: (s, e) => {
      s.vx += e.dx * 1.6;
      s.vy += e.dy * 0.5;
    },
    dilate: (s) => {
      s.flicker = Math.min(1.4, s.flicker + 0.006);
    },
    gravity: (s, e) => {
      s.vx += e.dx * 0.01;
    },
    agitate: (s, e) => {
      // shaking the vessel is friction across the whole sky: charge builds
      s.charge = Math.min(2, s.charge + 0.06 * e.intensity);
      s.flicker = Math.min(1.4, s.flicker + 0.3 * e.intensity);
    },
    knock: (s, e) => {
      s.flicker = Math.min(1.4, s.flicker + 0.4 * e.intensity);
    },
    night: (s, e) => {
      if (e.intensity > 0.5) s.flicker = 0;
    },
  },
};

export default function Zeus() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // A second canvas on top of the shader — the bolt itself is drawn here as
  // stroked segments returned by buildBolt (src/lib/lightning.ts). Same
  // shape /storm uses; keeps the bolt anatomically branched.
  const linesRef = useRef<HTMLCanvasElement | null>(null);
  const [standing, setStanding] = useState(0);
  const letGoRef = useRef<() => void>(() => {});
  const plantRef = useRef<(nx: number, ny: number) => void>(() => {});
  const tapRef = useRef<(x: number, y: number, intensity: number, count: number) => void>(() => {});
  const voiceRef = useRef<ReturnType<typeof populationVoice> | null>(null);
  const glimmerRef = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const lines = linesRef.current;
    if (!wrap || !canvas || !lines) return;
    const lctx = lines.getContext("2d");
    if (!lctx) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const population = createPopulation(thunderhead);

    const writer = createIdleWriter(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(population.serialize()));
      } catch {
        /* quota / private mode — the sky still convenes */
      }
    });
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        // a kept sky — including a deliberately emptied one, which stays empty
        population.load(JSON.parse(raw), performance.now());
        for (const s of population.items) {
          if (typeof s.charge !== "number") s.charge = 0.2;
          if (typeof s.water !== "number") s.water = 0.15;
          s.flicker = 0;
          s.vx = 0;
          s.vy = 0;
          s.sealedMs = null;
          if (typeof s.drift !== "number") s.drift = (s.seed % 628) / 100;
        }
      } else {
        // first visit: the court convenes — three seeded houses, already
        // courting, so the sky is alive before any hand arrives
        const t0 = performance.now();
        const seats: Array<[number, number, number, number]> = [
          [0.3, 0.24, 0.42, 0.3],
          [0.62, 0.18, 0.3, 0.5],
          [0.74, 0.34, 0.55, 0.22],
        ];
        for (const [nx, ny, charge, water] of seats) {
          const s = population.spawn(nx, ny, t0) as Thunderhead;
          s.charge = charge;
          s.water = water;
        }
      }
    } catch {
      /* a clear sky */
    }
    setStanding(population.standing());

    const embedded = isEmbeddedFrame();
    const stage = createGLStage(canvas, { wrap, label: "zeus", reducedMotion: reduced, embedded });
    const prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    const layer = stage
      ? createPopulationLayer(stage, { palette: ["#3a4058", "#8f7bff", "#f5ecc9"] })
      : null;
    const buffer = createInstanceBuffer(96);

    let wind = 0;
    let agitation = 0;
    let gravity = 0;
    let season = 0;
    let timeScale = 1;
    let lensAmount = 0;
    let night = 0;
    // the vessel's own lean — read straight off gamma, pushed to u_tiltX so
    // the whole court leans and the star field shifts with the hand's grip.
    let tiltX = 0;
    // the ceremony hold's build-up — climbs while a one-finger hold is past
    // ~1500ms and still short of the ceremony act, so the sky visibly dims
    // toward the strike. Read as u_darken.
    let ceremonyDarken = 0;
    let dwellHoldMs = 0;

    // the field's strike state — one bolt at a time, decaying in the loop.
    // The bolt is a set of overlaid line segments returned by buildBolt
    // (src/lib/lightning.ts); `lightning` holds the current strike's
    // segments + a lifetime + intensity. When null, the cosmos is between
    // strikes and the overlay renders nothing.
    let flash = 0;
    let lightning: {
      t0: number;
      life: number;
      segments: BoltSeg[];
      intensity: number;
      main: boolean; // true for a ceremony bolt, false for a knock's small strike
    } | null = null;
    let strikeSeedCounter = 0;
    // the earth's answer — spikes to 1 on any ceremony strike, decays over
    // ~1.5s. The strike UV stays with it so the warm scorch stays where the
    // bolt actually landed on the sphere even after subsequent frames.
    let earthStrike = 0;
    // earthStrikeUV is a 2D offset in local earth space (in radius-units,
    // ~-1..1 on each axis) reused across frames without reallocation.
    const earthStrikeUV = { x: 0, y: 0 };

    // Pick a point on the earth's LIT hemisphere as a seeded polar coord.
    // Bias the angle toward the light direction the shader uses
    // (upper-left in local uv), so a scorch lands where a real bolt would
    // — never on the night side where nothing would see it. Reused across
    // strikes; the returned pair is copied into earthStrikeUV in place.
    const litAngle = Math.atan2(0.55, -0.42); // shader light dir, upper-left
    const pickEarthStrike = (seed: number): void => {
      const rng = mulberry32(seed);
      // radius biased by area — most strikes near the terminator, few at the
      // limb, none in the extreme rim where the sphere is glancing anyway
      const r = Math.sqrt(rng()) * 0.78;
      // angle in a wide cone around the lit direction — the whole day-side
      // hemisphere is reachable but the mean is where light strongest
      const angle = litAngle + (rng() - 0.5) * Math.PI * 1.25;
      earthStrikeUV.x = r * Math.cos(angle);
      earthStrikeUV.y = r * Math.sin(angle);
    };

    // The idle sky's own speech — after a stretch of no hand, the horizon
    // flashes softly and a low rumble arrives from beyond the frame. The
    // manifest declares this cadence (life.glimmer.after_idle_ms = 15000);
    // the literal 15000 below IS the honoured contract.
    const IDLE_FLASH_AFTER_MS = 15000;
    let lastInteractionMs = performance.now();
    let nextDistantFlashMs = performance.now() + IDLE_FLASH_AFTER_MS;
    // seed the distant-flash RNG off a small state vector so replays are
    // deterministic — nothing rolls Math.random() in the room (AGENTS.md §5).
    const distantRng = mulberry32(0x2eef);
    // the knock counter — advanced each time the vessel is rapped so the
    // seeded pick of a struck house is a pure function of the visit's state.
    let knockCount = 0;

    // On any hand act the sky's own patience resets so the ambient speech
    // does not clip a real gesture.
    const noteInteraction = (tMs: number) => {
      lastInteractionMs = tMs;
      // wait a fresh full idle window before the sky speaks unprompted
      nextDistantFlashMs = tMs + IDLE_FLASH_AFTER_MS;
    };

    // the peal — the top rung: houses answer in nearest-first order, one
    // voice per PEAL_STAGGER_MS, driven by the frame clock (never a timer)
    const pealQueue: number[] = [];
    let pealDueMs = 0;

    // Distance from center → audio delay. A bolt at the edge of the sky
    // arrives at the ear ~200-800ms after the eye caught it, and that
    // perceptual latency IS the sky's depth. Center strikes ring immediately.
    const strikeDelaySec = (nx: number): number => {
      const off = Math.abs(nx - 0.5) * 2; // 0..1
      return 0.2 * off + 0.6 * off * off; // 0 at center, ~0.8s at rim
    };

    // Pick the thunder's layer count from the current tier — the low tier
    // gets the sub-bass alone, medium drops the noise tail, high runs full.
    const thunderLayers = (): number => {
      const t = gov.tier();
      if (t === "low" || t === "sleep") return 1;
      if (t === "medium") return 2;
      return 3;
    };

    const discharge = (s: Thunderhead, tMs: number, solo: boolean) => {
      const energy = boltEnergy(s.charge, s.water);
      flash = Math.min(1, 0.5 + energy * 0.3);
      // the earth answers: the god's touch lands warm on the lit hemisphere
      // and decays over ~1.5s. Solo bolts (the ceremony) burn the hottest.
      // The strike UV is a seeded pick on the lit half of the sphere so
      // replays land the same mark; the pick uses the strike seed so every
      // ceremony bolt scorches a different point on the world.
      strikeSeedCounter = (strikeSeedCounter + 1) | 0;
      const strikeSeed = boltHashSeed(
        Math.floor(s.seed) | 0,
        strikeSeedCounter,
        Math.floor(s.nx * 10000),
      );
      pickEarthStrike(strikeSeed);
      earthStrike = Math.min(1, solo ? 1 : 0.7 + energy * 0.2);
      fireBolt(s, energy, tMs, solo, strikeSeed);
      const delaySec = strikeDelaySec(s.nx);
      // the thunder is the ledger: pitch reads the strike, length rides it —
      // and the whole clap layers a sub-bass thump, a mid-band discharge,
      // and a filtered rumble tail scaled by the bolt's own energy.
      audio.playThunder(energy, delaySec, thunderLayers());
      audio.playTone(thunderHz(energy), Math.min(1.6, 0.5 + energy * 0.5), delaySec);
      audio.thud();
      if (solo) haptics.storm();
      else haptics.chop();
      s.charge = 0;
      s.presence = 0.999; // spent — the house leaves the cosmos it lit
      writer.schedule();
    };

    // A small strike — the knock on the vessel's back. Half the flash, no
    // earth-scorch (the strike is local to the source cell, it does NOT
    // arc across the cosmos), and it does NOT spend the house — the sky
    // answers the knock as with any storm-god propitiation.
    const smallStrike = (s: Thunderhead, tMs: number) => {
      const energy = boltEnergy(s.charge * 0.55, s.water * 0.7);
      flash = Math.min(1, Math.max(flash, 0.35 + energy * 0.2));
      strikeSeedCounter = (strikeSeedCounter + 1) | 0;
      const strikeSeed = boltHashSeed(
        Math.floor(s.seed) | 0,
        strikeSeedCounter,
        Math.floor(s.nx * 10000),
      );
      fireBolt(s, energy, tMs, false, strikeSeed);
      const delaySec = strikeDelaySec(s.nx);
      audio.playThunder(energy * 0.6, delaySec, Math.max(1, thunderLayers() - 1));
      s.flicker = Math.min(1.4, s.flicker + 0.7);
      s.charge = Math.max(0, s.charge - 0.15);
      writer.schedule();
    };

    // Populate the lightning overlay for one strike. Called by discharge()
    // and smallStrike() so every visible bolt goes through the shared
    // fractal — no shader-drawn jag alongside a 2D-drawn tree, always one
    // consistent geometry. Solo (ceremony) bolts are bigger and arc across
    // the entire frame to the earth-in-corner; a small strike stays local
    // to its source cell so a knock reads as sheet lightning, not judgement.
    const fireBolt = (s: Thunderhead, energy: number, tMs: number, solo: boolean, seed: number) => {
      const rect = lines.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (!w || !h) return;
      // origin: the source house's position. A ceremony bolt fires from the
      // exact cell that spent itself; a small strike fires from just above
      // the house so it reads as a local flash and not a landing.
      const x0 = s.nx * w;
      const y0 = h * (solo ? Math.max(SKY_TOP, s.ny - 0.02) : Math.max(SKY_TOP + 0.02, s.ny - 0.04));
      let hitX: number;
      let hitY: number;
      if (solo) {
        // terminus: a point on the lit hemisphere of the earth-in-corner.
        // The shader's uv has y=0 at the bottom (after the flip), so the
        // canvas y is (1 - earth_uv_y) * h. earthStrikeUV is in radius-units
        // and was already picked in discharge() from the same seeded stream
        // so the bolt's fractal seed and the scorch's location share their
        // history.
        hitX = (EARTH_CENTER_UV_X + earthStrikeUV.x * EARTH_RADIUS_UV) * w;
        hitY = (1 - EARTH_CENTER_UV_Y - earthStrikeUV.y * EARTH_RADIUS_UV) * h;
      } else {
        // small strike: land near the source house, a short local jag
        hitX = x0;
        hitY = Math.min(h - 4, h * s.ny + h * 0.06);
      }
      const segments = buildBolt(x0, y0, hitX, hitY, {
        ...DEFAULT_BOLT_CFG,
        // one more generation than storm — zeus's bolts are the room's
        // solemn act, so give them more visible fractal detail. Ceremony
        // bolts cross the whole frame so the extra depth reads as reach.
        generations: solo ? 8 : 5,
        displacement: w * DEFAULT_BOLT_CFG.displacement,
      }, seed);
      lightning = {
        t0: tMs,
        life: solo ? 0.48 : 0.28, // ceremony bolts linger a beat longer
        segments,
        intensity: 0.55 + energy * 0.5,
        main: solo,
      };
    };

    const nearestStanding = (nx: number, ny: number): Thunderhead | null => {
      let best: Thunderhead | null = null;
      let bestD2 = Infinity;
      for (const s of population.items) {
        if (s.presence < 1) continue;
        const dx = s.nx - nx;
        const dy = s.ny - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = s;
        }
      }
      return best;
    };

    const spawnWith = (nx: number, ny: number, charge: number, water: number, tMs: number) => {
      const born = population.spawn(nx, ny, tMs) as Thunderhead;
      born.charge = charge;
      born.water = water;
      born.flicker = 0.8;
      born.vx = 0;
      born.vy = 0;
      born.drift = (born.seed % 628) / 100;
      writer.schedule();
      return born;
    };

    // ——— the tap ladder: 1 / 3 / 5 / n, real fidelity at the top.
    tapRef.current = (x, y, intensity, count) => {
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      const nx = x / width;
      const ny = y / height;
      const tMs = performance.now();
      noteInteraction(tMs);
      const tier = tapTrainTier(count);
      const depth = tapTrainDepth(count);

      if (tier === "n") {
        // the peal — the verdict: every house answers, nearest-first from
        // the hand, each strike its own pitch on the ledger
        const standingCells = population.items.filter((s) => s.presence >= 1);
        if (standingCells.length === 0) return;
        const near = nearestStanding(nx, ny);
        const startIdx = near ? standingCells.indexOf(near) : 0;
        const order = pealOrder(standingCells, Math.max(0, startIdx));
        pealQueue.length = 0;
        for (const i of order) pealQueue.push(standingCells[i].id);
        pealDueMs = tMs;
        haptics.roll();
        return;
      }
      if (tier === 5) {
        // the summons: the two nearest houses are called into one, now
        let a: Thunderhead | null = null;
        let b: Thunderhead | null = null;
        let bestD2 = Infinity;
        const alive = population.items.filter((s) => s.presence >= 1);
        for (let i = 0; i < alive.length; i++) {
          for (let j = i + 1; j < alive.length; j++) {
            const dx = alive[i].nx - alive[j].nx;
            const dy = alive[i].ny - alive[j].ny;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
              bestD2 = d2;
              a = alive[i];
              b = alive[j];
            }
          }
        }
        if (!a || !b) return;
        const m = mergeCells(a, b);
        a.presence = 0.999;
        b.presence = 0.999;
        spawnWith(m.nx, m.ny, m.charge, m.water, tMs);
        flash = Math.min(1, 0.35 + 0.3 * intensity);
        const summonsEnergy = boltEnergy(m.charge, m.water);
        audio.playTone(thunderHz(summonsEnergy) * 2, 0.5, strikeDelaySec(m.nx));
        audio.bell();
        haptics.roll();
        return;
      }
      if (tier === 3) {
        // the calving: the tapped house pays real stores to stand a satellite
        const s = nearestStanding(nx, ny);
        if (!s) return;
        const u = ((s.seed >>> 3) % 1000) / 1000;
        const { parent, child } = calve(
          { nx: s.nx, ny: s.ny, charge: s.charge, water: s.water },
          u,
        );
        s.charge = parent.charge;
        s.water = parent.water;
        s.flicker = Math.min(1.4, s.flicker + 0.6);
        spawnWith(
          Math.min(0.96, Math.max(0.04, child.nx)),
          Math.min(SKY_FLOOR, Math.max(SKY_TOP, child.ny)),
          child.charge,
          child.water,
          tMs,
        );
        audio.spark();
        haptics.tap();
        return;
      }
      // tier 1: sheet lightning in the nearest house, scaled by the hand
      const e = createVerbEvent();
      e.verb = "touch";
      e.nx = nx;
      e.ny = ny;
      e.intensity = intensity * (0.7 + 0.3 * depth);
      e.tMs = tMs;
      if (population.route(e) > 0) {
        audio.playTone(180 + 120 * intensity, 0.25);
        haptics.ripple(0.25 + 0.3 * intensity);
      }
    };

    // The ceremony's 120ms silence before the crack: the ceremony verb queues
    // the discharge and clears the sealed mark; the loop reads this timer and
    // fires when it passes. Anticipation as a felt beat, not just a shape.
    let pendingCeremony: { sealed: Thunderhead; readyMs: number } | null = null;

    voiceRef.current = populationVoice(population, {
      size: () => ({ width: wrap.clientWidth, height: wrap.clientHeight }),
      now: () => performance.now(),
      onSpawn: (s) => {
        (s as Thunderhead).ny = Math.min(SKY_FLOOR, Math.max(SKY_TOP, s.ny));
        audio.chime();
        haptics.ripple(0.5);
        writer.schedule();
      },
      onAnswered: (e, answered) => {
        if (answered > 0) writer.schedule();
        // dwell — the hand feels the store deepening under it: a light tap
        // per acknowledgement, so the third sense lands with each answered
        // pass rather than only at the ceremony's cliff.
        if (e.verb === "dwell" && answered > 0) haptics.tap();
        if (e.verb === "ceremony") {
          // the sealed house is the chosen one — queue the strike so the
          // 120ms silence lands as anticipation, then discharge at the room
          // level where the bolt and the thunder live.
          for (const s of population.items) {
            if (s.sealedMs !== null && s.presence >= 1) {
              s.sealedMs = null;
              pendingCeremony = { sealed: s as Thunderhead, readyMs: e.tMs + 120 };
              // brief silence: nothing crackles for 120ms — the pause IS the beat
              break;
            }
          }
        }
      },
      world: {
        wind: (dx) => {
          wind = Math.max(-1, Math.min(1, wind + dx * 2.2));
        },
        season: (angle) => {
          season = (season + angle / (Math.PI * 2) + 1) % 1;
        },
        agitate: (intensity) => {
          agitation = Math.min(1, agitation + intensity);
        },
        gravity: (_beta, gamma) => {
          gravity = Math.max(-1, Math.min(1, gamma / 45));
          // tilt lean: the vessel's gamma pushes the whole cloud band and
          // the star field laterally so a tilt visibly leans the court, not
          // just the drift. Clamped to ±1 → ~4% of frame width max.
          tiltX = Math.max(-1, Math.min(1, gamma / 45));
        },
        timeScale: (k) => {
          timeScale = k;
        },
      },
    });
    // the ladder replaces the default single-rung tap; the lens dims the
    // court into its chart while the twist lives; knock and shake land in
    // the sky as the vessel's own speech.
    const baseVoice = voiceRef.current;
    voiceRef.current = {
      ...baseVoice,
      tap: (t) => {
        if (t.fingers !== 1) return;
        tapRef.current(t.x, t.y, t.intensity, t.count);
      },
      tutti: (t) => {
        // tap3 — sheet lightning in every house at once, felt as a long roll
        haptics.roll();
        baseVoice.tutti?.(t);
      },
      deepen: (d) => {
        // one-finger hold: track how long the hand has been resting so the
        // sky can dim toward the ceremony. The engine's `deepen` fires only
        // for the finger-material hold — three-finger holds route through
        // `timeScale`, so there is nothing to gate here.
        dwellHoldMs = d.elapsed;
        noteInteraction(performance.now());
        baseVoice.deepen?.(d);
      },
      lens: (l) => {
        // twist raises the chart lens; the two soft clicks are the hand's
        // receipt that the sky turned.
        lensAmount = Math.max(0, Math.min(1, lensAmount + l.angle * 0.25));
        haptics.lens();
        noteInteraction(performance.now());
        baseVoice.lens?.(l);
      },
      knock: (k) => {
        // vessel knock: the sky answers propitiation with a small strike
        // from one standing house — not a full ceremony bolt, just a bright
        // flicker and a short thunder. The pick is a pure function of the
        // knock count and the population's own seeds, so a replay of the
        // same knocks lands the same houses. Study Fire.tsx's vessel binding
        // for how the phone's own body becomes the other hand.
        const alive = population.items.filter((s) => s.presence >= 1);
        if (alive.length > 0) {
          knockCount = (knockCount + 1) | 0;
          const rng = mulberry32((knockCount * 2654435761) ^ (alive[0].seed | 0));
          const idx = Math.floor(rng() * alive.length) % alive.length;
          const pick = alive[idx] as Thunderhead;
          smallStrike(pick, performance.now());
        }
        haptics.detent();
        noteInteraction(performance.now());
        baseVoice.knock?.(k);
      },
      scatter: (s) => {
        // shake — friction across the sky, felt as a stutter
        haptics.chop();
        noteInteraction(performance.now());
        baseVoice.scatter?.(s);
      },
      night: (n) => {
        night = n.faceDown ? 1 : 0;
        baseVoice.night?.(n);
      },
    };

    plantRef.current = (nx, ny) => {
      const tMs = performance.now();
      spawnWith(nx, Math.min(SKY_FLOOR, Math.max(SKY_TOP, ny)), 0.2, 0.15, tMs);
      audio.chime();
      haptics.ripple(0.5);
      noteInteraction(tMs);
      setStanding(population.standing());
    };
    glimmerRef.current = () => {
      // physical, wordless: the eldest house murmurs once
      let eldest: Thunderhead | null = null;
      for (const s of population.items) {
        if (s.presence < 1) continue;
        if (!eldest || s.bornMs < eldest.bornMs) eldest = s;
      }
      if (eldest) eldest.flicker = Math.min(1.4, eldest.flicker + 0.5);
    };
    letGoRef.current = () => {
      population.letGo();
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ kind: population.spec.kind, items: [] }),
        );
      } catch {
        /* noop */
      }
      writer.cancel();
      setStanding(0);
      audio.thud();
      haptics.roll();
    };

    // Embedded (gallery iframe) starts one tier down: DPR ceiling and detail
    // are lower before the frame governor's ema has a chance to react.
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let hidden = false;
    let galleryPaused = false;
    const offVisibility = onVisibility((h) => {
      hidden = h;
      if (h) gov.force("sleep");
    });
    // Wave-1 gallery pause: when ScrollingGallery scrolls the iframe out of
    // view the parent posts `{ pause: true }`. Zeus honours that alongside
    // document.hidden so the RAF sleeps and the sky pays nothing while off
    // screen — same shape as /aphros and /sea.
    const offGalleryPause = onGalleryPause((p) => {
      galleryPaused = p;
      if (p) gov.force("sleep");
    });

    const step: StepContext = {
      dt: 0,
      tMs: 0,
      breath: 0.5,
      detail: 1,
      wind: 0,
      gravity: 0,
      agitation: 0,
      season: 0,
      timeScale: 1,
      reducedMotion: reduced,
    };

    let raf = 0;
    let last = performance.now();
    let lastStanding = population.standing();
    const draw = (t: number) => {
      const tier = gov.beginFrame(t);
      // Hidden OR gallery-paused → the RAF still ticks so the mount can
      // restart cleanly, but no simulation, no shader draw, no audio; the
      // frame budget for the off-screen room is essentially zero.
      if (hidden || galleryPaused) {
        last = t;
        raf = requestAnimationFrame(draw);
        return;
      }
      const detail = detailForTier(tier);
      const dt = Math.min(0.05, (t - last) / 1000) * timeScale;
      last = t;
      const tSec = audio.getAudioTime() ?? t / 1000;

      wind *= 0.99;
      agitation *= 0.96;
      lensAmount *= 0.985;
      flash *= 1 - Math.min(1, dt * 5);
      // Bolt lifetime is stored on the `lightning` state itself now (t0 +
      // life), not a decayed amplitude — the overlay pass reads age vs life
      // and fades naturally.
      // earth-scorch cools over ~1.5s regardless of frame rate
      earthStrike *= 1 - Math.min(1, dt / 1.5);
      if (earthStrike < 0.001) earthStrike = 0;
      // pre-ceremony darken climbs while a one-finger hold is past ~1500ms
      // and there IS a standing house to spend; it decays fast on release
      // so a hand that lifts short of ceremony leaves the sky bright again.
      const inHold = dwellHoldMs > 1500;
      const darkenTarget = inHold ? Math.min(0.9, (dwellHoldMs - 1500) / 900) : 0;
      const darkenRate = inHold ? 3 : 6;
      ceremonyDarken += (darkenTarget - ceremonyDarken) * Math.min(1, dt * darkenRate);
      // Reset dwellHoldMs when no active hold — the shell's deepen stops
      // firing, so if the last event is stale by ~250ms we count the hand
      // as lifted. dwellHoldMs is stamped from d.elapsed on each deepen.
      if (t - lastInteractionMs > 250) dwellHoldMs = 0;

      // ——— the ceremony's pause becomes the crack. Fire the queued
      // discharge once the 120ms silence has passed. Anticipation lands as
      // a felt beat, not a shape drawn in the shader.
      if (pendingCeremony && t >= pendingCeremony.readyMs) {
        const chosen = pendingCeremony.sealed;
        pendingCeremony = null;
        if (chosen.presence >= 1) discharge(chosen, t, true);
        setStanding(population.standing());
        ceremonyDarken = 0;
        dwellHoldMs = 0;
      }

      // ——— the sky's own speech at rest. After ~15s of no hand, a distant
      // sheet flash appears on the horizon and a low delayed rumble arrives
      // from beyond the frame; the interval reseeds to 6-14s so the sky
      // reminds the visitor it is there without a clock. Skip on low tier
      // so the frame budget for the primary material is protected.
      if (
        tier !== "low" && tier !== "sleep" &&
        !reduced &&
        t >= nextDistantFlashMs &&
        t - lastInteractionMs > IDLE_FLASH_AFTER_MS
      ) {
        const bias = distantRng();
        // one of two horizons — pick a side; edge, not center
        const side = distantRng() > 0.5 ? 1 : -1;
        const fx = 0.5 + side * (0.25 + bias * 0.22);
        // very soft — 60% of the sitting flash + a small nudge
        flash = Math.min(1, flash * 0.6 + 0.10 + 0.06 * bias);
        // and a distant low rumble, delayed so it feels far
        const distEnergy = 0.05 + 0.12 * bias;
        audio.playThunder(distEnergy, 0.5 + 0.3 * bias, Math.max(1, thunderLayers() - 1));
        // reschedule 6-14s ahead
        nextDistantFlashMs = t + 6000 + Math.floor(distantRng() * 8000);
        // distant flashes are far from the earth — they light the cosmos
        // but leave the world unmarked. Do NOT set earthStrike here; the
        // scorch stays reserved for the god's ceremony touch. `fx` is only
        // used inside this block; the frame-wide flash above carries the
        // visual, so no earth uniform mutation is needed.
        void fx;
      }

      // ——— the court's own politics: induction between every standing pair,
      // and the union of any two whose anvils touch. CELL_CAP is 12, so the
      // pass is at most 66 pairs — O(population²) at a size where that is
      // cheaper than any structure that would avoid it. At most one union
      // resolves per frame: the merged cell lands near its retiring parents,
      // and letting it re-merge inside the same pass would grow `items`
      // faster than the loop walks it. A frame later is soon enough for the
      // next contact — 16ms is invisible, an unbounded pass is a hang.
      const items = population.items;
      const pairCount = items.length;
      let totalCharge = 0;
      let merged = false;
      for (let i = 0; i < pairCount; i++) {
        const a = items[i];
        if (a.presence < 1) continue;
        totalCharge += Math.min(1, a.charge) * 0.34;
        for (let j = i + 1; j < pairCount; j++) {
          const b = items[j];
          if (b.presence < 1) continue;
          const pull = attraction(a, b);
          a.vx += pull.ax * dt * 6;
          a.vy += pull.ay * dt * 6;
          b.vx -= pull.ax * dt * 6;
          b.vy -= pull.ay * dt * 6;
          if (!merged && inContact(a, b)) {
            merged = true;
            const m = mergeCells(a, b);
            a.presence = 0.999;
            b.presence = 0.999;
            const born = spawnWith(m.nx, Math.min(SKY_FLOOR, Math.max(SKY_TOP, m.ny)), m.charge, m.water, t);
            born.flicker = 1.2;
            const energy = boltEnergy(m.charge, m.water);
            flash = Math.min(1, 0.4 + energy * 0.2);
            // a merge is a lesser peal — layered thunder, no earth strike;
            // the union RINGS but does not spend itself on the world.
            audio.playThunder(energy * 0.5, strikeDelaySec(m.nx), Math.max(1, thunderLayers() - 1));
            audio.playTone(thunderHz(energy) * 1.5, 0.7, strikeDelaySec(m.nx));
            haptics.roll();
            break; // a is spent — its remaining pairs are moot
          }
        }
      }
      totalCharge = Math.min(1, totalCharge + agitation * 0.4);

      // ——— the peal walks its queue on the frame clock
      if (pealQueue.length > 0 && t >= pealDueMs) {
        const id = pealQueue.shift();
        const s = items.find((c) => c.id === id && c.presence >= 1);
        if (s) discharge(s, t, false);
        pealDueMs = t + PEAL_STAGGER_MS / Math.max(0.05, timeScale);
      }

      step.dt = dt;
      step.tMs = t;
      step.breath = reduced ? 0.5 : Math.sin(tSec * Math.PI * 2 * 0.14) * 0.5 + 0.5;
      step.detail = detail.particles;
      step.wind = wind;
      step.gravity = gravity;
      step.agitation = agitation;
      step.season = season;
      step.timeScale = timeScale;
      population.step(step);

      if (stage) {
        const size = stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: agitation, reducedMotion: reduced }),
          prog,
        );
        prog?.setFloat("u_wind", wind);
        prog?.setFloat("u_charge", totalCharge);
        prog?.setFloat("u_flash", flash);
        prog?.setFloat("u_night", night);
        // season is still tracked in JS (three-finger twist still cycles it)
        // but the cosmos has no seasons the way a peak had; the uniform is
        // dropped from the shader and the setFloat call would silently no-op
        prog?.setFloat("u_lens", lensAmount);
        prog?.setFloat("u_earthStrike", earthStrike);
        prog?.setVec2("u_earthStrikeUV", earthStrikeUV.x, earthStrikeUV.y);
        prog?.setFloat("u_tiltX", tiltX);
        prog?.setFloat("u_darken", ceremonyDarken);
        quad?.draw();
        buffer.reset();
        population.emit(
          {
            width: size.width,
            height: size.height,
            tMs: t,
            breath: step.breath,
            detail: detail.particles,
            reducedMotion: reduced,
          },
          buffer,
        );
        layer?.draw(buffer);
      }

      // ——— the bolt overlay: the shared fractal on top of the shader pass.
      // The shader owns the cosmos, the earth-in-corner, the frame-wide
      // flash and the earth-scorch (u_earthStrike / u_earthStrikeUV are
      // already pushed above); the bolt
      // itself is a set of stroked segments layered on top of everything,
      // additive-blended so it reads as light on top of the world. Same
      // stroke grammar /storm uses — glow underlay, branches, main channel
      // — so a visitor moving between the two rooms sees the same anatomy.
      {
        const w = lines.clientWidth;
        const h = lines.clientHeight;
        if (w > 0 && h > 0) {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const pxW = Math.round(w * dpr);
          const pxH = Math.round(h * dpr);
          if (lines.width !== pxW || lines.height !== pxH) {
            lines.width = pxW;
            lines.height = pxH;
            lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
          lctx.clearRect(0, 0, w, h);
          if (lightning) {
            const age = (t - lightning.t0) / 1000;
            if (age >= lightning.life) {
              lightning = null;
            } else {
              const k = Math.max(0, 1 - age / lightning.life);
              // deterministic flicker via a sine on t — no Math.random in
              // the render loop (AGENTS.md §5). Two out-of-phase sines
              // combine so the flicker doesn't repeat cleanly.
              const flick = 0.55 + 0.25 * Math.sin(t * 0.041) + 0.20 * Math.sin(t * 0.089 + 1.2);
              const a = Math.pow(k, 1.3) * flick * lightning.intensity;
              lctx.save();
              lctx.globalCompositeOperation = "screen";
              lctx.lineCap = "round";
              lctx.lineJoin = "round";
              // soft glow underlay — the whole bolt lit from within
              lctx.strokeStyle = `rgba(159, 132, 255, ${a * 0.34})`;
              lctx.lineWidth = 9;
              lctx.beginPath();
              for (const sg of lightning.segments) {
                lctx.moveTo(sg.x0, sg.y0);
                lctx.lineTo(sg.x1, sg.y1);
              }
              lctx.stroke();
              // branches — thinner and slightly amber for the storm-god palette
              lctx.strokeStyle = `rgba(227, 198, 107, ${Math.min(1, a * 0.9)})`;
              lctx.lineWidth = 1.1;
              lctx.beginPath();
              for (const sg of lightning.segments) {
                if (sg.main) continue;
                lctx.moveTo(sg.x0, sg.y0);
                lctx.lineTo(sg.x1, sg.y1);
              }
              lctx.stroke();
              // bright main channel — the bolt itself, hottest at the core
              lctx.strokeStyle = `rgba(245, 236, 201, ${Math.min(1, a * 1.3)})`;
              lctx.lineWidth = lightning.main ? 2.6 : 1.9;
              lctx.beginPath();
              for (const sg of lightning.segments) {
                if (!sg.main) continue;
                lctx.moveTo(sg.x0, sg.y0);
                lctx.lineTo(sg.x1, sg.y1);
              }
              lctx.stroke();
              lctx.restore();
            }
          }
        }
      }

      const n = population.standing();
      if (n !== lastStanding) {
        lastStanding = n;
        setStanding(n);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      offVisibility();
      offGalleryPause();
      writer.flush();
      layer?.dispose();
      quad?.dispose();
      stage?.dispose();
      voiceRef.current = null;
    };
  }, []);

  const letGo = useCallback(() => letGoRef.current(), []);

  return (
    <RoomShell
      route="/zeus"
      surfaceRef={wrapRef}
      voice={voiceRef.current ?? undefined}
      letGo={{ label: "let the sky go", onLetGo: letGo, visible: standing > 0 }}
      onGlimmer={() => glimmerRef.current()}
      keyboard={{
        enter: () => plantRef.current(0.5, 0.3),
        enterHeld: (elapsed) => plantRef.current(0.28 + ((elapsed / 4000) % 0.44), 0.3),
      }}
      style={{ position: "fixed", inset: 0, background: "#05070f" }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={canvasRef}
          role="application"
          tabIndex={0}
          aria-label="a court of cosmic thunderheads adrift in deep space above the small earth — rest a finger and a house gathers, hold to the ceremony and it spends itself in one bolt across the cosmos to the world"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        />
        {/* the bolt overlay — every strike's fractal segments live here on
            top of the shader. Pointer-events off so the shader canvas keeps
            catching the hand; aria-hidden because the bolt speaks through
            sound + the earth-scorch below it, not through this layer. */}
        <canvas
          ref={linesRef}
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        />
      </div>
    </RoomShell>
  );
}
