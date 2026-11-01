---
schema_version: 1
id: openrouter-chat-cli
kind: fragment
category: app
name: OpenRouter CLI chat
description: "A terminal chat app for typescript-cli on OpenRouter: an OpenTUI chat screen and scriptable commands with NDJSON events, tools also served by a stdio MCP server, chats saved as JSON with Markdown export, stubbed replay and eval checks, and Claude Code, Codex, OpenCode and Cursor guidance."
tags: [typescript, cli, tui, ai, openrouter]
applies_to: [typescript-cli]
requires: [openrouter-ai, claude-harness]
deps:
  app: ["@effect/ai-openrouter", "@opentui/core", "@opentui/react", react]
  dev: ["@types/react", "@xterm/headless"]
tools: [bun, node]
merge: [.claude/settings.json]
decisions:
  - "OpenTUI packages: pin core and React adapter to the same exact compatible release while pre-stable (default)."
  - "Chat storage: one JSON file per chat under the data directory (default); concurrent writes are last-write-wins and documented under Deferred."
verify:
  - name: app-boundaries-plugin
    layer: check
    run: "grep -q 'chat-boundaries.grit' biome.json && ! grep -q '\"./biome-plugins/boundaries.grit\"' biome.json"
  - { name: app-stub, layer: test, run: bun run stub && bun run stub:stop }
  - { name: app-tui-test, layer: test, run: bun run test:tui }
  - { name: app-tui-smoke, layer: test, run: bun run tui:capture -- --smoke }
  - { name: app-eval-dry-run, layer: test, run: bun scripts/check-eval-dry-run.ts }
  - { name: app-e2e, layer: test, run: bun run app:e2e }
  - { name: app-acceptance, layer: test, run: bun run test:unit tests/app-acceptance.test.ts }
commands:
  test: Run unit and TUI test suites
  test:tui: Run isolated OpenTUI renderer tests with Bun
  app:e2e: Build and run stub-backed compiled application and PTY tests
  tui:capture: Capture a scripted TUI session through a pseudo-terminal; --smoke walks the chat UI against its own stub
  stub: Start or reuse this checkout's stub OpenRouter and print shell exports for it
  stub:stop: Stop this checkout's stub OpenRouter
  check: Run lint, typecheck, unit/TUI tests, base binary checks, and app e2e
---

# OpenRouter CLI chat

Implement `scripts/eval.ts` with `--dry-run --models <csv> --report <path>` per `docs/eval-report.md`. Verify runs the shipped independent report checkpoint (`scripts/check-eval-dry-run.ts`), and the shipped `.eval/.gitignore` keeps results out of git. Keep runner/scoring and real app calls agent-owned.

Read `docs/guidance/openrouter-chat-cli/index.md` before implementation; it supplies the shared guidance for every selected agent.

Implement `docs/acceptance/openrouter-chat-cli.md`: the focused acceptance suite, PTY smoke and dry-run eval must assert search/filter/selection and complete reports/deadlines. Opening a screen or exit 0 alone is insufficient.

Build after the base doctor/version slice passes. Keep the stdout/error/runtime contract. Read DESIGN.md, the shared app guidance (`tui.md`, `design-slop.md`, `workflows.md`), and `docs/ask-turn.md` before working on the turn loop. Add ask, chat, models, extract, chats, export, and mcp. Distribution remains optional; no installer/update/release server is required by this app.

## Commands and storage

`ask` accepts text or piped stdin, streams human text, and emits typed NDJSON events under --json. `chat` opens the terminal UI, requires terminal stdin/stdout, and otherwise returns NotInteractive pointing to ask. Piped input never blocks waiting for a terminal keyboard. Both support --model and --resume. `models` lists/searches model metadata; explicit unknown models fail, unspecified models use the configured default, and unavailable discovery falls back safely. `extract` decodes Contact from text. `chats` lists stored chats; `export <id>` writes Markdown; `mcp` exposes the tools over stdio with protocol frames as its only stdout.

Keep commands thin. `core/chat.ts` owns runTurn, models.ts resolution, extract.ts output, export.ts chatToMarkdown, upstream.ts error mapping, input.ts decoding, stdin.ts piped text, and mcp-stdio.ts transport adaptation. Services are Llm, OpenRouterModels, and ChatStore beside the base Output/Host. Build the provider lazily so help/version/doctor work without a key. Configure request settings once from vendor config: fallback models, routing, output limits. Store API keys only in redacted env config, never config.json; test that a key in the closed config file cannot reach requests.

ChatStore writes `<data-dir>/chats/<id>.json` through a temporary file and rename, with a fresh memory layer in tests. Decode stored content; preserve user turns, tool events, final/partial replies, metadata, and interrupted state. Resume reconstructs model history. Default paths follow XDG; dev uses .dev/data. Export includes roles, text, tool calls, model/tokens/cost. Document no concurrent-update locking.

