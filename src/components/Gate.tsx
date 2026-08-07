"use client";

/**
 * /gate — the channel that answers the sample.
 *
 * A diagrammatic cross-section of the NMDA-type ionotropic glutamate
 * receptor's ion channel, with the same substance /observe circles around
 * (o-chlorophenyl cyclohexanone family — imported from lib/observe, never
 * duplicated) sitting in the transmembrane vestibule above the gate. Four
 * subunit helices arrange themselves in a fourfold-ish assembly across the
 * frame: two GluN1 (light grey) and two GluN2 (green for 2A, blue for 2B,
 * toggleable). The pore descends from the vestibule (top) through the gate
 * (middle constriction) to the selectivity filter (below).
 *
 * The room YIELDS the frame — it is one scene at one altitude, no zoom
 * sweep. Pinch reaches ScaleTravel and presses the /drop band walls
 * normally. The shell owns the vessel bus, the glimmer clock, the quiet
 * clear.
 *
 * Every physics law lives in @/lib/gate.ts; the substance's geometry is
 * imported from @/lib/observe (bornMolecule3D + Atom3D + Bond3D — the same
 * ball-and-stick model). This file is the rendering and the gesture wiring.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { tapTrainTier } from "@/lib/gesture/core";
import { createGLStage, FULLSCREEN_VERT_UNIT } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
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
  createPopulation,
  hashSeed as sceneHashSeed,
  mulberry32 as sceneMulberry32,
  type SceneObjectSpec,
  type SceneObjectState,
} from "@/lib/scene/object";
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
import {
  GATE_STORAGE_KEY,
  GATE_Z,
  ION_CAP,
  REST_ABOVE_Z,
  SELECTIVITY_Z,
  SUBUNIT_TINT,
  VESTIBULE_Z,
  bindSubstance,
  helixHalfWidth,
  initialChannelState,
  ionColumnSample,
  loadChannel,
  seasonTarget,
  serializeChannel,
  stepChannel,
  toggleSubunit,
  unbindSubstance,
  type ChannelState,
  type SubunitId,
} from "@/lib/gate";
// The substance itself: imported from /observe. The room does not copy
// the molecule — it holds the same one, in a different situation.
import { bornMolecule3D, type Atom3D, type Bond3D, type MoleculeState } from "@/lib/observe";

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

// ——— rendering: the pore's background material ————————————————————————
//
// A thin shader. Two dark bands frame the transmembrane region; the vestibule
// and the selectivity filter widen out of the pore. The four helices' taper
// (helixHalfWidth) is echoed in the shader so the pore's shape reads
// continuously; the four coloured ribbons themselves and the substance are
// drawn on the 2D overlay for clarity.
const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float uBreath;
uniform float uReduced;

uniform float uGateOpenness;    // 0..1 — the door
uniform float uIonFlow;         // 0..1 — how strong the ion current is
uniform float uNight;           // 0..1 — face-down darkens everything but the substance
uniform float uMembrane;        // 0..1 — shake rides this, membrane vibrates
uniform vec3  uTintA;           // GluN2 tint (green for 2A, blue for 2B)
uniform vec3  uTintB;           // second GluN2 tint — the twist eases between

varying vec2 vUv;

// The gate's plane in normalized-y. The overlay draws helices around this y.
const float GATE_Y = 0.55;

// The pore's centerline is x = 0.5. The half-width tapers to a pinch at
// GATE_Y; away from it the pore opens for the vestibule / filter.
float poreHalfWidth(float y, float openness) {
  float dy = y - GATE_Y;
  float pinch = exp(-dy * dy * 42.0);
  // Base pore width (0..1 units of frame width)
  float base = 0.16;
  // Pinch narrows the base; openness pulls the pinch back toward the base.
  return base * (1.0 - 0.7 * pinch * (1.0 - openness));
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);

  // ——— the membrane bands ————————————————————————————————————————
  // Two thick horizontal bands framing the transmembrane region. Slight
  // gradient so extracellular reads lighter than intracellular. No literal
  // phospholipid drawing — evocative, not diagrammatic.
  vec3 col = vec3(0.02, 0.03, 0.06); // outside the membrane, dark cabinet
  float above = smoothstep(0.24, 0.22, uv.y);
  float below = smoothstep(0.76, 0.78, uv.y);
  // Extracellular tint (above the membrane): faintly warm.
  vec3 extraCol = vec3(0.05, 0.07, 0.11);
  // Intracellular tint: cooler, deeper.
  vec3 intraCol = vec3(0.03, 0.04, 0.08);
  col = mix(col, extraCol, above);
  col = mix(col, intraCol, below);

  // A very subtle membrane band on either side — a lit rim so the geometry
  // is legible without literal phospholipids.
  float bandTop = smoothstep(0.26, 0.24, uv.y) - smoothstep(0.24, 0.22, uv.y);
  float bandBot = smoothstep(0.78, 0.76, uv.y) - smoothstep(0.76, 0.74, uv.y);
  col += vec3(0.10, 0.10, 0.13) * (bandTop + bandBot) * (0.6 + 0.4 * uBreath);

  // ——— the pore ————————————————————————————————————————
  // A dark channel running from top to bottom through the constriction. Its
  // half-width follows poreHalfWidth(uv.y, uGateOpenness). Inside the pore,
  // draw a subtle vertical gradient so ion flow reads as a lit column when
  // the flow is high.
  float halfW = poreHalfWidth(uv.y, uGateOpenness);
  float distX = abs(uv.x - 0.5);
  float insidePore = smoothstep(halfW + 0.005, halfW - 0.005, distX);

  // Pore darkness: the channel is a shadow the helices ring.
  col = mix(col, vec3(0.01, 0.02, 0.05), insidePore * 0.9);

  // Ion current lit column: only visible when uIonFlow rises. A soft
  // vertical stripe brightens the pore's interior above the gate.
  if (uIonFlow > 0.02) {
    float lit = insidePore * smoothstep(0.20, GATE_Y - 0.02, uv.y);
    col += vec3(0.35, 0.55, 0.85) * uIonFlow * lit * 0.28 * (0.6 + 0.4 * uBreath);
  }

  // ——— the ion accumulation above the gate ——————————————————————
  // When flow is BLOCKED (uIonFlow low, but not because gate is closed on
  // its own) ions pile up above the gate — a soft brightening the visitor
  // reads as "held back". A hair above the gate plane.
  float acc = smoothstep(0.24, GATE_Y - 0.02, uv.y) * (1.0 - uIonFlow);
  col += vec3(0.28, 0.42, 0.70) * insidePore * acc * 0.16 * (0.6 + 0.4 * uBreath);

  // ——— the vestibule glow ————————————————————————————————
  // Above the gate, a soft inverted-cone glow suggests the vestibule.
  float vestY = smoothstep(0.44, 0.30, uv.y); // above gate
  float vestX = 1.0 - smoothstep(halfW * 0.5, halfW * 2.0, distX);
  col += vec3(0.14, 0.18, 0.26) * vestY * vestX * 0.4;

  // ——— membrane vibration ————————————————————————
  // A shake ripples the membrane bands horizontally.
  if (uMembrane > 0.02 && uReduced < 0.5) {
    float sh = sin(uv.x * 40.0 + uTime * 30.0) * uMembrane * 0.02;
    col += vec3(0.15, 0.10, 0.06) * (bandTop + bandBot) * abs(sh) * 5.0;
  }

  // ——— GluN2 subunit hue leak (very faint tint into the vestibule) ————
  // The two GluN2 helices sit at outer positions; a soft coloured haze
  // seeps toward the vestibule from either side. The mix between uTintA and
  // uTintB is driven by the visitor's twist through a smoothed parameter
  // outside this shader.
  vec3 subunitTint = mix(uTintA, uTintB, 0.5);
  float subunitHalo = smoothstep(0.10, 0.42, distX) * vestY;
  col += subunitTint * subunitHalo * 0.12 * (0.5 + 0.5 * uBreath);

  // Night register: face-down darkens the whole membrane but keeps a hint
  // of the pore lit — a portrait of the substance in the vestibule.
  col *= mix(1.0, 0.30, uNight);

  // Vignette
  vec2 vd = (uv - vec2(0.5)) * vec2(aspect, 1.0);
  col *= 1.0 - 0.24 * smoothstep(0.20, 0.90, dot(vd, vd));

  gl_FragColor = vec4(col, 1.0);
}
`;

// ——— molecule projection — a shared orthographic pass ————————————————

type ProjectedAtom = { el: string; x: number; y: number; z: number; r: number };
type ProjectedBond = { ax: number; ay: number; bx: number; by: number; order: 1 | 2 | 3 };

const ATOM_RADIUS = { C: 8, O: 9, N: 8.5, H: 5, Cl: 10 } as const;
const ATOM_COLOR = {
  C: "rgba(230, 220, 210, 1)",
  O: "rgba(240, 120, 90, 1)",
  N: "rgba(120, 150, 240, 1)",
  H: "rgba(240, 240, 240, 1)",
  Cl: "rgba(150, 220, 130, 1)",
} as const;

function rotateAtom(a: { x: number; y: number; z: number }, rx: number, ry: number) {
  const y1 = a.y * Math.cos(rx) - a.z * Math.sin(rx);
  let z1 = a.y * Math.sin(rx) + a.z * Math.cos(rx);
  const x2 = a.x * Math.cos(ry) + z1 * Math.sin(ry);
  z1 = -a.x * Math.sin(ry) + z1 * Math.cos(ry);
  return { x: x2, y: y1, z: z1 };
}

/**
 * Project the molecule at (cx, cy) with scale s. Atoms/bonds project
 * orthographically — the small size makes perspective overkill.
 */
