import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { ValidateReport } from "../src/schemas/validate";
import { VERSION } from "../src/version";
import { fixture } from "./fixtures/index/harness";
import { quiet, runCli } from "./helpers/cli";
import { emptyRegistry } from "./helpers/registry";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

const buildTimeout = 30_000;
const metadata = (minCli: string) => JSON.stringify({ formatVersion: 1, minCli });

test.each([
  {
    label: "a version with a leading zero",
    write: (file: string) => writeFileSync(file, metadata(`0${VERSION}`)),
    message: /registry\.json: .*major\.minor\.patch/,
  },
  {
    label: "a symlink to valid metadata outside the registry",
    write: (file: string, root: string) => {
      const external = join(root, "external.json");
      writeFileSync(external, metadata(VERSION));
      rmSync(file);
      symlinkSync(external, file);
    },
    message: /registry\.json: .*regular file/,
  },
  {
    label: "a named pipe",
    write: (file: string) => {
      rmSync(file);
      execFileSync("mkfifo", [file]);
    },
    message: /registry\.json: .*regular file/,
  },
  {
    label: "a minimum newer than the source checkout",
    write: (file: string) => writeFileSync(file, metadata("999.0.0")),
    message: /registry\.json: .*Build from a checkout/,
  },
])(
  "build:index rejects $label before publishing",
  async ({ write, message }) => {
    const built = await fixture(space.dir());
    write(join(built.registry, "registry.json"), built.root);

    const result = await built.invoke(["--out", built.out, "--previous", "none", "--unsigned"], {
      timeout: 5_000,
    });

    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toBe("");
    const lines = result.stderr.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(message);
    expect(existsSync(built.out)).toBe(false);
  },
  buildTimeout,
);

test("validate requires registry.json when the allowlist marker is a symlink loop", async () => {
  const home = realpathSync(space.dir());
  const root = join(home, "registry");
  mkdirSync(join(root, "stacks"), { recursive: true });
  symlinkSync("allowlist.json", join(root, "allowlist.json"));

  const result = await runCli(["validate", root, "--json"], {
    home,
    env: quiet,
    host: { registry: emptyRegistry },
  });

  expect(result.status, result.stderr).toBe(2);
  const report = Schema.decodeUnknownSync(Schema.fromJsonString(ValidateReport))(result.stdout);
  expect(report.findings).toMatchObject([
    { check: "deps-invalid", severity: "error", file: "allowlist.json" },
    { check: "registry-meta", severity: "error", file: "registry.json" },
  ]);
  const { error } = Schema.decodeUnknownSync(Schema.fromJsonString(ErrorEnvelope))(result.stderr);
  expect(error).toMatchObject({ tag: "ValidationFailed", details: { errors: 2, warnings: 0 } });
});
