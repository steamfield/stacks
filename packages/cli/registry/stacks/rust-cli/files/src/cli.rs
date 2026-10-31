//! The command-line surface. clap parses; nothing here reads config or does work.

use std::path::PathBuf;

use clap::{Parser, Subcommand};

use crate::config::{BIN, Flags};

#[derive(Debug, Parser)]
#[command(
    name = BIN,
    about = "A command-line tool with typed configuration",
    // The shipped --version honors --json, which clap's built-in flag can't.
    disable_version_flag = true
)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "each global flag is an independent switch that clap fills"
)]
pub struct Cli {
    /// TOML config file (replaces the default file search)
    #[arg(long, global = true, value_name = "PATH")]
    pub config: Option<PathBuf>,
    /// Write JSON output
    #[arg(long, global = true)]
    pub json: bool,
    /// Enable debug logging
    #[arg(short, long, global = true)]
    pub verbose: bool,
    /// Disable color
    #[arg(long, global = true)]
    pub no_color: bool,
    /// Show version information
    #[arg(long)]
    pub version: bool,
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Inspect configuration
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum ConfigCommand {
    /// Print the effective configuration
    Show,
}

impl Cli {
    pub fn flags(&self) -> Flags {
        Flags {
            config: self.config.clone(),
            json: self.json,
            verbose: self.verbose,
            no_color: self.no_color,
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
    fn global_flags_parse_after_the_subcommand() {
        let cli = Cli::try_parse_from([BIN, "config", "show", "--json", "-v"]).unwrap();
        assert!(cli.json && cli.verbose);
        assert!(matches!(
            cli.command,
            Some(Command::Config {
                command: ConfigCommand::Show
            })
        ));
    }
}
