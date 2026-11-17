// A stand-in for bin.ts in tests/handoff-signals.test.ts: the real command tree, signal policy,
// Node platform and live Processes, with the TTY flags set as a terminal would set them (a test
// can't give the process a terminal) and the registry root from the first argument.
// Usage: bun tests/fixtures/handoff-bin.ts <registry> <cli args...>
import { NodeServices } from "@effect/platform-node";
import { INDEX_PUBLIC_KEYS } from "@steamfield/stacks-format";
import { Effect, Layer, Option } from "effect";
import { hasFlag } from "../../src/argv";
import { SOURCE_BUILD } from "../../src/build";
import { Allowlist } from "../../src/core/allowlist";
import { main } from "../../src/main";
import { NetLayer } from "../../src/platform/net";
import { installSignalPolicy } from "../../src/platform/signals";
import { stringWidth } from "../../src/platform/width";
import { AppLayer, runInvocation } from "../../src/runtime";
import { Host } from "../../src/services/host";
import { Output, type Writer } from "../../src/services/output";
import { Foreground } from "../../src/services/processes";

const [registry, ...args] = process.argv.slice(2) as [string, ...string[]];
const writer =
  (stream: NodeJS.WriteStream): Writer =>
  (text) =>
    new Promise((resolve, reject) => {
      stream.write(text, (error) => (error ? reject(error) : resolve()));
    });
const holder = Foreground.make();
const platform = Layer.mergeAll(
  NodeServices.layer,
  Foreground.layer(holder),
  NetLayer,
  Host.layer({
    nodeMajor: Number(process.versions.node.split(".")[0]),
    platform: process.platform,
    executable: process.execPath,
    cwd: process.cwd(),
    stdinIsTTY: true,
    stdoutIsTTY: true,
    stderrIsTTY: true,
    columns: Option.none(),
    stringWidth,
    registry,
    packageRoot: "/test/package",
    skill: "",
    authoring: "",
    invocation: "stacks",
  }),
);
const controller = new AbortController();
const dispose = installSignalPolicy(holder, () => controller.abort());
try {
  const application = AppLayer({
    output: Output.layer({
      jsonFlag: hasFlag(args, "--json"),
      stdout: writer(process.stdout),
      stderr: writer(process.stderr),
    }),
    build: SOURCE_BUILD,
  });
  const allowlist = Allowlist.layer({ keys: INDEX_PUBLIC_KEYS }).pipe(Layer.provide(application));
  process.exitCode = await runInvocation(
    main({ args }).pipe(
      Effect.provide(Layer.provideMerge(Layer.merge(application, allowlist), platform)),
      Effect.scoped,
    ),
    controller.signal,
  );
} finally {
  dispose();
}
