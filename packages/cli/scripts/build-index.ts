import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Clock, Console, Effect, Layer, Option, Path } from "effect";
import { AppConfig, SOURCE_BUILD } from "../src/config";
import { Registry } from "../src/core/registry/registry";
import { printable } from "../src/core/text";
import { validate } from "../src/core/validate";
import { stringWidth } from "../src/platform/width";
import { Host } from "../src/services/host";
import { Foreground, Processes } from "../src/services/processes";
import { VERSION } from "../src/version";
import { readAllowlist, readDependencyCards } from "./index/allowlist";
import { argumentsFor, IncludeUnprovenUsage } from "./index/arguments";
import { buildDirectory } from "./index/directory";
import { historyExec, requireFullHistory } from "./index/history";
import { indexNames } from "./index/index-names";
import { mergeNames } from "./index/names";
import { currentIndex } from "./index/proof";
import { carryForward, publish, readAuthors, withAuthors } from "./index/publish";
import { releaseNames } from "./index/release-names";
import {
  checkHost,
  fetchIndex,
  fetchNames,
  fetchPreviousDirectory,
  fetchSearch,
} from "./index/remote";
import { indexSearch } from "./index/search";

const root = fileURLToPath(new URL("../registry", import.meta.url));
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const validateRegistry = Effect.fn("index.validateRegistry")(function* () {
  const report = yield* validate({ root, bundled: true });
  const failures = report.findings.filter((finding) => finding.severity !== "note");
  if (failures.length > 0)
    return yield* Effect.fail(
      new Error(
        [
          "Registry validation failed; output unchanged.",
          ...failures.map(
            (finding) =>
              `${finding.severity}: ${finding.file ?? root}: ${finding.check}: ${finding.message}`,
          ),
          "Next: fix every error and warning reported by stacks validate.",
        ].join("\n"),
      ),
    );
});

const program = Effect.gen(function* () {
  const options = yield* argumentsFor(process.argv.slice(2));
  if (options.mode === "check") {
    yield* Console.log(yield* checkHost(options.base));
    return;
  }
  yield* requireFullHistory(packageRoot);
  yield* validateRegistry();
  const allowlist = yield* readAllowlist(root);
  const previous = options.previous === null ? null : yield* fetchIndex(options.previous.href);
  const previousNames =
    options.previous === null
      ? null
      : yield* fetchNames(new URL("names.json", options.previous).href);
  const previousSearch =
    options.previous === null
      ? null
      : yield* fetchSearch(new URL("search.json", options.previous).href);
  const previousDirectory =
    options.previous === null
      ? null
      : yield* fetchPreviousDirectory(new URL("directory.json", options.previous).href);
  const base = options.previous === null ? "" : new URL("../", options.previous).href;
  const current = yield* currentIndex(root, options.includeUnproven);
  const selected = yield* carryForward(current, previous, base);
  const path = yield* Path.Path;
  const generatedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
  const checkoutCommit = yield* historyExec(packageRoot, ["git", "rev-parse", "HEAD"]);
  const bootstrapEntries = previousNames === null ? (previous?.entries ?? []) : [];
  const sources = [
    ...(yield* releaseNames(packageRoot)),
    yield* indexNames([...selected.entries, ...bootstrapEntries], selected.bundles),
  ];
  const names = mergeNames(
    { formatVersion: 1, generatedAt, commit: checkoutCommit, sources },
    previousNames,
  );
  const directory = yield* buildDirectory({
    cwd: packageRoot,
    root,
    names,
    entries: selected.entries,
    previous,
    previousDirectory,
    bundles: selected.bundles,
  });
  yield* publish({
    out: path.resolve(options.out),
    key: options.key,
    bundles: selected.bundles,
    search: yield* indexSearch({
      root,
      entries: selected.entries,
      bundles: selected.bundles,
      previous: previousSearch,
    }),
    names,
    allowlist,
    deps: yield* readDependencyCards(generatedAt),
    directory,
    index: {
      formatVersion: 1,
      minCli: VERSION,
      generatedAt,
      commit: checkoutCommit,
      entries: withAuthors(selected.entries, yield* readAuthors(root)),
    },
  });
  for (const line of selected.lines) yield* Console.log(line);
});

const platform = Layer.merge(NodeServices.layer, Foreground.layer(Foreground.make()));
const layer = Processes.layer.pipe(
  Layer.provideMerge(AppConfig.layer(SOURCE_BUILD)),
  Layer.provideMerge(platform),
  Layer.provideMerge(
    Host.layer({
      nodeMajor: Number(process.versions.node.split(".")[0]),
      platform: process.platform,
      executable: process.execPath,
      cwd: packageRoot,
      stdinIsTTY: false,
      stdoutIsTTY: false,
      stderrIsTTY: false,
      columns: Option.none(),
      stringWidth,
      registry: root,
      packageRoot,
      skill: fileURLToPath(new URL("../skills", import.meta.url)),
      authoring: fileURLToPath(new URL("../docs/authoring.md", import.meta.url)),
      invocation: "stacks",
    }),
  ),
);
process.exitCode = await Effect.runPromise(
  program.pipe(
    Effect.provide(Registry.layer([{ origin: "bundled", path: root }])),
    Effect.as(0),
    Effect.catch((error) =>
      Console.error(
        error instanceof Error
          ? error.message.split("\n").map(printable).join("\n")
          : "Index build failed.",
      ).pipe(Effect.as(error instanceof IncludeUnprovenUsage ? 2 : 1)),
    ),
    Effect.provide(layer),
  ),
);
