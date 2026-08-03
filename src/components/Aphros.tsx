"use client";

/**
 * /aphros — the birth room. A living painting, not a diagram.
 *
 * Everything visible is one full-viewport WebGL painting — there is no
 * SVG, no icon, no band, no button. The composition is the Triumph of
 * Galatea compressed to its invariant: a low sun pouring light down a
 * glitter path into a great scallop of nacre standing in the sea, foam
 * gathering around it, dolphins as dark arcs under the swell, a shore
 * of wet mirror-sand at the bottom of the frame.
 *
 * The material is foam. One finger stirs it (wakes), a hold gathers it
 * into a bloom — a phyllotaxis vortex of lace that the room keeps — and
 * a long-held release lets the bloom ascend into the shell: the one
 * solemn act. A two-finger twist rotates the lens: the same sea as
 * painting or as its own preparatory drawing — sepia line-work on
 * parchment, the identical fields rendered as contours. Three fingers
 * are the law: drag is wind, hold dilates time, tap is a tutti. The
 * device is the vessel: tilt leans the swell, a shake raises a squall.
 *
 * Laws honored: determinism from small seeds, procedural over assets,
 * the shared buses (audio / haptics / gesture / vessel), two senses in
 * the same frame, glimmer instead of instructions, reduced motion,
 * keyboard access, persistence with the quiet clear.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";

// ── determinism ──────────────────────────────────────────────────────
function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) & 0xffffffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── the shell scale — pitches the foam answers in (A-major spine) ────
const NOTES = [57, 61, 64, 66, 69, 73, 76, 78, 81];
const noteAt = (x01: number) =>
  NOTES[Math.max(0, Math.min(NOTES.length - 1, Math.floor(x01 * NOTES.length)))];

// ── kept foam ────────────────────────────────────────────────────────
const STORAGE_KEY = "objetdart:aphros:v2";
const MAX_BLOOMS = 12;
const MAX_WAKES = 14;

type Bloom = {
  nx: number;      // 0..1 of width
  ny: number;      // 0..1 of height
  size: number;    // radius in uv-height units
  seed: number;
  born: number;    // performance.now() at planting (0 for restored blooms)
  ascendAt: number; // 0 = at rest; else timestamp the ascent began
};

type Wake = { x: number; y: number; born: number; strength: number };

// dolphins — parametric leaps along the chi's two diagonals: two ride
// the right-rising stroke, one crosses them on the left-rising stroke
const DOLPHIN_PARAMS = [
  { period: 11.0, offset: 0.0, x0: -0.08, x1: 1.08, lift: 0.16, yBase: 0.68, slope: -0.16 },
  { period: 14.5, offset: 5.1, x0: 1.08, x1: -0.08, lift: 0.2, yBase: 0.5, slope: 0.16 },
  { period: 9.6, offset: 8.0, x0: -0.08, x1: 1.08, lift: 0.13, yBase: 0.74, slope: -0.14 },
];

// composition constants (fractions of viewport height)
const HORIZON = 0.34;
const SHORE = 0.8;
const SHELL_X = 0.5;
const SHELL_Y = 0.58;

export default function Aphros() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const bloomsRef = useRef<Bloom[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── size ─────────────────────────────────────────────────────────
    let width = 0;
    let height = 0;
    let glReady = false;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (glReady && gl) gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    // ── kept foam: load, save ────────────────────────────────────────
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { blooms?: Array<Partial<Bloom>> };
        if (Array.isArray(parsed.blooms)) {
          bloomsRef.current = parsed.blooms
            .filter((b) => typeof b.nx === "number" && typeof b.ny === "number")
            .slice(-MAX_BLOOMS)
            .map((b) => ({
              nx: b.nx as number,
              ny: b.ny as number,
              size: typeof b.size === "number" ? b.size : 0.05,
              seed: typeof b.seed === "number" ? b.seed : hashSeed(1),
              born: 0,
              ascendAt: 0,
            }));
        }
      }
    } catch {
      /* a fresh sea */
    }
    setHasKept(bloomsRef.current.length > 0);
    const save = () => {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            blooms: bloomsRef.current
              .filter((b) => b.ascendAt === 0)
              .map(({ nx, ny, size, seed }) => ({ nx, ny, size, seed })),
          }),
        );
      } catch {
        /* noop */
      }
      setHasKept(bloomsRef.current.some((b) => b.ascendAt === 0));
    };

    // ── live state the hand writes ───────────────────────────────────
    const wakes: Wake[] = [];
    let wind = 0;           // three-finger shore wind, decays
    let tiltX = 0;          // vessel tilt
    let agitation = 0;      // squall — shake / tutti, decays
    let flash = 0;          // tutti flash impulse, decays fast
    let lensTarget = 0;     // 0 painting … 1 drawing
    let lens = 0;
    let lensDetentSide = 0; // for the crossing tick
    let timeScaleTarget = 1;
    let timeScale = 1;
    let lastTouchAt = performance.now();
    let lastGlimmerAt = 0;
    let lastStirNoteAt = 0;
    let holdBloom: Bloom | null = null;

    const pushWake = (x01: number, y01: number, strength: number) => {
      wakes.push({ x: x01, y: y01, born: performance.now(), strength });
      if (wakes.length > MAX_WAKES) wakes.shift();
    };

    const plantBloom = (nx: number, ny: number): Bloom => {
      // foam blooms live on the sea — clamp into the water
      const cy = Math.max(HORIZON + 0.05, Math.min(SHORE + 0.06, ny));
      const b: Bloom = {
        nx: Math.max(0.03, Math.min(0.97, nx)),
        ny: cy,
        size: 0.035,
        seed: hashSeed(Math.round(nx * 8191), Math.round(cy * 4093), bloomsRef.current.length),
        born: performance.now(),
        ascendAt: 0,
      };
      bloomsRef.current.push(b);
      if (bloomsRef.current.length > MAX_BLOOMS) bloomsRef.current.shift();
      save();
      return b;
    };

    // ── vessel — passive; the candle owns permission ─────────────────
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (!reduced) tiltX = Math.max(-1, Math.min(1, gamma / 45));
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        agitation = Math.min(1, agitation + intensity);
        haptics.chop();
      },
    });

    // ── the grammar ──────────────────────────────────────────────────
    const detachGestures = attachGestures(
      canvas,
      {
        tap: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // tutti — every bloom flashes, the sea answers in a chord
            flash = 1;
            agitation = Math.min(1, agitation + 0.3);
            audio.playNote(57, 260);
            audio.playNote(64, 260);
            audio.playNote(69, 300);
            haptics.ripple(0.5);
            return;
          }
          if (e.fingers === 2) return; // reserved — the frame's verbs
          // a kiss of foam — sight and sound in the same frame
          pushWake(e.x / Math.max(1, width), e.y / Math.max(1, height), 0.5 + e.intensity * 0.5);
          audio.playNote(noteAt(e.x / Math.max(1, width)), 200);
          haptics.tap();
        },
        hold: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // the law: held fingers dilate the whole shore's time
            if (e.phase === "enter") timeScaleTarget = 0.25;
            if (e.phase === "release") timeScaleTarget = 1;
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "enter" && e.tier >= 1) {
            holdBloom = plantBloom(e.x / Math.max(1, width), e.y / Math.max(1, height));
            audio.spark();
            haptics.ripple(0.5);
          }
          if (e.phase === "tick" && holdBloom) {
            // duration is an axis: the bloom keeps gathering while held
            holdBloom.size = Math.min(0.12, 0.035 + (e.elapsed / 4200) * 0.1);
          }
          if (e.phase === "release") {
            if (holdBloom && e.tier >= 3) {
              // the ceremony: the gathered foam ascends into the shell
              holdBloom.ascendAt = performance.now();
              audio.bell();
              haptics.bloom();
              save();
            } else if (holdBloom) {
              audio.playNote(noteAt(holdBloom.nx), 240);
            }
            holdBloom = null;
          }
        },
        drag: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            if (!reduced) wind = Math.max(-1.4, Math.min(1.4, wind + e.dx * 0.004));
            return;
          }
          if (e.fingers !== 1) return;
          // stirring the water — a wake follows the finger
          const speed = Math.min(1, Math.hypot(e.vx, e.vy) / 1400);
          pushWake(e.x / Math.max(1, width), e.y / Math.max(1, height), 0.3 + speed * 0.7);
          const now = performance.now();
          if (now - lastStirNoteAt > 260 && speed > 0.12) {
            lastStirNoteAt = now;
            audio.playNote(noteAt(e.x / Math.max(1, width)) - 12, 140);
          }
        },
        twist: (e) => {
          lastTouchAt = performance.now();
          // rotate the lens: painting ↔ its own preparatory drawing
          if (e.phase === "start") return;
          lensTarget = Math.max(0, Math.min(1, lensTarget + e.velocity * 0.010));
          const side = lensTarget > 0.5 ? 1 : 0;
          if (side !== lensDetentSide) {
            lensDetentSide = side;
            haptics.lens();
            audio.playNote(side === 1 ? 85 : 81, 120);
          }
        },
        scrub: (e) => {
          lastTouchAt = performance.now();
          // winding a whirlpool — a strong spiral wake at the scrub centre
          pushWake(e.cx / Math.max(1, width), e.cy / Math.max(1, height), 1.0);
          agitation = Math.min(1, agitation + 0.12);
          audio.playNote(64, 240);
          haptics.ripple(0.4);
        },
        rhythm: (e) => {
          if (e.stability > 0.7) agitation = Math.min(1, agitation + 0.08);
        },
      },
      { wheelZoom: false },
    );

    // ── WebGL — the painting ─────────────────────────────────────────
    const gl =
      (canvas.getContext("webgl", { antialias: false }) ||
        canvas.getContext("experimental-webgl" as "webgl")) as WebGLRenderingContext | null;

    let raf = 0;
    if (gl) {
      const vert = `
        attribute vec2 a_pos;
        varying vec2 vUv;
        void main() {
          vUv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;
      const frag = `
        precision highp float;
        uniform float uTime;
        uniform vec2 uRes;
        uniform float uWind;
        uniform float uTilt;
        uniform float uAgit;
        uniform float uFlash;
        uniform float uLens;
        uniform vec4 uBlooms[${MAX_BLOOMS}]; // x, y, size, alpha
        uniform int uBloomCount;
        uniform vec4 uWakes[${MAX_WAKES}];   // x, y, age, strength
        uniform int uWakeCount;
        uniform vec4 uDolphins[3];           // x, y, angle, presence
        varying vec2 vUv;

        const float HORIZON = ${HORIZON.toFixed(3)};
        const float SHORE = ${SHORE.toFixed(3)};
        const vec2 SHELL = vec2(${SHELL_X.toFixed(3)}, ${SHELL_Y.toFixed(3)});

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
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
          for (int i = 0; i < 5; i++) {
            v += a * vnoise(p);
            p *= 2.03;
            a *= 0.52;
          }
          return v;
        }

        mat2 rot2(float a) {
          float c = cos(a);
          float s = sin(a);
          return mat2(c, -s, s, c);
        }
        float sdEll(vec2 p, vec2 ab) {
          return (length(p / ab) - 1.0) * min(ab.x, ab.y);
        }

        // ── a cherub, from five ellipses — head, torso, legs, two wings ──
        float cherubBody(vec2 p) {
          float d = sdEll(p - vec2(0.02, -0.60), vec2(0.33, 0.33));       // head
          d = min(d, sdEll(p - vec2(0.0, 0.05), vec2(0.42, 0.55)));       // torso
          d = min(d, sdEll(rot2(0.55) * (p - vec2(-0.38, 0.42)), vec2(0.34, 0.16))); // legs kicked back
          return d;
        }
        float cherubWings(vec2 p) {
          float d = sdEll(rot2(0.85) * (p - vec2(-0.42, -0.38)), vec2(0.66, 0.20));
          d = min(d, sdEll(rot2(1.25) * (p - vec2(-0.16, -0.52)), vec2(0.52, 0.15)));
          return d;
        }

        // ── a dolphin, as mathematics: arched body with a sine radius
        // profile, dorsal fin, tail flukes, a small beak ──
        float dolphinSdf(vec2 p) {
          p.y += 6.0 * p.x * p.x;                 // the arch of the leap
          float L = 0.055;
          float u = clamp((p.x + L) / (2.0 * L), 0.0, 1.0);
          float r = 0.0145 * sin(3.14159 * pow(u, 0.62));
          float body = abs(p.y) - r;
          body = max(body, abs(p.x) - L);
          float fin = sdEll(rot2(0.55) * (p - vec2(0.004, -0.018)), vec2(0.013, 0.0042));
          float fl1 = sdEll(rot2(0.75) * (p - vec2(-L * 0.98, 0.0)), vec2(0.013, 0.0038));
          float fl2 = sdEll(rot2(-0.75) * (p - vec2(-L * 0.98, 0.0)), vec2(0.013, 0.0038));
          float beak = sdEll(p - vec2(L * 1.02, 0.005), vec2(0.010, 0.0036));
          return min(min(body, fin), min(min(fl1, fl2), beak));
        }

        void main() {
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y); // y = 0 top, 1 bottom
          float aspect = uRes.x / uRes.y;
          float t = uTime;
          float breath = sin(t * 6.28318 * 0.14) * 0.5 + 0.5; // the 7s clock

          // ── wakes: the hand's stirring, a height + foam field ──
          float wakeHi = 0.0;
          for (int i = 0; i < ${MAX_WAKES}; i++) {
            if (i >= uWakeCount) break;
            vec4 wk = uWakes[i];
            vec2 dp = (uv - wk.xy) * vec2(aspect, 1.0);
            float dist = length(dp);
            float age = wk.z;
            if (age > 2.2) continue;
            float front = dist - age * 0.09;
            float env = exp(-(front * front) / 0.00022);
            float temporal = max(0.0, 1.0 - age / 2.2);
            wakeHi += wk.w * env * temporal / (1.0 + dist * 10.0);
          }

          // ── the sun, low over the water ──
          vec2 sunD = (uv - vec2(0.5, HORIZON - 0.02)) * vec2(max(aspect, 1.5), 1.0);
          float sunDist = length(sunD);
          float sunGlow = exp(-sunDist * sunDist * 34.0);
          float sunHalo = exp(-sunDist * 5.2);

          // ════ SKY — baroque: storm masses breaking into gold ════
          // slate and gray-violet cloud country, a raphael-blue break
          // above, warming to the one gold rent of light at the horizon
          vec3 rafBlue = vec3(0.40, 0.57, 0.76);
          vec3 violetG = vec3(0.56, 0.55, 0.64);
          vec3 goldLt  = vec3(0.95, 0.83, 0.62);
          float skyT = clamp(uv.y / HORIZON, 0.0, 1.0);
          vec3 sky = mix(rafBlue, violetG, smoothstep(0.0, 0.60, skyT));
          sky = mix(sky, goldLt, smoothstep(0.42, 1.0, skyT) * 0.9);
          vec2 cp = vec2(uv.x * aspect * 1.05 + t * 0.016 + uWind * 0.10, uv.y * 3.0);
          vec2 cw = vec2(fbm(cp + vec2(0.0, t * 0.010)), fbm(cp + vec2(5.2, 1.3)));
          float cloud = fbm(cp + (cw - 0.5) * 1.6);
          float billow = smoothstep(0.44, 0.85, cloud);
          float cloudBelly = smoothstep(0.50, 0.95, fbm(cp * 1.6 + (cw - 0.5) * 1.3 + vec2(2.0, 4.0)));
          // dark bellies, gold-lit rims facing the sun
          vec3 cloudCol = mix(vec3(0.97, 0.84, 0.78), vec3(0.36, 0.36, 0.47), cloudBelly * 0.9);
          float rimGold = (smoothstep(0.40, 0.52, cloud) - smoothstep(0.52, 0.72, cloud));
          cloudCol += max(0.0, rimGold) * vec3(0.56, 0.28, 0.20) * exp(-sunDist * 1.6) * 1.5;
          float cloudMask = billow * (1.0 - smoothstep(0.60, 1.0, skyT)) * smoothstep(0.02, 0.12, skyT);
          sky = mix(sky, cloudCol, cloudMask * 0.92);
          float ang = atan(sunD.x, -sunD.y);
          float rayN = fbm(vec2(ang * 2.6 + 7.0, t * 0.05));
          float rays = pow(max(0.0, sin(ang * 7.0 + rayN * 5.0 + t * 0.03)), 4.0);
          sky += rays * exp(-sunDist * 2.8) * vec3(1.0, 0.88, 0.66) * 0.22;
          sky += (sunGlow * 0.60 + sunHalo * 0.13) * vec3(1.0, 0.90, 0.68);

          // ── the cherub train — four winged figures riding the falling
          // diagonal (the chi's other stroke), trailing crimson ribbons ──
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float ci = fi / 3.0;
            // formation along the diagonal, big near right, small far left
            vec2 pp = mix(vec2(0.86, 0.255), vec2(0.14, 0.075), ci);
            pp += vec2(sin(t * 0.11 + fi * 1.7) * 0.012, cos(t * 0.13 + fi * 1.1) * 0.008);
            float cs = mix(0.050, 0.030, ci);
            vec2 cpd = (uv - pp) * vec2(aspect, 1.0);
            if (length(cpd) > cs * 2.6) continue;
            // banked along the flight line, breathing a little
            float bank = -0.28 + sin(t * 0.10 + fi * 0.9) * 0.07;
            vec2 cl = rot2(bank) * cpd / cs;
            // wings first — pale gold, behind the body
            float wm = smoothstep(0.05, -0.05, cherubWings(cl));
            sky = mix(sky, vec3(0.97, 0.91, 0.80), wm * 0.85);
            // flesh — lit from beneath by the gold rent at the horizon
            float bm = smoothstep(0.05, -0.05, cherubBody(cl));
            vec3 flesh = vec3(0.95, 0.79, 0.70) * (0.86 + 0.14 * smoothstep(-0.8, 0.8, cl.y));
            flesh += vec3(0.09, 0.015, 0.02) * smoothstep(0.5, 0.0, length(cl - vec2(0.06, -0.58))); // blush
            sky = mix(sky, flesh, bm * 0.96);
            // a crimson ribbon streaming behind, along the flight line
            vec2 rl = cl - vec2(1.35, 0.30);
            rl.y += sin(rl.x * 3.2 + t * 0.9 + fi) * 0.14;
            float ribbon = exp(-(rl.x * rl.x) / 1.3 - (rl.y * rl.y) / 0.012) * step(0.0, rl.x + 1.2);
            sky = mix(sky, vec3(0.72, 0.16, 0.19), ribbon * 0.55 * (1.0 - bm));
            // a soft rose halo so the figures sit in the air, not on it
            sky += exp(-dot(cpd, cpd) / (cs * cs * 2.6)) * vec3(0.10, 0.05, 0.04);
          }

          // ════ SEA ════
          float seaT = clamp((uv.y - HORIZON) / (SHORE - HORIZON), 0.0, 1.0);
          float persp = mix(0.16, 1.0, seaT);
          float sway = uWind * 0.05 + uTilt * 0.04;
          vec2 flow = vec2(
            sin(seaT * 9.0 + t * 0.62) * 0.018,
            sin(uv.x * 6.5 + t * 0.44) * 0.012
          ) * persp;
          flow += vec2(
            sin(seaT * 3.1 - t * 0.27) * 0.010,
            cos(uv.x * 2.5 + t * 0.21) * 0.007
          ) * persp;
          flow.x += sway * persp;
          vec2 suv = vec2(uv.x, seaT) + flow + vec2(0.0, wakeHi * 0.04);
          float sd = clamp(suv.y, 0.0, 1.0);

          // the sea of the old masters: warm mirror at the light, then
          // teal turning prussian-green in the deeps
          vec3 nacreW = vec3(0.86, 0.74, 0.58);
          vec3 turq   = vec3(0.18, 0.44, 0.46);
          vec3 aegean = vec3(0.06, 0.22, 0.29);
          vec3 shoal  = vec3(0.26, 0.50, 0.46);
          vec3 sea = mix(nacreW, turq, smoothstep(0.0, 0.34, sd));
          sea = mix(sea, aegean, smoothstep(0.28, 0.66, sd) * 0.75);
          sea = mix(sea, shoal, smoothstep(0.66, 0.98, sd) * 0.7);

          float mir = fbm(vec2(suv.x * aspect * 1.7 + t * 0.05, sd * 14.0));
          sea = mix(sea, vec3(0.95, 0.64, 0.56),
            (1.0 - smoothstep(0.0, 0.30, sd)) * smoothstep(0.46, 0.85, mir) * 0.58);
          sea += sunHalo * exp(-sd * 6.0) * vec3(0.27, 0.15, 0.11);

          vec2 nuv = suv * vec2(aspect, 1.0) * (3.0 + 3.6 * sd) + vec2(t * 0.06, t * 0.04);
          float n = fbm(nuv);
          float c1 = sin((suv.x + n * 0.18) * 24.0 + t * 0.50)
                   * sin((sd + n * 0.14) * 15.0 - t * 0.34);
          float caustic = smoothstep(0.62, 1.08, c1);
          sea += caustic * mix(0.09, 0.04, sd) * vec3(1.0, 0.97, 0.90);

          // the glitter path — the sun pouring into the shell
          float column = exp(-pow((uv.x - 0.5) * (2.2 + 1.4 * sd), 2.0));
          float facets = fbm(vec2(uv.x * aspect * 16.0, sd * 30.0 - t * 1.3));
          float glint = column * smoothstep(0.56, 0.94, facets) * (1.0 - sd * 0.35);
          sea += glint * (0.5 + uAgit * 0.2) * vec3(1.0, 0.88, 0.64);

          // ── dolphins: real bodies leaping the crossing diagonals ──
          float dolphinEdge = 0.0;
          for (int i = 0; i < 3; i++) {
            vec4 d = uDolphins[i];
            if (d.w < 0.01) continue;
            vec2 dp = (uv - d.xy) * vec2(aspect, 1.0);
            vec2 lp = rot2(-d.z) * dp;
            float sdf = dolphinSdf(lp);
            float m = smoothstep(0.0018, -0.0018, sdf) * d.w;
            if (m > 0.001) {
              // two-tone: slate-teal back, warm pale belly, the arch line
              float bendY = lp.y + 6.0 * lp.x * lp.x;
              float backSide = smoothstep(0.007, -0.002, bendY);
              vec3 dcol = mix(vec3(0.80, 0.76, 0.68), vec3(0.12, 0.22, 0.27), backSide);
              // wet sheen along the back facing the light
              dcol += smoothstep(0.004, 0.0, abs(bendY + 0.010)) * vec3(0.35, 0.38, 0.36) * 0.8;
              sea = mix(sea, dcol, m * 0.95);
            }
            dolphinEdge = max(dolphinEdge, smoothstep(0.003, 0.0, abs(sdf)) * d.w);
          }
          sea += dolphinEdge * vec3(0.30, 0.34, 0.32) * 0.20;

          // aphros — the ambient lace, whitening with squall + wakes
          vec2 fuv = suv * vec2(aspect, 1.0) * 5.5 + vec2(t * 0.09 + uWind * 0.5, -t * 0.05);
          float l1 = fbm(fuv);
          float l2 = fbm(fuv * 2.1 + vec2(3.7, 1.3) + l1 * 1.1);
          float vein = 1.0 - abs(2.0 * l2 - 1.0);
          float lace = smoothstep(0.74 - uAgit * 0.12, 0.98, vein * (0.55 + 0.45 * l1));
          float crest = smoothstep(0.45, 0.95, sin(sd * 20.0 - t * 0.70 + l1 * 3.0) * 0.5 + 0.5);
          float laceAmt = lace * (0.3 + 0.7 * crest) * smoothstep(0.30, 1.0, sd);
          laceAmt = clamp(laceAmt + wakeHi * 0.65, 0.0, 1.0);
          sea = mix(sea, vec3(0.99, 0.98, 0.95), laceAmt * (0.55 + uAgit * 0.25));
          sea += wakeHi * 0.02 * vec3(1.0);

          // ── blooms: phyllotaxis vortices of foam the room keeps ──
          float bloomFoam = 0.0;
          float bloomGlow = 0.0;
          for (int i = 0; i < ${MAX_BLOOMS}; i++) {
            if (i >= uBloomCount) break;
            vec4 b = uBlooms[i];
            vec2 bp = (uv - b.xy) * vec2(aspect, 1.0);
            float br = length(bp);
            if (br > b.z * 2.2) continue;
            float ba = atan(bp.y, bp.x);
            float ph = hash21(b.xy * 731.7) * 6.28318;
            // golden-angle arms swirling on the room's clock
            float arm = cos(ba * 3.0 + br * (110.0 / max(b.z, 0.02)) * 0.55 - t * 1.1 + ph);
            float swirl = smoothstep(0.35, 0.95, arm * 0.5 + 0.5);
            float envb = exp(-(br * br) / (b.z * b.z * 0.55));
            float petals = smoothstep(0.55, 0.95, cos(ba * 8.0 + t * 0.3 + ph) * 0.5 + 0.5);
            float f = envb * (0.45 + 0.55 * swirl) * (0.6 + 0.4 * petals) * b.w;
            bloomFoam += f;
            bloomGlow += exp(-(br * br) / (b.z * b.z * 1.6)) * b.w;
          }
          bloomFoam = clamp(bloomFoam * (1.0 + uFlash * 0.8), 0.0, 1.0);
          sea = mix(sea, vec3(1.0, 0.99, 0.96), bloomFoam * 0.85);
          sea += bloomGlow * (0.05 + uFlash * 0.10) * vec3(1.0, 0.92, 0.86);

          // ── THE SHELL — a great scallop of nacre standing in the sea ──
          vec2 sp = (uv - SHELL) * vec2(aspect, 1.0);
          sp.x += sway * 0.15;
          float sr = length(sp);
          float sang = atan(sp.x, -sp.y); // 0 = up
          float shellR = (0.155 + breath * 0.004) * (1.0 + uFlash * 0.02);
          float fan = cos(sang * 9.0);
          float rOut = shellR * (0.90 + 0.10 * fan * fan) * (1.0 - smoothstep(1.35, 2.6, abs(sang)) * 0.55);
          float inShell = smoothstep(rOut, rOut - 0.006, sr) * (1.0 - smoothstep(1.9, 2.6, abs(sang)));
          // ivory nacre: a faint film of iridescence over bone-white,
          // the grooves shaded umber like a real scallop in raking light
          float phase2 = sr * 46.0 - t * 0.35 + fan * 1.6;
          vec3 pearl = vec3(
            0.95 + 0.02 * cos(phase2),
            0.90 + 0.03 * cos(phase2 + 2.1),
            0.81 + 0.04 * cos(phase2 + 4.2)
          );
          float ridgeLight = smoothstep(0.2, 1.0, fan * fan);
          vec3 groove = pearl * vec3(0.68, 0.60, 0.50);
          vec3 shellCol = mix(groove, pearl, ridgeLight);
          shellCol *= 0.90 + 0.10 * smoothstep(1.0, 0.0, sr / max(shellR, 0.001));
          shellCol += vec3(0.05, 0.008, 0.018) * ridgeLight; // rose in the nacre
          float rim = smoothstep(0.012, 0.0, abs(sr - rOut)) * (1.0 - smoothstep(1.6, 2.4, abs(sang)));
          // the shell stands ON the sea: only above its waterline
          float shellMask = inShell * smoothstep(0.035, 0.0, uv.y - SHELL.y - 0.055);
          vec3 seaWithShell = mix(sea, shellCol, shellMask);
          seaWithShell += rim * vec3(1.0, 0.96, 0.88) * (0.5 + breath * 0.3 + uFlash * 0.4);
          // halo of light gathering around the shell
          float halo = exp(-max(0.0, sr - rOut) * 30.0) * (1.0 - inShell);
          seaWithShell += halo * (0.07 + breath * 0.04 + uFlash * 0.12) * vec3(1.0, 0.92, 0.74);
          // the sea churns white where the shell stands in it
          float churnN = fbm(vec2(uv.x * aspect * 7.0 + t * 0.22, uv.y * 14.0 - t * 0.12));
          float skirt = exp(-pow((uv.y - (SHELL.y + 0.05)) * 42.0, 2.0))
                      * exp(-pow(sp.x * 3.2, 2.0))
                      * (0.50 + 0.50 * churnN);
          seaWithShell = mix(seaWithShell, vec3(0.98, 0.97, 0.93), skirt * (0.68 + breath * 0.2));
          sea = seaWithShell;

          // ════ SHORE — wet mirror-sand at the foot of the frame ════
          float shT = clamp((uv.y - SHORE) / (1.0 - SHORE), 0.0, 1.0);
          float swashN = fbm(vec2(uv.x * aspect * 1.3 + uWind * 0.4, t * 0.10));
          float edge = 0.30 + 0.18 * sin(t * 0.26 + uv.x * 4.0) + (swashN - 0.5) * 0.4;
          float above = 1.0 - smoothstep(edge - 0.14, edge + 0.10, shT);
          vec3 wetSand = vec3(0.82, 0.71, 0.58);
          vec3 drySand = vec3(0.90, 0.80, 0.64);
          vec3 shore = mix(wetSand, drySand, smoothstep(0.35, 1.0, shT));
          // the sky and sun mirrored in the wet film
          float wet = 1.0 - smoothstep(0.0, 0.55, shT);
          shore += wet * exp(-pow((uv.x - 0.5) * 2.6, 2.0)) * vec3(0.15, 0.10, 0.07);
          shore += wet * 0.07 * vec3(0.97, 0.84, 0.78);
          // foam sheet with lace holes above the moving swash edge
          float shoreFoamN = fbm(vec2(uv.x * aspect * 6.0 + t * 0.05, shT * 5.0 - t * 0.16));
          float holes = smoothstep(0.30, 0.72, shoreFoamN);
          shore = mix(shore, mix(vec3(0.99, 0.97, 0.93), vec3(0.93, 0.90, 0.85), holes * 0.5),
            clamp(above * (0.6 + 0.4 * holes), 0.0, 1.0));
          float grain = hash21(floor(uv * uRes * 0.6));
          shore += (grain - 0.5) * 0.03 * smoothstep(0.2, 1.0, shT);

          // ════ compose ════
          vec3 col = sky;
          col = mix(col, sea, smoothstep(HORIZON - 0.002, HORIZON + 0.004, uv.y));
          float haze = smoothstep(HORIZON - 0.03, HORIZON, uv.y)
                     * (1.0 - smoothstep(HORIZON, HORIZON + 0.05, uv.y));
          col = mix(col, vec3(0.97, 0.86, 0.76), haze * 0.45);
          col = mix(col, shore, smoothstep(SHORE - 0.012, SHORE + 0.012, uv.y));

          // ── the chi of silks: two billowing bands crossing over the
          // shell — a rose one sweeping up-left behind, a crimson one
          // sweeping up-right in front. the crossed diagonals are the
          // composition's motion; everything else rides one stroke or
          // the other. ──
          vec2 arp0 = (uv - vec2(0.5, SHELL.y + 0.02)) * vec2(aspect, 1.0);

          // rose band (behind), tilted to the left-rising diagonal
          vec2 arpB = rot2(-0.52) * arp0;
          float arAngB = atan(arpB.x, -arpB.y);
          float arRB = length(arpB);
          float flutterB = sin(arAngB * 3.0 - t * 0.8) * 0.011
                         + sin(arAngB * 6.0 + t * 1.1) * 0.005;
          float arcRB = 0.265 + flutterB - uWind * 0.018 * sin(arAngB * 2.0);
          float bandDB = abs(arRB - arcRB);
          float extentB = (1.0 - smoothstep(0.50, 1.00, arAngB))
                        * (1.0 - smoothstep(0.95, 1.40, -arAngB));
          float thickB = 0.024 * (0.62 + 0.38 * sin(arAngB * 2.0 - t * 0.4));
          float drapeB = smoothstep(thickB, thickB * 0.35, bandDB) * extentB;
          float foldsB = sin(arAngB * 24.0 - t * 0.6) * 0.5 + 0.5;
          vec3 silkB = mix(vec3(0.86, 0.42, 0.50), vec3(0.97, 0.70, 0.74), 0.3 + 0.4 * foldsB);
          silkB *= 0.86 + 0.14 * foldsB;
          float shadeB = (smoothstep(thickB * 3.0, thickB, bandDB) - drapeB) * extentB;
          col *= 1.0 - shadeB * 0.08;
          col = mix(col, silkB, drapeB * 0.88);

          // crimson band (in front), tilted to the right-rising diagonal
          vec2 arp = rot2(0.38) * arp0;
          float arAng = atan(arp.x, -arp.y);
          float arR = length(arp);
          float flutter = sin(arAng * 3.0 + t * 0.9) * 0.010
                        + sin(arAng * 7.0 - t * 1.3) * 0.005;
          float arcR = 0.225 + flutter + uWind * 0.020 * sin(arAng * 2.0);
          float bandD = abs(arR - arcR);
          float extent = (1.0 - smoothstep(0.55, 1.05, -arAng))
                       * (1.0 - smoothstep(0.95, 1.45, arAng));
          float thick = 0.030 * (0.60 + 0.40 * sin(arAng * 2.0 + t * 0.5));
          float drape = smoothstep(thick, thick * 0.35, bandD) * extent;
          float folds = sin(arAng * 26.0 + t * 0.7) * 0.5 + 0.5;
          vec3 silk = mix(vec3(0.78, 0.20, 0.20), vec3(0.95, 0.50, 0.42), 0.28 + 0.44 * folds);
          silk *= 0.84 + 0.16 * folds;
          silk += smoothstep(thick * 0.5, 0.0, bandD) * 0.08;
          float drapeShade = (smoothstep(thick * 3.0, thick, bandD) - drape) * extent;
          col *= 1.0 - drapeShade * 0.10;
          col = mix(col, silk, drape * 0.92);

          // ── the lens: the painting as its own preparatory drawing ──
          if (uLens > 0.001) {
            vec3 paper = vec3(0.93, 0.89, 0.79);
            vec3 sepia = vec3(0.32, 0.22, 0.14);
            float line = 0.0;
            // sea contours — iso-lines of the same swell field
            float seaIso = abs(fract((seaT + flow.y * 6.0) * 16.0) - 0.5);
            line += smoothstep(0.14, 0.02, seaIso) * 0.5
                  * smoothstep(HORIZON, HORIZON + 0.02, uv.y)
                  * (1.0 - smoothstep(SHORE, SHORE + 0.02, uv.y));
            // cloud contours
            float cloudIso = abs(fract(cloud * 7.0) - 0.5);
            line += smoothstep(0.12, 0.02, cloudIso) * cloudMask * 0.8;
            // ray construction lines
            line += rays * exp(-sunDist * 2.4) * 0.35 * (1.0 - smoothstep(HORIZON, HORIZON + 0.02, uv.y));
            // the shell's ridge lines and rim
            line += smoothstep(0.5, 0.95, fan * fan) * shellMask * 0.8;
            line += rim * 0.9;
            // bloom spirals and wakes as pen swirls
            line += bloomFoam * 0.7 + wakeHi * 0.4;
            // dolphin outlines
            line += dolphinEdge * 0.9;
            // both silks' contours and fold hatching
            line += smoothstep(0.006, 0.001, abs(bandD - thick)) * extent * 0.8;
            line += drape * smoothstep(0.6, 0.95, folds) * 0.3;
            line += smoothstep(0.006, 0.001, abs(bandDB - thickB)) * extentB * 0.7;
            line += drapeB * smoothstep(0.6, 0.95, foldsB) * 0.25;
            // shore hatching
            float hatch = smoothstep(0.42, 0.5, abs(fract((uv.x * aspect + uv.y * 0.6) * 60.0) - 0.5));
            line += (1.0 - hatch) * 0.12 * smoothstep(SHORE, 1.0, uv.y);
            vec3 drawing = paper - clamp(line, 0.0, 1.0) * (paper - sepia);
            float vign = fbm(uv * 3.0) * 0.06;
            drawing -= vign;
            col = mix(col, drawing, smoothstep(0.0, 1.0, uLens));
          }

          // painted-canvas finish: weave, a touch of depth, a dark frame
          float weave = fbm(uv * vec2(aspect, 1.0) * 9.0);
          col *= 0.965 + weave * 0.05;
          col = pow(col, vec3(1.05));
          vec2 vc = vUv - 0.5;
          col *= 1.0 - dot(vc, vc) * 0.34;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }
      `;
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn("aphros painting shader failed", gl.getShaderInfoLog(s));
          gl.deleteShader(s);
          return null;
        }
        return s;
      };
      const vs = compile(gl.VERTEX_SHADER, vert);
      const fs = compile(gl.FRAGMENT_SHADER, frag);
      if (vs && fs) {
        const prog = gl.createProgram();
        if (prog) {
          gl.attachShader(prog, vs);
          gl.attachShader(prog, fs);
          gl.linkProgram(prog);
          if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            glReady = true;
            const U = (name: string) => gl.getUniformLocation(prog, name);
            const uTime = U("uTime");
            const uRes = U("uRes");
            const uWindU = U("uWind");
            const uTiltU = U("uTilt");
            const uAgitU = U("uAgit");
            const uFlashU = U("uFlash");
            const uLensU = U("uLens");
            const uBloomsU = U("uBlooms");
            const uBloomCountU = U("uBloomCount");
            const uWakesU = U("uWakes");
            const uWakeCountU = U("uWakeCount");
            const uDolphinsU = U("uDolphins");
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
            const loc = gl.getAttribLocation(prog, "a_pos");
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            gl.useProgram(prog);
            gl.viewport(0, 0, canvas.width, canvas.height);

            const bloomData = new Float32Array(MAX_BLOOMS * 4);
            const wakeData = new Float32Array(MAX_WAKES * 4);
            const dolphinData = new Float32Array(3 * 4);
            const prevPresence = [0, 0, 0];

            let lastNow = performance.now();
            let wT = 0; // warped seconds — three fingers dilate the shore
            const motion = reduced ? 0.3 : 1;

            const draw = (now: number) => {
              const rawDt = Math.min(64, now - lastNow) / 1000;
              lastNow = now;
              timeScale += (timeScaleTarget - timeScale) * Math.min(1, rawDt * 5);
              wT += rawDt * timeScale * motion;
              wind *= Math.exp(-rawDt / 2.2);
              agitation *= Math.exp(-rawDt / 2.8);
              flash *= Math.exp(-rawDt / 0.45);
              lens += (lensTarget - lens) * Math.min(1, rawDt * 5);

              // glimmer — after quiet, foam gathers at the shell unbidden
              if (now - lastTouchAt > 20000 && now - lastGlimmerAt > 9000) {
                lastGlimmerAt = now;
                const g = mulberry32(hashSeed(Math.floor(now / 9000)))();
                pushWake(SHELL_X + (g - 0.5) * 0.2, SHELL_Y + 0.06, 0.7);
              }

              // blooms → uniforms (growth, ascent, retirement)
              let bloomCount = 0;
              for (let i = bloomsRef.current.length - 1; i >= 0; i--) {
                const b = bloomsRef.current[i];
                let y = b.ny;
                let alpha = 1;
                let size = b.size;
                if (b.born > 0) {
                  const age = (now - b.born) / 1000;
                  size *= Math.min(1, age / 0.7); // foam gathers, not appears
                }
                if (b.ascendAt > 0) {
                  const u = (now - b.ascendAt) / 2400;
                  if (u >= 1) {
                    bloomsRef.current.splice(i, 1);
                    continue;
                  }
                  const ease = u * u * (3 - 2 * u);
                  y = b.ny + (SHELL_Y - 0.03 - b.ny) * ease;
                  alpha = 1 - u * u;
                  size *= 1 - u * 0.5;
                }
                if (bloomCount < MAX_BLOOMS) {
                  bloomData[bloomCount * 4 + 0] = b.nx;
                  bloomData[bloomCount * 4 + 1] = y;
                  bloomData[bloomCount * 4 + 2] = size;
                  bloomData[bloomCount * 4 + 3] = alpha;
                  bloomCount++;
                }
              }

              // wakes → uniforms
              let wakeCount = 0;
              for (let i = wakes.length - 1; i >= 0; i--) {
                const wk = wakes[i];
                const age = (now - wk.born) / 1000;
                if (age > 2.2) {
                  wakes.splice(i, 1);
                  continue;
                }
                if (wakeCount < MAX_WAKES) {
                  wakeData[wakeCount * 4 + 0] = wk.x;
                  wakeData[wakeCount * 4 + 1] = wk.y;
                  wakeData[wakeCount * 4 + 2] = age;
                  wakeData[wakeCount * 4 + 3] = wk.strength;
                  wakeCount++;
                }
              }

              // dolphins → uniforms (leaps along the crossing diagonals)
              for (let i = 0; i < 3; i++) {
                const d = DOLPHIN_PARAMS[i];
                const cyc = (wT + d.offset) / d.period;
                const p = cyc - Math.floor(cyc);
                const liftAmt = reduced ? d.lift * 0.4 : d.lift;
                const posAt = (pp: number) => {
                  const px = d.x0 + (d.x1 - d.x0) * pp;
                  const py = d.yBase + d.slope * px - liftAmt * 4 * pp * (1 - pp) + 0.02;
                  return [px, py];
                };
                const [x, y] = posAt(p);
                const [x2, y2] = posAt(Math.min(1, p + 0.012));
                const angle = Math.atan2(y2 - y, (x2 - x) * 0.6);
                // present only mid-arc; slips away at the edges of its run
                const presence = Math.max(0, Math.min(0.75, Math.sin(p * Math.PI) * 1.4 - 0.25));
                // foam where the body breaks the water, going up or coming down
                if (
                  (presence > 0.35) !== (prevPresence[i] > 0.35) &&
                  x > 0.02 && x < 0.98
                ) {
                  pushWake(x, Math.min(SHORE - 0.03, y + 0.05), 0.8);
                }
                prevPresence[i] = presence;
                dolphinData[i * 4 + 0] = x;
                dolphinData[i * 4 + 1] = y;
                dolphinData[i * 4 + 2] = angle;
                dolphinData[i * 4 + 3] = presence;
              }

              gl.useProgram(prog);
              if (uTime) gl.uniform1f(uTime, wT);
              if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
              if (uWindU) gl.uniform1f(uWindU, wind + tiltX * 0.4);
              if (uTiltU) gl.uniform1f(uTiltU, tiltX);
              if (uAgitU) gl.uniform1f(uAgitU, agitation);
              if (uFlashU) gl.uniform1f(uFlashU, flash);
              if (uLensU) gl.uniform1f(uLensU, lens);
              if (uBloomsU) gl.uniform4fv(uBloomsU, bloomData);
              if (uBloomCountU) gl.uniform1i(uBloomCountU, bloomCount);
              if (uWakesU) gl.uniform4fv(uWakesU, wakeData);
              if (uWakeCountU) gl.uniform1i(uWakeCountU, wakeCount);
              if (uDolphinsU) gl.uniform4fv(uDolphinsU, dolphinData);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              raf = requestAnimationFrame(draw);
            };
            raf = requestAnimationFrame(draw);
          }
        }
      }
    }

    // ── the keyboard dialect ─────────────────────────────────────────
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const g = mulberry32(hashSeed(bloomsRef.current.length + 1))();
        plantBloom(0.25 + g * 0.5, HORIZON + 0.1 + g * 0.25);
        audio.spark();
      } else if (e.key === " ") {
        e.preventDefault();
        pushWake(SHELL_X, SHELL_Y + 0.08, 0.8);
        audio.playNote(noteAt(0.5), 200);
      } else if (e.key === "ArrowLeft") {
        wind = Math.max(-1.4, wind - 0.25);
      } else if (e.key === "ArrowRight") {
        wind = Math.min(1.4, wind + 0.25);
      } else if (e.key === "l" || e.key === "L") {
        lensTarget = lensTarget > 0.5 ? 0 : 1;
        haptics.lens();
        audio.playNote(lensTarget > 0.5 ? 85 : 81, 120);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      observer.disconnect();
      detachGestures();
      detachVessel();
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── the quiet clear — every kept bloom ascends and the sea forgets ──
  const letGo = () => {
    const now = performance.now();
    for (const b of bloomsRef.current) if (b.ascendAt === 0) b.ascendAt = now;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ blooms: [] }));
    } catch {
      /* noop */
    }
    setHasKept(false);
    getFieldAudio().thud();
    haptics.roll();
  };

  return (
    <div
      ref={wrapRef}
      className="aphros-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ position: "fixed", inset: 0, background: "#F4D5D0", overflow: "hidden" }}
    >
      <canvas
        ref={canvasRef}
        role="application"
        aria-label="a sea gathering foam into a shell of light — touch stirs it, holding gathers a bloom"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
          cursor: "crosshair",
        }}
      />
      {/* a single quiet word that surfaces, holds, then dissolves */}
      <div className="aphros-title" aria-hidden>
        <span>Aphros</span>
      </div>
      <LetGo label="let the foam go" onLetGo={letGo} visible={hasKept} />
      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* the painting owns the whole viewport: hide the field chrome so
           nothing utilitarian floats over the sea */
        body:has(.aphros-instrument) { overflow: hidden; }
        body:has(.aphros-instrument) .oda-field-watch,
        body:has(.aphros-instrument) .oda-candle-mark,
        body:has(.aphros-instrument) .oda-tape-shell,
        body:has(.aphros-instrument) .oda-sound-toggle {
          display: none !important;
        }
        .aphros-title {
          position: absolute;
          top: clamp(64px, 12vh, 120px);
          left: 0;
          right: 0;
          text-align: center;
          pointer-events: none;
          color: #6B4A3F;
          font-family: var(--font-serif);
          font-style: italic;
          font-weight: 500;
          font-size: clamp(30px, 5vw, 54px);
          letter-spacing: 0.03em;
          animation: aphros-title-fade 6.5s ease forwards;
        }
        @keyframes aphros-title-fade {
          0% { opacity: 0; }
          10%, 52% { opacity: 0.9; }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .aphros-title { animation: none; opacity: 0.85; }
        }
      `,
        }}
      />
    </div>
  );
}
