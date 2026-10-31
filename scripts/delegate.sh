#!/usr/bin/env bash
# Run a Codex delegate on a contract file inside its own linked worktree and print a digest.
#
#   scripts/delegate.sh <contract.md> --worktree <path> [--write] [--resume <session>]
#
# Read-only by default; --write lets Codex edit files in the worktree. --resume continues the
# session an earlier run's digest printed, with <contract.md> as the follow-up, so Codex keeps
# what it learned. The script never commits: the orchestrator (Claude) reviews the diff,
# refactors, runs the gate and owns the commit. .claude/skills/delegate/SKILL.md is the workflow.
#
# Model and effort: DELEGATE_MODEL (default: the newest sol model Codex lists), DELEGATE_EFFORT
# (default high). The default is read from Codex's model cache (${CODEX_HOME:-~/.codex}/
# models_cache.json): the highest-versioned listed `gpt-<version>-sol`. Without a usable cache it
# is FALLBACK_MODEL below, so bump that when a newer sol model ships. The chosen model is exported
# as DELEGATE_MODEL, which the contract templates' review command uses; the digest names it, so a
# run that fails on a model the cache lists but Codex can't run shows which one to override.
# Service tier: DELEGATE_SERVICE_TIER (default priority, Codex's fast mode: about twice the speed
# for more usage; `default` turns it off). Codex drops a tier the model doesn't offer.
# Wall clock: DELEGATE_TIMEOUT_SECS (default 3600). Run it in the background from Claude; a
# foreground Bash call is capped at 10 minutes. A run that hits the cap with a session id is
# resumed once, read-only, to write its hand-off into last-message.md, under its own cap
# DELEGATE_HANDOFF_SECS (default 600); the digest says whether a hand-off was written.
#
# Trust: Codex is trusted as much as Claude Code. With --write it runs without a sandbox, with
# your environment and your own ~/.codex/config.toml (MCP servers included), so feature work has
# the network, `bun add`, git, process inspection and the whole gate. The worktree isolates the
# work from other work; it doesn't contain Codex. Read-only mode uses Codex's read-only sandbox.
#
# Hooks: .codex/hooks.json runs the repo's command guard (.claude/hooks/guard-commands.ts) and
# destructive-command guard (.claude/hooks/block-destructive.sh) before each shell command, as
# Claude Code's settings do. The Edit/Write guards (secrets, repo content, boundaries) don't run
# on apply_patch, so the orchestrator's diff review covers them. Codex trusts a project hook only by its
# absolute path, and every worktree is a new path, so the run passes
# --dangerously-bypass-hook-trust: the hooks file is tracked, and the orchestrator reviews any
# change to it in the delegate's diff.
#
# Logs go outside the worktree so they survive its removal:
#   ${DELEGATE_LOG_ROOT:-$TMPDIR/stacks-delegate}/<worktree>-<timestamp>/

set -uo pipefail

PREAMBLE="You are working in a git worktree for an orchestrator that reviews, refactors and commits your work, so leave your changes uncommitted and don't push. Work in this worktree, not the main checkout. Run the checks the contract names. End with the hand-off report the contract asks for; if it asks for none, end with the files you changed, each check you ran with its result, what the orchestrator should look closer at, and open questions."

FALLBACK_MODEL="gpt-6.1-sol"

# The newest sol model Codex lists in its model cache, or nothing when the cache is missing,
# unreadable or lists none. Hidden models and variants (`-sol-mini`) are skipped.
newest_sol_model() {
    local cache="${CODEX_HOME:-$HOME/.codex}/models_cache.json"
    [ -r "$cache" ] || return 0
    jq -r '[.models[]
            | select(.visibility == "list" and (.slug | test("^gpt-[0-9]+(\\.[0-9]+)*-sol$")))
            | {slug, version: (.slug | ltrimstr("gpt-") | rtrimstr("-sol") | split(".") | map(tonumber))}]
           | sort_by(.version) | last | .slug // empty' "$cache" 2>/dev/null
}

MODEL="${DELEGATE_MODEL:-$(newest_sol_model)}"
MODEL="${MODEL:-$FALLBACK_MODEL}"
export DELEGATE_MODEL="$MODEL"
EFFORT="${DELEGATE_EFFORT:-high}"
SERVICE_TIER="${DELEGATE_SERVICE_TIER:-priority}"
TIMEOUT_SECS="${DELEGATE_TIMEOUT_SECS:-3600}"
HANDOFF_SECS="${DELEGATE_HANDOFF_SECS:-600}"
HANDOFF_PROMPT="Your time is up. Stop working and run no more commands. Write the hand-off now, in the contract's hand-off format if it has one: what is done, what is not, any measurements so far, and the state of the worktree."
LOG_ROOT="${DELEGATE_LOG_ROOT:-${TMPDIR:-/tmp}/stacks-delegate}"
LAST_MESSAGE_LINES=60

