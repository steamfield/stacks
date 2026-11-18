/**
 * Builds an ordered composition from entries read through `Registry` without executing them
 * (trust point 1). The brief, manifest and fingerprint depend on list order, which digest tests pin.
 */
import { APP_TAG, shippedPath, withStepDefaults } from "@steamfield/stacks-format";
import { Effect } from "effect";
import {
  BadInput,
  type ComposeConflict,
  EntryInvalid,
  type NotFound,
  type PermissionDenied,
} from "../../errors";
import {
  DEFAULT_PAYLOAD,
  type Entry,
  entryKey,
  entryRef,
  isFragment,
  markdownFile,
  type Payload,
  type Stack,
} from "../registry/entry";
import { Registry } from "../registry/registry";
import { type ConditionContext, resolveConditionals } from "./conditionals";
import { conflict, parties } from "./conflicts";
import { contextFor, mountComposition } from "./mount";
import { stackEntries } from "./part-entries";
import { planFiles } from "./plan-files";
import { selectFragments } from "./selection";
import type {
  ComposedPart,
  ComposedStep,
  ComposeOptions,
  Composition,
  CompositionEntryRef,
  MissingTool,
  MountedEntry,
  MountRoot,
} from "./types";

/** The step tag `--sandbox` skips by default (`verify --all` still runs it). */
const PROD_TAG = "prod";

type ComposeError = NotFound | BadInput | EntryInvalid | ComposeConflict | PermissionDenied;

export function compose(
  options: ComposeOptions,
): Effect.Effect<Composition, ComposeError, Registry>;
export function compose(
  options: ComposeOptions<"add">,
): Effect.Effect<Composition<Entry | null>, ComposeError, Registry>;
export function compose(
  options: ComposeOptions<"new" | "add">,
): Effect.Effect<Composition<Entry | null>, ComposeError, Registry> {
  return Effect.gen(function* () {
    const registry = yield* Registry;
    const selected = yield* selectFragments(registry, options);
    const { stack, via, warnings, existing } = selected;
    const mounted = yield* mountComposition({
      workspace: mountRoot(stack, options),
      parts: selected.parts,
      fragments: selected.ordered,
      applied: selected.appliedEntries,
    });
    const payload = options.payload ?? DEFAULT_PAYLOAD;
    const payloads = yield* checkPayload(registry, stackEntries(stack, mounted.parts), payload);
    const root = conditionContext(options, {
      stack,
      // The workspace and root fragments see the workspace's own payload, the one its files use.
      payload: (stack ? payloads.get(entryKey(stack.kind, stack.id)) : undefined) ?? payload,
      ids: [...existing, ...mounted.fragments.map((fragment) => fragment.id)],
      roles: mounted.parts.map((part) => part.mount.role),
    });
    const placed = { parts: mounted.parts, placed: [...mounted.fragments, ...mounted.applied] };
    const contextOf = (entry: MountedEntry) => contextFor(entry, root, { ...placed, payloads });
    const resolve = resolver(registry, contextOf);
    const resolvedStack = stack ? yield* resolve(stack) : null;
    const parts = yield* Effect.forEach(mounted.parts, (part) => resolvePart(part, resolve));
    const fragments = yield* Effect.forEach(mounted.fragments, resolve);
    // In add mode the project already has the stack and its parts, so only the new fragments
    // emit anything.
    const entries: ReadonlyArray<MountedEntry> = [
      ...(options.mode === "new" ? stackEntries(resolvedStack, parts) : []),
      ...fragments,
    ];
    const addNotes = yield* recipeNotes(
      registry,
      { mode: options.mode, contextOf },
      {
        fragments: mounted.fragments,
        sources: [...stackEntries(stack, mounted.parts), ...mounted.applied],
      },
    );
    const inferred =
      !stack && options.inferredTags !== undefined ? { inferredTags: options.inferredTags } : {};
    const app = fragments.find((fragment) => fragment.meta.category === "app") ?? null;

    return {
      stack: resolvedStack,
      fragments,
      ...(parts.length ? { parts } : {}),
      app,
      addNotes,
      ...inferred,
      selection: fragments.map((fragment) => ({
        id: fragment.id,
        via: via.get(fragment.id) ?? "requires",
      })),
      preset: options.preset,
      ...variant(options.lean, payload),
      agents: options.agents,
      files: yield* planFiles(registry, entries, {
        agents: options.agents,
        stack: stack?.id ?? null,
        payload,
        payloads,
      }),
      verify: yield* steps(entries, app, options.preset === "sandbox"),
      commands: mergeCommands(entries),
      env: yield* mergeEnv(entries),
      decisions: decisions(entries, resolvedStack),
      tools: toolOwners(entries),
      deps: mergeDeps(entries),
      needsOwnRepo: fragments.filter((fragment) => fragment.meta.needsOwnRepo).map((f) => f.id),
      untrusted: untrustedEntries([...entries, ...addNotes.map((note) => note.entry)]),
      warnings,
    } satisfies Composition<Entry | null>;
  });
}

