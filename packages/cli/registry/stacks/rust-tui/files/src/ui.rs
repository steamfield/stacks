//! Drawing. `draw` reads the `App` and writes one frame; it changes nothing
//! and does no I/O. Every style is in `Theme`, so colors live in one place.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Clear, List, ListItem, ListState, Paragraph, Wrap};

use crate::app::{App, Mode};
use crate::keys;
use crate::tasks::{Status, Task};

struct Theme;

impl Theme {
    const BORDER: Style = Style::new().fg(Color::DarkGray);
    const TITLE: Style = Style::new().add_modifier(Modifier::BOLD);
    const SELECTED: Style = Style::new().add_modifier(Modifier::REVERSED);
    const MUTED: Style = Style::new().fg(Color::DarkGray);
    const KEY: Style = Style::new().fg(Color::Cyan);

    fn status(status: Status) -> Style {
        match status {
            Status::Todo => Style::new().fg(Color::Yellow),
            Status::Doing => Style::new().fg(Color::Blue),
            Status::Done => Style::new().fg(Color::Green),
        }
    }
}

pub fn draw(frame: &mut Frame, app: &App) {
    let [body, footer] =
        Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).areas(frame.area());
    match app.screen() {
        Mode::Detail => detail(frame, body, app),
        _ => list(frame, body, app),
    }
    frame.render_widget(Paragraph::new(hints(app.mode())), footer);
    if app.mode() == Mode::Help {
        help(frame, body, app.screen());
    }
}

fn list(frame: &mut Frame, area: Rect, app: &App) {
    let block = Block::bordered()
        .border_style(Theme::BORDER)
        .title(Span::styled(" Tasks ", Theme::TITLE));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let [filter, rows] =
        Layout::vertical([Constraint::Length(1), Constraint::Fill(1)]).areas(inner);

    let prompt = match (app.mode(), app.filter()) {
        (Mode::Filter, text) => Line::from(vec![Span::raw("/"), Span::raw(text), Span::raw("_")]),
        (_, "") => Line::styled("/ to filter", Theme::MUTED),
        (_, text) => Line::from(vec![
            Span::styled("filter: ", Theme::MUTED),
            Span::raw(text),
        ]),
    };
    frame.render_widget(Paragraph::new(prompt), filter);

    let visible = app.visible();
    if visible.is_empty() {
        let empty = Paragraph::new(Line::styled("No tasks match the filter.", Theme::MUTED));
        frame.render_widget(empty, rows);
        return;
    }
    let id_width = visible.iter().map(|t| t.id.len()).max().unwrap_or(0);
    let items: Vec<ListItem> = visible.iter().map(|task| row(task, id_width)).collect();
    let mut state = ListState::default().with_selected(app.selected());
    let widget = List::new(items)
        .highlight_style(Theme::SELECTED)
        .highlight_symbol("> ");
    frame.render_stateful_widget(widget, rows, &mut state);
}

fn row(task: &Task, id_width: usize) -> ListItem<'static> {
    ListItem::new(Line::from(vec![
        Span::raw(format!("{:<id_width$}  ", task.id)),
        Span::styled(
            format!("{:<6}", task.status.label()),
            Theme::status(task.status),
        ),
        Span::raw(format!("  {}", task.title)),
    ]))
}

fn detail(frame: &mut Frame, area: Rect, app: &App) {
    let Some(task) = app.selected_task() else {
        return;
    };
    let block = Block::bordered()
        .border_style(Theme::BORDER)
        .title(Span::styled(format!(" {} ", task.id), Theme::TITLE));
    let notes = if task.notes.is_empty() {
        Line::styled("No notes.", Theme::MUTED)
    } else {
        Line::raw(task.notes.as_str())
    };
    let text = vec![
        Line::styled(task.title.as_str(), Theme::TITLE),
        Line::from(vec![
            Span::styled("Status: ", Theme::MUTED),
            Span::styled(task.status.label(), Theme::status(task.status)),
        ]),
        Line::default(),
        notes,
    ];
    let paragraph = Paragraph::new(text).block(block).wrap(Wrap { trim: true });
    frame.render_widget(paragraph, area);
}

