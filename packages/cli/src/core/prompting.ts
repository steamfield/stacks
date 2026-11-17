/**
 * Collects missing command arguments through terminal pickers gated by `canPrompt` (trust point
 * 4). Leaving writes until after selection lets Ctrl+C exit a menu without changes.
 */
import type { Kind } from "@steamfield/stacks-format";
import { Effect, Path, Terminal } from "effect";
import { AppConfig } from "../config";
import { BrokenPipe, Interrupted, PermissionDenied, Usage } from "../errors";
import type { ListRow } from "../schemas/list";
import type { NewPreset } from "../schemas/new";
import type { Origin } from "../schemas/origin";
import { Host } from "../services/host";
import { type Audience, Output } from "../services/output";
import { fitsStack } from "./compose/selection";
import { listResult, projectChoices } from "./list/index";
import { MANIFEST_PATH, readManifest } from "./project/manifest";
import { newPreset } from "./project/preset";
import { Registry } from "./registry/registry";
import { defaultRoots } from "./registry/roots";
import type { NewOptions } from "./scaffold/new";
import { shellArg } from "./text/shell";
import { slug } from "./text/slug";
import { printable } from "./text/text";

/**
 * Pickers require the human audience and both terminal streams so a person can answer
 * (trust point 4).
 */
export const canPrompt = (input: {
  audience: Audience;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
}): boolean => input.audience === "human" && input.stdinIsTTY && input.stdoutIsTTY;

export const promptingAllowed = Effect.gen(function* () {
  const host = yield* Host;
  const output = yield* Output;
  return canPrompt({ ...host, audience: output.audience });
});

/**
 * Writes picker text to the terminal. Shared with the handoff picker so a failed write maps like
 * any other output write: a closed pipe to `BrokenPipe`, anything else to `PermissionDenied`.
 */
export const displayPicker = (terminal: Terminal.Terminal, text: string) =>
  terminal
    .display(text)
    .pipe(
      Effect.mapError((error) =>
        isBrokenPipe(error.reason.cause)
          ? new BrokenPipe()
          : new PermissionDenied({ details: { reason: "write" } }),
      ),
    );

const isBrokenPipe = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EPIPE";

type Choice<A> = { label: string; value: A };

/**
 * How a picker takes its answer: one number (Enter takes `defaultIndex` when set), or a
 * comma-separated list where Enter means none (`optional`) or isn't accepted (`required`).
 */
type SelectionMode = { multiple?: "optional" | "required"; defaultIndex?: number };

type Selection<A> = SelectionMode & { title: string; choices: ReadonlyArray<Choice<A>> };

/** Shows `question` and reads one line; a closed or interrupted terminal is `Interrupted`. */
const readAnswer = (terminal: Terminal.Terminal, question: string) =>
  Effect.andThen(
    displayPicker(terminal, question),
    terminal.readLine.pipe(Effect.mapError(() => new Interrupted())),
  );

/** Shows the numbered choices, then asks until the answer names only listed numbers. */
const selectValues = <A>(terminal: Terminal.Terminal, selection: Selection<A>) =>
  Effect.gen(function* () {
    if (!selection.choices.length && !selection.multiple) return yield* new Usage();
    yield* displayPicker(terminal, menuText(selection));
    while (true) {
      const answer = (yield* readAnswer(terminal, selectionQuestion(selection))).trim();
      const chosen = chosenValues(answer, selection);
      if (chosen !== undefined) return chosen;
      yield* displayPicker(terminal, "Choose a listed number.\n");
    }
  });

const selectOne = <A>(terminal: Terminal.Terminal, selection: Omit<Selection<A>, "multiple">) =>
  selectValues(terminal, selection).pipe(
    Effect.flatMap((values) => {
      const value = values[0];
      return value === undefined ? Effect.fail(new Usage()) : Effect.succeed(value);
    }),
  );

const promptSession = Effect.map(Terminal.Terminal, (terminal) => ({
  read: (question: string) => readAnswer(terminal, question),
  select: <A>(selection: Selection<A>) => selectValues(terminal, selection),
  one: <A>(selection: Omit<Selection<A>, "multiple">) => selectOne(terminal, selection),
}));

type PromptSession = Effect.Success<typeof promptSession>;

function menuText(selection: Selection<unknown>): string {
  const rows = selection.choices.map(
    (choice, index) => `  ${index + 1}) ${printable(choice.label)}\n`,
  );
  return `\n${selection.title} (Ctrl+C to quit)\n${rows.join("")}`;
}

