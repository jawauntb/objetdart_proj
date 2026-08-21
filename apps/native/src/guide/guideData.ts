/**
 * Native guide data — one entry per site-wide gesture verb.
 *
 * The native cosmogony inherits the web's grammar: the twenty-three verbs
 * declared in `src/lib/gesture/defaults.ts` (`GLOBAL_VERBS`) are the shared
 * vocabulary. The guide data below is the *one* native surface where those
 * verbs are named in plain wording and notation, and is what the `?` and
 * `GuideSheet` read. `guideData.test.ts` asserts 1:1 coverage against the
 * web verb list and refuses wording duplication.
 *
 * Every entry carries:
 *
 * - `verb`      — the gesture verb (matches the web `GlobalVerb` id).
 * - `plain`     — the stranger-friendly wording. Two of the three registers
 *                 (devotional / operational / oceanic), lowercase, no
 *                 marketing verbs, no emoji (AGENTS.md voice rule).
 * - `notation`  — the operational notation a returning visitor recognises,
 *                 including scientific units where the phenomenon has one.
 * - `layer`     — the finger-count layer: material (1) / representation (2)
 *                 / world-law (3) / vessel / chrome (see gesture-grammar.md).
 * - `semantic`  — the settled `SemanticVerb` the gesture emits into the
 *                 universe writer, or `null` when the verb is handled by the
 *                 shell (pinch, pan2) or is deferred until a later unit.
 * - `reveal`    — the Play/Reveal/Name/Transfer/Express step this verb
 *                 unlocks in the choreography (see art-direction.md §8).
 * - `sceneNotes` — per-scene material meaning; the guide reads only the
 *                 note for the active scene so the visitor sees the phrase
 *                 for the world they are already inside.
 * - `deferredReason` — if the native app cannot bind this verb in the
 *                     current unit, the deferral is *documented* here; the
 *                     test allows it but insists on a reason.
 *
 * Language never precedes material. The guide sheet gates every entry on
 * the scene reveal state; an entry whose phenomenon has not landed is
 * hidden until it does.
 */

import type { SemanticVerb } from "@objet/universe-contracts";

export const GUIDE_DATA_VERSION = 1 as const;

/** The site-wide gesture verbs. Mirrors `src/lib/gesture/defaults.ts` GLOBAL_VERBS. */
export const NATIVE_GUIDE_VERBS = [
  "tap",
  "tap2",
  "tap3",
  "holdDwell",
  "holdCeremony",
  "hold3",
  "drag",
  "drag3",
  "flick",
  "scrub",
  "span",
  "twist",
  "twist3",
  "rhythm",
  "drum",
  "arpeggio",
  "shake",
  "tilt",
  "knock",
  "flip",
  "breath",
  "pinch",
  "pan2",
] as const;

export type GuideVerb = (typeof NATIVE_GUIDE_VERBS)[number];

export type GuideLayer = "material" | "representation" | "world" | "vessel" | "chrome";

export type GuideRevealStep = "Play" | "Reveal" | "Name" | "Transfer" | "Express";

export type SceneNote = Readonly<{ wave: string; cell: string; solar: string }>;

export type GuideEntry = Readonly<{
  verb: GuideVerb;
  layer: GuideLayer;
  plain: string;
  notation: string;
  semantic: SemanticVerb | null;
  reveal: GuideRevealStep;
  sceneNotes: SceneNote;
  deferredReason?: string;
}>;

/**
 * The entries. Each `plain` sentence and each `notation` string is unique
 * across the table — the test asserts no duplication.
 */
