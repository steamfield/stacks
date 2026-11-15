#!/usr/bin/env bun
// The release workflow's two npm steps, kept out of inline shell so they can be tested:
//   bun scripts/publish.ts collect <dir> [--format-only]   gather the packed tarballs and their integrity
//   bun scripts/publish.ts publish <dir>                    publish them in order, safely rerunnable
// `publish` checks the registry first: a version that isn't there is published with provenance, one
// with the same integrity is skipped, one with different bytes stops the release. Authentication is
// npm trusted publishing (OIDC); this script never reads or sets a token.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = join(import.meta.dirname, "..");
/** Publish order: the CLI pins this exact format version, and the MCP server pins the CLI's. */
const PACKAGES = ["format", "cli", "mcp"] as const;

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

/** What each npm failure code means in this pipeline, shown under the failure. */
const HINTS: Readonly<Record<string, string>> = {
  EOTP: "npm asked for a one-time password, so this was not an OIDC publish. Check the package's Trusted Publisher (steamfield/stacks, release.yml) and that no NODE_AUTH_TOKEN is set.",
  ENEEDAUTH:
    "npm had no credentials. Trusted publishing needs `id-token: write` on the job and a Trusted Publisher on the package.",
  E401: "npm rejected the credentials. Check the package's Trusted Publisher (steamfield/stacks, release.yml).",
  E403: "npm refused this publish: the package's Trusted Publisher is missing or does not match this repository and workflow, or the version already exists.",
  E404: "npm returned 404 for a package that may exist: on publish this usually means the OIDC login failed, so check the package's Trusted Publisher matches steamfield/stacks and release.yml exactly (no environment), that \"Allow npm publish\" is ticked, and that the runner's npm is new enough. It can also mean the scope does not exist or a new package was never published by hand.",
  E422: "npm rejected the provenance. Provenance needs a public repository, `id-token: write` and a `repository` field in the package.json that was packed.",
};

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
  return undefined;
}

/** The command as a failure message names it. A tarball path says nothing its file name doesn't. */
function shownCommand(args: readonly string[]): string {
  return args
    .slice(0, 2)
    .map((arg) => (arg.startsWith("@") ? arg : basename(arg)))
    .join(" ");
}

