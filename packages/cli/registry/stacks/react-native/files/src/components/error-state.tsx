/**
 * The one failure view: a title, the mapped message and an optional retry button. Screens and the
 * error boundary render it so every failure looks and reads the same.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = { title: string; message: string; onRetry?: (() => void) | undefined };

export function ErrorState({ title, message, onRetry }: Props) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  title: { fontSize: 18, fontWeight: "600" },
  message: { fontSize: 15, textAlign: "center" },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#2f6fde",
  },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
});
