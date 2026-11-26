/**
 * The first screen: one button that opens the app info screen.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RootScreenProps } from "../../app/routes";

export function HomeScreen({ navigation }: RootScreenProps<"Home">) {
  return (
    <View style={styles.container}>
      <Text style={styles.lead}>Read the app version and the OS from the native side.</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate("AppInfo")}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Show app info</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  lead: { fontSize: 16, textAlign: "center" },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#2f6fde",
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
