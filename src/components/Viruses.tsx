"use client";

/**
 * /viruses — shells that build themselves.
 *
 * The material is a warm translucent medium in which free protein **subunits**
 * drift and, by their own icosahedral symmetry rule, snap together into hollow
 * **shells** — Caspar–Klug capsids, the same geometry as geodesic domes and
 * fullerenes. Every law the shells obey lives in src/lib/viruses.ts, pure and
 * node-tested; this file only renders what those laws decide and says what each
 * verb of the grammar means in this material.
 *
 * The causal identity is a shell's symmetry class T plus its geometric seed:
 * two shells of the same class and seed are geometrically identical and ring
 * alike, exactly the way a mineral is its lattice on /rocks. You exercise that
 * identity by create / modify / destroy —
 *   CREATE  — dwell on the medium: subunits gather into a T=1 shell, and holding
 *             longer climbs the Caspar–Klug ladder (T=1 → 3 → 4 → 7 …).
 *   MODIFY  — drag a shell onto the templating surface (or onto another shell):
 *             it docks and templates a copy carrying the same seed; twist raises
 *             the lens (solid shell → subunit net → the 2·3·5 symmetry axes);
 *             three-finger twist drifts the season's fidelity (cold is perfect
 *             symmetry, warm wanders to nearby classes).
 *   DESTROY — flick disassembles a shell back into free subunits (count
 *             conserved); the ceremony hold folds a shell open into its flat
 *             geodesic net, kept between visits; <LetGo> dissolves all; tutti
 *             makes every shell pulse and shed a ring.
 *
 * Alive at rest: Brownian drift, shells breathe on the shared 7s clock, and the
 * ≥20s glimmer is a spontaneous self-assembly sparkle in the medium.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier } from "@/lib/gesture/core";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  type QualityTier,
} from "@/lib/room-runtime";
import { createGLStage, FULLSCREEN_VERT_CLIP } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
import {
  assembleShell,
  bornShell,
  capsomers,
  clamp,
  clamp01,
  climbShell,
  dissolveShell,
  driftShell,
  hashSeed,
  icosaVertices,
  loadMedium,
  MEDIUM_START_FREE,
  mulberry32,
  oldestStanding,
  prevT,
  serializeMedium,
  shellPitchMidi,
  shellRadius,
  subunitCount,
  templateShell,
  wanderT,
  CK_LADDER,
  DOCK_REACH,
  SHELL_CAP,
  type Medium,
  type Shell,
} from "@/lib/viruses";

const STORAGE_KEY = "objetdart:viruses:v1";
const ROOM_SEED = 0x91b3d7;
/** ny below this is the smooth templating surface at the medium's floor. */
const DOCK_BAND = 0.82;

