import { Effect, Path } from "effect";
import type { Finding, SizeRow, ValidateReport } from "../../schemas/validate";
import { type Entry, isRejected, type RejectedEntry } from "../registry/entry";
import { defaultRoots, Registry, type RegistryRoots } from "../registry/registry";
import { authorChecks } from "./authors";
import { commandChecks } from "./commands";
import { composeEachChecks } from "./compose-each";
import { composedFiles, renderedFileChecks } from "./composed";
import { bodyChecks, compositionChecks } from "./compositions";
import { conditionalChecks } from "./conditionals";
import { conditionalReachChecks } from "./conditionals-reach";
import { datedChecks } from "./dated";
import { dependencyChecks } from "./deps";
import { fileChecks } from "./files";
import { loadChecks, metadataChecks } from "./format";
import { gitChecks } from "./git";
import { headingChecks } from "./headings";
import { importChecks } from "./imports";
import { ledgerChecks } from "./ledger-notes";
import { referenceChecks } from "./references";
import { searchChecks } from "./search";
import { shippedReferenceChecks } from "./shipped-refs";
import { snapshotRegistry } from "./snapshot";
import { readSources } from "./sources";
import { submissionChecks } from "./submission";
import type { Target } from "./target";
import { templateChecks } from "./templates";
import { versionSensitiveChecks } from "./version-sensitive";
import { type Check, rootPaths, type View } from "./view";

/** Every check group; each module owns one class of findings over the same view. */
export const checks: ReadonlyArray<Check> = [
  loadChecks,
  searchChecks,
  dependencyChecks,
  authorChecks,
  metadataChecks,
  referenceChecks,
  conditionalChecks,
  fileChecks,
  gitChecks,
  bodyChecks,
  compositionChecks,
  renderedFileChecks,
  commandChecks,
  composeEachChecks,
  conditionalReachChecks,
  datedChecks,
  headingChecks,
  importChecks,
  ledgerChecks,
  shippedReferenceChecks,
  templateChecks,
  versionSensitiveChecks,
];

/**
 * The registry roots `validate` resolves through: the target root first, so its entries shadow
 * every other origin, then this invocation's own origins. The bundled registry resolves only
 * inside itself, since it ships to users who have nobody else's user directory.
 */
export const validationRoots = (target: Target) =>
  Effect.gen(function* () {
    if (target.bundled) return [{ origin: "bundled", path: target.root }] satisfies RegistryRoots;
    const others = yield* defaultRoots;
    // The root keeps the origin it already has for this invocation; any other directory is
    // treated like the user directory, the place an author's own entries live.
    const origin = others.find((root) => root.path === target.root)?.origin ?? "user";
    return [
      { origin, path: target.root },
      ...others.filter((root) => root.path !== target.root),
    ] satisfies RegistryRoots;
  });

const severityRank = { error: 0, warning: 1, note: 2 } as const;
const kindRank = (kind: Finding["kind"]) => {
  if (kind === undefined) return 0;
  return kind === "stack" ? 1 : 2;
};
export function compareFindings(a: Finding, b: Finding): number {
  return (
    kindRank(a.kind) - kindRank(b.kind) ||
    (a.entry ?? "").localeCompare(b.entry ?? "", "en") ||
    severityRank[a.severity] - severityRank[b.severity] ||
    (a.file ?? "").localeCompare(b.file ?? "", "en") ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.check.localeCompare(b.check, "en") ||
    a.message.localeCompare(b.message, "en")
  );
}
const sizeRank = { body: 0, composed: 1, shipped: 2 } as const;

/**
 * Validates the entries under `target.root` (or the one entry `target.only` names). Never stops
 * at the first bad entry: every problem is a finding. Fails only when a root can't be read.
 * `submission` adds the readiness checks for the public registry (`validate --submission`).
 */
export const validate = (target: Target, options: { submission?: boolean } = {}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const roots = yield* validationRoots(target);
    return yield* Effect.flatMap(snapshotRegistry, (registry) =>
      Effect.gen(function* () {
        const all = yield* registry.all;
        const { inRoot, file } = rootPaths(path, target.root);
        const wanted = (item: { kind: string; id: string }) =>
          target.only === undefined ||
          (target.only.kind === item.kind && target.only.id === item.id);
        const validated = all.filter((item) => inRoot(item) && wanted(item));
        const sourceView: Omit<View, "composed"> = {
          root: target.root,
          bundled: target.bundled,
          ...(target.only === undefined ? {} : { only: target.only }),
          entries: validated.filter((item): item is Entry => !isRejected(item)),
          rejected: validated.filter((item): item is RejectedEntry => isRejected(item)),
          all,
          sources: yield* readSources(all.filter((item): item is Entry => !isRejected(item))),
          wanted,
          inRoot,
          file,
        };
        const view: View = {
          ...sourceView,
          composed: yield* Effect.cached(composedFiles(sourceView)),
        };
        const findings: Finding[] = [];
        const sizes: SizeRow[] = [];
        for (const check of options.submission ? [...checks, submissionChecks] : checks) {
          const result = yield* check(view);
          findings.push(...result.findings);
          sizes.push(...(result.sizes ?? []));
        }
        const count = (kind: "stack" | "fragment") =>
          validated.filter((item) => item.kind === kind).length;
        return {
          root: target.root,
          bundled: target.bundled,
          entries: { stacks: count("stack"), fragments: count("fragment") },
          findings: findings.sort(compareFindings),
          // Stable sort: within a kind, rows stay in the order the checks produced them.
          sizes: sizes.sort((a, b) => sizeRank[a.kind] - sizeRank[b.kind]),
        } satisfies ValidateReport;
      }).pipe(Effect.provideService(Registry, registry)),
    ).pipe(Effect.provide(Registry.layer(roots)));
  });
