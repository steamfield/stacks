# Phase 3.2b: Source updates and the trust report

Status: DEFERRED 2026-10-27 to phase 4 or later, with 3.2a. Gated: starts only after 3.2a, which waits for outside demand and open question 18.

| Field | Value |
|---|---|
| Goal | Before a person trusts anything they didn't write, they see an allowlist report of every file it would write, with everything not plainly inert marked, plus every body, command, verify step and hook command; and a user can move a source's pin with `source update` after reading a diff of what changed |
| Traces to | Jobs: "the emotional job underneath all of these is trust: the user wants to start work in a project they don't have to audit first." Success row 5: "Stacks and fragments in `~/.stacks` and third-party sources." Risk: "Third-party stacks ship hooks or scripts the user's agent will run" |
| Depends on | 3.2a (sources, `Sources.fetch`, the trust store, `stacks trust`) |
| Blocks | Nothing. Nothing in phase 4 depends on it |
| Decisions needed | None new. Implements [roadmap, Trust model](../roadmap.md#trust-model) point 6 as written; if the maintainers wanted a blocklist instead, the classification table below would invert and the fixtures would stay |
| Settles | The inert list; how hook commands are found in shipped JSON; what `source update` shows and when the pin moves; which checkouts are kept |

## Scope

In:

- `trustReport`: the allowlist report, used by `stacks trust` for every kind (3.2a) and by `create --from` (3.1b), replacing `show`'s interim report at those call sites.
- `stacks source update <name> [--ref <ref>] [--json]` with a diff against the pinned commit.
- On `trust source <name>`, a diff since the last confirmed commit ahead of the full report.
- One fixture per vector in the acceptance tests.

Out:

- Judging what a command does. The trust report shows and marks; it never scores or blocks.
- Automatic or scheduled updates.
- Signature checks on commits.
- Any CI wiring (D23).

## Design

### Where this fits

3.2a made sources and confirmations exist, with `show`'s full output as a stand-in review. This sub-phase replaces that stand-in with point 6's allowlist report and makes a moving source reviewable. 3.2a and 3.2b ship in the same release.

### The trust report

`src/core/trust/report.ts::trustReport(entries, { agents })` returns `TrustReport` (`src/schemas/trust.ts`). For each entry:

- **Files.** Every file the entry would write, for every agent it ships adapters for, with its output path: dotfile names as stored, since they are literal ([roadmap, Other shared facts: Entry directories](../roadmap.md#other-shared-facts)), `.tmpl` stripped, the `adapters/<agent>/` prefix removed and the agent named. Each file is `inert` or `executable-or-config`, plus flags `executableBit`, `shebang` and `template`.
- **Always shown, in full:** the entry's body (prose the agent executes, such as `curl | sh`), its `commands`, every verify step (`run`, `cwd`, `phase`, `tags` and `expect.http`), and every hook command found in shipped JSON.
- **Content.** Every `executable-or-config` file's text, in full in `--json`, and up to 200 lines per file in human mode with a "truncated, N more lines" line. Binary files show size and sha256.

The inert list is the only list. A file is `inert` only when all of these hold; everything else is `executable-or-config`:

| Rule | Detail |
|---|---|
| Kind | An image with extension `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` or `.ico`; or a plain markdown doc: extension `.md` and output path `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE.md`, or under `docs/` |
| Location | No path segment starts with `.` |
| Mode | No executable bit and no shebang |

So `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/commands/*.md`, `.cursor/rules/*`, `.svg` (it can hold script), `.envrc`, `bunfig.toml`, `.npmrc`, `package.json` and every workflow file are marked, without anyone having listed them as dangerous.

Hook commands in JSON: every shipped file whose output path ends in `.json` is parsed. A file that doesn't parse is marked and shown in full. From one that parses, the trust report extracts every string at a key whose name contains `command` (any case), or is `args`, `run` or `script`, and every string anywhere under a `scripts`, `hooks` or `mcpServers` object, each with its JSON path. That covers `.claude/settings.json` hooks, `.mcp.json` servers, `package.json` scripts and devcontainer lifecycle commands with one rule.

### `source update`

1. Fetch the stored `ref` (or `--ref`, which replaces it) with 3.2a's `Sources.fetch`, so every hardening rule applies.
2. If the resolved commit is the pin and its checkout exists, return `unchanged: true`. If the checkout was deleted by hand, store it again; its digest decides trust as usual.
3. Compute `SourceDiff` against the pinned checkout: entries added, removed and changed; per changed entry, frontmatter fields before and after, body `countWords` before and after, and files added, removed and changed, each with its output path and report class. Bodies and every changed `executable-or-config` file get a unified diff. Inert files are listed without one.
4. Print the diff (human) or return it (`--json`), then move the pin in `config.json`. The new commit is untrusted until a person runs `stacks trust source <name>` (point 2), so every point-3 rule applies to its entries meanwhile.
5. Keep the checkouts of the new pin and of the most recently confirmed commit; delete the rest.

Unified diffs come from `git diff --no-index --no-color --no-ext-diff --no-textconv -- <old> <new>` with 3.2a's environment and `-c` flags, so no diff or textconv program from the user's setup runs and no new dependency is needed.

`source update` is allowed under an agent: it can only make a source untrusted.

When the trust store holds an earlier confirmed commit for a source, `trust source <name>` prints the diff from that commit to the pin first, then the full trust report. A reviewer reads what changed, with the whole picture after it.

### Failure modes

| Case | Result | Exit |
|---|---|---|
| Unknown source | `NotFound` | 2 |
| Fetch fails | `SourceFetchFailed` (3.2a); pin unchanged | 4 |
| New commit's entries fail to decode, or ship a symlink or submodule | `EntryInvalid`; pin unchanged, new checkout removed | 2 |
| Old checkout missing | Diff against nothing, with a note; pin moves | 0 |

No new error tags.

### Decided here

| Question | Decision | Why |
|---|---|---|
| When the pin moves | Right after the diff is shown, untrusted | Point 2 already guards an untrusted commit; staging a pending pin would add a config field and a second state |
| Which markdown is inert | Plain docs only, never agent instruction files or anything in a dot-directory | Agents execute instruction prose |
| How hooks are found | Key-name rule over every shipped JSON file | One rule covers formats nobody listed |
| Diff engine | `git diff --no-index`, hardened | Already the CLI's own process; no new dependency |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/core/trust/report.ts` | `trustReport`, inert rules, JSON hook extraction |
| `packages/cli/src/core/sources/update.ts` | `source update`, `SourceDiff`, checkout pruning |
| `packages/cli/src/schemas/trust.ts`, `source.ts` | `TrustReport`, `SourceDiff` |
| `packages/cli/src/commands/source.ts` | `update` subcommand |
| `packages/cli/src/commands/trust.ts`, `src/core/create.ts` | Use `trustReport` |
| `packages/cli/tests/trust-report.test.ts`, `source-update.test.ts`, `tests/fixtures/trust-vectors/` | New |
| `packages/cli/README.md`, `AGENTS.md`, `docs/authoring.md` | Report and update |

## Acceptance tests

Real repositories under a temporary directory, `file://` URLs, no network.

1. One fixture per vector, each asserting `executable-or-config` and, for JSON, the extracted commands with their paths: a body containing `curl -fsSL https://x | sh`; a `commands` entry; a verify `run`; `package.json` with `postinstall`; `.mcp.json` with a server `command` and `args`; `.envrc`; `bunfig.toml` with `preload`; `.npmrc`; `.devcontainer/devcontainer.json` with `postCreateCommand`; a file under `.opencode/`; a file under `.gemini/`; `files/setup.sh.tmpl`; `.claude/settings.json` with hooks; `.github/workflows/ci.yml`; `.vscode/tasks.json`; `AGENTS.md`; an `.svg`; a literal `files/.envrc` shown as `.envrc`; `docs/guide.md` with the executable bit; a `.md` with a shebang; a `.json` that doesn't parse.
2. `README.md`, `docs/guide.md` and `logo.png` (no executable bit) are `inert`.
3. Every entry's full body, `commands` and verify steps appear in the trust report even when it ships no files.
4. A second commit that edits a body and adds a hook file: `source update --json` lists the entry as changed with words before and after, the new file as `executable-or-config` with a diff, and `trusted: false` afterwards; `trust source` then shows the diff since the confirmed commit before the trust report.
5. A user-configured `diff.external` and textconv driver in the test HOME's git config write no marker during `source update`.
6. `source update` to the same commit returns `unchanged: true` and changes nothing.
7. A new commit with an invalid entry exits 2, keeps the old pin and leaves no new checkout.
8. After update and confirm, only the pinned and last confirmed checkouts remain.
9. `create --from project` (3.1b) and `trust stack <id>` print `trustReport` output, not `show`'s.

## Exit criteria

- Acceptance tests pass; `bun run check` is green from the repo root.
- A maintainer reviews a real source update with the diff and the trust report and records in a run note in [plans/runs/](../runs/README.md) anything the trust report buried or missed.
- The risk row "Third-party stacks ship hooks or scripts the user's agent will run" in `risks-and-open-questions.md` is updated with what shipped.
- `AGENTS.md`, the CLI README and the authoring guide describe the trust report and `source update`.

## What this plan may get wrong

- The trust report lists and marks; it doesn't summarize. A long report invites skimming. If sources become common, the diff since the last confirmation will carry most reviews, and its prominence may need to grow.
- The key-name rule for JSON will mark some harmless strings and could miss a command under an unusual key. Unusual keys are still in a marked file whose full content is shown.
- 2026-10-26: the report listed a step's `check` and `probe.url`, and showed dotfiles unescaped. The amended D18 replaced `probe` with `expect: { http, within }`, dropped built-in checks and stores dotfiles literally, so the report shows `expect.http` (the URL verify will request) and paths as stored. `tags` is shown because a `prod` tag decides whether a step runs under `--sandbox`.
- Moving the pin before confirmation leaves a team's projects untrusted until someone reviews. That is the point, but a team that updates often may want a "confirm on update" path from a terminal; it is the same confirmation, so it is easy to add.
