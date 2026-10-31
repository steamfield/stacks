package app.errors;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

class ErrorCodeTest {

    @Test
    void eachStatusHasOneRow() {
        assertThat(Arrays.stream(ErrorCode.values()).map(ErrorCode::status)).doesNotHaveDuplicates();
    }

    @Test
    void forStatusFallsBackByClass() {
        assertThat(ErrorCode.forStatus(404)).isEqualTo(ErrorCode.NOT_FOUND);
        assertThat(ErrorCode.forStatus(403)).isEqualTo(ErrorCode.FORBIDDEN);
        assertThat(ErrorCode.forStatus(413)).isEqualTo(ErrorCode.BAD_REQUEST);
        assertThat(ErrorCode.forStatus(502)).isEqualTo(ErrorCode.INTERNAL);
    }
}
