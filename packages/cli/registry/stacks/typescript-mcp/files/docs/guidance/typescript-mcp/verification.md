# Before calling work done

Run `bun run check` (lint, typecheck, coverage, the build and the smoke check) and read the output, then `stacks verify`.

- A clean exit code isn't a pass. A `-t` filter that matches nothing exits 0 with every test skipped; read the counts.
- After adding or changing a tool, run `bun run build && bun run smoke` and read the listed names, then call it through Inspector's CLI: `node_modules/.bin/mcp-inspector --cli -e MCP_ROOT=<dir> node dist/index.js --method tools/call --tool-name <name> --tool-arg key=value`. Check one success and one tool error.
- `bun run inspect` opens Inspector's web UI for a person; it never exits. Start it in the background only when someone will use it.
- Read the server's stderr records for the calls you made: one `tool call` record each, with the outcome you expected and no arguments.
- To try the server from Claude Code, register the build: `claude mcp add <name> --env MCP_ROOT=<dir> -- node <absolute path>/dist/index.js`, then restart the session. Other hosts take the same command, args and env in their MCP config.
- After a commit that ran hooks, check `git status` for files a hook rewrote and left unstaged.
- Don't report a cause you didn't observe. Quote the output you're basing it on.