function projectMolecule(state: MoleculeState, cx: number, cy: number, s: number): {
  atoms: ProjectedAtom[];
  bonds: ProjectedBond[];
} {
  const [rx, ry] = state.rotation;
  const atoms: ProjectedAtom[] = state.atoms.map((a: Atom3D) => {
    const p = rotateAtom(a, rx, ry);
    return {
      el: a.el,
      x: cx + p.x * s,
      y: cy + p.y * s,
      z: p.z,
      r: ATOM_RADIUS[a.el as keyof typeof ATOM_RADIUS] ?? 7,
    };
  });
  const bonds: ProjectedBond[] = state.bonds.map((b: Bond3D) => ({
    ax: atoms[b.a].x,
    ay: atoms[b.a].y,
    bx: atoms[b.b].x,
    by: atoms[b.b].y,
    order: b.order,
  }));
  return { atoms, bonds };
}

// ——— ion view — one Float32-instance per drop ———————————————————————

type IonView = SceneObjectState & {
  z: number; // z-coordinate in the pore column (positive above the gate)
  phase: number; // seeded ms offset so ions ripple at different phases
};

/**
 * The engine's private positional API — the RoomVoice memo forwards event
 * shapes into these calls, so the engine never loses an in-flight hold when
 * React re-renders. Same shape /pebble uses (see PebbleApi).
 */
type GateApi = {
  tap: (x: number, y: number, intensity: number, count: number, fingers: number) => void;
  stepBack: () => void;
  tutti: (intensity: number) => void;
  plant: (x: number, y: number) => void;
  deepen: (elapsed: number, x: number, y: number, tier: number) => void;
  ceremony: (x: number, y: number) => void;
  settle: (elapsed: number, x: number, y: number, tier: number) => void;
  timeScale: (k: number) => void;
  drag: (phase: "start" | "move" | "end", x: number, y: number, dx: number, dy: number, fingers: number) => void;
  wind: (dx: number, dy: number) => void;
  flick: (x: number, y: number, angle: number, speed: number, fingers: number) => void;
  stir: (cx: number, cy: number, angularVelocity: number) => void;
  sustain: (
    phase: "enter" | "tick" | "release",
    spread: number,
    cx: number,
    cy: number,
  ) => void;
  lens: (angle: number, velocity: number) => void;
  season: (angle: number, velocity: number) => void;
  scatter: (intensity: number) => void;
  gravity: (gamma: number) => void;
  knock: (intensity: number) => void;
  night: (faceDown: boolean) => void;
  breath: (strength: number) => void;
  glimmer: () => void;
  reduced: (on: boolean) => void;
  moveCursor: (dx: number, dy: number) => void;
  keyTap: () => void;
  keyHold: (elapsed: number) => void;
  keyEscape: () => void;
  clear: () => void;
};

// GATE plane in normalized-y — matches the shader's GATE_Y.
const GATE_Y_NORM = 0.55;

/**
 * Map a channel z (VESTIBULE_Z / GATE_Z / SELECTIVITY_Z / REST_ABOVE_Z) into
 * a normalized y coordinate on the frame (0 = top, 1 = bottom). Positive
 * channel z is above the gate → lower y on screen.
 */