/// The overlay listing every binding of the screen under it, then help's own.
fn help(frame: &mut Frame, area: Rect, screen: Mode) {
    let lines: Vec<Line> = grouped(keys::bindings(screen).chain(keys::bindings(Mode::Help)))
        .into_iter()
        .map(|(label, help)| {
            Line::from(vec![
                Span::styled(format!("{label:>12}  "), Theme::KEY),
                Span::raw(help),
            ])
        })
        .collect();
    let height = u16::try_from(lines.len() + 2).unwrap_or(u16::MAX);
    let popup = centered(area, 40, height);
    let block = Block::bordered()
        .border_style(Theme::BORDER)
        .title(Span::styled(" Keys ", Theme::TITLE));
    frame.render_widget(Clear, popup);
    frame.render_widget(Paragraph::new(lines).block(block), popup);
}

/// The footer: the current mode's bindings on one line.
fn hints(mode: Mode) -> Line<'static> {
    let mut spans = Vec::new();
    for (label, help) in grouped(keys::bindings(mode)) {
        if !spans.is_empty() {
            spans.push(Span::raw("  "));
        }
        spans.push(Span::styled(label, Theme::KEY));
        spans.push(Span::styled(format!(" {help}"), Theme::MUTED));
    }
    Line::from(spans)
}

/// Bindings with the same help text share one entry (`↑/k previous`), and a
/// binding listed twice shows once.
fn grouped<'a>(bindings: impl Iterator<Item = &'a keys::Binding>) -> Vec<(String, &'static str)> {
    let mut entries: Vec<(String, &'static str)> = Vec::new();
    let mut seen: Vec<(&str, &str)> = Vec::new();
    for binding in bindings {
        if seen.contains(&(binding.label, binding.help)) {
            continue;
        }
        seen.push((binding.label, binding.help));
        match entries.iter_mut().find(|(_, help)| *help == binding.help) {
            Some((label, _)) => {
                label.push('/');
                label.push_str(binding.label);
            }
            None => entries.push((binding.label.to_owned(), binding.help)),
        }
    }
    entries
}

fn centered(area: Rect, width: u16, height: u16) -> Rect {
    let width = width.min(area.width);
    let height = height.min(area.height);
    Rect {
        x: area.x + (area.width - width) / 2,
        y: area.y + (area.height - height) / 2,
        width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    use super::*;
    use crate::app::Action;
    use crate::tasks::sample;

    /// Draw the app after `actions` at a fixed size and compare the frame with
    /// `src/snapshots/<name>.snap`. `make snapshots` rewrites them.
    fn assert_frame(name: &str, actions: &[Action], (width, height): (u16, u16)) {
        let mut app = App::new(sample());
        for action in actions {
            app.update(*action);
        }
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(|frame| draw(frame, &app)).unwrap();
        let mut settings = insta::Settings::clone_current();
        settings.set_prepend_module_to_snapshot(false);
        settings.set_omit_expression(true);
        settings.bind(|| insta::assert_snapshot!(name, terminal.backend()));
    }

    const SIZE: (u16, u16) = (80, 12);

    #[test]
    fn list() {
        assert_frame("list", &[Action::Down], SIZE);
    }

    #[test]
    fn filtered() {
        let typed = [Action::StartFilter, Action::Type('s'), Action::Type('e')];
        assert_frame("filtered", &typed, SIZE);
    }

    #[test]
    fn empty() {
        assert_frame("empty", &[Action::StartFilter, Action::Type('z')], SIZE);
    }

    #[test]
    fn detail() {
        assert_frame("detail", &[Action::Down, Action::Open], SIZE);
    }

    #[test]
    fn help() {
        assert_frame("help", &[Action::Help], (80, 16));
    }

    #[test]
    fn narrow() {
        assert_frame("narrow", &[Action::Open], (24, 8));
    }
}
