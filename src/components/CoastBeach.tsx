"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures, enableBreath } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel, requestVessel } from "@/lib/vessel";
import { shouldInvite } from "@/lib/candle";
import { bakeRadialSprite } from "@/lib/scene/radial-sprite";
import LetGo from "@/components/LetGo";
import {
  tideLine,
  sandWetness,
  duneLine,
  zoneAt,
  zoneDepth,
  zoneIndex,
  zoneVoice,
  surfBreath,
  seasonProfile,
  spawnFoam,
  stepFoam,
  capFoam,
  mulberry32,
  mix32,
  SEA_BAND,
  WET_BAND,
  createSandProfile,
  sandProfileAt,
  breakerRunup,
  breakerLifeSec,
  breakerReach,
  applyBreakerToProfile,
  relaxSandProfile,
  SAND_PROFILE_MAX,
  type CoastZone,
  type ZoneVoice,
  type FoamSpeck,
} from "@/lib/coast";
import {
  getNaturalsInZone,
  addNatural as worldAdd,
  removeNatural as worldRemove,
  commitZone as worldCommitZone,
  subscribeNaturals,
  type WorldKind,
  type WorldNatural,
} from "@/lib/world";
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

/**
 * The coast — a section through five materials.
 *
 * The shore is not one surface. Sky, sea, the soaked sand at the waterline,
 * the dry beach, the marram on the dune: a hand that lands in each gets a
 * different answer in sight, in sound, and in what it leaves behind
 * (`zoneAt` in `lib/coast` is the single reading both the renderer and the
 * gesture table start from). The water itself is a fragment shader —
 * refraction over the wet sand, foam where the wave gradient is steep, sun
 * glint on the swell, a sheen that tracks `sandWetness` — with the old 2D
 * painting kept as the guarded fallback when there is no GL.
 *
 * The shells are not the beach's own: they live in the shared world pool
 * (`lib/world`), so a shell left here is the same shell /tide and /waves
 * know about, and it can wash between them while nobody is looking.
 */

const MAX_SHELLS = 24;
const MAX_FOAM = 220;
const MAX_MARKS = 56;
const GROOVE_MAX = 64;
const GROOVE_STRIDE = 6; // x0, y0, x1, y1, life, kind
const MAX_TOUCH = 8;
/** how long the room's slow cycle takes to turn once, untouched (ms) */
const SEASON_MS = 24 * 60 * 1000;

type ShellKind = Extract<
  WorldKind,
  "seashell" | "kelp" | "driftwood" | "starfish" | "sanddollar"
>;
const SHELL_KINDS: ShellKind[] = ["seashell", "kelp", "driftwood", "starfish", "sanddollar"];

type Mark = {
  x: number;
  y: number;
  r: number;
  life: number;
  decay: number;
  /** 0 dimple (wet), 1 crater (dry), 2 bent grass (dune), 3 wake (sea), 4 wisp (sky) */
  kind: number;
  ang: number;
};

type Departing = { n: WorldNatural; t0: number; dur: number };

const VERT = `
attribute vec2 a_pos;
varying vec2 vUv;
void main() {
  vUv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// The shore as a field. Constants here mirror lib/coast exactly — the
// shader and the gesture table must agree on where the wet sand ends.
const FRAG = `
precision highp float;

uniform float uTime;
uniform vec2  uRes;
uniform float uTide;
uniform float uWind;
uniform vec2  uTilt;
uniform float uSurf;
uniform float uLens;
uniform vec2  uPan;
uniform vec4  uSeason;   // berm, swell, grass, warmth
uniform vec4  uPulse;    // sky, sea, wet, dry
uniform float uPulseDune;
uniform vec4  uTouch[8]; // x, y, age(s), zoneIndex + strength
uniform int   uTouchCount;
uniform float uDetail;
uniform float uSandProfile[24]; // what breakers have done to the beach, by column
uniform vec4  uBreak[3];        // nx, spread, power, runup — active breakers
uniform int   uBreakCount;
varying vec2 vUv;

// linear read of the sand-profile bank — a coarse drift, not a heightmap
float sandProfileG(float nx) {
  float f = clamp(nx, 0.0, 1.0) * 23.0;
  float i0 = floor(f);
  float t = f - i0;
  int idx0 = int(i0);
  int idx1 = idx0 + 1;
  float a = 0.0;
  float b = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i == idx0) a = uSandProfile[i];
    if (i == idx1) b = uSandProfile[i];
  }
  return mix(a, b, t);
}

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
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.03;
    a *= 0.52;
  }
  return v;
}

// the swell as a small spectrum: three components, fetch sets their
// spacing, rate their period.
float swellH(float x, float t, float fetch, float rate) {
  float h  = sin(x *  8.0 * fetch + t * 1.15 * rate) * 0.55;
        h += sin(x * 19.0 * fetch - t * 1.90 * rate + 1.3) * 0.30;
        h += sin(x * 41.0 * fetch + t * 2.90 * rate + 2.7) * 0.15;
  return h;
}

float duneLineG(float nx, float tide) {
  float shape = sin(nx * 4.0 + 0.4) * 0.04 + sin(nx * 11.0) * 0.015;
  return max(0.78 + shape, tide + 0.16);
}

