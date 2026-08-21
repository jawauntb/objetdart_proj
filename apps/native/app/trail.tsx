import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { NATIVE_SCENE_IDS, type NativeSceneId } from "@objet/universe-contracts";
import { PALETTE, SPACING, TYPOGRAPHY } from "../src/design/tokens";
import { loadSessionTrail, type TrailEntry } from "../src/persistence/SessionTrail";
import { TrailView } from "../src/trail/TrailView";
import type { TrailReturnAnchor } from "../src/trail/model";

export default function TrailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scene?: string }>();
  const sourceScene = validScene(params.scene) ? params.scene : "wave";
  const [entries, setEntries] = useState<readonly TrailEntry[]>([]);

  useEffect(() => {
    let mounted = true;
    void loadSessionTrail().then((loaded) => {
      if (mounted) setEntries(loaded);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const returnToAnchor = (anchor: TrailReturnAnchor) => {
    router.replace(pathForScene(anchor.scene));
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.closeRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Return to the ${sourceScene} scene`}
          onPress={() => router.replace(pathForScene(sourceScene))}
          style={styles.close}
        >
          <Text style={styles.closeLabel} allowFontScaling maxFontSizeMultiplier={3}>
            return to {sourceScene}
          </Text>
        </Pressable>
      </View>
      <TrailView entries={entries} activeBranchId="local-main" offline onReturnToAnchor={returnToAnchor} />
    </SafeAreaView>
  );
}

function validScene(value: string | undefined): value is NativeSceneId {
  return NATIVE_SCENE_IDS.some((scene) => scene === value);
}

function pathForScene(scene: NativeSceneId): "/world" | "/cell" | "/solar" | "/molecules" | "/atoms" {
  return scene === "wave" ? "/world" : `/${scene}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PALETTE.night.deep },
  closeRow: { position: "absolute", top: 0, right: 0, zIndex: 2, padding: SPACING.medium },
  close: { minHeight: 44, justifyContent: "center", paddingHorizontal: SPACING.medium },
  closeLabel: { color: PALETTE.sea.glimmer, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.body },
});
