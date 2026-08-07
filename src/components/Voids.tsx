"use client";

/**
 * /voids — the emptiness that pushes.
 *
 * The material is a great cosmic void bounded by the web. The population is
 * **nodes** (galaxy clusters, each of which IS its mass), strung by **filaments**
 * — and a filament IS the tension line between two nodes, thinning and snapping
 * as the void stretches it. The **void** itself is not a thing but a causal
 * fact: the outward push (a Hubble outflow) that voids leave in their wake,
 * draining matter outward onto the walls. Every law lives in src/lib/voids.ts,
 * pure and node-tested; this file renders what those laws decide and says what
 * each verb of the grammar means in this material.
 *
 * CREATE — a dwell seeds a node where matter condenses; holding longer pulls in
 * more mass. MODIFY — a one-finger drag stretches the void (pushes its walls
 * apart, the filaments thin and redshift deepens) or carries a cluster; a scrub
 * drains matter along the filaments toward the walls; twist(2) cycles the lens
 * (luminous-web / density-field / outflow-velocity); twist(3) turns the
 * expansion epoch (accelerate or reverse the Hubble flow). DESTROY — a flick
 * collapses a wall (its nodes fall into one great attractor); the ceremony hold
 * nucleates a new void inside a wall; <LetGo> clears; the three-finger tap
 * (tutti) pulses the whole web.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LetGo from "@/components/LetGo";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier, tapTrainDepth } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
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
import {
  bornNode,
  bornVoid,
  collapseWall,
  findMergePair,
  graphOrder,
  hashSeed,
  loadWeb,
  massPitchMidi,
  massRadius,
  mergeNodes,
  mulberry32,
  nucleateVoid,
  retireOldest,
  serializeWeb,
  stepVoids,
  stepWeb,
  wallOf,
  weaveFilaments,
  NODE_CAP,
  type FieldInput,
  type Filament,
  type Node,
  type Void,
} from "@/lib/voids";

const STORAGE_KEY = "objetdart:voids:v1";
const ROOM_SEED = 0x0d1f7a;
const IDLE_GLIMMER_MS = 20000;

// ——— the void field: one fragment shader, near-black emptiness that pushes ——
// The void is the subject: its interior is darker than the sky around it, and
// a faint violet outflow rides its wall, breathing wider on the 7s clock.
const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float uBreath;
uniform float u_turbulence;
uniform float u_reduced;
uniform float u_epoch;
uniform float u_lens;
uniform float u_dilate;
uniform float u_night;
uniform float u_octaves;
uniform vec2 u_pan;
uniform float u_voids[24];
uniform float u_voidCount;

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
    p = p * 2.05 + vec2(11.3, 7.1);
    a *= 0.55;
  }
  return v;
}
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 ap = vec2(uv.x * aspect, uv.y);
  float t = u_time * (0.05 + max(0.0, u_epoch) * 0.12) * u_dilate * (1.0 - 0.85 * u_reduced);

  // the faint large-scale sky behind everything — dim, cool, barely there
  vec2 sp = ap + u_pan * 0.12;
  float web = fbm(sp * 3.4 + vec2(0.0, t * 0.4));
  web = pow(web, 1.6);

  // the voids: emptiness (darker) with a faint violet outflow on the wall,
  // which breathes wider on the shared 7s clock
  float emptiness = 0.0;
  float outflow = 0.0;
  float wallGlow = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= u_voidCount) break;
    vec2 c = vec2(u_voids[i * 3] * aspect, u_voids[i * 3 + 1]);
    float rad = u_voids[i * 3 + 2] * (0.95 + 0.07 * uBreath);
    float dd = distance(ap, c);
    emptiness = max(emptiness, smoothstep(rad, rad * 0.15, dd));
    float wall = exp(-abs(dd - rad) * 20.0);
    wallGlow = max(wallGlow, wall);
    // outflow velocity read as a faint radial shimmer just inside the wall
    float shell = exp(-abs(dd - rad * 0.82) * 14.0);
    outflow += shell * (0.4 + 0.6 * uBreath);
  }

  vec3 deep = vec3(0.016, 0.020, 0.039);          // near-black intergalactic void
  // where a void stands, the sky is emptier still — the negative space
  vec3 col = deep * (1.0 - 0.55 * emptiness);
  col += vec3(0.10, 0.13, 0.22) * web * (1.0 - 0.7 * emptiness) * (0.6 + 0.4 * uBreath);

  // the wall: dim amber/rose where filaments would run, cool where they thin
  vec3 wallC = mix(vec3(0.36, 0.16, 0.12), vec3(0.5, 0.28, 0.22), u_lens * 0.5);
  col += wallC * wallGlow * (0.5 + 0.4 * uBreath) * (0.7 + 0.3 * u_lens);

  // the outflow: a faint violet, deepening (redshift) as the epoch expands fast
  vec3 violet = mix(vec3(0.24, 0.16, 0.42), vec3(0.34, 0.14, 0.40), clamp(u_epoch, 0.0, 1.0));
  col += violet * outflow * 0.5;

  col += vec3(0.03, 0.02, 0.06) * u_turbulence;

  // the density-field lens draws the sky as its measured contours
  float wDensity = 1.0 - min(1.0, abs(u_lens - 1.0));
  float cont = 1.0 - smoothstep(0.0, 0.12, abs(fract(web * 9.0) - 0.5));
  col += mix(vec3(0.10, 0.20, 0.34), vec3(0.42, 0.20, 0.30), web) * cont * wDensity * 0.4;

  col *= 1.0 - 0.82 * u_night;
  gl_FragColor = vec4(col, 1.0);
}`;

export default function Voids() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const letGoRef = useRef<() => void>(() => {});
  const glimmerRef = useRef<() => void>(() => {});
  const [standing, setStanding] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const overlayCanvas = overlayRef.current;
    if (!wrap || !canvas || !overlayCanvas) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ——— the standing web, from the laws in lib/voids ———
    let nodes: Node[] = [];
    let fils: Filament[] = [];
    let voids: Void[] = [];
    let nextId = 1;
    let nextVoidId = 1;

    const writer = createIdleWriter(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeWeb(nodes, voids)));
      } catch {
        /* quota / private mode — the room still plays */
      }
    });

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const back = loadWeb(JSON.parse(raw), performance.now());
        nodes = back.nodes;
        voids = back.voids;
      }
    } catch {
      /* a fresh field */
    }
    if (voids.length === 0) {
      voids.push(bornVoid(nextVoidId++, 0.5, 0.5, 0.26, 0.9, performance.now()));
    }
    if (nodes.length === 0) {
      // a ring of clusters on the void's wall, seeded — never bare on arrival
      const rng = mulberry32(ROOM_SEED);
      const count = 9;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + rng() * 0.3;
        const rad = 0.28 + rng() * 0.06;
        const s = bornNode(
          nextId++,
          hashSeed(ROOM_SEED, i),
          0.5 + Math.cos(ang) * rad * 0.9,
          0.5 + Math.sin(ang) * rad,
          performance.now(),
        );
        s.growth = 1;
        s.mass = 1 + Math.floor(rng() * 3);
        nodes.push(s);
      }
    }
    for (const s of nodes) nextId = Math.max(nextId, s.id + 1);
    for (const v of voids) nextVoidId = Math.max(nextVoidId, v.id + 1);
    setStanding(nodes.length);

    // ——— the world's own fields ———
    const world = {
      windX: 0,
      windY: 0,
      gravX: 0,
      gravY: 0,
      agitation: 0,
      epoch: 0.4, // gentle expansion at rest
      lens: 0,
      density: 0, // coherence of the tutti wave
      timeScaleK: 1,
      vortexX: 0.5,
      vortexY: 0.5,
      vortexW: 0,
      panX: 0,
      panY: 0,
      night: 0,
      nightTarget: 0,
    };
    let heldIdx = -1;
    let seedingIdx = -1;
    let seedingFresh = false;
    let prevWinding = 0;
    let ceremonyFired = false;
    let lastInteractionAt = performance.now();
    const wave = { active: false, t0: 0, order: [] as number[], stepMs: 120 };
    let lastGrainAt = 0;
    let lastSnapAt = 0;
    const prevKeys = new Set<number>();
    const curKeys = new Set<number>();

    const W = () => Math.max(1, wrap.clientWidth);
    const H = () => Math.max(1, wrap.clientHeight);
    const soft = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* haptics or audio unavailable — the room still plays */
      }
    };
    const mark = () => {
      lastInteractionAt = performance.now();
    };
    const markLens = () => {
      if (world.lens > 0.12) wrap.setAttribute("data-lens-raised", "1");
      else wrap.removeAttribute("data-lens-raised");
    };

    const nearestNode = (nx: number, ny: number, reach: number): number => {
      let best = -1;
      let bestD = reach * reach;
      for (let i = 0; i < nodes.length; i++) {
        const s = nodes[i];
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
    const nearestVoid = (nx: number, ny: number): number => {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < voids.length; i++) {
        const v = voids[i];
        const dx = v.cx - nx;
        const dy = v.cy - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      return best;
    };

    const spawnNode = (nx: number, ny: number, tMs: number): number => {
      let live = 0;
      for (const s of nodes) if (s.presence >= 1) live++;
      if (live >= NODE_CAP) {
        retireOldest(nodes);
        soft(() => audio.buzz());
      }
      const s = bornNode(
        nextId,
        hashSeed(ROOM_SEED, nextId, Math.floor(nx * 997), Math.floor(ny * 997)),
        nx,
        ny,
        tMs,
      );
      nextId++;
      nodes.push(s);
      return nodes.length - 1;
    };

    const ringNode = (i: number, k: number) => {
      const s = nodes[i];
      if (!s) return;
      s.glow = Math.min(1, s.glow + k);
      soft(() => audio.playNote(massPitchMidi(s.mass), 220 + 400 * k));
    };

    // ——— the gestures (src/lib/gesture) — never raw pointer wiring ———
    const detachGestures = attachGestures(
      canvas,
      {
        tap: (e) => {
          mark();
          const nx = e.x / W();
          const ny = e.y / H();
          if (e.fingers === 2) {
            // step back — a raised lens lowers first, else the web rings softly
            if (world.lens > 0.12) {
              world.lens = 0;
              markLens();
              soft(() => haptics.lens());
              soft(() => audio.chime());
            } else {
              for (const s of nodes) s.glow = Math.min(1, s.glow + 0.08);
              soft(() => haptics.tap());
            }
            return;
          }
          if (e.fingers === 3) {
            // tutti — the whole web states itself at once, a wave down the graph
            world.density = Math.min(1, world.density + 0.5 * e.intensity + 0.2);
            let played = 0;
            let lastM = -1;
            for (const s of nodes) {
              s.glow = Math.min(1, s.glow + 0.35);
              const mm = Math.round(s.mass);
              if (mm !== lastM && played < 6) {
                soft(() => audio.playNote(massPitchMidi(s.mass), 520));
                lastM = mm;
                played++;
              }
            }
            if (nodes.length > 0) {
              wave.active = true;
              wave.t0 = performance.now();
              wave.order = graphOrder(nodes, fils, nearestNode(0.5, 0.5, 2));
              wave.stepMs = 95;
            }
            soft(() => haptics.ripple(0.4));
            return;
          }
          if (e.fingers !== 1) return;
          const trainTier = tapTrainTier(e.count);
          const depth = tapTrainDepth(e.count);
          if (trainTier === "n") {
            // the peal: the whole web rings and the outflow surges
            world.density = Math.min(1, 0.7 + depth * 0.3);
            for (const s of nodes) s.glow = Math.min(1, s.glow + 0.2 + depth * 0.2);
            for (const v of voids) v.strength = Math.min(2, v.strength + 0.1);
            soft(() => audio.bell());
            soft(() => haptics.storm());
            return;
          }
          if (trainTier === 5) {
            // send the wave thread by thread through the whole web
            const from = nearestNode(nx, ny, 2);
            if (from >= 0) {
              wave.active = true;
              wave.t0 = performance.now();
              wave.order = graphOrder(nodes, fils, from);
              wave.stepMs = 120;
              ringNode(from, 0.6 + e.intensity * 0.4);
              soft(() => haptics.roll());
            }
            return;
          }
          if (trainTier === 3) {
            // three taps gather two nearby wanderers a step closer to merging
            const i = nearestNode(nx, ny, 0.2);
            if (i >= 0) {
              const a = nodes[i];
              for (const s of nodes) {
                if (s === a || s.presence < 1) continue;
                const dx = a.nx - s.nx;
                const dy = a.ny - s.ny;
                const d2 = dx * dx + dy * dy;
                if (d2 < 0.05) {
                  s.vx += dx * 0.4;
                  s.vy += dy * 0.4;
                }
              }
              ringNode(i, 0.4 + depth * 0.3);
              soft(() => haptics.ripple(0.5));
            }
            return;
          }
          // one tap: ring the nearest cluster at its mass's own pitch
          const i = nearestNode(nx, ny, 0.14);
          if (i >= 0) {
            ringNode(i, 0.4 + 0.6 * e.intensity);
            soft(() => haptics.tap());
          } else {
            soft(() => audio.playNote(72 + Math.round(e.intensity * 6), 140));
            soft(() => haptics.tap());
          }
        },
        hold: (e) => {
          mark();
          const nx = e.x / W();
          const ny = e.y / H();
          if (e.fingers === 3) {
            // three fingers hold the law: time dilates while held, deepening
            if (e.phase === "enter") {
              world.timeScaleK = 0.28;
              soft(() => haptics.tap());
            } else if (e.phase === "tick") {
              world.timeScaleK = Math.max(0.08, 0.28 - 0.2 * Math.min(1, e.elapsed / 4000));
            } else if (e.phase === "release") {
              world.timeScaleK = 1;
            }
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "release") {
            const s = nodes[seedingIdx];
            if (s && seedingFresh && e.elapsed < 900) {
              // lifted before the dwell — the condensation disperses on an exhale
              s.presence = 0.6;
              soft(() => audio.playNote(66, 160));
            } else if (s) {
              s.growth = 1;
              soft(() => audio.playNote(massPitchMidi(s.mass), 420));
              soft(() => haptics.ripple(0.5));
              writer.schedule();
            }
            seedingIdx = -1;
            seedingFresh = false;
            ceremonyFired = false;
            return;
          }
          // ceremony (tier 3): nucleate a NEW void inside the wall here — a
          // void-in-wall that pushes its own bubble. The one solemn act, and
          // the touch-reachable unmake (its outflow disperses the wall).
          if (e.tier >= 3 && !ceremonyFired) {
            ceremonyFired = true;
            voids.push(nucleateVoid(nextVoidId++, nx, ny, performance.now()));
            soft(() => audio.bell());
            soft(() => haptics.bloom());
            writer.schedule();
            return;
          }
          if (e.phase === "enter") {
            const i = nearestNode(nx, ny, 0.1);
            if (i >= 0) {
              seedingIdx = i;
              seedingFresh = false;
            } else {
              seedingIdx = spawnNode(nx, ny, performance.now());
              seedingFresh = true;
              soft(() => audio.spark());
            }
            soft(() => haptics.ripple(0.4));
            return;
          }
          // dwell (tier ≥ 1/2): matter condenses — mass climbs as the hold deepens
          if (e.tier >= 1) {
            const s = nodes[seedingIdx];
            if (!s) return;
            s.growth = Math.min(1, s.growth + 0.02);
            s.glow = Math.min(1, s.glow + 0.03);
            if (e.tier >= 2 && seedingFresh) {
              const target = 1 + Math.max(0, Math.floor((e.elapsed - 900) / 650));
              if (target > s.mass) {
                s.mass = target;
                soft(() => audio.playNote(massPitchMidi(s.mass), 180));
                soft(() => haptics.detent());
              }
            }
          }
        },
        drag: (e) => {
          mark();
          const nx = e.x / W();
          const ny = e.y / H();
          if (e.fingers === 3) {
            // weather: the intergalactic wind leans the whole field
            if (e.phase === "end") return;
            world.windX = Math.max(-1, Math.min(1, e.vx * 0.5));
            world.windY = Math.max(-1, Math.min(1, e.vy * 0.5));
            const now = performance.now();
            if (now - lastGrainAt > 300) {
              lastGrainAt = now;
              soft(() => haptics.roll());
            }
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "start") {
            heldIdx = nearestNode(nx, ny, 0.1);
            return;
          }
          if (e.phase === "end") {
            heldIdx = -1;
            return;
          }
          if (heldIdx >= 0 && nodes[heldIdx]) {
            // carrying a cluster — the hand's road to a merger
            const s = nodes[heldIdx];
            s.nx = Math.min(0.97, Math.max(0.03, nx));
            s.ny = Math.min(0.97, Math.max(0.03, ny));
            s.vx = e.vx / W();
            s.vy = e.vy / H();
          } else {
            // stretching the void: the drag pushes the nearest wall apart,
            // the filaments thin and the redshift deepens
            const vi = nearestVoid(nx, ny);
            if (vi >= 0) {
              const v = voids[vi];
              const dmag = Math.hypot(e.dx, e.dy) / W();
              v.radius = Math.min(0.92, v.radius + dmag * 1.4);
              const now = performance.now();
              if (now - lastGrainAt > 110) {
                lastGrainAt = now;
                soft(() => audio.playTone(70 + 260 * (1 - v.radius), 0.06));
                soft(() => haptics.chop());
              }
            }
          }
        },
        flick: (e) => {
          mark();
          // a wall collapses: its nodes fall together into one great attractor
          const i = nearestNode(e.x / W(), e.y / H(), 0.2);
          if (i < 0) return;
          const wall = wallOf(fils, i);
          collapseWall(nodes, wall, Math.min(0.9, 0.4 + e.speed * 0.2));
          soft(() => audio.thud());
          soft(() => haptics.storm());
          writer.schedule();
        },
        scrub: (e) => {
          mark();
          // drain matter along the filaments toward the walls — stir the outflow
          world.vortexX = e.cx / W();
          world.vortexY = e.cy / H();
          world.vortexW = Math.max(-2.4, Math.min(2.4, e.angularVelocity * 0.8));
          for (const s of nodes) s.drain = Math.min(1, s.drain + 0.06);
          const wAbs = Math.floor(Math.abs(e.winding));
          if (wAbs > prevWinding) {
            prevWinding = wAbs;
            soft(() => haptics.ripple(0.3));
            soft(() => audio.playTone(150 * Math.pow(2, -Math.min(3, wAbs) * 0.33), 0.4));
          }
          if (Math.abs(e.winding) < 0.2) prevWinding = 0;
        },
        twist: (e) => {
          mark();
          if (e.fingers === 3) {
            // three fingers turn the season: the expansion epoch — accelerate
            // the Hubble flow, or run it backward toward collapse
            const before = world.epoch;
            world.epoch = Math.max(-1, Math.min(1, world.epoch + e.angle * 0.5));
            if (Math.floor(before * 4) !== Math.floor(world.epoch * 4)) {
              soft(() => haptics.detent());
              soft(() => audio.chime());
            }
            return;
          }
          // two fingers rotate the lens: luminous-web → density-field → outflow
          world.lens = Math.max(0, Math.min(2, world.lens + e.angle * 0.5));
          markLens();
          if (e.phase === "end") soft(() => haptics.lens());
        },
        pan2: (e) => {
          mark();
          // the frame is the viewport (ScaleTravel owns its one verb); two
          // fingers only drift the far sky behind the web, a gentle parallax
          world.panX = Math.max(-1, Math.min(1, world.panX - e.dx / Math.max(1, W())));
          world.panY = Math.max(-1, Math.min(1, world.panY - e.dy / Math.max(1, H())));
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel: the device is this field's body ———
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduced) {
          world.gravX = 0;
          world.gravY = 0;
          return;
        }
        world.gravX = Math.max(-1, Math.min(1, gamma / 45));
        world.gravY = Math.max(-1, Math.min(1, beta / 70));
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        mark();
        world.agitation = Math.max(world.agitation, Math.min(1, intensity));
        soft(() => audio.buzz());
        soft(() => haptics.chop());
      },
      knock: ({ intensity }) => {
        mark();
        // a rap on the case: the whole web jumps, and settles
        for (const s of nodes) {
          const rng = mulberry32(hashSeed(s.seed, 0xbead));
          s.vx += (rng() - 0.5) * 0.08 * intensity;
          s.vy += (rng() - 0.5) * 0.08 * intensity;
          s.glow = Math.min(1, s.glow + 0.35 * intensity);
        }
        soft(() => audio.thud());
        soft(() => haptics.detent());
      },
      flip: ({ faceDown }) => {
        world.nightTarget = faceDown ? 1 : 0;
        soft(() => audio.playNote(faceDown ? 26 : 50, 400));
        soft(() => haptics.roll());
      },
    });

    // ——— the idle glimmer (grammar §6): after ~20s, one filament flares as
    // matter crosses it. Physical, never text.
    glimmerRef.current = () => {
      if (fils.length === 0) {
        if (nodes.length > 0) {
          const idx = Math.floor((performance.now() / 1000) % nodes.length);
          nodes[idx].glow = Math.min(1, nodes[idx].glow + 0.4);
        }
        return;
      }
      const idx = Math.floor((performance.now() / 1000) % fils.length);
      const f = fils[idx];
      nodes[f.a].glow = Math.min(1, nodes[f.a].glow + 0.35);
      nodes[f.b].glow = Math.min(1, nodes[f.b].glow + 0.35);
      f.strain = f.strain; // the flare rides the tension line itself
      soft(() => audio.playNote(massPitchMidi(nodes[f.a].mass), 200));
    };

    // ——— the exhale: <LetGo> empties the field, and it stays empty ———
    letGoRef.current = () => {
      for (const s of nodes) s.presence = Math.min(s.presence, 0.95);
      voids = []; // the push is gone; nothing keeps the walls apart
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, nodes: [], voids: [] }));
      } catch {
        /* noop */
      }
      writer.cancel();
      setStanding(0);
      soft(() => audio.thud());
      soft(() => haptics.roll());
    };

    // ——— the stage: one GL context, the field, the population, the overlay ——
    const stage = createGLStage(canvas, {
      wrap,
      label: "voids",
      reducedMotion: reduced,
      embedded: isEmbeddedFrame(),
      overlay: overlayCanvas,
    });
    const prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    const layer = stage
      ? createPopulationLayer(stage, {
          palette: ["#8fb6e6", "#e6eefb", "#b9a6e8"],
        })
      : null;
    const buffer = createInstanceBuffer(256);
    const voidUniform = new Float32Array(24);

    const gov = createFrameGovernor();
    let hidden = false;
    let galleryPaused = false;
    const offVisibility = onVisibility((h) => {
      hidden = h;
      if (h) gov.force("sleep");
    });
    const offGallery = onGalleryPause((p) => {
      galleryPaused = p;
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
      epoch: 0.4,
      timeScale: 1,
      reduced,
    };

    let raf = 0;
    let last = performance.now();
    let lastStanding = -1;
    let glimmerSlot = -1;
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

      // fields decay toward rest
      world.windX *= 0.985;
      world.windY *= 0.985;
      world.agitation *= 0.955;
      world.vortexW *= 0.97;
      world.density *= Math.exp(-dt / 1.6);
      world.night += (world.nightTarget - world.night) * Math.min(1, dt * 3);
      world.panX *= 0.995;
      world.panY *= 0.995;

      input.windX = world.windX;
      input.windY = world.windY;
      input.gravX = world.gravX;
      input.gravY = world.gravY;
      input.agitation = world.agitation;
      input.vortexX = world.vortexX;
      input.vortexY = world.vortexY;
      input.vortexW = world.vortexW;
      input.epoch = world.epoch;
      input.timeScale = world.timeScaleK;

      // the void expands (or collapses) on its Hubble clock, then the web steps
      stepVoids(voids, world.epoch, dt * world.timeScaleK);
      // a nucleated void that has pushed its bubble to the frame retires
      for (let i = voids.length - 1; i >= 0; i--) {
        if (voids[i].radius >= 0.9) voids.splice(i, 1);
      }
      stepWeb(nodes, fils, voids, input, t, dt);
      fils = weaveFilaments(nodes);

      // a filament that snapped is heard — the tension line lets go
      curKeys.clear();
      for (const f of fils) curKeys.add(nodes[f.a].id * 4096 + nodes[f.b].id);
      if (t - lastSnapAt > 200) {
        for (const k of prevKeys) {
          if (!curKeys.has(k)) {
            soft(() => audio.buzz());
            soft(() => haptics.tap());
            lastSnapAt = t;
            break;
          }
        }
      }
      prevKeys.clear();
      for (const k of curKeys) prevKeys.add(k);

      // two clusters drawn together fall into one great attractor
      const pair = findMergePair(nodes);
      if (pair) {
        const [ia, ib] = pair;
        const child = mergeNodes(nodes[ia], nodes[ib], nextId++, t);
        nodes[ia].presence = 0;
        nodes[ib].presence = 0;
        nodes.push(child);
        if (heldIdx === ia || heldIdx === ib) heldIdx = -1;
        if (seedingIdx === ia || seedingIdx === ib) seedingIdx = -1;
        soft(() => audio.chime());
        soft(() => audio.playNote(massPitchMidi(child.mass), 520));
        soft(() => haptics.bloom());
        writer.schedule();
      }

      // the tutti wave, walking the graph filament by filament
      if (wave.active) {
        const front = (t - wave.t0) / wave.stepMs;
        let alive = false;
        for (let i = 0; i < nodes.length && i < wave.order.length; i++) {
          const dpt = wave.order[i];
          if (dpt < 0) continue;
          if (dpt > front) {
            alive = true;
            continue;
          }
          if (dpt > front - 1 && nodes[i].glow < 0.5) {
            nodes[i].glow = 1;
            soft(() => audio.playNote(massPitchMidi(nodes[i].mass), 200));
          }
        }
        if (!alive) wave.active = false;
      }

      // the ≥20s glimmer: a single filament flaring as matter crosses it
      if (!reduced && t - lastInteractionAt > IDLE_GLIMMER_MS) {
        const slot = Math.floor(t / 4200);
        if (slot !== glimmerSlot) {
          glimmerSlot = slot;
          glimmerRef.current();
        }
      }

      // retire the spent
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i].presence <= 0) {
          nodes.splice(i, 1);
          if (heldIdx === i) heldIdx = -1;
          else if (heldIdx > i) heldIdx--;
          if (seedingIdx === i) seedingIdx = -1;
          else if (seedingIdx > i) seedingIdx--;
        }
      }

      // ——— render ———
      if (stage && prog) {
        stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: world.agitation, reducedMotion: reduced }),
          prog,
        );
        prog.setFloat("u_epoch", world.epoch);
        prog.setFloat("u_lens", world.lens);
        prog.setFloat("u_dilate", input.timeScale);
        prog.setFloat("u_night", world.night);
        prog.setFloat("u_octaves", Math.max(2, Math.round(2 + detail.particles * 3)));
        prog.setVec2("u_pan", world.panX, world.panY);
        let vn = 0;
        for (let i = 0; i < voids.length && vn < 8; i++) {
          voidUniform[vn * 3] = voids[i].cx;
          voidUniform[vn * 3 + 1] = voids[i].cy;
          voidUniform[vn * 3 + 2] = voids[i].radius;
          vn++;
        }
        prog.setFloatArray("u_voids", voidUniform);
        prog.setFloat("u_voidCount", vn);
        quad?.draw();

        const size = stage.size;
        const m = Math.min(size.width, size.height);

        // the clusters, in one instanced pass
        buffer.reset();
        for (const s of nodes) {
          const px = s.nx * size.width;
          const py = s.ny * size.height;
          // hue: cool blue → white with mass, toward violet as matter drains on
          const hue = Math.min(0.95, 0.15 + Math.min(1, (s.mass - 1) / 10) * 0.45 + s.drain * 0.35);
          buffer.push(
            px,
            py,
            massRadius(s.mass) * m * (0.85 + 0.22 * breath) * (0.45 + 0.55 * s.growth),
            0,
            hue,
            0.3 + s.glow * 0.7,
            0.4 + 0.6 * breath,
            s.presence * (0.55 + 0.45 * s.growth),
          );
        }
        layer?.draw(buffer);

        // ——— the overlay: filaments (tension lines) and the matter creeping
        // along them toward the walls ———
        const ctx = stage.overlay2d;
        if (ctx) {
          ctx.clearRect(0, 0, size.width, size.height);
          const lensWeb = 1 - Math.min(1, Math.abs(world.lens));
          for (const f of fils) {
            const A = nodes[f.a];
            const B = nodes[f.b];
            const glow = Math.max(A.glow, B.glow);
            // a filament thins (fades) as the void stretches it — strain → 0 alpha
            const a =
              (0.14 + 0.34 * (1 - f.strain) + glow * 0.4) *
              Math.min(A.presence, B.presence) *
              (1 - world.night * 0.8);
            if (a <= 0.02) continue;
            ctx.globalAlpha = Math.min(0.8, a);
            // dim amber/rose, deepening toward rose (redshift) with strain
            ctx.strokeStyle = f.strain > 0.6 ? "#c26a5e" : "#c98f5e";
            ctx.lineWidth = (0.6 + (1 - f.strain) * 1.4) * (0.7 + lensWeb * 0.5);
            const ax = A.nx * size.width;
            const ay = A.ny * size.height;
            const bx = B.nx * size.width;
            const by = B.ny * size.height;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
            // matter creeping toward the heavier wall — a faint violet mote
            if (!reduced && a > 0.12) {
              const flow = (tSec * 0.16 + (f.a + f.b) * 0.13) % 1;
              const toB = B.mass >= A.mass;
              const u = toB ? flow : 1 - flow;
              ctx.globalAlpha = Math.min(0.6, a) * (0.5 + 0.5 * breath);
              ctx.fillStyle = "#9a7fd0";
              ctx.beginPath();
              ctx.arc(ax + (bx - ax) * u, ay + (by - ay) * u, 1.4 + 0.8 * breath, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          ctx.globalAlpha = 1;
        }
      }

      let live = 0;
      for (const s of nodes) if (s.presence > 0.6) live++;
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
      writer.flush();
      layer?.dispose();
      quad?.dispose();
      stage?.dispose();
    };
  }, []);

  const letGo = useCallback(() => letGoRef.current(), []);

  // keyboard baseline — a cluster condenses at centre on Enter, the lens lowers
  // on Escape; the pointer grammar carries the rest.
  const onKeyDown = useCallback((e: { key: string }) => {
    if (e.key === "Enter") glimmerRef.current();
  }, []);

  const letGoControl = useMemo(
    () => ({ label: "let the void go", onLetGo: letGo, visible: standing > 0 }),
    [letGo, standing],
  );

  return (
    <div
      ref={wrapRef}
      style={{ position: "fixed", inset: 0, background: "#04050a", overflow: "hidden" }}
    >
      <canvas
        ref={canvasRef}
        role="application"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="the emptiness that pushes — a great cosmic void bounded by the web; rest a finger and a cluster condenses, hold longer and it gathers mass, and the void breathes wider as its outflow drains matter onto the walls"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <canvas
        ref={overlayRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
      <LetGo {...letGoControl} />
    </div>
  );
}
