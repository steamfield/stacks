/**
 * Credential shapes `validate --submission` refuses, after the repo's secret guard: high-confidence
 * formats only, so false positives stay rare. `loose` patterns also match documentation, so a match
 * that reads like a placeholder is let through; only the matched text is judged, never the rest of
 * the line. A pattern scan misses things; it backs up the author's own pass and maintainer review,
 * it doesn't replace them.
 */
const SECRET_PATTERNS: ReadonlyArray<{ what: string; re: RegExp; loose?: true }> = [
  { what: "an AWS access key ID", re: /AKIA[0-9A-Z]{16}/g },
  {
    what: "an AWS secret access key",
    re: /aws_secret_access_key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/gi,
  },
  { what: "a GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36}|\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { what: "a Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { what: "an Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, loose: true },
  { what: "an OpenAI-style API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/g, loose: true },
  { what: "a private key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g },
  {
    what: "a long literal assigned to a secret-looking name",
    re: /(?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/gi,
    loose: true,
  },
];

/**
 * Values that only look like credentials: documentation placeholders, and template or environment
 * references (`{{project_slug}}`, `${{ secrets.X }}`, `${X}`, `process.env.X`) that name a value
 * instead of holding one.
 */
const PLACEHOLDER =
  /your[-_]|changeme|replace|example|placeholder|xxxx|fake|dummy|redacted|<[^>]*>|\{\{|\$\{|secrets\.|process\.env/i;

/** What credential a line looks like it holds, or `undefined`. Never returns the matched text. */
export function secretIn(line: string): string | undefined {
  return SECRET_PATTERNS.find(({ re, loose }) =>
    [...line.matchAll(re)].some((match) => !(loose && PLACEHOLDER.test(match[0]))),
  )?.what;
}

/** `text` as a literal inside a regular expression. */
export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Home directories that belong to an image, a CI runner or a dev container, not a person. */
const GENERIC_HOMES = [
  "node",
  "runner",
  "vscode",
  "ubuntu",
  "codespace",
  "gitpod",
  "coder",
  "circleci",
  "app",
  "user",
  "ec2-user",
  "linuxbrew",
  "bun",
  "pwuser",
  "nonroot",
  "jovyan",
  "vagrant",
  "jenkins",
  "gitlab-runner",
];

/**
 * An absolute path that names one person's machine: a macOS home (`/Users/<name>/`, not the
 * machine-wide `/Users/Shared/`), a Linux home (`/home/<name>/`) other than the generic ones
 * above, or a Windows drive path, also as escaped in JSON (`C:\\Users`), but not a `%s:\n`
 * format string.
 */
export const ABSOLUTE_PATH = new RegExp(
  [
    "(?:^|[^\\w])/Users/(?!Shared/)[A-Za-z0-9._-]+/",
    `(?:^|[^\\w])/home/(?!(?:${GENERIC_HOMES.map(escapeRegExp).join("|")})/)[A-Za-z0-9._-]+/`,
    "(?<![\\w%])[A-Za-z]:(?:\\\\\\\\|\\\\)[A-Za-z0-9_.-]",
  ].join("|"),
);

/** Environment files that hold placeholders and may ship, each with or without `.tmpl`. */
const ENV_TEMPLATES = [".env.example", ".env.sample", ".env.template"];

/** Environment files an entry must not ship; the placeholder templates above are allowed. */
export function isEnvFile(name: string): boolean {
  return /^\.env(?:\..*)?$/.test(name) && !ENV_TEMPLATES.includes(name.replace(/\.tmpl$/, ""));
}

export const FILL_MARKER = "stacks:fill";
