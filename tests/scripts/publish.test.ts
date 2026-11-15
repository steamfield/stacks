import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "../..");
const workflow = readFileSync(join(repo, ".github/workflows/release.yml"), "utf8");
const bunDir = spawnSync("which", ["bun"], { encoding: "utf8" })
  .stdout.trim()
  .replace(/\/bun$/, "");

const PACKAGES = [
  { dir: "format", name: "@steamfield/stacks-format", version: "1.2.3" },
  { dir: "cli", name: "@steamfield/stacks", version: "4.5.6" },
  { dir: "mcp", name: "@steamfield/stacks-mcp", version: "7.8.9" },
] as const;
const filenameOf = (pkg: (typeof PACKAGES)[number]) =>
  `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
const specOf = (pkg: (typeof PACKAGES)[number]) => `${pkg.name}@${pkg.version}`;
const integrityOf = (bytes: string) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const bytesOf = (pkg: (typeof PACKAGES)[number]) => `${pkg.dir} tarball\n`;

/** The `run:` block of the workflow step with this name, folded the way YAML folds `>-`. */
function stepRun(name: string): string {
  const chunk = workflow.split("\n      - ").find((part) => part.includes(`name: ${name}\n`));
  if (chunk === undefined) throw new Error(`release.yml has no step named "${name}"`);
  const lines = chunk.split("\n");
  const start = lines.findIndex((line) => /^\s*run: [|>]/.test(line));
  const header = lines[start];
  if (header === undefined) throw new Error(`step "${name}" has no run block`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.trim());
  }
  return header.includes(">") ? body.join(" ").trim() : body.join("\n").trim();
}

// A fake npm over a directory registry. `view` reports 404 for an absent version; `publish` records
// the version, unless a failure code or "unconfirmed" is requested.
const fakeNpm = `#!/bin/sh
echo "npm $*" >> "$FAKE_DIR/commands.log"
key() { echo "$1" | tr '/@' '__'; }
case "$1" in
  view)
    if [ -n "$FAKE_VIEW_HANG" ]; then exec sleep 5; fi
    if [ -n "$FAKE_VIEW_TRANSIENT" ]; then
      n=$(cat "$FAKE_DIR/transient" 2>/dev/null || echo 0)
      if [ "$n" -lt "$FAKE_VIEW_TRANSIENT" ]; then
        echo $((n + 1)) > "$FAKE_DIR/transient"
        echo '{"error":{"code":"E503"}}'
        echo "npm error code E503" >&2
        exit 1
      fi
    fi
    if [ -n "$FAKE_VIEW_FAIL" ]; then
      echo "{\\"error\\":{\\"code\\":\\"$FAKE_VIEW_FAIL\\"}}"
      echo "npm error code $FAKE_VIEW_FAIL" >&2
      echo "npm error registry unavailable" >&2
      exit 1
    fi
    file="$FAKE_DIR/registry/$(key "$2")"
    pending="$FAKE_DIR/pending/$(key "$2")"
    if [ ! -f "$file" ] && [ -f "$pending" ]; then
      left=$(cat "$pending.lag")
      if [ "$left" -le 0 ]; then mv "$pending" "$file"; else echo $((left - 1)) > "$pending.lag"; fi
    fi
    if [ -f "$file" ]; then printf '"%s"\\n' "$(cat "$file")"; exit 0; fi
    echo '{"error":{"code":"E404"}}'
    echo "npm error code E404" >&2
    exit 1 ;;
  publish)
    spec=$(cat "$FAKE_DIR/specs/$(basename "$2")")
    if [ -n "$FAKE_PUBLISH_FAIL" ] && [ "$FAKE_PUBLISH_FAIL_ON" = "$spec" ]; then
      echo "npm error code $FAKE_PUBLISH_FAIL" >&2
      echo "npm error This command requires a one-time password (OTP)" >&2
      echo "npm error A complete log of this run can be found in: /x/y.log" >&2
      exit 1
    fi
    if [ "$FAKE_PUBLISH_CONFLICT" = "$spec" ]; then
      echo "npm error code E409" >&2
      echo "npm error Cannot publish over the previously published versions" >&2
      exit 1
    fi
    if [ "$FAKE_UNCONFIRMED" != 1 ] && [ "$FAKE_UNCONFIRMED" != "$spec" ]; then
      # FAKE_LAG is how many registry lookups answer 404 after the publish succeeds.
      cat "$FAKE_DIR/integrity/$(basename "$2")" > "$FAKE_DIR/pending/$(key "$spec")"
      echo "\${FAKE_LAG:-0}" > "$FAKE_DIR/pending/$(key "$spec").lag"
    fi
    exit 0 ;;
