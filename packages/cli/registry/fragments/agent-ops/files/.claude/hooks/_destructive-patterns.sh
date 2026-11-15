# shellcheck shell=bash
# Shared destructive-only rules for Bash 3.2. Prints reason<TAB>suggestion on a match.

# Split outside quotes. Mode 1 masks quoted text; mode 2 preserves separators
# for pipeline and fork-bomb checks. Unclosed quotes allow the command.
split_commands() {
  awk -v mode="$1" '
    { for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (c == "\\" && q != "\047" && i < length($0)) {
          i++; out = out (mode && q != "" ? "__" : c substr($0, i, 1)); continue
        }
        if (q != "") { if (c == q) q = ""; else if (mode) c = "_" }
        else if (c == "\047" || c == "\"") q = c
        else if (c == "#" && (i == 1 || substr($0, i - 1, 1) ~ /[ \t;&|]/)) break
        else if (mode != 2 && (c == ";" || c == "&" || c == "|")) c = "\n"
        out = out c
      }
      out = out "\n"
    }
    END { if (q == "") printf "%s", out }'
}

# Read literal arguments without evaluating variables or shell code.
literal_words() {
  awk '
    function emit() {
      if (word != "") print word
      word = ""
    }
    { for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (q != "") { if (c == q) q = ""; else word = word c }
        else if (c == "\047" || c == "\"") q = c
        else if (c ~ /[ \t]/) emit()
        else word = word c
      }
      emit()
    }'
}

