# Submitting an entry

`<cli> submit` opens a draft pull request that adds entries to the public registry (`steamfield/stacks`). A merged PR is not a release: a maintainer still reviews the entry, proves it and signs it into the next published index.

Submit only when the user asks for it. Their entry works fine from their own registry without it.

## Before you submit

The entry must be proven: a sandbox project built from its brief with `<cli> verify` green. Then run the readiness check:

```sh
<cli> validate <entry-dir> --submission --json
```

It runs the normal checks plus these:

| Check | Severity | Finds |
| --- | --- | --- |
| `fill-marker` | error | A `stacks:fill` marker left anywhere in the entry or card |
| `secret` | error | A credential-shaped string |
| `env-file` | error | A `.env*` file other than `.env.example` |
| `absolute-path` | warning | `/Users/...`, `/home/...` or `C:\` in shipped files |
| `missing-card` | warning | No search card |

The bar `submit` holds you to: zero errors, and no warnings except the ones maintainers clear after the PR.

| Warning | Why a maintainer clears it |
| --- | --- |
| `search-unreviewed` | Only a maintainer can review and stamp a card |
| `search-missing`, `missing-card` | A maintainer can draft the card, though writing one yourself (`references/search-card.md`) gets a better result |
| `deps-missing` | A package in `deps` has no dependency card yet; maintainers add it to the allowlist and write the card |
| `deps-unreviewed` | A dependency card waits for a maintainer's review |

Fix every other warning at its source before submitting.

## Requirements

- `gh` (the GitHub CLI) on PATH and signed in: `gh auth status` passes. If it doesn't, ask the user to run `gh auth login`; never handle their credentials yourself.
- A network connection. `submit` refuses `--offline`.
- The user's GitHub account can fork the registry repo. `submit` forks it, pushes a branch named `entry/<kind>-<id>` to the fork and opens the PR from there.

## Dry run first, then ask

Always run a dry run and show the user what it would send:

```sh
<cli> submit <entry-dir> --dry-run \
  --query "a go cli with layered config" \
  --query "terminal tool with json output"
```

- Pass one or more entry directories, or ids from the user registry. A stack and the new fragments it needs go in one PR together.
- Pass two `--query` values: requests the entry should rank first for, phrased differently from the card's `requests`. Maintainers use them as search test cases.

The dry run checks the entries against the registry's current `main`, not the installed CLI's copy, and prints the PR body and file list without pushing anything. Show the user the PR body and the files, and ask for a yes. Then run the same command without `--dry-run`. If a PR for the branch already exists, `submit` updates the branch and reports that PR instead of opening another.

Exit codes: 2 for bad input, a failed readiness bar or an id collision (read the error's `next`); 4 when GitHub or git is unreachable (retry later); 6 when `gh` lacks permission to fork or push (ask the user).

## Licensing

Registry contributions are licensed Apache-2.0. Before the real submit, confirm with the user that they have the right to relicense every file the entry ships, including `files/` and `adapters/` content carried over from their own projects. If any file came from somewhere with a different license, remove it or describe it in prose for the agent to generate.

## What maintainers do after

The PR opens as a draft, and CI stays red until a maintainer finishes their part. That is expected. Maintainers:

- check that the author login in `authors.json` matches the PR author
- review `files/` and `adapters/` for security, since hooks and settings run in other people's projects
- review and stamp the search card
- add new packages to the allowlist and write their dependency cards
- add search test queries (starting from your `--query` proposals) and check that existing rankings don't shift
- run the entry through the bench, a headless agent build from an empty directory
- mark the PR ready and merge once CI is green, then sign the entry into the next index publish

Tell the user the PR link, that it's a draft on purpose, and that review takes this list of steps.

## Updating a merged entry

Edit the entry in the user registry, prove it again, and run `submit` with the same id. An id that already exists upstream (or was removed) is refused unless the registry's `authors.json` names the same GitHub login as the `gh` account submitting; then it becomes an update PR. Someone else's entry can't be updated this way: open an issue or a manual PR on the registry repo instead.
