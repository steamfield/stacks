# Converting a repo into a stack

The user has a working project and wants others (or their future self) to start new projects the same way. Your job is to pull out the reusable recipe and leave the product behind. The entry you write describes how to build a project like this one from an empty directory; it is not a copy of the repo.

Search first (`<cli> search "<what the repo is>" --json`). If a bundled stack already matches the repo's shape, the user may only need a fragment for what differs.

## What to read

Read these before you ask anything, so your questions are specific:

| Source | What it tells you |
| --- | --- |
| Manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`) and lockfiles | Language, runtime, package manager, the dependencies that matter |
| Scripts, `Makefile`, `justfile`, task runner config | The project's commands, and which runner the stack tags (`make` or `scripts`) |
| Lint, format and typecheck config | The bar the code is held to |
| Test config and the test tree | Test runner, layers (unit, integration, end to end), coverage floors |
| CI workflows | The full check a change must pass, and which steps are deploy or release |
| Dev server and build config | Ports, the serve command, what the build produces |
| `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`, `.codex/`, `.opencode/` | Agent guidance and settings worth carrying over |
| README and docs | Conventions the team states, and the gotchas they hit |
| The source tree | Layout and the conventions the code follows in practice |

Don't read `.env` files or anything that looks like a credential store.

## Separate the stack from the product

A repo mixes a reusable foundation with one product built on it. Sort what you found into three piles and show the user:

- **Stack**: layout, tooling, conventions, the test bar, the commands, agent setup.
- **Fragments**: pieces someone would add or drop on their own, such as CI, deployment, a database or auth. Check `<cli> search "<capability>" --kind fragment --json` before writing a new one; an existing fragment is usually better.
- **Product**: domain code, business rules, branding, the specific pages or endpoints. Leave it out. At most, one feature can survive as an example in Setup that proves the wiring works ("add one real command that exercises config and output").

Ask the user which pile each unclear item belongs in, in a round of at most five questions, each with your recommended answer. Then write a one-paragraph summary of the stack, list each verify step with its command, and get the user's yes before running `<cli> create`.

## How to map what you found

| In the repo | In the entry |
| --- | --- |
| Scripts or make targets for install, lint, typecheck, test, build, dev | `commands`, and a `verify` step for each with its `layer` |
| The dev server | A `serve` step with an `expect` probe on a localhost URL, and its port in `env` |
| A CLI's entry point | A smoke step that runs `--help` or `--version` on the built binary |
| Pinned dependencies | `deps` grouped by role (`app`, `dev`, `test`, `cli`), names only. Keep the ones that define the stack; drop transitive and incidental ones |
| Runtime and tool versions (`.nvmrc`, `go.mod`'s `go` line, `.python-version`) | A decision or Setup step: "use the current LTS, recorded in `.node-version`" |
| Files that stay correct across releases (`.gitignore`, `.editorconfig`, shared scripts, hook code, a Makefile) | `files/`, with `.tmpl` and `{{project_name}}` where the project name appears |
| Config whose format depends on the tool version (linter configs, framework config, CI action pins) | Requirements in Tool configuration, so the agent writes it for the installed version |
| Generators the project was started from | A Setup step telling the agent to read the generator's current help and run it non-interactively |
| CI | Usually the `ci-github` fragment as a default, plus `stacks:when with=ci-github` notes in the body |
| Agent config | `adapters/claude/`, `adapters/codex/` and so on, with commands rewritten to the declared ones. Shared JSON goes in `merge` |
| Choices the repo made that another project might make differently | `decisions`, each with the repo's choice as `(default: ...)` |
| Lessons in the README, comments, or commit history | Gotchas |

## Strip what's private

Before validating, go through every file you're shipping:

- Secrets, tokens and keys: remove them. Ship a `.env.example` with placeholder values if the project needs env vars, and never a `.env`.
- Absolute paths (`/Users/...`, `/home/...`, `C:\`): replace with paths relative to the project root.
- The project's name, the company's name, usernames, internal hostnames and URLs: replace with `{{project_name}}`, `{{project_slug}}`, `{{package_scope}}` or generic wording.
- Internal package registries, private dependencies and anything the public can't install: drop or replace with a public equivalent, and tell the user.

`<cli> validate <entry-dir> --submission` checks for leftover fill markers, credential-shaped strings, `.env` files and absolute paths. It matches patterns, so it misses things; do your own pass first.

## Finish

1. `<cli> validate <entry-dir> --submission --json` with no errors, and every warning either fixed or one that `references/submit.md` says maintainers clear.
2. `<cli> new <id> <empty-tmp-dir> --sandbox --json`, build from `.stacks/BRIEF.md`, and run `<cli> verify` until green.
3. Compare the sandbox project with the original repo: layout, commands, lint and test bar, agent files. Tell the user what differs and whether each difference is intended (product code left out) or a gap in the entry. Fix the gaps and prove it again in a fresh directory.
