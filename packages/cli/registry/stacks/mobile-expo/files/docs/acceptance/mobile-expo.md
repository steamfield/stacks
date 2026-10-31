# Mobile harness acceptance

Verify runs `test:api test/harness-contract.test.ts`,
`test:mobile --runInBand test/auth-provider.test.tsx` and `test:ci` separately.
The base ships the database/import and CI suites; the Clerk fragment adds its
provider matrix. Preserve their names and include them in the
ordinary workspace tests/check/CI. Hook coverage is not an application audit.

## Database and import graph

Keep the shipped setupApiTest(label): migrate a template once per run
under an advisory lock, close template connections, clone one database per file
with safe unique names, dynamically import the app only after setting its env,
and drop only owned databases in cleanup even when assertions fail. Have at least
two actual API test files write/read distinguishable rows in parallel and prove
neither can observe the other's rows. Test migration reuse and failed setup
cleanup against real local Postgres, not a mocked db() or one shared test database.

The harness-contract suite crawls imports transitively from client.ts, following
relative imports, aliases and workspace exports. Real graph fixtures must fail
for a hidden bun/Drizzle import outside allowed db/services modules and pass for
the intended routes -> services -> db graph. A direct-string check of client.ts
alone is insufficient. Keep mobile's type-only client import free of runtime
side effects. Include a deny and a near miss for graph enforcement.

## Offline auth provider seam

Mount the real root provider composition and query hooks with a fresh QueryClient.
Stub only Clerk's external SDK/account boundary, fetch and native OS boundaries.
Exercise missing-key/anonymous, signed-out, signed-in token, token refresh, token
failure and sign-out. Assert the API request actually gains/removes Authorization
and cached signed-in data is cleared; no token reaches logs. Hooks and hc remain
real. Never replace the project's provider/hook with a fake just to render a page.
When Clerk is excluded, test the same anonymous seam without importing its SDK.

## Local CI contract

`test:ci` parses the fragment's actual workflow with Bun's YAML parser. Keep
changes outputs and path-filtered API/mobile/bundle jobs, shared
lock/config/workflow paths in every relevant filter, API/schema paths in mobile's
filter, and always-running ci-ok handling failure/cancellation versus intentional
skips. Test relevant path-change examples and a deliberate missing filter to prove
the validator bites. Call the project's actual test/bundle/db-check commands.
Local YAML/contract tests do not certify a hosted GitHub run.

If ci-github was explicitly excluded, the CI suite instead asserts that no
workflow is installed; report that intentional absence. Do not require a hosted
workflow when its fragment was not selected.

Record real Clerk account login/redirect/refresh, native device behavior, platform
builds and remote CI as external validation until exercised with the right account
and environment. No-credential provider-seam tests cannot certify those flows.
