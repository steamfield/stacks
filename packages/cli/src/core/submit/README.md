# core/submit

This folder is `stacks submit`: it takes stacks and fragments an author keeps in their user registry and proposes them to the public registry as one draft pull request on GitHub. Run it with `--dry-run` to see the checks, the branch and the files without forking, pushing or opening anything.

## How it fits

`commands/submit.ts` parses the flags and renders the result; everything else happens here. The folder reads entries through `core/registry/` and checks them with `core/validate/` (the same submission checks as `stacks validate --submission`). Like all of `core/`, it never imports `platform/` or `commands/`, and it runs programs only through `services/processes.ts::Processes`.

The only programs it runs are `gh` and `git`, with fixed arguments filled by values the CLI built (the repository name, a branch, paths, a title and a body file). Nothing an entry contains is ever executed (`.claude/rules/architecture.md`, "Trust model", point 1). The CLI holds no GitHub credentials: `gh` authenticates its own requests and lends its credentials to git. Git in the clone runs with hooks off and with no credential helper but `gh`'s, because the clone is the CLI's own temporary checkout.

## The flow

`submit.ts::submit` runs these steps in order. The order is behavior: every check that can fail without touching GitHub comes first, and nothing is written to GitHub until the entries pass.

1. Refuse an offline run or a `--repo` that isn't `owner/name`.
2. `entries.ts::resolveEntries` turns each argument into an entry directory: a path, or an id in the user registry.
3. Make a scoped temporary directory, removed however the command ends.
4. `github.ts::preflight` checks that `gh` and `git` are on PATH and `gh` is logged in, and reads the login.
5. `github.ts::cloneUpstream` makes a shallow, partial clone of the upstream `main`.
6. `assemble.ts::assemble` decides whether each entry is new or an update, copies it into the clone with its search card, and records the login in `authors.json`.
7. `checkEntries` validates each entry in the clone; a blocking finding stops the submission with every blocker listed.
8. `stage` creates the branch and stages exactly the submitted paths.
9. `body.ts::pullRequestBody` renders the pull request text. A dry run returns here.
10. `publish` forks, commits, pushes and either updates the open pull request from that branch or creates a new draft.

## Files

| File | What it owns |
| --- | --- |
| `submit.ts` | The command's sequence of steps, the readiness bar (which findings block) and the result |
| `entries.ts` | Resolving arguments to entry directories, id checks and the did-you-mean |
| `assemble.ts` | Writing entries, search cards and `authors.json` into the clone; the new-or-update decision |
| `body.ts` | The pull request title (also the commit subject) and body text |
| `github.ts` | Every `gh` and `git` call, and which failure maps to which error |
| `filesystem.ts` | `writePermission`: a denied write is `PermissionDenied` with its path, anything else a defect |

## Terms

- user registry: the directory where an author keeps personal entries (`stacks create` writes there). Submitted ids are looked up in it.
- upstream: the public repository the pull request targets, `steamfield/stacks` unless `--repo` names another.
- clone: the temporary partial checkout of upstream's `main` that the submission is assembled and checked in.
- search card: the JSON file under the registry's `search/` folder that describes an entry to `stacks search`. `assemble.ts` restamps its source digest so a changed entry's card goes back for review instead of blocking the submission.
- `authors.json`: the registry file mapping each entry to the GitHub login that may update it. An id already upstream can be submitted only by its owner, as an update.
- removed id: an id listed in upstream's `removed.json`. Ids are never reused, so a removed id is refused.
- blocker: a finding that stops a submission. Every error blocks, and so does every warning except the ones maintainers finish after the pull request (`submit.ts::MAINTAINER_WARNINGS`).
- own branch: a fork branch whose tip is a commit `submit` made earlier (its subject, the user's git identity, one parent on upstream `main`). Only an own branch is replaced; any other is `branch_taken`.

## Failures

The error tags say what to do next. A problem the user fixes (missing `gh`, not logged in, no git identity, an unknown repository, a collision, a taken branch, a blocking finding, nothing changed) is `BadInput`. GitHub refusing this login is `PermissionDenied`, as is a file the CLI can't read or write. Any other GitHub or network failure is `UpstreamUnavailable`, which can be retried. A local git command failing in the clone is a defect. The `details` each carries are listed in `errors.ts`.

## Where to start

Read `submit.ts::submit` top to bottom; each step names the module that does it. The tests are `packages/cli/tests/submit.test.ts` (the command end to end against a fake `gh` and `git`), `packages/cli/tests/submit-filesystem.test.ts` (permission failures), `packages/cli/tests/submit-copy-source.test.ts`, `packages/cli/tests/validate-submission.test.ts` (the submission checks) and `packages/cli/tests/authors.test.ts`.
