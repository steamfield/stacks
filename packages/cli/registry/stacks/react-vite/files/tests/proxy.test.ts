/**
 * Starts Vite's dev server from vite.config.ts with PORT_API pointing at a throwaway HTTP server,
 * and checks which paths the local API proxy forwards and how it rewrites them.
 */

import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const received: string[] = [];
let api: Server | undefined;
let vite: ViteDevServer | undefined;
let origin = "";

const portOf = (server: Server) => (server.address() as AddressInfo).port;

beforeAll(async () => {
  const upstream = createHttpServer((request, response) => {
    received.push(request.url ?? "");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ url: request.url }));
  });
  api = upstream;
  await new Promise<void>((resolve) => upstream.listen(0, resolve));
  // vite.config.ts reads PORT_API when Vite loads it, which createServer does afresh.
  process.env.PORT_API = String(portOf(upstream));
  vite = await createServer({
    root: ROOT,
    configFile: join(ROOT, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { noDiscovery: true },
  });
  await vite.listen();
  origin = `http://127.0.0.1:${portOf(vite.httpServer as Server)}`;
});

afterAll(async () => {
  delete process.env.PORT_API;
  await vite?.close();
  const upstream = api;
  if (upstream) await new Promise((resolve) => upstream.close(resolve));
});

test("forwards /api/<path> to the API as /<path>", async () => {
  const response = await fetch(`${origin}/api/v1/notes?cursor=n-2`);
  await expect(response.json()).resolves.toEqual({ url: "/v1/notes?cursor=n-2" });
});

test("leaves a path that only starts with /api to Vite", async () => {
  await fetch(`${origin}/apifoo`).then((response) => response.text());
  expect(received.filter((url) => url.includes("foo"))).toEqual([]);
});