usage() {
    sed -n '4,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
}

die() {
    echo "delegate.sh: $*" >&2
    exit 2
}

# --- args ----------------------------------------------------------------------
[ $# -ge 1 ] || usage
CONTRACT="$1"
shift
WRITE=0
WT=""
RESUME=""
while [ $# -gt 0 ]; do
    case "$1" in
        --write) WRITE=1 ;;
        --resume)
            [ $# -ge 2 ] || die "--resume needs a session id"
            RESUME="$2"
            shift
            ;;
        --worktree)
            [ $# -ge 2 ] || die "--worktree needs a path"
            WT="$2"
            shift
            ;;
        -h | --help) usage ;;
        *) die "unknown argument: $1" ;;
    esac
    shift
done

[ -n "$WT" ] || die "--worktree is required"
[ -s "$CONTRACT" ] || die "contract missing or empty: $CONTRACT"
CONTRACT="$(cd "$(dirname "$CONTRACT")" && pwd -P)/$(basename "$CONTRACT")"

[ -d "$WT" ] || die "worktree not found: $WT"
WT="$(cd "$WT" && pwd -P)"
TOP="$(git -C "$WT" rev-parse --show-toplevel 2>/dev/null)" || die "not a git work tree: $WT"
[ "$TOP" = "$WT" ] || die "--worktree must be the worktree root ($TOP), got $WT"
# In the main checkout git-dir and git-common-dir are the same directory.
GIT_DIR_ABS="$(cd "$WT" && cd "$(git rev-parse --git-dir)" && pwd -P)"
GIT_COMMON_ABS="$(cd "$WT" && cd "$(git rev-parse --git-common-dir)" && pwd -P)"
[ "$GIT_DIR_ABS" != "$GIT_COMMON_ABS" ] ||
    die "refusing to run a delegate in the main checkout ($WT); create a worktree under .claude/worktrees/"
# A project with no package.json yet (a fresh scaffold the delegate sets up) has nothing to install.
[ ! -f "$WT/package.json" ] || [ -d "$WT/node_modules" ] ||
    die "$WT has no node_modules; run bun install --frozen-lockfile there first"
CODEX="${CODEX_BIN:-$(command -v codex)}"
[ -n "$CODEX" ] && [ -x "$CODEX" ] || die "codex not found on PATH (or set CODEX_BIN)"

# rr reaches the test hosts through the SSH agent (AGENTS.md "Test runs"). A terminal multiplexer
# started without one hands its panes a dead socket; on macOS, use the launchd agent instead.
ssh-add -l >/dev/null 2>&1
if [ $? -eq 2 ] && command -v launchctl >/dev/null; then
    sock="$(launchctl print "gui/$(id -u)/com.openssh.ssh-agent" 2>/dev/null |
        awk '/SSH_AUTH_SOCK =>/ { print $3; exit }')"
    [ -S "$sock" ] && export SSH_AUTH_SOCK="$sock"
fi
# The command guard denies a delegate the full gate; Claude runs it after review.
export STACKS_DELEGATE=1

# A resumed session already has the preamble.
PROMPT="$(cat "$CONTRACT")"
[ -n "$RESUME" ] || PROMPT="$PREAMBLE

$PROMPT"

mkdir -p "$LOG_ROOT" || die "cannot create log root $LOG_ROOT"
# mktemp keeps two runs started in the same second from sharing a directory.
RUN_DIR="$(mktemp -d "$LOG_ROOT/$(basename "$WT")-$(date +%Y%m%d-%H%M%S)-XXXX")" ||
    die "cannot create a log dir under $LOG_ROOT"
TIMED_OUT_MARK="$RUN_DIR/.timed-out"
HANDOFF_TIMED_OUT_MARK="$RUN_DIR/.handoff-timed-out"
START_MARK="$RUN_DIR/.start"
EVENTS="$RUN_DIR/events.jsonl"
LAST_FILE="$RUN_DIR/last-message.md"

# --- helpers -------------------------------------------------------------------

