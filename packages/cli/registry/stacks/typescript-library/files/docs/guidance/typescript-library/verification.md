# Before calling work done

Run `bun run check` (lint, typecheck, coverage, the package checks and the consumer install) and read the output, then `stacks verify`.

- A clean exit code isn't a pass. A `-t` filter that matches nothing exits 0 with every test skipped; read the counts.
- Tests import `src/`, so they can pass while the published package is broken. `bun run lint:package` and `bun run test:consumer` check the packed tarball; run both after touching `package.json`, `tsdown.config.ts`, `src/index.ts` or a public type.
- After changing the API, read `dist/index.d.ts` from `bun run build`: it is what TypeScript users see. Check each new export is there with the type you meant.
- Never publish, bump the version or push tags to check something; `bun pm pack --dry-run` lists what would ship.
- After a commit that ran hooks, check `git status` for files a hook rewrote and left unstaged.
- Don't report a cause you didn't observe. Quote the output you're basing it on.
