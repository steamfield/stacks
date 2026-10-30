# Fragments and apps

A fragment adds one capability to a stack: CI, a database, auth, release tooling, agent guardrails, or a whole app (`category: app`). People find fragments by asking for the capability ("add auth", "github actions ci").

## Stack or fragment

Write a fragment when the thing is a capability someone would add or remove on its own, or when it would differ from an existing stack only in CI, deployment or one tool. Write a stack when it's the base of a new project.

Search for overlap before writing: `<cli> search "<capability>" --kind fragment --json`, then read the closest two with `<cli> show <id> --kind fragment`. Extend an existing fragment's coverage by proposing a change to it when the new one would share most of its files.

Settle these with the user, in a round of at most five questions with your recommended answers:

- which stacks it fits, and whether by stack id or by tag
- what proves it works (its verify step)
- pieces the capability usually needs (a test stub, migrations, env config, a CI step, adapters for other agents)
- whether part of it is a separate fragment
- the id, with two or three candidates

Create it with `<cli> create fragment <id> --category <category> --json`.

## Frontmatter a fragment adds

| Key | What goes in it |
| --- | --- |
| `category` | `agent-ops`, `app`, `ci`, `deploy`, `release`, `service`, `vendor` or `tooling` |
| `applies_to` | Stack ids or tags the fragment fits. Empty means any stack. An app must name at least one |
| `requires` | Fragments that must come with it |
| `conflicts` | Fragments it can't be combined with |
| `requires_tools` | Programs it can't work without. The warning names the `--without` flag that avoids it |
| `needs_own_repo` | `true` when the fragment must sit at the root of its own git repository (CI does) |

It shares every other key with a stack (`references/anatomy.md`). It has no `fragments` key.

## Scope decides everything

`applies_to`, `requires` and `requires_tools` decide where `add` accepts the fragment. Write the body, `deps` and search card for exactly that scope: Go and TypeScript branches in a body whose `applies_to` names one Python stack are prose nobody reaches.

When you target stacks by tag, compose the brief with each stack the tag admits and read the result:

```sh
<cli> validate ~/.config/stacks --brief <stack> --with <id> --sandbox
```

Where one stack needs different instructions, add a branch:

```md
<!-- stacks:when stack=python-api -->
Add the db-test service to the existing compose file.
<!-- stacks:end -->
```

`tag=` and `tag!=` branches (`tag=make`, `tag=scripts`, `tag=bun`) keep one body working across task runners and runtimes.

## The body

Follow the skeleton's sections:

- **What to add**: the files and changes, as instructions for the building agent.
- **Tool configuration**: what the tool must enforce, written for the installed version.
- **Verify**: what the fragment's verify step checks.
- **AGENTS.md**: the section the project's `AGENTS.md` gets, so later agents know the capability exists and how to use it.

Give the fragment a verify step that checks its own deliverable: its config is valid, its command runs, its service comes up. Services that start and stop use `setup` and `teardown` phases (`make db-up`, `make db-down`). Declare every command verify calls in `commands`. Keep the body under 1,000 words.

## Apps

An app is a fragment with `category: app` that builds a product on a stack, such as a chat app on `react-router`. It names its host stacks in `applies_to` and usually `requires` the fragments it builds on. Its body uses What to build, Features and Acceptance tests, within 3,000 words. Its verify steps prove the app works end to end (an acceptance test, a browser flow against a stub). The CLI runs an app's steps after the stack's own steps pass.

## Id and description

- The id names the capability or the tool's public name: `goreleaser`, `posthog`, `postgres`, `ci-github`. A generic word must not promise something that doesn't ship.
- Siblings read as a family: a base id plus a suffix per surface (`openrouter-chat`, `openrouter-chat-cli`).
- When `applies_to` is narrow, the `name` says so ("PostgreSQL with SQLAlchemy for Python"), because lists show the name without the description.
- The `description` opens with what it is and what it plugs into, then names the main pieces. One or two sentences. Name every agent adapter and surface it ships; don't overclaim.

## Prove it

```sh
<cli> new <stack> <empty-tmp-dir> --with <id> --sandbox --json
```

Build from `.stacks/BRIEF.md` and run `<cli> verify` until green, on each stack the fragment fits (or a representative one when `applies_to` is empty). For a fragment meant for existing repos, also try `<cli> add <id> --json` in a copy of a stack project and merge what it parks in `.stacks/incoming/`.
