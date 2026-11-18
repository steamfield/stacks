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
- Prose holds durable rules and instructions for discovering current tool details. It
  points at the shipped code instead of restating it, and tells the agent to update any
  shipped file the installed release rejects. Replace a stale fact with a durable rule, a
  discovery step against current official docs, or a verify step that asks the tool.
- `files/` holds everything the project needs except versions: source, tests,
  configs and docs from the working project. Leave out dependency versions and ranges,
  `packageManager`, `engines`, `go` directives, action refs, versioned `$schema` URLs and
  generator flags; `validate` warns on them in config files. Ship only what a verify step
  exercises, so a file that goes stale fails verify instead of passing silently. Store
  dotfiles literally, such as `files/.gitignore`. Name a `biome.json` `biome.json.tmpl`,
  so this repository's Biome doesn't read it as a nested config. Adapter files live under
  `adapters/claude/`, `codex/`, `opencode/` or `cursor/`.

Use snake_case keys: `schema_version`, `applies_to`, `requires_tools`, `needs_own_repo`.
An app is a fragment with `category: app`; fill its `applies_to` with a stack id or tag.

Keep Setup numbered, and open the body with what stacks wrote. Use a generator only for
what can't ship as files (native project directories, a lockfile): tell the agent to
inspect its current help, run it non-interactively into a subdirectory and merge the
output without overwriting shipped files. Do not freeze generator flags. Declare exactly one task-runner tag, `make` or `scripts`,
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

Tag a step `hygiene` when it checks the project's upkeep rather than its code: a fill
marker, the harness doc, the CI workflow, git hooks. Plain `stacks verify` skips hygiene
steps and can still be green; `verify --all`, the definition of done, runs them.

A shipped Markdown line that is only `<!-- stacks:fill:commands ... -->` is filled by
`new` with one table row per declared command (`make <name>` or `bun run <name>`, by
the stack's tags). Leave any marker that needs an install, such as tool versions, to
the agent.

A `.tmpl` file can use only `{{project_name}}`, `{{project_slug}}`, `{{env_prefix}}`,
`{{package_scope}}`, `{{author}}` and `{{year}}`. Use `{{package_scope}}` for scoped
package names. Conditional prose uses standalone markers, without nesting:

```md
<!-- stacks:when preset=sandbox -->
Describe the local-only setup.
<!-- stacks:end -->
```

Other condition keys are `stack`, `tag`, `tag!=`, `mode`, `with`, `payload` and `part` (`part=web` holds in a workspace that has a part with that role)
(`example` or `none`).

In add mode, matching `with=<added-fragment>` blocks from the recorded host stack
and already-applied fragments appear under that addition as notes from each recipe's
current version. Other host prose stays out. Phrase notes about existing files
conditionally, since an older project may differ from today's recipe.

With no known recorded stack, add infers conditional tags from data only: Makefile
gives `make`; package.json gives `node`, and an object `scripts` gives `scripts`
unless Makefile exists; bun.lock, bun.lockb or `packageManager` starting `bun@`
gives `bun`; tsconfig.json, go.mod, pyproject.toml and Cargo.toml give `typescript`,
`go`, `python` and `rust`. A `workspaces` field or manifests in at least two
immediate child directories give `monorepo`. The brief prints the inferred tags;
they affect conditionals only, never `applies_to` fit, and are not stored in the manifest.

Fragments can ship `stacks/<stack-id>/<path>` alongside `files/` and `adapters/`.
Only that host stack gets `<path>`, in new and add mode. The stack must exist and
fit `applies_to` by id or tags (empty admits all). Stack entries cannot have
overlays, and an overlay cannot duplicate a `files/` output path of its fragment.
Templates, merge rules and security checks apply to overlays too. Keep
`stacks:when` and `stacks:end` in entry bodies: shipped files reject them.
`stacks:fill` remains legal.

A stack can ship its starting code as payload variants: `payloads/example/<path>` is
written by default and `payloads/none/<path>` by `new --payload none`, beside the
shared `files/`. Only `example` and `none` exist, and only stacks have payloads.
Use `<!-- stacks:when payload=none -->` for body prose about one variant.

Verify steps check; they never generate source (no generator, and no write or fix
mode of a tool, in a verify step). Validation notes fragments without verify steps and repeated
commands in a composition, and budgets add briefs with each admitted stack and none.

## Workspace stacks

A workspace stack mounts an API stack and a client stack into subdirectories of one
project and adds the files that belong to the whole at the root. It is a `kind: stack`
entry with a `parts` list:

```yaml
id: hono-react
kind: stack
parts:
  - { name: backend, role: api, stack: hono-api }
  - { name: frontend, role: web, stack: react-vite }
fragments:
  required: [openapi-client]
  default: [agent-ops, git-hooks, ci-github]
```

Each part has three fields. `name` is kebab-case and unique in the workspace: it is the
part's directory and the prefix on its steps, commands and dependency roles
(`backend-lint`). `role` is `api` or `web`. `stack` is the id of the stack to mount. A
workspace has exactly one `api` part and one client part, and a part cannot itself have
parts. `validate` reports, and `new` refuses, an unknown part stack, an unknown role, two
parts with one name, a part that has parts, and any other count of roles.

The workspace's `fragments` tiers are the project's; a part's own tiers are not selected.
Restate in the workspace's `required` tier every fragment a part requires (`validate`
fails a workspace that omits one), and choose which of the parts' defaults to restate.
`--with` still reaches the others.

