"use client";

// Beam — the eye of heaven.
//
// A field of comet-petals holds formation around a binary pair of soft
// suns, breathing and shimmering while the whole formation slowly turns.
// Rendered on the GPU: instanced teardrop marks with true depth-of-field
// (near petals sharp and white-hot, far petals swelling into bokeh), a
// bloom pipeline doing the heavy lifting, and a color weather that sweeps
// dawn blue → gold noon → amber rose → mauve dusk. A beam: light made
// visible, bent into a flower of comets.
//
// alive on its own   petals shimmer as a wind-wave orbits the rings, the
//                    suns waltz around their barycenter, focus breathes
// tap                refocus to that ring, and a ripple of light runs out
// long-press         the pupil dilates — the field deepens toward night
// slide / flick      a gust — petals lean away and spring back
// pinch              pull the two suns apart, or slam them into one
// two-finger twist   turn the whole formation
// two-finger drag    carry the system across the sky
// shake              a burst of light through every petal
// tilt               parallax — depth layers slide over each other
// flip the phone     day and night trade places

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import LetGo from "@/components/LetGo";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier } from "@/lib/gesture/core";
import { onVessel, requestVessel, vesselAvailable, vesselGranted } from "@/lib/vessel";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";

// the room remembers you — tempo, night, and how far apart you left the
// suns all survive a reload, the way stars keeps its constellations
const MEMORY_KEY = "objetdart:beam:memory";
type BeamMemory = { tempo?: number; night?: boolean; sep?: number };

function loadMemory(): BeamMemory {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    if (!raw) return {};
    const mem = JSON.parse(raw) as BeamMemory;
    return typeof mem === "object" && mem ? mem : {};
  } catch { return {}; }
}

