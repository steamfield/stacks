---
schema_version: 1
id: typescript-mcp
kind: stack
name: TypeScript MCP server
description: A Model Context Protocol server in TypeScript on the official v2 SDK, served over stdio, with zod-described tools, tool errors written for the model, JSON logs kept off stdout, and Vitest tests that connect a real MCP client in memory and to the server process.
tags: [typescript, mcp, ai, agents, node, bun, scripts]
deps:
  app: ["@modelcontextprotocol/server", zod, pino]
  dev: ["@modelcontextprotocol/client", "@modelcontextprotocol/inspector", typescript, "@types/node", "@biomejs/biome", vitest, "@vitest/coverage-v8"]
tools: [bun, node, git]
decisions:
  - "Transport: stdio (default), for a server a host starts as a child process. Streamable HTTP through @modelcontextprotocol/node is a later decision with its own serve step and authorization."
  - "Distribution: an npm package whose bin is the bundled dist/index.js (default), run by hosts with npx or node; or local only, registered by path."
  - "Node version: current LTS (default), recorded in .node-version. Node runs the server and Vitest; Bun installs, runs scripts and bundles."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github]
  optional: [rr, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run coverage }
  - { name: stdio, layer: test, run: bun run test tests/stdio.test.ts }
  - { name: build, layer: build, run: bun run build }
  - { name: smoke, layer: test, run: bun run smoke }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  build: Bundle the server into dist/index.js
  start: Run the built server on stdio (a host normally starts it)
  inspect: Open MCP Inspector's web UI on the built server
  smoke: Start the built server with MCP Inspector's CLI, list its tools and check their schemas
  typecheck: Run tsc over the server, tests and tooling
  lint: Run Biome checks, including the boundary plugin
  format: Apply Biome formatting and safe fixes
  test: Run Vitest once
  test:watch: Watch Vitest tests
  coverage: Run Vitest with coverage thresholds
  check: Run lint, typecheck, coverage, the build and the smoke check
  clean: Remove build and coverage output
  prepare: Install git hooks outside CI
---

# TypeScript MCP server

## What stacks wrote

A stdio MCP server with one tool, `read_file`, which reads a UTF-8 text file under a configured root and refuses `../`, absolute paths and symbolic links that leave it. `src/index.ts` is the entry: it reads the environment and signals and serves `createServer` over stdio with the SDK's `serveStdio`, which answers both 2025 and 2026-07-28 clients. `src/server.ts` builds the `McpServer` and registers each tool; `src/tools/read-file.ts` holds the tool's zod schemas, its work and its registration; `src/tools/run.ts::runTool` turns a result into structured content and a `ToolError` into an `isError` result with a fixed message for the model. `src/config.ts` validates settings with zod, `src/errors.ts` holds the tool error codes, `src/logging.ts` the pino logger on stderr. Tests run on Vitest: unit tests beside the code, `tests/server.test.ts` through an SDK client over an in-memory transport, `tests/stdio.test.ts` against the real process on both protocol eras with a stdout purity check, and `scripts/smoke.ts`, which lists the built server's tools through MCP Inspector's CLI. The configs, package scripts, a Biome boundary plugin and `docs/guidance/typescript-mcp/` ship too. Read the code before extending it.

Link `docs/guidance/typescript-mcp/index.md` from AGENTS.md.

## Layout

- `src/tools/<tool>.ts` per tool with `src/tools/<tool>.test.ts` beside it; `src/tools/deps.ts::ToolDeps` is what tools receive.
- `tests/helpers/server.ts`: `testServer()` (a connected in-memory client with captured logs), `tempRoot()` and `captureLogger()`. `biome-plugins/boundaries.grit`: the boundary rules, probed by `tests/boundaries.test.ts`.

## Setup

