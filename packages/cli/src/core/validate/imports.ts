import { Effect, Path } from "effect";
import type { Finding } from "../../schemas/validate";
import { type Entry, shippedPath } from "../registry/entry";
import { shellWords } from "../shell";
import { type Composed, sourceOf, uniqueFindings } from "./composed";
import { type Check, finding, type View } from "./view";

type ImportFiles = {
  byPath: ReadonlyMap<string, Composed["files"][number]>;
  paths: ReadonlySet<string>;
  path: Path.Path;
  /** One check's memo of `imports` by file text: snapshots share most of their files. */
  scanned: Map<string, ImportRef[]>;
};
type ImportRef = { spec: string; line: number };
const JS_EXT = /\.(?:ts|tsx|js|mjs)$/;

/** Mask comments and record code positions without interpreting import-like literal text. */
function javascript(text: string) {
  const chars = text.split("");
  const code = new Uint8Array(text.length);
  let quote: string | undefined;
  let comment: "line" | "block" | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (comment) {
      index = commentCharacter(index);
    } else if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = undefined;
    } else index = codeCharacter(index);
  }
  return { text: chars.join(""), code };

  function codeCharacter(index: number): number {
    const char = text[index];
    const next = text[index + 1];
    if (char === "/" && (next === "/" || next === "*")) {
      comment = next === "/" ? "line" : "block";
      chars[index] = " ";
      chars[++index] = " ";
    } else {
      code[index] = 1;
      if (char === '"' || char === "'" || char === "`") quote = char;
    }
    return index;
  }

  function commentCharacter(index: number): number {
    const char = text[index];
    const next = text[index + 1];
    if (char !== "\n" && char !== "\r") chars[index] = " ";
    if (comment === "line" && char === "\n") comment = undefined;
    else if (comment === "block" && char === "*" && next === "/") {
      chars[++index] = " ";
      comment = undefined;
    }
    return index;
  }
}

/** Static relative imports only; package imports belong to the generated dependency setup. */
function imports(text: string, js: boolean): ImportRef[] {
  return js ? javascriptImports(text) : shellImports(text);
}

function javascriptImports(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const scanned = javascript(text);
  for (const pattern of [
    /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])([^"'\n]+)\1/gm,
    /^[ \t]*import\s*(["'])([^"'\n]+)\1/gm,
    /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g,
  ])
    for (const match of scanned.text.matchAll(pattern)) {
      const keyword = match.index + (match[0].match(/^[ \t]*/)?.[0].length ?? 0);
      const spec = match[2] ?? "";
      if (!scanned.code[keyword] || !/^\.\.?\//.test(spec)) continue;
      refs.push({ spec, line: text.slice(0, match.index).split("\n").length });
    }
  return refs;
}

function shellImports(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const match of text.matchAll(/^[ \t]*(?:source|\.)[ \t]+/gm)) {
    let spec = shellWords(text.slice(match.index).split("\n")[0] ?? "")[1];
    if (!spec) continue;
    if (/^\$\{?CLAUDE_PROJECT_DIR\}?\//.test(spec)) spec = spec.replace(/^[^/]+/, "");
    else if (/^\$(?:\{[^}]+\}|\w+)\//.test(spec)) spec = `./${spec.slice(spec.indexOf("/") + 1)}`;
    else if (spec.startsWith("/") || spec.includes("$")) continue;
    else if (!spec.startsWith(".")) spec = `./${spec}`;
    refs.push({ spec, line: text.slice(0, match.index).split("\n").length });
  }
  return refs;
}

function resolve(from: string, spec: string, files: ImportFiles, js: boolean) {
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

/** An overlay ships only onto its host stack, so it may also import that stack's files. */
function allowedOwners(view: View, entry: Entry, source: string): Set<string> {
  const allowed = new Set([`${entry.kind}:${entry.id}`]);
  const condition = shippedPath(source)?.condition;
  if (condition?.kind === "stack") allowed.add(`stack:${condition.id}`);
  const queue =
    entry.meta.kind === "stack" ? [...entry.meta.fragments.required] : [...entry.meta.requires];
  for (const id of queue) {
    const key = `fragment:${id}`;
    if (allowed.has(key)) continue;
    allowed.add(key);
    const dependency = view.all.find((item) => item.kind === "fragment" && item.id === id);
    if (dependency && "meta" in dependency && dependency.meta.kind === "fragment")
      queue.push(...dependency.meta.requires);
  }
  return allowed;
}

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
  file: Composed["files"][number],
  files: ImportFiles,
): Finding[] {
  const { byPath } = files;
  const findings: Finding[] = [];
  const js = JS_EXT.test(file.path);
  if (!js && !file.path.endsWith(".sh")) return findings;
  const source = sourceOf(view, snapshot, file);
  if (!source || !view.entries.some((entry) => entry.dir === source.entry.dir)) return findings;
  const allowed = allowedOwners(view, source.entry, source.source.source);
  const checkImport = (ref: ImportRef) => {
    const target = resolve(file.path, ref.spec, files, js);
    const owner = target === undefined ? undefined : byPath.get(target)?.owner;
    if (owner?.split("+").some((key) => allowed.has(key))) return;
    const field = source.entry.kind === "stack" ? "fragments.required" : "requires";
    findings.push(
      finding(source.entry, {
        check: "import-closure",
        severity: "error",
        file: view.file(source.entry, source.source.source),
        line: ref.line,
        message: `${file.path} imports ${ref.spec}${target ? ` (${target}, owned by ${owner})` : ", which resolves to no composed file"}; add the owner to ${field} or move the shared file`,
      }),
    );
  };
  const text = new TextDecoder().decode(file.bytes);
  const key = `${js ? "js" : "sh"}:${text}`;
  const refs = files.scanned.get(key) ?? imports(text, js);
  files.scanned.set(key, refs);
  for (const ref of refs) checkImport(ref);
  return findings;
}
