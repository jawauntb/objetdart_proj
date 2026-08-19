import { requireNativeViewManager } from "expo-modules-core";
import type { ComponentType } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { NativeSceneId } from "@objet/universe-contracts";

export type ObjetUniverseScene = NativeSceneId;

export type ObjetUniverseViewProps = {
  scene: ObjetUniverseScene;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * The only persistent native surface. Screens above it are React overlays; they
 * cannot own or reset the active scientific kernel.
 */
export const ObjetUniverseView = requireNativeViewManager<ObjetUniverseViewProps>(
  "ObjetUniverse",
) as ComponentType<ObjetUniverseViewProps>;
