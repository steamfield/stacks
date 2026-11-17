/** Describes a reference problem in rendered config before `sourceOf` attributes it to an entry. */
import type { Finding } from "../../../schemas/validate";

export type ReferenceIssue = {
  check: string;
  severity: Finding["severity"];
  /** Text to search the contributing source files for, to find the line responsible ("" for none). */
  needle: string;
  message: string;
  /** When given, picks the contributor whose parsed source holds the problem instead of `needle`. */
  matches?: (config: unknown) => boolean;
};
