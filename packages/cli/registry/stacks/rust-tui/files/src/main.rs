//! Process boundary: reads the real arguments, environment and terminal
//! facts, hands them to `run::run`, and turns its result into the exit status.

mod app;
mod cli;
mod config;
mod error;
mod keys;
mod logging;
mod output;
mod run;
mod tasks;
mod tui;
mod ui;

use std::io;
use std::process::ExitCode;

fn main() -> ExitCode {
    let env = config::Env::from_process();
    let code = run::run(
        std::env::args_os(),
        &env,
        &mut io::stdout(),
        &mut io::stderr(),
    );
    ExitCode::from(code)
}
