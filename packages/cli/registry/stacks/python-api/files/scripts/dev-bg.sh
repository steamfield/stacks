#!/usr/bin/env bash
# The dev server for agents and scripts, which can't sit in a foreground terminal.
# `make dev-bg` runs `start`, `make dev-stop` runs `stop`.
#
#   start  Reuse the server logs/dev.pid records when it runs on the requested host and port and
#          answers /healthz. Otherwise run `make dev` in its own process group, record it in
#          logs/dev.pid, write its output to logs/dev.log and wait for /healthz. If it exits or
#          doesn't answer in time, print the log's tail, stop the group and exit 1. A server this
#          script didn't record is never reused: start refuses and names the port.
#   stop   Stop the recorded process group: SIGTERM, then SIGKILL after a grace period.
#
# Uvicorn's --reload runs a supervisor and a worker that holds the port, so both commands signal
# the whole group. Killing the supervisor's pid alone leaves the worker serving.
#
# logs/dev.pid holds "<group id> <host> <port> <leader start time>". The start time (LC_ALL=C ps)
# must still match before the group is reused or signaled, so a pid the system has since given to
# another program is never touched. Starts hold logs/dev.lock, so two overlapping starts can't
# both launch a server.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT_API="${PORT_API:-8000}"
API_HOST="${API_HOST:-127.0.0.1}"
export PORT_API API_HOST
PID_FILE=logs/dev.pid
LOG_FILE=logs/dev.log
LOCK_DIR=logs/dev.lock
START_SECONDS=60
# dev-stop waits for uvicorn's graceful shutdown. Cleanup after a failed or interrupted start must
# finish inside the 5 s a runner gives a timed-out step before it SIGKILLs the script.
STOP_SECONDS=10
CLEANUP_SECONDS=3

DEV_PGID=""
LOCKED=""
REC_PGID="" REC_HOST="" REC_PORT=""

case "$API_HOST" in
  0.0.0.0 | "") PROBE_HOST=127.0.0.1 ;;
  ::) PROBE_HOST="[::1]" ;;
  *:*) PROBE_HOST="[$API_HOST]" ;;
  *) PROBE_HOST="$API_HOST" ;;
esac
HEALTH_URL="http://$PROBE_HOST:$PORT_API/healthz"

healthy() { curl -fs -o /dev/null --max-time 2 "$HEALTH_URL"; }

started_at() { LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//' || true; }

# True while any process other than a zombie is in the group.
group_running() { # pgid
  ps -A -o pgid=,stat= | awk -v g="$1" '$1 == g && $2 !~ /^Z/ { found = 1 } END { exit !found }'
}

# Sets REC_PGID, REC_HOST and REC_PORT when logs/dev.pid names a group this script started that
# is still running. If the leader is gone but members remain, the group is still ours: a group id
# can't be handed to a new process while the group has members.
read_record() {
  local started="" now
  [ -f "$PID_FILE" ] || return 1
  read -r REC_PGID REC_HOST REC_PORT started <"$PID_FILE" || true
  case "$REC_PGID" in '' | *[!0-9]*) return 1 ;; esac
  now=$(started_at "$REC_PGID")
  if [ -n "$now" ]; then
    [ "$now" = "$started" ]
  else
    group_running "$REC_PGID"
  fi
}

# Removes logs/dev.pid only while it still names group $1, so a failed start never erases the
# record of a server another run started.
forget() { # pgid
  local recorded=""
  [ -f "$PID_FILE" ] && read -r recorded _ <"$PID_FILE" || true
  if [ "$recorded" = "$1" ]; then rm -f "$PID_FILE"; fi
}

stop_group() { # pgid, grace seconds
  local deadline=$((SECONDS + $2))
  kill -TERM -- "-$1" 2>/dev/null || true
  while group_running "$1" && [ "$SECONDS" -lt "$deadline" ]; do sleep 0.1; done
  if group_running "$1"; then
    kill -KILL -- "-$1" 2>/dev/null || true
    deadline=$((SECONDS + 1))
    while group_running "$1" && [ "$SECONDS" -le "$deadline" ]; do sleep 0.1; done
  fi
  ! group_running "$1"
}

