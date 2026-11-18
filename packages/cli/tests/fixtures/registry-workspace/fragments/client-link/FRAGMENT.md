---
schema_version: 1
id: client-link
kind: fragment
category: link
name: Client link
description: Generates the web part's API client from the api part's OpenAPI document.
applies_to: [web-part]
verify:
  - { name: client-drift, layer: check, run: "test -f orval.config.ts" }
---

# Client link

Regenerate the client after the API changes.
