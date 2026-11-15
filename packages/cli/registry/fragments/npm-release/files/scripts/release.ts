#!/usr/bin/env bun
/**
 * `bun run release <x.y.z>` prepares a release: it rewrites every place the version lives, so a
 * bump can't miss one, and refreshes the lockfile. It never commits, tags or pushes. Pushing the
 * tag `v<x.y.z>` runs .github/workflows/release.yml, which publishes. Write the changelog section
 * first: it's the one file a release allows to be modified, so the whole release is one commit.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
process.chdir(root);

const CHANGELOG = "CHANGELOG.md";
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

function readManifest(): { name: string; version: string } {
  const manifest: unknown = JSON.parse(readFileSync("package.json", "utf8"));
  if (
    typeof manifest === "object" &&
    manifest !== null &&
    "name" in manifest &&
    typeof manifest.name === "string" &&
    "version" in manifest &&
    typeof manifest.version === "string"
  )
    return { name: manifest.name, version: manifest.version };
  return fail("package.json has no name and version");
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
      `tag ${tag} already exists on origin. Delete it (git push origin :refs/tags/${tag}) or pick another version`,
    );
}

function checkPreconditions(version: string, previous: string): void {
  checkTree();
  if (run("git", ["branch", "--show-current"]) !== "main") fail("release from main");
  checkTag(version);
  if (previous === version) fail(`package.json is already at ${version}`);
  if (!isNewer(version, previous)) fail(`${version} is not newer than ${previous}`);
  if (!existsSync(CHANGELOG) || !readFileSync(CHANGELOG, "utf8").includes(`## [${version}]`))
    fail(`${CHANGELOG} has no "## [${version}] - YYYY-MM-DD" section: write it first`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Edits wait here until every pattern has matched, so a moved line fails before any file changes.
 * Add a `rewrite` call for each other place the version is written, such as an install command in
 * the README or a version a test pins.
 */
const pending = new Map<string, string>();

function rewrite(file: string, pattern: RegExp, replacement: string): void {
  const text = pending.get(file) ?? readFileSync(file, "utf8");
  if (!pattern.test(text)) fail(`${file} no longer matches ${pattern}: update scripts/release.ts`);
  pending.set(file, text.replace(pattern, replacement));
}

function prepare(version: string): string {
  const { name, version: previous } = readManifest();
  checkPreconditions(version, previous);
  rewrite("package.json", /"version": "\d+\.\d+\.\d+"/, `"version": "${version}"`);
  const readme = existsSync("README.md") ? readFileSync("README.md", "utf8") : "";
  if (readme.includes(`${name}@${previous}`))
    rewrite(
      "README.md",
      new RegExp(`${escapeRegExp(name)}@${escapeRegExp(previous)}`, "g"),
      `${name}@${version}`,
    );
  for (const [file, text] of pending) writeFileSync(file, text);
  run("bun", ["install"]);
  return `Prepared ${previous} -> ${version}. Next:
  bun run check
  git add -A && git commit -m "chore(release): ${version}"
  git push origin main           (wait for CI to pass)
  git tag v${version}            (only after the bump commit above: the tag must point at it)
  git push origin v${version}    (the Release workflow publishes; watch it with gh run watch <id> --exit-status)`;
}

try {
  const version = process.argv[2];
  if (process.argv.length !== 3 || version === undefined || !SEMVER.test(version))
    fail("usage: bun run release <major.minor.patch> (no leading v, no prerelease suffix)");
  console.log(prepare(version));
} catch (error) {
  if (!(error instanceof ReleaseFailed)) throw error;
  console.error(`release: ${error.message}`);
  process.exitCode = 1;
}
