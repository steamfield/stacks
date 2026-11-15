# shellcheck shell=bash
# Shared helpers for the hooks in this directory. Sourced, never executed:
#   source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
#
# Written for bash 3.2 (the macOS default) under `set -euo pipefail`.

# hook_get <payload-json> <path>: print every string value at <path>, one per
# line (a value may itself hold newlines). <path> names object keys joined by
# dots, with [] for any array element: tool_input.command,
# tool_input.edits.[].new_string. Only string values are read.
#
# jq reads the payload when it is on PATH. Without it a small awk reader walks
# the JSON instead, so every hook makes the same decision either way. The
# reader decodes the standard escapes and \u escapes for printable ASCII; other
# \u escapes stay as written, which no pattern in these hooks depends on.
hook_get() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r --arg want "$2" '
      paths(type == "string") as $p
      | select($p | map(if type == "number" then "[]" else . end) | join(".") == $want)
      | getpath($p)' 2>/dev/null
    return
  fi
  printf '%s' "$1" | LC_ALL=C awk -v want="$2" '
    function hexval(h, i, c, v) {
      v = 0
      for (i = 1; i <= 4; i++) {
        c = index("0123456789abcdef", tolower(substr(h, i, 1)))
        if (c == 0) return -1
        v = v * 16 + c - 1
      }
      return v
    }
    function here(p, j) {
      p = ""
      for (j = 1; j <= d; j++) p = p (j > 1 ? "." : "") k[j]
      return p
    }
    { s = s $0 "\n" }
    END {
      n = length(s); i = 1; d = 0; iskey = 0
      while (i <= n) {
        c = substr(s, i, 1)
        if (c == "{") { d++; t[d] = "o"; k[d] = ""; iskey = 1; i++; continue }
        if (c == "[") { d++; t[d] = "a"; k[d] = "[]"; iskey = 0; i++; continue }
        if (c == "}" || c == "]") { d--; iskey = 0; i++; continue }
        if (c == ",") { iskey = (t[d] == "o"); i++; continue }
        if (c != "\"") { i++; continue }
        key = iskey; emit = !key && here() == want; str = ""; i++
        while (i <= n) {
          c = substr(s, i, 1)
          if (c == "\"") { i++; break }
          if (c == "\\") {
            e = substr(s, i + 1, 1); i += 2
            if (e == "n") c = "\n"; else if (e == "t") c = "\t"; else if (e == "r") c = "\r"
            else if (e == "b") c = "\b"; else if (e == "f") c = "\f"
            else if (e == "u") {
              v = hexval(substr(s, i, 4))
              if (v >= 32 && v < 127) { c = sprintf("%c", v); i += 4 }
              else c = "\\u"
            } else c = e
          } else i++
          if (key) str = str c; else if (emit) printf "%s", c
        }
        if (key) { k[d] = str; iskey = 0 } else if (emit) printf "\n"
      }
    }'
}

# json_quote <text>: <text> as a JSON string, control bytes other than tab and
# newline dropped. Needs no jq, so a block reads the same on every machine.
json_quote() {
  printf '%s' "$1" | tr -d '\000-\010\013\014\016-\037' |
    sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' |
    awk 'BEGIN { printf "\"" } NR > 1 { printf "\\n" } { printf "%s", $0 } END { printf "\"" }'
}

# hook_deny <reason>: the PreToolUse response that denies the tool call. The
# agent sees <reason>; keep it free of the text that matched.
hook_deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
    "$(json_quote "$1")"
}

# hook_context <event> <text>: hand <text> to the agent as additional context.
hook_context() {
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":%s}}\n' \
    "$1" "$(json_quote "$2")"
}

# The invoking adapter supplies CLAUDE_PROJECT_DIR when available. Otherwise
# resolve from this shared library, so tool cwd never selects another project.
project_root() {
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -d "${CLAUDE_PROJECT_DIR}" ]; then
    printf '%s\n' "$CLAUDE_PROJECT_DIR"
    return 0
  fi
  (cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
}

# find_up <start-dir> <name>...: print the nearest directory, walking up from
# start-dir, that contains any of the names (a name may be a relative path such
# as node_modules/.bin/biome). Returns 1 when nothing matches.
find_up() {
  local dir=$1
  shift
  local name
  while :; do
    for name in "$@"; do
      if [ -e "$dir/$name" ]; then
        printf '%s\n' "$dir"
        return 0
      fi
    done
    if [ "$dir" = "/" ] || [ -z "$dir" ]; then
      return 1
    fi
    dir=$(dirname "$dir")
  done
}

