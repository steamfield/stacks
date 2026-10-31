package app.cli;

import app.config.Config;
import app.errors.CliException;
import app.output.Output;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import picocli.CommandLine.Command;

/** {@code config show}: the effective configuration, as {@code key = value} lines or JSON. */
@Command(name = "show", description = "Print the effective configuration.")
public final class ConfigShowCommand implements Action {

    private static final Logger LOG = LoggerFactory.getLogger(ConfigShowCommand.class);

    @Override
    public void run(Config config, Output output) throws CliException {
        LOG.atDebug().addKeyValue("greeting", config.greeting()).log("showing effective configuration");
        String human = String.join(
                "\n",
                "greeting = \"" + config.greeting() + "\"",
                "json = " + config.json(),
                "verbose = " + config.verbose(),
                "no-color = " + config.noColor());
        output.result(config, human);
    }
}
