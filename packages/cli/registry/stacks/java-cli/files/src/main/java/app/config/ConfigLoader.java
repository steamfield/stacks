package app.config;

import app.AppInfo;
import app.errors.CliException;
import app.errors.ErrorCode;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.jspecify.annotations.Nullable;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.dataformat.toml.TomlMapper;

/**
 * Builds the {@link Config}. Precedence, lowest first: defaults, the home file, the project file (or
 * only {@code --config}), the environment, then flags.
 */
public final class ConfigLoader {

    private static final TomlMapper TOML = TomlMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();

    private ConfigLoader() {}

    public static Config load(Flags flags, Env env) throws CliException {
        Config config = Config.DEFAULTS;
        Path explicit = flags.config();
        if (explicit != null) {
            Path path = env.cwd().resolve(explicit);
            Layer layer = read(path)
                    .orElseThrow(
                            () -> new CliException(ErrorCode.CONFIG_NOT_FOUND, "config file " + path + " not found"));
            config = layer.apply(config);
        } else {
            for (Path path : defaultFiles(env)) {
                Optional<Layer> layer = read(path);
                if (layer.isPresent()) {
                    config = layer.get().apply(config);
                }
            }
        }
        config = environment(env).apply(config);
        return new Config(
                        config.greeting(),
                        config.json() || flags.json(),
                        config.verbose() || flags.verbose(),
                        config.noColor() || flags.noColor())
                .validate();
    }

    /** The variable for a setting: {@code <PREFIX>_<KEY>}, upper-cased, hyphens as underscores. */
    public static String envVar(String key) {
        return AppInfo.ENV_PREFIX + "_" + key.toUpperCase(Locale.ROOT).replace('-', '_');
    }

    /** {@code $XDG_CONFIG_HOME/<name>/config.toml} (or {@code ~/.config/...}), then {@code ./<name>.toml}. */
    static List<Path> defaultFiles(Env env) {
        List<Path> files = new ArrayList<>();
        env.get("XDG_CONFIG_HOME")
                .map(Path::of)
                .or(() -> env.get("HOME").map(home -> Path.of(home, ".config")))
                .ifPresent(dir -> files.add(dir.resolve(AppInfo.NAME).resolve("config.toml")));
        files.add(env.cwd().resolve(AppInfo.NAME + ".toml"));
        return files;
    }

    /** A missing file is empty; an unreadable or invalid one is an error. */
    private static Optional<Layer> read(Path path) throws CliException {
        String text;
        try {
            text = Files.readString(path);
        } catch (NoSuchFileException e) {
            return Optional.empty();
        } catch (IOException e) {
            throw new CliException(ErrorCode.CONFIG, "cannot read config file " + path + ": " + e.getMessage(), e);
        }
        try {
            return Optional.of(TOML.readValue(text, Layer.class));
        } catch (JacksonException e) {
            throw new CliException(ErrorCode.CONFIG, "invalid config file " + path + ": " + e.getOriginalMessage(), e);
        }
    }

    private static Layer environment(Env env) throws CliException {
        return new Layer(
                env.get(envVar("greeting")).orElse(null),
                bool(env, envVar("json")),
                bool(env, envVar("verbose")),
                bool(env, envVar("no-color")));
    }

    private static @Nullable Boolean bool(Env env, String name) throws CliException {
        Optional<String> value = env.get(name);
        if (value.isEmpty()) {
            return null;
        }
        return switch (value.get().toLowerCase(Locale.ROOT)) {
            case "1", "true" -> true;
            case "0", "false" -> false;
            default ->
                throw new CliException(
                        ErrorCode.INVALID_SETTING,
                        "invalid setting " + name + ": expected true or false, got \"" + value.get() + "\"");
        };
    }

    /** One config file or the environment. Every key is optional; unknown keys are an error. */
    record Layer(
            @Nullable String greeting,
            @Nullable Boolean json,
            @Nullable Boolean verbose,
            @JsonProperty("no-color") @Nullable Boolean noColor) {

        Config apply(Config below) {
            return new Config(
                    greeting != null ? greeting : below.greeting(),
                    json != null ? json : below.json(),
                    verbose != null ? verbose : below.verbose(),
                    noColor != null ? noColor : below.noColor());
        }
    }
}
