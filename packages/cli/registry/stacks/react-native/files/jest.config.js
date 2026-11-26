/**
 * Jest on React Native's preset. React Navigation and the native-view libraries ship untranspiled
 * code, so they stay in the Babel transform; the native projects are never scanned. The coverage
 * floor is the project's to change; `bun run coverage` (verify's test step) fails below it.
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
  coverageThreshold: { global: { lines: 80 } },
};