const RAW_ENTRIES: readonly GuideEntry[] = [
  {
    verb: "tap",
    layer: "material",
    plain: "touch the material — a small strike lands as one bright pulse.",
    notation: "material: single-source impulse; amplitude scales with the strike energy.",
    semantic: "material",
    reveal: "Reveal",
    sceneNotes: {
      wave: "one tap seeds a coherent disturbance on the water field.",
      cell: "one tap perturbs the nutrient gradient under the fingertip.",
      solar: "one tap kicks a body into a new nearby state.",
    },
  },
  {
    verb: "tap2",
    layer: "representation",
    plain: "two fingers together step the frame back one rung.",
    notation: "representation: step-back — reduces the active representation by one detent.",
    semantic: "step-back",
    reveal: "Transfer",
    sceneNotes: {
      wave: "the spectral lens lowers, returning to the raw surface.",
      cell: "the lineage overlay retracts to the plain membrane.",
      solar: "the trajectory overlay steps back to bodies without arcs.",
    },
  },
  {
    verb: "tap3",
    layer: "world",
    plain: "three fingers together call everything alive to answer at once.",
    notation: "tutti: broadcast a soft two-sense pulse across every live object.",
    semantic: "tutti",
    reveal: "Express",
    sceneNotes: {
      wave: "every source point rings once in phase.",
      cell: "every membrane contracts softly in the same frame.",
      solar: "every body ticks its harmonic interval.",
    },
  },
  {
    verb: "holdDwell",
    layer: "material",
    plain: "press and stay — the room grows what your finger is over.",
    notation: "grow: a dwell that deepens with elapsed time, seeded from the touch point.",
    semantic: "grow",
    reveal: "Reveal",
    sceneNotes: {
      wave: "a source point charges, radiating with increasing amplitude.",
      cell: "a seed plants and begins to divide along its lineage.",
      solar: "a body accretes mass from the nearby disk.",
    },
  },
  {
    verb: "holdCeremony",
    layer: "material",
    plain: "keep pressing past the deep threshold to commit the room's solemn act.",
    notation: "ceremony: the top hold tier commits the scene's single decisive event.",
    semantic: "ceremony",
    reveal: "Express",
    sceneNotes: {
      wave: "the whole tank rings in phase with the point you held.",
      cell: "the colony's current lineage is committed as a named strain.",
      solar: "the current system is committed as a saved star.",
    },
  },
  {
    verb: "hold3",
    layer: "world",
    plain: "three fingers held together slow the room's clock while you hold.",
    notation: "time-dilation: reduces the authority tick rate for the held duration.",
    semantic: "time-dilation",
    reveal: "Transfer",
    sceneNotes: {
      wave: "wavefronts slow so phase relationships become legible.",
      cell: "division slows so lineage decisions become legible.",
      solar: "orbits slow so resonance becomes audible.",
    },
  },
  {
    verb: "drag",
    layer: "material",
    plain: "stroke the material — a slow drag draws a continuous line of state.",
    notation: "material: continuous impulse; a 20 Hz path recorded and applied at boundary.",
    semantic: "material",
    reveal: "Reveal",
    sceneNotes: {
      wave: "the drag becomes a moving source with a phase history.",
      cell: "the drag feeds nutrient along the path.",
      solar: "the drag imparts momentum to the nearest body.",
    },
  },
  {
    verb: "drag3",
    layer: "world",
    plain: "three fingers dragging together set the room's weather.",
    notation: "weather: bounded environmental drift applied to every live object.",
    semantic: "weather",
    reveal: "Transfer",
    sceneNotes: {
      wave: "a wind bends the coherent medium in a stated direction.",
      cell: "the environment shifts, nudging reaction-diffusion rates.",
      solar: "a gas drag decays orbital energy in the disk's frame.",
    },
  },
  {
    verb: "flick",
    layer: "material",
    plain: "a quick throw lets an object go where the hand pointed.",
    notation: "material: an impulse with declared angle and speed at release.",
    semantic: "material",
    reveal: "Express",
    sceneNotes: {
      wave: "the release lands as a last impulse, scaled by the speed the hand had.",
      cell: "a daughter cell is thrown out of the parent's neighbourhood.",
      solar: "a body is ejected with the hand's angular velocity.",
    },
  },
  {
    verb: "scrub",
    layer: "material",
    plain: "a circular stir with any finger count winds the material.",
    notation: "material: winding integral; angular velocity feeds the field.",
    semantic: "material",
    reveal: "Transfer",
    sceneNotes: {
      wave: "vorticity accumulates on the water field.",
      cell: "the environment mixes, homogenising the reaction field.",
      solar: "the disk gains angular momentum along the stir.",
    },
  },
  {
    verb: "span",
    layer: "material",
    plain: "two still fingers hold an interval open for as long as they stay.",
    notation: "material: sustain — spread and elapsed time are continuous inputs.",
    semantic: "material",
    reveal: "Transfer",
    sceneNotes: {
      wave: "an interval sustains a chord across two source points.",
      cell: "two cells are held apart, keeping their lineages distinct.",
      solar: "two bodies are held at a resonance ratio.",
    },
  },
  {
    verb: "twist",
    layer: "representation",
    plain: "a two-finger twist rotates the lens on the same scale.",
    notation: "lens: rotates the active representation without changing scale.",
    semantic: "lens",
    reveal: "Name",
    sceneNotes: {
      wave: "the twist opens the spectral ring — the Fourier reveal.",
      cell: "the twist opens the lineage overlay.",
      solar: "the twist opens the orbital-element overlay.",
    },
  },
  {
    verb: "twist3",
    layer: "world",
    plain: "a three-finger twist advances or rewinds the room's season.",
    notation: "season: advances the world-law's slow cycle by one detent.",
    semantic: "season",
    reveal: "Transfer",
    sceneNotes: {
      wave: "the medium's damping cycle steps forward.",
      cell: "the colony's day/night cycle steps forward.",
      solar: "the system's precession phase steps forward.",
    },
  },
  {
    verb: "rhythm",
    layer: "material",
    plain: "repeat a steady beat and the room falls in with your tempo.",
    notation: "train: entrains the authority tick to a measured hand tempo.",
    semantic: "train",
    reveal: "Transfer",
    sceneNotes: {
      wave: "the source point pulses at the entrained tempo.",
      cell: "division cycles into synchrony with the beat.",
      solar: "the closest orbit locks its period to the beat.",
    },
  },
  {
    verb: "drum",
    layer: "material",
    plain: "alternate between two zones and the room reads it as percussion.",
    notation: "train: percussion; two-zone alternation index feeds tempo and stress.",
    semantic: "train",
    reveal: "Transfer",
    sceneNotes: {
      wave: "two source points are struck alternately, forming a beat pattern.",
      cell: "two colonies are fed alternately, staggering their divisions.",
      solar: "two bodies are perturbed alternately, forming a beat orbit.",
    },
  },
  {
    verb: "arpeggio",
    layer: "material",
    plain: "let several fingers land in a small roll — the room narrates the spread.",
    notation: "train: staggered chord; per-finger spreadMs indexes the roll.",
    semantic: "train",
    reveal: "Transfer",
    sceneNotes: {
      wave: "a staggered chord of source points forms an interference envelope.",
      cell: "several seeds plant in sequence, forming a lineage cluster.",
      solar: "several bodies drop in sequence, forming a resonance chain.",
    },
  },
  {
    verb: "shake",
    layer: "vessel",
    plain: "shake the device to scatter what is in the room.",
    notation: "agitate: bounded random perturbation seeded by the persisted universe seed.",
    semantic: "agitate",
    reveal: "Express",
    sceneNotes: {
      wave: "the field is jittered with a bounded seed-derived perturbation.",
      cell: "colonies are dispersed within their bounded neighbourhood.",
      solar: "bodies are given a bounded seed-derived kick.",
    },
  },
  {
    verb: "tilt",
    layer: "vessel",
    plain: "tilt the device and the room's gravity leans with you.",
    notation: "gravity: the world's gravity vector follows the device orientation.",
    semantic: "gravity",
    reveal: "Transfer",
    sceneNotes: {
      wave: "the water field's rest slope follows the device tilt.",
      cell: "nutrient settles along the tilt vector.",
      solar: "an ambient acceleration is added to every body.",
    },
  },
  {
    verb: "knock",
    layer: "vessel",
    plain: "knock on the device and the room wakes with a ring.",
    notation: "wake: a stated impulse at the vessel's origin.",
    semantic: "wake",
    reveal: "Reveal",
    sceneNotes: {
      wave: "one radial impulse rings the field.",
      cell: "the whole colony contracts once.",
      solar: "every body receives a small centred kick.",
    },
  },
  {
    verb: "flip",
    layer: "vessel",
    plain: "lay the device face-down for night — the room quiets and dims.",
    notation: "night: enters the quieted authority mode until the vessel is righted.",
    semantic: "night",
    reveal: "Transfer",
    sceneNotes: {
      wave: "the field damps to its rest amplitude.",
      cell: "colonies enter their slow phase.",
      solar: "orbits proceed at the reduced tick rate.",
    },
  },
  {
    verb: "breath",
    layer: "vessel",
    plain: "when the candle invites it, breath is a verb — the room answers it.",
    notation: "breath: the vessel's microphone envelope drives a stated response.",
    semantic: "breath",
    reveal: "Express",
    sceneNotes: {
      wave: "breath shapes the current source point's amplitude envelope.",
      cell: "breath modulates the nutrient supply rate.",
      solar: "breath modulates the ambient drag.",
    },
  },
  {
    verb: "pinch",
    layer: "chrome",
    plain: "pinch to zoom within the band; hold through the detent to travel to the next.",
    notation: "scale: pinch drives the axis chrome; a held detent commits scale-travel.",
    semantic: "scale",
    reveal: "Transfer",
    sceneNotes: {
      wave: "the water field's visible extent grows or shrinks with the pinch.",
      cell: "the colony's visible neighbourhood grows or shrinks with the pinch.",
      solar: "the orbital frame's visible radius grows or shrinks with the pinch.",
    },
  },
  {
    verb: "pan2",
    layer: "chrome",
    plain: "two-finger drag pans the frame across the world.",
    notation: "pan: the axis chrome translates the visible frame.",
    semantic: "pan",
    reveal: "Transfer",
    sceneNotes: {
      wave: "the visible slice of the field translates.",
      cell: "the visible neighbourhood translates.",
      solar: "the orbital frame's centre translates.",
    },
  },
];

