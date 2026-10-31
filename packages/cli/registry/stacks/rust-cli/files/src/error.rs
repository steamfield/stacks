//! Every failure the tool reports. Each variant has a stable code, a
//! suggestion that says how to fix it, and an exit status, all mapped here.

use std::io;
use std::path::PathBuf;

use crate::config::BIN;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    Usage { message: String },
    #[error("config file {} not found", path.display())]
    ConfigNotFound { path: PathBuf },
    #[error("cannot read config file {}: {source}", path.display())]
    ConfigRead {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("invalid config file {}: {}", path.display(), source.message())]
    ConfigParse {
        path: PathBuf,
        #[source]
        source: Box<toml::de::Error>,
    },
    #[error("invalid setting {key}: {reason}")]
    InvalidSetting { key: String, reason: String },
    #[error("cannot write output: {0}")]
    Output(#[source] io::Error),
}

impl AppError {
    /// The `UPPER_SNAKE` code scripts branch on. Never reuse or rename one.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Usage { .. } => "USAGE",
            Self::ConfigNotFound { .. } => "CONFIG_NOT_FOUND",
            Self::ConfigRead { .. } | Self::ConfigParse { .. } => "CONFIG",
            Self::InvalidSetting { .. } => "INVALID_SETTING",
            Self::Output(_) => "IO",
        }
    }

    pub fn suggestion(&self) -> String {
        match self {
            Self::Usage { .. } => format!("Run {BIN} --help for supported commands and flags."),
            Self::ConfigNotFound { .. } => {
                "Check the --config path, or omit it to use the default files.".to_owned()
            }
            Self::ConfigRead { .. } => {
                "Check the file's permissions, or choose another --config path.".to_owned()
            }
            Self::ConfigParse { .. } => {
                "Fix the TOML syntax, or remove or rename the key the message names.".to_owned()
            }
            Self::InvalidSetting { key, .. } => {
                format!("Set {key} to a valid value in the config file or environment.")
            }
            Self::Output(_) => "Check the output destination and retry.".to_owned(),
        }
    }

    /// 2 for a mistake in the invocation, 3 for bad configuration, 1 for anything else.
    pub fn exit_code(&self) -> u8 {
        match self {
            Self::Usage { .. } => 2,
            Self::ConfigNotFound { .. }
            | Self::ConfigRead { .. }
            | Self::ConfigParse { .. }
            | Self::InvalidSetting { .. } => 3,
            Self::Output(_) => 1,
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
            key: "greeting".to_owned(),
            reason: "empty".to_owned(),
        };
        let output = AppError::Output(io::Error::from(io::ErrorKind::BrokenPipe));
        assert_eq!((usage.code(), usage.exit_code()), ("USAGE", 2));
        assert_eq!(
            (setting.code(), setting.exit_code()),
            ("INVALID_SETTING", 3)
        );
        assert_eq!((output.code(), output.exit_code()), ("IO", 1));
    }

    #[test]
    fn every_suggestion_says_what_to_do() {
        let missing = AppError::ConfigNotFound {
            path: PathBuf::from("missing.toml"),
        };
        assert!(missing.to_string().contains("missing.toml"));
        assert!(missing.suggestion().contains("--config"));
    }
}