## Turn loop and tools

Install `effect` and `@effect/ai-openrouter` together so the provider's peer range resolves. Inspect the installed Effect and provider package exports and declarations for the current CLI, AI, and HTTP module paths, then record them in `docs/guidance/effect/api.md`. Effect AI streaming performs one model step. runTurn explicitly loops after tool calls, appending response parts to the prompt and stopping at MAX_TOOL_STEPS. Emit typed TurnEvents for text deltas, tool calls/results, then exactly one finish with the complete reply; aggregate per-step tokens/cost and actual served model. Keep OUTPUT/TOKEN/STEP/STREAM limits configurable.

Retry only retryable failures before any part of that step has been emitted, at most twice with exponential delay starting at 500ms. Never retry a partially consumed stream. Enforce max duration by interrupting with a timeout error, not silently ending the stream. Finalize once on success, failure, consumer return, or cancellation: save the partial reply as interrupted unless a finish event was produced, and log one llm-call record. Consumer early return may have a successful Effect exit, so do not infer completion from exit status alone.

Map AiError reasons once using the vendor fragment's policy. Cap safe upstream reason text; keep raw bodies/headers/stack traces private. Use deterministic CurrentTime with IANA timezone input, Effect Tool/Toolkit schemas and service-based handlers; return validation failures to the model where supported. ExtractContact joins the chat toolkit in McpTools. Pin schemas actually sent after provider/model-family rewrites, use descriptions before refinements, and avoid identifiers that introduce unsupported references. Decode structured output again; return InvalidModelOutput on failure, with usage/served model retained for eval reporting.

MCP serves Effect's McpServer stdio transport. Test stdin EOF with in-flight calls; if the installed transport drops responses, drain until pending replies finish with a bounded deadline. If EOF interrupts the server parent, scope it in a child fiber so normal closure exits zero. Record either workaround only when reproduced.

## TUI and platform boundary

Only src/tui/launch.tsx imports Effect inside the TUI: capture runtime context and expose a plain ChatBridge (functions/promises/async iterable, safe errors). Components use plain UiEvents. Stop calls the turn iterator's `return()`, which must interrupt the stream (`tui.md` has the shape), so the turn finalizer persists partial output. Load the renderer dynamically through commands/load-tui.ts; failures become TuiUnavailable. Other commands, Vitest modules, and shared types must not load OpenTUI. Extend doctor with --tui to probe native loading and, at a terminal, create/destroy a renderer.

Acquire/release the renderer as an Effect resource; Effect owns signals and exit status. Configure renderer Ctrl+C/exit signal/console interception off and pin those options in a test. Raw-mode Ctrl+C stops the reply, quits, and exits zero. Every component-started promise handles rejection in the UI. Colors come from theme.ts only. Follow DESIGN: header, message list, bordered one-line composer, footer hints; Enter send, Esc stop/close, Ctrl+P model picker, Ctrl+E export, Ctrl+C quit. Cover empty, streaming, tool, complete, interrupted, error, and models-unavailable states. Show usage/cost/model, correct focus, and terminal-size behavior.

Use the app-owned `chat-boundaries.grit` in place of the base `boundaries.grit` plugin entry; it retains base rules while adding TUI boundaries. Then delete `biome-plugins/boundaries.grit`; `app-boundaries-plugin` checks the swap. With Claude selected, the base write guard reads the app-owned platform-paths declaration and the app write guard enforces the narrower TUI bridge and dynamic imports; wire each once. Other adapters rely on Grit and the required tests unless their native config explicitly installs an equivalent guard. Write an opentui skill against installed types covering renderer lifecycle, test renderer, keys, layout, text, native packages, and known workarounds (start from the traps in `tui.md`); keep changing API guidance out of shipped reference docs.

## Stubs, capture, recording, evals

The shipped stub controller (`scripts/stub.ts start|stop`) and pid helper own only checkout-local processes; wire them as the `stub` and `stub:stop` scripts. Implement scripts/stub-server.ts using startStubOpenRouter on the port in its first argument (the controller passes prefixed STUB_PORT, default 5190), writing `logs/stub.pid` as pid/provider-port and removing it on SIGTERM. `app-stub` starts and stops it, so the controller, helper and server run together. Shell exports are safely quoted; data stays in .dev/data. Never require a release port or release helper unless bun-release is selected. Reuse a matching live process, ignore stale unrelated pids, and stop only the tracked process.

