//! Typed configuration. Precedence, lowest first: defaults, environment, then
//! flags. There are no config files.

use std::collections::BTreeMap;
use std::io::{self, IsTerminal};
use std::path::PathBuf;

use crate::error::AppError;

/// The binary name. The environment prefix derives from it.
pub const BIN: &str = env!("CARGO_PKG_NAME");

/// The environment variable for a setting: `<BIN>_<KEY>`, upper-cased, with
/// hyphens as underscores (`tasks` is `MY_TUI_TASKS` for `my-tui`).
pub fn env_var(key: &str) -> String {
    format!("{BIN}_{key}").to_uppercase().replace('-', "_")
}

/// The process environment, working directory and terminal facts, captured
/// once in `main` so everything below reads values instead of global state.
#[derive(Debug, Clone, Default)]
pub struct Env {
    pub vars: BTreeMap<String, String>,
    pub cwd: PathBuf,
    pub stdin_is_terminal: bool,
    pub stdout_is_terminal: bool,
}

impl Env {
    pub fn from_process() -> Self {
        Self {
            // Variables that aren't valid UTF-8 are skipped rather than lossily read.
            vars: std::env::vars_os()
                .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))
                .collect(),
            cwd: std::env::current_dir().unwrap_or_default(),
            stdin_is_terminal: io::stdin().is_terminal(),
            stdout_is_terminal: io::stdout().is_terminal(),
        }
    }

    /// A variable's value; unset, empty and blank are the same.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.vars
            .get(name)
            .map(String::as_str)
            .filter(|v| !v.trim().is_empty())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Config {
    /// A JSON array of tasks; `None` shows the built-in sample.
    pub tasks: Option<PathBuf>,
    /// Where JSON log records go; `None` discards them.
    pub log_file: Option<PathBuf>,
    /// Print the tasks as text and exit, even on a terminal.
    pub no_tui: bool,
    /// Print the tasks as one JSON document and exit.
    pub json: bool,
}

impl Config {
    /// The full-screen UI runs only when no flag asked for printed output.
    /// `main` still requires a terminal on stdin and stdout.
    pub fn interactive(&self) -> bool {
        !self.no_tui && !self.json
    }

    pub fn validate(&self) -> Result<(), AppError> {
        if let (Some(tasks), Some(log)) = (&self.tasks, &self.log_file)
            && tasks == log
        {
            return Err(AppError::InvalidSetting {
                key: env_var("log-file"),
                reason: "must not be the tasks file".to_owned(),
            });
        }
        Ok(())
    }
}

/// What the parsed flags contribute. A flag that wasn't passed leaves the
/// environment's value alone.
#[derive(Debug, Clone, Default)]
pub struct Flags {
    pub tasks: Option<PathBuf>,
    pub log_file: Option<PathBuf>,
    pub no_tui: bool,
    pub json: bool,
}

pub fn load(flags: &Flags, env: &Env) -> Result<Config, AppError> {
    let path = |flag: &Option<PathBuf>, key: &str| {
        flag.clone()
            .or_else(|| env.get(&env_var(key)).map(PathBuf::from))
            .map(|p| env.cwd.join(p))
    };
    let no_tui_var = env_var("no-tui");
    let no_tui_env = env
        .get(&no_tui_var)
        .map(|v| parse_bool(&no_tui_var, v))
        .transpose()?;
    let config = Config {
        tasks: path(&flags.tasks, "tasks"),
        log_file: path(&flags.log_file, "log-file"),
        no_tui: flags.no_tui || no_tui_env.unwrap_or(false),
        json: flags.json,
    };
    config.validate()?;
    Ok(config)
}

fn parse_bool(name: &str, value: &str) -> Result<bool, AppError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" => Ok(true),
        "0" | "false" => Ok(false),
        _ => Err(AppError::InvalidSetting {
            key: name.to_owned(),
            reason: format!("expected true or false, got {value:?}"),
        }),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn env(vars: &[(&str, &str)]) -> Env {
        Env {
            vars: vars
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
            cwd: PathBuf::from("/work"),
            ..Env::default()
        }
    }

    #[test]
    fn defaults_apply_with_no_flags_or_environment() {
        let config = load(&Flags::default(), &env(&[])).unwrap();
        assert_eq!(config, Config::default());
        assert!(config.interactive());
    }

    #[test]
    fn flags_override_the_environment_and_paths_resolve_from_the_working_directory() {
        let vars = env(&[
            (&env_var("tasks"), "from-env.json"),
            (&env_var("log-file"), "/var/tmp/app.log"),
        ]);
        let config = load(&Flags::default(), &vars).unwrap();
        assert_eq!(
            config.tasks.as_deref(),
            Some(Path::new("/work/from-env.json"))
        );
        assert_eq!(
            config.log_file.as_deref(),
            Some(Path::new("/var/tmp/app.log"))
        );
        let flags = Flags {
            tasks: Some("from-flag.json".into()),
            ..Flags::default()
        };
        let config = load(&flags, &vars).unwrap();
        assert_eq!(
            config.tasks.as_deref(),
            Some(Path::new("/work/from-flag.json"))
        );
    }

    #[test]
    fn printed_output_turns_the_ui_off() {
        let json = Flags {
            json: true,
            ..Flags::default()
        };
        assert!(!load(&json, &env(&[])).unwrap().interactive());
        let no_tui = env(&[(&env_var("no-tui"), "TRUE")]);
        assert!(!load(&Flags::default(), &no_tui).unwrap().interactive());
    }

    #[test]
    fn invalid_values_fail_with_the_setting_named() {
        let name = env_var("no-tui");
        let error = load(&Flags::default(), &env(&[(&name, "sometimes")])).unwrap_err();
        assert_eq!((error.code(), error.exit_code()), ("INVALID_SETTING", 3));
        assert!(error.to_string().contains(&name), "{error}");
        let same = Flags {
            tasks: Some("tasks.json".into()),
            log_file: Some("tasks.json".into()),
            ..Flags::default()
        };
        assert_eq!(
            load(&same, &env(&[])).unwrap_err().code(),
            "INVALID_SETTING"
        );
    }

    #[test]
    fn blank_environment_values_are_ignored() {
        let vars = env(&[(&env_var("tasks"), "  "), (&env_var("no-tui"), "")]);
        assert_eq!(load(&Flags::default(), &vars).unwrap(), Config::default());
    }
}
