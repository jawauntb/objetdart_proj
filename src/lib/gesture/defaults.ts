/**
 * The default binding table — every global verb answered, in every room.
 *
 * `docs/gesture-grammar.md` §5 fixes what each verb *means* site-wide, and §6.4
 * says an unbound gesture must still do something gently neutral: "nothing
 * errors, nothing modals". In practice rooms bound the three verbs their
 * material suggested and left the rest dead — a press that does nothing is the
 * single most common complaint about this site.
 *
 * This module closes that hole structurally. A room supplies a `RoomVoice`:
 * the subset of verbs its material really interprets. Every verb it leaves out
 * still lands — as the room's own soft acknowledgement, scaled by the
 * magnitude the hand offered, in two senses in the same frame. The room
 * upgrades a verb by implementing it, never by discovering it was silent.
 *
 * Pure: no DOM, no React, no direct audio/haptics imports. The effects arrive
 * through `RoomSenses` so `scripts/test-rooms.mjs` can drive the whole table
 * in plain node and assert that no verb is a no-op.
 */

import type { GestureHandlers } from "@/lib/gesture";
import { tapTrainDepth } from "@/lib/gesture/core";

/**
 * The site-wide meanings, as a table the tests can walk. `owner: "shell"`
 * verbs are handled by chrome the room mounts (ScaleTravel owns pinch and
 * pan2); `owner: "room"` verbs must reach the room's material or its default
 * acknowledgement.
 */
export const GLOBAL_VERBS = [
  { verb: "tap", meaning: "touch the material — scaled by how hard it landed", owner: "room" },
  { verb: "tap2", meaning: "step back — the frame retreats one step; a raised lens lowers", owner: "room" },
  { verb: "tap3", meaning: "tutti — everything alive answers softly at once", owner: "room" },
  { verb: "holdDwell", meaning: "plant / grow / charge, deepening for as long as it is held", owner: "room" },
  { verb: "holdCeremony", meaning: "the room's one solemn act", owner: "room" },
  { verb: "hold3", meaning: "time dilation while held", owner: "room" },
  { verb: "drag", meaning: "stroke the material", owner: "room" },
  { verb: "drag3", meaning: "wind / weather", owner: "room" },
  { verb: "flick", meaning: "throw, skip, dismiss", owner: "room" },
  { verb: "scrub", meaning: "stir — a circular path, any finger count", owner: "room" },
  { verb: "span", meaning: "sustain — two still fingers holding an interval open", owner: "room" },
  { verb: "twist", meaning: "rotate the lens — level of description at fixed scale", owner: "room" },
  { verb: "twist3", meaning: "advance / rewind the room's season", owner: "room" },
  { verb: "rhythm", meaning: "entrain the room's clock to the hand's tempo", owner: "room" },
  { verb: "drum", meaning: "percussion between two zones the hands alternate", owner: "room" },
  { verb: "arpeggio", meaning: "a staggered chord — narrate the roll", owner: "room" },
  { verb: "shake", meaning: "scatter / agitate", owner: "room" },
  { verb: "tilt", meaning: "gravity", owner: "room" },
  { verb: "knock", meaning: "wake / ring the room", owner: "room" },
  { verb: "flip", meaning: "night", owner: "room" },
  { verb: "breath", meaning: "the candle", owner: "room" },
  { verb: "pinch", meaning: "zoom within the band; held through the detent, travel", owner: "shell" },
  { verb: "pan2", meaning: "pan the frame", owner: "shell" },
] as const;

export type GlobalVerb = (typeof GLOBAL_VERBS)[number]["verb"];

/** Verbs the room (not the chrome) is responsible for answering. */
export const ROOM_VERBS: GlobalVerb[] = GLOBAL_VERBS.filter((v) => v.owner === "room").map(
  (v) => v.verb,
);

/**
 * The two senses every acknowledgement lands in. `<RoomShell>` fills this from
 * `lib/audio` + `lib/haptics`; the tests fill it with recorders.
 */
export type RoomSenses = {
  /** a soft voice at `strength` 0..1, `weight` 0..1 (heavier = lower, longer) */
  sound: (strength: number, weight: number) => void;
  /** a touch of the same magnitude, in the same frame */
  touch: (strength: number) => void;
};

/**
 * What a room's material actually interprets. Everything is optional — an
 * omitted verb falls through to the acknowledgement, never to silence.
 * `x`/`y` are surface pixels; `intensity`, `strength` and `winding` are the
 * grammar's continuous magnitudes and must never be treated as switches.
 */
