#!/usr/bin/env bash
# Adapt native patch writes through the shared parser and secret guard.
set -euo pipefail
input=$(cat 2>/dev/null) || { while IFS= read -r _; do :; done; echo "agent-ops: cannot read patch payload; allowing call." >&2; exit 0; }
hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
{ [ -r "$hook_dir/../../.claude/hooks/_lib.sh" ] && source "$hook_dir/../../.claude/hooks/_lib.sh"; } 2>/dev/null || { echo "agent-ops: patch guard unavailable; allowing call." >&2; exit 0; }
check_patch "$input" "$hook_dir/../../.claude/hooks/detect-secrets.sh"
