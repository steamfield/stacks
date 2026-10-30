/**
 * Credential shapes `validate --submission` refuses, after the repo's secret guard: high-confidence
 * formats only, so false positives stay rare. `loose` patterns also match documentation, so a line
 * that reads like a placeholder is let through. A pattern scan misses things; it backs up the
 * author's own pass and maintainer review, it doesn't replace them.
 */
const SECRET_PATTERNS: ReadonlyArray<{ what: string; re: RegExp; loose?: true }> = [
  { what: "an AWS access key ID", re: /AKIA[0-9A-Z]{16}/ },
  {
    what: "an AWS secret access key",
    re: /aws_secret_access_key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/i,
  },
  { what: "a GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36}|\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  { what: "a Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { what: "an Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, loose: true },
  { what: "an OpenAI-style API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/, loose: true },
  { what: "a private key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  {
    what: "a long literal assigned to a secret-looking name",
    re: /(?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i,
    loose: true,
  },
];

/** Values that only look like credentials: documentation placeholders. */
const PLACEHOLDER =
  /your[-_]|changeme|replace|example|placeholder|xxxx|fake|dummy|redacted|<[^>]*>/i;

/** What credential a line looks like it holds, or `undefined`. Never returns the matched text. */
export function secretIn(line: string): string | undefined {
  return SECRET_PATTERNS.find(
    ({ re, loose }) => re.test(line) && !(loose && PLACEHOLDER.test(line)),
  )?.what;
}

/** An absolute path into one person's home directory, or a Windows drive path. */
export const ABSOLUTE_PATH = /(?:^|[^\w])\/(?:Users|home)\/[A-Za-z0-9._-]+\/|\b[A-Za-z]:\\/;

/** Environment files an entry must not ship; `.env.example` (and its template) holds placeholders. */
export function isEnvFile(name: string): boolean {
  return /^\.env(?:\..*)?$/.test(name) && name !== ".env.example" && name !== ".env.example.tmpl";
}

export const FILL_MARKER = "stacks:fill";
