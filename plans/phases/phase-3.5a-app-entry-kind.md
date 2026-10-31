# Phase 3.5a: The `app` entry kind

Status: WITHDRAWN 2026-10-26. D26 is superseded by the amended D18: an app is a fragment
with `category: app`, so there is no `app` kind, no `applications/<id>/APP.md`, no
`AppMeta` and no entry `schema_version: 3`. Loading and listing apps moved to
[1.0](../archive/phases/phase-1.0-entry-format-and-registry-2026-10-30.md), composing them (one per composition,
ordered last) to [1.1](../archive/phases/phase-1.1-composition-and-brief-2026-10-30.md), and app checks to
[1.5](../archive/phases/phase-1.5-validate-and-brief-budget-2026-10-30.md). Kept for the record; the number is not
reused

| Field | Value |
|---|---|
| Goal | A third entry kind, `app` (D26), describes a small application built on a stack. The registry loads `applications/<id>/APP.md` from every origin, `list` and `list --json` show apps, `compose` composes an app onto its base stack, and `validate` checks app entries. Writing an app project (`new <app>`, the two-phase brief and staged verify) is [3.5b](../archive/phases/phase-3.5b-two-phase-brief-2026-10-30.md) |
| Traces to | The developer who starts projects often: "I want it set up the way I'd set it up myself"; assumption 1 (brief size): splitting a brief into two bounded phases is the other tool against brief growth besides the budget |
| Depends on | [1.0](../archive/phases/phase-1.0-entry-format-and-registry-2026-10-30.md) (entry format and registry), [1.1](../archive/phases/phase-1.1-composition-and-brief-2026-10-30.md) (composition), [1.5](../archive/phases/phase-1.5-validate-and-brief-budget-2026-10-30.md) (`validate`); [3.1a](../archive/phases/phase-3.1a-show-and-preview-2026-10-30.md) soft (`show --kind app` is added here only if `show` exists; otherwise 3.1a adds it when it lands) |
| Blocks | [3.5b](../archive/phases/phase-3.5b-two-phase-brief-2026-10-30.md). 4.0a's `EntryBundle` kind includes `"app"` because this lands first |
| Decisions needed | D26 (app entries and the two-phase brief), an amendment to D18. D19 unchanged: project-origin apps are untrusted like any project entry |
| Settles | The `app` kind's frontmatter and entry schema version; where apps live; how app ids relate to stack and fragment ids; how an app composes; what `validate` checks on an app entry |

## Scope

In:

- Entry kind `app` at `applications/<id>/APP.md` in every origin, with optional `files/` and `adapters/<agent>/` as for stacks.
- `AppMeta` in `src/schemas/entry.ts`, at entry `schemaVersion: 3`.
- `list` and `list --json` showing apps as their own group with `kind: "app"`.
- App composition in `compose`.
- `validate` rules for app entries (below).
- `add <app>`: `BadInput` with "apps start new projects; use `new`" (D4: no retrofitting).

Out:

- `new <app>`, the two briefs, staged manifest steps, verify by stage, the bundled `chat-app` (3.5b). Until 3.5b lands, `new` resolves stacks only and an app id is `BadInput` naming the app. Don't publish a release that has 3.5a without 3.5b.
- Apps built on another app.
- Any CI wiring (D23).

## Design

### Where this fits

A stack describes what a project is made of; an app describes something built on it. Folding an app's prose into its stack would push the stack past D5's budget and make every user of the stack read it. This sub-phase makes apps a format the CLI can read, list, compose and check; 3.5b makes `new` write an app project with a brief in two phases.

### Frontmatter (D18 amendment)

