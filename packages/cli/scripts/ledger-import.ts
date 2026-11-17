import { NodeServices } from "@effect/platform-node";
import { Console, Duration, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { SOURCE_BUILD } from "../src/build";
import { AppConfig } from "../src/config";
import { compose } from "../src/core/compose/compose";
import type { ComposeOptions } from "../src/core/compose/types";
import { fingerprint, proofFingerprint } from "../src/core/fingerprint";
import { appendRecord, readLedger } from "../src/core/ledger";
import { Registry } from "../src/core/registry/registry";
import { printable } from "../src/core/text/text";
import { GIT_REPOSITORY_VARIABLES } from "../src/env-names";
import type { InvalidConfig } from "../src/errors";
import { Ledger, LedgerRecord } from "../src/schemas/ledger";
import { Foreground, Processes } from "../src/services/processes";
import { parseLedgerNote } from "./ledger-note";

const importArguments = (args: string[]) =>
  Effect.gen(function* () {
    let options = true;
    let dryRun = false;
    const notes: string[] = [];
    for (const arg of args) {
      if (!options) {
        notes.push(arg);
        continue;
      }
      if (arg === "--") options = false;
      else if (arg === "--dry-run") dryRun = true;
      else if (arg.startsWith("--")) return yield* Effect.fail(new Error(`Unknown option: ${arg}`));
      else notes.push(arg);
    }
    return { notes, dryRun };
  });

/** Appends the records of another ledger file that this one lacks, each naming a known commit. */
const importLedger = (
  file: string,
  known: ReadonlyArray<LedgerRecord>,
  io: {
    commitExists: (commit: string) => Effect.Effect<string, Error>;
    append: (
      record: LedgerRecord,
    ) => Effect.Effect<void, InvalidConfig, FileSystem.FileSystem | Path.Path>;
  },
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError(() => new Error("could not read the ledger file")));
    const ledger = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Ledger))(text).pipe(
      Effect.mapError(() => new Error("not a runs.json ledger")),
    );
    const same = (a: LedgerRecord, b: LedgerRecord) =>
      a.repoCommit === b.repoCommit &&
      a.stack === b.stack &&
      a.date === b.date &&
      a.mode === b.mode &&
      a.agent === b.agent &&
      a.preset === b.preset &&
      a.fingerprint === b.fingerprint;
    const added: LedgerRecord[] = [];
    for (const value of ledger.records) {
      const record = yield* Schema.decodeUnknownEffect(LedgerRecord)(value).pipe(
        Effect.mapError(() => new Error("a record does not match the ledger schema")),
      );
      yield* io
        .commitExists(record.repoCommit)
        .pipe(Effect.mapError(() => new Error(`unknown commit ${record.repoCommit}`)));
      if (![...known, ...added].some((other) => same(other, record))) added.push(record);
    }
    // Every record is checked before any is appended, so a bad file appends nothing.
    for (const record of added)
      yield* io
        .append(record)
        .pipe(Effect.mapError(() => new Error("could not append the ledger")));
    return added;
  });

