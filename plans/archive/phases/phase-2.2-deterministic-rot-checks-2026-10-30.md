# Phase 2.2: Deterministic rot checks

Status: EXECUTED 2026-10-27 (every rot check and the ledger notes; `compose-each` follows 1.5's
optional-replaces-default rule; bundled registry at zero errors and warnings after four catalog
fixes, including condensed Effect guidance a maintainer should reread; reviewed once and fixed)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | `validate` catches, without an LLM, stack content that composes but will mislead an agent or go stale: a fragment that breaks only next to some stack's defaults, prose branches that can never render, verify steps that call undeclared commands, template text the agent will misread, version-sensitive files and pinned versions, shipped files that reference commands, hooks or ports the composition doesn't have, shipped code that imports from an entry it doesn't require, prose tied to a moment in a tool's release history, and stacks that changed since their last green run |
| Traces to | Assumption "Version-less prose rots much more slowly than templates" (confidence medium); assumption "`verify` is enough of a definition of done to keep an agent honest ... Inspect projects from runs for no-op targets and weakened tests"; the stack author: "nothing tells them when their prose has gone stale" |
| Depends on | [2.0a](phase-2.0a-composed-files-and-fingerprint-2026-10-30.md) (`composeFiles`, `NEUTRAL_VARS`, `fingerprint`), [2.0c](phase-2.0c-run-ledger-2026-10-30.md) (`readLedger`, `latestRecord`, `LedgerKey`), [1.5](phase-1.5-validate-and-brief-budget-2026-10-30.md) (the `validate` pipeline, `Finding`, the `note` severity, the budgeted compositions) |
| Blocks | [3.1b](phase-3.1b-create-and-authoring-guide-2026-10-30.md) (authoring tools surface these findings), [4.0c](phase-4.0c-registry-index-2026-10-30.md) (the index build runs these checks), [5.0](../../phases/phase-5.0-ci-release-and-checks.md) (runs them as a CI step) |
| Decisions needed | None new. D5 and D7 are enforced by 1.5. D20 defines the gate composition that `ledger-unproven` looks for (`new --sandbox`); if D20 changes, that one check's key changes |
| Settles | The severity and rule of each composition and content check 1.5 leaves out; which shipped-file checks exist and their severity; the import contract between entries; the dated-phrase list and the rule for growing it; which ledger record each ledger note compares against |

## Scope

In:

- The composition and content checks the MVP doesn't need: `compose-each`,
  `conditional-dead-branch`, `undeclared-command`, `template-expression`,
  `setext-heading`, `version-sensitive-file` and `pinned-version` (below, "Composition
  and content checks").
- A composed-files view over 2.0a's `composeFiles`, for each composition `validate`
  already builds.
- Shipped-reference checks over that view.
- The import closure check.
- The dated-phrase check.
- Ledger findings: `ledger-unproven`, `ledger-changed`, `ledger-failed` (notes) and
  `ledger-schema` (error).

Out:

- Any check that needs to run the project or a tool. That is the bench
  ([2.0b](phase-2.0b-bench-2026-10-30.md)) and later the canary ([5.1](../../phases/phase-5.1-scheduled-canary.md)).
- Running these checks as a CI step: [5.0](../../phases/phase-5.0-ci-release-and-checks.md). Locally,
  1.5's bundled-registry test already runs every `validate` check through `bun run test`,
  so the new checks are covered there with no workflow change.
- Checking that shipped Markdown names only paths that will exist. Docs legitimately
  describe directories the agent creates; a path-token check gives false positives.
- Judging whether a test the agent wrote is real. That stays with reading bench run notes
  (2.0b).

## Design

### Where this fits

2.0a gave the plan one renderer (`composeFiles`, which `new` writes from) and a
fingerprint over it, and 2.0c a ledger. This sub-phase adds `validate` checks over those, and runs in
parallel with [2.0b](phase-2.0b-bench-2026-10-30.md), which appends ledger records. Both treat
`src/core/compose/files.ts` as read-only (roadmap, lanes table). New checks are new
modules under `src/core/validate/`, so 1.5's modules are not touched.

### Composition and content checks

These run over the entries and compositions 1.5 already loads, with 1.5's resolution set
and budgeted compositions, and add no new input.

| Check id | Severity | What it catches |
|---|---|---|
| `compose-each` | error | For each fragment in the validated set and each stack in the resolution set it can join (the stack lists it in `fragments.*`, or its `applies_to` matches the stack), composing that stack's required + default fragments plus this one fails, in either preset. Catches a fragment that only breaks next to a stack's defaults it was never budgeted with |
| `conditional-dead-branch` | warning | A fragment's `stack=X` block can never render: stack X doesn't list the fragment in `fragments.*` and the fragment's non-empty `applies_to` doesn't match X. When X doesn't list it but `applies_to` allows it, the finding is a `note` (reachable only through `--with`) |
| `undeclared-command` | warning | A verify step's `run` starts with `make <x>`, `bun run <x>`, `npm run <x>`, `pnpm <x>`, `pnpm run <x>`, `yarn <x>` or `yarn run <x>`, and `<x>` isn't a key of the composition's merged `commands`. Checked per budgeted composition, so a fragment that relies on a stack defining the command is judged with that stack. The agent learns which commands exist from the brief's commands table; a step calling one the table doesn't list is a target the agent has to guess |
| `template-expression` | warning | A `.tmpl` file contains `${{ <name> }}` where `<name>` matches 1.2a's identifier rule: 1.2a would read it as a template variable (an unknown one is `EntryInvalid`), when the author almost certainly meant a GitHub Actions expression. Ship that file without `.tmpl` |
| `setext-heading` | warning | An entry body uses an underlined (`===` or `---`) heading, which 1.1's heading normalization leaves at its own level |
| `version-sensitive-file` | warning | A file under `files/` or `adapters/` whose name (dotfiles are stored literally; see roadmap, Other shared facts: Entry directories), with any `.tmpl` suffix dropped, is on the list (one constant, `VERSION_SENSITIVE`). Build and language config: `tsconfig.json`, `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `astro.config.*`, `vite.config.*`. Lint and format: `biome.json`, `biome.jsonc`, `.eslintrc*`, `eslint.config.*`, `.golangci.yml`, `.golangci.yaml`. Test runners: `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `pytest.ini`. API codegen: `openapi-ts.config.*`, `orval.config.*`, `openapitools.json`. Containers: `Dockerfile`, `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`. CI and release: `.github/workflows/*`, `.goreleaser.yml`, `.goreleaser.yaml`, `release-please-config.json`, `.changeset/config.json` |
| `pinned-version` | warning | An exact semver (`\d+\.\d+\.\d+` not touching another dot or digit) in an entry body, in `decisions`, or in shipped Markdown, outside code fences |

The version-sensitive filename list is a warning, not an error, because a stack can
legitimately ship one of these as a skeleton the agent rewrites; the warning makes the
author say so in review. `pinned-version` is a warning for the same reason, and the
dated-phrase list below widens it. Neither has an escape syntax: the fix is rewording.
Because the bundled registry has a zero-warning gate, a bundled stack can ship neither.

When 2.2 lands, any of these that fires on the bundled registry is fixed in the entry in
the same change, so the zero-warning gate holds.

### Composed files

For each composition 1.5's `compose` check builds (each stack with its required and
default fragments, per preset), 2.2 calls `composeFiles(c, NEUTRAL_VARS)` (roadmap,
[Contracts: Composed file set](../../roadmap.md#types-and-schemas)) once per agent for which a
composed entry ships an `adapters/<agent>/` directory, and once with 1.5's default agents
option when none does. A composition that already failed 1.5's `compose` check is skipped.
The checks below read only `RenderedFile`s; there is no second renderer. If a large
registry makes this slow, reads can be cached per `validate` run; at the current size it
isn't needed.

### Checks

| Check id | Severity | Rule |
|---|---|---|
| `ref-command` | error | In a composed `.claude/settings.json`, every `Bash(...)` allow or deny rule whose command is a project-command invocation (`make <t>`, `bun run <s>`, `npm run <s>`, `pnpm [run] <s>`) names a key of the merged `commands` map, or a word a composed body sets in inline code. The same for the first argument of `args` and `runtimeArgs` in `.vscode/launch.json` |
| `ref-hook` | error | Every hook `command` in a composed `.claude/settings.json` that references `${CLAUDE_PROJECT_DIR}/.claude/hooks/<file>` names a composed file |
| `ref-port` | warning | A literal `localhost:<port>` or `127.0.0.1:<port>` in a composed `.claude/settings.json` or `.vscode/*.json`, when the composition's `env` declares a variable with a `PORT` segment. Other files (`.env.example`, test fixtures) may carry ports |
| `ref-command-coverage` | warning | A `commands` key that the body describes as a deliverable (it appears in the brief's commands table) and that no verify step runs, for fragments only. Stacks declare commands like `dev` and `clean` that verify shouldn't run, so they are exempt |
| `import-closure` | error | A relative import in a shipped `.ts`, `.tsx`, `.js` or `.mjs` file (`import ... from "./x"`, `import "./x"`, `export ... from "./x"`, `require("./x")`), or a `source`/`.` line in a shipped `.sh` file, must resolve to a composed file owned by the same entry or by an entry in its allowed set |
| `dated-phrase` | warning | Phrases that tie prose to a moment in a tool's release history, in bodies, `decisions` and shipped Markdown, outside code fences |
| `ref-json` | error | A shipped JSON or OpenCode JSONC file the reference checks read doesn't parse; those checks skip it |
| `ref-toml` | error | A shipped Codex `.codex/config.toml` doesn't parse; reference checks skip it (3.4b) |
| `ref-config` | error | A native adapter config has malformed reference structure or wrong-case keys; reference checks skip it (3.4b) |
| `ledger-unproven` | note | See "Ledger findings" |
| `ledger-changed` | note | See "Ledger findings" |
| `ledger-failed` | note | See "Ledger findings" |
| `ledger-schema` | error | The ledger file exists and doesn't decode as `Ledger`, or holds records that fail `LedgerRecord` at `schemaVersion: 1` |

Severities are 1.5's (roadmap, [Other shared facts: `validate` severities](../../roadmap.md#other-shared-facts)).
"Changed since" is the normal state of a stack under active editing, which is why it is a
`note`: it says when a rerun is due and never blocks a commit or the zero-warning gate.

For a merged file, the owning entries are every id in its `owner` (2.0a joins them with
`+`); a reference check passes if any of them satisfies it.

### The import contract

An entry's shipped files may import only from:

- its own files;
- for a fragment, files owned by the transitive closure of its `requires`;
- for a stack, files owned by the transitive closure of its `fragments.required`.

Default and optional fragments are not in the allowed set, because `--without` can
remove them, and `applies_to` is not a dependency. Resolution maps `.js` to `.ts`, tries
`.ts`, `.tsx`, `.js`, `.mjs` for an extensionless path, and maps a directory to its
`index.ts`. In shell files, a leading `$CLAUDE_PROJECT_DIR` is the project root and any
other leading variable is the script's own directory. A finding names the importing
file, the target, and the entry that owns it, with the fix: add the owner to `requires`
(or `fragments.required`), or move the shared file.

This is the check that would otherwise only fail at runtime in the one composition where
the transitive dependency happened to be missing.

### Dated phrases

The list is short on purpose and there is no way to suppress a hit; a hit is rewritten.

- `rc` as a word, `dist-tag`, `while published`, `alpha`, `nightly`, `canary` as words
  (case-insensitive). `canary` is checked only in entry content, not in this repo's own
  docs.
- `as of` followed by a month name or a four-digit year; a capitalized month name
  followed by a four-digit year.
- The `pinned-version` semver rule above stays as is.

Left off on purpose: `prerelease` (the version-less rewrite "if the latest release is
still a prerelease, pin every related package to the same one" needs it), `beta`, and
tool-major phrases like "Effect 4", which are true statements about what a stack targets.
A phrase joins the list only after a bench or canary run finds it stale in a real entry.
The list is a tripwire for known patterns, not a staleness detector; reruns are.

### Ledger findings

These run when the validated root is a registry root with a `runs.json` (in practice the
bundled registry). A root without one skips them silently: a user registry without a
ledger is normal. Records are read with 2.0c's `readLedger` and keyed with its
`LedgerKey` (`{ stack, with, preset, agent }`). Only records with `with: []`, the
stack's default composition, are compared, because that is the composition `validate`
builds.

- **`ledger-unproven`**: the stack has no `pass` record for `with: []` under the
  `sandbox` preset, for any agent. That is the gate composition (D20 requires a green
  `new --sandbox` run per bundled stack), so this note means the stack has never met the
  gate in the ledger.
- **`ledger-changed`**: for each key (`stack`, `with: []`, `preset`, `agent`) that has a
  `pass` record, compose the stack with its defaults under that preset with `agents:
  [agent]`, compute `fingerprint`, and compare it with the latest `pass` record for that
  key (`latestRecord` over pass records). A mismatch is one note per key: "`<stack>`
  (`<preset>`, `<agent>`) changed since its last green run (`<date>`)". Comparing per key
  means a `claude` pass doesn't hide that a `codex` adapter file changed, and a pass under
  one preset says nothing about another.
- **`ledger-failed`**: the latest record for a key is `fail` or `partial`. `infra`
  records are ignored here, because they say nothing about the stack (2.0c).
- **`ledger-schema`**: from `readLedger`'s `fileValid: false` or `skipped.invalid > 0`.
  Records skipped as `skipped.newer` (written by a newer CLI) give no finding.

### Output

1.5's report, unchanged in shape: the new checks add `Finding`s with the severities above,
and notes print in 1.5's notes section. No `ValidateReport` field is added.

### Failure modes

| Case | Handling |
|---|---|
| A shipped JSON or OpenCode JSONC file doesn't parse | `ref-json` error finding for that file; the reference checks skip it |
| A shipped Codex TOML file doesn't parse | `ref-toml` error finding for that file; the reference checks skip it (3.4b) |
| A native adapter config has malformed reference structure or wrong-case keys | `ref-config` error finding for that file; the reference checks skip it (3.4b) |
| A template variable `NEUTRAL_VARS` doesn't define | Already `EntryInvalid` from `composeFiles`; reported by 1.5's `compose` check |
| Ledger missing | Ledger checks skipped |
| Ledger invalid | `ledger-schema` error; the other ledger notes are skipped |

### Decided here

- Reference and import checks run on composed output, not on single entries. Reason: the
  defects only exist in a composition.
- Ledger notes compare per ledger key, not against one chosen agent or preset. Reason:
  any single choice hides changes for the others.
- No suppression syntax for dated phrases. Reason: suppressions become the default fix.

## Files and areas touched

| Path (under `packages/cli/`) | Change |
|---|---|
| `src/core/validate/composed.ts` | the composed-files view over `composeFiles` |
| `src/core/validate/compose-each.ts`, `conditionals-reach.ts`, `commands.ts`, `templates.ts`, `headings.ts`, `version-sensitive.ts` | the composition and content checks, one module each (`VERSION_SENSITIVE` in `version-sensitive.ts`) |
| `src/core/validate/shipped-refs.ts`, `imports.ts`, `dated.ts`, `ledger-notes.ts` | one module per check group |
| `src/core/validate/index.ts` | registers the new modules and their `CheckId`s |
| `tests/validate-shipped.test.ts`, `tests/validate-ledger.test.ts`, `tests/fixtures/registries/*` | one fixture per check |
| repo `AGENTS.md`, authoring notes in the package README | the checks and the import contract |

## Acceptance tests

1. Composition and content checks, one fixture each: `compose-each` reports an undeclared
   file collision between an unlisted tag-applicable fragment and a stack's defaults. A
   listed optional fragment's collision is reported once by 1.5's `compose` check, and a
   stack without the colliding default passes. Declared conflicts replace defaults in either
   direction, matching 1.5, and give no finding; `conditional-dead-branch` is a warning for a `stack=<go-stack>`
   block in a fragment whose `applies_to` is `[python]`, and a note when `<go-stack>` could add
   it with `--with`; `undeclared-command` fires on `make lnt` where `commands` has `lint`,
   and not on `make lint`; `template-expression` fires on `${{ github }}` in a `.tmpl` and
   not on `${{ github.sha }}`; `setext-heading` fires on an underlined heading;
   `version-sensitive-file` fires for one fixture file of each group in
   `VERSION_SENSITIVE` (`Cargo.toml`, `compose.yaml`, `.goreleaser.yml`, `biome.jsonc`,
   `playwright.config.ts`, `orval.config.ts`) and not for `README.md`; `pinned-version`
   hits `1.27.2` and misses `127.0.0.1`, `0.0.0.0` and text inside a code fence.
2. `ref-command`: `args: ["ask", "hello"]` in a shipped `launch.json` against a
   composition without `ask` fails; a `Bash(bun run stub)` rule passes when a body names
   `stub` in inline code.
3. `ref-hook`: a hook command naming a file no entry ships fails; one naming a file in a
   merged `settings.json`'s other owner passes.
4. `ref-port`: `localhost:5173` in an allow rule with `PORT_WEB` declared warns; the same
   in `.env.example` doesn't.
5. `import-closure`: a stack file importing a default fragment's `_lib.ts` fails; the
   same import with the fragment under `fragments.required` passes; a fragment importing
   from an entry two `requires` hops away passes.
6. `dated-phrase`: "while published only under the rc dist-tag" warns on each phrase;
   "if the latest release is still a prerelease" doesn't; text in a code fence doesn't.
7. Ledger: a fixture ledger with a `pass` record at the current fingerprint gives no note;
   editing one word of the body gives `ledger-changed` naming the preset, agent and date;
   changing only a `codex` adapter file gives `ledger-changed` for the `codex` key and not
   for `claude`; a stack with only a `default`-preset pass gives `ledger-unproven`; a latest
   `infra` record gives no `ledger-failed`; in each case the exit code and warning count
   are unchanged.
8. `ledger-schema`: an undecodable `runs.json` is an error and exit 2; a record with
   `schemaVersion: 2` alone gives no finding.
9. The bundled registry: zero errors and zero warnings under the new checks.

### Realistic edge cases

10. A symlinked registry root and shipped paths with spaces, leading dashes and non-ASCII text preserve source locations and findings.
11. Validation from another working directory under agent markers and repository-selecting git variables reads the requested checkout and never executes verify steps.
12. CRLF text, backtick and tilde fences, IPv4 addresses and phrase word boundaries produce no spurious prose findings.
13. Malformed reference JSON reports `ref-json` once per file, skips cascading reference checks and still checks valid sibling files.
14. Existing ledger state distinguishes missing, empty, invalid v1 and newer records; added-fragment runs are excluded, and latest pass selection honors date and file order.

## Exit criteria

- `bun run check` green from the repo root, with the bundled registry clean under every
  new check.
- `AGENTS.md` documents the import contract and the ledger notes.
- Any finding the new checks raise on the bundled registry is fixed in the entry, not by
  loosening the check.

## What this plan may get wrong

- 2026-10-27: preview checks are scoped to the selected composition, preset and fragment flags, rendered per shipped adapter; the registry-wide composition matrix and `compose-each` must stay out of previews.
- The settings and launch file checks are specific to Claude Code and VS Code formats.
  When the native adapters for other agents ship config
  ([3.4b](phase-3.4b-native-agent-adapters-2026-10-30.md), D27), each needs its own reference check
  or these miss its defects; 3.4b adds them.
- Regex-level import parsing misses dynamic imports and multi-line import statements.
  Shipped hook code is small and written to a house style, so regexes should cover it; if
  a miss appears, switch to the TypeScript scanner rather than growing the regexes.
- The version-sensitive filename list is incomplete by nature. It grows only when a run
  finds a shipped file that broke on a new release.
- `undeclared-command` reads only the first words of a `run` line. A step that calls
  `cd web && npm run e2e` or a wrapper script slips past it; it is a cheap check for the
  common case, not a parser.
- `compose-each` grows with fragments times stacks times two presets. With a handful of
  entries that is a few dozen compositions; if a larger catalog (3.3a) makes `validate`
  slow, cache compositions by their input ids.
- A short phrase list will miss most stale sentences. That is accepted; reruns (2.0b, then
  5.1) are the real mechanism, and this check only stops known patterns from coming back.
- `ledger-changed` only covers `with: []`. A stack whose only green runs used optional
  fragments shows as unproven. If the bench starts recording runs with `--with`, compose
  those keys too.
- 2026-10-26: this plan spelled the frontmatter key `appliesTo` and undid a `_dot_`
  escape before matching file names. The amended D18 uses snake_case keys (`applies_to`)
  and literal dotfiles, so names are matched as stored. `compose-each` also has to cover
  apps: an app fragment is composed with each stack it applies to, alone, since at most
  one app fits a composition (1.1). The catalog is now the whole bundled catalog from
  1.6a, not three stacks, so the size concern above arrives with 1.6a rather than 3.3a.

- Implementation: `template-expression` excludes the fixed template variable names. A
  known substitution after `$` is intentional shell text (the bundled installer documents
  `$` followed by its generated env prefix), rather than a bare Actions context.
- Implementation: fragment coverage exempts keys already declared by the stack. Apps can
  describe how they extend the stack's `check`; this is still the stack-owned aggregate,
  not another deliverable that needs a duplicate verify run.
- Implementation: `composeFiles` can reject an unknown template variable after `compose`
  succeeds. The rendered-files check reports that as `compose` with the source path and
  line; 1.5's composition check alone never rendered templates.
- 2026-10-27: the orchestrator resolved the optional-conflict policy in favor of 1.5's
  replacement rule. `compose-each` drops conflicting defaults in either direction and
  checks only compositions 1.5 has not already budgeted; listed defects retain 1.5's
  check id without a duplicate. Acceptance 1 now uses undeclared file collisions, plus
  a passing declared-conflict case. Applicable combinations also get the composed brief budget.
- 2026-10-27: corrected the six version-sensitive fixtures to put adapter examples under
  `adapters/codex/nested/`, preserving two warnings without colliding with `files/<name>`.
- Validation now caches checked registry file listings and source reads within one
  invocation. The full concurrent suite exceeded a bundled fixture's five-second timeout
  without that cache. Neutral rendering still goes exclusively through `composeFiles`.

- 2026-10-27: checking previously unbudgeted combinations found `mobile-expo --with effect`
  above 6,000 words. Condensed overlapping Effect and Schema guidance without narrowing
  applicability or changing the budget; the bundled registry remains at zero errors/warnings.
