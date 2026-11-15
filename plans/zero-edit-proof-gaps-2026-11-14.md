# Zero-edit proof gaps

Status: DRAFT 2026-11-14

## Problem

`bun run prove <stack>` proves a stack without an agent: scaffold, the brief's install command, then `verify` (D42). Three of the four canaries in `registry/canaries.json` can't pass it, so a change to shared fragments still needs agent runs for them, and every harness change brings the bench back for those ecosystems.

Scaffold proofs run on 2026-11-14:

| Stack | Result | Why |
| --- | --- | --- |
| typescript-library | pass | |
| typescript-mcp | pass | |
| react-vite | pass | |
| python-cli | fail: `test` | The template ships `src/package_name/`, which the agent renames to the project's package. `uv add` now installs the deps (`render.ts::installCommands`), but the tests import a package that doesn't exist yet. |
| go-cli | fail: `install` | There's no `go.mod`. `go mod init <module path>` comes first, and the module path is a decision the brief doesn't make. |
| rust-cli | fail: `clippy`, `check`, `test`, `build`, `smoke` | Step 1 has no install command. `cargo add` would be contained, but the code needs crate features (`clap` `derive`, `tracing-subscriber` `env-filter,json`) that the deps list doesn't declare. |
| typescript-cli | fail: `effect-api-reference` | The check expects `docs/guidance/effect/api.md`, which the agent writes. |

Most other TypeScript stacks fail in the same way: their templates leave files or names for the agent to fill.

## Options

1. **Declare what the install needs, in the stack.** Add crate features to the deps declaration (for example a `features` list on a dep), and give Go stacks a fixed module path in the scaffold (`example.com/<project>`, renamed later). The brief then generates `go mod init` and `cargo add --features`. This changes stack content and fingerprints, so every changed stack needs a fresh proof once.
2. **Ship the files the agent would write.** Commit `go.mod`, a `Cargo.toml` with dependencies, and a package named after a fixed placeholder that the templates render with the project name, so a scaffold builds as is. This is closest to "zero edit", but it pins versions in shipped files, which the registry avoids (stacks are versionless).
3. **Prove canaries with a scripted fixup.** `prove` runs a per-stack script (rename the package, `go mod init`, write the Effect API doc) before verify. It's cheap, but it proves the fixup script rather than the brief.

Option 1 keeps stacks versionless and puts the decision in the stack, where an agent would otherwise make it. Option 2 conflicts with the versionless rule. Option 3 is a workaround.

## Open questions

- Does a module path or a feature list count as a version decision? Features aren't versions, but some only exist in some major versions.
- Should the canary set change instead? A TypeScript stack that passes zero-edit proves the shared harness fragments for TypeScript only. Python, Go and Rust each need a canary that passes, or the canary note stays an agent run.
