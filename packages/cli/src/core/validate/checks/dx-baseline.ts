/**
 * Bundled-registry policy: each stack's default composition carries the developer-experience
 * baseline the authoring guide's "Developer experience" section lists (B1 to B5 are checked here).
 */
import { Effect } from "effect";
import type { Finding } from "../../../schemas/validate";
import type { Check } from "../types";

/** Raised to "warning" once every bundled stack meets the baseline. */
export const DX_SEVERITY: Finding["severity"] = "note";

// Scaffold stub: phase 1 lane a implements it.
export const dxBaselineChecks: Check = (_view) => Effect.succeed({ findings: [] });
