/**
 * The `schema` command: prints the JSON Schema of any `--json` result, the error envelope or
 * verify's live events, so an agent can validate what it parses without reading the source.
 *
 * The schemas and their names come from `core/result-schemas.ts::RESULT_SCHEMAS`. With no name the
 * command lists them; an unknown name fails as `Usage` with did-you-mean suggestions. The printed
 * document is JSON in every audience.
 */
import { Effect, Option } from "effect";
import { Argument, Command } from "effect/cli";
import { jsonSchema, RESULT_NAMES, RESULT_SCHEMAS, type ResultName } from "../core/result-schemas";
import { closest } from "../core/suggest";
import { Usage } from "../errors";
import { Output } from "../services/output";

const isResultName = (value: string): value is ResultName =>
  (RESULT_NAMES as ReadonlyArray<string>).includes(value);

/** The name argument checked against the known names; `undefined` means list them. */
const selectedName = (name: Option.Option<string>) =>
  Effect.gen(function* () {
    const typed = Option.getOrUndefined(name);
    if (typed !== undefined && !isResultName(typed))
      return yield* new Usage({
        details: {
          flag: "name",
          command: "schema",
          value: typed,
          expected: RESULT_NAMES.join(" | "),
          suggestions: closest(typed, RESULT_NAMES),
        },
      });
    return typed;
  });

/** The names and what each describes; `--json` gets `{ schemas: [{ name, describes }] }`. */
const printNames = Effect.gen(function* () {
  const output = yield* Output;
  const rows = RESULT_NAMES.map((name) => ({ name, describes: RESULT_SCHEMAS[name].describes }));
  const width = Math.max(...rows.map((row) => row.name.length));
  yield* output.result(
    { schemas: rows },
    rows.map((row) => `${row.name.padEnd(width)}  ${row.describes}`).join("\n"),
  );
});

export const schemaCommand = Command.make(
  "schema",
  {
    name: Argument.String("name").pipe(
      Argument.withDescription(
        `The JSON shape to print: ${RESULT_NAMES.join(", ")}. Omit it to list them.`,
      ),
      Argument.optional,
    ),
  },
  ({ name }) =>
    Effect.gen(function* () {
      const typed = yield* selectedName(name);
      if (typed === undefined) return yield* printNames;
      const output = yield* Output;
      const document = jsonSchema(typed);
      // The document is JSON in every mode; text modes indent it for reading.
      yield* output.result(document, JSON.stringify(document, null, 2));
    }),
).pipe(
  Command.withDescription(
    "Print the JSON Schema of a --json result, the error envelope or verify's live events, so a caller can validate what it parses. With no name, list the names. Exits 0, 2 on a usage error or an unknown name, 130 when interrupted.",
  ),
  Command.withShortDescription("Print the JSON Schema of a --json result."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "List the schema names" },
    {
      command: `${commandPath.join(" ")} verify`,
      description: "Print the schema of verify --json's result",
    },
    {
      command: `${commandPath.join(" ")} error --json`,
      description: "Print the error envelope's schema as compact JSON",
    },
  ]),
);
