//! Typed configuration. Precedence, lowest first: defaults, the home file,
//! the project file (or only `--config`), environment, then flags.

use std::collections::BTreeMap;
use std::io::{self, IsTerminal};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// The binary name. Config paths and the environment prefix derive from it.
pub const BIN: &str = env!("CARGO_PKG_NAME");

/// The environment variable for a setting: `<BIN>_<KEY>`, upper-cased, with
/// hyphens as underscores (`greeting` is `MY_TOOL_GREETING` for `my-tool`).
pub fn env_var(key: &str) -> String {
    format!("{BIN}_{key}").to_uppercase().replace('-', "_")
}

/// The process environment and working directory, captured once in `main`
/// so everything below reads values instead of global state.
#[derive(Debug, Clone, Default)]
pub struct Env {
    pub vars: BTreeMap<String, String>,
    pub cwd: PathBuf,
    pub stderr_is_terminal: bool,
}

impl Env {
    pub fn from_process() -> Self {
        Self {
            // Variables that aren't valid UTF-8 are skipped rather than lossily read.
            vars: std::env::vars_os()
                .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))
                .collect(),
            cwd: std::env::current_dir().unwrap_or_default(),
            stderr_is_terminal: io::stderr().is_terminal(),
        }
    }

    /// A variable's value; unset and empty are the same.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.vars
            .get(name)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub struct Config {
    pub greeting: String,
    pub json: bool,
    pub verbose: bool,
    pub no_color: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            greeting: "Hello, world!".to_owned(),
            json: false,
            verbose: false,
            no_color: false,
        }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.greeting.trim().is_empty() {
            return Err(AppError::InvalidSetting {
                key: "greeting".to_owned(),
                reason: "must contain text".to_owned(),
            });
        }
        Ok(())
    }
}

/// What the parsed flags contribute. A flag that wasn't passed leaves the
/// lower layers alone.
#[derive(Debug, Clone, Default)]
pub struct Flags {
    pub config: Option<PathBuf>,
    pub json: bool,
    pub verbose: bool,
    pub no_color: bool,
}

/// One config file. Every key is optional; unknown keys are an error.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
struct Layer {
    greeting: Option<String>,
    json: Option<bool>,
    verbose: Option<bool>,
    no_color: Option<bool>,
}

impl Layer {
    fn apply(self, config: &mut Config) {
        if let Some(v) = self.greeting {
            config.greeting = v;
        }
        if let Some(v) = self.json {
            config.json = v;
        }
        if let Some(v) = self.verbose {
            config.verbose = v;
        }
        if let Some(v) = self.no_color {
            config.no_color = v;
        }
    }
}

pub fn load(flags: &Flags, env: &Env) -> Result<Config, AppError> {
    let mut config = Config::default();
    if let Some(path) = &flags.config {
        let path = env.cwd.join(path);
        read_layer(&path)?
            .ok_or(AppError::ConfigNotFound { path })?
            .apply(&mut config);
    } else {
        for path in default_files(env) {
            if let Some(layer) = read_layer(&path)? {
                layer.apply(&mut config);
            }
        }
    }
    env_layer(env)?.apply(&mut config);
    config.json |= flags.json;
    config.verbose |= flags.verbose;
    config.no_color |= flags.no_color;
    config.validate()?;
    Ok(config)
}

/// `$XDG_CONFIG_HOME/<BIN>/config.toml` (or `~/.config/...`), then `./<BIN>.toml`.
fn default_files(env: &Env) -> Vec<PathBuf> {
    let home_dir = env
        .get("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env.get("HOME").map(|home| Path::new(home).join(".config")));
    home_dir
        .map(|dir| dir.join(BIN).join("config.toml"))
        .into_iter()
        .chain([env.cwd.join(format!("{BIN}.toml"))])
        .collect()
}

/// A missing file is `None`; an unreadable or invalid one is an error.
fn read_layer(path: &Path) -> Result<Option<Layer>, AppError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(AppError::ConfigRead {
                path: path.to_owned(),
                source,
            });
        }
    };
    toml::from_str(&text)
        .map(Some)
        .map_err(|source| AppError::ConfigParse {
            path: path.to_owned(),
            source: Box::new(source),
        })
}

