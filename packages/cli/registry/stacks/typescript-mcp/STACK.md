---
schema_version: 1
id: typescript-mcp
kind: stack
name: TypeScript MCP server with Effect
description: A stdio MCP server on Effect's MCP modules, serving typed tools and a resource over newline-delimited JSON-RPC, with Vitest unit tests and a real client handshake against the built server.
tags: [typescript, mcp, effect, bun, node, scripts]
deps:
  app: [effect, "@effect/platform-node"]
  dev: [typescript, "@biomejs/biome", vitest, "@vitest/coverage-v8", "@types/node"]
tools: [node, bun, git]
decisions:
  - "MCP library: Effect's effect/ai MCP modules (default), matching this registry's TypeScript stacks with one Schema and one runtime. The official TypeScript MCP SDK is the ecosystem's reference implementation; use it instead when Effect lacks a required feature."
  - "Transport: stdio only (default). No HTTP, no SSE, no auth."
  - "Runtime: Node runs the built server (default), because an MCP client spawns node, not bun; Bun builds and runs the build script."
  - "Protocol revisions: the newest revision the installed library supports, plus the one before it (default: both supported and advertised)."
  - "Dependencies: bundled into the server (default), so it needs nothing installed beside it; a server that wraps another program adds that program as its one runtime dependency."
  - "Configuration: none (default). A server that needs a path or allow-list takes command-line arguments documented in the README, never a config file."
merge: [.claude/settings.json]
fragments:
  required: [claude-harness]
  default: [git-hooks, ci-github, effect]
verify:
  - { name: install, phase: setup, layer: install, run: bun install }
  - { name: lint, layer: lint, run: bun run lint }
  - { name: typecheck, layer: typecheck, run: bun run typecheck }
  - { name: test, layer: test, run: bun run test }
  - { name: stdio-handshake, layer: test, run: bun run e2e }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  build: Bundle the server for the Node target with a shebang
  dev: Run the source through Bun for a quick loop
  typecheck: Run tsc without emitting
  lint: Run Biome checks
  test: Run the Vitest unit suite
  coverage: Run unit tests with coverage
  e2e: Build, then run the stdio handshake against the built server
  check: Run lint, typecheck, test and the handshake
  clean: Remove generated build output
---

# TypeScript MCP server with Effect

A stdio MCP server launched by an agent client as a subprocess, with typed tools and one resource. The proving slice is a `server_info` tool, an `echo` tool that takes a string and returns it with its length, and one markdown resource. Build that slice through the real transport before extending it. There is no model provider, chat loop, HTTP listener or dashboard.

## Layout

`src/server.ts` composes the transport, toolkit, handlers and resource, and runs the application once. `src/toolkit.ts` holds tool names, descriptions and schemas without I/O; `src/handlers.ts` implements them. Past about five tools, move to one file per tool under `src/tools/`, keeping each declaration and handler together.

`src/config.ts` owns configuration and is the only reader of `process.env`. `src/errors.ts` holds tagged errors. `src/schemas/` holds boundary shapes, re-exported from `index.ts`. Decode at boundaries, then work with decoded values.

Only a server that fronts another program needs `src/run.ts`: the sole subprocess helper, using Effect's process service with argv arrays, never shell strings. Return `{ exit, stdout, stderr }`, enforce a timeout and drain stdout and stderr concurrently.

Tests live in `tests/`; transport checks in `e2e/` run against `dist/server.js`. Source imports neither test directory. Ignore `dist/` in git and exclude it from typecheck.

## Setup

1. Create package metadata with `"type": "module"`, a release `version`, and a `bin` entry mapping the project slug to `dist/server.js`. Record current Node LTS in `.node-version` and `engines.node`, and the build's Bun version in `.bun-version` and `packageManager`.
2. Install compatible Effect and Node platform packages together, checking peer ranges. Because the build bundles them, add them as `devDependencies`; `files` ships only `dist/`, and `dependencies` holds only a program the server wraps. Read the installed exports and declarations for MCP transport, client, protocol adapters, tools, handlers, resource registration, annotations and result encoding. Record the discovered imports and API shapes under AGENTS.md's Build workarounds, with removal conditions for actual workarounds. Do not copy unstable API snippets from another release.
3. Generate strict TypeScript config from current compiler help: unchecked index access, verbatim modules and no emit. Include source, tests, e2e and shipped hook helpers.
4. Generate Biome config for the installed release: recommended checks, organized imports, two spaces, double quotes and width 100. Load the shipped `biome-plugins/boundaries.grit` through its plugins setting. Check Grit syntax against installed Biome, preserving every rule when adapting it. Under `src/`, it rejects `console.*`, `process.stdout`, `process.exit`, and `process.env` outside `src/config.ts`. Confirm lint checks real files and rejects a deliberate violation.
5. Wire scripts: `build` bundles `src/server.ts` as Node ESM with a shebang into `dist/server.js`; `dev` runs source through Bun; `lint`, `typecheck`, `test` (Vitest on Node, excluding e2e), `coverage`, `e2e` (build then transport checks), `check` (lint, typecheck, test, e2e), and `clean` (generated output only). Bun bundles JavaScript; Node runs the deliverable.
6. Implement the slice, fill README and keep the harness's AGENTS.md accurate. CI uses coverage and the e2e script.

## Transport

Use the installed library's stdio transport and Node runtime support. Build and provide one application layer; register handlers alongside their declarations so a missing handler fails startup. A startup failure writes one safe diagnostic line to stderr and ends non-zero.

