import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";

export default function LaunchThreshold() {
  return (
    <View style={styles.threshold} accessibilityLabel="Preparing a new universe">
      <Redirect href="/world" />
    </View>
  );
}

const styles = StyleSheet.create({
  threshold: {
    flex: 1,
    backgroundColor: "#000000",
  },
});
