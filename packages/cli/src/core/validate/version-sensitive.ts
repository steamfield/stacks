import { Effect } from "effect";
import type { Finding } from "../../schemas/validate";
import { PINNED } from "./dated";
import { type Check, finding } from "./view";

/** Project-relative names whose formats belong to the agent's current tool versions. */
const VERSION_SENSITIVE = [
  /(?:^|\/)(?:tsconfig\.json|package\.json|pyproject\.toml|go\.mod|Cargo\.toml)$/,
  /(?:^|\/)(?:astro|vite|vitest|jest|playwright|openapi-ts|orval)\.config\.[^/]+$/,
  /(?:^|\/)(?:biome\.jsonc?|\.eslintrc[^/]*|eslint\.config\.[^/]+|\.golangci\.ya?ml|pytest\.ini)$/,
  /(?:^|\/)(?:Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/,
  /(?:^|\/)\.github\/workflows\/[^/]+$/,
  /(?:^|\/)(?:\.goreleaser\.ya?ml|release-please-config\.json|openapitools\.json)$/,
  /(?:^|\/)\.changeset\/config\.json$/,
];

const VERSION_LITERAL = new RegExp(
  [
    PINNED.source,
    /(?:\^|~|[<>]=?)\d+(?:\.\d+)*(?:[-+][\w.-]+)*/.source,
    /\buses:[ \t]*["']?[\w.-]+\/[\w./-]+@(?:v\d[\w.-]*|[\da-fA-F]{40}\b)/.source,
    /^[ \t]*(?:go[ \t]+1\.\d+|toolchain[ \t]+go1\.\d+)(?:\.\d+)*\b/.source,
  ].join("|"),
  "m",
);
const VERSION_KEY =
  /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|("(?:packageManager|engines)")(?=\s*:)|"(?:[^"\\]|\\.)*"/g;

function firstVersion(text: string): string | undefined {
  const version = VERSION_LITERAL.exec(text);
  for (const token of text.matchAll(VERSION_KEY)) {
    if (version && token.index >= version.index) break;
    if (token[1]) return token[1];
  }
  return version?.[0];
}

export const versionSensitiveChecks: Check = (view) =>
  Effect.sync(() => {
    const findings: Finding[] = [];
    for (const entry of view.entries)
      for (const file of view.sources.get(entry.dir)?.files ?? []) {
        const output = file.path.replace(/\.tmpl$/, "");
        if (!VERSION_SENSITIVE.some((pattern) => pattern.test(output))) continue;
        const literal = firstVersion(file.text);
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
