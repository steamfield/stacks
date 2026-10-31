# Author a stack or fragment

Start with a project you trust and can build from an empty directory. A stack describes
its structure and definition of done. A fragment adds a reusable capability; prefer one
over a near-copy when only CI, deployment or a tool differs.

A coding agent can do most of this for you. `stacks skill install stacks-author` installs
the authoring skill for Claude Code (the stacks Claude Code plugin includes it too), and
`stacks guide author [topic]` prints the same guidance for any agent. Ask it to turn a repo
into a stack or to design one with you.

```sh
stacks create stack my-api --json
stacks create fragment my-ci --category ci
stacks create fragment my-app --category app
stacks create stack go-cli --from bundled
stacks create stack team-api --from project --yes
```

The result names the entry directory and this guide. Entries go under
`$XDG_CONFIG_HOME/stacks/` (default `~/.config/stacks/`). Existing targets are
preserved. Copies keep the same id and every byte, including `files/` and `adapters/`.
The user copy shadows the bundled entry. Project entries and overridden bundled roots
are untrusted: a person must review the full stderr report at a terminal. The yes flag
skips the question, never the report or the refusal under an agent or without terminal
stdin. The user origin is the destination and cannot be a copy source.

## Distill the working project

- Frontmatter holds package names by role (no versions), commands, verify steps,
  decisions and fragment relationships. Every decision needs `(default: ...)`.
- Prose holds durable rules and instructions for discovering current tool details.
  Anything that would be wrong after the next major release belongs here, not in a
  shipped configuration. Replace a stale fact with a durable rule, a discovery step
  against current official docs, or a verify step that asks the tool.
- `files/` holds stable starter content. Store dotfiles literally, such as
  `files/.gitignore`. Put version-sensitive configuration requirements in prose for
  the agent to generate. Adapter files live under `adapters/claude/`, `codex/`,
  `opencode/` or `cursor/`.

Use snake_case keys: `schema_version`, `applies_to`, `requires_tools`, `needs_own_repo`.
An app is a fragment with `category: app`; fill its `applies_to` with a stack id or tag.

Keep Setup numbered. Tell the agent to inspect current generator help and run the
generator non-interactively into a subdirectory before moving its output into place.
Do not freeze generator flags. Declare exactly one task-runner tag, `make` or `scripts`,
and list every project command used by verify in `commands`. A `scripts` stack's install
step runs the package manager (`bun install`) and declares no `install` command: a
`package.json` script named `install` runs during every install, so it recurses.

Verify calls project commands and covers install, lint, typecheck and test layers.
Add build, docs and application checks when they prove a deliverable. A server probe:

```yaml
verify:
  - name: dev
    phase: serve
    layer: serve
    run: make dev
    expect: { http: "http://localhost:3000/", within: 60s }
```

File checks are short shell commands in v1: the skeleton's README check requires a
nonempty file without `stacks:fill`. Replace every fill marker yourself; plain `validate`
doesn't flag them, but `validate --submission` does.

A `.tmpl` file can use only `{{project_name}}`, `{{project_slug}}`, `{{env_prefix}}`,
`{{package_scope}}`, `{{author}}` and `{{year}}`. Use `{{package_scope}}` for scoped
package names. Conditional prose uses standalone markers, without nesting:

```md
<!-- stacks:when preset=sandbox -->
Describe the local-only setup.
<!-- stacks:end -->
```

Other condition keys are `stack`, `tag`, `tag!=`, `mode` and `with`.

## Add a search card

Bundled contributions include `search/stacks/<id>.json` or
`search/fragments/<id>.json` beside the registry's entry directories. Personal cards
are optional. A project registry uses `.stacks/search/`. `create --from` copies a
source card byte for byte, including its provenance; a new skeleton has no card.

The JSON uses `schemaVersion: 1`, `kind`, `id`, `source`, `summary`, `requests`,
`useCases`, `synonyms`, `goodFor` and `notFor`. A stack also requires `platforms`,
`productKinds` and `languages`; a fragment requires `capabilities` and has none of
those stack fields. Choose closed values from the bundled `search/vocabulary.json`.
Other roots cannot redefine the vocabulary.

Write one sentence of at most 25 words for `summary`, 3 to 5 example `requests`
of at most 15 words each, and short phrases for `useCases` (6 maximum), `synonyms`
(12), `goodFor` (4) and `notFor` (4). Stacks list 1 to 3 languages; fragments list
0 to 3 capabilities. Optional `caveats` holds up to 3 platform or operating limits
of at most 25 words each. Keep these search fields together within 150 words.
Describe needs supported by the entry; do not guess a product domain or copy
evaluation queries.

Stored cards can include four optional editorial fields; new drafts include all four. They have separate
budgets and are excluded from search ranking and embeddings:

| Field | Purpose and limit |
|---|---|
| `description` | Directory detail and agent comparison prose, at most 120 words |
| `seoDescription` | Plain page-meta copy, at most 160 Unicode characters; this is an editorial limit, not a search-engine guarantee |
| `projectExamples` | 1 to 3 illustrative project ideas, each with a `title` (8 words maximum) and `description` (35 words) |
| `plain` | Optional plain-language `whatItIs` (30 words maximum), plus 1 to 3 short `goodAt` and `notGoodAt` items (15 words each); `show` uses the first project example |