// ——— the medium: one fragment shader, warm nacre over the void ————————————
const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float uTime;
uniform float uBreath;
uniform float uTurbulence;
uniform float uReduced;
uniform float u_warm;
uniform float u_dock;
uniform float u_night;
uniform float u_octaves;

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
    p = p * 2.03 + vec2(11.3, 7.1);
    a *= 0.55;
  }
  return v;
}
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime * (0.05 + u_warm * 0.14) * (1.0 - 0.8 * uReduced);

  // warm translucent medium — a slow domain-warped froth of solvent
  vec2 q = vec2(fbm(p * 2.4 + vec2(0.0, t * 0.5)), fbm(p * 2.4 + vec2(4.2, 1.3) - t * 0.4));
  vec2 r = vec2(
    fbm(p * 2.4 + q * 1.8 + vec2(1.7, 9.2) + t * 0.2),
    fbm(p * 2.4 + q * 1.8 + vec2(8.3, 2.8) - t * 0.16)
  );
  float f = fbm(p * 2.4 + r * 1.6);

  // the whole medium breathes on the shared 7s clock — visible at rest
  float breathe = 0.82 + 0.18 * uBreath;

  // iridescent mother-of-pearl from the warp, cool where warm is high
  float hue = f * 1.2 + q.x * 0.7 + r.y * 0.5 + u_warm * 0.4;
  vec3 nacre = 0.5 + 0.5 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67)));
  nacre = mix(vec3(dot(nacre, vec3(0.333))), nacre, 0.5);

  vec3 bg = vec3(0.039, 0.027, 0.063);          // #0a0710 warm dark
  vec3 col = bg;
  col += nacre * f * f * (0.14 + 0.10 * u_warm) * breathe;
  col += vec3(0.20, 0.10, 0.24) * uTurbulence;

  // the templating surface: a smooth bright band along the floor
  float dock = smoothstep(0.16, 0.0, abs(uv.y - 0.11));
  col += vec3(0.30, 0.46, 0.52) * dock * u_dock * (0.35 + 0.30 * uBreath);

  col *= 1.0 - 0.82 * u_night;
  gl_FragColor = vec4(col, 1.0);
}`;

// ——— the shell sprite: an iridescent icosahedral capsid ————————————————————
// The class T sets the facet count; the shell breathes and pulses; a folding
// shell fades here while its net opens on the overlay.
const SHELL_FRAG = `precision mediump float;
varying vec2 vLocal;
varying float vHue;
varying float vGlow;
varying float vPhase;
varying float vAlpha;
uniform vec3 u_palA;
uniform vec3 u_palB;
uniform vec3 u_palC;
vec3 pal(float h) {
  h = clamp(h, 0.0, 1.0);
  return h < 0.5 ? mix(u_palA, u_palB, h * 2.0) : mix(u_palB, u_palC, (h - 0.5) * 2.0);
}
void main() {
  float d = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  float lobes = 6.0 + floor(vHue * 10.0);

  // the shell wall — a bright ring near d = 0.62, wobbling on the breath
  float wob = sin(ang * lobes + vPhase * 6.2831) * 0.05;
  float wall = 1.0 - smoothstep(0.05, 0.17, abs(d - (0.62 + wob)));

  // capsomer facets tiling the interior — the geodesic cells
  float cells = 0.5 + 0.5 * cos(ang * lobes) * cos(d * lobes * 2.0 - vPhase * 3.0);
  float facet = smoothstep(0.35, 1.0, cells) * (1.0 - smoothstep(0.5, 0.66, d));

  // mother-of-pearl iridescence
  float hueShift = vHue + d * 0.7 + ang * 0.02 + vPhase * 0.3;
  vec3 nacre = 0.5 + 0.5 * cos(6.2831 * (hueShift + vec3(0.0, 0.33, 0.67)));
  nacre = mix(vec3(dot(nacre, vec3(0.333))), nacre, 0.72);

  vec3 col = pal(vHue) * 0.32 + nacre * (wall * 0.95 + facet * 0.5);
  float corona = exp(-d * d * 2.0) * (0.12 + vGlow * 0.55);
  col += nacre * corona;

  float a = clamp(wall * 0.92 + facet * 0.4 + corona, 0.0, 1.0) * vAlpha;
  a += (1.0 - smoothstep(0.0, 0.6, d)) * 0.10 * vAlpha; // hollow translucent core
  if (a <= 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}`;

type Scatter = { x: number; y: number; vx: number; vy: number; t0: number; seed: number };

type Api = {
  tap(e: { fingers: number; count: number; intensity: number; x: number; y: number }, tier?: ReturnType<typeof tapTrainTier>): void;
  stepBack(): void;
  tutti(intensity: number): void;
  plant(x: number, y: number, tier: number): void;
  deepen(elapsed: number, x: number, y: number): void;
  settle(elapsed: number, x: number, y: number): void;
  ceremony(x: number, y: number): void;
  timeScale(k: number): void;
  drag(phase: string, x: number, y: number, dx: number, dy: number, vx: number, vy: number): void;
  wind(dx: number, dy: number): void;
  flick(angle: number, speed: number, x: number, y: number): void;
  lens(velocity: number): void;
  season(velocity: number): void;
  scatter(intensity: number): void;
  gravity(beta: number, gamma: number): void;
  knock(intensity: number): void;
  night(faceDown: boolean): void;
  glimmer(): void;
  assembleAt(nx: number, ny: number): void;
  letGo(): void;
};

export default function Viruses() {
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
    const embedded = isEmbeddedFrame();

    // ——— the medium, from the laws in lib/viruses ———
    const medium: Medium = { free: MEDIUM_START_FREE, shells: [] };
    let nextId = 1;
    const writer = createIdleWriter(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeMedium(medium)));
      } catch {
        /* quota / private mode — the room still plays */
      }
    });
    let cleared = false;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const loaded = loadMedium(JSON.parse(raw), performance.now());
        medium.free = loaded.free;
        medium.shells = loaded.shells;
        cleared = loaded.shells.length === 0 && Array.isArray((JSON.parse(raw) as { shells?: [] }).shells);
      }
    } catch {
      /* a fresh medium */
    }
    if (medium.shells.length === 0 && !cleared) {
      // the medium is never empty on arrival: a few shells already stand
      const rng = mulberry32(ROOM_SEED);
      const seeds = [0, 1, 2];
      for (const i of seeds) {
        const seed = hashSeed(ROOM_SEED, i);
        const t = [1, 3, 4][i];
        const idx = assembleShell(medium, nextId++, seed, 0.3 + rng() * 0.4, 0.28 + rng() * 0.34, performance.now());
        const s = idx >= 0 ? medium.shells[idx] : null;
        if (s) {
          s.t = t;
          medium.free -= subunitCount(t) - subunitCount(1);
          s.assembly = 1;
        }
      }
    }
    for (const s of medium.shells) nextId = Math.max(nextId, s.id + 1);
    setStanding(medium.shells.length);

    // ——— the world's own fields ———
    const world = {
      warm: 0.4, // the season: 0 cold (perfect symmetry) .. 1 warm (wandering)
      lens: 0, // 0 solid shell .. 1 subunit net .. 2 symmetry axes
      timeScaleK: 1,
      night: 0,
      nightTarget: 0,
      windX: 0,
      windY: 0,
      agitation: 0,
      dock: 0.4, // how lit the templating surface is
    };
    let selected = -1;
    let carriedIdx = -1;
    let dragMoved = 0;
    let heldIdx = -1;
    let prevSeasonQuad = -1;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let lastAmbientSlot = -1;
    const scatters: Scatter[] = [];
    let scatterHead = 0;
    for (let i = 0; i < 48; i++) scatters.push({ x: 0, y: 0, vx: 0, vy: 0, t0: -1e9, seed: 0 });
    const axes3 = icosaVertices();

    const W = () => Math.max(1, wrap.clientWidth);
    const H = () => Math.max(1, wrap.clientHeight);
    const soft = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* haptics or audio unavailable — the room still plays */
      }
    };

    const nearestShell = (nx: number, ny: number, reach: number): number => {
      let best = -1;
      let bestD = reach * reach;
      for (let i = 0; i < medium.shells.length; i++) {
        const s = medium.shells[i];
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

    const pulseShell = (i: number, k: number) => {
      const s = medium.shells[i];
      if (!s) return;
      s.pulse = Math.min(1, s.pulse + k);
      soft(() => audio.playNote(shellPitchMidi(s.t), 200 + 360 * k));
    };

    const spawnScatter = (s: Shell) => {
      // subunits fly apart from a dissolving shell — count already returned
      const n = Math.min(10, 4 + Math.round(s.t));
      for (let k = 0; k < n; k++) {
        const rng = mulberry32(hashSeed(s.seed, k, Math.floor(performance.now())));
        const p = scatters[scatterHead];
        scatterHead = (scatterHead + 1) % scatters.length;
        const a = rng() * Math.PI * 2;
        const sp = 0.06 + rng() * 0.12;
        p.x = s.nx;
        p.y = s.ny;
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp;
        p.t0 = performance.now();
        p.seed = hashSeed(s.seed, k);
      }
    };

    const capShells = () => {
      let live = 0;
      for (const s of medium.shells) if (s.presence >= 1) live++;
      if (live >= SHELL_CAP) {
        const o = oldestStanding(medium);
        if (o >= 0) {
          const gone = medium.shells[o];
          dissolveShell(medium, o);
          spawnScatter(gone);
          soft(() => audio.buzz());
        }
      }
    };

    apiRef.current = {
      tap(e, tierArg) {
        lastInteractionAt = performance.now();
        const nx = e.x / W();
        const ny = e.y / H();
        const tier = tierArg ?? tapTrainTier(e.count);
        if (tier === "n") {
          // the whole medium answers, harder with every extra tap
          for (const s of medium.shells) s.pulse = Math.min(1, s.pulse + 0.4);
          world.agitation = Math.min(1, world.agitation + 0.2);
          soft(() => audio.bell());
          soft(() => haptics.storm());
          return;
        }
        if (tier === 5) {
          // rap a shell loose into a bright pulse, or sparkle the bare medium
          const i = nearestShell(nx, ny, 0.16);
          if (i >= 0) {
            pulseShell(i, 0.9 + e.intensity * 0.1);
            soft(() => haptics.detent());
          } else {
            world.agitation = Math.min(1, world.agitation + 0.12);
            soft(() => audio.spark());
          }
          return;
        }
        if (tier === 3) {
          // the dyad: a shell and its nearest neighbour ring together
          const i = nearestShell(nx, ny, 0.16);
          if (i >= 0) {
            selected = i;
            pulseShell(i, 0.6 + e.intensity * 0.4);
            const j = nearestShell(medium.shells[i].nx, medium.shells[i].ny, shellRadius(medium.shells[i].t) * 3);
            if (j >= 0 && j !== i) pulseShell(j, 0.5);
            soft(() => haptics.ripple(0.4 + e.intensity * 0.3));
          } else {
            world.agitation = Math.min(1, world.agitation + 0.08);
            soft(() => audio.playNote(70, 200));
            soft(() => haptics.ripple(0.35));
          }
          return;
        }
        // one tap: ring the nearest shell, or stir the medium
        const i = nearestShell(nx, ny, 0.14);
        if (i >= 0) {
          selected = i;
          pulseShell(i, 0.4 + 0.6 * e.intensity);
          soft(() => haptics.tap());
        } else {
          world.agitation = Math.min(1, world.agitation + 0.04 * e.intensity);
          soft(() => audio.playNote(78, 150));
          soft(() => haptics.tap());
        }
      },
      stepBack() {
        // ScaleTravel owns the frame's retreat; the room lowers its lens first
        if (world.lens > 0.12) {
          world.lens = 0;
          soft(() => haptics.lens());
          soft(() => audio.chime());
        } else {
          for (const s of medium.shells) s.pulse = Math.min(1, s.pulse + 0.08);
        }
      },
      tutti(intensity) {
        // every shell pulses and sheds a ring of subunits back to the medium
        let played = 0;
        for (const s of medium.shells) {
          s.pulse = Math.min(1, s.pulse + 0.4);
          const down = prevT(s.t);
          if (down !== s.t) {
            medium.free += subunitCount(s.t) - subunitCount(down);
            s.t = down;
            spawnScatter(s);
          }
          if (played < 6) {
            soft(() => audio.playNote(shellPitchMidi(s.t), 480));
            played++;
          }
        }
        world.agitation = Math.min(1, world.agitation + 0.15 * intensity);
        soft(() => haptics.ripple(0.4 + intensity * 0.3));
        writer.schedule();
      },
      plant(x, y, tier) {
        lastInteractionAt = performance.now();
        const nx = x / W();
        const ny = y / H();
        const i = nearestShell(nx, ny, 0.1);
        if (i >= 0) {
          heldIdx = i;
        } else {
          capShells();
          const idx = assembleShell(medium, nextId, hashSeed(ROOM_SEED, nextId, Math.floor(nx * 997), Math.floor(ny * 997)), nx, ny, performance.now());
          if (idx >= 0) {
            nextId++;
            heldIdx = idx;
            selected = idx;
            soft(() => audio.spark());
          } else {
            soft(() => audio.buzz());
          }
        }
        if (tier >= 1) soft(() => haptics.ripple(0.4));
      },
      deepen(elapsed) {
        // holding deepens the shell and climbs the Caspar–Klug ladder rung by
        // rung — a real gathering of subunits, never the same at 900 as 2400ms
        const s = medium.shells[heldIdx];
        if (!s) return;
        s.pulse = Math.min(1, s.pulse + 0.03);
        s.assembly = Math.min(1, s.assembly + 0.02);
        const wantRungs = Math.max(0, Math.floor((elapsed - 900) / 650));
        const baseIdx = CK_LADDER.indexOf(1);
        const targetIdx = Math.min(CK_LADDER.length - 1, baseIdx + wantRungs);
        while (CK_LADDER.indexOf(s.t) < targetIdx) {
          if (!climbShell(medium, heldIdx)) break;
          soft(() => audio.playNote(shellPitchMidi(s.t), 220));
          soft(() => haptics.detent());
        }
      },
      settle() {
        const s = medium.shells[heldIdx];
        if (s) {
          s.assembly = 1;
          soft(() => audio.playNote(shellPitchMidi(s.t), 380));
          soft(() => haptics.ripple(0.5));
          writer.schedule();
        }
        heldIdx = -1;
      },
      ceremony(x, y) {
        // the solemn act: a shell folds open along its symmetry planes into a
        // flat geodesic net, kept between visits
        const i = nearestShell(x / W(), y / H(), 0.16);
        if (i >= 0) {
          const s = medium.shells[i];
          s.net = s.net > 0.5 ? 0 : 1;
          selected = i;
          soft(() => audio.bell());
          soft(() => haptics.bloom());
          writer.flush();
        } else {
          // on bare medium the ceremony keeps the whole population, deliberately
          for (const s of medium.shells) s.assembly = 1;
          writer.flush();
          soft(() => audio.bell());
          soft(() => haptics.bloom());
        }
      },
      timeScale(k) {
        world.timeScaleK = k;
      },
      drag(phase, x, y, dx, dy, vx, vy) {
        lastInteractionAt = performance.now();
        const nx = x / W();
        const ny = y / H();
        if (phase === "start") {
          carriedIdx = nearestShell(nx, ny, 0.1);
          dragMoved = 0;
          if (carriedIdx >= 0) {
            selected = carriedIdx;
            medium.shells[carriedIdx].pulse = Math.min(1, medium.shells[carriedIdx].pulse + 0.2);
          }
          return;
        }
        if (phase === "end") {
          if (carriedIdx >= 0) {
            const s = medium.shells[carriedIdx];
            if (s) {
              s.vx = clamp(vx / W(), -0.4, 0.4);
              s.vy = clamp(vy / H(), -0.4, 0.4);
              // docked on the templating surface, or against another shell:
              // template a copy that carries the same seed (geometric self-copy)
              const onto = nearestShell(s.nx, s.ny, DOCK_REACH + shellRadius(s.t));
              const docked = ny > DOCK_BAND;
              const tmplIdx = onto >= 0 && onto !== carriedIdx ? onto : docked ? carriedIdx : -1;
              if (tmplIdx >= 0) {
                capShells();
                const copy = templateShell(medium, tmplIdx, nextId, performance.now());
                if (copy >= 0) {
                  nextId++;
                  world.dock = 1;
                  medium.shells[copy].pulse = 1;
                  soft(() => audio.chime());
                  soft(() => audio.playNote(shellPitchMidi(medium.shells[copy].t), 420));
                  soft(() => haptics.bloom());
                  writer.schedule();
                } else {
                  soft(() => audio.buzz());
                }
              }
            }
          }
          carriedIdx = -1;
          return;
        }
        // carrying a shell through the medium toward the templating surface
        if (carriedIdx >= 0 && medium.shells[carriedIdx]) {
          const s = medium.shells[carriedIdx];
          s.nx = clamp(nx, 0.04, 0.96);
          s.ny = clamp(ny, 0.04, 0.96);
          s.vx = vx / W();
          s.vy = vy / H();
          dragMoved += Math.hypot(dx, dy);
          if (dragMoved > 16) {
            dragMoved = 0;
            soft(() => haptics.tap());
          }
        } else {
          // stirring the bare medium: a slow current the drift feels
          world.agitation = Math.min(1, world.agitation + Math.abs(dy) / H() * 0.4);
        }
      },
      wind(dx, dy) {
        world.windX = clamp(world.windX + dx * 2.4, -1, 1);
        world.windY = clamp(world.windY + dy * 2.4, -1, 1);
      },
      flick(angle, speed, x, y) {
        lastInteractionAt = performance.now();
        // a sharp strike disassembles a shell back into free subunits
        const i = nearestShell(x / W(), y / H(), 0.18);
        if (i < 0) return;
        const gone = medium.shells[i];
        dissolveShell(medium, i);
        spawnScatter(gone);
        if (selected === i) selected = -1;
        if (carriedIdx === i) carriedIdx = -1;
        if (heldIdx === i) heldIdx = -1;
        world.agitation = Math.min(1, world.agitation + 0.15 * Math.min(3, speed));
        soft(() => audio.playNote(shellPitchMidi(gone.t) + 4, 160));
        soft(() => audio.buzz());
        soft(() => haptics.chop());
        void angle;
        writer.schedule();
      },
      lens(velocity) {
        world.lens = clamp(world.lens + velocity * 0.02, 0, 2);
      },
      season(velocity) {
        // the fidelity dial: cold keeps perfect symmetry, warm lets it wander
        world.warm = clamp01(world.warm + velocity * 0.012);
        const quad = Math.floor(world.warm * 4);
        if (quad !== prevSeasonQuad) {
          prevSeasonQuad = quad;
          soft(() => haptics.detent());
          soft(() => audio.chime());
        }
      },
      scatter(intensity) {
        world.agitation = Math.min(1, world.agitation + intensity);
        soft(() => audio.buzz());
        soft(() => haptics.chop());
      },
      gravity(beta, gamma) {
        world.windX = clamp(gamma / 45, -1, 1);
        world.windY = clamp(beta / 70, -1, 1);
      },
      knock(intensity) {
        // a rap on the case jostles the whole medium and rings every shell
        for (const s of medium.shells) {
          const rng = mulberry32(hashSeed(s.seed, 0xdead));
          s.vx += (rng() - 0.5) * 0.1 * intensity;
          s.vy += (rng() - 0.5) * 0.1 * intensity;
          s.pulse = Math.min(1, s.pulse + 0.35 * intensity);
        }
        soft(() => audio.thud());
        soft(() => haptics.detent());
      },
      night(faceDown) {
        world.nightTarget = faceDown ? 1 : 0;
        if (faceDown) soft(() => haptics.roll());
      },
      glimmer() {
        // the idle hint is physical: a spontaneous self-assembly sparkle — a
        // partial shell clicks together in the medium and relaxes
        const rng = mulberry32(hashSeed(ROOM_SEED, Math.floor(performance.now() / 1000)));
        const gs: Shell = bornShell(-1, hashSeed(ROOM_SEED, 0x91), 1, 0.25 + rng() * 0.5, 0.28 + rng() * 0.5, performance.now());
        spawnScatter(gs);
        soft(() => audio.playNote(84, 220));
      },
      assembleAt(nx, ny) {
        capShells();
        const idx = assembleShell(medium, nextId, hashSeed(ROOM_SEED, nextId, Math.floor(nx * 512), Math.floor(ny * 512)), nx, ny, performance.now());
        if (idx >= 0) {
          nextId++;
          medium.shells[idx].assembly = 1;
          selected = idx;
          soft(() => audio.spark());
          soft(() => haptics.ripple(0.5));
          writer.schedule();
        }
      },
      letGo() {
        // an exhale: every shell dissolves, its subunits scatter and rejoin the
        // free medium (count conserved), and an emptied medium stays empty
        for (const s of medium.shells) {
          medium.free += subunitCount(s.t);
          spawnScatter(s);
        }
        medium.shells = [];
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, free: medium.free, shells: [] }));
        } catch {
          /* noop */
        }
        writer.cancel();
        setStanding(0);
        soft(() => audio.thud());
        soft(() => haptics.roll());
      },
    };

    // ——— the voice: what each verb of the grammar means in this material ———
    // The attachGestures handlers below branch by finger count and hold tier and
    // dispatch into this one table, so the ceremony is a discrete act and not a
    // clause buried in a handler.
    const voice = voiceRef.current;

    // ——— the stage: one GL context, two passes, one overlay ———
    const stage = createGLStage(canvas, {
      wrap,
      label: "viruses",
      reducedMotion: reduced,
      embedded,
      overlay: overlayCanvas,
    });
    const prog = stage ? stage.program(FULLSCREEN_VERT_CLIP, FIELD) : null;
    const quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    const layer = stage
      ? createPopulationLayer(stage, {
          palette: ["#7fd8d0", "#d9c8f0", "#f3e2c8"],
          frag: SHELL_FRAG,
        })
      : null;
    const buffer = createInstanceBuffer(512);

    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let tier: QualityTier = gov.tier();
    let hidden = false;
    let galleryPaused = false;
    const syncSleep = () => {
      if (hidden || galleryPaused) gov.force("sleep");
    };
    const offVisibility = onVisibility((h) => {
      hidden = h;
      syncSleep();
    });
    const offGallery = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    // ——— the grammar, mounted on the overlay (the topmost surface) ———
    const detachGestures = attachGestures(
      overlayCanvas,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) {
            voice.stepBack?.({ x: e.x, y: e.y }); // ScaleTravel's step back; lens lowers first
            return;
          }
          if (e.fingers === 3) {
            voice.tutti?.({ intensity: e.intensity });
            return;
          }
          if (e.fingers !== 1) return;
          voice.tap?.(e);
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // dilation deepens continuously the longer three fingers stay
            if (e.phase === "release") voice.timeScale?.(1);
            else voice.timeScale?.(clamp(1 - 0.8 * clamp01(e.elapsed / 2200), 0.15, 1));
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "enter") {
            if (e.tier >= 1) voice.plant?.({ x: e.x, y: e.y, intensity: e.intensity, tier: e.tier });
            return;
          }
          if (e.phase === "tick") {
            voice.deepen?.({ elapsed: e.elapsed, tier: e.tier, x: e.x, y: e.y });
            return;
          }
          if (e.phase === "release") {
            voice.settle?.({ elapsed: e.elapsed, tier: e.tier, x: e.x, y: e.y });
            if (e.tier >= 3) voice.ceremony?.({ elapsed: e.elapsed, x: e.x, y: e.y });
          }
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            voice.wind?.({ dx: e.dx, dy: e.dy });
            return;
          }
          if (e.fingers !== 1) return;
          voice.drag?.(e);
        },
        flick: (e) => {
          if (e.fingers !== 1) return;
          voice.flick?.(e);
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            voice.season?.({ angle: e.angle, velocity: e.velocity });
            return;
          }
          voice.lens?.({ angle: e.angle, velocity: e.velocity });
        },
        scrub: () => {
          world.agitation = Math.min(1, world.agitation + 0.08);
          soft(() => audio.playNote(66, 220));
          soft(() => haptics.ripple(0.3));
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel ———
    const detachVessel = onVessel({
      tilt: (e) => voice.gravity?.(e),
      shake: (e) => voice.scatter?.(e),
      knock: (e) => voice.knock?.(e),
      flip: (e) => voice.night?.(e),
    });

    // ——— keyboard ———
    const cursor = { nx: 0.5, ny: 0.5 };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        apiRef.current?.stepBack();
        return;
      }
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft" || ev.key === "ArrowUp" || ev.key === "ArrowDown") {
        ev.preventDefault();
        const dx = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
        const dy = ev.key === "ArrowDown" ? 1 : ev.key === "ArrowUp" ? -1 : 0;
        cursor.nx = clamp(cursor.nx + dx * 0.05, 0.05, 0.95);
        cursor.ny = clamp(cursor.ny + dy * 0.05, 0.05, 0.95);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        apiRef.current?.assembleAt(cursor.nx, cursor.ny);
      }
    };
    wrap.addEventListener("keydown", onKeyDown);

    // ——— the loop ———
    let raf = 0;
    let last = performance.now();
    let lastStanding = -1;
    const draw = (t: number) => {
      tier = gov.beginFrame(t);
      if (hidden || galleryPaused) {
        last = t;
        raf = requestAnimationFrame(draw);
        return;
      }
      const detail = detailForTier(tier);
      const dt = Math.min(0.05, (t - last) / 1000) * world.timeScaleK;
      last = t;
      const tSec = audio.getAudioTime() ?? t / 1000;
      const breath = reduced ? 0.5 : Math.sin(tSec * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // fields relax toward rest
      world.agitation *= 0.955;
      world.windX *= 0.985;
      world.windY *= 0.985;
      world.dock += (0.4 - world.dock) * Math.min(1, dt * 0.6);
      world.night += (world.nightTarget - world.night) * Math.min(1, dt * 2);

      const temp = 0.18 + world.warm * 0.5 + world.agitation * 0.8;

      // drift the shells, wind pushes them, the season wanders their fidelity
      for (const s of medium.shells) {
        if (!reduced) {
          driftShell(s, dt, temp, t);
          s.vx += world.windX * 0.03 * dt;
          s.vy += world.windY * 0.03 * dt;
          s.fidelity += ((1 - world.warm) - s.fidelity) * Math.min(1, dt * 0.4);
        }
      }

      // the season occasionally wanders a shell to a nearby class (warm only)
      const seasonSlot = Math.floor(t / 2600);
      if (seasonSlot !== lastAmbientSlot) {
        lastAmbientSlot = seasonSlot;
        if (!reduced && medium.shells.length > 0 && world.warm > 0.35) {
          const rng = mulberry32(hashSeed(ROOM_SEED, seasonSlot));
          const i = Math.floor(rng() * medium.shells.length);
          const s = medium.shells[i];
          if (s && s.presence >= 1) {
            const to = wanderT(s.t, s.fidelity, hashSeed(s.seed, seasonSlot));
            if (to !== s.t) {
              // move subunits to match the new class, conserving the medium
              medium.free += subunitCount(s.t) - subunitCount(to);
              if (medium.free >= 0) {
                s.t = to;
                s.pulse = Math.min(1, s.pulse + 0.3);
              } else {
                medium.free -= subunitCount(s.t) - subunitCount(to); // refuse if unaffordable
              }
            }
          }
        }
        // and unattended, the medium spontaneously assembles a partial shell
        if (!reduced && medium.free > subunitCount(1)) {
          const rng = mulberry32(hashSeed(ROOM_SEED, seasonSlot, 7));
          if (rng() < 0.5) {
            const gs = bornShell(-1, hashSeed(ROOM_SEED, seasonSlot, 3), 1, 0.12 + rng() * 0.76, 0.12 + rng() * 0.72, t);
            spawnScatter(gs);
          }
        }
      }

      // retire the spent shells; their subunits already rejoined the medium
      for (let i = medium.shells.length - 1; i >= 0; i--) {
        if (medium.shells[i].presence <= 0) {
          if (carriedIdx === i) carriedIdx = -1;
          else if (carriedIdx > i) carriedIdx--;
          if (heldIdx === i) heldIdx = -1;
          else if (heldIdx > i) heldIdx--;
          if (selected === i) selected = -1;
          else if (selected > i) selected--;
          medium.shells.splice(i, 1);
        }
      }

      // ——— render ———
      if (stage && prog && quad && layer) {
        stage.beginFrame(clocksFrom({ time: tSec, turbulence: world.agitation, reducedMotion: reduced }), prog);
        prog.setFloat("u_warm", world.warm);
        prog.setFloat("u_dock", world.dock);
        prog.setFloat("u_night", world.night);
        prog.setFloat("u_octaves", Math.max(2, Math.round(2 + detail.particles * 3)));
        quad.draw();

        const size = stage.size;
        const m = Math.min(size.width, size.height);

        buffer.reset();
        // the shells
        for (const s of medium.shells) {
          const px = s.nx * size.width;
          const py = s.ny * size.height;
          const hue = CK_LADDER.indexOf(s.t) / Math.max(1, CK_LADDER.length - 1);
          const rad = shellRadius(s.t) * m * (0.9 + 0.14 * breath) * (0.4 + 0.6 * s.assembly);
          const phase = (tSec * 0.12 + s.seed * 0.0011) % 1;
          const glow = 0.2 + s.pulse * 0.8 + (carriedIdx === medium.shells.indexOf(s) ? 0.3 : 0);
          buffer.push(px, py, rad, s.seed * 0.01, hue, glow, phase, s.presence * (1 - s.net * 0.85) * (0.5 + 0.5 * s.assembly));
        }
        // free subunits drifting in the medium — a fraction, deterministic
        const freeShown = Math.min(40, Math.floor(medium.free / 90 * detail.particles));
        for (let i = 0; i < freeShown; i++) {
          const rng = mulberry32(hashSeed(ROOM_SEED, i));
          const bx = rng();
          const by = rng();
          const drift = (tSec * (0.02 + rng() * 0.03) + rng()) % 1;
          const fx = ((bx + Math.sin(tSec * 0.2 + i) * 0.03 + drift * 0.02) % 1) * size.width;
          const fy = ((by + Math.cos(tSec * 0.17 + i) * 0.03) % 1) * size.height;
          buffer.push(fx, fy, m * 0.006, 0, 0.55, 0.4, drift, 0.4 * breath + 0.2);
        }
        // scatter: subunits flung from a dissolving or shedding shell
        for (const p of scatters) {
          const age = (t - p.t0) / 900;
          if (age < 0 || age >= 1) continue;
          const px = (p.x + p.vx * age) * size.width;
          const py = (p.y + p.vy * age) * size.height;
          buffer.push(px, py, m * 0.007 * (1 - age * 0.4), 0, 0.35, 0.6, age, (1 - age) * 0.55);
        }
        layer.draw(buffer);

        // ——— the overlay: capsomer net, symmetry axes, seed accent ———
        const ctx = stage.overlay2d;
        if (ctx) {
          ctx.clearRect(0, 0, size.width, size.height);
          const sel = medium.shells[selected];
          // draw the net / capsomers for the selected shell and any folding one
          for (const s of medium.shells) {
            const show = s === sel || s.net > 0.01;
            if (!show || world.lens < 0.2) continue;
            const px = s.nx * size.width;
            const py = s.ny * size.height;
            const r = shellRadius(s.t) * m * (0.4 + 0.6 * s.assembly);
            const caps = capsomers(s.t, s.seed);
            const spread = 1 + s.net * 1.6; // the fold opens the disc into a flat net
            ctx.lineWidth = 1;
            // faint links between near capsomers — the triangulation
            ctx.strokeStyle = "rgba(127, 216, 208, 0.28)";
            for (let a = 0; a < caps.length; a++) {
              const ax = px + caps[a].u * r * spread;
              const ay = py + caps[a].v * r * spread;
              for (let b = a + 1; b < caps.length; b++) {
                const dxu = caps[a].u - caps[b].u;
                const dyu = caps[a].v - caps[b].v;
                if (dxu * dxu + dyu * dyu > 0.09) continue;
                ctx.globalAlpha = (s === sel ? 0.5 : 0.3) * (0.4 + 0.6 * s.net);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(px + caps[b].u * r * spread, py + caps[b].v * r * spread);
                ctx.stroke();
              }
            }
            // the capsomers: magenta pentamers (the seed accent), pale hexamers
            for (const c of caps) {
              const cx = px + c.u * r * spread;
              const cy = py + c.v * r * spread;
              ctx.globalAlpha = c.penta ? 0.85 : 0.4;
              ctx.fillStyle = c.penta ? "rgba(214, 137, 240, 0.9)" : "rgba(230, 220, 240, 0.7)";
              ctx.beginPath();
              ctx.arc(cx, cy, c.penta ? 2.6 : 1.6, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          // the 2·3·5 symmetry axes for the selected shell — cyan accent
          if (sel && world.lens > 1.2) {
            const px = sel.nx * size.width;
            const py = sel.ny * size.height;
            const r = shellRadius(sel.t) * m * 1.4;
            const rot = tSec * 0.3 + sel.seed * 0.001;
            const cr = Math.cos(rot);
            const sr = Math.sin(rot);
            ctx.strokeStyle = "rgba(127, 224, 216, 0.55)";
            ctx.lineWidth = 1.2;
            for (const v of axes3) {
              // rotate about y, then project — an antipodal five-fold axis
              const x3 = v[0] * cr - v[2] * sr;
              const z3 = v[0] * sr + v[2] * cr;
              const scale = 0.55 + 0.45 * ((z3 + 1) / 2);
              ctx.globalAlpha = 0.25 + 0.4 * scale;
              ctx.beginPath();
              ctx.moveTo(px - x3 * r * scale, py - v[1] * r * scale);
              ctx.lineTo(px + x3 * r * scale, py + v[1] * r * scale);
              ctx.stroke();
            }
          }
          ctx.globalAlpha = 1;
        }
      }

      // the ≥20s glimmer: a spontaneous self-assembly sparkle in the medium
      if (t - lastInteractionAt > 20000 && t - glimmerAt > 7000 && !reduced) {
        glimmerAt = t;
        apiRef.current?.glimmer();
      }

      let live = 0;
      for (const s of medium.shells) if (s.presence > 0.6) live++;
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
      offGallery();
      detachGestures();
      detachVessel();
      wrap.removeEventListener("keydown", onKeyDown);
      writer.flush();
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeMedium(medium)));
      } catch {
        /* noop */
      }
      layer?.dispose();
      quad?.dispose();
      stage?.dispose();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ——— the RoomVoice: the discrete verb table the handlers dispatch into.
  // Kept as a useMemo<RoomVoice> so the ceremony is its own method, not a
  // clause hidden inside a hold handler.
  const voiceRef = useRef<RoomVoice>({});
  const voice = useMemo<RoomVoice>(
    () => ({
      // the tap train (1 / 3 / 5 / n) is read at the binding site and dispatched
      // into api.tap, which climbs ring → dyad → pulse → the whole medium.
      tap: (e) => apiRef.current?.tap(e, tapTrainTier(e.count)),
      stepBack: (e) => {
        void e;
        apiRef.current?.stepBack();
      },
      tutti: (e) => apiRef.current?.tutti(e.intensity),
      plant: (e) => apiRef.current?.plant(e.x, e.y, e.tier),
      deepen: (e) => apiRef.current?.deepen(e.elapsed, e.x, e.y),
      settle: (e) => apiRef.current?.settle(e.elapsed, e.x, e.y),
      ceremony: (e) => apiRef.current?.ceremony(e.x, e.y),
      timeScale: (k) => apiRef.current?.timeScale(k),
      drag: (e) => apiRef.current?.drag(e.phase, e.x, e.y, e.dx, e.dy, e.vx, e.vy),
      wind: (e) => apiRef.current?.wind(e.dx, e.dy),
      flick: (e) => apiRef.current?.flick(e.angle, e.speed, e.x, e.y),
      lens: (e) => apiRef.current?.lens(e.velocity),
      season: (e) => apiRef.current?.season(e.velocity),
      scatter: (e) => apiRef.current?.scatter(e.intensity),
      gravity: (e) => apiRef.current?.gravity(e.beta, e.gamma),
      knock: (e) => apiRef.current?.knock(e.intensity),
      night: (e) => apiRef.current?.night(e.faceDown),
    }),
    [],
  );
  voiceRef.current = voice;

  const letGo = () => apiRef.current?.letGo();

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="a warm medium of drifting protein subunits — rest a finger and they self-assemble an icosahedral shell, hold longer and it climbs the symmetry ladder, drag one onto the templating floor and it prints a copy of itself"
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0710",
        outline: "none",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <canvas
        ref={overlayRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <LetGo label="let the shells go" onLetGo={letGo} visible={standing > 0} />
    </div>
  );
}
