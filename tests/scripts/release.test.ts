import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import cliPackage from "../../packages/cli/package.json";
import formatPackage from "../../packages/format/package.json";

const script = join(import.meta.dirname, "../../scripts/release.ts");
const bun = spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim();
const formatBytes = "format tarball\n";
const integrity = `sha512-${createHash("sha512").update(formatBytes).digest("base64")}`;
const formatSpec = `${formatPackage.name}@${formatPackage.version}`;
const cliSpec = `${cliPackage.name}@${cliPackage.version}`;
const fake = `#!/bin/sh
echo "$(basename "$0") $*" >> "$FAKE_LOG"
case "$(basename "$0")" in
  git)
    case "$1 $2" in
      "status --porcelain") exit 0 ;;
      "fetch --quiet") exit 0 ;;
      "rev-parse HEAD"|"rev-parse origin/main") echo same; exit 0 ;;
      "rev-parse --quiet") exit 1 ;;
      "worktree add") mkdir -p "$4/packages/format" "$4/packages/cli"; exit 0 ;;
      "worktree remove") exit 0 ;;
    esac ;;
  bun)
    if [ "$1 $2" = "run pack" ]; then
      echo "pack telemetry: $STACKS_PUBLISH_TELEMETRY" >> "$FAKE_LOG"
      mkdir -p dist/pack
      case "$PWD" in
        */format) printf 'format tarball\\n' > dist/pack/steamfield-stacks-format-${formatPackage.version}.tgz ;;
        */cli) printf 'cli tarball\\n' > dist/pack/steamfield-stacks-${cliPackage.version}.tgz ;;
      esac
    fi
    exit 0 ;;
  tar) exit 0 ;;
  npm)
    if [ "$1" = "whoami" ]; then echo maintainer; exit 0; fi
    if [ "$1" = "publish" ]; then exit 99; fi
    if [ "$1 $3" = "view version" ]; then
      if [ "$FAKE_VERSION_LOOKUP_FAIL" = 1 ]; then echo 'registry unavailable' >&2; exit 1; fi
      case "$2" in
        ${formatSpec}) if [ "$FAKE_FORMAT_PUBLISHED" = 1 ]; then echo ${formatPackage.version}; exit 0; fi ;;
        ${cliSpec}) if [ "$FAKE_CLI_PUBLISHED" = 1 ]; then echo ${cliPackage.version}; exit 0; fi ;;
      esac
      echo 'npm error code E404' >&2; exit 1
    fi
    if [ "$1 $3" = "view dist.integrity" ]; then
      if [ "$FAKE_LOOKUP_FAIL" = 1 ]; then echo 'lookup failed' >&2; exit 1; fi
      echo "$FAKE_INTEGRITY"; exit 0
    fi ;;
esac
exit 98
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "release-test-"));
  const executable = join(dir, "fake");
  writeFileSync(executable, fake);
  chmodSync(executable, 0o755);
  for (const name of ["git", "bun", "npm", "tar"]) symlinkSync(executable, join(dir, name));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(
  options: {
    publishedIntegrity?: string;
    lookupFails?: boolean;
    versionLookupFails?: boolean;
    formatPublished?: boolean;
    cliPublished?: boolean;
    dryRun?: boolean;
  } = {},
) {
  const log = join(dir, "commands.log");
  const result = spawnSync(bun, [script, ...(options.dryRun === false ? [] : ["--dry-run"])], {
    encoding: "utf8",
    env: {
      HOME: dir,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      FAKE_LOG: log,
      FAKE_INTEGRITY: options.publishedIntegrity ?? integrity,
      FAKE_LOOKUP_FAIL: options.lookupFails ? "1" : "0",
      FAKE_VERSION_LOOKUP_FAIL: options.versionLookupFails ? "1" : "0",
      FAKE_FORMAT_PUBLISHED: options.formatPublished === false ? "0" : "1",
      FAKE_CLI_PUBLISHED: options.cliPublished ? "1" : "0",
    },
  });
  return { ...result, commands: readFileSync(log, "utf8") };
}

describe("release dry run", () => {
  it("skips a published package with matching integrity and shows the embedded endpoint", () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(`would skip ${formatSpec}`);
    expect(result.stderr).toContain(`would publish ${cliSpec}`);
    expect(result.stderr).toContain("telemetry endpoint embedded");
    expect(result.commands).toContain(`npm view ${formatSpec} dist.integrity`);
    expect(result.commands).toContain("pack telemetry: 1");
    expect(result.commands).not.toContain("npm publish");
  });

  it("fails when a published package has different integrity", () => {
    const result = run({ publishedIntegrity: "sha512-different" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(formatSpec);
    expect(result.stderr).toContain("integrity differs");
    expect(result.commands).not.toContain("npm publish");
  });

  it("fails when a published package's integrity lookup fails", () => {
    const result = run({ lookupFails: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(formatSpec);
    expect(result.stderr).toContain("could not read dist.integrity");
    expect(result.commands).not.toContain("npm publish");
  });

  it("fails when npm cannot determine whether the version exists", () => {
    const result = run({ versionLookupFails: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`could not look up ${formatSpec}`);
    expect(result.commands).not.toContain("npm publish");
  });

  it("checks a conflicting CLI version before publishing a new format version", () => {
    const result = run({
      dryRun: false,
      formatPublished: false,
      cliPublished: true,
      publishedIntegrity: "sha512-different",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `${cliSpec} is already on npm, but its tarball integrity differs`,
    );
    expect(result.commands).not.toContain("npm publish");
  });
});
