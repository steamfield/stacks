//! Process boundary: reads the real arguments and environment, hands them to
//! `api::run` and turns its result into the exit status.

use std::io;
use std::process::ExitCode;

fn main() -> ExitCode {
    let env = api::config::Env::from_process();
    let args: Vec<String> = std::env::args().skip(1).collect();
    // Not `stderr().lock()`: the lock would be held while serving, and every
    // worker thread's log write would wait on it forever.
    ExitCode::from(api::run(&args, &env, &mut io::stderr()))
}
