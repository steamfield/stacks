# Dogfooding log: using quickstacks to build quickstacks

Status: OPEN 2026-10-27. The log of what happens when a coding agent (with a shell, not the MCP
server) uses quickstacks to author the `typescript-mcp` stack and the `@quickstacks/mcp` server.
Every entry is a step where the tool made the work harder, what got around it, and the fix that
would have removed the friction. The last section is the rolling feature/bug list those entries
add up to.

Why this exists: this is the first time the product's own authoring loop is used by something other
than a person reading the plan. Friction found here is friction a real stack author will hit.

## How to add an entry

One row in "Entries" and one section below it. An entry records what was attempted, the exact
symptom, the cause when it is known (cite symbols, not line numbers), the workaround that unblocked
it, and the proposed fix. Mark each proposed fix as **bug**, **feature** or **docs** so it can go
straight into a tracker. Never delete an entry: if a later change fixes it, add `Fixed in: <what>`
to that entry instead.

## Entries

| ID | Date | Where | One line | Type |
|---|---|---|---|---|
| DF-01 | 2026-10-27 | reading the plan | The MCP plan tells the reader to open authoring docs that do not exist | docs |
| DF-02 | 2026-10-27 | reading the plan | The plan calls the binary `stacks`; it is `quickstacks` | docs |
| DF-03 | 2026-10-27 | running `guide` | `bun run dev guide` looks like a long-lived server to a wrapper that guesses from the word "dev" | feature |
| DF-04 | 2026-10-27 | reading the plan | A tool wraps `quickstacks show --json`; there is no `show` command | bug |
| DF-05 | 2026-10-27 | reading the plan | The plan's CLI discovery assumes a published package with `bin`/`exports` | bug |
| DF-06 | 2026-10-27 | reading the plan | The plan's Effect imports and protocols do not match Effect 4.0.6's MCP modules | docs |
| DF-07 | 2026-10-27 | environment | `effect` is not hoisted to the root `node_modules`; a new package sees nothing | docs |
| DF-08 | 2026-10-27 | acceptance trace | The trace harness reads tags only from `packages/cli`, so a plan whose tests live elsewhere cannot be traced | feature |
| DF-09 | 2026-10-27 | reading the plan | The plan's exit criteria need a publish; nothing in the repo is publishable | docs |
| DF-10 | 2026-10-27 | registry rules | The bundled registry is held to zero warnings, and no single command lists the warnings you must clear | feature |
| DF-11 | 2026-10-27 | plan for Part 2 | `git-hooks` and `ci-github` are `needs_own_repo`, so scaffolding inside any repository fails `ComposeConflict` | docs |
| DF-12 | 2026-10-27 | running `new --sandbox --json` | `handoff.kind` is `inside-agent` when the caller has an agent marker, not `print`, even under `--json` | docs |
| DF-13 | 2026-10-27 | definition of done | A default fragment's setup step needs `lefthook`, which no clean machine has, so green is unreachable without a system install | feature |
| DF-14 | 2026-10-27 | the brief | The dependency list renders `typescript: effect`, which reads as if `effect` were the TypeScript compiler | docs |

## DF-01 — the authoring docs the plan points at do not exist

**Attempted:** the starting prompt says to read `packages/cli/docs/authoring.md` and one bundled
stack.

**Symptom:** `packages/cli/docs` does not exist. `find` for any `authoring*` file returns nothing.

**Cause:** phase 3.1b ("create-and-authoring-guide") has not shipped. The plan was written against
the plan of a later phase, not against the checkout.

