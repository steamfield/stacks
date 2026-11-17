import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { Registry } from "../src/core/registry/registry";
import { printable } from "../src/core/text/text";
import { argumentsFor } from "./decorate/arguments";
import { readConfig } from "./decorate/config";
import { run } from "./decorate/run";

const root = fileURLToPath(new URL("../registry", import.meta.url));
const program = Effect.gen(function* () {
  const options = yield* Effect.try({
    try: () => argumentsFor(process.argv.slice(2)),
    catch: (error) => (error instanceof Error ? error : new Error("Invalid arguments.")),
  });
  const config = yield* Effect.try({
    try: readConfig,
    catch: () => new Error("Invalid OpenRouter configuration."),
  });
  yield* run(root, options, config);
});

process.exitCode = await Effect.runPromise(
  program.pipe(
    Effect.provide(Registry.layer([{ origin: "bundled", path: root }])),
    Effect.as(0),
    Effect.catch((error) => {
      if (error instanceof Error && "_tag" in error && error._tag === "PermissionDenied")
        return Console.error(JSON.stringify(error)).pipe(Effect.as(6));
      return Console.error(
        printable(error instanceof Error ? error.message : "Decoration failed."),
      ).pipe(Effect.as(2));
    }),
    Effect.provide(NodeServices.layer),
  ),
);
