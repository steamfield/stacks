// PostToolUse (Edit|Write) on a .ts/.tsx file: type-check the file's package and hand any errors
// back to the agent as additionalContext, so a type error shows up right after the edit that
// caused it instead of at `bun run typecheck` time. The package is the nearest directory above
// the file, up to the project root, with node_modules/.bin/tsc; tsc runs there with its
// tsconfig.json.
//
// Advisory: never blocks. tsc runs incrementally (build info under node_modules/.cache/), about
// 1.5s after the first run. Errors in the written file come first; errors elsewhere are included
// because an edit can break the files that use it. tsc not installed, timed out, or crashed: no
// output. tsc gets 40s, under the hook's 60s timeout in settings.json.
import { realpathSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import {
  addContext,
  findUp,
  isExecutable,
  isFile,
  projectRoot,
  readPayload,
  run,
  stripControl,
  text,
} from "./_lib";

// An error is a `path(line,col): error TS...` line plus indented continuation lines.
const ERROR_LINE = /^[^ ].*\([0-9]+,[0-9]+\): error /;
const MAX_LINES = 40;

/** The error blocks (error line plus continuations) for which `keep(errorLine)` holds. */
function errorBlocks(lines: string[], keep: (line: string) => boolean): string[] {
  let keeping = false;
  return lines.filter((line) => {
    if (ERROR_LINE.test(line)) keeping = keep(line);
    return keeping;
  });
}

const SKIPPED_DIRS = ["node_modules/", "dist/", "coverage/", "build/", ".react-router/"];

type Target = { root: string; pkg: string; file: string; rel: string };

/** The project root, the written file's package and its path there, or undefined to stay quiet. */
function resolveTarget(given: string): Target | undefined {
  let root: string;
  let fileDir: string;
  try {
    root = realpathSync(projectRoot());
    fileDir = realpathSync(dirname(given));
  } catch {
    return undefined;
  }
  if (!`${fileDir}/`.startsWith(`${root}/`)) return undefined;
  // The package is the nearest directory with its own tsc, walking up from the file and stopping
  // at the root: the root itself in a one-package project, `frontend/` for an app kept there.
  const pkg = findUp(fileDir, "node_modules/.bin/tsc");
  if (pkg === undefined || !`${pkg}/`.startsWith(`${root}/`)) return undefined;
  if (!isExecutable(join(pkg, "node_modules/.bin/tsc")) || !isFile(join(pkg, "tsconfig.json")))
    return undefined;
  const file = join(fileDir, basename(given));
  // tsc prints paths relative to the package it runs in; match that.
  const rel = relative(pkg, file);
  if (SKIPPED_DIRS.some((dir) => rel.startsWith(dir))) return undefined;
  return { root, pkg, file, rel };
}

async function main(): Promise<void> {
  const given = text(readPayload()?.tool_input?.file_path);
  if (!(given.endsWith(".ts") || given.endsWith(".tsx")) || !isFile(given)) return;
  const target = resolveTarget(given);
  if (target === undefined) return;
  const { root, pkg, file, rel } = target;
  const tsc = join(pkg, "node_modules/.bin/tsc");

  const prepare = join(root, ".claude/hooks/before-typecheck.ts");
  if (isFile(prepare)) {
    await run("bun", [prepare, relative(root, file)], { cwd: root, timeoutSec: 15 });
  }

  const { code, output } = await run(
    tsc,
    [
      "--noEmit",
      "--pretty",
      "false",
      "--incremental",
      "--tsBuildInfoFile",
      "node_modules/.cache/tsc/hook.tsbuildinfo",
    ],
    { cwd: pkg, timeoutSec: 40 },
  );
  // 0: clean. 1/2: type errors. Anything else (timeout 124, a crash): say nothing.
  if (code !== 1 && code !== 2) return;
  const lines = stripControl(output).replace(/\n+$/, "").split("\n");

  const mineFirst = (line: string) => line.startsWith(`${rel}(`);
  const mine = errorBlocks(lines, mineFirst);
  const others = errorBlocks(lines, (line) => !mineFirst(line));
  const total = lines.filter((line) => ERROR_LINE.test(line)).length;
  const here = mine.filter((line) => ERROR_LINE.test(line)).length;
  if (total === 0) return;

  let body = [...mine, ...others].filter((line) => line !== "");
  if (body.length > MAX_LINES) {
    body = [...body.slice(0, MAX_LINES), "... (truncated; run bun run typecheck for the rest)"];
  }
  const tool = pkg === root ? "tsc" : `tsc in ${relative(root, pkg)}/`;
  const message =
    here > 0
      ? `${tool} found ${total} type error(s), ${here} in ${rel}. Fix the ones in this file now; errors in other files may be from an edit still in progress:`
      : `${tool} found ${total} type error(s) in other files (none in ${rel}). Either an edit is still in progress, or this edit broke code that uses it:`;
  addContext(`${message}\n${body.join("\n")}`);
}

await main();
