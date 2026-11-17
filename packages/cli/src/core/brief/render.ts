/**
 * Renders the new-project brief and delegates add briefs to `renderAddBrief`. Section and list
 * order are part of the brief's contract because digest tests pin its exact bytes.
 */
import { APP_TAG } from "@steamfield/stacks-format";
import { METADATA_DIR } from "../../project-layout";
import type { Composition } from "../compose/types";
import type { Entry } from "../registry/entry";
import { envPrefix, slug } from "../text/slug";
import {
  dependencyLines,
  environmentNote,
  envTable,
  oneLine,
  runOrder,
  toolLines,
  writeCommandTable,
  writeDecisions,
  writeEnvironment,
  writeStepTable,
  writeUntrustedList,
} from "./blocks";
import { nest } from "./headings";
import { collapsePaths } from "./paths";
import { renderAddBrief } from "./render-add";
import * as T from "./text";
import type { Brief, BriefContext } from "./types";
import { type BriefWriter, briefWriter } from "./writer";

/** What every section of a new-project brief reads: the composition with its stack known. */
type NewBrief = {
  composition: Composition<Entry | null>;
  context: BriefContext;
  stack: Entry;
  app: Entry | null;
  base: ReadonlyArray<Entry>;
  cli: string;
};

/**
 * Pure rendering. With an app, give the base its own definition of done first because
 * `runApp` requires a green base.
 */
export function renderBrief(composition: Composition<Entry | null>, context: BriefContext): Brief {
  if (context.add) return renderAddBrief(composition, context, context.add);
  if (!composition.stack) throw new Error("A new-project brief requires a stack");
  const { stack, app } = composition;
  const brief: NewBrief = {
    composition,
    context,
    stack,
    app,
    base: composition.fragments.filter((fragment) => fragment !== app),
    cli: context.invocation,
  };
  const out = briefWriter();
  out.fixed(T.title(oneLine(context.project), oneLine(stack.meta.name)), "");
  writeUntrusted(out, composition);
  writeStartHere(out, composition, brief.cli);
  writeFacts(out, brief);
  out.gap();
  out.fixed(...T.versions);
  writeGroundRules(out, context);
  writeDecisions(out, composition.decisions, context.yes);
  writeDependencies(out, composition, context);
  writeGuidance(out, T.sections.stack(oneLine(stack.meta.name), stack.id), stack);
  for (const fragment of brief.base)
    writeGuidance(out, T.sections.fragment(oneLine(fragment.meta.name), fragment.id), fragment);
  writeDefinitionOfDone(out, brief);
  writeApplication(out, brief);
  writeAfterGreen(out, brief);
  if (composition.preset === "sandbox") {
    out.gap();
    out.fixed(...T.sandbox);
  }
  return out.brief();
}

/** Warn about untrusted entries before any of their guidance (trust point 3). */
function writeUntrusted(out: BriefWriter, composition: Composition<Entry | null>): void {
  const { untrusted } = composition;
  if (untrusted.length === 0) return;
  writeUntrustedList(out, untrusted);
  const fromProject = untrusted.some((entry) => entry.origin === "project");
  const fromOverride = untrusted.some((entry) => entry.origin !== "project");
  out.fixed("", T.untrusted.where(fromProject, fromOverride), "", T.untrusted.ask, "");
}

/** The numbered action list that opens the brief; step 1 is the install command when known. */
function writeStartHere(
  out: BriefWriter,
  composition: Composition<Entry | null>,
  cli: string,
): void {
  const install = installCommands(composition);
  out.fixed(T.start.heading, "", T.start.did, "");
  if (install.length) {
    out.fixed(T.start.install, "");
    out.data("   ```sh", ...install.map((line) => `   ${line}`), "   ```", "");
  } else out.fixed(T.start.installListed(listed(composition)));
  out.fixed(
    T.start.verify(cli),
    T.start.build(composition.decisions.length > 0, composition.app !== null),
    T.start.done(cli),
    "",
    T.start.reference,
    "",
    T.start.facts,
    "",
  );
}

/** What step 1 points at when stacks can't spell the install command. */
function listed(composition: Composition<Entry | null>): "packages" | "tools" | "none" {
  if (composition.deps.length) return "packages";
  return composition.tools.length ? "tools" : "none";
}

