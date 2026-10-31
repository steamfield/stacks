# R3 recipe proof: python-react, sandbox (2026-10-28)

## Procedure

From `packages/cli` in a quickstack worktree, `bun run pack` (candidate 0.3.1 tarball, sha256
`7e9e32a55e5b405228e77b7bec1e4ff7bf281218046e78655a1ca626b1014f5e` at `997216f`; R5 repacks at
0.4.0), then for each attempt:

```sh
bun run build
bun run bench python-react --preset sandbox --cli dist/stacks --keep --agent codex --model gpt-6.1-terra
```

The bench used the host's Codex login (the run note's Credentials row says `codex login`), codex-cli
0.165.0, model `gpt-6.1-terra`. Package caches were warm (this machine had built python-react
projects before).

## Attempts

| # | Commit | Result | Agent minutes | Interventions | Finding |
| --- | --- | --- | --- | --- | --- |
| 1 | `997216f` | pass, relabeled partial | 2.5 | 0 | Home route rendered `/health` through the generated hook, but the brief's home-route component test was missing. `verify` passed because `make test` didn't require it and route entries are excluded from coverage. Recipe fix: a `home-route-test` verify step running `app/routes/home.test.tsx`, named in the brief |
| 2 | `cbba4c2` | fail | 1.4 | 2 | The brief said to delete uv's stub script; the shipped command guard refused the removal and the agent stopped, as the project's guard rule says. Recipe fix: `uv init` writes no stub |
| 3 | `de89876` | pass | 2.1 | 0 | Counting run |

The notes for each are `plans/runs/2026-10-28-python-react.md`, `-2.md` and `-3.md`; all three
ledger records are kept, the newest is the proof.

## Run 3

- Scaffold to first green `verify`: 2.0 minutes; one agent turn; 0 interventions; tamper check
  `full`.
- `verify --all --json` in the kept project, with the bench's own HOME and XDG paths: exit 0,
  outcome `green`, scope `full`, 15 required, 15 passed, 0 failed, 0 skipped (install,
  git-hooks-install, lint, typecheck, test, home-route-test, api-contract, build, the three
  fill checks, git-hooks-validate, git-hooks-configured, api, web). `build` is the production step
  plain `verify` skips under sandbox.
- Behavior check: `frontend/app/routes/home.tsx` calls `/health` through orval's generated hook
  (`useHealthHealth`) and renders the status. `frontend/app/routes/home.test.tsx`, test
  "shows API health", renders `Home` in a `QueryClientProvider` and asserts
  `await screen.findByText(/API status: ok/)`. The request goes through the generated client and
  the real fetcher to MSW's generated handlers, so it is an HTTP-level fake of the API, not a run
  against the Python server; the real round trip is exercised by verify's `api` and `web` serve
  steps and the recipe's Playwright smoke spec (`make e2e`, outside verify).

## Index proof

`bun run build:index --out <scratch>/r3-index --previous none --unsigned` (no
`--include-unproven`) at the ledger commit printed "Added stack/python-react: current default
composition proven (2026-10-28, sandbox, codex)". Its `lastRun`: date 2026-10-28, result pass,
agent codex, preset sandbox, `minutesToGreen` 2.02, fingerprint
`sha256:0618cb467539568ea52f85298002a46c1154af66affdf910e26ee6c7fbb22601`, equal to the newest
ledger record's.

A later change to `registry/stacks/python-react/` or a fragment it composes reopens this task.
