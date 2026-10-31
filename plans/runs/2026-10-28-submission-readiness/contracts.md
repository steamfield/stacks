# R1 search and guidance

Landed on quickstack main with R1's merge. The guide, `stacks guide` and the help footer teach one
loop: `search`, `show`, `new`, `verify`, then `verify --all` before calling it done. A no-match
search prints `Next: stacks list stacks` and `Next: stacks search "<fewer, broader words>"`; the
broader-words line is left out for `--local`. The human lead in the guide tells a person to start
with `search` and `new`.

## Checks

Scoped tests (`guide`, `help`, `search-api-ux`, `audience`, `human-script`) passed, and the gate
passed after the merge.

From source, fresh `HOME`, 2026-10-28:

```text
$ STACKS_OFFLINE=1 bun run dev search "python api with a react dashboard"
Ranked locally: offline.

stack python-react (strong)
A browser app backed by a Python API, with generated frontend types, query hooks and test mocks.
...
Evidence: last run 2026-10-28: pass

$ STACKS_OFFLINE=1 bun run dev search '!!!'
Nothing matched.

Next: stacks list stacks
Next: stacks search "<fewer, broader words>"
```

The local QA pass ran the release build (`node dist/stacks`): the guide teaches the loop, `search
'!!!'` printed both `Next:` lines, and the local-fallback line showed when the API was
unreachable. A release build ignores `STACKS_DEV_API_URL`, so the API-ranked check runs against
production after the R5 deploy (`release.md`).

## Fresh agent

A fresh Codex agent given only the one-line request ("a Python API with a React dashboard") in an
empty directory ran `stacks search`, picked `python-react`, and named its tradeoff: two language
toolchains and generated-client maintenance.
