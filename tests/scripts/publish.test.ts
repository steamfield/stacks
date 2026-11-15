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
    if [ -n "$FAKE_VIEW_FAIL" ]; then
      echo "{\\"error\\":{\\"code\\":\\"$FAKE_VIEW_FAIL\\"}}"
      echo "npm error code $FAKE_VIEW_FAIL" >&2
      echo "npm error registry unavailable" >&2
      exit 1
    fi
    file="$FAKE_DIR/registry/$(key "$2")"
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
    if [ -z "$FAKE_UNCONFIRMED" ]; then
      cat "$FAKE_DIR/integrity/$(basename "$2")" > "$FAKE_DIR/registry/$(key "$spec")"
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
  for (const sub of ["bin", "registry", "specs", "integrity", "work/scripts", "work/dist/release"])
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
    ...extra,
  };
}

/** Marks a version as already on the registry, with these bytes' integrity unless told otherwise. */
function onRegistry(pkg: (typeof PACKAGES)[number], integrity = integrityOf(bytesOf(pkg))) {
  writeFileSync(join(dir, "registry", specOf(pkg).replace(/[/@]/g, "_")), integrity);
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

  it("fails on a registry error that is not a 404 without publishing", () => {
    stageRelease();
    const result = publish({ FAKE_VIEW_FAIL: "E500" });
    expect(result.status).toBe(1);
    expect(result.published).toEqual([]);
    expect(result.stderr).toContain("npm view");
    expect(result.stderr).toContain("(E500)");
    expect(result.stderr).toContain("registry unavailable");
    expect(result.stderr).toContain("Published or verified: nothing.");
  });

  it("explains a failed publish and lists what went out and what did not", () => {
    stageRelease();
    const result = publish({ FAKE_PUBLISH_FAIL: "EOTP", FAKE_PUBLISH_FAIL_ON: specOf(cli) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("(EOTP)");
    expect(result.stderr).toContain("This command requires a one-time password");
    expect(result.stderr).toContain("Hint: npm asked for a one-time password");
    expect(result.stderr).toContain(`Published or verified: ${specOf(format)}.`);
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
    ["E404", "published once by hand"],
    ["E403", "Trusted Publisher is missing or does not match"],
    ["E422", "provenance"],
  ])("hints at %s", (code, hint) => {
    stageRelease();
    const result = publish({ FAKE_PUBLISH_FAIL: code, FAKE_PUBLISH_FAIL_ON: specOf(format) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`(${code})`);
    expect(result.stderr).toContain(hint);
  });

  it("fails when npm accepts a publish the registry then does not show", () => {
    stageRelease();
    const result = publish({ FAKE_UNCONFIRMED: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Could not confirm ${specOf(format)} on the registry`);
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

  it("runs the gate before it packs or publishes", () => {
    const order = ["bun run check", "bun run pack", "bun scripts/publish.ts publish"].map((text) =>
      workflow.indexOf(text),
    );
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
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
