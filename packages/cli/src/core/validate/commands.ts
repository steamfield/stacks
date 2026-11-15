import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import type { Composition } from "../compose/types";
import { shellTokens, shellWords } from "../shell";
import { uniqueFindings } from "./composed";
import type { Check } from "./types";
import { entryFile, finding } from "./view";

/** A complete project-command token, with Claude's permission wildcard removed separately. */
export function runnerTarget(command: string): string | undefined {
  return runnerWordTarget(shellWords(command));
}

function runnerWordTarget(words: readonly string[]): string | undefined {
  const [runner, second] = words;
  let target: string | undefined;
  if (runner === "make") target = second;
  else if ((runner === "bun" || runner === "npm") && second === "run") target = words[2];
  else if (runner === "pnpm" || runner === "yarn") target = words[second === "run" ? 2 : 1];
  if (!target || /^[-$;&|()<>]/.test(target)) return undefined;
  return target.replace(/:\*$/, "");
}

function runnerTargets(command: string): string[] {
  const targets: string[] = [];
  let words: string[] = [];
  const finish = () => {
    const target = runnerWordTarget(words);
    if (target) targets.push(target);
    words = [];
  };
  for (const token of shellTokens(command)) {
    if (token.operator && /[;&|()\n]/.test(token.word)) finish();
    else words.push(token.word);
  }
  finish();
  return targets;
}

export const commandChecks: Check = (view) =>
  Effect.gen(function* () {
    const findings: Finding[] = [];
    const checkSteps = (composition: Composition) => {
      const entries = [composition.stack, ...composition.fragments];
      for (const step of composition.verify) {
        const target = runnerTarget(step.run);
        if (!target || Object.hasOwn(composition.commands, target)) continue;
        const owner = entries.find(
          (entry) => entry.kind === step.owner.kind && entry.id === step.owner.id,
        );
        if (!owner || !view.entries.some((entry) => entry.dir === owner.dir)) continue;
        findings.push(
          finding(owner, {
            check: "undeclared-command",
            severity: "warning",
            file: entryFile(view, owner),
            message: `${composition.stack.id}: verify step ${step.name} runs ${target}, which is missing from the composed commands table`,
          }),
        );
      }
    };
    const checkCoverage = (composition: Composition) => {
      const ran = new Set(composition.verify.flatMap((step) => runnerTargets(step.run)));
      const checkFragment = (fragment: Composition["fragments"][number]) => {
        if (!view.entries.some((entry) => entry.dir === fragment.dir)) return;
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
      };
      for (const fragment of composition.fragments) checkFragment(fragment);
    };
    for (const { composition } of (yield* view.composed).snapshots) {
      checkSteps(composition);
      checkCoverage(composition);
    }
    return { findings: uniqueFindings(findings) };
  });
