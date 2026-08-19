/**
 * U5 — VoiceOver / assistive labels for every native semantic action.
 *
 * VoiceOver names an action by the label its rotor speaks. The map here binds
 * each site-wide grammar verb to that label AND to the exact gesture shape
 * the router would build if the same intent had been expressed with a touch.
 * The accessibility layer uses this mapping to guarantee that a rotor
 * activation and a physical gesture produce the SAME `VersionedAction`
 * payload (test scenario 4 in the U5 plan).
 *
 * Labels are deliberately verb-forward and describe intent, never a finger
 * shape — "Step back one frame" reads sensibly through the rotor, "Two-finger
 * tap" does not.
 */

import type { ActionSource } from "@objet/universe-contracts";
import {
  commandFromShape,
  type NativeGestureShape,
  type NativeGrammarVerb,
  type NativeSemanticCommand,
} from "../universe/actions.ts";

export type UniverseActionLabel = Readonly<{
  grammarVerb: NativeGrammarVerb;
  label: string;
  hint: string;
  /**
   * The gesture shape a VoiceOver activation must equate to. Router uses this
   * to emit a semantic command indistinguishable from the touch equivalent.
   */
  equivalentShape: NativeGestureShape;
}>;

/**
 * A conservative synthetic centre point — accessibility events do not carry
 * screen coordinates, and the semantic contract needs concrete numbers.
 * Universes read intent, not the pixel: this constant makes the assistive
 * payload deterministic across runs and platforms.
 */
export const ACCESSIBILITY_SYNTHETIC_POINT = Object.freeze({ x: 0, y: 0 });

export const UNIVERSE_ACTION_LABELS: readonly UniverseActionLabel[] = Object.freeze([
  Object.freeze({
    grammarVerb: "tap",
    label: "Touch the material",
    hint: "One soft touch — the room answers under your finger.",
    equivalentShape: Object.freeze({
      kind: "tap",
      fingers: 1,
      count: 1,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
      intensity: 0.5,
    }),
  }),
  Object.freeze({
    grammarVerb: "tap2",
    label: "Step back one frame",
    hint: "The frame retreats one step.",
    equivalentShape: Object.freeze({
      kind: "tap",
      fingers: 2,
      count: 1,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
      intensity: 0.5,
    }),
  }),
  Object.freeze({
    grammarVerb: "tap3",
    label: "Tutti — the whole room answers",
    hint: "Everything alive responds softly at once.",
    equivalentShape: Object.freeze({
      kind: "tap",
      fingers: 3,
      count: 1,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
      intensity: 0.5,
    }),
  }),
  Object.freeze({
    grammarVerb: "holdDwell",
    label: "Plant and grow",
    hint: "Deepens for as long as you hold.",
    equivalentShape: Object.freeze({
      kind: "hold",
      fingers: 1,
      elapsedMs: 900,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
      intensity: 0.5,
    }),
  }),
  Object.freeze({
    grammarVerb: "holdCeremony",
    label: "Ceremony",
    hint: "The room's one solemn act.",
    equivalentShape: Object.freeze({
      kind: "hold",
      fingers: 1,
      elapsedMs: 2500,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
      intensity: 0.6,
    }),
  }),
  Object.freeze({
    grammarVerb: "hold3",
    label: "Dilate time",
    hint: "Slows the room's clock while held.",
    equivalentShape: Object.freeze({
      kind: "hold",
      fingers: 3,
      elapsedMs: 900,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
      intensity: 0.5,
    }),
  }),
  Object.freeze({
    grammarVerb: "drag",
    label: "Stroke the material",
    hint: "A single continuous motion across the surface.",
    equivalentShape: Object.freeze({
      kind: "drag",
      fingers: 1,
      dx: 32,
      dy: 0,
      vx: 0.4,
      vy: 0,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
    }),
  }),
  Object.freeze({
    grammarVerb: "drag3",
    label: "Weather across the world",
    hint: "Three-finger wind that reshapes the atmosphere.",
    equivalentShape: Object.freeze({
      kind: "drag",
      fingers: 3,
      dx: 48,
      dy: 0,
      vx: 0.6,
      vy: 0,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
    }),
  }),
  Object.freeze({
    grammarVerb: "flick",
    label: "Flick",
    hint: "A quick throw — dismiss or skip.",
    equivalentShape: Object.freeze({
      kind: "flick",
      fingers: 1,
      speed: 1.2,
      angle: 0,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
    }),
  }),
  Object.freeze({
    grammarVerb: "scrub",
    label: "Stir the field",
    hint: "A circling motion, any finger count.",
    equivalentShape: Object.freeze({
      kind: "scrub",
      winding: 0.75,
      angularVelocity: 3.14,
      cx: ACCESSIBILITY_SYNTHETIC_POINT.x,
      cy: ACCESSIBILITY_SYNTHETIC_POINT.y,
    }),
  }),
  Object.freeze({
    grammarVerb: "span",
    label: "Sustain the interval",
    hint: "Two fingers held apart, opening a sustained note.",
    equivalentShape: Object.freeze({
      kind: "span",
      phase: "enter",
      spread: 96,
      elapsedMs: 350,
      cx: ACCESSIBILITY_SYNTHETIC_POINT.x,
      cy: ACCESSIBILITY_SYNTHETIC_POINT.y,
    }),
  }),
  Object.freeze({
    grammarVerb: "twist",
    label: "Rotate the lens",
    hint: "Change the level of description at fixed scale.",
    equivalentShape: Object.freeze({
      kind: "twist",
      fingers: 2,
      angleRad: 0.3,
      velocity: 1.4,
    }),
  }),
  Object.freeze({
    grammarVerb: "twist3",
    label: "Advance the season",
    hint: "Three-finger rotation moves the room forward through its year.",
    equivalentShape: Object.freeze({
      kind: "twist",
      fingers: 3,
      angleRad: 0.6,
      velocity: 1.4,
    }),
  }),
  Object.freeze({
    grammarVerb: "rhythm",
    label: "Set the tempo",
    hint: "Entrain the room's clock to the hand's pulse.",
    equivalentShape: Object.freeze({
      kind: "tap",
      fingers: 1,
      count: 5,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
      intensity: 0.5,
    }),
  }),
  Object.freeze({
    grammarVerb: "drum",
    label: "Drum between two hands",
    hint: "Two zones alternating — a percussion between them.",
    equivalentShape: Object.freeze({
      kind: "tap",
      fingers: 2,
      count: 3,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
      intensity: 0.6,
    }),
  }),
  Object.freeze({
    grammarVerb: "arpeggio",
    label: "Arpeggio",
    hint: "A staggered chord — the roll is narrated in order.",
    equivalentShape: Object.freeze({
      kind: "tap",
      fingers: 3,
      count: 1,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
      intensity: 0.55,
    }),
  }),
  Object.freeze({
    grammarVerb: "shake",
    label: "Agitate the vessel",
    hint: "A shake of the whole device scatters the material.",
    equivalentShape: Object.freeze({
      kind: "shake",
      intensity: 0.7,
    }),
  }),
  Object.freeze({
    grammarVerb: "tilt",
    label: "Lean the world",
    hint: "Tilt the vessel to shift gravity.",
    equivalentShape: Object.freeze({
      kind: "tilt",
      beta: 15,
      gamma: 0,
    }),
  }),
  Object.freeze({
    grammarVerb: "knock",
    label: "Wake the room",
    hint: "A single sharp rap on the vessel.",
    equivalentShape: Object.freeze({
      kind: "knock",
      intensity: 0.8,
    }),
  }),
  Object.freeze({
    grammarVerb: "flip",
    label: "Turn night",
    hint: "Face-down brings night.",
    equivalentShape: Object.freeze({
      kind: "flip",
      faceDown: true,
    }),
  }),
  Object.freeze({
    grammarVerb: "breath",
    label: "Breath",
    hint: "A slow breath across the surface — the candle listens.",
    equivalentShape: Object.freeze({
      kind: "breath",
      strength: 0.5,
    }),
  }),
  Object.freeze({
    grammarVerb: "pinch",
    label: "Zoom",
    hint: "Change the frame's scale.",
    equivalentShape: Object.freeze({
      kind: "pinch",
      scale: 1.25,
      velocity: 0.8,
    }),
  }),
  Object.freeze({
    grammarVerb: "pan2",
    label: "Pan the frame",
    hint: "Two-finger drag moves the frame.",
    equivalentShape: Object.freeze({
      kind: "drag",
      fingers: 2,
      dx: 32,
      dy: 0,
      vx: 0.4,
      vy: 0,
      x: ACCESSIBILITY_SYNTHETIC_POINT.x,
      y: ACCESSIBILITY_SYNTHETIC_POINT.y,
    }),
  }),
]);