All editorial strings must be nonblank. An example on a fragment card also names
its host `stack`; on a stack card, that host is the card itself. Optional
`withFragments` lists up to 3 distinct additions needed beyond that entry and
the host's defaults. Validation checks the same selection rules as composition,
including compatibility, dependencies and conflicts.

Explain what the recipe establishes and what a product still needs. A project
idea is illustrative, not an included feature. Name optional additions for
persistence or AI, and call out custom work such as authorization or native
permissions. Do not invent compliance, readiness, pricing or timing claims.
Apps are still fragments with `category: app`; tools, requirements and
compatibility stay in entry frontmatter.

The recipe's frontmatter `description` remains the technical synopsis.
`summary` is the short search-hit sentence. A directory can prefer reviewed
sidecar `description` on its detail page and fall back to the recipe description.
Page metadata can prefer reviewed `seoDescription`, then reviewed `summary`,
then the recipe description. Preserve draft and stale labels when displaying
sidecar copy; neither a richer description nor a recent edit proves the recipe
works.

`source.digest` is the `searchSourceDigest` of the entry's decoded metadata and
body. Set `by: "author"` for a handwritten card, or `by: "drafted"` with `model`
and `promptVersion` for a model draft. `reviewedAt` is a review date (`YYYY-MM-DD`)
or null for an unread draft. Maintainers can compute the baseline and review stamp
with the checkout's maintainer restamp operation after reading the card (see
`docs/maintaining.md` in the repository).

`validate` reports invalid, orphaned, missing, stale, unreviewed and oversized cards.
Missing personal cards are notes. Missing bundled cards and stale, unreviewed or
oversized cards are warnings; bundled contributions must have no warnings. Search
words do not change composition fingerprints or bundle digests. Editing the entry
text stales its card until it is drafted again or reviewed and restamped.

## Preview and remove rot

```sh
stacks validate ~/.config/stacks/stacks/my-api --json
stacks show my-api --kind stack
stacks validate ~/.config/stacks --brief my-api --sandbox
stacks validate ~/.config/stacks --brief my-api --with my-ci
```

Use your XDG path when customized. Show includes every guidance branch and shipped
path; preview shows the composed brief without writing or starting processes. Preview
ignores personal always-fragments and the preset setting.

Fix findings at their source: replace pinned versions and dated phrases with discovery
instructions; move version-sensitive files into prose; use ATX headings; repair unknown
references, unreachable conditionals and template variables. Imports must belong to the
entry or its required dependencies. Declare commands and cover fragment deliverables
with verify. Repair shipped hook/editor command references and stale run fingerprints.
Review warnings as well as errors.

Keep stack bodies below 2,000 words, fragments below 1,000 and apps below 3,000;
the composed brief limit is 6,000 (9,000 with an app). Move optional shared material into
a fragment, reference material into a shipped doc linked from the body, and cut what
the agent would do anyway. Validation budgets the default composition, every optional
fragment or fitting app alone, and every compatible pair of those extras in both presets.
Preview reports the resulting budget for a selected composition.

## Prove it with a local bench run

```sh
stacks new my-api /tmp/my-api-bench --preset sandbox --json
cd /tmp/my-api-bench
stacks verify --json
stacks runs --json
```

Choose an unused directory. Have an agent follow `.stacks/BRIEF.md`, then fix the
project until verify is green without weakening its steps. Read `.stacks/NOTES.md`,
including Asked and Findings, and improve the entry from what the run exposed. Record
the composition, agent/version, brief size, timings, verify count, interventions,
outcome and final run record in a run note. This uses existing CLI commands; there is
no shipped bench subcommand yet.

For future projects, set `"preset": "sandbox"` in `config.json` beside your user entries.
An explicit preset flag wins over that setting, then the fallback is `default`.
Use `stacks new my-api /tmp/my-api-default --preset default --json` to override it.
The sandbox alias is compatible with an explicit sandbox preset, but conflicts with an
explicit default preset. Add always uses the project's recorded preset.

## Submit it to the public registry

When the entry is proven, check it against the submission bar, preview the pull request,
then open it:

```sh
stacks validate ~/.config/stacks/stacks/my-api --submission
stacks submit my-api --dry-run --query "<a request it should win>" --query "<another>"
stacks submit my-api --query "<a request it should win>" --query "<another>"
```

`--submission` adds checks for leftover fill markers, credential-shaped strings, `.env`
files, absolute paths and a missing search card. `submit` needs the GitHub CLI (`gh`)
signed in; it forks `steamfield/stacks` and opens a draft pull request. Maintainers then
review the card, the dependencies and the shipped files, prove the entry with a bench run
and sign it into the next index. The
[contributing guide](https://github.com/steamfield/stacks/blob/main/CONTRIBUTING.md) covers
the review steps, updates and licensing.
