//! Process boundary: reads the real arguments, environment and streams, then
//! hands everything to `app::run` and turns its result into the exit status.

mod app;
mod cli;
mod commands;
mod config;
mod error;
mod logging;
mod output;

use std::io;
use std::process::ExitCode;

fn main() -> ExitCode {
    let env = config::Env::from_process();
    let code = app::run(
        std::env::args_os(),
        &env,
        &mut io::stdout().lock(),
        &mut io::stderr().lock(),
    );
    ExitCode::from(code)
}
