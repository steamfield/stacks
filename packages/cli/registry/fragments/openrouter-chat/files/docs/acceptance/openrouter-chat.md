# Web chat acceptance

Implement `tests/app-acceptance.test.ts`. Verify runs it, the browser flow and the
stub-only eval dry run as separate steps. Use real programs, services,
route boundaries and local provider stubs; keep credentials blank before imports.

## Scripts and reports

Follow [report v1](../eval-report.md) for the exact camelCase fields, null
propagation, per-model aggregates and `--dry-run --models <csv> --report <path>`
protocol in `scripts/eval.ts`. The shared `bun scripts/check-eval-dry-run.ts`
checkpoint independently checks the saved report for two local models. Add
`.eval/` to `.gitignore`; preserve the checker and test the app's real runner and
scorers separately. Verify checks report consistency, not model quality.

Implement `scripts/record-openrouter.ts`, `scripts/eval.ts`, pure scorers and replay
tests. Wire `record:openrouter` and `eval` package scripts. Both reject a missing
key before requesting the provider; acceptance launches each with a clean env and
checks a local request counter stays zero. No fake paid recordings. Missing real
fixtures are an explicit replay skip with Pending user actions, never missing
recorder/replay code. Exercise recorder validation and replay chunking using
clearly identified synthetic local-stub fixtures, separate from paid recordings.

`eval --dry-run` owns a local stub, ignores inherited credentials/URLs and runs
the real chat/extract programs and pure scorers with per-case deadlines. Check
timestamped JSON results, every case/model, verdict, finish reason, latency,
tokens, cost, actual served model/provider and per-model totals/median. Use null
for unavailable provider metadata. Reject malformed/incomplete reports, zero
cases, failures/errors or no passes. Test scorers independently and a hanging
case aborting at its deadline. Live eval/recording remain outside automated checks.

## Required behavior matrix

| Surface | Acceptance |
| --- | --- |
| No key | Page and accessible notice render; composer disabled; direct actions return safe NotConfigured without a provider call |
| Failure/retry | HTTP and streamed 401/402/404/429/5xx, network and malformed upstream responses; safe retryability and Retry only when useful |
| Partial turns | Stop/disconnect during text and pending tool work; slot released once, partial assistant text/tool state saved and visible after hydration/reload |
| Export | Download and Copy use the same Markdown route; roles/text/tool calls, requested/served model, provider, finish reason, input/output tokens, cost, interruption metadata survive export |
| Clipboard | ClipboardItem promise path, writeText fallback, missing API/rejection; visible copied/failure, no false success; disabled while streaming |
| Models | Search/filter/select another model changes the actual request; pagination, fresh cache hit, expired cache refresh, unavailable discovery/default and explicit unknown id |
| Limits | Token-bucket refill without boundary double burst; chat and extract rate limits with Retry-After; independent concurrency cap; slots released on success/error/abort |
| Structured output | Exact closed schema sent on the wire, valid extraction, invalid output decoded again, safe error, bounded retry only for retryable failures |

Exercise route/DOM integration through the real transport and production browser
flows against owned stubs, not only screenshots or successful exit codes. The
browser suite asserts selected model, reply/tool state, full export content and
Stop/reload persistence. Unit-test time-dependent limits with TestClock. Document
implemented but unexercised edges separately from reproduced failures; local
stub success does not certify paid-provider formats, model quality or deployment.
