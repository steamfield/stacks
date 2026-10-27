import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { EXCLUDED_NAMES, matchGlob } from "./digest";

const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".mdx": "markdown",
};

const MANIFEST_FILES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "go.mod",
  "go.sum",
  "Cargo.toml",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "mix.exs",
]);

const MARKERS = ["TODO", "FIXME", "HACK", "XXX"] as const;

const NON_SOURCE_LANGUAGES = new Set(["json", "yaml", "toml", "markdown"]);

type CommentStyle = "slash" | "hash" | "html" | "css" | "none";
const LANGUAGE_COMMENT: Readonly<Record<string, CommentStyle>> = {
  typescript: "slash",
  javascript: "slash",
  go: "slash",
  rust: "slash",
  java: "slash",
  kotlin: "slash",
  swift: "slash",
  c: "slash",
  cpp: "slash",
  csharp: "slash",
  php: "slash",
  json: "none",
  python: "hash",
  ruby: "hash",
  shell: "hash",
  yaml: "hash",
  toml: "hash",
  html: "html",
  css: "css",
  markdown: "none",
};

export type FileMetrics = {
  readonly path: string;
  readonly language: string | undefined;
  readonly bytes: number;
  readonly lines: number;
  readonly codeLines: number;
  readonly blankLines: number;
  readonly commentLines: number;
  readonly isTest: boolean;
};

export type Metrics = {
  readonly files: number;
  readonly bytes: number;
  readonly lines: number;
  readonly codeLines: number;
  readonly blankLines: number;
  readonly commentLines: number;
  readonly byLanguage: Readonly<Record<string, number>>;
  readonly testRatio: number;
  readonly testFiles: number;
  readonly sourceFiles: number;
  readonly markers: Readonly<Record<string, number>>;
  readonly largestFiles: ReadonlyArray<{
    readonly path: string;
    readonly lines: number;
    readonly bytes: number;
    readonly language?: string;
  }>;
  readonly manifests: readonly string[];
  readonly filesByLanguage: Readonly<Record<string, number>>;
};

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function languageForName(name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [ext, lang] of Object.entries(EXTENSION_LANGUAGE)) {
    if (lower.endsWith(ext)) return lang;
  }
  return undefined;
}

function isTestFile(posixRel: string, language: string | undefined): boolean {
  const parts = posixRel.split("/");
  const name = (parts[parts.length - 1] ?? "").toLowerCase();
  const inTestDir = parts.some((p) => p === "tests" || p === "__tests__" || p === "test");
  switch (language) {
    case "typescript":
    case "javascript":
      return (
        name.includes(".test.") || name.includes(".spec.") || name.startsWith("test-") || inTestDir
      );
    case "python":
      return name.startsWith("test_") || name.endsWith("_test.py") || inTestDir;
    case "go":
      return name.endsWith("_test.go");
    case "rust":
      return name.endsWith("_test.rs") || inTestDir;
    default:
      return inTestDir;
  }
}

function countLines(
  content: string,
  style: CommentStyle,
): {
  lines: number;
  codeLines: number;
  blankLines: number;
  commentLines: number;
} {
  if (content.length === 0) {
    return { lines: 0, codeLines: 0, blankLines: 0, commentLines: 0 };
  }
  const rawLines = content.split("\n");
  const lines = rawLines.length;
  let blank = 0;
  let comment = 0;
  let code = 0;
  let inBlock = false;
  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const raw = rawLines[idx] ?? "";
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (idx === rawLines.length - 1) {
        // trailing newline produces an empty final element; do not count it as a blank line
        continue;
      }
      blank += 1;
      continue;
    }
    if (inBlock) {
      comment += 1;
      if (trimmed.includes("*/")) {
        inBlock = false;
      }
      continue;
    }
    const startsComment =
      (style === "slash" && (trimmed.startsWith("//") || trimmed.startsWith("/*"))) ||
      (style === "hash" && trimmed.startsWith("#")) ||
      (style === "html" && trimmed.startsWith("<!--")) ||
      (style === "css" && trimmed.startsWith("/*"));
    if (startsComment) {
      comment += 1;
      if (
        (style === "slash" || style === "css") &&
        trimmed.startsWith("/*") &&
        !trimmed.includes("*/")
      ) {
        inBlock = true;
      }
      if (style === "html" && trimmed.startsWith("<!--") && !trimmed.includes("-->")) {
        inBlock = true;
      }
      continue;
    }
    code += 1;
  }
  return { lines, codeLines: code, blankLines: blank, commentLines: comment };
}