/**
 * Index by verb. `Object.freeze` on the values makes accidental mutation
 * loud; the test asserts every entry in this map corresponds to exactly one
 * verb in `NATIVE_GUIDE_VERBS`.
 */
export const GUIDE_ENTRIES_BY_VERB: Readonly<Record<GuideVerb, GuideEntry>> = Object.freeze(
  RAW_ENTRIES.reduce<Record<GuideVerb, GuideEntry>>((acc, entry) => {
    acc[entry.verb] = Object.freeze(entry);
    return acc;
  }, {} as Record<GuideVerb, GuideEntry>),
);

export const GUIDE_ENTRIES: readonly GuideEntry[] = Object.freeze(RAW_ENTRIES);

/**
 * The Play/Reveal/Name/Transfer/Express choreography, in order. The guide
 * sheet reads this to decide which entries to show given the current scene
 * reveal state.
 */
export const REVEAL_STEPS: readonly GuideRevealStep[] = Object.freeze([
  "Play",
  "Reveal",
  "Name",
  "Transfer",
  "Express",
]);

/** All entries that unlock at a given reveal step. */
export function entriesForRevealStep(step: GuideRevealStep): readonly GuideEntry[] {
  return GUIDE_ENTRIES.filter((entry) => entry.reveal === step);
}
