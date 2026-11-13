import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import { proseLines } from "../brief/headings";
import type { Check } from "./types";
import { entryFile, finding } from "./view";

export const headingChecks: Check = (view) =>
  Effect.sync(() => {
    const findings: Finding[] = [];
    for (const entry of view.entries) {
      const lines = proseLines(entry.body);
      for (let index = 1; index < lines.length; index++) {
        const line = lines[index];
        const previous = lines[index - 1];
        if (
          !line ||
          !previous ||
          previous.line + 1 !== line.line ||
          !previous.text.trim() ||
          /^\s*(?:#|>|[-*+]\s|<!--)/.test(previous.text) ||
          !/^ {0,3}(?:=+|-+)\s*$/.test(line.text)
        )
          continue;
        findings.push(
          finding(entry, {
            check: "setext-heading",
            severity: "warning",
            file: entryFile(view, entry),
            line: previous.line + (view.sources.get(entry.dir)?.bodyOffset ?? 0),
            message: `underlined heading ${previous.text.trim()} keeps its own level in the brief; use an ATX heading`,
          }),
        );
      }
    }
    return { findings };
  });
