---
schema_version: 1
id: effect-schema
kind: fragment
category: tooling
name: Effect Schema
description: Effect Schema as the one validation and typing layer for data crossing a trust boundary (requests, config, storage, third-party and LLM output), with branded ids, tagged errors, JSON Schema for tools, and round-trip plus property tests.
tags: [typescript, effect, validation, schema]
applies_to: [astro-blog, astro-fullstack, cloudflare-react-router, mobile-expo, python-react, react-router, tauri-react, typescript-api, typescript-cli, typescript-mcp]
deps:
  typescript: [effect]
decisions:
  - "Schema location: one directory both client and server code can import (default), for example `app/schemas/` or `src/schemas/`, or the shared package in a monorepo."
  - "Existing validators: keep them and use Effect Schema at new boundaries (default), or migrate one boundary at a time when touched."
---

# Effect Schema

One schema owns each boundary shape and its TypeScript type. Decode incoming data and encode outgoing data through it.

## What to add

Install `effect`; Schema belongs to it, never the standalone `@effect/schema` package from older examples. Follow the schema-location decision: one dependency-free file per domain, importing only `effect`, re-exported from `index.ts` for client/server reuse.

<!-- stacks:when tag=web -->
Shared request/response schemas must be platform-free. Loaders/actions decode params and input at their boundaries.
<!-- stacks:end -->
<!-- stacks:when tag=cli -->
Use src/schemas for arguments, flags, stdin, config, storage, and machine output as added. Optional config uses a closed schema.
<!-- stacks:end -->

**Conventions.**
- Share the schema/type name: `export const User = Schema.Struct({...})`, `export type User = typeof User.Type`. Wire types use `typeof User.Encoded`.
- Use `Schema.Class` for entities with identity/behavior; `Schema.Struct` for DTOs and request/response bodies. Brand ids so domains cannot be swapped.
- Decode requests, env/config, storage rows, third-party responses, and structured LLM output at their boundaries. Inside, use decoded types without re-validation. Encode for storage/wire output.
- Filters (`.check(Schema.makeFilter(...))` or built-in checks) validate; transformations change representation, such as date strings into `Date`. Never hide conversions in filters.
- Annotate exported schemas with titles, descriptions, and examples. `Schema.toJsonSchemaDocument` supplies JSON Schema to tools/structured-output libraries; decode their results with the same schema. Avoid LLM-facing `identifier` annotations: generated `$ref`/`definitions` support is unreliable.
- For validation-only libraries accepting Standard Schema, use Effect's adapter. Domain errors are typed, serializable `Schema.TaggedError` classes.
- Keep framework/codegen validators (Astro's `astro/zod`, orval-generated zod). Effect Schema covers owned boundaries; use zod otherwise only at a library edge requiring it. Transitive peer dependencies are fine.

<!-- stacks:when mode=add -->
**Existing projects.** Keep validators. Use Effect Schema at new boundaries; migrate touched ones with tests passing before and after.
<!-- stacks:end -->

## Testing

Test transformation round trips: `encode(decode(x))` equals valid input. Check readable failures for meaningful missing fields, wrong brands, and out-of-range values, not every field. Use Effect's `Arbitrary` for non-trivial round-trip properties.

## Gotchas

Check installed types/docs for current filters, constructors, annotations, adapters, and JSON Schema APIs. Close external objects with `Schema.toJsonSchemaDocument(S, { onExcessProperty: "error" })`. Custom filters need `toJsonSchema` annotations, merged into the base schema. Annotations added after a check can be lost; confirm placement against installed types.

## AGENTS.md

Document schema location, boundary decoding, shared names, branded ids, tagged errors, JSON Schema conversion, and retained framework/codegen validators.
