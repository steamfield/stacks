/**
 * Compares each validated stack with its run history when `stacks validate` runs, and notes where
 * the history no longer proves the stack works.
 *
 * The ledger (`runs.json` at the registry root, read by `core/ledger.ts::readLedger`) records
 * proof runs: a stack scaffolded with a preset (`default` or `sandbox`) and an agent, verified,
 * and stamped with a pass, fail or partial result. Each record carries `fingerprint`, a hash of the
 * stack's own content and verify steps (`core/fingerprint.ts::proofFingerprint`). This module
 * recomposes the stack today, hashes it the same way and compares. A mismatch means the stack
 * changed since its last green run (`ledger-changed`).
 *
 * Only default compositions count (records that added no fragments). Records are grouped by
 * preset and agent; a key is current when its latest pass, or a pass of the same preset by another
 * agent or a scaffold proof (an agentless run), matches. Canaries, the stacks listed in
 * `canaries.json`, are held to more: a pass must match `compositionFingerprint`, the hash of the
 * whole composition, so a change to a shared fragment shows up too (`ledger-canary`).
 *
 * Everything here is a note, never a failure, because a stale proof doesn't break a project. The
 * exceptions concern the files themselves: an invalid ledger is an error (and stops the other
 * notes) and a bad `canaries.json` is a warning. Start at `ledgerChecks`.
 */
import { Effect, Result } from "effect";
import type { LedgerRecord } from "../../schemas/ledger";
import type { Finding } from "../../schemas/validate";
import { compose } from "../compose/compose";
import type { ComposeOptions } from "../compose/types";
import { fingerprint, proofFingerprint } from "../fingerprint";
import { latestRecord, ledgerAdapterSets, readCanaries, readLedger } from "../ledger";
import type { Entry } from "../registry/entry";
import type { Check } from "./types";
import { entryFile, finding } from "./view";

export const ledgerChecks: Check = (view) =>
  Effect.gen(function* () {
    const ledger = yield* readLedger(view.root);
    if (!ledger.present) return { findings: [] };
    if (!ledger.fileValid || ledger.skipped.invalid > 0) return { findings: [invalidLedger] };
    const findings: Finding[] = [];
    const canaries = yield* readCanaries(view.root);
    const stacks = view.entries.filter((entry) => entry.kind === "stack");
    // The canary list names stacks across the registry, so it is checked only on a whole root.
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

const invalidLedger: Finding = {
  check: "ledger-schema",
  severity: "error",
  file: "runs.json",
  message:
    "runs.json has an invalid ledger envelope or schema-version-1 record; ledger notes were skipped",
};

/** A note about one stack, before it is placed on the stack's markdown file. */
type Note = { check: string; message: string };

/** The presets a proof run can use; any other recorded preset can't be recomposed and checked. */
type ProvenPreset = ComposeOptions["preset"];

const isProvenPreset = (preset: string): preset is ProvenPreset =>
  preset === "default" || preset === "sandbox";

/**
 * A warning when `canaries.json` is missing or unreadable (`canaries` is null) or names a stack
 * that isn't among the validated ones.
 */
function canaryFindings(canaries: ReadonlyArray<string> | null, stacks: ReadonlyArray<Entry>) {
  const unknown = canaries?.filter((id) => !stacks.some((stack) => stack.id === id)) ?? [];
  if (canaries !== null && unknown.length === 0) return [];
  const suffix = unknown.length ? `; unknown: ${unknown.join(", ")}` : "";
  const warning: Finding = {
    check: "ledger-canaries",
    severity: "warning",
    file: "canaries.json",
    message: `canaries.json must be { "stacks": [...] } naming bundled stacks${suffix}`,
  };
  return [warning];
}

/** Every note for one stack, given its default-composition records. */
const stackNotes = (stack: Entry, own: ReadonlyArray<LedgerRecord>, canary: boolean) =>
  Effect.gen(function* () {
    const notes: Note[] = [];
    if (!own.some((record) => record.preset === "sandbox" && record.result === "pass"))
      notes.push({
        check: "ledger-unproven",
        message: `${stack.id} has no sandbox pass for its default composition`,
      });
    // One representative record per preset and agent; later records replace earlier ones.
    const keys = new Map(own.map((record) => [`${record.preset}\0${record.agent}`, record]));
    for (const key of keys.values()) notes.push(...(yield* keyNotes(stack, own, key)));
    const stale = canary ? yield* canaryStale(stack, own) : null;
    if (stale !== null) notes.push(canaryNote(stack, stale));
    return notes;
  });

function canaryNote(stack: Entry, lastPass: string): Note {
  const since = lastPass ? ` (${lastPass})` : "";
  return {
    check: "ledger-canary",
    message: `${stack.id} is a canary and shared fragments changed since its last green run${since}`,
  };
}

/**
 * The stack's fingerprints today, composed with the key's preset for each adapter set the key's
 * agent could have used (`ledgerAdapterSets`). Each composition's outcome is kept as a `Result`,
 * so one that no longer composes simply matches nothing. A preset that can't be recomposed gives
 * no fingerprints.
 */
const currentFingerprints = (
  stack: Entry,
  key: Pick<LedgerRecord, "preset" | "agent">,
  hash: typeof proofFingerprint,
) => {
  const preset = key.preset;
  if (!isProvenPreset(preset)) return Effect.succeed([]);
  return Effect.forEach(ledgerAdapterSets(key.agent), (agents) =>
    Effect.result(
      compose({
        stack: stack.id,
        with: [],
        without: [],
        preset,
        agents,
        always: [],
        mode: "new",
      }).pipe(Effect.flatMap(hash)),
    ),
  );
};

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
      if (currents.some((current) => matches(current, pass.compositionFingerprint))) return null;
    }
    return (
      passes
        .map((pass) => pass.date)
        .sort()
        .at(-1) ?? ""
    );
  });

/** Whether a recomposition succeeded with exactly the recorded fingerprint. */
const matches = (current: Result.Result<string, unknown>, recorded: string | undefined) =>
  Result.isSuccess(current) && current.success === recorded;

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
    if (!pass || !isProvenPreset(key.preset)) return notes;
    const currents = yield* currentFingerprints(stack, key, proofFingerprint);
    // When nothing composes today there is nothing to compare, so no change is claimed.
    if (!currents.some(Result.isSuccess)) return notes;
    const proofs = [pass, ...otherAgentPasses(own, key)];
    const current = currents.some((value) =>
      proofs.some((record) => matches(value, record.fingerprint)),
    );
    if (!current)
      notes.push({
        check: "ledger-changed",
        message: `${label} changed since its last green run (${pass.date})`,
      });
    return notes;
  });

/** Passes of the key's preset recorded by another agent, a scaffold proof among them. */
const otherAgentPasses = (own: ReadonlyArray<LedgerRecord>, key: LedgerRecord) =>
  own.filter(
    (record) =>
      record.result === "pass" && record.preset === key.preset && record.agent !== key.agent,
  );
