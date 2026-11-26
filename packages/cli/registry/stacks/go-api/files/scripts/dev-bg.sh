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
LOCK_DIR=logs/dev.lock
BIN=./bin/server
START_SECONDS=30
# dev-stop's grace: longer than the default SHUTDOWN_TIMEOUT, so in-flight requests can finish.
STOP_SECONDS=15
# The grace when start gives up or is interrupted. A stacks verify step that times out gets
# SIGTERM and then SIGKILL 5 s later, so the SIGKILL to the server has to go out before that.
ABORT_SECONDS=3

# Globals rather than locals: the signal trap reads them, and a trap runs inside whatever
# function was executing when the signal arrived, where that function's locals and positional
# parameters are in scope instead. Under set -u an unset name there would abort the cleanup.
DEV_PGID=""
LOCKED=""

# The process's start time. ps prints it in the caller's locale on macOS, so pin C: dev-bg and
# dev-stop may run from shells with different LANG settings.
started() {
  LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'
}

group_alive() {
  kill -0 -- "-$1" 2>/dev/null
}

# Whether the recorded group is the one this script launched. logs/dev.pid is gitignored and
# outlives crashes and reboots, and pids get reused, so a live leader must still have the
# recorded start time. A group whose leader is gone but whose members remain is still the
# original group: a group id can't be reused while the group has members.
recorded_alive() {
  if kill -0 "$1" 2>/dev/null; then
    [ -n "$2" ] && [ "$(started "$1")" = "$2" ]
  else
    group_alive "$1"
  fi
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

# Removes logs/dev.pid only while it still names group $1, so a run that loses a race can't
# erase the record of the server another run started.
forget_record() {
  local recorded
  if [ -r "$PID_FILE" ] && read -r recorded _ <"$PID_FILE" && [ "$recorded" = "$1" ]; then
    rm -f "$PID_FILE"
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

# SIGTERM process group $1, then SIGKILL it if it outlives $2 seconds.
stop_group() {
  kill -TERM -- "-$1" 2>/dev/null
  wait_gone "$1" "$2" && return 0
  kill -KILL -- "-$1" 2>/dev/null
  wait_gone "$1" 1
}

# Two agents in one checkout can run make dev-bg at once. Without the lock both would find no
# record, both would launch, and the loser's cleanup could leave the winner unrecorded.
acquire_lock() {
  local deadline=$((SECONDS + START_SECONDS + ABORT_SECONDS + 5)) holder
  mkdir -p logs
  until mkdir "$LOCK_DIR" 2>/dev/null; do
    holder=$(cat "$LOCK_DIR/pid" 2>/dev/null)
    # A holder that was SIGKILLed never released the lock. An empty pid file means the holder
    # is between mkdir and writing it, so wait.
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null &&
      [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$holder" ]; then
      rm -f "$LOCK_DIR/pid"
      rmdir "$LOCK_DIR" 2>/dev/null
      continue
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Another make dev-bg still holds $LOCK_DIR. If none is running, remove that directory." >&2
      return 1
    fi
    sleep 0.2
  done
  echo $$ >"$LOCK_DIR/pid"
  LOCKED=1
}

release_lock() {
  if [ -n "$LOCKED" ]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null
    LOCKED=""
  fi
}

# The server runs in its own process group, so the caller's Ctrl+C or a verify step timeout
# reaches only this script. Without this the server would keep the port after we die.
on_signal() {
  if [ -n "$DEV_PGID" ]; then
    stop_group "$DEV_PGID" "$ABORT_SECONDS"
    forget_record "$DEV_PGID"
  fi
  release_lock
  exit 130
}

# Stops the server this run launched after a failed start.
abort_start() {
  show_log
  stop_group "$DEV_PGID" "$ABORT_SECONDS"
  forget_record "$DEV_PGID"
  DEV_PGID=""
  return 1
}

start() {
  local host="${HOST:-127.0.0.1}" port="${PORT:-8080}" group rhost rport rstart since deadline
  if [ "$port" = 0 ]; then
    echo "dev-bg needs a fixed PORT; PORT=0 picks a port the health check can't know." >&2
    return 1
  fi
  # Installed before the launch, so no signal can land between starting the server and trapping.
  trap on_signal INT TERM HUP
  trap release_lock EXIT
  acquire_lock || return 1
  if [ -r "$PID_FILE" ] && read -r group rhost rport rstart <"$PID_FILE" &&
    recorded_alive "$group" "$rstart"; then
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
  # Under the lock, and the record names nothing alive, so it is safe to drop.
  rm -f "$PID_FILE"
  # A server dev-bg didn't start can't be stopped by dev-stop, so don't pass it off as ours.
  if healthy "$host" "$port"; then
    echo "Another server already answers /healthz on $host:$port and logs/dev.pid doesn't record it. Stop that one or set PORT." >&2
    return 1
  fi
  # Job control gives the background job its own process group (macOS has no setsid), so stop
  # reaches the server and anything it spawns, and a signal to whoever ran make doesn't.
  set -m
  HOST="$host" PORT="$port" "$BIN" </dev/null >"$LOG_FILE" 2>&1 &
  DEV_PGID=$!
  set +m
  # Out of bash's job table, so stopping it here doesn't print a job-status line.
  disown "$DEV_PGID"
  since=$(started "$DEV_PGID")
  if [ -z "$since" ]; then
    echo "ps can't report bin/server's start time, which dev-stop needs to recognize it." >&2
    abort_start
    return 1
  fi
  echo "$DEV_PGID $host $port $since" >"$PID_FILE"
  deadline=$((SECONDS + START_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! group_alive "$DEV_PGID"; then
      echo "bin/server exited before /healthz answered." >&2
      abort_start
      return 1
    fi
    if healthy "$host" "$port"; then
      echo "Server running on http://$host:$port (process group $DEV_PGID)."
      echo "Logs: $LOG_FILE. Stop: make dev-stop"
      DEV_PGID=""
      return 0
    fi
    sleep 0.2
  done
  echo "bin/server didn't answer /healthz on $host:$port within ${START_SECONDS}s; stopping it." >&2
  abort_start
}

stop() {
  local group rstart
  if ! { [ -r "$PID_FILE" ] && read -r group _ _ rstart <"$PID_FILE"; }; then
    echo "No background server recorded in $PID_FILE."
    return 0
  fi
  if ! recorded_alive "$group" "$rstart"; then
    forget_record "$group"
    echo "The recorded server (process group $group) had already exited."
    return 0
  fi
  if ! stop_group "$group" "$STOP_SECONDS"; then
    echo "Process group $group didn't exit after SIGKILL." >&2
    return 1
  fi
  forget_record "$group"
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
