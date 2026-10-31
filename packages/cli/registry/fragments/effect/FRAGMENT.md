---
schema_version: 1
id: effect
kind: fragment
category: tooling
name: Effect testing and API skill
description: Effect testing with @effect/vitest (fresh real layers per test, TestClock instead of sleeps, typed failure and defect assertions), shipped Effect guidance for each agent, and an agent skill written from the installed Effect release's declarations.
tags: [typescript, effect, testing]
applies_to: [astro-blog, astro-fullstack, cloudflare-react-router, mobile-expo, python-react, react-router, tauri-react, typescript-api, typescript-cli, typescript-mcp]
requires: [effect-schema]
deps:
  dev: ["@effect/vitest"]
decisions:
  - "Effect major: the current stable major (default). If the latest release is still a prerelease, pin every Effect package to the same one (with transitive overrides where needed) and record the pins under Build workarounds; otherwise use caret ranges. Check peer ranges before selecting Vitest and its coverage package."
---

# Effect testing and development

Read `docs/guidance/effect/index.md` before implementation; it supplies the shared guidance for every selected agent.

The stack owns runtime, services, errors, and logging. This fragment adds testing and development guidance.

## Testing

Use `@effect/vitest` with fresh real service layers; fake only third-party boundaries. Factories allocate state per build; test isolation. Memoization shares static memory layers unless wrapped in `Layer.fresh`; share `it.layer` state only deliberately. Inject a fresh ConfigProvider. Separate route/CLI runtimes use the live clock, so test time-dependent programs directly with provided layers.

`it.effect` supplies TestClock, TestConsole, and scope. Fork timers, advance TestClock, then join. For intervening real I/O, yield and wait for a condition; never guess with sleeps. Assert typed failures and defects without swallowing causes.

## Installed API guidance

After core compilation, write `effect/SKILL.md` in the skill tree AGENTS.md specifies, checking claims against installed declarations. Include triggers and a lookup order: installed declarations, then compiled source for behavior, then its docs and changelog; other majors and memory last. Resolve imports through package exports, not older directory layouts. Cover:

- Namespaced services, static layers, named functions, typed failures/defects, scope, cancellation, callbacks, and captured runtime context.
- Current migration traps: Context, catch helpers, Result/Either, schema annotations/checks, forks, scoped layers, Config constructors/providers, log levels, and TestClock imports.
- Configuration, custom logger inputs/annotations, clocks, promise cancellation, layer memoization, and boundary-only runtime execution.
- Boundary decoding, closed JSON schemas, references, Standard Schema, virtual time, properties, and failure/state-sharing tests.

Extend for CLI/platform/AI modules only when used. Link from AGENTS.md and the shipped Effect rule; don't freeze an API reference.

## Gotchas

Upgrade Effect packages together; rerun checks and update the skill. Never install `@effect/schema`. Treat empty config strings as absent. Scripts invoked repeatedly need fresh ConfigProviders, not environment snapshots. Observe every fork at its owner. Catch typed failures deliberately; defects remain defects.
