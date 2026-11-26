#!/usr/bin/env bash
# The dev server for agents and scripts, which can't sit in a foreground terminal.
# `make dev-bg` runs `start`, `make dev-stop` runs `stop`.
#
#   start  Reuse a server already answering /healthz on PORT_API. Otherwise run `make dev` in its
#          own process group, record the group id in logs/dev.pid, write its output to
#          logs/dev.log and wait for /healthz. If it exits or doesn't answer in time, print the
#          log's tail, stop the group and exit 1.
#   stop   Stop the process group logs/dev.pid names: SIGTERM, then SIGKILL after a grace period.
#
# Uvicorn's --reload runs a supervisor and a worker that holds the port, so both commands signal
# the whole group. Killing the supervisor's pid alone leaves the worker serving.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT_API="${PORT_API:-8000}"
export PORT_API
PID_FILE=logs/dev.pid
LOG_FILE=logs/dev.log
HEALTH_URL="http://127.0.0.1:$PORT_API/healthz"
START_SECONDS=60
STOP_SECONDS=10

healthy() { curl -fs -o /dev/null --max-time 2 "$HEALTH_URL"; }

# True while any process other than a zombie is in the group.
group_running() { # pgid
  ps -A -o pgid=,stat= | awk -v g="$1" '$1 == g && $2 !~ /^Z/ { found = 1 } END { exit !found }'
}

# Prints the group logs/dev.pid names when it is still this project's dev server, so a stale
# file whose id the system has since reused never gets another program signaled.
recorded_group() {
  local pgid=""
  [ -f "$PID_FILE" ] || return 1
  read -r pgid <"$PID_FILE" || true
  case "$pgid" in '' | *[!0-9]*) return 1 ;; esac
  ps -A -o pgid=,command= |
    awk -v g="$pgid" '$1 == g && /uvicorn|make/ { found = 1 } END { exit !found }' || return 1
  echo "$pgid"
}

stop_group() { # pgid
  local ticks=0
  kill -TERM -- "-$1" 2>/dev/null || true
  while group_running "$1" && [ "$ticks" -lt $((STOP_SECONDS * 5)) ]; do
    sleep 0.2
    ticks=$((ticks + 1))
  done
  if group_running "$1"; then
    kill -KILL -- "-$1" 2>/dev/null || true
    sleep 0.5
  fi
  ! group_running "$1"
}

fail() { # reason, pgid
  echo "dev-bg: $1. Last lines of $LOG_FILE:" >&2
  tail -n 30 "$LOG_FILE" >&2 2>/dev/null || true
  stop_group "$2" || echo "dev-bg: process group $2 did not exit" >&2
  rm -f "$PID_FILE"
  exit 1
}

start() {
  local pgid ticks=0
  if healthy; then
    if pgid=$(recorded_group); then
      echo "dev-bg: dev server already running on http://127.0.0.1:$PORT_API (process group $pgid, log $LOG_FILE)"
    else
      echo "dev-bg: a server dev-bg didn't start already answers $HEALTH_URL; using it (make dev-stop won't stop it)"
    fi
    return 0
  fi
  if ! pgid=$(recorded_group); then
    mkdir -p logs
    set -m # the job gets its own process group, whose id is its pid
    PYTHONUNBUFFERED=1 make --no-print-directory dev </dev/null >"$LOG_FILE" 2>&1 &
    pgid=$!
    set +m
    echo "$pgid" >"$PID_FILE"
  fi
  trap 'stop_group "$pgid" || true; rm -f "$PID_FILE"; exit 130' INT TERM
  until healthy; do
    group_running "$pgid" || fail "the dev server exited before $HEALTH_URL answered" "$pgid"
    [ "$ticks" -lt $((START_SECONDS * 2)) ] || fail "$HEALTH_URL did not answer within ${START_SECONDS}s" "$pgid"
    sleep 0.5
    ticks=$((ticks + 1))
  done
  trap - INT TERM
  echo "dev-bg: dev server running on http://127.0.0.1:$PORT_API (process group $pgid, log $LOG_FILE). Stop it with make dev-stop."
}

stop() {
  local pgid
  if ! pgid=$(recorded_group); then
    rm -f "$PID_FILE"
    echo "dev-stop: no dev server recorded in $PID_FILE"
    return 0
  fi
  if ! stop_group "$pgid"; then
    echo "dev-stop: process group $pgid did not exit; port $PORT_API may still be taken" >&2
    return 1
  fi
  rm -f "$PID_FILE"
  echo "dev-stop: stopped the dev server (process group $pgid)"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *)
    echo "usage: scripts/dev-bg.sh start|stop" >&2
    exit 2
    ;;
esac
