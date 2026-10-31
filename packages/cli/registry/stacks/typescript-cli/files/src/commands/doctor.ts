import { Effect } from "effect";
import { Command } from "effect/cli";
import { doctor } from "../core/doctor";
import { Output } from "../services/output";

export const doctorCommand = Command.make(
  "doctor",
  {},
  Effect.fn(function* () {
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
