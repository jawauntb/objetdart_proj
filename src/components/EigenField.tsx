"use client";

/**
 * /eigen — surviving freedom after a constraint.
 *
 * Arrival is isotropic shimmer and one barely-fed ember. A dwell plants a
 * dark seam; off-seam life becomes ghosts. Freedom is how the cloud still
 * moves, never a drawn axis. Laws live in src/lib/eigen-field.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { THRESHOLDS, tapTrainTier } from "@/lib/gesture/core";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { createIdleWriter, createFrameGovernor, detailForTier, onVisibility } from "@/lib/room-runtime";
import { createGLStage, FULLSCREEN_VERT_CLIP } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
import {
  CLOUD_N,
  CONSTRAINT_CAP,
  bornCloud,
  bornConstraint,
  collapse,
  deepenBeta,
  gaussianCloud,
  hashSeed,
  icaSnap,
  kurtosisLandscapeFlat,
  mergeConstraints,
  mixedSources,
  mulberry32,
  principalDirection,
  sufficientSpan,
  survival,
  taskReadout,
  unit,
  type CloudPoint,
  type Constraint,
  type Vec,
} from "@/lib/eigen-field";

const STORAGE_KEY = "objetdart:eigen:v1";
const REST_FRAC = 0.006;
const FUSE_SPAN = 1.2;
const GLINT_SPAN = 0.9;
const FIELD_SEED = 0xe16e11;

const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float uBreath;
uniform float u_turbulence;
uniform float u_brightness;
uniform float u_reduced;
uniform float u_night;
uniform float u_wind;
uniform float u_shake;
uniform float u_tiltX;
uniform float u_lens;
uniform float u_task;
uniform float u_glint;
uniform float u_glintAng;
uniform float u_pulse;
uniform float u_killed;
uniform vec2 u_surv0;
uniform float u_survN;
uniform vec4 u_s0; uniform vec4 u_a0;
uniform vec4 u_s1; uniform vec4 u_a1;
uniform vec4 u_s2; uniform vec4 u_a2;
uniform vec4 u_s3; uniform vec4 u_a3;
uniform vec4 u_s4; uniform vec4 u_a4;
uniform vec4 u_s5; uniform vec4 u_a5;

float seamDark(vec2 uv, vec4 sd, vec4 at, float pulse) {
  float pres = at.z;
  if (pres < 0.02) return 0.0;
  vec2 d = uv - sd.xy;
  vec2 u = sd.zw;
  float along = d.x * u.x + d.y * u.y;
  vec2 perp = d - u * along;
  float dist = length(perp);
  float beta = at.x;
  float w = 0.007 + 0.02 * beta;
  float line = smoothstep(w, 0.0, dist);
  float dark = line * beta * pres;
  if (at.y < 0.5) dark *= 0.22 + 0.78 * pulse;
  return dark;
}

void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec2 p = uv - vec2(0.5, 0.52);
  p.x *= u_resolution.x / max(1.0, u_resolution.y);

  float vig = smoothstep(1.15, 0.12, length(p));
  float br = 0.55 + 0.45 * uBreath;
  vec3 deep = vec3(0.012, 0.016, 0.026);
  vec3 lift = vec3(0.038, 0.044, 0.058);
  vec3 c = mix(deep, lift, vig * br * 0.45);
  c += vec3(0.01, 0.012, 0.018) * u_turbulence * 0.35;
  c *= 1.0 - 0.72 * u_night;

  if (u_killed > 0.02 && u_survN > 0.5) {
    vec2 k = vec2(-u_surv0.y, u_surv0.x);
    float y = uv.y + u_tiltX * 0.035;
    float streak = 0.5 + 0.5 * sin((uv.x * k.x + y * k.y) * 52.0 + u_time * 0.28 + u_wind * 1.8);
    streak *= streak;
    c *= 1.0 - streak * u_killed * (0.16 + 0.22 * u_shake);
  }

  float pulse = u_pulse;
  float dark = 0.0;
  dark += seamDark(uv, u_s0, u_a0, pulse);
  dark += seamDark(uv, u_s1, u_a1, pulse);
  dark += seamDark(uv, u_s2, u_a2, pulse);
  dark += seamDark(uv, u_s3, u_a3, pulse);
  dark += seamDark(uv, u_s4, u_a4, pulse);
  dark += seamDark(uv, u_s5, u_a5, pulse);
  c *= 1.0 - clamp(dark, 0.0, 0.88);

  vec2 ember = vec2(0.5, 0.12);
  float er = length(uv - ember);
  float fed = 0.18 + 0.82 * u_task;
  float emberGlow = exp(-er * er * 110.0) * fed * (0.7 + 0.3 * uBreath);
  vec3 candle = vec3(0.784, 0.451, 0.165);
  c += candle * emberGlow;

  if (u_survN > 0.5 && u_task > 0.03) {
    vec2 s = u_surv0;
    vec2 mid = vec2(0.5, 0.48);
    float tline = (uv.x - mid.x) * s.x + (uv.y - mid.y) * s.y;
    vec2 nearest = mid + s * tline;
    float off = length(uv - nearest);
    float run = fract(tline * 0.85 - u_time * 0.12 * (0.4 + u_task) - uBreath * 0.15);
    float bead = smoothstep(0.035, 0.0, off) * smoothstep(0.18, 0.0, abs(run - 0.5) * 2.0);
    c += candle * bead * 0.16 * u_task * (1.0 - u_lens * 0.4);
  }

  float ang = atan(p.y, p.x);
  float g = smoothstep(0.14, 0.0, abs(sin(ang - u_glintAng))) * u_glint * 0.18;
  c += vec3(0.5, 0.56, 0.62) * g;

  if (u_reduced > 0.5) {
    c = mix(deep, c, 0.85);
  }
  c *= 0.42 + 0.58 * u_brightness;
  gl_FragColor = vec4(c, 1.0);
}`;

type Grain = {
  seed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  hue: number;
  stream: number;
  gx: number;
  gy: number;
};

type Kept = {
  v: 1;
  seed: number;
  constraints: Constraint[];
  cloud: CloudPoint[];
  snapped: boolean;
  season: number;
  qTight: boolean;
  mixed: boolean;
  nextId: number;
};

type Api = {
  tapTrain: (count: number, x: number, y: number, intensity: number) => void;
  nudge: (x: number, y: number, intensity: number) => void;
  splitSource: (x: number, y: number, intensity: number) => void;
  snapIca: (intensity: number) => void;
  fiberFind: (intensity: number) => void;
  plant: (x: number, y: number, aligned: boolean) => void;
  deepen: (elapsed: number, x: number, y: number) => void;
  ceremony: (x: number, y: number) => void;
  drag: (phase: "start" | "move" | "end", x: number, y: number, dx: number, dy: number) => void;
  flick: (angle: number, speed: number, x: number, y: number) => void;
  lens: (angle: number) => void;
  season: (angle: number) => void;
  tutti: (intensity: number) => void;
  stepBack: () => void;
  wind: (dx: number, dy: number) => void;
  timeScale: (k: number) => void;
  scatter: (intensity: number) => void;
  gravity: (gamma: number) => void;
  knock: (intensity: number) => void;
  night: (faceDown: boolean) => void;
  letGo: () => void;
  glimmer: () => void;
  aim: (dx: number, dy: number) => void;
};

function living(cs: Constraint[]): Constraint[] {
  return cs.filter((c) => c.presence >= 1 && c.growth > 0.08);
}

function toUv(nx: number, ny: number): { x: number; y: number } {
  return { x: nx, y: 1 - ny };
}

function curlDir(seed: number, t: number): Vec {
  const rng = mulberry32(seed >>> 0);
  const a0 = rng() * Math.PI * 2;
  const w = 0.25 + rng() * 0.55;
  const a = a0 + t * w * 0.2;
  return { x: Math.cos(a), y: Math.sin(a) };
}

function grainsFrom(cloud: CloudPoint[], seed: number): Grain[] {
  return cloud.map((p, i) => {
    const rng = mulberry32(hashSeed(seed, i + 1));
    return {
      seed: hashSeed(seed, i + 3),
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      phase: rng() * Math.PI * 2,
      hue: 0.22 + rng() * 0.08,
      stream: 0,
      gx: 0,
      gy: 0,
    };
  });
}

function cloudFrom(grains: Grain[]): CloudPoint[] {
  return grains.map((g) => ({ x: g.x, y: g.y, w: 1 }));
}

function pitchOf(c: Constraint): number {
  const a = (Math.atan2(c.uy, c.ux) + Math.PI) / (Math.PI * 2);
  return 98 * Math.pow(2, a);
}

export default function EigenField() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [standing, setStanding] = useState(0);
  const apiRef = useRef<Api | null>(null);
  const cursorRef = useRef({ nx: 0.5, ny: 0.48 });
  const shiftRef = useRef(false);

  const voice = useMemo<RoomVoice>(
    () => ({
      tap: (e) => {
        const count = e.count;
        const tier = tapTrainTier(count);
        if (tier === "n") {
          apiRef.current?.fiberFind(e.intensity);
          return;
        }
        if (tier === 5) {
          apiRef.current?.snapIca(e.intensity);
          return;
        }
        if (tier === 3) {
          apiRef.current?.splitSource(e.x, e.y, e.intensity);
          return;
        }
        apiRef.current?.nudge(e.x, e.y, e.intensity);
      },
      plant: (e) => {
        if (shiftRef.current) return;
        apiRef.current?.plant(e.x, e.y, true);
      },
      deepen: (e) => apiRef.current?.deepen(e.elapsed, e.x, e.y),
      ceremony: (e) => apiRef.current?.ceremony(e.x, e.y),
      drag: (e) => apiRef.current?.drag(e.phase, e.x, e.y, e.dx, e.dy),
      flick: (e) => apiRef.current?.flick(e.angle, e.speed, e.x, e.y),
      lens: (e) => {
        if ((e as { fingers?: number }).fingers === 3) return;
        apiRef.current?.lens(e.angle);
      },
      season: (e) => apiRef.current?.season(e.angle),
      tutti: (e) => apiRef.current?.tutti(e.intensity),
      stepBack: () => apiRef.current?.stepBack(),
      wind: (e) => apiRef.current?.wind(e.dx, e.dy),
      timeScale: (k) => apiRef.current?.timeScale(k),
      scatter: (e) => apiRef.current?.scatter(e.intensity),
      gravity: (e) => apiRef.current?.gravity(e.gamma),
      knock: (e) => apiRef.current?.knock(e.intensity),
      night: (e) => apiRef.current?.night(e.faceDown),
    }),
    [],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let seed = FIELD_SEED;
    let constraints: Constraint[] = [];
    let grains: Grain[] = grainsFrom(gaussianCloud(seed, CLOUD_N), seed);
    let snapped = false;
    let season = 0.15;
    let qTight = false;
    let mixed = false;
    let nextId = 1;
    let growingId = 0;
    let lensAmt = 0;
    let night = 0;
    let wind = 0;
    let shake = 0;
    let tiltX = 0;
    let timeScale = 1;
    let glint = 0;
    let glintAng = 0;
    let glintSlide = false;
    let pulseGate = 1;
    let fuse: { a: number; b: number; child: Constraint; t: number } | null = null;
    let glimmerFlat = 0;
    let glimmerGhost = 0;
    let dilated = false;
    let aim = { x: 1, y: 0 };
    const cursor = cursorRef.current;

    const writer = createIdleWriter(() => {
      const kept: Kept = {
        v: 1,
        seed,
        constraints,
        cloud: cloudFrom(grains),
        snapped,
        season,
        qTight,
        mixed,
        nextId,
      };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
      } catch {
        /* quota */
      }
    });
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const kept = JSON.parse(raw) as Kept;
        if (kept?.v === 1 && Array.isArray(kept.constraints)) {
          seed = kept.seed >>> 0 || FIELD_SEED;
          constraints = kept.constraints.filter((c) => c && c.presence >= 1);
          nextId = Math.max(kept.nextId || 1, ...constraints.map((c) => c.id + 1), 1);
          snapped = !!kept.snapped;
          season = kept.season ?? 0.15;
          qTight = !!kept.qTight;
          mixed = !!kept.mixed;
          grains = kept.cloud?.length
            ? grainsFrom(kept.cloud, seed)
            : grainsFrom(gaussianCloud(seed, CLOUD_N), seed);
        }
      }
    } catch {
      /* fresh */
    }
    setStanding(living(constraints).length);

    const stage = createGLStage(canvas, { wrap, label: "eigen", reducedMotion: reduced });
    const prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    const layer = stage
      ? createPopulationLayer(stage, { palette: ["#9aa7b8", "#c8732a", "#7a9aa8"] })
      : null;
    const buffer = createInstanceBuffer(96);

    const note = () => writer.schedule();
    const stand = () => setStanding(living(constraints).length);

    const pxToNorm = (x: number, y: number) => {
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      return { nx: x / w, ny: y / h };
    };

    const emberAxis = (): Vec => {
      const cloud = cloudFrom(grains);
      const span = qTight ? sufficientSpan(cloud, constraints) : null;
      if (span && span.length) return span[0];
      const axes = sufficientSpan(cloud, constraints);
      if (axes.length) return axes[0];
      return principalDirection(cloud);
    };

    const task = () => {
      const axis = emberAxis();
      const live = collapse(cloudFrom(grains), constraints);
      return Math.min(1, taskReadout(live, axis) * 6.5);
    };

    const tryFuse = () => {
      const live = living(constraints);
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const child = mergeConstraints(live[i], live[j]);
          if (!child) continue;
          fuse = { a: live[i].id, b: live[j].id, child, t: 0 };
          audio.playTone(pitchOf(live[i]), 0.18);
          audio.playTone(pitchOf(live[j]) * 1.01, 0.18);
          haptics.detent();
          return;
        }
      }
    };

    const plantAt = (nx: number, ny: number, aligned: boolean, dir?: Vec) => {
      const live = living(constraints);
      if (live.length >= CONSTRAINT_CAP) {
        const oldest = live.reduce((a, b) => (a.id < b.id ? a : b));
        oldest.presence = 0;
      }
      const u = dir ?? (Math.hypot(aim.x, aim.y) > 0.2 ? aim : unit(nx - 0.5, 0.48 - ny));
      const c = bornConstraint(nextId++, hashSeed(seed, nx, ny, nextId), nx, ny, u.x, u.y, {
        aligned,
        gaussian: season > 0.55,
      });
      constraints.push(c);
      growingId = c.id;
      audio.playTone(pitchOf(c), 0.12 + c.beta * 0.2);
      haptics.ripple(0.45);
      tryFuse();
      stand();
      note();
    };

    const nearest = (nx: number, ny: number): Constraint | null => {
      const live = living(constraints);
      let best: Constraint | null = null;
      let bestD = 1e9;
      for (const c of live) {
        const d = Math.hypot(c.nx - nx, c.ny - ny);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best;
    };

    const nudgeAlong = (intensity: number) => {
      const axis = emberAxis();
      const k = 0.028 * intensity;
      for (const g of grains) {
        g.x += axis.x * k;
        g.y += axis.y * k;
      }
      audio.playTone(148 + intensity * 40, 0.07);
      haptics.ripple(0.25 + intensity * 0.4);
      haptics.tap();
      note();
    };

    apiRef.current = {
      tapTrain: (count, x, y, intensity) => {
        const tier = tapTrainTier(count);
        if (tier === "n") apiRef.current?.fiberFind(intensity);
        else if (tier === 5) apiRef.current?.snapIca(intensity);
        else if (tier === 3) apiRef.current?.splitSource(x, y, intensity);
        else apiRef.current?.nudge(x, y, intensity);
      },
      nudge: (_x, _y, intensity) => nudgeAlong(intensity),
      splitSource: (x, y, intensity) => {
        const { nx, ny } = pxToNorm(x, y);
        mixed = true;
        season = Math.max(0, season - 0.25);
        const src = mixedSources(hashSeed(seed, Math.floor(nx * 64), Math.floor(ny * 64)), CLOUD_N);
        grains = grainsFrom(src, hashSeed(seed, 9));
        for (const g of grains) {
          g.x += (nx - 0.5) * 0.15 * intensity;
          g.y += (0.48 - ny) * 0.15 * intensity;
        }
        audio.playTone(196, 0.09);
        audio.playTone(196 * 1.06, 0.09);
        haptics.tap();
        note();
      },
      snapIca: (intensity) => {
        const cloud = cloudFrom(grains);
        const gaussianSeason = season > 0.55;
        const flat = gaussianSeason || kurtosisLandscapeFlat(cloud, 1.15);
        glint = 0.02;
        glintAng = 0;
        if (flat) {
          glintSlide = true;
          audio.playTone(220, 0.4);
          audio.playTone(233, 0.55);
        } else {
          glintSlide = false;
          snapped = true;
          const axis = icaSnap(cloud);
          for (const g of grains) {
            const side = g.x * axis.x + g.y * axis.y >= 0 ? 0 : 1;
            g.stream = side;
            g.hue = side === 0 ? 0.52 : 0.92;
          }
          audio.playTone(196, 0.16);
          audio.playTone(196 * 1.5, 0.2);
          haptics.detent();
        }
        void intensity;
        note();
      },
      fiberFind: (intensity) => {
        qTight = true;
        const cloud = cloudFrom(grains);
        const span = sufficientSpan(cloud, constraints);
        if (span.length === 0) {
          audio.playTone(82, 0.35);
        } else {
          audio.playTone(110, 0.14);
          audio.playTone(220, 0.2);
        }
        haptics.bloom();
        void intensity;
        note();
      },
      plant: (x, y, aligned) => {
        const { nx, ny } = typeof x === "number" && x > 1.5 ? pxToNorm(x, y) : { nx: x, ny: y };
        const nxx = nx > 1 ? nx / (wrap.clientWidth || 1) : nx;
        const nyy = ny > 1 ? ny / (wrap.clientHeight || 1) : ny;
        cursor.nx = nxx;
        cursor.ny = nyy;
        plantAt(nxx, nyy, aligned);
      },
      deepen: (elapsed, x, y) => {
        const { nx, ny } = x > 1.5 ? pxToNorm(x, y) : { nx: x, ny: y };
        const c = constraints.find((s) => s.id === growingId) ?? nearest(nx, ny);
        if (!c) return;
        c.beta = Math.max(c.beta, deepenBeta(elapsed));
        c.growth = Math.min(1, c.growth + elapsed / 80000);
        audio.playTone(pitchOf(c), 0.05 + c.beta * 0.08);
        haptics.roll();
        tryFuse();
        note();
      },
      ceremony: (x, y) => {
        const { nx, ny } = x > 1.5 ? pxToNorm(x, y) : { nx: x, ny: y };
        const c = nearest(nx, ny);
        growingId = 0;
        if (!c) {
          haptics.chop();
          return;
        }
        const axis = { x: c.ux, y: c.uy };
        const before = taskReadout(collapse(cloudFrom(grains), constraints), axis);
        c.presence = 0;
        const after = taskReadout(collapse(cloudFrom(grains), living(constraints)), axis);
        const load = Math.abs(after - before) / Math.max(1e-4, Math.abs(before) + Math.abs(after)) > 0.08;
        if (load) {
          audio.playTone(pitchOf(c) * 0.5, 0.22);
          haptics.chop();
        } else {
          audio.playTone(pitchOf(c), 0.08);
          haptics.chop();
        }
        stand();
        note();
      },
      drag: (phase, x, y, dx, dy) => {
        const { nx, ny } = pxToNorm(x, y);
        cursor.nx = nx;
        cursor.ny = ny;
        if (phase === "start") {
          haptics.ripple(0.2);
          return;
        }
        if (phase !== "move") return;
        const w = wrap.clientWidth || 1;
        const h = wrap.clientHeight || 1;
        const sx = dx / w;
        const sy = -dy / h;
        const axis = emberAxis();
        const along = sx * axis.x + sy * axis.y;
        const offx = sx - axis.x * along;
        const offy = sy - axis.y * along;
        for (const g of grains) {
          g.x += axis.x * along * 1.8;
          g.y += axis.y * along * 1.8;
          g.gx += offx * 2.2;
          g.gy += offy * 2.2;
        }
        const heading = Math.atan2(sy, sx);
        audio.playTone(90 + Math.abs(heading) * 40, 0.04);
        haptics.ripple(0.12);
      },
      flick: (angle, speed, x, y) => {
        const { nx, ny } = pxToNorm(x, y);
        const u = unit(Math.cos(angle), Math.sin(angle));
        plantAt(nx, ny, false, u);
        pulseGate = 0.15;
        audio.playTone(310 + speed * 20, 0.06);
        haptics.chop();
      },
      lens: (angle) => {
        lensAmt = Math.max(0, Math.min(1, lensAmt + angle * 0.28));
        haptics.lens();
      },
      season: (angle) => {
        season = (season + angle / (Math.PI * 2) + 1) % 1;
        haptics.roll();
        note();
      },
      tutti: (intensity) => {
        for (const c of living(constraints)) audio.playTone(pitchOf(c), 0.1 * intensity);
        if (!living(constraints).length) audio.playTone(130, 0.1);
        haptics.roll();
      },
      stepBack: () => {
        lensAmt = Math.max(0, lensAmt * 0.35 - 0.08);
      },
      wind: (dx, dy) => {
        wind = Math.max(-1, Math.min(1, wind + dx * 1.6 + dy * 0.4));
        for (const g of grains) {
          g.gx += dx * 0.8;
          g.gy += dy * 0.8;
        }
        haptics.ripple(0.18);
      },
      timeScale: (k) => {
        timeScale = k;
        if (k < 0.92 && !dilated) {
          dilated = true;
          haptics.roll();
        }
        if (k >= 0.99) dilated = false;
      },
      scatter: (intensity) => {
        shake = Math.min(1, shake + intensity);
        const rng = mulberry32(hashSeed(seed, Math.floor(shake * 1000)));
        for (const g of grains) {
          g.gx += (rng() - 0.5) * intensity * 0.35;
          g.gy += (rng() - 0.5) * intensity * 0.35;
        }
        haptics.storm();
      },
      gravity: (gamma) => {
        tiltX = Math.max(-1, Math.min(1, gamma / 45));
      },
      knock: (intensity) => {
        if (!snapped) {
          const j = (intensity - 0.5) * 0.18;
          for (const g of grains) {
            const r = Math.hypot(g.x, g.y) || 1;
            const ca = Math.cos(j);
            const sa = Math.sin(j);
            const x = g.x / r;
            const y = g.y / r;
            g.x = (x * ca - y * sa) * r;
            g.y = (x * sa + y * ca) * r;
          }
        }
        audio.playTone(70, 0.08);
        haptics.tap();
      },
      night: (faceDown) => {
        night = faceDown ? 1 : 0;
        haptics.roll();
      },
      letGo: () => {
        constraints = [];
        growingId = 0;
        qTight = false;
        snapped = false;
        mixed = false;
        fuse = null;
        grains = grainsFrom(gaussianCloud(seed, CLOUD_N), seed);
        try {
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              v: 1,
              seed,
              constraints: [],
              cloud: cloudFrom(grains),
              snapped: false,
              season,
              qTight: false,
              mixed: false,
              nextId,
            } satisfies Kept),
          );
        } catch {
          /* noop */
        }
        writer.cancel();
        setStanding(0);
        audio.thud();
        haptics.bloom();
      },
      glimmer: () => {
        if (!living(constraints).length) {
          glimmerFlat = 1;
        } else {
          glimmerGhost = 1;
        }
      },
      aim: (dx, dy) => {
        const a = Math.atan2(aim.y, aim.x) + dx * 0.12;
        aim = { x: Math.cos(a), y: Math.sin(a) };
        cursor.nx = Math.max(0.08, Math.min(0.92, cursor.nx + dx * 0.04));
        cursor.ny = Math.max(0.08, Math.min(0.92, cursor.ny + dy * 0.04));
      },
    };

    const gov = createFrameGovernor();
    let hidden = false;
    const offVisibility = onVisibility((h) => {
      hidden = h;
      if (h) gov.force("sleep");
    });

    let spaceN = 0;
    let spaceAt = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey;
      if (e.code === "Space") {
        e.preventDefault();
        const now = performance.now();
        if (now - spaceAt > THRESHOLDS.tapTrainMs) spaceN = 1;
        else spaceN += 1;
        spaceAt = now;
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        apiRef.current?.tapTrain(spaceN, cursor.nx * w, cursor.ny * h, 0.6);
      }
      if (e.key === "Enter" && e.shiftKey) {
        apiRef.current?.ceremony(cursor.nx, cursor.ny);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let raf = 0;
    let last = performance.now();
    const draw = (t: number) => {
      const tier = gov.beginFrame(t);
      if (hidden) {
        last = t;
        raf = requestAnimationFrame(draw);
        return;
      }
      const detail = detailForTier(tier);
      const dt = Math.min(0.05, (t - last) / 1000) * timeScale;
      last = t;
      const tSec = audio.getAudioTime() ?? t / 1000;

      wind *= 0.985;
      shake *= 0.94;
      pulseGate += (1 - pulseGate) * Math.min(1, dt * 1.8);
      glimmerFlat *= 1 - Math.min(1, dt * 1.1);
      glimmerGhost *= 1 - Math.min(1, dt * 0.9);
      if (glint > 0) {
        glint += dt / GLINT_SPAN;
        glintAng += dt * (glintSlide ? 2.4 : 3.4);
        if (!glintSlide && glint > 1) glint = 0;
        if (glintSlide && glint > 1) glint = 0.35;
      }

      if (fuse) {
        fuse.t += dt / FUSE_SPAN;
        const a = constraints.find((c) => c.id === fuse!.a);
        const b = constraints.find((c) => c.id === fuse!.b);
        const u = Math.min(1, fuse.t);
        if (a && b) {
          a.nx += (fuse.child.nx - a.nx) * u * 0.2;
          a.ny += (fuse.child.ny - a.ny) * u * 0.2;
          b.nx += (fuse.child.nx - b.nx) * u * 0.2;
          b.ny += (fuse.child.ny - b.ny) * u * 0.2;
        }
        if (fuse.t >= 1 && a && b) {
          a.presence = 0;
          b.presence = 0;
          constraints.push(fuse.child);
          fuse = null;
          stand();
          note();
        } else if (fuse.t >= 1) {
          fuse = null;
        }
      }

      for (const g of grains) {
        g.vx *= 0.92;
        g.vy *= 0.92;
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.gx *= 0.96;
        g.gy *= 0.96;
        g.phase += dt * (0.4 + season * 0.3);
      }

      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const short = Math.min(w, h);
      const rest = REST_FRAC * short * (glimmerFlat > 0.02 ? 0.35 : 1);
      const cx = w * 0.5;
      const cy = h * 0.46;
      const sc = short * 0.33;
      const csForSurv = qTight
        ? living(constraints).map((c) => {
            const span = sufficientSpan(cloudFrom(grains), constraints);
            const keep = span[0];
            if (!keep) return c;
            const aligned = Math.abs(c.ux * keep.x + c.uy * keep.y) > 0.7;
            return aligned ? c : { ...c, aligned: false };
          })
        : constraints;
      const killed = 1 - (living(csForSurv).length ? survival({ x: 0, y: 1 }, csForSurv) * 0.5 + survival({ x: 1, y: 0 }, csForSurv) * 0.5 : 1);
      const axes = sufficientSpan(cloudFrom(grains), csForSurv);
      const surv0 = axes[0] ?? { x: 1, y: 0 };
      const readout = task();
      const pulse = 0.5 + 0.5 * Math.sin(tSec * (1.1 + readout * 2.2)) * pulseGate;

      if (stage && prog && quad) {
        const size = stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: shake, reducedMotion: reduced }),
          prog,
        );
        const seamAt = (i: number) => living(constraints)[i];
        const setSeam = (i: number, sName: string, aName: string) => {
          const c = seamAt(i);
          if (!c) {
            prog.setVec4(sName, 0, 0, 1, 0);
            prog.setVec4(aName, 0, 1, 0, 0);
            return;
          }
          const uv = toUv(c.nx, c.ny);
          const uy = { x: c.ux, y: -c.uy };
          prog.setVec4(sName, uv.x, uv.y, uy.x, uy.y);
          prog.setVec4(aName, c.beta, c.aligned ? 1 : 0, c.presence * c.growth, c.seed % 1);
        };
        setSeam(0, "u_s0", "u_a0");
        setSeam(1, "u_s1", "u_a1");
        setSeam(2, "u_s2", "u_a2");
        setSeam(3, "u_s3", "u_a3");
        setSeam(4, "u_s4", "u_a4");
        setSeam(5, "u_s5", "u_a5");
        prog.setFloat("u_night", night);
        prog.setFloat("u_wind", wind);
        prog.setFloat("u_shake", shake);
        prog.setFloat("u_tiltX", tiltX);
        prog.setFloat("u_lens", lensAmt);
        prog.setFloat("u_task", readout);
        prog.setFloat("u_glint", Math.min(1, glint));
        prog.setFloat("u_glintAng", glintAng);
        prog.setFloat("u_pulse", pulse);
        prog.setFloat("u_killed", killed);
        prog.setVec2("u_surv0", surv0.x, -surv0.y);
        prog.setFloat("u_survN", axes.length);
        quad.draw();

        buffer.reset();
        const nDraw = Math.max(8, Math.floor(CLOUD_N * (0.55 + 0.45 * detail.particles)));
        for (let i = 0; i < nDraw; i++) {
          const g = grains[i];
          const dir = curlDir(g.seed, tSec);
          const surv = survival(dir, csForSurv);
          const amp = rest * (0.08 + 0.92 * surv);
          const wob = reduced ? 0 : Math.sin(g.phase + tSec * 0.7) * amp;
          const px = cx + g.x * sc + dir.x * wob;
          const py = cy - g.y * sc + dir.y * wob;
          const hue = snapped ? g.hue : 0.18 + season * 0.1;
          const lum = reduced ? 0.35 + 0.5 * surv * (0.6 + 0.4 * Math.sin(tSec * 0.9 + g.phase)) : 0.55 + surv * 0.35;
          const alpha = (0.42 + 0.4 * (1 - lensAmt) + 0.4 * surv * lensAmt) * lum;
          const r = (3.2 + surv * 2.4) * (snapped && g.stream ? 1.05 : 1);
          buffer.push(px, py, r, g.phase, hue, reduced ? 0.15 : 0.55 + surv * 0.3, 0.45 + 0.3 * Math.sin(g.phase), alpha);

          const gAmp = reduced ? 0 : rest * (0.08 + 0.92 * (1 - surv));
          const killedDir = { x: -dir.y, y: dir.x };
          const gslide = glimmerGhost * 18 * Math.sin(tSec * 2.2);
          const gx = cx + g.x * sc + killedDir.x * (gAmp * Math.sin(g.phase * 0.7) + g.gx * short * 0.15 + gslide);
          const gy = cy - g.y * sc + killedDir.y * (gAmp * Math.cos(g.phase * 0.7) + g.gy * short * 0.15);
          const gAlpha = reduced ? 0.06 : 0.1 + (1 - surv) * 0.12 + shake * 0.08;
          buffer.push(gx + tiltX * 6, gy, r * 0.85, -g.phase, 0.12, 0, 0.3, gAlpha);
        }
        layer?.draw(buffer);
        void size;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      offVisibility();
      writer.flush();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      layer?.dispose();
      quad?.dispose();
      stage?.dispose();
      apiRef.current = null;
    };
  }, []);

  const letGo = useCallback(() => apiRef.current?.letGo(), []);
  const onGlimmer = useCallback(() => apiRef.current?.glimmer(), []);

  return (
    <RoomShell
      route="/eigen"
      chrome={false}
      surfaceRef={wrapRef}
      voice={voice}
      letGo={{ label: "let the field go", onLetGo: letGo, visible: standing > 0 }}
      onGlimmer={onGlimmer}
      keyboard={{
        enter: () => {
          if (shiftRef.current) return;
          apiRef.current?.plant(cursorRef.current.nx, cursorRef.current.ny, true);
        },
        enterHeld: (elapsed) => {
          apiRef.current?.deepen(elapsed, cursorRef.current.nx, cursorRef.current.ny);
        },
        escape: () => apiRef.current?.stepBack(),
        arrow: (dx, dy) => apiRef.current?.aim(dx, dy),
      }}
      style={{ position: "fixed", inset: 0, background: "#05070c" }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={canvasRef}
          role="application"
          tabIndex={0}
          aria-label="a field of pale grains — rest a finger and a seam forms, off-seam life becomes ghosts, what still moves is the freedom that survived"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        />
      </div>
    </RoomShell>
  );
}