/**
 * Keyboard shortcut suggestions — bound the same way as VoiceOver actions.
 * The router keeps them optional (external keyboard is a permission-free
 * augmentation, never a requirement).
 */
/**
 * Pure helper the React component and the accessibility test share. Builds
 * the (label, semantic-command) tuples the rotor will surface. Keeping this
 * outside `UniverseActions.tsx` lets the test file run under
 * `node --experimental-strip-types` (which does not transform JSX).
 */
let assistiveCounter = 0;

export function defaultAssistiveId(verb: NativeGrammarVerb): string {
  assistiveCounter += 1;
  return `assistive:${verb}:${assistiveCounter}`;
}

export function buildAssistiveCommands(input: Readonly<{
  source: ActionSource;
  logicalTime: number;
  labels?: readonly UniverseActionLabel[];
  advertisedVerbs?: readonly NativeGrammarVerb[];
  makeActionId?: (verb: NativeGrammarVerb) => string;
}>): readonly Readonly<{ label: UniverseActionLabel; command: NativeSemanticCommand }>[] {
  const labels = input.labels ?? UNIVERSE_ACTION_LABELS;
  const advertise = input.advertisedVerbs;
  const filtered = advertise
    ? labels.filter((entry) => advertise.includes(entry.grammarVerb))
    : labels;
  const makeId = input.makeActionId ?? defaultAssistiveId;
  return Object.freeze(
    filtered.map((entry) =>
      Object.freeze({
        label: entry,
        command: commandFromShape({
          id: makeId(entry.grammarVerb),
          logicalTime: input.logicalTime,
          source: input.source,
          shape: entry.equivalentShape,
        }),
      }),
    ),
  );
}

export const UNIVERSE_KEYBOARD_SHORTCUTS: readonly Readonly<{ grammarVerb: NativeGrammarVerb; input: string; modifierFlags: readonly string[] }>[] = Object.freeze([
  Object.freeze({ grammarVerb: "tap",         input: "T", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "tap2",        input: "B", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "tap3",        input: "R", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "holdDwell",   input: "H", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "hold3",       input: "H", modifierFlags: Object.freeze(["shift"]) }),
  Object.freeze({ grammarVerb: "flick",       input: "F", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "twist",       input: "L", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "twist3",      input: "S", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "pinch",       input: "=", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "shake",       input: "A", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "knock",       input: "K", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "flip",        input: "N", modifierFlags: Object.freeze([]) }),
  Object.freeze({ grammarVerb: "breath",      input: "W", modifierFlags: Object.freeze([]) }),
]);
