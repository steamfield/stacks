import { Context, Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer } from "effect/ai";
import { decodeCli } from "./decode";
import { CliRunner } from "./run";

const AuthorTopics = Schema.Struct({ topics: Schema.Array(Schema.String) });

export const resourceLayer = Layer.unwrap(
  Effect.gen(function* () {
    const runner = yield* CliRunner;
    const server = yield* McpServer.McpServer;
    const read = Effect.fn("resources.read")(function* (args: ReadonlyArray<string>) {
      const output = yield* runner
        .run(args)
        .pipe(Effect.mapError((error) => new McpSchema.InternalError({ message: error.message })));
      if (output.exit !== 0) {
        const message = output.stderr.trim() || `CLI exited ${output.exit}`;
        return yield* output.exit === 2
          ? new McpSchema.InvalidParams({ message })
          : new McpSchema.InternalError({ message });
      }
      return output.stdout;
    });
    const topics = Effect.fn("resources.topics")(function* (input: string) {
      const output = yield* runner.run(["guide", "author", "--json"]);
      const { result } = yield* decodeCli(AuthorTopics, output, "guide author");
      return result.topics.filter((topic) => topic.startsWith(input));
    });
    return Layer.mergeAll(
      McpServer.resource({
        uri: "stacks://guide",
        name: "guide",
        description: "The CLI's guide. It also names commands this server does not expose.",
        mimeType: "text/markdown",
        content: read(["guide"]),
      }),
      McpServer.resource({
        uri: "stacks://guide/author",
        name: "author",
        description: "The CLI's guide to writing and submitting stacks and fragments.",
        mimeType: "text/markdown",
        content: read(["guide", "author"]),
      }),
      // The high-level resource helper wraps InvalidParams as InternalError.
      Layer.effectDiscard(
        server.addResourceTemplate({
          template: new McpSchema.ResourceTemplate({
            uriTemplate: "stacks://guide/author/{topic}",
            name: "author-topic",
            description: "An authoring reference from the CLI.",
            mimeType: "text/markdown",
          }),
          annotations: Context.empty(),
          // `::` escapes the scheme's colon, as the helper's compileUriTemplate does.
          routerPath: "stacks:://guide/author/:0",
          completions: {
            topic: (input) =>
              topics(input).pipe(
                Effect.map((values) => ({
                  completion: { values, total: values.length, hasMore: false },
                })),
                Effect.mapError((error) => new McpSchema.InternalError({ message: error.message })),
              ),
          },
          handle: Effect.fn("resources.readTopic")(function* (uri, params) {
            const topic = params[0];
            if (topic === undefined)
              return yield* new McpSchema.InvalidParams({ message: "Missing author topic." });
            const text = yield* read(["guide", "author", "--", topic]);
            return { contents: [{ uri, text }] };
          }),
        }),
      ),
    );
  }),
);
