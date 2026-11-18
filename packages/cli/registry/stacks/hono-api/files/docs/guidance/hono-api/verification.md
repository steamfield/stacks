# Before calling work done

Run `bun run check` (lint, typecheck, test, the OpenAPI drift check, build) and read the output, then `stacks verify`, which also starts the built server and probes `/healthz`.

- A clean exit code isn't a pass. A `-t` filter that matches nothing exits 0 with every test skipped; read the counts.
- To call the server yourself, `bun run build`, then `PORT_API=<free port> bun run start` in the background, `curl -si` each changed endpoint (one success, one error), and stop it. `bun run dev` stays in the foreground until stopped; start it in the background if you use it.
- After changing a route or schema, run `bun run openapi`, read the `openapi.json` diff for the new path, its statuses and its schemas, and commit the file with the change. `bun run check:openapi` (verify's `openapi-drift` step) fails while the committed file is missing or stale.
- Read the server's log records for the requests you made: one `request` record each, with the right route pattern and status.
- After a commit that ran hooks, check `git status` for files a hook rewrote and left unstaged.
- Don't report a cause you didn't observe. Quote the output you're basing it on.
