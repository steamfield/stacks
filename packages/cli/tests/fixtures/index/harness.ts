import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join, relative } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { bundleDigest, EntryBundle, type IndexEntry, type Kind } from "@steamfield/stacks-format";
import { Effect, Exit, Schema } from "effect";
import { expect } from "vitest";
import { fingerprint } from "../../../src/core/fingerprint";
import { LedgerRecord } from "../../../src/schemas/ledger";
import { ValidateReport } from "../../../src/schemas/validate";
import { quiet, runCli } from "../../helpers/cli";
import { bundledAt, composeExit } from "../../helpers/compose";
import { runRecord, writeLedger } from "../../helpers/ledger";
import { minimal, writeEntry } from "../../helpers/registry";
import { reviewSearchFixture } from "../../helpers/search-fixture";

const repo = join(import.meta.dirname, "../../../../..");
export const keyId = "index-test-only";
export const privateKey = join(import.meta.dirname, "test-private.pem");
export const publicKey = readFileSync(join(import.meta.dirname, "test-public.pem"), "utf8");

const stackExtra = `tags: [scripts]
fragments:
  default: [tools]
  optional: [extra, unproven]
verify:
  - { name: install, phase: setup, layer: install, run: "true" }
  - { name: lint, layer: lint, run: "true" }
  - { name: typecheck, layer: typecheck, run: "true" }
  - { name: test, layer: test, run: "true" }`;

export function entryPath(registry: string, kind: Kind, id: string) {
  return join(registry, kind === "stack" ? "stacks" : "fragments", id);
}

export async function compositionFingerprint(
  registry: string,
  options: { stack?: string; with?: string[] } = {},
) {
  const exit = await composeExit(
    { stack: "sample", preset: "sandbox", agents: ["claude"], ...options },
    { roots: bundledAt(registry) },
  );
  if (Exit.isFailure(exit)) throw new Error(`Invalid fixture composition: ${JSON.stringify(exit)}`);
  return Effect.runPromise(fingerprint(exit.value).pipe(Effect.provide(NodeServices.layer)));
}

export async function proof(registry: string, overrides: Partial<LedgerRecord> = {}) {
  return Schema.decodeUnknownSync(LedgerRecord)({
    schemaVersion: 1,
    date: "2026-10-27",
    stack: "sample",
    with: [],
    preset: "sandbox",
    agent: "claude",
    agentVersion: "fixture",
    mode: "headless",
    repoCommit: "1".repeat(40),
    cli: "0.6.0",
    fingerprint: await compositionFingerprint(registry),
    briefWords: 100,
    result: "pass",
    agentEnded: "exit",
    run: runRecord(),
    verifyRuns: 1,
    minutesToGreen: 2.5,
    minutesToFirstTest: 1,
    agentMinutes: 2,
    interventions: 0,
    ...overrides,
  });
}

export function snapshot(root: string): Record<string, string> {
  if (!existsSync(root)) return {};
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const at = join(dir, item.name);
      if (item.isDirectory()) walk(at);
      else files[relative(root, at)] = createHash("sha256").update(readFileSync(at)).digest("hex");
    }
  };
  walk(root);
  return files;
}

/** Independent raw-file oracle; canonicalization and digests belong to @steamfield/stacks-format. */
export function rawBundle(registry: string, kind: Kind, id: string) {
  const root = entryPath(registry, kind, id);
  const files: EntryBundle["files"][number][] = [];
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const at = join(dir, item.name);
      if (item.isDirectory()) walk(at);
      else {
        const bytes = readFileSync(at);
        files.push({
          path: relative(root, at).split("\\").join("/"),
          executable: (statSync(at).mode & 0o111) !== 0,
          encoding: "base64",
          content: bytes.toString("base64"),
        });
      }
    }
  };
  walk(root);
  return Schema.decodeUnknownSync(EntryBundle)({ id, kind, files });
}

export const digestOf = (bundle: EntryBundle) => Effect.runPromise(bundleDigest(bundle));
export const bundleFile = (out: string, entry: Pick<IndexEntry, "kind" | "id" | "digest">) =>
  join(out, "v1/entries", entry.kind, entry.id, `${entry.digest}.json`);

/** Serve only fixture files, on loopback; the OS selects the port. */
export async function serve(root: string) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://fixture").pathname);
    requests.push(path);
    const file = join(root, path);
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end("fixture file missing");
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(readFileSync(file));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No fixture HTTP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

/** Bun's isolated linker keeps each package's own dependencies in its package directory. */
function linkPackageModules(target: string, name: string) {
  const modules = join(repo, "packages", name, "node_modules");
  mkdirSync(join(target, "node_modules"), { recursive: true });
  for (const dep of existsSync(modules) ? readdirSync(modules) : []) {
    if (dep !== "@steamfield" && dep !== ".bin" && dep !== ".vite-temp")
      symlinkSync(join(modules, dep), join(target, "node_modules", dep));
  }
}

