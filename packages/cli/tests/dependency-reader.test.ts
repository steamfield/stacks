import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { type Dependency, DependencyAllowlist } from "@steamfield/stacks-format";
import { Effect, Layer, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { Processes } from "../src/services/processes";
import { tempDir } from "./helpers/cli";

const decodeAllowlist = Schema.decodeUnknownSync(DependencyAllowlist, {
  onExcessProperty: "error",
});
const allowlist = decodeAllowlist({
  formatVersion: 1,
  generatedAt: "2026-10-28T00:00:00Z",
  names: {
    npm: ["@scope/tool", "react", "vite"],
    pypi: ["django", "requests", "typing-extensions"],
    go: ["github.com/a/b", "golang.org/x/text"],
    crates: ["rand", "serde", "tokio"],
  },
});
const readerModule = join(import.meta.dirname, "../src/core/deps/index.ts");
const temps: ReturnType<typeof tempDir>[] = [];
function project() {
  const temp = tempDir();
  temps.push(temp);
  return realpathSync(temp.path);
}
function put(root: string, path: string, text: string) {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
}
async function read(root: string, processes?: Layer.Layer<Processes>) {
  const { readDependencies } = await import(readerModule);
  const layer = processes ? Layer.merge(NodeServices.layer, processes) : NodeServices.layer;
  const deps: ReadonlyArray<Dependency> = await Effect.runPromise(
    readDependencies(root, allowlist).pipe(Effect.provide(layer)),
  );
  return deps;
}
afterEach(() => {
  for (const temp of temps.splice(0)) temp.cleanup();
});

test("root npm dependencies use installed majors, including 0.x and missing installs [4.2d#1]", async () => {
  const root = project();
  put(
    root,
    "package.json",
    JSON.stringify({
      dependencies: { react: "^18", "@scope/tool": "^0.7", private: "1.0.0" },
      devDependencies: { vite: "^5" },
    }),
  );
  put(root, "node_modules/react/package.json", '{"version":"18.3.1"}');
  put(root, "node_modules/@scope/tool/package.json", '{"version":"0.7.9"}');
  put(root, "node_modules/private/package.json", '{"version":"1.0.0"}');
  expect(await read(root)).toEqual([
    { ecosystem: "npm", name: "@scope/tool", major: "0.7" },
    { ecosystem: "npm", name: "react", major: "18" },
    { ecosystem: "npm", name: "vite", major: null },
  ]);
});

test("uv and Cargo lockfiles supply only root dependencies [4.2d#1]", async () => {
  const python = project();
  put(
    python,
    "pyproject.toml",
    '[project]\nname = "sample"\ndependencies = ["Requests>=2", "private-lib>=1"]\n',
  );
  put(
    python,
    "uv.lock",
    'version = 1\n[[package]]\nname = "requests"\nversion = "2.32.1"\n[[package]]\nname = "django"\nversion = "5.1.2"\n[[package]]\nname = "private-lib"\nversion = "1.0.0"\n',
  );
  expect(await read(python)).toEqual([{ ecosystem: "pypi", name: "requests", major: "2" }]);
  const rust = project();
  put(
    rust,
    "Cargo.toml",
    '[package]\nname = "sample"\nversion = "0.1.0"\n[dependencies]\nserde = "1"\n[dev-dependencies]\ntokio = "0.4"\nprivate = "1"\n',
  );
  put(
    rust,
    "Cargo.lock",
    'version = 3\n[[package]]\nname = "serde"\nversion = "1.0.210"\n[[package]]\nname = "tokio"\nversion = "0.4.2"\n[[package]]\nname = "rand"\nversion = "0.8.5"\n[[package]]\nname = "private"\nversion = "1.0.0"\n',
  );
  expect(await read(rust)).toEqual([
    { ecosystem: "crates", name: "serde", major: "1" },
    { ecosystem: "crates", name: "tokio", major: "0.4" },
  ]);
});

test("go major uses the required version after stripping a module suffix [4.2d#2]", async () => {
  const root = project();
  put(
    root,
    "go.mod",
    "module example.com/app\n\nrequire (\n github.com/a/b/v2 v2.3.1\n golang.org/x/text v0.21.0\n private.example/module v9.1.0\n)\n",
  );
  expect(await read(root)).toEqual([
    { ecosystem: "go", name: "github.com/a/b", major: "2" },
    { ecosystem: "go", name: "golang.org/x/text", major: "0.21" },
  ]);
});

test("Poetry names are normalized and resolved from poetry.lock [4.2d#2]", async () => {
  const root = project();
  put(
    root,
    "pyproject.toml",
    '[tool.poetry.dependencies]\npython = "^3.12"\nDjango = "^5"\nrequests = { version = "^2" }\nTyping_Extensions = "^4"\n',
  );
  put(
    root,
    "poetry.lock",
    '[[package]]\nname = "django"\nversion = "5.1.2"\n\n[[package]]\nname = "requests"\nversion = "2.32.1"\n\n[[package]]\nname = "typing-extensions"\nversion = "4.12.2"\n',
  );
  expect(await read(root)).toEqual([
    { ecosystem: "pypi", name: "django", major: "5" },
    { ecosystem: "pypi", name: "requests", major: "2" },
    { ecosystem: "pypi", name: "typing-extensions", major: "4" },
  ]);
});

it.effect.prop(
  "unlisted npm names never appear in a serialized dependency report [4.2d#1]",
  [Schema.String.check(Schema.isPattern(/^unlisted[a-z]{3,8}$/u))],
  ([name]) =>
    Effect.gen(function* () {
      const root = project();
      put(root, "package.json", JSON.stringify({ dependencies: { [name]: "1.0.0" } }));
      put(root, `node_modules/${name}/package.json`, '{"version":"1.2.3"}');
      const deps = yield* Effect.promise(() => read(root));
      expect(JSON.stringify(deps)).not.toContain(`"name":"${name}"`);
    }),
  { arbitrary: { seed: "dependency-privacy", runs: 30 } },
);

test("an outside symlink and an oversized lockfile are skipped [4.2d#5]", async () => {
  const root = project();
  const outside = project();
  put(outside, "package.json", '{"dependencies":{"react":"18"}}');
  put(outside, "node_modules/react/package.json", '{"version":"18.2.0"}');
  symlinkSync(join(outside, "package.json"), join(root, "package.json"));
  expect(await read(root)).toEqual([]);
  const python = project();
  put(python, "pyproject.toml", '[project]\ndependencies = ["requests"]\n');
  put(
    python,
    "uv.lock",
    `[[package]]\nname = "requests"\nversion = "2.32.1"\n${"# padding\n".repeat(400_000)}`,
  );
  expect(await read(python)).toEqual([{ ecosystem: "pypi", name: "requests", major: null }]);
});

test("the reader makes zero Processes calls [4.2d#6]", async () => {
  const root = project();
  put(root, "package.json", '{"dependencies":{"react":"18"}}');
  put(root, "node_modules/react/package.json", '{"version":"18.2.0"}');
  const calls: string[] = [];
  const forbidden = (name: string) => {
    calls.push(name);
    return Effect.die(new Error(`unexpected ${name}`));
  };
  const processes = Layer.succeed(Processes, {
    run: () => forbidden("run"),
    start: () => forbidden("start"),
    exec: () => forbidden("exec"),
    interactive: () => forbidden("interactive"),
    which: () => forbidden("which"),
  });
  expect(await read(root, processes)).toEqual([{ ecosystem: "npm", name: "react", major: "18" }]);
  expect(calls).toEqual([]);
});

test("a directory named package.json is skipped", async () => {
  const root = project();
  mkdirSync(join(root, "package.json"));
  expect(await read(root)).toEqual([]);
});

test("CRLF and a BOM in a lockfile do not lose installed versions", async () => {
  const root = project();
  put(root, "pyproject.toml", '[project]\ndependencies = ["requests"]\n');
  put(root, "uv.lock", '\uFEFF[[package]]\r\nname = "requests"\r\nversion = "2.32.1"\r\n');
  expect(await read(root)).toEqual([{ ecosystem: "pypi", name: "requests", major: "2" }]);
});

test("nested workspace manifests are not read", async () => {
  const root = project();
  put(root, "package.json", '{"workspaces":["packages/*"],"dependencies":{"react":"18"}}');
  put(root, "node_modules/react/package.json", '{"version":"18.2.0"}');
  put(root, "packages/child/package.json", '{"dependencies":{"vite":"5"}}');
  put(root, "packages/child/node_modules/vite/package.json", '{"version":"5.4.0"}');
  expect(await read(root)).toEqual([{ ecosystem: "npm", name: "react", major: "18" }]);
});

test("go replace directives do not turn replacement modules into dependencies", async () => {
  const root = project();
  put(
    root,
    "go.mod",
    "module example.com/app\nrequire github.com/a/b/v2 v2.3.1\nreplace github.com/a/b/v2 => golang.org/x/text v0.21.0\n",
  );
  expect(await read(root)).toEqual([{ ecosystem: "go", name: "github.com/a/b", major: "2" }]);
});
