/**
 * Reports allowlisted dependencies and their major versions from bounded project file reads (trust
 * point 1). The allowlist keeps private package names out of reports.
 */
import type { Dependency, DependencyAllowlist } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import { readProjectFile } from "./files";
import { json, major, names, object, packageMajors, toml } from "./parse";

/** Reads a project file by root-relative path; `null` when it is absent or refused. */
type Read = (relative: string) => Effect.Effect<string | null>;
type GoDependency = { name: string; version: string };

/** The most dependencies one report carries, per ecosystem read and in total. */
const MAX_DEPENDENCIES = 100;
/** A plain or scoped npm package name; anything else (a URL, a path) is left out. */
const NPM_NAME = /^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/u;
/** The distribution name at the start of a PEP 508 requirement such as `requests>=2`. */
const PYTHON_REQUIREMENT_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/u;
/** A `go.mod` directive that opens a parenthesized block. */
const GO_BLOCK_OPEN = /^(require|tool|replace|exclude|retract|godebug)\s+\($/u;
const GO_REQUIRE = "require ";

/** PEP 503 normalization: `Typing_Extensions` and `typing.extensions` are one package. */
const normalizePython = (name: string) => name.toLowerCase().replace(/[-_.]+/gu, "-");

const asString = (value: unknown) => (typeof value === "string" ? value : undefined);

/** A project file parsed with `parse`, or `null` when it is absent or doesn't parse. */
const readParsed = (
  read: Read,
  relative: string,
  parse: (text: string) => Record<string, unknown> | null,
) => read(relative).pipe(Effect.map((text) => (text === null ? null : parse(text))));

function npmNames(manifest: Record<string, unknown>): ReadonlyArray<string> {
  const declared = new Set([...names(manifest.dependencies), ...names(manifest.devDependencies)]);
  return [...declared].filter((name) => NPM_NAME.test(name));
}

function projectRequirementNames(manifest: Record<string, unknown>): ReadonlyArray<string> {
  const requirements = object(manifest.project)?.dependencies;
  if (!Array.isArray(requirements)) return [];
  const found: string[] = [];
  for (const requirement of requirements) {
    if (typeof requirement !== "string") continue;
    const name = PYTHON_REQUIREMENT_NAME.exec(requirement)?.[1];
    if (name !== undefined) found.push(name);
  }
  return found;
}

function poetryNames(manifest: Record<string, unknown>): ReadonlyArray<string> {
  const poetry = object(object(object(manifest.tool)?.poetry)?.dependencies);
  // Poetry lists the Python version itself as a dependency named `python`.
  return poetry === null ? [] : Object.keys(poetry).filter((name) => name !== "python");
}

/** `[project].dependencies` then `[tool.poetry.dependencies]`, normalized and deduplicated. */
function pythonNames(manifest: Record<string, unknown>): ReadonlyArray<string> {
  const all = [...projectRequirementNames(manifest), ...poetryNames(manifest)];
  return [...new Set(all.map(normalizePython))];
}

/** Crate names from `[dependencies]` and `[dev-dependencies]`, following `package =` renames. */
function cargoNames(manifest: Record<string, unknown>): ReadonlyArray<string> {
  const found = new Set<string>();
  for (const section of [manifest.dependencies, manifest["dev-dependencies"]]) {
    const entries = object(section);
    if (entries === null) continue;
    for (const [key, value] of Object.entries(entries)) {
      found.add(asString(object(value)?.package) ?? key);
    }
  }
  return [...found];
}

/**
 * A Go module path as the allowlist lists it, without a major-version suffix:
 * `github.com/a/b/v2` becomes `github.com/a/b`.
 */
export function goAllowlistKey(name: string): string {
  return name.replace(/\/v(?:[2-9]|[1-9][0-9]+)$/u, "");
}

/** `<module> <version>`, or `null` for any other shape. */
function goEntry(text: string): GoDependency | null {
  const fields = text.trim().split(/\s+/u);
  if (fields.length !== 2 || fields[0] === undefined || fields[1] === undefined) return null;
  return { name: goAllowlistKey(fields[0]), version: fields[1] };
}

/** The `go.mod` block a line is in: `require (...)`, another block, or none. */
type GoBlock = "require" | "skip" | null;
type GoLine =
  | { kind: "skip" | "close" | "error" }
  | { kind: "open"; block: Exclude<GoBlock, null> }
  | { kind: "entry"; value: GoDependency };

/** Classifies one comment-stripped `go.mod` line, given the block it sits in. */
function parseGoLine(line: string, block: GoBlock): GoLine {
  if (line === "") return { kind: "skip" };
  const open = GO_BLOCK_OPEN.exec(line);
  if (open) {
    if (block !== null) return { kind: "error" };
    return { kind: "open", block: open[1] === "require" ? "require" : "skip" };
  }
  if (line === ")") return { kind: block === null ? "error" : "close" };
  if (block === "skip") return { kind: "skip" };
  if (block === null && !line.startsWith(GO_REQUIRE)) return { kind: "skip" };
  const entry = goEntry(block === "require" ? line : line.slice(GO_REQUIRE.length));
  return entry === null ? { kind: "error" } : { kind: "entry", value: entry };
}

/**
 * Every `require` of a `go.mod`, from single lines and `require (...)` blocks. A file this
 * reader doesn't understand (a nested or unclosed block, a malformed require) gives `null`, so a
 * misread never reports a wrong dependency.
 */
function goDependencies(text: string): ReadonlyArray<GoDependency> | null {
  const found: GoDependency[] = [];
  let block: GoBlock = null;
  for (const raw of text.split(/\r?\n/u)) {
    const parsed = parseGoLine(raw.replace(/\/\/.*$/u, "").trim(), block);
    if (parsed.kind === "error") return null;
    if (parsed.kind === "open") block = parsed.block;
    if (parsed.kind === "close") block = null;
    if (parsed.kind === "entry") found.push(parsed.value);
  }
  return block === null ? found : null;
}

/** An npm dependency with the major of the copy installed under `node_modules`, if any. */
const installedNpm = (read: Read, name: string) =>
  readParsed(read, `node_modules/${name}/package.json`, json).pipe(
    Effect.map((installed): Dependency => {
      return { ecosystem: "npm", name, major: major(installed?.version) };
    }),
  );

const readNpm = Effect.fn("deps.readNpm")(function* (read: Read, allowlist: DependencyAllowlist) {
  const manifest = yield* readParsed(read, "package.json", json);
  if (manifest === null) return [];
  const allowed = new Set(allowlist.names.npm);
  const selected = npmNames(manifest)
    .filter((name) => allowed.has(name))
    .sort()
    .slice(0, MAX_DEPENDENCIES);
  return yield* Effect.forEach(selected, (name) => installedNpm(read, name));
});

/** `uv.lock`, or `poetry.lock` when there is no readable `uv.lock`. */
const readPythonLock = (read: Read) =>
  Effect.gen(function* () {
    const uv = yield* readParsed(read, "uv.lock", toml);
    return uv ?? (yield* readParsed(read, "poetry.lock", toml));
  });

const readPython = Effect.fn("deps.readPython")(function* (
  read: Read,
  allowlist: DependencyAllowlist,
) {
  const manifest = yield* readParsed(read, "pyproject.toml", toml);
  if (manifest === null) return [];
  const allowed = new Set(allowlist.names.pypi);
  const selected = pythonNames(manifest).filter((name) => allowed.has(name));
  if (selected.length === 0) return [];
  const lock = yield* readPythonLock(read);
  const rootName = object(manifest.project)?.name ?? object(object(manifest.tool)?.poetry)?.name;
  const majors = packageMajors(lock?.package, normalizePython, asString(rootName));
  return selected.map(
    (name): Dependency => ({ ecosystem: "pypi", name, major: majors.get(name) ?? null }),
  );
});

const readGo = Effect.fn("deps.readGo")(function* (read: Read, allowlist: DependencyAllowlist) {
  const text = yield* read("go.mod");
  if (text === null) return [];
  const dependencies = goDependencies(text);
  if (dependencies === null) return [];
  const allowed = new Set(allowlist.names.go);
  return dependencies
    .filter(({ name }) => allowed.has(name))
    .map(({ name, version }): Dependency => ({ ecosystem: "go", name, major: major(version) }));
});

const readCargo = Effect.fn("deps.readCargo")(function* (
  read: Read,
  allowlist: DependencyAllowlist,
) {
  const manifest = yield* readParsed(read, "Cargo.toml", toml);
  if (manifest === null) return [];
  const allowed = new Set(allowlist.names.crates);
  const selected = cargoNames(manifest).filter((name) => allowed.has(name));
  if (selected.length === 0) return [];
  const lock = yield* readParsed(read, "Cargo.lock", toml);
  const rootName = asString(object(manifest.package)?.name);
  const majors = packageMajors(lock?.package, (name) => name, rootName);
  return selected.map(
    (name): Dependency => ({ ecosystem: "crates", name, major: majors.get(name) ?? null }),
  );
});

const dependencyKey = (dep: Dependency) => `${dep.ecosystem}\u0000${dep.name}`;

/** One entry per ecosystem and name; two disagreeing majors make the major unknown. */
function mergeDuplicates(deps: ReadonlyArray<Dependency>): Array<Dependency> {
  const unique = new Map<string, Dependency>();
  for (const dep of deps) {
    const key = dependencyKey(dep);
    const previous = unique.get(key);
    if (previous === undefined) unique.set(key, dep);
    else if (previous.major !== dep.major) unique.set(key, { ...dep, major: null });
  }
  return [...unique.values()];
}

function byEcosystemThenName(a: Dependency, b: Dependency): number {
  const left = dependencyKey(a);
  const right = dependencyKey(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export const readDependencies = Effect.fn("deps.readDependencies")(function* (
  root: string,
  allowlist: DependencyAllowlist,
): Effect.fn.Return<ReadonlyArray<Dependency>, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realRoot = yield* fs.realPath(root).pipe(Effect.orElseSucceed(() => null));
  if (realRoot === null) return [];
  // Bound and contain project reads. Missing, unreadable or malformed inputs contribute no facts.
  const read: Read = (relative) => readProjectFile(fs, path, realRoot, relative);
  const found = [
    ...(yield* readNpm(read, allowlist)),
    ...(yield* readPython(read, allowlist)),
    ...(yield* readGo(read, allowlist)),
    ...(yield* readCargo(read, allowlist)),
  ];
  // Sort before capping so the same dependencies survive regardless of manifest order.
  return mergeDuplicates(found).sort(byEcosystemThenName).slice(0, MAX_DEPENDENCIES);
});
