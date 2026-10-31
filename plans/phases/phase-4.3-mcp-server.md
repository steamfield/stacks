# Phase 4.3: MCP server

Status: DRAFT 2026-10-27 — rewritten for execution. The maintainers waived the evidence gate
(open question 15): the server is being built so it can be tried, and the trial is the evidence.
Two parts, each independently done. Four decisions are listed in "Decisions this plan makes";
each has the recommended default this plan is written to, and each is one word to override.

| Field | Value |
|---|---|
| Goal | `@steamfield/stacks-mcp` is a stdio MCP server that exposes `list`, `new` and `verify` as tools and the brief as a resource, by running the CLI's `--json` contract, so an agent whose client prefers MCP tools, or has no shell, gets the same results and the same trust boundary as the CLI |
| Traces to | Assumption 5: "Handoff to whatever agent is on PATH is the right entry point. Confidence: Low." The coding agent as "the CLI's main reader". D11: "an MCP server will be its own package" |
| Depends on | 1.6c (a published `stacks`) for the published shape only; the server runs against the compiled binary today (see "Finding the CLI"). 3.1a (`show --json`) for a fourth tool, which this plan leaves out |
| Blocks | Nothing |
| Decisions needed | D-a: which tools ship now. D-b: where the stack is dogfooded. D-c: whether `packages/cli/package.json` gains `bin` and `exports` now. D-d: how far this plan goes toward publishing |
| Settles | That the server shares no source with the CLI; the stack a stdio MCP server is built from; tool contracts; the CLI resolver; that MCP changes nothing about what runs |

## What the code says the last draft had wrong

Verified against the checkout on 2026-10-27 before rewriting. Each row changed the plan.

| The old draft said | What the repo has | What this plan does instead |
|---|---|---|
| Read `packages/cli/docs/authoring.md`; run `stacks guide` | No `docs/` under `packages/cli`: 3.1b's authoring guide never shipped. The authoring contract is `packages/cli/README.md` ("Listing stacks and fragments", "Validating a registry"), `packages/cli/registry/README.md`, and the decoder in `src/schemas/entry.ts` | Part 1 cites those three as its spec, and the stack is checked with `validate` rather than against prose |
| `stacks_show` wraps `stacks show --json` | No `show` command: `src/commands/` holds doctor, guide, list, new, root, skill, validate, verify | D-a: three tools now, `show` when 3.1a lands |
| Find the CLI through `@steamfield/stacks/package.json`'s `bin`, then run it as `process.execPath <bin>` | `packages/cli/package.json` has no `bin` and no `exports`; 0.2 is deferred; `scripts/build.ts` produces `dist/stacks`, a Bun-compiled native binary, which `node` cannot run | D-c: `bin` + `exports` added to the CLI package, and a four-step resolver that runs a native binary directly and a `.mjs` entry through `process.execPath` |
| `import { McpServer } from "effect/ai"`, with `McpServer.layerStdio({ name, version, protocols })` | Correct that these exist in `effect@4.0.6`, and they are namespaces exported by `dist/ai/index.d.ts` (`McpServer`, `McpClient`, `McpProtocol`, `Tool`, `Toolkit`, `McpSchema`). `McpServer.layerStdio` requires `Stdio`, which `NodeStdio.layer` from `@effect/platform-node` provides. But `McpClient.ProtocolVersion` is only `"2025-11-25"` or `"2026-07-28"` | The stack pins those two revisions and the tests use `v2025_11_25`; both sides are named in Part 1 so client and server cannot drift |
| "The cost is one Node process per call (around 100 ms)" | No measurement exists | Dropped. If latency matters, measure it in the run note |
| Exit criteria: a maintainer publishes `@steamfield/stacks-mcp` by hand and one real client registers it | 0.2, 1.6c and every publish are deferred; nothing in this repo is publishable yet | D-d: this plan ends at a green `verify` and a registered client locally; publishing stays with 1.6c |
| Acceptance tests named `[4.3#n]` | `tests/helpers/acceptance.ts` reads tags only from `packages/cli/tests` and `packages/cli/e2e`, so an `Acceptance tests: traced` line on this plan fails the root trace test once the tests live in `packages/mcp/tests` | The plan is not marked traced. It says so here so nobody adds the line later without extending the harness |

## Decisions this plan makes

