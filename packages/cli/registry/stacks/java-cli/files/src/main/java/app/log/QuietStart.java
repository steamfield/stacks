package app.log;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.Configurator;
import ch.qos.logback.classic.spi.ConfiguratorRank;
import ch.qos.logback.core.spi.ContextAwareBase;

/**
 * Logback's configuration until {@link Logging#start} runs: nothing is logged anywhere. Without it
 * Logback's fallback writes debug lines to stdout, which belongs to results. Registered in
 * {@code META-INF/services/ch.qos.logback.classic.spi.Configurator}, so no logback.xml is parsed at
 * startup.
 */
@ConfiguratorRank(ConfiguratorRank.CUSTOM_HIGH_PRIORITY)
public final class QuietStart extends ContextAwareBase implements Configurator {

    @Override
    public ExecutionStatus configure(LoggerContext context) {
        context.getLogger(Logger.ROOT_LOGGER_NAME).setLevel(Level.OFF);
        return ExecutionStatus.DO_NOT_INVOKE_NEXT_IF_ANY;
    }
}
