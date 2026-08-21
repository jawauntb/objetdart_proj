import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { NATIVE_SCENE_IDS, type NativeSceneId } from "@objet/universe-contracts";
import { PALETTE, SPACING, TYPOGRAPHY } from "../src/design/tokens";
import {
  loadSessionTrailState,
  forkSessionBranch,
  restoreSessionBranch,
  retireSessionBranch,
  switchSessionBranch,
  type SessionTrailState,
} from "../src/persistence/SessionTrail";
import { TrailView } from "../src/trail/TrailView";
import { dismissOverlay } from "../src/trail/navigation";

const EMPTY_TRAIL_STATE: SessionTrailState = Object.freeze({
  entries: Object.freeze([]),
  branches: Object.freeze([{ id: "local-main", parentId: null, retired: false }]),
  activeBranchId: "local-main",
});

export default function TrailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scene?: string }>();
  const sourceScene = validScene(params.scene) ? params.scene : "wave";
  const [trail, setTrail] = useState<SessionTrailState>(EMPTY_TRAIL_STATE);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void loadSessionTrailState().then((loaded) => {
      if (mounted) setTrail(loaded);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const updateBranch = (operation: (branchId: string) => Promise<SessionTrailState>, branchId: string) => {
    setPersistenceError(null);
    void operation(branchId).then(setTrail).catch(() => {
      setPersistenceError("that branch change could not be saved. nothing changed.");
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.closeRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Return to the ${sourceScene} scene`}
          onPress={() => dismissOverlay(router, sourceScene)}
          style={styles.close}
        >
          <Text style={styles.closeLabel} allowFontScaling maxFontSizeMultiplier={3}>
            return to {sourceScene}
          </Text>
        </Pressable>
      </View>
      <TrailView
        entries={trail.entries}
        branches={trail.branches}
        activeBranchId={trail.activeBranchId}
        offline
        onSwitchBranch={(branchId) => updateBranch(switchSessionBranch, branchId)}
        onForkBranch={(branchId) => updateBranch(forkSessionBranch, branchId)}
        onRetireBranch={(branchId) => updateBranch(retireSessionBranch, branchId)}
        onRestoreBranch={(branchId) => updateBranch(restoreSessionBranch, branchId)}
      />
      {persistenceError ? (
        <Text accessibilityRole="alert" style={styles.error} allowFontScaling maxFontSizeMultiplier={3}>
          {persistenceError}
        </Text>
      ) : null}
    </SafeAreaView>
  );
}

function validScene(value: string | undefined): value is NativeSceneId {
  return NATIVE_SCENE_IDS.some((scene) => scene === value);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PALETTE.night.deep },
  closeRow: { position: "absolute", top: 0, right: 0, zIndex: 2, padding: SPACING.medium },
  close: { minHeight: 44, justifyContent: "center", paddingHorizontal: SPACING.medium },
  closeLabel: { color: PALETTE.sea.glimmer, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.body },
  error: { position: "absolute", left: SPACING.medium, right: SPACING.medium, bottom: SPACING.medium, color: PALETTE.ember.warm, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.body },
});
