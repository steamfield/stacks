---
paths:
  - "internal/ui/**"
  - "internal/theme/**"
  - "internal/app/**"
---

# Terminal UI rules

- `Update` and `View` do no I/O: no file, network, clock or env reads. Slow work runs in a `tea.Cmd` that returns a message, as `Init` does with the task loader.
- `View` is pure and returns a `tea.View`; set `AltScreen` there, not with program options.
- Every key the UI handles is a binding in `keys.go` and appears in that screen's help. While the list is filtering, keys go to the list (only ctrl+c quits).
- Styles come from `internal/theme`; no colors inline. Bubble Tea's renderer applies `NO_COLOR` and the terminal's color profile.
- Never log to stdout or stderr while the UI runs; use the injected `*slog.Logger` (a file or discarded).
- Import only `charm.land/.../v2` paths. A `github.com/charmbracelet/bubbletea` or `lipgloss` import is the old major and mixes two APIs.
- A new screen gets a golden frame in `TestFrames`. Regenerate goldens only with `make golden`, after a deliberate view change, and read the diff.
- Never run the binary under `script`, `unbuffer`, `tmux` or `screen`. Prove behavior with `make test`, or `--no-tui` and `--json` for output; ask the user to try the UI in their terminal.

See the project's `AGENTS.md` for commands and the remaining conventions.
