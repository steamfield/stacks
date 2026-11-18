---
schema_version: 1
id: harness
kind: fragment
category: agent-ops
name: Harness
description: A guard hook and settings that every part of a workspace can take.
applies_to: [api-part, web-part]
merge: [.claude/settings.json]
verify:
  - name: harness-ok
    layer: check
    tags: [hygiene]
    run: "test -f .claude/settings.json"
---

# Harness

Keep the guard hook in place.
