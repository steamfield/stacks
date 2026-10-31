import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { CliFailure } from "../src/errors";
import {
  CliErrorEnvelope,
  ListResult,
  NewResult,
  VerifyEvent,
  VerifyResult,
} from "../src/schemas/cli";
import {
  ListParams,
  ListSuccess,
  NewParams,
  NewSuccess,
  VerifyParams,
  VerifySuccess,
} from "../src/schemas/tools";
import { fixture, jsonFixture } from "./helpers/cli";

describe("CLI mirrors", () => {
  for (const [name, schema] of [
    ["list", ListResult],
    ["list-project", ListResult],
    ["new", NewResult],
    ["verify-green", VerifyResult],
    ["verify-partial", VerifyResult],
    ["verify-failed", VerifyResult],
    ["verify-changed", VerifyResult],
    ["not-found", CliErrorEnvelope],
    ["verify-failed-envelope", CliErrorEnvelope],
  ] as const) {
    it.effect(`${name} decodes without dropping any captured CLI fields`, () =>
      Effect.gen(function* () {
        const raw = jsonFixture(name);
        expect(yield* Schema.decodeUnknownEffect(schema)(raw)).toEqual(raw);
      }),
    );
  }

  it.effect("every captured verify event decodes without losing fields", () =>
    Effect.gen(function* () {
      for (const line of fixture("verify-events.jsonl").trim().split("\n")) {
        const event: unknown = JSON.parse(line);
        expect(yield* Schema.decodeUnknownEffect(VerifyEvent)(event)).toEqual(event);
      }
    }),
  );

  it.effect("a wrong list kind and a string lastRun fail decoding", () =>
    Effect.gen(function* () {
      const list = yield* Schema.decodeUnknownEffect(ListResult)(jsonFixture("list"));
      const entry = list.entries.find((row) => row.lastRun !== null);
      expect(entry).toBeDefined();
      if (entry === undefined) throw new Error("Captured list has no ledger evidence");
      for (const invalid of [
        { ...entry, kind: "bogus" },
        { ...entry, lastRun: "2026-01-01" },
      ]) {
        expect(
          (yield* Effect.result(
            Schema.decodeUnknownEffect(ListResult)({ ...list, entries: [invalid] }),
          ))._tag,
        ).toBe("Failure");
      }
    }),
  );

  it.effect("red is rejected because the CLI outcome is failed", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(VerifyResult)(jsonFixture("verify-failed"));
      expect(
        (yield* Effect.result(
          Schema.decodeUnknownEffect(VerifyResult)({ ...result, outcome: "red" }),
        ))._tag,
      ).toBe("Failure");
    }),
  );

  it.effect("verify rejects unknown phases, failure kinds and tamper states", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(VerifyResult)(jsonFixture("verify-failed"));
      const step = result.steps[0];
      if (step === undefined) throw new Error("Captured verify has no steps");
      for (const invalid of [
        { ...result, steps: [{ ...step, phase: "unknown" }] },
        { ...result, steps: [{ ...step, failureKind: "unknown" }] },
        { ...result, tamperCheck: "unknown" },
      ])
        expect((yield* Effect.result(Schema.decodeUnknownEffect(VerifyResult)(invalid)))._tag).toBe(
          "Failure",
        );
    }),
  );

  it.effect("envelopes allow absent optional next and details", () =>
    Effect.gen(function* () {
      const captured = yield* Schema.decodeUnknownEffect(CliErrorEnvelope)(
        jsonFixture("not-found"),
      );
      const { next: _next, details: _details, ...error } = captured.error;
      expect(yield* Schema.decodeUnknownEffect(CliErrorEnvelope)({ error })).toEqual({ error });
    }),
  );

  it.effect("success schemas retain the complete CLI contracts", () =>
    Effect.gen(function* () {
      expect(yield* Schema.decodeUnknownEffect(ListSuccess)(jsonFixture("list"))).toEqual(
        jsonFixture("list"),
      );
      expect(yield* Schema.decodeUnknownEffect(NewSuccess)(jsonFixture("new"))).toEqual(
        jsonFixture("new"),
      );
      const verify = yield* Schema.decodeUnknownEffect(VerifyResult)(jsonFixture("verify-failed"));
      const envelope = yield* Schema.decodeUnknownEffect(CliErrorEnvelope)(
        jsonFixture("verify-failed-envelope"),
      );
      expect(
        yield* Schema.decodeUnknownEffect(VerifySuccess)({ ...verify, next: envelope.error.next }),
      ).toEqual({ ...verify, next: envelope.error.next });
    }),
  );
});

describe("tool parameters", () => {
  it.effect.each(["stacks", "fragments", "apps"] as const)("list accepts the %s group", (group) =>
    Effect.gen(function* () {
      expect(yield* Schema.decodeUnknownEffect(ListParams)({ group })).toEqual({ group });
    }),
  );

  it.effect("list accepts no group and rejects an unknown group", () =>
    Effect.gen(function* () {
      expect(yield* Schema.decodeUnknownEffect(ListParams)({})).toEqual({});
      expect(
        (yield* Effect.result(Schema.decodeUnknownEffect(ListParams)({ group: "bogus" })))._tag,
      ).toBe("Failure");
    }),
  );

  it.effect(
    "new accepts absolute paths, fragment arrays and either preset without inventing defaults",
    () =>
      Effect.gen(function* () {
        const minimal = { stack: "typescript-mcp", dir: "/tmp/project with spaces" };
        expect(yield* Schema.decodeUnknownEffect(NewParams)(minimal)).toEqual(minimal);
        for (const preset of ["default", "sandbox"]) {
          const params = { ...minimal, preset, with: ["one"], without: ["two"] };
          expect(yield* Schema.decodeUnknownEffect(NewParams)(params)).toEqual(params);
        }
      }),
  );

  it.effect("new and verify reject missing or relative directories", () =>
    Effect.gen(function* () {
      for (const dir of [undefined, "relative/path", ""]) {
        const directory = dir === undefined ? {} : { dir };
        expect(
          (yield* Effect.result(
            Schema.decodeUnknownEffect(NewParams)({ stack: "fixture", ...directory }),
          ))._tag,
        ).toBe("Failure");
        expect(
          (yield* Effect.result(Schema.decodeUnknownEffect(VerifyParams)(directory)))._tag,
        ).toBe("Failure");
      }
      expect(
        (yield* Effect.result(Schema.decodeUnknownEffect(NewParams)({ dir: "/tmp" })))._tag,
      ).toBe("Failure");
      expect(yield* Schema.decodeUnknownEffect(VerifyParams)({ dir: "/tmp" })).toEqual({
        dir: "/tmp",
      });
    }),
  );
});

it.effect("CliFailure renders actionable text followed by machine readable metadata", () =>
  Effect.gen(function* () {
    const envelope = yield* Schema.decodeUnknownEffect(CliErrorEnvelope)(jsonFixture("not-found"));
    const error = new CliFailure({
      tag: envelope.error.tag,
      cliMessage: envelope.error.message,
      retryable: envelope.error.retryable,
      next: envelope.error.next ?? "stacks new --help",
      exitCode: 2,
      details: envelope.error.details,
    });
    expect(error._tag).toBe("CliFailure");
    expect(error.message).toBe(
      `${error.cliMessage}\nNext: ${error.next}\n\n${JSON.stringify({ tag: error.tag, retryable: error.retryable, exitCode: 2, details: error.details })}`,
    );
    expect((yield* Schema.encodeEffect(CliFailure)(error))._tag).toBe("CliFailure");
  }),
);
