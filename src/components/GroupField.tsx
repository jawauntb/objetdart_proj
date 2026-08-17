"use client";

/**
 * /group — Weyl's automorphic invariance as a playable fragment.
 *
 * Arrival is an incomplete orbit: three marks of one class at uneven seats,
 * a second two-mark fragment lower, breathing out of phase. No ring, no
 * seats, no seam. A drag that closes is unison; tap-5 fills only predicted
 * seats; two fragments under one generator fuse into a third class.
 *
 * Laws live in src/lib/group-action.ts. The material is a shader field plus
 * one instanced population. Grammar arrives through <RoomShell>.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { THRESHOLDS, tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import type { RoomVoice } from "@/lib/gesture/defaults";
import {
  MATCH_TAU,
  MARK_CAP,
  ORBIT_N,
  applyGeneratorToMark,
  bornMark,
  classCentroid,
  classHue,
  completeOrbit,
  compose,
  consonanceAt,
  fuseOrbits,
  hashSeed,
  identity,
  invertGenerator,
  isDihedral,
  keepGenerator,
  missingPoses,
  nextUnusedShift,
  poseFromPoint,
  predictedPoses,
  propose,
  ringPoint,
  seenPoses,
  shiftFromTheta,
  thetaOfShift,
  wrapPose,
  type Generator,
  type Kind,
  type Mark,
} from "@/lib/group-action";
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
  mulberry32,
  type SceneObjectSpec,
  type SceneObjectState,
  type StepContext,
} from "@/lib/scene/object";

const STORAGE_KEY = "objetdart:group:v1";
const CANDLE = [0.784, 0.451, 0.165] as const;

type SceneMark = SceneObjectState & {
  classId: number;
  pose: number;
  charge: number;
  flare: number;
  phase: number;
  locked: number;
};

const markSpec: SceneObjectSpec<SceneMark> = {
  kind: "a mark",
  cap: MARK_CAP,
  born(seed, nx, ny, tMs) {
    const rng = mulberry32(seed);
    return {
      id: 0,
      seed,
      nx,
      ny,
      bornMs: tMs,
      growth: 0.12,
      sealedMs: null,
      presence: 1,
      classId: 0,
      pose: 0,
      charge: 0,
      flare: 0,
      phase: rng() * Math.PI * 2,
      locked: 0,
    };
  },
  step(s, ctx) {
    s.growth += (1 - s.growth) * Math.min(1, ctx.dt * 0.55);
    s.charge *= 1 - Math.min(1, ctx.dt * 1.2);
    s.flare *= 1 - Math.min(1, ctx.dt * 2.4);
    if (!ctx.reducedMotion) {
      const rate = s.locked > 0.5 ? 0.14 : 0.14 * (0.65 + (s.seed % 9) * 0.04);
      s.phase += ctx.dt * Math.PI * 2 * rate * ctx.timeScale;
    }
  },
  emit(s, ctx, out) {
    const hue = classHue(s.classId);
    const breath = ctx.reducedMotion ? 0.5 : ctx.breath;
    const locked = s.locked > 0.5;
    const phase = locked ? breath : 0.5 + 0.5 * Math.sin(s.phase);
    const r = (4.2 + s.growth * 7.5 + s.charge * 5 + s.flare * 4) * (locked ? 1.12 : 1);
    out.push(
      s.nx * ctx.width,
      s.ny * ctx.height,
      r,
      s.phase,
      hue,
      0.28 + s.charge * 0.45 + s.flare * 0.4 + (locked ? 0.18 : 0),
      phase,
      s.presence * (0.55 + s.growth * 0.45),
    );
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
      s.flare = Math.min(1, s.flare + 0.4 * e.intensity);
      s.charge = Math.min(1, s.charge + 0.2 * e.intensity);
    },
    stroke: (s, e) => {
      s.charge = Math.min(1, s.charge + Math.hypot(e.dx, e.dy) * 0.8);
    },
    dwell: (s, e) => {
      s.growth = Math.min(1, s.growth + e.elapsedMs / 90000);
      s.charge = Math.min(1, s.charge + 0.012 + e.elapsedMs / 180000);
    },
    ceremony: (s) => {
      s.presence = 0.999;
    },
    tutti: (s) => {
      s.flare = Math.min(1, s.flare + 0.55);
    },
    lens: (s, e) => {
      s.phase += e.angle * 0.4;
    },
    season: (s, e) => {
      s.phase += e.angle * 0.2;
    },
    wind: (s) => {
      s.flare = Math.min(1, s.flare + 0.02);
    },
    dilate: (s) => {
      s.charge = Math.min(1, s.charge + 0.003);
    },
    gravity: (s, e) => {
      s.phase += e.dx * 0.15;
    },
    agitate: (s, e) => {
      s.flare = Math.min(1, s.flare + e.intensity * 0.35);
    },
    knock: (s, e) => {
      s.flare = Math.min(1, s.flare + 0.15 * e.intensity);
    },
    night: (s, e) => {
      if (e.intensity > 0.5) s.charge *= 0.4;
    },
  },
};

const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float uBreath;
uniform float u_turbulence;
uniform float u_reduced;
uniform float u_wind;
uniform float u_night;
uniform float u_lens;
uniform float u_seam;
uniform float u_seamAngle;
uniform float u_propose;
uniform float u_consonance;
uniform float u_beat;
uniform float u_dilate;
uniform float u_kept;
uniform float u_bloom;
uniform vec2 u_c0;
uniform vec2 u_c1;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 p = (uv - vec2(0.5)) * vec2(aspect, 1.0);
  p.x -= u_wind * 0.045;

  float breath = uBreath;
  if (u_reduced > 0.5) breath = 0.5 + (uBreath - 0.5) * 0.5;

  // layer: abyss — blue-black, slow vignette
  vec3 abyss = vec3(0.010, 0.016, 0.036);
  vec3 deep = vec3(0.022, 0.032, 0.062);
  float vig = smoothstep(1.05, 0.12, length(p));
  vec3 c = mix(abyss, deep, vig * (0.50 + 0.50 * breath));
  c += vec3(0.010, 0.014, 0.028) * u_turbulence * 0.35;
  c *= mix(1.0, 0.32, clamp(u_night, 0.0, 1.0));

  // layer: undertow — rotational grain around class centroids; lens is look
  float lookB = 1.0 - smoothstep(0.0, 0.42, u_lens);
  float lookR = 1.0 - abs(u_lens - 0.5) * 2.0;
  lookR = max(0.0, lookR);
  float lookO = smoothstep(0.55, 1.0, u_lens);
  float grain = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 ctr = (i == 0 ? u_c0 : u_c1) - vec2(0.5);
    ctr.x *= aspect;
    vec2 q = p - ctr;
    float ang = atan(q.y, q.x);
    float r = length(q);
    float swirl = sin(ang * mix(2.0, 6.0, u_lens) + u_time * 0.12 * (0.35 + 0.65 * (1.0 - u_dilate)) + float(i) * 2.3);
    grain += exp(-r * 7.5) * swirl * (0.06 + 0.14 * u_kept);
  }
  float bilat = (1.0 - smoothstep(0.0, 0.55, abs(p.x))) * 0.10 * lookB;
  float orn = noise(p * 9.0 + vec2(u_time * 0.04, -u_time * 0.03)) * 0.10 * lookO;
  c += vec3(0.07, 0.09, 0.14) * (grain * mix(0.35, 1.0, lookR) + bilat + orn);

  // layer: seam — earned at a flip lock, decays; standing it would read as a crack
  if (u_seam > 0.004) {
    vec2 dir = vec2(cos(u_seamAngle), sin(u_seamAngle));
    float d = abs(dot(p, vec2(-dir.y, dir.x)));
    float band = exp(-d * mix(18.0, 42.0, 1.0 - u_seam)) * u_seam;
    if (u_reduced > 0.5) band *= 0.55;
    c += vec3(0.55, 0.38, 0.22) * band * 0.55;
  }

  // layer: beatfield — brightens where ghosts land, beats where they miss
  float beat = u_beat;
  if (u_reduced > 0.5) beat = 0.0;
  float pulse = u_reduced > 0.5
    ? u_propose * (1.0 - u_consonance) * 0.35
    : u_propose * (1.0 - u_consonance) * (0.5 + 0.5 * sin(u_time * beat * 6.28318));
  float fuse = u_propose * u_consonance;
  c += vec3(0.12, 0.16, 0.28) * pulse;
  c += vec3(${CANDLE[0].toFixed(3)}, ${CANDLE[1].toFixed(3)}, ${CANDLE[2].toFixed(3)}) * (fuse * 0.22 + u_bloom * 0.18);

  gl_FragColor = vec4(c, 1.0);
}`;

function asLib(s: SceneMark): Mark {
  return {
    id: s.id,
    seed: s.seed,
    classId: s.classId,
    pose: s.pose,
    nx: s.nx,
    ny: s.ny,
    growth: s.growth,
    presence: s.presence,
  };
}

function living(items: readonly SceneMark[]): SceneMark[] {
  return items.filter((s) => s.presence >= 1 && s.growth > 0.08);
}

function seedItems(tMs: number): SceneMark[] {
  const out: SceneMark[] = [];
  const plant = (
    classId: number,
    poses: number[],
    cx: number,
    cy: number,
    radius: number,
    id0: number,
  ) => {
    for (let i = 0; i < poses.length; i++) {
      const pose = poses[i];
      const pt = ringPoint(pose, cx, cy, radius);
      const seed = hashSeed(classId, pose, 11);
      const m = bornMark(id0 + i, seed, pt.nx, pt.ny, classId, pose);
      const rng = mulberry32(seed);
      out.push({
        id: m.id,
        seed: m.seed,
        nx: m.nx,
        ny: m.ny,
        bornMs: tMs,
        growth: 1,
        sealedMs: null,
        presence: 1,
        classId: m.classId,
        pose: m.pose,
        charge: 0,
        flare: 0,
        phase: rng() * Math.PI * 2,
        locked: 0,
      });
    }
  };
  plant(11, [0, 2, 5], 0.5, 0.36, 0.16, 1);
  plant(29, [1, 4], 0.48, 0.70, 0.14, 4);
  return out;
}

export default function GroupField() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(0);
  const letGoRef = useRef<() => void>(() => {});
  const plantRef = useRef<(nx: number, ny: number) => void>(() => {});
  const glimmerRef = useRef<() => void>(() => {});
  const voiceRef = useRef<RoomVoice | null>(null);
  const cursorRef = useRef({ nx: 0.5, ny: 0.42 });
  const shiftRef = useRef(false);
  const apiRef = useRef<{
    proposeTurn: (dTheta: number) => void;
    proposeFlip: () => void;
    deepen: (elapsed: number, nx: number, ny: number) => void;
    ceremony: (nx: number, ny: number) => void;
    cancel: () => void;
    cycle: () => void;
  } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const population = createPopulation(markSpec);
    const embedded = isEmbeddedFrame();

    const persist = {
      emptied: false,
      generators: [] as Generator[],
    };

    const writer = createIdleWriter(() => {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            kind: population.spec.kind,
            items: population.serialize().items,
            generators: persist.generators,
            emptied: persist.emptied,
          }),
        );
      } catch {
        /* quota / private */
      }
    });

    let seededEmpty = false;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          kind?: string;
          items?: unknown[];
          generators?: Generator[];
          emptied?: boolean;
        };
        persist.emptied = !!parsed.emptied;
        if (Array.isArray(parsed.generators)) persist.generators = parsed.generators;
        if (parsed.items && parsed.items.length > 0) {
          population.load({ kind: "a mark", items: parsed.items }, performance.now());
        } else {
          seededEmpty = persist.emptied || (Array.isArray(parsed.items) && parsed.items.length === 0);
        }
      }
    } catch {
      /* a fresh field */
    }
    if (population.standing() === 0 && !seededEmpty) {
      population.load({ kind: "a mark", items: seedItems(performance.now()) }, performance.now());
      persist.emptied = false;
    }
    setHasKept(population.standing() + persist.generators.length);

    const stage = createGLStage(canvas, {
      wrap,
      label: "group",
      reducedMotion: reduced,
      embedded,
    });
    const prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    const layer = stage
      ? createPopulationLayer(stage, { palette: ["#2c4a5c", "#c8732a", "#f3d77a"] })
      : null;
    const buffer = createInstanceBuffer(512);
    const fallback = stage ? null : canvas.getContext("2d");

    let wind = 0;
    let agitation = 0;
    let gravity = 0;
    let season = 0;
    let timeScale = 1;
    let lens = 0;
    let night = 0;
    let seam = 0;
    let seamAngle = 0;
    let bloom = 0;
    let tiltX = 0;
    let scatterNonce = 0;
    let focusClass = 11;

    type Proposal = {
      active: boolean;
      classId: number;
      kind: Kind;
      theta: number;
      k: number;
      delta: number;
      consonance: number;
      cx: number;
      cy: number;
      straight: number;
      pathLen: number;
      lastX: number;
      lastY: number;
    };
    const proposal: Proposal = {
      active: false,
      classId: 0,
      kind: "rotate",
      theta: 0,
      k: 0,
      delta: 0,
      consonance: 0,
      cx: 0.5,
      cy: 0.5,
      straight: 0,
      pathLen: 0,
      lastX: 0,
      lastY: 0,
    };
    let glimmer = 0;
    let glimmerTheta = 0;
    let glimmerKind: Kind = "rotate";
    let glimmerClass = 0;

    const libMarks = (): Mark[] => living(population.items).map(asLib);
    const tauNow = () => {
      const t = MATCH_TAU + (season - 0.5) * 0.28;
      return t < 0.52 ? 0.52 : t > 0.92 ? 0.92 : t;
    };
    const rootHz = () => 196 + season * 40;
    const ping = (hz: number, dur = 0.28) => audio.playTone(hz, dur);
    const size = () => ({ width: wrap.clientWidth, height: wrap.clientHeight });
    const toN = (x: number, y: number) => {
      const { width, height } = size();
      return { nx: x / Math.max(1, width), ny: y / Math.max(1, height) };
    };

    const nearest = (nx: number, ny: number): SceneMark | null => {
      let best: SceneMark | null = null;
      let bestD2 = Infinity;
      for (const s of living(population.items)) {
        const d2 = (s.nx - nx) ** 2 + (s.ny - ny) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = s;
        }
      }
      return best;
    };

    const classes = () => {
      const ids: number[] = [];
      for (const s of living(population.items)) {
        if (!ids.includes(s.classId)) ids.push(s.classId);
      }
      return ids;
    };

    const centroidOf = (classId: number) => {
      const c = classCentroid(libMarks(), classId);
      return c ?? { cx: 0.5, cy: 0.5 };
    };

    const radiusOf = (classId: number) => {
      const { cx, cy } = centroidOf(classId);
      const members = living(population.items).filter((s) => s.classId === classId);
      if (members.length === 0) return 0.16;
      let r = 0;
      for (const s of members) r += Math.hypot(s.nx - cx, s.ny - cy);
      return Math.max(0.1, r / members.length);
    };

    const syncLock = (classId: number) => {
      const miss = missingPoses(libMarks(), classId);
      const locked = miss.length === 0 ? 1 : 0;
      for (const s of population.items) {
        if (s.classId === classId && s.presence >= 1) s.locked = locked;
      }
    };

    const tryFuse = (g: Generator) => {
      const ids = classes();
      const items = living(population.items);
      const marks = items.map(asLib);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const next = fuseOrbits(marks, ids[i], ids[j], g);
          if (next) {
            for (let k = 0; k < items.length; k++) items[k].classId = marks[k].classId;
            bloom = 1;
            audio.bell();
            haptics.bloom();
            syncLock(next);
            return;
          }
        }
      }
    };

    const keepMove = (g: Generator) => {
      const before = persist.generators.length;
      persist.generators = keepGenerator(persist.generators, g);
      persist.emptied = false;
      if (persist.generators.length === before && !g.kind) return;
      bloom = 1;
      if (g.kind === "flip" || persist.generators.some((x) => isDihedral(compose(x, g)))) {
        seam = 1;
        seamAngle = thetaOfShift(g.k) * 0.5;
      }
      haptics.detent();
      haptics.bloom();
      audio.bell();
      ping(rootHz() * Math.pow(2, wrapPose(g.k) / ORBIT_N), 0.45);
      tryFuse(g);
      for (const id of classes()) syncLock(id);
      writer.schedule();
      setHasKept(population.standing() + persist.generators.length);
    };

    const seatMark = (s: SceneMark, classId: number, pose: number) => {
      const { cx, cy } = centroidOf(classId);
      const pt = ringPoint(pose, cx, cy, radiusOf(classId));
      s.classId = classId;
      s.pose = wrapPose(pose);
      s.nx = pt.nx;
      s.ny = pt.ny;
    };

    const plantAt = (nx: number, ny: number) => {
      const now = performance.now();
      const near = nearest(nx, ny);
      if (near) {
        near.growth = Math.min(1, near.growth + 0.08);
        near.charge = Math.min(1, near.charge + 0.2);
        audio.spark();
        haptics.tap();
        writer.schedule();
        return;
      }
      let join: number | null = null;
      let best = 0.22 * 0.22;
      for (const id of classes()) {
        const { cx, cy } = centroidOf(id);
        const d2 = (cx - nx) ** 2 + (cy - ny) ** 2;
        if (d2 < best) {
          best = d2;
          join = id;
        }
      }
      if (join != null) {
        const { cx, cy } = centroidOf(join);
        const pose = poseFromPoint(nx, ny, cx, cy);
        if (seenPoses(libMarks(), join).includes(pose)) {
          const hit = living(population.items).find((s) => s.classId === join && s.pose === pose);
          if (hit) {
            hit.charge = Math.min(1, hit.charge + 0.25);
            hit.growth = Math.min(1, hit.growth + 0.06);
          }
          haptics.tap();
          writer.schedule();
          return;
        }
        const born = population.spawn(nx, ny, now);
        seatMark(born, join, pose);
        born.growth = 0.2;
        persist.emptied = false;
        audio.chime();
        haptics.ripple(0.5);
        writer.schedule();
        setHasKept(population.standing() + persist.generators.length);
        return;
      }
      const born = population.spawn(nx, ny, now);
      born.classId = (hashSeed(born.seed, Math.round(nx * 8191), Math.round(ny * 4093)) % 0x3fffffff) + 1;
      born.pose = 0;
      born.growth = 0.18;
      persist.emptied = false;
      audio.chime();
      haptics.ripple(0.5);
      writer.schedule();
      setHasKept(population.standing() + persist.generators.length);
    };

    const lastKept = () => persist.generators[persist.generators.length - 1] ?? null;

    const applyLastToNearest = (nx: number, ny: number, intensity: number) => {
      const s = nearest(nx, ny);
      if (!s) return;
      s.flare = Math.min(1, s.flare + 0.35 + 0.55 * intensity);
      const g = lastKept();
      if (g) {
        const { cx, cy } = centroidOf(s.classId);
        applyGeneratorToMark(s, g, cx, cy);
        ping(rootHz() * Math.pow(2, wrapPose(g.k) / ORBIT_N) * (0.85 + 0.3 * intensity), 0.22);
      } else {
        ping(rootHz() * (0.9 + 0.3 * intensity), 0.18);
      }
      haptics.ripple(0.25 + 0.4 * intensity);
      writer.schedule();
    };

    const proposeUnused = () => {
      const marks = libMarks();
      const kWalk = (() => {
        const used = new Set(persist.generators.filter((g) => g.kind === "rotate").map((g) => wrapPose(g.k)));
        for (let k = 1; k < ORBIT_N; k++) if (!used.has(k)) return k;
        return 1;
      })();
      const ids = classes();
      const classId = ids.includes(focusClass) ? focusClass : ids[0];
      if (classId == null) return;
      const { cx, cy } = centroidOf(classId);
      proposal.active = true;
      proposal.classId = classId;
      proposal.kind = "rotate";
      proposal.theta = thetaOfShift(kWalk);
      proposal.k = kWalk;
      proposal.cx = cx;
      proposal.cy = cy;
      const g = nextUnusedShift(marks, persist.generators, tauNow());
      const cand = propose(marks, kWalk, "rotate", tauNow());
      proposal.consonance = consonanceAt(marks, cand ?? { id: 0, k: kWalk, kind: "rotate" }, 0);
      proposal.delta = 0;
      ping(rootHz() * Math.pow(2, kWalk / ORBIT_N), 0.32);
      if (g) {
        keepMove(g);
        proposal.active = false;
      } else {
        haptics.ripple(0.35);
      }
    };

    const fillPredicted = (nx: number, ny: number) => {
      const s = nearest(nx, ny);
      const classId = s?.classId ?? (classes()[0] ?? 0);
      if (!classId) return;
      const marks = libMarks();
      const pred = predictedPoses(marks, classId, persist.generators);
      const miss = pred.length ? pred : missingPoses(marks, classId);
      if (miss.length === 0) {
        syncLock(classId);
        audio.bell();
        haptics.bloom();
        return;
      }
      const nextId = population.items.reduce((m, x) => Math.max(m, x.id), 0) + 1;
      const born = completeOrbit(marks, classId, nextId);
      const { cx, cy } = centroidOf(classId);
      const r = radiusOf(classId);
      const want = new Set(miss);
      const now = performance.now();
      for (const m of born) {
        if (!want.has(m.pose)) continue;
        const sNew = population.spawn(m.nx, m.ny, now);
        sNew.classId = classId;
        sNew.pose = m.pose;
        const pt = ringPoint(m.pose, cx, cy, r);
        sNew.nx = pt.nx;
        sNew.ny = pt.ny;
        sNew.growth = 0.35;
        sNew.locked = 0;
      }
      syncLock(classId);
      bloom = 1;
      audio.bell();
      haptics.bloom();
      ping(rootHz() * 2, 0.5);
      persist.emptied = false;
      writer.schedule();
      setHasKept(population.standing() + persist.generators.length);
    };

    const tuttiKept = () => {
      const gens = persist.generators;
      if (gens.length === 0) {
        for (const s of living(population.items)) s.flare = Math.min(1, s.flare + 0.5);
        audio.chime();
        haptics.roll();
        return;
      }
      for (const g of gens) {
        for (const id of classes()) {
          const { cx, cy } = centroidOf(id);
          for (const s of living(population.items)) {
            if (s.classId !== id) continue;
            applyGeneratorToMark(s, g, cx, cy);
            s.flare = 1;
          }
        }
      }
      audio.bell();
      haptics.storm();
      writer.schedule();
    };

    const retireNearest = (nx: number, ny: number) => {
      if (persist.generators.length > 0) {
        persist.generators = persist.generators.slice(0, -1);
        seam *= 0.2;
        audio.thud();
        haptics.roll();
        writer.schedule();
        setHasKept(population.standing() + persist.generators.length);
        return;
      }
      const s = nearest(nx, ny);
      if (s) {
        s.presence = 0.999;
        audio.thud();
        haptics.chop();
        writer.schedule();
        setHasKept(Math.max(0, population.standing() - 1) + persist.generators.length);
      }
    };

    const beginProposal = (nx: number, ny: number) => {
      const s = nearest(nx, ny);
      const classId = s?.classId ?? (classes()[0] ?? 0);
      if (!classId) return;
      const { cx, cy } = centroidOf(classId);
      proposal.active = true;
      proposal.classId = classId;
      proposal.kind = "rotate";
      proposal.theta = 0;
      proposal.k = 0;
      proposal.delta = 0;
      proposal.consonance = 0;
      proposal.cx = cx;
      proposal.cy = cy;
      proposal.straight = 0;
      proposal.pathLen = 0;
      proposal.lastX = nx;
      proposal.lastY = ny;
    };

    const moveProposal = (nx: number, ny: number) => {
      if (!proposal.active) return;
      const prevX = proposal.lastX;
      const prevY = proposal.lastY;
      proposal.pathLen += Math.hypot(nx - prevX, ny - prevY);
      proposal.lastX = nx;
      proposal.lastY = ny;
      const a0 = Math.atan2(prevY - proposal.cy, prevX - proposal.cx);
      const a1 = Math.atan2(ny - proposal.cy, nx - proposal.cx);
      let da = a1 - a0;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      proposal.theta += da;
      const { k, delta } = shiftFromTheta(proposal.theta);
      proposal.k = k;
      proposal.delta = delta;
      const straight = proposal.pathLen > 0.08 && Math.abs(proposal.theta) < Math.PI / ORBIT_N;
      proposal.kind = straight ? "flip" : "rotate";
      const g: Generator = {
        id: 0,
        k: straight ? poseFromPoint(nx, ny, proposal.cx, proposal.cy) : k,
        kind: proposal.kind,
      };
      if (straight) proposal.k = g.k;
      const members = libMarks().filter((m) => m.classId === proposal.classId);
      proposal.consonance = consonanceAt(members, g, straight ? 0 : delta);
      haptics.ripple(0.12 + proposal.consonance * 0.35);
    };

    const endProposal = () => {
      if (!proposal.active) return;
      const members = libMarks().filter((m) => m.classId === proposal.classId);
      const g: Generator =
        proposal.kind === "flip"
          ? { id: 0, k: proposal.k, kind: "flip" }
          : { id: 0, k: proposal.k, kind: "rotate" };
      const score = consonanceAt(members, g, proposal.kind === "flip" ? 0 : proposal.delta);
      const locked = propose(members, g.k, g.kind, tauNow());
      if (locked && score + 1e-9 >= tauNow()) {
        keepMove(locked);
      } else {
        audio.refuse();
      }
      proposal.active = false;
      proposal.consonance = 0;
    };

    const turnProposal = (dTheta: number) => {
      if (!proposal.active) {
        const ids = classes();
        const classId = ids.includes(focusClass) ? focusClass : ids[0];
        if (classId == null) return;
        const { cx, cy } = centroidOf(classId);
        proposal.active = true;
        proposal.classId = classId;
        proposal.cx = cx;
        proposal.cy = cy;
        proposal.kind = "rotate";
        proposal.theta = 0;
        proposal.pathLen = 0;
      }
      proposal.theta += dTheta;
      const { k, delta } = shiftFromTheta(proposal.theta);
      proposal.k = k;
      proposal.delta = delta;
      proposal.kind = "rotate";
      const members = libMarks().filter((m) => m.classId === proposal.classId);
      proposal.consonance = consonanceAt(members, { id: 0, k, kind: "rotate" }, delta);
      haptics.ripple(0.2 + proposal.consonance * 0.3);
    };

    const scatterClass = (intensity: number) => {
      scatterNonce += 1;
      for (const id of classes()) {
        const members = living(population.items).filter((s) => s.classId === id);
        const poses = members.map((s) => s.pose);
        const rng = mulberry32(hashSeed(id, scatterNonce, members[0]?.seed ?? 1));
        for (let i = poses.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const t = poses[i];
          poses[i] = poses[j];
          poses[j] = t;
        }
        const { cx, cy } = centroidOf(id);
        const r = radiusOf(id);
        for (let i = 0; i < members.length; i++) {
          members[i].pose = poses[i];
          const pt = ringPoint(poses[i], cx, cy, r);
          const u = rng() * intensity * 0.02;
          members[i].nx = pt.nx + (rng() - 0.5) * u;
          members[i].ny = pt.ny + (rng() - 0.5) * u;
          members[i].flare = Math.min(1, members[i].flare + intensity * 0.4);
        }
      }
      audio.buzz();
      haptics.chop();
      writer.schedule();
    };

    plantRef.current = plantAt;
    apiRef.current = {
      proposeTurn: turnProposal,
      proposeFlip: () => {
        if (!proposal.active) {
          const ids = classes();
          const classId = ids.includes(focusClass) ? focusClass : ids[0];
          if (classId == null) return;
          const { cx, cy } = centroidOf(classId);
          proposal.active = true;
          proposal.classId = classId;
          proposal.cx = cx;
          proposal.cy = cy;
        }
        proposal.kind = "flip";
        proposal.k = wrapPose(Math.round((proposal.theta / (Math.PI * 2)) * ORBIT_N));
        const members = libMarks().filter((m) => m.classId === proposal.classId);
        proposal.consonance = consonanceAt(members, { id: 0, k: proposal.k, kind: "flip" }, 0);
        haptics.ripple(0.3);
      },
      deepen: (elapsed, nx, ny) => {
        const s = nearest(nx, ny);
        if (!s) {
          if (elapsed > THRESHOLDS.dwellMs * 0.4) plantAt(nx, ny);
          return;
        }
        for (const m of living(population.items)) {
          if (m.classId !== s.classId) continue;
          m.growth = Math.min(1, m.growth + elapsed / 140000);
          m.charge = Math.min(1, m.charge + elapsed / 90000);
        }
        haptics.tap();
      },
      ceremony: (nx, ny) => retireNearest(nx, ny),
      cancel: () => {
        if (proposal.active) {
          proposal.active = false;
          proposal.consonance = 0;
          audio.refuse();
          return;
        }
        lens = Math.max(0, lens - 0.2);
        haptics.lens();
      },
      cycle: () => {
        const ids = classes();
        if (ids.length === 0) return;
        const i = ids.indexOf(focusClass);
        focusClass = ids[(i + 1) % ids.length];
        haptics.tap();
      },
    };

    glimmerRef.current = () => {
      const g = lastKept() ?? nextUnusedShift(libMarks(), persist.generators, tauNow());
      const ids = classes();
      const classId = ids.includes(focusClass) ? focusClass : ids[0];
      if (!classId) return;
      glimmer = 1;
      glimmerClass = classId;
      if (g) {
        glimmerKind = g.kind;
        glimmerTheta = g.kind === "rotate" ? thetaOfShift(g.k) : 0;
      } else {
        glimmerKind = "rotate";
        glimmerTheta = thetaOfShift(1);
      }
      ping(rootHz(), 0.12);
    };

    const baseVoice = populationVoice(population, {
      size,
      now: () => performance.now(),
      plant: (nx, ny) => {
        plantAt(nx, ny);
        return false;
      },
      onSpawn: () => {
        persist.emptied = false;
        writer.schedule();
      },
      onAnswered: (_e, n) => {
        if (n > 0) writer.schedule();
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
          tiltX = gravity;
        },
        timeScale: (k) => {
          timeScale = k;
        },
      },
    });

    voiceRef.current = {
      ...baseVoice,
      tap: (e) => {
        if (e.fingers !== 1) return;
        const { nx, ny } = toN(e.x, e.y);
        cursorRef.current = { nx, ny };
        const count = e.count;
        const tier = tapTrainTier(count);
        const depth = tapTrainDepth(count);
        if (tier === "n") {
          tuttiKept();
          return;
        }
        if (tier === 5) {
          fillPredicted(nx, ny);
          return;
        }
        if (tier === 3) {
          proposeUnused();
          return;
        }
        applyLastToNearest(nx, ny, e.intensity * (0.7 + 0.3 * depth));
      },
      plant: (e) => {
        const { nx, ny } = toN(e.x, e.y);
        cursorRef.current = { nx, ny };
        plantAt(nx, ny);
      },
      deepen: (e) => {
        const { nx, ny } = toN(e.x, e.y);
        apiRef.current?.deepen(e.elapsed, nx, ny);
        baseVoice.deepen?.(e);
      },
      ceremony: (e) => {
        const { nx, ny } = toN(e.x, e.y);
        retireNearest(nx, ny);
        void e;
      },
      tutti: (e) => {
        for (const s of living(population.items)) s.flare = Math.min(1, s.flare + 0.45 * e.intensity);
        audio.chime();
        haptics.roll();
        baseVoice.tutti?.(e);
      },
      lens: (e) => {
        if (e.angle === 0) return;
        lens = Math.max(0, Math.min(1, lens + e.angle * 0.22));
        haptics.lens();
        baseVoice.lens?.(e);
      },
      season: (e) => {
        season = (season + e.angle / (Math.PI * 2) + 1) % 1;
        haptics.ripple(0.3);
        baseVoice.season?.(e);
      },
      wind: (e) => {
        wind = Math.max(-1, Math.min(1, wind + e.dx * 2.4));
        haptics.chop();
        baseVoice.wind?.(e);
      },
      timeScale: (k) => {
        timeScale = k;
        if (k < 0.98) haptics.roll();
        baseVoice.timeScale?.(k);
      },
      gravity: (e) => {
        tiltX = Math.max(-1, Math.min(1, e.gamma / 45));
        baseVoice.gravity?.(e);
      },
      scatter: (e) => {
        scatterClass(e.intensity);
        baseVoice.scatter?.(e);
      },
      knock: (e) => {
        const id = identity();
        void propose(libMarks(), id.k, id.kind, tauNow());
        ping(rootHz(), 0.16);
        haptics.tap();
        baseVoice.knock?.(e);
      },
      night: (e) => {
        night = e.faceDown ? 1 : 0;
        haptics.ripple(0.4);
        const g = lastKept();
        if (g && e.faceDown) {
          persist.generators = persist.generators.map((x, i, arr) =>
            i === arr.length - 1 ? invertGenerator(x) : x,
          );
          ping(rootHz() * 0.5, 0.3);
          writer.schedule();
        }
        baseVoice.night?.(e);
      },
      stepBack: () => {
        if (proposal.active) {
          proposal.active = false;
          audio.refuse();
          return;
        }
        lens = Math.max(0, lens - 0.25);
        haptics.lens();
      },
      drag: (e) => {
        if (e.fingers !== 1) return;
        const { nx, ny } = toN(e.x, e.y);
        cursorRef.current = { nx, ny };
        if (e.phase === "start") beginProposal(nx, ny);
        else if (e.phase === "move") moveProposal(nx, ny);
        else endProposal();
      },
      flick: (e) => {
        const { nx, ny } = toN(e.x, e.y);
        if (!proposal.active) beginProposal(nx, ny);
        moveProposal(nx, ny);
        endProposal();
        haptics.detent();
        void e;
      },
    };

    letGoRef.current = () => {
      population.letGo();
      persist.generators = [];
      persist.emptied = true;
      proposal.active = false;
      bloom = 0;
      seam = 0;
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ kind: population.spec.kind, items: [], generators: [], emptied: true }),
        );
      } catch {
        /* noop */
      }
      writer.cancel();
      setHasKept(0);
      audio.thud();
      haptics.roll();
    };

    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let hidden = false;
    let galleryPaused = false;
    const offVisibility = onVisibility((h) => {
      hidden = h;
      if (h) gov.force("sleep");
    });
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

    const rotateAbout = (nx: number, ny: number, cx: number, cy: number, theta: number) => {
      const dx = nx - cx;
      const dy = ny - cy;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
    };

    const reflectAbout = (nx: number, ny: number, cx: number, cy: number, k: number) => {
      const axis = thetaOfShift(k) * 0.5;
      const dx = nx - cx;
      const dy = ny - cy;
      const ca = Math.cos(axis);
      const sa = Math.sin(axis);
      const x = dx * ca + dy * sa;
      const y = -dx * sa + dy * ca;
      const xr = x;
      const yr = -y;
      return { x: cx + xr * ca - yr * sa, y: cy + xr * sa + yr * ca };
    };

    let raf = 0;
    let last = performance.now();
    let lastKeptN = population.standing() + persist.generators.length;
    const draw = (t: number) => {
      const tier = gov.beginFrame(t);
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
      bloom *= 1 - Math.min(1, dt / 7);
      seam *= 1 - Math.min(1, dt / 4.2);
      glimmer *= 1 - Math.min(1, dt / 7);
      if (glimmer < 0.02) glimmer = 0;

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

      const ids = classes();
      const c0 = ids[0] != null ? centroidOf(ids[0]) : { cx: 0.5, cy: 0.36 };
      const c1 = ids[1] != null ? centroidOf(ids[1]) : ids[0] != null ? centroidOf(ids[0]) : { cx: 0.5, cy: 0.7 };
      const beat = proposal.active
        ? Math.min(7, (proposal.delta / (Math.PI / ORBIT_N)) * 7)
        : 0;

      if (stage && prog && quad) {
        const sz = stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: agitation, reducedMotion: reduced }),
          prog,
        );
        prog.setFloat("u_wind", wind + tiltX * 0.15);
        prog.setFloat("u_night", night);
        prog.setFloat("u_lens", lens);
        prog.setFloat("u_seam", seam);
        prog.setFloat("u_seamAngle", seamAngle);
        prog.setFloat("u_propose", proposal.active || glimmer > 0.02 ? 1 : 0);
        prog.setFloat("u_consonance", proposal.active ? proposal.consonance : glimmer * 0.85);
        prog.setFloat("u_beat", reduced ? 0 : beat);
        prog.setFloat("u_dilate", 1 - timeScale);
        prog.setFloat("u_kept", persist.generators.length > 0 ? 1 : 0);
        prog.setFloat("u_bloom", bloom);
        prog.setVec2("u_c0", c0.cx, c0.cy);
        prog.setVec2("u_c1", c1.cx, c1.cy);
        quad.draw();

        buffer.reset();
        population.emit(
          {
            width: sz.width,
            height: sz.height,
            tMs: t,
            breath: step.breath,
            detail: detail.particles,
            reducedMotion: reduced,
          },
          buffer,
        );

        const ghostTheta = proposal.active ? proposal.theta : glimmer > 0.02 ? glimmerTheta * glimmer : 0;
        const ghostKind = proposal.active ? proposal.kind : glimmerKind;
        const ghostClass = proposal.active ? proposal.classId : glimmerClass;
        const ghostK = proposal.active ? proposal.k : wrapPose(Math.round((glimmerTheta / (Math.PI * 2)) * ORBIT_N));
        if (ghostTheta !== 0 || (glimmer > 0.02 && ghostKind === "flip") || proposal.active) {
          const { cx, cy } = ghostClass ? centroidOf(ghostClass) : c0;
          for (const s of living(population.items)) {
            if (ghostClass && s.classId !== ghostClass) continue;
            const pt =
              ghostKind === "flip"
                ? reflectAbout(s.nx, s.ny, cx, cy, ghostK)
                : rotateAbout(s.nx, s.ny, cx, cy, ghostTheta);
            buffer.push(
              pt.x * sz.width,
              pt.y * sz.height,
              3.4 + s.growth * 3,
              s.phase,
              classHue(s.classId),
              0.18,
              0.45,
              0.35 * (proposal.active ? 1 : glimmer),
            );
          }
        }

        for (const id of ids) {
          const pred = predictedPoses(libMarks(), id, persist.generators);
          if (pred.length === 0) continue;
          const { cx, cy } = centroidOf(id);
          const r = radiusOf(id);
          const hue = classHue(id);
          for (const pose of pred) {
            const pt = ringPoint(pose, cx, cy, r);
            buffer.push(
              pt.nx * sz.width,
              pt.ny * sz.height,
              3.1,
              pose,
              hue,
              0.12,
              step.breath,
              0.16 + bloom * 0.12,
            );
          }
        }

        layer?.draw(buffer);
      } else if (fallback) {
        const w = canvas.width || wrap.clientWidth;
        const h = canvas.height || wrap.clientHeight;
        fallback.fillStyle = "#05070c";
        fallback.fillRect(0, 0, w, h);
        for (const s of living(population.items)) {
          fallback.fillStyle = `rgba(200,115,42,${0.55 * s.presence})`;
          fallback.beginPath();
          fallback.arc(s.nx * w, s.ny * h, 5 + s.growth * 6, 0, Math.PI * 2);
          fallback.fill();
        }
      }

      const n = population.standing() + persist.generators.length;
      if (n !== lastKeptN) {
        lastKeptN = n;
        setHasKept(n);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onShift = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftRef.current = e.type === "keydown";
      if (e.key === "Tab") {
        e.preventDefault();
        apiRef.current?.cycle();
      }
    };
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);

    return () => {
      cancelAnimationFrame(raf);
      offVisibility();
      offGalleryPause();
      writer.flush();
      layer?.dispose();
      quad?.dispose();
      stage?.dispose();
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
      voiceRef.current = null;
      apiRef.current = null;
    };
  }, []);

  const letGo = useCallback(() => letGoRef.current(), []);

  return (
    <RoomShell
      route="/group"
      chrome={false}
      surfaceRef={wrapRef}
      voice={voiceRef.current ?? undefined}
      letGo={{ label: "let the field go", onLetGo: letGo, visible: hasKept > 0 }}
      onGlimmer={() => glimmerRef.current()}
      keyboard={{
        enter: () => plantRef.current(cursorRef.current.nx, cursorRef.current.ny),
        enterHeld: (elapsed) => {
          const { nx, ny } = cursorRef.current;
          if (elapsed >= THRESHOLDS.ceremonyMs) apiRef.current?.ceremony(nx, ny);
          else apiRef.current?.deepen(elapsed, nx, ny);
        },
        escape: () => apiRef.current?.cancel(),
        arrow: (dx, dy) => {
          if (shiftRef.current) {
            apiRef.current?.proposeFlip();
            return;
          }
          cursorRef.current.nx = Math.min(0.95, Math.max(0.05, cursorRef.current.nx + dx * 0.04));
          cursorRef.current.ny = Math.min(0.95, Math.max(0.05, cursorRef.current.ny + dy * 0.04));
          apiRef.current?.proposeTurn(dx * (Math.PI * 2) / ORBIT_N * 0.25);
        },
      }}
      style={{ position: "fixed", inset: 0, background: "#05070c" }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={canvasRef}
          role="application"
          tabIndex={0}
          aria-label="an incomplete fragment on a dark field — rest a finger and a mark condenses, drag and the fragment turns as one ghost body, a closing move is unison"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        />
      </div>
    </RoomShell>
  );
}
