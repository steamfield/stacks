# Stack DX survey, 2026-11-26

Read-only survey of the 46 bundled stacks at `6c17c8df`, used as the starting point for the audit in `plans/stack-audit-2026-11-26.md`. Each line is a gap against the DX baseline that plan defines; verify it against the stack before acting, since the survey read files quickly.

## Cross-cutting gaps

- Dependency audit: only Go (`make vuln`, govulncheck) and Rust (`make audit`, cargo-deny) have one. No TS, Python or JVM stack does.
- Aggregate command: the Python stacks (django, django-api, python-api, python-cli, python-data, python-library, streamlit) declare no `ci`. astro-blog and astro-product-site use `check` for `astro check`; Rust uses `check` for `cargo check`.
- Coverage floor missing: all five Rust stacks, astro-blog, astro-product-site, nextjs, nuxt, sveltekit, react-router, react-vite, typescript-cli, tauri-react, mobile-expo; phaser-game and threejs-game have no coverage command.
- Lint autofix missing: Rust, Java (whose `lint` is Maven Enforcer), nextjs, nuxt, sveltekit, nestjs-api. astro-blog has no linter.
- Single-test command missing: go-cli, astro-blog, astro-product-site, cloudflare-react-router, decks; typescript-cli shows one only inside a verify step. In shipped docs only (not the body): django, django-api, python-api, react-router, rust-cli, tauri-react, typescript-api.
- Background dev server with a stop command and a log file: only typescript-api, astro-fullstack and react-router (`dev:bg`, `dev:stop`, `logs/dev.log`). Go and JVM servers say "background it and stop only the pid you started" with no command. No guidance at all: django, django-api, python-api, streamlit, nextjs, sveltekit, cloudflare-react-router, astro-product-site, tauri-react, threejs-game.
- Logs in a file an agent can read: typescript-api, astro-fullstack, react-router, mobile-expo, typescript-cli, go-tui, rust-tui, phaser-game, threejs-game. Everything else logs to stdout or stderr only.
- Fragments: claude-harness is absent from astro-product-site, cloudflare-react-router, mobile-expo and decks, optional in astro-blog. git-hooks is optional in cloudflare-react-router and decks; ci-github is optional in decks. agent-ops reaches the other stacks as a default or through claude-harness.
- `.claude/settings.json`: cloudflare-react-router ships none; hono-react and python-react none at the root.
- Toolchain pins: mostly a Setup instruction; only Rust and tauri-react ship `rust-toolchain.toml`.
- Browser or device end-to-end test missing: astro-blog, django, streamlit, cloudflare-react-router, mobile-expo; tauri-react's e2e uses a mock transport.

## Per stack

- astro-blog: no linter, no coverage floor, no single-test command, no browser check; `check` means astro check; claude-harness only optional.
- astro-fullstack: strong. Web app has no coverage floor; no browser e2e.
- astro-product-site: no coverage floor, no single-test command, no background guidance, `check` clash, no claude-harness.
- cloudflare-react-router: no `.claude/settings.json` or adapters, no claude-harness, git-hooks optional, no single-test command, no browser test, nothing on reading Worker logs locally.
- decks: prose lint plus tsc only; ci-github and git-hooks optional.
- django, django-api: no `ci`, no audit, no background guidance, single test only in docs, stdout logs.
- go-api, go-grpc, go-htmx: the model to copy (ci, single test, integration tests against the binary, vuln). No background command, stdout logs.
- go-cli: no single-test example, no `.env.example`, floor 50 (lowest of the Go stacks).
- go-library, go-mcp, go-tui: complete.
- hono-api: no `dev:bg`/`dev:stop`, no log file; partial background guidance.
- hono-react, python-react: no root `.claude/settings.json`; python-react's single-test guidance is vague.
- java-cli, java-library, quarkus-api, spring-boot-api, spring-boot-web: no lint autofix, `lint` is Maven Enforcer, no dependency audit; single test documented.
- mobile-expo: no coverage floor, unit tests need Postgres, no device e2e; has a log file.
- nestjs-api, nextjs, nuxt, sveltekit: no lint autofix; nextjs, nuxt, sveltekit have no floor; nextjs and sveltekit no background guidance; stdout logs.
- phaser-game, threejs-game: no coverage command; strong `see` harness writing `.runs/`; threejs has no background guidance.
- python-api, python-cli, python-data, python-library, streamlit: no `ci`, no audit; python-api has no background guidance and its single test is only in docs; streamlit's config docs are thin and it has no browser test.
- react-router: no coverage floor; single test only in docs.
- react-vite: no coverage floor, no runtime logs.
- rust-*: no coverage tooling, no lint autofix, `check` is cargo check, `audit` needs the network.
- tauri-react: no coverage floor, mock-transport e2e only, no background guidance, Rust logs to stderr.
- typescript-api: strongest agent DX; body lacks the "What stacks wrote" section.
- typescript-cli: no coverage floor; single test only inside a verify step.
- typescript-library: the only stack with a fast `gate` command.
- typescript-mcp: complete.

## Overlap

No pair meets the merge bar (one stack's difference from another fits in one `decisions` entry or one optional fragment). django vs django-api is closest (41 common files, 22 identical), but the difference is a file set (templates and forms vs DRF serializers and OpenAPI), and a `decisions` entry can't switch files; folding DRF into django as a fragment would give pages plus API, which isn't django-api's product. spring-boot-api/web, go-api/go-htmx, typescript-api/hono-api, react-router/cloudflare-react-router and the astro trio differ by framework, runtime or content model across most files.
