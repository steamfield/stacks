import { Effect, Result } from "effect";
import type { LedgerRecord } from "../../schemas/ledger";
import type { Finding } from "../../schemas/validate";
import { compose } from "../compose/compose";
import { fingerprint } from "../fingerprint";
import { latestRecord, ledgerAdapterSets, readLedger } from "../ledger";
import type { Entry } from "../registry/entry";
import type { Check } from "./types";
import { entryFile, finding } from "./view";

export const ledgerChecks: Check = (view) =>
  Effect.gen(function* () {
    const ledger = yield* readLedger(view.root);
    const findings: Finding[] = [];
    if (!ledger.present) return { findings };
    if (!ledger.fileValid || ledger.skipped.invalid > 0) {
      findings.push({
        check: "ledger-schema",
        severity: "error",
        file: "runs.json",
        message:
          "runs.json has an invalid ledger envelope or schema-version-1 record; ledger notes were skipped",
      });
      return { findings };
    }
    const records = ledger.records.filter((record) => record.with.length === 0);
    const checkStack = (stack: Entry) =>
      Effect.gen(function* () {
        const own = records.filter((record) => record.stack === stack.id);
        const emit = (check: string, message: string) =>
          findings.push(
            finding(stack, {
              check,
              severity: "note",
              file: entryFile(view, stack),
              message,
            }),
          );
        if (!own.some((record) => record.preset === "sandbox" && record.result === "pass"))
          emit("ledger-unproven", `${stack.id} has no sandbox pass for its default composition`);
        const keys = new Map(own.map((record) => [`${record.preset}\0${record.agent}`, record]));
        for (const key of keys.values())
          for (const note of yield* keyNotes(stack, own, key)) emit(note.check, note.message);
      });
    for (const stack of view.entries.filter((entry) => entry.kind === "stack"))
      yield* checkStack(stack);
    return { findings };
  });

const keyNotes = (stack: Entry, own: ReadonlyArray<LedgerRecord>, key: LedgerRecord) =>
  Effect.gen(function* () {
    const notes: Array<{ check: string; message: string }> = [];
    const emit = (check: string, message: string) => notes.push({ check, message });
    const latest = latestRecord(own, key);
    const label = `${stack.id} (${key.preset}, ${key.agent})`;
    if (latest?.result === "fail" || latest?.result === "partial")
      emit("ledger-failed", `${label}: latest run was ${latest.result} (${latest.date})`);
    const pass = latestRecord(
      own.filter((record) => record.result === "pass"),
      key,
    );
    if (!pass || (key.preset !== "default" && key.preset !== "sandbox")) return notes;
    const preset = key.preset;
    const currents = yield* Effect.forEach(ledgerAdapterSets(key.agent), (agents) =>
      Effect.result(
        compose({
          stack: stack.id,
          with: [],
          without: [],
          preset,
          agents,
          always: [],
          mode: "new",
        }).pipe(Effect.flatMap(fingerprint)),
      ),
    );
    if (
      currents.some(Result.isSuccess) &&
      !currents.some((current) => Result.isSuccess(current) && current.success === pass.fingerprint)
    )
      emit("ledger-changed", `${label} changed since its last green run (${pass.date})`);
    return notes;
  });
