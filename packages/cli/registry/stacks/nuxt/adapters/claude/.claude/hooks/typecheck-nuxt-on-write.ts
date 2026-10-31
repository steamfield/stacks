// PostToolUse (Edit|Write) on a .ts or .vue file: run vue-tsc over the project's references and
// hand any errors back to the agent as additionalContext.
//
// The shared typecheck-on-write hook runs plain tsc, which checks nothing here: tsconfig.json
// only references Nuxt's generated configs (and tsconfig.tools.json), and plain tsc can't read
// .vue files. This is the same check as bun run typecheck. Advisory: never blocks. When .nuxt/
// is missing it runs nuxt prepare first. vue-tsc gets 40s, under the hook's 60s timeout.
import { realpathSync } from "node:fs";
import { join, relative } from "node:path";
import {
  addContext,
  isExecutable,
  isFile,
  projectRoot,
  readPayload,
  run,
  stripControl,
  text,
} from "./_lib";

const SKIP = ["node_modules/", ".nuxt/", ".output/", ".data/", "coverage/", ".claude/worktrees/"];
const ERROR_LINE = /^.+\(\d+,\d+\): error TS/;
const MAX_LINES = 40;

async function main(): Promise<void> {
  const given = text(readPayload()?.tool_input?.file_path);
  if (!/\.(ts|mts|vue)$/.test(given) || !isFile(given)) return;
  const root = realpathSync(projectRoot());
  const written = relative(root, realpathSync(given));
  if (written.startsWith("..") || SKIP.some((dir) => written.startsWith(dir))) return;

  const vueTsc = join(root, "node_modules/.bin/vue-tsc");
  if (!isExecutable(vueTsc) || !isFile(join(root, "tsconfig.json"))) return;
  const nuxt = join(root, "node_modules/.bin/nuxt");
  if (!isFile(join(root, ".nuxt/tsconfig.app.json")) && isExecutable(nuxt)) {
    await run(nuxt, ["prepare"], { cwd: root, timeoutSec: 30 });
  }

  const result = await run(vueTsc, ["-b", "--noEmit", "--pretty", "false"], {
    cwd: root,
    timeoutSec: 40,
  });
  // 0: clean. 1/2: type errors. Anything else (timeout 124, a crash): say nothing.
  if (result.code !== 1 && result.code !== 2) return;
  const lines = stripControl(result.output).trim().split("\n");
  const errors = lines.filter((line) => ERROR_LINE.test(line));
  if (errors.length === 0) return;
  // Errors in the written file first; an edit can also break the files that use it.
  const mine = errors.filter((line) => line.startsWith(`${written}(`));
  const body = [...new Set([...mine, ...errors])];
  const shown = body.slice(0, MAX_LINES);
  if (body.length > MAX_LINES) shown.push("... (truncated; run bun run typecheck for the rest)");
  addContext(
    `vue-tsc found ${body.length} type error(s), ${mine.length} in ${written}:\n${shown.join("\n")}`,
  );
}

await main();
