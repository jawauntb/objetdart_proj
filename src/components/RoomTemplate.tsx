"use client";

/**
 * RoomTemplate — a whole conformant room, and almost all of it is material.
 *
 * Copy this file, replace the FIELD shader with your background and the mote
 * with your object, and write `src/rooms/<key>/room.config.ts`. Everything
 * else is already done: `<RoomShell>` mounts the axis chrome, the complete
 * gesture binding table, the vessel, the glimmer clock, the keyboard dialect,
 * reduced motion and the quiet clear; `createGLStage` owns the context, the
 * DPR tiers and the shared clocks; `scene/` gives your objects one shape and
 * draws the whole population in a single instanced pass.
 *
 * That is the point. A room author's whole job is the visual and material
 * question — what is the thing, what does the field look like, what does each
 * verb mean in *this* material — and none of the wiring.
 *
 * Read first: docs/new-room.md (the flow), docs/gesture-grammar.md (the
 * verbs), AGENTS.md (the laws). Deliberately NOT registered as a route: a
 * shape to copy, never a component to import.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { createIdleWriter, detailForTier, onVisibility, createFrameGovernor } from "@/lib/room-runtime";
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

// ——— 1. The manifest this room would take. `src/rooms/<key>/room.config.ts`
// declares where it is (route, sigil, placement, guide entry, chrome);
// `src/lib/room-registry.ts` declares what it owes the grammar — its frame
// ownership, its persistence key, the noun a dwell makes, and a written
// reason for every global binding this material cannot express.

const STORAGE_KEY = "objetdart:room-template:v1";

// ——— 2. The background field. A fragment shader, because a field of light is
// what a shader is for — 2D compositing can only imitate depth. The stage
// binds the shared clocks for you: u_time, u_breath, u_turbulence, u_baseHz,
// u_brightness, u_reduced, u_resolution.
const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_breath;
uniform float u_turbulence;
uniform float u_brightness;
uniform float u_wind;
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec2 p = uv - vec2(0.5, 0.55);
  p.x *= u_resolution.x / max(1.0, u_resolution.y);
  float haze = smoothstep(0.9, 0.02, length(p));
  float drift = sin(uv.x * 5.0 + u_time * 0.08 + u_wind * 2.0) * 0.5 + 0.5;
  vec3 deep = vec3(0.031, 0.043, 0.063);
  vec3 warm = vec3(0.086, 0.078, 0.086);
  vec3 c = mix(deep, warm, haze * (0.55 + 0.45 * u_breath) * (0.7 + 0.3 * drift));
  c += vec3(0.03, 0.02, 0.01) * u_turbulence * u_brightness;
  gl_FragColor = vec4(c, 1.0);
}`;

// ——— 3. The object. Its state is a small vector plus a seed (nothing about
// it is random — the determinism law), and it declares exactly the verbs its
// material can answer. Declare a verb without implementing it and
// `createPopulation` throws before a stranger's hand ever finds the silence.

type Mote = SceneObjectState & {
  /** the thing's own slow cycle, so tutti and season have something to move. */
  hue: number;
  wobble: number;
  charge: number;
};

