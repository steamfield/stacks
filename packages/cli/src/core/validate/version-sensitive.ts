/**
 * Warns when a config file an entry ships pins a tool version, when `stacks validate` runs.
 *
 * Stacks ship files such as `package.json`, `tsconfig.json`, a Dockerfile or a CI workflow, but
 * never the versions inside them: versions age, and the agent building the project picks current
 * ones (`.claude/rules/architecture.md`, "Humans own what lasts and agents own what ages"). This
 * check looks only at files whose format is tied to a tool's version (`VERSION_SENSITIVE`) and
 * reports the first version literal in each (`version-sensitive-file`). A literal is a pinned
 * `x.y.z` (`dated.ts::PINNED`), a semver range such as `^5` or `>=18`, a GitHub Action pinned by
 * tag or commit, a Go toolchain line, or a `"packageManager"` or `"engines"` key, which only ever
 * holds versions.
 *
 * Two places hold the project's own version rather than a tool's and are exempt: the leading
 * `"version"` of a `package.json` and the `<version>` directly under a Maven pom's `<project>`.
 *
 * `core/validate/index.ts` runs `versionSensitiveChecks`.
 */
import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import { PINNED } from "./dated";
import type { Check } from "./types";
import { finding } from "./view";

/** Project-relative names whose formats belong to the agent's current tool versions. */
const VERSION_SENSITIVE = [
  /(?:^|\/)(?:tsconfig\.json|package\.json|pyproject\.toml|go\.mod|Cargo\.toml)$/,
  /(?:^|\/)(?:astro|vite|vitest|jest|playwright|openapi-ts|orval)\.config\.[^/]+$/,
  /(?:^|\/)(?:biome\.jsonc?|\.eslintrc[^/]*|eslint\.config\.[^/]+|\.golangci\.ya?ml|pytest\.ini)$/,
  /(?:^|\/)(?:Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/,
  /(?:^|\/)\.github\/workflows\/[^/]+$/,
  /(?:^|\/)(?:\.goreleaser\.ya?ml|release-please-config\.json|openapitools\.json)$/,
  /(?:^|\/)\.changeset\/config\.json$/,
  /(?:^|\/)(?:pom\.xml|(?:build|settings)\.gradle(?:\.kts)?)$/,
  /(?:^|\/)gradle\/libs\.versions\.toml$/,
  /(?:^|\/)(?:\.mvn\/wrapper\/maven-wrapper|gradle\/wrapper\/gradle-wrapper)\.properties$/,
];

/** Any version literal: pinned, a range, an Action ref, or a Go toolchain directive. */
const VERSION_LITERAL = new RegExp(
  [
    PINNED.source,
    /(?:\^|~|[<>]=?)\d+(?:\.\d+)*(?:[-+][\w.-]+)*/.source,
    /\buses:[ \t]*["']?[\w.-]+\/[\w./-]+@(?:v\d[\w.-]*|[\da-fA-F]{40}\b)/.source,
    /^[ \t]*(?:go[ \t]+1\.\d+|toolchain[ \t]+go1\.\d+)(?:\.\d+)*\b/.source,
  ].join("|"),
  "m",
);

/**
 * Comments, JSON strings, and the `"packageManager"` and `"engines"` keys (capture group 1).
 * Matching comments and strings as whole tokens keeps those key names from matching inside them.
 */
const VERSION_KEY =
  /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|("(?:packageManager|engines)")(?=\s*:)|"(?:[^"\\]|\\.)*"/g;

/** The first version literal or version key in the text, whichever comes first. */
function firstVersion(text: string): string | undefined {
  const version = VERSION_LITERAL.exec(text);
  for (const token of text.matchAll(VERSION_KEY)) {
    if (version && token.index >= version.index) break;
    if (token[1]) return token[1];
  }
  return version?.[0];
}

const POM_ELEMENT = /<([\w.-]+)\b[^>]*?(?<!\/)>[\s\S]*?<\/\1\s*>/g;
const POM_VERSION =
  /<(version|release|maven\.compiler\.(?:release|source|target)|[\w.-]+\.version)\s*>\s*(\d[^<]*?)\s*<\/\1\s*>/;

/** The first version a pom's `<project>` children set, outside comments. */
function firstPomVersion(text: string): string | undefined {
  const uncommented = text.replace(/<!--[\s\S]*?-->/g, "");
  const project = /<project\b[^>]*>([\s\S]*?)<\/project\s*>/.exec(uncommented)?.[1] ?? "";
  // Inspect project children separately so the project's own version stays exempt.
  for (const child of project.matchAll(POM_ELEMENT)) {
    if (child[1] === "version") continue;
    const literal = POM_VERSION.exec(child[0])?.[2];
    if (literal) return literal;
  }
  return undefined;
}

/** The package's own `version`, like a pom's, is exempt: it versions the project, not a tool. */
const OWN_VERSION = /^\{\s*(?:"[^"]*"\s*:\s*"[^"]*"\s*,\s*)*?"version"\s*:\s*"[^"]*"/;

/** The version literal to report for a file, by its project path, or undefined when it has none. */
function fileVersion(output: string, text: string): string | undefined {
  if (/(?:^|\/)pom\.xml$/.test(output)) return firstPomVersion(text);
  if (/(?:^|\/)package\.json$/.test(output))
    return firstVersion(text.replace(OWN_VERSION, (head) => head.replace(/"[^"]*"$/, '""')));
  return firstVersion(text);
}

export const versionSensitiveChecks: Check = (view) =>
  Effect.sync(() => {
    const findings: Finding[] = [];
    for (const entry of view.entries)
      for (const file of view.sources.get(entry.dir)?.files ?? []) {
        // Templates are judged by the name they render to.
        const output = file.path.replace(/\.tmpl$/, "");
        if (!VERSION_SENSITIVE.some((pattern) => pattern.test(output))) continue;
        const literal = fileVersion(output, file.text);
        if (!literal) continue;
        findings.push(
          finding(entry, {
            check: "version-sensitive-file",
            severity: "warning",
            file: view.file(entry, file.source),
            message: `${output} contains ${literal}; remove the version and let the agent pick current versions`,
          }),
        );
      }
    return { findings };
  });
