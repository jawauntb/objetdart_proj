import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { NativeSceneId } from "@objet/universe-contracts";
import { PALETTE, SPACING, TYPOGRAPHY, Z_ORDER } from "../design/tokens";
import type { TrailEntry } from "../persistence/SessionTrail";
import type { LensIndex } from "../progression/UniverseProgress";

export type SceneLensIndex = LensIndex;

const LENSES_BY_SCENE: Record<NativeSceneId, ReadonlyArray<{
  id: SceneLensIndex;
  label: string;
  notation: string;
  note: string;
}>> = {
  wave: [
    { id: 0, label: "surface", notation: "u(x, y, t)", note: "height and slope across the living field." },
    { id: 1, label: "equation", notation: "u(x, t)", note: "one line through the same field, so motion becomes a signal." },
    { id: 2, label: "spectrum", notation: "|U(k)|", note: "frequency components computed from the signal, not a decorative graph." },
    { id: 3, label: "felt", notation: "phase → colour", note: "the same amplitude returned to a slower, warmer material reading." },
  ],
  cell: [
    { id: 0, label: "colony", notation: "A + B", note: "reaction and diffusion make living patterns from a shared field." },
    { id: 1, label: "membrane", notation: "∇B", note: "the boundary where a cell exchanges matter with its neighbourhood." },
    { id: 2, label: "genome", notation: "DNA → trait", note: "a derived inheritance lens: pattern becomes a readable double helix." },
    { id: 3, label: "protein", notation: "sequence → form", note: "a derived fold: local expression gathers into a working shape." },
  ],
  solar: [
    { id: 0, label: "galaxy", notation: "ρ(r, θ)", note: "many stellar births gathered into one rotating cosmic field." },
    { id: 1, label: "star", notation: "M, L", note: "mass gathers at the centre while orbits keep their history." },
    { id: 2, label: "planet", notation: "Tₑq", note: "a body condenses into a world with terrain and a causal temperature." },
    { id: 3, label: "Earth", notation: "air · sea · life", note: "a derived biosphere lens: atmosphere, ocean, and the possibility of life." },
  ],
};

export function FoldSheet({
  scene = "wave",
  representation,
  onSelect,
  onClose,
  unlockedRepresentations,
  nextHint,
  onOpenCell,
  onOpenSolar,
  onOpenWave,
}: Readonly<{
  scene?: NativeSceneId;
  representation: SceneLensIndex;
  onSelect: (representation: SceneLensIndex) => void;
  onClose: () => void;
  unlockedRepresentations?: readonly SceneLensIndex[];
  nextHint?: string;
  onOpenCell?: () => void;
  onOpenSolar?: () => void;
  onOpenWave?: () => void;
}>) {
  const representations = LENSES_BY_SCENE[scene];
  return (
    <ReadingSheet title="fold / one field, four readings" onClose={onClose}>
      <Text style={styles.intro} allowFontScaling maxFontSizeMultiplier={2}>
        This is a lens, not a new simulation. Choose how the active field speaks
        while the same sources keep propagating underneath. The next register
        opens when the material answers your care.
      </Text>
      {representations.map((item) => {
        const unlocked = unlockedRepresentations?.includes(item.id) ?? true;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected: representation === item.id, disabled: !unlocked }}
            accessibilityLabel={`${unlocked ? "Show" : "Locked"} the ${scene} as ${item.label}`}
            onPress={unlocked ? () => onSelect(item.id) : undefined}
            style={({ pressed }) => [
              styles.option,
              representation === item.id ? styles.optionSelected : null,
              !unlocked ? styles.optionLocked : null,
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
              {unlocked ? item.note : "locked — keep tending the material to open this register."}
            </Text>
          </Pressable>
        );
      })}
      {nextHint ? (
        <Text style={styles.nextHint} allowFontScaling maxFontSizeMultiplier={2}>
          {nextHint}
        </Text>
      ) : null}
      {onOpenCell || onOpenSolar || onOpenWave ? (
        <View style={styles.sceneLinks}>
          <Text style={styles.sceneHeading} allowFontScaling maxFontSizeMultiplier={2}>
            visit another scale
          </Text>
          {onOpenCell ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the living cell scene"
              onPress={onOpenCell}
              style={({ pressed }) => [styles.option, pressed ? styles.optionPressed : null]}
            >
              <Text style={styles.optionLabel} allowFontScaling maxFontSizeMultiplier={2}>
                cell / colony
              </Text>
              <Text style={styles.optionNote} allowFontScaling maxFontSizeMultiplier={2}>
                reaction, diffusion, and the first living patterns.
              </Text>
            </Pressable>
          ) : null}
          {onOpenSolar ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the forming solar system scene"
              onPress={onOpenSolar}
              style={({ pressed }) => [styles.option, pressed ? styles.optionPressed : null]}
            >
              <Text style={styles.optionLabel} allowFontScaling maxFontSizeMultiplier={2}>
                solar / nursery
              </Text>
              <Text style={styles.optionNote} allowFontScaling maxFontSizeMultiplier={2}>
                gravity, orbits, and a system taking shape.
              </Text>
            </Pressable>
          ) : null}
          {onOpenWave ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open the living wave scene"
              onPress={onOpenWave}
              style={({ pressed }) => [styles.option, pressed ? styles.optionPressed : null]}
            >
              <Text style={styles.optionLabel} allowFontScaling maxFontSizeMultiplier={2}>
                wave / surface
              </Text>
              <Text style={styles.optionNote} allowFontScaling maxFontSizeMultiplier={2}>
                ripples, signals, spectra, and felt colour.
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </ReadingSheet>
  );
}

export function TrailSheet({
  events,
  onClose,
  scene = "field",
}: Readonly<{
  events: readonly TrailEntry[];
  onClose: () => void;
  scene?: string;
}>) {
  return (
    <ReadingSheet title={`trail / what you caused in ${scene}`} onClose={onClose}>
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
                {event.answered ? `the ${scene} material answered.` : "the gesture answered in hand and sound."}
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
  optionLocked: {
    opacity: 0.52,
  },
  sceneLinks: {
    marginTop: SPACING.large,
  },
  sceneHeading: {
    color: PALETTE.ink.quiet,
    fontFamily: TYPOGRAPHY.system.family,
    fontSize: TYPOGRAPHY.system.sizes.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: SPACING.small,
  },
  nextHint: {
    color: PALETTE.sea.glimmer,
    fontFamily: TYPOGRAPHY.editorial.family,
    fontSize: TYPOGRAPHY.editorial.sizes.body,
    lineHeight: TYPOGRAPHY.editorial.sizes.body * 1.35,
    marginTop: SPACING.small,
    marginBottom: SPACING.medium,
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