float wetnessG(float ny, float tide, float swash) {
  if (ny <= tide) return 0.0;
  float reach = 0.05 + swash * 0.05;
  float d = ny - tide;
  float plateau = reach * 0.35;
  if (d <= plateau) return 1.0;
  return max(0.0, 1.0 - (d - plateau) / (reach * 1.6));
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 p = uv + uPan + vec2(uTilt.x * 0.02, uTilt.y * 0.01);
  float t = uTime;
  float tide = uTide;
  float hz = tide - 0.10;                       // the horizon
  float amp = 0.006 + uSeason.y * 0.016;        // swell height, seasonal
  float fetch = mix(1.35, 0.72, uSeason.y);     // storm swell is longer-crested
  float rate = mix(0.80, 1.35, uSeason.y);
  float swash = uSurf;

  float h0 = swellH(p.x, t, fetch, rate);
  float h1 = swellH(p.x + 0.004, t, fetch, rate);
  float slope = (h1 - h0) / 0.004;
  // the water edge climbs the beach and drains back on the surf breath
  float waterY = tide + (swash - 0.5) * 0.045 + h0 * amp;

  // ——— sky ———
  float sy = clamp(p.y / max(0.0001, hz), 0.0, 1.0);
  vec3 skyTop = mix(vec3(0.30, 0.40, 0.55), vec3(0.36, 0.55, 0.78), uSeason.w);
  vec3 skyLow = mix(vec3(0.76, 0.80, 0.85), vec3(0.88, 0.92, 0.96), uSeason.w);
  vec3 sky = mix(skyTop, skyLow, pow(sy, 0.75));
  vec2 sunP = vec2(0.26, hz * 0.30);
  float sd = length((p - sunP) * vec2(uRes.x / max(1.0, uRes.y), 1.0));
  sky += vec3(1.00, 0.93, 0.80)
       * (0.55 * exp(-sd * sd / 0.0012) + 0.12 * exp(-sd * sd / 0.02))
       * (0.45 + 0.55 * uSeason.w);
  float cl = fbm(vec2(p.x * 3.0 + t * 0.012 + uWind * 0.4, p.y * 7.0 - t * 0.004));
  sky = mix(sky, vec3(0.95, 0.95, 0.96), smoothstep(0.50, 0.86, cl) * 0.38 * (1.0 - sy * 0.4));

  // ——— sea ———
  float d01 = clamp((waterY - p.y) / max(0.0001, waterY - hz), 0.0, 1.0);
  vec3 sea = mix(vec3(0.42, 0.66, 0.66), vec3(0.16, 0.42, 0.55), smoothstep(0.0, 0.45, d01));
  sea = mix(sea, vec3(0.07, 0.22, 0.36), smoothstep(0.45, 1.0, d01));
  // refraction: near the shore the wet bed shows through, warped by the
  // surface slope, so the shallows read as water *over sand*
  vec2 ruv = vec2(p.x + slope * 0.010 * (1.0 - d01), p.y + 0.02 * (1.0 - d01));
  float bedN = fbm(ruv * vec2(26.0, 90.0));
  vec3 bed = mix(vec3(0.50, 0.42, 0.31), vec3(0.66, 0.57, 0.43), bedN);
  sea = mix(bed * vec3(0.86, 0.95, 1.0), sea, smoothstep(0.0, 0.30, d01));
  // foam where the gradient is steep, and lace at the swash line
  float steep = abs(slope) * amp * 16.0;
  float crest = smoothstep(0.45, 1.0, h0 * 0.5 + 0.5);
  float foamM = smoothstep(0.35, 0.95, steep) * crest;
  foamM += (1.0 - smoothstep(0.0, 0.11, d01)) * (0.45 + 0.55 * swash);
  float lace = fbm(vec2(p.x * 90.0 + t * 0.6, p.y * 220.0 - t * 0.4));
  sea = mix(sea, vec3(0.97, 0.98, 0.99),
            clamp(foamM, 0.0, 1.0) * mix(0.55, smoothstep(0.32, 0.78, lace), uDetail));
  // sun glint on the swell
  vec3 nrm = normalize(vec3(-slope * amp * 10.0, 1.0, 0.35));
  vec3 lit = normalize(vec3(0.35, 0.85, 0.40));
  vec3 eye = normalize(vec3(0.0, 0.40, 1.0));
  float spec = pow(max(dot(nrm, normalize(lit + eye)), 0.0), 48.0);
  sea += vec3(1.0, 0.96, 0.86) * spec * (0.45 + 0.55 * uSeason.w) * (0.35 + 0.65 * (1.0 - d01));

  // ——— sand ———
  // the profile a breaker's swash has actually left behind: erosion right
  // where it broke, a berm further up its own run — real, not painted
  float dune = duneLineG(p.x, tide) - uSeason.x * 0.02 - sandProfileG(p.x);   // the summer berm builds it up
  float wet = wetnessG(p.y, tide, swash);
  float grain = fbm(vec2(p.x * 160.0, p.y * 420.0));
  vec3 dry = mix(vec3(0.79, 0.71, 0.55), vec3(0.87, 0.80, 0.64), mix(0.5, grain, uDetail));
  vec3 wetC = mix(vec3(0.40, 0.34, 0.26), vec3(0.50, 0.43, 0.33), grain);
  vec3 sand = mix(dry, wetC, wet);
  // the sheen: soaked sand mirrors the sky and throws the sun back
  sand = mix(sand, mix(skyLow, skyTop, 0.35), wet * 0.30);
  float sheen = pow(max(0.0, 1.0 - abs(p.x - 0.32) * 1.5), 6.0);
  sand += vec3(1.0, 0.97, 0.90) * sheen * wet * 0.26 * (0.35 + 0.65 * uSeason.w);
  // marram, leaning downwind, greenest in the growing season
  float band = smoothstep(dune - 0.085, dune - 0.004, p.y);
  float bl = p.x * 250.0 + sin(p.y * 42.0 + t * (0.5 + abs(uWind) * 2.6) + uWind * 3.2) * 2.4;
  float blade = smoothstep(0.70, 0.99, fract(bl * 0.15915));
  vec3 grassC = mix(vec3(0.34, 0.42, 0.25), vec3(0.62, 0.64, 0.38), uSeason.z);
  sand = mix(sand, grassC, band * blade * 0.85);

  // ——— dune body ———
  float duneM = smoothstep(dune - 0.004, dune + 0.004, p.y);
  vec3 duneC = mix(vec3(0.70, 0.64, 0.49), vec3(0.60, 0.56, 0.43),
                   fbm(vec2(p.x * 40.0, p.y * 120.0)));
  duneC = mix(duneC, grassC, blade * 0.25);

  // ——— composite, far to near ———
  float seaM = 1.0 - smoothstep(waterY - 0.0025, waterY + 0.0025, p.y);
  float skyM = 1.0 - smoothstep(hz - 0.004, hz + 0.004, p.y);
  vec3 col = sand;
  col = mix(col, duneC, duneM);
  col = mix(col, sea, seaM);
  col = mix(col, sky, skyM);

  // ——— what a hand just did ———
  for (int i = 0; i < 8; i++) {
    if (i >= uTouchCount) break;
    vec4 tc = uTouch[i];
    float age = tc.z;
    if (age > 1.8) continue;
    float zi = floor(tc.w);
    float st = fract(tc.w);
    vec2 dp = (p - tc.xy) * vec2(uRes.x / max(1.0, uRes.y), 1.0);
    float r = length(dp);
    float k = 1.0 - age / 1.8;
    // squared directly: pow() with a negative base is undefined in ES 1.00
    float front = (r - age * 0.20) / 0.030;
    float ring = exp(-front * front) * k;
    float glow = exp(-r * r / (0.006 + age * 0.02)) * k;
    vec3 tint = vec3(1.00, 0.98, 0.88);
    if (zi > 0.5 && zi < 1.5) tint = vec3(0.88, 0.98, 1.00);
    else if (zi > 1.5 && zi < 2.5) tint = vec3(0.72, 0.85, 0.93);
    else if (zi > 2.5 && zi < 3.5) tint = vec3(0.97, 0.89, 0.70);
    else if (zi > 3.5) tint = vec3(0.72, 0.85, 0.54);
    col += tint * (ring * 0.60 + glow * 0.38) * (0.30 + 0.95 * st);
    if (zi > 1.5 && zi < 2.5) col *= 1.0 - glow * 0.32 * st;   // wet sand darkens
    if (zi > 2.5 && zi < 3.5) col *= 1.0 - ring * 0.20 * st;   // dry sand craters
  }

  // ——— a raised breaker's own swash front, running up the beach ———
  for (int i = 0; i < 3; i++) {
    if (i >= uBreakCount) break;
    vec4 br = uBreak[i];
    float bx = br.x;
    float spread = br.y;
    float power = br.z;
    float runup = br.w;
    float lateral = exp(-(p.x - bx) * (p.x - bx) / (2.0 * spread * spread));
    if (lateral < 0.02) continue;
    float reach = 0.16 + power * 0.55;
    // the swash front climbs from the waterline toward the dune as runup rises
    float frontY = tide + 0.02 - runup * (dune - tide) * min(1.0, reach);
    float band = exp(-abs(p.y - frontY) * 90.0) * lateral * power;
    col += vec3(0.96, 0.98, 1.0) * band * 0.85;
  }

  // ——— whole-band answers (tutti, a knock, the vessel) ———
  float sandM = (1.0 - seaM) * (1.0 - duneM);
  col += vec3(1.00, 0.98, 0.90) * uPulse.x * skyM * 0.20;
  col += vec3(0.85, 0.96, 1.00) * uPulse.y * seaM * 0.24;
  col += vec3(0.78, 0.90, 0.96) * uPulse.z * wet * sandM * 0.28;
  col += vec3(1.00, 0.94, 0.78) * uPulse.w * (1.0 - wet) * sandM * 0.22;
  col += vec3(0.75, 0.88, 0.55) * uPulseDune * duneM * 0.26;

  // ——— the lens: shore → mechanics → felt weather ———
  float l1 = clamp(1.0 - abs(uLens - 1.0), 0.0, 1.0);
  if (l1 > 0.002) {
    float phase = p.x * 8.0 * fetch + t * 1.15 * rate;
    float iso = smoothstep(0.90, 1.0, abs(sin(phase)));
    float grid = smoothstep(0.88, 1.0, abs(sin(p.y * 90.0)));
    vec3 mech = vec3(0.05, 0.08, 0.11);
    mech += vec3(0.25, 0.85, 0.95) * iso;
    mech += vec3(0.20, 0.35, 0.45) * grid * 0.28;
    // the swell as a spectrum: three bars, one per component
    float comp = floor(p.x * 3.0);
    float bx = fract(p.x * 3.0);
    float energy = comp < 0.5 ? 0.55 : (comp < 1.5 ? 0.30 : 0.15);
    float bar = step(1.0 - energy * (0.45 + uSeason.y * 0.4), p.y)
              * step(0.10, bx) * step(bx, 0.90) * step(p.y, 0.985);
    mech = mix(mech, vec3(0.85, 0.95, 1.0), bar * 0.55);
    mech += vec3(1.0) * (1.0 - smoothstep(0.0, 0.004, abs(p.y - waterY))) * 0.55;
    col = mix(col, mech, l1 * 0.88);
  }
  float l2 = clamp(uLens - 1.0, 0.0, 1.0);
  if (l2 > 0.002) {
    float press = fbm(vec2(p.x * 2.2 + uWind * 1.5 + t * 0.02, p.y * 2.2 - t * 0.013));
    float isobar = smoothstep(0.92, 1.0, abs(sin(press * 22.0)));
    vec3 felt = mix(vec3(0.24, 0.44, 0.72), vec3(0.93, 0.56, 0.34),
                    clamp(uSeason.w * 0.55 + press * 0.5 + swash * 0.25, 0.0, 1.0));
    felt = mix(felt, vec3(0.95, 0.96, 0.98), isobar * 0.55);
    felt *= 0.72 + 0.48 * swash;
    col = mix(col, felt, l2 * 0.85);
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// ——— the shore's own voice ———
//
// An idle surf bed that breathes on the room's real tide phase (so the room
// is audibly alive with no hand on it), plus one answer per material. Built
// on the shared graph's AudioContext — no second context, no assets.
function makeShoreVoice() {
  const fa = getFieldAudio();
  let ctx: AudioContext | null = null;
  let bus: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let bedGain: GainNode | null = null;
  let bedLp: BiquadFilterNode | null = null;
  let bedSrc: AudioBufferSourceNode | null = null;
  let hissGain: GainNode | null = null;
  let hissBp: BiquadFilterNode | null = null;
  let hissSrc: AudioBufferSourceNode | null = null;
  let droneOsc: OscillatorNode | null = null;
  let droneGain: GainNode | null = null;
  let lastBreakAt = 0;

  const noise = (c: AudioContext, brown: boolean): AudioBuffer => {
    if (noiseBuf && brown) return noiseBuf;
    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    if (brown) {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
      noiseBuf = buf;
    } else {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  };

  const ensure = (): boolean => {
    if (ctx && bus) return true;
    try {
      void fa.start();
    } catch {
      /* noop */
    }
    const c = fa.getAudioContext();
    if (!c) return false;
    if (c.state === "suspended") {
      try {
        void c.resume();
      } catch {
        /* noop */
      }
    }
    ctx = c;
    bus = c.createGain();
    bus.gain.value = 0.0001;
    // into the shared graph's analyser — upstream of the master bus glue and
    // limiter, so the shore obeys the same headroom as everything else and
    // shows up in the field's own FFT rather than sneaking past it.
    bus.connect(fa.getAnalyser() ?? c.destination);

    // the body of the surf — brown noise under a moving lowpass
    bedSrc = c.createBufferSource();
    bedSrc.buffer = noise(c, true);
    bedSrc.loop = true;
    bedLp = c.createBiquadFilter();
    bedLp.type = "lowpass";
    bedLp.frequency.value = 620;
    bedGain = c.createGain();
    bedGain.gain.value = 0.08;
    bedSrc.connect(bedLp).connect(bedGain).connect(bus);

    // the hiss of the sheet running up the sand
    hissSrc = c.createBufferSource();
    hissSrc.buffer = noise(c, false);
    hissSrc.loop = true;
    hissBp = c.createBiquadFilter();
    hissBp.type = "bandpass";
    hissBp.frequency.value = 2600;
    hissBp.Q.value = 0.8;
    hissGain = c.createGain();
    hissGain.gain.value = 0.006;
    hissSrc.connect(hissBp).connect(hissGain).connect(bus);

    // the ground note of the water, following the tide
    droneOsc = c.createOscillator();
    droneOsc.type = "sine";
    droneOsc.frequency.value = 55;
    droneGain = c.createGain();
    droneGain.gain.value = 0.012;
    droneOsc.connect(droneGain).connect(bus);

    try {
      bedSrc.start();
      hissSrc.start();
      droneOsc.start();
    } catch {
      /* noop */
    }
    return true;
  };

  /** Ride the surf envelope. Called on a throttle, never every frame. */
  const breathe = (surf: number, tide: number, wind: number, awake: boolean) => {
    // nothing built yet and nobody listening — don't build a surf to hush it
    if (!awake && !ctx) return;
    if (!ensure() || !ctx || !bus) return;
    const now = ctx.currentTime;
    const on = awake && !fa.isMuted();
    const s = Math.max(0, Math.min(1, surf));
    bus.gain.setTargetAtTime(on ? 0.9 : 0.0001, now, 0.4);
    if (!on) return;
    bedGain?.gain.setTargetAtTime(0.045 + s * 0.085 + Math.abs(wind) * 0.02, now, 0.35);
    bedLp?.frequency.setTargetAtTime(380 + s * 620 + Math.abs(wind) * 220, now, 0.35);
    hissGain?.gain.setTargetAtTime(0.002 + Math.pow(s, 2.2) * 0.028, now, 0.25);
    hissBp?.frequency.setTargetAtTime(1900 + s * 2400, now, 0.3);
    droneOsc?.frequency.setTargetAtTime(44 + (1 - tide) * 26, now, 1.2);
    droneGain?.gain.setTargetAtTime(0.008 + s * 0.012, now, 0.6);
  };

  /** A set arriving — one wave folding over. */
  const breakWave = (strength: number) => {
    if (!ensure() || !ctx || !bus || fa.isMuted()) return;
    const c = ctx;
    const now = c.currentTime;
    if (now - lastBreakAt < 1.1) return;
    lastBreakAt = now;
    const s = Math.max(0.15, Math.min(1, strength));
    const src = c.createBufferSource();
    src.buffer = noise(c, false);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1400 + s * 900, now);
    bp.frequency.exponentialRampToValueAtTime(220, now + 1.5);
    bp.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.02 + s * 0.055, now + 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    src.connect(bp).connect(g).connect(bus);
    try {
      src.start(now);
      src.stop(now + 1.7);
    } catch {
      /* noop */
    }
    src.onended = () => {
      try {
        src.disconnect();
        bp.disconnect();
        g.disconnect();
      } catch {
        /* noop */
      }
    };
  };

  /** The material's own answer: tone plus grain, both from `zoneVoice`. */
  const say = (v: ZoneVoice) => {
    if (!ensure() || !ctx || !bus || fa.isMuted()) return;
    const c = ctx;
    const now = c.currentTime;
    const f0 = 440 * Math.pow(2, (v.midi - 69) / 12);
    const f1 = 440 * Math.pow(2, (v.midi + v.glide - 69) / 12);

    const osc = c.createOscillator();
    osc.type = v.wave;
    osc.frequency.setValueAtTime(Math.max(24, f0), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, f1), now + v.dur);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(120, v.cutoffHz);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v.toneGain), now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + v.dur);
    osc.connect(lp).connect(g).connect(bus);
    osc.start(now);
    osc.stop(now + v.dur + 0.06);
    osc.onended = () => {
      try {
        osc.disconnect();
        lp.disconnect();
        g.disconnect();
      } catch {
        /* noop */
      }
    };

    if (v.noiseGain > 0.0005) {
      const src = c.createBufferSource();
      src.buffer = noise(c, false);
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = v.noiseHz;
      bp.Q.value = v.noiseQ;
      const ng = c.createGain();
      const nd = v.dur * 0.8;
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.exponentialRampToValueAtTime(v.noiseGain, now + 0.01);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + nd);
      src.connect(bp).connect(ng).connect(bus);
      try {
        src.start(now);
        src.stop(now + nd + 0.05);
      } catch {
        /* noop */
      }
      src.onended = () => {
        try {
          src.disconnect();
          bp.disconnect();
          ng.disconnect();
        } catch {
          /* noop */
        }
      };
    }
  };

  const stop = () => {
    try {
      bedSrc?.stop();
      hissSrc?.stop();
      droneOsc?.stop();
    } catch {
      /* noop */
    }
    for (const n of [bedSrc, bedLp, bedGain, hissSrc, hissBp, hissGain, droneOsc, droneGain, bus]) {
      try {
        n?.disconnect();
      } catch {
        /* noop */
      }
    }
    ctx = null;
    bus = null;
  };

  return { breathe, breakWave, say, stop, ensure };
}

