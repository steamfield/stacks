package app.errors;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ErrorCodeTest {

    @Test
    void eachKindOfFailureMapsToItsExitStatus() {
        assertThat(ErrorCode.USAGE.exitCode()).isEqualTo(2);
        assertThat(ErrorCode.CONFIG_NOT_FOUND.exitCode()).isEqualTo(3);
        assertThat(ErrorCode.CONFIG.exitCode()).isEqualTo(3);
        assertThat(ErrorCode.INVALID_SETTING.exitCode()).isEqualTo(3);
        assertThat(ErrorCode.IO.exitCode()).isEqualTo(1);
        assertThat(ErrorCode.INTERNAL.exitCode()).isEqualTo(1);
    }

    @Test
    void everyCodeSaysWhatToDo() {
        for (ErrorCode code : ErrorCode.values()) {
            assertThat(code.suggestion()).as(code.name()).isNotBlank().endsWith(".");
        }
    }

    @Test
    void theMessageIsWhatTheUserReads() {
        CliException failure = new CliException(ErrorCode.USAGE, "unknown option '--frob'");
        assertThat(failure.getMessage()).isEqualTo("unknown option '--frob'");
        assertThat(failure.code()).isEqualTo(ErrorCode.USAGE);
    }
}
