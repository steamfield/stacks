import { Effect, Result } from "effect";
import type { LedgerRecord } from "../../schemas/ledger";
import type { Finding } from "../../schemas/validate";
import { compose } from "../compose/compose";
import { fingerprint, proofFingerprint } from "../fingerprint";
import { latestRecord, ledgerAdapterSets, readCanaries, readLedger } from "../ledger";
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
    const canaries = yield* readCanaries(view.root);
    const stacks = view.entries.filter((entry) => entry.kind === "stack");
    if (view.only === undefined) findings.push(...canaryFindings(canaries, stacks));
    const records = ledger.records.filter((record) => record.with.length === 0);
    for (const stack of stacks) {
      const own = records.filter((record) => record.stack === stack.id);
      for (const note of yield* stackNotes(stack, own, canaries?.includes(stack.id) ?? false))
        findings.push(
          finding(stack, {
            check: note.check,
            severity: "note",
            file: entryFile(view, stack),
            message: note.message,
          }),
        );
    }
    return { findings };
  });

type Note = { check: string; message: string };

function canaryFindings(canaries: ReadonlyArray<string> | null, stacks: ReadonlyArray<Entry>) {
  const unknown = canaries?.filter((id) => !stacks.some((stack) => stack.id === id)) ?? [];
  if (canaries !== null && unknown.length === 0) return [];
  const finding: Finding = {
    check: "ledger-canaries",
    severity: "warning",
    file: "canaries.json",
    message: `canaries.json must be { "stacks": [...] } naming bundled stacks${unknown.length ? `; unknown: ${unknown.join(", ")}` : ""}`,
  };
  return [finding];
}

const stackNotes = (stack: Entry, own: ReadonlyArray<LedgerRecord>, canary: boolean) =>
  Effect.gen(function* () {
    const notes: Note[] = [];
    if (!own.some((record) => record.preset === "sandbox" && record.result === "pass"))
      notes.push({
        check: "ledger-unproven",
        message: `${stack.id} has no sandbox pass for its default composition`,
      });
    const keys = new Map(own.map((record) => [`${record.preset}\0${record.agent}`, record]));
    for (const key of keys.values()) notes.push(...(yield* keyNotes(stack, own, key)));
    const stale = canary ? yield* canaryStale(stack, own) : null;
    if (stale !== null)
      notes.push({
        check: "ledger-canary",
        message: `${stack.id} is a canary and shared fragments changed since its last green run${stale ? ` (${stale})` : ""}`,
      });
    return notes;
  });

const currentFingerprints = (
  stack: Entry,
  key: Pick<LedgerRecord, "preset" | "agent">,
  hash: typeof proofFingerprint,
) =>
  key.preset !== "default" && key.preset !== "sandbox"
    ? Effect.succeed([])
    : Effect.forEach(ledgerAdapterSets(key.agent), (agents) =>
        Effect.result(
          compose({
            stack: stack.id,
            with: [],
            without: [],
            preset: key.preset as "default" | "sandbox",
            agents,
            always: [],
            mode: "new",
          }).pipe(Effect.flatMap(hash)),
        ),
      );

/**
 * A canary's proof must also match the whole composition, shared fragments included. Null when a
 * pass does; otherwise the latest pass's date, or "" when there is none.
 */
const canaryStale = (stack: Entry, own: ReadonlyArray<LedgerRecord>) =>
  Effect.gen(function* () {
    const passes = own.filter((record) => record.result === "pass");
    for (const pass of passes) {
      if (pass.compositionFingerprint === undefined) continue;
      const currents = yield* currentFingerprints(stack, pass, fingerprint);
      if (
        currents.some(
          (current) => Result.isSuccess(current) && current.success === pass.compositionFingerprint,
        )
      )
        return null;
    }
    return (
      passes
        .map((pass) => pass.date)
        .sort()
        .at(-1) ?? ""
    );
  });

/**
 * A key's notes. It is current when its last pass, or a pass of the same preset from another
 * agent or a scaffold proof, matches the content this key's adapters compose today.
 */
const keyNotes = (stack: Entry, own: ReadonlyArray<LedgerRecord>, key: LedgerRecord) =>
  Effect.gen(function* () {
    const notes: Note[] = [];
    const latest = latestRecord(own, key);
    const label = `${stack.id} (${key.preset}, ${key.agent})`;
    if (latest?.result === "fail" || latest?.result === "partial")
      notes.push({
        check: "ledger-failed",
        message: `${label}: latest run was ${latest.result} (${latest.date})`,
      });
    const pass = latestRecord(
      own.filter((record) => record.result === "pass"),
      key,
    );
    if (!pass || (key.preset !== "default" && key.preset !== "sandbox")) return notes;
    const currents = yield* currentFingerprints(stack, key, proofFingerprint);
    if (!currents.some(Result.isSuccess)) return notes;
    // This key's latest pass, or a pass of the same preset from another agent or a scaffold proof.
    const proofs = [
      pass,
      ...own.filter(
        (record) =>
          record.result === "pass" && record.preset === key.preset && record.agent !== key.agent,
      ),
    ];
    const current = currents.some(
      (value) =>
        Result.isSuccess(value) && proofs.some((record) => record.fingerprint === value.success),
    );
    if (!current)
      notes.push({
        check: "ledger-changed",
        message: `${label} changed since its last green run (${pass.date})`,
      });
    return notes;
  });
