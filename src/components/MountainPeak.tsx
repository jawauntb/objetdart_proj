"use client";

/**
 * /mountain — the wanderer above the sea of fog. The olympus band at
 * ~10³·⁹ m, a peak standing kilometres over a valley tens of kilometres
 * wide (docs/plans/life-and-vista-bands.md §2).
 *
 * The invariant is two numbers: a heightfield seed and a fog altitude
 * (src/lib/heightfield.ts). What is peak, what is island and what is
 * drowned is a function of those two and nothing else.
 *
 * **The range is ray-marched, one ray per pixel.** The heightfield module
 * is a closed-form per-ray function with analytic gradients — which is
 * exactly what a fragment shader wants — and it is now rendered as one:
 * `src/lib/heightfield.ts` emits its own GLSL (the same arithmetic, the
 * shared constants injected from the exported numbers, the seed's horns
 * and offset passed in as uniforms so nothing is hashed twice), and the
 * shader marches it. What that buys, which no amount of painting could:
 * a continuous ridge line instead of thirteen flat distance cards, a real
 * normal from the closed-form gradient, self-shadowing along the sun's own
 * direction, aerial perspective from the fog's closed-form optical depth
 * integrated along each ray, snow that accumulates by slope and aspect
 * rather than as a pasted cap, and the glacier and cornice classification
 * the heightfield already computes, shaded rather than stencilled.
 *
 * The painter's-algorithm ring renderer it replaces is kept below, behind
 * a `getContext` guard, and still draws the room where WebGL will not.
 *
 * The load-bearing map is fog altitude → the sea. The fog is a real
 * exponential-height volume, not a painted band: its optical depth along
 * any ray has a closed form, so what survives the distance is computed
 * rather than guessed, and its top rolls with a swell that is additive and
 * independent of the altitude. That last part is why raising the fog can
 * only ever drown more land — lift it and the ridges become an
 * archipelago, and the same water idiom that fills these valleys is the
 * one waiting one band down. Descend from the peak and the fog you were
 * standing above resolves into the actual sea.
 *
 * Where it rests is not a constant. A constant would drown one seed's
 * range and leave the next bare, so the room finds the inversion layer the
 * way weather does: a quantile of the land in a ring around the summit.
 * Whatever the seed, some of the range is always an archipelago.
 *
 * The figure with his back to us is not drawn. You are him, standing on a
 * ledge of the outcrop a hundred metres above the inversion — found by
 * walking down the summit cone until the ground reaches that altitude,
 * because a marched room cannot cheat the station the way a painted one
 * could: stand at the apex and the whole frame is the rock you are inside.
 *
 * One finger turns the head and pitches the look — down the slope toward
 * the feet, up into the horns — two fingers are the frame (pan, the lens, a
 * step back), three are the world-law (weather, season, time), and the
 * vessel is the body: tilt rolls the horizon and tips the gaze with beta,
 * shake sends scree down, a knock on the case rings the peak, face-down is
 * night, and a breath draws the fog down off the range.
 *
 * A call is answered: tap and the ridge under your finger answers at the
 * delay its distance actually implies, lower the further it stands.
 *
 * Everything breathes on the shared 7s clock — the fog settles on the
 * exhale and lifts on the draw.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures, enableBreath } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel, requestVessel } from "@/lib/vessel";
import { shouldInvite } from "@/lib/candle";
import LetGo from "@/components/LetGo";
import {
  kickScree,
  stepScree,
  placeCairn,
  cairnStonesForHold,
  nearestCairnIndex,
  screeCairnHits,
  mulberry32,
  mix32,
  type Scree,
  type Cairn,
} from "@/lib/mountain";
import {
  FOG_BREATH_KM,
  MARCH_REFINE,
  MARCH_STEPS,
  OCTAVES_MARCH,
  OCTAVES_SHADE,
  PITCH_MAX,
  PITCH_MIN,
  SUN_NIGHT_ELEVATION,
  applyCameraPitch,
  callAnswer,
  clampPitch,
  echoMidi,
  fogSurfaceAt,
  fogTransmittance,
  groundAt,
  heightfieldGlsl,
  materialFromGround,
  packHorns,
  paletteForSun,
  pitchFromVesselBeta,
  restingFogAltitude,
  seedOffset,
  snowlineKm,
  stationFor,
  sunDirection,
  viewBearingFor,
  windVector,
  windVoice,
  type SkyPalette,
} from "@/lib/heightfield";
import { formatShaderError } from "@/lib/webgl/sizing";
import {
  onVisibility,
  onGalleryPause,
  resolveDpr,
  createIdleWriter,
  createFrameGovernor,
  isEmbeddedFrame,
  detailForTier,
  type QualityTier,
} from "@/lib/room-runtime";

const STORAGE_KEY = "objetdart:mountain:v1";
const MAX_CAIRNS = 16;
/** One mountain, always yours. */
const SEED = 0x0a1a;

/** The ranges the eye actually resolves, in km. Near ones get more octaves. */
// Only the 2D fallback paints these now: thirteen distance cards, near to
// far. The shader has no ranges at all — it has a ray.
const RANGES = [0.26, 0.85, 1.5, 2.2, 2.8, 3.5, 4.3, 5.2, 6.2, 7.4, 8.8, 12, 16];
/** Cold gray rock — desaturated, a little blue in the shadow grain. */
const ROCK: [number, number, number] = [0.38, 0.37, 0.36];
/** High alpine snow: near-white with a cool cast, never warm paper. */
const SNOW: [number, number, number] = [0.96, 0.975, 0.995];
/** Glacier ice tongue — deep blue that reads as ice, not chalk. */
const GLACIER: [number, number, number] = [0.28, 0.52, 0.72];
/** Cool fill that lands on shaded snow and the lee of a ridge. */
const SHADOW_COOL: [number, number, number] = [0.55, 0.68, 0.88];
// A real pinhole, and a long lens. 66° made every ridge a low bump: apparent
// rise is focal-limited, and the massif's crests stand only ~0.26km over the
// inversion at 4km. 35° is also simply how the mountain photographs that
// prompted this room were taken — telephoto compression is what makes a peak
// tower. focal is derived from it rather than guessed.
const FOV = 0.62;
/** Two-finger tap steps the frame back — a wider lens, never past this. */
const FOV_MAX = 1.05;
const FOV_STEP = 0.11;
/** A cairn is reachable within this fraction of the frame's height. */
const CAIRN_TOUCH_R = 0.06;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const rgb = (c: [number, number, number], a = 1) =>
  `rgba(${Math.round(clamp01(c[0]) * 255)},${Math.round(clamp01(c[1]) * 255)},${Math.round(
    clamp01(c[2]) * 255,
  )},${a})`;
const mixc = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/**
 * The room, per pixel. Everything about the *field* comes from
 * `heightfieldGlsl()` — the same functions the suite checks in node. What
 * is written here is only what a renderer owes: a camera, a sun, a shadow
 * ray, and the survey lens.
 */
