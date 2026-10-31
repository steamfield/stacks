package app.web;

import app.errors.ErrorCode;

/**
 * The body of every error response: {@code {"error":{"tag","message","retryable"}}}.
 *
 * @param error the code's tag, fixed message and retryability
 */
public record ErrorEnvelope(Detail error) {

    /**
     * One row of the error table as clients see it.
     *
     * @param tag stable name clients branch on
     * @param message fixed, safe to show
     * @param retryable whether the same request may succeed later
     */
    public record Detail(String tag, String message, boolean retryable) {}

    static ErrorEnvelope of(ErrorCode code) {
        return new ErrorEnvelope(new Detail(code.tag(), code.message(), code.retryable()));
    }
}
