/**
 * NativeChrome — the minimal safe-area chrome shared by every native
 * cosmogony scene.
 *
 * The persistent `<ObjetUniverseView>` renders below the entire chrome
 * layer; `NativeChrome` never paints over the active material. It provides
 * the sought affordances (fold, trail, `?`) in the safe-area corners and
 * a sought guide destination (with the earlier sheet retained as a fallback)
 * — all volunteered, never auto-opened. There is no tab bar, no first-launch
 * modal, no coach mark, no HUD.
 *
 * An affordance appears only when it leads somewhere. `fold` and `trail`
 * belong to lanes that have not landed, and a chip that answers a press with
 * nothing is friction wearing the costume of a feature: until a route hands
 * this component a handler for one, it does not draw it. The `?` is always
 * here, because the guide always is.
 *
 * Reduced-motion is respected via a passed prop (the app-level reduced-motion
 * listener is expected to feed this component); typography scales with
 * Dynamic Type and the affordances stay 44 pt so the material is never
 * covered by the chrome.
 *
 * See `docs/native/art-direction.md` §9 for the reviewer prose.
 */

import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeSceneId } from "@objet/universe-contracts";
import {
  MIN_TOUCH_TARGET,
  MOTION,
  PALETTE,
  SPACING,
  TYPOGRAPHY,
  Z_ORDER,
  motionDurationMs,
} from "./tokens";
import { sceneStyle } from "./sceneStyle";
import { GuideSheet } from "../guide/GuideSheet";
import { GUIDE_ENTRIES_BY_VERB, type GuideEntry, type GuideVerb } from "../guide/guideData";
import { EMPTY_REVEAL, type SceneReveal } from "../guide/reveal";

/**
 * The reveal state — which phenomena the visitor has *caused* — is the guide's
 * gate, and its law lives with the guide in `../guide/reveal.ts`. The chrome
 * only reads it.
 */
export type { SceneReveal };

export type NativeChromeProps = Readonly<{
  scene: NativeSceneId;
  reveal: SceneReveal;
  reducedMotion?: boolean;
  onOpenFold?: () => void;
  onOpenTrail?: () => void;
  onOpenGuide?: (reason: "direct-seeking" | "accessibility") => void;
  /**
   * Announces the guide sheet opening and closing. The route closes the
   * touch surface while it is open — the documented state contract pauses
   * authoritative intervention while a reading surface has focus.
   */
  onGuideVisibilityChange?: (open: boolean) => void;
}>;

export function NativeChrome({
  scene,
  reveal = EMPTY_REVEAL,
  reducedMotion = false,
  onOpenFold,
  onOpenTrail,
  onOpenGuide,
  onGuideVisibilityChange,
}: NativeChromeProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const style = sceneStyle(scene);
  const openMs = motionDurationMs(MOTION.guideOpenMs, reducedMotion);

  const revealedEntries = useMemo<readonly GuideEntry[]>(() => {
    const caused = new Set<GuideVerb>(reveal.causedVerbs);
    return Object.values(GUIDE_ENTRIES_BY_VERB).filter((entry) => caused.has(entry.verb));
  }, [reveal.causedVerbs]);

  const openGuide = useCallback(() => {
    if (onOpenGuide) {
      onOpenGuide("direct-seeking");
      return;
    }
    setGuideOpen(true);
    onGuideVisibilityChange?.(true);
  }, [onGuideVisibilityChange, onOpenGuide]);
  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    onGuideVisibilityChange?.(false);
  }, [onGuideVisibilityChange]);

  return (
    <View
      pointerEvents="box-none"
      style={styles.host}
      accessibilityLabel={`Cosmogony chrome for the ${scene} scene`}
    >
      <SafeAreaView pointerEvents="box-none" style={styles.safe} edges={SAFE_EDGES}>
        <View pointerEvents="box-none" style={styles.topRow}>
          {onOpenFold ? (
            <ChromeAffordance
              label="fold"
              accessibilityLabel="Open the scale fold"
              onPress={onOpenFold}
              variant="leading"
            />
          ) : (
            <View />
          )}
          {onOpenTrail ? (
            <ChromeAffordance
              label="trail"
              accessibilityLabel="Open your trail of kept readings"
              onPress={onOpenTrail}
              variant="trailing"
            />
          ) : (
            <View />
          )}
        </View>
        <View pointerEvents="box-none" style={styles.bottomRow}>
          <View />
          <ChromeAffordance
            label="?"
            accessibilityLabel={`Open the ${scene} scene guide`}
            onPress={openGuide}
            accessibilityActionLabel="Open the guide as an accessibility action"
            onAccessibilityPress={() => {
              if (onOpenGuide) onOpenGuide("accessibility");
              else openGuide();
            }}
            variant="trailing"
          />
        </View>
      </SafeAreaView>
      {guideOpen ? (
        <GuideSheet
          scene={scene}
          sceneField={style.field}
          reveal={reveal}
          revealedEntries={revealedEntries}
          reducedMotion={reducedMotion}
          openDurationMs={openMs}
          onClose={closeGuide}
        />
      ) : null}
    </View>
  );
}

const SAFE_EDGES: ReadonlyArray<"top" | "left" | "right" | "bottom"> = ["top", "left", "right", "bottom"];

type AffordanceVariant = "leading" | "trailing";

function ChromeAffordance({
  label,
  accessibilityLabel,
  onPress,
  accessibilityActionLabel,
  onAccessibilityPress,
  variant,
}: Readonly<{
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  accessibilityActionLabel?: string;
  onAccessibilityPress?: () => void;
  variant: AffordanceVariant;
}>) {
  const align: ViewStyle = { alignSelf: variant === "leading" ? "flex-start" : "flex-end" };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={accessibilityActionLabel ? [{ name: "open-guide", label: accessibilityActionLabel }] : undefined}
      onAccessibilityAction={onAccessibilityPress ? ({ nativeEvent }) => {
        if (nativeEvent.actionName === "open-guide") onAccessibilityPress();
      } : undefined}
      onPress={onPress}
      hitSlop={SPACING.small}
      style={({ pressed }) => [styles.affordance, align, pressed ? styles.affordancePressed : null]}
    >
      <Text
        style={styles.affordanceLabel}
        allowFontScaling
        maxFontSizeMultiplier={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Given the current safe-area insets, decide how much padding the chrome
 * borrows from them so it never covers the material's central band. Exposed
 * for the layout host and for the U7 tests that verify the chrome does not
 * intrude on the middle 60% of the frame.
 */
export function chromeInsets(insets: EdgeInsets): EdgeInsets {
  return {
    top: Math.max(insets.top, SPACING.small),
    left: Math.max(insets.left, SPACING.small),
    right: Math.max(insets.right, SPACING.small),
    bottom: Math.max(insets.bottom, SPACING.small),
  };
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    zIndex: Z_ORDER.chrome,
  },
  safe: {
    flex: 1,
    justifyContent: "space-between",
    backgroundColor: "transparent",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: SPACING.medium,
    paddingTop: SPACING.small,
  },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: SPACING.medium,
    paddingBottom: SPACING.small,
  },
  affordance: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.small,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: PALETTE.night.veil,
    borderRadius: MIN_TOUCH_TARGET / 2,
  },
  affordancePressed: {
    backgroundColor: PALETTE.night.dark,
  },
  affordanceLabel: {
    color: PALETTE.ink.plain,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.title,
    fontWeight: TYPOGRAPHY.system.weight,
  },
});
