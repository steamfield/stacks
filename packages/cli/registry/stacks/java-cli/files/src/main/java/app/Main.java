package app;

import app.config.Env;
import java.nio.file.Path;

/**
 * The process boundary: the only class that reads the environment, the working directory and the
 * standard streams, and the only one that calls {@code System.exit}.
 */
public final class Main {

    private Main() {}

    public static void main(String[] args) {
        Env env = new Env(System.getenv(), Path.of("").toAbsolutePath(), terminal());
        System.exit(App.run(args, env, System.out, System.err));
    }

    // Since JDK 22 System.console() is never null, but NullAway's JDK model still says it can be.
    @SuppressWarnings("SystemConsoleNull")
    private static boolean terminal() {
        var console = System.console();
        return console != null && console.isTerminal();
    }
}
