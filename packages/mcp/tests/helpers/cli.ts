import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Duration, Layer } from "effect";
import { McpConfig, type McpConfigShape } from "../../src/config";
import { CliRunner } from "../../src/run";

export { tempDir } from "./temp";

export function fixture(name: string) {
  return readFileSync(resolve(import.meta.dirname, `../fixtures/${name}`), "utf8");
}

export function jsonFixture(name: string): unknown {
  return JSON.parse(fixture(`${name}.json`));
}

export function envelopeFixture(name: string) {
  return JSON.stringify(jsonFixture(name));
}

export function fakeCli(root: string, source: string) {
  const dist = join(root, "package", "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(root, "package", "package.json"), '{"name":"@steamfield/stacks"}');
  const entry = join(dist, "stacks.mjs");
  writeFileSync(entry, source, { mode: 0o755 });
  return realpathSync(entry);
}

export function outputCli(
  root: string,
  output: { stdout?: string; stderr?: string; exit?: number; record?: string },
) {
  const recording =
    output.record === undefined
      ? ""
      : `
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(output.record)}, JSON.stringify({
  args: process.argv.slice(2), cwd: process.cwd(), env: process.env,
  node: process.execPath, bun: process.versions.bun ?? null
}));`;
  return fakeCli(
    root,
    `${recording}
process.stdout.write(${JSON.stringify(output.stdout ?? "")});
process.stderr.write(${JSON.stringify(output.stderr ?? "")});
process.exitCode = ${output.exit ?? 0};`,
  );
}

export function runnerLayer(cliEntry: string, overrides: Partial<McpConfigShape> = {}) {
  return CliRunner.layer.pipe(
    Layer.provide(
      McpConfig.fixed({
        node: process.execPath,
        cliEntry,
        env: { HOME: join(cliEntry, ".."), PATH: "", STACKS_MCP_TEST: "captured" },
        timeout: Duration.seconds(30),
        logLevel: "None",
        ...overrides,
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}

export function digest(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
