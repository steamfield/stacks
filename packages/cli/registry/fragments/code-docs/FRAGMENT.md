---
schema_version: 1
id: code-docs
kind: fragment
category: tooling
name: File headers and architecture READMEs
description: Source-file documentation checks for TypeScript, JavaScript, Python, Go and Rust, with guidance for writing folder READMEs that explain architectural responsibilities and reading order.
tags: [documentation, readability]
applies_to: []
requires: [agent-ops]
tools: [bash]
verify:
  - name: file-headers
    layer: check
    tags: [hygiene]
    run: bash scripts/check-file-headers.sh
---

# File headers and architecture READMEs

Start every source file with a file-level doc comment in its language's convention. Explain what the file does and how it fits the surrounding system in a few sentences. Put required shebangs, encoding declarations and build directives first. Keep the header current when the file's responsibility changes. See `docs/guidance/engineering/code-style.md` for the conventions.

Give a folder a `README.md` when it represents a meaningful unit of the architecture. Say what it owns, how it fits the system, what it depends on and where to start reading. Use judgment: skip fixtures, generated output and a folder with one obvious file. Avoid repeating the parent guide.

The `file-headers` hygiene step checks source under `src/`, `scripts/` and `tests/`, excluding generated code and fixtures. It reports each missing header; it does not judge the explanation or require folder READMEs.

## AGENTS.md

Document `bash scripts/check-file-headers.sh` under Commands and link the code-style guidance from Conventions.
