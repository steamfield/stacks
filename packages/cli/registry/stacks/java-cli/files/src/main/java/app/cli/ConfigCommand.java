package app.cli;

import picocli.CommandLine.Command;

/** {@code config}: a group, so it needs a subcommand. */
@Command(
        name = "config",
        description = "Inspect configuration.",
        subcommands = {ConfigShowCommand.class})
public final class ConfigCommand {}
