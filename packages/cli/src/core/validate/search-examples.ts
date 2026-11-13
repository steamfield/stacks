import type { SearchMetadata } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { selectFragments } from "../compose/selection";
import { isRejected } from "../registry/entry";
import { Registry } from "../registry/registry";
import { describe } from "./compositions";
import type { View } from "./types";

type Example = NonNullable<SearchMetadata["projectExamples"]>[number];

function hostProblem(card: SearchMetadata, stack: string, view: View): string | undefined {
  if (card.kind === "stack" && stack !== card.id)
    return `stack ${stack} must equal the card id ${card.id}.`;
  const host = view.all.find((entry) => entry.kind === "stack" && entry.id === stack);
  if (host === undefined || isRejected(host))
    return `stack ${stack} is missing, invalid or not a stack.`;
  return undefined;
}

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

/** Check possible project selections without composing their source files. */
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