const mote: SceneObjectSpec<Mote> = {
  kind: "a mote",
  cap: 24,

  born(seed, nx, ny, tMs) {
    const rng = mulberry32(seed);
    return {
      id: 0,
      seed,
      nx,
      ny,
      bornMs: tMs,
      // Born small and legible: it *gathers* under the finger rather than
      // appearing whole, so the dwell reads as making rather than clicking.
      growth: 0.12,
      sealedMs: null,
      presence: 1,
      hue: rng(),
      wobble: rng() * Math.PI * 2,
      charge: 0,
    };
  },

  step(s, ctx) {
    // Everything continuous: growth eases toward its target, charge bleeds
    // off, the wobble rides the shared breath and the world's wind.
    s.growth += (1 - s.growth) * Math.min(1, ctx.dt * 0.6);
    s.charge *= 1 - Math.min(1, ctx.dt * 1.4);
    if (!ctx.reducedMotion) {
      s.wobble += ctx.dt * (0.4 + s.hue * 0.5);
      s.nx = Math.max(0.02, Math.min(0.98, s.nx + ctx.wind * ctx.dt * 0.06));
      s.ny = Math.max(0.02, Math.min(0.98, s.ny + ctx.gravity * ctx.dt * 0.02));
    }
  },

  // ——— 4. Instance data, never draw calls. Eight numbers; the room draws the
  // whole population in one pass. A `createRadialGradient` here — per object,
  // per frame — is the single most expensive habit in this codebase.
  emit(s, ctx, out) {
    const sealed = s.sealedMs !== null;
    const wob = ctx.reducedMotion ? 0 : Math.sin(s.wobble) * 3;
    const r = (3 + s.growth * 9 + s.charge * 6) * (sealed ? 1.35 : 1);
    out.push(
      s.nx * ctx.width + wob,
      s.ny * ctx.height,
      r,
      s.wobble,
      s.hue,
      0.35 + s.charge * 0.6 + ctx.breath * 0.15,
      (Math.sin(s.wobble * 0.7) * 0.5 + 0.5) * (sealed ? 1 : 0.7),
      s.presence * (0.5 + s.growth * 0.5),
    );
    // A sealed mote keeps a second, wider ember — the ceremony is visible at
    // rest, not only at the moment it happened.
    if (sealed) {
      out.push(
        s.nx * ctx.width + wob,
        s.ny * ctx.height,
        r * 2.4,
        -s.wobble * 0.3,
        Math.min(1, s.hue + 0.3),
        0.9,
        ctx.breath,
        s.presence * 0.22,
      );
    }
  },

  // ——— 5. The verbs this material speaks, and what each one means here.
  // Duration and intensity are axes, never switches: a tap scales with how
  // hard it landed, and a hold keeps deepening past its tier.
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
      s.charge = Math.min(1, s.charge + 0.35 * e.intensity);
    },
    stroke: (s, e) => {
      s.nx = Math.max(0.02, Math.min(0.98, s.nx + e.dx));
      s.ny = Math.max(0.02, Math.min(0.98, s.ny + e.dy));
    },
    dwell: (s, e) => {
      // Keeps deepening: 2400ms must not feel like 900ms.
      s.growth = Math.min(1, s.growth + e.elapsedMs / 90000);
      s.charge = Math.min(1, s.charge + 0.02);
    },
    ceremony: (s, e) => {
      // The room's one solemn act, and its touch-reachable delete: an unsealed
      // mote is sealed; a sealed one is let go.
      if (s.sealedMs === null) s.sealedMs = e.tMs;
      else s.presence = 0.999;
    },
    tutti: (s) => {
      s.charge = Math.min(1, s.charge + 0.5);
    },
    lens: (s, e) => {
      // The lens turns the level of description, not the scale: here the mote
      // reads as ember or as phase, and the twist crossfades between them.
      s.wobble += e.angle * 0.5;
      s.hue = (s.hue + e.angle / (Math.PI * 8) + 1) % 1;
    },
    season: (s, e) => {
      s.hue = (s.hue + e.angle / (Math.PI * 2) + 1) % 1;
    },
    wind: (s, e) => {
      s.wobble += e.dx * 6;
    },
    dilate: (s) => {
      s.charge = Math.min(1, s.charge + 0.004);
    },
    gravity: (s, e) => {
      s.nx = Math.max(0.02, Math.min(0.98, s.nx + e.dx * 0.004));
    },
    agitate: (s, e) => {
      s.wobble += e.intensity * 3;
      s.charge = Math.min(1, s.charge + e.intensity * 0.4);
    },
    knock: (s, e) => {
      s.charge = Math.min(1, s.charge + 0.3 * e.intensity);
    },
    night: (s, e) => {
      s.charge = e.intensity > 0.5 ? 0 : s.charge;
    },
  },
};

