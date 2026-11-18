/**
 * Checks for workspace stacks (a stack with `parts`), reported on the workspace's own STACK.md.
 * Each workspace is checked against its parts and the fragments it lists, read from the
 * resolution set without composing: the parts list itself, part step directories, the Declared
 * role rules, required fragments the workspace must restate, the link's `openapi-drift` step,
 * what its body must name, and keys that shadow a part's namespaced ones. Reads metadata and
 * prose only (trust point 1).
 */
import type { StackPart } from "@steamfield/stacks-format";
import { Effect, Result } from "effect";
import type { Finding } from "../../../schemas/validate";
import { mountEntry, placement } from "../../compose/mount";
import { type PartProblem, partProblems } from "../../compose/parts";
import { declaredRuleProblems, ROLES } from "../../compose/roles";
import type { PartMount } from "../../compose/types";
import { type Entry, type Fragment, isFragment, isStack, type Stack } from "../../registry/entry";
import type { Check, View } from "../types";
import { entryFile, finding } from "../view";

/** A part whose stack resolves to a stack without parts of its own. */
type MountedPart = { part: StackPart; entry: Stack };

/** An entry compose would mount, and its mount; none for a fragment that stays at the root. */
type Mountable = { entry: Entry; mount: PartMount | undefined };

/** One workspace under check, with its resolved parts and a finding builder for its file. */
type Workspace = {
  view: View;
  stack: Stack;
  parts: ReadonlyArray<MountedPart>;
  report: (severity: Finding["severity"], check: string, message: string) => Finding;
};

/** The body headings a workspace needs beside `## Setup`, which `stack-setup-section` checks. */
const HEADINGS = ["How the parts connect", "Changing the API"] as const;
/** The verify step an api part needs when the workspace requires a link. */
const OPENAPI_STEP = "openapi-drift";

export const workspaceChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    for (const stack of view.entries.filter(isStack))
      if (stack.meta.parts) findings.push(...(yield* workspaceFindings(view, stack)));
    return { findings };
  });

const workspaceFindings = Effect.fn("validate.workspace")(function* (view: View, stack: Stack) {
  const declared = stack.meta.parts ?? [];
  const lookup = (id: string) =>
    view.all.find((item): item is Stack => isStack(item) && item.id === id);
  const problems = partProblems(declared, (id) => lookup(id)?.meta);
  const workspace: Workspace = {
    view,
    stack,
    parts: declared.flatMap((part) => {
      const entry = lookup(part.stack);
      return entry && !entry.meta.parts ? [{ part, entry }] : [];
    }),
    report: (severity, check, message) =>
      finding(stack, { check, severity, file: entryFile(view, stack), message }),
  };
  return [
    ...problems.map((problem) => partProblemFinding(workspace, problem)),
    ...(yield* cwdFindings(workspace)),
    // Role rules depend on which part has which role, which a parts problem leaves unsettled.
    ...(problems.length ? [] : [...roleRuleFindings(workspace), ...openapiFindings(workspace)]),
    ...restatedFindings(workspace),
    ...bodyFindings(workspace),
    ...shadowedFindings(workspace),
  ];
});

/** One `parts.ts::partProblems` result as a finding naming the part. */
function partProblemFinding(workspace: Workspace, problem: PartProblem): Finding {
  const declared = workspace.stack.meta.parts ?? [];
  const part = declared.find((item) => item.name === problem.part);
  const check = problem.reason.replaceAll("_", "-");
  return workspace.report("error", check, partProblemMessage(problem.reason, part, declared));
}

function partProblemMessage(
  reason: PartProblem["reason"],
  part: StackPart | undefined,
  declared: ReadonlyArray<StackPart>,
): string {
  const at = `part ${part?.name}`;
  switch (reason) {
    case "part_stack":
      return `${at}: stack ${part?.stack} is not in the registry; name an existing stack`;
    case "part_role":
      return `${at}: role ${part?.role} is not one this CLI knows (${ROLES.map((role) => role.id).join(", ")})`;
    case "part_name_duplicate":
      return `${at}: another part has the same name; give each part its own name, which is its directory`;
    case "part_nested":
      return `${at}: stack ${part?.stack} has parts of its own; a part must be a stack without parts`;
    case "part_roles": {
      const clients = ROLES.filter((role) => role.client).map((role) => role.id);
      const roles = declared.map((item) => `${item.name} (${item.role})`).join(", ");
      return `the parts are ${roles}; a workspace takes exactly one api part and one client part (${clients.join(", ")})`;
    }
  }
}

/**
 * Each part, and each fragment the workspace lists that is placed on one part, mounted as compose
 * mounts it; a step `cwd` that leaves the part directory is one finding per entry, since compose
 * refuses the entry at its first such step.
 */
const cwdFindings = Effect.fn("validate.workspaceCwd")(function* (workspace: Workspace) {
  const mounts = (workspace.stack.meta.parts ?? []).map(
    ({ name, role, stack }): PartMount => ({ name, role, stack }),
  );
  const parts = workspace.parts.map(
    ({ part, entry }): Mountable => ({
      entry,
      mount: mounts.find((mount) => mount.name === part.name),
    }),
  );
  const placed = listedFragments(workspace).map(
    (fragment): Mountable => ({
      entry: fragment,
      mount: placement(fragment.meta.appliesTo, workspace.stack.id, mounts),
    }),
  );
  const findings: Finding[] = [];
  for (const { entry, mount } of [...parts, ...placed])
    if (mount) findings.push(...(yield* mountedCwdFinding(workspace, entry, mount)));
  return findings;
});

