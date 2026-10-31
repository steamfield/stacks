package app.config;

import java.nio.file.Path;
import org.jspecify.annotations.Nullable;

/**
 * What the parsed command line contributes to the config. A flag that wasn't passed leaves the
 * lower layers alone.
 *
 * @param config an explicit config file, which replaces the default file search
 */
public record Flags(@Nullable Path config, boolean json, boolean verbose, boolean noColor) {

    public static final Flags NONE = new Flags(null, false, false, false);
}
