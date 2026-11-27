---
schema_version: 1
id: cloudflare-pages
kind: fragment
category: deploy
name: Cloudflare Pages for static Astro sites
description: Deploys a static Astro site's build (the blog or the product site) to Cloudflare Pages with project-local wrangler, with production deploys from the default branch after the checks pass, pull request previews, cache and security headers, and a local check that serves the build through Cloudflare's Pages runtime.
tags: [deploy, cloudflare, static]
applies_to: [astro-blog, astro-product-site]
deps:
  deploy-dev: [wrangler]
decisions:
  - "Deploy mode: direct upload from GitHub Actions after the checks pass (default), or Cloudflare's git integration building on their side."
  - "Pages project name: the project slug (default)."
  - "Preview deploys for pull requests: on (default)."
verify:
  - { name: deploy-check, layer: build, run: make deploy-check }
commands:
  deploy-check: Build, then serve dist/ through wrangler pages dev and check headers, canonical URLs and the 404 page
---

# Cloudflare Pages

stacks wrote `wrangler.jsonc` (the Pages project name and `pages_build_output_dir: "./dist"`), `public/_headers` (a year of immutable caching for `/_astro/*`, plus `nosniff`, a referrer policy and `X-Frame-Options: DENY` on every response) and `tests/deploy.test.mjs`. The test serves the built `dist/` through `wrangler pages dev`, Cloudflare's local Pages runtime, and checks those headers, the canonical URLs Pages answers with and the 404 page. Wrangler is a dev dependency run through `bunx wrangler`. Scaffolding and verify need no Cloudflare account.

Cloudflare now recommends Workers static assets for new projects. This fragment deploys to Pages.

## What to add

1. Add `wrangler` with `bun add -d`. Add `compatibility_date` to `wrangler.jsonc` with today's date in Wrangler's format; if `wrangler pages dev` rejects it, use the newest date its error names. Keep `pages_build_output_dir`. Don't add `vars`: they are runtime bindings for Pages Functions, and this site has none.
2. Add `.wrangler/` to `.gitignore`. The test keeps its state in a temporary directory, but Wrangler still writes scratch files there.
3. Add Makefile targets and list them in `.PHONY`:
   - `deploy-check: build`, which runs `node --test tests/deploy.test.mjs`
   - `deploy-preview: build`, which runs `bunx wrangler pages deploy dist --branch "$(BRANCH)"`
   - `deploy: build`, which deploys to the production branch the Pages project was created with

   Both deploy targets need `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Say so in their help text and fail with a clear message when either is missing.
4. Public build-time values (`PUBLIC_*`, such as `PUBLIC_POSTHOG_KEY`) come from the environment of the process running `astro build`. In direct-upload mode, store them as GitHub Actions repository variables and pass them as `env` on the build step. In git-integration mode, set them as build environment variables for the Pages project. A static site has no runtime, so it has no secrets to put.
<!-- stacks:when stack=astro-blog -->
5. Write no trailing-slash or `.html` redirects. Pages already answers `/welcome.html` and `/welcome/` with a 308 to `/welcome`, which matches the stack's `trailingSlash: "never"` and file output, and the test proves it. Use `public/_redirects` only for moved or renamed posts. If the trailing-slash decision changes, update the canonical URL test with it.
6. Keep HTML, `rss.xml` and the sitemaps on Pages' default revalidating cache; `_headers` adds nothing for them.
<!-- stacks:end -->
<!-- stacks:when stack=astro-product-site -->
5. Write no trailing-slash or `index.html` redirects. Pages already answers `/docs` and `/docs/index.html` with a 308 to `/docs/`, which matches the stack's `trailingSlash: "always"` and directory output, and the test proves it. Use `public/_redirects` only for moved or renamed pages.
6. Keep HTML, the Markdown exports, `llms.txt` and the sitemaps on Pages' default revalidating cache; `_headers` adds nothing for them.
<!-- stacks:end -->

<!-- stacks:when with=posthog -->
If you add a Content-Security-Policy header, allow the PostHog host in `script-src` and `connect-src`, or analytics fail silently.
<!-- stacks:end -->

## Deploy workflow (direct upload)

Never trigger deploys with `workflow_run`.

When the project has `.github/workflows/ci.yml` (ci-github), deploy from jobs in it, each with `needs:` on its final `ci-ok` job:
- production: `if: github.event_name == 'push' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)`
- preview, if on: `if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository`. Fork pull requests get no secrets and no preview.

Without a CI workflow, add `.github/workflows/deploy.yml`, triggered by `push` to the default branch and, for previews, `pull_request` from the same repository. Its job runs `make install lint check test build` before it deploys.

Each deploy job:
- sets job permissions to `contents: read`, adding `deployments: write` only if it reports a GitHub deployment and `pull-requests: write` only if it comments the preview URL
- runs `make install` and `make build` with the public build variables in `env`, then deploys `dist/` with `bunx wrangler pages deploy` or Cloudflare's wrangler action
- passes the preview branch name through `env` and never interpolates `github.head_ref` into a `run:` line
- reads `CLOUDFLARE_API_TOKEN` (scoped to Pages edit on one account) and `CLOUDFLARE_ACCOUNT_ID` from repository secrets
- sets `concurrency` per branch, with `cancel-in-progress: true` for previews and `false` for production
- pins every action by full commit SHA with a version comment

In git-integration mode, skip the workflow and document the Pages build settings in AGENTS.md: build command `make build`, output directory `dist`, bun as the package manager.

## Verify

`deploy-check` builds the site and serves `dist/` through `wrangler pages dev` using `wrangler.jsonc`. It fails when `_headers` is missing or wrong, when the config doesn't point Pages at the build, when a redirect rule fights Pages' canonical URLs, or when the 404 page breaks. Deploying needs credentials, so verify never deploys.

## AGENTS.md

Add a **Deploy** section: the Pages project name, deploy mode, `make deploy-check`, `make deploy` and `make deploy-preview` with the environment variables the last two need, where public build-time values are set (repository variables in direct-upload mode, Pages build variables in git-integration mode), and where headers and redirects live (`public/_headers`, `public/_redirects`).

<!-- stacks:when preset=default -->
Under Pending user actions: create the Pages project once (`bunx wrangler pages project create <name>`, choosing the production branch), create a scoped API token, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets and the public build values as repository variables, and attach the custom domain.
<!-- stacks:end -->
