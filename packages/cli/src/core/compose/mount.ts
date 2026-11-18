/**
 * Mounts a workspace's parts: where a mounted entry's files go, which part a fragment is placed
 * on, the one rewrite of a mounted entry's meta, and the condition context each entry's body sees.
 * After this step only file planning and the condition context read `mount`; everything else
 * sees ordinary meta, so a single stack composes byte for byte as it did before parts existed.
 */
import type { AgentId, VerifyStep } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { EntryInvalid } from "../../errors";
import { type Entry, entryKey, type Fragment, type Payload } from "../registry/entry";
import type { ConditionContext } from "./conditionals";
import type { ComposedPart, MountedEntry, MountRoot, PartMount, SelectedPart } from "./types";

/**
 * Per harness, the paths it reads only at the session root, so they are written at the project
 * root whichever entry ships them. `**` matches everything under the directory before it.
 */
export const SESSION_ROOT_PATHS: Readonly<Record<AgentId, ReadonlyArray<string>>> = {
  claude: [".claude/settings.json", ".claude/hooks/**", ".claude/agents/**", ".claude/commands/**"],
  codex: [".codex/**", ".agents/skills/**"],
  cursor: [".cursor/hooks.json", ".cursor/hooks/**"],
  opencode: ["opencode.json", ".opencode/**"],
};

const SESSION_ROOT = Object.values(SESSION_ROOT_PATHS).flat();

const matchesPattern = (path: string, pattern: string) =>
  pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : path === pattern;

/**
 * Whether an entry-relative output path is one a harness reads only at the session root. Matched
 * on the path alone, whatever `--agents` selected and whether it came from `files/` or `adapters/`.
 */
export function atSessionRoot(path: string): boolean {
  return SESSION_ROOT.some((pattern) => matchesPattern(path, pattern));
}

/**
 * The session-root paths for these agents as the brief names them: a `/**` pattern as its
 * directory (`.claude/hooks/`), in `agents` order, each once.
 */
export function sessionRootNames(agents: ReadonlyArray<AgentId>): ReadonlyArray<string> {
  const names = agents.flatMap((agent) => SESSION_ROOT_PATHS[agent]);
  return [...new Set(names.map((pattern) => pattern.replace(/\*\*$/, "")))];
}

/** A mounted entry's output (or merge) path: under `<mount.name>/` unless it is a session-root path. */
export function placedPath(path: string, mount: PartMount | undefined): string {
  return mount && !atSessionRoot(path) ? `${mount.name}/${path}` : path;
}

/**
 * The mount a fragment is placed on: exactly one mount's stack id named in `applies_to`, and not
 * the workspace id. Tags never place a fragment, since parts commonly share them, and the same
 * stack mounted twice names two mounts, so its fragments go to the root.
 */
export function placement(
  appliesTo: ReadonlyArray<string>,
  workspace: string,
  mounts: ReadonlyArray<PartMount>,
): PartMount | undefined {
  if (appliesTo.includes(workspace)) return undefined;
  const named = mounts.filter((mount) => appliesTo.includes(mount.stack));
  return named.length === 1 ? named[0] : undefined;
}

/**
 * The part directory joined with a step's own `cwd`, normalized; `undefined` when the result is
 * not the directory or under it (an absolute path, or `..` climbing past it).
 */
export function partCwd(dir: string, cwd: string | undefined): string | undefined {
  if (cwd === undefined) return dir;
  if (cwd.startsWith("/")) return undefined;
  const segments = [dir];
  for (const segment of cwd.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") segments.push(segment);
    else if (segments.length === 1) return undefined;
    else segments.pop();
  }
  return segments.join("/");
}

const prefixed = <V>(record: Readonly<Record<string, V>>, name: string) =>
  Object.entries(record).map(([key, value]): [string, V] => [`${name}-${key}`, value]);

/**
 * Verify steps under the part: prefixed names, `cwd` in the part directory. A bad `cwd` names the
 * workspace, or the entry itself when the registry no longer has the workspace.
 */