# run_capped <secs> <mark> <cmd...>: run cmd, touch <mark> and TERM it after <secs>, KILL 10s
# later. Only cmd is signalled, not its process group, so a command Codex started can outlive it.
# The watchdog's own fds point at /dev/null so a lingering sleep never holds the caller's stdout
# open.
run_capped() {
    local secs="$1" mark="$2"
    shift 2
    "$@" &
    local pid=$!
    (
        sleep "$secs" &
        s=$!
        trap 'kill "$s" 2>/dev/null; exit 0' TERM
        wait "$s"
        : >"$mark"
        kill -TERM "$pid" 2>/dev/null
        # In the background so the trap can end the grace period as soon as cmd exits.
        sleep 10 &
        s=$!
        wait "$s"
        kill -KILL "$pid" 2>/dev/null
    ) </dev/null >/dev/null 2>&1 &
    local wd=$!
    wait "$pid"
    local rc=$?
    kill -TERM "$wd" 2>/dev/null
    wait "$wd" 2>/dev/null
    return "$rc"
}

indent() {
    sed 's/^/  /'
}

changed_paths() {
    git -C "$WT" status --short --untracked-files=all 2>/dev/null | sort || true
}

# Files written during the run, including edits to paths already dirty and gitignored files,
# which a status diff alone would miss.
files_touched() {
    (cd "$WT" && find . \( -name .git -o -name node_modules -o -name dist -o -name coverage \
        -o -name logs -o -name .dev -o -name '*.tsbuildinfo' \) -prune \
        -o -type f -newer "$START_MARK" -print 2>/dev/null) | sed 's|^\./||' | sort
}

# The backticked paths in the contract's "- May change:" item, up to the next item or blank line.
allowed_paths() {
    awk '/^- May change:/ { f = 1 } f && (/^$/ || (/^- / && !/^- May change:/)) { f = 0 } f' \
        "$CONTRACT" | grep -o "\`[^\`]*\`" | tr -d "\`"
}

# Dirty paths that no May change entry covers. An entry ending in / covers everything under it;
# either kind also matches as a suffix, since contracts often name package-relative paths.
out_of_scope() {
    local allowed="$1" path entry ok
    while IFS= read -r path; do
        [ -n "$path" ] || continue
        ok=0
        while IFS= read -r entry; do
            case "$entry" in
                */) case "$path" in "$entry"* | */"$entry"*) ok=1 ;; esac ;;
                *) case "$path" in "$entry" | */"$entry") ok=1 ;; esac ;;
            esac
        done <<<"$allowed"
        [ "$ok" = 1 ] || echo "$path"
    done
}

BEFORE="$(changed_paths)"
: >"$START_MARK"
sleep 1 # mtime granularity: anything written from here on is -newer the mark

SANDBOX="read-only"
[ "$WRITE" = 1 ] && SANDBOX="danger-full-access"

# `exec resume` takes neither --cd nor --sandbox, so both modes run from the worktree and set the
# sandbox through config. Sessions persist (no --ephemeral) so a follow-up can resume them.
if [ -n "$RESUME" ]; then
    SUBCOMMAND=(exec resume)
    TARGET=("$RESUME" "$PROMPT")
else
    SUBCOMMAND=(exec)
    TARGET=("$PROMPT")
fi
FLAGS=(
    --dangerously-bypass-hook-trust
    --model "$MODEL"
    -c "model_reasoning_effort=\"$EFFORT\""
    -c "service_tier=\"$SERVICE_TIER\""
    -c 'approval_policy="never"'
    --json
    --output-last-message "$LAST_FILE"
)
cd "$WT" || die "cannot enter $WT"
START=$(date +%s)
run_capped "$TIMEOUT_SECS" "$TIMED_OUT_MARK" "$CODEX" "${SUBCOMMAND[@]}" "${FLAGS[@]}" \
    -c "sandbox_mode=\"$SANDBOX\"" \
    "${TARGET[@]}" \
    </dev/null >"$EVENTS" 2>"$RUN_DIR/stderr.txt"
RC=$?
SESSION="$(jq -r 'select(.type == "thread.started") | .thread_id' "$EVENTS" 2>/dev/null | head -1)"
SESSION="${SESSION:-$RESUME}"

