# Eval report v1

Implement `scripts/eval.ts` and an `eval` package-script alias. Both accept
`--dry-run --models <csv> --report <path>`. Write one JSON report at the explicit
path after all cases finish, including failed outcomes; exit nonzero on fail/error
or no passes. Keep per-case deadlines and pure scorers in the app. Dry-run owns a
local stub and calls real application chat/extract programs with the same
runner/scorers as live eval. Never load dotenv or use inherited provider settings
in dry-run. Stub verdicts prove plumbing, not quality. Live eval/recording remain
manual and require a key.

The shipped `bun scripts/check-eval-dry-run.ts` independently invokes
`bun --no-env-file scripts/eval.ts --dry-run --models synthetic/model-a,synthetic/model-b --report <owned-path>`.
It removes all environment names containing OPENROUTER or OPENAI, including
prefixed public/SDK variants. It checks the child's status and saved report,
requiring mode stub, current creation time (one-second ISO precision) and every requested model/case. It
inherits verify's process group and timeout; the runner owns its local server and
per-case aborts. Keep the checkpoint unchanged; implement the app runner to meet
the protocol. It does not trust stdout or agent-authored report tests.

The shipped `.eval/.gitignore` keeps everything else in `.eval/` out of git. The checkpoint prints a relative,
uniquely timestamped `.eval/results/<timestamp>-<uuid>.json` artifact path and
preserves structurally valid reports even for failed outcomes or aggregate
mismatches. It removes its temporary handoff directory on success/failure.
Missing, invalid JSON, nonregular, symlink and reports larger than 1 MiB fail.
Diagnostics identify fields/indexes without echoing values or parser text.
Live/direct runs should retain timestamped reports in the same ignored directory.

## Required fields

Use these exact camelCase names without aliases. Import the dependency-free types
from `scripts/lib/eval-report.ts` into the app's report writer.

| Object | Fields |
| --- | --- |
| Root | `schemaVersion: 1`, `mode: 'stub' \| 'live'`, `createdAt` (valid UTC ISO timestamp ending Z), nonempty `cases`, nonempty `models` |
| Case | `caseId`, `requestedModel` (nonblank strings); `verdict: 'pass' \| 'fail' \| 'error' \| 'truncated'`; `finishReason: string \| null`; `latencyMs` (finite >= 0); `inputTokens`, `outputTokens` (nonnegative safe integer or null); `cost` (finite >= 0 or null); `servedModel`, `provider` (nonblank string or null) |
| Model | `requestedModel`, `total`, `counts: { pass, fail, error, truncated }` (nonnegative safe integers); `inputTokens`, `outputTokens`, `cost`; `medianLatencyMs` |

Unavailable metadata is explicit null, never blank, absent, guessed or combined tokens.
Each requested model has one summary and exactly one case for each of
`currentTime`, `concise-answer`, `extract`. Additional uniquely named cases are
allowed. No unexpected models, duplicate case/model pairs or summaries. Ordering
is irrelevant. Summary counts/total equal the model's case records. Token/cost
totals are null if any member is null; partial sums are not totals. Latency median
sorts all the model's cases, averaging the middle two for even samples. Cost and
median comparisons allow 1e-9 absolute plus 1e-9 relative error; token/count totals
are exact. Any fail/error or no passes fails. Truncated stays distinct: it alone
does not fail a report containing passes. The checkpoint establishes report
consistency, not scoring correctness or full brief implementation. Test the app's
scoring and application boundaries separately.
