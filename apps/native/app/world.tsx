import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ObjetUniverseSurface, type SurfaceCommand } from "../modules/objet-universe";
import { NativeChrome } from "../src/design/NativeChrome";
import { EMPTY_REVEAL, revealAfter, type SceneReveal } from "../src/guide/reveal";

/**
 * The world route sits above the persistent `<ObjetUniverseView>` and stays
 * transparent so the native material renders through. It mounts two things
 * and nothing else: the surface the hand meets, and the shared safe-area
 * chrome. No tab bar, no first-launch overlay, no HUD. See
 * `docs/native/art-direction.md` §9.
 *
 * The surface is a native view rather than a React touch handler on purpose.
 * UIKit hit-tests the topmost view at a point, so a recogniser on the
 * universe below would never see a finger through the navigator's screens —
 * and recognition belongs in Swift regardless, where the one grammar lives.
 * React learns only which phenomena the visitor has caused, because the guide
 * may not describe a phenomenon that has not landed.
 *
 * While the guide sheet is open the surface is closed: the state contract
 * pauses authoritative intervention for the reading surfaces.
 */
export default function WorldRoute() {
  const [reveal, setReveal] = useState<SceneReveal>(EMPTY_REVEAL);
  const [reading, setReading] = useState(false);

  const onSemanticCommand = useCallback((event: { nativeEvent: SurfaceCommand }) => {
    const command = event.nativeEvent;
    setReveal((current) => revealAfter(current, command));
  }, []);

  return (
    <View style={styles.field} accessibilityLabel="A living wave field">
      <ObjetUniverseSurface
        style={StyleSheet.absoluteFill}
        enabled={!reading}
        onSemanticCommand={onSemanticCommand}
      />
      <NativeChrome scene="wave" reveal={reveal} onGuideVisibilityChange={setReading} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
