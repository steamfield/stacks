# Using stacks with a coding agent

This page is for the person setting up an agent to use stacks. The agent itself never reads it: everything an agent needs is in the CLI's own output (`stacks` with no arguments, and `<command> --help`) and in the skill. This page explains how to give your agent that, and what it will do with it.

## Two ways in

You can start the project and hand it over, or let the agent start it.

If you run `stacks new <stack> <dir>` yourself, stacks writes the project and starts your agent in it with one instruction: read `.stacks/BRIEF.md` and carry it out. The [quick start](quickstart.md) covers this path. The agent needs no setup; the brief is the whole task.

If you want to say "start me a Go CLI with tests" in a chat with your agent, the agent needs to know stacks exists. That's what the skill is for.

## Install the skill

The skill is one Markdown file, under 600 words, that tells an agent when to reach for stacks and how to run it: pick a stack, write the project, follow the brief, loop on verify, never weaken verify. Claude Code loads it automatically when a request matches its description.

```sh
npx @steamfield/stacks skill install            # ~/.claude/skills/stacks/SKILL.md, for every project
npx @steamfield/stacks skill install --project  # .claude/skills/ in the current repository only
```

With a global install (`npm install -g @steamfield/stacks`), the command is `stacks skill install`. The agent doesn't need a global install either: when `stacks` isn't on its PATH, the skill tells it to run `npx -y @steamfield/stacks@latest`, and each brief names the exact command for `verify`.

Running it again is safe: an identical file is left alone, and a file you've edited is kept unless you pass `--force`.

For writing a stack or fragment of your own and submitting it to the registry, there's a second skill, `stacks-author`. Install it the same way with `skill install stacks-author`, or let the agent read it without installing through `stacks guide author`.

For Claude Code there's also a plugin that carries both skills. Its marketplace lives in the stacks repository and pins the plugin to the latest release:

```sh
claude plugin marketplace add steamfield/stacks
claude plugin install stacks@stacks
```

Other agents (Codex, OpenCode, Cursor) have their own places for instructions. Print the skill and put it where your agent reads skills or rules:

```sh
npx @steamfield/stacks skill install --print > SKILL.md
```

## What the agent does

With the skill loaded, a request like "set up a TypeScript CLI properly" goes like this:

```mermaid
sequenceDiagram
  actor You
  participant A as Agent
  participant Q as stacks
  You->>A: "set up a TypeScript CLI properly"
  A->>Q: search "a TypeScript CLI with tests" --json
  Q-->>A: matches, why and evidence
  A->>Q: show typescript-cli --json
  Q-->>A: full entry
  A->>You: "typescript-cli, because ...; one tradeoff is ..."
  A->>Q: new typescript-cli my-cli --json
  Q-->>A: NewResult, BRIEF.md written
  A->>You: the brief's decisions (unless --sandbox or --yes)
  You-->>A: answers
  loop until green
    A->>A: build from BRIEF.md
    A->>Q: verify
    Q-->>A: failed steps, or green
  end
  A->>Q: verify --all
  Q-->>A: green (fix failures and retry otherwise)
  A->>You: summary: stack, decisions, what's left
```

1. The agent runs `stacks search "<their words>" --json`, compares matches using `why` and `evidence`, then reviews a candidate with `stacks show <id> --json`. It explains its pick and one tradeoff. It won't pick an untrusted entry unless you named it. If `noStrongMatch` is true, it says nothing fits well, runs `stacks list --json` and offers the closest entries. `list` also browses entries.
2. It runs `stacks new <stack> <dir> --json`, or adds `--sandbox` if you asked for the quickest local setup.
3. It reads `.stacks/BRIEF.md` and follows it. It asks you only the decisions the brief tells it to ask; with `--sandbox` or `--yes` there are none.
4. It runs `stacks verify`, fixes what fails, and runs it again until the outcome is `green`. Before calling it done, it runs `stacks verify --all` and fixes failures until that is green too.
5. It works through the brief's after-green list (manual QA, checking the docs) and summarizes for you: the stack, the decisions it took, anything left undone, and where it noted problems with the brief (`.stacks/NOTES.md`).

For an existing repository, step 2 is `stacks add <fragment...> --json` instead, and the agent also merges the files `add` parked under `.stacks/incoming/`.

The rules the agent follows are in [the skill](../skills/stacks/SKILL.md) and in the guide `stacks` prints with no arguments. The two that matter to you: the agent may never edit the verify steps or the manifest, and if verify reports `VerifyChanged`, it stops and asks you. Only you can accept changed steps, by running `stacks verify --accept-changes` at your own terminal.