const mountSteps = (entry: Entry, mount: PartMount, workspace: MountRoot) =>
  Effect.forEach(entry.meta.verify, (step) => {
    const name = `${mount.name}-${step.name}`;
    const cwd = partCwd(mount.name, step.cwd);
    const blamed = workspace.entry ?? entry;
    if (cwd === undefined)
      return Effect.fail(
        new EntryInvalid({
          details: {
            id: blamed.id,
            origin: blamed.origin,
            reason: "part_cwd",
            part: mount.name,
            step: name,
          },
        }),
      );
    return Effect.succeed({ ...step, name, cwd } satisfies VerifyStep);
  });

/**
 * The entry with its meta rewritten for its mount: steps `<name>-<step>` with `cwd` joined to the
 * part directory, commands and dependency roles `<name>-<key>` (a command the workspace already
 * declares under that key is dropped, because only the workspace knows the part names, so its key
 * is deliberate), `merge` paths through `placedPath`. A `cwd` that leaves the part directory is
 * `EntryInvalid` `part_cwd`: at verify time it would still land inside the project.
 */
export function mountEntry<E extends Entry>(
  entry: E,
  mount: PartMount,
  workspace: MountRoot,
): Effect.Effect<E & { mount: PartMount }, EntryInvalid> {
  const declared = workspace.entry?.meta.commands ?? {};
  return Effect.map(mountSteps(entry, mount, workspace), (verify) => ({
    ...entry,
    mount,
    meta: {
      ...entry.meta,
      verify,
      commands: Object.fromEntries(
        prefixed(entry.meta.commands, mount.name).filter(([key]) => !Object.hasOwn(declared, key)),
      ),
      deps: Object.fromEntries(prefixed(entry.meta.deps, mount.name)),
      merge: entry.meta.merge.map((path) => placedPath(path, mount)),
    },
  }));
}

/**
 * Mounts every part and places every fragment, the selected ones and (in add mode) the ones the
 * project already has. Without a workspace or parts, the entries come back unchanged.
 */
export const mountComposition = Effect.fn("compose.mountComposition")(function* (input: {
  workspace: MountRoot | null;
  parts: ReadonlyArray<SelectedPart>;
  fragments: ReadonlyArray<Fragment>;
  applied: ReadonlyArray<Fragment>;
}) {
  const { workspace, parts } = input;
  if (!workspace || !parts.length)
    return { parts: [], fragments: input.fragments, applied: input.applied };
  const mounts = parts.map((part) => part.mount);
  const place = (fragment: Fragment) => {
    const mount = placement(fragment.meta.appliesTo, workspace.id, mounts);
    return mount ? mountEntry(fragment, mount, workspace) : Effect.succeed(fragment);
  };
  const mountPart = ({ mount, entry }: SelectedPart): Effect.Effect<ComposedPart, EntryInvalid> =>
    entry
      ? Effect.map(mountEntry(entry, mount, workspace), (part) => ({ mount, entry: part }))
      : Effect.succeed({ mount, entry: null });
  const mounted = yield* Effect.forEach(parts, mountPart);
  return {
    parts: mounted,
    fragments: yield* Effect.forEach(input.fragments, place),
    applied: yield* Effect.forEach(input.applied, place),
  };
});

/**
 * The condition context for one entry's body. The workspace and root fragments see the root
 * context. A part, and a fragment placed on one, see that part's stack id, its tags, its
 * effective payload and only the fragments placed on that part. `mode`, `preset` and `partRoles`
 * are shared.
 */
export function contextFor(
  entry: MountedEntry,
  root: ConditionContext,
  input: {
    parts: ReadonlyArray<ComposedPart>;
    placed: ReadonlyArray<MountedEntry>;
    payloads: ReadonlyMap<string, Payload>;
  },
): ConditionContext {
  const { mount } = entry;
  if (!mount) return root;
  const part = input.parts.find((candidate) => candidate.mount.name === mount.name);
  const payload = input.payloads.get(entryKey("stack", mount.stack)) ?? root.payload;
  return {
    ...root,
    stack: mount.stack,
    tags: part?.entry?.meta.tags ?? [],
    with: input.placed
      .filter((placed) => placed.mount?.name === mount.name)
      .map((placed) => placed.id),
    ...(payload === undefined ? {} : { payload }),
  };
}
