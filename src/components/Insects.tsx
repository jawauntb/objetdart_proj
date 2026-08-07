"use client";

/**
 * /insects — a dusk meadow-edge swarm, where bodies are their behaviors.
 *
 * The material is the failing light over a meadow, one fragment shader:
 * indigo-violet sky, a grass silhouette breathing on the 7s clock, and a warm
 * lantern low at the edge that pulses on the same breath. The population is
 * the swarm — motes that graze the flock, pollinators drawn to the light,
 * and (when the ceremony calls one) a predator that hunts. An insect here is
 * never a decal: it IS its behavior + its lifecycle stage + its causal role,
 * and every law it obeys lives in src/lib/insects.ts, pure and node-tested.
 * This file renders what those laws decide and says what each verb means here.
 *
 * The tap train climbs: one tap startles the nearest body into a chirp, three
 * scatter the near swarm, five send a light-ripple through the whole meadow,
 * and the peal makes the entire meadow stridulate at once. A dwell lays a
 * clutch that hatches and pupates under the held finger; a drag draws a scent
 * the flock follows; the ceremony hold releases a mantis that thins them.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier, tapTrainDepth } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import LetGo from "@/components/LetGo";
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
  bornInsect,
  broodAdvance,
  chirpMidi,
  hashSeed,
  huntCatches,
  layClutch,
  layEgg,
  loadSwarm,
  mateEncounter,
  mulberry32,
  retireOldest,
  serializeSwarm,
  stageRadius,
  stepSwarm,
  wingHz,
  EGG,
  IMAGO,
  IMAGO_MS,
  MOTE,
  POLLINATOR,
  PREDATOR,
  SWARM_CAP,
  type Insect,
  type SwarmInput,
} from "@/lib/insects";

const STORAGE_KEY = "objetdart:insects:v1";
const ROOM_SEED = 0x1a5ec7;
const GLIMMER_MS = 20000;
const CLUTCH = 6;
/** the lantern's seat, low at the meadow's edge — the phototaxis anchor. */
const LANTERN_X = 0.5;
const LANTERN_Y = 0.82;

// ——— the meadow at dusk: one fragment shader ————————————————————————————
const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float uTime;
uniform float uBreath;
uniform float uTurbulence;
uniform float uReduced;
uniform float uEpoch;   // 0 dawn · 0.5 dusk · 1 night
uniform float uNight;   // face-down sleep
uniform float uLens;    // 0 swarm · 1 web · 2 spectrum (tints the field faintly)
uniform vec3 uLight;    // lantern x, y (0..1), strength
uniform vec2 uPan;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), s.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), s.x), s.y);
}

