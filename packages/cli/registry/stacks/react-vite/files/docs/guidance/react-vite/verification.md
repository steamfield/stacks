# Before calling work done

Run `bun run check` (lint, typecheck, test, e2e) and read the output, then `stacks verify`, which also serves the build and probes it.

- A clean exit code isn't a pass. A `-t` filter that matches nothing exits 0 with every test skipped; read the counts.
- `bun run e2e` is the only check that runs the built bundle in a browser. Run it after a change to routing, `vite.config.ts`, `index.html` or anything `main.tsx` imports.
- To look at the app yourself, `bun run build && bun run preview -- --port <free port> --strictPort` in the background, open it, then stop it. The dev server (`bun run dev`) stays in the foreground until stopped; run it in the background if you start it.
- Check the browser console as well as the page: the app logs failed requests there (`api_error`, `api_decode_failed`) with their request ids.
- After a commit that ran hooks, check `git status` for files a hook rewrote and left unstaged.
- Don't report a cause you didn't observe. Quote the output you're basing it on.