// Baked once per (rgb, edge) through the shared radial-sprite cache — never
// a gradient inside the frame loop. See src/lib/scene/radial-sprite.ts.
function softSprite(rgb: string, edge: number): HTMLCanvasElement | null {
  return bakeRadialSprite(`coast-soft:${rgb}:${edge}`, {
    width: 64,
    height: 64,
    stops: [
      { offset: 0, color: `rgba(${rgb},1)` },
      { offset: edge, color: `rgba(${rgb},0.55)` },
      { offset: 1, color: `rgba(${rgb},0)` },
    ],
  });
}

export default function CoastBeach() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const letGoRef = useRef<() => void>(() => {});
  const [hasKept, setHasKept] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const glCanvas = glCanvasRef.current;
    const fxCanvas = fxCanvasRef.current;
    if (!wrap || !glCanvas || !fxCanvas) return;
    const ctx = fxCanvas.getContext("2d");
    if (!ctx) return;

    const audio = getFieldAudio();
    const voice = makeShoreVoice();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
    const clamp01 = (v: number) => clamp(v, 0, 1);

    // ——— the shared world: one coast, four pages ———
    // The shells are not private to /coast. `lib/world` folds the beach's
    // old `objetdart:coast:v1` store forward on its first load, so nothing
    // a visitor left is dropped, and from here on a shell can wash out to
    // /tide or /waves while nobody is watching.
    let shells: WorldNatural[] = getNaturalsInZone("coast");
    const syncKept = () => setHasKept(shells.length > 0);
    syncKept();
    const unsubWorld = subscribeNaturals(() => {
      shells = getNaturalsInZone("coast");
      syncKept();
    });
    const writer = createIdleWriter(() => {
      worldCommitZone("coast", shells);
      // the world enforces its own caps on commit — read back so the beach
      // never renders something the pool has already let go of
      shells = getNaturalsInZone("coast");
      syncKept();
    }, 500);

    // ——— canvas / GL ———
    let width = 0;
    let height = 0;
    let tier: QualityTier = gov.tier();

    const glOpts: WebGLContextAttributes = { antialias: false, premultipliedAlpha: false };
    let gl =
      (glCanvas.getContext("webgl", glOpts) ||
        glCanvas.getContext("experimental-webgl" as "webgl", glOpts)) as WebGLRenderingContext | null;

    type GLBits = {
      prog: WebGLProgram;
      buf: WebGLBuffer;
      vs: WebGLShader;
      fs: WebGLShader;
      u: Record<string, WebGLUniformLocation | null>;
    };
    let bits: GLBits | null = null;

    const buildGL = (): GLBits | null => {
      if (!gl) return null;
      const compile = (type: number, src: string): WebGLShader | null => {
        const s = gl!.createShader(type);
        if (!s) return null;
        gl!.shaderSource(s, src);
        gl!.compileShader(s);
        if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
          console.warn("coast shader", gl!.getShaderInfoLog(s));
          gl!.deleteShader(s);
          return null;
        }
        return s;
      };
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      const buf = gl.createBuffer();
      if (!prog || !buf) return null;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn("coast link", gl.getProgramInfoLog(prog));
        return null;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.useProgram(prog);
      const u: Record<string, WebGLUniformLocation | null> = {};
      for (const name of [
        "uTime", "uRes", "uTide", "uWind", "uTilt", "uSurf", "uLens", "uPan",
        "uSeason", "uPulse", "uPulseDune", "uTouch", "uTouchCount", "uDetail",
        "uSandProfile", "uBreak", "uBreakCount",
      ]) {
        u[name] = gl.getUniformLocation(prog, name);
      }
      return { prog, buf, vs, fs, u };
    };
    bits = buildGL();

    const onCtxLost = (e: Event) => {
      e.preventDefault();
      bits = null;
    };
    const onCtxRestored = () => {
      bits = buildGL();
      if (gl) gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    };
    glCanvas.addEventListener("webglcontextlost", onCtxLost);
    glCanvas.addEventListener("webglcontextrestored", onCtxRestored);

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = resolveDpr(tier, { embedded, reducedMotion: reduced });
      fxCanvas.width = Math.max(1, Math.round(width * dpr));
      fxCanvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      glCanvas.width = Math.max(1, Math.round(width * dpr));
      glCanvas.height = Math.max(1, Math.round(height * dpr));
      if (gl) gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ——— sprites (never a gradient inside a loop) ———
    const SPRITES: Array<HTMLCanvasElement | null> = [
      softSprite("255,255,255", 0.45),
      softSprite("214,190,146", 0.5),
      softSprite("150,176,104", 0.5),
    ];

    // ——— state vector ———
    const foam: FoamSpeck[] = [];
    const marks: Mark[] = [];
    const grooves = new Float32Array(GROOVE_MAX * GROOVE_STRIDE);
    let grooveHead = 0;
    const touchBuf = new Float32Array(MAX_TOUCH * 4);
    const touches: Array<{ x: number; y: number; t0: number; z: number; s: number }> = [];
    let departing: Departing[] = [];

    let tiltX = 0;
    let tiltY = 0;
    let wind = 0;
    let moon = 0.5;
    let spray = 0;
    let season = 0;
    let seasonAcc = 0;
    let lens = 0;
    let lensTarget = 0;
    let lensAcc = 0;
    const pan = { x: 0, y: 0 };
    const panTarget = { x: 0, y: 0 };
    let timeScale = 1;
    let timeScaleTarget = 1;
    // Two clocks. `simT` is the room's own, and it starts near zero so the
    // shader's float32 keeps its precision on the fast swell components.
    // The tide and the surf sets run on the wall clock instead, so the
    // shore a visitor walks in on is where the world actually is.
    let simT = 0;
    const tideEpoch = (Date.now() % 86_400_000) / 1000;
    const pulse = [0, 0, 0, 0, 0];
    let breathWind = 0;
    // rhythm entrainment: a steady tapped pulse briefly sets the swell period
    let entrainPeriod = 9;
    let entrainUntil = 0;

    let lastTouchAt = performance.now();
    let glimmerAt = 0;
    let glimmerZone = 1;
    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    let night = false;
    let last = performance.now();
    let raf = 0;
    let running = true;
    let lastBreatheAt = 0;
    let prevSurf = 0;
    let lastTutti = 0;

    // ——— breakers: the beach's own countable, physical event ———
    // A raised breaker runs its real swash up the beach (lib/coast's
    // asymmetric run-up curve) and, while it runs, moves both the sand
    // profile and any shells caught in its lateral reach — a wave that
    // actually rearranges the shore instead of a decal painted over it.
    type Breaker = { nx: number; spread: number; power: number; t0: number };
    let breakers: Breaker[] = [];
    const MAX_BREAKERS = 4;
    const sandProfile = createSandProfile();
    const breakUniform = new Float32Array(3 * 4); // up to 3 visualized: nx, spread, power, runup

    // a tide pool opened on the wet sand: a shallow held patch that lingers
    // and slowly drains — the wet band's own countable thing
    type TidePool = { nx: number; ny: number; r: number; t0: number };
    let tidePools: TidePool[] = [];
    const MAX_TIDE_POOLS = 3;

    const raiseBreaker = (bnx: number, power: number) => {
      breakers.push({
        nx: clamp(bnx, 0.04, 0.96),
        spread: 0.09 + clamp01(power) * 0.08,
        power: clamp01(power),
        t0: simT,
      });
      if (breakers.length > MAX_BREAKERS) breakers.shift();
      voice.breakWave(0.55 + power * 0.45);
      audio.thud();
      haptics.storm();
      pulse[1] = Math.min(1, pulse[1] + 0.6);
    };

    const syncSleep = () => {
      asleep = hidden || galleryPaused;
      if (asleep) {
        gov.force("sleep");
        voice.breathe(0, 0.6, 0, false);
      }
    };
    const unvis = onVisibility((h) => {
      hidden = h;
      syncSleep();
    });
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    const tideNow = () => tideLine(tideEpoch + simT, moon);
    const surfNow = () =>
      surfBreath(
        tideEpoch + simT,
        performance.now() < entrainUntil ? entrainPeriod : 9 - seasonProfile(season).swell * 3,
      );

    const toLocal = (cx: number, cy: number) => {
      const r = wrap.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    };

    const addTouch = (nx: number, ny: number, zone: CoastZone, strength: number) => {
      touches.push({
        x: nx,
        y: ny,
        t0: performance.now(),
        z: zoneIndex(zone),
        s: clamp(strength, 0.02, 0.98),
      });
      if (touches.length > MAX_TOUCH) touches.shift();
    };

    const addMark = (x: number, y: number, r: number, kind: number, decay: number, ang = 0) => {
      marks.push({ x, y, r, life: 1, decay, kind, ang });
      if (marks.length > MAX_MARKS) marks.shift();
    };

    const addGroove = (x0: number, y0: number, x1: number, y1: number, kind: number) => {
      const i = grooveHead * GROOVE_STRIDE;
      grooves[i] = x0;
      grooves[i + 1] = y0;
      grooves[i + 2] = x1;
      grooves[i + 3] = y1;
      grooves[i + 4] = 1;
      grooves[i + 5] = kind;
      grooveHead = (grooveHead + 1) % GROOVE_MAX;
    };

    const throwFoam = (
      seed: number,
      x: number,
      y: number,
      n: number,
      opts: Parameters<typeof spawnFoam>[4],
    ) => {
      const detail = detailForTier(tier);
      const count = Math.max(2, Math.round(n * detail.particles));
      const born = spawnFoam(seed, x, y, count, opts);
      for (let i = 0; i < born.length; i++) foam.push(born[i]);
      capFoam(foam, Math.floor(MAX_FOAM * detail.particles));
    };

    // ——— the five answers ———
    //
    // One reading (`zoneAt`), five materials, and each answers in its own
    // sight, its own register *and timbre*, and its own residue.
    const answer = (nx: number, ny: number, intensity: number, force = 1) => {
      const tide = tideNow();
      const zone = zoneAt(nx, ny, tide);
      const depth = zoneDepth(nx, ny, tide);
      const v = zoneVoice(zone, depth, intensity);
      const seed = mix32(Math.round(nx * 4096), Math.round(ny * 4096), Math.round(simT));
      const push = 0.35 + intensity * 0.9;
      pulse[zoneIndex(zone)] = Math.min(1, pulse[zoneIndex(zone)] + 0.25 * force * push);
      addTouch(nx, ny, zone, 0.25 + intensity * 0.7);
      voice.say(v);

      switch (zone) {
        case "sky":
          // the air takes it: a wisp that rises and is carried downwind
          throwFoam(seed, nx, ny, Math.round(10 * force), {
            spread: 0.05, rise: 0.075 * push, drift: 0.02,
            size: 5.2, decay: 0.3, tint: 0,
          });
          addMark(nx, ny, 0.05, 4, 0.5);
          haptics.tap();
          break;
        case "sea":
          // the sea slaps back: a real splash thrown up out of the swell
          throwFoam(seed, nx, ny, Math.round(22 * force), {
            spread: 0.035, rise: 0.16 * push, drift: 0.07,
            size: 6.5, decay: 0.55, tint: 0,
          });
          addMark(nx, ny, 0.07, 3, 0.7);
          voice.breakWave(0.4 + intensity * 0.5);
          haptics.ripple(0.45 + intensity * 0.5);
          break;
        case "wet":
          // soaked sand keeps a print, and the water squeezes out around it
          throwFoam(seed, nx, ny, Math.round(12 * force), {
            spread: 0.03, rise: 0.05 * push, drift: 0.05,
            size: 4.2, decay: 0.9, tint: 0,
          });
          addMark(nx, ny, 0.035 + intensity * 0.02, 0, 0.09);
          haptics.chop();
          break;
        case "dry":
          // dry sand takes a crater and puffs; almost nothing comes back
          throwFoam(seed, nx, ny, Math.round(16 * force), {
            spread: 0.045, rise: 0.055 * push, drift: 0.06,
            size: 5.0, decay: 0.75, tint: 1,
          });
          addMark(nx, ny, 0.04 + intensity * 0.025, 1, 0.16);
          haptics.tap();
          break;
        default:
          // marram: the blades shiver and let go a little dust
          throwFoam(seed, nx, ny, Math.round(9 * force), {
            spread: 0.06, rise: 0.04 * push, drift: 0.05,
            size: 3.6, decay: 0.5, tint: 2,
          });
          addMark(nx, ny, 0.07, 2, 0.35, (mulberry32(seed)() - 0.5) * 1.2);
          haptics.chop();
          break;
      }
      return zone;
    };

    // ——— shells: creation, deepening, and the sea taking one back ———
    //
    // Every shell's look is a deterministic function of its seed, resolved
    // once and cached: the RAF loop must not build a PRNG per object per
    // frame just to ask a shell what colour it has always been.
    type ShellStyle = {
      drop: number; hue: number; rot: number; r: number;
      a: number; b: number;
    };
    const styleCache = new Map<string, ShellStyle>();
    const styleFor = (n: WorldNatural): ShellStyle => {
      const hit = styleCache.get(n.id);
      if (hit) return hit;
      const rng = mulberry32((n.seed >>> 0) || 1);
      const st: ShellStyle = {
        drop: rng(),
        hue: 26 + rng() * 44,
        rot: rng() * Math.PI,
        r: 5 + rng() * 4,
        a: rng(),
        b: rng(),
      };
      if (styleCache.size > 192) styleCache.clear();
      styleCache.set(n.id, st);
      return st;
    };

    const beachY = (n: WorldNatural, tide: number) => {
      // things that washed in from another zone arrive at the waterline
      if (n.ny <= tide + 0.005) return tide + 0.012 + styleFor(n).drop * 0.1;
      return n.ny;
    };

    const shellAt = (nx: number, ny: number): WorldNatural | null => {
      const tide = tideNow();
      const ar = Math.max(1, width) / Math.max(1, height);
      let best: WorldNatural | null = null;
      let bestD = Infinity;
      for (const s of shells) {
        const dx = (s.nx - nx) * ar;
        const dy = beachY(s, tide) - ny;
        const d = Math.hypot(dx, dy);
        if (d < 0.055 && d < bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    };

    const kindFor = (seed: number): ShellKind => {
      const r = mulberry32(seed >>> 0 || 1)();
      if (r < 0.56) return "seashell";
      if (r < 0.72) return "sanddollar";
      if (r < 0.85) return "kelp";
      if (r < 0.94) return "driftwood";
      return "starfish";
    };

    const washOutOldest = () => {
      if (!shells.length) return;
      let oldest = shells[0];
      for (const s of shells) if (s.createdAt < oldest.createdAt) oldest = s;
      departing.push({ n: oldest, t0: performance.now(), dur: reduced ? 500 : 2200 });
      worldRemove(oldest.id);
      shells = getNaturalsInZone("coast");
      // the shore answers the refusal in its own body: the sea reaches up
      // and takes the one that has lain there longest
      voice.breakWave(0.85);
      pulse[1] = 1;
      pulse[2] = Math.min(1, pulse[2] + 0.7);
      haptics.roll();
      syncKept();
    };

    const plantShell = (nx: number, ny: number, seedIn?: number) => {
      const tide = tideNow();
      const y = Math.max(tide + 0.02, Math.min(0.97, ny));
      if (shells.length >= MAX_SHELLS) washOutOldest();
      const seed = seedIn ?? mix32(Math.round(nx * 997), Math.round(y * 991), shells.length, Math.round(simT * 10));
      const made = worldAdd(kindFor(seed), "coast", clamp(nx, 0.03, 0.97), y, 0);
      shells = getNaturalsInZone("coast");
      writer.schedule();
      syncKept();
      if (made) {
        throwFoam(seed, nx, y, 10, { spread: 0.035, rise: 0.05, drift: 0.04, size: 4.4, decay: 0.8, tint: 1 });
        addMark(nx, y, 0.05, 1, 0.35);
        audio.spark();
        haptics.ripple(0.5);
      }
      return made;
    };

    const takeShell = (s: WorldNatural) => {
      // the ceremony: the sea takes it back
      departing.push({ n: s, t0: performance.now(), dur: reduced ? 480 : 1900 });
      worldRemove(s.id);
      shells = getNaturalsInZone("coast");
      writer.schedule();
      syncKept();
      const tide = tideNow();
      throwFoam(mix32(s.seed, 7), s.nx, beachY(s, tide), 26, {
        spread: 0.05, rise: 0.12, drift: 0.09, size: 6.0, decay: 0.5, tint: 0,
      });
      pulse[2] = 1;
      voice.breakWave(0.9);
      audio.bell();
      haptics.bloom();
    };

    // ——— tutti: one synchronized pulse of everything alive ———
    const noteTimers: number[] = [];
    const tutti = (strength = 1) => {
      const now = performance.now();
      if (now - lastTutti < 900) return;
      lastTutti = now;
      if (noteTimers.length > 120) noteTimers.splice(0, noteTimers.length - 60);
      const tide = tideNow();
      for (let i = 0; i < pulse.length; i++) pulse[i] = Math.min(1, pulse[i] + 0.85 * strength);
      voice.breakWave(0.7 * strength);
      // every material states itself, seaward first
      for (let i = 0; i < 5; i++) {
        const zone = (["sky", "sea", "wet", "dry", "dune"] as CoastZone[])[i];
        const id = window.setTimeout(() => {
          voice.say(zoneVoice(zone, 0.5, 0.35 + strength * 0.35));
        }, i * 90);
        noteTimers.push(id);
      }
      // and every shell answers once, in the order the shore laid them down
      shells
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, 10)
        .forEach((s, i) => {
          const id = window.setTimeout(() => {
            voice.say(zoneVoice(zoneAt(s.nx, beachY(s, tide), tide), 0.4, 0.3));
          }, 420 + i * 70);
          noteTimers.push(id);
        });
      for (const s of shells) {
        throwFoam(mix32(s.seed, 3), s.nx, beachY(s, tide), 5, {
          spread: 0.02, rise: 0.045, drift: 0.02, size: 3.6, decay: 0.9, tint: 0,
        });
      }
      haptics.roll();
    };

    // ——— the vessel ———
    let breathStop: (() => void) | null = null;
    const armBreath = async () => {
      if (breathStop) return;
      const stop = await enableBreath({
        breath: ({ strength }) => {
          // breath is offshore wind: it holds the wave faces up and
          // combs spray back off the crests
          breathWind = clamp(breathWind + strength * 0.35, 0, 1.4);
          lastTouchAt = performance.now();
        },
      });
      if (stop) breathStop = stop;
    };

    const detachVessel = onVessel({
      tilt: ({ gamma, beta }) => {
        if (reduced || asleep) return;
        tiltX = clamp(gamma / 45, -1, 1);
        tiltY = clamp((beta - 45) / 60, -1, 1);
        moon = clamp01(0.5 + (beta - 35) / 90);
      },
      shake: ({ intensity }) => {
        if (reduced || asleep) return;
        spray = Math.min(1, spray + intensity);
        const tide = tideNow();
        throwFoam(mix32(Date.now() & 0xffff, 1), 0.5 + tiltX * 0.1, tide, Math.floor(20 * intensity) + 6, {
          spread: 0.4, rise: 0.14, drift: 0.12, size: 5.5, decay: 0.5, tint: 0,
        });
        pulse[1] = Math.min(1, pulse[1] + intensity);
        voice.breakWave(intensity);
        haptics.chop();
        audio.buzz();
      },
      knock: ({ intensity }) => {
        // a rap on the case is a rap on the room's door: a set arrives
        if (asleep) return;
        lastTouchAt = performance.now();
        const tide = tideNow();
        for (let i = 0; i < 7; i++) {
          throwFoam(mix32(i, Math.round(simT * 100)), (i + 0.5) / 7, tide - 0.01, 8, {
            spread: 0.09, rise: 0.10 + intensity * 0.08, drift: 0.05, size: 5.4, decay: 0.55, tint: 0,
          });
        }
        pulse[1] = 1;
        pulse[2] = Math.min(1, pulse[2] + 0.6);
        voice.breakWave(0.55 + intensity * 0.45);
        voice.say(zoneVoice("sea", 0.5, clamp01(0.4 + intensity * 0.6)));
        haptics.roll();
      },
      flip: ({ faceDown }) => {
        night = faceDown;
        if (faceDown) {
          wind = 0;
          spray *= 0.2;
          haptics.roll();
        }
      },
    });

    // ——— the grammar ———
    const markLens = (raised: boolean) => {
      if (raised) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    const hold = {
      zone: "dry" as CoastZone,
      shellId: null as string | null,
      created: null as string | null,
      taken: false,
      lastTickAt: 0,
      x: 0,
      y: 0,
      gather: 0,
    };

    const detachGestures = attachGestures(
      wrap,
      {
        tap: (e) => {
          lastTouchAt = performance.now();
          voice.ensure();
          if (e.fingers === 3) {
            // three fingers on the law: everything alive answers at once
            tutti(0.5 + e.intensity * 0.7);
            return;
          }
          if (e.fingers === 2) {
            // step back: lower a raised lens, else return the frame home
            if (lensTarget > 0.02) {
              lensTarget = Math.max(0, Math.round(lensTarget) - 1);
              lensAcc = 0;
              markLens(lensTarget >= 0.5);
              haptics.lens();
              voice.say(zoneVoice("sea", 0.5, 0.3));
            } else if (Math.abs(panTarget.x) > 0.002 || Math.abs(panTarget.y) > 0.002) {
              panTarget.x = 0;
              panTarget.y = 0;
              haptics.detent();
            }
            return;
          }
          const { x, y } = toLocal(e.x, e.y);
          const nx = x / Math.max(1, width);
          const ny = y / Math.max(1, height);
          const tideForTap = tideNow();
          // a shell under the finger rings instead of the sand around it;
          // a double tap on it presses it in deeper, the ceremony a hold
          // already owns for taking it back
          const s = shellAt(nx, ny);
          if (s) {
            const shellGain = 0.55 + e.intensity * 0.45 + tapTrainDepth(e.count) * 0.35;
            voice.say(zoneVoice(zoneAt(nx, beachY(s, tideForTap), tideForTap), 0.25, shellGain));
            throwFoam(mix32(s.seed, e.x), s.nx, beachY(s, tideForTap), Math.round(8 + tapTrainDepth(e.count) * 10), {
              spread: 0.02, rise: 0.06, drift: 0.03, size: 4.0, decay: 0.9, tint: 0,
            });
            addTouch(s.nx, beachY(s, tideForTap), "wet", 0.5 + e.intensity * 0.45 + tapTrainDepth(e.count) * 0.3);
            haptics.ripple(0.4 + tapTrainDepth(e.count) * 0.25);
            if (e.count === 2) {
              // pressed home: a firmer mark, and the sand round it settles
              addMark(s.nx, beachY(s, tideForTap), 0.05 + e.intensity * 0.02, 0, 0.05);
              audio.spark();
              haptics.tap();
            }
            return;
          }

          const zone = zoneAt(nx, ny, tideForTap);

          // double tap on open ground: what it means depends on which of
          // the five materials it lands on
          if (e.count === 2) {
            const power = clamp01(0.45 + e.intensity * 0.5);
            if (zone === "sea") {
              // the surf: a real breaker, raised where the hand struck it
              raiseBreaker(nx, power);
              return;
            }
            if (zone === "wet") {
              // wet sand: a shallow tide pool opens and holds water
              tidePools.push({ nx, ny, r: 0.03 + power * 0.02, t0: simT });
              if (tidePools.length > MAX_TIDE_POOLS) tidePools.shift();
              addMark(nx, ny, 0.045, 0, 0.02);
              throwFoam(mix32(Math.round(nx * 4096), Math.round(simT * 10)), nx, ny, 10, {
                spread: 0.03, rise: 0.03, drift: 0.02, size: 4.2, decay: 0.5, tint: 0,
              });
              voice.say(zoneVoice("wet", 0.15, 0.6 + e.intensity * 0.3));
              audio.bell();
              haptics.ripple(0.5);
              return;
            }
            if (zone === "dune") {
              // the dune: whatever is nesting there is flushed downhill
              let flushed = 0;
              for (const shell of shells) {
                if (zoneAt(shell.nx, beachY(shell, tideForTap), tideForTap) !== "dune") continue;
                if (Math.abs(shell.nx - nx) > 0.14) continue;
                shell.ny = clamp(tideForTap + WET_BAND * 0.6, tideForTap + 0.02, 0.97);
                writer.schedule();
                flushed++;
              }
              throwFoam(mix32(Math.round(nx * 4096), 7), nx, ny, 14, {
                spread: 0.06, rise: 0.05, drift: 0.08, size: 3.8, decay: 0.5, tint: 2,
              });
              addMark(nx, ny, 0.06, 2, 0.3);
              voice.say(zoneVoice("dune", 0.3, 0.5 + (flushed ? 0.4 : 0)));
              audio.spark();
              haptics.chop();
              return;
            }
            if (zone === "dry") {
              // dry sand: the wind kicks a ridge of it into the air
              wind = clamp(wind + (nx < 0.5 ? -1 : 1) * 0.3, -1, 1);
              throwFoam(mix32(Math.round(nx * 4096), 9), nx, ny, 16, {
                spread: 0.07, rise: 0.07, drift: 0.09, size: 4.6, decay: 0.6, tint: 1,
              });
              addMark(nx, ny, 0.05, 1, 0.15);
              voice.say(zoneVoice("dry", 0.4, 0.55 + e.intensity * 0.3));
              haptics.tap();
              return;
            }
            // sky: gulls startle off the wind
            throwFoam(mix32(Math.round(nx * 4096), 11), nx, ny, 12, {
              spread: 0.08, rise: 0.1, drift: 0.05, size: 4.2, decay: 0.3, tint: 0,
            });
            voice.say(zoneVoice("sky", 0.4, 0.55));
            haptics.tap();
            return;
          }

          // rapid-tap ladder: print → break → rogue set → shore tutti
          const tier = tapTrainTier(e.count);
          const depth = tapTrainDepth(e.count);
          if (tier === "n") {
            // the largest event the shore has: a rogue set on top of tutti —
            // three big waves stacked into one crossing swell
            tutti(0.75 + e.intensity * 0.4 + depth * 0.25);
            raiseBreaker(clamp(nx - 0.14, 0.06, 0.94), 0.9 + depth * 0.1);
            raiseBreaker(nx, 1);
            raiseBreaker(clamp(nx + 0.14, 0.06, 0.94), 0.9 + depth * 0.1);
            answer(nx, ny, e.intensity, 2.4 + depth);
            return;
          }
          if (tier === 5) {
            voice.breakWave(0.55 + e.intensity * 0.4 + depth * 0.2);
            raiseBreaker(clamp(nx - 0.1, 0.06, 0.94), 0.75 + depth * 0.2);
            raiseBreaker(clamp(nx + 0.1, 0.06, 0.94), 0.75 + depth * 0.2);
            answer(nx, ny, e.intensity, 2.0 + depth * 0.5);
            return;
          }
          if (tier === 3) {
            // triple tap: a rogue set — three big waves that rearrange the
            // beach and can bury or uncover shells, the shore's biggest
            // reachable event short of the full tutti above
            raiseBreaker(clamp(nx - 0.13, 0.06, 0.94), 0.55 + depth * 0.25);
            raiseBreaker(nx, 0.7 + depth * 0.3);
            raiseBreaker(clamp(nx + 0.13, 0.06, 0.94), 0.55 + depth * 0.25);
            answer(nx, ny, e.intensity, 1.55 + depth * 0.45);
            return;
          }
          answer(nx, ny, e.intensity, 1 + depth * 0.35);
        },

        hold: (e) => {
          lastTouchAt = performance.now();
          voice.ensure();
          if (e.fingers === 3) {
            // three fingers on the law: time dilates while held, and keeps
            // dilating — it is never done at 900ms
            if (e.phase === "release") {
              timeScaleTarget = 1;
              haptics.detent();
              return;
            }
            timeScaleTarget = clamp(1 - Math.min(1, e.elapsed / 3200) * 0.88, 0.12, 1);
            const now = performance.now();
            if (now - hold.lastTickAt > 420) {
              hold.lastTickAt = now;
              voice.say(zoneVoice("dune", 0.5, clamp01(0.2 + (1 - timeScaleTarget) * 0.7)));
              haptics.tap();
            }
            return;
          }
          if (e.fingers === 2) {
            // two fingers held is the navigator's word, not the shore's
            return;
          }

          const { x, y } = toLocal(e.x, e.y);
          const nx = x / Math.max(1, width);
          const ny = y / Math.max(1, height);
          const tide = tideNow();

          if (e.phase === "enter" && hold.shellId === null && hold.created === null) {
            const s = shellAt(nx, ny);
            hold.shellId = s ? s.id : null;
            hold.taken = false;
            hold.zone = zoneAt(nx, ny, tide);
            hold.gather = 0;
            if (shouldInvite("vessel")) void requestVessel();
          }
          hold.x = nx;
          hold.y = ny;

          if (e.phase === "release") {
            if (hold.created) writer.schedule();
            hold.shellId = null;
            hold.created = null;
            hold.gather = 0;
            hold.taken = false;
            return;
          }

          const now = performance.now();

          if (hold.shellId) {
            // pressing on something the shore already keeps: the swash
            // gathers round it, and at the ceremony the sea takes it back
            const s = shells.find((q) => q.id === hold.shellId);
            if (!s || hold.taken) return;
            hold.gather = clamp01((e.elapsed - 250) / 2250);
            if (now - hold.lastTickAt > 260) {
              hold.lastTickAt = now;
              throwFoam(mix32(s.seed, Math.round(e.elapsed)), s.nx, beachY(s, tide), 4, {
                spread: 0.02 + hold.gather * 0.03, rise: 0.03 + hold.gather * 0.07,
                drift: 0.02, size: 3.4 + hold.gather * 3, decay: 0.9, tint: 0,
              });
              voice.say(zoneVoice("wet", 1 - hold.gather, 0.2 + hold.gather * 0.6));
              haptics.tap();
            }
            if (e.tier >= 3) {
              hold.taken = true;
              hold.shellId = null;
              takeShell(s);
              if (shouldInvite("breath")) void armBreath();
            }
            return;
          }

          // empty ground. From the first tier something gathers under the
          // finger; at the dwell tier it has become a thing; past that it
          // keeps deepening until the shore is asked for its whole answer.
          hold.gather = clamp01((e.elapsed - 250) / 650);
          if (!hold.created && e.tier >= 2) {
            const made = plantShell(nx, ny);
            hold.created = made ? made.id : null;
            hold.zone = zoneAt(nx, ny, tide);
          }
          if (now - hold.lastTickAt > 240) {
            hold.lastTickAt = now;
            const deep = clamp01((e.elapsed - 250) / 2250);
            const zone = zoneAt(nx, ny, tide);
            voice.say(zoneVoice(zone, 1 - deep, 0.15 + deep * 0.7));
            throwFoam(mix32(Math.round(nx * 4096), Math.round(e.elapsed)), nx, ny, 3, {
              spread: 0.012 + deep * 0.02, rise: 0.02 + deep * 0.05, drift: 0.015,
              size: 3.0 + deep * 3.5, decay: 1.0, tint: zone === "sea" || zone === "wet" ? 0 : 1,
            });
            haptics.tap();
          }
          if (hold.created && e.tier >= 3) {
            // the ceremony on a thing you just made: the shore keeps it,
            // pressed deep into the sand
            const s = shells.find((q) => q.id === hold.created);
            if (s && !hold.taken) {
              hold.taken = true;
              addMark(s.nx, beachY(s, tide), 0.06, 0, 0.06);
              audio.bell();
              haptics.bloom();
            }
          }
        },

        drag: (e) => {
          lastTouchAt = performance.now();
          const { x, y } = toLocal(e.x, e.y);
          if (e.fingers === 3) {
            // three fingers on the law: the wind
            wind = clamp(wind + e.dx * 0.0025, -1, 1);
            if (Math.abs(e.vx) > 0.3 && performance.now() - hold.lastTickAt > 420) {
              hold.lastTickAt = performance.now();
              voice.say(zoneVoice("dune", 0.5, clamp01(Math.abs(wind))));
              haptics.chop();
            }
            return;
          }
          if (e.fingers !== 1 || e.phase === "end") return;
          const nx = x / Math.max(1, width);
          const ny = y / Math.max(1, height);
          const tide = tideNow();
          const zone = zoneAt(nx, ny, tide);
          const kind = zone === "sea" ? 3 : zone === "wet" ? 0 : zone === "dune" ? 2 : 1;
          addGroove((x - e.dx) / Math.max(1, width), (y - e.dy) / Math.max(1, height), nx, ny, kind);
          const speed = Math.hypot(e.vx, e.vy);
          const now = performance.now();
          if (now - hold.lastTickAt > 110) {
            hold.lastTickAt = now;
            const seed = mix32(Math.round(nx * 4096), Math.round(ny * 4096), now & 0xffff);
            if (zone === "sea") {
              // a hand through the water leaves a wake behind it
              throwFoam(seed, nx, ny, 5, {
                spread: 0.02, rise: 0.03 + speed * 0.02, drift: 0.05, size: 4.6, decay: 0.9, tint: 0,
              });
            } else if (zone === "wet") {
              // a channel in the soaked sand; water runs into it
              throwFoam(seed, nx, ny, 3, {
                spread: 0.012, rise: 0.02, drift: 0.02, size: 3.4, decay: 1.4, tint: 0,
              });
            } else if (zone === "dry") {
              // loose sand crumbles back into the furrow
              throwFoam(seed, nx, ny, 4, {
                spread: 0.02, rise: 0.025 + speed * 0.02, drift: 0.04, size: 4.0, decay: 1.1, tint: 1,
              });
            } else if (zone === "dune") {
              throwFoam(seed, nx, ny, 3, {
                spread: 0.03, rise: 0.02, drift: 0.03, size: 3.2, decay: 0.9, tint: 2,
              });
            } else {
              throwFoam(seed, nx, ny, 2, {
                spread: 0.04, rise: 0.05, drift: 0.02, size: 4.6, decay: 0.35, tint: 0,
              });
            }
            if (speed > 0.25) {
              voice.say(zoneVoice(zone, zoneDepth(nx, ny, tide), clamp01(0.12 + speed * 0.25)));
              haptics.tap();
            }
          }
        },

        flick: (e) => {
          lastTouchAt = performance.now();
          const { x, y } = toLocal(e.x, e.y);
          const nx = x / Math.max(1, width);
          const ny = y / Math.max(1, height);
          const tide = tideNow();
          const zone = zoneAt(nx, ny, tide);
          const speed = clamp(e.speed, 0.6, 3);
          const s = shellAt(nx, ny);
          if (s) {
            // throw it along the beach — it lands where it lands
            const nxt = clamp(s.nx + Math.cos(e.angle) * 0.06 * speed, 0.03, 0.97);
            const nyt = clamp(beachY(s, tide) + Math.sin(e.angle) * 0.03 * speed, tide + 0.02, 0.97);
            s.nx = nxt;
            s.ny = nyt;
            writer.schedule();
            throwFoam(mix32(s.seed, 11), nxt, nyt, 8, {
              spread: 0.02, rise: 0.05, drift: 0.05, size: 4.2, decay: 0.9,
              tint: zoneAt(nxt, nyt, tide) === "wet" ? 0 : 1,
            });
            voice.say(zoneVoice(zoneAt(nxt, nyt, tide), 0.3, clamp01(0.3 + speed * 0.2)));
            haptics.ripple(0.4);
            return;
          }
          const seed = mix32(Math.round(nx * 4096), Math.round(ny * 4096), 5);
          const dirX = Math.cos(e.angle) * 0.08 * speed;
          const rise = zone === "sea" ? 0.20 : zone === "dry" ? 0.13 : 0.09;
          throwFoam(seed, nx, ny, Math.round(14 + speed * 8), {
            spread: 0.03, rise: rise * speed * 0.6, drift: Math.abs(dirX) + 0.04,
            size: zone === "sea" ? 6.2 : 5.0, decay: 0.55,
            tint: zone === "sea" || zone === "wet" ? 0 : zone === "dune" ? 2 : 1,
          });
          wind = clamp(wind + dirX * 1.2, -1, 1);
          answer(nx, ny, clamp01(0.3 + speed * 0.25), 1.2);
        },

        twist: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            // three fingers on the law: the shore's own year turns.
            // Storm beach ↔ summer berm, the sand going offshore and back.
            if (e.phase === "move") {
              season += e.angle / (Math.PI * 2) * 0.5;
              seasonAcc += e.angle;
              if (Math.abs(seasonAcc) > 0.8) {
                seasonAcc = 0;
                const p = seasonProfile(season);
                voice.say(zoneVoice("dune", 1 - p.warmth, 0.3 + p.swell * 0.4));
                haptics.detent();
              }
            }
            return;
          }
          // two fingers on the map: the lens turns.
          // shore as seen → the wave mechanics → the felt weather
          if (e.phase === "move") {
            lensTarget = clamp(lensTarget + e.angle / 1.9, 0, 2);
            lensAcc += Math.abs(e.angle);
            if (lensAcc > 0.55) {
              lensAcc = 0;
              haptics.tap();
            }
          } else if (e.phase === "end") {
            lensTarget = Math.round(lensTarget);
            lensAcc = 0;
            markLens(lensTarget >= 0.5);
            haptics.lens();
            voice.say(zoneVoice(lensTarget >= 1.5 ? "sky" : lensTarget >= 0.5 ? "sea" : "wet", 0.5, 0.35));
          }
        },

        pan2: (e) => {
          // two fingers on the map: pan the frame. Sideways walks the beach,
          // up and down changes the vantage.
          lastTouchAt = performance.now();
          if (e.phase !== "move") return;
          panTarget.x = clamp(panTarget.x - e.dx / Math.max(1, width) * 0.9, -0.3, 0.3);
          panTarget.y = clamp(panTarget.y - e.dy / Math.max(1, height) * 0.35, -0.1, 0.1);
        },

        scrub: (e) => {
          lastTouchAt = performance.now();
          const { x, y } = toLocal(e.cx, e.cy);
          const nx = x / Math.max(1, width);
          const ny = y / Math.max(1, height);
          const tide = tideNow();
          const zone = zoneAt(nx, ny, tide);
          const mag = clamp01(Math.abs(e.winding) * 0.5);
          if (zone === "sea" || zone === "sky") {
            // circling the water stirs a gyre; the swell answers
            wind = clamp(wind + Math.sign(e.winding) * 0.12, -1, 1);
            throwFoam(mix32(3, foam.length), nx, ny, 14, {
              spread: 0.07, rise: 0.08, drift: 0.06, size: 5.4, decay: 0.6, tint: 0,
            });
          } else {
            // circling the sand digs a bowl, and it fills
            addMark(nx, ny, 0.07 + mag * 0.05, zone === "dune" ? 2 : zone === "wet" ? 0 : 1, 0.05);
            throwFoam(mix32(4, foam.length), nx, ny, 12, {
              spread: 0.06, rise: 0.05, drift: 0.05, size: 4.6, decay: 0.8,
              tint: zone === "wet" ? 0 : zone === "dune" ? 2 : 1,
            });
          }
          voice.say(zoneVoice(zone, zoneDepth(nx, ny, tide), 0.3 + mag * 0.5));
          pulse[zoneIndex(zone)] = Math.min(1, pulse[zoneIndex(zone)] + 0.4);
          haptics.ripple(0.35 + mag * 0.4);
        },

        rhythm: (e) => {
          // a steady tapped pulse: the surf's own sets fall in with the
          // hand's tempo for a while — four beats to a swell, so a slow
          // pulse stretches the sets long and a quick one crowds them in
          if (e.stability <= 0.7) return;
          lastTouchAt = performance.now();
          entrainPeriod = clamp((60 / e.bpm) * 4, 3, 14);
          entrainUntil = performance.now() + 12000;
          voice.breakWave(clamp01(0.3 + e.stability * 0.3));
          pulse[1] = Math.min(1, pulse[1] + 0.4);
          haptics.tap();
        },

        drum: (e) => {
          // two alternating hands play the space between them: foam leaps
          // the span, both zones pulse, and each strike answers in the
          // register of the side it landed on
          lastTouchAt = performance.now();
          voice.ensure();
          const a = toLocal(e.ax, e.ay);
          const b = toLocal(e.bx, e.by);
          const tide = tideNow();
          const anx = a.x / Math.max(1, width);
          const any = a.y / Math.max(1, height);
          const bnx = b.x / Math.max(1, width);
          const bny = b.y / Math.max(1, height);
          const za = zoneAt(anx, any, tide);
          const zb = zoneAt(bnx, bny, tide);
          const lift = clamp01(e.alternation) * Math.min(1, e.hits / 6);
          const midx = (anx + bnx) / 2;
          const midy = (any + bny) / 2;
          const midZone = zoneAt(midx, midy, tide);
          throwFoam(mix32(e.hits, Math.round(midx * 4096), Math.round(midy * 4096)), midx, midy, Math.round(6 + lift * 10), {
            spread: Math.abs(anx - bnx) * 0.5 + 0.02, rise: 0.05 + lift * 0.06, drift: 0.04,
            size: 4.6, decay: 0.6, tint: midZone === "sea" || midZone === "wet" ? 0 : 1,
          });
          voice.say(zoneVoice(e.hits % 2 === 0 ? za : zb, 0.4, 0.25 + lift * 0.45));
          pulse[zoneIndex(za)] = Math.min(1, pulse[zoneIndex(za)] + 0.2 + lift * 0.2);
          pulse[zoneIndex(zb)] = Math.min(1, pulse[zoneIndex(zb)] + 0.2 + lift * 0.2);
          haptics.ripple(0.3 + lift * 0.4);
        },
      },
      { wheelZoom: false },
    );

    // ——— the loop ———
    const drawFallbackGround = (tide: number, surf: number, detail: { samples: number }) => {
      // the guarded 2D path, kept for anything without GL: the same shore,
      // painted flat.
      const sky = ctx.createLinearGradient(0, 0, 0, height * tide);
      sky.addColorStop(0, "#6f9fc6");
      sky.addColorStop(1, "#cfe3f0");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height * tide + 2);

      const sea = ctx.createLinearGradient(0, height * (tide - SEA_BAND), 0, height * tide);
      sea.addColorStop(0, "rgba(18,56,92,0.95)");
      sea.addColorStop(1, "rgba(70,140,150,0.95)");
      ctx.fillStyle = sea;
      ctx.beginPath();
      ctx.moveTo(0, height * (tide - SEA_BAND));
      for (let x = 0; x <= width; x += 8) {
        const nx = x / Math.max(1, width);
        const yy =
          tide + (surf - 0.5) * 0.045 +
          (Math.sin(nx * 9 + simT * 1.4 + tiltX) * 0.012 + Math.sin(nx * 21 + simT * 2.1) * 0.005);
        ctx.lineTo(x, yy * height);
      }
      ctx.lineTo(width, height * (tide - SEA_BAND));
      ctx.closePath();
      ctx.fill();

      const step = Math.max(2, Math.floor(4 / Math.max(0.25, detail.samples)));
      for (let y = Math.floor(height * tide); y < height; y += step) {
        const ny = y / Math.max(1, height);
        const wet = sandWetness(ny, tide, surf);
        const shade = 205 - wet * 90 - (ny - tide) * 30;
        ctx.fillStyle = `rgb(${shade}, ${shade - 18}, ${shade - 44})`;
        ctx.fillRect(0, y, width, step);
      }

      ctx.fillStyle = "rgba(150,140,105,0.75)";
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += 12) {
        ctx.lineTo(x, duneLine(x / Math.max(1, width), tide) * height);
      }
      ctx.lineTo(width, height);
      ctx.fill();
    };

    const drawNatural = (n: WorldNatural, px: number, py: number, alpha: number, scale: number) => {
      const st = styleFor(n);
      const r = st.r * scale;
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(st.rot);
      switch (n.kind) {
        case "kelp":
          ctx.strokeStyle = `hsla(${90 + st.a * 30}, 32%, 26%, 0.85)`;
          ctx.lineWidth = 2.2 * scale;
          ctx.beginPath();
          ctx.moveTo(-r * 1.8, 0);
          ctx.quadraticCurveTo(0, -r * 1.1, r * 1.8, r * 0.3);
          ctx.stroke();
          break;
        case "driftwood":
          ctx.fillStyle = `hsla(${28 + st.a * 12}, 20%, ${38 + st.b * 14}%, 0.9)`;
          ctx.fillRect(-r * 2.2, -r * 0.35, r * 4.4, r * 0.7);
          break;
        case "starfish": {
          ctx.fillStyle = `hsla(${12 + st.a * 16}, 55%, ${52 + st.b * 12}%, 0.9)`;
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const rr = i % 2 === 0 ? r * 1.5 : r * 0.6;
            const fx = Math.cos(a) * rr;
            const fy = Math.sin(a) * rr;
            if (i === 0) ctx.moveTo(fx, fy);
            else ctx.lineTo(fx, fy);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "sanddollar":
          ctx.fillStyle = `hsla(42, 22%, ${76 + st.a * 10}%, 0.92)`;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(120,105,80,0.5)";
          ctx.lineWidth = 1;
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
            ctx.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
            ctx.stroke();
          }
          break;
        default: {
          // a scallop: a fan with ribs
          ctx.fillStyle = `hsla(${st.hue}, 38%, ${64 + st.a * 18}%, 0.92)`;
          ctx.beginPath();
          ctx.ellipse(0, 0, r * 1.25, r * 0.85, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(120,96,64,0.42)";
          ctx.lineWidth = 0.9;
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(0, r * 0.72);
            ctx.lineTo(i * r * 0.45, -r * 0.7);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    const draw = (now: number) => {
      if (!running) return;
      const dtReal = Math.min(0.05, (now - last) / 1000);
      last = now;
      tier = gov.beginFrame(now);
      const detail = detailForTier(tier);

      // hidden or paused: nothing is drawn at all, not a cheaper frame
      if (asleep) {
        raf = requestAnimationFrame(draw);
        return;
      }

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dtReal * 6);
      const dt = dtReal * timeScale;
      simT += reduced ? dt * 0.25 : dt;

      // the room's own slow cycle keeps turning even with no hand on it
      if (!asleep) season += (dtReal * 1000) / SEASON_MS;
      const seasonP = seasonProfile(season);
      const tide = tideNow();
      const surf = surfNow();

      wind *= Math.pow(0.985, dtReal * 60);
      breathWind *= Math.pow(0.97, dtReal * 60);
      spray *= Math.pow(0.96, dtReal * 60);
      lens += (lensTarget - lens) * Math.min(1, dtReal * 5);
      pan.x += (panTarget.x - pan.x) * Math.min(1, dtReal * 5);
      pan.y += (panTarget.y - pan.y) * Math.min(1, dtReal * 5);
      for (let i = 0; i < pulse.length; i++) pulse[i] *= Math.pow(0.93, dtReal * 60);

      const windTotal = clamp(wind + tiltX * 0.3 + breathWind * 0.6, -1.6, 1.6);

      // the shore's voice: it breathes on the tide phase whether or not a
      // hand is on it, and a set breaking is heard before it is seen
      if (now - lastBreatheAt > 120) {
        lastBreatheAt = now;
        voice.breathe(surf, tide, windTotal, !asleep && !night);
      }
      if (!asleep && !night && surf > 0.82 && prevSurf <= 0.82) {
        voice.breakWave(0.35 + seasonP.swell * 0.5);
        // and the sea throws a line of foam up the beach
        for (let i = 0; i < 5; i++) {
          throwFoam(mix32(i, Math.round(simT)), (i + 0.5) / 5 + (mulberry32(mix32(i, Math.round(simT)))() - 0.5) * 0.1, tide - 0.005, 4, {
            spread: 0.08, rise: 0.05 + seasonP.swell * 0.05, drift: 0.03, size: 4.8, decay: 0.6, tint: 0,
          });
        }
        pulse[1] = Math.min(1, pulse[1] + 0.35);
        pulse[2] = Math.min(1, pulse[2] + 0.25);
      }
      prevSurf = surf;

      if (!asleep) {
        stepFoam(foam, dt, windTotal, 0.11);
        capFoam(foam, Math.floor(MAX_FOAM * detail.particles));
        // marks and grooves erode; anything the swash reaches goes faster
        for (let i = marks.length - 1; i >= 0; i--) {
          const m = marks[i];
          const soaked = sandWetness(m.y, tide, surf);
          m.life -= dt * m.decay * (1 + soaked * 2.5);
          if (m.life <= 0) marks.splice(i, 1);
        }
        for (let i = 0; i < GROOVE_MAX; i++) {
          const j = i * GROOVE_STRIDE;
          if (grooves[j + 4] <= 0) continue;
          const soaked = sandWetness(grooves[j + 3], tide, surf);
          grooves[j + 4] -= dt * (0.12 + soaked * 0.45);
        }
        for (let i = departing.length - 1; i >= 0; i--) {
          if (now - departing[i].t0 > departing[i].dur) departing.splice(i, 1);
        }

        // ——— breakers: real swash moving real sand and real shells ———
        if (breakers.length) {
          for (let i = breakers.length - 1; i >= 0; i--) {
            const b = breakers[i];
            const age = simT - b.t0;
            if (age > breakerLifeSec(b.power)) { breakers.splice(i, 1); continue; }
            const runup = breakerRunup(age, b.power);
            applyBreakerToProfile(sandProfile, b.nx, b.spread, b.power, runup, dt, 0.045);
            // the swash carries anything it reaches: onshore on the rise,
            // a weaker drag back on the drain — net onshore, like real surf
            const rising = age < 0.30 + b.power * 0.16;
            const carry = (rising ? 1 : -0.35) * runup * dt * (0.05 + b.power * 0.05);
            for (const s of shells) {
              const dx = s.nx - b.nx;
              const lateral = Math.exp(-(dx * dx) / (2 * b.spread * b.spread));
              if (lateral < 0.05) continue;
              const sy = beachY(s, tide);
              if (sy < tide - 0.01) continue; // only the beach, not the open sea
              s.ny = clamp(sy + carry * lateral, tide + 0.008, 0.985);
              s.nx = clamp(s.nx + (mulberry32(mix32(s.seed, i))() - 0.5) * lateral * dt * 0.06, 0.02, 0.98);
              writer.schedule();
            }
          }
        }
        relaxSandProfile(sandProfile, dt, 140);

        // tide pools slowly drain back into the sand
        for (let i = tidePools.length - 1; i >= 0; i--) {
          if (simT - tidePools[i].t0 > 22) tidePools.splice(i, 1);
        }
      }

      // ——— the field, in a shader ———
      if (gl && bits) {
        gl.useProgram(bits.prog);
        const u = bits.u;
        if (u.uTime) gl.uniform1f(u.uTime, simT);
        if (u.uRes) gl.uniform2f(u.uRes, glCanvas.width, glCanvas.height);
        if (u.uTide) gl.uniform1f(u.uTide, tide);
        if (u.uWind) gl.uniform1f(u.uWind, windTotal);
        if (u.uTilt) gl.uniform2f(u.uTilt, tiltX, tiltY);
        if (u.uSurf) gl.uniform1f(u.uSurf, surf);
        if (u.uLens) gl.uniform1f(u.uLens, lens);
        if (u.uPan) gl.uniform2f(u.uPan, pan.x, pan.y);
        if (u.uSeason) gl.uniform4f(u.uSeason, seasonP.berm, seasonP.swell, seasonP.grass, night ? 0.05 : seasonP.warmth);
        if (u.uPulse) gl.uniform4f(u.uPulse, pulse[0], pulse[1], pulse[2], pulse[3]);
        if (u.uPulseDune) gl.uniform1f(u.uPulseDune, pulse[4]);
        if (u.uDetail) gl.uniform1f(u.uDetail, detail.samples);
        if (u.uTouch && u.uTouchCount) {
          let count = 0;
          for (let i = touches.length - 1; i >= 0 && count < MAX_TOUCH; i--) {
            const tc = touches[i];
            const age = (now - tc.t0) / 1000;
            if (age > 1.8) continue;
            touchBuf[count * 4] = tc.x;
            touchBuf[count * 4 + 1] = tc.y;
            touchBuf[count * 4 + 2] = age;
            touchBuf[count * 4 + 3] = tc.z + tc.s;
            count++;
          }
          for (let i = count * 4; i < touchBuf.length; i++) touchBuf[i] = 0;
          gl.uniform4fv(u.uTouch, touchBuf);
          gl.uniform1i(u.uTouchCount, count);
        }
        if (u.uSandProfile) gl.uniform1fv(u.uSandProfile, sandProfile);
        if (u.uBreak && u.uBreakCount) {
          let bc = 0;
          for (let i = 0; i < breakers.length && bc < 3; i++) {
            const b = breakers[i];
            const age = simT - b.t0;
            breakUniform[bc * 4] = b.nx;
            breakUniform[bc * 4 + 1] = b.spread;
            breakUniform[bc * 4 + 2] = b.power;
            breakUniform[bc * 4 + 3] = breakerRunup(age, b.power);
            bc++;
          }
          for (let i = bc * 4; i < breakUniform.length; i++) breakUniform[i] = 0;
          gl.uniform4fv(u.uBreak, breakUniform);
          gl.uniform1i(u.uBreakCount, bc);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      // ——— everything the shader does not own ———
      ctx.clearRect(0, 0, width, height);
      if (!gl || !bits) drawFallbackGround(tide, surf, detail);

      // grooves: what a finger dragged, coloured by what it dragged through
      ctx.lineCap = "round";
      for (let i = 0; i < GROOVE_MAX; i++) {
        const j = i * GROOVE_STRIDE;
        const life = grooves[j + 4];
        if (life <= 0) continue;
        const kind = grooves[j + 5];
        ctx.globalAlpha = Math.min(1, life) * 0.8;
        ctx.lineWidth = kind === 3 ? 3.4 : kind === 0 ? 3.0 : 2.2;
        ctx.strokeStyle =
          kind === 3 ? "rgba(240,250,255,0.7)"
          : kind === 0 ? "rgba(48,40,30,0.75)"
          : kind === 2 ? "rgba(96,112,62,0.7)"
          : "rgba(140,120,84,0.65)";
        ctx.beginPath();
        ctx.moveTo(grooves[j] * width, grooves[j + 1] * height);
        ctx.lineTo(grooves[j + 2] * width, grooves[j + 3] * height);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // marks: prints, craters, bent grass, wakes, wisps
      for (const m of marks) {
        const px = m.x * width;
        const py = m.y * height;
        const rr = m.r * Math.max(width, height) * (0.6 + m.life * 0.5);
        ctx.globalAlpha = Math.min(1, m.life);
        if (m.kind === 0) {
          ctx.fillStyle = "rgba(38,32,24,0.42)";
          ctx.beginPath();
          ctx.ellipse(px, py, rr, rr * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(232,244,250,0.55)";
          ctx.lineWidth = 1.6;
          ctx.stroke();
        } else if (m.kind === 1) {
          ctx.fillStyle = "rgba(118,100,68,0.30)";
          ctx.beginPath();
          ctx.ellipse(px, py, rr, rr * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(246,236,208,0.45)";
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else if (m.kind === 2) {
          ctx.strokeStyle = "rgba(120,140,74,0.55)";
          ctx.lineWidth = 1.4;
          for (let i = -3; i <= 3; i++) {
            ctx.beginPath();
            ctx.moveTo(px + i * rr * 0.22, py + rr * 0.3);
            ctx.lineTo(px + i * rr * 0.22 + Math.sin(m.ang + i) * rr * 0.4, py - rr * 0.8);
            ctx.stroke();
          }
        } else if (m.kind === 3) {
          ctx.strokeStyle = "rgba(255,255,255,0.55)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(px, py, rr * (1.4 - m.life * 0.4), rr * 0.35, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeStyle = "rgba(255,252,240,0.4)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(px + windTotal * 20 * (1 - m.life), py, rr * 1.2, rr * 0.25, 0.1, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // the gather under a held finger — creation legible while it happens
      if (hold.gather > 0.001) {
        const gx = hold.x * width;
        const gy = hold.y * height;
        const gr = 6 + hold.gather * 34;
        ctx.globalAlpha = 0.25 + hold.gather * 0.5;
        ctx.strokeStyle = hold.shellId ? "rgba(226,244,252,0.9)" : "rgba(252,242,214,0.9)";
        ctx.lineWidth = 1 + hold.gather * 2.5;
        ctx.beginPath();
        ctx.arc(gx, gy, gr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(gx, gy, gr * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = hold.shellId ? "rgba(214,238,250,0.35)" : "rgba(226,206,158,0.5)";
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // tide pools opened by a double tap on wet sand: a held patch that
      // mirrors the sky and slowly drains, drawn from the shared sprite
      const poolSprite = SPRITES[0];
      if (poolSprite) {
        for (const pool of tidePools) {
          const age = simT - pool.t0;
          const life = clamp01(1 - age / 22);
          const r = (pool.r + 0.01) * Math.min(width, height) * (0.6 + 0.4 * life);
          ctx.globalAlpha = 0.22 * life;
          ctx.drawImage(poolSprite, pool.nx * width - r, pool.ny * height - r * 0.55, r * 2, r * 1.1);
        }
        ctx.globalAlpha = 1;
      }

      // what the shore keeps — a shell sitting where a rogue set has piled
      // sand reads as buried: the same profile the breaker actually left,
      // never a separate flag
      for (const s of shells) {
        const buried = clamp01(sandProfileAt(sandProfile, s.nx) / SAND_PROFILE_MAX);
        drawNatural(s, s.nx * width, beachY(s, tide) * height, 1 - buried * 0.8, 1 - buried * 0.45);
      }
      for (const d of departing) {
        const u = Math.min(1, (now - d.t0) / d.dur);
        const y = beachY(d.n, tide) * height - u * height * 0.10;
        drawNatural(d.n, d.n.nx * width + Math.sin(u * 4) * 12, y, 1 - u, 1 - u * 0.4);
      }

      // foam, grit, and torn grass — one sprite per material, no gradients
      for (const f of foam) {
        const sprite = SPRITES[f.tint] ?? SPRITES[0];
        if (!sprite) continue;
        const r = f.size * (0.35 + f.life);
        ctx.globalAlpha = Math.min(0.95, 0.55 + f.life * 0.45) * Math.min(1, f.life * 1.6);
        ctx.drawImage(sprite, f.x * width - r, f.y * height - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;

      if (spray > 0.05 && !reduced) {
        const rng = mulberry32(Math.floor(simT * 3));
        ctx.fillStyle = `rgba(255,255,255,${0.3 * spray})`;
        const n = Math.floor(24 * spray * detail.particles);
        for (let i = 0; i < n; i++) {
          ctx.fillRect(rng() * width, tide * height - rng() * 46 * spray, 2, 2);
        }
      }

      // the glimmer: after a long silence the shore shows, one material at a
      // time, that there is somewhere else to put a hand. Never a word.
      if (now - lastTouchAt > 20000 && now - glimmerAt > 6000 && !reduced && !asleep) {
        glimmerAt = now;
        glimmerZone = (glimmerZone + 1) % 5;
        const gy =
          glimmerZone === 0 ? tide - SEA_BAND - 0.12
          : glimmerZone === 1 ? tide - 0.05
          : glimmerZone === 2 ? tide + 0.04
          : glimmerZone === 3 ? tide + 0.13
          : Math.min(0.96, duneLine(0.5, tide) + 0.04);
        addTouch(0.5, gy, (["sky", "sea", "wet", "dry", "dune"] as CoastZone[])[glimmerZone], 0.18);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // ——— keyboard: every verb has a non-touch path ———
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      lastTouchAt = performance.now();
      voice.ensure();
      if (e.key === "Enter") {
        const rng = mulberry32(mix32(shells.length, Math.floor(performance.now())));
        plantShell(0.25 + rng() * 0.5, tideNow() + 0.05 + rng() * 0.12);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        if (shells.length) takeShell(shells[shells.length - 1]);
      } else if (e.key === "ArrowLeft") wind = clamp(wind - 0.12, -1, 1);
      else if (e.key === "ArrowRight") wind = clamp(wind + 0.12, -1, 1);
      else if (e.key === "ArrowUp") {
        lensTarget = clamp(lensTarget + 1, 0, 2);
        markLens(lensTarget >= 0.5);
      } else if (e.key === "ArrowDown") {
        lensTarget = clamp(lensTarget - 1, 0, 2);
        markLens(lensTarget >= 0.5);
      } else if (e.key === ",") season -= 0.08;
      else if (e.key === ".") season += 0.08;
      else if (e.key === " ") {
        e.preventDefault();
        tutti(0.8);
      } else if (e.key >= "1" && e.key <= "5") {
        const zi = Number(e.key) - 1;
        const tide = tideNow();
        const ny =
          zi === 0 ? tide - SEA_BAND - 0.12
          : zi === 1 ? tide - 0.05
          : zi === 2 ? tide + 0.04
          : zi === 3 ? tide + 0.13
          : Math.min(0.96, duneLine(0.5, tide) + 0.04);
        answer(0.5, ny, 0.6);
      }
    };
    window.addEventListener("keydown", onKey);

    letGoRef.current = () => {
      const now = performance.now();
      for (const s of shells) departing.push({ n: s, t0: now, dur: reduced ? 500 : 2000 });
      shells = [];
      worldCommitZone("coast", []);
      writer.flush();
      voice.breakWave(1);
      setHasKept(false);
    };

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      detachGestures();
      detachVessel();
      unvis();
      ungal();
      unsubWorld();
      writer.flush();
      for (const id of noteTimers) window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      glCanvas.removeEventListener("webglcontextlost", onCtxLost);
      glCanvas.removeEventListener("webglcontextrestored", onCtxRestored);
      breathStop?.();
      voice.stop();
      if (gl && bits) {
        gl.deleteProgram(bits.prog);
        gl.deleteShader(bits.vs);
        gl.deleteShader(bits.fs);
        gl.deleteBuffer(bits.buf);
      }
      try {
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        /* noop */
      }
      bits = null;
      gl = null;
      delete wrap.dataset.lensRaised;
    };
  }, []);

  const letGo = () => {
    letGoRef.current();
    getFieldAudio().thud();
    haptics.roll();
    setHasKept(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#cfe3f0", touchAction: "none" }}>
      <canvas
        ref={glCanvasRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      <canvas
        ref={fxCanvasRef}
        role="application"
        aria-label="the coast"
        tabIndex={0}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
        }}
      />
      <LetGo label="clear the shore" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