/**
 * For an add without a known stack, inferred tags stand in for stack tags when resolving
 * conditionals.
 */
function conditionContext(
  options: ComposeOptions<"new" | "add">,
  composed: {
    stack: Entry | null;
    payload: Payload;
    ids: ReadonlyArray<string>;
    roles: ReadonlyArray<string>;
  },
): ConditionContext {
  const { stack, payload, ids, roles } = composed;
  return {
    stack: stack?.id ?? "",
    tags: stack?.meta.tags ?? options.inferredTags ?? [],
    mode: options.mode,
    preset: options.preset,
    with: ids,
    payload,
    ...(roles.length ? { partRoles: roles } : {}),
  };
}

/**
 * What the parts mount under: the stack, or in add mode the manifest's workspace id when no
 * registry has that stack, so the project's parts still place what is added.
 */
function mountRoot(stack: Stack | null, options: ComposeOptions<"new" | "add">): MountRoot | null {
  if (stack) return { id: stack.id, entry: stack };
  if (options.mode === "add" && options.workspace !== undefined)
    return { id: options.workspace, entry: null };
  return null;
}

const resolvePart = (
  part: ComposedPart,
  resolve: (entry: MountedEntry) => Effect.Effect<MountedEntry, EntryInvalid | PermissionDenied>,
): Effect.Effect<ComposedPart, EntryInvalid | PermissionDenied> =>
  part.entry
    ? Effect.map(resolve(part.entry), (entry) => ({ mount: part.mount, entry }))
    : Effect.succeed(part);

/** Lean and a non-default payload are recorded only when chosen, so other compositions are unchanged. */
const variant = (lean: boolean | undefined, payload: Payload) => ({
  ...(lean ? { lean: true } : {}),
  ...(payload === DEFAULT_PAYLOAD ? {} : { payload }),
});

const shipsPayload = (registry: Registry["Service"], stack: Entry, payload: Payload) =>
  Effect.map(registry.files(stack), (files) =>
    files.some((file) => {
      const condition = shippedPath(file.source)?.condition;
      return condition?.kind === "payload" && condition.id === payload;
    }),
  );

/**
 * A payload other than the example must be one some stack-kind entry ships under
 * `payloads/<variant>/`. In a workspace each part that lacks it uses the example; the result maps
 * those entries (by `entryKey`) to the payload they get instead.
 */
const checkPayload = Effect.fn("compose.checkPayload")(function* (
  registry: Registry["Service"],
  stacks: ReadonlyArray<Entry>,
  payload: Payload,
) {
  const fallback = new Map<string, Payload>();
  if (!stacks.length || payload === DEFAULT_PAYLOAD) return fallback;
  for (const stack of stacks)
    if (!(yield* shipsPayload(registry, stack, payload)))
      fallback.set(entryKey(stack.kind, stack.id), DEFAULT_PAYLOAD);
  // Keyed by entry, so one stack mounted as two parts counts once.
  const keys = new Set(stacks.map((stack) => entryKey(stack.kind, stack.id)));
  if (fallback.size === keys.size)
    return yield* new BadInput({ details: { id: payload, flag: "payload" } });
  return fallback;
});