export type RoomVoice = {
  /**
   * One-finger tap train. `count` keeps rising inside the train window
   * (capped in `gesture/core.ts`); rooms bind special payoffs at tiers
   * 1 / 3 / 5 / n via `tapTrainTier(count)` — the low-friction reward ladder.
   */
  tap?: (e: { fingers: number; count: number; intensity: number; x: number; y: number }) => void;
  stepBack?: (e: { x: number; y: number }) => void;
  tutti?: (e: { intensity: number }) => void;
  /** the dwell tier opened — plant, grow, charge */
  plant?: (e: { x: number; y: number; intensity: number; tier: number }) => void;
  /** every hold tick; `elapsed` keeps counting past every tier on purpose */
  deepen?: (e: { elapsed: number; tier: number; x: number; y: number }) => void;
  ceremony?: (e: { elapsed: number; x: number; y: number }) => void;
  /**
   * The hold ended, at any tier — the moment a lifted finger lets go of what
   * it was charging. Rooms whose dwell act COMMITS on release (a body
   * condensed under the fingertip and thrown with the drift it was carrying)
   * need the lift itself; `ceremony` only fires at the top tier.
   */
  settle?: (e: { elapsed: number; tier: number; x: number; y: number }) => void;
  timeScale?: (k: number) => void;
  drag?: (e: { fingers: number; phase: "start" | "move" | "end"; x: number; y: number; dx: number; dy: number; vx: number; vy: number }) => void;
  wind?: (e: { dx: number; dy: number }) => void;
  flick?: (e: { fingers: number; angle: number; speed: number; x: number; y: number }) => void;
  stir?: (e: { winding: number; angularVelocity: number; cx: number; cy: number }) => void;
  /**
   * The span: two still fingers sustaining an interval. `spread` is the live
   * distance between them and `elapsed` keeps counting through every tick —
   * whatever is sustained must keep deepening for as long as it is held.
   */
  sustain?: (e: {
    phase: "enter" | "tick" | "release";
    spread: number;
    elapsed: number;
    cx: number;
    cy: number;
    ax: number;
    ay: number;
    bx: number;
    by: number;
  }) => void;
  lens?: (e: { angle: number; velocity: number }) => void;
  season?: (e: { angle: number; velocity: number }) => void;
  rhythm?: (e: { bpm: number; stability: number }) => void;
  drum?: (e: { hits: number; alternation: number; x: number; y: number }) => void;
  arpeggio?: (e: { fingers: number; spreadMs: number; x: number; y: number }) => void;
  scatter?: (e: { intensity: number }) => void;
  gravity?: (e: { beta: number; gamma: number }) => void;
  knock?: (e: { intensity: number }) => void;
  night?: (e: { faceDown: boolean }) => void;
  breath?: (e: { strength: number }) => void;
};

