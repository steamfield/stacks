package app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The Claude Code guard hook, run the way Claude Code runs it: {@code bash <hook>} with the tool
 * payload on stdin, from the project root.
 */
class ClaudeHooksTest {

    private static final Path ROOT = Path.of("").toAbsolutePath();
    private static final Path HOOK = ROOT.resolve(".claude/hooks/guard-maven.sh");

    /** The hook's stdout for this payload, run with {@code project} as the project root. */
    private static String run(Path project, String payload) throws IOException, InterruptedException {
        ProcessBuilder builder = new ProcessBuilder("bash", HOOK.toString()).directory(project.toFile());
        builder.environment().put("CLAUDE_PROJECT_DIR", project.toString());
        Process process = builder.start();
        process.getOutputStream().write(payload.getBytes(StandardCharsets.UTF_8));
        process.getOutputStream().close();
        String out = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertThat(process.waitFor()).as(payload).isZero();
        return out;
    }

    private static String quote(String text) {
        return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static String bash(Path project, String command) throws IOException, InterruptedException {
        return run(project, "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":" + quote(command) + "}}");
    }

    private static String write(String file) throws IOException, InterruptedException {
        return run(
                ROOT, "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":" + quote(file) + ",\"content\":\"\"}}");
    }

    private static boolean hasJq() {
        try {
            return new ProcessBuilder("jq", "--version").start().waitFor() == 0;
        } catch (IOException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    @Test
    void mavenRunsThroughTheWrapperAndNeverPublishes() throws Exception {
        if (!hasJq()) {
            // Without jq the guard steps aside rather than guess at the payload.
            assertThat(bash(ROOT, "mvn test")).isEmpty();
            return;
        }
        for (String command : List.of(
                "mvn test",
                "make fmt && mvn package",
                "/opt/homebrew/bin/mvn clean",
                "./mvnw deploy",
                "./mvnw -P release clean deploy",
                "./mvnw -q central-publishing:publish",
                "./mvnw gpg:sign")) {
            assertThat(bash(ROOT, command)).as(command).contains("\"deny\"");
        }
        for (String command : List.of(
                "./mvnw -q test -Dtest=SlugRulesTest",
                "make ci",
                "mvn -N wrapper:wrapper -Dtype=only-script",
                "mvn -v",
                "grep deploy docs/releasing.md")) {
            assertThat(bash(ROOT, command)).as(command).isEmpty();
        }
    }

    @Test
    void theApiBaselineIsRecordedOnceThenOnlyByAPerson(@TempDir Path project) throws Exception {
        if (!hasJq()) {
            assertThat(bash(project, "make api-baseline")).isEmpty();
            return;
        }
        assertThat(bash(project, "make api-baseline")).isEmpty();
        Files.createDirectories(project.resolve("api"));
        Files.write(project.resolve("api/baseline.jar"), new byte[0]);
        for (String command : List.of("make api-baseline", "make build && make api-baseline")) {
            assertThat(bash(project, command)).as(command).contains("\"deny\"");
        }
        assertThat(bash(project, "make api-check")).isEmpty();
    }

    @Test
    void generatedFilesAreNotEditedByHand() throws Exception {
        if (!hasJq()) {
            assertThat(write("mvnw")).isEmpty();
            return;
        }
        for (String file : List.of(
                "mvnw",
                "mvnw.cmd",
                ".mvn/wrapper/maven-wrapper.properties",
                "target/classes/app/Slug.class",
                "api/baseline.jar",
                ROOT + "/target/app.jar",
                ROOT + "/src/../mvnw")) {
            assertThat(write(file)).as(file).contains("\"deny\"");
        }
        for (String file : List.of(
                "pom.xml",
                ".mvn/jvm.config",
                "src/main/java/app/api/Api.java",
                "docs/public-api.md",
                "/elsewhere/mvnw")) {
            assertThat(write(file)).as(file).isEmpty();
        }
    }
}
