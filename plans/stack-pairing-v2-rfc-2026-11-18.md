# RFC: free composition and workspace search, version 2 of stack pairing

Status: DEFERRED DRAFT 2026-11-18. Not scheduled. It depends on version 1, [stack-pairing-rfc-2026-11-18.md](stack-pairing-rfc-2026-11-18.md), being built and proven, and on the preconditions below. Most of its content was reviewed once by an architect agent and once by a devil's-advocate agent while it was part of a single RFC with two fixed roles; their findings that concern this version are folded in and listed at the end. It was then rewritten to match version 1's list of named parts, and that rewrite has not been reviewed. Version 1's spikes ran on 2026-11-18; what they mean for this version is listed under "Review findings carried into this version" and has not yet been worked into the sections above it.

Scope when it starts: entry, search and telemetry contracts in `packages/format`; `new`, `add`, `search`, `show`, `list` and `validate` in `packages/cli`; `stacks_list` and `stacks_new` in `packages/mcp`; and a matching ranking change in `stacks-api` that blocks the release.

## Summary

Version 1 gives a workspace stack whose parts are fixed by its author: one API part and one or more client parts, each a stack mounted in its own directory. Version 2 lets the agent choose the parts: `stacks new --part hono-api --part react-vite <dir>`, or `stacks add --part react-vite` on an existing API project. Search returns a composed workspace as one result, with the command to run. A link fragment such as `openapi-client` is selected for each client that qualifies and skipped where one does not, so any composition works at a baseline level and gets the generated client where it can.

## Preconditions

Do not start this until all three hold.

1. Version 1 has shipped, and `python-react` and `hono-react` have green ledger runs.
2. There is a real choice of client. On 2026-11-18 one stack can be a client part, `react-vite`, and free composition over it is "pick an API for `react-vite`", which a short list of workspace stacks does with full proof. A second web stack (a Vue or Svelte single-page app), or a first stack for another client role (an Expo app extracted from `mobile-expo`, a CLI client), changes that.
3. Enough API stacks meet version 1's role contract to make the choice real. On 2026-11-18 five use `PORT_API` and `/healthz` (`python-api`, `django-api`, `hono-api`, `nestjs-api`, `typescript-api`); `go-api` and `rust-api` use `PORT`; `quarkus-api` and `spring-boot-api` use `PORT` and their frameworks' own health paths.

The question to answer first when it does start: with the workspace stacks that exist by then, what does free composition deliver that adding one more workspace stack would not?

## Decisions already made

From the maintainer, during planning. They stand for this version, restated for a list of parts.

1. Any stack with the `api` role can be composed with any stack that has a client role. A composition with no recorded green run is offered and marked unproven.
2. `search` returns a composition as one result with its command.
3. Search is a requirement of the feature. Free composition does not ship with a search that leaves the agent to work out the parts for itself.
4. `add` can attach a client part beside an existing API project. It leaves the API at the root, ships no workspace root files, and the brief tells the agent to extend the existing root runner.
5. The interface covers client kinds beyond web: mobile, a CLI, and later ones.
6. A shared contract package for TypeScript-only compositions is a later link, not part of this version.

## What version 1 leaves in place

- `StackMeta.parts` and `Manifest.parts`: a list of `{ name, role, stack }`. The name is the part's directory and the prefix on its steps, commands and dependency roles. In the manifest, `stack` is an `EntryRef`.
- Roles as a kebab string in the format package, with the list the CLI knows (`api` and `web` to begin with) held in the CLI beside each role's rules.
- `validate`'s limits on a workspace: exactly one `api` part and exactly one client part.
- The role contract in three layers (API rules, rules for any client, rules for each client role), each rule either declared and checked by `validate` or proven by the workspace's verify steps.
- Mounting, with the directory in each step's digested `cwd`, and placement of a fragment by the stack id its `applies_to` names.
- A link as a fragment on the client part. It reads `./openapi.json` in the client's directory, and a root command the workspace stack ships puts the API's document there. `openapi.json` plus a step named `openapi-drift` is what the API part provides.
- Workspace proofs that cover each part's meta, body and files.
- A part pin on `IndexEntry`, so a workspace stack is served from the signed index with its parts pinned.

## Proposed additions

### Role and capability keys on a stack

A stack states the role it can fill and what it offers, so a stack nobody has named as a part can be found and checked:

```yaml
# stacks/python-api/STACK.md
role: api
provides: [openapi]
```

