# Before calling work done

Run `bun run check` (lint, typecheck, tests with coverage floors, build) and read the output. The build is the only check that catches a platform import the bundle can't resolve.

- A clean exit code isn't a pass. A `-t` filter that matches nothing exits 0 with every test skipped; read the counts.
- Exercise the change against a running server. `bun run dev:bg` reuses the dev server already running from this checkout or starts one, and returns once `/healthz` answers, printing its URL (use the port it prints). Then hit the endpoints with `curl -si`, the error responses as well as the successes: a bad body, a missing resource, a wrong method (the 404 envelope).
- A changed endpoint changes the contract: fetch `/openapi.json` and read the diff for the paths, params and schema names you touched.
- For any failure, read `logs/server.jsonl` (structured, one `request` line per call with its `requestId`) and `logs/dev.log` (the whole terminal) before guessing; AGENTS.md, Debugging, has `jq` queries. When done, `bun run dev:stop` if you started the server; leave the user's running. Never `pkill` it.
- Never substitute `bun test` for Vitest or run the server under Bun.
- A green commit isn't a complete one: after a hook-running commit, check `git status` for files a hook rewrote and left unstaged.
- Don't report a cause you didn't observe. Quote the error output you're basing it on.
