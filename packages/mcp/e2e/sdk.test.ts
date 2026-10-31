import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Predicate, Schema } from "effect";
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { ListResult } from "../src/schemas/cli";
import { ListSuccess, NewSuccess, VerifySuccess } from "../src/schemas/tools";
import { expandedSchema } from "./helpers/schema-properties";
import { capture, runCli, textContent, withSdk } from "./helpers/session";

function closedObjects(schema: unknown) {
  if (!Predicate.isReadonlyObject(schema)) return;
  if (schema.type === "object" || "properties" in schema)
    expect(schema.additionalProperties).toBe(false);
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) value.forEach(closedObjects);
    else closedObjects(value);
  }
}

function absoluteDir(schema: unknown) {
  if (!Predicate.isReadonlyObject(schema) || !Predicate.isReadonlyObject(schema.properties))
    throw new Error("Expected parameter properties");
  const dir = schema.properties.dir;
  if (!Predicate.isReadonlyObject(dir) || typeof dir.pattern !== "string")
    throw new Error("dir must advertise an absolute path pattern");
  expect(new RegExp(dir.pattern).test("relative/path")).toBe(false);
  expect(new RegExp(dir.pattern).test("/tmp/project")).toBe(true);
  expect(schema.required).toContain("dir");
}

describe("official SDK interoperability", () => {
  it("list resolves the installed CLI dependency without an override or stacks on PATH", () =>
    withSdk(
      async ({ client }) => {
        const result = await client.callTool({ name: "stacks_list", arguments: {} }, undefined, {
          timeout: 5000,
        });
        expect(result.isError).toBeFalsy();
        const listed = await Effect.runPromise(
          Schema.decodeUnknownEffect(ListResult)(JSON.parse(textContent(result))),
        );
        expect(listed.entries.some((entry) => entry.id === "typescript-mcp")).toBe(true);
        expect(result.structuredContent).toEqual(listed);
      },
      { dependencyOnly: true },
    ));
  it("discovers the version, instructions and exactly three strict tools with honest annotations", () =>
    withSdk(async ({ client }) => {
      expect(client.getServerVersion()?.version).toBe(pkg.version);
      expect(client.getInstructions()).toEqual(expect.any(String));
      for (const name of ["stacks_list", "stacks_new", "stacks_verify"])
        expect(client.getInstructions()).toContain(name);
      const { tools } = await client.listTools({}, { timeout: 5000 });
      expect(tools.map((t) => t.name).sort()).toEqual([
        "stacks_list",
        "stacks_new",
        "stacks_verify",
      ]);
      const expected = [
        {
          name: "stacks_list",
          title: "List stacks and fragments",
          hints: [true, false, true, true],
        },
        {
          name: "stacks_new",
          title: "Create a project from a stack",
          hints: [false, false, false, true],
        },
        {
          name: "stacks_verify",
          title: "Run a project's verify steps",
          hints: [false, true, false, true],
        },
      ];
      for (const row of expected) {
        const tool = tools.find((tool) => tool.name === row.name);
        expect(tool?.title).toBe(row.title);
        expect(tool?.annotations).toMatchObject({
          readOnlyHint: row.hints[0],
          destructiveHint: row.hints[1],
          idempotentHint: row.hints[2],
          openWorldHint: row.hints[3],
        });
        closedObjects(tool?.inputSchema);
        if (row.name !== "stacks_list") {
          absoluteDir(tool?.inputSchema);
        }
      }
    }));

  for (const stack of ["does-not-exist", "--dry-run", "café-日本語"]) {
    it(`a missing stack ${stack} returns actionable NotFound text without structuredContent`, () =>
      withSdk(async ({ client, box }) => {
        const dir = join(box.root, "absent project");
        const cli = runCli(box, ["new", "--no-launch", "--json", "--", stack, dir]);
        expect(cli.status).toBe(2);
        expect(cli.stdout).toBe("");
        const expected = JSON.parse(cli.stderr).error;
        const result = await client.callTool(
          { name: "stacks_new", arguments: { stack, dir } },
          undefined,
          { timeout: 5000 },
        );
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        const [lead, metadata] = textContent(result).split("\n\n");
        expect(lead).toBe(`${expected.message}\nNext: ${expected.next}`);
        expect(JSON.parse(metadata ?? "")).toEqual({
          tag: "NotFound",
          retryable: expected.retryable,
          exitCode: 2,
          details: expected.details,
        });
        expect(expected.details.id).toBe(stack);
        expect(existsSync(dir)).toBe(false);
      }));
  }

  it("each tool advertises its complete success output schema", () =>
    withSdk(async ({ client }) => {
      const { tools } = await client.listTools({}, { timeout: 5000 });
      for (const [name, schema] of [
        ["stacks_list", ListSuccess],
        ["stacks_new", NewSuccess],
        ["stacks_verify", VerifySuccess],
      ] as const) {
        const tool = tools.find((tool) => tool.name === name);
        const mirror = Schema.toJsonSchemaDocument(schema);
        expect(tool?.outputSchema).toBeDefined();
        expect(expandedSchema(tool?.outputSchema, tool?.outputSchema?.$defs)).toEqual(
          expandedSchema(mirror.schema, mirror.definitions),
        );
      }
    }));

  it("a misspelled argument key comes back as a tool error naming the key", () =>
    withSdk(async ({ client, box }) => {
      const result = await client.callTool(
        {
          name: "stacks_verify",
          arguments: { directory: box.root },
        },
        undefined,
        { timeout: 5000 },
      );
      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain("directory");
      expect(result.structuredContent).toBeUndefined();
    }));

  it("a relative directory is an input validation tool error", () =>
    withSdk(async ({ client }) => {
      const result = await client.callTool(
        {
          name: "stacks_verify",
          arguments: { dir: "relative/path" },
        },
        undefined,
        { timeout: 5000 },
      );

      expect(result.isError).toBe(true);
      expect(textContent(result)).toMatch(/dir|pattern|absolute/i);
      expect(result.structuredContent).toBeUndefined();
    }));

  for (const name of ["stacks_list", "stacks_new", "stacks_verify"] as const) {
    it(`${name} rejects an unknown key alongside valid required arguments`, () =>
      withSdk(async ({ client, box }) => {
        const dir = join(box.root, "must not be created");
        const params = {
          stacks_list: { group: "stacks", typo: true },
          stacks_new: { stack: "typescript-mcp", dir, preset: "sandbox", typo: true },
          stacks_verify: { dir: box.root, typo: true },
        };
        const result = await client.callTool({ name, arguments: params[name] }, undefined, {
          timeout: 5000,
        });
        expect(result.isError).toBe(true);
        expect(textContent(result)).toContain("typo");
        expect(result.structuredContent).toBeUndefined();
        expect(existsSync(dir)).toBe(false);
      }));
  }

  it("guide resources, topic templates and completions come from the CLI", () =>
    withSdk(async ({ client, box }) => {
      const { resources } = await client.listResources({}, { timeout: 5000 });
      expect(resources.map((r) => r.uri).sort()).toEqual([
        "stacks://guide",
        "stacks://guide/author",
      ]);
      const { resourceTemplates } = await client.listResourceTemplates({}, { timeout: 5000 });
      expect(resourceTemplates.map((r) => r.uriTemplate)).toEqual([
        "stacks://guide/author/{topic}",
      ]);
      for (const [uri, args] of [
        ["stacks://guide", ["guide"]],
        ["stacks://guide/author", ["guide", "author"]],
      ] as const) {
        const cli = runCli(box, args);
        expect(cli.status).toBe(0);
        expect(cli.stderr).toBe("");
        const result = await client.readResource({ uri }, { timeout: 5000 });
        expect(result.contents).toHaveLength(1);
        expect(result.contents[0]).toMatchObject({ uri, text: cli.stdout });
      }
      const topicsOutput = runCli(box, ["guide", "author", "--json"]);
      expect(topicsOutput.status).toBe(0);
      expect(topicsOutput.stderr).toBe("");
      const { topics } = JSON.parse(topicsOutput.stdout);
      const completion = await client.complete(
        {
          ref: { type: "ref/resource", uri: "stacks://guide/author/{topic}" },
          argument: { name: "topic", value: "" },
        },
        { timeout: 5000 },
      );
      expect(completion.completion.values.sort()).toEqual([...topics].sort());
      const topic = topics[0];
      expect(typeof topic).toBe("string");
      const topicCli = runCli(box, ["guide", "author", topic]);
      expect(topicCli.status).toBe(0);
      expect(topicCli.stderr).toBe("");
      const topicResult = await client.readResource(
        { uri: `stacks://guide/author/${topic}` },
        { timeout: 5000 },
      );
      expect(topicResult.contents[0]).toMatchObject({ text: topicCli.stdout });
    }));

  it("a failed topic read is a protocol error rather than successful error text", () =>
    withSdk(async ({ client }) => {
      await expect(
        client.readResource({ uri: "stacks://guide/author/no-such-topic" }, { timeout: 5000 }),
      ).rejects.toMatchObject({ code: -32602 });
    }));

  it("every stdout line in a complete SDK session is a JSON-RPC 2.0 frame", () =>
    withSdk(async ({ client, outgoing }) => {
      await client.listTools({}, { timeout: 5000 });
      await client.callTool({ name: "stacks_list", arguments: {} }, undefined, { timeout: 5000 });
      await client.readResource({ uri: "stacks://guide" }, { timeout: 5000 });
      const raw = capture(outgoing);
      expect(raw.endsWith("\n")).toBe(true);
      const lines = raw.slice(0, -1).split("\n");
      expect(lines.length).toBeGreaterThan(3);
      for (const line of lines) {
        const frame = JSON.parse(line);
        expect(frame.jsonrpc).toBe("2.0");
        expect("result" in frame || "error" in frame || "method" in frame).toBe(true);
      }
    }));

  it("verifying a hostile Bun project never executes its preload or dotenv configuration", () =>
    withSdk(async ({ client, box }) => {
      const dir = join(box.root, "hostile project");
      mkdirSync(dir);
      const marker = join(dir, "preload-ran");
      writeFileSync(join(dir, "bunfig.toml"), 'preload = ["./pre.ts"]\n');
      writeFileSync(
        join(dir, "pre.ts"),
        `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran");`,
      );
      writeFileSync(join(dir, ".env"), "STACKS_STATE_DIR=relative-state\n");
      writeFileSync(join(dir, "package.json"), '{"name":"hostile-project","type":"module"}');
      const result = await client.callTool(
        { name: "stacks_verify", arguments: { dir } },
        undefined,
        { timeout: 5000 },
      );
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      const metadata = textContent(result).split("\n\n")[1];
      expect(metadata).toBeDefined();
      expect(JSON.parse(metadata ?? "")).toMatchObject({ tag: "NotFound", exitCode: 2 });
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(join(dir, "relative-state"))).toBe(false);
    }));
});
