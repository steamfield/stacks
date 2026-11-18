#!/usr/bin/env bash
# The both-parts check: builds both parts, starts the built API on PORT_API and the built frontend
# under `vite preview` on PORT_WEB, then asks the frontend's /api proxy for each list route below
# and expects the API's page of rows back. It prints one line on success; on failure it names the
# request and prints the end of both servers' logs. `make smoke` runs it with the ports exported.
set -euo pipefail
cd "$(dirname "$0")/.."

# One list route per resource the frontend reads, as the frontend calls it (under /v1). Add each
# new resource here, so this check covers more than the example.
LIST_ROUTES=(/v1/notes)

PORT_API=${PORT_API:-3000}
PORT_WEB=${PORT_WEB:-4173}
export PORT_API PORT_WEB
logs=$(mktemp -d)
pids=()

# Stops a process and everything it started (bun run starts node or vite), children first. Job
# control (set -m) would give each server a process group instead, but without a terminal bash
# can print setpgid errors. Output goes to the logs, so a server stopped on purpose prints nothing.
stop_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do stop_tree "$child"; done
  kill -TERM "$1" 2>/dev/null || true
}
cleanup() {
  local status=$?
  # The +-form expands to nothing while pids is empty; bash 3.2's set -u rejects a bare one.
  for pid in ${pids[@]+"${pids[@]}"}; do stop_tree "$pid"; done
  for pid in ${pids[@]+"${pids[@]}"}; do wait "$pid" 2>/dev/null || true; done
  if ((status != 0)); then
    for log in "$logs"/*.log; do
      [ -s "$log" ] && { echo "--- last lines of $(basename "$log")" >&2; tail -n 20 "$log" >&2; }
    done
  fi
  rm -rf "$logs"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

fail() { echo "smoke: $*" >&2; exit 1; }

# Any HTTP answer, even a 404, means something is listening.
listening() { curl -s -o /dev/null --max-time 2 "$1" 2>/dev/null; }

wait_for() { # url, seconds: until it answers below 400
  local deadline=$((SECONDS + $2))
  until curl -fs -o /dev/null --max-time 2 "$1" 2>/dev/null; do
    ((SECONDS < deadline)) || fail "$1 did not answer within $2s"
    for pid in "${pids[@]}"; do kill -0 "$pid" 2>/dev/null || fail "a server exited before $1 answered"; done
    sleep 0.5
  done
}

for port in "$PORT_API" "$PORT_WEB"; do
  ! listening "http://localhost:$port/" || fail "port $port is already in use: stop that server or set PORT_API and PORT_WEB to free ports"
done

(cd backend && bun run build) >"$logs/backend-build.log" 2>&1 || fail "backend build failed"
(cd frontend && bun run build) >"$logs/frontend-build.log" 2>&1 || fail "frontend build failed"

(cd backend && exec bun run start) >"$logs/backend.log" 2>&1 &
pids+=("$!")
(cd frontend && exec bun run preview --port "$PORT_WEB" --strictPort) >"$logs/frontend.log" 2>&1 &
pids+=("$!")

wait_for "http://localhost:${PORT_API}/healthz" 60
wait_for "http://localhost:${PORT_WEB}/" 60

for route in "${LIST_ROUTES[@]}"; do
  url="http://localhost:${PORT_WEB}/api${route}"
  status=$(curl -sS -o "$logs/response.json" -w '%{http_code}' --max-time 10 "$url") ||
    fail "GET $url got no answer"
  # A 404 or 502 with no API request in backend.log means the proxy didn't forward it.
  [ "$status" = 200 ] || fail "GET $url answered $status: $(head -c 300 "$logs/response.json")"
  grep -q '"items"' "$logs/response.json" ||
    fail "GET $url did not return a page of rows: $(head -c 300 "$logs/response.json")"
done

echo "smoke: ${#LIST_ROUTES[@]} route(s) reached the API on :${PORT_API} through the frontend on :${PORT_WEB}"
