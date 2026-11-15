#!/usr/bin/env bash
# PreToolUse (Bash): prevent commands that would hold the session open.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { echo "guard-maven.sh: jq is missing; allowing this call." >&2; exit 0; }

input="$(cat)" || { echo "guard-maven.sh: cannot read payload; allowing this call." >&2; exit 0; }

deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }}'
  exit 0
}

# Split executable segments before unquoting arguments, as the shared shell guard does.
# Known wrappers are unwrapped without executing the payload; opaque forms pass.
commands() {
  printf '%s\n' "$1" | LC_ALL=C awk -v anti_hang=1 '
    function emit(raw, depth, n, w, i, base, wrapped, started, out, rest, limit) {
      if (depth > 2 || (anti_hang && raw ~ /&[ \t]*$/)) return
      sub(/&[ \t]*$/, "", raw)
      gsub(/\n/, " ", raw)
      gsub(/\$\047/, "\047", raw)
      gsub(/[\047"\\]/, "", raw)
      n = split(raw, w, /[ \t]+/); wrapped = 0; started = 0; out = ""
      for (i = 1; i <= n; i++) {
        if (w[i] == "") continue
        if (!started) {
          if (w[i] ~ /^[A-Za-z_][A-Za-z0-9_]*=/) continue
          base = w[i]; sub(/.*\//, "", base)
          if (base == "timeout") {
            limit = w[++i]
            if (limit !~ /^[0-9]+(\.[0-9]+)?[smhd]?$/) return
            if (anti_hang && limit + 0 > 0) return
            wrapped = 1; continue
          }
          if (base ~ /^(sh|bash|zsh|dash|ksh)$/ && w[i + 1] ~ /^-[a-z]*c[a-z]*$/) {
            rest = ""; for (i += 2; i <= n; i++) rest = rest " " w[i]
            scan(rest, depth + 1); return
          }
          if (base == "uv" && w[i + 1] == "run") { i++; wrapped = 1; continue }
          if (base ~ /^(env|command|builtin|exec|nice|nohup|sudo|doas|time|xargs|busybox|stdbuf|uvx)$/) {
            wrapped = 1; continue
          }
          if (wrapped && w[i] ~ /^(--with|--project|--directory|--env-file|-C|-u)$/) { i++; continue }
          if (wrapped && (w[i] ~ /^-/ || w[i] ~ /^[0-9][0-9.]*$/)) continue
          started = 1
        }
        out = out (out == "" ? "" : " ") w[i]
      }
      if (out != "") print out
    }
    function scan(text, depth, i, c, q, out, following) {
      q = ""; out = ""
      for (i = 1; i <= length(text); i++) {
        c = substr(text, i, 1); following = substr(text, i + 1, 1)
        if (c == "\\" && q != "\047" && i < length(text)) {
          out = out c following; i++; continue
        }
        if (q != "") { if (c == q) q = ""; out = out c; continue }
        if (c == "\047" || c == "\"") { q = c; out = out c; continue }
        if (c == ";" || c == "&" || c == "|" || c == "\n") {
          if (c == "&" && following != "&") out = out " &"
          emit(out, depth); out = ""
          if (following == c) i++
        } else out = out c
      }
      if (q == "") emit(out, depth)
    }
    { text = text (NR == 1 ? "" : "\n") $0 }
    END { scan(text, 0) }'
}

command="$(printf '%s' "$input" | jq -r 'if (.tool_input.command == null) then empty elif (.tool_input.command | type) == "string" then .tool_input.command else error("invalid command") end' 2>/dev/null)" || { echo "guard-maven.sh: unreadable payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 && command -v grep >/dev/null 2>&1 || { echo "guard-maven.sh: required tools are missing; allowing this call." >&2; exit 0; }
lines="$(commands "$command" 2>/dev/null)" || { echo "guard-maven.sh: cannot parse command; allowing this call." >&2; exit 0; }
while IFS= read -r line; do
  [ -n "$line" ] || continue
  if printf '%s\n' "$line" | grep -Eq '(^|[[:space:]])(--help|--version|-h)([[:space:]]|$)'; then continue; fi
  if printf '%s\n' "$line" | grep -Eq '^([^[:space:]]*/)?mvnw?([[:space:]]|$)' &&
    printf '%s\n' "$line" | grep -Eq '[[:space:]]spring-boot:run([[:space:]]|$)'; then
    deny "spring-boot:run holds a JVM open. Run make serve in the background and stop the pid you started."
  fi
done <<<"$lines"
exit 0
