//! Typed configuration from environment variables, validated at startup.
//! Empty values use the default; the server never reads `.env` files.

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use tracing_subscriber::EnvFilter;

use crate::error::StartError;

/// The process environment, captured once in `main` so everything below
/// reads values instead of global state.
#[derive(Debug, Clone, Default)]
pub struct Env {
    pub vars: BTreeMap<String, String>,
}

impl Env {
    pub fn from_process() -> Self {
        Self {
            // Variables that aren't valid UTF-8 are skipped rather than lossily read.
            vars: std::env::vars_os()
                .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))
                .collect(),
        }
    }

    /// A variable's value; unset and empty are the same.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.vars
            .get(name)
            .map(String::as_str)
            .filter(|v| !v.trim().is_empty())
    }
}

impl<const N: usize> From<[(&str, &str); N]> for Env {
    fn from(vars: [(&str, &str); N]) -> Self {
        Self {
            vars: vars
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// `HOST`: the address to bind. A container sets `0.0.0.0`.
    pub host: IpAddr,
    /// `PORT`: 0 lets the OS choose; the `listening` log record has the real one.
    pub port: u16,
    /// `RUST_LOG`: a tracing filter such as `info` or `api=debug,tower_http=info`.
    pub log_filter: String,
    /// `REQUEST_TIMEOUT_SECS`: a request still running after this gets 503.
    pub request_timeout: Duration,
    /// `SHUTDOWN_TIMEOUT_SECS`: how long a signal waits for requests in flight.
    pub shutdown_timeout: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 8080,
            log_filter: "info".to_owned(),
            request_timeout: Duration::from_secs(10),
            shutdown_timeout: Duration::from_secs(10),
        }
    }
}

impl Config {
    pub fn load(env: &Env) -> Result<Self, StartError> {
        let defaults = Self::default();
        let config = Self {
            host: parse(env, "HOST", defaults.host, "an IPv4 or IPv6 address")?,
            port: parse(env, "PORT", defaults.port, "an integer from 0 to 65535")?,
            log_filter: env
                .get("RUST_LOG")
                .map_or(defaults.log_filter, str::to_owned),
            request_timeout: seconds(env, "REQUEST_TIMEOUT_SECS", defaults.request_timeout)?,
            shutdown_timeout: seconds(env, "SHUTDOWN_TIMEOUT_SECS", defaults.shutdown_timeout)?,
        };
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), StartError> {
        EnvFilter::try_new(&self.log_filter).map_err(|e| StartError::InvalidSetting {
            name: "RUST_LOG",
            reason: e.to_string(),
        })?;
        Ok(())
    }

    pub fn addr(&self) -> SocketAddr {
        SocketAddr::new(self.host, self.port)
    }
}

fn parse<T: std::str::FromStr>(
    env: &Env,
    name: &'static str,
    default: T,
    expected: &str,
) -> Result<T, StartError> {
    match env.get(name) {
        None => Ok(default),
        Some(value) => value
            .trim()
            .parse()
            .map_err(|_| StartError::InvalidSetting {
                name,
                reason: format!("expected {expected}, got {value:?}"),
            }),
    }
}

fn seconds(env: &Env, name: &'static str, default: Duration) -> Result<Duration, StartError> {
    let secs: u64 = parse(
        env,
        name,
        default.as_secs(),
        "a whole number of seconds from 1 to 3600",
    )?;
    if !(1..=3600).contains(&secs) {
        return Err(StartError::InvalidSetting {
            name,
            reason: format!("expected a whole number of seconds from 1 to 3600, got {secs}"),
        });
    }
    Ok(Duration::from_secs(secs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_apply_when_unset_or_empty() {
        assert_eq!(Config::load(&Env::default()).unwrap(), Config::default());
        let empty = Env::from([("PORT", ""), ("HOST", "  ")]);
        assert_eq!(Config::load(&empty).unwrap(), Config::default());
        assert_eq!(Config::default().addr().to_string(), "127.0.0.1:8080");
    }

    #[test]
    fn each_setting_is_read_from_its_variable() {
        let env = Env::from([
            ("HOST", "0.0.0.0"),
            ("PORT", "0"),
            ("RUST_LOG", "debug"),
            ("REQUEST_TIMEOUT_SECS", "2"),
            ("SHUTDOWN_TIMEOUT_SECS", "30"),
        ]);
        let config = Config::load(&env).unwrap();
        assert_eq!(config.addr().to_string(), "0.0.0.0:0");
        assert_eq!(config.log_filter, "debug");
        assert_eq!(config.request_timeout, Duration::from_secs(2));
        assert_eq!(config.shutdown_timeout, Duration::from_secs(30));
    }

    #[test]
    fn invalid_values_fail_with_the_variable_named() {
        for (name, value) in [
            ("HOST", "localhost"),
            ("PORT", "65536"),
            ("PORT", "eighty"),
            ("RUST_LOG", "debug,=["),
            ("REQUEST_TIMEOUT_SECS", "0"),
            ("SHUTDOWN_TIMEOUT_SECS", "1.5"),
        ] {
            let error = Config::load(&Env::from([(name, value)])).unwrap_err();
            assert_eq!((error.code(), error.exit_code()), ("INVALID_SETTING", 3));
            assert!(error.to_string().contains(name), "{name}: {error}");
        }
    }
}
