# Validation

`stacks validate` checks stacks and fragments before an agent builds from them. It reads files only and runs nothing from an entry. This page lists what it checks, the word budgets, and the `--brief` preview. For how to write an entry that passes, see the [authoring guide](../authoring.md).

```sh
stacks validate                                   # the bundled registry
stacks validate ~/my-registry                     # a registry root (holds stacks/ or fragments/)
stacks validate ~/my-registry/stacks/web          # one entry
stacks validate --json                            # the ValidateReport
stacks validate --brief web --with docs --sandbox # the brief a composition renders to
```

## What it checks

`validate` checks frontmatter and identity, references (`fragments`, `requires`, `conflicts`, `applies_to`), conditional prose markers, `merge` files, verify step layers, whether git ignores any of an entry's files, and composes each stack in both presets: alone (with its required and default fragments), with each optional fragment and each fitting app added on its own, then with each compatible pair of those extras. It skips pairs of two apps and pairs whose fragments conflict with each other. Each addition drops any default fragment it replaces. References resolve through every root, the one being validated first; one that resolves only in another root is a note naming that root. The bundled registry must be self-contained.

Composed size rows measure only each stack's default composition, in both presets. Compositions with optional fragments or apps added get no size row or composed-budget finding; their other checks still run.

Every stack's base composition must verify each layer: `install`, `lint`, `typecheck` and `test`, plus a `serve` step with a probe when the stack is tagged `web` or `api`.

### Rot checks

Rot checks also try explicitly applicable fragments beside each stack's defaults when the composition pass hasn't already checked that combination (`compose-each`). Declared conflicts replace default fragments in either direction, following the `--without` drop hint; required fragments stay. Listed combinations keep the existing composition finding without a duplicate. These rot checks report conflicts without budgeting the brief. Dead `stack=` branches warn, or note when reachable only through `--with`. Verify commands must be declared in that composition's commands table. Fragment commands need verify coverage; a fragment describing an existing stack command doesn't add a new deliverable.

Author bodies with ATX headings (`## Heading`). Exact versions and dated release phrases warn outside fenced examples, in bodies, decisions and shipped Markdown. Version-sensitive config files (package manifests, tool configs, workflows, Dockerfiles) warn when they contain a version: a pinned `x.y.z`, a semver range, `packageManager`, `engines`, a `go` or `toolchain` directive, or an Actions ref. Remove the version and let the agent pick current ones. A bare Actions expression such as `${{ github }}` in a `.tmpl` warns; dotted expressions stay literal, and known template variables are intentional substitutions.

### Workspace stacks

A stack with `parts` gets these findings on its own `STACK.md`, read from the workspace, its parts and the fragments it lists, without composing. A parts problem is reported here once; the compositions that fail because of it add no second finding.

