---
schema_version: 1
id: api-part
kind: stack
name: API part
description: A small scripts API that a workspace mounts as its api part.
tags: [bun, scripts, typescript]
deps:
  dev: [tsx]
  runtime: [hono]
commands:
  lint: Check the source
  test: Run the tests
  dev: Serve the API
  openapi: Write the OpenAPI document
decisions:
  - "Database (default: none)."
env:
  PORT_API: "3100"
merge: [.claude/settings.json, config/app.json]
fragments:
  required: [harness]
  default: [root-ci]
verify:
  - { name: install, phase: setup, layer: install, run: "true" }
  - { name: lint, layer: lint, run: "test -f src/index.ts" }
  - { name: test, layer: test, run: bun run test }
  - { name: openapi-drift, layer: check, run: bun run openapi }
  - name: api
    phase: serve
    layer: serve
    run: bun run dev
    expect: { http: "http://localhost:${PORT_API}/healthz", within: 60s }
---

# API part

## Setup

Install dependencies, then run `bun run dev`.

<!-- stacks:when with=root-ci -->
CI runs this part's lint and tests.
<!-- stacks:end -->

<!-- stacks:when with=db -->
The database URL is in `DATABASE_URL`; start it with `db-up`.
<!-- stacks:end -->

<!-- stacks:when tag=bun -->
Bun runs the scripts.
<!-- stacks:end -->
