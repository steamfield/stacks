import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL("..", import.meta.url));
  const env = loadEnv(mode, envDir, "");
  const api = `http://127.0.0.1:${process.env.PORT_API ?? env.PORT_API ?? "8000"}`;
  return {
    envDir,
    plugins: [tailwindcss(), reactRouter()],
    resolve: {
      alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
    },
    // Scan the root and every route module at startup. Otherwise the first page load
    // finds their dependencies late and Vite reloads mid-load, which breaks pages that
    // parallel Playwright workers opened against a cold cache.
    optimizeDeps: {
      entries: ["app/root.tsx", "app/routes/**/*.{ts,tsx}", "!**/*.test.{ts,tsx}"],
    },
    server: { proxy: { "/api": api, "/health": api } },
  };
});
