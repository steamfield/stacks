import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Run with Node after `bun run --filter @steamfield/stacks build`. Normalize paths and format JSON.
const captureRoot = mkdtempSync(join(tmpdir(), "stacks-mcp-capture-"));
const root = realpathSync(captureRoot);
const captureRoots = [...new Set([root, captureRoot])].sort((a, b) => b.length - a.length);
const cli = realpathSync(resolve(import.meta.dirname, "../../cli/dist/stacks"));
const fixtures = resolve(import.meta.dirname, "../tests/fixtures");
const env = {
  HOME: root,
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_STATE_HOME: join(root, "state"),
  STACKS_STATE_DIR: join(root, "state", "stacks"),
  STACKS_OFFLINE: "1",
  STACKS_TELEMETRY_DISABLED: "1",
  PATH: "",
  LOGNAME: "fixture",
  USER: "fixture",
  SHELL: "/bin/sh",
  TERM: "dumb",
};

function run(args: string[], cwd = root, status = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== status) {
    throw new Error(`CLI ${args.join(" ")}: ${result.error ?? result.status}\n${result.stderr}`);
  }
  return result;
}

function normalizedJson(text: string) {
  return JSON.stringify(
    JSON.parse(text, (_key, value: unknown) => {
      if (typeof value !== "string") return value;
      return captureRoots.reduce(
        (text, path) => text.replaceAll(path, "/stacks-mcp-capture"),
        value,
      );
    }),
  );
}

function save(name: string, text: string) {
  writeFileSync(join(fixtures, `${name}.json`), normalizedJson(text));
}

try {
  mkdirSync(fixtures, { recursive: true });
  save("list", run(["list", "--json"]).stdout);
  save(
    "not-found",
    run(["new", "--no-launch", "--json", "--", "does-not-exist", join(root, "absent")], root, 2)
      .stderr,
  );

  // A tiny real registry gives all outcomes without installing tools or changing a result.
  const registry = join(root, "registry");
  const entry = join(registry, "stacks", "fixture");
  mkdirSync(entry, { recursive: true });
  writeFileSync(
    join(entry, "STACK.md"),
    `---
schema_version: 1
id: fixture
kind: stack
name: Fixture project
description: A project for capturing CLI wire results.
tags: [node]
verify:
  - { name: first, run: "test ! -f fail || { echo 'fixture failure output' >&2; exit 1; }", layer: test }
  - { name: second, run: "test ! -f fail || { echo 'fixture failure output' >&2; exit 1; }", layer: check }
---

# Fixture project

Run the two checks.
`,
  );
  Object.assign(env, { STACKS_REGISTRY_DIR: registry });
  const project = join(root, "project with spaces");
  save(
    "new",
    run(["new", "--no-launch", "--json", "--preset=sandbox", "--", "fixture", project]).stdout,
  );
  const rejected = join(registry, "stacks", "rejected");
  mkdirSync(rejected, { recursive: true });
  writeFileSync(
    join(rejected, "STACK.md"),
    "---\nschema_version: 1\nid: rejected\nkind: stack\n---\n",
  );
  save("list-project", run(["list", "--json"], project).stdout);
  const green = run(["verify", "--json"], project);
  save("verify-green", green.stdout);
  writeFileSync(
    join(fixtures, "verify-events.jsonl"),
    `${green.stderr.trimEnd().split("\n").map(normalizedJson).join("\n")}\n`,
  );
  save("verify-partial", run(["verify", "--json", "--only=first"], project).stdout);
  writeFileSync(join(project, "fail"), "");
  const failed = run(["verify", "--json"], project, 5);
  save("verify-failed", failed.stdout);
  save("verify-failed-envelope", failed.stderr.trim().split("\n").at(-1) ?? "");
  const manifestPath = join(project, ".stacks/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.verify[0].run = "true";
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const changed = run(["verify", "--json"], project, 5);
  save("verify-changed", changed.stdout);
  save("verify-changed-envelope", changed.stderr);
  const formatted = spawnSync(
    resolve(import.meta.dirname, "../../../node_modules/.bin/biome"),
    ["format", "--write", fixtures],
    { encoding: "utf8" },
  );
  if (formatted.status !== 0) throw new Error(`Fixture formatting failed: ${formatted.stderr}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
