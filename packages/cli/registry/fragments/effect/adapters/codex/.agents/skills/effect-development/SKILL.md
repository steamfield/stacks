---
name: effect-development
description: "Use before writing Effect code or tests: where to look up Effect names, the project's API reference and the test-kit patterns."
---

Read [shared effect guidance](../../../docs/guidance/effect/index.md) before changes.

# Effect

Look up Effect names in the project's API reference, `docs/guidance/effect/api.md`, then in the installed declarations; the declarations win when they disagree. Until the reference exists, write it as the shared guidance describes, and update it on every Effect upgrade.

Use fresh test layers, observe forked failures, and drive time through the test clock (`tests/effect-testkit.test.ts` shows each). Keep runtime execution at program boundaries. Schema is part of `effect`, not a standalone dependency.
