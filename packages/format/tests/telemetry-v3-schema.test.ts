import { readFileSync } from "node:fs";
import { it } from "@effect/vitest";
import { JsonSchema, Schema, SchemaRepresentation } from "effect";
import { expect, test } from "vitest";
import {
  TelemetryBatch,
  TelemetryEvent,
  TelemetryEventV2,
  TelemetryEventV3,
  telemetryEventV3JsonSchema,
} from "../src/index.js";

const options = { onExcessProperty: "error" } as const;
const decodeBatch = Schema.decodeUnknownSync(TelemetryBatch, options);
const decodeV2 = Schema.decodeUnknownSync(TelemetryEventV2, options);
const decodeV3 = Schema.decodeUnknownSync(TelemetryEventV3, options);
const fixture = (name: string) =>
  Schema.decodeUnknownSync(
    TelemetryEvent,
    options,
  )(
    JSON.parse(readFileSync(new URL(`./fixtures/telemetry/${name}.json`, import.meta.url), "utf8")),
  );
const verifyV3 = { ...fixture("verify"), schemaVersion: 3, asked: 2 };

test.each(["new", "add", "verify", "show", "error"])(
  "v3 %s preserves its v2 fields and closes the event",
  (name) => {
    const v3 = { ...fixture(name), schemaVersion: 3 };
    expect(decodeV3(v3)).toEqual(v3);
    expect(() => decodeV3({ ...v3, private: "text" })).toThrow();
  },
);

test("v3 verify carries an optional non-negative asked count that v2 rejects", () => {
  expect(decodeV3(verifyV3)).toEqual(verifyV3);
  const { asked: _, ...withoutAsked } = verifyV3;
  expect(decodeV3(withoutAsked)).toEqual(withoutAsked);
  for (const asked of [-1, 1.5, "2"]) expect(() => decodeV3({ ...verifyV3, asked })).toThrow();
  expect(() => decodeV2({ ...verifyV3, schemaVersion: 2 })).toThrow();
  expect(() => decodeV3({ ...fixture("show"), schemaVersion: 3, asked: 1 })).toThrow();
});

test("batches mixing v1, v2 and v3 events decode unchanged", () => {
  const v1 = fixture("verify");
  const v2 = { ...v1, schemaVersion: 2 };
  expect(decodeBatch({ events: [v1, v2, verifyV3] }).events).toEqual([v1, v2, verifyV3]);
});

test("v3's exported JSON Schema is frozen and closes every event", () => {
  const exported = `${JSON.stringify(telemetryEventV3JsonSchema(), null, 2)}\n`;
  const committed = readFileSync(
    new URL("../schemas/telemetry-event.v3.json", import.meta.url),
    "utf8",
  );
  expect(exported).toBe(committed);
  const schema = SchemaRepresentation.fromJsonSchemaDocument(
    JsonSchema.fromSchemaDraft2020_12(telemetryEventV3JsonSchema()),
    { patterns: "apply" },
  );
  expect(Schema.is(schema)(verifyV3)).toBe(true);
  expect(Schema.is(schema)({ ...verifyV3, asked: -1 })).toBe(false);
});

it.prop(
  "every decoded v3 event re-encodes to the same JSON",
  [TelemetryEventV3],
  ([event]) => {
    const json: unknown = JSON.parse(JSON.stringify(event));
    expect(Schema.encodeSync(TelemetryEventV3)(decodeV3(json))).toEqual(json);
  },
  { arbitrary: { seed: "telemetry-v3", runs: 50, size: 20 } },
);
