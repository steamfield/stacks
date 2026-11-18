# RFC: workspace stacks, version 1 of stack pairing

Status: DRAFT 2026-11-18, revised after an architect review and a devil's-advocate review (log at the end), then narrowed to version 1 by the maintainer. Version 2, free pairing and pair search, is [stack-pairing-v2-rfc-2026-11-18.md](stack-pairing-v2-rfc-2026-11-18.md).

Scope: `StackMeta` and `Manifest` in `packages/format`; composition, `new`, `add`, `validate` and the proof fingerprint in `packages/cli`; the bundled registry. `stacks-api` has to take the new format version before entries use it. In `packages/mcp` only the `NewResult` mirror changes. The search contracts do not change. The signed index gains a pin for a workspace stack's parts (see "Proof").

This RFC is not scheduled. It sits behind the two plans `HANDOFF.md` has as step 1, and "Relation to other plans" says why.

Nothing here is built. Phase 0, a set of four spikes, ran on 2026-11-18 and this document was revised from the results the same day. No spike hit its stop condition. The notes and kept artifacts are in [runs/2026-11-18-stack-pairing-spikes](runs/2026-11-18-stack-pairing-spikes/README.md), and "Phase 0: what the spikes found" below summarizes them. Where a section states something a spike observed, it says so; the rest is still design.

## Summary

A full-stack project today is one monolithic stack. `python-react` carries its own copy of a FastAPI backend that has drifted from `python-api`, and its own React frontend that shares no files with `react-vite`. A different backend with the same frontend means writing a whole new stack.

Version 1 adds the workspace stack: a stack that names other stacks as its parts, each written into its own directory, and ships only what belongs to the whole project. A part has a role: `api`, or a kind of client. The registry in version 1 uses one client role, `web`; the interface is built so `mobile`, `cli` or a client nobody has thought of yet is a new role and not a redesign. A link fragment adds what crosses an API part and a client part; the first, `openapi-client`, generates a typed client from the API's OpenAPI document.

`python-react` is rebuilt as `python-api` + `react-vite` + `openapi-client`. A new `hono-react` is `hono-api` + `react-vite` + `openapi-client`, and is the proof that a backend can be swapped. Each is an ordinary stack to the agent: one search result, one `new` command.

## The problem

Measured on the bundled registry (43 stacks, 26 fragments):

- `python-react/files/backend` against `python-api/files`: of 31 files, 10 are byte-identical and 13 sit at the same path with different content. The differences are convention drift: `/health` against `/healthz`, `/health/ready` against `/readyz`, error code `VALIDATION_FAILED` against `BadInput`, `make check-api` against `make check-openapi`.
- The `postgres` fragment ships two trees, `stacks/python-api/` and `stacks/python-react/backend/`. Ten of 15 files are identical; the other five differ by 51 lines, all from the drift above.
- `react-vite/files` against `python-react/files/frontend`: no identical files, 7 shared paths of 50. One uses `src/` with library-mode React Router, the other `app/` with framework SPA mode.
- Per-stack overlays grow as stacks times fragments: `docker-deploy` has 5 `stacks/<id>/` trees, `posthog` 6.

Search, run locally on 2026-11-18, for requests with no monolith behind them:

| Query | Top result | What is wrong |
| --- | --- | --- |
| hono api with react spa frontend | "Nothing fits strongly", then `python-react` | Wrong language on top. |
| go backend react frontend | `python-react` (strong, 0.981) | `go-api` is fourth; `understood.languages` is empty. |

The first is fixed by `hono-react` existing with a search card. The second is a missing phrase: `registry/search/vocabulary.json` lists `go` only as phrases (`golang`, `go api`, `go service`), and `go backend` is not one of them. The bare word stays out, since "go" is ordinary English. With the phrase added, a Go request should stop returning a Python stack first, and it will correctly find no Go full-stack stack until someone writes one.

## Why fixed parts first

One stack can fill the web role today: `react-vite`. `react-router`, `cloudflare-react-router`, `nextjs`, `nuxt`, `sveltekit` and the Astro stacks have servers of their own, and `tauri-react` is a desktop app. Free pairing over a nine-by-one matrix would need per-role search ranking, a new search result shape, shared-id proof and stats, and a `stacks-api` ranking change, to offer pairs that mostly have no recorded run.

A workspace stack with fixed parts gets all of the product's existing guarantees for nothing: its own search card, ledger proof, telemetry id and published stats. It costs a few lines of frontmatter and a handful of root files per pair.

## Who this is for

The coding agent. A user who says "Hono API with a React frontend" gets one strong result and one command, as for any stack, and the agent never reasons about which stacks fit together.

The stack author. Each API stack and web stack is written and proven once. A new pairing is a small stack. A fragment such as `postgres` ships one tree.

## Decisions already made

From the maintainer, during planning.

1. The parts interface is general: `parts` is a list, and client roles are a list meant to grow (web, mobile, CLI, later ones). Version 1 implements and proves one `api` part with one `web` part. `astro-fullstack` and `mobile-expo` stay monoliths.
2. Version 1 is workspace stacks with fixed parts. Free pairing by flag and pair results in search are version 2.
3. The workspace stack owns the project root and ships a delegating root Makefile.
4. `python-react` keeps its id and is rebuilt on parts. Projects created from the current `python-react` get no compatibility path.
5. Version 1 is designed so version 2 adds to it and does not rework it.
6. Version 1 is done when rebuilt `python-react` is green and `hono-react` with the generated client is green.

Attaching a web part to an existing API project with `add` was chosen during planning. It selects a part freely at the command line, which is the version 2 mechanism, so it moves there with the flags.

## Relation to other plans

Three plans already in this folder change the ground this one builds on.

**The remote-first index** ([remote-first-index-rfc-2026-11-15.md](remote-first-index-rfc-2026-11-15.md), reviewed, step 1 in `HANDOFF.md`, ships as CLI 0.14.0). The hosted index becomes the source of entry content. Two consequences:

- A workspace stack has to be servable from the index. `python-react` is an existing stack, so leaving workspace stacks out of the index would remove it from where users get entries. The index pins a stack's proven fragments and not its parts, so a part pin is part of version 1 ("Proof").
- It gives the rollout a better tool than ordering deploys by hand. That RFC's D-R2 has the registry declare `minCli`, and an older CLI keeps its cached index or its bundled copy when the index asks for more. Entries that use `parts` ship in a registry whose `minCli` is the first CLI that reads the key.

**The registry repository split** ([registry-repo-rfc-2026-11-15.md](registry-repo-rfc-2026-11-15.md), reviewed, follows the index, ships as CLI 0.15.0). The registry moves to its own repository. This RFC's registry work (convention alignment, the workspace stacks, the link, the fragments with `python-react` trees) lands there, with its own review and proof flow, and the authoring skills that govern registry entries may move with it.

So the order is: remote-first index, registry split, then this. The spikes are throwaway and touch neither, so they can run before either lands. Phase 1 can too, as ordinary registry edits wherever the registry lives at the time.

**Fragment admission** ([fragment-admission-rfc-2026-11-01.md](fragment-admission-rfc-2026-11-01.md), reviewed, not scheduled). It has stacks declare their fragments and fragments stop listing stack ids in `applies_to`. This RFC places a fragment on a part by the stack id its `applies_to` names, and has `openapi-client` name `react-vite` there. If admission lands first, placement has to read whatever replaces that list: the part whose stack admits the fragment. The rule is the same; the place it is read from moves. Whichever of the two is revised second has to cite the other.

Two smaller ones. [stack-audit-2026-10-29.md](stack-audit-2026-10-29.md) task 8, an extraction of shared dev-log tooling into a fragment, is blocked on typecheck and the word budget, which is the same budget Spike 2 measures. [zero-edit-proof-gaps-2026-11-14.md](zero-edit-proof-gaps-2026-11-14.md) is about proofs going stale when shared content changes, and a workspace proof that covers its parts adds to that load: a change to `react-vite` stales every workspace over it.

## Proposed model

### A stack declares its parts

One new optional `StackMeta` key:

```yaml
# stacks/hono-react/STACK.md
id: hono-react
kind: stack
parts:
  - { name: backend, role: api, stack: hono-api }
  - { name: frontend, role: web, stack: react-vite }
fragments:
  required: [openapi-client]
  default: [agent-ops, git-hooks, ci-github]
```

The key is a list, so its shape does not limit a workspace to two parts or to one part per role. Version 1 does, in `validate`, for the reasons below. Each part has three fields:

