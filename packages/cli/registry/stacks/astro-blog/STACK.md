---
schema_version: 1
id: astro-blog
kind: stack
name: Astro blog
description: A static Astro blog with MDX posts in a zod-validated content collection (draft/published/unlisted status), React islands, Tailwind with typography, sitemap and RSS, optional generated OG images, and vitest plus astro check.
tags: [typescript, astro, react, web, static, blog, content, mdx, make, bun, node]
deps:
  site: [astro, "@astrojs/mdx", "@astrojs/react", "@astrojs/sitemap", "@astrojs/rss", react, react-dom, tailwindcss, "@tailwindcss/vite", "@tailwindcss/typography"]
  site-dev: ["@astrojs/check", typescript, "@types/react", "@types/react-dom", vitest, "@vitest/coverage-v8", happy-dom, "@testing-library/react", "@testing-library/dom", "@testing-library/jest-dom", yaml, prettier, prettier-plugin-astro]
  og-images: [satori, "@resvg/resvg-js"]
tools: [bun, node, make, git]
decisions:
  - "Production site URL for canonical links, sitemap, and RSS (default: https://example.com)."
  - "Generated Open Graph images per post with satori (default: off; a static image in public/)."
  - "Trailing slash: `never` with file-style build output (default), or `always`."
  - "Drafts: hidden from production pages, sitemap, and RSS; visible in dev at their URL (default)."
  - "Authors: one author in site config (default), or an authors data file."
env:
  PORT_WEB: "4321"
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github, posthog]
  optional: [cloudflare-pages, ce-plugin, claude-harness, claude-harness-docs]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: check, layer: typecheck, run: make check }
  - { name: test, layer: test, run: make test }
  - { name: build, layer: build, run: make build }
  - name: dev-cycle
    layer: check
    timeout: 3m
    run: "if bash scripts/dev-bg.sh status >/dev/null; then echo 'A dev server is running; stop it first: make dev-stop' >&2; exit 1; fi; make dev-bg && make dev-stop"
  - name: web
    phase: serve
    layer: serve
    run: make dev
    expect: { http: "http://localhost:${PORT_WEB}/", within: 60s }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
commands:
  install: Install dependencies (frozen lockfile when CI is set)
  dev: Astro dev server on PORT_WEB
  dev-bg: make dev in the background, logging to logs/dev.log; reuses the server it started and refuses a port another server answers
  dev-stop: Stop the process group dev-bg recorded in logs/dev.pid
  dev-status: Exit 0 when the server dev-bg started is running, else 1
  lint: Fail if Prettier would change any file
  check: Type-check and validate content (astro check)
  test: Unit and component tests
  coverage: Tests with coverage
  build: Static production build into dist/
  ci: "Every offline check CI runs (lint, check, coverage, build)"
  audit: Check dependencies for known vulnerabilities with bun audit (needs the network)
  preview: Serve the production build
  new-article: Scaffold a draft post from SLUG and TITLE
  format: Format with Prettier
  clean: Remove build output and Astro caches
---

# Astro blog

## What stacks wrote

A static blog with a validated MDX collection, a published post, base and post layouts, index and reading routes, RSS, a filtered sitemap, a React reading-state island, Tailwind typography, the error page, tooling and tests. The post proves the publishing pipeline through the generated pages and feeds; read the code before extending it.

## Layout

New posts go in `src/content/blog/`; reusable UI in `src/components/` as React, with Astro reserved for layouts and routes. `src/lib/posts.ts` owns pure publication rules; `src/lib/collection.ts` loads content for pages and feeds. `src/config.ts` owns public site metadata. Read `docs/DEVELOPMENT.md` for visibility, canonical URLs, command behavior and optional generated social images.

## Setup

1. Add the declared `site` dependencies with `bun add` and `site-dev` dependencies with `bun add -d`, resolving current releases within their peer ranges. Install `og-images` dependencies only if that decision is on. No generator is needed: keep the shipped `package.json` and source.
2. Run `make install lint check test build`. Where an installed release rejects shipped code or config, update it for that release without dropping a check or rule. Keep Astro's strict preset, the test ambient types, Node environments for tests that load Astro APIs, and the Vitest config type reference.
3. Apply the decisions in `src/config.ts` and `astro.config.mjs`. Update build assertions when changing the example post or URL policy. For trailing slashes, keep page links, canonicals, RSS and sitemap in agreement; the shipped default is file output without trailing slashes.
4. Record the installed Bun in `packageManager`, Node in `.node-version`, and any compatibility workaround with its removal condition in AGENTS.md.
5. Fill README's `stacks:fill` markers, finish the selected fragments and AGENTS.md, run `make format`, then `stacks verify` until green.

