# Development

## Toolchain

Xcode (with an iOS simulator runtime), XcodeGen and SwiftLint, all on macOS. swift-format ships with Xcode and runs as `xcrun swift-format`. xcbeautify is optional and shortens xcodebuild's log.

```sh
brew install xcodegen swiftlint xcbeautify
make doctor
```

The versions this project was set up with are in the README.

## The project file

`project.yml` is the Xcode project. `make project` runs XcodeGen to write `<name>.xcodeproj`, which is gitignored. After pulling, switching branches or adding a file, run `make project` again; XcodeGen picks up files by folder. Open the generated project in Xcode with `open *.xcodeproj` to run, debug or preview.

Edits made in Xcode's project editor (build settings, new targets, capabilities) are lost on the next `make project`. Make them in project.yml instead. The XcodeGen docs list every key: <https://github.com/yonaskolb/XcodeGen/blob/master/Docs/ProjectSpec.md>.

## Builds and signing

Every Makefile build targets the simulator with `CODE_SIGNING_ALLOWED=NO`, so no Apple developer account is needed. Running on a device or archiving for the App Store needs a team and signing settings in project.yml, which this slice leaves to the user.

`make typecheck` compiles in Debug for the chosen simulator; `make test`, `make coverage` and `make test-ui` reuse that build from `build/DerivedData`. `make coverage` is `make test` with code coverage and the floor from `docs/guidance/testing.md`; verify and CI run it in place of `make test`. `make build` compiles Release for any simulator, which proves the production configuration builds. Warnings are errors in both.

macOS ships GNU Make 3.81, which ignores `.SHELLFLAGS`. Every piped xcodebuild recipe starts with `$(STRICT)` (`set -euo pipefail`), or a failed build piped into xcbeautify would exit 0.

## Simulators

`scripts/sim-destination.sh` prints the `-destination` for xcodebuild: `SIMULATOR_UDID` when set, otherwise a booted iPhone, otherwise the first iPhone on the newest iOS runtime. List them with `xcrun simctl list devices available`. When several agents or terminals test at once, give each its own simulator:

```sh
udid=$(xcrun simctl create "<name>" <device type id> <runtime id>)
SIMULATOR_UDID=$udid make test
xcrun simctl delete "$udid"
```

`xcrun simctl list devicetypes` and `xcrun simctl list runtimes` print the ids.

## Lint and format

`make lint` runs SwiftLint with `--strict`, so warnings fail. `make fmt` formats with swift-format and `make fmt-check` fails on any difference. `make lint-fix` applies SwiftLint's automatic fixes, then runs the formatter. SwiftLint's layout rules that swift-format owns are disabled in `.swiftlint.yml`; keep the two from disagreeing when adding rules.

## XcodeBuildMCP (optional)

XcodeBuildMCP is an MCP server that lets a coding agent build, run, test and screenshot the simulator through tools instead of shell commands. It's optional: every check here runs through make. To try it with Claude Code, add it to your own user config (`claude mcp add` with the command its README gives) rather than committing a `.mcp.json`, so the project doesn't depend on it.
