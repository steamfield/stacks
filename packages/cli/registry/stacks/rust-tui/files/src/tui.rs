//! The terminal's lifecycle and the event loop. `run` is the only code that
//! touches the real terminal; `event_loop` takes any backend and any event
//! source, so tests run it headless.

use std::io;

use ratatui::Terminal;
use ratatui::backend::Backend;
use ratatui::crossterm::event::{self, Event};

use crate::app::App;
use crate::error::AppError;
use crate::keys;
use crate::ui;

/// Take over the terminal, run until the user quits, and give it back.
/// `ratatui::try_init` installs a panic hook that restores the terminal
/// before the panic message prints, so a bug never leaves it in raw mode.
pub fn run(app: &mut App) -> Result<(), AppError> {
    let mut terminal = match ratatui::try_init() {
        Ok(terminal) => terminal,
        Err(e) => {
            // Raw mode may already be on; restoring is best effort here.
            let _ = ratatui::try_restore();
            return Err(AppError::Terminal(e));
        }
    };
    let result = event_loop(&mut terminal, app, event::read);
    let restored = ratatui::try_restore().map_err(AppError::Terminal);
    result.and(restored)
}

/// Draw, wait for an event, apply its action; repeat until the app quits.
/// A resize needs no action: the next draw uses the new size.
pub fn event_loop<B: Backend>(
    terminal: &mut Terminal<B>,
    app: &mut App,
    mut next_event: impl FnMut() -> io::Result<Event>,
) -> Result<(), AppError>
where
    B::Error: std::error::Error + Send + Sync + 'static,
{
    while !app.should_quit() {
        terminal
            .draw(|frame| ui::draw(frame, app))
            .map_err(|e| AppError::Terminal(io::Error::other(e)))?;
        if let Event::Key(key) = next_event().map_err(AppError::Terminal)?
            && let Some(action) = keys::action(app.mode(), key)
        {
            app.update(action);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    use super::*;
    use crate::app::Mode;
    use crate::tasks::sample;

    fn key(code: KeyCode) -> Event {
        Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
    }

    /// Run the loop over scripted events; reading past the end is an error.
    fn run_script(events: Vec<Event>) -> (App, Terminal<TestBackend>, Result<(), AppError>) {
        let mut terminal = Terminal::new(TestBackend::new(60, 12)).unwrap();
        let mut app = App::new(sample());
        let mut events = events.into_iter();
        let result = event_loop(&mut terminal, &mut app, || {
            events
                .next()
                .ok_or_else(|| io::Error::other("script ended"))
        });
        (app, terminal, result)
    }

    #[test]
    fn keys_drive_the_screens_until_quit() {
        let (app, terminal, result) = run_script(vec![
            key(KeyCode::Char('j')),
            key(KeyCode::Enter),
            Event::Resize(40, 10),
            key(KeyCode::Char('q')),
        ]);
        result.unwrap();
        assert!(app.should_quit());
        assert_eq!(app.mode(), Mode::Detail);
        let frame = terminal.backend().to_string();
        assert!(frame.contains("Add a second screen"), "{frame}");
    }

    #[test]
    fn an_event_source_failure_stops_the_loop_as_a_terminal_error() {
        let (_, _, result) = run_script(vec![key(KeyCode::Char('j'))]);
        assert_eq!(result.unwrap_err().code(), "TERMINAL");
    }
}