- `name`: a kebab-case id, unique in the workspace. It is the part's directory and the prefix on its steps, commands and dependency roles.
- `role`: a kebab-case string in the format package. The list of roles the CLI knows, `api` and `web` in version 1, lives in the CLI beside the rules it checks for each. The format package cannot check a role's rules, so it is the weaker owner of the vocabulary, and a literal there would put every new role through the full format rollout. An entry with a role the CLI does not know decodes and is then refused as an invalid entry.
- `stack`: the id of the stack to mount.

`name` is `Kebab` in the schema itself, so it cannot be `.git`, `.stacks`, absolute or `..` by the time anything reads it.

The key is `Schema.optionalKey`, absent when a stack has no parts. The other lists in `StackMeta` decode to `[]` through `entry.ts::list`, and doing that here would put `parts: []` into every decoded stack. `fingerprint.ts::fingerprintFromFiles` and `proofFingerprint` hash `canonicalJson(meta)`, so all 43 stacks' fingerprints and ledger proofs would change. A golden test pins an existing stack's `proofFingerprint`.

What `validate` requires in version 1: exactly one part with role `api`, exactly one client part, and no role the CLI does not know. A second client with a different role (web plus mobile) is a validation change later. A second client with the same role is not: every `web` part takes its port from `PORT_WEB`, `Manifest.env` is one flat record, and `compose.ts::mergeEnv` raises on differing defaults, so two web parts need per-part env names that nothing here provides. The list shape allows it; the env model does not yet. Spike 3 found what it would take: per-part env names, which means rewriting `${PORT_WEB}` inside entry content the CLI does not rewrite, or a `Manifest.env` keyed by part, which changes `DigestInput`. The same stack mounted twice needs more still, since `entryRef` is identical for both parts and the placement rule sends a link naming that stack to the root.

The workspace stack is `kind: stack`, so every contract that needs one stack id per project already has it: `NewResult.stack`, telemetry's `composition.stack`, `LedgerRecord.stack`, `Manifest.stack` and the proof fingerprint.

A workspace stack ships what belongs to the whole: the root Makefile, the root README and `.env.example`, the root `AGENTS.md` and `CLAUDE.md`, the prose on how the halves relate, and a verify step that exercises both together. Its `fragments` tiers are the project's; a part's own tiers are not selected. Spike 3 measured what that drops: nothing warns when a workspace omits a fragment its part requires (the frontend silently lost `claude-harness` and its hooks), and the parts' default tiers go unread (`claude-harness-docs`, `code-docs`, `rest-api`), though `--with` still reaches each of them. So `validate` must fail a workspace that does not restate a part's required fragment, and a workspace author decides which of the parts' defaults to restate.

A part cannot itself have parts.

### The role contract

Two stacks written separately only compose if they agree on a few conventions. A stack named as a part must meet them.

`validate` runs nothing (trust point 1) and reads only what an entry declares, so it can check little of this. Each rule below is marked. Declared rules are checked by `validate` on every workspace stack's parts. Proven rules are behavior: the workspace's own verify steps exercise them, and they are established when the workspace is taken to green for its ledger run.

The contract has three layers, so a new client role writes only the last one.

An `api` part:

- Declared: `PORT_API` is in its `env`, and it has a `serve` step whose `expect.http` contains `${PORT_API}` and ends in `/healthz`.
- Proven: resources sit under `/v1`, and its example resource is the one all parts share.
- Proven: the example resource's operation ids are `listNotes`, `getNote` and `createNote`, and its list response holds the rows under `items`. Spike 1 swapped `python-api` for `hono-api` under an unchanged frontend and the only difference was the generated hook's name, `useNotesListNotes` against `useListNotes`, because FastAPI derives ids from the tag and function name. `hono-api` uses these ids already; `python-api` sets an `operation_id` on each route.

The contract deliberately stops there. The two API stacks' documents differ in schema names, the path parameter's name, whether `nextCursor` is required, and the whole error envelope, and aligning those is not needed for a client that follows the client rules below. A link or client that came to depend on any of them would be per backend.

Any client part, whatever its role:

- Proven: it reaches the API through one base URL read from its own configuration, never a host written into source.
- Proven: it has a single API client module at a path its stack documents, which every call goes through, and that module exposes one request function taking a method, a path and a body. This is the seam a link builds on. Spike 1 found `react-vite`'s client was not one: an instance held in React context with `get(path, schema)` only.
- Proven: it calls the shared example resource, with a test that fails if it does not.
- Proven: from a failed response it reads the status and the `x-request-id` header and nothing else, since the error body differs by API stack.

A `web` part, on top of the client rules:

- Declared: `PORT_WEB` is in its `env`.
- Proven: a dev proxy that forwards `/api` to `PORT_API` and strips only the `/api` segment, so its base URL is the same-origin path `/api` and its calls name `/v1/...` themselves. The first draft had the proxy rewrite to `/v1`. That conflicts with a generated client, whose paths already start with `/v1`, and it leaves `/healthz` unreachable through the proxy (Spike 1 saw the 404). The spike builds worked around it in the link; the rule as now written was not itself run.
- Proven: the proxy has no fallback port. `react-vite`'s fell back to 8000 while `hono-api` defaults to 3000, so a default suits one API stack only; it fails when `PORT_API` is unset.

`vite preview`, which `react-vite`'s `web` step runs, uses the same proxy (Vite sets `preview.proxy` from `server.proxy`), so the both-parts step works against a built frontend.

The proving steps are the workspace's both-parts step (one request through the client's proxy to the running API) and the link's generated-hook step. `--payload none` removes the example resource, and with it most of what those steps prove; a workspace's verify under that payload shows only that both parts start.

Roles not built in version 1 would add their own third layer. A `mobile` part cannot use a same-origin proxy, so its rule is an absolute base URL a simulator or device can reach. A `cli` part's is a base URL from a flag or environment variable. Neither needs anything the first two layers do not already give it.

What meeting the contract cost, measured in Spike 1:

| Stack | Changes |
| --- | --- |
| `python-api` | None to mount or to serve the pair. The operation ids above are the one change the revised contract adds. |
| `hono-api` | Already serves `/v1`, `notes`, `/healthz` and `PORT_API`. One 35-line script that dumps its OpenAPI document in process, with a check mode, and two package scripts. |
| `react-vite` | 11 code and test files: 1 for the proxy, 9 to rename its example from `items` to `notes`, 1 for the request function. About 10 documents (READMEs, guidance, the add-page skill, the stack body) go stale with the rename and have to be rewritten with it. |

Neither part needed any change in order to be mounted. A second writer of `vite.config.ts` would be a `file_owner` conflict (`plan-files.ts::planOutput` merges JSON only), so the proxy goes into `react-vite` itself.

This is a standing cost, and for a client stack a real one: `react-vite` is rewritten once, about 20 files, and every stack used as a part keeps these conventions for as long as it is one.

### Links

A link is a fragment that belongs to the client part and takes one input from the API part. It composes like any other fragment; it needs one thing fragments do not have today, which is a way to be told apart from them. The brief puts links directly after the parts and opens each with a line naming the API and client parts, and Spike 3 found that "a required fragment on a client part" also matches `claude-harness`. So `FragmentMeta.category` gains the literal `link`, which rides the same format rollout as `parts`.

Its `applies_to` names the client stack (`react-vite`), so by the placement rule below its files land under the client part's directory and its steps run there. Everything it ships is relative to the client: the generator config reads `./openapi.json` beside it. The one thing that crosses directories is getting the API's document to that path, and that is a root command the workspace stack ships, since only the workspace knows both directory names. `python-react` works this way today: its root `generate-api` target dumps the backend's spec into `frontend/openapi.json`, and its Orval config reads `./openapi.json`.

So no file in the link carries another part's directory, no template value is needed for part names, and the link is unchanged from one workspace to the next. It is written against the client rules above, not against `web`, so it would serve a TypeScript mobile or CLI part that it also names. It is applied to the one client part; applying a fragment to two parts in one project is not possible while `Manifest.fragments` is keyed by fragment id and `selection.ts::refuseAlreadyApplied` refuses a second application, and version 1 does not change that.

What `openapi-client` ships, from Spike 1's two builds, where these files were byte-identical under both backends:

- `orval.config.ts`, reading `./openapi.json`.
- `src/api/orval-fetch.ts`, an adapter from Orval's mutator signature to the client module's request function. Generated hooks and hand-written calls then share one transport. Generated calls skip the zod validation the hand-written ones have, which is accepted.
- Two verify steps. `client-drift` regenerates into a temporary directory and compares, so it passes on correct output that is not yet committed; the spike's version compared against git and failed straight after every correct regeneration, in both agent runs. `generated-hook-used` is a static search for an import of the generated module from a page or feature, which is the same command under every backend because it keys on the import path, which the link controls. Typecheck catches a stale hook name.

