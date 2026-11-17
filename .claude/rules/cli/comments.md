---
paths:
  - "packages/cli/src/**"
---

# Comments in the CLI source

Comments carry what the code can't: why a shape is the way it is, an invariant, a trust point. They don't retell the code or map the repository.

- Cite symbols, not paths: `openProject`, `errors.ts::errorTable` only where the bare name is ambiguous. AGENTS.md's architecture map is the one path index, so a file move never has to edit comments.
- A file header is one to three sentences: what the file owns, and the reason for any non-obvious shape. No caller lists, no "start at", no restated flow.
- Define a term once, in `packages/cli/src/README.md` (the glossary and a one-screen map). Don't repeat its definition where it's used. Folders get no README of their own.
- State a policy once, at the code that enforces it (keeps-result, the signal policy, the tamper check, the trust points in `.claude/rules/architecture.md`). Elsewhere, name that symbol.
- Keep every non-obvious why, every trust-point citation and every invariant comment when trimming. Remove retellings, caller lists and glossary repeats.

`plans/build-cli-readability.md` records the earlier header-and-README standard as history; this rule supersedes it.
