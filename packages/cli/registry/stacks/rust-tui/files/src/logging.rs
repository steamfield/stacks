//! tracing to a file, never to the screen: stdout and stderr belong to the
//! UI. Without a log file, records are discarded. `RUST_LOG` sets the level
//! (default `info`) and is validated either way.

use std::fs::OpenOptions;
use std::sync::Arc;

use tracing::subscriber::DefaultGuard;
use tracing_subscriber::EnvFilter;

use crate::config::{Config, Env};
use crate::error::AppError;

/// Install the subscriber for this invocation. It lives until the guard
/// drops, so nothing global is set and tests can run side by side.
pub fn init(config: &Config, env: &Env) -> Result<Option<DefaultGuard>, AppError> {
    let filter = filter(env)?;
    let Some(path) = &config.log_file else {
        return Ok(None);
    };
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|source| AppError::LogFile {
            path: path.clone(),
            source,
        })?;
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_writer(Arc::new(file))
        .with_ansi(false)
        .finish();
    Ok(Some(tracing::subscriber::set_default(subscriber)))
}

fn filter(env: &Env) -> Result<EnvFilter, AppError> {
    EnvFilter::try_new(env.get("RUST_LOG").unwrap_or("info")).map_err(|e| {
        AppError::InvalidSetting {
            key: "RUST_LOG".to_owned(),
            reason: e.to_string(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(rust_log: &str) -> Env {
        Env {
            vars: [("RUST_LOG".to_owned(), rust_log.to_owned())].into(),
            ..Env::default()
        }
    }

    #[test]
    fn an_invalid_rust_log_is_a_setting_error_even_without_a_log_file() {
        let error = init(&Config::default(), &env("debug,=[")).unwrap_err();
        assert_eq!(error.code(), "INVALID_SETTING");
        assert!(error.to_string().contains("RUST_LOG"));
    }

    #[test]
    fn records_go_to_the_file_as_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.log");
        let config = Config {
            log_file: Some(path.clone()),
            ..Config::default()
        };
        {
            let _guard = init(&config, &Env::default()).unwrap();
            tracing::info!(mode = "test", "start");
            tracing::debug!("below the default level");
        }
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 1, "{text}");
        let record: serde_json::Value = serde_json::from_str(text.trim()).unwrap();
        assert_eq!(record["fields"]["message"], "start");
        assert_eq!(record["fields"]["mode"], "test");
    }

    #[test]
    fn a_log_file_in_a_missing_directory_is_a_config_error() {
        let config = Config {
            log_file: Some("/nonexistent/dir/app.log".into()),
            ..Config::default()
        };
        let error = init(&config, &Env::default()).unwrap_err();
        assert_eq!((error.code(), error.exit_code()), ("LOG_FILE", 3));
    }
}
