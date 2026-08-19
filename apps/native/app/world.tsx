import { StyleSheet, View } from "react-native";
import { NativeChrome, type SceneReveal } from "../src/design/NativeChrome";

/**
 * The world route sits above the persistent `<ObjetUniverseView>` and stays
 * transparent so the native material renders through. It mounts the shared
 * safe-area chrome (`fold`, `trail`, `?`) — no tab bar, no first-launch
 * overlay, no HUD. See `docs/native/art-direction.md` §9.
 *
 * The reveal state is a placeholder here; the scene lanes (U9–U11) push
 * real reveal facts up so the guide sheet can gate its entries on
 * Play/Reveal/Name/Transfer/Express.
 */
const INITIAL_REVEAL: SceneReveal = {
  causedVerbs: [],
  primaryReproductions: 0,
  expressed: false,
};

export default function WorldRoute() {
  return (
    <View style={styles.field} accessibilityLabel="A living wave field">
      <NativeChrome scene="wave" reveal={INITIAL_REVEAL} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
