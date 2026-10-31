package app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The Claude Code guard hook, run the way Claude Code runs it: {@code bash <hook>} with the tool
 * payload on stdin, from the project root.
 */
class ClaudeHooksTest {

    private static final Path ROOT = Path.of("").toAbsolutePath();
    private static final Path HOOK = ROOT.resolve(".claude/hooks/guard-spring-web.sh");

    /** The hook's stdout for this payload: empty when it allows the call. */
    private static String run(String payload) throws IOException, InterruptedException {
        ProcessBuilder builder = new ProcessBuilder("bash", HOOK.toString()).directory(ROOT.toFile());
        builder.environment().put("CLAUDE_PROJECT_DIR", ROOT.toString());
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

    private static String bash(String command) throws IOException, InterruptedException {
        return run("{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":" + quote(command) + "}}");
    }

    private static String write(String file) throws IOException, InterruptedException {
        return run("{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":" + quote(file) + ",\"content\":\"\"}}");
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
    void mavenRunsThroughTheWrapperAndNoPackageManagerInstalls() throws Exception {
        if (!hasJq()) {
            // Without jq the guard steps aside rather than guess at the payload.
            assertThat(bash("mvn test")).isEmpty();
            return;
        }
        for (String command : List.of(
                "mvn test",
                "mvn -q verify",
                "make fmt && mvn package",
                "/opt/homebrew/bin/mvn clean",
                "./mvnw spring-boot:run",
                "cd app; ./mvnw -q spring-boot:run",
                "npm install htmx.org",
                "make build && bun add alpinejs",
                "pnpm i",
                "npm create vite web")) {
            assertThat(bash(command)).as(command).contains("\"deny\"");
        }
        for (String command : List.of(
                "./mvnw -q test -Dtest=NotesControllerTest",
                "make serve",
                "npm view htmx.org version",
                "grep -rn 'bun add' docs",
                "mvn -N wrapper:wrapper -Dtype=only-script",
                "mvn -v",
                "grep mvnw README.md",
                "echo spring-boot:runner")) {
            assertThat(bash(command)).as(command).isEmpty();
        }
    }

    @Test
    void theWrapperBuildOutputAndCopiedLibrariesAreNotWrittenByHand() throws Exception {
        if (!hasJq()) {
            assertThat(write("mvnw")).isEmpty();
            return;
        }
        for (String file : List.of(
                "mvnw",
                "mvnw.cmd",
                ".mvn/wrapper/maven-wrapper.properties",
                "target/classes/application.yaml",
                ROOT + "/target/app.jar",
                ROOT + "/src/../mvnw",
                "package.json",
                "src/main/resources/static/js/htmx.min.js")) {
            assertThat(write(file)).as(file).contains("\"deny\"");
        }
        for (String file : List.of(
                "pom.xml",
                ".mvn/jvm.config",
                "src/main/java/app/target/Target.java",
                "docs/mvnw.md",
                "src/main/resources/static/css/site.css",
                "src/main/resources/templates/notes/index.html",
                "/elsewhere/mvnw")) {
            assertThat(write(file)).as(file).isEmpty();
        }
    }
}