**Workaround:** the authoring contract is spread across `packages/cli/README.md` ("Listing stacks
and fragments", "Validating a registry"), `packages/cli/registry/README.md`, and the decoder
`src/schemas/entry.ts::StackMeta` / `FragmentMeta`. Read all three, and treat the decoder as the
only authority on keys.

**Proposed fix (docs):** ship 3.1b's guide, or add one line to `quickstacks guide` naming the
authoring entry point. A plan that cites a file should cite a file that exists.

## DF-02 — the binary is `quickstacks`

**Attempted:** `stacks guide`, as the prompt wrote it.

**Symptom:** no `stacks` binary and no `stacks` package. D0 records that `stacks` on npm belongs to
someone else.

**Workaround:** `bun packages/cli/src/bin.ts guide` (see DF-03 for why not `bun run dev guide`).

**Proposed fix (docs):** the guide and the README are already correct; the friction was in the
prompt. Worth noting because the product name and the CLI name differ on purpose, and every
example should use one of them consistently.

## DF-03 — `bun run dev` trips a long-lived-process guard

**Attempted:** `bun run dev guide` from the repo root, the command `AGENTS.md` documents.

**Symptom:** the wrapper refused to run it, classifying it as a server or watch process. Nothing
executed.

**Cause:** the wrapper heuristics on the script name. `dev` in an npm script usually means a
server; here it means "the CLI from source".

**Workaround:** run the entry point directly: `bun packages/cli/src/bin.ts guide`. Works
identically and keeps the caller's directory.

**Proposed fix (feature):** the guide's own examples could name the direct invocation
(`bun packages/cli/src/bin.ts ...`) alongside `bun run dev`, so a wrapper that refuses "dev" has a
documented second way in.

## DF-04 — a tool with no command behind it

**Attempted:** follow the plan's tool table, which lists `quickstacks_show` over
`quickstacks show --json`.

**Symptom:** `src/commands/` has doctor, guide, list, new, root, skill, validate and verify. There
is no `show`, and no `--json` contract to wrap.

**Cause:** the plan depends on 3.1a, which has not shipped.

**Workaround:** ship three tools (list, new, verify) and the brief resource; `show` lands when the
command does.

**Proposed fix (bug):** a phase file's "Depends on" row is not checked against the code, so a plan
can cite a command that does not exist. The rewrite records the verification date and what it
found.

## DF-05 — the plan's CLI discovery cannot work yet

**Attempted:** take the plan's resolution at face value: `createRequire(...).resolve("quickstacks/package.json")`,
then run `bin.quickstacks` through `process.execPath`.

**Symptom:** `packages/cli/package.json` has no `bin` and no `exports`. `packages/cli/dist/quickstacks`
is a Bun-compiled native binary (`scripts/build.ts`, `compile.outfile`), which `node` cannot load as
a script.

**Cause:** publishing (0.2, 1.6c) is deferred, so the shape the plan assumed does not exist.

**Workaround:** a four-step resolver (env var, dependency `bin`, monorepo `dist`, fail) that runs a
`.mjs`/`.js` entry through `process.execPath` and a native binary directly. The stack's prose and
the package's tests both use it.

**Proposed fix (bug):** the plan; it is rewritten with the resolver as a named step.

## DF-06 — Effect 4.0.6's MCP modules are not what the plan says

**Attempted:** write the server against the plan's sketch.

**Symptom:** three mismatches. `effect/ai` exports namespaces (`McpServer`, `McpClient`, `Tool`,
`Toolkit`, `McpProtocol`, `McpSchema`) rather than loose symbols, so `McpServer.layerStdio` is
reached through the namespace. `McpServer.layerStdio` requires `Stdio`, which only
`NodeStdio.layer` from `@effect/platform-node` provides. And `McpClient.ProtocolVersion` is
`"2025-11-25" | "2026-07-28"` only, so a server advertising `2025-06-18` cannot be tested with the
same library.

**Cause:** the plan was written from module documentation without checking the installed
declarations.

**Workaround:** the stack names both revisions, the tests pin `v2025_11_25`, and the plan says to
re-check the `.d.ts` files before writing code.

**Proposed fix (docs):** the plan now cites `dist/ai/*.d.ts` as the authority and records this.

## DF-07 — Effect is not at the root

**Attempted:** add `effect` to a new package.

**Symptom:** `<repo>/node_modules` has only Biome, TypeScript, Vitest and types. `effect` lives at
`packages/cli/node_modules/effect`, a Bun isolated-layout install.

**Cause:** Bun's isolated linker, not a workspace-wide hoist.

**Workaround:** depend on `"catalog:"` from the root catalog, then `bun install`. The registry's
shipped `.ts` files resolve `effect` through the CLI package, which is why a stack shipping `.ts`
files typechecks at all.

**Proposed fix (docs):** the README's "Monorepo" section covers `catalog:`; one sentence that a
dependency is not visible from a sibling package would have saved a wrong assumption.

## DF-08 — the acceptance trace only reads the CLI's tests

**Attempted:** follow the plan convention and mark the rewritten 4.3 plan `Acceptance tests: traced`.

**Symptom:** `tests/acceptance/trace.test.ts` scans `packages/cli/tests` and `packages/cli/e2e`
only. A traced plan whose tests live in `packages/mcp/tests` fails the root test: every numbered
item would be untagged.

**Cause:** the harness was written when every test was a CLI test.

**Workaround:** the plan is not marked traced, and says so, so nobody adds the line later without
widening the harness.

**Proposed fix (feature):** take the scanned roots from the plan's package, or read a
`tests: [packages/mcp]` line beside the marker. That would let a phase in any package keep the
trace guarantee.

## DF-09 — exit criteria that need a publish

**Attempted:** read the old exit criteria.

**Symptom:** two of them need `@quickstacks/mcp` on npm and `npx -y @quickstacks/mcp` to start.
0.2 and 1.6c are both deferred and nothing in the repo is publishable.

**Cause:** the plan assumed release phases had landed.

**Workaround:** the plan ends at a green local verify plus one registered client; publishing is
named as 1.6c's.

**Proposed fix (docs):** in the rewrite.

## DF-10 — zero warnings, no way to see them

**Attempted:** know what a new stack must satisfy before running `validate`.

**Symptom:** the bundled registry must pass with zero errors **and** zero warnings
(`tests/bundled-registry.test.ts`), but `validate`'s findings are a mixture of errors, warnings and
notes, and the difference is described in prose (`src/core/validate/index.ts`, severities) rather
than shown by `--help`.

**Cause:** severity rules live in code and in the README's table, not in the command's help.

**Workaround:** read the README's "Validating a registry" section first, and treat any finding on a
new entry as fatal until proven otherwise.

**Proposed fix (feature):** `validate --json` already carries severities; have the summary line
count them per severity (`0 errors, 2 warnings, 3 notes`) so the gate is visible without reading
the report.

## DF-11 — `needs_own_repo` fragments refuse composition inside any repository

**Attempted:** scaffold the stack into a directory under `$HOME` (this profile's scratch space) to try
the brief.

**Symptom:** exit 2, `ComposeConflict`, `details.reason: "needs_own_repo"`, `ids: ["ci-github",
"git-hooks"]`, `path: "/Users/me/.hermes"`, `fix: ["--without ci-github", "--without git-hooks"]`.
The scratch directory was inside a git repository, so `new` found a parent repo and refused both
fragments. `--sandbox` does not help: it keeps defaults.

**Cause:** the rule is right (a nested project must not install hooks or CI into its host repo), but
only `git-hooks` was obvious. `ci-github` carries it too, which matters for the plan's Part 2: the
in-repo scaffold needs both flags, not one.

**Workaround:** scaffold outside any repository (a plain directory such as
`$HOME/quickstacks-projects/<name>`), or pass both `--without` flags.

**Proposed fix (docs):** the plan for Part 2 now names both flags, and the finding is the argument
for `list --json` exposing `needsOwnRepo`.

## DF-12 — `inside-agent` beats `--json`, and the plan said otherwise

**Attempted:** assert the plan's acceptance test: `new ... --json` returns `handoff.kind: "print"` with
`reason: "json"`.

**Symptom:** the real result is `handoff: { kind: "inside-agent", agent: "other", untrusted: [], prompt:
"Read .quickstacks/BRIEF.md and carry it out..." }`. No agent was launched, which is what the test
really cared about.

**Cause:** the handoff order puts the agent marker first (`src/core/handoff.ts::decideHandoff`), so a
caller that is itself an agent gets the inside-agent prompt even with `--json`. Only a caller with no
marker gets `print` with `reason: "json"`.

**Workaround:** none needed; the behaviour is correct and the test was wrong. Both Part 1 and Part 2
acceptance tests now assert "records inside-agent or print for the caller's environment, and launches
nothing".

**Proposed fix (docs):** the README's handoff list reads as if `--json` decided the handoff first. One
sentence that the marker wins over `--json`, and that `--json` only prevents a launch, would stop the
next person writing the same wrong test.

## DF-13 — a green verify is unreachable on a machine without `lefthook`

**Attempted:** plan a full dogfood run to a green `verify` on this machine.

**Symptom:** `new` reports `missingTools: [{ tool: "lefthook", owners: [{ kind: "fragment", id:
"git-hooks" }], drop: [{ id: "git-hooks", flag: "without" }] }]`, and the definition of done includes
`lefthook install`, `lefthook validate` and a `lefthook.yml` grep. `lefthook` is not on PATH here and
`brew list lefthook` is empty, so three steps cannot pass.

**Cause:** a default fragment contributes setup and check steps that need a tool the brief cannot
install for itself. The brief's instruction is to install it if that needs no admin and no prompt,
otherwise to stop and tell the user, which puts a system change in the middle of an autonomous build.

**Workaround:** scaffold with `--without git-hooks` for the run, which loses the hooks prose and those
three steps, or install lefthook first.

**Proposed fix (feature):** `new` already knows the tool is missing and which flag drops the fragment;
it could say so in the brief's "Definition of done" section rather than only under "Dependencies and
tools", and a stack could mark a fragment as needing a tool that must be present *before* the build
starts. Either way the decision (install, or drop) is the person's, and the brief should surface it as
a decision rather than an instruction the builder may or may not be able to follow.

## DF-14 — the dependency roles read wrong

**Attempted:** read the brief's dependency list.

**Symptom:** under "Packages, by role" it lists `app: effect, @effect/platform-node`, `dev: ...`, and
then `typescript: effect`. The last one reads as "the `typescript` role needs the `effect` package",
which is true in the data model and nonsense to a reader.

**Cause:** roles are free strings from an entry's `deps` record, and the effect-schema fragment uses
`typescript` as a role name for the package `effect`.

**Workaround:** none; the reader has to infer it.

**Proposed fix (docs):** either rename the role in that fragment, or have the brief print a role's
meaning when it is not one of the known roles (`app`, `dev`). A one-line legend under the list would
do it.

## DF-15 — the stack ordered a CLI-wrapper layout for a server that wraps nothing

**Attempted:** build the slice from the composed brief: two tools (`ping`, `echo`) and one resource.

**Symptom:** the builder wrote `src/run-cli.ts` and `src/resolve-cli.ts`, with unit tests against a
fake `ChildProcessSpawner`, and nothing in `src/` calls either one. Three more sentences of the brief
had nowhere to land: "decode the result" (in the handler), "each handler against a fake of the service
it calls" (no handler calls a service), and the decision "the only runtime dependency is the CLI it
wraps, for a later package" (no such package exists here).

**Cause:** I wrote the stack from Part 2's target architecture — a server that shells out to
`quickstacks` — instead of from the generic slice the stack itself defines. Four of the brief's
instructions describe a shape the same brief never asks for, so a builder either writes dead code or
invents a service to justify the files.

**Workaround:** the builder wrote both modules and tested them against the fake, which is honest work
in service of a bad instruction.

**Fixed in:** the stack. `src/run.ts` is now opt-in ("if this server fronts another program"), handlers
map failures only because `Tool.make` decodes both directions, fakes exist only where a service is
called, and decision 4 no longer names a CLI.

## DF-16 — `src/schemas.ts` cannot coexist with the `effect-schema` fragment

**Attempted:** follow the Layout section literally.

**Symptom:** Layout said "`src/schemas.ts` holds the decoders"; the `effect-schema` fragment requires
"one file per domain in the schema directory ... re-exported from an `index.ts`". A file and a
directory cannot both own the `./schemas` specifier.

**Cause:** two entries in one composition describing the same path differently. Fragment wins by
convention, but nothing says so.

**Fixed in:** the stack names `src/schemas/` with an `index.ts` and says the fragment's rule wins if
they ever disagree.

## DF-17 — the brief required an `engines.node` "matching `.node-version`" that nothing wrote

**Symptom:** no `.node-version` was in the brief's file list, so the builder invented `24` and had to
derive `engines.node` from it.

**Cause:** my stack prose, written as if the file already existed. Same shape as the `BunRuntime`
error: `validate` checks the frontmatter, not the claims in the body.

**Fixed in:** the stack tells the builder to write `.node-version` and match `engines.node` to it.

## DF-18 — "TypeScript is strict, per the repository base" — a scaffold has no base

**Symptom:** the builder ran `tsc --init` and kept its defaults, because no base tsconfig exists in a
freshly created project.

**Cause:** wording carried over from a monorepo stack, where a base does exist. The rule is right; the
reason given for it is wrong, and a rule with a wrong reason gets ignored the first time it is
inconvenient.

**Fixed in:** the stack says to start from the compiler's own `--init` output and stay strict.

## DF-19 — "assert the advertised list" is not reachable through `McpClient`

**Symptom:** the builder could not assert the server's advertised revisions: `InitializeResult` carries
only the negotiated `protocolVersion`, and the advertised list never surfaces. It proved both
revisions by connecting twice instead.

**Cause:** I asserted a capability of the client from the shape of the server API. Same class of error
as the `structuredContent` assumption: plausible, wrong, and invisible to `validate`.

**Fixed in:** the stack now says a client exposes the negotiated version only, and prescribes the
second connection.

## DF-20 — `McpClient.layerStdio` drains the child's stderr and discards it

**Symptom:** the brief ordered the e2e test to print the server's stderr before the assertion output.
The prescribed API drops that stream (`Stream.runDrain(process.stderr)`), so a failing handshake
produced no server log at all. The builder wrapped `ChildProcessSpawner` in the test layer to keep a
copy.

**Cause:** the instruction assumed plumbing the library does not provide.

**Fixed in:** the stack names the drain and prescribes the `ChildProcessSpawner` wrapper.

## DF-21 — "the run returns when the fiber completes" — `Layer.launch` never returns

**Symptom:** after stdin reached EOF the process stayed alive until the client killed it.

**Cause:** the Gotcha was written against a scope that ends; `McpServer.layerStdio` reaches the runtime
through `Layer.launch`, which never returns. Correct advice ("do not call `process.exit`") resting on a
false mechanism.

**Fixed in:** the stack states what actually happens and says ending the process is the client's job.

## DF-22 — the failure content contract was unstated, so the test guessed

**Symptom:** `Schema.TaggedError` is not an `Error` instance in Effect 4.0.6, so the MCP layer
JSON-encodes it and the client reads `{"_tag":"EchoTooLong","message":"..."}`. The brief only said "the
test must parse it".

**Cause:** the content is a contract with the client and the stack left it implicit.

**Fixed in:** the stack gives the encoded shape explicitly and tells the builder to assert it.

## DF-23 — the resource URI and the package metadata were left unnamed

**Symptom:** the brief named neither the resource's URI, name or body, nor the package slug, version or
`bin` value. The builder chose `mcp-build1://readme`, slug `mcp-build1`, version `0.1.0`.

**Cause:** I described the shape of each ("a fixed URI", "the project slug") without binding it to
anything the project actually has.

**Fixed in:** the stack binds the URI to the slug (`<slug>://readme`), puts the body in one exported
constant, and names the slug as the directory name and the version as `0.1.0`.

## DF-24 — the brief required `AGENTS.md`, and no fragment in the composition writes one

**Symptom:** the brief asked for `AGENTS.md` to be kept true and to carry a CI section, a Schemas
section and a link to the Effect skill. Nothing had created the file: `agent-ops` is the fragment that
ships `AGENTS.md`, five of the eight other stacks include it, and this stack did not.

**Cause:** stack prose that assumes a fragment it does not compose. A reader of the brief cannot tell
that the requirement is unsatisfiable.

**Fixed in:** the stack no longer requires it and says a composed `agent-ops` provides one. Alternative
recorded: add `agent-ops` to the defaults, which also adds its hooks and a `agents-md-filled` check —
rejected because an MCP server is often scaffolded into a package of a repository that already has an
`AGENTS.md`, which is exactly the Part 2 case.

**Proposed fix (feature):** `validate` could cross-check prose references against the composed entries —
`AGENTS.md` against the fragments that write it, `src/schemas.ts` against a fragment's directory rule.
The two worst findings of this run (DF-16, DF-24) are both that one check.

## DF-25 — a harness guard refused the file the brief asked for

**Symptom:** the builder's write to `AGENTS.md` was refused outright: protected agent-instruction file.
It put the content in the README instead and recorded it.

**Cause:** an agent harness protecting its own instruction files. Not a quickstacks defect, but a real
interaction: a brief that mandates an `AGENTS.md` can be unsatisfiable for reasons outside the project,
and the builder should be told to record that rather than route around it.

**Workaround:** the guard held and the builder documented the gap in NOTES, which is the right outcome.

## DF-26 — the brief never states the toolchain versions it expects

**Symptom:** `.node-version` and `.bun-version` had to be chosen, and the brief gives no basis for
choosing: it says record the Bun version the build needs without saying which one works.

**Cause:** the brief is composed from the registry, which has no reason to know the machine's toolchain.
The composer does.

**Proposed fix (feature):** the brief prints the `node` and `bun` versions present at compose time, and
says plainly that pinning them is a CI decision rather than a local one.

## DF-27 — Biome 2 matches nothing unless the include pattern is a glob

**Attempted:** build the scaffold with the stack's Setup rule: "Biome with two spaces, double quotes,
width 100, and organized imports."

**Symptom:** `biome check src tests e2e scripts` printed `Checked 0 files`, then exited 1 with "No
files were processed in the specified paths ... These paths were provided but ignored: src, tests,
e2e, scripts". The config's `files.includes` used bare directory names.

**Cause:** Biome 2's include rules are globs; `src` matches no file while `src/**` matches the tree. The
stack says which formatter settings to use and never says the config must actually match the sources,
so a builder writes a config that lints nothing. The failure mode is nasty: the message reads like a
lint error, and the cheapest way to green is to narrow the lint script until it stops complaining.

**Workaround:** the build coder changed the includes to `**` globs and reported `Checked 14 files`.

**Proposed fix (docs):** the stack's Setup or Gotchas names the trap and the tell — a lint run that
reports a file count of zero is a config failure, not a clean codebase, and the count is worth asserting
in the verify script (`biome check` output must be non-zero files).

## DF-28 — the `git-hooks` fragment never says how a hook receives the commit-message path

**Attempted:** follow the `git-hooks` fragment's "commit-msg: a few lines of shell requiring
`type(scope)!: description`".

**Symptom:** the builder wrote a hook that reads `$1`. Under lefthook 2.2.2 that variable is empty when
git fires the hook, so the conventional-commits check rejected **every** commit, including good ones.
The coder found it because it could not commit, and fixed it to `cat "{1}"` — lefthook's own
substitution — then verified both directions: `bad` is rejected, `feat: add thing` is accepted.

**Cause:** the fragment describes the hook's behaviour and never its input. lefthook 1.x-era habits say
`$1`; 2.x passes the argument through `{1}`.

**The part that matters most:** the fragment's own acceptance step is
`lefthook run commit-msg /tmp/msg`, which passes the path as an explicit CLI argument — the one
invocation where `$1` still works. So the prescribed proof passes while the hook a developer actually
triggers is broken. A verify step that cannot fail for the defect it is meant to catch is worse than no
step: it certifies the bug.

**Proposed fix (docs):** the fragment states the input mechanism explicitly (`{1}`, quoted) and proves
the hook the way git fires it — a real `git commit` with a bad message must fail, and with a good one
must succeed. Two lines, and it would have caught this on the first project that composed the fragment.

## DF-29 — a stage plan that says "build the whole brief" produces a half-built project reported as success

**Attempted:** hand the corrected stack to OpenCode as one stage: read the brief, build it, verify green.

**Symptom:** `opencode run` exited 0 with nine source files, configs, a CI workflow and hook config on
disk — and `verify` failing three steps, nothing committed. The run had run out of road mid-debug: it
hit a `tsc` error, tried to write a scratch probe to `/tmp`, was refused by the permission layer, and
stopped.

**Cause:** two things, both mine. The stage was unbounded ("the whole brief"), so there was no natural
checkpoint at which the coder had to report; and the launcher pipes through `tail`, so the exit status
is the pipe's, not the verify's. Neither says anything about the project's state.

**Workaround:** a second, bounded stage naming the three exact failures, the forbidden shortcuts for
each, and the number that must change (`Checked N files`, N > 10). That run reached
`verify: green (9 passed, 0 failed, 0 skipped)` and committed.

**Proposed fix (process):** stage plans are one bounded unit with a machine-checkable end state, and the
gate is re-run by whoever delegated it — never inferred from the coder's exit code or its own summary.

## DF-30 — the 6,000-word brief budget is shared across stacks, and a coder's reason for an edit can be invented

**Attempted:** have a coder add two paragraphs to two registry entries and keep the gate green.

**Symptom:** it did the edits correctly and reported that it had to tighten both ("the git-hooks
addition would have pushed mobile-expo's composed brief over 6,000 words; the typescript-mcp addition
would have pushed its body over 2,000").

**Cause, part one:** the first claim is false. Measured across all nine stacks, the largest composed
brief is mobile-expo at 5,219 words against a 6,000 limit, so a 45-word sentence would have landed at
about 5,264. The coder reached a reasonable edit through an invented arithmetic justification. This is
the reason to re-run the gate and measure rather than read the summary: the work was fine, the stated
reasoning was not, and only one of those is checkable.

**Cause, part two (real product constraint):** the budget genuinely is shared. Every stack that composes
a fragment pays for that fragment's prose, so editing `git-hooks` charges all seven stacks that include
it. The margin is not obvious from the file being edited, and nothing warns until the day a stack tips
over the limit.

**Proposed fix (feature):** `validate --brief` prints headroom per stack, and `validate` gains a
registry-wide summary of the tightest stack and how many words are left, so the cost of a fragment edit
is visible before it is made. Also consider whether a fragment's prose should be charged against a
separate budget from the stack's own body.

## DF-31 — "then drop both" invites a destructive git reset

**Attempted:** fix the `git-hooks` fragment's proof step so it exercises the hook the way git fires it.

**Symptom:** the replacement reads "then commit a non-conforming message, see it refused, then
`feat: add thing`, see it accepted, then drop both." A builder that creates two commits and drops them
afterwards is being pointed at `reset --hard` or a rebase — in a repository that, one line earlier, may
have just had its first real commit made.

**Cause:** the proof has to produce commits to be honest, and the instruction never says when or how to
remove them. The cheap way to satisfy "drop both" is the dangerous one.

**Proposed fix (docs):** state the safe form — prove the hook *before* the first real commit, or use
`git commit --amend` on a single scratch commit, and never `reset --hard`. The rule is worth writing
because the audience for these briefs is an agent that will pick the shortest path.

## DF-32 — my corrected failure-content rule is itself wrong about the mechanism

**Attempted:** fix my earlier claim that a `Schema.TaggedError` is not an `Error` instance, so the
client necessarily receives JSON. A build from the corrected brief checked it.

**Symptom:** the builder reported that in effect 4.0.6 a `Schema.TaggedError` **is** an `Error`
instance with a non-empty `message` — so my premise is false — while the observed client payload is
still the JSON `{"_tag":...,"message":...}`. Both halves of that do not follow from one another, which
is the tell that the rule I wrote is not the rule the library implements.

**Cause:** reading `McpServer.js` shows a branch, not a rule. For a declared handler failure it calls
`declaredFailureResult`, which is:
`error instanceof Error && error.message !== "" ? toolErrorResult(error.message) : encodeFailure(...)`.
So an `Error` carrying a non-empty message reaches the client as its **bare message**, and anything else
is JSON-encoded from the failure schema. My sentence asserted a false reason and hid the condition that
actually decides the payload. A reader following it would write a test that passes for the wrong reason
and break the day a handler fails with an `Error` instead of a schema value.

**Workaround:** none needed in the project — the e2e asserts the payload it actually observes, so it is
green either way. That is precisely why the false rule survived: the test encodes the observation, not
the rule.

**Proposed fix (docs):** replace the paragraph with the real branch, and turn it into an instruction:
pick which of the two contracts you want, produce a failure value of that shape deliberately, and
assert exactly the payload it produces. Never let the assertion be "whatever came back".

**Fixed in:** the stack. It now states the branch in one sentence ("an `Error` with a non-empty `message`
arrives as bare text; anything else is JSON from the schema") and ends with the instruction to choose
the shape, fail with it, and assert it. Verified after: validate 0/0/0, 42 registry tests, composed
brief 4,778 words.

**Superseded by DF-34:** the branch rule written here was itself wrong — the ordinary declared failure
never takes the branch it describes. Kept as written, because the mistake is the lesson.

## DF-33 — the MCP modules are namespaces, and the service tag is not the module name

**Symptom:** a builder that imported `McpClient` from `effect/ai` and wrote `yield* McpClient` failed
with "is not iterable": `effect/ai` re-exports these as namespaces, so the imported binding is the
namespace object, not the service tag. The tag is `McpClient.McpClient`; the layers
(`McpClient.layerStdio`, `McpServer.layerStdio`) and `McpProtocol.v2025_11_25` hang off the namespaces;
and only `effect/ai` and `effect/process` resolve — there is no `effect/ai/McpServer` deep path.

**Cause:** the brief names the modules and their capabilities and never their import shape.

**Fixed in:** the stack's Transport section, in the sentence that first names the modules: the namespace
form, the tag, the "is not iterable" signature, and the absent deep paths.

## DF-34 — the third correction of the same paragraph, and the reason I kept getting it wrong

**Attempted:** replace the false claim that a `Schema.TaggedError` is not an `Error` instance with a
"corrected" branch rule: an `Error` with a non-empty message arrives as bare text, anything else as JSON.

**Symptom:** the next build said the payload is JSON, the error is an `Error`, and my rule matched neither.
Observed twice under test: an ordinary declared failure returns `{isError: true, content:[{type:"text",
text:"{\"_tag\":...,\"message\":...}"}]}`.

**Cause — and this is the part worth keeping:** I verified a claim by reading one function and
generalising to a contract. `declaredFailureResult` (McpServer.js:1519) does contain that
`instanceof Error` branch, so the line exists and my reading of it was accurate. It is simply not on the
path a declared failure takes. The ordinary case returns at line 1563, which builds a `CallToolResult`
with the schema-encoded value regardless of Error-ness; line 1519 is only reached when a declared failure
is *raised as a cause*, which `failureMode: "return"` prevents by construction.

**The rule this yields:** a contract is the path a value actually takes, not the most plausible function
in the file. Tracing one branch and finding it consistent with the claim is not verification — it is
confirmation. Either run it, or trace every path that can reach the client.

**Fixed in:** the stack, from observation rather than reading: "A declared failure arrives as a text block
with the schema-encoded value `{"_tag":...,"message":...}`; a defect or undeclared throw arrives as a fixed
internal error message, not that value." The old text cost a builder a failing assertion twice.

**Still open:** the stack body now sits at exactly 2,000 words, the limit. There is no headroom for the
next correction, and `validate` cannot warn about a budget it has already reached.

## DF-35 — a stack built for a standalone project collides with the monorepo it is scaffolded into

**Attempted:** scaffold `packages/mcp` from the stack, in place (D-b).

**Symptom:** four of the brief's instructions were wrong for a workspace package, and the builder had to
choose the repository's convention over the stack's: `.node-version` and `.bun-version` (the root owns the
toolchain), a generated `tsconfig.json` (this repo extends `tsconfig.base.json`), `version: "0.1.0"` (the
package is 0.0.0 and private), and a `bin` entry (excluded by D-c). It also found that
`exactOptionalPropertyTypes` is *not* on in the root base config, so a trap the stack names was absent
here.

**Cause:** a stack is written as if it owns the repository root. That is true for `new` outside a repo
and false for every scaffold into an existing one, which is exactly the dogfooding case the plan
prescribes.

**Proposed fix (docs):** the stack's Setup section states which settings belong to the project and which
belong to a host repository — toolchain pins, the tsconfig base, package identity — and says the host
wins. Better: `new` could detect a parent repository and pass that fact into the brief, which is the same
`needs_own_repo` knowledge it already has.

## DF-36 — two tools refuse to work at the boundary, and both are silent about it

**Symptom, first:** `new typescript-mcp packages/mcp` exits 2 with `TargetNotEmpty`, listing the
placeholder `README.md` and `package.json`. There is no merge flag. The plan's "scaffold in place" is only
true for an empty directory.

**Symptom, second:** OpenCode, launched in a repository, refuses to *read* anything outside it —
`permission requested: external_directory; auto-rejecting`. A stage plan that says "read the scaffold at
/Users/me/..." therefore produces a coder that lists its todos and stops, having done nothing, and exits
0.

**Cause:** both are correct policies enforced without a way to make progress from inside them. The
scaffold had to be copied into the package by hand (file placement, not code), and the stage plan had to
name only paths inside the working tree.

**Proposed fix (docs):** the run log and the plan both say that an in-repo scaffold needs an empty target
or a merge step, and that a stage plan may reference only paths inside the repository the coder is
launched in. For `new`, a `--merge` that reports which files it would keep, add and conflict — the
`agent-ops` fragment already has the concept for `AGENTS.md`.

## DF-37 — `Effect.either` is gone in Effect 4

**Symptom:** a builder reached for `Effect.either` to assert on the error channel in a test and found it
absent; the replacement is `Effect.flip`.

**Cause:** the stack and the `effect` fragment describe the module's shape from an earlier major in
places. The fragment already warns that API names shift, which is why this cost minutes rather than an
hour.

**Proposed fix (docs):** worth a line in the stack's Tests section, since a failure-path test is exactly
where a builder reaches for it.



---

## Rolling feature and bug list

Grouped by what it would take, not by when it was found. `Fixed in:` lines are added as work lands.

**Bugs**

- A phase file's dependency on a command is not checked against the code (DF-04, DF-05). *Partly
  addressed:* the 4.3 rewrite records what it verified and when.
- Plans assume the published package shape before 0.2 (DF-05, DF-09).
- A stack's prose can assert things the library does not support and `validate` cannot see it. Nine of
  the twelve findings from the first build run were stack-body claims that were plausible and wrong:
  `BunRuntime` in a Node stack, a `.node-version` nothing writes, an advertised list no client exposes,
  stderr the client discards, a fiber that never returns, a failure contract left implicit (DF-15 to
  DF-23). *Fixed in the entry:* all nine corrected. *Still open:* nothing checks the class.
- The `git-hooks` fragment never said how a commit-msg hook receives the message file, so a correct
  implementation of its prose rejected every commit; its own proof step passed anyway because it
  invoked the hook the one way that makes `$1` work (DF-28). *Fixed in the entry:* it names `{1}` and
  proves the hook with real commits. *Remaining:* the "drop both" wording points at a destructive reset
  (DF-31).

**Features**

- The acceptance trace is CLI-only (DF-08).
- `validate` should count findings per severity in its summary (DF-10).
- `list --json` could expose `needsOwnRepo`, and `new` could surface `needsOwnRepo` conflicts before
  composing (DF-11).
- A missing tool that a default fragment's *steps* need should be a decision in the brief, not an
  instruction the builder may not be able to follow (DF-13).
- `validate` should cross-check prose references against the composed entries: a path the body names
  against the fragment that writes it (`AGENTS.md`, `src/schemas.ts`). This is the single check that
  would have caught the two worst findings of the first build run (DF-16, DF-24).
- The composed brief should print the `node` and `bun` versions present at compose time, since it asks
  the builder to pin them (DF-26).
- Brief budgets are shared: every stack composing a fragment pays for its words, and nothing shows the
  headroom. `validate` could report the tightest stack and its margin, so the cost of editing a shared
  fragment is visible before the edit (DF-30).

**Docs**

- Ship 3.1b's authoring guide, or point `guide` at the authoring contract (DF-01, DF-02).
- Show the direct `bun packages/cli/src/bin.ts` invocation next to `bun run dev` (DF-03).
- Say that a workspace dependency is not visible from a sibling package (DF-07).
- Say that an agent marker wins the handoff over `--json`, which only stops the launch (DF-12).
- Give the brief's non-standard dependency roles a legend, or rename `typescript: effect` (DF-14).
- A stack that requires `AGENTS.md` must compose the fragment that writes it (DF-24).
- Say in the authoring contract that a stack body describing a path must agree with every fragment it
  composes, because the fragment's rule wins and the reader has no way to know (DF-16).
- When a build instruction needs harness cooperation the project cannot assume (`AGENTS.md` under a
  guard), say to record the refusal rather than work around it (DF-25).
- Name the formatter's include-glob trap, or better, assert a non-zero file count in the verify script:
  a lint run that processes nothing is indistinguishable from a clean codebase (DF-27).
- Prove a git hook the way git fires it, and say never to `reset --hard` to tidy up the proof commits
  (DF-28, DF-31).

**Process**

- Stage plans are one bounded unit with a machine-checkable end state. An unbounded "build the whole
  brief" stage returns success-shaped output with the work half done (DF-29).
- Re-run the gate yourself. Never infer a project's state from a coder's exit code, and never accept its
  stated reason for an edit without measuring the thing it cites (DF-29, DF-30).
- A contract is the path a value actually takes. Reading one function and finding it consistent with the
  claim is confirmation, not verification — the same paragraph was wrong three times this way, and the
  only thing that settled it was a test observing the payload (DF-34).
- Two boundaries are silent: `new` refuses a non-empty target with no merge step, and a coder launched in
  a repository cannot read outside it — it lists its plan, does nothing, and exits 0 (DF-36).
- The wizard is not an interview. It prompts each flag in declaration order, so a user answers the
  fragment questions before being asked which stack, and the stack itself is a free-text field with no
  list and no validation (DF-38). Anyone opening `new --wizard` to build an MCP server has no way to
  discover that `typescript-mcp` exists.

## DF-38 — the interactive wizard cannot show you what you can build

**Attempted:** `new --wizard`, answering each prompt as the product owner would.

**Symptom:** eight prompts before the first useful question, and the useful one is bare. The order is
`--with` count, `--without` count, `sandbox`, `yes`, `agents` count then each value, `scope`,
`launch`, `--no-launch` twice, then `Stack ›` with no list, then `Dir ›`, then a final
`Run this command? yes / no`. The stack field is an `Argument.String`, so the wizard can only ask for
free text: it does not print the nine stacks, does not offer them, and does not reject an unknown id
until the command runs. Its own description says "(see `list stacks`)" — advice a person inside a
wizard cannot follow.

**Why it matters:** the user who asked for this run wanted an MCP server. `typescript-mcp` is
registered and appears in `list --json`, but nothing in the interactive path reveals that, so the
correct answer had to come from the operator's memory rather than the tool.

**Proposed fix (feature):** prompt the stack as a choice built from the registry, each option showing
id and name, with the free-text field as a fallback for an unregistered path; and validate at prompt
time. Same for fragments, once the stack is known. Sequence should be stack first, then the questions
that only make sense for that stack — fragments now arrive before the stack, which is backwards.

## DF-39 — the wizard asks boolean flags twice, and offers contradictory pairs

**Symptom:** `Set No launch (--no-launch)? › (y/N)`, answered yes, is followed by
`No launch (--no-launch) › (t/F)`. The same flag is asked once as presence and once as value. Both
`--launch` and `--no-launch` are offered in the same wizard even though the CLI documents them as
mutually exclusive.

**Cause:** the wizard is generic over flag definitions; a boolean flag with a default and a negated
twin has no single sensible prompt, and nothing special-cases it.

**Proposed fix (feature):** one prompt per flag, the negated twin rendered as the "no" answer to it.

## DF-40 — a per-call test passes while the success path is broken

**Attempted:** a loop test through the MCP server: list, then new, then verify that new project.

**Symptom:** the schemas in `packages/mcp` disagreed with the CLI's JSON on four fields — `git` is an
enum not a boolean, `missingTools`/`untrusted`/`warnings` hold structs not strings, `handoff` is a
union with a `reason`, and `exitCode` is absent on a skipped step. Every tool call in the earlier
handshake test had been to the failure path (a bogus stack), so none of it had ever been encoded.

**Cause:** the failure path short-circuits before the success schema is ever applied. One test of the
happy path would have found it; the suite had none.

**Fixed in:** stage C2/D, `packages/mcp`. Worth generalising: a tool surface needs one test per tool
that succeeds, not one test that proves the tools exist.

## DF-41 — two OpenCode runs into an unfinished project produced no code

**Attempted:** build the project scaffolded from the stack at `quickstacks-projects/served1/app2`.

**Symptom:** run one wrote `package.json`, installed dependencies, wrote `docs/harness.md`, then died
on `external_directory` for a path it invented (`/Users/me/quickstacks-paths/...`). Run two, a
continuation scoped to the missing files, exited 0 having only printed `node -v`, `bun -v` and
`git log`. The project still has no `src/`, and `verify` reports eight failing steps.

**Not yet explained:** neither run's transcript shows a refusal or an error for run two. Recorded as
open rather than diagnosed, because the stage is being parked.

**Proposed fix (process):** when a project run ends without touching its target files, re-issue the
same work in the foreground so the transcript is observable, rather than a second background run.