function writeFacts(out: BriefWriter, brief: NewBrief): void {
  const { composition, context, stack, app, cli } = brief;
  out.fixed(
    T.facts.stack(oneLine(stack.meta.name), stack.id),
    T.facts.project(slug(context.project), envPrefix(slug(context.project))),
    T.facts.fragments(brief.base.map((fragment) => fragment.id)),
    ...(app ? [T.facts.app(oneLine(app.meta.name), app.id)] : []),
    T.facts.preset(composition.lean ? "lean" : composition.preset),
    ...(composition.payload ? [T.facts.payload(composition.payload)] : []),
    T.facts.agents(composition.agents),
    T.facts.root,
  );
  writeWrittenPaths(out, context.written);
  if (cli !== "stacks") out.fixed(T.facts.invocation(cli));
}

function writeWrittenPaths(out: BriefWriter, written: ReadonlyArray<string>): void {
  if (written.length === 0) return;
  out.fixed(T.facts.written);
  for (const line of collapsePaths(written)) {
    // The metadata listing is CLI-owned text; entry file paths are supplied by entries.
    if (line.startsWith(`${METADATA_DIR}/`)) out.fixed(writtenPathItem(line));
    else out.data(writtenPathItem(line));
  }
}

function writtenPathItem(line: string): string {
  const dir = / \(\d+ files\)$/.exec(line);
  return `  - ${dir ? `${T.code(line.slice(0, dir.index))}${dir[0]}` : T.code(line)}`;
}

function writeGroundRules(out: BriefWriter, context: BriefContext): void {
  out.gap();
  out.fixed(T.ground.heading, "", T.ground.generators, T.ground.git(context.git));
  if (context.written.length) out.fixed(T.ground.written);
  out.fixed(T.ground.agentsMd, T.ground.telemetry, ...T.ground.notes);
  if (context.missing.length) out.fixed(T.ground.missing);
}

/** Packages by role (unless Start here already installs them) and each tool's PATH status. */
function writeDependencies(
  out: BriefWriter,
  composition: Composition<Entry | null>,
  context: BriefContext,
): void {
  const { deps, tools } = composition;
  if (deps.length === 0 && tools.length === 0) return;
  out.gap();
  out.fixed(T.dependencies.heading);
  if (deps.length && installCommands(composition).length) out.fixed("", T.dependencies.inStart);
  else if (deps.length) {
    out.fixed("", T.dependencies.packages, "");
    out.data(...dependencyLines(deps));
  }
  if (tools.length) {
    out.fixed("", T.dependencies.tools, "");
    out.data(...toolLines(tools, context));
  }
}

function writeGuidance(out: BriefWriter, heading: string, entry: Entry): void {
  out.gap();
  out.fixed(heading);
  out.data(...bodyLines(entry));
}

function bodyLines(entry: Entry): string[] {
  const body = nest(entry.body).replace(/^\n+|\n+$/g, "");
  return body ? ["", ...body.split("\n")] : [];
}

function writeDefinitionOfDone(out: BriefWriter, brief: NewBrief): void {
  const { composition, app, cli } = brief;
  out.gap();
  out.fixed(app ? T.done.base : T.done.heading, "");
  if (app) out.fixed(T.done.baseFirst(cli), "");
  const steps = composition.verify.filter((step) => !step.tags.includes(APP_TAG));
  if (steps.length) {
    out.fixed(app ? T.done.baseSteps(cli) : T.done.steps(cli), "");
    writeStepTable(out, runOrder(steps));
  } else out.fixed(T.done.noSteps(cli));
  writeCommandTable(out, T.done.commands, baseRecord(brief, "commands"));
  writeEnvironment(out, cli, baseRecord(brief, "env"));
  writeRules(out, brief);
}

/** Show the app's own values in the application section only. */
function baseRecord(brief: NewBrief, field: "commands" | "env"): Record<string, string> {
  if (!brief.app) return brief.composition[field];
  return merged([brief.stack, ...brief.base], field);
}

/** Fold in entry order so later entries supply the value for a shared key. */
function merged(entries: ReadonlyArray<Entry>, field: "commands" | "env"): Record<string, string> {
  return Object.fromEntries(new Map(entries.flatMap((entry) => Object.entries(entry.meta[field]))));
}

/** The rules of the definition of done; the server rules appear only when a step serves. */
function writeRules(out: BriefWriter, brief: NewBrief): void {
  const { composition, app, cli } = brief;
  const serves = composition.verify.some((step) => step.phase === "serve");
  out.gap();
  out.fixed(
    T.done.rules,
    "",
    app ? T.done.rule.runBase(cli) : T.done.rule.run(cli),
    T.done.rule.create,
    T.done.rule.weaken,
    ...(serves ? [T.done.rule.servers, T.done.rule.foreground] : []),
    T.done.rule.timeout,
    T.done.rule.failing,
    T.done.rule.changed(cli),
  );
}

