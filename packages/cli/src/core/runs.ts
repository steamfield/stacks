import { RunRecord } from "@steamfield/stacks-format";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { PermissionDenied } from "../errors";
import type { ProjectRuns } from "../schemas/runs";
import { locateManifest, readManifest } from "./manifest";
import { findProjectState } from "./project-state";
import { printable } from "./text";

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

export const projectRuns = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const located = yield* locateManifest(cwd);
    const manifest = yield* readManifest(located.path);
    const state = (yield* findProjectState(manifest.projectId))?.state;
    const historyPath = path.join(located.root, ".stacks/state/runs.jsonl");
    const history = yield* fs
      .readFileString(historyPath)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed("")
            : Effect.fail(new PermissionDenied({ details: { reason: "read", path: historyPath } })),
        ),
      );
    let verifyRuns = 0;
    let lastOutcome: string | null = null;
    let skippedLines = 0;
    for (const line of history.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const decoded = yield* Effect.result(
        Effect.try({ try: () => JSON.parse(line) as unknown, catch: () => undefined }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(RunRecord)),
        ),
      );
      if (Result.isSuccess(decoded)) {
        verifyRuns++;
        lastOutcome = decoded.success.outcome;
      } else skippedLines++;
    }
    const notes = yield* Effect.option(
      fs.readFileString(path.join(located.root, ".stacks/NOTES.md")),
    );
    const minutes = (at: string | null | undefined) => {
      if (!state || !at) return null;
      const value = (Date.parse(at) - Date.parse(state.createdAt)) / 60_000;
      return Number.isFinite(value) ? value : null;
    };
    return {
      stack: manifest.stack?.id ?? null,
      fingerprint: manifest.fingerprint ?? null,
      createdAt: manifest.createdAt,
      ...(manifest.handoff ? { handoff: manifest.handoff.kind } : {}),
      briefWords: manifest.briefWords,
      verifyRuns,
      lastOutcome,
      minutesToGreen: minutes(state?.firstGreenAt),
      minutesToFirstTest: minutes(state?.firstTestPassAt),
      interventions: Option.isSome(notes) ? countAsked(notes.value) : null,
      stateRecord: state !== undefined,
      skippedLines,
    } satisfies ProjectRuns;
  });

export function renderRuns(result: ProjectRuns): string {
  const labels: ReadonlyArray<[keyof ProjectRuns, string]> = [
    ["stack", "Stack"],
    ["fingerprint", "Fingerprint"],
    ["createdAt", "Created at"],
    ["handoff", "Handoff"],
    ["briefWords", "Brief words"],
    ["verifyRuns", "Verify runs"],
    ["lastOutcome", "Last outcome"],
    ["minutesToGreen", "Minutes to green"],
    ["minutesToFirstTest", "Minutes to first successful test command (run completion)"],
    ["interventions", "Interventions"],
    ["stateRecord", "State record"],
    ["skippedLines", "Skipped lines"],
  ];
  return labels
    .filter(([key]) => result[key] !== undefined)
    .map(
      ([key, label]) =>
        `${label}: ${result[key] === null ? "unknown" : printable(String(result[key]))}`,
    )
    .join("\n");
}
