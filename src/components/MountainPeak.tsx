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
 * One finger turns the head, two fingers are the frame (pan, the lens, a
 * step back), three are the world-law (weather, season, time), and the
 * vessel is the body: tilt is the horizon, shake sends scree down, a knock
 * on the case rings the peak, face-down is night, and a breath draws the
 * fog down off the range.
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
import { onVessel, requestVessel } from "@/lib/vessel";
import { shouldInvite } from "@/lib/candle";
import LetGo from "@/components/LetGo";
import {
  kickScree,
  stepScree,
  placeCairn,
  cairnStonesForHold,
  nearestCairnIndex,
  mulberry32,
  mix32,
  type Scree,
  type Cairn,
} from "@/lib/mountain";
import {
  EYE_KM,
  FOG_BREATH_KM,
  OCTAVES_MARCH,
  OCTAVES_SHADE,
  MARCH_REFINE,
  MARCH_STEPS,
  SUN_NIGHT_ELEVATION,
  callAnswer,
  echoMidi,
  fogSurfaceAt,
  fogTransmittance,
  groundAt,
  heightAt,
  heightfieldGlsl,
  materialFromGround,
  packHorns,
  paletteForSun,
  restingFogAltitude,
  seedOffset,
  snowlineKm,
  sunDirection,
  windVector,
  windVoice,
  type SkyPalette,
} from "@/lib/heightfield";
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
const ROCK: [number, number, number] = [0.30, 0.27, 0.235];
const SNOW: [number, number, number] = [0.94, 0.96, 0.99];
const GLACIER: [number, number, number] = [0.42, 0.62, 0.74]; // cold blue ice tongue
// A real pinhole, and a long lens. 66° made every ridge a low bump: apparent
// rise is focal-limited, and the massif's crests stand only ~0.26km over the
// inversion at 4km. 35° is also simply how the mountain photographs that
// prompted this room were taken — telephoto compression is what makes a peak
// tower. focal is derived from it rather than guessed.
const FOV = 0.62;
/** Two-finger tap steps the frame back — a wider lens, never past this. */
const FOV_MAX = 1.05;
const FOV_STEP = 0.11;
/** How far above the inversion the wanderer stands, in km. */
const STATION_ABOVE_FOG_KM = 0.11;
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
uniform float uHorizonPx;   // the horizon, in drawing-buffer px from the bottom
uniform float uFocal;       // pinhole focal length, drawing-buffer px
uniform float uRoll;        // the vessel's own horizon
uniform float uYaw;
uniform vec3 uEye;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uZenith;
uniform vec3 uHorizonCol;
uniform vec3 uFogCol;
uniform vec3 uRock;
uniform vec3 uSnow;
uniform vec3 uGlacier;
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
  vec2 q = vec2(gl_FragCoord.x - 0.5 * uRes.x, gl_FragCoord.y - uHorizonPx);
  float cr = cos(uRoll);
  float sr = sin(uRoll);
  q = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
  vec3 cam = normalize(vec3(q.x, q.y, uFocal));
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
    vec3 albedo = uRock * m.x + uSnow * m.y + uGlacier * m.z;
    // the wind's cornice, lying on the lee crest where it actually forms
    albedo = mix(albedo, uSnow, m.w * 0.55);
    // the sun's ray is worth casting where the eye can see the shadow land
    float sh = softShadow(vec3(p.x, h, p.z) + n * 0.006, uSun, tG > 12.0 ? 0 : uShadowSteps);
    float ndl = max(dot(n, uSun), 0.0);
    float light = uAmbient * (0.65 + 0.35 * n.y) + uSunI * ndl * sh;
    // the arete itself catches the light along its edge
    light += (1.0 - smoothstep(0.0, 0.05, crease)) * uSunI * 0.1 * sh;
    // ice is not chalk: a low sheen on the glacier tongues
    float spec = pow(max(dot(normalize(uSun - rd), n), 0.0), 34.0) * (m.z * 0.5 + m.y * 0.14) * sh;
    vec3 face = albedo * light + uSunCol * uSunI * spec * 0.35;
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

    // ——— where the wanderer stands ————————————————————————————
    // NOT on the apex. A marched room cannot fake the station: the outcrop
    // stands 1.15 km over the ridges, so an eye set a hundred metres above
    // the inversion at the origin is buried three quarters of a kilometre
    // inside its own mountain and every ray hits rock on its first step.
    // So the ledge is found rather than assumed — walk out from the apex
    // along each bearing until the ground has fallen to the altitude the
    // composition wants, and stand on the flank that reaches it soonest.
    const restingFog = restingFogAltitude(SEED);
    const stationTarget = restingFog + STATION_ABOVE_FOG_KM;
    let stX = 0;
    let stZ = 0;
    let stBearing = 0;
    let nearest = Infinity;
    for (let b = 0; b < 64; b++) {
      const a = (b / 64) * Math.PI * 2;
      for (let s = 0.12; s <= 3; s += 0.04) {
        const x = Math.sin(a) * s;
        const z = Math.cos(a) * s;
        if (heightAt(x, z, SEED, OCTAVES_MARCH) <= stationTarget) {
          if (s < nearest) {
            nearest = s;
            stX = x;
            stZ = z;
            stBearing = a;
          }
          break;
        }
      }
    }
    // The eye stands EYE_KM over the higher of the two terrains — the one
    // the marcher walks and the one the shader draws (heightfield.ts
    // `eyeAltitude`, the same bug it was written from).
    const eyeY =
      Math.max(
        heightAt(stX, stZ, SEED, OCTAVES_MARCH),
        heightAt(stX, stZ, SEED, OCTAVES_SHADE),
      ) + EYE_KM;
    // He faces outward, the summit at his back, and looks for the crest
    // that subtends the largest angle from this station — every seed gets
    // its own peak to look at, held a little off centre. One scan, at mount.
    let bestBearing = stBearing;
    let bestAngle = -Infinity;
    for (let b = 0; b < 192; b++) {
      const a = (b / 192) * Math.PI * 2;
      // never back over the outcrop he is standing on
      if (Math.cos(a - stBearing) < -0.34) continue;
      for (const d of [1.5, 2.2, 3, 4, 5.5, 7, 9]) {
        const ang =
          (heightAt(stX + Math.sin(a) * d, stZ + Math.cos(a) * d, SEED, OCTAVES_MARCH) - eyeY) / d;
        if (ang > bestAngle) {
          bestAngle = ang;
          bestBearing = a;
        }
      }
    }

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
      const compile = (type: number, src: string) => {
        const s = gl!.createShader(type);
        if (!s) return null;
        gl!.shaderSource(s, src);
        gl!.compileShader(s);
        if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
          console.warn("mountain shader compile failed", gl!.getShaderInfoLog(s));
          gl!.deleteShader(s);
          return null;
        }
        return s;
      };
      vs = compile(gl.VERTEX_SHADER, VERT_SRC);
      fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
      if (!vs || !fs) return false;
      const p = gl.createProgram();
      if (!p) return false;
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.warn("mountain program link failed", gl.getProgramInfoLog(p));
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
    let yaw = bestBearing + 0.16; // the head, turned — the summit off centre
    let yawTarget = yaw;
    let pitchPx = 0; // two-finger drag pans the frame
    let pitchTarget = 0;
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
    let windAt = 0;
    let glDirty = true;
    let lastGlAt = 0;
    let lastSig = Infinity;

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

    /** The camera, in JS — the same pinhole the fragment shader builds. */
    const rayFor = (px: number, py: number): [number, number, number] => {
      const focal = focalPx();
      const horizonY = height * 0.46 + pitchPx;
      let qx = px - width * 0.5;
      let qy = horizonY - py;
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const rx = cr * qx - sr * qy;
      const ry = sr * qx + cr * qy;
      qx = rx;
      qy = ry;
      const len = Math.hypot(qx, qy, focal) || 1;
      const cx = qx / len;
      const cyy = qy / len;
      const cz = focal / len;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      return [cy * cx + sy * cz, cyy, -sy * cx + cy * cz];
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
        void beta;
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
          callOut(x, y, e.intensity);
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
          // one finger turns the head
          yawTarget = clamp(yawTarget - e.dx * 0.0022, -3.2, 3.2);
        },
        pan2: (e) => {
          // two fingers are the frame: the whole view pans under them
          lastTouchAt = performance.now();
          yawTarget = clamp(yawTarget - e.dx * 0.0016, -3.2, 3.2);
          pitchTarget = clamp(pitchTarget + e.dy * 0.6, -height * 0.32, height * 0.32);
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
        scrub: () => {
          lastTouchAt = performance.now();
          fogLiftTarget = clamp(fogLiftTarget - 0.06, -FOG_BREATH_KM * 1.6, FOG_BREATH_KM * 2.4);
          audio.playNote(50, 160);
          haptics.ripple(0.3);
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
      const crests: { x: number; y: number; a: number; w: number }[] = [];
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

      yaw += (yawTarget - yaw) * Math.min(1, wall * 3);
      pitchPx += (pitchTarget - pitchPx) * Math.min(1, wall * 4);
      fov += (fovTarget - fov) * Math.min(1, wall * 3);
      lens += (lensTarget - lens) * Math.min(1, wall * 5);
      sunElev += (sunElevTarget - sunElev) * Math.min(1, wall * 1.4);
      fogLift += (fogLiftTarget - fogLift) * Math.min(1, wall * 1.6);
      fogLiftTarget *= Math.exp(-wall * 0.09); // the inversion always returns
      tutti *= Math.exp(-wall * 2.4);
      // Everything the shader is a function of, in one number. Under reduced
      // motion the picture is only redrawn when this moves — so the room is
      // still until a hand moves it, and no state can quietly stop reaching
      // the screen because someone forgot to flag it.
      const sig =
        yaw +
        pitchPx * 0.01 +
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
      const breath = reduced ? 0 : Math.sin(t * Math.PI * 2 * 0.14);
      const fogAltitude = restingFog + fogLift + breath * FOG_BREATH_KM * 0.18;
      const phase = reduced ? 0 : t * 0.09;

      const sun = sunDirection(sunAz, sunElev);
      const pal: SkyPalette = paletteForSun(sunElev);
      const snowKm = snowlineKm(season);
      const horizonY = height * 0.46 + pitchPx;

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
          gl.uniform1f(u("uHorizonPx"), (height - horizonY) * bufScale);
          gl.uniform1f(u("uFocal"), focalPx() * bufScale);
          gl.uniform1f(u("uRoll"), roll);
          gl.uniform1f(u("uYaw"), yaw);
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
          gl.uniform1i(u("uMarchOct"), Math.max(3, Math.round(OCTAVES_MARCH * detail.samples)));
          gl.uniform1i(u("uShadeOct"), Math.max(4, Math.round(OCTAVES_SHADE * detail.samples)));
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }

      ctx.clearRect(0, 0, width, height);
      if (!glOk) drawRings(pal, sun, fogAltitude, phase, snowKm, horizonY, detail.samples);

      // ——— the cairns, and what the hand is doing to them ———
      for (let i = 0; i < cairns.length; i++) {
        const c = cairns[i];
        const rng = mulberry32(c.seed);
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
          const fade = charge > 0 ? 0.9 - charge * 0.45 : 0.9;
          ctx.fillStyle = `rgba(${90 + rng() * 40},${85 + rng() * 30},${70 + rng() * 20},${fade})`;
          ctx.beginPath();
          ctx.ellipse(
            x + (rng() - 0.5) * 4 + shiver * (s / Math.max(1, c.stones)),
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
        const rng = mulberry32(mix32(Math.round(g.x), Math.round(g.y)));
        for (let s = 0; s < g.stones; s++) {
          ctx.fillStyle = `rgba(${96 + rng() * 40},${90 + rng() * 30},${74 + rng() * 20},0.8)`;
          ctx.beginPath();
          ctx.ellipse(g.x + (rng() - 0.5) * 4, g.y - s * 5, 6 - s * 0.4, 3.5, 0, 0, Math.PI * 2);
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
      // and on the world-law: the fog rises and falls
      if (e.key === "ArrowUp") fogLiftTarget = clamp(fogLiftTarget + 0.06, -FOG_BREATH_KM * 1.6, FOG_BREATH_KM * 2.4);
      if (e.key === "ArrowDown") fogLiftTarget = clamp(fogLiftTarget - 0.06, -FOG_BREATH_KM * 1.6, FOG_BREATH_KM * 2.4);
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
        gl.getExtension("WEBGL_lose_context")?.loseContext();
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
