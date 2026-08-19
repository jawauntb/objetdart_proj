import { StyleSheet, View } from "react-native";

export default function WorldRoute() {
  return <View style={styles.field} accessibilityLabel="A living wave field" />;
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