It ships no generated client, since that is setup output that depends on installed releases, and no zod schemas or mocks: nothing used the first, and the second needs a faker dependency and duplicates the client stack's fixtures.

A link writes only its own new files. The spike's link also changed three files `react-vite` owns, and none of those changes can be composed: `package.json` and `biome.json` are templates, which `plan-files.ts` refuses to merge (`merge_template`), and the page is a second writer (`file_owner`). Each is handled without a new mechanism:

- The two `package.json` scripts are added by the agent from the link's body, as its dependencies already are; `client-drift` fails if they are missing.
- The Biome excludes for `src/api/generated` and `openapi.json` ship in `react-vite` itself, where they are inert without the link.
- The page is not the link's. `react-vite` ships the example page calling its hand-written module, and the link's body tells the agent to move that page to the generated hook. With operation ids fixed by the API rules, that instruction and its result are the same in every workspace.

The workspace author lists the link in the workspace's `required` tier, so fit is known when the stack is written.

What the link needs from the API part is a file, not a command. `commands` holds names and descriptions, not runnable commands, and the link's verify step is one static `run` string that cannot be `make openapi` for one part and `bun run openapi` for another. So an API part that supports the link writes its OpenAPI document to `openapi.json` in its own directory and has a verify step named `openapi-drift` that fails when the file is stale. The fixed name is what lets `validate` check for the step. The file is generated and committed at setup and is not in the stack's `files/`: its bytes depend on the installed framework release, so shipping it would be a version literal. `python-api` has `openapi-drift` today; `hono-api` gains the dump script and the step.

### Layout, the manifest and the tamper check

`new` writes each part under a directory named for the part (`backend/`, `frontend/`) and the workspace stack's own files at the root. The name comes from the entry. What is new is that one entry relocates another entry's files; an entry's own paths come from walked file names today (`registry/tree.ts` refuses `.`, `..`, empty segments and symlinks), and a part name is a YAML string. Because it is `Kebab` at decode, it is one safe segment before anything uses it, and `plan-files.ts::reservedSegment` and `checkPlannedPath` still run on every prefixed path. A part name that collides with a path the workspace stack or a root fragment writes is a `ComposeConflict` with reason `file_owner`, through `plan-files.ts::claimPath`.

The mount directory lives in the digested step. `core/project/manifest.ts::DigestInput` covers `verify`, `env` and `preset`, and `digestable` includes `cwd`. At compose time each part's step gets the part directory written into `ManifestStep.cwd`, joined with any `cwd` of its own, and the part name as a prefix on its own name (`backend-lint`, `frontend-lint`). `tamper.ts::checkTamper` then covers the directory unchanged, and `ProjectState.stepDigests`, keyed by step name, needs no change.

`Manifest.parts` is a new optional list. Each item is `{ name, role, stack }` with three differences from the entry's:

- `stack` is an `EntryRef` (`id`, `origin`, `trusted`), as `Manifest.stack` and `Manifest.fragments` are. `telemetry/events.ts::scaffoldEvent` reports a stack as official only when every ref is official, and `telemetry/composition.ts::completeAddFacts` re-resolves the same fields; both include the parts, or a bundled workspace over a part from a user or project root would be counted as the official stack.
- `role` is `Schema.NonEmptyString`, as `EntryRef.origin` is. `project/manifest.ts::readManifest` decodes the whole manifest strictly, so a closed literal here would make every command fail with `InvalidConfig` in a CLI that predates a role.
- `name` is `Kebab`, so `readManifest` rejects an edited name that is not one safe segment.

`verify` takes a step's directory from the digested `cwd`, never from this list. `add` reads the list to place a fragment under a part. The list is outside `DigestInput`, so `checkTamper` does not see an edit to it; an edited name can make `add` write a trusted fragment's files under a different kebab directory inside the project. That is no wider than what `add/project.ts::projectStack` already accepts from an editable `Manifest.stack.id`, and `add/plan.ts::readLive` and `verify/step.ts` still refuse paths that leave the project. `add` also requires each part directory to exist as a real directory before it writes.

It is written only in workspace projects, because `project/manifest.ts::readManifest` decodes with `onExcessProperty: "error"` and an older CLI fails on it with `InvalidConfig`. Single-stack manifests stay readable by every version.

### Where a fragment goes

Placement goes by stack id in `applies_to`, never by tag. `selection.ts::fitsStack` also matches tags, and `react-vite` and `hono-api` share `typescript`, `bun` and `node`, so a tag match says a fragment fits and cannot say where it goes.

- One part. A fragment whose `applies_to` names exactly one part's stack id (`postgres` on `python-api`, `openapi-client` on `react-vite`) is written under that part's directory. Its steps get the part's directory as `cwd` and the part's name as a prefix, at `new` and at `add`, and `add/prepare.ts::checkStepNames` compares the prefixed names. `registry/entry.ts::shipsFor` picks an overlay by one stack id today; here it uses the id of that part, so `postgres` keeps only its `stacks/python-api/` tree.
- The project. A fragment whose `applies_to` is empty, matches only by tag, or names the workspace stack applies once at the root, with the workspace id selecting any overlay.
- More than one part. `claude-harness` and `claude-harness-docs` name both `react-vite` and `hono-api`. `selection.ts`'s `via` map and `Manifest.fragments` are keyed by fragment id, so the fragment is selected once and a step such as `harness-doc-filled` runs once. It is written once at the root (Spike 4): writing it into each part leaves a session started at the root with no hooks, and choosing one part is arbitrary.

Spike 3 composed both workspaces by this rule. `openapi-client` landed in `frontend/` in each, `rest-api` in `backend/`, and `add postgres` wrote 16 files and 5 prefixed steps under `backend/` from the `python-api` overlay alone. It also showed the rule's weak point: `claude-harness` names only `react-vite` in the python pair, so it landed in `frontend/.claude/` there and at the root in the hono pair. The adapter rule below removes most of that difference, since the files a session needs at the root go there in both.

A fragment's `merge:` list is entry-relative, so it is mounted with the fragment's files. Left unmounted, `planOutput` raises `file_owner` on a part's `.claude/settings.json`.

Two existing rules need a workspace form:

- Fit in add mode. `selection.ts::selectWith` raises `applies_to` when a fragment does not fit the project's stack, which is the workspace. In a workspace project, fit is tested against the workspace and each part.
- Required fragments. A part's own `fragments` tiers are not selected, and `add/prepare.ts::missingRequiredFragments` and `remote/merge.ts::bundledComposition` read one stack's `required` list. So a workspace stack restates in its own `required` tier every fragment its parts require, and `validate` fails a workspace that omits one.

Adapters follow their own rule, from Spike 4, which tried both options the first draft named and found neither works. Everything at the root with part-prefixed paths needs 25 rule globs and several links edited by hand per pair, cannot part-qualify an allow list (`settings.json` is a merge file, and a merge file cannot be a template), and needs a per-entry template value. Everything inside the parts leaves a root session with no settings or hooks, and in a part session the Codex hook resolves the git root, finds no guards and fails open.

The rule: a fixed list, per harness, of the paths that harness reads only at the session root is written at the project root, whichever entry ships them. Everything else an entry ships stays in its part. This relocates paths and rewrites no content.

| Harness | Written at the project root |
| --- | --- |
| Claude Code | `.claude/settings.json`, `.claude/hooks/**`, `.claude/agents/**`, `.claude/commands/**` |
| Codex | `.codex/**`, `.agents/skills/**` |
| Cursor | `.cursor/hooks.json`, `.cursor/hooks/**` |
| OpenCode | `opencode.json`, `.opencode/**` |

`.claude/rules/**` and `.claude/skills/**` stay in the part: Claude Code resolves a nested rule's globs against its own `.claude` directory, per its documentation, so `src/**` in `frontend/.claude/rules/` still means the frontend's source. The spike executed the hoisted hooks against files in either part (lint, format, the destructive-command and secret guards, session start, and the Codex, Cursor and OpenCode equivalents) and each used the right part's tool config. Merging both parts' `.claude/settings.json` with `merge.ts::deepMerge` produced each hook once. `hono-api` and `react-vite` ship 37 adapter and guidance paths at the same location and 35 are byte-identical, so identical files from two parts are one file at the root.

Not tested: a live session of any harness loading nested rules, skills and instruction files, and Claude Code's permission matching. Those conclusions rest on each harness's documentation, and the first ledger run of a workspace is where they are checked.

What this asks of stack authors, as registry changes in Phase 1:

- A hook finds its tools by walking up from the edited file, never by joining a path to the project root. `typecheck-on-write.ts` is silent at a workspace root today, and six other stack hooks hard-wire the root the same way.
- A stack's own hook file names carry the stack id. Three hooks share a name across stacks with different content and would collide at one root.
- A stack's guard is safe across a whole workspace, since it now runs for files in both parts.

