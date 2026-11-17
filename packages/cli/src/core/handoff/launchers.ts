/** The fixed terminal and app launchers (trust point 1). */
import type { Harness } from "@steamfield/stacks-format";

type Launcher =
  | {
      via: "terminal";
      label: string;
      bin: string;
      args: (prompt: string) => string[];
      checked?: string;
    }
  | {
      via: "app";
      label: string;
      app: string;
      url: (dir: string, prompt: string) => string;
      checked?: string;
    };

/**
 * Fixed agent launchers keep entries from choosing an executable (trust point 1). `checked`
 * records when the launcher was last verified against the agent's documentation and stays unset
 * until that check happens.
 */
export const LAUNCH_ARGS = {
  claude: {
    via: "terminal",
    label: "Claude Code",
    bin: "claude",
    args: (prompt: string) => [prompt],
  },
  codex: { via: "terminal", label: "Codex CLI", bin: "codex", args: (prompt: string) => [prompt] },
  opencode: {
    via: "terminal",
    label: "OpenCode",
    bin: "opencode",
    args: (prompt: string) => ["--prompt", prompt],
  },
  cursor: {
    via: "terminal",
    label: "Cursor CLI",
    bin: "cursor-agent",
    args: (prompt: string) => [prompt],
  },
  copilot: {
    via: "terminal",
    label: "Copilot CLI",
    bin: "copilot",
    args: (prompt: string) => ["-i", prompt],
  },
  "codex-app": {
    via: "app",
    label: "Codex app",
    app: "Codex.app",
    url: (dir: string, prompt: string) =>
      `codex://new?path=${encodeURIComponent(dir)}&prompt=${encodeURIComponent(prompt)}`,
  },
} as const satisfies Readonly<Record<Harness, Launcher>>;

/** Tried after `Settings.agents`, when `--launch` isn't given. */
export const LAUNCH_ORDER: ReadonlyArray<Harness> = [
  "claude",
  "codex",
  "opencode",
  "cursor",
  "copilot",
  "codex-app",
];
