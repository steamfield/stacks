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
    server: { proxy: { "/api": api, "/health": api } },
  };
});
