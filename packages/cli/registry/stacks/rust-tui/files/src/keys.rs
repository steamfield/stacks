//! Every key the UI handles, in one table. The help overlay and the footer
//! read the same table, so a binding can't exist without its help line.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use crate::app::{Action, Mode};

#[derive(Debug)]
pub struct Binding {
    pub modes: &'static [Mode],
    pub keys: &'static [KeyCode],
    /// The keys as the help shows them.
    pub label: &'static str,
    pub action: Action,
    pub help: &'static str,
}

const BROWSE: &[Mode] = &[Mode::List, Mode::Filter];

pub const BINDINGS: &[Binding] = &[
    Binding {
        modes: BROWSE,
        keys: &[KeyCode::Up],
        label: "↑",
        action: Action::Up,
        help: "previous",
    },
    Binding {
        modes: BROWSE,
        keys: &[KeyCode::Down],
        label: "↓",
        action: Action::Down,
        help: "next",
    },
    Binding {
        modes: &[Mode::List],
        keys: &[KeyCode::Char('k')],
        label: "k",
        action: Action::Up,
        help: "previous",
    },
    Binding {
        modes: &[Mode::List],
        keys: &[KeyCode::Char('j')],
        label: "j",
        action: Action::Down,
        help: "next",
    },
    Binding {
        modes: &[Mode::List],
        keys: &[KeyCode::Enter],
        label: "enter",
        action: Action::Open,
        help: "open",
    },
    Binding {
        modes: &[Mode::List],
        keys: &[KeyCode::Char('/')],
        label: "/",
        action: Action::StartFilter,
        help: "filter",
    },
    Binding {
        modes: &[Mode::List],
        keys: &[KeyCode::Esc],
        label: "esc",
        action: Action::Back,
        help: "clear filter",
    },
    Binding {
        modes: &[Mode::Filter],
        keys: &[KeyCode::Enter],
        label: "enter",
        action: Action::Open,
        help: "keep filter",
    },
    Binding {
        modes: &[Mode::Filter],
        keys: &[KeyCode::Esc],
        label: "esc",
        action: Action::Back,
        help: "clear filter",
    },
    Binding {
        modes: &[Mode::Filter],
        keys: &[KeyCode::Backspace],
        label: "backspace",
        action: Action::Erase,
        help: "delete",
    },
    Binding {
        modes: &[Mode::Detail],
        keys: &[KeyCode::Esc, KeyCode::Backspace],
        label: "esc",
        action: Action::Back,
        help: "back",
    },
    Binding {
        modes: &[Mode::Help],
        keys: &[KeyCode::Esc, KeyCode::Char('?')],
        label: "esc",
        action: Action::Back,
        help: "close help",
    },
    Binding {
        modes: &[Mode::List, Mode::Detail],
        keys: &[KeyCode::Char('?')],
        label: "?",
        action: Action::Help,
        help: "help",
    },
    Binding {
        modes: &[Mode::List, Mode::Detail, Mode::Help],
        keys: &[KeyCode::Char('q')],
        label: "q",
        action: Action::Quit,
        help: "quit",
    },
];

/// The action for a key press in `mode`, if any. Ctrl+C quits from every mode;
/// while filtering, any other character is typed into the filter.
pub fn action(mode: Mode, key: KeyEvent) -> Option<Action> {
    if key.kind != KeyEventKind::Press {
        return None;
    }
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        return (key.code == KeyCode::Char('c')).then_some(Action::Quit);
    }
    if let Some(binding) = bindings(mode).find(|b| b.keys.contains(&key.code)) {
        return Some(binding.action);
    }
    match (mode, key.code) {
        (Mode::Filter, KeyCode::Char(c)) => Some(Action::Type(c)),
        _ => None,
    }
}

/// The bindings that apply in `mode`, in table order.
pub fn bindings(mode: Mode) -> impl Iterator<Item = &'static Binding> {
    BINDINGS.iter().filter(move |b| b.modes.contains(&mode))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn press(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    #[test]
    fn list_keys_map_to_their_actions() {
        let cases = [
            (KeyCode::Char('j'), Some(Action::Down)),
            (KeyCode::Up, Some(Action::Up)),
            (KeyCode::Enter, Some(Action::Open)),
            (KeyCode::Char('/'), Some(Action::StartFilter)),
            (KeyCode::Char('q'), Some(Action::Quit)),
            (KeyCode::Char('x'), None),
        ];
        for (code, expected) in cases {
            assert_eq!(action(Mode::List, press(code)), expected, "{code:?}");
        }
    }

    #[test]
    fn letters_are_typed_while_filtering() {
        assert_eq!(
            action(Mode::Filter, press(KeyCode::Char('q'))),
            Some(Action::Type('q'))
        );
        assert_eq!(
            action(Mode::Filter, press(KeyCode::Char('j'))),
            Some(Action::Type('j'))
        );
        assert_eq!(
            action(Mode::Filter, press(KeyCode::Down)),
            Some(Action::Down)
        );
    }

    #[test]
    fn ctrl_c_quits_everywhere_and_releases_are_ignored() {
        let ctrl_c = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        for mode in [Mode::List, Mode::Filter, Mode::Detail, Mode::Help] {
            assert_eq!(action(mode, ctrl_c), Some(Action::Quit), "{mode:?}");
        }
        let mut release = press(KeyCode::Char('q'));
        release.kind = KeyEventKind::Release;
        assert_eq!(action(Mode::List, release), None);
    }

    #[test]
    fn no_key_is_bound_twice_in_one_mode() {
        for mode in [Mode::List, Mode::Filter, Mode::Detail, Mode::Help] {
            let mut seen = Vec::new();
            for key in bindings(mode).flat_map(|b| b.keys) {
                assert!(!seen.contains(key), "{key:?} twice in {mode:?}");
                seen.push(*key);
            }
        }
    }
}
