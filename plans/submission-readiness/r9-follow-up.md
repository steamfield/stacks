# R9. After submission

Nothing here blocks the submission. Start an item when its condition holds; give larger
ones their own plan and link it here.

| Pri | Work | Start condition | Exit |
| --- | --- | --- | --- |
| P1 | Wider library proof | After R6 | The other bundled stacks proven with R3's procedure |
| P1 | Stats acceptance tests (4.2f, 4.2c, 4.2b tests 10-11) | After R6 | `stats.spec.ts` and fixtures from `delegate/t-4.2f` (`0b6c6e5`) brought onto `main`, updated for the redesign, green; phases marked `EXECUTED` |
| P1 | Live telemetry launch (was R8; phases 4.1e, 4.2d) | After judging; allowlist reviewed; alert destination chosen | `stacks-api/apps/api/README.md` "Telemetry launch" completed; replaces the demo store, so never before judging ends |
| P1 | Search evidence: content match (`sameContent`) in search, proof bonus only for current runs | After R6 | Format release; local search and the index agree on which runs count as current |
| P1 | API search `BadInput` details and OpenAPI constraints; CLI no backoff on 400 | After R6 | Actionable 400s without echoing `q`; a rejected query doesn't disable remote search for 10 minutes |
| P1 | Production restore procedure | Before real telemetry | A tested inverse of `prod:seed`'s backup |
| P1 | Search judgments review (4.5a) | User time | The 47 judgments reviewed |
| P1 | Real `stacks update` (4.4d); Codex link and Copilot marker (4.4c) | Next patch release | Checked by hand |
| P1 | Worktree and branch cleanup | After R6 | The user removes what R0 listed as superseded |
| P2 | Signed remote-only recipe distribution (was R7; 4.0c, 4.0d) | The catalog needs to grow faster than CLI releases | Signing-key decision, `officialUrl` in `bin.ts`, refusal tests |
| P2 | CI release, scheduled canary, CI index build (5.0, 5.1, 5.2) | The user agrees the phases | Per phase file |
| P2 | Dependency decision cohorts, community sources, embeddings (4.5d), MCP (4.3), Workers (4.0f) | Their own start conditions | Per phase file or spec |
