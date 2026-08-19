/**
 * Native cosmogony design tokens.
 *
 * These are the *shared* perceptual constants the three Release 1 scenes
 * (wave, cell, solar) read before painting any pixel or scheduling any
 * motion. They intentionally live in the native app — the settled machine
 * schema lives in `@objet/universe-contracts`, and the perceptual axis
 * (`stateToSense`, `gestureFeedback`, `bannedForms`) is enforced there. The
 * tokens here are the *values* the shell chrome and the guide sheet use
 * without inventing their own palette or motion units.
 *
 * No React and no react-native imports live in this file; it must remain
 * plain TypeScript so the scene tokens and reduced-motion equivalents can
 * be exercised by `node --experimental-strip-types` without a renderer.
 *
 * See `docs/native/art-direction.md` §3, §4, §5 for the reviewer prose.
 */

export const NATIVE_DESIGN_TOKENS_VERSION = 1 as const;

/**
 * Palette. The three scenes share the same three-family palette — `night` is
 * the ground, `sea` is the coherent medium, `ember` is the decisive event.
 * A scene may quote a cool or warm accent from those families; it may not
 * introduce a fifth family. Colours are stated as sRGB hex, with a docstring
 * naming the causal role rather than the aesthetic feeling.
 */
export const PALETTE = Object.freeze({
  /** the ground state: the field before a hand causes anything. */
  night: {
    deep: "#050914",
    dark: "#0B1220",
    veil: "#141C2E",
  },
  /** the coherent medium: how a wave, membrane, or orbit reads at rest. */
  sea: {
    deep: "#0E2A44",
    still: "#1E4E7A",
    lit: "#3A88C1",
    glimmer: "#8BC2E5",
  },
  /** the decisive event: what an authoritative commit looks like. */
  ember: {
    warm: "#E7A34C",
    hot: "#F0793E",
    strike: "#F5443B",
  },
  /** notation ink for the guide sheet. */
  ink: {
    plain: "#E9E6DF",
    quiet: "#B8B5AE",
    faint: "#75726C",
  },
});

export type PaletteFamily = keyof typeof PALETTE;

/**
 * Typography. Three registers only. The system register is for chrome; the
 * editorial register is for the post-discovery reveal; the notation register
 * is for scientific notation inside the guide. Font family strings resolve
 * against the platform fallbacks — U7 does not bundle new type.
 *
 * Sizes are declared in points; the guide sheet still respects Dynamic Type
 * multipliers on top of these bases. Accessibility multipliers apply
 * multiplicatively without clipping the material.
 */
export const TYPOGRAPHY = Object.freeze({
  system: {
    family: "System",
    weight: "400" as const,
    sizes: { caption: 12, body: 15, title: 20 },
    tracking: 0,
  },
  editorial: {
    family: "Georgia",
    weight: "400" as const,
    sizes: { caption: 14, body: 18, title: 26 },
    tracking: 0.1,
  },
  notation: {
    family: "Menlo",
    weight: "400" as const,
    sizes: { caption: 11, body: 13, title: 15 },
    tracking: 0,
  },
});

export type TypographyRegister = keyof typeof TYPOGRAPHY;

/**
 * Spacing rhythm. The chrome and the guide sheet compose on a shared
 * 4-point grid; safe-area affordances land on the 8 and 12 pt rungs so a
 * touch target reaches the 44 pt Apple minimum.
 */
export const SPACING = Object.freeze({
  tick: 4,
  small: 8,
  medium: 12,
  large: 16,
  section: 24,
  gutter: 32,
});

/** Minimum touch target in points; matches Apple HIG. */
export const MIN_TOUCH_TARGET = 44 as const;

/**
 * Motion. Durations are milliseconds; every one has a reduced-motion
 * equivalent that either quantises to a detent or holds still, while
 * preserving the sensory information a hand needs.
 *
 * `reducedFactor` is the multiplier applied to any non-hold motion path when
 * `prefers-reduced-motion` is on; a factor of 0 means "hold the value and
 * announce the state change through audio+haptic instead of an animation".
 */
export const MOTION = Object.freeze({
  /** the ambient breath a scene draws when nothing is happening (see AGENTS.md §"alive at rest"). */
  breathMs: 7000,
  /** the idle window after which a scene begins to glimmer. */
  idleGlimmerMs: 20000,
  /** the frame budget for a two-sense answer (see AGENTS.md §"two senses in the same frame"). */
  twoSenseAnswerMs: 16,
  /** guide-sheet slide-in duration. */
  guideOpenMs: 240,
  /** dwell threshold shared with `gesture/core.ts`; the site's site-wide grow tier. */
  dwellPlantMs: 540,
  /** ceremony hold: the room's one solemn act. */
  ceremonyMs: 2400,
  /** reduced-motion multiplier on non-hold durations. */
  reducedFactor: 0,
});

/**
 * Reduced-motion mapping. Given the ambient key, this returns the
 * equivalent instruction under `prefers-reduced-motion`. The rule: preserve
 * hierarchy, state, and scientific result; replace oscillation with a
 * quantised detent, and never suppress the two-sense answer.
 */
export const REDUCED_MOTION_EQUIVALENTS = Object.freeze({
  breath: "hold-still-with-audio-tick",
  idleGlimmer: "hold-still-with-caption",
  guideOpen: "no-slide-hold-in-place",
  wavePropagation: "detented-amplitude-with-tone",
  cellDivision: "step-change-with-pulse",
  solarPrecession: "hold-with-detent-tick",
});

/** Semantic z-order for the shell — chrome above material, guide above chrome. */
export const Z_ORDER = Object.freeze({
  material: 0,
  chromeShadow: 5,
  chrome: 10,
  guideBackdrop: 20,
  guideSheet: 21,
});

/**
 * Threshold typography — the launch route stays edge-to-edge black on
 * purpose (the `native:test-workspace` assertion pins it), while the
 * accessibility ink used for its label lives here so the shell has one
 * shared value to read. Do not use `THRESHOLD.background` on any scene
 * surface: `#000000` is the launch-only ground.
 */
export const THRESHOLD = Object.freeze({
  background: "#000000",
  accessibilityInk: PALETTE.ink.plain,
});

/**
 * A tiny helper used by the shell and the guide sheet to attenuate a
 * duration under reduced motion without special-casing the caller.
 */
export function motionDurationMs(baseMs: number, reducedMotion: boolean): number {
  if (baseMs < 0) return 0;
  if (!reducedMotion) return baseMs;
  return Math.round(baseMs * MOTION.reducedFactor);
}
