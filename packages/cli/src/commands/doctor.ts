/**
 * Renders the `stacks doctor` report. A broken settings file is a diagnostic finding so the
 * command still works when it is needed most.
 */
import { Effect } from "effect";
import { Command } from "effect/cli";
import { doctor } from "../core/doctor";
import type { DoctorReport } from "../schemas/doctor";
import type { RemoteStatus } from "../schemas/remote-index";
import { Output } from "../services/output";

/** ` (not found)` after a path the CLI looked for and didn't find. */
const missing = (found: boolean) => (found ? "" : " (not found)");

function remoteMode(status: RemoteStatus): string {
  if (status.url === null) return "off";
  return status.offline ? "offline" : "enabled";
}

/** The text form of the report: one labeled line per fact, then the config problems or `ok`. */
function renderDoctor(report: DoctorReport): string {
  const remote = report.remoteIndex;
  return [
    `stacks ${report.version}`,
    `Platform: ${report.platform}`,
    `Config: ${report.paths.config}`,
    `Data: ${report.paths.data}`,
    `User entries: ${report.paths.user}`,
    `Registry: ${report.registry.path}${missing(report.registry.found)}`,
    `Skill: ${report.skill.path}${missing(report.skill.found)}`,
    `Remote index: ${remoteMode(remote)}; ${remote.lastOutcome ?? "not fetched"}`,
    `Index cached: ${remote.cachedAt ?? "never"}`,
    report.configErrors.length ? report.configErrors.join("\n") : "Configuration: ok",
  ].join("\n");
}

export const doctorCommand = Command.make("doctor", {}, () =>
  Effect.gen(function* () {
    const report = yield* doctor;
    yield* (yield* Output).result(report, renderDoctor(report));
  }),
).pipe(
  Command.withDescription(
    "Inspect local runtime, paths and optional configuration: version, platform, config and data paths, the bundled registry and skill. A broken config file is reported, not fatal. Exits 0, 2 on a usage error, 130 when interrupted.",
  ),
  Command.withShortDescription("Inspect the local runtime, paths and configuration."),
  Command.withExamples(({ commandPath }) => [
    { command: commandPath.join(" "), description: "Print the diagnostics" },
    { command: `${commandPath.join(" ")} --json`, description: "Get one DoctorReport object" },
  ]),
);
