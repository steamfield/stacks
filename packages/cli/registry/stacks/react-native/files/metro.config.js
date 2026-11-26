/** Metro, React Native's bundler: the defaults, with room for project overrides in `config`. */
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

/** @type {import("@react-native/metro-config").MetroConfig} */
const config = {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