const program = Effect.scoped(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processes = yield* Processes;
    const env = (yield* AppConfig).childEnv(GIT_REPOSITORY_VARIABLES, { LC_ALL: "C" });
    const cwd = process.cwd();
    const exec = (argv: readonly [string, ...string[]], directory = cwd) =>
      processes
        .exec({
          argv,
          cwd: directory,
          env,
          timeout: Duration.seconds(30),
        })
        .pipe(
          Effect.flatMap((result) =>
            result.exitCode === 0 && !result.timedOut && !result.truncated
              ? Effect.succeed(result.stdout.trim())
              : Effect.fail(new Error(`${argv[0]} failed`)),
          ),
        );
    const { notes, dryRun } = yield* importArguments(process.argv.slice(2));
    if (!notes.length)
      return yield* Effect.fail(
        new Error("Usage: ledger-import.ts <notes or runs.json files>... [--dry-run]"),
      );
    const root = yield* exec(["git", "rev-parse", "--show-toplevel"]);
    const registry = path.join(root, "packages/cli/registry");
    const existing = yield* readLedger(registry);
    const records: LedgerRecord[] = [];
    let failed = false;
    for (const note of notes) {
      // A ledger file (`bun run prove --ledger`, the nightly zero-edit artifact): its records
      // already carry fingerprints computed at their commit, so they are checked, not recomputed.
      if (note.endsWith(".json")) {
        const added = yield* importLedger(
          path.resolve(cwd, note),
          [...existing.records, ...records],
          {
            commitExists: (commit) =>
              exec(["git", "rev-parse", "--verify", `${commit}^{commit}`], root),
            append: (record) => (dryRun ? Effect.void : appendRecord(registry, record)),
          },
        ).pipe(
          Effect.catch((error: Error) =>
            Console.error(`${printable(note)}: ${printable(error.message)}`).pipe(Effect.as(null)),
          ),
        );
        if (added === null) failed = true;
        else records.push(...added);
        continue;
      }
      const imported = yield* Effect.result(
        Effect.scoped(
          Effect.gen(function* () {
            const text = yield* fs.readFileString(path.resolve(cwd, note));
            const parsed = yield* Effect.try({
              try: () => parseLedgerNote(text),
              catch: (error) => error,
            });
            const commit = yield* exec(
              ["git", "rev-parse", "--verify", `${parsed.repoCommit}^{commit}`],
              root,
            );
            if (
              [...existing.records, ...records].some(
                (record) =>
                  record.repoCommit === commit &&
                  record.stack === parsed.stack &&
                  record.date === parsed.date,
              )
            )
              return null;
            const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "stacks-ledger-" });
            const archive = path.join(temporary, "registry.tar");
            yield* exec(
              [
                "git",
                "archive",
                "--format=tar",
                `--output=${archive}`,
                commit,
                "packages/cli/registry",
              ],
              root,
            );
            yield* exec(["tar", "-xf", archive, "-C", temporary]);
            const oldRegistry = path.join(temporary, "packages/cli/registry");
            const record = yield* Effect.gen(function* () {
              const options: ComposeOptions = {
                stack: parsed.stack,
                with: parsed.with,
                without: [],
                preset: yield* Schema.decodeUnknownEffect(Schema.Literals(["default", "sandbox"]))(
                  parsed.preset,
                ),
                agents: parsed.targets,
                always: [],
                mode: "new",
              };
              const composition = yield* compose(options);
              const baseline = yield* compose({ ...options, with: [] });
              const defaults = new Set(baseline.fragments.map((entry) => entry.id));
              return yield* Schema.decodeUnknownEffect(LedgerRecord)({
                ...parsed,
                repoCommit: commit,
                with: parsed.with.filter((id) => !defaults.has(id)),
                fingerprint: yield* proofFingerprint(composition),
                compositionFingerprint: yield* fingerprint(composition),
                note: path.relative(root, path.resolve(cwd, note)).split(path.sep).join("/"),
              });
            }).pipe(Effect.provide(Registry.layer([{ origin: "bundled", path: oldRegistry }])));
            if (!dryRun) yield* appendRecord(registry, record);
            return record;
          }),
        ),
      );
      if (imported._tag === "Failure") {
        failed = true;
        const error = imported.failure;
        const reason = error instanceof Error ? error.message : "Could not import note";
        yield* Console.error(`${printable(note)}: ${printable(reason)}`);
      } else if (imported.success !== null) records.push(imported.success);
    }
    if (dryRun) yield* Console.log(JSON.stringify(records, null, 2));
    else yield* Console.log(`Imported ${records.length} record(s).`);
    return failed ? 1 : 0;
  }),
);

const platform = Layer.merge(NodeServices.layer, Foreground.layer(Foreground.make()));
const layer = Processes.layer.pipe(
  Layer.provideMerge(AppConfig.layer(SOURCE_BUILD)),
  Layer.provideMerge(platform),
);
process.exitCode = await Effect.runPromise(
  program.pipe(
    Effect.catch((error) =>
      Console.error(error instanceof Error ? error.message : "Import failed").pipe(Effect.as(1)),
    ),
    Effect.provide(layer),
  ),
);
