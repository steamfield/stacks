package app.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.smallrye.config.ConfigValidationException;
import io.smallrye.config.EnvConfigSource;
import io.smallrye.config.PropertiesConfigSource;
import io.smallrye.config.SmallRyeConfig;
import io.smallrye.config.SmallRyeConfigBuilder;
import io.smallrye.config.validator.BeanValidationConfigValidator;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import java.util.List;
import java.util.Map;
import org.hibernate.validator.messageinterpolation.ParameterMessageInterpolator;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

/** Mapping and validation as SmallRye Config does it at startup, without starting Quarkus. */
class AppConfigTest {

    private static final ValidatorFactory VALIDATION = Validation.byDefaultProvider()
            .configure()
            .messageInterpolator(new ParameterMessageInterpolator())
            .buildValidatorFactory();

    @AfterAll
    static void close() {
        VALIDATION.close();
    }

    private static AppConfig load(Map<String, String> properties, Map<String, String> env) {
        BeanValidationConfigValidator validator = new BeanValidationConfigValidator() {
            @Override
            public Validator getValidator() {
                return VALIDATION.getValidator();
            }
        };
        SmallRyeConfig config = new SmallRyeConfigBuilder()
                .withMapping(AppConfig.class)
                .withSources(new PropertiesConfigSource(properties, "test", 400))
                .withSources(new EnvConfigSource(env, 300))
                .withValidator(validator)
                .build();
        return config.getConfigMapping(AppConfig.class);
    }

    @Test
    void defaultsApplyWhenNothingIsSet() {
        AppConfig config = load(Map.of(), Map.of());
        assertThat(config.defaultPageSize()).isEqualTo(20);
        assertThat(config.maxPageSize()).isEqualTo(100);
    }

    @Test
    void valuesBindFromPropertiesAndTheEnvironment() {
        AppConfig config = load(Map.of("app.default-page-size", "5"), Map.of("APP_MAX_PAGE_SIZE", "50"));
        assertThat(config.defaultPageSize()).isEqualTo(5);
        assertThat(config.maxPageSize()).isEqualTo(50);
    }

    @Test
    void invalidValuesStopStartup() {
        for (Map<String, String> values : List.of(
                Map.of("app.max-page-size", "0"),
                Map.of("app.default-page-size", "1001"),
                Map.of("app.default-page-size", "ten"),
                Map.of("app.default-page-size", "50", "app.max-page-size", "10"))) {
            assertThatThrownBy(() -> load(values, Map.of()))
                    .as(values.toString())
                    .isInstanceOf(ConfigValidationException.class);
        }
    }
}