function channelZToY(z: number): number {
  // GATE_Z (0)     → GATE_Y_NORM (0.55)
  // VESTIBULE_Z    → ~0.38 (above the gate)
  // SELECTIVITY_Z  → ~0.72 (below the gate)
  // REST_ABOVE_Z   → ~0.17 (well above the membrane)
  return clamp(GATE_Y_NORM - z * 0.5, 0.05, 0.95);
}

function yToChannelZ(y: number): number {
  return (GATE_Y_NORM - y) / 0.5;
}

export default function Gate() {
  const surfaceRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<GateApi | null>(null);
  const [standing, setStanding] = useState(0);

  useEffect(() => {
    const surface = surfaceRef.current;
    const overlay = overlayRef.current;
    if (!surface || !overlay) return;

    const audio = getFieldAudio();
    try { audio.setAmbientProfile?.("light"); } catch { /* noop */ }
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");

    // ——— the small state vector ————————————————————————————————————
    const SEED = 0x9a7e01;
    // The channel — subunit, openness, binding state, ion flow. All laws
    // live in stepChannel/lib/gate.
    let channel: ChannelState = initialChannelState("2A");
    // Load the kept sigil if present.
    try {
      const raw = window.localStorage.getItem(GATE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        channel = loadChannel(parsed);
      }
    } catch {
      /* fresh channel */
    }

    // The substance — imported from /observe. Every instance uses the SAME
    // model geometry (bornMolecule3D); the state carries orientation so a
    // drag / flick can spin it in place. Held in an array so a dwell can
    // spawn additional molecules above the pore, though only the vestibule
    // one ever binds.
    type Substance = {
      id: number;
      seed: number;
      model: MoleculeState;
      // normalized-x within the extracellular space
      nx: number;
      // channel z (positive above gate, negative below)
      z: number;
      // 0..1 whether this substance is the one bound in the vestibule
      bound: boolean;
      born: number;
    };
    const substances: Substance[] = [];
    let nextId = 1;
    // Initial substance: near the top of the extracellular space.
    substances.push({
      id: nextId++,
      seed: sceneHashSeed(SEED, 1),
      model: bornMolecule3D(),
      nx: 0.5,
      z: channel.substanceBound ? VESTIBULE_Z : REST_ABOVE_Z,
      bound: channel.substanceBound,
      born: performance.now(),
    });

    // ——— live axes the shader/overlay ease over ———
    let spanHoldingOpen = false;
    let spanSpread = 0;
    let membraneVibe = 0;
    let membraneVibeTarget = 0;
    let night = 0;
    let nightTarget = 0;
    let tintMix = channel.subunit === "2A" ? 0 : 1;
    let tintMixTarget = tintMix;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let breathAmp = 0.5;
    let breathAmpTarget = 0.5;
    let cursorNx = 0.5;
    let cursorNy = 0.35;
    let lastGestureAt = performance.now();
    let lastGlimmerAt = 0;
    // Drag state: which substance is being held.
    let draggingId = -1;
    // Season phase 0..1 for the twist3 walk through the pore.
    let seasonU = channel.substanceBound ? 0 : 1;
    let seasonUTarget = seasonU;
    // A one-shot "flex" scalar for tutti / knock — the whole channel pulses.
    let flex = 0;
    // Ion accumulator: a phase clock that fires clean pulses down the pore
    // when the gate is open and unbound.
    let ionSpawnAcc = 0;

    // ——— visibility / gallery pause ———
    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    const syncSleep = () => {
      asleep = hidden || galleryPaused;
      if (asleep) gov.force("sleep");
    };
    const unvis = onVisibility((h) => { hidden = h; syncSleep(); });
    const ungal = onGalleryPause((p) => { galleryPaused = p; syncSleep(); });

    // ——— persistence: the kept sigil is the channel state ———
    const writer = createIdleWriter(() => {
      try {
        const payload = serializeChannel(channel);
        window.localStorage.setItem(GATE_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* quota */
      }
    });

    // ——— the ion population — one shared model, one instanced draw ———
    const ionSpec: SceneObjectSpec<IonView> = {
      kind: "ion",
      cap: ION_CAP,
      born(seed, nx, _ny, tMs) {
        return {
          id: 0,
          seed,
          nx,
          ny: 0.2,
          bornMs: tMs,
          growth: 1,
          sealedMs: null,
          presence: 1,
          z: REST_ABOVE_Z,
          phase: (seed & 0xffff) / 0xffff,
        };
      },
      step(_s, _ctx) {
        /* the ion field is authoritative — steps happen in the RAF loop below */
      },
      emit(s, ctx, out) {
        const y = channelZToY(s.z) * ctx.height;
        // Small jitter around the pore centerline, driven by ionColumnSample.
        const sample = ionColumnSample(s.z, ctx.tMs / 1000 + s.phase, s.seed);
        const x = (0.5 + sample.x) * ctx.width;
        // Radius scales with detail; alpha follows the sample AND the room's
        // ion flow so a blocked pore's specks pile up but stay dim.
        const r = 2.4 + 1.6 * ctx.detail;
        const glow = 0.5 * sample.alpha;
        // Hue: a cool grey — no attempt to label Ca/Na/K
        const hue = 0.5;
        const alpha = s.presence * (0.25 + 0.55 * sample.alpha);
        out.push(x, y, r, s.seed * 0.001, hue, glow, s.phase, alpha);
      },
      verbs: [],
      respond: {},
    };
    const population = createPopulation(ionSpec);
    // Seed a small ion column so the room shows life at first paint.
    {
      const rng = sceneMulberry32(SEED);
      for (let i = 0; i < 40; i++) {
        const z = REST_ABOVE_Z - rng() * 1.5;
        const s = population.spawn(0.5 + (rng() - 0.5) * 0.06, 0, performance.now());
        s.z = z;
        s.phase = rng();
      }
    }

    // ——— the shared GL harness ———
    const stage = createGLStage(surface, {
      label: "gate",
      wrap: surface.parentElement,
      overlay,
      renderScale: embedded ? 0.42 : 0.6,
      quality: embedded ? "medium" : "high",
      reducedMotion: reduced,
      embedded,
    });
    const prog = stage?.program(FULLSCREEN_VERT_UNIT, FRAG) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog, "unit") : null;
    const populationLayer = stage
      ? createPopulationLayer(stage, {
          palette: ["#8ea6c8", "#c8dcf0", "#f0f4fb"],
        })
      : null;
    const instanceBuffer = createInstanceBuffer(ION_CAP);

    // ——— helpers ———
    const toLocal = (px: number, py: number) => {
      const r = surface.getBoundingClientRect();
      return {
        nx: clamp01((px - r.left) / Math.max(1, r.width)),
        ny: clamp01((py - r.top) / Math.max(1, r.height)),
      };
    };
    const nearestSubstance = (nx: number, ny: number): Substance | null => {
      let best: Substance | null = null;
      let bestD = 0.18;
      for (const s of substances) {
        const dx = s.nx - nx;
        const dy = channelZToY(s.z) - ny;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = s; }
      }
      return best;
    };
    const helixHit = (nx: number, ny: number): number | -1 => {
      // Return the helix index (0..3) the tap lands nearest, or -1.
      // Helices sit at x = 0.5 + [-0.28, -0.09, 0.09, 0.28] * pore span.
      const halfW = helixHalfWidth(yToChannelZ(ny), channel.gateOpenness);
      const xs = [0.5 - 0.28 * halfW * 1.6, 0.5 - 0.09 * halfW * 1.6, 0.5 + 0.09 * halfW * 1.6, 0.5 + 0.28 * halfW * 1.6];
      let best = -1;
      let bestD = 0.06;
      for (let i = 0; i < 4; i++) {
        const d = Math.abs(nx - xs[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      // must be inside the membrane vertically
      if (ny < 0.24 || ny > 0.78) return -1;
      return best;
    };

    // ——— the engine's verbs, in this room's material ———
    const engine: GateApi = {
      tap: (x, y, intensity, count, fingers) => {
        if (fingers >= 2) return; // stepBack / tutti handled elsewhere
        const { nx, ny } = toLocal(x, y);
        cursorNx = nx; cursorNy = ny;
        lastGestureAt = performance.now();
        // Priority: substance under the finger?
        const sub = nearestSubstance(nx, ny);
        if (sub) {
          // wiggle it in place — a deterministic small kick derived from the
          // tap's position and tap-train count, so a replay of the same taps
          // yields the same wiggle (test-room-liveness §5).
          const jitter = ((count * 13 + Math.floor(nx * 97)) % 7) / 20;
          sub.model = {
            ...sub.model,
            rotation: [
              sub.model.rotation[0] + jitter * 0.2 * intensity,
              sub.model.rotation[1] + (nx - 0.5) * 0.6 * intensity,
              sub.model.rotation[2],
            ],
          };
          try { haptics.ripple(0.3 + intensity * 0.4); } catch { /* noop */ }
          try { audio.playNote?.(60 + Math.round(intensity * 8), 140); } catch { /* noop */ }
          return;
        }
        // Helix / wall tap: a soft glow up the LBD.
        const helix = helixHit(nx, ny);
        if (helix >= 0) {
          // Ripple up the helix — the visible answer is a glow spike we drive
          // from an overlay pass; the value we set here is a helix-index flag.
          helixGlowIdx = helix;
          helixGlowAt = performance.now();
          try { haptics.ripple(0.3 + intensity * 0.3); } catch { /* noop */ }
          try { audio.playNote?.(72 + helix * 3, 160); } catch { /* noop */ }
          return;
        }
        // The tap-train ladder, always climbed. 1/3/5/n — see AGENTS.md.
        const tier = tapTrainTier(count);
        if (tier === "n") {
          // A wave of pulses down the pore column and a bright flex.
          flex = Math.min(1.5, flex + 0.6 + intensity * 0.3);
          try { haptics.storm(); } catch { /* noop */ }
          try { audio.bell?.(); } catch { /* noop */ }
          spawnIonPulse(6);
          return;
        }
        if (tier === 5) {
          flex = Math.min(1.2, flex + 0.5);
          try { haptics.chop(); } catch { /* noop */ }
          try { audio.playNote?.(48, 220); } catch { /* noop */ }
          spawnIonPulse(3);
          return;
        }
        if (tier === 3) {
          flex = Math.min(1.0, flex + 0.35);
          try { haptics.roll(); } catch { /* noop */ }
          try { audio.playNote?.(56, 180); } catch { /* noop */ }
          spawnIonPulse(2);
          return;
        }
        // A bare tap on empty extracellular space: a soft ping.
        try { haptics.tap(); } catch { /* noop */ }
        try { audio.playNote?.(60, 120); } catch { /* noop */ }
      },
      stepBack: () => {
        // The room YIELDS the frame — ScaleTravel binds two-finger tap. This
        // handler exists so the shell's default doesn't have to speak for it;
        // the framework routes the actual step-back through ScaleTravel.
      },
      tutti: (intensity) => {
        lastGestureAt = performance.now();
        flex = Math.min(1.5, flex + 0.7 + intensity * 0.3);
        spawnIonPulse(8);
        try { haptics.roll(); } catch { /* noop */ }
        try { audio.bell?.(); } catch { /* noop */ }
      },
      plant: (x, y) => {
        const { nx, ny } = toLocal(x, y);
        cursorNx = nx; cursorNy = ny;
        lastGestureAt = performance.now();
        // Spawn a fresh molecule in the extracellular space above the pore.
        const z = yToChannelZ(ny);
        const s: Substance = {
          id: nextId++,
          seed: sceneHashSeed(SEED, nextId),
          model: bornMolecule3D(),
          nx,
          z: Math.max(REST_ABOVE_Z * 0.5, z),
          bound: false,
          born: performance.now(),
        };
        substances.push(s);
        // Cap: keep the two most recent, so a hand can't build an infinite pile.
        while (substances.length > 4) substances.shift();
        setStanding(substances.length);
        try { haptics.tap(); } catch { /* noop */ }
        try { audio.spark?.(); } catch { /* noop */ }
        writer.schedule();
      },
      deepen: (elapsed, x, y) => {
        // Continue growing the molecule that spawned — actually here it
        // rotates slowly on the finger, which reads as "gathering".
        const now = performance.now();
        if (now - lastGestureAt < 140) return;
        lastGestureAt = now;
        const { nx, ny } = toLocal(x, y);
        cursorNx = nx; cursorNy = ny;
        const last = substances[substances.length - 1];
        if (last) {
          last.model = {
            ...last.model,
            rotation: [
              last.model.rotation[0] + 0.02,
              last.model.rotation[1] + 0.02,
              last.model.rotation[2],
            ],
          };
        }
        void elapsed;
      },
      ceremony: (x, y) => {
        // Seal the current channel state (subunit, openness, bound flag)
        // as the kept sigil. AGENTS.md: the room's one solemn act.
        void x; void y;
        lastGestureAt = performance.now();
        writer.flush();
        flex = Math.min(1.5, flex + 0.9);
        try { haptics.bloom(); } catch { /* noop */ }
        try { audio.bell?.(); } catch { /* noop */ }
      },
      settle: (_elapsed, _x, _y, _tier) => {
        /* dwell released — nothing to do */
      },
      timeScale: (k) => {
        // Three-finger hold: dilate. Gate dynamics slow to 0.25× at the ceremony tier.
        timeScaleTarget = clamp(k, 0.25, 1);
      },
      drag: (phase, x, y, dx, dy, fingers) => {
        if (fingers >= 3) return; // wind is its own handler
        const { nx, ny } = toLocal(x, y);
        cursorNx = nx; cursorNy = ny;
        lastGestureAt = performance.now();
        if (phase === "start") {
          const sub = nearestSubstance(nx, ny);
          draggingId = sub ? sub.id : -1;
          return;
        }
        if (phase === "end") {
          draggingId = -1;
          // If we released within the vestibule tolerance, bind.
          const sub = substances.find((s) => s.id !== -1);
          if (sub && !sub.bound && Math.abs(sub.z - VESTIBULE_Z) < 0.18 && Math.abs(sub.nx - 0.5) < 0.12) {
            sub.bound = true;
            sub.z = VESTIBULE_Z;
            sub.nx = 0.5;
            channel = bindSubstance(channel, sub.z);
            try { haptics.bloom(); } catch { /* noop */ }
            try { audio.bell?.(); } catch { /* noop */ }
            writer.schedule();
          }
          return;
        }
        if (draggingId < 0) return;
        const sub = substances.find((s) => s.id === draggingId);
        if (!sub) return;
        // Move the substance in the extracellular space. Convert dx/dy into
        // channel-space deltas.
        const rect = surface.getBoundingClientRect();
        const dNx = dx / Math.max(1, rect.width);
        const dNy = dy / Math.max(1, rect.height);
        sub.nx = clamp(sub.nx + dNx, 0.05, 0.95);
        sub.z = clamp(sub.z - dNy * 2, -0.9, 1.2);
        // If the dragged sub crosses out of the vestibule while bound → unbind
        if (sub.bound && Math.abs(sub.z - VESTIBULE_Z) > 0.28) {
          sub.bound = false;
          channel = unbindSubstance(channel);
          try { haptics.chop(); } catch { /* noop */ }
          try { audio.thud?.(); } catch { /* noop */ }
          writer.schedule();
        }
        try { haptics.tap(); } catch { /* noop */ }
      },
      wind: (dx, dy) => {
        // Three-finger drag: the membrane vibrates, ions accumulate faster,
        // the substance may pop out of the vestibule.
        membraneVibeTarget = clamp01(membraneVibeTarget + Math.hypot(dx, dy) * 0.004);
        // Every so often, force-pop the bound substance.
        if (channel.substanceBound && Math.abs(dx) + Math.abs(dy) > 20) {
          const bound = substances.find((s) => s.bound);
          if (bound) {
            bound.bound = false;
            bound.z = VESTIBULE_Z + 0.05;
            channel = unbindSubstance(channel);
            try { haptics.chop(); } catch { /* noop */ }
          }
        }
        try { haptics.roll(); } catch { /* noop */ }
      },
      flick: (x, y, angle, speed) => {
        const { nx, ny } = toLocal(x, y);
        lastGestureAt = performance.now();
        // A sharp push: nudge the nearest substance in the flick direction
        const sub = nearestSubstance(nx, ny);
        if (sub) {
          sub.nx = clamp(sub.nx + Math.cos(angle) * 0.04, 0.05, 0.95);
          sub.z = clamp(sub.z - Math.sin(angle) * 0.08 * Math.min(1, speed / 800), -0.9, 1.2);
        }
        try { haptics.chop(); } catch { /* noop */ }
      },
      stir: (cx, cy, angularVelocity) => {
        const { nx, ny } = toLocal(cx, cy);
        cursorNx = nx; cursorNy = ny;
        lastGestureAt = performance.now();
        // Swirl the ions in the extracellular space — a small orbital push.
        // (The actual ion positions are set by ionColumnSample; the swirl
        // reads as a subtle horizontal jitter that this gesture nudges up.)
        membraneVibeTarget = clamp01(membraneVibeTarget + Math.min(0.3, Math.abs(angularVelocity) * 0.05));
        try { haptics.tap(); } catch { /* noop */ }
      },
      sustain: (phase, spread, _cx, _cy) => {
        if (phase === "release") {
          spanHoldingOpen = false;
          spanSpread = 0;
          return;
        }
        // Two still fingers — hold the gate open. Bound substance blocks
        // the effect (see stepChannel: bound → target=0 regardless).
        spanHoldingOpen = true;
        spanSpread = spread;
        lastGestureAt = performance.now();
      },
      lens: (angle, velocity) => {
        // Twist (2f): toggle GluN2 subunit. Accumulate turn, commit at ~60°.
        lensTwistAcc += angle;
        if (velocity === 0) lensTwistAcc = 0;
        if (Math.abs(lensTwistAcc) >= 1.05) {
          channel = toggleSubunit(channel);
          tintMixTarget = channel.subunit === "2A" ? 0 : 1;
          lensTwistAcc = 0;
          try { haptics.lens(); } catch { /* noop */ }
          try { audio.chime?.(); } catch { /* noop */ }
          writer.schedule();
        }
      },
      season: (angle, velocity) => {
        // Three-finger twist: walk the bound substance through the pore.
        seasonUTarget = clamp01(seasonUTarget + angle * 0.35);
        // Snap to detents every quarter — 0 (vestibule), 0.5 (filter), 1 (out).
        if (velocity === 0) {
          try { haptics.detent(); } catch { /* noop */ }
          if (seasonUTarget < 0.15) seasonUTarget = 0;
          else if (Math.abs(seasonUTarget - 0.5) < 0.15) seasonUTarget = 0.5;
          else if (seasonUTarget > 0.85) seasonUTarget = 1;
        }
      },
      scatter: (intensity) => {
        // shake: full membrane vibration; force-unbind possible.
        membraneVibeTarget = clamp01(membraneVibeTarget + intensity * 0.6);
        if (channel.substanceBound && intensity > 0.6) {
          const bound = substances.find((s) => s.bound);
          if (bound) {
            bound.bound = false;
            bound.z = VESTIBULE_Z + 0.05;
            channel = unbindSubstance(channel);
          }
        }
        try { haptics.storm(); } catch { /* noop */ }
      },
      gravity: (gamma) => {
        // Tilt: the channel leans; unbound substances drift with gravity.
        const lean = clamp(gamma / 45, -1, 1);
        for (const s of substances) {
          if (s.bound) continue;
          s.nx = clamp(s.nx + lean * 0.003, 0.05, 0.95);
        }
      },
      knock: (intensity) => {
        // One clean ion pulse if the gate is open + unbound.
        if (!channel.substanceBound && channel.gateOpenness > 0.3) {
          spawnIonPulse(4);
        }
        flex = Math.min(1.5, flex + 0.4 + intensity * 0.2);
        try { haptics.detent(); } catch { /* noop */ }
        try { audio.thud?.(); } catch { /* noop */ }
      },
      night: (faceDown) => {
        nightTarget = faceDown ? 1 : 0;
      },
      breath: (strength) => {
        breathAmpTarget = 0.4 + 0.6 * clamp01(strength);
      },
      glimmer: () => {
        // After ~20s idle: a soft ion pulse rides down through the gate.
        spawnIonPulse(2);
      },
      reduced: (on) => {
        reduced = on;
      },
      moveCursor: (dx, dy) => {
        cursorNx = clamp01(cursorNx + dx * 0.04);
        cursorNy = clamp01(cursorNy + dy * 0.04);
      },
      keyTap: () => {
        // Keyboard: bind or unbind the substance based on current state.
        const sub = substances[0];
        if (!sub) return;
        if (sub.bound) {
          sub.bound = false;
          sub.z = VESTIBULE_Z + 0.05;
          channel = unbindSubstance(channel);
        } else {
          sub.bound = true;
          sub.z = VESTIBULE_Z;
          sub.nx = 0.5;
          channel = bindSubstance(channel, sub.z);
        }
        try { haptics.tap(); } catch { /* noop */ }
        writer.schedule();
      },
      keyHold: (elapsed) => {
        // Extended hold: seal the ceremony
        if (elapsed > 2400) {
          writer.flush();
          try { haptics.bloom(); } catch { /* noop */ }
        }
      },
      keyEscape: () => {
        spanHoldingOpen = false;
      },
      clear: () => {
        // <LetGo>: retire every substance and reset the channel.
        substances.length = 0;
        channel = initialChannelState(channel.subunit);
        seasonUTarget = 1;
        seasonU = 1;
        spanHoldingOpen = false;
        flex = 0;
        // clear the ion population too — a real "empty" state
        for (const item of population.items) item.presence = 0.999;
        setStanding(0);
        try {
          window.localStorage.setItem(
            GATE_STORAGE_KEY,
            JSON.stringify(serializeChannel(channel)),
          );
        } catch { /* noop */ }
        writer.cancel();
        try { haptics.roll(); } catch { /* noop */ }
        try { audio.thud?.(); } catch { /* noop */ }
      },
    };

    apiRef.current = engine;

    // helpers hoisted here so they close over the engine's state
    let lensTwistAcc = 0;
    let helixGlowIdx = -1;
    let helixGlowAt = 0;

    const spawnIonPulse = (n: number) => {
      // Spawn n ions at REST_ABOVE_Z; they'll descend through the pore
      // over the next few seconds if the gate is open and unbound.
      for (let i = 0; i < n; i++) {
        const nx = 0.5 + ((i - n / 2) * 0.01);
        const s = population.spawn(nx, 0, performance.now());
        s.z = REST_ABOVE_Z + 0.02 + i * 0.03;
        s.phase = (sceneHashSeed(SEED, s.id) & 0xffff) / 0xffff;
      }
    };

    // ——— the loop ———
    let raf = 0;
    let last = performance.now();
    const clockInput = {
      time: 0,
      turbulence: 0,
      reducedMotion: reduced,
    };

    const draw = (now: number) => {
      if (asleep) {
        raf = requestAnimationFrame(draw);
        last = now;
        return;
      }
      const tier: QualityTier = gov.beginFrame(now);
      const detail = detailForTier(tier);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Ease world axes toward their targets.
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      night += (nightTarget - night) * Math.min(1, dt * 3);
      membraneVibe += (membraneVibeTarget - membraneVibe) * Math.min(1, dt * 4);
      membraneVibeTarget *= Math.exp(-dt * 0.9);
      tintMix += (tintMixTarget - tintMix) * Math.min(1, dt * 4);
      breathAmp += (breathAmpTarget - breathAmp) * Math.min(1, dt * 4);
      seasonU += (seasonUTarget - seasonU) * Math.min(1, dt * 4);
      flex *= Math.exp(-dt * 2);

      // Breath — mirror /observe's clocksFrom shape.
      const audioT = audio.getAudioTime?.() ?? now / 1000;
      clockInput.time = audioT;
      clockInput.turbulence = membraneVibe;
      clockInput.reducedMotion = reduced;
      const clocks = clocksFrom(clockInput);

      // ——— step the channel physics ———
      channel = stepChannel(channel, dt * timeScale, clocks.breath, spanHoldingOpen);

      // ——— season walk: if a substance is bound, its z tracks seasonTarget.
      if (channel.substanceBound || seasonU < 0.99) {
        const target = seasonTarget(seasonU);
        const bound = substances.find((s) => s.bound) ?? substances[0];
        if (bound) {
          bound.z += (target.z - bound.z) * Math.min(1, dt * 3);
          if (bound.bound !== target.bound) {
            bound.bound = target.bound;
            if (target.bound) channel = bindSubstance(channel, bound.z);
            else channel = unbindSubstance(channel);
          }
        }
      }

      // ——— unbound substances drift back up ———
      for (const s of substances) {
        if (s.bound || draggingId === s.id) continue;
        // Drift toward REST_ABOVE_Z; exponential approach so the eye reads
        // one law across bound/unbound state.
        s.z += (REST_ABOVE_Z - s.z) * Math.min(1, dt * 0.8);
        // Small horizontal drift back toward 0.5 unless tilted.
        s.nx += (0.5 - s.nx) * Math.min(1, dt * 0.3);
      }

      // ——— ion population: descend through the pore when flow allows ———
      const ionRate = channel.ionFlow;
      // Spawn ions from above at a rate proportional to ionFlow (or blocked
      // accumulation — some ions still arrive from above and pile up).
      ionSpawnAcc += dt;
      const spawnInterval = 0.18;
      while (ionSpawnAcc >= spawnInterval) {
        ionSpawnAcc -= spawnInterval;
        if (population.items.length < ION_CAP - 4) {
          const nx = 0.5 + ((population.items.length % 5) - 2) * 0.01;
          const s = population.spawn(nx, 0, now);
          s.z = REST_ABOVE_Z + 0.05;
          s.phase = (sceneHashSeed(SEED, s.id) & 0xffff) / 0xffff;
        }
      }
      // Advance ion z: descend if flow > 0.15, otherwise stall above the gate.
      for (const s of population.items) {
        if (s.presence < 1) continue;
        // Above the gate, drift down; the speed scales with ionRate.
        if (s.z > GATE_Z) {
          const desired = -0.4 + 1.4 * ionRate; // negative = descent speed
          s.z += Math.min(0, desired) * dt * 0.6;
          // If flow is blocked (rate < 0.15), ions stall in a small band above the gate.
          if (ionRate < 0.15 && s.z < GATE_Z + 0.06) {
            s.z = GATE_Z + 0.06 + Math.sin((now / 1000 + s.phase) * 2) * 0.01;
          }
        } else {
          // Below the gate, continue descending toward the selectivity filter and out.
          s.z -= dt * 0.9;
          if (s.z < SELECTIVITY_Z - 0.2) {
            // Retire ions that pass the filter.
            s.presence = 0.999;
          }
        }
      }
      // Step the population (retiring items get their presence decremented).
      population.step({
        dt,
        tMs: now,
        breath: clocks.breath,
        detail: detail.particles,
        wind: 0,
        gravity: 0,
        agitation: membraneVibe,
        season: 0,
        timeScale,
        reducedMotion: reduced,
      });

      // Glimmer: after ~20s idle, a soft ion pulse fires.
      if (now - lastGestureAt > 20000 && now - lastGlimmerAt > 6000 && !reduced) {
        lastGlimmerAt = now;
        engine.glimmer();
      }

      // ——— shader draw ———
      const size = stage?.beginFrame(clocks, prog) ?? { width: surface.clientWidth, height: surface.clientHeight };
      if (prog && stage && quad) {
        const tintA = SUBUNIT_TINT["2A"];
        const tintB = SUBUNIT_TINT["2B"];
        // The shader mixes tintA/tintB by tintMix externally, but here we
        // just hand it the two anchors and use tintMix in the ribbon overlay.
        // Ease openness with the flex pulse so tutti/knock visibly pump the gate.
        const openWithFlex = clamp01(channel.gateOpenness + flex * 0.15);
        prog.setFloat("uGateOpenness", openWithFlex);
        prog.setFloat("uIonFlow", channel.ionFlow);
        prog.setFloat("uNight", night);
        prog.setFloat("uMembrane", membraneVibe);
        prog.setVec3("uTintA", tintA.r, tintA.g, tintA.b);
        prog.setVec3("uTintB", tintB.r, tintB.g, tintB.b);
        quad.draw();
      }

      // ——— population draw ———
      instanceBuffer.reset();
      population.emit(
        {
          width: size.width,
          height: size.height,
          tMs: now,
          breath: clocks.breath,
          detail: detail.particles,
          reducedMotion: reduced,
        },
        instanceBuffer,
      );
      populationLayer?.draw(instanceBuffer);

      // ——— 2D overlay: helices, substance, subunit label ———
      const ctx2 = stage?.overlay2d;
      if (ctx2) {
        const w = size.width;
        const h = size.height;
        ctx2.clearRect(0, 0, w, h);

        // The four helices, drawn as thick vertical ribbons that taper toward
        // the gate constriction. Two GluN1 (grey, outer), two GluN2 (tinted,
        // inner). The subunit tint is picked by tintMix so a twist visibly
        // slides the hue across the 2A↔2B boundary.
        const helixTop = 0.24 * h;
        const helixBot = 0.78 * h;
        const centerX = w * 0.5;
        // Draw membrane bands more solidly for legibility (the shader is faint)
        ctx2.fillStyle = "rgba(30, 34, 44, 0.55)";
        ctx2.fillRect(0, helixTop - 3, w, 3);
        ctx2.fillRect(0, helixBot, w, 3);

        // Sample the pore halfwidth at four y positions for each helix's
        // envelope. The shader also does this — the two paths agree because
        // both read helixHalfWidth from lib/gate.
        const nSteps = 24;
        const sampleY = (i: number) => helixTop + ((helixBot - helixTop) * i) / nSteps;

        // Four helix x positions, from outer to inner (mirrored across centerX).
        // Outer two = GluN1 (grey), inner two = GluN2 (tinted).
        const drawHelix = (offset: number, tint: string) => {
          ctx2.strokeStyle = tint;
          ctx2.lineWidth = 8;
          ctx2.lineCap = "round";
          ctx2.beginPath();
          for (let i = 0; i <= nSteps; i++) {
            const y = sampleY(i);
            const z = yToChannelZ(y / h);
            const halfW = helixHalfWidth(z, channel.gateOpenness);
            const x = centerX + offset * halfW * w * 0.32;
            if (i === 0) ctx2.moveTo(x, y);
            else ctx2.lineTo(x, y);
          }
          ctx2.stroke();
        };
        // Interpolate GluN2 tint by tintMix
        const rA = SUBUNIT_TINT["2A"], rB = SUBUNIT_TINT["2B"];
        const tR = Math.round(255 * (rA.r + (rB.r - rA.r) * tintMix));
        const tG = Math.round(255 * (rA.g + (rB.g - rA.g) * tintMix));
        const tB = Math.round(255 * (rA.b + (rB.b - rA.b) * tintMix));
        const glun2Color = `rgba(${tR}, ${tG}, ${tB}, 0.82)`;
        const glun1Color = `rgba(184, 188, 196, 0.70)`;
        drawHelix(-1.0, glun1Color); // outer left — GluN1
        drawHelix(-0.35, glun2Color); // inner left — GluN2
        drawHelix(0.35, glun2Color);  // inner right — GluN2
        drawHelix(1.0, glun1Color);   // outer right — GluN1

        // The helix glow (a tap on the wall travels up the LBD) — a short
        // ~500ms glow along one of the four helices.
        if (helixGlowIdx >= 0 && now - helixGlowAt < 700) {
          const glowT = 1 - (now - helixGlowAt) / 700;
          const offsets = [-1.0, -0.35, 0.35, 1.0];
          const off = offsets[helixGlowIdx];
          ctx2.strokeStyle = `rgba(240, 236, 210, ${0.65 * glowT})`;
          ctx2.lineWidth = 14;
          ctx2.lineCap = "round";
          ctx2.beginPath();
          for (let i = 0; i <= nSteps; i++) {
            const y = sampleY(i);
            const z = yToChannelZ(y / h);
            const halfW = helixHalfWidth(z, channel.gateOpenness);
            const x = centerX + off * halfW * w * 0.32;
            if (i === 0) ctx2.moveTo(x, y);
            else ctx2.lineTo(x, y);
          }
          ctx2.stroke();
        }

        // ——— the substance(s) — ball-and-stick from bornMolecule3D ————
        // For each substance draw a small ball-and-stick model at its
        // (nx, z) position. Bond width scales down inside the pore so the
        // channel walls read as tighter than the substance.
        for (const s of substances) {
          const cx = s.nx * w;
          const cy = channelZToY(s.z) * h;
          const scale = Math.min(w, h) * (s.bound ? 0.028 : 0.033);
          const { atoms, bonds } = projectMolecule(s.model, cx, cy, scale);
          // Bonds behind atoms
          ctx2.lineCap = "round";
          for (const b of bonds) {
            const dx = b.bx - b.ax;
            const dy = b.by - b.ay;
            const len = Math.max(1, Math.hypot(dx, dy));
            const nx = -dy / len;
            const ny = dx / len;
            const strokes = b.order === 3 ? 3 : b.order === 2 ? 2 : 1;
            for (let k = 0; k < strokes; k++) {
              const off = strokes === 1 ? 0 : (k - (strokes - 1) / 2) * 3;
              ctx2.strokeStyle = `rgba(210, 210, 220, ${s.bound ? 0.9 : 0.72})`;
              ctx2.lineWidth = 1.6;
              ctx2.beginPath();
              ctx2.moveTo(b.ax + nx * off, b.ay + ny * off);
              ctx2.lineTo(b.bx + nx * off, b.by + ny * off);
              ctx2.stroke();
            }
          }
          const zSorted = [...atoms.entries()].sort((a1, b1) => a1[1].z - b1[1].z);
          for (const [, atom] of zSorted) {
            const alpha = s.bound ? 0.95 : 0.85;
            ctx2.fillStyle = ATOM_COLOR[atom.el as keyof typeof ATOM_COLOR] ?? "rgba(240,240,240,1)";
            ctx2.globalAlpha = alpha * (night > 0.5 ? 0.6 : 1);
            ctx2.beginPath();
            ctx2.arc(atom.x, atom.y, atom.r, 0, Math.PI * 2);
            ctx2.fill();
            ctx2.globalAlpha = 1;
            ctx2.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.4})`;
            ctx2.lineWidth = 0.8;
            ctx2.stroke();
          }
        }

        // ——— subunit label — small, unobtrusive
        ctx2.fillStyle = `rgba(240, 236, 210, 0.85)`;
        ctx2.font = `${Math.max(14, h * 0.022)}px system-ui, -apple-system, sans-serif`;
        ctx2.textAlign = "left";
        ctx2.textBaseline = "top";
        ctx2.fillText(`(${channel.subunit})`, w * 0.03, h * 0.03);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      apiRef.current = null;
      unvis();
      ungal();
      writer.flush();
      writer.cancel();
      populationLayer?.dispose();
      quad?.dispose();
      stage?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The verbs, in the shell's vocabulary. Each reads through apiRef so the
  // engine never loses an in-flight hold when React re-renders.
  const voice = useMemo<RoomVoice>(
    () => ({
      tap: (e) => apiRef.current?.tap(e.x, e.y, e.intensity, e.count, e.fingers),
      stepBack: () => apiRef.current?.stepBack(),
      tutti: (e) => apiRef.current?.tutti(e.intensity),
      plant: (e) => apiRef.current?.plant(e.x, e.y),
      deepen: (e) => apiRef.current?.deepen(e.elapsed, e.x, e.y, e.tier),
      ceremony: (e) => apiRef.current?.ceremony(e.x, e.y),
      settle: (e) => apiRef.current?.settle(e.elapsed, e.x, e.y, e.tier),
      timeScale: (k) => apiRef.current?.timeScale(k),
      drag: (e) => apiRef.current?.drag(e.phase, e.x, e.y, e.dx, e.dy, e.fingers),
      wind: (e) => apiRef.current?.wind(e.dx, e.dy),
      flick: (e) => apiRef.current?.flick(e.x, e.y, e.angle, e.speed, e.fingers),
      stir: (e) => apiRef.current?.stir(e.cx, e.cy, e.angularVelocity),
      sustain: (e) => apiRef.current?.sustain(e.phase, e.spread, e.cx, e.cy),
      lens: (e) => apiRef.current?.lens(e.angle, e.velocity),
      season: (e) => apiRef.current?.season(e.angle, e.velocity),
      scatter: (e) => apiRef.current?.scatter(e.intensity),
      gravity: (e) => apiRef.current?.gravity(e.gamma),
      knock: (e) => apiRef.current?.knock(e.intensity),
      night: (e) => apiRef.current?.night(e.faceDown),
      breath: (e) => apiRef.current?.breath(e.strength),
    }),
    [],
  );

  const keyboard = useMemo(
    () => ({
      enter: () => apiRef.current?.keyTap(),
      enterHeld: (elapsed: number) => apiRef.current?.keyHold(elapsed),
      escape: () => apiRef.current?.keyEscape(),
      arrow: (dx: number, dy: number) => apiRef.current?.moveCursor(dx, dy),
    }),
    [],
  );

  const letGo = useCallback(() => {
    apiRef.current?.clear();
    setStanding(0);
  }, []);

  const onGlimmer = useCallback(() => apiRef.current?.glimmer(), []);
  const onReducedMotion = useCallback((on: boolean) => apiRef.current?.reduced(on), []);

  // Suppress the unused type warning for SubunitId (it's used through channel).
  void ({} as SubunitId);

  return (
    <RoomShell
      route="/gate"
      surfaceRef={surfaceRef}
      voice={voice}
      keyboard={keyboard}
      onGlimmer={onGlimmer}
      onReducedMotion={onReducedMotion}
      letGo={{ label: "let the channel rest", onLetGo: letGo, visible: standing > 0 }}
      style={{ position: "fixed", inset: 0, background: "#04060c" }}
    >
      <canvas
        ref={surfaceRef}
        role="application"
        tabIndex={0}
        aria-label="a cross-section of an ion channel — four subunit helices tapering to a central gate, with a small molecule bound in the vestibule above the pore"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
          outline: "none",
        }}
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
    </RoomShell>
  );
}
