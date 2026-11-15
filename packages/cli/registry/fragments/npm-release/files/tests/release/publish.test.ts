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

// These tests run the release workflow's own steps against a fake `npm`, so a renamed step or a
// changed `run:` block fails here instead of on the first release. Keep the step names stable.
const repo = join(import.meta.dirname, "../..");
const workflow = readFileSync(join(repo, ".github/workflows/release.yml"), "utf8");
const bunDir = spawnSync("which", ["bun"], { encoding: "utf8" })
  .stdout.trim()
  .replace(/\/bun$/, "");

const PACKAGE = { name: "example-package", version: "1.2.3" };
const SPEC = `${PACKAGE.name}@${PACKAGE.version}`;
const FILENAME = `${PACKAGE.name}-${PACKAGE.version}.tgz`;
const BYTES = "tarball\n";
const INTEGRITY = `sha512-${createHash("sha512").update(BYTES).digest("base64")}`;

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

// A fake npm over a one-file registry. `view` reports a 404 for an absent version; `publish` records
// the version unless a failure code or "unconfirmed" is requested.
const fakeNpm = `#!/bin/sh
echo "npm $*" >> "$FAKE_DIR/commands.log"
case "$1" in
  pack)
    for dest; do :; done
    printf '%s' "$FAKE_BYTES" > "$dest/$FAKE_FILENAME"
    printf '[{"name":"%s","version":"%s","filename":"%s","integrity":"%s"}]' \\
      "$FAKE_NAME" "$FAKE_VERSION" "$FAKE_FILENAME" "$FAKE_INTEGRITY"
    exit 0 ;;
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
    if [ ! -f "$FAKE_DIR/registry" ] && [ -f "$FAKE_DIR/pending" ]; then
      left=$(cat "$FAKE_DIR/pending.lag")
      if [ "$left" -le 0 ]; then mv "$FAKE_DIR/pending" "$FAKE_DIR/registry"; else echo $((left - 1)) > "$FAKE_DIR/pending.lag"; fi
    fi
    if [ -f "$FAKE_DIR/registry" ]; then printf '"%s"\\n' "$(cat "$FAKE_DIR/registry")"; exit 0; fi
    echo '{"error":{"code":"E404"}}'
    echo "npm error code E404" >&2
    exit 1 ;;
  publish)
    if [ -n "$FAKE_PUBLISH_FAIL" ]; then
      echo "npm error code $FAKE_PUBLISH_FAIL" >&2
      echo "npm error This command requires a one-time password (OTP)" >&2
      echo "npm error A complete log of this run can be found in: /x/y.log" >&2
      exit 1
    fi
    if [ -n "$FAKE_PUBLISH_CONFLICT" ]; then
      echo "npm error code E409" >&2
      echo "npm error Cannot publish over the previously published versions" >&2
      exit 1
    fi
    # FAKE_LAG is how many registry lookups answer 404 after the publish succeeds.
    if [ -z "$FAKE_UNCONFIRMED" ]; then
      printf '%s' "$FAKE_INTEGRITY" > "$FAKE_DIR/pending"
      echo "\${FAKE_LAG:-0}" > "$FAKE_DIR/pending.lag"
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
  for (const sub of ["bin", "work/scripts", "work/dist/release"])
    mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, "bin/npm"), fakeNpm);
  chmodSync(join(dir, "bin/npm"), 0o755);
  copyFileSync(join(repo, "scripts/publish.ts"), join(work, "scripts/publish.ts"));
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({
      ...PACKAGE,
      scripts: { prepack: "echo building" },
      repository: { type: "git", url: "git+https://github.com/example/example-package.git" },
    }),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function environment(extra: Record<string, string> = {}) {
  return {
    HOME: dir,
    PATH: `${join(dir, "bin")}:${bunDir}:/usr/bin:/bin`,
    FAKE_DIR: dir,
    FAKE_NAME: PACKAGE.name,
    FAKE_VERSION: PACKAGE.version,
    FAKE_FILENAME: FILENAME,
    FAKE_BYTES: BYTES,
    FAKE_INTEGRITY: INTEGRITY,
    GITHUB_ACTIONS: "true",
    // No real waiting: poll up to five times with no delay.
    RELEASE_CONFIRM_DELAY_MS: "0",
    RELEASE_CONFIRM_INTERVAL_MS: "0",
    RELEASE_CONFIRM_ATTEMPTS: "5",
    RELEASE_RETRY_BASE_MS: "0",
    ...extra,
  };
}

function script(...args: string[]) {
  return spawnSync("bun", ["scripts/publish.ts", ...args], {
    cwd: work,
    encoding: "utf8",
    env: environment(),
  });
}

/** Packs into dist/release the way the workflow's pack step does. */
function pack() {
  const result = script("pack", "dist/release");
  expect(result.status, result.stderr).toBe(0);
}

/** Runs the workflow's own publish step, as the job would; `published` lists this run's publishes. */
function publish(extra: Record<string, string> = {}) {
  const log = join(dir, "commands.log");
  rmSync(log, { force: true });
  const result = spawnSync("sh", ["-ec", stepRun("Publish to npm")], {
    cwd: work,
    encoding: "utf8",
    env: environment(extra),
  });
  const commands = existsSync(log) ? readFileSync(log, "utf8") : "";
  return { ...result, published: commands.split("\n").filter((l) => l.includes("npm publish")) };
}

const onRegistry = (integrity = INTEGRITY) => writeFileSync(join(dir, "registry"), integrity);

describe("pack", () => {
  it("records the tarball's name, version, filename and integrity", () => {
    pack();
    const record: unknown = JSON.parse(
      readFileSync(join(work, "dist/release/release.json"), "utf8"),
    );
    expect(record).toEqual({ ...PACKAGE, filename: FILENAME, integrity: INTEGRITY });
  });

  it("stops before packing when the project's prepack fails", () => {
    writeFileSync(
      join(work, "package.json"),
      JSON.stringify({ ...PACKAGE, scripts: { prepack: "exit 3" } }),
    );
    const result = script("pack", "dist/release");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("`bun run prepack` failed");
    expect(existsSync(join(work, "dist/release/release.json"))).toBe(false);
  });

  it("says to pack first when publish finds no record", () => {
    const result = script("publish", "dist/nowhere");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("release.json is missing: run `bun scripts/publish.ts pack");
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it("prints the usage for an unknown command", () => {
    const result = script("ship");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: bun scripts/publish.ts");
  });
});

