//! The only code that writes to stdout and stderr. Results go to stdout,
//! errors and logs to stderr. Under `--json` a result is one JSON document
//! and an error is `{"error":{"code","message","suggestion"}}` on stderr.

use std::io::Write;

use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Clone, Copy, Default)]
pub struct Output {
    pub json: bool,
    /// Color for the human error label; off under `--json`, `--no-color`,
    /// `NO_COLOR` or a stderr that isn't a terminal.
    pub color: bool,
}

impl Output {
    /// Write a command's result: `value` as JSON, or `human` as text.
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
            let label = if self.color {
                format!("\x1b[31merror[{}]\x1b[0m", failure.code())
            } else {
                format!("error[{}]", failure.code())
            };
            writeln!(
                err,
                "{label}: {failure}\n  suggestion: {}",
                failure.suggestion()
            )
        };
        drop(written);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_results_are_one_document_per_line() {
        let mut out = Vec::new();
        Output {
            json: true,
            color: false,
        }
        .result(&mut out, &serde_json::json!({ "a": 1 }), "ignored")
        .unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "{\"a\":1}\n");
    }

    #[test]
    fn json_errors_carry_code_message_and_suggestion() {
        let mut err = Vec::new();
        let failure = AppError::Usage {
            message: "unexpected argument 'x'".to_owned(),
        };
        Output {
            json: true,
            color: true,
        }
        .error(&mut err, &failure);
        let document: serde_json::Value = serde_json::from_slice(&err).unwrap();
        assert_eq!(document["error"]["code"], "USAGE");
        assert_eq!(document["error"]["message"], "unexpected argument 'x'");
        assert!(
            document["error"]["suggestion"]
                .as_str()
                .unwrap()
                .contains("--help")
        );
    }

    #[test]
    fn human_errors_are_colored_only_when_asked() {
        let failure = AppError::Usage {
            message: "bad".to_owned(),
        };
        let render = |color| {
            let mut err = Vec::new();
            Output { json: false, color }.error(&mut err, &failure);
            String::from_utf8(err).unwrap()
        };
        assert!(render(false).starts_with("error[USAGE]: bad\n  suggestion: "));
        assert!(render(true).contains("\x1b[31m"));
    }
}
