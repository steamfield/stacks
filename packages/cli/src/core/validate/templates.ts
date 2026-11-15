/**
 * Warns, during `stacks validate`, about a GitHub Actions expression such as `${{ github.ref }}`
 * in a shipped `.tmpl` file.
 *
 * A file whose name ends in `.tmpl` is rendered when `stacks new` or `stacks add` writes it: each
 * `{{ name }}` token is replaced with a value such as the project name, and an unknown name fails
 * the render (`core/template.ts`). An Actions expression holds the same braces, so in a template
 * it is read as a template variable. The fix is to ship such a file without `.tmpl`. `index.ts`
 * runs `templateChecks` over the shipped files `sources.ts` read; a known variable is let through.
 */
import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import type { Entry } from "../registry/entry";
import { TEMPLATE_VARIABLES } from "../template";
import type { Source } from "./sources";
import type { Check, View } from "./types";
import { finding } from "./view";

function templateFindings(view: View, entry: Entry, file: Source): Finding[] {
  if (!file.source.endsWith(".tmpl")) return [];
  const findings: Finding[] = [];
  for (const match of file.text.matchAll(/\$\{\{[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\}\}/g)) {
    if (TEMPLATE_VARIABLES.some((name) => name === match[1])) continue;
    findings.push(
      finding(entry, {
        check: "template-expression",
        severity: "warning",
        file: view.file(entry, file.source),
        line: file.text.slice(0, match.index).split("\n").length,
        message: `${match[0]} is read as a template variable; ship Actions expressions without .tmpl`,
      }),
    );
  }
  return findings;
}

export const templateChecks: Check = (view) =>
  Effect.sync(() => ({
    findings: view.entries.flatMap((entry) =>
      (view.sources.get(entry.dir)?.files ?? []).flatMap((file) =>
        templateFindings(view, entry, file),
      ),
    ),
  }));
