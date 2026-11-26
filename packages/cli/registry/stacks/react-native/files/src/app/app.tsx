/**
 * The root component index.js registers. Its props are the native side's initial properties:
 * `config` overrides the validated defaults in src/config.ts. Settings load inside the error
 * boundary, so an invalid value renders the boundary's message instead of a red screen.
 */
import { NavigationContainer } from "@react-navigation/native";
import { useMemo } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { loadConfig } from "../config";
import { createLogger } from "../logging";
import { ErrorBoundary } from "./error-boundary";
import { RootNavigator } from "./navigation";
import { type Services, ServicesProvider } from "./services";

export type AppProps = { config?: unknown };

function Root({ config }: AppProps) {
  const services = useMemo<Services>(() => {
    const loaded = loadConfig(config, __DEV__);
    return { config: loaded, logger: createLogger({ level: loaded.logLevel }) };
  }, [config]);
  return (
    <ServicesProvider value={services}>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </ServicesProvider>
  );
}

export function App({ config }: AppProps) {
  const bootLogger = useMemo(() => createLogger({ level: "info" }), []);
  return (
    <SafeAreaProvider>
      <ErrorBoundary logger={bootLogger}>
        <Root config={config} />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
