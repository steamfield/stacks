//! JSON log records on stderr, one per line, filtered by `RUST_LOG`.

use tracing_subscriber::EnvFilter;

use crate::error::StartError;

/// Install the process-wide subscriber. Called once, from `run`, after the
/// config (and so the filter) is validated.
pub fn init(filter: &str) -> Result<(), StartError> {
    let filter = EnvFilter::try_new(filter).map_err(|e| StartError::Logging(e.to_string()))?;
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .with_current_span(true)
        .with_span_list(false)
        .try_init()
        .map_err(|e| StartError::Logging(e.to_string()))
}