### What a part must meet

A stack named as a part meets the rules of its role. Declared rules are read from the
entry and checked by `validate` on every workspace's parts. Proven rules are behavior:
the workspace's verify steps exercise them, and they hold once the workspace goes green.

An `api` part:

- Declared: `PORT_API` is in its `env`, and it has a `serve` step whose `expect.http`
  contains `${PORT_API}` and ends in `/healthz`.
- Declared, for a link to read: it writes its OpenAPI document to `openapi.json` in its
  own directory and has a verify step named `openapi-drift` that fails when the file is
  stale. The document is generated and committed during Setup, never shipped in `files/`,
  since its bytes depend on the installed framework release.
- Proven: resources sit under `/v1`, and the example resource is `notes`, with
  operation ids `listNotes`, `getNote` and `createNote` and list rows under `items`.

Any client part:

- Proven: it reaches the API through one base URL read from its own configuration,
  never a host written into source.
- Proven: every call goes through a single API client module at a path its body names,
  which exposes one request function taking a method, a path and a body.
- Proven: it calls the example resource, with a test that fails if it does not.
- Proven: from a failed response it reads only the status and the `x-request-id`
  header, since the error body differs by API stack.

A `web` part, on top of the client rules:

- Declared: `PORT_WEB` is in its `env`.
- Proven: a dev proxy forwards `/api` to `PORT_API` and strips only the `/api` segment,
  so the base URL is `/api` and calls name `/v1/...` themselves. A preview server of the
  build uses the same proxy.
- Proven: the proxy has no fallback port. It is configured only when `PORT_API` is set,
  so the stack still runs standalone.

A part's hooks run at the workspace root for files in both parts. A hook finds its tools
by walking up from the edited file, never by joining a path to the project root; a
stack's own hook file names carry the stack id; and a guard has to be safe for the whole
workspace.

### Layout and placement

`new` writes each part's files unchanged under its name and the workspace's own files
at the root. Each part's verify steps get the part directory as `cwd` and the part name
as a prefix. A part keeps its own Makefile or `package.json`, `.gitignore`, `biome.json`,
`README.md` and `.env.example`, and the brief tells the agent which copy a section means.
`AGENTS.md` and `CLAUDE.md` usually come from `agent-ops`, which has an empty
`applies_to` and so lands once at the root: a part then has no copy of its own, and what
its body asks of `AGENTS.md` goes in the root one.

A fragment is placed by stack id in `applies_to`, never by tag:

- `applies_to` names exactly one part's stack: the fragment is written under that part,
  its steps get the part's `cwd` and prefix, and its `stacks/<part stack id>/` overlay
  applies. Its `merge:` list is mounted with its files.
- `applies_to` is empty, matches only by tag, or names the workspace: it is written once
  at the root, and a `stacks/<workspace id>/` overlay applies.
- `applies_to` names more than one part's stack: it is written once at the root.

Agent adapters follow one more rule. The paths each harness reads only at the session
root are written at the project root, whichever entry ships them; everything else stays
in its part, including `.claude/rules/**` and `.claude/skills/**`.

| Harness | Written at the project root |
| --- | --- |
| Claude Code | `.claude/settings.json`, `.claude/hooks/**`, `.claude/agents/**`, `.claude/commands/**` |
| Codex | `.codex/**`, `.agents/skills/**` |
| Cursor | `.cursor/hooks.json`, `.cursor/hooks/**` |
| OpenCode | `opencode.json`, `.opencode/**` |

Identical files from two parts become one file at the root, and both parts'
`.claude/settings.json` are deep-merged.

### What the workspace ships

At the root, and nothing a part already owns:

- A Makefile that delegates to each part (`make -C backend`, `cd frontend && bun run`)
  and owns the cross-part targets: regenerating the client, the check that runs both
  parts, and the full check. Its lint and format targets run Biome inside each part,
  since a Biome run from the root fails on the parts' root configs. A port exported in
  the shell wins over one in an included `.env`. When the workspace is tagged `make`,
  `new` fills the root `AGENTS.md` commands table with `make <part>-<command>` rows for
  every part command, so the Makefile needs targets of that form (a `<part>-%` pattern
  rule that runs the part's script covers them).
- `README.md` and `.env.example` for the whole project.
- What the root `AGENTS.md` must hold: the cross-part commands, the change workflow,
  where each part's commands run, and links to the contract document and each part's
  guidance. It is the one instruction file every harness reads in a session started at
  the root. When `agent-ops` writes `AGENTS.md` and `CLAUDE.md` (any composition with
  `claude-harness`), the workspace can't ship them; its Setup says what to fill in, and a
  verify step checks the root `AGENTS.md` for it.
- A short contract document such as `docs/CONTRACT.md`: the request path, the
  contract's owner and the change workflow. A verify step checks it names each part
  directory and holds no fill marker.
- A verify step that runs both parts and sends one request through the client's proxy
  to the API.

### Who writes what

| Knowledge | Where it goes |
| --- | --- |
| How one half works alone: layout, conventions, tests, gotchas | The part's stack body |
| How the generated client works: where the document is read from, the regenerate command, read-only output, what a failed drift check means | The link's body |
| What is true of this pair: setup order, the request path, root commands and what each wraps, cross-part tests, CI and hooks per part, settings | The workspace body |
| What a fragment on one part needs from the other part | That fragment's body, in a `stacks:when part=<role>` block, which holds only in a workspace with a part of that role |

### The workspace body

A workspace body has three required headings, which `validate` checks:

- `## How the parts connect`: the request path from client to API (base URL, proxy,
  prefix), which part owns the contract, and what crosses the boundary (the example
  resource, the error fields the client reads, any header both sides rely on).
- `## Setup`: one ordered sequence across the parts, ending in `stacks verify`. It names
  the step that first produces each link's generated output and the checks that fail
  before it; a client's typecheck and tests usually need the generated client. It refers
  to a part's setup by what each step does, never by its number.
- `## Changing the API`: the cross-part workflow for the commonest task. Change a route,
  regenerate the document and the client, update the client code, commit the generated
  output with the change, run both parts' tests.

The body names every part's directory at least once. `## Commands` and `## Testing`
list the root targets with what each delegates to and the tests that need both parts
running. Two more things live only here: each part's CI toolchain and check commands
inside a `with=ci-github` block, and each part's hook jobs inside a `with=git-hooks`
block, because the parts' own blocks for those fragments drop when mounted; and where
settings come from, meaning the root `.env` and how its values reach each part.

Keep the body near 400 words. A composed workspace brief carries both part bodies and
the link, and the 6,000-word composed limit applies as to any stack. Anything about one
half goes in that half's stack.

### Links

A link is a fragment with `category: link`. It belongs to the client part and takes one
input from the API part: the OpenAPI document. Its `applies_to` names the client stack,
so its files land in the client part's directory and its steps run there.

- It ships only its own new files, written relative to the client part. Its generator
  config reads `./openapi.json`, which a root target the workspace ships copies from the
  API part. It ships no generated client: that is Setup output.
- It cannot change a file another entry writes or a template. Package scripts the link
  needs are added by the agent from its body, and a verify step fails when they are
  missing. Settings a client stack needs for the link, such as lint excludes for the
  generated directory, ship in the client stack, where they are inert without it.
- Its drift step regenerates into a temporary directory and compares with the committed
  output, never with git, so it passes on correct output that isn't committed yet.
- Its body is written in roles, "the API part" and "the client part", never directory
  names. The brief opens the link's section with which part is which.

The workspace lists its link in the `required` tier.

A fragment placed on one part that affects the other (a new route the client has to
regenerate for) says so in its own body, inside a `stacks:when` block that holds only
in a workspace, written in the same roles.

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
| `projectExamples` | 1 to 3 project ideas, each with a `title` (8 words maximum) and `description` (35 words) that describes the finished project as its users would see it, not the steps to build it |
| `plain` | Optional plain-language `whatItIs` (30 words maximum), plus 1 to 3 short `goodAt` and `notGoodAt` items (15 words each); `show` uses the first project example |

All editorial strings must be nonblank. An example on a fragment card also names
its host `stack`; on a stack card, that host is the card itself. Optional
`withFragments` lists up to 3 distinct additions needed beyond that entry and
the host's defaults. Validation checks the same selection rules as composition,
including compatibility, dependencies and conflicts.

In `description`, explain what the recipe establishes and what a product still
needs, naming optional additions for persistence or AI and custom work such as
authorization or native permissions. A project example describes the finished
project as its users would see it; it names the additions it needs in
`withFragments` and leaves set-up steps and remaining work to `description` and
`caveats`. Do not invent compliance, readiness, pricing or timing claims.
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
or null for an unread draft. Maintainers set the baseline and review stamp with
the checkout's maintainer approval operation after reading the card (see
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
instructions; drop version literals from shipped configs; use ATX headings; repair unknown
references, unreachable conditionals and template variables. Imports must belong to the
entry or its required dependencies; a fragment's stack overlay may also import its host
stack's files. Declare commands and cover fragment deliverables
with verify. Repair shipped hook/editor command references and stale run fingerprints.
Review warnings as well as errors.

Keep stack bodies below 2,000 words, fragments below 1,000 and apps below 3,000;
the default composed brief limit is 6,000 (9,000 with an app). Move optional shared material into
a fragment, reference material into a shipped doc linked from the body, and cut what
the agent would do anyway. Validation budgets only the default composition in both presets;
optional fragments, fitting apps and compatible pairs still get the other composition checks.
Preview always reports the selected composition's size, but enforces the composed budget only
without `--with` or `--without`. Body and add-mode brief budgets still apply.

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