describe("publish step", () => {
  it("publishes with provenance when the version is not on npm, then confirms it", () => {
    pack();
    const result = publish();
    expect(result.status, result.stderr).toBe(0);
    expect(result.published).toHaveLength(1);
    expect(result.published[0]).toContain("--provenance --access public");
    expect(result.stdout).toContain(`Publishing ${SPEC}`);
  });

  it("skips a version already on npm with the same bytes", () => {
    pack();
    onRegistry();
    const result = publish();
    expect(result.status, result.stderr).toBe(0);
    expect(result.published).toEqual([]);
    expect(result.stdout).toContain(`Verified ${SPEC}; skipping publish.`);
  });

  it("stops when the version is on npm with different bytes", () => {
    pack();
    onRegistry("sha512-different");
    const result = publish();
    expect(result.status).toBe(1);
    expect(result.published).toEqual([]);
    expect(result.stderr).toContain("already on npm with different contents");
    expect(result.stderr).toContain("Never republish a version");
    expect(result.stderr).toContain("::error title=Release failed::");
  });

  it("waits for the registry to serve the version before it succeeds", () => {
    pack();
    const result = publish({ FAKE_LAG: "3" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Waiting for the registry to show ${SPEC}`);
    expect(result.stdout).toContain(`Confirmed ${SPEC}`);
  });

  it("treats a publish conflict as published and waits for the registry", () => {
    pack();
    writeFileSync(join(dir, "pending"), INTEGRITY);
    writeFileSync(join(dir, "pending.lag"), "2");
    const result = publish({ FAKE_PUBLISH_CONFLICT: "1" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`${SPEC} was already published; waiting for the registry.`);
    expect(result.stdout).toContain(`Confirmed ${SPEC}`);
  });

  it("warns, and passes, when npm accepts a publish the registry never shows", () => {
    pack();
    const result = publish({ FAKE_UNCONFIRMED: "1" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.published).toHaveLength(1);
    expect(result.stdout).toContain("::warning title=Release not yet visible on npm::");
    expect(result.stdout).toContain(`npm accepted ${SPEC}`);
    expect(result.stdout).toContain(`npm view ${PACKAGE.name} version`);
  });

  it("plain-prints that warning outside GitHub Actions", () => {
    pack();
    const result = publish({ FAKE_UNCONFIRMED: "1", GITHUB_ACTIONS: "" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`warning: npm accepted ${SPEC}`);
    expect(result.stdout).not.toContain("::warning");
  });

  it("retries a transient registry error, then gives up without publishing", () => {
    pack();
    const result = publish({ FAKE_VIEW_FAIL: "E500" });
    expect(result.status).toBe(1);
    expect(result.published).toEqual([]);
    expect(result.stderr).toContain("(E500)");
    expect(result.stderr).toContain("registry unavailable");
    expect(result.stderr).toContain("(gave up after 4 attempts)");
    expect(result.stdout.match(/retrying in/g)).toHaveLength(3);
  });

  it("retries a registry read that fails transiently and then succeeds", () => {
    pack();
    const result = publish({ FAKE_VIEW_TRANSIENT: "2" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.match(/failed with E503; retrying/g)).toHaveLength(2);
    expect(result.published).toHaveLength(1);
  });

  it("never retries an auth error from the registry", () => {
    pack();
    const result = publish({ FAKE_VIEW_FAIL: "E401" });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("retrying");
    expect(result.stderr).not.toContain("gave up");
    expect(result.stderr).toContain("(E401)");
  });

  it("never retries a failed publish", () => {
    pack();
    const result = publish({ FAKE_PUBLISH_FAIL: "E503" });
    expect(result.status).toBe(1);
    expect(result.published).toHaveLength(1);
  });

  it("fails a hung registry call at its timeout instead of stalling", () => {
    pack();
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

  it("explains a failed publish in plain lines, with a hint and no stack trace", () => {
    pack();
    const result = publish({ FAKE_PUBLISH_FAIL: "EOTP" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("npm publish failed (EOTP)");
    expect(result.stderr).toContain("This command requires a one-time password");
    expect(result.stderr).toContain("Hint: npm asked for a one-time password");
    expect(result.stderr).toContain("example/example-package, release.yml");
    expect(result.stderr).toContain("rerun the failed job");
    expect(result.stderr).not.toContain("A complete log");
    expect(result.stderr).not.toContain("node:internal");
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it.each([
    ["E404", '"Allow npm publish" is ticked'],
    ["E403", "Trusted Publisher"],
    ["E422", "provenance"],
  ])("hints at %s", (code, text) => {
    pack();
    const result = publish({ FAKE_PUBLISH_FAIL: code });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`(${code})`);
    expect(result.stderr).toContain(text);
  });

  it("rerunning after a failed publish publishes the same tarball", () => {
    pack();
    expect(publish({ FAKE_PUBLISH_FAIL: "EOTP" }).status).toBe(1);
    const rerun = publish();
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(rerun.published).toHaveLength(1);
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
    expect(job("build")).toContain("scripts/publish.ts pack");
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
    const runGuard = (tag: string) =>
      spawnSync("sh", ["-c", stepRun("Verify release version")], {
        cwd: repo,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", TAG: tag },
      });

    it("passes when the tag is v plus the package version", () => {
      const manifest: unknown = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
      const current =
        typeof manifest === "object" && manifest !== null && "version" in manifest
          ? String(manifest.version)
          : "";
      expect(runGuard(`v${current}`).status).toBe(0);
    });

    it("fails with the fix and the command to delete the bad tag", () => {
      const result = runGuard("v0.0.0-wrong");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("::error title=Tag does not match package.json::");
      expect(result.stderr).toContain("bun run release X.Y.Z");
      expect(result.stderr).toContain("git push origin :refs/tags/v0.0.0-wrong");
    });
  });
});
