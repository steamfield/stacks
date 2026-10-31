// The Node server over a real socket on a free port: what app.request() can't show.
import { afterEach, expect, it } from "vitest";
import { type RunningServer, startServer } from "../src/server.ts";
import { jsonBody, testApp } from "./helpers/app.ts";

let server: RunningServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

it("serves health and a created note over HTTP", async () => {
  const { app } = testApp();
  server = await startServer(app, 0);
  const base = `http://127.0.0.1:${server.port}`;

  const health = await fetch(`${base}/healthz`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });

  const created = await fetch(`${base}/v1/notes`, jsonBody({ title: "Over the wire" }));
  expect(created.status).toBe(201);
  const location = created.headers.get("location");
  expect(location).toMatch(/^\/v1\/notes\//);

  const fetched = await fetch(`${base}${location}`);
  expect(await fetched.json()).toMatchObject({ title: "Over the wire" });
});

it("close() stops the server", async () => {
  const { app } = testApp();
  const running = await startServer(app, 0);
  await running.close();
  await expect(fetch(`http://127.0.0.1:${running.port}/healthz`)).rejects.toThrow();
});
