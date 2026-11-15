#!/usr/bin/env bun
// The release workflow's two npm steps, kept out of inline shell so tests can run them:
//   bun scripts/publish.ts pack <dir>      pack the package into <dir> and record its integrity
//   bun scripts/publish.ts publish <dir>   publish that tarball; safe to rerun
// `publish` asks the registry first. A version that isn't there is published with provenance, one
// with the same integrity is skipped, one with different bytes stops the release. It authenticates
// through npm trusted publishing (OIDC) and never reads or sets a token.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = join(import.meta.dirname, "..");
const RECORD = "release.json";

interface Packed {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly integrity: string;
}

/** An expected failure, reported as a message and an annotation, never a stack trace. */
class PublishFailed extends Error {}

/** An npm call that failed; `stdout` is kept because `npm view --json` reports registry errors there. */
class NpmFailed extends PublishFailed {
  readonly stdout: string;
  constructor(message: string, stdout: string) {
    super(message);
    this.stdout = stdout;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `owner/repo` from package.json's `repository`, for the hints below. */
function repositoryName(): string {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const repository = isRecord(manifest) ? manifest.repository : undefined;
    const url = isRecord(repository) ? repository.url : repository;
    const match = typeof url === "string" ? /github\.com[/:]([^/]+\/[^/.]+)/.exec(url) : null;
    return match?.[1] ?? "this repository";
  } catch {
    return "this repository";
  }
}

/** What each npm failure code means in this pipeline, shown under the failure. */
function hint(code: string): string | undefined {
  const trusted = `the package's Trusted Publisher (${repositoryName()}, release.yml)`;
  const hints: Readonly<Record<string, string>> = {
    EOTP: `npm asked for a one-time password, so this was not an OIDC publish. Check ${trusted} and that no NODE_AUTH_TOKEN is set.`,
    ENEEDAUTH:
      "npm had no credentials. Trusted publishing needs `id-token: write` on the job and a Trusted Publisher on the package.",
    E401: `npm rejected the credentials. Check ${trusted}.`,
    E403: `npm refused this publish: ${trusted} is missing or does not match this repository and workflow, or the version already exists.`,
    E404: "npm could not find the package or scope. A new package must be published once by hand before a Trusted Publisher can be configured.",
    E422: "npm rejected the provenance. Provenance needs a public repository, `id-token: write` and a `repository` field in package.json.",
  };
  return Object.hasOwn(hints, code) ? hints[code] : undefined;
}

/** npm's own `npm error` lines, without the code line and the log-file pointer. */
function npmErrorLines(stderr: string): string[] {
  return stderr
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("npm error") &&
        !line.startsWith("npm error code") &&
        !line.includes("A complete log"),
    )
    .map((line) => line.replace(/^npm error ?/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** Runs npm. A failure carries the command, npm's error lines and a hint, not a child-process dump. */
function npm(args: readonly string[], cwd = root): string {
  const result = spawnSync("npm", [...args], { cwd, encoding: "utf8" });
  if (result.error) throw new PublishFailed(`could not run npm: ${result.error.message}`);
  if (result.status === 0) return result.stdout;
  const stderr = result.stderr ?? "";
  const code = /^npm error code (\w+)/m.exec(stderr)?.[1];
  const advice = code === undefined ? undefined : hint(code);
  const lines = npmErrorLines(stderr).map((line) => `  ${line}`);
  const head = `npm ${args[0] ?? ""} failed${code === undefined ? "" : ` (${code})`}`;
  throw new NpmFailed(
    [head, ...lines, ...(advice === undefined ? [] : [`Hint: ${advice}`])].join("\n"),
    result.stdout ?? "",
  );
}

/** The registry's `error.code` from `npm view --json` output, or undefined when it isn't JSON. */
function registryErrorCode(stdout: string): unknown {
  try {
    const body: unknown = JSON.parse(stdout);
    return isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

/** The integrity npm serves for a version, or null when the registry says it does not exist. */
function publishedIntegrity(spec: string): string | null {
  try {
    const served: unknown = JSON.parse(
      npm(["view", spec, "dist.integrity", "--json", "--prefer-online"]),
    );
    if (typeof served !== "string")
      throw new PublishFailed(`npm returned an unexpected integrity for ${spec}`);
    return served;
  } catch (error) {
    // Only an explicit registry 404 means the version can be published.
    if (error instanceof NpmFailed && registryErrorCode(error.stdout) === "E404") return null;
    throw error;
  }
}

function decodePacked(value: unknown): Packed {
  if (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    typeof value.filename === "string" &&
    typeof value.integrity === "string"
  )
    return {
      name: value.name,
      version: value.version,
      filename: value.filename,
      integrity: value.integrity,
    };
  throw new PublishFailed(`${RECORD} lacks a name, version, filename and integrity.`);
}

/** Runs the project's `prepack` (its build) here, so its output can't mix into npm's JSON. */
function prepack(): void {
  const result = spawnSync("bun", ["run", "prepack"], { cwd: root, stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new PublishFailed(
      "`bun run prepack` failed: the package did not build, so nothing was packed.",
    );
}

/**
 * Packs the package into `directory` and records what it made. A build that cleans `dist/` would
 * delete a destination inside it, so pack into a temporary directory and copy the tarball out.
 */
function pack(directory: string): void {
  prepack();
  const staging = mkdtempSync(join(tmpdir(), "release-pack-"));
  try {
    const output: unknown = JSON.parse(
      npm(["pack", "--ignore-scripts", "--json", "--pack-destination", staging]),
    );
    const [first] = Array.isArray(output) ? output : [];
    const packed = decodePacked(first);
    mkdirSync(directory, { recursive: true });
    copyFileSync(join(staging, packed.filename), join(directory, packed.filename));
    writeFileSync(join(directory, RECORD), `${JSON.stringify(packed, null, 2)}\n`);
    console.log(`Packed ${packed.name}@${packed.version}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function readRecord(directory: string): Packed {
  const file = join(directory, RECORD);
  if (!existsSync(file))
    throw new PublishFailed(
      `${file} is missing: run \`bun scripts/publish.ts pack ${directory}\` first.`,
    );
  return decodePacked(JSON.parse(readFileSync(file, "utf8")));
}

function publish(directory: string): void {
  const packed = readRecord(directory);
  const spec = `${packed.name}@${packed.version}`;
  const existing = publishedIntegrity(spec);
  if (existing === packed.integrity) {
    console.log(`Verified ${spec}; skipping publish.`);
    return;
  }
  if (existing !== null)
    throw new PublishFailed(
      `${spec} is already on npm with different contents. Never republish a version: bump it and tag again.`,
    );
  console.log(`Publishing ${spec}`);
  process.stdout.write(
    npm(["publish", resolve(directory, packed.filename), "--provenance", "--access", "public"]),
  );
  if (publishedIntegrity(spec) !== packed.integrity)
    throw new PublishFailed(
      `Could not confirm ${spec} on the registry after publishing. The registry may be lagging: rerun the job, it skips a version already published.`,
    );
}

/** One readable message on stderr plus a GitHub annotation, instead of a stack trace. */
function report(message: string): void {
  const rerun = "After fixing the cause, rerun the failed job: it skips what is already on npm.";
  const text = `${message}\n${rerun}`;
  if (process.env.GITHUB_ACTIONS)
    console.error(`::error title=Release failed::${text.replace(/\n/g, "%0A")}`);
  console.error(`publish: ${text}`);
  process.exitCode = 1;
}

const USAGE = "Usage: bun scripts/publish.ts pack <dir> | publish <dir>";

function main(argv: readonly string[]): void {
  const [command, directory, extra] = argv;
  if (command === "pack" && directory && extra === undefined) pack(directory);
  else if (command === "publish" && directory && extra === undefined) publish(directory);
  else throw new PublishFailed(USAGE);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof PublishFailed)) throw error;
  report(error.message);
}
