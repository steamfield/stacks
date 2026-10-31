package app.cli;

import app.config.Config;
import app.errors.CliException;
import app.output.Output;

/**
 * A command that does work. picocli fills its options and parameters; {@code App} calls {@link
 * #run} with the loaded config once parsing succeeded. A command group (like {@code config}) isn't
 * an action, so running it without a subcommand is a usage error.
 */
public interface Action {

    void run(Config config, Output output) throws CliException;
}
