# Testing

## No network, fakes only at the boundary

- Tests never reach the network: the process env has an empty key and an unreachable base URL, and `makeTestLayer` adds a dummy key (pass `OPENROUTER_API_KEY: ""` for not-configured cases) plus the mock model.
- The only fakes are for third parties: the AI SDK's mock language model for the LLM, the shipped stub OpenRouter for its HTTP APIs (`tests/helpers/stub-openrouter.ts`: scripted replies, tool calls and failures, or recorded bodies through `replay()`; `docs/openrouter.md` lists what to cover). Never mock our own modules or services; build a test runtime from real in-memory layers instead.
- Route tests call loaders and actions with a real `Request` on a test runtime set through the runtime setter.

## Required coverage

- The closed-loop chat test: render the chat, route its transport's `fetch` into the real `api.chat` action, assert streamed text and a tool result reach the DOM. It's the check that server stream format and client `useChat` agree. Keep it passing; never skip it.
- Error paths for every route, each status it can return: for the chat and extract actions that's no key 503, bad body 400, wrong content type 415, rate limited 429 with `Retry-After`, unknown model 400; for a GET route, a bad param 400 and a missing thing 404.
- Rate limiter and retry schedules with `TestClock`. Never sleep to wait for time; a short real yield between clock steps is only for letting real I/O (the stub server) complete, and waiting on a condition (`vi.waitFor`) beats a fixed delay.
- The OpenRouter request shape against the stub server.
- `retryable` on each error body a route test covers, not only the status.

## Hooks, recorded fixtures, evals

- `tests/hooks/` runs each hook in `.claude/hooks/` through its wired command, with a JSON payload on stdin (helpers in `tests/helpers/hooks.ts`). A new guard pattern gets a deny row and a near miss that must pass. Rows are named after the command; the TypeScript guards ignore quoted text, so `-t "<name>"` works.
- `tests/openrouter-replay.test.ts` replays `tests/fixtures/openrouter/*.sse` (real OpenRouter bodies) through the real provider, whole and in 7-byte chunks. Don't hand-edit the fixtures; re-record with `bun run record:openrouter` (needs a key) after upgrading `ai` or `@openrouter/ai-sdk-provider`. The test reads expected values from the fixtures, so it needs no edits after a re-record.
- `bun run eval` (`scripts/eval.ts`) calls the real API and costs money, so it's manual and never part of `bun run test` or CI. Its pure scoring (`evals/score.ts`) is tested in `tests/evals.test.ts`; a new case goes in `evals/cases.ts`. Reports follow `docs/eval-report.md` and land in the ignored `.eval/results/`; only `--dry-run`, which owns its stub, runs in verify.

## Effect tests

- `it.effect` runs on the TestClock (import `TestClock` from `"effect/testing"`; it starts at 0 and moves only on `TestClock.adjust`; `Effect.forkChild` the program, adjust, then join) and silences the default logger. Property tests are `it.prop(name, [Schema], ([value]) => ...)`.
- The TestClock doesn't reach routes run through `useTestRuntime` (a separate `ManagedRuntime` on the live clock). Test time-based behavior on the program or service with `Effect.provide(makeTestLayer(...))`.
- `it.layer` shares one layer build across its block; use a fresh `makeTestLayer` per test when state must not leak (each sequential `Effect.provide(makeTestLayer())` builds fresh services; `tests/test-layer-isolation.test.ts` guards that). More in the Effect guidance (`docs/guidance/effect/index.md`) when the effect fragment is selected.

## Running

- Scoped first: `bun run test tests/<file>.test.ts` (add `-t "<name>"` for one test). Then `bun run test` before calling it done.
- Server tests run in the `node` environment; component tests opt into `happy-dom` per file. happy-dom replaces `fetch` and enforces same-origin rules, so a test that hits the stub server from happy-dom disables its same-origin policy for that file.
- Components that render router links need `createRoutesStub`.
- `bun run e2e` runs every Playwright spec, and `bun run e2e:app` builds and runs only the chat path (`e2e/chat.spec.ts`) in a real browser. Add to it only when a change could break in the browser but not in happy-dom (hydration, the client bundle, a download); test behavior in vitest. On failure, read `test-results/<test>/error-context.md` first: it has the error and a snapshot of the page.

## Discipline

- A bug fix starts with a test that fails for the bug's reason. Reintroduce the bug once to see it go red.
- A validation or limit test must prove the check bites: feed input that should be rejected and assert the rejection, not just that valid input passes.
- Weakening an assertion, adding `.skip`, or loosening a limit to get green is a failure, not a fix.
- A subagent asked to write tests touches only test files; check with `git diff --stat`.
