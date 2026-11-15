/**
 * The CLI's process entry point: the only module that touches Node's process directly, and the
 * place one run of `stacks` starts and ends.
 *
 * The packaged `dist/stacks` script checks the Node version and imports the bundle built from this
 * file. Top to bottom, it reads `--json` from argv (the one argv read before parsing, because the
 * output audience must exist even when parsing fails), creates the stdout and stderr writers,
 * builds the platform layer (Node services, the `Host` facts about this process and where the
 * package's assets live, the network layer, the process-group registry) and the application layer
 * from `runtime.ts::AppLayer`, installs the signal policy (`platform/signals.ts`), runs
 * `main.ts::main` through `runtime.ts::runInvocation` and sets `process.exitCode` from the status
 * it returns. The order is deliberate: stream error handlers come first, and the signal policy is
 * removed only after the run has settled.
 *
 * Bun replaces three build-time constants. `PACKAGED_ESCAPES` lists the registry files the packer
 * had to rename (npm drops literal `.gitignore` and `bunfig.toml` members, so they ship as
 * `<name>.stacks`), and `packagedFiles` maps reads of those paths back to the original name, for
 * the bundled registry only. `STACKS_RELEASE_BUILD` marks a release, and
 * `STACKS_PUBLISHED_TELEMETRY` the one build that may send telemetry to the official endpoint.
 */
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { INDEX_PUBLIC_KEYS } from "@steamfield/stacks-format";
import { Effect, FileSystem, Layer, Option } from "effect";
import { Allowlist } from "./core/allowlist";
import { RemoteIndex } from "./core/remote-index";
import { NotFound } from "./errors";
import { invocationFor } from "./invocation";
import { hasFlag, main } from "./main";
import { workingDirectory } from "./platform/cwd";
import { NetLayer } from "./platform/net";
import { installSignalPolicy } from "./platform/signals";
import { stringWidth } from "./platform/width";
import { AppLayer, runInvocation } from "./runtime";
import { Host } from "./services/host";
import { Output, type Writer } from "./services/output";
import { Foreground } from "./services/processes";

/** Writes to a Node stream, resolving once the stream accepted the text and failing on its error. */
const writer =
  (stream: NodeJS.WriteStream): Writer =>
  (text) =>
    new Promise((resolve, reject) => {
      stream.write(text, (error) => (error ? reject(error) : resolve()));
    });
// Stream errors are also delivered to each write callback; this prevents Node's default uncaught event report.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
const args = process.argv.slice(2);
const output = Output.layer(
  hasFlag(args, "--json"),
  writer(process.stdout),
  writer(process.stderr),
);
// This invocation's process groups and interactive child, shared with the signal policy.
const holder = Foreground.make();
const registry = fileURLToPath(new URL("../registry/", import.meta.url));
const cwd = workingDirectory();
// Replaced by Bun at build time; source development has no escaped asset paths.
declare const PACKAGED_ESCAPES: ReadonlyArray<string>;
declare const STACKS_RELEASE_BUILD: boolean;
declare const STACKS_PUBLISHED_TELEMETRY: boolean;
// Packers drop literal .gitignore and bunfig.toml members even when present in a tarball. Only
// this installed registry's reads translate the packer's escape; authors and core see the
// original names.
const packagedFiles = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const escapedPaths = new Set(
      (typeof PACKAGED_ESCAPES === "undefined" ? [] : PACKAGED_ESCAPES).map(
        (file) => `${registry}${file}`,
      ),
    );
    // An escaped file is read from its `.stacks` copy when one exists.
    const resolve = (file: string) =>
      escapedPaths.has(file)
        ? Effect.map(fs.exists(`${file}.stacks`), (exists) => (exists ? `${file}.stacks` : file))
        : Effect.succeed(file);
    // A directory listing shows an escaped file under its original name.
    const originalName = (directory: string, name: string) => {
      const original = name.slice(0, -".stacks".length);
      return name.endsWith(".stacks") && escapedPaths.has(`${directory}/${original}`)
        ? original
        : name;
    };
    return {
      ...fs,
      exists: (file: string) => Effect.flatMap(resolve(file), fs.exists),
      lstat: (file: string) => Effect.flatMap(resolve(file), fs.lstat),
      stat: (file: string) => Effect.flatMap(resolve(file), fs.stat),
      realPath: (file: string) => Effect.flatMap(resolve(file), fs.realPath),
      readFile: (file: string) => Effect.flatMap(resolve(file), fs.readFile),
      readFileString: (file: string, encoding?: string) =>
        Effect.flatMap(resolve(file), (at) => fs.readFileString(at, encoding)),
      readDirectory: (...args: Parameters<typeof fs.readDirectory>) =>
        fs
          .readDirectory(...args)
          .pipe(Effect.map((names) => names.map((name) => originalName(args[0], name)))),
    };
  }),
).pipe(Layer.provide(NodeServices.layer));
const platform = Layer.mergeAll(
  NodeServices.layer,
  packagedFiles,
  Foreground.layer(holder),
  NetLayer,
  Host.layer({
    nodeMajor: Number(process.versions.node.split(".")[0]),
    platform: process.platform,
    executable: process.execPath,
    // With no working directory no command runs (below), so nothing reads this root.
    cwd: Option.getOrElse(cwd, () => "/"),
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    stderrIsTTY: process.stderr.isTTY === true,
    columns: Option.fromUndefinedOr(process.stdout.columns).pipe(
      Option.filter((width) => process.stdout.isTTY && width > 0),
    ),
    stringWidth,
    registry,
    packageRoot: fileURLToPath(new URL("../", import.meta.url)),
    skill: fileURLToPath(new URL("../skills/", import.meta.url)),
    authoring: fileURLToPath(new URL("../docs/authoring.md", import.meta.url)),
    invocation: invocationFor(process.argv[1] ?? ""),
  }),
);
// The hosted API: search, stats and the dependency allowlist.
const DEFAULT_API_URL: string | undefined = "https://stacks.steamfield.io";
const application = AppLayer(output, undefined, {
  releaseBuild: typeof STACKS_RELEASE_BUILD !== "undefined" && STACKS_RELEASE_BUILD,
  defaultApiUrl: DEFAULT_API_URL,
});
// No official index host exists yet, so the remote origin is off unless STACKS_INDEX_URL is set.
const remote = RemoteIndex.layer({ keys: INDEX_PUBLIC_KEYS, officialUrl: undefined }).pipe(
  Layer.provide(application),
);
const allowlist = Allowlist.layer({ keys: INDEX_PUBLIC_KEYS }).pipe(Layer.provide(application));
const layer = Layer.mergeAll(application, remote, allowlist).pipe(Layer.provideMerge(platform));
// The shell's directory was removed after it entered it: every command reads or writes relative
// to it, so fail before parsing rather than guess another directory.
const missingDirectory = Effect.fail(new NotFound({ details: { suggestions: [], kind: "cwd" } }));
const controller = new AbortController();
const removeSignalPolicy = installSignalPolicy(holder, () => controller.abort());
try {
  process.exitCode = await runInvocation(
    main(args, Option.isSome(cwd) ? undefined : missingDirectory, {
      officialUrl:
        typeof STACKS_PUBLISHED_TELEMETRY !== "undefined" && STACKS_PUBLISHED_TELEMETRY
          ? DEFAULT_API_URL
          : undefined,
    }).pipe(Effect.provide(layer), Effect.scoped),
    controller.signal,
  );
} finally {
  removeSignalPolicy();
}
