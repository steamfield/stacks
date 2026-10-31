import { Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer } from "effect/ai";
import { decodeCli } from "./decode";
import { CliRunner } from "./run";

const AuthorTopics = Schema.Struct({ topics: Schema.Array(Schema.String) });

export const resourceLayer = Layer.unwrap(
  Effect.gen(function* () {
    const runner = yield* CliRunner;
    const read = Effect.fn("resources.read")(function* (args: ReadonlyArray<string>) {
      const output = yield* runner.run(args);
      if (output.exit !== 0) {
        return yield* new McpSchema.InternalError({
          message: output.stderr.trim() || `CLI exited ${output.exit}`,
        });
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
      McpServer.resource`stacks://guide/author/${McpSchema.param("topic", Schema.String)}`({
        name: "author-topic",
        description: "An authoring reference from the CLI.",
        mimeType: "text/markdown",
        completion: { topic: topics },
        content: (_uri, topic) => read(["guide", "author", topic]),
      }),
    );
  }),
);
