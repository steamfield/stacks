package app;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/** The process entry point: serves the web app, or runs the health probe with {@code --healthcheck}. */
@SpringBootApplication
@ConfigurationPropertiesScan
public class Application {

    public static void main(String[] args) {
        if (args.length == 1 && HealthProbe.FLAG.equals(args[0])) {
            System.exit(HealthProbe.run(System.getenv()));
        }
        SpringApplication.run(Application.class, args);
    }
}
