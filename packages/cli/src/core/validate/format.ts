/**
 * The first checks `stacks validate` runs on each entry: did it load at all, and does its
 * frontmatter (the YAML block at the top of `STACK.md` or `FRAGMENT.md`) follow the rules the
 * schema can't express.
 *
 * `index.ts` runs `loadChecks` first and `metadataChecks` a few groups later. The registry
 * (`core/registry/`) already decoded every entry and kept the ones it couldn't use as rejected
 * entries, or skipped them; `loadChecks` turns each of those into a finding with a check id that
 * says what went wrong. `metadataChecks` then reads the decoded metadata of the entries that did
 * load.
 */
import type { Kind } from "@steamfield/stacks-format";
import { Effect, Path } from "effect";
import type { Finding } from "../../schemas/validate";
import { type Entry, markdownFile, type RejectedEntry } from "../registry/entry";
import { Registry, type Skipped } from "../registry/registry";
import type { Check, View } from "./types";
import { entryFile, finding } from "./view";

/** What a rejected entry's error means, as a check id. */
function rejectedCheck(reason: string | undefined, error: string) {
  switch (reason) {
    case "symlink":
      return "symlink";
    case "id_mismatch":
      return "id-matches-dir";
    default:
      return error.startsWith("kind: ") && error.includes("does not match")
        ? "kind-matches-file"
        : "schema";
  }
}

/**
 * The finding for one rejected entry. The registry's `get` names the reason and the offending
 * path in `EntryInvalid`'s details; with any other failure the check id comes from the error text.
 */
const rejectedFinding = (
  registry: Registry["Service"],
  view: View,
  rejected: RejectedEntry,
): Effect.Effect<Finding> =>
  Effect.gen(function* () {
    const got = yield* Effect.result(registry.get(rejected.kind, rejected.id));
    const details =
      got._tag === "Failure" && got.failure._tag === "EntryInvalid"
        ? got.failure.details
        : undefined;
    const check = rejectedCheck(details?.reason, rejected.error);
    const inside =
      details?.path && details.path !== "." ? details.path : markdownFile(rejected.kind);
    // A symlinked entry directory is the entry itself, so the finding names the directory.
    const file = view.file(rejected, check === "symlink" && details?.path === "." ? "" : inside);
    return finding(rejected, { check, severity: "error", file, message: rejected.error });
  });

/**
 * A symlinked project root, `stacks/` or `fragments/` under the validated root, which the registry
 * never follows. Undefined for a symlink outside the root.
 */
function symlinkFinding(path: Path.Path, root: string, dir: string): Finding | undefined {
  const rel = path.relative(root, dir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const name = rel === "" ? "the registry root" : `${rel.split(path.sep).join("/")}/`;
  return {
    check: "symlink",
    severity: "error",
    file: rel.split(path.sep).join("/") || ".",
    message: `${name} is a symlink, which a project registry never follows; its entries are skipped`,
  };
}

/** An entry skipped because its `schema_version` is newer than this CLI reads. */
const newerSchemaFinding = (view: View, skipped: { kind: Kind; id: string; dir: string }) =>
  finding(skipped, {
    check: "schema",
    severity: "error",
    file: view.file(skipped, markdownFile(skipped.kind)),
    message: "schema_version is newer than this CLI reads; update @steamfield/stacks",
  });

/** The finding for something the registry skipped, when it is the validated root's concern. */
function skippedFinding(path: Path.Path, view: View, skipped: Skipped): Finding | undefined {
  if (skipped.reason === "symlink") return symlinkFinding(path, view.root, skipped.dir);
  if (!view.inRoot(skipped) || !view.wanted(skipped)) return undefined;
  return newerSchemaFinding(view, skipped);
}

/**
 * Entries that didn't load: a frontmatter that fails the schema (or isn't YAML, or is missing or
 * unreadable), an id that differs from the directory, a kind that differs from the file, a
 * symlink, and an entry skipped because its `schema_version` is newer than this CLI reads.
 */
export const loadChecks: Check = (view) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const path = yield* Path.Path;
    const findings: Finding[] = [];
    for (const rejected of view.rejected)
      findings.push(yield* rejectedFinding(registry, view, rejected));
    for (const skipped of yield* registry.skipped) {
      const found = skippedFinding(path, view, skipped);
      if (found) findings.push(found);
    }
    return { findings };
  });

/** A package name with a version in it: `pkg@1`, `@scope/pkg@^2`, `^1.0`, `>=3`, `~1`. */
const VERSIONED = /[\s^~<>=]|.@/;
/** A decision names its default choice with `(default`, which `--sandbox` and `--yes` pick. */
const DEFAULT = /\(default\b/i;

type Problem = { check: string; severity: Finding["severity"]; message: string };

/** Every decision names the choice taken by default. */
function decisionProblems(entry: Entry): Problem[] {
  return [...entry.meta.decisions.entries()]
    .filter(([, decision]) => !DEFAULT.test(decision))
    .map(([i]) => ({
      check: "decision-default",
      severity: "error",
      message: `decisions[${i}] names no "(default" choice, so --sandbox and --yes can't proceed`,
    }));
}

/** Dependencies name packages only; versions belong to the agent. */
function dependencyProblems(entry: Entry): Problem[] {
  return Object.entries(entry.meta.deps).flatMap(([role, names]) =>
    [...names.entries()]
      .filter(([, name]) => VERSIONED.test(name))
      .map(([i]) => ({
        check: "dep-version",
        severity: "error",
        message: `deps.${role}[${i}] carries a version; deps name packages only`,
      })),
  );
}

/** Each verify step has a unique name and a layer. */
function stepProblems(entry: Entry): Problem[] {
  const problems: Problem[] = [];
  const names = new Set<string>();
  for (const step of entry.meta.verify) {
    if (names.has(step.name))
      problems.push({
        check: "step-names",
        severity: "error",
        message: `verify step ${step.name} is declared twice`,
      });
    names.add(step.name);
    if (step.layer === undefined)
      problems.push({
        check: "step-layer",
        severity: "warning",
        message: `verify step ${step.name} has no layer`,
      });
  }
  return problems;
}

/** A stack declares exactly one task runner tag and has a `## Setup` section. */
function stackProblems(entry: Entry): Problem[] {
  if (entry.meta.kind !== "stack") return [];
  const problems: Problem[] = [];
  const runners = entry.meta.tags.filter((tag) => tag === "make" || tag === "scripts");
  if (runners.length !== 1)
    problems.push({
      check: "task-runner-tag",
      severity: "warning",
      message: runners.length
        ? "tags hold both make and scripts; a stack declares exactly one"
        : "tags hold neither make nor scripts; a stack declares exactly one",
    });
  if (!/^##[ \t]+Setup[ \t]*$/m.test(entry.body))
    problems.push({
      check: "stack-setup-section",
      severity: "warning",
      message: 'no "## Setup" heading in the body',
    });
  return problems;
}

/** Frontmatter rules the schema can't express. */
export const metadataChecks: Check = (view) =>
  Effect.sync(() => ({
    findings: view.entries.flatMap((entry) => {
      const file = entryFile(view, entry);
      return [
        ...decisionProblems(entry),
        ...dependencyProblems(entry),
        ...stepProblems(entry),
        ...stackProblems(entry),
      ].map(({ check, severity, message }) => finding(entry, { check, severity, file, message }));
    }),
  }));
