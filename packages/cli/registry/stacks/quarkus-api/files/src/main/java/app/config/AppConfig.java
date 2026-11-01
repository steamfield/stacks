package app.config;

import io.smallrye.config.ConfigMapping;
import io.smallrye.config.WithDefault;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * The application's own settings, mapped from {@code app.*} (env {@code APP_*}) and validated at
 * startup: an invalid value stops the server before it listens. Server settings (host, port,
 * shutdown) are Quarkus's own, mapped in {@code application.properties}.
 */
@ConfigMapping(prefix = "app")
public interface AppConfig {

    /** Page size when a list request names no {@code limit}. */
    @WithDefault("20")
    @Min(1)
    @Max(1000)
    int defaultPageSize();

    /** The largest {@code limit} a list request may ask for. */
    @WithDefault("100")
    @Min(1)
    @Max(1000)
    int maxPageSize();

    /** The default page must fit inside the maximum. */
    @AssertTrue(message = "app.default-page-size must not exceed app.max-page-size")
    default boolean isDefaultPageSizeWithinMax() {
        return defaultPageSize() <= maxPageSize();
    }
}