const FRAG_SRC = `
precision highp float;
${heightfieldGlsl()}

uniform vec2 uRes;
uniform float uHorizonPx;   // level horizon, drawing-buffer px from the bottom
uniform float uFocal;       // pinhole focal length, drawing-buffer px
uniform float uRoll;        // the vessel's own horizon
uniform float uYaw;
uniform float uPitch;       // head pitch, radians — negative looks to the feet
uniform vec3 uEye;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uZenith;
uniform vec3 uHorizonCol;
uniform vec3 uFogCol;
uniform vec3 uRock;
uniform vec3 uSnow;
uniform vec3 uGlacier;
uniform vec3 uShadowCool;
uniform float uAmbient;
uniform float uSunI;
uniform float uFogAlt;
uniform float uPhase;
uniform float uSnowKm;
uniform vec2 uWind;
uniform float uLens;
uniform float uTutti;
uniform int uSteps;
uniform int uRefine;
uniform int uShadowSteps;
uniform int uMarchOct;
uniform int uShadeOct;

/**
 * The sun's own ray, from the ground up. Free with a marched room and
 * impossible with a painted one: the far side of a ridge is dark because
 * the ridge is standing in the way, not because a rule said so.
 */
float softShadow(vec3 p, vec3 sun, int steps) {
  float res = 1.0;
  float t = 0.03;
  for (int i = 0; i < 24; i++) {
    if (i >= steps) break;
    vec3 q = p + sun * t;
    if (q.y > HEIGHT_MAX_KM) break;
    float h = q.y - hf_heightAt(q.xz, uMarchOct);
    res = min(res, 7.0 * h / t);
    if (res < 0.02) break;
    t += clamp(h * 0.9, 0.04, 0.9);
  }
  return clamp(res, 0.0, 1.0);
}

void main() {
  // Level pinhole, then pitch, then yaw — pitch is a real camera axis into
  // the march, not a 2D horizon slide. Negative uPitch tips the gaze toward
  // the feet and the downslope under the ledge.
  vec2 q = vec2(gl_FragCoord.x - 0.5 * uRes.x, gl_FragCoord.y - uHorizonPx);
  float cr = cos(uRoll);
  float sr = sin(uRoll);
  q = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
  vec3 cam = normalize(vec3(q.x, q.y, uFocal));
  float cp = cos(uPitch);
  float sp = sin(uPitch);
  // Same matrix as applyCameraPitch: negative uPitch drops the gaze.
  cam = vec3(cam.x, cp * cam.y + sp * cam.z, -sp * cam.y + cp * cam.z);
  float cy = cos(uYaw);
  float sy = sin(uYaw);
  vec3 rd = vec3(cy * cam.x + sy * cam.z, cam.y, -sy * cam.x + cy * cam.z);
  vec3 ro = uEye;

  // --------- the sky, following the sun ---------
  vec3 sky = mix(uHorizonCol, uZenith, smoothstep(0.0, 0.45, rd.y));
  sky = mix(mix(uFogCol, uHorizonCol, 0.5), sky, smoothstep(-0.14, 0.03, rd.y));
  float sd = max(dot(rd, uSun), 0.0);
  sky += uSunCol * uSunI * (pow(sd, 900.0) * 1.3 + pow(sd, 26.0) * 0.15 + pow(sd, 4.0) * 0.05);
  float skyT = hf_fogTransmittance(ro.y, rd.y, MARCH_MAX_KM, uFogAlt);
  vec3 col = mix(uFogCol, sky, skyT);

  // --------- the range ---------
  float tG = 0.0;
  bool hit = hf_marchTerrain(ro, rd, uMarchOct, uSteps, uRefine, tG);
  vec3 ground = col;
  float groundT = 0.0;
  float hitH = 0.0;
  float drowned = 0.0;
  if (hit) {
    vec3 p = ro + rd * tG;
    float h; vec2 grad; float crease; float ridge;
    // level of detail: past the middle distance an octave is finer than a
    // pixel, and the fog has most of it anyway
    hf_groundAt(p.xz, tG > 9.0 ? uMarchOct : uShadeOct, h, grad, crease, ridge);
    hitH = h;
    vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
    vec4 m = hf_material(h, grad, crease, ridge, uSnowKm, uWind);
    // Cold gray rock picks up a little crease grain so faces read as stone,
    // not a flat taupe card; snow stays near-white; ice keeps its blue.
    vec3 rockFace = uRock * (0.88 + 0.14 * ridge + 0.10 * (1.0 - smoothstep(0.0, 0.22, crease)));
    vec3 albedo = rockFace * m.x + uSnow * m.y + uGlacier * m.z;
    // the wind's cornice, lying on the lee crest where it actually forms
    albedo = mix(albedo, uSnow, m.w * 0.62);
    // the sun's ray is worth casting where the eye can see the shadow land
    float sh = softShadow(vec3(p.x, h, p.z) + n * 0.006, uSun, tG > 12.0 ? 0 : uShadowSteps);
    float ndl = max(dot(n, uSun), 0.0);
    float light = uAmbient * (0.58 + 0.42 * n.y) + uSunI * ndl * sh;
    // knife-edge aretes: a sharper rim light so ridgelines cut the sky
    float arete = 1.0 - smoothstep(0.0, 0.028, crease);
    light += arete * uSunI * 0.16 * sh;
    // ice is not chalk: a low sheen on the glacier tongues and hard snow
    float spec = pow(max(dot(normalize(uSun - rd), n), 0.0), 40.0) * (m.z * 0.62 + m.y * 0.18) * sh;
    vec3 face = albedo * light + uSunCol * uSunI * spec * 0.4;
    // blue in the shade: snow and ice borrow sky, rock stays cooler gray
    float shade = (1.0 - ndl * sh);
    face = mix(face, face * uShadowCool, shade * (m.y * 0.55 + m.z * 0.7 + m.x * 0.18));
    // a thin ice-blue on the darkest glacier bowls
    face = mix(face, uGlacier * (0.35 + 0.4 * light), m.z * shade * 0.35);
    groundT = hf_fogTransmittance(ro.y, rd.y, tG, uFogAlt);
    ground = mix(uFogCol, face, max(groundT, 0.28));
    drowned = h < hf_fogSurfaceAt(p.xz, uFogAlt, uPhase) ? 1.0 : 0.0;
    col = ground;
  }

  // --------- the sea of fog: its own top, seen from above it ---------
  float tS = -1.0;
  if (ro.y > uFogAlt && rd.y < -1e-4) {
    float t = (uFogAlt - ro.y) / rd.y;
    for (int i = 0; i < 3; i++) {
      vec3 pp = ro + rd * t;
      t -= (pp.y - hf_fogSurfaceAt(pp.xz, uFogAlt, uPhase)) / rd.y;
    }
    if (t > 0.0 && t < MARCH_MAX_KM) tS = t;
  }
  if (tS > 0.0 && (!hit || tS < tG)) {
    vec3 ps = ro + rd * tS;
    float swell = hf_smoothFbm(vec2(ps.x * 0.21 + uPhase * 0.05, ps.z * 0.21 - uPhase * 0.03), 3).x;
    vec3 sea = uFogCol * (0.88 + 0.22 * swell);
    // guarded rather than normalized: a ray with no horizontal component
    // would hand normalize a zero vector, and one NaN is a black region
    float glint = max(
      dot(uSun.xz, rd.xz) / max(1e-4, length(uSun.xz) * length(rd.xz)),
      0.0
    );
    sea += uSunCol * uSunI * pow(glint, 20.0) * 0.09 * (0.4 + 0.6 * swell);
    float seaT = hf_fogTransmittance(ro.y, rd.y, tS, uFogAlt);
    sea = mix(mix(uFogCol, uHorizonCol, 0.45), sea, max(seaT, 0.25));
    // the shoreline dissolves rather than cuts: ground just under the top
    // still reaches the eye by whatever light survives the fog over it
    col = hit ? mix(sea, ground, groundT) : sea;
  }

  // --------- the survey lens: the same ground, drawn as a map ---------
  if (uLens > 0.001) {
    vec3 paper = vec3(0.93, 0.915, 0.87);
    if (hit) {
      vec3 land = mix(vec3(0.80, 0.77, 0.70), vec3(0.91, 0.89, 0.83), drowned);
      float d = hf_contourDistance(hitH);
      float w = clamp(0.02 + tG * 0.004, 0.02, 0.3);
      paper = mix(land, vec3(0.22, 0.2, 0.17), (1.0 - smoothstep(0.0, w, d)) * 0.75);
    }
    col = mix(col, paper, uLens);
  }

  // one pulse of everything alive: the range states itself
  col += col * uTutti * 0.2;

  gl_FragColor = vec4(col, 1.0);
}
`;

