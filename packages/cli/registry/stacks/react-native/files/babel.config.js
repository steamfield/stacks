/**
 * Babel for Metro and Jest: React Native's preset, plus the namespace re-export transform that
 * zod's ESM build (`export * as core`) needs and the preset doesn't include. Without it the
 * release bundle fails while Jest, which loads zod's CommonJS build, still passes.
 */
module.exports = {
  presets: ["module:@react-native/babel-preset"],
  plugins: ["@babel/plugin-transform-export-namespace-from"],
};
