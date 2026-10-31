// The @nuxt/eslint module writes .nuxt/eslint.config.mjs on nuxt prepare (bun install runs it),
// with the Vue, TypeScript and import rules and the auto-import globals for this project's
// layout. package.json's "imports" maps #nuxt-eslint to that generated file.
import withNuxt from "#nuxt-eslint";

export default withNuxt(
  {
    ignores: [
      ".output/**",
      ".data/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "blob-report/**",
      ".stacks/**",
      ".claude/worktrees/**",
    ],
  },
  {
    // Prettier owns formatting and writes void elements as <input />.
    rules: { "vue/html-self-closing": "off" },
  },
  {
    // The harness's hook test helper restores environment variables by key.
    files: ["tests/helpers/hooks.ts"],
    rules: { "@typescript-eslint/no-dynamic-delete": "off" },
  },
);
