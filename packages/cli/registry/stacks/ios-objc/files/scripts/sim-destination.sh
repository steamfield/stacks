#!/usr/bin/env bash
# Print an xcodebuild -destination for an available iPhone simulator, so no
# device name or iOS version is written into the Makefile.
#
#   SIMULATOR_UDID set     that simulator (xcrun simctl list devices available)
#   otherwise              a booted iPhone if there is one, else the first iPhone
#                          on the newest installed iOS runtime
#
# Exits 1 with a hint when no iPhone simulator is installed.
set -euo pipefail

if [ -n "${SIMULATOR_UDID:-}" ]; then
  printf 'platform=iOS Simulator,id=%s\n' "$SIMULATOR_UDID"
  exit 0
fi

json=$(xcrun simctl list --json devices available)

# osascript's JavaScript ships with macOS, so parsing needs no jq or Python.
udid=$(osascript -l JavaScript - "$json" <<'JS'
function run(argv) {
  const devices = JSON.parse(argv[0]).devices;
  const version = (runtime) =>
    (runtime.match(/iOS-([0-9-]+)$/) || [, ""])[1].split("-").map(Number);
  const newerFirst = (a, b) => {
    const x = version(a), y = version(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    }
    return 0;
  };
  const runtimes = Object.keys(devices).filter((r) => /SimRuntime\.iOS-/.test(r)).sort(newerFirst);
  const phones = runtimes.flatMap((r) => devices[r].filter((d) => d.name.startsWith("iPhone")));
  const pick = phones.find((d) => d.state === "Booted") || phones[0];
  return pick ? pick.udid : "";
}
JS
)

if [ -z "$udid" ]; then
  echo "sim-destination: no available iPhone simulator. Install an iOS runtime in Xcode (Settings > Components) or create one with xcrun simctl create." >&2
  exit 1
fi
printf 'platform=iOS Simulator,id=%s\n' "$udid"
