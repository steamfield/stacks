package app.config;

import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;

/**
 * The process environment and working directory, captured once by {@code Main} so everything below
 * it reads values instead of global state, and tests build one directly.
 *
 * @param vars environment variables
 * @param cwd the working directory, absolute
 * @param terminal whether the tool is attached to a terminal (colors the error label)
 */
public record Env(Map<String, String> vars, Path cwd, boolean terminal) {

    public Env {
        vars = Map.copyOf(vars);
    }

    /** A variable's value; unset and empty are the same. */
    public Optional<String> get(String name) {
        return Optional.ofNullable(vars.get(name)).filter(value -> !value.isEmpty());
    }
}
