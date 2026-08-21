import { Pressable, StyleSheet, Text, View } from "react-native";
import { PALETTE, SPACING, TYPOGRAPHY } from "../design/tokens";
import type { TrailHistoryEvent, TrailReturnAnchor } from "./model";

export function HistoryEventView({
  event,
  onReturnToAnchor,
}: Readonly<{
  event: TrailHistoryEvent;
  onReturnToAnchor?: (anchor: TrailReturnAnchor) => void;
}>) {
  return (
    <Pressable
      accessibilityRole={onReturnToAnchor ? "button" : undefined}
      accessibilityLabel={`${event.scientificName}. ${event.cause}. ${event.consequence}`}
      accessibilityHint={onReturnToAnchor ? `Return to the ${event.scene} scene` : undefined}
      onPress={onReturnToAnchor ? () => onReturnToAnchor(event.returnAnchor) : undefined}
      style={({ pressed }) => [styles.event, pressed ? styles.pressed : null]}
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
      <Text style={styles.anchor} allowFontScaling maxFontSizeMultiplier={3}>
        return to {event.scene} · {formatRecordedAt(event.recordedAt)}
      </Text>
    </Pressable>
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
  pressed: { backgroundColor: "rgba(58, 136, 193, 0.12)" },
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
  anchor: {
    color: PALETTE.sea.lit,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.caption,
    marginTop: SPACING.small,
  },
});
