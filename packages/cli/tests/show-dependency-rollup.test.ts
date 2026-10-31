import { realpathSync } from "node:fs";
import { join } from "node:path";
import type { IndexEntry, RegistryIndex } from "@steamfield/stacks-format";
import { Effect, Option } from "effect";
import { Command } from "effect/cli";
import { afterEach, expect, test } from "vitest";
import { cli } from "../src/cli";
import { RemoteIndex } from "../src/core/remote-index";
import { quiet, runCli, terminal } from "./helpers/cli";
import { put } from "./helpers/search-metadata";
import { fragment, showReport, stack } from "./helpers/show-preview";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

function fixture() {
  const home = realpathSync(space.dir());
  const registry = join(home, "registry");
  stack(
    registry,
    "sample",
    [
      "deps:",
      "  cli: [cobra]",
      "  runtime: [shared]",
      "fragments:",
      "  required: [db]",
      "  default: [ci]",
      "  optional: [otel]",
    ].join("\n"),
  );
  fragment(registry, "db", "deps:\n  runtime: [pgx, shared, fragment-shared]");
  fragment(registry, "ci", "requires: [foundation]\ndeps:\n  dev: [vitest]");
  fragment(registry, "foundation", "deps:\n  runtime: [goose, shared, fragment-shared]");
  fragment(registry, "otel", "requires: [span-source]\ndeps:\n  runtime: [otlp, shared]");
  fragment(registry, "span-source", "deps:\n  runtime: [spans]");
  const show = (id: string, args: string[] = ["--json"], human = false) =>
    runCli(["show", id, ...args], {
      home,
      env: quiet,
      host: { registry, ...(human ? terminal : {}) },
    });
  return { home, registry, show };
}

test("stack JSON attributes required, default and transitive dependencies without changing its own deps", async () => {
  const { show } = fixture();
  const report = await showReport(await show("sample"));
  expect(report.deps).toEqual({ cli: ["cobra"], runtime: ["shared"] });
  expect(report).toMatchObject({
    dependencyRollup: {
      included: [
        { role: "cli", name: "cobra", stack: true, fragments: [] },
        { role: "runtime", name: "shared", stack: true, fragments: ["db", "foundation"] },
        { role: "dev", name: "vitest", stack: false, fragments: ["ci"] },
        { role: "runtime", name: "pgx", stack: false, fragments: ["db"] },
        {
          role: "runtime",
          name: "fragment-shared",
          stack: false,
          fragments: ["db", "foundation"],
        },
        { role: "runtime", name: "goose", stack: false, fragments: ["foundation"] },
      ],
      optional: [
        {
          fragment: "otel",
          deps: [
            { role: "runtime", name: "otlp", stack: false, fragments: ["otel"] },
            { role: "runtime", name: "spans", stack: false, fragments: ["span-source"] },
          ],
        },
      ],
    },
  });
});

test("a stack still shows when its optional fragments or their requirements are missing or rejected", async () => {
  const { registry, show } = fixture();
  stack(
    registry,
    "sample",
    "deps:\n  cli: [cobra]\nfragments:\n  optional: [kept, gone, rejected]",
  );
  fragment(registry, "kept", "requires: [also-gone, also-rejected]\ndeps:\n  dev: [kept-dep]");
  for (const id of ["rejected", "also-rejected"])
    fragment(registry, id, "Tools: [node]\ndeps:\n  dev: [invisible]");
  const report = await showReport(await show("sample"));
  const kept = { role: "dev", name: "kept-dep", stack: false, fragments: ["kept"] };
  expect(report).toMatchObject({
    dependencyRollup: {
      included: [{ role: "cli", name: "cobra", stack: true, fragments: [] }],
      optional: [{ fragment: "kept", deps: [kept] }],
    },
  });
});

test("fragment JSON keeps its own dependencies and omits the stack rollup", async () => {
  const { show } = fixture();
  const report = await showReport(await show("otel"));
  expect(report.deps).toEqual({ runtime: ["otlp", "shared"] });
  expect(Object.hasOwn(report, "dependencyRollup")).toBe(false);
});

test.each([false, true])(
  "stack text attributes included and optional dependencies (human: %s)",
  async (human) => {
    const { show } = fixture();
    const result = await show("sample", [], human);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(
      result.stdout
        .split("\n")
        .filter((line) => /^(?:Optional dependencies|Dependencies) \(/.test(line)),
    ).toEqual([
      "Dependencies (cli): cobra",
      "Dependencies (runtime): shared, pgx (from db), fragment-shared (from db, foundation), goose (from foundation)",
      "Dependencies (dev): vitest (from ci)",
      "Optional dependencies (with otel): otlp (runtime), spans (runtime) (from span-source)",
    ]);
  },
);

test("stack cards cover dependencies supplied only by included and optional fragments", async () => {
  const { registry, show } = fixture();
  const source = { by: "author", reviewedAt: "2026-10-29" };
  const cards = {
    goose: { whatItIs: "Database migration tooling.", source },
    spans: { whatItIs: "Tracing spans.", source },
    unrelated: { whatItIs: "An unrelated package.", source },
  };
  put(join(registry, "deps/npm.json"), JSON.stringify({ formatVersion: 1, cards }));
  const report = await showReport(await show("sample"));
  expect(report.dependencyCards).toEqual({ "npm/goose": cards.goose, "npm/spans": cards.spans });
});

test("human app dependencies retain cards and fragment attribution", async () => {
  const { registry, show } = fixture();
  stack(registry, "sample", "deps:\n  app: [react]\nfragments:\n  default: [view]");
  fragment(registry, "view", "deps:\n  app: [react, react-dom]");
  const source = { by: "author", reviewedAt: "2026-10-29" };
  put(
    join(registry, "deps/npm.json"),
    JSON.stringify({
      formatVersion: 1,
      cards: {
        react: { whatItIs: "A library for building interfaces.", source },
        "react-dom": { whatItIs: "A browser renderer for React.", source },
      },
    }),
  );
  const result = await show("sample", [], true);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.split("\n")).toEqual(
    expect.arrayContaining([
      "Dependencies (app):",
      "  react: A library for building interfaces.",
      "  react-dom (from view): A browser renderer for React.",
    ]),
  );
});

