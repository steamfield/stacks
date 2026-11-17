/**
 * Checks references in shipped configs using static parsing (trust point 1). `sourceOf`
 * attributes issues to the files that contributed to the rendered config.
 */
import { Effect, Predicate, Result } from "effect";
import type { Finding } from "../../../schemas/validate";
import { proseLines } from "../../brief/headings";
import type { Composition } from "../../compose/types";
import { shellWords } from "../../shell";
import { sourceOf, uniqueFindings } from "../compositions/composed";
import type { Source } from "../sources";
import type { Check, Composed, View } from "../types";
import { finding } from "../view";
import { runnerTarget } from "./commands";
import { isNativeConfig, parseNativeConfig } from "./native-config";
import { nativeReferences } from "./native-refs";
import type { ReferenceIssue } from "./reference-issue";

type Emit = (issue: ReferenceIssue) => void;
type ReferenceFile = { snapshot: Composed; file: Composed["files"][number] };
type ParsedSource = (source: Source) => unknown;
type Declared = (target: string) => boolean;

export const shippedReferenceChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const parsedSource = sourceParser();
    for (const snapshot of (yield* view.composed).snapshots)
      findings.push(...snapshotReferences(view, snapshot, parsedSource));
    return { findings: uniqueFindings(findings) };
  });

/**
 * Parses an entry's source copy of a config once per check (snapshots share sources); a copy
 * that doesn't parse is `undefined`.
 */
function sourceParser(): ParsedSource {
  const parsed = new Map<Source, unknown>();
  return (source) => {
    if (!parsed.has(source)) {
      const path = source.path.replace(/\.tmpl$/, "");
      const result = Result.try(() =>
        isNativeConfig(path) ? parseNativeConfig(path, source.text) : JSON.parse(source.text),
      );
      parsed.set(source, Result.isSuccess(result) ? result.success : undefined);
    }
    return parsed.get(source);
  };
}

function snapshotReferences(view: View, snapshot: Composed, parsedSource: ParsedSource): Finding[] {
  const findings: Finding[] = [];
  const paths = new Set(snapshot.files.map((file) => file.path));
  const named = namedInProse(snapshot.composition);
  const declared: Declared = (target) =>
    Object.hasOwn(snapshot.composition.commands, target) || named.has(target);
  for (const file of snapshot.files) {
    const emit: Emit = (issue) => {
      const found = referenceFinding(view, { snapshot, file }, issue, parsedSource);
      if (found) findings.push(found);
    };
    fileReferences({ snapshot, file }, { paths, declared }, emit);
  }
  return findings;
}

/**
 * Words written as inline code in the entries' prose (`` `typecheck` ``), which count as declared
 * commands for Claude and VS Code config.
 */
function namedInProse(composition: Composition): Set<string> {
  return new Set(
    [composition.stack, ...composition.fragments].flatMap((entry) =>
      proseLines(entry.body).flatMap((line) =>
        [...line.text.matchAll(/`([A-Za-z][\w:-]*)(?=[`\s])/g)].flatMap((match) =>
          match[1] ? [match[1]] : [],
        ),
      ),
    ),
  );
}

/** The issue as a finding on the validated entry whose source holds it, or `undefined`. */
function referenceFinding(
  view: View,
  { snapshot, file }: ReferenceFile,
  issue: ReferenceIssue,
  parsedSource: ParsedSource,
): Finding | undefined {
  const { matches } = issue;
  const source = sourceOf(view, snapshot, file, {
    needle: issue.needle,
    matches: matches ? (source) => matches(parsedSource(source)) : undefined,
  });
  if (!source || !view.entries.some((entry) => entry.dir === source.entry.dir)) return undefined;
  return finding(source.entry, {
    check: issue.check,
    severity: issue.severity,
    file: view.file(source.entry, source.source.source),
    ...(source.line === undefined ? {} : { line: source.line }),
    message: `${file.path}: ${issue.message}`,
  });
}

type Provided = { paths: ReadonlySet<string>; declared: Declared };

function fileReferences(
  { snapshot, file }: ReferenceFile,
  { paths, declared }: Provided,
  emit: Emit,
) {
  if (isNativeConfig(file.path)) {
    // Agent configs count only the commands table as declared, not names in prose.
    const issues = nativeReferences(file.path, new TextDecoder().decode(file.bytes), {
      paths,
      declared: (target) => Object.hasOwn(snapshot.composition.commands, target),
    });
    for (const issue of issues) emit(issue);
    return;
  }
  if (file.path !== ".claude/settings.json" && !/^\.vscode\/[^/]+\.json$/.test(file.path)) return;
  jsonReferences({ snapshot, file }, { paths, declared }, emit);
}