Recommended defaults; override any of them before Part 1 starts. D-a, D-c and D-d were confirmed by Eric
on 2026-10-27; D-b was already in force and is unchanged.

| | Decision | Recommended | Why |
|---|---|---|---|
| D-a | Which tools ship in the MVP | Three: `stacks_list`, `stacks_new`, `stacks_verify`, plus the brief resource. `stacks_show` lands when 3.1a does. Interrogation beyond that (registry stats, package versions for a chosen stack) and the logging/telemetry conventions are follow-ups, not MVP | Every tool is a wrapper around a command that exists. A stub that always errors teaches an agent to stop trying. Confirmed by Eric 2026-10-27: "at least those items" |
| D-b | Where the stack is dogfooded | In place: `packages/mcp` is scaffolded by `new typescript-mcp packages/mcp` (after `--without git-hooks`, see the trap below), and `stacks verify` inside `packages/mcp` is the package's own gate beside the root fan-out | The point of the exercise is to be the tool's user. A separate throwaway project proves less and drifts |
| D-c | Whether the CLI package changes | **No** — no `bin` or `exports` entries for MCP in this phase. The resolver drops to two working steps: `STACKS_MCP_CLI`, then the monorepo sibling `../cli/src/bin.ts`. The dependency-`bin` step waits for 1.6c | Confirmed by Eric 2026-10-27: no export touches for MCP-specific items. The server instantiates a stack from the template and hands off; it is not a consumer of a published package, so the distribution path can wait for the distribution |
| D-d | How far this plan goes | Local and CI-green: `bun run check` at the root, `stacks verify` green in `packages/mcp`, one real client registered against the built server, run note in `plans/runs/` | 0.2 and 1.6c own publishing. Nothing here needs npm. Confirmed by Eric 2026-10-27: no publish, that is a release step |

### Follow-ups beyond this phase

Two directions raised by Eric (2026-10-27) that belong after the MVP, not in it:

1. **Give agents the full manual, not just the brief.** Today the server serves one markdown resource
   (the composed brief). The durable shape is *skills over MCP*: SEP-2640 is Final, the extension id is
   `io.modelcontextprotocol/skills`, and a server implementing it declares the `resources` capability
   plus the extension, then answers `skills/list` and `skills/get`, with skill files served through
   `resources/read`. It requires protocol revision `2026-07-28` or later, which this server already
   advertises, so the door is open without changing the transport. That is how the authoring manual,
   the stack catalogue and the fragment rules could reach an agent as loadable skills rather than one
   brief-shaped resource.
2. **Align the server with the MCP build-server guidance.** The published best practices for stdio
   servers are the ones this stack already enforces — never write stdout, and log to stderr through one
   logger per module because stdout is the JSON-RPC channel. Worth re-reading the guide when the tool
   surface grows, particularly the prompts capability, which this server does not use and which is the
   natural home for the "few questions, then a stack" interrogation flow.

## Part 1: the `typescript-mcp` stack

**Status: done, and corrected against the first build run.** The stack is authored, the bundled registry
is clean (9 stacks, 19 fragments: 0 errors, 0 warnings, 0 notes), the registry tests pass (42), and a
project scaffolded from it reached `verify: green` (6 steps, 45 unit tests, the stdio handshake against
the built server). That build run then reported twelve findings about the brief (DF-15 to DF-26 in
`plans/archive/dogfooding-log-2026-10-27.md`); nine were the stack body asserting things the library does not support, and
all nine are fixed in the entry. The frontmatter below is current; the body is authoritative in
`STACK.md`, not in this plan.

Done when: `stacks validate` reports zero errors and zero warnings for the bundled registry,
`bun run test` at the root passes (its registry tests run `new` for every bundled stack in both
presets), and a scaffolded project's brief fits its budget.

### What it is

A stdio MCP server on Effect's MCP modules, for an agent client to launch as a subprocess. It is
*a server*, not a client: no model provider, no chat loop. The proving slice is one tool and one
resource served over stdin/stdout, exercised by a real `McpClient` in the tests.

### Frontmatter

`packages/cli/registry/stacks/typescript-mcp/STACK.md`, entry format v1, decoded by
`src/schemas/entry.ts::StackMeta`. Keys are snake_case. Write exactly this and change no key:

```yaml
---
schema_version: 1
id: typescript-mcp
kind: stack
name: TypeScript MCP server with Effect
description: A stdio MCP server on Effect's MCP modules, serving typed tools and a resource over newline-delimited JSON-RPC, with Vitest unit tests and a real client handshake against the built server.
tags: [typescript, mcp, effect, node, ai, scripts]
deps:
  app: [effect, "@effect/platform-node"]
  dev: [typescript, "@biomejs/biome", vitest, "@vitest/coverage-v8", "@types/node"]
tools: [node, bun, git]
decisions:
  - "Transport: stdio only (default), through layerStdio. No HTTP, no SSE, no auth."
  - "Runtime: Node runs the built server (default), because an MCP client spawns node, not bun; Bun builds and runs the build script."
  - "Protocol revisions: 2026-07-28 and 2025-11-25 (default: both, in that order); the server advertises both, so a client that lags behind still connects."
  - "Dependencies: bundled into the server (default), so it needs nothing installed beside it; a server that wraps another program adds that program as its one runtime dependency."
fragments:
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
---
```

`fragments.required` is empty on purpose: this stack ships no `adapters/<agent>/` tests, so it
needs no claude-harness helpers the way `typescript-cli` does. `deps` names carry no versions
(1.5 rejects version-looking values); the agent installs current ones.

### Shipped files

Only `files/README.md.tmpl`, using `{{project_name}}` and `stacks:fill` markers the same way
`typescript-cli`'s does. No `.ts` files ship: everything in this stack is either version-free prose
or code the agent writes from that prose. That keeps the registry out of
`tsconfig.registry.json`'s typecheck and the package's Biome run.

### What the body must decide

Under 2,000 words; aim for about 1,600 and check with
`stacks validate --brief typescript-mcp` (it prints the count and the limit). Sections, in the
order `typescript-cli` uses:

- **Layout** — `src/server.ts` (entry: builds the layer, nothing else), `src/toolkit.ts` (the
  `Toolkit` of `Tool`s, pure declarations), `src/handlers.ts` (one handler per tool, mapping failures
  only), `src/config.ts` (the only reader of `process.env`), `src/errors.ts`, `src/schemas/` with an
  `index.ts`. `tests/` for Vitest on Node, `e2e/` for the handshake against `dist/server.js`.
  **`src/run-cli.ts` and `src/resolve-cli.ts` are not the stack's business**: a generic MCP server has
  no program to wrap. They belong to Part 2, which does, and Part 2 adds them to `packages/mcp` after
  scaffolding (DF-15). The stack mentions a `src/run.ts` as opt-in for "a server that fronts another
  program" and says nothing more, so the build run leaves no dead code behind.
- **Setup** — package metadata with `"type": "module"`, `bin` mapping the project slug to
  `dist/server.js`, `.node-version` written by the builder with `engines.node` matched to it (nothing
  writes it: DF-17); TypeScript strict from the compiler's own `--init` output, because a scaffold has
  no base (DF-18);
  Biome; Vitest on Node; scripts `build` (Bun bundles `src/server.ts` for Node with a shebang),
  `dev`, `lint`, `typecheck`, `test`, `e2e` (build, then the handshake), `check`, `clean`.
  Install Effect packages together from one version; check the installed exports before writing
  imports, since `effect/ai` is marked unstable.
- **Transport** — `McpServer.layerStdio({ name, version, protocols: [McpProtocol.v2026_07_28,
  McpProtocol.v2025_11_25] })` provided with `NodeStdio.layer`; register tools with
  `McpServer.toolkit(Toolkit.make(...))` and handlers with `Toolkit.make(...).toLayer({...})`;
  the resource with `McpServer.resource`. Stdout belongs to the protocol: no logging, no
  `console.log`, ever; diagnostics go to stderr through Effect's logger.
- **Tools** — the proving slice only: a `ping` tool returning a typed object, plus one tool that
  takes a required string and returns it alongside its length, so parameters, success and a
  declared failure are all exercised. Declare `failure` and use `failureMode: "return"` so a tool
  error comes back as `isError: true` with content, not as a protocol error.
- **Resource** — one static resource with a fixed URI and `mimeType: "text/markdown"`.
- **Configuration** — the server reads no environment beyond an optional log level; a client
  launches it with no flags and no config file. State this, so the agent does not invent config.