function selectionQuestion(mode: SelectionMode): string {
  if (mode.multiple === "optional") return "Numbers, separated by commas (Enter for none): ";
  if (mode.multiple === "required") return "Numbers, separated by commas (at least one): ";
  if (mode.defaultIndex !== undefined) return `Number (Enter for ${mode.defaultIndex + 1}): `;
  return "Number: ";
}

/** The values a trimmed answer picks, or undefined when it doesn't name only listed numbers. */
function chosenValues<A>(answer: string, selection: Selection<A>): Array<A> | undefined {
  const indices = selectionIndices(answer, selection);
  if (indices === undefined) return undefined;
  const chosen = indices.map((index) => selection.choices[index]);
  if (!chosen.every((choice) => choice !== undefined)) return undefined;
  return chosen.map((choice) => choice.value);
}

/**
 * The zero-based indices an answer names, without duplicates and in the order typed; undefined
 * when the answer isn't valid for the mode. Range is checked by the caller.
 */
function selectionIndices(answer: string, mode: SelectionMode): Array<number> | undefined {
  if (answer === "") {
    if (mode.multiple === "optional") return [];
    return mode.defaultIndex === undefined ? undefined : [mode.defaultIndex];
  }
  const parts = answer.split(",").map((part) => part.trim());
  if (!mode.multiple && parts.length !== 1) return undefined;
  if (parts.some((part) => !/^[1-9]\d*$/.test(part))) return undefined;
  return [...new Set(parts.map((part) => Number(part) - 1))];
}

const rowChoice = (row: ListRow): Choice<string> => ({
  label: `${row.id}: ${row.description} (${row.origin}${row.trusted ? "" : ", untrusted"})`,
  value: row.id,
});

/** Every usable entry across the current registry roots, as `list` shows them. */
const catalog = Effect.gen(function* () {
  return listResult(yield* (yield* Registry).all, undefined).entries;
});

/**
 * The fragments to offer for a stack: those that fit it, minus `included` (its required and
 * default fragments plus any `--without` names).
 */
function optionalFragmentRows(
  rows: ReadonlyArray<ListRow>,
  stack: { id: string; tags: ReadonlyArray<string>; included: ReadonlyArray<string> },
): ReadonlyArray<ListRow> {
  return rows.filter(
    (row) =>
      row.kind === "fragment" &&
      !stack.included.includes(row.id) &&
      fitsStack(row.appliesTo ?? [], { id: stack.id, tags: stack.tags }),
  );
}

/** Asks for each `new` argument the user didn't give: stack, optional fragments, preset, directory. */
export const pickNew = Effect.fn("prompting.pickNew")(function* (
  input: Pick<NewOptions, "dir" | "name" | "with" | "without" | "preset" | "sandbox" | "dryRun">,
) {
  const prompt = yield* promptSession;
  const rows = yield* catalog;
  const stack = yield* prompt.one({
    title: "Pick a stack",
    choices: rows.filter((row) => row.kind === "stack").map(rowChoice),
  });
  const entry = yield* (yield* Registry).get("stack", stack);
  const selected = entry.meta.kind === "stack" ? entry.meta.fragments : undefined;
  const included = [...(selected?.required ?? []), ...(selected?.default ?? []), ...input.without];
  const fragmentRows = optionalFragmentRows(rows, { id: stack, tags: entry.meta.tags, included });
  const withIds = input.with.length
    ? input.with
    : yield* prompt.select({
        title: "Optional fragments",
        choices: fragmentRows.map(rowChoice),
        multiple: "optional",
      });
  const preset = yield* pickPreset(input, prompt);
  const defaultDir = input.name === undefined ? stack : slug(input.name);
  const dir = input.dir ?? (yield* askDirectory(prompt, defaultDir));
  return { stack, with: withIds, preset, dir };
});

/** The project directory typed, or `defaultDir` on Enter. The answer isn't trimmed. */
const askDirectory = (prompt: PromptSession, defaultDir: string) =>
  prompt
    .read(`\nProject directory (Enter for ${printable(defaultDir)}): `)
    .pipe(Effect.map((answer) => answer || defaultDir));

const PRESET_CHOICES: ReadonlyArray<Choice<NewPreset>> = [
  { label: "Default", value: "default" },
  { label: "Sandbox (local only, implies --yes)", value: "sandbox" },
  { label: "Lean (no default fragments)", value: "lean" },
];

