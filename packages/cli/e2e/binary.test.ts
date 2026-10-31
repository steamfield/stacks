import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { version } from "../package.json";
import { cli } from "../src/cli";

import { binary, packageRoot, scratchPath } from "./package";

/** A copy of the binary in `<prefix>/bin/`, with `registry` (if given) copied to `<prefix>/registry`. */
function install(registry?: string): { bin: string; prefix: string } {
  const prefix = mkdtempSync(join(tmpdir(), "cli-binary-prefix-"));
  mkdirSync(join(prefix, "dist"));
  const bin = join(prefix, "dist", "stacks");
  copyFileSync(binary, bin);
  copyFileSync(join(packageRoot, "dist/cli.mjs"), join(prefix, "dist/cli.mjs"));
  chmodSync(bin, 0o755);
  if (registry) cpSync(registry, join(prefix, "registry"), { recursive: true });
  return { bin, prefix };
}
async function invoke(
  args: readonly string[],
  prepare?: (dir: string) => void,
  extra: Record<string, string> = {},
  executable = binary,
) {
  const dir = mkdtempSync(join(tmpdir(), "cli-binary-"));
  try {
    prepare?.(dir);
    const child = Bun.spawn([executable, ...args], {
      cwd: dir,
      env: {
        HOME: dir,
        XDG_CONFIG_HOME: join(dir, "config"),
        LOG_LEVEL: "none",
        NO_COLOR: "1",
        PATH: scratchPath,
        // The package names the hosted API; keep these runs off the network.
        ...(args[0] === "telemetry" && args[1] === "status" ? {} : { STACKS_OFFLINE: "1" }),
        ...extra,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe("installed Node package", () => {
  test("a local pack has no official telemetry endpoint", async () => {
    const result = await invoke(["telemetry", "status", "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).reason).toBe("no_endpoint");
    expect(result.stderr).toBe("");
  });
  test("reports bundled version and machine version", async () => {
    expect(await invoke(["--version"])).toEqual({ stdout: `${version}\n`, stderr: "", status: 0 });
    expect(JSON.parse((await invoke(["-v", "--json"])).stdout)).toEqual({ version });
  });
  test("doctor finds the installed registry and skill with no user configuration", async () => {
    const result = await invoke(["doctor", "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version,
      configErrors: [],
      registry: { path: `${packageRoot}/registry`, found: true },
      skill: { path: `${packageRoot}/skills/`, found: true },
    });
    expect(result.stderr).toBe("");
  });
  test("a symlinked binary finds the registry beside its real path", async () => {
    const prefix = mkdtempSync(join(tmpdir(), "cli-binary-link-"));
    try {
      const link = join(prefix, "stacks");
      symlinkSync(binary, link);
      const result = await invoke(["doctor", "--json"], undefined, {}, link);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).registry).toEqual({
        path: `${realpathSync(packageRoot)}/registry`,
        found: true,
      });
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });
  test("human doctor and help are readable", async () => {
    expect((await invoke(["doctor"])).stdout).toContain("Registry:");
    const help = await invoke(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("doctor");
    expect(help.stdout).not.toContain(String.fromCharCode(27));
  });
  test.each([
    { args: ["--unknown", "--json"] },
    { args: ["doctor", "extra", "--json"] },
    { args: ["--log-level", "--json"] },
  ])("usage errors honor streams: %j", async ({ args }) => {
    const result = await invoke(args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { tag: "Usage", retryable: false } });
  });
  test("invalid optional file is reported by doctor without failing", async () => {
    const result = await invoke(["doctor", "--json"], (dir) => {
      const config = join(dir, "config", "stacks");
      mkdirSync(config, { recursive: true });
      writeFileSync(join(config, "config.json"), "{invalid");
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).configErrors).toEqual(["Configuration is invalid."]);
  });
  test("list --json reads the registry STACKS_REGISTRY_DIR names", async () => {
    const registry = join(import.meta.dir, "../tests/fixtures/registry-real");
    const result = await invoke(["list", "--json"], undefined, {
      STACKS_REGISTRY_DIR: registry,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const listed = JSON.parse(result.stdout);
    expect(listed.rejected).toEqual([]);
    expect(listed.entries.map((row: { id: string }) => row.id)).toEqual([
      "typescript-cli",
      "effect",
      "effect-schema",
      "git-hooks",
      "openrouter-chat-cli",
    ]);
  });
  test("validate and validate --brief run from the binary over STACKS_REGISTRY_DIR", async () => {
    const registry = join(import.meta.dir, "../tests/fixtures/registry-real");
    const env = { STACKS_REGISTRY_DIR: registry };
    const result = await invoke(["validate", "--json"], undefined, env);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ root: registry, bundled: true });
    expect(report.findings.filter((f: { severity: string }) => f.severity === "error")).toEqual([]);
    const brief = await invoke(
      ["validate", "--brief", "typescript-cli", "--sandbox"],
      undefined,
      env,
    );
    expect(brief.status).toBe(0);
    expect(brief.stdout).toContain(`npx -y @steamfield/stacks@${version}`);
    // Size counts go to a human's stderr only (3.1a); a non-terminal gets the brief alone.
    expect(brief.stderr).toBe("");
    const sizes = await invoke(
      ["validate", "--brief", "typescript-cli", "--sandbox", "--json"],
      undefined,
      env,
    );
    expect(sizes.status).toBe(0);
    expect(JSON.parse(sizes.stdout)).toMatchObject({ limit: 6000 });
  });
  test("list with no registry suggests doctor", async () => {
    const { bin, prefix } = install();
    try {
      const result = await invoke(["list"], undefined, {}, bin);
      expect(result).toEqual({
        stdout: "No stacks or fragments found.\n\nNext: stacks doctor\n",
        stderr: "",
        status: 0,
      });
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });
  test("a relocated bundle reads its registry as trusted", async () => {
    const { bin, prefix } = install(join(import.meta.dir, "../tests/fixtures/registry-real"));
    try {
      const result = await invoke(["list", "--json"], undefined, {}, bin);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const listed = JSON.parse(result.stdout);
      expect(listed.rejected).toEqual([]);
      expect(listed.entries.length).toBeGreaterThan(0);
      for (const row of listed.entries) expect(row).toMatchObject({ trusted: true });
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });
  test("the packaging escape leaves an authored literal suffix unchanged", async () => {
    const { bin, prefix } = install(join(import.meta.dir, "../tests/fixtures/registry-new"));
    try {
      writeFileSync(
        join(prefix, "registry/stacks/fixture-stack/files/.gitignore.stacks"),
        "literal file\n",
      );
      const project = join(prefix, "project");
      const result = await invoke(
        ["new", "fixture-stack", project, "--sandbox", "--no-launch", "--json"],
        undefined,
        {},
        bin,
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(join(project, ".gitignore.stacks"), "utf8")).toBe("literal file\n");
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });
  test("the built binary lists the bundled catalog", async () => {
    const result = await invoke(["list", "stacks", "--json"]);
    expect(result.status).toBe(0);
    const ids = JSON.parse(result.stdout).entries.map((row: { id: string }) => row.id);
    expect(ids).toEqual(expect.arrayContaining(["astro-blog", "go-cli", "python-react"]));
  });
  test("new --sandbox --json writes the project, its brief and an executable hook", async () => {
    const out = mkdtempSync(join(tmpdir(), "cli-binary-new-"));
    try {
      const app = join(out, "app");
      const result = await invoke(["new", "fixture-stack", app, "--sandbox", "--json"], undefined, {
        STACKS_REGISTRY_DIR: join(import.meta.dir, "../tests/fixtures/registry-new"),
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const created = JSON.parse(result.stdout);
      expect(created).toMatchObject({ project: app, stack: "fixture-stack", preset: "sandbox" });
      expect(created.written).toContain(".stacks/BRIEF.md");
      for (const rel of created.written) expect(existsSync(join(app, rel))).toBe(true);
      expect(readFileSync(join(app, "README.md"), "utf8")).toStartWith("# app\n");
      expect(statSync(join(app, ".githooks/pre-commit")).mode & 0o111).not.toBe(0);
      expect(existsSync(join(app, "ran"))).toBe(false);
      expect(created.stateRecord).toBe(true);
      expect(created.written).toContain(".stacks/manifest.json");
      const manifest = Schema.decodeUnknownSync(Manifest)(
        JSON.parse(readFileSync(join(app, ".stacks/manifest.json"), "utf8")),
        { onExcessProperty: "error" },
      );
      expect(manifest).toMatchObject({ schemaVersion: 1, mode: "new", preset: "sandbox" });
      expect(manifest.briefWords).toBe(created.briefWords);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
  test("completion scripts name every listed subcommand", async () => {
    const names = cli.subcommands
      .flatMap((group) => group.commands)
      .filter((command) => !command.unlisted)
      .map((command) => command.name);
    expect(names.length).toBeGreaterThan(0);
    for (const shell of ["bash", "zsh", "fish"]) {
      const result = await invoke(["--completions", shell]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("stacks");
      for (const name of names) expect(result.stdout).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
  test("does not autoload dotenv or bunfig from working directory", async () => {
    const result = await invoke(["doctor", "--json"], (dir) => {
      writeFileSync(join(dir, ".env"), "STACKS_DATA_DIR=/should-not-load\n");
      writeFileSync(join(dir, "bunfig.toml"), 'preload = ["./poison.ts"]\n');
      writeFileSync(join(dir, "poison.ts"), 'throw new Error("unexpected preload")');
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).paths.data).not.toBe("/should-not-load");
  });
});
