package app.errors;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

class ErrorCodeTest {

    @Test
    void eachStatusAndTagHasOneRow() {
        assertThat(Arrays.stream(ErrorCode.values()).map(ErrorCode::status)).doesNotHaveDuplicates();
        assertThat(Arrays.stream(ErrorCode.values()).map(ErrorCode::tag)).doesNotHaveDuplicates();
    }

    @Test
    void onlyUnavailableIsRetryable() {
        assertThat(Arrays.stream(ErrorCode.values()).filter(ErrorCode::retryable))
                .containsExactly(ErrorCode.UNAVAILABLE);
    }

    @Test
    void forStatusFallsBackByClass() {
        assertThat(ErrorCode.forStatus(404)).isEqualTo(ErrorCode.NOT_FOUND);
        assertThat(ErrorCode.forStatus(413)).isEqualTo(ErrorCode.BAD_INPUT);
        assertThat(ErrorCode.forStatus(502)).isEqualTo(ErrorCode.INTERNAL);
    }
}
