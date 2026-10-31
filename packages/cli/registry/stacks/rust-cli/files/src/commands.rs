//! One module per command under `commands/`. A command receives the typed
//! config and the output, returns `Result<(), AppError>` and writes its result
//! once through `Output::result`.

pub mod config;
