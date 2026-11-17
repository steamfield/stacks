import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { expect, test, vi } from "vitest";
import { AppConfig } from "../src/config";
import { renderList } from "../src/core/list/report";
import { wrap } from "../src/core/text/wrap";
import { stringWidth } from "../src/platform/width";
import { Host } from "../src/services/host";
import { Output } from "../src/services/output";
import { quiet, runCli, tempDir, terminal } from "./helpers/cli";
import { minimal, writeEntry } from "./helpers/registry";

test("list keeps normalized machine descriptions and wraps descriptions as prose", () => {
  const row = {
    kind: "stack",
    id: "example",
    name: "Example",
    description: " leading and trailing ",
    tags: [],
    origin: "bundled",
    trusted: true,
    lastRun: null,
    shadows: [],
    fragments: { required: [], default: [], optional: [] },
  } as const;
  const render = (description: string, width: number) =>
    renderList({ entries: [{ ...row, description }], rejected: [] }, [row], {
      group: undefined,
      width,
      invocation: "stacks",
    });
  expect(render(row.description, Infinity)).toContain("\n    leading and trailing\n");
  for (const description of [" leading and trailing ", "- leading and trailing words"])
    for (const line of render(description, 14)
      .split("\n")
      .filter((line) => line.startsWith("    ")))
      expect(stringWidth(line)).toBeLessThanOrEqual(14);
});

test("show wraps the escaped guidance that the terminal displays", async () => {
  const home = tempDir();
  try {
    writeEntry({
      root: home.path,
      kind: "stack",
      dir: "example",
      frontmatter: minimal("stack", "example"),
      body: "alpha \u001b[31mbravo charlie\u001b[39m delta echo",
    });
    const result = await runCli(["show", "example"], {
      home: home.path,
      env: quiet,
      host: { registry: home.path, ...terminal, columns: Option.some(20), stringWidth },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("\u001b");
    const guidance = result.stdout.split("--- guidance ---\n")[1]?.split("\n\n")[0];
    expect(guidance).toBeDefined();
    for (const line of (guidance ?? "").split("\n"))
      expect(stringWidth(line)).toBeLessThanOrEqual(20);
  } finally {
    home.cleanup();
  }
});

test("wrap preserves tilde fences and shorter markers inside a longer fence", () => {
  const tilde = "~~~sh\nprintf hello world this is one command\n~~~";
  const backtick = "````markdown\n```\nthis line stays inside the longer fence\n````";
  expect(wrap(tilde, 15, stringWidth)).toBe(tilde);
  expect(wrap(backtick, 15, stringWidth)).toBe(backtick);
});

it.effect("live frames retain elapsed time within a narrow terminal", () => {
  const stderr: string[] = [];
  const layer = Output.layer({
    jsonFlag: false,
    stdout: async () => {},
    stderr: async (text) => {
      stderr.push(text);
    },
  }).pipe(
    Layer.provide(AppConfig.memory({ NO_COLOR: "" })),
    Layer.provide(Host.memory({ ...terminal, columns: Option.some(20), stringWidth })),
    Layer.provide(NodeServices.layer),
  );
  return Effect.gen(function* () {
    const output = yield* Output;
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* output.live("a very long step name that would wrap over two terminal rows");
        yield* TestClock.adjust("150 millis");
        expect(stderr).toHaveLength(1);
        expect(stringWidth(stderr.join(""))).toBeLessThanOrEqual(20);
        expect(stderr.join("")).toContain("0.1s");
      }),
    );
  }).pipe(Effect.provide(layer));
});

test.each([false, true])("a stalled event writer remains interruptible (json=%s)", async (json) => {
  let enter = () => {};
  let release = () => {};
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = new AbortController();
  let settled = false;
  const pending = runCli(json ? ["--json"] : [], {
    env: quiet,
    signal: controller.signal,
    program: Effect.gen(function* () {
      const output = yield* Output;
      yield* output.event({ event: "started" }, "> lint");
    }),
    stderr: async (text) => {
      if (text.includes("started") || text === "> lint\n") {
        enter();
        await held;
      }
    },
  }).then((result) => {
    settled = true;
    return result;
  });
  try {
    await entered;
    controller.abort();
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 500 });
    const result = await pending;
    expect(result.status).toBe(130);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(json ? '"tag":"Interrupted"' : "Command interrupted.");
  } finally {
    release();
    await pending;
  }
});
