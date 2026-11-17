/**
 * Checks that shipped code imports files guaranteed to be present. Default and optional fragments
 * can be removed, while an overlay can rely on its host. The check scans static references (trust
 * point 1).
 */
import { shippedPath } from "@steamfield/stacks-format";
import { Effect, Path } from "effect";
import type { Finding } from "../../../schemas/validate";
import type { Entry } from "../../registry/entry";
import { shellWords } from "../../shell";
import { sourceOf, uniqueFindings } from "../compositions/composed";
import type { Check, Composed, View } from "../types";
import { finding } from "../view";

type ComposedFile = Composed["files"][number];

type ImportFiles = {
  byPath: ReadonlyMap<string, ComposedFile>;
  paths: ReadonlySet<string>;
  path: Path.Path;
  /** One check's memo of `imports` by file text: snapshots share most of their files. */
  scanned: Map<string, ImportRef[]>;
};

/** An import specifier as written and the 1-based line it appears on. */
type ImportRef = { spec: string; line: number };

const JS_EXT = /\.(?:ts|tsx|js|mjs)$/;

export const importChecks: Check = (view) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const findings: Finding[] = [];
    const scanned = new Map<string, ImportRef[]>();
    for (const snapshot of (yield* view.composed).snapshots) {
      const byPath = new Map(snapshot.files.map((file) => [file.path, file]));
      const paths = new Set(byPath.keys());
      for (const file of snapshot.files)
        findings.push(
          ...fileImportFindings(view, snapshot, file, { byPath, paths, path, scanned }),
        );
    }
    return { findings: uniqueFindings(findings) };
  });

function fileImportFindings(
  view: View,
  snapshot: Composed,
  file: ComposedFile,
  files: ImportFiles,
): Finding[] {
  const js = JS_EXT.test(file.path);
  if (!js && !file.path.endsWith(".sh")) return [];
  const source = sourceOf(view, snapshot, file);
  if (!source || !view.entries.some((entry) => entry.dir === source.entry.dir)) return [];
  const allowed = allowedOwners(view, source.entry, source.source.source);
  const field = source.entry.kind === "stack" ? "fragments.required" : "requires";
  const findings: Finding[] = [];
  for (const ref of cachedImports(file, js, files.scanned)) {
    const target = resolveImport(file.path, ref.spec, files, js);
    const owner = target === undefined ? undefined : files.byPath.get(target)?.owner;
    if (owner?.split("+").some((key) => allowed.has(key))) continue;
    findings.push(
      finding(source.entry, {
        check: "import-closure",
        severity: "error",
        file: view.file(source.entry, source.source.source),
        line: ref.line,
        message: `${file.path} imports ${ref.spec}${target ? ` (${target}, owned by ${owner})` : ", which resolves to no composed file"}; add the owner to ${field} or move the shared file`,
      }),
    );
  }
  return findings;
}

function cachedImports(
  file: ComposedFile,
  js: boolean,
  scanned: Map<string, ImportRef[]>,
): ImportRef[] {
  const text = new TextDecoder().decode(file.bytes);
  const key = `${js ? "js" : "sh"}:${text}`;
  const refs = scanned.get(key) ?? imports(text, js);
  scanned.set(key, refs);
  return refs;
}

/**
 * The owners (`<kind>:<id>`) whose files `entry` may import: itself, its transitive `requires`
 * closure (for a stack, starting from `fragments.required`), and, for a file in a stack overlay,
 * that host stack.
 */
function allowedOwners(view: View, entry: Entry, source: string): Set<string> {
  const allowed = new Set([`${entry.kind}:${entry.id}`]);
  const condition = shippedPath(source)?.condition;
  if (condition?.kind === "stack") allowed.add(`stack:${condition.id}`);
  const pending =
    entry.meta.kind === "stack" ? [...entry.meta.fragments.required] : [...entry.meta.requires];
  for (const id of pending) {
    const key = `fragment:${id}`;
    if (allowed.has(key)) continue;
    allowed.add(key);
    const dependency = view.all.find((item) => item.kind === "fragment" && item.id === id);
    if (dependency && "meta" in dependency && dependency.meta.kind === "fragment")
      pending.push(...dependency.meta.requires);
  }
  return allowed;
}

/**
 * The composed path an import specifier points at, or `undefined` when none exists. JavaScript
 * specifiers also try the TypeScript counterpart of a `.js` path, extension inference and
 * `index.ts` inside a shipped directory.
 */
function resolveImport(from: string, spec: string, files: ImportFiles, js: boolean) {
  const { path, paths } = files;
  const base = spec.startsWith("/")
    ? path.normalize(spec.slice(1))
    : path.join(path.dirname(from), spec);
  const candidates = [base];
  if (js) {
    if (base.endsWith(".js"))
      candidates.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
    if (!path.extname(base))
      candidates.push(...[".ts", ".tsx", ".js", ".mjs"].map((ext) => base + ext));
    candidates.push(path.join(base, "index.ts"));
  }
  return candidates.find((candidate) => paths.has(candidate));
}

