# @steamfield/stacks-mcp

A stdio MCP server for the stacks workflow: choose a stack, create a project, then run its
verification checks. Requires Node.js 22 or newer.

Run it with:

```sh
npx -y @steamfield/stacks-mcp
```

The package includes `@steamfield/stacks` as a dependency and runs its built Node entry.
No separate CLI installation or `STACKS_MCP_CLI` setting is needed.

## Connecting a client

For [Claude Code](https://code.claude.com/docs/en/mcp):

```sh
claude mcp add stacks -- npx -y @steamfield/stacks-mcp
```

Add `--scope project` before `--` to save it in the project's `.mcp.json`.

For Claude Desktop, add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "stacks": {
      "command": "npx",
      "args": ["-y", "@steamfield/stacks-mcp"],
      "env": {
        "PATH": "<directories holding node, git and the tools your verify steps run>"
      }
    }
  }
}
```

Desktop does not use your shell's PATH. An absolute path to `npx` may be needed, especially
with nvm or mise. Set `env.PATH` to include the tools your project's verify steps need,
such as bun and git. The client's environment becomes every verify step's environment.

## Tools and resources

| Tool | Input | Result |
| --- | --- | --- |
| `stacks_list` | Optional `group`: `stacks`, `fragments` or `apps` | Whole CLI listing, including rejected entries and project context |
| `stacks_new` | `stack`, absolute `dir`; optional `preset`, `with`, `without` | Whole scaffold result, including warnings, missing tools and handoff |
| `stacks_verify` | Absolute existing `dir` | Whole verify result, including step diagnostics and an optional `next` |

`list` and `new` run in the server's working directory, which decides which project-origin
entries they see. `verify` runs in `dir`. New never launches an agent; omitting `preset`
preserves the CLI's user setting.

List and new have `openWorldHint: true`: both may read the hosted API and the configured
remote index. Verify is also open world because project commands may access external services.

Verify executes the project's manifest commands, which may change files or access the network.
Failed and changed verify outcomes are successful tool calls with a `next` action. Changed
steps run nothing: a person must accept them in a terminal. The server never passes
`--accept-changes`.

CLI execution failures (`CliFailure`) have `isError: true`, no `structuredContent`, and text containing the
message, a `Next:` line, then a blank line and JSON metadata (`tag`, `retryable`, optional
`exitCode` and `details`). Parameter-validation failures also have `isError: true`, but return
Effect's plain diagnostic naming invalid or missing keys, without the `Next:` line or JSON
metadata. Progress notifications count step-started and step-finished events when the request
supplies a progress token; no total is guessed.

Read `stacks://guide` for the CLI's guide and `stacks://guide/author` for its authoring guide.
`stacks://guide/author/{topic}` serves an authoring reference and completes topic names.
Each read runs the CLI afresh; a failed read is a protocol error. The CLI guide also names
commands this server does not expose.

## Configuration

| Variable | Meaning |
| --- | --- |
| `STACKS_MCP_CLI` | Optional absolute path to a built CLI JavaScript entry; overrides the dependency |
| `STACKS_MCP_TIMEOUT_SECONDS` | Positive integer per-call timeout; default 900 |
| `STACKS_MCP_LOG_LEVEL` | Case-insensitive Effect log level; default Info |
| `PATH` | Tools available to project verification commands |

The CLI always runs through the server's Node executable, with stdin ignored and the captured
environment. PATH is never searched for the CLI itself. Logs go to stderr; stdout contains
only JSON-RPC messages. EOF and SIGTERM shut down cleanly.

## From source

From the workspace root:

```sh
bun install
bun run --filter @steamfield/stacks build
bun run --cwd packages/mcp build
node /absolute/path/to/stacks/packages/mcp/dist/server.js
```

Register that build with Claude Code using an absolute server path:

```sh
claude mcp add stacks -- node /absolute/path/to/stacks/packages/mcp/dist/server.js
```

Use an absolute Node path too if the client cannot find it. `bun run --cwd packages/mcp dev`
builds and starts the Node bundle. `bun run --cwd packages/mcp pack` writes the publishable
tarball under `dist/pack/`; the maintainer's `bun run release` publishes format, CLI, then MCP,
after packing and checking all three.

## Known limits

The server supports MCP 2026-07-28 and 2025-11-25 through the installed Effect adapters.
Cross-implementation tests use the official TypeScript SDK's legacy handshake; modern discovery
and per-request metadata are exercised with Effect's client and raw stdio.

Effect's stdio adapter always advertises logging, completions, and, when resources exist,
resource subscription and list-change capabilities. These capabilities cannot be disabled through
its public API. The server exposes no logging controls beyond the adapter's behavior.
