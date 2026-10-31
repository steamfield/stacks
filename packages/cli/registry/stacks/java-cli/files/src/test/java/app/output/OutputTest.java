package app.output;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.errors.CliException;
import app.errors.ErrorCode;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class OutputTest {

    private final ByteArrayOutputStream out = new ByteArrayOutputStream();
    private final ByteArrayOutputStream err = new ByteArrayOutputStream();

    private Output output(boolean json, boolean color) {
        return new Output(
                json,
                color,
                new PrintStream(out, true, StandardCharsets.UTF_8),
                new PrintStream(err, true, StandardCharsets.UTF_8));
    }

    @Test
    void jsonResultsAreOneDocumentPerLine() throws CliException {
        output(true, false).result(Map.of("a", 1), "ignored");
        assertThat(out.toString(StandardCharsets.UTF_8)).isEqualTo("{\"a\":1}\n");
    }

    @Test
    void humanResultsAreTheText() throws CliException {
        output(false, false).result(Map.of("a", 1), "a = 1");
        assertThat(out.toString(StandardCharsets.UTF_8)).isEqualTo("a = 1\n");
    }

    @Test
    void jsonErrorsCarryCodeMessageAndSuggestion() {
        output(true, true).error(new CliException(ErrorCode.USAGE, "unknown option '--x'"));
        JsonNode error = JsonMapper.builder()
                .build()
                .readTree(err.toString(StandardCharsets.UTF_8))
                .get("error");
        assertThat(error.get("code").asString()).isEqualTo("USAGE");
        assertThat(error.get("message").asString()).isEqualTo("unknown option '--x'");
        assertThat(error.get("suggestion").asString()).contains("--help");
        assertThat(out.size()).isZero();
    }

    @Test
    void humanErrorsAreColoredOnlyWhenAsked() {
        output(false, false).error(new CliException(ErrorCode.USAGE, "bad"));
        assertThat(err.toString(StandardCharsets.UTF_8)).startsWith("error[USAGE]: bad\n  suggestion: ");
        err.reset();
        output(false, true).error(new CliException(ErrorCode.USAGE, "bad"));
        assertThat(err.toString(StandardCharsets.UTF_8)).contains("\u001b[31m");
    }

    @Test
    void aResultThatCannotBeWrittenIsAnIoError() {
        OutputStream broken = new OutputStream() {
            @Override
            public void write(int b) throws IOException {
                throw new IOException("closed");
            }
        };
        Output output = new Output(false, false, new PrintStream(broken, true, StandardCharsets.UTF_8), System.err);
        assertThatThrownBy(() -> output.result(Map.of(), "text"))
                .isInstanceOfSatisfying(
                        CliException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.IO));
    }
}
