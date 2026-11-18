---
schema_version: 1
id: pair
kind: stack
name: Pair
description: A workspace stack that mounts an API part and a web part and links them.
tags: [make]
parts:
  - { name: backend, role: api, stack: api-part }
  - { name: frontend, role: web, stack: web-part }
commands:
  check: Run both parts' checks
merge: [.claude/settings.json]
fragments:
  required: [client-link, harness]
  default: [root-ci]
  optional: [db]
verify:
  - { name: both, layer: test, run: make check }
  - name: readme-filled
    layer: check
    tags: [hygiene]
    run: "test -f README.md"
---

# Pair

## How the parts connect

`backend/` serves the API and `frontend/` calls it through the generated client.

## Setup

Set up each part in its own directory.

## Changing the API

Change `backend/`, regenerate the client, then run `frontend/`'s checks.

<!-- stacks:when with=client-link -->
The client link keeps the generated client in step with the API.
<!-- stacks:end -->