export default function RoomTemplate() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [standing, setStanding] = useState(0);
  const letGoRef = useRef<() => void>(() => {});
  const plantRef = useRef<(nx: number, ny: number) => void>(() => {});
  const voiceRef = useRef<ReturnType<typeof populationVoice> | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const population = createPopulation(mote);

    // ——— 6. Persistence: a versioned key, written through an idle writer so
    // a fast hand never writes localStorage once per gesture.
    const writer = createIdleWriter(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(population.serialize()));
      } catch {
        /* quota / private mode — the room still plays */
      }
    });
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) population.load(JSON.parse(raw), performance.now());
    } catch {
      /* a fresh field */
    }
    setStanding(population.standing());

    // ——— 7. The stage: one GL context, DPR through the quality tiers, the
    // shared clocks, context-loss recovery and disposal — none of it here.
    const stage = createGLStage(canvas, { wrap, label: "room-template", reducedMotion: reduced });
    const prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    const layer = stage ? createPopulationLayer(stage) : null;
    const buffer = createInstanceBuffer(512);

    // The world's own fields — properties of the room, not of any one thing
    // standing in it. Objects read them from StepContext.
    let wind = 0;
    let agitation = 0;
    let gravity = 0;
    let season = 0;
    let timeScale = 1;

    voiceRef.current = populationVoice(population, {
      size: () => ({ width: wrap.clientWidth, height: wrap.clientHeight }),
      now: () => performance.now(),
      onSpawn: () => {
        audio.spark();
        haptics.ripple(0.5);
        writer.schedule();
      },
      onAnswered: (_e, answered) => {
        if (answered > 0) writer.schedule();
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
        },
        timeScale: (k) => {
          timeScale = k;
        },
      },
    });
    plantRef.current = (nx, ny) => {
      population.spawn(nx, ny, performance.now());
      audio.spark();
      haptics.ripple(0.5);
      writer.schedule();
      setStanding(population.standing());
    };
    letGoRef.current = () => {
      // An exhale, never a blink: the population retires over a breath in its
      // own material, and storage is written empty at once — an empty room is
      // a remembered state, and nothing respawns over a deliberate clearing.
      population.letGo();
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ kind: population.spec.kind, items: [] }),
        );
      } catch {
        /* noop */
      }
      writer.cancel();
      setStanding(0);
      audio.thud();
      haptics.roll();
    };

    // ——— 8. The frame: governed, and asleep when the tab is hidden.
    const gov = createFrameGovernor();
    let hidden = false;
    const offVisibility = onVisibility((h) => {
      hidden = h;
      if (h) gov.force("sleep");
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

    let raf = 0;
    let last = performance.now();
    let lastStanding = population.standing();
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

      wind *= 0.99;
      agitation *= 0.96;

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

      if (stage) {
        const size = stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: agitation, reducedMotion: reduced }),
          prog,
        );
        prog?.setFloat("u_wind", wind);
        quad?.draw();
        buffer.reset();
        population.emit(
          {
            width: size.width,
            height: size.height,
            tMs: t,
            breath: step.breath,
            detail: detail.particles,
            reducedMotion: reduced,
          },
          buffer,
        );
        layer?.draw(buffer);
      }

      const n = population.standing();
      if (n !== lastStanding) {
        lastStanding = n;
        setStanding(n);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      offVisibility();
      writer.flush();
      layer?.dispose();
      quad?.dispose();
      stage?.dispose();
      voiceRef.current = null;
    };
  }, []);

  // ——— 9. The quiet clear is always the shared <LetGo>, mounted by the
  // shell: a control rendered inside a `position: fixed` room wrapper is
  // trapped in that stacking context under the tape's z-index in Chrome and
  // silently swallows every click. Never hand-roll this button.
  const letGo = useCallback(() => letGoRef.current(), []);

  return (
    <RoomShell
      route="/room-template"
      surfaceRef={wrapRef}
      voice={voiceRef.current ?? undefined}
      letGo={{ label: "let the field go", onLetGo: letGo, visible: standing > 0 }}
      keyboard={{
        // Nothing here is touch-only, and nothing is keyboard-only either.
        enter: () => plantRef.current(0.5, 0.5),
        enterHeld: (elapsed) => plantRef.current(0.3 + ((elapsed / 4000) % 0.4), 0.5),
      }}
      style={{ position: "fixed", inset: 0, background: "#0a0d12" }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={canvasRef}
          role="application"
          tabIndex={0}
          aria-label="a field of motes — touch one and it charges, rest a finger on empty ground and one gathers, hold longer and it seals"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        />
      </div>
    </RoomShell>
  );
}
