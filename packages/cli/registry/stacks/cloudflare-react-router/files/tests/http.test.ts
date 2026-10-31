import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const servers: Array<{ url: string; stop: () => Promise<void> }> = [];

async function start(greeting: string) {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve, reject) => socket.close((e) => (e ? reject(e) : resolve())));
  const state = await mkdtemp(join(tmpdir(), "workers-http-"));
  const child = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--config",
      "build/server/wrangler.json",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(address.port),
      "--inspector-port",
      "0",
      "--persist-to",
      state,
      "--var",
      `GREETING:${greeting}`,
      "--test-scheduled",
    ],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" },
    },
  );
  let output = "";
  let failure: Error | undefined;
  child.on("error", (error) => {
    failure = error;
  });
  child.stdout.on("data", (data: Buffer) => {
    output = (output + data.toString()).slice(-16_000);
  });
  child.stderr.on("data", (data: Buffer) => {
    output = (output + data.toString()).slice(-16_000);
  });
  const url = `http://127.0.0.1:${address.port}`;
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      const closed = once(child, "close");
      process.kill(-child.pid, "SIGTERM");
      const force = setTimeout(() => {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      }, 5_000);
      try {
        await closed;
      } finally {
        clearTimeout(force);
      }
    }
    await rm(state, { recursive: true, force: true });
  };
  servers.push({ url, stop });
  await vi.waitFor(
    async () => {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(output);
      const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000) });
      expect(response.status, output).toBe(greeting === "" ? 503 : 200);
    },
    { timeout: 60_000, interval: 100 },
  );
  return url;
}

let healthy = "";
let invalid = "";
beforeAll(async () => {
  healthy = await start("Hello from HTTP");
  invalid = await start("");
});
afterAll(async () => {
  for (const server of servers.reverse()) await server.stop();
});

test("the built framework renders the loader's binding in its root layout", async () => {
  const response = await fetch(healthy);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const html = await response.text();
  expect(html).toContain('<html lang="en">');
  expect(html).toContain("Worker greeting");
  expect(html).toContain("Hello from HTTP");
  const stylesheet = html.match(/href="([^"]+\.css)"/);
  if (!stylesheet?.[1]) throw new Error("No built Tailwind stylesheet");
  const css = await fetch(new URL(stylesheet[1], healthy));
  expect(css.status).toBe(200);
  expect(await css.text()).toContain(".text-3xl");
});

test("the built resource route returns JSON through the framework Worker", async () => {
  const response = await fetch(`${healthy}/healthz`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ status: "ok" });
});

test("missing routes render the safe error boundary", async () => {
  const response = await fetch(`${healthy}/missing`);
  expect(response.status).toBe(404);
  const html = await response.text();
  expect(html).toContain("Page not found.");
  expect(html).toContain("Return home");
  expect(html).not.toContain("No route matches");
});

test("invalid configuration fails the loader and renders a service error", async () => {
  const response = await fetch(invalid);
  expect(response.status).toBe(503);
  expect(await response.text()).toContain("Service unavailable.");
  expect((await fetch(`${invalid}/healthz`)).status).toBe(503);
});

test("the built Worker exports the harmless scheduled handler", async () => {
  const response = await fetch(`${healthy}/cdn-cgi/local/scheduled?format=json`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ outcome: "ok" });
});