type Contexts = {
  mode: "new" | "add";
  contextOf: (entry: MountedEntry) => ConditionContext;
};

/**
 * Add mode only: for each added fragment, the blocks of the stack, its parts and the already
 * applied fragments that name it with `with=`, so the brief can tell the agent how the existing
 * recipe expects the new fragment to fit. An entry with no such block contributes nothing.
 */
const recipeNotes = Effect.fn("compose.recipeNotes")(function* (
  registry: Registry["Service"],
  contexts: Contexts,
  { fragments, sources }: { fragments: ReadonlyArray<Entry>; sources: ReadonlyArray<MountedEntry> },
) {
  const notes: Array<{ fragment: string; entry: Entry }> = [];
  if (contexts.mode !== "add") return notes;
  for (const fragment of fragments)
    for (const source of sources) {
      const entry = yield* resolver(registry, contexts.contextOf, fragment.id)(source);
      if (entry.body.trim()) notes.push({ fragment: fragment.id, entry });
    }
  return notes;
});

/** Resolves an entry's body against its own condition context (`contextFor`). */
function resolver(
  registry: Registry["Service"],
  contextOf: (entry: MountedEntry) => ConditionContext,
  withFragment?: string,
) {
  return <E extends MountedEntry>(entry: E) =>
    Effect.gen(function* () {
      const resolved = resolveConditionals(entry.body, contextOf(entry), withFragment);
      if ("text" in resolved) return { ...entry, body: resolved.text };
      // The body is the file's tail, so the lines before it are the difference in line counts.
      const file = markdownFile(entry.kind);
      const text = yield* registry.read(entry, file);
      const offset = text.split("\n").length - entry.body.split("\n").length;
      return yield* new EntryInvalid({
        details: {
          id: entry.id,
          origin: entry.origin,
          reason: "conditional",
          path: file,
          line: resolved.line + offset,
          problem: resolved.problem,
        },
      });
    });
}

/** Verify steps in composition order, defaults applied, names unique, the app's tagged `app`. */
function steps(entries: ReadonlyArray<Entry>, app: Entry | null, sandbox: boolean) {
  return Effect.gen(function* () {
    const owners = new Map<string, Entry>();
    const out: ComposedStep[] = [];
    for (const entry of entries)
      for (const step of entry.meta.verify) {
        const prior = owners.get(step.name);
        if (prior !== undefined)
          return yield* conflict({
            reason: "step_name",
            ...parties([prior, entry]),
            step: step.name,
          });
        owners.set(step.name, entry);
        const resolved = withStepDefaults(step);
        const tags = entry === app ? [...resolved.tags, APP_TAG] : resolved.tags;
        out.push({
          ...resolved,
          tags,
          owner: entryRef(entry),
          skipByDefault: sandbox && tags.includes(PROD_TAG),
        });
      }
    return out;
  });
}

/** Later entries replace earlier commands with the same key. */
export function mergeCommands(entries: ReadonlyArray<Entry>): Record<string, string> {
  return Object.fromEntries(entries.flatMap((entry) => Object.entries(entry.meta.commands)));
}

/** Fold env in composition order and reject different defaults for the same key. */
export function mergeEnv(entries: ReadonlyArray<Entry>) {
  return Effect.gen(function* () {
    const env = new Map<string, { value: string; owner: Entry }>();
    for (const entry of entries)
      for (const [key, value] of Object.entries(entry.meta.env)) {
        const prior = env.get(key);
        if (prior && prior.value !== value)
          return yield* conflict({ reason: "env", ...parties([prior.owner, entry]), key });
        if (!prior) env.set(key, { value, owner: entry });
      }
    return Object.fromEntries([...env].map(([key, { value }]) => [key, value]));
  });
}

/** Every entry's decisions in composition order; a fragment's are prefixed with its id. */
function decisions(entries: ReadonlyArray<Entry>, stack: Entry | null): Composition["decisions"] {
  return entries.flatMap((entry) =>
    entry.meta.decisions.map((text) => ({
      owner: entryRef(entry),
      text: entry === stack ? text : `${entry.id}: ${text}`,
    })),
  );
}

