#!/usr/bin/env bash
# Prints an xcodebuild -destination for an available iPhone simulator, chosen at run time so no
# device name or OS version is written down anywhere:
#
#   SIMULATOR_UDID=<udid>   use that simulator (xcrun simctl list devices available)
#   otherwise               a booted iPhone, else the first iPhone on the newest iOS runtime
#
# Fails with a message when no iPhone simulator exists; create one in Xcode's Devices window or
# with `xcrun simctl create`.
set -euo pipefail

if [ -n "${SIMULATOR_UDID:-}" ]; then
  printf 'platform=iOS Simulator,id=%s\n' "$SIMULATOR_UDID"
  exit 0
fi

json=$(xcrun simctl list devices available --json)
udid=$(printf '%s' "$json" | /usr/bin/python3 -I -c '
import json, re, sys

def version(runtime):
    match = re.search(r"\.iOS-([0-9-]+)$", runtime)
    return [int(part) for part in match.group(1).split("-")] if match else None

devices = json.load(sys.stdin)["devices"]
runtimes = sorted((r for r in devices if version(r)), key=version, reverse=True)
phones = [
    d for r in runtimes for d in devices[r] if "iPhone" in d.get("deviceTypeIdentifier", "")
]
booted = [d for d in phones if d.get("state") == "Booted"]
for device in booted + phones:
    print(device["udid"])
    sys.exit(0)
')

if [ -z "$udid" ]; then
  echo "sim-destination: no available iPhone simulator; create one in Xcode (Window > Devices and Simulators) or set SIMULATOR_UDID" >&2
  exit 1
fi
printf 'platform=iOS Simulator,id=%s\n' "$udid"
