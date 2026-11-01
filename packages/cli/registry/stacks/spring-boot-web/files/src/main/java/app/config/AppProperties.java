package app.config;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * The application's own settings, bound from {@code app.*} (env {@code APP_*}) and validated at
 * startup: an invalid value stops the server before it listens. Server settings (host, port,
 * shutdown, the session cookie) are Spring's own, mapped in {@code application.yaml}.
 *
 * @param pageSize how many of the newest notes the home page lists
 */
@ConfigurationProperties("app")
@Validated
public record AppProperties(
        @DefaultValue("50") @Min(1) @Max(500) int pageSize) {}
