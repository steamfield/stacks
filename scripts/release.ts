// Publishes @steamfield/stacks-format, then @steamfield/stacks, at the versions in their
// package.json files, from a clean detached worktree of origin/main, then tags v<cli version>.
// A person runs it (`bun run release`, or `bun run release -- --dry-run` to pack and check
// without publishing or tagging); packages/format/README.md, "Publishing", has the steps it wraps.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGES = ["format", "cli"] as const;
const dryRun = process.argv.includes("--dry-run");
const root = join(import.meta.dirname, "..");

class ReleaseFailed extends Error {}

/** Stops the release; thrown rather than exiting so the worktree's `finally` still runs. */
function fail(message: string): never {
  throw new ReleaseFailed(message);
}

/** Runs a command with the terminal attached and stops the release when it fails. */
function run(command: string, args: ReadonlyArray<string>, cwd = root, env = process.env) {
  console.error(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0)
    fail(`${command} ${args[0] ?? ""} exited ${result.status ?? "on a signal"}`);
}

/** Runs a command quietly and returns its exit status and trimmed stdout. */
function read(command: string, args: ReadonlyArray<string>) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  return {
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function manifest(dir: (typeof PACKAGES)[number]) {
  const parsed = JSON.parse(
    readFileSync(join(root, "packages", dir, "package.json"), "utf8"),
  ) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("name" in parsed) ||
    !("version" in parsed) ||
    typeof parsed.name !== "string" ||
    typeof parsed.version !== "string"
  )
    fail(`packages/${dir}/package.json has no name or version`);
  const tarball = `dist/pack/${parsed.name.replace(/^@/, "").replace("/", "-")}-${parsed.version}.tgz`;
  return { dir, name: parsed.name, version: parsed.version, tarball };
}

const packages = PACKAGES.map(manifest);
const tag = `v${packages[1]?.version}`;

function preflight() {
  if (!dryRun && read("npm", ["whoami"]).status !== 0) fail("not logged in to npm; run npm login");
  if (read("git", ["status", "--porcelain"]).stdout !== "") fail("the working tree has changes");
  run("git", ["fetch", "--quiet", "origin", "main"]);
  if (
    read("git", ["rev-parse", "HEAD"]).stdout !== read("git", ["rev-parse", "origin/main"]).stdout
  )
    fail("HEAD is not origin/main; push the release commit first");
  if (read("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`]).status === 0)
    fail(`tag ${tag} already exists`);
}

function alreadyPublished(pkg: (typeof packages)[number], cwd: string) {
  const spec = `${pkg.name}@${pkg.version}`;
  const version = read("npm", ["view", spec, "version", "--prefer-online"]);
  if (version.status !== 0) {
    if (version.stderr.includes("E404")) return false;
    fail(`could not look up ${spec} on npm: ${version.stderr || "npm view failed"}`);
  }
  if (version.stdout !== pkg.version) fail(`npm returned an unexpected version for ${spec}`);
  const published = read("npm", ["view", spec, "dist.integrity", "--prefer-online"]);
  if (published.status !== 0 || !published.stdout.startsWith("sha512-"))
    fail(`could not read dist.integrity for ${spec}: ${published.stderr || "invalid response"}`);
  const bytes = readFileSync(join(cwd, pkg.tarball));
  const local = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (published.stdout !== local)
    fail(`${spec} is already on npm, but its tarball integrity differs`);
  return true;
}

function publish(checkout: string) {
  run("bun", ["install", "--frozen-lockfile"], checkout);
  const prepared = packages.map((pkg) => {
    const cwd = join(checkout, "packages", pkg.dir);
    run(
      "bun",
      ["run", "pack"],
      cwd,
      pkg.dir === "cli" ? { ...process.env, STACKS_PUBLISH_TELEMETRY: "1" } : process.env,
    );
    run("tar", ["-tzf", pkg.tarball], cwd);
    if (pkg.dir === "cli") console.error("release: telemetry endpoint embedded in CLI pack");
    return { pkg, cwd, skip: alreadyPublished(pkg, cwd) };
  });
  for (const { pkg, cwd, skip } of prepared) {
    if (skip) {
      console.error(
        `release: ${dryRun ? "would skip" : "skipping"} ${pkg.name}@${pkg.version} (matching integrity)`,
      );
      continue;
    }
    if (dryRun) console.error(`release: would publish ${pkg.name}@${pkg.version}`);
    else run("npm", ["publish", pkg.tarball, "--access", "public"], cwd);
  }
}

/** npm accepts a publish before the registry serves it ("may take a few minutes"), so poll. */
function awaitPublished(spec: string) {
  for (let attempt = 1; attempt <= 40; attempt++) {
    if (read("npm", ["view", spec, "version", "--prefer-online"]).stdout !== "") return;
    console.error(`release: waiting for the registry to serve ${spec}`);
    spawnSync("sleep", ["15"]);
  }
  fail(`the registry still doesn't serve ${spec} after 10 minutes; tag once npm view finds it`);
}

function release() {
  preflight();
  const checkout = join(mkdtempSync(join(tmpdir(), "stacks-release-")), "checkout");
  run("git", ["worktree", "add", "--detach", checkout, "origin/main"]);
  try {
    publish(checkout);
  } finally {
    run("git", ["worktree", "remove", "--force", checkout]);
  }
  if (dryRun) {
    const names = packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(" and ");
    console.error(`release: dry run packed ${names}; nothing published`);
    return;
  }
  for (const pkg of packages) awaitPublished(`${pkg.name}@${pkg.version}`);
  run("git", ["tag", "--annotate", tag, "--message", `Release ${tag}`, "origin/main"]);
  run("git", ["push", "origin", tag]);
}

try {
  release();
} catch (error) {
  if (!(error instanceof ReleaseFailed)) throw error;
  console.error(`release: ${error.message}`);
  process.exitCode = 1;
}
