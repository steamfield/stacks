/**
 * Checks that verify steps name declared commands and that fragments exercise the commands they
 * ship. It uses `shellTokens` for static analysis (trust point 1).
 */
import { Effect } from "effect";
import type { Finding } from "../../../schemas/validate";
import type { Composition } from "../../compose/types";
import { shellTokens, shellWords } from "../../text/shell";
import { uniqueFindings } from "../compositions/composed";
import type { Check, View } from "../types";
import { entryFile, finding } from "../view";

/**
 * The project command a shell command runs through `make`, `bun run`, `npm run`, `pnpm` or `yarn`
 * (`bun run test` gives `test`), with Claude's trailing `:*` permission wildcard dropped. Anything
 * else, or a target that is a flag, variable or shell operator, gives `undefined`.
 */
export function runnerTarget(command: string): string | undefined {
  return runnerWordTarget(shellWords(command));
}

function runnerWordTarget(words: readonly string[]): string | undefined {
  const target = runnerOperand(words);
  if (!target || /^[-$;&|()<>]/.test(target)) return undefined;
  return target.replace(/:\*$/, "");
}

function runnerOperand(words: readonly string[]): string | undefined {
  const [runner, second] = words;
  if (runner === "make") return second;
  if ((runner === "bun" || runner === "npm") && second === "run") return words[2];
  if (runner === "pnpm" || runner === "yarn") return words[second === "run" ? 2 : 1];
  return undefined;
}

/** The runner target of each command in a line split at `;`, `&`, `|`, parentheses and newlines. */
function runnerTargets(command: string): string[] {
  return simpleCommands(command).flatMap((words) => runnerWordTarget(words) ?? []);
}

function simpleCommands(command: string): string[][] {
  const commands: string[][] = [[]];
  for (const token of shellTokens(command)) {
    if (token.operator && /[;&|()\n]/.test(token.word)) commands.push([]);
    else commands.at(-1)?.push(token.word);
  }
  return commands;
}

export const commandChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    for (const { composition } of (yield* view.composed).snapshots)
      findings.push(
        ...undeclaredStepCommands(view, composition),
        ...unrunFragmentCommands(view, composition),
      );
    return { findings: uniqueFindings(findings) };
  });

/** Whether the entry at `dir` is in the validated set, so findings about it are reported. */
const isValidated = (view: View, dir: string) => view.entries.some((entry) => entry.dir === dir);

function undeclaredStepCommands(view: View, composition: Composition): Finding[] {
  const entries = [composition.stack, ...composition.fragments];
  const findings: Finding[] = [];
  for (const step of composition.verify) {
    const target = runnerTarget(step.run);
    if (!target || Object.hasOwn(composition.commands, target)) continue;
    const owner = entries.find(
      (entry) => entry.kind === step.owner.kind && entry.id === step.owner.id,
    );
    if (!owner || !isValidated(view, owner.dir)) continue;
    findings.push(
      finding(owner, {
        check: "undeclared-command",
        severity: "warning",
        file: entryFile(view, owner),
        message: `${composition.stack.id}: verify step ${step.name} runs ${target}, which is missing from the composed commands table`,
      }),
    );
  }
  return findings;
}

/**
 * Fragment commands need a verify step so there is evidence they work. The stack is responsible
 * for proving commands it also declares.
 */
function unrunFragmentCommands(view: View, composition: Composition): Finding[] {
  const ran = new Set(composition.verify.flatMap((step) => runnerTargets(step.run)));
  const findings: Finding[] = [];
  for (const fragment of composition.fragments) {
    if (!isValidated(view, fragment.dir)) continue;
    for (const command of Object.keys(fragment.meta.commands)) {
      if (ran.has(command) || Object.hasOwn(composition.stack.meta.commands, command)) continue;
      findings.push(
        finding(fragment, {
          check: "ref-command-coverage",
          severity: "warning",
          file: entryFile(view, fragment),
          message: `command ${command} is a deliverable in the commands table, but no verify step runs it`,
        }),
      );
    }
  }
  return findings;
}
