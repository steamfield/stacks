//! One invocation: parse, load config, start logging, load the tasks, then
//! either run the full-screen UI or print. A failure is reported once.
//! Everything it reads comes in as arguments, so tests call it with buffers.

use std::ffi::OsString;
use std::io::Write;

use clap::Parser;
use clap::error::ErrorKind;

use crate::app::App;
use crate::cli::Cli;
use crate::config::{self, BIN, Env};
use crate::error::AppError;
use crate::output::Output;
use crate::{logging, tasks, tui};

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Run with these arguments and return the process exit status.
pub fn run(
    args: impl IntoIterator<Item = OsString>,
    env: &Env,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> u8 {
    let args: Vec<OsString> = args.into_iter().collect();
    // Errors honor --json even when parsing fails.
    let output = Output {
        json: wants_json(&args),
    };
    match invoke(&args, env, output, stdout) {
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
    output: Output,
    stdout: &mut dyn Write,
) -> Result<(), AppError> {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(e) if e.kind() == ErrorKind::DisplayHelp => {
            let text = e.render().to_string();
            return output.result(
                stdout,
                &serde_json::json!({ "help": text }),
                text.trim_end(),
            );
        }
        Err(e) => return Err(usage_error(&e)),
    };
    if cli.version {
        let human = format!("{BIN} {VERSION}");
        return output.result(stdout, &serde_json::json!({ "version": VERSION }), &human);
    }
    let config = config::load(&cli.flags(), env)?;
    let _logs = logging::init(&config, env)?;
    let tasks = tasks::load(config.tasks.as_deref())?;
    // Without a terminal on both ends the UI would wait for keys nobody sends
    // (crossterm reads /dev/tty when stdin is a pipe). Print instead.
    if config.interactive() && env.stdin_is_terminal && env.stdout_is_terminal {
        tracing::info!(mode = "tui", tasks = tasks.len(), "start");
        return tui::run(&mut App::new(tasks));
    }
    tracing::info!(
        mode = "print",
        json = config.json,
        tasks = tasks.len(),
        "start"
    );
    output.tasks(stdout, &tasks)
}

fn usage_error(e: &clap::Error) -> AppError {
    // clap's first line is "error: <what went wrong>"; the rest is usage text.
    let rendered = e.to_string();
    let first = rendered.lines().next().unwrap_or_default();
    AppError::Usage {
        message: first.strip_prefix("error: ").unwrap_or(first).to_owned(),
    }
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

    fn run_with(args: &[&str], env: &Env) -> Run {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let command_line = std::iter::once(BIN)
            .chain(args.iter().copied())
            .map(OsString::from);
        let code = run(command_line, env, &mut out, &mut err);
        Run {
            code,
            stdout: String::from_utf8(out).unwrap(),
            stderr: String::from_utf8(err).unwrap(),
        }
    }

    #[test]
    fn without_a_terminal_the_tasks_print_as_text() {
        let run = run_with(&[], &Env::default());
        assert_eq!((run.code, run.stderr.as_str()), (0, ""));
        assert!(
            run.stdout.starts_with("ID   STATUS  TITLE\n"),
            "{}",
            run.stdout
        );
    }

    #[test]
    fn a_terminal_on_one_end_only_still_prints() {
        for (stdin_is_terminal, stdout_is_terminal) in [(true, false), (false, true)] {
            let env = Env {
                stdin_is_terminal,
                stdout_is_terminal,
                ..Env::default()
            };
            let run = run_with(&["--json"], &env);
            assert_eq!(run.code, 0);
            let document: serde_json::Value = serde_json::from_str(&run.stdout).unwrap();
            assert_eq!(document["tasks"].as_array().map(Vec::len), Some(3));
        }
    }

    #[test]
    fn an_unknown_flag_is_a_usage_error_with_one_report() {
        let run = run_with(&["--json", "--frobnicate"], &Env::default());
        assert_eq!((run.code, run.stdout.as_str()), (2, ""));
        let document: serde_json::Value = serde_json::from_str(&run.stderr).unwrap();
        assert_eq!(document["error"]["code"], "USAGE");
        assert!(
            document["error"]["message"]
                .as_str()
                .unwrap()
                .contains("--frobnicate")
        );
    }

    #[test]
    fn help_and_version_honor_json() {
        let help: serde_json::Value =
            serde_json::from_str(&run_with(&["--json", "--help"], &Env::default()).stdout).unwrap();
        assert!(help["help"].as_str().unwrap().contains("Usage:"));
        let version = run_with(&["--json", "--version"], &Env::default());
        let document: serde_json::Value = serde_json::from_str(&version.stdout).unwrap();
        assert_eq!(document["version"], VERSION);
    }

    #[test]
    fn json_after_the_separator_is_an_argument_not_the_flag() {
        assert!(!wants_json(&["x", "--", "--json"].map(OsString::from)));
        assert!(wants_json(&["x", "--json"].map(OsString::from)));
    }
}