const pickPreset = Effect.fn("prompting.pickPreset")(function* (
  input: Pick<NewOptions, "preset" | "sandbox" | "dryRun">,
  prompt: PromptSession,
) {
  if (input.preset !== undefined || input.sandbox) return newPreset(input);
  // Settings are read even for a preview, so an invalid config file still fails here.
  const settings = yield* (yield* AppConfig).settings;
  // Keep the picker's historical Enter choice for dry runs while RFC Q1 is open.
  // Named-stack previews use the setting through `newPreset`.
  const preset = newPreset(input, input.dryRun ? undefined : settings.preset);
  const presetIndex = PRESET_CHOICES.findIndex((choice) => choice.value === preset);
  return yield* prompt.one<NewPreset>({
    title: "Composition preset",
    choices: PRESET_CHOICES,
    defaultIndex: Math.max(0, presetIndex),
  });
});

/**
 * Asks which fragments to add to `project`, read without a manifest when it has none. With none
 * addable it says so and returns an empty list.
 */
export const pickAdd = Effect.fn("prompting.pickAdd")(function* (project: string) {
  const path = yield* Path.Path;
  const manifest = yield* readManifest(path.join(project, MANIFEST_PATH)).pipe(
    Effect.catchTag("NotFound", () => Effect.succeed(undefined)),
  );
  const { addable } = projectChoices(yield* catalog, manifest);
  if (!addable.length) {
    yield* (yield* Output).result(null, "No fragments are available to add.");
    return [];
  }
  const prompt = yield* promptSession;
  return yield* prompt.select({
    title: "Fragments to add",
    choices: addable.map(rowChoice),
    multiple: "required",
  });
});

/** Asks what `create` should make: a skeleton (and its id) or a copy of an existing entry. */
export const pickCreate = Effect.fn("prompting.pickCreate")(function* (input: {
  kind?: Kind;
  from?: Origin;
}) {
  const prompt = yield* promptSession;
  const kind =
    input.kind ??
    (yield* prompt.one<Kind | "copy">({
      title: "Create an entry",
      choices: [
        { label: "Stack skeleton", value: "stack" },
        { label: "Fragment skeleton", value: "fragment" },
        { label: "Copy an existing entry", value: "copy" },
      ],
    }));
  if (kind !== "copy") {
    const id = yield* prompt.read(`\nNew ${kind} id (lowercase kebab-case): `);
    return { kind, id, from: input.from };
  }
  const row = yield* pickCopySource(prompt);
  return { kind: row.kind, id: row.id, from: row.origin };
});

/** Asks which entry to copy, listing trusted entries before untrusted ones. */
const pickCopySource = (prompt: PromptSession) =>
  Effect.gen(function* () {
    // Resolve each copyable origin independently: a project override must not hide its bundled copy.
    const roots = (yield* defaultRoots).filter((root) => root.origin !== "user");
    const rows = (yield* Effect.forEach(roots, (root) =>
      catalog.pipe(Effect.provide(Registry.layer([root]))),
    )).flat();
    const choices = rows
      .toSorted((a, b) => Number(b.trusted) - Number(a.trusted))
      .map((row) => ({
        label: `${row.kind} ${row.id} (${row.origin}${row.trusted ? "" : ", untrusted"})`,
        value: row,
      }));
    return yield* prompt.one({ title: "Copy source", choices });
  });

export type ReplayValue = string | boolean | ReadonlyArray<string> | undefined;

/**
 * The flags of the command a picker settled on, for the `Running:` line. Built from parsed
 * values, never argv; `runningCommand` shell-quotes them, which also protects picked paths.
 */
export function replayFlags(flags: Readonly<Record<string, ReplayValue>>) {
  return Object.entries(flags).flatMap(([name, value]) => {
    if (value === undefined || value === false) return [];
    if (value === true) return [`--${name}`];
    if (typeof value === "string") return [`--${name}`, value];
    return value.length ? [`--${name}`, value.join(",")] : [];
  });
}

/** Prints the `Running:` line for the picked command and flushes it before the command runs. */
export const runningCommand = Effect.fn("prompting.runningCommand")(function* (
  words: ReadonlyArray<string>,
) {
  const output = yield* Output;
  const host = yield* Host;
  yield* output.result(
    null,
    `\nRunning: ${printable(`${host.invocation} ${words.map(shellArg).join(" ")}`)}`,
  );
  yield* output.flushNow;
});
