# Application QA excerpts

The CLI was the packed 0.3.1 executable. Paths below are represented by `<qa-root>`; the local provider key was a disposable test value.

```text
$ <cli> add openrouter-chat-cli --json --no-launch
added: openrouter-ai, openrouter-chat-cli
mergeNeeded: []
commandsKept: check, test
tamperCheck: full

$ bun run dev -- ask hi --json
{"type":"text-delta","text":"Hello from the local stub."}
{"type":"finish","text":"Hello from the local stub.","chatId":"<id>","model":"openai/gpt-test","usage":{"inputTokens":3,"outputTokens":5,"cost":0.000001}}

$ bun run dev -- models gpt --json
{"available":true,"models":[{"id":"openai/gpt-test","name":"Test","provider":"openai"}]}

$ bun run eval -- --dry-run
openai/gpt-test concise pass
openai/gpt-test current-time pass
openai/gpt-test contact pass
3/3 passed (stub validates plumbing, not model quality)

$ bun run test:tui
1 pass, 0 fail, 3 assertions

$ bun run app:e2e
3 pass, 0 fail, 22 assertions

$ vitest run <eight scoped CLI test files>
8 files passed, 27 tests passed

$ vitest run tests/replay.test.ts
1 file skipped, 1 test skipped: no paid provider recordings available
```

The PTY smoke sent a message, observed a streamed answer and usage, opened and closed the model picker, exported a chat, and quit with Ctrl+C. The compiled-app PTY test separately checked Escape during a stalled stream and confirmed that the partial reply was saved as interrupted. The local MCP test sent initialization, listing and a tool call before EOF and received JSON-RPC frames with exit 0 after the child-fiber workaround.

An earlier React Router attempt built an official generator project and a minimal Effect-backed health route. Its Chromium smoke passed one test for the page and `/healthz`; it did not complete the base or add the app. A separate fresh run owns final coverage for that combination.
