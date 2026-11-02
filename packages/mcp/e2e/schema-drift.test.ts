import { Predicate, Schema } from "effect";
import { expect, it } from "vitest";
import {
  CliErrorEnvelope,
  ListResult,
  NewResult,
  VerifyEvent,
  VerifyResult,
} from "../src/schemas/cli";
import { expandedSchema, objectProperties } from "./helpers/schema-properties";
import { runCli, sandbox } from "./helpers/session";

for (const [name, schema] of [
  ["list", ListResult],
  ["new", NewResult],
  ["verify", VerifyResult],
  ["verify-event", VerifyEvent],
  ["error", CliErrorEnvelope],
] as const) {
  it(`the ${name} mirror matches the complete expanded CLI wire schema`, () => {
    const box = sandbox();
    const cli = runCli(box, ["schema", name, "--json"]);
    expect(cli.status).toBe(0);
    expect(cli.stderr).toBe("");
    const actual: unknown = JSON.parse(cli.stdout);
    if (!Predicate.isReadonlyObject(actual)) throw new Error("CLI schema must be an object");
    const mirror = Schema.toJsonSchemaDocument(schema, { onExcessProperty: "error" });
    const expected = objectProperties(actual, actual.$defs);
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    const properties = objectProperties(mirror.schema, mirror.definitions);
    const message = `Property names: mirror ${JSON.stringify(properties)}; CLI ${JSON.stringify(expected)}`;
    expect(expandedSchema(mirror.schema, mirror.definitions), message).toEqual(
      expandedSchema(actual, actual.$defs),
    );
  });
}
