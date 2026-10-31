package app;

import io.quarkus.runtime.Quarkus;
import io.quarkus.runtime.annotations.QuarkusMain;

/** The process entry point: serves the API, or runs the health probe with {@code --healthcheck}. */
@QuarkusMain
public final class Main {

    private Main() {}

    public static void main(String... args) {
        if (args.length == 1 && HealthProbe.FLAG.equals(args[0])) {
            System.exit(HealthProbe.run(System.getenv()));
        }
        Quarkus.run(args);
    }
}