`role` runs version 1's contract check for that role on the stack itself. `provides: [openapi]` names version 1's promise (a committed `openapi.json` and a step that fails when it is stale), and `validate` checks for both. A stack that does not meet its role's contract does not get the role until it is changed, which is how "any API composes with any client" stays true.

### More client roles

Each new role is a name and a third layer of the contract in the CLI, with no format change. Two are foreseen:

- `mobile`. A native app cannot use a same-origin proxy, so its rule is an absolute base URL that a simulator or device can reach. There is no mobile stack to mount today; `mobile-expo` is a monolith whose halves share a TypeScript schemas package through one bun workspace, so an Expo stack has to be extracted from it first.
- `cli`. Its rule is a base URL from a flag or environment variable.

A role is added when a stack for it exists and a workspace with it has been taken to green, not before.

More than one client in a workspace comes in two kinds. Clients with different roles (web plus mobile) need only `validate`'s limit lifted, since each role has its own port variable. Two clients with the same role do not work on version 1's env model: every `web` part takes `PORT_WEB`, `Manifest.env` is one flat record, and `compose.ts::mergeEnv` raises on differing defaults. That needs per-part env names, which is a design of its own. A link on two clients has a second obstacle: `Manifest.fragments` is keyed by fragment id and `selection.ts::refuseAlreadyApplied` refuses a second application, so applying one fragment to two parts needs the manifest to record which part each application belongs to.

### The free workspace stack

One bundled workspace stack declares no fixed parts and takes them from the command line. It ships the root files that version 1's workspace stacks each write for themselves, and here the root Makefile becomes a real problem: it has to serve parts that run through make and parts that run through bun scripts, in any number, and a Makefile generated from part metadata is the template engine the product rules out. Two candidate rules:

- A static Makefile that discovers the part directories and dispatches on what each contains (a `Makefile` present, else `bun run`). Nothing is generated, but the root file encodes every runner a part may use.
- Every role-capable stack exposes the same targets through one runner. That puts make into the bun-only stacks, changes their tools for every standalone user, and is a permanent rule.

The first is the default unless it breaks in practice.

The same Makefile has one more job in this version. In version 1 a link reads the API's document from its own directory, and each workspace stack's root command copies it there, knowing both directory names. The free workspace's root command has to do that copy for parts it did not choose, so it needs the part directories at run time (from discovery, as above, or from `.stacks/manifest.json`).

`validate` needs a rule for this stack. Composed alone it has no parts, so no install, lint, typecheck or test layer, and `composition-findings.ts::warningFinding` turns every compose warning into an error. Either it is validated with a stated set of parts or it is exempted, and an exemption weakens the completeness check.

### Links selected by fit

A link gains a fit key that describes the API part and the client part it spans. `FragmentMeta.appliesTo` is a list of strings read by `selection.ts::fitsStack`, by `rank.ts::fits`, `mismatch`, `penaltiesFor` and `hitFor`, and by `report.ts::hitBlock`, so it stays as it is:

```yaml
# fragments/openapi-client/FRAGMENT.md
applies_to_parts:
  api: { provides: [openapi] }
  client: { tags: [typescript] }
```

`client` matches a part of any client role. In version 1 a link names the client stack in `applies_to` and is listed by a workspace author who knows it fits. Here nobody chose the parts in advance, so the fit key decides, and it also says which part the link is placed on. The link is evaluated for each client part: selected where it fits, left out where it does not, and reported either way, never an error. With one client per workspace that is one evaluation; more than one depends on the per-part record described under "More client roles". This is new behavior: `selection.ts::selectDefaults` does not check fit today, and an unfit fragment reaches `checkFit`'s `applies_to` conflict. A skip is a new `ComposeWarning` code, appears in `NewResult.warnings`, and is listed in a structured `links` field naming the part and a closed `reason`.

The baseline, with no link, needs proof of its own: for each client part, a workspace verify step that starts the API and that client and makes one request to the API through the client's API module. The role contract is what lets that step be written once per role.

### new

`stacks new --part [<name>=]<stack> ... <dir>`, with the flag repeated once per part. The role comes from the stack's own `role` key, so the agent does not state it. The name defaults per role (`backend` for the API, `frontend` for a web client, and so on) and has to be given when two parts share a role.

`new` takes `[<stack>] [<dir>]` today, both optional, so with `--part` the one positional is the directory and a stack positional beside it is `BadInput`. Also `BadInput`, with a `flag` and an `id` (it is not `Usage`, which is for parser failures): a stack with no role, no `api` part, two `api` parts, a repeated name, and a name that is not one safe path segment. Each case needs its `failureGuide` line and a `runCli` test.