function countMarkers(content: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of MARKERS) {
    out[m] = 0;
  }
  for (const m of MARKERS) {
    const re = new RegExp(`\\b${m}\\b`, "g");
    const matches = content.match(re);
    out[m] = matches ? matches.length : 0;
  }
  return out;
}

type WalkFile = {
  readonly rel: string;
  readonly language: string | undefined;
  readonly bytes: number;
  readonly content: string;
  readonly isText: boolean;
};

function walk(dir: string, root: string, excludeGlobs: readonly string[], acc: WalkFile[]): void {
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
    if (entry.isDirectory()) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      if (matchesAny(rel, excludeGlobs)) continue;
      walk(full, root, excludeGlobs, acc);
      continue;
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      if (matchesAny(rel, excludeGlobs)) continue;
      let bytes: Buffer;
      try {
        bytes = readFileSync(full);
      } catch {
        continue;
      }
      const language = languageForName(entry.name);
      const isText = looksText(bytes);
      const content = isText ? bytes.toString("utf8") : "";
      acc.push({ rel, language, bytes: bytes.length, content, isText });
    }
  }
}

function matchesAny(posixRel: string, globs: readonly string[]): boolean {
  for (const g of globs) {
    if (matchGlob(g, posixRel)) return true;
  }
  return false;
}

function looksText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  for (let i = 0; i < sample.length; i += 1) {
    const b = sample[i];
    if (b === undefined) continue;
    if (b === 0) return false;
  }
  return true;
}

export function computeInventory(targetAbs: string, excludeGlobs: readonly string[]): Metrics {
  const files: WalkFile[] = [];
  walk(targetAbs, targetAbs, excludeGlobs, files);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  let totalBytes = 0;
  let totalLines = 0;
  let totalCode = 0;
  let totalBlank = 0;
  let totalComment = 0;
  let testFiles = 0;
  let sourceFiles = 0;
  const markers: Record<string, number> = {};
  for (const m of MARKERS) markers[m] = 0;
  const manifests: string[] = [];
  const codeByLang: Record<string, number> = {};
  const filesByLang: Record<string, number> = {};
  const perFile: Array<{
    rel: string;
    lines: number;
    bytes: number;
    language?: string;
  }> = [];

  for (const f of files) {
    totalBytes += f.bytes;
    const name = f.rel.split("/").pop() ?? "";
    if (MANIFEST_FILES.has(name)) {
      manifests.push(f.rel);
    }
    const style = f.language ? (LANGUAGE_COMMENT[f.language] ?? "none") : "none";
    const counts = f.isText
      ? countLines(f.content, style)
      : { lines: 0, codeLines: 0, blankLines: 0, commentLines: 0 };
    totalLines += counts.lines;
    totalCode += counts.codeLines;
    totalBlank += counts.blankLines;
    totalComment += counts.commentLines;
    if (f.isText) {
      const fileMarkers = countMarkers(f.content);
      for (const m of MARKERS) {
        markers[m] = (markers[m] ?? 0) + (fileMarkers[m] ?? 0);
      }
    }
    const isSourceLanguage = f.language !== undefined && !NON_SOURCE_LANGUAGES.has(f.language);
    const isTest = isSourceLanguage && isTestFile(f.rel, f.language as string);
    if (isSourceLanguage) {
      if (isTest) {
        testFiles += 1;
      } else {
        sourceFiles += 1;
      }
    }
    if (f.language !== undefined) {
      filesByLang[f.language] = (filesByLang[f.language] ?? 0) + 1;
      if (f.isText && counts.codeLines > 0) {
        codeByLang[f.language] = (codeByLang[f.language] ?? 0) + counts.codeLines;
      }
    }
    perFile.push({ rel: f.rel, lines: counts.lines, bytes: f.bytes, language: f.language });
  }

  const byLanguage: Record<string, number> = {};
  const totalLangCode = Object.values(codeByLang).reduce((a, b) => a + b, 0);
  for (const [lang, code] of Object.entries(codeByLang)) {
    byLanguage[lang] = totalLangCode > 0 ? Math.round((code / totalLangCode) * 100) : 0;
  }

  const largest = [...perFile].sort((a, b) => b.lines - a.lines).slice(0, 10);

  manifests.sort();

  return {
    files: files.length,
    bytes: totalBytes,
    lines: totalLines,
    codeLines: totalCode,
    blankLines: totalBlank,
    commentLines: totalComment,
    byLanguage,
    testRatio: sourceFiles > 0 ? testFiles / sourceFiles : 0,
    testFiles,
    sourceFiles,
    markers,
    largestFiles: largest.map((f) => ({
      path: f.rel,
      lines: f.lines,
      bytes: f.bytes,
      language: f.language,
    })),
    manifests,
    filesByLanguage: filesByLang,
  };
}
