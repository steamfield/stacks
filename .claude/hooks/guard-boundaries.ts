// Enforce the CLI's platform and output boundaries before writing TypeScript under packages/cli/src/.
// Other workspace packages (the API, the MCP server) get their own rules, not these.
import { dirname, isAbsolute, posix, resolve } from "node:path";
import { deny, findUp, projectRoot, readPayload, text, writtenText } from "./_lib";

/** The written text as lines, without `//` comments and JSDoc/block-comment lines. */
function codeLines(written: string): string[] {
  return written
    .split("\n")
    .filter((line) => !/^[ \t]*(\/\*|\*)/.test(line))
    .map((line) => line.replace(/(^|[ \t])\/\/.*$/, ""));
}

/** The path under packages/cli/src/ ("core/health.ts"); else undefined. */
function srcPath(filePath: string): string | undefined {
  if (!/\.tsx?$/.test(filePath)) return undefined;
  const abs = isAbsolute(filePath) ? filePath : resolve(projectRoot(), filePath);
  // The nearest package root above the file: packages/cli in the repo or in a worktree under
  // .claude/worktrees/. .claude/ counts too, so the guard holds in a fresh checkout before
  // packages/cli/package.json exists.
  const pkg = findUp(dirname(abs), "package.json", ".claude");
  if (!pkg) return undefined;
  const rel = abs.slice(pkg.length + 1);
  if (pkg.endsWith("/packages/cli")) return rel.startsWith("src/") ? rel.slice(4) : undefined;
  return rel.startsWith("packages/cli/src/") ? rel.slice("packages/cli/src/".length) : undefined;
}

const outsidePlatform = (file: string) => file !== "bin.ts" && !file.startsWith("platform/");
const outside =
  (...allowed: string[]) =>
  (file: string) =>
    !allowed.includes(file);
const everywhere = () => true;

/** Each boundary: where it applies, what code breaks it, and the reason the guard gives. */
const RULES: ReadonlyArray<{
  applies: (file: string) => boolean;
  pattern: RegExp;
  reason: string;
}> = [
  {
    applies: outsidePlatform,
    pattern: /(?:from|import)\s*\(?\s*["'](?:bun(?:[:/][^"']*)?|@effect\/platform-bun[^"']*)["']/,
    reason: "imports Bun outside an explicit platform boundary; use Effect platform services",
  },
  {
    applies: outsidePlatform,
    pattern: /(^|[^\w$.])Bun\.\w/,
    reason: "uses the Bun global outside an explicit platform boundary",
  },
  {
    applies: outsidePlatform,
    pattern:
      /(?:from|import)\s*\(?\s*["'](?:node:child_process|child_process|node:process|@effect\/platform-node[^"']*)["']/,
    reason: "imports Node process APIs outside bin.ts and src/platform/; use Processes",
  },
  {
    applies: outsidePlatform,
    pattern:
      /(^|[^\w$.])process\.(?:kill|on|once|off|addListener|removeListener|prependListener|prependOnceListener|exit)\s*\(/,
    reason: "calls a Node process API outside bin.ts and src/platform/; use Processes",
  },
  {
    applies: outside("config.ts", "bin.ts"),
    pattern: /(^|[^\w$.])process\.env\b/,
    reason: "reads process.env outside config.ts",
  },
  {
    applies: everywhere,
    pattern: /(^|[^\w$.])console\.\w+\s*\(/,
    reason: "calls console.*; results belong to Output and diagnostics to the logger",
  },
  {
    applies: outside("bin.ts"),
    pattern: /(^|[^\w$.])process\.stdout\b/,
    reason: "uses process.stdout outside bin.ts",
  },
  {
    applies: outside("bin.ts", "config.ts", "logging.ts"),
    pattern: /(^|[^\w$.])process\.stderr\b/,
    reason: "uses process.stderr outside the output/logging boundary",
  },
  {
    applies: everywhere,
    pattern: /(?:from|import)\s*\(?\s*["'](?:zod(?:\/[^"']*)?|@effect\/schema(?:\/[^"']*)?)["']/,
    reason: "imports a competing schema library; use Schema from effect",
  },
];

// Mirrors the core/services rules in packages/cli/biome-plugins/boundaries.grit.
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
const BUILTIN =
  /^(?:node:.*|(?:assert|async_hooks|buffer|child_process|cluster|console|constants|crypto|dgram|diagnostics_channel|dns|domain|events|fs|http|http2|https|inspector|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|sea|sqlite|stream|string_decoder|sys|test|timers|tls|trace_events|tty|url|util|v8|vm|wasi|worker_threads|zlib)(?:\/.*)?)$/;
/** The one builtin each file may import, for deterministic utilities and atomic rmdir. */
const BUILTIN_ALLOWED: Readonly<Record<string, string>> = {
  "core/manifest.ts": "node:crypto",
  "core/fingerprint.ts": "node:crypto",
  "core/search/digest.ts": "node:crypto",
  "services/output.ts": "node:util",
  "core/scaffold/write.ts": "node:fs/promises",
};

/** A relative import from `file` that lands in platform/ or commands/; Processes' own import is allowed. */
function crossesLayer(file: string, line: string, spec: string): boolean {
  if (!spec.startsWith(".")) return false;
  const target = posix.join(posix.dirname(file), spec);
  if (!/^(?:platform|commands)\//.test(target)) return false;
  const processPort =
    file === "services/processes.ts" &&
    /^\s*import\b/.test(line) &&
    /^platform\/process(?:\.ts)?$/.test(target);
  return !processPort;
}

const builtinDenied = (file: string, spec: string) =>
  BUILTIN.test(spec) && !(Object.hasOwn(BUILTIN_ALLOWED, file) && BUILTIN_ALLOWED[file] === spec);

function layerReasons(file: string, lines: string[]): string[] {
  if (!/^(?:core|services)\//.test(file)) return [];
  const reasons = new Set<string>();
  for (const line of lines)
    for (const [, spec = ""] of line.matchAll(SPECIFIER)) {
      if (crossesLayer(file, line, spec))
        reasons.add(
          "imports platform/ or commands/ from core or services; use an injected service",
        );
      if (builtinDenied(file, spec))
        reasons.add("imports a Node builtin in core or services; use Effect services");
    }
  return [...reasons];
}

function reasonsFor(file: string, lines: string[]): string[] {
  return RULES.filter((rule) => rule.applies(file) && lines.some((line) => rule.pattern.test(line)))
    .map((rule) => rule.reason)
    .concat(layerReasons(file, lines));
}
const payload = readPayload();
const filePath = text(payload?.tool_input?.file_path);
const file = filePath ? srcPath(filePath) : undefined;
if (file !== undefined) {
  const written = writtenText(payload?.tool_input);
  const reasons = written ? reasonsFor(file, codeLines(written)) : [];
  if (reasons.length)
    deny(`BLOCKED: packages/cli/src/${file} ${reasons.join("; ")}. See .claude/rules/cli/cli.md.`);
}
