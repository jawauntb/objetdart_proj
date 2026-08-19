/**
 * Native scene style — the one source of truth for the perceptual axis of
 * every Release 1 scene, re-exported from the settled contract.
 *
 * The scene briefs (wave, cell, solar) live in
 * `packages/universe-contracts/src/manifest.ts` and are frozen at U2.
 * This module wraps `RELEASE_SCENE_MANIFEST[i].style` so that the native
 * app never invents a second copy of a scene's palette, forms, motion, or
 * sensory mapping. `validateSceneStyle` remains the gate; every brief we
 * expose passes it or the test suite fails.
 *
 * See `docs/native/art-direction.md` §7 for the reviewer prose that stands
 * behind each brief.
 */

import {
  RELEASE_SCENE_MANIFEST,
  validateSceneStyle,
  type ContractValidation,
  type NativeSceneId,
  type SceneStyle,
} from "@objet/universe-contracts";

export type NativeSceneStyle = SceneStyle;

/**
 * The three scene briefs, keyed by scene id. Consumers must read from this
 * map (or the ordered array below) rather than restating the values. Every
 * value is `Object.freeze`d to make accidental mutation loud.
 */
export const SCENE_STYLES: Readonly<Record<NativeSceneId, NativeSceneStyle>> = Object.freeze(
  RELEASE_SCENE_MANIFEST.reduce<Record<NativeSceneId, NativeSceneStyle>>((acc, scene) => {
    acc[scene.id] = Object.freeze(scene.style) as NativeSceneStyle;
    return acc;
  }, {} as Record<NativeSceneId, NativeSceneStyle>),
);

/** The three scene briefs in the settled release order. */
export const SCENE_STYLE_LIST: readonly NativeSceneStyle[] = Object.freeze(
  RELEASE_SCENE_MANIFEST.map((scene) => SCENE_STYLES[scene.id]),
);

/** Ids of the three Release 1 scenes, in the settled release order. */
export const NATIVE_SCENE_IDS: readonly NativeSceneId[] = Object.freeze(
  RELEASE_SCENE_MANIFEST.map((scene) => scene.id),
);

/**
 * Fetch a scene's style, or throw if the caller asked for a scene id that
 * the release manifest does not know about. A throw beats a silent fallback
 * — a missing scene would otherwise land as a blank field with no diagnostic.
 */
export function sceneStyle(id: NativeSceneId): NativeSceneStyle {
  const style = SCENE_STYLES[id];
  if (!style) {
    throw new Error(`sceneStyle: unknown scene id "${id}"`);
  }
  return style;
}

/**
 * Validate a brief. Every brief we ship must pass; the test suite calls
 * this against every entry in `SCENE_STYLES` and every entry in
 * `RELEASE_SCENE_MANIFEST[i].style` — a drift between the two is a defect.
 */
export function validateNativeSceneStyle(style: NativeSceneStyle): ContractValidation {
  return validateSceneStyle(style);
}

/**
 * A brief summary the reviewer checklist can print. Not a second source of
 * truth: this pulls its values from the settled brief and formats them.
 */
export function summariseSceneStyle(style: NativeSceneStyle): {
  id: string;
  composition: string;
  material: readonly string[];
  motion: string;
  sensoryStates: readonly string[];
  bannedForms: readonly string[];
} {
  return {
    id: style.id,
    composition: style.field,
    material: style.forms,
    motion: style.motion,
    sensoryStates: style.stateToSense.map((mapping) => mapping.state),
    bannedForms: style.bannedForms,
  };
}
