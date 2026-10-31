# R2 seed quality

stacks-api merge `3ec82cd` (unit commit `600d08e`). Profile `active-4`; the default profile is
version 8 so cached histories rebuild.

## Fixes

- Dependency majors come from a dated offline table (`scripts/seed/dependency-majors.ts`, checked
  2026-10-28 against npm, PyPI, crates.io and the Go proxy). Packages absent from it are omitted;
  upgrades stop at its newest listed major. Before, majors were hashed from the name, so
  `@biomejs/biome` showed majors 5 and 6 and Cobra 4 and 5.
- More projects report dependencies (v2 participation rises from 65% to 95% after the first three
  days; 90% of those accept reporting), so common packages publish while niche ones can stay
  suppressed.
- Failing steps come from each stack's own manifest steps instead of every composed fragment's,
  so a stack's failure shares name only steps its page lists.

## Sample comparison (21 days, `--profile active --seed 1 --through 2026-10-27`)

| View | Before | After |
| --- | --- | --- |
| Home summary | 10 stacks; busy and sparse populations | Identical |
| Trending | 8 trending stacks | Identical |
| Popular `astro-api` | 3,715 projects; median 23 m, p75 32 m; fragment-step noise | Same counts and timing; install 7%, test 23%, build 11%; manifest steps |
| Sparse `react-router` | 15 projects; rate and timing suppressed | Same suppression |
| npm dependency index | 90 of 102 publish; 6,125 reporters | 90 of 102 publish; 9,870 reporters |
| PyPI | 16 publish; FastAPI majors 2 and 3 | 16 publish; FastAPI `0.162` |
| Go | 5 publish; Cobra majors 4 and 5 | 5 publish; Cobra 1 |
| crates | 0 of 13 publish; invalid major labels | Still suppressed; corrected labels |
| `@biomejs/biome` | 5,265 reports; majors 5 and 6 | 8,465 reports; major 2 |
| TypeScript | 6,125 reports; majors 5 and 6 | 9,870 reports; majors 5 and 6 |

A database audit of the sample found 193 package and major pairs, all within the table, and no
integrity flags. The 21-day sample can't show the 28-day upgrade window; the 60-day transition
test covers it, and the 120-day production seed is the first place it appears.

## Checks

The unit's seed tests (42 across six files), lint and typecheck passed; four restored-bug probes
failed as expected. The stacks-api gate passed 3 of 3 after the merge.

## Production

`bun run prod:seed -- --replace-production-data --profile active --seed 1 --days 120 --through
2026-10-27`, started 2026-10-28 from stacks-api `95ec146` with quickstack at `cedaa5b` (0.4.0).
Rollback point: stacks-api `34b3e5b`, index from quickstack `6060b55`; the seed backs both
volumes up on the host first.
