# Setup timing observations

Status: EXECUTED 2026-10-27

There are two useful measurements: how long the CLI takes to write a scaffold,
and how long an agent takes to turn its brief into a project that passes verify.
The latter is the product's setup benchmark. These observations are collected
during manual diagnostic QA, not a controlled performance study.

The setup agents use GPT-6.1 Terra at high reasoning effort, with three agents
working in parallel. Each agent retains context across several assigned units
and can inspect recipe sources and installed library declarations. These are
not fresh independent agents for every sample; knowledge carried from a failed
or earlier run can shorten a later one.

## CLI scaffold writes

One additional scaffold per composition was timed with a monotonic clock around
the complete packed Node process. All ran serially on the local Mac with Node
24.21.0, offline mode, sandbox preset and the Codex adapter. This includes Node
startup, composition, file writes and git initialization. Dependencies were
already cached by the broader QA session, though `new` installs none. Other QA
agents were working concurrently. Each temporary target and its isolated CLI
state was removed immediately after its sample.

| Stack/composition | `new` elapsed | Written paths |
| --- | ---: | ---: |
| astro-api | 216.8 ms | 43 |
| astro-blog | 183.6 ms | 19 |
| cloudflare-react-router | 185.4 ms | 15 |
| go-cli | 190.6 ms | 18 |
| mobile-expo | 192.9 ms | 25 |
| python-react | 190.7 ms | 19 |
| react-router | 200.4 ms | 29 |
| tauri-react | 192.3 ms | 22 |
| typescript-api | 198.7 ms | 43 |
| typescript-cli | 189.3 ms | 28 |
| react-router + openrouter-chat | 198.5 ms | 33 |
| typescript-cli + openrouter-chat-cli | 195.6 ms | 34 |