function writeApplication(out: BriefWriter, brief: NewBrief): void {
  const { composition, app, cli } = brief;
  if (!app) return;
  out.gap();
  out.fixed(T.application.heading, "", T.application.intro);
  out.data(...bodyLines(app));
  const appSteps = composition.verify.filter((step) => step.tags.includes(APP_TAG));
  if (appSteps.length) {
    out.gap();
    out.fixed(T.application.steps, "", T.application.stepsIntro, "");
    writeStepTable(out, runOrder(appSteps));
  }
  writeCommandTable(out, T.application.commands, app.meta.commands);
  writeApplicationEnvironment(out, brief, app);
  out.fixed("", T.application.done(cli));
}

/** The app's env variables the base doesn't already set, with the notes the base didn't give. */
function writeApplicationEnvironment(out: BriefWriter, brief: NewBrief, app: Entry): void {
  const baseEnv = baseRecord(brief, "env");
  const appEnv = Object.fromEntries(
    Object.entries(app.meta.env).filter(([key]) => !Object.hasOwn(baseEnv, key)),
  );
  if (Object.keys(appEnv).length === 0) return;
  out.gap();
  out.fixed(T.application.environment, "");
  out.data(...envTable(appEnv));
  const note = environmentNote(brief.cli, Object.keys(appEnv));
  // When the base has env, it already said to leave the defaults alone (the note's last line).
  const unsaid = Object.keys(baseEnv).length > 0 ? note.slice(0, -1) : note;
  if (unsaid.length) out.fixed("", ...unsaid);
}

function writeAfterGreen(out: BriefWriter, brief: NewBrief): void {
  const { composition, context, stack, cli } = brief;
  const reviewer =
    composition.agents.includes("claude") &&
    composition.fragments.some((fragment) => fragment.id === "claude-harness-docs");
  out.gap();
  out.fixed(...T.done.qa);
  out.gap();
  out.fixed(
    T.done.after,
    "",
    T.done.docs,
    reviewer ? T.done.reviewAgent(cli) : T.done.reviewSelf(cli),
    T.done.commit(context.git, oneLine(context.project), stack.id),
    T.done.summary,
  );
}

/** Dependency roles installed as development dependencies. */
const DEV_ROLE = /^(dev|test|.+-dev|.+-test)$/;

/**
 * The package manager step 1 can drive for a single-package stack: Bun for a Bun scripts stack,
 * uv for a uv Python stack. Go needs `go mod init <module path>` first and Rust crates need
 * features the deps list doesn't carry, so those stacks, and monorepos, get none.
 */
function installer(composition: Composition<Entry | null>) {
  const tags = composition.stack?.meta.tags ?? [];
  if (tags.includes("monorepo")) return null;
  if (tags.includes("bun") && tags.includes("scripts"))
    return { add: "bun add", dev: "bun add -d" };
  if (tags.includes("python") && composition.stack?.meta.tools.includes("uv"))
    return { add: "uv add", dev: "uv add --dev" };
  return null;
}

/**
 * Step 1's install commands, built from the declared package names (never versions): one add
 * for development roles and one for the rest. Other stacks get none and the brief points at the
 * list.
 */
export function installCommands(composition: Composition<Entry | null>): string[] {
  const command = installer(composition);
  if (command === null) return [];
  const runtime = packageNames(composition, false);
  const dev = packageNames(composition, true).filter((name) => !runtime.includes(name));
  return [
    ...(runtime.length ? [`${command.add} ${runtime.map(shellQuoted).join(" ")}`] : []),
    ...(dev.length ? [`${command.dev} ${dev.map(shellQuoted).join(" ")}`] : []),
  ];
}

/** Distinct package names of the development roles (`dev`) or the other roles, in order. */
function packageNames(composition: Composition<Entry | null>, dev: boolean): string[] {
  const deps = composition.deps.filter((dep) => DEV_ROLE.test(dep.role) === dev);
  return [...new Set(deps.flatMap((dep) => dep.names))];
}

/** A package name as one shell word: plain names as they are, anything else single-quoted. */
function shellQuoted(name: string): string {
  return /^[@\w./-]+$/.test(name) ? name : `'${name.replaceAll("'", "'\\''")}'`;
}
