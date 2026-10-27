export type Parsed = {
  readonly target: string;
  readonly out?: string;
  readonly label?: string;
  readonly sarif: readonly string[];
  readonly tool: readonly string[];
  readonly exclude: readonly string[];
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
};

export type ParseResult =
  | { readonly ok: true; readonly parsed: Parsed }
  | { readonly ok: false; readonly reason: string };

const VALUE_FLAGS = new Set(["--out", "--label", "--sarif", "--tool", "--exclude"]);

const HELP = `Usage: analyze <path> [options]

Run static analysis over a directory and write one SARIF 2.1.0 log.

Arguments:
  <path>                 Directory to analyze (defaults to the current directory).

Options:
  --out <file>           Write the record to <file> instead of stdout.
  --label <string>       Label attribution when no manifest is present.
  --sarif <file>         Adopt a SARIF log produced elsewhere (repeatable).
  --tool <id>            Run only the named tool adapter id (repeatable).
  --exclude <glob>       Exclude paths matching the glob (repeatable).
  --json                 Emit JSON (default; accepted for symmetry).
  --help                 Show this help and exit.
  --version              Show the version and exit.

Exit codes:
  0  A record was written.
  2  Usage or input error.
  1  Unexpected defect.
`;

export function helpText(): string {
  return HELP;
}

export function parse(args: readonly string[]): ParseResult {
  const sarif: string[] = [];
  const tool: string[] = [];
  const exclude: string[] = [];
  let out: string | undefined;
  let label: string | undefined;
  let json = false;
  let help = false;
  let version = false;
  let target: string | undefined;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      i += 1;
      continue;
    }
    if (arg === "--help") {
      help = true;
      i += 1;
      continue;
    }
    if (arg === "--version") {
      version = true;
      i += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      i += 1;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        return { ok: false, reason: `Flag ${arg} requires a value.` };
      }
      switch (arg) {
        case "--out":
          out = next;
          break;
        case "--label":
          label = next;
          break;
        case "--sarif":
          sarif.push(next);
          break;
        case "--tool":
          tool.push(next);
          break;
        case "--exclude":
          exclude.push(next);
          break;
      }
      i += 2;
      continue;
    }
    if (arg.startsWith("--")) {
      return { ok: false, reason: `Unknown flag: ${arg}` };
    }
    if (target === undefined) {
      target = arg;
    } else {
      return { ok: false, reason: `Unexpected positional argument: ${arg}` };
    }
    i += 1;
  }

  if (help || version) {
    return {
      ok: true,
      parsed: {
        target: target ?? ".",
        out,
        label,
        sarif,
        tool,
        exclude,
        json,
        help,
        version,
      },
    };
  }

  if (target === undefined) {
    return { ok: false, reason: "A target path is required." };
  }

  return {
    ok: true,
    parsed: { target, out, label, sarif, tool, exclude, json, help, version },
  };
}
