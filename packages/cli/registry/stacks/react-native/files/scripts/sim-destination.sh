#!/usr/bin/env bash
# Prints an xcodebuild -destination for an available iPhone simulator, so no script names a
# device model or iOS version. IOS_SIMULATOR_ID (a UDID from `xcrun simctl list devices`) wins;
# otherwise a booted iPhone, then an iPhone on the newest installed iOS runtime.
set -euo pipefail

if [ -n "${IOS_SIMULATOR_ID:-}" ]; then
  printf 'platform=iOS Simulator,id=%s\n' "$IOS_SIMULATOR_ID"
  exit 0
fi

# shellcheck disable=SC2016 # the single-quoted program is JavaScript, not shell
xcrun simctl list devices available --json | node -e '
const { devices } = JSON.parse(require("fs").readFileSync(0, "utf8"));
const version = (runtime) => (runtime.match(/iOS-([\d-]+)$/)?.[1] ?? "").split("-").map(Number);
const newer = (a, b) => {
  const [x, y] = [version(a), version(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  }
  return 0;
};
const phones = Object.keys(devices)
  .filter((runtime) => runtime.includes(".SimRuntime.iOS-"))
  .sort(newer)
  .flatMap((runtime) => devices[runtime].filter((d) => d.isAvailable && d.name.startsWith("iPhone")));
const pick = phones.find((d) => d.state === "Booted") ?? phones[0];
if (!pick) {
  console.error("sim-destination.sh: no available iPhone simulator; add one in Xcode > Settings > Components.");
  process.exit(1);
}
console.log(`platform=iOS Simulator,id=${pick.udid}`);
'
