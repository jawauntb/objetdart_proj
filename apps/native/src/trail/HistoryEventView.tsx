import { StyleSheet, Text, View } from "react-native";
import { PALETTE, SPACING, TYPOGRAPHY } from "../design/tokens";
import type { TrailHistoryEvent } from "./model";

export function HistoryEventView({ event }: Readonly<{ event: TrailHistoryEvent }>) {
  return (
    <View
      accessibilityLabel={`${event.scientificName}. ${event.cause}. ${event.consequence}. Recorded in ${event.scene}. This moment has no restorable checkpoint.`}
      style={styles.event}
    >
      <View style={styles.heading}>
        <Text style={styles.kind} allowFontScaling maxFontSizeMultiplier={3}>
          {event.kind}
        </Text>
        <Text style={styles.name} allowFontScaling maxFontSizeMultiplier={3}>
          {event.scientificName}
        </Text>
      </View>
      <Text style={styles.cause} allowFontScaling maxFontSizeMultiplier={3}>
        because {event.cause}
      </Text>
      <Text style={styles.consequence} allowFontScaling maxFontSizeMultiplier={3}>
        then {event.consequence}
      </Text>
      <Text style={styles.recorded} allowFontScaling maxFontSizeMultiplier={3}>
        recorded in {event.scene} · {formatRecordedAt(event.recordedAt)}
      </Text>
      <Text style={styles.checkpointNotice} allowFontScaling maxFontSizeMultiplier={3}>
        you cannot return to this moment until this history has restorable checkpoints.
      </Text>
    </View>
  );
}

function formatRecordedAt(value: number): string {
  try {
    return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "kept locally";
  }
}

const styles = StyleSheet.create({
  event: {
    borderLeftColor: PALETTE.sea.lit,
    borderLeftWidth: 2,
    paddingLeft: SPACING.medium,
    paddingVertical: SPACING.small,
    marginBottom: SPACING.medium,
  },
  heading: { flexDirection: "row", justifyContent: "space-between", gap: SPACING.medium },
  kind: {
    color: PALETTE.ink.plain,
    fontFamily: TYPOGRAPHY.editorial.family,
    fontSize: TYPOGRAPHY.editorial.sizes.body,
    flexShrink: 1,
  },
  name: {
    color: PALETTE.sea.glimmer,
    fontFamily: TYPOGRAPHY.notation.family,
    fontSize: TYPOGRAPHY.notation.sizes.body,
    flexShrink: 1,
    textAlign: "right",
  },
  cause: {
    color: PALETTE.ink.quiet,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.body,
    lineHeight: TYPOGRAPHY.system.sizes.body * 1.45,
    marginTop: SPACING.small,
  },
  consequence: {
    color: PALETTE.ink.plain,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.body,
    lineHeight: TYPOGRAPHY.system.sizes.body * 1.45,
    marginTop: SPACING.tick,
  },
  recorded: {
    color: PALETTE.sea.lit,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.caption,
    marginTop: SPACING.small,
  },
  checkpointNotice: {
    color: PALETTE.ink.faint,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.caption,
    marginTop: SPACING.tick,
  },
});
