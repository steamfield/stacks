/**
 * Shows what the AppInfo native module returns, with a loading indicator and the shared error
 * view. The screen reads state from useAppInfo and never calls the native module itself.
 */
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { ErrorState } from "../../components/error-state";
import { isRetryable, userMessage } from "../../errors";
import { useAppInfo } from "./use-app-info";

export function AppInfoScreen() {
  const { state, reload } = useAppInfo();

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator accessibilityLabel="Loading app info" />
      </View>
    );
  }
  if (state.status === "error") {
    return (
      <ErrorState
        title="Couldn't read app info"
        message={userMessage(state.error)}
        onRetry={isRetryable(state.error) ? reload : undefined}
      />
    );
  }
  const { info } = state;
  const rows: Array<[string, string]> = [
    ["App", info.appName],
    ["Version", `${info.appVersion} (${info.buildNumber})`],
    ["System", `${info.systemName} ${info.systemVersion}`],
  ];
  return (
    <View style={styles.list}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 24, gap: 12 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  label: { fontSize: 16, fontWeight: "600" },
  value: { fontSize: 16 },
});
