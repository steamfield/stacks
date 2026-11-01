package app.log;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.encoder.JsonEncoder;
import ch.qos.logback.classic.encoder.PatternLayoutEncoder;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.OutputStreamAppender;
import ch.qos.logback.core.encoder.Encoder;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import org.slf4j.LoggerFactory;

/**
 * Logs for one invocation: stderr only, {@code warn} and above, {@code debug} with --verbose, and
 * one JSON object per line under --json. The rest of the code logs through SLF4J and never touches
 * Logback.
 */
public final class Logging {

    private Logging() {}

    public static void start(boolean json, boolean verbose, OutputStream stderr) {
        LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
        context.reset();

        Encoder<ILoggingEvent> encoder;
        if (json) {
            encoder = new JsonEncoder();
        } else {
            PatternLayoutEncoder pattern = new PatternLayoutEncoder();
            pattern.setPattern("%level %logger{0}: %msg %kvp%n");
            encoder = pattern;
        }
        encoder.setContext(context);
        encoder.start();

        OutputStreamAppender<ILoggingEvent> appender = new OutputStreamAppender<>();
        appender.setContext(context);
        appender.setName("stderr");
        appender.setEncoder(encoder);
        appender.setImmediateFlush(true);
        appender.setOutputStream(new KeepOpen(stderr));
        appender.start();

        Logger root = context.getLogger(Logger.ROOT_LOGGER_NAME);
        root.setLevel(verbose ? Level.DEBUG : Level.WARN);
        root.addAppender(appender);
    }

    /** Stopping an appender closes its stream; the process's stderr has to outlive a reset. */
    private static final class KeepOpen extends FilterOutputStream {

        KeepOpen(OutputStream out) {
            super(out);
        }

        @Override
        public void write(byte[] bytes, int offset, int length) throws IOException {
            out.write(bytes, offset, length);
        }

        @Override
        public void close() throws IOException {
            flush();
        }
    }
}
