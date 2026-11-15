/**
 * Reads and appends the run ledger, `registry/runs.json`: the record of maintainer runs that
 * scaffolded a bundled stack, let an agent (or no agent) build it, and verified the result.
 *
 * Each ledger record says which stack, added fragments, preset and agent were run, the result,
 * and a fingerprint of the stack's content at the time. `list` and `show` print a stack's latest
 * run as evidence (`lastRun`, `lastDefaultRecord`), and `validate` notes stacks whose content
 * changed since their last pass (`validate/ledger-notes.ts` with `latestRecord` and
 * `readCanaries`). Records are written only by maintainer scripts (`scripts/prove.ts`,
 * `scripts/bench/`, `scripts/ledger-import.ts`) through `appendRecord`; the CLI itself only reads.
 *
 * Records are decoded one by one, so a record written by a newer stacks, or one that doesn't
 * decode, is skipped and counted rather than failing the whole file. `appendRecord` keeps those
 * skipped records: it rewrites the file from the raw envelope, not from what a reader decoded. Two appends running at once take turns on the `runs.json.lock` directory
 * (creating a directory is atomic), and the new file replaces the old one with a single rename.
 */
import { AgentId } from "@steamfield/stacks-format";
import { Duration, Effect, FileSystem, Path, Result, Schedule, Schema } from "effect";
import { InvalidConfig } from "../errors";
import { Ledger, type LedgerLastRun, LedgerRecord } from "../schemas/ledger";
import { replaceFile } from "./replace-file";

/**
 * What `readLedger` found. `present` is false only when the file doesn't exist; `fileValid` is
 * false when it exists but can't be read or isn't a ledger envelope.
 */
export type LedgerRead = {
  readonly present: boolean;
  readonly fileValid: boolean;
  readonly records: ReadonlyArray<LedgerRecord>;
  readonly skipped: { readonly newer: number; readonly invalid: number };
};
type LedgerKey = Pick<LedgerRecord, "stack" | "with" | "preset" | "agent">;

/**
 * The agent sets a run could have targeted: just `agent` when it is a known id, otherwise every
 * nonempty combination of known agents. Without a known target, an exact fingerprint decides
 * between adapter candidates.
 */
export function ledgerAdapterSets(
  agent?: LedgerRecord["agent"],
): ReadonlyArray<ReadonlyArray<AgentId>> {
  if (Schema.is(AgentId)(agent)) return [[agent]];
  let sets: AgentId[][] = [[]];
  for (const id of AgentId.literals) sets = [...sets, ...sets.map((set) => [...set, id])];
  return sets.filter((set) => set.length > 0);
}

/**
 * The raw envelope, records undecoded, so an append can keep records a reader skips. A missing
 * file is `present: false`; an unreadable or invalid one is `present: true` with no ledger.
 */
const readEnvelope = (registryDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = (yield* Path.Path).join(registryDir, "runs.json");
    const read = yield* Effect.result(fs.readFileString(path));
    if (Result.isFailure(read))
      return { present: read.failure.reason._tag !== "NotFound", ledger: null };
    const decoded = yield* Effect.result(
      Effect.try({ try: () => JSON.parse(read.success) as unknown, catch: () => undefined }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Ledger)),
      ),
    );
    return { present: true, ledger: Result.isSuccess(decoded) ? decoded.success : null };
  });

/** Whether a raw record says a newer stacks wrote it (`schemaVersion` above 1). */
function isNewerRecord(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "number" &&
    value.schemaVersion > 1
  );
}

/** Decodes each raw record, counting the newer and invalid ones it skips. */
function decodeRecords(raw: ReadonlyArray<unknown>): Omit<LedgerRead, "present" | "fileValid"> {
  const records: LedgerRecord[] = [];
  const skipped = { newer: 0, invalid: 0 };
  for (const value of raw) {
    if (isNewerRecord(value)) {
      skipped.newer++;
      continue;
    }
    const record = Schema.decodeUnknownResult(LedgerRecord)(value);
    if (Result.isSuccess(record)) records.push(record.success);
    else skipped.invalid++;
  }
  return { records, skipped };
}

