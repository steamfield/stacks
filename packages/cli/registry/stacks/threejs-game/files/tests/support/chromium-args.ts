/**
 * The Chromium launch flags every headless run uses, shared by the Playwright projects and
 * `bun run see` so both render the same way.
 *
 * They let headless Chromium render WebGL in software (SwiftShader) and on GPUs it would otherwise
 * blocklist, so the game gets `webgl2` instead of failing to create a context. Chromium no longer
 * falls back to SwiftShader on its own.
 */
export const CHROMIUM_ARGS: readonly string[] = [
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];