function toolOwners(entries: ReadonlyArray<Entry>): Composition["tools"] {
  const tools = (entry: Entry) =>
    isFragment(entry) ? [...entry.meta.tools, ...entry.meta.requiresTools] : entry.meta.tools;
  return grouped(entries, tools).map(([tool, owners]) => ({ tool, owners: owners.map(entryRef) }));
}

/** Items each entry names, in first-seen order, with the entries that named each. */
function grouped(
  entries: ReadonlyArray<Entry>,
  items: (entry: Entry) => ReadonlyArray<string>,
): Array<[string, Entry[]]> {
  const owners = new Map<string, Entry[]>();
  for (const entry of entries)
    for (const item of new Set(items(entry)))
      owners.set(item, [...(owners.get(item) ?? []), entry]);
  return [...owners];
}

/**
 * Declared dependencies grouped by role in first-seen order, names deduplicated. An entry that
 * lists a role with no names doesn't count as one of its owners.
 */
function mergeDeps(entries: ReadonlyArray<Entry>): Composition["deps"] {
  const roles = new Map<string, { names: string[]; owners: Entry[] }>();
  for (const entry of entries)
    for (const [role, names] of Object.entries(entry.meta.deps)) {
      const at = roles.get(role) ?? { names: [], owners: [] };
      at.names = [...new Set([...at.names, ...names])];
      if (names.length && !at.owners.includes(entry)) at.owners.push(entry);
      roles.set(role, at);
    }
  return [...roles].map(([role, { names, owners }]) => ({
    role,
    names,
    owners: owners.map(entryRef),
  }));
}

/**
 * Include every recipe that contributes prose in handoff trust (trust point 3). List each
 * untrusted directory once because a recipe can contribute notes for several additions.
 */
function untrustedEntries(contributors: ReadonlyArray<Entry>): Composition["untrusted"] {
  const byDir = new Map(contributors.map((entry) => [entry.dir, entry]));
  return [...byDir.values()]
    .filter((entry) => !entry.trusted)
    .map(({ id, kind, origin, dir }) => ({ id, kind, origin, dir }));
}

/**
 * Use `dropFlags` for the selections that would remove the tool's owners.
 */
export function missingTools(
  composition: Composition<Entry | null>,
  found: (tool: string) => boolean,
): MissingTool[] {
  return composition.tools
    .filter(({ tool }) => !found(tool))
    .map(({ tool, owners }) => ({ tool, owners, drop: dropFlags(composition, owners) }));
}

/**
 * The hint must remove every owner and each fragment that requires one. Use `--without` for defaults or always
 * selections and remove `--with` for explicit selections. Transitive requirements need no flag of
 * their own. The stack and its required fragments cannot be dropped.
 */
export function dropFlags(
  composition: Composition<Entry | null>,
  owners: ReadonlyArray<CompositionEntryRef>,
): MissingTool["drop"] {
  if (owners.some((owner) => owner.kind === "stack")) return [];
  const via = new Map(composition.selection.map((item) => [item.id, item.via]));
  const removed = withRequirers(
    composition.fragments,
    owners.map((owner) => owner.id),
  );
  if ([...removed].some((id) => via.get(id) === "required")) return [];
  return [...removed].sort().flatMap((id): MissingTool["drop"] => {
    const how = via.get(id);
    if (how === "with") return [{ id, flag: "with" }];
    return how === "default" || how === "always" ? [{ id, flag: "without" }] : [];
  });
}

function withRequirers(fragments: ReadonlyArray<Entry>, ids: ReadonlyArray<string>): Set<string> {
  const requirers = (id: string) =>
    fragments
      .filter((fragment) => isFragment(fragment) && fragment.meta.requires.includes(id))
      .map((fragment) => fragment.id);
  const removed = new Set<string>();
  const pending = [...ids];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (removed.has(id)) continue;
    removed.add(id);
    pending.push(...requirers(id));
  }
  return removed;
}
