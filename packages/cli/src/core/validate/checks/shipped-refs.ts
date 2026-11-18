/**
 * Checks references in shipped configs using static parsing (trust point 1). `sourceOf`
 * attributes issues to the files that contributed to the rendered config, and a command target
 * resolves in the scope of the contributor that shipped it: a part's line against its own
 * prefixed commands, since a hoisted file merges lines from the workspace and every part.
 */
import { Effect, Predicate, Result } from "effect";
import type { Finding } from "../../../schemas/validate";
import { proseLines } from "../../brief/headings";
import type { Composition, MountedEntry, PartMount } from "../../compose/types";
import { defined } from "../../object";
import { shellWords } from "../../text/shell";
import { contributingSources, sourceOf, uniqueFindings } from "../compositions/composed";
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
/** Whether a target is declared for a line shipped by an entry on this mount (none: the root). */
type Declared = (target: string, mount: PartMount | undefined) => boolean;
type Resolver = { parsedSource: ParsedSource; declared: Declared };

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
  const { commands } = snapshot.composition;
  const named = namedInProse(snapshot.composition);
  // Agent configs count only the commands table as declared, not names in prose.
  const inTable: Declared = (target, mount) =>
    Object.hasOwn(commands, mount ? `${mount.name}-${target}` : target);
  const inTableOrProse: Declared = (target, mount) =>
    inTable(target, mount) || (!mount && named.has(target));
  for (const file of snapshot.files) {
    const declared = isNativeConfig(file.path) ? inTable : inTableOrProse;
    const emit: Emit = (issue) => {
      const found = referenceFinding(view, { snapshot, file }, issue, { parsedSource, declared });
      if (found) findings.push(found);
    };
    fileReferences({ snapshot, file }, paths, emit);
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

/**
 * The issue as a finding on the validated entry whose source holds it, or `undefined`. An issue
 * with a target is a problem only for the contributors that don't declare it in their own scope,
 * so the finding goes to one of those, and to none when every contributor declares it.
 */
function referenceFinding(
  view: View,
  ref: ReferenceFile,
  issue: ReferenceIssue,
  { parsedSource, declared }: Resolver,
): Finding | undefined {
  const { matches, target } = issue;
  const holds = matches && ((source: Source) => matches(parsedSource(source)));
  if (target !== undefined && declaredByHolders(view, ref, { holds, target, declared }))
    return undefined;
  const undeclaredHolder =
    holds &&
    ((source: Source, entry: MountedEntry) =>
      holds(source) && (target === undefined || !declared(target, entry.mount)));
  const { snapshot, file } = ref;
  const contributor = sourceOf(view, snapshot, file, {
    needle: issue.needle,
    matches: undeclaredHolder,
  });
  if (!contributor || !view.entries.some((entry) => entry.dir === contributor.entry.dir))
    return undefined;
  return finding(
    contributor.entry,
    defined({
      check: issue.check,
      severity: issue.severity,
      file: view.file(contributor.entry, contributor.file.source),
      line: contributor.line,
      message: `${file.path}: ${issue.message}`,
    }),
  );
}

/**
 * Whether every contributor whose source holds the line declares the target in its own scope.
 * When no source holds it (the line exists only after rendering), the root scope decides.
 */
function declaredByHolders(
  view: View,
  { snapshot, file }: ReferenceFile,
  query: { holds: ((source: Source) => boolean) | undefined; target: string; declared: Declared },
): boolean {
  const { holds, target, declared } = query;
  const holders = holds
    ? contributingSources(view, snapshot, file).filter((contributor) => holds(contributor.file))
    : [];
  if (!holders.length) return declared(target, undefined);
  return holders.every(({ entry }) => declared(target, entry.mount));
}

function fileReferences({ snapshot, file }: ReferenceFile, paths: ReadonlySet<string>, emit: Emit) {
  if (isNativeConfig(file.path)) {
    const issues = nativeReferences(file.path, new TextDecoder().decode(file.bytes), { paths });
    for (const issue of issues) emit(issue);
    return;
  }
  if (file.path !== ".claude/settings.json" && !/^\.vscode\/[^/]+\.json$/.test(file.path)) return;
  jsonReferences({ snapshot, file }, paths, emit);
}

function jsonReferences({ snapshot, file }: ReferenceFile, paths: ReadonlySet<string>, emit: Emit) {
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
    permissionReferences(json, emit);
    hookReferences(json, paths, emit);
  }
  if (path === ".vscode/launch.json" && Predicate.isObject(json)) launchReferences(json, emit);
  portReferences(snapshot.composition.env, text, emit);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function permissionReferences(json: Record<string, unknown>, emit: Emit) {
  const permissions = Predicate.isObject(json.permissions) ? json.permissions : {};
  for (const list of ["allow", "deny"])
    for (const rule of strings(permissions[list])) {
      const command = /^Bash\((.*)\)$/s.exec(rule)?.[1];
      const target = command === undefined ? undefined : runnerTarget(command);
      if (!target) continue;
      emit({
        check: "ref-command",
        severity: "error",
        needle: rule,
        message: `${list} rule runs ${target}, which no composed entry declares in commands or inline code`,
        matches: (json) => hasPermission(json, list, rule),
        target,
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

function launchReferences(json: Record<string, unknown>, emit: Emit) {
  for (const config of Array.isArray(json.configurations) ? json.configurations : []) {
    if (!Predicate.isObject(config)) continue;
    for (const field of ["args", "runtimeArgs"]) {
      const target = launchTarget(config[field]);
      if (!target) continue;
      emit({
        check: "ref-command",
        severity: "error",
        needle: JSON.stringify(target),
        message: `${field} runs ${target}, which no composed entry declares in commands or inline code`,
        matches: (json) => hasLaunchTarget(json, field, target),
        target,
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
