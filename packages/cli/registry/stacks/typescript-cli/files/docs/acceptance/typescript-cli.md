# Configuration and logging acceptance

The shipped `tests/config-logging.test.ts` implements this matrix; the manifest runs it independently of
hook tests. Use the real parser, AppLayer, configuration reader and logger through
`runCli`, with files under temporary HOME/XDG directories. Do not mock config or
assert only the decoded setting: assert records actually emitted and suppressed.

| Input | Required observation |
| --- | --- |
| No file or environment setting | Default level; doctor succeeds with a command record at that level |
| config.json logLevel debug | A debug diagnostic from the invoked program reaches the captured sink |
| config.json logLevel info | The same debug diagnostic is absent; info remains |
| File debug, LOG_LEVEL none | Environment wins; both diagnostics are absent |
| File info, blank LOG_LEVEL | Blank is absent; the file's setting applies |
| Invalid file level | Doctor still reports the config problem and uses the safe fallback |
| Two invocations with different files/levels | No level, config or buffered-log state leaks |

Exercise file/env/default precedence for another non-secret setting through the
command result too. If a command exposes an explicit setting flag, assert its
precedence over env and file; do not add a logging flag just for these tests.

Assert status and both streams for human and JSON doctor, including invalid
configuration. Decode JSONL log records and check levels, UTC time, command,
duration and outcome; assert no secret values. The compiled binary suite repeats
file-only logging and the env override using a clean environment. A test that
only sees logLevel in a decoded object does not satisfy this contract.
