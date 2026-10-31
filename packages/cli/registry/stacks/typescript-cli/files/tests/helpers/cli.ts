import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { onTestFinished } from "vitest";
import { jsonRequested, main } from "../../src/main";
import { AppLayer, runInvocation } from "../../src/runtime";
import { Host } from "../../src/services/host";
import type { Writer } from "../../src/services/output";

export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "cli-test-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export const ndjson = (text: string): unknown[] =>
  text.trim()
    ? text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown)
    : [];

export async function runCli(
  args: readonly string[],
  options: {
    home?: string;
    env?: Readonly<Record<string, string | undefined>>;
    program?: Parameters<typeof main>[1];
    stdout?: Writer;
    stderr?: Writer;
  } = {},
) {
  const home = options.home ?? (await tempDir());
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    ...options.env,
  };
  let stdout = "";
  let stderr = "";
  const app = AppLayer(
    env,
    jsonRequested(args),
    options.stdout ??
      (async (text) => {
        stdout += text;
      }),
    options.stderr ??
      (async (text) => {
        stderr += text;
      }),
  );
  const platform = Layer.mergeAll(
    NodeServices.layer,
    Host.layer({ name: "test-cli", version: "dev", platform: "test", compiled: false }),
  );
  const status = await runInvocation(
    main(args, options.program).pipe(Effect.provide(app), Effect.provide(platform), Effect.scoped),
  );
  return { status, stdout, stderr };
}