/** Static relative imports only; package imports belong to the generated dependency setup. */
function imports(text: string, js: boolean): ImportRef[] {
  return js ? javascriptImports(text) : shellImports(text);
}

const JS_IMPORT_PATTERNS = [
  /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])([^"'\n]+)\1/gm,
  /^[ \t]*import\s*(["'])([^"'\n]+)\1/gm,
  /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
];

/**
 * Relative imports in JavaScript or TypeScript, pattern by pattern. A match counts only when its
 * keyword is code, not inside a string, so an import written in a template literal is ignored.
 */
function javascriptImports(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const masked = maskComments(text);
  for (const pattern of JS_IMPORT_PATTERNS)
    for (const match of masked.text.matchAll(pattern)) {
      const keyword = match.index + (match[0].match(/^[ \t]*/)?.[0].length ?? 0);
      const spec = match[2] ?? "";
      if (!masked.code[keyword] || !/^\.\.?\//.test(spec)) continue;
      refs.push({ spec, line: lineOf(text, match.index) });
    }
  return refs;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

type MaskState = {
  chars: string[];
  code: Uint8Array;
  quote: string | undefined;
  comment: "line" | "block" | undefined;
};

/**
 * `text` with every comment replaced by spaces (newlines kept, so lines and offsets don't move),
 * and a flag per character that is 1 where the character is code outside strings and comments.
 * Import-like text inside a string is never interpreted.
 */
function maskComments(text: string): { text: string; code: Uint8Array } {
  const state: MaskState = {
    chars: text.split(""),
    code: new Uint8Array(text.length),
    quote: undefined,
    comment: undefined,
  };
  for (let index = 0; index < text.length; index++) {
    if (state.comment) index = stepComment(text, index, state);
    else if (state.quote) index = stepString(text, index, state);
    else index = stepCode(text, index, state);
  }
  return { text: state.chars.join(""), code: state.code };
}

/**
 * One character of code, which may open a comment (blanked) or a string. Each step returns the
 * last index it consumed.
 */
function stepCode(text: string, index: number, state: MaskState): number {
  const char = text[index];
  const next = text[index + 1];
  if (char === "/" && (next === "/" || next === "*")) {
    state.comment = next === "/" ? "line" : "block";
    state.chars[index] = " ";
    state.chars[index + 1] = " ";
    return index + 1;
  }
  state.code[index] = 1;
  if (char === '"' || char === "'" || char === "`") state.quote = char;
  return index;
}

/** One character inside a string: a backslash skips the next one, the opening quote closes it. */
function stepString(text: string, index: number, state: MaskState): number {
  const char = text[index];
  if (char === "\\") return index + 1;
  if (char === state.quote) state.quote = undefined;
  return index;
}

/** One character inside a comment, blanked unless it is a line break that must stay. */
function stepComment(text: string, index: number, state: MaskState): number {
  const char = text[index];
  const next = text[index + 1];
  if (char !== "\n" && char !== "\r") state.chars[index] = " ";
  if (state.comment === "line" && char === "\n") state.comment = undefined;
  else if (state.comment === "block" && char === "*" && next === "/") {
    state.chars[index + 1] = " ";
    state.comment = undefined;
    return index + 1;
  }
  return index;
}

/** `source` and `.` lines in a shell script, each operand turned into a relative or rooted spec. */
function shellImports(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const match of text.matchAll(/^[ \t]*(?:source|\.)[ \t]+/gm)) {
    const operand = shellWords(text.slice(match.index).split("\n")[0] ?? "")[1];
    const spec = operand ? shellSpec(operand) : undefined;
    if (spec !== undefined) refs.push({ spec, line: lineOf(text, match.index) });
  }
  return refs;
}

/**
 * A sourced path as an import spec: `$CLAUDE_PROJECT_DIR/x` is rooted at the project (`/x`), any
 * other `$VAR/x` is taken as relative to the script (`./x`), and a bare name is relative too. An
 * absolute path or one with a variable elsewhere can't be resolved and is skipped.
 */
function shellSpec(operand: string): string | undefined {
  if (/^\$\{?CLAUDE_PROJECT_DIR\}?\//.test(operand)) return operand.replace(/^[^/]+/, "");
  if (/^\$(?:\{[^}]+\}|\w+)\//.test(operand)) return `./${operand.slice(operand.indexOf("/") + 1)}`;
  if (operand.startsWith("/") || operand.includes("$")) return undefined;
  if (!operand.startsWith(".")) return `./${operand}`;
  return operand;
}
