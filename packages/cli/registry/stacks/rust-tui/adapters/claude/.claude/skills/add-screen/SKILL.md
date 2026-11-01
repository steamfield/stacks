---
name: add-screen
description: Add a screen, overlay or mode to this Ratatui app with its actions, keys, drawing, snapshot and tests. Use when the user asks for a new view, page, panel, popup or mode in the terminal UI.
---

# Add a screen

The detail screen is the one to copy: `Mode::Detail` in `src/app.rs`, its rows in `keys::BINDINGS`, `detail` in `src/ui.rs`, and the `detail` snapshot.

1. **State.** Add a variant to `Mode` in `src/app.rs`, any state the screen needs to `App`, and the `Action` variants that enter and leave it. Handle them in `App::update`'s `match (self.mode, action)`. Data the screen shows is loaded before the UI starts, never in `update`.
2. **Keys.** Add rows to `BINDINGS` in `src/keys.rs` for the new mode: a way back (`Action::Back`), `?` for help and `q` to quit if the mode allows them. `no_key_is_bound_twice_in_one_mode` catches a clash.
3. **Draw.** Add a `<name>(frame, area, app)` function in `src/ui.rs`, called from `draw`'s `match app.screen()`. It reads only `&App` and takes styles from `Theme`. The footer and help overlay pick up the new rows on their own.
4. **Test.** In `app.rs`, a test that sends the actions in and out of the mode. In `ui.rs`, a `#[test]` calling `assert_frame("<name>", &[...actions...], SIZE)`.
5. Run `cargo test ui::` (the new snapshot fails and writes `src/snapshots/<name>.snap.new`), then `make snapshots`, and read the new `.snap` file with the user. Then `make lint test`.
6. If the screen shows data that printed output lacks, extend `output.rs` and add a case to `tests/binary.rs`.
