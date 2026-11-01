package app.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.validation.autoconfigure.ValidationAutoConfiguration;
import org.springframework.context.annotation.Configuration;

/** Binding and validation as the application does it at startup. */
class AppPropertiesTest {

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(AppProperties.class)
    static class Settings {}

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(ValidationAutoConfiguration.class))
            .withUserConfiguration(Settings.class);

    @Test
    void defaultsApplyWhenNothingIsSet() {
        runner.run(context -> assertThat(context.getBean(AppProperties.class)).isEqualTo(new AppProperties(50)));
    }

    @Test
    void valuesBindFromRelaxedNames() {
        runner.withPropertyValues("app.page-size=5")
                .run(context -> assertThat(context.getBean(AppProperties.class)).isEqualTo(new AppProperties(5)));
    }

    @Test
    void invalidValuesStopStartup() {
        for (String value : new String[] {"0", "501", "ten"}) {
            runner.withPropertyValues("app.page-size=" + value)
                    .run(context -> assertThat(context).hasFailed());
        }
    }
}
