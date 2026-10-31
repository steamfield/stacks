#!/usr/bin/env bash
# PreToolUse (Bash, Edit|Write): keep Maven going through the committed
# wrapper and keep hands off what Maven writes.
#   Bash: `mvn` itself (the wrapper pins the project's Maven; `mvn -N
#   wrapper:wrapper` and `mvn -v` stay allowed).
#   Edit|Write: mvnw, mvnw.cmd, .mvn/wrapper/ and target/.
set -euo pipefail
command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"

deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }}'
  exit 0
}

command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
if [ -n "$command" ]; then
  # Each check looks at one shell command at a time, split on ; & | and newlines.
  segments="$(printf '%s\n' "$command" | awk '{ gsub(/[;&|]/, "\n"); print }')"
  while IFS= read -r segment; do
    if printf '%s' "$segment" | grep -Eq '(^|[[:space:]/])mvn([[:space:]]|$)' &&
      ! printf '%s' "$segment" | grep -Eq '[[:space:]](wrapper:wrapper|-v|--version)([[:space:]]|$)'; then
      deny "Run Maven through the project's wrapper: use the make targets (make help), or ./mvnw with the same arguments. The wrapper pins the Maven version CI uses; mvn is only for generating the wrapper (mvn -N wrapper:wrapper -Dtype=only-script)."
    fi
  done <<<"$segments"
  exit 0
fi

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)}"
physical="$(cd "$root" 2>/dev/null && pwd -P)" || physical="$root"
# Normalize dot segments and recognize both logical and physical project roots.
rel="$(printf '%s' "$input" | jq -r --arg root "$root" --arg physical "$physical" '
  def normalize:
    split("/") | reduce .[] as $part ([];
      if $part == "" or $part == "." then .
      elif $part == ".." and length > 0 and .[-1] != ".." then .[:-1]
      else . + [$part] end) | join("/");
  .tool_input.file_path | select(type == "string" and length > 0) as $path |
  ($path | normalize) as $file |
  ($root | normalize) as $logical |
  ($physical | normalize) as $real |
  if ($path | startswith("/")) then
    if ($file | startswith($logical + "/")) then $file[($logical | length) + 1:]
    elif ($file | startswith($real + "/")) then $file[($real | length) + 1:]
    else empty end
  else $file end
' 2>/dev/null)" || exit 0

case "$rel" in
  mvnw | mvnw.cmd | .mvn/wrapper/*)
    deny "The Maven wrapper is generated. To change the Maven version, run ./mvnw wrapper:wrapper -Dmaven=<version> -Dtype=only-script and commit the result."
    ;;
  target/*)
    deny "target/ is Maven's build output. Edit the source and rebuild (make build)."
    ;;
esac
exit 0
