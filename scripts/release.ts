#!/usr/bin/env bun
// `bun run release <x.y.z> [--min-cli]` prepares a release: it rewrites every place the CLI's version
// lives so a bump can't miss one, moves the MCP server (which pins the CLI's exact version) up one
// patch, regenerates the brief digests the version changes, and updates bun.lock. `--min-cli` also
// raises the bundled registry's `minCli` (registry.json) to this version, for a release whose
// registry older CLIs can't read. It never commits, tags or pushes. A pushed `v<x.y.z>` tag runs .github/workflows/release.yml, which publishes; an agent
// never publishes. packages/format/README.md, "Publishing", has the whole flow.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
process.chdir(root);

const CHANGELOG = "packages/cli/CHANGELOG.md";
const DIGESTS = "packages/cli/tests/registry/fixtures/bundled-brief-digests.ts";
const REGISTRY_META = "packages/cli/registry/registry.json";
const USAGE =
  "usage: bun run release <major.minor.patch> [--min-cli] (no leading v, no prerelease suffix)";
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

class ReleaseFailed extends Error {}

function fail(message: string): never {
  throw new ReleaseFailed(message);
}

/** A command's stdout exactly as printed; `--porcelain` lines start with a significant space. */
function capture(command: string, args: readonly string[]): string {
  const result = spawnSync(command, [...args], { encoding: "utf8" });
  if (result.status !== 0)
    fail(`${command} ${args.join(" ")} failed:\n${(result.stderr ?? "").trim()}`);
  return result.stdout ?? "";
}

function run(command: string, args: readonly string[]): string {
  return capture(command, args).trim();
}

function parse(version: string): [number, number, number] {
  const match = SEMVER.exec(version);
  if (!match) return fail(`"${version}" is not a major.minor.patch version`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(next: string, previous: string): boolean {
  const a = parse(next);
  const b = parse(previous);
  const at = a.findIndex((part, index) => part !== b[index]);
  return at !== -1 && (a[at] ?? 0) > (b[at] ?? 0);
}

function currentVersion(manifest: string): string {
  const version = /"version": "(\d+\.\d+\.\d+)"/.exec(readFileSync(manifest, "utf8"))?.[1];
  return version ?? fail(`no version found in ${manifest}`);
}

/** Replaces every match of `pattern` in `file`; fails when none matches, so a moved line is noticed. */
function rewrite(file: string, pattern: RegExp, replacement: string): void {
  const text = pending.get(file) ?? readFileSync(file, "utf8");
  if (!pattern.test(text)) fail(`${file} no longer matches ${pattern}: update scripts/release.ts`);
  pending.set(file, text.replace(pattern, replacement));
}

/** Edits wait here until every pattern has matched, so a moved line fails before any file changes. */
const pending = new Map<string, string>();

function flush(): void {
  for (const [file, text] of pending) writeFileSync(file, text);
  pending.clear();
}

/** The changelog may be edited first, so it's the one path a release allows to be dirty. */
function checkTree(): void {
  const dirty = capture("git", ["status", "--porcelain"])
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(3))
    .filter((path) => path !== CHANGELOG);
  if (dirty.length > 0)
    fail(`the working tree has uncommitted changes besides ${CHANGELOG}: ${dirty.join(", ")}`);
}

/** A tag left on origin from an earlier attempt blocks the real release, so look there too. */
function checkTag(version: string): void {
  const tag = `v${version}`;
  if (run("git", ["tag", "--list", tag]) !== "") fail(`tag ${tag} already exists locally`);
  const remote = spawnSync("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], {
    encoding: "utf8",
  });
  if (remote.status !== 0) {
    console.error(`release: could not check origin for ${tag}; make sure it has no such tag`);
    return;
  }
  if (remote.stdout.trim() !== "")
    fail(
      `tag ${tag} already exists on origin. Ask a maintainer to delete it (git push origin :refs/tags/${tag}) or pick another version`,
    );
}

