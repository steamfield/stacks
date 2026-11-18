/**
 * The part roles the CLI knows and the rules a part of each role declares. Pure and below
 * `validate/`, so compose refuses an unknown role and validate reports rule breaks from one list.
 * Rules read the part's meta only, never its files (trust point 1).
 */
import type { StackMeta } from "@steamfield/stacks-format";

/** `client` roles consume another part's API, so a link fragment connects them to the api part. */
export const ROLES: ReadonlyArray<{ readonly id: "api" | "web"; readonly client: boolean }> = [
  { id: "api", client: false },
  { id: "web", client: true },
];

export const knownRole = (role: string): boolean => ROLES.some((known) => known.id === role);

export const isClientRole = (role: string): boolean =>
  ROLES.some((known) => known.id === role && known.client);

export type RoleRule = "api-port-env" | "api-healthz-serve" | "web-port-env";

type RuleProblem = { rule: RoleRule; message: string };

const apiServesHealthz = (meta: StackMeta): boolean =>
  meta.verify.some(
    (step) =>
      step.phase === "serve" &&
      step.expect !== undefined &&
      step.expect.http.includes(`\${PORT_API}`) &&
      step.expect.http.endsWith("/healthz"),
  );

/** Declared rules a part of this role breaks. An unknown role breaks none. */
export function declaredRuleProblems(role: string, meta: StackMeta): ReadonlyArray<RuleProblem> {
  const problems: RuleProblem[] = [];
  if (role === "api") {
    if (!Object.hasOwn(meta.env, "PORT_API"))
      problems.push({ rule: "api-port-env", message: "An api part declares PORT_API in env." });
    if (!apiServesHealthz(meta))
      problems.push({
        rule: "api-healthz-serve",
        message:
          "An api part has a serve step whose expect.http uses the PORT_API variable and ends in /healthz.",
      });
  }
  if (role === "web" && !Object.hasOwn(meta.env, "PORT_WEB"))
    problems.push({ rule: "web-port-env", message: "A web part declares PORT_WEB in env." });
  return problems;
}
