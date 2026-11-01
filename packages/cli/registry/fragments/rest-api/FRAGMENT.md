---
schema_version: 1
id: rest-api
kind: fragment
category: tooling
name: REST resource conventions
description: Agent rules for naming and shaping HTTP resources (plural nouns, methods and status codes, one resource shape, cursor pagination, versioning) for the JSON API stacks in Go, Python, TypeScript, Rust and Java, for Claude Code, Codex, Cursor and OpenCode, plus an AGENTS.md section recording the project's choices.
tags: [api, rest, http, conventions]
applies_to: [typescript-api, astro-fullstack, go-api, python-api, hono-api, nestjs-api, django-api, rust-api, spring-boot-api, quarkus-api]
verify:
  - name: api-conventions
    layer: docs
    run: "awk '/^## API conventions/{f=1;next} /^## /{f=0} f' AGENTS.md | grep -qi envelope"
---

# REST resource conventions

Read `docs/guidance/rest-api/index.md` before implementation; it supplies the shared guidance for every selected agent.

Agents name endpoints after the task in front of them (`/getUserData`, `/orders/create`), so an API drifts into verbs and synonyms. The shipped rule (`docs/guidance/rest-api/rest-api.md`, with matching Cursor, Codex and OpenCode copies) loads when API definitions, routes, handlers or schemas are open. It is framework-neutral; the stack owns how statuses and headers are declared, where routes live, the version prefix, what a wrong method returns, and the envelope and cache policy.

## What to add

The rule ships ready; don't edit it per project. On the first new resource, check the installed framework's behavior (201 with `Location`, 400 for an unknown query param but not for unknown headers, the stack's wrong-method answer, `Allow` on any 405) and record it in AGENTS.md.

## Verify

`api-conventions` checks that AGENTS.md has an **API conventions** section naming the error envelope; the stack's HTTP tests prove the behavior.

## AGENTS.md

Add a short **API conventions** section next to the architecture notes: the version prefix in use, the error envelope's shape, the pagination parameters (`limit`, `cursor`, the maximum page size), what a wrong method returns, and a pointer to the rule. Name one existing resource as the example to copy.
