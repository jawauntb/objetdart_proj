"use client";

/**
 * /plank — the floor of the world, where space is woven.
 *
 * The material is quantum foam: a churning mother-of-pearl froth rendered as
 * one fragment shader. The population is stitches — loops of space, the
 * spin-network quanta of loop quantum gravity — drawn as one instanced pass
 * of lobed rings, threaded by the overlay's flat strokes into the network
 * that *is* space. Where the weave is dense the foam calms; where it is
 * sparse there is no geometry yet, only seethe. Every law the stitches obey
 * lives in src/lib/plank.ts, pure and node-tested; this file only renders
 * what those laws decide and says what each verb of the grammar means here.
 *
 * The tap train climbs: one tap rings a loop, three buds a satellite off it,
 * five sends the loom-wave thread by thread through the whole network, and
 * the peal holds the foam's breath — for one moment the froth smooths into
 * the manifold's geodesic grid, the largest scale glimpsed inside the
 * smallest, over the room's only sub-bass swell.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  onGalleryPause,
  onVisibility,
} from "@/lib/room-runtime";
import { createGLStage, FULLSCREEN_VERT_CLIP } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture";
import {
  bornStitch,
  budFrom,
  collapseStitch,
  findFusePair,
  fuseStitches,
  graphOrder,
  hashSeed,
  holePhase,
  loadWeave,
  mulberry32,
  retireOldest,
  serializeWeave,
  spinPitchMidi,
  spinRadius,
  stepWeave,
  waveHz,
  weaveLinks,
  SPIN_COLLAPSE,
  STITCH_CAP,
  type FieldInput,
  type Link,
  type Stitch,
} from "@/lib/plank";

const STORAGE_KEY = "objetdart:plank:v1";
const ROOM_SEED = 0x91a7c3;

// ——— the foam: one fragment shader, nacre over the void ————————————————
const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_breath;
uniform float u_turbulence;
uniform float u_brightness;
uniform float u_reduced;
uniform float u_epoch;
uniform float u_lens;
uniform float u_grid;
uniform float u_dilate;
uniform float u_night;
uniform float u_octaves;
uniform vec3 u_vortex;
uniform vec2 u_windv;
uniform float u_calm[48];
uniform float u_calmCount;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 s = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), s.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), s.x),
    s.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= u_octaves) break;
    v += a * noise(p);
    p = p * 2.03 + vec2(17.13, 9.71);
    a *= 0.55;
  }
  return v;
}
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 ap = vec2(uv.x * aspect, uv.y);
  float t = u_time * (0.22 + u_epoch * 0.55) * u_dilate * (1.0 - 0.85 * u_reduced);

  // frame-dragging: the scrub's vortex turns the metric itself
  vec2 vc = vec2(u_vortex.x * aspect, u_vortex.y);
  vec2 rel = ap - vc;
  float sw = u_vortex.z * exp(-length(rel) * 4.0);
  float cA = cos(sw);
  float sA = sin(sw);
  vec2 p = vc + vec2(rel.x * cA - rel.y * sA, rel.x * sA + rel.y * cA);
  p += u_windv * 0.15;

  // the weave calms the sea: where stitches stand, geometry holds still
  float calm = 0.0;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= u_calmCount) break;
    vec2 c = vec2(u_calm[i * 3] * aspect, u_calm[i * 3 + 1]);
    calm += smoothstep(u_calm[i * 3 + 2], 0.0, distance(ap, c));
  }
  calm = clamp(calm, 0.0, 1.0);
  float amp = (1.0 - 0.72 * calm) * (1.0 - 0.85 * u_grid) * (0.8 + 0.35 * u_breath);

  // domain-warped froth — the churn of geometry with nothing to stand on
  vec2 q = vec2(fbm(p * 3.0 + vec2(0.0, t * 0.6)), fbm(p * 3.0 + vec2(5.2, 1.3) - t * 0.5));
  vec2 r = vec2(
    fbm(p * 3.0 + q * 2.4 + vec2(1.7, 9.2) + t * 0.23),
    fbm(p * 3.0 + q * 2.4 + vec2(8.3, 2.8) - t * 0.19)
  );
  float f = fbm(p * 3.0 + r * 2.2);
  float fr = 1.0 - abs(2.0 * f - 1.0);
  float froth = fr * fr * fr;
  // a fine cellular grain over the broad churn — the froth's froth
  float fine = 1.0 - abs(2.0 * noise(p * 9.0 + r * 3.0 + vec2(0.0, t * 0.3)) - 1.0);
  froth += fine * fine * fine * 0.35;

  // nacre: the iridescence comes from the warp, like light in shell
  float hue = f * 1.6 + q.x * 0.9 + r.y * 0.7 + u_epoch * 0.6;
  vec3 nacre = 0.5 + 0.5 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67)));
  nacre = mix(vec3(dot(nacre, vec3(0.333))), nacre, 0.55);

  vec3 deep = mix(vec3(0.016, 0.010, 0.030), vec3(0.052, 0.016, 0.040), u_epoch);
  vec3 col = deep;
  col += nacre * froth * amp * (0.30 + 0.28 * u_brightness);
  col += vec3(0.9, 0.85, 1.0) * froth * froth * amp * 0.35;
  col += vec3(0.05, 0.03, 0.09) * u_turbulence;
  col += vec3(0.09, 0.11, 0.15) * calm * (0.4 + 0.3 * u_breath) * (1.0 - froth * 0.5);

  // the lens: foam, then the bare network, then the metric made legible
  float wNet = 1.0 - min(1.0, abs(u_lens - 1.0));
  float wMet = max(0.0, u_lens - 1.0);
  float wFoam = max(0.0, 1.0 - u_lens);
  col *= wFoam + 0.28 * (1.0 - wFoam);
  vec2 gp = fract(ap * 14.0) - 0.5;
  float paper = (1.0 - smoothstep(0.0, 0.05, abs(gp.x))) + (1.0 - smoothstep(0.0, 0.05, abs(gp.y)));
  col += vec3(0.08, 0.14, 0.16) * paper * wNet * 0.5;
  float cont = 1.0 - smoothstep(0.0, 0.1, abs(fract(f * 12.0) - 0.5));
  col += mix(vec3(0.15, 0.35, 0.45), vec3(0.75, 0.35, 0.2), f) * cont * wMet * 0.55;

  // coherence: at the peal the froth remembers it is a manifold
  vec2 gc = ap - vec2(0.5 * aspect, 0.5);
  vec2 gg = ap + gc * dot(gc, gc) * 0.85;
  vec2 gf = fract(gg * 7.0) - 0.5;
  float grid = (1.0 - smoothstep(0.0, 0.045, abs(gf.x))) + (1.0 - smoothstep(0.0, 0.045, abs(gf.y)));
  col += vec3(0.30, 0.38, 0.52) * grid * u_grid * 0.8;

  col *= 1.0 - 0.82 * u_night;
  gl_FragColor = vec4(col, 1.0);
}`;

// ——— the stitch sprite: a lobed ring for a loop, an ember pinprick for a
// hole. Spin is the lobe count; the evaporation clock rides vPhase.
const STITCH_FRAG = `precision mediump float;
varying vec2 vLocal;
varying float vHue;
varying float vGlow;
varying float vPhase;
varying float vAlpha;
uniform vec3 u_palA;
uniform vec3 u_palB;
uniform vec3 u_palC;
vec3 palette(float h) {
  h = clamp(h, 0.0, 1.0);
  return h < 0.5 ? mix(u_palA, u_palB, h * 2.0) : mix(u_palB, u_palC, (h - 0.5) * 2.0);
}
void main() {
  float d = length(vLocal);
  float isHole = step(0.92, vHue);
  float ang = atan(vLocal.y, vLocal.x);

  float lobes = 2.0 + floor(vHue * 12.5);
  float wob = sin(ang * lobes + vPhase * 6.2831) * 0.07;
  float ringD = abs(d - (0.6 + wob));
  float line = 1.0 - smoothstep(0.06 + 0.05 * vGlow, 0.18 + 0.06 * vGlow, ringD);
  float corona = exp(-d * d * 2.0) * (0.25 + vGlow * 0.55);
  vec3 loopC = palette(min(vHue, 0.85));
  float aLoop = (line * (0.85 + 0.15 * vGlow) + corona) * vAlpha * (1.0 - isHole);

  // the hole darkens what is behind it — premultiplied alpha is the shadow
  float core = 1.0 - smoothstep(0.16, 0.5, d);
  float rim = 1.0 - smoothstep(0.02, 0.1, abs(d - 0.52));
  float grainR = 0.6 + (1.0 - vPhase) * 1.1;
  float grains = exp(-abs(d - grainR) * 8.0) * (0.5 + 0.5 * sin(ang * 7.0 + vPhase * 31.0));
  vec3 ember = vec3(0.98, 0.62, 0.30);
  float aHole = isHole * vAlpha;
  vec3 col = loopC * aLoop + ember * (rim * 0.8 + grains * (1.0 - vPhase) * 0.7) * aHole;
  float a = clamp(aLoop + core * 0.85 * aHole + (rim * 0.5 + grains * 0.4) * aHole, 0.0, 1.0);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

type PopEffect = { x: number; y: number; t0: number; seed: number; kind: number };

type Api = {
  tap(e: { count: number; intensity: number; x: number; y: number }): void;
  stepBack(): void;
  tutti(intensity: number): void;
  plant(x: number, y: number): void;
  deepen(elapsed: number): void;
  settle(elapsed: number): void;
  ceremony(x: number, y: number): void;
  timeScale(k: number): void;
  drag(phase: string, x: number, y: number, dx: number, dy: number, vx: number, vy: number): void;
  wind(dx: number, dy: number): void;
  flick(angle: number, speed: number, x: number, y: number): void;
  stir(winding: number, angularVelocity: number, cx: number, cy: number): void;
  sustain(phase: string, spread: number, elapsed: number, ax: number, ay: number, bx: number, by: number): void;
  lens(velocity: number): void;
  season(velocity: number): void;
  rhythm(bpm: number, stability: number): void;
  scatter(intensity: number): void;
  gravity(beta: number, gamma: number): void;
  knock(intensity: number): void;
  night(faceDown: boolean): void;
  glimmer(): void;
  weaveAt(nx: number, ny: number): void;
  letGo(): void;
};

export default function Plank() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const [standing, setStanding] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const overlayCanvas = overlayRef.current;
    if (!wrap || !canvas || !overlayCanvas) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ——— the standing weave, from the laws in lib/plank ———
    let sts: Stitch[] = [];
    let links: Link[] = [];
    let nextId = 1;
    const writer = createIdleWriter(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeWeave(sts)));
      } catch {
        /* quota / private mode — the room still plays */
      }
    });
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) sts = loadWeave(JSON.parse(raw), performance.now());
    } catch {
      /* a fresh floor */
    }
    if (sts.length === 0) {
      // three starter stitches, seeded — the loom is never bare on arrival
      const rng = mulberry32(ROOM_SEED);
      for (let i = 0; i < 3; i++) {
        const s = bornStitch(nextId++, hashSeed(ROOM_SEED, i), 0.3 + rng() * 0.4, 0.35 + rng() * 0.3, performance.now());
        s.growth = 1;
        sts.push(s);
      }
    }
    for (const s of sts) nextId = Math.max(nextId, s.id + 1);
    setStanding(sts.length);

    // ——— the world's own fields ———
    const world = {
      windX: 0,
      windY: 0,
      gravX: 0,
      gravY: 0,
      agitation: 0,
      epoch: 0.35,
      lens: 0,
      coherence: 0,
      timeScaleK: 1,
      vortexX: 0.5,
      vortexY: 0.5,
      vortexW: 0,
      night: 0,
      nightTarget: 0,
      rhythmK: 1,
      rhythmUntil: 0,
    };
    let heldIdx = -1;
    let weavingIdx = -1;
    let weavingFresh = false;
    let prevWinding = 0;
    const wave = { active: false, t0: 0, order: [] as number[], stepMs: 130 };
    const span = { active: false, ax: 0, ay: 0, bx: 0, by: 0, hz: 440, lastToneAt: 0 };
    const wake: number[] = new Array(24).fill(-1); // x,y triples ring buffer
    let wakeHead = 0;
    const pops: PopEffect[] = [];
    for (let i = 0; i < 16; i++) pops.push({ x: 0, y: 0, t0: -1e9, seed: 0, kind: 0 });
    let popHead = 0;
    let lastAmbientSlot = -1;
    let lastPluckAt = 0;
    let lastGrainAt = 0;

    const W = () => Math.max(1, wrap.clientWidth);
    const H = () => Math.max(1, wrap.clientHeight);
    const soft = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* haptics or audio unavailable — the room still plays */
      }
    };

    const markLens = () => {
      if (world.lens > 0.12) wrap.setAttribute("data-lens-raised", "1");
      else wrap.removeAttribute("data-lens-raised");
    };

    const nearest = (nx: number, ny: number, reach: number): number => {
      let best = -1;
      let bestD = reach * reach;
      for (let i = 0; i < sts.length; i++) {
        const s = sts[i];
        if (s.presence < 0.6) continue;
        const dx = s.nx - nx;
        const dy = s.ny - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      return best;
    };

    const addPop = (x: number, y: number, kind: number, seed: number) => {
      const p = pops[popHead];
      popHead = (popHead + 1) % pops.length;
      p.x = x;
      p.y = y;
      p.t0 = performance.now();
      p.seed = seed;
      p.kind = kind;
    };

    const spawnAt = (nx: number, ny: number, tMs: number): number => {
      let live = 0;
      for (const s of sts) if (s.presence >= 1) live++;
      if (live >= STITCH_CAP) {
        // the cap unravels the oldest, visibly — never a silent no-op
        retireOldest(sts);
        soft(() => audio.buzz());
      }
      const s = bornStitch(nextId, hashSeed(ROOM_SEED, nextId, Math.floor(nx * 997), Math.floor(ny * 997)), nx, ny, tMs);
      nextId++;
      sts.push(s);
      return sts.length - 1;
    };

    const ringStitch = (i: number, k: number) => {
      const s = sts[i];
      if (!s || s.holeMs !== null) return;
      s.ring = Math.min(1, s.ring + k);
      soft(() => audio.playNote(spinPitchMidi(s.j), 200 + 420 * k));
    };

    apiRef.current = {
      tap(e) {
        const nx = e.x / W();
        const ny = e.y / H();
        const trainTier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (trainTier === "n") {
          // the peal: the foam holds its breath and shows the manifold —
          // and it keeps deepening while the train keeps landing
          world.coherence = Math.min(1, 0.75 + depth * 0.35);
          soft(() => audio.playTone(46.2, 2.8));
          soft(() => audio.bell());
          soft(() => haptics.storm());
          if (sts.length > 0) {
            wave.active = true;
            wave.t0 = performance.now();
            wave.order = graphOrder(sts, links, nearest(0.5, 0.5, 2));
            wave.stepMs = 90;
          }
          return;
        }
        if (trainTier === 5) {
          if (e.count > 5 || wave.active) {
            // inside the rung the wave already running gains brightness
            for (const s of sts) s.ring = Math.min(1, s.ring + 0.1 + depth * 0.1);
            return;
          }
          // the loom-wave: curvature sweeps the network thread by thread
          const from = nearest(nx, ny, 2);
          if (from >= 0) {
            wave.active = true;
            wave.t0 = performance.now();
            wave.order = graphOrder(sts, links, from);
            wave.stepMs = 130;
            ringStitch(from, 0.6 + e.intensity * 0.4);
            soft(() => haptics.roll());
          } else {
            world.coherence = Math.min(1, world.coherence + 0.25);
            soft(() => audio.chime());
          }
          return;
        }
        if (trainTier === 3) {
          // the transformation fires once per train; staying on the rung
          // keeps ringing what it made rather than minting again
          if (e.count > 3) {
            const near = nearest(nx, ny, 0.2);
            if (near >= 0) ringStitch(near, 0.3 + depth * 0.4);
            return;
          }
          const i = nearest(nx, ny, 0.16);
          const parent = i >= 0 ? sts[i] : null;
          const child = parent ? budFrom(parent, nextId, performance.now()) : null;
          if (parent && child) {
            nextId++;
            sts.push(child);
            soft(() => audio.spark());
            soft(() => audio.playNote(spinPitchMidi(parent.j), 240));
            soft(() => audio.playNote(spinPitchMidi(child.j), 320));
            soft(() => haptics.bloom());
            writer.schedule();
          } else {
            // no spin to give: the vacuum answers with a brighter borrowed pair
            addPop(nx, ny, 1, hashSeed(ROOM_SEED, e.count, Math.floor(nx * 512)));
            soft(() => audio.spark());
            soft(() => haptics.ripple(0.6));
          }
          return;
        }
        // one tap: ring the nearest loop; on bare foam a virtual pair pops
        const i = nearest(nx, ny, 0.14);
        if (i >= 0) {
          ringStitch(i, 0.4 + 0.6 * e.intensity);
          soft(() => haptics.tap());
        } else {
          addPop(nx, ny, 0, hashSeed(ROOM_SEED, Math.floor(nx * 512), Math.floor(ny * 512)));
          soft(() => audio.playNote(96 + Math.round(e.intensity * 6), 140));
          soft(() => haptics.tap());
        }
      },
      stepBack() {
        // the frame's retreat belongs to ScaleTravel; this room only lowers
        // its lens first, as the grammar asks
        if (world.lens > 0.12) {
          world.lens = 0;
          markLens();
          soft(() => haptics.lens());
          soft(() => audio.chime());
        } else {
          for (const s of sts) s.ring = Math.min(1, s.ring + 0.08);
        }
      },
      tutti(intensity) {
        // the network states its chord — every distinct spin, softly at once
        let played = 0;
        let lastJ = -1;
        for (const s of sts) {
          if (s.holeMs !== null) continue;
          s.ring = Math.min(1, s.ring + 0.35);
          if (s.j !== lastJ && played < 6) {
            soft(() => audio.playNote(spinPitchMidi(s.j), 500));
            lastJ = s.j;
            played++;
          }
        }
        world.coherence = Math.min(1, world.coherence + 0.15 * intensity);
        soft(() => haptics.bloom());
      },
      plant(x, y) {
        const nx = x / W();
        const ny = y / H();
        const i = nearest(nx, ny, 0.12);
        if (i >= 0 && sts[i].holeMs === null) {
          weavingIdx = i;
          weavingFresh = false;
        } else {
          weavingIdx = spawnAt(nx, ny, performance.now());
          weavingFresh = true;
          soft(() => audio.spark());
        }
        soft(() => haptics.ripple(0.4));
      },
      deepen(elapsed) {
        // the hold keeps counting and the loop keeps gathering — spin climbs
        // rung by rung, each one lower-voiced, and past the limit the weave
        // makes a hole of it: the overweave is real
        const s = sts[weavingIdx];
        if (!s || s.holeMs !== null) return;
        s.ring = Math.min(1, s.ring + 0.04);
        s.growth = Math.min(1, s.growth + 0.02);
        const target = (weavingFresh ? 1 : s.j) + Math.max(0, Math.floor((elapsed - 900) / 650));
        if (weavingFresh && target > s.j && s.j < SPIN_COLLAPSE + 1) {
          s.j = target;
          if (s.j > SPIN_COLLAPSE) {
            collapseStitch(s, performance.now());
            soft(() => audio.thud());
            soft(() => haptics.storm());
          } else {
            soft(() => audio.playNote(spinPitchMidi(s.j), 180));
            soft(() => haptics.detent());
          }
        }
      },
      settle(elapsed) {
        const s = sts[weavingIdx];
        if (s && weavingFresh && elapsed < 900 && s.holeMs === null) {
          // lifted before the dwell: the gathering disperses on an exhale
          s.presence = 0.6;
          soft(() => audio.playNote(84, 160));
        } else if (s && s.holeMs === null) {
          s.growth = 1;
          soft(() => audio.playNote(spinPitchMidi(s.j), 420));
          soft(() => haptics.ripple(0.5));
          writer.schedule();
        }
        weavingIdx = -1;
        weavingFresh = false;
      },
      ceremony(x, y) {
        // the solemn act and the touch-reachable delete are one gesture: a
        // loop pressed past its limit becomes a pinprick hole and evaporates
        // in j³ time, giving its light back to the foam
        const i = nearest(x / W(), y / H(), 0.14);
        if (i >= 0 && sts[i].holeMs === null) {
          collapseStitch(sts[i], performance.now());
          soft(() => audio.thud());
          soft(() => haptics.storm());
          writer.schedule();
        } else {
          // on bare foam the ceremony keeps the whole weave, deliberately
          for (const s of sts) if (s.holeMs === null) s.growth = 1;
          writer.flush();
          soft(() => audio.bell());
          soft(() => haptics.roll());
        }
      },
      timeScale(k) {
        world.timeScaleK = k;
      },
      drag(phase, x, y, dx, dy, vx, vy) {
        const nx = x / W();
        const ny = y / H();
        if (phase === "start") {
          heldIdx = nearest(nx, ny, 0.12);
          if (heldIdx >= 0 && sts[heldIdx].holeMs !== null) heldIdx = -1;
          return;
        }
        if (phase === "end") {
          heldIdx = -1;
          return;
        }
        if (heldIdx >= 0 && sts[heldIdx]) {
          // carrying a loop: the hand's road to fusion
          const s = sts[heldIdx];
          s.nx = Math.min(0.97, Math.max(0.03, nx));
          s.ny = Math.min(0.97, Math.max(0.03, ny));
          s.vx = vx / W();
          s.vy = vy / H();
        } else {
          // stirring bare foam: a curvature wake the drift remembers
          wake[wakeHead * 3] = nx;
          wake[wakeHead * 3 + 1] = ny;
          wake[wakeHead * 3 + 2] = performance.now();
          wakeHead = (wakeHead + 1) % 8;
          for (const s of sts) {
            const ddx = s.nx - nx;
            const ddy = s.ny - ny;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < 0.03) {
              s.vx += (dx / W()) * 6 * Math.exp(-d2 * 60);
              s.vy += (dy / H()) * 6 * Math.exp(-d2 * 60);
            }
          }
          const now = performance.now();
          if (now - lastGrainAt > 120) {
            lastGrainAt = now;
            soft(() => audio.playTone(900 + 700 * ny, 0.05));
          }
        }
      },
      wind(dx, dy) {
        world.windX = Math.max(-1, Math.min(1, world.windX + dx * 2.4));
        world.windY = Math.max(-1, Math.min(1, world.windY + dy * 2.4));
      },
      flick(angle, speed, x, y) {
        const i = nearest(x / W(), y / H(), 0.18);
        if (i < 0) return;
        const s = sts[i];
        const k = Math.min(3, speed) * 0.22;
        s.vx = Math.cos(angle) * k;
        s.vy = Math.sin(angle) * k;
        s.ring = Math.min(1, s.ring + 0.5);
        soft(() => audio.playNote(spinPitchMidi(s.j) + 2, 160));
        soft(() => haptics.chop());
      },
      stir(winding, angularVelocity, cx, cy) {
        // frame-dragging: the circling hand twists spacetime into a well
        world.vortexX = cx / W();
        world.vortexY = cy / H();
        world.vortexW = Math.max(-2.4, Math.min(2.4, angularVelocity * 0.8));
        const wAbs = Math.floor(Math.abs(winding));
        if (wAbs > prevWinding) {
          prevWinding = wAbs;
          soft(() => haptics.detent());
          soft(() => audio.playTone(180 * Math.pow(2, -Math.min(3, wAbs) * 0.33), 0.4));
        }
        if (Math.abs(winding) < 0.2) prevWinding = 0;
      },
      sustain(phase, spread, elapsed, ax, ay, bx, by) {
        if (phase === "release") {
          span.active = false;
          // the released interval plucks whatever stands along it
          for (const s of sts) s.ring = Math.min(1, s.ring + 0.2);
          soft(() => audio.chime());
          return;
        }
        span.active = true;
        span.ax = ax / W();
        span.ay = ay / H();
        span.bx = bx / W();
        span.by = by / H();
        span.hz = waveHz(spread);
        const now = performance.now();
        if (phase === "enter" || now - span.lastToneAt > 700) {
          span.lastToneAt = now;
          soft(() => audio.playTone(span.hz, 0.8 + Math.min(2, elapsed / 3000)));
          if (phase === "enter") soft(() => haptics.tap());
        }
      },
      lens(velocity) {
        world.lens = Math.max(0, Math.min(2, world.lens + velocity * 0.02));
        markLens();
      },
      season(velocity) {
        // the epoch dial: cold calm vacuum around to Planck-era fury
        const before = world.epoch;
        world.epoch = ((world.epoch + velocity * 0.014) % 1 + 1) % 1;
        if (Math.floor(before * 4) !== Math.floor(world.epoch * 4)) {
          soft(() => haptics.lens());
          soft(() => audio.chime());
        }
      },
      rhythm(bpm, stability) {
        if (stability < 0.7) return;
        world.rhythmK = Math.max(0.5, Math.min(2, bpm / 72));
        world.rhythmUntil = performance.now() + 9000;
        soft(() => audio.chime());
      },
      scatter(intensity) {
        world.agitation = Math.max(world.agitation, Math.min(1, intensity));
        soft(() => audio.buzz());
        soft(() => haptics.chop());
      },
      gravity(beta, gamma) {
        world.gravX = Math.max(-1, Math.min(1, gamma / 45));
        world.gravY = Math.max(-1, Math.min(1, beta / 70));
      },
      knock(intensity) {
        // a knock on the underside of the floor: the whole weave jumps
        for (const s of sts) {
          const rng = mulberry32(hashSeed(s.seed, 0xdead));
          s.vx += (rng() - 0.5) * 0.09 * intensity;
          s.vy += (rng() - 0.5) * 0.09 * intensity;
          s.ring = Math.min(1, s.ring + 0.35 * intensity);
        }
        soft(() => audio.thud());
        soft(() => haptics.chop());
      },
      night(faceDown) {
        world.nightTarget = faceDown ? 1 : 0;
        if (faceDown) soft(() => haptics.roll());
      },
      glimmer() {
        // the idle hint is physical: the vacuum borrows a pair where a
        // finger might rest, and gives it back
        const rng = mulberry32(hashSeed(ROOM_SEED, Math.floor(performance.now() / 1000)));
        addPop(0.25 + rng() * 0.5, 0.3 + rng() * 0.4, 1, hashSeed(ROOM_SEED, 0x91));
        soft(() => audio.playNote(93, 220));
      },
      weaveAt(nx, ny) {
        const idx = spawnAt(nx, ny, performance.now());
        sts[idx].growth = 1;
        soft(() => audio.spark());
        soft(() => haptics.ripple(0.5));
        writer.schedule();
      },
      letGo() {
        // an exhale, never a blink — and an emptied floor stays empty
        for (const s of sts) s.presence = Math.min(s.presence, 0.95);
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, stitches: [] }));
        } catch {
          /* noop */
        }
        writer.cancel();
        setStanding(0);
        soft(() => audio.thud());
        soft(() => haptics.roll());
      },
    };

    // ——— the stage: one GL context, two passes, one overlay ———
    const stage = createGLStage(canvas, { wrap, label: "plank", reducedMotion: reduced, overlay: overlayCanvas });
    const prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    const layer = stage
      ? createPopulationLayer(stage, {
          palette: ["#7fd4c9", "#cfc3e8", "#f0e7c8"],
          frag: STITCH_FRAG,
        })
      : null;
    const buffer = createInstanceBuffer(256);
    const calm = new Float32Array(48);

    const gov = createFrameGovernor();
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

    const input: FieldInput = {
      windX: 0,
      windY: 0,
      gravX: 0,
      gravY: 0,
      agitation: 0,
      vortexX: 0.5,
      vortexY: 0.5,
      vortexW: 0,
      epoch: 0.35,
      timeScale: 1,
      reduced,
    };

    const prevKeys = new Set<number>();
    const curKeys = new Set<number>();

    let raf = 0;
    let last = performance.now();
    let lastStanding = -1;
    const draw = (t: number) => {
      const tier = gov.beginFrame(t);
      if (hidden || galleryPaused) {
        last = t;
        raf = requestAnimationFrame(draw);
        return;
      }
      const detail = detailForTier(tier);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const tSec = audio.getAudioTime() ?? t / 1000;
      const breath = reduced ? 0.5 : Math.sin(tSec * Math.PI * 2 * 0.14) * 0.5 + 0.5;
      const wPx = W();
      const hPx = H();

      // fields decay toward rest
      world.windX *= 0.985;
      world.windY *= 0.985;
      world.agitation *= 0.955;
      world.vortexW *= 0.97;
      world.coherence *= Math.exp(-dt / 1.6);
      world.night += (world.nightTarget - world.night) * Math.min(1, dt * 3);
      const rhythmK = t < world.rhythmUntil ? world.rhythmK : 1;

      input.windX = world.windX;
      input.windY = world.windY;
      input.gravX = world.gravX;
      input.gravY = world.gravY;
      input.agitation = world.agitation;
      input.vortexX = world.vortexX;
      input.vortexY = world.vortexY;
      input.vortexW = world.vortexW;
      input.epoch = world.epoch;
      input.timeScale = world.timeScaleK * rhythmK;

      stepWeave(sts, links, input, t, dt);
      links = weaveLinks(sts);

      // a thread that snapped is heard — the weave plucks
      curKeys.clear();
      for (const l of links) curKeys.add(sts[l.a].id * 4096 + sts[l.b].id);
      if (t - lastPluckAt > 160) {
        for (const k of prevKeys) {
          if (!curKeys.has(k)) {
            soft(() => audio.buzz());
            soft(() => haptics.tap());
            lastPluckAt = t;
            break;
          }
        }
      }
      prevKeys.clear();
      for (const k of curKeys) prevKeys.add(k);

      // fusion: two loops drawn together become a third thing
      const pair = findFusePair(sts);
      if (pair) {
        const [ia, ib] = pair;
        const child = fuseStitches(sts[ia], sts[ib], nextId++, t);
        addPop(child.nx, child.ny, 2, child.seed);
        sts[ia].presence = 0;
        sts[ib].presence = 0;
        sts.push(child);
        if (heldIdx === ia || heldIdx === ib) heldIdx = -1;
        if (weavingIdx === ia || weavingIdx === ib) weavingIdx = -1;
        soft(() => audio.chime());
        soft(() => audio.playNote(spinPitchMidi(child.j), 500));
        soft(() => haptics.bloom());
        writer.schedule();
      }

      // the loom-wave front, walking the graph
      if (wave.active) {
        const front = (t - wave.t0) / wave.stepMs;
        let alive = false;
        for (let i = 0; i < sts.length && i < wave.order.length; i++) {
          const d = wave.order[i];
          if (d < 0) continue;
          if (d > front) {
            alive = true;
            continue;
          }
          if (d > front - 1 && sts[i].ring < 0.5) {
            sts[i].ring = 1;
            soft(() => audio.playNote(spinPitchMidi(sts[i].j), 220));
          }
        }
        if (!alive) wave.active = false;
      }

      // the vacuum borrows on its own seeded clock
      const slot = Math.floor(t / 3800);
      if (slot !== lastAmbientSlot && !reduced) {
        lastAmbientSlot = slot;
        const rng = mulberry32(hashSeed(ROOM_SEED, slot));
        if (rng() < 0.6) addPop(0.1 + rng() * 0.8, 0.12 + rng() * 0.76, 0, hashSeed(ROOM_SEED, slot, 3));
      }

      // retire the spent
      for (let i = sts.length - 1; i >= 0; i--) {
        if (sts[i].presence <= 0) {
          sts.splice(i, 1);
          if (heldIdx === i) heldIdx = -1;
          else if (heldIdx > i) heldIdx--;
          if (weavingIdx === i) weavingIdx = -1;
          else if (weavingIdx > i) weavingIdx--;
        }
      }

      // ——— render ———
      if (stage) {
        const size = stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: world.agitation, reducedMotion: reduced }),
          prog,
        );
        if (prog) {
          prog.setFloat("u_epoch", world.epoch);
          prog.setFloat("u_lens", world.lens);
          prog.setFloat("u_grid", world.coherence);
          prog.setFloat("u_dilate", input.timeScale);
          prog.setFloat("u_night", world.night);
          prog.setFloat("u_octaves", Math.max(2, Math.round(2 + detail.particles * 2)));
          prog.setVec3("u_vortex", world.vortexX, world.vortexY, world.vortexW);
          prog.setVec2("u_windv", world.windX, world.windY);
          // the sixteen strongest loops calm the foam around themselves
          let cn = 0;
          for (let i = 0; i < sts.length && cn < 16; i++) {
            const s = sts[i];
            if (s.holeMs !== null || s.presence < 0.8) continue;
            calm[cn * 3] = s.nx;
            calm[cn * 3 + 1] = s.ny;
            calm[cn * 3 + 2] = 0.05 + s.j * 0.014 + s.growth * 0.02;
            cn++;
          }
          prog.setFloatArray("u_calm", calm);
          prog.setFloat("u_calmCount", cn);
        }
        quad?.draw();

        buffer.reset();
        const m = Math.min(size.width, size.height);
        for (const s of sts) {
          const px = s.nx * size.width;
          const py = s.ny * size.height;
          if (s.holeMs !== null) {
            const ph = holePhase(s, t);
            buffer.push(px, py, spinRadius(s.holeJ) * m * 1.6, 0, 0.97, 1, ph, s.presence);
            continue;
          }
          const wobPhase = (tSec * (0.1 + (s.seed % 7) * 0.01) + s.seed * 0.001) % 1;
          buffer.push(
            px,
            py,
            spinRadius(s.j) * m * (0.85 + 0.2 * breath) * (0.4 + 0.6 * s.growth),
            0,
            0.06 + ((s.j - 1) / (SPIN_COLLAPSE - 1)) * 0.74,
            0.25 + s.ring * 0.75,
            wobPhase,
            s.presence * (0.55 + 0.45 * s.growth),
          );
        }
        // transient pops: the vacuum's borrowed pairs, and fusion blooms
        for (const p of pops) {
          const age = (t - p.t0) / 700;
          if (age < 0 || age >= 1) continue;
          const rng = mulberry32(p.seed);
          const ang = rng() * Math.PI * 2;
          const spread = Math.sin(age * Math.PI) * (p.kind === 2 ? 0.05 : 0.02) * (1 + p.kind);
          const a = (1 - age) * (p.kind === 2 ? 0.8 : 0.45);
          buffer.push(
            (p.x + Math.cos(ang) * spread) * size.width,
            (p.y + Math.sin(ang) * spread) * size.height,
            m * 0.008 * (1 + p.kind),
            0,
            0.5,
            0.9,
            age,
            a,
          );
          buffer.push(
            (p.x - Math.cos(ang) * spread) * size.width,
            (p.y - Math.sin(ang) * spread) * size.height,
            m * 0.008 * (1 + p.kind),
            0,
            0.3,
            0.9,
            age,
            a,
          );
        }
        layer?.draw(buffer);

        // ——— the overlay: the threads of the weave, flat strokes only ———
        const ctx = stage.overlay2d;
        if (ctx) {
          ctx.clearRect(0, 0, size.width, size.height);
          const lensNet = 1 - Math.min(1, Math.abs(world.lens - 1));
          ctx.lineWidth = 1.25 + lensNet * 0.85;
          for (const l of links) {
            const A = sts[l.a];
            const B = sts[l.b];
            const glow = Math.max(A.ring, B.ring);
            const a =
              (0.2 + 0.4 * (1 - l.strain) + glow * 0.4 + lensNet * 0.3) *
              Math.min(A.presence, B.presence) *
              (1 - world.night * 0.8);
            if (a <= 0.02) continue;
            ctx.globalAlpha = Math.min(0.85, a);
            ctx.strokeStyle = l.strain > 0.9 ? "#e8b46a" : "#8fd8ce";
            ctx.beginPath();
            ctx.moveTo(A.nx * size.width, A.ny * size.height);
            ctx.lineTo(B.nx * size.width, B.ny * size.height);
            ctx.stroke();
          }
          // the standing wave held open between two still fingers
          if (span.active) {
            const ax = span.ax * size.width;
            const ay = span.ay * size.height;
            const bx = span.bx * size.width;
            const by = span.by * size.height;
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = "#cfc3e8";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
            const nodes = 9;
            for (let i = 1; i < nodes; i++) {
              const u = i / nodes;
              const amp = Math.abs(Math.sin(u * Math.PI * 3)) * (6 + 5 * breath);
              const px = ax + (bx - ax) * u;
              const py = ay + (by - ay) * u;
              const wobble = Math.sin(tSec * span.hz * 0.05 + u * 9) * amp;
              ctx.globalAlpha = 0.35 + 0.3 * Math.abs(Math.sin(u * Math.PI * 3));
              ctx.beginPath();
              ctx.arc(px, py + wobble, 2.2, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
          // the drag's wake: the curvature the finger left behind
          ctx.strokeStyle = "#a9b8d8";
          for (let i = 0; i < 8; i++) {
            const bx2 = wake[i * 3];
            const t0 = wake[i * 3 + 2];
            if (bx2 < 0) continue;
            const age = (t - t0) / 900;
            if (age >= 1) continue;
            ctx.globalAlpha = (1 - age) * 0.25;
            ctx.beginPath();
            ctx.arc(bx2 * size.width, wake[i * 3 + 1] * size.height, 6 + age * 26, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }

      let live = 0;
      for (const s of sts) if (s.presence > 0.6 && s.holeMs === null) live++;
      if (live !== lastStanding) {
        lastStanding = live;
        setStanding(live);
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
      apiRef.current = null;
    };
  }, []);

  // ——— the voice: what each verb of the grammar means in this material ———
  const voice = useMemo(
    () => ({
      tap: (e: { fingers: number; count: number; intensity: number; x: number; y: number }) =>
        // the train rides through whole: count picks the rung, intensity the weight
        apiRef.current?.tap({ count: e.count, intensity: e.intensity, x: e.x, y: e.y }),
      stepBack: () => apiRef.current?.stepBack(),
      tutti: (e: { intensity: number }) => apiRef.current?.tutti(e.intensity),
      plant: (e: { x: number; y: number }) => apiRef.current?.plant(e.x, e.y),
      deepen: (e: { elapsed: number }) => apiRef.current?.deepen(e.elapsed),
      settle: (e: { elapsed: number }) => apiRef.current?.settle(e.elapsed),
      ceremony: (e: { x: number; y: number }) => apiRef.current?.ceremony(e.x, e.y),
      timeScale: (k: number) => apiRef.current?.timeScale(k),
      drag: (e: { phase: "start" | "move" | "end"; x: number; y: number; dx: number; dy: number; vx: number; vy: number }) =>
        apiRef.current?.drag(e.phase, e.x, e.y, e.dx, e.dy, e.vx, e.vy),
      wind: (e: { dx: number; dy: number }) => apiRef.current?.wind(e.dx, e.dy),
      flick: (e: { angle: number; speed: number; x: number; y: number }) =>
        apiRef.current?.flick(e.angle, e.speed, e.x, e.y),
      stir: (e: { winding: number; angularVelocity: number; cx: number; cy: number }) =>
        apiRef.current?.stir(e.winding, e.angularVelocity, e.cx, e.cy),
      sustain: (e: {
        phase: "enter" | "tick" | "release";
        spread: number;
        elapsed: number;
        ax: number;
        ay: number;
        bx: number;
        by: number;
      }) => apiRef.current?.sustain(e.phase, e.spread, e.elapsed, e.ax, e.ay, e.bx, e.by),
      lens: (e: { velocity: number }) => apiRef.current?.lens(e.velocity),
      season: (e: { velocity: number }) => apiRef.current?.season(e.velocity),
      rhythm: (e: { bpm: number; stability: number }) => apiRef.current?.rhythm(e.bpm, e.stability),
      scatter: (e: { intensity: number }) => apiRef.current?.scatter(e.intensity),
      gravity: (e: { beta: number; gamma: number }) => apiRef.current?.gravity(e.beta, e.gamma),
      knock: (e: { intensity: number }) => apiRef.current?.knock(e.intensity),
      night: (e: { faceDown: boolean }) => apiRef.current?.night(e.faceDown),
    }),
    [],
  );

  const cursorRef = useRef({ nx: 0.5, ny: 0.5 });
  const letGo = useCallback(() => apiRef.current?.letGo(), []);
  const onGlimmer = useCallback(() => apiRef.current?.glimmer(), []);

  return (
    <RoomShell
      route="/plank"
      surfaceRef={wrapRef}
      voice={voice}
      letGo={{ label: "let the weave go", onLetGo: letGo, visible: standing > 0 }}
      onGlimmer={onGlimmer}
      keyboard={{
        enter: () => apiRef.current?.weaveAt(cursorRef.current.nx, cursorRef.current.ny),
        enterHeld: (elapsed) => {
          if (elapsed > 900) apiRef.current?.weaveAt(cursorRef.current.nx, cursorRef.current.ny);
        },
        arrow: (dx, dy) => {
          cursorRef.current.nx = Math.min(0.95, Math.max(0.05, cursorRef.current.nx + dx * 0.04));
          cursorRef.current.ny = Math.min(0.95, Math.max(0.05, cursorRef.current.ny + dy * 0.04));
        },
        escape: () => apiRef.current?.stepBack(),
      }}
      style={{ position: "fixed", inset: 0, background: "#050308" }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={canvasRef}
          role="application"
          tabIndex={0}
          aria-label="the floor of the world — quantum foam churning; rest a finger and a stitch of space gathers, hold longer and its spin deepens, and the weave calms the sea around it"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        />
        <canvas
          ref={overlayRef}
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      </div>
    </RoomShell>
  );
}
