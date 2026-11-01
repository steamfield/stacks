import { Duration, Effect, FileSystem, Path } from "effect";
import { agentPrompt } from "../../src/core/handoff";
import { Processes } from "../../src/services/processes";
import { effortOf } from "./agents";
import { shellArg, snapshot } from "./files";
import type { Prepared } from "./prepare";

export const run = (prepared: Prepared) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { adapter, bench } = prepared;
    const debug = path.join(bench, "agent-debug.log");
    // A continuation must not mistake a previous run's diagnostics for fresh evidence.
    yield* fs.remove(debug, { force: true });
    const prompt = `${agentPrompt(prepared.cli)} Read ${path.join(bench, "BENCH.md")} first for the bench rules.`;
    const args = [
      ...adapter.headlessArgs(prompt, prepared.options.model ?? adapter.defaultModel),
      ...effortArgs(prepared),
      ...(adapter.debugLog?.args.length ? [...adapter.debugLog.args, debug] : []),
    ];
    const result = yield* runAgent(prepared, args, debug);
    const parsed = adapter.readResult(result.tail);
    let ended: typeof parsed.ended | "timeout" = parsed.ended;
    if (result.timedOut) ended = "timeout";
    else if (result.exitCode !== 0) ended = "error";
    yield* fs.writeFileString(path.join(bench, "agent-result.txt"), result.tail);
    const log = yield* fs
      .readFileString(debug)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(error),
        ),
      );
    return {
      ended,
      subtype: parsed.subtype,
      turns: parsed.turns,
      minutes: result.durationMs / 60_000,
      unchanged: prepared.before === (yield* snapshot(prepared.project)),
      hooks:
        adapter.readHooks && log !== null
          ? [
              ...new Set(
                adapter.readHooks(log).filter((hook) => prepared.shippedHooks.includes(hook)),
              ),
            ].sort()
          : null,
    };
  });

export type AgentRun = Effect.Success<ReturnType<typeof run>>;

function effortArgs({ adapter, options }: Prepared): ReadonlyArray<string> {
  const effort = effortOf(adapter, options.effort);
  return effort && adapter.effortArgs ? adapter.effortArgs(effort) : [];
}

const runAgent = (prepared: Prepared, args: readonly string[], debug: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processes = yield* Processes;
    const { adapter, credentials } = prepared;
    if (credentials.route === "codex login") {
      const target = path.join(prepared.home, ".codex/auth.json");
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      const file = yield* Effect.acquireRelease(fs.open(target, { flag: "wx", mode: 0o600 }), () =>
        fs.remove(target, { force: true }).pipe(Effect.orDie),
      );
      yield* file.writeAll(yield* fs.readFile(credentials.source));
    }
    return yield* processes.run({
      command: [prepared.binary, ...args].map(shellArg).join(" "),
      cwd: prepared.project,
      env: {
        ...prepared.env,
        ...(credentials.route === "token" ? { [adapter.auth.env]: credentials.token } : {}),
        ...(adapter.debugLog?.env ? { [adapter.debugLog.env]: debug } : {}),
      },
      timeout: Duration.millis(prepared.options.minutes * 60_000),
    });
  }).pipe(Effect.scoped);
