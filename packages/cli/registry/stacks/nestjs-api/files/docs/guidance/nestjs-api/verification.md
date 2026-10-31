# Before calling work done

Run `bun run check` (lint, typecheck, coverage over both test projects, build) and read the output, then `stacks verify`, which also starts the built server and probes `/healthz`.

- A clean exit code isn't a pass. A `-t` filter that matches nothing exits 0 with every test skipped; read the counts.
- To call the server yourself: `bun run build`, then `PORT_API=<free port> bun run start` in the background, `curl -si` each changed endpoint (one success, one error), and stop it. `bun run dev` (`nest start --watch`) stays in the foreground until stopped; start it in the background if you use it.
- After adding a route, fetch `/openapi.json` and check the new path, its statuses and its schemas are there.
- Read the server's log records for the requests you made: one `request` record each, with the right route pattern and status.
- After `bunx nest g`, run `bun run format` and `bun run typecheck`: the schematics write unformatted code and, without `--no-spec`, a Jest-style spec.
- After a commit that ran hooks, check `git status` for files a hook rewrote and left unstaged.
- Don't report a cause you didn't observe. Quote the output you're basing it on.
