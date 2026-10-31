import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Predicate } from "effect";
import { expect } from "vitest";
import { tempDir } from "../../tests/helpers/temp";

export const serverPath = resolve(import.meta.dirname, "../../dist/server.js");
export const cliPath = realpathSync(resolve(import.meta.dirname, "../../../cli/dist/stacks"));
export const relayPath = resolve(import.meta.dirname, "relay.mjs");

export function sandbox() {
  const root = tempDir();
  const git = spawnSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" });
  if (git.status !== 0 || !git.stdout.trim())
    throw new Error("git is required for MCP acceptance tests");
  // Symlinks keep PATH limited to these two tools even when bun is installed beside them.
  const path = join(root, "bin");
  mkdirSync(path);
  symlinkSync(process.execPath, join(path, "node"));
  symlinkSync(realpathSync(git.stdout.trim()), join(path, "git"));
  const env = {
    HOME: root,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_RUNTIME_DIR: join(root, "runtime"),
    STACKS_STATE_DIR: join(root, "state", "stacks"),
    STACKS_OFFLINE: "1",
    STACKS_TELEMETRY_DISABLED: "1",
    STACKS_MCP_CLI: cliPath,
    PATH: path,
    LOGNAME: "mcp-test",
    USER: "mcp-test",
    SHELL: "/bin/sh",
    TERM: "dumb",
  };
  for (const dir of [
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_STATE_HOME,
    env.XDG_RUNTIME_DIR,
  ])
    mkdirSync(dir, { recursive: true });
  return { root, env };
}

export type Sandbox = ReturnType<typeof sandbox>;

export function runCli(box: Sandbox, args: ReadonlyArray<string>, cwd = box.root) {
  const output = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: box.env,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (output.error) throw output.error;
  return output;
}

export function capture(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export async function withSdk<A>(
  run: (session: {
    client: Client;
    box: Sandbox;
    incoming: string;
    outgoing: string;
  }) => Promise<A>,
  options: { readonly dependencyOnly?: boolean } = {},
) {
  const box = sandbox();
  const incoming = join(box.root, "incoming.jsonl");
  const outgoing = join(box.root, "outgoing.jsonl");
  const { STACKS_MCP_CLI: _entry, ...dependencyEnv } = box.env;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [relayPath, serverPath, incoming, outgoing],
    cwd: box.root,
    env: options.dependencyOnly ? dependencyEnv : box.env,
    stderr: "pipe",
  });
  const client = new Client({ name: "stacks-acceptance", version: "1" });
  let stderr = "";
  const errors: Error[] = [];
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  client.onerror = (error) => {
    errors.push(error);
  };
  try {
    await client.connect(transport, { timeout: 5000 });
    // The SDK learns output schemas through tools/list before validating tools/call results.
    await client.listTools({}, { timeout: 5000 });
    const result = await run({ client, box, incoming, outgoing });
    expect(errors, `Transport errors; server stderr:\n${stderr}`).toEqual([]);
    return result;
  } catch (error) {
    console.error(`Server stderr:\n${stderr}`);
    throw error;
  } finally {
    await client.close();
  }
}

export function textContent(result: unknown) {
  if (!Predicate.isReadonlyObject(result) || !Array.isArray(result.content))
    throw new Error("Expected a tool result with content");
  return result.content
    .map((content) => {
      if (
        typeof content !== "object" ||
        content === null ||
        !("text" in content) ||
        typeof content.text !== "string"
      )
        throw new Error("Expected text content");
      return content.text;
    })
    .join("\n");
}
