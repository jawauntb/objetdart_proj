import { StyleSheet, View } from "react-native";

export default function WorldRoute() {
  return <View style={styles.field} accessibilityLabel="No universe exists yet" />;
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
    backgroundColor: "#000000",
  },
});