The ten base samples range from 183.6 to 216.8 ms, with a median of 191.5 ms.
These are single warm local samples, not install, build or cold-start timings.
The twelve samples ran between 03:57:57.797 and 03:58:00.187 UTC on October 28
(October 27 in the client's America/Chicago timezone).

## Agent scaffold to first green verify

| Stack | Elapsed to first green | Evidence and qualification |
| --- | ---: | --- |
| go-cli | 2m 22s | First-green result reports `secondsSinceCreated: 142`; fresh recreation after a discarded partial attempt, with the agent retaining what it learned |
| mobile-expo | 7m 11s | First-green result reports `secondsSinceCreated: 431`; implementation and manual work were interleaved; further recipe/test work followed green |
| typescript-api | About 7m 37s | Recreated manifest at 03:38:59.088 UTC; first green output written at 03:46:36 UTC, filesystem precision one second; excludes the discarded initial setup attempt |
| typescript-cli | 8m 55.882s | Project state creation 03:34:56.723 UTC and firstGreenAt 03:43:52.605 UTC; interleaved with React Router work; strengthening continued after first green |
| astro-api | About 8m 40s | Recreated manifest at 03:49:16.757 UTC; first green output at 03:57:57 UTC, filesystem precision one second; excludes discarded initial setup |
| python-react | 5m 23.921s | Fresh state creation 03:54:39.304 UTC and firstGreenAt 04:00:03.225 UTC; sandbox green with its production build skipped; first full green took 6m 2.255s |
| astro-blog | About 2m 36s | Recreated manifest at 04:00:48.160 UTC; sandbox green at 04:03:24 UTC; first full green at 04:03:33 UTC, about 2m 45s after creation |
| cloudflare-react-router | About 3m 55s | Fresh continuation; first full `--all` green at about 4m 8s; exact timestamp evidence is in the web/API report |
| tauri-react | 8m 50.244s | State creation 04:04:06.054 UTC to first sandbox green 04:12:56.298 UTC; first full green including macOS bundle took 10m 21.062s |
| react-router | About 4m 21s | Fresh manifest at 04:11:05.935 UTC; first green at 04:15:27 UTC; excludes the discarded initial web attempt |

Python's first `--all` run started at 04:00:34.996 UTC and lasted 6.563 seconds,
so its completion at 04:00:41.559 was 6m 2.255s after creation. All fourteen
steps passed, including the production build. This preceded further browser
and hook auditing. A skipped production check is not counted as a full pass.

The Astro blog agent measured its actual recreation `new` command at 0.26 seconds
and first tests at 04:02:04 UTC, about 1m 16s after creation. This is an additional
command sample, separate from the orchestrator's twelve-sample table above.

The Cloudflare agent measured its actual recreation `new` command at 0.25 seconds
and its first passing focused test at about 1m 29s after creation. Tauri's agent
measured `new` at 0.18 seconds, with state creation at 04:04:06.054 UTC and its
first observed scoped Rust test passing at 04:06:14 UTC, about 2m 8s later.

Tauri's first full verification started at 04:13:08.274 UTC and ran for 78.842
seconds, finishing at 04:14:27.116 UTC, 10m 21.062s from creation. The packaged
native application was exercised afterward. React Router's first focused test
completed at 04:13:45 UTC, about 2m 39s after fresh creation.

Across the ten bases, the observed mean is about six minutes to first green,
with a range of 2m 22s to 8m 56s. Full verification that includes prod-tagged
builds took as long as 10m 21s for Tauri. This is one observation per base, not
a population benchmark: some runs
restarted with knowledge from an earlier attempt, work was interleaved, caches
were warm, and green verification did not imply complete recipe compliance.
A green verifier also precedes some manual audits and additional recipe work.
This is time to first green, not time to independently confirmed completion of
every recipe instruction.

The TypeScript CLI's first verify run containing a passing binary-test step
finished at 03:38:08.506 UTC, 3m 11.783s after creation; its unit-test step first
passed on the next iteration. This is the recorded run-completion milestone,
not a separately captured timestamp for the binary test's own completion.
The recreated TypeScript API's first passing focused test run started at about
03:40:06 UTC, roughly 1m 7s after creation; its completion timestamp was not
captured, so this is not a time-to-first-pass measurement. A first-test timestamp
for the other runs was not captured reliably. Original agent-run `new` command
durations were not measured except for the later explicit samples; the
separately measured samples above must not be substituted for earlier runs.

Actual first-green outputs are retained for
[Go](runtimes-evidence/go-final-verify1.json) and
[mobile](runtimes-evidence/mobile-verify3.json). Other timestamps and their
precision are documented by the group reports. Unavailable measurements stay
unavailable rather than being reconstructed as measured durations.

## Adding an app after a green base

The CLI chat app's `add` result file was written at 03:45:03 UTC, with one-second
precision. Its first green app verification started at 04:03:26.314 UTC and ran
for 7.234 seconds, completing at 04:03:33.548 UTC. Adding and implementing the
app therefore took about 18m 31s to first green, after the base was already
working. From original base creation to that first composed-app green was
28m 36.825s, including the base implementation, extra checks and the addition.
The first observed provider test passed at 03:46:26 UTC, about 1m 23s after add.
The agent continued checking requirements after the manifest first passed.

The last retained CLI app verification finished at 04:11:08.636 UTC, 36m 11.913s
from base creation and about 26m 6s after add. That later interval includes
additional audit and repairs after first green; required behavior still omitted
by that implementation is disclosed in the CLI app report. It is not a complete
product-readiness measurement.

Web chat's add ran from 04:15:48 to 04:15:49 UTC and took 0.22 seconds. Its first
full app verify started at 04:26:43.049 and ran for 10.413 seconds, finishing at
approximately 04:26:53.462 UTC: about 11m 4s after add finished, or 15m 47.527s
after the base's creation. The first app test time was not captured separately.
Further failure and partial-history checks followed that first green; the final
all-green result includes the subsequent repairs. Recorder/eval and other
implementation gaps are disclosed in the [web app report](web-app.md).

App implementation times should be compared separately from bare-stack times
because they include the product features defined by the app fragment, not just
development infrastructure.

## A milestone is not proof that a test ran

The initial, later-discarded React Router attempt recorded `firstTestPassAt` at
03:36:11.345 UTC. Its only passing test-layer step was `harness-hooks`, whose
conditional command returned 0 because `tests/hooks` did not exist; the actual
project test script was missing and failed. The first real scoped health test
was reported in a passing run at 03:37:01 UTC. This recorded milestone is excluded from the timing
claims above. The CLI milestone currently means a test-layer command succeeded,
which can include an owned conditional command doing no test work. Benchmark
collection needs observed test execution as well as successful exit status.
