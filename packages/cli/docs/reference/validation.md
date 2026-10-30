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

Composed size rows use `with` as a display label: one fragment id for a single addition, or two sorted ids joined by ` + ` for a pair. An over-budget pair finding includes the command to preview that brief, including any defaults to leave out.

Every stack's base composition must verify each layer: `install`, `lint`, `typecheck` and `test`, plus a `serve` step with a probe when the stack is tagged `web` or `api`.

### Rot checks

Rot checks also try explicitly applicable fragments beside each stack's defaults when the composition pass hasn't already budgeted that combination (`compose-each`). Declared conflicts replace default fragments in either direction, following the `--without` drop hint; required fragments stay. Listed combinations keep the existing composition finding without a duplicate. Unlisted combinations are also checked against the composed brief budget. Dead `stack=` branches warn, or note when reachable only through `--with`. Verify commands must be declared in that composition's commands table. Fragment commands need verify coverage; a fragment describing an existing stack command doesn't add a new deliverable.

Author bodies with ATX headings (`## Heading`). Exact versions and dated release phrases warn outside fenced examples, in bodies, decisions and shipped Markdown. Version-sensitive config files also warn: describe how the agent should generate them instead. A bare Actions expression such as `${{ github }}` in a `.tmpl` warns; dotted expressions stay literal, and known template variables are intentional substitutions.

### Shipped references

Reference checks read the neutral-rendered, merged files for every shipped adapter. Claude settings permissions and VS Code launch arguments must name composed commands or commands named in inline code. Hook paths must exist in the composed files. Literal localhost ports in settings or VS Code JSON warn when an env variable has a `PORT` segment. Invalid reference JSON is one error per file; its reference checks are skipped.

Shipped JavaScript and TypeScript relative imports, and shell `source`/`.` targets, must resolve to composed files owned by the same entry or a dependency. A fragment may import through the transitive closure of `requires`; a stack may import through `fragments.required`. Default and optional fragments are removable and don't grant import access. Resolution maps `.js` to `.ts`/`.tsx`, tries `.ts`, `.tsx`, `.js` and `.mjs` for extensionless imports, and tries `index.ts` for directories. In shell paths, `$CLAUDE_PROJECT_DIR` means the project root; another leading variable means the script's directory.

### Ledger notes

When a registry has `runs.json`, ledger notes report stacks without a sandbox pass (`ledger-unproven`), changes since the latest pass for each preset/agent key (`ledger-changed`), and latest failed or partial runs (`ledger-failed`). Only default compositions (`with: []`) count. Infrastructure outcomes don't report failure; newer records are skipped. A malformed ledger or invalid v1 record is `ledger-schema`, an error that skips the ledger notes. A missing ledger is normal.

## Word budgets

Budgets count every conditional branch in a body and, for a composed brief, the CLI's own text too (reported separately as fixed text). Every composed brief is rendered on one fixed context (no missing tools, a fresh repository, the `npx` invocation) so the counts are the same on every machine.

| Subject | Limit (words) |
| --- | --- |
| Stack body | 2,000 |
| Fragment body | 1,000 |
| App body (`category: app`) | 3,000 |
| Composed brief | 6,000 |
| Composed brief with an app | 9,000 |

## Severities and exit codes

Findings are errors, warnings or notes. Exit 0 when there are no errors; exit 2 (`ValidationFailed`) with the full report still on stdout and `Validation failed.` (with `--json`, the error envelope, whose `details` carry the counts) as the last stderr line. A path that is neither a registry root nor an entry under `stacks/` or `fragments/` is `NotFound` (2); an unreadable root is exit 6. Warnings don't change the exit, but the bundled registry is held to zero.

Search sidecars report malformed `plain` copy as `search-invalid`, excess length as `search-size`, and version-specific copy as `plain-versioned`. A bundled registry with `allowlist.json` also checks `deps/<ecosystem>.json`: `deps-invalid` and `deps-ambiguous` are errors; `deps-missing` and `deps-unreviewed` are warnings; `deps-review-due` is a note. A registry root with `authors.json` (the bundled one has it) checks that it decodes (`authors-invalid`) and that every key names an entry in that root (`authors-orphan`); both are errors.

A search card stamped with a different source digest than the entry's current text is `search-stale`, a warning. An unreviewed author draft (`by: "author"` with `reviewedAt: null`) has no reviewed baseline to go stale against, so for one it is a note.

## Previewing a brief

`--brief <stack>` prints only the canonical composed brief to stdout. Word count, fixed-text count and limit go to stderr in human mode; agent stderr stays empty on success. `--json` returns `BriefPreview`, including its fingerprint and findings for the selected entries. Error findings exit 2 with `ValidationFailed` and keep the brief on stdout. Preview uses only the first configured agent (default `claude`), ignores `always`, and starts no processes. `--with` and `--without` take ids (repeatable or comma-separated); they and `--sandbox` work only with `--brief`.