Still open: a fragment placed on one part whose Codex or OpenCode skill, or Cursor rule, is hoisted has a guidance link that no longer resolves. In the two proof pairs that is `rest-api` only.

Three fragments ship `stacks/python-react/` trees and change in Phase 4: `postgres` (tree removed), `posthog` (a `python-react` default with no `react-vite` tree, so one is added or it leaves the default tier), and `docker-deploy` (see open question 2).

### What a part's files assume

A stack written as a whole project assumes it owns the root. Spike 1 mounted three stacks and neither pair needed a part changed in order to mount. The table is what it found.

| File | Rule |
| --- | --- |
| Source, tests, configs | Move under the part directory unchanged. |
| The part's own Makefile or `package.json` | Stays in the part directory; the root Makefile delegates. |
| `.gitignore`, `.editorconfig` | Stay in the part directory; git and editors honor nested ones. |
| `README.md`, `.env.example` | Part copy stays in the part; the workspace stack owns the root ones. Three `readme-filled` steps result. |
| `AGENTS.md`, `CLAUDE.md` | Part copy stays in the part. The workspace stack ships the root pair, which link to each part's. No root `AGENTS.md` existed in the spike and the setup agent had to invent one. |
| Agent adapters | The per-harness root list above; the rest stays in the part. |
| `biome.json` | Each part's gains `"root": false`. Nested root configs never reach across parts, but they make any Biome run from the root fail; with the key a part still lints standalone. |
| `lefthook.yml` and its install | Root only, owned by the workspace, with a job per part using lefthook's `root:`. Each part installs hooks only when the file is beside it, so the root install target runs `lefthook install`. |
| `.env` | The root `.env` reaches a part only through the root Makefile's export. `python-api` reads `backend/.env` and Vite reads the shell. The workspace body says so, and the root Makefile must not let an included `.env` override a port exported in the shell, which the spike's did. |
| `project_name` | Both parts render the same value into `package.json` and `pyproject.toml`. Harmless in the spike; left as is. |
| Verify steps | Part directory in `cwd`, part name as a prefix on `name`. |
| `commands`, `deps` | Namespaced by part name. Today `compose.ts::mergeCommands` lets the later entry replace `lint` and `test`, and `mergeDeps` would merge PyPI and npm names under one `dev` role. |
| `env` | Merged; `PORT_API` and `PORT_WEB` are distinct by the role contract. |

Each workspace stack writes its own root Makefile for its own two parts, so `python-react`'s calls `make -C backend` and `hono-react`'s calls `cd backend && bun run`. Nothing is generated, and no rule is needed for mixing runners. Two similar Makefiles are the accepted cost, and Spike 1 measured it: 12 of 59 lines differ between the two.

### Proof

`fingerprint.ts::proofFingerprint` hashes the stack's own files, body and composed steps. A workspace stack that ships almost nothing of its own would keep a current proof while `python-api` or `react-vite` changed underneath it. `proofFingerprint` hashes the stack's `meta` and `body`, and `writtenStackFiles` keeps files whose owner is the stack. For a workspace each part contributes all three: its meta, its body and its written files. A change to a part then makes every workspace that uses it stale.

The signed index needs the same coverage. `index-schema.ts::IndexEntry.composition` records fragment id to digest, and `remote/merge.ts::pinnedFragments` and `selection.ts::compositionFragment` pin only fragments. A workspace stack served from the index would carry a proof covering its parts' bytes while its parts resolved unpinned. Parts cannot share the fragment record, because a stack and a fragment may share an id.

So `IndexEntry` gains an optional key that pins each part to a digest. It is a one-way door in a contract `stacks-api` also reads. Leaving workspace stacks out of the index is not an option once the remote-first index ships: `python-react` would disappear from the source of entry content.

Spike 3 prototyped the pin and found it needs more than the two readers the first draft named:

- The pin is keyed by part name, not stack id. Keyed by stack id, two parts of the same stack collapse into one pin.
- A missing or mismatched part bundle falls back to the whole bundled workspace with its bundled parts. Without that, the spike composed an index workspace with a drifted bundled `react-vite` and gave no warning.
- Part loading prefers the pinned bundle unless a project or user root overrides the part.
- The index build publishes a pinned part even when the part has no current proof of its own, since the workspace's proof covers its bytes.

The proof itself held in the spike: `proofFingerprint` over each part's meta, body and written files, with a one-line change in `react-vite` staling `react-vite` and both workspaces and leaving `python-api` current.

That is the proof burden of this design stated plainly: changing `react-vite` stales `react-vite`, `python-react` and `hono-react`.

## The brief

The workspace is the glue between its parts, and the brief is where the agent reads that glue. Composition can be correct in every file and the feature still fail here: two stack bodies written for standalone projects, set side by side, say nothing about how the halves meet. This section says who owns which knowledge, how the brief is ordered, and what `validate` requires.

### What the glue is

`python-react`'s current body is the inventory, since it was written by someone who knew both halves. Read for what concerns neither half alone, it holds:

- The order of setup across halves: install both, generate the client, then run the checks.
- Where the contract comes from and where it goes: the backend's OpenAPI document is the source, the generated client is read-only, and one command regenerates it.
- What a backend change does to the frontend: "renaming a route function renames its client".
- How a request travels: the Vite proxy, the base URL, which paths are forwarded.
- Configuration that crosses the boundary: settings read the root `.env` even when a command runs in `backend/`.
- Testing across halves: Playwright owns two servers on their own ports.
- Root commands and what each wraps, and CI jobs that need both halves.
- How a fragment on one half shows on the other: after `postgres`, regenerate the client because the readiness route is new.

None of this is in `python-api`'s body or `react-vite`'s, and none of it can be.

### Who owns what

| Knowledge | Owner | Why there |
| --- | --- | --- |
| How one half works alone: layout, conventions, tests, gotchas | The part's stack body | True in every project that uses the stack. |
| How the generated client works: where the spec is read from, the regenerate command inside the client part, read-only output, what a failed drift check means, what a renamed operation does | The link's body | The same for every workspace that uses the link. |
| What is true of this combination: setup order, the request path, root commands and what they wrap, which runner each part uses, cross-part tests, CI across parts, cross-part effects of this workspace's optional fragments | The workspace stack's body | Changes with the parts chosen. |
| What a fragment on one part needs from another part | That fragment's body, in a block that applies only in a workspace | The fragment knows its own effects; the workspace cannot list every fragment. |

A link's body is written in roles, not directory names: "the API part", "the client part". The brief states which directory each role is in for this project, so one link body serves every workspace and, later, more than one client.

### How the brief is ordered

`brief/render.ts::renderBrief` writes the stack's guidance, then each fragment's in composition order. For a workspace the order becomes:

1. The workspace stack's guidance.
2. Each part's guidance, in the order `parts` lists them.
3. Each link's guidance.
4. Every other fragment's guidance, as today.

The whole comes before the halves, and the connection between them comes directly after both have been described.

The facts block lists the parts: name, role, stack and directory. Each part's section and each link's section opens with one fixed line of CLI text, with only the names as data:

- For a part: that it lives in `<name>/`; that paths and commands in the section are relative to that directory and run there; that the workspace's Setup governs the order; and that `README.md`, `.env.example`, `AGENTS.md` and `CLAUDE.md` named in the section are the part's own copies, not the root's.
- For a link: which part is the API part and which is the client part for this section.

That fixed line is how a body written for a standalone project stays correct when mounted. A part's body says `src/api/` and `bun run lint`; the CLI does not rewrite entry prose, since that would mean parsing and editing content it only carries, so the reader is told where the section's root is.

Spike 1 tested it. A fresh agent took the hand-built workspace to green from a brief assembled this way, and a second added a resource end to end; neither ran a command in the wrong directory or edited the wrong copy of a file. On that evidence, one run each with one model, a mounted body variant is not needed. The spike's line did not name `AGENTS.md` or `CLAUDE.md`, the copies the builder judged likeliest to be confused, which is why the line above does.

A single-stack brief stays byte-identical. `renderBrief`'s section order is pinned by digests, so the workspace sections are added only when `parts` is present.

### What a workspace body must contain

`validate` already requires a `## Setup` heading in a stack body (`checks/format.ts::stackProblems`). A workspace stack's body gains two more required headings, checked the same way, and one content check:

