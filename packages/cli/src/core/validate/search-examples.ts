/**
 * Checks that the project examples on a search card describe selections the CLI would accept.
 *
 * A search card may list `projectExamples`: short stories of a project someone could build, each
 * naming a host stack and the fragments added to it. The website and `stacks show` print them, so
 * an example naming a missing stack or a fragment that doesn't fit would send a reader to a dead
 * end. `search.ts` calls `exampleProblems` for each card that otherwise checks out; every problem
 * comes back as text that `search.ts` joins into one `search-invalid` finding.
 *
 * Only the selection is checked (`core/compose/selection.ts::selectFragments`, which resolves the
 * fragments and their dependencies). Rendering every example's files would cost far more and
 * the composition checks already cover rendering.
 */
import type { SearchMetadata } from "@steamfield/stacks-format";
import { Effect } from "effect";
import { selectFragments } from "../compose/selection";
import { isRejected } from "../registry/entry";
import { Registry } from "../registry/registry";
import { describe } from "./compositions";
import type { View } from "./types";

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
