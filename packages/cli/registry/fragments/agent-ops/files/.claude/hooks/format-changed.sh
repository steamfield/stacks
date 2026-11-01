#!/usr/bin/env bash
# Stop: format the files this session wrote (Edit/Write) at the end of each turn,
# so what the agent leaves behind is formatted even if nobody runs the formatter
# by hand. lint-on-write.sh records each written path in a per-session list
# outside the repo (see session_file_list in _lib.sh); this hook formats the ones
# that still exist inside the project, then clears the list. Files other agents
# or you are editing in the same checkout are left alone. No session_id or no
# list: nothing is formatted.
#
# Only formatters the project has opted into run, and only on the files they own:
#
#   *.py              ruff format + safe ruff fixes (unused imports kept), when ruff is configured or
#                     installed in the project's .venv
#   JS/TS/JSON/CSS    biome when a biome config exists, else prettier when a
#                     prettier config exists (project node_modules binaries)
#   *.go              gofmt
#
# Silent by design: no output, always exit 0. A Stop hook that prints errors can
# trap the session in a feedback loop.
set -euo pipefail
# Any failure the code below doesn't handle still ends the hook with 0.
trap 'exit 0' ERR

hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=_lib.sh
source "$hook_dir/_lib.sh"

input=$(cat)
list=$(session_file_list "$input") || exit 0
[ -s "$list" ] || exit 0
cwd=$(hook_get "$input" cwd | head -n 1) || cwd=""
if [ -n "$cwd" ]; then cwd=$(cd "$cwd" 2>/dev/null && pwd -P) || cwd=""; fi

root=$(project_root)
root=$(cd "$root" 2>/dev/null && pwd -P) || exit 0
cd "$root" || exit 0

plan=$(mktemp "${TMPDIR:-/tmp}/claude-format.XXXXXX") || exit 0
# Claim the list before reading it (mv is atomic), so a path recorded while this
# hook runs lands in a fresh list for the next Stop instead of being dropped.
claimed="$plan.files"
mv "$list" "$claimed" 2>/dev/null || { rm -f "$plan"; exit 0; }
trap 'rm -f "$plan" "$claimed"' EXIT

# prettier_for <dir>: prettier, when the project configured it and installed it.
prettier_for() {
  local cfg
  cfg=$(find_up "$1" .prettierrc .prettierrc.json .prettierrc.yaml .prettierrc.yml .prettierrc.js \
    .prettierrc.cjs .prettierrc.mjs .prettierrc.toml prettier.config.js prettier.config.cjs \
    prettier.config.mjs prettier.config.ts) || return 1
  [ -x "$cfg/node_modules/.bin/prettier" ] || return 1
  printf 'prettier\t%s\n' "$cfg"
}

# formatter_for <abs-path>: print "<tool>\t<workdir>" or return 1.
formatter_for() {
  local f=$1 dir cfg
  dir=$(dirname "$f")
  case "$f" in
  */node_modules/* | */.venv/* | */venv/* | */vendor/* | */dist/* | */build/* | */target/*) return 1 ;;
  *.py | *.pyi)
    cfg=$(find_up "$dir" ruff.toml .ruff.toml pyproject.toml) || return 1
    if [ -x "$cfg/.venv/bin/ruff" ]; then
      printf 'ruff-venv\t%s\n' "$cfg"
    elif command -v ruff >/dev/null 2>&1 &&
      { [ -f "$cfg/ruff.toml" ] || [ -f "$cfg/.ruff.toml" ] || grep -q '^\[tool\.ruff' "$cfg/pyproject.toml" 2>/dev/null; }; then
      printf 'ruff\t%s\n' "$cfg"
    else
      return 1
    fi
    ;;
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.mts | *.cts | *.json | *.jsonc | *.css)
    # Biome first: when a project has both, biome is the one it chose last.
    if cfg=$(find_up "$dir" biome.json biome.jsonc) && [ -x "$cfg/node_modules/.bin/biome" ]; then
      printf 'biome\t%s\n' "$cfg"
    else
      prettier_for "$dir"
    fi
    ;;
  *.scss | *.html | *.vue | *.svelte | *.astro | *.md | *.mdx | *.yaml | *.yml)
    prettier_for "$dir"
    ;;
  *.go)
    command -v gofmt >/dev/null 2>&1 || return 1
    printf 'gofmt\t%s\n' "$root"
    ;;
  *) return 1 ;;
  esac
}

# lint-on-write.sh recorded physical paths; one per line, repeats possible.
while IFS= read -r f; do
  # The plan file is tab- and newline-separated.
  case "$f" in *$'\t'*) continue ;; esac
  [ -n "$f" ] && [ -f "$f" ] || continue
  case "$f" in
  "$root"/*) ;;
  *)
    # A worktree the agent works in, as lint-on-write.sh allows.
    [ -n "$cwd" ] || continue
    case "$f" in "$cwd"/*) ;; *) continue ;; esac
    ;;
  esac
  key=$(formatter_for "$f") || continue
  printf '%s\t%s\n' "$key" "$f" >>"$plan"
done < <(sort -u "$claimed")

[ -s "$plan" ] || exit 0

# One invocation per (tool, workdir), with all of that group's files.
cut -f1,2 "$plan" | sort -u | while IFS=$'\t' read -r tool dir; do
  set --
  while IFS= read -r f; do
    set -- "$@" "$f"
  done < <(awk -F'\t' -v t="$tool" -v d="$dir" '$1 == t && $2 == d { print $3 }' "$plan")
  [ "$#" -gt 0 ] || continue

  case "$tool" in
  # F401 stays unfixed: an import written this turn may be used next turn.
  ruff-venv)
    (cd "$dir" && with_timeout 20 .venv/bin/ruff format --quiet "$@" && with_timeout 20 .venv/bin/ruff check --fix --unfixable F401 --quiet "$@") >/dev/null 2>&1 || true
    ;;
  ruff)
    (cd "$dir" && with_timeout 20 ruff format --quiet "$@" && with_timeout 20 ruff check --fix --unfixable F401 --quiet "$@") >/dev/null 2>&1 || true
    ;;
  biome)
    (cd "$dir" && with_timeout 30 node_modules/.bin/biome check --write "$@") >/dev/null 2>&1 || true
    ;;
  prettier)
    (cd "$dir" && with_timeout 30 node_modules/.bin/prettier --write --ignore-unknown "$@") >/dev/null 2>&1 || true
    ;;
  gofmt)
    with_timeout 20 gofmt -w "$@" >/dev/null 2>&1 || true
    ;;
  esac
done

exit 0
