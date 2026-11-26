#!/usr/bin/env bash
# `make dev-bg` / `make dev-stop`: bin/server in the background, for agents and scripts that
# can't sit in a foreground terminal.
#
#   start  Reuse the server logs/dev.pid records if it runs on the requested HOST and PORT and
#          still answers /healthz. Otherwise start bin/server in its own process group, record
#          "<group> <host> <port> <start time>" in logs/dev.pid, send its output to logs/dev.log
#          and wait for /healthz. If it never answers, stop the group and exit 1 with the log's
#          last lines.
#   stop   SIGTERM the recorded process group, SIGKILL it after a grace period, then remove
#          logs/dev.pid. Only the recorded group is signaled, never processes found by name.
#
# Health checks use the binary's own -healthcheck flag, so no curl is needed.
set -u
cd "$(dirname "$0")/.." || exit 1

PID_FILE=logs/dev.pid
LOG_FILE=logs/dev.log
BIN=./bin/server
START_SECONDS=30
# Longer than the default SHUTDOWN_TIMEOUT, so in-flight requests can finish first.
STOP_SECONDS=15

# The process's start time, as ps prints it on macOS and Linux (procps).
started() {
  ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'
}

# logs/dev.pid is gitignored and outlives crashes and reboots, and pids get reused. A pid whose
# start time still matches the recorded one is the process this script launched, not some other
# project's server that happens to hold the same pid now.
ours() {
  [ -n "$2" ] && [ "$(started "$1")" = "$2" ]
}

group_alive() {
  kill -0 -- "-$1" 2>/dev/null
}

healthy() {
  HOST="$1" PORT="$2" "$BIN" -healthcheck >/dev/null 2>&1
}

show_log() {
  if [ -s "$LOG_FILE" ]; then
    echo "Last lines of $LOG_FILE:" >&2
    tail -n 20 "$LOG_FILE" >&2
  fi
}

# Waits up to $2 seconds for process group $1 to exit. Deadlines use SECONDS (wall time) rather
# than a count of tries, because each check in the loop can itself take time.
wait_gone() {
  local deadline=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$deadline" ] && group_alive "$1"; do
    sleep 0.2
  done
  ! group_alive "$1"
}

stop_group() {
  kill -TERM -- "-$1" 2>/dev/null
  wait_gone "$1" "$STOP_SECONDS" && return 0
  kill -KILL -- "-$1" 2>/dev/null
  wait_gone "$1" 2
}

start() {
  local host="${HOST:-127.0.0.1}" port="${PORT:-8080}" group rhost rport rstart deadline
  if [ "$port" = 0 ]; then
    echo "dev-bg needs a fixed PORT; PORT=0 picks a port the health check can't know." >&2
    return 1
  fi
  if [ -r "$PID_FILE" ] && read -r group rhost rport rstart <"$PID_FILE" &&
    ours "$group" "$rstart"; then
    # Reporting the recorded server as success would hand the caller a different URL than the
    # one it asked for.
    if [ "$rhost" != "$host" ] || [ "$rport" != "$port" ]; then
      echo "A dev server is already recorded on $rhost:$rport; run make dev-stop first." >&2
      return 1
    fi
    if healthy "$rhost" "$rport"; then
      echo "Reusing the server on http://$rhost:$rport (process group $group). It runs the binary built when it started; make dev-stop && make dev-bg picks up new code."
      echo "Logs: $LOG_FILE. Stop: make dev-stop"
      return 0
    fi
    echo "The recorded server (process group $group) doesn't answer /healthz on $rhost:$rport. Stop it with make dev-stop, then start again." >&2
    show_log
    return 1
  fi
  rm -f "$PID_FILE"
  if healthy "$host" "$port"; then
    echo "Another server already answers /healthz on $host:$port and logs/dev.pid doesn't record it. Stop that one or set PORT." >&2
    return 1
  fi
  mkdir -p logs
  # Job control gives the background job its own process group (macOS has no setsid), so stop
  # reaches the server and anything it spawns, and a signal to whoever ran make doesn't.
  set -m
  HOST="$host" PORT="$port" "$BIN" </dev/null >"$LOG_FILE" 2>&1 &
  group=$!
  set +m
  # Out of bash's job table, so stopping it here doesn't print a job-status line.
  disown "$group"
  # The server's own group doesn't get the caller's Ctrl+C or a tool's timeout signal, so an
  # interrupted start would leave it holding the port. Stop it on the way out instead.
  trap 'stop_group "$group"; rm -f "$PID_FILE"; exit 130' INT TERM HUP
  echo "$group $host $port $(started "$group")" >"$PID_FILE"
  deadline=$((SECONDS + START_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! group_alive "$group"; then
      trap - INT TERM HUP
      echo "bin/server exited before /healthz answered." >&2
      show_log
      rm -f "$PID_FILE"
      return 1
    fi
    if healthy "$host" "$port"; then
      trap - INT TERM HUP
      echo "Server running on http://$host:$port (process group $group)."
      echo "Logs: $LOG_FILE. Stop: make dev-stop"
      return 0
    fi
    sleep 0.2
  done
  echo "bin/server didn't answer /healthz on $host:$port within ${START_SECONDS}s; stopping it." >&2
  show_log
  stop_group "$group"
  trap - INT TERM HUP
  rm -f "$PID_FILE"
  return 1
}

stop() {
  local group rstart
  if ! { [ -r "$PID_FILE" ] && read -r group _ _ rstart <"$PID_FILE"; }; then
    echo "No background server recorded in $PID_FILE."
    return 0
  fi
  if ! group_alive "$group" || ! ours "$group" "$rstart"; then
    rm -f "$PID_FILE"
    echo "The recorded server (process group $group) had already exited."
    return 0
  fi
  if ! stop_group "$group"; then
    echo "Process group $group didn't exit after SIGKILL." >&2
    return 1
  fi
  rm -f "$PID_FILE"
  echo "Stopped the server (process group $group)."
}

case "${1:-}" in
start) start ;;
stop) stop ;;
*)
  echo "usage: scripts/dev-bg.sh start|stop" >&2
  exit 2
  ;;
esac
