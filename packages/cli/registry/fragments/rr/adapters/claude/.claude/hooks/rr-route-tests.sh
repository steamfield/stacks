#!/usr/bin/env bash
# PreToolUse (Bash): sends this project's test commands through rr, so parallel agents queue on
# rr's host lock instead of running suites at the same moment. Each line of rr-routes.txt is
# "<command>|<rr task>". A Bash call that is exactly the command becomes `rr <task>`, and the
# command followed by arguments becomes `rr <task> -- <arguments>`. Anything else passes
# unchanged: compound commands (&&, ;, |, redirects, $(...)), other commands, and rr itself.
#
# The rewrite is returned as updatedInput with no permission decision, so the rr command goes
# through the normal permission rules. Needs jq; without it every call passes unchanged.
set -eu

payload=$(cat 2>/dev/null) || { while IFS= read -r _; do :; done; echo "rr-route-tests.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "rr-route-tests.sh: jq is missing; allowing this call." >&2; exit 0; }
routes="$(dirname "${BASH_SOURCE[0]}")/rr-routes.txt"
[ -r "$routes" ] || { echo "rr-route-tests.sh: routes are unreadable; allowing this call." >&2; exit 0; }

cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null) || { echo "rr-route-tests.sh: unreadable payload; allowing this call." >&2; exit 0; }
case "$cmd" in
  '' | *[\;\&\|\<\>\`\$\(\)]* | *$'\n'*) exit 0 ;;
esac

while IFS='|' read -r local task; do
  case "$local" in '' | '#'*) continue ;; esac
  [ -n "$task" ] || continue
  case "$cmd" in
    "$local") new="rr $task" ;;
    "$local "*) new="rr $task -- ${cmd#"$local "}" ;;
    *) continue ;;
  esac
  printf '%s' "$payload" | jq -c --arg cmd "$new" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: (.tool_input + {command: $cmd})}}'
  exit 0
done <"$routes"