Stdout contains only newline-delimited JSON-RPC messages. Use Effect's logger configured for stderr; no banners or console calls. Never log tokens, environment values or whole dependency error objects.

Inject the version from `package.json` at build time and use it as `serverInfo.version`. Set `instructions` to short guidance on using this server's tools and resource. Check the installed declarations for both metadata options.

Support the two selected revisions through the library's adapters. Follow each revision's lifecycle: modern requests carry version and capabilities in metadata and servers implement `server/discover`; legacy clients use `initialize`. Read the [lifecycle specification](https://modelcontextprotocol.io/specification/latest/basic/lifecycle) and installed declarations rather than assuming both use a handshake.

## Tools

Give each tool a descriptive snake_case name, human-readable title, description, parameter schema and success schema. Set all four annotations truthfully: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. For both slice tools these are respectively true, false, true, false. Inspect the installed annotation API instead of accepting defaults.

`server_info` takes an empty parameter object and returns the server's name and version; liveness is the protocol's own `ping` request, so don't add a tool for it. `echo` requires one string and returns it with its length; count Unicode code points for both the length and limit. Above 1,000 code points it fails with `EchoTooLong`. Declare that failure and map it to a tool result.

Close every parameter object: unknown keys are rejected and the emitted `inputSchema` has `additionalProperties: false`. Check both the JSON Schema conversion and runtime decoder in the installed library; a struct alone may silently strip keys. Input validation failures are tool execution errors: return `isError: true` with text naming the problem, including an offending unknown key. Inspect the default error path and adapt the tool-call boundary if it emits a protocol error instead.

A tool error's first text block starts with one sentence saying what went wrong, followed by the next step the model should take. For `EchoTooLong`, tell it to shorten the input to at most 1,000 code points. Keep defects scrubbed. Do not assume the library's default failure encoding produces actionable text.

Successful results carry `structuredContent` conforming to the success schema plus a text block containing its serialized JSON, as the [tools specification recommends for compatibility](https://modelcontextprotocol.io/specification/latest/server/tools#structured-content). Additional readable text is optional. Inspect result customization in installed declarations and assert the wire output.

## Resource

Serve one read-only static resource from `src/resource.ts`: URI `<scheme>://readme`, a name, description, `mimeType: "text/markdown"` and one exported body constant. Derive the scheme from the slug, prefixing a letter if it starts with a digit to satisfy RFC 3986. Test the served bytes against that constant. The slice needs no templates, subscriptions or notifications.

## Configuration and clients

No configuration is needed for the slice. An optional log level belongs in `src/config.ts`, named with the project's uppercase prefix, with a safe default for an unset or unrecognized value. If the server needs a path or allow-list, parse command-line arguments at this boundary and document them; do not add a config file.

Fill README's Connecting a client section from [Claude Code's current docs](https://code.claude.com/docs/en/mcp): `claude mcp add <name> -- node <absolute path>/dist/server.js`, or use `--scope project` for a project-scoped `.mcp.json`. Quote paths containing spaces. For Claude Desktop, document the `mcpServers` entry in `claude_desktop_config.json`, using absolute paths to both `node` and the server. Its launch environment can differ from the shell's PATH; consult the [local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers) and current client docs before writing config. Build first, then verify the connection and listed tools.

## Tests

Use real layers for owned services; fake only external boundaries. Test schema decoding and handlers, including wrong input, failure mapping and undecodable upstream output where relevant. A subprocess helper gets a regression with a child writing more than a pipe buffer to stderr before stdout, proving concurrent draining.

E2e builds first and spawns `node` with the absolute built-server path, using temporary HOME/XDG/state directories and an environment assembled from scratch. Capture stderr concurrently and show it on assertion failure. Assert every stdout line is a JSON-RPC message. No network, module mocks or fixed ports.

Exercise both supported revisions in separate connections through the installed library's client. Use discovery with per-request metadata for modern revisions and initialization for legacy ones. Assert the actual revision used so losing an adapter fails the test. Check server version against package metadata and check instructions.

Assert `tools/list` has exactly `server_info` and `echo`, their titles, all four hints and closed input schemas. Call both tools, decode structured results and compare the serialized JSON text; `server_info`'s version matches package metadata. Test echo at 1,000 code points and failure at 1,001; test missing input, wrong types and unknown keys for `isError: true` with problem and next step. Include non-ASCII input to check character counting. List the resource and read its expected bytes.

Add one cross-implementation e2e through the official TypeScript MCP SDK client or Inspector CLI, choosing a compatible current version as a development dependency. Check `initialize` on a supported legacy revision, `tools/list` and one `tools/call`. Discover the current client API and revision selection in installed declarations; a modern-only check cannot prove legacy initialization.

## Gotchas

When the client closes stdin, the server exits on its own, without `process.exit`. Closing input is the [stdio graceful-shutdown signal](https://modelcontextprotocol.io/specification/latest/basic/transports/stdio#shutdown); forced termination is a fallback. Assert it exits within five seconds with code 0 after stdin closes, before the client sends a signal. If the installed runtime cannot achieve a clean exit, report that limitation rather than hiding it with a forced exit.

Check APIs and config against installed declarations; record findings under Build workarounds. A lint command that checked zero files has not verified the boundaries.

<!-- stacks:when preset=default -->
For an optional npm release to the MCP Registry, write `server.json` from the current registry schema at release time, with an npm `packages` entry using stdio transport. Add the matching `mcpName` to `package.json` following the [registry's package requirements](https://modelcontextprotocol.io/registry/package-types); no release config is shipped here.
<!-- stacks:end -->
