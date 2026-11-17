/** Validates `stacks search` requests and renders the results. */
import { SearchResult } from "@steamfield/stacks-format";
import { Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { renderSearch } from "../core/search/report";
import { search } from "../core/search/run";
import { textWidth } from "../core/wrap";
import { BadInput } from "../errors";
import { Host } from "../services/host";
import { Invocation } from "../services/invocation";
import { Output } from "../services/output";

const MAX_REQUEST_LENGTH = 500;
const MAX_LIMIT = 20;

/**
 * Joins the request words and checks the request and `--limit` are in range. Length counts code
 * points rather than UTF-16 units.
 */
const checkedRequest = (words: ReadonlyArray<string>, limit: number) =>
  Effect.gen(function* () {
    const request = words.join(" ").trim();
    const length = [...request].length;
    if (length === 0 || length > MAX_REQUEST_LENGTH)
      return yield* new BadInput({ details: { flag: "request", length } });
    if (limit < 1 || limit > MAX_LIMIT)
      return yield* new BadInput({ details: { flag: "limit", value: String(limit) } });
    return { request, length };
  });

export const searchCommand = Command.make(
  "search",
  {
    request: Argument.String("request").pipe(
      Argument.withDescription("What you want to build, in your own words (1 to 500 characters)."),
      Argument.atLeast(1),
    ),
    local: Flag.Boolean("local").pipe(
      Flag.withDescription("Rank locally without sending the request to the API."),
      Flag.withDefault(false),
    ),
    kind: Flag.Literals("kind", ["stack", "fragment"]).pipe(
      Flag.withDescription("Search only stacks or only fragments."),
      Flag.optional,
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("Maximum hits per list, from 1 to 20 (default 5)."),
      Flag.withDefault(5),
    ),
  },
  ({ request: words, kind, limit, local }) =>
    Effect.gen(function* () {
      const { request, length } = yield* checkedRequest(words, limit);
      const result = yield* search(request, {
        limit,
        kind: Option.getOrUndefined(kind),
        local,
      });
      const output = yield* Output;
      const host = yield* Host;
      // Query text stays out of the command log.
      yield* (yield* Invocation).annotate({
        requestLength: String(length),
        remote: result.remote,
        stacks: String(result.stacks.length),
        fragments: String(result.fragments.length),
      });
      const human = output.audience === "human";
      yield* output.result(
        Schema.encodeSync(SearchResult)(result),
        renderSearch(result, {
          invocation: host.invocation,
          human,
          width: textWidth(human, host.columns),
          measure: host.stringWidth,
        }),
      );
    }),
).pipe(
  Command.withDescription(
    "Rank stacks and fragments using local entries and the hosted stacks API, which receives the request text unless --local, --offline, STACKS_OFFLINE=1 or DO_NOT_TRACK is set. Exits 0 even when nothing fits strongly, 2 for invalid input (Usage; BadInput), 6 for unreadable registries (PermissionDenied), 130 when interrupted.",
  ),
  Command.withShortDescription("Find stacks and fragments for what you want to build."),
  Command.withExamples(({ commandPath }) => [
    {
      command: `${commandPath.join(" ")} "an iOS health app" --json`,
      description: "Compare fit, explanations and cached evidence.",
    },
    {
      command: `${commandPath.join(" ")} go cli --kind stack --limit 3`,
      description: "Find a stack for a Go command-line tool.",
    },
  ]),
);
