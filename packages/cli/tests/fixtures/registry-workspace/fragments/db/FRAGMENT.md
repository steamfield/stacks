---
schema_version: 1
id: db
kind: fragment
category: service
name: Database
description: A Postgres connection for the api part.
applies_to: [api-part]
deps:
  backend: [pg]
commands:
  db-up: Start the local database
env:
  DATABASE_URL: "postgres://localhost/example"
merge: [config/app.json]
verify:
  - { name: up, phase: setup, layer: install, run: "true" }
  - { name: migrate, layer: check, run: "test -f src/db.ts", cwd: . }
---

# Database

Run `db-up`, then migrate.

<!-- stacks:when with=db -->
The database is part of this composition.
<!-- stacks:end -->
