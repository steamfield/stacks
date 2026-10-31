#!/bin/sh
# Fails when the Drizzle schema has changes that no checked-in migration covers.
# It generates into a throwaway copy of drizzle/ and compares, so it never writes
# to drizzle/. Run it through `bun run db:check`, which puts drizzle-kit on PATH.
set -eu

if [ -z "$(find drizzle -name '*.sql' 2>/dev/null)" ]; then
  echo "db:check: no migrations in drizzle/; run bun run db:generate and commit the result" >&2
  exit 1
fi

drizzle-kit check

# drizzle-kit refuses --out beside --config and prefixes absolute paths with ./,
# so the copy sits in the project under a relative path and a throwaway config
# reuses the project's, changing only the output folder.
copy=$(mktemp -d .db-check.XXXXXX)
trap 'rm -rf "$copy"' EXIT
trap 'exit 130' INT TERM
cp -R drizzle "$copy/drizzle"
printf 'import config from "%s/drizzle.config.ts";\nexport default { ...config, out: "./%s/drizzle" };\n' \
  "$PWD" "$copy" >"$copy/drizzle.config.ts"
drizzle-kit generate --config "$copy/drizzle.config.ts" </dev/null >"$copy/generate.log" 2>&1 || true

# drizzle-kit exits 0 even when generate fails (a rename it can't ask about
# without a terminal, a schema that doesn't load), so success is its no-changes
# message and nothing else. If an upgrade rewords that message, update it here.
if ! grep -q "No schema changes" "$copy/generate.log" || ! diff -r drizzle "$copy/drizzle" >/dev/null; then
  cat "$copy/generate.log" >&2
  diff -rq drizzle "$copy/drizzle" >&2 || true
  echo "db:check: the schema and drizzle/ disagree. Run bun run db:generate in a terminal, review the SQL and commit it." >&2
  exit 1
fi
echo "db:check: drizzle/ matches the schema"
