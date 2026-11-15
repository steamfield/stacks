import { Effect, Path } from "effect";
import type { Finding } from "../../schemas/validate";
import { markdownFile, type RejectedEntry } from "../registry/entry";
import { Registry, type Skipped } from "../registry/registry";
import type { Check } from "./types";
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
 * Entries that didn't load: a frontmatter that fails the schema (or isn't YAML, or is missing or
 * unreadable), an id that differs from the directory, a kind that differs from the file, a
 * symlink, and an entry skipped because its `schema_version` is newer than this CLI reads.
 */
export const loadChecks: Check = (view) =>
  Effect.gen(function* () {
    const registry = yield* Registry;
    const path = yield* Path.Path;
    const findings: Finding[] = [];
    const checkRejected = (rejected: RejectedEntry) =>
      Effect.gen(function* () {
        // `get` says why it was rejected; an unreadable entry fails PermissionDenied instead.
        const got = yield* Effect.result(registry.get(rejected.kind, rejected.id));
        const details =
          got._tag === "Failure" && got.failure._tag === "EntryInvalid"
            ? got.failure.details
            : undefined;
        const check = rejectedCheck(details?.reason, rejected.error);
        const inside =
          details?.path && details.path !== "." ? details.path : markdownFile(rejected.kind);
        findings.push(
          finding(rejected, {
            check,
            severity: "error",
            file: view.file(rejected, check === "symlink" && details?.path === "." ? "" : inside),
            message: rejected.error,
          }),
        );
      });
    for (const rejected of view.rejected) yield* checkRejected(rejected);
    // What the registry skipped under the root: a newer `schema_version`, or (in a project root) a
    // symlinked root, `stacks/` or `fragments/`, which it never follows.
    const symlinkFinding = (dir: string) => {
      const rel = path.relative(view.root, dir);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
      const name = rel === "" ? "the registry root" : `${rel.split(path.sep).join("/")}/`;
      return {
        check: "symlink",
        severity: "error",
        file: rel.split(path.sep).join("/") || ".",
        message: `${name} is a symlink, which a project registry never follows; its entries are skipped`,
      } satisfies Finding;
    };
    const checkSkipped = (skipped: Skipped) => {
      if (skipped.reason === "symlink") {
        const found = symlinkFinding(skipped.dir);
        if (found) findings.push(found);
        return;
      }
      if (!view.inRoot(skipped) || !view.wanted(skipped)) return;
      findings.push(
        finding(skipped, {
          check: "schema",
          severity: "error",
          file: view.file(skipped, markdownFile(skipped.kind)),
          message: "schema_version is newer than this CLI reads; update @steamfield/stacks",
        }),
      );
    };
    for (const skipped of yield* registry.skipped) checkSkipped(skipped);
    return { findings };
  });

/** A package name with a version in it: `pkg@1`, `@scope/pkg@^2`, `^1.0`, `>=3`, `~1`. */
const VERSIONED = /[\s^~<>=]|.@/;
const DEFAULT = /\(default\b/i;

/** Frontmatter rules the schema can't express. */
export const metadataChecks: Check = (view) =>
  Effect.sync(() => {
    const findings: Finding[] = [];
    for (const entry of view.entries) {
      const { meta } = entry;
      const file = entryFile(view, entry);
      const add = (check: string, severity: Finding["severity"], message: string) =>
        findings.push(finding(entry, { check, severity, file, message }));
      checkDecisions();
      checkDependencies();
      checkSteps();

      function checkDecisions() {
        for (const [i, decision] of meta.decisions.entries())
          if (!DEFAULT.test(decision))
            add(
              "decision-default",
              "error",
              `decisions[${i}] names no "(default" choice, so --sandbox and --yes can't proceed`,
            );
      }
      function checkDependencies() {
        for (const [role, names] of Object.entries(meta.deps))
          for (const [i, name] of names.entries())
            if (VERSIONED.test(name))
              add(
                "dep-version",
                "error",
                `deps.${role}[${i}] carries a version; deps name packages only`,
              );
      }
      function checkSteps() {
        const names = new Set<string>();
        for (const step of meta.verify) {
          if (names.has(step.name))
            add("step-names", "error", `verify step ${step.name} is declared twice`);
          names.add(step.name);
          if (step.layer === undefined)
            add("step-layer", "warning", `verify step ${step.name} has no layer`);
        }
      }
      if (meta.kind !== "stack") continue;
      const runners = meta.tags.filter((tag) => tag === "make" || tag === "scripts");
      if (runners.length !== 1)
        add(
          "task-runner-tag",
          "warning",
          runners.length
            ? "tags hold both make and scripts; a stack declares exactly one"
            : "tags hold neither make nor scripts; a stack declares exactly one",
        );
      if (!/^##[ \t]+Setup[ \t]*$/m.test(entry.body))
        add("stack-setup-section", "warning", 'no "## Setup" heading in the body');
    }
    return { findings };
  });
