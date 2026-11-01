//! Every failure the program reports. Each variant has a stable code, a
//! suggestion that says how to fix it, and an exit status, all mapped here.

use std::io;
use std::path::PathBuf;

use crate::config::BIN;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    Usage { message: String },
    #[error("invalid setting {key}: {reason}")]
    InvalidSetting { key: String, reason: String },
    #[error("cannot open log file {}: {source}", path.display())]
    LogFile {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("cannot read tasks file {}: {source}", path.display())]
    TasksRead {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("invalid tasks file {}: {source}", path.display())]
    TasksParse {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("invalid tasks: {reason}")]
    InvalidTask { reason: String },
    #[error("terminal failure: {0}")]
    Terminal(#[source] io::Error),
    #[error("cannot write output: {0}")]
    Output(#[source] io::Error),
}

impl AppError {
    /// The `UPPER_SNAKE` code scripts branch on. Never reuse or rename one.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Usage { .. } => "USAGE",
            Self::InvalidSetting { .. } => "INVALID_SETTING",
            Self::LogFile { .. } => "LOG_FILE",
            Self::TasksParse { .. } | Self::InvalidTask { .. } => "INVALID_DATA",
            Self::Terminal(_) => "TERMINAL",
            Self::TasksRead { .. } | Self::Output(_) => "IO",
        }
    }

    pub fn suggestion(&self) -> String {
        match self {
            Self::Usage { .. } => format!("Run {BIN} --help for supported flags."),
            Self::InvalidSetting { key, .. } => {
                format!("Set {key} to a valid value in the flags or environment.")
            }
            Self::LogFile { .. } => {
                "Check that the log file's directory exists and is writable.".to_owned()
            }
            Self::TasksRead { .. } => {
                "Check that the file exists and is readable, or unset --tasks.".to_owned()
            }
            Self::TasksParse { .. } | Self::InvalidTask { .. } => {
                "The file must be a JSON array of {id, title, status, notes} objects with unique ids, titles and a status of todo, doing or done.".to_owned()
            }
            Self::Terminal(_) => "Run it in a terminal, or pass --no-tui or --json.".to_owned(),
            Self::Output(_) => "Check the output destination and retry.".to_owned(),
        }
    }

    /// 2 for a mistake in the invocation, 3 for bad configuration, 1 for anything else.
    pub fn exit_code(&self) -> u8 {
        match self {
            Self::Usage { .. } => 2,
            Self::InvalidSetting { .. } | Self::LogFile { .. } => 3,
            Self::TasksRead { .. }
            | Self::TasksParse { .. }
            | Self::InvalidTask { .. }
            | Self::Terminal(_)
            | Self::Output(_) => 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_kind_of_failure_maps_to_its_exit_code() {
        let usage = AppError::Usage {
            message: "unexpected argument".to_owned(),
        };
        let setting = AppError::InvalidSetting {
            key: "RUST_LOG".to_owned(),
            reason: "bad directive".to_owned(),
        };
        let data = AppError::InvalidTask {
            reason: "task 1 has no id".to_owned(),
        };
        let terminal = AppError::Terminal(io::Error::from(io::ErrorKind::Unsupported));
        assert_eq!((usage.code(), usage.exit_code()), ("USAGE", 2));
        assert_eq!(
            (setting.code(), setting.exit_code()),
            ("INVALID_SETTING", 3)
        );
        assert_eq!((data.code(), data.exit_code()), ("INVALID_DATA", 1));
        assert_eq!((terminal.code(), terminal.exit_code()), ("TERMINAL", 1));
    }

    #[test]
    fn every_suggestion_says_what_to_do() {
        let missing = AppError::TasksRead {
            path: PathBuf::from("missing.json"),
            source: io::Error::from(io::ErrorKind::NotFound),
        };
        assert!(missing.to_string().contains("missing.json"));
        assert!(missing.suggestion().contains("--tasks"));
        let terminal = AppError::Terminal(io::Error::from(io::ErrorKind::Unsupported));
        assert!(terminal.suggestion().contains("--no-tui"));
    }
}
