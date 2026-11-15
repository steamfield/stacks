#!/usr/bin/env bun
/**
 * Packs and publishes the package for the release workflow. Registry integrity checks make publishing safe to rerun.
 */

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
  readonly code: string | undefined;
  constructor(message: string, stdout: string, code: string | undefined) {
    super(message);
    this.stdout = stdout;
    this.code = code;
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
    E404: `npm returned 404 for a package that may exist: on publish this usually means the OIDC login failed, so check ${trusted} matches this repository and workflow exactly (no environment), that "Allow npm publish" is ticked, and that the runner's npm is new enough. It can also mean the scope does not exist or a new package was never published by hand.`,
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

/** A hung registry call fails the step instead of running until the job's timeout. */
function npmTimeout(command: string | undefined): number | undefined {
  if (command === "view") return milliseconds("RELEASE_VIEW_TIMEOUT_MS", 60_000);
  if (command === "publish") return milliseconds("RELEASE_PUBLISH_TIMEOUT_MS", 300_000);
  if (command === "pack") return 300_000;
  return undefined;
}

/** Runs npm. A failure carries the command, npm's error lines and a hint, not a child-process dump. */
function npm(args: readonly string[], cwd = root): string {
  const timeout = npmTimeout(args[0]);
  const result = spawnSync("npm", [...args], {
    cwd,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
  });
  if (result.error) {
    if (timeout !== undefined && "code" in result.error && result.error.code === "ETIMEDOUT")
      throw new NpmFailed(
        `npm ${args[0] ?? ""} timed out after ${Math.round(timeout / 1000)}s. The registry is slow or unreachable; rerun the failed job.`,
        "",
        "ETIMEDOUT",
      );
    throw new PublishFailed(`could not run npm: ${result.error.message}`);
  }
  if (result.status === 0) return result.stdout;
  const stderr = result.stderr ?? "";
  const code = /^npm error code (\w+)/m.exec(stderr)?.[1];
  const advice = code === undefined ? undefined : hint(code);
  const lines = npmErrorLines(stderr).map((line) => `  ${line}`);
  const head = `npm ${args[0] ?? ""} failed${code === undefined ? "" : ` (${code})`}`;
  throw new NpmFailed(
    [head, ...lines, ...(advice === undefined ? [] : [`Hint: ${advice}`])].join("\n"),
    result.stdout ?? "",
    code,
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

/**
 * Failures worth another try: registry overload (429, 5xx), our own call timeout and network
 * drops. Auth, 404 and anything else npm reports are answers, not hiccups, and fail at once.
 */
const TRANSIENT =
  /^(E429|E5\d\d|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EPIPE)$/;

/**
 * `npm view` is a read, so retrying it is safe. Backoff doubles from the base with full jitter
 * (about 5s, 10s, 20s by default). `npm publish` is never retried: a rerun of the job checks the
 * registry first.
 */
function viewIntegrity(spec: string): string {
  const attempts = milliseconds("RELEASE_VIEW_ATTEMPTS", 4);
  const base = milliseconds("RELEASE_RETRY_BASE_MS", 5000);
  for (let attempt = 1; ; attempt++) {
    try {
      return npm(["view", spec, "dist.integrity", "--json", "--prefer-online"]);
    } catch (error) {
      if (!(error instanceof NpmFailed)) throw error;
      const code = error.code ?? registryErrorCode(error.stdout);
      if (typeof code !== "string" || !TRANSIENT.test(code) || attempt >= attempts) {
        if (attempt > 1) error.message += `\n(gave up after ${attempt} attempts)`;
        throw error;
      }
      const delay = Math.round(Math.random() * base * 2 ** (attempt - 1));
      console.log(
        `npm view ${spec} failed with ${code}; retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1} of ${attempts}).`,
      );
      sleep(delay);
    }
  }
}

/** The integrity npm serves for a version, or null when the registry says it does not exist. */
function publishedIntegrity(spec: string): string | null {
  try {
    const served: unknown = JSON.parse(viewIntegrity(spec));
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

/** Waiting times are milliseconds in env so tests can set them to zero. */
function milliseconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A GitHub annotation in Actions, a plain line elsewhere; the run still passes. */
function warn(title: string, message: string): void {
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=${title}::${message}`);
  else console.log(`warning: ${message}`);
}

/**
 * npm reports a publish well before the registry serves it, usually within 3 to 5 minutes. Wait
 * for the first check, then poll. A different integrity is a real conflict and fails at once.
 * Nothing depends on this package, so one npm accepted but the registry has not shown yet warns
 * instead of failing the run. A project that publishes a package another one depends on should
 * fail for that first package instead.
 */
function confirmPublished(packed: Packed): void {
  const delay = milliseconds("RELEASE_CONFIRM_DELAY_MS", 120_000);
  const interval = milliseconds("RELEASE_CONFIRM_INTERVAL_MS", 15_000);
  const attempts = milliseconds("RELEASE_CONFIRM_ATTEMPTS", 20);
  const spec = `${packed.name}@${packed.version}`;
  console.log(`Waiting for the registry to show ${spec}`);
  sleep(delay);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const found = publishedIntegrity(spec);
    if (found === packed.integrity) {
      console.log(`Confirmed ${spec}`);
      return;
    }
    if (found !== null)
      throw new PublishFailed(`${spec} is on npm with different contents than the build.`);
    if (attempt < attempts) sleep(interval);
  }
  warn(
    "Release not yet visible on npm",
    `npm accepted ${spec} but the registry had not shown it after ${Math.round((delay + attempts * interval) / 1000)}s. Check \`npm view ${packed.name} version\` in a few minutes; rerun this job only if it never appears.`,
  );
}

/** Publishes the tarball; an E409 means an earlier run published it and the registry lags. */
function publishTarball(directory: string, packed: Packed): void {
  const spec = `${packed.name}@${packed.version}`;
  console.log(`Publishing ${spec}`);
  try {
    process.stdout.write(
      npm(["publish", resolve(directory, packed.filename), "--provenance", "--access", "public"]),
    );
  } catch (error) {
    if (!(error instanceof NpmFailed && error.code === "E409")) throw error;
    console.log(`${spec} was already published; waiting for the registry.`);
  }
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
  publishTarball(directory, packed);
  confirmPublished(packed);
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
