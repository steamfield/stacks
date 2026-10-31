---
schema_version: 1
id: docker-deploy
kind: fragment
category: deploy
name: Docker images + GHCR
description: Production container images (multi-stage, non-root, healthchecked Dockerfiles shipped for each deployable part) that verify builds and starts, plus a GitHub Actions job that publishes them to GitHub Container Registry once the project's checks pass on the default branch.
tags: [docker, deploy, containers, ghcr]
applies_to: [python-react, python-api, typescript-api, astro-fullstack, go-api]
requires_tools: [docker]
tools: [docker]
decisions:
  - "Where images run: publish to GHCR only (default); rollout to a host is a separate step the user chooses."
  - "Target platforms: linux/amd64 (default); add linux/arm64 for ARM hosts (Python images then build under slow emulation)."
  - "Publish trigger: pushes to the default branch after the checks pass, plus v* tags (default), or tags only."
env:
  PORT_IMAGE: "18080"
verify:
  - name: image-build
    layer: build
    run: "(test ! -f Makefile || make docker-build) && (test -f Makefile || bun run docker-build)"
    tags: [prod, docker]
  - name: image-serve
    phase: serve
    layer: serve
    run: "(test ! -f Makefile || make docker-serve) && (test -f Makefile || bun run docker-serve)"
    expect: { http: "http://127.0.0.1:${PORT_IMAGE}/healthz", within: 90s }
    tags: [prod, docker]
commands:
  docker-build: Build the production images
  docker-serve: Run the production images in the foreground on 127.0.0.1:PORT_IMAGE
---

# Docker images + GHCR

stacks shipped the Dockerfiles and allowlist `.dockerignore` files (non-root, cached, healthchecked); read them before changing anything. Base image versions are `ARG`s with no default, so a build without them fails; `docker-build` passes them from the project's own records. Keep versions and secrets out of Dockerfiles and build args.

<!-- stacks:when stack=go-api -->
**Image** `api`, port 8080: distroless with no shell, so the HEALTHCHECK runs `server -healthcheck`. Args: `GO_VERSION` from `go list -m -f '{{.GoVersion}}'`, `VERSION` for the ldflags.
<!-- stacks:end -->
<!-- stacks:when stack=python-api -->
**Image** `api`, port 8000. Args: `PYTHON_VERSION` from `.python-version`, `UV_VERSION` from `uv --version | cut -d' ' -f2`. `uv sync --locked` needs `requires-python` set.
<!-- stacks:end -->
<!-- stacks:when stack=python-react -->
**Images** `api` (context `backend/`, port 8000) and `web` (context `frontend/`, nginx proxying the API paths), the stack's Production SPA serving default; if the user picks FastAPI serving the build, fold the SPA into the API image. `docker-serve` exports `PORT_IMAGE` and runs `docker compose -f compose.prod.yaml up --abort-on-container-failure`. Args: `PYTHON_VERSION` from `backend/.python-version`, `UV_VERSION` from `uv --version | cut -d' ' -f2`, `BUN_VERSION` from `bun --version`.
<!-- stacks:end -->
<!-- stacks:when stack=typescript-api,astro-fullstack -->
**Image** `app`, port 3000, only the bundle (and, for astro-fullstack, the site as `STATIC_DIR`) on slim Node. Args: `BUN_VERSION` from `bun --version`, `NODE_VERSION` from `.node-version` without a leading `v`.
<!-- stacks:end -->

## What to add

<!-- stacks:when tag=make -->
**Makefile targets**: `docker-build` runs `docker build --build-arg NAME="$$(<command>)" ... -t <project-slug>-<image>:local <context>` per image. `docker-serve` sets `PORT_IMAGE ?= 18080` and runs `docker run --rm -p 127.0.0.1:$(PORT_IMAGE):<port> <image>` in the foreground.
<!-- stacks:end -->
<!-- stacks:when tag=scripts -->
**Package scripts**: `docker-build` is `docker build --build-arg BUN_VERSION="$(bun --version)" --build-arg NODE_VERSION="$(sed 's/^v//' .node-version)" -t <project-slug>-app:local .`; `docker-serve` is `docker run --rm -p 127.0.0.1:${PORT_IMAGE:-18080}:3000 <project-slug>-app:local`.
<!-- stacks:end -->

<!-- stacks:when tag=python -->
Uvicorn trusts proxy headers only from `FORWARDED_ALLOW_IPS` (default `127.0.0.1`); set it to the load balancer's addresses when deploying.
<!-- stacks:end -->
<!-- stacks:when with=postgres,effect-sql-postgres -->
**Migrations** run as a one-shot `docker run <image> <migrate command>` before rollout, never on container start, so replicas can't race.
<!-- stacks:end -->

## Publish workflow

Never publish from `workflow_run` or `pull_request_target`: both hold write tokens for events a fork starts.

<!-- stacks:when with=ci-github -->
Add a `publish` job to `.github/workflows/ci.yml` with `needs: [ci-ok]` and `if: github.event_name == 'push'`, and add `tags: ['v*']` to the push trigger. Pull requests never pass the `if`.
<!-- stacks:end -->

Without a `ci.yml`, create `.github/workflows/docker-publish.yml` on `push` to the default branch and `v*` tags, where `publish` needs a `checks` job running the project's lint, typecheck and tests.

`publish`: job permissions `contents: read`, `packages: write`, `id-token: write`, `attestations: write`; checkout with `persist-credentials: false`; a matrix per image; build args computed as `docker-build` does; Buildx and a `ghcr.io` login with `GITHUB_TOKEN`; metadata-action tags `type=sha`, `type=semver,pattern={{version}}` and `latest` with `enable={{is_default_branch}}`; build-push-action with `provenance: mode=max`, `sbom: true` and a per-image GitHub Actions cache. Images are `ghcr.io/<owner>/<repo>/<image>`, lowercased; `concurrency` per ref without cancelling. Pin actions as the CI section says, otherwise by commit SHA.

## Verify

`image-serve` starts the image and probes `/healthz`. Both steps are tagged `prod` and `docker`: sandbox skips them unless `stacks verify --all`; `--skip-tag docker` drops them without Docker.

## AGENTS.md

A **Deploy** section: images, the two commands, where base image versions come from, when images publish, how migrations run. Pending user actions: package visibility on GitHub, and the deploy target and its secrets once chosen.