# A timed-out run gets one read-only turn to say where it stopped, so the work isn't lost with it.
HANDOFF="no hand-off"
if [ -e "$TIMED_OUT_MARK" ] && [ -n "$SESSION" ]; then
    HANDOFF_EVENTS="$RUN_DIR/handoff-events.jsonl"
    run_capped "$HANDOFF_SECS" "$HANDOFF_TIMED_OUT_MARK" "$CODEX" exec resume "${FLAGS[@]}" \
        -c 'sandbox_mode="read-only"' \
        "$SESSION" "$HANDOFF_PROMPT" \
        </dev/null >"$HANDOFF_EVENTS" 2>"$RUN_DIR/handoff-stderr.txt"
    if [ ! -e "$HANDOFF_TIMED_OUT_MARK" ] && grep -q '"type":"turn.completed"' "$HANDOFF_EVENTS" &&
        [ -s "$LAST_FILE" ]; then
        HANDOFF="hand-off written"
    fi
fi
ELAPSED=$(($(date +%s) - START))

STATUS="failure"
# A failed turn names its cause even when codex also exits nonzero (a capacity error does both).
# Only a top-level event counts: an error item inside a completed turn (the hook-trust warning) is not a failure.
FAILED_EVENT="$(grep -m1 -E '^\{"type":"(turn\.failed|error)"' "$EVENTS" 2>/dev/null | cut -c1-300)"
if [ -e "$TIMED_OUT_MARK" ]; then
    REASON="timed out after ${TIMEOUT_SECS}s ($HANDOFF)"
elif [ -n "$FAILED_EVENT" ]; then
    REASON="turn failed: $FAILED_EVENT"
elif [ "$RC" -ne 0 ]; then
    REASON="codex exited $RC (see $RUN_DIR/stderr.txt)"
elif ! grep -q '"type":"turn.completed"' "$EVENTS"; then
    REASON="no turn.completed event"
elif [ ! -s "$LAST_FILE" ]; then
    REASON="empty last message"
else
    STATUS="success"
    REASON="turn completed"
fi

# --- digest --------------------------------------------------------------------
echo "delegate:  codex $MODEL ($EFFORT, $SERVICE_TIER, $([ "$WRITE" = 1 ] && echo write || echo read-only))"
echo "worktree:  $WT"
echo "exit:      $RC  (${ELAPSED}s)"
echo "result:    $STATUS - $REASON"
echo "logs:      $RUN_DIR"
echo "session:   ${SESSION:-(none)}  (follow up with --resume <session>)"
if printf '%s' "$FAILED_EVENT" | grep -qiE 'at capacity|rate limit|overloaded'; then
    echo "transient: resume ${SESSION:-<session>} with a short 'continue' follow-up; the work so far is in the worktree"
fi

COMMANDS="$(jq -r 'select(.type == "item.completed" and .item.type == "command_execution")
    | "  [\(.item.exit_code)] \(.item.command | .[0:160])"' "$EVENTS" 2>/dev/null)"
if [ -n "$COMMANDS" ]; then
    echo "commands:  $(echo "$COMMANDS" | wc -l | tr -d ' ')"
    echo "$COMMANDS" | head -20
else
    echo "commands:  0"
fi

AFTER="$(changed_paths)"
NEW_STATUS="$(comm -13 <(echo "$BEFORE") <(echo "$AFTER") | sed '/^$/d')"
echo "git status entries new since the run started:"
if [ -n "$NEW_STATUS" ]; then indent <<<"$NEW_STATUS"; else echo "  (none)"; fi
TOUCHED="$(files_touched)"
echo "files written during the run:"
if [ -n "$TOUCHED" ]; then head -50 <<<"$TOUCHED" | indent; else echo "  (none)"; fi
if [ -n "$BEFORE" ]; then
    echo "  note: $(echo "$BEFORE" | wc -l | tr -d ' ') path(s) were already dirty before the run; review with git diff"
fi
echo "outside the contract's May change:"
ALLOWED="$(allowed_paths)"
if [ -z "$ALLOWED" ]; then
    echo "  (no May change entry)"
else
    STRAY="$(cut -c4- <<<"$AFTER" | sed 's/.* -> //' | out_of_scope "$ALLOWED")"
    if [ -n "$STRAY" ]; then indent <<<"$STRAY"; else echo "  (none)"; fi
fi

echo "last message:"
if [ -s "$LAST_FILE" ]; then
    total=$(wc -l <"$LAST_FILE" | tr -d ' ')
    head -n "$LAST_MESSAGE_LINES" "$LAST_FILE" | indent
    [ "$total" -gt "$LAST_MESSAGE_LINES" ] && echo "  ... ($total lines, full text in $LAST_FILE)"
else
    echo "  (none)"
fi

[ "$STATUS" = success ]