/** Runs npm. A failure carries the command, npm's error lines and a hint, not a child-process dump. */
function npm(args: readonly string[]): string {
  const timeout = npmTimeout(args[0]);
  const result = spawnSync("npm", [...args], { encoding: "utf8", timeout, killSignal: "SIGKILL" });
  if (result.error) {
    if (timeout !== undefined && "code" in result.error && result.error.code === "ETIMEDOUT")
      throw new NpmFailed(
        `npm ${shownCommand(args)} timed out after ${Math.round(timeout / 1000)}s. The registry is slow or unreachable; rerun the failed job.`,
        "",
        "ETIMEDOUT",
      );
    throw new PublishFailed(`could not run npm: ${result.error.message}`);
  }
  if (result.status === 0) return result.stdout;
  const stderr = result.stderr ?? "";
  const code = /^npm error code (\w+)/m.exec(stderr)?.[1];
  const hint = code !== undefined && Object.hasOwn(HINTS, code) ? HINTS[code] : undefined;
  const lines = npmErrorLines(stderr).map((line) => `  ${line}`);
  const head = `npm ${shownCommand(args)} failed${code === undefined ? "" : ` (${code})`}`;
  throw new NpmFailed(
    [head, ...lines, ...(hint === undefined ? [] : [`Hint: ${hint}`])].join("\n"),
    result.stdout ?? "",
    code,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function tarballName(name: string, version: string): string {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
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
  throw new PublishFailed(
    "packages.json has an entry without name, version, filename and integrity.",
  );
}

function readManifest(directory: string): Packed[] {
  const listed: unknown = JSON.parse(readFileSync(join(directory, "packages.json"), "utf8"));
  if (!Array.isArray(listed)) throw new PublishFailed("packages.json is not a list.");
  const packages = listed.map(decodePacked);
  const expected = PACKAGES.map((dir) => packageJson(dir).name);
  const inOrder = packages.every((entry, index) => entry.name === expected[index]);
  if (packages.length === 0 || !inOrder)
    throw new PublishFailed(
      `The release must list ${expected.join(", ")} in that order, or only the first. It lists: ${packages.map((entry) => entry.name).join(", ") || "nothing"}.`,
    );
  return packages;
}

function packageJson(dir: (typeof PACKAGES)[number]): { name: string; version: string } {
  const parsed: unknown = JSON.parse(
    readFileSync(join(root, "packages", dir, "package.json"), "utf8"),
  );
  if (isRecord(parsed) && typeof parsed.name === "string" && typeof parsed.version === "string")
    return { name: parsed.name, version: parsed.version };
  throw new PublishFailed(`packages/${dir}/package.json has no name or version.`);
}

/** Copies each packed tarball into `directory` and records its integrity in `packages.json`. */
function collect(directory: string, formatOnly: boolean): void {
  mkdirSync(directory, { recursive: true });
  const dirs = formatOnly ? PACKAGES.slice(0, 1) : PACKAGES;
  const packed = dirs.map((dir): Packed => {
    const { name, version } = packageJson(dir);
    const filename = tarballName(name, version);
    const source = join(root, "packages", dir, "dist/pack", filename);
    if (!existsSync(source))
      throw new PublishFailed(
        `${source} is missing: run \`bun run pack\` in packages/${dir} first.`,
      );
    copyFileSync(source, join(directory, filename));
    const bytes = readFileSync(source);
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    return { name, version, filename, integrity };
  });
  writeFileSync(join(directory, "packages.json"), `${JSON.stringify(packed, null, 2)}\n`);
  console.log(`Collected ${packed.map((entry) => `${entry.name}@${entry.version}`).join(", ")}`);
}

/** Looks every version up before publishing any, so a conflict stops the release with nothing out. */
function lookUp(packages: readonly Packed[]): ReadonlyMap<string, string | null> {
  const found = new Map<string, string | null>();
  for (const entry of packages) {
    const spec = `${entry.name}@${entry.version}`;
    const existing = publishedIntegrity(spec);
    if (existing !== null && existing !== entry.integrity)
      throw new PublishFailed(
        `${spec} is already on npm with different contents. Never republish a version: bump its version and tag again.`,
      );
    found.set(spec, existing);
  }
  return found;
}

const specOf = (entry: Packed) => `${entry.name}@${entry.version}`;

/** Seconds of waiting are milliseconds in env so tests can set them to zero. */
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
 * for the first check, then poll. A different integrity is a real conflict and fails at once. With
 * `required` false, a version npm accepted but the registry has not shown yet warns instead of
 * failing the run.
 */
function confirmPublished(entry: Packed, required: boolean): void {
  const delay = milliseconds("RELEASE_CONFIRM_DELAY_MS", 120_000);
  const interval = milliseconds("RELEASE_CONFIRM_INTERVAL_MS", 15_000);
  const attempts = milliseconds("RELEASE_CONFIRM_ATTEMPTS", 20);
  const spec = specOf(entry);
  console.log(`Waiting for the registry to show ${spec}`);
  sleep(delay);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const found = publishedIntegrity(spec);
    if (found === entry.integrity) {
      console.log(`Confirmed ${spec}`);
      return;
    }
    if (found !== null)
      throw new PublishFailed(`${spec} is on npm with different contents than the build.`);
    if (attempt < attempts) sleep(interval);
  }
  const seconds = Math.round((delay + attempts * interval) / 1000);
  if (!required) {
    warn(
      "Release not yet visible on npm",
      `npm accepted ${spec} but the registry had not shown it after ${seconds}s. Check \`npm view ${entry.name} version\` in a few minutes; rerun this job only if it never appears.`,
    );
    return;
  }
  throw new PublishFailed(
    `Could not confirm ${spec} on the registry after ${seconds}s. npm reported the publish, so rerun the job: it skips versions already published.`,
  );
}

/** Publishes one version; an E409 means an earlier run published it and the registry lags. */
function publishOne(directory: string, entry: Packed): void {
  const spec = specOf(entry);
  console.log(`Publishing ${spec}`);
  try {
    process.stdout.write(
      npm(["publish", resolve(directory, entry.filename), "--provenance", "--access", "public"]),
    );
  } catch (error) {
    if (!(error instanceof NpmFailed && error.code === "E409")) throw error;
    console.log(`${spec} was already published; waiting for the registry.`);
  }
}

interface Progress {
  readonly confirmed: string[];
  readonly unconfirmed: string[];
}

/**
 * Each package is visible before the next goes out: the CLI pins format, and MCP pins the CLI.
 * Nothing depends on the last package, so its own confirmation only warns.
 */
function publishInOrder(directory: string, packages: readonly Packed[], progress: Progress): void {
  const found = lookUp(packages);
  for (const [index, entry] of packages.entries()) {
    const spec = specOf(entry);
    if (found.get(spec) === null) {
      publishOne(directory, entry);
      progress.unconfirmed.push(spec);
      confirmPublished(entry, index < packages.length - 1);
      progress.unconfirmed.pop();
    } else console.log(`Verified ${spec}; skipping publish.`);
    progress.confirmed.push(spec);
  }
}

function publish(directory: string): void {
  const packages = readManifest(directory);
  const progress: Progress = { confirmed: [], unconfirmed: [] };
  try {
    publishInOrder(directory, packages, progress);
  } catch (error) {
    if (!(error instanceof PublishFailed)) throw error;
    const list = (items: readonly string[]) => (items.length === 0 ? "none" : items.join(", "));
    const rest = packages
      .map(specOf)
      .filter((spec) => !progress.confirmed.includes(spec) && !progress.unconfirmed.includes(spec));
    throw new PublishFailed(
      [
        error.message,
        `On npm: ${list(progress.confirmed)}.`,
        `Published but not yet visible: ${list(progress.unconfirmed)}.`,
        `Not published: ${list(rest)}.`,
        "After fixing the cause, rerun the failed job: it skips what is already on npm.",
      ].join("\n"),
    );
  }
}

/** One readable message on stderr plus a GitHub annotation, instead of a stack trace. */
function report(message: string): void {
  if (process.env.GITHUB_ACTIONS)
    console.error(`::error title=Release failed::${message.replace(/\n/g, "%0A")}`);
  console.error(`publish: ${message}`);
  process.exitCode = 1;
}

const USAGE = "Usage: bun scripts/publish.ts collect <dir> [--format-only] | publish <dir>";

function main(argv: readonly string[]): void {
  const [command, directory, flag] = argv;
  if (command === "collect" && directory && (flag === undefined || flag === "--format-only"))
    collect(directory, flag === "--format-only");
  else if (command === "publish" && directory && flag === undefined) publish(directory);
  else throw new PublishFailed(USAGE);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof PublishFailed)) throw error;
  report(error.message);
}