void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  uv += uPan;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  float t = uTime * (1.0 - 0.75 * uReduced);

  // the dusk sky: deep indigo low, a bruise of violet, a moonlit silver crown.
  // the season swings it warm at dawn and cold-dark into night.
  vec3 low = mix(vec3(0.043, 0.039, 0.078), vec3(0.030, 0.028, 0.060), uEpoch);
  vec3 high = mix(vec3(0.14, 0.10, 0.20), vec3(0.05, 0.06, 0.12), uEpoch);
  vec3 sky = mix(low, high, pow(uv.y, 1.3));
  // a warm horizon band that only dawn and dusk carry
  float duskband = (1.0 - smoothstep(0.0, 0.34, abs(uv.y - 0.2))) * (0.6 - abs(uEpoch - 0.5) * 1.1);
  sky += vec3(0.36, 0.20, 0.12) * max(0.0, duskband) * (0.7 + 0.3 * uBreath);
  // a moonlit silver haze up top, brightest at night
  sky += vec3(0.10, 0.12, 0.17) * pow(uv.y, 2.4) * (0.4 + 0.6 * uEpoch);

  // faint dust motes drifting — the air is never empty
  float dust = noise(vec2(uv.x * aspect * 7.0 + t * 0.03, uv.y * 7.0 - t * 0.02));
  sky += vec3(0.05, 0.05, 0.07) * smoothstep(0.7, 1.0, dust) * (0.5 + 0.5 * uBreath);

  // the lantern: a warm amber glow low at the edge, breathing on the 7s clock
  vec2 lp = vec2(uLight.x * aspect, uLight.y);
  float ld = distance(vec2(uv.x * aspect, uv.y), lp);
  float lamp = exp(-ld * 3.4) * uLight.z * (0.7 + 0.3 * uBreath);
  sky += vec3(0.98, 0.72, 0.34) * lamp;
  sky += vec3(1.0, 0.85, 0.5) * exp(-ld * 12.0) * uLight.z * (0.8 + 0.2 * uBreath);

  // the grass silhouette at the meadow's edge, swaying on the breath
  float horizon = 0.14;
  float bladeX = uv.x * aspect * 30.0;
  float sway = (sin(bladeX * 0.7 + t * 0.5) + sin(bladeX * 1.9 - t * 0.3)) * 0.012 * (0.6 + 0.6 * uBreath);
  float blades = horizon + sway + noise(vec2(bladeX, 0.0)) * 0.06;
  float grass = smoothstep(blades + 0.01, blades - 0.01, uv.y);
  vec3 grassCol = mix(vec3(0.03, 0.05, 0.03), vec3(0.06, 0.10, 0.05), 0.5 + 0.5 * uBreath);
  grassCol += vec3(0.20, 0.16, 0.06) * lamp * 2.0; // grass catches the lantern
  sky = mix(sky, grassCol, grass);

  // the lens tints the whole field a hair so the register is legible
  sky += vec3(0.02, 0.05, 0.03) * (1.0 - abs(uLens - 1.0)) * 0.6;      // web: green
  sky += vec3(0.06, 0.02, 0.06) * max(0.0, uLens - 1.0) * 0.6;          // spectrum: violet
  sky += vec3(0.03, 0.03, 0.05) * uTurbulence;

  sky *= 1.0 - 0.8 * uNight;
  gl_FragColor = vec4(sky, 1.0);
}`;

type Api = {
  layClutchAt(nx: number, ny: number): void;
  ceremony(): void;
  letGo(): void;
  glimmer(): void;
};

export default function Insects() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const cursorRef = useRef({ nx: 0.5, ny: 0.5 });
  const [alive, setAlive] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !canvas || !overlay) return;

    const audio = getFieldAudio();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;
    const onMq = () => {
      reduced = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    // ——— the standing swarm, from the laws in lib/insects ———
    let swarm: Insect[] = [];
    let nextId = 1;
    const writer = createIdleWriter(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeSwarm(swarm)));
      } catch {
        /* quota / private mode — the meadow still plays */
      }
    });
    let cleared = false;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        cleared = parsed && parsed.cleared === true;
        swarm = loadSwarm(parsed, performance.now());
      }
    } catch {
      /* a fresh meadow */
    }
    if (swarm.length === 0 && !cleared) {
      // a meadow is never bare at dusk — a seeded starter flight
      const rng = mulberry32(ROOM_SEED);
      for (let i = 0; i < 16; i++) {
        const role = rng() < 0.24 ? POLLINATOR : MOTE;
        const mature = rng() < 0.7 ? IMAGO_MS : rng() * IMAGO_MS;
        swarm.push(
          bornInsect(nextId++, hashSeed(ROOM_SEED, i), 0.12 + rng() * 0.76, 0.2 + rng() * 0.55, performance.now(), role, mature),
        );
      }
    }
    for (const s of swarm) nextId = Math.max(nextId, s.id + 1);
    setAlive(swarm.length);

    // ——— the world's own fields ———
    const world = {
      windX: 0,
      windY: 0,
      gravX: 0,
      gravY: 0,
      agitation: 0,
      epoch: 0.5,
      lens: 0,
      lensTarget: 0,
      lensSnapped: 0,
      night: 0,
      nightTarget: 0,
      timeScaleK: 1,
      timeScaleTarget: 1,
      scentX: 0.5,
      scentY: 0.5,
      scentStrength: 0,
      panX: 0,
      panY: 0,
    };
    const scentTrail: number[] = new Array(48).fill(-1); // x,y,t triples ring
    let scentHead = 0;
    let heldClutch: Insect[] = [];
    let dragScent = false;
    let lastInteractionAt = performance.now();
    let lastGlimmerAt = performance.now();
    let prevWinding = 0;
    let lastChirpAt = 0;

    const rectOf = () => wrap.getBoundingClientRect();
    const soft = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* audio or haptics unavailable — the meadow still plays */
      }
    };
    const markLens = () => {
      if (world.lens > 0.12) wrap.setAttribute("data-lens-raised", "1");
      else wrap.removeAttribute("data-lens-raised");
    };

    const nearest = (nx: number, ny: number, reach: number): number => {
      let best = -1;
      let bestD = reach * reach;
      for (let i = 0; i < swarm.length; i++) {
        const s = swarm[i];
        if (s.presence < 0.5) continue;
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

    const chirp = (i: number, strength: number) => {
      const s = swarm[i];
      if (!s) return;
      const now = performance.now();
      if (now - lastChirpAt < 40) return;
      lastChirpAt = now;
      soft(() => audio.playNote(chirpMidi(s.seed), 120 + 260 * strength));
    };

    const spawnClutch = (nx: number, ny: number): Insect[] => {
      let live = 0;
      for (const s of swarm) if (s.presence >= 1) live++;
      while (live + CLUTCH > SWARM_CAP) {
        retireOldest(swarm);
        live--;
        soft(() => audio.buzz());
      }
      const eggs = layClutch(nx, ny, hashSeed(ROOM_SEED, nextId, Math.floor(nx * 997), Math.floor(ny * 997)), performance.now(), CLUTCH, nextId, MOTE);
      nextId += CLUTCH;
      for (const e of eggs) swarm.push(e);
      return eggs;
    };

    const tutti = (strength: number) => {
      // the whole meadow stridulates at once — every body answers, softly
      let voiced = 0;
      for (const s of swarm) {
        if (s.presence < 0.5) continue;
        if (s.stage === IMAGO && voiced < 8) {
          voiced++;
          soft(() => audio.playNote(chirpMidi(s.seed), 220 + 200 * strength));
        }
      }
      stirTurbulence(0.06 + strength * 0.1);
      soft(() => haptics.roll());
    };

    apiRef.current = {
      layClutchAt(nx, ny) {
        heldClutch = spawnClutch(nx, ny);
        soft(() => audio.spark());
        soft(() => haptics.ripple(0.45));
        writer.schedule();
        setAlive(swarm.length);
      },
      ceremony() {
        // the one solemn act: a mantis is released and thins the swarm.
        // it lands as an imago predator and hunts on the shared trophic law.
        const rng = mulberry32(hashSeed(ROOM_SEED, nextId, Math.floor(performance.now())));
        while (swarm.filter((s) => s.presence >= 1).length >= SWARM_CAP) retireOldest(swarm);
        const mantis = bornInsect(
          nextId++,
          hashSeed(ROOM_SEED, 0xdead, nextId),
          0.15 + rng() * 0.7,
          0.3 + rng() * 0.4,
          performance.now(),
          PREDATOR,
          IMAGO_MS,
        );
        swarm.push(mantis);
        soft(() => audio.thud());
        soft(() => audio.playNote(chirpMidi(mantis.seed) - 24, 620));
        soft(() => haptics.storm());
        writer.schedule();
        setAlive(swarm.length);
      },
      letGo() {
        // an exhale, never a blink — and an emptied meadow stays empty
        for (const s of swarm) s.presence = Math.min(s.presence, 0.9);
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, bodies: [], cleared: true }));
        } catch {
          /* noop */
        }
        writer.cancel();
        setAlive(0);
        soft(() => audio.thud());
        soft(() => haptics.roll());
      },
      glimmer() {
        // the idle hint is physical: one cricket chirps, and a ripple of light
        // passes through the swarm — never a word
        const rng = mulberry32(hashSeed(ROOM_SEED, Math.floor(performance.now() / 1000)));
        const imagoes = swarm.filter((s) => s.stage === IMAGO && s.presence >= 0.5);
        if (imagoes.length) {
          const s = imagoes[Math.floor(rng() * imagoes.length)];
          soft(() => audio.playNote(chirpMidi(s.seed), 340));
          world.scentX = s.nx;
          world.scentY = s.ny;
          world.scentStrength = Math.max(world.scentStrength, 0.5);
        }
        soft(() => haptics.tap());
      },
    };

    // ——— the stage: one GL context, the field then the swarm ———
    const embedded = isEmbeddedFrame();
    const stage = createGLStage(canvas, {
      wrap,
      label: "insects",
      reducedMotion: reduced,
      embedded,
      overlay,
    });
    const prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    const layer = stage
      ? createPopulationLayer(stage, {
          // chitin green-gold · warm lantern amber · moonlit silver
          palette: ["#8fbf72", "#e8b46a", "#cfd6ea"],
        })
      : null;
    const buffer = createInstanceBuffer(SWARM_CAP + CLUTCH + 4);

    const gov = createFrameGovernor(embedded ? "medium" : "high");
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

    const input: SwarmInput = {
      windX: 0,
      windY: 0,
      gravX: 0,
      gravY: 0,
      agitation: 0,
      lightX: LANTERN_X,
      lightY: LANTERN_Y,
      lightStrength: 0.3,
      scentX: 0.5,
      scentY: 0.5,
      scentStrength: 0,
      epoch: 0.5,
      timeScale: 1,
      reduced,
    };

    // ——— the grammar ———
    // Mounted on the OVERLAY (the topmost surface); the wrapper is fixed and
    // its stacking context would swallow the quiet clear.
    const detachGestures = attachGestures(
      overlay,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) return; // ScaleTravel's step back
          if (e.fingers === 3) {
            // tutti — the whole meadow stridulates at once
            tutti(0.4 + e.intensity * 0.5);
            return;
          }
          if (e.fingers !== 1) return;
          const r = rectOf();
          const nx = (e.x - r.left) / Math.max(1, r.width);
          const ny = (e.y - r.top) / Math.max(1, r.height);
          cursorRef.current = { nx, ny };
          const trainTier = tapTrainTier(e.count);
          const depth = tapTrainDepth(e.count);
          if (trainTier === "n") {
            // the peal: a chorus that climbs with every extra tap
            tutti(0.6 + depth * 0.4);
            soft(() => audio.chime());
            return;
          }
          if (trainTier === 5) {
            // a light-ripple sweeps the whole swarm toward the lantern for a beat
            world.scentX = LANTERN_X;
            world.scentY = LANTERN_Y;
            world.scentStrength = 1;
            soft(() => audio.playNote(70, 260));
            soft(() => haptics.ripple(0.5));
            return;
          }
          if (trainTier === 3) {
            // three raps scatter the near swarm into a startled swirl
            for (const s of swarm) {
              const dx = s.nx - nx;
              const dy = s.ny - ny;
              const d2 = dx * dx + dy * dy;
              if (d2 < 0.05 && s.stage === IMAGO) {
                const push = 0.5 * (0.4 + e.intensity);
                const dd = Math.max(1e-3, Math.hypot(dx, dy));
                s.vx += (dx / dd) * push;
                s.vy += (dy / dd) * push;
              }
            }
            const i = nearest(nx, ny, 0.12);
            if (i >= 0) chirp(i, 0.5 + e.intensity * 0.4);
            soft(() => haptics.ripple(0.4 + e.intensity * 0.3));
            return;
          }
          // one tap: startle the nearest body into a chirp; on bare air, a hush
          const i = nearest(nx, ny, 0.1);
          if (i >= 0) {
            const s = swarm[i];
            s.vx += (nx - s.nx) * -1.6;
            s.vy += (ny - s.ny) * -1.6;
            chirp(i, 0.4 + 0.6 * e.intensity);
            soft(() => haptics.ripple(0.3 + e.intensity * 0.3));
          } else {
            soft(() => audio.playTone(wingHz(MOTE) * (0.8 + e.intensity * 0.4), 0.08));
            soft(() => haptics.ripple(0.2));
          }
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // time dilation is a continuous axis — the meadow keeps slowing the
            // longer the three fingers stay, never the same at 900ms as 2400ms
            if (e.phase === "enter") {
              world.timeScaleTarget = 0.6;
              soft(() => audio.playNote(30, 480));
              soft(() => haptics.tap());
            } else if (e.phase === "release") {
              world.timeScaleTarget = 1;
            } else {
              world.timeScaleTarget = Math.max(0.12, 0.6 - 0.5 * (e.elapsed / (e.elapsed + 1600)));
            }
            return;
          }
          if (e.fingers !== 1) return;
          const r = rectOf();
          const nx = (e.x - r.left) / Math.max(1, r.width);
          const ny = (e.y - r.top) / Math.max(1, r.height);
          if (e.phase === "enter") {
            if (e.tier >= 1) apiRef.current?.layClutchAt(nx, ny); // dwell: lay a clutch
            return;
          }
          if (e.phase === "release") {
            if (e.tier >= 3) apiRef.current?.ceremony(); // ceremony: release the mantis
            heldClutch = [];
            writer.schedule();
            return;
          }
          // duration deepens: dwell tiers advance the brood you laid, one whole
          // stage at a time, and the light glows warmer the longer you hold
          if (e.tier >= 2 && heldClutch.length) {
            for (const s of heldClutch) {
              if (s.presence >= 0.5) broodAdvance(s);
            }
            heldClutch = [];
            soft(() => audio.playNote(56, 200));
            soft(() => haptics.detent());
            setAlive(swarm.length);
          }
          input.lightStrength = Math.min(0.9, 0.3 + e.elapsed / 4000);
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // three fingers are the breeze: a wind that herds or scatters
            world.windX = Math.max(-1, Math.min(1, world.windX + e.dx * 0.006));
            world.windY = Math.max(-1, Math.min(1, world.windY + e.dy * 0.006));
            return;
          }
          if (e.fingers !== 1) return;
          const r = rectOf();
          const nx = (e.x - r.left) / Math.max(1, r.width);
          const ny = (e.y - r.top) / Math.max(1, r.height);
          if (e.phase === "start") {
            dragScent = true;
            return;
          }
          if (e.phase === "end") {
            dragScent = false;
            return;
          }
          // one finger draws a scent trail the swarm follows
          dragScent = true;
          world.scentX = nx;
          world.scentY = ny;
          world.scentStrength = 1;
          scentTrail[scentHead * 3] = nx;
          scentTrail[scentHead * 3 + 1] = ny;
          scentTrail[scentHead * 3 + 2] = performance.now();
          scentHead = (scentHead + 1) % 16;
          const now = performance.now();
          if (now - lastChirpAt > 90) {
            lastChirpAt = now;
            soft(() => audio.playTone(600 + 500 * (1 - ny), 0.05));
            soft(() => haptics.tap());
          }
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers !== 1) return;
          const r = rectOf();
          const nx = (e.x - r.left) / Math.max(1, r.width);
          const ny = (e.y - r.top) / Math.max(1, r.height);
          // a swat: a scatter burst, and some caught bodies are struck loose
          let hit = 0;
          for (const s of swarm) {
            const dx = s.nx - nx;
            const dy = s.ny - ny;
            const d2 = dx * dx + dy * dy;
            if (d2 < 0.03) {
              const k = Math.min(3, e.speed) * 0.4;
              s.vx = Math.cos(e.angle) * k + dx * 3;
              s.vy = Math.sin(e.angle) * k + dy * 3;
              if (d2 < 0.006 && s.stage === IMAGO && hit < 2) {
                s.presence = Math.min(s.presence, 0.85); // a couple are swatted down
                hit++;
              }
            }
          }
          stirTurbulence(0.12);
          soft(() => audio.buzz());
          soft(() => haptics.chop());
          if (hit) writer.schedule();
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // three fingers turn the season: dawn ↔ dusk ↔ night, and the
            // chorus follows — the swarm is most awake at dusk
            if (e.phase === "move") {
              world.epoch = ((world.epoch + e.angle / 3.2) % 1 + 1) % 1;
            } else if (e.phase === "end") {
              soft(() => audio.playNote(40 + Math.round(world.epoch * 16), 340));
              soft(() => haptics.detent());
            }
            return;
          }
          // two fingers raise the lens: swarm → trophic-web → stridulation
          if (e.phase === "move") {
            world.lensTarget = Math.max(0, Math.min(2, world.lensTarget + e.angle / 1.6));
          } else if (e.phase === "end") {
            world.lensSnapped = Math.round(world.lensTarget);
            world.lensTarget = world.lensSnapped;
            markLens();
            soft(() => haptics.lens());
            soft(() => audio.chime());
          }
        },
        pan2: (e) => {
          // the frame yields travel to ScaleTravel; a two-finger drag only
          // leans the meadow a little, a soft parallax of the dusk
          if (e.phase === "move") {
            world.panX = Math.max(-0.08, Math.min(0.08, world.panX - e.dx * 0.0004));
            world.panY = Math.max(-0.08, Math.min(0.08, world.panY + e.dy * 0.0004));
          }
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          // stirring the air is a gust that herds the swarm around the circle
          world.windX = Math.max(-1, Math.min(1, world.windX + Math.cos(e.winding) * 0.25));
          world.windY = Math.max(-1, Math.min(1, world.windY + Math.sin(e.winding) * 0.25));
          const wAbs = Math.floor(Math.abs(e.winding));
          if (wAbs > prevWinding) {
            prevWinding = wAbs;
            stirTurbulence(0.1);
            soft(() => audio.playTone(320, 0.2));
            soft(() => haptics.ripple(0.35));
          }
          if (Math.abs(e.winding) < 0.2) prevWinding = 0;
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel ———
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduced) return;
        world.gravX = Math.max(-1, Math.min(1, gamma / 45));
        world.gravY = Math.max(-1, Math.min(1, beta / 70));
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        // agitation scatters the whole swarm off the wind
        world.agitation = Math.max(world.agitation, Math.min(1, intensity));
        stirTurbulence(0.2 + intensity * 0.3);
        soft(() => audio.buzz());
        soft(() => haptics.chop());
      },
      knock: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        // a rap on the case rings the meadow: every body startles and chirps
        for (const s of swarm) {
          const rng = mulberry32(hashSeed(s.seed, 0xbee));
          s.vx += (rng() - 0.5) * 0.4 * intensity;
          s.vy += (rng() - 0.5) * 0.4 * intensity;
        }
        const first = swarm.find((s) => s.stage === IMAGO && s.presence >= 0.5);
        if (first) soft(() => audio.playNote(chirpMidi(first.seed), 260));
        soft(() => audio.thud());
        soft(() => haptics.detent());
      },
      flip: ({ faceDown }) => {
        world.nightTarget = faceDown ? 1 : 0;
        if (faceDown) soft(() => haptics.detent());
      },
    });

    // ——— keyboard ———
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        if (world.lensSnapped !== 0) {
          world.lensSnapped = 0;
          world.lensTarget = 0;
          markLens();
        }
        return;
      }
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft" || ev.key === "ArrowUp" || ev.key === "ArrowDown") {
        ev.preventDefault();
        const dx = ev.key === "ArrowRight" ? 0.05 : ev.key === "ArrowLeft" ? -0.05 : 0;
        const dy = ev.key === "ArrowDown" ? 0.05 : ev.key === "ArrowUp" ? -0.05 : 0;
        cursorRef.current.nx = Math.min(0.95, Math.max(0.05, cursorRef.current.nx + dx));
        cursorRef.current.ny = Math.min(0.95, Math.max(0.05, cursorRef.current.ny + dy));
        lastInteractionAt = performance.now();
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        apiRef.current?.layClutchAt(cursorRef.current.nx, cursorRef.current.ny);
      }
    };
    overlay.addEventListener("keydown", onKeyDown);

    // ——— the loop ———
    let raf = 0;
    let last = performance.now();
    let lastAlive = swarm.length;
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

      // fields ease toward rest
      world.windX *= 0.96;
      world.windY *= 0.96;
      world.agitation *= 0.94;
      world.scentStrength *= dragScent ? 1 : Math.exp(-dt / 0.9);
      world.night += (world.nightTarget - world.night) * Math.min(1, dt * 3);
      world.timeScaleK += (world.timeScaleTarget - world.timeScaleK) * Math.min(1, dt * 6);
      world.lens += (world.lensTarget - world.lens) * Math.min(1, dt * 8);

      input.windX = world.windX;
      input.windY = world.windY;
      input.gravX = world.gravX;
      input.gravY = world.gravY;
      input.agitation = world.agitation;
      input.epoch = world.epoch;
      input.timeScale = world.timeScaleK;
      input.scentX = world.scentX;
      input.scentY = world.scentY;
      input.scentStrength = world.scentStrength;
      // the lantern breathes; at rest it eases back to a gentle draw
      input.lightStrength += (0.3 - input.lightStrength) * Math.min(1, dt * 0.5);
      input.lightX = LANTERN_X;
      input.lightY = LANTERN_Y;

      stepSwarm(swarm, input, t, dt);

      // predators catch prey — the trophic web is a real force, not a decal
      const caught = huntCatches(swarm);
      if (caught.length) {
        for (const ci of caught) {
          if (swarm[ci].presence >= 1) {
            swarm[ci].presence = 0.6;
            soft(() => audio.playNote(48, 90));
          }
        }
        soft(() => haptics.tap());
        writer.schedule();
      }

      // two mature motes that meet lay an egg that is neither parent
      const pair = mateEncounter(swarm, t);
      if (pair && swarm.filter((s) => s.presence >= 1).length < SWARM_CAP) {
        const egg = layEgg(swarm[pair[0]], swarm[pair[1]], nextId++, t);
        swarm.push(egg);
        soft(() => audio.playTone(wingHz(MOTE) * 1.2, 0.05));
        writer.schedule();
      }

      // retire the spent
      for (let i = swarm.length - 1; i >= 0; i--) {
        if (swarm[i].presence <= 0) swarm.splice(i, 1);
      }

      // the ~20s glimmer: one chirp, one ripple of light — never a word
      if (t - lastInteractionAt > GLIMMER_MS && t - lastGlimmerAt > GLIMMER_MS) {
        lastGlimmerAt = t;
        apiRef.current?.glimmer();
      }

      // ——— render ———
      if (stage && prog) {
        const size = stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: world.agitation, reducedMotion: reduced }),
          prog,
        );
        prog.setFloat("uEpoch", world.epoch);
        prog.setFloat("uNight", world.night);
        prog.setFloat("uLens", world.lens);
        prog.setVec3("uLight", LANTERN_X, LANTERN_Y, input.lightStrength);
        prog.setVec2("uPan", world.panX, world.panY);
        quad?.draw();

        const W = size.width;
        const H = size.height;
        const minDim = Math.min(W, H);
        buffer.reset();
        for (const s of swarm) {
          const wob = (tSec * wingHz(s.role) * 0.0016 + s.seed * 0.0011) % 1;
          const wing = s.stage === IMAGO ? 0.5 + 0.45 * Math.abs(Math.sin(wob * Math.PI * 2)) : 0.12;
          const hue = s.role === PREDATOR ? 1.0 : s.role === POLLINATOR ? 0.5 : s.stage === EGG ? 0.03 : 0.17;
          const px = (s.nx + world.panX) * W;
          const py = (s.ny + world.panY) * H;
          buffer.push(
            px,
            py,
            stageRadius(s.stage, s.role) * minDim * (0.85 + 0.25 * breath) * (0.6 + 0.4 * detail.particles),
            wob * Math.PI * 2,
            hue,
            (s.stage === IMAGO ? 0.4 + wing * 0.55 : 0.15) * (s.role === PREDATOR ? 0.7 : 1),
            wing,
            s.presence * (s.stage === EGG ? 0.6 : 1),
          );
        }
        layer?.draw(buffer);

        // ——— the overlay: scent trail, and the two lenses — flat strokes ———
        const ctx = stage.overlay2d;
        if (ctx) {
          ctx.clearRect(0, 0, W, H);
          // the drawn scent, fading
          if (world.scentStrength > 0.02) {
            ctx.strokeStyle = "#e8b46a";
            ctx.lineWidth = 1.4;
            for (let i = 0; i < 16; i++) {
              const sx = scentTrail[i * 3];
              const st = scentTrail[i * 3 + 2];
              if (sx < 0) continue;
              const age = (t - st) / 1400;
              if (age >= 1) continue;
              ctx.globalAlpha = (1 - age) * 0.5 * world.scentStrength;
              ctx.beginPath();
              ctx.arc(scentTrail[i * 3] * W, scentTrail[i * 3 + 1] * H, 3 + age * 10, 0, Math.PI * 2);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
          const lensNet = 1 - Math.min(1, Math.abs(world.lens - 1));
          if (lensNet > 0.05) {
            // the trophic web: a line from each predator to the prey it hunts
            ctx.strokeStyle = "#8fbf72";
            ctx.lineWidth = 1;
            for (const p of swarm) {
              if (p.role !== PREDATOR || p.stage !== IMAGO || p.presence < 0.5) continue;
              for (const q of swarm) {
                if (q.role === PREDATOR || q.stage !== IMAGO || q.presence < 0.5) continue;
                const d = Math.hypot(p.nx - q.nx, p.ny - q.ny);
                if (d > 0.45) continue;
                ctx.globalAlpha = lensNet * (1 - d / 0.45) * 0.5;
                ctx.beginPath();
                ctx.moveTo((p.nx + world.panX) * W, (p.ny + world.panY) * H);
                ctx.lineTo((q.nx + world.panX) * W, (q.ny + world.panY) * H);
                ctx.stroke();
              }
            }
            ctx.globalAlpha = 1;
          }
          const specNet = Math.max(0, Math.min(1, world.lens - 1));
          if (specNet > 0.05) {
            // the stridulation spectrum: each body a bar at its own chirp pitch
            ctx.strokeStyle = "#cfd6ea";
            ctx.lineWidth = 1.2;
            for (const s of swarm) {
              if (s.presence < 0.5) continue;
              const f = (chirpMidi(s.seed) - 74) / 12;
              const bx = (0.1 + f * 0.8) * W;
              const h = (s.stage === IMAGO ? 18 : 7) * (0.6 + 0.4 * breath);
              ctx.globalAlpha = specNet * 0.4 * s.presence;
              ctx.beginPath();
              ctx.moveTo(bx, H * 0.9);
              ctx.lineTo(bx, H * 0.9 - h);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
        }
      }

      let live = 0;
      for (const s of swarm) if (s.presence > 0.5) live++;
      if (live !== lastAlive) {
        lastAlive = live;
        setAlive(live);
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
      overlay.removeEventListener("keydown", onKeyDown);
      mq.removeEventListener?.("change", onMq);
      writer.flush();
      layer?.dispose();
      quad?.dispose();
      stage?.dispose();
      apiRef.current = null;
    };
  }, []);

  const letGo = useCallback(() => apiRef.current?.letGo(), []);

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#0b0a14" }}>
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
      <canvas
        ref={overlayRef}
        role="application"
        tabIndex={0}
        aria-label="a dusk meadow-edge swarm — a lantern breathes low at the grass; rest a finger and a clutch of eggs is laid, hold and they hatch and take the wing, drag to draw a scent the swarm follows"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      />
      <LetGo label="let the swarm go" onLetGo={letGo} visible={alive > 0} />
    </div>
  );
}
