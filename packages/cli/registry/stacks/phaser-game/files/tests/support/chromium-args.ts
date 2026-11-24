/**
 * The Chromium launch flags every headless run uses, shared by the Playwright projects and
 * `bun run see` so both render the same way.
 */

/**
 * Lets headless Chromium render WebGL in software (SwiftShader) and on GPUs it would otherwise
 * blocklist, so the game gets `webgl` instead of a canvas fallback on CI machines with no GPU.
 */
export const CHROMIUM_ARGS: readonly string[] = [
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];
