#!/usr/bin/env bash
# Print an xcodebuild -destination for an available iPhone simulator, so no Makefile target
# names a device model or iOS release. Order: $SIMULATOR_UDID, then a booted iPhone, then the
# first iPhone on the newest iOS runtime.
set -euo pipefail

if [ -n "${SIMULATOR_UDID:-}" ]; then
  printf 'platform=iOS Simulator,id=%s\n' "$SIMULATOR_UDID"
  exit 0
fi

json=$(xcrun simctl list --json devices available) || {
  echo "sim-destination: xcrun simctl failed; is Xcode installed and selected (xcode-select -p)?" >&2
  exit 1
}

# JavaScript for Automation ships with macOS, so parsing the JSON needs no extra tool.
udid=$(osascript -l JavaScript - "$json" <<'JS'
function run(argv) {
  const devices = JSON.parse(argv[0]).devices;
  const version = (key) => (key.match(/SimRuntime\.iOS-([\d-]+)$/) || [, ""])[1]
    .split("-").map(Number);
  const newerFirst = (a, b) => {
    const x = version(a), y = version(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    }
    return 0;
  };
  const runtimes = Object.keys(devices).filter((k) => /SimRuntime\.iOS-/.test(k)).sort(newerFirst);
  const phones = runtimes.flatMap((runtime) => devices[runtime].filter((d) =>
    d.isAvailable !== false && /SimDeviceType\.iPhone/.test(d.deviceTypeIdentifier || "")));
  const pick = phones.find((d) => d.state === "Booted") || phones[0];
  return pick ? pick.udid : "";
}
JS
)

if [ -z "$udid" ]; then
  echo "sim-destination: no available iPhone simulator. Add one in Xcode (Window > Devices and Simulators) or with xcrun simctl create." >&2
  exit 1
fi
printf 'platform=iOS Simulator,id=%s\n' "$udid"