# with_timeout <seconds> <cmd>...: run cmd, killing it after <seconds>. macOS
# ships no coreutils `timeout`, so race the command against a sleeper.
#
# Output goes through a temp file rather than straight to stdout: if the command
# spawns a grandchild (bunx, npx, uv), killing the child would leave the
# grandchild holding a command-substitution pipe open and the caller would block
# anyway. The sleeper's own output is sent to /dev/null for the same reason.
#
# Prints the captured stdout+stderr. Returns 124 on timeout, else the command's
# exit status.
with_timeout() {
  local secs=$1
  shift
  local tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/claude-hook.XXXXXX") || return 1

  "$@" >"$tmp" 2>&1 </dev/null &
  local pid=$!
  (sleep "$secs" && kill -9 "$pid") >/dev/null 2>&1 </dev/null &
  local killer=$!

  local rc=0
  wait "$pid" 2>/dev/null || rc=$?
  kill "$killer" 2>/dev/null || true
  wait "$killer" 2>/dev/null || true

  cat "$tmp"
  rm -f "$tmp"
  # 137 = SIGKILL, i.e. the sleeper won the race.
  [ "$rc" -eq 137 ] && return 124
  return "$rc"
}

# session_file_list <payload-json>: print the path of this session's list of
# written files, creating its directory. The list lives outside the repo, keyed
# by the payload's session_id reduced to [A-Za-z0-9_-] so it can't name a path
# elsewhere. Returns 1 when the payload has no usable session_id.
session_file_list() {
  local id dir
  id=$(hook_get "$1" session_id | head -n 1) || return 1
  id=$(printf '%s' "$id" | tr -cd 'A-Za-z0-9_-')
  [ -n "$id" ] || return 1
  dir="${TMPDIR:-/tmp}"
  dir="${dir%/}/stacks-hooks"
  mkdir -p "$dir" 2>/dev/null || return 1
  printf '%s/%s.files\n' "$dir" "$id"
}

# strip_control: drop ANSI escapes and other control bytes that would make a jq
# payload unreadable, keeping tabs and newlines.
strip_control() {
  sed -e $'s/\x1b\\[[0-9;]*[A-Za-z]//g' | tr -d '\000-\010\013\014\016-\037'
}

# check_patch <payload-json> <secret-guard>: translate patch marker paths and
# added text without evaluating shell escapes. Every file uses the same guard.
check_patch() {
  local patch file="" text="" line secret_guard=$2
  patch=$(hook_get "$1" tool_input.command)

  check_patch_file() {
    [ -n "$file" ] || return 0
    local payload decision
    payload=$(printf '{"tool_input":{"file_path":%s,"content":%s}}' \
      "$(json_quote "$file")" "$(json_quote "$text")")
    decision=$(printf '%s' "$payload" | bash "$secret_guard")
    if [ -n "$decision" ]; then
      printf '%s\n' "$decision"
      exit 0
    fi
  }

  while IFS= read -r line; do
    case "$line" in
      '*** Add File: '* | '*** Update File: '* | '*** Move to: '*)
        check_patch_file
        file=${line#*: }
        text=""
        ;;
      '*** Delete File: '* | '*** End Patch')
        check_patch_file
        file=""
        text=""
        ;;
      '+'*) text="$text${line:1}"$'\n' ;;
    esac
  done <<<"$patch"
  check_patch_file
}

# Executable foreground segments for stack anti-hang rules. Quotes are decoded only
# after splitting; background pipelines and positive timeouts are skipped together.
foreground_commands() { shell_commands 1 "$1"; }

# Publication checks also inspect detached and time-limited commands, with tab-separated argv.
executable_commands() { shell_commands 0 "$1"; }

