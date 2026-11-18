/**
 * Checks for workspace stacks (a stack with `parts`). A stub until the workspace lane fills it.
 */
import { Effect } from "effect";
import type { Check } from "../types";

/** Reports nothing yet; registered so the workspace lane only has to fill it. */
export const workspaceChecks: Check = () => Effect.succeed({ findings: [] });
