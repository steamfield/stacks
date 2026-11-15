import { Effect, Predicate, Result } from "effect";
import type { Finding } from "../../schemas/validate";
import { proseLines } from "../brief/headings";
import { shellWords } from "../shell";
import { runnerTarget } from "./commands";
import { sourceOf, uniqueFindings } from "./composed";
import { isNativeConfig, parseNativeConfig } from "./native-config";
import { nativeReferences } from "./native-refs";
import type { ReferenceIssue } from "./reference-issue";
import type { Source } from "./sources";
import type { Check, Composed, View } from "./types";
import { finding } from "./view";

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function hookCommands(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(hookCommands);
  if (!Predicate.isObject(value)) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key === "command" && typeof item === "string" ? [item] : hookCommands(item),
  );
}
function launchTarget(value: unknown): string | undefined {
  const args = strings(value);
  const target = args[0] === "run" ? args[1] : args[0];
  return target && !/^[-/.$]/.test(target) && !/[/.$]/.test(target) ? target : undefined;
}

type Emit = (issue: ReferenceIssue) => void;
type ReferenceFile = { snapshot: Composed; file: Composed["files"][number] };
type ParsedSource = (source: Source) => unknown;

export const shippedReferenceChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const sourceJson = new Map<Source, unknown>();
    const parsedSource = (source: Source): unknown => {
      if (!sourceJson.has(source)) {
        const path = source.path.replace(/\.tmpl$/, "");
        const parsed = Result.try(() =>
          isNativeConfig(path) ? parseNativeConfig(path, source.text) : JSON.parse(source.text),
        );
        sourceJson.set(source, Result.isSuccess(parsed) ? parsed.success : undefined);
      }
      return sourceJson.get(source);
    };
    for (const snapshot of (yield* view.composed).snapshots)
      findings.push(...snapshotReferences(view, snapshot, parsedSource));
    return { findings: uniqueFindings(findings) };
  });

function snapshotReferences(view: View, snapshot: Composed, parsedSource: ParsedSource): Finding[] {
  const findings: Finding[] = [];
  const paths = new Set(snapshot.files.map((file) => file.path));
  const named = new Set(
    [snapshot.composition.stack, ...snapshot.composition.fragments].flatMap((entry) =>
      proseLines(entry.body).flatMap((line) =>
        [...line.text.matchAll(/`([A-Za-z][\w:-]*)(?=[`\s])/g)].flatMap((match) =>
          match[1] ? [match[1]] : [],
        ),
      ),
    ),
  );
  const declared = (target: string) =>
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

function fileReferences(
  { snapshot, file }: ReferenceFile,
  { paths, declared }: { paths: ReadonlySet<string>; declared: (target: string) => boolean },
  emit: Emit,
) {
  if (isNativeConfig(file.path)) {
    for (const issue of nativeReferences(file.path, new TextDecoder().decode(file.bytes), {
      paths,
      declared: (target) => Object.hasOwn(snapshot.composition.commands, target),
    }))
      emit(issue);
    return;
  }
  if (file.path !== ".claude/settings.json" && !/^\.vscode\/[^/]+\.json$/.test(file.path)) return;
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
  if (file.path === ".claude/settings.json" && Predicate.isObject(json)) {
    permissionReferences(json, declared, emit);
    hookReferences(json, paths, emit);
  }
  if (file.path === ".vscode/launch.json" && Predicate.isObject(json))
    launchReferences(json, declared, emit);
  portReferences(snapshot.composition.env, text, emit);
}

function permissionReferences(
  json: Record<string, unknown>,
  declared: (target: string) => boolean,
  emit: Emit,
) {
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

function launchReferences(
  json: Record<string, unknown>,
  declared: (target: string) => boolean,
  emit: Emit,
) {
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
