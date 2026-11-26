# React Native guidance

Read these before changing the matching code. They apply to every coding agent; Claude's rules link here.

- [app](app.md): settings, errors, logging, navigation and screens.
- [native modules](native-modules.md): the local Turbo Module, the native projects and CocoaPods.
- [testing](testing.md): Jest screen and unit tests, the coverage floor, the Swift tests, the simulator build and the Maestro flow.

## Optional: XcodeBuildMCP

[XcodeBuildMCP](https://github.com/getsentry/XcodeBuildMCP) is an MCP server that lets an agent build, run and screenshot the app on a simulator. It isn't needed for any check here and the project ships no MCP config. A person who wants it adds it to their own agent's MCP settings.