- **Tests** — unit tests for what is pure (handlers with a fake CLI runner service, argument
  construction, error mapping); one e2e that builds, spawns the server with
  `McpClient.layerStdio({ command, protocol: McpProtocol.v2025_11_25 })` and
  `ChildProcessSpawner` from `NodeServices`, lists the tools and the resource, calls each tool and
  returns the resource's bytes. No module mocks, no network.
- **Gotchas** — the server must not read `process.argv` for flags; a stdio server that prints a
  banner breaks the client. `process.exit` may not run after the transport closes: end the scope.
  Verify the tool count in the test, so a registration that silently fails is caught.

### Traps this part must not fall into

- The composed project must verify `install`, `lint`, `typecheck` and `test` layers
  (`src/core/validate/compositions.ts`), or `validate` fails. The `stdio-handshake` step carries
  `layer: test` for that reason.
- No `web` or `api` tag: those require a `serve` step with a probe, and this server has no port.
- `git-hooks` is `needs_own_repo: true`, so composing this stack **inside** another repository is a
  `ComposeConflict` unless the fragment is dropped with `--without git-hooks` (or the target is the
  repository root). Part 2 scaffolds inside the stacks repo, so it passes that flag.
- `git-hooks`'s own setup step runs `lefthook install`, which needs `lefthook` on PATH. It is in
  `tools`, so a machine without it gets a listed missing tool, not a failed `new`.
- The bundled registry is held to zero warnings, not just zero errors
  (`tests/bundled-registry.test.ts`). Two rules bite a new stack immediately: a stack needs exactly
  one task-runner tag (`make` or `scripts`), and every `decisions` string must name its default in
  parentheses, because `--sandbox` and `--yes` depend on it. A step with no layer, or a shipped file
  git would ignore, also fails the gate.
- `validate` checks shape, not truth. The first draft of this stack said `BunRuntime.runMain` in the
  same paragraph that sends Node the bundle; every check passed. Read the brief once as the building
  agent will, against the installed `.d.ts` files, before trusting a green `validate`.

## Part 2: `packages/mcp`

Done when: `stacks verify` is green inside `packages/mcp`, `bun run check` is green at the
root, and an MCP client (Claude Code or Codex) registered against the built server builds a
sandbox project to a green verify through the tools alone, with the run note in `plans/runs/`.

### Shape

Scaffolded by Part 1 (D-b), then filled in:

| Path | What |
|---|---|
| `src/server.ts` | Builds the layer, registers the toolkit and the resource, runs |
| `src/toolkit.ts` | `Tool.make` declarations: names, descriptions, parameter and success schemas |
| `src/handlers.ts` | One handler per tool: build argv, run, decode, map errors |
| `src/run-cli.ts` | `runCli(argv, { cwd, timeout })` through `ChildProcessSpawner`; returns `{ exit, stdout, stderr }` |
| `src/resolve-cli.ts` | The resolver chain, below |
| `src/config.ts` | The only env reader (`STACKS_MCP_CLI`, `STACKS_MCP_LOG_LEVEL`) |
| `src/errors.ts` | Tagged errors with fixed messages |
| `src/schemas.ts` | Permissive decoders for the CLI's `--json` results |
| `tests/`, `e2e/` | Unit tests; the stdio handshake against `dist/server.js` |

### Finding the CLI

No `bin` or `exports` changes to `packages/cli/package.json` for this phase (D-c, confirmed
2026-10-27). The server is not a consumer of a published package yet, so it resolves the CLI it is
developed beside and says so plainly when it cannot. First match wins, resolved once at startup, in
`resolve-cli.ts`:

1. `STACKS_MCP_CLI`, an absolute path to a CLI entry point. This is what the tests and a local
   client set, and it is the only supported way to point the server at something else.
2. The monorepo sibling: `<packageRoot>/../cli/src/bin.ts`, run through `bun` when `bun` is on `PATH`,
   which is the checkout this phase is developed in.
3. Nothing: the server writes one line to stderr naming the package and the variable, and exits
   non-zero before registering a tool.

Deliberately dropped from the earlier draft: the `createRequire(...).resolve("@steamfield/stacks/package.json")`
step and the dependency-`bin` lookup. Both need the `exports`/`bin` surface that D-c excludes, and
neither can work before 1.6c publishes. Adding them now builds the distribution path ahead of the
distribution, and puts a resolution branch in the server that nothing in this phase executes.

