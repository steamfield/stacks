---
schema_version: 1
id: web-part
kind: stack
name: Web part
description: A small scripts web app that a workspace mounts as its web part.
tags: [bun, scripts, typescript, web]
deps:
  dev: [vitest]
commands:
  lint: Check the source
  test: Run the tests
  dev: Serve the app
env:
  PORT_WEB: "4173"
merge: [.claude/settings.json]
fragments:
  required: [harness]
verify:
  - { name: install, phase: setup, layer: install, run: "true" }
  - { name: lint, layer: lint, run: "test -f src/main.ts" }
  - { name: test, layer: test, run: bun run test }
  - name: web
    phase: serve
    layer: serve
    run: bun run dev
    expect: { http: "http://localhost:${PORT_WEB}/", within: 60s }
---

# Web part

## Setup

Install dependencies, then run `bun run dev`.
