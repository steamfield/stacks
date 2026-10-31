# API and mobile follow-up QA

Status: targeted checks passed with limits; full scaffold verification was not completed. The applications below were authored QA slices in fresh temporary projects. Passing their tests does not certify every instruction in the briefs. No manifest steps, thresholds or skips were changed.

The built Node CLI created `typescript-api`, `mobile-expo` and `astro-api` with `--sandbox --agents codex --json --no-launch --offline`, isolated HOME and XDG paths. The first two used their default fragments, including Clerk and GitHub CI. Astro used its default fragments. Node 24.21.0, Bun 1.4.2, Effect 4.0.6 and PostgreSQL 18 Alpine were used for the relevant tests. All times below are UTC and include implementation time, downloads and pauses; they are not controlled benchmarks.

## Timing

| Project | Scaffold manifest creation | First successful test | Targeted result |
| --- | --- | --- | --- |
| TypeScript API | 05:13:35.396 | About 05:14:35: health and JSON payload through web handler | 30 HTTP cases plus one startup test passed at 05:24:05; no full verify green |
| Mobile Expo | 05:13:35.650 | 05:16:03: separate API database tests | API harness, auth and workflow tests passed separately; no full verify green or single combined completion time recorded |
| Astro API | 05:21:20.786 | About 05:22:11: 31 API and startup cases | 39 API, startup and static cases passed in a run started at 05:22:58; no full verify green |

These first tests are scoped tests, not the manifests' first-green timing. Scaffold writes completed within the same displayed second as the recorded manifest creation. No full application was completed, so there is no full-green time to report.

## HTTP boundary

A real Effect `HttpApi` application with a Health service and payload, query, parameter, error, encoding-failure and defect routes ran against both an ephemeral Node HTTP listener and a platform-free web handler. The 30-case HTTP suite tested health decoded with its schema; valid, missing and unsafe request IDs; wrong methods and API misses; invalid and unknown query, invalid parameter and JSON payload; non-JSON 415; each locally implemented error-table row, including retryable 503; generic 500 for an invalid encoded response and a thrown defect; and one request log per case. A defect log had stack frames and the same ID, and the sentinel was absent from captured logs. An ordinary header was accepted with strict query parsing. A separate invalid-config test exercised the startup function and confirmed its server-acquisition callback was not called.

The request boundary used server middleware with `HttpEffect.appendPreResponseHandler`, and the framework request logger was disabled. A custom Effect logger captured UTC time, lowercase level, method, route pattern, status, duration and ID; a request with sentinel query and authorization values did not put them in those records. These checks do not exercise all logger formatting, reserved-field collision handling, file/stdout sinks, or an actual production entry's startup wiring. The app used a small test-oriented logger and implementation rather than a finished project. Evidence: [API implementation](api-mobile-evidence/api-app.ts.txt), [HTTP tests](api-mobile-evidence/api-http-contract.test.ts.txt), and [startup test](api-mobile-evidence/api-startup.test.ts.txt).

Effect 4.0.6's `HttpRouter.ts` documents that server middleware wraps response sending, so mapping the returned response is too late to alter what the client receives. `HttpEffect.appendPreResponseHandler` in `effect/src/http/HttpEffect.ts` registers the callback that can change it before send. The earlier brief specified server-level ownership but did not identify this mechanism. The parent was notified so the current guidance can be checked for this discovery.

## Astro workspace and static files

A fresh Astro API scaffold used a separate contract workspace, API workspace and Astro static site. The site built without an API running. The same HTTP matrix and startup check ran with static serving enabled on both transports. Eight additional cases requested the built home page, directory index, missing-site page and an API miss, asserting status, content, ID and one request record. The API miss retained its JSON envelope. Together the three files passed 39 tests. The static handler used Effect's `HttpStaticServer` and injected filesystem/platform services. See [static tests](api-mobile-evidence/astro-static.test.ts.txt) and [API/static implementation](api-mobile-evidence/astro-api-app.ts.txt).

