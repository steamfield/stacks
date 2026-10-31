import { existsSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, type FileSystem, type Path, Schema } from "effect";
import { CliFailure } from "../src/errors";
import { listHandler, newHandler, verifyHandler } from "../src/handlers";
import type { CliRunner } from "../src/run";
import { CliErrorEnvelope } from "../src/schemas/cli";
import {
  envelopeFixture,
  fixture,
  jsonFixture,
  outputCli,
  runnerLayer,
  tempDir,
} from "./helpers/cli";

function calls(dir: string) {
  const cases: ReadonlyArray<{
    name: string;
    fixture: string;
    run: () => Effect.Effect<unknown, CliFailure, CliRunner | FileSystem.FileSystem | Path.Path>;
  }> = [
    { name: "list", run: () => listHandler({}), fixture: "list" },
    { name: "new", run: () => newHandler({ stack: "fixture", dir }), fixture: "new" },
    { name: "verify", run: () => verifyHandler({ dir }), fixture: "verify-green" },
  ];
  return cases;
}

describe("whole CLI results", () => {
  for (const name of ["list", "new", "verify"]) {
    it.effect(`${name} returns every field of the captured result`, () =>
      Effect.gen(function* () {
        const root = tempDir();
        const call = calls(root).find((c) => c.name === name);
        if (call === undefined) throw new Error(`Missing call ${name}`);
        const entry = outputCli(root, { stdout: fixture(`${call.fixture}.json`) });
        const result = yield* call.run().pipe(Effect.provide(runnerLayer(entry)));
        expect(result).toEqual(jsonFixture(call.fixture));
      }),
    );

    for (const stdout of ["not JSON", "", "{}"]) {
      it.effect(
        `${name} rejects successful stdout ${JSON.stringify(stdout)} as CliOutputInvalid`,
        () =>
          Effect.gen(function* () {
            const root = tempDir();
            const call = calls(root).find((c) => c.name === name);
            if (call === undefined) throw new Error(`Missing call ${name}`);
            const entry = outputCli(root, { stdout });
            const error = yield* Effect.flip(call.run()).pipe(Effect.provide(runnerLayer(entry)));
            expect(error).toBeInstanceOf(CliFailure);
            expect(error.tag).toBe("CliOutputInvalid");
            expect(error.retryable).toBe(false);
            expect(error.next).toMatch(/report|version/i);
          }),
      );
    }

    it.effect(
      `${name} preserves the final CLI envelope after diagnostics and trailing whitespace`,
      () =>
        Effect.gen(function* () {
          const root = tempDir();
          const call = calls(root).find((c) => c.name === name);
          if (call === undefined) throw new Error(`Missing call ${name}`);
          const envelope = yield* Schema.decodeUnknownEffect(CliErrorEnvelope)(
            jsonFixture("not-found"),
          );
          const entry = outputCli(root, {
            stderr: `diagnostic\n${envelopeFixture("not-found")}\n \t\n`,
            exit: 2,
          });
          const error = yield* Effect.flip(call.run()).pipe(Effect.provide(runnerLayer(entry)));
          expect(error).toBeInstanceOf(CliFailure);
          expect(error).toMatchObject({
            tag: envelope.error.tag,
            cliMessage: envelope.error.message,
            next: envelope.error.next,
            retryable: envelope.error.retryable,
            details: envelope.error.details,
            exitCode: 2,
          });
          const [lead, metadata] = error.message.split("\n\n");
          expect(lead).toBe(`${envelope.error.message}\nNext: ${envelope.error.next}`);
          expect(JSON.parse(metadata ?? "")).toEqual({
            tag: envelope.error.tag,
            retryable: envelope.error.retryable,
            exitCode: 2,
            details: envelope.error.details,
          });
        }),
    );
  }

  it.effect("list preserves project context along with entries and rejected rows", () =>
    Effect.gen(function* () {
      const entry = outputCli(tempDir(), { stdout: fixture("list-project.json") });
      expect(yield* listHandler({}).pipe(Effect.provide(runnerLayer(entry)))).toEqual(
        jsonFixture("list-project"),
      );
    }),
  );

  for (const outcome of ["failed", "changed"]) {
    it.effect(
      `verify exit 5 returns the whole ${outcome} result and the envelope next action`,
      () =>
        Effect.gen(function* () {
          const root = tempDir();
          const stdout = yield* Schema.decodeUnknownEffect(
            Schema.Record(Schema.String, Schema.Unknown),
          )(jsonFixture(`verify-${outcome}`));
          const envelope = yield* Schema.decodeUnknownEffect(CliErrorEnvelope)(
            jsonFixture(`verify-${outcome}-envelope`),
          );
          const entry = outputCli(root, {
            stdout: fixture(`verify-${outcome}.json`),
            stderr: envelopeFixture(`verify-${outcome}-envelope`),
            exit: 5,
          });
          const result = yield* verifyHandler({ dir: root }).pipe(
            Effect.provide(runnerLayer(entry)),
          );
          expect(result).toEqual({ ...stdout, next: envelope.error.next });
          if (outcome === "failed") {
            expect(
              result.steps
                .filter((step) => step.status === "failed")
                .map((step) => step.failureKind),
            ).toEqual(["step", "step"]);
          } else {
            expect(result.next).toContain("--accept-changes");
          }
        }),
    );
  }

  it.effect("verify preserves a partial result on exit 0", () =>
    Effect.gen(function* () {
      const root = tempDir();
      const entry = outputCli(root, { stdout: fixture("verify-partial.json") });
      expect(yield* verifyHandler({ dir: root }).pipe(Effect.provide(runnerLayer(entry)))).toEqual(
        jsonFixture("verify-partial"),
      );
    }),
  );

  for (const invalid of [
    "stdout",
    "empty envelope",
    "malformed envelope",
    "schema-invalid envelope",
  ]) {
    it.effect(
      `verify exit 5 rejects an invalid ${invalid} instead of returning a kept result`,
      () =>
        Effect.gen(function* () {
          const root = tempDir();
          const invalidStderr: Record<string, string> = {
            "empty envelope": "",
            "malformed envelope": "not JSON",
            "schema-invalid envelope": "{}",
          };
          const stderr = Object.hasOwn(invalidStderr, invalid)
            ? invalidStderr[invalid]
            : envelopeFixture("verify-failed-envelope");
          const entry = outputCli(root, {
            stdout: invalid === "stdout" ? "{}" : fixture("verify-failed.json"),
            stderr,
            exit: 5,
          });
          const error = yield* Effect.flip(verifyHandler({ dir: root })).pipe(
            Effect.provide(runnerLayer(entry)),
          );
          expect(error.tag).toBe("CliOutputInvalid");
          expect(error.retryable).toBe(false);
        }),
    );
  }

  it.effect("a non-5 verify failure remains a tool error even when stdout is a valid result", () =>
    Effect.gen(function* () {
      const root = tempDir();
      const entry = outputCli(root, {
        stdout: fixture("verify-green.json"),
        stderr: envelopeFixture("not-found"),
        exit: 2,
      });
      const error = yield* Effect.flip(verifyHandler({ dir: root })).pipe(
        Effect.provide(runnerLayer(entry)),
      );
      expect(error.tag).toBe("NotFound");
      expect(error.exitCode).toBe(2);
    }),
  );

  it.effect("an envelope without next gets a fallback naming the command help", () =>
    Effect.gen(function* () {
      const envelope = yield* Schema.decodeUnknownEffect(CliErrorEnvelope)(
        jsonFixture("not-found"),
      );
      const { next: _next, ...errorWithoutNext } = envelope.error;
      const entry = outputCli(tempDir(), {
        stderr: JSON.stringify({ error: errorWithoutNext }),
        exit: 2,
      });
      const error = yield* Effect.flip(listHandler({})).pipe(Effect.provide(runnerLayer(entry)));
      expect(error.next).toContain("stacks list --help");
    }),
  );

  it.effect("an invalid failure envelope retains only the last 4 KiB of stderr", () =>
    Effect.gen(function* () {
      const stderr = `${"x".repeat(8192)}invalid envelope`;
      const entry = outputCli(tempDir(), { stderr, exit: 2 });
      const error = yield* Effect.flip(listHandler({})).pipe(Effect.provide(runnerLayer(entry)));
      expect(error.tag).toBe("CliOutputInvalid");
      expect(error.details).toEqual({ stderr: stderr.slice(-4096) });
    }),
  );
});