export type RoomBindingContext = {
  senses: RoomSenses;
  voice: RoomVoice;
  /** stillness never removes a verb — it only quiets the answer */
  reducedMotion?: boolean;
  /** ScaleTravel owns pinch/pan2 on axis rooms; leave them unbound here */
  travelOwnsFrame?: boolean;
  /** called on any hand contact, for the idle glimmer clock */
  onContact?: () => void;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Which verbs this voice answers itself. Everything else is acknowledged.
 * Exported so a room (and the enforcement check) can see its own coverage.
 */
export function voiceCoverage(voice: RoomVoice): { spoken: GlobalVerb[]; acknowledged: GlobalVerb[] } {
  const map: Partial<Record<GlobalVerb, keyof RoomVoice>> = {
    tap: "tap",
    tap2: "stepBack",
    tap3: "tutti",
    holdDwell: "plant",
    holdCeremony: "ceremony",
    hold3: "timeScale",
    drag: "drag",
    drag3: "wind",
    flick: "flick",
    scrub: "stir",
    span: "sustain",
    twist: "lens",
    twist3: "season",
    rhythm: "rhythm",
    drum: "drum",
    arpeggio: "arpeggio",
    shake: "scatter",
    tilt: "gravity",
    knock: "knock",
    flip: "night",
    breath: "breath",
  };
  const spoken: GlobalVerb[] = [];
  const acknowledged: GlobalVerb[] = [];
  for (const verb of ROOM_VERBS) {
    const field = map[verb];
    if (field && typeof voice[field] === "function") spoken.push(verb);
    else acknowledged.push(verb);
  }
  return { spoken, acknowledged };
}

/**
 * Build the complete handler table. Every room verb is bound: to the room's
 * own interpretation when it has one, otherwise to an acknowledgement whose
 * magnitude tracks the hand's.
 */
export function roomGestureBindings(ctx: RoomBindingContext): GestureHandlers {
  const { senses, voice, reducedMotion = false, travelOwnsFrame = true, onContact } = ctx;
  const quiet = reducedMotion ? 0.55 : 1;

  /** the fallback: never nothing, never loud, always two senses at once */
  const answer = (strength: number, weight: number) => {
    const s = clamp01(strength) * quiet;
    senses.sound(s, clamp01(weight));
    senses.touch(s);
  };

  const contact = () => onContact?.();

  const handlers: GestureHandlers = {
    tap: (e) => {
      contact();
      if (e.fingers >= 3) {
        if (voice.tutti) voice.tutti({ intensity: e.intensity });
        else answer(0.55 + e.intensity * 0.35, 0.2);
        return;
      }
      if (e.fingers === 2) {
        if (voice.stepBack) voice.stepBack({ x: e.x, y: e.y });
        else answer(0.3, 0.75);
        return;
      }
      if (voice.tap) {
        voice.tap(e);
        return;
      }
      // Soft train: each extra tap in the window deepens the payoff — the
      // low-friction ladder rooms upgrade at tiers 1 / 3 / 5 / n.
      const depth = tapTrainDepth(e.count);
      answer(0.22 + e.intensity * 0.45 + depth * 0.32, 0.5 - depth * 0.18);
    },

    hold: (e) => {
      contact();
      if (e.fingers >= 3) {
        // Time dilation while held: ×1 → ×0.25 over the first two seconds,
        // and back to ×1 on release. Continuous, never a switch.
        if (e.phase === "release") voice.timeScale?.(1);
        else {
          const k = 1 - 0.75 * clamp01(e.elapsed / 2000);
          if (voice.timeScale) voice.timeScale(k);
          else if (e.phase === "enter") answer(0.3, 0.9);
        }
        return;
      }
      if (e.phase === "enter") {
        if (e.tier >= 1) {
          if (voice.plant) voice.plant({ x: e.x, y: e.y, intensity: e.intensity, tier: e.tier });
          else answer(0.4, 0.5);
        }
        return;
      }
      if (e.phase === "tick") {
        // Duration is an axis: a hold must keep answering past every tier.
        voice.deepen?.({ elapsed: e.elapsed, tier: e.tier, x: e.x, y: e.y });
        return;
      }
      if (e.phase === "release") {
        voice.settle?.({ elapsed: e.elapsed, tier: e.tier, x: e.x, y: e.y });
        if (e.tier >= 3) {
          if (voice.ceremony) voice.ceremony({ elapsed: e.elapsed, x: e.x, y: e.y });
          else if (!voice.settle) answer(0.85, 0.95);
        }
      }
    },

    drag: (e) => {
      contact();
      if (e.fingers >= 3) {
        if (voice.wind) voice.wind({ dx: e.dx, dy: e.dy });
        else if (e.phase === "start") answer(0.35, 0.8);
        return;
      }
      if (voice.drag) voice.drag(e);
      else if (e.phase === "start") answer(0.2, 0.4);
    },

    flick: (e) => {
      contact();
      if (voice.flick) voice.flick(e);
      else answer(clamp01(e.speed / 3), 0.3);
    },

    scrub: (e) => {
      contact();
      if (voice.stir) voice.stir(e);
      else answer(clamp01(Math.abs(e.winding)), 0.35);
    },

    span: (e) => {
      contact();
      if (voice.sustain) {
        voice.sustain(e);
        return;
      }
      // Acknowledge the interval opening and closing, never every tick —
      // an 80ms chirp train is a rattle, not a sustained chord.
      if (e.phase === "enter") answer(0.3, 0.65);
      else if (e.phase === "release") answer(0.2 + clamp01(e.elapsed / 4000) * 0.25, 0.8);
    },

    twist: (e) => {
      contact();
      if (e.fingers >= 3) {
        if (voice.season) voice.season({ angle: e.angle, velocity: e.velocity });
        else if (e.phase === "start") answer(0.4, 0.85);
        return;
      }
      if (voice.lens) voice.lens({ angle: e.angle, velocity: e.velocity });
      else if (e.phase === "start") answer(0.3, 0.6);
    },

    rhythm: (e) => {
      if (voice.rhythm) voice.rhythm(e);
      else if (e.stability > 0.7) answer(0.3 + e.stability * 0.2, 0.4);
    },

    drum: (e) => {
      contact();
      if (voice.drum) voice.drum({ hits: e.hits, alternation: e.alternation, x: e.x, y: e.y });
      else answer(0.35 + clamp01(e.alternation) * 0.35, 0.25);
    },

    arpeggio: (e) => {
      contact();
      if (voice.arpeggio) voice.arpeggio(e);
      else answer(clamp01(e.fingers / 3), 0.3);
    },

    shake: (e) => {
      if (voice.scatter) voice.scatter(e);
      else answer(clamp01(e.intensity), 0.55);
    },

    tilt: (e) => {
      if (voice.gravity) voice.gravity(e);
      // No acknowledgement: tilt is continuous and ambient — sounding every
      // sample would be a rattle, not an answer. A room that ignores gravity
      // is caught by the enforcement check, not by a chirp.
    },

    knock: (e) => {
      if (voice.knock) voice.knock(e);
      else answer(0.5 + clamp01(e.intensity) * 0.4, 0.9);
    },

    flip: (e) => {
      if (voice.night) voice.night(e);
      else answer(0.3, 1);
    },

    breath: (e) => {
      if (voice.breath) voice.breath(e);
      else answer(clamp01(e.strength), 0.15);
    },
  };

  // Pinch and pan2 belong to ScaleTravel on axis rooms — binding them here is
  // exactly the collision the grammar warns about. A room that owns its own
  // zoom passes travelOwnsFrame: false and binds them itself.
  if (!travelOwnsFrame) {
    handlers.pinch = (e) => {
      contact();
      if (e.phase === "start") answer(0.25, 0.5);
    };
  }

  return handlers;
}
