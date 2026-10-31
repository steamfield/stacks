import type { Dependency, DependencyAllowlist } from "@steamfield/stacks-format";
import { Effect, FileSystem, Path } from "effect";
import { readProjectFile } from "./deps/files";
import { json, major, names, object, packageMajors, toml } from "./deps/parse";

type Read = (relative: string) => Effect.Effect<string | null>;
const normalizePython = (name: string) => name.toLowerCase().replace(/[-_.]+/gu, "-");

function npmNames(manifest: Record<string, unknown>): ReadonlyArray<string> {
  return [...new Set([...names(manifest.dependencies), ...names(manifest.devDependencies)])].filter(
    (name) => /^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/u.test(name),
  );
}

function pythonNames(manifest: Record<string, unknown>): ReadonlyArray<string> {
  const result = new Set<string>();
  const project = object(manifest.project);
  if (Array.isArray(project?.dependencies)) {
    for (const requirement of project.dependencies) {
      if (typeof requirement !== "string") continue;
      const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/u.exec(requirement);
      if (match?.[1] !== undefined) result.add(normalizePython(match[1]));
    }
  }
  const poetry = object(object(object(manifest.tool)?.poetry)?.dependencies);
  if (poetry !== null) {
    for (const name of Object.keys(poetry)) {
      if (name !== "python") result.add(normalizePython(name));
    }
  }
  return [...result];
}

function cargoNames(manifest: Record<string, unknown>): ReadonlyArray<string> {
  const result = new Set<string>();
  for (const section of [manifest.dependencies, manifest["dev-dependencies"]]) {
    const entries = object(section);
    if (entries === null) continue;
    for (const [key, value] of Object.entries(entries)) {
      const alias = object(value);
      result.add(typeof alias?.package === "string" ? alias.package : key);
    }
  }
  return [...result];
}

export function goAllowlistKey(name: string): string {
  return name.replace(/\/v(?:[2-9]|[1-9][0-9]+)$/u, "");
}

function goEntry(text: string): { name: string; version: string } | null {
  const fields = text.trim().split(/\s+/u);
  if (fields.length !== 2 || fields[0] === undefined || fields[1] === undefined) return null;
  return { name: goAllowlistKey(fields[0]), version: fields[1] };
}

type GoBlock = "require" | "skip" | null;
type GoLine =
  | { kind: "skip" | "close" | "error" }
  | { kind: "open"; block: Exclude<GoBlock, null> }
  | { kind: "entry"; value: { name: string; version: string } };

function parseGoLine(line: string, block: GoBlock): GoLine {
  if (line === "") return { kind: "skip" };
  const open = /^(require|tool|replace|exclude|retract|godebug)\s+\($/u.exec(line);
  if (open)
    return block === null
      ? { kind: "open", block: open[1] === "require" ? "require" : "skip" }
      : { kind: "error" };
  if (line === ")") return { kind: block === null ? "error" : "close" };
  if (block === "skip") return { kind: "skip" };
  if (block === null && !line.startsWith("require ")) return { kind: "skip" };
  const entry = goEntry(block === "require" ? line : line.slice(8));
  return entry === null ? { kind: "error" } : { kind: "entry", value: entry };
}

function goDependencies(text: string): ReadonlyArray<{ name: string; version: string }> | null {
  const result: Array<{ name: string; version: string }> = [];
  let block: GoBlock = null;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/\/\/.*$/u, "").trim();
    const parsed = parseGoLine(line, block);
    if (parsed.kind === "error") return null;
    if (parsed.kind === "open") {
      block = parsed.block;
      continue;
    }
    if (parsed.kind === "close") {
      block = null;
      continue;
    }
    if (parsed.kind === "entry") result.push(parsed.value);
  }
  return block === null ? result : null;
}

