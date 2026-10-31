// Enforce the workspace boundaries before writing TypeScript.
//
//   packages/contract/src   imports only effect (and its own files); no runtime, env or console
//   apps/api/src            Node, Bun, @effect/platform-node and process (env included) only in
//                           platform/, so config.ts reads through Effect Config and the runtime
//                           swaps without touching it; no console; Schema from effect
//   apps/web/src            never imports the API; no hand-written fetch outside lib/; env
//                           through import.meta.env in lib/config.ts
//   everywhere              no zod or @effect/schema
import { isAbsolute, resolve } from "node:path";
import { deny, projectRoot, readPayload, text, writtenText } from "./_lib";

type Workspace = "contract" | "api" | "web";
type Target = { workspace: Workspace; file: string };

const WORKSPACES: Record<string, Workspace> = {
  "packages/contract": "contract",
  "apps/api": "api",
  "apps/web": "web",
};

/** The written text as lines, without `//` comments and JSDoc/block-comment lines. */
function codeLines(written: string): string[] {
  return written
    .split("\n")
    .filter((line) => !/^[ \t]*(\/\*|\*)/.test(line))
    .map((line) => line.replace(/(^|[ \t])\/\/.*$/, ""));
}

/** Which workspace's src/ the file is in, and its path under src/; else undefined. The last match
 * wins, so a checkout under .claude/worktrees/ resolves to its own workspace. */
function targetOf(filePath: string): Target | undefined {
  if (!/\.tsx?$/.test(filePath) || /\.test\.tsx?$/.test(filePath)) return undefined;
  const abs = isAbsolute(filePath) ? filePath : resolve(projectRoot(), filePath);
  const matches = [
    ...abs.matchAll(/(?:^|\/)(packages\/contract|apps\/api|apps\/web)\/src\/(.+)$/g),
  ];
  const last = matches.at(-1);
  const workspace = last?.[1] === undefined ? undefined : WORKSPACES[last[1]];
  return workspace && last?.[2] ? { workspace, file: last[2] } : undefined;
}

const PLATFORM_IMPORT =
  /(?:from|import)\s*\(?\s*["'](?:node:[^"']+|bun(?:[:/][^"']*)?|@effect\/platform-(?:node|bun)[^"']*)["']/;
const SCHEMA_IMPORT =
  /(?:from|import)\s*\(?\s*["'](?:zod(?:\/[^"']*)?|@effect\/schema(?:\/[^"']*)?)["']/;
const PROCESS_USE =
  /(^|[^\w$.])(?:globalThis\.)?(?:Bun|process)\.(?!env\b)\w|=\s*(?:globalThis\.)?process\s*;?\s*$/;
const PROCESS_ENV = /(^|[^\w$.])process\.env\b/;
const CONSOLE = /(^|[^\w$.])console\.\w+\s*\(/;

type Has = (re: RegExp) => boolean;

function contractReasons(has: Has, _file: string, lines: string[]): string[] {
  const reasons: string[] = [];
  const bare = lines.flatMap((line) =>
    [...line.matchAll(/(?:from|import)\s*\(?\s*["']([^"'.][^"']*)["']/g)].map((m) => m[1] ?? ""),
  );
  if (bare.some((spec) => spec !== "effect" && !spec.startsWith("effect/")))
    reasons.push("imports a package other than effect; the contract runs in Node and the browser");
  if (has(PROCESS_USE) || has(PROCESS_ENV)) reasons.push("uses the process or Bun global");
  if (has(CONSOLE)) reasons.push("calls console.*");
  return reasons;
}

function apiReasons(has: Has, file: string): string[] {
  const platformSide = file.startsWith("platform/");
  const reasons: string[] = [];
  if (!platformSide && has(PLATFORM_IMPORT))
    reasons.push(
      "imports a runtime (node:*, bun or @effect/platform-*) outside src/platform/; use Effect's FileSystem, Path and HttpClient services",
    );
  if (!platformSide && has(PROCESS_USE))
    reasons.push("uses the Bun or process global outside src/platform/");
  if (!platformSide && has(PROCESS_ENV))
    reasons.push(
      "reads process.env outside src/platform/; config.ts reads through Effect Config, and platform/node.ts provides ConfigProvider.fromEnv()",
    );
  if (has(CONSOLE)) reasons.push("calls console.*; use Effect.log* with annotations");
  return reasons;
}

function webReasons(has: Has, file: string): string[] {
  const reasons: string[] = [];
  if (
    has(
      /(?:from|import)\s*\(?\s*["'](?:@[\w-]+\/api(?:\/[^"']*)?|[^"']*apps\/api\/[^"']*|(?:\.\.\/)+api\/[^"']*)["']/,
    )
  )
    reasons.push("imports the API; the site depends on the contract only");
  if (has(PLATFORM_IMPORT)) reasons.push("imports a server runtime into the site");
  if (has(PROCESS_ENV) || has(PROCESS_USE))
    reasons.push("uses process; read PUBLIC_ env through import.meta.env in lib/config.ts");
  if (!file.startsWith("lib/") && has(/(^|[^\w$.])fetch\s*\(/))
    reasons.push("calls fetch by hand; call the API through the client in lib/api.ts");
  return reasons;
}

const CHECKS: Record<Workspace, (has: Has, file: string, lines: string[]) => string[]> = {
  contract: contractReasons,
  api: apiReasons,
  web: webReasons,
};

function reasonsFor({ workspace, file }: Target, lines: string[]): string[] {
  const has = (pattern: RegExp) => lines.some((line) => pattern.test(line));
  const reasons = CHECKS[workspace](has, file, lines);
  if (has(SCHEMA_IMPORT))
    reasons.push("imports a competing schema library; use Schema from effect");
  return reasons;
}

const RULES: Record<Workspace, string> = {
  contract: "docs/guidance/astro-fullstack/effect-api.md",
  api: "docs/guidance/astro-fullstack/effect-api.md",
  web: "docs/guidance/astro-fullstack/astro.md",
};

const payload = readPayload();
const filePath = text(payload?.tool_input?.file_path);
const target = filePath ? targetOf(filePath) : undefined;
if (target !== undefined) {
  const written = writtenText(payload?.tool_input);
  const reasons = written ? reasonsFor(target, codeLines(written)) : [];
  if (reasons.length)
    deny(
      `BLOCKED: ${target.file} (${target.workspace}) ${reasons.join("; ")}. See ${RULES[target.workspace]}.`,
    );
}
