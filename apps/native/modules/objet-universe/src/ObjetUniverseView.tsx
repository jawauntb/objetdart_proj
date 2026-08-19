import { requireNativeViewManager } from "expo-modules-core";
import type { ComponentType } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { NativeSceneId } from "@objet/universe-contracts";
import type {
  DiscoveryInvitation,
  IdleInvitation,
  NearMissInvitation,
  NativeSemanticCommand,
} from "../../../src/universe/actions.ts";

export type ObjetUniverseScene = NativeSceneId;

export type ObjetUniverseViewProps = {
  scene: ObjetUniverseScene;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /**
   * U5 semantic command sink. Every commit from the native GestureRouter
   * (touch, ordinary Pencil contact, keyboard, VoiceOver, device motion)
   * arrives here as a `VersionedAction`-shaped payload the caller can
   * append to the U4 durable log without further validation.
   */
  onSemanticCommand?: (command: NativeSemanticCommand) => void;
  /**
   * Idle discovery invitation the router surfaces after the surface has
   * stayed quiet past its private idle window (the number lives in
   * `actions.ts`, never in this prop shape). Overlay code is free to
   * ignore it — it must never fire as a generic tutorial.
   */
  onIdleInvitation?: (invitation: IdleInvitation) => void;
  /**
   * Near-miss discovery invitation: the router observed an ambiguous
   * chord landing that could have been a two- or three-finger gesture
   * and was withdrawn. Only fires after real behavior.
   */
  onNearMissInvitation?: (invitation: NearMissInvitation) => void;
};

export type { DiscoveryInvitation, IdleInvitation, NearMissInvitation, NativeSemanticCommand };

/**
 * The only persistent native surface. Screens above it are React overlays; they
 * cannot own or reset the active scientific kernel.
 */
export const ObjetUniverseView = requireNativeViewManager<ObjetUniverseViewProps>(
  "ObjetUniverse",
) as ComponentType<ObjetUniverseViewProps>;
