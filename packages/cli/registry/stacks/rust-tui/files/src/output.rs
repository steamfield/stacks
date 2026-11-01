//! Printed output, used only when the full-screen UI isn't running: results
//! on stdout, errors on stderr. Under `--json` a result is one JSON document
//! and an error is `{"error":{"code","message","suggestion"}}` on stderr.

use std::fmt::Write as _;
use std::io::Write;

use serde::Serialize;

use crate::error::AppError;
use crate::tasks::Task;

#[derive(Debug, Clone, Copy, Default)]
pub struct Output {
    pub json: bool,
}

impl Output {
    /// Write a result: `value` as JSON, or `human` as text.
    pub fn result<T: Serialize>(
        self,
        out: &mut dyn Write,
        value: &T,
        human: &str,
    ) -> Result<(), AppError> {
        let written = if self.json {
            serde_json::to_writer(&mut *out, value)
                .map_err(std::io::Error::from)
                .and_then(|()| writeln!(out))
        } else {
            writeln!(out, "{human}")
        };
        written.and_then(|()| out.flush()).map_err(AppError::Output)
    }

    /// The task list: an aligned table, or `{"tasks": [...]}`.
    pub fn tasks(self, out: &mut dyn Write, tasks: &[Task]) -> Result<(), AppError> {
        self.result(out, &serde_json::json!({ "tasks": tasks }), &table(tasks))
    }

    /// Report a failure once. A failure to write the report has nowhere left
    /// to go, so it is dropped.
    pub fn error(self, err: &mut dyn Write, failure: &AppError) {
        let written = if self.json {
            let document = serde_json::json!({
                "error": {
                    "code": failure.code(),
                    "message": failure.to_string(),
                    "suggestion": failure.suggestion(),
                }
            });
            writeln!(err, "{document}")
        } else {
            writeln!(
                err,
                "error[{}]: {failure}\n  suggestion: {}",
                failure.code(),
                failure.suggestion()
            )
        };
        drop(written);
    }
}

/// One task per line under an `ID STATUS TITLE` header, columns aligned.
pub fn table(tasks: &[Task]) -> String {
    let id_width = tasks.iter().map(|t| t.id.len()).max().unwrap_or(0).max(2);
    let mut text = format!("{:<id_width$}  {:<6}  TITLE", "ID", "STATUS");
    for task in tasks {
        // Writing to a String cannot fail.
        let _ = write!(
            text,
            "\n{:<id_width$}  {:<6}  {}",
            task.id,
            task.status.label(),
            task.title
        );
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::sample;

    #[test]
    fn the_table_aligns_every_column() {
        assert_eq!(
            table(&sample()),
            "ID   STATUS  TITLE\n\
             T-1  doing   Write the README\n\
             T-2  todo    Add a second screen\n\
             T-3  done    Set up releases"
        );
        assert_eq!(table(&[]), "ID  STATUS  TITLE");
    }

    #[test]
    fn json_tasks_are_one_document() {
        let mut out = Vec::new();
        Output { json: true }.tasks(&mut out, &sample()).unwrap();
        let document: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(document["tasks"][1]["title"], "Add a second screen");
        assert_eq!(document["tasks"][0]["status"], "doing");
        assert!(document["tasks"][2].get("notes").is_none());
    }

    #[test]
    fn errors_carry_code_message_and_suggestion_in_both_modes() {
        let failure = AppError::Usage {
            message: "unexpected argument 'x'".to_owned(),
        };
        let mut err = Vec::new();
        Output { json: true }.error(&mut err, &failure);
        let document: serde_json::Value = serde_json::from_slice(&err).unwrap();
        assert_eq!(document["error"]["code"], "USAGE");
        assert_eq!(document["error"]["message"], "unexpected argument 'x'");
        let mut text = Vec::new();
        Output { json: false }.error(&mut text, &failure);
        let text = String::from_utf8(text).unwrap();
        assert!(text.starts_with("error[USAGE]: unexpected argument 'x'\n  suggestion: "));
    }
}
