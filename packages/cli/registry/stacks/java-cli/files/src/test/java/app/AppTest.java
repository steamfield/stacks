package app;

import static org.assertj.core.api.Assertions.assertThat;

import app.config.Env;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Whole invocations in process: arguments in, exit status and both streams out. */
class AppTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @TempDir
    Path home;

    private record Result(int code, String stdout, String stderr) {}

    private Result run(String... args) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ByteArrayOutputStream err = new ByteArrayOutputStream();
        Env env = new Env(Map.of("HOME", home.toString()), home, false);
        int code = App.run(
                args,
                env,
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));
        return new Result(code, out.toString(StandardCharsets.UTF_8), err.toString(StandardCharsets.UTF_8));
    }

    @Test
    void configShowPrintsTheDefaultGreeting() {
        Result result = run("config", "show");
        assertThat(result.code()).isZero();
        assertThat(result.stderr()).isEmpty();
        assertThat(result.stdout()).startsWith("greeting = \"Hello, world!\"\n");
    }

    @Test
    void globalOptionsWorkAfterTheSubcommand() {
        Result result = run("config", "show", "--json");
        assertThat(result.code()).isZero();
        JsonNode document = JSON.readTree(result.stdout());
        assertThat(document.get("greeting").asString()).isEqualTo("Hello, world!");
        assertThat(document.get("no-color").asBoolean()).isFalse();
        assertThat(result.stdout().lines()).hasSize(1);
    }

    @Test
    void anUnknownSubcommandIsAUsageErrorWithOneReport() {
        Result result = run("--json", "frobnicate");
        assertThat(result.code()).isEqualTo(2);
        assertThat(result.stdout()).isEmpty();
        JsonNode error = JSON.readTree(result.stderr()).get("error");
        assertThat(error.get("code").asString()).isEqualTo("USAGE");
        assertThat(error.get("message").asString()).contains("frobnicate");
        assertThat(error.get("suggestion").asString()).contains("--help");
    }

    @Test
    void aGroupWithoutItsSubcommandIsAUsageError() {
        Result result = run("config");
        assertThat(result.code()).isEqualTo(2);
        assertThat(result.stderr()).startsWith("error[USAGE]: '" + AppInfo.NAME + " config' needs a subcommand");
    }

    @Test
    void helpAndVersionHonorJsonAndSkipConfig() {
        assertThat(JSON.readTree(run("--json", "--help").stdout()).get("help").asString())
                .contains("Usage:");
        assertThat(run("config", "--help").stdout()).contains("show");
        Result version = run("--json", "--version");
        assertThat(version.stdout()).isEqualTo("{\"version\":\"" + AppInfo.version() + "\"}\n");
        // A broken --config is never read for help or version.
        assertThat(run("--config", "missing.toml", "--version").code()).isZero();
    }

    @Test
    void noArgumentsPrintsHelp() {
        Result result = run();
        assertThat(result.code()).isZero();
        assertThat(result.stdout()).contains("Usage: " + AppInfo.NAME);
    }

    @Test
    void aConfigFailureExitsThree() {
        Result result = run("--config", "missing.toml", "config", "show");
        assertThat(result.code()).isEqualTo(3);
        assertThat(result.stderr()).startsWith("error[CONFIG_NOT_FOUND]: ");
    }

    @Test
    void jsonAfterTheSeparatorIsAnArgumentNotTheFlag() {
        assertThat(App.wantsJson(new String[] {"x", "--", "--json"})).isFalse();
        assertThat(App.wantsJson(new String[] {"x", "--json"})).isTrue();
    }
}