| Check | Severity | When |
| --- | --- | --- |
| `part-stack` | error | A part names a stack that no registry root has. |
| `part-role` | error | A part's role isn't one this CLI knows (`api`, `web`). |
| `part-name-duplicate` | error | Two parts share a name, which is also their directory. |
| `part-nested` | error | A part's stack has parts of its own (the workspace itself or another workspace). |
| `part-roles` | error | The parts don't hold exactly one `api` part and one client (`web`) part. |
| `part-cwd` | error | A part's verify step, or a step of any fragment placed on one part (listed by the workspace or not, since `add` places every fragment that fits a part), has a `cwd` that leaves the part's directory. Every such step is reported. A validated fragment's finding is on its own `FRAGMENT.md`; the message names the step and the file or workspace it is in. |
| `part-step-session-root` | warning | A mounted step (a part's own, or one of a fragment placed on a part) names an agent harness path in its `run` (`.claude/settings.json`, `.claude/hooks/...`, `.codex/...`, `.agents/skills/...` and the other paths written at the project root whatever entry ships them). The step runs in the part's directory, where that path isn't; reach it as `../<path>` or move the step to the workspace. Reported where `part-cwd` is. |
| `part-role-rule` | error | A part breaks a Declared rule of its role: `api-port-env` (`PORT_API` in `env`), `api-healthz-serve` (a `serve` step whose `expect.http` uses `${PORT_API}` and ends in `/healthz`), `web-port-env` (`PORT_WEB` in `env`). Checked only when the parts list itself has no problem. |
| `part-required-restated` | error | A part's `fragments.required` id is missing from the workspace's `required`, once per part. A part's own tiers are never selected. |
| `link-openapi-drift` | error | The workspace requires a `category: link` fragment and the `api` part has no verify step named `openapi-drift`. |
| `workspace-heading` | warning | The body has no `## How the parts connect` or no `## Changing the API` heading (`## Setup` stays `stack-setup-section`). |
| `workspace-part-dirs` | warning | The body never mentions a part's directory as `<name>/`. |
| `part-namespace-shadowed` | warning | A workspace command key or `deps` role equals `<part>-<key>` of a part's command or role, so it replaces the part's command or merges with its role. |

In a workspace's compositions, a part step's runner target is checked against the part's namespaced command (`backend-test` covers `bun run test` in `backend/`), and `verify-run-duplicate` groups steps by directory and command, so the same command in two parts is no repeat. A fragment that fits one of a workspace's parts fits the workspace in `compose-each` and the add checks, and the add checks place it on that part.

### Shipped references

Reference checks read the neutral-rendered, merged files for every shipped adapter. Claude settings permissions and VS Code launch arguments must name composed commands or commands named in inline code. Hook paths must exist in the composed files. Literal localhost ports in settings or VS Code JSON warn when an env variable has a `PORT` segment. Invalid reference JSON is one error per file; its reference checks are skipped.

Shipped JavaScript and TypeScript relative imports, and shell `source`/`.` targets, must resolve to composed files owned by the same entry or a dependency. A fragment may import through the transitive closure of `requires`; a stack may import through `fragments.required`. Default and optional fragments are removable and don't grant import access. Resolution maps `.js` to `.ts`/`.tsx`, tries `.ts`, `.tsx`, `.js` and `.mjs` for extensionless imports, and tries `index.ts` for directories. In shell paths, `$CLAUDE_PROJECT_DIR` means the project root; another leading variable means the script's directory.

### Ledger notes

When a registry has `runs.json`, ledger notes report stacks without a sandbox pass (`ledger-unproven`), changes since the latest pass for each preset/agent key (`ledger-changed`), and latest failed or partial runs (`ledger-failed`). Only default compositions (`with: []`) count. Infrastructure outcomes don't report failure; newer records are skipped. A malformed ledger or invalid v1 record is `ledger-schema`, an error that skips the ledger notes. A missing ledger is normal.

## Word budgets

Budgets count every conditional branch in a body and, for a composed brief, the CLI's own text too (reported separately as fixed text). Every composed brief is rendered on one fixed context (no missing tools, a fresh repository, the `npx` invocation) so the counts are the same on every machine.

The composed brief budget applies only to a stack's default composition (its required and default fragments), in each preset. Optional additions are requested by the caller and aren't held to this budget. Body budgets and add-mode brief budgets still apply.

| Subject | Limit (words) |
| --- | --- |
| Stack body | 2,000 |
| Fragment body | 1,000 |
| App body (`category: app`) | 3,000 |
| Composed brief | 6,000 |
| Composed brief of a workspace (a stack with `parts`) | 7,500 |
| Composed brief with an app (a workspace's too) | 9,000 |

## Severities and exit codes

Findings are errors, warnings or notes. Exit 0 when there are no errors; exit 2 (`ValidationFailed`) with the full report still on stdout and `Validation failed.` (with `--json`, the error envelope, whose `details` carry the counts) as the last stderr line. A path that is neither a registry root nor an entry under `stacks/` or `fragments/` is `NotFound` (2); an unreadable root is exit 6. Warnings don't change the exit, but the bundled registry is held to zero.

Search sidecars report malformed `plain` copy as `search-invalid` (an error). Excess length (`search-size`), version-specific copy (`plain-versioned`) and a project example that reads as instructions or a disclaimer, such as "illustrative", "separately" or "replace the" (`example-hedged`), are warnings. A bundled registry with `allowlist.json` also checks `deps/<ecosystem>.json`: `deps-invalid` and `deps-ambiguous` are errors; `deps-missing` and `deps-unreviewed` are warnings; `deps-review-due` is a note. A registry root with `authors.json` (the bundled one has it) checks that it decodes (`authors-invalid`) and that every key names an entry in that root (`authors-orphan`); both are errors.

A search card stamped with a different source digest than the entry's current text is `search-stale`, a warning. An unreviewed author draft (`by: "author"` with `reviewedAt: null`) has no reviewed baseline to go stale against, so for one it is a note.

## Previewing a brief

`--brief <stack>` prints only the canonical composed brief to stdout. Word count, fixed-text count and limit go to stderr in human mode; agent stderr stays empty on success. `--json` returns `BriefPreview`, including its fingerprint and findings for the selected entries. Error findings exit 2 with `ValidationFailed` and keep the brief on stdout. Preview uses only the first configured agent (default `claude`), ignores `always`, and starts no processes. `--with` and `--without` take ids (repeatable or comma-separated); they and `--sandbox` work only with `--brief`.

A preview always reports the rendered brief's size. It reports a `budget-composed` error only for the default composition: passing either `--with` or `--without` exempts the preview from that budget.