const readNpm = Effect.fn("deps.readNpm")(function* (read: Read, allowlist: DependencyAllowlist) {
  const text = yield* read("package.json");
  const manifest = text === null ? null : json(text);
  if (manifest === null) return [];
  const allowed = new Set(allowlist.names.npm);
  const result: Dependency[] = [];
  const selected = npmNames(manifest)
    .filter((name) => allowed.has(name))
    .sort()
    .slice(0, 100);
  for (const name of selected) {
    const installed = yield* read(`node_modules/${name}/package.json`);
    result.push({
      ecosystem: "npm",
      name,
      major: major(installed === null ? null : json(installed)?.version),
    });
  }
  return result;
});

const readPython = Effect.fn("deps.readPython")(function* (
  read: Read,
  allowlist: DependencyAllowlist,
) {
  const text = yield* read("pyproject.toml");
  const manifest = text === null ? null : toml(text);
  if (manifest === null) return [];
  const allowed = new Set(allowlist.names.pypi);
  const selected = pythonNames(manifest).filter((name) => allowed.has(name));
  if (selected.length === 0) return [];
  const uv = yield* read("uv.lock");
  let lock = uv === null ? null : toml(uv);
  if (lock === null) {
    const poetry = yield* read("poetry.lock");
    lock = poetry === null ? null : toml(poetry);
  }
  const rootName = object(manifest.project)?.name ?? object(object(manifest.tool)?.poetry)?.name;
  const majors = packageMajors(
    lock?.package,
    normalizePython,
    typeof rootName === "string" ? rootName : undefined,
  );
  return selected.map(
    (name): Dependency => ({ ecosystem: "pypi", name, major: majors.get(name) ?? null }),
  );
});

const readGo = Effect.fn("deps.readGo")(function* (read: Read, allowlist: DependencyAllowlist) {
  const text = yield* read("go.mod");
  if (text === null) return [];
  const allowed = new Set(allowlist.names.go);
  const dependencies = goDependencies(text);
  if (dependencies === null) return [];
  return dependencies
    .filter(({ name }) => allowed.has(name))
    .map(({ name, version }): Dependency => ({ ecosystem: "go", name, major: major(version) }));
});

const readCargo = Effect.fn("deps.readCargo")(function* (
  read: Read,
  allowlist: DependencyAllowlist,
) {
  const text = yield* read("Cargo.toml");
  const manifest = text === null ? null : toml(text);
  if (manifest === null) return [];
  const allowed = new Set(allowlist.names.crates);
  const selected = cargoNames(manifest).filter((name) => allowed.has(name));
  if (selected.length === 0) return [];
  const lockText = yield* read("Cargo.lock");
  const rootName = object(manifest.package)?.name;
  const majors = packageMajors(
    lockText === null ? null : toml(lockText)?.package,
    (name) => name,
    typeof rootName === "string" ? rootName : undefined,
  );
  return selected.map(
    (name): Dependency => ({ ecosystem: "crates", name, major: majors.get(name) ?? null }),
  );
});

function sortDependencies(deps: ReadonlyArray<Dependency>): ReadonlyArray<Dependency> {
  const unique = new Map<string, Dependency>();
  for (const dep of deps) {
    const key = `${dep.ecosystem}\u0000${dep.name}`;
    const previous = unique.get(key);
    if (previous === undefined) unique.set(key, dep);
    else if (previous.major !== dep.major) unique.set(key, { ...dep, major: null });
  }
  return [...unique.values()]
    .sort((a, b) => {
      const left = `${a.ecosystem}\u0000${a.name}`;
      const right = `${b.ecosystem}\u0000${b.name}`;
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    })
    .slice(0, 100);
}

/** Read root manifest names and installed majors without running project code. */
export const readDependencies = Effect.fn("deps.readDependencies")(function* (
  root: string,
  allowlist: DependencyAllowlist,
): Effect.fn.Return<ReadonlyArray<Dependency>, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realRoot = yield* fs.realPath(root).pipe(Effect.orElseSucceed(() => null));
  if (realRoot === null) return [];
  const read: Read = (relative) => readProjectFile(fs, path, realRoot, relative);
  return sortDependencies([
    ...(yield* readNpm(read, allowlist)),
    ...(yield* readPython(read, allowlist)),
    ...(yield* readGo(read, allowlist)),
    ...(yield* readCargo(read, allowlist)),
  ]);
});
