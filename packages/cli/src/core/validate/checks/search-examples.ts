/**
 * Checks project examples so published cards point readers to stacks and fragments they can
 * actually compose. `selectFragments` catches invalid selections without the cost of rendering
 * files already covered by composition checks.
 */
import type { SearchMetadata } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { selectFragments } from "../../compose/selection";
import { isRejected } from "../../registry/entry";
import { Registry } from "../../registry/registry";
import { describe } from "../compositions/compositions";
import type { View } from "../types";

type Example = NonNullable<SearchMetadata["projectExamples"]>[number];

/** Why an example's host stack can't be used: not the card's own stack, or not a valid stack. */
function hostProblem(card: SearchMetadata, stack: string, view: View): string | undefined {
  if (card.kind === "stack" && stack !== card.id)
    return `stack ${stack} must equal the card id ${card.id}.`;
  const host = view.all.find((entry) => entry.kind === "stack" && entry.id === stack);
  if (host === undefined || isRejected(host))
    return `stack ${stack} is missing, invalid or not a stack.`;
  return undefined;
}

/**
 * The problems with one example. A stack card's example defaults to that stack; a fragment card's
 * example must name its host, and the card's own fragment is added ahead of `withFragments`.
 * Selection warnings (a fragment that doesn't fit the stack, say) count as problems too.
 */
const inspectExample = Effect.fn("validate.searchExample")(function* (options: {
  card: SearchMetadata;
  example: Example;
  view: View;
  registry: Registry["Service"];
}) {
  const { card, example, view, registry } = options;
  const stack = example.stack ?? (card.kind === "stack" ? card.id : undefined);
  if (stack === undefined) return ["fragment example requires a host stack."];
  const problem = hostProblem(card, stack, view);
  if (problem !== undefined) return [problem];
  const added = [...(card.kind === "fragment" ? [card.id] : []), ...(example.withFragments ?? [])];
  const result = yield* Effect.result(
    selectFragments(registry, {
      stack,
      with: added,
      without: [],
      always: [],
      agents: [],
      preset: "default",
      mode: "new",
    }),
  );
  if (result._tag === "Failure") {
    const failure = result.failure;
    const missing =
      failure._tag === "NotFound" ? ` (${failure.details?.kind}/${failure.details?.id})` : "";
    return [`stack ${stack} with [${added.join(", ")}]: ${describe(failure).message}${missing}`];
  }
  return result.success.warnings.map(
    (warning) => `stack ${stack}, fragment ${warning.id}: ${warning.code}.`,
  );
});

/**
 * Phrases that turn a project example into build instructions or a disclaimer. An example
 * describes the finished project; set-up steps and remaining work belong in `caveats`. The list
 * holds the patterns drafted cards actually used, not a general style check. Each is a regex
 * source; curly apostrophes are straightened before matching.
 */
const HEDGES = [
  "illustrative",
  "separately",
  "yourself",
  "still the project's",
  "remains? separate",
  "you write the",
  "must be filled",
  "before using it",
  "before sharing",
  "before launch",
  "needs? additional",
  "replac(?:e|ing) the",
];
const HEDGE_PATTERN = new RegExp(`\\b(${HEDGES.join("|")})\\b`, "i");

export function hedgedExamples(card: SearchMetadata): string[] {
  return (card.projectExamples ?? []).flatMap((example, index) => {
    const text = `${example.title}\n${example.description}`.replaceAll("’", "'");
    const phrase = HEDGE_PATTERN.exec(text)?.[1];
    return phrase === undefined
      ? []
      : [
          `Project example ${index + 1} reads as instructions or a disclaimer ("${phrase}"); describe the finished project and put limits in caveats.`,
        ];
  });
}

/** Every problem across the card's examples, each prefixed with the example's 1-based position. */
export const exampleProblems = Effect.fn("validate.searchExamples")(function* (
  card: SearchMetadata,
  view: View,
) {
  const registry = yield* Registry;
  const problems = yield* Effect.forEach(card.projectExamples ?? [], (example, index) =>
    Effect.map(inspectExample({ card, example, view, registry }), (messages) =>
      messages.map((message) => `projectExamples[${index + 1}]: ${message}`),
    ),
  );
  return problems.flat();
});
