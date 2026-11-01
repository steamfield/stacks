---
schema_version: 1
id: effect-schema
kind: fragment
category: tooling
name: Effect Schema
description: Effect Schema as the one validation and typing layer for data crossing a trust boundary in the Effect stacks (requests, config, storage, third-party and LLM output), with branded ids, tagged errors, JSON Schema for tools, and a shipped round-trip and property test.
tags: [typescript, effect, validation, schema]
applies_to: [effect]
deps:
  typescript: [effect]
verify:
  - { name: schema-conventions, layer: test, run: bun run test schema-conventions }
  - name: no-standalone-schema
    layer: check
    run: "! grep -qs '\"@effect/schema\"' package.json apps/*/package.json packages/*/package.json"
---

# Effect Schema

Read `docs/guidance/effect-schema/index.md` before writing a schema. One schema owns each boundary shape and its TypeScript type; decode incoming data and encode outgoing data through it. Schema is part of `effect`: never install `@effect/schema`.

## What to add

Boundary schemas live where the stack keeps them, one dependency-free file per domain importing only `effect`, re-exported from `index.ts`:

<!-- stacks:when stack=typescript-api -->
`src/schemas/`, used by the `HttpApi` endpoint declarations so bodies, params and queries are decoded before a handler runs.
<!-- stacks:end -->
<!-- stacks:when stack=astro-fullstack -->
`packages/contract/src/schemas/`, shared by the API and the islands. Move `tests/schema-conventions.test.ts` to `packages/contract/src/schema-conventions.test.ts`, where the `api` Vitest project picks it up.
<!-- stacks:end -->
<!-- stacks:when stack=react-router -->
`app/schemas/`, platform-free so components can import their types. Loaders and actions decode params, form data and JSON input at their boundary.
<!-- stacks:end -->
<!-- stacks:when stack=typescript-cli -->
Use src/schemas for arguments, flags, stdin, config, storage, and machine output as added. Optional config uses a closed schema.
<!-- stacks:end -->

Run `bun run test schema-conventions`. The shipped test is the pattern to copy: a branded id, a round-tripping date transformation, a property over generated values, a readable failure, a closed JSON Schema document and the Standard Schema adapter. If a release renames an API it uses, fix the test against the installed declarations without dropping a case.

<!-- stacks:when mode=add -->
**Existing projects.** Keep existing validators. Use Effect Schema at new boundaries; migrate touched ones with tests passing before and after.
<!-- stacks:end -->

## Verify

`schema-conventions` runs the shipped test. `no-standalone-schema` fails when a root or workspace `package.json` names `@effect/schema`.

## AGENTS.md

Document the schema location, boundary decoding, shared names, branded ids, tagged errors and JSON Schema conversion, and link `docs/guidance/effect-schema/index.md`.
