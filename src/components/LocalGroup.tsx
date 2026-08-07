"use client";

/**
 * /localgroup — a few galaxies that fall together forever.
 *
 * At ~10²¹ m the sky is galaxies: the Milky Way, Andromeda, and their dwarf
 * satellites, a small gravitationally-bound cluster wheeling about a common
 * barycenter. The material is the intergalactic medium — a deep violet-black
 * void threaded by the faint cosmic web — rendered as one fragment shader; the
 * population is galaxies, each a warm-gold bulge inside cool-blue arms inside a
 * faint magenta dark-matter halo, drawn as one instanced pass of a spiral-disc
 * sprite. Every law they obey lives in src/lib/localgroup.ts, pure and
 * node-tested; this file renders what those laws decide and says what each
 * verb of the grammar means in this material.
 *
 * A galaxy IS its mass, its spin, and its stellar age. CREATE — a dwell
 * condenses a new dwarf out of the medium, deepening tiers growing its mass and
 * halo. MODIFY — a drag kicks a galaxy's velocity and reshapes its orbit; the
 * twist-lens reads the group as starlight, then dark-matter mass, then the
 * velocity field's redshift; the three-finger season winds cosmic time toward
 * the group's future mergers or back. DESTROY — a flick flings a galaxy out of
 * the group, unbound, a tidal tail trailing; the ceremony hold forces two into
 * a starburst merger with mass conserved; <LetGo> lets the whole group go.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier, tapTrainDepth } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import { createGLStage, FULLSCREEN_VERT_CLIP } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  type QualityTier,
} from "@/lib/room-runtime";
import {
  bornGalaxy,
  computeBarycenter,
  condenseGalaxy,
  findMergePair,
  galaxyPitchMidi,
  galaxyRadius,
  growDwarf,
  haloRadius,
  hashSeed,
  isBound,
  kickGalaxy,
  loadGroup,
  mergeGalaxies,
  mulberry32,
  retireOldest,
  seedLocalGroup,
  serializeGroup,
  stepGroup,
  tidalPartner,
  GALAXY_CAP,
  type FieldInput,
  type Galaxy,
} from "@/lib/localgroup";

const STORAGE_KEY = "objetdart:localgroup:v1";
const ROOM_SEED = 0x10ca19;

// ——— the intergalactic medium: one fragment shader, the void and the web ———
const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float uTime;
uniform float uBreath;
uniform float u_epoch;
uniform float u_lens;
uniform float u_night;
uniform float u_reduced;
uniform vec2 u_bary;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), s.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), s.x), s.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + vec2(11.3, 7.1); a *= 0.55; }
  return v;
}
void main(){
  vec2 uv = vUv * 0.5 + 0.5;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime * (0.02 + u_epoch * 0.03) * (1.0 - 0.8 * u_reduced);

  // deep intergalactic black-violet, deepening toward the far edge
  vec3 col = mix(vec3(0.021, 0.024, 0.052), vec3(0.010, 0.008, 0.028), uv.y);

  // the cosmic web: faint filaments threading the void, breathing on the 7s clock
  float w = fbm(p * 2.4 + vec2(0.0, t));
  float fil = smoothstep(0.52, 0.96, w);
  vec3 webC = mix(vec3(0.10, 0.06, 0.20), vec3(0.17, 0.10, 0.30), u_epoch);
  col += webC * fil * (0.30 + 0.40 * uBreath);

  // a fine grain of distant unresolved galaxies
  float g = noise(p * 92.0);
  col += vec3(0.72, 0.76, 0.92) * pow(g, 24.0) * 0.5;

  // the barycenter: the well the whole group falls about, faintly lit + breathing
  vec2 bp = vec2(u_bary.x * aspect, u_bary.y);
  float bd = distance(p, bp);
  col += vec3(0.17, 0.10, 0.24) * exp(-bd * 3.4) * (0.35 + 0.55 * uBreath);

  // the lens tints the medium: dark-matter magenta at 1, redshift split at 2
  float wHalo = 1.0 - min(1.0, abs(u_lens - 1.0));
  float wRed = max(0.0, u_lens - 1.0);
  col += vec3(0.22, 0.05, 0.30) * fil * wHalo * 0.55;
  col += mix(vec3(0.02, 0.06, 0.26), vec3(0.26, 0.03, 0.03), uv.x) * wRed * 0.35;

  col *= 1.0 - 0.82 * u_night;
  gl_FragColor = vec4(col, 1.0);
}`;

// ——— the galaxy sprite: halo, arms, bulge — a whole disc per instance ———
// vHue carries stellar age (young-blue … old-red), vGlow the flare/excitation,
// vPhase the arm winding phase. Colours are intrinsic to the material.
const GALAXY_FRAG = `precision mediump float;
varying vec2 vLocal;
varying float vHue;
varying float vGlow;
varying float vPhase;
varying float vAlpha;
uniform vec3 u_palA;
uniform vec3 u_palB;
uniform vec3 u_palC;
void main(){
  float rr = length(vLocal) / 1.9;
  float ang = atan(vLocal.y, vLocal.x);
  float age = clamp(vHue, 0.0, 1.0);
  float flare = vGlow;

  // dark-matter halo — faint magenta, the largest and softest thing
  float halo = exp(-rr * rr * 3.2);
  vec3 haloC = vec3(0.60, 0.20, 0.72);

  // the disc's two-arm logarithmic spiral, wound by the disc's own turn
  float sp = cos(2.0 * ang - log(rr + 0.08) * 5.2 + vPhase * 6.2831);
  float arm = smoothstep(0.15, 1.0, sp);
  float disk = exp(-rr * rr * 6.0) * rr; // zero at centre, a bright ring, fading out
  float arms = arm * disk;
  vec3 young = vec3(0.52, 0.72, 1.0);  // cool blue, star-forming
  vec3 old = vec3(0.96, 0.66, 0.40);   // warm red, quiescent
  vec3 armC = mix(young, old, age);

  // the bulge — the warm-gold core, brighter in a starburst
  float core = exp(-rr * rr * 42.0);
  vec3 coreC = mix(vec3(1.0, 0.92, 0.72), vec3(1.0, 0.80, 0.52), age);

  vec3 col = haloC * halo * 0.26
           + armC * arms * (0.85 + flare * 0.9)
           + coreC * core * (1.1 + flare * 1.6);
  float a = clamp(halo * 0.20 + arms * 0.95 + core * 1.0, 0.0, 1.0) * vAlpha;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}`;

export default function LocalGroup() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const galaxiesRef = useRef<Galaxy[]>([]);
  const [standing, setStanding] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const overlayCanvas = overlayRef.current;
    if (!wrap || !canvas || !overlayCanvas) return;

    const audio = getFieldAudio();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;
    const onMq = () => {
      reduced = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    // ——— the standing group, from the laws in lib/localgroup ———
    let gals: Galaxy[] = [];
    let nextId = 1;
    let cleared = false;
    const writer = createIdleWriter(() => {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...serializeGroup(gals), cleared }),
        );
      } catch {
        /* quota / private mode — the group still wheels */
      }
    });
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        cleared = parsed?.cleared === true;
        gals = loadGroup(parsed, performance.now());
      }
    } catch {
      /* a fresh sky */
    }
    if (gals.length === 0 && !cleared) gals = seedLocalGroup(performance.now());
    for (const g of gals) nextId = Math.max(nextId, g.id + 1);
    galaxiesRef.current = gals;
    setStanding(gals.length);

    // ——— the world's own fields ———
    const world = {
      windX: 0,
      windY: 0,
      gravX: 0,
      gravY: 0,
      agitation: 0,
      epoch: 0.5, // the present; wound by the three-finger season
      lens: 0, // 0 starlight · 1 dark-matter halo · 2 redshift
      lensTarget: 0,
      timeScaleK: 1,
      night: 0,
      nightTarget: 0,
    };
    let heldIdx = -1;
    let heldFresh = false;
    let dragIdx = -1;
    let prevWinding = 0;
    let streamIdx = -1; // the satellite that streams a tidal tail at rest
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let lastAmbientSlot = -1;
    let dirty = false;

    const W = () => Math.max(1, wrap.clientWidth);
    const H = () => Math.max(1, wrap.clientHeight);
    const soft = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* audio or haptics unavailable — the group still wheels */
      }
    };

    const nearest = (nx: number, ny: number, reach: number): number => {
      let best = -1;
      let bestD = reach * reach;
      for (let i = 0; i < gals.length; i++) {
        const g = gals[i];
        if (g.presence < 0.6) continue;
        const dx = g.nx - nx;
        const dy = g.ny - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      return best;
    };

    const ringGalaxy = (i: number, strength: number) => {
      const g = gals[i];
      if (!g) return;
      g.flare = Math.min(1, g.flare + strength);
      soft(() => audio.playNote(galaxyPitchMidi(g.mass), 240 + 360 * strength));
    };

    const spawnAt = (nx: number, ny: number, tMs: number): number => {
      let live = 0;
      for (const g of gals) if (g.presence >= 1) live++;
      if (live >= GALAXY_CAP) {
        retireOldest(gals);
        soft(() => audio.buzz());
      }
      const g = condenseGalaxy(
        nextId,
        hashSeed(ROOM_SEED, nextId, Math.floor(nx * 997), Math.floor(ny * 997)),
        nx,
        ny,
        tMs,
      );
      nextId++;
      gals.push(g);
      return gals.length - 1;
    };

    // ——— the stage: one GL context, the field pass, the population, the overlay ———
    const embedded = isEmbeddedFrame();
    const stage = createGLStage(canvas, {
      wrap,
      label: "localgroup",
      reducedMotion: reduced,
      embedded,
      overlay: overlayCanvas,
    });
    const prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    const layer = stage
      ? createPopulationLayer(stage, {
          palette: ["#c14fd0", "#6f9be0", "#f3d488"],
          frag: GALAXY_FRAG,
        })
      : null;
    const buffer = createInstanceBuffer(128);

    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let hidden = false;
    let galleryPaused = false;
    let asleep = false;
    const syncSleep = () => {
      asleep = hidden || galleryPaused;
      if (asleep) gov.force("sleep");
    };
    const offVisibility = onVisibility((h) => {
      hidden = h;
      syncSleep();
    });
    const offGallery = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    const input: FieldInput = {
      windX: 0,
      windY: 0,
      gravX: 0,
      gravY: 0,
      agitation: 0,
      epoch: 0.5,
      timeScale: 1,
      reduced,
    };

    // ——— the grammar — mounted on the overlay, the topmost surface ———
    const detachGestures = attachGestures(
      overlayCanvas,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) return; // ScaleTravel owns the two-finger step back
          if (e.fingers === 3) {
            // tutti — every galaxy flares at once, the whole group answering
            for (const g of gals) if (g.presence >= 0.6) g.flare = Math.min(1, g.flare + 0.5);
            soft(() => audio.bell());
            soft(() => haptics.roll());
            return;
          }
          if (e.fingers !== 1) return;
          const nx = e.x / W();
          const ny = e.y / H();
          const trainTier = tapTrainTier(e.count);
          const depth = tapTrainDepth(e.count);
          if (trainTier === "n") {
            // structure formation: the whole group heats into a burst and the
            // giants are pulled toward the barycenter — deepening with the train
            const bc = computeBarycenter(gals);
            for (const g of gals) {
              if (g.presence < 0.6) continue;
              g.flare = Math.min(1, g.flare + 0.4 + depth * 0.3);
              g.vx += (bc.x - g.nx) * (0.06 + depth * 0.08);
              g.vy += (bc.y - g.ny) * (0.06 + depth * 0.08);
            }
            soft(() => audio.playTone(52, 2.4));
            soft(() => haptics.storm());
            return;
          }
          if (trainTier === 5) {
            // seed a converging merger: the two nearest galaxies inspiral
            if (e.count > 5) {
              const near = nearest(nx, ny, 0.2);
              if (near >= 0) ringGalaxy(near, 0.2 + depth * 0.3);
              return;
            }
            let a = -1;
            let b = -1;
            let bestD = Infinity;
            for (let i = 0; i < gals.length; i++) {
              if (gals[i].presence < 1) continue;
              for (let j = i + 1; j < gals.length; j++) {
                if (gals[j].presence < 1) continue;
                const d = Math.hypot(gals[i].nx - gals[j].nx, gals[i].ny - gals[j].ny);
                if (d < bestD) {
                  bestD = d;
                  a = i;
                  b = j;
                }
              }
            }
            if (a >= 0) {
              const A = gals[a];
              const B = gals[b];
              A.vx += (B.nx - A.nx) * 0.12;
              A.vy += (B.ny - A.ny) * 0.12;
              B.vx += (A.nx - B.nx) * 0.12;
              B.vy += (A.ny - B.ny) * 0.12;
              ringGalaxy(a, 0.5);
              ringGalaxy(b, 0.5);
              soft(() => haptics.detent());
            }
            return;
          }
          if (trainTier === 3) {
            // gather a small cluster: nudge the neighbours of the struck galaxy
            const i = nearest(nx, ny, 0.16);
            if (i >= 0) {
              ringGalaxy(i, 0.4 + depth * 0.3);
              const c = gals[i];
              for (let j = 0; j < gals.length; j++) {
                if (j === i || gals[j].presence < 0.6) continue;
                const d = Math.hypot(gals[j].nx - c.nx, gals[j].ny - c.ny);
                if (d < 0.3) {
                  gals[j].vx += (c.nx - gals[j].nx) * 0.05;
                  gals[j].vy += (c.ny - gals[j].ny) * 0.05;
                }
              }
              soft(() => haptics.detent());
            } else {
              soft(() => audio.playNote(58, 220));
              soft(() => haptics.tap());
            }
            return;
          }
          // one tap: ring the nearest galaxy; on the bare void a mote of light
          const i = nearest(nx, ny, 0.14);
          if (i >= 0) {
            ringGalaxy(i, 0.4 + e.intensity * 0.5);
            soft(() => haptics.tap());
          } else {
            soft(() => audio.playNote(72 + Math.round(e.intensity * 6), 150));
            soft(() => haptics.tap());
          }
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // dilation is a continuous axis: cosmic time slows the longer the
            // three fingers stay — never the same at 900ms as at 2400ms
            if (e.phase === "release") {
              world.timeScaleK = 1;
              return;
            }
            if (e.phase === "enter") {
              soft(() => audio.playNote(30, 460));
              soft(() => haptics.tap());
            }
            world.timeScaleK = Math.max(0.12, 1 - 0.85 * Math.min(1, e.elapsed / 2200));
            return;
          }
          if (e.fingers !== 1) return;
          const nx = e.x / W();
          const ny = e.y / H();
          if (e.phase === "enter") {
            heldIdx = nearest(nx, ny, 0.12);
            if (heldIdx >= 0) {
              heldFresh = false;
            } else if (e.tier >= 1) {
              // a dwell condenses a new dwarf out of the intergalactic medium
              heldIdx = spawnAt(nx, ny, performance.now());
              heldFresh = true;
              soft(() => audio.spark());
              soft(() => haptics.ripple(0.4));
            }
            return;
          }
          if (e.phase === "tick") {
            // the hold keeps deepening: a fresh dwarf grows its mass and halo
            const g = gals[heldIdx];
            if (g && heldFresh) {
              g.flare = Math.min(1, g.flare + 0.03);
              if (growDwarf(g, e.elapsed)) {
                soft(() => audio.playNote(galaxyPitchMidi(g.mass), 200));
                soft(() => haptics.tap());
              }
            }
            return;
          }
          if (e.phase === "release") {
            const g = gals[heldIdx];
            if (g && e.tier >= 3) {
              // the ceremony forces a merger: the held galaxy and its nearest
              // neighbour coalesce in a starburst, mass conserved
              let best = -1;
              let bestD = Infinity;
              for (let j = 0; j < gals.length; j++) {
                if (j === heldIdx || gals[j].presence < 1) continue;
                const d = Math.hypot(gals[j].nx - g.nx, gals[j].ny - g.ny);
                if (d < bestD) {
                  bestD = d;
                  best = j;
                }
              }
              if (best >= 0) {
                const child = mergeGalaxies(g, gals[best], nextId++, performance.now());
                const drop = new Set([heldIdx, best]);
                gals = gals.filter((_, k) => !drop.has(k));
                gals.push(child);
                galaxiesRef.current = gals;
                soft(() => audio.bell());
                soft(() => audio.playNote(galaxyPitchMidi(child.mass), 520));
                soft(() => haptics.bloom());
              } else {
                g.flare = 1;
                soft(() => audio.bell());
                soft(() => haptics.bloom());
              }
            } else if (g && heldFresh) {
              g.growth = 1;
              soft(() => audio.playNote(galaxyPitchMidi(g.mass), 360));
              soft(() => haptics.ripple(0.4));
            }
            heldIdx = -1;
            heldFresh = false;
            dirty = true;
            writer.schedule();
          }
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // the world-law: a bulk wind across the group (weather)
            world.windX = Math.max(-1, Math.min(1, world.windX + e.dx * 0.004));
            world.windY = Math.max(-1, Math.min(1, world.windY + e.dy * 0.004));
            return;
          }
          if (e.fingers !== 1) return;
          const nx = e.x / W();
          const ny = e.y / H();
          if (e.phase === "start") {
            dragIdx = nearest(nx, ny, 0.12);
            return;
          }
          if (e.phase === "end") {
            if (dragIdx >= 0) {
              // the release imparts the velocity the hand was carrying — a
              // kick that reshapes the orbit
              const g = gals[dragIdx];
              if (g) {
                g.vx = Math.max(-0.4, Math.min(0.4, (e.vx / W()) * 1.6));
                g.vy = Math.max(-0.4, Math.min(0.4, (e.vy / H()) * 1.6));
                dirty = true;
                writer.schedule();
              }
            }
            dragIdx = -1;
            return;
          }
          if (dragIdx >= 0 && gals[dragIdx]) {
            const g = gals[dragIdx];
            g.nx = nx;
            g.ny = ny;
            g.vx = (e.vx / W()) * 1.2;
            g.vy = (e.vy / H()) * 1.2;
          }
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers !== 1) return;
          const i = nearest(e.x / W(), e.y / H(), 0.16);
          if (i < 0) return;
          // a flick flings a galaxy out of the group — unbound, a tail trailing
          kickGalaxy(gals[i], e.angle, e.speed);
          streamIdx = i; // it streams a tidal tail as it goes
          soft(() => audio.playNote(galaxyPitchMidi(gals[i].mass) + 3, 180));
          soft(() => haptics.chop());
          dirty = true;
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // the three-finger season winds cosmic time forward or back
            const before = world.epoch;
            world.epoch = Math.max(0, Math.min(1, world.epoch + e.velocity * 0.02));
            if (Math.floor(before * 4) !== Math.floor(world.epoch * 4)) {
              soft(() => audio.playNote(34 + Math.round(world.epoch * 16), 320));
              soft(() => haptics.detent());
            }
            return;
          }
          // the lens cycles: starlight → dark-matter halo → redshift field
          if (e.phase === "move") {
            world.lensTarget = Math.max(0, Math.min(2, world.lensTarget + e.velocity * 0.02));
          } else if (e.phase === "end") {
            world.lensTarget = Math.round(world.lensTarget);
            soft(() => audio.chime());
            soft(() => haptics.lens());
          }
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          // frame-dragging: the circling hand swirls the group about its centre
          const bc = computeBarycenter(gals);
          const w = Math.max(-2, Math.min(2, e.angularVelocity)) * 0.02;
          for (const g of gals) {
            if (g.presence < 0.6) continue;
            const rx = g.nx - bc.x;
            const ry = g.ny - bc.y;
            g.vx += -ry * w;
            g.vy += rx * w;
          }
          const wAbs = Math.floor(Math.abs(e.winding));
          if (wAbs > prevWinding) {
            prevWinding = wAbs;
            soft(() => audio.playTone(120 * Math.pow(2, -Math.min(3, wAbs) * 0.3), 0.4));
            soft(() => haptics.ripple(0.3));
          }
          if (Math.abs(e.winding) < 0.2) prevWinding = 0;
        },
        rhythm: (e) => {
          if (e.stability < 0.7) return;
          // a steady beat entrains the group: a soft pulse through every disc
          for (const g of gals) if (g.presence >= 0.6) g.flare = Math.min(1, g.flare + 0.12);
          soft(() => audio.chime());
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel ———
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        world.gravX = reduced ? 0 : Math.max(-1, Math.min(1, gamma / 45));
        world.gravY = reduced ? 0 : Math.max(-1, Math.min(1, beta / 70));
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        world.agitation = Math.max(world.agitation, Math.min(1, intensity));
        soft(() => audio.buzz());
        soft(() => haptics.chop());
      },
      knock: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        // a knock on the case rings every disc and jostles the whole group
        for (const g of gals) {
          if (g.presence < 0.6) continue;
          const rng = mulberry32(hashSeed(g.seed, 0xbeef));
          g.vx += (rng() - 0.5) * 0.04 * intensity;
          g.vy += (rng() - 0.5) * 0.04 * intensity;
          g.flare = Math.min(1, g.flare + 0.4 * intensity);
        }
        soft(() => audio.thud());
        soft(() => haptics.detent());
      },
      flip: ({ faceDown }) => {
        world.nightTarget = faceDown ? 1 : 0;
        if (faceDown) soft(() => haptics.detent());
      },
    });

    // ——— keyboard: nothing here is touch-only ———
    const cursor = { nx: 0.5, ny: 0.5 };
    const onKeyDown = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      lastInteractionAt = performance.now();
      if (ev.key === "Escape") {
        world.lensTarget = 0;
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        if (!ev.repeat) {
          const idx = spawnAt(cursor.nx, cursor.ny, performance.now());
          gals[idx].growth = 1;
          soft(() => audio.spark());
          soft(() => haptics.ripple(0.4));
          writer.schedule();
        } else {
          const i = nearest(cursor.nx, cursor.ny, 0.14);
          if (i >= 0) ringGalaxy(i, 0.4);
        }
        return;
      }
      if (ev.key === "ArrowLeft") cursor.nx = Math.max(0.05, cursor.nx - 0.04);
      if (ev.key === "ArrowRight") cursor.nx = Math.min(0.95, cursor.nx + 0.04);
      if (ev.key === "ArrowUp") cursor.ny = Math.max(0.05, cursor.ny - 0.04);
      if (ev.key === "ArrowDown") cursor.ny = Math.min(0.95, cursor.ny + 0.04);
    };
    wrap.addEventListener("keydown", onKeyDown);

    // ——— the loop ———
    let raf = 0;
    let last = performance.now();
    let lastStanding = -1;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const tier: QualityTier = gov.beginFrame(t);
      if (asleep) {
        last = t;
        return;
      }
      const detail = detailForTier(tier);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const tSec = audio.getAudioTime() ?? t / 1000;
      const breath = reduced ? 0.5 : Math.sin(tSec * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // fields relax toward rest
      world.windX *= 0.985;
      world.windY *= 0.985;
      world.agitation *= 0.95;
      world.night += (world.nightTarget - world.night) * Math.min(1, dt * 3);
      world.lens += (world.lensTarget - world.lens) * Math.min(1, dt * 6);

      input.windX = world.windX;
      input.windY = world.windY;
      input.gravX = world.gravX;
      input.gravY = world.gravY;
      input.agitation = world.agitation;
      input.epoch = world.epoch;
      input.timeScale = world.timeScaleK;
      input.reduced = reduced;

      if (!reduced) stepGroup(gals, input, t, dt);

      // a merger the group composes on its own: two discs drawn together
      const pair = findMergePair(gals);
      if (pair) {
        const [ia, ib] = pair;
        const child = mergeGalaxies(gals[ia], gals[ib], nextId++, t);
        const drop = new Set([ia, ib]);
        gals = gals.filter((_, k) => !drop.has(k));
        gals.push(child);
        galaxiesRef.current = gals;
        if (heldIdx === ia || heldIdx === ib) heldIdx = -1;
        if (dragIdx === ia || dragIdx === ib) dragIdx = -1;
        streamIdx = -1;
        soft(() => audio.chime());
        soft(() => audio.playNote(galaxyPitchMidi(child.mass), 480));
        soft(() => haptics.bloom());
        dirty = true;
      }

      // the ambient supernova: the vacuum lights one disc every few breaths
      const slot = Math.floor(t / 4200);
      if (slot !== lastAmbientSlot && !reduced && gals.length > 0) {
        lastAmbientSlot = slot;
        const rng = mulberry32(hashSeed(ROOM_SEED, slot));
        if (rng() < 0.7) {
          const g = gals[Math.floor(rng() * gals.length)];
          if (g) g.flare = Math.min(1, g.flare + 0.35);
        }
      }

      // retire the spent
      for (let i = gals.length - 1; i >= 0; i--) {
        if (gals[i].presence <= 0) {
          gals.splice(i, 1);
          if (heldIdx === i) heldIdx = -1;
          else if (heldIdx > i) heldIdx--;
          if (dragIdx === i) dragIdx = -1;
          else if (dragIdx > i) dragIdx--;
          if (streamIdx === i) streamIdx = -1;
          else if (streamIdx > i) streamIdx--;
          dirty = true;
        }
      }

      // the satellite that streams at rest: the strongest tidal victim
      if (streamIdx < 0 || !gals[streamIdx] || gals[streamIdx].presence < 0.6) {
        streamIdx = -1;
        let strongest = 0;
        for (let i = 0; i < gals.length; i++) {
          if (gals[i].presence < 1) continue;
          const p = tidalPartner(gals, i);
          if (p.j >= 0 && p.stretch > strongest) {
            strongest = p.stretch;
            streamIdx = i;
          }
        }
      }

      const bc = computeBarycenter(gals);

      // ——— pass 1: the intergalactic medium ———
      if (stage && prog) {
        const size = stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: world.agitation, reducedMotion: reduced }),
          prog,
        );
        prog.setFloat("u_epoch", world.epoch);
        prog.setFloat("u_lens", world.lens);
        prog.setFloat("u_night", world.night);
        prog.setFloat("u_reduced", reduced ? 1 : 0);
        prog.setVec2("u_bary", bc.x, 1 - bc.y);
        quad?.draw();

        // ——— pass 2: the galaxies, one instanced disc apiece ———
        buffer.reset();
        const m = Math.min(size.width, size.height);
        const haloBoost = 1 + Math.max(0, Math.min(1, world.lens)) * 0.4; // the halo lens swells them
        for (const g of gals) {
          const px = g.nx * size.width;
          const py = g.ny * size.height;
          const orient = (g.seed % 628) / 100; // a fixed disc orientation from the seed
          const spinPhase =
            (tSec * (0.02 + 0.03 * Math.abs(g.spin)) * (g.spin < 0 ? -1 : 1) + g.seed * 0.001) % 1;
          const r = haloRadius(g.mass) * m * (0.9 + 0.15 * breath) * haloBoost * detail.particles;
          buffer.push(
            px,
            py,
            r * (0.35 + 0.65 * g.growth),
            orient,
            g.age,
            0.25 + g.flare * 0.75 + breath * 0.1,
            (spinPhase + 1) % 1,
            g.presence,
          );
        }
        layer?.draw(buffer);

        // ——— pass 3: the thin overlay — tidal streams, halos, the lens's notation ———
        const ctx = stage.overlay2d;
        if (ctx) {
          ctx.clearRect(0, 0, size.width, size.height);
          const dim = 1 - world.night * 0.75;

          // the tidal stream trailing the streaming satellite (and any unbound one)
          const drawStream = (g: Galaxy) => {
            const partner = tidalPartner(gals, gals.indexOf(g));
            let tx = -g.vx;
            let ty = -g.vy;
            if (partner.j >= 0) {
              // the tail bends toward the giant it is falling past
              tx += (gals[partner.j].nx - g.nx) * 0.4;
              ty += (gals[partner.j].ny - g.ny) * 0.4;
            }
            const tl = Math.hypot(tx, ty) || 1;
            tx /= tl;
            ty /= tl;
            const seedR = mulberry32(g.seed ^ 0x57ea3);
            const reach = galaxyRadius(g.mass) * m * 3.2;
            const points = Math.round(14 * detail.particles);
            for (let k = 1; k <= points; k++) {
              const u = k / points;
              const curl = (seedR() - 0.5) * 0.4;
              const sx = g.nx * size.width + (tx + -ty * curl) * reach * u;
              const sy = g.ny * size.height + (ty + tx * curl) * reach * u;
              ctx.globalAlpha = (1 - u) * 0.4 * dim * g.presence;
              ctx.fillStyle = g.age < 0.5 ? "rgba(150,190,240,1)" : "rgba(220,150,120,1)";
              ctx.beginPath();
              ctx.arc(sx, sy, 1.4 * (1 - u * 0.5), 0, Math.PI * 2);
              ctx.fill();
            }
          };
          if (streamIdx >= 0 && gals[streamIdx]) drawStream(gals[streamIdx]);
          for (const g of gals) if (g.presence < 1) drawStream(g);

          // the barycenter — a faint cross, the still centre of the fall
          ctx.globalAlpha = 0.28 * dim;
          ctx.strokeStyle = "rgba(198,150,220,1)";
          ctx.lineWidth = 1;
          const bx = bc.x * size.width;
          const by = bc.y * size.height;
          ctx.beginPath();
          ctx.moveTo(bx - 8, by);
          ctx.lineTo(bx + 8, by);
          ctx.moveTo(bx, by - 8);
          ctx.lineTo(bx, by + 8);
          ctx.stroke();

          // the dark-matter lens: the halos drawn as circles
          if (world.lens > 0.5 && world.lens < 1.5) {
            const la = 1 - Math.abs(world.lens - 1);
            ctx.strokeStyle = "rgba(193,79,208,1)";
            for (const g of gals) {
              if (g.presence < 0.6) continue;
              ctx.globalAlpha = 0.4 * la * dim * g.presence;
              ctx.beginPath();
              ctx.arc(g.nx * size.width, g.ny * size.height, haloRadius(g.mass) * m, 0, Math.PI * 2);
              ctx.stroke();
            }
          }

          // the redshift lens: each galaxy's velocity relative to the barycenter,
          // drawn as a coloured arrow — receding red, approaching blue
          if (world.lens > 1.5) {
            const la = Math.min(1, world.lens - 1.5) * 2;
            ctx.lineWidth = 1.4;
            for (const g of gals) {
              if (g.presence < 0.6) continue;
              const rvx = g.vx - bc.vx;
              const rvy = g.vy - bc.vy;
              const los = (g.nx - bc.x) * rvx + (g.ny - bc.y) * rvy; // radial velocity sign
              const gx = g.nx * size.width;
              const gy = g.ny * size.height;
              ctx.globalAlpha = 0.6 * la * dim * g.presence;
              ctx.strokeStyle = los > 0 ? "rgba(230,90,90,1)" : "rgba(110,150,240,1)";
              ctx.beginPath();
              ctx.moveTo(gx, gy);
              ctx.lineTo(gx + rvx * size.width * 4, gy + rvy * size.height * 4);
              ctx.stroke();
            }
          }
          ctx.globalAlpha = 1;
        }
      }

      if (dirty && t - lastInteractionAt > 400) {
        dirty = false;
        writer.schedule();
      }

      // the ≥20s glimmer: a supernova twinkle in one galaxy
      if (t - lastInteractionAt > 20000 && t - glimmerAt > 6000 && !reduced && gals.length > 0) {
        glimmerAt = t;
        const rng = mulberry32(hashSeed(ROOM_SEED, Math.floor(t / 6000)));
        const g = gals[Math.floor(rng() * gals.length)];
        if (g) {
          g.flare = Math.min(1, g.flare + 0.6);
          soft(() => audio.playNote(galaxyPitchMidi(g.mass), 260));
        }
      }

      let live = 0;
      for (const g of gals) if (g.presence >= 1) live++;
      if (live !== lastStanding) {
        lastStanding = live;
        setStanding(live);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      detachGestures();
      detachVessel();
      offVisibility();
      offGallery();
      wrap.removeEventListener("keydown", onKeyDown);
      mq.removeEventListener?.("change", onMq);
      writer.flush();
      layer?.dispose();
      quad?.dispose();
      stage?.dispose();
    };
  }, []);

  // ——— the quiet clear: the group is let go, and an emptied sky stays empty ———
  const letGo = () => {
    for (const g of galaxiesRef.current) g.presence = Math.min(g.presence, 0.95);
    galaxiesRef.current = [];
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, galaxies: [], cleared: true }));
    } catch {
      /* noop */
    }
    setStanding(0);
    try {
      getFieldAudio().thud();
      haptics.roll();
    } catch {
      /* noop */
    }
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="the local group — a few galaxies wheeling about a common barycenter; rest a finger and a dwarf galaxy condenses from the dark, drag one to reshape its orbit, hold two together to force a starburst merger"
      style={{ position: "fixed", inset: 0, background: "#05060d", outline: "none", touchAction: "none" }}
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
      <LetGo label="let the group go" onLetGo={letGo} visible={standing > 0} />
    </div>
  );
}