1. Add every declared app and dev dependency at its current release with `bun add` and `bun add -d`. Use the v2 packages the frontmatter names; `@modelcontextprotocol/sdk` is v1. Check `@modelcontextprotocol/server`'s zod range before adding zod, and match `@types/node` to the chosen Node major.
2. Write the Node LTS to `.node-version` and the Bun version to `packageManager`. Add a `version` field (a `0.x` pre-release) and fill `description` in `package.json`: the server reports both to every client, and typecheck fails without `version`.
3. Read the installed SDK declarations (`node_modules/@modelcontextprotocol/server/dist/index.d.mts`, `stdio.d.mts`, and the client's) before changing any SDK call.
4. Run `bun run lint`, `bun run typecheck`, `bun run coverage`, `bun run build` and `bun run smoke`. Where an installed release rejects shipped code or config (a renamed export, a changed Inspector flag), update it from that release's declarations or `--help`, keeping every check, lint rule and assertion.
5. Fill the README's `stacks:fill` markers and AGENTS.md (commands, a single-file test example, the stdout rule, the guidance link), then run `stacks verify` until green.

## Conventions

The shipped code keeps these; new code does too. `docs/guidance/typescript-mcp/server.md` has the detail.

- Nothing writes to stdout but the transport: it carries JSON-RPC. Log through `src/logging.ts`, which writes JSON lines to stderr, recording a tool's name, outcome and duration, never its arguments or result.
- `process` and transports stay in `src/index.ts`; `createServer` builds a fresh server per connection and does no I/O. The Grit plugin fails lint on `console`, `process.stdout`, `process` outside the entry, a transport outside it, or any `@modelcontextprotocol/sdk` import.
- Each tool has a `snake_case` name, a description that says when a model should call it, a `z.strictObject` input with `.describe()` on every field, an `outputSchema`, and `annotations` stating its side effects. Its handler goes through `runTool`.
- A failure the model can act on is `throw new ToolError(code)`, with a fixed message in `TOOL_ERRORS` that names the fix and never echoes paths, values or exception text. Other exceptions reach `runTool` unchanged.
- Settings come from the environment through `loadConfig`; a host passes them in its server config.

## Testing

Unit tests sit beside the code as `test.each` tables of input and exact output, and of input and the `ToolError` code it raises. `tests/server.test.ts` asserts what a host sees through `listTools()` and `callTool()`, including `isError` results and schema validation; a new tool adds its list entry, a success, each tool error and one invalid input there. `tests/stdio.test.ts` spawns `node src/index.ts`; verify runs it on its own. `bun run smoke` is the only check of the bundle. Details in `docs/guidance/typescript-mcp/testing.md`.

<!-- stacks:when with=ci-github -->
CI sets up Bun from `packageManager` and Node from `.node-version`, installs frozen dependencies, then runs lint, typecheck, coverage, the build and `bun run smoke`. No credentials are needed.
<!-- stacks:end -->

## Commands

`package.json` wires every declared command; mirror them in AGENTS.md with a scoped example such as `bun run test src/tools/read-file.test.ts`. To call a tool by hand: `bun run build`, then `bunx mcp-inspector --cli -e MCP_ROOT=. node dist/index.js --method tools/call --tool-name read_file --tool-arg path=README.md`. `inspect` opens Inspector's web UI and never exits; start it in the background for a person, never to check your own work. `docs/guidance/typescript-mcp/verification.md` shows how to register the build with Claude Code or another host.

<!-- stacks:when with=git-hooks -->
`scripts/prepare.ts` already runs `lefthook install` when `lefthook.yml` exists outside CI, so don't add another installer.
<!-- stacks:end -->

## Gotchas

- Tutorials and model memory show the v1 SDK (`@modelcontextprotocol/sdk/server/mcp.js`, `server.tool()`, `McpError`). v2 split it into `@modelcontextprotocol/server` and `@modelcontextprotocol/client` and renamed APIs; the guard hook denies installing v1.
- `server.connect(new StdioServerTransport())` serves only 2025-era clients. `serveStdio(factory)` serves both eras, which is why `createServer` is a factory.
- `InMemoryTransport.createLinkedPair()` connects on the 2025 era only; `tests/stdio.test.ts` covers 2026-07-28 with `versionNegotiation: { mode: "auto" }`.
- One stray stdout write before or during the handshake breaks the session with an error on the host's side, not yours. MCP logging notifications are deprecated in the 2026-07-28 protocol; logs go to stderr.
- `@modelcontextprotocol/inspector` is large (it carries its web UI) and its CLI flags have changed between releases; read `bunx mcp-inspector --cli --help` before changing `scripts/smoke.ts`. Its `postinstall` is blocked by Bun and isn't needed for the CLI.
- The server and tests run on Node: never `bun test`, `--bun`, or `bun src/index.ts`. The guard hook denies them. Node runs `src/*.ts` by stripping types, so relative imports keep `.ts` and the code uses only erasable syntax.
- A host starts the server with its own working directory, often `/`; give `MCP_ROOT` as an absolute path in host config.