### add

`stacks add --part [<name>=]<stack>` in a project whose stack has the `api` role writes the client under its part directory and leaves the API at the root. `Manifest.parts` records that layout. A part's directory is its name in version 1, held to one kebab segment, so a part at the root cannot be written; this version adds an optional directory key to the manifest part for it.

What add mode lacks today, each to be designed: `compose` emits no stack files in add mode; `selectRequired` is `new`-only, so the client stack's required fragments are never selected; `checkRequestedFragment` rejects a stack id; `add/manifest.ts::mergeAddManifest` merges only fragments, steps, env and commands.

Consequences to state to users:

- Two layouts exist. Step names differ (`lint` at the root in an `add` project, `backend-lint` in a `new` one), and path-bearing files such as a link's generator config differ. Templates know only the six values in `compose/files.ts::NEUTRAL_VARS`; either part directories become template values, with a cost to the fingerprint, or a link ships no path-bearing file under `add --part` and the brief carries it.
- The API project's existing CI and git hooks cover only the API. `add` cannot overwrite them, so the brief asks the agent to extend them, and no verify step checks that CI runs the new client.
- With a TypeScript API at the root, the root `biome.json` and its plugins may reach into the client's directory.
- Writing a whole stack into an existing repository sits close to what the problem statement says `add` is not for. That deserves a line in the product statement if this ships.

Refused up front as `BadInput`: a project whose stack has no `api` role, `stack: null`, a part name already in the manifest, and a part directory that already exists (a whole stack parked under `.stacks/incoming/` is a failed add).

### Search

A composition cannot be built from version 1's ranking. For a query that names technologies with no workspace stack behind them, the client half does not reach the top five, and search cards penalize each half for the other half's words (`python-api` lists React and "browser frontend" under `notFor`).

- Rank per role. Search recognizes a query that names an API and one or more clients, gives each role's words to the stacks of that role, and scores each part on its own words. `understood` reports the roles and the split. Per-role ranking is a new export from `@steamfield/stacks-format`; `rank`'s output for existing fields stays as it is.
- Role comes from `StackMeta.role`, which `RankRecord.entry.meta` already carries to `rank`. Cards do not repeat it.
- Compose only what the query names, and only when a stack fits each named role. "Full stack app with a typed client" names no technology and returns whole stacks. "Vue frontend with a Go API", when no Vue web stack exists, returns no composition. A query that names an API and a web client does not get a mobile part added.
- A composition that matches an existing workspace stack with those fixed parts is not shown; the workspace stack is, since it has its own proof.
- An unproven composition is never `strong`. `rank.ts::hitFor` grants `strong` only with zero penalties, and `noStrongMatch` and the "confirm with the user" branch of `next` read tiers, so an unproven composition reads as partial and the agent confirms it with the user.

In JSON a composition cannot be a row of `stacks`: `SearchHit.kind` is `Kind`, the rows are `kind: Literal("stack")` with `id: Kebab`, and a column added inside `stacks` or `fragments` fails every older decoder. Compositions are a new top-level optional key, `workspaces`, on `SearchResult` and `SearchResponse`, with its own exported schema. `core/search/remote.ts` decodes the hosted response without the excess-property error, so a hosted `workspaces` key does not break older CLIs. The top-level `next` field stays the one place that says what to run first.

```json
{
  "kind": "workspace",
  "parts": [
    { "name": "backend", "role": "api", "stack": "go-api" },
    { "name": "frontend", "role": "web", "stack": "react-vite" }
  ],
  "tier": "partial",
  "proven": false,
  "links": [
    { "id": "openapi-client", "part": "frontend", "selected": false, "reason": "api_lacks_capability" }
  ],
  "evidence": { "parts": { "backend": { "lastRun": "..." }, "frontend": { "lastRun": "..." } }, "workspace": null }
}
```

Text interleaves compositions and stacks by one comparator, reuses the lines a stack hit has, and puts the commands in the report's one `Next:` line, spelled with `Host.invocation`:

```text
workspace go-api + react-vite (partial, unproven)
A Go HTTP API with a React single-page app in its own directory.
Why: go backend (backend: requests, useCases); react frontend (frontend: id, name, summary)
Links: openapi-client skipped for frontend (go-api does not provide openapi)
Evidence: go-api last run 2026-11-01: pass; react-vite last run 2026-11-01: pass; no run of this workspace

Next: stacks show go-api --json; stacks show react-vite --json; then stacks new --part go-api --part react-vite <dir>
```

