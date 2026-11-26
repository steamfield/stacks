#!/usr/bin/env bash
# `make dev-bg` / `make dev-stop` / `make dev-status`: `make dev` (astro dev, reloading pages on
# save) in the background, for agents and scripts that can't sit in a foreground terminal.
#
# Everything below the shared-body marker is identical in every Make stack's copy of this
# script; a registry test enforces it. Change behavior there in all stacks at once, and keep
# per-stack facts in the settings above it.
#
# make and bunx stay between this script and the Astro process that holds the port, so the body
# signals the whole process group: stopping make's pid alone leaves Astro serving.

# Env var naming the bind address, or "" when the server takes no host setting (DEV_HOST is used).
# make dev passes no --host, so astro dev listens on localhost.
HOST_VAR=""
DEV_HOST=localhost
# Env var naming the port, and its default (the stack's `env` value for verify).
PORT_VAR=PORT_WEB
DEV_PORT=4321
# How long start waits for healthy (the first start optimizes dependencies), how long dev-stop
# lets astro dev exit, and the grace when a start fails or is interrupted (under the 5 s a
# verify step timeout allows between SIGTERM and SIGKILL).
START_SECONDS=60
STOP_SECONDS=10
ABORT_SECONDS=3
# How messages name the server, and what a reuse should remind the caller of.
SERVER_LABEL="make dev"
REUSE_NOTE="It reloads pages when a file is saved."

# Runs the serve command in the foreground on host $1, port $2. The body starts it in the
# background with output going to logs/dev.log. make dev passes --ignore-lock, so Astro stays in
# the foreground instead of backgrounding itself under an agent.
launch() {
  PORT_WEB="$2" exec make --no-print-directory dev
}

# Succeeds when the URL the serve step's expect.http names (/) answers below 500 on host $1,
# port $2. Node's fetch makes the request, so the check needs no curl.
healthy() {
  node -e 'fetch(process.argv[1], { signal: AbortSignal.timeout(2000) }).then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))' \
    "http://$1:$2/" >/dev/null 2>&1
}

# --- shared body ---
#
#   start   Reuse the server logs/dev.pid records if it runs on the requested host and port and
#           is healthy. Otherwise launch in its own process group, record
#           "<group> <host> <port> <start time>" in logs/dev.pid, send its output to
#           logs/dev.log and wait for healthy. If it never gets healthy or start is interrupted
#           (exit 130), stop the group.
#   stop    SIGTERM the recorded process group, SIGKILL it after STOP_SECONDS, remove the record.
#           Only the recorded group is signaled, never processes found by name.
#   status  Exit 0 when the recorded server is running, else 1.
#
# A server started in the foreground (make serve, make dev) isn't recorded: start refuses while
# it holds the port, and stop leaves it alone.
set -u
cd "$(dirname "$0")/.." || exit 1

PID_FILE=logs/dev.pid
LOG_FILE=logs/dev.log
LOCK_DIR=logs/dev.lock

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

# The requested host and port: the variables' values from the shell, or the defaults. Reuse is
# judged against these, so an unset variable still means the default, not "any".
requested() {
  REQ_HOST=$DEV_HOST
  if [ -n "$HOST_VAR" ]; then
    REQ_HOST=${!HOST_VAR:-$DEV_HOST}
  fi
  REQ_PORT=${!PORT_VAR:-$DEV_PORT}
}

start() {
  local host port group rhost rport rstart since deadline
  requested
  host=$REQ_HOST
  port=$REQ_PORT
  if [ "$port" = 0 ]; then
    echo "dev-bg needs a fixed $PORT_VAR; 0 picks a port the health check can't know." >&2
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
      echo "Reusing the server on http://$rhost:$rport (process group $group). $REUSE_NOTE"
      echo "Logs: $LOG_FILE. Stop: make dev-stop"
      return 0
    fi
    echo "The recorded server (process group $group) isn't healthy on $rhost:$rport; run make dev-stop, then start again." >&2
    show_log
    return 1
  fi
  # Under the lock, and the record names nothing alive, so it is safe to drop.
  rm -f "$PID_FILE"
  # A server dev-bg didn't start can't be stopped by dev-stop, so don't pass it off as ours.
  if healthy "$host" "$port"; then
    echo "Another server already answers on $host:$port and logs/dev.pid doesn't record it (a foreground server, or another checkout's). Stop that one or set $PORT_VAR." >&2
    return 1
  fi
  # Job control gives the background job its own process group (macOS has no setsid), so stop
  # reaches the server and anything it spawns, and a signal to whoever ran make doesn't.
  set -m
  launch "$host" "$port" </dev/null >"$LOG_FILE" 2>&1 &
  DEV_PGID=$!
  set +m
  # Out of bash's job table, so stopping it here doesn't print a job-status line.
  disown "$DEV_PGID"
  since=$(started "$DEV_PGID")
  if [ -z "$since" ]; then
    echo "ps can't report $SERVER_LABEL's start time, which dev-stop needs to recognize it." >&2
    abort_start
    return 1
  fi
  echo "$DEV_PGID $host $port $since" >"$PID_FILE"
  deadline=$((SECONDS + START_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! group_alive "$DEV_PGID"; then
      echo "$SERVER_LABEL exited before it was healthy." >&2
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
  echo "$SERVER_LABEL wasn't healthy on $host:$port within ${START_SECONDS}s; stopping it." >&2
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

status() {
  local group rhost rport rstart
  if [ -r "$PID_FILE" ] && read -r group rhost rport rstart <"$PID_FILE" &&
    recorded_alive "$group" "$rstart"; then
    echo "Background server recorded on http://$rhost:$rport (process group $group). Logs: $LOG_FILE"
    return 0
  fi
  echo "No background server running."
  return 1
}

case "${1:-}" in
start) start ;;
stop) stop ;;
status) status ;;
*)
  echo "usage: scripts/dev-bg.sh start|stop|status" >&2
  exit 2
  ;;
esac
