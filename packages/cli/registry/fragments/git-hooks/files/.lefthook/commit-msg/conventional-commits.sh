#!/bin/sh
# Conventional Commits subject check, run by lefthook's commit-msg hook with the message file as $1.
subject=$(sed -n '/^[^#]/{p;q;}' "$1")
case "$subject" in
  "Merge "* | "Revert \""* | "fixup! "* | "squash! "* | "amend! "*) exit 0 ;;
esac
if printf '%s\n' "$subject" | grep -Eq '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^()]+\))?!?: [^ ]'; then
  exit 0
fi
echo "commit message must follow Conventional Commits: type(scope)!: description" >&2
echo "  types: feat fix docs style refactor perf test build ci chore revert; scope and ! optional" >&2
echo "  example: feat(api): add item search" >&2
exit 1
