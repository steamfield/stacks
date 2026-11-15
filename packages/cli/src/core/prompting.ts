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
import { listResult, projectChoices } from "./list";
import { MANIFEST_PATH, readManifest } from "./manifest";
import { defaultRoots, Registry } from "./registry/registry";
import type { NewOptions } from "./scaffold/new";
import { shellArg } from "./shell";
import { slug } from "./slug";
import { printable } from "./text";

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

/** Shared with the handoff picker: terminal writes retain the normal safe error mapping. */
export const displayPicker = (terminal: Terminal.Terminal, text: string) =>
  terminal.display(text).pipe(
    Effect.mapError((error) => {
      const cause = error.reason.cause;
      return typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "EPIPE"
        ? new BrokenPipe()
        : new PermissionDenied({ details: { reason: "write" } });
    }),
  );

type Choice<A> = { label: string; value: A };

const promptSession = Effect.gen(function* () {
  const terminal = yield* Terminal.Terminal;
  const read = (question: string) =>
    Effect.andThen(
      displayPicker(terminal, question),
      terminal.readLine.pipe(Effect.mapError(() => new Interrupted())),
    );
  const select = <A>(input: {
    title: string;
    choices: ReadonlyArray<Choice<A>>;
    multiple?: "optional" | "required";
    defaultIndex?: number;
  }) =>
    Effect.gen(function* () {
      if (!input.choices.length && !input.multiple) return yield* new Usage();
      yield* displayPicker(
        terminal,
        `\n${input.title} (Ctrl+C to quit)\n${input.choices
          .map((choice, index) => `  ${index + 1}) ${printable(choice.label)}\n`)
          .join("")}`,
      );
      while (true) {
        const answer = (yield* read(selectionQuestion(input))).trim();
        const indices = selectionIndices(answer, input);
        const chosen = indices?.map((index) => input.choices[index]);
        if (chosen?.every((choice) => choice !== undefined))
          return chosen.map((choice) => choice.value);
        yield* displayPicker(terminal, "Choose a listed number.\n");
      }
    });
  const one = <A>(input: Omit<Parameters<typeof select<A>>[0], "multiple">) =>
    select(input).pipe(
      Effect.flatMap((values) => {
        const value = values[0];
        return value === undefined ? Effect.fail(new Usage()) : Effect.succeed(value);
      }),
    );
  return { read, select, one };
});

function selectionQuestion(input: { multiple?: "optional" | "required"; defaultIndex?: number }) {
  if (input.multiple === "optional") return "Numbers, separated by commas (Enter for none): ";
  if (input.multiple === "required") return "Numbers, separated by commas (at least one): ";
  if (input.defaultIndex !== undefined) return `Number (Enter for ${input.defaultIndex + 1}): `;
  return "Number: ";
}

function selectionIndices(
  answer: string,
  input: { multiple?: "optional" | "required"; defaultIndex?: number },
) {
  if (answer === "") {
    if (input.multiple === "optional") return [];
    return input.defaultIndex === undefined ? undefined : [input.defaultIndex];
  }
  const parts = answer.split(",").map((part) => part.trim());
  if ((!input.multiple && parts.length !== 1) || parts.some((part) => !/^[1-9]\d*$/.test(part)))
    return undefined;
  return [...new Set(parts.map((part) => Number(part) - 1))];
}

const rowChoice = (row: ListRow): Choice<string> => ({
  label: `${row.id}: ${row.description} (${row.origin}${row.trusted ? "" : ", untrusted"})`,
  value: row.id,
});

const catalog = Effect.gen(function* () {
  return listResult(yield* (yield* Registry).all, undefined).entries;
});

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
  const choices = rows.filter(
    (row) =>
      row.kind === "fragment" &&
      !included.includes(row.id) &&
      fitsStack(row.appliesTo ?? [], { id: stack, tags: entry.meta.tags }),
  );
  const withIds = input.with.length
    ? input.with
    : yield* prompt.select({
        title: "Optional fragments",
        choices: choices.map(rowChoice),
        multiple: "optional",
      });
  const preset = yield* pickPreset(input, prompt);
  const defaultDir = input.name === undefined ? stack : slug(input.name);
  const dir =
    input.dir ??
    ((yield* prompt.read(`\nProject directory (Enter for ${printable(defaultDir)}): `)) ||
      defaultDir);
  return { stack, with: withIds, preset, dir };
});

const pickPreset = Effect.fn("prompting.pickPreset")(function* (
  input: Pick<NewOptions, "preset" | "sandbox" | "dryRun">,
  prompt: Effect.Success<typeof promptSession>,
) {
  if (input.preset !== undefined) return input.preset;
  if (input.sandbox) return "sandbox";
  const settings = yield* (yield* AppConfig).get;
  const preset = input.dryRun ? "default" : (settings.preset ?? "default");
  const choices = [
    { label: "Default", value: "default" },
    { label: "Sandbox (local only, implies --yes)", value: "sandbox" },
    { label: "Lean (no default fragments)", value: "lean" },
  ] as const;
  return yield* prompt.one<NewPreset>({
    title: "Composition preset",
    choices: [...choices],
    defaultIndex: Math.max(
      0,
      choices.findIndex((choice) => choice.value === preset),
    ),
  });
});

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
  const fragments = yield* prompt.select({
    title: "Fragments to add",
    choices: addable.map(rowChoice),
    multiple: "required",
  });
  return fragments;
});

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
  const row = yield* prompt.one({ title: "Copy source", choices });
  return { kind: row.kind, id: row.id, from: row.origin };
});

/** Reconstruct from parsed values, never argv; shell quoting also protects picked paths. */
export function replayFlags(
  flags: Readonly<Record<string, string | boolean | ReadonlyArray<string> | undefined>>,
) {
  return Object.entries(flags).flatMap(([name, value]) => {
    if (value === undefined || value === false) return [];
    if (value === true) return [`--${name}`];
    if (typeof value === "string") return [`--${name}`, value];
    return value.length ? [`--${name}`, value.join(",")] : [];
  });
}

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
