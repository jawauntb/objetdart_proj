import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PALETTE, SPACING, TYPOGRAPHY } from "../design/tokens";
import { retirementTransition, type TrailBranchSummary } from "./model";

export function BranchView({
  branch,
  current,
  onSwitch,
  onRetire,
  onRestore,
}: Readonly<{
  branch: TrailBranchSummary;
  current: boolean;
  onSwitch?: (branchId: string) => void;
  onRetire?: (branchId: string) => void;
  onRestore?: (branchId: string) => void;
}>) {
  const [confirming, setConfirming] = useState(false);
  const canChange = branch.retired ? Boolean(onRestore) : Boolean(onRetire) && !current;
  const action = branch.retired ? "restore" : "retire";

  const commitRetirement = () => {
    const result = retirementTransition(branch.retired ? "retired" : "active", {
      isCurrent: current,
      confirmed: confirming,
    });
    if (result === "retired") onRetire?.(branch.id);
    if (result === "active") onRestore?.(branch.id);
    setConfirming(false);
  };

  return (
    <View style={styles.branch} accessibilityLabel={`Branch ${branch.id}`}>
      <View style={styles.heading}>
        <Text style={styles.name} allowFontScaling maxFontSizeMultiplier={3}>
          {current ? "inhabited branch" : branch.retired ? "retired branch" : "parallel branch"}
        </Text>
        <Text style={styles.count} allowFontScaling maxFontSizeMultiplier={3}>
          {branch.eventCount} changes
        </Text>
      </View>
      <Text style={styles.lineage} allowFontScaling maxFontSizeMultiplier={3}>
        {branch.parentId
          ? `continued from ${branch.parentId}${branch.commonAncestorId ? ` · shared ancestor ${branch.commonAncestorId}` : ""}`
          : "the local root of this universe"}
      </Text>
      {current ? (
        <Text style={styles.notice} allowFontScaling maxFontSizeMultiplier={3}>
          leave this branch before retiring it.
        </Text>
      ) : null}
      {!current && !branch.retired && onSwitch ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Makes this the branch where new changes are recorded"
          onPress={() => onSwitch(branch.id)}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>inhabit branch</Text>
        </Pressable>
      ) : null}
      {canChange ? (
        confirming ? (
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={commitRetirement} style={styles.action}>
              <Text style={styles.actionLabel}>confirm {action}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setConfirming(false)} style={styles.action}>
              <Text style={styles.cancelLabel}>keep it</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityHint={branch.retired ? "Makes this branch visible again" : "Hides this branch without deleting it"}
            onPress={() => setConfirming(true)}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>{action} branch</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  branch: {
    borderColor: "rgba(139, 194, 229, 0.22)",
    borderWidth: 1,
    borderRadius: SPACING.medium,
    padding: SPACING.medium,
    marginBottom: SPACING.small,
  },
  heading: { flexDirection: "row", justifyContent: "space-between", gap: SPACING.medium },
  name: { color: PALETTE.ink.plain, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.body },
  count: { color: PALETTE.sea.glimmer, fontFamily: TYPOGRAPHY.notation.family, fontSize: TYPOGRAPHY.notation.sizes.body },
  lineage: { color: PALETTE.ink.quiet, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.caption, marginTop: SPACING.small },
  notice: { color: PALETTE.ember.warm, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.caption, marginTop: SPACING.small },
  actions: { flexDirection: "row", gap: SPACING.small },
  action: { minHeight: 44, justifyContent: "center", paddingRight: SPACING.medium, marginTop: SPACING.small },
  actionLabel: { color: PALETTE.sea.glimmer, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.body },
  cancelLabel: { color: PALETTE.ink.quiet, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.body },
});
