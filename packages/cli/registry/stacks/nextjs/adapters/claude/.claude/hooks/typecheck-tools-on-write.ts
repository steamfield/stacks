// Next's ambient types stay out of the Node-only tools program. The shared hook checks
// the app; this companion supplies feedback for scripts, hooks and their tests.
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

async function main(): Promise<void> {
  const given = text(readPayload()?.tool_input?.file_path);
  if (!given.endsWith(".ts") || !isFile(given)) return;
  const root = realpathSync(projectRoot());
  const written = relative(root, realpathSync(given));
  if (
    !["scripts/", ".claude/hooks/", "tests/hooks/", "tests/helpers/hooks.ts"].some((prefix) =>
      written.startsWith(prefix),
    )
  )
    return;
  const tsc = join(root, "node_modules/.bin/tsc");
  if (!isExecutable(tsc) || !isFile(join(root, "tsconfig.tools.json"))) return;
  const result = await run(
    tsc,
    [
      "-p",
      "tsconfig.tools.json",
      "--noEmit",
      "--pretty",
      "false",
      "--incremental",
      "--tsBuildInfoFile",
      "node_modules/.cache/tsc/tools-hook.tsbuildinfo",
    ],
    { cwd: root, timeoutSec: 40 },
  );
  if (result.code !== 1 && result.code !== 2) return;
  const lines = stripControl(result.output).trim().split("\n");
  if (!lines.some((line) => /^.+\(\d+,\d+\): error TS/.test(line))) return;
  const diagnostic = lines.slice(0, 40);
  if (lines.length > 40) diagnostic.push("... (truncated; run bun run typecheck for the rest)");
  addContext(
    `tsc found type errors in the tools program after editing ${written}:\n${diagnostic.join("\n")}`,
  );
}

await main();