Write `scripts/tui-capture.ts` and `lib/pty.ts` with Bun's installed PTY API and xterm/headless. Support typed key tokens (enter/escape/tab/arrows/control/wait), cols/rows, wait-for text, alternate binary, no-quit, and CLI flags after `--`. Print settled screen text, send Ctrl+C when appropriate, report exit code, and reuse spawnPty in app e2e. `--smoke` is the TUI's verify step: it starts its own stub on an ephemeral port, runs `chat` from source, sends a message and waits for the reply, opens the model picker (Ctrl+P), types a search and checks filtering, selects a non-default model, sends again and asserts that model in the stub request and reply metadata, exports (Ctrl+E) and waits for the confirmation, quits with Ctrl+C, and exits nonzero unless every screen appeared and the app exited 0. Dev preserves real terminal stderr for interactive runs while structured logs remain available.

A script layer uses fresh ConfigProvider/state, optional provider fetch, terminal-only logging, and guaranteed disposal. Recorder runs the app's real programs for plain and two-step tool turns, tees only completion response bodies, validates successful stop/text/tool use before replacing fixture files, and writes model/time metadata. Replay feeds exact bodies whole and in yielding seven-byte chunks through the real provider (`stub.replay(bodies, { chunkSize: 7 })`); derive expectations from SSE fixtures. Expose it as a `record:openrouter` script that refuses to start without a key; it spends money, so it stays out of the commands table, check, verify, and CI. With no recordings, skip explicitly with the recording command and a Pending user actions item.

Evals run real programs one case/model at a time with a deadline. Case ids are exactly `currentTime`, `concise-answer` and `extract` (the checkpoint requires them). Pure tested scoring yields pass/fail/error/truncated. Print model/case/verdict/finish reason/latency/tokens/cost/served model plus per-model totals and median latency; write timestamped results and exit nonzero on failures/errors or no passes. `--dry-run` points the runner at its own stub, scripted so every required case passes, with no key; it exits nonzero on any fail/error verdict or no passes, and verify runs it through the checkpoint. Recorder and live eval require a paid key and remain outside check/verify/CI.

## Testing and shared configuration

Keep base Vitest tests and compiled doctor/version tests. Add tests through runCli with real provider HTTP against owned stubs, fresh store/config/platform layers, and isolated env. Cover stdout purity on every error, human/NDJSON shapes, lazy no-key commands, invalid file config, model resolution, routing payloads, retry-before-first-part only, timeout, early cancellation persistence, tool limits, structured-output schemas, store/export, and MCP protocol/EOF. Drive time in program tests using TestClock; runCli itself uses live time.

TypeScript compiles TUI files with `jsx: react-jsx` and `jsxImportSource: "@opentui/react"`: intrinsic elements are OpenTUI's (`box`, `text`, `input`, `scrollbox`, `select`), not the DOM's, and DOM props such as `onClick` don't exist. TUI tests use Bun with a preload that clears all inherited credentials/URLs and gives HOME/XDG/data temporary paths before app imports. Use the real OpenTUI test renderer, assert controls/states/cleanup, and exclude these tests from Vitest. `test` chains test:unit and test:tui; scope each runner explicitly instead of forwarding arguments through the chain. Include app hooks in the shipped hook suite.

`app:e2e` builds the host artifact then runs Bun tests in app-e2e/ against local provider stubs and a scratch environment. Test ask output and JSON errors, tool/extract responses, persistence/export, MCP frames, and a PTY chat turn with usage, stop, and clean exit. A real PTY checks the embedded native package, dynamic loading, signal behavior, and no terminal corruption. Base e2e remains independently runnable. Add app-e2e and test:tui to check, include scripts/evals in typecheck, and update command docs, app rules, and environment tables.

<!-- stacks:when with=bun-release -->
Extend the stub process with startStubReleases on the next port, backed by the built binary (a harmless placeholder before a build). Add its port to the pid record and release exports under .dev/bin. Test install/update independently of the provider. Cross-builds install all optional native packages and select exactly the target's OpenTUI package; release smoke includes doctor --tui on each platform. Add TUI availability to release validation without making the app depend on release support.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
CI adds test:tui and app:e2e with local stubs, installs native packages for the needed targets, and uploads logs on failure. When bun-release is selected, install all platforms and run build:all. Never provide a live API key.
<!-- stacks:end -->

## Installed-library gotchas

If OpenTUI loads devtools when an inherited DEV variable is true, clear DEV in bin.ts before importing the renderer and record the workaround. If the test renderer does not report controlled input changes, use the submitted value and remount to clear it, with a regression. If the provider chunk schema drops the served-provider field, keep it null and document the limitation instead of inventing it. The Effect provider reports a mid-stream OpenRouter error (a 200 chunk carrying `error`) as an `error` stream part with no finish part, not a failed stream; map it through upstream.ts and finalize as interrupted (`stub.streamError` reproduces it). Bun's PTY API must exist for capture and app-e2e; record a required runtime upgrade rather than adding a native PTY dependency. Keep code signing, unsupported platforms, and concurrent chat write locking under Deferred.
