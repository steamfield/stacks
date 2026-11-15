/**
 * The shape of one problem found in a shipped agent or editor config (a command it runs, a file it
 * names) before `validate` knows which entry's source file it came from.
 *
 * `native-refs.ts` and `shipped-refs.ts` produce these while reading a rendered config; then
 * `shipped-refs.ts` locates each in the entry that contributed it (`composed.ts::sourceOf`) and
 * turns it into a finding.
 */
import type { Finding } from "../../schemas/validate";

export type ReferenceIssue = {
  check: string;
  severity: Finding["severity"];
  /** Text to search the contributing source files for, to find the line responsible ("" for none). */
  needle: string;
  message: string;
  /** When given, picks the contributor whose parsed source holds the problem instead of `needle`. */
  matches?: (config: unknown) => boolean;
};