This was a minimal static site, not the complete Astro brief. The browser island, typed browser client and same-origin dev proxy were not implemented or exercised. The startup test has the same acquisition-callback limit as the TypeScript API test. No full project verification ran.

## Mobile database, import graph and auth

An owned disposable PostgreSQL container used tmpfs at `/var/lib/postgresql`, with no named volume. A real Drizzle-generated migration populated a template under an advisory lock. Separate Bun processes cloned databases and wrote different rows. A file barrier held each test until both had written, then each observed only its own row. A separate harness test checked template reuse and cleanup after an intentionally failed post-clone setup. It did not simulate migration failure or test crash recovery. The temporary harness closed connections before clone/drop and deleted only databases whose names it had created. Evidence: [database setup](api-mobile-evidence/mobile-db-setup.ts.txt), [harness tests](api-mobile-evidence/mobile-harness-contract.test.ts.txt), and [parallel outputs](api-mobile-evidence/mobile-db-one-output.txt), [second output](api-mobile-evidence/mobile-db-two-output.txt).

The graph test walked TypeScript import/export declarations transitively through relative imports, an alias and a workspace export. A hidden runtime `bun` import was rejected, a type-only near miss passed, and a route-to-service-to-database fixture passed. This authored crawler did not prove handling of every possible JavaScript import form. See [graph implementation](api-mobile-evidence/mobile-graph.ts.txt) and the harness tests above.

Jest Expo exercised the QA root provider composition, real TanStack Query hook and Hono `hc` client with a fresh QueryClient. The external Clerk SDK and fetch were stubbed. The test covered keyless, signed-out, signed-in, token refresh, token failure, sign-out, cache clearing and a subsequent anonymous request; it asserted bearer headers and no token in captured console logs. The keyless render did not mount the Clerk provider stub. The tested root provider composition is a small authored slice, and this test does not establish real Clerk account or device behavior. See [auth test](api-mobile-evidence/mobile-auth-provider.test.tsx.txt), [providers](api-mobile-evidence/mobile-providers.tsx.txt), and [query hook](api-mobile-evidence/mobile-use-health.ts.txt).

The generated `docs/testing.md` said to remove stale `<prefix>_test_*` databases, while the acceptance file required deleting only owned databases. A prefix alone does not establish that a database is stale or belongs to this run. This is an instruction ambiguity, not an observed deletion. The parent was notified; no prefix-based deletion was performed.

## Local CI and launcher

A parsed YAML contract test checked API and mobile path examples, shared configuration and workflow paths, the API/schema dependency of the mobile filter, job gates, and actual project script names. Removing the API path from the mobile filter made its validator fail. The aggregate job's jq command was executed against success, skipped, failure and cancelled inputs; only the first two passed. The scoped contract passed 20 assertions. The authored project's `db:check`, `test:api`, `test:mobile` and `test:ci` commands passed. Headless Expo exports for iOS and Android passed; Expo's dependency check passed after aligning React and React Native to the versions it requested. The workflow's full lint/typecheck and a hosted GitHub execution were not run, and this small workflow is not a full CI certification. Evidence: [workflow test](api-mobile-evidence/mobile-ci-contract.test.ts.txt) and [workflow](api-mobile-evidence/mobile-ci.yml.txt).

A targeted check of the shipped mobile dev launcher found an occupied API port, exited 1 with a clear message, and left an independently owned listener alive. In a second run with simulated setup and runtime children, SIGTERM exited 143 and both owned children stopped. This supports the process-ownership fix but does not substitute for an actual mobile dev session. See [occupied-port output](api-mobile-evidence/mobile-occupied-output.txt) and [shutdown output](api-mobile-evidence/mobile-cleanup-output.txt).

## Cleanup and external limits

The owned temporary root, isolated home, state, dependencies and build output were removed after saving the evidence. The uniquely named database container was stopped and auto-removed; Docker recorded no volume-creation event during its lifetime, and the selected database port was free. The container used tmpfs and no named volume. No other container or volume was changed. No real Clerk account, native device, simulator, native build, remote CI, deployment or publication was used. The generated manifests stayed unchanged.
