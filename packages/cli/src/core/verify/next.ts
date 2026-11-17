/**
 * Owns the next action shared by the verify report and error envelope so agents and people get the
 * same instruction.
 */
import type { FailureKind, Outcome } from "@steamfield/stacks-format";
import { BRIEF_PATH } from "../../project-layout";
import type { VerifyResult } from "../../schemas/verify";

/** Use the brief's wording for the shared next action. Green and interrupted runs have none. */
export function verifyNext(
  outcome: Outcome | "changed",
  invocation: string,
  kinds: ReadonlyArray<FailureKind> = [],
  stages?: VerifyResult["stages"],
): string | undefined {
  switch (outcome) {
    case "failed":
      return failedNext(invocation, kinds, stages);
    case "partial":
      return `this was a partial run; done means a full ${invocation} verify with outcome green.`;
    case "changed":
      return `the verify steps changed since they were recorded. Don't edit them back; ask the user to run ${invocation} verify --accept-changes from their own terminal, or to undo the change.`;
    case "green":
    case "interrupted":
      return undefined;
  }
}

/**
 * Point at the machine when every failure is `env`. Other failures point at the code or config
 * the checks exercise so the agent keeps the checks intact. If only the app failed, also point
 * at the brief's application section.
 */
function failedNext(
  invocation: string,
  kinds: ReadonlyArray<FailureKind>,
  stages: VerifyResult["stages"],
): string {
  const application =
    stages?.base === "green" && stages.app === "failed"
      ? `the application section ("Then: the application") of ${BRIEF_PATH}`
      : undefined;
  if (kinds.length > 0 && kinds.every((kind) => kind === "env"))
    return `the machine is missing something these steps need (see each reason); install or start it, ${application ? `follow ${application}, ` : ""}then run ${invocation} verify again.`;
  return application
    ? `follow ${application}, fix the code or config these steps exercise, then run ${invocation} verify again.`
    : `fix the code or config these steps exercise, not the steps, then run ${invocation} verify again.`;
}

export function nextLine(...args: Parameters<typeof verifyNext>): string | undefined {
  const next = verifyNext(...args);
  return next === undefined ? undefined : `Next: ${next}`;
}
