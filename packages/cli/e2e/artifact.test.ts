import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import metadata from "../package.json";
import { CreateResult } from "../src/schemas/create";
import { NewResult } from "../src/schemas/new";
import { binary, node, npmCli, packageRoot, scratchPath, tarball } from "./package";

const source = join(import.meta.dirname, "..");
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
function files(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true }).flatMap((entry) =>
    entry.isFile() ? [join(entry.parentPath, entry.name).slice(root.length + 1)] : [],
  );
}
function run(argv: string[], cwd: string) {
  const result = Bun.spawnSync(argv, {
    cwd,
    env: {
      HOME: cwd,
      XDG_CONFIG_HOME: join(cwd, "config"),
      XDG_STATE_HOME: join(cwd, "state"),
      PATH: scratchPath,
      LOG_LEVEL: "none",
      NO_COLOR: "1",
      npm_config_cache: join(cwd, "cache"),
    },
  });
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

test("the tarball contains exactly the allowlisted files, preserving every asset byte and its digest", () => {
  const assets = ["registry", "skills"].flatMap((dir) =>
    files(join(source, dir)).map((file) => `${dir}/${file}`),
  );
  const packedPath = (file: string) => (file.endsWith("/.gitignore") ? `${file}.stacks` : file);
  const expected = [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/stacks",
    "dist/cli.mjs",
    "docs/authoring.md",
    ...assets,
  ].sort();
  const actual = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((file) => !file.endsWith("/"))
    .map((file) => file.replace(/^package\//, ""))
    .sort();
  expect(actual).toEqual(expected.map(packedPath).sort());
  for (const file of [...assets, "LICENSE", "docs/authoring.md", "dist/stacks", "dist/cli.mjs"])
    expect(digest(join(packageRoot, packedPath(file)))).toBe(digest(join(source, file)));
  expect(digest(join(source, "LICENSE"))).toBe(digest(join(source, "../../LICENSE")));
  const packed = readFileSync(join(packageRoot, "package.json"), "utf8");
  expect(packed).not.toMatch(/(?:catalog|workspace):/);
  expect(JSON.parse(packed)).toMatchObject({
    name: "@steamfield/stacks",
    version: "0.6.0",
    bin: metadata.bin,
    files: metadata.files,
    engines: { node: ">=22" },
    os: ["darwin", "linux"],
    license: "Apache-2.0",
    publishConfig: { access: "public" },
  });
  expect(JSON.parse(packed).dependencies).toBeUndefined();
  expect(readFileSync(`${tarball}.sha256`, "utf8")).toBe(
    `${digest(tarball)}  steamfield-stacks-${metadata.version}.tgz\n`,
  );
});

test("the installed bundle retains the complete dependency license notices", () => {
  const bundle = readFileSync(join(packageRoot, "dist/cli.mjs"), "utf8");
  const platform = realpathSync(join(source, "node_modules/@effect/platform-node"));
  for (const name of [
    "effect",
    "@effect/platform-node",
    "@effect/platform-node-shared",
    "ws",
    "yaml",
    "smol-toml",
  ]) {
    const packageJson = Bun.resolveSync(`${name}/package.json`, platform);
    expect(
      bundle.includes(readFileSync(join(packageJson, "../LICENSE"), "utf8")),
      `${name} license`,
    ).toBe(true);
  }
});

test("runtime guards refuse Bun and old Node before loading the bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "stacks-runtime-"));
  try {
    expect(run([process.execPath, binary, "--version"], root)).toEqual({
      status: 1,
      stdout: "",
      stderr:
        "stacks runs on Node 22 or newer, not Bun. Run stacks directly, or npx -y @steamfield/stacks.\n",
    });
    const preload = join(root, "floor.mjs");
    writeFileSync(
      preload,
      'Object.defineProperty(process, "versions", { value: { node: "20.0.0" } });\n',
    );
    expect(run([node, "--import", preload, binary, "--version"], root)).toEqual({
      status: 1,
      stdout: "",
      stderr: "stacks needs Node 22 or newer.\n",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unusable e2e Node override fails naming STACKS_E2E_NODE", () => {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dirname, "package.ts")], {
    env: { PATH: scratchPath, STACKS_E2E_NODE: "/missing-stacks-e2e-node" },
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).toContain(
    "\nerror: Set STACKS_E2E_NODE to a Node 22 or newer binary.\n",
  );
});

test("the e2e Node override also controls shebangs when its filename is node22", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "stacks-node-override-")));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const selected = join(bin, "node22");
    copyFileSync(node, selected, constants.COPYFILE_FICLONE);
    // Homebrew's executable loads libnode relative to its bin directory.
    const library = join(dirname(node), "../lib");
    if (existsSync(library)) symlinkSync(library, join(root, "lib"), "dir");
    const version = Bun.spawnSync([selected, "--version"]);
    expect(version.exitCode, version.stderr.toString()).toBe(0);
    symlinkSync(npmCli, join(bin, "npm"));
    const script = `const p = await import(process.argv[1]);
      const r = Bun.spawnSync([p.binary, "doctor", "--json"], { env: { HOME: process.argv[2], PATH: p.scratchPath } });
      process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.exitCode);`;
    const result = Bun.spawnSync(
      [process.execPath, "-e", script, join(import.meta.dirname, "package.ts"), root],
      {
        env: { PATH: `${bin}:/usr/bin:/bin`, STACKS_E2E_NODE: selected },
      },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(JSON.parse(result.stdout.toString()).executable).toBe(selected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test("the installed catalog scaffolds a project and create finds the shipped authoring guide", () => {
  const root = mkdtempSync(join(tmpdir(), "stacks-installed-"));
  try {
    const project = join(root, "demo");
    const created = run(
      [binary, "new", "typescript-cli", project, "--sandbox", "--no-launch", "--json"],
      root,
    );
    expect(created.status).toBe(0);
    expect(created.stderr).toBe("");
    const report = Schema.decodeUnknownSync(NewResult)(JSON.parse(created.stdout));
    expect(report.project).toBe(project);
    expect(readFileSync(join(project, ".stacks/BRIEF.md"), "utf8")).toContain("# Build");
    expect(existsSync(join(project, ".gitignore"))).toBe(true);
    const skeleton = run([binary, "create", "stack", "my-stack", "--json"], root);
    expect(skeleton.status).toBe(0);
    expect(skeleton.stderr).toBe("");
    const guide = Schema.decodeUnknownSync(CreateResult)(JSON.parse(skeleton.stdout));
    expect(guide.guide).toBe(join(packageRoot, "docs/authoring.md"));
    expect(existsSync(guide.guide)).toBe(true);
    const copied = run(
      [binary, "create", "fragment", "agent-ops", "--from", "bundled", "--json"],
      root,
    );
    expect(copied.status).toBe(0);
    expect(copied.stderr).toBe("");
    const copy = Schema.decodeUnknownSync(CreateResult)(JSON.parse(copied.stdout));
    expect(readFileSync(join(copy.path, "adapters/claude/.claude/.gitignore"))).toEqual(
      readFileSync(join(source, "registry/fragments/agent-ops/adapters/claude/.claude/.gitignore")),
    );
    expect(files(copy.path).some((file) => file.endsWith(".stacks"))).toBe(false);
    const blog = run(
      [binary, "new", "astro-blog", join(root, "blog"), "--sandbox", "--no-launch", "--json"],
      root,
    );
    expect(blog.status).toBe(0);
    expect(blog.stderr).toBe("");
    expect(readFileSync(join(root, "blog/.gitignore"))).toEqual(
      readFileSync(join(source, "registry/stacks/astro-blog/files/.gitignore")),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hostile cwd files change nothing for the installed bin or bunx with Node on PATH", () => {
  const root = mkdtempSync(join(tmpdir(), "stacks-bunx-"));
  try {
    const install = run(
      [
        node,
        npmCli,
        "install",
        "--prefix",
        root,
        tarball,
        "--offline",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
      ],
      root,
    );
    expect(install.status).toBe(0);
    for (const argv of [[binary], [process.execPath, "x", "--no-install", "stacks"]]) {
      const clean = run([...argv, "doctor", "--json"], root);
      expect(clean.status).toBe(0);
      expect(clean.stderr).toBe("");
      writeFileSync(join(root, ".env"), "STACKS_DATA_DIR=/should-not-load\nLOG_LEVEL=trace\n");
      writeFileSync(join(root, "bunfig.toml"), 'preload = ["./poison.ts"]\n');
      writeFileSync(join(root, "poison.ts"), 'throw new Error("unexpected preload")');
      expect(run([...argv, "doctor", "--json"], root)).toEqual(clean);
      rmSync(join(root, ".env"));
      rmSync(join(root, "bunfig.toml"));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