Still to define: a composition's sort key (its part stack ids in a fixed order, since `compareSearchHits` ends on `id`), its key in `search/merge.ts::hitKey`, a hosted composition when one part is overridden locally, how its summary line is generated from its parts' cards, and how many clients one query may compose before the result is noise.

### show, list, MCP

- `show <stack> --json` and `list --json` report `role` and `provides`.
- `packages/mcp/src/toolkit.ts` has no search tool, so decision 3 fails for an agent on MCP unless it can find the parts. `stacks_list` reports `role` and `provides`; `stacks_new` takes a list of parts, passed as repeated `--part=<value>` before the `--`. The mirror in `packages/mcp/src/schemas/cli.ts` and its drift test change in the same commit. Whether MCP also needs a search tool is open.

### Proof and stats for a shared id

Every free composition reports telemetry and ledger runs under the one bundled workspace id. Published stats and `rank.ts::quality`, which reads `evidence.stats` by id, would blend all of them into one green rate. Attribution has to carry the parts: a new telemetry event version that `stacks-api` accepts before the CLI release, and a ledger record that names them. Version 1's workspace stacks do not have this problem, since each has its own id.

## One-way doors

All in `packages/format`, none changed by a spike:

- `StackMeta`: `role`, `provides`.
- `FragmentMeta`: `applies_to_parts`.
- An optional directory key on the manifest part, and a per-part record of fragment applications if a link is to apply to two clients.
- How the index pins the parts of a free composition, which has no entry of its own to carry version 1's part pin.
- `SearchResult.workspaces`, `SearchResponse.workspaces` and the composition schema.
- `SearchMetadata`, if a card needs a role-scoped `notFor`. It is a closed union decoded with `onExcessProperty: "error"` in `search/sidecar.ts` and reused by `SearchIndex.entries`.
- A telemetry event version carrying parts.

The entry keys need version 1's rollout order: publish the format package alone, deploy `stacks-api` on it, then add the keys to entries. Released CLIs reject entries that carry them.

## Spikes

### Per-role ranking

Runs first and gates everything else in this version.

Question: can search split a query by role and return the right composition, without inventing one nobody asked for and without moving any existing result?

Method: a script outside `src/` that calls the ranking exported by `@steamfield/stacks-format`, with a role vocabulary. The query set has two halves. A tuning half: about eight queries that should return a specific composition and about six that should return none. A held-out half of the same size, written by someone else or drawn from real requests and never looked at while tuning, since a set written by the person who writes the vocabulary can be passed by fitting one to the other. The held-out half includes queries where one role has no fitting stack, and, once a second client role exists, queries that name three parts.

Passes when all four hold on the held-out half:

- At least seven of eight composition queries return the expected one first.
- No other query returns a composition, including those with an unfillable role.
- Existing single-stack expectations in the search tests are unchanged.
- The same set passes against the hosted API. Its response allows `method: "hybrid"` and its ranking was not read for this RFC; the spike either shows compositions are synthesized on both sides from the shared lexical code, or runs the set against a hosted build.

If the first approach fails, the spike tries ranking each candidate composition as one combined document, then curated cards for a short list. If none passes, free composition does not ship, and compositions remain workspace stacks.

Cost: one to two days.

### A hard composition by hand

Question: what does the role contract cost a stack that does not meet it, and does the baseline level work without a link?

Method: version 1's hand-built method with `go-api` and a client stack. `go-api` has no OpenAPI document and uses `PORT`. Reports what had to change in `go-api`, whether the static dispatching Makefile served it, and whether the baseline verify step passed.

### A second client role by hand

Question: do the rules for any client hold for a client that is not a browser app?

Method: when a mobile or CLI stack exists, mount it beside an API by hand with `openapi-client`. Reports which of the client rules it could not meet as written, and whether the link needed any change.

### Adding a part in the composer

Question: what does add mode need to write a stack as a part, on a make-based API project and on a TypeScript one?

Method: on a throwaway branch over version 1's composer, run `add --part react-vite` on scaffolded `python-api` and `hono-api`. Reports the add-mode gaps listed above, the fingerprint if part directories become template values, and what the existing CI, hooks and `biome.json` do afterwards.

Decides whether `add --part` ships with `new --part` or after it.

## Release rule

`--part` does not ship in a release whose search cannot return a composition, locally and from the hosted API. Composition, search and the `stacks-api` ranking change release together.

