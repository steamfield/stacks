---
schema_version: 1
id: effect
kind: fragment
category: tooling
name: Effect test kit and API reference
description: Effect testing for the Effect stacks with @effect/vitest and a shipped test of TestClock, Layer.fresh and failure assertions, shared guidance for Claude Code, Codex, Cursor and OpenCode, and an API reference the agent writes from the installed Effect release and keeps in step with it.
tags: [typescript, effect, testing]
applies_to: [effect]
requires: [effect-schema]
deps:
  dev: ["@effect/vitest"]
decisions:
  - "Effect release: the current stable release (default). Upgrade `effect` and every `@effect/*` package to the same version together, and choose Vitest inside `@effect/vitest`'s Vitest peer range."
verify:
  - { name: effect-testkit, layer: test, run: bun run test effect-testkit }
  - name: effect-api-reference
    layer: docs
    run: >-
      v=$(node -p "require(require.resolve('effect/package.json', { paths: ['.', 'apps/api'] })).version")
      && head -n 1 docs/guidance/effect/api.md | grep -qxF "Verified against effect $v"
---

# Effect testing and development

Read `docs/guidance/effect/index.md` before writing Effect code. The stack owns the runtime, services, errors, logging and test layers; this fragment adds the Effect test kit and the project's API reference.

## What to add

1. Add `@effect/vitest` as a dev dependency at the same version as `effect`.
<!-- stacks:when stack=astro-fullstack -->
   Add it to `apps/api`, and move `tests/effect-testkit.test.ts` to `apps/api/tests/`: the root `tests/` directory belongs to the `hooks` Vitest project.
<!-- stacks:end -->
2. Run `bun run test effect-testkit`. The shipped test is the pattern for Effect tests (TestClock, `Layer.fresh`, typed failures, defects, a fresh `ConfigProvider`). If a release renames a name it uses, fix the test against the installed declarations without dropping a case.
3. Once the project typechecks, write `docs/guidance/effect/api.md` as `docs/guidance/effect/effect.md` describes, and link it from `docs/guidance/effect/index.md`. Its first line is exactly `Verified against effect <version>`, the installed version. Every agent's Effect rule or skill links that index, so write no per-agent copy.

## Verify

`effect-testkit` runs the shipped test. `effect-api-reference` fails when `api.md` is missing or names a different version than the installed `effect`; after an upgrade, recheck the reference against the new declarations before updating that line.

## AGENTS.md

Add an **Effect** section: the API reference at `docs/guidance/effect/api.md`, rewritten on every Effect upgrade; `tests/effect-testkit.test.ts` as the test pattern; `effect` and `@effect/*` packages upgraded together.
