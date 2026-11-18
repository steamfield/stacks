# Spike 4: agent adapters in a workspace

`py-A` (Spike 1's python-api + react-vite, adapters hoisted to the root), `py-B` (untouched copy, adapters in parts),
`hono-A` / `hono-B` (default-preset `hono-api` + `react-vite` scaffolds with `--agents claude,codex,cursor,opencode`,
under `backend/` and `frontend/`, typescript + biome installed; not green), `raw/` (the five scaffolds), `tools/`
(`merge.ts` imports the composer's real `deepMerge`; `hook.sh` feeds a hook the JSON and env a harness would; `oc.mjs`
loads the OpenCode plugin and calls its callbacks). Tags: [E] executed, [D] from documentation, [R] read from the code.

## Summary

1. Neither RFC option works as stated. A: hoisting everything to the root needs a part-prefix on rule globs, rule links, skill prose and Cursor globs, and breaks root-assuming hooks. B: part sessions lose every project-scope adapter (agent-ops is selected once, so it lands at the root), Codex part hooks fail open, and a part session can't run the cross-part work the workspace exists for.
2. A third option works with no template value: write each file where its harness reads it. Files a harness reads only at the session root go to the root: Claude settings and hooks, `.codex/`, `.cursor/hooks*`, `opencode.json`, `.opencode/`. Path-scoped instructions stay in the part, because Claude resolves a nested `.claude/rules` glob against that part [D].
3. With hoisted hooks, agent-ops' lint, format, guards, smoke and session-start all work for files in either part from a root session. Each finds the part's own biome, ruff or venv through `find_up` [E].
4. `typecheck-on-write.ts` is silent at the root for both parts: it only looks for `<root>/node_modules/.bin/tsc` [E]. A 3-line find-up toward the root fixed it [E]. Six other stack hooks make the same root assumption [R].
5. Merging both parts' `.claude/settings.json` with `deepMerge` gives each hook exactly once. The result matches a merge of the raw adapters. Allow lists become a deduplicated union of the same strings [E].
6. A hoisted part-scoped rule leaks. `rest-api`'s `**/api/**` matches `frontend/src/api/client.ts` [E, glob match with `path.matchesGlob`], and its links point at a root `docs/` that doesn't exist [E].
7. `claude-harness` and `claude-harness-docs` (named by both parts) go to the root, once. Everything they ship is either root-only for its harness or project-generic. Under "each part" a root session loads none of their settings [D]. Under "one part" the choice is arbitrary.
8. Option A's template value is not a project value, so it can't live in `NEUTRAL_VARS`. Adding the variable changes no existing fingerprint, but each converted stack file stales that stack's proof. Merge files (`settings.json`) can't be templates at all (`merge_template`). The third option avoids the variable for every Claude file. One registry case (a one-part fragment's Cursor rule or Codex/OpenCode skill) still needs a decision.
9. The workspace stack must ship at the root: `AGENTS.md`, a `CLAUDE.md` importing it, root allow entries for its Makefile targets, and a guard for its never-exiting `make dev`. Its root `AGENTS.md` must link each part's `docs/guidance/<stack>/`, since Codex at the root never reads part files [D].
10. Not testable here: real rule, skill and instruction loading in live sessions of any harness, Claude permission matching, Cursor nested `.cursor/rules`, and Codex/Cursor hook execution by the harness itself (only their commands were run).

## 1. Inventory

What each shipped adapter assumes about the root, by harness. Paths are as written in a scaffold.

### agent-ops (`applies_to: []`; `merge: [.claude/settings.json, .codex/hooks.json]`)

`files/` (written for every target, not adapter-gated):

| Path | Root assumption |
| --- | --- |
| `.claude/hooks/_lib.sh` | `project_root` = `CLAUDE_PROJECT_DIR`, else `<hook dir>/../..`. `find_up` walks from the edited file. |
| `.claude/hooks/block-destructive.sh`, `_destructive-patterns.sh` | "Working directory" means the command's cwd. `rm -rf <part>` from the root is not denied [E]. |
| `.claude/hooks/detect-secrets.sh` | None found. |
| `.claude/hooks/lint-on-write.sh` | Only lints files under `project_root` or the payload `cwd`. Linter config and binaries come through `find_up` from the file. Works per part from the root [E]. |
| `.claude/hooks/format-changed.sh` | `cd root`, then `find_up` per file. Works per part from the root [E]. |
| `.claude/hooks/smoke.sh` | Hook configs relative to the root. Passes at the root [E]. |
| `AGENTS.md.tmpl` | One per project, at the cwd of `agents-md-filled`. |
| `docs/guidance/engineering/*` | Linked from AGENTS.md as `docs/guidance/engineering/...`. |

Claude adapter:

| Path | Root assumption |
| --- | --- |
| `CLAUDE.md` | `@AGENTS.md` beside it. |
| `.claude/settings.json` | Every hook is `${CLAUDE_PROJECT_DIR}/.claude/hooks/<name>`. Deny rules are `./.env` and `./**/.env`, which anchor at the cwd [D]. Also `Edit(./.stacks/manifest.json)`. |
| `.claude/hooks/session-start.sh` | `cd project_root`. Checks `.stacks/BRIEF.md` and `AGENTS.md` at the root, and dependencies at the root and one level down (it already anticipates `backend/` + `frontend/`). |
| `.claude/rules/engineering.md` | Globs `**/*.ts` and the like, so it is location-independent. |
| `.claude/README.md`, `.claude/.gitignore` | None. |

Codex adapter:

| Path | Root assumption |
| --- | --- |
| `.codex/config.toml` | None. |
| `.codex/hooks.json` | `root=$(git rev-parse --show-toplevel)`, then `$root/.claude/hooks/block-destructive.sh` and `$root/.codex/hooks/check-patch.sh`. The git root, not the `.codex` directory. |
| `.codex/hooks/check-patch.sh` | Same as `hooks.json`. |

Cursor adapter:

| Path | Root assumption |
| --- | --- |
| `.cursor/hooks.json` | `bash .cursor/hooks/guard.sh`, relative. Cursor runs project hooks from the project root [D]. |
| `.cursor/hooks/guard.sh` | `$hook_dir/../../.claude/hooks`, a sibling `.claude`. |
| `.cursor/rules/agent-ops.mdc` | `alwaysApply`. |
| `.cursor/rules/engineering.mdc` | `**/*` globs. |

OpenCode adapter:

| Path | Root assumption |
| --- | --- |
| `opencode.json` | Permission strings only. |
| `.opencode/plugins/agent-ops.js` | Hooks at `<plugin>/../../.claude/hooks/`. `CLAUDE_PROJECT_DIR` = the session `directory`. |
| `.opencode/hooks/check-patch.sh` | Relative to the plugin. |

### claude-harness (names both `hono-api` and `react-vite`; requires agent-ops)

| Path | Kind | Root assumption |
| --- | --- | --- |
| `.claude/hooks/_lib.ts` | `files/` | `projectRoot()` = `CLAUDE_PROJECT_DIR`. |
| `.claude/hooks/typecheck-on-write.ts` | Claude adapter | `join(root,"node_modules/.bin/tsc")`, `cwd: root`, `root/.claude/hooks/before-typecheck.ts`, `node_modules/.cache` under the root. Silent at a workspace root [E]. |
| `.claude/settings.json` | Claude adapter, merge | One PostToolUse entry via `${CLAUDE_PROJECT_DIR}`. |

The FRAGMENT body asks to "Include `.claude/hooks/` in TypeScript checking". Both parts' tsconfigs do, through `.claude/hooks/**/*.ts` relative to the part. Hoisted hooks are covered by no tsconfig.

### claude-harness-docs (names both)

Claude adapter only: `.claude/agents/{architect,reviewer}.md`, `.claude/commands/{check,feature,test}.md` and `docs/harness.md`. The content is generic: it points at AGENTS.md "Commands" and at `.claude/`. The `harness-doc-filled` step reads `docs/harness.md` at its cwd.

### Stacks

- **hono-api** (Claude only): `.claude/settings.json` (allow `bun run lint`, `bun run test`, …; deny `./.env`; a PreToolUse Bash hook via `${CLAUDE_PROJECT_DIR}`); `.claude/hooks/guard-hono-api-commands.sh` (sources `${CLAUDE_PROJECT_DIR}/.claude/hooks/_lib.sh`); `.claude/rules/hono-api/{api,testing,verification}.md` (`src/**`, `tests/**`, `scripts/**`, links `../../../docs/guidance/hono-api/*.md`); `.claude/skills/add-resource/SKILL.md` (prose paths `src/...`, `tests/...`, `docs/guidance/...`, `bun run check`). Not an adapter: `docs/guidance/hono-api/*`.
- **react-vite** (Claude only): the same shape, with rules `react-vite/{app,testing,verification}.md` (`src/**`, `index.html`, `vite.config.ts`, `e2e/**`), skill `add-page`, an allow list, and `hooks: {}`.
- **python-api** (Claude only): `.claude/settings.json` (allow `make lint`, `make openapi`, `uv run pytest *`, …; no hooks) and `.claude/rules/python-api.md` (`app/**`, `scripts/**`) and `python-api-testing.md` (`tests/**`).
- **rest-api** (selected by hono-api; `applies_to` names hono-api, not react-vite): one adapter per harness. Claude `.claude/rules/rest-api.md`; Cursor `.cursor/rules/rest-api.mdc` (`globs: **/api/**,**/routes/**,…`); Codex `.agents/skills/rest-api/SKILL.md` and OpenCode `.opencode/skills/rest-api/SKILL.md` (links `../../../docs/guidance/rest-api/index.md`). Not an adapter: `docs/guidance/rest-api/*`.

Registry-wide [R]: adapter files are 228 Claude, 12 Codex, 11 Cursor and 10 OpenCode. Fragments with a Cursor rule: `openrouter-chat` (`.mdc.tmpl`), `rest-api`, `effect-otlp`, `effect`, `rr`, `openrouter-chat-cli` (`.tmpl`), `bun-release`. So templated adapter rules already exist.

Stack hooks that hard-wire `root` = the project and so break when hoisted [R]:
- `nextjs` `typecheck-tools-on-write.ts`
- `nuxt` `typecheck-nuxt-on-write.ts`
- `before-typecheck.ts` in `react-router`, `sveltekit` and `nextjs`

Same-name, different-content hooks that would collide at one root [E, `cmp`]: `dev-server-status.ts` (typescript-api vs react-router, a plausible API + web pair), `guard-maven.sh` (spring-boot-api vs quarkus-api) and `guard-tui.sh` (go-tui vs rust-tui).

## 2. Results per option and harness

### Option A: everything at the root, part-prefixed

Built by hand in `hono-A` and `py-A`. Mechanical edits a rule would have to make:

| What | Edit | Hono pair | Python pair |
| --- | --- | --- | --- |
| Claude rule `paths:` | Prefix every glob with `<part>/` | 6 stack rules, 18 globs. Plus `rest-api.md` (7 globs), which **must** become `backend/**/…`, or `**/api/**` matches `frontend/src/api/client.ts` [E glob] | 2 rules, 3 globs |
| Rule body links | `../../../docs/…` → `../../../<part>/docs/…` (3 levels up from `.claude/rules/<stack>/`, 2 from `.claude/rules/`) | 7 links [E, files resolve after the edit] | none |
| Skills (Claude, and Codex/OpenCode `rest-api`) | Prose paths (`src/schemas/notes.ts`, `bun run check`) need `<part>/` or a "work in `<part>/`" line. Links `../../../docs/…` get the prefix | 2 Claude skills (about 20 paths); 2 rest-api skill links | none |
| Cursor rule globs | `rest-api.mdc` globs need the prefix (same leak as the Claude rule) | 1 file | none |
| Hook commands in `settings.json` | None. `${CLAUDE_PROJECT_DIR}/.claude/hooks/<name>` resolves once the scripts are at the root [E smoke] | 0 | 0 |
| Hook scripts | `typecheck-on-write.ts` needs a find-up for `tsc`, and the `before-typecheck.ts` location must be defined [E] | 1 | 1 |
| Hook scope | `guard-hono-api-commands.sh` now also denies `cd frontend && bun run dev` and `bun run --cwd backend dev` [E]. Harmless here, but a backend guard governs the frontend, and nothing guards the root's `make dev` [E] | — | — |
| Allow lists | No edit is possible: `settings.json` is a merge file and can't be a template. The merged list holds identical strings from both parts (`bun run lint` once). See below | — | `make lint` from python-api now approves the root Makefile's `lint`, which lints both parts |
| tsconfig includes | Parts include `.claude/hooks/**/*.ts`, which now matches nothing. Root hook TS is unchecked unless the workspace ships a root tsconfig | 2 files | 1 |
| Hook file names | Stack hooks must be stack-namespaced or they collide at the root (`dev-server-status.ts` and the others above) | 0 here | 0 |
| `AGENTS.md` / `CLAUDE.md` | agent-ops is selected once, so one at the root. The parts' command tables have to live in it | — | — |

Results per harness:

- **Claude Code.**
  - The merged root `settings.json` is the 7 hook entries (each script once) and 24 allow / 25 deny entries. It equals `deepMerge` over the four raw adapter files [E].
  - Hooks with a file in either part, from a root session:
    - lint-on-write: backend biome with its grit plugin; frontend biome; backend ruff from `backend/.venv` [E].
    - format-changed formats a `.ts` and a `.py` file in different parts [E].
    - typecheck-on-write is silent for both until patched; after the patch it reports the frontend error [E].
    - session-start, block-destructive, detect-secrets and smoke work [E].
    - The frontend lint hook doesn't "fire on" backend files with the frontend config: `find_up` picks the nearest config, so each part's config applies only to its own files [E]. Running `biome` from the root itself fails with "Found a nested root configuration", with or without adapters. Root tools must `cd` into each part [E].
  - Rules, once prefixed, load when a matching file is touched; globs are relative to the directory holding `.claude` [D].
  - Allow rules: a compound `cd frontend && bun run lint` is approved by `Bash(bun run lint)`. `cd` into the working directory is read-only, and each subcommand is matched separately [D]. `bun run --cwd frontend lint` and `make -C backend lint` match nothing [D].
- **Codex.** The root `.codex/hooks.json` resolves the git root and runs the root guards. This works from a root cwd and from `backend/`, since Codex loads `.codex` layers from the project root down to the cwd [E command, D loading].
- **Cursor.** The root `.cursor/hooks.json` with `bash .cursor/hooks/guard.sh` denies `rm -rf .` when run from the root [E]. Project hooks run from the project root [D].
- **OpenCode.** The root plugin, with directory = root and a backend file: guard denies, lint reports backend biome issues [E]. With directory = `backend/` (the plugin found upward [D]) and a frontend file, the guard works but lint is skipped, because the file is outside `CLAUDE_PROJECT_DIR` and the cwd [E].

### Option B: adapters stay in each part, session starts in the part

`hono-B`, `py-B`.

What a root session lacks:
- [D] Claude: no `settings.json` at the root, so no hooks and no permissions at all. Settings are read from the primary working directory and "aren't inherited from parent directories". The agent-ops guards are unenforced.
- [D] Nested `.claude/rules` and `.claude/skills` do load on demand from a root session, with `paths:` relative to the part. Nested `CLAUDE.md` loads on demand too. Nested `.claude/agents` and `.claude/commands` are not documented to load.
- [D] Codex: a root session reads only the root `AGENTS.md` and root `.codex/` layers. AGENTS.md discovery stops at the cwd, and `.agents/skills` is read from the cwd up. Part AGENTS.md, hooks and skills are invisible.
- [D] Cursor: nested `AGENTS.md` applies when working in that directory. Nested `.cursor/hooks.json` is not documented. Nested `.cursor/rules` is not in the current docs (an older changelog and forum posts conflict).
- [D] OpenCode: nested `AGENTS.md` loads when a file below is read. `opencode.json` and `.opencode/` are found from the cwd upward only, so a root session gets no part plugin or skill.
- And there is no root `AGENTS.md` in any harness.

What a part session can't see or do:
- [D] Claude limits file access to the subtree "until you grant more". The root Makefile, `docs/CONTRACT.md`, the other part and `frontend/openapi.json` regeneration (root `make api-client` copies `backend/openapi.json`) all need `--add-dir` or `additionalDirectories`. No part allow list approves `make api-client`.
- [E] session-start in a part never finds `.stacks/BRIEF.md` at the root, so the "read the brief" line is silent.
- [D] Ancestor `CLAUDE.md` and `AGENTS.md` do load in a part session (Claude, Codex root→cwd, OpenCode cwd→up), so a root `AGENTS.md` written by the workspace still reaches part sessions.

Hooks in part sessions:
- [E] Claude: the frontend's typecheck reports in a frontend session. A backend session's lint and typecheck skip a frontend file, because it is outside root and cwd, so cross-part edits get no feedback.
- [E] **Codex fails open.** A part `.codex/hooks.json` resolves `git rev-parse --show-toplevel` (the repository root), finds no `.claude/hooks/block-destructive.sh` there, and prints "not found under the git root; allowing call."
- [E] Cursor works with the part opened as the project; opened at the root, the part config is not loaded [D].
- [E] OpenCode works with directory = the part.
- [R + E] The python pair is worse. The lean python-api ships no agent-ops, so a backend session has no guards at all. In a composed workspace agent-ops is selected once and lands at the root, so **every** part session lacks it unless project-scope fragments are written into every part (N+1 copies, and a separate per-part merge of `settings.json`).

### Option C (recommended): write each file where its harness reads it

Hoist only the files a harness reads exclusively from the session root (or its ancestors). Keep path-scoped instructions in the part.

| Harness | Hoisted to the root (a fixed list per harness) | Stays in the part |
| --- | --- | --- |
| Claude | `.claude/settings.json` (merged), `.claude/hooks/**`, `.claude/agents/**`, `.claude/commands/**` | `.claude/rules/**` (globs relative to the part [D]), `.claude/skills/**` (on demand [D]) |
| Codex | `.codex/**`, `.agents/skills/**` | — |
| Cursor | `.cursor/hooks.json`, `.cursor/hooks/**` | `.cursor/rules/**` (nested loading unverified) |
| OpenCode | `opencode.json`, `.opencode/**` | — |

Project-scope fragments (`applies_to: []`, or both parts) go to the root anyway: `AGENTS.md`, `CLAUDE.md` and `docs/guidance/engineering`.

Every hook result under A carries over [E], because the hook files and settings are the same. The rule files and Claude skills need no edit, and nothing leaks across parts:
- `rest-api.md` stays at `backend/.claude/rules/` with `**/api/**` relative to `backend/` [D].
- Its links stay correct, since `backend/docs/guidance/...` sits beside it.

Costs:
- The typecheck find-up fix (applies to A as well).
- Stack hooks must take their directory from the edited file, not `CLAUDE_PROJECT_DIR`, and need stack-namespaced names.
- The workspace's root `AGENTS.md` must link each part's guidance index and say which directory each part's commands run in.
- One open case: a one-part fragment's hoisted Codex/OpenCode skill (`rest-api`) keeps a broken link to `docs/guidance/rest-api/`. The options: a `{{part_prefix}}` template, leaving those skills in the part (invisible to a root Codex/OpenCode session), or making the link point through AGENTS.md. Cursor's `rest-api.mdc` has the same choice.

## 3. hono-api + react-vite: shared adapter paths

Comparing both default scaffolds [E], 37 adapter or guidance paths are shipped by both.

Identical bytes (35):
- `.claude/.gitignore`, `.claude/README.md`
- `.claude/agents/{architect,reviewer}.md`, `.claude/commands/{check,feature,test}.md`
- `.claude/hooks/{_destructive-patterns.sh,_lib.sh,_lib.ts,block-destructive.sh,detect-secrets.sh,format-changed.sh,lint-on-write.sh,session-start.sh,smoke.sh,typecheck-on-write.ts}`
- `.claude/rules/engineering.md`
- `.codex/{config.toml,hooks.json,hooks/check-patch.sh}`
- `.cursor/{hooks.json,hooks/guard.sh,rules/agent-ops.mdc,rules/engineering.mdc}`
- `.opencode/{hooks/check-patch.sh,plugins/agent-ops.js}`, `opencode.json`
- `CLAUDE.md`, `docs/harness.md`, `docs/guidance/engineering/*` (5)

Different (2):
- `.claude/settings.json`: different allow lists, and only hono has a hook. Their `deepMerge` is a clean union [E].
- `AGENTS.md`: project name and command table. One skeleton is selected once anyway.

Only in hono: `guard-hono-api-commands.sh`, `rules/hono-api/*`, `rules/rest-api.md`, `skills/add-resource`, `.cursor/rules/rest-api.mdc`, `.agents/skills/rest-api`, `.opencode/skills/rest-api` and `docs/guidance/{hono-api,rest-api}`.
Only in react-vite: `rules/react-vite/*`, `skills/add-page` and `docs/guidance/react-vite`.

Where `claude-harness` and `claude-harness-docs` should go, selected once:

| Placement | What breaks |
| --- | --- |
| **Root (recommended)** | Root `settings.json` gets the typecheck entry once. `typecheck-on-write.ts` is silent until it finds `tsc` upward from the file [E, fixed in 3 lines]. `before-typecheck.ts` needs a defined home (root, or the part found by the same walk). No tsconfig covers the root `.claude/hooks/*.ts`. Agents and commands are generic and fine. `harness-doc-filled` runs once at the root. |
| Each part | Two copies of the same bytes, but the fragment is selected once, so `harness-doc-filled` runs in one cwd only. A root session loads neither part's `settings.json` [D], so there are no hooks. Agents and commands in a part are not documented to load from the root. |
| One part | Arbitrary choice. A root session again loads nothing. The other part's `.ts` files get typechecked only if the hook walks across parts. Breaks symmetry for no gain. |

## 4. Does option A need a part-directory template value?

Yes, for every path-bearing non-merge file: rule globs, rule and skill links, skill prose and Cursor globs. Consequences [R]:

- **It isn't a neutral value.** `NEUTRAL_VARS` exists so project settings and the clock stay out of fingerprints. The part directory comes from the workspace entry, so neutral and real renders must both use the real value. Otherwise the workspace's composition fingerprint can't tell `backend/src/**` from `src/**`.
- **Renderer change.** It becomes a per-writer value (the part's prefix for that part's files, `""` for root files). `files.ts::renderFiles` takes one `TemplateValues` for all files today, so the composer changes. `template.ts::TEMPLATE_VARIABLES`, `validate/checks/templates.ts` and the failure guide text change too.
- **Fingerprints.** Adding the variable changes no existing composition fingerprint: no file uses the token, and `fingerprintFromFiles` hashes rendered bytes and entry meta, not the variable table. With a standalone value of `""`, converted files render to today's bytes. But `proofFingerprint` hashes source paths and raw bytes. Every stack whose rules or skills become `.tmpl` (38 of 43 stacks ship Claude rules, 27 ship skills) gets a stale proof once and must be re-proved.
- **Allow lists can't use it.** `settings.json` is a merge file, and `plan-files.ts::writerFor` rejects a merge template with `EntryInvalid` `merge_template`. So allow lists can never be part-qualified under A. They can only rely on `cd <part> && <cmd>` matching [D].
- **Skill prose** with a token in every path is awkward to author and to read standalone.

It can be avoided for all Claude files by option C, because Claude resolves a nested rule's globs against the part [D]. The only remaining need is the one-part fragment's hoisted Codex/OpenCode skill links and Cursor rule globs, which is 1 fragment in today's pairs and 7 Cursor-rule fragments registry-wide. Those can be left in the part (and reached through AGENTS.md) instead of templated.

## 5. Recommendation

**Adapter rule for the RFC table:**

> `adapters/` and agent-ops' `.claude/hooks/`: files a harness reads only at the session root are written at the project root; path-scoped instructions are written in the part. The root list is fixed per harness and lives in the CLI:
> - Claude: `.claude/settings.json`, `.claude/hooks/**`, `.claude/agents/**`, `.claude/commands/**`
> - Codex: `.codex/**`, `.agents/skills/**`
> - Cursor: `.cursor/hooks.json`, `.cursor/hooks/**`
> - OpenCode: `opencode.json`, `.opencode/**`
>
> Everything else, including `.claude/rules/**` and `.claude/skills/**`, stays under the part. Root-bound files from both parts go through `plan-files.ts` as one root path, so `merge:` files deep-merge and any other shared path must be byte-identical or it is a `file_owner` conflict. Sessions start at the root.

This is a path relocation by a fixed prefix table, not content rewriting, so it keeps the RFC's "the CLI does not rewrite them" constraint.

**Both-parts placement rule:**

> A fragment whose `applies_to` names more than one part is written once at the root, like a project fragment. Its overlay is the workspace stack's.

That covers `claude-harness` and `claude-harness-docs`. Neither ships path-scoped instructions; if a future both-parts fragment does, it is an `EntryInvalid` for workspaces until that fragment splits it.

**What it costs stack authors:**

- Hooks must locate tools by walking up from the edited file to `CLAUDE_PROJECT_DIR` (as agent-ops' `find_up` already does), never `join(root, …)`. Fix `typecheck-on-write.ts` and the six stack hooks listed in section 1.
- Stack hook file names must carry the stack id. `dev-server-status.ts`, `guard-maven.sh` and `guard-tui.sh` need renames.
- A stack guard runs for the whole workspace, so it must not deny something only wrong in its own part. hono's `bun run dev` deny is fine; nothing guards the root `make dev`.
- Rules and skills keep part-relative globs and links.
- Allow-list entries stay unqualified strings. They approve `cd <part> && cmd`, and can also approve a same-named root target (`make lint`).

**What the workspace stack must ship at the root, either way:**

- `AGENTS.md`: the parts, where each part's commands run, links to `backend/docs/guidance/<stack>/` and `frontend/docs/guidance/<stack>/`, and the root Makefile commands. This is the only instruction file Codex reads from a root session.
- `CLAUDE.md` with `@AGENTS.md`. agent-ops supplies both skeletons at the root once selected.
- Root `.claude/settings.json` allow entries for its own Makefile targets (`make lint`, `make test`, `make api-client`, `make check-api-client`; never `make dev`).
- A guard denying the never-exiting `make dev`. hono's guard misses it, and python-api ships none.
- Optionally a root tsconfig or a part `include` that covers `.claude/hooks/*.ts`.

Under option B the workspace would also need every project-scope fragment duplicated into each part and `--add-dir` grants. That is a reason to drop B.

## 6. What I could not test

- Real loading in a live session of any harness: Claude nested `.claude/rules` and skills on demand, the nested-rule glob base, nested `.claude/agents` and `.claude/commands`, Codex AGENTS.md and skills discovery, Cursor nested AGENTS.md, OpenCode nested AGENTS.md and upward plugin discovery. All from documentation. Running `claude -p` or `codex exec` would make paid model calls.
- Claude permission matching for `cd <part> && cmd`, and `Read(./**/.env)` anchoring, from documentation.
- Cursor nested `.cursor/rules`: not in the current docs. Older sources conflict.
- Codex and Cursor running the hooks themselves, including trust prompts. I ran their configured command strings with the payloads the docs describe.
- OpenCode's actual `directory` value for a session started in a subdirectory: assumed to be the cwd.
- `hono-A`/`hono-B` are not green (dependencies beyond typescript, biome and `@types/node` are not installed), so typecheck output there includes unresolved-module noise. The python pair's frontend was green and gave the clean typecheck results.

Sources:
- https://code.claude.com/docs/en/memory: rule `paths` are relative to "the directory that contains the rule's `.claude` folder"; subdirectory CLAUDE.md files load "once Claude reads, writes, or edits another file in that subdirectory".
- https://code.claude.com/docs/en/large-codebases: project settings "aren't inherited from parent directories"; each subdirectory's `.claude/settings.json` "must be self-contained".
- https://code.claude.com/docs/en/settings: "reads the shared `.claude/settings.json` from the session's primary working directory".
- https://code.claude.com/docs/en/skills: nested skills "load the first time Claude reads or edits a file in that subdirectory".
- https://code.claude.com/docs/en/hooks: `CLAUDE_PROJECT_DIR` is "the project root where the session started".
- https://code.claude.com/docs/en/permissions: compound commands and `cd` within the working directory.
- https://learn.chatgpt.com/docs/agent-configuration/agents-md: "Codex stops searching once it reaches your current directory".
- https://learn.chatgpt.com/docs/hooks: "checks `.codex` directories from the project root to the working directory"; "Commands run with the session `cwd`".
- https://learn.chatgpt.com/docs/config-file/config-advanced: project config files.
- https://developers.openai.com/codex/skills: `.agents/skills` from the cwd up to the repository root.
- https://cursor.com/docs/rules: nested AGENTS.md "automatically applied when working with files in that directory".
- https://cursor.com/docs/agent/hooks: project hooks "Run from the project root".
- https://opencode.ai/docs/rules/: nested AGENTS.md loads on read.
- https://opencode.ai/docs/config/: "searches from the current directory to the filesystem root".
- https://opencode.ai/docs/plugins/: "every discovered `.opencode/plugins/` directory".
