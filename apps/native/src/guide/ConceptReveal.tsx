import { StyleSheet, Text, View } from "react-native";
import type { NativeSceneId } from "@objet/universe-contracts";
import { PALETTE, SPACING, TYPOGRAPHY } from "../design/tokens";
import { conceptRevealFor, type ConceptRevealAccess } from "./conceptAccess";
import type { GuideEntry } from "./guideData";

export function ConceptReveal({
  entry,
  scene,
  access,
}: Readonly<{
  entry: GuideEntry;
  scene: NativeSceneId;
  access: ConceptRevealAccess;
}>) {
  const reveal = conceptRevealFor(entry, access);
  if (!reveal) return null;
  const sceneNote = entry.sceneNotes[scene] ?? fallbackSceneNote(scene, entry.verb);
  const accessLabel =
    reveal.reason === "discovery"
      ? "noticed after discovery"
      : reveal.reason === "accessibility"
        ? "opened by an accessibility action"
        : "opened because you sought it";

  return (
    <View style={styles.reveal} accessibilityLabel={`${entry.verb}. ${reveal.plain}. ${reveal.notation}`}>
      <View style={styles.heading}>
        <Text style={styles.verb} allowFontScaling maxFontSizeMultiplier={3}>
          {entry.verb}
        </Text>
        <Text style={styles.access} allowFontScaling maxFontSizeMultiplier={3}>
          {accessLabel}
        </Text>
      </View>
      <Text style={styles.plain} allowFontScaling maxFontSizeMultiplier={3}>
        {reveal.plain}
      </Text>
      <Text style={styles.notation} allowFontScaling maxFontSizeMultiplier={3}>
        {reveal.notation}
      </Text>
      <Text style={styles.sceneNote} allowFontScaling maxFontSizeMultiplier={3}>
        {sceneNote}
      </Text>
    </View>
  );
}

function fallbackSceneNote(scene: NativeSceneId, verb: string): string {
  if (scene === "molecules") return `the molecular field answers ${verb} through compound identity, bond, or vibration.`;
  if (scene === "atoms") return `the atomic field answers ${verb} through shell, bond, or fusion energy.`;
  return "the active material answers in its declared relationship.";
}

const styles = StyleSheet.create({
  reveal: {
    borderBottomColor: "rgba(139, 194, 229, 0.18)",
    borderBottomWidth: 1,
    paddingVertical: SPACING.large,
  },
  heading: { flexDirection: "row", justifyContent: "space-between", gap: SPACING.medium },
  verb: { color: PALETTE.sea.glimmer, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.caption, textTransform: "uppercase", letterSpacing: 1.2 },
  access: { color: PALETTE.ink.faint, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.caption, flexShrink: 1, textAlign: "right" },
  plain: { color: PALETTE.ink.plain, fontFamily: TYPOGRAPHY.editorial.family, fontSize: TYPOGRAPHY.editorial.sizes.body, lineHeight: TYPOGRAPHY.editorial.sizes.body * 1.45, marginTop: SPACING.small },
  notation: { color: PALETTE.ink.quiet, fontFamily: TYPOGRAPHY.notation.family, fontSize: TYPOGRAPHY.notation.sizes.body, marginTop: SPACING.small },
  sceneNote: { color: PALETTE.sea.lit, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.body, lineHeight: TYPOGRAPHY.system.sizes.body * 1.4, marginTop: SPACING.small },
});
