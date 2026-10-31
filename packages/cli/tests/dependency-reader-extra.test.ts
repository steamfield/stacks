import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { DependencyAllowlist } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { readDependencies } from "../src/core/deps";
import { tempDir } from "./helpers/cli";

const allowlist = Schema.decodeUnknownSync(DependencyAllowlist)({
  formatVersion: 1,
  generatedAt: "2026-10-28T00:00:00Z",
  names: {
    npm: ["react"],
    pypi: ["requests"],
    go: ["example.com/last", "example.com/lib", "example.com/other"],
    crates: ["serde"],
  },
});
const temps: ReturnType<typeof tempDir>[] = [];
function project() {
  const temp = tempDir();
  temps.push(temp);
  return realpathSync(temp.path);
}
function put(root: string, relative: string, contents: string) {
  const file = join(root, relative);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, contents);
}
function read(root: string) {
  return Effect.runPromise(
    readDependencies(root, allowlist).pipe(Effect.provide(NodeServices.layer)),
  );
}
afterEach(() => {
  for (const temp of temps.splice(0)) temp.cleanup();
});

test("Go v10 module suffix uses the required version", async () => {
  const root = project();
  put(root, "go.mod", "module example.com/app\nrequire example.com/lib/v10 v10.2.3\n");
  expect(await read(root)).toEqual([{ ecosystem: "go", name: "example.com/lib", major: "10" }]);
});

test("the bundled allowlist reports go-yaml by its module key", async () => {
  const root = project();
  put(root, "go.mod", "module example.com/app\nrequire go.yaml.in/yaml/v3 v3.0.4\n");
  const bundled = Schema.decodeUnknownSync(Schema.fromJsonString(DependencyAllowlist))(
    readFileSync(join(import.meta.dirname, "../registry/allowlist.json"), "utf8"),
  );
  expect(
    await Effect.runPromise(
      readDependencies(root, bundled).pipe(Effect.provide(NodeServices.layer)),
    ),
  ).toEqual([{ ecosystem: "go", name: "go.yaml.in/yaml", major: "3" }]);
});

test.each(["tool", "replace", "exclude", "retract", "godebug"])(
  "Go requirements survive a %s block between require directives",
  async (directive) => {
    const root = project();
    const bodies: Record<string, string> = {
      tool: "example.com/tool/one\nexample.com/tool/two",
      replace: "example.com/lib => ../lib\nexample.com/other => ../other",
      exclude: "example.com/excluded v1.0.0",
      retract: "[v1.0.0, v1.1.0]",
      godebug: "default=go1.24\npanicnil=1",
    };
    put(
      root,
      "go.mod",
      `module example.com/app
require (
  example.com/lib/v2 v2.3.1
)
${directive} (
${bodies[directive]}
)
require example.com/other v1.2.3
replace (
  example.com/lib/v2 => ../lib
)
require example.com/last v0.3.1
`,
    );
    expect(await read(root)).toEqual([
      { ecosystem: "go", name: "example.com/last", major: "0.3" },
      { ecosystem: "go", name: "example.com/lib", major: "2" },
      { ecosystem: "go", name: "example.com/other", major: "1" },
    ]);
  },
);

test.each(["tool (\nexample.com/tool/one\n", ")\n", "tool (\ntool (\n)\n)\n"])(
  "a malformed Go block skips all requirements: %s",
  async (block) => {
    const root = project();
    put(root, "go.mod", `module example.com/app\nrequire example.com/lib v2.3.1\n${block}`);
    expect(await read(root)).toEqual([]);
  },
);

test("two Go module suffixes with different majors report an unknown major", async () => {
  const root = project();
  put(
    root,
    "go.mod",
    "module example.com/app\nrequire (\n example.com/lib/v2 v2.3.1\n example.com/lib/v3 v3.1.0\n)\n",
  );
  expect(await read(root)).toEqual([{ ecosystem: "go", name: "example.com/lib", major: null }]);
});

