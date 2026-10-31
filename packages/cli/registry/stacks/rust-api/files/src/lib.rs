//! The HTTP service as a library, so tests drive the real router in process.
//! `main.rs` reads the process and calls [`run`]; nothing here reads global
//! state except [`config::Env::from_process`].

pub mod app;
pub mod config;
pub mod error;
pub mod extract;
pub mod logging;
pub mod notes;
pub mod probe;
pub mod routes;
pub mod server;

use std::io::Write;

use crate::config::Env;
use crate::error::StartError;

/// Run the binary with these arguments (without the program name) and
/// return the process exit status. No arguments serves; `--healthcheck`
/// probes a running server.
pub fn run(args: &[String], env: &Env, stderr: &mut dyn Write) -> u8 {
    let outcome = match args {
        [] => serve(env),
        [flag] if flag == "--healthcheck" => probe::healthcheck(env),
        _ => Err(StartError::Usage {
            args: args.join(" "),
        }),
    };
    match outcome {
        Ok(()) => 0,
        Err(failure) => {
            // Report once: as a log record when logging started, otherwise
            // (a usage error, a bad setting) as one plain line on stderr.
            if tracing::dispatcher::has_been_set() {
                tracing::error!(code = failure.code(), error = %failure, "exiting");
            } else {
                drop(writeln!(stderr, "error[{}]: {failure}", failure.code()));
            }
            failure.exit_code()
        }
    }
}

fn serve(env: &Env) -> Result<(), StartError> {
    let config = config::Config::load(env)?;
    logging::init(&config.log_filter)?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(StartError::Runtime)?
        .block_on(server::run(config, server::shutdown_signal()))
}
