//! The command-line surface. clap parses; nothing here reads the environment
//! or does work.

use std::path::PathBuf;

use clap::Parser;

use crate::config::{BIN, Flags};

#[derive(Debug, Parser)]
#[command(
    name = BIN,
    about = "A full-screen task list that prints text or JSON without a terminal",
    // The shipped --version honors --json, which clap's built-in flag can't.
    disable_version_flag = true
)]
pub struct Cli {
    /// JSON array of tasks to show (default: a built-in sample)
    #[arg(long, value_name = "FILE")]
    pub tasks: Option<PathBuf>,
    /// Append JSON log records to this file (default: no logs)
    #[arg(long, value_name = "FILE")]
    pub log_file: Option<PathBuf>,
    /// Print the tasks as text and exit, even on a terminal
    #[arg(long)]
    pub no_tui: bool,
    /// Print the tasks, the version or an error as JSON
    #[arg(long)]
    pub json: bool,
    /// Show version information
    #[arg(long)]
    pub version: bool,
}

impl Cli {
    pub fn flags(&self) -> Flags {
        Flags {
            tasks: self.tasks.clone(),
            log_file: self.log_file.clone(),
            no_tui: self.no_tui,
            json: self.json,
        }
    }
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;

    use super::*;

    #[test]
    fn the_command_definition_is_consistent() {
        Cli::command().debug_assert();
    }

    #[test]
    fn flags_carry_what_was_parsed() {
        let cli = Cli::try_parse_from([BIN, "--tasks", "t.json", "--no-tui"]).unwrap();
        let flags = cli.flags();
        assert_eq!(flags.tasks, Some(PathBuf::from("t.json")));
        assert!(flags.no_tui && !flags.json);
    }
}
