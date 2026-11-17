/** Renders the review report for one registry entry. */
import { Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Allowlist } from "../core/allowlist";
import { showReport } from "../core/show/index";
import { renderShow } from "../core/show/report";
import { shownPath } from "../core/text/shown-path";
import { textWidth } from "../core/text/wrap";
import { ShowReport } from "../schemas/show";
import { Host } from "../services/host";
import { Output } from "../services/output";
import { Telemetry } from "../telemetry";

export const showCommand = Command.make(
  "show",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Stack or fragment id to review.")),
    kind: Flag.Literals("kind", ["stack", "fragment"]).pipe(
      Flag.withDescription("Select a kind when a stack and a fragment share an id."),
      Flag.optional,
    ),
  },
  ({ id, kind }) =>
    Effect.gen(function* () {
      const output = yield* Output;
      yield* (yield* Allowlist).refresh;
      const host = yield* Host;
      const report = yield* showReport(id, Option.getOrUndefined(kind));
      yield* (yield* Telemetry).recordShow(report);
      // Only agent text shortens the path; JSON keeps it absolute.
      const path =
        output.audience === "agent" ? yield* shownPath(host.cwd, report.path) : report.path;
      const terminal =
        output.audience === "human"
          ? { width: textWidth(true, host.columns), measure: host.stringWidth }
          : undefined;
      yield* output.result(
        Schema.encodeSync(ShowReport)(report),
        renderShow({ ...report, path }, host.invocation, terminal, output.style),
      );
    }),
).pipe(
  Command.withDescription(
    "Review a stack or fragment (apps are fragments): metadata, full guidance, shipped files and its last recorded run. Reads only; starts no processes. Exits 0, 2 on an unknown or rejected id, an id that needs --kind or a stack whose default fragments conflict (ComposeConflict), 3 on a broken config.json, 6 when the entry can't be read, 130 when interrupted.",
  ),
  Command.withShortDescription("Review one stack or fragment before you use it."),
  Command.withExamples(({ commandPath }) => [
    { command: `${commandPath.join(" ")} typescript-cli`, description: "Read a stack's guidance" },
    {
      command: `${commandPath.join(" ")} postgres --json`,
      description: "Get one ShowReport object, as an agent would",
    },
    {
      command: `${commandPath.join(" ")} effect --kind fragment`,
      description: "Look the id up among fragments only",
    },
  ]),
);
