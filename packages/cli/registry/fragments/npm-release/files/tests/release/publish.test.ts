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
    if [ -n "$FAKE_VIEW_FAIL" ]; then
      echo "{\\"error\\":{\\"code\\":\\"$FAKE_VIEW_FAIL\\"}}"
      echo "npm error code $FAKE_VIEW_FAIL" >&2
      echo "npm error registry unavailable" >&2
      exit 1
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
    if [ -z "$FAKE_UNCONFIRMED" ]; then printf '%s' "$FAKE_INTEGRITY" > "$FAKE_DIR/registry"; fi
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

  it("fails on a registry error that is not a 404 without publishing", () => {
    pack();
    const result = publish({ FAKE_VIEW_FAIL: "E500" });
    expect(result.status).toBe(1);
    expect(result.published).toEqual([]);
    expect(result.stderr).toContain("(E500)");
    expect(result.stderr).toContain("registry unavailable");
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
    ["E404", "published once by hand"],
    ["E403", "Trusted Publisher"],
    ["E422", "provenance"],
  ])("hints at %s", (code, text) => {
    pack();
    const result = publish({ FAKE_PUBLISH_FAIL: code });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`(${code})`);
    expect(result.stderr).toContain(text);
  });

  it("fails when npm accepts a publish the registry then does not show", () => {
    pack();
    const result = publish({ FAKE_UNCONFIRMED: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Could not confirm ${SPEC} on the registry`);
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

  it("runs the gate before it packs or publishes", () => {
    const order = ["bun run check", "scripts/publish.ts pack", "scripts/publish.ts publish"].map(
      (text) => workflow.indexOf(text),
    );
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
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
