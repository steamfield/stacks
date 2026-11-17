import { it } from "@effect/vitest";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "vitest";
import { Settings } from "../src/schemas/config";
import { DoctorReport } from "../src/schemas/doctor";

it.prop("doctor reports round trip generated schema values", [DoctorReport], ([report]) => {
  expect(Schema.encodeSync(DoctorReport)(Schema.decodeUnknownSync(DoctorReport)(report))).toEqual(
    report,
  );
});
test("config is closed and rejects invalid values readably", () => {
  expect(() =>
    Schema.decodeUnknownSync(Settings, { onExcessProperty: "error" })({ other: true }),
  ).toThrow();
  expect(() => Schema.decodeUnknownSync(Settings)({ dataDir: 42 })).toThrow(/dataDir/);
  expect(Schema.toJsonSchemaDocument(Settings, { onExcessProperty: "error" }).schema).toMatchObject(
    { additionalProperties: false },
  );
});
test("config decodes always, agents, author and the snake_case package_scope", () => {
  const decode = Schema.decodeUnknownSync(Settings, { onExcessProperty: "error" });
  expect(
    decode({ always: ["ci"], agents: ["claude", "codex"], author: "Ada", package_scope: "@acme" }),
  ).toEqual({ always: ["ci"], agents: ["claude", "codex"], author: "Ada", packageScope: "@acme" });
  expect(() => decode({ packageScope: "@acme" })).toThrow();
  expect(() => decode({ agents: ["emacs"] })).toThrow(/agents/);
  expect(() => decode({ package_scope: "@Acme Corp" })).toThrow(/package_scope/);
});
it.effect("test clock drives scoped fibers", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.sleep("1 second").pipe(Effect.as("ready"), Effect.forkChild);
    yield* TestClock.adjust("1 second");
    expect(yield* Fiber.join(fiber)).toBe("ready");
  }),
);