| Field | Rule |
|---|---|
| `schemaVersion` | `3`. Version 2 is the `{{package_scope}}` variable ([3.3a](../archive/phases/phase-3.3a-release-and-deploy-fragments-2026-10-30.md), D28); an app entry is version 3 whether or not it uses that variable. A CLI that knows only lower versions skips the entry with one warning ([Schema versions](../roadmap.md#schema-versions)), so an older CLI never half-understands an app |
| `kind` | `"app"`; must match `APP.md` |
| `stack` | The base stack id. Must resolve to a stack |
| `with` | Fragment ids the app needs beyond the stack's defaults |
| `id`, `name`, `description`, `tags`, `deps`, `tools`, `decisions`, `env`, `commands`, `verify`, `merge` | As for stacks (1.0). `verify` steps here become the `app` stage in 3.5b |

`Entry.kind` gains `"app"`; `RegistryRoots` gain no new origin.

### Ids across kinds

Ids are unique within a kind. A fragment may share an id with a stack or an app, as 1.0 and 3.1a already allow for stacks and fragments. An app may not share an id with a stack, because `new <id>` takes stacks and apps: within one origin such an app is a `rejected` row in `list --json` with `EntryInvalid` reason `id_mismatch`, and `validate` reports `app-id` as an error. Across origins, an app never shadows a stack id: the stack wins and `list` warns. Commands that take any kind (`show`) use `--kind` when two kinds share an id ([roadmap, Contracts: Entry and its listing](../roadmap.md#types-and-schemas)).

### Composition

`compose` with an app: compose the base stack with its defaults plus the app's `with` and the user's `--with`/`--without`, exactly as `new <stack>` would; then add the app as the last entry. File ownership, JSON merges, `env` and `commands` follow 1.1's rules with the app ranked after every fragment. A step name in the app that collides with a stack or fragment step is `ComposeConflict` reason `step_name`. An app whose `stack` doesn't resolve is `NotFound` naming the stack; one whose `with` names a fragment that doesn't apply to the stack is `ComposeConflict` reason `applies_to`. `Composition` gains `app: Entry | null`; 3.5b reads it to split the brief and stage the steps.

### `validate` rules

| Check | Severity | Rule |
|---|---|---|
| `app-stack` | error | `stack` resolves in the validated view, and is a stack |
| `app-version` | error | `kind: app` with `schemaVersion` below 3 |
| `app-id` | error | An app whose id equals a stack id in the validated view |
| `app-step-name` | error | A step name that collides with the composed stack's |

3.5b adds `app-budget` and `app-layers`.

### Trust

Nothing changes in the trust model. Project-origin apps are untrusted like any project entry ([Trust model](../roadmap.md#trust-model) point 2), and `trusted` is set the same way.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/schemas/entry.ts` | `AppMeta`, `kind: "app"`, `schemaVersion: 3` for apps |
| `packages/cli/src/core/registry/` | Load `applications/<id>/APP.md` from every origin; the id rule above |
| `packages/cli/src/core/compose/compose.ts` | App composition, `Composition.app` |
| `packages/cli/src/core/validate/` | The app checks above |
| `packages/cli/src/commands/list.ts`, `add.ts`, `new.ts`, `show.ts` (if present) | Apps group; `add` refuses apps; `new` refuses apps until 3.5b; `show --kind app` |
| `packages/cli/tests/apps.test.ts`, `tests/fixtures/registries/app-entries/` | New |
| `packages/cli/README.md`, repo `AGENTS.md` | The app kind |

## Acceptance tests

- A fixture app on a fixture stack: `list --json` shows it with `kind: "app"` in its own group; human `list` prints an Apps group.
- `compose` of the fixture app gives the stack's composition plus the app last; an app step named like a stack step is `ComposeConflict` `step_name`; an unknown `stack` is `NotFound`; a `with` fragment that doesn't apply is `ComposeConflict` `applies_to`.
- An app id equal to a stack id in the same fixture origin is a `rejected` row, and `validate` gives exactly `app-id`. A fragment with the same id as the app is accepted.
- `validate` fixtures: one per app check, each giving exactly its finding.
- A v1-and-v2-only reader fixture skips `APP.md` with one warning.
- `add <app>` exits 2 with the tree unchanged; `new <app>` exits 2 with `BadInput` naming the app.

## Exit criteria

- Acceptance tests pass; `bun run check` green from the repo root.
- D26 agreed, or this sub-phase and 3.5b wait.

## What this plan may get wrong

- Forbidding a stack and an app from sharing an id costs authors a rename when an app grows out of a stack of the same name. The alternative, `new --kind`, makes the agent guess; revisit if authors ask.
- A schema version per format feature (2 for a template variable, 3 for a kind) ties versions to features. If more follow, a per-feature `minCli` may be cleaner; that is a D18 change.
