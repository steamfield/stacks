#!/usr/bin/env bun
// `bun scripts/ledger-migrate.ts [--dry-run]`: move runs.json records to scoped proofs. A record's
// old `fingerprint` hashed the whole composition; it becomes `compositionFingerprint`, and
// `fingerprint` becomes `proofFingerprint` of the content the run proved. That content is the
// registry at the record's `repoCommit` when the old fingerprint matches it there, else at v0.8.0
// (whose index published these records as proven). A stack whose own content and verify steps
// are the same at that commit and HEAD therefore stays proven. Records that already carry
// `compositionFingerprint`, or whose content can't be composed, are left alone.
import { NodeServices } from "@effect/platform-node";
import { Console, Duration, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { SOURCE_BUILD } from "../src/build";
import { AppConfig } from "../src/config";
import { compose } from "../src/core/compose/compose";
import { fingerprint, proofFingerprint } from "../src/core/fingerprint";
import { ledgerAdapterSets } from "../src/core/ledger";
import { Registry } from "../src/core/registry/registry";
import { replaceFile } from "../src/core/replace-file";
import { GIT_REPOSITORY_VARIABLES } from "../src/env-names";
import { LedgerRecord } from "../src/schemas/ledger";
import { Foreground, Processes } from "../src/services/processes";

const FALLBACK = "v0.8.0";

const fingerprints = (record: LedgerRecord, registry: string) =>
  Effect.forEach(ledgerAdapterSets(record.agent), (agents) =>
    compose({
      stack: record.stack,
      with: record.with,
      without: [],
      preset: record.preset as "default" | "sandbox",
      agents,
      always: [],
      mode: "new",
    }).pipe(
      Effect.flatMap((composition) =>
        Effect.all({
          agents: Effect.succeed(agents.join(",")),
          composition: fingerprint(composition),
          proof: proofFingerprint(composition),
        }),
      ),
      Effect.provide(Registry.layer([{ origin: "bundled", path: registry }])),
      Effect.result,
    ),
  ).pipe(
    Effect.map((results) =>
      results.flatMap((result) => (result._tag === "Success" ? [result.success] : [])),
    ),
  );

const label = (record: LedgerRecord) =>
  `${record.date} ${record.stack} ${record.preset} ${record.agent}${record.with.length ? ` +${record.with.join(",")}` : ""}`;

/** The content a record proved: at its commit when its old fingerprint matches there, else v0.8.0. */
const provedContent = (
  record: LedgerRecord,
  registryAt: (commit: string) => Effect.Effect<string | null, unknown, never>,
) =>
  Effect.gen(function* () {
    const atCommit = yield* registryAt(record.repoCommit);
    const exact =
      atCommit === null
        ? undefined
        : (yield* fingerprints(record, atCommit)).find(
            (value) => value.composition === record.fingerprint,
          );
    if (exact) return { base: record.repoCommit.slice(0, 7), proved: exact };
    const atFallback = yield* registryAt(FALLBACK);
    const candidates = atFallback === null ? [] : yield* fingerprints(record, atFallback);
    return { base: FALLBACK, proved: candidates.length === 1 ? candidates[0] : undefined };
  });

/** One record under the new definition, or why it stays as it is. */
const migrate = (
  record: LedgerRecord,
  registryAt: (commit: string) => Effect.Effect<string | null, unknown, never>,
  head: string,
) =>
  Effect.gen(function* () {
    if (record.preset !== "default" && record.preset !== "sandbox")
      return {
        record: null,
        row: `left    ${label(record)}: preset ${record.preset} has no proof`,
      };
    const { base, proved } = yield* provedContent(record, registryAt);
    if (proved === undefined)
      return {
        record: null,
        row: `left    ${label(record)}: content at ${base} could not be composed`,
      };
    const found = proved;
    const current = (yield* fingerprints(record, head)).find(
      (value) => value.agents === found.agents,
    );
    return {
      record: Schema.encodeSync(LedgerRecord)({
        ...record,
        fingerprint: found.proof,
        compositionFingerprint: record.fingerprint,
      }),
      row: `${current?.proof === found.proof ? "proven " : "stale  "} ${label(record)}: proved at ${base}`,
    };
  });

const program = Effect.scoped(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processes = yield* Processes;
    const dryRun = process.argv.includes("--dry-run");
    const env = (yield* AppConfig).childEnv(GIT_REPOSITORY_VARIABLES, { LC_ALL: "C" });
    const top = yield* processes.exec({
      argv: ["git", "rev-parse", "--show-toplevel"],
      cwd: process.cwd(),
      env,
      timeout: Duration.seconds(60),
    });
    const root = top.stdout.trim();
    // Paths in `git archive` are relative to cwd, so every git call runs at the top level.
    const git = (...args: string[]) =>
      processes
        .exec({ argv: ["git", ...args], cwd: root, env, timeout: Duration.seconds(60) })
        .pipe(
          Effect.map((result) => ({ ok: result.exitCode === 0, stdout: result.stdout.trim() })),
        );
    const head = path.join(root, "packages/cli/registry");
    const file = path.join(head, "runs.json");
    const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "stacks-ledger-migrate-" });
    const registries = new Map<string, string | null>();
    const registryAt = (commit: string) =>
      Effect.gen(function* () {
        const cached = registries.get(commit);
        if (cached !== undefined) return cached;
        const reachable =
          (yield* git("cat-file", "-e", `${commit}^{commit}`)).ok &&
          (yield* git("merge-base", "--is-ancestor", commit, "HEAD")).ok;
        let at: string | null = null;
        if (reachable) {
          const archive = path.join(temporary, `${registries.size}.tar`);
          const out = path.join(temporary, String(registries.size));
          yield* fs.makeDirectory(out);
          yield* git(
            "archive",
            "--format=tar",
            `--output=${archive}`,
            commit,
            "packages/cli/registry",
          );
          yield* processes.exec({
            argv: ["tar", "-xf", archive, "-C", out],
            cwd: out,
            env,
            timeout: Duration.seconds(60),
          });
          at = path.join(out, "packages/cli/registry");
        }
        registries.set(commit, at);
        return at;
      });

    const envelope = JSON.parse(yield* fs.readFileString(file)) as {
      schemaVersion: 1;
      records: unknown[];
    };
    const rows: string[] = [];
    let migrated = 0;
    const records: unknown[] = [];
    for (const raw of envelope.records) {
      const decoded = Schema.decodeUnknownResult(LedgerRecord)(raw);
      // Already migrated, or not a record this CLI reads: keep it byte for byte.
      const result =
        decoded._tag === "Failure" || decoded.success.compositionFingerprint !== undefined
          ? null
          : yield* migrate(decoded.success, registryAt, head);
      records.push(result?.record ?? raw);
      if (result === null) continue;
      rows.push(result.row);
      if (result.record) migrated++;
    }
    for (const row of rows) yield* Console.log(row);
    yield* Console.log(
      `${migrated} record(s) migrated${dryRun ? " (dry run, runs.json unchanged)" : ""}.`,
    );
    if (!dryRun)
      yield* replaceFile(file, `${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`);
  }),
);

const platform = Layer.merge(NodeServices.layer, Foreground.layer(Foreground.make()));
const layer = Processes.layer.pipe(
  Layer.provideMerge(AppConfig.layer(SOURCE_BUILD)),
  Layer.provideMerge(platform),
);
process.exitCode = await Effect.runPromise(
  program.pipe(
    Effect.as(0),
    Effect.catch((error) =>
      Console.error(error instanceof Error ? error.message : "Migration failed").pipe(Effect.as(1)),
    ),
    Effect.provide(layer),
  ),
);
