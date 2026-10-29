# Architecture

Load the `ce:architecting-systems` skill before designing or changing a module, service, package boundary, schema or shared contract, and before executing a design or task across several units. Its Structure, Coupling and Boundaries references matter most here. Load Concurrency as well when touching signal handling or the Processes service, and Observability when touching logging. The skill comes from the `claude-essentials` marketplace (`ce` plugin); an agent without it should read the constraints below and continue.

The skill gives general structure. This rule carries the constraints it can't know, which come from the product rather than from code. AGENTS.md "Architecture map" and "Conventions" cover the per-file layout and service style; don't repeat them in a design.

## Product constraints

The CLI executes nothing it reads and never calls an LLM. `list`, `show`, `new`, `add`, `validate` and `create` read, compose and write entries; only `verify` runs commands, and only the steps in the project's own manifest. The CLI's other programs are fixed and never come from an entry: constant git commands (`scaffold/git.ts`: `git init` from `new`, read-only lookups from `new` and `add`), the harness chosen at handoff through `Processes.interactive` or `Processes.exec` (never for an untrusted entry), and `update`, which makes one request to the npm registry and calls `npm` with fixed arguments and a checked version, only when a person runs it. A design that runs a generator, an install script or a hook from an entry is wrong, however convenient.

Humans own what lasts and agents own what ages. Composition, layout, enforcement and the definition of done belong in stacks and in the CLI. Versions, generator flags and config formats belong to the agent. A feature that pins a version or freezes a config format in the CLI or in `files/` is drifting toward a template engine, which the product says it isn't.

## Trust model

Code comments cite these points by number.

1. The CLI executes nothing it reads, as above.
2. Trust comes from where an entry was found (`core/registry/registry.ts::trustOf`): project entries and entries from a bundled root overridden by `STACKS_REGISTRY_DIR` are untrusted; user entries and the shipped bundled ones are trusted. Index entries are trusted only from the official index URL (`core/registry/remote.ts`), so a configured `STACKS_INDEX_URL` is untrusted.
3. An untrusted entry never launches an agent or reaches the handoff picker (`core/handoff.ts::decideHandoff`), and copying or adding one needs a person to accept it.
4. A confirmation needs a person: under a detected agent or without a terminal on stdin the CLI never prompts or accepts on someone's behalf (`verify --accept-changes` exits 6, an untrusted `add` keeps the previous digest baseline).
5. `verify` checks the manifest's step digest against the project's state record before any step runs (`core/verify/tamper.ts::checkTamper`); changed steps run nothing until a person accepts them.

## Package boundaries

Code two packages share goes in its own package under `packages/`, extracted when the second package needs it and not before. Never import from another package's `src/`.

## Shared contracts

The wire contracts the CLI, the hosted API and published tooling share (entry format, manifest, run record, canonical bundle, index, search and stats schemas) are owned by `packages/format/src` and exported from its `index.ts`; the CLI imports them from `@steamfield/stacks-format` and never redefines or re-exports one. Error tags are owned by `packages/cli/src/errors.ts`: a new tag adds its class to `errorClasses` and its row to `errorTable`. A design cites an existing contract by its symbol and never renames or reshapes it; a change to one is additive (`.claude/rules/format/format.md`) and lands with the code that needs it.

## Designs

A design or task description cites symbols, never line numbers (`errors.ts::exitCode`, not `errors.ts:49`). It is a hypothesis: verify a claim against the code before building on it, and when the code shows it wrong, tell the person who gave it rather than silently doing something else.

## When a fix doesn't take

Load `ce:systematic-debugging`. AGENTS.md "Debugging" already sets the stop rule after two failed fixes.
