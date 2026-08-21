import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { PALETTE, SPACING, TYPOGRAPHY, Z_ORDER } from "../design/tokens";
import type { TrailEntry } from "../persistence/SessionTrail";

export type WaveRepresentation = 0 | 1 | 2 | 3;

const REPRESENTATIONS: ReadonlyArray<{
  id: WaveRepresentation;
  label: string;
  notation: string;
  note: string;
}> = [
  {
    id: 0,
    label: "surface",
    notation: "u(x, y, t)",
    note: "height and slope across the living field.",
  },
  {
    id: 1,
    label: "equation",
    notation: "u(x, t)",
    note: "one line through the same field, so motion becomes a signal.",
  },
  {
    id: 2,
    label: "spectrum",
    notation: "|U(k)|",
    note: "frequency components computed from the signal, not a decorative graph.",
  },
  {
    id: 3,
    label: "felt",
    notation: "phase → colour",
    note: "the same amplitude returned to a slower, warmer material reading.",
  },
];

export function FoldSheet({
  representation,
  onSelect,
  onClose,
}: Readonly<{
  representation: WaveRepresentation;
  onSelect: (representation: WaveRepresentation) => void;
  onClose: () => void;
}>) {
  return (
    <ReadingSheet title="fold / one wave, four readings" onClose={onClose}>
      <Text style={styles.intro} allowFontScaling maxFontSizeMultiplier={2}>
        This is a lens, not a new simulation. Choose how the field speaks while
        the same sources keep propagating underneath.
      </Text>
      {REPRESENTATIONS.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityState={{ selected: representation === item.id }}
          accessibilityLabel={`Show the wave as ${item.label}`}
          onPress={() => onSelect(item.id)}
          style={({ pressed }) => [
            styles.option,
            representation === item.id ? styles.optionSelected : null,
            pressed ? styles.optionPressed : null,
          ]}
        >
          <View style={styles.optionHeading}>
            <Text style={styles.optionLabel} allowFontScaling maxFontSizeMultiplier={2}>
              {item.label}
            </Text>
            <Text style={styles.notation} allowFontScaling maxFontSizeMultiplier={2}>
              {item.notation}
            </Text>
          </View>
          <Text style={styles.optionNote} allowFontScaling maxFontSizeMultiplier={2}>
            {item.note}
          </Text>
        </Pressable>
      ))}
    </ReadingSheet>
  );
}

export function TrailSheet({
  events,
  onClose,
}: Readonly<{
  events: readonly TrailEntry[];
  onClose: () => void;
}>) {
  return (
    <ReadingSheet title="trail / what you caused" onClose={onClose}>
      <Text style={styles.intro} allowFontScaling maxFontSizeMultiplier={2}>
        A quiet record kept on this device. It names causes, not achievements;
        the larger natural history can grow from these same semantic events.
      </Text>
      {events.length === 0 ? (
        <Text style={styles.empty} allowFontScaling maxFontSizeMultiplier={2}>
          touch the field first. your first disturbance will appear here.
        </Text>
      ) : (
        <View style={styles.eventList}>
          {events.map((event, index) => (
            <View key={`${event.verb}-${index}`} style={styles.event}>
              <View style={styles.optionHeading}>
                <Text style={styles.optionLabel} allowFontScaling maxFontSizeMultiplier={2}>
                  {index + 1}. {event.semanticVerb}
                </Text>
                <Text style={styles.notation} allowFontScaling maxFontSizeMultiplier={2}>
                  {Math.round(event.intensity * 100)}%
                </Text>
              </View>
              <Text style={styles.optionNote} allowFontScaling maxFontSizeMultiplier={2}>
                {event.answered ? "the wave answered in the material." : "the gesture answered in hand and sound."}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ReadingSheet>
  );
}

function ReadingSheet({
  title,
  onClose,
  children,
}: Readonly<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}>) {
  const { width } = useWindowDimensions();
  const side = width >= 768;
  return (
    <View style={styles.host} accessibilityViewIsModal accessibilityLabel={title}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={`Close ${title}`}
      />
      <View style={[styles.sheet, side ? styles.sheetSide : styles.sheetBottom]}>
        <View style={styles.header}>
          <Text style={styles.title} allowFontScaling maxFontSizeMultiplier={2}>
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
            style={styles.close}
          >
            <Text style={styles.closeLabel}>close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: Z_ORDER.guideSheet,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(5, 9, 20, 0.58)",
  },
  sheet: {
    backgroundColor: PALETTE.night.dark,
    padding: SPACING.section,
    zIndex: Z_ORDER.guideSheet,
  },
  sheetBottom: {
    maxHeight: "78%",
    borderTopLeftRadius: SPACING.large,
    borderTopRightRadius: SPACING.large,
    width: "100%",
  },
  sheetSide: {
    maxWidth: "42%",
    height: "100%",
    alignSelf: "flex-start",
    borderTopRightRadius: SPACING.large,
    borderBottomRightRadius: SPACING.large,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.medium,
  },
  title: {
    color: PALETTE.ink.plain,
    fontFamily: TYPOGRAPHY.editorial.family,
    fontSize: TYPOGRAPHY.editorial.sizes.title,
    fontWeight: TYPOGRAPHY.editorial.weight,
    flex: 1,
  },
  close: {
    minHeight: 44,
    paddingHorizontal: SPACING.medium,
    justifyContent: "center",
  },
  closeLabel: {
    color: PALETTE.sea.glimmer,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.body,
  },
  scroll: {
    paddingBottom: SPACING.section,
  },
  intro: {
    color: PALETTE.ink.quiet,
    fontFamily: TYPOGRAPHY.editorial.family,
    fontSize: TYPOGRAPHY.editorial.sizes.body,
    lineHeight: TYPOGRAPHY.editorial.sizes.body * 1.45,
    marginBottom: SPACING.large,
  },
  option: {
    borderWidth: 1,
    borderColor: "rgba(139, 194, 229, 0.2)",
    borderRadius: SPACING.small,
    padding: SPACING.medium,
    marginBottom: SPACING.small,
    minHeight: 64,
  },
  optionSelected: {
    borderColor: PALETTE.sea.glimmer,
    backgroundColor: "rgba(58, 136, 193, 0.18)",
  },
  optionPressed: {
    backgroundColor: "rgba(20, 28, 46, 0.9)",
  },
  optionHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: SPACING.medium,
  },
  optionLabel: {
    color: PALETTE.ink.plain,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.body,
    fontWeight: "600",
  },
  notation: {
    color: PALETTE.sea.glimmer,
    fontFamily: TYPOGRAPHY.notation.family,
    fontSize: TYPOGRAPHY.notation.sizes.body,
  },
  optionNote: {
    color: PALETTE.ink.quiet,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.caption,
    lineHeight: TYPOGRAPHY.system.sizes.caption * 1.45,
    marginTop: SPACING.small,
  },
  eventList: {
    paddingBottom: SPACING.section,
  },
  event: {
    borderLeftWidth: 2,
    borderLeftColor: PALETTE.sea.lit,
    paddingLeft: SPACING.medium,
    marginBottom: SPACING.medium,
  },
  empty: {
    color: PALETTE.ink.quiet,
    fontFamily: TYPOGRAPHY.editorial.family,
    fontSize: TYPOGRAPHY.editorial.sizes.body,
    lineHeight: TYPOGRAPHY.editorial.sizes.body * 1.45,
    textAlign: "center",
    padding: SPACING.section,
  },
});