How the target is run depends on what it is, not on a flag: a path ending `.ts` runs as
`bun <path>`, a path ending `.js`, `.mjs` or `.cjs` runs as `process.execPath <path>`, anything else is
executed directly. Arguments always go as an
argv array; no tool ever builds a shell string. This is the one place `node:module` and
`process.execPath` are used, and it is the only file that may.

The CLI is never looked up on PATH, and a `stacks` earlier on PATH is never run. That is what
keeps the server's behaviour pinned to the version it shipped with.

### Tools and resource

| Tool | Parameters | Runs | Success payload |
|---|---|---|---|
| `stacks_list` | none | `list --json` | the `ListResult`: `entries`, `rejected` |
| `stacks_new` | `stack`, `dir`, `with?`, `without?`, `sandbox?`, `yes?` | `new <stack> <dir> --json` plus `--with`/`--without`/`--sandbox`/`--yes` | the `NewResult`: `project`, `brief`, `briefWords`, `written`, `handoff`, `untrusted`, `missingTools`, `warnings` |
| `stacks_verify` | `dir`, `only?` | `verify --json` with `cwd: dir`, plus `--only a,b` | the `VerifyResult`: `outcome`, `scope`, `totals`, `steps`, `changed?`, `tamperCheck` |

Plus one resource whose URI begins `stacks://brief/`, returning `.stacks/BRIEF.md` as
`text/markdown`. Its content is the file's bytes, unchanged.

Descriptions are written for the agent reading them: `stacks_new` never launches an agent
(`--json` implies it) and the returned `handoff.prompt` is the caller's next task;
`stacks_verify` runs the project's own steps and weakening one is failure, not a retry;
`VerifyChanged` means stop and ask the person.

Success schemas decode only the fields the server promises, so a field the CLI adds later cannot
break a call. `new` and `verify` accept an absolute or a relative `dir`; a relative one resolves
against the client's working directory, which the server reports in the result rather than
guessing.

### Failure mapping

`runCli` never throws for a CLI failure. The handler inspects the exit code:

- **0** — decode stdout, return the result.
- **5** with a result on stdout (`VerifyFailed`, `VerifyChanged`, `ValidationFailed`) — the handler
  fails with the tool's declared failure carrying `{ exit, error, result }`, so the client sees
  `isError: true` and the content holds both the envelope and the report. Verified against
  `dist/ai/McpServer.js`: a declared failure becomes `CallToolResult` with `isError: true` and no
  `structuredContent`, so the content is text and the test parses it.
- **Anything else** — the same failure shape with `result` absent. The CLI's envelope is the last
  stderr line (`errors.ts::encodeDetails`); when that line is not JSON the failure says so and
  carries the exit code and the last line verbatim.
- **Spawn failure or timeout** — a distinct tag naming which, with the timeout in the message. The
  server stays up and answers the next call.

Tool timeouts: 30 s for `list`, 120 s for `new`, 600 s for `verify`, all configurable through
`config.ts`. A verify that a client itself times out is documented in the tool description, with
`only` named as the way to work in slices.

### Trust

The roadmap's trust model applies unchanged, because the server is a different front door to the
same program: `new` always passes `--json`, which never launches an agent; an untrusted entry
appears in `result.untrusted` and in the brief, and the tool description tells the agent to stop
and ask the person; `verify` runs the manifest's steps, exactly as a shell would, and the client's
own tool approval is an extra check, not a replacement. The server runs with the client's
environment, so the CLI's agent detection and refusals still apply to anything it does.

### Part 2 acceptance tests

Numbered in continuation of Part 1's list, under this plan's one `## Acceptance tests` section.
They live in `packages/mcp/tests` and `packages/mcp/e2e`, which the root trace harness does not
scan, which is why the plan carries no `traced` line.

## Acceptance tests

Part 1, against the repo:

