#!/usr/bin/env bash
# The dev server for agents and scripts, which can't sit in a foreground terminal.
# `make dev-bg` runs `start`, `make dev-stop` runs `stop`.
#
#   start  Reuse the server this script started, when it runs on the requested host and port.
#          Otherwise reuse any server already answering /healthz on PORT_API, or run `make dev`
#          in its own process group, record it in logs/dev.pid, write its output to logs/dev.log
#          and wait for /healthz. If it exits or doesn't answer in time, print the log's tail,
#          stop the group and exit 1.
#   stop   Stop the process group logs/dev.pid names: SIGTERM, then SIGKILL after a grace period.
#
# Uvicorn's --reload runs a supervisor and a worker that holds the port, so both commands signal
# the whole group. Killing the supervisor's pid alone leaves the worker serving.
#
# logs/dev.pid holds "<group id> <host> <port> <leader start time>". The start time, from ps,
# must still match before the group is reused or signaled, so a group id the system has since
# given to another program is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT_API="${PORT_API:-8000}"
API_HOST="${API_HOST:-127.0.0.1}"
export PORT_API API_HOST
PID_FILE=logs/dev.pid
LOG_FILE=logs/dev.log
HEALTH_URL="http://127.0.0.1:$PORT_API/healthz"
START_SECONDS=60
STOP_SECONDS=10

healthy() { curl -fs -o /dev/null --max-time 2 "$HEALTH_URL"; }

started_at() { ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'; }

# True while any process other than a zombie is in the group.
group_running() { # pgid
  ps -A -o pgid=,stat= | awk -v g="$1" '$1 == g && $2 !~ /^Z/ { found = 1 } END { exit !found }'
}

# Sets REC_PGID, REC_HOST and REC_PORT when logs/dev.pid names a group this script started that
# is still running.
read_record() {
  local started=""
  REC_PGID="" REC_HOST="" REC_PORT=""
  [ -f "$PID_FILE" ] || return 1
  read -r REC_PGID REC_HOST REC_PORT started <"$PID_FILE" || true
  case "$REC_PGID" in '' | *[!0-9]*) return 1 ;; esac
  [ -n "$started" ] && [ "$(started_at "$REC_PGID")" = "$started" ]
}

stop_group() { # pgid
  local deadline=$((SECONDS + STOP_SECONDS))
  kill -TERM -- "-$1" 2>/dev/null || true
  while group_running "$1" && [ "$SECONDS" -lt "$deadline" ]; do sleep 0.2; done
  if group_running "$1"; then
    kill -KILL -- "-$1" 2>/dev/null || true
    sleep 0.5
  fi
  ! group_running "$1"
}

fail() { # reason, pgid
  trap - INT TERM HUP
  echo "dev-bg: $1. Last lines of $LOG_FILE:" >&2
  tail -n 30 "$LOG_FILE" >&2 2>/dev/null || true
  stop_group "$2" || echo "dev-bg: process group $2 did not exit" >&2
  rm -f "$PID_FILE"
  exit 1
}

wait_healthy() { # pgid
  local deadline=$((SECONDS + START_SECONDS))
  trap 'stop_group "$1" || true; rm -f "$PID_FILE"; exit 130' INT TERM HUP
  until healthy; do
    group_running "$1" || fail "the dev server exited before $HEALTH_URL answered" "$1"
    [ "$SECONDS" -lt "$deadline" ] || fail "$HEALTH_URL did not answer within ${START_SECONDS}s" "$1"
    sleep 0.5
  done
  trap - INT TERM HUP
  echo "dev-bg: dev server running on http://$API_HOST:$PORT_API (process group $1, log $LOG_FILE). Stop it with make dev-stop."
}

start() {
  local pgid
  if read_record; then
    if [ "$REC_HOST" != "$API_HOST" ] || [ "$REC_PORT" != "$PORT_API" ]; then
      echo "dev-bg: the dev server is already running on $REC_HOST:$REC_PORT, not $API_HOST:$PORT_API; run make dev-stop first" >&2
      exit 1
    fi
    wait_healthy "$REC_PGID"
    return 0
  fi
  if healthy; then
    echo "dev-bg: a server dev-bg didn't start already answers $HEALTH_URL; using it (make dev-stop won't stop it)"
    return 0
  fi
  mkdir -p logs
  set -m # the job gets its own process group, whose id is its pid
  PYTHONUNBUFFERED=1 make --no-print-directory dev </dev/null >"$LOG_FILE" 2>&1 &
  pgid=$!
  set +m
  trap 'stop_group "$pgid" || true; rm -f "$PID_FILE"; exit 130' INT TERM HUP
  echo "$pgid $API_HOST $PORT_API $(started_at "$pgid")" >"$PID_FILE"
  wait_healthy "$pgid"
}

stop() {
  if ! read_record; then
    rm -f "$PID_FILE"
    echo "dev-stop: no dev server recorded in $PID_FILE"
    return 0
  fi
  if ! stop_group "$REC_PGID"; then
    echo "dev-stop: process group $REC_PGID did not exit; port $REC_PORT may still be taken" >&2
    return 1
  fi
  rm -f "$PID_FILE"
  echo "dev-stop: stopped the dev server (process group $REC_PGID)"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *)
    echo "usage: scripts/dev-bg.sh start|stop" >&2
    exit 2
    ;;
esac
