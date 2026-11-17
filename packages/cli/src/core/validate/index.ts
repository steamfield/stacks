/**
 * Runs registry checks against one read-only view whose target root takes precedence when
 * resolving references. Checks collect findings so one bad entry cannot hide the rest.
 * `compareFindings` orders the findings.
 */
import { Effect, Path } from "effect";
import type { Finding, SizeRow, ValidateReport } from "../../schemas/validate";
import { defined } from "../object";
import { type Entry, isFragment, isRejected, type RegistryEntry } from "../registry/entry";
import { Registry } from "../registry/registry";
import { defaultRoots, type RegistryRoots } from "../registry/roots";
import { authorChecks } from "./checks/authors";
import { commandChecks } from "./checks/commands";
import { conditionalChecks } from "./checks/conditionals";
import { conditionalReachChecks } from "./checks/conditionals-reach";
import { datedChecks } from "./checks/dated";
import { dependencyChecks } from "./checks/deps";
import { fileChecks } from "./checks/files";
import { loadChecks, metadataChecks } from "./checks/format";
import { gitChecks } from "./checks/git";
import { headingChecks } from "./checks/headings";
import { importChecks } from "./checks/imports";
import { ledgerChecks } from "./checks/ledger-notes";
import { referenceChecks } from "./checks/references";
import { searchChecks } from "./checks/search";
import { shippedReferenceChecks } from "./checks/shipped-refs";
import { submissionChecks } from "./checks/submission";
import { templateChecks } from "./checks/templates";
import { verifyNotes } from "./checks/verify-notes";
import { versionSensitiveChecks } from "./checks/version-sensitive";
import { addCompositionChecks } from "./compositions/add-compositions";
import { composeEachChecks } from "./compositions/compose-each";
import { composedFiles, renderedFileChecks } from "./compositions/composed";
import { bodyChecks, compositionChecks } from "./compositions/compositions";
import { snapshotRegistry } from "./snapshot";
import { readSources } from "./sources";
import type { Target } from "./target";
import type { Check, SourceView, View } from "./types";
import { rootPaths } from "./view";

/** Check order also breaks ties between size rows of the same kind. */
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
  addCompositionChecks,
  verifyNotes,
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
    if (target.asBundled) return [{ origin: "bundled", path: target.root }] satisfies RegistryRoots;
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

/** Registry-wide findings (no entry) come first, then stacks, then fragments. */
const kindRank = (kind: Finding["kind"]) => {
  if (kind === undefined) return 0;
  return kind === "stack" ? 1 : 2;
};

/**
 * The order a report lists findings in: by kind and entry id (so each entry's findings group
 * together), then severity, file, line, check id and message.
 */
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

/** Whether an entry is in the validated set: every entry, or only the one `target.only` names. */
const wantedBy =
  (only: Target["only"]) =>
  (item: { kind: string; id: string }): boolean =>
    only === undefined || (only.kind === item.kind && only.id === item.id);

/**
 * The entries whose sources a check can read: the validated ones and every entry they compose
 * with. A validated fragment composes with any stack and its fragments, so that reads them all;
 * otherwise the validated stacks compose only with fragments, and reading every other origin's
 * stacks would cost time that grows with the bundled registry for nothing.
 */
function sourceEntries(
  all: ReadonlyArray<RegistryEntry>,
  validated: ReadonlyArray<RegistryEntry>,
): ReadonlyArray<Entry> {
  const entries = all.filter((item): item is Entry => !isRejected(item));
  if (entries.some((item) => validated.includes(item) && isFragment(item))) return entries;
  return entries.filter((item) => validated.includes(item) || isFragment(item));
}

const buildView = (target: Target, all: ReadonlyArray<RegistryEntry>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const { inRoot, file } = rootPaths(path, target.root);
    const wanted = wantedBy(target.only);
    const validated = all.filter((item) => inRoot(item) && wanted(item));
    const sourceView: SourceView = defined({
      root: target.root,
      asBundled: target.asBundled,
      only: target.only,
      entries: validated.filter((item): item is Entry => !isRejected(item)),
      rejected: validated.filter(isRejected),
      all,
      sources: yield* readSources(sourceEntries(all, validated)),
      wanted,
      inRoot,
      file,
    });
    // Rendering compositions is the slowest work; several checks share one run of it.
    return {
      ...sourceView,
      composed: yield* Effect.cached(composedFiles(sourceView)),
    } satisfies View;
  });

const runChecks = (view: View, list: ReadonlyArray<Check>) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const sizes: SizeRow[] = [];
    for (const check of list) {
      const result = yield* check(view);
      findings.push(...result.findings);
      sizes.push(...(result.sizes ?? []));
    }
    return { findings, sizes };
  });

function buildReport(
  view: View,
  { findings, sizes }: { findings: Finding[]; sizes: SizeRow[] },
): ValidateReport {
  const validated = [...view.entries, ...view.rejected];
  const count = (kind: "stack" | "fragment") =>
    validated.filter((item) => item.kind === kind).length;
  return {
    root: view.root,
    bundled: view.asBundled,
    entries: { stacks: count("stack"), fragments: count("fragment") },
    findings: findings.sort(compareFindings),
    // Stable sort: within a kind, rows stay in the order the checks produced them.
    sizes: sizes.sort((a, b) => sizeRank[a.kind] - sizeRank[b.kind]),
  };
}

/**
 * An unreadable root fails validation itself. For an error finding, the command uses
 * `ValidationFailed` and leaves result retention to `keepsResult`.
 */
export const validate = (target: Target, options: { submission?: boolean } = {}) =>
  Effect.gen(function* () {
    const roots = yield* validationRoots(target);
    const run = options.submission ? [...checks, submissionChecks] : checks;
    // Checks share one snapshot of the registry, so repeated compositions reuse checked reads.
    return yield* Effect.flatMap(snapshotRegistry, (registry) =>
      Effect.gen(function* () {
        const view = yield* buildView(target, yield* registry.all);
        return buildReport(view, yield* runChecks(view, run));
      }).pipe(Effect.provideService(Registry, registry)),
    ).pipe(Effect.provide(Registry.layer(roots)));
  });
