import { createHash } from "node:crypto";
import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { normalize, relative, resolve, sep } from "node:path";

// The ignore policy lives here, not in the target's .gitignore: the target may
// not be a git repository at all (a freshly built project, a temp directory, an
// unpacked tarball), nested repositories each carry their own ignore rules, and
// the digest has to be identical on any machine. A closed, documented list is
// the only way to keep that contract. Honouring a target's own .gitignore when
// one exists would be a later feature, not a silent fallback.
export const EXCLUDED_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "vendor",
  "target",
  ".ruff_cache",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".eslintcache",
  ".semgrep",
  ".gradle",
  ".next",
  ".turbo",
  ".cache",
]);

export type DigestResult = {
  readonly digest: string;
  readonly files: number;
  readonly bytes: number;
  readonly excluded: readonly string[];
  readonly skippedSymlinks: number;
};

export type DigestOptions = {
  readonly excludeGlobs: readonly string[];
  readonly outputFile?: string;
};

export function matchGlob(pattern: string, posixPath: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(posixPath);
}

function globToRegex(pattern: string): RegExp {
  let src = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === undefined) break;
    if (ch === "*") {
      const next = pattern[i + 1];
      if (next === "*") {
        src += ".*";
        i += 2;
        if (pattern[i] === "/") i += 1;
        continue;
      }
      src += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      src += "[^/]";
      i += 1;
      continue;
    }
    if ("\\^$.+()|{}[]".includes(ch)) {
      src += `\\${ch}`;
    } else {
      src += ch;
    }
    i += 1;
  }
  return new RegExp(`^${src}$`);
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

type FileEntry = { readonly rel: string; readonly bytes: Buffer };

type WalkState = {
  readonly options: DigestOptions;
  readonly acc: FileEntry[];
  skippedSymlinks: number;
};

function walk(dir: string, root: string, state: WalkState): void {
  const { options, acc } = state;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    const rel = toPosix(relative(root, full));
    if (entry.isSymbolicLink()) {
      if (matchesAnyExclude(rel, options.excludeGlobs)) continue;
      state.skippedSymlinks += 1;
      continue;
    }
    if (entry.isDirectory()) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      if (matchesAnyExclude(rel, options.excludeGlobs)) continue;
      walk(full, root, state);
      continue;
    }
    if (entry.isFile()) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      if (matchesAnyExclude(rel, options.excludeGlobs)) continue;
      if (options.outputFile !== undefined) {
        const outAbs = normalize(resolve(options.outputFile));
        if (normalize(full) === outAbs) continue;
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(full);
      } catch {
        continue;
      }
      acc.push({ rel, bytes });
    }
  }
}

function matchesAnyExclude(posixRel: string, globs: readonly string[]): boolean {
  for (const g of globs) {
    if (matchGlob(g, posixRel)) return true;
  }
  return false;
}

export function computeDigest(targetAbs: string, options: DigestOptions): DigestResult {
  const files: FileEntry[] = [];
  const state: WalkState = { options, acc: files, skippedSymlinks: 0 };
  walk(targetAbs, targetAbs, state);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash("sha256");
  let bytes = 0;
  for (const f of files) {
    hash.update(f.rel);
    hash.update("\0");
    hash.update(f.bytes);
    bytes += f.bytes.length;
  }
  return {
    digest: `sha256:${hash.digest("hex")}`,
    files: files.length,
    bytes,
    excluded: [...EXCLUDED_NAMES],
    skippedSymlinks: state.skippedSymlinks,
  };
}

export function isExcludedDir(name: string): boolean {
  return EXCLUDED_NAMES.has(name);
}

export function fileDigestInfo(targetAbs: string): { exists: boolean; isDir: boolean } {
  try {
    const s = statSync(targetAbs);
    return { exists: true, isDir: s.isDirectory() };
  } catch {
    return { exists: false, isDir: false };
  }
}
