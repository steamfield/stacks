/**
 * Jest on React Native's preset. React Navigation and the native-view libraries ship untranspiled
 * code, so they stay in the Babel transform; the native projects are never scanned.
 */
module.exports = {
  preset: "@react-native/jest-preset",
  setupFiles: ["<rootDir>/tests/setup.ts"],
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}", "<rootDir>/tests/**/*.test.{ts,tsx}"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context)/)",
  ],
  modulePathIgnorePatterns: ["<rootDir>/ios/", "<rootDir>/android/", "<rootDir>/build/"],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
};
