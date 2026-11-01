package app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The packaged jar, run the way a user runs it: {@code java -jar} in a child process with a clean
 * environment. Failsafe passes the jar's path and the project version.
 */
class JarIT {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Path JAR = Path.of(System.getProperty("app.jar", "target/app.jar"));
    private static final Path JAVA = Path.of(System.getProperty("java.home"), "bin", "java");

    @TempDir
    Path home;

    private record Result(int code, String stdout, String stderr) {}

    private Result run(String... args) throws IOException, InterruptedException {
        List<String> command = new ArrayList<>(List.of(JAVA.toString(), "-jar", JAR.toString()));
        command.addAll(List.of(args));
        Path stdout = home.resolve("stdout");
        Path stderr = home.resolve("stderr");
        ProcessBuilder builder = new ProcessBuilder(command)
                .directory(home.toFile())
                .redirectOutput(stdout.toFile())
                .redirectError(stderr.toFile());
        builder.environment().clear();
        builder.environment().put("HOME", home.toString());
        Process process = builder.start();
        assertThat(process.waitFor(60, TimeUnit.SECONDS)).as("exited").isTrue();
        return new Result(
                process.exitValue(),
                Files.readString(stdout, StandardCharsets.UTF_8),
                Files.readString(stderr, StandardCharsets.UTF_8));
    }

    @Test
    void theJarExists() {
        assertThat(JAR).isRegularFile();
    }

    @Test
    void helpAndVersionComeFromTheJar() throws Exception {
        Result help = run("--help");
        assertThat(help.code()).isZero();
        assertThat(help.stdout()).contains("Usage:").contains("config");
        Result version = run("--json", "--version");
        assertThat(version.code()).isZero();
        assertThat(JSON.readTree(version.stdout()).get("version").asString())
                .isEqualTo(System.getProperty("app.version"));
    }

    @Test
    void configShowReadsTheProjectFile() throws Exception {
        Files.writeString(home.resolve("custom.toml"), "greeting = \"from a file\"\n");
        Result result = run("--config", "custom.toml", "config", "show", "--json");
        assertThat(result.code()).as(result.stderr()).isZero();
        assertThat(result.stderr()).isEmpty();
        assertThat(JSON.readTree(result.stdout()).get("greeting").asString()).isEqualTo("from a file");
    }

    @Test
    void verboseJsonLogsGoToStderrAsJsonLines() throws Exception {
        Result result = run("-v", "--json", "config", "show");
        assertThat(result.code()).isZero();
        assertThat(result.stdout().lines()).hasSize(1);
        JsonNode record = JSON.readTree(result.stderr().lines().findFirst().orElseThrow());
        assertThat(record.get("level").asString()).isEqualTo("DEBUG");
    }

    @Test
    void failuresExitWithTheirStatusAndOneEnvelope() throws Exception {
        Result usage = run("--json", "frobnicate");
        assertThat(usage.code()).isEqualTo(2);
        assertThat(usage.stdout()).isEmpty();
        assertThat(JSON.readTree(usage.stderr()).get("error").get("code").asString())
                .isEqualTo("USAGE");

        Files.writeString(home.resolve("bad.toml"), "greting = \"typo\"\n");
        Result config = run("--config", "bad.toml", "config", "show");
        assertThat(config.code()).isEqualTo(3);
        assertThat(config.stderr()).startsWith("error[CONFIG]: ");
    }
}