## What the agent sees

stacks detects that it's running under an agent (from markers such as `CLAUDECODE` or `AI_AGENT`, or simply because stdout isn't a terminal) and prints agent output: the same result as the human text, with the noise cut. With `--json` it gets one JSON object per command instead, decoded against a published schema.

When a command fails, the agent gets an exit code that tells it what to do next:

| Exit | The agent should |
| --- | --- |
| 0 | Continue. For `verify`, check the outcome: only `green` is done |
| 2 | Fix the input: a typo'd id, a bad flag, a non-empty target directory |
| 3 | Fix the configuration or the manifest |
| 4 | Retry later: an upstream service, such as the npm registry for `update`, was unavailable |
| 5 | Read the verify report on stdout and fix what it names |
| 6 | Ask you: something needs a person's permission |
| 130 | Nothing; the run was interrupted |

The full table, the JSON error envelope and the signal rules are in [Output and errors](reference/output.md).

## Agent adapters

At a terminal, `new` and `add` launch the first available agent in your `agents` setting. Otherwise a single found harness launches immediately, and several show a numbered picker after the summary. The order is Claude Code, Codex CLI, OpenCode, Cursor CLI, Copilot CLI, then the Codex app on macOS. Enter picks the first row; EOF or two invalid answers print the prompt. Your choice isn't saved.

`--launch claude|codex|opencode|cursor|copilot|codex-app` selects a harness explicitly; `--no-launch` prints the prompt. Copilot starts with `copilot -i <prompt>`. The Codex app requires `open` on PATH and `Codex.app` in `/Applications` or `$HOME/Applications`; its launch exits 0, including an opener failure, which prints the prompt. Terminal launches return the agent's status. A detected agent, `--json`, pipes, previews and untrusted entries never ask or launch. Copilot and the Codex app are launch targets only; `--agents` and the `agents` setting still accept the four adapter ids below.

Separately from who drives, `--agents` chooses which agents' config files a project gets: Claude Code settings and hooks, Codex config, OpenCode permissions, Cursor rules. It doesn't change which agent `new` launches (`--launch` does). The default is `claude`. Every target gets `AGENTS.md`, guard scripts are shared under `.claude/hooks/`, and only the selected agents get their own config.

```sh
stacks new typescript-cli my-cli --agents claude,codex
```

The adapters install guardrails, such as hooks that block destructive commands and secret writes, and lint-on-write where the agent supports it. How strongly each agent enforces them varies:

| Agent | Enforced guards and instructions | Proof |
| --- | --- | --- |
| Claude Code (`claude`) | Destructive-command and secret-write hooks; lint-on-write, format-on-stop; CLAUDE.md imports AGENTS.md and path rules carry instructions | Bench adapter exists; see the composition's ledger record |
| Codex (`codex`) | Bash and apply_patch guards after hook trust; workspace-write sandbox, on-request approvals; AGENTS.md and project skills carry instructions; lint and format are instructions | Bench adapter exists; a real pass with hooks firing is still required |
| OpenCode (`opencode`) | Permissions and plugin callback guards; lint-on-write, format-on-idle; AGENTS.md and project skills carry instructions | Unproved: there is no OpenCode bench adapter yet; composition and offline callbacks only |
| Cursor (`cursor`) | preToolUse shell and write guards; always-applied MDC instructions; lint and format are instructions | Unproved: there is no Cursor bench adapter yet; composition and offline hooks only |

Codex project hooks need review and trust through `/hooks` before they run, and hook discovery in a linked git worktree still needs checking against a live agent (offline payload tests cover the protocol decisions). OpenCode targets its documented local-plugin format; Claude marketplace settings and the TypeScript harness extensions aren't carried over to the other agents. A blocked action means the agent should ask you.

Format references: [Codex config](https://developers.openai.com/codex/config-advanced/), [Codex hooks](https://developers.openai.com/codex/hooks/), [Codex skills](https://developers.openai.com/codex/skills/), [OpenCode permissions](https://opencode.ai/docs/permissions/), [plugins](https://opencode.ai/docs/plugins/), [formatters](https://opencode.ai/docs/formatters/), [skills](https://opencode.ai/docs/skills/), [Cursor hooks](https://cursor.com/docs/hooks) and [rules](https://cursor.com/docs/rules).
