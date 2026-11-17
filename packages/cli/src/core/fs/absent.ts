/**
 * Classifies absence during path probes, where ENOTDIR rules out all descendants. Other read
 * failures mean the CLI could not look. Readers with a default for one known file treat only
 * `NotFound` as absence.
 */
import type { PlatformError } from "effect";

export const isAbsent = (error: PlatformError.PlatformError) =>
  error.reason._tag === "NotFound" || error.reason._tag === "BadResource";
