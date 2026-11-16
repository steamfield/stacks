import { describe, expect, test } from "vitest";
import { RESULT_NAMES, RESULT_SCHEMAS } from "../src/core/result-schemas";
import { runCli } from "./helpers/cli";

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Every `$ref` string anywhere in a document. */
function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key === "$ref" && typeof item === "string" ? [item] : refs(item),
  );
}

function objects(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  return isObject(value) ? [value, ...Object.values(value).flatMap(objects)] : [];
}

/** A top-level object schema's property names and required names. */
function keysOf(document: JsonObject) {
  const properties = isObject(document.properties) ? Object.keys(document.properties) : [];
  const required = Array.isArray(document.required) ? document.required : [];
  return { properties, required, closed: document.additionalProperties === false };
}

async function schemaJson(name: string): Promise<JsonObject> {
  const result = await runCli(["schema", name, "--json"]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!isObject(parsed)) throw new Error(`schema ${name} printed ${result.stdout}`);
  return parsed;
}

/** Checks a real `--json` value's top-level keys against its schema document. */
function expectShape(value: unknown, document: JsonObject) {
  if (!isObject(value)) throw new Error(`not an object: ${JSON.stringify(value)}`);
  const { properties, required, closed } = keysOf(document);
  expect(closed).toBe(true);
  for (const key of required) expect(Object.keys(value)).toContain(key);
  for (const key of Object.keys(value)) expect(properties).toContain(key);
}

describe("schema", () => {
  test("with no name lists every schema name and what it describes, sorted", async () => {
    const result = await runCli(["schema"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines.map((line) => line.split(/\s+/)[0])).toEqual([...RESULT_NAMES].sort());
    expect(lines).toContain(`verify-event    ${RESULT_SCHEMAS["verify-event"].describes}`);
  });

  test("--json with no name is one { schemas } object", async () => {
    const result = await runCli(["schema", "--json"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      schemas: RESULT_NAMES.map((name) => ({ name, describes: RESULT_SCHEMAS[name].describes })),
    });
  });

  test.each(RESULT_NAMES)("%s is a self-contained draft 2020-12 document", async (name) => {
    const document = await schemaJson(name);
    expect(document.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    // An object result or a union of them (verify-event); never an empty, accept-anything schema.
    expect(document.type === "object" || Array.isArray(document.anyOf)).toBe(true);
    // Sub-schemas are inlined today; a ref, if one appears, must resolve inside the document.
    const defs = isObject(document.$defs) ? document.$defs : {};
    for (const ref of refs(document)) {
      expect(ref).toMatch(/^#\/\$defs\//);
      expect(Object.hasOwn(defs, ref.slice("#/$defs/".length))).toBe(true);
    }
  });

  test("text modes print the same document indented", async () => {
    const text = await runCli(["schema", "doctor"]);
    expect(text.status).toBe(0);
    expect(JSON.parse(text.stdout)).toEqual(await schemaJson("doctor"));
    expect(text.stdout).toContain('\n  "');
  });

  test("the show schema exposes optional payload variants and file labels", async () => {
    const document = await schemaJson("show");
    const payloadFields = objects(document).filter((node) => {
      const properties = node.properties;
      return isObject(properties) && Object.hasOwn(properties, "payloads");
    });
    expect(payloadFields).toHaveLength(1);
    expect(payloadFields[0]).toMatchObject({ properties: { payloads: { type: "array" } } });
    expect(payloadFields[0]?.required).not.toContain("payloads");
    const fileFields = objects(document).filter((node) => {
      const properties = node.properties;
      return (
        isObject(properties) &&
        Object.hasOwn(properties, "source") &&
        Object.hasOwn(properties, "path")
      );
    });
    expect(fileFields).toHaveLength(1);
    expect(fileFields[0]).toMatchObject({ properties: { payload: { type: "string" } } });
    expect(fileFields[0]?.required).not.toContain("payload");
  });

  test("the doctor schema describes doctor --json's real result", async () => {
    const doctor = await runCli(["doctor", "--json"]);
    expect(doctor.status).toBe(0);
    expectShape(JSON.parse(doctor.stdout), await schemaJson("doctor"));
  });

  test("the error schema describes a real failure envelope", async () => {
    const failed = await runCli(["show", "no-such-entry", "--json"]);
    expect(failed.status).toBe(2);
    const envelope = JSON.parse(failed.stderr.trim().split("\n").at(-1) ?? "") as unknown;
    const document = await schemaJson("error");
    expectShape(envelope, document);
    const error = isObject(envelope) ? envelope.error : undefined;
    const inner = isObject(document.properties) ? document.properties.error : undefined;
    if (!isObject(inner)) throw new Error("error schema has no error property");
    expectShape(error, inner);
  });

  test("the error schema requires search's value or length instead of an id", async () => {
    const document = await schemaJson("error");
    for (const [flag, field, type] of [
      ["limit", "value", "string"],
      ["request", "length", "integer"],
    ] as const) {
      const variant = objects(document).find((node) => {
        const properties = node.properties;
        return (
          isObject(properties) &&
          isObject(properties.flag) &&
          Array.isArray(properties.flag.enum) &&
          properties.flag.enum.length === 1 &&
          properties.flag.enum[0] === flag
        );
      });
      expect(variant).toMatchObject({
        required: ["flag", field],
        additionalProperties: false,
        properties: { [field]: { type } },
      });
      expect(variant?.properties).not.toHaveProperty("id");
    }
  });

  test("an unknown name is Usage labelled as an argument, with the names expected and a did-you-mean", async () => {
    const result = await runCli(["schema", "verfy"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      [
        "Invalid command.",
        "  Argument: name",
        "  Value: verfy",
        `  Expected: ${RESULT_NAMES.join(" | ")}`,
        "  Did you mean: verify?",
        "  Next: pass a value from Expected; stacks schema --help lists every argument.",
        "",
      ].join("\n"),
    );
  });

  test("an unknown name in --json mode is one Usage envelope", async () => {
    const result = await runCli(["schema", "verfy", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        tag: "Usage",
        message: "Invalid command.",
        retryable: false,
        next: "pass a value from Expected; stacks schema --help lists every argument.",
        details: {
          flag: "name",
          command: "schema",
          value: "verfy",
          expected: RESULT_NAMES.join(" | "),
          suggestions: ["verify"],
        },
      },
    });
  });
});
