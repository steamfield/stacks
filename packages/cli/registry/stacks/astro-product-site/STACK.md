---
schema_version: 1
id: astro-product-site
kind: stack
name: Astro product site (landing page and docs)
description: A static Astro site for a product or open-source project, with a landing page driven by one config file and a Markdown docs section with sidebar, table of contents and pager, plus llms.txt, generated social cards, Tailwind, React, and Playwright with axe.
tags: [typescript, astro, react, web, static, content, docs, make, bun, node]
deps:
  site: [astro, "@astrojs/react", "@astrojs/sitemap", "@astrojs/markdown-satteri", react, react-dom, tailwindcss, "@tailwindcss/vite", "@tailwindcss/typography", satori, sharp, "@fontsource/inter"]
  site-dev: ["@astrojs/check", typescript, "@types/react", "@types/react-dom", "@biomejs/biome", prettier, prettier-plugin-astro, vitest, "@vitest/coverage-v8", happy-dom, "@testing-library/react", "@testing-library/dom", "@testing-library/jest-dom", "@testing-library/user-event"]
  browser-test: ["@playwright/test", "@axe-core/playwright"]
tools: [bun, node, make, git]
decisions:
  - "Production site URL for canonicals, the sitemap, social cards and llms.txt (default: https://example.com)."
  - "Product name, tagline, repository, version and install commands in src/config.ts (default: placeholders; fill them from the parent repository's README when there is one)."
  - "Demo slot: scripted terminal output (default), a screenshot or a `<video controls preload=\"none\">` with a poster, or a code sample."
  - "Docs groups (default: Getting started, Concepts, Guides, Reference)."
  - "Social cards: generated per page with satori and sharp (default), or one static image in public/."
  - "Fonts: the system UI stack (default), or one family self-hosted at build time with Astro's `fonts` config."
env:
  PORT_WEB: "4321"
  PORT_E2E: "4322"
merge: [.claude/settings.json]
fragments:
  default: [agent-ops, git-hooks, ci-github]
  optional: [posthog, cloudflare-pages, ce-plugin]
verify:
  - { name: install, phase: setup, layer: install, run: make install }
  - { name: lint, layer: lint, run: make lint }
  - { name: check, layer: typecheck, run: make check }
  - { name: test, layer: test, run: make test }
  - { name: build, layer: build, run: make build }
  - { name: browser, layer: test, run: node scripts/e2e.mjs }
  - name: readme-filled
    layer: check
    run: "test -s README.md && ! grep -n 'stacks:fill' README.md"
  - name: web
    phase: serve
    layer: serve
    run: make dev
    expect: { http: "http://localhost:${PORT_WEB}/docs/", within: 60s }
commands:
  install: Install dependencies (frozen lockfile when CI is set) and, outside CI, Playwright's Chromium
  dev: Astro dev server on PORT_WEB
  lint: Biome for TS, JS, CSS and JSON; Prettier for .astro files
  format: Apply Biome and Prettier fixes
  check: Type-check pages, components and content (astro check)
  test: Unit and component tests
  coverage: Unit and component tests with coverage
  build: Static build into dist/, then the acceptance tests over it
  preview: Serve the production build on PORT_WEB
  e2e: Browser and accessibility tests against the production build
  clean: Remove build output, test output and Astro caches
---

# Astro product site

## What stacks wrote

A static site with a landing page at `/` and docs under `/docs/`. `src/config.ts` drives the landing sections (release banner, header version, install tabs, terminal demo, features, used-by logos, sponsors, footer links and license), and each optional section disappears when its value is empty. Four Markdown pages, one per docs group, exercise the docs pipeline: sidebar, table of contents, pager, docs home, callouts, titled code blocks, heading anchors, table scrolling, a Markdown export per page, `llms.txt`, `llms-full.txt`, a generated social card per page, the sitemap and `robots.txt`. Unit and component tests sit beside the code, an acceptance suite checks the built `dist/`, and Playwright runs axe in both themes at desktop and mobile widths. Read the code before extending it, and `docs/DEVELOPMENT.md` for how the pieces connect.

## Layout

Docs pages go in `src/content/docs/<group>/`. Landing sections go in `src/components/landing/` as React components with a test each, and `src/pages/index.astro` places them. Pure logic goes in `src/lib/`; only `src/lib/collection.ts` and routes import `astro:content`. Shared browser behaviour goes in `src/scripts/site.ts`.

## Setup

1. Add the `site` dependencies with `bun add`, then the `site-dev` and `browser-test` dependencies with `bun add -d`, resolving current releases within their peer ranges. No generator is needed: keep the shipped `package.json`, configs and source. Run `make install` again so Playwright downloads Chromium.
2. Record the installed Bun in `packageManager` and Node in `.node-version`.
3. Run `make lint check test build`, then `node scripts/e2e.mjs`. Where an installed release rejects shipped code or config, update it for that release without dropping a check, a test or an axe rule. Keep Astro's strict preset, `trailingSlash: "always"` with directory output, the Sätteri plugins and the island assertion.
4. Apply the decisions in `src/config.ts` and `astro.config.mjs`, and replace the placeholder product copy, demo lines and docs pages. The tests read names and pages from config and the content folder, so they follow.
5. Record any compatibility workaround with its removal condition in AGENTS.md. Fill README's `stacks:fill` marker, finish the selected fragments, run `make format`, then `stacks verify` until green.