describe("CLI argument and directory boundaries", () => {
  for (const stack of ["--dry-run", "café-日本語"]) {
    it.effect(
      `new places ${stack} and a path with spaces after -- with one argument per flag`,
      () =>
        Effect.gen(function* () {
          const root = tempDir();
          const record = join(root, "record.json");
          const dir = join(root, "project with spaces");
          const entry = outputCli(root, { stdout: fixture("new.json"), record });
          yield* newHandler({
            stack,
            dir,
            preset: "sandbox",
            with: ["one", "two"],
            without: ["three", "four"],
          }).pipe(Effect.provide(runnerLayer(entry)));
          const recorded = JSON.parse(readFileSync(record, "utf8"));
          expect(recorded.args).toEqual([
            "new",
            "--no-launch",
            "--json",
            "--preset=sandbox",
            "--with=one",
            "--with=two",
            "--without=three",
            "--without=four",
            "--",
            stack,
            dir,
          ]);
          expect(recorded.cwd).toBe(realpathSync(process.cwd()));
        }),
    );
  }

  it.effect("new omits the preset flag so CLI settings can choose it", () =>
    Effect.gen(function* () {
      const root = tempDir();
      const record = join(root, "record.json");
      const entry = outputCli(root, { stdout: fixture("new.json"), record });
      yield* newHandler({ stack: "fixture", dir: root }).pipe(Effect.provide(runnerLayer(entry)));
      expect(JSON.parse(readFileSync(record, "utf8")).args).toEqual([
        "new",
        "--no-launch",
        "--json",
        "--",
        "fixture",
        root,
      ]);
    }),
  );

  it.effect.each(["stacks", "fragments", "apps"] as const)(
    "list passes group %s as a positional without trust override flags",
    (group) =>
      Effect.gen(function* () {
        const root = tempDir();
        const record = join(root, "record.json");
        const entry = outputCli(root, { stdout: fixture("list.json"), record });
        yield* listHandler({ group }).pipe(Effect.provide(runnerLayer(entry)));
        expect(JSON.parse(readFileSync(record, "utf8")).args).toEqual(["list", group, "--json"]);
      }),
  );

  it.effect("verify uses the real project directory and never accepts changed steps", () =>
    Effect.gen(function* () {
      const root = tempDir();
      const alias = join(tempDir(), "project link");
      symlinkSync(root, alias);
      const record = join(root, "record.json");
      const entry = outputCli(root, { stdout: fixture("verify-green.json"), record });
      yield* verifyHandler({ dir: alias }).pipe(Effect.provide(runnerLayer(entry)));
      expect(JSON.parse(readFileSync(record, "utf8"))).toMatchObject({
        args: ["verify", "--json"],
        cwd: realpathSync(alias),
      });
    }),
  );

  it.effect.each(["missing", "file"])(
    "verify rejects a %s directory before starting the CLI",
    (kind) =>
      Effect.gen(function* () {
        const root = tempDir();
        const dir = join(root, kind);
        if (kind === "file") writeFileSync(dir, "not a directory");
        const record = join(root, "record.json");
        const entry = outputCli(root, { record });
        const error = yield* Effect.flip(verifyHandler({ dir })).pipe(
          Effect.provide(runnerLayer(entry)),
        );
        expect(error.tag).toBe("InvalidArgument");
        expect(error.retryable).toBe(false);
        expect(error.next).toContain(dir);
        expect(error.next).toMatch(/existing.*director/i);
        expect(existsSync(record)).toBe(false);
      }),
  );
});
