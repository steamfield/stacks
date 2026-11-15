/**
 * Checks the author credits file of a registry when `stacks validate` runs on a whole root.
 *
 * `authors.json` maps an entry key (`stack/<id>` or `fragment/<id>`) to the GitHub login of the
 * person who owns it, the one who may update it. `stacks submit` records the login for each
 * submitted entry (`core/submit/assemble.ts`). `core/validate/index.ts` runs `authorChecks`, which
 * errors when the file doesn't decode or when a key names no entry in that root.
 */
import { authorKey } from "@steamfield/stacks-format";
import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import { decodeAuthors, readSearchFile } from "../search/sidecar";
import type { Check } from "./types";

const issue = (check: string, message: string): Finding => ({
  check,
  severity: "error",
  file: "authors.json",
  message,
});

/**
 * A registry root's `authors.json` (the bundled one holds it): it decodes, and every key names an
 * entry in that root, so a removed or renamed entry can't leave a credit behind. Checked only
 * when the whole root is validated.
 */
export const authorChecks: Check = Effect.fn("validate.authors")(function* (view) {
  if (view.only !== undefined) return { findings: [] };
  const bytes = yield* readSearchFile(view.root, "authors.json");
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