## Inside an existing repository

When the site lives in a product's repository (`site/`, `docs-site/`), `new` refuses `git-hooks` and `ci-github`; run it with `--without git-hooks --without ci-github` and let the parent's hooks and CI run this project's make targets. If the parent repository formats with Biome on save or commit, either extend the parent's Biome config from this project's `biome.json` or exclude this directory from it, never both, and record the choice in AGENTS.md. Prettier stays scoped to `.astro`. When the parent's agent rules deny writing `.env*`, list `PORT_WEB` and `PORT_E2E` in AGENTS.md instead of `.env.example`.

## Conventions

- Pages are listed nowhere by hand. Sidebar, pager, docs home, sitemap, social cards, exports and `llms.txt` derive from the `docs` collection and `docsGroups`. New frontmatter fields go in `src/content/schema.ts` and its test.
- Docs use plain Markdown conventions (`> [!NOTE]` callouts, `title="..."` on fences), not MDX, so pages read the same on GitHub and to agents.
- Links use the full route with its trailing slash. Canonical and social URLs come from each page's explicit `path`, never `Astro.url`.
- Only components named in `site.islands` hydrate, only on the landing page, preferably with `client:visible`. Docs pages ship no island.
- Style with the token utilities (`bg-canvas`, `text-ink`, `text-muted`, `border-line`, `bg-panel`, `text-accent`) rather than `dark:` variants, so the no-JavaScript theme fallback keeps working. New colours need values in both theme blocks of `global.css`.
- Search plugs into `BaseLayout`'s `search` slot; don't wire a search index into `make dev`.

## Testing

`make test` runs the docs rules, schema, Markdown plugins, social card and React component tests (Testing Library, happy-dom). `make build` builds the site, then `tests/build.test.ts` checks every docs page's metadata, sidebar entry, export, social card and sitemap entry, fails on any broken internal link or `#anchor`, compares hydrated islands with `site.islands`, and builds a copy with one extra page to prove a new page needs no other edit. The browser step runs `e2e/site.spec.ts`: axe at WCAG A and AA on `/` and a docs page in light and dark, console errors, theme persistence across pages, install tabs after hydration, and the docs menu without JavaScript. A new page type gets a build assertion; a new interactive component gets a component test and, if it hydrates, a browser check.

## Commands

The shipped Makefile (`make help`) has install, dev, lint, format, check, test, coverage, build, preview, e2e and clean. Keep the names and mirror them in AGENTS.md. Verify runs the browser step as `node scripts/e2e.mjs` because make reports every failure as status 2, and the script exits 127 when Chromium is missing so verify records an environment problem rather than a failing test.
<!-- stacks:when with=ci-github -->

CI reads Bun from `packageManager` and Node from `.node-version`, runs `make install` (frozen under CI), `make lint`, `make check`, `make coverage` and `make build`, then installs Chromium with its system dependencies (`bunx playwright install --with-deps chromium`) and runs `make e2e`. Upload `playwright-report/` and `test-results/` when it fails.
<!-- stacks:end -->
<!-- stacks:when with=posthog -->

The fragment ships `src/lib/analytics.ts`; initialize it once from the module `<script>` in `BaseLayout.astro`'s head, beside the `site` import. Keep `PUBLIC_POSTHOG_KEY: ""` in `vitest.config.ts`. Track events from islands or `src/scripts/site.ts`, never from docs content.
<!-- stacks:end -->
<!-- stacks:when with=cloudflare-pages -->

Deploy the static `dist/`; no Astro adapter is needed. The fragment's `public/_headers` covers caching and security headers for this site too. Pages serves directory output with trailing slashes as built, so add no redirect rules for them.
<!-- stacks:end -->

## Gotchas

- Astro can background dev and preview under an agent. The Makefile and Playwright config pass `--ignore-lock` so the caller owns the process. Stop a background instance with `bunx astro dev stop` or `bunx astro preview stop`.
- `make check` refuses missing `@astrojs/check` or TypeScript before invoking Astro, whose install prompt can exit successfully without checking.
- `@astrojs/check` can lag a TypeScript release. Resolve the newest TypeScript inside the checker's supported peer range, and remove the workaround when the checker supports the new release.
- Astro 7 applies JSX whitespace rules to `.astro` markup by default (`compressHTML`): a line break between text and an inline link disappears. Write `{" "}` where the space matters.
- Astro's default Markdown processor, Sätteri, runs only Sätteri plugins, not remark or rehype ones. Shiki drops a fence's info string before hast plugins run, which is why `codeTitle` is a Shiki transformer.
- Astro config runs before the content layer; don't query collections there.
- satori lays out flexbox only and reads TTF, OTF or WOFF fonts, not WOFF2.
- Bare `vitest` watches in a terminal; keep `vitest run` in recipes.
- The content layer caches rendered Markdown in `node_modules/.astro/` and doesn't notice a changed plugin in `src/lib/markdown.ts`. Run `make clean` after editing a plugin, or when collection types look stale.