is_destructive() (
  local command=$1
  [ -n "$command" ] || return 1
  # Heredocs are outside this small matcher, never a deny by themselves.
  case "$command" in *'<<'*) return 1 ;; esac
  local segments quiet masked seg target root resolved found words rm_seen
  segments=$(split_commands 0 <<<"$command") || return 2
  quiet=$(split_commands 1 <<<"$command") || return 2
  masked=$(split_commands 2 <<<"$command") || return 2
  local end='([[:space:]]|$)'
  local wrap='(then|do|else|sudo|doas|env|exec|command|builtin|nohup|time|nice|timeout)'
  local wrap_arg='(-[^[:space:]]*|[0-9][^[:space:]]*|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*)'
  local start="^[[:space:]]*(${wrap}([[:space:]]+${wrap_arg})*[[:space:]]+|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*([^[:space:]\"';&|]*/)?"
  local git_='git([[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+|--(git-dir|work-tree|namespace|config-env)[[:space:]]+[^[:space:]]+|-[[:alpha:]]+|--[[:alnum:]-]+(=[^[:space:]]*)?))*[[:space:]]+'
  # Operational failures are distinct from a pattern that did not match.
  matches() {
    local status
    if command grep "$@"; then return 0; else status=$?; fi
    [ "$status" -eq 1 ] && return 1
    exit 2
  }
  c() { matches -qE -e "${start}$1" <<<"$quiet"; }
  hit() { printf '%s\tAsk the user first.' "$1"; }

  while IFS= read -r seg; do
    matches -qE -e "${start}rm[[:space:]]" <<<"$seg" || continue
    words=$(literal_words <<<"$seg") || return 2
    rm_seen=0
    while IFS= read -r target; do
      if [ "$rm_seen" -eq 0 ]; then
        case "$target" in rm | */rm) rm_seen=1 ;; esac
        continue
      fi
      case "$target" in
      / | '/*' | '~' | '~/' | '$HOME' | '${HOME}' | . | .. | ./)
        hit "rm targeting the filesystem root, home, or working directory."; return 0 ;;
      -* | *'$'* | *'`'* | *'*'* | *'?'* | *'['* | *'\\'*) continue ;;
      /*)
        [ -n "${CLAUDE_PROJECT_DIR:-}" ] || continue
        root=$(cd "$CLAUDE_PROJECT_DIR" 2>/dev/null && pwd -P) || continue
        if [ -d "$target" ]; then
          resolved=$(cd "$target" 2>/dev/null && pwd -P) || continue
        elif [ -f "$target" ] && [ ! -L "$target" ]; then
          resolved=$(cd "$(dirname "$target")" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "$(basename "$target")") || continue
        else
          continue
        fi
        case "$resolved" in "$root" | "$root"/*) ;; *) hit "rm targets an absolute path outside the project."; return 0 ;; esac
        ;;
      esac
    done <<<"$words"
  done <<<"$segments"

  if c "${git_}reset[[:space:]]+(.*[[:space:]])?--hard${end}" ||
    c "${git_}checkout[[:space:]]+(.*[[:space:]])?\\.${end}"; then
    hit "This git command discards uncommitted work."; return 0
  fi
  while IFS= read -r seg; do
    matches -qE -e "${start}${git_}restore[[:space:]]+(.*[[:space:]])?\\.${end}" <<<"$seg" || continue
    if ! matches -qE -e "[[:space:]](--staged|-[[:alpha:]]*S[[:alpha:]]*)${end}" <<<"$seg" ||
      matches -qE -e "[[:space:]](--worktree|-[[:alpha:]]*W[[:alpha:]]*)${end}" <<<"$seg"; then
      hit "git restore . discards uncommitted work."; return 0
    fi
  done <<<"$quiet"
  while IFS= read -r seg; do
    matches -qE -e "${start}${git_}clean[[:space:]]+(.*[[:space:]])?(-[[:alpha:]]*f[[:alpha:]]*|--force)${end}" <<<"$seg" || continue
    matches -qE -e "[[:space:]](-[[:alpha:]]*n[[:alpha:]]*|--dry-run)${end}" <<<"$seg" && continue
    hit "git clean -f deletes untracked files."; return 0
  done <<<"$quiet"
  if c "${git_}push[[:space:]]+(.*[[:space:]])?(-[[:alpha:]]*f[[:alpha:]]*|--force|\\+[^[:space:]]+|--delete|-[[:alpha:]]*d[[:alpha:]]*|:[^[:space:]]+)${end}" ||
    c "${git_}filter-(branch|repo)${end}"; then
    hit "This git command rewrites history or deletes remote branches."; return 0
  fi
  if c "${git_}(commit|push)[[:space:]]+(.*[[:space:]])?--no-verify${end}"; then
    hit "--no-verify skips the project's git hooks."; return 0
  fi

  while IFS= read -r seg; do
    found=$(split_commands 1 <<<"$seg") || return 2
    matches -qE -e "${start}(psql|pgcli|mysql|mariadb|mycli|sqlite3|litecli|sqlcmd|duckdb|clickhouse(-client)?|cockroach|snowsql)${end}" <<<"$found" || continue
    words=$(literal_words <<<"$seg") || return 2
    while IFS= read -r target; do
      if matches -qiE -e '(^|;)[[:space:]]*(drop[[:space:]]+(table|database|schema)|truncate)[[:space:]]' <<<"$target"; then
        hit "DROP or TRUNCATE causes irreversible data loss."; return 0
      fi
    done <<<"$words"
  done <<<"$segments"

  if c 'mkfs[^[:space:]]*([[:space:]]|$)' ||
    c 'dd[[:space:]].*of=/dev/(sd|nvme|hd|r?disk|mapper|vd|xvd)' ||
    matches -qE -e '>[[:space:]]*/dev/(sd|nvme|hd|r?disk|mapper|vd|xvd)' <<<"$masked" ||
    matches -qE -e '([[:alnum:]_:]+)[[:space:]]*\(\)[[:space:]]*\{[[:space:]]*\1[[:space:]]*\|[[:space:]]*\1[[:space:]]*&[[:space:]]*\}[[:space:]]*;' <<<"$masked"; then
    hit "This command overwrites a disk or exhausts the machine's processes."; return 0
  fi

  # Match subcommands after known global options, never arbitrary later arguments.
  local pm_options='([[:space:]]+(--(registry|prefix|workspace|filter|cwd)(=[^[:space:]]+|[[:space:]]+[^[:space:]]+)|--(silent|quiet)|-s))*[[:space:]]+'
  # Only package publication supports this dry-run exemption.
  while IFS= read -r seg; do
    matches -qE -e "${start}(npm|pnpm|yarn|bun)${pm_options}publish${end}" <<<"$seg" || continue
    matches -qE -e "[[:space:]]--dry-run${end}" <<<"$seg" && continue
    hit "Publishing or changing a release is irreversible."; return 0
  done <<<"$quiet"
  if c "(npm|pnpm|yarn)${pm_options}(unpublish|version)${end}" ||
    c "npm${pm_options}dist-tag${end}" ||
    c "bun${pm_options}pm[[:space:]]+version${end}" ||
    c "((npx|bunx|bun[[:space:]]+x)[[:space:]]+)?changeset[[:space:]]+publish${end}" ||
    c "gh[[:space:]]+release[[:space:]]+create${end}"; then
    hit "Publishing or changing a release is irreversible."; return 0
  fi
  # Decode executable argv without treating quoted mentions as commands.
  local decoded program sub i arg snapshot dry goal destroy
  local -a argv
  decoded=$(executable_commands "$command") || return 2
  while IFS= read -r seg; do
    IFS=$'\t' read -r -a argv <<<"$seg" || continue
    [ "${#argv[@]}" -gt 0 ] || continue
    program=${argv[0]##*/}
    [ "$program" != mvnw ] || program=mvn
    sub=""; goal=0; snapshot=0; dry=0; destroy=0; i=1
    while [ "$i" -lt "${#argv[@]}" ]; do
      arg=${argv[$i]}
      i=$((i + 1))
      case "$program:$arg" in
        mvn:-f|mvn:--file|mvn:-pl|mvn:--projects|mvn:-s|mvn:--settings|mvn:-gs|mvn:--global-settings|\
        mvn:-t|mvn:--toolchains|mvn:-gt|mvn:--global-toolchains|mvn:-rf|mvn:--resume-from|\
        mvn:-P|mvn:--activate-profiles|mvn:-T|mvn:--threads|mvn:-b|mvn:--builder|mvn:-l|mvn:--log-file)
          i=$((i + 1)); continue ;;
        mvn:deploy|mvn:deploy:deploy|mvn:deploy:deploy-file|mvn:central-publishing:publish|mvn:gpg:sign-and-deploy-file)
          goal=1 ;;
        cargo:--dry-run) dry=1 ;;
        goreleaser:--snapshot|goreleaser:--snapshot=true) snapshot=1 ;;
        goreleaser:--snapshot=false) snapshot=0 ;;
        terraform:-destroy|terraform:-destroy=true|tofu:-destroy|tofu:-destroy=true) destroy=1 ;;
        terraform:-destroy=false|tofu:-destroy=false) destroy=0 ;;
      esac
      if [ -z "$sub" ]; then
        case "$arg" in
          --directory|--project|--config-file|--cache-dir|--python|--config|--color|--log-level|-C|-c|-f|-Z)
            i=$((i + 1)); continue ;;
          -*|+*) continue ;;
        esac
        sub=$arg
      fi
    done
    case "$program:$sub" in
      mvn:*) [ "$goal" -eq 1 ] || continue ;;
      cargo:publish) [ "$dry" -eq 0 ] || continue ;;
      wasm-pack:publish|uv:publish|poetry:publish|twine:upload|gem:push) ;;
      goreleaser:release) [ "$snapshot" -eq 0 ] || continue ;;
      terraform:apply|tofu:apply) [ "$destroy" -eq 1 ] || continue ;;
      terraform:destroy|tofu:destroy|pulumi:destroy) ;;
      *) continue ;;
    esac
    hit "Publishing or destroying infrastructure is irreversible."; return 0
  done <<<"$decoded"
  local kube_options='([[:space:]]+(-n|--(namespace|context|kubeconfig|cluster|user))(=[^[:space:]]+|[[:space:]]+[^[:space:]]+))*[[:space:]]+'
  if c "gh[[:space:]]+(repo|release)[[:space:]]+delete${end}" ||
    c "kubectl${kube_options}delete${end}" ||
    c "aws[[:space:]]+s3[[:space:]]+(rm[[:space:]]+(.*[[:space:]])?--recursive|rb[[:space:]]+(.*[[:space:]])?--force)${end}"; then
    hit "This command deletes releases, infrastructure, or cloud data."; return 0
  fi
  local pipeline_start="(^|[;&|])${start#^}"
  if matches -qE -e "${pipeline_start}(curl|wget)[[:space:]][^;&|]*\\|[[:space:]]*(sudo[[:space:]]+)?(ba|z|da|k)?sh${end}" <<<"$masked"; then
    hit "Piping a download into a shell runs unreviewed code."; return 0
  fi
  return 1
)
