/**
 * NativeChrome — the minimal safe-area chrome shared by every native
 * cosmogony scene.
 *
 * The persistent `<ObjetUniverseView>` renders below the entire chrome
 * layer; `NativeChrome` never paints over the active material. It provides
 * three sought affordances (fold, trail, `?`) in the safe-area corners and
 * a small guide sheet host — all volunteered, never auto-opened. There is
 * no tab bar, no first-launch modal, no coach mark, no HUD.
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

/**
 * The scene lanes push a small `SceneReveal` state up: which phenomena have
 * been *caused* by the visitor so far. The guide sheet uses it to gate the
 * Play/Reveal/Name/Transfer/Express choreography — a guide entry whose
 * phenomenon has not landed yet is hidden.
 */
export type SceneReveal = Readonly<{
  /** verbs whose phenomenon the visitor has caused at least once. */
  causedVerbs: readonly GuideVerb[];
  /** how many times the visitor has produced the primary phenomenon. */
  primaryReproductions: number;
  /** whether the visitor has committed an expressive act. */
  expressed: boolean;
}>;

export type NativeChromeProps = Readonly<{
  scene: NativeSceneId;
  reveal: SceneReveal;
  reducedMotion?: boolean;
  onOpenFold?: () => void;
  onOpenTrail?: () => void;
}>;

const EMPTY_REVEAL: SceneReveal = { causedVerbs: [], primaryReproductions: 0, expressed: false };

export function NativeChrome({ scene, reveal = EMPTY_REVEAL, reducedMotion = false, onOpenFold, onOpenTrail }: NativeChromeProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const style = sceneStyle(scene);
  const openMs = motionDurationMs(MOTION.guideOpenMs, reducedMotion);

  const revealedEntries = useMemo<readonly GuideEntry[]>(() => {
    const caused = new Set<GuideVerb>(reveal.causedVerbs);
    return Object.values(GUIDE_ENTRIES_BY_VERB).filter((entry) => caused.has(entry.verb));
  }, [reveal.causedVerbs]);

  const openGuide = useCallback(() => setGuideOpen(true), []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  return (
    <View
      pointerEvents="box-none"
      style={styles.host}
      accessibilityLabel={`Cosmogony chrome for the ${scene} scene`}
    >
      <SafeAreaView pointerEvents="box-none" style={styles.safe} edges={SAFE_EDGES}>
        <View pointerEvents="box-none" style={styles.topRow}>
          <ChromeAffordance
            label="fold"
            accessibilityLabel="Open the scale fold"
            onPress={onOpenFold}
            variant="leading"
          />
          <ChromeAffordance
            label="trail"
            accessibilityLabel="Open your trail of kept readings"
            onPress={onOpenTrail}
            variant="trailing"
          />
        </View>
        <View pointerEvents="box-none" style={styles.bottomRow}>
          <View />
          <ChromeAffordance
            label="?"
            accessibilityLabel={`Open the ${scene} scene guide`}
            onPress={openGuide}
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
  variant,
}: Readonly<{
  label: string;
  accessibilityLabel: string;
  onPress: (() => void) | undefined;
  variant: AffordanceVariant;
}>) {
  const align: ViewStyle = { alignSelf: variant === "leading" ? "flex-start" : "flex-end" };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={SPACING.small}
      style={({ pressed }) => [styles.affordance, align, pressed ? styles.affordancePressed : null]}
      disabled={!onPress}
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
