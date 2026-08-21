import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { PALETTE, SPACING, TYPOGRAPHY } from "../design/tokens";
import { BranchView } from "./BranchView";
import { HistoryEventView } from "./HistoryEventView";
import {
  branchSummaries,
  projectNaturalHistory,
  type BranchRecord,
  type ProjectableTrailEntry,
  type TrailReturnAnchor,
} from "./model";

export function TrailView({
  entries,
  branches,
  activeBranchId = "local-main",
  offline = true,
  onReturnToAnchor,
  onRetireBranch,
  onRestoreBranch,
}: Readonly<{
  entries: readonly ProjectableTrailEntry[];
  branches?: readonly BranchRecord[];
  activeBranchId?: string;
  offline?: boolean;
  onReturnToAnchor?: (anchor: TrailReturnAnchor) => void;
  onRetireBranch?: (branchId: string) => void;
  onRestoreBranch?: (branchId: string) => void;
}>) {
  const { width } = useWindowDimensions();
  const regular = width >= 768;
  const projection = useMemo(() => projectNaturalHistory(entries), [entries]);
  const branchRecords = useMemo(
    () => branches ?? inferredBranches(projection.events.map((event) => event.branchId)),
    [branches, projection.events],
  );
  const summaries = useMemo(
    () => branchSummaries(projection.events, branchRecords),
    [branchRecords, projection.events],
  );

  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={[styles.content, regular ? styles.regularContent : null]}
      accessibilityLabel="Natural history trail"
    >
      <View style={regular ? styles.regularColumn : null}>
        <Text style={styles.eyebrow} allowFontScaling maxFontSizeMultiplier={3}>
          {offline ? "kept on this device" : "local history"}
        </Text>
        <Text style={styles.title} accessibilityRole="header" allowFontScaling maxFontSizeMultiplier={3}>
          what became because you were here
        </Text>
        <Text style={styles.intro} allowFontScaling maxFontSizeMultiplier={3}>
          This is cause and consequence, not a score. Choose a change to return to its scene; history itself is never rewritten by looking.
        </Text>
      </View>

      <View style={regular ? styles.regularColumn : null}>
        {projection.events.length === 0 ? (
          <Text style={styles.empty} allowFontScaling maxFontSizeMultiplier={3}>
            {projection.emptyMessage}
          </Text>
        ) : (
          projection.events.map((event, index) => {
            const prior = projection.events[index - 1];
            const entersScale = prior?.scaleId !== event.scaleId;
            return (
              <View key={event.id} style={entersScale ? styles.scaleSection : null}>
                {entersScale ? (
                  <Text style={styles.scale} accessibilityRole="header" allowFontScaling maxFontSizeMultiplier={3}>
                    {event.scaleLabel}
                  </Text>
                ) : null}
                <HistoryEventView event={event} onReturnToAnchor={onReturnToAnchor} />
              </View>
            );
          })
        )}

        {summaries.length > 0 ? (
          <View style={styles.branchSection}>
            <Text style={styles.scale} accessibilityRole="header" allowFontScaling maxFontSizeMultiplier={3}>
              branches
            </Text>
            {summaries.map((branch) => (
              <BranchView
                key={branch.id}
                branch={branch}
                current={branch.id === activeBranchId}
                onRetire={onRetireBranch}
                onRestore={onRestoreBranch}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.purgeBoundary} accessibilityRole="summary">
          <Text style={styles.purgeTitle} allowFontScaling maxFontSizeMultiplier={3}>
            permanent removal lives elsewhere
          </Text>
          <Text style={styles.purgeCopy} allowFontScaling maxFontSizeMultiplier={3}>
            Export comes first. Permanent purge is available only from the separate system guide after an explicit confirmation; there is no purge action in the trail or playable material.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function inferredBranches(ids: readonly string[]): readonly BranchRecord[] {
  const unique = Array.from(new Set(ids.length > 0 ? ids : ["local-main"]));
  return unique.map((id, index) => ({ id, parentId: index === 0 ? null : unique[0] ?? null, retired: false }));
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: PALETTE.night.deep },
  content: { padding: SPACING.section, paddingTop: SPACING.gutter * 2, paddingBottom: SPACING.gutter * 2 },
  regularContent: { flexDirection: "row", gap: SPACING.gutter, width: "100%", maxWidth: 1120, alignSelf: "center" },
  regularColumn: { flex: 1, minWidth: 0 },
  eyebrow: { color: PALETTE.sea.glimmer, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.caption, textTransform: "uppercase", letterSpacing: 1.2 },
  title: { color: PALETTE.ink.plain, fontFamily: TYPOGRAPHY.editorial.family, fontSize: TYPOGRAPHY.editorial.sizes.title, marginTop: SPACING.small },
  intro: { color: PALETTE.ink.quiet, fontFamily: TYPOGRAPHY.editorial.family, fontSize: TYPOGRAPHY.editorial.sizes.body, lineHeight: TYPOGRAPHY.editorial.sizes.body * 1.5, marginTop: SPACING.medium, marginBottom: SPACING.large },
  empty: { color: PALETTE.ink.quiet, fontFamily: TYPOGRAPHY.editorial.family, fontSize: TYPOGRAPHY.editorial.sizes.body, lineHeight: TYPOGRAPHY.editorial.sizes.body * 1.5, paddingVertical: SPACING.section },
  scaleSection: { marginBottom: SPACING.section },
  scale: { color: PALETTE.sea.glimmer, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.caption, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: SPACING.medium },
  branchSection: { marginTop: SPACING.medium },
  purgeBoundary: { borderTopColor: "rgba(184, 181, 174, 0.2)", borderTopWidth: 1, marginTop: SPACING.large, paddingTop: SPACING.large },
  purgeTitle: { color: PALETTE.ink.quiet, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.body },
  purgeCopy: { color: PALETTE.ink.faint, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.caption, lineHeight: TYPOGRAPHY.system.sizes.caption * 1.5, marginTop: SPACING.small },
});