function jsonReferences(
  { snapshot, file }: ReferenceFile,
  { paths, declared }: Provided,
  emit: Emit,
) {
  const path = file.path;
  const text = new TextDecoder().decode(file.bytes);
  const decoded = Result.try(() => JSON.parse(text) as unknown);
  if (Result.isFailure(decoded)) {
    emit({
      check: "ref-json",
      severity: "error",
      needle: "",
      message: "invalid JSON; references were skipped",
    });
    return;
  }
  const json = decoded.success;
  if (path === ".claude/settings.json" && Predicate.isObject(json)) {
    permissionReferences(json, declared, emit);
    hookReferences(json, paths, emit);
  }
  if (path === ".vscode/launch.json" && Predicate.isObject(json))
    launchReferences(json, declared, emit);
  portReferences(snapshot.composition.env, text, emit);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function permissionReferences(json: Record<string, unknown>, declared: Declared, emit: Emit) {
  const permissions = Predicate.isObject(json.permissions) ? json.permissions : {};
  for (const list of ["allow", "deny"])
    for (const rule of strings(permissions[list])) {
      const command = /^Bash\((.*)\)$/s.exec(rule)?.[1];
      const target = command === undefined ? undefined : runnerTarget(command);
      if (!target || declared(target)) continue;
      emit({
        check: "ref-command",
        severity: "error",
        needle: rule,
        message: `${list} rule runs ${target}, which no composed entry declares in commands or inline code`,
        matches: (json) => hasPermission(json, list, rule),
      });
    }
}

function hasPermission(json: unknown, list: string, rule: string): boolean {
  return (
    Predicate.isObject(json) &&
    Predicate.isObject(json.permissions) &&
    strings(json.permissions[list]).includes(rule)
  );
}

/** Every `command` string anywhere under Claude's `hooks`. */
function hookCommands(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(hookCommands);
  if (!Predicate.isObject(value)) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key === "command" && typeof item === "string" ? [item] : hookCommands(item),
  );
}

/** Hook commands naming a `$CLAUDE_PROJECT_DIR/.claude/hooks/` script that isn't shipped. */
function hookReferences(json: Record<string, unknown>, paths: ReadonlySet<string>, emit: Emit) {
  for (const command of hookCommands(json.hooks))
    for (const word of shellWords(command)) {
      const target = /\$\{?CLAUDE_PROJECT_DIR\}?\/(\.claude\/hooks\/.+)$/.exec(word)?.[1];
      if (!target || paths.has(target)) continue;
      emit({
        check: "ref-hook",
        severity: "error",
        needle: command,
        message: `hook references ${target}, which no composed entry ships`,
        matches: (json) => Predicate.isObject(json) && hookCommands(json.hooks).includes(command),
      });
    }
}

/**
 * The script name a launch configuration's `args` or `runtimeArgs` runs (`["run", "dev"]` gives
 * `dev`); a flag, path or variable gives `undefined`.
 */
function launchTarget(value: unknown): string | undefined {
  const args = strings(value);
  const target = args[0] === "run" ? args[1] : args[0];
  return target && !/^[-/.$]/.test(target) && !/[/.$]/.test(target) ? target : undefined;
}

function launchReferences(json: Record<string, unknown>, declared: Declared, emit: Emit) {
  for (const config of Array.isArray(json.configurations) ? json.configurations : []) {
    if (!Predicate.isObject(config)) continue;
    for (const field of ["args", "runtimeArgs"]) {
      const target = launchTarget(config[field]);
      if (!target || declared(target)) continue;
      emit({
        check: "ref-command",
        severity: "error",
        needle: JSON.stringify(target),
        message: `${field} runs ${target}, which no composed entry declares in commands or inline code`,
        matches: (json) => hasLaunchTarget(json, field, target),
      });
    }
  }
}

function hasLaunchTarget(json: unknown, field: string, target: string): boolean {
  return (
    Predicate.isObject(json) &&
    Array.isArray(json.configurations) &&
    json.configurations.some(
      (config) => Predicate.isObject(config) && launchTarget(config[field]) === target,
    )
  );
}

/** A local port literal can bypass the port variable declared by the composition. */
function portReferences(env: Record<string, string>, text: string, emit: Emit) {
  const portVars = Object.keys(env).filter((name) => /(?:^|_)PORT(?:_|$)/.test(name));
  if (!portVars.length) return;
  for (const literal of new Set(
    [...text.matchAll(/\b(?:localhost|127\.0\.0\.1):\d+/g)].map((match) => match[0]),
  ))
    emit({
      check: "ref-port",
      severity: "warning",
      needle: literal,
      message: `literal ${literal} hardcodes a port declared by ${portVars.join(", ")}`,
    });
}
