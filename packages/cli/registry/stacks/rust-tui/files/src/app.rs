//! The UI's state and every change to it. No terminal, no I/O and no
//! rendering: `update` takes an `Action`, so tests drive it directly.

use crate::tasks::Task;

/// Everything the user can ask for. `keys.rs` maps key presses to these.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Up,
    Down,
    /// Open the selected task, or finish typing a filter.
    Open,
    /// Leave the screen, clear the filter, or close help.
    Back,
    StartFilter,
    Type(char),
    Erase,
    Help,
    Quit,
}

/// What the keys act on. `Help` is an overlay on the screen below it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    List,
    Filter,
    Detail,
    Help,
}

#[derive(Debug, Clone)]
pub struct App {
    tasks: Vec<Task>,
    filter: String,
    mode: Mode,
    /// The mode help was opened from, drawn under the overlay.
    under_help: Mode,
    /// Index into `visible()`.
    selected: usize,
    quit: bool,
}

impl App {
    pub fn new(tasks: Vec<Task>) -> Self {
        Self {
            tasks,
            filter: String::new(),
            mode: Mode::List,
            under_help: Mode::List,
            selected: 0,
            quit: false,
        }
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// The screen to draw: the current mode, or the one under the help overlay.
    pub fn screen(&self) -> Mode {
        if self.mode == Mode::Help {
            self.under_help
        } else {
            self.mode
        }
    }

    pub fn filter(&self) -> &str {
        &self.filter
    }

    pub fn should_quit(&self) -> bool {
        self.quit
    }

    /// The tasks the filter matches, in their original order.
    pub fn visible(&self) -> Vec<&Task> {
        self.tasks
            .iter()
            .filter(|task| task.matches(&self.filter))
            .collect()
    }

    /// The selected row in `visible()`, or `None` when nothing matches.
    pub fn selected(&self) -> Option<usize> {
        (self.selected < self.visible().len()).then_some(self.selected)
    }

    pub fn selected_task(&self) -> Option<&Task> {
        self.visible().get(self.selected).copied()
    }

    pub fn update(&mut self, action: Action) {
        match (self.mode, action) {
            (_, Action::Quit) => self.quit = true,
            (Mode::Help, Action::Help | Action::Back) => self.mode = self.under_help,
            (Mode::List | Mode::Detail, Action::Help) => {
                self.under_help = self.mode;
                self.mode = Mode::Help;
            }
            (Mode::List | Mode::Filter, Action::Up) => {
                self.selected = self.selected.saturating_sub(1);
            }
            (Mode::List | Mode::Filter, Action::Down) => {
                if self.selected + 1 < self.visible().len() {
                    self.selected += 1;
                }
            }
            (Mode::List, Action::Open) if self.selected_task().is_some() => {
                self.mode = Mode::Detail;
            }
            (Mode::List, Action::StartFilter) => self.mode = Mode::Filter,
            (Mode::List, Action::Back) => self.set_filter(String::new()),
            (Mode::Filter, Action::Type(c)) => {
                let mut filter = std::mem::take(&mut self.filter);
                filter.push(c);
                self.set_filter(filter);
            }
            (Mode::Filter, Action::Erase) => {
                let mut filter = std::mem::take(&mut self.filter);
                filter.pop();
                self.set_filter(filter);
            }
            (Mode::Filter, Action::Open) | (Mode::Detail, Action::Back) => self.mode = Mode::List,
            (Mode::Filter, Action::Back) => {
                self.set_filter(String::new());
                self.mode = Mode::List;
            }
            _ => {}
        }
    }

    fn set_filter(&mut self, filter: String) {
        self.filter = filter;
        self.selected = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::sample;

    fn app_after(actions: &[Action]) -> App {
        let mut app = App::new(sample());
        for action in actions {
            app.update(*action);
        }
        app
    }

    #[test]
    fn the_selection_moves_within_the_list() {
        let app = app_after(&[Action::Up, Action::Down, Action::Down, Action::Down]);
        assert_eq!(app.selected(), Some(2));
        assert_eq!(app_after(&[Action::Down, Action::Up]).selected(), Some(0));
    }

    #[test]
    fn open_and_back_move_between_list_and_detail() {
        let app = app_after(&[Action::Down, Action::Open]);
        assert_eq!(app.mode(), Mode::Detail);
        assert_eq!(app.selected_task().map(|t| t.id.as_str()), Some("T-2"));
        assert_eq!(app_after(&[Action::Open, Action::Back]).mode(), Mode::List);
    }

    #[test]
    fn typing_a_filter_narrows_the_list_and_resets_the_selection() {
        let app = app_after(&[
            Action::Down,
            Action::StartFilter,
            Action::Type('r'),
            Action::Type('e'),
            Action::Type('l'),
        ]);
        assert_eq!(app.mode(), Mode::Filter);
        let ids: Vec<&str> = app.visible().iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["T-3"]);
        assert_eq!(app.selected(), Some(0));
        let erased = app_after(&[Action::StartFilter, Action::Type('x'), Action::Erase]);
        assert_eq!(erased.visible().len(), 3);
    }

    #[test]
    fn enter_keeps_the_filter_and_escape_clears_it() {
        let typed = [
            Action::StartFilter,
            Action::Type('t'),
            Action::Type('-'),
            Action::Type('1'),
        ];
        let kept = app_after(&[&typed[..], &[Action::Open]].concat());
        assert_eq!((kept.mode(), kept.filter()), (Mode::List, "t-1"));
        let cleared = app_after(&[&typed[..], &[Action::Back]].concat());
        assert_eq!((cleared.mode(), cleared.filter()), (Mode::List, ""));
    }

    #[test]
    fn nothing_opens_when_the_filter_matches_nothing() {
        let app = app_after(&[
            Action::StartFilter,
            Action::Type('z'),
            Action::Open,
            Action::Open,
        ]);
        assert_eq!((app.mode(), app.selected()), (Mode::List, None));
    }

    #[test]
    fn help_overlays_the_screen_it_was_opened_from() {
        let app = app_after(&[Action::Open, Action::Help]);
        assert_eq!((app.mode(), app.screen()), (Mode::Help, Mode::Detail));
        let closed = app_after(&[Action::Open, Action::Help, Action::Back]);
        assert_eq!(closed.mode(), Mode::Detail);
    }

    #[test]
    fn quit_works_from_every_mode() {
        for start in [
            &[][..],
            &[Action::StartFilter],
            &[Action::Open],
            &[Action::Help],
        ] {
            let app = app_after(&[start, &[Action::Quit]].concat());
            assert!(app.should_quit(), "{start:?}");
        }
    }
}