1. `stacks validate` on the bundled registry exits 0 with zero errors and zero warnings and
   lists `typescript-mcp` [4.3#1].
2. `new typescript-mcp <tmp> --sandbox --json` writes the project, `briefWords` is within 6,000, no
   written file keeps a `{{` token, and `handoff` records `inside-agent` when the caller is inside an
   agent (an agent marker beats `--json`) or `print` otherwise, without launching anything [4.3#2].
3. `bun run test` at the root passes: `tests/registry.test.ts` runs `new` for the new stack in both
   presets and checks the brief size, the D7 verify layers and the rendered templates [4.3#3].
4. `stacks validate --brief typescript-mcp` reports a body under the 2,000-word limit and a
   composed brief under 6,000 [4.3#4].

Part 2, against the built server:

5. An `McpClient` from `effect/ai` connects over stdio to `dist/server.js` with
   `McpProtocol.v2025_11_25`, lists exactly the three tools and the one brief resource
   [4.3#5].
6. `stacks_list` returns the same JSON as running the resolved CLI `list --json` directly,
   compared field by field after parsing [4.3#6].
7. With a fake `stacks` earlier on PATH that would fail, tools still work: the CLI is resolved
   through the dependency, never PATH [4.3#7].
8. `stacks_new` into a temp dir writes the brief and the manifest, returns a `handoff` that
   records `inside-agent` or `print` for the server's own environment, and starts no agent process
   (a fake agent earlier on PATH leaves no marker file) [4.3#8].
9. `stacks_verify` on a fixture with one failing step returns `isError: true`, the exit code
   5, the error envelope and the failing step's name [4.3#9].
10. A composition whose entry is untrusted returns a non-empty `untrusted` list from
    `stacks_new` [4.3#10].
11. The brief resource returns the file's exact contents, byte for byte [4.3#11].
12. `stacks_new` with a missing `stack` parameter fails as a parameter error, not as a crash,
    and the server answers the next call [4.3#12].
13. `bun run check` at the root is green, including `packages/mcp`'s scripts, and
    `stacks verify` is green inside `packages/mcp` [4.3#13].

### Realistic edge cases

14. A CLI that exits non-zero with a non-JSON last stderr line yields `isError: true` naming the
    exit code and that line, and the next call still works [4.3#14].
15. A verify step that outlives the tool timeout yields a timeout failure naming the tool, and the
    server keeps serving [4.3#15].
16. No resolvable CLI at startup: the process exits non-zero with one line naming the package, and
    registers no tool [4.3#16].
17. Two tool calls in flight at once do not interleave: each result matches its own argv, and
    neither corrupts stdout with a log line [4.3#17].

## Order of work

1. D-c: `bin` and `exports` in `packages/cli/package.json`; `bun run build`; the compiled binary
   still runs.
2. Part 1: `STACK.md`, `files/README.md.tmpl`; `validate`, then `validate --brief`; fix warnings.
3. Dogfood: `new typescript-mcp <tmp> --sandbox` outside any repository, follow the brief to a green
   verify. This runs the brief as an agent would, before it is used for anything real.
4. Part 2: scaffold `packages/mcp` (delete the two placeholder files first; inside this repo, pass
   `--without git-hooks --without ci-github`, because both carry `needs_own_repo`), implement, unit
   tests, handshake e2e.
5. Register the built server in one real client and take a sandbox project to green through the
   tools alone; write the run note.
6. `bun run check` at the root; update this file's status and `plans/HANDOFF.md`.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/registry/stacks/typescript-mcp/STACK.md`, `files/README.md.tmpl` | New |
| `packages/cli/package.json` | `bin` and `exports` (D-c) |
| `packages/cli/README.md` | One row in the bundled stacks table |
| `packages/mcp/package.json`, `tsconfig.json`, `biome.json`, `scripts/` | Filled in by the stack, then adjusted to the monorepo's script names |
| `packages/mcp/src/`, `tests/`, `e2e/` | New |
| `plans/phases/phase-4.3-mcp-server.md` | This file |
| `plans/archive/dogfooding-log-2026-10-27.md` | New: the pitfalls found using the tool on itself, archived because it predates the port |
| `plans/runs/<date>-mcp-client.md` | New: the registered-client run |
| `AGENTS.md`, `README.md` | The new package and stack, once it exists |

## Where this stage stopped (2026-10-27)

Part 1 is done and pushed. Part 2 is done and pushed: `packages/mcp` serves `stacks_list`,
`stacks_new`, `stacks_verify` and carries `stacks://guide` plus one `skill://` URI per file
in `skills/`, all proven over stdio by `e2e/stdio.test.ts` and `e2e/dogfood.test.ts`. Branch
`feat/phase-4.3-typescript-mcp-stack`.

Parked mid-conversation, pick up here:

- **An interactive run was started and not finished.** `new --wizard` was driven prompt by prompt as a
  puppet of the operator's answers, and scaffolded `stacks-projects/wizard1/app` (typescript-mcp,
  agents claude and opencode, no sandbox, no `--yes`, no launch, brief 5,514 words). Its twelve
  `## Decisions` questions were put to the operator and are **unanswered**. Nothing has been built there.
- **The dogfood build at `stacks-projects/served1/app2` is unfinished.** Dependencies and
  `docs/harness.md` exist; `src/`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `scripts/build.ts`
  and `e2e/` do not. Two OpenCode runs ended without touching those files (DF-41).
- **Open, and first on the list when we resume:** the wizard cannot show what is buildable (DF-38). The
  operator wanted an MCP server and the interactive path never revealed `typescript-mcp`; the stack had to
  be named from memory.
- **Budget pressure:** the full composition composes to 5,514 words against a 6,000 limit, and every
  fragment edit is charged to this stack.
- **Not attempted:** elicitation for the interrogation, prompts as parameterised templates, and the
  stderr telemetry shape the other tools use. Skills ride on `skill://` resources because `effect/ai`
  4.0.6 registers tools, resources and prompts only — SEP-2640's `skills/list` and `skills/get` cannot
  be served, and declaring the extension without them would be false.

## Deviations from the plan as written

| The plan said | What shipped | Why |
| --- | --- | --- |
| Three tools plus a `stacks://brief` resource (D-a) | Three tools plus `stacks://guide` and one `skill://` resource per file in `skills/` | A brief is per project and only exists after `new`. What an agent needs *before* creating anything is the manual, and the skills layer carries the authoring knowledge. |
| Skills over MCP, following SEP-2640 | Skills as `skill://` resources, no extension declared | `effect/ai` 4.0.6 registers tools, resources and prompts only; there is no way to serve `skills/list` or `skills/get`. Declaring the extension without them would be false. |
| Scaffold the package in place at `packages/mcp` (D-b) | Scaffolded to a sibling and copied in | `new` refuses a non-empty target and has no merge flag; `packages/mcp` already held a placeholder `package.json` and `README.md`. |
| No `bin` or `exports` changes (D-c) | None added | Confirmed. The server creates an instance and hands off; it is not a consumer of a published package. |
| No npm publish (D-d) | None | Release-time work. |
| Resolver: `STACKS_MCP_CLI`, then the sibling `../cli/src/bin.ts` | As written, no PATH lookup | The fallback chain is deliberately two steps so a misconfigured install fails loudly. |
| The stack ships no agent adapters | `claude-harness` required, adapter settings merged, allow list for this package's scripts | `tests/registry-hooks.test.ts` requires every bundled stack to write `.claude/settings.json`; without the fragment a project from this stack got no hooks at all. |
| Elicitation, prompts and stderr telemetry as follow-ups | Telemetry shipped as one line per tool call; elicitation and prompts not attempted | Deliberately deferred, not forgotten. |
| The interactive wizard lets a person discover what exists | Not fixed on this branch | Found during the puppet run (DF-38); belongs to the interaction revision set, which is its own branch. |

Extra documentation written with this stage: `packages/mcp/README.md` now describes the three tools with
their real outcome vocabulary, the resource scheme, the skill file format, how to wire the server into a
client, and the SEP-2640 limit stated plainly.

## What this plan may get wrong

- **`effect/ai` is unstable.** `McpClient.ProtocolVersion` already excludes the older revisions a
  client might prefer, and a 4.x minor can change these modules again. Re-check exports and
  protocol constants against the installed `.d.ts` files before writing code, and record any pin
  under Build workarounds.
- **The stack may not be enough to build from.** It is prose, like every other stack; if the
  dogfood run needs three corrections to the brief's own instructions, those corrections are the
  finding, not a failure, and go into the plan.
- **`bin` in the CLI package is a 0.2 concern.** Adding it early is the smallest change that makes
  the resolver honest, but 0.2 may want a different shape (`dist/stacks.mjs`). The resolver
  handles both, so a later change costs one branch.
- **`verify` is the slow tool.** A brief-driven build can outlive any client's tool timeout. If the
  run note shows that happening, the fix is progress notifications or an `only` loop, not a longer
  timeout.
- **Dogfooding in place couples the package to one stack version.** `packages/mcp`'s verify steps
  come from the manifest written at scaffold time; changing the stack later does not update them.
  That is correct (D14) but worth knowing when the stack changes.
