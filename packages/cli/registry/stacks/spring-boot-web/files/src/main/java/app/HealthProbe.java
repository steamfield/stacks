package app;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * {@code java -jar app.jar --healthcheck}: one GET of the health endpoint, exit 0 on 200 and 1
 * otherwise. It needs no shell or curl, so it works as a slim container's HEALTHCHECK.
 */
public final class HealthProbe {

    public static final String FLAG = "--healthcheck";
    static final Duration TIMEOUT = Duration.ofSeconds(2);

    private HealthProbe() {}

    /** Probes the server that {@code HOST} and {@code PORT} in {@code env} describe. */
    static int run(Map<String, String> env) {
        return check(target(env));
    }

    /** The health URI for these settings; a wildcard host is probed on loopback. */
    static URI target(Map<String, String> env) {
        String host = setting(env, "HOST", "127.0.0.1");
        if (host.equals("0.0.0.0")) {
            host = "127.0.0.1";
        } else if (host.equals("::")) {
            host = "::1";
        }
        if (host.contains(":")) {
            host = "[" + host + "]";
        }
        return URI.create("http://" + host + ":" + setting(env, "PORT", "8080") + "/actuator/health");
    }

    /** 0 when {@code uri} answers 200 within the timeout, else 1. */
    static int check(URI uri) {
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(TIMEOUT).GET().build();
        try (HttpClient client = HttpClient.newBuilder().connectTimeout(TIMEOUT).build()) {
            int status =
                    client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            return status == 200 ? 0 : 1;
        } catch (IOException e) {
            return 1;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return 1;
        }
    }

    private static String setting(Map<String, String> env, String name, String fallback) {
        String value = env.get(name);
        return value == null || value.isBlank() ? fallback : value.strip();
    }
}
