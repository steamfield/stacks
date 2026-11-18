#!/usr/bin/env bash
# The both-parts check. Starts backend/ (`make start`) on PORT_API and frontend/'s Vite dev server
# on PORT_WEB, then requests every path in PATHS through the frontend's /api proxy. Each answer
# must be a 2xx JSON body carrying the API's x-request-id header. Prints one line on success and
# the failing server's log on failure; both servers are stopped either way.
set -euo pipefail
cd "$(dirname "$0")/.."

# One path per resource, as the frontend's code names it (the proxy strips only /api). Add each
# new resource's list path here, so this check covers it.
PATHS=(/v1/notes)

: "${PORT_API:=8000}" "${PORT_WEB:=4173}"
export PORT_API PORT_WEB
LOGS=$(mktemp -d)
PIDS=()
set -m # each server gets its own process group, so stopping it stops its children too

stop() {
  # The ${...+...} form keeps bash 3.2 (macOS) from failing on an empty array under set -u.
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$LOGS"
}
trap stop EXIT

fail() {
  echo "check-pair: $1" >&2
  if [ -n "${2:-}" ]; then tail -n 20 "$LOGS/$2.log" >&2; fi
  exit 1
}

refuse_busy() { # port, name
  if curl -s -o /dev/null --max-time 2 "http://localhost:$1/"; then
    fail "port $1 already answers; stop that server or set $2 to a free port"
  fi
}

start() { # name, part directory, command...
  local name=$1 dir=$2
  shift 2
  (cd "$dir" && exec "$@") >"$LOGS/$name.log" 2>&1 &
  PIDS+=("$!")
}

wait_for() { # url, server name, its pid
  local deadline=$((SECONDS + 60))
  until curl -fs -o /dev/null --max-time 2 "$1"; do
    kill -0 "$3" 2>/dev/null || fail "the $2 server exited before $1 answered" "$2"
    ((SECONDS < deadline)) || fail "$1 did not answer within 60s" "$2"
    sleep 0.5
  done
}

check_path() { # path
  local url="http://localhost:$PORT_WEB/api$1" status
  status=$(curl -s -D "$LOGS/headers" -o "$LOGS/body" -w '%{http_code}' --max-time 10 "$url") || true
  [[ $status == 2* ]] || fail "GET $url answered $status: $(head -c 300 "$LOGS/body")" api
  grep -qi '^x-request-id:' "$LOGS/headers" || fail "GET $url lost the x-request-id header in the proxy"
  [[ $(head -c 1 "$LOGS/body") == "{" ]] || fail "GET $url did not return a JSON object"
}

refuse_busy "$PORT_API" PORT_API
refuse_busy "$PORT_WEB" PORT_WEB
start api backend make start
start web frontend bun run dev --port "$PORT_WEB" --strictPort
wait_for "http://localhost:$PORT_API/healthz" api "${PIDS[0]}"
wait_for "http://localhost:$PORT_WEB/" web "${PIDS[1]}"
for path in "${PATHS[@]}"; do check_path "$path"; done
echo "check-pair: ${#PATHS[@]} path(s) reached the API on :$PORT_API through the frontend on :$PORT_WEB"