export default function MountainPeak() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const glCanvas = glCanvasRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !glCanvas || !overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    const wind = windVector(SEED);
    const horns = packHorns(SEED);
    const offset = seedOffset(SEED);

    // ——— where the wanderer stands, and what he is looking at ————
    // Both are laws of the field, not of the renderer, so both live in
    // heightfield.ts and are pinned in node (scripts/test-heightfield.mjs):
    // the eye stands strictly above the ground under it, the ground falls
    // away in front of it, and the frame holds range as well as sky. A
    // marched room cannot fake the station the way a painted one could —
    // stand on the apex and the whole frame is the rock you are inside.
    const restingFog = restingFogAltitude(SEED);
    const station = stationFor(SEED);
    const stX = station.x;
    const stZ = station.z;
    const eyeY = station.y;
    const viewYaw = viewBearingFor(station, SEED);

    let cairns: Cairn[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { cairns?: Cairn[] };
        if (Array.isArray(parsed.cairns)) cairns = parsed.cairns.slice(-MAX_CAIRNS);
      }
    } catch {
      /* fresh */
    }
    setHasKept(cairns.length > 0);

    const writer = createIdleWriter(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ cairns }));
      } catch {
        /* noop */
      }
      setHasKept(cairns.length > 0);
    });

    // ——— WebGL, and the 2D room that stands in for it ————————
    const glOpts: WebGLContextAttributes = { antialias: false, premultipliedAlpha: false };
    let gl =
      (glCanvas.getContext("webgl", glOpts) ||
        glCanvas.getContext("experimental-webgl" as "webgl", glOpts)) as WebGLRenderingContext | null;
    let prog: WebGLProgram | null = null;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    let quad: WebGLBuffer | null = null;
    let contextLost = false;
    const uni = new Map<string, WebGLUniformLocation | null>();
    const u = (name: string) => {
      if (!gl || !prog) return null;
      if (!uni.has(name)) uni.set(name, gl.getUniformLocation(prog, name));
      return uni.get(name) ?? null;
    };

    const buildGL = (): boolean => {
      if (!gl) return false;
      uni.clear();
      // The shader is generated, so a failure has to say WHERE: the shared
      // formatter prints the room, the stage and the offending source line.
      const compile = (type: number, src: string, which: "vertex" | "fragment") => {
        const s = gl!.createShader(type);
        if (!s) return null;
        gl!.shaderSource(s, src);
        gl!.compileShader(s);
        if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
          console.warn(formatShaderError("mountain", which, gl!.getShaderInfoLog(s), src));
          gl!.deleteShader(s);
          return null;
        }
        return s;
      };
      vs = compile(gl.VERTEX_SHADER, VERT_SRC, "vertex");
      fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC, "fragment");
      if (!vs || !fs) return false;
      const p = gl.createProgram();
      if (!p) return false;
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.warn(formatShaderError("mountain", "link", gl.getProgramInfoLog(p)));
        gl.deleteProgram(p);
        return false;
      }
      prog = p;
      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(p, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.useProgram(p);
      // the seed is placed once, in JS: the shader never hashes one
      gl.uniform2f(u("uSeedOffset"), offset[0], offset[1]);
      gl.uniform4fv(u("uHornA"), horns.a);
      gl.uniform4fv(u("uHornB"), horns.b);
      gl.uniform3f(u("uRock"), ROCK[0], ROCK[1], ROCK[2]);
      gl.uniform3f(u("uSnow"), SNOW[0], SNOW[1], SNOW[2]);
      gl.uniform3f(u("uGlacier"), GLACIER[0], GLACIER[1], GLACIER[2]);
      gl.uniform3f(u("uShadowCool"), SHADOW_COOL[0], SHADOW_COOL[1], SHADOW_COOL[2]);
      gl.uniform3f(u("uEye"), stX, eyeY, stZ);
      return true;
    };

    let glOk = gl ? buildGL() : false;

    const onLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      glOk = false;
      prog = null;
      quad = null;
      uni.clear();
    };
    const onRestored = () => {
      contextLost = false;
      glOk = buildGL();
      resize();
    };
    glCanvas.addEventListener("webglcontextlost", onLost, false);
    glCanvas.addEventListener("webglcontextrestored", onRestored, false);

    let width = 0;
    let height = 0;
    let bufScale = 1;
    let tier: QualityTier = gov.tier();
    let sizedFor: QualityTier = tier;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = resolveDpr(tier, { embedded, reducedMotion: reduced });
      overlay.width = Math.round(width * dpr);
      overlay.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // A ray-marcher pays for every pixel twice over — 64 field evaluations
      // deep — so the shader's own buffer takes resolveDpr under a marcher's
      // own ceiling, which falls with the tier, while the overlay the cairns
      // are drawn on keeps all of it.
      const marchCeil = tier === "high" ? 1.25 : tier === "medium" ? 1 : 0.75;
      bufScale = Math.min(dpr, marchCeil);
      sizedFor = tier;
      glCanvas.width = Math.max(1, Math.round(width * bufScale));
      glCanvas.height = Math.max(1, Math.round(height * bufScale));
      if (gl) gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      glDirty = true;
    };

    let scree: Scree[] = [];
    let tiltX = 0;
    let roll = 0; // the vessel is level with the world
    let yaw = viewYaw; // the head, turned — the crest held off centre
    let yawTarget = yaw;
    /** Head pitch in radians — negative looks down the slope toward the feet. */
    let pitch = 0;
    let pitchTarget = 0;
    /** Vessel beta contribution, absolute against a held-phone rest. */
    let tiltPitch = 0;
    let fov = FOV;
    let fovTarget = FOV;
    /** the world-law: how high the sea of fog stands, in km off its rest */
    let fogLift = 0;
    let fogLiftTarget = 0;
    /** and where the sun stands */
    // Rest a little after dawn: low enough for alpenglow on the horns,
    // high enough that glacier and cornice still read as materials, not mist.
    let sunElev = 0.38;
    let sunElevTarget = 0.38;
    let sunAz = 0.7;
    let dayElev = 0.38; // what the day was, before the phone was turned over
    let season = 0.4;
    let lens = 0; // 0 felt, 1 contour
    let lensTarget = 0;
    let lensSnapped = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let tutti = 0;
    let lastTuttiAt = 0;
    let lastTouchAt = performance.now();
    let glimmerAt = 0;
    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    let last = performance.now();
    let roomTime = 0;
    let raf = 0;
    let running = true;
    let screeSerial = 0;
    /** open-slope tier-3 tap: the next weather in a fixed, seeded cycle */
    let mtnEmptyCycleIdx = 0;
    let windAt = 0;
    /** the hand's tempo, entrained into the fog's own breath for a while */
    let rhythmBpm = 0;
    let rhythmUntil = 0;
    let glDirty = true;
    let lastGlAt = 0;
    let lastSig = Infinity;
    // Per-stone jitter (colour + x offset) for each standing cairn, derived
    // once from the cairn's own seed via mulberry32 — the values are static
    // (the seed never changes for a live cairn), so they are computed once
    // and cached instead of re-running a fresh PRNG for every stone, every
    // frame. A dropped/replaced cairn is a new object, so the cache falls
    // out of the WeakMap on its own.
    const cairnJitter = new WeakMap<Cairn, number[]>();
    const jitterForCairn = (c: Cairn): number[] => {
      let arr = cairnJitter.get(c);
      if (!arr) {
        const rng = mulberry32(c.seed);
        arr = [];
        for (let s = 0; s < c.stones; s++) arr.push(rng(), rng(), rng(), rng());
        cairnJitter.set(c, arr);
      }
      return arr;
    };
    // The reusable scratch array the 2D fallback's cornice pass fills each
    // frame — same backing store every call instead of a fresh array.
    const crestsScratch: { x: number; y: number; a: number; w: number }[] = [];

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

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

    const toLocal = (x: number, y: number) => {
      const rect = wrap.getBoundingClientRect();
      return { x: x - rect.left, y: y - rect.top };
    };

    /**
     * The focal length, in CSS pixels. Taken from the LONGER side, which is
     * the difference between a peak and a bump on a phone: derive it from
     * the width and a portrait frame gets a 66° vertical field, in which
     * the whole range — six degrees of it — is a smear across a tenth of
     * the picture. From the longer side the long lens survives the
     * rotation, and the crest stands where a photograph of it would.
     */
    const focalPx = () => Math.max(width, height, 1) / 2 / Math.tan(fov / 2);

    /** Combined head pitch: hand + vessel, clamped to the composition. */
    const viewPitch = () => clampPitch(pitch + tiltPitch);

    /** The camera, in JS — the same pinhole the fragment shader builds. */
    const rayFor = (px: number, py: number): [number, number, number] => {
      const focal = focalPx();
      // Level horizon reference — pitch is applied to the ray, not the 2D line.
      const horizonY = height * 0.46;
      let qx = px - width * 0.5;
      let qy = horizonY - py;
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const rx = cr * qx - sr * qy;
      const ry = sr * qx + cr * qy;
      qx = rx;
      qy = ry;
      const len = Math.hypot(qx, qy, focal) || 1;
      const pitched = applyCameraPitch([qx / len, qy / len, focal / len], viewPitch());
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      return [
        cy * pitched[0] + sy * pitched[2],
        pitched[1],
        -sy * pitched[0] + cy * pitched[2],
      ];
    };

    /** The call, and the answer the distance owes it. */
    const callOut = (px: number, py: number, intensity: number) => {
      const rd = rayFor(px, py);
      audio.playNote(echoMidi(0), 140 + Math.round(intensity * 160));
      const echo = callAnswer([stX, eyeY, stZ], rd, SEED);
      // past ECHO_MAX_KM the range simply keeps the call — nothing waits forever
      if (!echo) return;
      window.setTimeout(() => {
        try {
          audio.playNote(echo.midi, 220 + Math.round(intensity * 260));
          haptics.tap();
        } catch {
          /* noop */
        }
      }, echo.delayMs);
    };

    // ——— tutti: one pulse of everything alive ————————————————
    const soundTutti = (intensity: number) => {
      const now = performance.now();
      if (now - lastTuttiAt < 1200) return;
      lastTuttiAt = now;
      tutti = Math.min(1, 0.5 + intensity * 0.6);
      // every cairn answers, in the order they were built
      cairns.forEach((c, i) => {
        window.setTimeout(() => {
          try {
            audio.playNote(46 + Math.round((1 - c.y) * 22) + c.stones, 90);
          } catch {
            /* noop */
          }
        }, i * 42);
      });
      // and the wind, and the ice
      const w = windVoice(Math.max(0, eyeY - (restingFog + fogLift)));
      try {
        audio.playTone(w.hz, 0.9);
        audio.chime();
      } catch {
        /* noop */
      }
      // the stones shift where they stand
      for (const c of cairns) {
        scree = scree.concat(kickScree(mix32(screeSerial++, 5), c.x, c.y, 0.18 + intensity * 0.2));
      }
      if (scree.length > 120) scree = scree.slice(-120);
      haptics.ripple(0.3 + intensity * 0.5);
      glDirty = true;
    };

    // ——— the hold: a cairn gathers, or an old one is unmade ————
    type Gather = {
      x: number;
      y: number;
      onCairn: number;
      stones: number;
      charge: number;
      toppled: boolean;
      tier: number;
      intensity: number;
      /** Same per-stone jitter cache as a cairn's, keyed to this one hold
       *  instead of a WeakMap since only one gather is ever live: filled
       *  lazily as `stones` grows, never replayed from the top. */
      jitter: number[];
      jrng: (() => number) | null;
    };
    let gather: Gather | null = null;
    let lastGatherSoundAt = 0;

    const refuse = (x: number, y: number) => {
      // the cap answers physically: the stones the hand gathered go down
      // the slope instead of standing
      scree = scree.concat(kickScree(mix32(screeSerial++, 11), x / width, y / height, 0.5));
      if (scree.length > 120) scree = scree.slice(-120);
      try {
        audio.refuse();
      } catch {
        /* noop */
      }
      haptics.chop();
    };

    const topple = (index: number) => {
      const c = cairns[index];
      if (!c) return;
      for (let i = 0; i < c.stones; i++) {
        scree = scree.concat(kickScree(mix32(c.seed, i), c.x, c.y - i * 0.008, 0.55));
      }
      if (scree.length > 120) scree = scree.slice(-120);
      cairns = cairns.filter((_, i) => i !== index);
      writer.schedule();
      setHasKept(cairns.length > 0);
      try {
        audio.thud();
        audio.playNote(34, 420);
      } catch {
        /* noop */
      }
      haptics.roll();
    };

    // ——— breath: the candle's own verb, in this room's material ————
    // Opt-in (grammar §1), armed only by the ceremony hold. A breath over
    // the range draws the inversion down off the ridges — the same act as
    // leaning over a flame, answered by the thing this room is made of.
    let breathStop: (() => void) | null = null;
    let lastBreathAt = 0;
    const onBreath = ({ strength }: { strength: number }) => {
      const now = performance.now();
      lastTouchAt = now;
      fogLiftTarget = clamp(
        fogLiftTarget - FOG_BREATH_KM * 0.22 * strength,
        -FOG_BREATH_KM * 1.6,
        FOG_BREATH_KM * 2.4,
      );
      if (now - lastBreathAt < 260) return;
      lastBreathAt = now;
      try {
        audio.playTone(120 + strength * 90, 0.7);
      } catch {
        /* noop */
      }
      haptics.chop();
    };
    const armBreath = async () => {
      if (breathStop) return;
      const stop = await enableBreath({ breath: onBreath });
      if (stop) breathStop = stop;
    };

    // the raised-lens marker the frame's step-back reads
    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    const detachVessel = onVessel({
      tilt: ({ gamma, beta }) => {
        if (reduced || asleep) return;
        tiltX = clamp(gamma / 45, -1, 1);
        // the vessel is level with the world: the horizon answers the hand
        roll = clamp(gamma / 90, -0.35, 0.35) * 0.6;
        yawTarget = clamp(yawTarget + gamma * 0.00012, -3.2, 3.2);
        // tip the phone forward and the gaze tips toward the feet / downslope
        tiltPitch = pitchFromVesselBeta(beta);
        glDirty = true;
      },
      shake: ({ intensity }) => {
        if (reduced || asleep) return;
        scree = scree.concat(
          kickScree(mix32(screeSerial++, 2), 0.5 + tiltX * 0.1, 0.45, intensity),
        );
        if (scree.length > 120) scree = scree.slice(-120);
        haptics.chop();
        audio.thud();
      },
      knock: ({ intensity }) => {
        // a knock on the case is a knock on the range: the peak rings, and
        // a stone comes loose where the sound went in
        lastTouchAt = performance.now();
        try {
          audio.playNote(30 + Math.round(intensity * 6), 620);
          audio.bell();
        } catch {
          /* noop */
        }
        scree = scree.concat(
          kickScree(mix32(screeSerial++, 3), 0.5, 0.52, 0.3 + intensity * 0.6),
        );
        if (scree.length > 120) scree = scree.slice(-120);
        haptics.roll();
      },
      flip: ({ faceDown }) => {
        // face-down is night on the mountain, and the day it was is kept
        if (faceDown) {
          dayElev = sunElevTarget;
          sunElevTarget = SUN_NIGHT_ELEVATION;
          try {
            audio.playNote(28, 700);
          } catch {
            /* noop */
          }
        } else {
          sunElevTarget = dayElev;
          try {
            audio.chime();
          } catch {
            /* noop */
          }
        }
        haptics.ripple(0.35);
      },
    });

    const detachGestures = attachGestures(
      wrap,
      {
        tap: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // tutti — every cairn, the wind, and the ice, at once
            soundTutti(e.intensity);
            return;
          }
          if (e.fingers === 2) {
            // step back: a raised lens lowers first, else the frame widens
            if (lensSnapped === 1 || lensTarget > 0.02) {
              lensSnapped = 0;
              lensTarget = 0;
              window.setTimeout(() => markLens(false), 0);
              haptics.lens();
              audio.playNote(48, 160);
              return;
            }
            if (fovTarget < FOV_MAX - 1e-4) {
              // the frame retreats a step, harder taps a wider one
              fovTarget = Math.min(FOV_MAX, fovTarget + FOV_STEP * (0.7 + e.intensity * 0.6));
              audio.playNote(44, 200);
              haptics.detent();
            } else {
              // as far back as this frame goes: the next step is the long
              // lens again, so the hand is never left holding a one-way rope
              fovTarget = FOV;
              audio.playNote(56, 220);
              haptics.detent();
            }
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          // rapid-tap ladder: echo → scree → ridge answer → tutti
          const tier = tapTrainTier(e.count);
          const depth = tapTrainDepth(e.count);
          if (tier === "n") {
            soundTutti(0.7 + e.intensity * 0.5 + depth * 0.25);
            scree = scree.concat(
              kickScree(mix32(screeSerial++, 13), x / Math.max(1, width), y / Math.max(1, height), 0.55 + depth * 0.35),
            );
            if (scree.length > 120) scree = scree.slice(-120);
            return;
          }
          if (tier === 5) {
            // the room's biggest, rarest event: a full avalanche down the
            // face — scree kicked from high on the slope in several bands,
            // guaranteed to find any cairn standing in its path (the same
            // scree/cairn collision the ordinary rockfall uses)
            callOut(x, y, Math.min(1, e.intensity + 0.35 + depth * 0.3));
            const bands = 5 + Math.floor(depth * 3);
            for (let b = 0; b < bands; b++) {
              const bx = (b + 0.5) / bands;
              scree = scree.concat(
                kickScree(mix32(screeSerial++, 23 + b), bx, 0.08 + (b % 2) * 0.05, 0.7 + depth * 0.4),
              );
            }
            if (scree.length > 120) scree = scree.slice(-120);
            fogLiftTarget = Math.min(0.4, fogLiftTarget + 0.08 + depth * 0.06);
            try { audio.thud(); } catch { /* noop */ }
            haptics.storm();
            return;
          }
          if (tier === 3) {
            const ci = nearestCairnIndex(
              cairns,
              x / Math.max(1, width),
              y / Math.max(1, height),
              CAIRN_TOUCH_R,
              width / Math.max(1, height),
            );
            if (ci >= 0) {
              // its own transformation: toppled, then rebuilt on the same
              // spot a beat later — the same stones, a fresh stand
              const c = cairns[ci];
              topple(ci);
              window.setTimeout(() => {
                cairns = cairns.concat(placeCairn(mix32(c.seed, 99), c.x, c.y, c.stones));
                setHasKept(cairns.length > 0);
                writer.schedule();
              }, 650);
              return;
            }
            // open slope: the next weather in a fixed, deterministic cycle
            const kinds = ["rockfall", "avalanche", "inversion"] as const;
            const kind = kinds[mtnEmptyCycleIdx % kinds.length];
            mtnEmptyCycleIdx += 1;
            callOut(x, y, Math.min(1, e.intensity + 0.2 + depth * 0.25));
            if (kind === "rockfall") {
              scree = scree.concat(
                kickScree(mix32(screeSerial++, 19), x / Math.max(1, width), y / Math.max(1, height), 0.28 + depth * 0.25),
              );
            } else if (kind === "avalanche") {
              for (let b = 0; b < 3; b++) {
                scree = scree.concat(
                  kickScree(
                    mix32(screeSerial++, 29 + b),
                    x / Math.max(1, width) + (b - 1) * 0.05,
                    y / Math.max(1, height) - 0.05,
                    0.4 + depth * 0.2,
                  ),
                );
              }
            } else {
              fogLiftTarget = Math.min(0.35, fogLiftTarget + 0.12 + depth * 0.1);
              try { audio.playNote(30, 900); } catch { /* noop */ }
            }
            if (scree.length > 120) scree = scree.slice(-120);
            haptics.tap();
            return;
          }
          callOut(x, y, e.intensity * (1 + depth * 0.3));
          haptics.tap();
        },
        hold: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // three fingers touch the law: time dilates while held, and
            // keeps dilating the longer the hand stays
            if (e.phase === "enter") {
              haptics.tap();
              audio.playNote(36, 260);
            }
            if (e.phase === "release") timeScaleTarget = 1;
            else timeScaleTarget = clamp(1 - e.elapsed / 3400, 0.08, 1);
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          if (e.phase === "enter") {
            gather = {
              x,
              y,
              onCairn: nearestCairnIndex(
                cairns,
                x / Math.max(1, width),
                y / Math.max(1, height),
                CAIRN_TOUCH_R,
                Math.max(1, width) / Math.max(1, height),
              ),
              stones: 0,
              charge: 0,
              toppled: false,
              tier: 0,
              intensity: e.intensity,
              jitter: [],
              jrng: null,
            };
            return;
          }
          if (e.phase === "release") {
            const g = gather;
            gather = null;
            if (!g || g.onCairn >= 0) return;
            // dwell on open ground plants what the hold gathered
            if (e.tier >= 2 && g.stones >= 1) {
              if (cairns.length >= MAX_CAIRNS) {
                refuse(g.x, g.y);
                return;
              }
              cairns = cairns.concat(
                placeCairn(
                  mix32(Math.round(g.x), Math.round(g.y), cairns.length),
                  g.x / Math.max(1, width),
                  g.y / Math.max(1, height),
                  g.stones,
                ),
              );
              writer.schedule();
              setHasKept(true);
              audio.spark();
              audio.playNote(52 + g.stones * 2, 220);
              haptics.bloom();
            }
            return;
          }
          // — tick —
          const g = gather;
          if (!g) return;
          // the candle's ladder, kept here because the flame is hidden on
          // this route: dwell invites the vessel, the ceremony invites breath
          if (e.tier >= 2 && g.tier < 2) {
            g.tier = 2;
            if (shouldInvite("vessel")) void requestVessel();
          }
          if (e.tier >= 3 && g.tier < 3) {
            g.tier = 3;
            if (shouldInvite("breath")) void armBreath();
          }
          const now = performance.now();
          if (g.onCairn >= 0) {
            // the ceremony: a hand kept on a standing cairn unmakes it
            g.charge = clamp01((e.elapsed - 900) / 1600);
            if (g.charge > 0 && now - lastGatherSoundAt > 320) {
              lastGatherSoundAt = now;
              audio.playNote(40 + Math.round(g.charge * 12), 90);
              haptics.tap();
            }
            if (e.tier >= 3 && !g.toppled) {
              g.toppled = true;
              topple(g.onCairn);
              g.onCairn = -1;
              g.charge = 0;
            }
            return;
          }
          // and on open ground it gathers, deeper the longer it is held
          g.stones = cairnStonesForHold(e.elapsed, e.intensity);
          if (e.tier >= 2 && now - lastGatherSoundAt > 300) {
            lastGatherSoundAt = now;
            audio.playNote(50 + g.stones * 2, 80);
            haptics.tap();
          }
          // the breath drawn: the fog settles while the finger stays down
          fogLiftTarget = clamp(
            fogLiftTarget - 0.00018 * 16,
            -FOG_BREATH_KM * 1.6,
            FOG_BREATH_KM * 2.4,
          );
        },
        drag: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // the world-law: the sea of fog rises and falls, and the sun moves
            fogLiftTarget = clamp(
              fogLiftTarget - e.dy * 0.0016,
              -FOG_BREATH_KM * 1.6,
              FOG_BREATH_KM * 2.4,
            );
            sunAz += e.dx * 0.0022;
            sunElevTarget = clamp(sunElevTarget + e.dx * 0.0009, SUN_NIGHT_ELEVATION, 1);
            dayElev = sunElevTarget;
            return;
          }
          if (e.fingers !== 1) return;
          // one finger turns the head and pitches the look — drag down to the feet
          yawTarget = clamp(yawTarget - e.dx * 0.0022, -3.2, 3.2);
          pitchTarget = clampPitch(pitchTarget - e.dy * 0.002);
        },
        pan2: (e) => {
          // two fingers are the frame: yaw and pitch under the whole view
          lastTouchAt = performance.now();
          yawTarget = clamp(yawTarget - e.dx * 0.0016, -3.2, 3.2);
          pitchTarget = clampPitch(pitchTarget - e.dy * 0.0016);
        },
        twist: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // three fingers turn the season: the snowline walks the year
            const before = Math.floor(season * 4);
            season += e.angle * 0.14;
            if (Math.floor(season * 4) !== before) {
              audio.playNote(56 - Math.round(((season % 1) + 1) % 1 * 12), 220);
              haptics.detent();
            }
            glDirty = true;
            return;
          }
          // two fingers turn the lens: the felt range ↔ the survey sheet
          if (e.phase === "move") {
            lensTarget = clamp01(lensTarget + e.angle * 0.15);
          } else if (e.phase === "end") {
            const snapped = lensTarget > 0.5 ? 1 : 0;
            if (snapped !== lensSnapped) {
              lensSnapped = snapped;
              markLens(snapped === 1);
              haptics.lens();
              if (snapped === 1) audio.chime();
              else audio.playNote(48, 160);
            }
            lensTarget = snapped;
          }
        },
        scrub: (e) => {
          // stirring the inversion: a clockwise circle draws the sea of fog
          // down off the ridges, counterclockwise lifts it — deeper and
          // faster circling moves more of it
          lastTouchAt = performance.now();
          const turn = clamp(Math.abs(e.winding), 0.5, 3);
          const moved = 0.04 * turn * (1 + clamp01(e.angularVelocity / 1.2) * 0.6);
          fogLiftTarget = clamp(
            fogLiftTarget + (e.winding > 0 ? moved * 0.6 : -moved),
            -FOG_BREATH_KM * 1.6,
            FOG_BREATH_KM * 2.4,
          );
          audio.playNote(50 + Math.round(turn * 3), 160);
          haptics.ripple(0.2 + Math.min(0.5, turn * 0.15));
        },
        flick: (e) => {
          // a stone thrown down the slope, the way the hand sent it and as
          // fast as it was sent
          lastTouchAt = performance.now();
          const { x, y } = toLocal(e.x, e.y);
          const speed = clamp(e.speed, 0.2, 2.4);
          scree = scree.concat(
            kickScree(mix32(screeSerial++, 7, Math.round(e.angle * 100)), x / Math.max(1, width), y / Math.max(1, height), 0.3 + speed * 0.3),
          );
          if (scree.length > 120) scree = scree.slice(-120);
          audio.playNote(44 + Math.round(speed * 8), 180);
          haptics.chop();
        },
        drum: (e) => {
          // the patter between two zones is a volley of calls into the range,
          // each answered at its own distance — a tighter alternation carries
          // further, and every extra hit throws the volley harder
          lastTouchAt = performance.now();
          const a = toLocal(e.ax, e.ay);
          const b = toLocal(e.bx, e.by);
          const carry = 0.25 + e.alternation * 0.4 + Math.min(1, e.hits / 8) * 0.3;
          callOut(a.x, a.y, carry);
          window.setTimeout(() => callOut(b.x, b.y, carry), 90);
          haptics.tap();
        },
        rhythm: (e) => {
          // a steady hand entrains the inversion: the sea of fog breathes at
          // the hand's own tempo for a while, never with a lesson
          if (e.stability < 0.6) return;
          lastTouchAt = performance.now();
          rhythmBpm = clamp(e.bpm, 30, 160);
          rhythmUntil = performance.now() + 9000;
          audio.playTone(90 + e.bpm * 0.4, 0.5);
          haptics.tap();
        },
      },
      { wheelZoom: false },
    );

    // ——— the 2D room, for where WebGL will not go ————————————
    // The painter's algorithm this room was built on: thirteen distance
    // rings, far to near, each filled per column. It reads, and it is the
    // reason the range used to terrace — kept as the fallback, never the
    // path when a context exists.
    const drawRings = (
      pal: SkyPalette,
      sun: [number, number, number],
      fogAltitude: number,
      phase: number,
      snowKm: number,
      horizonY: number,
      samples: number,
    ) => {
      const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizonY));
      sky.addColorStop(0, rgb(pal.zenith));
      sky.addColorStop(1, rgb(pal.horizon));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, Math.max(0, horizonY));
      const fogGrad = ctx.createLinearGradient(0, Math.max(0, horizonY), 0, height);
      fogGrad.addColorStop(0, rgb(mixc(pal.fog, pal.horizon, 0.5)));
      fogGrad.addColorStop(1, rgb(pal.fog));
      ctx.fillStyle = fogGrad;
      ctx.fillRect(0, Math.max(0, horizonY), width, height);

      const step = Math.max(2, Math.round(3 / Math.max(0.4, samples)));
      const focal = focalPx();
      // Reused scratch array — same backing store every call instead of a
      // fresh one each frame this fallback path draws.
      const crests = crestsScratch;
      crests.length = 0;
      for (let r = RANGES.length - 1; r >= 0; r--) {
        const d = RANGES[r];
        const oct = r <= 1 ? 6 : r <= 4 ? 5 : r <= 8 ? 4 : 3;
        const near = r === 0;
        for (let x = -step; x <= width + step; x += step) {
          const col = clamp01(x / Math.max(1, width));
          // a real pinhole, like the shader's: the bearing of a column is
          // an arctangent of its offset, not a fraction of the field
          const a = yaw + Math.atan2(x - width * 0.5, focal);
          const wx = stX + Math.sin(a) * d;
          const wz = stZ + Math.cos(a) * d;
          const g = groundAt(wx, wz, SEED, oct);
          const h = g.h;
          const fogTop = fogSurfaceAt(wx, wz, fogAltitude, phase);
          const drowned = fogTop > h;
          const top = drowned ? fogTop : h;
          const rise = top - eyeY;
          const dist = Math.hypot(d, rise);
          const trans = fogTransmittance(eyeY, rise / Math.max(1e-4, dist), dist, fogAltitude);
          let y = horizonY - rise * (focal / d) + (col - 0.5) * roll * height * 0.1;
          if (near) y = Math.max(y, height * 0.66 + (col - 0.5) * roll * height * 0.06);
          if (y > height) continue;

          if (lens > 0.5) {
            ctx.fillStyle = rgb(drowned ? [0.91, 0.89, 0.83] : [0.78, 0.75, 0.68], 1);
            ctx.fillRect(x, y, step + 1, height - y);
          } else if (near) {
            ctx.fillStyle = rgb([0.055, 0.052, 0.06], 1);
            ctx.fillRect(x, y, step + 1, height - y);
          } else if (drowned) {
            ctx.fillStyle = rgb(mixc(pal.fog, pal.horizon, clamp01(1 - trans) * 0.45), 1);
            ctx.fillRect(x, y, step + 1, height - y);
          } else {
            const nLen = Math.hypot(-g.dhdx, 1, -g.dhdz) || 1;
            const lambert = clamp01(
              ((-g.dhdx * sun[0] + 1 * sun[1] + -g.dhdz * sun[2]) / nLen) * 0.5 + 0.5,
            );
            const light = pal.ambient + pal.sunI * lambert;
            const m = materialFromGround(g, season, wind);
            const shade = (albedo: [number, number, number]): [number, number, number] => {
              const lit = mixc(albedo, SNOW, m.cornice * 0.55);
              const face: [number, number, number] = [
                lit[0] * light,
                lit[1] * light,
                lit[2] * light,
              ];
              return mixc(pal.fog, face, Math.max(trans, 0.28));
            };
            const albedo: [number, number, number] = [
              ROCK[0] * m.rock + SNOW[0] * m.snow + GLACIER[0] * m.glacier,
              ROCK[1] * m.rock + SNOW[1] * m.snow + GLACIER[1] * m.glacier,
              ROCK[2] * m.rock + SNOW[2] * m.snow + GLACIER[2] * m.glacier,
            ];
            ctx.fillStyle = rgb(shade(albedo), 1);
            ctx.fillRect(x, y, step + 1, height - y);
            if (m.snow > 0.35 && h > snowKm) {
              const capPx = clamp((h - snowKm) / 0.35, 0, 1) * Math.min(18, 220 / d);
              if (capPx > 2) {
                ctx.fillStyle = rgb(shade(SNOW), 0.85);
                ctx.fillRect(x, y, step + 1, capPx);
              }
            }
            if (m.glacier > 0.35) {
              const tonguePx = clamp(m.glacier, 0, 1) * Math.min(28, 320 / d);
              const gap = Math.min(10, 120 / d);
              if (tonguePx > 3) {
                ctx.fillStyle = rgb(shade(GLACIER), 0.75);
                ctx.fillRect(x, y + gap, step + 1, tonguePx);
              }
            }
            if (m.cornice > 0.18 && g.crease < 0.16 && trans > 0.08) {
              crests.push({ x, y, a: m.cornice * Math.max(trans, 0.35), w: step + 1 });
            }
          }
        }
      }
      for (const c of crests) {
        ctx.fillStyle = rgb(SNOW, 0.45 + 0.5 * c.a);
        ctx.fillRect(c.x, c.y - 2, c.w, 3.5);
      }
    };

    const draw = (now: number) => {
      if (!running) return;
      const wall = Math.min(0.05, (now - last) / 1000);
      last = now;
      tier = gov.beginFrame(now);
      // the governor's verdict is a real instruction here: fewer march steps
      // AND fewer pixels to march for
      if (tier !== sizedFor && !asleep) resize();
      const detail = detailForTier(tier);
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, wall * 6);
      const dt = wall * timeScale;
      roomTime += dt;
      const t = roomTime;
      if (!asleep) scree = stepScree(scree, dt).slice(-Math.floor(120 * detail.particles));
      // the physics between the mountain's two populations: falling scree
      // strikes a standing cairn, and a struck cairn topples — consumed,
      // producing its own fresh cascade, felt in the same frame it lands
      if (!asleep && scree.length > 0 && cairns.length > 0) {
        const hits = screeCairnHits(scree, cairns, width / Math.max(1, height));
        if (hits.length > 0) {
          const removedScree = new Set(hits.map((h) => h.screeIdx));
          scree = scree.filter((_, i) => !removedScree.has(i));
          const struck = Array.from(new Set(hits.map((h) => h.cairnIdx))).sort((a, b) => b - a);
          for (const idx of struck) topple(idx);
        }
      }

      yaw += (yawTarget - yaw) * Math.min(1, wall * 3);
      pitch += (pitchTarget - pitch) * Math.min(1, wall * 4);
      fov += (fovTarget - fov) * Math.min(1, wall * 3);
      lens += (lensTarget - lens) * Math.min(1, wall * 5);
      sunElev += (sunElevTarget - sunElev) * Math.min(1, wall * 1.4);
      fogLift += (fogLiftTarget - fogLift) * Math.min(1, wall * 1.6);
      fogLiftTarget *= Math.exp(-wall * 0.09); // the inversion always returns
      tutti *= Math.exp(-wall * 2.4);
      const headPitch = viewPitch();
      // Everything the shader is a function of, in one number. Under reduced
      // motion the picture is only redrawn when this moves — so the room is
      // still until a hand moves it, and no state can quietly stop reaching
      // the screen because someone forgot to flag it.
      const sig =
        yaw +
        headPitch * 4 +
        roll * 4 +
        fov * 7 +
        lens * 5 +
        fogLift * 100 +
        sunElev * 10 +
        sunAz * 10 +
        season * 3 +
        tutti;
      if (Math.abs(sig - lastSig) > 1e-6) {
        glDirty = true;
        lastSig = sig;
      }

      // the shared 7s breath: the fog settles on the exhale, lifts on the draw
      // — and while an entrained tempo lasts, a second swell rides the hand's
      // own pulse on top of it, fading as the entrainment lets go
      const entrain = rhythmBpm > 0 && now < rhythmUntil ? clamp01((rhythmUntil - now) / 9000) : 0;
      if (rhythmBpm > 0 && now >= rhythmUntil) rhythmBpm = 0;
      const breath = reduced
        ? 0
        : Math.sin(t * Math.PI * 2 * 0.14) +
          (entrain > 0 ? Math.sin(t * Math.PI * 2 * (rhythmBpm / 60)) * 0.6 * entrain : 0);
      const fogAltitude = restingFog + fogLift + breath * FOG_BREATH_KM * 0.18;
      const phase = reduced ? 0 : t * 0.09;

      const sun = sunDirection(sunAz, sunElev);
      const pal: SkyPalette = paletteForSun(sunElev);
      const snowKm = snowlineKm(season);
      // 2D fallback only: the pitched horizon as a pinhole would place it.
      // The shader keeps a level uHorizonPx and applies uPitch to the ray.
      const horizonY = height * 0.46 + Math.tan(headPitch) * focalPx();

      // ——— the range, one ray per pixel ———
      if (glOk && gl && prog && !contextLost && !asleep) {
        // reduced motion holds the picture still: it is redrawn when the
        // hand moves it, never on a breath
        const interval = reduced ? Infinity : tier === "high" ? 0 : tier === "medium" ? 22 : 40;
        if (glDirty || now - lastGlAt >= interval) {
          lastGlAt = now;
          glDirty = false;
          gl.useProgram(prog);
          gl.uniform2f(u("uRes"), glCanvas.width, glCanvas.height);
          // Level horizon — pitch lives in uPitch so the march sees the feet.
          gl.uniform1f(u("uHorizonPx"), (height - height * 0.46) * bufScale);
          gl.uniform1f(u("uFocal"), focalPx() * bufScale);
          gl.uniform1f(u("uRoll"), roll);
          gl.uniform1f(u("uYaw"), yaw);
          gl.uniform1f(u("uPitch"), headPitch);
          gl.uniform3f(u("uSun"), sun[0], sun[1], sun[2]);
          gl.uniform3f(u("uSunCol"), pal.sun[0], pal.sun[1], pal.sun[2]);
          gl.uniform3f(u("uZenith"), pal.zenith[0], pal.zenith[1], pal.zenith[2]);
          gl.uniform3f(u("uHorizonCol"), pal.horizon[0], pal.horizon[1], pal.horizon[2]);
          gl.uniform3f(u("uFogCol"), pal.fog[0], pal.fog[1], pal.fog[2]);
          gl.uniform1f(u("uAmbient"), pal.ambient);
          gl.uniform1f(u("uSunI"), pal.sunI);
          gl.uniform1f(u("uFogAlt"), fogAltitude);
          gl.uniform1f(u("uPhase"), phase);
          gl.uniform1f(u("uSnowKm"), snowKm);
          gl.uniform2f(u("uWind"), wind[0], wind[1]);
          gl.uniform1f(u("uLens"), lens);
          gl.uniform1f(u("uTutti"), tutti);
          // the budget the frame can afford, never past the loop's own bound
          gl.uniform1i(u("uSteps"), Math.max(18, Math.round(MARCH_STEPS * detail.samples)));
          gl.uniform1i(u("uRefine"), Math.max(4, Math.round(MARCH_REFINE * detail.samples)));
          gl.uniform1i(u("uShadowSteps"), Math.round(18 * detail.shadows));
          // The station is placed against this exact marching field. Reducing
          // its octave count at the low tier can put the eye inside a different
          // ridge, making every mobile ray hit at once and flattening the view.
          gl.uniform1i(u("uMarchOct"), OCTAVES_MARCH);
          gl.uniform1i(u("uShadeOct"), Math.max(4, Math.round(OCTAVES_SHADE * detail.samples)));
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }

      ctx.clearRect(0, 0, width, height);
      if (!glOk) drawRings(pal, sun, fogAltitude, phase, snowKm, horizonY, detail.samples);

      // ——— the cairns, and what the hand is doing to them ———
      for (let i = 0; i < cairns.length; i++) {
        const c = cairns[i];
        const jitter = jitterForCairn(c);
        const charge = gather && gather.onCairn === i ? gather.charge : 0;
        const x = c.x * width;
        const y = c.y * height;
        const shiver = charge > 0 ? Math.sin(now * 0.05) * charge * 2.4 : 0;
        if (tutti > 0.01) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(255,252,244,${0.34 * tutti})`;
          ctx.lineWidth = 1;
          ctx.arc(x, y - c.stones * 2.2, 8 + (1 - tutti) * 22, 0, Math.PI * 2);
          ctx.stroke();
        }
        for (let s = 0; s < c.stones; s++) {
          const j = s * 4;
          const fade = charge > 0 ? 0.9 - charge * 0.45 : 0.9;
          ctx.fillStyle = `rgba(${90 + jitter[j] * 40},${85 + jitter[j + 1] * 30},${70 + jitter[j + 2] * 20},${fade})`;
          ctx.beginPath();
          ctx.ellipse(
            x + (jitter[j + 3] - 0.5) * 4 + shiver * (s / Math.max(1, c.stones)),
            y - s * 5,
            6 - s * 0.4,
            3.5,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        if (charge > 0) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(238,226,206,${0.16 + charge * 0.5})`;
          ctx.lineWidth = 1;
          ctx.arc(x, y, 10 + charge * 16, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // what the hand is gathering, from the moment it starts gathering
      if (gather && gather.onCairn < 0) {
        const g = gather;
        const dust = clamp01(g.stones / 7 + 0.12);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(226,214,192,${0.1 + dust * 0.24})`;
        ctx.lineWidth = 1;
        ctx.arc(g.x, g.y, 9 + dust * 12, 0, Math.PI * 2);
        ctx.stroke();
        // filled lazily, in order, as `stones` grows — never re-seeded and
        // replayed from the top the way a fresh mulberry32() per frame would
        if (!g.jrng) g.jrng = mulberry32(mix32(Math.round(g.x), Math.round(g.y)));
        while (g.jitter.length < g.stones * 4) {
          g.jitter.push(g.jrng(), g.jrng(), g.jrng(), g.jrng());
        }
        for (let s = 0; s < g.stones; s++) {
          const j = s * 4;
          ctx.fillStyle = `rgba(${96 + g.jitter[j] * 40},${90 + g.jitter[j + 1] * 30},${74 + g.jitter[j + 2] * 20},0.8)`;
          ctx.beginPath();
          ctx.ellipse(g.x + (g.jitter[j + 3] - 0.5) * 4, g.y - s * 5, 6 - s * 0.4, 3.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // scree
      for (const s of scree) {
        ctx.fillStyle = `rgba(70,60,50,${0.7 * s.life})`;
        ctx.fillRect(s.x * width, s.y * height, 2.5, 2.5);
      }

      // the wind, heard when the fog is low and the ridge is bare
      if (!asleep && !reduced && now - windAt > 5200) {
        windAt = now;
        const w = windVoice(Math.max(0, eyeY - fogAltitude));
        if (w.gain > 0.04) {
          try {
            audio.playTone(w.hz, 2.4);
          } catch {
            /* the sea is not awake */
          }
        }
      }

      if (now - lastTouchAt > 20000 && now - glimmerAt > 6000 && !reduced && !asleep) glimmerAt = now;
      if (glimmerAt && now - glimmerAt < 1600) {
        const u2 = (now - glimmerAt) / 1600;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,255,255,${0.22 * (1 - u2)})`;
        ctx.arc(width * 0.5, horizonY + 10, 20 + u2 * 40, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (cairns.length >= MAX_CAIRNS) {
          refuse(width * 0.5, height * 0.55);
          return;
        }
        cairns = cairns.concat(placeCairn(mix32(cairns.length, 9), 0.5, 0.55, 3));
        writer.schedule();
        setHasKept(true);
        audio.spark();
      }
      // the keyboard's own hand on the delete: the last cairn falls
      if (e.key === "Backspace" || e.key === "Delete") {
        if (cairns.length) topple(cairns.length - 1);
      }
      // and on the world-law: the fog rises and falls — shift pitches the head
      if (e.key === "ArrowUp" && e.shiftKey) pitchTarget = clampPitch(pitchTarget + 0.08);
      else if (e.key === "ArrowDown" && e.shiftKey) pitchTarget = clampPitch(pitchTarget - 0.08);
      else if (e.key === "PageUp") pitchTarget = clampPitch(pitchTarget + 0.08);
      else if (e.key === "PageDown") pitchTarget = clampPitch(pitchTarget - 0.08);
      else if (e.key === "ArrowUp") fogLiftTarget = clamp(fogLiftTarget + 0.06, -FOG_BREATH_KM * 1.6, FOG_BREATH_KM * 2.4);
      else if (e.key === "ArrowDown") fogLiftTarget = clamp(fogLiftTarget - 0.06, -FOG_BREATH_KM * 1.6, FOG_BREATH_KM * 2.4);
      if (e.key === "ArrowLeft") yawTarget = clamp(yawTarget - 0.12, -3.2, 3.2);
      if (e.key === "ArrowRight") yawTarget = clamp(yawTarget + 0.12, -3.2, 3.2);
      if (e.key === "Escape") {
        lensTarget = 0;
        lensSnapped = 0;
        markLens(false);
      }
    };
    window.addEventListener("keydown", onKey);

    (wrap as HTMLDivElement & { __letGo?: () => void }).__letGo = () => {
      cairns = [];
      writer.flush();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ cairns: [] }));
      } catch {
        /* noop */
      }
      setHasKept(false);
    };

    return () => {
      running = false;
      ro.disconnect();
      detachGestures();
      detachVessel();
      if (breathStop) breathStop();
      unvis();
      ungal();
      writer.flush();
      window.removeEventListener("keydown", onKey);
      glCanvas.removeEventListener("webglcontextlost", onLost);
      glCanvas.removeEventListener("webglcontextrestored", onRestored);
      cancelAnimationFrame(raf);
      if (gl) {
        if (prog) gl.deleteProgram(prog);
        if (vs) gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
        if (quad) gl.deleteBuffer(quad);
      }
      prog = null;
      quad = null;
      gl = null;
    };
  }, []);

  const letGo = () => {
    const wrap = wrapRef.current as (HTMLDivElement & { __letGo?: () => void }) | null;
    wrap?.__letGo?.();
    getFieldAudio().thud();
    haptics.roll();
    setHasKept(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#6a7a90" }}>
      <canvas
        ref={glCanvasRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      <canvas
        ref={overlayRef}
        role="application"
        aria-label="the peak above the sea of fog"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <LetGo label="scatter the cairns" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
