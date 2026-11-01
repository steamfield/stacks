// The server through a real MCP client over an in-memory transport: what a host sees from
// tools/list and tools/call, including tool errors and invalid input.
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TOOL_ERRORS } from "../src/errors.ts";
import { type TestServer, tempRoot, testServer } from "./helpers/server.ts";

let t: TestServer;
beforeEach(async () => {
  t = await testServer();
});
afterEach(async () => {
  await t.close();
});

const textOf = (result: { content?: unknown }) =>
  (result.content as { type: string; text: string }[]).map((block) => block.text).join("\n");

describe("tools/list", () => {
  test("lists read_file with its input and output schemas and hints", async () => {
    const { tools } = await t.client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
    const [tool] = tools;
    expect(tool?.description).toMatch(/relative to the root/);
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    });
    expect(tool?.outputSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["path", "bytes", "text"]),
    });
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });
});

describe("tools/call read_file", () => {
  test("returns the file as structured content and as text", async () => {
    mkdirSync(join(t.root, "notes"));
    writeFileSync(join(t.root, "notes/todo.md"), "- ship it\n");
    const result = await t.client.callTool({
      name: "read_file",
      arguments: { path: "notes/todo.md" },
    });
    const expected = { path: "notes/todo.md", bytes: 10, text: "- ship it\n" };
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(expected);
    expect(JSON.parse(textOf(result))).toEqual(expected);
    expect(t.records).toContainEqual(
      expect.objectContaining({ msg: "tool call", tool: "read_file", outcome: "ok" }),
    );
  });

  test.each([
    ["../outside.txt", "invalid_path"],
    ["/etc/hosts", "invalid_path"],
    ["missing.txt", "not_found"],
  ] as const)("%s is a tool error (%s)", async (path, code) => {
    const result = await t.client.callTool({ name: "read_file", arguments: { path } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(TOOL_ERRORS[code]);
    expect(result.structuredContent).toBeUndefined();
    expect(t.records).toContainEqual(
      expect.objectContaining({ tool: "read_file", outcome: "tool_error", code }),
    );
  });

  test("a symbolic link out of the root is refused without naming the target", async () => {
    const outside = tempRoot();
    try {
      writeFileSync(join(outside.root, "secret.txt"), "secret");
      symlinkSync(join(outside.root, "secret.txt"), join(t.root, "link.txt"));
      const result = await t.client.callTool({
        name: "read_file",
        arguments: { path: "link.txt" },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(TOOL_ERRORS.outside_root);
      expect(textOf(result)).not.toContain(outside.root);
    } finally {
      outside.cleanup();
    }
  });

  test.each([
    ["a missing argument", {}],
    ["a wrong type", { path: 42 }],
    ["an unknown argument", { path: "a.txt", encoding: "latin1" }],
  ])("%s is rejected before the handler runs", async (_name, args) => {
    const result = await t.client.callTool({ name: "read_file", arguments: args });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/validation/i);
    expect(t.records.filter((record) => record.msg === "tool call")).toEqual([]);
  });
});

test("an unknown tool fails", async () => {
  const outcome = await t.client.callTool({ name: "write_file", arguments: {} }).then(
    (result) => ({ isError: result.isError === true }),
    (error: unknown) => ({ isError: error instanceof Error }),
  );
  expect(outcome.isError).toBe(true);
});