test("optional requirements can cycle while reporting both packages once", async () => {
  const { registry, show } = fixture();
  stack(registry, "sample", "fragments:\n  optional: [cycle-a]");
  fragment(registry, "cycle-a", "requires: [cycle-b]\ndeps:\n  runtime: [a-package]");
  fragment(registry, "cycle-b", "requires: [cycle-a]\ndeps:\n  runtime: [b-package]");
  const report = await showReport(await show("sample"));
  expect(report).toMatchObject({
    dependencyRollup: {
      included: [],
      optional: [
        {
          fragment: "cycle-a",
          deps: [
            { role: "runtime", name: "a-package", stack: false, fragments: ["cycle-a"] },
            { role: "runtime", name: "b-package", stack: false, fragments: ["cycle-b"] },
          ],
        },
      ],
    },
  });
});

test.each(["different current", "unavailable current", "user override"])(
  "stack dependencies follow the effective pinned composition with %s",
  async (scenario) => {
    const { home, registry } = fixture();
    const remoteRoot = space.dir();
    const remoteStack = stack(
      remoteRoot,
      "sample",
      "deps:\n  cli: [cobra]\nfragments:\n  default: [release]",
    );
    const pinnedRelease = fragment(
      remoteRoot,
      "release",
      "requires: [pinned-support]\ndeps:\n  runtime: [pinned-package]",
    );
    const pinnedSupport = fragment(
      remoteRoot,
      "pinned-support",
      "deps:\n  runtime: [pinned-support]",
    );
    const currentRoot = space.dir();
    const currentRelease = fragment(
      currentRoot,
      "release",
      "requires: [current-support]\ndeps:\n  runtime: [current-package]",
    );
    fragment(registry, "current-support", "deps:\n  runtime: [current-support]");
    if (scenario === "user override") {
      fragment(
        join(home, "config/stacks"),
        "release",
        "requires: [local-support]\ndeps:\n  runtime: [local-package]",
      );
      fragment(registry, "local-support", "deps:\n  runtime: [local-support]");
    }
    const refs: IndexEntry[] = [
      {
        id: "sample",
        kind: "stack",
        schemaVersion: 1,
        name: "Pinned stack",
        description: "A stack pinned to historical fragment content.",
        tags: [],
        digest: `sha256:${"1".repeat(64)}`,
        composition: {
          release: `sha256:${"2".repeat(64)}`,
          "pinned-support": `sha256:${"3".repeat(64)}`,
        },
      },
      {
        id: "release",
        kind: "fragment",
        schemaVersion: 1,
        name: "Current release",
        description: "A newer fragment with different dependencies.",
        tags: [],
        digest: `sha256:${"4".repeat(64)}`,
      },
    ];
    const index: RegistryIndex = {
      formatVersion: 1,
      minCli: "0.0.0",
      generatedAt: "2026-10-31T00:00:00Z",
      commit: "test",
      entries: refs,
    };
    const bundles = new Map<string, string>([
      [`sha256:${"1".repeat(64)}`, remoteStack],
      [`sha256:${"2".repeat(64)}`, pinnedRelease],
      [`sha256:${"3".repeat(64)}`, pinnedSupport],
    ]);
    if (scenario !== "unavailable current") bundles.set(`sha256:${"4".repeat(64)}`, currentRelease);
    const remote: RemoteIndex["Service"] = {
      current: Effect.succeed(Option.some(index)),
      bundle: (ref) => Effect.succeed(Option.fromUndefinedOr(bundles.get(ref.digest))),
      status: Effect.succeed({
        url: "https://index.example.test/v1/index.json",
        isDefaultUrl: false,
        offline: false,
        cachedAt: null,
        lastAttempt: null,
        lastOutcome: null,
        backoffUntil: null,
      }),
    };
    const args = ["show", "sample", "--json"];
    const result = await runCli(args, {
      home,
      env: quiet,
      host: { registry },
      program: Command.runWith(cli, { version: "test", renderErrors: false })(args).pipe(
        Effect.provideService(RemoteIndex, remote),
      ),
    });
    const report = await showReport(result);
    const prefix = scenario === "user override" ? "local" : "pinned";
    expect(report).toMatchObject({
      origin: "index",
      dependencyRollup: {
        included: [
          { role: "cli", name: "cobra", stack: true, fragments: [] },
          {
            role: "runtime",
            name: `${prefix}-support`,
            stack: false,
            fragments: [`${prefix}-support`],
          },
          { role: "runtime", name: `${prefix}-package`, stack: false, fragments: ["release"] },
        ],
        optional: [],
      },
    });
  },
);
