# Maintaining the bundled registry

This page is for maintainers: proving bundled stacks with the bench, recording runs in the ledger, and publishing the Claude Code plugin. Commands run from `packages/cli/`.

## The bench

The bench is how a bundled stack earns its historical pass: a real coding agent builds the stack headlessly from an empty directory, and stacks verifies the result independently.

```sh
bun run bench <stack> --agent claude --keep
```

It builds the dev binary, installs it with the working registry into a throwaway prefix, scaffolds the stack, runs the agent headlessly and verifies independently. `--cli <binary>` skips the build; `--preset default` uses defaults instead of sandbox, `--with a,b` adds fragments, `--max-minutes 60` sets the time limit, and `--no-record` skips the ledger and run note. `--existing <kept-root>` continues matching content and adds one intervention.

The package must be clean before a run. The bench writes its run note under `plans/runs/` at the repository root (creating the directory if needed) and appends to `registry/runs.json`. Read every generated note and its ledger record before committing; a green verify can still need relabeling as `partial` after review. The bench never commits anything.

Auth is `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, or `CODEX_ACCESS_TOKEN` as documented by `codex login --with-access-token`. Codex also accepts the invoking user's `codex login`: when no token is set, the bench copies only `$HOME/.codex/auth.json` into the fresh home with mode 0600 and removes it when the agent exits, before verification, even with `--keep` or on interruption. Global Codex settings, instructions and MCP servers are never copied. Only the selected token reaches the agent when token auth is used. The fresh `HOME` and project are not a security boundary: local runs give the agent full permissions. Child processes get `DO_NOT_TRACK=1`. Fake-agent tests need no account or real token.

Use `--model <id>` with either adapter to select a model, for example `--agent codex --model gpt-6.1-terra`. The id accepts letters, digits, `.`, `-` and `_`, with no leading `-`. Without it, the agent chooses its default. Run notes record the credential route and model; ledger records keep their existing format.

## The ledger

The reviewed ledger is `registry/runs.json`. It's what `list` reads for "historical pass <date>". Import reviewed gate notes with:

```sh
bun run ledger:import ../../plans/runs/<note>.md
bun run ledger:import ../../plans/runs/<note>.md --dry-run
```

The script discovers the repo from the working directory, archives only the registry at each note's commit into a temporary directory and fingerprints it with the current composition code. A contradictory Outcome row and final verify record are reported and skipped; a maintainer's explicit `partial` stays partial even when verify is green. The driving agent is independent of adapter targets: targets default to `claude`, and notes for an override can include a `Target agents` table row with comma-separated ids such as `codex`, `claude`.

It records only added fragments in `with`, removing fragments already selected by the default composition at that commit. Existing `(repoCommit, stack, date)` records are skipped. Incomplete notes are reported, other notes continue, and any failure exits 1. `--dry-run` prints a JSON array and writes no ledger; `--` ends options. Bun consumes an initial `--` before passing arguments to a script, so single-dash note names are also accepted directly. Use `./` for a note name that collides with a long option.

## Building the index and official names

Fetch the release tags before building. The build reads this checkout's `v*` tags, regardless of the shell's working directory or inherited git selectors:

```sh
git fetch --tags
bun run build:index -- --out <output> --previous <live-index-url|none> --key <private-key>
bun run build:index -- --check <base-url>
```

The output includes `v1/index.json`, its immutable bundles under `v1/entries/`, `v1/names.json`, `v1/allowlist.json` (from the reviewed `registry/allowlist.json`), `v1/deps.json` (the dependency cards), `v1/search.json`, `v1/directory.json` and a `_headers` file with cache rules. Every `v1/*.json` file uses the `SignedIndex` envelope and the same signing key. The build fails when a bundled entry's `deps` names a package missing from `registry/allowlist.json`. `--unsigned` writes them with empty signatures for local inspection; `--check` rejects unsigned files. Directory added dates come from each definition file's first addition in git, using the committer date. Builds require full git history and refuse shallow clones before touching output.

For a development index that also includes stacks without a qualifying ledger pass:

```sh
bun run build:index -- --out <output> --previous none --unsigned --include-unproven
```

`--include-unproven` requires `--unsigned` and cannot be used with `--key` or `--check`; those combinations exit 2. Unproven stacks have no `lastRun` and pin their current default composition, including required fragments and transitive dependencies. Every bundled fragment is published, including optional fragments outside those compositions. Proven stacks retain their proof and pinned composition. Without the flag, the proof gate and carry-forward behavior are unchanged, including for signed builds.

Official names include every release's stack and fragment ids, each stack's default composition and each default composition plus one optional fragment. Release registries are read with `git archive` into temporary directories and composed with today's code. A release that no longer decodes or composes prints a warning naming its tag and retains recoverable frontmatter ids; unavailable composition details stay empty. Review those warnings before publishing. The index source takes each published stack's exact composition and step names from its pinned bundles, including carried-forward content and sandbox proofs that omit default deploy fragments.

With `--previous <url>`, the build also verifies and merges the previous `v1/names.json`, keeping names from earlier published compositions after steps change or entries are withdrawn. A missing names file (HTTP 404) bootstraps from the previous index's pinned bundles, for an index published before names existed. Other fetch failures, invalid payloads and invalid signatures stop the build. `--previous none` starts with release history and the current index only; use the live index URL to retain names from unreleased index publications.

Review `v1/names.json` and `v1/directory.json` alongside the index before deploying. `--check` verifies every signature, decodes the payloads and checks the immutable bundles. The deploy host must serve `/v1/names.json` and `/v1/directory.json` with `Cache-Control: public, max-age=300, stale-while-revalidate=3600`; the hosting setup lives in `stacks-api`.

When removing a published stack or fragment, add its id to `packages/cli/registry/removed.json` in the same change:

```json
{ "schemaVersion": 1, "entries": {
  "old-stack": { "kind": "stack", "removedAt": "2026-10-27",
    "reason": "Merged into new-stack", "replacedBy": "new-stack" }
} }
```

Use a calendar date (`YYYY-MM-DD`) and a plain-text reason. Omit `replacedBy` when there is no replacement; otherwise it must name a current registry or index entry. Remove the definition before adding the row: an entry retained by a carried-forward composition is still current. The build checks every official name against the current registry, selected index and removal rows, and rejects tags outside `^[a-z0-9-]+$`, naming the entry.

Removed content comes from the highest `v*` release tag that shipped the entry, including its static metadata, defaulted verify steps and last successful ledger run. An entry published only through the index uses its previous index entry and bundle and omits `last.version`; supply the live `--previous` URL so that content can be recovered. Later builds retain that content from the previous signed directory after the entry leaves the index. Keep removal rows for those later builds. Without release content or previous published content the build refuses publication, preserving existing output.

## Search judgments and baseline

`tests/fixtures/search/golden.json` records requests and relevance judgments for the bundled registry. `tests/helpers/search-golden.ts` owns its `GoldenSet` schema; `tests/helpers/search-eval.ts` evaluates any synchronous ranking function without calling a model or shipping code in the CLI.

Read an entry's frontmatter and body before judging it. Add realistic requests from bench notes, issues, the demo, or your own work, never logged user queries. Give each request a unique id, one of the seven existing pools, a `tune` or `holdout` split, and its original text, including casing and punctuation. Keep about a third in holdout (25–40%, at least twelve), with both splits in every pool.

Grade each relevant `{ kind, id }` independently: 2 means a right answer, 1 a fair alternative. Omit irrelevant entries. Set `first` only when there is one agreed best answer, and include it at grade 2 in `relevant`. It must lead its own kind's list. Leave `first` absent for ambiguous requests. Every bundled stack needs at least two first-result queries; every fragment needs at least one relevant judgment. Renaming or removing an entry requires reviewing its queries and replacement, rather than deleting coverage to make the test pass.

Use `noMatch: true` when nothing fits: no hit of either kind may be `strong`, though weaker suggestions are allowed. An imperfect language or framework fit can instead have grade-1 judgments with no `first` and no `noMatch` flag. The `no-match` pool contains both cases.

Keep golden queries out of search-sidecar drafting prompts and examples. Holdout queries must neither appear in sidecar `requests` nor share five consecutive words with them. Use only tune results while adjusting ranking or sidecars; check both splits at the gate.

Run the coverage and metric tests after changing judgments:

```sh
bun run test:unit tests/search-golden.test.ts tests/search-golden-coverage.test.ts tests/search-eval.test.ts
```

`evaluate(rank, golden)` reports tune, holdout, and query-weighted total summaries. MRR includes queries with any relevant stack, counting only stack positions through ten. Recall@3 and fragment recall@5 average only queries with grade-2 judgments of that kind; ineligible queries do not dilute the average. Empty eligible groups score zero. First-result and no-match summaries carry passed/total counts. `pairwiseWins` separately counts same-kind competitors above a present `first`; a missing `first` scores zero there but fails the first-result check.

The baseline is the `gate` object in `golden.json` (`mrr`, `recallAt3`, `fragmentRecallAt5`). `tests/search-golden.test.ts` runs local ranking against the set, requires every first-result and no-match case to pass in both splits, and lets each metric fall at most 0.02 below its baseline. When an accepted ranking raises a metric, raise that baseline in the same commit; never lower another metric to offset it. Lower a baseline only as a deliberate, reviewed decision, with the reason in the commit message. Review judgment changes as product decisions and explain their effect on the scores.

## Drafting and reviewing search cards

From `packages/cli/`, the checkout-only script drafts cards through OpenRouter:

```sh
bun run decorate --dry-run mobile-expo
bun run decorate --missing --model anthropic/claude-sonnet-4.6 --max-usd 1.00
bun run decorate --stale
bun run decorate --restamp mobile-expo
bun run decorate --approve mobile-expo
```

Set `OPENROUTER_API_KEY` in the maintainer environment for paid requests. The
default model is `anthropic/claude-sonnet-4.6`; `--model` overrides it. The optional
`OPENROUTER_BASE_URL` override accepts a loopback HTTP test server only. The script
and its credentials never ship in the package or enter the CLI's runtime graph.
The CLI reads files and never drafts through a model.

Positional ids select entries; without ids the script selects all entries.
`--missing` and `--stale` select either condition, combined as a union. Dry runs
print prompt sizes and an indicative estimate using the default model's rates,
without needing a key or making requests. Actual request logs name the model,
entry, tokens and reported cost. The total includes invalid model responses.
Before each request, the script estimates its cost as the highest per-request
cost seen in this run. It stops if that would exceed the remaining cap; the first
request goes whenever budget remains, so its unknown cost can exceed the cap.

The prompt lives in `scripts/decorate/prompt.ts`, with `PROMPT_VERSION` and two
teaching cards derived from entry bodies. Bump the version when changing the text
or examples. The script uses two reviewed registry cards when available, falling
back to the teaching cards before reviewed cards have landed. Inputs are decoded frontmatter, dependency roles, body, vocabulary
and the two examples, plus compact recipe references for example hosts and
fragment selections. Prompt version 2 asks for a fuller `description`,
`seoDescription` and illustrative `projectExamples`, while retaining the
150-word search budget. The editorial fields have separate caps and are excluded
from ranking and embeddings. A new response must contain all three editorial
fields, with nonblank text and at least one project example. Existing stored
cards keep those fields optional. A malformed, incomplete or schema-invalid new
response gets one correction
retry; HTTP 408, 429 and 5xx get up to three retries with backoff. Other failures
skip the entry and are listed. A failed draft preserves an existing card.

Drafts record the actual model and prompt version, `by: "drafted"`, and
`reviewedAt: null`. Read their claims and requests against the entry before
approving. `--approve` refuses under a detected agent or without terminal stdin
(`PermissionDenied`, reason `agent` or `no-tty`, exit 6). `--restamp` preserves
every other field and refreshes only the digest and review date after an entry
change that still fits its card. Authors can also write cards by hand.
Restamping an unread draft is refused; use the guarded approval operation first.

When dispatching agents to draft cards, provide the same prompt and examples at
the current version in a checkout without the golden evaluation set. Do not read
that set while drafting: requests must not echo holdout queries or five-word runs.
Keep agent drafts unreviewed for a person to approve. Before approval, check
examples against the named host and additions: a recipe's health slice is not a
finished product, optional fragments are not included by implication, and a
product idea cannot establish authentication, persistence or compliance.
`stacks validate` checks example selections with the existing metadata selection
rules without rendering their files.

The richer fields stay optional in schema version 1 for existing author cards
and carried-forward index data. Bundled cards should have complete editorial
coverage. See `docs/authoring.md` for field budgets and description precedence.
The bundled 30-card enrichment was approved for landing by the maintainer on
2026-10-28. Future drafts still need explicit maintainer approval; a successful
draft or validation run does not authorize `--approve` under an agent.

`build:index` publishes signed `v1/search.json` beside the index and names file.
Each indexed entry has a card; a card whose baseline differs from a carried-forward
bundle is annotated `stale: true`. `build:index --check` verifies its signature and
payload along with the index, names and immutable bundles. Metadata edits alone
leave the proven bundles unchanged.

## Publishing the Claude Code plugin

`plugin/` is a Claude Code plugin carrying the agent skill, published by hand after a CLI release to a marketplace repository the maintainers own (not created yet; see [marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) and the [manifest reference](https://code.claude.com/docs/en/plugins-reference)). `skill/SKILL.md` is the source; `plugin/skills/stacks/SKILL.md` is a committed copy, because a plugin's paths can't leave its directory. `tests/native-agent-plugin.test.ts` fails when the copy or the manifest's `version` drifts from the skill and `package.json`.

1. On the release revision, from `packages/cli/`, refresh the copy and check the plugin loads (`/stacks:stacks` should appear in the session):

   ```sh
   cp skill/SKILL.md plugin/skills/stacks/SKILL.md
   bun run test:unit tests/native-agent-plugin.test.ts
   claude plugin validate ./plugin
   claude --plugin-dir ./plugin
   ```

2. In the marketplace checkout, replace `plugins/stacks/` with `plugin/` (including `.claude-plugin/`). On first publication, create `.claude-plugin/marketplace.json` with the marketplace `name`, an `owner` and a `plugins` array holding:

   ```json
   {
     "name": "stacks",
     "source": "./plugins/stacks",
     "description": "Choose a stack with the stacks CLI and follow its brief until verify is green."
   }
   ```

   The version stays in the plugin manifest only.
3. Run `claude plugin validate <marketplace-checkout>`, `claude plugin marketplace add <marketplace-checkout>` and `claude plugin install stacks@<marketplace-name>`, and confirm the skill appears in a new session.
4. Push the marketplace, and note the CLI version and marketplace revision it carries in the release's pull request or commit message.
