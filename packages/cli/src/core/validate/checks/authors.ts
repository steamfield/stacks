/**
 * Validates registry author credits against entries in the same root. The credited GitHub login
 * identifies who can update an entry.
 */
import { authorKey } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import type { Finding } from "../../../schemas/validate";
import { decodeAuthors, readSearchFile } from "../../search/sidecar";
import type { Check } from "../types";

const issue = (check: string, message: string): Finding => ({
  check,
  severity: "error",
  file: "authors.json",
  message,
});

/** Whole-root validation catches orphan credits after an entry is removed or renamed. */
export const authorChecks: Check = Effect.fn("validate.authors")(function* (view) {
  if (view.only !== undefined) return { findings: [] };
  const io = { fs: yield* FileSystem.FileSystem, path: yield* Path.Path };
  const bytes = yield* readSearchFile(io, view.root, "authors.json");
  if (bytes === undefined) return { findings: [] };
  const decoded = yield* Effect.result(decodeAuthors(bytes));
  if (decoded._tag === "Failure")
    return {
      findings: [
        issue(
          "authors-invalid",
          'Cannot decode authors.json: keys are "stack/<id>" or "fragment/<id>", values GitHub logins.',
        ),
      ],
    };
  const present = new Set(
    view.all.filter(view.inRoot).map((entry) => authorKey(entry.kind, entry.id)),
  );
  return {
    findings: Object.keys(decoded.success)
      .filter((key) => !present.has(key))
      .sort()
      .map((key) => issue("authors-orphan", `${key} names no entry in this registry.`)),
  };
});
