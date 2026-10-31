//! tracing to stderr. `RUST_LOG` wins when set and is validated; otherwise
//! warnings, or debug with `--verbose`. JSON records under `--json`.

use tracing::subscriber::DefaultGuard;
use tracing_subscriber::EnvFilter;

use crate::config::{Config, Env};
use crate::error::AppError;

/// Install the subscriber for this invocation. It lives until the guard
/// drops, so nothing global is set and tests can run side by side.
pub fn init(config: &Config, env: &Env) -> Result<DefaultGuard, AppError> {
    let filter = filter(config, env)?;
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .with_ansi(false);
    Ok(if config.json {
        tracing::subscriber::set_default(builder.json().finish())
    } else {
        tracing::subscriber::set_default(builder.finish())
    })
}

fn filter(config: &Config, env: &Env) -> Result<EnvFilter, AppError> {
    match env.get("RUST_LOG") {
        Some(directives) => EnvFilter::try_new(directives).map_err(|e| AppError::InvalidSetting {
            key: "RUST_LOG".to_owned(),
            reason: e.to_string(),
        }),
        None => Ok(EnvFilter::new(if config.verbose {
            "debug"
        } else {
            "warn"
        })),
    }
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
    fn an_invalid_rust_log_is_a_setting_error() {
        let error = filter(&Config::default(), &env("debug,=[")).unwrap_err();
        assert_eq!(error.code(), "INVALID_SETTING");
        assert!(error.to_string().contains("RUST_LOG"));
    }

    #[test]
    fn verbose_raises_the_default_level() {
        let verbose = Config {
            verbose: true,
            ..Config::default()
        };
        assert_eq!(
            filter(&verbose, &Env::default()).unwrap().to_string(),
            "debug"
        );
        assert_eq!(
            filter(&Config::default(), &Env::default())
                .unwrap()
                .to_string(),
            "warn"
        );
        assert_eq!(filter(&verbose, &env("info")).unwrap().to_string(), "info");
    }
}
