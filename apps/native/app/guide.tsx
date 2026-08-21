import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { NATIVE_SCENE_IDS, type NativeSceneId } from "@objet/universe-contracts";
import { PALETTE, SPACING, TYPOGRAPHY } from "../src/design/tokens";
import { ConceptReveal } from "../src/guide/ConceptReveal";
import { GUIDE_ENTRIES, REVEAL_STEPS } from "../src/guide/guideData";

export default function GuideRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scene?: string; access?: string }>();
  const scene = validScene(params.scene) ? params.scene : "wave";
  const { width } = useWindowDimensions();
  const regular = width >= 768;
  const reason = params.access === "accessibility" ? "accessibility" : "direct-seeking";

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.content, regular ? styles.regular : null]}>
        <View style={regular ? styles.introColumn : null}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Return to the ${scene} scene`}
            onPress={() => router.replace(pathForScene(scene))}
            style={styles.close}
          >
            <Text style={styles.closeLabel} allowFontScaling maxFontSizeMultiplier={3}>
              return to {scene}
            </Text>
          </Pressable>
          <Text style={styles.eyebrow} allowFontScaling maxFontSizeMultiplier={3}>
            sought guide · {scene}
          </Text>
          <Text style={styles.title} accessibilityRole="header" allowFontScaling maxFontSizeMultiplier={3}>
            names for what the material can do
          </Text>
          <Text style={styles.intro} allowFontScaling maxFontSizeMultiplier={3}>
            This surface appears because you asked for it. In the scene, a concept is named only after you cause it; assistive actions may open the same canonical entry directly.
          </Text>
          <View style={styles.systemBoundary}>
            <Text style={styles.systemTitle} allowFontScaling maxFontSizeMultiplier={3}>
              universe care
            </Text>
            <Text style={styles.systemCopy} allowFontScaling maxFontSizeMultiplier={3}>
              Branch retirement is reversible from the trail. Permanent purge is deliberately absent here and from the material: export the universe first, then use a separate confirmed system flow.
            </Text>
          </View>
        </View>

        <View style={regular ? styles.guideColumn : null}>
          {REVEAL_STEPS.map((step) => {
            const entries = GUIDE_ENTRIES.filter((entry) => entry.reveal === step);
            return (
              <View key={step} style={styles.section}>
                <Text style={styles.sectionTitle} accessibilityRole="header" allowFontScaling maxFontSizeMultiplier={3}>
                  {step}
                </Text>
                {entries.map((entry) => (
                  <ConceptReveal
                    key={entry.verb}
                    entry={entry}
                    scene={scene}
                    access={{ reason, causedVerbs: [] }}
                  />
                ))}
              </View>
            );
          })}
        </View>
      </ScrollView>
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
  content: { padding: SPACING.section, paddingBottom: SPACING.gutter * 2 },
  regular: { flexDirection: "row", gap: SPACING.gutter, width: "100%", maxWidth: 1120, alignSelf: "center" },
  introColumn: { flex: 0.8, minWidth: 0 },
  guideColumn: { flex: 1.2, minWidth: 0 },
  close: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", marginBottom: SPACING.large },
  closeLabel: { color: PALETTE.sea.glimmer, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.body },
  eyebrow: { color: PALETTE.sea.glimmer, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.caption, textTransform: "uppercase", letterSpacing: 1.2 },
  title: { color: PALETTE.ink.plain, fontFamily: TYPOGRAPHY.editorial.family, fontSize: TYPOGRAPHY.editorial.sizes.title, marginTop: SPACING.small },
  intro: { color: PALETTE.ink.quiet, fontFamily: TYPOGRAPHY.editorial.family, fontSize: TYPOGRAPHY.editorial.sizes.body, lineHeight: TYPOGRAPHY.editorial.sizes.body * 1.5, marginTop: SPACING.medium },
  systemBoundary: { borderTopColor: "rgba(184, 181, 174, 0.2)", borderTopWidth: 1, marginTop: SPACING.section, paddingTop: SPACING.large },
  systemTitle: { color: PALETTE.ink.plain, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.body },
  systemCopy: { color: PALETTE.ink.faint, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.caption, lineHeight: TYPOGRAPHY.system.sizes.caption * 1.5, marginTop: SPACING.small },
  section: { marginBottom: SPACING.section },
  sectionTitle: { color: PALETTE.ember.warm, fontFamily: TYPOGRAPHY.system.family, fontSize: TYPOGRAPHY.system.sizes.caption, textTransform: "uppercase", letterSpacing: 1.2 },
});
