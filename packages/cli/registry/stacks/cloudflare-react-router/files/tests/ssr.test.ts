import { createElement } from "react";
import { createRequestHandler, type ServerBuild } from "react-router";
import { expect, test, vi } from "vitest";
import handleRequest, { handleError } from "../app/entry.server.tsx";

test("an initial render failure returns a safe error page and logs one record", async () => {
  const build: ServerBuild = {
    entry: { module: { default: handleRequest, handleError } },
    routes: {
      root: {
        id: "root",
        path: "/",
        module: {
          default() {
            throw new Error("private rendering detail");
          },
          ErrorBoundary() {
            return createElement("p", null, "Internal server error.");
          },
        },
      },
    },
    assets: {
      entry: { module: "/entry.js", imports: [] },
      routes: {
        root: {
          id: "root",
          path: "/",
          module: "/root.js",
          hasAction: false,
          hasLoader: false,
          hasClientAction: false,
          hasClientLoader: false,
          hasClientMiddleware: false,
          hasErrorBoundary: true,
          clientActionModule: undefined,
          clientLoaderModule: undefined,
          clientMiddlewareModule: undefined,
          hydrateFallbackModule: undefined,
        },
      },
      url: "/manifest.js",
      version: "test",
    },
    publicPath: "/",
    assetsBuildDirectory: "build/client",
    future: {},
    ssr: true,
    isSpaMode: false,
    prerender: [],
    routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
  };
  const records: unknown[][] = [];
  const capture = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    records.push(args);
  });
  try {
    const response = await createRequestHandler(
      build,
      "production",
    )(new Request("https://example.test/"));
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("Internal server error.");
    expect(html).not.toContain("private rendering detail");
    expect(records).toEqual([[JSON.stringify({ event: "request.error", errorClass: "Error" })]]);
  } finally {
    capture.mockRestore();
  }
});
