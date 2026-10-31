package app.cli;

import app.AppInfo;
import app.config.Flags;
import java.nio.file.Path;
import org.jspecify.annotations.Nullable;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;
import picocli.CommandLine.ScopeType;

/**
 * The root command and the global options. Options with {@code scope = INHERIT} are accepted after
 * any subcommand too ({@code config show --json}).
 */
@Command(
        name = AppInfo.NAME,
        description = "A command-line tool with typed configuration.",
        subcommands = {ConfigCommand.class},
        usageHelpAutoWidth = true)
public final class RootCommand {

    @Option(
            names = "--config",
            paramLabel = "PATH",
            scope = ScopeType.INHERIT,
            description = "TOML config file (replaces the default file search).")
    @Nullable
    Path config;

    @Option(names = "--json", scope = ScopeType.INHERIT, description = "Write JSON output.")
    boolean json;

    @Option(
            names = {"-v", "--verbose"},
            scope = ScopeType.INHERIT,
            description = "Log debug detail to stderr.")
    boolean verbose;

    @Option(names = "--no-color", scope = ScopeType.INHERIT, description = "Disable color.")
    boolean noColor;

    @Option(
            names = {"-h", "--help"},
            usageHelp = true,
            scope = ScopeType.INHERIT,
            description = "Show this help and exit.")
    boolean help;

    // Not picocli's versionHelp, so the version honors --json.
    @Option(names = "--version", description = "Show the version and exit.")
    boolean version;

    public Flags flags() {
        return new Flags(config, json, verbose, noColor);
    }

    public boolean versionRequested() {
        return version;
    }
}
