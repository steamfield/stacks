---
schema_version: 1
id: root-ci
kind: fragment
category: ci
name: Root CI
description: A CI workflow at the project root.
applies_to: []
verify:
  - { name: ci-config, layer: check, run: "test -f .github/workflows/ci.yml" }
---

# Root CI

CI runs from the project root.

<!-- stacks:when tag=bun -->
CI sets up Bun.
<!-- stacks:end -->
