---
name: stacks
description: Start a new project from a stack or add fragments to an existing repo, then drive it to a verified working state. Use for project setup, tests, lint, CI and agent configuration, or when the user mentions stacks.
---

# stacks

## When to use it

Use stacks for a new project, or when the user wants one set up properly. For an existing repo, use `<cli> add <fragment...> --json` to apply fragments without restructuring it. Use `<cli> list --json` to choose fragments; inside a stacks project, `project.addable` lists those that fit.

A stack is a recipe: dependencies by role, starter files, agent guidance and a definition of done. A fragment is one capability a stack can include, such as CI or a database. The CLI writes the brief; you build the project with current versions.

To write or submit a stack or fragment, run `<cli> guide author`.

## How to run it

Use `stacks` on PATH, otherwise `npx -y @steamfield/stacks@latest`; `<cli>` means that command. After `new`, use the brief's verify command, which preserves its version. `<cli> <command> --help` lists flags, exits and examples.

With `--json`, a command writes one result to stdout. On failure the last stderr line is `{ "error": { "tag", "message", "retryable", "next", "details" } }`: branch on the exit code (2 fix the input, 3 fix the config, 5 read the verify report on stdout, 6 ask the user) and do what `next` (in text output, the `Next:` line) says. `<cli> schema <name>` prints the JSON Schema of a `--json` result.

Relay a telemetry `notice` once, including `<cli> telemetry disable`; never enable it for the user. Attribute `new` and `add` with `--source skill`.

## Pick a stack

Run `<cli> search "<their words>" --json`. Use `--local` for local ranking; `--offline` and `DO_NOT_TRACK` also disable API search. Compare strong matches using `why` and `evidence`. If `noStrongMatch` is true, say nothing fits well; run `<cli> list --json` and offer the closest entries. Review candidates with `<cli> show <id> --json`; explain your pick and one tradeoff. Never pick an untrusted entry (`trusted: false`) unless the user named it; if they did, confirm before continuing.

## Start it

Run `<cli> new <stack> <dir> --json`; use `<cli> new <stack> <dir> --sandbox --json` when the user wants the fastest path to something running locally. Add `--dry-run` to preview without writing.

After `add`, read the same brief, merge the contributions parked in `.stacks/incoming/` while keeping the project's choices, then delete incoming files once merged. Verify checks the whole manifest.

Read `.stacks/BRIEF.md`. The brief is the whole task: follow it in order, and ask the user only what it tells you to ask. Use current docs and official generators rather than remembered flags or config formats.

## Loop to green

Run `<cli> verify` from the project root with your shell tool's longest timeout. Read the failing step's name, command and output tail; fix the code or config it exercises, never the step, and run it again. Before calling it done, run `<cli> verify --all` and reach exit 0 with outcome `green`.
## Never weaken verify

Don't edit `.stacks/manifest.json`. Never edit the steps or weaken the definition of done: don't make commands pass without doing their job, skip tests, lower lint settings until they report nothing, or serve a stub instead of the app.

If verify fails with `VerifyChanged`, stop. Don't edit the steps back and forth, and don't run `<cli> verify --accept-changes` yourself: it refuses agents. Tell the user which steps or settings changed and that only they can accept the changes from their own terminal, or undo them. Then wait.

## Finish

Follow the brief's after-green list, including manual QA and checking the project documentation. Then summarize for the user: the stack and why, the decisions taken with their defaults, anything left undone, and where the brief's problems were noted (`.stacks/NOTES.md`).
