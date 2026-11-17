/**
 * Summarizes project verify history, trusted timing and questions from the notes. Missing inputs
 * produce zero runs or unknown values, while unreadable history fails because reporting zero runs
 * would be misleading.
 */
import { RunRecord } from "@steamfield/stacks-format";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { PermissionDenied } from "../errors";
import { NOTES_PATH, RUNS_PATH } from "../project-layout";
import type { ProjectRuns } from "../schemas/runs";
import { locateManifest, readManifest } from "./manifest";
import { findProjectState } from "./project-state";
import { printable } from "./text";

/**
 * The fence still open after a fence marker line, or `undefined` once it closes. As in Markdown, a
 * fence closes only on a marker of the same character that is at least as long.
 */
function nextFence(fence: string | undefined, marker: string): string | undefined {
  if (!fence) return marker;
  if (marker[0] === fence[0] && marker.length >= fence.length) return undefined;
  return fence;
}

/** Nonempty list items in Asked, up to the next heading; fenced examples aren't questions. */
export function countAsked(markdown: string): number {
  let asked = false;
  let count = 0;
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      fence = nextFence(fence, marker);
      continue;
    }
    if (fence) continue;
    if (/^\s{0,3}#{1,6}\s/.test(line)) {
      if (asked) break;
      asked = /^\s{0,3}##\s+Asked\s*#*\s*$/.test(line);
    } else if (asked && /^\s{0,3}(?:[-*+]|\d+[.)])\s+\S/.test(line)) count++;
  }
  return count;
}

const decodeRunLine = Schema.decodeUnknownResult(Schema.fromJsonString(RunRecord));

/** Decoded runs, the last outcome and full green, and the count of lines that didn't decode. */
function summarizeHistory(history: string) {
  let verifyRuns = 0;
  let lastOutcome: string | null = null;
  let skippedLines = 0;
  let lastGreen: RunRecord | undefined;
  for (const line of history.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const decoded = decodeRunLine(line);
    if (Result.isSuccess(decoded)) {
      verifyRuns++;
      lastOutcome = decoded.success.outcome;
      if (decoded.success.outcome === "green" && decoded.success.tamperCheck === "full")
        lastGreen = decoded.success;
    } else skippedLines++;
  }
  return { verifyRuns, lastOutcome, skippedLines, lastGreen };
}

/** The history file's text; a missing file is empty, any other failure is `PermissionDenied`. */
const readHistory = (historyPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .readFileString(historyPath)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed("")
            : Effect.fail(new PermissionDenied({ details: { reason: "read", path: historyPath } })),
        ),
      );
  });

/** Minutes from `createdAt` to `at`, or null when either is missing or not a valid date. */
function minutesBetween(createdAt: string | undefined, at: string | null | undefined) {
  if (!createdAt || !at) return null;
  const value = (Date.parse(at) - Date.parse(createdAt)) / 60_000;
  return Number.isFinite(value) ? value : null;
}

export const projectRuns = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const located = yield* locateManifest(cwd);
    const manifest = yield* readManifest(located.path);
    const state = (yield* findProjectState(manifest.projectId))?.state;
    const history = summarizeHistory(yield* readHistory(path.join(located.root, RUNS_PATH)));
    const notes = yield* Effect.option(fs.readFileString(path.join(located.root, NOTES_PATH)));
    return {
      stack: manifest.stack?.id ?? null,
      fingerprint: manifest.fingerprint ?? null,
      createdAt: manifest.createdAt,
      ...(manifest.handoff ? { handoff: manifest.handoff.kind } : {}),
      briefWords: manifest.briefWords,
      verifyRuns: history.verifyRuns,
      lastOutcome: history.lastOutcome,
      minutesToGreen: minutesBetween(state?.createdAt, state?.firstGreenAt),
      minutesToLastGreen: history.lastGreen ? history.lastGreen.secondsSinceCreated / 60 : null,
      minutesToFirstTest: minutesBetween(state?.createdAt, state?.firstTestPassAt),
      interventions: Option.isSome(notes) ? countAsked(notes.value) : null,
      stateRecord: state !== undefined,
      skippedLines: history.skippedLines,
    } satisfies ProjectRuns;
  });

/** Each summary field and its label, in the order the text report prints them. */
const RUN_LABELS: ReadonlyArray<[keyof ProjectRuns, string]> = [
  ["stack", "Stack"],
  ["fingerprint", "Fingerprint"],
  ["createdAt", "Created at"],
  ["handoff", "Handoff"],
  ["briefWords", "Brief words"],
  ["verifyRuns", "Verify runs"],
  ["lastOutcome", "Last outcome"],
  ["minutesToGreen", "Minutes to green"],
  ["minutesToLastGreen", "Minutes to last green"],
  ["minutesToFirstTest", "Minutes to first successful test command (run completion)"],
  ["interventions", "Interventions"],
  ["stateRecord", "State record"],
  ["skippedLines", "Skipped lines"],
];

/** A field's text value: minutes rounded to one decimal (`--json` keeps them exact). */
function shownValue(key: keyof ProjectRuns, value: ProjectRuns[keyof ProjectRuns]) {
  if (typeof value === "number" && key.startsWith("minutes")) {
    return String(Math.round(value * 10) / 10);
  }
  return printable(String(value));
}

/** One `Label: value` line per present field; null prints as `unknown`. */
export function renderRuns(result: ProjectRuns): string {
  return RUN_LABELS.filter(([key]) => result[key] !== undefined)
    .map(
      ([key, label]) =>
        `${label}: ${result[key] === null ? "unknown" : shownValue(key, result[key])}`,
    )
    .join("\n");
}
