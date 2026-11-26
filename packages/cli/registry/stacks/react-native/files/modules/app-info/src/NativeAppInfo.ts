/**
 * The JavaScript spec of the AppInfo Turbo Module. React Native's codegen reads this file to
 * generate the native interface the iOS implementation conforms to, so the file name keeps its
 * `Native` prefix and the module name matches `moduleName` in ios/RCTAppInfo.mm.
 */
import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export type AppInfo = {
  appName: string;
  appVersion: string;
  buildNumber: string;
  systemName: string;
  systemVersion: string;
};

export interface Spec extends TurboModule {
  getAppInfo(): Promise<AppInfo>;
}

// `get`, not `getEnforcing`: a build without the native side (Android today) gets null and the
// app shows the unavailable state instead of crashing at import.
export default TurboModuleRegistry.get<Spec>("AppInfo");