shell_commands() {
  local foreground=$1
  shift
  printf '%s\n' "$1" | LC_ALL=C awk -v foreground="$foreground" '
    function emit(raw, depth, n, w, i, base, wrapped, started, out, limit) {
      if (depth > 8) return
      n = words(raw, w); wrapped = 0; started = 0; out = ""
      for (i = 1; i <= n; i++) {
        if (w[i] == "") continue
        if (!started) {
          if (w[i] ~ /^[A-Za-z_][A-Za-z0-9_]*=/) continue
          base = w[i]; sub(/.*\//, "", base)
          if (base == "timeout") {
            limit = w[++i]
            if (limit !~ /^[0-9]+(\.[0-9]+)?[smhd]?$/) return
            if (foreground && limit + 0 > 0) return
            wrapped = 1; continue
          }
          if (base ~ /^(sh|bash|zsh|dash|ksh)$/ && w[i + 1] ~ /^-[a-z]*c[a-z]*$/) {
            scan(w[i + 2], depth + 1); return
          }
          if (base == "uv" && w[i + 1] == "run") { i++; wrapped = 1; continue }
          if (base ~ /^(env|command|builtin|exec|nice|nohup|sudo|doas|time|xargs|busybox|stdbuf|uvx)$/) {
            wrapped = 1; continue
          }
          if (wrapped && w[i] ~ /^(--with|--project|--directory|--env-file|-C|-u)$/) { i++; continue }
          if (wrapped && (w[i] ~ /^-/ || w[i] ~ /^[0-9][0-9.]*$/)) continue
          started = 1
        }
        out = out (out == "" ? "" : (foreground ? " " : "\t")) w[i]
      }
      gsub(/\n/, " ", out)
      if (out != "") print out
    }
    function words(raw, w, i, c, q, n, value, started) {
      n = 0; value = ""; q = ""; started = 0
      for (i = 1; i <= length(raw); i++) {
        c = substr(raw, i, 1)
        if (c == "$" && substr(raw, i + 1, 1) == "\047" && q == "") continue
        if (c == "\\" && q != "\047") { value = value substr(raw, ++i, 1); started = 1; continue }
        if (q != "") { if (c == q) q = ""; else value = value c }
        else if (c == "\047" || c == "\"") { q = c; started = 1 }
        else if (c ~ /[ \t\n]/) {
          if (started) w[++n] = value
          value = ""; started = 0
        } else { value = value c; started = 1 }
      }
      if (started) w[++n] = value
      return n
    }
    function group(text, depth, at, part) {
      while ((at = index(text, "\034")) > 0) {
        part = substr(text, 1, at - 1); text = substr(text, at + 1)
        emit(part, depth)
      }
      emit(text, depth)
    }
    function scan(text, depth, i, c, q, out, following, pipeline, here, at, raw, names, delimiter, line, stop) {
      q = ""; out = ""; pipeline = ""; here = ""
      for (i = 1; i <= length(text); i++) {
        c = substr(text, i, 1); following = substr(text, i + 1, 1)
        if (c == "\\" && q != "\047" && i < length(text)) {
          out = out c following; i++; continue
        }
        if (q != "") { if (c == q) q = ""; out = out c; continue }
        if (c == "\047" || c == "\"") { q = c; out = out c; continue }
        if (c == "#" && (out == "" || out ~ /[ \t]$/)) {
          while (i <= length(text) && substr(text, i, 1) != "\n") i++
          c = "\n"; following = ""
        }
        if (c == "<" && following == "<" && substr(text, i + 2, 1) != "<") {
          i += 2
          if (substr(text, i, 1) == "-") i++
          while (substr(text, i, 1) ~ /[ \t]/) i++
          raw = ""
          while (i <= length(text) && substr(text, i, 1) !~ /[ \t\n;&|]/) raw = raw substr(text, i++, 1)
          if (words(raw, names) != 1) return
          here = here names[1] "\034"; i--; out = out " "; continue
        }
        if (c == "&" && (following == ">" || substr(text, i - 1, 1) ~ /[<>]/)) {
          out = out c; continue
        }
        if ((c == "&" || c == "|") && following == c) {
          pipeline = pipeline out "\034"; out = ""; i++; continue
        }
        if (c == "|" && following != "|") {
          pipeline = pipeline out "\034"; out = ""
          if (following == "&") i++
        } else if (c == ";" || c == "&" || c == "|" || c == "\n") {
          if (c != "&" || !foreground) group(pipeline out, depth)
          pipeline = ""; out = ""
          if (c == "\n") {
            while ((at = index(here, "\034")) > 0) {
              delimiter = substr(here, 1, at - 1); here = substr(here, at + 1)
              stop = 0
              while (i < length(text)) {
                i++; line = ""
                while (i <= length(text) && substr(text, i, 1) != "\n") line = line substr(text, i++, 1)
                sub(/^\t+/, "", line)
                if (line == delimiter) { stop = 1; break }
              }
              if (!stop) return
            }
          }
        } else out = out c
      }
      if (q == "") group(pipeline out, depth)
    }
    { text = text (NR == 1 ? "" : "\n") $0 }
    END { scan(text, 0) }'
}

# hook_foreground_commands <payload-json>: validate the native Bash input, then split it.
hook_foreground_commands() {
  local command
  command=$(printf '%s' "$1" | jq -r '
    if .tool_input.run_in_background == true then empty
    elif .tool_input.command == null then empty
    elif (.tool_input.command | type) == "string" then .tool_input.command
    else error("invalid command") end') || return 1
  foreground_commands "$command"
}