esac
exit 98
`;

let dir: string;
let work: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "publish-test-"));
  work = join(dir, "work");
  for (const sub of [
    "bin",
    "registry",
    "pending",
    "specs",
    "integrity",
    "work/scripts",
    "work/dist/release",
  ])
    mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, "bin/npm"), fakeNpm);
  chmodSync(join(dir, "bin/npm"), 0o755);
  copyFileSync(join(repo, "scripts/publish.ts"), join(work, "scripts/publish.ts"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A workspace with the three packages, their packed tarballs and a collected `dist/release`. */
function stageRelease(options: { formatOnly?: boolean } = {}) {
  const packed = options.formatOnly ? PACKAGES.slice(0, 1) : PACKAGES;
  for (const pkg of PACKAGES) {
    mkdirSync(join(work, "packages", pkg.dir, "dist/pack"), { recursive: true });
    writeFileSync(
      join(work, "packages", pkg.dir, "package.json"),
      JSON.stringify({ name: pkg.name, version: pkg.version }),
    );
    writeFileSync(join(work, "packages", pkg.dir, "dist/pack", filenameOf(pkg)), bytesOf(pkg));
    writeFileSync(join(dir, "specs", filenameOf(pkg)), specOf(pkg));
    writeFileSync(join(dir, "integrity", filenameOf(pkg)), integrityOf(bytesOf(pkg)));
  }
  const collect = spawnSync(
    "bun",
    [
      "scripts/publish.ts",
      "collect",
      "dist/release",
      ...(options.formatOnly ? ["--format-only"] : []),
    ],
    { cwd: work, encoding: "utf8", env: environment() },
  );
  return { collect, packed };
}

function environment(extra: Record<string, string> = {}) {
  return {
    HOME: dir,
    PATH: `${join(dir, "bin")}:${bunDir}:/usr/bin:/bin`,
    FAKE_DIR: dir,
    GITHUB_ACTIONS: "true",
    // No real waiting: poll up to five times with no delay.
    RELEASE_CONFIRM_DELAY_MS: "0",
    RELEASE_CONFIRM_INTERVAL_MS: "0",
    RELEASE_CONFIRM_ATTEMPTS: "5",
    RELEASE_RETRY_BASE_MS: "0",
    ...extra,
  };
}

/** Marks a version as already on the registry, with these bytes' integrity unless told otherwise. */
function onRegistry(pkg: (typeof PACKAGES)[number], integrity = integrityOf(bytesOf(pkg))) {
  writeFileSync(join(dir, "registry", specOf(pkg).replace(/[/@]/g, "_")), integrity);
}

/** An earlier run published this version, but the registry serves it only after some lookups. */
function onRegistryAfter(pkg: (typeof PACKAGES)[number], lookups: number) {
  const key = specOf(pkg).replace(/[/@]/g, "_");
  writeFileSync(join(dir, "pending", key), integrityOf(bytesOf(pkg)));
  writeFileSync(join(dir, "pending", `${key}.lag`), String(lookups));
}

/** Runs the workflow's own publish step, as the job would. */
function publish(extra: Record<string, string> = {}) {
  const result = spawnSync("sh", ["-ec", stepRun("Publish format, then CLI, then MCP")], {
    cwd: work,
    encoding: "utf8",
    env: environment(extra),
  });
  const log = join(dir, "commands.log");
  const commands = existsSync(log) ? readFileSync(log, "utf8") : "";
  return {
    ...result,
    commands,
    published: commands.split("\n").filter((l) => l.includes("npm publish")),
  };
}

const [format, cli, mcp] = PACKAGES;

describe("publish step", () => {
  it("publishes all three in order with provenance when none is on npm", () => {
    expect(stageRelease().collect.status).toBe(0);
    const result = publish();
    expect(result.status, result.stderr).toBe(0);
    expect(result.published).toHaveLength(3);
    PACKAGES.forEach((pkg, index) => {
      expect(result.published[index]).toContain(filenameOf(pkg));
      expect(result.published[index]).toContain("--provenance --access public");
    });
    expect(result.stdout).toContain(`Publishing ${specOf(format)}`);
  });

  it("skips what is already on npm with the same bytes and publishes the rest", () => {
    stageRelease();
    onRegistry(format);
    const result = publish();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Verified ${specOf(format)}; skipping publish.`);
    expect(result.published).toHaveLength(2);
    expect(result.published.join("\n")).not.toContain(filenameOf(format));
  });

  it("publishes nothing when every version is already on npm", () => {
    stageRelease();
    for (const pkg of PACKAGES) onRegistry(pkg);
    const result = publish();
    expect(result.status, result.stderr).toBe(0);
    expect(result.published).toEqual([]);
    expect(result.stdout.match(/Verified /g)).toHaveLength(3);
  });

  it("stops before publishing anything when a version is on npm with different bytes", () => {
    stageRelease();
    onRegistry(cli, "sha512-different");
    const result = publish();
    expect(result.status).toBe(1);
    expect(result.published).toEqual([]);
    expect(result.stderr).toContain(`${specOf(cli)} is already on npm with different contents`);
    expect(result.stderr).toContain("Never republish a version");
    expect(result.stderr).toContain("::error title=Release failed::");
  });

  it("retries a transient registry error, then gives up without publishing", () => {
    stageRelease();
    const result = publish({ FAKE_VIEW_FAIL: "E500" });
    expect(result.status).toBe(1);
    expect(result.published).toEqual([]);
    expect(result.stderr).toContain("npm view");
    expect(result.stderr).toContain("(E500)");
    expect(result.stderr).toContain("registry unavailable");
    expect(result.stderr).toContain("(gave up after 4 attempts)");
    expect(result.stdout.match(/retrying in/g)).toHaveLength(3);
    expect(result.stderr).toContain("On npm: none.");
  });

  it("retries a registry read that fails transiently and then succeeds", () => {
    stageRelease();
    const result = publish({ FAKE_VIEW_TRANSIENT: "2" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.match(/failed with E503; retrying/g)).toHaveLength(2);
    expect(result.published).toHaveLength(3);
  });

  it("never retries an auth error from the registry", () => {
    stageRelease();
    const result = publish({ FAKE_VIEW_FAIL: "E401" });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("retrying");
    expect(result.stderr).not.toContain("gave up");
    expect(result.stderr).toContain("(E401)");
  });

  it("never retries a failed publish", () => {
    stageRelease();
    const result = publish({ FAKE_PUBLISH_FAIL: "E503", FAKE_PUBLISH_FAIL_ON: specOf(format) });
    expect(result.status).toBe(1);
    expect(result.published).toHaveLength(1);
  });

  it("fails a hung registry call at its timeout instead of stalling", () => {
    stageRelease();
    const result = publish({
      FAKE_VIEW_HANG: "1",
      RELEASE_VIEW_TIMEOUT_MS: "1000",
      RELEASE_VIEW_ATTEMPTS: "1",
    });
    expect(result.status).toBe(1);
    expect(result.published).toEqual([]);
    expect(result.stderr).toContain("timed out after 1s");
    expect(result.stderr).toContain("rerun the failed job");
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it("warns, and passes, when the last package is accepted but not yet visible", () => {
    stageRelease();
    const result = publish({ FAKE_UNCONFIRMED: specOf(mcp) });
    expect(result.status, result.stderr).toBe(0);
    expect(result.published).toHaveLength(3);
    expect(result.stdout).toContain("::warning title=Release not yet visible on npm::");
    expect(result.stdout).toContain(`npm accepted ${specOf(mcp)}`);
    expect(result.stdout).toContain("npm view @steamfield/stacks-mcp version");
  });

  it("plain-prints that warning outside GitHub Actions", () => {
    stageRelease();
    const result = publish({ FAKE_UNCONFIRMED: specOf(mcp), GITHUB_ACTIONS: "" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`warning: npm accepted ${specOf(mcp)}`);
    expect(result.stdout).not.toContain("::warning");
  });

  it("still fails when a package another one depends on is not visible", () => {
    stageRelease();
    const result = publish({ FAKE_UNCONFIRMED: specOf(cli) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Could not confirm ${specOf(cli)} on the registry`);
    expect(result.published).toHaveLength(2);
  });

  it("explains a failed publish and lists what went out and what did not", () => {
    stageRelease();
    const result = publish({ FAKE_PUBLISH_FAIL: "EOTP", FAKE_PUBLISH_FAIL_ON: specOf(cli) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("(EOTP)");
    expect(result.stderr).toContain("This command requires a one-time password");
    expect(result.stderr).toContain("Hint: npm asked for a one-time password");
    expect(result.stderr).toContain(`On npm: ${specOf(format)}.`);
    expect(result.stderr).toContain("Published but not yet visible: none.");
    expect(result.stderr).toContain(`Not published: ${specOf(cli)}, ${specOf(mcp)}.`);
    expect(result.stderr).toContain("rerun the failed job");
    expect(result.stderr).not.toContain("A complete log");
    expect(result.stderr).not.toContain("node:internal");
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it("rerunning after a partial publish skips the published package", () => {
    stageRelease();
    publish({ FAKE_PUBLISH_FAIL: "EOTP", FAKE_PUBLISH_FAIL_ON: specOf(cli) });
    const rerun = publish();
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(rerun.stdout).toContain(`Verified ${specOf(format)}`);
    expect(rerun.stdout).toContain(`Publishing ${specOf(cli)}`);
  });

  it.each([
    ["E404", '"Allow npm publish" is ticked'],
    ["E403", "Trusted Publisher is missing or does not match"],
    ["E422", "provenance"],
  ])("hints at %s", (code, hint) => {
    stageRelease();
    const result = publish({ FAKE_PUBLISH_FAIL: code, FAKE_PUBLISH_FAIL_ON: specOf(format) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`(${code})`);
    expect(result.stderr).toContain(hint);
  });

  it("waits for the registry to serve each version before publishing the next", () => {
    stageRelease();
    const result = publish({ FAKE_LAG: "3" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.match(/Confirmed /g)).toHaveLength(3);
    // Each package is confirmed before the next publish starts.
    const lines = result.stdout.split("\n");
    const at = (text: string) => lines.indexOf(text);
    expect(at(`Confirmed ${specOf(format)}`)).toBeGreaterThan(-1);
    expect(at(`Confirmed ${specOf(format)}`)).toBeLessThan(at(`Publishing ${specOf(cli)}`));
    expect(at(`Confirmed ${specOf(cli)}`)).toBeGreaterThan(-1);
    expect(at(`Confirmed ${specOf(cli)}`)).toBeLessThan(at(`Publishing ${specOf(mcp)}`));
  });

  it("fails after the attempts when npm accepts a publish the registry never shows", () => {
    stageRelease();
    const result = publish({ FAKE_UNCONFIRMED: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Could not confirm ${specOf(format)} on the registry after`);
    expect(result.stderr).toContain(`Published but not yet visible: ${specOf(format)}.`);
    expect(result.stderr).toContain(`Not published: ${specOf(cli)}, ${specOf(mcp)}.`);
    expect(result.published).toHaveLength(1);
  });

  it("treats a publish conflict as published and waits for the registry", () => {
    stageRelease();
    onRegistryAfter(format, 2);
    const result = publish({ FAKE_PUBLISH_CONFLICT: specOf(format) });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `${specOf(format)} was already published; waiting for the registry.`,
    );
    expect(result.stdout).toContain(`Confirmed ${specOf(format)}`);
  });

  it("prints a plain message and no annotation outside GitHub Actions", () => {
    stageRelease();
    onRegistry(cli, "sha512-different");
    const result = publish({ GITHUB_ACTIONS: "" });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("::error");
    expect(result.stderr).toContain("publish: ");
  });

  it("refuses a release that lists the packages out of order", () => {
    stageRelease();
    const path = join(work, "dist/release/packages.json");
    const listed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(listed)) throw new Error("expected a list");
    writeFileSync(path, JSON.stringify([...listed].reverse()));
    const result = publish();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must list");
    expect(result.published).toEqual([]);
  });
});

describe("collect", () => {
  it("copies each tarball and records its integrity, in publish order", () => {
    const { collect } = stageRelease();
    expect(collect.status, collect.stderr).toBe(0);
    const listed: unknown = JSON.parse(
      readFileSync(join(work, "dist/release/packages.json"), "utf8"),
    );
    expect(listed).toEqual(
      PACKAGES.map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        filename: filenameOf(pkg),
        integrity: integrityOf(bytesOf(pkg)),
      })),
    );
    for (const pkg of PACKAGES)
      expect(existsSync(join(work, "dist/release", filenameOf(pkg)))).toBe(true);
  });

  it("collects only the format package with --format-only", () => {
    const { collect } = stageRelease({ formatOnly: true });
    expect(collect.status, collect.stderr).toBe(0);
    const listed: unknown = JSON.parse(
      readFileSync(join(work, "dist/release/packages.json"), "utf8"),
    );
    expect(Array.isArray(listed) && listed.length).toBe(1);
  });

  it("names the package to pack when its tarball is missing", () => {
    stageRelease();
    rmSync(join(work, "packages/cli/dist/pack", filenameOf(cli)));
    const result = spawnSync("bun", ["scripts/publish.ts", "collect", "out"], {
      cwd: work,
      encoding: "utf8",
      env: environment(),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("run `bun run pack` in packages/cli first");
  });

  it("prints the usage for an unknown command", () => {
    const result = spawnSync("bun", ["scripts/publish.ts", "ship"], {
      cwd: work,
      encoding: "utf8",
      env: environment(),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: bun scripts/publish.ts");
  });
});

describe("release workflow", () => {
  it("runs on v* tags and publishes through trusted publishing with no stored token", () => {
    expect(workflow).toMatch(/tags: \["v\*"\]/);
    expect(workflow).toMatch(/id-token: write/);
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
  });

  it("pins every action by commit SHA with its tag in a comment", () => {
    const uses = workflow.split("\n").filter((line) => /\buses: /.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/uses: [\w./-]+@[0-9a-f]{40} # v\d/);
  });

  /** The text of one top-level job, up to the next job. */
  function job(name: string): string {
    const start = workflow.indexOf(`\n  ${name}:\n`);
    if (start === -1) throw new Error(`release.yml has no job named ${name}`);
    const rest = workflow.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z]+:\n/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  }

  it("splits into verify, build and publish, and publishes only after both pass", () => {
    expect(job("verify")).toContain("bun run check");
    expect(job("build")).toContain("bun run pack");
    expect(job("build")).toContain("upload-artifact");
    expect(job("build")).not.toContain("bun run check");
    expect(job("publish")).toMatch(/needs: \[verify, build\]/);
    expect(job("publish")).toContain("download-artifact");
    expect(job("publish")).toContain("scripts/publish.ts publish");
    expect(job("verify")).not.toContain("publish.ts publish");
    expect(job("build")).not.toContain("publish.ts publish");
  });

  it("grants id-token only to the publish job", () => {
    const top = workflow.slice(0, workflow.indexOf("\njobs:"));
    expect(top).not.toContain("id-token");
    expect(job("verify")).not.toContain("id-token");
    expect(job("build")).not.toContain("id-token");
    expect(job("publish")).toContain("id-token: write");
    expect(job("publish")).not.toContain("upload-artifact");
  });

  it("runs one publish at a time and does not cancel one in flight", () => {
    expect(job("publish")).toContain("group: npm-publish");
    expect(job("publish")).toContain("cancel-in-progress: false");
  });

  describe("tag on main guard", () => {
    let repoDir: string;
    beforeEach(() => {
      repoDir = mkdtempSync(join(tmpdir(), "tag-main-"));
      const git = (...args: string[]) =>
        spawnSync("git", args, {
          cwd: repoDir,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "t",
            GIT_AUTHOR_EMAIL: "t@example.com",
            GIT_COMMITTER_NAME: "t",
            GIT_COMMITTER_EMAIL: "t@example.com",
          },
        });
      git("init", "-b", "main");
      git("commit", "--allow-empty", "-m", "on main");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      git("checkout", "-b", "side");
      git("commit", "--allow-empty", "-m", "off main");
    });
    afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

    const sha = (ref: string) =>
      spawnSync("git", ["rev-parse", ref], { cwd: repoDir, encoding: "utf8" }).stdout.trim();
    const runGuard = (commit: string) =>
      spawnSync("sh", ["-c", stepRun("Verify the tag is on main")], {
        cwd: repoDir,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", GITHUB_SHA: commit, GITHUB_REF_NAME: "v9.9.9" },
      });

    it("passes for a commit that is on main", () => {
      expect(runGuard(sha("main")).status).toBe(0);
    });

    it("fails a commit that is not on main, naming the fix", () => {
      const result = runGuard(sha("side"));
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("::error title=Tag is not on main::");
      expect(result.stdout).toContain("git push origin :refs/tags/v9.9.9");
    });
  });

  describe("version guard", () => {
    const guard = () => stepRun("Verify release version");
    const runGuard = (tag: string) =>
      spawnSync("sh", ["-c", guard()], {
        cwd: repo,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", TAG: tag },
      });

    it("passes when the tag is v plus the CLI version", () => {
      const version: unknown = JSON.parse(
        readFileSync(join(repo, "packages/cli/package.json"), "utf8"),
      );
      const current =
        typeof version === "object" && version !== null && "version" in version
          ? version.version
          : "";
      expect(runGuard(`v${String(current)}`).status).toBe(0);
    });

    it("fails with the fix and the command to delete the bad tag", () => {
      const result = runGuard("v0.0.1");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("::error title=Tag does not match the CLI version::");
      expect(result.stderr).toContain("bun run release X.Y.Z");
      expect(result.stderr).toContain("git push origin :refs/tags/v0.0.1");
    });
  });
});
