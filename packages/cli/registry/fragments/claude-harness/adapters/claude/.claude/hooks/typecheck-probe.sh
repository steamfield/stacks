#!/usr/bin/env bash
# Checks typecheck-on-write.ts end to end, run by the claude-typecheck-hook verify step: builds a
# throwaway package under .claude/hooks/ holding one deliberate type error, feeds the hook a
# payload naming that file and fails unless the hook reports the error. Not wired as a hook.
#
# Run from the directory whose node_modules/.bin/tsc to use (the project root, or a workspace
# part); the tsc may also sit one directory down. The probe directory is removed on exit and on
# INT, TERM or HUP; one a SIGKILL leaves behind holds a `*` .gitignore, so git never sees it.
set -u

hooks=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "$hooks/../.." && pwd)

tsc=""
for candidate in node_modules/.bin/tsc ./*/node_modules/.bin/tsc; do
  if [ -x "$candidate" ]; then
    tsc=$candidate
    break
  fi
done
if [ -z "$tsc" ]; then
  echo "typecheck-probe: no node_modules/.bin/tsc here or one directory down; install typescript" >&2
  exit 1
fi

probe=$(mktemp -d "$hooks/.typecheck-probe.XXXXXX") || exit 1
printf '*\n' >"$probe/.gitignore"
trap 'rm -rf "$probe"' EXIT
trap 'rm -rf "$probe"; exit 1' INT TERM HUP

# The hook type-checks the nearest package with its own tsc, so the probe gets a symlinked tsc
# and a tsconfig that sees only the probe file, whatever the project's own tsconfig includes.
mkdir -p "$probe/node_modules/.bin"
ln -s "$PWD/$tsc" "$probe/node_modules/.bin/tsc"
printf '{"compilerOptions":{"strict":true,"noEmit":true,"types":[]},"files":["probe.ts"]}\n' >"$probe/tsconfig.json"
printf 'export const n: number = "text";\n' >"$probe/probe.ts"

# CLAUDE_PROJECT_DIR is pinned so a value inherited from another session can't move the root.
out=$(printf '{"tool_input":{"file_path":"%s/probe.ts"}}' "$probe" |
  CLAUDE_PROJECT_DIR="$root" bun "$hooks/typecheck-on-write.ts")
case "$out" in
*"type error(s), 1 in probe.ts"*) echo "typecheck-probe: typecheck-on-write.ts reported the deliberate type error" ;;
*)
  echo "typecheck-probe: typecheck-on-write.ts reported nothing for a deliberate type error" >&2
  exit 1
  ;;
esac
