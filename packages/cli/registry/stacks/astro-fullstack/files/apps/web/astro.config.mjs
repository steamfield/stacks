import react from "@astrojs/react";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const target = `http://localhost:${process.env.PORT_API || "3000"}`;

export default defineConfig({
  output: "static",
  site: "https://example.com",
  integrations: [react()],
  server: { port: Number(process.env.PORT_WEB || 4321) },
  vite: {
    plugins: [tailwind()],
    server: {
      proxy: { "/healthz": target, "/v1": target, "/openapi.json": target },
      forwardConsole: { unhandledErrors: true },
    },
  },
});