/** The ledger in `registryDir`, with every record that decodes; never fails. */
export const readLedger = (
  registryDir: string,
): Effect.Effect<LedgerRead, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const { present, ledger } = yield* readEnvelope(registryDir);
    const { records, skipped } = decodeRecords(ledger?.records ?? []);
    return { present, fileValid: ledger !== null || !present, records, skipped };
  });

/** Greatest date wins; later file position breaks a tie. */
export function latestMatchingRecord(
  records: ReadonlyArray<LedgerRecord>,
  matches: (record: LedgerRecord) => boolean,
): LedgerRecord | null {
  let found: LedgerRecord | null = null;
  for (const record of records)
    if (matches(record) && (found === null || record.date >= found.date)) found = record;
  return found;
}

/** The latest record for one key. `with` is a set of added fragments. */
export function latestRecord(
  records: ReadonlyArray<LedgerRecord>,
  key: LedgerKey,
): LedgerRecord | null {
  const fragments = [...key.with].sort();
  return latestMatchingRecord(
    records,
    (record) =>
      record.stack === key.stack &&
      record.preset === key.preset &&
      record.agent === key.agent &&
      record.with.length === fragments.length &&
      [...record.with].sort().every((id, index) => id === fragments[index]),
  );
}

/** A stack's latest default-composition record, shared by listing and detailed review. */
export const lastDefaultRecord = (records: ReadonlyArray<LedgerRecord>, stack: string) =>
  latestMatchingRecord(records, (record) => record.stack === stack && record.with.length === 0);

/** A stack's latest run of its default composition, over every preset and agent. */
export function lastRun(records: ReadonlyArray<LedgerRecord>, stack: string): LedgerLastRun | null {
  const found = lastDefaultRecord(records, stack);
  if (found === null) return null;
  return {
    date: found.date,
    result: found.result,
    agent: found.agent,
    preset: found.preset,
    fingerprint: found.fingerprint,
  };
}

const Canaries = Schema.Struct({ stacks: Schema.Array(Schema.String) });

/**
 * `registry/canaries.json`: the stacks whose proofs also cover shared fragment content. A registry
 * without one has no canaries; `null` means the file exists but can't be read or decoded.
 */
export const readCanaries = (
  registryDir: string,
): Effect.Effect<ReadonlyArray<string> | null, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = (yield* Path.Path).join(registryDir, "canaries.json");
    const read = yield* Effect.result(fs.readFileString(path));
    if (Result.isFailure(read)) return read.failure.reason._tag === "NotFound" ? [] : null;
    const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(Canaries))(read.success);
    return Result.isSuccess(decoded) ? decoded.success.stacks : null;
  });

/**
 * Holds `runs.json.lock` (an atomic mkdir) so parallel appends can't drop each other's record.
 * Waits up to a minute for another holder; the lock is removed when the caller's scope closes.
 */
const ledgerLock = (target: string, invalid: () => InvalidConfig) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const lock = `${target}.lock`;
    yield* Effect.acquireRelease(
      fs.makeDirectory(lock).pipe(
        Effect.retry({
          schedule: Schedule.spaced(Duration.millis(100)),
          times: 600,
          while: (error) => error.reason._tag === "AlreadyExists",
        }),
        Effect.mapError(invalid),
      ),
      () => fs.remove(lock, { recursive: true }).pipe(Effect.ignore),
    );
  });

/** The ledger file's text: the raw records, then the new one, as two-space JSON. */
function encodeLedger(records: ReadonlyArray<unknown>): string {
  return `${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`;
}

/** Atomically replace the envelope, preserving unknown records and cleaning up on failure. */
export const appendRecord = (
  registryDir: string,
  record: LedgerRecord,
): Effect.Effect<void, InvalidConfig, FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const target = path.join(registryDir, "runs.json");
      const invalid = () => new InvalidConfig({ details: { path: target } });
      const decoded = yield* Schema.decodeUnknownEffect(LedgerRecord)(record).pipe(
        Effect.mapError(invalid),
      );
      yield* ledgerLock(target, invalid);
      // Read only after taking the lock, so a record appended meanwhile is kept.
      const { present, ledger } = yield* readEnvelope(registryDir);
      if (present && ledger === null) return yield* invalid();
      const text = encodeLedger([...(ledger?.records ?? []), decoded]);
      yield* replaceFile(target, text).pipe(Effect.mapError(invalid));
    }),
  );