fn env_layer(env: &Env) -> Result<Layer, AppError> {
    let flag = |key: &str| -> Result<Option<bool>, AppError> {
        let name = env_var(key);
        env.get(&name).map(|v| parse_bool(&name, v)).transpose()
    };
    Ok(Layer {
        greeting: env.get(&env_var("greeting")).map(str::to_owned),
        json: flag("json")?,
        verbose: flag("verbose")?,
        no_color: flag("no-color")?,
    })
}

fn parse_bool(name: &str, value: &str) -> Result<bool, AppError> {
    match value.to_ascii_lowercase().as_str() {
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
    use super::*;

    fn env_in(dir: &Path, vars: &[(&str, &str)]) -> Env {
        let mut vars: BTreeMap<String, String> = vars
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        vars.insert("HOME".to_owned(), dir.join("home").display().to_string());
        Env {
            vars,
            cwd: dir.to_owned(),
            stderr_is_terminal: false,
        }
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn defaults_apply_with_no_files_or_environment() {
        let dir = tempfile::tempdir().unwrap();
        let config = load(&Flags::default(), &env_in(dir.path(), &[])).unwrap();
        assert_eq!(config, Config::default());
    }

    #[test]
    fn each_layer_overrides_the_one_below() {
        let dir = tempfile::tempdir().unwrap();
        let greeting = |env: &Env| load(&Flags::default(), env).unwrap().greeting;
        let env = env_in(dir.path(), &[]);
        assert_eq!(greeting(&env), "Hello, world!");
        write(
            &dir.path()
                .join("home/.config")
                .join(BIN)
                .join("config.toml"),
            "greeting = \"home\"",
        );
        assert_eq!(greeting(&env), "home");
        write(
            &dir.path().join(format!("{BIN}.toml")),
            "greeting = \"project\"",
        );
        assert_eq!(greeting(&env), "project");
        assert_eq!(
            greeting(&env_in(dir.path(), &[(&env_var("greeting"), "env")])),
            "env"
        );
    }

    #[test]
    fn a_flag_overrides_files_and_environment() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join(format!("{BIN}.toml")), "json = false");
        let env = env_in(dir.path(), &[(&env_var("json"), "false")]);
        let flags = Flags {
            json: true,
            ..Flags::default()
        };
        assert!(load(&flags, &env).unwrap().json);
        assert!(!load(&Flags::default(), &env).unwrap().json);
    }

    #[test]
    fn an_explicit_config_replaces_the_default_files_and_must_exist() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join(format!("{BIN}.toml")),
            "greeting = \"project\"",
        );
        write(&dir.path().join("other.toml"), "greeting = \"other\"");
        let env = env_in(dir.path(), &[]);
        let flags = Flags {
            config: Some("other.toml".into()),
            ..Flags::default()
        };
        assert_eq!(load(&flags, &env).unwrap().greeting, "other");
        let missing = Flags {
            config: Some("missing.toml".into()),
            ..Flags::default()
        };
        assert_eq!(load(&missing, &env).unwrap_err().code(), "CONFIG_NOT_FOUND");
    }

    #[test]
    fn invalid_values_fail_with_the_setting_named() {
        let dir = tempfile::tempdir().unwrap();
        let blank = env_in(dir.path(), &[(&env_var("greeting"), "   ")]);
        assert_eq!(
            load(&Flags::default(), &blank).unwrap_err().code(),
            "INVALID_SETTING"
        );
        let json = env_var("json");
        let bad_bool = env_in(dir.path(), &[(&json, "yes please")]);
        let error = load(&Flags::default(), &bad_bool).unwrap_err();
        assert!(error.to_string().contains(&json), "{error}");
        write(
            &dir.path().join(format!("{BIN}.toml")),
            "greting = \"typo\"",
        );
        let typo = load(&Flags::default(), &env_in(dir.path(), &[])).unwrap_err();
        assert_eq!((typo.code(), typo.exit_code()), ("CONFIG", 3));
    }

    #[test]
    fn empty_environment_values_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let env = env_in(
            dir.path(),
            &[(&env_var("greeting"), ""), (&env_var("json"), "")],
        );
        assert_eq!(load(&Flags::default(), &env).unwrap(), Config::default());
    }
}
