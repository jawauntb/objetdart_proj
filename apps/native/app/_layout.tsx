import { DarkTheme, Stack, ThemeProvider, type Theme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { ObjetUniverseView } from "../modules/objet-universe";

/**
 * The persistent native universe sits at the bottom of this tree and every
 * route is an overlay above it.
 *
 * Both layers of navigator ground have to be cleared for that to be true. The
 * native stack paints its container with `theme.colors.background` and each
 * screen's content with the same colour, and a stack left on the default
 * theme therefore covers the material completely — the visitor arrives at a
 * flat rectangle and never learns the sea is behind it. `contentStyle` clears
 * the screen; the transparent theme clears the container the screen sits in,
 * which takes no prop of its own.
 */
const TRANSPARENT_OVER_UNIVERSE: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: "transparent" },
};

export default function RootLayout() {
  return (
    <View style={styles.root}>
      <ObjetUniverseView scene="wave" style={StyleSheet.absoluteFill} />
      <StatusBar hidden style="light" />
      <ThemeProvider value={TRANSPARENT_OVER_UNIVERSE}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "fade",
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
      </ThemeProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
});
