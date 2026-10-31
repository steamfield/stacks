// The real entry point over stdio, run by Node from source: an SDK client on each protocol era,
// and a raw session proving stdout carries nothing but JSON-RPC.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, beforeEach, expect, test } from "vitest";
import { TOOL_ERRORS } from "../src/errors.ts";
import { tempRoot } from "./helpers/server.ts";

const ENTRY = join(import.meta.dirname, "../src/index.ts");

let root: string;
let cleanup: () => void;
beforeEach(() => {
  ({ root, cleanup } = tempRoot());
  writeFileSync(join(root, "hello.txt"), "hello\n");
});
afterEach(() => cleanup());

/** Only what the server needs: no inherited secrets, and debug logs to exercise stderr. */
const serverEnv = () => ({
  PATH: process.env.PATH ?? "",
  MCP_ROOT: root,
  LOG_LEVEL: "debug",
});

test.each([
  ["2026-07-28 (modern)", { mode: "auto" } as const, "modern"],
  ["2025 (legacy)", undefined, "legacy"],
])("an SDK client on the %s era lists and calls the tool", async (_name, negotiation, era) => {
  const client = new Client(
    { name: "stdio-test", version: "0.0.0" },
    negotiation ? { versionNegotiation: negotiation } : {},
  );
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [ENTRY],
      env: serverEnv(),
      stderr: "pipe",
    }),
  );
  try {
    expect(client.getProtocolEra()).toBe(era);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
    const ok = await client.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
    expect(ok.structuredContent).toEqual({ path: "hello.txt", bytes: 6, text: "hello\n" });
    const refused = await client.callTool({ name: "read_file", arguments: { path: "../x" } });
    expect(refused.isError).toBe(true);
  } finally {
    await client.close();
  }
});

type Session = { stdout: string[]; stderr: string; code: number | null };

/** Sends each message, waits for every response, then closes stdin and waits for the exit. */
function rawSession(messages: object[], responses: number): Promise<Session> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [ENTRY], { env: serverEnv() });
    const lines: string[] = [];
    let buffer = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`timed out; stdout so far: ${lines.join("\n")}\nstderr: ${stderr}`));
    }, 15_000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      lines.push(...parts);
      const answered = lines.filter((line) => line.includes('"id"')).length;
      if (answered >= responses) child.stdin.end();
    });
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffer) lines.push(buffer);
      done({ stdout: lines, stderr, code });
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

test("stdout carries only JSON-RPC, logs go to stderr, and closing stdin ends the process", async () => {
  const session = await rawSession(
    [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "raw", version: "0.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "read_file", arguments: { path: "../../etc/hosts" } },
      },
    ],
    3,
  );

  expect(session.code).toBe(0);
  const messages = session.stdout.map((line) => JSON.parse(line) as Record<string, unknown>);
  for (const message of messages) expect(message.jsonrpc).toBe("2.0");
  const byId = new Map(messages.map((message) => [message.id, message]));
  expect(byId.get(2)).toMatchObject({ result: { tools: [{ name: "read_file" }] } });
  expect(byId.get(3)).toMatchObject({
    result: { isError: true, content: [{ type: "text", text: TOOL_ERRORS.invalid_path }] },
  });

  const records = session.stderr
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { msg: string });
  expect(records.map((record) => record.msg)).toEqual(
    expect.arrayContaining(["serving on stdio", "tool call"]),
  );
});

test("a bad configuration exits 2 with a message on stderr and nothing on stdout", async () => {
  const child = spawn(process.execPath, [ENTRY], { env: { PATH: process.env.PATH ?? "" } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((done) => child.on("close", done));
  expect(code).toBe(2);
  expect(stdout).toBe("");
  expect(stderr).toContain("MCP_ROOT");
});