/** Copy source unchanged except the fixture trust root, never a production trust override. */
export async function fixture(temporary: string) {
  const root = join(realpathSync(temporary), "index workspace café");
  const cli = join(root, "packages/cli");
  const format = join(root, "packages/format");
  for (const name of ["src", "scripts"]) {
    cpSync(join(repo, "packages/cli", name), join(cli, name), { recursive: true });
  }
  cpSync(join(repo, "packages/format/src"), join(format, "src"), { recursive: true });
  for (const name of ["package.json", "tsconfig.base.json"])
    cpSync(join(repo, name), join(root, name));
  for (const name of ["cli", "format"]) {
    cpSync(
      join(repo, "packages", name, "package.json"),
      join(root, "packages", name, "package.json"),
    );
  }
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  for (const name of ["cli", "format"]) linkPackageModules(join(root, "packages", name), name);
  mkdirSync(join(cli, "node_modules/@steamfield"), { recursive: true });
  symlinkSync(format, join(cli, "node_modules/@steamfield/stacks-format"));
  writeFileSync(
    join(format, "src/index-keys.ts"),
    `export const INDEX_PUBLIC_KEYS = ${JSON.stringify([{ keyId, publicKey }])};\n`,
  );
  const home = join(root, "home");
  mkdirSync(home);
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    NO_COLOR: "1",
    LOG_LEVEL: "none",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2026-10-27T09:00:00Z",
    GIT_COMMITTER_DATE: "2026-10-27T09:00:00Z",
  };
  const registry = join(cli, "registry");
  mkdirSync(registry, { recursive: true });
  writeFileSync(
    join(registry, "allowlist.json"),
    JSON.stringify({
      formatVersion: 1,
      generatedAt: "2026-10-28T00:00:00Z",
      names: { npm: [], pypi: [], go: [], crates: [] },
    }),
  );
  for (const id of ["sample", "never-proven"]) {
    writeEntry({
      root: registry,
      kind: "stack",
      dir: id,
      frontmatter: minimal("stack", id, stackExtra),
      body: "# Fixture\n\n## Setup\n\nBuild a small command.\n",
    });
  }
  for (const id of ["tools", "extra", "unproven"]) {
    writeEntry({ root: registry, kind: "fragment", dir: id, frontmatter: minimal("fragment", id) });
  }
  reviewSearchFixture(registry);
  const validation = await runCli(["validate", "--json"], {
    home,
    host: { registry, cwd: cli },
    env: { ...quiet, PATH: env.PATH },
  });
  expect(validation.status, validation.stderr).toBe(0);
  expect(validation.stderr).toBe("");
  const report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(validation.stdout));
  expect(report.findings.filter((finding) => finding.severity !== "note")).toEqual([]);
  const record = await proof(registry);
  writeLedger(registry, [record]);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("add", "packages/cli/registry");
  git("commit", "--quiet", "-m", "fixture: registry");
  const commit = git("rev-parse", "HEAD");
  const out = join(root, "-published output café");
  const invoke = (args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
    new Promise<{ status: number; stdout: string; stderr: string }>((resolve, reject) => {
      execFile(
        "bun",
        ["--no-env-file", "--config=/dev/null", join(cli, "scripts/build-index.ts"), ...args],
        { cwd: options.cwd ?? cli, env: { ...env, ...options.env }, timeout: 20_000 },
        (error, stdout, stderr) => {
          if (error === null) resolve({ status: 0, stdout, stderr });
          else if (typeof error.code === "number") resolve({ status: error.code, stdout, stderr });
          else reject(error);
        },
      );
    });
  return { root, cli, registry, record, commit, out, invoke };
}

export async function readBuild(out: string) {
  const { SignedIndex, RegistryIndex } = await import("@steamfield/stacks-format");
  const envelope = Schema.decodeUnknownSync(SignedIndex)(
    JSON.parse(readFileSync(join(out, "v1/index.json"), "utf8")),
  );
  const index = Schema.decodeUnknownSync(RegistryIndex)(JSON.parse(envelope.payload));
  return { envelope, index };
}

export function preserve(out: string) {
  mkdirSync(join(out, "v1/entries/old"), { recursive: true });
  writeFileSync(join(out, "v1/index.json"), "previous index bytes\n");
  writeFileSync(join(out, "v1/entries/old/keep"), "previous bundle bytes\n");
  writeFileSync(join(dirname(out), "unrelated"), "keep sibling\n");
  return snapshot(out);
}