test("an unterminated Go require block skips the whole file", async () => {
  const root = project();
  put(root, "go.mod", "module example.com/app\nrequire (\n example.com/lib v2.3.1\n");
  expect(await read(root)).toEqual([]);
});

test("an installed npm package symlink outside the project has no version", async () => {
  const root = project();
  const outside = project();
  put(root, "package.json", '{"dependencies":{"react":"^18"}}');
  put(outside, "package.json", '{"version":"18.3.1"}');
  mkdirSync(join(root, "node_modules/react"), { recursive: true });
  symlinkSync(join(outside, "package.json"), join(root, "node_modules/react/package.json"));
  expect(await read(root)).toEqual([{ ecosystem: "npm", name: "react", major: null }]);
});

test("an invalid uv lock falls back to Poetry and a renamed Cargo package uses its package name", async () => {
  const root = project();
  put(root, "pyproject.toml", '[project]\ndependencies = ["Requests>=2"]\n');
  put(root, "uv.lock", "[[package]\nname = 'requests'\n");
  put(root, "poetry.lock", '[[package]]\nname = "requests"\nversion = "2.32.1"\n');
  put(root, "Cargo.toml", '[dependencies]\nserde_alias = { package = "serde", version = "1" }\n');
  put(root, "Cargo.lock", '[[package]]\nname = "serde"\nversion = "1.0.210"\n');
  expect(await read(root)).toEqual([
    { ecosystem: "crates", name: "serde", major: "1" },
    { ecosystem: "pypi", name: "requests", major: "2" },
  ]);
});

test("PyPI prerelease versions retain their breaking 0.x minor", async () => {
  const root = project();
  put(root, "pyproject.toml", '[project]\ndependencies = ["requests"]\n');
  put(root, "uv.lock", '[[package]]\nname = "requests"\nversion = "0.7rc1"\n');
  expect(await read(root)).toEqual([{ ecosystem: "pypi", name: "requests", major: "0.7" }]);
});

test("ambiguous lock majors are null unless the root package identifies a version", async () => {
  const ambiguous = project();
  put(
    ambiguous,
    "Cargo.toml",
    '[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\nserde = "1"\n',
  );
  put(
    ambiguous,
    "Cargo.lock",
    '[[package]]\nname = "serde"\nversion = "1.0.0"\n[[package]]\nname = "serde"\nversion = "2.0.0"\n',
  );
  expect(await read(ambiguous)).toEqual([{ ecosystem: "crates", name: "serde", major: null }]);

  const resolved = project();
  put(
    resolved,
    "Cargo.toml",
    '[package]\nname = "app"\nversion = "0.1.0"\n[dependencies]\nserde = "1"\n',
  );
  put(
    resolved,
    "Cargo.lock",
    '[[package]]\nname = "app"\nversion = "0.1.0"\ndependencies = ["serde 1.0.0"]\n[[package]]\nname = "serde"\nversion = "1.0.0"\n[[package]]\nname = "serde"\nversion = "2.0.0"\n',
  );
  expect(await read(resolved)).toEqual([{ ecosystem: "crates", name: "serde", major: "1" }]);
});

test("the sorted report is capped at 100 names", async () => {
  const root = project();
  const packageNames = Array.from(
    { length: 101 },
    (_, index) => `pkg${String(index).padStart(3, "0")}`,
  );
  put(
    root,
    "package.json",
    JSON.stringify({ dependencies: Object.fromEntries(packageNames.map((name) => [name, "1"])) }),
  );
  const many = Schema.decodeUnknownSync(DependencyAllowlist)({
    formatVersion: 1,
    generatedAt: "2026-10-28T00:00:00Z",
    names: { npm: packageNames, pypi: [], go: [], crates: [] },
  });
  const result = await Effect.runPromise(
    readDependencies(root, many).pipe(Effect.provide(NodeServices.layer)),
  );
  expect(result).toHaveLength(100);
  expect(result.at(-1)).toEqual({ ecosystem: "npm", name: "pkg099", major: null });
});
