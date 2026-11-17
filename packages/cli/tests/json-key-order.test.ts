import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import { ErrorEnvelope, Usage } from "../src/errors";
import { Invocation } from "../src/services/invocation";
import { VERSION } from "../src/version";
import { runCli } from "./helpers/cli";

function keys(value: unknown) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return Object.keys(value);
}

async function jsonResult(args: readonly string[]): Promise<unknown> {
  const result = await runCli([...args, "--json"]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}

test("framework help prints a single help key", async () => {
  const result = await jsonResult(["--help"]);
  expect(keys(result)).toEqual(["help"]);
  expect(result).toEqual({ help: expect.stringContaining("stacks <subcommand>") });
});

test("framework version prints a single version key", async () => {
  const result = await jsonResult(["--version"]);
  expect(keys(result)).toEqual(["version"]);
  expect(result).toEqual({ version: VERSION });
});

test("the schema catalog prints name before describes in every row", async () => {
  const result = await jsonResult(["schema"]);
  expect(keys(result)).toEqual(["schemas"]);
  assert(
    result && typeof result === "object" && "schemas" in result && Array.isArray(result.schemas),
  );
  expect(result.schemas).toContainEqual({ name: "new", describes: "new --json" });
  for (const row of result.schemas) expect(keys(row)).toEqual(["name", "describes"]);
});

const objectKeys = ["$schema", "type", "properties", "required", "additionalProperties"];
const titledObjectKeys = [...objectKeys, "title", "description"];
const unionKeys = ["$schema", "anyOf"];
test.each([
  { name: "add", order: objectKeys },
  { name: "create", order: objectKeys },
  { name: "doctor", order: titledObjectKeys },
  { name: "error", order: titledObjectKeys },
  { name: "guide", order: titledObjectKeys },
  { name: "guide-author", order: titledObjectKeys },
  { name: "list", order: titledObjectKeys },
  { name: "new", order: titledObjectKeys },
  { name: "runs", order: objectKeys },
  { name: "search", order: objectKeys },
  { name: "show", order: objectKeys },
  { name: "skill", order: objectKeys },
  { name: "submit", order: titledObjectKeys },
  { name: "telemetry", order: unionKeys },
  { name: "update", order: unionKeys },
  { name: "validate", order: titledObjectKeys },
  { name: "validate-brief", order: titledObjectKeys },
  { name: "verify", order: objectKeys },
  { name: "verify-event", order: [...unionKeys, "title", "description"] },
])("schema $name prints its document keys in order", async ({ name, order }) => {
  const result = await jsonResult(["schema", name]);
  expect(keys(result)).toEqual(order);
  expect(result).toHaveProperty("$schema", "https://json-schema.org/draft/2020-12/schema");
});

test("an error envelope writes next, details and rollback in that order", async () => {
  const path = "/project/file";
  const program = Effect.gen(function* () {
    yield* (yield* Invocation).rollbackIncomplete(path);
    return yield* new Usage({ details: { command: "doctr", suggestions: ["doctor"] } });
  });
  const result = await runCli(["--json"], { program });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  const envelope = JSON.parse(result.stderr) as unknown;
  const decoded = Schema.decodeUnknownSync(ErrorEnvelope, { onExcessProperty: "error" })(envelope);
  expect(decoded).toEqual({
    error: {
      tag: "Usage",
      message: "Invalid command.",
      retryable: false,
      next: "run stacks --help to list the commands, or stacks <command> --help for one.",
      details: { command: "doctr", suggestions: ["doctor"] },
      rollback: { incomplete: [path] },
    },
  });
  assert(envelope && typeof envelope === "object" && "error" in envelope);
  expect(keys(envelope.error)).toEqual([
    "tag",
    "message",
    "retryable",
    "next",
    "details",
    "rollback",
  ]);
});
