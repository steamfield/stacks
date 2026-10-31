//! One invocation: parse, load config, start logging, dispatch, and report a
//! failure once. Everything it reads comes in as arguments, so tests call it
//! with buffers instead of spawning the binary.

use std::ffi::OsString;
use std::io::Write;

use clap::error::ErrorKind;
use clap::{CommandFactory, Parser};

use crate::cli::{Cli, Command, ConfigCommand};
use crate::commands;
use crate::config::{self, BIN, Env};
use crate::error::AppError;
use crate::output::Output;

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Run with these arguments and return the process exit status.
pub fn run(
    args: impl IntoIterator<Item = OsString>,
    env: &Env,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> u8 {
    let args: Vec<OsString> = args.into_iter().collect();
    // Until config is loaded, only an explicit --json selects JSON output.
    let mut output = Output {
        json: wants_json(&args),
        color: false,
    };
    match invoke(&args, env, &mut output, stdout) {
        Ok(()) => 0,
        Err(failure) => {
            output.error(stderr, &failure);
            failure.exit_code()
        }
    }
}

fn invoke(
    args: &[OsString],
    env: &Env,
    output: &mut Output,
    stdout: &mut dyn Write,
) -> Result<(), AppError> {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(e) if e.kind() == ErrorKind::DisplayHelp => {
            return help(*output, stdout, &e.render().to_string());
        }
        Err(e) => return Err(usage_error(&e)),
    };
    // Help and version never read config files, so they work when one is broken.
    if cli.version {
        let human = format!("{BIN} {VERSION}");
        return output.result(stdout, &serde_json::json!({ "version": VERSION }), &human);
    }
    let Some(command) = &cli.command else {
        return help(*output, stdout, &Cli::command().render_help().to_string());
    };
    let config = config::load(&cli.flags(), env)?;
    *output = Output {
        json: config.json,
        color: !config.no_color && env.get("NO_COLOR").is_none() && env.stderr_is_terminal,
    };
    let _logs = crate::logging::init(&config, env)?;
    match command {
        Command::Config {
            command: ConfigCommand::Show,
        } => commands::config::show(&config, *output, stdout),
    }
}

fn help(output: Output, stdout: &mut dyn Write, text: &str) -> Result<(), AppError> {
    output.result(
        stdout,
        &serde_json::json!({ "help": text }),
        text.trim_end(),
    )
}

fn usage_error(e: &clap::Error) -> AppError {
    let message = if e.kind() == ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand {
        "a subcommand is required".to_owned()
    } else {
        // clap's first line is "error: <what went wrong>"; the rest is usage text.
        let rendered = e.to_string();
        let first = rendered.lines().next().unwrap_or_default();
        first.strip_prefix("error: ").unwrap_or(first).to_owned()
    };
    AppError::Usage { message }
}

fn wants_json(args: &[OsString]) -> bool {
    args.iter()
        .skip(1)
        .take_while(|a| *a != "--")
        .any(|a| a == "--json")
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Run {
        code: u8,
        stdout: String,
        stderr: String,
    }

    fn run_with(args: &[&str]) -> Run {
        let dir = tempfile::tempdir().unwrap();
        let env = Env {
            vars: [("HOME".to_owned(), dir.path().display().to_string())].into(),
            cwd: dir.path().to_owned(),
            stderr_is_terminal: false,
        };
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let command_line = std::iter::once(BIN)
            .chain(args.iter().copied())
            .map(OsString::from);
        let code = run(command_line, &env, &mut out, &mut err);
        Run {
            code,
            stdout: String::from_utf8(out).unwrap(),
            stderr: String::from_utf8(err).unwrap(),
        }
    }

    #[test]
    fn config_show_prints_the_default_greeting() {
        let run = run_with(&["config", "show"]);
        assert_eq!((run.code, run.stderr.as_str()), (0, ""));
        assert!(run.stdout.contains("greeting = \"Hello, world!\""));
    }

    #[test]
    fn an_unknown_subcommand_is_a_usage_error_with_one_report() {
        let run = run_with(&["--json", "frobnicate"]);
        assert_eq!((run.code, run.stdout.as_str()), (2, ""));
        let document: serde_json::Value = serde_json::from_str(&run.stderr).unwrap();
        assert_eq!(document["error"]["code"], "USAGE");
        assert!(
            document["error"]["message"]
                .as_str()
                .unwrap()
                .contains("frobnicate")
        );
    }

    #[test]
    fn a_group_without_its_subcommand_is_a_usage_error() {
        let run = run_with(&["config"]);
        assert_eq!(run.code, 2);
        assert!(
            run.stderr
                .starts_with("error[USAGE]: a subcommand is required")
        );
    }

    #[test]
    fn help_and_version_honor_json() {
        let help: serde_json::Value =
            serde_json::from_str(&run_with(&["--json", "--help"]).stdout).unwrap();
        assert!(help["help"].as_str().unwrap().contains("Usage:"));
        let version = run_with(&["--json", "--version"]);
        assert_eq!(version.stdout, format!("{{\"version\":\"{VERSION}\"}}\n"));
    }

    #[test]
    fn json_after_the_separator_is_an_argument_not_the_flag() {
        let args = ["x", "--", "--json"].map(OsString::from);
        assert!(!wants_json(&args));
        assert!(wants_json(&["x", "--json"].map(OsString::from)));
    }
}