- `## How the parts connect`: the request path from client to API (base URL, proxy, prefix), which part owns the contract, and what crosses the boundary: the example resource, the error envelope, any header both sides rely on.
- `## Setup`: one ordered sequence across the parts, ending in `stacks verify`. It names the step at which each link's generated output is first produced, and says which checks fail before that step: in Spike 1 the frontend's typecheck and tests could not pass until the client had been generated, and the body ordered them first. It refers to a part's setup by what the step does, never by its number; "do their steps 1 and 2" skipped the step that records versions, which CI then needed.
- `## Changing the API`: the cross-part workflow for the commonest task. Change a route, regenerate, update the client code, run both suites. This is what a later agent needs on every feature, and it is the section whose absence would cost most.
- The body names every part's directory at least once. A workspace body that never mentions `frontend/` is not describing the workspace.

`## Commands` and `## Testing` stay conventional, as in any stack. Their workspace content is the root targets with what each delegates to, and the tests that need more than one part running.

Two things the workspace body has to carry because composition removes them from everywhere else (Spike 3):

- CI and git hooks per part. A part body's `stacks:when with=ci-github` and `with=git-hooks` blocks resolve as absent, because those fragments sit at the root and a part's condition context lists only the fragments placed on it. The root `ci-github` body sees only the workspace's tags, so its `tag=python` and `tag=bun` blocks drop as well. Left alone, no layer of the brief says how to set up uv or Bun in CI. The workspace body states each part's toolchain setup and check commands for CI and for hooks, inside its own `with=ci-github` and `with=git-hooks` blocks.
- Where settings come from: the root `.env`, and how its values reach each part.

On the three required headings: the setup and feature agents needed nothing that called for a fourth. Their gaps were content missing under the existing ones.

### The word budget

`budget.ts::BUDGET.composed` allows 6,000 words. Spike 3 composed real workspace briefs: 5,353 words for the python pair and 5,176 for the hono pair with default fragments, using placeholder workspace and link bodies of about 100 words each. Spike 2's section-by-section estimate with a 700-word workspace body and a 300-word link came to about 6,000. So a workspace brief with real bodies sits at the limit.

