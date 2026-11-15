/**
 * The `update` command: checks npm for a newer release of the CLI and, for a global npm install run
 * by a person, installs it.
 *
 * `core/update/update.ts::update` makes the one registry request and decides what to do; with
 * `--check` it only reports. `core/update/report.ts::renderUpdate` writes the text.
 */
import { Effect, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { renderUpdate } from "../core/update/report";
import { update } from "../core/update/update";
import { UpdateResult } from "../schemas/update";
import { Output } from "../services/output";

export const updateCommand = Command.make(
  "update",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Report versions and the update command without installing; agents use this.",
      ),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const result = yield* update(options);
      yield* (yield* Output).result(Schema.encodeSync(UpdateResult)(result), renderUpdate(result));
    }),
).pipe(
  Command.withDescription(
    "Check the latest published version with one request to the npm registry; nothing runs in the background. Upgrades a global npm install; other installs get the command to run. Agents use --check. Exits 0 when up to date, ahead, available or updated; 2 in offline mode, without a request; 4 when the registry is unavailable; 6 when an agent tries to install a newer version without --check or npm fails; 130 when interrupted.",
  ),
  Command.withShortDescription("Check or update a global npm install."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Upgrade a global npm install" },
    {
      command: `${commandPath.join(" ")} --check --json`,
      description: "Report versions and the command without installing",
    },
  ]),
);
