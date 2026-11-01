//! The proving payload's data: plain values and their loader, no UI imports.

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Todo,
    Doing,
    Done,
}

impl Status {
    pub fn label(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::Doing => "doing",
            Self::Done => "done",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub status: Status,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
}

impl Task {
    /// Whether the task's id or title contains `query`, ignoring case.
    pub fn matches(&self, query: &str) -> bool {
        let query = query.to_lowercase();
        self.id.to_lowercase().contains(&query) || self.title.to_lowercase().contains(&query)
    }
}

/// What the program shows when no tasks file is configured.
pub fn sample() -> Vec<Task> {
    let task = |id: &str, title: &str, status, notes: &str| Task {
        id: id.to_owned(),
        title: title.to_owned(),
        status,
        notes: notes.to_owned(),
    };
    vec![
        task(
            "T-1",
            "Write the README",
            Status::Doing,
            "Say what the tool does and how to run it.",
        ),
        task(
            "T-2",
            "Add a second screen",
            Status::Todo,
            "Follow the detail screen: a mode, its keys, a draw function and a snapshot.",
        ),
        task("T-3", "Set up releases", Status::Done, ""),
    ]
}

/// Read a JSON array of tasks from `path`, or the sample when there is none.
/// It does I/O, so `run` calls it before the UI starts, never from a draw.
pub fn load(path: Option<&Path>) -> Result<Vec<Task>, AppError> {
    let Some(path) = path else {
        return Ok(sample());
    };
    let text = std::fs::read_to_string(path).map_err(|source| AppError::TasksRead {
        path: path.to_owned(),
        source,
    })?;
    let tasks: Vec<Task> = serde_json::from_str(&text).map_err(|source| AppError::TasksParse {
        path: path.to_owned(),
        source,
    })?;
    validate(&tasks)?;
    Ok(tasks)
}

/// Ids are present and unique, titles are present. Serde already checks status.
pub fn validate(tasks: &[Task]) -> Result<(), AppError> {
    let mut seen = HashSet::new();
    for (index, task) in tasks.iter().enumerate() {
        let at = index + 1;
        let reason = if task.id.trim().is_empty() {
            format!("task {at} has no id")
        } else if !seen.insert(task.id.as_str()) {
            format!("task {at} repeats id {}", task.id)
        } else if task.title.trim().is_empty() {
            format!("task {at} has no title")
        } else {
            continue;
        };
        return Err(AppError::InvalidTask { reason });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(text: &str) -> tempfile::NamedTempFile {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), text).unwrap();
        file
    }

    #[test]
    fn no_path_is_the_sample() {
        assert_eq!(load(None).unwrap(), sample());
        validate(&sample()).unwrap();
    }

    #[test]
    fn a_file_is_read_and_validated() {
        let file = write(r#"[{"id":"A","title":"From a file","status":"todo"}]"#);
        let tasks = load(Some(file.path())).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(
            (tasks[0].status, tasks[0].notes.as_str()),
            (Status::Todo, "")
        );
    }

    #[test]
    fn bad_files_name_what_is_wrong() {
        let cases = [
            (r#"[{"id":"A"}]"#, "INVALID_DATA"),
            (
                r#"[{"id":"A","title":"x","status":"later"}]"#,
                "INVALID_DATA",
            ),
            (
                r#"[{"id":"A","title":"x","status":"todo","due":"soon"}]"#,
                "INVALID_DATA",
            ),
            (
                r#"[{"id":"A","title":"x","status":"todo"},{"id":"A","title":"y","status":"done"}]"#,
                "INVALID_DATA",
            ),
            (
                r#"[{"id":" ","title":"x","status":"todo"}]"#,
                "INVALID_DATA",
            ),
        ];
        for (text, code) in cases {
            let file = write(text);
            assert_eq!(load(Some(file.path())).unwrap_err().code(), code, "{text}");
        }
        let missing = load(Some(Path::new("/nonexistent/tasks.json"))).unwrap_err();
        assert_eq!((missing.code(), missing.exit_code()), ("IO", 1));
    }

    #[test]
    fn matching_ignores_case_and_checks_id_and_title() {
        let task = &sample()[0];
        assert!(task.matches("readme") && task.matches("t-1"));
        assert!(!task.matches("releases"));
    }
}
