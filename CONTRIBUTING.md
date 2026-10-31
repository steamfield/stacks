# Contributing

Two kinds of contribution land here: registry entries (stacks and fragments under `packages/cli/registry/`) and code. This page covers entries. For code, read [AGENTS.md](AGENTS.md) and open a PR with the default template.

## Contributing a stack or fragment

An entry is a recipe a coding agent builds projects from. [The authoring guide](packages/cli/docs/authoring.md) covers the format. The fastest route is to let your coding agent do it with the `stacks-author` skill:

- Claude Code: install the stacks plugin, or run `stacks skill install stacks-author`.
- Other agents: `stacks guide author` prints the same guidance, and `stacks guide author <topic>` prints each part.

Then ask the agent to "turn this repo into a stack" or "make me a stack for a Rust CLI". The flow it follows:

1. Search the registry first (`stacks search "<what you want>"`). An existing stack plus fragments often covers it.
2. Create the entry in your user registry: `stacks create stack <id>` or `stacks create fragment <id> --category <category>`.
3. Fill it in, with a search card, and run `stacks validate <entry-dir>` until it's clean.
4. Prove it: `stacks new <id> <empty-dir> --sandbox`, have an agent build from `.stacks/BRIEF.md`, and run `stacks verify` until it's green.
5. Check readiness: `stacks validate <entry-dir> --submission`. It must report no errors, and no warnings except `search-unreviewed`, `search-missing`, `missing-card`, `deps-missing` and `deps-unreviewed`, which maintainers clear.
6. Preview the PR: `stacks submit <entry-dir> --dry-run --query "<request>" --query "<request>"`. The two queries are requests the entry should rank first for.
7. Submit: `stacks submit <entry-dir> --query ... --query ...`. It needs the GitHub CLI (`gh`) signed in, forks this repo, and opens a draft PR.

A manual PR works too. Put the entry in `packages/cli/registry/stacks/<id>/` or `fragments/<id>/`, its card in `packages/cli/registry/search/stacks/<id>.json` or `search/fragments/<id>.json`, and your GitHub login under `"stack/<id>"` or `"fragment/<id>"` in `packages/cli/registry/authors.json`. Open it as a draft with the entry template (`?template=entry.md` on the compare URL).

## What maintainers do

A new entry's PR stays a draft, and CI stays red until a maintainer finishes these steps. That's expected.

- Check that the login in `authors.json` is the PR author.
- Review `files/` and `adapters/` for security. Hooks and agent settings run in other people's projects.
- Review the search card, then approve and restamp it.
- Add new packages to `registry/allowlist.json` and write their dependency cards.
- Add golden search queries (starting from your proposals) and check that existing rankings don't shift.
- Run the entry through the bench: a headless agent builds it from an empty directory and stacks verifies the result.
- Mark the PR ready once CI is green, merge it, and sign the entry into the next published index.

## Updating your entry

Edit your copy, prove it again, and run `stacks submit` with the same id. An existing id is accepted only when `authors.json` names the same GitHub login as the account submitting; otherwise it's refused as a collision. To change someone else's entry, open an issue or a regular PR.

## Licensing

This repository is licensed under [Apache-2.0](LICENSE), and so is every contribution. By submitting an entry you confirm that you have the right to license every file it ships under Apache-2.0, including content in `files/` and `adapters/` taken from your own projects.
