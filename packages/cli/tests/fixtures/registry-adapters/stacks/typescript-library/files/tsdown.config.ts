import { defineConfig } from "tsdown";

// One ESM entry with bundled declarations. tsconfig.json turns on isolatedDeclarations, so the
// declarations come from oxc and every export needs an explicit type.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "neutral",
  dts: true,
  clean: true,
});
