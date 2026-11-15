/**
 * Registers the doctor command and presents its core diagnostic through Output. This thin
 * handler records the command name and supplies both text and JSON result forms.
 */

import { Effect } from "effect";
import { Command } from "effect/cli";
import { doctor } from "../core/doctor";
import { Invocation } from "../services/invocation";
import { Output } from "../services/output";

export const doctorCommand = Command.make(
  "doctor",
  {},
  Effect.fn(function* () {
    yield* Effect.flatMap(Invocation, (invocation) => invocation.named("doctor"));
    const output = yield* Output;
    const result = yield* doctor();
    yield* output.result(
      result,
      `${result.name} ${result.version} (${result.platform}, compiled: ${result.compiled})\nGreeting: ${result.greeting ?? "unavailable"}\nConfig: ${result.configError ?? "ok"}\nConfig file: ${result.configFile}\nData: ${result.dataDir}`,
    );
  }),
).pipe(
  Command.withDescription("Inspect runtime and configuration without requiring valid settings."),
);
