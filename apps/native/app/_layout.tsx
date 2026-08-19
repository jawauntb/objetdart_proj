import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { ObjetUniverseView } from "../modules/objet-universe";

export default function RootLayout() {
  return (
    <View style={styles.root}>
      <ObjetUniverseView scene="wave" style={StyleSheet.absoluteFill} />
      <StatusBar hidden style="light" />
      <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
});
