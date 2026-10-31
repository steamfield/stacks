---
name: add-screen
description: Add a screen to the Bubble Tea UI in internal/ui, with its keys, help, golden frame and tests. Use when the user asks for a new view, page, panel or mode in the terminal app.
---

# Add a screen

The detail screen is the model to copy: a `screen` constant, a branch in `keyPress`, a render function in `view.go` and a frame in `TestFrames`.

1. Add a constant to the `screen` enum in `model.go` and any state the screen needs to `Model`. Data it shows arrives as a message from a `tea.Cmd`; never load it inside `Update`.
2. Add its bindings to `keyMap` in `keys.go` with `key.WithHelp`, and a `case` in `keyPress` that handles them. Include a way back (`m.keys.Back`) and `m.keys.Quit`.
3. Render it in `view.go` with a `<name>View()` function that reads only the model and takes styles from `internal/theme`. End with `m.help.ShortHelpView(...)` listing its bindings.
4. In `model_test.go`, add a frame to `TestFrames` built by sending key messages to a `ready` model, plus a test that the keys enter and leave the screen.
5. Run `make golden`, read every changed `.golden` file with the user, then `make test lint`.
6. If the screen needs new data in text or JSON output, extend `internal/output` and the integration cases in `tests/integration`.
