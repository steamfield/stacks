#!/usr/bin/env bash
# PostToolUse (Edit|Write): compile the Objective-C file just written with the
# project's warning flags (clang -fsyntax-only against the simulator SDK) and
# report clang-format drift, handing both back to the agent as context.
#
# Advisory and read-only: never blocks, never rewrites the file. Silent when the
# file is clean, isn't .h or .m under App/, AppTests/ or AppUITests/, or a tool
# is missing. A file that imports App-Swift.h is compiled only once a build has
# generated that header in build/DerivedData.
set -euo pipefail

input=$(cat 2>/dev/null) || { echo "lint-objc.sh: cannot read payload; allowing call." >&2; exit 0; }
hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=/dev/null # agent-ops ships _lib.sh beside this hook
{ [ -r "$hook_dir/_lib.sh" ] && source "$hook_dir/_lib.sh"; } 2>/dev/null || { echo "lint-objc.sh: shared helper unavailable; allowing call." >&2; exit 0; }

file=$(hook_get "$input" tool_input.file_path | head -n 1) || exit 0
[ -n "$file" ] && [ -f "$file" ] || exit 0
root=$(cd "$(project_root)" && pwd -P) || exit 0
file="$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")"
rel=${file#"$root"/}
case "$rel" in
App/*.h | App/*.m | AppTests/*.h | AppTests/*.m | AppUITests/*.h | AppUITests/*.m) ;;
*) exit 0 ;;
esac
cd "$root"

notes=""

if command -v xcrun >/dev/null 2>&1 && sdk=$(xcrun --sdk iphonesimulator --show-sdk-path 2>/dev/null); then
  # The minimum iOS version from project.yml, else the SDK's own version.
  min=$(sed -n 's/^[[:space:]]*iOS:[[:space:]]*"\{0,1\}\([0-9.]*\)"\{0,1\}.*/\1/p' project.yml 2>/dev/null | head -n 1)
  [ -n "$min" ] || min=$(xcrun --sdk iphonesimulator --show-sdk-version 2>/dev/null) || min=""
  # shellcheck disable=SC2207 # the flags are space-separated words by design
  warnings=($(sed -n 's/^WARNING_CFLAGS[[:space:]]*=[[:space:]]*//p' Config/Shared.xcconfig 2>/dev/null))
  args=(-fsyntax-only -x objective-c -fobjc-arc -fmodules -fno-color-diagnostics -fno-caret-diagnostics
    -isysroot "$sdk" -target "$(uname -m)-apple-ios${min}-simulator" "${warnings[@]}")
  while IFS= read -r dir; do args+=(-I "$dir"); done < <(find App AppTests -type d 2>/dev/null)
  case "$rel" in
  AppTests/* | AppUITests/*)
    platform=$(xcrun --sdk iphonesimulator --show-sdk-platform-path 2>/dev/null) &&
      args+=(-F "$platform/Developer/Library/Frameworks")
    ;;
  esac
  compile=1
  if grep -q '"App-Swift.h"' "$file"; then
    generated=$(with_timeout 5 find build/DerivedData/Build/Intermediates.noindex -name App-Swift.h -path '*iphonesimulator*/DerivedSources/*' 2>/dev/null | head -n 1 || true)
    if [ -n "$generated" ]; then args+=(-I "$(dirname "$generated")"); else compile=0; fi
  fi
  if [ "$compile" = 1 ]; then
    rc=0
    out=$(with_timeout 30 xcrun clang "${args[@]}" "$rel") || rc=$?
    if [ "$rc" -ne 0 ] && [ "$rc" -lt 124 ] || grep -q 'warning:' <<<"$out"; then
      notes=$(grep -E '(error|warning):' <<<"$out" | head -n 40 || true)
    fi
  fi
fi

if command -v clang-format >/dev/null 2>&1 && ! clang-format --dry-run --Werror "$rel" >/dev/null 2>&1; then
  notes="${notes:+$notes$'\n'}clang-format would reformat $rel; run make format before finishing."
fi

notes=$(printf '%s' "$notes" | strip_control)
prefix="$root/"
notes=${notes//"$prefix"/}
[ -n "${notes//[[:space:]]/}" ] || exit 0
hook_context PostToolUse "clang found issues in $rel. Fix them before moving on (warnings are errors in this project):"$'\n'"$notes"
exit 0
