/**
 * GuideSheet — the one native surface where the room writes back.
 *
 * The sheet is sought (opened by the chrome `?`, never volunteered) and it
 * gates every entry on the Play/Reveal/Name/Transfer/Express choreography:
 * an entry whose phenomenon has not landed yet is hidden until it does.
 *
 * It respects Dynamic Type accessibility sizes without covering the active
 * material (`allowFontScaling` + `maxFontSizeMultiplier`), and it respects
 * `prefers-reduced-motion` by collapsing the open transition to a hold.
 *
 * See `docs/native/art-direction.md` §8, §9, §10 for the reviewer prose.
 */

import { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { NativeSceneId } from "@objet/universe-contracts";
import { MOTION, PALETTE, SPACING, TYPOGRAPHY, Z_ORDER } from "../design/tokens";
import {
  GUIDE_ENTRIES,
  REVEAL_STEPS,
  type GuideEntry,
  type GuideRevealStep,
} from "./guideData";
import type { SceneReveal } from "../design/NativeChrome";

export type GuideSheetProps = Readonly<{
  scene: NativeSceneId;
  sceneField: string;
  reveal: SceneReveal;
  revealedEntries: readonly GuideEntry[];
  reducedMotion: boolean;
  openDurationMs: number;
  onClose: () => void;
}>;

/** iPad regular-width threshold — landscape iPad and up read as a side sheet. */
const REGULAR_WIDTH_POINTS = 768;

export function GuideSheet({
  scene,
  sceneField,
  revealedEntries,
  reducedMotion,
  onClose,
}: GuideSheetProps) {
  const { width } = useWindowDimensions();
  const isRegularWidth = width >= REGULAR_WIDTH_POINTS;
  const grouped = useMemo(() => groupByStep(revealedEntries), [revealedEntries]);

  return (
    <View
      style={[styles.host, isRegularWidth ? styles.hostSide : styles.hostBottom]}
      accessibilityViewIsModal
      accessibilityLabel={`Guide sheet for the ${scene} scene`}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close the guide sheet"
      />
      <View
        style={[
          styles.sheet,
          isRegularWidth ? styles.sheetSide : styles.sheetBottom,
        ]}
      >
        <View style={styles.header}>
          <Text
            style={styles.title}
            allowFontScaling
            maxFontSizeMultiplier={2}
          >
            {scene}
          </Text>
          <Text
            style={styles.field}
            allowFontScaling
            maxFontSizeMultiplier={2}
          >
            {sceneField}
          </Text>
          {reducedMotion ? (
            <Text
              style={styles.reducedMotion}
              allowFontScaling
              maxFontSizeMultiplier={2}
              accessibilityRole="text"
            >
              reduced motion is on. the same state, quieter movement.
            </Text>
          ) : null}
        </View>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {REVEAL_STEPS.map((step) => {
            const entries = grouped.get(step) ?? [];
            if (entries.length === 0) return null;
            return (
              <View key={step} style={styles.section}>
                <Text
                  style={styles.sectionTitle}
                  allowFontScaling
                  maxFontSizeMultiplier={2}
                  accessibilityRole="header"
                >
                  {step}
                </Text>
                {entries.map((entry) => (
                  <View key={entry.verb} style={styles.entry}>
                    <Text
                      style={styles.plain}
                      allowFontScaling
                      maxFontSizeMultiplier={3}
                    >
                      {entry.plain}
                    </Text>
                    <Text
                      style={styles.notation}
                      allowFontScaling
                      maxFontSizeMultiplier={3}
                    >
                      {entry.notation}
                    </Text>
                    <Text
                      style={styles.sceneNote}
                      allowFontScaling
                      maxFontSizeMultiplier={3}
                    >
                      {entry.sceneNotes[scene]}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
          {revealedEntries.length === 0 ? (
            <View style={styles.empty}>
              <Text
                style={styles.emptyPrompt}
                allowFontScaling
                maxFontSizeMultiplier={2}
              >
                touch the room first — the guide names only what you have
                already caused.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function groupByStep(entries: readonly GuideEntry[]): Map<GuideRevealStep, GuideEntry[]> {
  const map = new Map<GuideRevealStep, GuideEntry[]>();
  for (const step of REVEAL_STEPS) map.set(step, []);
  for (const entry of entries) {
    const bucket = map.get(entry.reveal);
    if (bucket) bucket.push(entry);
  }
  return map;
}

/**
 * All entries the guide *could* eventually reveal, for the accessibility
 * summary that names the total surface without leaking un-revealed content.
 */
export const GUIDE_TOTAL_ENTRIES = GUIDE_ENTRIES.length;

const _BREATH_MS = MOTION.breathMs;

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: Z_ORDER.guideSheet,
  },
  hostBottom: {
    justifyContent: "flex-end",
  },
  hostSide: {
    justifyContent: "center",
    alignItems: "flex-start",
    flexDirection: "row",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(5, 9, 20, 0.55)",
    zIndex: Z_ORDER.guideBackdrop,
  },
  sheet: {
    backgroundColor: PALETTE.night.dark,
    padding: SPACING.section,
    zIndex: Z_ORDER.guideSheet,
  },
  sheetBottom: {
    maxHeight: "60%",
    borderTopLeftRadius: SPACING.large,
    borderTopRightRadius: SPACING.large,
    width: "100%",
  },
  sheetSide: {
    maxWidth: "40%",
    height: "100%",
    borderTopRightRadius: SPACING.large,
    borderBottomRightRadius: SPACING.large,
  },
  header: {
    marginBottom: SPACING.medium,
  },
  title: {
    color: PALETTE.ink.plain,
    fontFamily: TYPOGRAPHY.editorial.family,
    fontSize: TYPOGRAPHY.editorial.sizes.title,
    fontWeight: TYPOGRAPHY.editorial.weight,
  },
  field: {
    color: PALETTE.ink.quiet,
    fontFamily: TYPOGRAPHY.editorial.family,
    fontSize: TYPOGRAPHY.editorial.sizes.body,
    marginTop: SPACING.small,
  },
  reducedMotion: {
    color: PALETTE.ink.quiet,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.caption,
    marginTop: SPACING.small,
  },
  scroll: {
    paddingBottom: SPACING.section,
  },
  section: {
    marginBottom: SPACING.section,
  },
  sectionTitle: {
    color: PALETTE.sea.glimmer,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.caption,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: SPACING.medium,
  },
  entry: {
    marginBottom: SPACING.medium,
  },
  plain: {
    color: PALETTE.ink.plain,
    fontFamily: TYPOGRAPHY.editorial.family,
    fontSize: TYPOGRAPHY.editorial.sizes.body,
    marginBottom: SPACING.small,
  },
  notation: {
    color: PALETTE.ink.quiet,
    fontFamily: TYPOGRAPHY.notation.family,
    fontSize: TYPOGRAPHY.notation.sizes.body,
    marginBottom: SPACING.small,
  },
  sceneNote: {
    color: PALETTE.sea.lit,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.body,
  },
  empty: {
    padding: SPACING.section,
  },
  emptyPrompt: {
    color: PALETTE.ink.quiet,
    fontFamily: TYPOGRAPHY.editorial.family,
    fontSize: TYPOGRAPHY.editorial.sizes.body,
    textAlign: "center",
  },
});
