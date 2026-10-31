# R3. Fresh proof for the demonstrated recipe

Priority P0. Depends on R0, S5 (demo scope) and S8 (proof route and token). Evidence:
`recipe-proof.md`. Works in quickstack.

## Outcome

`python-react` with the sandbox preset has a current, eligible ledger record that matches
what the release ships, plus a separate `verify --all` run and a behavior check from an
agent-built app. The index then carries `lastRun` for it.

## Read first

- `plans/archive/phases/phase-2.0b-bench-2026-10-30.md`, `phase-2.0c-run-ledger.md`, `phase-1.6b-mvp-gate-runs.md`.
- `plans/archive/qa-gap-closure-2026-10-30.md` (how green checks have hidden omissions before).
- Code: `packages/cli/scripts/bench/{options.ts,verify.ts}`, `packages/cli/scripts/index/proof.ts`
  (`proveRecord`, `stackEntry`; module-private), `packages/cli/scripts/ledger-import.ts`.
- `product/PREP.md` sections 4 and 5.

## Eligibility, as the index code applies it

`proof.ts::proveRecord` and `stackEntry` give a stack `lastRun` only when its ledger record
in `registry/runs.json` at the indexed commit is a pass, at the stack's current composed
fingerprint, with zero interventions, `tamperCheck: "full"`, preset `default` or `sandbox`,
and no added fragments (`with` empty). A run with interventions is useful demo evidence
but never index proof.

## Steps

1. Preconditions. S8 decided; a `CLAUDE_CODE_OAUTH_TOKEN` or `CODEX_ACCESS_TOKEN` in the
   environment (the user supplies it; never write it to a file). Tools from R0 step 7 are
   executable. The audit once found an installed but broken Go shim; run each tool's
   `--version`.

2. Recipe freeze. This proof is only valid for the recipe content that ships. Agree with R1
   and R4 owners that no recipe or fragment under `registry/` will change after this point
   without returning here. Record `git rev-parse HEAD`.

3. Build and pack the candidate CLI (from `packages/cli`): `bun run pack`. This builds
   `dist/stacks` and `dist/cli.mjs` and writes `dist/pack/steamfield-stacks-<version>.tgz`.
   Record the tarball name and its `shasum -a 256`.

4. Bench run (S8 route a), from `packages/cli`:

   ```sh
   bun run bench python-react --preset sandbox --cli dist/stacks --keep
   ```

   `--cli` takes the built Node entry and its sibling `cli.mjs` (see `bun run bench --help`),
   so the bench uses the same build that was packed. The bench builds the
   project with an agent, runs `verify --json`, writes a run note and a ledger record.
   Record agent, model, scaffold time, agent time to first green, interventions, cache
   state (cold or warm package caches), and the kept directory.

5. `verify --all` in the kept project: `<cli> verify --all --json > verify-all.json`. Every
   step in the manifest must run and pass, including the production build that plain
   `verify` skips under sandbox. Fragments the sandbox preset excludes are not in the
   manifest and are not "skipped steps"; don't add them.

6. Behavior check. Open the kept app's code and confirm: a React view makes a typed request
   to the Python API and renders the response, and a test exercises that path for real
   (not a mock of the API). Quote the test's name and its key assertion. If the recipe's
   brief didn't lead the agent there, that is a recipe omission: fix the recipe under
   `registry/`, then return to step 2.

7. If anything failed or needed an intervention, fix the recipe (not the output) and repeat
   from step 2. Keep the earlier records; they're history.

8. Commit the ledger. The ledger record must be committed in quickstack before the release
   commit (R5), because `stackEntry` reads `registry/runs.json` at the indexed commit.

9. Check that the index proves it (from `packages/cli`):

   ```sh
   bun run build:index --out <scratch>/r3-index --previous none --unsigned
   jq -r .payload <scratch>/r3-index/v1/index.json | jq '.stacks[] | select(.id=="python-react") | .lastRun'
   ```

   Note: no `--include-unproven`, so this runs the real eligibility rule. `lastRun.fingerprint`
   must equal the new ledger record's fingerprint. If `lastRun` is missing, find which rule
   in `proveRecord`/`stackEntry` rejected it, and record it.

## Must not

- Edit generated project output to make a check pass.
- Treat an intervened run as index proof.
- Change recipe content after step 9 without redoing steps 2 to 9.

## Done when

- [ ] A bench ledger record for `python-react`, sandbox, zero interventions, pass, committed.
- [ ] `verify-all.json` shows every manifest step ran and passed (quote required, passed,
      failed, skipped counts).
- [ ] The behavior check is recorded with the test name and assertion.
- [ ] Step 9 shows `lastRun` with the matching fingerprint.
- [ ] `recipe-proof.md` records the commit, tarball digest, agent/model, timings, cache
      state and interventions. A later recipe change reopens this task.
