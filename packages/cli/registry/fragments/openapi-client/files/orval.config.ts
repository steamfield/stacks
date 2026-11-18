/**
 * Generates the typed React Query client in src/api/generated/ from ./openapi.json, the API's
 * document copied beside this file. The output is read-only: change the API, copy its document
 * again, then run `bun run generate:api`.
 */

import { defineConfig } from "orval";

export default defineConfig({
  api: {
    input: "./openapi.json",
    output: {
      target: "./src/api/generated/api.ts",
      client: "react-query",
      httpClient: "fetch",
      override: {
        // Every generated call goes through the app's API client (src/api/client.ts).
        mutator: { path: "./src/api/orval-fetch.ts", name: "orvalFetch" },
        // Generated functions return the response body, as the client's request does.
        fetch: { includeHttpResponseReturnType: false },
        // No banner: it would carry the installed Orval's version into committed output.
        header: false,
      },
    },
    // No format hook: biome.json excludes src/api/generated, so Biome refuses the path.
  },
});
