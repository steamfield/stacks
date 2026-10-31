import { spawn } from "node:child_process";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { sandbox, serverPath } from "./helpers/session";

function rawServer(env: Record<string, string>, cwd: string) {
  const child = spawn(process.execPath, [serverPath], {
    env,
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let closed: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.on("error", (error) => {
    stderr += `stdin: ${error.message}\n`;
  });
  child.on("error", (error) => {
    stderr += `spawn: ${error.message}\n`;
  });
  child.on("close", (code, signal) => {
    closed = { code, signal };
  });
  onTestFinished(() => {
    if (closed === undefined) child.kill("SIGKILL");
  });
  return {
    child,
    send: (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`),
    stdout: () => stdout,
    stderr: () => stderr,
    closed: () => closed,
  };
}

async function initialize(server: ReturnType<typeof rawServer>) {
  server.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "raw-acceptance", version: "1" },
    },
  });
  await vi.waitFor(
    () => {
      const frames = server
        .stdout()
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(frames.find((frame) => frame.id === 1)?.result.protocolVersion, server.stderr()).toBe(
        "2025-11-25",
      );
    },
    { timeout: 5000 },
  );
  server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
}

it("closing stdin after initialize lets the server exit zero within five seconds", async () => {
  const box = sandbox();
  const server = rawServer(box.env, box.root);
  try {
    await initialize(server);
    server.child.stdin.end();
    await vi.waitFor(() => expect(server.closed(), server.stderr()).toBeDefined(), {
      timeout: 5000,
    });
    expect(server.closed(), server.stderr()).toEqual({ code: 0, signal: null });
    expect(server.stderr()).toBe("");
  } catch (error) {
    console.error(server.stderr());
    throw error;
  }
}, 12_000); // Up to 5 s initialization plus 5 s shutdown.

it("SIGTERM after initialize is a clean shutdown", async () => {
  const box = sandbox();
  const server = rawServer(box.env, box.root);
  try {
    await initialize(server);
    server.child.kill("SIGTERM");
    await vi.waitFor(() => expect(server.closed(), server.stderr()).toBeDefined(), {
      timeout: 5000,
    });
    expect(server.closed(), server.stderr()).toEqual({ code: 0, signal: null });
  } catch (error) {
    console.error(server.stderr());
    throw error;
  }
}, 12_000); // Up to 5 s initialization plus 5 s shutdown.

it("startup with a missing explicit CLI writes one diagnostic line and exits one without stdout", async () => {
  const box = sandbox();
  const server = rawServer({ ...box.env, STACKS_MCP_CLI: join(box.root, "missing-cli") }, box.root);
  try {
    await vi.waitFor(
      () => expect(server.closed(), server.stderr()).toEqual({ code: 1, signal: null }),
      { timeout: 5000 },
    );
    expect(server.stdout()).toBe("");
    expect(server.stderr().endsWith("\n")).toBe(true);
    expect(server.stderr().trimEnd().split("\n")).toHaveLength(1);
    expect(server.stderr()).toContain("STACKS_MCP_CLI");
  } catch (error) {
    console.error(server.stderr());
    throw error;
  }
}, 7_000); // A five second startup deadline plus assertion cleanup.
