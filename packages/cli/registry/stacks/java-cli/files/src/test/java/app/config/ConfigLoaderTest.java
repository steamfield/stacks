package app.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.AppInfo;
import app.errors.CliException;
import app.errors.ErrorCode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ConfigLoaderTest {

    @TempDir
    Path dir;

    private Env env(String... pairs) {
        Map<String, String> vars = new HashMap<>();
        vars.put("HOME", dir.resolve("home").toString());
        for (int i = 0; i < pairs.length; i += 2) {
            vars.put(pairs[i], pairs[i + 1]);
        }
        return new Env(vars, dir, false);
    }

    private void write(Path path, String text) throws IOException {
        Files.createDirectories(path.getParent());
        Files.writeString(path, text);
    }

    private Path projectFile() {
        return dir.resolve(AppInfo.NAME + ".toml");
    }

    @Test
    void defaultsApplyWithNoFilesOrEnvironment() throws CliException {
        assertThat(ConfigLoader.load(Flags.NONE, env())).isEqualTo(Config.DEFAULTS);
    }

    @Test
    void eachLayerOverridesTheOneBelow() throws Exception {
        write(dir.resolve("home/.config").resolve(AppInfo.NAME).resolve("config.toml"), "greeting = \"home\"");
        assertThat(ConfigLoader.load(Flags.NONE, env()).greeting()).isEqualTo("home");
        write(projectFile(), "greeting = \"project\"");
        assertThat(ConfigLoader.load(Flags.NONE, env()).greeting()).isEqualTo("project");
        Env withVariable = env(ConfigLoader.envVar("greeting"), "env");
        assertThat(ConfigLoader.load(Flags.NONE, withVariable).greeting()).isEqualTo("env");
    }

    @Test
    void xdgConfigHomeReplacesTheHomeDirectory() throws Exception {
        write(dir.resolve("xdg").resolve(AppInfo.NAME).resolve("config.toml"), "greeting = \"xdg\"");
        Env env = env("XDG_CONFIG_HOME", dir.resolve("xdg").toString());
        assertThat(ConfigLoader.load(Flags.NONE, env).greeting()).isEqualTo("xdg");
    }

    @Test
    void aFlagOverridesFilesAndEnvironment() throws Exception {
        write(projectFile(), "json = false");
        Env env = env(ConfigLoader.envVar("json"), "false");
        assertThat(ConfigLoader.load(new Flags(null, true, false, false), env).json())
                .isTrue();
        assertThat(ConfigLoader.load(Flags.NONE, env).json()).isFalse();
    }

    @Test
    void anExplicitConfigReplacesTheDefaultFilesAndMustExist() throws Exception {
        write(projectFile(), "greeting = \"project\"");
        write(dir.resolve("other.toml"), "greeting = \"other\"");
        Flags other = new Flags(Path.of("other.toml"), false, false, false);
        assertThat(ConfigLoader.load(other, env()).greeting()).isEqualTo("other");
        Flags missing = new Flags(Path.of("missing.toml"), false, false, false);
        assertThatThrownBy(() -> ConfigLoader.load(missing, env()))
                .isInstanceOfSatisfying(
                        CliException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.CONFIG_NOT_FOUND));
    }

    @Test
    void invalidValuesFailWithTheSettingNamed() throws Exception {
        assertThatThrownBy(() -> ConfigLoader.load(Flags.NONE, env(ConfigLoader.envVar("greeting"), "   ")))
                .isInstanceOfSatisfying(
                        CliException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.INVALID_SETTING));
        String json = ConfigLoader.envVar("json");
        assertThatThrownBy(() -> ConfigLoader.load(Flags.NONE, env(json, "yes please")))
                .hasMessageContaining(json);
    }

    @Test
    void unknownKeysAndBadTomlAreConfigErrors() throws Exception {
        write(projectFile(), "greting = \"typo\"");
        assertThatThrownBy(() -> ConfigLoader.load(Flags.NONE, env())).isInstanceOfSatisfying(CliException.class, e -> {
            assertThat(e.code()).isEqualTo(ErrorCode.CONFIG);
            assertThat(e.getMessage()).contains("greting");
        });
        write(projectFile(), "greeting = ");
        assertThatThrownBy(() -> ConfigLoader.load(Flags.NONE, env()))
                .isInstanceOfSatisfying(
                        CliException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.CONFIG));
    }

    @Test
    void emptyEnvironmentValuesAreIgnored() throws CliException {
        Env env = env(ConfigLoader.envVar("greeting"), "", ConfigLoader.envVar("json"), "");
        assertThat(ConfigLoader.load(Flags.NONE, env)).isEqualTo(Config.DEFAULTS);
    }

    @Test
    void variableNamesUseThePrefixAndUnderscores() {
        assertThat(ConfigLoader.envVar("no-color")).isEqualTo(AppInfo.ENV_PREFIX + "_NO_COLOR");
    }
}
