import { defineConfig } from "orval";

export default defineConfig({
  client: {
    input: "./openapi.json",
    output: {
      target: "./app/api/generated/client.ts",
      client: "react-query",
      httpClient: "fetch",
      mock: { generators: [{ type: "msw", delay: false }] },
      override: {
        mutator: { path: "./app/lib/api.ts", name: "apiFetch" },
        fetch: { includeHttpResponseReturnType: false },
        header: false,
      },
    },
    hooks: { afterAllFilesWrite: "prettier --write" },
  },
  schemas: {
    input: "./openapi.json",
    output: {
      target: "./app/api/generated/schemas.ts",
      client: "zod",
      override: { header: false },
    },
    hooks: { afterAllFilesWrite: "prettier --write" },
  },
});