## Conventions

- Keep publication decisions in `posts.ts`; the sitemap reads real YAML with the same schema before the content layer exists. Unlisted posts render but stay out of the index, RSS and sitemap. Drafts render only in dev.
- Canonical and OG URLs use explicit route paths, never the build's HTML filename. Keep new routes consistent with the RSS trailing-slash setting.
- Reusable components are React. Add `client:*` only for interactive islands; the rest renders as static HTML.
- New frontmatter fields belong in the shared schema and schema tests. `make new-article` uses exclusive writes and env vars so quoted titles cannot become shell code.
- Post bodies keep Tailwind's `prose` and dark variants; the inline head script applies the system theme before paint.

## Testing

`make test` runs pure post selection tests, schema validation of every real post through YAML, component tests with Testing Library and the new-article process test. Keep tests next to source where possible. A new route also gets a build assertion: `make build` renders the real site and checks post metadata, the hydrated-island markup, RSS, sitemap and the error page. `make check` runs Astro's checker without an install prompt. `make coverage` runs the same tests with V8 coverage.

## Commands

The shipped Makefile (`make help`) has install, dev, dev-bg, dev-stop, dev-status, lint, check, test, coverage, build, ci, audit, preview, new-article, format and clean. Keep the names and mirror them in AGENTS.md. `make ci` runs lint, check, coverage and build; `make audit` runs `bun audit`, which needs the network, so it stays out of `ci`.

To keep a server running while you work, use `make dev-bg` and read `logs/dev.log`; stop it with `make dev-stop`. Don't background `make dev` or kill server processes by name: dev-stop signals only the process group it recorded. A foreground `make dev` isn't recorded, so dev-bg refuses while it holds the port. Stop the background server before `stacks verify`: its dev-cycle step fails while `make dev-status` finds one, and the serve step needs the port.
<!-- stacks:when with=ci-github -->

CI reads Bun from `packageManager` and Node from `.node-version`, then runs `make install` (frozen under CI) and `make ci`, then `make audit` as its own step: the audit needs the network, so it stays out of `ci`.
<!-- stacks:end -->
<!-- stacks:when with=posthog -->

The fragment ships `src/lib/analytics.ts`; initialize it once from a module script in `BaseLayout.astro`'s head. If `vitest.config.ts` sets `PUBLIC_POSTHOG_KEY: ""`, keep it. The reading island needs no analytics to work.
<!-- stacks:end -->
<!-- stacks:when with=cloudflare-pages -->

Deploy the shipped static `dist/`; no Astro server adapter is needed. Headers and moved-post redirects live under `public/`. Pages already canonicalizes `.html` and trailing-slash URLs for the default `trailingSlash: "never"` file output, so add no redirect rules for them.
<!-- stacks:end -->
<!-- stacks:when with=claude-harness -->

Include `.claude/hooks/` in Astro checking. Run project tests with Vitest on Node.
<!-- stacks:end -->

## Gotchas

- Astro can background dev and preview under an agent. The Makefile passes `--ignore-lock` to both so verify owns the foreground process. Stop only that process; Astro-managed background instances use `bunx astro dev stop` or `bunx astro preview stop`.
- `make check` refuses missing `@astrojs/check` or TypeScript before invoking Astro, whose install prompt can exit successfully without checking.
- `@astrojs/check` can lag a TypeScript release. Resolve the newest TypeScript inside the checker's supported peer range, and remove the workaround when the checker supports the new release.
- Bare `vitest` watches in a TTY; keep `vitest run` in recipes.
- `make dev-bg` overwrites `logs/dev.log`, and so does the `dev-cycle` verify step, which runs dev-bg then dev-stop. Copy the log first if you still need the last run's output.
- Astro config runs before `astro:content`; don't query the collection there.
- Delete `.astro/` if collection types look stale. Only `PUBLIC_` env vars reach browser bundles; draft visibility uses `import.meta.env.DEV`.
- satori supports flexbox and local TTF, OTF or WOFF fonts, not grid or WOFF2. See the development doc before enabling generated images.
