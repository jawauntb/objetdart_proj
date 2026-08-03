"use client";

/**
 * RoomTemplate — a whole conformant room in eighty lines of material.
 *
 * Copy this file, replace the mote with your object, replace the FIELD shader
 * with your background, and write your registry entry. Everything else is
 * already done: the gesture grammar routed by finger count, the vessel, the
 * frame governor, the visibility pause, the DPR ceiling, instanced rendering,
 * persistence through an idle writer, the shared `<LetGo>`, the glimmer, the
 * keyboard dialect, reduced motion.
 *
 * That is the point. A room author's whole job is the visual and material
 * question — what is the thing, what does the field look like, what does each
 * verb mean in *this* material — and none of the wiring. This file passes
 * `npm run test:room-contract` unmodified; if a copy of it fails, the copy
 * removed something the contract needs.
 *
 * Read first: docs/new-room.md (the flow), docs/gesture-grammar.md (the
 * verbs), AGENTS.md (the laws). This file is deliberately NOT registered as a
 * route — it is a shape to copy, never a component to import.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import LetGo from "@/components/LetGo";
import { createPopulation, mulberry32, type SceneObjectSpec, type SceneObjectState } from "@/lib/scene/object";
import { createRoomShell, type RoomShell } from "@/lib/scene/room";

// ——— 1. The registry entry this room would take. Copy it into
// src/lib/room-registry.ts and the nav, the gallery, the guide's coverage,
// the axis chrome and this contract all follow from it:
//
//   {
//     key: "template", href: "/template", desc: "…", icon: "growth",
//     cluster: "field", dark: true, kind: "room",
//     source: "src/components/YourRoom.tsx", page: "src/app/template/page.tsx",
//     address: { band: "drop" },          // or { exempt: "why it has no scale" }
//     frame: "yield",                      // "own" only if you keep a camera
//     chrome: "axis",                      // <AxisChrome route="/template" />
//     keeps: STORAGE_KEY, creates: "a mote",
//     exempt: {},                          // every binding you cannot express, with the reason
//   }

const STORAGE_KEY = "objetdart:room-template:v1";

// ——— 2. The background field. A fragment shader, because a field of light is
// what a shader is for — 2D compositing can only imitate depth. `uv` is 0..1
// with y down the page, `t` is seconds, and the room's law-layer uniforms
// (uBreath, uWind, uGravity, uAgitation, uSeason) arrive already wired.
const FIELD = `
vec3 field(vec2 uv, float t) {
  vec2 p = uv - vec2(0.5, 0.55);
  p.x *= uRes.x / max(1.0, uRes.y);
  float d = length(p);
  float haze = smoothstep(0.9, 0.02, d);
  float drift = sin(uv.x * 5.0 + t * 0.08 + uWind * 2.0) * 0.5 + 0.5;
  vec3 deep = vec3(0.031, 0.043, 0.063);
  vec3 warm = vec3(0.086, 0.078, 0.086);
  vec3 c = mix(deep, warm, haze * (0.55 + 0.45 * uBreath) * (0.7 + 0.3 * drift));
  c += vec3(0.03, 0.02, 0.01) * uAgitation;
  return c;
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
  const shellRef = useRef<RoomShell | null>(null);
  const [standing, setStanding] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const population = createPopulation(mote);
    const shell = createRoomShell({
      wrap,
      canvas,
      population,
      storageKey: STORAGE_KEY,
      instanceBudget: 512,
      layer: { field: FIELD, palette: ["#2c4a5c", "#c8732a", "#f3d77a"], fallback: "#0a0d12" },
      onStanding: setStanding,
      // Nothing is punished: a verb that reached no mote still answers softly
      // in the field itself (grammar §6).
      onUnanswered: () => {},
    });
    shellRef.current = shell;

    // ——— 6. The keyboard dialect. Stillness never removes a verb, and no
    // verb is touch-only: everything a finger can do, a key can do.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const rng = mulberry32(population.items.length * 2654435761);
        shell.spawnAt(0.25 + rng() * 0.5, 0.3 + rng() * 0.4);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      shell.detach();
      shellRef.current = null;
    };
  }, []);

  // ——— 7. The quiet clear. Always the shared <LetGo>: it portals to
  // document.body because a control rendered inside a `position: fixed` room
  // wrapper is trapped in that stacking context under the tape's z-index in
  // Chrome, and silently swallows every click. Never hand-roll this button.
  const letGo = useCallback(() => shellRef.current?.letGo(), []);

  return (
    <div ref={wrapRef} style={{ position: "fixed", inset: 0, background: "#0a0d12" }}>
      <canvas
        ref={canvasRef}
        role="application"
        tabIndex={0}
        aria-label="a field of motes — touch one and it charges, rest a finger on empty ground and one gathers, hold longer and it seals"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
          userSelect: "none",
        }}
      />
      <LetGo label="let the field go" onLetGo={letGo} visible={standing > 0} />
      {/* ——— 8. The page mounts the chrome, never the room:
          <AxisChrome route="/your-room" /> in src/app/your-room/page.tsx.
          Never bind pinch or pan2 yourself unless the registry says
          `frame: "own"`. See docs/new-room.md §1 for the ordinal decision. */}
    </div>
  );
}
