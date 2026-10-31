import { AgentId } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path, Result, Schema } from "effect";
import { InvalidConfig } from "../errors";
import { type LastRun, Ledger, LedgerRecord } from "../schemas/ledger";
import { replaceFile } from "./replace-file";

export type LedgerRead = {
  readonly present: boolean;
  readonly fileValid: boolean;
  readonly records: ReadonlyArray<LedgerRecord>;
  readonly skipped: { readonly newer: number; readonly invalid: number };
};
export type LedgerKey = Pick<LedgerRecord, "stack" | "with" | "preset" | "agent">;

/** Without a known target, an exact fingerprint decides between adapter candidates. */
export function ledgerAdapterSets(
  agent?: LedgerRecord["agent"],
): ReadonlyArray<ReadonlyArray<AgentId>> {
  if (Schema.is(AgentId)(agent)) return [[agent]];
  let sets: AgentId[][] = [[]];
  for (const id of AgentId.literals) sets = [...sets, ...sets.map((set) => [...set, id])];
  return sets.filter((set) => set.length > 0);
}

/** Keep the raw envelope for append: records a reader skips must survive a write. */
const readFile = (registryDir: string) =>
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

export const readLedger = (
  registryDir: string,
): Effect.Effect<LedgerRead, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const { present, ledger } = yield* readFile(registryDir);
    const records: LedgerRecord[] = [];
    const skipped = { newer: 0, invalid: 0 };
    for (const value of ledger?.records ?? []) {
      if (
        value !== null &&
        typeof value === "object" &&
        "schemaVersion" in value &&
        typeof value.schemaVersion === "number" &&
        value.schemaVersion > 1
      ) {
        skipped.newer++;
        continue;
      }
      const record = Schema.decodeUnknownResult(LedgerRecord)(value);
      if (Result.isSuccess(record)) records.push(record.success);
      else skipped.invalid++;
    }
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
export function lastRun(records: ReadonlyArray<LedgerRecord>, stack: string): LastRun | null {
  const found = lastDefaultRecord(records, stack);
  return found === null
    ? null
    : {
        date: found.date,
        result: found.result,
        agent: found.agent,
        preset: found.preset,
        fingerprint: found.fingerprint,
      };
}

/** Atomically replace the envelope, preserving unknown records and cleaning up on failure. */
export const appendRecord = (
  registryDir: string,
  record: LedgerRecord,
): Effect.Effect<void, InvalidConfig, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const target = path.join(registryDir, "runs.json");
    const invalid = () => new InvalidConfig({ details: { path: target } });
    const { present, ledger } = yield* readFile(registryDir);
    if (present && ledger === null) return yield* invalid();
    const decoded = yield* Schema.decodeUnknownEffect(LedgerRecord)(record).pipe(
      Effect.mapError(invalid),
    );
    const text = `${JSON.stringify({ schemaVersion: 1, records: [...(ledger?.records ?? []), decoded] }, null, 2)}\n`;
    yield* replaceFile(target, text).pipe(Effect.mapError(invalid));
  });