The limit stays at 6,000 and the prose gets shorter (the maintainer's decision). The candidates, largest first: the two part bodies (736 to 906 words), `agent-ops` (447) and `ci-github` (about 330), which shorten every brief and not only workspace ones, and the workspace body itself, which should stay near 400 words. The per-step command blocks in the definition of done, about 500 words with two parts, are CLI output and would be a rendering change. A separate limit for workspaces through `composedLimit`, as apps have, is the fallback if trimming falls short.

The workspace body's own budget is the stack budget of 2,000 words and it should use a fraction of that. Its job is the seam; anything about one half belongs in that half's stack.

### What outlasts the brief

The brief is read once, during setup. The agent that adds a feature three weeks later reads `AGENTS.md` and the project's rules, not `.stacks/BRIEF.md`. So the seam has to land in the project as well:

- The workspace stack ships a short contract document at the root (as `python-react` ships `docs/ARCHITECTURE.md` today), stating the request path, the contract's owner and the change workflow. Like every shipped file, a verify step must exercise it; a check that it names each part directory and has no fill markers is the minimum.
- The workspace stack ships the root `AGENTS.md`, with a `CLAUDE.md` that imports it. It is the only instruction file a session started at the root is sure to read in every harness, so it holds the cross-part commands, the change workflow, where each part's commands run, and a link to each part's own `AGENTS.md`. The spike's workspace told the agent to fill a root `AGENTS.md` it had not shipped; the setup agent wrote one from nothing, and the feature agent three steps later relied on it.
- The change workflow in those files says the regenerated client is committed with the change, and the root full check runs the cross-part tests. In the spike the both-parts check and the e2e suite never touched the resource the agent added, so green said little about the feature; today's `python-react`, whose Playwright suite calls the real backend, did better there.

### Where authors learn this

`validate` can check that the headings exist, not that they say the right things. What a workspace body has to cover is authoring knowledge, and it goes where authors and authoring agents already look:

- `packages/cli/docs/authoring.md`, the one doc the package ships: the `parts` key, the role rules a stack must meet to be a part, and the ownership table above.
- The `stacks-author` skill the CLI ships, for an agent writing a personal or team workspace stack.
- This repository's `stack-authoring` skill and the `stack-creator` agent, for the bundled registry: a workspace section holding the inventory of cross-part knowledge as a checklist, the required headings with what each must answer, and the rule that anything about one half goes in that half's stack.
- The `fragment-authoring` skill: how a fragment is placed on a part, how to write a link in roles, and the block a part-scoped fragment adds for its effect on another part.

The checklist is written from Spike 1's record of what the agent needed and did not find, not from this section alone. `python-react` and `hono-react` are then authored from the guidance, which is its first test.

### What mounted part bodies get wrong

Known before any spike, from reading the bodies:

- Each part's `## Setup` ends with its own "fill the README, then `stacks verify` until green". A workspace brief then has three such endings. The workspace's Setup is the one that governs, and the fixed part line says so.
- Part bodies carry `stacks:when with=git-hooks` and `with=ci-github` blocks written for a project where the part is the root. In a workspace the hooks and CI live at the root, and Spike 3 confirmed those blocks resolve as absent in a part section, which is the right result for text that assumes the part is the root (`python-api`'s says its own `make install` runs `lefthook install`, which is false when mounted). The workspace body carries the replacement, as above. A part's `with=postgres` block is kept when `postgres` is placed on that part.
- A part's body names files that the workspace also has at the root (`README.md`, `.env.example`). The fixed line covers it, and it is the likeliest place for an agent to edit the wrong copy.

## Agent experience

Finding and starting a workspace needs nothing new. `search` returns `hono-react` as a stack hit with its card; `show hono-react --json` describes it, with its parts listed; `stacks new hono-react <dir>` builds it. `--with postgres` goes to the API part.

Two search cards change besides the new one. `python-api`'s card says under `notGoodAt` that "the Python and React stack covers those", which stays true. `python-react`'s card is rewritten for the frontend it now ships.

Two `--json` results change, each with its `core/result-schemas.ts::RESULT_SCHEMAS` entry:

- `NewResult` (and `new --dry-run --json`) gains the parts as an optional field. The mirror in `packages/mcp/src/schemas/cli.ts` and its drift test change with it; `packages/mcp/src/decode.ts` decodes without the excess-property error, so an older server is not broken by the field.
- `schemas/show.ts::ShowReport` gains the parts as an optional field.

## Designed for version 2

Version 2 lets an agent choose the parts itself. These choices in version 1 are made so that it only adds:

| Version 1 choice | What version 2 adds on top |
| --- | --- |
| `parts` is a list of named parts with roles | A bundled workspace stack with no fixed parts, filled from the command line. |
| Roles are a list in the CLI, with rules shared by every client | More roles (`mobile`, `cli`), each adding its own rules and no format change. |
| The role contract is checked on stacks named as parts | A `role` key on a stack, so the same check runs on any stack that claims the role. |
| `openapi.json` plus a drift step is what a link reads | A `provides: [openapi]` key naming that promise, so a link can be selected when it fits and skipped when it does not. |
| A link is a client-part fragment fed by a root command | A fit key beside `applies_to`, so a link can be selected or skipped for parts nobody chose in advance. |
| A part's directory is its name, recorded in `Manifest.parts` | Adding a client beside an existing API project, which leaves the API at the root. A root-mounted part cannot be written as a name, so version 2 adds an optional directory key to the manifest part. |
| Steps, commands and deps are namespaced by part name | Nothing; the same namespacing serves a free pair. |
| The workspace proof hashes its parts | Proof and stats attribution for pairs that share one workspace id. |

Version 1 does not add `role`, `provides` or the per-role fit key. Entry decoders reject unknown keys, so a key with no reader yet is a cost with no benefit.

## Phase 0: spikes

Each spike answers one question cheaply, in a scratch directory or a throwaway branch. None of it merges. All four ran on 2026-11-18. The method of each is kept below as written before the run, with its result added; [the run notes](runs/2026-11-18-stack-pairing-spikes/README.md) hold the detail.

### What the spikes found

Mounting is workable and no stop condition was met.

| Question | Answer |
| --- | --- |
| Can two existing stacks live in one repository? | Yes, with no change to either in order to mount. Built by hand twice and taken to green on a root check both times. |
| Does swapping the API part leave the client alone? | `frontend/` differed in one file by two lines, a generated hook's name. Fixing operation ids in the API rules removes that. The link's files were identical. |
| Is a composed brief as good as a hand-written one? | On one run each: the feature task finished green in three check rounds on both, with no wrong-directory command and no wrong-copy edit on either. |
| Does the brief fit 6,000 words? | At the limit with real bodies. Trim prose; a separate limit is the fallback. |
| Can the composer do it? | Yes. 26 single-stack assumptions, 16 in the composer path, where the first draft guessed ten. Existing fingerprints and briefs are unchanged. |
| Where do adapters go? | Neither first-draft option. A fixed per-harness list of session-root paths goes to the root and the rest stays in the part. |

What the spikes changed in this document: the proxy rule, the client seam, operation ids, what a link ships and that it writes only its own files, the `link` category, the adapter rule, placement of a fragment named by two parts, the index pin's key and fallback, what the workspace body must carry for CI, the root `AGENTS.md`, and the sizes of Phases 1 and 3.

What they did not show. No workspace went to green through `stacks verify`: the hand-built ones have no manifest and the composer spike stopped at composition. Every agent comparison is one run with one model. Harness loading of nested rules and skills comes from documentation, not a live session. The composer spike's worktree was cut 74 commits behind `main`, before the CLI structure refactor, so its patch names old paths and is a reference, not a starting branch. `validate`'s role-contract and heading checks, `NewResult` and `ShowReport`, and `create --from` and `submit` for a workspace were not reached.

The one-way doors are `StackMeta.parts`, `Manifest.parts` and the part pin on `IndexEntry`. A fourth joined them from the spikes: the `link` literal on `FragmentMeta.category`. Spikes 1, 3 and 4 have reported and none argues against these four. The option that would have changed `NEUTRAL_VARS`, a part-directory template value for adapters, is not taken. The entry and manifest keys are additive in type only: `core/registry/entry.ts` and the hosted catalog build decode entry frontmatter with `onExcessProperty: "error"`, so a `STACK.md` with `parts:` is a rejected entry in every CLI already released. Phase 2 states the rollout order.

### Spike 1: a hand-built workspace

Question: can two existing stacks live in one repository, and what does the root need?

Method. `stacks new` twice into one repository does not work: `scaffold/new.ts::checkScaffoldRepository` refuses fragments that need their own repository inside a parent one, and `git-hooks` and `ci-github` are defaults of all three stacks. So scaffold `python-api` and `react-vite` into two scratch directories with `--preset lean`, copy them under `backend/` and `frontend/` of one new repository, and delete the two `.stacks/` directories. Write by hand: the root Makefile, `lefthook.yml` and the CI workflow for two parts, the proxy in `vite.config.ts`, the shared example resource, and Orval wired onto `react-vite`'s fetch client. Repeat with `hono-api`, writing its `openapi.json` and drift step by hand.

The brief the agent works from is assembled mechanically, in the order "The brief" gives: a workspace body written to the required headings, the two stack bodies unedited under the fixed part line, then a link body written in roles. It is assembled before reading either stack's source, so the run tests what a composed brief could say. It is still not `renderBrief` output, and the spike does not prove the generated brief.

The spike judges the brief, not only the result. Two runs each:

- Setup: take the project to green from the brief alone.
- A feature: add a second resource end to end, with a route, the regenerated client, a page that uses it and tests in both parts. This is the task the seam exists for, and the setup run does not exercise it.

The same feature task is run on a project from the current `python-react`, whose brief was written by hand for both halves. That run is the baseline the composed brief has to match.

For each run, record every question the agent asked, every wrong action, and every edit made in the wrong part or the wrong copy of a file. Assign each to the layer that should have prevented it: a part body, the link body, the workspace body, or the fixed part line.

Reports:

- Every file that assumed the project root, to complete the table above.
- What `openapi-client` has to ship, as a file list, and whether `react-vite`'s client was a usable seam without rewriting it.
- How much of the generated-hook verify step can be static, given that operation names differ by framework.
- Where git hooks and CI live and what they run for two parts.
- The recorded brief failures by layer, and how the feature run compares with the `python-react` baseline.
- Whether the fixed part line was enough for an agent to run a part's commands in the part's directory and edit the part's copy of a file, or a mounted body variant is needed.
- Whether the three required headings covered what the agent needed, and what a fourth would be.
- Whether `vite preview`, which `react-vite`'s `web` step runs, uses the dev proxy, since the workspace's both-parts step depends on it.

Decides: the workspace stacks' content, the link's content, the brief's structure, and how much of each part mounts unchanged. A composed brief that does clearly worse than the hand-written one on the feature run is a reason to stop, as much as a file that will not mount. If a part needs more than a few changed files to be mounted, the count says whether a per-stack overlay for the mounted form is acceptable or the design stops.

Cost: two agent runs and hand edits. No CLI change.

Result: both pairs built and green by hand; setup and feature runs green from the composed brief, level with the `python-react` baseline on the feature task. The design continues. Findings are in "The role contract", "Links", "What a part's files assume" and "The brief".

### Spike 2: the brief budget

Question: does a workspace brief fit `budget.ts`'s 6,000-word composed limit?

Method: `compositions/budget.ts::canonicalBrief` counts `renderBrief` output, which includes fixed CLI text, the written-file list, decisions and steps, not only bodies. Take `briefWords` and `fixedWords` from `new --dry-run --json` for each stack in the two proof pairs, add the second file list, the link and the workspace body, and compare with the limit. The two API-plus-web body pairs are about 2,500 words before any of that.

Decides: whether a part needs a shorter body when mounted, a higher limit for workspaces, or nothing. With fixed parts, `validate` composes each workspace stack as it does any stack, so enforcement needs no new mechanism. Cost: an hour or two.

Result: at the limit. See "The word budget".

### Spike 3: two stacks in the composer

Question: what is the smallest change that lets `core/compose` compose a stack with two parts into two directories?

Method: on a throwaway branch, compose two workspaces, each with `openapi-client` as a client-part fragment: `python-api` + `react-vite`, and `hono-api` + `react-vite`. The second is the hard one, since both parts require `claude-harness`, both ship a `biome.json`, and both declare `merge: [.claude/settings.json]`, and it has to go through `plan-files.ts::planFiles` and not only a hand check. Composing one stack under a prefix would miss the failures only two stacks produce:

- `compose.ts::steps` raises `step_name`: both stacks define `install`, `lint`, `typecheck`, `test` and `readme-filled`.
- `mergeCommands` and `mergeDeps` collide, as the table above says.
- `conditionals.ts::ConditionContext` and `plan-files.ts::FileSelection.stack` hold one stack. Which stack id and tags does a workspace's context carry, for a part's body and for a root fragment body such as `ci-github`'s?
- `checkFit` and the `required` and `default` tiers test against one stack. What is lost when a part's own tiers are not selected?
- `checkPayload` and `selectAlwaysFragment` take one stack: `--payload none`, `--preset lean`, `--without` and the `always` setting.

The branch treats parts as a list from the start. It does not build a third part, but it reports anything in the composer that would only work for two, or for one part per role.

Reports: the above, plus merge files (`.claude/settings.json`), collision detection, the step digest and `checkTamper` on mounted steps, the proof fingerprint over parts, what `validate` reports for the workspace stack, and `add postgres` onto a workspace project.

It also has to settle each thing that is expensive to find after the format package is published:

- Existing stacks' fingerprints are unchanged with the `parts` key added.
- The manifest part as `{ name, role, stack: EntryRef }`, and the telemetry official check over parts.
- The placement rule by stack id, on both workspaces, and a part-scoped fragment's prefixed steps.
- The link as a client-part fragment with no path into another part.
- What two parts with one role would need from env.
- `build:index --unsigned` over the spike workspace, with a part pin prototyped: what the proof records, and what `merge.ts::resolveReference` does when a pinned part's bundle is missing.

Decides: the shape of `Manifest.parts`, and whether mounting belongs in `compose/` or in a step before it.

Cost: about a week, thrown away. The composer holds roughly ten single-stack assumptions. If it runs over, the reason is a finding to report, not a cue to narrow the spike.

Result: both workspaces compose, lean and default. `Manifest.parts` is `{ name, role, stack: EntryRef }` as proposed and stays outside the digest. Mounting belongs inside `compose/`, directly after fragment selection, because placement depends on the selected fragments, fit needs the parts, and overlay choice and the condition context are per entry. Phase 3 lists the 26 assumptions and the shape the spike recommends.

### Spike 4: agent adapters in a workspace

Question: where do a part's rules, hooks and settings go, and do they still work?

Method: in Spike 1's repository, try both options: adapters at the root with part-prefixed globs, and adapters inside each part with the session started there. `merge.ts::deepMerge` concatenates both parts' hook arrays into one root `settings.json`, so check hook commands, not only rule globs: do they assume the project root as their working directory? Check each harness in scope, not only Claude Code. With `hono-api` as the API part, check whether the root or part `biome.json` rules reach across parts.

Also reports where `claude-harness` goes when both parts name it.

Decides: the adapter rule in the table and the both-parts case. Cost: one day.

Result: a third option, in "Where a fragment goes". A fragment named by both parts is written once at the root.

### Failure cases

The gate before Phase 2 was that this revision name every failure case. `errors.ts::EntryInvalidDetails.reason` is a closed list with no literal for a bad `parts` key. Spike 3 fed each case to the prototype; "today" is what it did.

| Case | Today | Version 1 |
| --- | --- | --- |
| A part names a stack that does not exist | `new`: `NotFound` that does not name the workspace. `validate`: a generic finding. | `EntryInvalid`, reason `part_stack`, naming the workspace and the part. |
| A role the CLI does not know | Composes, exit 0. | `EntryInvalid`, reason `part_role`. |
| A name that is not kebab-case | `EntryInvalid` at decode. | Unchanged. |
| Two parts with one name | `file_owner` conflict naming one stack. | `EntryInvalid`, reason `part_name_duplicate`. |
| A part that itself has parts | Defect, exit 1. | `EntryInvalid`, reason `part_nested`. |
| No `api` part, two `api` parts, or two client parts | Composes, exit 0. | `EntryInvalid`, reason `part_roles`. |
| A part's required fragment not restated | Silent; the fragment is dropped. | A `validate` finding on the workspace stack. |
| A part that fails a Declared role rule | Not checked. | A `validate` finding naming the rule. |
| A part name that collides with a root path | `file_owner` naming only the workspace. | `ComposeConflict`, with `conflicts.ts::parties` naming both stacks. |

Each `EntryInvalid` reason gets its `failureGuide` line and a `runCli` test, and `validate` reports the same cases as findings without composing.

## Later phases

1. Convention alignment, in the registry only. It lands first and is larger than the first draft said. Each item is useful to the stack on its own:
   - `react-vite`: its example renamed from `items` to `notes` across about 20 files including its documents; the dev proxy stripping `/api`, with no fallback port; a request function on its API client module, with the module's path documented in its body; Biome excludes for `src/api/generated` and `openapi.json`.
   - `python-api`: `operation_id` on the example resource's routes.
   - `hono-api`: the OpenAPI dump script with a check mode, its two package scripts and the `openapi-drift` step.
   - Every stack with a Biome config: `"root": false`.
   - Every stack that ships hooks: tools found by walking up from the edited file, and hook file names that carry the stack id.
   - `python-react`'s backend adopts `python-api`'s health paths, error codes and OpenAPI command name. Its lean scaffold stops leaving posthog references behind, its rule stops citing an absent analytics module, and its Playwright config survives a second spec file (the baseline run found parallel workers racing Vite's cold dependency optimizer).
   - `go backend` and similar phrases join the search vocabulary.

   Changing a stack's files stales its proof, so each of these stacks needs a new ledger run.
2. Format, in a fixed rollout order, because released decoders reject unknown keys:
   1. Publish `@steamfield/stacks-format` alone with `StackMeta.parts`, `Manifest.parts`, the `IndexEntry` part pin and the `link` category (the manual format-only publish).
   2. Deploy `stacks-api` on it, so its catalog build and index build accept them.
   3. Release the CLI that reads them.
   4. Only then add `parts` to registry entries, in a registry whose `minCli` is that CLI's version.

   Step 4 relies on the remote-first index's D-R2: an older CLI offered an index above its version keeps its cached index or its bundled copy, so it goes on serving the `python-react` it shipped with. An older CLI that meets a workspace stack in a user or project root still rejects that entry.
3. Composition, `new`, `add`, `validate` and the fingerprint: mounting, namespacing, the role-contract check, the workspace proof.

   The shape, from Spike 3: one mounting step inside `compose/`, run directly after fragment selection, that rewrites each mounted entry's meta: step names and `cwd`, command keys, dependency roles and `merge` paths. After it, only `planFiles` (the output path and which overlay id to use) and the condition context know that parts exist. The spike instead applied the prefix in five consumers and missed one, `validate`'s command check, which is the argument for doing it once. The rewrite changes hashed meta only for workspaces.

   The single-stack assumptions it found, which are this phase's work list. In the composer path: `selection.ts::selectFragments` loads one stack; `fits` and `fitsStack` test one stack, behind `checkFit`, add-mode `applies_to`, `with_not_applicable` and `selectAlwaysFragment`; `compose.ts::conditionContext` carries one stack id and tag list; emitted entries are the stack and its fragments; `steps` raises `step_name`; `mergeCommands` replaces silently; `mergeDeps` merges roles across ecosystems; `FileSelection.stack` and `shipsFor` choose overlays by one stack; `planOutput` assumes root paths and entry-relative `merge` lists; `files.ts::readSource` finds owners among the stack and fragments only; `Composition` has no place for parts; the fingerprint functions cover one stack; `buildManifest` writes no parts; `renderBrief` has no part sections; `checkPayload` reads one stack's `payloads/`; `conflicts.ts::parties` names one stack. Outside it: `recipeNotes`' sources, the add brief's missing "placed on" line, `installer` reading the workspace's tags, `validate`'s command check and its skipping of part steps, `verify-run-duplicate` ignoring `cwd`, the two telemetry functions, the three remote-merge functions, the index proof script, `show`, and `add` taking parts from the registry entry where it should read `Manifest.parts`.

   Decisions the spike left to this phase: a dependency role that already equals the part name (`postgres`'s `backend` becomes `backend-backend`); a workspace command that replaces a namespaced one of the same key; and a part step whose own `cwd` is `..`, which joins to the root and should be refused in a mounted entry.

   Payloads. `checkPayload` reads only the workspace's own `payloads/`, so `--payload none` is refused on a workspace today. Version 1 applies a payload per part: each part that ships the named payload uses it, and the request is refused only when no part and not the workspace has it.
4. Authoring guidance, before the registry work so the two workspace stacks are written from it: `docs/authoring.md`, the `stacks-author` skill, the `stack-authoring` and `fragment-authoring` skills and the `stack-creator` agent ("Where authors learn this").
5. The registry: `openapi-client`, `python-react` rebuilt, `hono-react` with its search card, and the three fragments with `python-react` trees. Spike 1's hand-built trees and its file ledger, which assigns every file to the workspace, the link or a part, are the starting inventory. Its mistakes are the checklist: a drift check that compares against a fresh regeneration, a root Makefile that respects ports exported in the shell, a both-parts check that exits quietly on success, and cross-part tests that cover more than the example resource.
6. Proof: ledger runs for `python-react` and `hono-react`.

## Edge cases

- An untrusted part. Trust point 2 applies per entry; a workspace with any untrusted part is untrusted as a whole and never launches an agent (point 3). The mechanism is that part entries reach `compose.ts::untrustedEntries`, and `recipeNotes`' sources in add mode. It matters most for a trusted workspace whose part is shadowed by a project-root copy: `Registry.get` returns the project entry, and it has to be listed as untrusted. Such a shadow also changes proof currency and `show`'s `lastRun.sameContent`.
- Prefix collisions: a part named `db` with a step `up` against `postgres`'s `db-up`, and a namespaced command such as `backend-lint` against a workspace command of the same key, which `compose.ts::mergeCommands` replaces silently today.
- A part step whose own `cwd` is `..`, joined with the part directory: it resolves to the root, and is refused in a mounted entry (Phase 3).
- Both parts rendering the same `project_name` into a `package.json`: seen in Spike 1 and harmless.
- A stack guard that blocks a command in one part and so in the other: `hono-api`'s guard on `bun run dev` also stops the frontend's, and nothing guards the root `make dev`. The workspace ships the root guard.
- `verify --only <step>` on a workspace also ran the setup steps in Spike 3, installing in both parts. Whether that is existing behavior or the prototype's was not established.
- `compose.ts::dropFlags` gives no hint when an owner has `kind: "stack"`, and a part is a stack owner. `compose.ts::decisions` leaves only `composition.stack`'s decisions unprefixed.
- A workspace stack with an unknown part stack, a part that is itself a workspace, two parts with one name, no `api` part, two `api` parts, or a role outside the list: an invalid entry, reported by `validate` and refused by `new`.
- The same stack mounted twice under two names (two `react-vite` clients): allowed by the shape, not built or proven in version 1.
- An older CLI reading an entry whose role it does not know rejects that entry, which is the right result since it cannot check the role's rules.
- A user-registry workspace stack that names bundled parts, and `create --from` and `submit` for one.
- `--with` a fragment that fits neither part and not the workspace: warns as `with_not_applicable` does today.
- `--preset lean` drops only the workspace's defaults and `--without` works on them (Spike 3). `--payload` is per part (Phase 3). The `always` setting goes through the same fit path and was not run as a setting.
- Three `readme-filled` steps and three READMEs: each part and the root.
- A part directory that holds its own `.stacks/manifest.json`: `locateManifest` stops at the nearest one.
- `add` of a fragment to a workspace project when its part's stack is no longer in the registry.
- A link's verify step that needs both parts running: which `serve` steps it depends on.
- `stacks new python-api` and `stacks new react-vite` standalone are unchanged, apart from the conventions in Phase 1.

## What changes for python-react

Rebuilt `python-react` is a different project, not the same one built another way. Its recipe promises Tailwind, shadcn/ui and React Router in framework SPA mode; `react-vite` has a plain stylesheet by default, Tailwind as a decision, and library-mode routing. Its description, deps and search card change with it, along with `PORT_WEB` (5173 to 4173), its health paths, its error codes and its step names.

## Out of scope

Free pairing, the `--api` and `--web` flags, `add --web`, pair results in search, and any change to `packages/mcp` beyond the `NewResult` mirror: all version 2. Also out: building or proving any client role but `web`, a workspace with more than two parts, extracting an Expo stack from `mobile-expo`, a shared-contract link for TypeScript pairs, and workspace stacks beyond `python-react` and `hono-react`. The interface allows the first three; version 1 ships none of them.

## Success criteria

- "hono api with react spa frontend" returns `hono-react` first and strong, and an agent reaches a green `verify` from that result and the brief alone.
- `python-react` and `hono-react` each have a green ledger run.
- In a project from rebuilt `python-react`, an agent adds a resource end to end (route, regenerated client, page, tests in both parts) from the brief and the project's own files, with no more questions or wrong-part edits than on a project from today's `python-react`.
- `postgres` ships one tree. `python-react` ships no backend or frontend source of its own.
- A change to `react-vite`'s files stales the proofs of both workspace stacks.
- A third workspace stack over an API part that meets the role contract and the same client needs no CLI change and no change to `openapi-client`.
- Adding a client role later needs that role's name and rules in the CLI. It needs no change to the format package, `parts`, the manifest, mounting, namespacing or the proof.

## Open questions

1. Does `react-vite` gain Tailwind and shadcn/ui as defaults so `python-react` keeps them, or does `python-react` drop them?
2. `docker-deploy` ships a combined image for `python-react` and is in its optional tier. Does a workspace form of it belong in version 1, or does `python-react` lose the option until later? Its steps test for a root `Makefile` and probe `/healthz`, so their text changes either way.
3. Does a workspace's green run count toward each part's own evidence in the ledger and stats?
4. Whether a part's `decisions` that concern the whole project (package manager, Node version) are deduplicated across parts. Spike 2 counted the Node version decision twice in the hono pair because the two stacks word it differently.
5. A fragment placed on one part whose hoisted Codex or OpenCode skill, or Cursor rule, links to guidance that stays in the part: give those files a part-prefix template value, or leave them in the part and reach them through the root `AGENTS.md`? Only `rest-api` in the proof pairs.
6. Does the proxy rule as revised, stripping only `/api`, hold up? It was reasoned from the spike's workaround and not run.
7. Does `python-react` keep an e2e suite that calls the real backend? Today's does and `react-vite`'s intercepts its requests, and the feature run showed the difference in what green means.
8. Should a root fragment such as `ci-github` see the union of the parts' tags, so its per-language blocks apply, or does the workspace body carrying CI setup per part (the choice made here) suffice?

## Review log

2026-11-18, architect agent, read against the code with nothing run; six claims spot-checked before applying. Kept in this version:

- `Manifest.parts` is written only in workspace projects; entry keys need a rollout order because released decoders reject unknown keys.
- The workspace entry is a stack, which gives every contract its single stack id. A `parts` key on `StackMeta` replaces an unexplained alias for `python-react`.
- What a link reads from the API part is a committed file kept current by a drift step, since `validate` cannot run a command and `commands` holds descriptions.
- The mount directory lives in the digested step's `cwd`. (Part directories were CLI constants at that review; they now come from the part name.)
- Corrected facts: `react-vite` has no dev proxy; `claude-harness` requires `agent-ops` and names both proof stacks; the Go search result is a missing vocabulary phrase.
- Spike methods: two `new` runs in one repository cannot work; the budget spike counts the rendered brief; the composer spike composes two stacks.

2026-11-18, devil's-advocate agent, read against the code with nothing run; the port, health path and `/api/items` claims re-checked before applying. Kept in this version:

- Only one stack can fill the web role, and API stacks disagree on conventions. This is why version 1 is fixed parts.
- The role contract, recorded as a standing cost.
- Workspace proofs hash their parts.
- The link gets a verify step that uses a generated hook.
- The spike brief is assembled mechanically; the composer spike is estimated at a week.
- Rebuilt `python-react` is stated as a different project.

2026-11-18, maintainer: version 1 is fixed-parts workspace stacks, designed for version 2. Free pairing, the flags, `add --web`, per-role ranking and the pair search result moved to the version 2 RFC with the review findings that concern them. This narrowed document has not been reviewed again.

2026-11-18, maintainer: the parts interface must take further clients (mobile, a CLI, later ones), not only web. `parts` became a list of named parts with roles, the contract was split into API rules, rules for any client and rules per role, links were restated against any client, and directories and prefixes now come from the part name. Not reviewed since.

2026-11-18, maintainer: the workspace brief was under-specified. Added "The brief": the inventory of cross-part knowledge taken from `python-react`'s current body, which layer owns each kind, the section order for a workspace brief, the fixed line that opens each part and link section, the required headings and content check for a workspace body, the contract document that outlasts the brief, and the known ways a mounted part body goes wrong. Spike 1 now judges the brief with a feature run against a hand-written baseline. Not reviewed since.

2026-11-18, architect agent, second pass, on the narrowed and list-based version (before "The brief" was added), read against the code with nothing run. Applied:

- `StackMeta.parts` is `optionalKey`, so existing fingerprints do not change; `name` is `Kebab` in the schema.
- Roles are a kebab string in the format package with the known list in the CLI. The earlier text said both "closed literal in the format package" and "validate rejects unknown roles", which cannot both hold.
- `Manifest.parts` items carry an `EntryRef`, a non-literal role and a `Kebab` name; telemetry's official check includes parts; what an edited list can and cannot do is stated.
- The signed index pins fragments only. This was first applied as "exclude workspace stacks from the index", which was wrong: the remote-first index RFC is the next scheduled work and makes the index the source of entry content. The part pin is now in scope.
- Version 1 allows exactly one client part. Two parts with one role need per-part env, which was claimed to be only a validation change and is not.
- The role contract is split into rules `validate` can check from declarations and rules proven by verify steps.
- A link is a client-part fragment fed by a root command. "Applied once per client" was dropped, and with entry-chosen part names a link could not have named another part's directory.
- Placement is by stack id, not tag; part-scoped steps get the part's `cwd` and prefix; add-mode fit is tested against parts; a workspace restates its parts' required fragments.
- The proof covers each part's meta, body and files.
- Spike 3 composes both proof workspaces with the link and has a list of what it must settle; the format gate is Spikes 1, 3 and 4; failure tags are a gate before Phase 2.
- Stale text fixed: the Scope line on MCP, "the only `--json` change", and two rows of the version 2 table.

2026-11-18, checked against the other plans in this folder, which no review had done. Added "Relation to other plans": this work follows the remote-first index and the registry split, uses the registry's declared `minCli` for rollout, and shares its placement rule's input with the fragment admission RFC. Read from those RFCs' summaries and decision lists, not in full.

2026-11-18, Phase 0 spikes, run by agents (opus for the two builds, the composer prototype and the adapter spike; sonnet for the budget measurement and the four agent runs). Revised from their reports the same day:

- The role contract: operation ids fixed for the example resource; the proxy strips only `/api`, with no fallback port; a client exposes one request function and reads only the status and request id from a failure; the measured cost per stack.
- Links: the `link` category; what `openapi-client` ships; a link writes only its own files, with the scripts added by the agent, the excludes shipped in the client stack and the page left to the client stack; `openapi.json` is generated at setup, not shipped; the drift check compares against a fresh regeneration.
- Placement: a fragment named by more than one part goes to the root; `merge` lists are mounted; the adapter rule and its per-harness list replace the two options the first draft offered.
- The part-files table is completed, and the workspace ships the root `AGENTS.md` and `CLAUDE.md`.
- Proof: the pin is keyed by part name, falls back to the whole bundled workspace, and unproven pinned parts are published.
- The brief: the fixed line names the instruction files; Setup states what fails before generation and never cites step numbers; the workspace body carries CI and hooks per part; the budget section, with the maintainer's decision to trim prose and keep the limit.
- Failure cases are named with reasons. Phase 1 lists the registry changes per stack; Phase 3 carries the 26 assumptions and the mounting shape.

The two questions earlier reviews left unverified are answered: a nested root Biome config fails only a run from the root and `"root": false` fixes it, and `vite preview` uses the dev proxy. This revision has not been reviewed.
