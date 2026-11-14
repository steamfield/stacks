#!/usr/bin/env bash
# Smoke test for rr-route-tests.sh, run by the rr-routes verify step: every route names a task
# `rr tasks` lists, its command (alone and with arguments) is rewritten to that task, near misses
# pass unchanged, and settings.json wires the hook. Not wired as a hook.
set -eu
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

h=.claude/hooks
fail() {
  echo "rr-routes: $*" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || fail "rr-route-tests.sh needs jq on PATH"
# routed <command>: the command the hook rewrites it to, or nothing.
routed() {
  jq -cn --arg c "$1" '{tool_name: "Bash", tool_input: {command: $c, description: "d"}}' |
    bash $h/rr-route-tests.sh | jq -r '.hookSpecificOutput.updatedInput.command // empty'
}

tasks=$(rr tasks 2>/dev/null) || fail "rr tasks failed; run it to see why"
count=0
while IFS='|' read -r cmd task; do
  case "$cmd" in '' | '#'*) continue ;; esac
  count=$((count + 1))
  printf '%s' "$tasks" | jq -e --arg t "$task" '.data.tasks | any(.name == $t)' >/dev/null ||
    fail "the route for '$cmd' names '$task', which rr tasks doesn't list"
  [ "$(routed "$cmd")" = "rr $task" ] || fail "'$cmd' should become 'rr $task'"
  [ "$(routed "$cmd -x")" = "rr $task -- -x" ] || fail "'$cmd -x' should become 'rr $task -- -x'"
  [ -z "$(routed "$cmd && true")" ] || fail "a compound command should pass unchanged"
  [ -z "$(routed "rr $task")" ] || fail "'rr $task' should pass unchanged"
done <$h/rr-routes.txt
[ "$count" -gt 0 ] || fail "rr-routes.txt has no routes"
[ -z "$(routed "git status")" ] || fail "git status should pass unchanged"

grep -q 'hooks/rr-route-tests.sh' .claude/settings.json || fail ".claude/settings.json doesn't wire rr-route-tests.sh"
echo "rr-routes: $count routes OK"
