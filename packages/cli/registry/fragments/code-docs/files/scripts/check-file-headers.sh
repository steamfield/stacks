#!/usr/bin/env bash
# Checks source-file documentation for the project's hygiene verify step. Folder READMEs
# remain an architectural judgment, so this script only reports missing file headers.
set -eu

# The project's own source roots, plus each workspace member's (apps/web/src, packages/core/tests).
roots=()
for root in src scripts tests apps/*/src apps/*/scripts apps/*/tests \
  packages/*/src packages/*/scripts packages/*/tests; do
  if [ -d "$root" ]; then roots+=("$root"); fi
done
if [ "${#roots[@]}" -eq 0 ]; then exit 0; fi

files=$(mktemp)
trap 'rm -f "$files"' EXIT
find "${roots[@]}" \
  \( -type d \( -name node_modules -o -name dist -o -name build -o -name coverage \
    -o -name target -o -name .venv -o -name vendor -o -name __pycache__ \
    -o -name fixtures -o -name __snapshots__ -o -name generated -o -name __generated__ \
    -o -path tests/consumer \) -prune \) -o \
  \( -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' \
    -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \
    -o -name '*.py' -o -name '*.go' -o -name '*.rs' \) \
    ! -name '*.gen.*' ! -name '*.d.ts' ! -name '*_pb2.py' ! -name '*.pb.go' \
    ! -name '*_templ.go' -print0 \) > "$files"

status=0
while IFS= read -r -d '' file; do
  case "$file" in
    *.py) language=py ;;
    *.go) language=go ;;
    *.rs) language=rs ;;
    *) language=js ;;
  esac
  case "$file" in
    */__init__.py) if [ ! -s "$file" ]; then continue; fi ;;
  esac
  if ! awk -v language="$language" '
    { sub(/\r$/, "") }
    NR == 1 && /^#!/ { next }
    language == "py" && NR <= 2 && /^[ \t\f]*#.*coding[:=][ \t]*[-_.a-zA-Z0-9]+/ { next }
    language == "go" && /^\/\/(go:build[ \t]|[ \t]+\+build[ \t])/ { build = 1; next }
    language == "go" && build && /^[ \t]*$/ { build = 0; next }
    {
      if (language == "js") valid = substr($0, 1, 3) == "/**"
      if (language == "py") valid = substr($0, 1, 3) == "\"\"\"" || substr($0, 1, 3) == "\047\047\047"
      if (language == "go") valid = substr($0, 1, 2) == "//"
      if (language == "rs") valid = substr($0, 1, 3) == "//!"
      seen = 1
      exit
    }
    END { exit !(seen && valid) }
  ' "$file"; then
    printf '%s: missing file-level doc comment\n' "$file" >&2
    status=1
  fi
done < "$files"
exit "$status"
