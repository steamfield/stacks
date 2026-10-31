# Phase 3.4b: Native agent adapters

Status: EXECUTED 2026-10-27 (Codex, OpenCode and Cursor adapters for `agent-ops` and the five
portable fragments, a reference check per format, the Claude Code plugin manifest and its
publishing procedure). Unproved: the `codex` bench run, OpenCode and Cursor until 2.0b has
adapters for them, and the first marketplace publication; all three are the maintainers'.
Drafted 2026-10-26.
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | Users of Codex, OpenCode and Cursor get the same guardrails and agent config Claude Code users get: the `agent-ops` fragment ships `adapters/codex/`, `adapters/opencode/` and `adapters/cursor/` in each agent's documented config format (D27), each proved by a bench run with that agent where a headless adapter exists, each covered by a 2.2-style reference check, and the agent skill (3.4c) gets a plugin marketplace listing |
| Traces to | Assumption "Handoff to whatever agent is on PATH is the right entry point" (confidence low); Job 1: "with tests, lint, CI and agent config"; the coding agent as the CLI's main reader |
| Depends on | [1.6a](phase-1.6a-bundled-stack-content-2026-10-30.md) (`agent-ops`), [1.6d](phase-1.6d-guardrail-hook-fragments-2026-10-30.md) (its Claude Code hooks, the reference for behavior), [2.0b](phase-2.0b-bench-2026-10-30.md) (the `codex` adapter, `hooksFired`), [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md) (the reference-check module this extends), [3.4c](phase-3.4c-agent-skill-2026-10-30.md) (the skill the listing publishes; the adapters themselves don't need it) |
| Blocks | Nothing |
| Decisions needed | D27 (native adapters in bundled fragments). [Open question 28](../../risks-and-open-questions.md#open-questions-for-the-maintainers) (default target agents): this sub-phase doesn't change the default, but its value to a non-Claude user depends on that answer. D24 for any new bench adapter |
| Settles | Which agents get native config, in what order, and the rule for adding one; how each adapter is proved and checked; the skill's marketplace listing |

## Scope

In:

- For `agent-ops` (and any other bundled fragment that ships `adapters/claude/`), an adapter per agent, only where the agent documents the format:

| Agent (`AgentId`) | What the adapter ships | Proved by |
|---|---|---|
| `codex` | Its project config file with the sandbox and approval policy stated by intent, and its hook or rules mechanism for the destructive-command and secret-write guards, if documented; otherwise the guards are stated in AGENTS.md and the adapter ships config only | A 2.0b bench run with the `codex` adapter, `hooksFired` recorded |
| `opencode` | Its project config with permission rules for destructive commands, its plugin or hook mechanism for format-on-stop and lint-on-write where documented | A bench run once a headless adapter row exists in 2.0b; until then a composition test and the reference check, and the run note says it is unproved |
| `cursor` | Its project rules files (always-applied rules carrying the guardrail instructions) and its hooks file where documented | Same as `opencode` |

- The shared hook scripts from 1.6d (`.claude/hooks/*.sh` and the shared shell library) reused by path where the agent can call a script, so behavior is one implementation. A script that reads Claude Code's hook input format gets a small adapter shim per agent, never a fork of its logic.
- A reference check per adapter format, extending 2.2's shipped-reference module: every hook or command entry in the agent's config names a composed file or a key of the merged `commands` map, and the config file parses.
- The skill's marketplace listing: a plugin manifest for the agent skill 3.4c ships, published to a plugin marketplace repository the maintainers own, with a manual publishing procedure in the package README.

Out:

- The TypeScript harness (3.4a) for other agents.
- Changing the default target agents ([open question 28](../../risks-and-open-questions.md#open-questions-for-the-maintainers)).
- New `AgentId` values. The set stays the roadmap contract's four.
- CI publishing of the marketplace listing (phase 5 if ever automated).

## Design

### Where this fits

1.0 defined `adapters/<agent>/` and `AgentId` from the start; 1.1 includes an adapter only for agents in `targetAgents`. Until now only `adapters/claude/` had content, so a user whose agent is Codex got AGENTS.md and nothing that enforces anything. This sub-phase fills the other directories. No CLI code changes for composition: the mechanism exists.

### Rule for adding an adapter

An adapter for an agent lands only when:

1. The agent documents the config format (a page or schema the adapter's change links). Undocumented formats are not reverse-engineered.
2. Its files compose with the stack's other fragments without a second owner (1.1) and with JSON merges where the format is JSON.
3. The reference check for its format passes with zero findings.
4. A bench run with that agent is `pass`, when 2.0b has an adapter for it. Without one, the adapter lands marked unproved in the package README's agent table, and the first bench adapter for that agent proves it.

### Order

`codex` first (2.0b already has its bench adapter), then `opencode`, then `cursor`.

### Usage signal

This sub-phase adds no telemetry and depends on none. Whether an adapter is worth maintaining is a maintainers' call from issues and bench notes; if telemetry (phase 4) later reports target agents, that is its own field with its own reader, defined there.

### Marketplace listing

3.4c ships the skill inside the npm package with an install path for Claude Code. The listing adds a plugin manifest that points at the same skill content, so a user can install it from the agent's plugin browser. The manifest's version follows the CLI release that shipped the skill. Publishing is a maintainer step after a CLI release; the procedure is in the package README.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/registry/fragments/agent-ops/adapters/{codex,opencode,cursor}/` | Adapter content |
| `packages/cli/registry/fragments/agent-ops/files/` | Shared hook scripts made agent-neutral where needed, plus input shims |
| `packages/cli/src/core/validate/shipped-refs.ts` (2.2's check module) | One reference check per adapter format |
| `packages/cli/tests/validate-shipped.test.ts`, `tests/fixtures/registries/*` | A fixture per new check |
| `packages/cli/tests/registry.test.ts` | Composition per agent |
| `packages/cli/plugin/` | The marketplace plugin manifest for the 3.4c skill |
| `packages/cli/registry/runs.json`, `plans/runs/` | Bench records and notes per agent |
| `packages/cli/README.md` | Agent table (proved or unproved), marketplace publishing procedure |

## Acceptance tests

1. For each bundled stack and each agent: `new <stack> --agents <agent> --no-launch --json` writes that agent's documented config and no other agent's config; `--agents claude,codex` writes both with no ownership conflict. Codex's default project policy is `workspace-write` with `on-request` approvals. The portable guidance fragments identified below also supply valid agent-readable instructions or skills. OpenCode lints written files and formats session files on idle through documented callbacks.
2. Each new reference check has a fixture naming a missing composed script and one naming an undeclared project command, each giving exactly one error; valid references give zero findings. Use existing `ref-hook`, `ref-command` and `ref-json` codes; invalid TOML gives `ref-toml`. Include Codex inline TOML hooks, OpenCode formatter command arrays and permission rules, and Cursor hooks.
3. The shared guard, reached through each agent's configured hook or local plugin with a recorded or documented representative payload, blocks the same destructive command as Claude Code and permits a near miss. Codex Bash can call the shared script directly; native `apply_patch` writes need translation from `tool_input.command`. OpenCode's documented plugin callback rejects to block, rather than consuming stdin itself.
4. The Claude Code plugin manifest decodes against the recorded metadata/skills schema and names a contained skill directory with the same content as `packages/cli/skill/SKILL.md`; its version matches the CLI package. See the packaging gap below.

Maintainer-owned proof, 2026-10-27 (formerly the fourth unnumbered acceptance item): a real `codex` bench run of one bundled stack is `pass` with `hooksFired` non-null. This is not an automated acceptance number, following 2.0b's real-run split. Marketplace publication is also maintainer-owned and remains an exit criterion.

### Realistic edge cases

5. Configured guards still run through a symlinked project path containing spaces and non-ASCII characters.
6. References resolve files and commands supplied by another merged owner, with one correctly attributed finding across repeated validation compositions.
7. Malformed or wrong-case native config reports a format/schema finding without cascading references; documented OpenCode JSONC comments and trailing commas still allow reference checks.
8. Explicit target agents override inherited agent markers and repeated agent names are deduplicated without leaking other agents' config.
9. Secret-write translation preserves quotes, backslashes and newlines, handles Codex additions, updates and multi-file patches, blocks credentials and real `.env` files independently, and permits example files and harmless writes.
10. The package README's agent table distinguishes enforced guards from instructions and labels OpenCode/Cursor unproved with the missing bench-adapter reason.

## Exit criteria

- Acceptance tests pass; `bun run check` green from the repo root.
- `codex` adapter proved by a bench run; `opencode` and `cursor` landed proved or listed as unproved in the README with the reason.
- The marketplace listing published once by a maintainer, recorded in HANDOFF.

## What this plan may get wrong

- Reference findings extend 2.2 with `ref-toml` (invalid TOML syntax) and `ref-config`
  (invalid native reference structure, including wrong-case keys). Both are errors and
  skip reference checks for that file, as `ref-json` does for invalid JSON. Native
  commands resolve against the merged commands map; Claude retains 2.2’s inline-code allowance.

- Agent config formats move faster than stack prose, which is the rot D1 warns about. Adapters ship only config whose shape is stable and documented; 2.2's dated-phrase check and the bench are the tripwires.
- Some agents have no hook mechanism. For them the guardrails are instructions, which an agent can ignore; the README's agent table says which agents get enforced guards and which get instructions.
- The input shim per agent is a seam where behavior can drift. The shared sample-payload test is the guard.
- Shared shell guards must move from `agent-ops/adapters/claude/.claude/hooks/` into `agent-ops/files/.claude/hooks/` to compose once for every target. The existing 3.4a `agent-harness-hooks.test.ts::project` helper copies the old source directory directly; its source setup must follow the move without changing behavioral assertions. The adapter-content contract excludes existing test edits, so this needs an orchestrator-owned helper update.
- Existing `bundled-compositions.test.ts` pins legacy canonical brief hashes. Keep those fragment bodies unchanged; native configuration and instruction files carry the new adapter guidance without adding prose to those briefs.
- OpenCode also documents native `apply_patch` callbacks with `args.patchText`. They use the same patch translator as Codex for guards, and collect every added, updated or moved path for linting and session formatting. An object-valued formatter config enables built-ins, so disable the documented built-ins explicitly before deferring formatting to idle. The offline regression host models this documented dispatch with a real local Ruff executable; it does not prove live OpenCode behavior.
- D5, D18 and D27 are currently in `plans/requirements.md`, not the decisions log in `plans/README.md` named by the contract. Their format and budget constraints still apply.
- Codex documents hook entry-point lookup from the git root and runs commands in the session cwd; it does not document a project-dir environment variable for project hooks. The entry point therefore follows that documented lookup; shared libraries and protocol shims resolve paths from their own file location. A live linked-worktree discovery check remains necessary.

### Format findings checked 2026-10-27

- Codex documents project `.codex/config.toml`, `.codex/hooks.json` and the matching hook payload/deny protocol in [advanced config](https://developers.openai.com/codex/config-advanced/) and [hooks](https://developers.openai.com/codex/hooks/). The contract's codex-cli 0.164 Bash recording agrees. Native edits differ: the docs report `tool_name: "apply_patch"` with patch text in `tool_input.command`; `Edit|Write` are matcher aliases, not payload tool names. Secret-write tests use patches. Project trust is required; the contract also records main-checkout hook discovery from linked worktrees. The offline tests prove dispatch and guard behavior, not trust/worktree discovery inside a real agent. Sandbox and approval choices above express the default intent; sandbox-preset policy remains outside these tests.
- OpenCode documents [JSON and JSONC project config](https://opencode.ai/docs/config/), [permission patterns](https://opencode.ai/docs/permissions/), [auto-loaded local plugins and tool callbacks](https://opencode.ai/docs/plugins/), and [formatter command arrays](https://opencode.ai/docs/formatters/). Therefore an instructions-only fallback for guards is not justified. The tests host the local plugin boundary with real Bun and filesystem paths, without a live agent. This selects the documented OpenCode 1 format; the separately documented V2 format is not silently mixed into it. Offline lifecycle tests send write/file-edited and session-idle callbacks and observe a real local tool executable; live-agent lifecycle proof remains unproved.
- Cursor documents [project hooks, preToolUse, matchers and permission output](https://cursor.com/docs/hooks) and [MDC project rules](https://cursor.com/docs/rules). Tests select `preToolUse` for shell and write guarding, with `alwaysApply: true` project rules for guardrail instructions; this covers writes before they occur as well as shell commands. Cursor's documented response uses `permission`, unlike Claude/Codex. The payload fixture is transcribed from docs, not claimed to be a live recording.
- The skill is a Claude Code skill, so the listing uses [Claude Code's plugin manifest](https://code.claude.com/docs/en/plugins-reference), at `plugin/.claude-plugin/plugin.json`. Component paths must stay inside the plugin root: `../skill` is invalid. Ship a content-identical skill directory under `plugin/`; `skills` may name that directory directly or its parent scan directory. The test prevents drift. The schema is documented as field tables, so the fixture explicitly transcribes its metadata/skills subset. `packages/cli/package.json` is private and has no `files`, `bin` or packing script; AGENTS.md "Deferred" postpones distribution. No packed artifact exists to assert on today. A future release test must inspect the tarball; these tests check the shipped source tree.

### Bundled fragment inventory and adapter decisions

Eight fragments currently ship `adapters/claude/` (including hidden files):

| Fragment | Counterpart decision and reason |
|---|---|
| `agent-ops` | All three: native config, shared bash guards with protocol translation where needed, plus guardrail instructions. |
| `bun-release` | All three: portable build/checksum/update guidance belongs in documented instructions or skills. |
| `effect` | All three: portable Effect guidance belongs in documented instructions or skills. |
| `rr` | All three: portable remote-test guidance; Claude's marketplace registration stays Claude-only. |
| `openrouter-chat` | All three for portable app rules, skills and workflows; no automatic migration of Claude plugin settings. |
| `openrouter-chat-cli` | All three for portable app rules, skills and workflows; its TypeScript harness guards/tests stay Claude-only under the 3.4a exclusion. |
| `claude-harness` | No counterpart here: the TypeScript harness, review agents and commands are explicitly outside this sub-phase. Its `requires: [agent-ops]` still supplies base native guards. |
| `ce-plugin` | No counterpart: it explicitly installs the Claude Essentials marketplace plugin and routes Claude skills; inventing another agent's plugin packaging is outside scope. |

Portable instruction forms: Codex [AGENTS.md](https://developers.openai.com/codex/guides/agents-md/) or [project skills](https://developers.openai.com/codex/skills/); OpenCode [AGENTS.md and configured instructions](https://opencode.ai/docs/rules/) or [project skills](https://opencode.ai/docs/skills/); Cursor MDC rules. Tests accept those forms without prescribing filenames for each fragment. A brief-only copy does not count as an adapter. Stacks also ship Claude-specific TypeScript harness extensions, intentionally left with 3.4a; composition itself already supports all four `AgentId` values and needs no new flag, result field or test-facing export.
