# Before calling work done

Run `bun run check` (lint, typecheck, test, e2e) and read the output. `stacks verify` runs the same layers plus a separate build and a probe of `/api/health` on the built server.

- `bun run typecheck` is `nuxt typecheck`: vue-tsc over the app, server, shared code and the tools config, including `.vue` files. Plain `tsc` checks nothing here.
- `bun run e2e` builds first. It is the only check that runs the real routes, server rendering, hydration and the client bundle in a browser.
- A clean exit code isn't a pass. A `-t` filter that matches nothing exits 0 with every test skipped; read the counts.
- UI changes: for anything the Playwright specs don't cover, start `bun run dev` in the background, open the page and exercise the path, including a validation error and the error page. Stop the server you started; leave one the user started running, and never `pkill` it.
- The dev server and the built server print errors to their own output. Read it before guessing at a cause, and quote it when you report one.
- After a hook-running commit, check `git status` for files a hook rewrote and left unstaged.