lock() {
  local deadline=$((SECONDS + START_SECONDS + 10)) holder
  mkdir -p logs
  until mkdir "$LOCK_DIR" 2>/dev/null; do
    holder=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      rm -f "$LOCK_DIR/pid"
      rmdir "$LOCK_DIR" 2>/dev/null || true
      continue
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "dev-bg: another make dev-bg still holds $LOCK_DIR; if none is running, remove it" >&2
      exit 1
    fi
    sleep 0.2
  done
  LOCKED=1
  echo "$$" >"$LOCK_DIR/pid"
}

unlock() {
  if [ -n "$LOCKED" ]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
    LOCKED=""
  fi
}

# Stops the group this run launched (if any) and releases the lock: on a signal, a failure or exit.
cleanup() {
  if [ -n "$DEV_PGID" ]; then
    stop_group "$DEV_PGID" "$CLEANUP_SECONDS" || echo "dev-bg: process group $DEV_PGID did not exit" >&2
    forget "$DEV_PGID"
    DEV_PGID=""
  fi
  unlock
}

fail() { # reason
  echo "dev-bg: $1. Last lines of $LOG_FILE:" >&2
  tail -n 30 "$LOG_FILE" >&2 2>/dev/null || true
  exit 1
}

start() {
  local started deadline
  trap 'cleanup; exit 130' INT TERM HUP
  trap cleanup EXIT
  lock
  if read_record; then
    if [ "$REC_HOST" != "$API_HOST" ] || [ "$REC_PORT" != "$PORT_API" ]; then
      echo "dev-bg: the dev server is recorded on $REC_HOST:$REC_PORT, not $API_HOST:$PORT_API; run make dev-stop first" >&2
      exit 1
    fi
    if ! healthy; then
      echo "dev-bg: the recorded dev server (process group $REC_PGID) doesn't answer $HEALTH_URL; run make dev-stop, then make dev-bg" >&2
      exit 1
    fi
    echo "dev-bg: reusing the dev server on http://$API_HOST:$PORT_API (process group $REC_PGID, log $LOG_FILE)"
    return 0
  fi
  rm -f "$PID_FILE"
  if healthy; then
    echo "dev-bg: port $PORT_API is answered by a server dev-bg didn't start; stop it or run PORT_API=<free port> make dev-bg" >&2
    exit 1
  fi
  set -m # the job gets its own process group, whose id is its pid
  PYTHONUNBUFFERED=1 make --no-print-directory dev </dev/null >"$LOG_FILE" 2>&1 &
  DEV_PGID=$!
  set +m
  disown "$DEV_PGID"
  started=$(started_at "$DEV_PGID")
  [ -n "$started" ] || fail "ps printed no start time for process group $DEV_PGID, so dev-stop couldn't find it"
  echo "$DEV_PGID $API_HOST $PORT_API $started" >"$PID_FILE"
  deadline=$((SECONDS + START_SECONDS))
  until healthy; do
    group_running "$DEV_PGID" || fail "the dev server exited before $HEALTH_URL answered"
    [ "$SECONDS" -lt "$deadline" ] || fail "$HEALTH_URL did not answer within ${START_SECONDS}s"
    sleep 0.5
  done
  echo "dev-bg: dev server running on http://$API_HOST:$PORT_API (process group $DEV_PGID, log $LOG_FILE). Stop it with make dev-stop."
  DEV_PGID="" # started: leave it running
}

stop() {
  if ! read_record; then
    if [ -f "$PID_FILE" ]; then
      rm -f "$PID_FILE"
      echo "dev-stop: the recorded dev server had already exited"
    else
      echo "dev-stop: no dev server recorded in $PID_FILE"
    fi
    return 0
  fi
  if ! stop_group "$REC_PGID" "$STOP_SECONDS"; then
    echo "dev-stop: process group $REC_PGID did not exit; port $REC_PORT may still be taken" >&2
    return 1
  fi
  forget "$REC_PGID"
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
