import { requireNativeViewManager } from "expo-modules-core";
import type { ComponentType } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { ActionLayer, ActionSource, SemanticVerb } from "@objet/universe-contracts";
import type { NativeGrammarVerb } from "../../../src/universe/actions.ts";

/**
 * One committed gesture, as the universe recorded it.
 *
 * `answered` is the only field a route is expected to branch on: it says the
 * active medium expressed the verb in its own material, rather than only in
 * the hand and the ear. The guide shows an entry once its phenomenon has
 * landed, so this is what unlocks it — nothing here is a render instruction,
 * and the material never round-trips through JavaScript.
 */
export type SurfaceCommand = Readonly<{
  verb: NativeGrammarVerb;
  semanticVerb: SemanticVerb;
  layer: ActionLayer;
  source: ActionSource;
  intensity: number;
  answered: boolean;
}>;

export type ObjetUniverseSurfaceProps = {
  style?: StyleProp<ViewStyle>;
  /**
   * Whether contact reaches the universe at all. The route closes the surface
   * while a reading surface is open: the state contract pauses authoritative
   * intervention while the visitor is reading, and a press that survived the
   * sheet opening would keep charging the water behind it.
   */
  enabled?: boolean;
  /** Current wave lens detent: surface, equation, spectrum, or felt. */
  representation?: 0 | 1 | 2 | 3;
  onSemanticCommand?: (event: { nativeEvent: SurfaceCommand }) => void;
};

/**
 * The transparent native surface a route mounts over the persistent universe.
 *
 * It exists because UIKit hit-tests the topmost view at a point: every
 * navigator screen above the universe answers first, even when it is fully
 * transparent, so recognisers attached to the universe view itself would
 * never see a finger. This view holds them instead, draws nothing, and
 * reaches the kernel only through the native `UniverseRuntime`.
 */
export const ObjetUniverseSurface = requireNativeViewManager<ObjetUniverseSurfaceProps>(
  "ObjetUniverse",
  "ObjetUniverseSurface",
) as ComponentType<ObjetUniverseSurfaceProps>;
