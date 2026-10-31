package app;

import app.cli.Action;
import app.cli.RootCommand;
import app.config.Config;
import app.config.ConfigLoader;
import app.config.Env;
import app.errors.CliException;
import app.errors.ErrorCode;
import app.log.Logging;
import app.output.Output;
import java.io.PrintStream;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;
import org.slf4j.LoggerFactory;
import picocli.CommandLine;
import picocli.CommandLine.ParameterException;
import picocli.CommandLine.ParseResult;

/**
 * One invocation: parse, load config, start logging, run the command, and report a failure once.
 * Everything it reads comes in as arguments, so tests call {@link #run} with in-memory streams.
 */
public final class App {

    private final Env env;
    private final PrintStream out;
    private final PrintStream err;
    private Output output;

    private App(String[] args, Env env, PrintStream out, PrintStream err) {
        this.env = env;
        this.out = out;
        this.err = err;
        // Until config is loaded, only an explicit --json selects JSON output and logs are warn and above.
        this.output = new Output(wantsJson(args), false, out, err);
        Logging.start(output.json(), false, err);
    }

    /** Run with these arguments and return the process exit status. */
    public static int run(String[] args, Env env, PrintStream out, PrintStream err) {
        App app = new App(args, env, out, err);
        try {
            app.invoke(args);
            return 0;
        } catch (CliException failure) {
            app.output.error(failure);
            return failure.code().exitCode();
        } catch (RuntimeException bug) {
            // The stack trace goes to the log (stderr); the message can carry user data.
            LoggerFactory.getLogger(App.class).error("unexpected failure", bug);
            CliException failure = new CliException(
                    ErrorCode.INTERNAL, "unexpected " + bug.getClass().getName(), bug);
            app.output.error(failure);
            return failure.code().exitCode();
        }
    }

    private void invoke(String[] args) throws CliException {
        RootCommand root = new RootCommand();
        CommandLine commandLine = new CommandLine(root);
        ParseResult parsed;
        try {
            parsed = commandLine.parseArgs(args);
        } catch (ParameterException e) {
            throw new CliException(ErrorCode.USAGE, firstLine(e.getMessage()), e);
        }
        List<CommandLine> chain = parsed.asCommandLineList();
        // Help and version never read config files, so they work while one is broken.
        for (CommandLine command : chain) {
            if (command.isUsageHelpRequested()) {
                help(command);
                return;
            }
        }
        if (root.versionRequested()) {
            output.result(Map.of("version", AppInfo.version()), AppInfo.NAME + " " + AppInfo.version());
            return;
        }
        if (chain.size() == 1) {
            help(commandLine);
            return;
        }
        CommandLine leaf = chain.getLast();
        if (!(leaf.getCommand() instanceof Action action)) {
            throw new CliException(
                    ErrorCode.USAGE, "'" + leaf.getCommandSpec().qualifiedName() + "' needs a subcommand");
        }
        Config config = ConfigLoader.load(root.flags(), env);
        boolean color = !config.noColor() && env.get("NO_COLOR").isEmpty() && env.terminal();
        output = new Output(config.json(), color, out, err);
        Logging.start(config.json(), config.verbose(), err);
        action.run(config, output);
    }

    private void help(CommandLine command) throws CliException {
        String text = command.getUsageMessage(CommandLine.Help.Ansi.OFF);
        output.result(Map.of("help", text), text.stripTrailing());
    }

    /** picocli's first line says what went wrong; the rest repeats the usage text. */
    private static String firstLine(@Nullable String message) {
        return message == null
                ? "invalid command line"
                : message.lines().findFirst().orElse(message);
    }

    /** Whether --json appears before any {@code --} separator. */
    static boolean wantsJson(String[] args) {
        return Arrays.stream(args).takeWhile(arg -> !arg.equals("--")).anyMatch(arg -> arg.equals("--json"));
    }
}