## Edge cases

- `--with postgres` on a free composition goes to the API part. `--payload none`, `--preset lean`, `--without` and the `always` setting when parts differ.
- The same stack given twice under two names.
- `add openapi-client` later, onto a project that has an API and a client but was created at the baseline level.
- A hosted composition result when the CLI has a local override of one part.
- A web stack with a server of its own (`nextjs`, `sveltekit`) has no role, though "Next.js frontend, FastAPI backend" is a request people make.
- `create --from`, `submit` and `validate` for a user-registry stack that declares a role.
- A composition with one untrusted part is untrusted as a whole and never launches an agent (trust point 3).

## Open questions

1. Whether the MCP server needs a search tool, or `stacks_list` with roles is enough.
2. Whether a composition's green run counts toward each part's evidence, and how published stats show one.
3. Whether the hosted catalog shows free compositions as pages.
4. Whether the product statement's description of `add` changes to cover adding a part.
5. Whether a workspace may have no `api` part (two clients of an external API) or more than one. Version 1's `validate` refuses both.

## Review findings carried into this version

From the architect review (2026-11-18): `applies_to` cannot change shape, so the fit is a new key; a composition cannot be a row in `stacks`; search cards and telemetry are one-way doors; refused input is `BadInput`; `new`'s positional order; adding a part with `add` was not covered by any spike; MCP has no search; skipped links and "unproven" must be structured fields, and commands belong in the one `Next:` line.

From the devil's-advocate review (2026-11-18): one client stack makes the matrix nine by one; API stacks disagree on port variable and health path; a failed ranking spike must not cancel workspace stacks; free compositions share one id for proof and stats; `validate` would fail a part-less workspace stack; the ranking spike needs a held-out set, unfillable-role queries and the hosted API; adding a part leaves CI and hooks half-integrated; unproven compositions must never be `strong`.

From the second architect review of version 1 (2026-11-18): roles live in the CLI, not as a format literal; the manifest part carries an `EntryRef`; a root-mounted part needs a directory key; two clients of one role need per-part env; a fragment cannot be applied to two parts while the manifest keys fragments by id; the index pins fragments only.

From version 1's Phase 0 spikes (2026-11-18, notes in [runs/2026-11-18-stack-pairing-spikes](runs/2026-11-18-stack-pairing-spikes/README.md)). These are observations that bear on this version; the sections above have not been rewritten around them, and that is the first job when this RFC is picked up.

- The role contract is wider than port and health path. Version 1 now fixes the example resource's operation ids and the shape of its list response, a request function on the client's API module, and a proxy that strips only `/api`. A stack that wants to be a part in a free composition meets all of it, so precondition 3's count of five API stacks is of stacks that meet the port and health rules only. `python-api` and `hono-api` are the two that meet the rest.
- What the contract leaves free still differs by API stack: schema names, the path parameter, pagination optionality, the error envelope. A link or client that reads any of those is per backend. Free composition makes that visible where fixed parts hide it, because nobody authors the pair.
- Per-backend authoring is small but not nothing: 12 of 59 root Makefile lines and about 8 of 52 workspace-body lines differed between the python and hono pairs, in four kinds of content (runner commands, contract commands, backend file names, operation naming). A part-less workspace stack has to get those from somewhere, which is the strongest argument yet for per-part values the workspace body and root files can read.
- CI and hook guidance drops out of a composed brief unless the workspace body restates it per part. In a free composition there is no author to restate it.
- A workspace that does not restate a part's required fragment loses it silently. A free composition has no workspace author, so the CLI has to select parts' required fragments itself.
- The same stack mounted twice fails in five places: `entryRef` is identical for both parts, the index pin (keyed by part name since the spikes), `ManifestStep.owner`, the placement rule, and one port for both.
- Placement by stack id depends on what the other part is: `claude-harness` landed in the frontend in one pair and at the root in the other. Version 1's adapter rule narrows the effect; with parts chosen at the command line it is the rule's normal case.
- Links carry `category: link` in version 1, so `applies_to_parts` has a marker to build on.
- Adapters follow a fixed per-harness list of session-root paths. A new client role (mobile, CLI) with its own harness files adds to that list.

Changed after those reviews and not reviewed since: parts as a list of named parts, the `--part` flag in place of one flag per role, `workspaces` in place of `pairs`, the fit key matching any client and evaluated per client part, and the client roles beyond web.

Not verified by either review: the hosted API's ranking.