function saveMemory(mem: BeamMemory): void {
  try { window.localStorage.setItem(MEMORY_KEY, JSON.stringify(mem)); } catch { /* noop */ }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// ── color weather ────────────────────────────────────────────────────────
// four moments of day, each: background core, background edge, warm streak,
// cool streak, tail ink. The cycle drifts through them; night is its own
// world reached by flipping the phone.
type Weather = { bg0: number[]; bg1: number[]; pal: number[][]; tail: number[] };
const W = (hex: string): number[] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
// four streak hues living side by side in every moment — gold against blue
// against violet against cream, the way the reference is never one color
// every anchor carries a hue — no near-whites in the palette, so even the
// brightest petal stays tinted the way the reference never bleaches out
const WEATHERS: Weather[] = [
  { bg0: W("#e4ecee"), bg1: W("#b7cad8"), pal: [W("#e2b45c"), W("#c8dcf0"), W("#7fa0cc"), W("#9a8cc4")], tail: W("#2c3a54") }, // dawn blue
  { bg0: W("#f2e9cc"), bg1: W("#d8c294"), pal: [W("#e0a850"), W("#ead290"), W("#a6c0dc"), W("#5c6a94")], tail: W("#4c3c22") }, // gold noon
  { bg0: W("#f0dcc2"), bg1: W("#d4ac84"), pal: [W("#cc8244"), W("#e8ba86"), W("#cc7a74"), W("#8c96cc")], tail: W("#54301e") }, // amber rose
  { bg0: W("#e0d0cc"), bg1: W("#a890a0"), pal: [W("#b08850"), W("#c0a0b8"), W("#5c6494"), W("#7c5480")], tail: W("#3a2a3e") }, // mauve dusk
];
const NIGHT: Weather = {
  bg0: W("#181c30"), bg1: W("#0c0e1c"), pal: [W("#e8d494"), W("#b8c4e4"), W("#96a6dc"), W("#8a7cc0")], tail: W("#0a0e1c"),
};

// ── shaders ──────────────────────────────────────────────────────────────
const PETAL_VERT = /* glsl */ `
attribute float aRing;    // orbit radius 0.14..1.18
attribute float aAng;     // base angle on its ring
attribute float aDepth;   // 0 near .. 1 far — drives focus and parallax
attribute float aPhase;   // per-petal random phase
attribute float aSeed;    // per-petal random 0..1
attribute float aSun;     // which sun this petal belongs to (0 or 1)

uniform float uTime;
uniform float uRot;
uniform float uChi;       // swirl of the dash orientation
uniform vec2  uSunA;
uniform vec2  uSunB;
uniform vec2  uPar;       // parallax lean from device tilt
uniform vec2  uGustDir;
uniform float uGustAmt;
uniform float uWaveAng;   // the orbiting shimmer-wind
uniform vec3  uRipple;    // x, y, age (seconds); age >= 90.0 means idle
uniform float uRippleAmp; // 1.0 for a tap, larger for the long-press exhale
uniform float uFlash;
uniform float uFocus;     // which depth is in focus 0..1
uniform float uPupil;     // long-press dilation 0..1

varying vec2 vUv;
varying float vBlur;
varying float vGlow;
varying float vColorMix;
varying float vSeed;

void main() {
  vUv = uv;
  vSeed = aSeed;

  vec2 sun = mix(uSunA, uSunB, aSun);
  float ang = aAng + uRot * (0.55 + 0.45 * (1.0 - aDepth));
  vec2 radial = vec2(cos(ang), sin(ang));

  float breathe = 1.0 + 0.045 * sin(uTime * 0.6 + aPhase * 6.2831);
  float ringR = aRing * breathe * (1.0 + uPupil * 0.22 * aRing);
  vec2 center = sun + radial * ringR;
  center += uPar * (aDepth - 0.5) * 0.16;

  // the orbiting wind-wave: a soft crest of light and lean moving round
  float dAng = mod(ang - uWaveAng + 3.14159, 6.2831) - 3.14159;
  float wave = exp(-dAng * dAng * 2.6);

  // gusts lean the petals away from the stroke, springy
  float lean = uGustAmt * (0.4 + 0.6 * sin(aPhase * 9.0 + uTime * 3.0));
  vec2 leanVec = uGustDir * lean * 0.13;
  center += leanVec * (0.4 + 0.6 * aDepth);

  // ripple of light running outward from a tap
  float glowR = 0.0;
  if (uRipple.z < 3.0) {
    float rr = distance(center, vec2(uRipple.x, uRipple.y));
    float front = uRipple.z * 0.9;
    glowR = exp(-pow((rr - front) * 7.0 / uRippleAmp, 2.0))
          * max(0.0, 1.0 - uRipple.z * 0.4) * uRippleAmp;
  }

  float twinkle = 0.5 + 0.5 * sin(uTime * (1.3 + aSeed * 2.2) + aPhase * 20.0);
  vGlow = 0.58 + 0.55 * wave + 0.9 * glowR + uFlash + 0.34 * twinkle;

  // out-of-focus petals swell and soften — bokeh
  vBlur = abs(aDepth - uFocus) * (0.75 + uPupil * 0.5);

  // dash orientation: radial, tipped by the swirl and the gust
  float oAng = ang + uChi + 0.22 * sin(uTime * 0.11 + aPhase * 4.0)
             + lean * 0.8 * (uGustDir.x * -radial.y + uGustDir.y * radial.x);

  float len = (0.042 + 0.096 * aRing) * (0.85 + 0.3 * aSeed) * (1.0 + vBlur * 1.5);
  float wid = len * (0.5 + vBlur * 0.3);
  vec2 local = (uv - 0.5) * vec2(len, wid) * 2.0;
  vec2 rot = vec2(
    local.x * cos(oAng) - local.y * sin(oAng),
    local.x * sin(oAng) + local.y * cos(oAng)
  );
  vec2 world = center + rot;

  // a color tide sweeps around the formation while every petal keeps its
  // own offset into the palette — clusters of gold beside runs of blue
  vColorMix = fract(0.3 * sin(ang + uTime * 0.045 + aSun * 2.4) + aSeed * 0.87 + uTime * 0.006);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 0.0, 1.0);
}
`;

const PETAL_FRAG = /* glsl */ `
precision highp float;

uniform vec3 uPal0;
uniform vec3 uPal1;
uniform vec3 uPal2;
uniform vec3 uPal3;
uniform vec3 uTail;
uniform float uNightMix;

varying vec2 vUv;
varying float vBlur;
varying float vGlow;
varying float vColorMix;
varying float vSeed;

void main() {
  vec2 p = vUv - 0.5;
  // comet spine runs from the tail tip at x=0.06 to the head center at
  // x=0.74; radius grows along it, so the tail is a point and the head is
  // a full round cap — a true teardrop, never a diamond
  float t = clamp((vUv.x - 0.1) / 0.6, 0.0, 1.0);
  vec2 spine = vec2(mix(0.1, 0.7, t), 0.5);
  float radius = mix(0.03, 0.18, t * t);
  float d = distance(vUv, spine) - radius;
  float soft = 0.05 + vBlur * 0.24;
  float body = smoothstep(soft, -soft, d);
  // never let the soft edge reach the quad border — no rectangular ghosts
  body *= smoothstep(0.0, 0.09, vUv.x) * smoothstep(1.0, 0.91, vUv.x)
        * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
  if (body < 0.004) discard;

  // each petal draws its own hue from the four-color weather — the field
  // is polychromatic in every moment, never just warm against cool
  float h = fract(vColorMix) * 3.0;
  vec3 streak = h < 1.0 ? mix(uPal0, uPal1, h)
              : h < 2.0 ? mix(uPal1, uPal2, h - 1.0)
              : mix(uPal2, uPal3, h - 2.0);
  // ink only at the very tail tip, streak color through the body, hot head.
  // brightness is always the streak's own hue lifted, never absolute white —
  // in the reference even the hottest light stays tinted
  float headness = smoothstep(0.5, 0.93, t);
  vec3 col = mix(mix(uTail, streak, 0.25), streak, smoothstep(0.0, 0.38, t));
  vec3 hot = 1.0 - (1.0 - streak) * 0.35;
  col = mix(col, hot, headness * 0.9);
  // the very core of the head burns in its own color
  float core = smoothstep(0.6, 0.97, t) * smoothstep(radius * 0.7, 0.0, distance(vUv, spine));
  col += (1.0 - (1.0 - streak) * 0.2) * core * 0.55;

  col *= min(vGlow, 1.35);
  // defocus softens edges but must not bleach hue — bokeh keeps its color,
  // so blurred marks lean *more* saturated as their alpha drops
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, 1.0 + vBlur * 0.55);
  float alpha = body * clamp(0.9 - vBlur * 0.42, 0.3, 0.9);
  // at night the tails nearly vanish and the heads become stars
  alpha *= mix(1.0, 0.22 + 0.78 * headness, uNightMix);

  gl_FragColor = vec4(col * alpha, alpha);
}
`;

const BG_VERT = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BG_FRAG = /* glsl */ `
precision highp float;

uniform vec3 uBg0;
uniform vec3 uBg1;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform vec2 uSunA;
uniform vec2 uSunB;
uniform float uAspect;
uniform float uTime;
uniform float uPupil;
uniform float uNightMix;
uniform float uFlash;
uniform vec2 uMeteorA;    // where the loose petal broke free
uniform vec2 uMeteorD;    // its direction, unit length
uniform float uMeteorAge; // seconds since; large means no meteor right now

varying vec2 vPos;

void main() {
  vec2 p = vec2(vPos.x * uAspect, vPos.y);
  float r = length(p);

  vec3 col = mix(uBg0, uBg1, smoothstep(0.05, 1.15, r));

  // each sun stains the sky around it with its own warmth
  float da = distance(p, uSunA);
  float db = distance(p, uSunB);
  col = mix(col, mix(uBg0, uWarm, 0.5), exp(-da * da * 2.2) * 0.55);
  col = mix(col, mix(uBg0, uCool, 0.4), exp(-db * db * 2.2) * 0.45);
  // and a soft brilliance at each core
  col += vec3(1.0, 0.98, 0.92) * exp(-da * da * 9.0) * (0.2 - uNightMix * 0.08);
  col += vec3(0.96, 0.97, 1.0) * exp(-db * db * 9.0) * (0.16 - uNightMix * 0.06);

  // the pupil: long-press dilates a deep center
  float pupilR = uPupil * 0.5;
  float pupil = smoothstep(pupilR + 0.25, pupilR - 0.1, min(da, db));
  col = mix(col, col * (1.0 - 0.75 * uPupil), pupil);

  col += vec3(1.0, 0.97, 0.9) * uFlash * 0.5;

  // every so often a petal breaks formation and streaks across the sky —
  // the room surprises you if you stay, the way the night sky does
  if (uMeteorAge < 2.6) {
    vec2 head = uMeteorA + uMeteorD * uMeteorAge * 0.85;
    vec2 toP = p - head;
    float along = dot(toP, -uMeteorD);
    float perp = abs(dot(toP, vec2(-uMeteorD.y, uMeteorD.x)));
    float streak = exp(-perp * perp * 1400.0) * smoothstep(0.55, 0.0, along) * step(0.0, along);
    float headGlow = exp(-dot(toP, toP) * 500.0);
    float fade = smoothstep(0.0, 0.25, uMeteorAge) * smoothstep(2.6, 2.0, uMeteorAge);
    col += vec3(1.0, 0.96, 0.86) * (streak * 0.45 + headGlow * 0.85) * fade;
  }

  // grain keeps the gradients organic
  float g = fract(sin(dot(gl_FragCoord.xy + uTime * 60.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.018;

  gl_FragColor = vec4(col, 1.0);
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BRIGHT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform float uThresh;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tSrc, vUv);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float k = smoothstep(uThresh, uThresh + 0.22, l);
  gl_FragColor = vec4(c.rgb * k, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 acc = texture2D(tSrc, vUv).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153;
  vec2 o2 = uDir * 3.2307692;
  acc += texture2D(tSrc, vUv + o1).rgb * 0.3162162;
  acc += texture2D(tSrc, vUv - o1).rgb * 0.3162162;
  acc += texture2D(tSrc, vUv + o2).rgb * 0.0702702;
  acc += texture2D(tSrc, vUv - o2).rgb * 0.0702702;
  gl_FragColor = vec4(acc, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloomAmt;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(tScene, vUv).rgb;
  vec3 bloom = texture2D(tBloom, vUv).rgb * uBloomAmt;
  // screen blend keeps the light additive but never clips to flat white
  vec3 col = 1.0 - (1.0 - base) * (1.0 - min(bloom, vec3(1.0)));
  // vibrance: give back the chroma the screen blend steals, so bright
  // stays tinted instead of bleaching
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = clamp(mix(vec3(l), col, 1.22), 0.0, 1.0);
  // gentle vignette
  vec2 d = vUv - 0.5;
  col *= 1.0 - dot(d, d) * 0.35;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── tiny synth on the shared audio context ───────────────────────────────
type BeamAudio = {
  kick: () => void;
  chime: (bright: number) => void;
  whoosh: (strength: number) => void;
  bell: () => void;
  nightfall: (toNight: boolean) => void;
  exhale: () => void;
  dispose: () => void;
};

function createBeamAudio(): BeamAudio {
  const fa = getFieldAudio();
  let ctx: AudioContext | null = null;
  let bus: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let lastWhoosh = 0;

  const ensure = (): boolean => {
    if (ctx && bus) return true;
    try { void fa.start(); } catch { /* noop */ }
    const c = fa.getAudioContext();
    if (!c) return false;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    ctx = c;
    bus = c.createGain();
    bus.gain.value = 0.8;
    bus.connect(c.destination);
    return true;
  };

  const tone = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, lp?: number) => {
    if (!ctx || !bus || fa.isMuted()) return;
    const c = ctx;
    const now = c.currentTime;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, f0), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    let tail: AudioNode = g;
    if (lp) {
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lp;
      g.connect(f);
      tail = f;
    }
    osc.connect(g);
    tail.connect(bus);
    osc.start(now);
    osc.stop(now + dur + 0.05);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch { /* noop */ } };
  };

  const hiss = (dur: number, peak: number, bp: number, q: number) => {
    if (!ctx || !bus || fa.isMuted()) return;
    const c = ctx;
    if (!noiseBuf) {
      const len = Math.floor(c.sampleRate * 0.9);
      noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const now = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = bp;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f).connect(g).connect(bus);
    try { src.start(now); src.stop(now + dur + 0.05); } catch { /* noop */ }
  };

  return {
    kick() { ensure(); },
    chime(bright) {
      if (!ensure()) return;
      const b = clamp(bright, 0, 1);
      tone("sine", mix(740, 1180, b), mix(1180, 1760, b), 0.5, 0.06);
      tone("sine", mix(1480, 2360, b), mix(2220, 3520, b), 0.3, 0.02);
    },
    whoosh(strength) {
      if (!ensure() || !ctx) return;
      const now = ctx.currentTime;
      if (now - lastWhoosh < 0.12) return;
      lastWhoosh = now;
      const s = clamp(strength, 0, 1);
      hiss(mix(0.15, 0.4, s), mix(0.015, 0.06, s), mix(500, 1200, s), 0.9);
    },
    bell() {
      if (!ensure()) return;
      tone("sine", 392, 390, 1.4, 0.09);
      tone("sine", 588, 584, 1.1, 0.05);
      tone("sine", 784, 778, 0.8, 0.03);
      hiss(0.5, 0.04, 1600, 1.2);
    },
    nightfall(toNight) {
      if (!ensure()) return;
      if (toNight) {
        tone("sine", 330, 110, 1.6, 0.07, 700);
        tone("sine", 220, 82, 2.0, 0.05, 400);
      } else {
        tone("sine", 165, 440, 1.2, 0.06);
        tone("sine", 330, 660, 0.9, 0.03);
      }
    },
    exhale() {
      if (!ensure()) return;
      tone("sine", 250, 92, 1.1, 0.07, 600);
      hiss(0.9, 0.03, 420, 0.7);
    },
    dispose() {
      try { bus?.disconnect(); } catch { /* noop */ }
      bus = null;
      ctx = null;
    },
  };
}

export default function Beam() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [fallback, setFallback] = useState(false);
  const [motionUI, setMotionUI] = useState<"hidden" | "prompt" | "on">("hidden");
  const audioRef = useRef<BeamAudio | null>(null);
  const tiltRef = useRef({ tx: 0, ty: 0 });
  const shakeRef = useRef({ pending: 0 });
  const knockRef = useRef({ pending: 0 });
  const reduceRef = useRef(false);

  const [memory] = useState<BeamMemory>(loadMemory);
  const [tempo, setTempo] = useState(memory.tempo ?? 1);
  const [isNight, setIsNight] = useState(!!memory.night);
  const tempoRef = useRef(memory.tempo ?? 1);
  const nightWantRef = useRef(!!memory.night);
  const memRef = useRef<BeamMemory>({ ...memory });
  const [hasKept, setHasKept] = useState(
    memory.tempo !== undefined || memory.night !== undefined || memory.sep !== undefined,
  );
  const clearBeamRef = useRef<() => void>(() => {});
  // Shared idle-persistence bus. Coalesces the several places that used to
  // call `saveMemory` synchronously (tempo, night, sep, orientation-flip,
  // letGo) so a rapid state change during a gesture writes localStorage
  // once at idle instead of on every event. Same on-disk shape at
  // objetdart:beam:memory.
  const persistRef = useRef<ReturnType<typeof createIdleWriter> | null>(null);
  if (persistRef.current === null && typeof window !== "undefined") {
    persistRef.current = createIdleWriter(() => saveMemory(memRef.current));
  }
  const schedulePersist = useCallback(() => {
    persistRef.current?.schedule();
  }, []);

  const onTempo = useCallback((value: number) => {
    const v = clamp(value, 0.25, 2.5);
    setTempo(v);
    tempoRef.current = v;
    memRef.current.tempo = v;
    schedulePersist();
    setHasKept(true);
  }, [schedulePersist]);

  const onNightToggle = useCallback(() => {
    nightWantRef.current = !nightWantRef.current;
    setIsNight(nightWantRef.current);
    memRef.current.night = nightWantRef.current;
    schedulePersist();
    setHasKept(true);
  }, [schedulePersist]);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = createBeamAudio();
    audioRef.current.kick();
  }, []);

  // ── the vessel (shared bus, @/lib/vessel): tilt is parallax, shake is a
  // burst of light, a knock rings one chime, and face-down is night — the
  // room's own portrait/landscape swap (in the resize handler below) is a
  // second, private discovery of day-for-night, not this binding.
  const armSensors = useCallback(() => {
    void requestVessel().then((ok) => {
      if (ok) setMotionUI("on");
    });
  }, []);

  useEffect(() => {
    if (!vesselAvailable()) { setMotionUI("hidden"); return; }
    if (vesselGranted()) { setMotionUI("on"); return; }
    void requestVessel().then((ok) => setMotionUI(ok ? "on" : "prompt"));
  }, []);

  useEffect(() => {
    const detach = onVessel({
      tilt: ({ beta, gamma }) => {
        tiltRef.current.tx = clamp(gamma / 40, -1, 1);
        tiltRef.current.ty = clamp(beta / 40, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduceRef.current) return;
        shakeRef.current.pending = clamp(intensity, 0.4, 1);
      },
      knock: ({ intensity }) => {
        knockRef.current.pending = clamp(0.5 + intensity * 0.4, 0.5, 1);
      },
      flip: ({ faceDown }) => {
        if (!faceDown) return;
        nightWantRef.current = true;
        setIsNight(true);
        memRef.current.night = true;
        schedulePersist();
        setHasKept(true);
      },
    });
    return detach;
  }, [schedulePersist]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceRef.current = reduceQuery.matches;
    const onReduce = () => { reduceRef.current = reduceQuery.matches; };
    reduceQuery.addEventListener?.("change", onReduce);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch {
      setFallback(true);
      return;
    }
    // ── the shared performance contract ─────────────────────────────────
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let hiddenDoc = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    const syncSleep = () => {
      asleep = hiddenDoc || galleryPaused;
      if (asleep) gov.force("sleep");
    };
    const unvis = onVisibility((h) => {
      hiddenDoc = h;
      syncSleep();
    });
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    renderer.setPixelRatio(resolveDpr(gov.tier(), { embedded, reducedMotion: reduceRef.current }));
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;cursor:crosshair";
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute(
      "aria-label",
      "A luminous bloom of comet-shaped petals arranged in rings around two soft suns, breathing in and out of focus. Tap to refocus and send a ripple of light; press and hold to dilate the pupil toward night, and past a ceremony a meteor is called down; slide or flick to gust wind through the petals; pinch to pull the two suns apart or merge them; twist two fingers to turn the whole formation, three fingers to turn its season; two-finger drag carries the system, three-finger drag is wind, three-finger hold slows time; shake for a burst of light; tilt for parallax; and turn the phone face-down to trade day for night.",
    );
    host.appendChild(renderer.domElement);

    // WebGL context loss (mobile GPU pressure, background tabs): stop
    // touching the lost context and let the browser restore it. A full
    // scene reinit on restore is out of scope — see the sweep report.
    let contextLost = false;
    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      contextLost = true;
    };
    const onContextRestored = () => {
      contextLost = false;
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost, false);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored, false);

    // ── scene ────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    let aspect = 1;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

    const uniforms = {
      uTime: { value: 0 },
      uRot: { value: 0 },
      uChi: { value: 0.35 },
      uSunA: { value: new THREE.Vector2(-0.3, 0.04) },
      uSunB: { value: new THREE.Vector2(0.34, -0.06) },
      uPar: { value: new THREE.Vector2(0, 0) },
      uGustDir: { value: new THREE.Vector2(1, 0) },
      uGustAmt: { value: 0 },
      uWaveAng: { value: 0 },
      uRipple: { value: new THREE.Vector3(0, 0, 99) },
      uRippleAmp: { value: 1 },
      uFlash: { value: 0 },
      uFocus: { value: 0.35 },
      uPupil: { value: 0 },
      uNightMix: { value: 0 },
      uWarm: { value: new THREE.Vector3() },
      uCool: { value: new THREE.Vector3() },
      uPal0: { value: new THREE.Vector3() },
      uPal1: { value: new THREE.Vector3() },
      uPal2: { value: new THREE.Vector3() },
      uPal3: { value: new THREE.Vector3() },
      uTail: { value: new THREE.Vector3() },
      uBg0: { value: new THREE.Vector3() },
      uBg1: { value: new THREE.Vector3() },
      uAspect: { value: 1 },
      uBloomAmt: { value: 1.15 },
      uMeteorA: { value: new THREE.Vector2(0, 0) },
      uMeteorD: { value: new THREE.Vector2(1, 0) },
      uMeteorAge: { value: 99 },
    };

    // background sky
    const bgGeo = new THREE.BufferGeometry();
    bgGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const bgMat = new THREE.ShaderMaterial({
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);
    bgMesh.frustumCulled = false;
    bgMesh.renderOrder = 0;
    scene.add(bgMesh);

    // petals — allocated at the full count; the quality tier scales how
    // many of them are actually drawn each frame (geo.instanceCount),
    // never how many exist, so a phone loses petals rather than time.
    const COUNT = reduceRef.current ? 260 : 470;
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute("position", plane.getAttribute("position"));
    geo.setAttribute("uv", plane.getAttribute("uv"));
    geo.instanceCount = COUNT;
    let lastInstanceSync = 0;

    const aRing = new Float32Array(COUNT);
    const aAng = new Float32Array(COUNT);
    const aDepth = new Float32Array(COUNT);
    const aPhase = new Float32Array(COUNT);
    const aSeed = new Float32Array(COUNT);
    const aSun = new Float32Array(COUNT);
    // petals arranged in loose rings, like the video: a few seeds per ring
    // step, jittered so the formation is organic rather than mechanical
    for (let i = 0; i < COUNT; i++) {
      const ring = 0.14 + Math.pow(Math.random(), 0.72) * 1.05;
      aRing[i] = ring;
      aAng[i] = Math.random() * Math.PI * 2;
      aDepth[i] = clamp(ring / 1.2 + (Math.random() - 0.5) * 0.3, 0, 1);
      aPhase[i] = Math.random();
      aSeed[i] = Math.random();
      aSun[i] = Math.random() < 0.55 ? 0 : 1;
    }
    geo.setAttribute("aRing", new THREE.InstancedBufferAttribute(aRing, 1));
    geo.setAttribute("aAng", new THREE.InstancedBufferAttribute(aAng, 1));
    geo.setAttribute("aDepth", new THREE.InstancedBufferAttribute(aDepth, 1));
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(aPhase, 1));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(aSeed, 1));
    geo.setAttribute("aSun", new THREE.InstancedBufferAttribute(aSun, 1));

    const petalMat = new THREE.ShaderMaterial({
      vertexShader: PETAL_VERT,
      fragmentShader: PETAL_FRAG,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
    });
    const petals = new THREE.Mesh(geo, petalMat);
    petals.frustumCulled = false;
    petals.renderOrder = 1;
    scene.add(petals);

    // ── post: brightpass → blur → composite ──────────────────────────────
    const postScene = new THREE.Scene();
    const postGeo = new THREE.BufferGeometry();
    postGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    postGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    const postMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BRIGHT_FRAG,
      uniforms: { tSrc: { value: null }, uThresh: { value: 0.8 } },
      depthTest: false,
      depthWrite: false,
    });
    const blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    const compMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: { tScene: { value: null }, tBloom: { value: null }, uBloomAmt: uniforms.uBloomAmt },
      depthTest: false,
      depthWrite: false,
    });
    const postMesh = new THREE.Mesh(postGeo, postMat);
    postMesh.frustumCulled = false;
    postScene.add(postMesh);
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

    let rtScene: THREE.WebGLRenderTarget | null = null;
    let rtA: THREE.WebGLRenderTarget | null = null;
    let rtB: THREE.WebGLRenderTarget | null = null;

    const makeTargets = (w: number, h: number) => {
      rtScene?.dispose(); rtA?.dispose(); rtB?.dispose();
      rtScene = new THREE.WebGLRenderTarget(w, h);
      rtA = new THREE.WebGLRenderTarget(w >> 1, h >> 1);
      rtB = new THREE.WebGLRenderTarget(w >> 1, h >> 1);
    };

    // ── interaction state ────────────────────────────────────────────────
    let simT = 0;
    let rotSpeed = 0.14;
    let rotExtra = 0;
    let focusTarget = 0.35;
    let focusBreathing = true;
    const sep0 = clamp(memRef.current.sep ?? 0.66, 0.04, 0.9);
    let sep = sep0, sepTarget = sep0;
    let meteorNext = 12 + Math.random() * 18;
    let bary = new THREE.Vector2(0, 0);
    const baryTarget = new THREE.Vector2(0, 0);
    let orbAng = 0;
    let gustAmt = 0;
    let pupilTarget = 0;
    let night = nightWantRef.current;
    let nightMix = night ? 1 : 0;
    let flash = 0;
    let merged = false;

    // LetGo — the quiet clear: the room's kept character (tempo, night,
    // how far apart you left the suns) returns to its resting defaults.
    clearBeamRef.current = () => {
      sepTarget = 0.66;
      onTempo(1);
      if (nightWantRef.current) onNightToggle();
      memRef.current = {};
      // letGo is a solemn act — flush the writer so the empty memory
      // hits the disk before the exhale finishes, rather than waiting
      // for the next idle window.
      persistRef.current?.schedule();
      persistRef.current?.flush();
      setHasKept(false);
    };
    let landscape: boolean | null = null;

    const toWorld = (cx: number, cy: number): [number, number] => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((cx - rect.left) / rect.width * 2 - 1) * aspect;
      const y = -((cy - rect.top) / rect.height * 2 - 1);
      return [x, y];
    };

    // ── gestures (the shared grammar — src/lib/gesture) ─────────────────
    // One finger touches the light: tap refocuses and sends a ripple, drag
    // or a flick gusts the petals, dwell dilates the pupil (deepens the
    // longer it holds) and ceremony calls a meteor down in a deep exhale.
    // Two fingers touch the map: pinch pulls the suns apart or together,
    // twist turns the formation, pan carries the whole system across the
    // sky. Three fingers touch the law: drag is wind, hold dilates time,
    // twist turns the season, tap is tutti. Beam owns pinch/pan2/twist
    // itself — ScaleTravel is not mounted here (AxisChrome travel={false}).
    let holdTicked = false;
    let ceremonyFired = false;
    let timeScaleTarget = 1;
    let timeScale = 1;
    let weatherOffset = 0;
    // train tiers: the shimmer-wind sprint and the quickened waltz, decaying
    let waveBurst = 0;
    let waltzBurst = 0;

    // double tap: a petal cascade — a ripple runs outward, ring by ring, as
    // if every ring let go and streamed after the one before it. Stages are
    // fixed and evenly spaced in time — not Math.random — so the same tap
    // always plays the same cascade.
    let cascadeTimers: number[] = [];
    const CASCADE_STAGES = 5;
    const petalCascade = (wx: number, wy: number, intensity: number) => {
      for (const t of cascadeTimers) window.clearTimeout(t);
      cascadeTimers = [];
      for (let i = 0; i < CASCADE_STAGES; i++) {
        const id = window.setTimeout(() => {
          const r = i / (CASCADE_STAGES - 1);
          uniforms.uRipple.value.set(wx * (0.3 + r * 0.9), wy * (0.3 + r * 0.9), 0);
          uniforms.uRippleAmp.value = 0.6 + intensity * 0.5 + r * 0.5;
          waveBurst = Math.max(waveBurst, 1 - r * 0.3);
          flash = Math.max(flash, 0.2 + intensity * 0.2);
          try { audioRef.current?.chime(0.5 + r * 0.4); } catch { /* noop */ }
          try { haptics.ripple(0.25 + r * 0.2); } catch { /* noop */ }
        }, i * 140);
        cascadeTimers.push(id);
      }
      try { audioRef.current?.whoosh(0.8); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
    };

    // triple tap: the room's largest, rarest event — a shower, not one
    // meteor. The single meteor slot the room already animates is reused in
    // a fixed, deterministic rapid sequence rather than an array of streaks,
    // so every meteor still gets the room's real ballistic shader path.
    let showerTimers: number[] = [];
    const METEOR_SHOWER_COUNT = 6;
    const meteorShower = (intensity: number) => {
      for (const t of showerTimers) window.clearTimeout(t);
      showerTimers = [];
      for (let i = 0; i < METEOR_SHOWER_COUNT; i++) {
        const id = window.setTimeout(() => {
          const ang = (i / METEOR_SHOWER_COUNT) * Math.PI * 2 + i * 0.73;
          const wx2 = Math.cos(ang) * 0.9;
          const wy2 = Math.sin(ang) * 0.9;
          const dir = new THREE.Vector2(-wx2, -wy2);
          if (dir.lengthSq() < 1e-6) dir.set(1, 0); else dir.normalize();
          uniforms.uMeteorA.value.set(wx2, wy2);
          uniforms.uMeteorD.value.copy(dir);
          uniforms.uMeteorAge.value = 0;
          flash = Math.max(flash, 0.5 + intensity * 0.3);
          try { audioRef.current?.bell(); } catch { /* noop */ }
          try { haptics.ripple(0.3 + intensity * 0.3); } catch { /* noop */ }
        }, i * 260);
        showerTimers.push(id);
      }
      try { haptics.storm(); } catch { /* noop */ }
    };

    const detachGestures = attachGestures(renderer.domElement, {
      tap: (e) => {
        ensureAudio();
        if (e.fingers === 2) {
          // step back: a focus pinned by a tap breathes free again
          focusBreathing = true;
          try { haptics.tap(); } catch { /* noop */ }
          return;
        }
        if (e.fingers === 3) {
          // tutti — the formation answers softly at once, as bright as the strike
          uniforms.uRipple.value.set(uniforms.uSunA.value.x, uniforms.uSunA.value.y, 0);
          uniforms.uRippleAmp.value = 1.1 + e.intensity * 0.6;
          flash = Math.max(flash, 0.25 + e.intensity * 0.3);
          try { audioRef.current?.chime(0.3 + e.intensity * 0.4); } catch { /* noop */ }
          try { haptics.ripple(0.3 + e.intensity * 0.3); } catch { /* noop */ }
          return;
        }
        // tap: refocus to that ring and send light running outward — the
        // ripple as wide as the strike was hard
        const [wx, wy] = toWorld(e.x, e.y);
        const da = Math.hypot(wx - uniforms.uSunA.value.x, wy - uniforms.uSunA.value.y);
        const db = Math.hypot(wx - uniforms.uSunB.value.x, wy - uniforms.uSunB.value.y);
        focusTarget = clamp(Math.min(da, db) / 1.2, 0, 1);
        focusBreathing = false;
        uniforms.uRipple.value.set(wx, wy, 0);
        uniforms.uRippleAmp.value = 0.75 + e.intensity * 0.5;
        try { audioRef.current?.chime(1 - focusTarget); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        // a true double tap: the petal cascade, every ring letting go in turn
        if (e.count === 2) {
          petalCascade(wx, wy, e.intensity);
          return;
        }
        // the train tiers (1 / 3 / 5 / n from gesture/core): rapid taps climb
        // the formation's own ladder — the shower, the waltz, the blaze
        const trainTier = tapTrainTier(e.count);
        if (trainTier === 3 && e.count === 3) {
          // three taps: the room's biggest, rarest event — a shower of
          // meteors rather than the ceremony's single one
          meteorShower(e.intensity);
          flash = Math.max(flash, 0.25);
          try { audioRef.current?.whoosh(0.9); } catch { /* noop */ }
          try { haptics.ripple(0.5); } catch { /* noop */ }
        } else if (trainTier === 5 && e.count === 5) {
          // five taps quicken the waltz — the two suns swing hard around
          // their barycenter, petals streaming to keep formation
          waltzBurst = 1;
          flash = Math.max(flash, 0.4);
          try { audioRef.current?.bell(); } catch { /* noop */ }
          try { haptics.bloom(); } catch { /* noop */ }
        } else if (trainTier === "n") {
          // seven and beyond: the crescendo — every further strike brightens
          // the bloom and spins the whole formation faster
          flash = Math.max(flash, clamp(0.3 + (e.count - 6) * 0.1, 0.3, 1));
          rotSpeed = clamp(rotSpeed + 0.06, 0.14, 0.8);
          try { audioRef.current?.chime(clamp(0.4 + (e.count - 7) * 0.09, 0.4, 1)); } catch { /* noop */ }
          try { (e.count === 7 ? haptics.storm : () => haptics.ripple(0.55))(); } catch { /* noop */ }
        }
      },
      drag: (e) => {
        ensureAudio();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          // three fingers drag the weather: wind through the petals, and
          // the season's phase leans with the push
          const dist = Math.hypot(e.dx, e.dy);
          if (dist > 0.5) {
            uniforms.uGustDir.value.set(e.dx / dist, -e.dy / dist);
            gustAmt = clamp(gustAmt + dist * 0.01, 0, 2);
          }
          weatherOffset += e.dx * 0.0006;
          return;
        }
        if (e.fingers !== 1 || e.phase === "end") return;
        const dist = Math.hypot(e.dx, e.dy);
        if (dist > 1) {
          uniforms.uGustDir.value.set(e.dx / dist, -e.dy / dist);
          gustAmt = clamp(gustAmt + dist * 0.02, 0, 1.4);
          try { audioRef.current?.whoosh(clamp(dist * 0.05, 0, 1)); } catch { /* noop */ }
        }
      },
      flick: (e) => {
        if (e.fingers !== 1) return;
        gustAmt = clamp(gustAmt + Math.min(2, e.speed * 0.8), 0, 2);
        try { audioRef.current?.whoosh(1); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
      },
      scrub: (e) => {
        ensureAudio();
        // a circling finger stirs the whole formation after the hand — the
        // rings turn with the winding, faster the faster you circle
        const spin = clamp(Math.abs(e.angularVelocity) * 60, 0.2, 1.4);
        rotExtra -= e.winding * 0.35;
        rotSpeed = clamp(0.14 + spin * 0.3, 0.14, 0.7);
        const [wx, wy] = toWorld(e.cx, e.cy);
        uniforms.uRipple.value.set(wx, wy, 0);
        uniforms.uRippleAmp.value = 0.9 + Math.min(1, Math.abs(e.winding)) * 0.6;
        try { audioRef.current?.whoosh(clamp(spin, 0.3, 1)); } catch { /* noop */ }
        try { haptics.ripple(0.35); } catch { /* noop */ }
      },
      rhythm: (e) => {
        // a steady tapped pulse: the room's whole clock — rotation, wave,
        // waltz, weather — entrains to the hand's tempo and keeps it
        if (e.stability <= 0.7 || e.bpm < 40 || e.bpm > 200) return;
        ensureAudio();
        onTempo(clamp(e.bpm / 76, 0.25, 2.5));
        flash = Math.max(flash, 0.3);
        try { audioRef.current?.chime(0.7); } catch { /* noop */ }
        try { haptics.lens(); } catch { /* noop */ }
      },
      hold: (e) => {
        ensureAudio();
        if (e.fingers === 3) {
          // three fingers hold the law: time dilates to a quarter speed
          if (e.phase === "enter") {
            timeScaleTarget = 0.25;
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter") {
          holdTicked = false;
          ceremonyFired = false;
          return;
        }
        if (e.phase === "release") {
          if (pupilTarget > 0) {
            // releasing the dwell is its own gesture: the deep exhale — a
            // wave of light as wide and slow as the hold was long
            pupilTarget = 0;
            const [wx, wy] = toWorld(e.x, e.y);
            uniforms.uRipple.value.set(wx, wy, 0);
            uniforms.uRippleAmp.value = 1.4 + clamp(e.elapsed / 2500, 0, 1) * 1.2;
            try { audioRef.current?.exhale(); } catch { /* noop */ }
            try { haptics.ripple(0.3 + clamp(e.elapsed / 2500, 0, 1) * 0.4); } catch { /* noop */ }
          }
          return;
        }
        // dwell tier: the pupil dilates, and keeps dilating for as long as
        // the hold lasts — 900ms is a squint, 2400ms is nearly night
        if (e.tier >= 1) {
          if (!holdTicked) { holdTicked = true; try { haptics.ripple(0.4); } catch { /* noop */ } }
          pupilTarget = clamp(e.elapsed / 2500, 0.35, 1);
        }
        // ceremony — the room's one solemn act: a meteor is called down
        // (if none is already in flight) with a grand exhale of light
        if (e.tier >= 3 && !ceremonyFired) {
          ceremonyFired = true;
          const [wx, wy] = toWorld(e.x, e.y);
          if (uniforms.uMeteorAge.value >= 90) {
            const dir = new THREE.Vector2(-wx, -wy);
            if (dir.lengthSq() < 1e-6) dir.set(1, 0); else dir.normalize();
            uniforms.uMeteorA.value.set(wx, wy);
            uniforms.uMeteorD.value.copy(dir);
            uniforms.uMeteorAge.value = 0;
          }
          uniforms.uRipple.value.set(wx, wy, 0);
          uniforms.uRippleAmp.value = 2.6;
          flash = Math.max(flash, 0.7);
          try { audioRef.current?.bell(); } catch { /* noop */ }
          try { haptics.bloom(); } catch { /* noop */ }
        }
      },
      pinch: (e) => {
        ensureAudio();
        if (e.phase === "end") {
          memRef.current.sep = sepTarget;
          schedulePersist();
          setHasKept(true);
          return;
        }
        if (e.phase !== "move") return;
        // spreading fingers pulls the suns apart; closing merges them
        sepTarget = clamp(sepTarget * e.scale, 0.04, 0.9);
      },
      twist: (e) => {
        ensureAudio();
        if (e.fingers === 3) {
          // three-finger twist: advance/rewind the formation's season
          if (e.phase === "move") weatherOffset += e.angle * 0.5;
          return;
        }
        // two-finger twist turns the whole formation
        if (e.phase === "move") rotExtra -= e.angle;
      },
      pan2: (e) => {
        ensureAudio();
        // two fingers carry the system across the sky
        const rect = renderer.domElement.getBoundingClientRect();
        baryTarget.x = clamp(baryTarget.x + (e.dx / rect.width) * 2 * aspect, -0.6, 0.6);
        baryTarget.y = clamp(baryTarget.y - (e.dy / rect.height) * 2, -0.6, 0.6);
      },
    }, { wheelZoom: true });

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      renderer.setSize(w, h, false);
      aspect = w / h;
      camera.left = -aspect; camera.right = aspect;
      camera.top = 1; camera.bottom = -1;
      camera.updateProjectionMatrix();
      uniforms.uAspect.value = aspect;
      const dpr = renderer.getPixelRatio();
      makeTargets(Math.round(w * dpr), Math.round(h * dpr));
      const nowLandscape = w > h;
      if (landscape !== null && nowLandscape !== landscape && !reduceRef.current) {
        nightWantRef.current = !nightWantRef.current;
        setIsNight(nightWantRef.current);
        memRef.current.night = nightWantRef.current;
        schedulePersist();
        setHasKept(true);
      }
      landscape = nowLandscape;
    };
    resize();
    window.addEventListener("resize", resize);

    // ── weather blending ─────────────────────────────────────────────────
    const setV3 = (u: { value: THREE.Vector3 }, day: number[], nt: number[], m: number) => {
      u.value.set(mix(day[0], nt[0], m), mix(day[1], nt[1], m), mix(day[2], nt[2], m));
    };
    const blend3 = (a: number[], b: number[], t: number): number[] => [
      mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t),
    ];

    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const tier = gov.beginFrame(now);
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      if (asleep || contextLost || !rtScene || !rtA || !rtB) return;
      const reduced = reduceRef.current;
      // the quality tier thins the petals actually drawn, never simulated
      if (now - lastInstanceSync > 600) {
        lastInstanceSync = now;
        geo.instanceCount = Math.max(80, Math.round(COUNT * detailForTier(tier).particles));
      }
      // three-finger hold dilates time; a knock rings one chime
      timeScale = mix(timeScale, timeScaleTarget, 1 - Math.exp(-dt * 5));
      if (knockRef.current.pending > 0) {
        const kAmt = knockRef.current.pending;
        knockRef.current.pending = 0;
        uniforms.uRipple.value.set(uniforms.uSunA.value.x, uniforms.uSunA.value.y, 0);
        uniforms.uRippleAmp.value = 1.2 + kAmt * 0.6;
        flash = Math.max(flash, 0.3 + kAmt * 0.2);
        try { audioRef.current?.chime(kAmt); } catch { /* noop */ }
      }
      // the tempo dial scales the whole clock — rotation, wave, weather,
      // twinkle, the waltz of the suns, even how often meteors come
      const speed = (reduced ? 0.35 : 1) * tempoRef.current * timeScale;
      simT += dt * speed;

      // day and night follow the want set by the panel or by flipping the phone
      if (night !== nightWantRef.current) {
        night = nightWantRef.current;
        flash = Math.max(flash, 0.5);
        try { audioRef.current?.nightfall(night); } catch { /* noop */ }
        try { haptics.ripple(0.6); } catch { /* noop */ }
      }

      // a loose petal, every so often
      if (uniforms.uMeteorAge.value < 90) uniforms.uMeteorAge.value += dt * speed;
      if (simT > meteorNext && !reduced) {
        const ang = Math.random() * Math.PI * 2;
        const start = new THREE.Vector2(Math.cos(ang) * (aspect + 0.3), Math.sin(ang) * 1.3);
        const jitter = (Math.random() - 0.5) * 0.9;
        const dir = start.clone().multiplyScalar(-1).normalize().rotateAround(new THREE.Vector2(0, 0), jitter);
        uniforms.uMeteorA.value.copy(start);
        uniforms.uMeteorD.value.copy(dir);
        uniforms.uMeteorAge.value = 0;
        meteorNext = simT + 16 + Math.random() * 28;
        try { audioRef.current?.chime(0.9); } catch { /* noop */ }
      }

      if (shakeRef.current.pending > 0 && !reduced) {
        flash = Math.max(flash, shakeRef.current.pending * 0.8);
        gustAmt = clamp(gustAmt + shakeRef.current.pending, 0, 2);
        rotSpeed = 0.14 + shakeRef.current.pending * 0.25;
        shakeRef.current.pending = 0;
        try { audioRef.current?.whoosh(1); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
      }

      // springs and drifts
      rotSpeed = mix(rotSpeed, 0.14, 1 - Math.exp(-dt * 0.6));
      uniforms.uRot.value += (rotSpeed * speed) * dt;
      uniforms.uChi.value = 0.32 + 0.3 * Math.sin(simT * 0.05);
      // three taps sent the shimmer-wind sprinting; it eases back to a walk
      uniforms.uWaveAng.value += dt * speed * (0.55 + waveBurst * 3.4);
      waveBurst = mix(waveBurst, 0, 1 - Math.exp(-dt * 1.4));
      gustAmt = mix(gustAmt, 0, 1 - Math.exp(-dt * 2.2));
      uniforms.uGustAmt.value = gustAmt;
      flash = mix(flash, 0, 1 - Math.exp(-dt * 4));
      uniforms.uFlash.value = flash;
      if (uniforms.uRipple.value.z < 90) uniforms.uRipple.value.z += dt;

      // focus breathes until a tap takes over; a long quiet spell resumes it
      if (focusBreathing) focusTarget = 0.38 + 0.28 * Math.sin(simT * 0.1);
      uniforms.uFocus.value = mix(uniforms.uFocus.value, focusTarget, 1 - Math.exp(-dt * 3));

      uniforms.uPupil.value = mix(uniforms.uPupil.value, pupilTarget, 1 - Math.exp(-dt * 3.4));
      nightMix = mix(nightMix, night ? 1 : 0, 1 - Math.exp(-dt * 1.6));
      uniforms.uNightMix.value = nightMix;

      // the suns waltz; pinch reels them together or apart
      sep = mix(sep, sepTarget, 1 - Math.exp(-dt * 4));
      if (!merged && sep < 0.12) {
        merged = true;
        flash = Math.max(flash, 0.9);
        try { audioRef.current?.bell(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
      } else if (merged && sep > 0.2) {
        merged = false;
      }
      // five taps quicken the waltz; the swing decays back to the slow turn
      orbAng += dt * speed * (0.11 + waltzBurst * 0.9);
      waltzBurst = mix(waltzBurst, 0, 1 - Math.exp(-dt * 1.1));
      bary = bary.lerp(baryTarget, 1 - Math.exp(-dt * 3));
      const rot = uniforms.uRot.value + rotExtra;
      const ca = Math.cos(orbAng), sa = Math.sin(orbAng);
      // the whole system revolves in its own slow circle around the frame —
      // never parked, alive the way the night sky is
      const revX = Math.cos(simT * 0.09) * 0.14;
      const revY = Math.sin(simT * 0.09) * 0.11;
      const cx = bary.x + revX, cy = bary.y + revY;
      uniforms.uSunA.value.set(cx - ca * sep * 0.5, cy - sa * sep * 0.35);
      uniforms.uSunB.value.set(cx + ca * sep * 0.5, cy + sa * sep * 0.35);

      // tilt parallax
      uniforms.uPar.value.x = mix(uniforms.uPar.value.x, tiltRef.current.tx, 1 - Math.exp(-dt * 4));
      uniforms.uPar.value.y = mix(uniforms.uPar.value.y, -tiltRef.current.ty, 1 - Math.exp(-dt * 4));

      // weather — three-finger twist/drag walk weatherOffset forward or back
      const phase = simT * 0.022 + weatherOffset;
      const wi = ((Math.floor(phase) % WEATHERS.length) + WEATHERS.length) % WEATHERS.length;
      const wf = phase - Math.floor(phase);
      const sm = wf * wf * (3 - 2 * wf);
      const A = WEATHERS[wi], B = WEATHERS[(wi + 1) % WEATHERS.length];
      const dusk = clamp(uniforms.uPupil.value * 0.55, 0, 1);
      const palMix = Math.max(nightMix, dusk * 0.4);
      const pals = [uniforms.uPal0, uniforms.uPal1, uniforms.uPal2, uniforms.uPal3];
      for (let i = 0; i < 4; i++) {
        setV3(pals[i], blend3(A.pal[i], B.pal[i], sm), NIGHT.pal[i], palMix);
      }
      setV3(uniforms.uWarm, blend3(A.pal[0], B.pal[0], sm), NIGHT.pal[0], palMix);
      setV3(uniforms.uCool, blend3(A.pal[2], B.pal[2], sm), NIGHT.pal[2], palMix);
      setV3(uniforms.uTail, blend3(A.tail, B.tail, sm), NIGHT.tail, nightMix);
      setV3(uniforms.uBg0, blend3(A.bg0, B.bg0, sm), NIGHT.bg0, Math.max(nightMix, dusk));
      setV3(uniforms.uBg1, blend3(A.bg1, B.bg1, sm), NIGHT.bg1, Math.max(nightMix, dusk));
      uniforms.uBloomAmt.value = 0.92 + nightMix * 0.15 + uniforms.uPupil.value * 0.3;

      // apply the twist on top of the slow rotation for this frame
      const savedRot = uniforms.uRot.value;
      uniforms.uRot.value = rot;
      uniforms.uTime.value = simT;

      // render: scene → bright → blur ↔ blur → composite
      renderer.setRenderTarget(rtScene);
      renderer.render(scene, camera);

      postMesh.material = postMat;
      postMat.uniforms.tSrc.value = rtScene.texture;
      renderer.setRenderTarget(rtA);
      renderer.render(postScene, postCam);

      postMesh.material = blurMat;
      for (let i = 0; i < 2; i++) {
        blurMat.uniforms.tSrc.value = rtA.texture;
        blurMat.uniforms.uDir.value.set(1 / rtA.width, 0);
        renderer.setRenderTarget(rtB);
        renderer.render(postScene, postCam);
        blurMat.uniforms.tSrc.value = rtB.texture;
        blurMat.uniforms.uDir.value.set(0, 1 / rtB.height);
        renderer.setRenderTarget(rtA);
        renderer.render(postScene, postCam);
      }

      postMesh.material = compMat;
      compMat.uniforms.tScene.value = rtScene.texture;
      compMat.uniforms.tBloom.value = rtA.texture;
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);

      uniforms.uRot.value = savedRot;
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      for (const t of cascadeTimers) window.clearTimeout(t);
      for (const t of showerTimers) window.clearTimeout(t);
      window.removeEventListener("resize", resize);
      detachGestures();
      unvis();
      ungal();
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      reduceQuery.removeEventListener?.("change", onReduce);
      rtScene?.dispose(); rtA?.dispose(); rtB?.dispose();
      geo.dispose(); plane.dispose(); bgGeo.dispose(); postGeo.dispose();
      petalMat.dispose(); bgMat.dispose(); postMat.dispose(); blurMat.dispose(); compMat.dispose();
      renderer.dispose();
      try { host.removeChild(renderer.domElement); } catch { /* noop */ }
      try { audioRef.current?.dispose(); } catch { /* noop */ }
      audioRef.current = null;
      clearBeamRef.current = () => {};
      persistRef.current?.flush();
    };
  }, [ensureAudio, schedulePersist, onTempo, onNightToggle]);

  const letGo = useCallback(() => {
    clearBeamRef.current();
    try { getFieldAudio().thud(); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
  }, []);

  return (
    <div className="beam-stage" ref={hostRef}>
      {fallback && (
        <div className="beam-fallback" aria-hidden="true">
          <div className="beam-fallback-eye" />
        </div>
      )}
      <LetGo label="let the beam rest" onLetGo={letGo} visible={hasKept} />
      <div className="beam-title" aria-hidden="true">
        <span>the eye of heaven</span>
        <strong>beam</strong>
      </div>
      <div className="beam-hud">
        <span className="beam-hint" aria-hidden="true">tap focus · hold exhale · gust · pinch</span>
        {motionUI === "prompt" && (
          <button
            type="button"
            className="beam-motion-chip"
            aria-label="Enable motion so tilting adds parallax and shaking sends light through the petals"
            onClick={() => { ensureAudio(); armSensors(); }}
          >
            <span aria-hidden="true">◒</span>
            <span>tilt &amp; shake to play</span>
          </button>
        )}
        {motionUI === "on" && (
          <div className="beam-motion-chip beam-motion-on" aria-hidden="true">
            <span>◒</span>
            <span>tilt &amp; shake live</span>
          </div>
        )}
        <MobileInstrumentPanel
          className="beam-panel"
          title="time & light"
          triggerLabel="tune"
          summary={`×${tempo.toFixed(2).replace(/\.?0+$/, "")}${isNight ? " · night" : ""}`}
        >
          <div className="beam-console" aria-label="beam controls">
            <label className="beam-pill">
              <span>tempo</span>
              <input
                type="range" min={0.25} max={2.5} step={0.05} value={tempo}
                aria-label="how fast time moves through the beam"
                onChange={(e) => onTempo(Number(e.target.value))}
              />
              <output>{`×${tempo.toFixed(2).replace(/\.?0+$/, "")}`}</output>
            </label>
            <button type="button" className="beam-pill beam-night-btn" onClick={onNightToggle}>
              {isNight ? "bring back the day" : "let night fall"}
            </button>
          </div>
        </MobileInstrumentPanel>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
.beam-stage {
  position: fixed;
  inset: 0;
  background: #ede8db;
  overflow: hidden;
}
.beam-stage canvas {
  position: absolute;
  inset: 0;
  user-select: none;
  -webkit-user-select: none;
}
.beam-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 45%, #f6efdd 0%, #e4d4bc 55%, #cbb79e 100%);
}
.beam-fallback-eye {
  width: 42vmin;
  height: 42vmin;
  border-radius: 50%;
  background: radial-gradient(circle, #fffdf4 0%, #f0dcae 34%, #d8bd8e 62%, transparent 72%);
  filter: blur(2px);
}
.beam-title {
  position: absolute;
  left: 18px;
  bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  color: #5a4834;
  font-size: 12px;
  letter-spacing: 0.04em;
}
.beam-title strong {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #40311f;
}
.beam-hud {
  position: absolute;
  right: 16px;
  bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.beam-hint {
  color: rgba(90, 72, 52, 0.55);
  font-size: 11px;
  letter-spacing: 0.08em;
  pointer-events: none;
}
.beam-motion-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(90, 72, 52, 0.3);
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: #4c3b26;
  background: rgba(255, 251, 240, 0.75);
  backdrop-filter: blur(6px);
  cursor: pointer;
}
.beam-motion-chip:active { transform: scale(0.97); }
.beam-motion-on {
  cursor: default;
  opacity: 0.65;
}
.beam-console {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 200px;
}
.beam-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(90, 72, 52, 0.25);
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 12px;
  letter-spacing: 0.05em;
  color: #4c3b26;
  background: rgba(255, 251, 240, 0.8);
}
.beam-pill span { min-width: 44px; }
.beam-pill input[type="range"] {
  flex: 1;
  accent-color: #b08850;
  min-width: 90px;
}
.beam-pill output {
  min-width: 40px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.beam-night-btn {
  justify-content: center;
  cursor: pointer;
  font: inherit;
}
.beam-night-btn:active { transform: scale(0.98); }
@media (prefers-reduced-motion: reduce) {
  .beam-motion-chip { display: none; }
}
`,
        }}
      />
    </div>
  );
}
