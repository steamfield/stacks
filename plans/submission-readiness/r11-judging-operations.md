# R11. Keep it up during judging

Priority P0, small. Depends on R5. Evidence: `operations.md` in the runs folder.

## Outcome

Nothing changes under the judges, someone notices if the site goes down, and a live demo
can still run if the network doesn't.

## Steps

1. Freeze. Record the judging window from `submission.md`. Until it ends: no `prod:deploy`,
   no `prod:seed`, no npm publish. Add one dated line saying so to `plans/HANDOFF.md` and the
   top of `stacks-api/AGENTS.md`, so other agents see it; remove both when judging ends.

2. Uptime ping. Production is one Docker host behind a Cloudflare Tunnel. Have the user point
   an uptime check they already use (or a cron `curl -fsS` from another machine) at
   `https://stacks.steamfield.io/healthz`, notifying them. Test once.

3. Live table, only if `submission.md` says there is one: keep on the demo laptop the recorded
   video, the uncut agent session, and a scaffolded, verified copy of the demo project. Check
   them the day before.

## Done when

- [ ] Freeze announced in both repositories; uptime ping tested; live-table kit checked or
      recorded as not needed.
