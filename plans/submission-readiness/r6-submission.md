# R6. Record the demo and submit

Priority P0. Depends on R5; script and rehearsal prep can start after R0. Evidence:
`submission.md`. The user submits.

## Outcome

A video within the organizer's limits shows the released CLI taking a request to a
working, verified starter, and every link a judge clicks works signed out.

## Read first

- `submission.md` (scope and organizer table from R0), `release.md`.
- `product/DEMO_OUTLINE.md`, `product/PITCH.md`, `product/PREP.md`.

## Steps

1. Align the demo docs with the scope. `DEMO_OUTLINE.md` line 70 and `PREP.md` section 5 show
   plain `stacks verify`: change to `stacks verify --all`. Align the Rho mention
   (`DEMO_OUTLINE.md` line 17) with S5. Touch nothing else.

2. Rehearse once exactly as it will be recorded: fresh `HOME` and npm cache, a new empty
   directory, `npx @steamfield/stacks@<version>` or the site's prompt pasted into the agent.
   The agent searches in plain words, explains its pick and one tradeoff, runs `show`,
   scaffolds with `--sandbox`, follows `.stacks/BRIEF.md`, builds the R0 app, and runs
   `stacks verify --all` until green. Show the app working. Record scaffold time, time to
   first green, verify runs and interventions. If a step is skipped in the `--all` run or the
   app is missing what the brief asked for, go back to R3.

3. Changed-command refusal (optional scene): in a `cp -R` copy, edit one verify command in the
   manifest, run `stacks verify`, capture the `VerifyChanged` refusal, label it as staged.

4. Record. Keep the uncut session. Label sample data and any speedup as `PREP.md` section 8
   says. Fit the length limit.

5. Signed out, open every link the submission gives: video, live site, npm page,
   repositories (per S6). Record each.

6. Write the final text for each submission form field, the links and the reproduction
   commands into `submission.md`. The user submits.

7. After submission (not before): replace HANDOFF's "Submission queue" with the outcome and a
   link here, and add one dated line to phases 4.2g, 4.5c, 4.5e, 4.2e and 1.6c saying what
   this release did. Deeper doc reconciliation can wait.

## Done when

- [ ] Rehearsal and recording both green with `--all`; metrics recorded.
- [ ] Video fits the organizer's limits; every link works signed out.
- [ ] Someone else could repeat the demo from `submission.md`.