/** The fragments the workspace lists in any tier, as the resolution set has them. */
function listedFragments(workspace: Workspace): ReadonlyArray<Fragment> {
  const ids = new Set(Object.values(workspace.stack.meta.fragments).flat());
  return workspace.view.all.filter(
    (item): item is Fragment => isFragment(item) && ids.has(item.id),
  );
}

const mountedCwdFinding = (workspace: Workspace, entry: Entry, mount: PartMount) =>
  Effect.map(
    Effect.result(mountEntry(entry, mount, { id: workspace.stack.id, entry: workspace.stack })),
    (result): Finding[] => {
      if (Result.isSuccess(result)) return [];
      const mounted = result.failure.details?.step ?? "";
      const name = mounted.slice(mount.name.length + 1);
      const cwd = entry.meta.verify.find((step) => step.name === name)?.cwd;
      return [
        workspace.report(
          "error",
          "part-cwd",
          `part ${mount.name}: step ${name} in ${entryFile(workspace.view, entry)} has cwd "${cwd}", which leaves ${mount.name}/; keep cwd inside the part's directory`,
        ),
      ];
    },
  );

/** Each Declared rule a part breaks for its role. */
function roleRuleFindings(workspace: Workspace): Finding[] {
  return workspace.parts.flatMap(({ part, entry }) =>
    declaredRuleProblems(part.role, entry.meta).map(({ rule, message }) =>
      workspace.report(
        "error",
        "part-role-rule",
        `part ${part.name} (${entryFile(workspace.view, entry)}) breaks role rule ${rule}: ${message}`,
      ),
    ),
  );
}

/** A required link reads the api part's OpenAPI document, which only `openapi-drift` keeps current. */
function openapiFindings(workspace: Workspace): Finding[] {
  const api = workspace.parts.find(({ part }) => part.role === "api");
  if (!api || api.entry.meta.verify.some((step) => step.name === OPENAPI_STEP)) return [];
  const required = new Set(workspace.stack.meta.fragments.required);
  return workspace.view.all
    .filter((item): item is Fragment => isFragment(item) && required.has(item.id))
    .filter((fragment) => fragment.meta.category === "link")
    .map((link) =>
      workspace.report(
        "error",
        "link-openapi-drift",
        `required link ${link.id} needs the api part ${api.part.name} (${entryFile(workspace.view, api.entry)}) to have a verify step named ${OPENAPI_STEP}`,
      ),
    );
}

/** A part's own tiers are never selected, so the workspace restates each part's required fragment. */
function restatedFindings(workspace: Workspace): Finding[] {
  const required = new Set(workspace.stack.meta.fragments.required);
  return workspace.parts.flatMap(({ part, entry }) =>
    entry.meta.fragments.required
      .filter((id) => !required.has(id))
      .map((id) =>
        workspace.report(
          "error",
          "part-required-restated",
          `part ${part.name} requires fragment ${id} (${entryFile(workspace.view, entry)}); add it to this workspace's fragments.required, since a part's own tiers are not selected`,
        ),
      ),
  );
}

/** The workspace headings, then every part directory named at least once in the body. */
function bodyFindings(workspace: Workspace): Finding[] {
  const body = workspace.stack.body;
  const headings = HEADINGS.filter(
    (heading) => !new RegExp(`^##[ \\t]+${heading}[ \\t]*$`, "m").test(body),
  ).map((heading) =>
    workspace.report("warning", "workspace-heading", `no "## ${heading}" heading in the body`),
  );
  const names = [...new Set((workspace.stack.meta.parts ?? []).map((part) => part.name))];
  // Part names are kebab-case, so they hold no regex syntax; the lookbehind keeps `my-frontend/`
  // from counting as `frontend/`.
  const dirs = names
    .filter((name) => !new RegExp(`(?<![\\w-])${name}/`).test(body))
    .map((name) =>
      workspace.report(
        "warning",
        "workspace-part-dirs",
        `the body never mentions ${name}/; name each part's directory at least once`,
      ),
    );
  return [...headings, ...dirs];
}

/**
 * A workspace command key equal to `<part>-<key>` replaces the part's command in the merged
 * table, and a deps role equal to `<part>-<role>` merges with the part's; both are allowed, so
 * they are warnings that keep the replacement from being silent.
 */
function shadowedFindings(workspace: Workspace): Finding[] {
  const { commands, deps } = workspace.stack.meta;
  return workspace.parts.flatMap(({ part, entry }) => [
    ...shadowed(Object.keys(commands), Object.keys(entry.meta.commands), part.name).map(
      ([key, own]) =>
        workspace.report(
          "warning",
          "part-namespace-shadowed",
          `command ${key} replaces part ${part.name}'s own ${own} command in the merged table; rename it unless that is intended`,
        ),
    ),
    ...shadowed(Object.keys(deps), Object.keys(entry.meta.deps), part.name).map(([key, own]) =>
      workspace.report(
        "warning",
        "part-namespace-shadowed",
        `deps role ${key} merges with part ${part.name}'s own ${own} role; rename it unless that is intended`,
      ),
    ),
  ]);
}

/** Each workspace key equal to a part key under the part's prefix, with the part's own key. */
function shadowed(
  keys: ReadonlyArray<string>,
  partKeys: ReadonlyArray<string>,
  name: string,
): Array<[string, string]> {
  return partKeys.flatMap((own) => {
    const key = `${name}-${own}`;
    return keys.includes(key) ? [[key, own] satisfies [string, string]] : [];
  });
}
