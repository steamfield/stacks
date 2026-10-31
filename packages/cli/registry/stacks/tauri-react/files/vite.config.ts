import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfig from "./tsconfig.base.json" with { type: "json" };

export const aliases = Object.fromEntries(
  Object.entries(tsconfig.compilerOptions.paths).map(([key, paths]) => [
    key.replace("/*", ""),
    fileURLToPath(new URL((paths[0] ?? "").replace("/*", ""), import.meta.url)),
  ]),
);

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: aliases },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT_WEB ?? 1420),
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"] },
  },
});
