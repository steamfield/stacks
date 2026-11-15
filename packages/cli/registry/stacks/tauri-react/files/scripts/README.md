# Architecture checks

[architecture/crate-edges.json](architecture/crate-edges.json) lists workspace crates
and permitted normal and development path dependencies.
[architecture/crate-edges.jq](architecture/crate-edges.jq) compares Cargo metadata
against that policy and rejects unknown members or forbidden edges.

Start with the JSON policy when adding a crate, then read the jq check.
`make architecture-check` runs it without compiling the application. The shell
depends on the domain core; new edges need an explicit ownership decision.

When present, `check-file-headers.sh` is the hygiene check for source documentation
under `src/`, `scripts/` and `tests/`.
