import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { INDEX_PUBLIC_KEYS } from "@steamfield/stacks-format";
import { Effect, FileSystem, Layer, Option } from "effect";
import { Allowlist } from "./core/allowlist";
import { RemoteIndex } from "./core/remote-index";
import { invocationFor } from "./invocation";
import { hasFlag, main } from "./main";
import { NetLayer } from "./platform/net";
import { installSignalPolicy } from "./platform/signals";
import { stringWidth } from "./platform/width";
import { AppLayer, runInvocation } from "./runtime";
import { Host } from "./services/host";
import { Output, type Writer } from "./services/output";
import { Foreground } from "./services/processes";

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
// Replaced by Bun at build time; source development has no escaped asset paths.
declare const PACKAGED_GITIGNORES: ReadonlyArray<string>;
declare const STACKS_RELEASE_BUILD: boolean;
declare const STACKS_PUBLISHED_TELEMETRY: boolean;
// npm drops literal .gitignore members even when present in a tarball. Only this installed
// registry's reads translate the packer's escape; authors and core see the original names.
const packagedFiles = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const escapedPaths = new Set(
      (typeof PACKAGED_GITIGNORES === "undefined" ? [] : PACKAGED_GITIGNORES).map(
        (file) => `${registry}${file}`,
      ),
    );
    const resolve = (file: string) =>
      escapedPaths.has(file)
        ? Effect.map(fs.exists(`${file}.stacks`), (exists) => (exists ? `${file}.stacks` : file))
        : Effect.succeed(file);
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
          .pipe(
            Effect.map((names) =>
              names.map((name) =>
                name.endsWith(".gitignore.stacks") &&
                escapedPaths.has(`${args[0]}/${name.slice(0, -".stacks".length)}`)
                  ? name.slice(0, -".stacks".length)
                  : name,
              ),
            ),
          ),
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
    cwd: process.cwd(),
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
const remote = RemoteIndex.layer({ keys: INDEX_PUBLIC_KEYS, officialUrl: undefined }).pipe(
  Layer.provide(application),
);
const allowlist = Allowlist.layer({ keys: INDEX_PUBLIC_KEYS }).pipe(Layer.provide(application));
const layer = Layer.mergeAll(application, remote, allowlist).pipe(Layer.provideMerge(platform));
const controller = new AbortController();
const removeSignalPolicy = installSignalPolicy(holder, () => controller.abort());
try {
  process.exitCode = await runInvocation(
    main(args, undefined, {
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
