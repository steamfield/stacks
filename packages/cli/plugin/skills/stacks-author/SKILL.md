---
name: stacks-author
description: Create, convert or submit a stacks entry. Use when the user wants to make a stack or fragment, turn an existing repo into a stack, write a reusable project template or recipe for coding agents, add a capability (CI, auth, a database, an app) as a fragment, write a search card, or submit an entry to the public stacks registry.
---

# stacks-author

A stack is a recipe for a new project: dependencies by role, starter files, agent guidance and verify steps that define done. A fragment adds one capability to a stack. You write the entry; an agent later builds a project from its brief with current versions.

Use `stacks` on PATH, otherwise `npx -y @steamfield/stacks@latest`; `<cli>` means that command. If a command or flag named here is missing, run `<cli> --version`, tell the user this skill needs a newer stacks, and ask them to run `<cli> update`.

## Anatomy

```text
<id>/
  STACK.md            frontmatter + guidance (FRAGMENT.md for a fragment)
  files/              stable starter files; *.tmpl takes {{project_name}} and a few other variables
  adapters/claude/    files only Claude Code targets get (also codex/, opencode/, cursor/)
search/stacks/<id>.json   the search card, beside the entry directories
```

- **Frontmatter**: `id`, `name`, `description`, `tags` (exactly one of `make` or `scripts`), `deps` as package names by role (never versions), `tools`, `commands` (every command verify uses), `verify` steps with a `layer` (install, lint, typecheck, test, and a `serve` probe for `web` or `api`), `decisions` each with `(default: ...)`, and `fragments` (required, default, optional).
- **Body**: Layout, numbered Setup, Conventions, Tool configuration, Testing, Commands, Gotchas.
- **Fragment**: adds `category`, `applies_to`, `requires`, `conflicts`, `requires_tools`, and a body that says what to add plus the `AGENTS.md` section the project gets. An app is a fragment with `category: app`.

**Durable, not stale.** Anything that would be wrong after the next major release (versions, generator flags, config file formats) goes in prose as a rule or a discovery step against current official docs, never in `files/`.

Full format: `references/anatomy.md`.

## Workflow

1. **Search first.** Run `<cli> search "<what the user wants>" --json` and read the closest hits with `<cli> show <id> --json`. If an existing stack plus fragments covers the need, recommend that and stop unless the user still wants a new entry.
2. **Stack or fragment.** Something that differs from an existing stack only in CI, deployment or one tool is a fragment. See `references/fragment.md`.
3. **Pick the route.** Converting a repo the user has: `references/from-repo.md`. Designing from scratch: `references/interview.md`. Both end with a summary the user approves before you write anything.
4. **Create the skeleton.** `<cli> create stack <id> --json` or `<cli> create fragment <id> --category <category> --json`. The result's `path` is the entry directory in the user registry. Choose the id with care: see the hard rules.
5. **Fill it in** per `references/anatomy.md`. Replace every `stacks:fill` marker. Write the search card per `references/search-card.md`.
6. **Validate.** Run `<cli> validate <path> --json` and fix every error and warning at its source. Preview the brief with `<cli> validate <registry-root> --brief <stack> --sandbox`.
7. **Prove it.** `<cli> new <id> <empty-tmp-dir> --sandbox --json`, then build the project yourself from `.stacks/BRIEF.md` and run `<cli> verify` until the outcome is `green`. Fix the entry wherever the brief misled you (see `.stacks/NOTES.md`), then prove it again in a fresh directory.
8. **Submit, if the user wants it public.** `references/submit.md`. Run `<cli> validate <path> --submission` and `<cli> submit <path> --dry-run` first, and get the user's yes before the real `submit`.

## Hard rules

- **No versions.** Not in `deps`, not in shipped config, not in prose outside fenced examples. Tell the building agent how to find the current version instead.
- **Ids are permanent** once published. A rename breaks stats, search judgments and older projects. Settle it with the user before `create`.
- **Never weaken verify.** When the proof run fails, fix the entry's guidance or files, not the step. Each step must prove a deliverable: a serve probe for anything that serves, a smoke run for a CLI, a build for anything that ships an artifact.
- **The CLI runs nothing from an entry.** Ship no generator, install script or hook that you expect `new` or `add` to execute. The building agent runs tools; the brief tells it how.
- **Nothing private ships.** No secrets, `.env` files, absolute paths, usernames or product names. Use `{{project_name}}` and the other template variables.
- **Claims match files.** Every claim in `description`, `deps`, decisions, body and card must hold for what `files/`, `adapters/` and `verify` actually ship.
