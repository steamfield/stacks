# Prove it from a fresh scaffold

Read this before handing back a new stack, a converted stack, or any change to a stack's `files/`, Setup or verify steps.

The bar is the one `go-cli` and `typescript-api` met: a fresh scaffold, built only by following the brief, reaches a green `verify`.

1. Build the CLI from the repo root (`bun run build`), then scaffold into an empty directory outside the checkout: `XDG_CONFIG_HOME=<empty temp dir> node packages/cli/dist/stacks new <id> <dir> --sandbox --no-launch`. The built CLI reads the working `packages/cli/registry`; the temporary config home keeps a personal copy of the id in the user registry from shadowing the bundled one.
2. In that directory, follow `.stacks/BRIEF.md` the way the building agent would: add the declared deps (current releases), run each check, and fix only what Setup says the agent fixes.
3. Run `node <checkout>/packages/cli/dist/stacks verify` there until it exits 0 with outcome `green`, then once with `--all` so the steps the sandbox preset skips (tagged `prod`) are proven too. Record each step's result. For a stack with database steps, start Docker first (`docker info` must succeed).
4. Anything you had to change in a shipped file, and any brief step that misled you, goes back into `files/` or `STACK.md`. Then prove again in a new empty directory. Changes to `files/` are read from the registry at runtime and need no rebuild; changes to CLI code do.

This local proof isn't a bench run. The hand-back lists `bun run bench <id> --agent claude` as a pending maintainer action, and notes that edits stale any `runs.json` record for the stack.