function checkPreconditions(version: string, previous: string): void {
  checkTree();
  if (run("git", ["branch", "--show-current"]) !== "main") fail("release from main");
  checkTag(version);
  if (previous === version) fail(`packages/cli is already at ${version}`);
  if (!isNewer(version, previous)) fail(`${version} is not newer than ${previous}`);
  if (!readFileSync(CHANGELOG, "utf8").includes(`## [${version}]`))
    fail(`${CHANGELOG} has no "## [${version}] - YYYY-MM-DD" section: write it first`);
}

function nextPatch(version: string): string {
  const [major, minor, patch] = parse(version);
  return `${major}.${minor}.${patch + 1}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Notes the version in the digests' history, then regenerates the digests with `bun run digests`. */
function rewriteDigests(version: string): void {
  const today = new Date().toISOString().slice(0, 10);
  rewrite(
    DIGESTS,
    /^ \* After proving an intentional brief change/m,
    ` * The ${version} version in the brief changed all six again on ${today}.\n * After proving an intentional brief change`,
  );
  // The digest script rewrites the file on disk, so the history line must land first.
  flush();
  run("bun", ["run", "--cwd", "packages/cli", "digests"]);
}

function rewriteVersions(version: string, previous: string): void {
  const old = escapeRegExp(previous);
  rewrite("packages/cli/package.json", /"version": "\d+\.\d+\.\d+"/, `"version": "${version}"`);
  rewrite(
    "packages/cli/plugin/.claude-plugin/plugin.json",
    /"version": "\d+\.\d+\.\d+"/,
    `"version": "${version}"`,
  );
  rewrite(
    ".claude-plugin/marketplace.json",
    new RegExp(`"ref": "v${old}"`),
    `"ref": "v${version}"`,
  );
  rewrite(
    "packages/cli/tests/runtime.test.ts",
    new RegExp(`toBe\\("${old}"\\)`, "g"),
    `toBe("${version}")`,
  );
  rewrite(
    "packages/cli/e2e/artifact.test.ts",
    new RegExp(`version: "${old}"`),
    `version: "${version}"`,
  );
  rewrite(
    "packages/cli/tests/fixtures/index/harness.ts",
    new RegExp(`cli: "${old}"`),
    `cli: "${version}"`,
  );
}

/** Raises the registry's declared minimum CLI to this release, so older CLIs keep their own copy. */
function raiseMinCli(version: string): void {
  if (!existsSync(REGISTRY_META)) fail(`--min-cli needs ${REGISTRY_META}, which is missing`);
  rewrite(REGISTRY_META, /"minCli": "\d+\.\d+\.\d+"/, `"minCli": "${version}"`);
}

function prepare(version: string, minCli: boolean): string {
  const previous = currentVersion("packages/cli/package.json");
  checkPreconditions(version, previous);
  const mcpPrevious = currentVersion("packages/mcp/package.json");
  const mcpNext = nextPatch(mcpPrevious);
  rewriteVersions(version, previous);
  if (minCli) raiseMinCli(version);
  rewrite("packages/mcp/package.json", /"version": "\d+\.\d+\.\d+"/, `"version": "${mcpNext}"`);
  flush();
  run("bun", ["install"]);
  rewriteDigests(version);
  flush();
  return `Prepared ${previous} -> ${version} (@steamfield/stacks-mcp ${mcpPrevious} -> ${mcpNext}, since it pins the CLI). Next:
  bun run check                  (rr check in a clone opted in to rr)
  git add -A && git commit -m "chore(release): ${version}"
  git push origin main           (wait for ci-ok)
  git tag v${version}            (only after the bump commit above: the tag must point at it)
  git push origin v${version}    (the Release workflow publishes; watch it with gh run watch <id> --exit-status)
Bump packages/format's version in its own commit first when its contract changed.`;
}

try {
  const args = process.argv.slice(2);
  const minCli = args.includes("--min-cli");
  const rest = args.filter((arg) => arg !== "--min-cli");
  const version = rest[0];
  const valid = rest.length === 1 && args.length - rest.length <= 1;
  if (!valid || version === undefined || !SEMVER.test(version)) fail(USAGE);
  console.log(prepare(version, minCli));
} catch (error) {
  if (!(error instanceof ReleaseFailed)) throw error;
  console.error(`release: ${error.message}`);
  process.exitCode = 1;
}
