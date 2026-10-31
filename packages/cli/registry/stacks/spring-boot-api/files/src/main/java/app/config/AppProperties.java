package app.config;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * The application's own settings, bound from {@code app.*} (env {@code APP_*}) and validated at
 * startup: an invalid value stops the server before it listens. Server settings (host, port,
 * shutdown) are Spring's own, mapped in {@code application.yaml}.
 *
 * @param defaultPageSize page size when a list request names no {@code limit}
 * @param maxPageSize the largest {@code limit} a list request may ask for
 */
@ConfigurationProperties("app")
@Validated
public record AppProperties(
        @DefaultValue("20") @Min(1) @Max(1000) int defaultPageSize,
        @DefaultValue("100") @Min(1) @Max(1000) int maxPageSize) {

    /** The default page must fit inside the maximum. */
    @AssertTrue(message = "app.default-page-size must not exceed app.max-page-size")
    public boolean isDefaultPageSizeWithinMax() {
        return defaultPageSize <= maxPageSize;
    }
}
